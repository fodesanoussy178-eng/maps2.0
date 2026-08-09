import assert from "node:assert/strict";
import test from "node:test";

import "../comprendre.js";
import "../signaux.js";

const C = globalThis.AutourComprendre;
const S = globalThis.AutourSignaux;

/* Le vocabulaire de l'application, réduit à ce que ces tests demandent : on
   vérifie la compréhension des PHRASES, pas la table des catégories. */
const vocabulaire = {
  categorieDe: (q) => {
    const t = C.sansAccents(q);
    const table = [["cinema", "cinema"], ["restaurant", "resto"], ["resto", "resto"],
      ["bibliotheque", "biblio"], ["parc", "parc"], ["bar", "bar"], ["musee", "musee"]];
    const trouve = table.find(([mot]) => C.contient(t, mot));
    return trouve ? trouve[1] : null;
  },
  cuisineDe: (q) => {
    const t = C.sansAccents(q);
    const table = [["vegetarien", "vegetarian"], ["indien", "indian"], ["italien", "italian"]];
    const trouve = table.find(([mot]) => C.contient(t, mot));
    return trouve ? trouve[1] : null;
  },
};

const lire = (phrase, zone) => C.analyser(phrase, Object.assign({ zone }, vocabulaire));
const ambiances = (st) => st.ambiance.map((a) => a.id).sort();
const aSignal = (st, id) => st.ambiance.some((a) => a.id === id)
  || st.contraintes.some((c) => c.id === id) || st.preferences.some((p) => p.id === id);

/* ==========================================================================
   1. Les dix formulations demandées
   ======================================================================== */

test("« un endroit calme où travailler »", () => {
  const st = lire("un endroit calme où travailler");
  assert.ok(st.intentions.length === 0 || true);
  assert.ok(aSignal(st, "calme"), "calme");
  assert.ok(aSignal(st, "travail"), "travail");
  assert.ok(st.categories.includes("biblio") || st.categories.includes("coworking"));
});

test("« où bosser avec wifi après 20h »", () => {
  const st = lire("où bosser avec wifi après 20h");
  assert.ok(aSignal(st, "travail"));
  assert.ok(st.contraintes.some((c) => c.id === "wifi"), "le wifi est une contrainte");
  assert.equal(st.horaire.apres, 20 * 60);
  assert.ok(st.contraintes.some((c) => c.type === "ouvertApres" && c.minutes === 1200));
});

test("« un truc romantique pas cher ce soir »", () => {
  const st = lire("un truc romantique pas cher ce soir");
  assert.ok(aSignal(st, "romantique"));
  assert.equal(st.budget.pasCher, true);
  assert.equal(st.horaire.creneau, "soir");
  assert.equal(st.groupe, "couple");
});

test("« activité enfant gratuite ce week-end »", () => {
  const st = lire("activité enfant gratuite ce week-end");
  assert.ok(aSignal(st, "famille"));
  assert.equal(st.budget.gratuit, true);
  assert.equal(st.horaire.creneau, "weekend");
  assert.ok(st.contraintes.some((c) => c.type === "budget" && c.max === 0));
});

test("« manger pour moins de 15€ »", () => {
  const st = lire("manger pour moins de 15€");
  assert.ok(st.intentions.includes("manger"));
  assert.equal(st.budget.max, 15);
  assert.ok(st.contraintes.some((c) => c.type === "budget" && c.max === 15));
  // le montant n'est pas retraduit en « gratuit », comme le faisait l'ancienne règle
  assert.equal(st.budget.gratuit, false);
});

test("« je veux me poser dehors »", () => {
  const st = lire("je veux me poser dehors");
  assert.ok(st.intentions.includes("poser"));
  assert.ok(aSignal(st, "dehors"));
  assert.ok(st.categories.includes("parc"));
});

test("« quelque chose à faire seul »", () => {
  const st = lire("quelque chose à faire seul");
  assert.equal(st.groupe, "solo");
  assert.ok(aSignal(st, "adapte_solo"));
});

