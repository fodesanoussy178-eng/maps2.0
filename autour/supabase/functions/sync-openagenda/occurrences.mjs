const ISO_WITH_TIME_AND_ZONE = /T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
  if (typeof value === "object") {
    for (const key of ["fr", "@value", "value", "label", "name", "text"]) {
      if (value[key] != null) {
        const found = text(value[key]);
        if (found) return found;
      }
    }
  }
  return "";
}

function instant(value) {
  const raw = text(value).trim();
  // Un horaire local sans offset est ambigu : OpenAgenda doit fournir son
  // offset ou Z. Refuser vaut mieux que de décaler silencieusement Lille.
  if (!ISO_WITH_TIME_AND_ZONE.test(raw)) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function timingNativeId(timing) {
  for (const key of ["occurrenceUid", "timingUid", "uid", "id", "key"]) {
    const value = text(timing?.[key]);
    if (value) return value;
  }
  return null;
}

export function temporalStatus({startAt, endAt, cancelled = false, now = new Date(),
  soonWindowMs = 24 * 60 * 60 * 1000} = {}) {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const at = now instanceof Date ? now : new Date(now);
  if (!start || !Number.isFinite(start.getTime())) return "unknown_date";
  if (!endAt) return start <= at ? "unknown_date" : "unknown_date";
  if (!end || !Number.isFinite(end.getTime())) return "unknown_date";
  if (end < at) return "past";
  if (start <= at && end >= at) return cancelled ? "past" : "now";
  if (start > at && start.getTime() - at.getTime() <= soonWindowMs) return "soon";
  return "upcoming";
}

export function sourceOccurrenceId({agendaUID, eventUID, timing, startAt}) {
  const native = timingNativeId(timing);
  if (native) return `openagenda:${agendaUID}:${eventUID}:timing:${native}`;
  return `openagenda:${agendaUID}:${eventUID}:${startAt}`;
}

export function extractOccurrences(event, {agendaUID, timezone = "Europe/Paris",
  now = new Date(), cancelled = false} = {}) {
  const timings = Array.isArray(event?.timings) ? event.timings : [];
  const eventUID = text(event?.uid ?? event?.id);
  return timings.map((timing) => {
    if (!timing || typeof timing !== "object") return null;
    const start = instant(timing.begin ?? timing.start ?? timing.startAt);
    if (!start) return null;
    const end = instant(timing.end ?? timing.finish ?? timing.endAt);
    const startAt = start.toISOString();
    const endAt = end ? end.toISOString() : null;
    const dateConfidence = endAt ? "exact" : "unknown";
    return {
      source_event_id: eventUID,
      source_occurrence_id: sourceOccurrenceId({agendaUID, eventUID, timing, startAt}),
      start_at: startAt,
      end_at: endAt,
      timezone: text(timing.timezone ?? event?.timezone) || timezone,
      date_confidence: dateConfidence,
      temporal_status: dateConfidence === "exact"
        ? temporalStatus({startAt, endAt, cancelled, now})
        : "unknown_date",
      isEligibleForNow: dateConfidence === "exact"
        && temporalStatus({startAt, endAt, cancelled, now}) === "now",
      raw_timing: timing,
    };
  }).filter(Boolean).sort((a, b) => a.start_at.localeCompare(b.start_at));
}
