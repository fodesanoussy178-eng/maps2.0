import assert from "node:assert/strict";
import test from "node:test";

import "../comprendre.js";
import "../aide.js";
import "../donnees.js";
import "../signaux.js";

const A = globalThis.AutourAide;
const D = globalThis.AutourDonnees;

const besoins = (phrase) => A.besoinsDepuisPhrase(phrase).map((x) => x.id);

const MATRICE_AIDE = Object.freeze({
  manger: ["j’ai faim", "j’ai plus rien à manger", "nourriture gratuite",
    "distribution alimentaire", "je dois nourrir mes enfants"],
  logement: ["je dors dehors", "je risque l’expulsion", "j’ai pas de logement",
    "je peux plus payer mon loyer", "hébergement ce soir"],
  travail: ["j’ai 20 ans et pas de travail", "je cherche une formation",
    "j’ai des dettes", "j’ai plus d’argent", "aide financière"],
  papiers: ["je comprends rien à mes papiers", "titre de séjour", "CAF",
    "déclaration", "j’ai besoin d’aide pour remplir un dossier"],
  sante: ["je cherche une pharmacie", "je dois voir un médecin", "je cherche un hôpital",
    "j’ai mal aux dents", "je n’ai pas de mutuelle", "je n’ai pas de sécurité sociale",
    "je n’ai pas d’argent pour me soigner"],
  jeunes: ["étudiant sans ressources", "j’ai besoin d’orientation", "je cherche le CROUS",
    "je cherche la Mission Locale", "je cherche une bourse", "je suis en décrochage scolaire"],
  parler: ["j’ai besoin d’un psy", "je cherche un psy gratuit", "je me sens seul",
    "je fais de l’anxiété", "j’ai besoin d’écoute", "je suis en déprime",
    "je fais une crise d’angoisse"],
  famille: ["je suis enceinte", "je cherche une garde d’enfant",
    "j’ai besoin d’aide à la parentalité", "je vis une séparation",
    "j’ai besoin d’aide pour mes enfants"],
  securite: ["je subis des violences", "je suis harcelé", "j’ai été agressé",
    "j’ai besoin de protection"],
  autre: ["je sais pas où aller", "je suis perdu et j’ai besoin d’aide",
    "je ne connais pas les dispositifs", "quelqu’un peut m’orienter"],
  hygiene: ["je voudrais prendre une douche", "où me laver", "j’ai besoin de toilettes",
    "je veux laver mes vêtements"],
  vetements: ["j’ai besoin de vêtements", "où trouver un manteau",
    "je cherche un vestiaire", "je n’ai pas de chaussures"],
});

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

test("toute la matrice de formulations Aide est comprise", () => {
  Object.entries(MATRICE_AIDE).forEach(([attendu, phrases]) => {
    phrases.forEach((phrase) => assert.ok(besoins(phrase).includes(attendu),
      phrase + " → " + besoins(phrase).join(", ") + " (attendu " + attendu + ")"));
  });
});

