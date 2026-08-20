-- ---------------------------------------------------------------------------
-- Registre territorial et orchestrateur événementiel unique
--
-- Version alignée sur l’historique de migrations Supabase du projet.
-- ---------------------------------------------------------------------------

create table if not exists public.territories (
  id              bigint generated always as identity primary key,
  slug            text not null unique
                  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  country         text not null default 'FR'
                  check (country ~ '^[A-Z]{2}$'),
  latitude        double precision not null check (latitude between -90 and 90),
  longitude       double precision not null check (longitude between -180 and 180),
  radius_km       double precision not null default 5
                  check (radius_km between 1 and 100),
  timezone        text not null default 'Europe/Paris',
  group_slug      text,
  status          text not null default 'pending'
                  check (status in ('active', 'pending', 'discovered', 'inactive')),
  active          boolean not null default false,
  discovery_key   text unique,
  last_synced_at  timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint territories_active_status_check
    check (not active or status = 'active')
);

comment on table public.territories is
  'Territoires mutualisés : une synchronisation sert tous les visiteurs de la même zone.';
comment on column public.territories.radius_km is
  'Rayon de service réel ; une limite communale ne bloque jamais un événement proche.';
comment on column public.territories.status is
  'active = servi et synchronisé ; discovered/pending = candidat sans collecte Internet automatique.';

create index if not exists territories_active_location_idx
  on public.territories (active, latitude, longitude)
  where active and status = 'active';
create index if not exists territories_group_idx
  on public.territories (group_slug)
  where group_slug is not null;

create table if not exists public.territory_sources (
  id               bigint generated always as identity primary key,
  territory_id     bigint not null references public.territories (id) on delete cascade,
  provider         text not null check (char_length(btrim(provider)) between 2 and 40),
  source_identifier text not null check (char_length(btrim(source_identifier)) between 1 and 160),
  source_name      text not null check (char_length(btrim(source_name)) between 1 and 160),
  active           boolean not null default false,
  priority         integer not null default 100 check (priority between 1 and 10000),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (territory_id, provider, source_identifier)
);

comment on table public.territory_sources is
  'Sources institutionnelles validées par territoire. Une source absente ou inactive n’est jamais appelée.';

create index if not exists territory_sources_territory_idx
  on public.territory_sources (territory_id);
create index if not exists territory_sources_active_provider_idx
  on public.territory_sources (provider, priority, territory_id)
  where active;

create or replace function private.territories_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists territories_touch_updated_at on public.territories;
create trigger territories_touch_updated_at
  before update on public.territories
  for each row execute function private.territories_touch_updated_at();

drop trigger if exists territory_sources_touch_updated_at on public.territory_sources;
create trigger territory_sources_touch_updated_at
  before update on public.territory_sources
  for each row execute function private.territories_touch_updated_at();

revoke all on function private.territories_touch_updated_at() from public, anon, authenticated;

