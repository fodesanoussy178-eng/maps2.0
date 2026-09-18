/**
 * La scène : le rendu de l'état COURANT du monde.
 *
 * Différence essentielle avec la vue précédente, qui rejouait un
 * enregistrement : ici rien n'est pré-calculé. À chaque image, on lit
 * `monde.personnages`, `monde.lieux`, l'activité en cours et l'heure qu'il
 * est. Si la simulation s'arrête, l'image se fige ; si elle accélère, tout
 * bouge plus vite. Le rendu OBSERVE, il ne raconte pas.
 *
 * La géométrie vient de `vue/ville.ts`, qui donne un corps aux lieux du
 * moteur. Elle reste de la présentation : le monde simulé ne sait toujours pas
 * qu'il a une forme.
 */

import type { LieuId, PersoId } from '../noyau/index.ts';
import { heureDecimale } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import type { Personnage } from '../etat/personnage.ts';
import { age } from '../noyau/index.ts';
import { DUREE_TRAJET } from '../etat/lieu.ts';
import type { Batiment, Ville } from '../vue/ville.ts';
import { batirVille } from '../vue/ville.ts';
import type { Camera, Toile } from './camera.ts';
import { champ, versEcran } from './camera.ts';
import { dessinerHabitant } from './silhouette.ts';

const ACCENT = '#5FB0E8';

const JOUR = {
  route: '#6C7175', marquage: '#C6CABB', trottoir: '#B7BAB3',
  herbe: '#7CA05F', terre: '#A3997F', place: '#C0BCAE', ciel: '#8FA98B',
  facades: ['#D8CEBF', '#C7B8A5', '#BEC6C8', '#D1C1B3', '#B8A896', '#C8CEC1', '#CDBCAE', '#B6BEC2'],
  toits: ['#7A6A5C', '#6D6056', '#877868', '#8C9094', '#6F6458'],
  vitre: '#4E5F6C', vitreAllumee: '#FFD08A',
  feuillage: ['#4E7A46', '#5C8A4E', '#456E40'], tronc: '#6B4F3A',
};
const NUIT = '#16202C';

function hex2(n: number): string {
  const s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
  return s.length < 2 ? `0${s}` : s;
}
function melange(hex: string, cible: string, t: number): string {
  if (t <= 0) return hex;
  if (t >= 1) return cible;
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(cible.slice(1), 16);
  return `#${hex2(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t)}${
    hex2(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t)}${
    hex2((a & 255) * (1 - t) + (b & 255) * t)}`;
}
const assombrir = (hex: string, f: number): string => melange(hex, '#000000', f);

/** Nuit pleine de 21 h à 5 h, transitions douces à l'aube et au crépuscule. */
export function obscuriteDe(heure: number): number {
  if (heure >= 21 || heure < 5) return 0.74;
  if (heure >= 18) return (0.74 * (heure - 18)) / 3;
  if (heure < 8) return 0.74 * (1 - (heure - 5) / 3);
  return 0;
}

export interface Scene {
  ville: Ville;
  /** Cellules de chaussée, pour placer les gens « dans la rue » et cheminer. */
  routes: { r: number; c: number }[];
  cheminsCache: Map<string, { r: number; c: number }[]>;
  /** Dernier sens de déplacement connu, pour orienter les silhouettes. */
  sens: Map<number, number>;
  dernierePos: Map<number, { x: number; y: number }>;
  sol: HTMLCanvasElement | null;
  solObscurite: number;
}

export function creerScene(monde: Monde): Scene {
  const ville = batirVille(monde.lieux.values(), monde.graine);
  const routes: { r: number; c: number }[] = [];
  for (let r = 0; r < ville.rangees; r += 1) {
    for (let c = 0; c < ville.colonnes; c += 1) {
      if (ville.sol[r * ville.colonnes + c] === 'route') routes.push({ r, c });
    }
  }
  return {
    ville, routes,
    cheminsCache: new Map(),
    sens: new Map(),
    dernierePos: new Map(),
    sol: null,
    solObscurite: -1,
  };
}

function proj(v: Ville, c: number, r: number, z = 0): { x: number; y: number } {
  return {
    x: (c - r) * (v.tuile.l / 2) + v.origine.x,
    y: (c + r) * (v.tuile.h / 2) - z + v.origine.y,
  };
}

