import assert from "node:assert/strict";
import test from "node:test";

/* Cette suite traverse les contrats, plutôt que de tester un écran isolé :
   les surfaces peuvent pondérer différemment, mais elles doivent partir du
   même état temporel, d'ouverture et de taxonomie. */
await import("../availability.js");
await import("../temporel.js");
await import("../core.js");
await import("../annonces-taxonomie.js");
await import("../annonces-classement.js");
await import("../maintenant.js");

const T = globalThis.AutourTemps;
const A = globalThis.AutourAvailability;
const C = globalThis.AutourCore;
const M = globalThis.AutourMaintenant;
const P = globalThis.AutourAnnoncesClassement;

const NOW = Date.parse("2026-08-14T14:00:00+02:00"); // vendredi, 14 h à Paris

const evenement = (extra = {}) => Object.assign({
  id: "evt-global",
  title: "Concert du vendredi",
  category: "concert",
  isTemporary: true,
  entity_type: "event",
  timezone: "Europe/Paris",
  start_at: "2026-08-14T21:00:00",
  end_at: "2026-08-14T23:00:00",
  date_confidence: "exact",
  announcement_tags: ["rap"],
}, extra);

test("un événement garde le même état canonique pour Maintenant, les fenêtres, Pour toi et la fiche", () => {
  const event = evenement();
  const etat = T.etatTemporalEvenement(event, NOW);
  assert.equal(etat.status, "tonight");
  assert.equal(T.estMaintenant(etat.status), false);
  assert.equal(T.estDansFenetre(event, T.fenetreSurface("soir", NOW, event.timezone), NOW), true);
  assert.equal(T.estDansFenetre(event, T.fenetreSurface("weekend", NOW, event.timezone), NOW), false);
  assert.equal(T.sectionTemporelle(etat, NOW), "ce_soir");
  assert.match(T.libelleDate(event, NOW), /Vendredi 14 août/);
  assert.doesNotMatch(T.libelleTemporel(event, NOW), /Terminé|Date à vérifier/);

  const pourToi = P.classerPourToi([event], {
    now: NOW,
    interests: ["rap"],
    distanceFor: () => 0,
    metroArea: "mel",
    territorySlug: "tourcoing",
    limit: 3,
  });
  assert.equal(pourToi.length, 1);
  assert.equal(pourToi[0].temporal_status, etat.status);
  assert.equal(pourToi[0].startAt, etat.debut);
  assert.equal(pourToi[0].endAt, etat.finReelle);

  const maintenant = Object.assign({
    estEvenement: true,
    titre: event.title,
    categorie: "concert",
    canonical_id: event.id,
    canonical: event,
    tempsValide: true,
    debutLe: etat.debut,
    finLe: etat.finReelle,
    lat: 50.7,
    lng: 3.1,
  }, event);
  assert.equal(M.fiable(maintenant, {maintenant: NOW, position: [50.7, 3.1]}).retenu, false,
    "Maintenant doit refuser le même événement futur");
});

test("une date connue reste une date, et un futur connu ne devient jamais terminé", () => {
  const event = evenement();
  const etat = T.etatTemporalEvenement(event, NOW);
  assert.equal(etat.hasKnownDate, true);
  assert.equal(etat.hasKnownTime, true);
  assert.notEqual(etat.status, "past");
  assert.notEqual(T.libelleDate(event, NOW), "Date à vérifier");
  assert.notEqual(T.libelleTemporel(event, NOW), "Terminé");

  const inconnu = evenement({start_at: null, end_at: null, date_confidence: "unknown"});
  const etatInconnu = T.etatTemporalEvenement(inconnu, NOW);
  assert.equal(etatInconnu.status, "unknown");
  assert.equal(T.libelleDate(inconnu, NOW), "Date à vérifier");
  assert.equal(P.classerPourToi([inconnu], {
    now: NOW, interests: ["rap"], distanceFor: () => 0, limit: 3,
  }).length, 0);
});

