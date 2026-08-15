import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { MODULES, empreintes } from "./empreintes.mjs";
import { sourceApplication } from "./source.mjs";

const html = await sourceApplication(import.meta.url);
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

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
  assert.deepEqual(Object.keys(vercel).sort(), ["headers", "rewrites"]);
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

test("les URL propres des lieux et événements sont routées vers l’application", () => {
  const cibles = (vercel.rewrites || []).map((r) => r.source);
  assert.ok(cibles.includes("/l/:id"), "/l/:id doit être servi par l’application");
  assert.ok(cibles.includes("/e/:id"), "/e/:id doit être servi par l’application");
  (vercel.rewrites || []).forEach((r) => assert.equal(r.destination, "/index.html"));
});
