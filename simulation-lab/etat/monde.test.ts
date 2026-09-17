/**
 * L'état du monde : construction, cohérence, déterminisme.
 *
 * Ces tests ne vérifient aucun comportement — ils vérifient que la STRUCTURE
 * que tous les systèmes vont partager est saine. C'est le genre de test qui ne
 * tombe jamais pendant des mois, puis attrape exactement la faute qui aurait
 * coûté une semaine : une référence orpheline, un index qui ne pointe plus au
 * bon endroit, une apparence impossible à dessiner.
 */

import { describe, expect, it } from 'vitest';
import { VERSION_ETAT, creerMonde, domicile, foyerDe, posteDe } from './monde.ts';
import { decrireViolations, verifierInvariants } from './invariants.ts';
import { genererMonde } from '../monde/generation.ts';
import { empreinteMonde } from '../labo/experience.ts';
import { avancer } from '../boucle/boucle.ts';
import { POSITION_MAX, emplacementDans } from './position.ts';
import { REPERTOIRES, apparenceValide } from './apparence.ts';
import { creerRelation } from './relation.ts';
import { TICKS_PAR_JOUR } from '../noyau/index.ts';
import type { LieuId, PersoId } from '../noyau/index.ts';

const monde = (population = 60, graine = 1) => genererMonde({ graine, population }).monde;

describe('construction du monde', () => {
  it('crée un monde vide mais valide', () => {
    const m = creerMonde(42);
    expect(m.version).toBe(VERSION_ETAT);
    expect(m.personnages.size).toBe(0);
    expect(m.lieux.size).toBe(0);
    expect(m.foyers.size).toBe(0);
    expect(m.postes.size).toBe(0);
    expect(m.relations.size).toBe(0);
    expect(verifierInvariants(m)).toEqual([]);
  });

  it('génère un monde cohérent à plusieurs tailles', () => {
    for (const population of [8, 24, 60, 150]) {
      const m = monde(population);
      expect(m.personnages.size).toBe(population);
      expect(decrireViolations(verifierInvariants(m)), `population ${population}`).toBe(
        'aucune violation',
      );
    }
  });

  it('signale un monde dont le schéma ne correspond pas au code', () => {
    const m = monde(8);
    m.version = VERSION_ETAT + 1;
    expect(verifierInvariants(m).map((v) => v.regle)).toContain('version-etat');
  });
});

describe('position', () => {
  it('donne à chacun une position complète et bornée', () => {
    for (const p of monde(60).personnages.values()) {
      expect(p.position.lieu).toBeDefined();
      // Les intérieurs n'existent pas encore : la pièce doit rester nulle, et
      // ce test tombera le jour où on les posera sans les déclarer.
      expect(p.position.piece).toBeNull();
      expect(Number.isInteger(p.position.x)).toBe(true);
      expect(Number.isInteger(p.position.y)).toBe(true);
      expect(p.position.x).toBeGreaterThanOrEqual(0);
      expect(p.position.x).toBeLessThanOrEqual(POSITION_MAX);
      expect(p.position.y).toBeGreaterThanOrEqual(0);
      expect(p.position.y).toBeLessThanOrEqual(POSITION_MAX);
    }
  });

  it('place chacun dans un lieu qui existe et qui le compte', () => {
    const m = monde(60);
    for (const p of m.personnages.values()) {
      const l = m.lieux.get(p.position.lieu);
      expect(l, `lieu de ${p.prenom}`).toBeDefined();
      expect(l?.occupants).toContain(p.id);
    }
  });

  it('donne à la même personne le même emplacement dans le même lieu', () => {
    // Sans cette stabilité, un habitant sauterait d'un point à l'autre de la
    // pièce chaque fois que quelqu'un entre ou sort.
    const a = emplacementDans(7, 3 as LieuId);
    const b = emplacementDans(7, 3 as LieuId);
    expect(a).toEqual(b);
    expect(emplacementDans(7, 4 as LieuId)).not.toEqual(a);
    expect(emplacementDans(8, 3 as LieuId)).not.toEqual(a);
  });

  it('met à jour la position entière lors d\'un déplacement', () => {
    const m = monde(24);
    const p = [...m.personnages.values()][0];
    if (p === undefined) throw new Error('population vide');
    const avant = { ...p.position };

    avancer(m, TICKS_PAR_JOUR);
    const apres = p.position;

    expect(verifierInvariants(m)).toEqual([]);
    if (apres.lieu !== avant.lieu) {
      // Le lieu a changé : l'emplacement doit avoir suivi, pas être resté
      // celui de l'ancien bâtiment.
      expect({ x: apres.x, y: apres.y }).toEqual(emplacementDans(p.id as number, apres.lieu));
    }
  });
});

