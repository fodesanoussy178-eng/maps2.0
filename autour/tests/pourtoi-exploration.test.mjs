/* LA BULLE FERMÉE, ET LA PART D'EXPLORATION QUI L'OUVRE.

   Jusqu'ici l'appariement entre les envies suivies et les tags d'un événement
   servait de PORTAIL : sans correspondance, `classer()` renvoyait `null` et
   l'événement n'existait plus pour « Pour toi ». Une personne ayant coché
   « rap » un soir d'installation ne voyait plus jamais la braderie de son
   quartier — ses goûts d'un jour devenaient les murs du produit.

   Ces tests fixent le nouveau contrat : la préférence PÈSE sur le classement
   (elle bonifie le score, elle ordonne), une minorité de places revient à des
   propositions qui ne correspondent à aucune envie, et une proposition
   inexplicable (aucun tag) reste refusée — de l'exploration, pas du
   remplissage. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../core.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = lire("../app.js");

new Function("globalThis", lire("../evenements-canoniques.js"))(globalThis);
new Function("globalThis", lire("../entites-canoniques.js"))(globalThis);
new Function("globalThis", lire("../annonces-taxonomie.js"))(globalThis);
new Function("globalThis", lire("../annonces-classement.js"))(globalThis);
const ANNONCES = globalThis.AutourAnnoncesClassement;
const TAXONOMIE = globalThis.AutourAnnoncesTaxonomie;

const DEMAIN = new Date(Date.now() + 36 * 3600 * 1000);

function evenement(surcharge) {
  return Object.assign({
    id: "evt-" + Math.random().toString(36).slice(2),
    title: "Un événement",
    start_at: DEMAIN.toISOString(),
    end_at: new Date(DEMAIN.getTime() + 2 * 3600 * 1000).toISOString(),
    timezone: "Europe/Paris",
    date_confidence: "exact",
    temporal_status: "soon",
    announcement_tags: ["rap", "concert"],
    metro_area: "mel",
    territory_slug: "tourcoing",
    importance_level: "local",
    importance_score: 40,
    primary_source: "openagenda",
    cancelled: false,
  }, surcharge || {});
}

function options(surcharge) {
  return Object.assign({
    now: Date.now(), interests: ["rap"], seenIds: [], hiddenIds: [], limit: 6,
    distanceFor: () => 2000, metroArea: "mel", territorySlug: "tourcoing",
  }, surcharge || {});
}

/* ---- 1. L'événement hors des goûts n'est plus supprimé ---------------- */

test("un événement hors des goûts suivis devient une découverte au lieu de disparaître", () => {
  const horsGouts = evenement({ id: "theatre-1", announcement_tags: ["theatre"] });
  const classes = ANNONCES.classerPourToi([horsGouts], options());
  assert.equal(classes.length, 1, "la proposition ne doit plus être supprimée");
  assert.equal(classes[0].exploration, true);
  assert.deepEqual(classes[0].matched_interests, []);
});

test("la phrase d'une découverte nomme l'événement et dit qu'il sort des goûts", () => {
  const classes = ANNONCES.classerPourToi(
    [evenement({ announcement_tags: ["theatre"] })], options());
  assert.match(classes[0].reason, /^À découvrir · Théâtre/,
    "la carte doit pouvoir expliquer sa présence : " + classes[0].reason);
});

/* ---- 2. Mais elle reste inexplicable sans ses propres tags ------------ */

test("un événement sans aucun tag n'entre pas en exploration — ce serait du remplissage", () => {
  const nu = evenement({ announcement_tags: null });
  assert.equal(ANNONCES.classerPourToi([nu], options()).length, 0);
  assert.equal(ANNONCES.classer(nu, options()), null);
});

/* ---- 3. La préférence pèse sur le classement -------------------------- */

test("l'affinité bonifie le score au lieu de seulement ouvrir la porte", () => {
  const e = evenement({ announcement_tags: ["rap", "hip_hop", "concert"] });
  const une = ANNONCES.classer(e, options({ interests: ["rap"] }));
  const trois = ANNONCES.classer(e, options({ interests: ["rap", "hip_hop", "concerts"] }));
  const aucune = ANNONCES.classer(e, options({ interests: ["theatre"] }));
  assert.equal(aucune.exploration, true);
  assert.ok(une.score > aucune.score,
    "une correspondance doit valoir plus qu'aucune : " + une.score + " vs " + aucune.score);
  assert.ok(trois.score > une.score,
    "trois envies suivies doivent peser plus qu'une : " + trois.score + " vs " + une.score);
});

test("une découverte ne passe jamais devant une correspondance de son groupe", () => {
  /* La découverte est ici objectivement plus grosse : événement majeur, même
     distance. Elle reste derrière, parce que « Pour toi » annonce un
     classement par affinité et doit le tenir. */
  const correspond = evenement({ id: "rap-local", announcement_tags: ["rap"] });
  const decouverte = evenement({
    id: "theatre-majeur", announcement_tags: ["theatre"],
    importance_level: "major", importance_score: 95, quality_score: 30,
  });
  const classes = ANNONCES.classerPourToi([decouverte, correspond], options({ limit: 6 }));
  assert.deepEqual(classes.map((c) => c.event.id), ["rap-local", "theatre-majeur"]);
  assert.ok(classes[1].score > classes[0].score,
    "le montage doit bien représenter une découverte mieux notée");
});

