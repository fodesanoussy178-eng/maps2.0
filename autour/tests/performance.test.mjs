import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const apiAide = await readFile(new URL("../api/aide-structures.js", import.meta.url), "utf8");

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

test("le démarrage local ne charge jamais un bassin cross-zone complet", () => {
  assert.doesNotMatch(app, /evenements_bassin|chargerEvenementsMetropole|evenementsMetropole/);
  assert.match(app, /rpc\("evenements_locaux"/);
  assert.match(app, /rpc\("evenements_majeurs_hors_zone"/);
  assert.match(app, /p_limite:24/);
  assert.match(app, /limite:120/);
});

test("les réponses Supabase périmées sont rejetées avant le réseau", () => {
  assert.match(app, /function contexteCoucheSupabaseCourant\(zoneId, portee\)/);
  const local = app.slice(app.indexOf("async function chargerEvenementsCanoniques"),
    app.indexOf("function programmerCoucheSupabaseSecondaire"));
  assert.match(local, /if\(!contexteCoucheSupabaseCourant\(zoneId, portee\)\) return null;/);
  assert.match(local, /if\(!contexteCoucheSupabaseCourant\(zoneId, porteeEvenements\)\) return null;/);
  assert.match(app, /annulerGeneration\("demarrage"\)/);
  assert.match(app, /annulerGeneration\("zone:exploration"\)/);
});

test("les marqueurs mobiles partent par premier lot puis lots secondaires", () => {
  assert.match(app, /const RENDU_PROGRESSIF_MAX_INITIAL_MOBILE = 18;/);
  assert.match(app, /return estMobilePerformance\(\) \? RENDU_PROGRESSIF_MAX_INITIAL_MOBILE/);
  assert.match(app, /programmerRenduCarteProgressif\(items,aRendre,attendus\)/);
  assert.match(app, /p_limite:limite/);
});

test("Aide ne télécharge rien au démarrage et borne sa réponse explicite", () => {
  const precharge = app.slice(app.indexOf("function programmerPrechargementAide()"),
    app.indexOf("/* Les besoins que la phrase", app.indexOf("function programmerPrechargementAide()")));
  assert.doesNotMatch(precharge, /chargerAide\(/);
  assert.match(app, /const AIDE_RAYON_INITIAL = 5000;/);
  assert.match(apiAide, /const RESULTATS_MAX = 60;/);
  assert.match(apiAide, /size\", String\(limite\)/);
  assert.match(apiAide, /uniques\.slice\(0, limite\)/);
});

test("un geste carte déduplique sa réconciliation finale", () => {
  const geste = app.slice(app.indexOf('map.on("moveend zoomend"'),
    app.indexOf('window.addEventListener("autour:google-map-gesture-end"'));
  assert.doesNotMatch(geste, /if\(!repriseGeste\) majEpaisseurs\(\)/);
  assert.match(geste, /clearTimeout\(minuteurRendu\)/);
  assert.match(geste, /rendre\(\{progressif:true\}\)/);
  assert.match(app, /restaurerDensiteApresGeste\(\);/);
});
