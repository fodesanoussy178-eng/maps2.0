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

Phase 1 — le quartier habité : carte de tuiles et intérieurs, soixante
personnages générés, besoins, catalogue d'actions, IA d'utilité, les trois
échelles branchées. Terminée quand trente jours simulés tournent sans
violation d'invariant et que les journées montrent des routines stables qui
se brisent parfois.
