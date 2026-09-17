/**
 * Le catalogue d'actions.
 *
 * C'est le vocabulaire comportemental du jeu : tout ce qu'un habitant sait
 * faire, joueur compris. Il n'y a pas de branche « IA » séparée d'une branche
 * « joueur » — le personnage du joueur utilise ce catalogue quand il est en
 * mode intention, ce qui garantit qu'il se comporte comme un habitant et pas
 * comme un automate à part.
 *
 * Aucune action ne contient de condition impérative. Une action déclare des
 * CONSIDÉRATIONS — des courbes sur l'état du monde — et l'utilité fait le
 * reste. C'est la différence entre « à 7 h, aller travailler » (un emploi du
 * temps, qui ne se brise jamais) et « travailler compte d'autant plus qu'on
 * est aux heures de bureau » (une pression, qui peut perdre contre une
 * rencontre — et c'est exactement le scénario du §13 du cahier des charges).
 */

import type { Monde } from '../../etat/monde.ts';
import type { Besoin, Personnage } from '../../etat/personnage.ts';
import { besoin, traitNormalise } from '../../etat/personnage.ts';
import type { TypeLieu } from '../../etat/lieu.ts';
import {
  clocheHoraire,
  constante,
  fenetreNuit,
  inverse,
  lineaire,
  prevoyance,
  racine,
  seuil,
  urgence,
} from './courbes.ts';

export interface Contexte {
  monde: Monde;
  perso: Personnage;
  /** Heure décimale : 13,5 = 13 h 30. */
  heure: number;
  /** Nombre d'habitants présents dans le même lieu, soi non compris. */
  presents: number;
  /** Le lieu courant permet-il cette action sans se déplacer ? */
  surPlace: boolean;
  /** Un lieu du bon type est-il accessible et ouvert ? */
  accessible: boolean;
  /**
   * Argent mobilisable par le FOYER, pas par l'individu.
   *
   * La distinction n'est pas un détail. Tant que la considération « puis-je me
   * le permettre » regardait le seul porte-monnaie personnel, les vingt-trois
   * lycéens du monde d'essai — qui n'ont aucun revenu propre — voyaient
   * l'action « faire des courses » annulée avant même d'être tentée, et
   * restaient saturés en provisions cent pour cent du temps. Leur foyer, lui,
   * avait de quoi. Ce qu'on croit pouvoir faire doit correspondre à ce qu'on
   * peut réellement payer.
   */
  argentFoyer: number;
}

export type Consideration = (ctx: Contexte) => number;

export interface Action {
  id: string;
  libelle: string;
  /** Types de lieux où l'action est possible. Vide = n'importe où. */
  lieux: readonly TypeLieu[];
  /** Durée en ticks de cinq minutes. */
  duree: number;
  /** Coût en argent, payé au début. */
  cout: number;
  /** Effet sur les besoins, PAR TICK d'exécution. Négatif = soulage. */
  effets: Partial<Record<Besoin, number>>;
  /** L'action compte-t-elle comme une interaction sociale ? */
  sociale: boolean;
  considerations: readonly Consideration[];
}

// --- Considérations réutilisables -------------------------------------------

const pression = (b: Besoin, forme: (x: number) => number): Consideration =>
  (ctx) => forme(besoin(ctx.perso, b) / 1000);

const creneau = (centre: number, largeur: number): Consideration =>
  (ctx) => clocheHoraire(ctx.heure, centre, largeur);

/** Un déplacement n'interdit rien, il coûte : l'action sur place est préférée. */
const proximite: Consideration = (ctx) =>
  ctx.surPlace ? 1 : ctx.accessible ? 0.55 : 0;

const quelquUnIci: Consideration = (ctx) => (ctx.presents === 0 ? 0 : racine(ctx.presents / 4));

const argentDisponible = (montant: number): Consideration =>
  (ctx) => (montant <= 0 ? 1 : seuil(ctx.argentFoyer / (montant * 4), 0.5, 8));

/**
 * Être à son poste, à ses heures.
 *
 * Le type d'occupation est vérifié, et ce n'est pas une précaution
 * théorique : sans lui, la considération ne regardait que les horaires, et
 * une lycéenne dont les cours vont de 8 h à 16 h trouvait « travailler »
 * aussi désirable qu'« étudier ». Elle passait un cinquième de ses journées
 * au bureau. Le banc d'essai l'a attrapé en une inspection ; aucun test
 * agrégé ne l'aurait vu, parce que la moyenne des heures travaillées restait
 * parfaitement plausible.
 */
