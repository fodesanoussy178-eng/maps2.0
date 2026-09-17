/**
 * L'apparence.
 *
 * Elle est dans l'ÉTAT DU MONDE et non dans le rendu, et ce n'est pas un choix
 * esthétique : le §19 du cahier des charges demande que les enfants
 * ressemblent à leurs parents sans en être des copies. Une apparence
 * reconstruite à l'affichage à partir d'un identifiant ne se transmet pas, ne
 * se sauvegarde pas, et il faudrait tout refaire au moment des générations.
 *
 * Deux parts nettement séparées, parce qu'elles n'obéissent pas aux mêmes
 * règles :
 *
 *   GÈNES     ce qui se transmet. Un enfant les tirera de la moyenne de ses
 *             parents, plus un bruit, plus une régression vers la moyenne.
 *   ACQUIS    ce qui change au cours d'une vie — la garde-robe, les
 *             accessoires — et qui ne se transmet pas.
 *
 * Tout est ENTIER et BORNÉ. Trois raisons : la sauvegarde reste compacte, le
 * rejeu déterministe ne dépend d'aucun arrondi, et surtout le rendu pourra
 * pré-calculer un atlas de silhouettes — ce qui n'est possible que si le
 * nombre de combinaisons est fini. Une teinte libre par habitant rendrait
 * l'atlas inutilisable.
 *
 * Ce fichier ne contient AUCUNE hérédité : la génétique viendra avec la phase
 * des générations. Il contient la structure qui la rendra possible.
 */

/**
 * Tailles des répertoires de formes.
 *
 * Elles vivent ici et nulle part ailleurs : la validation, la génération et,
 * plus tard, l'atlas du rendu doivent s'accorder sur les mêmes nombres. Une
 * coiffure numéro 14 dans un répertoire de douze est un bug silencieux qui ne
 * se voit qu'à l'écran.
 */
export const REPERTOIRES = {
  coiffures: 12,
  hauts: 8,
  bas: 6,
  /** Nombre de bits utilisés dans le masque `accessoires`. */
  accessoires: 5,
} as const;

/** Un accessoire par bit. Un habitant peut en porter plusieurs. */
export const ACCESSOIRES = ['lunettes', 'sac', 'chapeau', 'canne', 'echarpe'] as const;
export type Accessoire = (typeof ACCESSOIRES)[number];

/** La part transmissible. C'est elle, et elle seule, qu'un enfant héritera. */
export interface Genes {
  /** 0..255 — position sur une rampe de teintes de peau, pas une couleur libre. */
  teintePeau: number;
  /** 0..255 — idem pour les cheveux. */
  teinteCheveux: number;
  /** Indice dans le répertoire de coiffures. */
  coiffure: number;
  /** -100..100 — de très mince à très corpulent. */
  corpulence: number;
  /** Taille adulte visée, en centimètres. La taille courante en dépendra avec l'âge. */
  tailleCm: number;
}

/** Ce qu'on porte. Change au cours d'une vie, ne se transmet pas. */
export interface Garderobe {
  haut: number;
  bas: number;
  teinteHaut: number;
  teinteBas: number;
}

export interface Apparence {
  genes: Genes;
  garderobe: Garderobe;
  /** Masque de bits sur ACCESSOIRES. */
  accessoires: number;
}

export const BORNES = {
  teinte: [0, 255],
  corpulence: [-100, 100],
  tailleCm: [140, 205],
} as const;

const dans = (v: number, min: number, max: number): boolean =>
  Number.isInteger(v) && v >= min && v <= max;

/**
 * Valide une apparence. Sert aux invariants et aux tests : une apparence hors
 * bornes ne plante rien, elle produit un habitant invisible ou monstrueux,
 * des mois plus tard, dans une partie qu'on ne sait plus rejouer.
 */
export function apparenceValide(a: Apparence): string[] {
  const fautes: string[] = [];
  const g = a.genes;

  if (!dans(g.teintePeau, 0, 255)) fautes.push(`teintePeau=${g.teintePeau}`);
  if (!dans(g.teinteCheveux, 0, 255)) fautes.push(`teinteCheveux=${g.teinteCheveux}`);
  if (!dans(g.coiffure, 0, REPERTOIRES.coiffures - 1)) fautes.push(`coiffure=${g.coiffure}`);
  if (!dans(g.corpulence, -100, 100)) fautes.push(`corpulence=${g.corpulence}`);
  if (!dans(g.tailleCm, BORNES.tailleCm[0], BORNES.tailleCm[1])) fautes.push(`tailleCm=${g.tailleCm}`);

  const v = a.garderobe;
  if (!dans(v.haut, 0, REPERTOIRES.hauts - 1)) fautes.push(`haut=${v.haut}`);
  if (!dans(v.bas, 0, REPERTOIRES.bas - 1)) fautes.push(`bas=${v.bas}`);
  if (!dans(v.teinteHaut, 0, 255)) fautes.push(`teinteHaut=${v.teinteHaut}`);
  if (!dans(v.teinteBas, 0, 255)) fautes.push(`teinteBas=${v.teinteBas}`);

  const maxAccessoires = (1 << REPERTOIRES.accessoires) - 1;
  if (!dans(a.accessoires, 0, maxAccessoires)) fautes.push(`accessoires=${a.accessoires}`);

  return fautes;
}

export function porte(a: Apparence, accessoire: Accessoire): boolean {
  const i = ACCESSOIRES.indexOf(accessoire);
  return i >= 0 && (a.accessoires & (1 << i)) !== 0;
}
