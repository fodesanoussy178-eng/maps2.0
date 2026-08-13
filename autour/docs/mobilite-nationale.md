# Couche mobilité nationale — audit historique et pistes futures

> **État produit depuis la passe de simplification.** Autour ne maintient plus
> de moteur voiture ou transports publics. Les parcours internes sont limités
> à la marche et au vélo. Voiture et transports ouvrent désormais Google Maps,
> Apple Plans ou Waze. Les propositions d'architecture ci-dessous sont donc des
> recherches archivées, pas l'architecture active du produit.

Document préalable à toute implémentation. Il répond aux huit points demandés
avant modification du code. **Aucun déploiement en production n'est proposé
ici** : chaque phase se termine par une validation explicite.

> **Limite de cet audit.** L'environnement où il a été produit n'a pas accès
> à `transport.data.gouv.fr` (tunnel HTTPS refusé). Les schémas d'API décrits
> plus bas sont donc des hypothèses de travail, à confronter au Swagger
> officiel avant d'écrire le premier client. Tout ce qui concerne le dépôt
> lui-même a été vérifié directement dans le code.

---

## 1. Audit de l'architecture existante

| Élément | État constaté |
|---|---|
| Application | Page statique unique. `autour/index.html` ≈ 5 500 lignes, sans build ni bundler. |
| Logique métier | `autour/core.js` : classification, déduplication, classement. `autour/index.html` : parcours internes marche/vélo et liens vers les applications externes. |
| Tests | `node --test autour/tests/*.mjs` — 50 tests, verts. Pas de CI détectée. |
| Backend | **Aucune Edge Function.** Le répertoire `supabase/functions` n'existe pas. |
| Données consommées | Overpass, Nominatim, OpenAgenda, Google Places, tuiles Carto/OSM, Supabase — **toutes appelées depuis le navigateur**. |

### Conséquence structurante

L'application n'a aujourd'hui **aucun étage serveur capable de faire un
import**. Or la demande impose l'inverse : ne jamais exposer les fichiers
nationaux au frontend. La première phase n'est donc pas une fonctionnalité,
c'est la création de cet étage. Tant qu'il n'existe pas, aucun des points
D, E et F n'est réalisable proprement.

---

## 2. Routeur actuel (marche et vélo)

Défini dans `autour/index.html:2939` :

```js
const OSRM_PROFILS = {
  pied:    "https://routing.openstreetmap.de/routed-foot/route/v1/foot/",
  velo:    "https://routing.openstreetmap.de/routed-bike/route/v1/bike/"
};
```

- Serveurs de démonstration publics FOSSGIS/OpenStreetMap.de, sans clé.
- Le code les qualifie lui-même de « non garantis pour un usage intensif ».
- Repli existant : ligne droite + vitesse moyenne, signalé à l'affichage
  (`segmentTrajet`, timeout 6 s).

**Trois limites qui pèsent sur la demande :**

1. Ces serveurs sont inadaptés à un appel par résultat de recherche. Le
   classement par ETA multiplie les requêtes ; il faut un routeur maîtrisé
   ou un cache serveur agressif.
2. OSRM ne renvoie ni horaires ni transport en commun. Autour délègue donc ces
   trajets aux applications cartographiques externes.
3. **Le « % du trajet sur aménagement cyclable » ne peut pas venir d'OSRM.**
   Il faut croiser la géométrie de l'itinéraire avec la BNAC en PostGIS
   (`ST_Intersection` sur un tampon de quelques mètres). C'est un calcul
   serveur, pas une option de routage.

---

## 3. Tables Supabase existantes

Deux domaines cohabitent dans le dépôt, et **aucun n'est géospatial**.

**Domaine mission/marketplace** (`supabase/migrations/`) — sans rapport avec
la mobilité : `profiles`, `structures`, `missions`, `mission_days`,
`applications`, `payments`, `lemonway_accounts`, `ratings`,
`reliability_disputes`, `delay_notices`, `reports`.

**Domaine Autour** (`autour/supabase/migrations/`) : table `publications`
(les créations utilisateur), interrogée par bounding box.

Constats déterminants :

- **PostGIS n'est pas installé.** Seule `pgcrypto` est activée
  (`supabase/migrations/0001_schema.sql:6`).
- `publications` stocke `lat` / `lng` en `double precision`, et le filtrage
  se fait par `where p.lat between … and p.lng between …` — donc **sans
  index spatial**.

Il n'y a rien à réutiliser pour la mobilité : tout le schéma est à créer.

---

## 4. Schéma SQL proposé

