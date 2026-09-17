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

import type { Alea, FoyerId, LieuId, PersoId, PosteId } from '../noyau/index.ts';
import {
  TICKS_PAR_AN,
  attribuer,
  choisir,
  creerFlux,
  entier,
  flottant,
  melangerTableau,
  normal,
} from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import { creerMonde } from '../etat/monde.ts';
import type { Lieu, TypeLieu } from '../etat/lieu.ts';
import type { Personnage } from '../etat/personnage.ts';
import { BESOINS, TRAITS } from '../etat/personnage.ts';
import type { Apparence } from '../etat/apparence.ts';
import { REPERTOIRES } from '../etat/apparence.ts';
import { creerPosition } from '../etat/position.ts';
import { creerFoyer } from '../etat/foyer.ts';
import type { Poste } from '../etat/poste.ts';
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

  // --- Les postes -----------------------------------------------------------
  // Créés AVANT les habitants, et en nombre fini : un poste existe parce qu'un
  // lieu peut l'accueillir, pas parce que quelqu'un en a besoin. C'est ce qui
  // rend l'échec possible sans tricher.
  creerPostes(monde, graine, bureaux, ecole);

  // --- Les habitants --------------------------------------------------------
  // Trois passes, dans cet ordre, parce que chacune a besoin du résultat de la
  // précédente : on ne peut pas constituer un foyer avant de savoir qui habite
  // où, ni attribuer un poste avant de connaître l'âge de chacun.
  const habitants: Personnage[] = [];
  const logementChoisi: LieuId[] = [];

  // Le logement est tiré parmi ceux qui ont encore de la place. Sans ce
  // filtre, le générateur produisait des immeubles à sept habitants pour six
  // places : une incohérence dès la création du monde, qu'aucune transaction
  // n'aurait pu rattraper ensuite puisque personne ne déménage.
  const occupation = new Map<number, number>();
  for (let i = 0; i < population; i += 1) {
    const r = creerFlux(graine, 'habitant', i);
    const libres = logements.filter(
      (l) => (occupation.get(l.id as number) ?? 0) < l.capacite,
    );
    const logement = choisir(r, libres) ?? libres[0] ?? logements[0];
    const idLogement = (logement?.id ?? 0) as LieuId;
    occupation.set(idLogement as number, (occupation.get(idLogement as number) ?? 0) + 1);
    habitants.push(creerHabitant(monde, r, idLogement));
    logementChoisi.push(idLogement);
  }

  // Passe 2 : les foyers. Un foyer par logement effectivement habité — un
  // logement vide n'a pas de foyer, sinon l'invariant « un foyer a des
  // membres » serait faux dès la création.
  const foyerParLogement = new Map<number, FoyerId>();
  habitants.forEach((p, i) => {
    const idLogement = logementChoisi[i];
    if (idLogement === undefined) return;
    let idFoyer = foyerParLogement.get(idLogement as number);
    if (idFoyer === undefined) {
      idFoyer = attribuer<FoyerId>(monde.compteur);
      monde.foyers.set(idFoyer, creerFoyer(idFoyer, idLogement));
      foyerParLogement.set(idLogement as number, idFoyer);
    }
    p.foyer = idFoyer;
    monde.foyers.get(idFoyer)?.membres.push(p.id);
  });

  // Passe 3 : l'attribution des postes. Les postes sont mélangés une fois avec
  // un flux du monde puis distribués dans l'ordre : déterministe, et sans
  // parcourir la liste des vacants pour chaque habitant.
  attribuerPostes(monde, graine, habitants);

  // Passe 4 : l'installation, qui fixe la position complète.
  habitants.forEach((p, i) => {
    monde.personnages.set(p.id, p);
    const idLogement = logementChoisi[i];
    if (idLogement !== undefined) installer(monde, p, idLogement);
  });

  return { monde, logements, bureaux, ecole };
}

const METIERS = [
  'employé de bureau', 'comptable', 'technicien', 'magasinier', 'commercial',
  'gestionnaire', 'agent d\'accueil', 'ouvrier', 'assistant', 'chargé de projet',
] as const;

function creerPostes(monde: Monde, graine: number, bureaux: readonly Lieu[], ecole: Lieu): void {
  const r = creerFlux(graine, 'postes');
  const horaires = [
    { debutH: 8, finH: 17 },
    { debutH: 9, finH: 18 },
    { debutH: 7, finH: 15 },
    { debutH: 10, finH: 19 },
  ] as const;

  for (const bureau of bureaux) {
    for (let i = 0; i < bureau.capacite; i += 1) {
      const h = choisir(r, horaires) ?? horaires[0];
      const id = attribuer<PosteId>(monde.compteur);
      const poste: Poste = {
        id,
        genre: 'emploi',
        intitule: `${choisir(r, METIERS) ?? 'employé'} — ${bureau.nom}`,
        lieu: bureau.id,
        debutH: h.debutH,
        finH: h.finH,
        salaireHoraire: Math.max(9, Math.round(normal(r, 17, 6))),
        titulaire: null,
      };
      monde.postes.set(id, poste);
    }
  }

  for (let i = 0; i < ecole.capacite; i += 1) {
    const id = attribuer<PosteId>(monde.compteur);
    monde.postes.set(id, {
      id,
      genre: 'etudes',
      intitule: `place d'élève — ${ecole.nom}`,
      lieu: ecole.id,
      debutH: 8,
      finH: 16,
      // Une place d'élève ne rapporte rien : c'est un poste au sens de la
      // rareté, pas au sens du revenu.
      salaireHoraire: 0,
      titulaire: null,
    });
  }
}

