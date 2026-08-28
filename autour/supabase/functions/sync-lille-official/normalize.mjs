/* Normalisation pure des pages officielles Lille/MEL.
   Le connecteur ne déduit pas une date d'annonce depuis la date de mise à
   jour HTML : seule une datePublished explicite et horodatée peut entrer dans
   announced_at. */

function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
  if (typeof value === "object") {
    for (const key of ["fr", "@value", "name", "value", "label", "text", "url"]) {
      const found = text(value[key]);
      if (found) return found;
    }
  }
  return "";
}

function list(value) {
  return Array.isArray(value) ? value : (value == null ? [] : [value]);
}

function absoluteUrl(value, base) {
  try { return new URL(text(value), base).toString(); } catch { return null; }
}

function isListingPage(value) {
  try { return /\/(?:agenda|calendrier|programmation)\/?$/i.test(new URL(value).pathname); }
  catch { return false; }
}

// `events.image_url` accepte uniquement une URL qui pointe vers un fichier
// image (ou une URL avec query string). Les sites officiels exposent parfois
// un endpoint média ou une route de transformation sans nom de fichier :
// l'image étant facultative, on l'écarte plutôt que de faire échouer toute
// l'écriture de l'événement.
function directImage(value, base) {
  const url = absoluteUrl(value, base);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return /\.[a-z0-9]{2,5}$/i.test(lastSegment) || parsed.search ? url : null;
  } catch {
    return null;
  }
}

const MOIS = Object.freeze({
  janvier: 1, janv: 1, février: 2, fevrier: 2, févr: 2, fevr: 2,
  mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7,
  août: 8, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10,
  novembre: 11, nov: 11, décembre: 12, decembre: 12, déc: 12, dec: 12,
});

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&eacute;|&#233;/gi, "é").replace(/&egrave;|&#232;/gi, "è")
    .replace(/&ecirc;|&#234;/gi, "ê").replace(/&agrave;|&#224;/gi, "à")
    .replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function htmlText(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function isoDay(day, month, year) {
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(parsed);
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) ? date.toISOString() : null;
}

function frenchDate(value) {
  const source = htmlText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const month = "(janvier|janv|fevrier|fevr|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec)\\.?";
  let match = source.match(new RegExp(`(?:du\\s+)?(\\d{1,2})\\s+${month}\\s+(?:au|a|[-–])\\s*(\\d{1,2})\\s+${month}\\s+(\\d{4})`, "i"));
  if (match) {
    const firstMonth = MOIS[match[2].replace(/\.$/, "")];
    const lastMonth = MOIS[match[4].replace(/\.$/, "")];
    const start = isoDay(match[1], firstMonth, match[5]);
    const end = isoDay(match[3], lastMonth, match[5]);
    if (start) return {startDate: start.slice(0, 10), endDate: end ? end.slice(0, 10) : null};
  }
  match = source.match(new RegExp(`(?:du\\s+)?(\\d{1,2})\\s*(?:[/]|\\bet\\b|au|a|[-–])\\s*(\\d{1,2})\\s+${month}\\s+(\\d{4})`, "i"));
  if (match) {
    const monthNumber = MOIS[match[3].replace(/\.$/, "")];
    const start = isoDay(match[1], monthNumber, match[4]);
    const end = isoDay(match[2], monthNumber, match[4]);
    if (start) return {startDate: start.slice(0, 10), endDate: end ? end.slice(0, 10) : null};
  }
  match = source.match(new RegExp(`(?:le\\s+|du\\s+)?(\\d{1,2})\\s+${month}\\s+(\\d{4})`, "i"));
  if (match) {
    const start = isoDay(match[1], MOIS[match[2].replace(/\.$/, "")], match[3]);
    if (start) return {startDate: start.slice(0, 10), endDate: null};
  }
  return null;
}

// Même règle, mais en respectant l'ordre d'apparition dans le bloc visible.
// C'est important lorsqu'un gabarit place un événement associé (par exemple
// une période du calendrier) après la date de l'événement courant.
function firstVisibleDate(value) {
  const source = htmlText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const mois = "(janvier|janv|fevrier|fevr|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec)";
  const candidates = [];
  const differentMonth = new RegExp("(?:du\\s+)?(\\d{1,2})\\s+" + mois +
    "\\.?\\s+(?:au|a|[-–])\\s*(\\d{1,2})\\s+" + mois + "\\.?\\s+(\\d{4})", "gi");
  const sameMonth = new RegExp("(?:du\\s+)?(\\d{1,2})\\s*(?:[/]|\\bet\\b|au|a|[-–])\\s*" +
    "(\\d{1,2})\\s+" + mois + "\\.?\\s+(\\d{4})", "gi");
  const single = new RegExp("(?:le\\s+|du\\s+)?(\\d{1,2})\\s+" + mois + "\\.?\\s+(\\d{4})", "gi");
  for (const match of source.matchAll(differentMonth)) {
    const start = isoDay(match[1], MOIS[match[2]], match[5]);
    const end = isoDay(match[3], MOIS[match[4]], match[5]);
    if (start) candidates.push({index: match.index, startDate: start.slice(0, 10), endDate: end ? end.slice(0, 10) : null});
  }
  for (const match of source.matchAll(sameMonth)) {
    const start = isoDay(match[1], MOIS[match[3]], match[4]);
    const end = isoDay(match[2], MOIS[match[3]], match[4]);
    if (start) candidates.push({index: match.index, startDate: start.slice(0, 10), endDate: end ? end.slice(0, 10) : null});
  }
  for (const match of source.matchAll(single)) {
    const start = isoDay(match[1], MOIS[match[2]], match[3]);
    if (start) candidates.push({index: match.index, startDate: start.slice(0, 10), endDate: null});
  }
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0] || null;
}

