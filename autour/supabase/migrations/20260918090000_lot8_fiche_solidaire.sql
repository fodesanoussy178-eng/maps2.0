-- ---------------------------------------------------------------------------
-- LOT 8 · 1 — LA FICHE QUI SERT
--
-- CE QUI N'ALLAIT PAS
--
-- « CMP — santé » ne sert à personne. Le sigle ne dit pas ce qu'on y fait, la
-- famille ne dit pas à qui c'est ouvert, et ni l'un ni l'autre ne dit comment
-- on entre. Or dans le domaine solidaire, le champ décisif n'est ni la
-- catégorie ni la photo : c'est LE MODE D'ACCÈS.
--
-- Quelqu'un qui se déplace jusqu'à l'adresse d'un CHRS repart bredouille :
-- l'entrée se fait par le 115. Une fiche qui ne le dit pas fait perdre un
-- trajet à quelqu'un qui n'en avait pas les moyens. C'est le défaut que ce
-- fichier corrige, et c'est le seul.
--
-- CE QUE CE FICHIER N'AJOUTE PAS
--
-- Aucune intelligence. Les huit colonnes ci-dessous existent déjà, remplies,
-- dans data·inclusion : types de service, publics visés, modes d'accueil,
-- frais. Les brancher est une traduction de vocabulaire. La seule chose qui
-- s'écrit à la main est `quoi_concretement`, parce qu'elle doit être écrite
-- pour un lecteur et non pour un référentiel.
--
-- LES FAMILLES NE BOUGENT PAS. `solidarite` existe depuis le Lot 4-bis. Ce
-- qui manquait n'était pas une famille, c'était un cran en dessous : un CHRS
-- et un vestiaire ne sont pas la même porte.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. LES SOUS-TYPES — et le premier d'entre eux qui ne s'affiche pas
--
-- B.3 : UN GESTIONNAIRE N'EST PAS UN LIEU. ALEFPA et La Sauvegarde du Nord
-- gèrent des dizaines d'établissements. Les poser comme un point sur la carte
-- ne veut rien dire pour quelqu'un qui cherche une porte : on n'entre pas dans
-- une association gestionnaire, on entre dans un de ses établissements. Sans
-- `affiche = false`, la carte se remplit de sièges sociaux.
-- ---------------------------------------------------------------------------

create table if not exists public.place_sous_types (
  sous_type  text primary key,
  famille    text not null references public.place_familles(famille),
  label      text not null,
  -- Faux = cette ligne décrit un organisme, pas une adresse où l'on va.
  affiche    boolean not null default true,
  rang       integer not null default 100
);

comment on table public.place_sous_types is
  'Un cran sous la famille. `affiche = false` désigne un organisme gestionnaire : il n''est jamais un point sur la carte.';
comment on column public.place_sous_types.affiche is
  'Faux pour `gestionnaire` : on n''entre pas dans une association gestionnaire, on entre dans un de ses établissements.';

insert into public.place_sous_types (sous_type, famille, label, affiche, rang) values
  ('hebergement_urgence',     'solidarite', 'Hébergement d''urgence',            true,  10),
  ('logement_jeunes',         'solidarite', 'Logement des jeunes',               true,  20),
  ('action_sociale_generale', 'solidarite', 'Action sociale généraliste',        true,  30),
  ('sante_mentale',           'solidarite', 'Santé mentale et écoute',           true,  40),
  ('accueil_jeunes',          'solidarite', 'Accueil et écoute des jeunes',      true,  50),
  ('aide_materielle',         'solidarite', 'Aide matérielle et alimentaire',    true,  60),
  ('violences_femmes',        'solidarite', 'Violences faites aux femmes',       true,  70),
  ('gestionnaire',            'solidarite', 'Organisme gestionnaire',            false, 900)
on conflict (sous_type) do update
  set famille = excluded.famille, label = excluded.label,
      affiche = excluded.affiche, rang = excluded.rang;

alter table public.place_sous_types enable row level security;
drop policy if exists "sous-types de lieux: lecture publique" on public.place_sous_types;
create policy "sous-types de lieux: lecture publique" on public.place_sous_types
  for select to anon, authenticated using (true);
revoke all on public.place_sous_types from anon, authenticated;
grant select on public.place_sous_types to anon, authenticated;
grant all on public.place_sous_types to service_role;


-- ---------------------------------------------------------------------------
-- 2. LES HUIT CHAMPS DE LA FICHE
--
-- Tous nuls par défaut, et c'est la règle qui compte : un champ nul se voit et
-- se corrige ; un champ deviné se propage et personne ne s'en aperçoit.
-- ---------------------------------------------------------------------------

