-- ===========================================================================
-- LE CONTEXTE TERRITORIAL TEMPORAIRE — 2/3 : le premier cas réel
--
-- Ce sont des DONNÉES. Dates et horaires vérifiés sur lille.fr : samedi
-- 5 septembre 2026 8h → dimanche 6 septembre 2026 18h (34 heures).
-- Un UPDATE suffit à les corriger, sans déploiement ni migration.
-- ===========================================================================

insert into public.territorial_contexts (
  slug, name, emoji, starts_at, ends_at, preview_starts_at, timezone,
  territory_id, active, priority, official_url, metadata
)
select
  'braderie-lille-2026',
  'Braderie de Lille 2026',
  '🧺',
  timestamptz '2026-09-05 08:00:00+02',
  timestamptz '2026-09-06 18:00:00+02',
  timestamptz '2026-08-31 00:00:00+02',
  'Europe/Paris',
  t.id,
  true,
  10,
  'https://www.lille.fr/Braderie-de-Lille',
  jsonb_build_object(
    'libelle', 'Braderie',
    'sources_officielles', jsonb_build_array('braderie_lille', 'ville_de_lille'),
    'rayon_visibilite_m', 25000,
    'horaires', 'samedi 5 septembre 8h → dimanche 6 septembre 18h (34 heures)',
    'source_dates', 'https://www.lille.fr/Braderie-de-Lille/Actualites/Dates-de-la-Braderie-de-Lille-2026',
    'source_perimetre', 'https://www.lille.fr/Braderie-de-Lille/Plan-de-la-Braderie-de-Lille-2026',
    'note', 'dates et périmètre = données, pas code : un UPDATE suffit à les corriger'
  )
from public.territories t
where t.slug = 'lille'
on conflict (slug) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  preview_starts_at = excluded.preview_starts_at,
  territory_id = excluded.territory_id,
  active = excluded.active,
  priority = excluded.priority,
  official_url = excluded.official_url,
  metadata = public.territorial_contexts.metadata || excluded.metadata,
  updated_at = now();

-- Les secteurs sont ceux que la Ville de Lille décrit : Vieux-Lille,
-- Lille-Centre et Wazemmes–Gambetta pour l'emprise, puis les axes et les
-- rendez-vous thématiques. Ce ne sont donc plus des quartiers choisis par
-- nous, mais la découpe officielle de la manifestation.
--
-- CE QUI RESTE UNE APPROXIMATION, ET IL FAUT LE DIRE : la GÉOMÉTRIE. La Ville
-- publie son plan en image, pas en données ouvertes — rien de lisible par une
-- machine n'existe pour ce périmètre. Chaque secteur est donc posé par un
-- centre et un rayon, et `metadata.geometrie` le déclare. Le jour où le
-- contour est publié, il se pose dans `contour` et remplace le cercle sans
-- toucher à une ligne de code.
with zones(slug, name, lat, lng, radius_m, priority, secteur) as (
  values
    ('centre',                'Lille-Centre — Grand’Place',
     50.6371, 3.0630, 800, 10, 'coeur_du_perimetre'),
    ('vieux-lille',           'Vieux-Lille',
     50.6437, 3.0622, 750, 20, 'riverains_et_commercants'),
    ('wazemmes-gambetta',     'Wazemmes — Gambetta',
     50.6268, 3.0512, 850, 30, 'coeur_du_perimetre'),
    ('liberte',               'Boulevard de la Liberté',
     50.6337, 3.0561, 800, 40, 'brocanteurs_professionnels'),
    ('champ-de-mars',         'Champ-de-Mars — Président Kennedy',
     50.6412, 3.0497, 800, 50, 'brocanteurs_extension'),
    ('saint-sauveur',         'Gare Saint-Sauveur',
     50.6287, 3.0728, 500, 60, 'braderie_des_enfants'),
    ('republique-beaux-arts', 'République — Palais des Beaux-Arts',
     50.6303, 3.0619, 500, 70, 'braderie_de_la_bd'),
    ('louis-xiv',             'Boulevard Louis XIV — Porte de Paris',
     50.6257, 3.0682, 650, 80, 'brocanteurs_professionnels')
)
insert into public.territorial_context_zones (
  context_id, slug, name, lat, lng, radius_m, priority, metadata
)
select c.id, z.slug, z.name, z.lat, z.lng, z.radius_m, z.priority,
       jsonb_build_object(
         'geometrie', 'approximation_centre_rayon',
         'secteur', z.secteur,
         'source', 'https://www.lille.fr/Braderie-de-Lille/Plan-de-la-Braderie-de-Lille-2026',
         'remplacer_par', 'contour officiel dès publication en données ouvertes')
from zones z
cross join public.territorial_contexts c
where c.slug = 'braderie-lille-2026'
on conflict (context_id, slug) do update set
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  radius_m = excluded.radius_m,
  priority = excluded.priority,
  metadata = public.territorial_context_zones.metadata || excluded.metadata,
  updated_at = now();

-- LA CONFIGURATION FAIT AUTORITÉ, Y COMPRIS PAR CE QU'ELLE NE CONTIENT PLUS.
-- Un secteur retiré du plan officiel doit disparaître du périmètre, pas y
-- survivre parce qu'un INSERT antérieur l'y avait posé. Sans cette ligne, le
-- rejeu de la migration laisserait des zones fantômes — et une zone fantôme
-- fait entrer dans le périmètre quelqu'un qui n'y est pas.
delete from public.territorial_context_zones z
using public.territorial_contexts c
where z.context_id = c.id
  and c.slug = 'braderie-lille-2026'
  and z.slug not in (
    'centre', 'vieux-lille', 'wazemmes-gambetta', 'liberte',
    'champ-de-mars', 'saint-sauveur', 'republique-beaux-arts', 'louis-xiv'
  );
