# 7. Journal d'avancement

État réel du projet. Ce fichier dit ce qui existe et ce qui n'existe pas.
Aucune ligne de ce journal ne doit être optimiste : un système est « fait »
quand son test de phase passe, et pas avant.

---

## 2026-09-17 — Conception et phase 0

### Fait

**Documents de conception (étapes 1 à 6 du cahier des charges).**
`01-analyse.md` à `06-agents.md`. Six contradictions du cahier des charges
identifiées et arbitrées, architecture en quatre couches arrêtée, graphe de
dépendances établi, MVP défini avec cinq critères d'acceptation vérifiables,
onze phases planifiées avec leur test de fin.

**Phase 0 — noyau déterministe.** `jeu/noyau/` :

| Module | Rôle | Testé |
|---|---|---|
| `ids.ts` | types d'identifiants distincts à la compilation | — (types) |
| `alea.ts` | PCG32 + flux nommés dérivés par hachage | oui |
| `temps.ts` | tick de 5 min, calendrier calculé, vitesses, budget d'image | oui |
| `evenements.ts` | file ordonnée, causalité portée, profondeur bornée | oui |
| `echelles.ts` | cinq échelles, budget tournant, rattrapage paresseux | oui |
| `empreinte.ts` | hachage d'état pour le test de rejeu déterministe | oui |

### Non fait

Tout le reste. En particulier, et pour éviter toute ambiguïté :

- aucun personnage, aucune décision, aucun besoin ;
- aucune carte, aucun rendu, aucune interface ;
- aucune relation, aucune mémoire, aucune croyance ;
- aucune économie, aucune vie, aucun voyage, aucune génération ;
- le noyau n'a encore jamais été mis sous charge réelle : le budget annoncé
  au doc 2 (§2.3) est un calcul, pas une mesure.

### Arbitrages tranchés

Les trois choix qui conditionnaient la suite ont été décidés le jour même.
L'argumentaire complet reste dans `01-analyse.md`.

1. **Vue de dessus 3/4 orthogonale**, pas d'isométrie. Le §41 citait Pocket
   City 2 comme référence de sensation ; la sensation est conservée, la
   technique de rendu non — l'isométrie coûterait, pour un développeur seul,
   le double en décors et en intérieurs sans rien apporter au cœur social du
   jeu.
2. **Sauvegarde unique continue.** Le §36 devient une propriété technique :
   la mort, les ruptures et les licenciements sont écrits avant d'être
   affichés, donc irréversibles pour de bon. Pas de mode « bac à sable » pour
   l'instant.
3. **Mode intention au-delà de ×10.** Le seuil est un paramètre de
   `noyau/temps.ts` et sera réglé à l'essai en phase 2.

### Isolation dans le dépôt

Le jeu vit dans `jeu/` et ne touche **aucun** fichier d'Urosi-t (`src/`,
`tsconfig.json`, `package.json`, `vitest.config.ts`) ni d'Autour (`autour/`).
Il a son propre `jeu/tsconfig.json` et son propre `jeu/vitest.config.ts`,
avec un environnement de test `node` et non `jsdom` — une façon de faire
tomber le test le jour où quelqu'un importerait le DOM dans la simulation.

Les commandes sont donc explicites, sans script ajouté au `package.json`
partagé :

```bash
npx vitest run --config jeu/vitest.config.ts
npx tsc --noEmit -p jeu/tsconfig.json
```

Une conséquence connue et assumée : le `npm test` du dépôt balaie tous les
fichiers `*.test.ts` et ramasse aussi ceux du jeu. Ils passent. L'en exclure
demanderait de modifier `vitest.config.ts`, c'est-à-dire de toucher à
Urosi-t, ce qui n'est pas fait.

### Prochaine étape

