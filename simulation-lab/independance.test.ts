/**
 * L'indépendance du projet est une règle, donc c'est un test.
 *
 * Simulation Lab ne doit JAMAIS toucher, de près ou de loin, aux deux autres
 * projets du dépôt — `autour/` et `src/` (Urosi-t). Pas un import, pas un
 * chemin, pas un fichier de configuration partagé, pas une dépendance
 * commune installée ailleurs.
 *
 * Une règle qu'on se contente d'écrire dans un README est une règle qui sera
 * violée un jour, par commodité, dans un fichier que personne ne relit. Ce
 * test-ci remonte chaque import de chaque fichier du projet et vérifie que sa
 * cible reste à l'intérieur. Il tombera à la première entorse.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = dirname(fileURLToPath(import.meta.url));
const INTERDITS = ['autour', 'src'];

function fichiers(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    if (entree === 'node_modules' || entree.startsWith('.')) continue;
    const chemin = resolve(dossier, entree);
    if (statSync(chemin).isDirectory()) fichiers(chemin, acc);
    else if (/\.(ts|html|json)$/.test(entree)) acc.push(chemin);
  }
  return acc;
}

const IMPORT = /(?:from|import)\s+['"]([^'"]+)['"]/g;

describe('indépendance du projet', () => {
  const tous = fichiers(RACINE);

  it('trouve bien les fichiers du projet', () => {
    expect(tous.length).toBeGreaterThan(15);
  });

  it('ne contient aucun import qui sorte de simulation-lab', () => {
    const fautes: string[] = [];

    for (const fichier of tous) {
      if (!fichier.endsWith('.ts')) continue;
      const source = readFileSync(fichier, 'utf8');
      for (const trouve of source.matchAll(IMPORT)) {
        const cible = trouve[1];
        if (cible === undefined) continue;
        if (!cible.startsWith('.')) continue; // paquet npm : traité plus bas

        const absolu = resolve(dirname(fichier), cible);
        const depuisRacine = relative(RACINE, absolu);
        if (depuisRacine.startsWith('..')) {
          fautes.push(`${relative(RACINE, fichier)} importe ${cible}`);
        }
      }
    }

    expect(fautes).toEqual([]);
  });

  it('ne nomme jamais autour/ ni src/ dans ses fichiers', () => {
    const fautes: string[] = [];
    for (const fichier of tous) {
      if (fichier === resolve(RACINE, 'independance.test.ts')) continue;
      const source = readFileSync(fichier, 'utf8');
      for (const interdit of INTERDITS) {
        for (const motif of [`'${interdit}/`, `"${interdit}/`, `../${interdit}/`]) {
          if (source.includes(motif)) {
            fautes.push(`${relative(RACINE, fichier)} mentionne ${motif}`);
          }
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  it("n'a aucune dépendance d'exécution, et quatre outils à lui", () => {
    const paquet = JSON.parse(
      readFileSync(resolve(RACINE, 'package.json'), 'utf8'),
    ) as { dependencies?: object; devDependencies?: object };

    // Le moteur de simulation ne dépend de rien : c'est ce qui garantit qu'il
    // tournera aussi bien dans un test, dans un navigateur ou dans un serveur.
    expect(paquet.dependencies ?? {}).toEqual({});

    // Les outils de développement sont installés dans le node_modules du
    // projet. Qu'un autre projet du dépôt utilise par ailleurs les mêmes
    // paquets publics ne crée aucun lien entre eux : ils ne partagent ni
    // fichier, ni configuration, ni installation.
    expect(Object.keys(paquet.devDependencies ?? {}).sort()).toEqual([
      '@types/node',
      'tsx',
      'typescript',
      'vitest',
    ]);
  });

  it('porte sa propre configuration TypeScript et sa propre configuration de test', () => {
    for (const config of ['tsconfig.json', 'vitest.config.ts', 'package.json']) {
      expect(() => readFileSync(resolve(RACINE, config), 'utf8')).not.toThrow();
    }
    const ts = readFileSync(resolve(RACINE, 'tsconfig.json'), 'utf8');
    expect(ts).not.toContain('extends');
  });
});