Préalable : `create extension if not exists postgis;`

Toutes les géométries en **SRID 4326**, colonnes `geography` quand le calcul
métrique compte, `geometry` pour les linéaires à afficher.

### 4.1 Catalogue et fraîcheur

Ces deux tables sont le cœur de l'architecture nationale : elles évitent la
liste de réseaux codée en dur et portent la traçabilité (licence, date de
mise à jour) exigée au point Sécurité.

```sql
create table mobility_dataset (
  id                bigserial primary key,
  pan_dataset_id    text not null unique,   -- identifiant transport.data.gouv.fr
  title             text not null,
  data_type         text not null,          -- public-transit | bike-data | gbfs | cycling
  formats           text[] not null default '{}',
  licence           text,                   -- jamais supposée : lue au catalogue
  publisher         text,
  aom_siren         text,                   -- autorité organisatrice
  coverage          geometry(MultiPolygon,4326),
  national          boolean not null default false,
  updated_at        timestamptz,
  checked_at        timestamptz
);
create index on mobility_dataset using gist (coverage);
create index on mobility_dataset (data_type);

create table mobility_resource (
  id                bigserial primary key,
  dataset_id        bigint not null references mobility_dataset(id) on delete cascade,
  url               text not null,
  format            text not null,          -- GTFS | gtfs-rt | gbfs | parquet | geojson
  realtime_kind     text,                   -- trip-updates | vehicle-positions | service-alerts | siri-et | siri-sx
  etag              text,                   -- import conditionnel
  last_modified     text,
  content_hash      text,
  imported_at       timestamptz,
  last_error        text,
  last_error_at     timestamptz             -- journalisation par provider
);
create unique index on mobility_resource (dataset_id, url);
```

### 4.2 Transport public (GTFS statique)

Sous-ensemble strictement utile au porte-à-porte — inutile d'importer tout
le GTFS.

```sql
create table transit_stop (
  id            bigserial primary key,
  dataset_id    bigint not null references mobility_dataset(id) on delete cascade,
  stop_id       text not null,
  name          text not null,
  location      geography(Point,4326) not null,
  parent_station text,
  unique (dataset_id, stop_id)
);
create index on transit_stop using gist (location);

create table transit_route (
  id            bigserial primary key,
  dataset_id    bigint not null references mobility_dataset(id) on delete cascade,
  route_id      text not null,
  short_name    text,
  long_name     text,
  route_type    int,
  unique (dataset_id, route_id)
);

create table transit_trip (
  id            bigserial primary key,
  dataset_id    bigint not null references mobility_dataset(id) on delete cascade,
  trip_id       text not null,
  route_id      text not null,
  service_id    text not null,
  headsign      text,
  unique (dataset_id, trip_id)
);

-- table volumineuse : partitionner par dataset_id si le pilote s'étend
create table transit_stop_time (
  dataset_id    bigint not null references mobility_dataset(id) on delete cascade,
  trip_id       text not null,
  stop_id       text not null,
  stop_sequence int  not null,
  arrival_s     int  not null,   -- secondes depuis minuit, gère les 25:10:00
  departure_s   int  not null,
  primary key (dataset_id, trip_id, stop_sequence)
);
create index on transit_stop_time (dataset_id, stop_id, departure_s);

create table transit_calendar (
  dataset_id    bigint not null references mobility_dataset(id) on delete cascade,
  service_id    text not null,
  days          boolean[7] not null,
  start_date    date not null,
  end_date      date not null,
  primary key (dataset_id, service_id)
);

create table transit_calendar_date (
  dataset_id    bigint not null references mobility_dataset(id) on delete cascade,
  service_id    text not null,
  date          date not null,
  exception_type smallint not null,   -- 1 ajout, 2 suppression
  primary key (dataset_id, service_id, date)
);
```

### 4.3 Aménagements cyclables (BNAC)

Conforme à la table demandée, complétée de ce qu'exige la performance.

```sql
create table cycling_infrastructure (
  id                bigserial primary key,
  source_id         text,
  dataset_id        bigint references mobility_dataset(id) on delete cascade,
  geometry          geometry(LineString,4326) not null,
  type              text,        -- piste | bande | voie_verte | velorue |
                                 -- voie_partagee | double_sens | provisoire | aucun
  direction         text,
  status            text,
  surface           text,
  width             numeric,
  local_authority   text,
  insee_code        text,
  source_updated_at timestamptz,
  imported_at       timestamptz not null default now()
);
create index on cycling_infrastructure using gist (geometry);
create index on cycling_infrastructure (insee_code);
create index on cycling_infrastructure (type);
```

