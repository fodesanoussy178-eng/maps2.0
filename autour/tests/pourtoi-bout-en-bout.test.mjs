/* LE CONTRAT ENTRE LA BASE ET LE CLASSEMENT.

   `classerPourToi` n'apparie pas des titres : il lit les `announcement_tags`,
   borne par le bassin et pondère par l'importance. Si `versEvenementCanonique`
   n'en recopie aucun, chaque fiche arrive nue, `correspondances()` ne trouve
   rien et `classer()` rejette TOUT — « Pour toi » est vide sans qu'aucune
   erreur ne s'affiche. Ce test suit une ligne de RPC jusqu'au résultat. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../core.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = lire("../app.js");

/* Les deux modules sont des IIFE : la taxonomie d'abord, le classement la lit
   à son chargement. */
new Function("globalThis", lire("../annonces-taxonomie.js"))(globalThis);
new Function("globalThis", lire("../annonces-classement.js"))(globalThis);
const ANNONCES = globalThis.AutourAnnoncesClassement;
const TAXONOMIE = globalThis.AutourAnnoncesTaxonomie;

/* `versEvenementCanonique` ne dépend que de trois choses hors d'elle-même. */
function extraireVersEvenement() {
  const i = app.search(/^function versEvenementCanonique\(/m);
  assert.ok(i >= 0, "versEvenementCanonique est introuvable");
  let k = app.indexOf("{", i), prof = 0, fin = -1;
  for (let n = k; n < app.length; n += 1) {
    if (app[n] === "{") prof += 1;
    else if (app[n] === "}") { prof -= 1; if (prof === 0) { fin = n + 1; break; } }
  }
  return new Function("normaliserItem", "visuelEvenement", "commune",
    app.slice(i, fin) + "; return versEvenementCanonique;")(
      (item, source) => globalThis.AutourCore.toCommonItem(item, { source }),
      () => null,
      "Tourcoing");
}
const versEvenementCanonique = extraireVersEvenement();

/* Une ligne telle que `evenements_bassin('mel')` la rend réellement. */
const DEMAIN = new Date(Date.now() + 36 * 3600 * 1000);
const ligneRpc = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Concert rap au Grand Mix",
  description: "Une soirée rap.",
  category: "concert",
  place_name: "Le Grand Mix", address: "5 place Notre Dame",
  city: "Tourcoing", insee_code: "59599",
  lat: 50.7236, lng: 3.161,
  start_at: DEMAIN.toISOString(),
  end_at: new Date(DEMAIN.getTime() + 3 * 3600 * 1000).toISOString(),
  timezone: "Europe/Paris",
  date_confidence: "exact", temporal_status: "soon",
  announcement_tags: ["rap", "hip_hop", "concert"],
  metro_area: "mel", territory_slug: "tourcoing",
  importance_level: "important", importance_score: 60,
  announced_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  primary_source: "openagenda", cancelled: false,
};

test("les métadonnées de recommandation survivent à la canonisation", () => {
  const item = versEvenementCanonique(ligneRpc);
  assert.deepEqual(item.announcement_tags, ["rap", "hip_hop", "concert"]);
  assert.equal(item.metro_area, "mel");
  assert.equal(item.importance_level, "important");
  assert.ok(item.announced_at, "announced_at doit être transmis");
  assert.equal(item.date_confidence, "exact");
  assert.equal(item.temporal_status, "soon");
  assert.equal(item.primary_source, "openagenda");
  /* Le classement lit indifféremment les deux graphies : les deux doivent
     être posées, sans quoi un module qui ne connaît qu'une forme voit du vide. */
  assert.deepEqual(TAXONOMIE.tagsDe(item).includes("rap"), true);
});

test("une ligne RPC taguée rap ressort pour une surveillance Rap", () => {
  const item = versEvenementCanonique(ligneRpc);
  const classes = ANNONCES.classerPourToi([item], {
    now: Date.now(),
    interests: ["rap"],
    seenIds: [], hiddenIds: [],
    limit: 6,
    distanceFor: () => 2000,
    metroArea: "mel",
    territorySlug: "tourcoing",
  });
  assert.equal(classes.length, 1, "l'événement doit être proposé, pas rejeté");
  assert.ok(classes[0].matched_interests.includes("rap"));
  assert.equal(classes[0].event.id, "evt" + ligneRpc.id);
  assert.ok(classes[0].score > 0);
});