/**
 * Attribue les postes vacants.
 *
 * Quand il n'y en a plus, l'habitant reste sans occupation — et c'est le
 * comportement voulu : le travail est une ressource finie. Le générateur ne
 * fabrique pas de poste pour faire plaisir à un habitant, et c'est ainsi que
 * la pénurie devient visible au lieu d'être masquée.
 */
function attribuerPostes(monde: Monde, graine: number, habitants: readonly Personnage[]): void {
  const r = creerFlux(graine, 'attribution-postes');
  const vacants = (genre: 'emploi' | 'etudes'): Poste[] =>
    melangerTableau(r, [...monde.postes.values()].filter((x) => x.genre === genre));

  const emplois = vacants('emploi');
  const places = vacants('etudes');
  let iEmploi = 0;
  let iPlace = 0;

  for (const p of habitants) {
    const age = Math.floor((monde.tick - p.naissance) / TICKS_PAR_AN);
    let poste: Poste | undefined;

    if (age < 18) {
      poste = places[iPlace];
      if (poste !== undefined) iPlace += 1;
    } else if (age < 65 && flottant(creerFlux(graine, 'actif', p.id as number)) >= 0.12) {
      // 12 % d'inactifs parmi les adultes : sans eux, tout le monde a la même
      // journée et la ville n'a plus d'habitants disponibles en journée.
      poste = emplois[iEmploi];
      if (poste !== undefined) iEmploi += 1;
    }

    if (poste === undefined) continue;
    poste.titulaire = p.id;
    p.poste = poste.id;
  }
}

function creerHabitant(monde: Monde, r: Alea, logement: LieuId): Personnage {
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

  return {
    id,
    prenom: choisir(r, sexe === 'f' ? PRENOMS_F : PRENOMS_M) ?? 'Alex',
    nom: choisir(r, NOMS) ?? 'Martin',
    naissance: monde.tick - age * TICKS_PAR_AN - entier(r, 0, TICKS_PAR_AN),
    sexe,
    traits,
    besoins,
    apparence: creerApparence(r, sexe, age),
    position: creerPosition(id as number, logement),
    // Renseigné à la passe des foyers, juste après. L'invariant
    // « foyer-existe » le vérifiera.
    foyer: 0 as FoyerId,
    poste: null,
    argent: Math.round(normal(r, age < 18 ? 40 : 900, age < 18 ? 20 : 500)),
    activite: null,
    echelle: 'micro',
    derniereMaj: monde.tick,
  };
}

/**
 * Tire une apparence.
 *
 * Tout passe par le flux déterministe de l'habitant : même graine, même
 * visage. Les gènes sont tirés indépendamment du sexe sauf pour la taille,
 * parce que c'est le seul axe où la différence est assez marquée pour se voir
 * dans une silhouette de quinze pixels.
 */
function creerApparence(r: Alea, sexe: 'f' | 'm', age: number): Apparence {
  const borne = (v: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, Math.round(v)));

  const tailleAdulte = borne(normal(r, sexe === 'f' ? 166 : 178, 7), 140, 205);

  return {
    genes: {
      teintePeau: entier(r, 0, 256),
      teinteCheveux: entier(r, 0, 256),
      coiffure: entier(r, 0, REPERTOIRES.coiffures),
      corpulence: borne(normal(r, 0, 32), -100, 100),
      tailleCm: tailleAdulte,
    },
    garderobe: {
      haut: entier(r, 0, REPERTOIRES.hauts),
      bas: entier(r, 0, REPERTOIRES.bas),
      teinteHaut: entier(r, 0, 256),
      teinteBas: entier(r, 0, 256),
    },
    // Peu d'accessoires, et davantage avec l'âge : un bit par objet.
    accessoires: masqueAccessoires(r, age),
  };
}

function masqueAccessoires(r: Alea, age: number): number {
  const probabilites = [
    age > 45 ? 0.35 : 0.12,  // lunettes
    0.25,                     // sac
    0.1,                      // chapeau
    age > 72 ? 0.3 : 0.01,    // canne
    0.15,                     // écharpe
  ];
  let masque = 0;
  for (let i = 0; i < REPERTOIRES.accessoires; i += 1) {
    if (flottant(r) < (probabilites[i] ?? 0)) masque |= 1 << i;
  }
  return masque;
}