function batimentDe(s: Scene, lieu: LieuId): Batiment | undefined {
  const i = s.ville.parLieu[lieu as number];
  return i === undefined || i < 0 ? undefined : s.ville.batiments[i];
}

/**
 * La cellule où se trouve quelqu'un, d'après sa POSITION dans l'état du monde.
 *
 * `x` et `y` sont en millièmes de l'emprise du lieu : c'est ici, et seulement
 * ici, qu'ils deviennent une géométrie.
 */
function cellule(s: Scene, p: Personnage): { r: number; c: number } {
  const b = batimentDe(s, p.position.lieu);
  if (b === undefined) {
    // Un lieu sans bâtiment — la rue — répartit ses occupants sur la chaussée.
    const i = (p.position.x * 31 + p.position.y) % Math.max(1, s.routes.length);
    const cel = s.routes[i] ?? { r: 0, c: 0 };
    return { r: cel.r + 0.5, c: cel.c + 0.5 };
  }
  return {
    r: b.r + (p.position.y / 1000) * b.lr,
    c: b.c + (p.position.x / 1000) * b.lc,
  };
}

function entree(s: Scene, lieu: LieuId): { r: number; c: number } {
  const b = batimentDe(s, lieu);
  if (b === undefined) {
    const cel = s.routes[Math.floor(s.routes.length / 2)] ?? { r: 0, c: 0 };
    return { r: cel.r + 0.5, c: cel.c + 0.5 };
  }
  return { r: b.entree.r + 0.5, c: b.entree.c + 0.5 };
}

/** Chemin par la voirie. Recherche en largeur, mise en cache par couple. */
function chemin(s: Scene, a: { r: number; c: number }, b: { r: number; c: number }) {
  const cle = `${Math.round(a.r)},${Math.round(a.c)}|${Math.round(b.r)},${Math.round(b.c)}`;
  const connu = s.cheminsCache.get(cle);
  if (connu !== undefined) return connu;

  const v = s.ville;
  const idx = (p: { r: number; c: number }): number => p.r * v.colonnes + p.c;
  const estRoute = (p: { r: number; c: number }): boolean =>
    p.r >= 0 && p.c >= 0 && p.r < v.rangees && p.c < v.colonnes && v.sol[idx(p)] === 'route';

  const depart = { r: Math.round(a.r - 0.5), c: Math.round(a.c - 0.5) };
  const arrivee = { r: Math.round(b.r - 0.5), c: Math.round(b.c - 0.5) };
  if (!estRoute(depart) || !estRoute(arrivee)) {
    const direct = [a, b];
    s.cheminsCache.set(cle, direct);
    return direct;
  }

  const vus = new Set<number>([idx(depart)]);
  const parent = new Map<number, { r: number; c: number }>();
  const file = [depart];
  let trouve = false;
  while (file.length > 0 && !trouve) {
    const p = file.shift();
    if (p === undefined) break;
    for (const d of [{ r: 1, c: 0 }, { r: -1, c: 0 }, { r: 0, c: 1 }, { r: 0, c: -1 }]) {
      const q = { r: p.r + d.r, c: p.c + d.c };
      if (!estRoute(q) || vus.has(idx(q))) continue;
      vus.add(idx(q));
      parent.set(idx(q), p);
      if (q.r === arrivee.r && q.c === arrivee.c) { trouve = true; break; }
      file.push(q);
    }
  }

  const route: { r: number; c: number }[] = [];
  let cur: { r: number; c: number } | undefined = arrivee;
  let garde = 0;
  while (cur !== undefined && !(cur.r === depart.r && cur.c === depart.c) && garde < 500) {
    route.unshift({ r: cur.r + 0.5, c: cur.c + 0.5 });
    cur = parent.get(idx(cur));
    garde += 1;
  }
  route.unshift(a);
  route.push(b);
  s.cheminsCache.set(cle, route);
  return route;
}

function surChemin(route: { r: number; c: number }[], t: number): { r: number; c: number } {
  if (route.length < 2) return route[0] ?? { r: 0, c: 0 };
  const d = Math.max(0, Math.min(1, t)) * (route.length - 1);
  const i = Math.min(route.length - 2, Math.floor(d));
  const f = d - i;
  const a = route[i] ?? { r: 0, c: 0 };
  const b = route[i + 1] ?? a;
  return { r: a.r + (b.r - a.r) * f, c: a.c + (b.c - a.c) * f };
}

