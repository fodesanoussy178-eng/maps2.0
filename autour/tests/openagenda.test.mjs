/* global URL */

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {eventsUrl} from "../supabase/functions/sync-openagenda/client.mjs";
import {
  OPENAGENDA_SOURCES, OPENAGENDA_SYNC, OPENAGENDA_TEST, openAgendaSyncPeriod,
} from "../supabase/functions/sync-openagenda/config.mjs";
import {eventDedupKey} from "../supabase/functions/sync-openagenda/dedup.mjs";
import {listOpenAgendaEvents} from "../supabase/functions/sync-openagenda/pagination.mjs";
import {extractOccurrences, sourceOccurrenceId, temporalStatus} from "../supabase/functions/sync-openagenda/occurrences.mjs";
import {
  isCancelledEvent,
  isTargetEvent,
  normalizeOpenAgendaEvent,
  occurrenceOverlapsWindow,
} from "../supabase/functions/sync-openagenda/normalize.mjs";

const source = OPENAGENDA_SOURCES.lille;
const now = new Date("2026-08-20T10:00:00.000Z");

function targetEvent(overrides = {}) {
  return {
    uid: "78801027",
    title: {fr: 'Atelier "porte-clef moule" - Braderie des enfants 2026'},
    description: {fr: "Venez fabriquer votre propre porte-clef."},
    longDescription: {fr: "Atelier proposé à la Gare Saint Sauveur."},
    timezone: "Europe/Paris",
    location: {
      name: "Gare Saint Sauveur",
      address: {streetAddress: "17 bd Jean Baptiste Lebas", postalCode: "59046", addressLocality: "Lille"},
      geo: {latitude: 50.627319, longitude: 3.069793},
    },
    canonicalUrl: "https://openagenda.com/ville-de-lille/events/78801027_atelier-porte-clef-moule-braderie-des-enfants-2026",
    timings: [{begin: "2026-09-05T10:00:00+0200", end: "2026-09-05T17:00:00+0200"}],
    ...overrides,
  };
}

test("la configuration pointe vers l'agenda officiel Ville de Lille", () => {
  assert.equal(source.agendaUID, "57621068");
  assert.equal(source.agendaSlug, "ville-de-lille");
  assert.equal(source.officialName, "Ville de Lille");
});

test("le titre et l'UID identifient l'événement cible malgré ses guillemets source", () => {
  assert.equal(isTargetEvent(targetEvent(), OPENAGENDA_TEST), true);
});

test("la normalisation conserve le lieu, les coordonnées et le fuseau", () => {
  const normalized = normalizeOpenAgendaEvent(targetEvent(), {source, now});
  assert.equal(normalized.title, 'Atelier "porte-clef moule" - Braderie des enfants 2026');
  assert.equal(normalized.source_agenda_uid, "57621068");
  assert.equal(normalized.venue_name, "Gare Saint Sauveur");
  assert.equal(normalized.latitude, 50.627319);
  assert.equal(normalized.longitude, 3.069793);
  assert.equal(normalized.occurrences.length, 1);
  assert.equal(normalized.occurrences[0].start_at, "2026-09-05T08:00:00.000Z");
  assert.equal(normalized.occurrences[0].end_at, "2026-09-05T15:00:00.000Z");
  assert.equal(normalized.occurrences[0].timezone, "Europe/Paris");
  assert.equal(normalized.occurrences[0].temporal_status, "upcoming");
  assert.equal(normalized.occurrences[0].isEligibleForNow, false);
});

test("chaque timing reste une occurrence et son identifiant est stable", () => {
  const event = targetEvent({timings: [
    {begin: "2026-09-05T10:00:00+0200", end: "2026-09-05T12:00:00+0200"},
    {begin: "2026-09-05T14:00:00+0200", end: "2026-09-05T17:00:00+0200"},
    {begin: "2026-09-06T11:00:00+0200", end: "2026-09-06T13:00:00+0200"},
  ]});
  const occurrences = extractOccurrences(event, {agendaUID: source.agendaUID, timezone: source.timezone, now});
  assert.equal(occurrences.length, 3);
  assert.notEqual(occurrences[0].source_occurrence_id, occurrences[1].source_occurrence_id);
  assert.equal(occurrences[0].source_occurrence_id,
    sourceOccurrenceId({agendaUID: source.agendaUID, eventUID: "78801027", timing: event.timings[0], startAt: occurrences[0].start_at}));
});

test("une fin absente reste inconnue et ne rend jamais l'événement maintenant", () => {
  const occurrences = extractOccurrences(targetEvent({timings: [{begin: "2026-08-20T08:00:00+0200"}]}), {
    agendaUID: source.agendaUID, timezone: source.timezone, now,
  });
  assert.equal(occurrences[0].end_at, null);
  assert.equal(occurrences[0].temporal_status, "unknown_date");
  assert.equal(occurrences[0].isEligibleForNow, false);
});

