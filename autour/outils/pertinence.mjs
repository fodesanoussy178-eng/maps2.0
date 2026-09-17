/* ===========================================================================
   COMBIEN COÛTE LA PERTINENCE PERSONNELLE ?

   Le classement d'un centre-ville dense est déjà le point chaud connu
   d'Autour : `outils/vitesse.mjs` mesure 1815 ms de blocage du fil principal
   là où l'objectif est 1000. Y ajouter une composante par objet n'est donc pas
   gratuit par principe — il faut le chiffre.

   POURQUOI CE BANC ENTRELACE SES MESURES, et c'est la partie qui vaut d'être
   connue. Une première version chargeait l'ancien `core.js`, le mesurait, puis
   chargeait le nouveau et le mesurait. Elle a rendu, pour un chemin de code
   IDENTIQUE — le nouveau moteur sans vecteur d'intérêt, qui ne fait rien de
   plus que l'ancien — des surcoûts de 6,4 %, 9,0 % puis 12,7 % selon
   l'exécution. Le second moteur mesuré hérite d'un JIT déjà chaud, d'un tas
   déjà fragmenté et d'un ramasse-miettes déjà réveillé. Ces trois chiffres ne
   disaient rien du code : ils disaient l'ordre dans lequel on avait mesuré.

   On alterne donc les trois scénarios à chaque tour, et on prend la médiane.
   Le surcoût réel du lot A tombe alors dans le bruit.

     node outils/pertinence.mjs
   ======================================================================== */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.localStorage = {
  s: new Map(),
  getItem(k){ return this.s.has(k) ? this.s.get(k) : null; },
  setItem(k, v){ this.s.set(k, String(v)); },
  removeItem(k){ this.s.delete(k); },
};

require(join(RACINE, "signaux.js"));
require(join(RACINE, "availability.js"));
require(join(RACINE, "temporel.js"));
require(join(RACINE, "apprentissage.js"));
require(join(RACINE, "pertinence.js"));

const A = globalThis.AutourApprentissage;
for (let i = 0; i < 8; i += 1) A.noter("sauvegarde", "musee");
for (let i = 0; i < 5; i += 1) A.noter("clic", "concert");

/* La version d'avant, telle que git l'a gardée : comparer à soi-même est la
   seule référence honnête, et elle ne demande à personne de garder un vieux
   fichier à jour. */
const REF = process.env.AUTOUR_REF || "HEAD";
const temp = mkdtempSync(join(tmpdir(), "autour-banc-"));
const avantChemin = join(temp, "core-avant.cjs");
writeFileSync(avantChemin,
  execFileSync("git", ["show", REF + ":autour/core.js"], {cwd: join(RACINE, ".."), encoding: "utf8"}));

const CATS = ["cafe","resto","musee","parc","biblio","cinema","bar","marche","concert","spectacle"];
const now = Date.UTC(2026, 5, 20, 12, 0);
const JOUR = 864e5;

/* Centre-ville dense : 130 lieux et 20 événements, le scénario que
   `outils/vitesse.mjs` désigne comme le pire cas réel. */
const items = [];
for (let i = 0; i < 130; i += 1) items.push({
  id: "p" + i, titre: "Lieu " + i, cat: CATS[i % CATS.length],
  lat: 50.63 + (i % 20) * 0.001, lng: 3.06 + (i % 17) * 0.001,
  ouvert: true, quand: "Mo-Su 08:00-23:00",
  note: 3 + (i % 20) / 10, avis: i * 7,
});
for (let i = 0; i < 20; i += 1) items.push({
  id: "e" + i, titre: "Événement " + i, cat: "concert", isTemporary: true,
  lat: 50.632 + (i % 7) * 0.002, lng: 3.062 + (i % 5) * 0.002,
  startsAt: now + (i - 3) * JOUR, endsAt: now + (i - 3) * JOUR + 3 * 36e5,
  date_confidence: "exact",
  importance_level: i % 5 === 0 ? "major" : "local", importance_score: i % 5 === 0 ? 90 : 10,
});

delete globalThis.AutourCore;
require(avantChemin);
const avant = globalThis.AutourCore;
delete globalThis.AutourCore;
require(join(RACINE, "core.js"));
const apres = globalThis.AutourCore;

const BASE = { intent: "sortir", position: [50.63, 3.06], now, categories: CATS, radius: 20000 };
const CABLE = Object.assign({}, BASE,
  { interets: A.vecteur(now), envies: ["concerts"], hierarchie: "explorer" });

const tour = (core, ctx, n) => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i += 1) core.rankResults(items, ctx);
  return Number(process.hrtime.bigint() - t0) / 1e6 / n;
};
const mediane = (xs) => {
  const t = xs.slice().sort((a, b) => a - b);
  return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
};

for (let i = 0; i < 8; i += 1) {
  avant.rankResults(items, BASE); apres.rankResults(items, BASE); apres.rankResults(items, CABLE);
}
const a = [], b = [], c = [];
for (let i = 0; i < 15; i += 1) {
  a.push(tour(avant, BASE, 20));
  b.push(tour(apres, BASE, 20));
  c.push(tour(apres, CABLE, 20));
}
const ma = mediane(a), mb = mediane(b), mc = mediane(c);
const ecart = (x) => ((x - ma) / ma * 100).toFixed(1).padStart(5) + " %";

console.log("");
console.log("  " + items.length + " objets · médiane de 15 tours entrelacés · référence " + REF);
console.log("");
console.log("  avant                                    " + ma.toFixed(2).padStart(7) + " ms");
console.log("  après, appelant non migré                " + mb.toFixed(2).padStart(7) + " ms   " + ecart(mb));
console.log("  après, vecteur + envies + hiérarchie     " + mc.toFixed(2).padStart(7) + " ms   " + ecart(mc));
console.log("");

/* Un seuil, pas une impression. Au-delà, le lot A n'est plus gratuit et il
   faut le dire plutôt que de le noyer dans une moyenne. */
const SEUIL = 5;
const depasse = (mc - ma) / ma * 100 > SEUIL;
console.log(depasse
  ? "  ✗ le surcoût câblé dépasse " + SEUIL + " % — à traiter avant le lot E"
  : "  ✓ le surcoût câblé reste sous " + SEUIL + " %");
process.exitCode = depasse ? 1 : 0;
