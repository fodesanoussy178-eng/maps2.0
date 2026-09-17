# 2. Architecture technique

Le principe directeur : **la simulation est une fonction pure du temps et des
entrées du joueur.** Tout le reste — rendu, interface, sons — est une lecture
de cet état. Cette asymétrie est ce qui rend le jeu testable sans navigateur,
accélérable à ×500, sauvegardable en un fichier et déboguable par rejeu.

---

## 2.1 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│  COUCHE PRÉSENTATION        (navigateur, React, canvas)      │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │
│  │ Rendu 2D   │  │ Interface  │  │ Entrées joueur         │  │
│  │ (canvas)   │  │ (React)    │  │ (clics, intentions)    │  │
│  └─────┬──────┘  └─────┬──────┘  └───────────┬────────────┘  │
└────────┼───────────────┼────────────────────┼────────────────┘
         │ lecture       │ lecture            │ écriture
         │               │                    │
┌────────▼───────────────▼────────────────────▼────────────────┐
│  LENTILLE  — seule voie d'accès de l'interface au monde       │
│  Ne répond qu'à partir des croyances du personnage joueur.    │
└────────┬──────────────────────────────────────────────────────┘
         │
┌────────▼──────────────────────────────────────────────────────┐
│  MOTEURS  (TypeScript pur, aucune dépendance navigateur)      │
│                                                                │
│   Personnage · Relations · Connaissance · Monde               │
│   Économie   · Vie       · Voyage       · Événements          │
└────────┬──────────────────────────────────────────────────────┘
         │
┌────────▼──────────────────────────────────────────────────────┐
│  NOYAU  — temps, aléa, bus d'événements, échelles, invariants │
│  Ne connaît aucune règle de jeu. Ne change presque jamais.    │
└────────┬──────────────────────────────────────────────────────┘
         │
