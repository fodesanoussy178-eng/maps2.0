/* LE CYCLE D'UN ÉVÉNEMENT — les règles de la machine à phases.

   Le scénario complet Lille → Paris vit dans `moteur-contexte.test.mjs`, avec
   le reste du contrat de recommandation. Ici, on vérifie la machine elle-même :
   les transitions, les deux horloges, et surtout ce qu'elle refuse de faire.

   Les trois refus qui comptent :
     · une phase absente ne s'invente jamais ;
     · aucune phase n'ouvre la porte de « Maintenant » ;
     · une date incertaine ne produit pas de compte à rebours. */
import test from "node:test";
import assert from "node:assert/strict";

await import("../temporel.js");
await import("../cycle-evenement.js");

const C = globalThis.AutourCycle;
const P = C.PHASES;

const HEURE = 36e5;
const JOUR = 24 * HEURE;

/* Un mardi de mars, 10 h du matin à Paris. */
const T = Date.UTC(2026, 2, 10, 9, 0);

function evenement(extra) {
  return Object.assign({
    id: "e", titre: "Concert",
    start_at: new Date(T + 90 * JOUR).toISOString(),
    end_at: new Date(T + 90 * JOUR + 3 * HEURE).toISOString(),
    date_confidence: "exact",
    timezone: "Europe/Paris",
  }, extra || {});
}

/* ==================================================================== */
/*  LES DEUX HORLOGES                                                    */
/* ==================================================================== */

test("l'horloge de l'événement l'emporte sur celle de l'information", () => {
  /* Une billetterie qui ouvre à l'instant, sur un concert dans trois jours.
     Les deux faits sont vrais ; c'est le concert qu'il faut dire. */
  const dans3jours = evenement({
    start_at: new Date(T + 3 * JOUR).toISOString(),
    end_at: new Date(T + 3 * JOUR + 3 * HEURE).toISOString(),
    tickets_open_at: new Date(T - HEURE).toISOString(),
  });
  const phase = C.phase(dans3jours, T);
  assert.equal(phase.phase, P.APPROCHE);
  assert.equal(phase.horloge, "evenement");
  assert.match(phase.libelle, /Dans 3 jours/);
});

test("une phase d'information se dit « information », et jamais autrement", () => {
  const phase = C.phase(evenement({tickets_open_at: new Date(T - HEURE).toISOString()}), T);
  assert.equal(phase.phase, P.BILLETTERIE_OUVERTE);
  assert.equal(phase.horloge, "information");
  /* C'est ce champ qui empêche l'interface d'écrire « ça se passe maintenant »
     au-dessus d'un concert de juin. */
});

test("des billets disponibles ne sont pas un événement en cours", () => {
  const phase = C.phase(evenement({tickets_open_at: new Date(T - HEURE).toISOString()}), T);
  assert.notEqual(phase.phase, P.EN_COURS);
  assert.notEqual(phase.phase, P.JOUR_J);
  assert.ok(phase.debut > T + 80 * JOUR, "le concert reste dans trois mois");
});

/* ==================================================================== */
/*  LE CYCLE, D'UN BOUT À L'AUTRE                                        */
/* ==================================================================== */

