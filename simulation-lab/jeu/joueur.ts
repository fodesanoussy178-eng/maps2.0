/**
 * Le personnage du joueur.
 *
 * Il est créé à la nouvelle partie, puis inséré dans le monde comme n'importe
 * quel habitant : même structure, mêmes besoins, même IA, même boucle. La
 * SEULE différence est qu'une intention venue de l'interface peut prendre le
 * pas sur sa décision — et ce crochet est générique, pas réservé au joueur.
 *
 * Rien ici ne doit ressembler à « le joueur est un cas particulier du
 * moteur ». Le jour où les relations, la mémoire ou le vieillissement
 * arriveront, il en profitera sans qu'on ait à y penser.
 */

import type { FoyerId, LieuId, PersoId, PosteId } from '../noyau/index.ts';
import { TICKS_PAR_AN, attribuer, creerFlux, entier } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import type { Personnage, Activite } from '../etat/personnage.ts';
import { BESOINS, TRAITS } from '../etat/personnage.ts';
import type { Trait } from '../etat/personnage.ts';
import type { Apparence } from '../etat/apparence.ts';
import { creerPosition } from '../etat/position.ts';
import { creerFoyer } from '../etat/foyer.ts';
import { installer } from '../etat/transactions.ts';
import { DUREE_TRAJET } from '../etat/lieu.ts';
import { estVacant } from '../etat/poste.ts';

export interface FicheCreation {
  prenom: string;
  nom: string;
  age: number;
  sexe: 'f' | 'm';
  apparence: Apparence;
  /** Traits choisis par le joueur. Les absents sont tirés au sort. */
  traits: Partial<Record<Trait, number>>;
}

/**
 * Insère le personnage du joueur dans un monde déjà généré.
 *
 * Il prend un logement qui a de la place et, s'il y a lieu, un poste vacant —
 * exactement comme les autres. S'il n'y a plus de poste, il est sans
 * occupation : le monde ne fabrique rien pour lui faire plaisir.
 */
export function insererJoueur(monde: Monde, fiche: FicheCreation): PersoId {
  const r = creerFlux(monde.graine, 'joueur', monde.personnages.size);
  const id = attribuer<PersoId>(monde.compteur);

  const logement = logementDisponible(monde);
  const foyer = foyerPour(monde, logement);

  const traits = TRAITS.map((t) => {
    const choisi = fiche.traits[t];
    return choisi === undefined ? entier(r, -60, 61) : borne(choisi, -100, 100);
  });

  const p: Personnage = {
    id,
    prenom: fiche.prenom.trim() || 'Sans-nom',
    nom: fiche.nom.trim() || 'Inconnu',
    naissance: monde.tick - borne(fiche.age, 6, 90) * TICKS_PAR_AN,
    sexe: fiche.sexe,
    traits,
    besoins: BESOINS.map(() => entier(r, 80, 420)),
    apparence: fiche.apparence,
    position: creerPosition(id as number, logement),
    foyer,
    poste: null,
    argent: fiche.age < 18 ? 60 : 1200,
    activite: null,
    echelle: 'micro',
    derniereMaj: monde.tick,
  };

  monde.personnages.set(id, p);
  monde.foyers.get(foyer)?.membres.push(id);
  installer(monde, p, logement);
  attribuerPoste(monde, p, borne(fiche.age, 6, 90));

  return id;
}

function borne(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/** Le premier logement qui a de la place. Aucun n'est créé pour l'occasion. */
function logementDisponible(monde: Monde): LieuId {
  let repli: LieuId | null = null;
  for (const l of monde.lieux.values()) {
    if (l.type !== 'logement') continue;
    if (repli === null) repli = l.id;
    if (l.occupants.length < l.capacite) return l.id;
  }
  if (repli === null) throw new Error('le monde ne contient aucun logement');
  return repli;
}

function foyerPour(monde: Monde, logement: LieuId): FoyerId {
  for (const f of monde.foyers.values()) {
    if (f.logement === logement) return f.id;
  }
  const id = attribuer<FoyerId>(monde.compteur);
  monde.foyers.set(id, creerFoyer(id, logement));
  return id;
}

function attribuerPoste(monde: Monde, p: Personnage, age: number): void {
  if (age >= 65) return;
  const genre = age < 18 ? 'etudes' : 'emploi';
  for (const poste of monde.postes.values()) {
    if (poste.genre !== genre || !estVacant(poste)) continue;
    poste.titulaire = p.id;
    p.poste = poste.id;
    return;
  }
}

// ---------------------------------------------------------------------------
// Les commandes du joueur
// ---------------------------------------------------------------------------

/**
 * Un ordre en attente. Il tient dans la partie, pas dans le monde : c'est de
 * l'intention d'interface, pas de l'état simulé, et une sauvegarde n'a aucune
 * raison de le conserver.
 */
export interface Ordres {
  /** Lieu où le joueur a demandé à aller. */
  destination: LieuId | null;
  /** Vrai tant que le joueur veut rester sur place sans rien entreprendre. */
  arret: boolean;
}

export function creerOrdres(): Ordres {
  return { destination: null, arret: false };
}

/**
 * Le crochet d'intention passé à la boucle.
 *
 * Il ne s'applique qu'au personnage du joueur, et seulement quand un ordre est
 * en attente. Tout le reste du temps il renvoie `null`, et le personnage
 * décide avec la même IA que ses voisins — ce qui est exactement ce qu'on
 * veut : un joueur absent n'est pas un légume.
 */
export function intentionDuJoueur(
  joueur: PersoId,
  ordres: Ordres,
): (monde: Monde, p: Personnage, t: number) => Activite | null {
  return (monde, p, t) => {
    if (p.id !== joueur) return null;

    if (ordres.destination !== null) {
      const cible = ordres.destination;
      ordres.destination = null;
      if (cible === p.position.lieu) return null;
      if (!monde.lieux.has(cible)) return null;
      return { type: 'deplacement', vers: cible, jusqua: t + DUREE_TRAJET };
    }

    if (ordres.arret) {
      // « Ne rien entreprendre » n'est pas l'absence d'activité : la boucle a
      // besoin que le temps passe. Un quart d'heure de flânerie, renouvelé
      // tant que l'ordre tient.
      return { type: 'action', action: 'flaner', jusqua: t + 3 };
    }

    return null;
  };
}

export function ordonnerDeplacement(ordres: Ordres, vers: LieuId): void {
  ordres.destination = vers;
  ordres.arret = false;
}

export function ordonnerArret(ordres: Ordres): void {
  ordres.destination = null;
  ordres.arret = true;
}

export function rendreAutonomie(ordres: Ordres): void {
  ordres.destination = null;
  ordres.arret = false;
}

/** Vrai si un poste a bien été attribué au joueur — pour l'écran de résumé. */
export function posteDuJoueur(monde: Monde, id: PersoId): PosteId | null {
  return monde.personnages.get(id)?.poste ?? null;
}
