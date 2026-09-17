import { describe, expect, it } from 'vitest';
import { lancer } from './experience.ts';
import { stabiliteMoyenne, besoinMoyen, interactionsParJour, partCritique } from './metriques.ts';
import { decrireViolations } from '../etat/invariants.ts';
import { BESOINS, trait } from '../etat/personnage.ts';

/** Corrélation de Pearson. Zéro si l'une des séries est constante. */
function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

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
    // affichée.
    //
    // La mesure est une CORRÉLATION sur toute la population, et non plus le
    // rapport des moyennes de deux quintiles. Ce rapport se lisait mieux mais
    // ne tenait pas debout : douze personnes par quintile, et un seul
    // solitaire vivant dans un foyer de cinq suffisait à le faire passer de
    // 2,6 à 1,0 d'une graine à l'autre. La corrélation utilise les soixante
    // points et reste comprise entre 0,14 et 0,35 sur toutes les graines
    // essayées — l'effet est réel, il est simplement noyé dans la composition
    // des foyers.
    //
    // Cet écart faible est un constat à traiter à la phase des relations : un
    // sociable devrait choisir d'aller là où sont les gens qu'il connaît, et
    // aujourd'hui personne ne connaît personne.
    const habitants = [...r.monde.personnages.values()];
    const x = habitants.map((p) => trait(p, 'sociabilite'));
    const y = habitants.map((p) => interactionsParJour(r.metriques, p, r.jours));
    expect(correlation(x, y)).toBeGreaterThan(0.1);
  });

  it('garde cette différence sur plusieurs sociétés', () => {
    // Une seule graine peut réussir par chance. Trois ne le peuvent pas.
    for (const graine of [2, 3, 4]) {
      const autre = lancer({ ...NOMINAL, graine });
      const habitants = [...autre.monde.personnages.values()];
      const x = habitants.map((p) => trait(p, 'sociabilite'));
      const y = habitants.map((p) => interactionsParJour(autre.metriques, p, autre.jours));
      expect(correlation(x, y), `graine ${graine}`).toBeGreaterThan(0.1);
    }
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
