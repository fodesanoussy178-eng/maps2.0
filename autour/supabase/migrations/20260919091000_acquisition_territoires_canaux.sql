-- ---------------------------------------------------------------------------
-- ACQUISITION V2 — territoires, canaux de contact, septième critère
--
-- POURQUOI UNE TABLE DE TERRITOIRES DE PLUS, ALORS QUE `territories` EXISTE
--
-- `public.territories` existe, porte 61 lignes, et c'est la table des
-- TERRITOIRES DE SYNCHRONISATION : elle dit où Autour va chercher des
-- événements, avec quelles sources, et `last_synced_at` veut dire « dernière
-- synchronisation d'agenda ». La remplir de « Bruxelles, expérimental,
-- acquisition » ferait croire au moteur territorial qu'il doit y synchroniser
-- des événements, et `last_synced_at` cesserait de vouloir dire une seule
-- chose — c'est exactement le genre de colonne à deux sens qui finit par
-- casser un pipeline qu'on ne regardait pas.
--
-- `acquisition_territoires` ne recopie donc RIEN : ni coordonnées, ni fuseau,
-- ni rayon. Elle POINTE vers `territories` quand le territoire y existe déjà
-- (`territory_id`), et elle porte uniquement ce que l'acquisition a besoin de
-- savoir et que l'autre table ignore : une priorité, un état de couverture,
-- une date de dernière recherche, un intervalle, une langue, une raison de
-- test. Un territoire international n'a pas de ligne dans `territories`, et
-- c'est normal : Autour n'y sert aucun événement.
--
--
-- LA MÉMOIRE, ET CE QU'ELLE ÉVITE
--
-- `derniere_recherche` + `intervalle` donnent `prochaine_recherche`. L'agent
-- lit cette colonne AVANT de travailler : un territoire balayé il y a trois
-- jours n'est pas rebalayé, et la tâche se termine en disant « déjà examiné
-- récemment » plutôt qu'en refaisant cent requêtes pour le même résultat.
-- C'est la mesure d'économie la plus efficace du système, et elle ne coûte
-- rien.
--
--
-- LES CANAUX : LE VRAI GOULOT, MESURÉ
--
-- La première mission a produit 358 opportunités dont 247 qualifiées sans
-- aucun canal de contact. Ce n'était pas une fatalité, c'était une étape
-- manquante : personne n'était allé CHERCHER le canal. `acquisition_canaux`
-- est la table de cette étape — une ligne par canal trouvé, avec sa source,
-- sa date de vérification et sa confiance, et une ligne « non_trouve » quand
-- la recherche a eu lieu et n'a rien donné. La différence entre « pas encore
-- cherché » et « cherché, rien trouvé » est la seule qui permette de ne pas
-- recommencer indéfiniment.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. LES TERRITOIRES D'ACQUISITION
-- ===========================================================================

create table if not exists public.acquisition_territoires (
  id            bigint generated always as identity primary key,
  slug          text not null unique check (slug ~ '^[a-z]{2}-[a-z0-9-]{2,40}$'),
  nom           text not null,

  pays          text not null default 'FR' check (pays ~ '^[A-Z]{2}$'),
  region        text,
  ville         text,
  langue        text not null default 'fr' check (langue ~ '^[a-z]{2}$'),

  -- ce que le territoire couvre : une ville, une métropole, une région, un pays
  portee        text not null default 'ville'
                check (portee in ('ville','metropole','region','pays')),

  -- LE LIEN, PAS LA COPIE
  territory_id  bigint references public.territories(id) on delete set null,
  zone_id       text   references public.autour_zones(zone_id),

  priorite      integer not null default 100,
  statut        text not null default 'a_explorer'
                check (statut in ('a_explorer','en_cours','couvert','experimental','suspendu')),

  derniere_recherche  timestamptz,
  intervalle          interval not null default interval '30 days',
  /* PAS DE COLONNE GÉNÉRÉE ICI. `timestamptz + interval` n'est pas immutable
     pour Postgres — un intervalle en mois ou en jours dépend du fuseau — et il
     refuse donc de la stocker (42P17). L'échéance se calcule à la LECTURE, là
     où elle sert : `acquisition_couverture()` et la requête de l'agent. La
     source de vérité reste `derniere_recherche` + `intervalle`. */

  sources_disponibles text[] not null default '{}'::text[],
  couverture    text not null default 'aucune'
                check (couverture in ('aucune','partielle','bonne','inconnue')),
  confiance     text not null default 'inconnu'
                check (confiance in ('faible','moyen','eleve','inconnu')),

  -- pourquoi ce territoire est testé. Obligatoire hors de France : un test
  -- international sans raison écrite est une dépense sans hypothèse.
  raison_du_test text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint international_avec_raison
    check (pays = 'FR' or coalesce(btrim(raison_du_test), '') <> '')
);