/** Où se trouve un habitant, en pixels monde. En chemin, il est sur la chaussée. */
export function positionDe(s: Scene, monde: Monde, p: Personnage): { x: number; y: number } {
  const a = p.activite;
  if (a !== null && a.type === 'deplacement') {
    const route = chemin(s, entree(s, p.position.lieu), entree(s, a.vers));
    const avance = 1 - (a.jusqua - monde.tick) / DUREE_TRAJET;
    const cel = surChemin(route, avance);
    return proj(s.ville, cel.c, cel.r);
  }
  const cel = cellule(s, p);
  return proj(s.ville, cel.c, cel.r);
}

/** Vrai si l'habitant est dehors, donc visible. Sinon il est aux fenêtres. */
export function estDehors(s: Scene, p: Personnage): boolean {
  if (p.activite !== null && p.activite.type === 'deplacement') return true;
  const b = batimentDe(s, p.position.lieu);
  return b === undefined || b.type === 'parc';
}

// ---------------------------------------------------------------------------
// Le sol, rendu une fois par palier de lumière
// ---------------------------------------------------------------------------

const RESOLUTION_SOL = 2;

function rendreSol(s: Scene, obscurite: number): HTMLCanvasElement {
  const v = s.ville;
  const toile = document.createElement('canvas');
  toile.width = v.largeur * RESOLUTION_SOL;
  toile.height = v.hauteur * RESOLUTION_SOL;
  const g = toile.getContext('2d');
  if (g === null) return toile;
  g.setTransform(RESOLUTION_SOL, 0, 0, RESOLUTION_SOL, 0, 0);

  g.fillStyle = melange(JOUR.ciel, NUIT, obscurite);
  g.fillRect(0, 0, v.largeur, v.hauteur);

  const losange = (c: number, r: number): void => {
    const a = proj(v, c, r), b = proj(v, c + 1, r);
    const d = proj(v, c + 1, r + 1), e = proj(v, c, r + 1);
    g.beginPath();
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(d.x, d.y); g.lineTo(e.x, e.y);
    g.closePath();
  };

  for (let somme = 0; somme <= v.colonnes + v.rangees; somme += 1) {
    for (let r = 0; r < v.rangees; r += 1) {
      const c = somme - r;
      if (c < 0 || c >= v.colonnes) continue;
      const nature = v.sol[r * v.colonnes + c];
      const base = nature === 'route' ? JOUR.route
        : nature === 'trottoir' ? JOUR.trottoir
        : nature === 'herbe' ? JOUR.herbe
        : nature === 'place' ? JOUR.place : JOUR.terre;
      const bruit = ((((r * 73856093) ^ (c * 19349663)) >>> 0) % 100) / 100;
      losange(c, r);
      g.fillStyle = melange(assombrir(base, bruit * 0.055), NUIT, obscurite);
      g.fill();

      if (nature === 'route') {
        g.strokeStyle = melange(assombrir(JOUR.route, 0.25), NUIT, obscurite);
        g.lineWidth = 1; g.stroke();
        const axeH = r % 5 === 0 && c % 5 !== 0;
        const axeV = c % 5 === 0 && r % 5 !== 0;
        if (axeH || axeV) {
          const p1 = axeH ? proj(v, c, r + 0.5) : proj(v, c + 0.5, r);
          const p2 = axeH ? proj(v, c + 1, r + 0.5) : proj(v, c + 0.5, r + 1);
          g.strokeStyle = melange(JOUR.marquage, NUIT, obscurite * 0.7);
          g.lineWidth = 1.6;
          g.setLineDash([7, 8]);
          g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
          g.setLineDash([]);
        }
      } else if (nature === 'trottoir') {
        g.strokeStyle = melange(assombrir(JOUR.trottoir, 0.13), NUIT, obscurite);
        g.lineWidth = 1; g.stroke();
      }
    }
  }
  return toile;
}

// ---------------------------------------------------------------------------
// Le dessin
// ---------------------------------------------------------------------------

