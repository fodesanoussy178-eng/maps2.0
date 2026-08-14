# La zone active

## Le bug

> « Je suis physiquement à Tourcoing, je recherche Lille. L'interface affiche
> Lille, mais certains lieux, marqueurs, recommandations et Maintenant
> continuent à provenir de Tourcoing. »

Il n'y avait pas une cause, il y en avait trois, et elles se renforçaient.

**Les lieux s'accumulent sans provenance.** `fusionner` ajoute dans quatre
tableaux (`permanentPlaces`, `datatourismePlaces`, `externalEvents`,
`userPublications`), personne ne retire. Chercher Lille n'efface pas Tourcoing
de la mémoire — et c'est très bien, y revenir doit être instantané. Mais rien,
nulle part, ne demandait *« ce lieu appartient-il à la zone dont on parle ? »*.

**Il n'y avait pas de « zone dont on parle ».** Il y avait `positionMoi`, il y
avait `rechercheGeo`, il y avait `map.getCenter()`, et chaque partie du code
choisissait le sien. Les recommandations classaient depuis `positionMoi` : à
Tourcoing, l'accueil de Lille remontait donc des adresses de Tourcoing, parce
que douze kilomètres pénalisent tout Lille et rien de Tourcoing.

**Rien n'invalidait le travail en vol.** Une requête partie pour Tourcoing et
revenue après le passage à Lille était acceptée comme n'importe quelle autre.

## Le modèle

Deux choses nommées, une seule qui commande.

| | rôle |
|---|---|
| `positionMoi` | où la personne **est**. Point bleu, itinéraire, « suis-je sur place ? ». Ne sélectionne plus rien. |
| `zoneActive` | la zone dont Autour **parle**. Filtre les lieux, les événements, Maintenant, les marqueurs, le classement, les distances et les clés de cache. |

`zoneActive` vaut la position à l'ouverture, la ville cherchée ensuite, et
redevient la position quand on appuie sur **Revenir autour de moi** — jamais
autrement. Une mesure GPS qui arrive pendant qu'on explore Lille déplace le
point bleu, pas la zone.

`porteeCourante` est le numéro de la zone active. Tout travail asynchrone le
note au départ et le revérifie à l'arrivée.

## Le basculement, en un seul geste

`rechercheGeographique` fait, dans cet ordre :

1. géocodage → centre **et emprise** de la ville ;
2. `definirZoneActive(zoneRecherche(...))` — ce qui incrémente la portée et vide
   les mémoires de disponibilité, de classement et de sélection ;
3. `annulerChargementsZone()` — avorte tout ce qui est en vol ;
4. la tuile précalculée de la ville visée, si elle existe ;
5. `rendre()` + `majAccueil()` — les marqueurs et les recommandations de
   l'ancienne zone disparaissent immédiatement, sans attendre le réseau ;
6. `chargerZone(centre)` — les données fraîches de cette ville.

Le centre vient de **l'emprise**, pas de `map.getCenter()`. Le cadrage est animé :
interroger la carte juste après l'avoir lancé rend encore le centre de la ville
qu'on quitte. Le banc l'a montré — la zone « Lille » naissait avec la latitude
de Tourcoing.

## Deux barrières, pas une

**Le filtre** (`dansZoneActive`) est géographique et ne dépend d'aucun
ordonnancement : un lieu hors zone ne s'affiche pas, quelle que soit la source
qui l'a apporté, quel que soit le moment. Quand l'emprise est connue, elle
décide seule — le rayon ne vient **pas** en plus, sinon l'emprise de Lille
(treize kilomètres de large, donc neuf de rayon) laisserait rentrer le sud de
Tourcoing.

**La portée** évite le travail inutile et les écrasements : une réponse
périmée est jetée avant même d'être normalisée.

Une marge de 1,5 km entoure toute emprise : une limite communale ne se sent pas
sous les pieds, et un café à trois cents mètres du panneau fait partie de la
sortie qu'on prépare.

La vue de la carte n'élargit que la zone « autour de moi » : sans ville
demandée, la carte **est** la déclaration d'intention et explorer le quartier
d'à côté est légitime. Avec une ville demandée, non — dézoomer depuis Lille
ferait réapparaître Tourcoing.

## Les clés de cache

`idZone` = type + coordonnées arrondies au centième (~1 km). Le **nom n'y entre
pas** : il arrive par une requête de géocodage inverse, deux secondes après la
position, et la zone changerait d'identité toute seule en jetant ses caches au
pire moment.

- `cleZone(lat,lng,zoom,cats)` → `moi:50.72,3.16#50.72,3.16@8:depart`
- `cleCache(zone, categorie, periode)` → `recherche:50.63,3.06|resto|now`
- la mémoire de `Maintenant` → `idZoneActive() + "|" + minute + "|" + n`

Le cache disque des lieux (`autour:lieux:v5:lat,lng`) est déjà positionnel et
n'accepte une tuile voisine qu'à 1,2 km : il est isolé par construction.

## Ce que ça ne fait pas

Rien n'est effacé de la mémoire. Revenir à Tourcoing après Paris ne redemande
pas Tourcoing au réseau : ses lieux sont là, ils repassent simplement le filtre.

## Vérification

    node --test tests/contexte.test.mjs      # 28 cas, dont les 7 obligatoires
    node outils/contextes.mjs                # le parcours réel, dans Chromium

Le banc ouvre l'application à Tourcoing, cherche Lille, puis Paris, revient,
fait traîner une réponse de Tourcoing pendant la bascule, et recharge avec un
cache chaud. Il compte à chaque étape ce qui est en mémoire, ce qui passe le
filtre, ce qui est posé sur la carte, ce que propose Maintenant et ce qu'écrit
la feuille.

> Deux pièges rencontrés en l'écrivant, et qui valent d'être connus : intercepter
> `/api/lieux` **avant** le passe-plat vers le serveur statique — sinon Autour
> note « relais absent » et ne demande plus jamais de lieux, et le banc mesure
> un écran vide en le déclarant réussi. Et fournir le cookie `autour_geo` de
> position IP : sans lui l'application démarre sur son repli parisien, puis
> saute deux cents kilomètres, un vol pendant lequel le zoom passe sous le seuil
> de chargement.
