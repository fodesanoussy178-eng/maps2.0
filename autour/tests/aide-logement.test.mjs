import assert from "node:assert/strict";
import test from "node:test";

import "../comprendre.js";
import "../aide-taxonomie.js";
import "../aide-rayon.js";
import "../aide-classement.js";
import "../aide.js";

const TAXO = globalThis.AutourAideTaxonomie;
const C = globalThis.AutourAideClassement;
const R = globalThis.AutourAideRayon;
const A = globalThis.AutourAide;

const structure = (valeurs = {}) => Object.assign({
  cat: "hebergement",
  lat: 50.72,
  lng: 3.16,
}, valeurs);

test("la taxonomie logement distingue les structures demandées", () => {
  const types = [
    "foyer", "foyer_hebergement", "chrs", "chu", "hebergement_urgence",
    "residence_sociale", "maison_relais", "pension_de_famille",
    "foyer_jeunes_travailleurs", "residence_habitat_jeunes", "centre_maternel",
    "centre_parental", "accueil_de_jour", "siao", "ccas", "logement_accompagne",
    "intermediation_locative", "avdl", "fsl",
  ];
  types.forEach((type) => assert.ok(TAXO.TYPES_LOGEMENT[type], type));
  assert.ok(TAXO.TYPES_LOGEMENT.mecs, "MECS est connue comme protection de l’enfance");
  assert.notDeepEqual(TAXO.TYPES_LOGEMENT.chrs, TAXO.TYPES_LOGEMENT.siao);
  assert.equal(TAXO.TYPES_LOGEMENT.siao.hebergement_effectif, false);
  assert.equal(TAXO.TYPES_LOGEMENT.fsl.hebergement_effectif, false);
  assert.equal(TAXO.TYPES_LOGEMENT.chrs.hebergement_effectif, true);
});

test("le modèle de logement ne fabrique pas les champs absents", () => {
  const info = C.decrireLogement(structure({
    type_structure: "chrs",
    source: "service_public",
    telephone: "03 20 00 00 00",
    horaires: "lundi 9h-17h",
  }));
  assert.equal(info.type_structure, "chrs");
  assert.equal(info.hebergement_effectif, true);
  assert.equal(info.telephone, "03 20 00 00 00");
  assert.equal(info.horaires, "lundi 9h-17h");
  assert.equal(info.acces_libre, null);
  assert.equal(info.confidence, 1);

  const horaires = ["lundi 9h-17h", "mardi 9h-17h"];
  assert.deepEqual(C.decrireLogement(structure({
    type_structure: "chrs", horaires,
  })).horaires, horaires);

  const inconnu = C.decrireLogement({ titre: "Structure sociale", cat: "asso" });
  ["type_structure", "besoins_servis", "public_admis", "acces_libre",
    "orientation_requise", "urgence_possible", "hebergement_effectif",
    "horaires", "telephone", "source"].forEach((champ) =>
    assert.equal(inconnu[champ], null, champ + " doit rester inconnu"));
});

test("une MECS n'est jamais un logement générique pour un adulte", () => {
  const mecs = structure({
    titre: "MECS Gap Tourcoing Condorcet",
    type_structure: "mecs",
  });
  const v = C.evaluer(mecs, "logement", { profil: { age: 35 } });
  assert.equal(v.accorde, false);
  assert.equal(v.refus, C.REFUS.TYPE_NON_LOGEMENT);
  assert.equal(v.logement.type_structure, "mecs");
  assert.equal(v.logement.fonction, "protection_enfance");
  assert.equal(A.estSolution(mecs, ["logement"], { profil: { age: 35 } }), false);
});

test("un centre parental sans public compatible est refusé", () => {
  const centre = structure({ titre: "Centre parental La Maisonnée" });
  const sansProfil = C.evaluer(centre, "logement");
  assert.equal(sansProfil.accorde, false);
  assert.equal(sansProfil.refus, C.REFUS.PUBLIC_INCONNU);
  assert.deepEqual(sansProfil.logement.public_admis, ["parents", "enfants"]);

  const adulte = C.evaluer(centre, "logement", { profil: { age: 35 } });
  assert.equal(adulte.accorde, false);
  assert.equal(adulte.refus, C.REFUS.PUBLIC_INCOMPATIBLE);

  const parentSansEnfant = C.evaluer(centre, "logement", {
    profil: { parent: true },
  });
  assert.equal(parentSansEnfant.accorde, false);
  assert.equal(parentSansEnfant.refus, C.REFUS.PUBLIC_INCOMPATIBLE);

  const parent = C.evaluer(centre, "logement", {
    profil: { parent: true, children: true },
  });
  assert.equal(parent.accorde, true);

  const centreOsm = structure({
    titre: "Centre parental La Maisonnée",
    cat: "asso",
    tags: { amenity: "social_facility" },
  });
  assert.equal(C.evaluer(centreOsm, "logement").refus, C.REFUS.PUBLIC_INCONNU);
  assert.equal(C.evaluer(centreOsm, "logement", {
    profil: { parent: true, children: true },
  }).accorde, true);
});