export interface OptionsRendu {
  joueur: PersoId | null;
  selection: PersoId | null;
  batimentSurvole: number | null;
  /** Millisecondes réelles, pour le balancement de marche. */
  temps: number;
}

interface Item {
  profondeur: number;
  couche: number;
  dessiner: () => void;
}

export function dessinerScene(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  monde: Monde,
  camera: Camera,
  toile: Toile,
  o: OptionsRendu,
): void {
  const v = s.ville;
  const heure = heureDecimale(monde.tick);
  const obs = obscuriteDe(heure);

  if (s.sol === null || Math.abs(s.solObscurite - obs) > 0.06) {
    s.sol = rendreSol(s, obs);
    s.solObscurite = obs;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = melange(JOUR.ciel, NUIT, obs);
  ctx.fillRect(0, 0, toile.largeur, toile.hauteur);

  const coin = versEcran(camera, toile, 0, 0);
  ctx.drawImage(
    s.sol, coin.x, coin.y,
    v.largeur * camera.zoom, v.hauteur * camera.zoom,
  );

  const vue = champ(camera, toile);
  const visible = (x: number, y: number): boolean =>
    x > vue.x0 && x < vue.x1 && y > vue.y0 && y < vue.y1;

  // Occupation courante, lue dans l'état : c'est elle qui allume les fenêtres.
  const parLieu = new Map<number, number>();
  for (const p of monde.personnages.values()) {
    if (estDehors(s, p)) continue;
    const k = p.position.lieu as number;
    parLieu.set(k, (parLieu.get(k) ?? 0) + 1);
  }

  const items: Item[] = [];

  v.batiments.forEach((b, i) => {
    const centre = proj(v, b.c + b.lc / 2, b.r + b.lr / 2);
    if (!visible(centre.x, centre.y)) return;
    items.push({
      profondeur: b.r + b.lr + b.c + b.lc,
      couche: b.type === 'parc' ? 0 : 2,
      dessiner: () => dessinerBatiment(ctx, s, b, parLieu.get(b.id) ?? 0, obs, i === o.batimentSurvole, camera, toile),
    });
  });

  for (const d of v.decors) {
    const p = proj(v, d.c + 0.5, d.r + 0.5);
    if (!visible(p.x, p.y)) continue;
    items.push({
      profondeur: d.r + d.c + 1,
      couche: 1,
      dessiner: () => dessinerDecor(ctx, s, d, obs, camera, toile),
    });
  }

  for (const p of monde.personnages.values()) {
    if (!estDehors(s, p)) continue;
    const monde2 = positionDe(s, monde, p);
    if (!visible(monde2.x, monde2.y)) continue;

    const precedent = s.dernierePos.get(p.id as number);
    if (precedent !== undefined && Math.abs(monde2.x - precedent.x) > 0.4) {
      s.sens.set(p.id as number, monde2.x > precedent.x ? 1 : -1);
    }
    s.dernierePos.set(p.id as number, monde2);

    const enMarche = p.activite !== null && p.activite.type === 'deplacement';
    const cel = { r: (monde2.y - v.origine.y) / (v.tuile.h / 2), c: 0 };
    items.push({
      profondeur: cel.r + 0.6,
      couche: 3,
      dessiner: () => {
        const e = versEcran(camera, toile, monde2.x, monde2.y);
        dessinerHabitant(ctx, p.apparence, e.x, e.y, camera.zoom, {
          age: age(p.naissance, monde.tick),
          phase: enMarche ? (o.temps / 130 + (p.id as number)) % (Math.PI * 2) : 0,
          sens: s.sens.get(p.id as number) ?? 1,
          obscurite: obs,
          selectionne: p.id === o.selection || p.id === o.joueur,
          accent: p.id === o.joueur ? '#F2C14E' : ACCENT,
        });
      },
    });
  }

  items.sort((a, b) => a.profondeur - b.profondeur || a.couche - b.couche);
  for (const item of items) item.dessiner();
}

function dessinerBatiment(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  b: Batiment,
  occupants: number,
  obs: number,
  surligne: boolean,
  camera: Camera,
  toile: Toile,
): void {
  const v = s.ville;
  const E = (c: number, r: number, z = 0): { x: number; y: number } => {
    const m = proj(v, c, r, z);
    return versEcran(camera, toile, m.x, m.y);
  };

  if (b.type === 'parc') {
    const a = E(b.c, b.r), bb = E(b.c + b.lc, b.r);
    const d = E(b.c + b.lc, b.r + b.lr), e = E(b.c, b.r + b.lr);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(bb.x, bb.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y);
    ctx.closePath();
    ctx.fillStyle = melange(assombrir(JOUR.herbe, 0.05), NUIT, obs);
    ctx.fill();
    if (surligne) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke(); }
    return;
  }

  const H = b.niveaux * v.tuile.etage;
  const facade = JOUR.facades[Math.floor(b.teinte * JOUR.facades.length) % JOUR.facades.length] ?? '#CCC';
  const toit = JOUR.toits[Math.floor(b.teinte * 977) % JOUR.toits.length] ?? '#777';

  const A = E(b.c, b.r, H), B = E(b.c + b.lc, b.r, H);
  const C = E(b.c + b.lc, b.r + b.lr, H), D = E(b.c, b.r + b.lr, H);
  const Bb = E(b.c + b.lc, b.r), Cb = E(b.c + b.lc, b.r + b.lr), Db = E(b.c, b.r + b.lr);

  const face = (p1: typeof A, p2: typeof A, p3: typeof A, p4: typeof A, couleur: string): void => {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
    ctx.closePath(); ctx.fillStyle = couleur; ctx.fill();
  };

  face(D, C, Cb, Db, melange(assombrir(facade, 0.3), NUIT, obs));
  face(C, B, Bb, Cb, melange(assombrir(facade, 0.1), NUIT, obs));

  ctx.beginPath();
  ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y);
  ctx.closePath();
  ctx.fillStyle = melange(toit, NUIT, obs * 0.9); ctx.fill();
  ctx.strokeStyle = melange(assombrir(toit, 0.3), NUIT, obs); ctx.lineWidth = 1; ctx.stroke();

  // Fenêtres : allumées selon l'occupation RÉELLE et l'heure.
  if (camera.zoom > 0.5) {
    const part = occupants === 0 ? 0 : Math.min(1, 0.35 + occupants / Math.max(4, b.capacite));
    const l = 7 * camera.zoom, h = 9 * camera.zoom;
    for (let n = 0; n < b.niveaux; n += 1) {
      const z = (n + 0.5) * v.tuile.etage;
      const poser = (c: number, r: number, gauche: boolean, k: number): void => {
        const p = E(c, r, z);
        const graine = ((((b.id * 7919) ^ (n * 104729) ^ (k * 1299709)) >>> 0) % 100) / 100;
        const allumee = obs > 0.12 && graine < part;
        ctx.beginPath();
        if (gauche) {
          ctx.moveTo(p.x - l / 2, p.y - h / 2 - l / 4); ctx.lineTo(p.x + l / 2, p.y - h / 2 + l / 4);
          ctx.lineTo(p.x + l / 2, p.y + h / 2 + l / 4); ctx.lineTo(p.x - l / 2, p.y + h / 2 - l / 4);
        } else {
          ctx.moveTo(p.x - l / 2, p.y - h / 2 + l / 4); ctx.lineTo(p.x + l / 2, p.y - h / 2 - l / 4);
          ctx.lineTo(p.x + l / 2, p.y + h / 2 - l / 4); ctx.lineTo(p.x - l / 2, p.y + h / 2 + l / 4);
        }
        ctx.closePath();
        ctx.fillStyle = allumee
          ? JOUR.vitreAllumee
          : melange(assombrir(JOUR.vitre, gauche ? 0.25 : 0.05), NUIT, obs);
        ctx.fill();
      };
      for (let k = 0; k < b.lr; k += 1) poser(b.c, b.r + k + 0.5, true, k);
      for (let j = 0; j < b.lc; j += 1) poser(b.c + j + 0.5, b.r + b.lr, false, j + 10);
    }
  }

  if (surligne) {
    ctx.beginPath();
    ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(Bb.x, Bb.y);
    ctx.lineTo(Cb.x, Cb.y); ctx.lineTo(Db.x, Db.y); ctx.lineTo(D.x, D.y);
    ctx.closePath();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.4; ctx.stroke();
  }
}

