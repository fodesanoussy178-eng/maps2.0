import assert from "node:assert/strict";
import test from "node:test";

await import("../availability.js");

const {getPlaceAvailability, parseOpeningHours, marginFor, isFrenchHoliday} = globalThis.AutourAvailability;

/* Instant UTC correspondant à une heure murale parisienne. Les tests doivent
   valoir été comme hiver : c'est tout l'enjeu du fuseau local. */
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

const MIN = 60000;
// 2026-07-15 est un mercredi, 2026-07-19 un dimanche
const MERCREDI_MIDI = paris(2026, 7, 15, 12, 0);

test("lieu ouvert : statut, heure de fermeture et libellé", () => {
  const vu = getPlaceAvailability({cat: "resto", quand: "Mo-Su 09:00-23:30"}, MERCREDI_MIDI);
  assert.equal(vu.status, "open");
  assert.equal(vu.isOpenNow, true);
  assert.equal(vu.closesAtTime, "23:30");
  assert.equal(vu.label, "Ouvert · ferme à 23h30");
});

test("lieu fermé maintenant mais qui ouvre plus tard aujourd’hui", () => {
  const vu = getPlaceAvailability({cat: "cinema", quand: "Mo-Su 14:00-23:00"}, MERCREDI_MIDI);
  assert.equal(vu.status, "closed");
  assert.equal(vu.isOpenNow, false);
  assert.equal(vu.opensAtTime, "14:00");
  assert.equal(vu.label, "Fermé · ouvre à 14h");
});

test("lieu fermé pour la journée mais ouvert demain", () => {
  // fermé le mercredi, ouvert le jeudi
  const vu = getPlaceAvailability({cat: "musee", quand: "Th-Su 10:00-18:00"}, MERCREDI_MIDI);
  assert.equal(vu.status, "closed");
  assert.equal(vu.label, "Fermé aujourd’hui");
  assert.match(vu.reason, /Ouvre demain à 10h/);
});

test("lieu fermé plusieurs jours : le jour de réouverture est nommé", () => {
  // mercredi midi, ouvert seulement le lundi
  const vu = getPlaceAvailability({cat: "musee", quand: "Mo 09:00-17:00"}, MERCREDI_MIDI);
  assert.equal(vu.status, "closed");
  assert.equal(vu.label, "Fermé · ouvre lundi à 9h");
});

test("horaires inconnus : jamais « Ouvert » par défaut", () => {
  for (const lieu of [{cat: "biblio"}, {cat: "biblio", quand: "Voir sur place"},
                      {cat: "biblio", quand: "Mo sunrise-sunset"}]) {
    const vu = getPlaceAvailability(lieu, MERCREDI_MIDI);
    assert.equal(vu.status, "unknown");
    assert.equal(vu.isOpenNow, false);
    assert.equal(vu.label, "Horaires non renseignés");
    assert.equal(vu.isOpenAtArrival, null);
  }
});

test("fermeture à minuit : ouvert à 23:50, fermé à 00:10", () => {
  const lieu = {cat: "bar", quand: "Mo-Su 18:00-00:00"};
  assert.equal(getPlaceAvailability(lieu, paris(2026, 7, 15, 23, 50)).isOpenNow, true);
  const apres = getPlaceAvailability(lieu, paris(2026, 7, 16, 0, 10));
  assert.equal(apres.isOpenNow, false);
  assert.equal(apres.label, "Fermé · ouvre à 18h");
});

test("horaires qui dépassent minuit : la plage de la veille compte", () => {
  const lieu = {cat: "bar", quand: "Mo-Su 22:00-02:00"};
  // 01:00 jeudi relève de la plage ouverte mercredi soir
  const nuit = getPlaceAvailability(lieu, paris(2026, 7, 16, 1, 0));
  assert.equal(nuit.isOpenNow, true);
  assert.equal(nuit.closesAtTime, "02:00");
  // 03:00 : fermé, rouvre le soir même
  const apres = getPlaceAvailability(lieu, paris(2026, 7, 16, 3, 0));
  assert.equal(apres.isOpenNow, false);
  assert.equal(apres.opensAtTime, "22:00");
});

