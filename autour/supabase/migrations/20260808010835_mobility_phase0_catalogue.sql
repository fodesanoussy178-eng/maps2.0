-- ---------------------------------------------------------------------------
-- Mobilité — phase 0 : catalogue national et traçabilité des synchronisations
-- Voir autour/supabase/migrations/20260807120000_mobility_phase0_catalogue.sql
-- ---------------------------------------------------------------------------

create table if not exists public.mobility_datasets (
  id               bigint generated always as identity primary key,
  pan_id           text        not null unique,
  slug             text,
  title            text        not null,
  data_type        text        not null,
  formats          text[]      not null default '{}',
  licence          text,
  publisher        text,
  aom_siren        text,
  aom_name         text,
  national         boolean     not null default false,
  page_url         text,
  resources        jsonb       not null default '[]'::jsonb,
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

create table if not exists public.mobility_coverage (
  id           bigint generated always as identity primary key,
  dataset_id   bigint      not null
                 references public.mobility_datasets (id) on delete cascade,
  area_name    text,
  area_type    text,
  insee_code   text,
  siren        text,
  source       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mobility_coverage is
  'Territoires couverts par un jeu de données. geom peut être nul : le catalogue ne fournit pas toujours de contour, et on n''en invente pas.';

create index if not exists mobility_coverage_dataset_idx
  on public.mobility_coverage (dataset_id);
create index if not exists mobility_coverage_insee_idx
  on public.mobility_coverage (insee_code) where insee_code is not null;

create unique index if not exists mobility_coverage_unique_area_idx
  on public.mobility_coverage (dataset_id, coalesce(insee_code, ''), coalesce(area_name, ''));

create table if not exists public.mobility_sync_runs (
  id                  bigint generated always as identity primary key,
  source              text        not null default 'transport.data.gouv.fr',
  scope               text,
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

-- Colonnes géométriques + index GiST : schéma PostGIS détecté, jamais codé en dur
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

  execute format(
    'alter table public.mobility_coverage
       add column if not exists geom %I.geometry(MultiPolygon, 4326)',
    postgis_schema);

  execute format(
    'create index if not exists mobility_coverage_geom_gist
       on public.mobility_coverage using gist (geom %I.gist_geometry_ops_2d)',
    postgis_schema);
end
$$;

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

grant select on public.mobility_datasets to anon, authenticated;
grant select on public.mobility_coverage to anon, authenticated;
revoke all on public.mobility_sync_runs from anon, authenticated;
