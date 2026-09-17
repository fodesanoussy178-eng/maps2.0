/**
 * Construit la vue du quartier : un fichier HTML autonome.
 *
 *   npm run vue
 *   npm run vue -- --graine 3 --jours 2 --population 60
 *
 * Le fichier produit ne dépend de rien : ni serveur, ni outil de
 * construction, ni bibliothèque. On l'ouvre dans un navigateur et le quartier
 * se met à vivre. C'est voulu — une vue qui demande une chaîne de
 * construction est une vue qu'on ne regarde jamais.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { enregistrer } from './trace.ts';

const ICI = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    graine: { type: 'string', default: '1' },
    population: { type: 'string', default: '60' },
    jours: { type: 'string', default: '3' },
    pas: { type: 'string', default: '3' },
    sortie: { type: 'string', default: 'quartier.html' },
  },
});

const options = {
  graine: Number.parseInt(values.graine ?? '1', 10),
  population: Number.parseInt(values.population ?? '60', 10),
  jours: Number.parseInt(values.jours ?? '3', 10),
  pas: Number.parseInt(values.pas ?? '3', 10),
};

const trace = enregistrer(options);
const gabarit = readFileSync(resolve(ICI, 'gabarit.html'), 'utf8');

const page = gabarit.replace('/*__TRACE__*/ null', JSON.stringify(trace));
if (page === gabarit) {
  throw new Error("Le repère /*__TRACE__*/ n'a pas été trouvé dans gabarit.html.");
}

const cible = resolve(ICI, values.sortie ?? 'quartier.html');
writeFileSync(cible, page, 'utf8');

const poids = (page.length / 1024).toFixed(0);
console.log(
  `${cible}\n` +
    `  ${trace.meta.population} habitants · ${trace.meta.jours} jours · ` +
    `${trace.images.length} images · graine ${trace.meta.graine}\n` +
    `  simulé en ${trace.meta.dureeMs} ms · ${trace.meta.violations} incohérence(s) · ${poids} Ko\n` +
    '  ouvrez ce fichier dans un navigateur.',
);
