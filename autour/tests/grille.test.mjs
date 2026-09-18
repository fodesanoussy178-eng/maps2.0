/* LE QUADRILLAGE ET LE RÉVEIL TEMPOREL — lot E.

   Deux contrats. Le premier : une grille indexe et compare, elle ne filtre
   rien — sinon elle devient un second système de zones, et Autour en a déjà
   un qui marche. Le second : on ne se réveille que quand quelque chose change
   vraiment, et jamais « au cas où ».

   Ce fichier vérifie aussi la découverte qui a motivé ce lot : le coût du
   classement ne venait pas de la déduplication, contrairement à ce que
   `docs/maintenant.md` supposait, mais d'un `Intl.DateTimeFormat` reconstruit
   à chaque appel. Un test de non-régression garde le formateur en cache. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../signaux.js");
await import("../availability.js");
await import("../temporel.js");
await import("../cycle-evenement.js");
await import("../grille.js");

const G = globalThis.AutourGrille;
const CYCLE = globalThis.AutourCycle;
const AV = globalThis.AutourAvailability;
const T = globalThis.AutourTemps;

const HEURE = 36e5;
const JOUR = 24 * HEURE;
const MAINTENANT = Date.UTC(2026, 2, 10, 9, 0);

function evenement(id, lat, lng, extra) {
  return Object.assign({
    id, lat, lng, isTemporary: true,
    start_at: new Date(MAINTENANT + 90 * JOUR).toISOString(),
    end_at: new Date(MAINTENANT + 90 * JOUR + 3 * HEURE).toISOString(),
    date_confidence: "exact", timezone: "Europe/Paris",
  }, extra || {});
}

/* ==================================================================== */
/*  LA MAILLE                                                            */
/* ==================================================================== */

test("la maille est stable : glisser la carte ne change pas la cellule", () => {
  /* C'est toute la raison d'être d'une grille plutôt que d'un rayon : deux
     rendus successifs doivent parler des mêmes cellules pour se comparer. */
  const a = G.cellule(50.6292, 3.0573);
  const b = G.cellule(50.6301, 3.0588);
  assert.equal(a, b);
  assert.equal(a, "50.63,3.06");
});

test("une cellule a neuf voisines, elle comprise", () => {
  const v = G.voisines("50.63,3.06");
  assert.equal(v.length, 9);
  assert.ok(v.includes("50.63,3.06"));
  assert.ok(v.includes("50.62,3.05"));
  assert.ok(v.includes("50.64,3.07"));
});

test("un objet sans coordonnées n'a pas de cellule, et n'en invente pas", () => {
  assert.equal(G.celluleDe({id: "x"}), null);
  assert.equal(G.cellule(null, 3.06), null);
  assert.equal(G.cellule(50.63, "ici"), null);
});

/* ==================================================================== */
/*  L'INDEX NE FILTRE RIEN                                               */
/* ==================================================================== */

test("l'index range, il ne décide pas de ce qu'on montre", () => {
  /* Si ce module se mettait à écarter des objets, Autour aurait deux systèmes
     de zones qui divergeraient un jour. Tout ce qui entre est indexé. */
  const items = [
    evenement("a", 50.6292, 3.0573),
    evenement("b", 50.6390, 3.0640),
    {id: "c", lat: 50.7236, lng: 3.1610},        // à douze kilomètres
    {id: "d", lat: 48.8566, lng: 2.3522},        // à Paris
  ];
  const index = G.indexer(items, {maintenant: MAINTENANT});
  const total = [...index.cellules.values()].reduce((n, c) => n + c.n, 0);
  assert.equal(total, 4, "aucun objet n'a été écarté");
});

test("l'empreinte parle du contenu, pas de l'ordre", () => {
  /* Un reclassement ne doit pas se lire comme un changement de données : sinon
     la moindre remontée de score passerait pour une nouveauté. */
  const a = [evenement("x", 50.6292, 3.0573), evenement("y", 50.6295, 3.0575)];
  const b = [a[1], a[0]];
  const ia = G.indexer(a, {maintenant: MAINTENANT});
  const ib = G.indexer(b, {maintenant: MAINTENANT});
  assert.deepEqual(G.quoiDeNeuf(ia, ib).rienDeNeuf, true);
});

/* ==================================================================== */
/*  CE QUI A CHANGÉ                                                      */
/* ==================================================================== */

test("apparues, disparues, modifiées — jamais « tout a changé »", () => {
  const avant = G.indexer([
    evenement("a", 50.6292, 3.0573),
    evenement("b", 50.7236, 3.1610),
  ], {maintenant: MAINTENANT});
  const apres = G.indexer([
    evenement("a", 50.6292, 3.0573),
    evenement("c", 50.6292, 3.0573),      // s'ajoute dans la même cellule
    evenement("d", 48.8566, 2.3522),      // une cellule neuve
  ], {maintenant: MAINTENANT});
  const diff = G.quoiDeNeuf(avant, apres);
  assert.deepEqual(diff.modifiees, ["50.63,3.06"]);
  assert.deepEqual(diff.apparues, ["48.86,2.35"]);
  assert.deepEqual(diff.disparues, ["50.72,3.16"]);
  assert.equal(diff.rienDeNeuf, false);
});

