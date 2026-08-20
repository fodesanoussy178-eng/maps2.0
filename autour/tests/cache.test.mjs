import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { MODULES, MODULES_DIFFERES, empreintes } from "./empreintes.mjs";
import { sourceApplication } from "./source.mjs";

const html = await sourceApplication(import.meta.url);
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const outilLivraison = await readFile(new URL("../outils/alleger.mjs", import.meta.url), "utf8");
const ignore = await readFile(new URL("../.vercelignore", import.meta.url), "utf8");

test("le HTML se revalide, les modules sont immuables", () => {
  const regle = (motif) => vercel.headers.find((h) => h.source === motif);
  const valeur = (h) => h.headers.find((x) => x.key === "Cache-Control").value;

  // les scripts : cache long, jamais revalidé — c'est l'URL qui change
  const js = regle("/(.*)\\.js");
  assert.ok(js, "une règle doit viser les fichiers .js");
  assert.match(valeur(js), /max-age=31536000/);
  assert.match(valeur(js), /immutable/);

  // le HTML : revalidation à chaque ouverture, sinon Safari sert une vieille
  // version pendant des jours
  const tout = vercel.headers[vercel.headers.length - 1];
  assert.match(tout.source, /^\/:chemin/);
  assert.match(valeur(tout), /max-age=0/);
  assert.match(valeur(tout), /must-revalidate/);
  // …mais elle ne doit PAS écraser le cache des fonctions ni des jeux de zone :
  // c'est tout ce qui rend le démarrage à froid indépendant d'Overpass
  assert.match(tout.source, /\(\?!api\/\|zones\/\)/,
    "la règle générale doit épargner /api et /zones");

  // les jeux de zone : c'est ce qui s'affiche au tout premier lancement
  const zones = regle("/zones/(.*)");
  assert.ok(zones, "une règle doit viser les jeux de démarrage par zone");
  assert.match(valeur(zones), /s-maxage=\d{5,}/);
  assert.match(valeur(zones), /stale-while-revalidate/);

  // l'ordre compte : la règle générale ne doit pas précéder les .js
  assert.ok(vercel.headers.findIndex((h) => h.source === "/(.*)\\.js")
          < vercel.headers.length - 1,
    "la règle .js doit passer avant la règle générale");
});

/* `vercel.json` est validé par un schéma au déploiement : une clé inconnue —
   un `comment` bien intentionné, par exemple — fait échouer le build entier.
   Le raisonnement derrière chaque règle vit donc dans docs/demarrage-a-froid.md,
   et ce test garde la porte. */
test("vercel.json ne porte aucune clé hors schéma", () => {
  const clesRegle = new Set(["source", "headers", "has", "missing"]);
  vercel.headers.forEach((regle, i) => {
    Object.keys(regle).forEach((k) => assert.ok(clesRegle.has(k),
      "headers[" + i + "] : « " + k + " » n'existe pas dans le schéma Vercel"));
    regle.headers.forEach((h) => {
      assert.deepEqual(Object.keys(h).sort(), ["key", "value"]);
    });
  });
  vercel.rewrites.forEach((regle, i) => {
    Object.keys(regle).forEach((k) => assert.ok(
      ["source", "destination", "has", "missing"].includes(k),
      "rewrites[" + i + "] : « " + k + " » n'existe pas dans le schéma Vercel"));
  });
  // et rien d'autre à la racine que ce que ce fichier déclare volontairement
  assert.deepEqual(Object.keys(vercel).sort(),
    ["buildCommand", "headers", "outputDirectory", "rewrites"]);
});

test("le déploiement passe par la livraison allégée", async () => {
  /* C'est ici que le gain du chemin critique devient réel : sans ces deux
     clés, Vercel sert le dépôt tel quel — commentaires compris — et les
     137 ko économisés restent théoriques. */
  assert.equal(vercel.buildCommand, "node outils/alleger.mjs");
  assert.equal(vercel.outputDirectory, "livraison");

  /* Le build a besoin d'esbuild, et Vercel installe les dépendances du dossier
     racine du projet. Sans ce package.json, la commande échoue. */
  const paquet = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(paquet.devDependencies && paquet.devDependencies.esbuild,
    "esbuild doit être déclaré là où Vercel installe");
  assert.equal(paquet.type, "module",
    "api/*.js et middleware.js sont des modules ES : le dire évite que Node " +
    "ou un empaqueteur les relise en CommonJS");

  /* Le build doit tenir debout avec ce que `.vercelignore` laisse monter.
     Trouvé par `outils/production.mjs` : `alleger.mjs` importait la liste des
     modules depuis `tests/`, qui n'est pas téléversé — le build échouait en
     production sur un ERR_MODULE_NOT_FOUND. */
  const outil = await readFile(new URL("../outils/alleger.mjs", import.meta.url), "utf8");
  const ignores = ignore.split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  for (const importe of [...outil.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1])) {
    const dossier = importe.replace(/^\.\.?\//, "").split("/")[0];
    assert.ok(!ignores.includes(dossier),
      "la commande de build importe « " + importe + " », que .vercelignore écarte");
  }
});