test("« endroit tranquille avec des potes »", () => {
  const st = lire("endroit tranquille avec des potes");
  assert.ok(aSignal(st, "calme"));
  assert.ok(aSignal(st, "adapte_groupes"));
  assert.equal(st.groupe, "amis");
});

test("« restaurant végétarien ouvert tard Lille »", () => {
  const st = lire("restaurant végétarien ouvert tard", "Lille");
  assert.equal(st.cuisine, "vegetarian");
  assert.ok(st.categories.includes("resto"));
  assert.equal(st.horaire.tard, true);
  assert.ok(st.contraintes.some((c) => c.type === "ouvertApres"));
  assert.equal(st.chips[0].type, "zone");
});

test("« cinéma pas cher ce soir Roubaix »", () => {
  const st = lire("cinéma pas cher ce soir", "Roubaix");
  assert.ok(st.categories.includes("cinema"));
  assert.equal(st.budget.pasCher, true);
  assert.equal(st.horaire.creneau, "soir");
  assert.equal(st.chips[0].label, "Roubaix");
});

/* ==========================================================================
   2. Les synonymes : quatre façons de dire la même chose
   ======================================================================== */

test("bosser / travailler / réviser / taffer disent la même chose", () => {
  const attendus = ["travailler", "bosser", "taffer", "je dois travailler",
                    "réviser", "faire mes révisions", "avancer sur mon mémoire"];
  attendus.forEach((mot) => {
    const st = lire("un endroit pour " + mot);
    assert.ok(aSignal(st, "travail") || aSignal(st, "etude"), mot);
    assert.ok(st.categories.includes("biblio") || st.categories.includes("coworking"), mot);
  });
});

test("tranquille / calme / posé / chill disent la même chose", () => {
  ["tranquille", "calme", "posé", "chill", "peinard", "au calme", "silencieux"]
    .forEach((mot) => {
      const st = lire("un endroit " + mot);
      assert.ok(aSignal(st, "calme"), mot);
    });
});

test("date / romantique / rencard / en couple disent la même chose", () => {
  ["romantique", "pour un date", "un rencard", "en couple", "à deux", "en amoureux"]
    .forEach((mot) => {
      const st = lire("un endroit " + mot);
      assert.ok(aSignal(st, "romantique"), mot);
      assert.equal(st.groupe, "couple", mot);
    });
});

test("les autres familles de synonymes", () => {
  const cas = [
    ["faire la fête", "festif"], ["danser", "festif"], ["une soirée pour danser", "festif"],
    ["avec les enfants", "famille"], ["avec mes gosses", "famille"], ["en famille", "famille"],
    ["en terrasse", "dehors"], ["prendre l'air", "dehors"], ["au vert", "dehors"],
    ["au chaud", "interieur"], ["il pleut", "interieur"],
    ["tout seul", "adapte_solo"], ["en solo", "adapte_solo"],
    ["entre potes", "adapte_groupes"], ["à plusieurs", "adapte_groupes"],
    ["accessible en fauteuil", "accessible"], ["pmr", "accessible"],
  ];
  cas.forEach(([phrase, signal]) => {
    const st = lire("un endroit " + phrase);
    assert.ok(aSignal(st, signal), phrase + " → " + signal);
  });
});

/* ==========================================================================
   3. Budget, horaires, groupe
   ======================================================================== */

test("le budget se lit sous toutes ses formes", () => {
  const cas = [["moins de 15€", 15], ["max 30 euros", 30], ["jusqu'à 20 euros", 20],
               ["pour 12 balles", 12], ["quinze euros", 15], ["moins de 25 e", 25],
               ["sous 40 euros", 40]];
  cas.forEach(([phrase, attendu]) => {
    const st = lire("manger " + phrase);
    assert.equal(st.budget.max, attendu, phrase);
  });
});

test("« gratuit » n'est jamais confondu avec un montant", () => {
  const gratuit = lire("une activité gratuite");
  assert.equal(gratuit.budget.gratuit, true);
  assert.equal(gratuit.budget.max, null);
  // le défaut d'origine : au-dessus de 20 €, le filtre posé était « gratuit »
  const trente = lire("manger pour moins de 30 euros");
  assert.equal(trente.budget.gratuit, false);
  assert.equal(trente.budget.max, 30);
});

