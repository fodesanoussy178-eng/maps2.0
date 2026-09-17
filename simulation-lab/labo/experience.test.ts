import { describe, expect, it } from 'vitest';
import { lancer } from './experience.ts';
import { stabiliteMoyenne, besoinMoyen, interactionsParJour, partCritique } from './metriques.ts';
import { decrireViolations } from '../etat/invariants.ts';
import { BESOINS, trait } from '../etat/personnage.ts';

/** La configuration nominale du banc d'essai : celle que le doc 4 cible. */
const NOMINAL = { graine: 1, population: 60, jours: 30 } as const;

describe('expérience de référence', () => {
  const r = lancer({ ...NOMINAL });

  it('tourne trente jours sans une seule incohérence', () => {
    expect(decrireViolations(r.violations)).toBe('aucune violation');
  });

  it('rejoue à l\'identique pour une même graine', () => {
    // Le déterminisme est une intention tant qu'il n'est pas un test. Celui-ci
    // tombera le jour où quelqu'un glissera un Math.random, une horloge
    // système ou une itération sur un Set dans un chemin décisionnel.
    const bis = lancer({ ...NOMINAL });
    expect(bis.empreinte).toBe(r.empreinte);
  });

  it('produit une autre société pour une autre graine', () => {
    const autre = lancer({ ...NOMINAL, graine: 2 });
    expect(autre.empreinte).not.toBe(r.empreinte);
  });

  it('simule trente jours assez vite pour qu\'on puisse régler la société', () => {
    // Ce n'est pas une exigence de confort. Sans cela, chaque essai
    // d'équilibrage coûte une pause, on en fait trois par jour au lieu de
    // trente, et régler une société vivante devient impraticable.
    expect(r.dureeMs).toBeLessThan(20_000);
  });

  it('donne des routines réelles, ni robotiques ni chaotiques', () => {
    // La mesure la plus importante du banc d'essai, et la seule qui
    // distingue une simulation vivante d'un ordonnanceur de tâches.
    const stabilite = stabiliteMoyenne(r.metriques, r.monde);
    expect(stabilite).toBeGreaterThan(0.55);
    expect(stabilite).toBeLessThan(0.9);
  });

  it('ne laisse aucun besoin vital saturé', () => {
    // Un besoin au-dessus du seuil critique plus d'un cinquième du temps
    // signifie que les habitants vivent en crise permanente : leurs routines
    // se brisent sans cesse et leur personnalité ne s'exprime plus.
    for (const b of BESOINS) {
      expect(partCritique(r.metriques, b), `besoin ${b}`).toBeLessThan(0.2);
      expect(besoinMoyen(r.metriques, b), `besoin ${b}`).toBeLessThan(700);
    }
  });

  it('fait vivre au sociable et au solitaire des journées différentes', () => {
    // Le critère A4 du doc 4 : la personnalité doit se voir sans jamais être
    // affichée. Deux habitants aux traits opposés, dans le même monde, avec
    // les mêmes règles, doivent produire des journées mesurablement
    // distinctes.
    const habitants = [...r.monde.personnages.values()].sort(
      (a, b) => trait(b, 'sociabilite') - trait(a, 'sociabilite'),
    );
    const n = Math.floor(habitants.length / 5);
    const moyenne = (g: typeof habitants): number =>
      g.reduce((s, p) => s + interactionsParJour(r.metriques, p, r.jours), 0) / g.length;

    const sociables = moyenne(habitants.slice(0, n));
    const solitaires = moyenne(habitants.slice(-n));
    expect(sociables / solitaires).toBeGreaterThan(1.5);
  });

  it('laisse une vraie place au tempérament dans les décisions', () => {
    // Ni des automates qui prennent toujours la meilleure option, ni des
    // girouettes qui tirent au sort.
    const { decisions, decisionsOptimales } = r.metriques;
    const taux = decisionsOptimales / decisions;
    expect(taux).toBeGreaterThan(0.5);
    expect(taux).toBeLessThan(0.95);
  });

  it('remplit exactement vingt-quatre heures par jour et par habitant', () => {
    // Test de conservation : aucun temps ne se perd ni ne se crée. Un écart
    // ici signalerait une activité qui déborde, une durée mal comptée ou un
    // personnage oublié par la boucle.
    const total = [...r.metriques.tempsParAction.values()].reduce((a, b) => a + b, 0);
    const attendu = r.jours * 288 * r.monde.personnages.size;
    expect(Math.abs(total - attendu) / attendu).toBeLessThan(0.001);
  });
});

describe('échelles de simulation', () => {
  it('reste cohérente et bien plus légère à l\'échelle horaire', () => {
    const micro = lancer({ graine: 9, population: 60, jours: 7, echelle: 'micro' });
    const meso = lancer({ graine: 9, population: 60, jours: 7, echelle: 'meso' });

    expect(decrireViolations(meso.violations)).toBe('aucune violation');
    // Le gain se lit sur les RÉVEILS, pas sur les décisions : une décision
    // n'est prise qu'à la fin d'une activité, donc leur nombre dépend de la
    // durée des activités et non du pas de simulation. C'est une leçon utile
    // pour la suite — on n'économise pas en décidant moins, on économise en
    // se réveillant moins.
    expect(meso.metriques.reveils).toBeLessThan(micro.metriques.reveils / 8);
    expect(Math.abs(meso.metriques.decisions - micro.metriques.decisions)).toBeLessThan(
      micro.metriques.decisions * 0.15,
    );
    // Les deux mondes divergent — les décisions sont prises à d'autres
    // instants — mais aucun des deux ne part en vrille.
    expect(meso.empreinte).not.toBe(micro.empreinte);
    const stabilite = stabiliteMoyenne(meso.metriques, meso.monde);
    expect(stabilite).toBeGreaterThan(0.5);
  });
});
