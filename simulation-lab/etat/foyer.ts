/**
 * Le foyer.
 *
 * Ce n'est pas une entité ajoutée pour faire joli dans une interface : elle a
 * un usage immédiat et mesuré. Jusqu'ici, faire payer une dépense par un foyer
 * demandait de parcourir TOUTE la population pour retrouver qui partage le
 * même logement — `O(N)` à chaque décision, soit le premier goulet
 * d'étranglement identifié par l'audit (§8.3) et les 13 % de coût
 * supplémentaire déjà visibles à 480 habitants.
 *
 * Le foyer porte l'index. Il portera plus tard le loyer, les charges, les
 * provisions et la parenté — mais rien de tout cela n'est ici : cette phase ne
 * crée pas de systèmes, elle crée la structure qui les accueillera.
 */

import type { FoyerId, LieuId, PersoId } from '../noyau/index.ts';

export interface Foyer {
  id: FoyerId;
  /** Le logement occupé. Un foyer est défini par son adresse. */
  logement: LieuId;
  /**
   * Les membres, dans l'ordre où ils ont rejoint le foyer.
   *
   * L'ordre est significatif : il décide de qui paie en premier une dépense
   * partagée. Le changer changerait le futur d'une partie rejouée.
   */
  membres: PersoId[];
}

export function creerFoyer(id: FoyerId, logement: LieuId): Foyer {
  return { id, logement, membres: [] };
}
