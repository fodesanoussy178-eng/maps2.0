/* Empreinte de chaque module chargé par la page.

   Les fichiers JS sont servis en cache immuable (un an) : c'est ce qui évite
   de retélécharger 60 ko de logique à chaque ouverture, et c'est exactement ce
   qui garde Safari sur une vieille version quand l'URL ne change pas. L'URL
   doit donc changer avec le contenu — d'où `?v=<empreinte>` sur chaque script,
   et un test qui échoue si l'un d'eux a bougé sans que son empreinte suive. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const MODULES = ["availability.js", "comprendre.js", "donnees.js", "signaux.js", "temporel.js",
                        "explications.js", "events.js", "core.js", "transit.js"];

export async function empreinte(fichier, base) {
  const contenu = await readFile(new URL("../" + fichier, base), "utf8");
  return createHash("sha256").update(contenu).digest("hex").slice(0, 8);
}

export async function empreintes(base) {
  const out = {};
  for (const m of MODULES) out[m] = await empreinte(m, base);
  return out;
}
