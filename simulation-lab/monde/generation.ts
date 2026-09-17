/**
 * Génération du monde d'essai.
 *
 * Une petite ville cohérente plutôt qu'un grand monde vide, conformément au
 * §2 du cahier des charges. Tout est dérivé de la graine : deux appels avec
 * la même graine produisent le même monde, jusqu'au prénom du dernier
 * habitant.
 *
 * Les habitants ne sont pas tirés au hasard indépendamment les uns des
 * autres : l'âge détermine l'occupation, l'occupation détermine les horaires
 * et le revenu, et le foyer regroupe des gens qui ont des raisons de vivre
 * ensemble. Une population tirée trait par trait donnerait une moyenne
 * grise ; ce sont les corrélations qui font une société.
 */

import type { Alea, LieuId, PersoId } from '../noyau/index.ts';
import {
  TICKS_PAR_AN,
  attribuer,
  choisir,
  creerFlux,
  entier,
  flottant,
  normal,
} from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import { creerMonde } from '../etat/monde.ts';
import type { Lieu, TypeLieu } from '../etat/lieu.ts';
import type { Occupation, Personnage } from '../etat/personnage.ts';
import { BESOINS, TRAITS } from '../etat/personnage.ts';
import { installer } from '../etat/transactions.ts';

const PRENOMS_F = [
  'Sarah', 'Julie', 'Amina', 'Claire', 'Nadia', 'Léa', 'Fatou', 'Manon',
  'Inès', 'Camille', 'Awa', 'Sophie', 'Yasmine', 'Élodie', 'Nour', 'Chloé',
] as const;

const PRENOMS_M = [
  'Paul', 'Marc', 'Ibrahim', 'Thomas', 'Karim', 'Lucas', 'Mamadou', 'Hugo',
  'Samir', 'Antoine', 'Youssef', 'Julien', 'Ousmane', 'Nicolas', 'Reda', 'Théo',
] as const;

const NOMS = [
  'Bernard', 'Diallo', 'Moreau', 'Lefèvre', 'Benali', 'Garnier', 'Traoré',
  'Rousseau', 'Chevalier', 'Haddad', 'Girard', 'Camara', 'Fontaine', 'Mercier',
  'Ziani', 'Barre', 'Leclerc', 'Sissoko', 'Perrin', 'Dumont',
] as const;

interface ModeleLieu {
  nom: string;
  type: TypeLieu;
  capacite: number;
  ouvertureH: number;
  fermetureH: number;
}

function ajouterLieu(monde: Monde, modele: ModeleLieu): Lieu {
  const id = attribuer<LieuId>(monde.compteur);
  const lieu: Lieu = {
    id,
    nom: modele.nom,
    type: modele.type,
    capacite: modele.capacite,
    occupants: [],
    ouvertureH: modele.ouvertureH,
    fermetureH: modele.fermetureH,
  };
  monde.lieux.set(id, lieu);
  return lieu;
}

export interface OptionsGeneration {
  graine: number;
  /** Nombre d'habitants. Le cahier des charges vise 50 à 100. */
  population: number;
  /** Tick de départ. Par défaut lundi 7 h, pour commencer une journée normale. */
  tickDepart?: number;
}

export interface MondeGenere {
  monde: Monde;
  logements: Lieu[];
  bureaux: Lieu[];
  ecole: Lieu;
}

/** Lundi 1er janvier, 7 heures du matin. */
export const DEPART_PAR_DEFAUT = 7 * 12;

