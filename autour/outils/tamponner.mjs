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

import { MODULES } from "../tests/empreintes.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHEMIN = join(RACINE, "index.html");

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

await writeFile(CHEMIN, html);
console.log("empreintes à jour (" + changes + " balise(s) réécrite(s))");
