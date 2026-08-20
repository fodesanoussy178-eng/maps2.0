/* global AbortController, URL, clearTimeout, fetch, setTimeout */

const API_BASE = "https://api.openagenda.com/v2";
const PAGE_SIZE = 100;
const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

export class OpenAgendaConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenAgendaConfigurationError";
  }
}

export class OpenAgendaResponseError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "OpenAgendaResponseError";
    this.status = status;
  }
}

function addQuery(params, key, value) {
  if (value == null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) params.append(`${key}[]`, String(item));
    return;
  }
  params.set(key, String(value));
}

export function eventsUrl(source, {search, from, until, after, relative} = {}) {
  const url = new URL(`${API_BASE}/agendas/${encodeURIComponent(source.agendaUID)}/events`);
  url.searchParams.set("detailed", "1");
  url.searchParams.set("lang", "fr");
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.append("sort[]", "timings.asc");
  addQuery(url.searchParams, "search", search);
  addQuery(url.searchParams, "timings[gte]", from);
  addQuery(url.searchParams, "timings[lte]", until);
  addQuery(url.searchParams, "relative", relative);
  addQuery(url.searchParams, "after", after);
  return url;
}

function jsonHeaders(apiKey) {
  return {
    Accept: "application/json",
    // OpenAgenda lit la clé publique dans l'en-tête `key`. Elle ne traverse
    // jamais l'URL, le navigateur ou la réponse du connecteur.
    key: apiKey,
    "User-Agent": "Autour/sync-openagenda",
  };
}

function erreurReseau(erreur) {
  return erreur instanceof Error ? erreur : new Error(String(erreur));
}

async function fetchWithTimeout(url, apiKey, fetchImpl) {
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: jsonHeaders(apiKey),
      });
      clearTimeout(timer);
      if (response.ok || response.status < 500 || attempt === ATTEMPTS) return response;
      lastError = new OpenAgendaResponseError(`OpenAgenda HTTP ${response.status}`, response.status);
    } catch (error) {
      clearTimeout(timer);
      lastError = erreurReseau(error);
    }
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 300));
  }
  throw lastError || new Error("OpenAgenda injoignable");
}

function validatePayload(payload, status) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OpenAgendaResponseError("réponse OpenAgenda JSON invalide", status);
  }
  if (!Array.isArray(payload.events)) {
    throw new OpenAgendaResponseError("réponse OpenAgenda sans tableau events", status);
  }
  if (payload.after !== null && payload.after !== undefined && !Array.isArray(payload.after)) {
    throw new OpenAgendaResponseError("curseur OpenAgenda after invalide", status);
  }
  return {
    events: payload.events,
    after: payload.after ?? null,
    total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : null,
  };
}

export async function fetchEventsPage({source, search, from, until, after = null, relative,
  apiKey, fetchImpl = fetch} = {}) {
  if (!apiKey) throw new OpenAgendaConfigurationError("OPENAGENDA_API_KEY absente");
  const url = eventsUrl(source, {search, from, until, after, relative});
  const response = await fetchWithTimeout(url, apiKey, fetchImpl);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new OpenAgendaResponseError("réponse OpenAgenda non JSON", response.status);
  }
  if (!response.ok) {
    throw new OpenAgendaResponseError(`OpenAgenda HTTP ${response.status}`, response.status);
  }
  return validatePayload(payload, response.status);
}

export const OPENAGENDA_PAGE_SIZE = PAGE_SIZE;
