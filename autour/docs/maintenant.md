# « Maintenant »

## L'objectif, en une phrase

On ouvre Autour, on attend un instant, et au centre de l'écran apparaît une
petite liste de choses réellement possibles tout de suite. **Sans appuyer sur
rien.** Le bouton `Maintenant` sert ensuite à rouvrir ou actualiser cette
sélection — pas à l'obtenir la première fois.

## Le parcours d'ouverture

1. la géolocalisation démarre ;
2. les données locales se chargent en arrière-plan ;
3. le backend dit ce qui est réellement en cours (`event_temporal_status`) ;
4. `maintenant.js` retient **au plus trois** résultats fiables ;
5. le bloc se remplit tout seul, **à la place qu'il occupait déjà**.

## La place est réservée dès le premier rendu

C'était le défaut principal : le bloc n'existait pas tant qu'il n'avait rien à
montrer. Il apparaissait une seconde après l'ouverture et **poussait les
boutons du dessous sous le doigt** de quelqu'un qui appuyait déjà.

La réservation porte sur le **corps**, pas sur la carte :

```
.mn-corps { min-height: calc(3 * var(--mn-ligne) + var(--mn-pied)) }
.mn-l     { height: var(--mn-ligne) }        /* fixe, pas déduite du contenu */
```

Une première version additionnait une hauteur d'en-tête *supposée* : le banc a
mesuré 4 px de saut. L'en-tête garde donc sa taille naturelle, et seul le corps
réserve. Le pied compte aussi — « Voir tout » n'apparaît qu'au-delà de trois
résultats, et son arrivée décalait tout de 46 px.

## Les quatre états

| État | Quand | Ce qu'on voit |
|---|---|---|
| `loading` | la position ou les données arrivent | trois barres grises, **aucun texte** |
| `ready` | au moins un résultat fiable | 1 à 3 lignes, le total entre parenthèses |
| `empty` | tout a répondu, rien de fiable | « Rien en cours près de toi » + sortie |
| `error` | position inconnue, ou panne | le mot qui convient + sortie |

L'ordre des questions est le fond du sujet, et il a coûté un blocage : quand la
géolocalisation échouait, la recherche d'événements restait « en cours »
indéfiniment — elle attendait un point de départ qui n'arrivait jamais — et le
bloc affichait ses barres grises pour l'éternité. On demande donc la position
**avant** les données :

```
résultats > 0        → ready
position en cours    → loading
position inconnue    → error   (« Autour ne sait pas où tu es »)
panne                → error
données en cours     → loading
sinon                → empty
```

Une géolocalisation refusée n'est **jamais** lue comme un vide. On ne dit pas
« rien autour de toi » à quelqu'un dont on ignore où il est.

## Ce qui a le droit d'entrer

Chaque refus porte un nom (`RAISONS`), pour qu'un bloc vide s'explique sans
relire le code :

- l'événement est **commencé et non terminé** : `debutLe <= now <= finLe`,
  bornes inclusives ;
- une **heure de fin absente n'est jamais inventée** → refusé ;
- une **date incertaine** → refusé ;
- **annulé** → refusé ;
- le lieu **qu'on sait fermé** → refusé (un horaire *inconnu* n'écarte pas :
  la plupart des lieux OSM n'en ont aucun) ;
- **plus de 3 km** → refusé ;
- **sans position valide**, rien n'est fiable.

Le vocabulaire des statuts n'appartient pas à ce module. Une première version
comparait la chaîne `"now"` alors que le moteur dit `"happening_now"` : le bloc
restait vide en permanence, et les tests ne le voyaient pas puisqu'ils
employaient le même mot inventé. L'application transmet désormais le verdict de
`temporel.js` sous forme de booléen.

## On ne remplit jamais les trois emplacements

Trois emplacements réservés invitent à les remplir. Mettre un événement de
demain parce qu'il reste une ligne vide, c'est envoyer quelqu'un devant une
porte fermée. S'il n'y a qu'un résultat fiable, le bloc en montre un.

Classement : **le plus proche d'abord** — « maintenant » se lit avec les pieds.
À distance égale, celui qui finit le plus tôt passe devant : c'est celui qu'on
risque de manquer.

## « Autour » de quoi ?

Autour connaît **trois** points : là où vous **êtes** (`positionMoi`), la ville
que vous avez **demandée** (`rechercheGeo`), et ce que la carte **montre**
(`map.getCenter()`). Chaque partie du code en choisissait un :

| | référence | conséquence ailleurs |
|---|---|---|
| chargement des données | centre de la carte | juste |
| classement des lieux | `positionMoi` | tout à 220 km, ordre arbitraire |
| distances affichées | `positionMoi` | « 220 km » sous chaque ligne |
| **filtre de `Maintenant`** | `positionMoi` | **tout exclu** |

Les trois premiers mal-classaient. Le quatrième **excluait** : taper « Paris »
depuis Lille chargeait bien les concerts parisiens en cours, puis les refusait
tous à 220 km — et le bloc annonçait « rien en cours près de toi » au-dessus
d'une carte pleine d'événements en cours.