function dessinerDecor(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  d: Ville['decors'][number],
  obs: number,
  camera: Camera,
  toile: Toile,
): void {
  const m = proj(s.ville, d.c + 0.2 + d.dc * 0.6, d.r + 0.2 + d.dr * 0.6);
  const p = versEcran(camera, toile, m.x, m.y);
  const z = camera.zoom;
  const feuillage = melange(JOUR.feuillage[Math.floor(d.dr * 3) % 3] ?? '#4E7A46', NUIT, obs);

  if (d.genre === 'arbre') {
    ctx.fillStyle = melange(JOUR.tronc, NUIT, obs);
    ctx.fillRect(p.x - 1.5 * z, p.y - 13 * z, 3 * z, 13 * z);
    ctx.beginPath(); ctx.arc(p.x, p.y - 18 * z, 8 * z, 0, Math.PI * 2);
    ctx.fillStyle = feuillage; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x - 4 * z, p.y - 14 * z, 5.5 * z, 0, Math.PI * 2); ctx.fill();
  } else if (d.genre === 'buisson') {
    ctx.beginPath(); ctx.arc(p.x, p.y - 3 * z, 5 * z, 0, Math.PI * 2);
    ctx.fillStyle = feuillage; ctx.fill();
  } else if (d.genre === 'banc') {
    ctx.fillStyle = melange('#8A6E52', NUIT, obs);
    ctx.fillRect(p.x - 6 * z, p.y - 5 * z, 12 * z, 3 * z);
  } else {
    ctx.fillStyle = melange('#6A7075', NUIT, obs * 0.5);
    ctx.fillRect(p.x - z, p.y - 22 * z, 2 * z, 22 * z);
    if (obs > 0.15) {
      const lueur = ctx.createRadialGradient(p.x, p.y - 24 * z, 1, p.x, p.y - 24 * z, 26 * z);
      lueur.addColorStop(0, 'rgba(255,214,150,.5)');
      lueur.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = lueur;
      ctx.beginPath(); ctx.arc(p.x, p.y - 24 * z, 26 * z, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y - 23 * z, 2.6 * z, 0, Math.PI * 2);
    ctx.fillStyle = obs > 0.15 ? '#FFD79A' : '#C9CDBF'; ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Désignation
// ---------------------------------------------------------------------------

export function habitantSous(
  s: Scene, monde: Monde, camera: Camera, toile: Toile, xe: number, ye: number,
): Personnage | null {
  let meilleur: Personnage | null = null;
  let distance = Math.pow(18 * Math.max(0.6, camera.zoom), 2);
  for (const p of monde.personnages.values()) {
    if (!estDehors(s, p)) continue;
    const m = positionDe(s, monde, p);
    const e = versEcran(camera, toile, m.x, m.y);
    const d = (e.x - xe) ** 2 + (e.y - ye - 12 * camera.zoom) ** 2;
    if (d < distance) { distance = d; meilleur = p; }
  }
  return meilleur;
}

export function batimentSous(
  s: Scene, camera: Camera, toile: Toile, xe: number, ye: number,
): { batiment: Batiment; indice: number } | null {
  const v = s.ville;
  const ordre = s.ville.batiments
    .map((b, i) => ({ b, i }))
    .sort((a, z) => (z.b.r + z.b.c) - (a.b.r + a.b.c));

  for (const { b, i } of ordre) {
    const H = b.type === 'parc' ? 0 : b.niveaux * v.tuile.etage;
    const E = (c: number, r: number, z = 0): { x: number; y: number } => {
      const m = proj(v, c, r, z);
      return versEcran(camera, toile, m.x, m.y);
    };
    const poly = [
      E(b.c, b.r, H), E(b.c + b.lc, b.r, H), E(b.c + b.lc, b.r),
      E(b.c + b.lc, b.r + b.lr), E(b.c, b.r + b.lr), E(b.c, b.r + b.lr, H),
    ];
    let dedans = false;
    for (let a = 0, z = poly.length - 1; a < poly.length; z = a++) {
      const pa = poly[a], pz = poly[z];
      if (pa === undefined || pz === undefined) continue;
      if ((pa.y > ye) !== (pz.y > ye) &&
          xe < ((pz.x - pa.x) * (ye - pa.y)) / (pz.y - pa.y) + pa.x) dedans = !dedans;
    }
    if (dedans) return { batiment: b, indice: i };
  }
  return null;
}
