import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import handler, { normaliserDecouverte, sourcesAncrage } from "../api/decouvertes.js";
import { sourceApplication } from "./source.mjs";

const src = await sourceApplication(import.meta.url);
const route = await readFile(new URL("../api/decouvertes.js", import.meta.url), "utf8");
const fournisseur = await readFile(new URL("../providers/decouvertes.js", import.meta.url), "utf8");

const SOURCES = [{ titre: "Agenda de la ville", url: "https://exemple.test/agenda" }];
const CTX = { sources: SOURCES, ville: "Commune de test", empreinte: "50.00,3.00:sortir" };
const demain = new Date(Date.now() + 26 * 3600 * 1000).toISOString();

/* ====================================================================== */
/*  La clé ne sort pas du serveur                                         */
/* ====================================================================== */

test("la clé est lue dans l'environnement et posée en en-tête, jamais dans une URL", () => {
  assert.match(route, /process\.env\.GEMINI_API_KEY/);
  assert.match(route, /"x-goog-api-key": cle/);
  assert.doesNotMatch(route, /[?&]key=/,
    "une clé en paramètre d'URL finit dans les journaux");
});

test("aucune clé ne peut fuir par un message d'erreur", () => {
  // le corps d'erreur de l'API amont n'est jamais relayé
  assert.doesNotMatch(route, /await reponse\.text\(\)/);
  assert.match(route, /return refus\("source indisponible", 502\);/);
});

test("le client ne connaît pas la clé : il n'appelle que notre origine", () => {
  assert.doesNotMatch(fournisseur, /generativelanguage|GEMINI|api_key/i);
  assert.match(fournisseur, /const CHEMIN = "\/api\/decouvertes";/);
});

/* ====================================================================== */
/*  Une route ouverte sur un modèle n'est pas un proxy gratuit            */
/* ====================================================================== */

test("le client n'envoie aucun texte libre : deux nombres et un mot fermé", async () => {
  const r = await handler(new Request("https://x.test/api/decouvertes?lat=50&lng=3&angle=n-importe-quoi"));
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.erreur, "angle inconnu");
  assert.deepEqual(j.items, []);
});

test("des coordonnées invalides sont refusées, pas devinées", async () => {
  for (const q of ["", "?lat=abc&lng=3", "?lat=200&lng=3", "?lat=50"]) {
    const r = await handler(new Request("https://x.test/api/decouvertes" + q));
    assert.equal(r.status, 400, q);
  }
});

test("l'invite est écrite côté serveur, sans rien recevoir du client", () => {
  const bloc = /function invite\(lat, lng, angle, ville\)\{?[\s\S]*?\n\}/.exec(route)[0];
  // les seules valeurs interpolées sont déjà validées
  assert.match(bloc, /ANGLES\[angle\]/);
  assert.doesNotMatch(bloc, /searchParams/);
  assert.match(route, /if \(!Object\.hasOwn\(ANGLES, angle\)\) return refus/);
});

