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
    .match(/(\d+(?:[,.]\d{1,2})?)\s*(?:€|euros?|eur)(?![A-Za-z0-9])/i);
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
  if (structuredAmount != null || (structuredText && paidAmount != null && /(?:€|euros?|eur)(?![A-Za-z0-9])/i.test(structuredText))) {
    const amount = structuredAmount ?? paidAmount;
    const label = structuredText || sentenceWith(description, /\d+(?:[,.]\d{1,2})?\s*(?:€|euros?|eur)(?![A-Za-z0-9])/i) || `${amount} €`;
    return {price_amount: amount, price_text: label, is_free: false, price_confidence: "high"};
  }
  if (structuredFree === true || (structuredFree == null && freeInText)) {
    return {price_amount: 0, price_text: "Entrée libre", is_free: true, price_confidence: structuredFree === true ? "high" : "medium"};
  }
  if (structuredFree === false) {
    return {price_amount: null, price_text: null, is_free: false, price_confidence: "unknown"};
  }
  if (paidAmount != null && /(?:€|euros?|eur)(?![A-Za-z0-9])/i.test(textCandidate)) {
    return {
      price_amount: paidAmount,
      price_text: sentenceWith(description, /\d+(?:[,.]\d{1,2})?\s*(?:€|euros?|eur)(?![A-Za-z0-9])/i) || `${paidAmount} €`,
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

/* --------------------------------------------------------------------------
   LE TITRE COMME NOM DE SCÈNE — ET TOUT CE QUI L'EN EMPÊCHE

   CE QUI MANQUAIT, MESURÉ LE 25/09/2026

   `artist_names` était lu par `core.js`, `entites-canoniques.js` et trois RPC
   — et écrit par personne. Sur 1 903 événements à venir : ZÉRO nom d'artiste.
   Deux causes, pas une :

     · les champs structurés existent dans le contrat (`performers`,
       `artists`, `lineup`) mais ni OpenAgenda ni DATAtourisme ne les servent ;
     · le repli par le titre était un ANNUAIRE FERMÉ de seize noms. « NES »,
       « Jazzy Bazz » et « Nono La Grinta » n'y étaient pas, et n'y seraient
       jamais : un annuaire de célébrités ne couvre pas la scène locale, qui
       est précisément ce qu'Autour montre.

   LA RÈGLE, ET POURQUOI ELLE REFUSE PLUS QU'ELLE N'ACCEPTE

   Un titre de concert EST le plus souvent le nom de l'affiche : « NES »,
   « Jazzy Bazz », « Nono La Grinta ». Mais « Marché du Vieux-Lille »,
   « Exposition Panorama 28 » et « Mentions légales » sont aussi des titres, et
   deux d'entre eux sont rangés en `concert` par leur collecteur. Accepter le
   titre sans le filtrer remplirait `artist_names` de noms d'événements — et
   `artist_names` sert ensuite à chercher une PHOTO DE PERSONNE.

   On exige donc, et dans cet ordre :

     1. un CONTEXTE MUSICAL venu de la SOURCE, jamais du titre seul : le type
        canonique, un genre structuré, ou un mot-clé musical publié par la
        source. Un titre qui contient « concert » ne prouve rien : la page
        « Politique de confidentialité » du Zénith est rangée en `concert`.
     2. le titre n'est PAS le lieu. Ni égal au nom de la salle ou du lieu, ni
        contenu dedans, ni le contenant : « La Condition Publique » n'est pas
        un artiste. C'est le refus que le lot demande explicitement — pas de
        nom d'artiste pour un lieu, une salle ou une catégorie.
     3. le titre ne NOMME PAS un événement. `NOMS_D_EVENEMENT` liste ce qui
        désigne une manifestation ou une page de site. Un seul de ces mots
        suffit à refuser : mieux vaut un artiste manquant qu'une exposition
        prise pour une personne.
     4. le titre n'est pas un GENRE seul (« rap », « jazz ») ni une date ni un
        numéro.
     5. la forme d'un nom de scène : de un à cinq mots, deux caractères au
        moins, et pas de ponctuation de titre d'œuvre (`:`, guillemets).
     6. la SOURCE elle-même en reparle : le titre normalisé apparaît dans sa
        description. C'est la confirmation textuelle que le lot exige — la
        source dit « NeS sublime sa passion du rap », donc « NES » est bien le
        sujet, pas l'intitulé d'une soirée.

   HOMONYMES. Ce producteur rend un NOM, jamais une identité. « NES » peut
   désigner le rappeur, une console de jeu ou un homonyme : c'est pourquoi
   l'extraction porte son RANG (`artist_name_source`) — `structured` quand la
   source l'a déclaré, `profile` quand un référentiel l'a reconnu, `title`
   quand c'est le titre qui parle. La résolution d'image ne peut pas confirmer
   une identité sur un rang `title` seul, et le placeholder reste.

   DÉTERMINISME. Aucune date, aucun hasard, aucun appel réseau : les mêmes
   champs rendent toujours la même liste, dans le même ordre, sans doublon.
-------------------------------------------------------------------------- */

/* Ce qui désigne une manifestation, un lieu ou une page — donc jamais une
   personne. Liste bornée à ce qui a été RENCONTRÉ en base, pas imaginée. */
const NOMS_D_EVENEMENT = Object.freeze([
  "concert", "concerts", "festival", "exposition", "expo", "visite", "visites",
  "atelier", "ateliers", "soiree", "bal", "spectacle", "projection", "conference",
  "rencontre", "rencontres", "marche", "braderie", "brocante", "vide grenier",
  "stage", "tournoi", "match", "seance", "cine", "cinema", "nuit", "nuits",
  "salon", "forum", "repas", "permanence", "saison", "cycle", "tremplin",
  "scene ouverte", "jam", "karaoke", "apero", "after", "reveillon", "carnaval",
  "kermesse", "guinguette", "feu d artifice", "fete", "journees", "journee",
  "parcours", "balade", "randonnee", "lecture", "dedicace", "vernissage",
  "portes ouvertes", "assemblee", "reunion", "formation", "initiation",
  "competition", "championnat", "trail", "course", "loto", "thé dansant",
  /* Et les pages de site qu'un collecteur a rangées parmi les concerts. */
  "mentions legales", "politique de confidentialite", "declaration",
  "a propos", "notre mission", "mecenat", "accessibilite", "contact",
  "billetterie", "programme", "programmation", "agenda", "newsletter",
  "recrutement", "partenaires", "location", "privatisation",
]);

/* Les séparateurs d'une affiche à plusieurs noms. « + », « & », « x »,
   « feat. », « avec », « / », « • », « · » : ce sont ceux qu'on lit sur les
   affiches, et ils sont tous non ambigus. La virgule aussi, mais seulement
   entre deux fragments qui passent chacun les refus. */
const SEPARATEURS_AFFICHE =
  /\s*(?:\+|&|·|•|\/|\bx\b|\bfeat\.?\b|\bft\.?\b|\bavec\b|\binvite\b|,)\s*/i;

function contexteMusicalSource(record, {eventKind = null, genres = []} = {}) {
  if (["concert", "showcase", "dj_set", "festival", "open_air", "fete_de_la_musique"]
    .includes(eventKind)) return true;
  if (list(genres).length) return true;
  /* Les mots-clés publiés PAR la source. `announcement_tags` déjà écrits, ou
     les `keywords` / `tags` bruts : ce sont des métadonnées, pas du texte
     libre, donc elles prouvent le contexte. */
  const mots = ["announcement_tags", "announcementTags", "keywords", "tags", "themes",
    "genre", "genres", "music_genres", "musicGenres"]
    .flatMap((champ) => list(record?.[champ]).map((valeur) =>
      normalizeText(valeur && typeof valeur === "object"
        ? (valeur.name ?? valeur.label ?? valeur.value ?? "") : valeur)));
  return mots.some((mot) => ["concert", "musique", "music", "rap", "jazz", "rock", "pop",
    "electro", "techno", "house", "rnb", "soul", "funk", "reggae", "metal", "punk",
    "blues", "chanson", "hip hop", "hiphop", "drill", "afro", "classique", "showcase",
    "dj set", "dj", "live"].includes(mot));
}

/* Un nom de scène est refusé DÈS QU'UN doute apparaît. La fonction rend la
   raison plutôt qu'un booléen : c'est ce qui rend le refus lisible en test. */
function refusNomDeScene(fragment, record) {
  const nom = text(fragment);
  const normalise = normalizeText(nom);
  if (!normalise || normalise.length < 2) return "trop court";
  if (/^[\d\s.\/-]+$/.test(normalise)) return "date ou numéro";
  if (/[:"«»]/.test(nom)) return "ponctuation de titre d’œuvre";
  const mots = normalise.split(" ").filter(Boolean);
  if (mots.length > 5) return "plus de cinq mots";
  if (MUSIC_GENRES.includes(normalise) || GENRE_ALIASES[normalise]) return "genre musical, pas un nom";
  if (NOMS_D_EVENEMENT.some((terme) => matchesAlias(normalise, terme)))
    return "le titre nomme un événement ou une page";

  /* LE LIEU N'EST PAS UN ARTISTE. On compare aux deux sens : « Le Splendid »
     ne doit pas devenir un artiste parce qu'il est aussi le titre, et
     « La Condition Publique - Roubaix » ne doit pas l'être non plus. */
  for (const champ of ["venue_name", "venueName", "place_name", "placeName",
    "location_name", "locationName", "organizer_name", "organizerName", "organizer",
    "category", "event_kind", "eventKind"]) {
    const autre = normalizeText(firstValue(record || {}, [champ]));
    if (!autre) continue;
    if (autre === normalise) return "le titre est le nom du lieu, de l’organisateur ou de la catégorie";
    if (normalise.length >= 4 && autre.includes(normalise)) return "le titre est contenu dans le nom du lieu";
    if (autre.length >= 4 && normalise.includes(autre)) return "le titre contient le nom du lieu";
  }
  return null;
}

/* La source reparle-t-elle de ce nom ? Le titre normalisé doit apparaître dans
   la description publiée par la source. C'est la confirmation TEXTUELLE
   exigée : sans elle, on accepterait « Aura Invalides » comme un artiste. */
function nomCorroboreParLaSource(fragment, record) {
  const normalise = normalizeText(fragment);
  if (!normalise) return false;
  const texteSource = normalizeText([
    firstValue(record || {}, ["description", "description_long", "descriptionLong",
      "longDescription", "description_short", "descriptionShort"]),
  ].filter(Boolean).join(" "));
  if (!texteSource) return false;
  return matchesAlias(texteSource, normalise);
}

function artistNamesFromTitle(record, {eventKind = null, genres = []} = {}) {
  const title = [record?.title, record?.name, record?.headline].map(text).find(Boolean) || "";
  if (!title) return [];
  if (!contexteMusicalSource(record, {eventKind, genres})) return [];

  /* Le référentiel d'abord : il canonise l'orthographe d'un nom connu et
     reste la lecture la plus précise. */
  const connus = ARTIST_PROFILES
    .filter((profile) => profile.aliases.some((alias) => matchesAlias(title, alias)))
    .map((profile) => profile.name);
  if (connus.length) return connus;

  /* Puis le titre lui-même, découpé sur les séparateurs d'affiche. Chaque
     fragment passe les mêmes refus : une affiche « A + Marché de Noël » ne
     garde que « A ». */
  const fragments = title.split(SEPARATEURS_AFFICHE).map(text).filter(Boolean);
  const retenus = fragments.filter((fragment) =>
    !refusNomDeScene(fragment, record) && nomCorroboreParLaSource(fragment, record));
  /* Un titre découpé qui ne garde qu'une partie de lui-même est suspect : si
     l'affiche portait deux noms et qu'un seul passe, on garde ce seul nom ;
     mais si le titre ENTIER a été refusé et qu'aucun fragment ne passe, on ne
     rend rien plutôt que d'inventer. */
  return unique(retenus.map((fragment) => profileFor(fragment)?.name || fragment.trim()));
}

/* Le RANG de l'extraction, pour que la suite sache ce qu'elle lit. Une image
   d'artiste ne peut pas être confirmée sur un rang `title` seul. */
export function rangExtractionArtiste(record, {eventKind = null, musicGenres = []} = {}) {
  if (artistNamesFromStructured(record).length) return "structured";
  const title = [record?.title, record?.name, record?.headline].map(text).find(Boolean) || "";
  /* Appelée seule, la fonction doit tenir debout seule : sans type fourni,
     elle le déduit comme le fait la normalisation complète. Sinon un appel
     direct rendrait « aucun contexte » là où l'import en trouve un. */
  const kind = eventKind || normaliserTypeEvenement(record);
  const genres = list(musicGenres).length ? musicGenres : genreValuesFromStructured(record);
  if (!title || !contexteMusicalSource(record, {eventKind: kind, genres})) return null;
  if (ARTIST_PROFILES.some((profile) => profile.aliases.some((alias) => matchesAlias(title, alias))))
    return "profile";
  return artistNamesFromTitle(record, {eventKind: kind, genres}).length ? "title" : null;
}

/* La raison d'un refus, pour le journal et pour les tests. Rendue seulement
   quand rien n'a été retenu : un refus muet se répète sans qu'on le voie. */
export function refusArtisteDepuisTitre(record, {eventKind = null, musicGenres = []} = {}) {
  const title = [record?.title, record?.name, record?.headline].map(text).find(Boolean) || "";
  if (!title) return "aucun titre";
  const kind = eventKind || normaliserTypeEvenement(record);
  const genres = list(musicGenres).length ? musicGenres : genreValuesFromStructured(record);
  if (!contexteMusicalSource(record, {eventKind: kind, genres}))
    return "aucun contexte musical dans les métadonnées de la source";
  const fragments = title.split(SEPARATEURS_AFFICHE).map(text).filter(Boolean);
  for (const fragment of fragments) {
    const refus = refusNomDeScene(fragment, record);
    if (refus) return refus;
    if (!nomCorroboreParLaSource(fragment, record))
      return "la description de la source ne reparle pas de ce nom";
  }
  return null;
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
    /* D'où vient ce nom : `structured` (la source l'a déclaré), `profile` (un
       référentiel l'a reconnu) ou `title` (c'est le titre qui parle). La
       résolution d'image lit ce rang avant de chercher un portrait. */
    artist_name_source: artistNames.length
      ? rangExtractionArtiste(input, {eventKind, musicGenres: genresFromSource}) : null,
    music_genres: musicGenres,
    announcement_tags: announcementTags,
  };
}

const EVENT_FACT_FIELDS = Object.freeze([
  "title", "description", "venue_name", "organizer_name", "start_at", "end_at", "timezone",
  "date_confidence", "temporal_status", "price_amount", "price_text", "is_free",
  "audience", "min_age", "reservation_required", "reservation_text", "event_source",
  "event_source_url", "place_source", "image_source", "image_source_url",
  /* Une coordonnée trouvée une fois ne doit pas disparaître à la
     synchronisation suivante : si l'organisateur retire le numéro de sa fiche
     OpenAgenda, la source dira `null` et l'ancien numéro serait effacé. Il est
     plus utile de le garder — et un numéro public reste vérifiable. */
  "booking_url", "phone", "email", "website",
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