alter table public.places
  add column if not exists sous_type              text references public.place_sous_types(sous_type),
  -- Tranche d'âge ou situation, avec le vocabulaire de la source. « 12-25 ans »
  -- change tout : un accueil jeunes n'est pas un accueil tout public.
  add column if not exists public_vise            text[] not null default '{}'::text[],
  -- LE CHAMP LE PLUS IMPORTANT DE LA TABLE.
  add column if not exists mode_acces             text
    check (mode_acces in ('libre','rendez_vous','orientation','telephone')),
  add column if not exists cout                   text
    check (cout in ('gratuit','participation','payant')),
  -- Décisif pour les jeunes et la santé mentale. Nul = on ne sait pas, ce qui
  -- n'est pas « non » : personne ne doit lire une promesse qu'on n'a pas.
  add column if not exists anonymat               boolean,
  -- Une à deux phrases en langage ordinaire. Pas le sigle : ce qui s'y passe.
  add column if not exists quoi_concretement      text
    check (quoi_concretement is null or char_length(btrim(quoi_concretement)) between 20 and 400),
  -- 115, 3919, 3114. Parfois la seule porte d'entrée, et alors l'adresse est
  -- une fausse piste.
  add column if not exists telephone_cle          text,
  add column if not exists type_structure         text,
  -- B.3 encore : le lieu où l'on va, et l'organisme qui le gère, séparés.
  add column if not exists organisme_gestionnaire text,
  -- B.6.4 : la relecture humaine, écrite dans la table et non dans un usage.
  add column if not exists relu_par               text,
  add column if not exists relu_le                timestamptz;

comment on column public.places.mode_acces is
  'Comment on entre : libre, rendez_vous, orientation (par un prescripteur), telephone. Une fiche sans ce champ fait perdre un trajet.';
comment on column public.places.quoi_concretement is
  'Ce qui s''y passe, en français ordinaire, écrit à la main. Jamais repris d''un référentiel ni produit par un modèle.';
comment on column public.places.telephone_cle is
  'Le numéro qui EST la porte d''entrée (115, 3919, 3114). Renseigné, il prime sur l''adresse dans la fiche.';
comment on column public.places.organisme_gestionnaire is
  'Qui gère le lieu. Un gestionnaire n''est pas un lieu : il n''a jamais son propre point sur la carte.';
comment on column public.places.relu_le is
  'Quand un humain a relu la fiche. Obligatoire pour la famille `solidarite` : une permanence fausse coûte plus cher qu''une permanence absente.';

create index if not exists places_sous_type_idx
  on public.places (zone_id, sous_type) where status <> 'disabled';


-- ---------------------------------------------------------------------------
-- 3. LES RÈGLES DE SÉCURITÉ, ÉCRITES EN CONTRAINTES
--
-- Elles ne sont pas déclaratives : une règle qui ne vit que dans une note de
-- revue finit par être contournée un soir de livraison. Celles-ci refusent
-- l'écriture.
-- ---------------------------------------------------------------------------

-- B.6.1 — AUCUNE ADRESSE DE MISE À L'ABRI POUR FEMMES VICTIMES DE VIOLENCES.
-- Les hébergements de SOLFA et équivalents ont des adresses confidentielles ;
-- les publier met des personnes en danger. On publie la permanence d'accueil
-- de jour et le 3919, rien d'autre. Une ligne de ce sous-type qui porte une
-- adresse doit donc déclarer qu'il s'agit d'un accueil de jour — sinon elle
-- est refusée, et c'est le comportement voulu.
alter table public.places
  drop constraint if exists places_violences_femmes_sans_adresse;
alter table public.places
  add constraint places_violences_femmes_sans_adresse check (
    sous_type is distinct from 'violences_femmes'
    or address is null
    or type_structure = 'accueil_de_jour'
  ) not valid;

-- B.6.2 — POUR L'HÉBERGEMENT D'URGENCE, LA FICHE DONNE LE 115.
-- On n'entre pas dans un CHRS en sonnant : l'orientation passe par le 115 ou
-- par un prescripteur. Une fiche de ce sous-type qui annonce un accès libre
-- envoie quelqu'un devant une porte qui ne s'ouvrira pas.
alter table public.places
  drop constraint if exists places_hebergement_urgence_par_le_115;
alter table public.places
  add constraint places_hebergement_urgence_par_le_115 check (
    sous_type is distinct from 'hebergement_urgence'
    or (telephone_cle = '115' and mode_acces in ('telephone','orientation'))
  ) not valid;

-- B.6.3 — AUCUN HORAIRE DEVINÉ SUR CETTE FAMILLE.
-- Un horaire de permanence sociale faux coûte plus cher qu'un horaire absent.
-- Seules les sources qui PUBLIENT l'horaire peuvent en poser un ici ; une
-- vérification par modèle n'en est pas une (voir la règle A.7).
alter table public.places
  drop constraint if exists places_solidarite_horaires_deterministes;
