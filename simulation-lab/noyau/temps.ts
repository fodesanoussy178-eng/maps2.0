/**
 * Le temps.
 *
 * Une seule unité dans toute la simulation : le TICK, qui vaut cinq minutes
 * de temps de jeu. Rien n'est jamais mesuré en secondes réelles, en images,
 * ni en millisecondes. L'horloge de la machine ne pilote pas la simulation :
 * elle se contente de dire combien de ticks sont dus.
 *
 * Le calendrier — heure, jour, mois, année, saison — n'est JAMAIS stocké. Il
 * est recalculé depuis le tick à chaque lecture. C'est un peu de calcul, et
 * en échange il devient impossible qu'une date se désynchronise du temps
 * simulé, ce qui arrive systématiquement dans les jeux qui gardent les deux.
 */

export const MINUTES_PAR_TICK = 5;
export const TICKS_PAR_HEURE = 12;
export const TICKS_PAR_JOUR = 288;
export const TICKS_PAR_SEMAINE = TICKS_PAR_JOUR * 7;

/** Année de départ par défaut d'une partie. Purement cosmétique. */
export const ANNEE_EPOQUE = 2000;

/**
 * Pas d'années bissextiles. Le décalage avec le calendrier réel est d'un jour
 * tous les quatre ans, ce qu'aucun système du jeu ne peut percevoir — aucun
 * n'a de raison de dépendre du 29 février. En échange, la conversion
 * tick → date est une arithmétique exacte sur des entiers, donc sans dérive
 * possible sur une partie de plusieurs siècles.
 */
const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
export const JOURS_PAR_AN = 365;
export const TICKS_PAR_AN = JOURS_PAR_AN * TICKS_PAR_JOUR;

export type Saison = 'hiver' | 'printemps' | 'ete' | 'automne';

export interface Calendrier {
  annee: number;
  /** 1..12 */
  mois: number;
  /** 1..31 */
  jour: number;
  /** 0..23 */
  heure: number;
  /** 0..55, multiple de 5 */
  minute: number;
  /** 0..364 */
  jourAnnee: number;
  /** 0 = lundi … 6 = dimanche */
  jourSemaine: number;
  saison: Saison;
}

const NOMS_JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** Reconstitue la date complète depuis le tick. Fonction pure. */
export function calendrier(tick: number, anneeEpoque = ANNEE_EPOQUE): Calendrier {
  const jourTotal = Math.floor(tick / TICKS_PAR_JOUR);
  const dansLeJour = tick - jourTotal * TICKS_PAR_JOUR;

  const annee = Math.floor(jourTotal / JOURS_PAR_AN);
  const jourAnnee = jourTotal - annee * JOURS_PAR_AN;

  let mois = 0;
  let reste = jourAnnee;
  while (mois < 12) {
    const longueur = JOURS_PAR_MOIS[mois] ?? 30;
    if (reste < longueur) break;
    reste -= longueur;
    mois += 1;
  }

  const heure = Math.floor(dansLeJour / TICKS_PAR_HEURE);
  const minute = (dansLeJour - heure * TICKS_PAR_HEURE) * MINUTES_PAR_TICK;

  return {
    annee: anneeEpoque + annee,
    mois: mois + 1,
    jour: reste + 1,
    heure,
    minute,
    jourAnnee,
    // Le 1er janvier de l'année d'époque est un lundi : choix arbitraire, mais
    // fixe, donc les week-ends tombent toujours au même endroit d'une partie
    // rejouée à l'autre.
    jourSemaine: jourTotal % 7,
    saison: saisonDuJour(jourAnnee),
  };
}

function saisonDuJour(jourAnnee: number): Saison {
  if (jourAnnee < 59 || jourAnnee >= 334) return 'hiver';
  if (jourAnnee < 151) return 'printemps';
  if (jourAnnee < 243) return 'ete';
  return 'automne';
}

/** Conversion inverse. Sert aux tests, à la génération et aux dates de naissance. */
export function tickDepuisDate(
  annee: number,
  mois: number,
  jour: number,
  heure = 0,
  minute = 0,
  anneeEpoque = ANNEE_EPOQUE,
): number {
  let jourAnnee = jour - 1;
  for (let m = 0; m < mois - 1; m += 1) jourAnnee += JOURS_PAR_MOIS[m] ?? 30;
  const jourTotal = (annee - anneeEpoque) * JOURS_PAR_AN + jourAnnee;
  return (
    jourTotal * TICKS_PAR_JOUR +
    heure * TICKS_PAR_HEURE +
    Math.floor(minute / MINUTES_PAR_TICK)
  );
}

