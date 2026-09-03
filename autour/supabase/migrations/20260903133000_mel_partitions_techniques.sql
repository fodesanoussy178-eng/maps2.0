/* La MEL reste une seule zone produit. Son emprise centrale est toutefois
   assez fournie pour dépasser le budget d'un worker quand elle est traitée
   seule ; ces quatre rectangles sont des partitions de collecte disjointes.
   La liste des communes reste celle de la MEL, donc le découpage ne peut pas
   élargir le périmètre métier.
 */

insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng,
  insee_codes, commune_keys, timezone, enabled, sync_partition, priorite
)
select p.code, 'mel', p.name, p.min_lat, p.min_lng, p.max_lat, p.max_lng,
       a.insee_codes, a.commune_keys, a.timezone, true, true, p.priorite
from (
  values
    ('mel_centre_nord_ouest', 'MEL — centre nord-ouest', 50.65::double precision, 2.90::double precision, 50.75::double precision, 3.075::double precision, 11),
    ('mel_centre_nord_est',   'MEL — centre nord-est',   50.65::double precision, 3.075::double precision, 50.75::double precision, 3.25::double precision, 12),
    ('mel_centre_sud_ouest',  'MEL — centre sud-ouest',  50.55::double precision, 2.90::double precision, 50.65::double precision, 3.075::double precision, 13),
    ('mel_centre_sud_est',    'MEL — centre sud-est',    50.55::double precision, 3.075::double precision, 50.65::double precision, 3.25::double precision, 14)
) as p(code, name, min_lat, min_lng, max_lat, max_lng, priorite)
cross join lateral (
  select insee_codes, commune_keys, timezone
    from public.event_areas
   where code = 'mel'
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
