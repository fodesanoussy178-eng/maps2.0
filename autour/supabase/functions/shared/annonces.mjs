import {enrichirTagsAnnonce, fusionnerPreuvesTags} from "./announcement-tags.mjs";
import {normaliserEvenementCanonique} from "./evenements-canoniques.mjs";

/* Contrat serveur des annonces. Ce module ne scrappe rien : il ne fait que
   lire des champs structurés fournis par un connecteur autorisé et conserver
   la justification de chaque date canonique. */

const SOURCES = Object.freeze({
  artist_official: 100, venue_official: 95, organizer_official: 95,
  institutional: 90, ticketing_authorized: 88, openagenda: 80,
  datatourisme: 75, verified_agenda: 70,
});

function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
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

function textValues(value, depth = 0) {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const found = String(value).trim();
    return found ? [found] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => textValues(item, depth + 1));
  if (typeof value !== "object") return [];
  const preferred = ["fr", "@value", "value", "label", "name", "text", "content"];
  const keys = [...preferred, ...Object.keys(value).filter((key) => !preferred.includes(key))];
  return keys.flatMap((key) => textValues(value[key], depth + 1));
}

function date(value) {
  const valueText = text(value);
  if (!valueText) return null;
  /* Une date d'annonce est un instant mondial : sans Z ou décalage explicite,
     elle ne permet pas de savoir quand l'annonce est réellement apparue. */
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(valueText)) return null;
  const parsed = new Date(valueText);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function list(value) {
  return Array.isArray(value) ? value : (value == null ? [] : [value]);
}

const ALLOWED_TAGS = new Set([
  "music", "rap", "hip_hop", "french_rap", "trap", "drill", "rap_concert", "rnb", "afro",
  "pop", "rock", "electro", "jazz", "reggae", "kpop", "classical", "dj_set", "showcase",
  "concert", "live", "live_music", "gig", "performance_music", "music_festival",
  "culture", "cinema", "film", "screening", "projection", "avant_premiere", "premiere",
  "festival_cinema", "film_festival", "rencontre_realisateur", "rencontre_equipe_film", "cine_debat",
  "exhibition", "exposition", "vernissage", "gallery", "art_exhibition", "photography_exhibition",
  "museum_exhibition", "retrospective", "theatre", "theater", "play", "stage_play", "dramatic_art",
  "theatre_premiere", "theatre_festival", "dance", "standup", "artist_meeting", "festival",
  "cultural_festival", "manga_anime_gaming", "manga", "anime", "japanimation", "cosplay",
  "convention_manga", "convention_anime", "mangaka", "anime_screening", "signing_manga", "convention",
  "gaming", "tournament", "signing", "popup", "manga_festival", "sport", "football", "soccer",
  "football_match", "ligue1", "coupe", "losc", "futsal", "basketball", "tennis", "combat_sport",
  "combat_sports", "running", "cycling", "athletics", "match", "competition", "fashion_lifestyle",
  "fashion", "mode", "fashion_show", "runway", "sneakers", "streetwear", "designer", "fashion_popup",
  "clothing_drop", "popup_store", "drop", "creators_market", "food", "gastronomy", "restaurant_event",
  "street_food", "food_festival", "tasting", "culinary", "food_market", "brunch_event", "chef_event",
  "nightlife", "club", "nightclub", "party", "night_event", "afterparty", "rave", "dance_party",
  "family", "kids", "children", "family_event", "young_audience", "workshop_children", "family_show",
  "parenting_event", "local", "braderie", "neighbourhood_party", "market", "street_festival",
  "association_event", "local_festival", "automobile", "open_air", "fete", "fete_populaire",
  "fete_foraine", "carnaval", "kermesse", "guinguette", "bal", "feu_artifice", "brocante",
  "vide_grenier", "marche_de_noel", "fete_de_la_musique", "fan_zone",
]);

