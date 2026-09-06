# Lot 6 · Phase 0 — audit du chemin de données d'Explorer

Écrit **avant toute modification**. Tout ce qui suit a été mesuré, pas déduit.

## Comment cet audit a été fait

Quatre largeurs — 390, 430, 834, 1280 — sur la livraison réellement construite
(`livraison/`, servie en statique), avec un **contexte strictement identique** :

| | valeur forcée aux 4 largeurs |
|---|---|
| position | `50.6292, 3.0573` (Lille centre) |
| origine de position | `manual` |
| zone | `mel` |
| créneau | `maintenant` |
| rayon | celui que l'application choisit elle-même (voir plus bas) |
| intention | la même, cliquée dans le même panneau |

`sbLecture.rpc` est intercepté pour **journaliser les arguments** et renvoyer
les **12 lignes réelles** que la vraie base a rendues pour ce point
(`lieux_explorer('mel', null, 50.6292, 3.0573, null, 12, true)`) — Supabase est
hors d'atteinte depuis l'environnement d'exécution. Le runtime (`permanentPlaces`,
`datatourismePlaces`) reçoit un jeu **fixe et identique** aux quatre largeurs :
si une largeur diverge, c'est l'application qui diverge, pas les données.

## 1. Le chemin réel, largeur par largeur

Il n'existe **qu'un seul** appel à l'inventaire, et il vient d'un seul endroit :
`ouvrirExplorerDecouverte()` → `remplirLieuxExplorer(null)` → `chargerLieuxExplorer()`.

Mesuré :

| | 390 | 430 | 834 | 1280 |
|---|---|---|---|---|
| `body[data-layout]` | mobile | mobile | tablet | desktop |
| source utilisée | **places** | **places** | **places** | **places** |
| `p_zone_id` | mel | mel | mel | mel |
| `p_lat` / `p_lng` | 50.6292 / 3.0573 | idem | idem | idem |
| `p_rayon_m` | **null** | null | null | null |
| `p_limite` | 12 | 12 | 12 | 12 |
| `p_visuel_exige` | true | true | true | true |
| `p_famille` | null | null | null | null |
| candidats renvoyés | 12 | 12 | 12 | 12 |
| résultats affichés | 12 | 12 | 12 | 12 |
| erreurs console | 0 | 0 | 0 | 0 |

IDs et ordre retournés — **identiques aux quatre largeurs, dans le même ordre** :

```
f3e54b83  Théâtre Sébastopol                            culture       event_poster  hours: null
277de1a4  Théâtre Sébastopol Lille Nord Haut de France  culture       event_poster  hours: null
c6d6c4cf  Chez Max                                      restauration  —             hours: null
7d8ac642  Les Oiseaux                                   restauration  —             hours: null
46d4d373  Les Casseroles Lilloises                      restauration  —             hours: null
7535b15f  Jost Hotel Lille Wazemmes                     hebergement   —             hours: null
d385bda0  Palais des beaux arts                         culture       event_poster  hours: null
4c93e322  L'Gaïette                                     restauration  —             hours: null
6cdd3ea7  Brit Hôtel Lille Centre                       hebergement   —             hours: null
c71fd40a  BioBurger                                     restauration  —             hours: null
6f8484a5  Happy Moov                                    nature        —             hours: null
ce08ddc3  Ô Cercle                                      restauration  —             hours: null
```

**L'invariant de parité est tenu sur ce chemin.** Il n'y a aucune branche de
largeur dans `chargerLieuxExplorer` : le contexte vient de `pointDeReference()`
et `idZoneActive()`, qui ne connaissent pas la largeur de l'écran. Mobile et
desktop appellent la même fonction avec les mêmes arguments et affichent les
mêmes entités dans le même ordre. Il n'existe pas de « mobile → places,
desktop → autre moteur ».

Une seule différence observée, et elle n'est pas métier : à 390 et 430 la
mention « Affiche d'un événement ici » avait déjà disparu au moment de la
lecture du DOM, à 834 et 1280 elle était encore là. C'est le `onerror` de
l'image : les URLs OpenAgenda ne se chargent pas depuis ce bac à sable, la
mention part avec l'image, et les deux premières largeurs avaient simplement
été lues après le `onerror`. Même code, même règle, timing différent.

## 2. Le fallback runtime

`LIEUX_EXPLORER_MIN = 3`. En dessous de trois lignes rendues par la base, la
bande se cache (`zone.hidden = true`) et les sources live gardent la main.
Vérifié dans les deux sens au Lot 5 : 4 lignes → `dernierRecoursExplorer =
"places"` ; 2 lignes → `"runtime"`, bande masquée.

