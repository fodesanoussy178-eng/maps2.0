/* global URL */

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260820101602_openagenda_lille_scheduler.sql",
  import.meta.url,
), "utf8");

test("le scheduler repose uniquement sur pg_cron, pg_net et la fonction OpenAgenda existante", () => {
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /sync-openagenda\?mode=sync&territory=lille/);
  assert.doesNotMatch(migration, /sync-datatourisme|tourcoing|roubaix|paris/i);
});

test("le job Lille est réellement défini toutes les trois heures en UTC", () => {
  assert.match(migration, /cron\.schedule\(/);
  assert.match(migration, /openagenda-lille-sync-every-3-hours/);
  assert.match(migration, /0 \*\/3 \* \* \*/);
  assert.doesNotMatch(migration, /insert\s+into\s+cron\.job/i);
});

test("le secret est lu depuis Vault et aucune requête ne part s'il manque", () => {
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /secret\.name = 'event_sync_secret'/);
  assert.match(migration, /if sync_secret is null then\s+return null/si);
  assert.match(migration, /'x-sync-secret', sync_secret/);
  assert.doesNotMatch(migration, /'x-sync-secret'\s*,\s*'[^']+'/i);
});

test("le journal et le verrou couvrent les métriques du cron sans toucher aux anciennes données", () => {
  for (const column of [
    "territory", "pages", "occurrences_seen", "occurrences_inserted",
    "occurrences_updated", "duplicates", "ignored",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
  }
  assert.match(migration, /event_sync_runs_one_openagenda_scope_running/);
  assert.match(migration, /where status = 'running' and source = 'openagenda'/);
  assert.match(migration, /'skipped'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.events/i);
});
