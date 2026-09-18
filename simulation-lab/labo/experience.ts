/**
 * Une expérience : une simulation complète, mesurée, reproductible.
 *
 * C'est l'unité de travail du banc d'essai. Régler une société ne se fait pas
 * en regardant un personnage bouger : ça se fait en lançant trente jours,
 * en lisant trois chiffres, en changeant une courbe et en recommençant. D'où
 * l'exigence du doc 4 : trente jours doivent tenir en quelques secondes,
 * sinon l'équilibrage devient impraticable et le projet s'arrête là.
 */

import { TICKS_PAR_HEURE, TICKS_PAR_JOUR, empreinte } from '../noyau/index.ts';
import type { Echelle } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import type { Violation } from '../etat/invariants.ts';
import { verifierInvariants } from '../etat/invariants.ts';
import { avancer } from '../boucle/boucle.ts';
import { genererMonde } from '../monde/generation.ts';
import type { Metriques } from './metriques.ts';
import { creerMetriques, echantillonner, observateurDe } from './metriques.ts';

export interface OptionsExperience {
  graine: number;
  population: number;
  jours: number;
  /** Échelle appliquée à toute la population. Le vrai jeu les mélangera. */
  echelle?: Echelle;
  /**
   * Vérifier les invariants à chaque heure simulée. Coûteux, donc réservé aux
   * tests et au diagnostic — mais c'est le seul moyen d'attraper une
   * incohérence à l'instant où elle naît.
   */
  verifier?: boolean;
}

export interface Resultat {
  monde: Monde;
  metriques: Metriques;
  violations: Violation[];
  /** Empreinte de l'état final : deux exécutions identiques doivent l'égaler. */
  empreinte: string;
  dureeMs: number;
  jours: number;
  options: OptionsExperience;
}

export function lancer(options: OptionsExperience): Resultat {
  const echelle: Echelle = options.echelle ?? 'micro';
  const { monde } = genererMonde({ graine: options.graine, population: options.population });

  for (const p of monde.personnages.values()) p.echelle = echelle;

  const metriques = creerMetriques();
  const observateur = observateurDe(metriques);
  const violations: Violation[] = [];

  const debut = performance.now();
  const total = options.jours * TICKS_PAR_JOUR;

  // On avance par pas d'une heure : c'est la granularité d'échantillonnage,
  // et cela ne change rien au résultat puisque `avancer` boucle tick par tick.
  for (let ecoule = 0; ecoule < total; ecoule += TICKS_PAR_HEURE) {
    const pas = Math.min(TICKS_PAR_HEURE, total - ecoule);
    avancer(monde, pas, { observateur });
    metriques.ticksSimules += pas;
    echantillonner(metriques, monde);

    if (options.verifier === true && violations.length === 0) {
      violations.push(...verifierInvariants(monde));
    }
  }

  const dureeMs = performance.now() - debut;

  // Vérification finale, toujours : elle coûte une fois et attrape les états
  // que seule la fin d'une longue exécution produit.
  if (violations.length === 0) violations.push(...verifierInvariants(monde));

  return {
    monde,
    metriques,
    violations,
    empreinte: empreinteMonde(monde),
    dureeMs,
    jours: options.jours,
    options,
  };
}

/**
 * Empreinte de l'état du monde.
 *
 * Elle porte sur l'état, pas sur les mesures : deux exécutions qui divergent
 * doivent être détectées même si leurs statistiques agrégées se ressemblent.
 */
export function empreinteMonde(monde: Monde): string {
  return empreinte({
    tick: monde.tick,
    graine: monde.graine,
    personnages: monde.personnages,
    lieux: monde.lieux,
  });
}