describe('apparence', () => {
  it('donne à chacun une apparence valide', () => {
    for (const p of monde(150).personnages.values()) {
      expect(apparenceValide(p.apparence), `${p.prenom} ${p.nom}`).toEqual([]);
    }
  });

  it('reste dans les répertoires de formes', () => {
    for (const p of monde(150).personnages.values()) {
      expect(p.apparence.genes.coiffure).toBeLessThan(REPERTOIRES.coiffures);
      expect(p.apparence.garderobe.haut).toBeLessThan(REPERTOIRES.hauts);
      expect(p.apparence.garderobe.bas).toBeLessThan(REPERTOIRES.bas);
      expect(p.apparence.accessoires).toBeLessThan(1 << REPERTOIRES.accessoires);
    }
  });

  it('sépare nettement ce qui se transmet de ce qui s\'acquiert', () => {
    // La forme compte autant que les valeurs : le jour de l'hérédité, on
    // passera `genes` d'un parent à l'enfant sans avoir à trier champ par
    // champ ce qui se transmet.
    const p = [...monde(8).personnages.values()][0];
    if (p === undefined) throw new Error('population vide');
    expect(Object.keys(p.apparence).sort()).toEqual(['accessoires', 'garderobe', 'genes']);
    expect(Object.keys(p.apparence.genes).sort()).toEqual([
      'coiffure', 'corpulence', 'tailleCm', 'teinteCheveux', 'teintePeau',
    ]);
  });

  it('produit des habitants visiblement différents', () => {
    // Une population dont tout le monde se ressemble n'a pas besoin
    // d'apparence du tout.
    const signatures = new Set<string>();
    for (const p of monde(60).personnages.values()) {
      const g = p.apparence.genes;
      signatures.add(`${g.coiffure}|${g.teintePeau >> 5}|${g.teinteCheveux >> 5}|${p.apparence.garderobe.haut}`);
    }
    expect(signatures.size).toBeGreaterThan(30);
  });

  it('attrape une apparence impossible à dessiner', () => {
    const m = monde(8);
    const p = [...m.personnages.values()][0];
    if (p === undefined) throw new Error('population vide');
    p.apparence.genes.coiffure = REPERTOIRES.coiffures + 3;
    expect(verifierInvariants(m).map((v) => v.regle)).toContain('apparence-valide');
  });
});

describe('foyers', () => {
  it('rattache chacun à un foyer qui le compte, logé dans un lieu réel', () => {
    const m = monde(60);
    for (const p of m.personnages.values()) {
      const f = foyerDe(m, p);
      expect(f, `foyer de ${p.prenom}`).toBeDefined();
      expect(f?.membres).toContain(p.id);
      expect(m.lieux.has(f?.logement ?? (0 as LieuId))).toBe(true);
      expect(domicile(m, p)).toBe(f?.logement);
    }
  });

  it('ne crée aucun foyer vide et ne dépasse aucune capacité', () => {
    const m = monde(150);
    for (const f of m.foyers.values()) {
      expect(f.membres.length).toBeGreaterThan(0);
      const logement = m.lieux.get(f.logement);
      expect(f.membres.length).toBeLessThanOrEqual(logement?.capacite ?? 0);
    }
  });

  it('attrape un foyer qui retient quelqu\'un parti ailleurs', () => {
    const m = monde(24);
    const f = [...m.foyers.values()][0];
    const p = [...m.personnages.values()].find((x) => !f?.membres.includes(x.id));
    if (f === undefined || p === undefined) throw new Error('monde trop petit');
    f.membres.push(p.id);
    expect(verifierInvariants(m).map((v) => v.regle)).toContain('foyer-reciproque');
  });
});