test("un début connu reste rendu même si la fin manque", () => {
  const event = evenement({end_at: null});
  const etat = T.etatTemporalEvenement(event, NOW);
  assert.equal(etat.status, "tonight");
  assert.deepEqual(etat.dateLocale, {year: 2026, month: 8, day: 14});
  assert.deepEqual(etat.heureLocale, {hour: 21, minute: 0});
  assert.match(T.libelleDate(event, NOW), /Vendredi 14 août/);
  assert.equal(T.libelleTemporel(event, NOW), "Ce soir · 21:00");
  assert.doesNotMatch(T.libelleTemporel(event, NOW), /Date à vérifier/);
});

test("un lieu fermé ou aux horaires inconnus ne devient pas ouvert dans Maintenant", () => {
  const ferme = {
    id: "ferme-global", title: "Le lieu fermé", category: "restaurant",
    opening_hours: "Mo-Su 19:00-23:00", timezone: "Europe/Paris",
  };
  const etatFerme = T.statutTemporel(ferme, NOW, {
    disponibilite: (place, instant) => A.getPlaceAvailability(place, instant),
  });
  assert.equal(etatFerme.openingStatus, "closed");
  assert.notEqual(etatFerme.status, "now");
  assert.equal(C.rankResults([ferme], {
    intent: "manger", position: [50.7, 3.1], now: NOW, nowOnly: true,
    radius: 5000, distanceBetween: () => 0, etaFor: () => ({minutes: 5}),
  }).length, 0);

  const inconnu = {id: "inconnu-global", title: "Le lieu sans horaires", category: "restaurant"};
  const etatInconnu = T.statutTemporel(inconnu, NOW, {
    disponibilite: (place, instant) => A.getPlaceAvailability(place, instant),
  });
  assert.equal(etatInconnu.openingStatus, "unknown");
  assert.notEqual(etatInconnu.openingStatus, "open_now");
});

test("la diversité food lit la même catégorie et la même spécialité canonique", () => {
  const burger = C.toCommonItem({
    id: "burger", title: "Burger du centre", category: "restaurant", cuisine: "burger",
    isTemporary: false, openingHours: "Mo-Su 09:00-23:00",
  });
  const pizza = C.toCommonItem({
    id: "pizza", title: "Pizza du centre", category: "restaurant", cuisine: "pizza",
    isTemporary: false, openingHours: "Mo-Su 09:00-23:00",
  });
  assert.equal(burger.canonicalCategory, "resto");
  assert.equal(pizza.canonicalCategory, "resto");
  assert.equal(burger.foodSpecialty, "burger");
  assert.equal(pizza.foodSpecialty, "pizza");
  assert.equal(C.familleDiversite(burger), "manger");
  assert.equal(C.familleDiversite(pizza), "manger");
  assert.notEqual(C.sousCategorieDe(burger), C.sousCategorieDe(pizza));
});

test("les trois propositions Maintenant restent nommées et bornées", () => {
  const base = {
    estEvenement: true, entity_type: "event", categorie: "concert", category: "concert",
    canonical_id: "id", canonical: {entity_type: "event", category: "concert", id: "id"},
    tempsValide: true, debutLe: NOW - 3600000, finLe: NOW + 3600000,
    lat: 50.7, lng: 3.1,
  };
  const items = Array.from({length: 10}, (_, index) => Object.assign({}, base, {
    id: "id-" + index, canonical_id: "id-" + index,
    canonical: {entity_type: "event", category: "concert", id: "id-" + index},
    titre: "Proposition " + index, title: "Proposition " + index,
  }));
  const choix = M.selection(items, {maintenant: NOW, position: [50.7, 3.1], positionConnue: true});
  assert.ok(choix.length <= 3);
  assert.ok(choix.every((item) => M.nomExploitable(item.titre || item.title)));
});
