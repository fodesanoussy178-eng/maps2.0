import assert from "node:assert/strict";
import test from "node:test";

import "../comprendre.js";
import "../aide.js";
import "../donnees.js";
import "../signaux.js";

const A = globalThis.AutourAide;
const D = globalThis.AutourDonnees;

const besoins = (phrase) => A.besoinsDepuisPhrase(phrase).map((x) => x.id);

/* ==========================================================================
   Partir du problème : les phrases que les gens écrivent vraiment
   ======================================================================== */

test("les dix formulations demandées deviennent des besoins", () => {
  const cas = [
    ["j'ai 20 ans et je cherche du travail", "travail"],
    ["j'ai plus assez pour manger", "manger"],
    ["besoin d'aide pour mon loyer", "logement"],
    ["je comprends rien à mes papiers", "papiers"],
    ["je cherche une formation", "travail"],
    ["où manger gratuitement", "manger"],
    ["j'ai besoin d'une aide administrative", "papiers"],
    ["distribution alimentaire aujourd'hui", "manger"],
    ["aide étudiant", "jeunes"],
    ["aide jeune sans emploi", "travail"],
  ];
  cas.forEach(([phrase, attendu]) => {
    assert.ok(besoins(phrase).includes(attendu),
      phrase + " → " + besoins(phrase).join(", ") + " (attendu " + attendu + ")");
  });
});

test("l'âge n'est retenu que si la personne le donne", () => {
  assert.equal(A.ageDepuisPhrase("j'ai 20 ans et je cherche du travail"), 20);
  assert.equal(A.ageDepuisPhrase("j'ai 17 ans"), 17);
  assert.equal(A.ageDepuisPhrase("je cherche du travail"), null);
  // pas d'âge aberrant
  assert.equal(A.ageDepuisPhrase("il y a 200 ans"), null);
});

test("« autre » ne se déclenche que faute de mieux", () => {
  assert.deepEqual(besoins("j'ai besoin d'aide pour manger"), ["manger"]);
  assert.ok(besoins("je sais pas où aller").includes("autre"));
});

test("l'urgence est une gravité, pas un besoin de plus", () => {
  assert.equal(A.estUrgent("je dors dehors ce soir"), true);
  assert.equal(A.estUrgent("j'ai besoin d'une formation"), false);
  assert.ok(!A.BESOINS.some((b) => b.id === "urgence"));
});

test("les dix besoins sont écrits sans vocabulaire administratif", () => {
  // dix cases à l'écran ; le modèle en garde douze — hygiène et vêtements
  // restent reconnus dans une phrase et atteignables par « Autre aide »
  assert.equal(A.BESOINS_GRILLE.length, 10);
  assert.deepEqual(A.BESOINS.filter((b) => b.horsGrille).map((b) => b.id),
    ["hygiene", "vetements"]);
  const autre = A.BESOIN_DE("autre");
  assert.ok(autre.cats.includes("toilettes") && autre.cats.includes("friperie"),
    "« Autre aide » couvre ce qui n'a plus de case");
  const libelles = A.BESOINS.map((b) => b.label.toLowerCase()).join(" ");
  for (const jargon of ["ccas", "mission locale", "france services", "pass", "insertion"])
    assert.ok(!libelles.includes(jargon), jargon + " ne doit pas figurer dans un libellé");
});

/* ==========================================================================
   Besoin → solutions : plusieurs types de structures, jamais une certitude
   ======================================================================== */

test("un besoin mène à plusieurs types de structures", () => {
  const emploi = A.BESOIN_DE("travail");
  assert.ok(emploi.cats.length >= 2);
  assert.ok(emploi.reseaux.some((re) => re.test("Mission Locale de Roubaix")));
  assert.ok(emploi.reseaux.some((re) => re.test("France Travail Lille")));
  assert.ok(emploi.reseaux.some((re) => re.test("Cap Emploi 59")));

  const manger = A.BESOIN_DE("manger");
  assert.ok(manger.reseaux.some((re) => re.test("Restos du Cœur")));
  assert.ok(manger.reseaux.some((re) => re.test("Épicerie solidaire du centre")));
  assert.ok(manger.cats.includes("collecte"), "les distributions ponctuelles comptent");
});

test("une correspondance de réseau est sûre, une parenté de catégorie ne l'est pas", () => {
  const ml = A.pertinence({titre: "Mission Locale de Tourcoing", cat: "emploi"}, "travail");
  assert.equal(ml.poids, 1);
  assert.equal(ml.sur, true);

  const asso = A.pertinence({titre: "Association du quartier", cat: "asso",
    categories: ["asso"]}, "travail");
  assert.ok(asso.poids > 0 && asso.poids < 1);
  assert.ok(!asso.sur, "une simple catégorie n'est pas une certitude");

  const hors = A.pertinence({titre: "Le Bistrot", cat: "resto"}, "travail");
  assert.equal(hors.poids, 0);
});

/* ==========================================================================
   Conditions d'accès : jamais inventées
   ======================================================================== */

