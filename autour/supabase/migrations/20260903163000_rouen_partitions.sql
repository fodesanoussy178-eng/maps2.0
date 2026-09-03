/* Rouen reste une zone produit unique. Quatre emprises techniques réduisent
   le temps d'inactivité d'une requête DATAtourisme trop lente sur le rectangle
   complet, sans modifier la liste des communes autorisées.
 */

insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng,
  insee_codes, commune_keys, timezone, enabled, sync_partition, priorite
)
select p.code, 'rouen', p.name, p.min_lat, p.min_lng, p.max_lat, p.max_lng,
       a.insee_codes, a.commune_keys, a.timezone, true, true, p.priorite
from (
  values
    ('rouen_nord_ouest', 'Rouen — nord-ouest', 49.445::double precision, 0.95::double precision, 49.55::double precision, 1.10::double precision, 61),
    ('rouen_nord_est',   'Rouen — nord-est',   49.445::double precision, 1.10::double precision, 49.55::double precision, 1.25::double precision, 62),
    ('rouen_sud_ouest',  'Rouen — sud-ouest',  49.34::double precision, 0.95::double precision, 49.445::double precision, 1.10::double precision, 63),
    ('rouen_sud_est',    'Rouen — sud-est',    49.34::double precision, 1.10::double precision, 49.445::double precision, 1.25::double precision, 64)
) as p(code, name, min_lat, min_lng, max_lat, max_lng, priorite)
cross join lateral (
  select insee_codes, commune_keys, timezone
    from public.event_areas
   where code = 'rouen'
   limit 1
) a
on conflict (code) do update set
  zone_id = excluded.zone_id,
  name = excluded.name,
  min_lat = excluded.min_lat,
  min_lng = excluded.min_lng,
  max_lat = excluded.max_lat,
  max_lng = excluded.max_lng,
  insee_codes = excluded.insee_codes,
  commune_keys = excluded.commune_keys,
  timezone = excluded.timezone,
  enabled = true,
  sync_partition = true,
  priorite = excluded.priorite,
  updated_at = now();
