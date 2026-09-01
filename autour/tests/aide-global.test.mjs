import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = lire("../app.js");
const index = lire("../index.html");

test("le bassin Aide est séparé, borné par la zone et préchargé après la peinture", () => {
  assert.match(app, /const AIDE_CACHE_PREFIX = "autour:bassin-aide:v3:"/);
  assert.ok(app.includes("AIDE_CACHE_PREFIX + encodeURIComponent(idZoneActive())"));
  assert.ok(app.includes("Date.now() - Number(entree.t) > AIDE_CACHE_HEURES"));
  assert.ok(app.includes("function programmerPrechargementAide()"));
  assert.ok(app.includes("apresPeinture(()=>programmerPrechargementAide());"));
  assert.ok(app.includes("if(modeAide){") && app.includes("candidatsAideZone()"));
});

test("l'écran initial Aide affiche le bassin prioritaire et la recherche dédiée", () => {
  assert.ok(app.includes("AIDE_FILTRES_MAQUETTE"));
  assert.ok(app.includes('{id:"tout", label:"Tout"'));
  assert.ok(app.includes('{id:"logement", label:"Logement"'));
  assert.ok(app.includes('{id:"manger", label:"Manger"'));
  assert.ok(app.includes('{id:"travail", label:"Travail / argent"'));
  assert.ok(app.includes('{id:"papiers", label:"Papiers / démarches"'));
  assert.ok(app.includes('{id:"sante", label:"Santé"'));
  assert.ok(app.includes('{id:"jeunes", label:"Jeunes / études"'));
  assert.ok(app.includes('{id:"parler", label:"Parler à quelqu’un"'));
  assert.ok(app.includes('{id:"famille", label:"Famille"'));
  assert.ok(app.includes('{id:"securite", label:"Sécurité"'));
  assert.ok(app.includes('{id:"autre", label:"Autre besoin"'));
  assert.ok(app.includes("solutionsAide(aideAfficherToutes ? Infinity : 3, {noModel:true})"));
  assert.ok(app.includes('data-aide-toutes="1"') && app.includes("Voir toutes les aides autour de toi"));
  assert.ok(!index.includes('id="formBesoin"'));
  assert.ok(index.includes('id="aideRechercheContenu"'));
  assert.ok(index.includes(".recherche-aide"));
  assert.match(index, /\.aide-filtres\{[^}]*flex-wrap:nowrap/);
  assert.match(index, /\.aide-filtres\{[^}]*overflow-x:auto/);
  assert.match(index, /\.aide-filtres\{[^}]*height:47px/);
  assert.ok(app.includes("URGENCES_AIDE") && app.includes('href=\"tel:\'') && app.includes("u.numero"));
  assert.ok(app.includes("112") && app.includes("15") && app.includes("17") &&
    app.includes("18") && app.includes("115") && app.includes("3114") && app.includes("3919"));
});

test("la capsule Aide annonce au plus trois recommandations et reste actionnable", () => {
  assert.ok(app.includes("solutionsAide(3, {noModel:true})"));
  assert.ok(app.includes("modeAide ? 3 : MAINTENANT_APERCU"));
  assert.ok(app.includes('if(modeAide){') && app.includes('ouvrirFeuille2("aide")'));
  assert.ok(index.includes("#btnAide{z-index:950}"));
  assert.ok(index.includes("body.aide #feuilleBesoins"));
  assert.ok(app.includes('poserBesoinsRapides();') && app.includes('marquerNavigation(modeAide ? "aide" : "explorer");'));
  assert.ok(app.includes('!modeTerritorial && !modeAide)'));
});

test("l’onboarding ne recouvre pas la capsule ni le panneau Aide sur mobile", () => {
  assert.match(index, /#onboardingLocalisation:not\(\[hidden\]\) ~ #badgeMaintenant\{display:none\}/);
  assert.match(index, /body\.aide #onboardingLocalisation\{display:none\}/);
});
