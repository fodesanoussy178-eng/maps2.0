/* Généralisation nationale du même pipeline.

   Ces lignes décrivent des zones géographiques, pas des catalogues éditoriaux.
   Le synchroniseur DATAtourisme parcourt toutes les zones actives avec le même
   normaliseur ; les lieux permanents continuent d'arriver par les providers
   existants. Aucun événement n'est fabriqué ici et aucun agenda local n'est
   copié en dur.
 */

insert into public.territories (
  slug, name, country, latitude, longitude, radius_km, timezone,
  group_slug, status, active, metadata
)
values
  ('marseille', 'Marseille', 'FR', 43.2965, 5.3698, 18, 'Europe/Paris', 'marseille', 'active', true,
   '{"insee_code":"13055","validation_scope":"france_nationale"}'::jsonb),
  ('rennes', 'Rennes', 'FR', 48.1173, -1.6778, 15, 'Europe/Paris', 'rennes', 'active', true,
   '{"insee_code":"35238","validation_scope":"france_nationale"}'::jsonb)
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

insert into public.event_areas (
  code, name, min_lat, min_lng, max_lat, max_lng, insee_codes, timezone, enabled, priorite
)
values
  ('angers', 'Angers et son agglomération', 47.38, -0.72, 47.58, -0.42, array['49007'], 'Europe/Paris', true, 70),
  ('rennes', 'Rennes et son agglomération', 48.02, -1.82, 48.22, -1.52, array['35238'], 'Europe/Paris', true, 80)
on conflict (code) do update set
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

insert into public.territory_sources (
  territory_id, provider, source_identifier, source_name, active, priority, metadata
)
select t.id, 'datatourisme', 'national-feed', 'DATAtourisme national', true, 500,
       '{"orchestration_status":"active","selection":"event_areas","catalogue":"entertainmentAndEvent"}'::jsonb
from public.territories t
where t.slug in ('tourcoing', 'paris', 'marseille', 'rennes', 'angers')
on conflict (territory_id, provider, source_identifier) do update set
  source_name = excluded.source_name,
  active = true,
  priority = excluded.priority,
  metadata = public.territory_sources.metadata || excluded.metadata,
  updated_at = now();
