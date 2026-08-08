import test from "node:test";
import assert from "node:assert/strict";
import "../temporel.js";

const T = globalThis.AutourTemps;
const {STATUTS} = T;

/* Un mardi 12 août 2025, 14 h 00 à Paris. Toutes les dates du fichier sont
   relatives à cet instant, pour que les tests ne dépendent pas du jour où on
   les exécute. */
const MAINTENANT = Date.parse("2025-08-12T14:00:00+02:00");
const H = 3600 * 1000;
const J = 24 * H;

const evt = (extra) => Object.assign({id:"e", titre:"Événement", isTemporary:true,
  timezone:"Europe/Paris"}, extra);

const statut = (item, quand) => T.statutTemporel(item, quand == null ? MAINTENANT : quand).statut;

/* ---- Les neuf cas demandés --------------------------------------------- */

test("un événement en cours est en cours", () => {
  const e = evt({debutLe: MAINTENANT - H, finLe: MAINTENANT + H});
  assert.equal(statut(e), STATUTS.EN_COURS);
  assert.equal(T.libelleTemporel(e, MAINTENANT), "Maintenant");
  assert.ok(T.estMaintenant(statut(e)));
});

test("un événement dans 30 minutes est imminent", () => {
  const e = evt({debutLe: MAINTENANT + 30 * 60000, finLe: MAINTENANT + 2 * H});
  assert.equal(statut(e), STATUTS.IMMINENT);
  assert.equal(T.libelleTemporel(e, MAINTENANT), "Commence dans 30 min");
  assert.ok(T.estMaintenant(statut(e)));
});

test("un événement de ce soir n'est pas « maintenant »", () => {
  // 23 h : bien plus tard que la fenêtre de deux heures
  const e = evt({debutLe: Date.parse("2025-08-12T23:00:00+02:00")});
  assert.equal(statut(e), STATUTS.PLUS_TARD);
  assert.equal(T.libelleTemporel(e, MAINTENANT), "Ce soir · 23:00");
  assert.ok(!T.estMaintenant(statut(e)));
});

test("un événement de demain est à venir", () => {
  const e = evt({debutLe: MAINTENANT + J, finLe: MAINTENANT + J + 2 * H});
  assert.equal(statut(e), STATUTS.A_VENIR);
  assert.equal(T.libelleTemporel(e, MAINTENANT), "Demain · 14:00");
  assert.ok(!T.estMaintenant(statut(e)));
});

test("un événement dans trois mois n'entre jamais dans « maintenant »", () => {
  const e = evt({debutLe: Date.parse("2025-11-12T16:00:00+01:00")});
  assert.equal(statut(e), STATUTS.A_VENIR);
  assert.ok(!T.estMaintenant(statut(e)));
  assert.match(T.libelleTemporel(e, MAINTENANT), /nov\./);
});

test("un événement passé est exclu", () => {
  const e = evt({debutLe: MAINTENANT - 3 * H, finLe: MAINTENANT - 2 * H});
  assert.equal(statut(e), STATUTS.PASSE);
  assert.equal(T.libelleTemporel(e, MAINTENANT), "Terminé");
});

test("un événement sans date exploitable n'est JAMAIS « maintenant »", () => {
  // c'est le défaut d'origine : startsAt nul valait « rien ne bloque »
  for (const sans of [evt({}), evt({debutLe: null, finLe: null}),
                      evt({debutLe: "pas une date"}), evt({quand: "Voir sur place"})]) {
    assert.equal(statut(sans), STATUTS.INCONNU);
    assert.ok(!T.estMaintenant(statut(sans)));
  }
  assert.equal(T.libelleTemporel(evt({}), MAINTENANT), "Date à vérifier");
});

test("une exposition longue FERMÉE à cet instant n'est pas en cours", () => {
  // juin → septembre : la période contient l'instant, mais le musée est fermé
  const expo = evt({
    debutLe: Date.parse("2025-06-01T10:00:00+02:00"),
    finLe:   Date.parse("2025-09-30T18:00:00+02:00"),
  });
  const ferme = () => ({status:"closed", isOpenNow:false, opensAtTime:"10:00"});
  const etat = T.statutTemporel(expo, MAINTENANT, {disponibilite: ferme});
  assert.equal(etat.statut, STATUTS.PLUS_TARD);
  assert.equal(etat.periodeLongue, true);
  assert.ok(!T.estMaintenant(etat.statut));
});

test("une exposition longue OUVERTE à cet instant est en cours", () => {
  const expo = evt({
    debutLe: Date.parse("2025-06-01T10:00:00+02:00"),
    finLe:   Date.parse("2025-09-30T18:00:00+02:00"),
  });
  const ouvert = () => ({status:"open", isOpenNow:true, closesAtTime:"18:00"});
  const etat = T.statutTemporel(expo, MAINTENANT, {disponibilite: ouvert});
  assert.equal(etat.statut, STATUTS.EN_COURS);
  assert.equal(T.libelleTemporel(expo, MAINTENANT, {statut: etat}), "En cours · jusqu’à 18:00");
});

