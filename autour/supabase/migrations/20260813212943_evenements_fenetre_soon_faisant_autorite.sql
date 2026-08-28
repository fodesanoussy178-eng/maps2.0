-- La fenêtre « soon » doit valoir la même chose pour tout le monde.
--
-- En SECURITY INVOKER, `event_soon_window()` lisait `event_settings` sous la
-- RLS de l'appelant. Pour anon, cette table n'est pas lisible : le select ne
-- rendait rien, le coalesce retombait sur 24 h, et le réglage produit était
-- donc SANS EFFET pour les visiteurs tout en paraissant configurable. Le jour
-- où quelqu'un l'aurait passé à 6 h, le serveur aurait dit 6 h et chaque
-- navigateur 24 h, sans qu'aucune erreur ne le signale.
--
-- SECURITY DEFINER : la fonction ne prend aucun paramètre, ne lit qu'une ligne
-- de configuration et ne rend qu'un interval. Elle n'expose rien.
create or replace function public.event_soon_window()
returns interval
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select valeur::interval from public.event_settings where cle = 'soon_window'),
    interval '24 hours');
$$;

grant execute on function public.event_soon_window() to anon, authenticated;

-- `evenements_proches` peut dès lors redevenir SECURITY INVOKER : elle n'avait
-- besoin des droits du propriétaire que pour atteindre ce réglage. Les
-- événements, eux, sont lisibles publiquement par policy.
create or replace function public.evenements_proches(
  p_sud     double precision,
  p_ouest   double precision,
  p_nord    double precision,
  p_est     double precision,
  p_statuts text[]  default array['now','soon','upcoming','unknown_date'],
  p_limite  integer default 120,
  p_inclure_publications boolean default false
)
returns table (
  id                 uuid,
  publication_id     uuid,
  title              text,
  description        text,
  category           text,
  start_at           timestamptz,
  end_at             timestamptz,
  timezone           text,
  temporal_status    text,
  date_confidence    text,
  place_name         text,
  address            text,
  city               text,
  insee_code         text,
  lat                double precision,
  lng                double precision,
  primary_source     text,
  source_url         text,
  image_url          text,
  cancelled          boolean,
  last_source_update timestamptz,
  last_synced_at     timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id, e.publication_id, e.title, e.description, e.category,
         e.start_at, e.end_at, e.timezone,
         public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                      e.cancelled, now()) as temporal_status,
         e.date_confidence,
         e.place_name, e.address, e.city, e.insee_code,
         e.lat, e.lng, e.primary_source, e.source_url, e.image_url,
         e.cancelled, e.last_source_update, e.last_synced_at
    from public.events e
   where e.lat between p_sud and p_nord
     and e.lng between p_ouest and p_est
     and (p_inclure_publications or e.publication_id is null)
     and public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                      e.cancelled, now())
         = any (coalesce(p_statuts, array['now','soon','upcoming','unknown_date']))
   order by
     case public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                       e.cancelled, now())
       when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,
     e.start_at nulls last
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$$;

comment on function public.evenements_proches is
  'Événements canoniques d''une emprise, statut recalculé à l''instant de l''appel. Le client ne décide plus du temps.';

revoke all on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean) from public;
grant execute on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean) to anon, authenticated;
