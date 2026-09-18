/**
 * La partie : ce qui est en cours de jeu.
 *
 * Elle tient le monde, le personnage du joueur, l'horloge et les ordres en
 * attente. Elle ne dessine rien et ne connaît aucun élément d'interface : on
 * doit pouvoir faire tourner une partie entière sans écran, et c'est ce que
 * font les tests.
 */

import type { LieuId, PersoId } from '../noyau/index.ts';
import { calendrier, nomJourSemaine } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import { genererMonde } from '../monde/generation.ts';
import type { OptionsBoucle } from '../boucle/boucle.ts';
import type { FicheCreation, Ordres } from './joueur.ts';
import {
  creerOrdres,
  insererJoueur,
  intentionDuJoueur,
  ordonnerArret,
  ordonnerDeplacement,
  rendreAutonomie,
} from './joueur.ts';
import type { Horloge, VitesseJeu } from './horloge.ts';
import { battre, creerHorloge } from './horloge.ts';

export interface OptionsPartie {
  graine: number;
  population: number;
  fiche: FicheCreation;
  vitesse?: VitesseJeu;
}

export interface Partie {
  monde: Monde;
  joueur: PersoId;
  horloge: Horloge;
  ordres: Ordres;
  options: OptionsBoucle;
}

export function commencerPartie(o: OptionsPartie): Partie {
  const { monde } = genererMonde({ graine: o.graine, population: o.population });
  const joueur = insererJoueur(monde, o.fiche);
  const ordres = creerOrdres();

  return {
    monde,
    joueur,
    horloge: creerHorloge(o.vitesse ?? 1),
    ordres,
    // Le joueur passe par la MÊME boucle que tout le monde. Son seul privilège
    // est ce crochet, consulté avant l'IA d'utilité — et seulement quand il a
    // donné un ordre.
    options: { intention: intentionDuJoueur(joueur, ordres) },
  };
}

/** Avance la partie de ce que vaut `deltaMsReel`. Renvoie les ticks exécutés. */
export function avancerPartie(partie: Partie, deltaMsReel: number): number {
  return battre(partie.horloge, partie.monde, deltaMsReel, partie.options);
}

export function personnageJoueur(partie: Partie) {
  return partie.monde.personnages.get(partie.joueur);
}

/**
 * Les commandes du joueur interrompent ce qu'il était en train de faire.
 *
 * Sans cela, cliquer une destination pendant qu'on dort ne produit rien
 * pendant huit heures de jeu, et le personnage paraît sourd. Un habitant
 * ordinaire, lui, va au bout de ce qu'il a entrepris : c'est la seule
 * différence de traitement, et elle est du côté de l'interface, pas du moteur.
 */
function interrompre(partie: Partie): void {
  const j = personnageJoueur(partie);
  if (j !== undefined) j.activite = null;
}

export function commanderDeplacement(partie: Partie, vers: LieuId): void {
  ordonnerDeplacement(partie.ordres, vers);
  interrompre(partie);
}

export function commanderArret(partie: Partie): void {
  ordonnerArret(partie.ordres);
  interrompre(partie);
}

export function commanderAutonomie(partie: Partie): void {
  rendreAutonomie(partie.ordres);
  interrompre(partie);
}

export function horodatage(monde: Monde): { heure: string; jour: string } {
  const c = calendrier(monde.tick);
  return {
    heure: `${String(c.heure).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`,
    jour: `${nomJourSemaine(c.jourSemaine)} ${c.jour}/${c.mois}/${c.annee}`,
  };
}
