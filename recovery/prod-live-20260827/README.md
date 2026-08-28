# Artefacts de production récupérés — autour.eu, 27/08/2026

Ces fichiers sont des artefacts de build récupérés depuis autour.eu.
Ils ont été transformés par esbuild.
Les commentaires/sources originales sont perdus.
Ils constituent une sauvegarde exécutable/de dernier recours de la production
du 27/08/2026.
Ils ne doivent pas être fusionnés directement dans main.

---

## Ce que ce dossier est, et ce qu'il n'est pas

**Ce n'est PAS la source d'Autour.** C'est ce que le navigateur reçoit : la
sortie de `outils/alleger.mjs`, dont esbuild a retiré toute la prose française
qui explique le pourquoi de chaque règle. Cette prose appartenait au dépôt et
elle est perdue : la suppression des commentaires est irréversible.

**À quoi ça sert.** À savoir précisément ce que la production faisait le
27/08/2026, quand plus aucune source ne le dit. À lire un algorithme, à
comparer un comportement, à reporter une logique. Rien de plus.

## Pourquoi ces fichiers ne reproduiront jamais les `?v=`

`outils/tamponner.mjs` calcule l'empreinte sur **la source du dépôt**, pas sur
le fichier servi :

    createHash("sha256").update(await readFile(fichier, "utf8")).digest("hex").slice(0, 8)

Vérifié sur un module témoin : `providers/datatourisme.js`, dont la source Git
est identique à celle de la prod, a pour empreinte source `6f242f4e` — la
valeur du manifeste — alors que sa forme allégée vaut `dd187c18`.

Conséquence : **versionner ces artefacts comme sources produirait d'autres
`?v=` que ceux servis aujourd'hui.** C'est la raison pour laquelle ils restent
ici, isolés, et ne rejoignent pas l'arbre applicatif.

## Provenance

| | |
|---|---|
| Déploiement Vercel | `dpl_nfVGndrAFhDj2RJCjaSyuyDxRqpk` |
| Alias | `autour.eu`, `autour.vercel.app` |
| Cible | `production` |
| Origine | upload direct (`vercel --prod`) — **aucun commit Git associé** |
| Récupéré le | 27–28/08/2026, par téléchargement des fichiers servis |
| Méthode | octets exacts de la réponse HTTP, sans retouche |

Contrôle de fidélité : `providers/datatourisme.js` récupéré est **identique au
même octet** à la source Git passée dans `alleger.mjs`. La chaîne de
récupération est donc fidèle.

## Les 34 modules de la production

| module | `?v=` servi | état vis-à-vis de Git | dans ce dossier |
|---|---|---|---|
| `availability.js` | `fefb49c1` | identique à Git | — |
| `comprendre.js` | `674ea341` | identique à Git | — |
| `donnees.js` | `c3559619` | identique à Git | — |
| `intentions.js` | `39e671d2` | identique à Git | — |
| `comptes.js` | `9f5e8a5d` | identique à Git | — |
| `maintenant.js` | `21c39395` | identique à Git | — |
| `ordonnanceur.js` | `c8368526` | identique à Git | — |
| `plafonds.js` | `fac04c2e` | identique à Git | — |
| `annonces-taxonomie.js` | `8bab34b5` | ABSENT de Git | oui |
| `annonces-classement.js` | `45434ec3` | ABSENT de Git | oui |
| `envies.js` | `9f6fe1a5` | identique à Git | — |
| `enrichissements.js` | `18427494` | prod plus récente | oui |
| `contexte.js` | `54aec3b1` | identique à Git | — |
| `territoire.js` | `589cf5db` | identique à Git | — |
| `aide-taxonomie.js` | `be5a07f1` | prod plus récente | oui |
| `aide-classement.js` | `f3ef883d` | prod plus récente | oui |
| `aide-rayon.js` | `c36fcbae` | identique à Git | — |
| `aide-contexte-ia.js` | `3da4c06f` | identique à Git | — |
| `aide.js` | `9fb4c9de` | prod plus récente | oui |
| `signaux.js` | `319acaa9` | identique à Git | — |
| `temporel.js` | `35a146e1` | prod plus récente | oui |
| `explications.js` | `ea344e6e` | identique à Git | — |
| `events.js` | `2a03415f` | identique à Git | — |
| `images.js` | `159d48a4` | identique à Git | — |
| `core.js` | `a8780708` | prod plus récente | oui |
| `providers/normaliser.js` | `d4adfe74` | prod plus récente | oui |
| `providers/googlePlaces.js` | `70338a03` | identique à Git | — |
| `providers/datatourisme.js` | `6f242f4e` | identique à Git | oui |
| `providers/aideInstitutionnelle.js` | `31dd2cfc` | ABSENT de Git | oui |
| `providers/decouvertes.js` | `e089f93c` | identique à Git | — |
| `providers/osm.js` | `9553d989` | prod plus récente | oui |
| `mapProviders/googleMaps.js` | `2c285b59` | prod plus récente | oui |
| `app.js` | `1e710a08` | prod plus récente | oui |
| `differe/ecrans.js` | `b33de0f7` | prod divergente | oui |

