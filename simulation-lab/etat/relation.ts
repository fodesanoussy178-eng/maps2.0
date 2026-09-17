/**
 * Les relations.
 *
 * Le cahier des charges est explicite : deux personnages ne doivent pas
 * seulement avoir `relationship = 72`. Une relation a une HISTOIRE, et elle
 * n'est pas symétrique.
 *
 * Deux décisions de modèle en découlent.
 *
 * ELLE EST DIRIGÉE. A → B n'est pas B → A. Sans cela, pas d'amour non
 * partagé, pas de rancune unilatérale, pas de malentendu durable — or ce sont
 * les moteurs dramatiques les plus efficaces qui existent, et ils ne coûtent
 * qu'un doublement du stockage.
 *
 * ELLE A PLUSIEURS AXES. On peut connaître quelqu'un sans l'apprécier, lui
 * faire confiance sans le respecter, le respecter en le détestant. Un score
 * unique écrase tout cela et produit des personnages qui n'ont que des amis
 * et des ennemis.
 *
 * Et la QUALIFICATION — ami, rival, ennemi — n'est jamais stockée : elle est
 * calculée à la lecture. Un ennemi n'est pas un état qu'on décrète, c'est une
 * configuration qu'on atteint, et qu'on peut quitter.
 */

import type { PersoId } from '../noyau/index.ts';
import { TICKS_PAR_JOUR } from '../noyau/index.ts';

/** Ce que le monde impose, indépendamment des sentiments. */
export type LienStructurel = 'aucun' | 'foyer' | 'voisin' | 'collegue' | 'camarade';

export type GenreEpisode =
  | 'rencontre'
  | 'bon_moment'
  | 'confidence'
  | 'froideur'
  | 'dispute';

/**
 * Un épisode marquant. C'est ce qui donne une histoire à la relation, et ce
 * que l'interface montrera un jour à la place des axes numériques : « vous
 * vous êtes disputés le 14 mars » plutôt que « confiance : 312 ».
 */
export interface Episode {
  tick: number;
  genre: GenreEpisode;
  /** 0..1000 — sert à décider ce qu'on garde quand la mémoire déborde. */
  force: number;
}

export interface Relation {
  de: PersoId;
  vers: PersoId;
  /** 0..1000 — à quel point je le connais. Ne descend que très lentement. */
  familiarite: number;
  /** -1000..1000 — est-ce que je l'apprécie. */
  affection: number;
  /** -1000..1000 — est-ce que je peux me fier à lui. */
  confiance: number;
  /** -1000..1000 — est-ce que je l'estime. */
  respect: number;
  /** 0..1000 — attirance. Dort jusqu'à la phase 6, mais l'axe existe. */
  attirance: number;
  /** 0..1000 — conflit latent non résolu. Retombe avec le temps. */
  tension: number;
  lien: LienStructurel;
  rencontres: number;
  dernierContact: number;
  /** Mise à jour paresseuse : la décroissance se calcule à la lecture. */
  calculeA: number;
  /** Plafonné à DOUZE : une relation se résume à ses moments, pas à son journal. */
  episodes: Episode[];
}

export const EPISODES_MAX = 12;

export function clef(de: PersoId, vers: PersoId): string {
  return `${de}>${vers}`;
}

export function creerRelation(
  de: PersoId,
  vers: PersoId,
  lien: LienStructurel,
  tick: number,
): Relation {
  return {
    de,
    vers,
    familiarite: 0,
    affection: 0,
    confiance: 0,
    respect: 0,
    attirance: 0,
    tension: 0,
    lien,
    rencontres: 0,
    dernierContact: tick,
    calculeA: tick,
    episodes: [],
  };
}

