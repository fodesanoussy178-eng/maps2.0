# Le démarrage à froid

Un démarrage « à froid », c'est le premier contact : un téléphone qui n'a
jamais ouvert Autour. Aucun `localStorage`, aucun cache navigateur, aucune
position enregistrée, aucune permission accordée. C'est le seul cas où
l'application n'a strictement rien à elle, et c'est donc celui qui décide de
la première impression.

Ce document décrit ce qui a été mesuré, ce qui bloquait, et ce qui a été mis
en place. Les mesures sont faites sur une **production simulée** (voir la
dernière section : ce qui reste invérifiable depuis un conteneur sans accès
sortant).

## Ce qui bloquait

Deux dépendances, et elles étaient toutes les deux sur le chemin critique.

**La position.** « Autour de toi » suppose un « toi » quelque part. Sans rien
en mémoire, la seule source était `navigator.geolocation` : une demande de
permission, puis un point GPS. Entre deux cents millisecondes et huit
secondes — et très souvent jamais, parce que la permission est refusée. Tant
que ce point n'arrivait pas, aucune proposition ne pouvait être calculée.

**Les lieux.** Chaque téléphone lançait sa propre requête vers une instance
Overpass publique. Deux personnes du même quartier payaient deux fois la même
attente ; en heure pleine, l'instance répond en cinq, dix ou vingt secondes,
et parfois pas du tout.

Mesuré sur la chaîne complète, réseau mobile 4G, processeur ralenti quatre
fois : **première suggestion à 7454 ms**, et **aucune suggestion du tout**
quand Overpass ne répondait pas.

## Ce qui a été mis en place

### 1. La ville, connue avant que la page ne s'exécute

`middleware.js` s'exécute au bord du réseau, lit les en-têtes de
géolocalisation par IP que Vercel attache à la requête, et dépose un cookie
`autour_geo` **sur la réponse qui porte `index.html` elle-même**. Le script de
la page le lit à l'analyse : zéro aller-retour supplémentaire, zéro
permission, zéro attente.

Ce n'est pas de la géolocalisation, c'est la ville à quelques kilomètres près.
Le code le dit (`originePrecision = "ville"`), et tout ce qui prétendrait à
mieux — « à 4 minutes à pied » — attend le vrai point GPS, qui arrive en
parallèle et remplace silencieusement.

Aucune donnée n'est stockée côté serveur, rien n'est journalisé, le cookie
n'est pas un identifiant : deux nombres, un nom de ville, une heure de
validité.

### 2. Overpass et Nominatim derrière notre propre origine

`api/lieux.js` et `api/commune.js` relaient ces deux services depuis le bord
du réseau, avec un cache CDN par zone :

| | fraîcheur | survie |
|---|---|---|
| `/api/lieux` | `s-maxage=86400` (un jour) | `stale-while-revalidate=604800` (une semaine) |
| `/api/commune` | `s-maxage=2592000` (un mois) | un mois |

La clé de cache est l'URL, donc la requête, donc la zone. **La première
personne d'un quartier paie l'attente une fois, côté serveur, pour tout le
monde et pour la semaine.** Les suivantes reçoivent la réponse en un
aller-retour vers le CDN — mesuré à 1148 ms au lieu de 7221 ms.

`api/lieux.js` n'accepte pas n'importe quelle requête : la forme exacte que
produit l'application, une sortie bornée, quatre kilo-octets au maximum. Une
route ouverte sur Overpass serait un relais pour n'importe qui.

Le client garde son chemin direct en secours. En développement local, sur un
hébergement sans fonctions, ou si la route tombe, l'application se comporte
exactement comme avant.

### 3. Les jeux de zone pré-calculés

Le tout premier visiteur d'une zone que personne n'a jamais ouverte reste
devant Overpass. C'est le seul cas qui ne se résout pas par un cache, puisque
le cache est vide par définition.

