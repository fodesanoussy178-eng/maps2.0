/* Le code livré, sans la prose qui l'explique.

   Autour est commenté en français, abondamment et volontairement : la raison
   d'une règle vaut la règle. Ces commentaires appartiennent au dépôt, et ils
   y restent. Mais ils voyagent aussi jusqu'au téléphone, et là ils ne servent
   à personne.

   Ce qui a été mesuré, sur la source telle qu'elle est :

     app.js                198,6 ko gzip   dont 93,5 ko de commentaires (47 %)
     chemin critique       303   ko gzip   dont ~135 ko de commentaires

   La prose compresse mal comparée au code, qui se répète. À 1,6 Mbit/s —
   le profil mobile ordinaire du banc — ces 135 ko sont environ sept dixièmes
   de seconde pendant lesquelles l'écran ne répond à rien.

   Ce script ne touche PAS aux fichiers du dépôt : il écrit une copie allégée
   dans un dossier de livraison, et c'est elle qu'on déploie.

   Le retrait n'est pas fait à coups d'expressions régulières. Une barre
   oblique peut être une division, un littéral d'expression régulière ou le
   début d'un commentaire, et se tromper corromprait le programme en silence.
   C'est donc `esbuild` — un vrai analyseur — qui relit chaque fichier et le
   réimprime. Les identifiants, la syntaxe et l'ordre sont conservés tels
   quels : seule la mise en forme et les commentaires disparaissent.

   Usage :
     node outils/alleger.mjs                  → écrit dans livraison/
     node outils/alleger.mjs --sortie chemin  → ailleurs
     node outils/alleger.mjs --verifier       → n'écrit rien, dit ce qu'on gagne
*/

