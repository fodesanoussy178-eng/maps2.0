# Le chemin critique

Un démarrage à froid, c'est le premier contact ; `docs/demarrage-a-froid.md`
raconte comment la **ville**, les **lieux** et la **coquille** ont cessé
d'attendre le réseau. Restait le dernier maillon, celui qu'aucune de ces
passes n'avait touché : **le programme lui-même**.

Mesuré au banc (`outils/chemin-critique.mjs`, profil `defaut` : Pixel 5,
1,6 Mbit/s, 150 ms de latence, processeur ralenti 4×) :

| | avant cette passe |
|---|---|
| coquille visible (FCP) | 436 ms |
| **interface interactive** | **2 517 ms** |
| carte prête | 2 782 ms |
| marqueurs posés | 2 825 ms |
| recommandations à l'écran | 2 990 ms |
| JS du chemin critique | 315 ko transférés, 22 fichiers |

L'écran apparaissait en quatre cents millisecondes et ne répondait à rien
pendant deux secondes de plus. Entre les deux, une seule chose se passait :
**le navigateur téléchargeait 315 ko de JavaScript.**

Le profil `rapide` le prouve par l'absurde — sans bridage, la même
application est interactive en **154 ms**. Le code n'est pas lent. C'est sa
taille sur le fil qui l'est.

## Les deux leviers, et leur poids réel

Il n'y en a que deux, et il faut les comparer honnêtement avant de choisir.

| levier | JS critique retiré | gain mesuré sur l'interactivité |
|---|---|---|
| découper les écrans secondaires | 12 ko | **66 ms** (2 517 → 2 451) |
| **retirer les commentaires à la livraison** | **134 ko** | **707 ms** (2 451 → 1 744) |
| les deux | 146 ko | **773 ms** (−31 %) |

Le découpage seul ne pouvait pas faire mieux : il ne déplace que 12 ko du
chemin critique, et 12 ko à 200 ko/s font 60 ms. C'est arithmétique. Sa vraie
valeur est ailleurs — un `app.js` deux fois plus léger une fois allégé, et la
mécanique pour en sortir la suite.

Les deux ont été faits. Le second est de loin le plus grand, et c'est celui
auquel on pense en dernier.

### 1. Les écrans qu'on n'ouvre pas en arrivant

`app.js` portait tout : la carte, le classement, « Maintenant », mais aussi
la fiche détaillée d'un lieu, l'itinéraire, le formulaire de publication, le
compte, le profil et les canaux. Ces derniers n'existent qu'après un geste.
Personne n'en a besoin pendant l'attente, et ils étaient pourtant sur le
chemin critique.

Ils vivent maintenant dans **`differe/ecrans.js`** — 53 ko brut, 17,5 ko
gzip, 28 fonctions — que la page ne charge pas.

C'est un script **classique**, pas un module : il partage donc la portée
lexicale d'`app.js`, ses `let`, ses `const` et ses fonctions. Rien n'a été
réécrit en le déplaçant. Aucun framework, aucun empaqueteur, aucun système
de modules : une balise `<script>` injectée, et les déclarations de
fonctions du fichier remplacent celles qui portaient le même nom.

Dans `app.js`, chaque nom déplacé existe quand même dès la première seconde,
sous la forme d'une **amorce** :

```js
function ecranAuBesoin(nom, args){
  charge("Ouverture…");
  return auBesoin(MODULE_ECRANS).then(()=>{
    charge(null);
    const vraie = window[nom];
    if(typeof vraie !== "function" || vraie.amorce === true)
      throw new Error("écran manquant : "+nom);
    return vraie.apply(null, args);
  }).catch(...);
}
```

L'appelant ne change pas. L'écran ne se vide jamais : `charge()` garde ce qui
est affiché et pose une pastille discrète le temps de l'aller-retour. Un
échec n'est pas mémorisé — le geste suivant retente.

Et le module est de toute façon demandé **à l'inactivité, juste après le
démarrage** (`prechargerEcrans`, via `ORDO.differer`) : la tranche
d'inactivité attend que le fil principal soit libre, donc le préchargement ne
dispute rien au premier écran, et en usage réel le fichier est là bien avant
le premier appui. Mesuré : les gestes restent entre **5 et 14 ms**.

La règle de sûreté du découpage est vérifiée mécaniquement par
`tests/ecrans-differes.test.mjs` : **aucune fonction restée dans le module
n'est appelée depuis le chemin critique sans amorce.** C'est la seule erreur
que ce découpage pourrait produire, et elle ne peut plus passer.

### 2. La prose ne voyage plus jusqu'au téléphone

Autour est commenté en français, abondamment et volontairement : la raison
d'une règle vaut la règle. Ces commentaires appartiennent au dépôt.

Ils partaient aussi vers le téléphone. Mesuré :

```
app.js            184,9 ko gzip   dont 88,9 ko de commentaires  (48 %)
tout le JS servi  313,0 ko gzip   dont  137 ko de commentaires  (44 %)
```

