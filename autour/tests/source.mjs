/* La source de l'application, telle que les tests la lisent.

   Le corps du programme vivait dans un `<script>` en ligne au fond de
   `index.html` ; il vit maintenant dans `app.js`, servi en cache immuable.
   Les tests, eux, posent la même question qu'avant — « la source contient-elle
   cette règle ? » — et cette question ne dépend pas du fichier où la règle est
   rangée. Ils lisent donc les deux, concaténés.

   C'est aussi ce qui a permis de sortir 568 ko d'`index.html` sans réécrire
   deux mille assertions : la frontière a bougé, le contrat non. */

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const MORCEAUX = ["index.html", "app.js"];

export function sourceApplicationSync(base) {
  return MORCEAUX.map((f) => readFileSync(new URL("../" + f, base), "utf8")).join("\n");
}

export async function sourceApplication(base) {
  const parts = [];
  for (const f of MORCEAUX) parts.push(await readFile(new URL("../" + f, base), "utf8"));
  return parts.join("\n");
}
