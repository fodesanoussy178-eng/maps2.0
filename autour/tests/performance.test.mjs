import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("une position inconnue ne lance jamais de requête géographique", () => {
  assert.match(app, /function coordonneesValides\(lat, lng\)\{[\s\S]{0,260}\(a !== 0 \|\| b !== 0\);/);
  assert.match(app, /function chargerZone\(lat, lng, opts\)\{\s*const o = opts \|\| \{\};\s*if\(!coordonneesValides\(lat,lng\)\) return Promise\.resolve\(\[\]\);/);
  assert.match(app, /async function vraisLieux\(lat,lng,bornes,opts\)\{\s*if\(!coordonneesValides\(lat,lng\)\)/);
  assert.match(app, /function chargerDonneesTemporaires\(lat, lng, opts\)\{\s*const o = opts \|\| \{\};\s*if\(!coordonneesValides\(lat,lng\)\)/);
});

test("les points mémorisés et serveur invalides sont ignorés avant le démarrage", () => {
  assert.match(app, /if\(!o \|\| !coordonneesValides\(o\.lat,o\.lng\)\) return null;/);
  assert.match(app, /if\(pointGeographiqueValide\(v\)\) return v;/);
  assert.match(app, /if\(coords && !pointGeographiqueValide\(coords\)\) coords = null;/);
});

test("la sélection des marqueurs ne reclasse pas une vue strictement identique", () => {
  assert.match(app, /let selectionMemo = \{cle:null, items:null, details:null, ecartes:0, regroupes:0\};/);
  assert.match(app, /function cleSelection\(ctx\)\{[\s\S]{0,1600}revisionLieux[\s\S]{0,500}emprise[\s\S]{0,500}modeAide/);
  const bloc = /function selectionner\(\)\{[\s\S]*?const brut = visibles\(\);/.exec(app);
  assert.ok(bloc, "le chemin de sélection doit exister");
  assert.match(bloc[0], /selectionMemo\.cle === cle/);
  assert.match(bloc[0], /return selectionMemo\.items;/);
});

test("le mémo Aide est borné par la zone et les révisions de données", () => {
  assert.match(app, /let revisionBassinAide = 0;/);
  assert.match(app, /const cleMemo = idZoneActive\(\)\+"\|"\+revisionLieux\+"\|"\+revisionBassinAide/);
  assert.match(app, /revisionBassinAide \+= 1;[\s\S]{0,180}candidatsAideMemo =/);
});
