# 4. Le MVP : « Une saison dans le quartier »

Étape 5 du cahier des charges. Un MVP n'est pas une démo technique : c'est la
plus petite version qui permet de répondre à la question du §42 — *est-ce
qu'on a envie de savoir ce qui va arriver à cette vie ?* Si la réponse est
non à ce stade, aucune quantité de systèmes ajoutés ensuite ne la rendra oui.

---

## 4.1 Périmètre

### Le monde

- **Un quartier**, une carte extérieure d'environ 96 × 96 tuiles : rues,
  trottoirs, une place, un parc.
- **14 bâtiments avec intérieurs praticables** : 6 immeubles d'habitation,
  1 école, 1 lycée, 1 supérette, 1 café, 1 salle de sport, 1 bureau,
  1 atelier, 1 mairie-annexe.
- **Environ 40 pièces** au total, portes fonctionnelles, une trentaine
  d'objets interactifs (lit, cuisinière, bureau, machine de sport, comptoir,
  banc, télévision).

### Les habitants

- **60 personnages** simulés en permanence, 12 foyers, 3 générations déjà
  présentes à la création (des enfants, des actifs, des retraités).
- Chacun a : nom, âge, corps, 14 traits, besoins, un foyer, un logement,
  une occupation (école, emploi ou retraite), de l'argent, des relations
  préexistantes et une petite histoire déjà écrite par le générateur.

### Ce qui est simulé

- **Temps** ×1 à ×100, jour/nuit, calendrier, saisons.
- **Besoins et décisions** : les 60 habitants décident seuls, par utilité,
  avec des routines qui émergent des horaires et qui se brisent.
- **Relations** : cinq axes dirigés, épisodes, qualification dérivée,
  rencontres, conversations, disputes, amitiés, attirance.
- **Connaissance** : faits, croyances, transmission en conversation,
  dégradation. Les rumeurs fonctionnent dès le MVP.
- **Économie minimale** : salaires, loyers, courses, épargne. Postes en
  nombre fini.
- **École et travail** : aller, réussir ou échouer, être en retard, être
  renvoyé.
- **Le joueur** : un personnage de 18 ans, déplacement au clic, portes,
  objets, conversations, fiches de personnage limitées à ce qu'il sait.
- **Sauvegarde** continue, déterministe, rejouable.

### Ce qui n'est PAS dans le MVP

À dire clairement pour ne pas s'illusionner sur l'avancement :

- pas de voyages ;
- pas de naissance ni de mort par vieillissement (les 60 habitants vieillissent,
  mais la boucle générationnelle n'est pas branchée) ;
- pas de mariage ni d'enfants du joueur ;
- pas d'institutions au-delà de l'école et de l'employeur ;
- pas de création ni de faillite d'entreprise ;
- pas de célébrité ni de réputation publique ;
- graphismes fonctionnels et lisibles, pas aboutis.

---

## 4.2 Les cinq critères d'acceptation

Le MVP est réussi si et seulement si ces cinq affirmations sont vraies. Elles
sont formulées pour être vérifiables, pas pour être rassurantes.

**A1 — Le monde tourne sans le joueur.**
On lance 90 jours de simulation sans aucune entrée. À l'arrivée : au moins 15
changements d'emploi ou de scolarité, au moins 8 couples formés ou rompus, au
moins 20 amitiés nouées ou défaites, aucune violation d'invariant. Un test
automatique le vérifie.

**A2 — Deux habitants pris au hasard ont une histoire racontable.**
On ouvre la chronique de deux personnages au hasard après 90 jours. On doit
pouvoir lire une suite d'événements liés par des causes, pas une liste de
faits indépendants. Vérifié à la main, avec l'inspecteur.

**A3 — Une rumeur traverse le quartier et se déforme.**
On injecte un fait secret connu d'une seule personne. On mesure au bout de 30
jours : il doit être connu de 5 à 25 personnes, et au moins une version
déformée doit exister. Test automatique sur les bornes, lecture manuelle sur
la déformation.

**A4 — La personnalité se voit sans être affichée.**
Deux habitants aux traits opposés (très sociable / très solitaire), placés
dans les mêmes conditions de départ, doivent produire des journées
mesurablement différentes : nombre d'interactions, lieux fréquentés, temps
passé seul. Test automatique avec un écart minimal exigé.

**A5 — Le joueur peut échouer.**
Un scénario de test joue une trajectoire volontairement mauvaise (ne pas
dormir, ne pas travailler, tout dépenser). Il doit aboutir à des conséquences
réelles — perte d'emploi, dettes, relations dégradées — sans que le jeu ne
corrige la trajectoire. Et il doit rester possible de remonter la pente.

---

## 4.3 Les trois questions que le MVP doit trancher

Un MVP sert à apprendre, pas seulement à livrer.

1. **Est-ce que 60 habitants suffisent à donner l'impression d'une ville
   vivante ?** Si la réponse est non, la solution n'est probablement pas
   d'en mettre 300 — c'est que les personnages ne sont pas assez distincts.

2. **Est-ce que le mode intention (§C1 de l'analyse) est agréable ?** C'est
   le pari le plus risqué du projet. Si perdre le contrôle direct à haute
   vitesse est frustrant, il faudra revoir soit la vitesse maximale, soit
   la manière dont les intentions se posent.

3. **Est-ce que l'ignorance est plaisante ?** Ne pas savoir ce que pensent
   les autres est le cœur du concept (§26), mais c'est aussi potentiellement
   agaçant. Le MVP doit montrer si la découverte est un plaisir ou une
   friction.

---

## 4.4 Budget technique visé

| Grandeur | Cible | Pourquoi |
|---|---|---|
| Ticks/seconde à ×100 | 20 | définit la charge crête du MVP |
| Temps CPU par tick, 60 habitants | < 1,5 ms | laisse 90 % du budget d'image au rendu |
| Empreinte mémoire du monde | < 3 Mo | une partie tient en RAM sans effort |
| Taille de sauvegarde | < 1,5 Mo | chargement instantané |
| 90 jours simulés sans rendu | < 20 s | rend les tests d'équilibrage utilisables |
| Images par seconde en mode incarné | 60 | fluide sur machine modeste |

La dernière ligne du tableau est la plus importante et la moins évidente :
**90 jours en moins de 20 secondes** est ce qui permet de tester
l'équilibrage de la simulation dans la boucle de développement. Sans cela,
régler une société vivante devient impossible.