comment on table public.acquisition_territoires is
  'Couverture d''acquisition par territoire. Distincte de `territories`, qui dit où Autour synchronise des événements : ici on ne recopie rien, on pointe.';

comment on column public.acquisition_territoires.intervalle is
  'Délai avant de rebalayer. Avec `derniere_recherche`, il donne l''échéance que l''agent lit avant de travailler : un territoire balayé récemment n''est pas rebalayé.';

create index if not exists acquisition_territoires_a_faire
  on public.acquisition_territoires (priorite, derniere_recherche nulls first)
  where statut in ('a_explorer','en_cours','experimental');


-- ===========================================================================
-- 2. LES CANAUX DE CONTACT
-- ===========================================================================

create table if not exists public.acquisition_canaux (
  id             bigint generated always as identity primary key,
  opportunite_id uuid not null references public.acquisition_opportunites(id) on delete cascade,

  type           text not null
                 check (type in ('site_officiel','page_contact','email_public','formulaire',
                                 'page_partenaire','page_evenement','reseau_public',
                                 'page_institutionnelle','telephone_public')),
  /* L'URL ou l'adresse, telle qu'elle est publiée. `statut = 'non_trouve'`
     autorise la valeur vide : c'est le seul cas où l'on enregistre l'absence. */
  valeur         text not null default '',

  source         text not null,
  url_source     text check (url_source is null or url_source ~ '^https?://'),
  type_source    text not null default 'site_officiel'
                 check (type_source in ('annuaire_public','donnee_ouverte','site_officiel',
                                        'agenda_public','donnee_autour','saisie_humaine')),

  verifie_le     timestamptz not null default now(),
  confiance      text not null default 'moyen'
                 check (confiance in ('faible','moyen','eleve')),
  statut         text not null default 'trouve'
                 check (statut in ('trouve','non_trouve','invalide')),
  notes          text,

  constraint canal_trouve_a_une_valeur
    check (statut <> 'trouve' or btrim(valeur) <> '')
);

create unique index if not exists acquisition_canaux_unicite
  on public.acquisition_canaux (opportunite_id, type, valeur);

comment on table public.acquisition_canaux is
  'Canaux de contact publics trouvés par opportunité. Une ligne `non_trouve` dit « cherché, rien trouvé » — ce qui n''est pas la même chose que « pas encore cherché ».';

/* Savoir qu'on a DÉJÀ cherché. Sans cette colonne, chaque exécution
   recommencerait la recherche de canal sur les mêmes 247 opportunités. */
alter table public.acquisition_opportunites
  add column if not exists canal_cherche_le timestamptz,
  add column if not exists pays             text not null default 'FR',
  add column if not exists region           text,
  add column if not exists territoire_id    bigint references public.acquisition_territoires(id) on delete set null,
  add column if not exists raison_pertinence text;

comment on column public.acquisition_opportunites.raison_pertinence is
  'Pourquoi CETTE structure peut servir Autour — écrit à partir de faits observés. Un incubateur n''est pas pertinent parce qu''il est un incubateur.';


-- ===========================================================================
-- 3. LE SEPTIÈME CRITÈRE : la facilité de contact
--
--    Distincte de l'accessibilité. « Accessibilité » dit s'il existe une porte ;
--    « facilité de contact » dit ce qu'il en coûte de la pousser — un e-mail
--    public n'est pas un formulaire web, qui n'est pas « passer sur place ».
-- ===========================================================================

alter table public.acquisition_qualifications
  drop constraint if exists acquisition_qualifications_critere_check;

