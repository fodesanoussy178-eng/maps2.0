import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("la navigation basse respecte le contrat Autour", () => {
  const nav = html.match(/<nav id="navBas">[\s\S]*?<\/nav>/)?.[0] || "";
  const ids = [...nav.matchAll(/data-nb="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["maintenant", "explorer", "creer", "pourtoi", "aide", "profil"]);
  assert.match(nav, /id="navPourToiBadge"/);
  assert.doesNotMatch(nav, /data-nb="favoris"/);
  assert.match(nav, /<span>Maintenant<\/span>/);
  assert.match(nav, /<span>Pour toi<\/span>/);
  assert.match(nav, /<span>Aide<\/span>/);
});

test("le contexte de localisation est séparé de l'avatar", () => {
  const header = html.match(/<header id="appHeader">[\s\S]*?<\/header>/)?.[0] || "";
  assert.doesNotMatch(header, /Tourcoing|Lille/);
  assert.match(header, /id="hdAvatar"/);
  assert.match(html, /id="locationPopover"/);
  assert.match(html, /id="locationPopoverReturn"/);
  assert.match(app, /function mettreAJourLocalisationPopover/);
  assert.match(app, /revenirAutourDeMoi\(\);\s*\n\s*fermerLocalisation\(\)/);
});

test("Maintenant ne rend que les onglets, la sélection et l'aide", () => {
  const debut = app.indexOf('if(feuilleNiveau === "racine"){');
  const fin = app.indexOf('}else if(feuilleNiveau === "plus"){', debut);
  assert.ok(debut >= 0 && fin > debut);
  const racine = app.slice(debut, fin);
  assert.match(racine, /ongletsTemps\(\)/);
  assert.match(racine, /blocMaintenantAccueil\(\)/);
  assert.match(racine, /blocAideAccueil\(\)/);
  assert.doesNotMatch(racine, /blocOuRegarder|chipsHTML|blocNouveauPourToi|grilleRaccourcisAutour/);
});

test("Pour toi est opt-in et sa pastille se peint dans la navigation", () => {
  assert.match(app, /navPourToiBadge/);
  assert.match(app, /nouveautesPourToi/);
  assert.match(app, /noterConsultationPourToi/);
  assert.match(app, /function accorderPourToiALEcran\(\)[\s\S]{0,600}p\.hidden = true/);
  assert.match(app, /function fermerPourToi\(\)[\s\S]{0,300}p\.hidden = true/);
});

test("la feuille Maintenant est refermable sur desktop et mobile", () => {
  assert.match(html, /id="fbFermer"/);
  assert.match(html, /#feuilleBesoins\.accueil \.fb-x\{display:grid\}/);
  assert.match(html, /#feuilleBesoins \.fb-corps\{overflow-y:auto/);
});

test("Créer commence par cinq choix simples, sans compte préalable", () => {
  const debut = app.indexOf('function ouvrirCreation()');
  const fin = app.indexOf('let typeAvantPose', debut);
  const creation = app.slice(debut, fin);
  for (const label of ["Événement", "Lieu", "Activité", "Bon plan", "Autre"]) {
    assert.match(creation, new RegExp(label));
  }
  const nav = app.slice(app.indexOf('$("#navBas")'), app.indexOf('/* Ce qui reprend', app.indexOf('$("#navBas")')));
  assert.match(nav, /if\(id === "creer"\)\{[\s\S]*ouvrirCreation\(\)/);
  assert.doesNotMatch(nav, /exigerCompte\("publier"\)/);
});
