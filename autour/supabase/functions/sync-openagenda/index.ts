/* ---------------------------------------------------------------------------
   sync-openagenda — Ville de Lille, serveur uniquement

   Deux modes explicites existent :
   - mode=test : conserve le test réel ciblé Braderie ;
   - mode=sync&territory=lille : synchronise l'agenda officiel dans une
     fenêtre glissante couvrant au minimum la Braderie 2026.
   Aucun mode implicite et aucune planification dans cette fonction.
--------------------------------------------------------------------------- */

import {
  OPENAGENDA_SYNC, OPENAGENDA_TEST, openAgendaSyncPeriod, sourceOpenAgenda,
} from "./config.mjs";
import {fetchEventsPage, OpenAgendaConfigurationError} from "./client.mjs";
import {eventDedupKey} from "./dedup.mjs";
import {listOpenAgendaEvents} from "./pagination.mjs";
import {isTargetEvent, normalizeOpenAgendaEvent} from "./normalize.mjs";

type Json = Record<string, unknown>;

type NormalizedOccurrence = {
  source_event_id: string;
  source_occurrence_id: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  date_confidence: string;
  temporal_status: string;
  raw_timing: unknown;
};

type NormalizedEvent = {
  source: string;
  source_agenda: string;
  source_agenda_uid: string;
  external_id: string;
  title: string;
  venue_name: string | null;
  latitude: number | null;
  longitude: number | null;
  source_url: string | null;
  last_source_update: string | null;
  raw_event: Json;
  occurrences: NormalizedOccurrence[];
  event: Json & {cancelled: boolean};
};

type ExistingState = {
  sourceEvents: Map<string, string>;
  occurrences: Set<string>;
};

type PersistResult = {
  eventId: string;
  eventInserted: number;
  eventUpdated: number;
  occurrenceInserted: number;
  occurrenceUpdated: number;
  duplicate: number;
};

type SyncReport = {
  status: "SUCCESS" | "PARTIAL" | "FAIL";
  provider: "openagenda";
  territory: "lille";
  agenda_uid: string;
  period_start: string;
  period_end: string;
  pages: number;
  events_seen: number;
  events_normalized: number;
  events_inserted: number;
  events_updated: number;
  occurrences_seen: number;
  occurrences_inserted: number;
  occurrences_updated: number;
  duplicates: number;
  ignored: number;
  errors: number;
  duration_ms: number;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const OPENAGENDA_API_KEY = Deno.env.get("OPENAGENDA_API_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";
const DATABASE_PAGE_SIZE = 1_000;
const OCCURRENCE_BATCH_SIZE = 200;
const STALE_RUN_MS = 45 * 60 * 1_000;

let secretCache: string | null = null;

class SupabaseWriteError extends Error {
  status: number;

  constructor(status: number, details: string) {
    super(`Supabase écriture impossible : HTTP ${status} ${details.slice(0, 240)}`);
    this.name = "SupabaseWriteError";
    this.status = status;
  }
}

class AlreadyRunningError extends Error {
  runId: number | null;

  constructor(runId: number | null) {
    super("synchronisation OpenAgenda Lille déjà en cours");
    this.name = "AlreadyRunningError";
    this.runId = runId;
  }
}

function readSecret(): string {
  if (secretCache) return secretCache;
  const dictionary = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dictionary) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(dictionary) as Record<string, string>;
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS illisible");
    }
    const name = Deno.env.get("SUPABASE_SECRET_KEY_NAME") ?? "default";
    const configured = parsed[name];
    if (!configured) throw new Error(`clé Supabase secrète « ${name} » absente`);
    // Les environnements récents fournissent le NOM de la variable secrète ;
    // les anciens peuvent encore fournir directement sa valeur.
    secretCache = Deno.env.get(configured) || configured;
    return secretCache;
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (!legacy) throw new Error("aucune clé Supabase secrète configurée");
  secretCache = legacy;
  return legacy;
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const key = readSecret();
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function readRows(path: string): Promise<Json[]> {
  const response = await rest(path);
  if (!response.ok) throw new Error(`Supabase lecture impossible : HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("réponse Supabase invalide");
  return rows as Json[];
}

async function readAllRows(path: string): Promise<Json[]> {
  const rows: Json[] = [];
  for (let offset = 0; offset < 100_000; offset += DATABASE_PAGE_SIZE) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await readRows(`${path}${separator}limit=${DATABASE_PAGE_SIZE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < DATABASE_PAGE_SIZE) return rows;
  }
  throw new Error("lecture Supabase interrompue après 100 000 lignes");
}

async function write(path: string, init: RequestInit): Promise<Json[]> {
  const response = await rest(path, init);
  const body = await response.text();
  if (!response.ok) {
    throw new SupabaseWriteError(response.status, body);
  }
  if (!body) return [];
  const rows = JSON.parse(body);
  return Array.isArray(rows) ? rows as Json[] : [];
}

async function openRun(scope: string): Promise<number | null> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString();
  await write(
    `event_sync_runs?source=eq.openagenda&scope=eq.${encodeURIComponent(scope)}` +
    `&status=eq.running&started_at=lt.${encodeURIComponent(staleBefore)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "error", finished_at: new Date().toISOString(),
        errors: "verrou de synchronisation expiré après 45 minutes",
      }),
    },
  );
  try {
    const rows = await write("event_sync_runs", {
      method: "POST",
      headers: {Prefer: "return=representation"},
      body: JSON.stringify([{
        source: "openagenda", scope, territory: "lille", status: "running",
      }]),
    });
    const id = rows[0]?.id;
    return typeof id === "number" ? id : null;
  } catch (error) {
    if (!(error instanceof SupabaseWriteError) || error.status !== 409) throw error;
    const rows = await write("event_sync_runs", {
      method: "POST",
      headers: {Prefer: "return=representation"},
      body: JSON.stringify([{
        source: "openagenda", scope, territory: "lille", status: "skipped",
        finished_at: new Date().toISOString(), duration_ms: 0,
        errors: "synchronisation déjà en cours",
        details: {reason: "already_running"},
      }]),
    });
    throw new AlreadyRunningError(typeof rows[0]?.id === "number" ? rows[0].id : null);
  }
}

async function closeRun(id: number | null, patch: Json) {
  if (id == null) return;
  await write(`event_sync_runs?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({finished_at: new Date().toISOString(), ...patch}),
  });
}

