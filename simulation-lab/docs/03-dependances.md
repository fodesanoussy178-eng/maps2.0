# 3. Dépendances entre systèmes

Ce document répond à l'étape 4 du cahier des charges. Il sert à deux choses :
décider dans quel ordre construire, et savoir ce qui casse quand on touche à
un module.

---

## 3.1 Graphe de dépendances

```
                              NOYAU
                 (temps · aléa · bus · échelles)
                                │
                                ▼
                          ÉTAT DU MONDE
                       (données · transactions)
                                │
        ┌───────────┬───────────┼───────────┬────────────┐
        ▼           ▼           ▼           ▼            ▼
     MONDE      PERSONNAGE  CONNAISSANCE  ÉCONOMIE      VIE
   (cartes,     (besoins,   (faits,      (postes,    (âge, santé,
    lieux)      décisions)   croyances)   logements)   naissance)
        │           │           │           │            │
        └─────┬─────┴─────┬─────┘           │            │
              ▼           ▼                 │            │
          RELATIONS ◄─────┘                 │            │
         (axes, épisodes)                   │            │
              │                             │            │
              └──────────┬──────────────────┴────────────┘
                         ▼
                    ÉVÉNEMENTS
              (règles émergentes, chronique)
                         │
                 ┌───────┴───────┐
                 ▼               ▼
              VOYAGE         LENTILLE
                                 │
                         ┌───────┴───────┐
                         ▼               ▼
                       RENDU         INTERFACE
```

---

## 3.2 Qui dépend de quoi, et pourquoi

| Module | Dépend de | Raison |
|---|---|---|
| Noyau | rien | c'est le socle : temps, aléa, file d'événements |
| État | Noyau | les données portent un tick et une graine |
| Monde | État | les lieux sont des données du monde |
| Personnage | État, Monde | décider suppose de savoir où l'on est et ce qui s'y trouve |
| Connaissance | État, Personnage | une croyance appartient à quelqu'un et dépend de sa mémoire |
| Relations | État, Personnage, Connaissance | une relation évolue selon ce qu'on croit de l'autre |
| Économie | État, Monde | un poste est attaché à une organisation, donc à un lieu |
| Vie | État, Relations, Économie | naître suppose un couple ; mourir déclenche un héritage |
| Événements | tous les précédents | une règle émergente lit et écrit partout |
| Voyage | Personnage, Connaissance, Économie, Événements | produit des deltas dans tous ces domaines |
| Lentille | Connaissance, État (lecture seule) | traduit la vérité en savoir du joueur |
| Rendu | Lentille, Monde (lecture seule) | dessine ce qui est visible |
| Interface | Lentille uniquement | ne doit jamais voir la vérité |

---

## 3.3 Les trois dépendances qui posent problème

### D1 — Relations ↔ Connaissance (cycle apparent)

Une relation change parce qu'on apprend quelque chose ; une croyance se
propage selon la relation qu'on a avec l'interlocuteur. Chacun a besoin de
l'autre.

**Résolution.** Le cycle est brisé par le temps, pas par l'architecture. Dans
un tick : Connaissance calcule d'abord ce qui est transmis (en lisant l'état
des relations au début du tick), puis Relations applique les révisions
d'axes causées par ces transmissions. Le sens de lecture est fixe, donc il n'y
a pas de récursion — et le résultat ne dépend pas de l'ordre d'appel.

### D2 — Vie ↔ Économie (héritage)

Un décès déclenche un transfert de patrimoine ; la richesse influence la
santé donc la mortalité.

**Résolution.** Vie ne modifie jamais l'argent directement : elle publie
`PersonnageDecede`, et Économie y réagit en exécutant la succession via les
transactions. Vie lit l'économie (revenus, qualité du logement) mais ne
l'écrit pas.

### D3 — Événements dépend de tout

C'est assumé : Événements est le module de plus haut niveau côté simulation,
celui qui recombine. Le risque est qu'il devienne un fourre-tout où atterrit
toute la logique.

**Garde-fou.** Une règle d'événement n'a le droit que de : lire l'état, tester
des prérequis, et appeler des transactions ou publier des événements. Elle ne
contient jamais de logique métier propre. Si une règle a besoin d'un calcul,
ce calcul appartient au moteur concerné.

---

## 3.4 Ce qu'on peut changer sans rien casser

Conséquence pratique de ce graphe — c'est la demande explicite du §38.

| On remplace… | Impact |
|---|---|
| le rendu (canvas → WebGL → isométrique) | Rendu seul |
| l'interface (React → autre chose) | Interface seule |
| le catalogue d'actions, les métiers, les cartes | `contenu/`, aucun code |
| l'algorithme de décision (utilité → autre) | Personnage seul, si le contrat `decider()` tient |
| le modèle économique | Économie, plus les règles d'événements économiques |
| le générateur d'aléa | Noyau seul, mais **toutes les parties en cours changent de futur** |

Le dernier cas est le seul vraiment coûteux, et c'est pour cela que le noyau
doit être figé tôt : c'est le module le plus petit et celui qu'on doit le
moins toucher.

---

## 3.5 Ordre de construction imposé par le graphe

On ne peut pas construire les relations avant les personnages, ni les
générations avant la mort. L'ordre ci-dessous est le seul qui ne demande
jamais de simuler un module absent :

```
Noyau → État+Transactions → Monde → Personnage → Relations
      → Connaissance → Lentille+Interface → Économie → Vie
      → Événements → Voyage → Générations → Rendu abouti
```

La seule entorse volontaire : **la Lentille arrive tôt**, avant l'Économie.
Elle est peu coûteuse à ce moment-là et devient très coûteuse plus tard, car
il faudrait reprendre chaque écran déjà écrit. C'est la dette la plus chère
qu'on puisse contracter sur ce projet.