Phase 1 — le quartier habité. *(faite le jour même, voir l'entrée suivante.)*

---

## 2026-09-17 (suite) — Simulation Lab et phase 1

Le projet devient autonome : `simulation-lab/`, avec son propre
`package.json`, ses propres dépendances, sa propre configuration de test et
ses propres commandes. Il ne partage plus rien avec les autres projets du
dépôt. Le dossier `jeu/` a été migré ici puis supprimé.

### Fait

**Phase 1 — le quartier habité.** Soixante habitants — enfants, actifs,
retraités — vivent dans un quartier de vingt-cinq lieux. Ils dorment,
mangent, travaillent, étudient, se lavent, font du sport, se parlent, sortent
et font leurs courses, sans qu'aucune routine ne soit écrite.

| Module | Contenu | Testé |
|---|---|---|
| `etat/` | monde, personnage, lieu, transactions, invariants | oui |
| `moteurs/personnage/` | courbes, besoins, 16 actions, IA d'utilité | oui |
| `monde/` | génération d'un quartier et de sa population | oui |
| `boucle/` | tick, repli du temps, rattrapage paresseux | oui |
| `labo/` | mesures, expériences, rapports, CLI | oui |

**84 tests.** Dont le rejeu déterministe sur trente jours, la conservation des
vingt-quatre heures, l'équivalence du repli du temps, et les critères
d'acceptation du doc 4.

Mesures de référence (graine 1, 60 habitants, 30 jours, 1,3 s de calcul) :

| Indicateur | Valeur | Cible |
|---|---|---|
| stabilité de routine | 0,718 | 0,55 – 0,85 |
| écart sociable / solitaire | ×2,14 | > ×1,3 |
| décisions sur la meilleure option | 76,3 % | 50 – 95 % |
| pire besoin au-dessus du seuil critique | 12,5 % | < 20 % |
| violations d'invariant | 0 | 0 |

### Ce que les mesures ont corrigé

Six défauts réels, tous trouvés en mesurant et non en relisant. Ils sont
détaillés dans le README et commentés à l'endroit du code où ils se sont
produits — c'est la seule place où le commentaire sert encore dans six mois.
En résumé :

1. l'arrondi des besoins à chaque tick cassait l'équivalence entre échelles ;
2. une lycéenne travaillait au bureau, faute de vérifier le type d'occupation ;
3. la forme des courbes aux valeurs basses, et non le poids des actions,
   faisait perdre les besoins vitaux contre les besoins de confort ;
4. une cloche horaire symétrique rendait le coucher de 19 h aussi plausible
   que celui d'1 h du matin ;
5. un enfant sans salaire ne pouvait pas manger, parce que la considération
   « puis-je me le permettre » ignorait le foyer ;
6. les échelles de simulation économisent des réveils, pas des décisions.

### Non fait

- **aucun moteur économique** : ni loyer, ni charges, ni pension. Les salariés
  accumulent 148 € par jour et la médiane du patrimoine est à zéro. C'est le
  constat le plus net du banc d'essai et le premier chantier de la phase 5 ;
- **aucune relation, aucune mémoire, aucune croyance** : « discuter » comble
  un besoin et ne laisse aucune trace. Personne ne connaît personne ;
- **ni naissance, ni mort, ni vieillissement effectif** ;
- **pas de carte** : le monde est un graphe de lieux, un déplacement coûte un
  forfait de quinze minutes ;
- **pas de rendu, pas d'interface, pas de joueur** ;
- le budget de calcul annoncé au doc 2 reste **calculé et non mesuré** en
  conditions réelles : 1,3 s pour trente jours sans carte, sans relations et
  sans mémoire ne présage pas du coût final.

---

## 2026-09-17 (suite) — La ville, pour de vrai

La première vue alignait des rectangles étiquetés sur un plan. C'était lisible
et ça ne ressemblait à rien : un diagramme, pas un endroit où l'on habite. Une
simulation de vie a besoin qu'on reconnaisse la ville pour avoir envie d'y
regarder quelqu'un vivre.

### Fait

`vue/ville.ts` bâtit une vraie ville isométrique depuis les lieux du moteur :
trame de rues avec marquage, trottoirs, îlots, immeubles en volume à deux
faces éclairées différemment, fenêtres qui s'allument à la nuit tombée, cours
plantées, arbres, bancs, lampadaires qui éclairent. Les habitants marchent
dans les rues en suivant la voirie, jamais à travers les murs.

Tout est dessiné par le code. Pas un élément graphique emprunté, conformément
au §41.

La géométrie reste de la présentation : le moteur ne connaît toujours qu'un
graphe de lieux, et rien de ce qui est dans `vue/` n'entre dans l'état du
monde.

### Ce que la ville a fait apparaître

Quatre défauts que les chiffres ne montraient pas.

1. **Tous les habitants allaient au même café.** `lieuCible` renvoyait le
   premier lieu trouvé, c'est-à-dire le premier inséré dans la `Map` : le
   second café ne servait jamais, et « faire du sport » envoyait tout le monde
   au gymnase parce qu'il précédait le parc. La moitié des lieux du monde
   étaient décoratifs. Chacun a maintenant ses habitudes, dérivées par
   hachage — donc sans rien stocker et sans casser le rejeu. Le parc est passé
   de zéro à la fréquentation la plus forte du quartier.

2. **La pression de plaisir restait à 129 sur 1000.** Personne ne cherchait
   jamais à se faire plaisir, donc personne ne sortait ni ne se promenait. Une
   société où le divertissement n'a aucune valeur n'est pas plus sobre, elle
   est fausse.

3. **Un trajet de quinze minutes se terminait dans la même image que son
   départ**, donc aucun passant n'était jamais visible : la trace
   n'enregistrait que le lieu, pas la destination ni l'avancement. La rue
   paraissait vide alors que vingt personnes y marchaient.

4. **Un mélange de couleurs qui renvoyait `rgb()` au lieu de `#rrggbb`**
   produisait `rgb(NaN,NaN,NaN)` au mélange suivant. Le canvas ignore une
   couleur invalide sans rien dire : la ville se dessinait entièrement en noir,
   à toute heure.

Les deux premiers sont des défauts de SIMULATION, pas d'affichage. Ils
auraient survécu indéfiniment à des tests agrégés, parce que les moyennes
restaient parfaitement plausibles. C'est l'argument central en faveur d'une
sortie visuelle, même pour un banc d'essai qui n'en a pas besoin pour
fonctionner.

Après correction : jusqu'à 32 personnes dehors à 8 h, 6,7 en moyenne contre
2,6 — pour soixante habitants, une rue n'est pas censée être bondée.

### Non fait

- **Phase 3 amorcée, pas branchée.** `etat/relation.ts` pose le modèle —
  relations dirigées, cinq axes, épisodes, décroissance paresseuse,
  qualification dérivée. Rien ne l'utilise encore : aucun moteur ne le lit,
  aucun test ne le couvre. C'est un plan, pas un système.
- Tout le reste du doc 5 : économie, vie, événements, voyages, générations.

---

## 2026-09-17 (suite) — Les fondations de l'état

Phase bornée à la STRUCTURE de l'état du monde. Ni relations, ni mémoire, ni
bus d'événements, ni échelles, ni caméra, ni joueur : rien de tout cela n'a
été branché, et c'est délibéré.

### Ce que `Monde` porte maintenant

| Collection | Justification |
|---|---|
| `personnages` | déjà là |
| `lieux` | déjà là |
| `foyers` | remplace un parcours de toute la population à chaque dépense partagée |
| `postes` | le travail devient une ressource FINIE, avec au plus un titulaire |
| `relations` | **vide**, et la seule exception assumée : l'ajouter après coup obligerait à recâbler tout ce qui sera écrit d'ici là |

Plus `version`, le numéro de schéma de sauvegarde.

### Ce que `Monde` ne porte toujours pas, et pourquoi

- `defunts` — personne ne meurt, la filiation n'existe pas : une collection
  vide sans producteur ni consommateur ;
- `organisations` — un poste se rattache à son lieu, ce qui suffit ; ajouter
  l'employeur plus tard est additif ;
- `faits`, `chronique` — le bus d'événements n'est branché à rien, la
  chronique n'aurait rien à enregistrer ;
- `logements` — un logement est un lieu, le foyer porte son adresse ;
- `economie` — ni loyer ni charges n'existent.

### Trois champs nouveaux sur le personnage

- **`position: { lieu, piece, x, y }`** — `piece` vaut toujours `null` (les
  intérieurs ne sont pas construits), `x` et `y` sont en millièmes de
  l'emprise du lieu : entiers, donc sans arrondi au rejeu, et indépendants de
  l'échelle du rendu. L'emplacement est dérivé par hachage de (personne, lieu),
  donc stable sans rien stocker.
- **`apparence: { genes, garderobe, accessoires }`** — la coupure entre ce qui
  se transmet et ce qui s'acquiert est dans la FORME, pas dans un commentaire :
  le jour de l'hérédité, on passera `genes` d'un parent à l'enfant sans trier.
  Tout est entier et borné, pour que le rendu puisse un jour pré-calculer un
  atlas de silhouettes.
- **`poste: PosteId | null`** — remplace l'ancien `occupation`, qui était un
  enregistrement inventé pour chaque habitant. Les horaires et le salaire
  appartiennent désormais au poste.

`lieu`, `domicile` et `occupation` ont disparu du personnage : chacun avait une
source de vérité en double.

### Ce que les tests ont attrapé

1. **Le générateur dépassait la capacité des logements** — sept habitants pour
   six places. L'ancien code avait la même faille ; il passait par chance,
   parce que l'ordre de tirage était différent. Le logement se choisit
   maintenant parmi ceux qui ont de la place.
2. **La mesure de l'effet de la sociabilité ne tenait pas debout.** Elle
   comparait les moyennes de deux quintiles de douze personnes : un seul
   solitaire vivant dans un foyer de cinq la faisait passer de ×2,6 à ×1,0
   d'une graine à l'autre. Remplacée par une corrélation sur toute la
   population, vérifiée sur quatre graines. **L'effet est réel mais faible**
   (ρ entre 0,14 et 0,35) : à traiter à la phase des relations, où un sociable
   devrait choisir d'aller là où sont les gens qu'il connaît — aujourd'hui
   personne ne connaît personne.

### Ce que les postes finis rendent visible

| Population | Salariés | Élèves | Sans occupation |
|---:|---:|---:|---:|
| 60 | 31 | 14 | 15 |
| 480 | 60 | 60 | **360** |

Cent vingt postes quelle que soit la taille de la ville. La pénurie n'est plus
masquée : elle se lit. Faire croître le monde avec la population reste un
chantier à part entière, et il n'appartient pas à cette phase.

### Performance

L'index des foyers supprime un parcours en `O(N)` par décision. Le gain
mesuré est sous le bruit (2 550 ms → 2 477 ms pour dix jours à 480 habitants),
et la comparaison est de toute façon faussée : à 480 habitants, la population
n'a plus la même structure d'occupation qu'avant. L'index se justifie par la
complexité, pas par un gain constaté aujourd'hui.

### Volontairement non branché

Relations · mémoire · bus d'événements · vitesses temporelles · budget de
calcul · niveaux d'échelle · caméra · joueur. Dans des phases séparées.
