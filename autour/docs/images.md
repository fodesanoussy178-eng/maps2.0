# Les photos des lieux et des événements

`docs/vignettes.md` disait : *« Ce qui manque réellement, ce n'est pas de
l'architecture, c'est une source d'images affichable. »* Ce document décrit la
source, et le résolveur unique qui la choisit.

**Le dessin n'a pas bougé.** Les emplacements, la tuile teintée de repli, le
`figcaption` : tout est celui de `docs/vignettes.md`, à l'octet près. Une carte
sans photo et la même carte avec photo ont exactement la même géométrie.

---

## 1. Le bug OpenAgenda : `https://img.openagenda.com/main/` → HTTP 400

### Ce qui se passait

`sync-openagenda/normalize.mjs` cherchait une URL en descendant l'objet `image`
clé par clé :

```js
["url", "full", "base", "original", "large", "medium", "thumbnail", "src", "@id"]
```

Or l'API v2 d'OpenAgenda ne rend pas une URL. Elle rend un objet en **deux
morceaux** :

```json
"image": {
  "base": "https://img.openagenda.com/main/",
  "filename": "5f3c1ab4e2c14.jpg",
  "size": { "width": 1500, "height": 1000 },
  "variants": [{ "filename": "…_thumb.jpg", "type": "thumbnail", "size": {…} }]
}
```

`base` est **troisième** dans la liste, c'est une chaîne, et elle commence bien
par `https://`. La descente s'arrêtait donc là et rendait le répertoire :

```
https://img.openagenda.com/main/     →  HTTP 400
```

Ce n'était pas une image absente : c'était une image **présente dont on jetait
la moitié du nom**. L'URL était écrite en base, servie au navigateur, et le
`onerror` de la carte retirait sagement la balise. Personne n'a jamais vu
d'erreur — seulement des cartes sans photo.

### Ce qu'on a fait

On **retrouve le champ d'origine et on reconstruit l'URL** — on ne filtre pas
les 400.

| | |
| --- | --- |
| `sync-openagenda/image.mjs` | recompose `base` + `filename`, met le fichier principal en concurrence avec ses variants, et sert le plus petit qui reste assez large (900 px). Lit aussi `imageCredits`, qui était ignoré. |
| migration `20260821120000` | efface les URL déjà écrites qui ne nomment aucun fichier — la prochaine synchronisation les réécrira correctement — puis pose une contrainte pour que le bug ne puisse plus être réécrit. |
| `images.js` | garde du dernier mètre : quelle que soit la source, une URL de répertoire n'entre pas dans une carte. |

### Une règle, trois langages

« Une URL d'image nomme une ressource » est écrite trois fois, parce qu'elle
s'applique dans trois runtimes :

| où | quoi |
| --- | --- |
| `sync-openagenda/image.mjs` | `urlNommeUnFichier()` — connecteur Deno |
| `images.js` | `urlImageValide()` — navigateur |
| migration | `public.image_url_nomme_un_fichier()` — base |

Le test `connecteur et navigateur se prononcent identiquement sur les mêmes URL`
compare les deux implémentations JavaScript cas par cas ; la troisième est
écrite sur les mêmes cas.

La nuance qui compte : un mot d'arborescence seul (`/main`, `/thumbnails`) est
refusé **sauf** si autre chose désigne une ressource — une extension, ou des
paramètres. Sans elle, l'URL photo de Google Places, qui se termine par
`/media?key=…`, serait refusée à tort.

---

## 2. L'ordre des sources

```
source existante  →  tags OSM (image, wikimedia_commons, wikidata)
                  →  Wikimedia/Wikidata  →  photo Autour
                  →  Google Places (repli)  →  rien
```

| rang | `image_source` | ce que c'est |
| --- | --- | --- |
| 1 | `openagenda` · `datatourisme` · `structure` | l'affiche officielle, la photo du catalogue sous licence ouverte, celle déposée par la structure |
| 2 | `site_officiel` | tag OSM `image` pointant le site du lieu lui-même |
| 3 | `wikimedia_commons` | atteint par `wikimedia_commons` ou via `wikidata` → P18 |
| 4 | `autour` | photo publiée par quelqu'un du quartier |
| 5 | `google_places` | dernier recours |
| — | *(rien)* | la tuile teintée reste. C'est une réponse. |

**Google Places n'est pas une source existante.** `providers/versInterne` pose
la photo Places dans `image` dès que la fiche arrive : la traiter comme un
acquis l'aurait placée au rang 1 et aucune photo Commons n'aurait jamais été
demandée pour un lieu que Google connaît aussi. Elle redescend donc à sa place,
et `depuisGoogle` sait la retrouver là où elle est déjà posée.

---

## 3. Le contrat