async function loadExistingState(source: ReturnType<typeof sourceOpenAgenda>): Promise<ExistingState> {
  const [sourceRows, occurrenceRows] = await Promise.all([
    readAllRows(
      `event_sources?select=event_id,external_id&source=eq.openagenda` +
      `&source_agenda_uid=eq.${encodeURIComponent(source.sourceAgendaUid)}`),
    readAllRows(
      `event_occurrences?select=source_occurrence_id&source=eq.openagenda` +
      `&source_agenda_uid=eq.${encodeURIComponent(source.sourceAgendaUid)}`),
  ]);
  return {
    sourceEvents: new Map(sourceRows.flatMap((row) =>
      typeof row.external_id === "string" && typeof row.event_id === "string"
        ? [[row.external_id, row.event_id] as const] : [])),
    occurrences: new Set(occurrenceRows.flatMap((row) =>
      typeof row.source_occurrence_id === "string" ? [row.source_occurrence_id] : [])),
  };
}

async function findDedupCandidate(normalized: NormalizedEvent): Promise<string | null> {
  const key = eventDedupKey(
    normalized.title, normalized.latitude, normalized.longitude,
    normalized.event.start_at as string | null);
  if (!key) return null;
  const rows = await readRows(
    `events?select=id&dedup_key=eq.${encodeURIComponent(key)}&limit=1`);
  return typeof rows[0]?.id === "string" ? rows[0].id : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function persistEvent(normalized: NormalizedEvent, state: ExistingState): Promise<PersistResult> {
  const syncedAt = new Date().toISOString();
  let eventId = state.sourceEvents.get(normalized.external_id) ?? null;
  let eventInserted = 0, eventUpdated = 0, duplicate = 0;
  const eventBody = {...normalized.event, area_id: null, last_synced_at: syncedAt};

  if (!eventId) {
    eventId = await findDedupCandidate(normalized);
    if (eventId) duplicate = 1;
  }

  if (eventId) {
    await write(`events?id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(eventBody),
    });
    eventUpdated = 1;
  } else {
    try {
      const rows = await write("events", {
        method: "POST",
        headers: {Prefer: "return=representation"},
        body: JSON.stringify([eventBody]),
      });
      eventId = typeof rows[0]?.id === "string" ? rows[0].id : null;
      eventInserted = 1;
    } catch (error) {
      // Une synchronisation concurrente peut avoir posé la même dedup_key
      // entre la lecture et l'INSERT. La contrainte DB reste l'arbitre.
      eventId = await findDedupCandidate(normalized);
      if (!eventId) throw error;
      await write(`events?id=eq.${encodeURIComponent(eventId)}`, {
        method: "PATCH", body: JSON.stringify(eventBody),
      });
      eventUpdated = 1;
      duplicate = 1;
    }
  }
  if (!eventId) throw new Error(`identifiant canonique absent pour ${normalized.external_id}`);

  await write("event_sources?on_conflict=source,external_id", {
    method: "POST",
    headers: {Prefer: "resolution=merge-duplicates"},
    body: JSON.stringify([{
      event_id: eventId,
      source: normalized.source,
      source_agenda: normalized.source_agenda,
      source_agenda_uid: normalized.source_agenda_uid,
      external_id: normalized.external_id,
      source_url: normalized.source_url,
      raw_data: normalized.raw_event,
      source_updated_at: normalized.last_source_update,
      synced_at: syncedAt,
    }]),
  });

  let occurrenceInserted = 0, occurrenceUpdated = 0;
  const occurrenceBodies = normalized.occurrences.map((occurrence) => {
    if (state.occurrences.has(occurrence.source_occurrence_id)) occurrenceUpdated += 1;
    else occurrenceInserted += 1;
    return {
      event_id: eventId,
      source: normalized.source,
      source_agenda: normalized.source_agenda,
      source_agenda_uid: normalized.source_agenda_uid,
      source_event_id: normalized.external_id,
      source_occurrence_id: occurrence.source_occurrence_id,
      start_at: occurrence.start_at,
      end_at: occurrence.end_at,
      timezone: occurrence.timezone,
      date_confidence: occurrence.date_confidence,
      cancelled: normalized.event.cancelled,
      raw_data: occurrence.raw_timing,
      last_source_update: normalized.last_source_update,
      last_synced_at: syncedAt,
    };
  });
  for (const batch of chunks(occurrenceBodies, OCCURRENCE_BATCH_SIZE)) {
    await write("event_occurrences?on_conflict=source,source_occurrence_id", {
      method: "POST",
      headers: {Prefer: "resolution=merge-duplicates"},
      body: JSON.stringify(batch),
    });
  }

  state.sourceEvents.set(normalized.external_id, eventId);
  for (const occurrence of normalized.occurrences) {
    state.occurrences.add(occurrence.source_occurrence_id);
  }
  return {eventId, eventInserted, eventUpdated, occurrenceInserted, occurrenceUpdated, duplicate};
}

function isoLocalParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

async function storedTemporalStatus(sourceOccurrenceId: string): Promise<string> {
  const rows = await readRows(
    `event_occurrences?select=temporal_status&source=eq.openagenda` +
    `&source_occurrence_id=eq.${encodeURIComponent(sourceOccurrenceId)}&limit=1`);
  return String(rows[0]?.temporal_status ?? "unknown_date");
}

function logTarget(normalized: NormalizedEvent, occurrence: NormalizedOccurrence, temporalStatus: string) {
  const eligible = temporalStatus === "now";
  console.log(`[OPENAGENDA TEST — VILLE DE LILLE]\n` +
    `agenda_uid: ${normalized.source_agenda_uid}\n` +
    `event_uid: ${normalized.external_id}\n` +
    `source_occurrence_id: ${occurrence.source_occurrence_id}\n` +
    `title: ${normalized.title}\n` +
    `venue: ${normalized.venue_name ?? "null"}\n` +
    `start_at: ${occurrence.start_at}\n` +
    `end_at: ${occurrence.end_at ?? "null"}\n` +
    `timezone: ${occurrence.timezone}\n` +
    `latitude: ${normalized.latitude ?? "null"}\n` +
    `longitude: ${normalized.longitude ?? "null"}\n` +
    `temporal_status: ${temporalStatus}\n` +
    `isEligibleForNow: ${eligible}\n` +
    `source: ${normalized.source}\n` +
    `source_agenda: ${normalized.source_agenda}`);
  return eligible;
}

function validateConfiguration() {
  if (!OPENAGENDA_API_KEY) throw new OpenAgendaConfigurationError("OPENAGENDA_API_KEY absente");
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL absente");
  readSecret();
}

async function runTest() {
  const source = sourceOpenAgenda("lille");
  const now = new Date();
  const result = await listOpenAgendaEvents({
    client: {fetchEventsPage}, source,
    search: OPENAGENDA_TEST.search,
    from: now.toISOString(), until: OPENAGENDA_TEST.horizonEnd,
    apiKey: OPENAGENDA_API_KEY,
  });
  const raw = result.events.find((event) => isTargetEvent(event, OPENAGENDA_TEST));
  if (!raw) throw new Error("événement cible absent de la réponse OpenAgenda");
  const normalized = normalizeOpenAgendaEvent(raw, {source, now}) as NormalizedEvent | null;
  if (!normalized) throw new Error("événement cible impossible à normaliser");
  const occurrence = normalized.occurrences.find((item) =>
    isoLocalParts(item.start_at, item.timezone) === `${OPENAGENDA_TEST.expectedDate}T${OPENAGENDA_TEST.expectedStartLocal}` &&
    item.end_at && isoLocalParts(item.end_at, item.timezone) === `${OPENAGENDA_TEST.expectedDate}T${OPENAGENDA_TEST.expectedEndLocal}`);
  if (!occurrence) throw new Error("occurrence cible 10:00–17:00 absente ou incorrecte");
  if (normalized.venue_name !== OPENAGENDA_TEST.expectedVenue) {
    throw new Error(`lieu inattendu : ${normalized.venue_name ?? "null"}`);
  }
  const targeted = {...normalized, occurrences: [occurrence]};
  const persisted = await persistEvent(targeted, await loadExistingState(source));
  const temporalStatus = await storedTemporalStatus(occurrence.source_occurrence_id);
  const eligible = logTarget(normalized, occurrence, temporalStatus);
  if (temporalStatus !== "upcoming" || eligible) {
    throw new Error(`statut temporel invalide : ${temporalStatus}`);
  }
  return {
    status: "PASS",
    agenda_uid: normalized.source_agenda_uid,
    event_uid: normalized.external_id,
    source_occurrence_id: occurrence.source_occurrence_id,
    title: normalized.title,
    venue: normalized.venue_name,
    start_at: occurrence.start_at,
    end_at: occurrence.end_at,
    timezone: occurrence.timezone,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    temporal_status: temporalStatus,
    isEligibleForNow: eligible,
    source: normalized.source,
    source_agenda: normalized.source_agenda,
    pages: result.pages,
    events_seen: result.events.length,
    event_id: persisted.eventId,
    events_inserted: persisted.eventInserted,
    events_updated: persisted.eventUpdated,
  };
}

function rawUid(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const candidate = (event as {uid?: unknown; id?: unknown}).uid ??
    (event as {id?: unknown}).id;
  return candidate == null || String(candidate).trim() === "" ? null : String(candidate);
}

function logSyncSummary(report: SyncReport) {
  console.log(`[OPENAGENDA SYNC — LILLE]\n\n` +
    `Agenda UID:\n${report.agenda_uid}\n\n` +
    `Période:\n${report.period_start} → ${report.period_end}\n\n` +
    `Pages:\n${report.pages}\n\n` +
    `Events seen:\n${report.events_seen}\n\n` +
    `Events inserted:\n${report.events_inserted}\n\n` +
    `Events updated:\n${report.events_updated}\n\n` +
    `Occurrences:\n${report.occurrences_seen}\n\n` +
    `Duplicates:\n${report.duplicates}\n\n` +
    `Ignored:\n${report.ignored}\n\n` +
    `Errors:\n${report.errors}\n\n` +
    `Duration:\n${report.duration_ms} ms`);
}

async function runSync(): Promise<SyncReport> {
  const started = Date.now();
  const now = new Date();
  const period = openAgendaSyncPeriod(now);
  const periodStart = period.start;
  const source = sourceOpenAgenda(OPENAGENDA_SYNC.territory);
  console.log("[OPENAGENDA SYNC — LILLE]\nSTART");

  const result = await listOpenAgendaEvents({
    client: {fetchEventsPage}, source,
    until: period.end,
    relative: [...OPENAGENDA_SYNC.relative],
    apiKey: OPENAGENDA_API_KEY,
  });
  const state = await loadExistingState(source);
  const uniqueByUid = new Map<string, unknown>();
  const withoutUid: unknown[] = [];
  let duplicates = 0;
  for (const raw of result.events) {
    const uid = rawUid(raw);
    if (!uid) {
      withoutUid.push(raw);
      continue;
    }
    if (uniqueByUid.has(uid)) duplicates += 1;
    uniqueByUid.set(uid, raw);
  }

  let eventsNormalized = 0, eventsInserted = 0, eventsUpdated = 0;
  let occurrencesSeen = 0, occurrencesInserted = 0, occurrencesUpdated = 0;
  let ignored = 0, errors = 0;

  for (const raw of [...uniqueByUid.values(), ...withoutUid]) {
    const normalized = normalizeOpenAgendaEvent(raw, {
      source, now, from: periodStart, until: period.end,
    }) as NormalizedEvent | null;
    if (!normalized) {
      ignored += 1;
      continue;
    }
    eventsNormalized += 1;
    occurrencesSeen += normalized.occurrences.length;
    try {
      const persisted = await persistEvent(normalized, state);
      eventsInserted += persisted.eventInserted;
      eventsUpdated += persisted.eventUpdated;
      occurrencesInserted += persisted.occurrenceInserted;
      occurrencesUpdated += persisted.occurrenceUpdated;
      duplicates += persisted.duplicate;
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[OPENAGENDA SYNC — LILLE] ${normalized.external_id}: ${message}`);
    }
  }

  const successful = eventsInserted + eventsUpdated;
  const report: SyncReport = {
    status: errors === 0 ? "SUCCESS" : (successful > 0 ? "PARTIAL" : "FAIL"),
    provider: "openagenda",
    territory: "lille",
    agenda_uid: source.agendaUID,
    period_start: periodStart,
    period_end: period.end,
    pages: result.pages,
    events_seen: result.events.length,
    events_normalized: eventsNormalized,
    events_inserted: eventsInserted,
    events_updated: eventsUpdated,
    occurrences_seen: occurrencesSeen,
    occurrences_inserted: occurrencesInserted,
    occurrences_updated: occurrencesUpdated,
    duplicates,
    ignored,
    errors,
    duration_ms: Date.now() - started,
  };
  logSyncSummary(report);
  return report;
}