test("une condition vient du réseau, pas de l'antenne", () => {
  const c = A.conditionDe({titre: "Mission Locale de Lille"});
  assert.ok(c);
  assert.deepEqual(c.age, {min: 16, max: 25});
  assert.equal(c.source, "reseau");
  assert.ok(c.confidence > 0);
  // un lieu sans réseau connu n'a AUCUNE condition affichée
  assert.equal(A.conditionDe({titre: "Association des Quatre Vents"}), null);
});

test("« est-ce pour moi » répond null quand on ne sait pas", () => {
  const ml = {titre: "Mission Locale"};
  assert.equal(A.convient(ml, {age: 20}), true);
  assert.equal(A.convient(ml, {age: 40}), false);
  assert.equal(A.convient(ml, {}), null, "sans âge donné, on ne tranche pas");
  assert.equal(A.convient({titre: "Centre social"}, {age: 20}), null,
    "sans condition connue, on ne tranche pas");
});

test("la raison affichée n'invente aucune condition", () => {
  const sansAge = A.pourquoi({titre: "Mission Locale", cat: "emploi"}, ["travail"], {});
  assert.doesNotMatch(sansAge, /ans/);
  const avecAge = A.pourquoi({titre: "Mission Locale", cat: "emploi"}, ["travail"], {age: 20});
  assert.match(avecAge, /20 ans/);
});

/* ==========================================================================
   Le modèle normalisé : source, confiance, date
   ======================================================================== */

test("un prix inconnu n'est pas un prix élevé", () => {
  const inconnu = D.normaliserPrix({cat: "resto"});
  assert.equal(inconnu.confidence, 0);
  assert.equal(D.depassePlafond(inconnu, 15), null, "on ne tranche pas sur du vide");

  const cher = D.normaliserPrix({cat: "resto", prixN: 4});
  assert.equal(cher.source, "google");
  assert.ok(cher.confidence > 0);
  assert.equal(D.depassePlafond(cher, 15), true);

  const moyen = D.normaliserPrix({cat: "resto", prixN: 2});   // 15–30 €
  assert.equal(D.depassePlafond(moyen, 20), false, "le bas de fourchette décide");
});

test("un prix annoncé par la personne qui publie prime", () => {
  const p = D.normaliserPrix({prix: 5, verifie: true});
  assert.equal(p.min, 5);
  assert.equal(p.source, "habitant");
  assert.equal(p.confidence, 1);
  const gratuit = D.normaliserPrix({gratuit: true, tags: {fee: "no"}});
  assert.equal(gratuit.level, 0);
  assert.equal(gratuit.source, "osm");
});

test("des horaires inconnus ne valent pas « fermé »", () => {
  const h = D.normaliserHoraires({}, Date.now(), () => ({status: "unknown"}));
  assert.equal(h.open_now, null);
  assert.equal(h.confidence, 0);
  assert.equal(D.fermeAvant(h, 21 * 60), null);

  const tard = D.normaliserHoraires({}, Date.now(),
    () => ({status: "open", isOpenNow: true, closesAtTime: "02:00", source: "osm"}));
  assert.equal(tard.open_now, true);
  assert.equal(D.fermeAvant(tard, 21 * 60), false, "02:00 est plus tard que 21:00");

  const tot = D.normaliserHoraires({}, Date.now(),
    () => ({status: "open", isOpenNow: true, closesAtTime: "18:00", source: "osm"}));
  assert.equal(D.fermeAvant(tot, 21 * 60), true);
});

test("on n'enrichit que ce qui manque ET qui a été demandé", () => {
  const sansPrix = {cat: "resto", idGoogle: "x"};
  const avecBudget = {contraintes: [{type: "budget", max: 15}], budget: {max: 15}, horaire: {}};
  assert.deepEqual(D.manque(sansPrix, avecBudget), ["prix"]);
  // personne n'a parlé de budget : rien à demander
  assert.deepEqual(D.manque(sansPrix, {contraintes: [], budget: {}, horaire: {}}), []);
  // le prix est déjà connu : rien à demander non plus
  assert.deepEqual(D.manque({cat: "resto", prixN: 1}, avecBudget), []);
});

/* ==========================================================================
   Vie privée
   ======================================================================== */

test("le journal ne retient que des fragments anodins", () => {
  const C = globalThis.AutourComprendre;
  const faux = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
  globalThis.localStorage = globalThis.localStorage || faux;
  // un fragment contenant un chiffre, une adresse ou un @ n'entre pas
  assert.equal(C.noterReste("12 rue nationale"), false);
  assert.equal(C.noterReste("truc@exemple.fr"), false);
  assert.equal(C.noterReste("avenue de la paix"), false);
  assert.equal(C.noterReste("ab"), false, "trop court");
  // un fragment de vocabulaire ordinaire, oui
  assert.equal(C.noterReste("sympa"), true);
  C.viderJournalReste();
});

test("le mode Aide ne produit aucun fragment à journaliser", () => {
  // les phrases d'aide passent par `besoinsDepuisPhrase`, qui ne renvoie que
  // des identifiants normalisés — jamais la phrase
  const r = A.besoinsDepuisPhrase("j'ai plus assez pour manger et j'habite chez ma mère");
  assert.deepEqual(r.map((x) => x.id), ["manger"]);
  r.forEach((x) => assert.ok(typeof x.id === "string" && x.id.length < 20));
});
