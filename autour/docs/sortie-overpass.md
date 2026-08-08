# Sortir Overpass du chemin critique du client

État au 8 août 2026. Ce document est un **audit + un plan**, pas une migration
déjà faite. Rien n'a été déplacé côté serveur à ce stade : le client interroge
toujours Overpass directement. Le but est de décrire précisément ce qu'il
faudrait déplacer, dans quel ordre, et ce que ça coûte.

## Ce que le client demande aujourd'hui

Cinq appels sortants vers `overpass-api.de` existent dans `index.html`. Ils
passent tous par la même fonction `overpass(q, msMax, signal)`.

| Où | Requête | Volume | Déclenché par |
|---|---|---|---|
| `vraisLieux()` | `nwr(bbox)[k~"^(v\|v)$"]` sur ~40 couples clé/valeur, `out center 300` | jusqu'à 300 objets | ouverture de l'app, déplacement de carte (350 ms de repos), changement de zone |
| `chargerPourCats()` | même forme, restreinte aux catégories demandées | ~300 objets | ouverture d'un besoin, recherche par catégorie |
| aide (`chargerAide`) | `social_facility`, `amenity=social_*`, `office=charity`… | ~200 objets | activation du mode Aide, puis rechargement au-delà de 5 km |
| arrêts (`lignesAutour`) | `nwr[public_transport=stop_position\|platform]` + `rel(bn)[type=route]` | 2 requêtes | couche transports, calcul d'itinéraire |
| repli (`q2`) | version dégradée de `q1` quand la première expire | — | timeout de 14 s |

Ordres de grandeur mesurés en local sur une zone dense (Tourcoing centre,
rayon 2,5 km) : **43 objets bruts** pour la requête généraliste, **1,4 s**
entre le lancement et `fresh_pois_ready`. L'écran n'attend pas ce délai —
`ui_ready` tombe à ~70 ms et le cache local peuple l'accueil à ~400 ms — mais
chaque téléphone qui ouvre l'application déclenche sa propre requête.

## Pourquoi ça ne tient pas à l'échelle

1. **Politique d'usage.** Les instances publiques Overpass sont prévues pour
   des usages ponctuels. Un client mobile qui requête à chaque déplacement de
   carte est exactement le profil que la politique décourage. Une montée en
   charge se traduit par des 429 puis des blocages d'IP, côté utilisateur.
2. **Latence non maîtrisée.** 1,4 s en local, plusieurs secondes en heure
   pleine, et des timeouts réguliers — d'où la requête de repli déjà présente.
3. **Aucune mutualisation.** Deux personnes du même quartier paient deux fois
   la même requête. Le cache est local à chaque appareil (`localStorage`,
   40 tuiles, éviction LRU).
4. **Aucun enrichissement possible.** Tant que la donnée transite sans être
   stockée, on ne peut ni corriger une fiche, ni la croiser avec OpenAgenda,
   ni marquer un point d'aide comme périmé.

## Cible

```
OSM (Overpass / extraits Geofabrik) ─┐
OpenAgenda                           ├─→ ingestion serveur (cron)
GBFS / autres sources                ─┘        │
                                               ▼
                                    Supabase + PostGIS
                                    (catalogue géographique)
                                               │
                                     cache géographique Autour
                                        (tuiles, TTL par source)
                                               │
                                               ▼
                                            client
```

Overpass devient une **source d'ingestion** appelée par un travail planifié,
pas une API interrogée par chaque téléphone.

## Ce qui existe déjà et qu'il faut réutiliser

- `supabase/functions/catalog-sync/` : une fonction Edge d'ingestion, déjà
  écrite, avec son module `catalog.mjs`.
- `supabase/migrations/20260807120000_mobility_phase0_catalogue.sql` : la table
  de catalogue de la phase 0.
- `docs/mobilite-nationale.md` : le cadrage de la couche mobilité.
- Côté client, l'entonnoir est déjà unique : `fusionner()` → `normaliserItem()`
  → `lieux`. **Changer de source ne demande de toucher qu'à `vraisLieux()`.**
  C'est le point important : le travail est côté serveur, pas côté écran.

## Étapes, de la moins chère à la plus chère

### 1. Mesurer avant de bouger (quelques heures)
Compter les requêtes Overpass réellement émises par session en production
(le jalon `overpass_done` existe déjà ; il suffit de le remonter). Sans ce
chiffre, on ne saura pas si l'étape 2 suffit.

### 2. Un proxy en cache devant Overpass (1 à 2 jours)
Une fonction Edge `osm-tile` qui prend `(z, x, y, catégories)`, requête
Overpass si la tuile est absente ou périmée, stocke le résultat en base, et
répond. TTL suggéré : 7 jours pour les commerces, 1 jour pour l'aide.

Bénéfice immédiat : la charge Overpass devient proportionnelle au nombre de
**tuiles** consultées, plus au nombre d'ouvertures d'application. Côté client,
une seule fonction change.

**C'est l'étape qui règle 90 % du problème.** Les suivantes ne sont utiles
qu'au-delà.

### 3. Ingestion programmée des zones actives (2 à 3 jours)
Un cron qui rafraîchit les tuiles déjà demandées au moins une fois. Overpass
n'est alors plus jamais sur le chemin d'une requête utilisateur.

### 4. PostGIS et requêtes géographiques (1 semaine)
`ST_DWithin` sur un index GiST, réponse filtrée côté serveur par catégorie et
par rayon. Permet de servir « les 40 lieux les plus pertinents » au lieu de
300 objets bruts, donc de diviser la charge réseau du client.

⚠️ PostGIS est déjà installé sur le projet Supabase existant. **Ne pas le
réinstaller et ne pas supposer son schéma** (il n'est ni dans `public` ni
forcément dans `gis`) : lire `pg_extension` avant d'écrire la moindre
migration.

### 5. Corrections et enrichissements (au-delà)
Une fois la donnée stockée : signaler un point d'aide périmé, fusionner
manuellement deux fiches, ajouter un horaire vérifié.

## Ce qu'il ne faut pas faire

- Migrer les cinq appels d'un coup. L'étape 2 seule change l'ordre de
  grandeur ; les étapes 3 à 5 sont des améliorations, pas des prérequis.
- Supprimer l'appel Overpass direct avant que le proxy soit éprouvé. Le garder
  en repli coûte quelques lignes et évite un écran vide le jour où la fonction
  Edge tombe.
- Reprendre le pipeline client. `fusionner`/`normaliserItem`/`rankResults` sont
  agnostiques de la source ; c'est précisément ce qui rend cette migration
  possible sans toucher à l'interface.
