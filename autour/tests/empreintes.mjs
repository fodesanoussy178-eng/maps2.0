/* Empreinte de chaque module chargé par la page.

   Les fichiers JS sont servis en cache immuable (un an) : c'est ce qui évite
   de retélécharger 60 ko de logique à chaque ouverture, et c'est exactement ce
   qui garde Safari sur une vieille version quand l'URL ne change pas. L'URL
   doit donc changer avec le contenu — d'où `?v=<empreinte>` sur chaque script,
   et un test qui échoue si l'un d'eux a bougé sans que son empreinte suive. */

import { createHash } from "node:crypto";
import { MODULES, MODULES_DIFFERES } from "../outils/modules.mjs";
import { readFile } from "node:fs/promises";

/* La liste elle-même vit dans `outils/modules.mjs` : c'est un manifeste de
   livraison, dont la commande de build a besoin autant que les tests. On la
   ré-exporte pour que rien de ce qui l'importait d'ici ne change. */
export { MODULES, MODULES_DIFFERES } from "../outils/modules.mjs";

export async function empreinte(fichier, base) {
  const contenu = await readFile(new URL("../" + fichier, base), "utf8");
  return createHash("sha256").update(contenu).digest("hex").slice(0, 8);
}

export async function empreintes(base) {
  const out = {};
  for (const m of MODULES.concat(MODULES_DIFFERES)) out[m] = await empreinte(m, base);
  return out;
}
