-- ---------------------------------------------------------------------------
-- Zones autonomes Autour
--
-- `territories` reste le registre technique des territoires de service et des
-- sources. `autour_zones` porte l'identité produit stable : une donnée, une
-- session et une clé de cache parlent toujours de la même zone.
-- ---------------------------------------------------------------------------

create table if not exists public.autour_zones (
  zone_id              text primary key,
  label                text not null,
  city                 text not null,
  latitude             double precision not null check (latitude between -90 and 90),
  longitude            double precision not null check (longitude between -180 and 180),
  radius_km            double precision not null check (radius_km between 1 and 100),
  timezone             text not null default 'Europe/Paris',
  active               boolean not null default true,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint autour_zones_id_check
    check (zone_id in ('mel', 'paris', 'angers', 'rennes', 'rouen'))
);

comment on table public.autour_zones is
  'Identité produit stable des zones Autour. Les cinq lignes initiales sont la frontière des pools locaux.';
comment on column public.autour_zones.radius_km is
  'Rayon de détection GPS de la zone autonome, distinct des emprises de collecte des sources.';

insert into public.autour_zones (zone_id, label, city, latitude, longitude, radius_km, timezone)
values
  ('mel',    'Métropole lilloise', 'Lille',  50.6292,  3.0573, 35, 'Europe/Paris'),
  ('paris',  'Paris',              'Paris',  48.8566,  2.3522, 32, 'Europe/Paris'),
  ('angers', 'Angers',             'Angers', 47.4784, -0.5632, 26, 'Europe/Paris'),
  ('rennes', 'Rennes',             'Rennes', 48.1173, -1.6778, 26, 'Europe/Paris'),
  ('rouen',  'Rouen',              'Rouen',  49.4432,  1.0993, 26, 'Europe/Paris')
on conflict (zone_id) do update set
  label = excluded.label,
  city = excluded.city,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  radius_km = excluded.radius_km,
  timezone = excluded.timezone,
  active = excluded.active,
  updated_at = now();

create index if not exists autour_zones_active_location_idx
  on public.autour_zones (active, latitude, longitude)
  where active;

alter table public.event_areas
  add column if not exists zone_id text;

-- `lille` est le code historique de l'aire de synchronisation ; `mel` est
-- son identifiant produit. Les anciennes aires hors périmètre restent dans
-- l'historique mais ne reçoivent aucune zone autonome.
update public.event_areas a
   set zone_id = case
     when a.code = 'lille' or a.code like 'mel-%' then 'mel'
     else a.code
   end
 where a.zone_id is null
   and exists (
     select 1 from public.autour_zones z
      where z.zone_id = case
        when a.code = 'lille' or a.code like 'mel-%' then 'mel'
        else a.code
      end
   );

-- Les anciennes aires nationales restent dans l'historique, mais ne doivent
-- plus être traitées par une course « toutes » ni être confondues avec une
-- zone autonome. Les remettre en sommeil est réversible via `enabled = true`.
update public.event_areas
   set enabled = false, updated_at = now()
 where code in ('lyon', 'marseille', 'bordeaux', 'toulouse');

-- Rouen faisait partie du registre produit avant d'avoir une aire de collecte
-- dédiée. Cette ligne rend `area=rouen` idempotent et borne la collecte à son
-- rectangle, comme pour les quatre autres zones géographiques.
insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng, insee_codes,
  timezone, enabled, priorite
)
values (
  'rouen', 'rouen', 'Rouen et son agglomération', 49.34, 0.95, 49.55, 1.25,
  array['76540'], 'Europe/Paris', true, 90
)
on conflict (code) do update set
  zone_id = excluded.zone_id,
  name = excluded.name,
  min_lat = excluded.min_lat,
  min_lng = excluded.min_lng,
  max_lat = excluded.max_lat,
  max_lng = excluded.max_lng,
  insee_codes = excluded.insee_codes,
  timezone = excluded.timezone,
  enabled = true,
  priorite = excluded.priorite,
  updated_at = now();

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'event_areas_zone_id_fkey'
       and conrelid = 'public.event_areas'::regclass
  ) then
    alter table public.event_areas
      add constraint event_areas_zone_id_fkey
      foreign key (zone_id) references public.autour_zones(zone_id);
  end if;
