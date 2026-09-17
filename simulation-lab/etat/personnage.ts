/**
 * Le personnage.
 *
 * Des DONNÉES, jamais un objet à comportement : pas de classe, pas de
 * méthode, pas de référence croisée — que des identifiants. Trois
 * conséquences gratuites : la sauvegarde est un `JSON.stringify`, le rejeu
 * déterministe est possible, et aucun système ne peut dissimuler une
 * dépendance dans un pointeur.
 */

import type { FoyerId, LieuId, PersoId, PosteId } from '../noyau/index.ts';
import type { Echelle } from '../noyau/index.ts';
import type { Position } from './position.ts';
import type { Apparence } from './apparence.ts';

// ---------------------------------------------------------------------------
// Besoins
// ---------------------------------------------------------------------------

/**
 * Un besoin est une PRESSION, pas une jauge de confort : 0 = comblé,
 * 1000 = critique. Ce sens est le bon parce que c'est celui dont l'IA a
 * besoin — l'utilité d'une action croît avec la pression, sans inversion à
 * écrire dans chaque courbe.
 */
export const BESOINS = [
  'energie',
  'faim',
  'hygiene',
  'social',
  'plaisir',
  'accomplissement',
  'securite',
] as const;

export type Besoin = (typeof BESOINS)[number];

export const BESOIN_MAX = 1000;
/** Au-delà, le besoin domine tout le reste et le personnage lâche sa routine. */
export const SEUIL_CRITIQUE = 800;

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

/**
 * Quatorze traits, de -100 à +100, quasi stables sur une vie.
 *
 * RÈGLE ABSOLUE : un trait n'ajoute JAMAIS de bonus direct et n'est jamais
 * affiché comme un nombre. Il n'entre que dans les courbes de réponse de
 * l'IA d'utilité et dans la température du tirage. Une personne sociable ne
 * gagne pas « +10 en sociabilité » : l'utilité de « discuter » monte, celle
 * de « rester seul » descend, et son besoin social se dégrade plus vite
 * quand elle est isolée. Le comportement est la seule manifestation du trait.
 */
export const TRAITS = [
  'sociabilite',
  'ambition',
  'impulsivite',
  'prudence',
  'confiance',
  'empathie',
  'agressivite',
  'curiosite',
  'discipline',
  'ouverture',
  'attachement',
  'goutRisque',
  'besoinReconnaissance',
  'independance',
] as const;

export type Trait = (typeof TRAITS)[number];

// ---------------------------------------------------------------------------
// Activité en cours
// ---------------------------------------------------------------------------

/**
 * Un personnage fait UNE chose à la fois, et c'est un type somme : il est
 * impossible d'être en déplacement et au travail au même instant. Ce n'est
 * pas une règle qu'un système doit vérifier, c'est une impossibilité
 * d'écriture — c'est ainsi que le §29 du cahier des charges est tenu.
 */
export type Activite =
  | { type: 'action'; action: string; jusqua: number }
  | { type: 'deplacement'; vers: LieuId; jusqua: number };

// ---------------------------------------------------------------------------
// Personnage
// ---------------------------------------------------------------------------

export interface Personnage {
  id: PersoId;
  prenom: string;
  nom: string;
  /** Tick de naissance. L'âge se calcule, il n'est jamais stocké. */
  naissance: number;
  sexe: 'f' | 'm';

  /** Indexés par TRAITS, -100..100. */
  traits: number[];
  /** Indexés par BESOINS, 0..1000. */
  besoins: number[];
  /** Persistante et transmissible : voir `etat/apparence.ts`. */
  apparence: Apparence;

  /** Où il se trouve, jusqu'à la pièce et au point : voir `etat/position.ts`. */
  position: Position;
  /** Le foyer auquel il appartient. Son logement en découle, jamais l'inverse. */
  foyer: FoyerId;
  /** Emploi ou place d'élève. `null` = sans occupation. */
  poste: PosteId | null;
  argent: number;

  activite: Activite | null;

  echelle: Echelle;
  derniereMaj: number;
}

// ---------------------------------------------------------------------------
// Accès
// ---------------------------------------------------------------------------

const INDEX_BESOIN = new Map<Besoin, number>(BESOINS.map((b, i) => [b, i]));
const INDEX_TRAIT = new Map<Trait, number>(TRAITS.map((t, i) => [t, i]));

export function besoin(p: Personnage, nom: Besoin): number {
  return p.besoins[INDEX_BESOIN.get(nom) ?? 0] ?? 0;
}

export function trait(p: Personnage, nom: Trait): number {
  return p.traits[INDEX_TRAIT.get(nom) ?? 0] ?? 0;
}

/** Trait ramené dans [0, 1] : la forme qu'attendent les courbes de réponse. */
export function traitNormalise(p: Personnage, nom: Trait): number {
  return (trait(p, nom) + 100) / 200;
}

/**
 * Borne, mais N'ARRONDIT PAS.
 *
 * L'arrondi paraissait anodin — un besoin entier se lit mieux, se sérialise
 * mieux, et la première version le faisait. Le banc d'essai a montré qu'il
 * cassait la propriété la plus importante du modèle : `round(288 × 2,875)`
 * vaut 828, mais arrondir 288 fois de suite donne 864. Autrement dit, un
 * personnage simulé tick par tick vieillissait 4 % plus vite que le même
 * personnage simulé par journées repliées — sa vie aurait dépendu de la
 * distance à laquelle se trouvait le joueur.
 *
 * Les besoins sont donc des flottants. La règle « des entiers dans l'état »
 * reste valable pour ce qui se compte — l'argent, les identifiants, le temps —
 * et cède pour ce qui est une PRESSION CONTINUE. L'arrondi n'a plus lieu qu'à
 * l'affichage.
 */
export function fixerBesoin(p: Personnage, nom: Besoin, valeur: number): void {
  const i = INDEX_BESOIN.get(nom);
  if (i === undefined) return;
  p.besoins[i] = Math.max(0, Math.min(BESOIN_MAX, valeur));
}

export function ajouterBesoin(p: Personnage, nom: Besoin, delta: number): void {
  fixerBesoin(p, nom, besoin(p, nom) + delta);
}

export function nomComplet(p: Personnage): string {
  return `${p.prenom} ${p.nom}`;
}

/** Raccourci de lecture. Le lieu est dans la position, jamais dupliqué ailleurs. */
export function lieuDe(p: Personnage): Position['lieu'] {
  return p.position.lieu;
}