test("chaque besoin conduit à plusieurs types de solutions attestées", () => {
  const solutions = {
    manger: [
      {titre:"Restos du Cœur",cat:"alimentaire"},
      {titre:"Distribution alimentaire du quartier",cat:"collecte"},
      {titre:"Épicerie solidaire",cat:"alimentaire"},
    ],
    logement: [
      {titre:"Hébergement d’urgence",cat:"hebergement"},
      {titre:"Action Logement",cat:"asso"},
      {titre:"ADIL du département",cat:"asso"},
    ],
    travail: [
      {titre:"Mission Locale",cat:"emploi"},
      {titre:"France Travail",cat:"emploi"},
      {titre:"Cap Emploi",cat:"emploi"},
    ],
    papiers: [
      {titre:"France Services accès aux droits",cat:"emploi"},
      {titre:"Préfecture",cat:"mairie"},
      {titre:"Point d’accès au droit",cat:"asso"},
    ],
    jeunes: [
      {titre:"CROUS",cat:"asso"},
      {titre:"Mission Locale",cat:"emploi"},
      {titre:"Point Information Jeunesse",cat:"asso"},
    ],
    parler: [
      {titre:"CMP du secteur",cat:"sante"},
      {titre:"Point écoute jeunes",cat:"asso"},
      {titre:"SOS Amitié",cat:"asso"},
    ],
    famille: [
      {titre:"CAF",cat:"asso"},
      {titre:"PMI Protection maternelle",cat:"sante"},
      {titre:"Planning Familial",cat:"sante"},
    ],
    securite: [
      {titre:"France Victimes",cat:"asso"},
      {titre:"Commissariat",cat:"mairie"},
      {titre:"Planning Familial",cat:"sante"},
    ],
    autre: [
      {titre:"Centre social",cat:"asso"},
      {titre:"CCAS",cat:"mairie"},
      {titre:"Maison France Services",cat:"mairie"},
    ],
    hygiene: [
      {titre:"Bains-douches municipaux",cat:"toilettes"},
      {titre:"Accueil de jour avec douches",cat:"asso"},
      {titre:"Croix-Rouge - espace hygiène",cat:"asso"},
    ],
    vetements: [
      {titre:"Vestiaire solidaire",cat:"friperie"},
      {titre:"Secours Populaire - vêtements",cat:"asso"},
      {titre:"Croix-Rouge - vestiaire",cat:"asso"},
    ],
  };
  Object.entries(solutions).forEach(([besoin, lieux]) => {
    assert.ok(lieux.length >= 3 && new Set(lieux.map((lieu) => lieu.titre)).size >= 3,
      besoin + " doit couvrir plusieurs types de structures");
    lieux.forEach((lieu) => assert.equal(A.estSolution(lieu,[besoin]),true,
      lieu.titre + " doit être une solution pertinente pour " + besoin));
  });
});

test("les catégories larges ne deviennent jamais des promesses d’aide", () => {
  const horsSujet = [
    [{titre:"Le Restaurant du coin",cat:"resto"},"manger"],
    [{titre:"Association culturelle du quartier",cat:"asso"},"logement"],
    [{titre:"Agence d’intérim",cat:"emploi"},"papiers"],
    [{titre:"Bibliothèque municipale",cat:"biblio"},"jeunes"],
    [{titre:"Pharmacie Centrale",cat:"sante"},"parler"],
    [{titre:"Cabinet médical",cat:"sante"},"famille"],
    [{titre:"Clinique privée",cat:"sante"},"securite"],
    [{titre:"Association culturelle",cat:"asso"},"autre"],
    [{titre:"Foyer sans service documenté",cat:"hebergement"},"hygiene"],
    [{titre:"Boutique vintage",cat:"friperie"},"vetements"],
  ];
  horsSujet.forEach(([lieu, besoin]) => assert.equal(A.estSolution(lieu,[besoin]),false,
    lieu.titre + " ne doit pas être affirmé comme aide " + besoin));
});

test("les formulations santé deviennent des sous-intentions invisibles précises", () => {
  const cas = [
    ["je cherche une pharmacie", "sante", ["medicaments"]],
    ["j’ai mal aux dents", "sante", ["dentaire"]],
    ["je dois voir un médecin", "sante", ["soins"]],
    ["j’ai besoin d’un psy", "parler", ["mentale"]],
    ["je cherche un psy gratuit", "parler", ["mentale", "acces"]],
    ["je fais des crises d’angoisse", "parler", ["mentale"]],
    ["je n’ai pas de mutuelle", "sante", ["acces"]],
    ["je n’ai pas de sécurité sociale", "sante", ["acces"]],
    ["je n’ai pas d’argent pour me soigner", "sante", ["soins", "acces"]],
  ];
  cas.forEach(([phrase, besoin, intentions]) => {
    assert.equal(besoins(phrase)[0], besoin, phrase + " doit d'abord viser " + besoin);
    const trouves = A.intentionsSanteDepuisPhrase(phrase).map((x) => x.id);
    intentions.forEach((id) => assert.ok(trouves.includes(id), phrase + " doit reconnaître " + id));
  });
});