insert into public.territories (
  slug, name, country, latitude, longitude, radius_km, timezone,
  group_slug, status, active, metadata
)
values
  ('tourcoing', 'Tourcoing', 'FR', 50.7239, 3.1612, 12, 'Europe/Paris', 'mel', 'active', true,
   '{"validation_scope":"metropole_lilloise","insee_code":"59599"}'::jsonb),
  ('roubaix', 'Roubaix', 'FR', 50.6927, 3.1778, 12, 'Europe/Paris', 'mel', 'active', true,
   '{"validation_scope":"metropole_lilloise","insee_code":"59512"}'::jsonb),
  ('lille', 'Lille', 'FR', 50.6292, 3.0573, 15, 'Europe/Paris', 'mel', 'active', true,
   '{"validation_scope":"metropole_lilloise","insee_code":"59350"}'::jsonb),
  ('paris', 'Paris', 'FR', 48.8566, 2.3522, 15, 'Europe/Paris', 'paris', 'active', true,
   '{"insee_code":"75056"}'::jsonb),
  ('rouen', 'Rouen', 'FR', 49.4432, 1.0993, 15, 'Europe/Paris', 'rouen-metropole', 'active', true,
   '{"insee_code":"76540"}'::jsonb),
  ('angers', 'Angers', 'FR', 47.4784, -0.5632, 12, 'Europe/Paris', 'angers-loire-metropole', 'active', true,
   '{"insee_code":"49007"}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  country = excluded.country,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  radius_km = excluded.radius_km,
  timezone = excluded.timezone,
  group_slug = excluded.group_slug,
  status = excluded.status,
  active = excluded.active,
  metadata = public.territories.metadata || excluded.metadata,
  updated_at = now();

with configured_sources(
  territory_slug, provider, source_identifier, source_name, active, priority, metadata
) as (
  values
    ('lille', 'openagenda', '57621068', 'Ville de Lille', true, 10,
     '{"agenda_slug":"ville-de-lille","official":true,"official_url":"https://openagenda.com/fr/ville-de-lille","validation":"public_page_and_production_test"}'::jsonb),
    ('tourcoing', 'openagenda', '32344838', 'Agenda culturel tourquennois', true, 20,
     '{"agenda_slug":"agenda-culturel-tourquennois","official":true,"official_url":"https://openagenda.com/fr/agenda-culturel-tourquennois","validation":"official_public_page"}'::jsonb),
    ('roubaix', 'openagenda', '9977986', 'Ville de Roubaix', true, 30,
     '{"agenda_slug":"roubaix","official":true,"official_url":"https://openagenda.com/fr/roubaix","validation":"official_public_page"}'::jsonb),
    ('rouen', 'openagenda', '11362982', 'Métropole Rouen Normandie', true, 40,
     '{"agenda_slug":"rouen-normandie-metropole","official":true,"official_url":"https://openagenda.com/fr/rouen-normandie-metropole","validation":"official_public_page"}'::jsonb),
    ('paris', 'openagenda', '52870970', 'Décider pour Paris', true, 50,
     '{"agenda_slug":"decider-paris","official":true,"official_url":"https://openagenda.com/fr/decider-paris","validation":"official_public_page","scope_note":"agenda du site de la Ville de Paris"}'::jsonb)
)
insert into public.territory_sources (
  territory_id, provider, source_identifier, source_name, active, priority, metadata
)
select t.id, s.provider, s.source_identifier, s.source_name, s.active, s.priority, s.metadata
from configured_sources s
join public.territories t on t.slug = s.territory_slug
on conflict (territory_id, provider, source_identifier) do update set
  source_name = excluded.source_name,
  active = excluded.active,
  priority = excluded.priority,
  metadata = public.territory_sources.metadata || excluded.metadata,
  updated_at = now();

-- DATAtourisme est seulement préparé dans le registre. Son comportement de
-- production ne change pas dans cette migration.
insert into public.territory_sources (
  territory_id, provider, source_identifier, source_name, active, priority, metadata
)
select t.id, 'datatourisme', 'national-feed', 'DATAtourisme national', false, 500,
       '{"orchestration_status":"prepared","production_behavior":"unchanged"}'::jsonb
from public.territories t
where t.slug in ('tourcoing', 'roubaix', 'lille', 'paris', 'rouen', 'angers')
on conflict (territory_id, provider, source_identifier) do update set
  source_name = excluded.source_name,
  active = false,
  priority = excluded.priority,
  metadata = public.territory_sources.metadata || excluded.metadata,
  updated_at = now();

alter table public.event_sync_runs
  add column if not exists territory_source_id bigint;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_sync_runs_territory_source_id_fkey'
      and conrelid = 'public.event_sync_runs'::regclass
  ) then
    alter table public.event_sync_runs
      add constraint event_sync_runs_territory_source_id_fkey
      foreign key (territory_source_id)
      references public.territory_sources (id) on delete set null;
  end if;
end;
$constraints$;

create index if not exists event_sync_runs_territory_source_started_idx
  on public.event_sync_runs (territory_source_id, started_at desc)
  where territory_source_id is not null;

update public.event_sync_runs r
set territory_source_id = ts.id
from public.territories t
join public.territory_sources ts on ts.territory_id = t.id and ts.provider = 'openagenda'
where r.source = 'openagenda'
  and r.territory = t.slug
  and r.territory_source_id is null;

alter table public.territories enable row level security;
alter table public.territory_sources enable row level security;

drop policy if exists "territories: lecture des actifs" on public.territories;
create policy "territories: lecture des actifs"
  on public.territories for select to anon, authenticated
  using (active and status = 'active');

grant select on public.territories to anon, authenticated;
revoke insert, update, delete on public.territories from anon, authenticated;
revoke all on public.territory_sources from anon, authenticated;