Fonction d'exposition demandée, avec simplification selon le zoom :

```sql
create or replace function get_cycling_infrastructure(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision,
  simplify_m double precision default 0,
  max_rows int default 2000
) returns table (id bigint, type text, direction text, status text, geometry jsonb)
language sql stable parallel safe as $$
  select c.id, c.type, c.direction, c.status,
         st_asgeojson(
           case when simplify_m > 0
                then st_simplifypreservetopology(c.geometry, simplify_m / 111000.0)
                else c.geometry end
         )::jsonb
  from cycling_infrastructure c
  where c.geometry && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  limit max_rows;
$$;
```

> Le paramètre `simplify_m` est ajouté à la signature demandée : sans lui, un
> dézoom sur une métropole renvoie des géométries brutes et la carte tombe.
> À valider — c'est un écart assumé par rapport à la spécification.

### 4.4 Stationnement vélo et libre-service

```sql
create table bike_parking (
  id            bigserial primary key,
  dataset_id    bigint references mobility_dataset(id) on delete cascade,
  source_id     text,
  location      geography(Point,4326) not null,
  kind          text,      -- arceau | rack | box | abri
  capacity      int,
  covered       boolean,
  access        text,      -- public | prive
  secured       boolean,
  source_updated_at timestamptz
);
create index on bike_parking using gist (location);

create table shared_mobility_system (
  id            bigserial primary key,
  system_id     text not null unique,
  dataset_id    bigint references mobility_dataset(id) on delete cascade,
  name          text,
  territory     text,
  feed_url      text not null,
  vehicle_types text[],
  coverage      geometry(MultiPolygon,4326),
  last_updated  timestamptz
);
create index on shared_mobility_system using gist (coverage);

-- état temps réel : réécrit à chaque rafraîchissement, jamais historisé
create table shared_mobility_station (
  system_id       text not null references shared_mobility_system(system_id) on delete cascade,
  station_id      text not null,
  name            text,
  location        geography(Point,4326) not null,
  capacity        int,
  bikes_available int,
  ebikes_available int,
  docks_available int,
  renting         boolean,
  returning       boolean,
  reported_at     timestamptz not null,   -- fraîcheur affichée à l'utilisateur
  primary key (system_id, station_id)
);
create index on shared_mobility_station using gist (location);
```

**Règle transverse, à imposer par le schéma :** toute donnée servie porte
`reported_at` / `source_updated_at` et une qualification de fraîcheur. Aucune
table ne stocke un « prochain passage » calculé sans source.

---

## 5. Edge Functions et tâches planifiées

Découpage aligné sur les modules demandés. Cadences calées sur la volatilité
réelle de chaque flux.

| Fonction | Module | Déclenchement | Rôle |
|---|---|---|---|
| `catalog-sync` | `NationalTransportCatalogService` | cron quotidien | Interroge le PAN, met à jour `mobility_dataset` / `mobility_resource`, enregistre **licence et couverture**. |
| `gtfs-import` | `GtfsImporter` | cron quotidien, **import conditionnel** ETag/Last-Modified | Télécharge et normalise le GTFS des datasets couvrant les territoires actifs. |
| `gtfs-rt` | `GtfsRealtimeClient` | à la demande, cache 20–30 s | Décode TripUpdates / VehiclePositions / ServiceAlerts. |
| `siri-lite` | `SiriLiteClient` | à la demande, cache 20–30 s | Alternative quand GTFS-RT est absent. |
| `cycling-import` | `CyclingInfrastructureImporter` | cron hebdomadaire | Sélectionne la ressource **Parquet** la plus récente, importe en PostGIS. Jamais côté navigateur. |
| `gbfs-refresh` | `GbfsProviderResolver` + `SharedMobilityService` | cron ~1 min sur zones actives | Rafraîchit `shared_mobility_station` pour les seuls systèmes couvrant des utilisateurs actifs. |
| `trip-plan` | `MobilityRecommendationEngine` | non retenu dans l'architecture active | Ancienne piste pour composer un ETA porte-à-porte multimodal. |

Règles communes non négociables : timeout par appel, retries avec backoff
exponentiel, erreurs journalisées dans `mobility_resource.last_error`, et
**isolation des pannes** — un fournisseur muet dégrade son seul mode.

### Point d'attention sur `gbfs-refresh`

Un cron à la minute sur tous les systèmes français est un gaspillage et un
risque de blocage côté fournisseurs. Le déclencheur doit être la **demande**
(zone consultée récemment), pas le calendrier. À arbitrer en phase 4.