`outils/zones.mjs` produit `zones/<lat>,<lng>.json` : les lieux du centre
d'une agglomération, sous la forme que l'application fusionne directement. Un
fichier statique, servi par le CDN, une requête vers notre propre origine.

```sh
node outils/zones.mjs                    # les villes de outils/villes.json
node outils/zones.mjs 50.7176,3.1611     # une zone précise
node outils/zones.mjs --liste mes-villes.json
```

Ce script **a besoin d'un accès réseau à Overpass**. Il n'a pas pu être
exécuté depuis l'environnement de développement de cette passe : le dossier
`zones/` est donc absent du dépôt, et il faut le générer une fois avant le
déploiement pour que ce niveau existe. Son absence n'est pas une panne — la
fonction rend `null` et le démarrage suit son chemin habituel.

À relancer environ une fois par mois : ces données vieillissent lentement, et
les sources fraîches les remplacent silencieusement à chaque ouverture.

### 4. La coquille peinte sans attendre le script

L'en-tête, la navigation, le bouton Aide et l'attribution étaient marqués
`hidden` dans le HTML et révélés par JavaScript. Le navigateur avait donc tout
ce qu'il fallait pour peindre l'écran, et attendait quand même l'analyse de
trois cent soixante kilo-octets de script. Ils ne sont plus masqués :
**shell 669 ms → 178 ms**.

## Les timings

Réseau 4G (4 Mbit/s, 80 ms de latence), processeur ralenti 4×, contexte neuf
à chaque mesure, géolocalisation **non accordée**, un seul chargement.

| | avant | après |
|---|---|---|
| coquille visible | 669 ms | **178 ms** |
| first contentful paint | 800 ms | **268 ms** |
| LCP | 1144 ms | **828–1248 ms** |
| 1re suggestion — zone déjà ouverte par quelqu'un | 7454 ms | **1534 ms** |
| 1re suggestion — jeu de zone pré-calculé | — | **1666 ms** |
| 1re suggestion — 1er visiteur d'une zone neuve, sans jeu | 7454 ms | 7657 ms |
| Overpass **et** Nominatim morts | écran vide, 0 lieu | **5 propositions à 2025 ms** |

La chaîne complète est lisible à tout moment dans la console :
`AutourPerf.chaine()` rend chaque maillon avec son instant et sa durée,
`AutourPerf.verdict()` compare aux objectifs.

## Ce qui reste à faire pour tenir 1,5 s partout

Le seul cas encore lent est le **tout premier visiteur d'une zone que
personne n'a jamais ouverte et pour laquelle aucun jeu n'a été généré**. Deux
gestes le règlent, dans cet ordre :

1. générer les jeux de zone (`node outils/zones.mjs`) et déployer le dossier
   `zones/` ;
2. laisser le trafic faire le reste : dès qu'une personne a ouvert une zone,
   le CDN la sert à toutes les autres pendant une semaine.

## Ce qui n'a pas pu être mesuré ici

L'environnement de développement de cette passe n'a **aucun accès sortant** :
le mandataire refuse la connexion à tous les hôtes externes, `autour.eu`
compris. Restent donc invérifiables sans un déploiement réel :

- le comportement de `autour.eu` lui-même — aucune mesure n'a pu être prise
  sur la production ;
- les en-têtes `x-vercel-ip-*` : le middleware est exercé avec des en-têtes
  fournis à la main, jamais avec ceux que Vercel produit ;
- le taux de succès réel du cache CDN de Vercel (les règles `s-maxage` et
  `stale-while-revalidate` sont simulées par un cache en mémoire) ;
- les latences réelles d'Overpass et de Nominatim, et leur taux d'échec ;
- le contenu réel des jeux de zone, puisque le générateur n'a pas pu tourner.

Ce qui **a** été exercé pour de vrai : `middleware.js`, `api/lieux.js` et
`api/commune.js` sont chargés et exécutés tels quels par le serveur de
mesure ; la compression, les en-têtes de cache, le bridage réseau et
processeur, et le pipeline complet de l'application dans un vrai navigateur.