test("annonce → prévente → billetterie → approche → jour J → en cours → terminé", () => {
  const dansTroisMois = {start: T + 90 * JOUR};
  const base = (extra, t) => C.phase(evenement(extra), t).phase;

  assert.equal(base({announced_at: new Date(T - HEURE).toISOString()}, T), P.ANNONCE);
  assert.equal(base({presale_at: new Date(T + HEURE).toISOString()}, T), P.PREVENTE);
  assert.equal(base({tickets_open_at: new Date(T + 30 * HEURE).toISOString()}, T), P.BILLETTERIE_BIENTOT);
  assert.equal(base({tickets_open_at: new Date(T - HEURE).toISOString()}, T), P.BILLETTERIE_OUVERTE);
  assert.equal(base({}, T), P.A_VENIR);

  const jour = (dans) => C.phase({
    start_at: new Date(T + dans).toISOString(),
    end_at: new Date(T + dans + 3 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  }, T).phase;
  assert.equal(jour(3 * JOUR), P.APPROCHE);
  assert.equal(jour(10 * HEURE), P.JOUR_J);
  assert.equal(jour(-HEURE), P.EN_COURS);
  assert.equal(jour(-5 * JOUR), P.TERMINE);
  assert.ok(dansTroisMois.start > T);
});

test("chaque phase du cycle a un nom, et le cycle les contient toutes", () => {
  Object.values(P).forEach((phase) => assert.ok(C.CYCLE.includes(phase),
    phase + " manque au cycle déclaré"));
  assert.equal(C.CYCLE[0], P.ANNONCE);
  assert.equal(C.CYCLE[C.CYCLE.length - 1], P.TERMINE);
});

test("le wording change à chaque transition", () => {
  const dit = (dans) => C.phase({
    start_at: new Date(T + dans).toISOString(),
    end_at: new Date(T + dans + 3 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  }, T).libelle;
  assert.match(dit(3 * JOUR), /Dans 3 jours/);
  assert.match(dit(2 * JOUR), /Dans 2 jours/);
  assert.match(dit(JOUR), /Demain/);
  assert.match(dit(10 * HEURE), /Ce soir/);
  assert.match(dit(-HEURE), /En cours/);
  assert.equal(dit(-5 * JOUR), "Terminé");
});

test("« demain » est le lendemain civil, pas « dans vingt-quatre heures »", () => {
  /* À 23 h, un concert à 8 h le lendemain est « demain » et non « dans 9 h ».
     C'est ainsi qu'on en parle, et c'est ce qui rend la phrase juste juste
     après minuit. */
  const tard = Date.UTC(2026, 2, 10, 22, 0);          // 23 h à Paris
  const demainMatin = Date.UTC(2026, 2, 11, 7, 0);    //  8 h le lendemain
  const phase = C.phase({
    start_at: new Date(demainMatin).toISOString(),
    end_at: new Date(demainMatin + 3 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  }, tard);
  assert.equal(phase.phase, P.APPROCHE);
  assert.match(phase.libelle, /Demain/);
  assert.equal(phase.joursRestants, 1);
});

/* ==================================================================== */
/*  CE QUE LA MACHINE REFUSE DE FAIRE                                    */
/* ==================================================================== */

test("une phase absente ne s'invente jamais", () => {
  /* Pas de `tickets_open_at` publié, pas de phase billetterie. L'événement
     passe directement à « à venir ». Annoncer une billetterie qui n'ouvre pas
     coûte une attente devant un site vide. */
  const phase = C.phase(evenement({}), T);
  assert.equal(phase.phase, P.A_VENIR);
  assert.equal(phase.libelle, null, "rien de particulier à dire : on ne dit rien");
});

test("sans date de début, il n'y a pas de cycle du tout", () => {
  assert.equal(C.phase({titre: "un événement sans date"}, T), null);
});

test("une date incertaine ne produit pas de compte à rebours", () => {
  /* « Du 10 au 15 août », sans heure. Annoncer « dans 3 jours » donnerait une
     précision qu'on n'a pas — c'est la règle de la couche canonique, et elle
     vaut ici aussi. */
  const flou = C.phase({
    start_at: new Date(T + 3 * JOUR).toISOString(),
    end_at: new Date(T + 5 * JOUR).toISOString(),
    date_confidence: "day", timezone: "Europe/Paris",
  }, T);
  assert.notEqual(flou.phase, P.APPROCHE);
  assert.equal(flou.joursRestants, null);
});

test("un événement annulé est terminé, et le dit", () => {
  const phase = C.phase(evenement({cancelled: true}), T);
  assert.equal(phase.phase, P.TERMINE);
  assert.equal(phase.annule, true);
  assert.equal(phase.urgence, 0);
  assert.equal(phase.libelle, "Annulé");
});

test("commencé sans fin connue : ni « en cours » affirmé, ni « terminé »", () => {
  /* La couche canonique refuse de conclure quand la fin manque. Ce module ne
     la contredit pas : il n'invente pas de fin pour fermer l'événement, et il
     n'en invente pas non plus pour le garder ouvert indéfiniment à pleine
     urgence. */
  const phase = C.phase({
    start_at: new Date(T - HEURE).toISOString(), end_at: null,
    date_confidence: "exact", timezone: "Europe/Paris",
  }, T);
  assert.equal(phase.phase, P.EN_COURS);
  assert.ok(phase.urgence < C.URGENCE[P.EN_COURS], "moins sûr, donc moins fort");
  assert.equal(phase.expireLe, null);
});

/* ==================================================================== */
/*  LA DISTANCE CHANGE CE QU'UNE PHASE VEUT DIRE                         */
/* ==================================================================== */

test("le jour J d'un événement lointain presse moins", () => {
  const jourJ = C.phase({
    start_at: new Date(T + 10 * HEURE).toISOString(),
    end_at: new Date(T + 13 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  }, T);
  const acote = C.urgenceAjustee(jourJ, 800);
  const loin = C.urgenceAjustee(jourJ, 220e3);
  assert.ok(loin < acote, "on ne part pas à 220 km sur un coup de tête");
  assert.ok(loin > 50, "mais l'information reste, seule l'injonction s'en va");
});

test("l'approche d'un événement lointain presse PLUS", () => {
  /* C'est précisément à trois jours et à deux cents kilomètres qu'il faut
     s'organiser. Les deux règles disent la même chose : un déplacement
     lointain se prépare et ne s'improvise pas. */
  const approche = C.phase({
    start_at: new Date(T + 3 * JOUR).toISOString(),
    end_at: new Date(T + 3 * JOUR + 3 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  }, T);
  assert.ok(C.urgenceAjustee(approche, 220e3) > C.urgenceAjustee(approche, 800));
});

test("une distance inconnue ne pénalise rien", () => {
  const phase = C.phase(evenement({tickets_open_at: new Date(T - HEURE).toISOString()}), T);
  assert.equal(C.urgenceAjustee(phase, null), phase.urgence);
  assert.equal(C.urgenceAjustee(phase, "loin"), phase.urgence);
});

/* ==================================================================== */
/*  LA BASCULE VERS « MAINTENANT »                                       */
/* ==================================================================== */

test("un événement imminent et proche quitte « Pour toi »", () => {
  assert.equal(C.basculeVersMaintenant("soon", 900), true);
  assert.equal(C.basculeVersMaintenant("now", 2500), true);
});

test("un événement imminent et LOINTAIN ne bascule pas", () => {
  /* Sans cette règle, un concert parisien imminent quittait « Pour toi » pour
     un « Maintenant » qui le rejetait aussitôt à 220 km : il s'évaporait entre
     deux espaces exactement à l'heure où il comptait le plus. */
  assert.equal(C.basculeVersMaintenant("soon", 220e3), false);
  assert.equal(C.basculeVersMaintenant("now", 220e3), false);
});

test("seule l'horloge de l'événement peut déclencher la bascule", () => {
  /* Une billetterie ouverte, une annonce, une approche : rien de tout cela
     n'est « maintenant », quelle que soit l'urgence. */
  ["upcoming", "today", "tonight", "weekend", "past", "unknown", ""]
    .forEach((statut) => assert.equal(C.basculeVersMaintenant(statut, 100), false, statut));
});

/* ==================================================================== */
/*  UNE SEULE LECTURE, UN SEUL EXEMPLAIRE                                */
/* ==================================================================== */

test("la phase est calculée une fois par objet et mémorisée", () => {
  const e = evenement({tickets_open_at: new Date(T - HEURE).toISOString()});
  const a = C.phaseDe(e, T);
  const b = C.phaseDe(e, T + 60e3);
  assert.equal(a, b, "la même lecture, pas une seconde");
  /* Le cache ne doit apparaître ni dans un JSON ni dans une copie : il n'est
     pas une donnée de l'événement. */
  assert.ok(!Object.keys(e).includes("__cycle"));
  assert.ok(!("__cycle" in JSON.parse(JSON.stringify(e))));
});

test("la phase expire quand elle cesse d'être vraie", () => {
  const e = evenement({tickets_open_at: new Date(T - HEURE).toISOString()});
  const ouverte = C.phaseDe(e, T);
  assert.equal(ouverte.phase, P.BILLETTERIE_OUVERTE);
  assert.ok(ouverte.expireLe > T, "une phase périssable dit quand elle périme");
  const apres = C.phaseDe(e, ouverte.expireLe + 1000);
  assert.equal(apres.phase, P.A_VENIR, "passé sa fenêtre, une nouvelle n'en est plus une");
});

test("une phase d'approche expire au prochain minuit", () => {
  const e = {
    start_at: new Date(T + 3 * JOUR).toISOString(),
    end_at: new Date(T + 3 * JOUR + 3 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  };
  const phase = C.phase(e, T);
  assert.ok(phase.expireLe > T && phase.expireLe <= T + JOUR,
    "« dans 3 jours » doit devenir « dans 2 jours » au changement de date");
});

test("un objet gelé ne fait pas tomber la lecture", () => {
  const e = Object.freeze(evenement({}));
  assert.doesNotThrow(() => C.phaseDe(e, T));
  assert.equal(C.phaseDe(e, T).phase, P.A_VENIR);
});