test("sans les tags, le classement ne peut rien proposer — la régression d'origine", () => {
  const nu = versEvenementCanonique(Object.assign({}, ligneRpc, { announcement_tags: null }));
  const classes = ANNONCES.classerPourToi([nu], {
    now: Date.now(), interests: ["rap"], limit: 6,
    distanceFor: () => 2000, metroArea: "mel",
  });
  assert.equal(classes.length, 0,
    "c'est bien l'absence de tags qui vidait le panneau");
});

test("un chargement métropolitain vide libère la clé pour un nouvel essai", () => {
  const i = app.search(/^function rafraichirMetropole\(/m);
  const bloc = app.slice(i, app.indexOf("catch", i));
  assert.match(bloc, /if\(!liste\.length\)\{ metropoleEnCours = null; return; \}/);
});

/* OUVRIR CE QU'ON PROPOSE.

   La proposition et l'ouverture ne lisaient pas la même collection.
   `bassinPourToi()` concatène `lieux` et `evenementsMetropole` ; `ouvrirDetail`
   ne cherchait que dans `lieux`. Un événement métropolitain hors du rayon
   local était donc proposé, cliquable, annoncé « Ouvrir … » par son
   `aria-label` — et l'ouverture sortait en silence sur `if(!l) return`.
   Enregistrer, Partager et Masquer continuaient de fonctionner, parce qu'eux
   résolvent depuis `propositions` : d'où le symptôme « rien ne se passe »
   limité au clic sur la carte. */

function extraireFonction(source, nom) {
  const i = source.search(new RegExp("^function " + nom + "\\(", "m"));
  assert.ok(i >= 0, nom + " est introuvable");
  let prof = 0, fin = -1;
  for (let n = source.indexOf("{", i); n < source.length; n += 1) {
    if (source[n] === "{") prof += 1;
    else if (source[n] === "}") { prof -= 1; if (prof === 0) { fin = n + 1; break; } }
  }
  return source.slice(i, fin);
}

function resolveurAvec(lieux, evenementsMetropole) {
  return new Function("lieux", "evenementsMetropole",
    extraireFonction(app, "lieuParId") + "; return lieuParId;")(lieux, evenementsMetropole);
}

test("une proposition venue du seul bassin métropolitain est ouvrable", () => {
  const item = versEvenementCanonique(ligneRpc);
  const classes = ANNONCES.classerPourToi([item], {
    now: Date.now(), interests: ["rap"], seenIds: [], hiddenIds: [], limit: 6,
    distanceFor: () => 2000, metroArea: "mel", territorySlug: "tourcoing",
  });
  assert.equal(classes.length, 1, "l'événement doit d'abord être proposé");
  const id = classes[0].event.id;

  /* Le cas réel : la carte locale ne l'a jamais vu passer. */
  const lieuxLocaux = [{ id: "osm42", titre: "Un banc" }];
  assert.equal(lieuxLocaux.find((x) => x.id === id), undefined,
    "le montage doit bien représenter un événement absent de `lieux`");

  const lieuParId = resolveurAvec(lieuxLocaux, [item]);
  const trouve = lieuParId(id);
  assert.ok(trouve, "l'ouverture doit retrouver l'événement métropolitain");
  assert.equal(trouve.titre, "Concert rap au Grand Mix");
});

test("`lieux` reste prioritaire sur la copie métropolitaine", () => {
  const frais = { id: "evt1", titre: "Version fraîche" };
  const metro = { id: "evt1", titre: "Version du bassin" };
  const lieuParId = resolveurAvec([frais], [metro]);
  assert.equal(lieuParId("evt1").titre, "Version fraîche");
  assert.equal(lieuParId(null), null);
  assert.equal(lieuParId("inconnu"), null);
});

test("ouvrirDetail passe par le résolveur et non par `lieux` seul", () => {
  const ecrans = lire("../differe/ecrans.js");
  const bloc = extraireFonction(ecrans, "ouvrirDetail").slice(0, 200);
  assert.match(bloc, /const l = lieuParId\(id\);/,
    "ouvrirDetail doit résoudre l'identifiant sur le bassin complet");
});