test("ce qui reste à la racine du projet n’est pas recopié dans la livraison", () => {
  /* `api/` et `middleware.js` sont lus par Vercel à la RACINE, pas dans la
     sortie. Les recopier les exposerait en source lisible à côté de la
     fonction qu'ils servent. */
  for (const chemin of ["api", "middleware.js", "vercel.json", "package.json"])
    assert.match(outilLivraison, new RegExp('"' + chemin.replace(".", "\\.") + '"'),
      chemin + " doit rester hors de livraison/");
});

test("rien de privé ne peut se glisser dans la livraison", () => {
  /* Vérifié sur la production du 20/08 : autour.eu/supabase/migrations/*.sql,
     /supabase/functions/… et /tests/… répondaient 200. Schéma de la base,
     politiques RLS et protocole de synchronisation étaient publics. */
  for (const dossier of ["tests", "docs", "supabase", "outils"])
    assert.match(outilLivraison, new RegExp('"' + dossier + '"'),
      dossier + " ne doit jamais être servi");
  assert.match(outilLivraison, /des fichiers qui ne doivent pas être servis sont dans la livraison/,
    "l’outil doit échouer, pas seulement omettre");
  assert.match(ignore, /^supabase$/m, ".vercelignore doit écarter les migrations dès le téléversement");
  assert.match(ignore, /^tests$/m);
});

test("chaque module est appelé avec l’empreinte de son contenu", async () => {
  // sans ça, le cache immuable garderait indéfiniment l'ancien fichier :
  // c'est exactement le problème Safari qu'on ne veut pas réintroduire
  const attendues = await empreintes(import.meta.url);
  for (const m of MODULES) {
    const trouve = new RegExp('<script src="' + m.replace(".", "\\.") +
      '\\?v=([a-f0-9]{8})" defer></script>')
      .exec(html);
    assert.ok(trouve, m + " doit être chargé avec une empreinte");
    assert.equal(trouve[1], attendues[m],
      m + " a changé sans que son empreinte suive — relancer le tampon");
  }
});

test("les modules différés portent aussi l’empreinte de leur contenu", async () => {
  /* `differe/ecrans.js` n'apparaît pas dans le document : c'est `app.js` qui
     va le chercher. Il est servi avec la même règle de cache immuable, donc
     il court exactement le même risque — une vieille version gardée pour un
     an — et il a besoin de la même garantie. */
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const attendues = await empreintes(import.meta.url);
  for (const m of MODULES_DIFFERES) {
    const trouve = new RegExp('"' + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      '":"\\?v=([a-f0-9]{8})"').exec(app);
    assert.ok(trouve, m + " doit être déclaré dans VERSIONS_DIFFEREES avec une empreinte");
    assert.equal(trouve[1], attendues[m],
      m + " a changé sans que son empreinte suive — relancer le tampon");
  }
});

test("un écran différé n’est jamais chargé par le document lui-même", () => {
  /* Le jour où l'un d'eux reviendrait dans `index.html`, tout le bénéfice
     disparaîtrait sans que rien ne le dise. */
  for (const m of MODULES_DIFFERES)
    assert.doesNotMatch(html, new RegExp('<script src="' + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      m + " doit rester hors du chemin critique");
});

test("les URL propres des lieux et événements sont routées vers l’application", () => {
  const cibles = (vercel.rewrites || []).map((r) => r.source);
  assert.ok(cibles.includes("/l/:id"), "/l/:id doit être servi par l’application");
  assert.ok(cibles.includes("/e/:id"), "/e/:id doit être servi par l’application");
  (vercel.rewrites || []).forEach((r) => assert.equal(r.destination, "/index.html"));
});
