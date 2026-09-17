# 5. Feuille de route par phases

Étapes 6 et 7 du cahier des charges. Chaque phase produit quelque chose de
**réellement testable** — pas une couche de plomberie invisible. Chaque phase
liste ce qui la rend terminée, et ce test est la seule définition de
« terminé » acceptée sur ce projet.

---

## Phase 0 — Le noyau déterministe ✅ *fait*

*Temps, aléa, bus d'événements, échelles, empreinte.*

Aucune règle de jeu. C'est le module qui ne doit plus changer.

**Livré** : `jeu/noyau/` — `alea.ts`, `temps.ts`, `evenements.ts`,
`echelles.ts`, `empreinte.ts`, `ids.ts`, avec leurs tests.

**Testable par** : `npm run jeu:test`. Les tests vérifient que deux
générateurs de même graine produisent la même suite, que les flux nommés sont
indépendants, que le calendrier se reconstitue exactement depuis le tick, que
le bus traite en ordre stable sans récursion, que le budget tournant étale
les mises à jour sans en perdre aucune, et qu'une empreinte détecte un
changement d'un seul champ.

---

## Phase 1 — Le quartier habité

*Monde, personnages, besoins, décisions, routines.*

- Chargement d'une carte de tuiles et de ses intérieurs.
- 60 personnages générés, 12 foyers, relations de départ.
- Besoins qui dérivent, catalogue de ~30 actions, IA d'utilité.
- Les trois échelles branchées (micro / meso / macro) avec rattrapage.
- Rendu minimal : tuiles, sprites, caméra, aucun joueur encore.

**Terminée quand** : 30 jours simulés sans rendu, sans violation
d'invariant, et l'analyse des journées montre des routines stables qui se
brisent parfois. Test automatique + relecture d'une journée à l'inspecteur.

**Risque principal** : l'équilibrage des besoins. Si les courbes sont mal
réglées, tout le monde dort ou tout le monde mange. Prévoir du temps de
réglage, pas seulement du temps de code.

---

## Phase 2 — Le joueur dans le monde

*Contrôle, déplacement, portes, objets, temps.*

- Déplacement au clic, A*, ouverture de portes, changement de carte.
- Objets ramassables et utilisables.
- Contrôles du temps ×1 → ×100, bascule incarné / intention.
- Première interface : barre de temps, fiche minimale du joueur.

**Terminée quand** : on peut jouer 30 minutes, sortir de chez soi, aller au
café, revenir, accélérer une semaine et revenir en mode incarné sans que la
simulation ne se désynchronise.

---

## Phase 3 — Les relations

*Axes dirigés, épisodes, conversations, qualification.*

- Rencontres, conversations, disputes, affinités.
- Sociogramme visible dans l'inspecteur.
- Le joueur peut parler aux habitants.

**Terminée quand** : le critère A1 du MVP passe (30 jours produisent des
amitiés, des ruptures et des tensions mesurables) et que le sociogramme
montre des groupes, pas une bouillie uniforme.

---

## Phase 4 — Connaissance, mémoire, lentille

*La phase la plus structurante. À ne pas repousser.*

- Faits, croyances, sources, précision, dégradation.
- Propagation en conversation, déformation, rumeurs.
- Mémoire courte / longue / émotionnelle / sociale.
- **La lentille** : l'interface est rebranchée pour ne lire que le savoir du
  joueur. Verrou de lint posé à ce moment-là.
- Fiche de personnage riche, mais limitée à ce qui est su.

**Terminée quand** : le critère A3 passe (une rumeur traverse et se déforme)
et qu'aucun fichier de `jeu/interface` n'importe `jeu/moteurs`.

---

## Phase 5 — Économie, travail, école

- Postes finis, candidatures, embauches, licenciements.
- Salaires, loyers, courses, épargne, dettes.
- École, résultats, orientation, abandon.
- Classes sociales calculées.

