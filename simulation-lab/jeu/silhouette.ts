/**
 * Le dessin d'un habitant, à partir de son apparence.
 *
 * Tout vient de `Apparence`, qui est dans l'état du monde : deux habitants ne
 * se ressemblent pas parce que le rendu les tire au sort, mais parce qu'ils
 * sont différents. C'est ce qui fera qu'un enfant ressemblera à ses parents le
 * jour où l'hérédité existera, sans toucher une ligne d'ici.
 *
 * Volontairement simple : un corps, une tête, une coiffure, deux couleurs de
 * vêtement, quelques accessoires, et un balancement de marche à deux temps.
 * Pas d'atlas pré-calculé pour cette version — il faudra y venir vers le
 * millier d'habitants, et rien ici ne l'empêchera.
 */

import type { Apparence } from '../etat/apparence.ts';

/** Rampe de teintes de peau, du plus clair au plus foncé. */
const PEAU = ['#F4DCC4', '#EBC9A6', '#D9AA81', '#BE8759', '#96643E', '#6E472B', '#4C3020'];
const CHEVEUX = ['#1B1512', '#3A2A20', '#5E4534', '#8A6438', '#B58A4A', '#C9A227', '#7A2E1E', '#8E8E96'];

function rampe(palette: readonly string[], teinte: number): string {
  const i = Math.min(palette.length - 1, Math.floor((teinte / 256) * palette.length));
  return palette[i] ?? palette[0] ?? '#888';
}

function tissu(teinte: number, clarte: number): string {
  return `hsl(${Math.round((teinte / 256) * 360)} 42% ${clarte}%)`;
}

export interface OptionsSilhouette {
  /** Âge en années : les enfants sont plus petits et ont la tête plus grosse. */
  age: number;
  /** 0 = immobile, sinon phase de marche en radians. */
  phase: number;
  /** -1 vers la gauche de l'écran, +1 vers la droite. */
  sens: number;
  /** Assombrissement de nuit, 0..1. */
  obscurite: number;
  selectionne: boolean;
  /** Teinte d'accent pour le contour de sélection. */
  accent: string;
}

function assombrir(couleur: string, f: number): string {
  if (f <= 0) return couleur;
  return `color-mix(in srgb, ${couleur}, #16202C ${Math.round(f * 100)}%)`;
}

/**
 * Dessine un habitant, pieds au point (x, y), à l'échelle donnée.
 *
 * `echelle` vaut 1 au zoom nominal ; en dessous de 0,6 on se contente d'une
 * pastille, parce que les détails deviennent du bruit et coûtent cher.
 */