C'est bien un filet de sécurité et non un moteur divergent : le runtime ne
rend jamais la bande `#xpLieux`, il alimente la carte et les résultats, comme
avant le Lot 5.

## 3. Le trou réel : les intentions ne lisent pas l'inventaire

C'est le constat le plus important de cet audit, et il ne concerne pas la
parité.

`XP_INTENTIONS`, `XP_SELECTIONS` et `XP_THEMES` passent tous par
`lancerDepuisExplorer()` → `appliquerPhrase(phrase)`, c'est-à-dire la recherche
textuelle sur le tableau `lieux` du runtime. Mesuré aux quatre largeurs, en
cliquant « Nature et balades » puis « Étudier / travailler » :

| | 390 | 430 | 834 | 1280 |
|---|---|---|---|---|
| appels RPC déclenchés | **aucun** | aucun | aucun | aucun |
| candidats runtime | 6 | 6 | 6 | 6 |
| résultats | 0 | 0 | 0 | 0 |

Aucune intention n'interroge `places`. L'inventaire n'alimente que la bande
non filtrée en bas du panneau, et le seul chemin filtré par famille
(`ouvrirFamilleExplorer`) vient de la capsule du Lot 5, pas des sélections.

Conséquence directe : « Nature » ne peut pas privilégier les lieux réellement
nature de l'inventaire, puisqu'elle ne le lit pas. C'est le §5 du Lot 6.

(Les 0 résultats viennent du jeu runtime de test — des lieux permanents sans
horaires, que « Maintenant » ne peut pas déclarer ouverts. Le chiffre qui
compte ici est le **0 appel RPC**, identique partout.)

## 4. Ce que la bande montre aujourd'hui, et pourquoi c'est un problème

Sur les 12 lignes rendues au centre de Lille : **6 restaurants, 2 hôtels**,
2 fiches du même théâtre, 1 musée, et « Happy Moov » — une entreprise de
taxi-vélo classée `nature`. C'est exactement l'annuaire que le §5 interdit.

Trois défauts distincts, tous visibles sur ces 12 lignes :

1. **Doublon non rapproché.** `f3e54b83` « Théâtre Sébastopol » et `277de1a4`
   « Théâtre Sébastopol Lille Nord Haut de France » ont les **mêmes
   coordonnées** et la même famille. Le rapprochement du Lot 4 travaille sur le
   nom normalisé : les deux noms diffèrent, donc aucun des deux n'est
   `duplicate_of` l'autre, et Explorer montre deux fois le même théâtre.
2. **Classement fautif.** « Happy Moov » est une prestation de visite, pas un
   parc. `place_famille_depuis_nom` / `_depuis_types` l'a rangée en `nature`.
3. **Aucune intention.** L'ordre est la distance pure, donc le centre-ville
   remonte ce qu'il y a de plus dense : la restauration.

## 5. Images — état mesuré et sources réellement disponibles

Sur les **464 lieux éligibles** à Explorer (actifs, non satellites, classés,
géolocalisés) :

| | mesuré |
|---|---|
| avec une image | 146 |
| dont `place_photo` | **0** |
| dont `wikimedia` | **0** |
| dont `institutional` | **0** |
| dont `event_poster` | **146** (100 % des images) |
| sans image | 318 |

Autrement dit, l'échelle de priorité du Lot 5 est en place mais son sommet est
vide : **aucune photo de lieu n'existe dans l'inventaire**.

Sources auditées, et ce qu'elles donnent réellement :

| source | testée comment | rendement mesuré |
|---|---|---|
| DATAtourisme (route `/api/datatourisme` existante) | appel réel en production, 49 POI autour de Lille | **0 image** passant la porte de licence, **0 horaire** |
| `place_sources.raw_data` | inspection des 859 lignes | ne contient que `type` (datatourisme) ou `evenements` (autour_events) — la charge riche n'a pas été conservée |
| Wikimedia Commons (geosearch) | `pg_net` → API Commons, 200 OK | 0 fichier géolocalisé à 200 m du Théâtre Sébastopol, 0 à 300 m du Palais des Beaux-Arts — Commons seul ne suffit pas |
| **Wikidata (P18)** | `pg_net` → SPARQL, 200 OK | **1 520 items avec image dans un rayon de 15 km autour de Lille** |
| Google Places | — | interdit à la persistance, règle inchangée |

