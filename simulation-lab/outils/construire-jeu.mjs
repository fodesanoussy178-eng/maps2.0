/**
 * Construit le jeu en un seul fichier JavaScript.
 *
 * Format IIFE et non module : le résultat se charge avec une balise <script>
 * ordinaire, donc `jeu/index.html` s'ouvre directement depuis le disque, sans
 * serveur. C'est la façon la plus courte d'arriver à « j'ouvre et je joue ».
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const resultat = await build({
  entryPoints: [resolve(racine, 'jeu/main.ts')],
  outfile: resolve(racine, 'jeu/dist/jeu.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8',
  sourcemap: false,
  minify: process.argv.includes('--compact'),
  logLevel: 'warning',
  metafile: true,
});

const octets = Object.values(resultat.metafile.outputs)[0]?.bytes ?? 0;
console.log(`jeu/dist/jeu.js — ${(octets / 1024).toFixed(0)} Ko`);
console.log('Ouvrez jeu/index.html dans un navigateur, ou lancez `npm run jeu`.');
