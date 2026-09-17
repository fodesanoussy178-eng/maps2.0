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