Il n'y a plus qu'une réponse : `pointDeReference()`, **le point qu'on
regarde**. Chez soi, la carte est centrée sur soi et les deux coïncident.

Deux corollaires :

- **Le rayon suit ce qu'on voit.** `allerVers` décale volontairement le centre
  pour que le point visé ne soit pas caché par la feuille du bas ; au zoom 13
  ce décalage vaut 7 km, et un rayon fixe de 3 km rejetait des événements
  parfaitement visibles. `rayonRegarde()` prend la demi-diagonale de la vue,
  avec 3 km comme plancher.
- **La feuille suit la carte.** Seule l'arrivée de *nouvelles* données
  déclenchait un rendu. Zone déjà en cache → rien n'arrivait, rien ne se
  redessinait, et le bloc gardait son ancienne réponse.

Une ville choisie vaut une position connue : sans ça, le bloc répondait
« Autour ne sait pas où tu es » à quelqu'un qui venait justement de le lui
dire.

## Les bancs d'essai

```sh
node --test tests/maintenant.test.mjs              # la règle et les états
AUTOUR_RACINE=autour node outils/maintenant.mjs    # le parcours, mesuré
```

Le banc de navigateur ne vérifie pas de la logique : il **mesure des pixels**.
Il relève la position de tout ce qui vit sous le bloc, laisse les données
arriver, et compare. Un seul pixel de décalage est un échec. Il couvre :

- ouverture normale, réseau lent (2,5 s), aucune donnée, quarante événements ;
- géolocalisation acceptée et refusée ;
- changement de position ;
- téléphone et ordinateur ;
- **dix ouvertures d'affilée**, parce qu'un défaut de course ne se voit pas au
  premier essai ;
- **une autre ville**, par le vrai chemin (`rechercheGeographique`) plutôt
  qu'un `allerVers` approximatif — c'est le scénario que tous les autres
  manquaient, puisqu'ils regardent tous l'endroit où ils se trouvent.

Les pièges sont servis à chaque scénario et ne doivent jamais entrer :
« Demain », « Terminé », « Date inconnue », « Annulé », « Sans fin »,
« Très loin ».

## Safari / WebKit

Le banc tourne sous Chromium. WebKit n'est pas installable dans
l'environnement de développement (le miroir Playwright est refusé par le
proxy) : **Safari n'a pas été testé automatiquement**. Les propriétés
employées ici — `min-height` en `calc()`, flexbox, variables CSS — sont
supportées par Safari depuis longtemps, mais ce n'est pas une vérification.

## Ce que « Maintenant » veut dire, depuis cette passe

Plus « les événements en cours », mais : **qu'est-ce que je peux faire, là,
dans la zone que je regarde ?**

Un quartier n'a pas un concert à toute heure. S'en tenir aux événements
laissait le bloc vide l'essentiel du temps — alors qu'à cette même heure il y a
un restaurant ouvert à deux rues et un cinéma dont la séance commence dans
vingt minutes. Ce sont des réponses à la question posée ; les taire n'était pas
de la rigueur, c'était un écran vide.

### Quatre natures, dans cet ordre

| nature | ce que c'est |
|---|---|
| `event_now` | un événement a commencé et n'est pas fini |
| `session_soon` | une séance commence dans 5 à 75 min — on a le temps d'y arriver |
| `activity_now` | un lieu d'activité ouvert : cinéma, musée, piscine, parc, bibliothèque |
| `open_now` | un lieu ouvert où l'on peut aller tout de suite |

L'ordre n'est pas décoratif : un événement en cours est rare et périssable, un
restaurant ouvert ne l'est pas.

### Ce qui n'entre jamais

- **un événement futur ne sert jamais à remplir.** Un concert demain n'est pas
  « maintenant », même s'il ne reste que des lignes vides ;
- un lieu **fermé** ;
- un lieu dont on **ignore les horaires** — c'est le cas le plus fréquent et le
  plus dangereux à confondre avec « ouvert » ;
- un lieu qui **ferme avant qu'on arrive** (`availability.js` connaît les marges
  par type : arriver au musée trois minutes avant la fermeture n'est pas une
  visite) ;
- une séance **trop lointaine** ou **trop imminente** pour être attrapée.

### La diversité, en deux passes

Trois fast-foods répondent trois fois à la même question. On prend d'abord le
**meilleur de chaque famille**, dans l'ordre de priorité ; s'il reste des
places, on complète avec le reste du classement.

Un tri « une famille sur deux » ferait passer un café ouvert devant un concert
en cours pour cause de variété. **La variété ne coûte jamais la tête de liste.**

## Hubs et vitesse

`outils/hubs.json` déclare huit hubs de **données** — Lille-Flandres/Europe,
quatre pôles parisiens, Lyon Part-Dieu, Marseille Saint-Charles, Bordeaux
Saint-Jean, Toulouse-Matabiau — et les tuiles `zones/*.json` qui les couvrent.

> **Un hub n'est pas une position.** Quelqu'un à quatre kilomètres de
> Lille-Flandres n'est pas à Lille-Flandres : on ne le téléporte jamais. Le hub
> dit quel fichier est déjà prêt, pas où se trouve la personne.