function firstHtmlMatch(html, pattern) {
  const match = String(html || "").match(pattern);
  return match ? htmlText(match[1]) : "";
}

function htmlLink(html, base) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const href = absoluteUrl(match[1], base);
    const label = htmlText(match[2]);
    if (!href || !/^https?:\/\//i.test(href)) continue;
    links.push({href, label});
  }
  return links.find((item) => /ticket|billet|reservation|réservation|inscription|inscrire|register/i.test(`${item.label} ${item.href}`)) || null;
}

/* Certaines pages d'agenda officielles n'embarquent pas de JSON-LD. Ce repli
   ne s'active que pour une page d'événement (ou une page explicitement
   autorisée par la source), et ne retient qu'un titre et une date écrits dans
   le HTML. Il ne consulte ni le titre ni la description pour fabriquer des
   tags et ne transforme jamais une date de mise à jour en date d'annonce. */
export function htmlEventCandidates(html, {config, pageUrl, isListing = false} = {}) {
  if (!config || (isListing && !config.pageFallback)) return [];
  const headingMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html || ""));
  const heading = headingMatch ? htmlText(headingMatch[1]) :
    firstHtmlMatch(html, /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
    firstHtmlMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) ||
    "";
  if (!heading || /^(agenda|calendrier|geek days)$/i.test(heading.trim()) && !config.pageFallback) return [];
  // Sur certaines pages, le JSON-LD embarqué dans le gabarit reprend la date
  // de la première carte du calendrier. Le premier bloc visible après le h1
  // est la donnée événementielle affichée à l'utilisateur et corrige ce cas.
  const afterHeading = headingMatch
    ? htmlText(String(html || "").slice(headingMatch.index + headingMatch[0].length,
      headingMatch.index + headingMatch[0].length + 5000))
    : htmlText(html);
  const dates = firstVisibleDate(afterHeading) || frenchDate(htmlText(html));
  if (!dates) return [];
  const ticket = htmlLink(html, pageUrl);
  return [{
    "@type": "Event", name: heading, startDate: dates.startDate,
    ...(dates.endDate ? {endDate: dates.endDate} : {}), url: pageUrl,
    location: {name: config.venue, address: {addressLocality: config.city},
      geo: {latitude: config.latitude, longitude: config.longitude}},
    ...(ticket ? {offers: {url: ticket.href}} : {}),
  }];
}

export function extractJsonLd(html) {
  const values = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    try { values.push(JSON.parse(match[1].trim())); } catch { /* page partial */ }
  }
  return values;
}

export function jsonLdEvents(value) {
  const result = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const type = list(node["@type"]).map((item) => text(item).toLowerCase());
    if (type.some((item) => item === "event" || item.endsWith("event") || item === "festival") ||
        (node.name && (node.startDate || node.eventSchedule))) result.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  visit(value);
  return result;
}

