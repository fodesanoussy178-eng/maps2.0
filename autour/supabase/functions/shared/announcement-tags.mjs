/*
 * Cascade d'enrichissement des tags d'annonce.
 *
 * Cette couche ne devine pas un intérêt depuis un mot générique. Elle ne
 * produit un tag que lorsqu'un indice explicite est présent dans un champ
 * identifiable de la source. Chaque indice est conservé pour que le tag
 * affiché dans Pour toi reste auditable.
 */

const TAG_ALIASES = Object.freeze({
  "hip hop": "hip_hop", "hip-hop": "hip_hop", "french rap": "french_rap",
  "rap concert": "rap_concert", "r&b": "rnb", "r b": "rnb", "k-pop": "kpop",
  "dj set": "dj_set", "live music": "live_music", "performance music": "performance_music",
  "music festival": "music_festival", "film festival": "film_festival",
  "festival cinéma": "festival_cinema", "festival cinema": "festival_cinema",
  "avant première": "avant_premiere", "avant premiere": "avant_premiere",
  "rencontre réalisateur": "rencontre_realisateur", "rencontre realisateur": "rencontre_realisateur",
  "ciné débat": "cine_debat", "cine debat": "cine_debat", "art exhibition": "art_exhibition",
  "photo exhibition": "photography_exhibition", "museum exhibition": "museum_exhibition",
  "convention manga": "convention_manga", "convention anime": "convention_anime",
  "anime screening": "anime_screening", "signing manga": "signing_manga",
  "manga festival": "manga_festival", "fashion show": "fashion_show", "fashion popup": "fashion_popup",
  "clothing drop": "clothing_drop", "food festival": "food_festival", "street food": "street_food",
  "food market": "food_market", "brunch event": "brunch_event", "chef event": "chef_event",
  "night club": "nightclub", "night event": "night_event", "after party": "afterparty",
  "dance party": "dance_party", "family event": "family_event", "young audience": "young_audience",
  "workshop children": "workshop_children", "family show": "family_show", "parenting event": "parenting_event",
  "stage play": "stage_play", "dramatic art": "dramatic_art", "theatre premiere": "theatre_premiere",
  "theatre festival": "theatre_festival", "local festival": "local_festival",
});

const TAGS = new Set([
  "music", "rap", "hip_hop", "french_rap", "trap", "drill", "rap_concert", "rnb", "afro", "pop",
  "rock", "electro", "jazz", "reggae", "kpop", "classical", "dj_set", "showcase", "concert", "live",
  "live_music", "gig", "performance_music", "music_festival", "culture", "cinema", "film", "screening",
  "projection", "avant_premiere", "premiere", "festival_cinema", "film_festival", "rencontre_realisateur",
  "rencontre_equipe_film", "cine_debat", "exhibition", "exposition", "vernissage", "gallery", "art_exhibition",
  "photography_exhibition", "museum_exhibition", "retrospective", "theatre", "theater", "play", "stage_play",
  "dramatic_art", "theatre_premiere", "theatre_festival", "dance", "standup", "artist_meeting", "festival",
  "cultural_festival", "manga_anime_gaming", "manga", "anime", "japanimation", "cosplay", "convention_manga",
  "convention_anime", "mangaka", "anime_screening", "signing_manga", "convention", "gaming", "tournament",
  "signing", "popup", "manga_festival", "sport", "football", "soccer", "football_match", "ligue1", "coupe",
  "losc", "futsal", "basketball", "tennis", "combat_sport", "combat_sports", "running", "cycling", "athletics",
  "match", "competition", "fashion_lifestyle", "fashion", "mode", "fashion_show", "runway", "sneakers",
  "streetwear", "designer", "fashion_popup", "clothing_drop", "popup_store", "drop", "creators_market", "food",
  "gastronomy", "restaurant_event", "street_food", "food_festival", "tasting", "culinary", "food_market",
  "brunch_event", "chef_event", "nightlife", "club", "nightclub", "party", "night_event", "afterparty", "rave",
  "dance_party", "family", "kids", "children", "family_event", "young_audience", "workshop_children", "family_show",
  "parenting_event", "local", "braderie", "neighbourhood_party", "market", "street_festival", "association_event",
  "local_festival", "automobile",
]);

