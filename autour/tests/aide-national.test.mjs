import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import zones from "../data/aide-precalcule-villes.js";
import aideStructures from "../api/aide-structures.js";
import aideInstitutionnelle from "../api/aide-institutionnelle.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fenetre = {};
const iife = (p, args = ["globalThis", "window"]) =>
  new Function(...args, lire(p))(...args.map(() => fenetre));

iife("../aide-taxonomie.js");
iife("../aide-classement.js");
iife("../aide-structures.js");
iife("../providers/normaliser.js");
iife("../providers/aideDora.js", ["globalThis", "window"]);

const P = fenetre.AutourProviders;
const VILLES = Object.freeze({
  "59599": "Tourcoing",
  "59350": "Lille",
  "49007": "Angers",
  "35238": "Rennes",
  "75056": "Paris",
});
const CAPACITES = Object.freeze({
  manger: "food_assistance",
  logement: "housing_assistance",
  sante: "healthcare",
  papiers: "administrative_help",
  travail: "financial_assistance",
});

function fiches(code) {
  return zones[code].records.map((record) => P.aideDora.normaliser(record)).filter(Boolean);
}

async function json(response) {
  return response.json();
}

test("les cinq villes ont un pré-calcul local et aucune fiche étrangère", () => {
  for (const [code, nom] of Object.entries(VILLES)) {
    assert.ok(zones[code], `${nom}: zone absente`);
    assert.ok(zones[code].records.length > 0, `${nom}: zone vide`);
    zones[code].records.forEach((record) => {
      assert.equal(record.cityCode, code, `${nom}: code INSEE contaminé`);
      assert.ok(Number.isFinite(record.lat) && Number.isFinite(record.lng),
        `${nom}: coordonnées manquantes`);
      assert.equal(record.source, "data_inclusion");
      assert.ok(record.sourceRefs?.dataInclusionId);
      assert.ok(record.officialUrl);
    });
  }
});

test("le tableau des cinq besoins de base n'est plus à zéro", () => {
  for (const [code, nom] of Object.entries(VILLES)) {
    const counts = Object.fromEntries(Object.keys(CAPACITES).map((need) => [need, 0]));
    fiches(code).forEach((fiche) => {
      Object.entries(CAPACITES).forEach(([need, capacity]) => {
        if (fiche.capacitesAide[capacity] && fiche.trustLevel !== "unknown") counts[need] += 1;
      });
    });
    Object.entries(counts).forEach(([need, count]) => {
      assert.ok(count > 0, `${nom}: ${need} reste à zéro`);
    });
  }
});

test("Manger repose sur une preuve alimentaire explicite", () => {
  for (const [code, nom] of Object.entries(VILLES)) {
    const records = zones[code].records;
    const food = fiches(code).filter((fiche) => fiche.capacitesAide.food_assistance);
    assert.ok(food.length > 0, `${nom}: aucune aide alimentaire`);
    food.forEach((fiche) => {
      const raw = records.find((record) =>
        String(record.id || "").toUpperCase() === fiche.identifiers.dataInclusionId);
      assert.ok(raw, `${nom}: fiche alimentaire sans identifiant source`);
      assert.ok(raw.categories.includes("alimentaire") || raw.services.includes("food"),
        `${nom}: Manger sans catégorie/service alimentaire (${fiche.name})`);
      assert.doesNotMatch(fiche.name, /\b(?:boulangerie|brasserie|cafe|supermarche|supermarch[eé])\b/i,
        `${nom}: commerce proposé comme aide alimentaire (${fiche.name})`);
    });
  }
});

test("une photo sourcée voyage de data·inclusion jusqu'à la fiche Aide", () => {
  const fiche = P.aideDora.normaliser({
    source: "data_inclusion",
    dataProvider: "dora",
    id: "dora-photo-test",
    name: "Structure photo test",
    latitude: 48.8566,
    longitude: 2.3522,
    image_url: "https://example.org/structure.jpg",
    image_source: "institutional",
    image_source_url: "https://example.org/structure",
    image_author: "Structure photo test",
    image_license: "Domaine public",
    categories: ["mairie"],
    services: ["administrative_assistance"],
  });
  assert.ok(fiche);
  assert.equal(fiche.photos[0].url, "https://example.org/structure.jpg");
  assert.equal(fiche.photos[0].source, "institutional");
  const interne = fenetre.AutourProviders.versInterne(fiche);
  assert.equal(interne.image, "https://example.org/structure.jpg");
  assert.equal(interne.imageSource, "institutional");
  assert.equal(interne.imageSourceUrl, "https://example.org/structure");
  assert.match(interne.imageAttribution, /Structure photo test/);
});

