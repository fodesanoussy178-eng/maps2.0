import { describe, expect, it } from 'vitest';
import {
  PAS,
  PAS_MAX_RATTRAPAGE,
  PLAFONDS,
  affecterEchelles,
  coutParTick,
  creneau,
  doitMettreAJour,
  rattrapage,
  type CritereEchelle,
  type Echelle,
} from './echelles.ts';
import { TICKS_PAR_JOUR } from './temps.ts';

const critere = (id: number, p: Partial<CritereEchelle> = {}): CritereEchelle => ({
  id,
  dansLaScene: false,
  absent: false,
  proximiteSociale: 0,
  memeQuartier: false,
  reclus: false,
  ...p,
});

describe('échelles de simulation', () => {
  it('met à jour chaque personnage exactement une fois par période', () => {
    // C'est la propriété centrale du budget tournant : ni oubli, ni doublon.
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    const comptes = new Map<number, number>();
    for (let tick = 0; tick < TICKS_PAR_JOUR; tick += 1) {
      for (const id of ids) {
        if (doitMettreAJour('macro', id, tick)) {
          comptes.set(id, (comptes.get(id) ?? 0) + 1);
        }
      }
    }
    expect(comptes.size).toBe(100);
    for (const n of comptes.values()) expect(n).toBe(1);
  });

  it('étale la charge au lieu de la concentrer sur un tick', () => {
    // Sans hachage, des identifiants consécutifs tomberaient dans des créneaux
    // consécutifs : une famille entière calculée dans la même poignée de ticks.
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    let pire = 0;
    for (let tick = 0; tick < TICKS_PAR_JOUR; tick += 1) {
      const n = ids.filter((id) => doitMettreAJour('macro', id, tick)).length;
      pire = Math.max(pire, n);
    }
    expect(pire).toBeLessThanOrEqual(4);
  });

  it('donne un créneau stable, dans la période', () => {
    for (const id of [1, 2, 3, 57, 999]) {
      const c = creneau(id, TICKS_PAR_JOUR);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(TICKS_PAR_JOUR);
      expect(creneau(id, TICKS_PAR_JOUR)).toBe(c);
    }
    expect(creneau(42, PAS.micro)).toBe(0);
  });

  it('calcule tout le monde à chaque tick en micro, personne en absent', () => {
    for (let tick = 0; tick < 20; tick += 1) {
      expect(doitMettreAJour('micro', 7, tick)).toBe(true);
      expect(doitMettreAJour('absent', 7, tick)).toBe(false);
    }
  });

  it('replie le temps écoulé lors du rattrapage paresseux', () => {
    const r = rattrapage(0, TICKS_PAR_JOUR * 3, 'macro');
    expect(r).toEqual({ pas: 3, saute: 0, jusqua: TICKS_PAR_JOUR * 3 });

    expect(rattrapage(100, 100, 'macro').pas).toBe(0);
    expect(rattrapage(100, 50, 'macro').pas).toBe(0);
    expect(rattrapage(0, TICKS_PAR_JOUR - 1, 'macro').pas).toBe(0);
  });

  it('saute les replis au-delà du plafond au lieu d\'en rejouer des milliers', () => {
    const r = rattrapage(0, TICKS_PAR_JOUR * 5000, 'macro');
    expect(r.pas).toBe(PAS_MAX_RATTRAPAGE);
    expect(r.saute).toBe(5000 - PAS_MAX_RATTRAPAGE);
    expect(r.jusqua).toBe(TICKS_PAR_JOUR * 5000);
  });

  it('affecte les échelles selon la proximité au joueur', () => {
    const echelles = affecterEchelles([
      critere(1, { dansLaScene: true, proximiteSociale: 900 }),
      critere(2, { proximiteSociale: 500 }),
      critere(3, { memeQuartier: true }),
      critere(4),
      critere(5, { absent: true, proximiteSociale: 900 }),
      critere(6, { reclus: true }),
    ]);
    expect(echelles.get(1)).toBe('micro');
    expect(echelles.get(2)).toBe('meso');
    expect(echelles.get(3)).toBe('meso');
    expect(echelles.get(4)).toBe('macro');
    expect(echelles.get(5)).toBe('absent');
    expect(echelles.get(6)).toBe('dormant');
  });

  it('dégrade les excédents au lieu de dépasser les plafonds', () => {
    const foule = Array.from({ length: 60 }, (_, i) =>
      critere(i + 1, { dansLaScene: true, proximiteSociale: i }),
    );
    const echelles = affecterEchelles(foule);
    const compte = (e: Echelle) => [...echelles.values()].filter((v) => v === e).length;

    expect(compte('micro')).toBe(PLAFONDS.micro);
    expect(compte('micro') + compte('meso') + compte('macro')).toBe(60);
    // Les plus proches socialement gardent la meilleure échelle.
    expect(echelles.get(60)).toBe('micro');
    expect(echelles.get(1)).not.toBe('micro');
  });

  it('affecte les mêmes échelles quel que soit l\'ordre des candidats', () => {
    const base = Array.from({ length: 40 }, (_, i) =>
      critere(i + 1, { dansLaScene: i % 3 === 0, proximiteSociale: (i * 37) % 1000 }),
    );
    const inverse = base.slice().reverse();
    expect([...affecterEchelles(base).entries()].sort((a, b) => a[0] - b[0])).toEqual(
      [...affecterEchelles(inverse).entries()].sort((a, b) => a[0] - b[0]),
    );
  });

  it('tient le budget de calcul annoncé au doc 4', () => {
    // 12 micro + 45 meso + 50 macro : la configuration nominale du MVP.
    const cout = coutParTick({
      micro: 12,
      meso: 45,
      macro: 50,
      dormant: 10,
      absent: 0,
    });
    // Moins de seize mises à jour d'agent par tick, soit ~1600 par seconde à
    // ×500. Trois ordres de grandeur sous la capacité d'un navigateur.
    expect(cout).toBeLessThan(16);
  });
});
