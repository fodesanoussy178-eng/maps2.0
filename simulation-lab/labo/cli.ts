/**
 * La ligne de commande du banc d'essai.
 *
 *   npm run labo                              une expérience par défaut
 *   npm run labo -- --jours 30 --population 60
 *   npm run labo -- --graines 1,2,3           comparer plusieurs sociétés
 *   npm run labo -- --habitant 7              la journée type d'un habitant
 *   npm run labo -- --echelle meso            mesurer le coût de l'échelle
 *   npm run labo -- --rejeu                   vérifier le déterminisme
 */

import { parseArgs } from 'node:util';
import { lancer } from './experience.ts';
import { comparaison, journee, rapport } from './rapport.ts';
import type { Echelle } from '../noyau/index.ts';

const { values } = parseArgs({
  options: {
    graine: { type: 'string', default: '1' },
    graines: { type: 'string' },
    population: { type: 'string', default: '60' },
    jours: { type: 'string', default: '30' },
    echelle: { type: 'string', default: 'micro' },
    habitant: { type: 'string' },
    habitants: { type: 'string' },
    verifier: { type: 'boolean', default: false },
    rejeu: { type: 'boolean', default: false },
    aide: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.aide === true) {
  console.log(
    [
      'SIMULATION LAB',
      '',
      '  --graine N        graine de la société (défaut 1)',
      '  --graines a,b,c   compare plusieurs sociétés',
      '  --population N    nombre d\'habitants (défaut 60)',
      '  --jours N         durée simulée (défaut 30)',
      '  --echelle E       micro | meso | macro (défaut micro)',
      '  --habitant N      affiche en plus la journée type de cet habitant',
      '  --verifier        vérifie les invariants à chaque heure simulée',
      '  --rejeu           relance à l\'identique et compare les empreintes',
    ].join('\n'),
  );
  process.exit(0);
}

const population = Number.parseInt(values.population ?? '60', 10);
const jours = Number.parseInt(values.jours ?? '30', 10);
const echelle = (values.echelle ?? 'micro') as Echelle;
const verifier = values.verifier === true;

if (values.graines !== undefined) {
  const graines = values.graines
    .split(',')
    .map((g) => Number.parseInt(g.trim(), 10))
    .filter((g) => Number.isFinite(g));

  const resultats = graines.map((graine) =>
    lancer({ graine, population, jours, echelle, verifier }),
  );
  for (const r of resultats) console.log(rapport(r), '\n');
  console.log(comparaison(resultats));
  process.exit(resultats.some((r) => r.violations.length > 0) ? 1 : 0);
}

const graine = Number.parseInt(values.graine ?? '1', 10);
const resultat = lancer({ graine, population, jours, echelle, verifier });
console.log(rapport(resultat));

if (values.habitant !== undefined) {
  // Un rang, pas un identifiant : les identifiants sont distribués par un
  // compteur partagé avec les lieux, donc le premier habitant ne porte pas
  // le numéro 1. Demander « le douzième habitant » est ce qu'on veut dire.
  const rang = Number.parseInt(values.habitant, 10);
  const habitants = [...resultat.monde.personnages.values()];
  const p = habitants[rang - 1];
  if (p === undefined) {
    console.log(`\nRang ${rang} hors de la population (1 à ${habitants.length}).`);
  } else {
    console.log('\n' + journee(resultat, p));
  }
}

if (values.rejeu === true) {
  // Le déterminisme est une intention tant qu'il n'est pas vérifié. Deux
  // exécutions de la même graine doivent produire la même empreinte, au
  // caractère près.
  const bis = lancer({ graine, population, jours, echelle, verifier });
  const identique = bis.empreinte === resultat.empreinte;
  console.log('\n── REJEU ' + '─'.repeat(57));
  console.log(`  première exécution : ${resultat.empreinte}`);
  console.log(`  seconde exécution  : ${bis.empreinte}`);
  console.log(`  ${identique ? 'IDENTIQUE — le rejeu est déterministe' : 'DIVERGENCE — le déterminisme est cassé'}`);
  if (!identique) process.exit(1);
}

process.exit(resultat.violations.length > 0 ? 1 : 0);
