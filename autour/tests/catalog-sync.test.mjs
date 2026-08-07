import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOPES, normalizeDataset, normalizeCatalog, matchesScope,
  extractCoverage, geoJsonToEwkt, normalizeResource,
} from "../supabase/functions/catalog-sync/catalog.mjs";

/* Jeu de données MEL plausible. La forme exacte de l'API n'a pas pu être
   observée (accès sortant bloqué en développement) : ces fixtures couvrent
   les variantes de champs que la normalisation doit absorber. */
const DATASET_MEL = {
  id: "5c4a19d2634f4142c8a45f8d",
  slug: "reseau-urbain-ilevia",
  title: "Réseau urbain Ilévia — GTFS",
  type: "public-transit",
  licence: "odc-odbl",
  publisher: {name: "Métropole Européenne de Lille"},
  aom: {siren: "245900410", name: "Métropole Européenne de Lille"},
  covered_area: {name: "Métropole Européenne de Lille", type: "epci", siren: "245900410"},
  page_url: "https://transport.data.gouv.fr/datasets/reseau-urbain-ilevia",
  updated: "2026-07-30T04:12:00Z",
  resources: [
    {url: "https://example.test/ilevia.zip", format: "GTFS", title: "GTFS"},
    {url: "https://example.test/rt", format: "gtfs-rt", features: ["trip_updates"]},
  ],
};

const DATASET_TOULOUSE = {
  id: "abc-toulouse", title: "Réseau Tisséo", type: "public-transit",
  aom: {siren: "253100963", name: "Tisséo Collectivités"},
  covered_area: {name: "Toulouse Métropole", type: "epci", siren: "253100963"},
  resources: [{url: "https://example.test/tisseo.zip", format: "GTFS"}],
};

const DATASET_NATIONAL = {
  id: "bnac", title: "Aménagements cyclables France métropolitaine",
  type: "cycling", covered_area: {name: "France", type: "country"},
  resources: [{url: "https://example.test/bnac.parquet", format: "parquet"}],
};

test("un jeu de données du catalogue est normalisé sans perte", () => {
  const {dataset, coverage} = normalizeDataset(DATASET_MEL);
  assert.equal(dataset.pan_id, "5c4a19d2634f4142c8a45f8d");
  assert.equal(dataset.title, "Réseau urbain Ilévia — GTFS");
  assert.equal(dataset.data_type, "public-transit");
  assert.equal(dataset.licence, "odc-odbl");
  assert.equal(dataset.publisher, "Métropole Européenne de Lille");
  assert.equal(dataset.aom_siren, "245900410");
  assert.equal(dataset.national, false);
  assert.deepEqual(dataset.formats, ["GTFS", "gtfs-rt"]);
  assert.equal(dataset.resources.length, 2);
  assert.equal(coverage[0].siren, "245900410");
  // le payload brut est conservé : renormaliser ne demandera pas de re-télécharger
  assert.equal(dataset.raw, DATASET_MEL);
});

test("la licence n’est jamais supposée", () => {
  const {dataset} = normalizeDataset({...DATASET_MEL, licence: undefined, license: undefined});
  assert.equal(dataset.licence, null);
});

test("un jeu de données inexploitable est rejeté, pas complété", () => {
  assert.equal(normalizeDataset({title: "Sans identifiant", type: "public-transit"}), null);
  assert.equal(normalizeDataset({id: "x", type: "public-transit"}), null);   // sans titre
  assert.equal(normalizeDataset({id: "x", title: "Sans type"}), null);
  assert.equal(normalizeDataset(null), null);
});

test("le périmètre du premier test est limité à la MEL", () => {
  assert.equal(matchesScope(normalizeDataset(DATASET_MEL), "mel"), true);
  assert.equal(matchesScope(normalizeDataset(DATASET_TOULOUSE), "mel"), false);
  // le national couvre la MEL mais noierait le test de phase 0
  assert.equal(matchesScope(normalizeDataset(DATASET_NATIONAL), "mel"), false);
});

