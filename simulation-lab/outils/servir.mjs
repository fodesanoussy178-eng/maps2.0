/** Construit le jeu puis le sert en local. `npm run jeu`. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
spawnSync(process.execPath, [join(racine, 'outils/construire-jeu.mjs')], { stdio: 'inherit' });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const PORT = Number(process.env.PORT ?? 5175);

createServer(async (req, res) => {
  const brut = (req.url ?? '/').split('?')[0] ?? '/';
  const chemin = normalize(decodeURI(brut));
  const fichier = chemin === '/' ? 'jeu/index.html' : chemin.replace(/^[\\/]+/, '');
  try {
    const contenu = await readFile(join(racine, fichier));
    res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' });
    res.end(contenu);
  } catch {
    res.writeHead(404).end('introuvable');
  }
}).listen(PORT, () => console.log(`\n  Le jeu est sur http://localhost:${PORT}\n`));
