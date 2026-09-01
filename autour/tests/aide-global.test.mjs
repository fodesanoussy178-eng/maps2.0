import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = lire("../app.js");
const index = lire("../index.html");

test("le bassin Aide est séparé, borné par la zone et préchargé après la peinture", () => {
  assert.match(app, /const AIDE_CACHE_PREFIX = "autour:bassin-aide:v1:"/);
  assert.ok(app.includes("AIDE_CACHE_PREFIX + encodeURIComponent(idZoneActive())"));
  assert.ok(app.includes("Date.now() - Number(entree.t) > AIDE_CACHE_HEURES"));
  assert.ok(app.includes("function programmerPrechargementAide()"));
  assert.ok(app.includes("apresPeinture(()=>programmerPrechargementAide());"));
  assert.ok(app.includes("if(modeAide){") && app.includes("candidatsAideZone()"));
});

test("l'écran initial garde neuf cases et « Autre besoin » hors grille", () => {
  assert.ok(app.includes('BESOINS_GRILLE : []).filter(b=>b.id !== "autre")'));
  assert.ok(app.includes('data-sa="autre"><b>') && app.includes("Autre besoin"));
  assert.ok(app.includes('placeholder="Je dois trouver où manger ce soir…"'));
  assert.ok(app.includes("Trouver de l’aide"));
  assert.ok(app.includes('data-testid="aide-urgence-detail"'));
  assert.ok(app.includes("112") && app.includes("115") && app.includes("3114"));
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