export function dessinerHabitant(
  ctx: CanvasRenderingContext2D,
  a: Apparence,
  x: number,
  y: number,
  echelle: number,
  o: OptionsSilhouette,
): void {
  const enfant = o.age < 14;
  const grandeur = (o.age < 6 ? 0.62 : enfant ? 0.78 : 1) * (a.genes.tailleCm / 175);
  const largeur = (1 + a.genes.corpulence / 320) * (enfant ? 0.85 : 1);

  const h = 22 * echelle * grandeur;
  const l = 7 * echelle * largeur;

  // Ombre : ce qui ancre le personnage au sol en vue isométrique.
  ctx.beginPath();
  ctx.ellipse(x, y, l * 0.9, l * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fill();

  if (echelle < 0.6) {
    ctx.beginPath();
    ctx.arc(x, y - h * 0.4, Math.max(2, l * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = assombrir(tissu(a.garderobe.teinteHaut, 58), o.obscurite * 0.4);
    ctx.fill();
    return;
  }

  const peau = assombrir(rampe(PEAU, a.genes.teintePeau), o.obscurite * 0.45);
  const cheveux = assombrir(rampe(CHEVEUX, a.genes.teinteCheveux), o.obscurite * 0.45);
  const haut = assombrir(tissu(a.garderobe.teinteHaut, 56), o.obscurite * 0.4);
  const bas = assombrir(tissu(a.garderobe.teinteBas, 40), o.obscurite * 0.4);

  const balancement = Math.sin(o.phase) * l * 0.35;
  const contour = 'rgba(14,22,30,.5)';

  ctx.lineWidth = Math.max(0.6, echelle * 0.9);
  ctx.strokeStyle = contour;

  // --- jambes ---------------------------------------------------------------
  const hJambe = h * 0.34;
  ctx.fillStyle = bas;
  for (const cote of [-1, 1]) {
    const dx = cote * l * 0.32 + (o.phase === 0 ? 0 : cote * balancement * 0.6);
    ctx.beginPath();
    ctx.rect(x + dx - l * 0.2, y - hJambe, l * 0.4, hJambe);
    ctx.fill();
    ctx.stroke();
  }

  // --- torse ---------------------------------------------------------------
  const hTorse = h * 0.36;
  ctx.fillStyle = haut;
  ctx.beginPath();
  ctx.moveTo(x - l * 0.62, y - hJambe);
  ctx.lineTo(x + l * 0.62, y - hJambe);
  ctx.lineTo(x + l * 0.52, y - hJambe - hTorse);
  ctx.lineTo(x - l * 0.52, y - hJambe - hTorse);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- bras ----------------------------------------------------------------
  ctx.fillStyle = haut;
  for (const cote of [-1, 1]) {
    const dy = o.phase === 0 ? 0 : -cote * balancement * 0.5;
    ctx.beginPath();
    ctx.rect(x + cote * l * 0.66 - l * 0.13, y - hJambe - hTorse + dy, l * 0.26, hTorse * 0.9);
    ctx.fill();
    ctx.stroke();
  }

  // --- tête ----------------------------------------------------------------
  const rTete = l * (enfant ? 0.72 : 0.6);
  const yTete = y - hJambe - hTorse - rTete * 0.85;
  ctx.fillStyle = peau;
  ctx.beginPath();
  ctx.arc(x, yTete, rTete, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  dessinerCoiffure(ctx, a.genes.coiffure, x, yTete, rTete, cheveux, o.sens);

  // --- accessoires ----------------------------------------------------------
  if (a.accessoires & 1) {           // lunettes
    ctx.strokeStyle = 'rgba(20,30,40,.75)';
    ctx.lineWidth = Math.max(0.5, echelle * 0.7);
    ctx.beginPath();
    ctx.moveTo(x - rTete * 0.7, yTete - rTete * 0.05);
    ctx.lineTo(x + rTete * 0.7, yTete - rTete * 0.05);
    ctx.stroke();
  }
  if (a.accessoires & 2) {           // sac
    ctx.fillStyle = assombrir('#6B4F3A', o.obscurite * 0.4);
    ctx.beginPath();
    ctx.rect(x + o.sens * l * 0.7, y - hJambe - hTorse * 0.5, l * 0.3, hTorse * 0.5);
    ctx.fill();
  }
  if (a.accessoires & 4) {           // chapeau
    ctx.fillStyle = assombrir(tissu(a.garderobe.teinteBas, 30), o.obscurite * 0.4);
    ctx.beginPath();
    ctx.ellipse(x, yTete - rTete * 0.75, rTete * 1.35, rTete * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (a.accessoires & 8) {           // canne
    ctx.strokeStyle = assombrir('#7A5B3C', o.obscurite * 0.4);
    ctx.lineWidth = Math.max(0.7, echelle);
    ctx.beginPath();
    ctx.moveTo(x + l * 0.9, y);
    ctx.lineTo(x + l * 0.9, y - h * 0.55);
    ctx.stroke();
  }
  if (a.accessoires & 16) {          // écharpe
    ctx.fillStyle = assombrir(tissu(a.garderobe.teinteHaut + 80, 50), o.obscurite * 0.4);
    ctx.beginPath();
    ctx.rect(x - l * 0.5, y - hJambe - hTorse - rTete * 0.15, l, rTete * 0.4);
    ctx.fill();
  }

  if (o.selectionne) {
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, l * 1.5, l * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Douze coiffures, faites de deux ou trois formes. Assez pour se reconnaître. */
function dessinerCoiffure(
  ctx: CanvasRenderingContext2D,
  indice: number,
  x: number,
  y: number,
  r: number,
  couleur: string,
  sens: number,
): void {
  ctx.fillStyle = couleur;
  const calotte = (ouverture: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.06, Math.PI, Math.PI * 2 - ouverture);
    ctx.closePath();
    ctx.fill();
  };

  switch (indice % 12) {
    case 0: break;                                   // rasé
    case 1: calotte(0); break;                       // très court
    case 2:
      calotte(0);
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.5, r * 1.1, r * 0.9, 0, 0, Math.PI); ctx.fill();
      break;                                         // mi-long
    case 3:
      calotte(0);
      ctx.beginPath(); ctx.rect(x - r * 1.1, y - r * 0.2, r * 2.2, r * 1.9); ctx.fill();
      break;                                         // long
    case 4:
      calotte(0);
      ctx.beginPath(); ctx.arc(x, y - r * 1.1, r * 0.55, 0, Math.PI * 2); ctx.fill();
      break;                                         // chignon
    case 5:
      calotte(0.5);
      break;                                         // dégagé d'un côté
    case 6:
      calotte(0);
      ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.4);
      ctx.lineTo(x + r * 1.3, y - r * 0.9); ctx.lineTo(x + r * 0.4, y - r * 1.5); ctx.closePath(); ctx.fill();
      break;                                         // mèche
    case 7:
      ctx.beginPath(); ctx.arc(x, y - r * 0.25, r * 1.25, Math.PI, Math.PI * 2); ctx.fill();
      break;                                         // volume
    case 8:
      calotte(0);
      ctx.beginPath(); ctx.ellipse(x + sens * r * 0.9, y + r * 0.6, r * 0.4, r * 1, 0, 0, Math.PI * 2); ctx.fill();
      break;                                         // queue de côté
    case 9:
      ctx.beginPath(); ctx.arc(x, y, r * 1.3, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();
      break;                                         // dégarni
    case 10:
      calotte(0);
      ctx.beginPath(); ctx.ellipse(x, y + r * 1.2, r * 0.8, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      break;                                         // natte basse
    default:
      calotte(0);
      ctx.beginPath(); ctx.ellipse(x, y - r * 0.2, r * 1.35, r * 0.75, 0, Math.PI, Math.PI * 2); ctx.fill();
      break;                                         // bouffant
  }
}
