/* Les quatre couronnes historiques restent dans la zone MEL, mais certaines
   dépassent encore le budget d'un worker. On les coupe en dix emprises
   techniques disjointes, toujours avec la liste officielle des communes.
 */

insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng,
  insee_codes, commune_keys, timezone, enabled, sync_partition, priorite
)
select p.code, 'mel', p.name, p.min_lat, p.min_lng, p.max_lat, p.max_lng,
       a.insee_codes, a.commune_keys, a.timezone, true, true, p.priorite
from (
  values
    ('mel_nord_ouest', 'MEL — couronne nord-ouest', 50.75::double precision, 2.90::double precision, 50.82::double precision, 3.075::double precision, 31),
    ('mel_nord_est',   'MEL — couronne nord-est',   50.75::double precision, 3.075::double precision, 50.82::double precision, 3.25::double precision, 32),
    ('mel_sud_ouest_bas',  'MEL — couronne sud-ouest basse', 50.44::double precision, 2.68::double precision, 50.495::double precision, 3.00::double precision, 33),
    ('mel_sud_est_bas',    'MEL — couronne sud-est basse',   50.44::double precision, 3.00::double precision, 50.495::double precision, 3.32::double precision, 34),
    ('mel_sud_ouest_haut', 'MEL — couronne sud-ouest haute', 50.495::double precision, 2.68::double precision, 50.55::double precision, 3.00::double precision, 35),
    ('mel_sud_est_haut',   'MEL — couronne sud-est haute',   50.495::double precision, 3.00::double precision, 50.55::double precision, 3.32::double precision, 36),
    ('mel_ouest_sud', 'MEL — couronne ouest sud', 50.55::double precision, 2.68::double precision, 50.685::double precision, 2.90::double precision, 37),
    ('mel_ouest_nord', 'MEL — couronne ouest nord', 50.685::double precision, 2.68::double precision, 50.82::double precision, 2.90::double precision, 38),
    ('mel_est_sud', 'MEL — couronne est sud', 50.55::double precision, 3.25::double precision, 50.685::double precision, 3.32::double precision, 39),
    ('mel_est_nord', 'MEL — couronne est nord', 50.685::double precision, 3.25::double precision, 50.82::double precision, 3.32::double precision, 40)
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
