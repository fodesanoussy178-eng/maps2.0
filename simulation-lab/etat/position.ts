/**
 * La position.
 *
 * Aujourd'hui un personnage est « dans un lieu », et c'est tout. Le jour où
 * les intérieurs existeront, il sera « dans la cuisine du logement 7, près de
 * la fenêtre ». Ce changement touche les transactions, le choix du lieu,
 * chaque action, les invariants, la sauvegarde et le rendu : fait maintenant
 * c'est un champ, fait plus tard c'est une reprise transversale.
 *
 * D'où cette structure, posée COMPLÈTE dès maintenant alors que `piece` vaut
 * toujours `null` : les intérieurs ne sont pas construits dans cette phase.
 *
 * `x` et `y` sont en MILLIÈMES de l'emprise du lieu — ou de la pièce quand il
 * y en aura une. Trois raisons à ce choix plutôt qu'à des pixels ou des
 * mètres :
 *
 *   - des entiers bornés, donc pas d'arrondi dans le rejeu déterministe ;
 *   - une position qui reste valable si le lieu change de taille ou si le
 *     rendu change d'échelle — le moteur n'a pas à connaître la géométrie ;
 *   - un emplacement stable pour chacun, ce qui évite que les habitants
 *     sautent d'un point à l'autre dès que quelqu'un entre ou sort.
 */

import type { LieuId, PieceId } from '../noyau/index.ts';
import { hacher } from '../noyau/index.ts';

export const POSITION_MAX = 1000;

export interface Position {
  lieu: LieuId;
  /** `null` tant que le lieu n'a pas d'intérieur simulé. */
  piece: PieceId | null;
  /** 0..1000, millièmes de l'emprise. */
  x: number;
  y: number;
}

/**
 * L'emplacement d'une personne dans un lieu donné.
 *
 * Dérivé par hachage de (personne, lieu) plutôt que tiré au sort : il est donc
 * stable dans le temps sans rien stocker, identique d'un rejeu à l'autre, et
 * il ne consomme aucun état d'aléa — ce qui permet aux transactions de placer
 * quelqu'un sans avoir accès au générateur du monde.
 */
export function emplacementDans(persoId: number, lieu: LieuId): { x: number; y: number } {
  return {
    x: hacher('emplacement-x', persoId, lieu as number) % (POSITION_MAX + 1),
    y: hacher('emplacement-y', persoId, lieu as number) % (POSITION_MAX + 1),
  };
}

export function creerPosition(persoId: number, lieu: LieuId): Position {
  const e = emplacementDans(persoId, lieu);
  return { lieu, piece: null, x: e.x, y: e.y };
}

export function positionValide(p: Position): string[] {
  const fautes: string[] = [];
  if (!Number.isInteger(p.x) || p.x < 0 || p.x > POSITION_MAX) fautes.push(`x=${p.x}`);
  if (!Number.isInteger(p.y) || p.y < 0 || p.y > POSITION_MAX) fautes.push(`y=${p.y}`);
  return fautes;
}
