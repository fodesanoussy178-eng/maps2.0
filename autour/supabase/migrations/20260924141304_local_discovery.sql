-- ---------------------------------------------------------------------------
-- CE SCHÉMA EXISTAIT EN PRODUCTION SANS EXISTER DANS LE DÉPÔT
--
-- Les trois tables de la découverte locale, la fonction d'invocation privée et
-- la surface publique `local_discovery_nearby` ont été appliquées le
-- 24/09/2026 (versions 20260924141304 et 20260924141809 du registre), mais
-- aucun fichier ne les décrivait ici. Une base reconstruite depuis ce dépôt
-- n'aurait donc pas eu de quoi faire tourner la fonction Edge
-- `local-discovery`, qui est déployée et qui écrit dans ces tables.
--
-- Ce fichier est la copie EXACTE de ce qui est appliqué en production, relue
-- depuis `supabase_migrations.schema_migrations`. Il ne change rien à la base :
-- tout y est `if not exists` ou `create or replace`. Il rétablit seulement la
-- parité entre ce qui tourne et ce qui est écrit — la même leçon que la
-- fonction Edge elle-même, récupérée de la production faute de source.
--
-- Le numéro de version reprend celui du registre pour qu'un `db push` ne
-- rejoue pas ce qui est déjà là.
-- ---------------------------------------------------------------------------

-- Découverte locale vérifiable. Les pistes Web vivent séparément du catalogue
-- jusqu'à validation ; seules les fiches verified/probable peuvent être publiées.

create table if not exists public.local_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  territory text not null,
  insee_code text,
  universe text not null default 'solidarity',
  category text not null,
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  sources_queried text[] not null default '{}',
  web_search_used boolean not null default false,
  queries text[] not null default '{}',
  candidates_count integer not null default 0,
  new_count integer not null default 0,
  duplicate_count integer not null default 0,
  updated_count integer not null default 0,
  uncertain_count integer not null default 0,
  rejected_count integer not null default 0,
  ai_cost_eur numeric(12,6) not null default 0,
  error text,
  next_verification_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.local_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.local_discovery_runs(id) on delete cascade,
  place_id uuid references public.places(id) on delete set null,
  name text not null,
  name_normalized text not null,
  address text,
  postal_code text,
  city text not null,
  lat double precision,
  lng double precision,
  phone text,
  official_url text,
  service_categories text[] not null default '{}',
  source_url text not null,
  source_domain text not null,
  source_type text not null check (source_type in
    ('official_structure','official_government','institutional','public_directory','data_partner','credible_secondary','lead_only')),
  official_source boolean not null default false,
  source_fingerprint text not null,
  discovered_at timestamptz not null default now(),
  last_verified_at timestamptz,
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  verification_status text not null check (verification_status in ('verified','probable','candidate','uncertain','rejected')),
  identity_evidence numeric(4,3) not null default 0,
  service_evidence numeric(4,3) not null default 0,
  evidence jsonb not null default '[]',
  rejection_reason text,
  entity_status text not null default 'unknown' check (entity_status in ('active','temporarily_closed','unknown','inactive')),
  reopens_at timestamptz,
  closure_reason text,
  next_distribution_at timestamptz,
  raw_data jsonb not null default '{}',
  unique (source_fingerprint)
);

create table if not exists public.local_coverage (
  territory text not null,
  insee_code text,
  universe text not null,
  category text not null,
  known_count integer not null default 0,
  verified_count integer not null default 0,
  source_count integer not null default 0,
  source_failures integer not null default 0,
  coverage_status text not null default 'unknown' check (coverage_status in ('adequate','incomplete','unknown')),
  coverage_score numeric(4,3) not null default 0,
  last_checked_at timestamptz not null default now(),
  discovery_requested_at timestamptz,
  next_check_at timestamptz,
  primary key (territory, universe, category)
);

create index if not exists local_discovery_candidates_city_category_idx
  on public.local_discovery_candidates (city, verification_status);
create index if not exists local_discovery_candidates_place_idx
  on public.local_discovery_candidates (place_id) where place_id is not null;
create index if not exists local_discovery_runs_recent_idx
  on public.local_discovery_runs (started_at desc);

alter table public.local_discovery_runs enable row level security;
alter table public.local_discovery_candidates enable row level security;
alter table public.local_coverage enable row level security;
revoke all on public.local_discovery_runs, public.local_discovery_candidates, public.local_coverage from anon, authenticated;
grant select on public.local_discovery_runs, public.local_discovery_candidates, public.local_coverage to authenticated;