test("une exposition longue fermée annonce sa prochaine ouverture, pas le début de la période", () => {
  // le défaut : « Ce soir · 10:00 » calculé sur le 1er juin, deux mois plus tôt
  const expo = evt({
    debutLe: Date.parse("2025-06-01T10:00:00+02:00"),
    finLe:   Date.parse("2025-09-30T18:00:00+02:00"),
  });
  const demain = Date.parse("2025-08-13T10:00:00+02:00");
  const ferme = () => ({status:"closed", isOpenNow:false, opensAtTime:"10:00",
    opensAt: new Date(demain).toISOString()});
  const etat = T.statutTemporel(expo, MAINTENANT, {disponibilite: ferme});
  assert.equal(etat.statut, STATUTS.A_VENIR);
  assert.equal(etat.debut, demain);
  assert.equal(T.libelleTemporel(expo, MAINTENANT, {statut: etat}), "Demain · 10:00");
  assert.ok(!T.estMaintenant(etat.statut));
});

test("une exposition longue qui rouvre dans une heure n'est pas « imminente »", () => {
  const expo = evt({
    debutLe: Date.parse("2025-06-01T10:00:00+02:00"),
    finLe:   Date.parse("2025-09-30T18:00:00+02:00"),
  });
  const ferme = () => ({status:"closed", isOpenNow:false, opensAtTime:"15:00",
    opensAt: new Date(MAINTENANT + H).toISOString()});
  const etat = T.statutTemporel(expo, MAINTENANT, {disponibilite: ferme});
  assert.equal(etat.statut, STATUTS.PLUS_TARD);
  assert.ok(!T.estMaintenant(etat.statut));
  assert.equal(T.libelleTemporel(expo, MAINTENANT, {statut: etat}), "Aujourd’hui · 15:00");
});

test("une exposition longue sans horaires connus reste incertaine", () => {
  // sans horaires, on ne prétend pas qu'on peut y aller maintenant
  const expo = evt({debutLe: MAINTENANT - 30 * J, finLe: MAINTENANT + 30 * J});
  assert.equal(statut(expo), STATUTS.INCONNU);
  assert.ok(!T.estMaintenant(statut(expo)));
});

test("un événement récurrent est jugé sur sa prochaine occurrence", () => {
  // atelier hebdomadaire : la première séance est passée depuis des semaines,
  // la période complète ne doit pas passer pour un événement continu
  const recurrent = evt({timings: [
    {begin:"2025-07-15T18:00:00+02:00", end:"2025-07-15T20:00:00+02:00"},
    {begin:"2025-08-05T18:00:00+02:00", end:"2025-08-05T20:00:00+02:00"},
    {begin:"2025-08-12T18:00:00+02:00", end:"2025-08-12T20:00:00+02:00"},
    {begin:"2025-08-19T18:00:00+02:00", end:"2025-08-19T20:00:00+02:00"},
  ]});
  const etat = T.statutTemporel(recurrent, MAINTENANT);
  assert.equal(etat.statut, STATUTS.PLUS_TARD, "la séance de ce soir, pas celle de juillet");
  assert.equal(etat.occurrences, 4);
  assert.equal(T.libelleTemporel(recurrent, MAINTENANT), "Ce soir · 18:00");

  // pendant la séance de ce soir, il est bien en cours
  const pendant = Date.parse("2025-08-12T18:30:00+02:00");
  assert.equal(T.statutTemporel(recurrent, pendant).statut, STATUTS.EN_COURS);

  // et une fois toutes les séances passées, il est terminé
  const apres = Date.parse("2025-09-01T12:00:00+02:00");
  assert.equal(T.statutTemporel(recurrent, apres).statut, STATUTS.PASSE);
});

/* ---- Lieux permanents --------------------------------------------------- */

test("un lieu permanent suit ses horaires, pas une période", () => {
  const lieu = {id:"l", titre:"Café", isTemporary:false};
  assert.equal(T.statutTemporel(lieu, MAINTENANT,
    {disponibilite:()=>({status:"open", isOpenNow:true})}).statut, STATUTS.EN_COURS);
  assert.equal(T.statutTemporel(lieu, MAINTENANT,
    {disponibilite:()=>({status:"closed", isOpenNow:false})}).statut, STATUTS.PLUS_TARD);
  // horaires inconnus : on ne prétend pas que c'est ouvert
  assert.equal(T.statutTemporel(lieu, MAINTENANT,
    {disponibilite:()=>({status:"unknown"})}).statut, STATUTS.INCONNU);
  assert.equal(T.statutTemporel(lieu, MAINTENANT, {}).statut, STATUTS.INCONNU);
  // définitivement fermé : ce n'est plus un lieu où aller
  assert.equal(T.statutTemporel(lieu, MAINTENANT,
    {disponibilite:()=>({status:"permanently_closed"})}).statut, STATUTS.PASSE);
});

/* ---- Normalisation des sources ------------------------------------------ */

