-- ---------------------------------------------------------------------------
-- AGENT ACQUISITION — la base des opportunités
--
-- CE QU'ON A CHERCHÉ AVANT D'AJOUTER UNE TABLE
--
-- `places` tient l'inventaire des LIEUX qu'Autour montre à ses visiteurs.
-- `events` tient les ÉVÉNEMENTS. `territory_sources` et `offer_source_registry`
-- tiennent les SOURCES qu'on a le droit d'appeler. Aucune de ces tables ne peut
-- porter une opportunité d'acquisition, et pour une raison de fond : une
-- association qu'on envisage de contacter n'est pas un objet du produit. Elle
-- n'a pas à apparaître sur une carte, elle n'a pas de contenu à montrer, et
-- lui donner une ligne dans `places` la ferait entrer dans Explorer — un lieu
-- proposé à des visiteurs parce qu'on pensait écrire à ses responsables.
--
-- Les deux mondes se touchent quand même, et on garde le lien plutôt que de
-- recopier : `place_id` pointe vers le lieu quand l'opportunité EST un lieu
-- déjà inventorié, et alors ni l'adresse, ni les horaires, ni les photos ne
-- sont dupliqués ici.
--
--
-- PAS DE NOTE SUR 100
--
-- Un « 87/100 » est une opinion déguisée en mesure : on ne peut ni le
-- contester, ni savoir ce qui le ferait changer. La qualification vit donc dans
-- une table à part, une ligne par critère, et `pourquoi` y est NOT NULL. Un
-- critère sans justification ne peut pas être écrit — pas « ne devrait pas » :
-- ne peut pas.
--
-- La conséquence est volontaire : l'agent est obligé de rendre la phrase qui
-- explique, sinon son travail ne se range nulle part.
--
--
-- LES SOURCES SONT UNE TABLE, PAS UNE COLONNE
--
-- Même raison qu'`event_sources` face à `events` : une même association est
-- souvent vue deux fois — une fois dans l'annuaire des entreprises, une fois
-- comme organisatrice d'un événement déjà présent dans `events`. Deux
-- provenances, deux dates de collecte, deux URL. Une colonne `source` écraserait
-- la première dès qu'on trouve la seconde, et « trouvé sur Internet » est
-- exactement ce que le §14 interdit.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. L'OPPORTUNITÉ
-- ===========================================================================

