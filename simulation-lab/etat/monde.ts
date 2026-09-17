/**
 * L'état du monde.
 *
 * Tout ce qui existe, et rien d'autre : pas de cache, pas d'index dérivé, pas
 * de statistique. Un champ qui peut être recalculé n'a pas sa place ici, car
 * c'est exactement ainsi qu'un état devient incohérent avec lui-même.
 */

import type { Compteur, LieuId, PersoId } from '../noyau/index.ts';
import { creerCompteur } from '../noyau/index.ts';
import type { Personnage } from './personnage.ts';
import type { Lieu } from './lieu.ts';

export interface Monde {
  /** Graine racine. Avec le journal des entrées, elle détermine tout le reste. */
  graine: number;
  /** Temps simulé, en pas de cinq minutes. */
  tick: number;
  compteur: Compteur;
  /** `Map` et non objet : l'ordre d'itération est garanti, donc déterministe. */
  personnages: Map<PersoId, Personnage>;
  lieux: Map<LieuId, Lieu>;
}

export function creerMonde(graine: number, tickDepart = 0): Monde {
  return {
    graine,
    tick: tickDepart,
    compteur: creerCompteur(1),
    personnages: new Map(),
    lieux: new Map(),
  };
}

export function personnage(monde: Monde, id: PersoId): Personnage | undefined {
  return monde.personnages.get(id);
}

export function lieu(monde: Monde, id: LieuId): Lieu | undefined {
  return monde.lieux.get(id);
}

/** Les habitants présents dans un lieu, hors celui qu'on interroge. */
export function autresPresents(monde: Monde, id: PersoId): Personnage[] {
  const p = monde.personnages.get(id);
  if (p === undefined) return [];
  const l = monde.lieux.get(p.lieu);
  if (l === undefined) return [];
  const resultat: Personnage[] = [];
  for (const autreId of l.occupants) {
    if (autreId === id) continue;
    const autre = monde.personnages.get(autreId);
    if (autre !== undefined) resultat.push(autre);
  }
  return resultat;
}

/** Premier lieu ouvert du type demandé, ou `undefined`. Ordre d'insertion, donc stable. */
export function trouverLieu(
  monde: Monde,
  type: string,
  filtre?: (l: Lieu) => boolean,
): Lieu | undefined {
  for (const l of monde.lieux.values()) {
    if (l.type !== type) continue;
    if (filtre !== undefined && !filtre(l)) continue;
    return l;
  }
  return undefined;
}
