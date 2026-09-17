/**
 * Les lieux.
 *
 * Dans le banc d'essai, le monde est un GRAPHE de lieux, pas une carte de
 * tuiles : se déplacer coûte un forfait constant au lieu d'un cheminement.
 * C'est un choix assumé — le labo sert à prouver les systèmes sociaux, et la
 * géométrie n'en change aucun. Elle s'ajoutera par-dessus, sans rien toucher
 * ici, quand le monde deviendra jouable.
 */

import type { LieuId, PersoId } from '../noyau/index.ts';

export const TYPES_LIEU = [
  'logement',
  'bureau',
  'ecole',
  'cafe',
  'commerce',
  'gymnase',
  'parc',
  'rue',
] as const;

export type TypeLieu = (typeof TYPES_LIEU)[number];

export interface Lieu {
  id: LieuId;
  nom: string;
  type: TypeLieu;
  /** Nombre maximum d'occupants simultanés. `Infinity` pour les lieux ouverts. */
  capacite: number;
  /** Occupants présents. Tenu par les transactions, jamais écrit directement. */
  occupants: PersoId[];
  /** Heures d'ouverture. Un lieu ouvert en permanence a 0 et 24. */
  ouvertureH: number;
  fermetureH: number;
}

/**
 * Durée forfaitaire d'un déplacement entre deux lieux, en ticks (20 minutes).
 *
 * Un seul nombre pour tout le monde : c'est faux, et c'est volontaire. Le
 * jour où la carte existera, cette constante deviendra une fonction du
 * chemin — et le reste du code n'aura pas à changer, puisque personne ne la
 * lit en dehors de la boucle.
 */
export const DUREE_TRAJET = 4;

export function estOuvert(lieu: Lieu, heure: number): boolean {
  if (lieu.ouvertureH === 0 && lieu.fermetureH >= 24) return true;
  return heure >= lieu.ouvertureH && heure < lieu.fermetureH;
}

export function estPlein(lieu: Lieu): boolean {
  return lieu.occupants.length >= lieu.capacite;
}