La prose compresse mal comparée au code, qui se répète : à poids brut égal,
un commentaire coûte plusieurs fois plus qu'une ligne de programme une fois
gzippé.

`outils/alleger.mjs` produit une copie allégée dans **`livraison/`**, et
c'est elle qu'on déploie. **Le dépôt n'est pas touché** : un test
(`tests/livraison.test.mjs`) vérifie qu'aucune écriture ne vise la racine, et
`livraison/` est ignoré par git.

Le retrait n'est pas fait à coups d'expressions régulières — une barre
oblique peut être une division, un littéral d'expression régulière ou le
début d'un commentaire, et se tromper une fois corromprait le programme en
silence. C'est **esbuild**, un vrai analyseur, qui relit chaque fichier et le
réimprime, avec :

- `minifyIdentifiers: false` — les noms restent ceux du dépôt, une pile
  d'appels de production reste lisible ;
- `minifySyntax: false` — aucune réécriture d'expression ;
- `target: "esnext"` — aucune transposition ;
- une vérification, fichier par fichier, que **les déclarations de premier
  niveau sont toutes là, dans le même ordre**. Sinon l'outil s'arrête.

```sh
node outils/alleger.mjs --verifier   # dit ce qu'on gagne, n'écrit rien
node outils/alleger.mjs              # écrit livraison/
```

### Comment c'est branché sur Vercel

Le projet `autour` a pour dossier racine `autour/` — c'est de là que Vercel lit
`vercel.json`, `api/` et `middleware.js`. Deux clés suffisent à y insérer le
build :

```json
{
  "buildCommand": "node outils/alleger.mjs",
  "outputDirectory": "livraison"
}
```

`api/` et `middleware.js` restent à la racine du projet : Vercel les y cherche,
indépendamment du dossier de sortie. C'est pourquoi `alleger.mjs` ne les
recopie PAS dans `livraison/` — les y mettre exposerait leur source en statique
à côté de la fonction qu'ils servent déjà.

`package.json` existe pour une seule raison : Vercel installe les dépendances
du dossier racine, et le build a besoin d'`esbuild`.

`outils/production.mjs` rejoue toute la chaîne en local — téléversement filtré
par `.vercelignore`, installation, build, puis service avec les en-têtes, les
réécritures, le middleware et les fonctions du bord. C'est ce banc qui a
trouvé, avant tout déploiement, que `alleger.mjs` importait sa liste de modules
depuis `tests/` — un dossier que `.vercelignore` écarte : **le build aurait
échoué en production**. La liste vit maintenant dans `outils/modules.mjs`.

### Ce que la production exposait

Vérifié le 20/08 sur `autour.eu`, avant cette passe :

| chemin | réponse |
|---|---|
| `/supabase/migrations/…​.sql` | **200** — schéma, politiques RLS, référence du projet Supabase |
| `/supabase/functions/sync-openagenda/…​` | **200** — protocole de synchronisation |
| `/tests/…​` | **200** |
| `/vercel.json` | 404 (Vercel écarte sa propre configuration) |

Aucun secret n'y figurait — ils vivent dans Vault — mais rien de tout cela
n'avait de raison d'être servi. Le dossier de sortie règle le problème par
construction : la livraison ne contient que ce qui doit être public, et
`alleger.mjs` échoue si un de ces dossiers y réapparaît.

## Ce que ça donne

Profil `defaut`, médiane de trois mesures, livraison allégée :

| | avant | après | |
|---|---|---|---|
| coquille visible (FCP) | 436 ms | 448 ms | inchangé, c'était déjà bon |
| **interface interactive** | 2 517 ms | **1 744 ms** | **−31 %** |
| carte prête | 2 782 ms | 1 944 ms | −30 % |
| marqueurs posés | 2 825 ms | 1 985 ms | −30 % |
| recommandations à l'écran | 2 990 ms | 2 129 ms | −29 % |
| LCP | 3 144 ms | 2 272 ms | −28 % |
| JS du chemin critique (brotli, ce que Vercel envoie) | 256 ko | **137 ko** | −46 % |
| dont `app.js` | 194 ko | **96 ko** | −50 % |
| tâches longues (total) | 740 ms | 551 ms | −26 % |

Sur les autres profils :

| profil | interactive avant | après | |
|---|---|---|---|
| réseau lent (400 kbit/s) | 8 790 ms | **5 825 ms** | −34 % |
| géolocalisation lente (4 s) | 2 497 ms | 1 753 ms | −30 % |
| Supabase lent (5 s) | 2 387 ms | 1 738 ms | −27 % |
| Google lent (5 s) | 2 398 ms | 1 739 ms | −27 % |
| Overpass lent (5 s) | 2 505 ms | 1 727 ms | −31 % |
| hors ligne | 2 499 ms | 1 750 ms | −30 % |

Sur `géolocalisation lente`, le premier lieu passe de **3 137 ms à 2 445 ms**
— c'est le seul profil du banc où ce jalon existe, les autres n'ayant aucune
source qui réponde.