test("un jeu de données MEL est reconnu même sans rattachement AOM", () => {
  const parIntitule = normalizeDataset({
    id: "vlille", title: "V'Lille — stations en libre-service", type: "gbfs",
    covered_area: {name: "Lille", type: "commune", insee: "59350"},
    resources: [{url: "https://example.test/gbfs.json", format: "gbfs"}],
  });
  assert.equal(matchesScope(parIntitule, "mel"), true);
});

test("le périmètre « france » reste possible mais doit être demandé", () => {
  assert.equal(matchesScope(normalizeDataset(DATASET_TOULOUSE), "france"), true);
  assert.equal(matchesScope(normalizeDataset(DATASET_MEL), "inexistant"), false);
});

test("la normalisation d’un catalogue complet compte ce qu’elle écarte", () => {
  const vu = normalizeCatalog([DATASET_MEL, DATASET_TOULOUSE, DATASET_NATIONAL, {bruit: true}], "mel");
  assert.equal(vu.seen, 4);
  assert.equal(vu.kept.length, 1);
  assert.equal(vu.rejected, 1);                       // l'entrée inexploitable
  assert.equal(vu.kept[0].dataset.pan_id, DATASET_MEL.id);
});

test("le catalogue est accepté sous forme de liste ou d’enveloppe data", () => {
  assert.equal(normalizeCatalog({data: [DATASET_MEL]}, "mel").kept.length, 1);
  assert.equal(normalizeCatalog([DATASET_MEL], "mel").kept.length, 1);
  assert.equal(normalizeCatalog(null, "mel").seen, 0);
});

test("une couverture sans géométrie reste sans géométrie", () => {
  const coverage = extractCoverage(DATASET_MEL);
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].geom, null);               // et surtout pas un contour inventé
  assert.equal(coverage[0].insee_code, null);
  assert.equal(coverage[0].area_name, "Métropole Européenne de Lille");
});

test("une géométrie fournie est convertie en EWKT SRID 4326", () => {
  const polygone = {type: "Polygon", coordinates: [[[3.0, 50.6], [3.1, 50.6], [3.1, 50.7], [3.0, 50.6]]]};
  assert.equal(geoJsonToEwkt(polygone),
    "SRID=4326;MULTIPOLYGON(((3 50.6,3.1 50.6,3.1 50.7,3 50.6)))");

  const multi = {type: "MultiPolygon", coordinates: [polygone.coordinates]};
  assert.match(geoJsonToEwkt(multi), /^SRID=4326;MULTIPOLYGON\(\(\(/);

  // hors périmètre d'une couverture : on ne fabrique rien
  assert.equal(geoJsonToEwkt({type: "Point", coordinates: [3, 50]}), null);
  assert.equal(geoJsonToEwkt(null), null);
  assert.equal(geoJsonToEwkt({type: "Polygon", coordinates: []}), null);
});

test("les doublons de territoire sont écartés dans une même couverture", () => {
  const coverage = extractCoverage({
    covered_areas: [
      {name: "Lille", insee: "59350"},
      {name: "Lille", insee: "59350"},
      {name: "Roubaix", insee: "59512"},
    ],
  });
  assert.equal(coverage.length, 2);
});

test("une ressource sans URL n’est pas une ressource", () => {
  assert.equal(normalizeResource({format: "GTFS"}), null);
  assert.equal(normalizeResource(null), null);
  assert.equal(normalizeResource({url: "https://example.test/a.zip"}).format, null);
});

test("le territoire de test est une donnée, pas du code", () => {
  // ajouter un territoire ne doit pas demander de toucher à la logique
  assert.ok(SCOPES.mel.siren.includes("245900410"));
  assert.ok(Array.isArray(SCOPES.mel.insee));
  assert.equal(typeof SCOPES.mel.label, "string");
});