┌────────▼──────────────────────────────────────────────────────┐
│  ÉTAT DU MONDE  — données pures, sérialisables, sans méthodes │
└────────────────────────────────────────────────────────────────┘
```

Une flèche ne remonte jamais. Le noyau ignore les moteurs, les moteurs
ignorent la lentille, la lentille ignore le rendu. C'est ce qui permet de
changer un moteur sans casser les autres (§38).

---

## 2.2 L'état du monde

**Règle absolue : l'état du monde est constitué de données, jamais d'objets à
comportement.** Pas de classe, pas de méthode, pas de référence croisée — que
des identifiants. Trois conséquences gratuites : la sauvegarde est un
`JSON.stringify`, le rejeu déterministe est possible, et aucun système ne peut
dissimuler une dépendance dans un pointeur.

```ts
interface Monde {
  graine: number;              // graine racine, fixée à la création
  tick: number;                // temps simulé, en pas de 5 minutes
  personnages: Map<PersoId, Personnage>;
  defunts:     Map<PersoId, Defunt>;        // état réduit, conservé pour toujours
  relations:   Map<ClefRelation, Relation>; // dirigée : "a→b"
  faits:       Map<FaitId, Fait>;           // la vérité du monde
  croyances:   Map<PersoId, Croyance[]>;    // ce que chacun croit savoir
  lieux:       Map<LieuId, Lieu>;
  cartes:      Map<CarteId, Carte>;
  organisations: Map<OrgId, Organisation>;
  postes:      Map<PosteId, Poste>;         // marché du travail, fini
  logements:   Map<LogementId, Logement>;   // marché du logement, fini
  foyers:      Map<FoyerId, Foyer>;
  lignees:     Map<LigneeId, Lignee>;       // capital familial transmis
  chronique:   Jalon[];                     // graphe causal élagué
  economie:    ParametresEconomiques;
}
```

`Map` plutôt qu'objet : l'ordre d'insertion est garanti par la spécification
ECMAScript, donc l'itération est déterministe — ce qui n'est pas vrai d'un
objet à clés numériques.

### Le personnage

```ts
interface Personnage {
  id: PersoId;
  // Identité
  nom: string; prenom: string; naissance: number; sexe: Sexe;
  // Corps (§4) — entiers, pas de flottants : pas de dérive au rejeu
  corps: { taille: number; poids: number; forme: number; fatigue: number;
           sante: number; blessures: Blessure[]; apparence: Apparence };
  // Personnalité (§4) — 14 traits, -100..100, quasi stables
  traits: number[];
  // Besoins (§13) — 0..1000, dérivent dans le temps. Flottants, et jamais
  // arrondis en cours de simulation : voir §2.6, règle 3.
  besoins: number[];
  // Humeur — moyenne pondérée mobile des émotions récentes
  humeur: { valence: number; energie: number };
  // Situation — invariants stricts (§29)
  lieu: LieuId; carte: CarteId; x: number; y: number;
  etat: EtatPersonnage;         // UN SEUL à la fois : au travail | chez soi | en voyage | ...
  posteId: PosteId | null; logementId: LogementId | null; foyerId: FoyerId;
  // Économie (§11)
  argent: number; epargne: number; dette: number;
  // Trajectoire (§9, §10)
  competences: Map<CompetenceId, number>;
  aspiration: Aspiration | null;
  // Mémoire (§7)
  memoireCourte: Episode[];     // tampon circulaire, 24 entrées
  memoireLongue: Episode[];     // plafonné à 60, éviction par importance
  // Simulation
  echelle: Echelle;             // micro | meso | macro | dormant | absent
  derniereMaj: number;          // tick du dernier calcul : permet le rattrapage paresseux
}
```

Les traits (§4) ne sont **jamais** affichés comme des nombres et n'ajoutent
**jamais** de bonus direct. Ils entrent uniquement dans les courbes de
réponse de l'IA d'utilité (§2.5). Une personne sociable ne gagne pas « +10 en
sociabilité » : la valeur d'utilité de l'action « aborder quelqu'un » monte,
celle de « rester seul » descend, et son besoin social se dégrade plus vite
quand elle est isolée. Le comportement est la seule manifestation du trait.

---

## 2.3 Le noyau

Quatre modules, aucune règle de jeu. Ils constituent la phase 0 et ne
devraient pratiquement plus changer ensuite.

### Aléa déterministe (`noyau/alea.ts`)

`Math.random` est interdit dans tout `jeu/noyau` et `jeu/moteurs`. On utilise
un générateur **PCG-XSH-RR 32 bits** — rapide, de bonne qualité statistique,
tenant en deux entiers 32 bits, donc sérialisable.

Le point important est le **flux nommé**. Plutôt qu'un générateur global dont
l'état dépendrait de l'ordre d'appel de tous les systèmes, chaque tirage se
fait dans un flux dérivé :

```ts
const r = alea(monde.graine, 'decision', persoId, monde.tick);
```

La graine effective est le hachage de (graine racine, nom du flux, entité,
tick). Deux conséquences majeures :

- ajouter un système qui consomme de l'aléa ne décale pas les tirages des
  autres — les parties restent comparables entre deux versions du code ;
- on peut simuler un personnage seul, hors ordre, pour déboguer, et obtenir
  exactement le même résultat que dans la partie complète.

### Temps (`noyau/temps.ts`)

Une seule unité : le **tick** = 5 minutes de jeu. 288 ticks par jour. Le
calendrier (heure, jour, mois, année, saison) est **calculé** depuis le tick,
jamais stocké : impossible de le désynchroniser.

L'horloge murale ne pilote pas la simulation, elle ne fait que fournir un
budget : à chaque image, on calcule combien de ticks sont dus selon la
vitesse, on borne ce nombre (garde-fou anti-spirale de la mort), et on les
exécute. Une machine lente prend du retard sur le temps réel, jamais sur la
cohérence.

| Vitesse | 1 s réelle vaut | Ticks/s | Mode de contrôle |
|---|---|---|---|
| ×1 | 1 min | 0,2 | incarné |
| ×5 | 5 min | 1 | incarné |
| ×10 | 10 min | 2 | incarné |
| ×50 | 50 min | 10 | intention |
| ×100 | 1 h 40 | 20 | intention |
| ×500 | 8 h 20 | 100 | intention |

### Bus d'événements (`noyau/evenements.ts`)

Le §28 demande une architecture événementielle. Mais un bus naïf (tout le
monde écoute tout le monde, publication récursive) rend l'ordre
d'exécution imprévisible — donc le déterminisme impossible. Le bus retenu :

- **file, pas récursion** : publier un événement l'ajoute en fin de file ; il
  sera traité dans la même passe, après les précédents ;
- **ordre total** : la file est traitée dans l'ordre d'insertion, les
  abonnés dans l'ordre d'abonnement (fixé au démarrage, jamais dynamique) ;
- **profondeur bornée** : une chaîne d'événements en cascade est limitée
  (défaut 8) ; au-delà, le surplus est journalisé comme anomalie plutôt que
  de faire tourner la boucle indéfiniment ;
- **causalité portée** : chaque événement transporte l'identifiant de celui
  qui l'a provoqué. C'est ce qui construit la chronique du §18 gratuitement.

### Échelles de simulation (`noyau/echelles.ts`)

C'est la réponse au §27, et le cœur de la tenue en performance.

| Échelle | Qui | Pas | Ce qui est calculé |
|---|---|---|---|
| `micro` | joueur + présents dans la scène (≤ 12) | 1 tick (5 min) | déplacement, animation, interactions fines |
| `meso` | cercle social + même quartier (≈ 40) | 12 ticks (1 h) | décisions, besoins, relations |
| `macro` | reste de la ville (≈ 50) | 288 ticks (1 j) | une journée repliée en quelques deltas |
| `dormant` | très âgés, reclus, hors jeu | 2016 ticks (1 sem.) | dérive lente, événements de vie |
| `absent` | en voyage | — | rien ici ; le moteur de voyage s'en charge |

Deux mécanismes rendent cela sûr :

**Le rattrapage paresseux.** Un personnage `macro` n'est pas calculé chaque
tick : il porte `derniereMaj`. Dès que quelque chose le concerne — le joueur
lui parle, il est promu `meso`, un événement le vise — on replie d'abord le
temps écoulé depuis `derniereMaj`, puis on traite la demande. Aucun calcul
n'est jamais fait « au cas où ».

**Le budget tournant.** Pour éviter que 50 personnages `macro` soient tous
calculés au même tick, chacun est affecté à un créneau déterministe
(`id % 288`). Le coût est étalé et parfaitement plat.

**Budget réel au pire cas (×500, 100 habitants)** : ≈ 400 mises à jour
d'agent par seconde, chacune valant ~120 opérations d'évaluation, soit
~50 000 opérations par seconde. Trois ordres de grandeur sous la capacité
d'un navigateur. La contrainte du §27 est tenue par construction, pas par
optimisation.

---

## 2.4 Les moteurs

### Moteur Personnage — besoins, traits, décisions

Le cœur décisionnel est une **IA d'utilité**, choisie plutôt qu'un arbre de
comportement (trop rigide, scripté par nature) ou un GOAP (trop coûteux, et
produit des agents trop rationnels pour être crédibles).

Chaque action déclare ses *considérations* — des courbes de réponse sur l'état
du monde :

```ts
const Manger: Action = {
  id: 'manger',
  considerations: [
    courbe.besoin('faim', 'quadratique'),      // plus j'ai faim, plus ça compte
    courbe.dispo('nourriture'),                 // y a-t-il de quoi manger ici ?
    courbe.horaire([7, 12, 19], 2),             // aux heures de repas
    courbe.trait('discipline', 'faible'),       // un indiscipliné grignote plus
  ],
  cout: { temps: 6, argent: ctx => ctx.lieu.type === 'restaurant' ? 15 : 3 },
};
```

Le score est le **produit** des considérations, avec compensation pour ne pas
pénaliser mécaniquement les actions à nombreux critères. Puis le choix se fait
par tirage pondéré sur les meilleures, avec une **température** pilotée par le
trait `impulsivite` : un personnage prudent choisit presque toujours la
meilleure option, un impulsif s'écarte souvent. C'est exactement la demande
du §22 — pas les mêmes probabilités pour des personnalités différentes — et
cela évite le plus gros défaut du genre : cent habitants qui font tous la même
chose parce qu'ils partagent la même logique.

Les **routines** du §13 ne sont pas un emploi du temps codé en dur : ce sont
des considérations horaires qui rendent certaines actions dominantes à
certaines heures. La routine émerge, donc elle se brise naturellement quand
une occasion est plus forte — c'est le scénario « Paul rate son bus » du §13,
obtenu sans le scripter.

### Moteur Relations

Une relation est **dirigée** et porte cinq axes plutôt qu'un score :

```ts
interface Relation {
  familiarite: number;  // 0..1000 — combien je le connais
  affection: number;    // -1000..1000 — l'apprécié-je
  confiance: number;    // -1000..1000 — puis-je me fier à lui
  respect: number;      // -1000..1000 — l'estimé-je
  attirance: number;    // 0..1000 — attirance romantique
  tension: number;      // 0..1000 — conflit latent non résolu
  lien: LienStructurel; // famille, voisin, collègue : factuel, pas affectif
  engagement: Engagement | null; // couple, mariage : un état, pas un seuil
  episodes: EpisodeId[]; // l'histoire, plafonnée à 12 marquants
}
```

La **qualification** (ami, rival, ennemi, meilleur ami) est *dérivée* de ces
axes à la lecture, jamais stockée. Un « collègue en qui j'ai confiance mais
que je ne respecte pas » existe naturellement, et l'ennemi n'est pas un état
qu'on décrète mais une configuration qu'on atteint.

L'exemple du §6 (Paul, Sarah, Julie) traverse le système sans une ligne de
code spécifique : le mensonge est un fait, sa découverte est un épisode qui
fait chuter `confiance`, la dispute augmente `tension`, le récit de Sarah à
Julie est une transmission de croyance, le changement d'opinion de Julie est
une révision d'axes causée par une croyance, et la découverte par Paul est une
nouvelle transmission. Rien n'est scripté : ce sont quatre systèmes qui se
parlent.

### Moteur Connaissance — les trois niveaux du §26

C'est le système le plus structurant du projet, et celui qu'il ne faut pas
remettre à plus tard : on ne peut pas ajouter les secrets après coup à un jeu
qui suppose partout que tout le monde sait tout.

```
FAIT          ce qui est vrai            monde.faits
CROYANCE      ce que X croit savoir      monde.croyances[X]
LENTILLE      ce que l'écran peut dire   lentille.ts
```

```ts
interface Croyance {
  faitId: FaitId;
  contenu: ContenuFait;   // peut DIVERGER du fait : c'est une rumeur ou une erreur
  certitude: number;      // 0..1000
  precision: number;      // 0..1000 — se dégrade (§7)
  source: { type: 'vu' | 'vecu' | 'entendu' | 'raconte' | 'deduit'; par: PersoId | null };
  acquisA: number;
}
```

**Propagation (§8).** Lors d'une conversation, chaque interlocuteur
sélectionne les croyances qu'il partage selon : la saillance du fait, sa
confiance envers l'auditeur, son trait de discrétion, et la relation entre
l'auditeur et le sujet. À chaque transmission, `precision` baisse et le
contenu peut se déformer — d'autant plus que le locuteur exagère (trait) et
que sa propre précision était faible. Les rumeurs, malentendus et
informations fausses du §8 ne sont pas des types spéciaux : ce sont des
croyances dont le contenu a dérivé de leur fait.

**La lentille.** L'interface ne reçoit jamais un `Personnage`. Elle reçoit une
`FicheConnue`, construite depuis les croyances du personnage joueur. Si le
joueur ne sait pas que Paul a un secret, la fiche ne contient pas le champ —
pas un champ masqué, **pas de champ du tout**. C'est une frontière de module,
vérifiée par une règle de lint : rien sous `jeu/interface` ne peut importer
`jeu/moteurs` ni `jeu/etat`.

### Moteur Monde — carte, bâtiments, objets

Grille de tuiles orthogonale, vue de dessus légèrement plongeante. Chaque
intérieur est une **carte** distincte reliée par des **portails** (portes).
Cela évite le coût d'un monde unique gigantesque, permet de ne charger et
n'animer que la carte active, et rend l'authoring des intérieurs simple.

Le déplacement affiché n'existe qu'à l'échelle `micro` : A* sur la grille de
la carte active. Partout ailleurs, un déplacement est un fait logique avec
une heure d'arrivée — un personnage `macro` n'a pas de coordonnées à mettre à
jour, il a un lieu et une heure.

> **Direction artistique — tranché le 17/09/2026 : vue de dessus 3/4
> orthogonale.** Le §41 cite Pocket City 2, qui est isométrique ; l'isométrie
> est écartée parce qu'elle double le coût des décors, complique les
> intérieurs, l'occlusion et le ciblage à la souris, pour un gain de
> lisibilité nul sur un jeu dont l'essentiel est social. Le jeu doit de toute
> façon avoir son identité propre (§41). Le rendu restant derrière une
> interface, un passage à l'isométrie plus tard ne toucherait qu'un module.

### Moteur Économie

Une économie réaliste sans être un jeu de gestion : des flux mensuels par
foyer (revenus − loyer − charges − alimentation = épargne ou dette), un
**nombre fini de postes** et de **logements**. La rareté est ce qui rend
l'échec possible sans tricher (§30) et crée la rivalité sans la scripter.

Les classes sociales du §11 ne sont pas des étiquettes : c'est un quantile
calculé à la lecture sur (patrimoine, revenu, prestige du poste, densité du
réseau). Un personnage « monte » quand ses quatre composantes bougent, pas
quand un champ change de valeur.

### Moteur Vie

Vieillissement, santé, fécondité, mort. L'hérédité combine les traits
parentaux avec un bruit et une régression vers la moyenne : les enfants
ressemblent à leurs parents sans en être des copies (§19). La **lignée**
porte le capital transmissible du §20 — patrimoine, réputation, réseau,
habitudes, histoires familiales (des croyances transmises, donc déjà
déformées à la génération suivante).

### Moteur Voyage

Le §15 est clair et j'y souscris : rien de permanent hors de la ville. Un
voyage est simulé en **segments** (une semaine ou un mois). Chaque segment
tire dans une table pondérée par la destination, l'argent, les traits, l'âge,
les objectifs, les contacts — et produit des deltas, des épisodes, et parfois
des personnages *distants* (état minimal, promus en habitants réels seulement
s'ils viennent s'installer). Pendant ce temps, la ville tourne à l'échelle
`macro` ou, pour une absence longue, à un pas hebdomadaire.

Le résumé de retour du §17 n'est pas rédigé à l'avance : il est composé depuis
les épisodes réellement produits et leurs causes. Et la table de segments
contient autant de résultats mauvais que bons — solitude, dépense sèche,
ennui, conflit — parce qu'un voyage toujours enrichissant serait une
récompense déguisée (§30).

### Moteur Événements

Pas de générateur aléatoire d'événements. Un événement émergent est une
**règle conditionnelle** : des prérequis sur l'état du monde, un poids modulé
par le contexte, un effet qui passe par les transactions. Cela garantit la
demande du §21 — des événements compatibles avec le contexte, pas de hasard
absurde. Un accident de voiture suppose une voiture ; une ouverture
d'entreprise suppose un local vacant et quelqu'un qui a l'argent et
l'ambition.

---

## 2.5 Cohérence : comment le §29 est tenu

Trois dispositifs, du plus léger au plus contraignant.

1. **Les états exclusifs sont un type somme.** `etat` est un seul champ à une
   seule valeur. Il est impossible d'être au travail et en voyage : ce n'est
   pas une règle à vérifier, c'est une impossibilité d'écriture.

2. **Les transactions.** L'état porteur d'invariants — position, argent,
   emploi, logement, engagement — n'est jamais modifié directement. Il passe
   par des fonctions qui maintiennent les deux côtés :
   `deplacer()`, `transferer()`, `embaucher()`, `emmenager()`, `unir()`,
   `deceder()`. Un `personnage.argent -= 10` isolé est un bug ; la règle de
   lint le signale.

3. **Le vérificateur d'invariants.** `verifierInvariants(monde)` contrôle une
   trentaine de propriétés : la somme d'argent se conserve, un poste occupé a
   exactement un titulaire, un logement a une capacité respectée, une relation
   dirigée a son symétrique, un enfant a des parents plus âgés que lui, un
   défunt n'apparaît nulle part comme actif. Il tourne à chaque tick en
   développement, à chaque jalon en test, jamais en production.

---

## 2.6 Sauvegarde et déterminisme

La sauvegarde est l'état du monde sérialisé, plus la graine, plus le numéro
de version de schéma. Puisque l'état ne contient que des données, il n'y a
rien à reconstruire au chargement.

Le déterminisme est **relatif aux entrées** : même graine + même journal
d'entrées du joueur = même monde, au tick près. Il est garanti par cinq
règles, toutes vérifiables mécaniquement :

1. aucun `Math.random`, aucun `Date.now` sous `jeu/noyau` et `jeu/moteurs` ;
2. aucune itération sur un `Set` ou sur les clés d'un objet dans un chemin
   décisionnel — uniquement des tableaux et des `Map` ;
3. ce qui se COMPTE est entier — l'argent, les identifiants, le temps ; ce qui
   est une PRESSION CONTINUE est flottant, et ne doit jamais être arrondi en
   cours de route (le banc d'essai a montré qu'arrondir un besoin à chaque
   tick fait dériver de 4 % un habitant simulé finement par rapport au même
   habitant simulé par journées repliées : sa vie dépendrait de la distance au
   joueur) ;
4. l'ordre des abonnés au bus est fixé au démarrage ;
5. un test rejoue 30 jours et compare une **empreinte** de l'état final.

C'est la cinquième règle qui compte : les quatre premières sont des
intentions, celle-ci est un test qui tombe.

---

## 2.7 Arborescence

```
jeu/
  noyau/          temps, aléa, bus, échelles, invariants, empreinte
  etat/           types de données du monde + transactions
  moteurs/
    personnage/   besoins, traits, actions, utilité, aspirations
    relations/    axes, épisodes, qualification, interactions
    connaissance/ faits, croyances, propagation, mémoire
    monde/        cartes, lieux, portails, cheminement
    economie/     postes, logements, flux, classes
    vie/          âge, santé, naissance, mort, hérédité, lignées
    voyage/       segments, destinations, résumé
    evenements/   règles émergentes
  lentille/       vérité → ce que le joueur peut savoir
  rendu/          canvas, tuiles, sprites, caméra
  interface/      React : fenêtres, fiches, chronique, contrôles du temps
  contenu/        données de jeu : cartes, prénoms, métiers, actions
  outils/         génération de monde, bancs d'essai, inspecteur
```

**Règle de dépendance**, applicable par lint : une couche n'importe que des
couches situées au-dessus d'elle dans cette liste. `interface` ne peut pas
importer `moteurs`. `moteurs` ne peut pas importer `rendu`. `noyau` n'importe
rien.
