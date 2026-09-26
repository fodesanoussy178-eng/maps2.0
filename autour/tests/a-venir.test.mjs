/* ---------------------------------------------------------------------------
   « À VENIR » : LES PROCHAINES 24 HEURES, ET RIEN D'AUTRE

   Relevé le 26/09/2026 : « À venir » affichait des événements du 2, du 3 ou du
   7 octobre. Deux causes, toutes deux corrigées ici :

     1. la section `a_venir` du moteur temporel couvrait tout ce qui commence
        après aujourd'hui (hors week-end), sans borne — J+2, J+7, J+30 ;
     2. le panneau « Pour toi » portait les mêmes onglets « À venir / Ce
        week-end », liés au même `creneau`, alors que ses propositions ne
        suivent aucune fenêtre : ses recommandations à J+5 s'affichaient sous
        le nom « À venir ».

   La règle : now < début ≤ now + 24 h. Ce qui a commencé est Maintenant ; la
   personnalisation classe, elle n'élargit jamais ; une fenêtre vide reste vide.
--------------------------------------------------------------------------- */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../core.js";
import "../temporel.js";

const T = globalThis.AutourTemps;
const C = globalThis.AutourCore;
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const paris = (iso) => Date.parse(iso + "+02:00");
const SAMEDI_21H = paris("2026-09-26T21:00:00");
const H = 3600e3;

const evenement = (debut, dureeH = 2, extra) => Object.assign({
  isTemporary: true, timezone: "Europe/Paris",
  start_at: new Date(debut).toISOString(),
  end_at: new Date(debut + dureeH * H).toISOString(),
  date_confidence: "exact",
}, extra || {});
const aVenir = (item, t = SAMEDI_21H) => T.estAVenir(item, t);

test("la fenêtre, minute par minute", () => {
  const cas = [
    ["21h30 aujourd'hui", paris("2026-09-26T21:30:00"), true],
    ["23h aujourd'hui", paris("2026-09-26T23:00:00"), true],
    ["8h demain", paris("2026-09-27T08:00:00"), true],
    ["20h demain", paris("2026-09-27T20:00:00"), true],
    ["21h demain — la limite exacte", paris("2026-09-27T21:00:00"), true],
    ["21h01 demain", paris("2026-09-27T21:01:00"), false],
    ["22h30 demain", paris("2026-09-27T22:30:00"), false],
    ["après-demain", paris("2026-09-28T10:00:00"), false],
    ["dans 7 jours", paris("2026-10-03T21:00:00"), false],
    ["le 7 octobre", paris("2026-10-07T18:00:00"), false],
  ];
  for (const [nom, debut, attendu] of cas) assert.equal(aVenir(evenement(debut)), attendu, nom);
  // la fenêtre de surface dit la même chose
  const f = T.fenetreSurface("avenir", SAMEDI_21H, "Europe/Paris");
  assert.equal(f.fin - f.debut, 24 * H);
});

test("déjà commencé : Maintenant seulement, jamais dupliqué dans À venir", () => {
  const enCours = evenement(paris("2026-09-26T20:00:00"), 3);
  assert.equal(aVenir(enCours), false);
  assert.ok(T.estMaintenant(T.statutTemporel(enCours, SAMEDI_21H).status));
  // qui commence à l'instant même n'est plus « à venir » : now < début, strictement
  assert.equal(aVenir(evenement(SAMEDI_21H)), false);
});

test("terminé : nulle part", () => {
  const fini = evenement(paris("2026-09-26T14:00:00"), 3);
  assert.equal(aVenir(fini), false);
  assert.equal(T.estMaintenant(T.statutTemporel(fini, SAMEDI_21H).status), false);
  assert.equal(aVenir(evenement(paris("2026-09-27T10:00:00"), 2, { annule: true })), false);
});

test("une publication d'habitant dans 12 h est À venir", () => {
  // la forme d'une publication (debut_le / fin_le), passée par la vraie normalisation
  const pub = C.toCommonItem({ id: "pub-1", titre: "Foot au parc", cat: "sport",
    debut_le: new Date(SAMEDI_21H + 12 * H).toISOString(),
    fin_le: new Date(SAMEDI_21H + 14 * H).toISOString(), lat: 50.63, lng: 3.06 }, { source: "user" });
  assert.equal(aVenir(pub), true);
});

