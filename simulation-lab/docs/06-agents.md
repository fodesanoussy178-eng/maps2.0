# 6. Organisation du développement assisté par IA

Réponse au §39. Le cahier des charges demande explicitement de ne pas créer
vingt agents inutiles : **un orchestrateur, et des spécialistes seulement là
où le contexte à tenir en tête est trop large pour être partagé.**

Ces rôles sont des **cadres de travail**, pas de l'infrastructure. Aucun code
ne dépend d'eux. On peut travailler sans, en séquentiel, et le projet reste
compréhensible par une seule personne — c'est la contrainte du §39.

---

## 6.1 Le principe

Un spécialiste ne se justifie que si les trois conditions sont réunies :

1. son domaine a des **règles propres** qu'on ne peut pas garder en tête en
   même temps que le reste ;
2. son travail se **vérifie tout seul** (un test, une mesure) ;
3. il touche des fichiers **disjoints** de ceux des autres.

Un « agent dialogue », un « agent noms de rue », un « agent équilibrage des
prix » ne remplissent aucune des trois conditions. Ils ne doivent pas exister.

---

## 6.2 GAME DIRECTOR — l'orchestrateur

Le seul rôle permanent. Il ne code pas en priorité : il arbitre.

**Il détient** : le cahier des charges, les sept exigences structurantes
(doc 1), les six contradictions et leurs arbitrages, le graphe de
dépendances, la phase en cours.

**Il décide** : ce qui entre dans une phase et ce qui attend ; quand un
arbitrage doit remonter à l'humain plutôt qu'être tranché ; quand un système
proposé viole une exigence structurante et doit être refusé, même s'il est
bon.

**Il refuse systématiquement** : tout ce qui ajoute une dépendance du noyau
vers un moteur, tout ce qui fait connaître au joueur une chose que son
personnage ignore, tout ce qui rend le monde réactif à la présence du joueur,
tout ce qui introduit du non-déterminisme dans la simulation.

---

## 6.3 Les six spécialistes

Six, pas neuf. Trois rôles du §39 ont été fusionnés parce qu'ils partagent
leurs fichiers et leurs règles (voir 6.4).

| Rôle | Domaine | Fichiers | Vérifié par |
|---|---|---|---|
| **Simulation** | noyau, temps, échelles, déterminisme, invariants | `noyau/`, `etat/` | rejeu d'empreinte, invariants, profil de charge |
| **Personnage** | traits, besoins, actions, utilité, aspirations | `moteurs/personnage/` | critère A4, distribution des journées |
| **Social** | relations, connaissance, mémoire, rumeurs, réputation | `moteurs/relations/`, `moteurs/connaissance/` | critères A1 et A3, sociogramme |
| **Monde** | cartes, lieux, cheminement, économie, institutions | `moteurs/monde/`, `moteurs/economie/`, `contenu/` | critère A5, rareté des postes et logements |
| **Vie** | âge, santé, couples, naissances, mort, lignées, voyages | `moteurs/vie/`, `moteurs/voyage/` | stabilité démographique sur 10 ans |
| **Présentation** | lentille, rendu, interface | `lentille/`, `rendu/`, `interface/` | verrou d'import, images par seconde, lisibilité |

Un septième rôle, **Vérification**, n'a pas de domaine propre : il cherche
les contradictions entre systèmes (un personnage mort qui travaille encore,
un couple dont un seul membre est engagé, de l'argent créé ou détruit). Il
intervient à la fin de chaque phase, jamais pendant.

---

## 6.4 Fusions par rapport au §39, et pourquoi

- **Performance** n'est pas un rôle séparé : l'optimisation tardive est un
  symptôme. Le budget de calcul est une contrainte de conception détenue par
  Simulation, mesurée à chaque phase. Un « agent performance » qui passe
  après coup arriverait toujours trop tard.
- **Visual** est fusionné dans Présentation : le rendu et l'interface
  partagent la lentille et se contredisent s'ils sont traités séparément.
- **Travel** est fusionné dans Vie : un voyage est une tranche de vie
  condensée, il utilise exactement les mêmes règles à une autre granularité.
  Les séparer produirait deux modèles de la même chose, qui divergeraient.

---

## 6.5 Règles de collaboration

1. **Une phase, un spécialiste principal.** Les autres relisent, ne codent
   pas. Deux spécialistes qui écrivent en parallèle dans le même module
   produisent deux conceptions incompatibles.
2. **Un spécialiste ne modifie jamais un fichier hors de son domaine.** S'il
   a besoin d'un changement ailleurs, il le demande au Game Director.
3. **Aucune phase ne se déclare finie sans son test.** Le critère est écrit
   dans le doc 5 avant de commencer, pas négocié après.
4. **Ce qui n'est pas fait est écrit comme non fait.** Le journal
   d'avancement (`07-journal.md`) dit l'état réel, y compris les impasses.
