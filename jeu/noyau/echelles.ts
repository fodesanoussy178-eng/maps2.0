/**
 * Les échelles de simulation.
 *
 * C'est la réponse au §27 du cahier des charges, et la raison pour laquelle
 * cent habitants peuvent vivre à ×500 sur une machine modeste.
 *
 * L'idée n'est pas de simuler moins bien les personnages lointains : c'est de
 * les simuler MOINS SOUVENT, avec un pas plus large. Un habitant de l'autre
 * bout du quartier n'a pas besoin qu'on décide de son quart d'heure ; on
 * replie sa journée d'un coup, et le résultat est indiscernable pour le
 * joueur, qui ne le voit pas.
 *
 * Deux mécanismes rendent cela sûr.
 *
 * LE BUDGET TOURNANT — si les cinquante personnages `macro` étaient calculés
 * au même tick, une image sur 288 coûterait cinquante fois le prix des
 * autres, et le jeu saccaderait une fois par jour de jeu. Chacun reçoit donc
 * un créneau fixe, dérivé de son identifiant : la charge est parfaitement
 * plate, et chacun est bien mis à jour une fois par période, ni zéro ni deux.
 *
 * LE RATTRAPAGE PARESSEUX — un personnage qu'on n'a pas calculé depuis trois
 * jours n'est pas en retard : il porte `derniereMaj`. Dès que quelque chose
 * le concerne — le joueur lui parle, il est promu à une échelle plus fine, un
 * événement le vise — on replie d'abord le temps écoulé, puis on traite la
 * demande. Rien n'est jamais calculé « au cas où ».
 */

import { hacher } from './alea.ts';
import { TICKS_PAR_JOUR, TICKS_PAR_HEURE, TICKS_PAR_SEMAINE } from './temps.ts';

export type Echelle = 'micro' | 'meso' | 'macro' | 'dormant' | 'absent';

/** Pas de mise à jour, en ticks. `absent` vaut 0 : personne ne le calcule ici. */
export const PAS: Readonly<Record<Echelle, number>> = {
  micro: 1,
  meso: TICKS_PAR_HEURE,
  macro: TICKS_PAR_JOUR,
  dormant: TICKS_PAR_SEMAINE,
  absent: 0,
};

/** Plafonds de population par échelle. Dépasser dégrade l'échelle des excédents. */
export const PLAFONDS: Readonly<Record<Echelle, number>> = {
  micro: 12,
  meso: 45,
  macro: Number.POSITIVE_INFINITY,
  dormant: Number.POSITIVE_INFINITY,
  absent: Number.POSITIVE_INFINITY,
};

/**
 * Le créneau d'une entité dans sa période. Dérivé par hachage plutôt que par
 * `id % pas` : des identifiants consécutifs donneraient des créneaux
 * consécutifs, et une famille entière — dont les identifiants se suivent —
 * serait calculée dans la même poignée de ticks.
 */
export function creneau(id: number, pas: number): number {
  if (pas <= 1) return 0;
  return hacher('creneau', id) % pas;
}

/** Ce personnage doit-il être mis à jour à ce tick ? */
export function doitMettreAJour(echelle: Echelle, id: number, tick: number): boolean {
  const pas = PAS[echelle];
  if (pas <= 0) return false;
  if (pas === 1) return true;
  return tick % pas === creneau(id, pas);
}

/**
 * Combien de pas replier pour rattraper le retard, et jusqu'à quel tick.
 *
 * Le plafond évite qu'un personnage réveillé après vingt ans d'absence
 * déclenche sept mille replis d'un coup. Au-delà, on saute : un tel retard
 * signifie que le personnage est resté hors de portée du joueur si longtemps
 * que le détail de ces journées n'a aucun effet observable. La dérive lente
 * (âge, argent, santé) est appliquée analytiquement par les moteurs
 * concernés, pas en rejouant les journées une à une.
 */
export const PAS_MAX_RATTRAPAGE = 64;

export interface Rattrapage {
  pas: number;
  saute: number;
  jusqua: number;
}