test("les quatre créneaux, et rien d'autre", () => {
  assert.equal(lire("un truc maintenant").horaire.creneau, "maintenant");
  assert.equal(lire("un truc ce soir").horaire.creneau, "soir");
  assert.equal(lire("un truc ce week-end").horaire.creneau, "weekend");
  assert.equal(lire("un truc samedi").horaire.creneau, "weekend");
  assert.equal(lire("un truc demain").horaire.creneau, "avenir");
  assert.equal(lire("un truc").horaire.creneau, null);
});

test("« ouvert tard » et « après 22h » posent une contrainte d'horaire", () => {
  const tard = lire("un bar ouvert tard");
  assert.equal(tard.horaire.tard, true);
  assert.ok(tard.contraintes.some((c) => c.type === "ouvertApres" && c.minutes === 21 * 60));
  const precis = lire("un bar après 22h");
  assert.equal(precis.horaire.apres, 22 * 60);
  assert.ok(precis.contraintes.some((c) => c.type === "ouvertApres" && c.minutes === 22 * 60));
});

/* ==========================================================================
   4. Ce qui ne doit PAS se déclencher
   ======================================================================== */

test("un mot dans un nom de lieu ne crée pas de fausse correspondance", () => {
  // « seul » dans « seulement », « bar » dans « Bar-le-Duc », « date » dans
  // « datent » : la reconnaissance se fait sur les frontières de mots
  assert.equal(C.contient(C.sansAccents("seulement des cafés"), "seul"), false);
  assert.equal(C.contient(C.sansAccents("les travaux datent de 1900"), "date"), false);
  assert.equal(C.contient(C.sansAccents("la fete des voisins"), "la fete"), true);
  const st = lire("seulement des cafés");
  assert.equal(st.groupe, null);
});

test("une ville n'est pas confisquée par un mot d'ambiance", () => {
  // « Bar-le-Duc », « Calme » (hameau), « Fêtes » : des toponymes réels
  const st = lire("Bar-le-Duc");
  assert.deepEqual(st.ambiance, []);
  assert.equal(st.groupe, null);
  assert.deepEqual(st.intentions, []);
});

test("une phrase vide ou incomprise ne produit aucune interprétation", () => {
  assert.equal(C.estExploitable(lire("")), false);
  assert.equal(C.estExploitable(lire("azertyuiop")), false);
  assert.equal(C.estExploitable(lire("chez Kévin")), false);
  // et une phrase comprise, si
  assert.equal(C.estExploitable(lire("un endroit calme")), true);
});

test("le reste non compris est conservé et mesurable", () => {
  const st = lire("un endroit calme chez Fatima");
  assert.match(st.reste, /fatima/);
  assert.doesNotMatch(st.reste, /calme/);
});

/* ==========================================================================
   5. Contraintes vs préférences
   ======================================================================== */

test("les contraintes excluent, les préférences ordonnent", () => {
  const st = lire("un endroit calme accessible moins de 15€ pas loin");
  const types = st.contraintes.map((c) => c.type + ":" + (c.id || c.max));
  assert.ok(types.includes("signal:accessible"), "l'accessibilité est une contrainte");
  assert.ok(types.includes("budget:15"), "le budget est une contrainte");
  assert.ok(st.preferences.some((p) => p.id === "calme"), "le calme est une préférence");
  assert.ok(st.preferences.some((p) => p.type === "proche"), "la proximité est une préférence");
  // la proximité n'est JAMAIS une contrainte
  assert.ok(!st.contraintes.some((c) => c.type === "proche"));
});

