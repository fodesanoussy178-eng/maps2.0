import { describe, expect, it } from 'vitest';
import { empreinte, formeCanonique } from './empreinte.ts';

describe('empreinte d\'état', () => {
  it('ignore l\'ordre des clés et l\'ordre d\'insertion', () => {
    expect(empreinte({ a: 1, b: 2 })).toBe(empreinte({ b: 2, a: 1 }));

    const m1 = new Map([['x', 1], ['y', 2]]);
    const m2 = new Map([['y', 2], ['x', 1]]);
    expect(empreinte(m1)).toBe(empreinte(m2));
  });

  it('détecte le changement d\'un seul champ profond', () => {
    // La raison d'être du module : un test de rejeu doit tomber sur une
    // divergence d'un octet, pas seulement sur un monde visiblement différent.
    const monde = () => ({
      tick: 8640,
      personnages: new Map([
        [1, { nom: 'Paul', argent: 1200, besoins: [500, 300, 900] }],
        [2, { nom: 'Sarah', argent: 840, besoins: [450, 700, 200] }],
      ]),
    });
    const a = monde();
    const b = monde();
    expect(empreinte(a)).toBe(empreinte(b));

    const modifie = monde();
    const sarah = modifie.personnages.get(2);
    if (sarah) sarah.besoins[1] = 701;
    expect(empreinte(modifie)).not.toBe(empreinte(a));
  });

  it('distingue les types qui se ressemblent une fois affichés', () => {
    expect(empreinte(1)).not.toBe(empreinte('1'));
    expect(empreinte(null)).not.toBe(empreinte(undefined));
    expect(empreinte([1, 2])).not.toBe(empreinte({ 0: 1, 1: 2 }));
    expect(empreinte(true)).not.toBe(empreinte('T'));
  });

  it('distingue l\'ordre là où il compte : dans un tableau', () => {
    // Un ordre de tableau EST de l'information (file d'attente, mémoire
    // courte, historique) : il doit peser dans l'empreinte.
    expect(empreinte([1, 2, 3])).not.toBe(empreinte([3, 2, 1]));
  });

  it('marque les flottants, qui n\'ont rien à faire dans l\'état', () => {
    expect(formeCanonique({ v: 3 })).toContain('i3');
    expect(formeCanonique({ v: 3.5 })).toContain('f3.500000');
    // Deux flottants séparés par un epsilon d'arrondi donnent la même
    // empreinte : on ne veut pas qu'un test tombe pour un ULP.
    expect(empreinte(0.1 + 0.2)).toBe(empreinte(0.3));
  });

  it('gère Set, tableaux typés et objets imbriqués', () => {
    expect(empreinte(new Set([3, 1, 2]))).toBe(empreinte(new Set([1, 2, 3])));
    expect(empreinte(new Int8Array([1, 2, 3]))).toBe(empreinte(new Int8Array([1, 2, 3])));
    expect(empreinte(new Int8Array([1, 2, 3]))).not.toBe(empreinte(new Int8Array([1, 3, 2])));
  });

  it('ne part pas en récursion infinie sur un cycle', () => {
    const a: Record<string, unknown> = { nom: 'a' };
    a.moi = a;
    expect(() => empreinte(a)).not.toThrow();
  });

  it('produit huit caractères hexadécimaux', () => {
    expect(empreinte({ quoi: 'que ce soit' })).toMatch(/^[0-9a-f]{8}$/);
  });
});
