/* Synchronisation progressive des pages officielles Lille/MEL.
   Authentification identique aux autres synchronisations : ce point d'entrée
   est destiné au scheduler, jamais au navigateur. Une source en panne est
   journalisée puis les autres continuent. */

import {fusionnerAnnonceFields, normaliserAnnonce} from "../shared/annonces.mjs";
import {discoverLinks, extractJsonLd, htmlEventCandidates, jsonLdEvents, normalizeDirectEvent} from "./normalize.mjs";

type Json = Record<string, any>;

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";
let serviceKey: string | null = null;

const SOURCES = [
  // La page /agenda/ historique renvoie 404 ; l'accueil officiel expose les
  // liens /evenement/... et leurs données JSON-LD.
  {id: "zenith", name: "Zénith de Lille", source: "venue_official", url: "https://www.zenithdelille.com/", pattern: /evenement|event|concert|programmation/i, venue: "Zénith de Lille", city: "Lille", latitude: 50.6240, longitude: 3.1300, category: "concert", defaultTags: ["music", "concert"]},
  {id: "flow", name: "Flow", source: "venue_official", url: "https://flow.lille.fr/agenda", pattern: /agenda|concert|flow/i, linkTextPattern: /concert|musique|billetterie|réservation|gratuit|20\d\d/i, venue: "Flow", city: "Lille", latitude: 50.6310, longitude: 3.0720, category: "concert", defaultTags: ["music", "concert"]},
  {id: "aeronef", name: "L'Aéronef", source: "venue_official", url: "https://aeronef.fr/agenda", pattern: /agenda|concert/i, venue: "L'Aéronef", city: "Lille", latitude: 50.6390, longitude: 3.0760, category: "concert", defaultTags: ["music", "concert"]},
  {id: "grand-palais", name: "Lille Grand Palais", source: "venue_official", url: "https://www.lillegrandpalais.com/calendrier/", pattern: /evenement|event|calendrier/i, venue: "Lille Grand Palais", city: "Lille", latitude: 50.6320, longitude: 3.0760, category: "culture", defaultTags: ["culture"]},
  {id: "geek-days", name: "Geek Days", source: "organizer_official", url: "https://www.geek-days.com/", pattern: /lille|event|billet/i, pageFallback: true, venue: "Lille", city: "Lille", latitude: 50.6320, longitude: 3.0760, category: "festival", defaultTags: ["manga_anime_gaming", "manga", "anime", "convention", "gaming"]},
  {id: "festival-livres-haut", name: "Festival des livres d'en haut", source: "organizer_official", url: "https://www.festivaldeslivresdenhaut.com/pole-bd-comics-manga-2026/", pattern: /pole-bd-comics-manga-2026/i, eventPathPattern: /pole-bd-comics-manga-2026/i, venue: "Gare Saint Sauveur", city: "Lille", latitude: 50.6290, longitude: 3.0730, category: "festival", defaultTags: ["manga_anime_gaming", "manga", "anime", "festival"]},
] as const;

function key(): string {
  if (serviceKey) return serviceKey;
  const dictionary = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dictionary) {
    const parsed = JSON.parse(dictionary) as Record<string, string>;
    const name = Deno.env.get("SUPABASE_SECRET_KEY_NAME") ?? "default";
    serviceKey = parsed[name] ?? "";
  } else serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
  return serviceKey;
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const secret = key();
  return fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    ...init,
    headers: {apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init.headers ?? {})},
  });
}

