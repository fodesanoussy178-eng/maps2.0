# Le lot B — le cycle d'un événement et l'espace « À venir »

> État : **livré**. Lot précédent : [A — la pertinence personnelle](./pertinence-personnelle.md).
> Suite prévue : E (performance), C (portée dynamique), D (Paris hiérarchique),
> F (offres, aide, et la question `open_now`).

## Deux horloges, et il fallait les séparer

Un événement n'a pas une date, il en a deux sortes.

| horloge | champs | ce qu'elle décide |
|---|---|---|
| **l'événement** | `start_at`, `end_at` | quand ça se passe → **Maintenant** |
| **son information** | `announced_at`, `presale_at`, `tickets_open_at`, et les échéances déduites (J-3, jour J) | quand il y a quelque chose à **savoir** → **Pour toi**, **À venir** |

Les confondre produit exactement deux fautes, et les deux étaient possibles
avant ce lot :

- une billetterie qui ouvre ce matin faisait passer un concert de juin pour
  quelque chose qui se passe maintenant — **des billets disponibles ne sont pas
  un concert en cours** ;
- un concert de ce soir restait rangé « à venir » avec la même phrase tiède
  qu'il avait trois mois plus tôt, alors que c'est le seul moment où il fallait
  vraiment le dire. Le mot écrit était « Éphémère ».

**Quand les deux horloges parlent, celle de l'événement l'emporte.** Un concert
dans trois jours n'est plus une nouvelle de billetterie : c'est un concert dans
trois jours. L'ordre de détermination dans `cycle-evenement.js` n'est donc pas
un détail d'implémentation, c'est la règle.

## Le cycle

```
annonce → prévente → billetterie bientôt → billetterie ouverte
        → à venir → approche (J-3) → jour J → en cours → terminé
```

| phase | horloge | urgence | ce qui s'écrit |
|---|---|---|---|
| `annonce` | information | 40 | 🆕 Nouvelle annonce |
| `prevente` | information | 50 · 58 | 🎟️ Prévente demain · ouverte |
| `billetterie_bientot` | information | 55 · 65 | 🎟️ Billetterie dans 30 h · demain |
| `billetterie_ouverte` | information | 72 | 🎟️ Billetterie ouverte |
| `a_venir` | événement | 8 → 25 | *rien* |
| `approche` | événement | 74 · 80 · 86 | 🔥 Dans 3 jours · 2 jours · Demain |
| `jour_j` | événement | 90 | 🎤 Aujourd'hui · Cet après-midi · Ce soir |
| `en_cours` | événement | 100 | ⚡ En cours |
| `termine` | événement | 0 | Terminé · Annulé |

**L'approche presse plus qu'une billetterie qui ouvre**, et l'échelle devait le
dire. Une billetterie reste ouverte des semaines ; trois jours avant un
concert, c'est le dernier moment où l'on peut encore s'organiser. Une première
échelle mettait J-3 à 60 contre 72 pour la billetterie — à trois jours du
concert, l'écran aurait continué de parler de billets.

**`a_venir` n'écrit rien**, et c'est voulu. Quand le cycle n'a rien de
particulier à dire, il se tait, et l'interface retombe sur la date. « Éphémère »
sur un concert dans trois mois ne disait rien à personne.

## Ce que la machine refuse de faire

- **Aucune phase n'ouvre la porte de « Maintenant ».** Elle reste
  `event_temporal_status = now`, tranchée en base et traduite par `temporel.js`.
  Le cycle dit comment **présenter et classer**, jamais si un objet a le droit
  d'exister quelque part. Une billetterie à 72 d'urgence ne fait entrer
  personne — l'objet n'arrive même pas jusqu'au score en mode `nowOnly`.
- **Une phase absente ne s'invente jamais.** Pas de `tickets_open_at` publié,
  pas de phase billetterie. Même règle que « aucune heure de fin n'est inventée
  pour faire entrer un événement dans `now` », et même raison : une promesse
  fausse coûte une attente devant une billetterie qui n'ouvre pas.
