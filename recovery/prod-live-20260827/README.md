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

## Les 33 modules de la production

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

Répartition : **20 identiques à Git**, **10 dont la prod est plus récente**,
**3 absents de Git**.

Les 20 modules identiques ne sont pas copiés ici : leur source, commentaires
compris, vit déjà dans le dépôt et vaut mieux que leur artefact.

## Fichiers absents de tout Git

Vérifié sur toutes les branches, le reflog et les 29 commits orphelins :

- `annonces-taxonomie.js` — moteur d'intérêts « Pour toi » (`INTEREST_MATCHING`)
- `annonces-classement.js` — classement des annonces (`AutourAnnoncesClassement`)
- `providers/aideInstitutionnelle.js` — provider service-public.fr

## Routes API non récupérables

- `api/interpreter.js`
- `api/aide-institutionnelle.js`

Elles sont appelées par la production (`/api/interpreter` ×4 dans `app.js`,
`/api/aide-institutionnelle` par le provider institutionnel) mais **leur source
est définitivement hors de portée** : ce sont des fonctions serverless, donc
*exécutées* et jamais servies. `https://autour.eu/api/interpreter.js` répond
**404**. Aucun dossier `.vercel/` n'existe sur la machine de récupération.

Seule la copie de travail ayant lancé le `vercel --prod` peut les contenir.

## Références associées

- Backend et versionnement : branche `stabilisation/prod-20260827` — 32
  migrations alignées sur l'historique Supabase distant, 6 fonctions edge.
- Frontend, référence exécutable : `autour.eu` lui-même.

## Intégrité

`SHA256SUMS.txt`, à la racine de ce dossier, porte l'empreinte de chaque
artefact au moment du dépôt.
