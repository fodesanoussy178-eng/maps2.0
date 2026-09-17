/**
 * Fabrique de personnages pour les tests unitaires.
 *
 * Les tests qui n'ont besoin que d'un porteur de traits ou de besoins ne
 * doivent pas avoir à connaître la forme complète d'un `Personnage`. Ils
 * l'avaient recopiée chacun de leur côté, et le moindre champ ajouté à l'état
 * cassait quatre fichiers de test sans que rien ne soit réellement faux.
 *
 * Ce n'est pas un raccourci : c'est ce qui garantit qu'un test tombe parce
 * qu'un COMPORTEMENT a changé, pas parce qu'une structure a bougé.
 */

import type { FoyerId, LieuId, PersoId } from '../noyau/index.ts';
import type { Personnage, Trait } from '../etat/personnage.ts';
import { BESOINS, TRAITS } from '../etat/personnage.ts';
import { creerPosition } from '../etat/position.ts';
import type { Apparence } from '../etat/apparence.ts';

export const APPARENCE_TEMOIN: Apparence = {
  genes: { teintePeau: 120, teinteCheveux: 60, coiffure: 3, corpulence: 0, tailleCm: 172 },
  garderobe: { haut: 2, bas: 1, teinteHaut: 200, teinteBas: 90 },
  accessoires: 0,
};

export function habitantTemoin(
  traits: Partial<Record<Trait, number>> = {},
  modifications: Partial<Personnage> = {},
): Personnage {
  const id = 1 as PersoId;
  return {
    id,
    prenom: 'Test',
    nom: 'Témoin',
    naissance: 0,
    sexe: 'f',
    traits: TRAITS.map((t) => traits[t] ?? 0),
    besoins: BESOINS.map(() => 0),
    apparence: { genes: { ...APPARENCE_TEMOIN.genes }, garderobe: { ...APPARENCE_TEMOIN.garderobe }, accessoires: 0 },
    position: creerPosition(id as number, 1 as LieuId),
    foyer: 1 as FoyerId,
    poste: null,
    argent: 500,
    activite: null,
    echelle: 'micro',
    derniereMaj: 0,
    ...modifications,
  };
}
