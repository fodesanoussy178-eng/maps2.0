import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Node n'a pas `requestIdleCallback`, et c'est exactement la situation de
   Safari — la plateforme sur laquelle on ne peut pas se permettre de bloquer.
   On teste donc le repli tel quel, sans le simuler. */
await import("../ordonnanceur.js");
const O = globalThis.AutourOrdonnanceur;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==========================================================================
   1. RENDRE LA MAIN

   Le profil a mesuré quatre secondes de fil principal occupé, en tranches de
   trois à neuf dixièmes de seconde. Pendant ce temps le navigateur ne peint
   rien, ne défile pas, n'enregistre pas un appui.
   ======================================================================== */

test("le travail différé s'exécute, même sans requestIdleCallback", async () => {
  let fait = false;
  O.differer(() => { fait = true; });
  assert.equal(fait, false, "rien ne doit s'exécuter dans le même tour");
  await attendre(30);
  assert.equal(fait, true);
});

test("un travail différé s'annule", async () => {
  let fait = false;
  const annuler = O.differer(() => { fait = true; });
  annuler();
  await attendre(30);
  assert.equal(fait, false, "un travail annulé ne doit jamais s'exécuter");
});

test("un jeton périmé empêche l'exécution", async () => {
  /* Le cas qui compte : la zone change pendant un classement. Le laisser
     aboutir écraserait l'écran avec les lieux d'une ville qu'on a quittée. */
  let jeton = 1;
  let pose = null;
  O.differer(() => { pose = "posé"; }, { valide: () => jeton === 1 });
  jeton = 2;                                    // on a changé de zone
  await attendre(30);
  assert.equal(pose, null);
});

/* ==========================================================================
   2. PAR LOTS
   ======================================================================== */