Répartition : **20 identiques à Git**, **11 divergents de Git**,
**3 absents de Git**.

Les 20 modules identiques ne sont pas copiés ici : leur source, commentaires
compris, vit déjà dans le dépôt et vaut mieux que leur artefact.

### Le 34e module, ajouté le 28/08

`differe/ecrans.js` a échappé au premier inventaire, et la raison mérite d'être
écrite : **`index.html` ne le mentionne jamais.** `app.js` va le chercher au
besoin, et son empreinte vit dans `VERSIONS_DIFFEREES`, dans `app.js` —
c'est-à-dire à l'endroit exact où un inventaire fondé sur les balises
`<script>` ne regarde pas. Il porte pourtant les fiches de lieu, l'itinéraire,
la publication et tout l'écran de compte : sans lui, la reconstruction servait
un code différent de celui de la production sur la moitié des écrans.

La direction de la divergence n'est pas établie — d'où « prod divergente »
plutôt que « prod plus récente ». Ce qui est établi, c'est qu'il s'agit bien de
l'artefact servi : il définit les 27 écrans que `ECRANS_DIFFERES` amorce, il
diffère de ce que le dépôt produit (`79e47a50…` contre `2e511725…`, 963 lignes
contre 955), et sa proportion de commentaires — 7 lignes contre 76 dans la
source — porte la signature d'un passage par esbuild.

Avec lui, les 34 modules servis sont vérifiables : 15 par leurs octets
d'origine, 19 par l'égalité `sha256(source du dépôt) == ?v= servi`. Aucun trou.

## Fichiers absents de tout Git

Vérifié sur toutes les branches, le reflog et les 29 commits orphelins :

- `annonces-taxonomie.js` — moteur d'intérêts « Pour toi » (`INTEREST_MATCHING`)
- `annonces-classement.js` — classement des annonces (`AutourAnnoncesClassement`)
- `providers/aideInstitutionnelle.js` — provider service-public.fr

## Le côté serverless — `fonctions/`

Une fonction edge est *exécutée*, jamais servie : on ne la télécharge pas
depuis autour.eu. Mais Vercel conserve les fichiers d'origine d'un envoi direct
par CLI, et l'onglet *Source* du déploiement `nfVGndrAF` les rend. C'est de là
que vient ce dossier — et, différence capitale avec `artefacts/`, **ce sont de
vraies sources** : la prose française y est intacte, esbuild n'est jamais passé.

    fonctions/
      api/aide-institutionnelle.js              la route
      data/aide-institutionnelle-dila-59599.js  l'instantané de secours

La disposition reproduit celle de la racine du projet, pour que l'import
relatif `../data/…` de la route se résolve tel quel.

### La chaîne est complète, et vérifiée

`api/aide-institutionnelle.js` a **une seule dépendance locale** — la ligne 11,
`import snapshotTourcoing from "../data/aide-institutionnelle-dila-59599.js"` —
et **aucune variable d'environnement**. Tout le reste est du HTTPS public :
`geo.api.gouv.fr`, `api-lannuaire.service-public.gouv.fr`,
`lannuaire.service-public.gouv.fr`, `lecomarquage.service-public.gouv.fr`.

Exercée hors ligne, réseau coupé sauf la résolution de commune, la route
bascule sur `baseLocaleStatique()` et rend **24 institutions**, statut 200,
en-tête `x-autour-source: service_public`. Le `normaliser` du provider de
production digère le premier item et produit un lieu complet — « Mission Emploi
Lys Tourcoing », 50.709408 / 3.166806, catégorie `emploi`, source
`service_public`. Le maillon client tient donc lui aussi.

L'instantané couvre la commune **59599 (Tourcoing)** seulement, daté du
26/08/2026, 24 enregistrements. Ailleurs, `baseLocaleStatique()` rend `null` et
la route dépend entièrement de l'amont — c'est un filet local, pas une copie de
l'annuaire national.

## Routes API non récupérables

Aucune. L'inventaire du 27/08 en annonçait deux ; les deux étaient des erreurs
de lecture.

- `api/interpreter.js` **n'a jamais existé**. Les quatre `/api/interpreter` d'
  `app.js` sont des serveurs Overpass externes (`overpass-api.de`,
  `overpass.kumi.systems`, …), pas une route locale. Idem pour `/api/broadcast`
  (Supabase Realtime, dans le SDK vendorisé) et `/api/js` (Google Maps).
- `api/aide-institutionnelle.js` était bien réelle, et elle est ici.

## Références associées

- Backend et versionnement : branche `stabilisation/prod-20260827` — 32
  migrations alignées sur l'historique Supabase distant, 6 fonctions edge.
- Frontend, référence exécutable : `autour.eu` lui-même.

## Intégrité

`SHA256SUMS.txt`, à la racine de ce dossier, porte l'empreinte de chaque
fichier — `artefacts/` et `fonctions/` — au moment du dépôt. Il se vérifie
depuis cette racine :

    cd recovery/prod-live-20260827 && sha256sum -c SHA256SUMS.txt