test("toutes les sources se ramènent au même modèle", () => {
  const attendu = [{debut: Date.parse("2025-08-12T18:00:00+02:00"),
                    fin:   Date.parse("2025-08-12T20:00:00+02:00")}];
  // Supabase
  assert.deepEqual(T.normaliserPeriodes({debut_le:"2025-08-12T18:00:00+02:00",
                                         fin_le:"2025-08-12T20:00:00+02:00"}), attendu);
  // client Autour
  assert.deepEqual(T.normaliserPeriodes({debutLe: attendu[0].debut, finLe: attendu[0].fin}), attendu);
  // modèle commun
  assert.deepEqual(T.normaliserPeriodes({startsAt: attendu[0].debut, endsAt: attendu[0].fin}), attendu);
  // OpenAgenda
  assert.deepEqual(T.normaliserPeriodes({timings:[{begin:"2025-08-12T18:00:00+02:00",
                                                   end:"2025-08-12T20:00:00+02:00"}]}), attendu);
  // rien d'exploitable
  assert.deepEqual(T.normaliserPeriodes({quand:"bientôt"}), []);
  assert.deepEqual(T.normaliserPeriodes(null), []);
});

test("les occurrences sont triées, quel que soit l'ordre reçu", () => {
  const p = T.normaliserPeriodes({timings:[
    {begin:"2025-08-19T18:00:00+02:00"},
    {begin:"2025-08-05T18:00:00+02:00"},
    {begin:"2025-08-12T18:00:00+02:00"},
  ]});
  assert.deepEqual(p.map(x=>new Date(x.debut).toISOString().slice(0,10)),
    ["2025-08-05","2025-08-12","2025-08-19"]);
});

test("sans heure de fin, un événement commencé ne reste pas en cours indéfiniment", () => {
  const e = evt({debutLe: MAINTENANT - 30 * 60000});
  assert.equal(statut(e), STATUTS.EN_COURS);
  // quatre heures plus tard, la durée supposée est dépassée
  assert.equal(T.statutTemporel(e, MAINTENANT + 4 * H).statut, STATUTS.PASSE);
});

test("un événement annulé est traité comme passé", () => {
  const e = evt({debutLe: MAINTENANT + 30 * 60000, annule: true});
  assert.equal(statut(e), STATUTS.PASSE);
  assert.equal(T.libelleTemporel(e, MAINTENANT), "Annulé");
});

/* ---- Fuseau du lieu ----------------------------------------------------- */

test("« ce soir » se calcule dans le fuseau du lieu, pas du navigateur", () => {
  // 21 h à Fort-de-France = 2 h du matin le lendemain à Paris. Le même instant
  // est « ce soir » là-bas et « demain » ici : c'est le lieu qui décide.
  const instant = Date.parse("2025-08-13T01:00:00+02:00");   // en Martinique : 12 août 19 h
  // 22 h en Martinique, soit trois heures plus tard : hors de la fenêtre
  // d'imminence, et toujours le même jour LÀ-BAS — mais déjà demain à Paris
  const local = evt({debutLe: Date.parse("2025-08-13T04:00:00+02:00"),
                     timezone:"America/Martinique"});
  const etat = T.statutTemporel(local, instant);
  assert.equal(etat.statut, STATUTS.PLUS_TARD, "même journée en Martinique");
  assert.match(T.libelleTemporel(local, instant), /Ce soir · 22:00/);

  // le même événement jugé dans le fuseau de Paris tomberait « à venir »
  const vuDeParis = evt({debutLe: Date.parse("2025-08-13T04:00:00+02:00"),
                         timezone:"Europe/Paris"});
  assert.equal(T.statutTemporel(vuDeParis, instant).statut, STATUTS.PLUS_TARD);
});

/* ---- Sections ----------------------------------------------------------- */

test("chaque statut a sa section, et rien de futur n'atterrit dans « maintenant »", () => {
  const section = (item, quand) => T.sectionTemporelle(
    T.statutTemporel(item, quand == null ? MAINTENANT : quand), quand == null ? MAINTENANT : quand);

  assert.equal(section(evt({debutLe: MAINTENANT - H, finLe: MAINTENANT + H})), "maintenant");
  assert.equal(section(evt({debutLe: MAINTENANT + 30 * 60000})), "maintenant");
  assert.equal(section(evt({debutLe: Date.parse("2025-08-12T23:00:00+02:00")})), "ce_soir");
  assert.equal(section(evt({debutLe: Date.parse("2025-08-12T16:30:00+02:00")})), "aujourdhui");
  // le samedi qui vient
  assert.equal(section(evt({debutLe: Date.parse("2025-08-16T16:00:00+02:00")})), "ce_week_end");
  // plus loin que la semaine
  assert.equal(section(evt({debutLe: Date.parse("2025-09-20T16:00:00+02:00")})), "a_venir");
  // passé : nulle part
  assert.equal(section(evt({debutLe: MAINTENANT - 5 * H, finLe: MAINTENANT - 4 * H})), null);
});
