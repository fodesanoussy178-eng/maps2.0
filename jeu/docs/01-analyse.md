# 1. Analyse du cahier des charges

Ce document ne reformule pas le cahier des charges : il le lit de manière
critique. Il dit ce qui est tenable tel quel, ce qui est tenable après un
arbitrage, et ce qui est contradictoire. Toute contradiction relevée est
suivie d'une solution proposée, pas seulement d'un constat.

---

## 1.1 Ce que le cahier des charges demande réellement

En retirant les exemples, il reste sept exigences structurantes. Tout le
reste en découle.

| # | Exigence | Conséquence technique |
|---|---|---|
| E1 | Un seul personnage contrôlé, le monde continue sans lui | La boucle de simulation ne doit jamais attendre une entrée du joueur |
| E2 | 50–100 habitants réellement simulés, machine modeste | Budget de calcul borné par conception, pas par optimisation tardive |
| E3 | Les relations ont une histoire, pas un score | Relations multi-axes + journal d'épisodes, pas un entier |
| E4 | Chacun ne sait que ce qu'il a vu, entendu ou déduit | Séparation stricte vérité / croyance / affichage |
| E5 | Rien n'est scripté : destins émergents | Décision par utilité pondérée, jamais par arbre narratif |
| E6 | Le temps s'accélère jusqu'à ×500, sur des générations | Plusieurs échelles de simulation, pas une boucle unique |
| E7 | Déterminisme pour pouvoir rejouer et déboguer | Aucun `Math.random`, aucune horloge système, ordre stable partout |

Ces sept lignes sont le contrat. Un système qui les viole est un système à
refuser, quelle que soit sa valeur par ailleurs.

---

## 1.2 Les six contradictions du cahier des charges

Elles ne sont pas des erreurs : ce sont des points où deux désirs légitimes
s'excluent, et où il faut trancher explicitement plutôt que découvrir le
problème six mois plus tard.

### C1 — Marcher dans un monde à ×500

**Le conflit.** Le §3 veut un personnage qui marche, ouvre des portes, entre
dans des pièces. Le §14 veut une accélération jusqu'à ×500. À ×500, une
seconde réelle vaut plus de huit heures de jeu : le joueur ne peut
physiquement pas diriger des pas. Le déplacement au clic et l'accélération
extrême sont deux modes de jeu, pas un seul.

**La solution retenue.** Deux modes de contrôle, et la vitesse fait basculer
de l'un à l'autre :

- **Mode incarné** (×1 à ×10) — le joueur déplace son personnage au clic,
  ouvre les portes, parle. Le monde proche est animé image par image.
- **Mode intention** (×20 et au-delà) — le joueur ne dirige plus des pas, il
  pose une intention (« travailler », « voir Paul », « chercher un emploi »,
  « m'entraîner ») et son personnage l'exécute avec la même IA d'utilité que
  les autres, en tenant compte de sa personnalité. La caméra passe en vue
  large, la chronique remonte ce qui arrive.

Le basculement est automatique et réversible. Le joueur reprend la main dès
qu'il ralentit, et la simulation s'interrompt d'elle-même sur les événements
qui le concernent (voir C6). Ce n'est pas une concession : c'est ce qui rend
crédible le fait de vivre trente ans sans regarder chaque minute.

### C2 — « Pas de quêtes » et « le joueur doit avoir quelque chose à faire »

**Le conflit.** Le §9 et le §34 interdisent les quêtes imposées. Sans aucune
structure, un joueur lancé dans un monde sans objectif s'ennuie en vingt
minutes — c'est l'échec classique des simulations purement émergentes.

**La solution retenue.** Distinguer *quête* et *occasion*. Le jeu ne donne
jamais d'objectif, mais il **présente** clairement ce que le monde produit :

- une **opportunité** est un état du monde qui a une échéance et un coût
  (un poste ouvert jusqu'au 12, une place au club de football, un logement
  libre, une personne qui accepte un rendez-vous cette semaine) ;
- une **chronique** raconte au joueur ce qui vient d'arriver dans son cercle
  social, avec les liens de cause à effet que la simulation a réellement
  produits.

Aucun de ces éléments n'est écrit à l'avance, aucun n'est obligatoire, aucun
ne récompense mécaniquement. Mais le joueur voit toujours des portes
ouvertes. La tension vient des échéances et de la rareté, pas d'un scénario.

### C3 — Mort définitive et sauvegarde libre

**Le conflit.** Le §36 veut une mort irréversible. Le §37 veut une
sauvegarde complète. Une sauvegarde rechargeable *est* une annulation : le
joueur sauvegardera avant chaque décision risquée, et l'irréversibilité
disparaîtra sans qu'une seule ligne de code ne la contredise.

**La solution retenue.** Une seule sauvegarde vivante par partie, écrite en
continu, écrasée à chaque jalon (comme une partie de roguelike ou de Crusader
Kings). Les événements irréversibles — mort, rupture, licenciement — sont
validés dans la sauvegarde *avant* d'être affichés au joueur. Un mode « bac
à sable », séparé et affiché comme tel, autorise les sauvegardes multiples
pour les joueurs qui préfèrent explorer. Le déterminisme, lui, sert au
débogage via un journal d'entrées rejouable (voir §2 de l'architecture), pas
au retour en arrière.

