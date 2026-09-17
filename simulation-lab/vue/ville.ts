/**
 * La ville.
 *
 * Le moteur ne connaît qu'un graphe de lieux : « le café », « le bureau
 * nord ». Ce fichier lui donne un corps — une trame de rues, des îlots, des
 * bâtiments en volume, des trottoirs, des arbres. C'est de la PRÉSENTATION :
 * rien de ce qui est ici n'entre dans l'état du monde, et la simulation
 * tourne exactement pareil sans.
 *
 * La disposition précédente alignait des rectangles étiquetés sur un plan.
 * C'était lisible et ça ne ressemblait à rien : un diagramme, pas un endroit
 * où l'on habite. Une simulation de vie a besoin qu'on reconnaisse la ville
 * pour avoir envie d'y regarder quelqu'un vivre.
 *
 * Tout est dessiné par le code : pas un seul élément graphique emprunté à qui
 * que ce soit, conformément au §41 du cahier des charges.
 */

import type { Lieu, TypeLieu } from '../etat/lieu.ts';

export type Sol = 'route' | 'trottoir' | 'herbe' | 'place' | 'terre';

export interface Batiment {
  id: number;
  nom: string;
  type: TypeLieu;
  capacite: number;
  /** Origine de l'emprise, en cellules. */
  r: number;
  c: number;
  /** Taille de l'emprise. */
  lr: number;
  lc: number;
  niveaux: number;
  /** Cellule de rue devant la porte : c'est de là qu'on entre et qu'on sort. */
  entree: { r: number; c: number };
  /** Variation de teinte, stable, pour que deux immeubles ne soient pas jumeaux. */
  teinte: number;
}

export interface Decor {
  r: number;
  c: number;
  genre: 'arbre' | 'lampadaire' | 'banc' | 'buisson';
  /** Décalage dans la cellule, pour éviter l'alignement au cordeau. */
  dr: number;
  dc: number;
}

export interface Ville {
  colonnes: number;
  rangees: number;
  tuile: { l: number; h: number; etage: number };
  origine: { x: number; y: number };
  largeur: number;
  hauteur: number;
  /** `colonnes * rangees` natures de sol, en ligne d'abord. */
  sol: Sol[];
  batiments: Batiment[];
  decors: Decor[];
  /** Indice de bâtiment par identifiant de lieu. */
  parLieu: Record<number, number>;
}

// Ville plus large et tuiles plus petites : avec trente colonnes, les
// trente-trois bâtiments ne tenaient qu'en se touchant, et les tours se
// masquaient les unes les autres — une ville illisible en vue isométrique.
const COLONNES = 36;
const RANGEES = 26;
const PAS_RUE = 5;
const TUILE = { l: 38, h: 19, etage: 20 };

/** Emprise et hauteur par type de lieu. Ce qui donne sa silhouette au quartier. */
const GABARIT: Record<TypeLieu, { lr: number; lc: number; niveaux: [number, number] }> = {
  logement: { lr: 2, lc: 2, niveaux: [2, 5] },
  bureau: { lr: 2, lc: 4, niveaux: [5, 7] },
  ecole: { lr: 3, lc: 4, niveaux: [2, 2] },
  cafe: { lr: 2, lc: 2, niveaux: [1, 2] },
  commerce: { lr: 2, lc: 3, niveaux: [1, 1] },
  gymnase: { lr: 3, lc: 3, niveaux: [2, 2] },
  parc: { lr: 4, lc: 4, niveaux: [0, 0] },
  rue: { lr: 0, lc: 0, niveaux: [0, 0] },
};

/** Ordre de placement : les grandes emprises d'abord, sinon elles ne rentrent plus. */
const ORDRE: TypeLieu[] = ['parc', 'ecole', 'bureau', 'gymnase', 'commerce', 'cafe', 'logement'];

const estRue = (r: number, c: number): boolean => r % PAS_RUE === 0 || c % PAS_RUE === 0;

