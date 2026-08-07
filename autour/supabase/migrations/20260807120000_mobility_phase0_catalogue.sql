-- ---------------------------------------------------------------------------
-- Mobilité — phase 0 : catalogue national et traçabilité des synchronisations
--
-- Périmètre volontairement restreint : on enregistre QUELS jeux de données
-- existent et OÙ ils s'appliquent. Aucun horaire GTFS, aucun aménagement
-- cyclable, aucun flux GBFS n'est importé ici — ces tables viendront avec
-- leurs propres migrations, une fois le catalogue validé.
--
-- Note d'installation PostGIS (vérifiée sur le projet, ne pas « corriger ») :
-- l'extension postgis de ce projet est installée dans le schéma `topology`
-- (c'est pourquoi topology.postgis_full_version() répond), et `topology`
-- n'est PAS dans le search_path par défaut — to_regtype('geometry') renvoie
-- null. Une colonne déclarée `geometry(...)` échouerait donc ici.
-- Les colonnes géométriques et l'index GiST sont créés en SQL dynamique
-- après détection du schéma réel de l'extension : la migration reste valable
-- si PostGIS est un jour déplacé (public, extensions, gis…).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Jeux de données du Point d'Accès National
-- ---------------------------------------------------------------------------
create table if not exists public.mobility_datasets (
  id               bigint generated always as identity primary key,

  -- identifiant stable côté transport.data.gouv.fr : c'est lui qui fait foi
  -- pour la réconciliation, jamais le titre qui peut changer
  pan_id           text        not null unique,
  slug             text,
  title            text        not null,

  -- public-transit | bike-data | gbfs | cycling | road-data …
  -- laissé en texte libre : le vocabulaire du PAN évolue plus vite qu'un enum
  data_type        text        not null,
  formats          text[]      not null default '{}',

  -- la licence n'est pas décorative : elle conditionne le droit de servir la
  -- donnée et alimente l'écran de crédits. Un dataset sans licence lue ne
  -- doit pas être exploité.
  licence          text,
  publisher        text,

  -- autorité organisatrice de la mobilité, quand le PAN la rattache
  aom_siren        text,
  aom_name         text,
  national         boolean     not null default false,

  page_url         text,

  -- liste brute des ressources (URL, format, type temps réel…). Conservée en
  -- jsonb tant que l'import de flux n'existe pas : on n'invente pas un schéma
  -- de ressources avant d'avoir observé les vraies réponses de l'API.
  resources        jsonb       not null default '[]'::jsonb,

  -- payload complet tel que reçu : garantit qu'aucune information n'est perdue
  -- si notre normalisation se révèle incomplète
  raw              jsonb,

  pan_updated_at   timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.mobility_datasets is
  'Catalogue des jeux de données transport découverts sur transport.data.gouv.fr. Phase 0 : découverte seule, aucun flux importé.';
comment on column public.mobility_datasets.licence is
  'Licence déclarée par le producteur. Jamais supposée : un dataset sans licence lue ne doit pas être servi.';
comment on column public.mobility_datasets.raw is
  'Payload PAN intégral, conservé pour pouvoir renormaliser sans re-télécharger.';

create index if not exists mobility_datasets_data_type_idx
  on public.mobility_datasets (data_type);
create index if not exists mobility_datasets_aom_siren_idx
  on public.mobility_datasets (aom_siren) where aom_siren is not null;

-- ---------------------------------------------------------------------------
-- 2. Couverture géographique
--
-- Table séparée et non colonne : un jeu de données peut couvrir plusieurs
-- territoires (plusieurs communes, plusieurs AOM), et c'est cette table qui
-- répondra plus tard à « quels réseaux couvrent ce point ? ».
--
-- `geom` est nullable À DESSEIN : le catalogue ne publie pas toujours une
-- géométrie. On enregistre alors le territoire par son nom et son code INSEE
-- plutôt que d'inventer un contour.
-- ---------------------------------------------------------------------------
create table if not exists public.mobility_coverage (
  id           bigint generated always as identity primary key,
  dataset_id   bigint      not null
                 references public.mobility_datasets (id) on delete cascade,
  area_name    text,
  area_type    text,          -- commune | epci | departement | region | pays
  insee_code   text,
  siren        text,
  -- geom : ajoutée plus bas, en SQL dynamique (voir la note PostGIS en tête)
  source       text,          -- d'où vient la géométrie, quand il y en a une
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mobility_coverage is
  'Territoires couverts par un jeu de données. geom peut être nul : le catalogue ne fournit pas toujours de contour, et on n''en invente pas.';

create index if not exists mobility_coverage_dataset_idx
  on public.mobility_coverage (dataset_id);
create index if not exists mobility_coverage_insee_idx
  on public.mobility_coverage (insee_code) where insee_code is not null;

-- une même zone ne doit pas être insérée deux fois pour le même dataset
create unique index if not exists mobility_coverage_unique_area_idx
  on public.mobility_coverage (dataset_id, coalesce(insee_code, ''), coalesce(area_name, ''));

-- ---------------------------------------------------------------------------
-- 3. Journal des synchronisations
--
-- « Journaliser les erreurs par provider » : sans cette table, un catalogue
-- silencieusement obsolète est indétectable. Elle sert aussi à afficher la
-- date de dernière mise à jour exigée côté produit.
-- ---------------------------------------------------------------------------
create table if not exists public.mobility_sync_runs (
  id                  bigint generated always as identity primary key,
  source              text        not null default 'transport.data.gouv.fr',
  scope               text,        -- périmètre demandé (ex. « mel »)
  status              text        not null default 'running'
                        check (status in ('running','success','partial','error')),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  duration_ms         integer,

  datasets_seen       integer     not null default 0,
  datasets_upserted   integer     not null default 0,
  coverage_upserted   integer     not null default 0,

  http_status         integer,
  error               text,
  details             jsonb       not null default '{}'::jsonb
);

comment on table public.mobility_sync_runs is
  'Journal d''exécution des synchronisations de catalogue : sans lui, un catalogue obsolète passe inaperçu.';

create index if not exists mobility_sync_runs_started_idx
  on public.mobility_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- 4. Colonnes géométriques + index spatial GiST
--
-- Détection du schéma réel de PostGIS, puis SQL dynamique. Rien n'est
-- codé en dur : ni `public`, ni `gis`, ni `topology`.
-- ---------------------------------------------------------------------------
do $$
declare
  postgis_schema text;
begin
  select n.nspname
    into postgis_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'postgis';

  if postgis_schema is null then
    raise exception
      'PostGIS est introuvable : extension « postgis » non installée. '
      'Cette migration ne l''installe pas volontairement.';
  end if;

  raise notice 'PostGIS détecté dans le schéma %', postgis_schema;

  -- MultiPolygon : un territoire peut être discontinu (enclaves, îles)
  execute format(
    'alter table public.mobility_coverage
       add column if not exists geom %I.geometry(MultiPolygon, 4326)',
    postgis_schema);

  -- La classe d'opérateurs est qualifiée explicitement : elle vit dans le
  -- schéma de l'extension, qui n'est pas forcément dans le search_path.
  execute format(
    'create index if not exists mobility_coverage_geom_gist
       on public.mobility_coverage using gist (geom %I.gist_geometry_ops_2d)',
    postgis_schema);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Fraîcheur : updated_at tenu par la base, pas par l'appelant
-- ---------------------------------------------------------------------------
create or replace function public.mobility_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mobility_datasets_touch on public.mobility_datasets;
create trigger mobility_datasets_touch
  before update on public.mobility_datasets
  for each row execute function public.mobility_touch_updated_at();

drop trigger if exists mobility_coverage_touch on public.mobility_coverage;
create trigger mobility_coverage_touch
  before update on public.mobility_coverage
  for each row execute function public.mobility_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--
-- Verrouillage par défaut. Le catalogue et les couvertures sont de la donnée
-- publique ouverte : lecture pour tous. Les écritures n'ont AUCUNE policy —
-- elles passent exclusivement par la clé de service (qui contourne la RLS),
-- donc par l'Edge Function. Le journal de synchronisation est opérationnel :
-- il ne se lit pas depuis le navigateur.
-- ---------------------------------------------------------------------------
alter table public.mobility_datasets  enable row level security;
alter table public.mobility_coverage  enable row level security;
alter table public.mobility_sync_runs enable row level security;

drop policy if exists "mobility_datasets: lecture publique" on public.mobility_datasets;
create policy "mobility_datasets: lecture publique"
  on public.mobility_datasets for select
  to anon, authenticated
  using (true);

drop policy if exists "mobility_coverage: lecture publique" on public.mobility_coverage;
create policy "mobility_coverage: lecture publique"
  on public.mobility_coverage for select
  to anon, authenticated
  using (true);

-- mobility_sync_runs : aucune policy, donc aucun accès anon/authenticated.
-- Seule la clé de service peut lire et écrire ce journal.

grant select on public.mobility_datasets to anon, authenticated;
grant select on public.mobility_coverage to anon, authenticated;
revoke all on public.mobility_sync_runs from anon, authenticated;
