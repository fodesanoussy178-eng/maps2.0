import { describe, expect, it } from 'vitest';
import { TICKS_PAR_JOUR } from '../noyau/index.ts';
import { genererMonde } from '../monde/generation.ts';
import { avancer } from './boucle.ts';
import { decrireViolations, verifierInvariants } from '../etat/invariants.ts';
import { posteDe } from '../etat/monde.ts';
import type { Observateur } from './boucle.ts';

describe('boucle de simulation', () => {
  it('garde le monde cohérent sur cinq jours', () => {
    const { monde } = genererMonde({ graine: 3, population: 40 });
    for (let j = 0; j < 5; j += 1) {
      avancer(monde, TICKS_PAR_JOUR);
      const violations = verifierInvariants(monde);
      expect(decrireViolations(violations)).toBe('aucune violation');
    }
  });

  it('fait vraiment vivre les habitants plutôt que de les laisser sur place', () => {
    const { monde } = genererMonde({ graine: 4, population: 30 });
    const depart = new Map([...monde.personnages].map(([id, p]) => [id, p.position.lieu]));

    avancer(monde, TICKS_PAR_JOUR);

    let bouges = 0;
    for (const [id, p] of monde.personnages) if (depart.get(id) !== p.position.lieu) bouges += 1;
    // Tout le monde ne finit pas la journée ailleurs — beaucoup rentrent
    // dormir chez eux — mais une ville où personne n'a bougé est une ville
    // morte.
    expect(bouges).toBeGreaterThan(0);

    for (const p of monde.personnages.values()) {
      expect(p.derniereMaj).toBe(monde.tick);
    }
  });

  it('n\'envoie jamais un élève au bureau ni un salarié à l\'école', () => {
    // Le banc d'essai avait laissé passer exactement cela : une considération
    // qui ne regardait que les horaires, sans vérifier le type d'occupation.
    // Aucune moyenne ne l'aurait montré — les heures travaillées restaient
    // plausibles.
    const { monde } = genererMonde({ graine: 5, population: 40 });
    const fautes: string[] = [];
    const observateur: Observateur = {
      surActivite: (_m, p, activite) => {
        if (activite === 'travailler' && posteDe(monde, p)?.genre !== 'emploi') {
          fautes.push(`${p.prenom} travaille sans emploi`);
        }
        if (activite === 'etudier' && posteDe(monde, p)?.genre !== 'etudes') {
          fautes.push(`${p.prenom} étudie sans être scolarisé`);
        }
      },
    };

    avancer(monde, TICKS_PAR_JOUR * 3, { observateur });
    expect(fautes.slice(0, 5)).toEqual([]);
  });

  it('produit des journées, pas une activité figée', () => {
    const { monde } = genererMonde({ graine: 6, population: 30 });
    const vues = new Set<string>();
    avancer(monde, TICKS_PAR_JOUR * 2, {
      observateur: { surActivite: (_m, _p, a) => void vues.add(a) },
    });
    // Sommeil, repas, occupation, déplacement, vie sociale : une journée qui
    // n'en contient pas au moins six formes n'est pas une journée.
    expect(vues.size).toBeGreaterThanOrEqual(6);
    expect(vues.has('dormir')).toBe(true);
    expect(vues.has('se_deplacer')).toBe(true);
  });

  it('donne le même monde à l\'échelle horaire qu\'à l\'échelle du tick, sans le coût', () => {
    // Le repli ne doit pas changer la nature de ce qui se passe. Les
    // trajectoires individuelles diffèrent — les décisions sont prises à des
    // instants différents — mais la forme de la journée doit tenir.
    const fin = TICKS_PAR_JOUR * 3;

    const compter = (echelle: 'micro' | 'meso'): Map<string, number> => {
      const { monde } = genererMonde({ graine: 11, population: 40 });
      for (const p of monde.personnages.values()) p.echelle = echelle;
      const temps = new Map<string, number>();
      avancer(monde, fin, {
        observateur: {
          surActivite: (_m, _p, a, ticks) => temps.set(a, (temps.get(a) ?? 0) + ticks),
        },
      });
      expect(verifierInvariants(monde)).toEqual([]);
      return temps;
    };

    const micro = compter('micro');
    const meso = compter('meso');
    const totalMicro = [...micro.values()].reduce((a, b) => a + b, 0);
    const totalMeso = [...meso.values()].reduce((a, b) => a + b, 0);

    // Le temps total vécu est conservé : personne ne perd ni ne gagne d'heures.
    expect(Math.abs(totalMicro - totalMeso) / totalMicro).toBeLessThan(0.02);

    const partSommeilMicro = (micro.get('dormir') ?? 0) / totalMicro;
    const partSommeilMeso = (meso.get('dormir') ?? 0) / totalMeso;
    expect(Math.abs(partSommeilMicro - partSommeilMeso)).toBeLessThan(0.1);
  });
});
