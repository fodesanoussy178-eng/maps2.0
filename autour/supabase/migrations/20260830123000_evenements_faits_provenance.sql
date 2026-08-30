/* Faits événementiels structurés.

   Les anciennes colonnes de lieu restent compatibles avec les publications
   existantes. Les alias venue/organizer et event/place source sont conservés
   séparément pour qu'une fiche OSM ne puisse pas devenir la source d'un texte
   fourni par un agenda événementiel.
*/
alter table public.events
  add column if not exists venue_name text,
  add column if not exists organizer_name text,
  add column if not exists price_amount numeric,
  add column if not exists price_text text,
  add column if not exists is_free boolean,
  add column if not exists price_confidence text not null default 'unknown',
  add column if not exists audience text,
  add column if not exists min_age integer,
  add column if not exists reservation_required boolean,
  add column if not exists reservation_text text,
  add column if not exists event_source text,
  add column if not exists event_source_url text,
  add column if not exists place_source text;

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_price_amount_check'
    and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_price_amount_check
      check (price_amount is null or price_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_min_age_check'
    and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_min_age_check
      check (min_age is null or min_age between 0 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_price_confidence_check'
    and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_price_confidence_check
      check (price_confidence in ('high','medium','unknown'));
  end if;
end
$constraint$;

create index if not exists events_event_source_idx on public.events (event_source);
create index if not exists events_price_idx on public.events (price_amount) where price_amount is not null;

/* Les types de retour des RPC sont des contrats PostgreSQL : l'ajout de faits
   exige donc de les recréer avec les mêmes signatures d'appel. */
drop function if exists public.evenements_proches(
  double precision,double precision,double precision,double precision,text[],integer,boolean
);

do $postgis$
declare
  postgis_schema text;
begin
  select n.nspname into postgis_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  if postgis_schema is null then
    raise exception 'PostGIS est introuvable : impossible de servir les evenements.';
  end if;
  execute format($ddl$
    create function public.evenements_proches(
      p_sud double precision, p_ouest double precision, p_nord double precision, p_est double precision,
      p_statuts text[] default array['now','soon','upcoming','unknown_date'],
      p_limite integer default 120, p_inclure_publications boolean default false
    ) returns table (
      id uuid, publication_id uuid, title text, description text, category text,
      start_at timestamptz, end_at timestamptz, timezone text, temporal_status text,
      date_confidence text, price_amount numeric, price_text text, is_free boolean,
      price_confidence text, audience text, min_age integer, reservation_required boolean,
      reservation_text text, place_name text, venue_name text, address text, city text,
      insee_code text, lat double precision, lng double precision, primary_source text,
      event_source text, event_source_url text, source_url text, place_source text,
      image_url text, image_source text, image_source_url text, image_author text,
      image_license text, image_updated_at timestamptz, cancelled boolean,
      last_source_update timestamptz, last_synced_at timestamptz, artist_names text[],
      music_genres text[], event_kind text, organizer text, organizer_name text,
      metro_area text, territory_slug text, territory_distance_km double precision
    ) language sql stable security invoker set search_path = ''
    as $body$
      with centre as materialized (select (p_sud+p_nord)/2 as lat, (p_ouest+p_est)/2 as lng),
      parametres as materialized (
        select now() as instant, public.event_soon_window() as soon_window,
          %1$I.st_setsrid(%1$I.st_makepoint(c.lng,c.lat),4326)::%1$I.geography as point
        from centre c
      ),
      territoires_classes as (
        select t.radius_km, 6371*2*asin(least(1,sqrt(
          power(sin(radians(t.latitude-c.lat)/2),2)+cos(radians(c.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-c.lng)/2),2)
        ))) as distance_km
        from public.territories t cross join centre c where t.active and t.status='active'
      ), rayon as (
        select least(30::double precision,greatest(1::double precision,coalesce(
          (select tc.radius_km from territoires_classes tc where tc.distance_km<=tc.radius_km order by tc.distance_km,tc.radius_km limit 1),
          greatest(5::double precision,111.32*abs(p_nord-p_sud)/2,111.32*cos(radians(c.lat))*abs(p_est-p_ouest)/2)
        ))) as km from centre c
      ), candidats as materialized (
        select e.*, case
          when e.start_at is null or coalesce(e.date_confidence,'unknown')='unknown' then 'unknown_date'
          when e.end_at is not null and e.end_at < p.instant then 'past'
          when e.start_at <= p.instant and e.end_at is null then 'unknown_date'
          when e.start_at <= p.instant and e.end_at >= p.instant then case when coalesce(e.cancelled,false) then 'past' when e.date_confidence='exact' then 'now' else 'unknown_date' end
          when e.start_at > p.instant and e.start_at-p.instant <= p.soon_window then 'soon' else 'upcoming' end as statut
        from public.events e cross join parametres p cross join rayon r
        where e.duplicate_of is null and e.geom is not null
          and %1$I.st_dwithin(e.geom::%1$I.geography,p.point,r.km*1000)
          and (p_inclure_publications or e.publication_id is null)
      )
      select e.id,e.publication_id,e.title,e.description,e.category,e.start_at,e.end_at,e.timezone,e.statut,
        e.date_confidence,e.price_amount,e.price_text,e.is_free,e.price_confidence,e.audience,e.min_age,
        e.reservation_required,e.reservation_text,e.place_name,e.venue_name,e.address,e.city,e.insee_code,
        e.lat,e.lng,e.primary_source,e.event_source,e.event_source_url,e.source_url,e.place_source,e.image_url,
        e.image_source,e.image_source_url,e.image_author,e.image_license,e.image_updated_at,e.cancelled,
        e.last_source_update,e.last_synced_at,e.artist_names,e.music_genres,e.event_kind,e.organizer,e.organizer_name,
        basin.group_slug,basin.slug,basin.distance_km
      from candidats e
      left join lateral (
        select t.group_slug,t.slug,6371*2*asin(least(1,sqrt(
          power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
        ))) as distance_km
        from public.territories t
        where t.active and t.status='active' and t.group_slug is not null
          and 6371*2*asin(least(1,sqrt(power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)))) <= t.radius_km
        order by distance_km,t.radius_km limit 1
      ) basin on true
      where e.statut = any(coalesce(p_statuts,array['now','soon','upcoming','unknown_date']))
      order by case e.statut when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,e.start_at nulls last
      limit least(greatest(coalesce(p_limite,120),1),300);
    $body$;
  $ddl$, postgis_schema);
