/* ---------------------------------------------------------------------------
   LA VITRINE DE MAINTENANT — TROIS PLACES, ET CE QUI LES DÉPARTAGE

   Trois règles produit vivent ici, et elles se contredisent si on les applique
   dans le désordre :

     · un cœur garde une proposition sous les yeux pendant que les autres
       tournent — mais ne lui fait franchir aucune porte d'éligibilité ;
     · tant qu'Autour démarre, l'événement d'un habitant passe devant — mais
       seulement s'il est par ailleurs valide, et jamais au prix d'un
       événement réellement en cours ;
     · la vitrine tourne pour ne pas se figer — mais à pertinence comparable
       seulement, sinon la rotation ferait descendre le meilleur contenu.

   L'ordre des critères EST la règle. Ces tests l'interrogent un cran à la
   fois, parce qu'une inversion ne se voit pas à l'œil : elle se voit six mois
   plus tard, quand un café ouvert passe devant un concert.
--------------------------------------------------------------------------- */

import test from "node:test";
import assert from "node:assert/strict";
import "../maintenant.js";

const M = globalThis.AutourMaintenant;
const T = Date.UTC(2026, 7, 14, 20, 0, 0);
const ICI = [50.6292, 3.0573];
const h = (n) => n * 3600e3;

const evenement = (id, extra) => Object.assign({
  id, estEvenement: true, annule: false,
  titre: "Concert " + id, title: "Concert " + id, categorie: "event",
  entity_type: "event", canonical_id: id,
  canonical: { entity_type: "event", id, title: "Concert " + id, category: "event" },
  tempsValide: true, enCours: true, dateIncertaine: false,
  debutLe: T - h(1), finLe: T + h(1),
  lat: 50.6312, lng: 3.0573, ferme: false,
}, extra || {});

/* Un lieu ouvert : éligible, mais moins prioritaire qu'un événement en cours.
   C'est lui qui sert à prouver que le verrou ne renverse pas la hiérarchie. */
const lieu = (id, extra) => Object.assign({
  id, estEvenement: false, annule: false,
  titre: "Café " + id, title: "Café " + id, categorie: "cafe",
  entity_type: "place", canonical_id: id,
  canonical: { entity_type: "place", id, title: "Café " + id, category: "cafe" },
  tempsValide: true, ferme: false, current_status: "open",
  lat: 50.6302, lng: 3.0573,
}, extra || {});

const ctx = (extra) => Object.assign({
  maintenant: T, position: ICI, positionConnue: true,
  positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false,
}, extra || {});

const ids = (liste) => liste.map((x) => x.id);

/* ==========================================================================
   1. TROIS, JAMAIS QUATRE
   ======================================================================== */
test("dix contenus éligibles donnent exactement trois cartes", () => {
  const dix = Array.from({length: 10}, (_, i) => evenement("e" + i, {lat: 50.6292 + i * 0.0005}));
  assert.equal(M.selection(dix, ctx()).length, 3);
  assert.equal(M.PLACES, 3);
});

/* ==========================================================================
   2. LE SEUIL DE DÉMARRAGE — UNE DONNÉE, PAS UNE CONSTANTE CACHÉE
   ======================================================================== */
test("le seuil vaut 1000 par défaut et se règle depuis le contexte", () => {
  assert.equal(M.SEUIL_DEMARRAGE, 1000);
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: 999})), true);
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: 1000})), false);
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: 1001})), false);
  /* Réglable sans toucher au moteur. */
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: 1500, seuilDemarrage: 5000})), true);
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: 10, seuilDemarrage: 0})), false);
});

test("sans métrique d'utilisateurs, aucune faveur n'est accordée", () => {
  /* Une priorité fondée sur un compteur qu'on n'a pas su lire serait une règle
     appliquée au hasard. */
  assert.equal(M.phaseDemarrage(ctx()), false);
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: null})), false);
  assert.equal(M.phaseDemarrage(ctx({utilisateurs: "beaucoup"})), false);
});

test("un événement d'habitant est reconnu par sa publication, pas par son titre", () => {
  assert.equal(M.estEvenementHabitant(evenement("a", {publication_id: "p1"})), true);
  assert.equal(M.estEvenementHabitant(evenement("b", {primary_source: "publication"})), true);
  assert.equal(M.estEvenementHabitant(evenement("c")), false);
});

/* ==========================================================================
   3. AVANT 1000 : L'ÉVÉNEMENT D'HABITANT PASSE DEVANT SES PAIRS
   ======================================================================== */
test("avant le seuil, l'événement d'un habitant entre dans les trois", () => {
  const foule = Array.from({length: 8}, (_, i) => evenement("e" + i, {lat: 50.6292 + i * 0.0002}));
  const habitant = evenement("habitant", {publication_id: "p1", lat: 50.6292 + 0.02});
  const avant = M.selection([...foule, habitant], ctx({utilisateurs: 120}));
  assert.equal(avant.length, 3);
  assert.ok(ids(avant).includes("habitant"), "il doit faire partie des trois : " + ids(avant));
  assert.equal(avant[0].id, "habitant", "et il ouvre la vitrine");
  assert.equal(avant[0].motifMaintenant, "evenement_habitant_demarrage");
});

