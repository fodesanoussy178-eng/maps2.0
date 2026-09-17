/**
 * L'état du monde.
 *
 * Tout ce qui existe, et rien d'autre : pas de cache, pas d'index dérivé, pas
 * de statistique. Un champ qui peut être recalculé n'a pas sa place ici, car
 * c'est exactement ainsi qu'un état devient incohérent avec lui-même.
 *
 * Chacune des collections ci-dessous a un usage RÉEL aujourd'hui. Aucune n'est
 * là parce qu'un document d'architecture la mentionne :
 *
 *   personnages  les habitants
 *   lieux        les bâtiments et espaces
 *   foyers       l'index qui remplace un parcours de toute la population à
 *                chaque dépense partagée (§8.3 de l'audit)
 *   postes       le travail et les places d'école, en nombre FINI
 *   relations    la seule exception, assumée et documentée : elle reste vide,
 *                mais l'audit a montré que l'ajouter après coup obligerait à
 *                recâbler tout ce qui aura été écrit entre-temps
 *
 * Ce qui N'EST PAS ici, et pourquoi :
 *
 *   defunts        personne ne meurt encore, et la filiation n'existe pas :
 *                  une collection vide sans producteur ni consommateur
 *   organisations  un poste se rattache à son lieu, ce qui suffit ; ajouter
 *                  l'employeur plus tard est additif, pas une réécriture
 *   faits,         le bus d'événements n'est branché à rien : la chronique
 *   chronique      n'aurait rien à enregistrer
 *   logements      un logement est un lieu ; le foyer porte son adresse
 *   economie       ni loyer ni charges n'existent
 */

import type { Compteur, FoyerId, LieuId, PersoId, PosteId } from '../noyau/index.ts';
import { creerCompteur } from '../noyau/index.ts';
import type { Personnage } from './personnage.ts';
import type { Lieu } from './lieu.ts';
import type { Foyer } from './foyer.ts';
import type { Poste } from './poste.ts';
import type { Relation } from './relation.ts';

/**
 * Version du schéma de sauvegarde.
 *
 * Une sauvegarde sans numéro de schéma est une sauvegarde qu'on ne saura pas
 * lire dans six mois. À incrémenter dès que la forme de l'état change.
 */
export const VERSION_ETAT = 2;

export interface Monde {
  version: number;
  /** Graine racine. Avec le journal des entrées, elle détermine tout le reste. */
  graine: number;
  /** Temps simulé, en pas de cinq minutes. */
  tick: number;
  compteur: Compteur;
  /** `Map` et non objet : l'ordre d'itération est garanti, donc déterministe. */
  personnages: Map<PersoId, Personnage>;
  lieux: Map<LieuId, Lieu>;
  foyers: Map<FoyerId, Foyer>;
  postes: Map<PosteId, Poste>;
  /**
   * Relations dirigées, clef « de>vers ».
   *
   * VIDE, et volontairement : aucun moteur ne l'écrit encore. Elle est ici
   * pour que le jour où les relations seront branchées, rien de ce qui aura
   * été construit entre-temps n'ait à être repris — et pour que les invariants
   * puissent déjà surveiller sa cohérence.
   */
  relations: Map<string, Relation>;
}

export function creerMonde(graine: number, tickDepart = 0): Monde {
  return {
    version: VERSION_ETAT,
    graine,
    tick: tickDepart,
    compteur: creerCompteur(1),
    personnages: new Map(),
    lieux: new Map(),
    foyers: new Map(),
    postes: new Map(),
    relations: new Map(),
  };
}

export function personnage(monde: Monde, id: PersoId): Personnage | undefined {
  return monde.personnages.get(id);
}

export function lieu(monde: Monde, id: LieuId): Lieu | undefined {
  return monde.lieux.get(id);
}

/** Le logement du foyer. Le personnage ne porte plus son adresse en double. */
export function domicile(monde: Monde, p: Personnage): LieuId | null {
  return monde.foyers.get(p.foyer)?.logement ?? null;
}

export function foyerDe(monde: Monde, p: Personnage): Foyer | undefined {
  return monde.foyers.get(p.foyer);
}

export function posteDe(monde: Monde, p: Personnage): Poste | undefined {
  return p.poste === null ? undefined : monde.postes.get(p.poste);
}

/** Les habitants présents dans un lieu, hors celui qu'on interroge. */
export function autresPresents(monde: Monde, id: PersoId): Personnage[] {
  const p = monde.personnages.get(id);
  if (p === undefined) return [];
  const l = monde.lieux.get(p.position.lieu);
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
