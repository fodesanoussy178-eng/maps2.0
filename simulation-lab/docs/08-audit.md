# 8. Audit de l'état réel — 17 septembre 2026

Cet audit ne cherche pas à défendre ce qui existe. Il répond à une question :
**qu'est-ce qui manque entre ce qui tourne aujourd'hui et le jeu décrit dans
le cahier des charges ?**

Rien ici n'est écrit de mémoire. Chaque affirmation vient d'une lecture du
code ou d'une mesure faite pour l'occasion, et les mesures sont données avec
leur méthode.

**Le verdict en une phrase :** le socle est sain et le premier étage tient,
mais la maison a deux étages sur onze, et une partie des fondations posées —
le bus d'événements, les échelles de simulation, les vitesses de temps — **est
testée sans être branchée à quoi que ce soit**.

---

## 0. Ce qui a été mesuré pour cet audit

| Mesure | Méthode | Résultat |
|---|---|---|
| Taille du code | `wc -l`, hors tests | 4 075 lignes + 1 186 de tests |
| Coût par réveil d'agent | 10 jours simulés, population 60 puis 240 | 919 puis 748 réveils/ms |
| Mise à l'échelle | 10 jours à 60, 120, 240, 480 habitants | 189 / 387 / 935 / 2 550 ms |
| Coût par décision | temps ÷ décisions | 74 déc/ms jusqu'à 240, 65 à 480 |
| Modules du noyau consommés | recherche d'usage hors noyau et hors tests | voir §1.2 |

Une lecture importante de la troisième ligne : entre 60 et 480 habitants, le
temps total est multiplié par 13,5 pour une population multipliée par 8. Mais
le coût **par décision** reste presque plat. La croissance vient donc du
**nombre** de décisions, pas de l'algorithme — et ce nombre explose parce que
le monde, lui, ne grandit pas (§8.2).

---

## 1. Audit du moteur de simulation

Barème : **A** existe et fonctionne · **B** existe mais partiellement branché ·
**C** existe uniquement comme modèle ou type · **D** n'existe pas.

### 1.1 Les vingt-sept systèmes

| Système | État | Ce qui existe réellement |
|---|:--:|---|
| Besoins | **A** | 7 besoins, dérive modulée par les traits, repli du temps exact, testé |
| Personnalité | **A** | 14 traits ; ils n'entrent que dans les courbes et la température du tirage, jamais en bonus |
| Préférences | **B** | Une seule : le lieu habituel, dérivé par hachage. Aucune préférence de personne, d'activité, de nourriture, d'horaire |
| Habitudes | **B** | Émergent des courbes horaires (stabilité 0,72), mais rien ne les **mémorise** : un habitant ne « prend » pas une habitude, il la recalcule chaque fois |
| Emploi | **C** | Un champ `occupation` tiré à la création, jamais modifié. **Aucun marché du travail** : pas de poste fini, pas de candidature, pas d'embauche, pas de licenciement. Deux bureaux accueillent 250 salariés sans broncher |
| École | **C** | Idem : un champ, des horaires. Aucun résultat, aucune orientation, aucun échec, aucune sortie du système |
| Logement | **B** | Chacun a un domicile, la capacité est respectée. Mais on n'emménage ni ne déménage jamais, et le logement ne coûte rien |
| Argent | **B** | Salaire crédité à l'heure, trois achats possibles, dépense mutualisée par foyer. **Ni loyer, ni charges, ni pension, ni dette** : les salariés accumulent 148 €/jour, la médiane est à zéro |
| Déplacements | **B** | Forfait de 20 minutes entre deux lieux quelconques. Pas de carte dans le moteur, pas de distance, pas de transport |
| Activités | **A** | 16 actions, IA d'utilité par produit de considérations compensé, tirage pondéré tempéré par l'impulsivité |
| Satisfaction | **B** | Les besoins mesurent le manque ; rien ne mesure le contentement, l'humeur ou l'émotion. Le champ `humeur` du doc 2 n'existe pas dans le code |
| Relations | **C** | `etat/relation.ts` : 214 lignes de modèle. **Importé par personne.** Zéro relation n'existe dans aucun monde |
| Mémoire | **D** | Rien |
| Événements | **C** | Le bus est écrit et testé (8 tests) et **n'a aucun usage hors tests** : `creerBus`, `abonner`, `publier` = 0 appel dans le moteur |
| Famille | **D** | Le foyer existe comme adresse partagée, pas comme parenté. Aucun lien parent-enfant |
| Vieillissement | **C** | `age()` calcule un nombre pour l'affichage. Rien ne change avec lui |
| Naissance | **D** | Rien |
| Mort | **D** | Rien |
| Générations | **D** | Rien |
| Institutions | **D** | Les lieux ont un nom et une capacité. Aucune organisation, aucune règle, aucune politique |
| Classes sociales | **D** | Rien. L'argent existe mais rien ne le lit comme position sociale |
| Réputation | **D** | Rien |
| Secrets | **D** | Rien |
| Rumeurs | **D** | Rien |
| Groupes sociaux | **D** | Rien |
| Pouvoir | **D** | Rien |
| Transmission intergénérationnelle | **D** | Rien |

**Compte : 3 A, 7 B, 5 C, 12 D.** Sur les 27 systèmes du cahier des charges,
trois fonctionnent pleinement.