export function discoverLinks(html, pageUrl, pattern, limit = 120, textPattern = null) {
  const links = new Set();
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(anchorPattern)) {
    const url = absoluteUrl(match[1], pageUrl);
    if (!url || new URL(url).hostname !== new URL(pageUrl).hostname) continue;
    const pathMatches = !pattern || pattern.test(new URL(url).pathname);
    const textMatches = !textPattern || textPattern.test(htmlText(match[2]));
    if (!pathMatches && !textMatches) continue;
    links.add(url);
    if (links.size >= limit) break;
  }
  return [...links];
}

function dateValue(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(parsed) ? {iso: new Date(parsed).toISOString(), confidence: "day"} : null;
  }
  if (!/Z|[+-]\d{2}:?\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? {iso: new Date(parsed).toISOString(), confidence: "exact"} : null;
}

function locationOf(raw, config) {
  const location = list(raw.location).find((item) => item && typeof item === "object") || {};
  const address = location.address && typeof location.address === "object" ? location.address : {};
  const geo = location.geo && typeof location.geo === "object" ? location.geo : {};
  const lat = Number(geo.latitude ?? location.latitude ?? config.latitude);
  const lng = Number(geo.longitude ?? location.longitude ?? config.longitude);
  return {
    name: text(location.name) || config.venue,
    address: [text(address.streetAddress), text(address.postalCode), text(address.addressLocality)]
      .filter(Boolean).join(", ") || null,
    city: text(address.addressLocality) || config.city,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function eventId(raw, pageUrl, config) {
  return text(raw.identifier ?? raw["@id"] ?? raw.url) || `${config.id}:${pageUrl}:${text(raw.name)}`;
}

export function normalizeDirectEvent(raw, {config, pageUrl}) {
  if (!raw || typeof raw !== "object" || !config) return null;
  const title = text(raw.name ?? raw.headline);
  const start = dateValue(raw.startDate ?? raw.start_at);
  if (!title || !start) return null;
  const eventUrl = absoluteUrl(raw.url, pageUrl) || pageUrl;
  if (config.eventPathPattern) {
    try {
      if (!config.eventPathPattern.test(new URL(eventUrl).pathname)) return null;
    } catch {
      return null;
    }
  }
  // Une page d'agenda peut contenir un JSON-LD de navigation ou de gabarit
  // sans URL d'événement réelle. Sans cette URL distincte, il ne s'agit pas
  // d'un événement exploitable et il ne faut pas l'injecter dans la base.
  if (isListingPage(pageUrl)) {
    if (!eventUrl || isListingPage(eventUrl) || eventUrl === pageUrl) return null;
  }
  const end = dateValue(raw.endDate ?? raw.end_at);
  const location = locationOf(raw, config);
  if (location.lat == null || location.lng == null) return null;
  const performer = list(raw.performer ?? raw.performers).map((item) => text(item?.name ?? item)).filter(Boolean);
  const organizer = text(raw.organizer?.name ?? raw.organizer);
  const sourceUrl = absoluteUrl(raw.url, pageUrl) || pageUrl;
  const rawEvent = {
    ...raw,
    announcement_tags: [...(config.defaultTags || []), ...list(raw.genre), ...list(raw.keywords)],
    performers: performer,
    organizer: organizer || undefined,
  };
  const cancelled = /cancel/i.test(text(raw.eventStatus));
  return {
    source: config.source,
    source_name: config.name,
    external_id: eventId(raw, pageUrl, config),
    source_url: sourceUrl,
    raw_event: rawEvent,
    event: {
      title: title.slice(0, 200),
      description: text(raw.description) || null,
      category: config.category || null,
      start_at: start.iso,
      end_at: end?.iso || null,
      timezone: config.timezone || "Europe/Paris",
      date_confidence: end && end.confidence === "exact" && start.confidence === "exact" ? "exact" : start.confidence,
      place_name: location.name || null,
      address: location.address,
      city: location.city,
      insee_code: null,
      lat: location.lat,
      lng: location.lng,
      primary_source: config.source,
      source_url: sourceUrl,
      image_url: directImage(list(raw.image)[0] || raw.image, pageUrl),
      cancelled,
      last_source_update: null,
    },
  };
}