end
$constraints$;

alter table public.events
  add column if not exists zone_id text;

update public.events e
   set zone_id = a.zone_id
  from public.event_areas a
 where e.area_id = a.id
   and e.zone_id is distinct from a.zone_id;

-- Les événements historiques qui n'avaient pas d'aire gardent une identité
-- stable quand leurs coordonnées sont dans le rayon d'une zone autonome.
with rattaches as (
  select e.id,
         (select z.zone_id
            from public.autour_zones z
           where z.active
             and 6371 * 2 * asin(least(1, sqrt(
               power(sin(radians(z.latitude - e.lat) / 2), 2)
               + cos(radians(e.lat)) * cos(radians(z.latitude))
                 * power(sin(radians(z.longitude - e.lng) / 2), 2)
             ))) <= z.radius_km
           order by 6371 * 2 * asin(least(1, sqrt(
             power(sin(radians(z.latitude - e.lat) / 2), 2)
             + cos(radians(e.lat)) * cos(radians(z.latitude))
               * power(sin(radians(z.longitude - e.lng) / 2), 2)
           )))
           limit 1) as zone_id
    from public.events e
   where e.zone_id is null and e.lat is not null and e.lng is not null
)
update public.events e
   set zone_id = r.zone_id
  from rattaches r
 where e.id = r.id and r.zone_id is not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'events_zone_id_fkey'
       and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_zone_id_fkey
      foreign key (zone_id) references public.autour_zones(zone_id);
  end if;
end
$constraints$;

create index if not exists events_zone_position_idx
  on public.events (zone_id, lat, lng, start_at)
  where zone_id is not null and cancelled = false;

-- Les triggers complètent les anciennes fonctions sans les remplacer : les
-- calculs temporels, de commune, de géométrie et de déduplication demeurent
-- dans `events_avant_ecriture`.
create or replace function public.event_areas_assigner_zone()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.zone_id := (
    select z.zone_id
      from public.autour_zones z
     where z.zone_id = case when new.code = 'lille' then 'mel' else new.code end
  );
  return new;
end;
$function$;

drop trigger if exists event_areas_assigner_zone on public.event_areas;
create trigger event_areas_assigner_zone
  before insert or update on public.event_areas
  for each row execute function public.event_areas_assigner_zone();

create or replace function public.events_assigner_zone()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.area_id is not null then
    select a.zone_id into new.zone_id
      from public.event_areas a
     where a.id = new.area_id;
  end if;
  if new.zone_id is null and new.lat is not null and new.lng is not null then
    select z.zone_id into new.zone_id
      from public.autour_zones z
     where z.active
       and 6371 * 2 * asin(least(1, sqrt(
         power(sin(radians(z.latitude - new.lat) / 2), 2)
         + cos(radians(new.lat)) * cos(radians(z.latitude))
           * power(sin(radians(z.longitude - new.lng) / 2), 2)
       ))) <= z.radius_km
     order by 6371 * 2 * asin(least(1, sqrt(
       power(sin(radians(z.latitude - new.lat) / 2), 2)
       + cos(radians(new.lat)) * cos(radians(z.latitude))
         * power(sin(radians(z.longitude - new.lng) / 2), 2)
     )))
     limit 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists events_assigner_zone on public.events;
create trigger events_assigner_zone
  before insert or update on public.events
  for each row execute function public.events_assigner_zone();

alter table public.publications
  add column if not exists zone_id text;

with rattaches as (
  select p.id,
         (select z.zone_id
            from public.autour_zones z
           where z.active
             and 6371 * 2 * asin(least(1, sqrt(
               power(sin(radians(z.latitude - p.lat) / 2), 2)
               + cos(radians(p.lat)) * cos(radians(z.latitude))
                 * power(sin(radians(z.longitude - p.lng) / 2), 2)
             ))) <= z.radius_km
           order by 6371 * 2 * asin(least(1, sqrt(
             power(sin(radians(z.latitude - p.lat) / 2), 2)
             + cos(radians(p.lat)) * cos(radians(z.latitude))
               * power(sin(radians(z.longitude - p.lng) / 2), 2)
           )))
           limit 1) as zone_id
    from public.publications p
   where p.lat is not null and p.lng is not null
)
update public.publications p
   set zone_id = r.zone_id
  from rattaches r
 where p.id = r.id and p.zone_id is distinct from r.zone_id;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'publications_zone_id_fkey'
       and conrelid = 'public.publications'::regclass
  ) then
    alter table public.publications
      add constraint publications_zone_id_fkey
      foreign key (zone_id) references public.autour_zones(zone_id);
  end if;