create table if not exists public.acquisition_opportunites (
  id              uuid primary key default gen_random_uuid(),

  nom             text not null check (btrim(nom) <> ''),
  type            text not null default 'structure'
                  check (type in ('association','commerce','lieu_culturel',
                                  'organisateur','club','etablissement_etudiant',
                                  'communaute_locale','acteur_jeunesse',
                                  'lieu_de_sortie','acteur_evenementiel',
                                  'collectivite','media_local','creche_tiers_lieu',
                                  'structure')),
  -- ce qui distingue une structure (on lui parle) d'un gisement d'utilisateurs
  -- (on y va) : les deux se cherchent, se qualifient et se préparent
  -- différemment, et le §3 demande explicitement les deux.
  famille         text not null default 'structure'
                  check (famille in ('structure','opportunite_utilisateurs')),

  ville           text not null check (btrim(ville) <> ''),
  code_insee      text,
  zone_id         text references public.autour_zones(zone_id),

  -- RECOPIÉE de la source, jamais rédigée. Une description inventée est une
  -- caractéristique inventée, et le §6 l'interdit.
  description     text,

  -- par où on pourrait entrer en contact, si une adresse publique existe
  canal           text check (canal in ('email_public','formulaire_site','site_officiel',
                                        'telephone_public','sur_place','reseau_public')),

  /* COORDONNÉES PUBLIQUES, ET SEULEMENT SI ELLES SONT PUBLIÉES POUR ÇA.
     Une adresse de contact affichée par une structure sur son propre site
     l'est pour être utilisée. Une adresse personnelle trouvée ailleurs ne
     l'est pas. `coordonnees_publiques` ne reçoit donc que des champs
     institutionnels, et chacun garde l'URL de la page qui l'affiche. */
  coordonnees_publiques jsonb not null default '{}'::jsonb,

  cout_estime_eur numeric(8,2) not null default 0 check (cout_estime_eur >= 0),

  statut          text not null default 'nouvelle'
                  check (statut in ('nouvelle','qualifiee','a_examiner','validee',
                                    'contact_prepare','contacte','reponse',
                                    'partenaire','non_pertinente','a_revoir')),

  -- le lieu déjà inventorié, quand c'en est un : on ne recopie pas son adresse
  place_id        uuid references public.places(id) on delete set null,

  dernier_examen  timestamptz,
  prochaine_action text,
  notes           text,

  /* Clé de rapprochement : nom normalisé + ville normalisée. Sans elle, une
     récolte relancée le lendemain recrée les mêmes deux cents structures. */
  cle_dedup       text not null unique,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.acquisition_opportunites is
  'Opportunités d''acquisition — structures à qui parler, gisements d''utilisateurs où aller. Hors produit : rien d''ici n''est montré aux visiteurs d''Autour.';

comment on column public.acquisition_opportunites.coordonnees_publiques is
  'Uniquement des coordonnées institutionnelles publiées par la structure elle-même, chacune avec l''URL de la page qui l''affiche.';

create index if not exists acquisition_par_ville on public.acquisition_opportunites (ville, statut);
create index if not exists acquisition_par_statut on public.acquisition_opportunites (statut, updated_at desc);


-- ===========================================================================
-- 2. LES SOURCES D'UNE OPPORTUNITÉ
--
--    `collecte_le` et `type_source` ne sont pas décoratifs : une opportunité
--    vue une seule fois il y a huit mois dans un annuaire ne vaut pas la même
--    chose qu'une association dont un événement est paru la semaine dernière.
--    C'est le critère « actualité », et il se calcule d'ici.
-- ===========================================================================

create table if not exists public.acquisition_sources (
  id              bigint generated always as identity primary key,
  opportunite_id  uuid not null references public.acquisition_opportunites(id) on delete cascade,

  source          text not null,          -- identifiant de la source, listé dans task_permissions
  type_source     text not null default 'annuaire_public'
                  check (type_source in ('annuaire_public','donnee_ouverte','site_officiel',
                                         'agenda_public','donnee_autour','saisie_humaine')),
  url             text check (url is null or url ~ '^https?://'),
  intitule        text,
  extrait         jsonb not null default '{}'::jsonb,   -- les champs réellement lus
  collecte_le     timestamptz not null default now()
);

/* Une contrainte UNIQUE de table n'accepte pas d'expression : `coalesce` en
   fait une, parce qu'une source sans URL doit quand même se dédupliquer. D'où
   un index unique, qui les accepte. */
create unique index if not exists acquisition_sources_unicite
  on public.acquisition_sources (opportunite_id, source, coalesce(url, ''));

comment on table public.acquisition_sources is
  'Provenances d''une opportunité. Même philosophie qu''event_sources : on garde ce qu''on a lu et où, jamais « trouvé sur Internet ».';


-- ===========================================================================
-- 3. LA QUALIFICATION — six critères, chacun justifié
--
--    `methode` dit si la ligne vient d'une règle déterministe ou d'un modèle.
--    C'est ce qui permet de relire plus tard les seules conclusions qu'une
--    machine a formulée en langue naturelle, et de les vérifier en premier.
-- ===========================================================================

create table if not exists public.acquisition_qualifications (
  opportunite_id  uuid not null references public.acquisition_opportunites(id) on delete cascade,
  critere         text not null check (critere in ('pertinence','accessibilite','potentiel',
                                                   'cout','actualite','confiance')),
  niveau          text not null check (niveau in ('faible','moyen','eleve','inconnu')),

  /* LA COLONNE QUI JUSTIFIE TOUTE LA TABLE. NOT NULL, non vide : un critère
     sans phrase qui l'explique ne s'écrit pas. */
  pourquoi        text not null check (btrim(pourquoi) <> ''),

  -- le fait observé d'où sort la conclusion, et la source qui le porte
  fait_observe    text,
  source_id       bigint references public.acquisition_sources(id) on delete set null,

  methode         text not null default 'regle' check (methode in ('regle','modele','humain')),
  modele          text,
  evalue_le       timestamptz not null default now(),
  task_id         uuid references public.tasks(id) on delete set null,

  primary key (opportunite_id, critere)
);

comment on table public.acquisition_qualifications is
  'Une ligne par critère, `pourquoi` obligatoire. Remplace la note sur 100 : chaque conclusion se lit, se conteste et se rejoue.';


-- ===========================================================================
-- 4. LES CONTACTS PRÉPARÉS — et jamais envoyés
--
--    L'agent écrit ici avec `statut = 'attente_validation'` et rien d'autre.
--    Les états suivants demandent tous une décision humaine nommée : le CHECK
--    l'exige — pas d'approbation sans `decide_par`.
--
--    `envoye_le` est DÉCLARATIF. Autour n'envoie rien : c'est le fondateur qui
--    écrit, depuis sa propre boîte, et qui vient le dire ici pour que la mesure
--    du §19 ait un point de départ réel.
-- ===========================================================================

create table if not exists public.acquisition_contacts (
  id              uuid primary key default gen_random_uuid(),
  opportunite_id  uuid not null references public.acquisition_opportunites(id) on delete cascade,
  task_id         uuid references public.tasks(id) on delete set null,

  canal           text not null check (canal in ('email_public','formulaire_site',
                                                 'telephone_public','sur_place','reseau_public')),
  objet           text not null,
  message         text not null,

  /* Les faits utilisés pour personnaliser, avec leur source. C'est ce que
     l'écran de validation affiche à côté du message : on relit la proposition
     ET ce sur quoi elle s'appuie, pour que l'invention se voie. */
  faits_utilises  jsonb not null default '[]'::jsonb,

  statut          text not null default 'attente_validation'
                  check (statut in ('attente_validation','approuve','refuse','reporte',
                                    'envoye_par_humain','reponse_recue')),
  message_modifie text,

  decide_par      uuid references auth.users(id) on delete set null,
  decide_le       timestamptz,
  motif           text,
  reporte_a       timestamptz,

  envoye_le       timestamptz,
  reponse_le      timestamptz,
  reponse_notes   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- aucune sortie de « attente_validation » sans un humain qui signe
  constraint contact_decide_par_un_humain
    check (statut = 'attente_validation' or decide_par is not null)
);

comment on table public.acquisition_contacts is
  'Propositions de contact préparées par l''agent. Aucune n''est envoyée par Autour : `envoye_le` est déclaré par le fondateur après son propre envoi.';

create index if not exists contacts_a_valider
  on public.acquisition_contacts (created_at) where statut = 'attente_validation';


-- ===========================================================================
-- 5. L'HISTORIQUE D'UNE OPPORTUNITÉ
--
--    `par` nul veut dire « l'agent ». Un humain qui agit laisse son uid. La
--    fiche du §11 lit cette table de bas en haut.
-- ===========================================================================

create table if not exists public.acquisition_actions (
  id              bigint generated always as identity primary key,
  opportunite_id  uuid not null references public.acquisition_opportunites(id) on delete cascade,
  action          text not null,
  detail          text,
  par             uuid references auth.users(id) on delete set null,
  task_id         uuid references public.tasks(id) on delete set null,
  le              timestamptz not null default now()
);

create index if not exists acquisition_actions_fiche
  on public.acquisition_actions (opportunite_id, le desc);


-- ===========================================================================
-- 6. `updated_at`
-- ===========================================================================

create or replace function public.toucher_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists acquisition_opportunites_updated on public.acquisition_opportunites;
create trigger acquisition_opportunites_updated before update on public.acquisition_opportunites
  for each row execute function public.toucher_updated_at();

drop trigger if exists acquisition_contacts_updated on public.acquisition_contacts;
create trigger acquisition_contacts_updated before update on public.acquisition_contacts
  for each row execute function public.toucher_updated_at();


-- ===========================================================================
-- 7. LA VUE QUE L'ÉCRAN LIT
--
--    Les six critères sont rangés en lignes ; la liste et ses filtres ont
--    besoin de colonnes. Le pivot vit donc ici, dans une vue, et non dans des
--    colonnes recopiées sur l'opportunité — qui se désynchroniseraient de la
--    table de qualification à la première évaluation manquée.
--
--    `security_invoker` : la vue est lue avec les droits de l'appelant, donc à
--    travers la RLS des tables sous-jacentes. Sans ça, elle deviendrait un
--    contournement de la RLS pour qui connaît son nom.
-- ===========================================================================

create or replace view public.acquisition_vue
with (security_invoker = true) as
select
  o.*,
  q.pertinence, q.accessibilite, q.potentiel, q.cout, q.actualite, q.confiance,
  q.evalue_le,
  s.sources_nb,
  s.derniere_collecte,
  c.contacts_en_attente
from public.acquisition_opportunites o
left join lateral (
  select
    max(case when critere = 'pertinence'    then niveau end) as pertinence,
    max(case when critere = 'accessibilite' then niveau end) as accessibilite,
    max(case when critere = 'potentiel'     then niveau end) as potentiel,
    max(case when critere = 'cout'          then niveau end) as cout,
    max(case when critere = 'actualite'     then niveau end) as actualite,
    max(case when critere = 'confiance'     then niveau end) as confiance,
    max(evalue_le)                                           as evalue_le
  from public.acquisition_qualifications qq
  where qq.opportunite_id = o.id
) q on true
left join lateral (
  select count(*)::int as sources_nb, max(collecte_le) as derniere_collecte
  from public.acquisition_sources ss where ss.opportunite_id = o.id
) s on true
left join lateral (
  select count(*)::int as contacts_en_attente
  from public.acquisition_contacts cc
  where cc.opportunite_id = o.id and cc.statut = 'attente_validation'
) c on true;

comment on view public.acquisition_vue is
  'Les opportunités avec leurs six critères en colonnes, pour la liste et ses filtres. security_invoker : la RLS des tables sous-jacentes s''applique.';


-- ===========================================================================
-- 8. L'ENTONNOIR DU §19 — et ce qu'il refuse de prétendre mesurer
--
--    Les quatre premières étapes se comptent vraiment. Les trois dernières
--    dépendent d'un humain qui déclare ses envois, puis de données d'usage
--    qu'Autour n'a pas encore. Elles rendent NULL, et l'écran écrit
--    « Données insuffisantes » — pas zéro, qui se lirait comme un échec mesuré.
-- ===========================================================================

create or replace function public.acquisition_entonnoir()
returns table (
  etape           text,
  valeur          bigint,
  mesurable       boolean,
  pourquoi_pas    text
)
language sql
stable
security invoker
set search_path to ''
as $$
  select 'decouvertes', count(*), true, null::text
    from public.acquisition_opportunites
  union all
  select 'qualifiees', count(*), true, null
    from public.acquisition_opportunites
    where statut not in ('nouvelle','non_pertinente')
  union all
  select 'validees', count(*), true, null
    from public.acquisition_opportunites where statut in ('validee','contact_prepare','contacte','reponse','partenaire')
  union all
  select 'contacts_prepares', count(*), true, null
    from public.acquisition_contacts where statut <> 'refuse'
  union all
  select 'contacts_realises', count(*), count(*) > 0,
         case when count(*) = 0
              then 'Aucun envoi déclaré. Autour n''envoie rien : le compte part de ce que le fondateur déclare après avoir écrit.'
         end
    from public.acquisition_contacts where envoye_le is not null
  union all
  select 'reponses', count(*), exists(select 1 from public.acquisition_contacts where envoye_le is not null),
         case when not exists(select 1 from public.acquisition_contacts where envoye_le is not null)
              then 'Rien n''a encore été envoyé : un taux de réponse n''aurait pas de dénominateur.' end
    from public.acquisition_contacts where reponse_le is not null
  union all
  select 'partenariats', count(*), true, null
    from public.acquisition_opportunites where statut = 'partenaire'
  union all
  /* UTILISATEURS GÉNÉRÉS. Autour ne sait pas d'où vient un visiteur : il n'y a
     ni paramètre de campagne, ni table d'attribution, et `profiles` ne porte
     aucune origine. Rendre 0 serait un mensonge poli. */
  select 'utilisateurs_generes', null, false,
         'Autour ne mesure pas encore l''origine d''un visiteur : aucune attribution n''existe dans profiles ni ailleurs.';
$$;

comment on function public.acquisition_entonnoir() is
  'L''entonnoir d''acquisition. Les étapes non mesurables rendent NULL et disent pourquoi, plutôt qu''un zéro qui se lirait comme un résultat.';


-- ===========================================================================
-- 9. PRIVILÈGES
-- ===========================================================================

revoke all privileges on public.acquisition_opportunites   from anon, authenticated;
revoke all privileges on public.acquisition_sources        from anon, authenticated;
revoke all privileges on public.acquisition_qualifications from anon, authenticated;
revoke all privileges on public.acquisition_contacts       from anon, authenticated;
revoke all privileges on public.acquisition_actions        from anon, authenticated;
revoke all privileges on public.acquisition_vue            from anon, authenticated;

grant select, update on public.acquisition_opportunites   to authenticated;
grant select          on public.acquisition_sources        to authenticated;
grant select          on public.acquisition_qualifications to authenticated;
grant select, update  on public.acquisition_contacts       to authenticated;
grant select, insert  on public.acquisition_actions        to authenticated;
grant select          on public.acquisition_vue            to authenticated;

revoke all privileges on function public.acquisition_entonnoir() from public, anon;
grant execute on function public.acquisition_entonnoir() to authenticated, service_role;

alter table public.acquisition_opportunites   enable row level security;
alter table public.acquisition_sources        enable row level security;
alter table public.acquisition_qualifications enable row level security;
alter table public.acquisition_contacts       enable row level security;
alter table public.acquisition_actions        enable row level security;

drop policy if exists acquisition_opportunites_operateur on public.acquisition_opportunites;
create policy acquisition_opportunites_operateur on public.acquisition_opportunites
  for select to authenticated using (public.est_operateur());

-- l'opérateur range : statut, prochaine action, notes. Il ne réécrit pas les
-- faits collectés — ils appartiennent à leurs sources.
drop policy if exists acquisition_opportunites_maj on public.acquisition_opportunites;
create policy acquisition_opportunites_maj on public.acquisition_opportunites
  for update to authenticated
  using (public.est_operateur()) with check (public.est_operateur());

drop policy if exists acquisition_sources_operateur on public.acquisition_sources;
create policy acquisition_sources_operateur on public.acquisition_sources
  for select to authenticated using (public.est_operateur());

drop policy if exists acquisition_qualifications_operateur on public.acquisition_qualifications;
create policy acquisition_qualifications_operateur on public.acquisition_qualifications
  for select to authenticated using (public.est_operateur());

drop policy if exists acquisition_contacts_operateur on public.acquisition_contacts;
create policy acquisition_contacts_operateur on public.acquisition_contacts
  for select to authenticated using (public.est_operateur());

/* L'ÉCRAN DE VALIDATION. L'opérateur décide, et son uid est écrit dans
   `decide_par` par la policy elle-même — pas par le client, qui pourrait y
   mettre quelqu'un d'autre. Le CHECK de la table refuse déjà tout état décidé
   sans humain nommé ; celui-ci refuse en plus de signer à la place d'autrui. */
drop policy if exists acquisition_contacts_decision on public.acquisition_contacts;
create policy acquisition_contacts_decision on public.acquisition_contacts
  for update to authenticated
  using (public.est_operateur())
  with check (public.est_operateur()
              and (statut = 'attente_validation' or decide_par = (select auth.uid())));

drop policy if exists acquisition_actions_operateur on public.acquisition_actions;
create policy acquisition_actions_operateur on public.acquisition_actions
  for select to authenticated using (public.est_operateur());

drop policy if exists acquisition_actions_humain on public.acquisition_actions;
create policy acquisition_actions_humain on public.acquisition_actions
  for insert to authenticated
  with check (public.est_operateur() and par = (select auth.uid()));
