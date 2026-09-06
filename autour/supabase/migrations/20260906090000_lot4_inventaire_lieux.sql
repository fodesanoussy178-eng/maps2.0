-- ---------------------------------------------------------------------------
-- LOT 4 — L'INVENTAIRE PERSISTANT DES LIEUX
--
-- CE QUI MANQUAIT
--
-- Autour persistait ses événements — `events` + `event_sources`, 3 200 lignes
-- et quatre catalogues rapprochés — mais aucun lieu. Un musée, une salle, une
-- bibliothèque n'existaient que le temps d'une session : reconstruits à chaque
-- ouverture depuis Overpass, Google Places et DATAtourisme, autour d'un POINT
-- et dans un RAYON, jamais mémorisés. D'où l'absence d'identité stable : le
-- même lieu changeait d'identifiant d'une session à l'autre, et rien ne
-- pouvait s'accrocher à lui durablement.
--
-- Cette migration ne change pas ce que l'application affiche. Elle lui donne
-- une mémoire : UN LIEU RÉEL = UNE IDENTITÉ INTERNE DURABLE.
--
--
-- CE QUI N'EST PAS COPIÉ, ET POURQUOI
--
-- OpenStreetMap / Overpass : RIEN n'entre ici. Persister OSM ferait de cette
--   table une base dérivée, avec l'obligation de partage à l'identique d'ODbL
--   sur toute la base canonique. La décision n'est pas prise, donc rien n'est
--   écrit. Overpass reste la source live complémentaire qu'il est aujourd'hui,
--   inchangée, servie par `/api/lieux`.
--
-- Google Places : RIEN, pas même un `place_id`. Le dépôt applique déjà cette
--   règle côté client (`sansPhotoGoogle`, `estContenuGoogle`) ; elle vaut ici
--   aussi. Google ne devient jamais l'identité d'un lieu d'Autour : `places.id`
--   est un UUID interne, et lui seul.
--
-- L'AFFICHE D'UN ÉVÉNEMENT N'EST PAS LA PHOTO DU LIEU. `events.image_url` est
--   l'affiche d'un concert, pas une vue de la salle. La recopier illustrerait
--   un lieu avec l'image d'autre chose — exactement ce que le Lot 3 interdit.
--   Le premier remplissage laisse donc les colonnes image VIDES, et les cartes
--   retombent sur la tuile de catégorie, qui est une réponse honnête.
--   Idem pour `description` : celle d'un événement décrit l'événement.
--
--
-- CE QUI EST RÉUTILISÉ PLUTÔT QUE RÉÉCRIT
--
-- Le schéma décalque `events`/`event_sources`, éprouvés en production :
-- même forme de provenance (`UNIQUE(source, external_id)`), même géométrie
-- (`ST_SetSRID(ST_MakePoint(lng, lat), 4326)` sous `search_path` incluant
-- `topology`), même normalisation de commune par `mel_communes` et
-- `commune_cle`, même `duplicate_of`, mêmes horodatages.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. LA LOGIQUE TERRITORIALE, FACTORISÉE PLUTÔT QUE DUPLIQUÉE
--
-- `events_assigner_zone()` portait le rattachement aux zones Autour dans son
-- corps. Les lieux ont besoin du même rattachement, et une seconde copie de
-- cette formule serait une seconde vérité : le jour où l'une bouge, un lieu et
-- un événement au même endroit tomberaient dans deux zones différentes.
--
-- La formule est donc sortie telle quelle dans une fonction, et
-- `events_assigner_zone()` l'appelle désormais. Vérifié AVANT d'écrire cette
-- migration : la fonction reproduit `events.zone_id` sur les 3 220 événements
-- géolocalisés, sans une seule divergence.
--
-- CE QU'ELLE NE FAIT PAS, ET C'EST LE POINT : elle ne crée aucune zone. Hors
-- du rayon des cinq zones actives, elle rend NULL. Une source qui mentionne
-- une ville inconnue ne fabrique donc pas de territoire — l'invariant posé au
-- Lot 1 vaut pour les lieux comme il vaut pour les IP.
-- ---------------------------------------------------------------------------

create or replace function public.zone_autour_pour(
  p_lat double precision,
  p_lng double precision)
