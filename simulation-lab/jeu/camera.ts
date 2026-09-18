/**
 * La caméra.
 *
 * Elle ne connaît que des coordonnées MONDE en pixels (la sortie de la
 * projection isométrique) et la taille de la toile. Elle ne dessine rien et
 * ne lit pas l'état du jeu : c'est une transformation, et son inverse.
 *
 * L'inverse compte autant que l'aller. Sans lui, la désignation à la souris
 * se fait par une règle de trois qui cesse d'être vraie dès qu'on zoome — le
 * genre de dette qui oblige plus tard à reprendre chaque fonction de clic.
 */

export interface Camera {
  /** Point du monde qui se trouve au centre de l'écran. */
  cx: number;
  cy: number;
  zoom: number;
  /** Personnage suivi. La caméra glisse vers lui à chaque image. */
  suivi: number | null;
}

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3;

export function creerCamera(cx: number, cy: number, zoom = 1): Camera {
  return { cx, cy, zoom, suivi: null };
}

export interface Toile {
  largeur: number;
  hauteur: number;
}

export function versEcran(c: Camera, t: Toile, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - c.cx) * c.zoom + t.largeur / 2,
    y: (y - c.cy) * c.zoom + t.hauteur / 2,
  };
}

export function versMonde(c: Camera, t: Toile, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - t.largeur / 2) / c.zoom + c.cx,
    y: (y - t.hauteur / 2) / c.zoom + c.cy,
  };
}

/** Le rectangle du monde actuellement visible, élargi d'une marge. */
export function champ(c: Camera, t: Toile, marge = 160): {
  x0: number; y0: number; x1: number; y1: number;
} {
  const demiL = t.largeur / (2 * c.zoom) + marge;
  const demiH = t.hauteur / (2 * c.zoom) + marge;
  return { x0: c.cx - demiL, y0: c.cy - demiH, x1: c.cx + demiL, y1: c.cy + demiH };
}

export function deplacer(c: Camera, dxEcran: number, dyEcran: number): void {
  c.cx -= dxEcran / c.zoom;
  c.cy -= dyEcran / c.zoom;
  c.suivi = null;
}

/**
 * Zoome en gardant sous le curseur le point du monde qui s'y trouvait.
 *
 * Sans cela, zoomer recentre sur le milieu de l'écran et on perd ce qu'on
 * regardait — le défaut le plus agaçant d'une caméra de jeu.
 */
export function zoomer(c: Camera, t: Toile, facteur: number, xEcran: number, yEcran: number): void {
  const avant = versMonde(c, t, xEcran, yEcran);
  c.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * facteur));
  const apres = versMonde(c, t, xEcran, yEcran);
  c.cx += avant.x - apres.x;
  c.cy += avant.y - apres.y;
}

/** Glisse vers la cible suivie. Un dixième par image : assez souple, jamais mou. */
export function suivre(c: Camera, x: number, y: number, douceur = 0.12): void {
  c.cx += (x - c.cx) * douceur;
  c.cy += (y - c.cy) * douceur;
}

export function borner(c: Camera, largeurMonde: number, hauteurMonde: number): void {
  c.cx = Math.max(-200, Math.min(largeurMonde + 200, c.cx));
  c.cy = Math.max(-200, Math.min(hauteurMonde + 200, c.cy));
}