describe('postes', () => {
  it('lie chaque titulaire à son poste dans les deux sens', () => {
    const m = monde(60);
    for (const p of m.personnages.values()) {
      const poste = posteDe(m, p);
      if (poste === undefined) {
        expect(p.poste).toBeNull();
        continue;
      }
      expect(poste.titulaire).toBe(p.id);
      expect(m.lieux.has(poste.lieu)).toBe(true);
      expect(poste.debutH).toBeLessThan(poste.finH);
    }
  });

  it('ne donne jamais le même poste à deux personnes', () => {
    // C'est la propriété qui fait du travail une ressource et non un attribut :
    // quand quelqu'un prend un poste, un autre ne l'a pas.
    const m = monde(150);
    const tenus = new Map<number, number>();
    for (const p of m.personnages.values()) {
      if (p.poste === null) continue;
      expect(tenus.has(p.poste as number)).toBe(false);
      tenus.set(p.poste as number, p.id as number);
    }
    const occupes = [...m.postes.values()].filter((x) => x.titulaire !== null).length;
    expect(occupes).toBe(tenus.size);
  });

  it('laisse sans occupation ceux pour qui il ne reste rien', () => {
    // Une population très supérieure au nombre de postes doit produire du
    // chômage, pas des postes inventés.
    const m = monde(400);
    const emplois = [...m.postes.values()].filter((x) => x.genre === 'emploi').length;
    const salaries = [...m.personnages.values()].filter(
      (p) => posteDe(m, p)?.genre === 'emploi',
    ).length;
    expect(salaries).toBeLessThanOrEqual(emplois);
    expect(verifierInvariants(m)).toEqual([]);
  });

  it('attrape un poste tenu par quelqu\'un qui occupe autre chose', () => {
    const m = monde(24);
    const vacant = [...m.postes.values()].find((x) => x.titulaire === null);
    const p = [...m.personnages.values()].find((x) => x.poste !== null);
    if (vacant === undefined || p === undefined) throw new Error('monde trop petit');
    vacant.titulaire = p.id;
    expect(verifierInvariants(m).map((v) => v.regle)).toContain('poste-reciproque');
  });
});

describe('relations (collection préparée, encore vide)', () => {
  it('est vide dans tout monde généré', () => {
    expect(monde(60).relations.size).toBe(0);
  });

  it('a déjà ses invariants armés', () => {
    // Ils ne servent à rien aujourd'hui. Ils serviront le jour où le moteur
    // social écrira dans cette collection, et ils tomberont ce jour-là plutôt
    // que trois semaines après.
    const m = monde(24);
    const [a, b] = [...m.personnages.keys()];
    if (a === undefined || b === undefined) throw new Error('monde trop petit');

    m.relations.set(`${a}>${b}`, creerRelation(a, b, 'aucun', m.tick));
    const regles = verifierInvariants(m).map((v) => v.regle);
    expect(regles).toContain('relation-reciproque');

    m.relations.set(`${b}>${a}`, creerRelation(b, a, 'aucun', m.tick));
    expect(verifierInvariants(m)).toEqual([]);

    m.relations.set('9999>1', creerRelation(9999 as PersoId, a, 'aucun', m.tick));
    expect(verifierInvariants(m).map((v) => v.regle)).toContain('relation-orpheline');
  });
});

describe('déterminisme et compatibilité', () => {
  it('produit exactement le même monde initial pour la même graine', () => {
    expect(empreinteMonde(monde(60, 7))).toBe(empreinteMonde(monde(60, 7)));
    expect(empreinteMonde(monde(60, 7))).not.toBe(empreinteMonde(monde(60, 8)));
  });

  it('produit la même histoire après trois jours simulés', () => {
    const a = monde(60, 5);
    const b = monde(60, 5);
    avancer(a, TICKS_PAR_JOUR * 3);
    avancer(b, TICKS_PAR_JOUR * 3);
    expect(empreinteMonde(a)).toBe(empreinteMonde(b));
  });

  it('laisse tourner besoins, décisions et activités comme avant', () => {
    const m = monde(60, 3);
    const vues = new Set<string>();
    avancer(m, TICKS_PAR_JOUR * 2, {
      observateur: { surActivite: (_m, _p, a) => void vues.add(a) },
    });
    expect(vues.size).toBeGreaterThanOrEqual(6);
    expect(vues.has('dormir')).toBe(true);
    expect(vues.has('travailler')).toBe(true);
    expect(vues.has('etudier')).toBe(true);
    expect(decrireViolations(verifierInvariants(m))).toBe('aucune violation');
  });
});