create policy local_discovery_runs_operator on public.local_discovery_runs
  for select to authenticated using (public.est_operateur());
create policy local_discovery_candidates_operator on public.local_discovery_candidates
  for select to authenticated using (public.est_operateur());
create policy local_coverage_operator on public.local_coverage
  for select to authenticated using (public.est_operateur());

insert into public.agents (slug, nom, mission) values
  ('local_discovery', 'Découverte locale',
   'Détecter les trous de couverture, découvrir des structures sur le Web, vérifier leurs preuves et alimenter le catalogue local.')
on conflict (slug) do update set nom=excluded.nom, mission=excluded.mission, maj_le=now();

insert into public.task_permissions
  (agent,type,libelle,lecture_externe,ecriture_interne,contact_externe,validation_humaine,cout_max_eur,sources_autorisees,notes)
values
  ('local_discovery','local_discovery_scan','Découvrir les structures manquantes d’un territoire',
   true,true,false,false,0.15,
   array['autour_places','osm_overpass','data_inclusion','service_public','google_search'],
   'La recherche Web produit des pistes. Une preuve officielle ou institutionnelle est requise avant publication comme fait vérifié.')
on conflict (agent,type) do update set
  libelle=excluded.libelle, lecture_externe=excluded.lecture_externe,
  ecriture_interne=excluded.ecriture_interne, contact_externe=excluded.contact_externe,
  validation_humaine=excluded.validation_humaine, cout_max_eur=excluded.cout_max_eur,
  sources_autorisees=excluded.sources_autorisees, notes=excluded.notes, actif=true;

comment on table public.local_discovery_candidates is
  'Pistes Web et preuves par établissement. Une candidate/uncertain ne constitue jamais un fait publié.';

create or replace function private.invoke_local_discovery(p_task_id uuid default null)
returns bigint
language plpgsql security definer set search_path to ''
as $$
declare request_id bigint; base_url text; secret text; endpoint text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name='event_sync_secret' limit 1;
  if secret is null then raise exception 'event_sync_secret absent du Vault'; end if;
  base_url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/local-discovery';
  endpoint := base_url || case when p_task_id is null then '' else '?id=' || p_task_id::text end;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',secret),body:='{}'::jsonb)
    into request_id;
  return request_id;
end;
$$;
revoke all on function private.invoke_local_discovery(uuid) from public, anon, authenticated;
grant execute on function private.invoke_local_discovery(uuid) to service_role;

-- Surface publique minimale : seules les fiches dont la preuve a franchi le
-- seuil de publication sont lisibles. Les citations, prompts et pistes
-- rejetées restent dans les tables privées opérateur.
create or replace function public.local_discovery_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 15000,
  p_limit integer default 80)
returns table (
  id uuid, name text, lat double precision, lng double precision,
  address text, postal_code text, city text, category text,
  service_categories text[], phone text, official_url text,
  verification_status text, confidence numeric, last_verified_at timestamptz,
  entity_status text, reopens_at timestamptz, closure_reason text,
  next_distribution_at timestamptz, distance_m double precision)
language sql stable security definer
set search_path to 'public', 'topology'
as $function$
  select c.id, c.name, c.lat, c.lng, c.address, c.postal_code, c.city,
         coalesce(p.category, 'asso'), c.service_categories, c.phone,
         c.official_url, c.verification_status, c.confidence,
         c.last_verified_at, c.entity_status, c.reopens_at,
         c.closure_reason, c.next_distribution_at,
         ST_Distance(
           ST_SetSRID(ST_MakePoint(c.lng,c.lat),4326)::topology.geography,
           ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::topology.geography)
    from public.local_discovery_candidates c
    left join public.places p on p.id = c.place_id
   where c.verification_status in ('verified','probable')
     and c.place_id is not null
     and c.entity_status <> 'inactive'
     and c.lat is not null and c.lng is not null
     and ST_DWithin(
       ST_SetSRID(ST_MakePoint(c.lng,c.lat),4326)::topology.geography,
       ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::topology.geography,
       least(greatest(coalesce(p_radius_m,15000),500),20000))
   order by c.confidence desc,
     ST_Distance(
       ST_SetSRID(ST_MakePoint(c.lng,c.lat),4326)::topology.geography,
       ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::topology.geography) asc
   limit least(greatest(coalesce(p_limit,80),1),120);
$function$;
revoke all on function public.local_discovery_nearby(double precision,double precision,integer,integer)
  from public;
grant execute on function public.local_discovery_nearby(double precision,double precision,integer,integer)
  to anon, authenticated, service_role;