Deuxième visite (cache chaud) : interactive **421 ms** (contre 454),
recommandations **720 ms** (contre 741), et sur le banc `vitesse` premier
résultat **293 ms** contre 548.

Le reste, inchangé ou meilleur : **0 requête dupliquée** (comme avant),
gestes entre 5 et 14 ms, bascule Tourcoing → Lille → Paris → Rouen entre 83
et 130 ms, et 42/42 au banc de stabilité (réseau lent, API en panne,
géolocalisation refusée).

## Dix minutes d'usage, sans rechargement

`outils/session-longue.mjs` joue une vraie session : recherches de ville
enchaînées, allers-retours vers « autour de moi », groupes temporels, panneau
ouvert et refermé, fiche d'un lieu. Toutes les trente secondes il relève ce
qui pourrait grossir.

Sur la livraison, **191 tours de recherche en dix minutes** :

| | début de session | fin |
|---|---|---|
| nœuds du document | 456 | 444 |
| lieux en mémoire | 184 | 184 |
| marqueurs posés | 6 | 6 |
| stockage local | 319 ko | 437 ko |

Aucune erreur JavaScript, aucune ville quittée qui revient, aucun écran vide.
La collection de lieux monte jusqu'à ce que les quatre villes aient été
visitées — c'est voulu, c'est ce qui rend le retour instantané — puis elle ne
bouge plus. **8/8.**

## Ce qui n'est PAS atteint, et pourquoi

L'objectif d'une **interface interactive sous la seconde à froid** n'est pas
tenu, et il ne peut pas l'être par ce chemin. Le calcul est simple :

```
interactive ≈ document (320 ms) + JS ÷ débit + analyse (~300 ms)
```

À 200 ko/s, tenir 1 000 ms demanderait un budget de **moins de 40 ko** de
JavaScript critique. Le programme en fait 169 une fois allégé. Y arriver
supposerait de le réécrire — ce qui n'était pas le sujet de cette passe.

Ce qui reste possible, dans l'ordre de rendement :

1. **Le blocage du fil principal en zone dense reste hors budget** :
   875 ms mesurés sur 120 lieux, pour un objectif de 300 ms. Le coût est dans
   `accueil` et `recommandations` (voir les lignes CPU de `outils/vitesse.mjs`).
   C'est du découpage de travail, pas du réseau — un chantier à part.
2. **Les écrans de l'Aide détaillée** (~56 ko brut) sont restés sur le chemin
   critique : `majFeuille2` les appelle en position d'expression et
   `basculerAide` bascule un état de façon synchrone en une vingtaine
   d'endroits. Les différer demande de retoucher ce flux de rendu, pas juste
   de déplacer des fonctions.
3. **Les modules auxiliaires** (`explications.js`, `signaux.js`, `donnees.js`,
   `events.js` — 14 ko gzip) ne sont touchés par aucun chemin de démarrage :
   ils pourraient rejoindre `differe/`.

## Au passage : « Rouen » depuis Paris affichait un écran vide

Trouvé en ajoutant l'enchaînement Paris → Rouen au banc des contextes.
**Bug préexistant**, reproduit à l'identique sur le code d'avant cette passe.

`chargerZone` refuse de partir quand la carte est trop dézoomée — vue de très
loin, « ce qui est à l'écran » couvre un pays. Mais `cadrerSur` est **animé** :
pour aller de Paris à Rouen, Leaflet dézoome, traverse, puis rezoome.
Interrogé pendant la traversée, `getZoom()` rend un niveau de survol, et le
chargement était abandonné en silence — la zone changeait, la carte bougeait,
et aucune requête ne partait.

L'appelant qui vient de lancer le cadrage sait où la carte va se poser : il
l'annonce désormais (`zoomVise: ZOOM_ZONE_MIN`, le plancher que les deux
branches du cadrage garantissent). Vérifié par `tests/contexte.test.mjs` et
par l'étape « 3 bis » de `outils/contextes.mjs`.

## Comment tout rejouer

```sh
npm ci

cd autour
export AUTOUR_LEAFLET_DIST=../node_modules/leaflet/dist

node --test "tests/*.test.mjs"        # 944 vérifications

node outils/chemin-critique.mjs --profil=tous      # démarrage à froid
node outils/chemin-critique.mjs --repeat           # deuxième visite
node outils/vitesse.mjs                            # requêtes, CPU, blocages
node outils/interactions.mjs                       # latence des gestes
node outils/contextes.mjs                          # Tourcoing → Lille → Paris → Rouen
node outils/session-longue.mjs                     # dix minutes d'usage

# les mêmes bancs sur la copie allégée
node outils/alleger.mjs
RACINE_MESURE=$PWD/livraison AUTOUR_RACINE=$PWD/livraison node outils/vitesse.mjs
```

Les bancs acceptent `AUTOUR_CHROME`, `AUTOUR_LEAFLET_DIST`, `RACINE_MESURE`
et `AUTOUR_RACINE` : ils peuvent donc mesurer indifféremment la source ou la
livraison, et c'est ainsi qu'on prouve que les deux se comportent pareil.
