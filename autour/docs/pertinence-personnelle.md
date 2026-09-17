# Le lot A — le contexte unique et la pertinence personnelle

> État : **livré**. Lots suivants : B (phases de billetterie), E (performance),
> C (portée dynamique), D (Paris hiérarchique), F (offres et aide dans le feed).
> L'audit et le plan complet sont dans
> [`moteur-contexte-recommandation.md`](./moteur-contexte-recommandation.md).

## La règle, avant le code

> **Le déclaré sélectionne, l'implicite ordonne.**

Ce qui a été **coché** — les envies, les favoris — décide de ce qui a le droit
d'**entrer**. Ce qui est **déduit** d'un comportement ne décide que de
l'**ordre** de ce qui est déjà entré.

Ce n'est pas une intention écrite dans un commentaire, c'est une contrainte de
forme. `apprentissage.js` n'expose **aucune** fonction qui rende « ce que la
personne aime » sous forme de liste : `vecteur()` rend des poids entre 0 et 1.
Un poids ne sait pas filtrer. Un appelant distrait ne peut donc pas s'en servir
pour sélectionner, et le jour où quelqu'un voudra le faire, il devra d'abord
écrire la fonction qui manque — ce qui se voit en revue.

Deux garanties s'y ajoutent :

- **Aucun point sans phrase.** `pertinence.js` rend zéro quand le modèle ne
  sait pas dire *pourquoi*. Une poussée qui ne s'explique pas ne pèse pas, donc
  ne peut pas exister à l'écran sans son explication.
- **Éteindre efface.** « Ne plus personnaliser » vide le modèle au lieu de le
  mettre en sourdine. Laisser les compteurs en place derrière un interrupteur
  qui dit « préférences oubliées » serait un mensonge poli.

## Trois modules, tous purs

| fichier | ce qu'il sait |
|---|---|
| `apprentissage.js` | ce que le comportement laisse voir : poids décroissants, bornés, effaçables, exportables en clair |
| `pertinence.js` | dans quel ordre les critères tranchent, selon l'espace |
| `contexte-moteur.js` | un seul objet gelé : instant, heure, moment, saison, fenêtre, zone, point regardé, point réel, vecteur |

Aucun ne connaît le DOM, la carte, le réseau, ni aucune ville. C'est la règle
qui rend `territoire.js`, `temporel.js` et `contexte.js` testables sans
navigateur, et elle vaut ici aussi.

## Le défaut que le lot répare

Deux moteurs de classement coexistent :

| moteur | ce qu'il sert | lisait le profil |
|---|---|---|
| `rankResults` (`core.js`) | recommandations, recherche, contexte territorial | **non** |
| `scoreLieu` (`app.js`) | marqueurs de la carte, feuille, jeu de découverte | oui |

Un lieu pouvait donc être **premier sur la carte et absent de la liste juste en
dessous**. Les deux lisent maintenant le même vecteur, décroissance comprise.

Second défaut, plus discret : la question « dans quel contexte sommes-nous ? »
avait six réponses partielles. `contexteActuel()` lisait `instantCreneau()`,
`momentActuel()` le relisait, `contexteSaison()` repartait de `Date.now()`.
Trois lectures, trois instants possibles — un rendu à cheval sur minuit ou sur
18 h pouvait mélanger deux contextes dans le même écran. L'instant est
désormais fixé une fois et tout en dérive.

## La hiérarchie est contextuelle

Un score unique ne sait pas dire « d'abord ». Additionner pertinence, ampleur,
heure, distance et popularité dans un même nombre, c'est accepter que trois
cents avis rattrapent n'importe quoi.

La hiérarchie se pose **au-dessus** du score : le premier critère qui départage
tranche, les suivants ne sont pas lus, et ce qu'elle laisse à égalité redescend
vers la chaîne de départage historique.

