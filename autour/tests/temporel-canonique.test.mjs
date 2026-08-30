import test from "node:test";
import assert from "node:assert/strict";
import "../temporel.js";

const T = globalThis.AutourTemps;
const {STATUTS} = T;

/* Même instant de référence que temporel.test.mjs : un mardi 12 août 2025,
   14 h 00 à Paris. */
const MAINTENANT = Date.parse("2025-08-12T14:00:00+02:00");
const H = 3600 * 1000;
const J = 24 * H;

/* Un événement de la couche canonique : il porte `temporalStatus`, calculé par
   Postgres. Tout l'objet de ces tests est de vérifier que le navigateur
   n'invente rien par-dessus. */
const canonique = (statutBase, extra) => Object.assign({
  id: "c", titre: "Événement", isTemporary: true, timezone: "Europe/Paris",
  temporalStatus: statutBase,
}, extra);

const statut = (item, quand) =>
  T.statutTemporel(item, quand == null ? MAINTENANT : quand).statut;

/* ======================================================================== */
/*  Le verdict de la base fait autorité                                     */
/* ======================================================================== */

test("« now » est repris tel quel", () => {
  assert.equal(statut(canonique("now", {debutLe: MAINTENANT - H, finLe: MAINTENANT + H})),
    STATUTS.EN_COURS);
});

test("un événement canonique court reste maintenant sans horaire d'ouverture", () => {
  const etat = T.statutTemporel(canonique("now", {
    debutLe: MAINTENANT - H,
    finLe: MAINTENANT + H,
  }), MAINTENANT);
  assert.equal(etat.statut, STATUTS.EN_COURS);
  assert.equal(etat.periodeLongue, undefined);
});

test("une période canonique longue ouverte peut apparaître maintenant", () => {
  const etat = T.statutTemporel(canonique("now", {
    debutLe: MAINTENANT - 10 * J,
    finLe: MAINTENANT + 10 * J,
  }), MAINTENANT, {disponibilite: () => ({status: "open", isOpenNow: true})});
  assert.equal(etat.statut, STATUTS.EN_COURS);
  assert.equal(etat.periodeLongue, true);
});

test("une période canonique longue fermée est rejetée de maintenant", () => {
  const etat = T.statutTemporel(canonique("now", {
    debutLe: MAINTENANT - 10 * J,
    finLe: MAINTENANT + 10 * J,
  }), MAINTENANT, {disponibilite: () => ({status: "closed", isOpenNow: false})});
  assert.equal(T.estMaintenant(etat.statut), false);
  assert.equal(etat.statut, STATUTS.PLUS_TARD);
});

test("une période canonique longue aux horaires inconnus est rejetée de maintenant", () => {
  const etat = T.statutTemporel(canonique("now", {
    debutLe: MAINTENANT - 10 * J,
    finLe: MAINTENANT + 10 * J,
  }), MAINTENANT, {disponibilite: () => ({status: "unknown"})});
  assert.equal(T.estMaintenant(etat.statut), false);
  assert.equal(etat.statut, STATUTS.INCONNU);
});

test("« past » est repris tel quel", () => {
  assert.equal(statut(canonique("past", {debutLe: MAINTENANT - 3 * H, finLe: MAINTENANT - H})),
    STATUTS.PASSE);
});

test("« unknown_date » est repris tel quel, même avec des dates dans l'objet", () => {
  // Le statut canonique et la confiance de date sont les verdicts de la base :
  // le navigateur ne doit pas les « rattraper » depuis des bornes héritées.
  assert.equal(statut(canonique("unknown_date", {
    debutLe: MAINTENANT - H, finLe: MAINTENANT + H,
  })),
    STATUTS.INCONNU);
});

/* ---- La règle absolue : un événement futur n'est jamais « maintenant » -- */

test("« soon » n'est JAMAIS maintenant, même à dix minutes du début", () => {
  const etat = T.statutTemporel(
    canonique("soon", {debutLe: MAINTENANT + 10 * 60000, finLe: MAINTENANT + 2 * H}),
    MAINTENANT);
  assert.equal(T.estMaintenant(etat.statut), false,
    "la base a dit « soon » : le navigateur ne doit pas le promouvoir en imminent");
  assert.equal(etat.statut, STATUTS.PLUS_TARD);
});

test("« upcoming » n'est jamais maintenant non plus", () => {
  const etat = T.statutTemporel(
    canonique("upcoming", {debutLe: MAINTENANT + 5 * J, finLe: MAINTENANT + 5 * J + 2 * H}),
    MAINTENANT);
  assert.equal(T.estMaintenant(etat.statut), false);
  assert.equal(etat.statut, STATUTS.A_VENIR);
});

test("aucun statut canonique ne peut produire « imminent »", () => {
  for (const s of ["now", "soon", "upcoming", "past", "unknown_date"]) {
    const etat = T.statutTemporel(
      canonique(s, {debutLe: MAINTENANT + 30 * 60000, finLe: MAINTENANT + 2 * H}), MAINTENANT);
    assert.notEqual(etat.statut, STATUTS.IMMINENT,
      `« ${s} » ne doit pas devenir imminent : la fenêtre d'imminence est une notion locale`);
  }
});

