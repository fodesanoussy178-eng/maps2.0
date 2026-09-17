/**
 * Le rapport d'expérience.
 *
 * Du texte, lisible dans un terminal, et rien d'autre. Un banc d'essai dont
 * la sortie demande une interface graphique pour être lue est un banc d'essai
 * qu'on cesse d'utiliser au bout d'une semaine.
 */

import { TICKS_PAR_JOUR, formaterDate } from '../noyau/index.ts';
import { BESOINS, nomComplet, trait } from '../etat/personnage.ts';
import type { Monde } from '../etat/monde.ts';
import { posteDe } from '../etat/monde.ts';
import type { Personnage } from '../etat/personnage.ts';
import { decrireViolations } from '../etat/invariants.ts';
import type { Resultat } from './experience.ts';
import {
  besoinMoyen,
  heuresParJour,
  interactionsParJour,
  partCritique,
  stabiliteMoyenne,
  stabiliteRoutine,
} from './metriques.ts';

const barre = (valeur: number, max: number, largeur = 24): string => {
  const n = Math.max(0, Math.min(largeur, Math.round((valeur / max) * largeur)));
  return '█'.repeat(n) + '·'.repeat(largeur - n);
};

const pourcent = (x: number): string => `${(x * 100).toFixed(1)} %`;

function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const tries = valeurs.slice().sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  if (tries.length % 2 === 1) return tries[milieu] ?? 0;
  return ((tries[milieu - 1] ?? 0) + (tries[milieu] ?? 0)) / 2;
}