test("les sous-intentions santé rejettent les lieux médicaux hors sujet", () => {
  const pharmacie = {titre:"Pharmacie Centrale", cat:"sante", type:"pharmacy"};
  const hopital = {titre:"Hôpital Saint-Louis", cat:"sante", type:"general_hospital"};
  const dentiste = {titre:"Cabinet dentaire", cat:"sante", type:"dental_clinic"};
  const laboratoire = {titre:"Laboratoire médical", cat:"sante", type:"medical_lab"};
  assert.equal(A.estSolutionSante(pharmacie,["medicaments"]), true);
  assert.equal(A.estSolutionSante(pharmacie,["mentale"]), false);
  assert.equal(A.estSolutionSante(hopital,["hopital"]), true);
  assert.equal(A.estSolutionSante(hopital,["dentaire"]), false);
  assert.equal(A.estSolutionSante(dentiste,["dentaire"]), true);
  assert.equal(A.estSolutionSante(laboratoire,["depistage"]), true);
});

test("une demande de soins gratuits exclut un cabinet privé sans preuve", () => {
  const prive = {titre:"Cabinet Psychologue Martin", cat:"sante", type:"doctor"};
  const cmp = {titre:"CMP Centre médico-psychologique", cat:"sante", tags:{healthcare:"psychotherapist"}};
  const pass = {titre:"PASS - Permanence d'accès aux soins", cat:"sante"};
  assert.equal(A.estSolutionSante(prive,["mentale"]), true,
    "un psychologue reste pertinent quand la gratuité n'est pas demandée");
  assert.equal(A.estSolutionSante(prive,["mentale","acces"]), false,
    "privé ne veut jamais dire gratuit");
  assert.equal(A.estSolutionSante(cmp,["mentale","acces"]), true);
  assert.equal(A.estSolutionSante(pass,["soins","acces"]), true);
  assert.equal(A.estSolutionSante({titre:"PAEJ du centre",cat:"sante"},["mentale","acces"]), false,
    "un point d'écoute reste pertinent, mais n'est pas déclaré gratuit sans preuve locale");
  assert.equal(A.accesAdapteSante({titre:"Cabinet médical",cat:"sante",tags:{fee:"no"}}), true,
    "fee=no est une preuve explicite");
});

test("les publics santé mentale connus restent conditionnels", () => {
  assert.match(A.conditionDe({titre:"CMPP de quartier"}).texte, /enfants.*adolescents/i);
  assert.match(A.conditionDe({titre:"BAPU Lille"}).texte, /[ée]tudiants/i);
  assert.deepEqual(A.conditionDe({titre:"PAEJ du centre"}).age, {min:12,max:25});
  assert.equal(A.conditionDe({titre:"Psychologue privé"}), null,
    "aucun public n'est inventé pour un cabinet privé");
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
  // dix cases à l'écran ; le modèle en garde plus — hygiène, vêtements et
  // mobilité restent reconnus dans une phrase sans occuper de case
  assert.equal(A.BESOINS_GRILLE.length, 10);
  assert.deepEqual(A.BESOINS.filter((b) => b.horsGrille).map((b) => b.id),
    ["mobilite", "hygiene", "vetements"]);
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
  assert.equal(asso.direct, false, "une association générique n'est pas une réponse ciblée");
  assert.equal(A.estSolution({titre: "Association du quartier", cat: "asso"}, ["travail"]), false);
  assert.equal(A.estSolution({titre: "Mission Locale", cat: "emploi"}, ["travail"]), true);
  assert.equal(A.estSolution({titre: "Atelier cuisine du quartier", cat: "food",
    description: "Apprenez à cuisiner ensemble."}, ["manger"]), false,
  "un atelier culinaire n'est pas une aide alimentaire sans source qui l'atteste");

  const hors = A.pertinence({titre: "Le Bistrot", cat: "resto"}, "travail");
  assert.equal(hors.poids, 0);
});

test("le rendez-vous est affiché seulement lorsqu'une source l'affirme", () => {
  assert.deepEqual(A.rendezVousDe({tags:{appointment:"no"}}),
    {label:"Sans rendez-vous", source:"OpenStreetMap"});
  assert.deepEqual(A.rendezVousDe({description:"Accueil sur rendez-vous"}),
    {label:"Sur rendez-vous", source:"Structure"});
  assert.equal(A.rendezVousDe({titre:"Maison du quartier"}), null);
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