- **Une date incertaine ne produit pas de compte à rebours.** « Du 10 au 15
  août » sans heure ne devient pas « dans 3 jours » : ce serait une précision
  qu'on n'a pas.
- **Commencé sans fin connue** : ni « en cours » affirmé à pleine urgence, ni
  « terminé ». La couche canonique refuse de conclure ; ce module ne la
  contredit pas.
- **Un seul exemplaire.** Une phase n'est pas une copie : c'est une lecture de
  la même ligne à un instant donné. Rien n'est dupliqué à aucune transition, et
  un test le vérifie aux six étapes du scénario.

## La distance change ce qu'une phase veut dire

C'est la partie la moins évidente, et elle répond à « tenir compte de la
distance et de la faisabilité du déplacement ».

| phase | à 1 km | à 220 km | pourquoi |
|---|---|---|---|
| `jour_j` | 90 | **72** | on ne part pas à Paris sur un coup de tête entre deux tâches |
| `approche` (J-3) | 74 | **82** | c'est justement à trois jours qu'il faut s'organiser |

Les deux règles ne se contredisent pas : elles disent la même chose, qu'un
déplacement lointain **se prépare et ne s'improvise pas**. Au jour J,
l'information reste, l'injonction disparaît.

## La bascule vers « Maintenant », et le trou qu'elle bouche

Un événement qui commence dans vingt minutes à trois rues d'ici n'est plus une
recommandation : sa place est dans « Maintenant », et « Pour toi » doit le
lâcher — sinon il est annoncé deux fois avec deux niveaux d'urgence différents.

**Mais seulement s'il est à portée**, et cette condition manquait. Sans elle, le
concert parisien imminent quittait « Pour toi » pour un « Maintenant » qui le
rejetait aussitôt : à 220 km, il ne passe aucun filtre de proximité.
**L'événement s'évaporait entre deux espaces exactement à l'heure où il
comptait le plus.** Hors de portée, il reste donc où il était, avec le mot juste
— « ce soir ». On ne peut pas y aller ; on peut vouloir le savoir.

```
basculeVersMaintenant(statut, distance) =
    (statut === "now" ou "soon")  ET  distance <= 30 km
```

## « À venir » est une couche, pas un « Maintenant avec une date plus loin »

Le créneau existait déjà et triait **par date**. Sur trois mois, l'ordre des
dates répond toujours la même chose : le plus proche d'abord, quoi qu'il soit.
Trois semaines d'ateliers de quartier passaient ainsi devant le festival du mois
prochain et devant la billetterie qui ouvre demain — et l'espace cessait
d'aider à **anticiper**, ce qui est son seul métier.

Sa hiérarchie :

```
faisabilité → personnel → importance → ÉCHÉANCE → temporalité
            → proximité → accessibilité → fraîcheur → diversité
```

L'**échéance** est le nouveau critère, et il est distinct de la temporalité :
« la billetterie ouvre aujourd'hui » et « le concert est en juin » sont deux
faits vrais en même temps sur la même ligne. Le premier est une échéance — il y
a quelque chose à faire, et une fenêtre pour le faire. Le second est une
distance. Les additionner revenait à choisir lequel des deux on allait perdre.

La distance temporelle reste un facteur ; elle n'est plus le seul. Un événement
exceptionnel dans trois mois peut donc être pertinent dès maintenant, et un
petit événement sans particularité dans trois mois ne monopolise rien.

**« Ce week-end » garde son ordre chronologique.** La fenêtre est courte et
fermée : on y cherche un programme, et un programme se lit du samedi matin au
dimanche soir.

## Une seule source, un seul calcul

La phase est demandée par le classement, par la carte de recommandation, par
« Pour toi » et par « À venir ». La recalculer partout, c'est payer quatre fois
le même travail sur cent cinquante objets — et risquer **quatre réponses
différentes** si deux appelants ne passent pas exactement le même instant.

