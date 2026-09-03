import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zones-autonomes.js", import.meta.url), "utf8");
new Function("globalThis", source)(globalThis);
const Z = globalThis.AutourZones;
const classement = await readFile(new URL("../annonces-classement.js", import.meta.url), "utf8");
new Function("globalThis", classement)(globalThis);
const A = globalThis.AutourAnnoncesClassement;
const migration = await readFile(new URL(
  "../supabase/migrations/20260903090000_zones_autonomes.sql", import.meta.url), "utf8");

const centres = {
  mel: [50.6292, 3.0573],
  paris: [48.8566, 2.3522],
  rennes: [48.1173, -1.6778],
  angers: [47.4784, -0.5632],
  rouen: [49.4432, 1.0993],
};

test("le registre autonome contient exactement les cinq zones initiales", () => {
  assert.deepEqual(Z.ids, ["mel", "paris", "angers", "rennes", "rouen"]);
  Object.entries(centres).forEach(([id, point]) => assert.equal(Z.zoneIdForPoint(point), id));
  assert.equal(Z.normaliserId("lille"), "mel");
});

test("la collecte SQL expose les cinq zones et endort les anciennes sans effacer l'historique", () => {
  assert.match(migration, /constraint autour_zones_id_check/);
  for (const id of ["mel", "paris", "angers", "rennes", "rouen"])
    assert.match(migration, new RegExp("['\\\"]" + id + "['\\\"]"));
  assert.match(migration, /code in \('lyon', 'marseille', 'bordeaux', 'toulouse'\)/);
  assert.match(migration, /'rouen', 'rouen', 'Rouen et son agglomération'/);
  assert.match(migration, /foreign key \(zone_id\) references public\.autour_zones/);
});

test("le parcours MEL → Paris → Rennes → Angers → Rouen → MEL reste isolé", () => {
  const items = Object.entries(centres).map(([zone_id, [lat, lng]]) => ({
    id: zone_id, zone_id, lat, lng,
  }));
  const parcours = ["mel", "paris", "rennes", "angers", "rouen", "mel"];
  parcours.forEach((active) => {
    const local = items.filter((item) => Z.zoneIdForItem(item) === active);
    assert.deepEqual(local.map((item) => item.id), [active]);
    assert.equal(items.filter((item) => Z.zoneIdForItem(item) !== active).length, 4);
  });
});

test("une donnée majeure hors zone est identifiable sans devenir locale", () => {
  const paris = {lat:centres.paris[0], lng:centres.paris[1], zone_id:"paris",
    importance_level:"major", importance_score:92};
  assert.equal(Z.zoneIdForItem(paris), "paris");
  assert.notEqual(Z.zoneIdForItem(paris), "mel");
  assert.equal(Z.zoneIdForItem({lat:46.6, lng:1.88}), null,
    "un point hors registre ne doit pas être attribué à une zone autonome");
});

test("le pool majeur inter-zone reste séparé et strictement borné", () => {
  const majeurParis = {zone_id:"paris", importance_level:"major", importance_score:80};
  const importantParis = {zone_id:"paris", importance_level:"important", importance_score:99};
  const majeurMel = {zone_id:"mel", importance_level:"major", importance_score:99};
  assert.equal(A.poolAutorise(majeurParis, {
    pool:"major_cross_zone", activeZoneId:"mel", majorCrossZoneMinScore:80,
  }), true);
  assert.equal(A.poolAutorise(importantParis, {
    pool:"major_cross_zone", activeZoneId:"mel", majorCrossZoneMinScore:80,
  }), false);
  assert.equal(A.poolAutorise(majeurMel, {
    pool:"major_cross_zone", activeZoneId:"mel", majorCrossZoneMinScore:80,
  }), false);
  assert.equal(A.poolAutorise(majeurParis, {pool:"local", activeZoneId:"mel"}), false);
});