alter table public.acquisition_qualifications
  add constraint acquisition_qualifications_critere_check
  check (critere in ('pertinence','accessibilite','potentiel','cout',
                     'actualite','confiance','facilite_contact'));


-- ===========================================================================
-- 4. LA VUE, REFAITE (elle fige sa liste de colonnes à la création)
-- ===========================================================================

drop view if exists public.acquisition_vue;

create view public.acquisition_vue
with (security_invoker = true) as
select
  o.*,
  t.slug as territoire_slug, t.nom as territoire_nom, t.statut as territoire_statut,
  q.pertinence, q.accessibilite, q.potentiel, q.cout, q.actualite, q.confiance,
  q.facilite_contact, q.evalue_le,
  s.sources_nb, s.derniere_collecte,
  c.contacts_en_attente,
  k.canaux_nb, k.canal_principal, k.canal_type, k.canal_verifie_le
from public.acquisition_opportunites o
left join public.acquisition_territoires t on t.id = o.territoire_id
left join lateral (
  select
    max(case when critere = 'pertinence'       then niveau end) as pertinence,
    max(case when critere = 'accessibilite'    then niveau end) as accessibilite,
    max(case when critere = 'potentiel'        then niveau end) as potentiel,
    max(case when critere = 'cout'             then niveau end) as cout,
    max(case when critere = 'actualite'        then niveau end) as actualite,
    max(case when critere = 'confiance'        then niveau end) as confiance,
    max(case when critere = 'facilite_contact' then niveau end) as facilite_contact,
    max(evalue_le)                                              as evalue_le
  from public.acquisition_qualifications qq where qq.opportunite_id = o.id
) q on true
left join lateral (
  select count(*)::int as sources_nb, max(collecte_le) as derniere_collecte
  from public.acquisition_sources ss where ss.opportunite_id = o.id
) s on true
left join lateral (
  select count(*)::int as contacts_en_attente
  from public.acquisition_contacts cc
  where cc.opportunite_id = o.id and cc.statut = 'attente_validation'
) c on true
left join lateral (
  /* Le canal principal : le plus direct d'abord. Un e-mail public vaut mieux
     qu'un formulaire, qui vaut mieux qu'une page d'accueil. */
  select count(*) filter (where statut = 'trouve')::int as canaux_nb,
         (array_agg(valeur order by case type
            when 'email_public' then 1 when 'formulaire' then 2
            when 'page_contact' then 3 when 'page_partenaire' then 4
            when 'site_officiel' then 5 else 6 end)
          filter (where statut = 'trouve'))[1] as canal_principal,
         (array_agg(type order by case type
            when 'email_public' then 1 when 'formulaire' then 2
            when 'page_contact' then 3 when 'page_partenaire' then 4
            when 'site_officiel' then 5 else 6 end)
          filter (where statut = 'trouve'))[1] as canal_type,
         max(verifie_le) as canal_verifie_le
  from public.acquisition_canaux kk where kk.opportunite_id = o.id
) k on true;

comment on view public.acquisition_vue is
  'Les opportunités avec leurs critères en colonnes, leur territoire et leur canal principal. security_invoker : la RLS des tables sous-jacentes s''applique.';


-- ===========================================================================
-- 5. L'ENTONNOIR, AVEC L'ÉTAPE « CANAL TROUVÉ » QUI MANQUAIT
-- ===========================================================================

