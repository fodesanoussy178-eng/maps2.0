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

/* `differe/ecrans.js` porte les écrans qui ne partent plus avec la page : la
   fiche d'un lieu, l'itinéraire, la publication, le compte. La frontière a
   bougé une deuxième fois ; le contrat, lui, n'a pas changé — les tests
   posent toujours la question à la source entière. */
const MORCEAUX = ["index.html", "evenements-canoniques.js", "entites-canoniques.js", "app.js", "differe/ecrans.js"];

export function sourceApplicationSync(base) {
  return MORCEAUX.map((f) => readFileSync(new URL("../" + f, base), "utf8")).join("\n");
}

export async function sourceApplication(base) {
  const parts = [];
  for (const f of MORCEAUX) parts.push(await readFile(new URL("../" + f, base), "utf8"));
  return parts.join("\n");
}

/* Le CORPS seul, sans `index.html` : pour les règles qui parlent du programme
   et pas du document — « ce fichier ne contient aucune balise vers un CDN »
   n'a de sens que si l'on ne vient pas de coller le document qui en porte
   une, légitimement, pour Leaflet. */
const CORPS = ["evenements-canoniques.js", "entites-canoniques.js", "app.js", "differe/ecrans.js"];

export function corpsApplicationSync(base) {
  return CORPS.map((f) => readFileSync(new URL("../" + f, base), "utf8")).join("\n");
}

export async function corpsApplication(base) {
  const parts = [];
  for (const f of CORPS) parts.push(await readFile(new URL("../" + f, base), "utf8"));
  return parts.join("\n");
}