returns text
language sql
stable
set search_path to 'public'
as $function$
  select z.zone_id
    from public.autour_zones z
   where z.active
     and p_lat is not null and p_lng is not null
     and 6371 * 2 * asin(least(1, sqrt(
       power(sin(radians(z.latitude - p_lat) / 2), 2)
       + cos(radians(p_lat)) * cos(radians(z.latitude))
         * power(sin(radians(z.longitude - p_lng) / 2), 2)
     ))) <= z.radius_km
   order by 6371 * 2 * asin(least(1, sqrt(
     power(sin(radians(z.latitude - p_lat) / 2), 2)
     + cos(radians(p_lat)) * cos(radians(z.latitude))
       * power(sin(radians(z.longitude - p_lng) / 2), 2)
   )))
   limit 1;
$function$;

create or replace function public.events_assigner_zone()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.area_id is not null then
    select a.zone_id into new.zone_id
      from public.event_areas a
     where a.id = new.area_id;
  end if;
  if new.zone_id is null then
    new.zone_id := public.zone_autour_pour(new.lat, new.lng);
  end if;
  return new;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 2. LES CLÉS : NOM NORMALISÉ, CLÉ D'ENRICHISSEMENT, CLÉ DE DÉDOUBLONNAGE
--
-- `place_cle` REPRODUIT `cleLieu` DE `enrichissements.js`, À LA LETTRE.
-- C'est le pont vers `place_enrichments`, qui est indexée sur cette clé et sur
-- rien d'autre. Une divergence, même d'un caractère, ferait lire un cache que
-- personne ne remplit — la panne silencieuse par excellence.
-- Vérifié avant d'écrire cette migration : la fonction reproduit les 44
-- `place_key` réellement présentes en base, 44 sur 44.
--
-- La clé porte les coordonnées à quatre décimales, soit une dizaine de mètres.
-- Un lieu qui bouge un peu CHANGE donc de `place_key` — c'est pour cela que
-- `places.place_keys` est un tableau : on garde les anciennes, sinon un lieu
-- recalé de quinze mètres perdrait son enrichissement au passage.
-- ---------------------------------------------------------------------------