-- Résolution silencieuse de la zone. Une inconnue ne déclenche aucune source :
-- elle devient une seule ligne candidate par maille d'environ un kilomètre.
create or replace function public.resoudre_territoire(
  p_lat double precision,
  p_lng double precision,
  p_nom text default null
)
returns table (
  slug text,
  name text,
  group_slug text,
  status text,
  active boolean,
  radius_km double precision,
  distance_km double precision
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  candidate_key text;
  candidate_slug text;
  candidate_name text;
  candidate_id bigint;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'coordonnées territoriales invalides';
  end if;

  return query
  with ranked as (
    select t.slug, t.name, t.group_slug, t.status, t.active, t.radius_km,
           6371 * 2 * asin(least(1, sqrt(
             power(sin(radians(t.latitude - p_lat) / 2), 2) +
             cos(radians(p_lat)) * cos(radians(t.latitude)) *
             power(sin(radians(t.longitude - p_lng) / 2), 2)
           ))) as distance_km
    from public.territories t
    where t.active and t.status = 'active'
  )
  select r.slug, r.name, r.group_slug, r.status, r.active, r.radius_km, r.distance_km
  from ranked r
  where r.distance_km <= r.radius_km
  order by r.distance_km, r.radius_km
  limit 1;
  if found then return; end if;

  -- Autour est actuellement un produit France. Hors de cette emprise, le
  -- fallback continue mais aucun candidat n'est écrit.
  if p_lat not between 41 and 52 or p_lng not between -5.5 and 9.7 then
    return;
  end if;

  candidate_key := 'fr:' || round(p_lat::numeric, 2)::text || ':' ||
                   round(p_lng::numeric, 2)::text;
  candidate_slug := 'candidate-' || md5(candidate_key);
  candidate_name := left(nullif(btrim(regexp_replace(coalesce(p_nom, ''),
    '[[:cntrl:]]', '', 'g')), ''), 120);
  candidate_name := coalesce(candidate_name, 'Territoire découvert');

  insert into public.territories (
    slug, name, country, latitude, longitude, radius_km, timezone,
    status, active, discovery_key, metadata
  )
  values (
    candidate_slug, candidate_name, 'FR',
    round(p_lat::numeric, 2)::double precision,
    round(p_lng::numeric, 2)::double precision,
    5, 'Europe/Paris', 'discovered', false, candidate_key,
    jsonb_build_object('discovered_at', now(), 'automatic_source_discovery', false)
  )
  on conflict (discovery_key) do update set
    name = case
      when public.territories.name = 'Territoire découvert' then excluded.name
      else public.territories.name
    end,
    updated_at = now()
  returning id into candidate_id;

  return query
  select t.slug, t.name, t.group_slug, t.status, t.active, t.radius_km,
         0::double precision
  from public.territories t
  where t.id = candidate_id;
end;
$function$;

comment on function public.resoudre_territoire(double precision, double precision, text) is
  'Résout un territoire actif par proximité ; sinon enregistre un candidat inactif sans lancer de collecte.';

revoke all on function public.resoudre_territoire(double precision, double precision, text) from public;
grant execute on function public.resoudre_territoire(double precision, double precision, text)
  to anon, authenticated;

-- La signature publique reste identique. Seule l'emprise interne devient un
-- vrai rayon territorial et PostGIS assure la proximité géographique.
do $postgis$
declare
  postgis_schema text;
begin
  select n.nspname into postgis_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if postgis_schema is null then
    raise exception 'PostGIS est introuvable : impossible de servir les territoires.';
  end if;

  execute format(
    'create index if not exists events_geography_gist on public.events using gist ((geom::%1$I.geography))',
    postgis_schema
  );

  execute format($ddl$
    create or replace function public.evenements_proches(
      p_sud double precision,
      p_ouest double precision,
      p_nord double precision,
      p_est double precision,
      p_statuts text[] default array['now','soon','upcoming','unknown_date'],
      p_limite integer default 120,
      p_inclure_publications boolean default false
    )
    returns table (
      id uuid,
      publication_id uuid,
      title text,
      description text,
      category text,
      start_at timestamptz,
      end_at timestamptz,
      timezone text,
      temporal_status text,
      date_confidence text,
      place_name text,
      address text,
      city text,
      insee_code text,
      lat double precision,
      lng double precision,
      primary_source text,
      source_url text,
      image_url text,
      cancelled boolean,
      last_source_update timestamptz,
      last_synced_at timestamptz
    )
    language sql
    stable
    security invoker
    set search_path = ''
    as $body$
      with centre as (
        select (p_sud + p_nord) / 2 as lat,
               (p_ouest + p_est) / 2 as lng
      ), territoires_classes as (
        select t.radius_km,
               6371 * 2 * asin(least(1, sqrt(
                 power(sin(radians(t.latitude - c.lat) / 2), 2) +
                 cos(radians(c.lat)) * cos(radians(t.latitude)) *
                 power(sin(radians(t.longitude - c.lng) / 2), 2)
               ))) as distance_km
        from public.territories t
        cross join centre c
        where t.active and t.status = 'active'
      ), rayon as (
        select least(30::double precision, greatest(
          1::double precision,
          coalesce(
            (select tc.radius_km
             from territoires_classes tc
             where tc.distance_km <= tc.radius_km
             order by tc.distance_km, tc.radius_km
             limit 1),
            greatest(
              5::double precision,
              111.32 * abs(p_nord - p_sud) / 2,
              111.32 * cos(radians(c.lat)) * abs(p_est - p_ouest) / 2
            )
          )
        )) as km
        from centre c
      ), candidats as (
        select e.*,
               public.event_temporal_status(
                 e.start_at, e.end_at, e.date_confidence, e.cancelled, now()
               ) as statut,
               %1$I.st_distance(
                 e.geom::%1$I.geography,
                 %1$I.st_setsrid(%1$I.st_makepoint(c.lng, c.lat), 4326)::%1$I.geography
               ) as distance_m
        from public.events e
        cross join centre c
        cross join rayon r
        where e.geom is not null
          and %1$I.st_dwithin(
            e.geom::%1$I.geography,
            %1$I.st_setsrid(%1$I.st_makepoint(c.lng, c.lat), 4326)::%1$I.geography,
            r.km * 1000
          )
          and (p_inclure_publications or e.publication_id is null)
      )
      select e.id, e.publication_id, e.title, e.description, e.category,
             e.start_at, e.end_at, e.timezone, e.statut,
             e.date_confidence, e.place_name, e.address, e.city, e.insee_code,
             e.lat, e.lng, e.primary_source, e.source_url, e.image_url,
             e.cancelled, e.last_source_update, e.last_synced_at
      from candidats e
      where e.statut = any(coalesce(
        p_statuts, array['now','soon','upcoming','unknown_date']
      ))
      order by
        case e.statut
          when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3
        end,
        e.start_at nulls last,
        e.distance_m
      limit least(greatest(coalesce(p_limite, 120), 1), 300);
    $body$;
  $ddl$, postgis_schema);
end;
$postgis$;

comment on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
) is
  'Événements canoniques dans le rayon du territoire actif, filtrés par distance PostGIS et statut recalculé.';

