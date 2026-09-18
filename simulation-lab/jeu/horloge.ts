/**
 * L'horloge du jeu.
 *
 * Elle branche enfin `ticksDus`, écrit et testé depuis le premier jour sans
 * que rien ne l'appelle. C'est le point où le temps réel rencontre le temps
 * simulé — et le seul.
 *
 * La règle qui en découle : **la simulation ne sait pas qu'un écran existe.**
 * L'horloge convertit un intervalle réel et une vitesse en un NOMBRE DE TICKS,
 * et ce nombre est la seule chose que le moteur reçoit. Deux machines de
 * puissances différentes, ou une image sautée, ne changent donc rien à ce qui
 * se passe dans le monde : elles changent seulement le moment où on le
 * regarde.
 */

import type { Vitesse } from '../noyau/index.ts';
import { ticksDus } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import type { OptionsBoucle } from '../boucle/boucle.ts';
import { avancer } from '../boucle/boucle.ts';

/** Les vitesses offertes au joueur. 0 = pause. */
export const VITESSES_JEU = [0, 1, 4, 12, 40] as const;
export type VitesseJeu = (typeof VITESSES_JEU)[number];

export interface Horloge {
  vitesse: VitesseJeu;
  /** Fraction de tick reportée d'une image à l'autre. */
  reste: number;
  /** Ticks exécutés depuis le début de la partie. Sert aux tests et au diagnostic. */
  ticksExecutes: number;
  /** Vrai quand le plafond anti-spirale a mordu à la dernière image. */
  sature: boolean;
}

export function creerHorloge(vitesse: VitesseJeu = 1): Horloge {
  return { vitesse, reste: 0, ticksExecutes: 0, sature: false };
}

/**
 * Avance le monde de ce que vaut `deltaMsReel` à la vitesse courante.
 *
 * Renvoie le nombre de ticks réellement exécutés — zéro en pause, zéro aussi
 * quand l'intervalle est trop court pour valoir un tick entier, le reste étant
 * alors reporté.
 */
export function battre(
  horloge: Horloge,
  monde: Monde,
  deltaMsReel: number,
  options: OptionsBoucle = {},
): number {
  const budget = ticksDus(horloge.vitesse as Vitesse, deltaMsReel, horloge.reste);
  horloge.reste = budget.reste;
  horloge.sature = budget.sature;
  if (budget.ticks <= 0) return 0;

  avancer(monde, budget.ticks, options);
  horloge.ticksExecutes += budget.ticks;
  return budget.ticks;
}

export function enPause(horloge: Horloge): boolean {
  return horloge.vitesse === 0;
}
