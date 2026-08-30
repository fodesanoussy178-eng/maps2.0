import assert from "node:assert/strict";
import test from "node:test";

import "../aide-intentions.js";
import "../comprendre.js";
import "../aide-taxonomie.js";
import "../aide-classement.js";
import "../aide.js";

const MOTEUR = globalThis.AutourAideIntentions;
const AIDE = globalThis.AutourAide;

const ids = (texte) => MOTEUR.detecterBesoins(texte).map((x) => x.besoin);
const analyse = (texte) => MOTEUR.analyserBesoins(texte);

test("l'API retourne plusieurs besoins scores et une urgence séparée", () => {
  const resultat = MOTEUR.detecterBesoins("je n'ai rien à manger et je cherche du travail");
  assert.ok(Array.isArray(resultat));
  assert.deepEqual(new Set(resultat.map((x) => x.besoin)), new Set(["manger", "travail"]));
  resultat.forEach((x) => {
    assert.equal(typeof x.score, "number");
    assert.ok(x.score >= 0 && x.score <= 1);
  });
  assert.equal(resultat.urgence, null);
  assert.deepEqual(analyse("je dors dehors ce soir").besoins, [{besoin: "logement", score: .89}]);
});

test("chaque catégorie du lexique comprend une formulation courante", () => {
  const cas = [
    ["je n'ai rien à manger", "manger"],
    ["je cherche un toit", "logement"],
    ["je suis au chômage", "travail"],
    ["je comprends rien à mes papiers", "papiers"],
    ["je dois voir un médecin", "sante"],
    ["je suis étudiant", "jeunes"],
    ["j'ai besoin de parler", "parler"],
    ["j'ai besoin d'aide pour mes enfants", "famille"],
    ["je ne me sens pas en sécurité", "securite"],
    ["je sais pas où aller", "autre"],
  ];
  cas.forEach(([phrase, attendu]) => {
    assert.ok(ids(phrase).includes(attendu), `${phrase} → ${ids(phrase).join(", ")}`);
  });
});

test("l'argot français est compris sans vocabulaire administratif", () => {
  assert.ok(ids("j'ai la dalle").includes("manger"));
  assert.ok(ids("g plus de thune").includes("travail"));
  assert.ok(ids("je suis fauché et à sec").includes("travail"));
  assert.ok(ids("mes parents m'ont viré de chez moi").includes("logement"));
});

test("le SMS et les fautes raisonnables restent lisibles", () => {
  const cas = [
    ["g faim", "manger"],
    ["jsp ou aller", "autre"],
    ["je dors dehor", "logement"],
    ["besoin taf", "travail"],
    ["besoin dun appart", "logement"],
    ["jpp de tout", "parler"],
  ];
  cas.forEach(([phrase, attendu]) => {
    assert.ok(ids(phrase).includes(attendu), `${phrase} → ${ids(phrase).join(", ")}`);
  });
});

test("accents, apostrophes, tirets et ponctuation sont normalisés", () => {
  const formes = [
    "ÉTUDIANT — j’ai besoin d’une bourse !",
    "je n'ai pas d'argent",
    "je cherche de l’aide pour l’état-civil",
    "où me laver ?",
  ];
  formes.forEach((phrase) => {
    const normalisee = MOTEUR.normaliser(phrase);
    assert.equal(normalisee, normalisee.toLowerCase());
    assert.doesNotMatch(normalisee, /[à-ÿ’'—!?]/i);
  });
  assert.ok(ids("etudiant sans argent").includes("jeunes"));
  assert.ok(ids("etudiant sans argent").includes("travail"));
  assert.ok(ids("je cherche de l’aide pour l’etat-civil").includes("papiers"));
});

test("les formulations implicites des exemples sont reconnues", () => {
  assert.ok(ids("ma mère m'a viré de chez elle").includes("logement"));
  assert.ok(ids("j'ai quitté la fac je sais pas quoi faire").includes("jeunes"));
  assert.deepEqual(ids("azerty qwerty"), []);
});

test("une phrase multi-besoins conserve les trois demandes", () => {
  const resultat = analyse("je suis étudiant j'ai plus d'argent et rien à manger");
  assert.deepEqual(new Set(resultat.besoins.map((x) => x.besoin)),
    new Set(["jeunes", "travail", "manger"]));
  resultat.besoins.forEach((x) => assert.ok(x.score >= .5));
});

test("un signal générique Autre ne masque pas un besoin précis", () => {
  assert.deepEqual(ids("je sais pas où aller"), ["autre"]);
  assert.deepEqual(ids("je sais pas où aller pour manger"), ["manger"]);
  assert.ok(!ids("j'ai perdu mes papiers").includes("autre"));
});

test("une formulation ambiguë garde les lectures plausibles", () => {
  const resultat = analyse("je vais mal");
  const trouves = new Set(resultat.besoins.map((x) => x.besoin));
  assert.ok(trouves.has("sante"));
  assert.ok(trouves.has("parler"));
  assert.ok(resultat.besoins.every((x) => x.score <= 1));
});

test("l'urgence est détectée avant la classification normale", () => {
  const suivi = analyse("mon ex me suit quand je rentre");
  assert.equal(suivi.urgence.detectee, true);
  assert.equal(suivi.urgence.score, .99);
  assert.ok(suivi.urgence.signaux.includes("mon ex me suit"));
  assert.deepEqual(ids("mon ex me suit quand je rentre"), ["securite"]);

  const dehors = analyse("je dors dehors ce soir");
  assert.equal(dehors.urgence.detectee, true);
  assert.ok(dehors.besoins.some((x) => x.besoin === "logement"));
});

test("un numéro isolé ne transforme pas l'âge en problème de sécurité", () => {
  assert.ok(ids("j'ai 17 ans").includes("jeunes"));
  assert.ok(!ids("j'ai 17 ans").includes("securite"));
  assert.ok(ids("appelle le 17, je suis en danger").includes("securite"));
  assert.ok(ids("17").includes("securite"));
  assert.equal(MOTEUR.detecterUrgence("j'ai 17 ans"), null);
});

test("le lexique ne classe pas les structures et ne crée pas de faux positif", () => {
  assert.deepEqual(ids("Boulangerie Croix-Rouge"), []);

  const commerce = {
    titre: "Boulangerie Croix-Rouge",
    cat: "commerce",
    tags: { shop: "bakery" },
  };
  assert.equal(AIDE.estSolution(commerce, ["manger"]), false,
    "le nom d'un commerce ne vaut pas une preuve d'aide alimentaire");

  const aide = {
    titre: "Distribution alimentaire Croix-Rouge",
    cat: "alimentaire",
    tags: { social_facility: "food_bank" },
  };
  assert.equal(AIDE.estSolution(aide, ["manger"]), true,
    "une preuve structurelle continue de fonctionner");
});

test("l'intégration garde les identifiants et le classement Aide existants", () => {
  assert.equal(AIDE.detecterBesoins, MOTEUR.detecterBesoins);
  assert.equal(AIDE.intentions("j'ai quitté la fac je sais pas quoi faire").primaryNeed, "jeunes");
  assert.equal(AIDE.intentions("g plus de thune").primaryNeed, "travail");
  assert.equal(AIDE.intentions("j'ai 19 ans et je trouve pas de travail").primaryNeed, "travail");
  assert.equal(AIDE.estUrgent("mon ex me suit"), true);
});
