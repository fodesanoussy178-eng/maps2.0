-- ---------------------------------------------------------------------------
-- Runtime des cinq zones autonomes et partitions techniques.
--
-- `autour_zones.zone_id` est l'identité produit. `event_areas.code` porte les
-- emprises de collecte : une même zone peut donc avoir plusieurs partitions
-- sans que l'utilisateur ne voie plusieurs villes.
-- ---------------------------------------------------------------------------

alter table public.event_areas
  add column if not exists zone_id text,
  add column if not exists sync_partition boolean not null default true;

comment on column public.event_areas.zone_id is
  'Identité produit stable de la zone. Plusieurs emprises techniques peuvent partager ce même zone_id.';
comment on column public.event_areas.sync_partition is
  'Vrai si la ligne est une emprise exécutée par le synchroniseur. Une ligne utilisateur globale peut rester active sans être traitée comme un bloc.';

-- Une mise à jour conserve une identité explicitement fournie. Le repli reste
-- data-driven pour les anciennes lignes qui n'avaient pas encore zone_id.
create or replace function public.event_areas_assigner_zone()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.zone_id is null then
    new.zone_id := (
      select z.zone_id
        from public.autour_zones z
       where z.zone_id = case
         when new.code = 'lille' or new.code = 'mel' or new.code like 'mel-%'
           then 'mel'
         else new.code
       end
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists event_areas_assigner_zone on public.event_areas;
create trigger event_areas_assigner_zone
  before insert or update on public.event_areas
  for each row execute function public.event_areas_assigner_zone();

-- Le code historique `lille` devient le code produit demandé `mel`. Les
-- quatre couronnes historiques restent des partitions de la même zone.
update public.event_areas
   set code = 'mel', updated_at = now()
 where code = 'lille'
   and not exists (select 1 from public.event_areas where code = 'mel');

update public.event_areas
   set zone_id = 'mel', sync_partition = true, enabled = true, updated_at = now()
 where code = 'mel' or code like 'mel-%';

-- Les cinq identités utilisateur existent toutes comme lignes actives et
-- portent exactement leur zone_id. Les rectangles sont ceux du registre
-- validé ; ils servent à borner la collecte, pas à changer l'identité produit.
insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng,
  insee_codes, timezone, enabled, sync_partition, priorite
)
values
  ('mel',    'mel',    'Métropole lilloise',          50.55,  2.90, 50.75,  3.25, array['59350'], 'Europe/Paris', true, true, 10),
  ('paris',  'paris',  'Paris et proche couronne',    48.75,  2.20, 48.95,  2.50, array['75056'], 'Europe/Paris', true, false, 20),
  ('angers', 'angers', 'Angers et son agglomération', 47.38, -0.72, 47.58, -0.42, array['49007'], 'Europe/Paris', true, true, 70),
  ('rennes', 'rennes', 'Rennes et son agglomération', 48.02, -1.82, 48.22, -1.52, array['35238'], 'Europe/Paris', true, true, 80),
  ('rouen',  'rouen',  'Rouen et son agglomération',  49.34,  0.95, 49.55,  1.25, array['76540'], 'Europe/Paris', true, true, 90)
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
  sync_partition = excluded.sync_partition,
  priorite = excluded.priorite,
  updated_at = now();

-- Paris reste une seule zone pour la session et la lecture utilisateur. Sa
-- ligne globale est active mais n'est pas une partition de synchronisation.
-- Les cinq rectangles disjoints se recouvrent seulement sur leurs frontières;
-- la contrainte UNIQUE(source, external_id) et dedup_key font foi si le
-- catalogue inclut un point exactement sur une frontière.
insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng,
  insee_codes, timezone, enabled, sync_partition, priorite
)
values
  ('paris_centre', 'paris', 'Paris — centre', 48.80, 2.25, 48.90, 2.42, array['75056'], 'Europe/Paris', true, true, 21),
  ('paris_nord',   'paris', 'Paris — nord',   48.90, 2.20, 48.95, 2.50, array['75056'], 'Europe/Paris', true, true, 22),
  ('paris_est',    'paris', 'Paris — est',    48.80, 2.42, 48.90, 2.50, array['75056'], 'Europe/Paris', true, true, 23),
  ('paris_sud',    'paris', 'Paris — sud',    48.75, 2.20, 48.80, 2.50, array['75056'], 'Europe/Paris', true, true, 24),
  ('paris_ouest',  'paris', 'Paris — ouest',  48.80, 2.20, 48.90, 2.25, array['75056'], 'Europe/Paris', true, true, 25)
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
  sync_partition = true,
  priorite = excluded.priorite,
  updated_at = now();

update public.event_areas
   set zone_id = 'paris', sync_partition = false, enabled = true, updated_at = now()
 where code = 'paris';

-- ---------------------------------------------------------------------------
-- Majorité canonique.
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists is_major boolean not null default false,
  add column if not exists major_scope text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'events_major_scope_check'
       and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_major_scope_check
      check (major_scope is null or major_scope in ('city', 'regional', 'national'));
  end if;
end
$constraints$;

update public.events
   set is_major = (importance_level = 'major'),
       major_scope = case when importance_level = 'major' then 'regional' else null end
 where is_major is distinct from (importance_level = 'major')
    or major_scope is distinct from case when importance_level = 'major' then 'regional' else null end;

comment on column public.events.is_major is
  'Verdict canonique : vrai seulement quand l''événement peut franchir une frontière de zone.';
comment on column public.events.major_scope is
  'Portée d''un événement majeur : city reste local, regional et national peuvent alimenter le pool cross-zone.';

create index if not exists events_major_cross_zone_idx
  on public.events (zone_id, importance_score desc, start_at)
  where is_major and major_scope in ('regional', 'national') and cancelled = false;

create or replace function public.events_majorite_normaliser()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if coalesce(new.is_major, false) or new.importance_level = 'major' then
    new.is_major := true;
    new.importance_level := 'major';
    new.major_scope := coalesce(new.major_scope, 'regional');
  else
    new.is_major := false;
    new.major_scope := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists events_majorite_normaliser on public.events;
create trigger events_majorite_normaliser
  before insert or update on public.events
  for each row execute function public.events_majorite_normaliser();

-- Seuls les majeurs régionaux/nationaux peuvent quitter leur zone. La date,
-- le score, les tags de pertinence et l'absence de doublon restent des
-- garde-fous indépendants ; le classement Pour toi applique ensuite les
-- goûts de la personne et le seuil de distance.
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
     and e.is_major = true
     and e.major_scope in ('regional', 'national')
     and e.importance_score >= 80
     and e.cancelled = false
     and e.start_at > now()
     and coalesce(cardinality(e.announcement_tags), 0) > 0
     and e.duplicate_of is null
   order by e.importance_score desc, e.announced_at desc nulls last, e.start_at asc
   limit least(greatest(coalesce(p_limite, 24), 1), 24);
$function$;

grant execute on function public.evenements_majeurs_hors_zone(text, integer) to anon, authenticated;
