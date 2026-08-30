/* LES SIX RÉGRESSIONS CONSTATÉES EN PRODUCTION.

   Chacune est vérifiée par son comportement quand c'est possible, et par la
   source seulement quand le comportement demande un navigateur. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../core.js";
import "../temporel.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = lire("../app.js");
const core = lire("../core.js");
const apiAide = lire("../api/aide-institutionnelle.js");
const providerAide = lire("../providers/aideInstitutionnelle.js");
const { dedupeItems, toCommonItem } = globalThis.AutourCore;

const distance = (aLat, aLng, bLat, bLng) => {
  const rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos((aLat + bLat) * rad / 2);
  const y = (bLat - aLat) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
};

/* -- 1. Le bassin ------------------------------------------------------- */

test("le bassin métropolitain est rafraîchi dès que le territoire est résolu", () => {
  /* La résolution n'est pas attendue, pour ne pas retarder Explorer. Le seul
     appel qui existait partait de la fin du chargement des couches : il
     arrivait avant la réponse, trouvait le bassin à null et sortait sans que
     rien ne réessaie — « Pour toi » restait vide en permanence. */
  const i = app.indexOf('sbLecture.rpc("resoudre_territoire"');
  assert.ok(i > 0, "l'appel de résolution du territoire a disparu");
  const bloc = app.slice(i, app.indexOf(".finally(finTerritoire)", i));
  assert.match(bloc, /bassinTerritorialActif = /);
  assert.match(bloc, /rafraichirMetropole\(\)/,
    "rafraichirMetropole doit être déclenché là où le bassin devient connu");
});

/* -- 2. Un événement affiche les heures que la base connaît ------------- */

/* `horairesEvenement` ne dépend que d'`Intl` : on l'extrait de la source et on
   l'exécute pour de vrai, plutôt que de se contenter de lire le fichier. */
function extraire(nom, src) {
  const i = src.search(new RegExp("^function " + nom + "\\(", "m"));
  assert.ok(i >= 0, nom + " est introuvable");
  let k = src.indexOf("{", i), prof = 0, fin = -1;
  for (let n = k; n < src.length; n += 1) {
    if (src[n] === "{") prof += 1;
    else if (src[n] === "}") { prof -= 1; if (prof === 0) { fin = n + 1; break; } }
  }
  return new Function(src.slice(i, fin) + "; return " + nom + ";")();
}
const horairesEvenement = extraire("horairesEvenement", app);

test("un événement daté affiche ses heures, pas « Horaires inconnus »", () => {
  /* Les valeurs viennent de la base : le vide-greniers du Touquet Saint-Gérard
     à Wattrelos, 30 août 12h00–18h00, date_confidence = exact. Rien n'est lu
     dans l'affiche. */
  const libelle = horairesEvenement({
    isTemporary: true, timezone: "Europe/Paris", dateConfidence: "exact",
    debutLe: Date.parse("2026-08-30T10:00:00Z"),
    finLe: Date.parse("2026-08-30T16:00:00Z"),
  });
  assert.match(libelle, /^Dimanche 30 août · 12h00–18h00$/);
});

test("sans heure fiable, on donne le jour et on n'invente rien", () => {
  const libelle = horairesEvenement({
    isTemporary: true, timezone: "Europe/Paris", dateConfidence: "day",
    debutLe: Date.parse("2026-08-30T10:00:00Z"),
  });
  assert.equal(libelle, "Dimanche 30 août");
});

test("un lieu permanent ne passe pas par le rendu événementiel", () => {
  assert.equal(horairesEvenement({ isTemporary: false, debutLe: Date.now() }), "");
  assert.equal(horairesEvenement({ isTemporary: true }), "Horaires à vérifier");
});