---

## 6. Licences et attributions

| Source | Licence attendue | Obligation |
|---|---|---|
| BNAC (via Geovelo, dérivé OSM) | ODbL | Attribution **OpenStreetMap + Geovelo**, et partage à l'identique des dérivés. |
| GTFS / GTFS-RT par réseau | Variable (ODbL ou Licence Ouverte selon le producteur) | **Ne jamais supposer** : lire le champ licence du catalogue, le stocker, l'afficher. |
| SNCF | À vérifier sur la fiche dataset | Idem. |
| GBFS | Variable par opérateur | Idem, et respect des conditions d'usage du flux. |
| Fonds de carte OSM | ODbL | Attribution déjà présente dans l'application. |

Deux conséquences concrètes :

1. La colonne `mobility_dataset.licence` n'est pas décorative : c'est elle
   qui alimente l'écran de crédits. Un dataset sans licence lue ne doit pas
   être servi.
2. **L'ODbL est virale.** Croiser la BNAC avec nos propres données produit
   une base dérivée soumise à partage à l'identique. Ce point mérite une
   décision explicite avant la phase 3, pas après.

---

## 7. Plan d'intégration par phases

Chaque phase est livrable seule et se termine par une validation.

**Phase 0 — Fondations** *(prérequis absolu)*
Activer PostGIS. Créer le premier répertoire `supabase/functions`. Poser
`mobility_dataset` / `mobility_resource` et `catalog-sync`.
*Validation : le catalogue se peuple, licences et couvertures comprises.*

**Phase 1 — Résolution par territoire**
`TransitDatasetResolver` : depuis une position, retrouver les datasets
couvrants, priorité à l'autorité organisatrice locale. Cette piste supposerait
de recréer un moteur interne et n'est donc pas retenue dans le produit actuel.
*Validation : à Lille et dans une seconde métropole, le résolveur désigne le
bon réseau sans une ligne de code spécifique à la ville.*

**Phase 2 — Transport public réel**
`gtfs-import`, puis `gtfs-rt` / `siri-lite`. Calcul porte-à-porte complet et
affichage qualifié : « temps réel », « horaire prévu », « indisponible ».
*Validation : un trajet lillois vérifié à la main contre l'application
officielle du réseau.*

**Phase 3 — Aménagements cyclables**
`cycling-import` en Parquet + `get_cycling_infrastructure`. Rendu par type.
Calcul du pourcentage sur aménagement par intersection PostGIS.
*Validation : la carte tient au dézoom métropole ; décision ODbL tranchée.*

**Phase 4 — Stationnement et libre-service**
`bike_parking`, GBFS via `SharedMobilityProvider`, V'Lille découvert **par le
catalogue** et non codé en dur.
*Validation : disponibilités et fraîcheur affichées, aucun flux GBFS appelé
depuis le navigateur.*

**Phase 5 — Arbitrage multimodal**
`MobilityRecommendationEngine` : comparer marche, vélo, transport ; classer
les lieux sur l'accessibilité réelle. Le socle existe déjà — `rankResults`
consomme un ETA et écarte ce qui sera fermé à l'arrivée.
*Validation : jeu de scénarios de bout en bout.*

### Dépendance à trancher tôt

Le routeur. OSRM public ne tiendra ni la charge du classement par ETA ni le
calcul vélo détaillé. Trois options, à décider **avant la phase 2** :
héberger OSRM, passer par un service routé avec clé, ou limiter le nombre de
destinations routées par recherche. C'est le principal risque du plan.

---

## 8. Déploiement

Aucune mise en production sans validation de la phase correspondante. Ordre
imposé : migrations d'abord, fonctions ensuite, activation côté client en
dernier — le frontend ne doit jamais appeler une fonction non déployée.

Un point est à surveiller : la clé de service Supabase utilisée par les
imports ne doit exister que côté Edge Function. L'application Autour est une
page statique où toute clé embarquée est publique.

---

## État actuel du code

- `autour/index.html` : routage interne OSRM marche/vélo uniquement.
- Voiture : liens Google Maps, Apple Plans et Waze, destination renseignée.
- Transports publics : liens Google Maps et Apple Plans, origine et destination
  renseignées.
- Les arrêts et stations restent classifiés pour la découverte et les fiches,
  mais sont masqués dans Explorer tant qu'ils ne sont pas demandés.
- `autour/core.js` reste le moteur de classement et de recommandations ; cette
  passe ne modifie pas ses règles métier.
