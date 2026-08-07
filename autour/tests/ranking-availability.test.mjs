import assert from "node:assert/strict";
import test from "node:test";

// l'ordre compte : le classement consulte availability.js s'il est présent
await import("../availability.js");
await import("../core.js");

const {rankResults} = globalThis.AutourCore;

function paris(y, mo, d, h, mi) {
  const cible = Date.UTC(y, mo - 1, d, h, mi);
  let t = cible;
  for (let i = 0; i < 3; i += 1) {
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris", hour12: false, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t)).forEach((p) => { parts[p.type] = p.value; });
    const vu = Date.UTC(+parts.year, +parts.month - 1, +parts.day, (+parts.hour) % 24, +parts.minute);
    if (vu === cible) break;
    t += cible - vu;
  }
  return t;
}

const distance = (aLat, aLng, bLat, bLng) =>
  Math.hypot((bLat - aLat) * 111_000, (bLng - aLng) * 73_000);

const MERCREDI_MIDI = paris(2026, 7, 15, 12, 0);
const POSITION = [50.63, 3.06];

const lieu = (id, quand, extra) => Object.assign({
  id, titre: "Resto " + id, cat: "resto", lat: 50.631, lng: 3.061, quand,
}, extra);

const classer = (items, options) => rankResults(items, Object.assign({
  intent: "manger", position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
  etaFor: () => ({minutes: 10, mode: "transit"}),
}, options));

test("mode « Maintenant » : un lieu fermé est exclu", () => {
  const ouvert = lieu("ouvert", "Mo-Su 09:00-23:00");
  const ferme  = lieu("ferme",  "Mo-Su 19:00-23:00");
  const vus = classer([ouvert, ferme], {nowOnly: true}).map((l) => l.id);
  assert.deepEqual(vus, ["ouvert"]);
});

test("mode « Maintenant » : un lieu ouvert maintenant mais fermé à l’arrivée est exclu", () => {
  // ferme à 12:05, on arrive à 12:10
  const partant = lieu("partant", "Mo-Su 09:00-12:05");
  const vus = classer([partant], {nowOnly: true});
  assert.deepEqual(vus, []);
});

test("hors mode « Maintenant », un lieu fermé reste visible mais en fin de liste", () => {
  const ouvert = lieu("ouvert", "Mo-Su 09:00-23:00");
  const ferme  = lieu("ferme",  "Mo-Su 19:00-23:00", {lat: 50.6301, lng: 3.0601});
  const vus = classer([ouvert, ferme]);
  assert.equal(vus.length, 2);
  // le fermé est plus proche, et pourtant il passe derrière
  assert.equal(vus[0].id, "ouvert");
  assert.equal(vus[1].id, "ferme");
  assert.match(vus[1].rankReason, /Fermé/);
});

test("un lieu définitivement fermé n’est jamais recommandé, même hors mode Maintenant", () => {
  const mort = lieu("mort", "Mo-Su 09:00-23:00", {permanentlyClosed: true});
  const vif  = lieu("vif",  "Mo-Su 09:00-23:00");
  assert.deepEqual(classer([mort, vif]).map((l) => l.id), ["vif"]);
  assert.deepEqual(classer([mort, vif], {nowOnly: true}).map((l) => l.id), ["vif"]);
});

test("les horaires inconnus ne sont pas traités comme une fermeture", () => {
  const inconnu = lieu("inconnu", null);
  const vus = classer([inconnu], {nowOnly: true});
  assert.equal(vus.length, 1);
  assert.equal(vus[0].rankAvailability.status, "unknown");
});

test("la marge minimale déclasse un musée qu’on n’a pas le temps de visiter", () => {
  // arrivée 17:57, fermeture 18:00 : ouvert, mais inutile
  const musee = {id: "musee", titre: "Musée", cat: "musee", lat: 50.631, lng: 3.061,
    quand: "Mo-Su 10:00-18:00"};
  const autre = {id: "autre", titre: "Autre musée", cat: "musee", lat: 50.6315, lng: 3.0615,
    quand: "Mo-Su 10:00-22:00"};
  const vus = rankResults([musee, autre], {
    intent: "culture", position: POSITION, now: paris(2026, 7, 15, 17, 47),
    distanceBetween: distance, etaFor: () => ({minutes: 10, mode: "transit"}),
  });
  assert.equal(vus[0].id, "autre");
  assert.equal(vus.find((l) => l.id === "musee").rankOutlook, "closingSoon");
});

test("la disponibilité complète est exposée aux écrans", () => {
  const vus = classer([lieu("x", "Mo-Su 09:00-23:00")]);
  const dispo = vus[0].rankAvailability;
  assert.equal(dispo.status, "open");
  assert.equal(dispo.closesAtTime, "23:00");
  assert.equal(dispo.label, "Ouvert • ferme à 23:00");
  assert.equal(vus[0].rankReason.startsWith("Ouvert • ferme à 23:00"), true);
});

test("un événement terminé reste exclu, indépendamment des horaires de lieu", () => {
  const fini = {id: "fini", titre: "Concert", cat: "concert", lat: 50.631, lng: 3.061,
    isTemporary: true, startsAt: MERCREDI_MIDI - 3 * 3600000, endsAt: MERCREDI_MIDI - 3600000};
  const vus = rankResults([fini], {
    intent: "sortir", position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
  });
  assert.deepEqual(vus, []);
});