/* ---- 4. La part d'exploration est bornée ------------------------------ */

test("la réserve d'exploration ne prend jamais la seule place disponible", () => {
  assert.equal(ANNONCES.reserveExploration(0, 5), 0);
  assert.equal(ANNONCES.reserveExploration(1, 5), 0);
  assert.equal(ANNONCES.reserveExploration(2, 5), 0);
  assert.equal(ANNONCES.reserveExploration(3, 5), 1);
  assert.equal(ANNONCES.reserveExploration(6, 5), 1);
  assert.equal(ANNONCES.reserveExploration(12, 5), 3);
  assert.equal(ANNONCES.reserveExploration(6, 0), 0, "rien à explorer, rien à réserver");
  assert.equal(ANNONCES.reserveExploration(6, 1), 1, "jamais plus que le disponible");
});

test("l'exploration reste minoritaire quand les correspondances abondent", () => {
  const items = [];
  for (let n = 0; n < 8; n += 1) items.push(evenement({ id: "rap-" + n, announcement_tags: ["rap"] }));
  for (let n = 0; n < 8; n += 1) items.push(evenement({ id: "theatre-" + n, announcement_tags: ["theatre"] }));
  const classes = ANNONCES.classerPourToi(items, options({ limit: 6 }));
  assert.equal(classes.length, 6);
  const explorations = classes.filter((c) => c.exploration);
  assert.equal(explorations.length, 1, "un quart de six, arrondi vers le bas");
  assert.equal(classes[5].exploration, true, "et elle ferme la liste");
});

test("quand rien ne correspond, l'exploration remplit le panneau au lieu de le laisser vide", () => {
  const items = [];
  for (let n = 0; n < 4; n += 1) items.push(evenement({ id: "theatre-" + n, announcement_tags: ["theatre"] }));
  const classes = ANNONCES.classerPourToi(items, options({ limit: 6 }));
  assert.equal(classes.length, 4, "la réserve est un plafond, pas un plancher");
  assert.ok(classes.every((c) => c.exploration));
});

test("les correspondances gardent la majorité même quand l'exploration abonde", () => {
  const items = [evenement({ id: "rap-1", announcement_tags: ["rap"] })];
  for (let n = 0; n < 20; n += 1) items.push(evenement({ id: "theatre-" + n, announcement_tags: ["theatre"] }));
  const classes = ANNONCES.classerPourToi(items, options({ limit: 6 }));
  assert.equal(classes.length, 6);
  assert.equal(classes[0].event.id, "rap-1");
  assert.equal(classes.filter((c) => c.exploration).length, 5,
    "les places que l'affinité ne remplit pas ne restent pas vides");
});

test("une découverte masquée ou déjà vue suit les mêmes règles qu'une correspondance", () => {
  const item = evenement({ id: "theatre-masque", announcement_tags: ["theatre"] });
  assert.equal(ANNONCES.classerPourToi([item],
    options({ hiddenIds: ["theatre-masque"] })).length, 0);
  const vue = ANNONCES.classerPourToi([item], options({ seenIds: ["theatre-masque"] }));
  assert.equal(vue.length, 1);
  assert.equal(vue[0].seen, true);
});

/* ---- 5. Jusqu'à l'affichage ------------------------------------------- */

function extraireFonction(source, nom) {
  const i = source.search(new RegExp("^(?:async )?function " + nom + "\\(", "m"));
  assert.ok(i >= 0, nom + " est introuvable");
  let prof = 0, fin = -1;
  for (let n = source.indexOf("{", i); n < source.length; n += 1) {
    if (source[n] === "{") prof += 1;
    else if (source[n] === "}") { prof -= 1; if (prof === 0) { fin = n + 1; break; } }
  }
  return source.slice(i, fin);
}

test("une découverte est rendue dans un groupe « À découvrir », en dernier", () => {
  const groupesInteretsPourToi = new Function("TAXONOMIE_ANNONCES", "ENVIES",
    extraireFonction(app, "groupesInteretsPourToi") + "; return groupesInteretsPourToi;")(
    TAXONOMIE, { choisies: () => ["rap"] });
  const propositions = [
    { l: { id: "rap-1" }, matchedInterests: ["rap"], exploration: false },
    { l: { id: "theatre-1" }, matchedInterests: [], exploration: true },
  ];
  const groupes = groupesInteretsPourToi(propositions);
  assert.deepEqual(groupes.map((g) => g.id), ["rap", "exploration"]);
  assert.deepEqual(groupes[1].propositions.map((p) => p.l.id), ["theatre-1"],
    "sans ce groupe, la découverte serait classée puis perdue à l'affichage");
  assert.equal(groupes[1].label, "À découvrir");
  /* Et sans découverte, aucun groupe vide ne s'ajoute. */
  assert.deepEqual(groupesInteretsPourToi([propositions[0]]).map((g) => g.id), ["rap"]);
});

test("la pastille ne compte pas les découvertes : elle ne promet que ce qui correspond", () => {
  const nouveautesPourToi = new Function("marquesAnnoncees", "marquesVues",
    extraireFonction(app, "nouveautesPourToi") + "; return nouveautesPourToi;")(
    () => new Set(), () => new Set());
  const propositions = [
    { l: { id: "rap-1" }, exploration: false },
    { l: { id: "theatre-1" }, exploration: true },
  ];
  assert.deepEqual(nouveautesPourToi(propositions).map((p) => p.l.id), ["rap-1"]);
});
