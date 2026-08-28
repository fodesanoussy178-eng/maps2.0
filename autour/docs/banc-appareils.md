# Le banc d'essai appareils

## Ce qu'il fait

`outils/banc-serveur.mjs` sert l'application telle quelle et exécute les
VRAIES fonctions Edge (`api/*.js`) — ce sont des handlers `Request → Response`
standards, Node les exécute comme Vercel. Ce n'est donc pas une maquette : le
contrôle de forme d'`/api/lieux` s'applique, avec ses refus.

`outils/appareils.mjs` ouvre l'application dans un vrai navigateur, à la
taille, à la densité de pixels et au mode tactile de neuf appareils, avec le
réseau bridé au niveau du protocole et le processeur bridé au niveau du
moteur. Il relève, par appareil : le délai avant le premier contenu lisible,
le débordement horizontal, les cibles tactiles trop petites, la présence de
formats bruts (`opening_hours` OSM, `NaN`, `undefined`), et les erreurs JS.

`outils/aide-progressive.mjs` fait autre chose, et c'est le plus utile : il
ralentit le relais PALIER PAR PALIER, puis photographie l'écran toutes les
secondes. C'est la seule façon de vérifier ce que l'écran montre PENDANT une
recherche — pas à la fin. C'est là qu'on a vu Aide annoncer « je n'ai pas
trouvé » alors qu'elle cherchait encore.

## Comment le lancer

```sh
npm install                          # à la racine du dépôt : playwright, leaflet
node autour/outils/banc-serveur.mjs &      # http://127.0.0.1:8787
node autour/outils/appareils.mjs complet   # les neuf appareils, deux réseaux
node autour/outils/aide-progressive.mjs    # la recherche d'aide, filmée
```

Variables : `CHROMIUM` (chemin du binaire si Playwright ne le trouve pas),
`BANC_SORTIE` (dossier des captures), `AUTOUR_RACINE` (racine servie).

## CE QU'IL NE VALIDE PAS, ET IL FAUT LE SAVOIR

Le moteur est **Chromium**, pas WebKit. Sont donc réellement vérifiés : la
mise en page à chaque taille, le tactile, les délais, la logique, les états
d'écran. N'est PAS vérifié : le rendu propre à WebKit, c'est-à-dire à Safari
et à tous les navigateurs iOS, qui utilisent tous WebKit.

Ce qui relève de Safari est couvert autrement, par lecture, dans
`tests/mobile-autour.test.mjs` (section 7) : tout fond en `color-mix` doit
porter un repli uni déclaré avant lui ; le code livré n'emploie ni regard
arrière, ni `Array.at`, ni `Object.hasOwn`, ni `structuredClone` ; et le
chemin de géolocalisation conserve la trace locale qui remplace
`permissions.query`, que Safari n'implémente pas.

Un test sur un iPhone réel reste nécessaire avant une mise en production. Ce
banc réduit ce qu'il reste à y vérifier ; il ne le remplace pas.

## Ce que le banc a trouvé, et que la lecture du code n'avait pas trouvé

1. **Aide ne cherchait pas si la position arrivait après l'ouverture de
   l'écran.** `basculerAide` ne lançait la recherche que `if(modeAide &&
   positionMoi)` et rien ne la relançait ensuite. Sur ordinateur la position
   est là avant qu'un doigt n'atteigne l'onglet ; sur téléphone elle met une à
   quinze secondes. L'écran affichait « Je n'ai pas trouvé de solution » sans
   avoir cherché — définitivement.

2. **Deux appuis rapides sur l'onglet Aide bloquaient la recherche pour de
   bon.** Le second appui annulait la génération en vol ; le troisième
   trouvait une entrée « chargement en cours » pointant sur la recherche
   morte et la rendait telle quelle. Un doigt qui doute que son appui ait été
   pris fait exactement ce geste — surtout sur un écran qui ne répond pas
   encore. Reproduit une fois sur trois à six ; zéro fois sur dix après
   correction.

3. **Une panne de source se disait comme une absence d'aide.** Relais coupé,
   l'écran annonçait « Je n'ai pas trouvé de solution suffisamment fiable
   autour de cette zone » — pour quelqu'un qui cherche à manger, cela se lit
   « il n'y a pas d'aide près de chez toi ». C'est faux.

Aucune de ces trois-là n'était visible en lisant le code : il fallait piloter
l'application.
