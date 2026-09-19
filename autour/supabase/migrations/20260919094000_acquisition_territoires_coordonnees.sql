-- OVERPASS NE TROUVE PAS UNE AIRE PAR SON NOM DE FAÇON FIABLE.
--
-- `area["name"="Tourcoing"]["boundary"="administrative"]` a rendu ZÉRO entité
-- en exécution. Autour interroge déjà Overpass depuis des années, et il ne
-- procède jamais ainsi : `autour/api/lieux.js` utilise `around:<rayon>,<lat>,
-- <lng>`, qui ne dépend d'aucune base d'aires ni d'aucune orthographe.
--
-- Il faut donc des coordonnées par territoire. Ce n'est PAS une duplication de
-- `territories` : les trois territoires internationaux n'y ont aucune ligne --
-- Autour n'y synchronise rien -- et c'est justement là que la requête OSM est
-- la seule source. Pour les territoires français, la valeur est recopiée une
-- fois depuis `territories`, qui reste la source.

alter table public.acquisition_territoires
  add column if not exists lat       double precision,
  add column if not exists lng       double precision,
  add column if not exists rayon_km  double precision not null default 10;

comment on column public.acquisition_territoires.lat is
  'Centre de la requête Overpass (around:), la seule forme qui marche de façon fiable. Recopiée de territories pour la France ; saisie pour l''international, qui n''y a pas de ligne.';

-- France : on reprend ce que `territories` sait déjà.
update public.acquisition_territoires a
set lat = t.latitude, lng = t.longitude, rayon_km = coalesce(t.radius_km, 12)
from public.territories t
where a.lat is null and a.pays = 'FR'
  and lower(t.name) = lower(a.ville) and t.active;

-- Les villes françaises qu'Autour ne synchronise pas encore.
update public.acquisition_territoires set lat = 45.7640, lng = 4.8357,  rayon_km = 12 where slug = 'fr-lyon'        and lat is null;
update public.acquisition_territoires set lat = 43.6047, lng = 1.4442,  rayon_km = 12 where slug = 'fr-toulouse'    and lat is null;
update public.acquisition_territoires set lat = 44.8378, lng = -0.5792, rayon_km = 12 where slug = 'fr-bordeaux'    and lat is null;
update public.acquisition_territoires set lat = 47.2184, lng = -1.5536, rayon_km = 12 where slug = 'fr-nantes'      and lat is null;
update public.acquisition_territoires set lat = 48.5734, lng = 7.7521,  rayon_km = 10 where slug = 'fr-strasbourg'  and lat is null;
update public.acquisition_territoires set lat = 43.6108, lng = 3.8767,  rayon_km = 10 where slug = 'fr-montpellier' and lat is null;
update public.acquisition_territoires set lat = 45.1885, lng = 5.7245,  rayon_km = 10 where slug = 'fr-grenoble'    and lat is null;

-- L'international : aucune ligne dans `territories`, donc la donnée vit ici.
update public.acquisition_territoires set lat = 50.8476, lng = 4.3572,   rayon_km = 8  where slug = 'be-bruxelles';
update public.acquisition_territoires set lat = 46.2044, lng = 6.1432,   rayon_km = 6  where slug = 'ch-geneve';
update public.acquisition_territoires set lat = 45.5019, lng = -73.5674, rayon_km = 10 where slug = 'ca-montreal';

-- `fr-national` reste SANS coordonnées, volontairement : un pays n'a pas de
-- centre utile pour `around:`. La fonction Edge doit donc refuser la source OSM
-- pour ce territoire et le dire -- pas interroger le point (0, 0).