const aSonPoste = (type: 'emploi' | 'etudes'): Consideration => (ctx) => {
  const o = ctx.perso.occupation;
  if (o.type !== type) return 0;
  return ctx.heure >= o.debutH && ctx.heure < o.finH ? 1 : 0.02;
};

const traitDe = (
  nom: Parameters<typeof traitNormalise>[1],
  poids = 1,
): Consideration =>
  (ctx) => 1 - poids + poids * traitNormalise(ctx.perso, nom);

// --- Le catalogue ------------------------------------------------------------

export const CATALOGUE: readonly Action[] = [
  {
    id: 'dormir',
    libelle: 'dormir',
    lieux: ['logement'],
    duree: 96,
    cout: 0,
    effets: { energie: -14, hygiene: 0.4, faim: 1.5 },
    sociale: false,
    // Créneau resserré autour de 1 h 30. À largeur 5, la cloche valait encore
    // 0,49 à 20 h et 0,73 à 22 h : les habitants se couchaient en début de
    // soirée, se réveillaient à 3 h, et dormaient une seconde fois l'après-midi
    // — onze heures quarante de sommeil par jour. Une action longue a besoin
    // d'une fenêtre étroite, sinon elle dévore la journée.
    considerations: [pression('energie', urgence), (ctx) => fenetreNuit(ctx.heure), proximite],
  },
  {
    id: 'sieste',
    libelle: 'faire une sieste',
    lieux: ['logement'],
    duree: 12,
    cout: 0,
    effets: { energie: -9 },
    sociale: false,
    // Seuil bien plus haut que celui du sommeil : une sieste est ce qu'on
    // fait quand on n'en peut plus, pas une seconde nuit. Avec la même courbe
    // d'urgence que « dormir », elle récupérait deux heures et demie par jour
    // et vidait les après-midi.
    considerations: [
      (ctx) => seuil(besoin(ctx.perso, 'energie') / 1000, 0.86, 18),
      // Une sieste est ce qu'on fait le jour : la nuit, on dort.
      (ctx) => 0.3 * (1 - fenetreNuit(ctx.heure)),
      proximite,
    ],
  },
  {
    id: 'manger_chez_soi',
    libelle: 'manger chez soi',
    lieux: ['logement'],
    duree: 6,
    // GRATUIT, et c'est un choix de modèle, pas un oubli. Manger chez soi
    // puise dans les provisions, et ce sont les courses qui les paient. Le
    // banc d'essai a rendu la question concrète : tant que le repas coûtait
    // quatre euros, les enfants et les habitants sans revenu ne pouvaient
    // littéralement pas manger, et vivaient affamés en permanence. Un jeu où
    // la pauvreté empêche de se nourrir chez soi n'est pas plus dur, il est
    // faux.
    cout: 0,
    effets: { faim: -150, plaisir: -8 },
    sociale: false,
    considerations: [
      pression('faim', urgence),
      (ctx) => Math.max(creneau(8, 1.4)(ctx), creneau(12.5, 1.4)(ctx), creneau(19.5, 1.6)(ctx), 0.3),
      proximite,
    ],
  },
  {
    id: 'manger_dehors',
    libelle: 'manger au café',
    lieux: ['cafe'],
    duree: 9,
    cout: 14,
    effets: { faim: -95, plaisir: -22, social: -18 },
    sociale: true,
    considerations: [
      pression('faim', urgence),
      (ctx) => Math.max(creneau(12.5, 1.2)(ctx), creneau(19.5, 1.4)(ctx), 0.1),
      proximite,
      argentDisponible(14),
      traitDe('ouverture', 0.5),
    ],
  },
  {
    id: 'manger_sur_le_pouce',
    libelle: 'manger sur le pouce',
    // Nulle part en particulier : c'est tout l'intérêt. Sans cette action, un
    // habitant au bureau ne pouvait déjeuner qu'en rentrant chez lui ou en
    // payant le café, donc ne déjeunait pas — et la faim restait au-dessus du
    // seuil critique un tiers du temps.
    lieux: [],
    duree: 4,
    cout: 5,
    effets: { faim: -145, plaisir: -5 },
    sociale: false,
    considerations: [
      pression('faim', urgence),
      (ctx) => Math.max(creneau(12.5, 1.8)(ctx), 0.12),
      argentDisponible(5),
    ],
  },
  {
    id: 'se_laver',
    libelle: 'se laver',
    lieux: ['logement'],
    duree: 3,
    cout: 0,
    effets: { hygiene: -280 },
    sociale: false,
    considerations: [pression('hygiene', urgence), proximite],
  },
  {
    id: 'travailler',
    libelle: 'travailler',
    lieux: ['bureau'],
    duree: 24,
    cout: 0,
    effets: { accomplissement: -28, energie: 1.5, faim: 1.2, social: -4 },
    sociale: false,
    considerations: [
      aSonPoste('emploi'),
      proximite,
      // Même épuisé, on va travailler — mais pas à n'importe quel prix.
      (ctx) => inverse(Math.max(0, besoin(ctx.perso, 'energie') - 820) / 180),
      traitDe('discipline', 0.35),
    ],
  },
  {
    id: 'etudier',
    libelle: 'étudier',
    lieux: ['ecole'],
    duree: 24,
    cout: 0,
    effets: { accomplissement: -24, energie: 1.2, faim: 1.2, social: -12 },
    sociale: false,
    considerations: [
      aSonPoste('etudes'),
      proximite,
      (ctx) => inverse(Math.max(0, besoin(ctx.perso, 'energie') - 820) / 180),
      traitDe('discipline', 0.35),
    ],
  },
  {
    id: 'discuter',
    libelle: 'discuter',
    lieux: [],
    duree: 6,
    cout: 0,
    effets: { social: -110, plaisir: -18 },
    sociale: true,
    considerations: [pression('social', racine), quelquUnIci, traitDe('sociabilite', 0.7)],
  },
  {
    id: 'sortir_boire',
    libelle: 'sortir au café',
    lieux: ['cafe'],
    duree: 18,
    cout: 11,
    effets: { social: -70, plaisir: -45, energie: 5 },
    sociale: true,
    considerations: [
      pression('social', racine),
      creneau(20, 3.5),
      proximite,
      argentDisponible(11),
      traitDe('sociabilite', 0.6),
    ],
  },
  {
    id: 'faire_du_sport',
    libelle: 'faire du sport',
    lieux: ['gymnase', 'parc'],
    duree: 12,
    cout: 2,
    effets: { plaisir: -28, accomplissement: -16, hygiene: 30, energie: 4, faim: 3 },
    sociale: false,
    considerations: [
      pression('accomplissement', racine),
      (ctx) => inverse(besoin(ctx.perso, 'energie') / 900),
      proximite,
      traitDe('discipline', 0.8),
    ],
  },
  {
    id: 'se_promener',
    libelle: 'se promener',
    lieux: ['parc', 'rue'],
    duree: 9,
    cout: 0,
    effets: { plaisir: -22, energie: 2.5 },
    sociale: false,
    considerations: [
      pression('plaisir', lineaire),
      creneau(15, 6),
      proximite,
      traitDe('curiosite', 0.5),
    ],
  },
  {
    id: 'faire_courses',
    libelle: 'faire des courses',
    lieux: ['commerce'],
    duree: 6,
    cout: 19,
    effets: { securite: -420, energie: 1.5 },
    sociale: false,
    considerations: [
      pression('securite', prevoyance),
      proximite,
      argentDisponible(19),
      creneau(15, 5),
    ],
  },
  {
    id: 'se_detendre',
    libelle: 'se détendre chez soi',
    lieux: ['logement'],
    duree: 9,
    cout: 0,
    effets: { plaisir: -32, energie: -1.5 },
    sociale: false,
    considerations: [
      pression('plaisir', lineaire),
      // La soirée est le moment naturel du temps pour soi. Sans ce créneau,
      // le vide de fin de journée était comblé par des siestes.
      (ctx) => Math.max(creneau(20.5, 3)(ctx), 0.35),
      proximite,
      traitDe('independance', 0.4),
    ],
  },
  {
    id: 'flaner',
    libelle: 'ne rien faire de particulier',
    lieux: [],
    duree: 3,
    cout: 0,
    effets: {},
    sociale: false,
    // Utilité faible mais jamais nulle : il existe toujours au moins une
    // option. Sans ce filet, un personnage sans argent, épuisé et enfermé
    // resterait bloqué sans activité, et la boucle tournerait à vide.
    considerations: [() => constante(0.08)],
  },
];

export const PAR_ID = new Map<string, Action>(CATALOGUE.map((a) => [a.id, a]));

export function action(id: string): Action | undefined {
  return PAR_ID.get(id);
}