| espace | ordre |
|---|---|
| `maintenant` | faisabilité → **temporalité** → **proximité** → personnel → importance → accessibilité → fraîcheur → diversité |
| `pourtoi` | **personnel** → **importance** → temporalité → proximité → accessibilité → fraîcheur → diversité |
| `explorer` | faisabilité → temporalité → personnel → importance → proximité → accessibilité → fraîcheur → diversité |
| `avenir` | idem `explorer` |

Dans « Maintenant » la question est *qu'est-ce que je peux faire là, tout de
suite* : le temps et les pieds commandent, et aucun goût ne fait entrer un
concert de dans trois semaines. Dans « Pour toi » tout est déjà à venir : la
question n'est plus *quand*, elle est *pour qui*.

**La faisabilité n'est pas un critère, c'est un garde-fou** : elle passe avant
tout, partout où elle figure. Envoyer quelqu'un devant une porte fermée est la
seule faute qu'Autour ne peut pas se permettre.

**La diversité est au dernier rang**, et sa place n'est pas un détail
d'implémentation : la variété ne coûte jamais la tête de liste.

### La popularité n'est pas un rang

Elle reste un **ingrédient du score** — les avis, la note —, capable de
départager deux propositions équivalentes, jamais d'en renverser une. Il n'y a
**aucune règle** qui la déclare inférieure à la personnalisation dans tous les
cas : il y a une place dans un ordre.

L'**ampleur**, elle, est un rang à part entière, et c'est ce qui permet à un
événement exceptionnel de porter loin sans qu'une brasserie très notée ne
remonte quoi que ce soit. Elle vient de ce que la source a déclaré
(`importance_level`, `importance_score`), jamais du nombre d'avis : l'ampleur
dit *combien de gens cet événement concerne*, la popularité dit *combien de
gens ont noté ce lieu*.

## Le cas obligatoire : Lille, un artiste suivi, un concert à Paris

| attendu | état |
|---|---|
| jamais dans « Maintenant » si le concert n'est pas maintenant | **tenu**, testé |
| très haut dans « Pour toi », devant un petit concert local plus proche | **tenu**, testé |
| la popularité brute ne l'emporte pas sur la personnalisation | **tenu**, testé |
| surveillance de la billetterie · ouverture · J-3 · jour J | **lot B** |

Les trois premiers vivent dans `tests/moteur-contexte.test.mjs`, à la fin du
fichier, sous leur propre titre. Les phases de billetterie viendront s'y
ajouter plutôt que dans un fichier séparé : c'est le même scénario.

## Ce qui a été noté, et ce qui ne l'est jamais

| geste | poids |
|---|---|
| ouvrir une catégorie | 1 |
| cliquer sur un résultat | 3 |
| ouvrir une fiche | 4 |
| une recherche | 5 |
| **sauvegarder** | 8 |
| **partager** | 8 |
| ignorer (« encore ») | −2 |

Ce qui est noté est la **catégorie**. Jamais le lieu, jamais la position,
jamais la phrase cherchée — et c'est une barrière dans le module
(`CLE_VALIDE`), pas une convention d'appel : une phrase entière est refusée en
silence.

Un refus pèse peu et ne peut jamais rendre un poids négatif : « je n'ai pas
cliqué » n'est pas « je n'aime pas ».

**Demi-vie de trois semaines**, appliquée à la lecture depuis la date de chaque
clé. Aucune tâche de fond : un onglet fermé pendant un mois rend la bonne
valeur à sa réouverture. Une semaine de recherches ne décide plus du classement
pour toujours.

**Seuil d'entrée** : un seul clic ne colore pas l'écran. C'est la règle
qu'`obtenirInteretsProbables` appliquait déjà — « au moins deux fois, et
au-dessus de la moyenne » — exprimée en poids, ce qui permet à une sauvegarde
de valoir ce que valaient quatre survols.

**Rien ne part sur le réseau.** Le module ne connaît que `localStorage`, et un
stockage qui refuse (navigation privée, quota) bascule en mémoire pour la
session plutôt que de casser l'application.

## La raison affichée

