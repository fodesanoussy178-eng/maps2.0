import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../contexte.js");
await import("../core.js");
const CTX = globalThis.AutourContexte;
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const TOURCOING = { centre: [50.7236, 3.1610],
  emprise: [[50.6934, 3.1194], [50.7480, 3.1929]] };
const PARIS = { centre: [48.8566, 2.3522],
  emprise: [[48.8156, 2.2242], [48.9022, 2.4699]] };
const LILLE = { centre: [50.6292, 3.0573],
  emprise: [[50.5949, 2.9557], [50.6570, 3.1413]] };
const RENNES = { centre: [48.1173, -1.6778],
  emprise: [[48.0550, -1.7800], [48.1800, -1.5500]] };

function extraireFonction(nom) {
  const debut = app.search(new RegExp("^function " + nom + "\\(", "m"));
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

const contexteDepuisZone = new Function(
  "CTX",
  extraireFonction("contexteDepuisZone") + "; return contexteDepuisZone;")
  (CTX);

const dansZoneActive = (activeLocationContext, zoneActive = null) =>
  new Function(
    "CTX", "bornesVue", "activeLocationContext", "zoneActive",
    extraireFonction("dansZoneActive") + "; return dansZoneActive;")(
      CTX, () => null, activeLocationContext, zoneActive);

const elementsDuContexte = (items, context) =>
  new Function(
    "dansZoneActive", extraireFonction("elementsDuContexte") +
      "; return elementsDuContexte;")(
        (item) => dansZoneActive(context, context.zone)(item),
      )(items);

function item(id, lat, lng, extra = {}) {
  return Object.assign({id, titre:id, lat, lng, entity_type:"event"}, extra);
}

const melEvent = item("mel-rap", ...TOURCOING.centre, {
  announcement_tags:["rap", "concert"],
});
const parisEvent = item("paris-concert", ...PARIS.centre, {
  announcement_tags:["rap", "concert"],
});
const lilleEvent = item("lille-concert", ...LILLE.centre, {
  announcement_tags:["concert"],
});
const rennesEvent = item("rennes-concert", ...RENNES.centre, {
  announcement_tags:["concert"],
});
const tousLesEvenements = [melEvent, parisEvent, lilleEvent, rennesEvent];

function bassinPourToi(lieux, elementsDuContexte, estCanonique, activeZoneId) {
  return new Function(
    "lieux", "elementsDuContexte", "estCanonique", "dedupeItems", "distanceM", "idZoneActive", "ZONES", "dansZoneActive",
    extraireFonction("localPoolPourToi") + extraireFonction("bassinPourToi") + "; return bassinPourToi();")(
      lieux, elementsDuContexte, estCanonique,
      globalThis.AutourCore.dedupeItems,
      (lat1, lng1, lat2, lng2) => Math.hypot((Number(lat1) - Number(lat2)) * 111000,
        (Number(lng1) - Number(lng2)) * 70000),
      () => activeZoneId,
      {zoneIdForItem: (x) => {
        if(String(x.id).startsWith("paris")) return "paris";
        if(String(x.id).startsWith("lille")) return "mel";
        if(String(x.id).startsWith("rennes")) return "rennes";
        if(String(x.id).startsWith("mel")) return "mel";
        return null;
      }},
      () => true);
}

function idsDeSurface(context) {
  const locaux = elementsDuContexte(tousLesEvenements, context);
  const zoneId = String(context.city || "").toLowerCase() === "paris" ? "paris"
    : String(context.city || "").toLowerCase() === "rennes" ? "rennes" : "mel";
  const localPool = bassinPourToi(
    tousLesEvenements,
    (items) => elementsDuContexte(items, context),
    (event) => !event.duplicate_of,
    zoneId,
  );
  return { locaux: locaux.map((x) => x.id), localPool: localPool.map((x) => x.id) };
}

test("GPS Tourcoing → recherche Paris : le contexte de destination est exclusif", () => {
  const gps = contexteDepuisZone(CTX.zoneMoi(TOURCOING.centre, "Tourcoing"));
  const paris = contexteDepuisZone(CTX.zoneRecherche("Paris", PARIS.centre, PARIS.emprise));
  assert.equal(gps.mode, "gps");
  assert.equal(paris.mode, "destination");
  assert.deepEqual(idsDeSurface(paris), {
    locaux:["paris-concert"], localPool:["paris-concert"],
  });
});

test("GPS Paris → recherche Lille : aucun événement Paris dans les surfaces Lille", () => {
  const lille = contexteDepuisZone(CTX.zoneRecherche("Lille", LILLE.centre, LILLE.emprise));
  const surfaces = idsDeSurface(lille);
  assert.deepEqual(surfaces, {locaux:["lille-concert"], localPool:["lille-concert"]});
  assert.equal(surfaces.localPool.includes("paris-concert"), false);
});

test("Paris → Rennes : aucune donnée Paris résiduelle après changement de destination", () => {
  const rennes = contexteDepuisZone(CTX.zoneRecherche("Rennes", RENNES.centre, RENNES.emprise));
  assert.deepEqual(idsDeSurface(rennes), {
    locaux:["rennes-concert"], localPool:["rennes-concert"],
  });
});

test("retour à Ma position : le bassin GPS est restauré", () => {
  const tourcoing = contexteDepuisZone(CTX.zoneMoi(TOURCOING.centre, "Tourcoing"));
  assert.equal(tourcoing.mode, "gps");
  assert.deepEqual(idsDeSurface(tourcoing), {locaux:["mel-rap"], localPool:["mel-rap"]});
});

test("Maintenant, Pour toi et Explorer partagent le même entonnoir actif", () => {
  assert.match(app, /function elementsDuContexte\(items\)/);
  for (const nom of ["itemsMaintenant", "bassinPourToi", "localPoolPourToi", "visiblesBruts", "recommandationsAccueil"]) {
    const fonction = extraireFonction(nom);
    assert.match(fonction, /dansZoneActive|elementsDuContexte|localPoolPourToi/,
      nom + " ne lit pas le contexte géographique actif");
  }
  assert.match(app, /let activeLocationContext = null;/);
  assert.match(app, /activeLocationContext = contexteDepuisZone\(zoneActive\);/);
  assert.match(app, /activeLocationContext\?\.mode === "destination"/);
});

test("le suivi GPS ne recharge pas le bassin physique pendant une destination", () => {
  const appliquer = extraireFonction("appliquerPosition");
  assert.match(appliquer, /const destinationAvant = destinationActive\(\);/);
  assert.match(appliquer, /const doitRestaurerZone = retourDemande \|\| !destinationAvant;/);
  assert.match(appliquer, /if\(bouge && doitRestaurerZone\)\{/);
  assert.match(appliquer, /chargerZone\(c\[0\], c\[1\]/);
  assert.match(appliquer, /chargerDonneesTemporaires\(c\[0\], c\[1\]\)/);
});

test("les réponses différées de l'ancien bassin ne peuvent plus polluer la destination", () => {
  const demarrage = extraireFonction("chargerLeDemarrage");
  assert.match(demarrage, /porteeValide\(generation\.portee\)/);
  assert.match(demarrage, /!destinationActive\(\)/);
  const fusion = extraireFonction("fusionner");
  assert.match(fusion, /\.filter\(l=>dansZoneActive\(l\)\)/);
  assert.match(app, /chargerDonneesTemporaires\(lat,lng,\{sansPublications:true\}\)/);
});

test("les libellés de ville des fiches suivent la destination active", () => {
  assert.match(app, /cp:p\.cp \|\| \(destinationActive\(\) \? \(activeLocationContext\?\.city \|\| \"\"\) : commune\)/);
  assert.match(app, /destinationActive\(\) \? \(activeLocationContext\?\.city \|\| \"\"\) : commune/);
});

test("un changement de destination vide les mémoires de la ville quittée", () => {
  const vider = extraireFonction("viderDonneesContexte");
  for (const ligne of [
    "permanentPlaces = [];", "datatourismePlaces = [];", "externalEvents = [];",
    "userPublications = [];", "lieux = [];", "evenementsMajeursHorsZone = [];",
    "bassinTerritorialActif = null;", "recoCache = null;",
  ]) {
    const cible = /bassinTerritorialActif|evenementsMajeursHorsZone/.test(ligne)
      ? extraireFonction("definirZoneActive") : vider;
    assert.match(cible, new RegExp(ligne.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(app, /viderDonneesContexte\(\);/);
});