### 1.2 Ce qui est écrit, testé, et inutilisé

C'est le constat le plus important de cet audit, parce qu'il change la lecture
de tout le reste : **une partie du noyau que je présentais comme « fait » est
une fondation posée, pas un système en service.**

| Module | Tests | Usages hors noyau et hors tests |
|---|:--:|:--:|
| Bus d'événements (`creerBus`, `abonner`, `publier`) | 8 | **0** |
| Affectation des échelles (`affecterEchelles`) | oui | **0** |
| Budget de calcul (`coutParTick`) | oui | **0** |
| Vitesses de temps (`ticksDus`, `VITESSES`) | oui | **0** |
| Mode de contrôle (`modeControle`) | oui | **0** |
| Empreinte déterministe | 8 | 10 |
| Flux d'aléa | 12 | 3 |
| Créneau de mise à jour (`doitMettreAJour`) | oui | 1 |

Les cinq premières lignes sont des promesses. Elles sont correctes, testées et
prêtes — mais aucune n'est branchée. Autrement dit : **le jeu n'a pas
d'architecture événementielle en service, pas de niveaux de détail en service,
et pas de contrôle de vitesse en service.** Il a le code pour, et rien ne
l'appelle.

### 1.3 L'état du monde ne porte pas encore le monde

```ts
interface Monde {
  graine; tick; compteur;
  personnages: Map<PersoId, Personnage>;
  lieux: Map<LieuId, Lieu>;
}
```

Deux collections. Le doc 2 décrit en outre `defunts`, `relations`, `faits`,
`croyances`, `organisations`, `postes`, `logements`, `foyers`, `lignees`,
`chronique`, `economie`. **Aucune n'existe.**

Ce n'est pas un détail de rangement. Tout système ajouté avant que la
structure d'accueil existe devra être recâblé quand elle arrivera — et c'est
précisément le genre de réécriture que l'audit doit permettre d'éviter.

---

## 2. Audit du monde visuel

**Présent** = réellement fonctionnel · **Prototype** = existe mais très
simplifié · **Manquant** = à construire.

| Élément | État | Détail |
|---|:--:|---|
| Bâtiments | Prototype | Volumes extrudés à deux faces, toit plat, une porte plaquée. Une seule forme pour tous |
| Diversité architecturale | Prototype | 8 teintes de façade, 5 de toit, hauteur variable. Aucune variation de forme, de toiture, de balcon, d'enseigne |
| Maisons | Manquant | Tout est un bloc. Pas de pavillon, pas de toiture en pente |
| Appartements | Prototype | C'est le seul type réellement dessiné, par défaut |
| Commerces | Manquant visuellement | La supérette existe comme lieu ; rien ne la distingue à l'œil : ni vitrine, ni enseigne, ni store |
| Écoles | Manquant visuellement | Même chose : une emprise plus large, rien d'autre |
| Lieux publics | Manquant | Pas de place, pas de mairie, pas d'équipement |
| Parcs | Prototype | Une pelouse avec arbres et bancs. Pas d'allée, pas de jeux, pas d'eau |
| Rues | Présent | Trame, chaussée, marquage axial en pointillés |
| Trottoirs | Présent | Bordure sur tout le pourtour des îlots |
| Mobilier urbain | Prototype | Bancs et lampadaires. Ni poubelle, ni arrêt, ni panneau, ni passage piéton |
| Arbres | Présent | Trois nuances, tronc et houppier en trois boules |
| Éclairage | Prototype | Halo des lampadaires et fenêtres allumées la nuit. Pas d'ombre portée, pas de lumière directionnelle |
| Météo | Manquant | Rien |
| Cycle jour/nuit | Présent | Obscurité continue calculée à l'heure, transitions à l'aube et au crépuscule |
| Intérieurs | Manquant | Les bâtiments sont pleins. Rien à l'intérieur, à aucun niveau |
| Portes | Prototype | Un rectangle sur la façade. Personne ne l'ouvre, personne ne la franchit visiblement |
| Fenêtres | Prototype | Losanges par étage, allumage selon l'occupation et l'heure. Pas de silhouette derrière |
| Circulation | Manquant | Aucun véhicule, aucun transport |
| Personnages | Prototype | Un corps trapézoïdal et une tête, hauts de 15 px, colorés par activité. Voir §3 |
| Animations | Manquant | Aucune. Un passant glisse sans bouger les jambes |
| Interactions | Prototype | Clic sur un passant ou un bâtiment → fiche. Rien d'autre |
| Activités visibles | Manquant | On voit **où** les gens sont, jamais **ce qu'ils font**. Un habitant assis, qui mange, qui discute ou qui dort a la même apparence |
| Densité | Prototype | 32 personnes dehors au pic, 6,7 en moyenne. Correct pour 60 habitants, invisible à l'échelle d'une ville |
| Quartiers | Manquant | Une trame régulière et homogène. Ni centre, ni périphérie, ni différenciation |

### 2.1 Le défaut structurel du rendu

**La page ne simule rien : elle rejoue un enregistrement.**

`vue/trace.ts` lance la simulation en Node, enregistre 576 images, et la page
web les fait défiler. Conséquences directes :

- on ne peut pas changer la vitesse au-delà de ce qui est enregistré, ni
  dépasser la durée enregistrée (2 jours) ;
