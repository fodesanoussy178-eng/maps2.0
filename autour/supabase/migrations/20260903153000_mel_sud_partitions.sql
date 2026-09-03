/* Une couronne sud reste trop dense dans certains catalogues même après la
   première coupe. Ces huit emprises remplacent les quatre rectangles sud
   utilisés par le workflow ; elles conservent le même registre communal MEL.
 */

insert into public.event_areas (
  code, zone_id, name, min_lat, min_lng, max_lat, max_lng,
  insee_codes, commune_keys, timezone, enabled, sync_partition, priorite
)
select p.code, 'mel', p.name, p.min_lat, p.min_lng, p.max_lat, p.max_lng,
       a.insee_codes, a.commune_keys, a.timezone, true, true, p.priorite
from (
  values
    ('mel_sud_ouest_bas_ouest', 'MEL — sud-ouest bas ouest', 50.44::double precision, 2.68::double precision, 50.495::double precision, 2.84::double precision, 41),
    ('mel_sud_ouest_bas_est',   'MEL — sud-ouest bas est',   50.44::double precision, 2.84::double precision, 50.495::double precision, 3.00::double precision, 42),
    ('mel_sud_est_bas_ouest',   'MEL — sud-est bas ouest',   50.44::double precision, 3.00::double precision, 50.495::double precision, 3.16::double precision, 43),
    ('mel_sud_est_bas_est',     'MEL — sud-est bas est',     50.44::double precision, 3.16::double precision, 50.495::double precision, 3.32::double precision, 44),
    ('mel_sud_ouest_haut_ouest', 'MEL — sud-ouest haut ouest', 50.495::double precision, 2.68::double precision, 50.55::double precision, 2.84::double precision, 45),
    ('mel_sud_ouest_haut_est',   'MEL — sud-ouest haut est',   50.495::double precision, 2.84::double precision, 50.55::double precision, 3.00::double precision, 46),
    ('mel_sud_est_haut_ouest',   'MEL — sud-est haut ouest',   50.495::double precision, 3.00::double precision, 50.55::double precision, 3.16::double precision, 47),
    ('mel_sud_est_haut_est',     'MEL — sud-est haut est',     50.495::double precision, 3.16::double precision, 50.55::double precision, 3.32::double precision, 48)
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