end;
$postgis$;

drop function if exists public.evenements_bassin(text,integer,boolean);

create function public.evenements_bassin(
  p_group_slug text, p_limite integer default 300, p_inclure_publications boolean default true
) returns table(
  id uuid, publication_id uuid, title text, description text, category text,
  start_at timestamptz, end_at timestamptz, timezone text, temporal_status text,
  date_confidence text, price_amount numeric, price_text text, is_free boolean,
  price_confidence text, audience text, min_age integer, reservation_required boolean,
  reservation_text text, place_name text, venue_name text, address text, city text,
  insee_code text, lat double precision, lng double precision, primary_source text,
  event_source text, event_source_url text, source_url text, place_source text,
  image_url text, image_source text, image_source_url text, image_author text,
  image_license text, image_updated_at timestamptz, cancelled boolean,
  last_source_update timestamptz, last_synced_at timestamptz, announced_at timestamptz,
  presale_at timestamptz, tickets_open_at timestamptz, announcement_tags text[],
  artist_names text[], music_genres text[], event_kind text, importance_level text,
  importance_score integer, performers text[], organizer text, organizer_name text,
  ticket_url text, announcement_provenance jsonb, metro_area text,
  territory_slug text, territory_distance_km double precision
)
language sql stable set search_path to ''
as $function$
  with parametres as materialized (select now() as instant, public.event_soon_window() as soon_window),
  candidats as materialized (
    select e.*, basin.group_slug, basin.slug as territory_slug, basin.distance_km,
      case
        when e.start_at is null or coalesce(e.date_confidence,'unknown')='unknown' then 'unknown_date'
        when e.end_at is not null and e.end_at < p.instant then 'past'
        when e.start_at <= p.instant and e.end_at is null then 'unknown_date'
        when e.start_at <= p.instant and e.end_at >= p.instant then case when coalesce(e.cancelled,false) then 'past' when e.date_confidence='exact' then 'now' else 'unknown_date' end
        when e.start_at > p.instant and e.start_at - p.instant <= p.soon_window then 'soon'
        else 'upcoming' end as statut
    from public.events e cross join parametres p
    left join lateral (
      select t.group_slug, t.slug, 6371*2*asin(least(1,sqrt(
        power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
      ))) as distance_km
      from public.territories t
      where t.active and t.status='active' and t.group_slug is not null
        and 6371*2*asin(least(1,sqrt(power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)))) <= t.radius_km
      order by distance_km, t.radius_km limit 1
    ) basin on true
    where e.duplicate_of is null and e.geom is not null
      and (p_inclure_publications or e.publication_id is null)
      and basin.group_slug = p_group_slug
  )
  select c.id,c.publication_id,c.title,c.description,c.category,c.start_at,c.end_at,c.timezone,c.statut,
    c.date_confidence,c.price_amount,c.price_text,c.is_free,c.price_confidence,c.audience,c.min_age,
    c.reservation_required,c.reservation_text,c.place_name,c.venue_name,c.address,c.city,c.insee_code,
    c.lat,c.lng,c.primary_source,c.event_source,c.event_source_url,c.source_url,c.place_source,c.image_url,
    c.image_source,c.image_source_url,c.image_author,c.image_license,c.image_updated_at,c.cancelled,
    c.last_source_update,c.last_synced_at,c.announced_at,c.presale_at,c.tickets_open_at,c.announcement_tags,
    c.artist_names,c.music_genres,c.event_kind,c.importance_level,c.importance_score,c.performers,c.organizer,
    c.organizer_name,c.ticket_url,c.announcement_provenance,c.group_slug,c.territory_slug,c.distance_km
  from candidats c
  where c.statut <> 'past'
  order by case c.statut when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,c.start_at nulls last
  limit least(greatest(coalesce(p_limite,300),1),500);
