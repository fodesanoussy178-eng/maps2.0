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

### Arbitrages en attente d'une décision humaine

Trois choix bloquent le début de la phase 1 ou la remettraient en cause. Ils
sont documentés en détail dans `01-analyse.md`.

1. **Direction artistique** — vue de dessus 3/4 orthogonale (recommandée) ou
   isométrie à la Pocket City 2 (plus proche de la référence citée au §41,
   nettement plus coûteuse en décors, intérieurs et interactions).
2. **Politique de sauvegarde** — sauvegarde unique continue, qui rend la mort
   réellement irréversible comme le veut le §36, ou sauvegardes libres, qui
   contredisent le §36 en pratique.
3. **Mode intention à haute vitesse** — confirmer que perdre le contrôle
   direct au-delà de ×10 est acceptable. C'est le pari le plus risqué du
   projet ; il n'existe aucune autre façon de concilier §3 et §14.