create or replace function public.acquisition_entonnoir()
returns table (etape text, valeur bigint, mesurable boolean, pourquoi_pas text)
language sql stable security invoker set search_path to ''
as $$
  select 'decouvertes', count(*), true, null::text from public.acquisition_opportunites
  union all
  select 'qualifiees', count(*), true, null from public.acquisition_opportunites
    where statut not in ('nouvelle','non_pertinente')
  union all
  select 'canal_trouve', count(distinct opportunite_id), true, null
    from public.acquisition_canaux where statut = 'trouve'
  union all
  select 'contact_prepare', count(*), true, null
    from public.acquisition_contacts where statut <> 'refuse'
  union all
  select 'validation_humaine', count(*), true, null
    from public.acquisition_contacts where statut in ('approuve','envoye_par_humain','reponse_recue')
  union all
  select 'contact_humain', count(*), count(*) > 0,
         case when count(*) = 0 then 'Aucun envoi déclaré. Autour n''envoie rien : le compte part de ce que le fondateur déclare après avoir écrit.' end
    from public.acquisition_contacts where envoye_le is not null
  union all
  select 'reponses', count(*), exists(select 1 from public.acquisition_contacts where envoye_le is not null),
         case when not exists(select 1 from public.acquisition_contacts where envoye_le is not null)
              then 'Rien n''a encore été envoyé : un taux de réponse n''aurait pas de dénominateur.' end
    from public.acquisition_contacts where reponse_le is not null
  union all
  select 'partenaires', count(*), true, null
    from public.acquisition_opportunites where statut = 'partenaire'
  union all
  select 'utilisateurs_generes', null, false,
         'Autour ne mesure pas encore l''origine d''un visiteur : aucune attribution n''existe dans profiles ni ailleurs.';
$$;


-- ===========================================================================
-- 6. LA COUVERTURE PAR TERRITOIRE, pour l'écran Territoires
-- ===========================================================================

create or replace function public.acquisition_couverture()
returns table (
  slug text, nom text, pays text, portee text, statut text, priorite integer,
  couverture text, derniere_recherche timestamptz, prochaine_recherche timestamptz,
  a_revoir boolean, opportunites bigint, qualifiees bigint, avec_canal bigint
)
language sql stable security invoker set search_path to ''
as $$
  select t.slug, t.nom, t.pays, t.portee, t.statut, t.priorite, t.couverture,
         t.derniere_recherche,
         (t.derniere_recherche + t.intervalle) as prochaine_recherche,
         (t.derniere_recherche is null or t.derniere_recherche + t.intervalle <= now()) as a_revoir,
         count(o.id) as opportunites,
         count(o.id) filter (where o.statut not in ('nouvelle','non_pertinente')) as qualifiees,
         count(distinct k.opportunite_id) as avec_canal
  from public.acquisition_territoires t
  left join public.acquisition_opportunites o on o.territoire_id = t.id
  left join public.acquisition_canaux k on k.opportunite_id = o.id and k.statut = 'trouve'
  group by t.id, t.slug, t.nom, t.pays, t.portee, t.statut, t.priorite, t.couverture,
           t.derniere_recherche, t.intervalle
  order by t.priorite, t.nom;
$$;


-- ===========================================================================
-- 7. PRIVILÈGES
-- ===========================================================================

revoke all privileges on public.acquisition_territoires from anon, authenticated;
revoke all privileges on public.acquisition_canaux      from anon, authenticated;
revoke all privileges on public.acquisition_vue         from anon, authenticated;

grant select, insert, update on public.acquisition_territoires to authenticated;
grant select                 on public.acquisition_canaux      to authenticated;
grant select                 on public.acquisition_vue         to authenticated;

alter table public.acquisition_territoires enable row level security;
alter table public.acquisition_canaux      enable row level security;

drop policy if exists acquisition_territoires_operateur on public.acquisition_territoires;
create policy acquisition_territoires_operateur on public.acquisition_territoires
  for select to authenticated using (public.est_operateur());

drop policy if exists acquisition_territoires_maj on public.acquisition_territoires;
create policy acquisition_territoires_maj on public.acquisition_territoires
  for update to authenticated using (public.est_operateur()) with check (public.est_operateur());

drop policy if exists acquisition_territoires_creation on public.acquisition_territoires;
create policy acquisition_territoires_creation on public.acquisition_territoires
  for insert to authenticated with check (public.est_operateur());

drop policy if exists acquisition_canaux_operateur on public.acquisition_canaux;
create policy acquisition_canaux_operateur on public.acquisition_canaux
  for select to authenticated using (public.est_operateur());

revoke all privileges on function public.acquisition_couverture() from public, anon;
grant execute on function public.acquisition_couverture() to authenticated, service_role;

drop trigger if exists acquisition_territoires_updated on public.acquisition_territoires;
create trigger acquisition_territoires_updated before update on public.acquisition_territoires
  for each row execute function public.toucher_updated_at();