test("un marché demain matin est À venir ; une braderie dans 30 h ne l'est pas", () => {
  assert.equal(aVenir(evenement(paris("2026-09-27T08:00:00"), 5)), true);
  assert.equal(aVenir(evenement(SAMEDI_21H + 30 * H, 7)), false);
});

test("un marché récurrent n'est À venir que si sa prochaine ouverture tombe dans les 24 h", () => {
  // DATAtourisme (donnée réelle) : du 1er janvier au 31 décembre, 7 h → 14 h, heure de Paris
  const dimanche = { isTemporary: true, timezone: "Europe/Paris", joursRecurrence: [0],
    start_at: "2026-01-01T06:00:00Z", end_at: "2026-12-31T13:00:00Z", date_confidence: "exact" };
  assert.equal(aVenir(dimanche), true, "samedi 21 h → dimanche 7 h");
  assert.equal(aVenir(dimanche, paris("2026-09-26T07:00:00")), true, "samedi 7 h → dimanche 7 h : 24 h pile");
  assert.equal(aVenir(dimanche, paris("2026-09-26T06:59:00")), false, "samedi 6 h 59 → 24 h 01");
  assert.equal(aVenir(Object.assign({}, dimanche, { joursRecurrence: [3] })), false, "le mercredi");
  // sans jours connus, on ne prétend pas savoir quand il rouvre
  assert.equal(aVenir(Object.assign({}, dimanche, { joursRecurrence: null })), false);
});

test("un concert recommandé par Pour toi dans 5 jours n'est jamais À venir", () => {
  const concert = evenement(SAMEDI_21H + 5 * 24 * H, 3, { announcement_tags: ["concert", "rap"] });
  assert.equal(aVenir(concert), false);

  /* Et par construction : À venir ne lit que les lieux de la zone, filtrés
     par la fenêtre AVANT le classement — aucune donnée de Pour toi. */
  const debut = app.indexOf("function recommandationsAccueil");
  const fin = app.indexOf("function avecEpingles", debut);
  const reco = app.slice(debut, fin);
  assert.match(reco, /lieux\.filter\(l=>dansZoneActive\(l\) && estTemporaire\(l\) && nomExploitable\(l\) &&\s*\(!aVenir \|\| \(TEMPS\.estAVenir && TEMPS\.estAVenir\(l, maintenantMs\)\)\)\)/);
  assert.ok(reco.indexOf("estAVenir") < reco.indexOf("rankResults(candidats"), "filtre temporel d'abord");
  for (const pourToi of ["propositionsPourToi", "classerPourToi", "localPoolPourToi", "majorCrossZonePool", "bassinPourToi"])
    assert.ok(!reco.includes(pourToi), "À venir ne lit pas " + pourToi);
});

test("Pour toi n'affiche plus d'onglet « À venir » et ne pilote plus la frise", () => {
  const maj = app.slice(app.indexOf("function majPourToi"), app.indexOf("function brancherPourToi"));
  assert.ok(!/ongletsTemps\(\)/.test(maj));
  const brancher = app.slice(app.indexOf("function brancherPourToi"), app.indexOf("[data-pt]"));
  assert.ok(!/creneau = b\.dataset\.creneau/.test(brancher));
});

test("vide, c'est vide : un état propre, deux sorties, aucun remplissage", () => {
  const statut = app.slice(app.indexOf("function statutGroupeHTML"), app.indexOf("function blocOuRegarder"));
  assert.match(statut, /Rien de prévu dans les prochaines 24 h autour de toi\./);
  assert.match(statut, /data-avenir-vide="explorer">Explorer/);
  assert.match(statut, /data-creneau-vers="weekend">Ce week-end/);
  // l'état vide ne recalcule rien : aucun classement, aucune autre source
  const vide = statut.slice(statut.indexOf('if(creneau === "avenir")'));
  assert.ok(!/rankResults|propositionsPourToi|lieux\./.test(vide.slice(0, vide.indexOf("const groupe"))));
});

test("les libellés disent la règle", () => {
  assert.match(app, /avenir:"Dans les prochaines 24 h"/);
  assert.match(app, /<b>À venir<\/b><i>Prochaines 24 h<\/i>/);
  assert.ok(!/Dans les prochains jours"|<i>Prochains jours<\/i>/.test(app));
  // la carte applique la même fenêtre que la liste
  assert.match(app, /if\(creneau === "avenir"\) return !!\(TEMPS\.estAVenir && TEMPS\.estAVenir\(l, t\)\);/);
});
