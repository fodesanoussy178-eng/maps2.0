/* Créer V1 : créer → publier → partager → ouvrir → participer.
   Ces tests verrouillent les invariants qui ont été cassés ou manquaient :
   ils ne remplacent pas le banc navigateur, ils l'empêchent de régresser. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { echapper, balisesApercu, injecter, quandAbsolu } from "../api/e.js";

const lire = (p) => readFile(new URL(p, import.meta.url), "utf8");
const app = await lire("../app.js");
const ecrans = await lire("../differe/ecrans.js");
const index = await lire("../index.html");
const vercel = JSON.parse(await lire("../vercel.json"));
const migration = await lire("../supabase/migrations/20260926160000_creer_v1_participation_signalement.sql");
const maintenant = await lire("../maintenant.js");
const css = await lire("../autour.css");

test("un lien /e/<id>/<titre> charge ses scripts depuis la racine", () => {
  // sans <base>, `app.js` se résolvait en /e/<id>/app.js — réécrit en HTML
  const base = index.indexOf('<base href="/" />');
  assert.ok(base > 0, "index.html doit poser <base href=\"/\">");
  const premierRelatif = index.search(/(?:href|src)="(?!https?:|data:|\/|#)[^"]+"/);
  assert.ok(base < premierRelatif, "la base doit précéder toute URL relative");
});

test("les deux formes /e/ passent par l'aperçu, sans second système d'URL", () => {
  const e = vercel.rewrites.filter((r) => r.source.startsWith("/e/"));
  assert.deepEqual(e.map((r) => r.destination), ["/api/e?id=:id", "/api/e?id=:id"]);
  assert.match(app, /u\.pathname = "\/e\/"\+encodeURIComponent\(l\.dbId\)/);
});

test("aperçu : titre, date absolue, lieu, places — rien de privé, tout échappé", () => {
  const p = { titre: 'Foot "au" <parc>', cat: "sport", debut_le: "2026-09-26T15:00:00Z",
    adresse: "Parc Clemenceau", image_url: "javascript:alert(1)", created_by: "secret-uuid" };
  const b = balisesApercu(p, { participants: 3, places: 10 }, "https://autour.eu/e/x");
  assert.equal(b.titre, '⚽ Foot "au" <parc>');
  assert.match(b.description, /sam\. 26 sept\. · 17h · Parc Clemenceau · 3\/10 participants/);
  assert.equal(b.image, "https://autour.eu/og.png", "seule une image https est reprise");
  assert.ok(!b.html.includes("secret-uuid"), "jamais le créateur");
  assert.ok(!b.html.includes("<parc>"));
  assert.match(b.html, /content="⚽ Foot &quot;au&quot; &lt;parc&gt;"/);
  assert.equal(echapper(`<'&">`), "&lt;&#39;&amp;&quot;&gt;");
  assert.equal(quandAbsolu("n'importe quoi"), "");
});

test("aperçu : les balises génériques sont remplacées, pas doublées", () => {
  const page = '<html><head><title>Autour</title><meta name="description" content="x" />\n' +
    '<meta property="og:title" content="g" />\n<link rel="canonical" href="https://autour.eu/" />\n</head><body></body></html>';
  const b = balisesApercu({ titre: "Apéro", cat: "rencontre" }, null, "https://autour.eu/e/1");
  const html = injecter(page, b);
  assert.equal((html.match(/og:title/g) || []).length, 1);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.match(html, /<title>👥 Apéro · Autour<\/title>/);
});

test("six types au premier écran, formulaire rapide, récapitulatif avant publication", () => {
  const types = app.slice(app.indexOf("const TYPES_CREATION"), app.indexOf("];", app.indexOf("const TYPES_CREATION")));
  assert.equal((types.match(/\{id:/g) || []).length, 6);
  for (const champ of ["fTitre", "fAdr", "fDate", "fHeure"]) assert.match(ecrans, new RegExp('id="' + champ + '"[^>]*'));
  assert.match(ecrans, /pousserEcran\(ouvrirRecapPublication\)/);
  assert.match(ecrans, /id="rModifier"/);
});

test("« C'est publié » n'arrive qu'après l'écriture en base", () => {
  const publier = ecrans.slice(ecrans.indexOf("async function publier()"));
  const ecriture = publier.indexOf("Store.publier(");
  assert.ok(ecriture > 0);
  assert.ok(publier.indexOf("ecranPublie(", ecriture) > ecriture);
  assert.ok(publier.slice(0, ecriture).indexOf("ecranPublie(") < 0, "pas d'écran de succès avant la base");
  assert.match(ecrans, /peut aussi apparaître[\s\S]{0,40}« Maintenant »/);
});

test("participation : comptée après confirmation de la base, une seule fois", () => {
  const f = ecrans.slice(ecrans.indexOf("async function participerPublication"), ecrans.indexOf("async function nePlusParticiper"));
  const appel = f.indexOf("Store.participer(");
  assert.ok(f.indexOf('"participation_added"') > appel);
  assert.match(f, /r\.etat\.moi && !\(avant && avant\.moi\)/);
  assert.match(f, /exigerCompte\("participer"/);
  assert.match(app, /enregistrerReprise\("participer"/);
});

test("la fiche n'avale plus les appuis sur ses propres boutons", () => {
  assert.match(ecrans, /id="ficheLieu" data-lieu=/);
  assert.equal((app.match(/closest\("\[data-lieu\]"\)/g) || []).length, 0);
  assert.equal((app.match(/closest\("\[data-lieu\]:not\(#ficheLieu\)"\)/g) || []).length, 2);
});

test("une publication gratuite n'affiche jamais « 0 € »", () => {
  assert.match(app, /prix:p\.gratuit === true \? null : p\.prix/);
});

test("un lien reçu d'ailleurs se place sur la publication avant de l'ouvrir", () => {
  const f = app.slice(app.indexOf("async function ouvrirPublicationParId"));
  assert.match(f.slice(0, 2000), /poserZoneGeographique\("", \{lat:lue\.lat, lng:lue\.lng,\s*emprise:/);
  assert.match(app, /partage\.dbId != null\) setTimeout\(\(\)=>ouvrirLieuPartage\(\)/);
});

test("mesures Créer : noms canoniques, identifiants jamais des titres", () => {
  for (const nom of ["create_opened", "create_type_selected", "create_started", "create_published",
    "share_opened", "share_completed", "share_link_copied", "shared_link_opened",
    "participation_intent", "participation_added", "participation_removed"])
    assert.ok(maintenant.includes('"' + nom + '"'), nom);
});

test("base : capacité, doublon, rôle et masquage tenus côté serveur", () => {
  assert.match(migration, /create or replace function private\.controler_participation/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke update on public\.event_participants from authenticated/);
  assert.match(migration, /grant update \(notifier, lu_jusqua\)/);
  assert.match(migration, /on conflict[\s\S]{0,200}where[\s\S]{0,60}'suiveur'/);
  assert.match(migration, /signalements < 3/);
  assert.match(migration, /primary key \(publication_id, membre\)/);
});

test("la barre de navigation ne recouvre pas le bas des écrans Créer", () => {
  assert.match(css, /#feuille:has\(h2\.pub, \.recap, \.publie, \.participation, \.mc-onglets, \.creer-choix\)\{\s*padding-bottom:calc\(var\(--nav-flottante/);
});

test("/api/e : identifiant invalide ou base en panne → la page telle quelle", async () => {
  const { default: handler } = await import("../api/e.js");
  const page = "<html><head><title>Autour</title></head><body></body></html>";
  const avant = globalThis.fetch;
  try {
    let rpc = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/index.html")) return new Response(page);
      rpc += 1; return new Response("boom", { status: 500 });
    };
    const r1 = await handler(new Request("https://autour.eu/api/e?id=../../etc"));
    assert.equal(await r1.text(), page);
    assert.equal(rpc, 0, "un identifiant invalide n'interroge pas la base");
    const r2 = await handler(new Request("https://autour.eu/api/e?id=0f0f0f0f-0000-4000-8000-000000000000"));
    assert.equal(await r2.text(), page);
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/index.html")) return new Response(page);
      if (String(url).includes("publication_publique"))
        return Response.json([{ titre: "Apéro", cat: "rencontre", adresse: "Place" }]);
      return Response.json([{ participants: 2, places: null }]);
    };
    const r3 = await handler(new Request("https://autour.eu/api/e?id=0f0f0f0f-0000-4000-8000-000000000000"));
    const html = await r3.text();
    assert.match(html, /og:title" content="👥 Apéro"/);
    assert.match(html, /2 participants/);
    assert.match(r3.headers.get("cache-control"), /s-maxage=300/);
  } finally { globalThis.fetch = avant; }
});