test("la déduplication ne perd pas la photo portée par une source secondaire", () => {
  const sansPhoto = P.aideDora.normaliser({
    source: "data_inclusion", id: "structure-sans-photo", siret: "12345678900011",
    name: "Structure dédoublonnée", latitude: 48.8566, longitude: 2.3522,
    categories: ["mairie"], services: ["administrative_assistance"],
  });
  const avecPhoto = P.aideDora.normaliser({
    source: "data_inclusion", id: "structure-avec-photo", siret: "12345678900011",
    name: "Structure dédoublonnée", latitude: 48.8566, longitude: 2.3522,
    image_url: "https://example.org/structure-secondaire.jpg",
    image_source: "institutional", categories: ["mairie"],
    services: ["administrative_assistance"],
  });
  const fusion = fenetre.AutourAideStructures.dedupe([sansPhoto, avecPhoto]);
  assert.equal(fusion.length, 1);
  assert.equal(fusion[0].image, "https://example.org/structure-secondaire.jpg");
});

test("le classement Aide conserve la distance depuis le centre actif comme départage", () => {
  const source = lire("../app.js");
  assert.match(source, /position:centre/);
  assert.match(source, /distanceM\(centre\[0\], centre\[1\], a\.l\.lat, a\.l\.lng\)/);
  assert.match(source, /distanceM\(centre\[0\], centre\[1\], b\.l\.lat, b\.l\.lng\)/);
});

test("la branche DORA locale ne recycle pas Tourcoing pour Lille ou Angers", async () => {
  for (const [code, nom] of [["59350", "Lille"], ["49007", "Angers"]]) {
    const response = await aideStructures(new Request(
      `https://autour.test/api/aide-structures?lat=${zones[code].lat}&lng=${zones[code].lng}&city_code=${code}&source=dora&radius=20000`,
    ));
    const body = await json(response);
    assert.equal(body.cityCode, code);
    assert.ok(body.items.length > 0, `${nom}: branche DORA vide`);
    assert.ok(body.items.every((item) => item.cityCode === code),
      `${nom}: une fiche ne porte pas le code INSEE demandé`);
  }
});

test("une panne DORA conserve le pré-calcul et expose son état", async () => {
  const previousToken = process.env.DORA_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.DORA_API_TOKEN = "test-token";
  globalThis.fetch = async () => { throw new Error("dora_503"); };
  try {
    const response = await aideStructures(new Request(
      "https://autour.test/api/aide-structures?lat=47.47842&lng=-0.56316&city_code=49007&source=dora&radius=20000",
    ));
    const body = await json(response);
    assert.ok(body.items.length > 0, "le pré-calcul n'a pas pris le relais");
    assert.ok(body.sourceStatus.some((status) => status.source === "dora" && status.state === "unavailable"));
  } finally {
    if (previousToken == null) delete process.env.DORA_API_TOKEN;
    else process.env.DORA_API_TOKEN = previousToken;
    globalThis.fetch = previousFetch;
  }
});

test("une panne Service-Public ne rend pas un snapshot Tourcoing universel", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("https://geo.api.gouv.fr/communes")) {
      return new Response(JSON.stringify([{code: "59599", nom: "Tourcoing",
        codeDepartement: "59", codeRegion: "32"}]));
    }
    throw new Error("service_public_503");
  };
  try {
    const response = await aideInstitutionnelle(new Request(
      "https://autour.test/api/aide-institutionnelle?lat=50.72373&lng=3.160758&radius=20000&needs=travail,papiers",
    ));
    const body = await json(response);
    assert.equal(body.cityCode, "59599");
    assert.ok(body.items.length > 0, "le snapshot local n'a pas pris le relais");
    assert.ok(body.items.every((item) => /tourcoing/i.test(JSON.stringify(item))),
      "une fiche hors Tourcoing a franchi le fallback");
    assert.ok(body.sourceStatus.some((status) => status.state === "unavailable"));
    assert.equal(body.amontFallback, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("le contrat de cache serveur couvre une panne amont", () => {
  const source = lire("../api/aide-structures.js");
  assert.match(source, /s-maxage=21600/);
  assert.match(source, /stale-while-revalidate=86400/);
  assert.match(source, /stale-if-error=604800/);
  assert.match(source, /sourceStatus/);
});