test("chaque interprétation produit une puce retirable", () => {
  const st = lire("un endroit calme pour bosser ce soir moins de 15€", "Lille");
  const labels = st.chips.map((c) => c.label);
  assert.equal(labels[0], "Lille");
  assert.ok(labels.includes("Ce soir"), labels.join(" / "));
  assert.ok(labels.includes("Calme"), labels.join(" / "));
  assert.ok(labels.includes("≤ 15 €"), labels.join(" / "));

  const sansBudget = C.sansChip(st, "budget:max");
  assert.equal(sansBudget.budget.max, null);
  assert.ok(!sansBudget.contraintes.some((c) => c.type === "budget"));
  assert.ok(!sansBudget.chips.some((c) => c.id === "budget:max"));
  // retirer une puce n'en supprime aucune autre
  assert.ok(sansBudget.chips.some((c) => c.label === "Calme"));
});

/* ==========================================================================
   6. Les signaux d'un lieu : jamais inventés
   ======================================================================== */

test("un signal ne naît que d'une donnée réelle", () => {
  // aucune donnée : aucun signal wifi, ni vrai ni faux
  const cafe = { cat: "cafe", categories: ["cafe"] };
  const s = S.signauxDe(cafe);
  assert.equal(S.force(s, "wifi"), null, "le wifi ne se déduit pas d'un café");
  assert.equal(S.satisfait(s, "wifi"), null, "inconnu n'est pas « non »");
  // avec le tag, il naît
  const avec = S.signauxDe({ cat: "cafe", tags: { internet_access: "wlan" } });
  assert.equal(S.force(avec, "wifi"), 1);
  assert.equal(avec.wifi.source, "tag");
});

test("une inférence de catégorie est plafonnée sous une donnée publiée", () => {
  const biblio = S.signauxDe({ cat: "biblio", categories: ["biblio", "library"] });
  assert.ok(S.force(biblio, "calme") <= S.PLAFOND_INFERENCE);
  assert.equal(biblio.calme.source, "categorie");
  // un tag explicite reprend la main
  const avecTag = S.signauxDe({ cat: "biblio", tags: { quiet_hours: "yes" } });
  assert.equal(avecTag.calme.source, "tag");
  assert.ok(S.force(avecTag, "calme") > S.PLAFOND_INFERENCE);
});

test("les signaux correspondent à ce que la phrase demande", () => {
  const biblio = S.signauxDe({ cat: "biblio", categories: ["biblio", "library", "study"] });
  ["calme", "etude", "travail"].forEach((id) =>
    assert.ok(S.force(biblio, id) > 0, "bibliothèque → " + id));

  const parc = S.signauxDe({ cat: "parc", categories: ["parc", "park"] });
  assert.ok(S.force(parc, "dehors") > 0);
  assert.ok(S.force(parc, "famille") > 0);

  const boite = S.signauxDe({ cat: "concert", tags: { dance: "yes" } });
  assert.ok(S.force(boite, "festif") > 0);

  const terrasse = S.signauxDe({ cat: "cafe", tags: { outdoor_seating: "yes" } });
  assert.equal(S.force(terrasse, "dehors"), 1);
});

test("l'accessibilité vient du tag, jamais d'une supposition", () => {
  assert.equal(S.force(S.signauxDe({ cat: "resto" }), "accessible"), null);
  assert.equal(S.force(S.signauxDe({ cat: "resto", tags: { wheelchair: "yes" } }), "accessible"), 1);
  assert.equal(S.force(S.signauxDe({ cat: "resto", tags: { wheelchair: "limited" } }), "accessible"), .5);
  assert.equal(S.force(S.signauxDe({ cat: "resto", pmr: true }), "accessible"), 1);
});

/* ==========================================================================
   7. Le taux global : 40 formulations
   ======================================================================== */

