import test from "node:test";
import assert from "node:assert/strict";
import "../transit.js";

const {routeToLine, linesFromRelations, sharedLines} = globalThis.AutourTransit;

/* Relations telles qu'OpenStreetMap les publie réellement. */
const METRO_2 = {type:"relation", id:"1001", tags:{
  type:"route", route:"subway", ref:"2", name:"Métro 2 : CH Dron → Saint-Philibert",
  operator:"Ilévia"}};
const TRAM_T = {type:"relation", id:"1002", tags:{
  type:"route", route:"tram", ref:"T", name:"Tramway : Lille Flandres → Tourcoing",
  operator:"Ilévia"}};
const BUS_32 = {type:"relation", id:"1003", tags:{
  type:"route", route:"bus", ref:"32", name:"Bus 32"}};
const TER = {type:"relation", id:"1004", tags:{
  type:"route", route:"train", ref:"TER", name:"TER Hauts-de-France"}};

test("le mode se lit dans le tag route, jamais ailleurs", () => {
  assert.equal(routeToLine(METRO_2).mode, "metro");
  assert.equal(routeToLine(TRAM_T).mode, "tram");
  assert.equal(routeToLine(BUS_32).mode, "bus");
  assert.equal(routeToLine(TER).mode, "train");
  // light_rail est un tramway, pas un bus — l'ancienne table le rangeait en bus
  assert.equal(routeToLine({id:"9", tags:{type:"route", route:"light_rail", ref:"A"}}).mode, "tram");
});

test("un mode inconnu ne devient pas « bus » par défaut", () => {
  // c'est exactement ce qui produisait des arrêts de bus inexistants
  assert.equal(routeToLine({id:"9", tags:{type:"route", route:"piste"}}), null);
  assert.equal(routeToLine({id:"9", tags:{type:"route"}}), null);
  assert.equal(routeToLine({id:"9", tags:{}}), null);
  assert.equal(routeToLine(null), null);
});

test("le libellé est celui écrit sur le véhicule, jamais fabriqué", () => {
  assert.equal(routeToLine(METRO_2).label, "2");
  assert.equal(routeToLine(TRAM_T).label, "T");
  // sans ref, on retombe sur le nom complet — on n'invente pas de numéro
  const sansRef = routeToLine({id:"9", tags:{type:"route", route:"bus", name:"Navette du marché"}});
  assert.equal(sansRef.label, "Navette du marché");
  assert.equal(sansRef.ref, "");
});

test("une ligne sans libellé exploitable n'est pas retenue", () => {
  const lignes = linesFromRelations([{type:"relation", id:"9", tags:{type:"route", route:"bus"}}]);
  assert.equal(lignes.size, 0);
});

test("seuls les éléments de type relation comptent", () => {
  const lignes = linesFromRelations([
    {type:"node", id:"5", tags:{route:"subway", ref:"2"}},
    METRO_2,
  ]);
  assert.deepEqual([...lignes.keys()], ["1001"]);
});

/* ---- Le cœur : ne proposer un trajet que si une ligne dessert les deux ---- */

test("une ligne présente aux deux extrémités est retenue", () => {
  const depart  = linesFromRelations([METRO_2, BUS_32]);
  const arrivee = linesFromRelations([METRO_2, TRAM_T]);
  const communes = sharedLines(depart, arrivee);
  assert.equal(communes.length, 1);
  assert.equal(communes[0].label, "2");
  assert.equal(communes[0].mode, "metro");
});

test("aucune ligne commune : on ne propose rien", () => {
  // le cas signalé : un métro au départ, un arrêt desservi par un autre réseau
  // à l'arrivée. L'ancienne version fabriquait quand même « monter / descendre ».
  const depart  = linesFromRelations([METRO_2]);
  const arrivee = linesFromRelations([BUS_32]);
  assert.deepEqual(sharedLines(depart, arrivee), []);
});

test("le mode le plus structurant passe devant", () => {
  const depart  = linesFromRelations([BUS_32, METRO_2, TRAM_T]);
  const arrivee = linesFromRelations([BUS_32, METRO_2, TRAM_T]);
  assert.deepEqual(sharedLines(depart, arrivee).map(l => l.mode),
    ["metro", "tram", "bus"]);
});

test("des entrées vides ou absentes ne cassent rien", () => {
  assert.deepEqual(sharedLines(new Map(), new Map()), []);
  assert.deepEqual(sharedLines(null, null), []);
  assert.deepEqual(sharedLines(linesFromRelations([METRO_2]), null), []);
  assert.equal(linesFromRelations(null).size, 0);
});
