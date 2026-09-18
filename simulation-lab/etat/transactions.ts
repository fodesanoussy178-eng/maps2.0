/**
 * Les transactions.
 *
 * L'état porteur d'invariants — la position et l'argent — n'est JAMAIS
 * modifié directement. Il passe par ces fonctions, qui tiennent les deux
 * côtés à jour.
 *
 * Écrire `perso.lieu = x` quelque part est un bug, même si le code semble
 * marcher : la liste d'occupants de l'ancien lieu garde le personnage, celle
 * du nouveau ne l'a pas, et la contradiction n'apparaîtra qu'à la centième
 * heure de jeu, dans une partie qu'on ne saura plus rejouer.
 */

import type { LieuId } from '../noyau/index.ts';
import type { Monde } from './monde.ts';
import type { Personnage } from './personnage.ts';
import { estPlein } from './lieu.ts';

export type Echec = 'lieu-inconnu' | 'lieu-plein' | 'fonds-insuffisants';

export type Resultat = { ok: true } | { ok: false; raison: Echec };

const SUCCES: Resultat = { ok: true };

/**
 * Déplace un personnage. Retire de l'ancien lieu, ajoute au nouveau, refuse
 * si le lieu est plein.
 *
 * Le refus est une valeur de retour, jamais une exception : en simulation,
 * « le café était complet » est un fait ordinaire du monde, pas une erreur de
 * programme. Le distinguer d'un bug est ce qui permet de faire tomber les
 * tests sur les vrais bugs.
 */
export function deplacer(monde: Monde, p: Personnage, vers: LieuId): Resultat {
  const destination = monde.lieux.get(vers);
  if (destination === undefined) return { ok: false, raison: 'lieu-inconnu' };
  if (p.lieu === vers) return SUCCES;
  if (estPlein(destination)) return { ok: false, raison: 'lieu-plein' };

  const origine = monde.lieux.get(p.lieu);
  if (origine !== undefined) {
    const i = origine.occupants.indexOf(p.id);
    if (i >= 0) origine.occupants.splice(i, 1);
  }
  destination.occupants.push(p.id);
  p.lieu = vers;
  return SUCCES;
}

/** Place un personnage sans vérifier la capacité. Réservé à la génération du monde. */
export function installer(monde: Monde, p: Personnage, dans: LieuId): void {
  const destination = monde.lieux.get(dans);
  if (destination === undefined) return;
  destination.occupants.push(p.id);
  p.lieu = dans;
}

/**
 * Dépense. Refuse si les fonds manquent — l'argent ne descend jamais sous zéro
 * par accident. Les dettes existeront, mais comme un engagement délibéré,
 * pas comme le résidu d'un achat qu'on n'a pas su refuser.
 */
export function depenser(p: Personnage, montant: number): Resultat {
  if (montant <= 0) return SUCCES;
  if (p.argent < montant) return { ok: false, raison: 'fonds-insuffisants' };
  p.argent -= montant;
  return SUCCES;
}

export function crediter(p: Personnage, montant: number): void {
  if (montant <= 0) return;
  p.argent += montant;
}

/**
 * Dépense partagée par le foyer.
 *
 * Les habitants d'un même logement forment un foyer, et un foyer met en
 * commun ce qui le fait vivre. Sans cela, le banc d'essai produit une
 * absurdité que ses mesures ont rendue visible : les enfants et les
 * retraités, qui n'ont aucun revenu propre, ne peuvent jamais faire de
 * courses, et leur besoin de provisions reste au-dessus du seuil critique un
 * tiers du temps. Un modèle où un enfant de douze ans meurt de faim faute de
 * salaire n'est pas plus dur, il est faux.
 *
 * Ce n'est PAS un moteur économique : il n'y a ici ni loyer, ni pension, ni
 * dette. C'est le minimum sans lequel le besoin de provisions ne veut rien
 * dire. Un retraité vivant seul, lui, échouera vraiment — et c'est un fait
 * social à traiter en phase 5, pas un défaut à masquer.
 */
export function depenserFoyer(monde: Monde, p: Personnage, montant: number): Resultat {
  if (montant <= 0) return SUCCES;
  if (p.argent >= montant) {
    p.argent -= montant;
    return SUCCES;
  }

  const foyer: Personnage[] = [];
  let disponible = 0;
  for (const autre of monde.personnages.values()) {
    if (autre.domicile !== p.domicile) continue;
    foyer.push(autre);
    disponible += Math.max(0, autre.argent);
  }
  if (disponible < montant) return { ok: false, raison: 'fonds-insuffisants' };

  // On prélève d'abord sur l'acheteur, puis sur les autres dans l'ordre
  // d'insertion — déterministe, donc rejouable.
  let reste = montant;
  const ordre = [p, ...foyer.filter((x) => x.id !== p.id)];
  for (const membre of ordre) {
    if (reste <= 0) break;
    const part = Math.min(reste, Math.max(0, membre.argent));
    membre.argent -= part;
    reste -= part;
  }
  return SUCCES;
}