end
$constraints$;

create index if not exists publications_zone_position_idx
  on public.publications (zone_id, lat, lng, fin_le)
  where zone_id is not null;

create or replace function public.publications_assigner_zone()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  select z.zone_id into new.zone_id
    from public.autour_zones z
   where z.active
     and 6371 * 2 * asin(least(1, sqrt(
       power(sin(radians(z.latitude - new.lat) / 2), 2)
       + cos(radians(new.lat)) * cos(radians(z.latitude))
         * power(sin(radians(z.longitude - new.lng) / 2), 2)
     ))) <= z.radius_km
   order by 6371 * 2 * asin(least(1, sqrt(
     power(sin(radians(z.latitude - new.lat) / 2), 2)
     + cos(radians(new.lat)) * cos(radians(z.latitude))
       * power(sin(radians(z.longitude - new.lng) / 2), 2)
   )))
   limit 1;
  return new;
end;
$function$;

drop trigger if exists publications_assigner_zone on public.publications;
create trigger publications_assigner_zone
  before insert or update on public.publications
  for each row execute function public.publications_assigner_zone();

-- Portes de lecture séparées : les clients n'ont pas à récupérer un bassin
-- complet pour ensuite essayer de le nettoyer côté JavaScript.
create or replace function public.evenements_locaux(
  p_zone_id text,
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 120
) returns setof public.events
language sql
stable
security invoker
set search_path = public
as $function$
  select e.*
    from public.events e
   where e.zone_id = p_zone_id
     and e.lat between p_sud and p_nord
     and e.lng between p_ouest and p_est
     and e.publication_id is null
     and public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                      e.cancelled, now())
         = any (array['now','soon','upcoming','unknown_date'])
   order by case public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                                e.cancelled, now())
       when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,
     e.start_at nulls last
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;

create or replace function public.publications_locales(
  p_zone_id text,
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 120
) returns setof public.publications
language sql
stable
security invoker
set search_path = public
as $function$
  select p.*
    from public.publications p
   where p.zone_id = p_zone_id
     and p.lat between p_sud and p_nord
     and p.lng between p_ouest and p_est
     and (p.fin_le is null or p.fin_le > now())
   order by p.cree_le desc
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;

create or replace function public.evenements_majeurs_hors_zone(
  p_active_zone_id text,
  p_limite integer default 24
) returns setof public.events
language sql
stable
security invoker
set search_path = public
as $function$
  select e.*
    from public.events e
   where e.zone_id is not null
     and e.zone_id <> p_active_zone_id
     and e.importance_level = 'major'
     and e.importance_score >= 80
     and e.cancelled = false
     and e.start_at > now()
     and coalesce(cardinality(e.announcement_tags), 0) > 0
     and e.duplicate_of is null
   order by e.importance_score desc, e.announced_at desc nulls last, e.start_at asc
   limit least(greatest(coalesce(p_limite, 24), 1), 24);
$function$;

grant select on public.autour_zones to anon, authenticated;
alter table public.autour_zones enable row level security;
drop policy if exists "zones autonomes: lecture publique" on public.autour_zones;
create policy "zones autonomes: lecture publique"
  on public.autour_zones for select to anon, authenticated using (active = true);
grant execute on function public.evenements_locaux(text, double precision, double precision, double precision, double precision, integer) to anon, authenticated;
grant execute on function public.publications_locales(text, double precision, double precision, double precision, double precision, integer) to anon, authenticated;
grant execute on function public.evenements_majeurs_hors_zone(text, integer) to anon, authenticated;

alter table public.event_sync_runs
  add column if not exists zone_id text;
create index if not exists event_sync_runs_zone_idx
  on public.event_sync_runs (zone_id, started_at desc);