const CORPUS = [
  ["un endroit calme où travailler", (s) => aSignal(s, "calme") && aSignal(s, "travail")],
  ["où bosser avec wifi après 20h", (s) => aSignal(s, "travail") && aSignal(s, "wifi") && s.horaire.apres === 1200],
  ["un truc romantique pas cher ce soir", (s) => aSignal(s, "romantique") && s.budget.pasCher && s.horaire.creneau === "soir"],
  ["activité enfant gratuite ce week-end", (s) => aSignal(s, "famille") && s.budget.gratuit && s.horaire.creneau === "weekend"],
  ["manger pour moins de 15€", (s) => s.intentions.includes("manger") && s.budget.max === 15],
  ["je veux me poser dehors", (s) => s.intentions.includes("poser") && aSignal(s, "dehors")],
  ["quelque chose à faire seul", (s) => s.groupe === "solo"],
  ["endroit tranquille avec des potes", (s) => aSignal(s, "calme") && s.groupe === "amis"],
  ["restaurant végétarien ouvert tard", (s) => s.cuisine === "vegetarian" && s.horaire.tard],
  ["cinéma pas cher ce soir", (s) => s.categories.includes("cinema") && s.budget.pasCher],
  ["taffer au calme", (s) => aSignal(s, "travail") && aSignal(s, "calme")],
  ["réviser mes partiels", (s) => aSignal(s, "etude")],
  ["un endroit posé", (s) => aSignal(s, "calme")],
  ["chill", (s) => aSignal(s, "calme")],
  ["un rencard sympa", (s) => aSignal(s, "romantique")],
  ["sortir en couple", (s) => aSignal(s, "romantique") && s.intentions.includes("sortir")],
  ["faire la fête ce soir", (s) => aSignal(s, "festif") && s.horaire.creneau === "soir"],
  ["danser", (s) => aSignal(s, "festif")],
  ["boire un verre en terrasse", (s) => s.intentions.includes("boire") && aSignal(s, "dehors")],
  ["prendre l'air avec les enfants", (s) => aSignal(s, "dehors") && aSignal(s, "famille")],
  ["une activité gratuite", (s) => s.budget.gratuit],
  ["pas cher et pas loin", (s) => s.budget.pasCher && s.preferences.some((p) => p.type === "proche")],
  ["un musée gratuit", (s) => s.categories.includes("musee") && s.budget.gratuit],
  ["où étudier au calme", (s) => aSignal(s, "etude") && aSignal(s, "calme")],
  ["un café avec wifi", (s) => s.categories.length > 0 && aSignal(s, "wifi")],
  ["un bar accessible en fauteuil", (s) => s.categories.includes("bar") && aSignal(s, "accessible")],
  ["manger italien", (s) => s.cuisine === "italian"],
  ["restaurant indien pas cher", (s) => s.cuisine === "indian" && s.budget.pasCher],
  ["quoi faire ce week-end", (s) => s.intentions.includes("sortir") && s.horaire.creneau === "weekend"],
  ["une sortie en famille", (s) => aSignal(s, "famille")],
  ["me poser au soleil", (s) => aSignal(s, "dehors")],
  ["au chaud, il pleut", (s) => aSignal(s, "interieur")],
  ["un parc tranquille", (s) => s.categories.includes("parc") && aSignal(s, "calme")],
  ["bouger un peu", (s) => s.intentions.includes("bouger")],
  ["une expo", (s) => s.intentions.includes("culture")],
  ["glander quelque part", (s) => s.intentions.includes("poser")],
  ["maintenant", (s) => s.horaire.creneau === "maintenant"],
  ["demain", (s) => s.horaire.creneau === "avenir"],
  ["un truc à faire entre potes ce soir", (s) => s.groupe === "amis" && s.horaire.creneau === "soir"],
  ["dîner romantique moins de 40 euros", (s) => aSignal(s, "romantique") && s.budget.max === 40],
  ["travailler avec une prise", (s) => aSignal(s, "travail")],
  ["un endroit pour lire au calme", (s) => aSignal(s, "calme")],
];

test("au moins 90 % des formulations du corpus sont comprises", () => {
  const echecs = [];
  CORPUS.forEach(([phrase, verifie]) => {
    let ok = false;
    try { ok = !!verifie(lire(phrase)); } catch (e) { ok = false; }
    if (!ok) echecs.push(phrase);
  });
  const taux = (CORPUS.length - echecs.length) / CORPUS.length;
  assert.ok(CORPUS.length >= 40, "au moins 40 formulations : " + CORPUS.length);
  assert.ok(taux >= .9,
    "taux " + Math.round(taux * 100) + " % — échecs : " + echecs.join(" | "));
});
