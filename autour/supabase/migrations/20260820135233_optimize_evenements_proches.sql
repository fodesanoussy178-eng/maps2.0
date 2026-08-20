-- ---------------------------------------------------------------------------
-- Chemin rapide de lecture des événements canoniques
--
-- Résultat inchangé : mêmes colonnes, filtres, limite et ordre. Le statut
-- temporel et le point PostGIS sont calculés une seule fois par requête, puis
-- les candidats spatiaux une seule fois avant filtrage et tri.
-- ---------------------------------------------------------------------------

do $postgis$
declare
  postgis_schema text;
begin
  select n.nspname into postgis_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if postgis_schema is null then
    raise exception 'PostGIS est introuvable : impossible de servir les événements.';
  end if;

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
      with centre as materialized (
        select (p_sud + p_nord) / 2 as lat,
               (p_ouest + p_est) / 2 as lng
      ), parametres as materialized (
        select now() as instant,
               public.event_soon_window() as soon_window,
               %1$I.st_setsrid(
                 %1$I.st_makepoint(c.lng, c.lat), 4326
               )::%1$I.geography as point
        from centre c
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
      ), candidats as materialized (
        select e.*,
               case
                 when e.start_at is null
                      or coalesce(e.date_confidence, 'unknown') = 'unknown'
                   then 'unknown_date'
                 when e.end_at is not null and e.end_at < p.instant
                   then 'past'
                 when e.start_at <= p.instant and e.end_at is null
                   then 'unknown_date'
                 when e.start_at <= p.instant and e.end_at >= p.instant
                   then case
                          when coalesce(e.cancelled, false) then 'past'
                          when e.date_confidence = 'exact' then 'now'
                          else 'unknown_date'
                        end
                 when e.start_at > p.instant
                      and e.start_at - p.instant <= p.soon_window
                   then 'soon'
                 else 'upcoming'
               end as statut,
               %1$I.st_distance(e.geom::%1$I.geography, p.point) as distance_m
        from public.events e
        cross join parametres p
        cross join rayon r
        where e.geom is not null
          and %1$I.st_dwithin(
            e.geom::%1$I.geography,
            p.point,
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
  'Événements canoniques territoriaux : filtre PostGIS, statut calculé une fois, ordre fonctionnel inchangé.';

grant execute on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
) to anon, authenticated;