test("après le seuil, il revient au classement ordinaire", () => {
  const foule = Array.from({length: 8}, (_, i) => evenement("e" + i, {lat: 50.6292 + i * 0.0002}));
  /* Le plus éloigné de tous : sans faveur, il ne peut pas être premier. */
  const habitant = evenement("habitant", {publication_id: "p1", lat: 50.6292 + 0.02});
  const apres = M.selection([...foule, habitant], ctx({utilisateurs: 1000}));
  assert.notEqual(apres[0].id, "habitant");
});

test("un événement d'habitant invalide reste dehors, seuil ou pas", () => {
  /* Terminé depuis trois heures : la publication ne rachète rien. */
  const expire = evenement("expire", {publication_id: "p1",
    debutLe: T - h(5), finLe: T - h(3), enCours: false});
  const sansNom = evenement("anonyme", {publication_id: "p2", titre: "", title: ""});
  const retenus = M.selection([expire, sansNom, evenement("ok")], ctx({utilisateurs: 10}));
  assert.deepEqual(ids(retenus), ["ok"]);
});

/* ==========================================================================
   4. LE FAVORI VERROUILLÉ
   ======================================================================== */
test("un favori verrouillé reste pendant que les autres tournent", () => {
  const monde = [evenement("a"), evenement("b", {lat: 50.6295}), evenement("c", {lat: 50.6297}),
                 evenement("d", {lat: 50.6299}), evenement("e", {lat: 50.6301})];
  const garde = ctx({favorisVerrouilles: new Set(["d"])});
  const tour1 = M.selection(monde, garde);
  assert.ok(ids(tour1).includes("d"), "le favori doit être là : " + ids(tour1));
  /* Un tour plus tard, les deux autres places ont tourné ; « d » non. */
  const vues = new Map(ids(tour1).map((id) => [id, 5]));
  const tour2 = M.selection(monde, ctx({favorisVerrouilles: new Set(["d"]), vues}));
  assert.ok(ids(tour2).includes("d"), "le favori reste : " + ids(tour2));
});

test("un cœur ne suspend aucune règle d'éligibilité", () => {
  /* Le cas qui compte : quelqu'un a gardé un événement, il est terminé. Il
     reste dans la liste Favoris — mais pas dans Maintenant, sinon on
     traverserait la ville pour une porte fermée. */
  const fini = evenement("fini", {debutLe: T - h(5), finLe: T - h(3), enCours: false});
  const retenus = M.selection([fini, evenement("vivant")],
    ctx({favorisVerrouilles: new Set(["fini"])}));
  assert.deepEqual(ids(retenus), ["vivant"]);
});

test("le verrou garantit la présence, jamais la première place", () => {
  /* Un café ouvert verrouillé ne passe pas devant un concert en cours : le
     verrou se départage à nature égale, comme tout le reste. */
  const concert = evenement("concert");
  const cafe = lieu("cafe");
  const retenus = M.selection([concert, cafe], ctx({favorisVerrouilles: new Set(["cafe"])}));
  assert.equal(retenus[0].id, "concert", "ordre obtenu : " + ids(retenus));
  assert.ok(ids(retenus).includes("cafe"));
});

/* ==========================================================================
   5. LE TURNOVER
   ======================================================================== */
test("à pertinence égale, le moins montré passe devant", () => {
  const a = evenement("a"), b = evenement("b");
  const vues = new Map([["a", 12], ["b", 0]]);
  const retenus = M.selection([a, b], ctx({vues, places: 1}));
  assert.deepEqual(ids(retenus), ["b"]);
});

test("le turnover ne fait jamais descendre un meilleur contenu", () => {
  /* Un concert en cours montré vingt fois reste devant un café jamais montré.
     Sinon la rotation punirait le contenu d'être bon. */
  const concert = evenement("concert");
  const cafe = lieu("cafe");
  const vues = new Map([["concert", 20], ["cafe", 0]]);
  const retenus = M.selection([concert, cafe], ctx({vues}));
  assert.equal(retenus[0].id, "concert");
});

test("chaque carte sait dire pourquoi elle est là", () => {
  const retenus = M.selection(
    [evenement("a"), lieu("b"), evenement("c", {publication_id: "p"})],
    ctx({utilisateurs: 50, favorisVerrouilles: new Set(["b"])}));
  const motifs = Object.fromEntries(retenus.map((x) => [x.id, x.motifMaintenant]));
  assert.equal(motifs.c, "evenement_habitant_demarrage");
  assert.equal(motifs.b, "favori_verrouille");
  assert.ok(motifs.a, "une nature suffit pour les autres");
});
