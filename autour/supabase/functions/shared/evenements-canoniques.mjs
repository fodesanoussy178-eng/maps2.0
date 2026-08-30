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
  for (const key of ["name", "artistName", "stageName", "performerName", "label", "text", "value", "@value", "type", "@type"]) {
    if (value[key] != null) {
      const found = text(value[key]);
      if (found) return found;
    }
  }
  return "";
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

export function normaliserEvenementCanonique(record, {baseTags = []} = {}) {
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
  return {
    artist_names: artistNames,
    music_genres: musicGenres,
    event_kind: eventKind,
    announcement_tags: announcementTags,
  };
}

export {EVENT_KINDS, MUSIC_GENRES, ARTIST_PROFILES};
