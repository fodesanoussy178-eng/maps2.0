/* --------------------------------------------------------------------------
   Contrat canonique des manifestations.

   Cette couche est volontairement indépendante des fournisseurs. Les sources
   gardent la priorité : un type, un artiste ou un genre structuré est lu avant
   toute heuristique. Le petit référentiel d'alias ci-dessous ne remplace pas
   les métadonnées source : il sert seulement de filet pour des artistes connus
   annoncés dans un titre, et ne produit aucun genre pour un nom inconnu.
--------------------------------------------------------------------------- */

const EVENT_KINDS = Object.freeze([
  "concert", "showcase", "dj_set", "festival", "open_air", "fete",
  "fete_populaire", "fete_foraine", "carnaval", "kermesse", "guinguette",
  "bal", "feu_artifice", "braderie", "brocante", "vide_grenier",
  "marche_de_noel", "fete_de_la_musique", "fan_zone",
]);

const EVENT_KIND_ALIASES = Object.freeze({
  concert: "concert", concerts: "concert", live: "concert", gig: "concert",
  showcase: "showcase", "show case": "showcase",
  "dj set": "dj_set", djset: "dj_set", mix: "dj_set",
  festival: "festival", "open air": "open_air", openair: "open_air",
  fete: "fete", "fete populaire": "fete_populaire", "fete de quartier": "fete_populaire",
  "fete foraine": "fete_foraine", carnaval: "carnaval", kermesse: "kermesse",
  guinguette: "guinguette", bal: "bal", "feu d artifice": "feu_artifice",
  "feu d artifices": "feu_artifice", feuartifice: "feu_artifice",
  braderie: "braderie", brocante: "brocante", "vide grenier": "vide_grenier",
  "vide greniers": "vide_grenier", "marche de noel": "marche_de_noel",
  "fete de la musique": "fete_de_la_musique", "fan zone": "fan_zone", fanzone: "fan_zone",
});

const GENRE_ALIASES = Object.freeze({
  rap: "rap", "french rap": "rap", "rap francais": "rap", hiphop: "hip_hop",
  "hip hop": "hip_hop", trap: "trap", drill: "drill", "r&b": "rnb", rnb: "rnb",
  "r and b": "rnb", afro: "afro", afrobeat: "afro", afropop: "afro",
  pop: "pop", rock: "rock", electro: "electro", electronique: "electro",
  electronic: "electro", techno: "electro", house: "electro", trance: "electro",
  jazz: "jazz", reggae: "reggae", ragga: "reggae", dancehall: "reggae",
  kpop: "kpop", "k pop": "kpop", classique: "classical", classical: "classical",
  opera: "classical", soul: "soul", funk: "funk", metal: "metal",
});

/* Référentiel compact : il documente des alias publics et des genres de
   secours. Les connecteurs restent libres d'apporter plusieurs genres. */
const ARTIST_PROFILES = Object.freeze([
  {name: "Ninho", aliases: ["ninho"], genres: ["rap"]},
  {name: "Gazo", aliases: ["gazo"], genres: ["rap", "drill"]},
  {name: "Jul", aliases: ["jul"], genres: ["rap"]},
  {name: "SCH", aliases: ["sch"], genres: ["rap"]},
  {name: "Orelsan", aliases: ["orelsan"], genres: ["rap"]},
  {name: "Tiakola", aliases: ["tiakola"], genres: ["rap", "rnb"]},
  {name: "Dadju", aliases: ["dadju"], genres: ["rnb", "pop"]},
  {name: "Aya Nakamura", aliases: ["aya nakamura", "aya"], genres: ["rnb", "pop", "afro"]},
  {name: "Hamza", aliases: ["hamza"], genres: ["rap", "rnb"]},
  {name: "Stromae", aliases: ["stromae"], genres: ["pop", "electro"]},
  {name: "Angèle", aliases: ["angele"], genres: ["pop"]},
  {name: "Kendrick Lamar", aliases: ["kendrick lamar"], genres: ["rap"]},
  {name: "Taylor Swift", aliases: ["taylor swift"], genres: ["pop"]},
  {name: "The Weeknd", aliases: ["the weeknd", "abel tesfaye"], genres: ["rnb", "pop"]},
  {name: "Beyoncé", aliases: ["beyonce", "queen bey"], genres: ["rnb", "pop"]},
  {name: "Bad Bunny", aliases: ["bad bunny"], genres: ["rap", "pop"]},
]);