test("seul « now » ouvre la porte de Maintenant", () => {
  const dedans = ["now"].filter((s) =>
    T.estMaintenant(T.statutTemporel(
      canonique(s, {debutLe: MAINTENANT - H, finLe: MAINTENANT + H}), MAINTENANT).statut));
  const dehors = ["soon", "upcoming", "past"].filter((s) =>
    T.estMaintenant(T.statutTemporel(
      canonique(s, {debutLe: MAINTENANT - H, finLe: MAINTENANT + H}), MAINTENANT).statut));
  assert.deepEqual(dedans, ["now"]);
  assert.deepEqual(dehors, []);
});

/* ---- Ce qui reste une décision locale ----------------------------------- */

test("« soon » et « upcoming » sont rangés par la date, dans le fuseau du lieu", () => {
  // ce soir, 21 h : même journée locale → « plus tard aujourd'hui »
  const ceSoir = T.statutTemporel(
    canonique("soon", {debutLe: Date.parse("2025-08-12T21:00:00+02:00")}), MAINTENANT);
  assert.equal(ceSoir.statut, STATUTS.PLUS_TARD);
  assert.equal(T.sectionTemporelle(ceSoir, MAINTENANT), "ce_soir");

  // samedi : le week-end, pas « à venir » en vrac
  const samedi = T.statutTemporel(
    canonique("upcoming", {debutLe: Date.parse("2025-08-16T16:00:00+02:00")}), MAINTENANT);
  assert.equal(samedi.statut, STATUTS.A_VENIR);
  assert.equal(T.sectionTemporelle(samedi, MAINTENANT), "ce_week_end");
});

test("« ce week-end » désigne le week-end civil courant, jamais le suivant", () => {
  const samediMidi = Date.parse("2025-08-23T12:00:00+02:00");
  const courant = T.statutTemporel(canonique("upcoming", {
    debutLe: Date.parse("2025-08-23T16:00:00+02:00"),
    finLe: Date.parse("2025-08-23T18:00:00+02:00"),
  }), samediMidi);
  const suivant = T.statutTemporel(canonique("upcoming", {
    debutLe: Date.parse("2025-08-30T16:00:00+02:00"),
    finLe: Date.parse("2025-08-30T18:00:00+02:00"),
  }), samediMidi);
  assert.equal(T.sectionTemporelle(courant, samediMidi), "ce_week_end");
  assert.equal(T.sectionTemporelle(suivant, samediMidi), "a_venir");
});

test("un statut canonique incohérent ne fabrique pas « maintenant »", () => {
  const futur = canonique("now", {
    debutLe: MAINTENANT + H,
    finLe: MAINTENANT + 2 * H,
  });
  assert.notEqual(statut(futur), STATUTS.EN_COURS);
  assert.equal(statut(canonique("now", {debutLe: MAINTENANT - H})), STATUTS.INCONNU);
  assert.equal(statut(canonique("now", {
    debutLe: MAINTENANT - 2 * H,
    finLe: MAINTENANT - H,
  })), STATUTS.PASSE);
  assert.equal(statut(canonique("now", {
    debutLe: MAINTENANT - H,
    finLe: MAINTENANT + H,
    cancelled: true,
  })), STATUTS.PASSE);
});

test("un « soon » sans date exploitable retombe sur inconnu, pas sur à venir", () => {
  assert.equal(statut(canonique("soon", {})), STATUTS.INCONNU);
});

test("l'état canonique se souvient du verdict de la base", () => {
  const etat = T.statutTemporel(
    canonique("soon", {debutLe: MAINTENANT + 3 * H}), MAINTENANT);
  assert.equal(etat.canonique, "soon");
});

/* ---- Les libellés restent lisibles -------------------------------------- */

test("un événement canonique en cours s'annonce « Maintenant »", () => {
  assert.equal(T.libelleTemporel(
    canonique("now", {debutLe: MAINTENANT - H, finLe: MAINTENANT + H}), MAINTENANT),
    "Maintenant");
});

test("une date jugée insuffisante s'annonce comme telle, sans bluffer", () => {
  assert.equal(T.libelleTemporel(
    canonique("unknown_date", {debutLe: MAINTENANT - H}), MAINTENANT),
    "Date à vérifier");
});

test("un événement canonique annulé le reste", () => {
  assert.equal(T.libelleTemporel(
    canonique("past", {debutLe: MAINTENANT - H, finLe: MAINTENANT + H, annule: true}),
    MAINTENANT), "Annulé");
});

/* ---- Non-régression : sans statut canonique, rien ne change ------------- */

test("un objet sans temporalStatus suit le moteur local, inchangé", () => {
  const local = {id: "l", titre: "Événement", isTemporary: true, timezone: "Europe/Paris",
    debutLe: MAINTENANT + 30 * 60000, finLe: MAINTENANT + 2 * H};
  const etat = T.statutTemporel(local, MAINTENANT);
  assert.equal(etat.statut, STATUTS.IMMINENT,
    "le moteur local garde sa fenêtre d'imminence pour ce qui ne vient pas de la base");
  assert.equal(etat.canonique, undefined);
});

test("l'état temporel canonique lit start_at/end_at et alimente le même libellé détaillé", () => {
  const event = {
    title: "Paysage", isTemporary: true, timezone: "Europe/Paris",
    start_at: "2026-08-30T14:00:00.000Z", end_at: "2026-08-30T15:30:00.000Z",
    date_confidence: "exact", temporal_status: "upcoming",
  };
  const now = Date.parse("2026-08-20T10:00:00.000Z");
  const etat = T.etatTemporalEvenement(event, now);
  assert.equal(etat.statut, STATUTS.A_VENIR);
  assert.equal(T.libelleDate(event, now, {statut: etat}), "Dimanche 30 août · 16h00–17h30");
});
