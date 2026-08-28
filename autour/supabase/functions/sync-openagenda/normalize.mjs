import {imageOpenAgenda} from "./image.mjs";
import {extractOccurrences} from "./occurrences.mjs";
import {normaliserAnnonce} from "../shared/annonces.mjs";

function list(value) {
  return Array.isArray(value) ? value : (value == null ? [] : [value]);
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
  if (typeof value === "object") {
    for (const key of ["fr", "@value", "value", "label", "name", "text", "content"]) {
      if (value[key] != null) {
        const found = text(value[key]);
        if (found) return found;
      }
    }
  }
  return "";
}

function normalisedText(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function number(value, max) {
  if (value == null || String(value).trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && Math.abs(result) <= max ? result : null;
}

function object(value) {
  return list(value).find((item) => item && typeof item === "object") || {};
}

function locationData(event) {
  const location = object(event?.location);
  const address = object(location.address ?? event?.address);
  const geo = object(location.geo ?? location.coordinates ?? event?.geo);
  const latitude = number(location.latitude ?? location.lat ?? geo.latitude ?? geo.lat, 90);
  const longitude = number(location.longitude ?? location.lng ?? location.lon ?? geo.longitude ?? geo.lng, 180);
  const street = text(address.streetAddress ?? address.street ?? address.addressLine ?? location.address);
  const postalCode = text(address.postalCode ?? address.zipCode ?? location.postalCode);
  const city = text(address.addressLocality ?? address.city ?? location.city);
  return {
    venueName: text(location.name ?? location.title),
    address: [street, postalCode, city].filter(Boolean).join(", ") || null,
    city: city || null,
    latitude,
    longitude,
  };
}

function category(event) {
  return text(event?.category ?? event?.type ?? event?.keywords ?? event?.tags?.[0]) || null;
}

function sourceUrl(event, source, eventUID) {
  const supplied = text(event?.canonicalUrl ?? event?.sourceUrl ?? event?.url);
  return supplied || `https://openagenda.com/${source.agendaSlug}/events/${eventUID}`;
}

export function titleComparable(value) {
  return normalisedText(value);
}

export function isTargetEvent(event, target) {
  const uid = text(event?.uid ?? event?.id);
  const title = titleComparable(event?.title);
  return uid === String(target.eventUID) || title === titleComparable(target.expectedTitle);
}

export function isCancelledEvent(event) {
  return Number(event?.status) === 6 || /cancel/i.test(text(event?.status));
}

export function occurrenceOverlapsWindow(occurrence, {from, until} = {}) {
  const start = Date.parse(occurrence?.start_at ?? "");
  const end = occurrence?.end_at ? Date.parse(occurrence.end_at) : null;
  const fromMs = from ? Date.parse(from) : null;
  const untilMs = until ? Date.parse(until) : null;
  if (!Number.isFinite(start)) return false;
  if (Number.isFinite(untilMs) && start > untilMs) return false;
  if (Number.isFinite(fromMs)) {
    if (end != null && Number.isFinite(end)) return end >= fromMs;
    return start >= fromMs;
  }
  return true;
}

export function normalizeOpenAgendaEvent(event, {source, now = new Date(), from, until} = {}) {
  if (!event || typeof event !== "object" || !source) return null;
  const externalId = text(event.uid ?? event.id);
  const title = text(event.title);
  if (!externalId || !title) return null;
  const cancelled = isCancelledEvent(event);
  const occurrences = extractOccurrences(event, {
    agendaUID: source.agendaUID,
    timezone: source.timezone,
    now,
    cancelled,
  }).filter((occurrence) => occurrenceOverlapsWindow(occurrence, {from, until}));
  if (!occurrences.length) return null;

  const location = locationData(event);
  const shortDescription = text(event.description) || null;
  const longDescription = text(event.longDescription) || null;
  const description = longDescription || shortDescription;
  const firstOccurrence = occurrences[0];
  const timezone = firstOccurrence.timezone || source.timezone;
  /* L'affiche officielle de l'événement, recomposée depuis `base` + `filename`
     (voir `image.mjs` : c'est elle qui rendait `.../main/` et donc HTTP 400).
     Sa provenance voyage avec elle jusqu'en base — sans quoi le navigateur ne
     saurait pas dire d'où vient ce qu'il affiche, ni sous quel droit. */
  const affiche = imageOpenAgenda(event, {
    sourceUrl: sourceUrl(event, source, externalId),
    now,
  });
  const annonce = normaliserAnnonce(event, {
    source: "openagenda",
    externalId,
    sourceUrl: sourceUrl(event, source, externalId),
  });
  const rawEvent = annonce.tagEvidence?.length
    ? {...event, announcement_tag_evidence: annonce.tagEvidence}
    : event;
  const normalized = {
    source: "openagenda",
    source_agenda: source.sourceAgenda,
    source_agenda_uid: source.sourceAgendaUid,
    external_id: externalId,
    title: title.slice(0, 200),
    description_short: shortDescription,
    description_long: longDescription,
    start_at: firstOccurrence.start_at,
    end_at: firstOccurrence.end_at,
    timezone,
    venue_name: location.venueName,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    image_url: affiche ? affiche.image_url : null,
    image: affiche,
    source_url: sourceUrl(event, source, externalId),
    category: category(event),
    last_source_update: text(event.updatedAt) || null,
    occurrences,
    raw_event: rawEvent,
  };
  return {
    ...normalized,
    event: {
      title: normalized.title,
      description,
      category: normalized.category,
      start_at: normalized.start_at,
      end_at: normalized.end_at,
      timezone: normalized.timezone,
      date_confidence: firstOccurrence.date_confidence,
      temporal_status: firstOccurrence.temporal_status,
      place_name: normalized.venue_name,
      address: normalized.address,
      city: location.city,
      lat: normalized.latitude,
      lng: normalized.longitude,
      primary_source: "openagenda",
      source_url: normalized.source_url,
      image_url: normalized.image_url,
      /* Les six champs du contrat, écrits tels quels : `persistEvent` recopie
         `normalized.event` dans la table, donc la provenance suit la photo
         sans qu'aucune couche intermédiaire ait à la connaître. */
      image_source: affiche ? affiche.image_source : null,
      image_source_url: affiche ? affiche.image_source_url : null,
      image_author: affiche ? affiche.image_author : null,
      image_license: affiche ? affiche.image_license : null,
      image_updated_at: affiche ? affiche.image_updated_at : null,
      cancelled,
      last_source_update: normalized.last_source_update,
      ...annonce.fields,
    },
  };
}