const borner = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export function ajusterRelation(r: Relation, deltas: Partial<Record<
  'familiarite' | 'affection' | 'confiance' | 'respect' | 'attirance' | 'tension',
  number
>>): void {
  if (deltas.familiarite !== undefined) {
    // Saturant : les cent premières minutes passées avec quelqu'un apprennent
    // davantage que les mille suivantes.
    const marge = 1 - r.familiarite / 1000;
    r.familiarite = borner(r.familiarite + deltas.familiarite * marge, 0, 1000);
  }
  if (deltas.affection !== undefined) r.affection = borner(r.affection + deltas.affection, -1000, 1000);
  if (deltas.confiance !== undefined) r.confiance = borner(r.confiance + deltas.confiance, -1000, 1000);
  if (deltas.respect !== undefined) r.respect = borner(r.respect + deltas.respect, -1000, 1000);
  if (deltas.attirance !== undefined) r.attirance = borner(r.attirance + deltas.attirance, 0, 1000);
  if (deltas.tension !== undefined) r.tension = borner(r.tension + deltas.tension, 0, 1000);
}

export function ajouterEpisode(r: Relation, episode: Episode): void {
  r.episodes.push(episode);
  if (r.episodes.length <= EPISODES_MAX) return;
  // On évince le plus faible, pas le plus ancien : une dispute d'il y a dix
  // ans pèse plus qu'un café d'hier, et c'est bien ce qu'on veut garder.
  let pire = 0;
  for (let i = 1; i < r.episodes.length; i += 1) {
    if ((r.episodes[i]?.force ?? 0) < (r.episodes[pire]?.force ?? 0)) pire = i;
  }
  r.episodes.splice(pire, 1);
}

// ---------------------------------------------------------------------------
// Décroissance
// ---------------------------------------------------------------------------

/**
 * Ce qu'une relation perd par jour sans contact.
 *
 * C'est ce qui empêche la « soupe grise » : sans décroissance, au bout d'un an
 * tout le monde connaît tout le monde et toutes les relations sont tièdes. Une
 * amitié qu'on n'entretient pas doit s'éteindre — et une rancune aussi.
 */
const PAR_JOUR = {
  familiarite: 1.6,
  affectionVersZero: 0.012,
  attiranceVersZero: 0.02,
  tension: 22,
};

/**
 * Applique la décroissance à la lecture plutôt qu'à chaque tick.
 *
 * Balayer des milliers de relations à chaque pas de simulation coûterait plus
 * cher que toute la prise de décision réunie, pour un résultat identique : la
 * décroissance est linéaire dans le temps, donc la calculer d'un coup au
 * moment où on regarde donne exactement la même valeur. C'est le même principe
 * que le rattrapage paresseux des personnages.
 */
export function aJour(r: Relation, tick: number): Relation {
  const jours = (tick - r.calculeA) / TICKS_PAR_JOUR;
  if (jours <= 0) return r;
  r.calculeA = tick;

  r.familiarite = Math.max(0, r.familiarite - PAR_JOUR.familiarite * jours);
  r.tension = Math.max(0, r.tension - PAR_JOUR.tension * jours);

  const versZero = (v: number, taux: number): number => {
    const facteur = Math.max(0, 1 - taux * jours);
    return v * facteur;
  };
  r.affection = versZero(r.affection, PAR_JOUR.affectionVersZero);
  r.attirance = versZero(r.attirance, PAR_JOUR.attiranceVersZero);
  return r;
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

export type Qualite =
  | 'inconnu'
  | 'connaissance'
  | 'ami'
  | 'proche'
  | 'rival'
  | 'ennemi';

/**
 * Qualifie une relation. Dérivée à la lecture, JAMAIS stockée.
 *
 * L'ordre des tests compte : l'hostilité l'emporte sur l'affection, parce
 * qu'on peut parfaitement apprécier quelqu'un avec qui on est en guerre — et
 * c'est cet état-là qui décrit le mieux la relation.
 */
export function qualifier(r: Relation): Qualite {
  if (r.familiarite < 70) return 'inconnu';
  if (r.tension > 550 && r.affection < -150) return 'ennemi';
  if (r.tension > 380 && r.affection < 150) return 'rival';
  if (r.familiarite > 550 && r.affection > 450) return 'proche';
  if (r.affection > 220 && r.familiarite > 180) return 'ami';
  return 'connaissance';
}

/** Les qualités qui comptent comme un lien d'amitié dans le sociogramme. */
export function estAmical(q: Qualite): boolean {
  return q === 'ami' || q === 'proche';
}

export function estHostile(q: Qualite): boolean {
  return q === 'rival' || q === 'ennemi';
}
