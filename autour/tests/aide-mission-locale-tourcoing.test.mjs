/* LA MISSION EMPLOI LYS DE TOURCOING, DE BOUT EN BOUT.

   L'enregistrement est celui de l'export DILA embarqué — pas une invention :
   200 rue de Roubaix, 50.709408 / 3.166806. Le test suit la fiche sur toute la
   chaîne que l'écran emprunte, parce que le symptôme signalé était sa
   disparition entre l'API et les résultats. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const dossier = (p) => new URL(p, import.meta.url);
const RECORD = JSON.parse(lire("./fixtures-mission-locale-tourcoing.json"));

/* Les modules sont des IIFE navigateur : on leur donne une fenêtre. */
const fenetre = {};
["../providers/normaliser.js", "../providers/aideInstitutionnelle.js"]
  .forEach((f) => new Function("window", readFileSync(dossier(f), "utf8"))(fenetre));
["../aide-taxonomie.js", "../aide-rayon.js", "../aide-classement.js", "../aide.js"]
  .forEach((f) => new Function("globalThis", "window",
    readFileSync(dossier(f), "utf8"))(fenetre, fenetre));

const P = fenetre.AutourProviders;
const AIDE = fenetre.AutourAide;
const CLASSEMENT = fenetre.AutourAideClassement;

test("l'export DILA porte bien la structure attendue", () => {
  const a = (RECORD.adresse || [])[0] || {};
  assert.equal(a.complement1, "Mission Emploi Lys Tourcoing");
  assert.equal(a.numero_voie, "200 rue de Roubaix");
  assert.equal(a.nom_commune, "Tourcoing");
  assert.equal(Number(a.latitude), 50.709408);
  assert.equal(Number(a.longitude), 3.166806);
});

test("le normaliseur institutionnel en fait une structure d'emploi", () => {
  const p = P.aideInstitutionnelle.normaliser(RECORD);
  assert.ok(p, "la fiche ne doit pas être rejetée");
  /* Le nom commercial l'emporte sur l'intitulé administratif : c'est celui
     qu'on lit sur la façade. */
  assert.equal(p.name, "Mission Emploi Lys Tourcoing");
  assert.equal(p.primaryType, "mission_locale");
  assert.equal(p.category, "emploi");
  assert.equal(p.lat, 50.709408);
  assert.equal(p.lng, 3.166806);
  /* Les horaires viennent des vrais champs DILA, rendus en français. */
  assert.ok(p.openingHours.weekdayDescriptions.includes("lundi 14h00-17h00"));
});

test("versInterne conserve ce dont Aide a besoin", () => {
  const item = P.versInterne(P.aideInstitutionnelle.normaliser(RECORD));
  assert.ok(item, "versInterne ne doit pas rendre null");
  assert.equal(item.titre, "Mission Emploi Lys Tourcoing");
  assert.equal(item.cat, "emploi");
  assert.equal(item.type, "mission_locale");
  assert.equal(item.source, "service_public");
  assert.ok(String(item.id).startsWith("service-public:"));
});

test("le classement Aide la retient pour « travail », et sûrement", () => {
  const item = P.versInterne(P.aideInstitutionnelle.normaliser(RECORD));
  const verdict = CLASSEMENT.repond(item, "travail");
  assert.equal(verdict.accorde, true, "la structure doit répondre au besoin travail");
  assert.equal(verdict.certaine, true);
  assert.ok(verdict.confiance >= 50, "confiance trop faible : " + verdict.confiance);

  assert.equal(AIDE.estSolution(item, ["travail"]), true);
  assert.equal(AIDE.estFournisseurAide(item), true);

  const p = AIDE.pertinence(item, "travail");
  assert.equal(p.direct, true, "une Mission Locale n'est pas un recours généraliste");
  assert.ok(p.poids >= 0.5, "poids trop faible : " + p.poids);
});

test("aucun filtre pays ne l'écarte", () => {
  const item = P.versInterne(P.aideInstitutionnelle.normaliser(RECORD));
  const texte = [item.adresse, item.cp, item.titre].filter(Boolean).join(" ");
  assert.ok(!/belgique|belgium|mouscron|kortrijk/i.test(texte),
    "rien dans la fiche ne doit la faire passer pour belge");
});