export function rapport(r: Resultat): string {
  const { monde, metriques: m } = r;
  const l: string[] = [];
  const habitants = [...monde.personnages.values()];

  l.push('═'.repeat(66));
  l.push('  SIMULATION LAB — rapport d\'expérience');
  l.push('═'.repeat(66));
  l.push(
    `  graine ${r.options.graine} · ${habitants.length} habitants · ${r.jours} jours · ` +
      `échelle ${r.options.echelle ?? 'micro'}`,
  );
  l.push(`  arrivée au ${formaterDate(monde.tick)}`);
  l.push(
    `  calculé en ${r.dureeMs.toFixed(0)} ms  (${((r.dureeMs / r.jours) || 0).toFixed(1)} ms par jour simulé)`,
  );
  l.push(`  empreinte d'état : ${r.empreinte}`);
  l.push('');

  // --- Cohérence ------------------------------------------------------------
  l.push('── COHÉRENCE ' + '─'.repeat(52));
  if (r.violations.length === 0) {
    l.push('  aucune violation d\'invariant');
  } else {
    l.push(`  ${r.violations.length} VIOLATION(S) :`);
    l.push(decrireViolations(r.violations.slice(0, 8)).split('\n').map((s) => `    ${s}`).join('\n'));
  }
  l.push('');

  // --- Emploi du temps ------------------------------------------------------
  l.push('── EMPLOI DU TEMPS MOYEN ' + '─'.repeat(41));
  l.push('  (heures par jour et par habitant)');
  const actions = [...m.tempsParAction.keys()]
    .map((a) => ({ a, h: heuresParJour(m, a, monde) }))
    .sort((x, y) => y.h - x.h);
  let totalHeures = 0;
  for (const { a, h } of actions) {
    totalHeures += h;
    l.push(`    ${a.padEnd(18)} ${h.toFixed(2).padStart(5)} h  ${barre(h, 10)}`);
  }
  l.push(`    ${'TOTAL'.padEnd(18)} ${totalHeures.toFixed(2).padStart(5)} h  (doit valoir 24,00)`);
  l.push('');

  // --- Besoins --------------------------------------------------------------
  l.push('── PRESSION DES BESOINS ' + '─'.repeat(42));
  l.push('  (0 = comblé, 1000 = critique · part du temps au-dessus de 800)');
  for (const b of BESOINS) {
    const moyen = besoinMoyen(m, b);
    l.push(
      `    ${b.padEnd(16)} ${moyen.toFixed(0).padStart(4)}  ${barre(moyen, 1000, 20)}  ` +
        `critique ${pourcent(partCritique(m, b)).padStart(7)}`,
    );
  }
  l.push('');

  // --- Routines -------------------------------------------------------------
  l.push('── ROUTINES ' + '─'.repeat(54));
  const stabilites = habitants.map((p) => stabiliteRoutine(m, p.id));
  const moyenne = stabiliteMoyenne(m, monde);
  l.push(`  stabilité moyenne : ${moyenne.toFixed(3)}   ${barre(moyenne, 1, 20)}`);
  l.push(
    `  plage : ${Math.min(...stabilites).toFixed(3)} à ${Math.max(...stabilites).toFixed(3)}`,
  );
  l.push('  lecture : ~1,0 = emploi du temps de robot · ~0,3 = chaos');
  l.push('            0,55–0,85 = une routine réelle, qui se brise parfois');
  l.push('');

  // --- Tempéraments ---------------------------------------------------------
  l.push('── LA PERSONNALITÉ SE VOIT-ELLE ? ' + '─'.repeat(32));
  const parSociabilite = habitants.slice().sort((a, b) => trait(b, 'sociabilite') - trait(a, 'sociabilite'));
  const n = Math.max(1, Math.floor(habitants.length / 5));
  const sociables = parSociabilite.slice(0, n);
  const solitaires = parSociabilite.slice(-n);
  const moyInteractions = (g: Personnage[]): number =>
    g.reduce((s, p) => s + interactionsParJour(m, p, r.jours), 0) / g.length;

  const hautes = moyInteractions(sociables);
  const basses = moyInteractions(solitaires);
  l.push(`  cinquième le plus sociable  : ${hautes.toFixed(2)} interactions par jour`);
  l.push(`  cinquième le plus solitaire : ${basses.toFixed(2)} interactions par jour`);
  l.push(
    `  écart : ×${basses > 0 ? (hautes / basses).toFixed(2) : '∞'}` +
      '   (sous ×1,3, les traits ne servent à rien)',
  );
  const optimalite = m.decisions === 0 ? 0 : m.decisionsOptimales / m.decisions;
  l.push(
    `  décisions prises sur la meilleure option : ${pourcent(optimalite)} ` +
      `sur ${m.decisions} décisions`,
  );
  l.push('  (100 % = des automates · un tempérament se lit dans cet écart)');
  l.push('');

  // --- Économie -------------------------------------------------------------
  l.push('── ARGENT ' + '─'.repeat(56));
  const argents = habitants.map((p) => p.argent);
  const salaries = habitants.filter((p) => posteDe(monde, p)?.genre === 'emploi');
  const gainMoyen = salaries.length === 0
    ? 0
    : salaries.reduce((s, p) => s + p.argent, 0) / salaries.length / Math.max(1, r.jours);
  l.push(
    `  médiane ${mediane(argents).toFixed(0)} €  ·  ` +
      `de ${Math.min(...argents).toFixed(0)} € à ${Math.max(...argents).toFixed(0)} €`,
  );
  l.push(`  les salariés accumulent ${gainMoyen.toFixed(0)} € par jour, sans jamais rien payer`);
  l.push('  AUCUN MOTEUR ÉCONOMIQUE : ni loyer, ni charges, ni pension. L\'argent');
  l.push('  entre par les salaires et ne ressort presque pas — la fortune des uns');
  l.push('  diverge et les autres restent à zéro. C\'est le premier chantier de la');
  l.push('  phase 5, et c\'est le banc d\'essai qui l\'a rendu chiffrable.');
  l.push('');

  // --- Frictions ------------------------------------------------------------
  if (m.echecs.size > 0) {
    l.push('── FRICTIONS ' + '─'.repeat(53));
    l.push('  (des faits du monde, pas des bugs : un café plein, une fin de mois)');
    for (const [raison, n2] of m.echecs) {
      l.push(`    ${raison.padEnd(22)} ${n2}`);
    }
    l.push('');
  }

  return l.join('\n');
}