test("libelleHoraires consulte les dates avant d'abandonner", () => {
  const i = app.search(/^function libelleHoraires\(/m);
  const bloc = app.slice(i, app.indexOf("}", app.indexOf("Horaires inconnus", i)));
  assert.ok(bloc.indexOf("horairesEvenement(l)") < bloc.indexOf("Horaires inconnus"),
    "le repli « Horaires inconnus » doit venir APRÈS la lecture des dates");
});

test("ce qui qualifie les dates suit le côté qui apporte les dates", () => {
  /* Entre deux sources événementielles, la plus pauvre ne doit pas imposer sa
     confiance temporelle à celle qui connaît l'heure. */
  assert.match(core, /const cot[ée]Temporel = \[preferred, fallback\]\.find\(\(c\) => c && c\.startsAt != null\)/);
  assert.match(core, /"quand", "dateConfidence", "temporalStatus"/);
});

test("un événement et un lieu permanent ne fusionnent jamais", () => {
  /* C'est cette frontière qui garantit qu'une fiche OSM ne peut pas recouvrir
     un événement : la règle est explicite dans core.js et doit le rester. */
  assert.match(core, /if \(!!existing\.isTemporary !== !!item\.isTemporary\) return false;/);
});

/* -- 3. Mission Locale Tourcoing ---------------------------------------- */

test("le snapshot DILA est fusionné, pas seulement utilisé en secours", () => {
  /* Une réponse amont valide mais incomplète effaçait des structures connues :
     Wattrelos et Marcq sortaient, la Mission Emploi Lys de Tourcoing non. */
  const i = apiAide.indexOf("let panneAmont");
  assert.ok(i > 0, "la fusion amont/local a disparu");
  const apres = apiAide.slice(apiAide.indexOf("} catch (e) {", i));
  const fusion = apres.slice(apres.indexOf("const statique = baseLocaleStatique(commune)"));
  assert.ok(fusion.length > 0, "le snapshot doit être lu HORS du catch");
  assert.match(fusion, /resultats = resultats\.concat\(statique\.records\)/);
  assert.ok(fusion.indexOf("const uniques = new Map()") > 0,
    "la déduplication par identifiant doit suivre la fusion");
});

test("l'export DILA embarqué contient bien la structure de Tourcoing", () => {
  const snapshot = lire("../data/aide-institutionnelle-dila-59599.js");
  assert.match(snapshot, /50\.709408/, "la latitude attendue est absente du snapshot");
  assert.match(snapshot, /3\.166806/, "la longitude attendue est absente du snapshot");
  assert.match(snapshot, /Tourcoing/);
});

/* -- 4. Aide > Manger --------------------------------------------------- */

test("les tags d'aide alimentaire sont demandés et classés en alimentaire", () => {
  const table = (nom) => {
    const i = app.indexOf("const " + nom + " = [");
    return eval("[" + app.slice(app.indexOf("[", i) + 1, app.indexOf("\n];", i)) + "]");
  };
  const REQUETES = table("REQUETES");
  [["social_facility", "food_bank"], ["social_facility", "soup_kitchen"],
   ["social_facility", "food_sharing"], ["amenity", "food_bank"]]
    .forEach(([k, v]) => {
      const regle = REQUETES.find(([rk, rv]) => rk === k && rv === v);
      assert.ok(regle, k + "=" + v + " n'est plus demandé");
      assert.equal(regle[2], "alimentaire", k + "=" + v + " doit classer en alimentaire");
    });
  /* La première règle qui matche gagne : un food_bank tagué aussi
     `amenity=social_facility` ne doit pas retomber en « asso ». */
  const t = { amenity: "social_facility", social_facility: "food_bank" };
  const gagnante = REQUETES.find(([k, v]) => t[k] === v);
  assert.equal(gagnante[2], "alimentaire");
});

test("le besoin « manger » admet directement les catégories alimentaires", () => {
  const aide = lire("../aide.js");
  assert.match(aide, /cats: \["alimentaire", "collecte", "food"\]/);
  assert.match(aide, /manger: \["alimentaire", "collecte"\]/);
});

/* -- 5. Jours et horaires en français ------------------------------------ */

test("les horaires DILA sont lus sur leurs vrais champs et rendus en français", () => {
  const fenetre = {};
  new Function("window", providerAide)(fenetre);
  const { horaires, jourFrancais } = fenetre.AutourProviders.aideInstitutionnelle;

  assert.equal(jourFrancais("Monday"), "lundi");
  assert.equal(jourFrancais("Nord/Wednesday"), "mercredi");
  assert.equal(jourFrancais("samedi"), "samedi", "une forme déjà française ne bouge pas");

  const lignes = horaires({
    plage_ouverture: [
      { nom_jour_debut: "Monday", nom_jour_fin: "Monday",
        valeur_heure_debut_1: "14h00", valeur_heure_fin_1: "17h00",
        valeur_heure_debut_2: "", valeur_heure_fin_2: "" },
      { nom_jour_debut: "Tuesday", nom_jour_fin: "Tuesday",
        valeur_heure_debut_1: "09h00", valeur_heure_fin_1: "12h00",
        valeur_heure_debut_2: "14h00", valeur_heure_fin_2: "17h00" },
    ],
  });
  assert.deepEqual(lignes, ["lundi 14h00-17h00", "mardi 09h00-12h00, 14h00-17h00"]);
  assert.ok(!lignes.join(" ").match(/Monday|Tuesday/), "aucun jour anglais ne doit sortir");
});

/* -- 6. Avatar ----------------------------------------------------------- */

test("les avatars sont les silhouettes debout, non ambiguës chez Apple", () => {
  assert.match(app, /const AVATARS_ONBOARDING = Object\.freeze\(\["🧍🏻", "🧍🏼", "🧍🏽", "🧍🏾", "🧍🏿"\]\)/);
  assert.ok(!app.includes("🧑🏻"), "l'ancien buste ne doit plus figurer");
});
