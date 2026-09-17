import { describe, expect, it } from 'vitest';
import { DERIVE_BASE, deriver } from './besoins.ts';
import { BESOINS, TRAITS, besoin } from '../../etat/personnage.ts';
import type { Personnage } from '../../etat/personnage.ts';
import type { LieuId, PersoId } from '../../noyau/index.ts';

const habitant = (traits: Partial<Record<(typeof TRAITS)[number], number>> = {}): Personnage => ({
  id: 1 as PersoId,
  prenom: 'Test',
  nom: 'Témoin',
  naissance: 0,
  sexe: 'f',
  traits: TRAITS.map((t) => traits[t] ?? 0),
  besoins: BESOINS.map(() => 0),
  lieu: 1 as LieuId,
  domicile: 1 as LieuId,
  occupation: { type: 'aucune' },
  argent: 100,
  activite: null,
  echelle: 'micro',
  derniereMaj: 0,
});

describe('dérive des besoins', () => {
  it('replie le temps sans rien changer au résultat', () => {
    // LA propriété qui rend les échelles de simulation possibles. Si elle
    // tombe, promouvoir un personnage de l'échelle journalière à l'échelle
    // horaire changerait son état — et le monde ne serait plus cohérent avec
    // lui-même selon l'endroit où se trouve le joueur.
    const unParUn = habitant();
    const dUnCoup = habitant();

    for (let i = 0; i < 288; i += 1) deriver(unParUn, 1);
    deriver(dUnCoup, 288);

    for (const b of BESOINS) {
      // Égalité à 1e-9 près : ce qui reste est l'accumulation flottante de
      // 288 additions, six ordres de grandeur sous le pas de simulation.
      expect(besoin(dUnCoup, b)).toBeCloseTo(besoin(unParUn, b), 9);
    }
  });

  it('replie aussi par blocs d\'une heure', () => {
    const parHeure = habitant();
    const dUnCoup = habitant();
    for (let i = 0; i < 24; i += 1) deriver(parHeure, 12);
    deriver(dUnCoup, 288);
    for (const b of BESOINS) expect(besoin(dUnCoup, b)).toBeCloseTo(besoin(parHeure, b), 9);
  });

  it('ne fait rien pour un pas nul ou négatif', () => {
    const p = habitant();
    deriver(p, 0);
    deriver(p, -50);
    for (const b of BESOINS) expect(besoin(p, b)).toBe(0);
  });

  it('sature à 1000 au lieu de déborder', () => {
    const p = habitant();
    deriver(p, 100_000);
    for (const b of BESOINS) expect(besoin(p, b)).toBe(1000);
  });

  it('fait monter la solitude presque deux fois plus vite chez un sociable', () => {
    // C'est ici que la personnalité commence : le sociable ne « gagne » pas
    // de points de sociabilité, c'est l'isolement qui lui coûte plus cher.
    const sociable = habitant({ sociabilite: 100 });
    const solitaire = habitant({ sociabilite: -100 });
    deriver(sociable, 100);
    deriver(solitaire, 100);

    const rapport = besoin(sociable, 'social') / besoin(solitaire, 'social');
    expect(rapport).toBeGreaterThan(3);
  });

  it('module l\'accomplissement par l\'ambition et rien d\'autre', () => {
    const ambitieux = habitant({ ambition: 100 });
    const indifferent = habitant({ ambition: -100 });
    deriver(ambitieux, 200);
    deriver(indifferent, 200);
    expect(besoin(ambitieux, 'accomplissement')).toBeGreaterThan(
      besoin(indifferent, 'accomplissement'),
    );
    // La faim, elle, ne dépend d'aucun trait.
    expect(besoin(ambitieux, 'faim')).toBe(besoin(indifferent, 'faim'));
  });

  it('garde une nuit de sommeil capable de couvrir une journée', () => {
    // Garde-fou d'équilibrage : le banc d'essai a montré qu'une dérive
    // d'énergie trop rapide fait dormir les habitants onze heures par jour et
    // vide leurs journées. Ce test fige le rapport entre la dette d'une
    // journée et ce qu'une nuit peut rembourser.
    const detteJournaliere = DERIVE_BASE.energie * 288;
    const nuit = 96 * 14;
    expect(nuit).toBeGreaterThan(detteJournaliere);
    expect(nuit).toBeLessThan(detteJournaliere * 1.35);
  });
});