/** Suite déterministe : même monde, même ville, jusqu'à l'arbre près. */
function des(graine: number): () => number {
  let x = (graine * 2654435761) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

export function batirVille(lieux: Iterable<Lieu>, graine: number): Ville {
  const tirage = des(graine);
  const tous = [...lieux];

  // --- le sol ---------------------------------------------------------------
  // Les cœurs d'îlot sont des jardins, pas des terrains vagues : c'est ce
  // qu'on voit entre les immeubles, et du beige y faisait chantier.
  const sol: Sol[] = new Array(COLONNES * RANGEES).fill('herbe');
  const solDe = (r: number, c: number): number => r * COLONNES + c;

  for (let r = 0; r < RANGEES; r += 1) {
    for (let c = 0; c < COLONNES; c += 1) {
      if (estRue(r, c)) sol[solDe(r, c)] = 'route';
    }
  }
  // Un trottoir tout autour de chaque îlot : c'est ce qui fait lire la rue
  // comme une rue plutôt que comme un couloir gris.
  for (let r = 0; r < RANGEES; r += 1) {
    for (let c = 0; c < COLONNES; c += 1) {
      if (estRue(r, c)) continue;
      const borde =
        estRue(r - 1, c) || estRue(r + 1, c) || estRue(r, c - 1) || estRue(r, c + 1);
      if (borde) sol[solDe(r, c)] = 'trottoir';
    }
  }

  // --- les îlots ------------------------------------------------------------
  interface Ilot { r: number; c: number; lr: number; lc: number; pris: boolean[] }
  const ilots: Ilot[] = [];
  for (let r = 1; r + PAS_RUE - 1 <= RANGEES; r += PAS_RUE) {
    for (let c = 1; c + PAS_RUE - 1 <= COLONNES; c += PAS_RUE) {
      const lr = PAS_RUE - 1;
      const lc = PAS_RUE - 1;
      if (r + lr > RANGEES || c + lc > COLONNES) continue;
      ilots.push({ r, c, lr, lc, pris: new Array(lr * lc).fill(false) });
    }
  }

  const batiments: Batiment[] = [];
  const parLieu: Record<number, number> = {};

  // Les îlots sont servis à tour de rôle. En les remplissant dans l'ordre, les
  // trente-trois bâtiments s'entassaient dans le coin nord et la moitié de la
  // ville restait vide.
  let prochainIlot = 0;

  const placer = (lieu: Lieu): boolean => {
    const g = GABARIT[lieu.type];
    if (g.lr === 0) return false;

    const tournee: Ilot[] = [];
    for (let i = 0; i < ilots.length; i += 1) {
      const ilot = ilots[(prochainIlot + i) % ilots.length];
      if (ilot !== undefined) tournee.push(ilot);
    }

    for (const ilot of tournee) {
      for (let dr = 0; dr + g.lr <= ilot.lr; dr += 1) {
        for (let dc = 0; dc + g.lc <= ilot.lc; dc += 1) {
          let libre = true;
          for (let a = 0; a < g.lr && libre; a += 1) {
            for (let b = 0; b < g.lc; b += 1) {
              if (ilot.pris[(dr + a) * ilot.lc + (dc + b)]) { libre = false; break; }
            }
          }
          if (!libre) continue;

          // On réserve aussi une bande d'une cellule autour : deux immeubles
          // qui se touchent se masquent mutuellement en isométrie.
          for (let a = -1; a <= g.lr; a += 1) {
            for (let b = -1; b <= g.lc; b += 1) {
              const ar = dr + a;
              const ac = dc + b;
              if (ar < 0 || ac < 0 || ar >= ilot.lr || ac >= ilot.lc) continue;
              ilot.pris[ar * ilot.lc + ac] = true;
            }
          }
          prochainIlot = (ilots.indexOf(ilot) + 1) % ilots.length;

          const r = ilot.r + dr;
          const c = ilot.c + dc;
          const niveaux =
            g.niveaux[0] + Math.floor(tirage() * (g.niveaux[1] - g.niveaux[0] + 1));

          batiments.push({
            id: lieu.id as number,
            nom: lieu.nom,
            type: lieu.type,
            capacite: lieu.capacite,
            r, c, lr: g.lr, lc: g.lc,
            niveaux,
            entree: porteLaPlusProche(r, c, g.lr, g.lc),
            teinte: tirage(),
          });
          parLieu[lieu.id as number] = batiments.length - 1;

          if (lieu.type === 'parc') {
            for (let a = 0; a < g.lr; a += 1) {
              for (let b = 0; b < g.lc; b += 1) sol[solDe(r + a, c + b)] = 'herbe';
            }
          }
          return true;
        }
      }
    }
    return false;
  };

  for (const type of ORDRE) {
    for (const lieu of tous) {
      if (lieu.type !== type) continue;
      placer(lieu);
    }
  }

  // La rue elle-même est un lieu du moteur : on l'ancre sur un carrefour, et
  // les habitants qui « sont dans la rue » s'y répartissent vraiment.
  const rue = tous.find((l) => l.type === 'rue');
  if (rue !== undefined) {
    parLieu[rue.id as number] = -1;
  }

  // --- le décor -------------------------------------------------------------
  const decors: Decor[] = [];
  const occupe = new Set<number>();
  for (const b of batiments) {
    for (let a = 0; a < b.lr; a += 1) {
      for (let d = 0; d < b.lc; d += 1) occupe.add(solDe(b.r + a, b.c + d));
    }
  }

  for (let r = 1; r < RANGEES - 1; r += 1) {
    for (let c = 1; c < COLONNES - 1; c += 1) {
      const i = solDe(r, c);
      if (occupe.has(i)) continue;
      const nature = sol[i];

      if (nature === 'herbe') {
        if (tirage() < 0.5) {
          decors.push({ r, c, genre: tirage() < 0.7 ? 'arbre' : 'buisson', dr: tirage(), dc: tirage() });
        }
        if (tirage() < 0.12) decors.push({ r, c, genre: 'banc', dr: tirage(), dc: tirage() });
        continue;
      }
      if (nature === 'trottoir') {
        if (tirage() < 0.16) decors.push({ r, c, genre: 'arbre', dr: 0.5, dc: 0.5 });
        else if (tirage() < 0.1) decors.push({ r, c, genre: 'lampadaire', dr: 0.5, dc: 0.5 });
        continue;
      }
      if (nature === 'terre' && tirage() < 0.3) {
        decors.push({ r, c, genre: 'buisson', dr: tirage(), dc: tirage() });
      }
    }
  }

  const largeur = (COLONNES + RANGEES) * (TUILE.l / 2) + 40;
  const origine = { x: RANGEES * (TUILE.l / 2) + 20, y: 190 };
  const hauteur = (COLONNES + RANGEES) * (TUILE.h / 2) + origine.y + 40;

  return {
    colonnes: COLONNES,
    rangees: RANGEES,
    tuile: TUILE,
    origine,
    largeur: Math.round(largeur),
    hauteur: Math.round(hauteur),
    sol,
    batiments,
    decors,
    parLieu,
  };
}

/**
 * La rue devant la porte. On la cherche d'abord au sud puis à l'est : dans une
 * vue isométrique ce sont les façades visibles, et une porte qu'on ne voit pas
 * donne l'impression que les gens traversent les murs.
 */
function porteLaPlusProche(r: number, c: number, lr: number, lc: number): { r: number; c: number } {
  const candidats = [
    { r: r + lr, c: c + Math.floor(lc / 2) },
    { r: r + Math.floor(lr / 2), c: c + lc },
    { r: r - 1, c: c + Math.floor(lc / 2) },
    { r: r + Math.floor(lr / 2), c: c - 1 },
  ];
  for (const p of candidats) {
    if (p.r < 0 || p.c < 0 || p.r >= RANGEES || p.c >= COLONNES) continue;
    if (estRue(p.r, p.c)) return p;
  }
  // Repli : le carrefour de l'îlot.
  return { r: Math.max(0, r - (r % PAS_RUE)), c: Math.max(0, c - (c % PAS_RUE)) };
}