create or replace function public.place_nom_normalise(p_nom text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(translate(coalesce(p_nom, ''),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
    '[^a-z0-9]+', ' ', 'g'),
    '\m(le|la|les|l|un|une|des|du|de|d|au|aux|the|a)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$function$;

comment on function public.place_nom_normalise(text) is
  'Normalisation des noms de lieux. Miroir exact de normaliserNom() dans enrichissements.js.';

create or replace function public.place_cle(
  p_nom text,
  p_lat double precision,
  p_lng double precision)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when public.place_nom_normalise(p_nom) is null
      or length(public.place_nom_normalise(p_nom)) < 2
      or p_lat is null or p_lng is null
      then null
    else replace(public.place_nom_normalise(p_nom), ' ', '-')
         || '@' || trim(to_char(round(p_lat::numeric, 4), 'FM9990.0000'))
         || ',' || trim(to_char(round(p_lng::numeric, 4), 'FM9990.0000'))
  end;
$function$;

comment on function public.place_cle(text, double precision, double precision) is
  'Clé de place_enrichments. Miroir exact de cleLieu() dans enrichissements.js — vérifié sur les 44 clés existantes.';

-- La clé de dédoublonnage exacte : elle n'attrape que les répétitions
-- rigoureusement identiques. Le vrai rapprochement — celui qui tolère quelques
-- mètres d'écart — se fait dans `places_ingerer`, par une recherche de
-- voisinage. Cette clé-ci n'est qu'un garde-fou bon marché contre la même
-- ligne insérée deux fois.
create or replace function public.place_dedup_key(
  p_nom text,
  p_commune text,
  p_lat double precision,
  p_lng double precision)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when public.place_nom_normalise(p_nom) is null
      or p_lat is null or p_lng is null then null
    else public.place_nom_normalise(p_nom)
         || '|' || coalesce(public.commune_cle(p_commune), '')
         || '|' || round(p_lat::numeric, 4)
         || '|' || round(p_lng::numeric, 4)
  end;
$function$;


-- ---------------------------------------------------------------------------
-- 3. `places` — L'INVENTAIRE
--
-- L'IDENTITÉ EST L'UUID, PAS LE SLUG. Le slug est lisible, il sert à écrire
-- une adresse ; il est calculé UNE FOIS à l'insertion et ne bouge plus. Un nom
-- corrigé, une adresse précisée, des coordonnées recalées ne changent ni
-- l'UUID ni le slug : ce serait perdre l'identité au moment même où l'on
-- améliore la fiche.
-- ---------------------------------------------------------------------------

create table if not exists public.places (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  name_normalized   text,

  lat               double precision,
  lng               double precision,
  geom              topology.geometry(Point, 4326),

  address           text,
  postal_code       text,
  city              text,
  commune           text,
  insee_code        text,
  zone_id           text references public.autour_zones(zone_id),

  category          text,
  description       text,
  opening_hours     text,
  official_url      text,

  -- LES ENTRÉES DU RÉSOLVEUR, PAS SEULEMENT SA SORTIE.
  -- `images.js` ne lit pas une URL toute faite : il part des tags portés par
  -- l'objet (`image`, `wikimedia_commons`, `wikidata`) et remonte jusqu'à une
  -- licence lisible. Stocker la seule `image_url` finale ferait perdre cette
  -- traçabilité et rendrait impossible de refaire le calcul quand les règles
  -- changent. On garde donc les deux : les entrées ici,
  image_refs        jsonb not null default '{}'::jsonb,
  -- et le visuel résolu là, dans exactement les colonnes qu'`events` utilise
  -- déjà, pour que le rendu du Lot 3 s'en serve sans une ligne de plus.
  image_url         text,
  image_source      text,
  image_source_url  text,
  image_author      text,
  image_license     text,
  image_updated_at  timestamptz,

  -- Le pont vers `place_enrichments`. Un tableau, parce que la clé dépend des
  -- coordonnées : un lieu recalé en gagne une nouvelle sans perdre l'ancienne.
  place_keys        text[] not null default '{}'::text[],

  dedup_key         text,
  duplicate_of      uuid references public.places(id),
  -- Comment l'identité de cette ligne a été établie la dernière fois.
  --   exact      — par `source` + `external_id`, sans heuristique
  --   matched    — par nom normalisé + commune + voisinage immédiat
  --   probable   — réservé : aucun rapprochement de ce niveau n'est produit
  --                aujourd'hui, et on n'en invente pas pour remplir la case
  --   unresolved — plusieurs candidats plausibles : on garde tout le monde
  --                séparé plutôt que de fusionner deux lieux différents
  match_status      text not null default 'exact'
                    check (match_status in ('exact','matched','probable','unresolved')),

  -- Un fournisseur muet ne fait pas disparaître un lieu. Il fait vieillir sa
  -- dernière observation, et c'est tout ce que ce lot décide.
  status            text not null default 'active'
                    check (status in ('active','stale','disabled')),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.places is
  'Inventaire canonique des lieux. Un lieu réel = un UUID durable, indépendant de ses fournisseurs. Ni OSM ni Google n''y entrent (voir la migration).';

create unique index if not exists places_dedup_key_idx
  on public.places (dedup_key) where dedup_key is not null;
create index if not exists places_geom_gist on public.places using gist (geom);
create index if not exists places_geography_gist
  on public.places using gist ((geom::topology.geography));
create index if not exists places_zone_idx
  on public.places (zone_id, category) where status <> 'disabled';
create index if not exists places_commune_idx
  on public.places (commune) where commune is not null;
create index if not exists places_nom_idx on public.places (name_normalized);
create index if not exists places_keys_gin on public.places using gin (place_keys);
create index if not exists places_duplicate_idx
  on public.places (duplicate_of) where duplicate_of is not null;


-- ---------------------------------------------------------------------------
-- 4. `place_sources` — LA PROVENANCE, QUI NE DISPARAÎT PAS DANS L'IDENTITÉ
--
-- Même forme que `event_sources`, pour la même raison : un lieu peut être
-- décrit par plusieurs catalogues, et l'identifiant de chacun doit rester
-- lisible séparément. On ne fond jamais un identifiant externe dans l'UUID
-- d'Autour — sinon on ne sait plus resynchroniser sans créer un doublon.
-- ---------------------------------------------------------------------------

create table if not exists public.place_sources (
  id                bigint generated always as identity primary key,
  place_id          uuid not null references public.places(id) on delete cascade,
  source            text not null,
  external_id       text not null,
  source_url        text,
  raw_data          jsonb,
  source_updated_at timestamptz,
  first_seen_at     timestamptz not null default now(),
  synced_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (source, external_id)
);

comment on table public.place_sources is
  'Provenances d''un lieu canonique. UNIQUE(source, external_id) : niveau 1 du rapprochement, sans heuristique. Table privée.';

create index if not exists place_sources_place_idx on public.place_sources (place_id);
create index if not exists place_sources_source_idx on public.place_sources (source);


-- ---------------------------------------------------------------------------
-- 5. LE DÉCLENCHEUR : GÉOMÉTRIE, COMMUNE, ZONE, SLUG
--
-- Décalque de `events_avant_ecriture`, aux mêmes conventions. Le slug n'est
-- calculé qu'à l'INSERTION : c'est ce qui garantit qu'une correction de nom ne
-- déplace pas l'adresse d'un lieu déjà publié.
-- ---------------------------------------------------------------------------

create or replace function public.places_avant_ecriture()
returns trigger
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  m record;
  base text;
begin
  new.geom := case
    when new.lat is null or new.lng is null then null
    else ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)
  end;

  new.name_normalized := public.place_nom_normalise(new.name);

  -- La commune, par la même table de normalisation que les événements.
  select mc.nom, mc.associee into m
    from public.mel_communes mc
   where mc.cle = public.commune_cle(coalesce(new.commune, new.city));
  if found then
    new.commune := m.nom;
    if not m.associee and new.city is null then new.city := m.nom; end if;
  end if;

  new.zone_id := coalesce(new.zone_id, public.zone_autour_pour(new.lat, new.lng));
  new.dedup_key := public.place_dedup_key(new.name, new.commune, new.lat, new.lng);

  -- La clé d'enrichissement du moment rejoint les précédentes sans en chasser
  -- aucune : c'est ce qui fait survivre le cache à un recalage de coordonnées.
  if public.place_cle(new.name, new.lat, new.lng) is not null
     and not (public.place_cle(new.name, new.lat, new.lng) = any(new.place_keys)) then
    new.place_keys := new.place_keys || public.place_cle(new.name, new.lat, new.lng);
  end if;

  if tg_op = 'INSERT' and new.slug is null then
    base := coalesce(
      nullif(replace(coalesce(new.name_normalized, ''), ' ', '-'), ''),
      'lieu');
    new.slug := left(base, 60)
      || coalesce('-' || nullif(public.commune_slug(new.commune), ''), '')
      -- Le suffixe vient de l'UUID : court, lisible, et stable pour toujours
      -- puisque l'UUID ne change jamais.
      || '-' || substr(md5(new.id::text), 1, 6);
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists places_avant_ecriture on public.places;
create trigger places_avant_ecriture
  before insert or update on public.places
  for each row execute function public.places_avant_ecriture();


-- ---------------------------------------------------------------------------
-- 6. SÉCURITÉ — LA POSTURE DU LOT S, APPLIQUÉE D'EMBLÉE
--
-- `places` : lecture publique, et RIEN d'autre. Les grants d'écriture sont
--   révoqués explicitement plutôt que laissés à la seule RLS : une table sans
--   policy d'écriture est protégée, mais son ACL dit le contraire de la
--   vérité, et c'est ce que le Lot S a corrigé partout ailleurs.
--
-- `place_sources` : privée de bout en bout, comme `event_sources`. Ni lecture
--   ni écriture pour `anon` et `authenticated` — aucune policy, aucun grant.
--   Les identifiants de fournisseurs et les charges brutes ne sont pas des
--   données de produit.
-- ---------------------------------------------------------------------------

alter table public.places enable row level security;
alter table public.place_sources enable row level security;

drop policy if exists "lieux: lecture publique" on public.places;
create policy "lieux: lecture publique" on public.places
  for select using (true);

revoke all on public.places from anon, authenticated;
grant select on public.places to anon, authenticated;
grant all on public.places to service_role;

revoke all on public.place_sources from anon, authenticated, public;
grant all on public.place_sources to service_role;
grant usage, select on sequence public.place_sources_id_seq to service_role;