const SOURCE_ALIASES = Object.freeze({
  "hip hop": "hip_hop", "hip-hop": "hip_hop", "r&b": "rnb", "r b": "rnb", "k-pop": "kpop",
  "dj set": "dj_set", "stand up": "standup", "street festival": "street_festival",
  "neighborhood party": "neighbourhood_party", "popup store": "popup_store",
  "pop up": "popup", "pop-up": "popup", "creative market": "creators_market",
  "combat sport": "combat_sport", "live music": "live_music", "performance music": "performance_music",
  "french rap": "french_rap", "rap concert": "rap_concert", "avant premiere": "avant_premiere",
  "film festival": "film_festival", "festival cinema": "festival_cinema",
  "rencontre realisateur": "rencontre_realisateur", "rencontre equipe film": "rencontre_equipe_film",
  "cine debat": "cine_debat", "art exhibition": "art_exhibition", "photography exhibition": "photography_exhibition",
  "museum exhibition": "museum_exhibition", "convention manga": "convention_manga", "convention anime": "convention_anime",
  "anime screening": "anime_screening", "signing manga": "signing_manga", "fashion show": "fashion_show",
  "fashion popup": "fashion_popup", "clothing drop": "clothing_drop", "food festival": "food_festival",
  "street food": "street_food", "food market": "food_market", "brunch event": "brunch_event",
  "chef event": "chef_event", "night club": "nightclub", "night event": "night_event", "after party": "afterparty",
  "dance party": "dance_party", "family event": "family_event", "young audience": "young_audience",
  "workshop children": "workshop_children", "family show": "family_show", "parenting event": "parenting_event",
  "stage play": "stage_play", "dramatic art": "dramatic_art", "theatre premiere": "theatre_premiere",
  "theatre festival": "theatre_festival", "local festival": "local_festival", "manga festival": "manga_festival",
});