test("le nom de commune est borné et nettoyé avant d'entrer dans l'invite", () => {
  assert.match(route, /const ville = chaine\(url\.searchParams\.get\("ville"\), 60\)\s*\.replace\(/);
});

/* ====================================================================== */
/*  Ancrage : rien sans source citée                                      */
/* ====================================================================== */

test("l'outil de recherche Google est réellement demandé", () => {
  assert.match(route, /tools: \[\{ google_search: \{\} \}\]/);
});

test("les sources d'ancrage se lisent dans la réponse de l'API", () => {
  const lues = sourcesAncrage({
    groundingMetadata: { groundingChunks: [
      { web: { uri: "https://exemple.test/a", title: "A" } },
      { web: {} },                       // sans URI : inexploitable
      { retrievedContext: {} },          // pas une source web
    ] },
  });
  assert.deepEqual(lues, [{ titre: "A", url: "https://exemple.test/a" }]);
  assert.deepEqual(sourcesAncrage({}), []);
  assert.deepEqual(sourcesAncrage(null), []);
});

test("une proposition sans source citée est jetée côté serveur", () => {
  const brut = { nom: "Concert au parc", categorie: "concert", debut: demain };
  assert.equal(normaliserDecouverte(brut, { sources: [], empreinte: "x" }), null);
  assert.equal(normaliserDecouverte(brut, { empreinte: "x" }), null);
  assert.ok(normaliserDecouverte(brut, CTX), "avec source, elle passe");
});

test("la provenance voyage avec la découverte, pour qu'elle reste vérifiable", () => {
  const d = normaliserDecouverte({ nom: "Marché de producteurs", categorie: "marche", debut: demain }, CTX);
  assert.deepEqual(d.sources, SOURCES);
  assert.equal(d.source, "gemini");
});

/* ====================================================================== */
/*  Ne jamais inventer : ni nom, ni position, ni date                     */
/* ====================================================================== */

test("aucune coordonnée n'est demandée au modèle", () => {
  const bloc = /function invite\([\s\S]*?\n\}/.exec(route)[0];
  assert.match(bloc, /Ne donne PAS de coordonnées/);
  assert.doesNotMatch(bloc, /"lat"|"lng"|latitude": number/);
});

test("une découverte n'arrive jamais avec une position inventée", () => {
  const d = normaliserDecouverte({
    nom: "Expo photo", categorie: "musee", lat: 50.1, lng: 3.1, adresse: "3 rue Basse",
  }, CTX);
  assert.equal(d.lat, null);
  assert.equal(d.lng, null);
  assert.equal(d.positionConnue, false);
});

test("sans nom exploitable, il n'y a pas de proposition", () => {
  assert.equal(normaliserDecouverte({ nom: "", categorie: "event" }, CTX), null);
  assert.equal(normaliserDecouverte({ nom: "A", categorie: "event" }, CTX), null);
  assert.equal(normaliserDecouverte({}, CTX), null);
});

test("un événement sans date ne devient pas un événement", () => {
  // sinon il entrerait dans une couche temporelle sans pouvoir être situé dans
  // le temps — et « Maintenant » n'a pas le droit de le voir
  assert.equal(normaliserDecouverte({ nom: "Festival du coin", categorie: "event" }, CTX), null);
  const avecDate = normaliserDecouverte({ nom: "Festival du coin", categorie: "event", debut: demain }, CTX);
  assert.equal(avecDate.isTemporary, true);
  assert.equal(avecDate.debutLe, demain);
});

test("une date aberrante est refusée plutôt que recopiée", () => {
  const vieux = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  const lointain = new Date(Date.now() + 800 * 24 * 3600 * 1000).toISOString();
  assert.equal(normaliserDecouverte({ nom: "Vieux concert", categorie: "concert", debut: vieux }, CTX), null);
  assert.equal(normaliserDecouverte({ nom: "Concert lointain", categorie: "concert", debut: lointain }, CTX), null);
  assert.equal(normaliserDecouverte({ nom: "Chose", categorie: "musee", debut: "pas une date" }, CTX).debutLe, null);
});

test("une catégorie inconnue retombe sur « autre », elle n'en crée pas une", () => {
  const d = normaliserDecouverte({ nom: "Lieu", categorie: "restaurant gastronomique" }, CTX);
  assert.equal(d.cat, "autre");
});

test("une URL non sécurisée est écartée", () => {
  const base = { nom: "Lieu", categorie: "musee" };
  assert.equal(normaliserDecouverte(Object.assign({ url: "javascript:alert(1)" }, base), CTX).url, "");
  assert.equal(normaliserDecouverte(Object.assign({ url: "http://exemple.test" }, base), CTX).url, "");
  assert.equal(normaliserDecouverte(Object.assign({ url: "https://exemple.test" }, base), CTX).url,
    "https://exemple.test");
});

test("les textes sont bornés : une réponse longue ne devient pas une carte longue", () => {
  const d = normaliserDecouverte({
    nom: "N".repeat(500), categorie: "musee", description: "D".repeat(500),
    adresse: "A".repeat(500),
  }, CTX);
  assert.ok(d.titre.length <= 120);
  assert.ok(d.description.length <= 180);
  assert.ok(d.adresse.length <= 160);
});

/* ====================================================================== */
/*  Sans clé : une source absente, pas une panne                          */
/* ====================================================================== */

test("sans clé configurée, la route répond une liste vide en succès", async () => {
  const avant = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await handler(new Request("https://x.test/api/decouvertes?lat=50&lng=3"));
    assert.equal(r.status, 200, "une source absente n'est pas une erreur");
    const j = await r.json();
    assert.deepEqual(j.items, []);
    assert.equal(j.actif, false);
  } finally {
    if (avant !== undefined) process.env.GEMINI_API_KEY = avant;
  }
});

/* ====================================================================== */
/*  Ne bloque jamais l'interface                                          */
/* ====================================================================== */

test("la route a un délai maximal et ne vit pas vingt secondes", () => {
  assert.match(route, /const DELAI_MS = \d{4,5};/);
  const ms = Number(/const DELAI_MS = (\d+);/.exec(route)[1]);
  assert.ok(ms <= 15000, "délai trop long : " + ms);
  assert.match(route, /AbortSignal\.timeout \? AbortSignal\.timeout\(DELAI_MS\)/);
});

test("la réponse est mutualisée par le CDN, et servie périmée pendant qu'elle se rafraîchit", () => {
  assert.match(route, /"cache-control": "public, s-maxage=900, stale-while-revalidate=21600"/);
  // arrondi à ~1 km : tout un quartier partage la même entrée
  assert.match(route, /const rLat = lat\.toFixed\(2\), rLng = lng\.toFixed\(2\);/);
});

test("la source part avec les autres, en parallèle, et ne retient personne", () => {
  assert.match(src, /decouvertesAncrees\(lat,lng,signal\)\.then\(r=>\{/);
  const bloc = /travaux\.push\(\s*\n\s*decouvertesAncrees[\s\S]*?\n\s*\);/.exec(src)[0];
  // elle ne compte pas comme « source exploitable » : l'écran ne dépend pas d'elle
  assert.doesNotMatch(bloc, /sourceExploitable = true;/);
  assert.match(bloc, /if\(!generationCourante\(generation\) \|\| !r \|\| !r\.length\) return;/,
    "une réponse tardive d'une zone quittée doit être jetée");
});

test("un échec de cette source ne dit rien à personne", () => {
  const bloc = /async function decouvertesAncrees\(lat,lng,signal\)\{[\s\S]*?\n\}/.exec(src)[0];
  assert.match(bloc, /catch\(e\)\{ return \[\]; \}/);
  assert.doesNotMatch(bloc, /toast\(|charge\(/);
  // sans clé, on cesse d'appeler pour la session
  assert.match(bloc, /if\(!reponse\.actif\)\{ relaisDecouvertes = false; return \[\]; \}/);
});

/* ====================================================================== */
/*  Rien sur la carte qu'on ne sache situer                               */
/* ====================================================================== */

test("seules les découvertes rapprochées d'un lieu connu reçoivent une position", () => {
  assert.match(fournisseur, /function repartir\(items, lieux\)\{?/);
  const bloc = /function repartir\(items, lieux\) \{[\s\S]*?\n\}/.exec(fournisseur)[0];
  assert.match(bloc, /positionConnue: true/);
  assert.match(bloc, /else sansLieu\.push\(item\);/);
  // et l'application n'ingère que les ancrées
  assert.match(src, /const \{ancrees\} = fournisseur\.repartir\(reponse\.items, lieux\);/);
});

test("le rapprochement réutilise la normalisation de noms du noyau", () => {
  // même question que la déduplication, mêmes outils : pas d'à-peu-près
  assert.match(fournisseur, /noyau\.normaliserNomLieu === "function"/);
  const bloc = /function rapprocher\(decouverte, lieux\) \{[\s\S]*?\n\}/.exec(fournisseur)[0];
  assert.match(bloc, /if \(!cible \|\| cible\.length < 4\) return null;/,
    "un nom trop court rapprocherait n'importe quoi");
});

test("les découvertes passent par la déduplication comme tout le monde", () => {
  assert.match(src, /fusionner\(r,"external"\);\s*\n\s*PERF\.jalon\("decouvertes_done"\)/);
});

/* ====================================================================== */
/*  Le fournisseur est chargé comme les autres                            */
/* ====================================================================== */

test("le fournisseur est chargé avec son empreinte et sans bloquer l'analyse", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /<script src="providers\/decouvertes\.js\?v=[a-f0-9]{8}" defer><\/script>/);
});
