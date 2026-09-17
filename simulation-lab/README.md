# Simulation Lab

Le banc d'essai d'une simulation sociale et générationnelle. **Sans écran :
on prouve les systèmes avant de dessiner le premier pixel.**

C'est un projet entièrement autonome — ses propres dépendances, sa propre
configuration, ses propres commandes. Il ne partage aucune ligne de code avec
les autres projets du dépôt (`autour/`, `src/`) et n'en importe aucun.

> Le joueur ne joue pas à contrôler un monde.
> Il joue à vivre une vie dans un monde qui continue sans lui.

---

## Pourquoi un labo plutôt qu'un jeu

Une simulation sociale se juge sur des questions auxquelles aucune capture
d'écran ne répond : les journées ont-elles une forme, les habitants
diffèrent-ils vraiment, les routines se brisent-elles parfois ? Ces questions
demandent de simuler trente jours, de lire trois chiffres, de changer une
courbe et de recommencer — trente fois par jour, pas trois.

D'où la contrainte fondatrice : **trente jours de vie de soixante habitants
doivent se calculer en moins d'une seconde et demie.** Tout le reste en
découle, y compris le fait qu'il n'y ait pas de rendu.

---

## Démarrer

```bash
npm install
npm run labo            # une expérience de 30 jours, 60 habitants
npm test                # 84 tests
npm run verifier        # types + tests
```

```bash
npm run labo -- --jours 30 --population 60     # régler la taille
npm run labo -- --graines 1,2,3                # comparer trois sociétés
npm run labo -- --habitant 3                   # la journée type d'un habitant
npm run labo -- --echelle meso                 # mesurer le coût d'une échelle
npm run labo -- --rejeu                        # vérifier le déterminisme
npm run labo -- --verifier                     # invariants à chaque heure
npm run labo -- --aide
```

---

## Ce qui tourne aujourd'hui

Soixante habitants — enfants, actifs, retraités — vivent dans un quartier de
vingt-cinq lieux. Ils dorment, mangent, travaillent, étudient, se lavent, font
du sport, se parlent, sortent, font leurs courses. Personne ne leur dit quoi
faire : chaque activité est choisie par une IA d'utilité à partir de leurs
besoins, de leurs traits, de l'heure et de ce qui les entoure.

Résultat d'une exécution de référence (graine 1, 60 habitants, 30 jours) :

```
  dormir              8.03 h      stabilité de routine  0.718
  travailler          3.81 h      écart sociable/solitaire  ×2.14
  etudier             3.03 h      décisions sur la meilleure option  76.3 %
  discuter            1.68 h      violations d'invariant  0
  se_deplacer         1.59 h      calculé en  1 300 ms
```

**Aucun besoin n'est stocké en dur, aucune routine n'est écrite.** Les
horaires de bureau émergent du fait que travailler compte davantage entre
9 h et 18 h ; les nuits émergent d'une fenêtre horaire et d'une pression de
sommeil ; et ces routines se brisent — c'est ce que mesure la stabilité, qui
doit rester entre 0,55 et 0,85.

| Module | Rôle |
|---|---|
| `noyau/` | temps, aléa déterministe, bus d'événements, échelles, empreinte |
| `etat/` | données du monde, transactions, vérificateur d'invariants |
| `moteurs/personnage/` | courbes de réponse, besoins, catalogue d'actions, IA d'utilité |
| `monde/` | génération d'un quartier et de ses habitants |
| `boucle/` | orchestration du tick, repli du temps, rattrapage paresseux |
| `labo/` | mesures, expériences, rapports, ligne de commande |

---

## Ce que le banc d'essai a déjà trouvé

Ce sont de vrais défauts, trouvés en mesurant, pas en relisant. Ils sont la
justification du projet.

**L'arrondi cassait les échelles de simulation.** Les besoins étaient stockés
en entiers. Or `round(288 × 2,875)` vaut 828, alors qu'arrondir 288 fois de
suite donne 864 : un habitant simulé tick par tick vieillissait 4 % plus vite
que le même habitant simulé par journées repliées. Sa vie aurait dépendu de la
distance à laquelle se trouvait le joueur. Les besoins sont désormais des
flottants ; l'arrondi n'a plus lieu qu'à l'affichage.

**Une lycéenne passait un cinquième de ses journées au bureau.** La
considération « être à son poste » ne regardait que les horaires, pas le type
d'occupation. Aucune moyenne ne l'aurait montré — les heures travaillées
restaient parfaitement plausibles. C'est l'inspecteur, heure par heure, qui
l'a fait voir.