export function genererMonde(options: OptionsGeneration): MondeGenere {
  const { graine, population } = options;
  const monde = creerMonde(graine, options.tickDepart ?? DEPART_PAR_DEFAUT);

  // --- Les lieux ------------------------------------------------------------
  const nbLogements = Math.max(4, Math.ceil(population / 2.6));
  const logements: Lieu[] = [];
  for (let i = 0; i < nbLogements; i += 1) {
    logements.push(
      ajouterLieu(monde, {
        nom: `logement ${i + 1}`,
        type: 'logement',
        capacite: 6,
        ouvertureH: 0,
        fermetureH: 24,
      }),
    );
  }

  const bureaux = [
    ajouterLieu(monde, { nom: 'bureau nord', type: 'bureau', capacite: 30, ouvertureH: 6, fermetureH: 21 }),
    ajouterLieu(monde, { nom: 'atelier sud', type: 'bureau', capacite: 30, ouvertureH: 6, fermetureH: 21 }),
  ];
  const ecole = ajouterLieu(monde, {
    nom: 'école du quartier',
    type: 'ecole',
    capacite: 60,
    ouvertureH: 7,
    fermetureH: 18,
  });

  ajouterLieu(monde, { nom: 'café de la place', type: 'cafe', capacite: 24, ouvertureH: 7, fermetureH: 24 });
  ajouterLieu(monde, { nom: 'bistrot du coin', type: 'cafe', capacite: 18, ouvertureH: 11, fermetureH: 24 });
  ajouterLieu(monde, { nom: 'supérette', type: 'commerce', capacite: 16, ouvertureH: 8, fermetureH: 20 });
  ajouterLieu(monde, { nom: 'salle de sport', type: 'gymnase', capacite: 20, ouvertureH: 6, fermetureH: 22 });
  ajouterLieu(monde, { nom: 'parc central', type: 'parc', capacite: 200, ouvertureH: 0, fermetureH: 24 });
  ajouterLieu(monde, { nom: 'rue principale', type: 'rue', capacite: 200, ouvertureH: 0, fermetureH: 24 });

  // --- Les habitants --------------------------------------------------------
  for (let i = 0; i < population; i += 1) {
    const r = creerFlux(graine, 'habitant', i);
    const p = creerHabitant(monde, r, logements, bureaux, ecole);
    monde.personnages.set(p.id, p);
    installer(monde, p, p.domicile);
  }

  return { monde, logements, bureaux, ecole };
}

function creerHabitant(
  monde: Monde,
  r: Alea,
  logements: readonly Lieu[],
  bureaux: readonly Lieu[],
  ecole: Lieu,
): Personnage {
  const id = attribuer<PersoId>(monde.compteur);
  const sexe = flottant(r) < 0.5 ? 'f' : 'm';

  // Pyramide des âges grossière mais plausible : des enfants, des actifs, des
  // retraités. Une population entièrement adulte donnerait une ville sans
  // école et sans transmission — donc sans le §19.
  const tirageAge = flottant(r);
  const age =
    tirageAge < 0.24
      ? entier(r, 6, 18)
      : tirageAge < 0.82
        ? entier(r, 18, 65)
        : entier(r, 65, 88);

  const traits = TRAITS.map(() =>
    Math.max(-100, Math.min(100, Math.round(normal(r, 0, 42)))),
  );

  // Les besoins de départ ne sont pas nuls : une population qui s'éveille
  // parfaitement comblée met deux jours à produire un comportement normal.
  const besoins = BESOINS.map(() => entier(r, 80, 420));

  const domicile = choisir(r, logements) ?? logements[0];
  const occupation = tirerOccupation(r, age, bureaux, ecole);

  return {
    id,
    prenom: choisir(r, sexe === 'f' ? PRENOMS_F : PRENOMS_M) ?? 'Alex',
    nom: choisir(r, NOMS) ?? 'Martin',
    naissance: monde.tick - age * TICKS_PAR_AN - entier(r, 0, TICKS_PAR_AN),
    sexe,
    traits,
    besoins,
    lieu: (domicile?.id ?? 0) as LieuId,
    domicile: (domicile?.id ?? 0) as LieuId,
    occupation,
    argent: Math.round(normal(r, age < 18 ? 40 : 900, age < 18 ? 20 : 500)),
    activite: null,
    echelle: 'micro',
    derniereMaj: monde.tick,
  };
}

function tirerOccupation(
  r: Alea,
  age: number,
  bureaux: readonly Lieu[],
  ecole: Lieu,
): Occupation {
  if (age < 18) {
    return { type: 'etudes', lieu: ecole.id, debutH: 8, finH: 16 };
  }
  if (age >= 65) return { type: 'aucune' };

  // 12 % d'inactifs parmi les adultes : sans eux, tout le monde a la même
  // journée et la ville n'a plus d'habitants disponibles en journée.
  if (flottant(r) < 0.12) return { type: 'aucune' };

  const bureau = choisir(r, bureaux) ?? bureaux[0];
  const horaires = [
    { debutH: 8, finH: 17 },
    { debutH: 9, finH: 18 },
    { debutH: 7, finH: 15 },
    { debutH: 10, finH: 19 },
  ] as const;
  const h = choisir(r, horaires) ?? horaires[0];

  return {
    type: 'emploi',
    lieu: (bureau?.id ?? ecole.id) as LieuId,
    debutH: h.debutH,
    finH: h.finH,
    salaireHoraire: Math.max(9, Math.round(normal(r, 17, 6))),
  };
}