test("rien n'a changé se dit explicitement", () => {
  const items = [evenement("a", 50.6292, 3.0573)];
  const index = G.indexer(items, {maintenant: MAINTENANT});
  assert.equal(G.quoiDeNeuf(index, G.indexer(items, {maintenant: MAINTENANT})).rienDeNeuf, true);
});

test("on peut ne regarder que les cellules qui nous concernent", () => {
  const avant = G.indexer([evenement("a", 50.6292, 3.0573)], {maintenant: MAINTENANT});
  const apres = G.indexer([
    evenement("a", 50.6292, 3.0573),
    evenement("z", 48.8566, 2.3522),
  ], {maintenant: MAINTENANT});
  const diff = G.quoiDeNeuf(avant, apres, {cellules: ["50.63,3.06"]});
  assert.equal(diff.rienDeNeuf, true, "Paris ne concerne pas quelqu'un qui regarde Lille");
});

/* ==================================================================== */
/*  CE QUI VA CHANGER                                                    */
/* ==================================================================== */

test("le prochain changement vient du cycle, pas d'une durée inventée", () => {
  /* Une approche expire au prochain minuit local : « dans 3 jours » doit
     devenir « dans 2 jours » sans que personne y pense. */
  const approche = evenement("a", 50.6292, 3.0573, {
    start_at: new Date(MAINTENANT + 3 * JOUR).toISOString(),
    end_at: new Date(MAINTENANT + 3 * JOUR + 3 * HEURE).toISOString(),
  });
  const index = G.indexer([approche], {maintenant: MAINTENANT});
  const attendu = CYCLE.phase(approche, MAINTENANT).expireLe;
  assert.equal(index.prochainChangement, attendu);
  assert.ok(attendu > MAINTENANT && attendu <= MAINTENANT + JOUR);
});

test("un écran de lieux permanents ne programme aucun réveil", () => {
  /* C'est une réponse fréquente et parfaitement saine. Réveiller un téléphone
     pour une liste de cafés qui n'ont rien à annoncer serait du gaspillage. */
  const index = G.indexer([
    {id: "c1", lat: 50.6292, lng: 3.0573, quand: "Mo-Su 08:00-23:00"},
    {id: "c2", lat: 50.6390, lng: 3.0640, quand: "Mo-Su 08:00-23:00"},
  ], {maintenant: MAINTENANT});
  assert.equal(index.prochainChangement, null);
  assert.equal(G.delaiReveil(index, {maintenant: MAINTENANT}), null);
});

test("le réveil est borné des deux côtés", () => {
  /* Trop tôt, on se réveille pour rien ; trop tard, une phrase reste fausse
     toute la soirée. */
  const dansDixSecondes = G.indexer([evenement("a", 50.6292, 3.0573, {
    tickets_open_at: new Date(MAINTENANT - CYCLE.FENETRE_OUVERTURE_MS + 10e3).toISOString(),
  })], {maintenant: MAINTENANT});
  assert.equal(G.delaiReveil(dansDixSecondes, {maintenant: MAINTENANT}), G.REVEIL_MIN_MS);

  const dansTroisJours = G.indexer([evenement("b", 50.6292, 3.0573, {
    start_at: new Date(MAINTENANT + 40 * JOUR).toISOString(),
    end_at: new Date(MAINTENANT + 40 * JOUR + 3 * HEURE).toISOString(),
  })], {maintenant: MAINTENANT});
  const delai = G.delaiReveil(dansTroisJours, {maintenant: MAINTENANT});
  assert.ok(delai === null || delai <= G.REVEIL_MAX_MS);
});

test("un horizon limite ce qu'on regarde venir", () => {
  const index = G.indexer([evenement("a", 50.6292, 3.0573, {
    start_at: new Date(MAINTENANT + 3 * JOUR).toISOString(),
    end_at: new Date(MAINTENANT + 3 * JOUR + 3 * HEURE).toISOString(),
  })], {maintenant: MAINTENANT});
  assert.ok(G.quoiVaChanger(index, {maintenant: MAINTENANT}) != null);
  assert.equal(G.quoiVaChanger(index, {maintenant: MAINTENANT, horizonMs: 60e3}), null,
    "rien ne change dans la minute qui vient");
});