const MUSIC_GENRES = Object.freeze([...new Set(Object.values(GENRE_ALIASES))]);

function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9&]+/g, " ").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return normalizeText(value).replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function list(value) {
  return Array.isArray(value) ? value : (value == null ? [] : [value]);
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
  if (typeof value !== "object") return "";
  for (const key of ["fr", "name", "artistName", "stageName", "performerName", "label", "text", "value", "@value", "type", "@type"]) {
    if (value[key] != null) {
      const found = text(value[key]);
      if (found) return found;
    }
  }
  return "";
}

/* --------------------------------------------------------------------------
   Contrat de lecture commun à toutes les sources événementielles.

   Les synchroniseurs peuvent conserver leur forme fournisseur en amont, mais
   une fiche ne doit jamais dépendre de cette forme. Cette normalisation garde
   les champs absents à `null` : une absence n'est ni une gratuité, ni une
   journée entière, ni une absence de réservation.
--------------------------------------------------------------------------- */

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function nettoyerTexteEvenement(value) {
  let source = decodeEntities(text(value));
  if (!source) return "";
  source = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi, "$1 ($2)")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    /* Les liens utiles restent visibles, mais leur syntaxe Markdown disparaît. */
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1 ($2)")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)[*_~`]+/g, "$1")
    .replace(/[*_~`]+(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return source;
}

function firstValue(record, fields) {
  for (const field of fields) {
    const value = record?.[field];
    if (value != null && value !== "") return value;
  }
  return null;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value);
  if (["true", "yes", "oui", "gratuit", "free", "no fee"].includes(normalized)) return true;
  if (["false", "no", "non", "payant", "paid"].includes(normalized)) return false;
  return null;
}

function numberValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const match = String(value).replace(/\u202f/g, " ").match(/\d+(?:[,.]\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0].replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function currencyAmount(value) {
  const match = String(value ?? "").replace(/\u202f/g, " ")
    .match(/(\d+(?:[,.]\d{1,2})?)\s*(?:€|euros?|eur)(?=\b|\s|$)/i);
  return match ? numberValue(match[1]) : null;
}

function dateConfidence(record, startAt, endAt) {
  const explicit = firstValue(record, ["date_confidence", "dateConfidence", "date_precision", "datePrecision"]);
  if (explicit != null) return String(explicit);
  const hasTime = (value) => typeof value === "number" || value instanceof Date ||
    /(?:T|\s)\d{1,2}:\d{2}/.test(String(value || ""));
  return hasTime(startAt) || hasTime(endAt) ? "exact" : startAt ? "day" : "unknown";
}

function sentenceWith(source, expression) {
  const value = nettoyerTexteEvenement(source);
  if (!value) return "";
  const match = value.match(new RegExp("[^.!?\\n]*" + expression.source + "[^.!?\\n]*[.!?]?", expression.flags.replace("g", "i")));
  return match ? match[0].trim() : "";
}

function structuredOffer(record) {
  const values = [record?.offers, record?.offer, record?.pricing, record?.tariff, record?.tarif];
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .find((value) => value && typeof value === "object") || null;
}

function priceData(record, description) {
  const offer = structuredOffer(record);
  const structuredAmount = numberValue(firstValue(offer || {}, ["price_amount", "priceAmount", "price", "amount", "value"])) ??
    numberValue(firstValue(record, ["price_amount", "priceAmount", "amount"]));
  const structuredText = nettoyerTexteEvenement(firstValue(offer || {}, ["description", "label", "name", "text"])) ||
    nettoyerTexteEvenement(firstValue(record, ["price_text", "priceText", "tariff_text", "tarif_text"]));
  const structuredFree = booleanValue(firstValue(offer || {}, ["is_free", "isFree", "free", "gratuit"])) ??
    booleanValue(firstValue(record, ["is_free", "isFree", "free", "gratuit"]));

  const textCandidate = structuredText || description;
  const paidAmount = currencyAmount(textCandidate) ?? (structuredText ? numberValue(textCandidate) : null);
  const freeInText = /\b(?:gratuit(?:e|s)?|entrée\s+libre|ac(?:c|ç)ès\s+libre)\b/i.test(textCandidate);
  if (structuredAmount != null || (structuredText && paidAmount != null && /(?:€|euros?|eur)(?=\b|\s|$)/i.test(structuredText))) {
    const amount = structuredAmount ?? paidAmount;
    const label = structuredText || sentenceWith(description, /\d+(?:[,.]\d{1,2})?\s*(?:€|euros?|eur)(?=\b|\s|$)/i) || `${amount} €`;
    return {price_amount: amount, price_text: label, is_free: false, price_confidence: "high"};
  }
  if (structuredFree === true || (structuredFree == null && freeInText)) {
    return {price_amount: 0, price_text: "Entrée libre", is_free: true, price_confidence: structuredFree === true ? "high" : "medium"};
  }
  if (structuredFree === false) {
    return {price_amount: null, price_text: null, is_free: false, price_confidence: "unknown"};
  }
  if (paidAmount != null && /(?:€|euros?|eur)(?=\b|\s|$)/i.test(textCandidate)) {
    return {
      price_amount: paidAmount,
      price_text: sentenceWith(description, /\d+(?:[,.]\d{1,2})?\s*(?:€|euros?|eur)(?=\b|\s|$)/i) || `${paidAmount} €`,
      is_free: false,
      price_confidence: "medium",
    };
  }
  return {price_amount: null, price_text: null, is_free: null, price_confidence: "unknown"};
}

function audienceData(record, description) {
  const structured = nettoyerTexteEvenement(firstValue(record, ["audience", "public", "audience_text", "audienceText"]));
  const minAge = numberValue(firstValue(record, ["min_age", "minAge", "age_min", "ageMin", "minimum_age"]));
  const ageFromText = description.match(/(?:dès|des|à partir de|a partir de)\s*(\d+)\s*ans?/i);
  const age = minAge ?? (ageFromText ? Number(ageFromText[1]) : null);
  if (structured) return {audience: structured, min_age: age};
  if (/\benfants?\b|\bfamilles?\b|\bfamilial(?:e|es)?\b/i.test(description))
    return {audience: "Enfants et familles", min_age: age};
  return {audience: null, min_age: age};
}

function reservationData(record, description) {
  const structured = booleanValue(firstValue(record, ["reservation_required", "reservationRequired", "booking_required", "bookingRequired"]));
  const structuredText = nettoyerTexteEvenement(firstValue(record, ["reservation_text", "reservationText", "booking_text", "bookingText"]));
  const textValue = structuredText || sentenceWith(description, /réservation|reservation|inscription|billetterie/i);
  if (structured != null) return {reservation_required: structured, reservation_text: textValue || null};
  if (/\bsans\s+(?:réservation|reservation|inscription)\b/i.test(description))
    return {reservation_required: false, reservation_text: textValue || null};
  if (/(?:réservation|reservation|inscription)\s+(?:obligatoire|requise|nécessaire|necessaire)/i.test(description))
    return {reservation_required: true, reservation_text: textValue || null};
  return {reservation_required: null, reservation_text: textValue || null};
}

const WEEKDAYS = Object.freeze({
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
});

function instantLocal(day, hour, minute, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return null;
  let instant = Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(instant)) return null;
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const parts = {};
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone || "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date(instant)).forEach((part) => { parts[part.type] = part.value; });
      const seen = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute));
      const wanted = Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
      const corrected = wanted - (seen - instant);
      if (corrected === instant) break;
      instant = corrected;
    }
    return new Date(instant).toISOString();
  } catch {
    return null;
  }
}

/* Une phrase récurrente ne peut compléter qu'une date d'occurrence déjà
   fournie par la source. On ne crée ni jour, ni durée : on vérifie seulement
   que le jour nommé correspond à cette occurrence, puis on pose les deux
   heures explicites dans le fuseau de l'événement. */
function horaireRecurrent(description, startAt, timezone) {
  const dayMatch = String(startAt || "").match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!dayMatch) return null;
  const source = nettoyerTexteEvenement(description).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const weekdayMatch = source.match(/\b(?:chaque|tous les|toutes les)\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?\b/);
  const hoursMatch = source.match(/\b(?:de\s*)?(\d{1,2})h(?:([0-5]\d))?\s*(?:a|à|[-–])\s*(\d{1,2})h(?:([0-5]\d))?\b/);
  if (!weekdayMatch || !hoursMatch) return null;
  const [year, month, day] = dayMatch[1].split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (WEEKDAYS[weekdayMatch[1]] !== weekday) return null;
  const startHour = Number(hoursMatch[1]), startMinute = Number(hoursMatch[2] || 0);
  const endHour = Number(hoursMatch[3]), endMinute = Number(hoursMatch[4] || 0);
  if (startHour > 23 || endHour > 23) return null;
  const date = dayMatch[1];
  const start = instantLocal(date, startHour, startMinute, timezone);
  const end = instantLocal(date, endHour, endMinute, timezone);
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return null;
  return {start_at: start, end_at: end};
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function profileFor(value) {
  const normalized = normalizeText(value);
  return ARTIST_PROFILES.find((profile) => profile.aliases.some((alias) => normalizeText(alias) === normalized)) || null;
}

function artistNamesFromStructured(record) {
  const fields = ["artist_names", "artistNames", "performers", "performer", "artists", "artist", "lineup"];
  const values = [];
  for (const field of fields) {
    for (const item of list(record?.[field])) {
      const value = text(item);
      if (value) values.push(value);
    }
    if (values.length) break;
  }
  return unique(values);
}

function matchesAlias(source, alias) {
  const value = normalizeText(source);
  const needle = normalizeText(alias);
  if (!value || !needle) return false;
  return new RegExp(`(?:^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= |$)`, "i").test(value);
}

function artistNamesFromTitle(record, {eventKind = null, genres = []} = {}) {
  const title = [record?.title, record?.name, record?.headline].map(text).find(Boolean) || "";
  if (!title) return [];
  const musicalContext = eventKind === "concert" || eventKind === "showcase" || eventKind === "dj_set" ||
    eventKind === "festival" || eventKind === "open_air" || genres.length ||
    /\b(?:concert|showcase|festival|live|tournee|tour|dj)\b/i.test(normalizeText(title));
  if (!musicalContext) return [];
  return ARTIST_PROFILES.filter((profile) => profile.aliases.some((alias) => matchesAlias(title, alias)))
    .map((profile) => profile.name);
}

function genreValuesFromStructured(record) {
  const fields = ["music_genres", "musicGenres", "artistGenres", "artist_genres", "performerGenres",
    "performer_genres", "musicGenre", "music_genre", "genre", "genres", "performers", "performer", "artists", "artist"];
  const values = [];
  for (const field of fields) values.push(...list(record?.[field]).flatMap((item) => {
    if (item && typeof item === "object") return list(item.genre ?? item.genres ?? item.musicGenre ?? item.name ?? item.label ?? item.value).flatMap((value) => list(value).map(text));
    return [text(item)];
  }));
  return unique(values.map((value) => GENRE_ALIASES[normalizeText(value)] || null));
}

function eventKindFromValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const exact = EVENT_KIND_ALIASES[normalized];
  if (exact) return exact;
  const ordered = Object.entries(EVENT_KIND_ALIASES).sort((a, b) => b[0].length - a[0].length);
  const found = ordered.find(([alias]) => matchesAlias(normalized, alias));
  return found ? found[1] : null;
}

function eventKindFromStructured(record) {
  for (const field of ["event_kind", "eventKind", "eventType", "event_type", "format", "subtype", "type", "@type", "category"]) {
    for (const value of list(record?.[field])) {
      const kind = eventKindFromValue(text(value));
      if (kind) return kind;
    }
  }
  return null;
}

function eventKindFromText(record) {
  const source = [record?.title, record?.name, record?.headline, record?.description]
    .map(text).filter(Boolean).join(" ");
  const ordered = Object.entries(EVENT_KIND_ALIASES).sort((a, b) => b[0].length - a[0].length);
  const found = ordered.find(([alias]) => matchesAlias(source, alias));
  return found ? found[1] : null;
}

export function normaliserArtistes(record, {eventKind = null, musicGenres = []} = {}) {
  const structured = artistNamesFromStructured(record);
  const names = structured.length ? structured : artistNamesFromTitle(record, {eventKind, genres: musicGenres});
  const canonical = names.map((value) => profileFor(value)?.name || value.trim())
    .filter(Boolean);
  return unique(canonical);
}

export function normaliserTypeEvenement(record) {
  return eventKindFromStructured(record) || eventKindFromText(record);
}

export function normaliserGenresMusicaux(record, artistNames = [], {structuredOnly = false} = {}) {
  const explicit = genreValuesFromStructured(record);
  if (explicit.length || structuredOnly) return explicit;
  const fromArtists = artistNames.flatMap((name) => profileFor(name)?.genres || []);
  return unique(fromArtists);
}

export function normaliserEvenementCanonique(record, {
  baseTags = [], source = null, sourceUrl = null, placeSource = null,
} = {}) {
  const input = record && typeof record === "object" ? record : {};
  const eventKind = normaliserTypeEvenement(input);
  const genresFromSource = genreValuesFromStructured(input);
  const artistNames = normaliserArtistes(input, {eventKind, musicGenres: genresFromSource});
  const musicGenres = normaliserGenresMusicaux(input, artistNames);
  const announcementTags = unique([
    ...list(baseTags).map(slug),
    ...(eventKind ? [eventKind] : []),
    ...musicGenres,
    ...artistNames.map((name) => `artist_${slug(name)}`),
  ]);
  const title = nettoyerTexteEvenement(firstValue(input, ["title", "name", "headline"]));
  const description = nettoyerTexteEvenement(firstValue(input, [
    "description", "description_long", "descriptionLong", "longDescription", "description_short", "descriptionShort",
  ]));
  let startAt = firstValue(input, ["start_at", "startAt", "event_start_at", "eventStartAt"]);
  let endAt = firstValue(input, ["end_at", "endAt", "event_end_at", "eventEndAt"]);
  const timezone = text(firstValue(input, ["timezone", "timeZone"])) || "Europe/Paris";
  const recurrent = !endAt ? horaireRecurrent(description, startAt, timezone) : null;
  if (recurrent) {
    startAt = recurrent.start_at;
    endAt = recurrent.end_at;
  }
  const price = priceData(input, description);
  const audience = audienceData(input, description);
  const reservation = reservationData(input, description);
  const eventSource = text(firstValue(input, ["event_source", "eventSource", "primary_source", "primarySource", "source"])) || source;
  const eventSourceUrl = text(firstValue(input, ["event_source_url", "eventSourceUrl", "source_url", "sourceUrl", "url"])) || sourceUrl;
  const venueName = nettoyerTexteEvenement(firstValue(input, ["venue_name", "venueName", "place_name", "placeName", "location_name", "locationName"]));
  const organizerName = nettoyerTexteEvenement(firstValue(input, ["organizer_name", "organizerName", "organizer", "organisateur"]));
  return {
    title: title || null,
    event_kind: eventKind,
    start_at: startAt || null,
    end_at: endAt || null,
    timezone,
    temporal_status: text(firstValue(input, ["temporal_status", "temporalStatus"])) || null,
    date_confidence: dateConfidence(input, startAt, endAt),
    ...price,
    ...audience,
    ...reservation,
    venue_name: venueName || null,
    organizer_name: organizerName || null,
    description: description || null,
    event_source: eventSource || null,
    event_source_url: eventSourceUrl || null,
    place_source: text(firstValue(input, ["place_source", "placeSource", "venue_source", "venueSource"])) || placeSource || null,
    image_source: text(firstValue(input, ["image_source", "imageSource"])) || null,
    image_source_url: text(firstValue(input, ["image_source_url", "imageSourceUrl"])) || null,
    artist_names: artistNames,
    music_genres: musicGenres,
    announcement_tags: announcementTags,
  };
}

const EVENT_FACT_FIELDS = Object.freeze([
  "title", "description", "venue_name", "organizer_name", "start_at", "end_at", "timezone",
  "date_confidence", "temporal_status", "price_amount", "price_text", "is_free",
  "audience", "min_age", "reservation_required", "reservation_text", "event_source",
  "event_source_url", "place_source", "image_source", "image_source_url",
]);

/* Une source pauvre ne doit pas effacer un fait déjà fiable lors d'un
   rapprochement inter-sources. Pour le tarif, un champ structuré (`high`)
   garde priorité sur une phrase (`medium`) arrivée ensuite. */
export function fusionnerEvenementFaits(existing, incoming) {
  const before = existing && typeof existing === "object" ? existing : {};
  const after = incoming && typeof incoming === "object" ? incoming : {};
  const merged = {...after};
  for (const field of EVENT_FACT_FIELDS) {
    if (after[field] == null || after[field] === "") {
      if (before[field] != null && before[field] !== "") merged[field] = before[field];
    }
  }
  const existingPrice = before.price_confidence && before.price_confidence !== "unknown";
  const incomingPrice = after.price_confidence && after.price_confidence !== "unknown";
  if (existingPrice && !incomingPrice) {
    for (const field of ["price_amount", "price_text", "is_free", "price_confidence"])
      if (before[field] != null) merged[field] = before[field];
  } else if (before.price_confidence === "high" && after.price_confidence === "medium") {
    for (const field of ["price_amount", "price_text", "is_free", "price_confidence"])
      if (before[field] != null) merged[field] = before[field];
  }
  return merged;
}

export {EVENT_KINDS, MUSIC_GENRES, ARTIST_PROFILES};
