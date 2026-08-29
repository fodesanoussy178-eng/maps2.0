-- Le rectangle métropolitain complet ne tient pas dans une seule invocation.
--
-- Mesuré : la fonction, lancée sur 50,44–50,82 / 2,68–3,32, est morte en
-- WORKER_RESOURCE_LIMIT (HTTP 546) — deux fois, le 27 août et aujourd'hui.
-- L'ancien rectangle, lui, passait en 43 secondes pour 202 objets. Ce n'est
-- pas la métropole qui est trop grande, c'est UNE requête pour toute la
-- métropole qui l'est : dix pages de deux cents POI, plus un aller-retour
-- REST par événement, dans un seul worker.
--
-- La fonction sait déjà faire autrement : elle itère sur `event_areas` et
-- accepte `?area=<code>`. On découpe donc la métropole en cinq rectangles
-- qui se complètent sans se recouvrir. `lille` reprend exactement son
-- rectangle d'origine — celui dont on a la preuve qu'il passe — et quatre
-- couronnes couvrent ce qu'il laissait dehors :
--
--            2,68        2,90            3,25   3,32
--   50,82  +-------------+---------------+------+
--          |             |   mel-nord    |      |
--   50,75  |  mel-ouest  +---------------+ mel- |
--          |             |    lille      | est  |
--   50,55  |             +---------------+      |
--          +-------------+---------------+------+
--   50,44  |            mel-sud                 |
--          +------------------------------------+
--
-- Les cinq portent la MÊME liste de communes : le rectangle sert à découper
-- le travail, la liste décide seule de ce qu'on garde. Une couronne qui
-- échoue n'emporte pas les autres, et chacune peut être relancée seule.
--
-- Les 28 communes que l'ancien rectangle laissait dehors, mesurées sur les
-- centres officiels (API Géo de l'État) : Allennes-les-Marais, Annœullin,
-- Armentières, Aubers, Bauvin, Bois-Grenier, Bousbecque, Carnin, Don,
-- Erquinghem-Lys, Fournes-en-Weppes, Fromelles, Halluin, Hantay, Herlies,
-- Illies, La Bassée, La Chapelle-d'Armentières, Le Maisnil, Marquillies,
-- Neuville-en-Ferrain, Provin, Radinghem-en-Weppes, Sainghin-en-Weppes,
-- Salomé, Seclin, Wervicq-Sud, Wicres.

update public.event_areas
   set min_lat = 50.55, max_lat = 50.75, min_lng = 2.90, max_lng = 3.25,
       name = 'Métropole de Lille — cœur', updated_at = now()
 where code = 'lille';

insert into public.event_areas (code, name, timezone, min_lat, max_lat, min_lng, max_lng,
                                enabled, priorite, insee_codes, commune_keys)
select v.code, v.name, 'Europe/Paris', v.min_lat, v.max_lat, v.min_lng, v.max_lng,
       true, v.priorite, a.insee_codes, a.commune_keys
from (values
  ('mel-nord',  'Métropole de Lille — nord',  50.75, 50.82, 2.90, 3.25, 11),
  ('mel-sud',   'Métropole de Lille — sud',   50.44, 50.55, 2.68, 3.32, 12),
  ('mel-ouest', 'Métropole de Lille — ouest', 50.55, 50.82, 2.68, 2.90, 13),
  ('mel-est',   'Métropole de Lille — est',   50.55, 50.82, 3.25, 3.32, 14)
) as v(code, name, min_lat, max_lat, min_lng, max_lng, priorite)
cross join (select insee_codes, commune_keys from public.event_areas where code = 'lille') a
on conflict (code) do update
   set name = excluded.name, min_lat = excluded.min_lat, max_lat = excluded.max_lat,
       min_lng = excluded.min_lng, max_lng = excluded.max_lng, enabled = true,
       priorite = excluded.priorite, insee_codes = excluded.insee_codes,
       commune_keys = excluded.commune_keys, updated_at = now();