`rankPersoRaison` voyage à côté de `rankReason`, il ne le remplace pas.
« Ouvert · jusqu'à 22:00 » reste la première information utile ; « tu regardes
souvent ce genre de chose » est une explication, pas une information — elle ne
dit ni si c'est ouvert, ni jusqu'à quand, ni combien ça coûte.

Elle n'apparaît donc **qu'en dernier recours**, quand il n'y avait aucun fait à
donner. Et par construction, si elle n'existe pas, la poussée n'a pas eu lieu
non plus.

## Vérification

```sh
node --test tests/moteur-contexte.test.mjs     # 23 assertions
node --test tests/*.test.mjs                   # la suite entière
node outils/pertinence.mjs                     # le coût du lot, mesuré
```

**État de la suite** : 1772 succès, 14 échecs — exactement les 14 échecs
préexistants relevés sur `main` avant le lot (une partie exige un navigateur
absent du bac à sable, deux sont réels et antérieurs). Aucun échec nouveau.
`tests/livraison.test.mjs` passe désormais, `esbuild` ayant été installé.

## Le coût, mesuré et non supposé

```
150 objets · médiane de 15 tours entrelacés · trois exécutions

avant                                  239.5 / 245.1 / 239.9 ms
après, appelant non migré               +1.0 / +0.2 / +0.4 %
après, vecteur + envies + hiérarchie    +4.3 / −0.1 / +1.6 %
```

Trois chiffres et non un seul, parce qu'un seul aurait menti : le surcoût
câblé tient dans le bruit de mesure de cette machine. Ce qu'on peut affirmer
est qu'il ne se voit pas à 150 objets — pas qu'il vaut 4,3 %.

**Et le piège de mesure, parce qu'il vaut d'être connu.** Une première version
du banc chargeait l'ancien moteur, le mesurait, puis chargeait le nouveau et le
mesurait. Elle a rendu, pour un chemin de code **identique**, des surcoûts de
6,4 %, 9,0 % puis 12,7 % selon l'exécution : le second moteur mesuré hérite
d'un JIT chaud et d'un tas fragmenté. Ces chiffres ne disaient rien du code, ils
disaient l'ordre dans lequel on avait mesuré. `outils/pertinence.mjs` alterne
donc les scénarios à chaque tour et prend la médiane, et il refuse au-delà de
5 %.

Le blocage du fil principal en centre-ville dense reste ce qu'il était —
1815 ms pour un objectif de 1000 — et c'est le **lot E** qui s'en occupe.

## Ce qui n'a pas changé, volontairement

- `scoreLieu` reste le moteur des marqueurs de la carte. C'est son vrai métier :
  décider quoi poser à un zoom donné. Il cesse seulement d'être une **seconde
  autorité de classement** pour la feuille.
- La découpe des moments garde les bornes d'`app.js` **au chiffre près** —
  matin à 6 h, nuit à 23 h. Une découpe « plus propre » qui ferait commencer le
  matin à 5 h changerait ce que quelqu'un voit à 5 h du matin, sans que
  personne l'ait demandé. Déplacer du code n'est pas une occasion de déplacer
  un comportement.
- Sans `ctx.hierarchie` et sans `ctx.interets`, `rankResults` trie **exactement**
  comme avant. C'est ce qui a permis de câbler écran par écran.

## Un point produit resté ouvert

`maintenant.js` admet quatre natures, dans cet ordre : `event_now`,
`session_soon`, `activity_now`, puis **`open_now`** — « un lieu ouvert où l'on
peut aller tout de suite », restaurants compris. C'était une décision assumée
(`docs/maintenant.md`) : s'en tenir aux événements laissait le bloc vide
l'essentiel du temps.

La règle produit posée depuis — *ne jamais remplir le feed avec des lieux
simplement parce qu'ils sont proches* — la resserre. L'ordre des natures
garantit déjà qu'un lieu ordinaire ne passe jamais devant un événement ; ce qui
reste ouvert est de savoir s'il a le droit de **compléter** un bloc que les
événements n'ont pas rempli. Ce n'est pas une question de classement mais de
composition du feed : elle est traitée au **lot F**, avec les offres et l'aide.