test("tous les éléments sont traités, une seule fois chacun", async () => {
  const vus = [];
  const r = await O.parLots([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (x) => vus.push(x));
  assert.deepEqual(vus, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r.annule, false);
  assert.equal(r.traites, 10);
});

test("le résultat final est identique à un traitement monolithique", () => {
  /* C'est le contrat de cette passe : on répartit le travail, on ne le change
     pas. Un test qui ne le vérifierait pas laisserait passer une optimisation
     qui perd des éléments en route. */
  const source = Array.from({ length: 130 }, (_, i) => i);
  const enUnBloc = source.map((x) => x * 2);
  const parLots = [];
  return O.parLots(source, (x) => parLots.push(x * 2))
    .then(() => assert.deepEqual(parLots, enUnBloc));
});

test("un lot rend la main entre deux tranches", async () => {
  /* La preuve qu'on ne bloque pas : quelque chose d'autre s'exécute PENDANT
     le traitement. Sans découpage, le témoin ne partirait qu'à la fin. */
  let temoin = 0;
  const battement = setInterval(() => { temoin += 1; }, 5);
  await O.parLots(Array.from({ length: 400 }, (_, i) => i), () => {
    // un peu de travail par élément, pour que le découpage ait un sens
    let x = 0; for (let i = 0; i < 2000; i++) x += Math.sqrt(i);
    return x;
  });
  clearInterval(battement);
  assert.ok(temoin > 0, "le fil n'a jamais été rendu au navigateur");
});

test("un lot s'annule proprement, sans traiter la suite", async () => {
  let traites = 0;
  let annuler = null;
  const p = O.parLots(Array.from({ length: 500 }, (_, i) => i), () => { traites += 1; }, {
    recevoirAnnulation: (fn) => { annuler = fn; },
  });
  if (annuler) annuler();
  const r = await p;
  assert.ok(r.traites < 500 || r.annule === false,
    "une annulation immédiate ne doit pas traiter les 500");
});

test("un lot invalidé s'arrête là où il en est", async () => {
  let valide = true;
  let traites = 0;
  const p = O.parLots(Array.from({ length: 300 }, (_, i) => i), () => {
    traites += 1;
    if (traites === 20) valide = false;          // la zone change en cours de route
  }, { valide: () => valide });
  const r = await p;
  assert.ok(r.traites < 300, "on a continué malgré l'invalidation : " + r.traites);
});

test("une liste vide ne fait rien et ne bloque pas", async () => {
  const r = await O.parLots([], () => { throw new Error("jamais"); });
  assert.equal(r.traites, 0);
});

/* ==========================================================================
   3. CE QUE L'APPLICATION EN FAIT
   ======================================================================== */

test("le classement de l'accueil est différé, pas supprimé", () => {
  assert.match(html, /function poserRecommandations\(jeton, titre\)\{/);
  assert.match(html, /ORDO\s*\n?\s*\?\s*ORDO\.differer\(\(\)=>poserRecommandations/);
  // et il reste appelé si le module manque : jamais de zone vide
  assert.match(html, /: \(poserRecommandations\(jeton, titre\), null\)/);
});

test("un travail différé porte toujours un jeton", () => {
  /* Sans lui, changer de zone pendant un classement laissait ce classement
     aboutir et écraser l'écran avec les lieux de la ville qu'on quittait. */
  assert.match(html, /let generationAccueil = 0;/);
  assert.match(html, /const jeton = \+\+generationAccueil;/);
  assert.match(html, /if\(jeton !== generationAccueil\) return;/);
  // vérifié AVANT le calcul et APRÈS : classer prend des centaines de ms
  const poser = html.slice(html.indexOf("function poserRecommandations"),
                           html.indexOf("const MAINTENANT_APERCU"));
  assert.equal((poser.match(/jeton !== generationAccueil/g) || []).length, 2,
    "le jeton doit être vérifié avant ET après le calcul");
});

test("un rendu annule le travail différé du précédent", () => {
  // dix arrivées de données en trois secondes programmeraient dix classements
  // dont neuf sont périmés avant même de commencer
  assert.match(html, /if\(annulerRecoDifferee\)\{ annulerRecoDifferee\(\); annulerRecoDifferee = null; \}/);
  assert.match(html, /if\(annulerPourToiDifferee\)\{ annulerPourToiDifferee\(\); annulerPourToiDifferee = null; \}/);
});

test("le même état ne se reclasse pas deux fois", () => {
  /* Un simple changement d'onglet reclassait tout pour un résultat identique.
     La clé décrit tout ce dont le classement dépend. */
  assert.match(html, /function cleReco\(\)\{/);
  assert.match(html, /if\(!recoCache \|\| recoCache\.cle !== cleReco\(\)\)/);
  assert.match(html, /recoCache = \{cle:cleReco\(\), html\}/);
});

test("la sélection de la carte ne redessine pas pour un résultat identique", () => {
  // c'est ce qui éviterait un reclassement visuel incessant
  assert.match(html, /if\(ids\.join\("\|"\) === \(selectionAccueil \|\| \[\]\)\.join\("\|"\)\) return;/);
});

test("la zone des recommandations garde sa place pendant le calcul", () => {
  /* Le squelette qui s'y affichait déjà pendant une recherche sert de
     réservation : rien au-dessus ne bouge, et surtout pas « Maintenant ». */
  assert.match(html, /'<div data-reco-zone="1">'\+recoDejaCalculee\(jeton\)\+'<\/div>'/);
  assert.match(html, /function recoDejaCalculee\(\)\{[\s\S]{0,260}return statutGroupeHTML\(\);/);
});

test("les cartes posées après coup reçoivent leurs gestes", () => {
  // sinon elles seraient muettes : on ne rebranche que la zone remplie
  assert.match(html, /function brancherGestesRecommandations\(racine\)\{/);
  assert.match(html, /brancherGestesRecommandations\(zone\);/);
  assert.match(html, /brancherGestesRecommandations\(corps\);/);
});

test("la disponibilité d'un lieu ne dépend plus du point de référence", () => {
  /* Elle en dépendait par le temps de trajet, donc elle changeait à chaque
     image PENDANT que la carte vole vers sa destination : la mémoire ne
     retenait rien et l'analyse des horaires de 130 lieux repartait de zéro —
     539 ms mesurées, six fois de suite. */
  assert.match(html, /const APPROCHE_NOMINALE_MS = 10 \* 60000;/);
  assert.match(html, /function arriveeEstimee\(t\)\{ return t \+ APPROCHE_NOMINALE_MS; \}/);
  assert.match(html, /const cle = l\.id \+ "\|" \+ minute;/);
});

test("le module est chargé avant le code qui s'en sert", () => {
  const i = html.indexOf('src="ordonnanceur.js?v=');
  assert.ok(i > 0);
  assert.ok(i < html.indexOf("const ORDO = window.AutourOrdonnanceur"));
});