alter table public.places
  add constraint places_solidarite_horaires_deterministes check (
    family is distinct from 'solidarite'
    or opening_hours is null
    or opening_hours_source in ('osm','data_inclusion','finess','service_public','site_officiel')
  ) not valid;

-- Un numéro clé est un vrai numéro : soit un des numéros nationaux, soit un
-- numéro français écrit sans fantaisie.
alter table public.places
  drop constraint if exists places_telephone_cle_lisible;
alter table public.places
  add constraint places_telephone_cle_lisible check (
    telephone_cle is null
    or telephone_cle in ('115','119','3919','3114','196','116000')
    or telephone_cle ~ '^\+?[0-9][0-9 .-]{7,17}$'
  ) not valid;


-- ---------------------------------------------------------------------------
-- 4. LA RELECTURE HUMAINE — NIVEAU 3, SANS EXCEPTION
--
-- B.6.4 : toute fiche de la famille `solidarite` est relue par un humain avant
-- publication. Pas de montée progressive en automatisation, pas de seuil de
-- confiance qui finirait par ouvrir la porte. Un déclencheur, parce qu'une
-- contrainte de table ne peut pas distinguer « en préparation » de « servi » :
-- une ligne non relue existe, elle n'est simplement jamais `active`.
-- ---------------------------------------------------------------------------

create or replace function private.solidarite_exige_relecture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.family is distinct from 'solidarite' then
    return new;
  end if;
  if new.status = 'active' and new.relu_le is null then
    raise exception
      'lieu solidaire non relu : % ne peut pas être actif sans relecture humaine (B.6.4)', new.slug
      using errcode = 'check_violation';
  end if;
  -- Une relecture porte une signature. « Relu par personne » n'est pas une
  -- relecture, c'est une case cochée.
  if new.relu_le is not null and coalesce(btrim(new.relu_par), '') = '' then
    raise exception 'relecture sans relecteur : % doit nommer qui a relu', new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

comment on function private.solidarite_exige_relecture() is
  'Refuse d''activer une fiche solidaire non relue. Niveau 3 du système de permissions, appliqué à un cas réel.';

drop trigger if exists places_solidarite_relecture on public.places;
create trigger places_solidarite_relecture
  before insert or update on public.places
  for each row execute function private.solidarite_exige_relecture();


-- ---------------------------------------------------------------------------
-- 5. CE QUE LA CARTE A LE DROIT D'AFFICHER
--
-- Une fonction et non une vue : c'est le moule du dépôt. Elle ne filtre pas
-- « pour faire joli » — elle applique les deux règles au même endroit, pour
-- qu'aucun écran ne puisse les oublier séparément.
-- ---------------------------------------------------------------------------

create or replace function public.lieux_solidaires_affichables(p_zone text default null)
returns table (
  id                     uuid,
  slug                   text,
  name                   text,
  lat                    double precision,
  lng                    double precision,
  address                text,
  sous_type              text,
  sous_type_label        text,
  quoi_concretement      text,
  mode_acces             text,
  cout                   text,
  anonymat               boolean,
  public_vise            text[],
  telephone_cle          text,
  organisme_gestionnaire text,
  opening_hours          text,
  relu_le                timestamptz
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select p.id, p.slug, p.name, p.lat, p.lng,
         -- B.6.1 rappelée ici : même si une adresse a été écrite avant la
         -- contrainte, elle ne sort pas de cette fonction.
         case when p.sous_type = 'violences_femmes'
                and p.type_structure is distinct from 'accueil_de_jour'
              then null else p.address end,
         p.sous_type, t.label,
         p.quoi_concretement, p.mode_acces, p.cout, p.anonymat, p.public_vise,
         p.telephone_cle, p.organisme_gestionnaire, p.opening_hours, p.relu_le
  from public.places p
  join public.place_sous_types t on t.sous_type = p.sous_type
  where p.family = 'solidarite'
    and p.status = 'active'
    and t.affiche            -- un gestionnaire n'est pas un lieu
    and p.relu_le is not null -- niveau 3, sans exception
    and (p_zone is null or p.zone_id = p_zone)
  order by t.rang, p.name;
$function$;

comment on function public.lieux_solidaires_affichables(text) is
  'Les fiches solidaires qu''un écran a le droit de montrer : relues, affichables, et sans adresse de mise à l''abri.';

revoke all on function public.lieux_solidaires_affichables(text) from public;
grant execute on function public.lieux_solidaires_affichables(text) to anon, authenticated, service_role;