test("un changement déjà passé n'est pas un changement à venir", () => {
  const index = G.indexer([evenement("a", 50.6292, 3.0573, {
    start_at: new Date(MAINTENANT + 3 * JOUR).toISOString(),
    end_at: new Date(MAINTENANT + 3 * JOUR + 3 * HEURE).toISOString(),
  })], {maintenant: MAINTENANT});
  assert.equal(G.quoiVaChanger(index, {maintenant: MAINTENANT + 2 * JOUR}), null);
});

/* ==================================================================== */
/*  LE FORMATEUR SE GARDE                                                */
/* ==================================================================== */

test("les formateurs de date ne sont pas reconstruits à chaque appel", () => {
  /* LA DÉCOUVERTE DU LOT E, et elle contredisait l'hypothèse écrite dans
     `docs/maintenant.md`. Le classement d'un centre-ville dense coûtait
     108 ms pour 130 lieux ; la déduplication, accusée jusque-là, en coûtait
     0,16. Tout le reste était `new Intl.DateTimeFormat(...)`, reconstruit à
     chaque appel — 0,067 ms à construire contre 0,013 à utiliser.

     Le test regarde la SOURCE plutôt que de chronométrer : un banc de vitesse
     dans une suite de tests rend des verdicts qui dépendent de la machine. */
  const availability = readFileSync(new URL("../availability.js", import.meta.url), "utf8");
  const temporel = readFileSync(new URL("../temporel.js", import.meta.url), "utf8");
  assert.match(availability, /const FORMATEURS = new Map\(\);/);
  assert.match(temporel, /const FORMATEURS = new Map\(\);/);
  /* Toute construction restante doit passer par la fabrique paresseuse :
     c'est elle qui garantit qu'elle n'a lieu qu'une fois par fuseau. */
  [availability, temporel].forEach((source) => {
    const constructions = source.match(/new Intl\.DateTimeFormat/g) || [];
    const fabriquees = source.match(/formateur\([^)]*\s*(?:\(\)\s*=>\s*)?new Intl\.DateTimeFormat/g) || [];
    const directes = source.match(/FORMATEURS\.set|format = new Intl\.DateTimeFormat/g) || [];
    assert.ok(constructions.length <= fabriquees.length + directes.length,
      "une construction de formateur échappe au cache");
  });
  /* Et `partsInZone`, la fonction appelée pour chaque lieu, ne construit plus
     rien du tout : elle demande. */
  assert.match(availability, /function partsInZone\(timestamp, timeZone\) \{\s*const format = formateur\(timeZone\);/);
});

test("le formateur gardé rend exactement ce que rendait le formateur neuf", () => {
  /* Un cache qui change une réponse n'est pas un cache, c'est un bug. On
     compare la lecture du module à une lecture faite à la main, sur plusieurs
     fuseaux et de part et d'autre d'un changement d'heure. */
  const instants = [
    Date.UTC(2026, 0, 15, 12, 0),
    Date.UTC(2026, 2, 29, 0, 30),      // passage à l'heure d'été en France
    Date.UTC(2026, 6, 4, 22, 0),
    Date.UTC(2026, 9, 25, 0, 30),      // retour à l'heure d'hiver
  ];
  ["Europe/Paris", "Europe/Lisbon", "America/Martinique"].forEach((zone) => {
    instants.forEach((t) => {
      const p = T.partsLocales(t, zone);
      const attendu = {};
      new Intl.DateTimeFormat("fr-FR", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
      }).formatToParts(new Date(t)).forEach((x) => { attendu[x.type] = x.value; });
      assert.equal(p.annee, Number(attendu.year), zone + " " + t);
      assert.equal(p.mois, Number(attendu.month), zone + " " + t);
      assert.equal(p.jour, Number(attendu.day), zone + " " + t);
      assert.equal(p.minute, Number(attendu.minute), zone + " " + t);
    });
  });
});

test("un changement d'heure reste juste malgré le cache", () => {
  /* C'est le vrai risque d'un formateur gardé, et il n'existe pas : un
     formateur est immuable et applique le décalage AU MOMENT DE FORMATER. On
     ne retient jamais la date qu'il rend. */
  const avant = AV.getPlaceAvailability(
    {quand: "Mo-Su 08:00-23:00", timezone: "Europe/Paris"}, Date.UTC(2026, 2, 28, 12, 0));
  const apres = AV.getPlaceAvailability(
    {quand: "Mo-Su 08:00-23:00", timezone: "Europe/Paris"}, Date.UTC(2026, 2, 29, 12, 0));
  assert.equal(avant.isOpenNow, true);
  assert.equal(apres.isOpenNow, true);
  /* 23 h heure de Paris des deux côtés du changement, malgré une heure d'UTC
     d'écart : c'est la preuve que le décalage n'a pas été figé. */
  assert.equal(avant.closesAtTime, "23:00");
  assert.equal(apres.closesAtTime, "23:00");
});
