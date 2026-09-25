/* Le paquet déployé d'une fonction Edge, produit depuis les sources du dépôt.

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

   DEUX FONCTIONS PASSENT PAR ICI, ET POUR LA MÊME RAISON.
   `agent-acquisition` et `sync-openagenda` ont toutes deux dépassé la taille
   qu'un déploiement fichier par fichier supportait sans casse. Le paquet leur
   évite la divergence ET le découpage.

   `--compact` retire en plus l'indentation. Ce n'est pas un choix esthétique :
   `sync-openagenda` réimprimé fait 108 ko, et le canal de déploiement les
   refuse. Les identifiants, eux, ne bougent jamais — une erreur en production
   doit continuer à nommer la fonction qui l'a levée.

   Usage :
     node outils/agent-bundle.mjs                        → agent-acquisition
     node outils/agent-bundle.mjs sync-openagenda --compact
     node outils/agent-bundle.mjs --sortie X             → ailleurs
*/
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const FONCTION = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--sortie")
  || "agent-acquisition";
const COMPACT = args.includes("--compact");
const i = args.indexOf("--sortie");
const SORTIE = join(RACINE, i === -1 ? `livraison/${FONCTION}.js` : args[i + 1]);

const { outputFiles } = await build({
  entryPoints: [join(RACINE, `supabase/functions/${FONCTION}/index.ts`)],
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
  minifyWhitespace: COMPACT,
  write: false,
});

const code = outputFiles[0].text;
await mkdir(dirname(SORTIE), { recursive: true });
await writeFile(SORTIE, code, "utf8");

console.log(`  ${FONCTION.padEnd(18)} ${(code.length / 1024).toFixed(1)} ko${COMPACT ? " (compact)" : ""}`);
console.log(`  empreinte sha256   ${createHash("sha256").update(code).digest("hex").slice(0, 16)}`);
console.log(`  écrit dans         ${SORTIE}`);
