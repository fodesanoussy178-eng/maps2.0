import assert from "node:assert/strict";
import test from "node:test";

// l'ordre compte : le classement consulte availability.js et temporel.js
// s'ils sont présents — comme dans la page, où les deux le précèdent
await import("../availability.js");
await import("../temporel.js");
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

/* ---- Le temps se tranche avant la pertinence -----------------------------
   La proximité ne doit jamais suffire à faire remonter un événement futur
   dans « maintenant » : c'est exactement ce que faisait l'ancien classement. */

const evenement = (id, debut, extra) => Object.assign({
  id, titre: "Événement " + id, cat: "concert", lat: 50.6301, lng: 3.0601,
  isTemporary: true, startsAt: debut, endsAt: debut == null ? null : debut + 2 * 3600000,
}, extra);

const classerSorties = (items, options) => rankResults(items, Object.assign({
  intent: "sortir", position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
  etaFor: () => ({minutes: 5, mode: "walk"}),
}, options));

test("en mode Maintenant, un événement dans trois mois est écarté même s’il est à cinquante mètres", () => {
  const loin = evenement("dans-3-mois", MERCREDI_MIDI + 90 * 86400000);
  const encours = Object.assign(evenement("en-cours", MERCREDI_MIDI - 3600000),
    {lat: 50.70, lng: 3.20});   // bien plus loin
  const vus = classerSorties([loin, encours], {nowOnly: true});
  assert.deepEqual(vus.map((l) => l.id), ["en-cours"]);
});

test("en mode Maintenant, un événement sans date exploitable n’est jamais « maintenant »", () => {
  const sansDate = evenement("sans-date", null);
  assert.deepEqual(classerSorties([sansDate], {nowOnly: true}), []);
});

test("un événement qui commence dans trente minutes reste dans Maintenant", () => {
  const bientot = evenement("bientot", MERCREDI_MIDI + 30 * 60000);
  const vus = classerSorties([bientot], {nowOnly: true});
  assert.deepEqual(vus.map((l) => l.id), ["bientot"]);
  assert.equal(vus[0].rankTemporal, "starting_soon");
  assert.equal(vus[0].rankStart, MERCREDI_MIDI + 30 * 60000);
});

test("hors mode Maintenant, un événement futur est routé vers une section", () => {
  const ceSoir = evenement("ce-soir", paris(2026, 7, 15, 21, 0));
  const plusTard = evenement("dans-3-mois", MERCREDI_MIDI + 90 * 86400000);
  const vus = classerSorties([ceSoir, plusTard]);
  const par = Object.fromEntries(vus.map((l) => [l.id, l.rankSection]));
  assert.equal(par["ce-soir"], "ce_soir");
  assert.equal(par["dans-3-mois"], "a_venir");
});

test("un événement récurrent est daté sur sa prochaine occurrence", () => {
  const hebdo = {
    id: "hebdo", titre: "Marché", cat: "concert", lat: 50.631, lng: 3.061, isTemporary: true,
    occurrences: [
      {start: MERCREDI_MIDI - 7 * 86400000, end: MERCREDI_MIDI - 7 * 86400000 + 3600000},
      {start: MERCREDI_MIDI + 45 * 60000, end: MERCREDI_MIDI + 45 * 60000 + 3600000},
      {start: MERCREDI_MIDI + 7 * 86400000, end: MERCREDI_MIDI + 7 * 86400000 + 3600000},
    ],
  };
  const vus = classerSorties([hebdo], {nowOnly: true});
  assert.equal(vus.length, 1);
  assert.equal(vus[0].rankStart, MERCREDI_MIDI + 45 * 60000);
  assert.equal(vus[0].rankTemporal, "starting_soon");
  // l'arrivée se juge sur l'occurrence, pas sur la première séance de la série
  assert.match(vus[0].rankReason, /avant le début/);
});