- on ne peut rien faire **agir** sur le monde : il n'y a pas de joueur
  possible, par construction ;
- le fichier pèse 425 Ko pour 2 jours et 60 habitants. À 1 000 habitants sur
  un an, ce serait plusieurs gigaoctets ;
- ce qu'on regarde est un film, pas un monde.

C'était le bon choix pour prouver que le moteur produit des journées qui
tiennent debout. Ce n'est pas une étape vers le jeu : **la vue devra être
réécrite pour piloter le moteur en direct**, et c'est un remplacement, pas une
extension.

---

## 3. Personnages : ce qu'il faudrait

Aujourd'hui un habitant est un trapèze de 7 px de large surmonté d'un disque,
teinté par famille d'activité. Vous avez raison de dire que c'est un marqueur.

### 3.1 La décision d'architecture qui conditionne tout le reste

**L'apparence doit vivre dans l'état du monde, pas dans la vue.**

Ce n'est pas un choix esthétique. Le §19 du cahier des charges demande que les
enfants ressemblent à leurs parents sans en être des copies : l'apparence doit
donc être **héritable**, donc sérialisée dans la sauvegarde, donc dans
`Personnage`. Si elle est calculée dans le rendu à partir de l'identifiant,
elle ne se transmet pas et il faudra tout refaire à la phase 9.

```ts
interface Apparence {
  // Hérité, avec bruit et régression vers la moyenne
  teintePeau: number;      // 0..255
  teinteCheveux: number;
  coiffure: number;        // indice dans un répertoire
  corpulence: number;      // -100..100
  tailleCm: number;
  // Acquis, change avec l'âge, le métier, l'argent, la saison
  garderobe: { haut: number; bas: number; teinteHaut: number; teinteBas: number };
  accessoires: number;     // masque de bits : lunettes, sac, chapeau, canne
}
```

En revanche, **le dessin de cette apparence appartient à la vue** et doit
pouvoir changer sans toucher au moteur.

### 3.2 Ce que chaque axe de différenciation demande

| Axe | Ce qu'il faut | Où ça vit |
|---|---|---|
| Silhouette | 3 gabarits (enfant, adolescent, adulte) × corpulence | Vue, d'après `Apparence` |
| Âge | Hauteur et proportions : un enfant fait 2/3 de la hauteur, la tête proportionnellement plus grosse | Vue, d'après `naissance` |
| Vêtements | Haut et bas colorés séparément ; un jeu de 6-8 formes suffit à la lisibilité | Moteur (garde-robe) + vue |
| Cheveux | 8 à 12 coiffures dessinées en 2 à 4 polygones, teinte continue | Moteur + vue |
| Couleurs | Palettes séparées peau / cheveux / vêtements, pour ne pas tout faire virer au même ton | Vue |
| Taille | `tailleCm` module la hauteur du sprite de ±12 % | Moteur |
| Accessoires | Sac, lunettes, chapeau, canne — posés en surcouche | Moteur + vue |
| Animation | Cycle de marche à 4 images, cycle d'attente à 2, poses assis / debout / couché | Vue |
| Comportement | La pose reflète l'ACTION en cours, pas seulement le lieu | Moteur (l'action est déjà là) → vue |

### 3.3 La contrainte de performance, et la seule réponse qui tienne

Dessiner mille personnages détaillés à chaque image, en redessinant chaque
polygone, est hors budget.

La réponse est un **atlas de sprites pré-rendus** : à l'ouverture, on dessine
une fois chaque combinaison utile — gabarit × coiffure × tenue × direction ×
image du cycle — dans un canvas hors écran, et le rendu ne fait plus que
recopier des rectangles. Le coût passe d'un tracé vectoriel par personnage à
un `drawImage`, soit environ deux ordres de grandeur.

Corollaire de conception : l'apparence doit être **discrétisée** (index dans
des répertoires) et non continue, sinon deux habitants n'ont jamais le même
sprite et l'atlas explose. D'où les `number` d'indice dans la structure
ci-dessus plutôt que des couleurs libres.

### 3.4 Niveaux de détail à l'écran

Trois paliers, choisis par le zoom :

- **loin** — une pastille colorée par activité, comme aujourd'hui ;
- **moyen** — silhouette sans visage, tenue à deux couleurs, cycle de marche ;
- **près** — coiffure, accessoires, pose liée à l'action.

Sans ces paliers, ou bien la ville vue de loin coûte le prix du détail, ou
bien la ville vue de près reste illisible.

---

## 4. Ville vivante : ce qui manque