**Ce n'est presque jamais le poids d'une action qui est mal réglé, c'est la
forme de sa courbe aux valeurs basses.** Avec une racine, un besoin de
confort satisfait à 90 % valait encore 0,32 d'utilité, et « se détendre chez
soi » battait « manger » chez un habitant affamé, qui vivait 37 % du temps
au-dessus du seuil critique de faim.

**Une cloche horaire ne sait pas dire « à 22 h oui, à 19 h non ».** Elle est
symétrique : toute largeur rendant 1 h du matin plausible rend 19 h plausible
aussi. Les habitants se couchaient à 20 h, se réveillaient à 4 h, s'épuisaient
dès 17 h et compensaient par deux heures de sieste. Il a fallu une fenêtre
asymétrique.

**Un enfant sans salaire ne pouvait pas manger.** Tant que le repas coûtait
quatre euros et que « puis-je me le permettre » regardait le seul porte-monnaie
personnel, les vingt-trois lycéens du monde restaient saturés en provisions
cent pour cent du temps — alors que leur foyer avait de quoi. Un modèle où la
pauvreté empêche de se nourrir chez soi n'est pas plus dur, il est faux.

**On n'économise pas en décidant moins, on économise en se réveillant moins.**
Passer de l'échelle du tick à l'échelle horaire divise les réveils par douze
mais ne change presque rien au nombre de décisions : une décision n'est prise
qu'à la fin d'une activité.

---

## Ce qui ne marche pas encore

Écrit ici pour que ce soit un fait, pas une surprise.

**Il n'y a aucun moteur économique.** L'argent entre par les salaires et ne
ressort que par trois petits achats : ni loyer, ni charges, ni pension. Sur
trente jours, les salariés accumulent 148 € par jour et la médiane du
patrimoine est de 0 €. C'est le premier chantier de la phase 5 — et le banc
d'essai l'a rendu chiffrable au lieu de le laisser à l'intuition.

**Il n'y a ni relations, ni mémoire, ni rumeurs.** « Discuter » satisfait un
besoin social et ne laisse aucune trace : personne ne connaît personne. C'est
la phase 3, et c'est de loin la plus importante pour le concept.

**Il n'y a ni naissance, ni mort, ni vieillissement effectif.** Les habitants
ont un âge, il ne change rien encore.

**Le monde est un graphe de lieux, pas une carte.** Se déplacer coûte un
forfait de quinze minutes entre deux points quelconques. C'est assumé : la
géométrie ne change aucun des systèmes sociaux, et s'ajoutera par-dessus.

**Le budget annoncé n'est pas encore mesuré en conditions réelles.** 1,3 s
pour trente jours sans rendu ne dit rien du coût avec une carte, des
relations et une mémoire.

---

## Les documents de conception

Ils précèdent le code et l'expliquent. `docs/01-analyse.md` en particulier
relève les **six contradictions** du cahier des charges et l'arbitrage retenu
pour chacune.

1. [`docs/01-analyse.md`](docs/01-analyse.md) — lecture critique, contradictions, pièges du genre
2. [`docs/02-architecture.md`](docs/02-architecture.md) — quatre couches, huit moteurs, cohérence, déterminisme
3. [`docs/03-dependances.md`](docs/03-dependances.md) — graphe de dépendances, ordre de construction
4. [`docs/04-mvp.md`](docs/04-mvp.md) — le MVP et ses cinq critères d'acceptation
5. [`docs/05-phases.md`](docs/05-phases.md) — onze phases, chacune avec son test de fin
6. [`docs/06-agents.md`](docs/06-agents.md) — développement assisté par IA : un orchestrateur, six spécialistes
7. [`docs/07-journal.md`](docs/07-journal.md) — l'avancement réel, y compris les impasses

---

## Les règles non négociables

1. **Le monde n'attend jamais le joueur.** Aucune décision ne consulte sa
   position autrement que comme celle d'un habitant parmi les autres.
2. **Personne ne sait ce qu'il n'a pas appris.** Vérité du monde, croyances de
   chacun, et ce que l'interface a le droit de montrer sont trois choses
   distinctes.
3. **Rien n'est scripté.** Un destin est le produit d'une personnalité, de
   capacités, d'occasions, de contraintes, de décisions et de hasard.
4. **Aucune dépendance au navigateur** dans `noyau/`, `etat/`, `moteurs/` et
   `boucle/`. L'environnement de test est `node`, pour que ça casse
   immédiatement.
5. **Replier le temps ne doit rien changer.** Simuler une journée d'un coup
   doit donner le même état que la simuler tick par tick.
6. **Un système n'est fait que quand son test passe.** Le journal dit l'état
   réel.