async function read(path: string): Promise<Json[]> {
  const response = await rest(path);
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status} (${path.slice(0, 220)}): ${(await response.text()).slice(0, 240)}`);
  return await response.json();
}

async function write(path: string, body: Json | Json[], method = "POST", prefer = "return=representation"): Promise<Json[]> {
  const response = await rest(path, {method, headers: {Prefer: prefer}, body: JSON.stringify(body)});
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status} (${path.slice(0, 220)}): ${(await response.text()).slice(0, 240)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function fetchPage(url: string): Promise<{status: number; html: string}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept: "text/html,application/xhtml+xml", "User-Agent": "Autour/sync-lille-official"}});
    return {status: response.status, html: response.ok ? await response.text() : ""};
  } finally { clearTimeout(timeout); }
}

function titleTokens(value: string): Set<string> {
  return new Set(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((item) => item && !["le", "la", "les", "de", "des", "du", "en", "un", "une", "et", "stage"].includes(item)));
}

function similarTitle(a: string, b: string): boolean {
  const left = titleTokens(a), right = titleTokens(b);
  if (left.size < 2 || right.size < 2) return false;
  const subset = (small: Set<string>, large: Set<string>) => [...small].every((token) => large.has(token));
  return subset(left, right) || subset(right, left);
}

async function candidate(event: Json): Promise<Json | null> {
  const lat = Number(event.lat), lng = Number(event.lng), start = new Date(event.start_at).getTime();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(start)) return null;
  const from = new Date(start - 2 * 3600_000).toISOString();
  const until = new Date(start + 2 * 3600_000).toISOString();
  const rows = await read(`events?select=id,title,start_at,lat,lng,primary_source,announced_at,presale_at,tickets_open_at,ticket_url,announcement_tags,performers,organizer,announcement_provenance&lat=gte.${(lat - .002).toFixed(4)}&lat=lte.${(lat + .002).toFixed(4)}&lng=gte.${(lng - .003).toFixed(4)}&lng=lte.${(lng + .003).toFixed(4)}&start_at=gte.${encodeURIComponent(from)}&start_at=lte.${encodeURIComponent(until)}&limit=20`);
  return rows.find((row) => similarTitle(row.title, event.title)) ?? null;
}

async function persist(normalized: Json): Promise<{inserted: number; updated: number; duplicate: number}> {
  const source = normalized.source as string;
  const externalId = String(normalized.external_id);
  const existingSource = await read(`event_sources?select=event_id&source=eq.${encodeURIComponent(source)}&external_id=eq.${encodeURIComponent(externalId)}&limit=1`);
  let eventId = existingSource[0]?.event_id ?? null;
  let duplicate = 0;
  if (!eventId) {
    const match = await candidate(normalized.event);
    eventId = match?.id ?? null;
    if (eventId) duplicate = 1;
  }
  const announcement = normaliserAnnonce(normalized.raw_event, {source, externalId, sourceUrl: normalized.source_url});
  const rawData = announcement.tagEvidence?.length
    ? {...normalized.raw_event, announcement_tag_evidence: announcement.tagEvidence}
    : normalized.raw_event;
  if (eventId) {
    const current = (await read(`events?id=eq.${encodeURIComponent(eventId)}&select=*&limit=1`))[0] ?? {};
    const merged = fusionnerAnnonceFields(current, {...normalized.event, ...announcement.fields});
    await write(`events?id=eq.${encodeURIComponent(eventId)}`, {...normalized.event, ...announcement.fields, ...merged, primary_source: source, last_synced_at: new Date().toISOString()}, "PATCH");
  } else {
    const rows = await write("events", {...normalized.event, ...announcement.fields, last_synced_at: new Date().toISOString()});
    eventId = rows[0]?.id ?? null;
  }
  if (!eventId) throw new Error(`événement sans id: ${externalId}`);
  await write("event_sources?on_conflict=source,external_id", [{
    event_id: eventId, source, external_id: externalId, source_url: normalized.source_url,
    raw_data: rawData, synced_at: new Date().toISOString(),
  }], "POST", "resolution=merge-duplicates,return=representation");
  return {inserted: existingSource.length || duplicate ? 0 : 1, updated: existingSource.length || duplicate ? 1 : 0, duplicate};
}

async function retireMissing(config: typeof SOURCES[number], seenExternalIds: Set<string>): Promise<number> {
  if (!seenExternalIds.size) return 0;
  const source = encodeURIComponent(config.source);
  const host = new URL(config.url).hostname;
  const previous = await read("event_sources?select=event_id,external_id,source_url&source=eq." + source + "&limit=1000");
  let retired = 0;
  for (const row of previous) {
    try { if (new URL(String(row.source_url || "")).hostname !== host) continue; }
    catch { continue; }
    if (seenExternalIds.has(String(row.external_id)) || !row.event_id) continue;
    const linked = await read("event_sources?select=source&event_id=eq." + encodeURIComponent(row.event_id) + "&limit=50");
    // Ne pas retirer un canonique confirmé par une autre source.
    if (!linked.length || linked.some((item) => item.source !== config.source)) continue;
    await write("events?id=eq." + encodeURIComponent(row.event_id), {cancelled: true}, "PATCH", "return=minimal");
    retired += 1;
  }
  return retired;
}

async function syncSource(config: typeof SOURCES[number]) {
  const page = await fetchPage(config.url);
  if (page.status < 200 || page.status >= 300) {
    console.error("[sync-lille-official] fournisseur indisponible", JSON.stringify({source: config.id, url: config.url, status: page.status}));
    return {source: config.id, status: page.status, discovered: 0, persisted: 0, failed: 0, duplicates: 0, retired: 0, errors: []};
  }
  const pages = [config.url, ...discoverLinks(page.html, config.url, config.pattern, 80, config.linkTextPattern)];
  const events: Json[] = [];
  const addDiscovered = (normalized: Json, prefer = false) => {
    const index = events.findIndex((item) => item.external_id === normalized.external_id ||
      (item.event.source_url === normalized.event.source_url && similarTitle(item.event.title, normalized.event.title)) ||
      (item.event.start_at === normalized.event.start_at && similarTitle(item.event.title, normalized.event.title)));
    if (index < 0) events.push(normalized);
    else if (prefer) events[index] = normalized;
  };
  for (const url of pages) {
    try {
      const response = url === config.url ? page : await fetchPage(url);
      if (response.status < 200 || response.status >= 300) continue;
      for (const json of extractJsonLd(response.html)) {
        for (const raw of jsonLdEvents(json)) {
          const normalized = normalizeDirectEvent(raw, {config, pageUrl: url});
          if (normalized) addDiscovered(normalized);
        }
      }
      for (const raw of htmlEventCandidates(response.html, {config, pageUrl: url, isListing: url === config.url})) {
        const normalized = normalizeDirectEvent(raw, {config, pageUrl: url});
        if (normalized) addDiscovered(normalized, url !== config.url);
      }
    } catch (error) {
      console.error("[sync-lille-official] page ignorée", JSON.stringify({source: config.id, url, error: String(error?.message || error)}));
    }
  }
  let persisted = 0, duplicates = 0, failed = 0, retired = 0;
  const errors: string[] = [];
  for (const event of events) {
    try { const result = await persist(event); persisted += 1; duplicates += result.duplicate; }
    catch (error) {
      failed += 1;
      const message = String(error?.message || error);
      if (errors.length < 3) errors.push(message.slice(0, 240));
      console.error("[sync-lille-official] événement ignoré", JSON.stringify({source: config.id, error: message}));
    }
  }
  if (events.length) retired = await retireMissing(config, new Set(events.map((event) => String(event.external_id))));
  console.info("[sync-lille-official] source", JSON.stringify({source: config.id, url: config.url, status: page.status, discovered: events.length, persisted, failed, duplicates, retired}));
  return {source: config.id, status: page.status, discovered: events.length, persisted, failed, duplicates, retired, errors};
}

function authorized(request: Request): boolean {
  return Boolean(SYNC_SECRET) && request.headers.get("x-sync-secret") === SYNC_SECRET;
}

Deno.serve(async (request) => {
  if (request.method !== "POST" || !authorized(request)) return new Response(JSON.stringify({error: "unauthorized"}), {status: 401, headers: {"content-type": "application/json"}});
  const requested = new URL(request.url).searchParams.get("source");
  const sources = requested ? SOURCES.filter((source) => source.id === requested) : SOURCES;
  const results = [];
  for (const source of sources) {
    try { results.push(await syncSource(source)); }
    catch (error) { console.error("[sync-lille-official] source en échec", JSON.stringify({source: source.id, error: String(error?.message || error)})); results.push({source: source.id, status: 599, discovered: 0, persisted: 0, failed: 0, duplicates: 0, retired: 0, errors: [String(error?.message || error).slice(0, 240)]}); }
  }
  return new Response(JSON.stringify({ok: true, results}), {headers: {"content-type": "application/json"}});
});