revoke all on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
) from public;
grant execute on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
) to anon, authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.invoke_event_sync(
  p_mode text default 'orchestrate',
  p_territory text default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  sync_secret text;
  request_url text;
begin
  if p_mode not in ('test', 'sync', 'orchestrate') then
    raise exception 'mode de synchronisation invalide';
  end if;
  if p_mode = 'sync' and not exists (
    select 1
    from public.territories t
    join public.territory_sources ts on ts.territory_id = t.id
    where t.slug = p_territory
      and t.active and t.status = 'active'
      and ts.provider = 'openagenda' and ts.active
  ) then
    raise exception 'source OpenAgenda active absente pour %', coalesce(p_territory, 'null');
  end if;

  select nullif(btrim(secret.decrypted_secret), '')
  into sync_secret
  from vault.decrypted_secrets secret
  where secret.name = 'event_sync_secret'
  order by secret.created_at desc
  limit 1;

  if sync_secret is null then return null; end if;

  request_url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/sync-openagenda?mode=' || p_mode;
  if p_mode = 'sync' then
    request_url := request_url || '&territory=' || p_territory;
  end if;

  return net.http_post(
    url := request_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
end;
$function$;

comment on function private.invoke_event_sync(text, text) is
  'Déclenche un mode autorisé du moteur territorial avec event_sync_secret lu dans Vault.';
revoke all on function private.invoke_event_sync(text, text) from public, anon, authenticated;

create or replace function private.invoke_event_territory_sync()
returns bigint
language sql
security invoker
set search_path = ''
as $function$
  select private.invoke_event_sync('orchestrate', null);
$function$;

comment on function private.invoke_event_territory_sync() is
  'Déclenche l’orchestrateur territorial unique avec event_sync_secret lu dans Vault.';
revoke all on function private.invoke_event_territory_sync() from public, anon, authenticated;

do $cron_cleanup$
begin
  if exists (
    select 1 from cron.job where jobname = 'openagenda-lille-sync-every-3-hours'
  ) then
    perform cron.unschedule('openagenda-lille-sync-every-3-hours');
  end if;
end;
$cron_cleanup$;

drop function if exists private.invoke_openagenda_lille_sync();

select cron.schedule(
  'event-territory-sync-every-3-hours',
  '0 */3 * * *',
  $cron$select private.invoke_event_territory_sync();$cron$
);
