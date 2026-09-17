import { describe, expect, it } from 'vitest';
import { genererMonde } from '../monde/generation.ts';
import { verifierInvariants } from './invariants.ts';
import { deplacer } from './transactions.ts';
import type { LieuId } from '../noyau/index.ts';

const monde = () => genererMonde({ graine: 7, population: 24 }).monde;

describe('invariants', () => {
  it('un monde fraîchement généré est cohérent', () => {
    expect(verifierInvariants(monde())).toEqual([]);
  });

  it('attrape une écriture directe de la position', () => {
    // C'est précisément le bug que les transactions existent pour empêcher :
    // le personnage change de lieu, mais l'ancien lieu le retient et le
    // nouveau ne l'a pas. Rien ne plante ; la contradiction se découvre cent
    // heures plus tard.
    const m = monde();
    const p = [...m.personnages.values()][0];
    if (p === undefined) throw new Error('population vide');

    const ailleurs = [...m.lieux.values()].find((l) => l.id !== p.lieu);
    if (ailleurs === undefined) throw new Error('un seul lieu');

    p.lieu = ailleurs.id;
    const violations = verifierInvariants(m);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.regle === 'presence-reciproque')).toBe(true);
  });

  it('la transaction, elle, laisse le monde cohérent', () => {
    const m = monde();
    const p = [...m.personnages.values()][0];
    if (p === undefined) throw new Error('population vide');
    const ailleurs = [...m.lieux.values()].find((l) => l.id !== p.lieu);
    if (ailleurs === undefined) throw new Error('un seul lieu');

    expect(deplacer(m, p, ailleurs.id)).toEqual({ ok: true });
    expect(verifierInvariants(m)).toEqual([]);
  });

  it('refuse un déplacement vers un lieu plein sans rien casser', () => {
    const m = monde();
    const habitants = [...m.personnages.values()];
    const p = habitants[0];
    if (p === undefined) throw new Error('population vide');

    const petit = [...m.lieux.values()].find((l) => l.id !== p.lieu);
    if (petit === undefined) throw new Error('un seul lieu');
    petit.capacite = petit.occupants.length;

    expect(deplacer(m, p, petit.id)).toEqual({ ok: false, raison: 'lieu-plein' });
    expect(verifierInvariants(m)).toEqual([]);
  });

  it('attrape un besoin hors bornes et un lieu inconnu', () => {
    const m = monde();
    const p = [...m.personnages.values()][0];
    if (p === undefined) throw new Error('population vide');

    p.besoins[0] = 5000;
    p.domicile = 99999 as LieuId;
    const regles = verifierInvariants(m).map((v) => v.regle);
    expect(regles).toContain('besoin-borne');
    expect(regles).toContain('domicile-existe');
  });

  it('attrape quelqu\'un compté deux fois', () => {
    const m = monde();
    const p = [...m.personnages.values()][0];
    if (p === undefined) throw new Error('population vide');
    const l = m.lieux.get(p.lieu);
    if (l === undefined) throw new Error('lieu manquant');

    l.occupants.push(p.id);
    const regles = verifierInvariants(m).map((v) => v.regle);
    expect(regles).toContain('occupant-unique');
    expect(regles).toContain('placement-unique');
  });
});