/**
 * L'inspecteur : la journée type d'un habitant, heure par heure.
 *
 * C'est l'outil qui répond à la seule question que les moyennes ne savent pas
 * traiter — « est-ce que cette vie-là a du sens ? » — et le premier à
 * consulter quand un chiffre du rapport paraît étrange.
 */
export function journee(r: Resultat, p: Personnage): string {
  const parHeure = r.metriques.creneaux.get(p.id);
  const l: string[] = [];
  l.push('─'.repeat(66));
  l.push(`  ${nomComplet(p)} (#${p.id})  ·  ${decrireOccupation(r.monde, p)}`);
  l.push(`  ${decrireTraitsSaillants(p)}`);
  l.push(`  stabilité de routine : ${stabiliteRoutine(r.metriques, p.id).toFixed(3)}`);
  l.push('─'.repeat(66));

  if (parHeure === undefined) {
    l.push('  aucune activité enregistrée');
    return l.join('\n');
  }

  for (let h = 0; h < 24; h += 1) {
    const creneau = parHeure[h];
    if (creneau === undefined || creneau.size === 0) {
      l.push(`  ${String(h).padStart(2, '0')}h  —`);
      continue;
    }
    const tries = [...creneau.entries()].sort((a, b) => b[1] - a[1]);
    const total = tries.reduce((s, [, v]) => s + v, 0);
    const detail = tries
      .slice(0, 3)
      .map(([a, v]) => `${a} ${((v / total) * 100).toFixed(0)}%`)
      .join(', ');
    l.push(`  ${String(h).padStart(2, '0')}h  ${detail}`);
  }
  return l.join('\n');
}

function decrireOccupation(monde: Monde, p: Personnage): string {
  const poste = posteDe(monde, p);
  if (poste === undefined) return 'sans occupation';
  if (poste.genre === 'emploi') {
    return `${poste.intitule}, ${poste.debutH}h–${poste.finH}h, ${poste.salaireHoraire} €/h`;
  }
  return `${poste.intitule}, ${poste.debutH}h–${poste.finH}h`;
}

function decrireTraitsSaillants(p: Personnage): string {
  const saillants = (
    ['sociabilite', 'ambition', 'impulsivite', 'prudence', 'discipline', 'curiosite'] as const
  )
    .map((t) => ({ t, v: trait(p, t) }))
    .filter((x) => Math.abs(x.v) >= 35)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 3)
    .map((x) => `${x.v > 0 ? '' : 'peu '}${x.t}`);
  return saillants.length === 0 ? 'tempérament sans relief marqué' : saillants.join(' · ');
}

/** Comparaison de plusieurs graines : la même société, d'autres dés. */
export function comparaison(resultats: readonly Resultat[]): string {
  const l: string[] = [];
  l.push('═'.repeat(66));
  l.push('  COMPARAISON ENTRE GRAINES');
  l.push('═'.repeat(66));
  l.push('  graine   stabilité   interactions/j   argent médian   empreinte');
  for (const r of resultats) {
    const habitants = [...r.monde.personnages.values()];
    const inter =
      habitants.reduce((s, p) => s + interactionsParJour(r.metriques, p, r.jours), 0) /
      Math.max(1, habitants.length);
    const argents = habitants.map((p) => p.argent);
    l.push(
      `  ${String(r.options.graine).padEnd(8)} ${stabiliteMoyenne(r.metriques, r.monde)
        .toFixed(3)
        .padStart(9)} ${inter.toFixed(2).padStart(15)} ${mediane(argents)
        .toFixed(0)
        .padStart(15)}   ${r.empreinte}`,
    );
  }
  l.push('');
  l.push(
    '  Des empreintes toutes différentes : les graines produisent bien des',
    '  sociétés distinctes. Des indicateurs proches : les règles tiennent',
    '  malgré le hasard — c\'est cela qu\'on veut voir, pas l\'inverse.',
  );
  return l.join('\n');
}

export const TICKS_JOUR = TICKS_PAR_JOUR;
