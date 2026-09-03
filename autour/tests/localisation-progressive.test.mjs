import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extraireFonction(nom) {
  const debut = app.search(new RegExp("^async function " + nom + "\\(", "m"));
  assert.ok(debut >= 0, nom + " est introuvable");
  const ouverture = app.indexOf("{", debut);
  let profondeur = 0;
  for (let i = ouverture; i < app.length; i += 1) {
    if (app[i] === "{") profondeur += 1;
    if (app[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) return app.slice(debut, i + 1);
    }
  }
  throw new Error("fonction non fermée : " + nom);
}

async function decision({visites, permission, termine = false, etape = null}) {
  const traces = [];
  const demarrer = new Function(
    "enregistrerVisiteLocalisation", "permissionPosition", "PERF",
    "lireEtapeOnboarding", "lireEtatLocalisation", "ETAPES_ONBOARDING",
    "afficherOnboarding", "proposerPosition", "suivreMaPosition",
    extraireFonction("demarrerLocalisation") + "; return demarrerLocalisation;")(
      () => ({location_visit_count:visites}),
      async () => permission,
      {jalon:() => {}},
      () => etape,
      () => ({onboarding_completed:termine}),
      {LOCALISATION:"localisation", TERMINE:"termine"},
      (nom) => traces.push(["onboarding", nom]),
      () => traces.push(["fallback"]),
      (opts) => traces.push(["gps", opts]),
    );
  await demarrer();
  return traces;
}

test("la première visite explique et attend le geste avant le GPS", async () => {
  assert.deepEqual(await decision({visites:1, permission:"prompt"}), [["onboarding", "bienvenue"]]);
  assert.match(app, /Autour utilise ta position pour te montrer ce qui se passe vraiment autour de toi\./);
  assert.match(app, /action:"Utiliser ma position"/);
  assert.match(app, /requestAnimationFrame\(\(\)=>suivreMaPosition\(\{onboarding:true\}\)\)/);
});

test("la deuxième visite peut reproposer sans relancer une permission déjà refusée", async () => {
  assert.deepEqual(await decision({visites:2, permission:"prompt", etape:"localisation"}), [["onboarding", "localisation"]]);
  assert.deepEqual(await decision({visites:2, permission:"denied"}), [["fallback"]]);
});

test("à partir de la troisième visite prompt ne coupe plus le parcours", async () => {
  assert.deepEqual(await decision({visites:3, permission:"prompt"}), [["fallback"]]);
  assert.deepEqual(await decision({visites:7, permission:"denied"}), [["fallback"]]);
});

test("une permission accordée reste silencieuse et ne rejoue pas l'onboarding", async () => {
  assert.deepEqual(await decision({visites:1, permission:"granted"}), [["gps", {silencieux:true}]]);
  assert.deepEqual(await decision({visites:8, permission:"granted", termine:true}), [["gps", {silencieux:true}]]);
  assert.match(app, /onboarding_completed === true/);
});