`phaseDe()` mémorise sa réponse **sur l'objet lui-même**, dans une propriété non
énumérable (elle n'apparaît ni dans un JSON, ni dans une copie), et la jette dès
que la phase a expiré. C'est `expireLe` qui le dit, pas une durée arbitraire :
une phase d'approche expire au prochain minuit local — « dans 3 jours » devient
« dans 2 jours » sans que personne ait à y penser — et une billetterie ouverte
expire au bout de deux jours, parce qu'« en vente depuis trois semaines » est un
état, pas une information.

`rankResults` pose ensuite `rankPhase`, `rankPhaseLibelle`, `rankPhaseHorloge`
et `rankJoursRestants` sur le résultat. L'interface **lit** ; elle ne recalcule
pas. Même règle que `rankTemporal`, même raison.

## Un défaut de modélisation trouvé par le scénario

À l'ouverture de la billetterie, l'événement marquait **moins** qu'au jour de
son annonce : 99 contre 100.

`noveltyPoints` (la fraîcheur de l'annonce) et la phase `annonce` disent **le
même fait**. Les additionner le comptait deux fois, si bien que les douze points
de fraîcheur perdus en trois mois dépassaient les onze points d'échéance gagnés
à l'ouverture. Le fait n'est plus compté qu'une fois, du côté du cycle, qui en
est désormais la source.

C'est exactement le genre de défaut qu'un test unitaire de phase n'aurait jamais
montré : il fallait suivre le même événement d'un bout à l'autre de sa vie.

## Vérification

```sh
node --test tests/cycle-evenement.test.mjs      # 22 · la machine à phases
node --test tests/moteur-contexte.test.mjs      # 36 · dont le scénario complet
node --test tests/*.test.mjs                    # la suite entière
node outils/pertinence.mjs                      # le coût, mesuré
```

**Suite complète : 1807 succès, 14 échecs** — les 14 préexistants relevés sur
`main` avant le lot A, aucun nouveau.

**Coût : nul à la mesure** (−0,4 % sur 150 objets, dans le bruit). Le banc
exerce vraiment le cycle : la moitié des événements du jeu portent une date
d'annonce, deux tiers une date de billetterie. C'est le cache par objet qui
paie, et le fait qu'un rendu classe plusieurs fois les mêmes objets.

## Le scénario de référence, d'un bout à l'autre

`tests/moteur-contexte.test.mjs` suit **un seul objet** — Artiste X à Paris La
Défense Arena, une personne à Lille qui suit l'artiste, 220 km — à six
instants :

| instant | phase | Maintenant | Pour toi | À venir |
|---|---|---|---|---|
| annonce (J-97) | `annonce` | non | **oui**, pool majeur hors zone | oui |
| billetterie (J-90) | `billetterie_ouverte` | **non** | oui, score en hausse | **1er**, devant le local |
| J-3 | `approche` | non | oui, échéance > billetterie | **1er** |
| jour J, 9 h | `jour_j` | non | oui, « Ce soir » | — |
| en cours, à Lille | `en_cours` | **oui** | **non** — un seul espace en parle | — |
| terminé | `termine` | non | non | non |

Et à chaque étape : aucun doublon dans aucun espace, et jamais le même objet
annoncé simultanément par « Maintenant » et « Pour toi ».

**Non-régression locale** : quatre concerts de quartier restent tous présents
dans « À venir » à côté du géant parisien ; sans envie cochée ni comportement,
l'ordre reste défendable ; et un petit vide-grenier à trois jours dit « dans 3
jours » comme les grands — le cycle n'est pas réservé aux événements majeurs.

## Ce qui reste ouvert

- **La portée de « À venir » est encore celle de la zone active.** Un événement
  majeur hors zone n'y entre pas — il passe par le pool cross-zone de « Pour
  toi ». C'est le **lot C** (portée dynamique) qui l'ouvrira.
- **`open_now` dans « Maintenant »** reste la question posée au lot A, non
  traitée ici comme convenu : elle est de la composition du feed, et elle est
  traitée au **lot F**.
