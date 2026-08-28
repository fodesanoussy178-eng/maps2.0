/* global URL */

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {corpsApplicationSync} from "./source.mjs";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260820112353_territorial_event_orchestrator.sql", import.meta.url,
), "utf8");
const migrationPerformance = readFileSync(new URL(
  "../supabase/migrations/20260820115309_optimize_evenements_proches.sql", import.meta.url,
), "utf8");
const migrationProvenance = readFileSync(new URL(
  "../supabase/migrations/20260821120000_provenance_images.sql", import.meta.url,
), "utf8");
const app = corpsApplicationSync(import.meta.url);

test("les six territoires demandés sont inscrits dans le registre", () => {
  for (const slug of ["tourcoing", "roubaix", "lille", "paris", "rouen", "angers"]) {
    assert.match(migration, new RegExp(`\\('${slug}', '${slug[0].toUpperCase()}${slug.slice(1)}`));
  }
  assert.match(migration, /group_slug/);
  assert.match(migration, /radius_km/);
  assert.match(migration, /last_synced_at/);
});

test("seuls les agendas OpenAgenda institutionnels validés sont actifs", () => {
  for (const uid of ["57621068", "32344838", "9977986", "11362982", "52870970"]) {
    assert.match(migration, new RegExp(`'openagenda', '${uid}'`));
  }
  assert.doesNotMatch(migration, /\('angers', 'openagenda'/);
  assert.match(migration, /"official":true/);
});

test("la proximité est calculée par rayon et PostGIS sans frontière communale", () => {
  assert.match(migration, /st_dwithin/i);
  assert.match(migration, /geom::%1\$I\.geography/i);
  assert.match(migration, /where r\.distance_km <= r\.radius_km/i);
  assert.doesNotMatch(migration, /insee_code\s*=/i);
});

test("une zone inconnue crée seulement un candidat déterministe", () => {
  assert.match(migration, /status, active, discovery_key/);
  assert.match(migration, /'discovered', false, candidate_key/);
  assert.match(migration, /md5\(candidate_key\)/);
  assert.doesNotMatch(migration, /fetch\(|openagenda\.com.*candidate|scrap/i);
});

test("le navigateur résout la zone mais n'appelle aucune API fournisseur", () => {
  assert.match(app, /rpc\("resoudre_territoire"/);
  assert.match(app, /rpc\("evenements_proches"/);
  assert.doesNotMatch(app, /api\.openagenda\.com|functions\/v1\/sync-openagenda/);
});

test("la lecture canonique calcule ses paramètres et candidats une seule fois", () => {
  assert.match(migrationPerformance, /parametres as materialized/i);
  assert.match(migrationPerformance, /candidats as materialized/i);
  assert.equal((migrationPerformance.match(/public\.event_soon_window\(\)/g) || []).length, 1);
  assert.equal((migrationPerformance.match(/\bst_dwithin\s*\(/gi) || []).length, 1);
  assert.match(migrationPerformance, /limit least\(greatest\(coalesce\(p_limite, 120\), 1\), 300\)/);
  assert.match(migrationPerformance, /when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3/);
});

test("la RPC existante renvoie déjà le statut recalculé et la provenance", () => {
  assert.match(migrationProvenance, /end as statut/);
  assert.match(migrationProvenance, /e\.statut/);
  assert.match(migrationProvenance, /temporal_status text/);
  assert.match(migrationProvenance, /last_source_update timestamptz/);
  assert.match(migrationProvenance, /last_synced_at timestamptz/);
  assert.match(migrationProvenance, /security invoker/);
  assert.match(migrationProvenance, /grant execute on function public\.evenements_proches/);
});
