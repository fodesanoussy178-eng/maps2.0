import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const migration = await readFile(new URL(
  "../supabase/migrations/20260903110000_event_areas_partitions_majeurs.sql",
  import.meta.url), "utf8");
const melMigration = await readFile(new URL(
  "../supabase/migrations/20260903133000_mel_partitions_techniques.sql",
  import.meta.url), "utf8");
const melCouronnesMigration = await readFile(new URL(
  "../supabase/migrations/20260903143000_mel_couronne_partitions.sql",
  import.meta.url), "utf8");
const fonction = await readFile(new URL(
  "../supabase/functions/sync-datatourisme/index.ts", import.meta.url), "utf8");
const workflow = await readFile(new URL(
  "../../.github/workflows/evenements-sync.yml", import.meta.url), "utf8");
const classementSource = await readFile(new URL(
  "../annonces-classement.js", import.meta.url), "utf8");

new Function("globalThis", classementSource)(globalThis);
const classement = globalThis.AutourAnnoncesClassement;

test("les cinq zones produit ont une ligne active avec le même code et zone_id", () => {
  for (const zone of ["mel", "paris", "angers", "rennes", "rouen"]) {
    assert.match(migration, new RegExp(`['\\"]${zone}['\\"].*['\\"]${zone}['\\"]`));
  }
  assert.match(migration, /add column if not exists zone_id text/);
  assert.match(migration, /enabled = true/);
  assert.match(migration, /sync_partition boolean not null default true/);
});

test("Paris est une zone globale et ses cinq emprises sont des partitions", () => {
  for (const partition of ["paris_centre", "paris_nord", "paris_est", "paris_sud", "paris_ouest"]) {
    assert.match(migration, new RegExp(`['\\"]${partition}['\\"].*['\\"]paris['\\"]`));
  }
  assert.match(migration, /where code = 'paris'/);
  assert.match(migration, /sync_partition = false/);
  assert.match(migration, /sync_partition = true/);
});

test("le synchroniseur peut exécuter une partition sans changer le zone_id utilisateur", () => {
  assert.match(fonction, /partitionDemandee/);
  assert.match(fonction, /zone_id=eq\.\$\{encodeURIComponent\(codeDemande\)\}/);
  assert.match(fonction, /code=eq\.\$\{encodeURIComponent\(partitionDemandee\)\}/);
  assert.match(fonction, /partition: partitionDemandee/);
  assert.match(workflow, /paris_centre paris_nord paris_est paris_sud paris_ouest/);
  assert.match(workflow, /area=\$\{ZONE\}&partition=\$\{partition\}/);
  assert.match(workflow, /\.status == "success" or \.status == "partial"/);
});

test("la MEL centrale est découpée sans changer son identité produit", () => {
  for (const partition of [
    "mel_centre_nord_ouest", "mel_centre_nord_est",
    "mel_centre_sud_ouest", "mel_centre_sud_est",
  ]) {
    assert.match(melMigration, new RegExp(`['\\"]${partition}['\\"]`));
  }
  assert.match(melMigration, /select p\.code, 'mel'/);
  assert.match(workflow, /mel_centre_nord_ouest mel_centre_nord_est mel_centre_sud_ouest mel_centre_sud_est/);
  assert.match(melMigration, /commune_keys = excluded\.commune_keys/);
});

test("les couronnes MEL sont aussi bornées par petites emprises", () => {
  for (const partition of [
    "mel_nord_ouest", "mel_nord_est", "mel_sud_ouest_bas", "mel_sud_est_bas",
    "mel_sud_ouest_haut", "mel_sud_est_haut", "mel_ouest_sud", "mel_ouest_nord",
    "mel_est_sud", "mel_est_nord",
  ]) assert.match(melCouronnesMigration, new RegExp(`['\\"]${partition}['\\"]`));
  assert.match(melCouronnesMigration, /select p\.code, 'mel'/);
  assert.match(workflow, /mel_nord_ouest mel_nord_est mel_sud_ouest_bas/);
});

test("un événement majeur est explicite et le scope city ne franchit pas une zone", () => {
  assert.equal(classement.isMajor({is_major: true, major_scope: "regional"}), true);
  assert.equal(classement.majorScope({is_major: true, major_scope: "national"}), "national");
  assert.equal(classement.poolAutorise({
    zone_id: "paris", is_major: true, major_scope: "regional", importance_score: 90,
  }, {pool: "major_cross_zone", activeZoneId: "mel", majorCrossZoneMinScore: 80}), true);
  assert.equal(classement.poolAutorise({
    zone_id: "paris", is_major: true, major_scope: "city", importance_score: 99,
  }, {pool: "major_cross_zone", activeZoneId: "mel", majorCrossZoneMinScore: 80}), false);
  assert.equal(classement.poolAutorise({
    zone_id: "paris", is_major: false, major_scope: null, importance_score: 99,
  }, {pool: "major_cross_zone", activeZoneId: "mel", majorCrossZoneMinScore: 80}), false);
});

test("le RPC cross-zone exige majeur régional/national, score, futur et tags", () => {
  assert.match(migration, /e\.is_major = true/);
  assert.match(migration, /e\.major_scope in \('regional', 'national'\)/);
  assert.match(migration, /e\.importance_score >= 80/);
  assert.match(migration, /e\.start_at > now\(\)/);
  assert.match(migration, /cardinality\(e\.announcement_tags\)/);
  assert.match(migration, /e\.duplicate_of is null/);
});
