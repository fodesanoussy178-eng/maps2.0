import { describe, expect, it } from 'vitest';
import {
  chance,
  choisir,
  choisirPondere,
  creerAlea,
  creerFlux,
  entier,
  flottant,
  hacher,
  melangerTableau,
  normal,
  suivant,
} from './alea.ts';

const tirer = (r: ReturnType<typeof creerAlea>, n: number): number[] =>
  Array.from({ length: n }, () => suivant(r));

describe('aléa déterministe', () => {
  it('rejoue exactement la même suite pour une même graine', () => {
    expect(tirer(creerAlea(12345), 64)).toEqual(tirer(creerAlea(12345), 64));
  });

  it('produit des suites différentes pour des graines voisines', () => {
    // Le point sensible : sans tours à vide au semis, deux graines
    // consécutives produisent des premiers tirages corrélés — et des
    // personnages aux identifiants voisins se ressembleraient.
    const a = tirer(creerAlea(1000), 8);
    const b = tirer(creerAlea(1001), 8);
    expect(a[0]).not.toBe(b[0]);
    expect(a).not.toEqual(b);
  });

  it("l'état tient dans quatre entiers 32 bits sérialisables", () => {
    const r = creerAlea(7);
    tirer(r, 100);
    for (const v of [r.a, r.b, r.c, r.d]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(0xffffffff);
    }
    // Un état repris tel quel poursuit la même suite : c'est ce qui permet de
    // sauvegarder un générateur en cours.
    const copie = { ...r };
    expect(tirer(r, 10)).toEqual(tirer(copie, 10));
  });

  it('donne des flux nommés indépendants', () => {
    const decision = creerFlux(42, 'decision', 7, 100);
    const humeur = creerFlux(42, 'humeur', 7, 100);
    expect(tirer(decision, 16)).not.toEqual(tirer(humeur, 16));
  });

  it('donne le même flux pour les mêmes clés, quel que soit le moment', () => {
    // La propriété qui permet de rejouer la décision d'un seul personnage
    // hors ordre et de retrouver ce qu'a produit la partie complète.
    const premier = tirer(creerFlux(42, 'decision', 7, 100), 8);
    const autres = Array.from({ length: 5 }, () => creerFlux(42, 'autre', 999, 1));
    autres.forEach((r) => tirer(r, 50));
    const second = tirer(creerFlux(42, 'decision', 7, 100), 8);
    expect(second).toEqual(premier);
  });

  it('distingue les clés numériques des clés textuelles', () => {
    expect(hacher('a', 1)).not.toBe(hacher(1, 'a'));
    expect(hacher('ab')).not.toBe(hacher('ba'));
    expect(hacher(1, 2)).not.toBe(hacher(2, 1));
  });

  it('borne flottant dans [0, 1) et entier dans [min, max)', () => {
    const r = creerAlea(9);
    for (let i = 0; i < 2000; i += 1) {
      const f = flottant(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const e = entier(r, 5, 9);
      expect(e).toBeGreaterThanOrEqual(5);
      expect(e).toBeLessThan(9);
    }
    expect(entier(creerAlea(1), 3, 3)).toBe(3);
  });

  it('respecte approximativement les probabilités demandées', () => {
    const r = creerAlea(2024);
    let succes = 0;
    for (let i = 0; i < 20000; i += 1) if (chance(r, 0.25)) succes += 1;
    expect(succes / 20000).toBeGreaterThan(0.23);
    expect(succes / 20000).toBeLessThan(0.27);
  });

  it('respecte les poids du tirage pondéré', () => {
    const r = creerAlea(5);
    const comptes = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 12000; i += 1) {
      const choix = choisirPondere(r, ['a', 'b', 'c'] as const, [1, 3, 0]);
      if (choix !== undefined) comptes[choix] += 1;
    }
    // Un poids nul rend l'option IMPOSSIBLE, pas improbable : c'est ce qui
    // permet à l'IA d'utilité d'exclure une action sans cas particulier.
    expect(comptes.c).toBe(0);
    expect(comptes.b / comptes.a).toBeGreaterThan(2.7);
    expect(comptes.b / comptes.a).toBeLessThan(3.3);
  });

  it('renvoie undefined plutôt que de deviner sur une liste vide', () => {
    const r = creerAlea(1);
    expect(choisir(r, [])).toBeUndefined();
    expect(choisirPondere(r, ['a'], [0])).toBeUndefined();
  });

  it('mélange sans perdre ni dupliquer, et sans toucher à la source', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const melange = melangerTableau(creerAlea(3), source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(melange.slice().sort((a, b) => a - b)).toEqual(source);
    expect(melange).not.toEqual(source);
  });

  it('centre la loi normale et borne ses queues', () => {
    const r = creerAlea(77);
    let somme = 0;
    const n = 5000;
    for (let i = 0; i < n; i += 1) {
      const v = normal(r, 100, 15);
      expect(v).toBeGreaterThanOrEqual(40);
      expect(v).toBeLessThanOrEqual(160);
      somme += v;
    }
    expect(Math.abs(somme / n - 100)).toBeLessThan(1.5);
  });
});