**Décision qui vous appartient** : si vous préférez la sauvegarde libre, il
faut alors accepter que le §36 devienne une règle morale et non une règle
technique. Les deux se défendent, mais il faut choisir.

### C4 — 100 habitants et plusieurs générations

**Le conflit.** Le §2 fixe 50–100 personnages. Le §19 veut des dizaines
d'années et des arrière-petits-enfants. Une population fermée de 100 personnes
simulée sur soixante ans fait l'une de deux choses : elle s'éteint, ou elle
explose. Dans les deux cas la ville cesse d'être crédible, et le coût de
calcul dérive.

**La solution retenue.** Un **régulateur démographique** qui n'est pas un
plafond arbitraire mais une pression douce :

- naissances et décès sortent de la simulation (âge, santé, couples) ;
- l'**emménagement et le départ** absorbent l'écart : quand la population
  descend sous la bande cible, des logements vacants attirent de nouveaux
  arrivants ; quand elle la dépasse, les personnages sans attache (pas de
  famille proche, pas d'emploi, peu de liens) partent — et leur départ est
  lui-même un événement social, pas une suppression silencieuse ;
- les morts ne disparaissent pas : ils passent dans un **registre**, un état
  réduit (~200 octets) qui conserve ce qui compte pour la suite — filiation,
  patrimoine transmis, réputation, souvenirs que les vivants gardent d'eux.

Bande cible du MVP : 60 habitants actifs, plancher 45, plafond 110.

### C5 — Rumeurs entre 100 personnes : l'explosion combinatoire

**Le conflit.** Le §8 veut que chacun ne sache que ce qu'il a appris. Sans
garde-fou, le nombre de croyances croît comme (personnages × faits) et chaque
conversation en crée de nouvelles. Au bout d'un an de jeu, la mémoire sociale
pèse plus que tout le reste de la simulation réunie.

**La solution retenue.** Trois limites, toutes justifiées par la vraisemblance
et pas seulement par la performance :

1. **Seuls les faits saillants circulent.** Un fait porte une *saillance*
   (intensité émotionnelle × implication des interlocuteurs × fraîcheur).
   Sous un seuil, on n'en parle pas — comme dans la vraie vie.
2. **Chaque personnage a une capacité de mémoire sociale bornée** (~150
   croyances). Au-delà, les croyances les moins saillantes et les plus
   anciennes s'effacent ou se dégradent en impressions vagues.
3. **Les faits vieillissent.** Une information perd sa saillance avec le
   temps ; elle cesse de circuler bien avant d'être oubliée.

Ces trois règles produisent gratuitement l'effet recherché : les histoires
fortes traversent la ville, les banalités meurent là où elles sont nées.

### C6 — « Le joueur n'est pas le centre » et « le joueur doit s'y intéresser »

**Le conflit.** Le §35 est une règle absolue : le monde ne tourne pas autour
du joueur. Mais un monde totalement indifférent devient illisible : le joueur
ne saura jamais que Paul a changé de travail, et la profondeur sociale ne
produira aucune expérience.

**La solution retenue.** La **simulation** ignore le joueur ; la **couche
d'attention** ne l'ignore pas. Ce sont deux modules séparés :

- aucune décision de PNJ ne consulte jamais la position ou l'état du joueur
  autrement que comme celui d'un habitant parmi les autres ;
- une couche d'attention, purement en lecture, note chaque événement selon sa
  proximité sociale au personnage joueur, et décide quoi remonter dans la
  chronique et quand suspendre l'accélération.

Le monde ne s'adapte pas ; c'est la caméra qui regarde au bon endroit.

---

## 1.3 Les pièges classiques du genre, et comment on les évite

Ces problèmes ne sont pas dans votre cahier des charges. Ils tuent
systématiquement ce type de projet.

**Le « mur des relations ».** Le joueur ouvre une fiche et voit vingt
jauges. Il ne ressent rien. *Parade* : l'interface ne montre jamais un axe
numérique brut, elle montre les **épisodes** (« vous vous êtes disputés le
14 mars ») et une qualification en langue naturelle. Les nombres restent dans
le moteur.

**La « soupe grise ».** Au bout de six mois de jeu, tout le monde a des
statistiques moyennes, toutes les relations sont tièdes, plus rien n'arrive.
C'est l'attracteur naturel de toute simulation à besoins. *Parade* : les
grandes bascules passent par des **seuils** et des **engagements** (emménager
ensemble, se marier, démissionner, rompre) qui créent des états stables et
coûteux à quitter, plutôt que par des dérives continues.

**Le « déterminisme cassé ».** Un jour, une partie ne se rejoue plus, et il
est impossible de savoir pourquoi. *Parade* : le déterminisme est un **test**,
pas une intention. Une empreinte de l'état du monde est calculée à chaque
jalon, et un test rejoue 30 jours et compare l'empreinte finale. Il tombera
le jour où quelqu'un ajoute une itération sur un `Set`.

**Le « moteur de simulation qui importe React ».** Le jour où c'est arrivé,
il est fini : plus de tests sans DOM, plus de simulation hors écran, plus de
voyage calculé en une fois. *Parade* : `jeu/noyau` et `jeu/moteurs` n'ont
aucune dépendance au navigateur, et une règle de lint le fait respecter.

**La « fuite de vérité ».** L'interface lit `monde.personnages[id].secrets`
« juste pour déboguer », et le §26 est mort. *Parade* : l'interface n'a
littéralement pas accès au monde. Elle passe par une **lentille** qui ne sait
répondre qu'à partir des croyances du personnage joueur.

---

## 1.4 Ce que je propose d'améliorer par rapport au cahier des charges

Quatre ajouts, tous justifiés par le principe central du §42.

1. **La chronique causale.** Chaque changement important enregistre ses
   causes. Cela sert trois fois : au joueur (une vraie biographie, pas un
   journal d'événements), au débogage (« pourquoi Paul a-t-il déménagé ? »),
   et à la narration des voyages et des générations. Coût : quelques octets
   par jalon.

2. **Les relations dirigées.** A → B n'est pas B → A. Sans cela, pas d'amour
   non partagé, pas de rancune unilatérale, pas de malentendu durable — or ce
   sont les moteurs dramatiques les plus efficaces.

3. **Le marché est fini.** Il y a un nombre fini de postes, de logements, de
   places à l'université. Quand un personnage prend un poste, un autre ne l'a
   pas. C'est la seule façon d'obtenir un échec qui ne soit pas un tirage de
   dé déguisé, et cela crée la rivalité sans avoir à la scripter.

4. **Le mode observateur.** Pouvoir suivre un PNJ quelconque sans le
   contrôler, avec la même interface limitée. C'est le meilleur outil de
   débogage de simulation sociale qui existe, et c'est aussi agréable à
   jouer.

---

## 1.5 Ce que je refuse d'ajouter

Par cohérence avec le §40, et à signaler ici pour que ce soit un choix
conscient :

- **pas d'ECS complet** — pour 100 agents c'est un coût d'architecture sans
  contrepartie ; des enregistrements simples et des fonctions pures suffisent
  et se sauvegardent tout seuls ;
- **pas de moteur de jeu tiers** (Phaser, Unity) — le rendu dont vous avez
  besoin est une grille de tuiles et des sprites ; un canvas suffit, et une
  dépendance lourde rendrait la simulation dépendante de la boucle de rendu,
  ce qui est exactement ce qu'il faut éviter ;
- **pas de modèle de langage pour les dialogues** dans le MVP — coût, latence
  et non-déterminisme ; les dialogues sont composés à partir des faits, des
  croyances et de la relation. La question pourra se reposer plus tard, en
  couche purement cosmétique et optionnelle ;
- **pas de multijoueur, pas de réseau, pas de base de données** — la partie
  tient dans un fichier.
