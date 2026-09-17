/**
 * La dérive des besoins.
 *
 * C'est le moteur du temps vécu : sans dérive, un personnage qui a mangé une
 * fois n'a plus jamais faim, et la journée n'a plus de forme.
 *
 * Les vitesses ci-dessous sont modulées par les traits. Ce n'est pas un
 * détail cosmétique : c'est ce qui fait qu'un solitaire et un sociable placés
 * dans les mêmes conditions ne vivent pas la même journée. Le sociable voit
 * son besoin social monter presque deux fois plus vite, donc il sort — non
 * parce qu'une règle dit « les sociables sortent », mais parce que la
 * solitude lui coûte davantage.
 */

import type { Besoin, Personnage } from '../../etat/personnage.ts';
import { BESOINS, ajouterBesoin, traitNormalise } from '../../etat/personnage.ts';

/** Pression gagnée par tick de cinq minutes, hors modulation. */
export const DERIVE_BASE: Readonly<Record<Besoin, number>> = {
  // Une nuit de sept heures doit couvrir exactement une journée d'éveil.
  // À 5,2, elle ne suffisait pas : les habitants complétaient par des
  // siestes et dormaient 11,7 h par jour, ce qui mangeait leurs journées.
  energie: 4.0,
  // À 7, la faim passait 47 % du temps au-dessus du seuil critique : les
  // habitants vivaient affamés en permanence et leur routine se brisait sans
  // cesse. Deux repas et demi doivent couvrir une journée.
  faim: 4.5,
  hygiene: 2,
  social: 2.5,
  // À 2, la pression de plaisir restait à 129 sur 1000 en moyenne : personne
  // ne cherchait jamais à se faire plaisir, donc personne ne sortait, ne se
  // promenait ni n'allait boire un verre. Une société où le divertissement
  // n'a aucune valeur n'est pas plus sobre, elle est fausse.
  plaisir: 3.1,
  accomplissement: 1,
  // Presque statique : la sécurité bouge par événements, pas par le temps.
  // Assez toutefois pour qu'on refasse ses courses environ une fois par
  // semaine, au lieu d'une fois par mois.
  securite: 0.35,
};

/**
 * Modulation par les traits, en multiplicateur autour de 1.
 * `sociabilite` à fond donne ×1,8 sur le besoin social, à l'opposé ×0,5.
 */
function modulation(p: Personnage, b: Besoin): number {
  switch (b) {
    case 'social':
      return 0.5 + 1.3 * traitNormalise(p, 'sociabilite');
    case 'accomplissement':
      return 0.5 + 1.3 * traitNormalise(p, 'ambition');
    case 'plaisir':
      return 0.7 + 0.8 * traitNormalise(p, 'ouverture');
    case 'hygiene':
      return 0.7 + 0.6 * traitNormalise(p, 'discipline');
    case 'securite':
      return 0.6 + 1.0 * traitNormalise(p, 'prudence');
    default:
      return 1;
  }
}

/**
 * Applique la dérive sur `pas` ticks.
 *
 * Le paramètre `pas` est ce qui rend les échelles de simulation possibles :
 * replier une heure ou une journée d'un coup donne exactement le même
 * résultat que la simuler tick par tick, puisque la dérive est linéaire. Tout
 * ce qui entre dans un besoin doit conserver cette propriété, sans quoi
 * promouvoir un personnage d'une échelle à l'autre changerait son état.
 */
export function deriver(p: Personnage, pas: number): void {
  if (pas <= 0) return;
  for (const b of BESOINS) {
    ajouterBesoin(p, b, DERIVE_BASE[b] * modulation(p, b) * pas);
  }
}

/** Dérive théorique d'un besoin sur une journée entière, pour l'équilibrage. */
export function derivePourJournee(p: Personnage, b: Besoin): number {
  return DERIVE_BASE[b] * modulation(p, b) * 288;
}