$function$;

drop function if exists public.annonces_proches(double precision,double precision,double precision,double precision,integer);

create function public.annonces_proches(
  p_sud double precision,p_ouest double precision,p_nord double precision,p_est double precision,p_limite integer default 120
) returns table (
  id uuid,title text,description text,category text,start_at timestamptz,end_at timestamptz,timezone text,date_confidence text,
  price_amount numeric,price_text text,is_free boolean,price_confidence text,audience text,min_age integer,
  reservation_required boolean,reservation_text text,place_name text,venue_name text,address text,city text,insee_code text,
  lat double precision,lng double precision,primary_source text,event_source text,event_source_url text,source_url text,place_source text,
  image_url text,cancelled boolean,last_source_update timestamptz,last_synced_at timestamptz,announced_at timestamptz,
  presale_at timestamptz,tickets_open_at timestamptz,announcement_tags text[],artist_names text[],music_genres text[],event_kind text,
  importance_level text,importance_score integer,performers text[],organizer text,organizer_name text,ticket_url text,
  announcement_provenance jsonb,metro_area text,territory_slug text,territory_distance_km double precision
)
language sql stable security invoker set search_path = ''
as $$
  select e.id,e.title,e.description,e.category,e.start_at,e.end_at,e.timezone,e.date_confidence,
    e.price_amount,e.price_text,e.is_free,e.price_confidence,e.audience,e.min_age,e.reservation_required,e.reservation_text,
    e.place_name,e.venue_name,e.address,e.city,e.insee_code,e.lat,e.lng,e.primary_source,e.event_source,e.event_source_url,e.source_url,e.place_source,
    e.image_url,e.cancelled,e.last_source_update,e.last_synced_at,e.announced_at,e.presale_at,e.tickets_open_at,
    e.announcement_tags,e.artist_names,e.music_genres,e.event_kind,e.importance_level,e.importance_score,e.performers,e.organizer,e.organizer_name,
    e.ticket_url,e.announcement_provenance,basin.group_slug,basin.slug,basin.distance_km
  from public.events e
  left join lateral (
    select t.group_slug,t.slug,6371*2*asin(least(1,sqrt(
      power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
    ))) as distance_km
    from public.territories t
    where t.active and t.status='active' and t.group_slug is not null
      and 6371*2*asin(least(1,sqrt(power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)))) <= t.radius_km
    order by distance_km,t.radius_km limit 1
  ) basin on true
  where e.lat between p_sud and p_nord and e.lng between p_ouest and p_est
    and e.duplicate_of is null and e.cancelled=false and e.start_at>now()
    and cardinality(e.announcement_tags)>0
  order by e.importance_score desc,e.announced_at desc nulls last,e.start_at asc
  limit least(greatest(coalesce(p_limite,120),1),300);
$$;

grant execute on function public.evenements_proches(double precision,double precision,double precision,double precision,text[],integer,boolean) to anon,authenticated;
grant execute on function public.evenements_bassin(text,integer,boolean) to anon,authenticated;
grant execute on function public.annonces_proches(double precision,double precision,double precision,double precision,integer) to anon,authenticated;