test("dimanche : une fermeture dominicale est respectée", () => {
  const dimanche = paris(2026, 7, 19, 12, 0);
  const vu = getPlaceAvailability({cat: "commerce", quand: "Mo-Sa 09:00-19:00; Su off"}, dimanche);
  assert.equal(vu.isOpenNow, false);
  // rouvre lundi, c'est-à-dire demain : le libellé du jour, pas du nom du jour
  assert.equal(vu.label, "Fermé aujourd’hui");
  assert.match(vu.reason, /Ouvre demain à 9h/);
  const ouvertDimanche = getPlaceAvailability({cat: "parc", quand: "Su 10:00-20:00"}, dimanche);
  assert.equal(ouvertDimanche.isOpenNow, true);
});

test("jours fériés : « PH off » ferme le 14 juillet", () => {
  assert.equal(isFrenchHoliday(2026, 7, 14), true);
  assert.equal(isFrenchHoliday(2026, 7, 15), false);
  assert.equal(isFrenchHoliday(2026, 4, 6), true);    // lundi de Pâques 2026

  const lieu = {cat: "musee", quand: "Mo-Su 10:00-18:00; PH off"};
  const ferie = getPlaceAvailability(lieu, paris(2026, 7, 14, 12, 0));
  assert.equal(ferie.isOpenNow, false);
  const lendemain = getPlaceAvailability(lieu, paris(2026, 7, 15, 12, 0));
  assert.equal(lendemain.isOpenNow, true);
});

test("fermé maintenant mais ouvert à l’arrivée", () => {
  const lieu = {cat: "cinema", quand: "Mo-Su 14:00-23:00"};
  const vu = getPlaceAvailability(lieu, MERCREDI_MIDI, MERCREDI_MIDI + 150 * MIN);  // 14:30
  assert.equal(vu.isOpenNow, false);
  assert.equal(vu.isOpenAtArrival, true);
  assert.equal(vu.meetsMargin, true);
});

test("ouvert maintenant mais fermé à l’arrivée", () => {
  const lieu = {cat: "musee", quand: "Mo-Su 10:00-13:00"};
  const vu = getPlaceAvailability(lieu, MERCREDI_MIDI, MERCREDI_MIDI + 90 * MIN);   // 13:30
  assert.equal(vu.isOpenNow, true);
  assert.equal(vu.isOpenAtArrival, false);
  assert.equal(vu.meetsMargin, false);
});

test("le musée qui ferme à 18:00 n’est pas « faisable » à 17:57", () => {
  const musee = {cat: "musee", quand: "Mo-Su 10:00-18:00"};
  const arrivee = paris(2026, 7, 15, 17, 57);
  const vu = getPlaceAvailability(musee, MERCREDI_MIDI, arrivee);
  assert.equal(vu.isOpenAtArrival, true);       // techniquement ouvert…
  assert.equal(vu.meetsMargin, false);          // …mais inutile d'y aller
  assert.match(vu.reason, /Ferme 3 min après votre arrivée/);

  // une arrivée à 16:30 laisse 90 min : au-delà de la marge de 60 min
  const tot = getPlaceAvailability(musee, MERCREDI_MIDI, paris(2026, 7, 15, 16, 30));
  assert.equal(tot.meetsMargin, true);
});

test("la marge minimale dépend du type de lieu", () => {
  assert.equal(marginFor({cat: "resto"}), 45);
  assert.equal(marginFor({cat: "musee"}), 60);
  assert.equal(marginFor({cat: "commerce"}), 20);
  assert.equal(marginFor({cat: "parc"}), 15);
  assert.equal(marginFor({cat: "inconnu"}), 30);
  assert.equal(marginFor({cat: "resto", minimumMargin: 5}), 5);
});

test("fermeture imminente : statut closing_soon", () => {
  const vu = getPlaceAvailability({cat: "resto", quand: "Mo-Su 09:00-12:30"}, MERCREDI_MIDI);
  assert.equal(vu.status, "closing_soon");
  assert.match(vu.reason, /Ferme dans 30 min/);
});

