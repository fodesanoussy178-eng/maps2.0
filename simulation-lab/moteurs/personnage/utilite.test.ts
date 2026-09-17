import { describe, expect, it } from 'vitest';
import { creerAlea } from '../../noyau/index.ts';
import { BESOINS, TRAITS } from '../../etat/personnage.ts';
import type { Personnage } from '../../etat/personnage.ts';
import type { LieuId, PersoId } from '../../noyau/index.ts';
import type { Action, Contexte } from './actions.ts';
import { CATALOGUE } from './actions.ts';
import { decider, evaluer, exposant, tauxOptimalite } from './utilite.ts';

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
  argent: 500,
  activite: null,
  echelle: 'micro',
  derniereMaj: 0,
});

const acte = (id: string, considerations: readonly ((c: Contexte) => number)[]): Action => ({
  id,
  libelle: id,
  lieux: [],
  duree: 6,
  cout: 0,
  effets: {},
  sociale: false,
  considerations,
});

const ctxVide = {} as Contexte;

describe('IA d\'utilité', () => {
  it('annule une action dès qu\'une considération est nulle', () => {
    // Le produit, et non la moyenne : « manger au café » quand le café est
    // fermé ne doit pas rester moyennement intéressant.
    expect(evaluer(acte('a', [() => 0.9, () => 0]), ctxVide)).toBe(0);
  });

  it('compense les actions à nombreux critères', () => {
    // Sans compensation, décrire finement une action la désavantagerait
    // mécaniquement, et le catalogue dériverait vers des actions simplistes.
    const deux = evaluer(acte('deux', [() => 0.8, () => 0.8]), ctxVide);
    const cinq = evaluer(
      acte('cinq', [() => 0.8, () => 0.8, () => 0.8, () => 0.8, () => 0.8]),
      ctxVide,
    );
    expect(Math.pow(0.8, 5)).toBeLessThan(Math.pow(0.8, 2)); // le produit brut punit
    expect(cinq).toBeGreaterThan(Math.pow(0.8, 5) * 1.5); // la compensation rattrape
    expect(cinq).toBeLessThan(deux); // sans pour autant inverser l'ordre
  });

  it('donne un exposant plus élevé au prudent qu\'à l\'impulsif', () => {
    const impulsif = habitant({ impulsivite: 100, prudence: -100 });
    const prudent = habitant({ impulsivite: -100, prudence: 100 });
    expect(exposant(prudent)).toBeGreaterThan(exposant(impulsif) * 3);
  });

  it('fait trancher le prudent bien plus souvent sur la meilleure option', () => {
    // La réponse au §22 du cahier des charges : même monde, mêmes utilités,
    // tempéraments différents. C'est la seule chose qui distingue ces deux
    // personnages, et elle doit se voir.
    const scores = [0.62, 0.55, 0.48, 0.4];
    const prudent = tauxOptimalite(habitant({ impulsivite: -100, prudence: 100 }), scores, creerAlea(1));
    const impulsif = tauxOptimalite(habitant({ impulsivite: 100, prudence: -100 }), scores, creerAlea(1));

    expect(prudent).toBeGreaterThan(0.6);
    expect(impulsif).toBeLessThan(0.4);
    expect(prudent - impulsif).toBeGreaterThan(0.3);
  });

  it('décide de façon reproductible pour une même graine', () => {
    const p = habitant();
    const contexte = (a: Action): Contexte => ({
      monde: {} as Contexte['monde'],
      perso: p,
      heure: 14,
      presents: 2,
      surPlace: true,
      accessible: true,
      argentFoyer: 500,
      ...{ action: a },
    });
    const premier = decider(CATALOGUE, contexte, p, creerAlea(42));
    const second = decider(CATALOGUE, contexte, p, creerAlea(42));
    expect(premier?.action.id).toBe(second?.action.id);
  });

  it('départage deux scores égaux par l\'identifiant, jamais par l\'ordre du tri', () => {
    // Sans ce second critère, l'ordre dépendrait de l'implémentation du tri,
    // et deux parties issues de la même graine pourraient diverger.
    const actions = [acte('zeta', [() => 0.5]), acte('alpha', [() => 0.5])];
    const contexte = (): Contexte => ctxVide;
    const d = decider(actions, contexte, habitant({ impulsivite: -100, prudence: 100 }), creerAlea(7));
    expect(d?.candidats[0]?.action.id).toBe('alpha');
  });

  it('renvoie null quand rien n\'est possible', () => {
    const actions = [acte('impossible', [() => 0])];
    expect(decider(actions, () => ctxVide, habitant(), creerAlea(1))).toBeNull();
  });
});
