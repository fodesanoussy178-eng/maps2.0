# Simulation sociale et générationnelle

Un jeu où le joueur ne dirige qu'**un seul personnage**, dans un petit monde
d'une soixantaine d'habitants qui vivent leur propre vie — se rencontrent, se
trompent, réussissent, échouent, vieillissent, meurent et laissent des
descendants — que le joueur soit là ou non.

> Le joueur ne joue pas à contrôler un monde.
> Il joue à vivre une vie dans un monde qui continue sans lui.

---

## État réel du projet

**Conception terminée. Phase 0 (noyau déterministe) terminée et testée. Aucun
personnage n'existe encore.**

Le détail — y compris ce qui n'est pas fait — est dans
[`docs/07-journal.md`](docs/07-journal.md). Ce journal est la seule source de
vérité sur l'avancement : un système n'y est déclaré fait que lorsque le test
de sa phase passe.

| Phase | État |
|---|---|
| 0 · Noyau déterministe | **fait** — 49 tests |
| 1 · Le quartier habité | à faire |
| 2 · Le joueur dans le monde | à faire |
| 3 · Relations | à faire |
| 4 · Connaissance, mémoire, lentille | à faire |
| 5 · Économie, travail, école | à faire |
| 6 · Vie : couples, naissances, mort | à faire |
| 7 · Événements émergents | à faire |
| 8 · Voyages | à faire |
| 9 · Générations et héritage | à faire |
| 10 · Aboutissement visuel | à faire |

---

## Les documents, dans l'ordre de lecture

1. [`docs/01-analyse.md`](docs/01-analyse.md) — lecture critique du cahier des
   charges : les sept exigences structurantes, les **six contradictions** et
   l'arbitrage retenu pour chacune, les pièges classiques du genre.
2. [`docs/02-architecture.md`](docs/02-architecture.md) — les quatre couches,
   l'état du monde, le noyau, les huit moteurs, la cohérence, le déterminisme.
3. [`docs/03-dependances.md`](docs/03-dependances.md) — qui dépend de qui, les
   trois dépendances problématiques, ce qu'on peut remplacer sans rien casser.
4. [`docs/04-mvp.md`](docs/04-mvp.md) — le MVP et ses **cinq critères
   d'acceptation vérifiables**.
5. [`docs/05-phases.md`](docs/05-phases.md) — onze phases, chacune avec son
   test de fin.
6. [`docs/06-agents.md`](docs/06-agents.md) — organisation du développement
   assisté par IA : un orchestrateur, six spécialistes, pas vingt.
7. [`docs/07-journal.md`](docs/07-journal.md) — l'avancement réel.

---

## Ce qui existe aujourd'hui

`noyau/` — le socle, sans aucune règle de jeu. C'est le module qui ne doit
presque plus changer, car en modifier une ligne change l'avenir de toutes les
parties déjà commencées.

| Fichier | Rôle |
|---|---|
| `ids.ts` | identifiants typés : un `PersoId` n'est pas un `LieuId` |
| `alea.ts` | aléa déterministe (sfc32) et **flux nommés** par (usage, entité, tick) |
| `temps.ts` | tick de 5 min, calendrier recalculé, vitesses ×1 → ×500, budget d'image |
| `evenements.ts` | file ordonnée, causalité portée, cascades bornées |
| `echelles.ts` | cinq échelles de simulation, budget tournant, rattrapage paresseux |
| `empreinte.ts` | hachage d'état : le filet qui fait tomber le déterminisme le jour où il casse |

```bash
npx vitest run   --config jeu/vitest.config.ts   # 49 tests
npx vitest watch --config jeu/vitest.config.ts
npx tsc --noEmit -p jeu/tsconfig.json
```

Le jeu est **entièrement isolé** du reste du dépôt : il a son propre
`tsconfig.json` et sa propre configuration de test, et ne modifie aucun
fichier d'Urosi-t (`src/`) ni d'Autour (`autour/`). Aucun code des deux
projets ne se croise. Seule conséquence connue : le `npm test` du dépôt, qui
balaie tous les fichiers `*.test.ts`, ramasse aussi ceux du jeu — ils
passent, et corriger ce balayage demanderait de toucher la configuration
d'Urosi-t, ce qui n'est pas fait ici.

---

## Les trois arbitrages, tranchés

Argumentés dans [`docs/01-analyse.md`](docs/01-analyse.md), décidés le
17/09/2026.

1. **Vue de dessus 3/4 orthogonale.** Pas d'isométrie : pour un développeur
   seul, elle doublerait le coût des décors, des intérieurs et du ciblage
   pour un gain nul sur un jeu dont l'essentiel est social. Le rendu reste
   derrière une interface, un passage à l'isométrie plus tard ne toucherait
   qu'un module.
2. **Sauvegarde unique continue.** Une seule partie vivante, écrasée en
   continu, les événements irréversibles validés avant d'être affichés. La
   mort et les ruptures comptent réellement : le §36 devient une propriété
   technique et non une règle morale.
3. **Mode intention au-delà de ×10.** ×1 à ×10, le joueur déplace son
   personnage au clic. ×50 et plus, il pose une intention et son personnage
   l'exécute selon sa personnalité, comme les autres habitants. Le seuil
   reste un paramètre, à régler à l'essai en phase 2.

---

## Les règles non négociables

Elles sortent directement du cahier des charges. Tout code qui les viole est
à refuser, même s'il est bon par ailleurs.

1. **Le monde n'attend jamais le joueur.** Aucune décision de PNJ ne consulte
   sa position ou son état autrement que comme celle d'un habitant parmi les
   autres.
2. **Personne ne sait ce qu'il n'a pas appris.** Trois niveaux séparés :
   la vérité du monde, ce que chaque personnage croit savoir, ce que
   l'interface a le droit de montrer.
3. **Rien n'est scripté.** Un destin est le produit d'une personnalité, de
   capacités, d'occasions, de contraintes, de décisions et de hasard.
4. **Le noyau et les moteurs ne connaissent pas le navigateur.** Pas de DOM,
   pas de React, pas d'horloge système, pas de `Math.random`.
5. **Le joueur peut échouer,** et le jeu ne corrige pas sa trajectoire.
6. **La mort est définitive.**
