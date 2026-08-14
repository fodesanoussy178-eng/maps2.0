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
  premier essai.

Les pièges sont servis à chaque scénario et ne doivent jamais entrer :
« Demain », « Terminé », « Date inconnue », « Annulé », « Sans fin »,
« Très loin ».

## Safari / WebKit

Le banc tourne sous Chromium. WebKit n'est pas installable dans
l'environnement de développement (le miroir Playwright est refusé par le
proxy) : **Safari n'a pas été testé automatiquement**. Les propriétés
employées ici — `min-height` en `calc()`, flexbox, variables CSS — sont
supportées par Safari depuis longtemps, mais ce n'est pas une vérification.