export function rattrapage(derniereMaj: number, tick: number, echelle: Echelle): Rattrapage {
  const pasEchelle = PAS[echelle];
  if (pasEchelle <= 0 || tick <= derniereMaj) {
    return { pas: 0, saute: 0, jusqua: Math.max(derniereMaj, tick) };
  }
  const du = Math.floor((tick - derniereMaj) / pasEchelle);
  const pas = Math.min(du, PAS_MAX_RATTRAPAGE);
  return { pas, saute: du - pas, jusqua: tick };
}

// ---------------------------------------------------------------------------
// Affectation des échelles
// ---------------------------------------------------------------------------

/**
 * Les critères d'affectation. Volontairement peu nombreux : c'est un
 * classement, pas une note. Toute subtilité ajoutée ici se paie par une
 * instabilité — des personnages qui oscillent entre deux échelles d'un tick à
 * l'autre, avec des rattrapages permanents.
 */
export interface CritereEchelle {
  id: number;
  /** Présent dans la même scène (même carte, à portée de vue) que le joueur. */
  dansLaScene: boolean;
  /** En voyage hors du monde principal. */
  absent: boolean;
  /** Proximité sociale au personnage joueur, 0..1000. */
  proximiteSociale: number;
  /** Dans le même quartier que le joueur. */
  memeQuartier: boolean;
  /** Reclus : très âgé, alité, sans activité ni relation active. */
  reclus: boolean;
}

/**
 * Affecte une échelle à chaque personnage, sous plafonds.
 *
 * Attention au point suivant, qui n'est pas anodin : l'échelle dépend de la
 * position du joueur, donc le monde n'évolue pas exactement pareil selon ce
 * que fait le joueur. C'est assumé et documenté (docs/02-architecture.md,
 * §2.6) : le déterminisme du projet est RELATIF AUX ENTRÉES. Même graine et
 * même journal d'entrées donnent le même monde ; même graine et entrées
 * différentes, non — et c'est très bien ainsi, puisque c'est précisément ce
 * qu'on appelle jouer.
 */
export function affecterEchelles(criteres: readonly CritereEchelle[]): Map<number, Echelle> {
  const resultat = new Map<number, Echelle>();

  const candidatsMicro: CritereEchelle[] = [];
  const candidatsMeso: CritereEchelle[] = [];

  for (const c of criteres) {
    if (c.absent) {
      resultat.set(c.id, 'absent');
      continue;
    }
    if (c.reclus) {
      resultat.set(c.id, 'dormant');
      continue;
    }
    if (c.dansLaScene) {
      candidatsMicro.push(c);
      continue;
    }
    if (c.proximiteSociale > 0 || c.memeQuartier) {
      candidatsMeso.push(c);
      continue;
    }
    resultat.set(c.id, 'macro');
  }

  // Sous plafond, on garde les plus proches socialement ; l'identifiant
  // départage pour que le tri reste total, donc stable d'un rejeu à l'autre.
  const parProximite = (a: CritereEchelle, b: CritereEchelle): number =>
    b.proximiteSociale - a.proximiteSociale || a.id - b.id;

  candidatsMicro.sort(parProximite);
  for (let i = 0; i < candidatsMicro.length; i += 1) {
    const c = candidatsMicro[i];
    if (c === undefined) continue;
    if (i < PLAFONDS.micro) resultat.set(c.id, 'micro');
    else candidatsMeso.push(c);
  }

  candidatsMeso.sort(parProximite);
  for (let i = 0; i < candidatsMeso.length; i += 1) {
    const c = candidatsMeso[i];
    if (c === undefined) continue;
    resultat.set(c.id, i < PLAFONDS.meso ? 'meso' : 'macro');
  }

  return resultat;
}

/**
 * Coût estimé d'un tick, en « mises à jour d'agent ». Sert au banc d'essai et
 * au garde-fou de performance : si ce nombre dépasse la cible du doc 4, c'est
 * que les plafonds ou les pas sont mal réglés — pas qu'il faut optimiser.
 */
export function coutParTick(population: Readonly<Record<Echelle, number>>): number {
  let cout = 0;
  for (const echelle of ['micro', 'meso', 'macro', 'dormant'] as const) {
    const pas = PAS[echelle];
    if (pas > 0) cout += population[echelle] / pas;
  }
  return cout;
}