test("un CHRS compatible est accepté comme hébergement et réinsertion", () => {
  const chrs = structure({ titre: "CHRS Le Relais", type_structure: "chrs" });
  const v = C.evaluer(chrs, "logement", { profil: { age: 35 } });
  assert.equal(v.accorde, true);
  assert.equal(v.logement.hebergement_effectif, true);
  assert.deepEqual(v.logement.besoins_servis, ["logement", "insertion"]);
  assert.equal(v.logement.orientation_requise, true);
});

test("l'urgence donne la priorité au CHU sur une résidence longue durée", () => {
  const chu = structure({
    titre: "CHU hébergement d'urgence",
    type_structure: "chu",
    rankEta: { minutes: 18 },
  });
  const residence = structure({
    titre: "Résidence sociale Les Érables",
    type_structure: "residence_sociale",
    rankEta: { minutes: 7 },
  });
  const a = Object.assign(chu, { verdictAide: { confiance: 80, certaine: true } });
  const b = Object.assign(residence, { verdictAide: { confiance: 80, certaine: true } });
  assert.ok(C.comparer(a, b) < 0, "la réponse urgente doit passer devant");
  assert.equal(C.decrireLogement(chu).urgence_possible, true);
  assert.equal(C.decrireLogement(residence).urgence_possible, false);
});

test("un FJT est accepté pour un jeune et refusé pour un public incompatible", () => {
  const fjt = structure({
    titre: "Foyer jeunes travailleurs de Tourcoing",
    type_structure: "foyer_jeunes_travailleurs",
  });
  assert.equal(A.estSolution(fjt, ["logement"], { profil: { age: 22 } }), true);
  assert.equal(A.estSolution(fjt, ["logement"], { profil: { age: 42 } }), false);
  assert.equal(C.evaluer(fjt, "logement", { profil: { age: 42 } }).refus,
    C.REFUS.PUBLIC_INCOMPATIBLE);
});

test("les dispositifs d'orientation ne sont pas des lits disponibles", () => {
  for (const [type, nom, fonction] of [
    ["siao", "SIAO 115", "oriente"],
    ["ccas", "CCAS logement", "oriente_accompagne"],
    ["avdl", "AVDL du bassin", "accompagne"],
    ["fsl", "FSL", "finance_aide_maintien"],
  ]) {
    const l = structure({ titre: nom, type_structure: type, cat: "asso" });
    const v = C.evaluer(l, "logement");
    assert.equal(v.accorde, true, nom + " reste une porte d'entrée utile");
    assert.equal(v.logement.hebergement_effectif, false, nom + " ne promet pas un lit");
    assert.equal(v.logement.fonction, fonction);
  }
});

test("une structure pertinente hors commune reste autorisée", () => {
  const chrsRoubaix = structure({
    titre: "CHRS Roubaix",
    type_structure: "chrs",
    commune: "Roubaix",
    rankEta: { minutes: 12 },
  });
  assert.equal(A.estSolution(chrsRoubaix, ["logement"], { profil: { age: 35 } }), true);
});

test("le temps de trajet suit les paliers métier", () => {
  const minutes = [7, 12, 25, 40, 52].map((minutes) => ({ rankEta: { minutes } }));
  assert.deepEqual(minutes.map(R.palierTrajet).map((p) => p.priorite), [4, 3, 2, 1, 0]);
  assert.ok(R.comparerTemps(minutes[0], minutes[1]) < 0);
  assert.ok(R.comparerTemps(minutes[1], minutes[2]) < 0);
  assert.ok(R.comparerTemps(minutes[2], minutes[3]) < 0);
  assert.ok(R.comparerTemps(minutes[3], minutes[4]) < 0);
});

test("à compatibilité égale, 7 minutes passent devant 25", () => {
  const proche = Object.assign(structure({
    titre: "CHRS A", type_structure: "chrs", rankEta: { minutes: 7 },
  }), { verdictAide: { confiance: 80, certaine: true } });
  const loin = Object.assign(structure({
    titre: "CHRS B", type_structure: "chrs", rankEta: { minutes: 25 },
  }), { verdictAide: { confiance: 80, certaine: true } });
  assert.ok(C.comparer(proche, loin) < 0);
});

test("4 minutes incompatible ne passe pas devant 12 minutes compatible", () => {
  const mecs = structure({ titre: "MECS proche", type_structure: "mecs", rankEta: { minutes: 4 } });
  const chrs = structure({ titre: "CHRS compatible", type_structure: "chrs", rankEta: { minutes: 12 } });
  const retenus = [mecs, chrs].filter((lieu) =>
    A.estSolution(lieu, ["logement"], { profil: { age: 35 } }));
  assert.deepEqual(retenus.map((lieu) => lieu.titre), ["CHRS compatible"]);
});