Le SPARQL de test autour du Palais des Beaux-Arts rend bien
`palais des Beaux-Arts de Lille (Q2628596)` avec sa façade — **et rend aussi**
la préfecture et la station de métro dans le même rayon de 300 m. C'est la
preuve, dès l'audit, qu'un rapprochement par la seule proximité fabriquerait
des photos fausses : le nom devra être exigé, pas seulement la distance.

## 6. Horaires — état mesuré

`places.opening_hours` : **0 ligne sur 823**.

| source | testée comment | rendement |
|---|---|---|
| DATAtourisme | 49 POI réels autour de Lille | **0** `officialOpeningHours` |
| Wikidata (P8626, horaires en syntaxe OSM) | SPARQL, rayon 15 km | **0 item** |
| `place_enrichments` | 44 lignes en base | 0 `opening_hours`, 8 `today_hours`, **44 produites par un modèle**, **44 expirées** — inutilisable comme source, un horaire produit par un modèle n'est pas un horaire |
| OSM / Overpass | — | porte des horaires, mais la persistance OSM est exclue depuis l'arbitrage du Lot 4 |
| Google Places | — | interdit |

**Aucune source autorisée ne fournit aujourd'hui d'horaires persistables.**
Une question reste ouverte et sera tranchée par la mesure, pas par l'hypothèse :
la route DATAtourisme demande `isLocatedAt.openingHoursSpecification` sans
demander ses sous-champs (`opens`, `closes`, `dayOfWeek`) ; il est possible que
l'amont ne renvoie alors qu'une référence vide. Cela se vérifie en élargissant
la liste `fields` et en remesurant le rendement — c'est la première chose que
fera le lot, et si le rendement reste nul, il restera nul dans le rapport.

Conséquence immédiate, indépendante de la suite : `places` **ne peut toujours
pas** alimenter les trois résultats de « Maintenant ».

## 7. Offres — état mesuré

46 offres, toutes actives, toutes `student`, un seul organisme (CROUS).

| | mesuré |
|---|---|
| rattachées à un lieu (`place_id`) | **0 / 46** |
| avec une date de fin | **0 / 46** |
| avec une image | 0 / 46 |
| avec une description | 41 / 46 |

`offres_rattacher_aux_lieux()` existe depuis le Lot 5 mais ne rapproche rien :
il exige `place_nom_normalise(o.title) = p.name_normalized`, or les intitulés
CROUS (« R.U. Chatillon (Lille Centre) », « Cafétéria Sciences Po ») ne sont
jamais le nom d'un lieu de l'inventaire. Aucune adresse, aucun identifiant
source, aucune tolérance : le rapprochement est trop étroit pour exister.

Et aucune offre ne porte de date de fin, donc **la seule péremption possible
aujourd'hui est celle qui n'existe pas encore** : rien ne retire une offre dont
la source aurait disparu. C'est le §4 du Lot 6.

## 8. Ce que cet audit conclut

1. **La parité mobile/desktop est déjà tenue** sur le chemin `places` : mêmes
   arguments, mêmes candidats, mêmes entités, même ordre, aux quatre largeurs.
   Rien à corriger de ce côté ; il faut le **verrouiller par un test** pour
   qu'une divergence future soit refusée.
2. Le vrai écart n'est pas entre les largeurs, il est **entre les intentions et
   l'inventaire** : aucune sélection d'Explorer ne lit `places`.
3. L'inventaire est riche en lignes et pauvre en substance : 0 photo de lieu,
   0 horaire, des doublons non rapprochés et au moins un classement fautif.
4. Wikidata est la seule source d'images réellement disponible et mesurée
   (1 520 items à 15 km) ; elle exige un rapprochement par le nom, pas par la
   seule distance.
5. Aucune source d'horaires n'est disponible à ce jour. Le lot construira le
   pipeline et le format, et rendra compte du rendement réel, fût-il nul.
6. Les offres ne sont ni rattachées ni périssables : les deux manques sont
   dans le périmètre du lot.

Une divergence mobile/desktop **préexistante** est signalée pour mémoire, hors
périmètre : `estMobilePerformance()` limite la première couche d'événements à
24 sur mobile contre 120 sur desktop, puis complète à 120 après 4 s
(`programmerCoucheSupabaseSecondaire`). C'est un étalement de charge sur la
couche **événements**, qui converge ; il ne touche ni `places` ni Explorer, et
le Lot 6 n'y touche pas.