```
image_url          l'image à afficher, jamais rehébergée
image_source       une des sept valeurs ci-dessus, jamais autre chose
image_source_url   la page où l'on peut vérifier
image_author       qui l'a prise
image_license      sous quelle licence on l'affiche
image_updated_at   quand Autour a établi ce visuel
```

Plus `image_scope` (`lieu` / `evenement`), qui n'est pas dans le minimum
demandé mais sans lequel la règle « l'affiche avant le bâtiment » ne peut pas
s'écrire.

La même forme des deux côtés : colonnes dans `public.events`, rendues par
`evenements_proches()`, champs sur l'objet lieu côté navigateur, et champs
recopiés dans le jeu rapide — une image sans son origine ne pourrait plus dire
de quel droit on l'affiche à la réouverture.

---

## 4. Les règles de droit, qui sont des règles

- **Rien n'est téléchargé ni réhébergé.** On référence des URL. Le test
  `rien n'est téléchargé ni réhébergé` interdit toute copie de fichier dans le
  résolveur. Un droit flou ne devient pas clair parce qu'on aurait copié le
  fichier.
- **Wikimedia n'entre que sous licence libre explicite.** Sans
  `LicenseShortName` lisible, ou avec `Fair use` / `non-free` / `All rights
  reserved`, le placeholder reste.
- **Le tag OSM `image` n'est retenu que dans deux cas clairs** : il pointe
  Wikimedia (on repasse par Commons pour la licence), ou il pointe le site
  officiel du lieu — même hôte que `website` / `contact:website`. Tout le
  reste est l'image de quelqu'un d'autre sur le serveur de quelqu'un d'autre.
- **Aucune image générée.** Autour n'en demande à personne, refuse les
  hébergeurs de génération au niveau de l'URL, et refuse les fichiers qui se
  déclarent comme tels dans leurs métadonnées Commons — accents compris.
- **Google Places est affiché selon ses règles** : crédit obligatoire à côté de
  la photo, et **jamais conservé**. `estContenuGoogle` écartait déjà les fiches
  Google du jeu rapide ; `sansPhotoGoogle` écarte en plus la photo elle-même
  d'un lieu OpenStreetMap qui l'aurait reçue en repli.

### Le crédit décide où la photo peut apparaître

La ligne de résultat fait 46 px : elle ne porte pas un crédit lisible. La règle
existait, écrite en dur pour Google seul ; elle est maintenant dite une fois,
pour toutes les sources :

```js
const photoVisible = l.image && !(IMAGES && IMAGES.creditObligatoire(l));
```

Une CC-BY de Commons est donc soumise à la même contrainte qu'une photo Places.
Une CC0, un domaine public, une photo déposée par la structure : rien à
créditer, la vignette passe partout.

---

## 5. La photo doit être celle du lieu

Aucune recherche par nom. Aucune photo de catégorie. Aucune vue de la ville.
Un identifiant Wikidata n'est suivi que s'il est écrit **sur l'objet
lui-même** :

| tag | suivi ? | pourquoi |
| --- | --- | --- |
| `wikidata` | oui | c'est l'objet |
| `wikimedia_commons` | oui | c'est l'objet |
| `image` | sous conditions | voir plus haut |
| `brand:wikidata` | **non** | l'enseigne — donnerait le logo de la chaîne |
| `operator:wikidata` | **non** | l'exploitant |
| `subject:wikidata` | **non** | le sujet d'une statue |
| `architect:wikidata`, `artist:wikidata` | **non** | ni l'un ni l'autre n'est le lieu |

C'est exactement ainsi qu'une photo « de la bonne catégorie » finit sur la
mauvaise fiche. Le refus est explicite, et testé.

---

## 6. Les événements : l'affiche avant le bâtiment

`versEvenementCanonique` écrivait `imageSource:"datatourisme_licence"` pour
**toute** image d'événement. Or le connecteur DATAtourisme écrit
`image_url: null` : les seules affiches en base viennent d'OpenAgenda. On
étiquetait donc une affiche d'organisateur comme une image de catalogue sous
licence ouverte — et `photoAutoriseeAide` la laissait passer sur ce faux titre.

La provenance arrive maintenant de la base, où le connecteur l'a écrite.
`image_scope: "evenement"` marque l'affiche : une photo de bâtiment ne la
remplace jamais. La garde ne se déclenche que si l'affiche est déjà là — un
événement qui n'en a pas peut recevoir la photo de la salle en attendant.

---

## 7. Rien sur le chemin critique

Le résolveur est appelé depuis `enrichirCandidats`, lui-même différé par
`ORDO.differer` **après** la pose des cartes, et son résultat n'est jamais
attendu :

```js
if(IMAGES) IMAGES.resoudreLot(classement, {redessiner:rendre1}).catch(()=>{});
```