Le principe que vous posez est le bon et je le reprends comme règle : **aucune
animation décorative ne doit prétendre représenter une simulation qui
n'existe pas.** L'audit ci-dessous distingue donc ce qui est déjà simulé (et
qu'il suffit de montrer) de ce qui demande d'abord du moteur.

### 4.1 Déjà simulé, seulement invisible — donc du travail de rendu

| Ce qu'on pourrait montrer dès maintenant | D'où vient la donnée |
|---|---|
| Quelqu'un entre dans un bâtiment | La transaction `deplacer` connaît l'instant exact |
| Quelqu'un en sort | Idem |
| Des enfants à l'école, des clients au commerce | `lieu.occupants` les contient déjà |
| Des habitants au parc | Déjà visibles, mais immobiles et sans pose |
| Des trajets différents selon les individus | Les préférences de lieu existent depuis aujourd'hui |
| Des activités différentes | L'action en cours est connue à chaque tick |
| Quelqu'un qui dort, mange, travaille | L'action est là ; il manque la pose et l'intérieur |

### 4.2 Pas encore simulé — donc du travail de moteur d'abord

| Ce qui manquerait pour de vrai | Ce qu'il faut d'abord |
|---|---|
| Deux personnes qui discutent ensemble | Un système de relations, et une interaction à deux : aujourd'hui « discuter » est une action solitaire qui compte juste des présents |
| Quelqu'un qui attend | Une notion de file, de rendez-vous ou d'horaire subi |
| Quelqu'un assis | Un objet occupable (banc, chaise) et une position dans le lieu |
| Un événement local | Le moteur d'événements, qui n'est pas branché |
| Une foule qui se forme | Des groupes, qui n'existent pas |

**La règle qui en découle :** tant que le rendu de 4.1 n'est pas fait, ajouter
du décor animé serait exactement le mensonge que vous voulez éviter. Et tant
que le moteur de 4.2 n'existe pas, la ville restera une ville où les gens se
croisent sans se voir.

---

## 5. Intérieurs : l'architecture à prévoir maintenant

Vous demandez de ne pas construire les intérieurs, mais de rendre leur ajout
possible sans réécrire le moteur. C'est la bonne question, et elle a une
réponse précise, parce qu'un seul champ décide de tout.

### 5.1 Le champ qui coûte cher à ajouter tard

Aujourd'hui, la position d'un personnage est `lieu: LieuId`. Un intérieur
impose `{ lieu, piece, x, y }`.

Ce changement touche : les transactions, `lieuCible`, chaque action, les
invariants, la sauvegarde, la vue, et la migration des parties existantes.
**Fait maintenant, c'est une demi-journée ; fait à la phase 7, c'est une
réécriture transversale.**

### 5.2 La forme minimale à poser dès que possible

```ts
interface Piece {
  id: PieceId;
  nom: string;              // « cuisine », « salle de classe », « bureau 2 »
  type: TypePiece;
  capacite: number;
  occupants: PersoId[];
  objets: ObjetId[];        // ce qui rend une pièce utile plutôt que décorative
}

interface Lieu {
  // … champs actuels
  pieces: Piece[];          // vide = bâtiment sans intérieur simulé
}
```

Trois propriétés à respecter :

1. **Un lieu sans pièce reste valide.** Tous les bâtiments commencent ainsi, et
   on ouvre les intérieurs un type à la fois. Rien ne casse en chemin.
2. **L'action déclare la pièce qu'elle exige**, pas le lieu : « dormir » veut
   une chambre, « manger » une cuisine ou une salle. Le champ `lieux` du
   catalogue devient `pieces`, et le lieu s'en déduit.
3. **Les objets portent les affordances.** Un lit rend « dormir » possible ;
   sans lui la chambre est un décor. C'est ce qui permettra plus tard
   qu'acheter un objet change réellement la vie de quelqu'un.

### 5.3 Côté rendu

Deux modes, et le second peut attendre : la **coupe** (le bâtiment sélectionné
s'ouvre et montre ses pièces à la place de sa façade) et l'**entrée** (la
caméra bascule dans une vue d'intérieur). Les deux lisent la même structure ;
aucun ne demande de changer le moteur une fois `Piece` posée.

---

## 6. Caméra et observation

**État actuel : il n'y a pas de caméra.** Le canvas est dessiné à échelle
fixe, la page le met à l'échelle en CSS, et le clic est converti par une règle
de trois. Aucun zoom, aucun déplacement, aucun suivi.

Ce qu'il faut, et ce n'est pas de la décoration — « observer » est le verbe
central du jeu :

| Besoin | Ce que ça demande |
|---|---|
| Zoomer, dézoomer | Une transformation de vue `{ echelle, dx, dy }` appliquée avant tout tracé, et le tracé exprimé en coordonnées monde |
| Déplacer | Glisser à la souris, au doigt, aux flèches ; bornes pour ne pas perdre la ville |
| Observer un quartier | Découle du zoom et du déplacement |
| Suivre un habitant | La caméra prend une cible et interpole sa position à chaque image |
| Sélectionner | Désignation par la transformation **inverse**, pas par une règle de trois |
| Ouvrir, fermer des fenêtres | Des panneaux empilables et déplaçables, pas un encadré fixe |
| Entrer dans un bâtiment | Bascule de contexte de rendu (§5.3) |
| Fluidité | Élagage par rectangle visible : ne dessiner que ce qui est à l'écran — indispensable dès que la ville dépasse ce qu'on voit |

Trois de ces points — la transformation de vue, la désignation inverse,
l'élagage — sont **structurants** : les ajouter après coup oblige à reprendre
chaque fonction de dessin et de clic. Aujourd'hui il y en a une douzaine ;
plus tard il y en aura cent.

---

## 7. Temps : le moteur tient-il ×1 à ×40 ?

### 7.1 Ce qui est acquis, et c'est le plus important

**Aucune décision ne dépend du nombre d'images affichées.** Vérifié dans le
code, et c'est vrai par construction :

- `avancer(monde, ticks)` ne connaît ni image, ni horloge système ;
- l'aléa est dérivé de `(graine, flux, personnage, tick)` — jamais d'un
  compteur d'appels, donc jamais de l'ordre dans lequel le rendu tourne ;
- la dérive des besoins et les effets des actions sont linéaires dans le
  temps, donc replier une heure d'un coup donne le même état que la simuler
  tick par tick — ce point a son test, et il est tombé une fois à juste titre
  (un arrondi par tick faisait vieillir 4 % plus vite les personnages simulés
  finement).

La simulation peut donc tourner sans rendu. C'est déjà le cas : le banc
d'essai n'affiche rien.

### 7.2 Ce qui n'est pas acquis

- **Aucune boucle temps réel n'existe.** `ticksDus`, qui convertit une durée
  réelle et une vitesse en nombre de ticks — avec report du reste et plafond
  anti-spirale — est écrit, testé, et **appelé nulle part**. Les seuls
  consommateurs actuels avancent d'un nombre fixe de ticks.
- **Les échelles ne sont pas en service.** `affecterEchelles` n'est appelé par
  personne ; le banc d'essai met toute la population à la même échelle. Donc
  ×40 coûte aujourd'hui exactement 40 fois ×1.
- **La boucle balaie toute la population à chaque tick**, même pour les
  personnages qui ne sont pas dus. À 1 000 habitants et ×500, cela fait
  500 000 tests par seconde uniquement pour décider de ne rien faire. Le
  remède est connu (des seaux par créneau au lieu d'un test par individu) mais
  n'est pas écrit.

### 7.3 Ce que les mesures disent du plafond

919 réveils par milliseconde à 60 habitants, 748 à 240.

| Situation | Réveils par seconde | Part d'un cœur |
|---|---:|---:|
| 60 habitants à ×40, tout en micro | 2 400 | 0,3 % |
| 1 000 habitants à ×40, tout en micro | 40 000 | ~5 % |
| 1 000 habitants à ×500, tout en micro | 500 000 | ~65 % |

Conclusion honnête : **×40 passe même à mille habitants avec l'agent actuel**.
Mais cet agent est pauvre — pas de relations, pas de mémoire, pas de
perception. Chacun de ces systèmes multipliera le coût d'un réveil. Les
échelles ne sont pas un luxe qu'on ajoutera si besoin : elles sont ce qui
permettra de garder ces chiffres quand l'agent aura cinq fois plus à faire.

---

## 8. Performance : où sont les futurs goulets

### 8.1 Mesures

| Population | 10 jours | Décisions | Décisions/ms |
|---:|---:|---:|---:|
| 60 | 189 ms | 13 975 | 74 |
| 120 | 387 ms | 29 203 | 75 |
| 240 | 935 ms | 69 434 | 74 |
| 480 | 2 550 ms | 165 252 | 65 |

Le coût par décision est **plat** jusqu'à 240 et perd 13 % à 480. La
croissance du temps total vient donc à ~87 % du nombre de décisions.

### 8.2 Le vrai plafond n'est pas algorithmique

Le générateur crée **2 bureaux, 1 école, 1 commerce, 1 gymnase, 2 cafés quelle
que soit la population**. Seuls les logements s'adaptent. À 480 habitants, on
a donc 60 places de bureau pour environ 250 actifs.

Ce que produit cette disette : des lieux pleins, des déplacements refusés, des
replis sur « flâner » qui durent 15 minutes, donc **des décisions en cascade**.
C'est le nombre de décisions qui explose, pas leur prix.

**Conséquence pour la suite : faire croître le monde avec la population est un
prérequis à toute mesure de performance sérieuse.** Tant que ce n'est pas fait,
les chiffres au-delà de 200 habitants mesurent une pénurie, pas un moteur.

### 8.3 Les points chauds identifiés, par ordre de gravité future

| Système | Coût actuel | Risque | Remède connu |
|---|---|---|---|
| **Argent du foyer** | `O(N)` par décision : parcourt **toute** la population pour sommer un foyer | À 1 000 habitants et 350 000 décisions : 350 millions d'itérations. C'est le 13 % déjà visible à 480 | Un index `foyer → membres`, tenu par les transactions |
| **Choix du lieu** | `O(lieux)` par action évaluée, soit 16 × 33 = 528 parcours par décision | Le nombre de lieux **doit** croître avec la population : le coût est donc `O(N)` déguisé | Un index `type de lieu → liste`, et un rayon de recherche |
| **Balayage de la boucle** | `O(N)` par tick, même pour ne rien faire | 500 000 tests/s à ×500 et 1 000 habitants | Des seaux par créneau |
| **Perception** | `autresPresents` alloue un tableau à chaque décision | Un lieu de 100 occupants à 1 000 habitants : 100 copies par décision | Renvoyer une vue, pas une copie ; plafonner la perception |
| **Relations** (à venir) | — | 1 000 habitants × 40 relations = 40 000 arêtes dirigées. Acceptable **en mémoire**. Mortel si on les balaie chaque tick : 11,5 millions d'accès par jour simulé | La décroissance paresseuse est déjà prévue dans `relation.ts` — c'est le bon réflexe, il faut le tenir |
| **Mémoire** (à venir) | — | Le vrai danger : nombre de souvenirs × nombre d'habitants, croissant avec le TEMPS et pas seulement la population | Plafond dur par personne, éviction par importance |
| **Événements** (à venir) | — | Une règle évaluée pour chaque personnage à chaque tick serait `O(règles × N)` par tick | N'évaluer les règles que sur déclencheur, jamais en balayage |
| **Cheminement** | Inexistant dans le moteur (forfait de 20 min) | Le jour où la carte entre dans le moteur, c'est le poste le plus cher | Chemins pré-calculés entre lieux, champs de flux, et surtout : ne router que les personnages visibles |

**Le point à retenir :** aucun de ces systèmes n'est coûteux aujourd'hui. Tous
le deviennent en même temps, autour de quelques centaines d'habitants, et pour
la même raison — un parcours global là où il faudrait un index.

---

## 9. Relations : ce que `etat/relation.ts` contient, et ce qui manque

### 9.1 Ce qui existe (214 lignes, importées par personne)

- une relation **dirigée** : `A → B` n'est pas `B → A` ;
- **six axes** : familiarité, affection, confiance, respect, attirance,
  tension ;
- un **lien structurel** factuel séparé des sentiments : foyer, voisin,
  collègue, camarade ;
- des **épisodes** plafonnés à douze, évincés par force et non par âge — une
  dispute d'il y a dix ans pèse plus qu'un café d'hier ;
- une **décroissance paresseuse** : ce qu'une relation perd par jour sans
  contact, calculé à la lecture et non balayé à chaque tick ;
- une **qualification dérivée** — inconnu, connaissance, ami, proche, rival,
  ennemi — jamais stockée, recalculée à la lecture, hostilité prioritaire sur
  affection ;
- la saturation de la familiarité : les cent premières minutes avec quelqu'un
  apprennent plus que les mille suivantes.

C'est un modèle, et je le crois juste. Ce n'est pas un système : **aucun monde
ne contient une seule relation.**

### 9.2 Les six pièces manquantes

| Pièce | Ce que c'est | Sans elle |
|---|---|---|
| **Stockage** | `monde.relations: Map<string, Relation>` | Rien ne persiste |
| **Choix de l'interlocuteur** | Qui parle à qui parmi les présents, pondéré par familiarité et affection | C'est **la** pièce qui fait émerger les groupes : on parle à ceux qu'on connaît, donc des grappes se forment. Sans elle, les interactions sont uniformes et le sociogramme est une bouillie |
| **Résolution d'une interaction** | Compatibilité issue des traits + contexte + hasard → issue (chaleureuse, ordinaire, froide, dispute) → deltas sur les axes | Les axes ne bougent jamais |
| **Liens structurels** | Déduire foyer, voisin, collègue de l'état du monde | Aucune relation de départ : tout le monde est étranger à tout le monde, y compris sous le même toit |
| **Rétroaction sur la décision** | Une considération « qui est là ? » dans l'IA d'utilité | Les habitants ne choisiront jamais d'aller là où sont leurs amis |
| **Mesure** | Coefficient de regroupement du graphe d'amitié, comparé à un graphe aléatoire de même densité | On ne saura pas si des **groupes** se sont formés ou si la ville est un brouillard tiède. C'est le seul test qui distingue les deux |

### 9.3 Comment chaque phénomène demandé émergerait

Aucun ne demande d'être écrit comme tel — c'est le principe du §10 du cahier
des charges — mais chacun demande que les pièces ci-dessus existent.

- **connaissance** — familiarité qui monte avec les rencontres répétées, donc
  avec la co-présence, donc avec les routines : deux personnes aux horaires
  compatibles finissent par se connaître sans que rien ne le décide ;
- **amitié** — affection et familiarité au-dessus d'un seuil, entretenues ;
  une amitié qu'on ne voit plus s'éteint par décroissance ;
- **amour** — l'axe `attirance` existe déjà ; il lui faut compatibilité d'âge,
  d'orientation et de disponibilité, puis un **engagement** qui est un état
  coûteux à quitter, pas un seuil franchi ;
- **famille** — c'est un lien structurel, pas un sentiment : à poser dans
  l'état du monde (parenté), les sentiments se construisant par-dessus ;
- **rivalité, conflit** — la tension monte par disputes et retombe avec le
  temps ; la qualification bascule toute seule ;
- **coopération** — demande des objectifs partagés, donc les aspirations, qui
  n'existent pas encore ;
- **influence** — demande la mémoire et la circulation de l'information : on
  n'influence que par ce qu'on fait savoir ;
- **réputation** — n'est pas un champ. C'est l'agrégat de ce que les autres
  croient de quelqu'un, donc **impossible avant le système de croyances** ;
- **groupes** — émergent du choix de l'interlocuteur, et se mesurent par le
  coefficient de regroupement. Ils ne doivent jamais être déclarés.

### 9.4 Faut-il changer l'architecture ?

Non. Brancher les relations demande d'ajouter une collection à `Monde`, un
moteur dans `moteurs/relations/`, un point d'appel dans la boucle et une
considération dans le catalogue. Rien à réécrire — **à condition d'ajouter la
collection à `Monde` avant, et pas après.**

---

## 10. Générations : la chaîne complète

L'enchaînement voulu est : individu → vieillissement → relations → famille →
enfants → transmission → mort → descendants, **sans jamais réinitialiser le
monde**.

| Maillon | État | Ce qu'il exige |
|---|:--:|---|
| Individu | **A** | — |
| Vieillissement | **C** | Que l'âge agisse : sur le corps, la santé, les besoins, les capacités. Aujourd'hui `age()` est un affichage |
| Relations | **C** | §9 |
| Famille | **D** | La parenté dans l'état du monde, et des foyers qui soient des entités et non une adresse partagée |
| Enfants | **D** | Couple, conception, grossesse, naissance — et un enfant est un **nouveau personnage**, donc un monde dont la population change en cours de route |
| Transmission | **D** | Hérédité des traits (moyenne parentale + bruit + régression vers la moyenne), de l'apparence, du patrimoine, de la réputation ; une entité `Lignée` pour porter ce qui survit aux individus |
| Mort | **D** | Et surtout : un **registre des défunts**. Un mort ne disparaît pas, il devient un ancêtre. Sans registre, la filiation se casse à la première génération |
| Descendants | **D** | — |

### 10.1 Les trois pièges connus

1. **La population fermée.** Soixante personnes simulées sur soixante ans font
   l'une de deux choses : s'éteindre ou exploser. Il faut un régulateur
   démographique — emménagements et départs — qui absorbe l'écart. C'est
   documenté au doc 1 et rien n'est écrit.
2. **Le coût qui croît avec le temps, pas avec la population.** Les morts, les
   souvenirs et les épisodes s'accumulent sur des décennies. Tout ce qui
   n'a pas de plafond dur devient le poste dominant à la troisième génération.
3. **Le monde qui doit changer de taille en marche.** Aujourd'hui la
   population est fixée à la génération et la boucle suppose une `Map` stable.
   Naître et mourir en cours de simulation demande que l'itération supporte
   les ajouts et les retraits — un détail qui casse silencieusement si on n'y
   pense pas au moment d'écrire la boucle.

---

## 11. Architecture en couches

La règle qui gouverne tout : **la simulation doit tourner rendu éteint.** Elle
est tenue aujourd'hui et ne doit jamais être perdue.

```
  L1  TEMPS          tick, calendrier, vitesses, échelles, aléa, empreinte
  L2  INDIVIDUS      identité, corps, traits, apparence, âge
  L3  BESOINS        dérive, actions, utilité, décision, aspirations
  L4  DÉPLACEMENTS   position, trajet, cheminement
  L5  LIEUX          bâtiments, pièces, objets, capacités, horaires
  L6  RELATIONS      axes, épisodes, interactions, groupes
  L7  ÉVÉNEMENTS     bus, règles émergentes, chronique causale
  L8  GÉNÉRATIONS    couple, naissance, hérédité, mort, lignées
  L9  INSTITUTIONS   postes, économie, école, réputation, pouvoir
 ─────────────────────────────────────────────────────────────────
  L10 REPRÉSENTATION caméra, rendu, sprites, interface
```

Une couche ne connaît que celles au-dessus d'elle. L10 est **détachable** : on
doit pouvoir la supprimer et voir le monde continuer.

### 11.1 Où en est chaque couche

| Couche | Écrit | Branché | Manque |
|---|:--:|:--:|---|
| L1 Temps | 100 % | ~40 % | Boucle temps réel, échelles en service, seaux par créneau |
| L2 Individus | ~50 % | oui | Apparence, corps, santé, effets de l'âge |
| L3 Besoins | ~80 % | oui | Humeur, émotions, aspirations, habitudes mémorisées |
| L4 Déplacements | ~20 % | oui | Position dans le lieu, pièces, vraie carte, cheminement |
| L5 Lieux | ~30 % | oui | Pièces, objets, organisations, croissance avec la population |
| L6 Relations | ~35 % | **0 %** | Tout sauf le modèle |
| L7 Événements | ~30 % | **0 %** | Règles, chronique, branchement du bus |
| L8 Générations | 0 % | — | Tout |
| L9 Institutions | 0 % | — | Tout |
| L10 Représentation | ~25 % | oui | Caméra, direct au lieu du rejeu, sprites, poses, intérieurs |

### 11.2 Les deux frontières à ne jamais franchir

1. **L10 ne lit jamais l'état du monde directement.** Aujourd'hui `vue/`
   importe `etat/` et `boucle/` — acceptable tant que c'est un outil de
   construction hors ligne, **inacceptable dès que la vue sera en direct**.
   C'est là que la « lentille » du doc 2 devra s'intercaler, et c'est aussi ce
   qui rendra possibles les secrets du §26 : le joueur ne doit voir que ce que
   son personnage sait.
2. **L1 à L9 n'importent jamais rien de L10.** Tenu aujourd'hui, vérifié par
   l'environnement de test `node` : le jour où quelqu'un importe le DOM dans
   la simulation, les tests tombent.

---

## 12. Ordre de construction

Classé par **dépendances techniques**, comme demandé — pas par facilité, pas
par priorité arbitraire. La question à chaque étape est : *que devrait-on
réécrire si on faisait autre chose d'abord ?*

### 12.1 À consolider maintenant — sinon tout le reste sera à reprendre

Ces quatre chantiers ne produisent presque rien de visible. C'est exactement
pour cela qu'ils passent en premier : chacun est une **structure d'accueil**,
et tout ce qu'on construit avant elle devra être recâblé.

1. **Étendre `Monde`.** Ajouter les collections que le doc 2 décrit et que le
   code n'a pas : `relations`, `foyers`, `organisations`, `postes`,
   `defunts`, `faits`, `chronique`. Vides au départ. Tout système ajouté
   avant devra être rebranché après.
2. **Brancher le bus d'événements dans la boucle.** C'est la colonne
   vertébrale des chaînes de conséquences du §18. Chaque système écrit sans
   lui devra être recâblé pour publier ses événements — c'est la dette la
   plus mécanique et la plus prévisible du projet.
3. **Mettre les échelles en service**, et écrire la boucle temps réel qui
   consomme `ticksDus`. Sans elles, aucune mesure de performance au-delà du
   banc d'essai n'a de sens, et on optimisera à l'aveugle.
4. **Faire croître le monde avec la population** : institutions en nombre
   proportionnel, et surtout **postes finis**. C'est double : sans rareté,
   l'échec du §30 est impossible ; et sans monde qui grandit, toute mesure
   au-delà de 200 habitants mesure une pénurie et non un moteur.

À poser dans le même temps, parce que le coût d'ajout croît vite avec le
nombre d'appelants : **la position en `{ lieu, piece, x, y }`** (§5.1) et
**l'`Apparence` dans l'état** (§3.1). Deux champs, aujourd'hui une demi-journée
chacun, plus tard une réécriture transversale.

### 12.2 Ensuite — dans cet ordre, parce qu'ils se conditionnent

5. **Relations.** Le modèle existe ; il manque le stockage, le choix de
   l'interlocuteur, la résolution d'interaction, les liens structurels et la
   mesure de regroupement. C'est le système qui change le plus la nature du
   jeu pour le moins de code, et presque tout ce qui suit en dépend.
6. **Caméra et rendu en direct.** À faire **après** les relations et non
   avant : c'est en observant des habitants qui se connaissent qu'on saura
   quoi montrer. Mais à faire **avant** le reste du visuel, parce que zoom,
   déplacement et désignation inverse sont structurants et que les ajouter
   après oblige à reprendre chaque fonction de dessin.
7. **Mémoire et connaissance.** Faits, croyances, sources, dégradation. Le
   doc 3 le dit et je le maintiens : c'est le système qu'on ne peut pas
   ajouter après coup à un jeu qui suppose partout que tout le monde sait
   tout.

### 12.3 Ce qui dépend d'autres systèmes — à ne pas attaquer avant

| Système | Dépend de |
|---|---|
| Réputation | Mémoire + croyances (§7 ci-dessus). C'est un agrégat, pas un champ |
| Rumeurs, secrets | Mémoire + relations |
| Groupes sociaux | Relations + mesure de regroupement |
| Économie réelle (loyers, dettes, classes) | Foyers + postes finis |
| Vieillissement effectif | Corps et santé dans L2 |
| Famille, naissances, mort | Relations + vieillissement + foyers |
| Générations, transmission | Tout ce qui précède, plus le registre des défunts |
| Institutions, pouvoir | Organisations + économie + réputation |
| Personnages détaillés, animations | `Apparence` dans l'état + atlas de sprites + caméra |
| Intérieurs visibles | `Piece` dans l'état + caméra |

### 12.4 Ce qui peut attendre sans rien bloquer

Météo · circulation et véhicules · diversité architecturale poussée ·
quartiers différenciés · mobilier urbain étendu · sons · voyages (§15 du
cahier des charges) · capacités rares (§23).

Aucun de ces éléments n'est une fondation. Chacun s'ajoute plus tard sans
obliger à reprendre quoi que ce soit.

### 12.5 Ce qui serait prématuré aujourd'hui

- **Les intérieurs détaillés** — tant que rien ne se passe à l'intérieur qui
  mérite d'être regardé. Poser `Piece` maintenant : oui. Dessiner des
  appartements meublés : non.
- **Les animations de marche** — tant que les personnages n'ont pas
  d'apparence dans l'état, le cycle serait à refaire.
- **Les classes sociales et le pouvoir** — ce sont des **grandeurs dérivées**.
  Les implémenter avant l'économie et la réputation produirait des étiquettes,
  c'est-à-dire exactement ce que le §11 du cahier des charges interdit.
- **Le personnage joueur** — le monde n'a pas encore assez de matière pour
  qu'y vivre veuille dire quelque chose. Un joueur dans un monde sans
  relations ni mémoire ne joue à rien.
- **Optimiser** — les points chauds du §8.3 sont identifiés et aucun ne fait
  mal aujourd'hui. Les traiter maintenant, c'est optimiser un moteur qu'on
  n'a pas fini d'écrire.

---

## 13. Ce que cet audit ne fait pas

Aucune ligne de code n'a été modifiée pour le produire. Les mesures ont été
obtenues en lançant le banc d'essai existant avec des populations différentes.

La carte est faite. Le territoire est plus petit que ce que les documents de
conception laissaient croire — trois systèmes sur vingt-sept fonctionnent
pleinement, et cinq modules du noyau sont testés sans être branchés. En
revanche, ce qui tourne tourne juste, c'est mesuré, et rien de ce qui est
écrit ne semble devoir être jeté.
