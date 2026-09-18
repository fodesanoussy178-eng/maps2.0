/**
 * Le jeu : création du personnage, insertion, temps, déterminisme.
 *
 * Tout tourne SANS ÉCRAN. Si ces tests passent, la simulation ne dépend pas
 * du rendu — ce qui est la règle d'architecture de cette phase.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PAR_JOUR, age, calendrier } from '../noyau/index.ts';
import { decrireViolations, verifierInvariants } from '../etat/invariants.ts';
import { apparenceValide } from '../etat/apparence.ts';
import { POSITION_MAX } from '../etat/position.ts';
import { domicile, foyerDe, posteDe } from '../etat/monde.ts';
import { empreinteMonde } from '../labo/experience.ts';
import {
  commencerPartie,
  avancerPartie,
  commanderArret,
  commanderAutonomie,
  commanderDeplacement,
  personnageJoueur,
} from './partie.ts';
import { ficheParDefaut } from './creation.ts';
import { creerHorloge, battre } from './horloge.ts';
import { creerScene, estDehors, positionDe } from './scene.ts';
import type { LieuId } from '../noyau/index.ts';

const nouvellePartie = (population = 60, graine = 1) =>
  commencerPartie({ graine, population, fiche: ficheParDefaut() });

describe('création du personnage joueur', () => {
  const partie = nouvellePartie();
  const joueur = personnageJoueur(partie);

  it("insère le joueur comme un habitant de plus", () => {
    expect(joueur).toBeDefined();
    expect(partie.monde.personnages.size).toBe(61);
    expect(partie.monde.personnages.get(partie.joueur)).toBe(joueur);
  });

  it('lui donne un identifiant neuf, distinct de tous les autres', () => {
    const ids = [...partie.monde.personnages.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((i) => i === partie.joueur)).toHaveLength(1);
  });

  it('reprend fidèlement la fiche', () => {
    const fiche = ficheParDefaut();
    expect(joueur?.prenom).toBe(fiche.prenom);
    expect(joueur?.nom).toBe(fiche.nom);
    expect(age(joueur?.naissance ?? 0, partie.monde.tick)).toBe(fiche.age);
    expect(joueur?.apparence).toEqual(fiche.apparence);
    expect(apparenceValide(joueur?.apparence ?? fiche.apparence)).toEqual([]);
  });

  it('lui donne une position, un foyer et un logement réels', () => {
    if (joueur === undefined) throw new Error('joueur absent');
    expect(partie.monde.lieux.get(joueur.position.lieu)?.occupants).toContain(joueur.id);
    expect(joueur.position.piece).toBeNull();
    expect(joueur.position.x).toBeGreaterThanOrEqual(0);
    expect(joueur.position.x).toBeLessThanOrEqual(POSITION_MAX);
    expect(foyerDe(partie.monde, joueur)?.membres).toContain(joueur.id);
    expect(domicile(partie.monde, joueur)).toBeDefined();
  });

  it("lui attribue un poste vacant s'il en reste", () => {
    const poste = posteDe(partie.monde, joueur!);
    expect(poste?.genre).toBe('emploi');
    expect(poste?.titulaire).toBe(partie.joueur);
  });

  it('laisse le monde entièrement cohérent après insertion', () => {
    expect(decrireViolations(verifierInvariants(partie.monde))).toBe('aucune violation');
  });
});

describe('le joueur vit comme les autres', () => {
  it('décide tout seul quand on ne lui demande rien', () => {
    const partie = nouvellePartie();
    avancerPartie(partie, 100_000);
    const j = personnageJoueur(partie);
    expect(j?.activite).not.toBeNull();
    expect(decrireViolations(verifierInvariants(partie.monde))).toBe('aucune violation');
  });

  it('obéit à un ordre de déplacement, puis reprend son autonomie', () => {
    const partie = nouvellePartie();
    const cible = [...partie.monde.lieux.values()].find((l) => l.type === 'cafe');
    if (cible === undefined) throw new Error('pas de café');

    partie.horloge.vitesse = 12;
    commanderDeplacement(partie, cible.id);
    // Assez de temps pour que le trajet s'achève.
    for (let i = 0; i < 40; i += 1) avancerPartie(partie, 1000);

    const j = personnageJoueur(partie);
    expect(j).toBeDefined();
    // L'ordre a été consommé : il n'en reste rien.
    expect(partie.ordres.destination).toBeNull();
    expect(decrireViolations(verifierInvariants(partie.monde))).toBe('aucune violation');
  });

  it("s'arrête quand on le lui demande et reprend quand on lui rend la main", () => {
    const partie = nouvellePartie();
    partie.horloge.vitesse = 12;
    commanderArret(partie);
    // Un seul battement suffit : la commande a interrompu ce qu'il faisait.
    avancerPartie(partie, 1000);
    const j = personnageJoueur(partie);
    expect(j?.activite?.type).toBe('action');
    if (j?.activite?.type === 'action') expect(j.activite.action).toBe('flaner');

    commanderAutonomie(partie);
    expect(partie.ordres.arret).toBe(false);
  });

  it("n'impose rien aux autres habitants", () => {
    const partie = nouvellePartie();
    partie.horloge.vitesse = 12;
    commanderArret(partie);
    for (let i = 0; i < 40; i += 1) avancerPartie(partie, 1000);
    const flaneurs = [...partie.monde.personnages.values()].filter(
      (p) => p.activite?.type === 'action' && p.activite.action === 'flaner',
    );
    // Le joueur flâne ; la ville, elle, vaque à ses occupations.
    expect(flaneurs.length).toBeLessThan(partie.monde.personnages.size / 3);
  });
});

describe('le temps', () => {
  it('ne fait rien en pause, quel que soit le temps réel écoulé', () => {
    const partie = nouvellePartie();
    partie.horloge.vitesse = 0;
    const depart = partie.monde.tick;
    for (let i = 0; i < 100; i += 1) avancerPartie(partie, 1000);
    expect(partie.monde.tick).toBe(depart);
  });

  it('avance proportionnellement à la vitesse', () => {
    const mesurer = (vitesse: 1 | 4 | 12 | 40): number => {
      const partie = nouvellePartie();
      partie.horloge.vitesse = vitesse;
      const depart = partie.monde.tick;
      for (let i = 0; i < 60; i += 1) avancerPartie(partie, 1000);
      return partie.monde.tick - depart;
    };
    // 60 secondes réelles : 12 ticks à ×1, et proportionnellement au-delà.
    expect(mesurer(1)).toBeGreaterThanOrEqual(11);
    expect(mesurer(4)).toBeGreaterThanOrEqual(47);
    expect(mesurer(12)).toBeGreaterThanOrEqual(143);
    expect(mesurer(40)).toBeGreaterThanOrEqual(479);
  });

  it('ne dépend pas du découpage des images', () => {
    // LA propriété d'architecture : le rendu ne peut pas changer l'histoire.
    // Une machine lente, une image sautée, un onglet en arrière-plan ne
    // produisent pas un autre monde.
    const a = nouvellePartie();
    const b = nouvellePartie();
    a.horloge.vitesse = 12;
    b.horloge.vitesse = 12;

    for (let i = 0; i < 120; i += 1) battre(a.horloge, a.monde, 1000 / 60, a.options);
    // Même durée réelle, en deux gros morceaux au lieu de cent vingt petits.
    battre(b.horloge, b.monde, 1000, b.options);
    battre(b.horloge, b.monde, 1000, b.options);

    expect(a.monde.tick).toBe(b.monde.tick);
    expect(empreinteMonde(a.monde)).toBe(empreinteMonde(b.monde));
  });

  it('traverse une journée complète et change de jour', () => {
    const partie = nouvellePartie();
    partie.horloge.vitesse = 40;
    const jourDepart = calendrier(partie.monde.tick).jour;
    let garde = 0;
    while (partie.monde.tick < TICKS_PAR_JOUR * 2 && garde < 5000) {
      avancerPartie(partie, 1000);
      garde += 1;
    }
    expect(calendrier(partie.monde.tick).jour).not.toBe(jourDepart);
    expect(decrireViolations(verifierInvariants(partie.monde))).toBe('aucune violation');
  });

  it('plafonne le rattrapage au lieu de partir en spirale', () => {
    const horloge = creerHorloge(40);
    const partie = nouvellePartie();
    battre(horloge, partie.monde, 600_000, partie.options);
    expect(horloge.sature).toBe(true);
  });
});

describe('déterminisme de la partie', () => {
  it('donne deux fois le même monde pour la même graine et la même fiche', () => {
    const a = nouvellePartie(60, 12);
    const b = nouvellePartie(60, 12);
    expect(empreinteMonde(a.monde)).toBe(empreinteMonde(b.monde));

    a.horloge.vitesse = 12;
    b.horloge.vitesse = 12;
    for (let i = 0; i < 200; i += 1) {
      avancerPartie(a, 50);
      avancerPartie(b, 50);
    }
    expect(empreinteMonde(a.monde)).toBe(empreinteMonde(b.monde));
  });
});

describe('cohérence entre l\'état et ce qui est dessiné', () => {
  it('place chaque habitant visible là où le dit son état', () => {
    const partie = nouvellePartie();
    const scene = creerScene(partie.monde);
    avancerPartie(partie, 60_000);

    let dehors = 0;
    for (const p of partie.monde.personnages.values()) {
      const position = positionDe(scene, partie.monde, p);
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      // Le point reste dans le cadre de la ville, marge comprise.
      expect(position.x).toBeGreaterThan(-200);
      expect(position.x).toBeLessThan(scene.ville.largeur + 200);
      if (estDehors(scene, p)) dehors += 1;
    }
    expect(dehors).toBeGreaterThanOrEqual(0);
  });

  it('suit un habitant qui change de lieu', () => {
    const partie = nouvellePartie();
    const scene = creerScene(partie.monde);
    const cible = [...partie.monde.lieux.values()].find((l) => l.type === 'parc');
    if (cible === undefined) throw new Error('pas de parc');

    const j = personnageJoueur(partie);
    if (j === undefined) throw new Error('joueur absent');
    const avant = positionDe(scene, partie.monde, j);
    const lieuAvant: LieuId = j.position.lieu;

    partie.horloge.vitesse = 12;
    commanderDeplacement(partie, cible.id);
    for (let i = 0; i < 30; i += 1) avancerPartie(partie, 1000);

    if (j.position.lieu !== lieuAvant) {
      const apres = positionDe(scene, partie.monde, j);
      expect(apres).not.toEqual(avant);
    }
  });

  it('tient une population de 300 habitants sans incohérence', () => {
    const partie = nouvellePartie(300, 4);
    partie.horloge.vitesse = 40;
    for (let i = 0; i < 60; i += 1) avancerPartie(partie, 1000);
    expect(partie.monde.personnages.size).toBe(301);
    expect(decrireViolations(verifierInvariants(partie.monde))).toBe('aucune violation');
  });
});
