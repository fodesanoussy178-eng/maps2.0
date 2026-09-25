/* Recalcule l'empreinte de chaque module et la réécrit dans `index.html`.

   Les fichiers .js sont servis en cache immuable (un an) : c'est ce qui rend
   la deuxième visite quasi instantanée, et c'est exactement ce qui garderait
   un navigateur sur une vieille version si l'URL ne changeait pas. L'URL doit
   donc changer avec le contenu — d'où `?v=<empreinte>`, et un test qui échoue
   si l'un d'eux a bougé sans que son empreinte suive.

   Usage : node outils/tamponner.mjs */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MODULES, MODULES_DIFFERES, FEUILLES } from "./modules.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHEMIN = join(RACINE, "index.html");

const sha = async (fichier) =>
  createHash("sha256").update(await readFile(join(RACINE, fichier), "utf8")).digest("hex").slice(0, 8);

/* LES MODULES DIFFÉRÉS D'ABORD. Leur empreinte est écrite DANS `app.js` :
   la calculer après celle d'`app.js` laisserait `index.html` pointer sur une
   version qui n'existe plus dès la ligne suivante. */
{
  const CHEMIN_APP = join(RACINE, "app.js");
  let app = await readFile(CHEMIN_APP, "utf8");
  for (const module of MODULES_DIFFERES) {
    const empreinte = await sha(module);
    const echappe = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const motif = new RegExp('("' + echappe + '":")(\\?v=[a-f0-9]{8})?(")');
    if (!motif.test(app)) {
      console.error("✗ " + module + " n'est pas déclaré dans VERSIONS_DIFFEREES");
      process.exitCode = 1;
      continue;
    }
    app = app.replace(motif, '$1?v=' + empreinte + '$3');
  }
  await writeFile(CHEMIN_APP, app);
}

let html = await readFile(CHEMIN, "utf8");
let changes = 0;

for (const module of MODULES) {
  const contenu = await readFile(join(RACINE, module), "utf8");
  const empreinte = createHash("sha256").update(contenu).digest("hex").slice(0, 8);
  const echappe = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const motif = new RegExp('(<script src="' + echappe + ')(\\?v=[a-f0-9]{8})?(")');
  if (!motif.test(html)) {
    console.error("✗ " + module + " n'est pas chargé par index.html");
    process.exitCode = 1;
    continue;
  }
  const avant = html;
  html = html.replace(motif, '$1?v=' + empreinte + '$3');
  if (html !== avant) changes += 1;
}

/* ---- LA FEUILLE DE STYLE AUSSI -----------------------------------------
   `autour.css` est servi avec la même promesse que les scripts : immuable
   pendant un an, remplacé par le changement de son empreinte. Sans cette
   réécriture, une correction de style resterait invisible pour qui a déjà
   visité le site — le pire des deux mondes, puisque la règle serait juste
   dans le dépôt et fausse dans le navigateur. */
for (const feuille of FEUILLES) {
  const contenu = await readFile(join(RACINE, feuille), "utf8");
  const empreinte = createHash("sha256").update(contenu).digest("hex").slice(0, 8);
  const echappe = feuille.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const motif = new RegExp('(<link rel="stylesheet" href="' + echappe + ')(\\?v=[a-f0-9]{8})?(")');
  if (!motif.test(html)) {
    console.error("✗ " + feuille + " n'est pas liée par index.html");
    process.exitCode = 1;
    continue;
  }
  const avant = html;
  html = html.replace(motif, '$1?v=' + empreinte + '$3');
  if (html !== avant) changes += 1;
}

await writeFile(CHEMIN, html);
console.log("empreintes à jour (" + changes + " balise(s) réécrite(s))");
