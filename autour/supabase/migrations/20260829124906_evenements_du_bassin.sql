-- « Pour toi » doit chercher dans toute la métropole. Il ne le faisait pas,
-- et pas pour la raison qu'on croyait.
--
-- Le client demandait bien une emprise de 25 km. Mais `evenements_proches`
-- RECALCULE son rayon : il cherche le territoire actif qui contient le centre
-- de l'emprise et prend SON rayon. Pour quelqu'un à Tourcoing, c'est le
-- territoire « tourcoing », rayon 5 km. Les 25 km demandés étaient ramenés à
-- 5. Le bassin métropolitain n'a jamais existé à l'exécution.
--
-- On ne touche pas à `evenements_proches` : c'est elle qui sert « Maintenant »,
-- et son comportement hyper-local est voulu. On ajoute une porte à côté, qui
-- pose une question différente — non pas « qu'y a-t-il à moins de N km ? »
-- mais « qu'y a-t-il dans MON BASSIN ? ». La distance n'y entre pas : c'est
-- l'appartenance territoriale qui décide, et c'est exactement ce que « Pour
-- toi » demande. Le classement, lui, continue de pondérer la distance.

create or replace function public.evenements_bassin(
  p_group_slug text,
  p_limite integer default 300,
  p_inclure_publications boolean default true
) returns table(
  id uuid, publication_id uuid, title text, description text, category text,
  start_at timestamptz, end_at timestamptz, timezone text, temporal_status text,
  date_confidence text, place_name text, address text, city text, insee_code text,
  lat double precision, lng double precision, primary_source text, source_url text,
  image_url text, image_source text, image_source_url text, image_author text,
  image_license text, image_updated_at timestamptz, cancelled boolean,
  last_source_update timestamptz, last_synced_at timestamptz,
  announced_at timestamptz, presale_at timestamptz, tickets_open_at timestamptz,
  announcement_tags text[], importance_level text, importance_score integer,
  performers text[], organizer text, ticket_url text, announcement_provenance jsonb,
  metro_area text, territory_slug text, territory_distance_km double precision
)
language sql
stable
set search_path to ''
as $function$
  with parametres as materialized (
    select now() as instant, public.event_soon_window() as soon_window
  ),
  candidats as materialized (
    select e.*, basin.group_slug, basin.slug as territory_slug, basin.distance_km,
      case
        when e.start_at is null or coalesce(e.date_confidence,'unknown')='unknown' then 'unknown_date'
        when e.end_at is not null and e.end_at < p.instant then 'past'
        when e.start_at <= p.instant and e.end_at is null then 'unknown_date'
        when e.start_at <= p.instant and e.end_at >= p.instant
          then case when coalesce(e.cancelled,false) then 'past'
                    when e.date_confidence='exact' then 'now' else 'unknown_date' end
        when e.start_at > p.instant and e.start_at - p.instant <= p.soon_window then 'soon'
        else 'upcoming' end as statut
    from public.events e
    cross join parametres p
    left join lateral (
      select t.group_slug, t.slug, 6371*2*asin(least(1,sqrt(
        power(sin(radians(t.latitude-e.lat)/2),2)
        + cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
      ))) as distance_km
      from public.territories t
      where t.active and t.status='active' and t.group_slug is not null
        and 6371*2*asin(least(1,sqrt(
          power(sin(radians(t.latitude-e.lat)/2),2)
          + cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
        ))) <= t.radius_km
      order by distance_km, t.radius_km limit 1
    ) basin on true
    where e.duplicate_of is null and e.geom is not null
      and (p_inclure_publications or e.publication_id is null)
      and basin.group_slug = p_group_slug
  )
  select c.id, c.publication_id, c.title, c.description, c.category, c.start_at, c.end_at,
    c.timezone, c.statut, c.date_confidence, c.place_name, c.address, c.city, c.insee_code,
    c.lat, c.lng, c.primary_source, c.source_url, c.image_url, c.image_source,
    c.image_source_url, c.image_author, c.image_license, c.image_updated_at, c.cancelled,
    c.last_source_update, c.last_synced_at,
    c.announced_at, c.presale_at, c.tickets_open_at, c.announcement_tags,
    c.importance_level, c.importance_score, c.performers, c.organizer, c.ticket_url,
    c.announcement_provenance,
    c.group_slug, c.territory_slug, c.distance_km
  from candidats c
  where c.statut <> 'past'
  order by case c.statut when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,
           c.start_at nulls last
  limit least(greatest(coalesce(p_limite,300),1),500);
$function$;

comment on function public.evenements_bassin(text, integer, boolean) is
  'Les événements à venir d''un bassin territorial entier, sans plafond de distance. Sert « Pour toi » ; « Maintenant » continue de passer par evenements_proches.';

grant execute on function public.evenements_bassin(text, integer, boolean) to anon, authenticated;
