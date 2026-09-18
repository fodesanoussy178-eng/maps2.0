# Le lot E — mesurer avant d'optimiser

> État : **livré**. Lots précédents : [A](./pertinence-personnelle.md),
> [B](./cycle-evenement.md). Suite : C (portée dynamique), D (Paris
> hiérarchique), F (offres, aide, `open_now`).

## Ce que le plan supposait, et ce que la mesure a dit

`docs/maintenant.md` affirmait depuis des mois :

> « Ce qui reste est la pose des marqueurs et la déduplication, toujours d'un
> bloc. »

C'était faux. Sur un centre-ville dense de 130 lieux :

| fonction | coût par appel |
|---|---|
| `dedupeItems` | **0,16 ms** |
| `groupLogicalPlaces` | 0,65 ms |
| `rankResults` | **108,6 ms** |

La déduplication, accusée pendant des mois, n'a jamais coûté un sixième de
milliseconde. Le lot E aurait découpé l'ingestion en tranches — un chantier
lourd, risqué, et qui n'aurait rien réglé.

**La leçon vaut mieux que le chiffre.** L'ancienne section nommait un coupable
plausible sans l'avoir mesuré, et personne ne l'a rouverte tant qu'elle
semblait raisonnable.

## Le vrai coupable

Un profilage par fonction, sur un seul classement de 130 lieux :

```
T.statutTemporel           130 appels    113,9 ms
AV.getPlaceAvailability    130 appels    111,4 ms
```

0,86 ms par lieu. Pas l'analyse des horaires OSM — la **construction d'un
`Intl.DateTimeFormat`**, faite à chaque appel pour projeter l'instant dans le
fuseau du lieu, dans `partsInZone` (availability.js) et `partsLocales` /
`jourSemaine` (temporel.js).

```
construction d'un formateur : 0,067 ms
utilisation du formateur    : 0,013 ms
```

**On payait cinq fois le prix du travail utile**, plusieurs fois par lieu.

## La correction

Un formateur ne dépend que de sa locale, de ses options et de son fuseau. Il est
**immuable** et se partage sans risque. On le garde dans une `Map` par fuseau.

**Ce qu'on garde est le formateur, jamais la date qu'il rend.** C'est la
distinction qui rend le cache sûr : un changement d'heure est appliqué par le
formateur *au moment de formater*, pas à sa construction. Un test le vérifie de
part et d'autre des deux bascules de 2026, sur trois fuseaux.

### Avant / après, mesuré

| | avant | après | facteur |
|---|---|---|---|
| `rankResults` · 130 lieux | 108,6 ms | **14,0 ms** | 7,8× |
| `rankResults` · 300 lieux | 241,6 ms | **26,6 ms** | 9,1× |
| `rankResults` · 600 lieux | 495,5 ms | **52,9 ms** | 9,4× |

Et dans le navigateur, sur le scénario « centre dense (120 lieux) » du banc
`outils/vitesse.mjs`, lancé sur `main` puis sur la branche :

| | `main` | après |
|---|---|---|
| pire blocage du fil principal | **556 ms** — objectif non tenu | **175 ms** — objectif tenu |
| vérifications passées | 7/13 | 7/13 |

> Les six vérifications en échec sont identiques des deux côtés : elles
> demandent des événements à Supabase, injoignable depuis le bac à sable, et
> échouent sur « premier résultat à `null` ms ». Ce ne sont pas des
> régressions, et il faut le dire plutôt que d'annoncer 7/13 comme un résultat.

Trois lignes de mémorisation. Aucune découpe d'ingestion, aucun `parLots`
supplémentaire, aucun risque d'écran à moitié peint.

## Le quadrillage spatio-temporel

`grille.js` répond à deux questions, et seulement à celles-là :

- `quoiDeNeuf(avant, apres)` → cellules **apparues**, **disparues**,
  **modifiées**. Jamais « tout a changé », qui n'apprend rien.
