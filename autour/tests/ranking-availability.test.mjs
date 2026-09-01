import assert from "node:assert/strict";
import test from "node:test";

// l'ordre compte : le classement consulte availability.js et temporel.js
// s'ils sont présents — comme dans la page, où les deux le précèdent
await import("../availability.js");
await import("../temporel.js");
await import("../signaux.js");
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

test("le mode Maintenant réutilise le statut temporel calculé pour chaque candidat", () => {
  const original = globalThis.AutourTemps;
  let appels = 0;
  globalThis.AutourTemps = Object.assign({}, original, {
    statutTemporel(...args) {
      appels += 1;
      return original.statutTemporel(...args);
    },
  });
  try {
    classer([
      lieu("ouvert-1", "Mo-Su 09:00-23:00"),
      lieu("ouvert-2", "Mo-Su 09:00-23:00", {lat: 50.632, lng: 3.062}),
    ], {nowOnly: true});
  } finally {
    globalThis.AutourTemps = original;
  }
  assert.equal(appels, 2, "un calcul par candidat, pas un second passage de filtre");
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

test("les horaires inconnus ne sont pas traités comme une ouverture", () => {
  const inconnu = lieu("inconnu", null);
  const vus = classer([inconnu], {nowOnly: true});
  assert.equal(vus.length, 0);
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

test("entre événements comparables, la date passe franchement avant la distance", () => {
  const toutProchePlusTard = Object.assign(
    evenement("plus-tard-tout-proche", MERCREDI_MIDI + 10 * 86400000),
    {lat: 50.6301, lng: 3.0601});
  const demainPlusLoin = Object.assign(
    evenement("demain-plus-loin", MERCREDI_MIDI + 24 * 3600000),
    {lat: 50.6400, lng: 3.0700});
  const vus = classerSorties([toutProchePlusTard, demainPlusLoin]);
  assert.deepEqual(vus.map((l) => l.id), ["demain-plus-loin", "plus-tard-tout-proche"]);
  assert.ok(vus[0].rankDistance > vus[1].rankDistance,
    "l'événement prioritaire est volontairement le plus éloigné");
});

test("le 18 août remonte avant les événements des 9 et 27 septembre", () => {
  const maintenant = paris(2026, 8, 10, 21, 45);
  const aout18 = evenement("18-aout", paris(2026, 8, 18, 10, 0));
  const septembre9 = evenement("9-septembre", paris(2026, 9, 9, 15, 0));
  const septembre27 = evenement("27-septembre", paris(2026, 9, 27, 14, 0));
  const vus = classerSorties([septembre27, septembre9, aout18], {now: maintenant});
  assert.deepEqual(vus.map((l) => l.id), ["18-aout", "9-septembre", "27-septembre"]);
});

test("un événement lointain ne se prétend pas faisable en partant maintenant", () => {
  const dansTroisMois = evenement("dans-3-mois", MERCREDI_MIDI + 90 * 86400000);
  const vus = classerSorties([dansTroisMois]);
  assert.equal(vus[0].rankOutlook, "scheduled");
  assert.equal(vus[0].rankSection, "a_venir");
  assert.doesNotMatch(vus[0].rankReason, /min avant le début/);
  assert.match(vus[0].rankReason, /oct\./);
});

test("un événement dans plusieurs mois ne passe plus devant un lieu ouvert", () => {
  const permanent = {id: "bar-ouvert", titre: "Le Bar", cat: "bar",
    lat: 50.6305, lng: 3.0605, quand: "Mo-Su 08:00-02:00", note: 4.8, avis: 900};
  const lointain = Object.assign(
    evenement("festival-lointain", MERCREDI_MIDI + 90 * 86400000),
    {lat: 50.6301, lng: 3.0601});
  const vus = classerSorties([lointain, permanent]);
  assert.equal(vus[0].id, "bar-ouvert");
});

test("la prochaine occurrence réelle participe au tri des séries", () => {
  const recurrent = {
    id: "recurrent", titre: "Atelier récurrent", cat: "concert",
    lat: 50.640, lng: 3.070, isTemporary: true,
    occurrences: [
      {start: MERCREDI_MIDI - 7 * 86400000, end: MERCREDI_MIDI - 7 * 86400000 + 3600000},
      {start: MERCREDI_MIDI + 10 * 86400000, end: MERCREDI_MIDI + 10 * 86400000 + 3600000},
    ],
  };
  const plusTard = evenement("plus-tard", MERCREDI_MIDI + 20 * 86400000,
    {lat: 50.6301, lng: 3.0601});
  const vus = classerSorties([plusTard, recurrent]);
  assert.deepEqual(vus.map((l) => l.id), ["recurrent", "plus-tard"]);
  assert.equal(vus[0].rankStart, MERCREDI_MIDI + 10 * 86400000);
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

/* ---- Contraintes dures et préférences ------------------------------------
   Une contrainte exclut, une préférence ordonne, et une donnée inconnue n'est
   jamais un « non ». */

const lieuSignal = (id, extra) => Object.assign({
  id, titre: "Lieu " + id, cat: "cafe", lat: 50.631, lng: 3.061, quand: "Mo-Su 08:00-23:00",
}, extra);

const classerAvec = (items, intention, options) => rankResults(items, Object.assign({
  intent: "sortir", intention,
  categories: ["cafe", "biblio", "resto", "parc", "bar", "coworking"],
  position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
}, options));

const intentionVide = () => ({ categories: [], intentions: [], ambiance: [],
  budget: { max: null, gratuit: false, pasCher: false },
  horaire: { creneau: null, tard: false, apres: null, avant: null },
  groupe: null, contraintes: [], preferences: [], cuisine: null, chips: [] });

test("un budget demandé exclut ce qu’on sait trop cher, pas ce qu’on ignore", () => {
  const cher = lieuSignal("cher", { cat: "resto", prixN: 4 });     // ≈ 80 €
  const abordable = lieuSignal("abordable", { cat: "resto", prixN: 1 });
  const inconnu = lieuSignal("inconnu", { cat: "resto" });
  const intention = Object.assign(intentionVide(),
    { contraintes: [{ type: "budget", max: 15 }] });
  const vus = classerAvec([cher, abordable, inconnu], intention).map((l) => l.id);
  assert.ok(!vus.includes("cher"), "le trop cher est écarté");
  assert.ok(vus.includes("abordable"));
  assert.ok(vus.includes("inconnu"), "prix inconnu : on ne tranche pas");
});

test("une caractéristique inconnue n’écarte jamais un lieu", () => {
  const avec = lieuSignal("avec", { tags: { internet_access: "wlan" } });
  const sans = lieuSignal("sans");
  const intention = Object.assign(intentionVide(),
    { contraintes: [{ type: "signal", id: "wifi", poids: 1 }] });
  const vus = classerAvec([avec, sans], intention);
  assert.equal(vus.length, 2, "aucun n’est exclu : personne ne dit « pas de wifi »");
  // mais celui qui le prouve passe devant
  assert.equal(vus[0].id, "avec");
  assert.ok(vus[0].rankMatched.includes("wifi"));
});

test("la proximité ne fait jamais gagner un lieu hors sujet", () => {
  // une bibliothèque à 2 km bat un bar à 50 m quand on demande à travailler
  const bar = lieuSignal("bar", { cat: "bar", lat: 50.6301, lng: 3.0601 });
  const biblio = lieuSignal("biblio", { cat: "biblio", categories: ["biblio", "library", "study"],
    lat: 50.648, lng: 3.061 });
  const intention = Object.assign(intentionVide(), {
    ambiance: [{ id: "travail", poids: 1 }, { id: "calme", poids: .6 }],
    preferences: [{ type: "signal", id: "travail", poids: 1 }],
  });
  const vus = classerAvec([bar, biblio], intention);
  assert.equal(vus[0].id, "biblio", "l’adéquation passe devant la distance");
  assert.ok(vus[0].rankFit > 0);
});

test("les préférences ordonnent sans exclure", () => {
  const calme = lieuSignal("calme", { cat: "biblio", categories: ["biblio", "library"] });
  const bruyant = lieuSignal("bruyant", { cat: "bar" });
  const intention = Object.assign(intentionVide(),
    { ambiance: [{ id: "calme", poids: 1 }], preferences: [{ type: "signal", id: "calme", poids: 1 }] });
  const vus = classerAvec([calme, bruyant], intention);
  assert.equal(vus.length, 2, "rien n’est exclu par une préférence");
  assert.equal(vus[0].id, "calme");
});

test("« ouvert tard » écarte ce qui ferme tôt, et garde l’horaire inconnu", () => {
  const tard = lieuSignal("tard", { quand: "Mo-Su 08:00-02:00" });
  const tot = lieuSignal("tot", { quand: "Mo-Su 08:00-18:00" });
  const inconnu = lieuSignal("inconnu", { quand: null });
  const intention = Object.assign(intentionVide(),
    { contraintes: [{ type: "ouvertApres", minutes: 21 * 60 }] });
  const vus = classerAvec([tard, tot, inconnu], intention).map((l) => l.id);
  assert.ok(!vus.includes("tot"), "ferme à 18 h : écarté");
  assert.ok(vus.includes("tard"));
  assert.ok(vus.includes("inconnu"), "horaire inconnu : on ne tranche pas");
});

test("« gratuit » n’écarte que ce qu’on sait payant", () => {
  const libre = lieuSignal("libre", { cat: "parc", gratuit: true });
  const payant = lieuSignal("payant", { cat: "musee", gratuit: false, prix: 12 });
  const inconnu = lieuSignal("inconnu", { cat: "parc" });
  const intention = Object.assign(intentionVide(),
    { contraintes: [{ type: "budget", max: 0 }] });
  const vus = classerAvec([libre, payant, inconnu],
    Object.assign(intention, {}), { categories: ["parc", "musee", "cafe"] }).map((l) => l.id);
  assert.ok(!vus.includes("payant"));
  assert.ok(vus.includes("libre"));
  assert.ok(vus.includes("inconnu"));
});

/* ---- Finition : l'éphémère, la saison, les établissements fermés --------- */

test("un événement en cours passe devant un lieu permanent mieux noté", () => {
  // c'est la différence avec une carte classique : ce qui a lieu maintenant
  // vaut plus qu'un très bon endroit ouvert toute l'année
  const permanent = {id: "bar", titre: "Le Bar Étoilé", cat: "bar",
    lat: 50.6305, lng: 3.0605, quand: "Mo-Su 08:00-02:00", note: 4.8, avis: 900};
  const enCours = {id: "concert", titre: "Concert", cat: "concert", isTemporary: true,
    lat: 50.635, lng: 3.065,               // plus loin
    startsAt: MERCREDI_MIDI - 3600000, endsAt: MERCREDI_MIDI + 3600000};
  const vus = rankResults([permanent, enCours], {
    intent: "sortir", position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
    etaFor: () => ({minutes: 8, mode: "walk"}),
  });
  assert.equal(vus[0].id, "concert", "l’éphémère en cours passe devant");
});

test("un événement de ce soir passe devant un permanent, hors mode Maintenant", () => {
  const permanent = {id: "bar", titre: "Le Bar", cat: "bar", lat: 50.6305, lng: 3.0605,
    quand: "Mo-Su 08:00-02:00", note: 4.7, avis: 500};
  const ceSoir = {id: "soir", titre: "Concert de ce soir", cat: "concert", isTemporary: true,
    lat: 50.632, lng: 3.062,
    startsAt: paris(2026, 7, 15, 20, 0), endsAt: paris(2026, 7, 15, 23, 30)};
  const vus = rankResults([permanent, ceSoir], {
    intent: "sortir", position: POSITION, now: paris(2026, 7, 15, 18, 30),
    distanceBetween: distance, etaFor: () => ({minutes: 6, mode: "walk"}),
  });
  assert.equal(vus[0].id, "soir");
});

test("la saison ordonne sans exclure, et n’agit que sur ce qui est connu", () => {
  const terrasse = {id: "terrasse", titre: "Café des Arbres", cat: "cafe",
    lat: 50.631, lng: 3.061, quand: "Mo-Su 08:00-23:00", tags: {outdoor_seating: "yes"}};
  const couvert = {id: "couvert", titre: "Salon de thé", cat: "cafe",
    lat: 50.631, lng: 3.061, quand: "Mo-Su 08:00-23:00", tags: {indoor_seating: "yes"}};
  const classer2 = (saison) => rankResults([terrasse, couvert], {
    intent: "manger", position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
    categories: ["cafe"], saison,
  }).map((l) => l.id);

  assert.equal(classer2({dehors: .35, interieur: -.15})[0], "terrasse", "été");
  assert.equal(classer2({dehors: -.3, interieur: .3})[0], "couvert", "hiver");
  // aucun n’est exclu, dans les deux cas
  assert.equal(classer2({dehors: -.3, interieur: .3}).length, 2);
  // un lieu sans signal connu n’est ni favorisé ni pénalisé
  const neutre = {id: "neutre", titre: "Snack", cat: "fastfood", lat: 50.631, lng: 3.061};
  const avec = rankResults([neutre], {intent: "manger", position: POSITION,
    now: MERCREDI_MIDI, distanceBetween: distance, saison: {dehors: -.3}});
  const sans = rankResults([neutre], {intent: "manger", position: POSITION,
    now: MERCREDI_MIDI, distanceBetween: distance});
  assert.equal(avec[0].rankScore, sans[0].rankScore, "aucun effet sans donnée");
});

test("un lieu hors service est relégué, jamais supprimé", () => {
  const college = {id: "college", titre: "Collège Victor Hugo", cat: "ecole",
    lat: 50.631, lng: 3.061, quand: "Mo-Fr 08:00-18:00"};
  const biblio = {id: "biblio", titre: "Médiathèque", cat: "biblio",
    lat: 50.640, lng: 3.070, quand: "Mo-Sa 10:00-19:00"};
  const vus = rankResults([college, biblio], {
    intent: "etudier", categories: ["ecole", "biblio", "study"],
    position: POSITION, now: MERCREDI_MIDI, distanceBetween: distance,
    horsService: (l) => l.cat === "ecole",
  });
  assert.equal(vus.length, 2, "il reste dans les résultats");
  assert.equal(vus[0].id, "biblio", "mais derrière ce qui est réellement ouvert");
});