async function sameSecret(provided: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < x.length; index += 1) difference |= x[index] ^ y[index];
  return difference === 0;
}

Deno.serve(async (request: Request) => {
  if (!await sameSecret(request.headers.get("x-sync-secret") ?? "", SYNC_SECRET)) {
    return Response.json({error: "non autorisé"}, {status: 401});
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const territory = url.searchParams.get("territory");
  if (mode !== "test" && mode !== "sync") {
    return Response.json({error: "mode=test ou mode=sync obligatoire"}, {status: 400});
  }
  if (mode === "sync" && territory !== OPENAGENDA_SYNC.territory) {
    return Response.json({error: "territory=lille obligatoire pour mode=sync"}, {status: 400});
  }
  try {
    validateConfiguration();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({status: "FAIL", error: message}, {status: 503});
  }

  const scope = mode === "test" ? "lille:test" : "lille:sync";
  let runId: number | null = null;
  const started = Date.now();
  try {
    runId = await openRun(scope);
    if (mode === "test") {
      const result = await runTest();
      await closeRun(runId, {
        status: "success", duration_ms: Date.now() - started,
        events_seen: result.events_seen,
        events_inserted: result.events_inserted,
        events_updated: result.events_updated,
        territory: "lille", pages: result.pages,
        details: {mode: "test", pages: result.pages, event_uid: result.event_uid},
      });
      return Response.json(result);
    }

    const result = await runSync();
    await closeRun(runId, {
      status: result.status === "SUCCESS" ? "success" :
        (result.status === "PARTIAL" ? "partial" : "error"),
      duration_ms: result.duration_ms,
      events_seen: result.events_seen,
      events_inserted: result.events_inserted,
      events_updated: result.events_updated,
      events_merged: result.duplicates,
      events_rejected: result.ignored,
      territory: result.territory,
      pages: result.pages,
      occurrences_seen: result.occurrences_seen,
      occurrences_inserted: result.occurrences_inserted,
      occurrences_updated: result.occurrences_updated,
      duplicates: result.duplicates,
      ignored: result.ignored,
      errors: result.errors ? `${result.errors} erreur(s), voir les logs Edge Function` : null,
      details: {
        mode: "sync", territory: result.territory, agenda_uid: result.agenda_uid,
        period_start: result.period_start, period_end: result.period_end,
        pages: result.pages, events_normalized: result.events_normalized,
        occurrences_seen: result.occurrences_seen,
        occurrences_inserted: result.occurrences_inserted,
        occurrences_updated: result.occurrences_updated, errors: result.errors,
      },
    });
    return Response.json(result, {status: result.status === "FAIL" ? 502 : 200});
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      return Response.json({
        status: "SKIPPED_ALREADY_RUNNING",
        provider: "openagenda",
        territory: "lille",
        agenda_uid: sourceOpenAgenda("lille").agendaUID,
        run_id: error.runId,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[OPENAGENDA ${mode === "sync" ? "SYNC" : "TEST"} — VILLE DE LILLE] FAIL: ${message}`);
    await closeRun(runId, {status: "error", duration_ms: Date.now() - started, errors: message});
    const status = error instanceof OpenAgendaConfigurationError ? 503 : 502;
    return Response.json({status: "FAIL", error: message}, {status});
  }
});
