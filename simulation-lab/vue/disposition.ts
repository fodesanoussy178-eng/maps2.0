/**
 * La disposition du quartier.
 *
 * Le moteur ne connaît pas la géométrie : pour lui, le monde est un graphe de
 * lieux. Les coordonnées ci-dessous sont donc de la PRÉSENTATION, calculées
 * pour la vue et jamais rangées dans l'état du monde. Le jour où une vraie
 * carte de tuiles existera, elle remplacera ce fichier sans toucher à une
 * ligne de simulation.
 *
 * La disposition est déterministe : même monde, même plan.
 */

import type { Lieu, TypeLieu } from '../etat/lieu.ts';

export interface Boite {
  id: number;
  nom: string;
  type: TypeLieu;
  capacite: number;
  x: number;
  y: number;
  l: number;
  h: number;
}

export interface Plan {
  largeur: number;
  hauteur: number;
  boites: Boite[];
  /** Bandes de voirie, dessinées sous les bâtiments. */
  routes: { x: number; y: number; l: number; h: number }[];
}

const LARGEUR = 1280;
const HAUTEUR = 820;

interface Bande {
  types: readonly TypeLieu[];
  y: number;
  hauteur: number;
  colonnes: number;
}

/**
 * Trois bandes d'habitat et d'activité, séparées par des rues. L'ordre n'est
 * pas décoratif : on veut lire d'un coup d'œil où les gens dorment, où ils
 * travaillent et où ils se retrouvent.
 */
const BANDES: readonly Bande[] = [
  { types: ['logement'], y: 46, hauteur: 74, colonnes: 12 },
  { types: ['bureau', 'ecole'], y: 470, hauteur: 118, colonnes: 4 },
  { types: ['cafe', 'commerce', 'gymnase'], y: 664, hauteur: 110, colonnes: 5 },
];

export function disposer(lieux: Iterable<Lieu>): Plan {
  const tous = [...lieux];
  const boites: Boite[] = [];

  const routes = [
    { x: 0, y: 372, l: LARGEUR, h: 62 },   // rue principale, est-ouest
    { x: 0, y: 610, l: LARGEUR, h: 40 },   // desserte sud
  ];

  for (const bande of BANDES) {
    const dedans = tous.filter((l) => bande.types.includes(l.type));
    if (dedans.length === 0) continue;

    const colonnes = Math.min(bande.colonnes, dedans.length);
    const lignes = Math.ceil(dedans.length / colonnes);
    const marge = 30;
    const gouttiere = 14;
    const largeurUtile = LARGEUR - marge * 2;
    const l = (largeurUtile - gouttiere * (colonnes - 1)) / colonnes;

    dedans.forEach((lieu, i) => {
      const col = i % colonnes;
      const ligne = Math.floor(i / colonnes);
      boites.push({
        id: lieu.id as number,
        nom: lieu.nom,
        type: lieu.type,
        capacite: lieu.capacite,
        x: marge + col * (l + gouttiere),
        y: bande.y + ligne * (bande.hauteur + gouttiere),
        l,
        h: bande.hauteur,
      });
    });

    // Une rue sous chaque rangée de logements, pour que le plan respire.
    if (bande.types[0] === 'logement' && lignes > 1) {
      for (let ligne = 1; ligne < lignes; ligne += 1) {
        routes.push({
          x: 0,
          y: bande.y + ligne * (bande.hauteur + gouttiere) - gouttiere - 4,
          l: LARGEUR,
          h: 12,
        });
      }
    }
  }

  // Le parc occupe la bande libre entre les logements et la rue principale.
  // Il était placé plus bas et chevauchait les bureaux : les habitants du parc
  // se dessinaient par-dessus les murs de l'école, et les noms des bâtiments
  // disparaissaient sous la pelouse.
  const parc = tous.find((l) => l.type === 'parc');
  if (parc !== undefined) {
    boites.push({
      id: parc.id as number,
      nom: parc.nom,
      type: 'parc',
      capacite: parc.capacite,
      x: 30,
      y: 224,
      l: LARGEUR - 60,
      h: 130,
    });
  }

  // La rue est la rue : on l'ancre sur la bande de voirie principale.
  const rue = tous.find((l) => l.type === 'rue');
  if (rue !== undefined) {
    boites.push({
      id: rue.id as number,
      nom: rue.nom,
      type: 'rue',
      capacite: rue.capacite,
      x: 0,
      y: 372,
      l: LARGEUR,
      h: 62,
    });
  }

  return { largeur: LARGEUR, hauteur: HAUTEUR, boites, routes };
}
