import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { MODULES, empreintes } from "./empreintes.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
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
  assert.equal(tout.source, "/(.*)");
  assert.match(valeur(tout), /max-age=0/);
  assert.match(valeur(tout), /must-revalidate/);

  // l'ordre compte : la règle générale ne doit pas précéder les .js
  assert.ok(vercel.headers.findIndex((h) => h.source === "/(.*)\\.js")
          < vercel.headers.findIndex((h) => h.source === "/(.*)"),
    "la règle .js doit passer avant la règle générale");
});

test("chaque module est appelé avec l’empreinte de son contenu", async () => {
  // sans ça, le cache immuable garderait indéfiniment l'ancien fichier :
  // c'est exactement le problème Safari qu'on ne veut pas réintroduire
  const attendues = await empreintes(import.meta.url);
  for (const m of MODULES) {
    const trouve = new RegExp('<script src="' + m.replace(".", "\\.") + '\\?v=([a-f0-9]{8})"></script>')
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