test("ouverture imminente : statut opening_soon", () => {
  const vu = getPlaceAvailability({cat: "resto", quand: "Mo-Su 12:30-23:00"}, MERCREDI_MIDI);
  assert.equal(vu.status, "opening_soon");
  assert.equal(vu.opensAtTime, "12:30");
});

test("fermeture temporaire : distincte d’un lieu simplement fermé", () => {
  const vu = getPlaceAvailability({cat: "resto", temporarilyClosed: true, closureReason: "Travaux"}, MERCREDI_MIDI);
  assert.equal(vu.status, "closed");
  assert.equal(vu.label, "Fermé temporairement");
  assert.equal(vu.reason, "Travaux");
});

test("fermeture définitive : statut propre et jamais recommandable", () => {
  const vu = getPlaceAvailability({cat: "resto", permanentlyClosed: true}, MERCREDI_MIDI);
  assert.equal(vu.status, "permanently_closed");
  assert.equal(vu.isOpenNow, false);
  assert.equal(vu.isOpenAtArrival, false);
  assert.equal(vu.label, "Définitivement fermé");
});

test("un booléen « ouvert » sans grille ne sert jamais à juger l’arrivée", () => {
  const vu = getPlaceAvailability({cat: "resto", ouvert: true}, MERCREDI_MIDI, MERCREDI_MIDI + 60 * MIN);
  assert.equal(vu.status, "open");
  assert.equal(vu.isOpenNow, true);
  assert.equal(vu.isOpenAtArrival, null);       // inconnu, et pas « vrai »
  assert.match(vu.reason, /non renseignés/);
});

test("l’heure est celle du lieu, pas celle du serveur", () => {
  const lieu = {cat: "resto", quand: "Mo-Su 09:00-18:00", timezone: "Pacific/Auckland"};
  // 2026-07-15 12:00 à Paris = 22:00 à Auckland : fermé là-bas
  const vu = getPlaceAvailability(lieu, MERCREDI_MIDI);
  assert.equal(vu.isOpenNow, false);
  assert.equal(vu.timeZone, "Pacific/Auckland");
});

test("le passage à l’heure d’hiver ne décale pas les horaires", () => {
  // même règle, un jour de janvier (CET) et un jour de juillet (CEST)
  const lieu = {cat: "resto", quand: "Mo-Su 09:00-18:00"};
  assert.equal(getPlaceAvailability(lieu, paris(2026, 1, 14, 9, 30)).isOpenNow, true);
  assert.equal(getPlaceAvailability(lieu, paris(2026, 1, 14, 8, 30)).isOpenNow, false);
  assert.equal(getPlaceAvailability(lieu, paris(2026, 7, 15, 9, 30)).isOpenNow, true);
  assert.equal(getPlaceAvailability(lieu, paris(2026, 7, 15, 8, 30)).isOpenNow, false);
});

test("la source des horaires suit l’ordre de priorité annoncé", () => {
  const vu = getPlaceAvailability({
    cat: "resto",
    openingHoursExplicit: "Mo-Su 08:00-10:00",
    tags: {opening_hours: "Mo-Su 20:00-23:00"},
  }, MERCREDI_MIDI);
  assert.equal(vu.source, "explicite");
  // la grille explicite prime : à midi on est fermé, et la réouverture est
  // celle de la grille explicite (08:00 demain), pas celle du tag OSM (20:00)
  assert.equal(vu.isOpenNow, false);
  assert.equal(vu.opensAtTime, "08:00");
});

test("parseOpeningHours refuse ce qu’il ne sait pas lire", () => {
  assert.equal(parseOpeningHours("Mo sunrise-sunset"), null);
  assert.equal(parseOpeningHours("week 1-53/2 Mo 09:00-12:00"), null);
  assert.equal(parseOpeningHours(""), null);
  assert.equal(parseOpeningHours(null), null);
  assert.ok(parseOpeningHours("24/7"));
});