const TIERS = Object.freeze([
  {name: "structured_category", confidence: 1, fields: ["category", "eventCategory", "event_category", "type", "eventType", "event_type", "@type"]},
  {name: "official_keywords", confidence: .98, fields: ["announcement_tags", "announcementTags", "taxonomy_tags", "taxonomyTags", "keywords", "tags", "subjects", "themes", "genre", "genres", "officialTags"]},
  {name: "event_metadata", confidence: .95, fields: ["metadata", "event_metadata", "eventMetadata", "classification", "classifications", "audience", "event_type_metadata"]},
  {name: "official_text", confidence: .88, fields: ["title", "name", "headline", "description", "hasDescription", "description_short", "description_long"]},
  {name: "performer", confidence: .92, fields: ["performerGenres", "performer_genres", "artistGenres", "artist_genres", "performers", "performer", "artists", "artist"]},
  {name: "official_image", confidence: .75, fields: ["image_analysis", "imageAnalysis", "poster_analysis", "posterAnalysis", "vision_tags", "visionTags", "ocr_text", "ocrText"]},
  {name: "ai", confidence: .55, fields: ["ai_tags", "aiTags", "ai_analysis", "aiAnalysis"]},
]);

function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function textValues(value, depth = 0) {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim();
    return result ? [result] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => textValues(item, depth + 1));
  if (typeof value !== "object") return [];
  const preferred = ["fr", "@value", "value", "label", "name", "text", "content", "genre", "genres"];
  const keys = [...preferred, ...Object.keys(value).filter((key) => !preferred.includes(key))];
  return keys.flatMap((key) => textValues(value[key], depth + 1));
}