import { readFile, readdir, stat, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

import { MODULES, MODULES_DIFFERES } from "./modules.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Ce qui part vers le navigateur, et rien d'autre. Les fonctions du bord
   (`api/`, `middleware.js`) ne sont pas sur le chemin critique de l'écran ;
   le SDK vendorisé arrive déjà minifié et n'est pas à nous. */
const A_ALLEGER = MODULES.concat(MODULES_DIFFERES);

/* CE QUE LA LIVRAISON NE CONTIENT PAS.

   Deux raisons, et la seconde est la plus importante.

   1. Ça ne sert à rien sur un CDN : le banc de mesure, les tests, la
      documentation, les dépendances de build.

   2. ÇA NE DOIT PAS ÊTRE PUBLIC. Vérifié sur la production du 20/08 :
      `autour.eu/supabase/migrations/…sql`, `autour.eu/supabase/functions/…`
      et `autour.eu/tests/…` répondaient 200. Le schéma de la base, les
      politiques RLS, la référence du projet Supabase et le protocole de
      synchronisation étaient lisibles par n'importe qui. Aucun secret n'y
      figure — ils vivent dans Vault — mais rien de tout cela n'a de raison
      d'être servi.

   `api/`, `middleware.js` et `vercel.json` sont exclus pour une raison
   inverse : ils restent à la RACINE du projet, là où Vercel les attend. Les
   recopier ici les exposerait en source lisible (`/api/lieux.js`) à côté de
   la fonction qu'ils servent déjà (`/api/lieux`). */
const HORS_LIVRAISON = new Set([
  /* ce qui n'est pas servi */
  "outils", "tests", "docs", "supabase", "livraison", "node_modules",
  /* l'ancienne application reconstruite : gardée au dépôt comme archive de
     référence jusqu'au smoke test, mais elle n'a plus à être servie. */
  "prod-reconstruite",
  /* ce que Vercel lit à la racine du projet, pas dans la sortie */
  "api", "middleware.js", "vercel.json", "package.json", "package-lock.json",
  ".vercelignore", ".vercel",
]);

const args = process.argv.slice(2);
const verifierSeulement = args.includes("--verifier");
const iSortie = args.indexOf("--sortie");
const SORTIE = join(RACINE, iSortie === -1 ? "livraison" : args[iSortie + 1]);

/* Les déclarations de premier niveau, avant et après : c'est le contrat
   observable du fichier. Si l'une disparaît ou change d'ordre, la
   réimpression n'est plus une réimpression et le script doit s'arrêter. */
function declarations(source) {
  return [...source.matchAll(/^(?:async )?function ([A-Za-zÀ-ÿ_$][\w$À-ÿ]*)\s*\(/gm)]
    .map((m) => m[1]);
}

const ko = (n) => (n / 1024).toFixed(1).padStart(7) + " ko";
let brutAvant = 0, brutApres = 0, gzAvant = 0, gzApres = 0;
const lignes = [];
const alleges = new Map();

for (const module of A_ALLEGER) {
  const source = await readFile(join(RACINE, module), "utf8");
  const { code } = await transform(source, {
    loader: "js",
    /* Aucune minification : les noms, la syntaxe et l'ordre restent ceux du
       dépôt. Une pile d'appels reste donc lisible en production. */
    minify: false,
    minifyIdentifiers: false,
    minifySyntax: false,
    minifyWhitespace: false,
    legalComments: "none",
    /* `esnext` : aucune transposition. Réécrire `?.` ou un champ de classe
       pour un moteur plus ancien serait un changement de code, pas un
       allègement — et le dépôt vise les navigateurs qui les comprennent. */
    target: "esnext",
  });

  const avant = declarations(source);
  const apres = declarations(code);
  if (avant.length !== apres.length || avant.some((n, i) => n !== apres[i])) {
    console.error("✗ " + module + " : les déclarations de premier niveau ont changé.");
    console.error("  attendu " + avant.length + ", obtenu " + apres.length);
    process.exitCode = 1;
    continue;
  }

  alleges.set(module, code);
  const a = Buffer.byteLength(source), b = Buffer.byteLength(code);
  const ga = gzipSync(source, { level: 9 }).length, gb = gzipSync(code, { level: 9 }).length;
  brutAvant += a; brutApres += b; gzAvant += ga; gzApres += gb;
  lignes.push("  " + module.padEnd(28) + ko(ga) + " → " + ko(gb) +
    "   (−" + String(Math.round((1 - gb / ga) * 100)).padStart(2) + " %)");
}

console.log("\n──── ce que la livraison retire ────\n");
lignes.forEach((l) => console.log(l));
console.log("  " + "".padEnd(28, "─"));
console.log("  " + "total gzip".padEnd(28) + ko(gzAvant) + " → " + ko(gzApres) +
  "   (−" + Math.round((1 - gzApres / gzAvant) * 100) + " %)");
console.log("  " + "total brut".padEnd(28) + ko(brutAvant) + " → " + ko(brutApres));
console.log("\n  soit " + ((gzAvant - gzApres) / 1024).toFixed(1) +
  " ko de moins sur le chemin critique.\n");

if (verifierSeulement || process.exitCode) process.exit(process.exitCode || 0);

/* La copie : tout le dossier servi, puis les fichiers allégés par-dessus.
   Copier d'abord garantit qu'on n'oublie ni une image, ni `manifest.json`,
   ni une tuile de `zones/` le jour où il s'en ajoute une. */
await rm(SORTIE, { recursive: true, force: true });
await mkdir(SORTIE, { recursive: true });
/* Entrée par entrée, et non le dossier d'un coup : `cp` refuse — à raison —
   de recopier un dossier dans l'un de ses propres sous-dossiers. */
for (const entree of await readdir(RACINE)) {
  if (HORS_LIVRAISON.has(entree)) continue;
  await cp(join(RACINE, entree), join(SORTIE, entree), { recursive: true });
}
for (const [module, code] of alleges) await writeFile(join(SORTIE, module), code);

/* L'INVENTAIRE DE CE QUI PART. Une livraison qu'on ne relit pas est une
   livraison où un dossier s'ajoute un jour sans que personne ne le remarque. */
const inventaire = [];
async function parcourir(dossier, prefixe) {
  for (const entree of (await readdir(dossier, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const chemin = join(dossier, entree.name);
    const relatif = prefixe ? prefixe + "/" + entree.name : entree.name;
    if (entree.isDirectory()) await parcourir(chemin, relatif);
    else inventaire.push({ chemin: relatif, octets: (await stat(chemin)).size });
  }
}
await parcourir(SORTIE, "");

const parDossier = new Map();
for (const f of inventaire) {
  const cle = f.chemin.includes("/") ? f.chemin.split("/")[0] + "/" : "(racine)";
  const v = parDossier.get(cle) || { n: 0, octets: 0 };
  v.n += 1; v.octets += f.octets;
  parDossier.set(cle, v);
}
console.log("──── ce que la livraison contient ────\n");
[...parDossier.entries()].sort().forEach(([cle, v]) =>
  console.log("  " + cle.padEnd(22) + String(v.n).padStart(4) + " fichier(s)" + ko(v.octets)));
console.log("  " + "".padEnd(22, "─"));
console.log("  " + "total".padEnd(22) + String(inventaire.length).padStart(4) + " fichier(s)" +
  ko(inventaire.reduce((s2, f) => s2 + f.octets, 0)));

/* Le garde-fou : aucun de ces dossiers ne doit jamais réapparaître dans la
   sortie, quelle qu'en soit la raison. */
const interdits = inventaire.filter((f) =>
  /^(tests|outils|docs|supabase)\//.test(f.chemin) ||
  /^(vercel\.json|middleware\.js|package(-lock)?\.json)$/.test(f.chemin) ||
  /^api\//.test(f.chemin));
if (interdits.length) {
  console.error("\n✗ des fichiers qui ne doivent pas être servis sont dans la livraison :");
  interdits.slice(0, 10).forEach((f) => console.error("   " + f.chemin));
  process.exitCode = 1;
}

console.log("\nécrit dans " + SORTIE.slice(RACINE.length + 1) + "/  — c'est ce dossier que Vercel sert.");
