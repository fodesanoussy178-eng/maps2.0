/* global URL */

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260820112353_territorial_event_orchestrator.sql",
  import.meta.url,
), "utf8");

test("le scheduler générique repose sur pg_cron, pg_net et l'Edge Function existante", () => {
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /sync-openagenda\?mode=' \|\| p_mode/);
  assert.match(migration, /invoke_event_sync\('orchestrate', null\)/);
  assert.doesNotMatch(migration, /sync-datatourisme/);
});

test("un seul job territorial est défini toutes les trois heures en UTC", () => {
  assert.equal((migration.match(/cron\.schedule\(/gi) || []).length, 1);
  assert.match(migration, /event-territory-sync-every-3-hours/);
  assert.match(migration, /0 \*\/3 \* \* \*/);
  assert.match(migration, /cron\.unschedule\('openagenda-lille-sync-every-3-hours'\)/);
  assert.doesNotMatch(migration, /insert\s+into\s+cron\.job/i);
  assert.doesNotMatch(migration, /cron\.schedule\([\s\S]*?(tourcoing|roubaix|paris|rouen|angers)/i);
});

test("le secret est lu depuis Vault et aucune requête ne part s'il manque", () => {
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /secret\.name = 'event_sync_secret'/);
  assert.match(migration, /if sync_secret is null then\s+return null/si);
  assert.match(migration, /'x-sync-secret', sync_secret/);
  assert.doesNotMatch(migration, /'x-sync-secret'\s*,\s*'[^']+'/i);
});

test("le registre est relié au journal sans réécrire DATAtourisme", () => {
  assert.match(migration, /add column if not exists territory_source_id bigint/);
  assert.match(migration, /event_sync_runs_territory_source_id_fkey/);
  assert.match(migration, /'datatourisme', 'national-feed'.*false/s);
  assert.match(migration, /"production_behavior":"unchanged"/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.events/i);
});