Une panne de Commons, un réseau coupé, un lieu sans photo : l'écran garde
exactement ce qu'il montrait. Au plus 8 lieux par vague, 3 appels en vol, 8 s
de budget par appel. `planifierRendu` regroupe les repeints par image : dix
photos en rafale ne produisent pas dix rendus.

---

## 8. Les jeux de zone

`outils/zones.mjs` ne conservait pas `image`, `wikimedia_commons` ni
`wikidata` : un jeu de zone ne pouvait porter **aucune** photo, et le démarrage
à froid — le moment où l'écran a le plus besoin d'être vivant — restait gris
par construction. Les trois tags sont maintenant dans `TAGS_UTILES`.

Les fichiers `zones/*.json` déjà versionnés datent d'avant ce changement : il
faut les régénérer (`node outils/zones.mjs`) pour qu'ils en profitent.

---

## 9. Mesurer

```
node outils/images-reelles.mjs            # ce qui serait demandé — aucun réseau
node outils/images-reelles.mjs --routage  # le routage, corpus SIMULÉ
node outils/images-reelles.mjs --live     # LA MESURE — Overpass + Wikimedia
```

Cinq lieux réels : Palais des Beaux-Arts de Lille (Q2628596), Gare de
Lille-Flandres (Q801098), La Piscine à Roubaix (Q1955748), La Condition
Publique à Roubaix (Q22979739), Le Grand Mix à Tourcoing (Q16303798).

Seul `--live` décrit le monde. Le mode `--routage` prouve l'ordre des sources
et les règles de droit sur un corpus annoncé comme inventé ; il n'annonce
aucune photo. S'il ne peut pas joindre Overpass, `--live` s'arrête et le dit,
plutôt que de rendre un tableau qui ressemblerait à une mesure.

---

## 10. État de l'activation en production (21/08/2026)

### Ce qui a été mesuré avant

La base disait exactement ce que le diagnostic annonçait, et pire :

| | |
| --- | --- |
| événements avec une image | **857** |
| dont `https://img.openagenda.com/main/` | **857** — soit *100 %* |
| événements OpenAgenda au total | 874 |

Autrement dit : **98 % des événements OpenAgenda avaient une affiche, et aucune
ne s'est jamais affichée.** Le champ d'origine, lui, était intact dans
`event_sources.raw_data` — 862 objets `image` complets avec `base`,
`filename` et `variants`, et 626 crédits photo jamais lus.

La forme réelle servie par l'API, relevée en production :

```json
{ "base": "https://img.openagenda.com/main/",
  "filename": "c39b….base.image.jpg",
  "size": {"width": 700, "height": 700},
  "variants": [ {"type": "full", "size": {"width": 1080}, "filename": "c39b….full.image.jpg"},
                {"type": "thumbnail", "size": {"width": 200}, "filename": "c39b….thumb.image.jpg"} ] }
```

`construireUrlImage` retient le variant `full` : 1080 px, le plus petit qui
reste au-dessus des 900 px utiles — pas la vignette de 200 px, pas l'original.

### Ce qui a été fait

1. **Migration appliquée.** 857 URL effacées, 5 colonnes de provenance,
   contrainte `events_image_url_nomme_un_fichier` validée, `evenements_proches()`
   recréée avec la provenance.
2. **Fonction `sync-openagenda` redéployée** (v11) — obligatoire : l'ancienne
   version aurait réécrit l'URL de répertoire que la contrainte refuse
   désormais, et le cron de 3 h aurait échoué.
3. **Synchronisation relancée** via `private.invoke_event_territory_sync()`.
   Lille, Roubaix, Tourcoing, Rouen, Paris : **5 succès, 0 erreur**.

### Après

| | |
| --- | --- |
| affiches reconstruites | **836** |
| URL encore cassées | **0** |
| servant le variant `full` | 753 |
| portant un crédit photo | 616 |
| valeurs distinctes de `image_source` | 1 (`openagenda`) |

### Écart connu, sans effet

Les fichiers `dedup.mjs` et `normalize.mjs` déployés portent la classe de
caractères combinants écrite en littéral (`[̀-ͯ]`) là où le dépôt écrit
`[̀-ͯ]`. Les deux formes sont **la même expression régulière** — le
moteur interprète `̀` comme le caractère U+0300 — et l'équivalence a été
vérifiée sur des titres accentués réels.

La cause est l'encodage JSON de l'outil de déploiement, qui décode les
séquences `\uXXXX` avant de les écrire. Un déploiement par la CLI Supabase
(`supabase functions deploy`) restitue le dépôt à l'octet près et referme
l'écart. Tout le reste — les six autres fichiers, `index.ts` compris — est
identique au dépôt, vérifié octet par octet.
