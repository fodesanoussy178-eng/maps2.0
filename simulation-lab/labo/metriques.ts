/**
 * Les mesures.
 *
 * Un banc d'essai qui ne mesure rien est une démonstration. Ce qu'on veut
 * savoir d'une société simulée n'est pas « est-ce que ça tourne » — ça tourne
 * toujours — mais : les journées ont-elles une FORME, les habitants
 * diffèrent-ils les uns des autres, et les routines se brisent-elles parfois ?
 *
 * Les trois chiffres qui comptent vraiment sont plus bas : la stabilité de
 * routine, l'écart entre tempéraments, et le taux d'optimalité. Les autres
 * servent surtout à comprendre pourquoi ceux-là vont mal.
 */

import type { PersoId } from '../noyau/index.ts';
import { TICKS_PAR_JOUR, heureDecimale } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import type { Besoin, Personnage } from '../etat/personnage.ts';
import { BESOINS, SEUIL_CRITIQUE, besoin } from '../etat/personnage.ts';
import type { Observateur } from '../boucle/boucle.ts';

export interface Metriques {
  /** Ticks passés par action, toutes personnes confondues. */
  tempsParAction: Map<string, number>;
  /** Par personne et par heure du jour : ticks passés sur chaque action. */
  creneaux: Map<PersoId, Map<string, number>[]>;
  interactionsPar: Map<PersoId, number>;
  echecs: Map<string, number>;
  reveils: number;
  decisions: number;
  decisionsOptimales: number;
  /** Somme et nombre d'échantillons, par besoin. */
  besoinsSomme: Map<Besoin, number>;
  besoinsCritiques: Map<Besoin, number>;
  echantillons: number;
  ticksSimules: number;
}

export function creerMetriques(): Metriques {
  return {
    tempsParAction: new Map(),
    creneaux: new Map(),
    interactionsPar: new Map(),
    echecs: new Map(),
    reveils: 0,
    decisions: 0,
    decisionsOptimales: 0,
    besoinsSomme: new Map(BESOINS.map((b) => [b, 0])),
    besoinsCritiques: new Map(BESOINS.map((b) => [b, 0])),
    echantillons: 0,
    ticksSimules: 0,
  };
}

const incrementer = <K>(m: Map<K, number>, cle: K, de = 1): void => {
  m.set(cle, (m.get(cle) ?? 0) + de);
};

export function observateurDe(m: Metriques): Observateur {
  return {
    surActivite: (monde, p, activite, ticks) => {
      if (ticks <= 0) return;
      incrementer(m.tempsParAction, activite, ticks);

      let parHeure = m.creneaux.get(p.id);
      if (parHeure === undefined) {
        parHeure = Array.from({ length: 24 }, () => new Map<string, number>());
        m.creneaux.set(p.id, parHeure);
      }
      const h = Math.floor(heureDecimale(monde.tick)) % 24;
      const creneau = parHeure[h];
      if (creneau !== undefined) incrementer(creneau, activite, ticks);
    },
    surReveil: () => {
      m.reveils += 1;
    },
    surInteraction: (_monde, p) => {
      incrementer(m.interactionsPar, p.id);
    },
    surDecision: (_monde, _p, choisie, meilleure) => {
      m.decisions += 1;
      if (choisie === meilleure) m.decisionsOptimales += 1;
    },
    surEchec: (_monde, _p, raison) => {
      incrementer(m.echecs, raison);
    },
  };
}

/** Échantillonne l'état des besoins. Appelé une fois par heure simulée. */
export function echantillonner(m: Metriques, monde: Monde): void {
  for (const p of monde.personnages.values()) {
    for (const b of BESOINS) {
      const v = besoin(p, b);
      incrementer(m.besoinsSomme, b, v);
      if (v >= SEUIL_CRITIQUE) incrementer(m.besoinsCritiques, b, 1);
    }
  }
  m.echantillons += monde.personnages.size;
}

// ---------------------------------------------------------------------------
// Indicateurs dérivés
// ---------------------------------------------------------------------------

/**
 * Stabilité de routine, entre 0 et 1.
 *
 * Pour chaque heure du jour, on regarde quelle est l'activité DOMINANTE de la
 * personne à cette heure-là, et quelle part de son temps elle y consacre
 * réellement. La moyenne sur les vingt-quatre heures donne un nombre qui dit
 * exactement ce qu'on veut savoir :
 *
 *   ~1,0  emploi du temps de robot — la personnalité ne sert à rien
 *   ~0,3  chaos — aucune habitude, donc aucune vie reconnaissable
 *   0,55 à 0,85  une routine réelle, qui se brise parfois
 *
 * C'est la mesure la plus importante du banc d'essai, parce qu'elle est la
 * seule à distinguer une simulation vivante d'un ordonnanceur de tâches.
 */
export function stabiliteRoutine(m: Metriques, id: PersoId): number {
  const parHeure = m.creneaux.get(id);
  if (parHeure === undefined) return 0;

  let somme = 0;
  let creneauxRemplis = 0;
  for (const creneau of parHeure) {
    let total = 0;
    let dominante = 0;
    for (const ticks of creneau.values()) {
      total += ticks;
      if (ticks > dominante) dominante = ticks;
    }
    if (total === 0) continue;
    somme += dominante / total;
    creneauxRemplis += 1;
  }
  return creneauxRemplis === 0 ? 0 : somme / creneauxRemplis;
}

export function stabiliteMoyenne(m: Metriques, monde: Monde): number {
  let somme = 0;
  for (const id of monde.personnages.keys()) somme += stabiliteRoutine(m, id);
  return monde.personnages.size === 0 ? 0 : somme / monde.personnages.size;
}

export function heuresParJour(m: Metriques, action: string, monde: Monde): number {
  const ticks = m.tempsParAction.get(action) ?? 0;
  const jours = m.ticksSimules / TICKS_PAR_JOUR;
  const n = monde.personnages.size;
  if (jours <= 0 || n === 0) return 0;
  return ticks / 12 / jours / n;
}

export function besoinMoyen(m: Metriques, b: Besoin): number {
  if (m.echantillons === 0) return 0;
  return (m.besoinsSomme.get(b) ?? 0) / m.echantillons;
}

export function partCritique(m: Metriques, b: Besoin): number {
  if (m.echantillons === 0) return 0;
  return (m.besoinsCritiques.get(b) ?? 0) / m.echantillons;
}

export function interactionsParJour(m: Metriques, p: Personnage, jours: number): number {
  if (jours <= 0) return 0;
  return (m.interactionsPar.get(p.id) ?? 0) / jours;
}