Les événements ne sont pas dans les tuiles : ils périment. Ils vivent dans la
couche canonique et se synchronisent séparément.

Cinq des neuf tuiles existent déjà (Lille, Paris). Les quatre autres —
`45.8,4.9`, `43.3,5.4`, `44.8,-0.6`, `43.6,1.5` — se génèrent avec :

```sh
node outils/zones.mjs --liste outils/hubs.json
```

Ce script a besoin d'Overpass, que le bac à sable de développement refuse :
**ces quatre tuiles ne sont pas générées ici.**

### Le banc de vitesse

```sh
AUTOUR_RACINE=autour node outils/vitesse.mjs
```

Il mesure, par scénario : temps jusqu'à la localisation, jusqu'au **premier**
résultat, jusqu'aux trois, nombre de requêtes, hits/miss de cache, sources
au-delà d'une seconde, et **le pire blocage du fil principal**.

Scénarios : hub à froid, hub à chaud, hub en réseau lent, hors hub en réseau
lent, centre-ville dense, zone peu dense.

### Ce qui reste lent, et ce n'est pas une impression

Sur un centre-ville dense (120 lieux), le fil principal reste bloqué **plusieurs
secondes d'affilée**. Pendant ce temps l'écran ne réagit à rien — et
« Maintenant » ne peut pas s'afficher, **non parce qu'il attend une donnée**
(les lieux sont arrivés à 583 ms, les événements à 2,8 s) **mais parce que
personne ne peut le dessiner**.

La cause est l'ingestion de cent trente lieux en une seule tenue :
normalisation, déduplication, classement, pose des marqueurs. La découper en
tranches est un chantier à part entière — pas une passe de stabilisation. Le
banc l'imprime à chaque exécution, avec son chiffre, plutôt que de le taire ou
de le noyer dans un rouge permanent.

## Découper l'ingestion : ce qui a été fait, et ce qui reste

### Le diagnostic, avant de toucher quoi que ce soit

Un profil dans la page, fonction par fonction, sur le scénario dense :

```
recommandationsAccueil   13 appels   3907 ms   pire : 443 ms
rendre (marqueurs)        6 appels   2088 ms   pire : 944 ms
itemsMaintenant          16 appels   1535 ms   pire : 950 ms
```

Et le point qui décide de tout : `blocMaintenantAccueil()` se construisait dans
le **même `innerHTML`** que la liste de recommandations. `Maintenant` attendait
donc un classement dont il n'a aucun besoin.

### Trois changements, aucun sur les règles métier

1. **Le rendu de l'accueil se fait en deux temps.** Ce qui est bon marché — dont
   `Maintenant` — est peint tout de suite ; la zone des recommandations garde sa
   place avec le squelette qui s'y affichait déjà, puis se remplit pendant une
   tranche d'inactivité. Rien au-dessus ne bouge.
2. **La sélection de la carte est différée elle aussi.** Le second appel à
   `recommandationsAccueil` (1169 ms au pire) vivait en plein milieu du rendu.
   Il s'exécute maintenant en arrière-plan et ne redessine que si le résultat
   **diffère** — sinon rien ne bouge.
3. **La disponibilité d'un lieu ne dépend plus du point de référence.** Elle en
   dépendait par le temps de trajet estimé, donc elle changeait à chaque image
   *pendant que la carte vole* vers sa destination : la mémoire ne retenait
   rien et l'analyse des horaires de 130 lieux repartait de zéro. Un temps
   d'approche nominal de dix minutes dit la même chose — c'est la marge **par
   type** de `availability.js` qui fait le vrai travail — et le résultat se
   retient.

`ordonnanceur.js` fournit le mécanisme : `requestIdleCallback` avec repli
`setTimeout` (Safari ne l'a jamais implémenté), travaux **annulables**, et
`parLots` qui découpe selon le temps restant dans la tranche plutôt qu'une
taille fixe.

**Chaque travail différé porte un jeton.** Si la zone change, le jeton est
périmé et le travail ne s'exécute jamais — plutôt que d'aboutir en écrasant
l'écran avec le classement d'une ville qu'on a quittée. Le jeton est vérifié
**avant et après** le calcul : classer 130 lieux prend des centaines de
millisecondes, et la carte peut bouger pendant ce temps.

### Avant / après, mesuré

| scénario | 1er résultat avant | après | blocage avant | après |
|---|---|---|---|---|
| centre dense (120 lieux) | 4703 ms | **2518 ms** | 3963 ms | **1815 ms** |
| hub · cache froid | 1355 ms | **775 ms** | — | — |
| zone peu dense | 1626 ms | **1487 ms** | — | — |

### Ce qui reste

**L'objectif d'une seconde de blocage n'est pas tenu** sur zone dense : 1815 ms.
Les deux classements sont sortis du chemin critique ; ce qui reste est la pose
des marqueurs et la déduplication, toujours d'un bloc. Le banc l'imprime à
chaque exécution, avec son chiffre.