**Terminée quand** : le critère A5 passe (une trajectoire volontairement
mauvaise produit vraiment un échec récupérable) et qu'après 90 jours la
distribution des patrimoines s'est étalée sans que personne ne soit à zéro
ni à l'infini.

---

## Phase 6 — La vie : couples, naissances, vieillissement, mort

- Attirance, rendez-vous, mise en couple, rupture, engagement.
- Grossesse, naissance, hérédité des traits.
- Vieillissement du corps, santé, maladie, mort.
- Régulateur démographique et registre des défunts.

**Terminée quand** : 10 années simulées gardent la population dans la bande
45–110, les pyramides des âges restent plausibles, et la mort d'un habitant
produit un effet mesurable chez ses proches.

À ce stade, **le jeu est jouable de bout en bout** : c'est la première
version qu'on peut faire essayer à quelqu'un d'autre.

---

## Phase 7 — Événements émergents et chronique

- Règles conditionnelles : accident, opportunité, conflit, fermeture ou
  ouverture d'entreprise, déménagement, événement de quartier.
- Chronique causale exposée au joueur.
- Couche d'attention : ce qui remonte, ce qui suspend l'accélération.

**Terminée quand** : le critère A2 passe (deux habitants au hasard ont une
histoire racontable) et qu'aucun événement injustifié par le contexte
n'apparaît sur 90 jours d'observation.

---

## Phase 8 — Voyages

- Choix de destination et de durée, coût, préparation.
- Simulation par segments, résultats bons et mauvais.
- Contacts distants, rattrapage de la ville au retour.
- Écran de résumé composé depuis les épisodes réels.

**Terminée quand** : trois voyages identiques avec des graines différentes
produisent trois expériences nettement différentes, dont au moins une
mauvaise, et que le monde principal a visiblement évolué pendant l'absence.

---

## Phase 9 — Générations et héritage social

- Continuité par un descendant à la mort du personnage joueur.
- Lignées : patrimoine, réputation, réseau, histoires familiales.
- Transmission des habitudes et des prédispositions, jamais à l'identique.

**Terminée quand** : une partie de 80 ans montre des lignées qui divergent —
une famille qui monte, une qui descend — et qu'on peut remonter la cause d'une
situation de petit-enfant jusqu'à une décision du grand-parent.

---

## Phase 10 — Aboutissement visuel et confort

- Direction artistique, tuiles définitives, animations, éclairage
  jour/nuit, météo.
- Fenêtres déplaçables, chronique illustrée, sociogramme jouable.
- Réglages, accessibilité, ergonomie.

---

## Ce qui n'est pas dans la feuille de route

À garder hors périmètre tant que les phases 0 à 9 ne sont pas finies : les
capacités rares du §23 (à traiter en phase 11, et à garder faibles), la
politique locale, le multijoueur, l'éditeur de cartes pour le joueur, le
modding.

---

## Ordre de grandeur d'effort

Pour un développeur seul, avec assistance IA, à temps partiel. Ce sont des
proportions, pas des promesses de calendrier.

| Phase | Poids relatif | Risque |
|---|---|---|
| 0 Noyau | 1 | faible |
| 1 Quartier habité | 5 | **élevé** (équilibrage) |
| 2 Joueur | 3 | moyen |
| 3 Relations | 4 | moyen |
| 4 Connaissance | 5 | **élevé** (conception) |
| 5 Économie | 3 | moyen |
| 6 Vie | 4 | **élevé** (équilibrage démographique) |
| 7 Événements | 3 | moyen |
| 8 Voyages | 3 | faible |
| 9 Générations | 4 | moyen |
| 10 Visuel | 6 | faible techniquement, long |

Les trois phases à risque élevé le sont pour deux raisons différentes :
1 et 6 demandent du **réglage** (impossible à estimer tant qu'on n'a pas
essayé), 4 demande de la **conception** (une erreur de modèle coûte une
réécriture). C'est pour cela que la phase 4 est documentée avant d'être
écrite, et que les phases 1 et 6 prévoient explicitement du temps de réglage.