test("un futur ne peut pas être now, même à cinq minutes", () => {
  assert.equal(temporalStatus({
    startAt: "2026-08-20T10:05:00.000Z",
    endAt: "2026-08-20T12:00:00.000Z",
    now,
  }), "soon");
});

test("la pagination suit after et refuse un curseur répété", async () => {
  const calls = [];
  const pages = [
    {events: [{uid: "1"}], after: ["0", "next"], total: 2},
    {events: [{uid: "2"}], after: null, total: 2},
  ];
  const result = await listOpenAgendaEvents({
    client: {fetchEventsPage: async ({after}) => {
      calls.push(after);
      return pages[calls.length - 1];
    }},
    source, apiKey: "test",
  });
  assert.equal(result.events.length, 2);
  assert.deepEqual(calls, [null, ["0", "next"]]);

  await assert.rejects(() => listOpenAgendaEvents({
    client: {fetchEventsPage: async () => ({events: [{uid: "1"}], after: ["same"]})},
    source, apiKey: "test", maxPages: 5,
  }), /répété|interrompue/);
});

test("la requête de synchronisation couvre les événements en cours et futurs sans exposer la clé", () => {
  const period = openAgendaSyncPeriod(now);
  const url = eventsUrl(source, {
    until: period.end,
    relative: [...OPENAGENDA_SYNC.relative],
    after: ["2026-09-05T08:00:00.000Z", "78801027"],
  });
  assert.deepEqual(url.searchParams.getAll("relative[]"), ["current", "upcoming"]);
  assert.equal(url.searchParams.get("timings[lte]"), "2026-09-19T10:00:00.000Z");
  assert.equal(url.searchParams.has("timings[gte]"), false);
  assert.deepEqual(url.searchParams.getAll("after[]"), ["2026-09-05T08:00:00.000Z", "78801027"]);
  assert.equal(url.searchParams.has("key"), false);
});

test("la fenêtre locale garde un événement déjà commencé et écarte le passé et l'après-horizon", () => {
  const window = {from: now.toISOString(), until: openAgendaSyncPeriod(now).end};
  assert.equal(occurrenceOverlapsWindow({
    start_at: "2026-08-20T08:00:00.000Z", end_at: "2026-08-20T12:00:00.000Z",
  }, window), true);
  assert.equal(occurrenceOverlapsWindow({
    start_at: "2026-08-20T06:00:00.000Z", end_at: "2026-08-20T09:59:59.000Z",
  }, window), false);
  assert.equal(occurrenceOverlapsWindow({
    start_at: "2026-09-19T10:00:00.000Z", end_at: null,
  }, window), true);
  assert.equal(occurrenceOverlapsWindow({
    start_at: "2026-09-19T10:00:00.001Z", end_at: "2026-09-19T12:00:00.000Z",
  }, window), false);
});

test("la période de cron part de l'instant réel et conserve un horizon glissant après la Braderie", () => {
  assert.deepEqual(openAgendaSyncPeriod(now), {
    start: "2026-08-20T10:00:00.000Z",
    end: "2026-09-19T10:00:00.000Z",
  });
  assert.deepEqual(openAgendaSyncPeriod(new Date("2026-10-01T00:00:00.000Z")), {
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-10-31T00:00:00.000Z",
  });
});

test("une annulation OpenAgenda fiable est conservée", () => {
  assert.equal(isCancelledEvent(targetEvent({status: 6})), true);
  const normalized = normalizeOpenAgendaEvent(targetEvent({status: 6}), {source, now});
  assert.equal(normalized.event.cancelled, true);
});

test("la clé de déduplication inter-sources est stable et identique au format SQL", () => {
  assert.equal(eventDedupKey(
    "Événement test", 50.627319, 3.069793, "2026-09-05T08:42:00.000Z",
  ), "evenement test|50.627|3.070|2026090508");
  assert.equal(eventDedupKey("Événement test", null, 3.069793, "2026-09-05T08:42:00.000Z"), null);
});

test("la fonction refuse tout import implicite et conserve le mode test", () => {
  const sourceCode = readFileSync(new URL(
    "../supabase/functions/sync-openagenda/index.ts", import.meta.url,
  ), "utf8");
  assert.match(sourceCode, /mode !== "test" && mode !== "sync"/);
  assert.match(sourceCode, /territory !== OPENAGENDA_SYNC\.territory/);
  assert.match(sourceCode, /if \(mode === "test"\)/);
  assert.match(sourceCode, /on_conflict=source,source_occurrence_id/);
  assert.match(sourceCode, /SKIPPED_ALREADY_RUNNING/);
  assert.match(sourceCode, /status=eq\.running/);
  assert.match(sourceCode, /\[OPENAGENDA SYNC — LILLE\]\\nSTART/);
  for (const field of [
    "pages", "events_seen", "events_normalized", "events_inserted", "events_updated",
    "occurrences_seen", "occurrences_inserted", "occurrences_updated", "duplicates",
    "ignored", "errors", "duration_ms",
  ]) {
    assert.match(sourceCode, new RegExp(`\\b${field}\\b`));
  }
});