function normalizeTag(value) {
  const normalized = normalizeText(value);
  const alias = TAG_ALIASES[normalized] || normalized;
  const tag = alias.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return TAGS.has(tag) ? tag : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function explicitTags(value, {tier = "official_keywords", field = ""} = {}) {
  const raw = normalizeText(value);
  const original = String(value ?? "");
  const textOnly = tier === "official_text";
  const titleLike = ["title", "name", "headline"].includes(field);
  const tags = [];
  const add = (...values) => values.forEach((tag) => { if (TAGS.has(tag)) tags.push(tag); });
  const direct = normalizeTag(value);
  if (direct) add(direct);

  // La cascade reconnaît uniquement des termes propres au type demandé.
  // « concert », « sport », « festival » et « marché » restent génériques.
  if (/\b(?:rap|french rap|trap|drill|rap concert)\b/.test(raw)) add("rap");
  if (!textOnly || /\b(?:musique|music|concert|artiste|artist)\b[\s\S]*\bhip[ -]?hop\b/.test(raw)) {
    if (/\bhip[ -]?hop\b/.test(raw)) add("hip_hop");
  }
  if (/\b(?:concert|live music|showcase|gig|performance musicale|musique live)\b/.test(raw)) add("concert");
  if (/\b(?:music|musique)\b/.test(raw)) add("music");

  /* ---- LE GENRE, QUI N'EST PAS LE FORMAT ---------------------------------

     `concert` dit la FORME de l'événement ; `rap`, `pop`, `jazz` disent ce
     qu'on va y entendre. Les deux se cumulent — un concert de rap porte
     `concert` ET `rap` — et c'est ce cumul qui rend « Pour toi » utilisable :
     l'un répond à « je sors ce soir », l'autre à « j'écoute ça ».

     CE QUI MANQUAIT, ET CE QUE ÇA COÛTAIT

     Le vocabulaire `TAGS` déclarait douze genres ; deux seulement étaient
     posés — `rap` et `hip_hop`. Les dix autres n'avaient aucune règle. Sur les
     385 concerts de la base, sept portaient un genre, et c'était toujours le
     même. Un concert pop rendait `["concert"]`, un point c'est tout : le genre
     retombait dans `music`, qui ne personnalise rien.

     Conséquence à l'écran : Rap était le seul genre qui pouvait jamais
     correspondre à un intérêt. Ce n'était pas un choix d'affichage, c'était le
     seul que la chaîne produisait.

     POURQUOI DEUX RÉGIMES DE PREUVE

     Dans un champ `genre`, `genres` ou `performerGenres`, le mot EST la
     réponse : on le prend tel quel. Dans un titre ou une description, c'est de
     la prose, et trois mots y sont des pièges :

       · « pop » vit dans « pop-up store » et « pop corn » ;
       · « classique » qualifie aussi un film ou une voiture ;
       · « rock » peut nommer un lieu autant qu'un genre.

     Ces trois-là exigent donc un contexte musical explicite quand ils sortent
     d'un texte libre. Les autres — jazz, reggae, k-pop, afro, électro, R&B —
     ne désignent rien d'autre en français : ils passent seuls.

     CE QU'ON NE FAIT PAS. Deviner. « soul » sans contexte, « house » qui est
     une maison, « metal » qui est un matériau : hors de cette liste, on
     préfère l'absence de genre à un genre faux, parce qu'un faux genre pollue
     durablement la surveillance de quelqu'un. */
  const contexteMusical =
    /\b(?:musique|music|concert|live|artiste|artist|groupe|band|chanteur|chanteuse|chante|dj|album|tournee|scene|festival de musique)\b/
      .test(raw);
  const genreEnProse = !textOnly || contexteMusical;

  if (/\bjazz\b/.test(raw)) add("jazz");
  if (/\b(?:reggae|ragga|dancehall)\b/.test(raw)) add("reggae");
  if (/\bk[ -]?pop\b/.test(raw)) add("kpop");
  if (/\b(?:r&b|r and b|rnb)\b/.test(raw)) add("rnb");
  if (/\bafro(?:beat|jazz|pop)?\b/.test(raw)) add("afro");
  if (/\b(?:electro|techno|house music|trance)\b/.test(raw)) add("electro");
  /* « pop » seulement quand ce n'est ni un pop-up ni du pop-corn, et jamais
     comme résidu de « k-pop », qui a déjà son propre tag. */
  if (genreEnProse && /\bpop\b/.test(raw) &&
      !/\bpop[ -]?(?:up|corn|store)\b/.test(raw) && !/\bk[ -]?pop\b/.test(raw)) add("pop");
  if (genreEnProse && /\brock\b/.test(raw)) add("rock");
  if (genreEnProse &&
      /\b(?:classique|classical|opera|symphoni\w*|philharmoni\w*|orchestre)\b/.test(raw)) add("classical");
  if (/\b(?:dj set|djset)\b/.test(raw)) add("dj_set", "nightlife");
  if (/\b(?:club night|nightclub|night club|nightlife|afterparty|after party|rave|dance party|soiree dansante)\b/.test(raw)) add("nightlife");
  if (!textOnly && /\bparty\b/.test(raw)) add("party", "nightlife");
  if (titleLike && /\bparty\b/.test(raw)) add("party", "nightlife");

  const cinema = textOnly
    ? (titleLike && /^(?:cinema|film|projection|seance)\b/.test(raw)) ||
      /\b(?:projection|screening|seance de cinema|avant premiere|festival de cinema|film festival|cine debat|rencontre avec le realisateur|court metrage|long metrage|film au programme|films? au programme)\b/.test(raw)
    : /\b(?:cinema|film|projection|screening|seance|avant premiere|festival cinema|film festival|cine debat|rencontre realisateur)\b/.test(raw);
  if (cinema) add("cinema");
  if (/\b(?:film festival|festival cinema|festival de cinema)\b/.test(raw)) add("film_festival", "festival");
  if (/\bavant premiere\b/.test(raw)) add("avant_premiere");
  if (/\b(?:cine debat|rencontre realisateur)\b/.test(raw)) add("cine_debat");

  const exhibitionText = textOnly
    ? (titleLike && /^(?:exposition|expo|vernissage|gallery|galerie)\b/.test(raw)) ||
      /\b(?:exposition|expo|vernissage|galerie d art|art exhibition|photography exhibition|retrospective)\b/.test(raw)
    : /\b(?:exposition|expo|vernissage|galerie d art|gallery|art exhibition|photography exhibition|retrospective)\b/.test(raw);
  if (exhibitionText) add("exhibition");
  if (/\b(?:museum exhibition|exposition de musee)\b/.test(raw)) add("museum_exhibition");
  const theatreText = textOnly
    ? (titleLike && /\b(?:theatre|theater)\b/.test(raw)) ||
      /\b(?:piece de theatre|stage play|dramatic art|spectacle de theatre|theatre d objet|mise en scene)\b/.test(raw)
    : /\b(?:theatre|theater|piece de theatre|stage play|dramatic art|spectacle de theatre|theatre d objet)\b/.test(raw);
  if (theatreText) add("theatre");
  if (/\b(?:theatre premiere|theatre festival)\b/.test(raw)) add("theatre_festival");
  if (/\b(?:danse|dance|ballet|choregraphie)\b/.test(raw)) add("dance");

  const manga = /\b(?:manga|japanimation|cosplay|mangaka|projection anime|dedicace manga)\b/.test(raw) ||
    (!textOnly && /\banime\b/.test(raw)) || (titleLike && /\banime\b/i.test(original));
  const convention = /\bconvention\b/.test(raw);
  if (manga) add("manga_anime_gaming");
  if (/\bmanga\b/.test(raw)) add("manga");
  if (/\bjapanimation\b/.test(raw) || (!textOnly && /\banime\b/.test(raw)) ||
      (titleLike && /\banime\b/i.test(original))) add("anime");
  if (/\bcosplay\b/.test(raw)) add("cosplay");
  if (convention) add("convention");
  if (/\bconvention\b[\s\S]*\bmanga\b/.test(raw)) add("convention_manga");
  if (/\bconvention\b[\s\S]*\banime\b/.test(raw)) add("convention_anime");
  if (/\bgaming\b|\bgeek days?\b/.test(raw)) add("gaming");
  if (/\bmanga festival\b/.test(raw)) add("manga_festival", "festival");

  const football = /\b(?:football|soccer|ligue ?1|losc|futsal|match de football|coupe de france)\b/.test(raw);
  if (football) add("football", "football_match");
  if (/\blosc\b/.test(raw)) add("losc");
  if (/\b(?:basket|basketball|tennis|course|running|cyclisme|cycling|athletisme|sport|competition|tournoi|match)\b/.test(raw)) add("sport");
  if (/\b(?:match|competition|tournoi)\b/.test(raw)) add("match");
  if (/\btournoi\b/.test(raw)) add("tournament");

  if (/\b(?:fashion|streetwear|sneakers|fashion show|defile|runway|fashion popup|clothing drop|mode vestimentaire|textile et mode|collection de mode)\b/.test(raw) ||
      (titleLike && /^mode$/.test(raw))) add("fashion");
  if (/\bfashion show|defile\b/.test(raw)) add("fashion_show");
  if (/\b(?:food|gastronomie|street food|food festival|tasting|degustation|culinaire|food market|brunch|chef event)\b/.test(raw)) add("food");
  if (/\bfood festival\b/.test(raw)) add("food_festival", "festival");
  if (/\bstreet food\b/.test(raw)) add("street_food");
  const familyText = textOnly
    ? /\b(?:young audience|jeune public|workshop children|atelier enfants|parenting|parentalite|en famille|public familial|parents et enfants|pour les enfants)\b/.test(raw) ||
      (titleLike && /\bfamille\b/.test(raw))
    : /\b(?:family|famille|kids|children|young audience|jeune public|workshop children|atelier enfants|parenting|parentalite|en famille|public familial|parents et enfants|pour les enfants)\b/.test(raw);
  if (familyText ||
      (titleLike && /\bfamille\b/.test(raw))) add("family");
  if (/\bfamily event\b|\bfamily show\b/.test(raw)) add("family_event");
  if (/\b(?:festival|cultural festival|local festival)\b/.test(raw)) add("festival");
  if (/\bcultural festival\b/.test(raw)) add("cultural_festival");
  if (/\blocal festival\b/.test(raw)) add("local_festival");
  if (/\b(?:braderie|neighbourhood party|fete de quartier|street festival|association event)\b/.test(raw)) add("local");

  return unique(tags);
}

function evidenceText(value) {
  const values = textValues(value);
  const joined = unique(values).join(" · ").replace(/\s+/g, " ").trim();
  return joined.slice(0, 280);
}

function fieldValues(record, field) {
  const value = record?.[field];
  return textValues(value).map((text) => ({field, text}));
}

/**
 * Enrichit un événement sans jamais modifier l'ontologie de matching.
 * `source` est la provenance métier (openagenda, datatourisme, ...), tandis
 * que `source_tier` décrit le niveau de preuve utilisé.
 */
export function enrichirTagsAnnonce(record, {
  source = "unknown", extractedAt = new Date().toISOString(), includeStoredTags = true,
} = {}) {
  const input = record && typeof record === "object" ? record : {};
  const tags = [];
  const evidence = [];
  const seenEvidence = new Set();

  for (const tier of TIERS) {
    for (const field of tier.fields) {
      if (!includeStoredTags && ["announcement_tags", "announcementTags", "taxonomy_tags", "taxonomyTags"].includes(field)) continue;
      for (const item of fieldValues(input, field)) {
        const found = explicitTags(item.text, {tier: tier.name, field: item.field});
        for (const tag of found) {
          tags.push(tag);
          const key = [tag, source, tier.name, item.text].join("\u0000");
          if (seenEvidence.has(key)) continue;
          seenEvidence.add(key);
          evidence.push({
            tag,
            source,
            source_tier: tier.name,
            evidence: evidenceText(item.text),
            confidence: tier.confidence,
            extracted_at: extractedAt,
          });
        }
      }
    }
  }

  return {tags: unique(tags), evidence};
}

export function fusionnerPreuvesTags(...values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const entries = Array.isArray(value) ? value : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !entry.tag || !entry.source || !entry.evidence) continue;
      const safe = {
        tag: String(entry.tag), source: String(entry.source), evidence: String(entry.evidence).slice(0, 280),
        confidence: Number(entry.confidence), extracted_at: String(entry.extracted_at || ""),
      };
      if (!TAGS.has(safe.tag) || !Number.isFinite(safe.confidence) || !safe.extracted_at) continue;
      const key = [safe.tag, safe.source, safe.evidence, safe.extracted_at].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(safe);
    }
  }
  return result;
}

export {TAGS as ANNOUNCEMENT_TAGS};
