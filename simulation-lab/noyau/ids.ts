/**
 * Identifiants.
 *
 * Tous les identifiants du monde sont des entiers, mais un identifiant de
 * personnage n'est pas un identifiant de lieu. Le marquage de type ci-dessous
 * coûte zéro octet à l'exécution — c'est une pure fiction du compilateur — et
 * empêche l'erreur la plus coûteuse d'une simulation de ce genre : passer un
 * identifiant au mauvais système et ne s'en apercevoir qu'à la relecture d'une
 * partie de trente ans.
 */

declare const marque: unique symbol;

type Marque<T, N extends string> = T & { readonly [marque]: N };

export type PersoId = Marque<number, 'perso'>;
export type LieuId = Marque<number, 'lieu'>;
export type CarteId = Marque<number, 'carte'>;
export type FaitId = Marque<number, 'fait'>;
export type EpisodeId = Marque<number, 'episode'>;
export type OrgId = Marque<number, 'org'>;
export type PosteId = Marque<number, 'poste'>;
export type LogementId = Marque<number, 'logement'>;
export type FoyerId = Marque<number, 'foyer'>;
export type LigneeId = Marque<number, 'lignee'>;
export type EvenementId = Marque<number, 'evenement'>;

/**
 * Les identifiants sont distribués par un compteur monotone porté par le
 * monde, jamais par un aléa ni par une horloge : deux parties rejouées avec
 * la même graine doivent attribuer exactement les mêmes numéros.
 */
export interface Compteur {
  prochain: number;
}

export function creerCompteur(depart = 1): Compteur {
  return { prochain: depart };
}

export function attribuer<T extends number>(compteur: Compteur): T {
  const valeur = compteur.prochain;
  compteur.prochain += 1;
  return valeur as T;
}