export function nomJourSemaine(jourSemaine: number): string {
  return NOMS_JOURS[jourSemaine % 7] ?? 'lundi';
}

export function estWeekEnd(tick: number): boolean {
  return Math.floor(tick / TICKS_PAR_JOUR) % 7 >= 5;
}

/** Âge en années révolues. La seule façon correcte de vieillir quelqu'un. */
export function age(tickNaissance: number, tick: number): number {
  return Math.floor((tick - tickNaissance) / TICKS_PAR_AN);
}

/** Heure décimale (13,5 = 13 h 30). Pratique pour les courbes horaires de l'IA. */
export function heureDecimale(tick: number): number {
  const dansLeJour = tick % TICKS_PAR_JOUR;
  return dansLeJour / TICKS_PAR_HEURE;
}

// ---------------------------------------------------------------------------
// Vitesses
// ---------------------------------------------------------------------------

/**
 * À la vitesse ×V, une seconde réelle vaut V minutes de jeu. ×1 fait donc
 * passer une journée en vingt-quatre minutes, et ×500 une année en environ
 * dix-huit minutes.
 */
export const VITESSES = [0, 1, 2, 5, 10, 50, 100, 500] as const;
export type Vitesse = (typeof VITESSES)[number];

export type ModeControle = 'incarne' | 'intention';

/**
 * Au-delà de ×10, le joueur ne peut physiquement plus diriger des pas : une
 * seconde réelle vaut cinquante minutes de jeu. Le contrôle bascule alors de
 * « je déplace mon personnage » à « je pose une intention, il l'exécute ».
 *
 * C'est l'arbitrage de la contradiction C1 (voir docs/01-analyse.md) : le §3
 * et le §14 du cahier des charges ne sont conciliables qu'à cette condition.
 */
export function modeControle(vitesse: Vitesse): ModeControle {
  return vitesse <= 10 ? 'incarne' : 'intention';
}

/**
 * Nombre de ticks à exécuter pour un intervalle réel donné.
 *
 * Le reste est reporté d'une image à l'autre : sans cela, à ×1 (0,2 tick par
 * seconde), l'arrondi mangerait la quasi-totalité du temps et la simulation
 * n'avancerait jamais.
 *
 * Le plafond est un garde-fou contre la spirale de la mort : si une image a
 * pris deux secondes, exécuter deux secondes de rattrapage rendrait l'image
 * suivante encore plus lente. Passé le plafond, on préfère prendre du retard
 * sur le temps réel — ce que personne ne remarque — plutôt que de figer le
 * jeu, ce que tout le monde remarque.
 */
export const TICKS_MAX_PAR_IMAGE = 600;

export interface BudgetTicks {
  ticks: number;
  reste: number;
  /** Vrai si le plafond a mordu : la simulation prend du retard sur l'horloge. */
  sature: boolean;
}

export function ticksDus(vitesse: Vitesse, deltaMsReel: number, reste = 0): BudgetTicks {
  if (vitesse === 0 || deltaMsReel <= 0) {
    return { ticks: 0, reste, sature: false };
  }
  const exact = reste + (deltaMsReel * vitesse) / (MINUTES_PAR_TICK * 1000);
  const ticks = Math.floor(exact);
  if (ticks > TICKS_MAX_PAR_IMAGE) {
    return { ticks: TICKS_MAX_PAR_IMAGE, reste: 0, sature: true };
  }
  return { ticks, reste: exact - ticks, sature: false };
}

/** Rendu lisible : « mardi 14 mars 2001, 08:35 ». */
export function formaterDate(tick: number, anneeEpoque = ANNEE_EPOQUE): string {
  const c = calendrier(tick, anneeEpoque);
  const mm = String(c.minute).padStart(2, '0');
  const hh = String(c.heure).padStart(2, '0');
  return `${nomJourSemaine(c.jourSemaine)} ${c.jour}/${c.mois}/${c.annee}, ${hh}:${mm}`;
}
