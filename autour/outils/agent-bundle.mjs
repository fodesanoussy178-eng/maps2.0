/* Le paquet déployé de l'agent, produit depuis les sources du dépôt.

   POURQUOI UN PAQUET, ET PAS LES SEPT FICHIERS

   Supabase déploie une fonction Edge en téléversant ses fichiers. Sept
   fichiers, c'est sept occasions qu'une version parte sans sa voisine — et une
   divergence entre `sources.mjs` déployé et `normalisation.mjs` déployé ne se
   voit qu'à l'exécution, sur une tâche qui échoue à trois heures du matin.

   `esbuild` réimprime les sept en un seul module, en conservant les noms et
   l'ordre : c'est exactement ce que fait `outils/alleger.mjs` pour le paquet
   du navigateur, avec le même outil et les mêmes garanties. Les commentaires
   partent — ils appartiennent au dépôt, qui reste la source de vérité de la
   prose — et rien d'autre ne change.

   Usage :
     node outils/agent-bundle.mjs            → écrit livraison/agent-acquisition.js
     node outils/agent-bundle.mjs --sortie X → ailleurs

   Puis déployer ce fichier unique comme `index.ts` de la fonction
   `agent-acquisition`.
*/
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const i = args.indexOf("--sortie");
const SORTIE = join(RACINE, i === -1 ? "livraison/agent-acquisition.js" : args[i + 1]);

const { outputFiles } = await build({
  entryPoints: [join(RACINE, "supabase/functions/agent-acquisition/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "esnext",
  legalComments: "none",
  /* Les identifiants restent : une erreur en production doit nommer la
     fonction qui l'a levée. Seuls la mise en forme et les commentaires
     disparaissent. */
  minifyIdentifiers: false,
  minifySyntax: false,
  minifyWhitespace: false,
  write: false,
});

const code = outputFiles[0].text;
await mkdir(dirname(SORTIE), { recursive: true });
await writeFile(SORTIE, code, "utf8");

console.log(`  agent-acquisition  ${(code.length / 1024).toFixed(1)} ko`);
console.log(`  empreinte sha256   ${createHash("sha256").update(code).digest("hex").slice(0, 16)}`);
console.log(`  écrit dans         ${SORTIE}`);