function directTag(raw, source) {
  const normalizedText = String(raw ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const alias = SOURCE_ALIASES[normalizedText] || normalizedText;
  const normalized = alias.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (ALLOWED_TAGS.has(normalized) || /^artist_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(normalized)) return [normalized];

  /* Les connecteurs ne donnent pas tous la taxonomie canonique. Ces ponts ne
     lisent que des champs catégoriels fournis par la source, jamais le titre
     ou la description : un musée ne devient donc pas une expo parce qu'il
     contient le mot « maison », et un restaurant ne devient pas une aide. */
  const value = normalizedText;
  const mapped = [];
  if (source === "openagenda") {
    if (/\brap\b/.test(value)) mapped.push("music", "rap");
    if (/hip[ -]?hop/.test(value)) mapped.push("music", "hip_hop");
    if (/r&b|rnb/.test(value)) mapped.push("music", "rnb");
    if (/concert|musique|live|showcase/.test(value)) mapped.push("music", "concert");
    if (/cin[eé]ma|projection|film/.test(value)) mapped.push("culture", "cinema");
    if (/exposition|expo|mus[ée]e|vernissage/.test(value)) mapped.push("culture", "exhibition");
    if (/th[ée][aâ]tre|danse|cirque|spectacle/.test(value)) mapped.push("culture", "theatre");
    if (/manga|anime|geek|cosplay/.test(value)) mapped.push("manga_anime_gaming", "manga", "anime");
    if (/convention/.test(value)) mapped.push("convention");
    if (/convention/.test(value)) mapped.push("convention");
    if (/football|basket|tennis|sport|course|tournoi|match/.test(value)) mapped.push("sport", "match");
    if (/festival/.test(value)) mapped.push("culture", "local", "festival");
    if (/braderie|march[ée]|marché|brocante/.test(value)) mapped.push("local", "market");
    if (/quartier|associatif|association|famille/.test(value)) mapped.push("local", "association_event");
  }
  if (source === "datatourisme") {
    if (/concert|musique/.test(value)) mapped.push("music", "concert");
    if (/cin[eé]ma|projection|film/.test(value)) mapped.push("culture", "cinema");
    if (/exposition|expo|mus[ée]e|galerie|vernissage/.test(value)) mapped.push("culture", "exhibition");
    if (/spectacle|th[ée][aâ]tre|danse|cirque|op[ée]ra/.test(value)) mapped.push("culture");
    if (/sport|match|tournoi|course|randonn/.test(value)) mapped.push("sport", "match");
    if (/march[ée]|brocante|vide.?grenier|foire/.test(value)) mapped.push("local", "market");
    if (/festival/.test(value)) mapped.push("culture", "local", "festival");
  }
  return mapped.filter((tag) => ALLOWED_TAGS.has(tag));
}

export function normaliserTagsSource(value, source = "unknown") {
  const direct = textValues(value).flatMap((item) => directTag(item, source));
  const parents = {
    rap: "music", hip_hop: "music", rnb: "music", concert: "music", live: "music",
    exhibition: "culture", vernissage: "culture", cinema: "culture", theatre: "culture",
    dance: "culture", festival: "culture", manga: "manga_anime_gaming", anime: "manga_anime_gaming",
    cosplay: "manga_anime_gaming", gaming: "manga_anime_gaming",
    football: "sport", basketball: "sport", match: "sport", running: "sport", tournament: "sport",
  };
  return [...direct, ...direct.map((tag) => parents[tag]).filter(Boolean)]
    .filter((tag, index, all) => all.indexOf(tag) === index);
}

function tags(value, source = "unknown") {
  const aliases = {
    "hip hop": "hip_hop", "hip-hop": "hip_hop", "r&b": "rnb", "k-pop": "kpop",
    "dj set": "dj_set", "stand up": "standup", "street festival": "street_festival",
    "pop up": "popup", "pop-up": "popup", "popup store": "popup_store",
  };
  return textValues(value).flatMap((item) => {
    const raw = item.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim();
    const normalized = aliases[raw] || raw.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return ALLOWED_TAGS.has(normalized) || /^artist_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(normalized)
      ? [normalized] : directTag(item, source);
  }).filter((tag, index, all) => all.indexOf(tag) === index);
}

function explicitUrl(value) {
  const candidate = text(value);
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}

function explicitTicketUrl(record) {
  const direct = [
    record.ticket_url, record.ticketUrl, record.bookingUrl, record.reservationUrl,
    record.registrationUrl, record.billetterieUrl, record.ticketing?.url,
    record.offers?.url,
  ].map(explicitUrl).find(Boolean);
  if (direct) return direct;
  for (const entry of list(record.registration)) {
    if (!entry || typeof entry !== "object") continue;
    const kind = text(entry.type ?? entry.kind ?? entry.rel).toLowerCase();
    if (!/(link|url|ticket|billet|booking|reservation|inscription)/.test(kind)) continue;
    const found = explicitUrl(entry.value ?? entry.url ?? entry.href ?? entry.link);
    if (found) return found;
  }
  for (const entry of list(record.links)) {
    if (!entry || typeof entry !== "object") continue;
    const kind = text(entry.type ?? entry.kind ?? entry.rel ?? entry.label).toLowerCase();
    if (!/(ticket|billet|booking|reservation|inscription|register)/.test(kind)) continue;
    const found = explicitUrl(entry.value ?? entry.url ?? entry.href ?? entry.link);
    if (found) return found;
  }
  return null;
}

export function calculerImportance({source = "unknown", tags = [], ticketUrl = null,
  performers = [], organizer = null, importance = null} = {}) {
  const base = {
    artist_official: 58, venue_official: 58, organizer_official: 56,
    institutional: 45, ticketing_authorized: 42, openagenda: 23,
    datatourisme: 21, verified_agenda: 18,
  }[source] || 0;
  const explicit = Number(importance);
  const sourceSignal = Number.isFinite(explicit) ? Math.max(0, Math.min(25, explicit)) : 0;
  const score = Math.max(0, Math.min(100, Math.round(
    base + sourceSignal + Math.min(15, tags.length * 3) + (ticketUrl ? 10 : 0) +
    (performers.length ? 7 : 0) + (organizer ? 3 : 0))));
  return {
    importance_score: score,
    importance_level: score >= 85 ? "major" : score >= 55 ? "important" : "local",
  };
}

export function normaliserAnnonce(raw, {source = "unknown", externalId = null, sourceUrl = null} = {}) {
  const record = raw && typeof raw === "object" ? raw : {};
  const announcedAt = date(record.announced_at ?? record.announcedAt ?? record.datePublished ??
    record.publishedAt ?? record.publicationDate ?? record.releaseDate);
  const presaleAt = date(record.presale_at ?? record.presaleAt ?? record.presale?.startsAt ??
    record.offers?.presaleStartsAt);
  const ticketsOpenAt = date(record.tickets_open_at ?? record.ticketsOpenAt ??
    record.ticketing?.opensAt ?? record.offers?.availabilityStarts);
  const ticketUrl = explicitTicketUrl(record);
  const tagData = enrichirTagsAnnonce(record, {source});
  const canonical = normaliserEvenementCanonique(record, {baseTags: tagData.tags});
  const announcementTags = [...new Set(canonical.announcement_tags)];
  const canonicalEvidence = canonical.announcement_tags
    .filter((tag) => !tagData.tags.includes(tag))
    .map((tag) => ({
      tag, source, source_tier: "canonical_metadata",
      evidence: tag === canonical.event_kind ? String(record.event_kind || record.eventKind || record.type || record.category || "") :
        tag.startsWith("artist_") ? canonical.artist_names.join(" · ") : canonical.music_genres.join(" · "),
      confidence: .98, extracted_at: new Date().toISOString(),
    }))
    .filter((entry) => entry.evidence);
  const tagEvidence = [...tagData.evidence, ...canonicalEvidence];
  const performerValues = (canonical.artist_names.length ? canonical.artist_names : list(record.performers ?? record.performer ?? record.artists ?? record.artist))
    .map(text).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
  const organizer = text(record.organizer?.name ?? record.organizer ?? record.promoter?.name ??
    record.promoter) || null;
  const importance = calculerImportance({
    source, tags: announcementTags, ticketUrl, performers: performerValues, organizer,
    importance: record.importance_score ?? record.importanceScore,
  });
  const hasData = announcedAt || presaleAt || ticketsOpenAt || ticketUrl || announcementTags.length ||
    performerValues.length || organizer || canonical.event_kind || canonical.music_genres.length;
  if (!hasData) return {fields: {}, provenance: null};
  const provenance = {
    source, external_id: externalId == null ? null : String(externalId), source_url: sourceUrl,
    source_priority: SOURCES[source] || 0,
    announced_at: announcedAt,
    presale_at: presaleAt,
    tickets_open_at: ticketsOpenAt,
    ticket_url: ticketUrl,
    announcement_tags: tagEvidence,
  };
  const fields = {};
  const fieldProvenance = {};
  if (announcedAt) { fields.announced_at = announcedAt; fieldProvenance.announced_at = provenance; }
  if (presaleAt) { fields.presale_at = presaleAt; fieldProvenance.presale_at = provenance; }
  if (ticketsOpenAt) { fields.tickets_open_at = ticketsOpenAt; fieldProvenance.tickets_open_at = provenance; }
  if (ticketUrl) { fields.ticket_url = ticketUrl; fieldProvenance.ticket_url = provenance; }
  if (announcementTags.length) fields.announcement_tags = announcementTags;
  if (performerValues.length) fields.performers = performerValues;
  if (canonical.artist_names.length) fields.artist_names = canonical.artist_names;
  if (canonical.music_genres.length) fields.music_genres = canonical.music_genres;
  if (canonical.event_kind) fields.event_kind = canonical.event_kind;
  if (organizer) fields.organizer = organizer;
  if (hasData) Object.assign(fields, importance);
  if (Object.keys(fieldProvenance).length) fields.announcement_provenance = fieldProvenance;
  if (tagEvidence.length) {
    fields.announcement_provenance = {
      ...(fields.announcement_provenance || {}),
      announcement_tags: tagEvidence,
    };
  }
  return {fields, provenance, tagEvidence};
}

export function choisirAnnonceCanonique(records) {
  const listRecords = (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record === "object");
  const meilleur = (field, mode) => {
    const candidats = listRecords.filter((record) => record[field]);
    candidats.sort((a, b) => {
      const dateA = new Date(a[field]).getTime(), dateB = new Date(b[field]).getTime();
      if (dateA !== dateB) return mode === "first" ? dateA - dateB : dateB - dateA;
      return (SOURCES[b.source] || 0) - (SOURCES[a.source] || 0);
    });
    return candidats[0] || null;
  };
  const annonce = meilleur("announced_at", "first");
  const presale = meilleur("presale_at", "first");
  const tickets = meilleur("tickets_open_at", "first");
  const ticketUrl = listRecords.filter((record) => record.ticket_url)
    .sort((a, b) => (SOURCES[b.source] || 0) - (SOURCES[a.source] || 0))[0] || null;
  return {
    announced_at: annonce?.announced_at || null,
    presale_at: presale?.presale_at || null,
    tickets_open_at: tickets?.tickets_open_at || null,
    ticket_url: ticketUrl?.ticket_url || null,
    announcement_provenance: {
      announced_at: annonce || null,
      presale_at: presale || null,
      tickets_open_at: tickets || null,
      ticket_url: ticketUrl || null,
    },
  };
}

function recordsFromEvent(event) {
  const e = event || {};
  const provenance = e.announcement_provenance && typeof e.announcement_provenance === "object"
    ? e.announcement_provenance : {};
  const source = String(e.primary_source || e.source || "unknown");
  const base = {
    source, external_id: e.external_id || null, source_url: e.source_url || null,
    source_priority: SOURCES[source] || 0,
  };
  return ["announced_at", "presale_at", "tickets_open_at", "ticket_url"]
    .map((field) => {
      const record = provenance[field] && typeof provenance[field] === "object"
        ? provenance[field] : null;
      const value = e[field] || record?.[field];
      return value ? {...base, ...(record || {}), [field]: value} : null;
    }).filter(Boolean);
}

/* Fusion utilisée avant PATCH/INSERT pour qu'une source dépourvue d'une date
   ne puisse pas effacer la date canonique justifiée par une autre source. */
export function fusionnerAnnonceFields(existing, incoming) {
  const current = existing || {};
  const next = incoming || {};
  const records = [...recordsFromEvent(current), ...recordsFromEvent(next)];
  const chosen = choisirAnnonceCanonique(records);
  const merged = {};
  ["announced_at", "presale_at", "tickets_open_at", "ticket_url"].forEach((field) => {
    if (chosen[field]) merged[field] = chosen[field];
  });
  const tagEvidence = fusionnerPreuvesTags(
    current.announcement_provenance?.announcement_tags,
    next.announcement_provenance?.announcement_tags,
  );
  if (records.length || tagEvidence.length) {
    merged.announcement_provenance = {
      ...chosen.announcement_provenance,
      ...(tagEvidence.length ? {announcement_tags: tagEvidence} : {}),
    };
  }
  ["announcement_tags", "performers", "artist_names", "music_genres"].forEach((field) => {
    const values = [...(Array.isArray(current[field]) ? current[field] : []),
      ...(Array.isArray(next[field]) ? next[field] : [])];
    if (values.length) merged[field] = [...new Set(values)];
  });
  if (next.event_kind || current.event_kind) merged.event_kind = next.event_kind || current.event_kind;
  const importance = calculerImportance({
    source: String(next.primary_source || next.source || current.primary_source || current.source || "unknown"),
    tags: merged.announcement_tags || [], ticketUrl: merged.ticket_url || null,
    performers: merged.performers || [], organizer: next.organizer || current.organizer || null,
    importance: Math.max(Number(current.importance_score) || 0, Number(next.importance_score) || 0),
  });
  merged.importance_score = Math.max(Number(current.importance_score) || 0,
    Number(next.importance_score) || 0, importance.importance_score);
  merged.importance_level = ["local", "important", "major"][
    Math.max(["local", "important", "major"].indexOf(current.importance_level || "local"),
      ["local", "important", "major"].indexOf(next.importance_level || "local"),
      ["local", "important", "major"].indexOf(importance.importance_level))];
  if (!merged.organizer && current.organizer) merged.organizer = current.organizer;
  return merged;
}

export function annonceDedupKey(event) {
  const e = event || {};
  const normalize = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const performer = list(e.artist_names ?? e.performers ?? e.performer ?? e.artist).map(normalize).filter(Boolean).join(",");
  const title = normalize(e.title ?? e.name);
  const venue = normalize(e.venue_name ?? e.place_name ?? e.venue);
  const city = normalize(e.city);
  const start = date(e.event_start_at ?? e.start_at);
  if (!venue || !city || !start || (!performer && !title)) return null;
  return [performer || title, venue, city, start.slice(0, 13)].join("|");
}
