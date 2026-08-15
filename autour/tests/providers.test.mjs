import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { sourceApplication } from "./source.mjs";

const normaliserCode = await readFile(new URL("../providers/normaliser.js", import.meta.url), "utf8");
const googleCode = await readFile(new URL("../providers/googlePlaces.js", import.meta.url), "utf8");
const mapCode = await readFile(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
const html = await sourceApplication(import.meta.url);

function providers() {
  const window = {};
  const contexte = vm.createContext({window});
  vm.runInContext(normaliserCode, contexte);
  vm.runInContext(googleCode, contexte);
  return window.AutourProviders;
}

test("Google Places produit le contrat Autour, pas son format brut", () => {
  const api = providers();
  const lieu = api.googlePlaces.normaliserPlace({
    id:"ChIJ-123", displayName:{text:"Le café Autour"}, primaryType:"cafe",
    location:{latitude:50.6292, longitude:3.0573}, formattedAddress:"1 rue du Test, Lille",
    rating:4.6, userRatingCount:128, websiteUri:"https://example.test", nationalPhoneNumber:"03 20 00 00 00",
    currentOpeningHours:{openNow:true}, regularOpeningHours:{weekdayDescriptions:["Lundi : 09:00–18:00"]},
    photos:[{name:"places/ChIJ-123/photos/photo-1", authorAttributions:[{displayName:"Autrice"}]}],
  }, {apiKey:"browser-key"});

  assert.equal(lieu.name, "Le café Autour");
  assert.match(lieu.autourId, /^autour:/);
  assert.equal(lieu.sourceRefs.googlePlaceId, "ChIJ-123");
  assert.equal(lieu.category, "cafe");
  assert.deepEqual(lieu.openingHours.weekdayDescriptions, ["Lundi : 09:00–18:00"]);
  assert.equal(lieu.rating.value, 4.6);
  assert.equal(lieu.rating.count, 128);
  assert.equal(lieu.photos[0].source, "google_places");
  assert.equal(lieu.photos[0].attribution[0].name, "Autrice");
  assert.match(lieu.photos[0].url, /places\.googleapis\.com\/v1\/places\/ChIJ-123\/photos/);

  const interne = api.versInterne(lieu);
  assert.equal(interne.id, lieu.autourId);
  assert.equal(interne.idGoogle, "ChIJ-123");
  assert.equal(interne.titre, "Le café Autour");
  assert.equal(interne.sourceRefs.googlePlaceId, "ChIJ-123");
});

test("tous les types médicaux Google Places demandés sont normalisés en santé", () => {
  const api = providers();
  const types = ["hospital","general_hospital","medical_center","medical_clinic",
    "pharmacy","drugstore","doctor","dental_clinic","dentist","medical_lab","physiotherapist"];
  types.forEach((primaryType, index) => {
    const lieu = api.googlePlaces.normaliserPlace({
      id:"medical-"+index, displayName:{text:"Lieu médical "+index}, primaryType,
      types:[primaryType,"health"], location:{latitude:50.62+index/1000,longitude:3.05},
    }, {apiKey:"browser-key"});
    assert.equal(lieu.category,"sante",primaryType+" doit appartenir à santé");
    assert.ok(lieu.categories.includes(primaryType),"les types bruts restent disponibles au ciblage");
  });
});

test("l’UI charge les providers et ne contacte aucun fournisseur directement", () => {
  for (const fichier of ["providers/normaliser.js", "providers/googlePlaces.js", "providers/datatourisme.js", "providers/osm.js", "mapProviders/googleMaps.js"])
    assert.match(html, new RegExp('<script src="' + fichier.replace(/[./]/g, "\\$&") + '\\?v='));
  assert.doesNotMatch(html, /places\.googleapis\.com/);
  assert.match(mapCode, /gestureHandling:"greedy"/);
  assert.match(mapCode, /lierLeaflet/);
  assert.match(mapCode, /gm_authFailure/);
  assert.match(mapCode, /loading=async&callback=/);
  assert.match(mapCode, /__autourGoogleMapsReady/);
  assert.match(html, /remettreFondAutonome/);
  assert.match(html, /if\(!fournisseur \|\| !\(await googleMapsActif\(\)\)\) return \[\];/);
});