- `quoiVaChanger(index, {horizonMs})` → l'instant du prochain changement connu.

**Une maille, pas un rayon.** Une cellule d'un centième de degré — le grain déjà
employé par les clés de cache de `contexte.js` — ne bouge pas quand la carte
glisse de trois cents mètres. Deux rendus successifs parlent donc des mêmes
cellules et se comparent. Un rayon centré sur la vue change à chaque image et ne
se compare à rien.

**L'empreinte d'une cellule parle du contenu, pas de l'ordre.** Sinon la moindre
remontée de score passerait pour une nouveauté.

**La grille n'est pas la zone.** `contexte.js` décide de ce qu'on montre ; ce
module ne décide de rien. Il indexe, il compare, il prévient. Aucun filtre
d'affichage ne passe par là — c'est ce qui l'empêche de devenir un second
système de zones qui divergerait un jour du premier.

### Un défaut trouvé en écrivant le test

`Number(null)` vaut **zéro**, et zéro est une latitude parfaitement valide, au
large du golfe de Guinée. Un objet sans coordonnées se rangeait donc dans une
cellule bien réelle, et `quoiDeNeuf` aurait annoncé des changements dans un
océan. L'absence est refusée avant la conversion.

## Le réveil temporel — le consommateur du quadrillage

**Le défaut, tel qu'il se vit.** Quelqu'un laisse Autour ouvert pendant la
soirée. À 22 h 10, l'écran affiche toujours « Ouvert · jusqu'à 22:00 », et
« 🔥 Dans 3 jours » sur un événement qui, depuis minuit, est à deux jours. Rien
n'est faux au moment où c'est écrit ; tout devient faux ensuite, et personne ne
le corrige tant qu'on ne touche pas l'écran.

**Les deux mauvaises réponses.** Ne rien faire laisse la phrase mentir. Un
battement régulier paie un recalcul toutes les minutes pour rien la plupart du
temps — et sur un téléphone, ça se voit sur la batterie.

**La bonne.** Le cycle du lot B sait déjà quand sa lecture cesse d'être vraie et
le dit (`expireLe`) : minuit pour une approche, deux jours pour une billetterie
qui vient d'ouvrir. `grille.js` prend le plus proche de ce qui est à l'écran, et
on ne se réveille qu'à ce moment-là, entre 30 secondes et 30 minutes.

Le plus souvent, **il n'y a rien à programmer**, et c'est une réponse saine : un
écran qui ne contient que des lieux permanents n'a aucune raison de se réveiller.
Le réveil ne demande rien au réseau — il reclasse ce qu'on a déjà, comme le
battement territorial. **Recalculer n'est pas resynchroniser.**

## Vérification

```sh
node --test tests/grille.test.mjs             # 16 · maille, changements, réveil, formateurs
node --test tests/*.test.mjs                  # la suite entière
AUTOUR_RACINE=autour node autour/outils/vitesse.mjs   # depuis la racine du dépôt
```

**Suite complète : 1823 succès, 14 échecs** — les 14 préexistants, aucun nouveau.

## Ce qui n'a pas été fait, et pourquoi

**La découpe de l'ingestion en tranches.** C'était le cœur annoncé du lot. La
mesure l'a rendue inutile : le rendu progressif des marqueurs existait déjà
(`programmerRenduCarteProgressif`, via `ordonnanceur.js`), et ce qui restait
d'un bloc ne coûtait pas assez pour justifier le risque d'un écran à moitié
peint. On ne découpe pas ce qui prend 0,16 ms.

**Un index de cellules persistant entre rendus.** `grille.js` sait le faire,
mais aucun appelant n'en a besoin aujourd'hui : avec un classement à 14 ms,
économiser un recalcul ne vaut pas le risque d'un écran périmé. Le module est
prêt le jour où les notifications en auront l'usage — c'est son vrai débouché.
