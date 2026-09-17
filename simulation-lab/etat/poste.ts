/**
 * Le poste.
 *
 * Jusqu'ici, l'occupation d'un habitant était un enregistrement inventé à sa
 * création : un lieu, des horaires, un salaire, tirés au sort pour lui seul.
 * Conséquence relevée par l'audit : deux bureaux de trente places accueillaient
 * deux cent cinquante salariés sans broncher. Le travail n'était pas une
 * ressource, c'était un attribut.
 *
 * Un poste est FINI et porte AU PLUS UN titulaire. C'est la condition pour que
 * l'échec du §30 soit possible sans tricher : quand quelqu'un prend un poste,
 * un autre ne l'a pas.
 *
 * Les horaires et le salaire appartiennent au poste, pas à la personne — c'est
 * l'ordre naturel des choses, et cela rendra un changement d'emploi trivial le
 * jour où le marché du travail existera. Ce jour n'est pas celui-ci : dans
 * cette phase, l'attribution se fait une fois à la génération et ne bouge
 * plus.
 *
 * Une place d'élève est modélisée comme un poste, avec un salaire nul. Les
 * deux ont un lieu, des horaires, une capacité et une rareté : les séparer
 * aurait dupliqué toute la mécanique pour un gain nul.
 */

import type { LieuId, PersoId, PosteId } from '../noyau/index.ts';

export type GenrePoste = 'emploi' | 'etudes';

export interface Poste {
  id: PosteId;
  genre: GenrePoste;
  intitule: string;
  lieu: LieuId;
  /** Heures d'occupation, en heures pleines. `debutH < finH`. */
  debutH: number;
  finH: number;
  /** En euros par heure. Zéro pour une place d'élève. */
  salaireHoraire: number;
  /** `null` si le poste est vacant. Au plus un titulaire, jamais deux. */
  titulaire: PersoId | null;
}

export function estVacant(poste: Poste): boolean {
  return poste.titulaire === null;
}
