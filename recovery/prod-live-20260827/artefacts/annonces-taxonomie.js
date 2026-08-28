(function(root) {
  "use strict";
  const DOMAINES = Object.freeze({
    music: Object.freeze([
      "rap",
      "hip_hop",
      "french_rap",
      "trap",
      "drill",
      "rap_concert",
      "rnb",
      "afro",
      "pop",
      "rock",
      "electro",
      "jazz",
      "reggae",
      "kpop",
      "classical",
      "dj_set",
      "showcase",
      "concert",
      "live",
      "live_music",
      "gig",
      "performance_music",
      "music_festival"
    ]),
    culture: Object.freeze([
      "cinema",
      "film",
      "screening",
      "projection",
      "avant_premiere",
      "premiere",
      "festival_cinema",
      "film_festival",
      "rencontre_realisateur",
      "rencontre_equipe_film",
      "cine_debat",
      "exhibition",
      "exposition",
      "vernissage",
      "gallery",
      "art_exhibition",
      "photography_exhibition",
      "museum_exhibition",
      "retrospective",
      "theatre",
      "theater",
      "play",
      "stage_play",
      "dramatic_art",
      "theatre_premiere",
      "theatre_festival",
      "dance",
      "standup",
      "artist_meeting",
      "festival",
      "cultural_festival"
    ]),
    manga_anime_gaming: Object.freeze([
      "manga",
      "anime",
      "manga_anime_gaming",
      "japanimation",
      "cosplay",
      "convention_manga",
      "convention_anime",
      "mangaka",
      "anime_screening",
      "signing_manga",
      "convention",
      "gaming",
      "tournament",
      "signing",
      "popup",
      "manga_festival"
    ]),
    sport: Object.freeze([
      "sport",
      "football",
      "soccer",
      "football_match",
      "ligue1",
      "coupe",
      "losc",
      "futsal",
      "basketball",
      "tennis",
      "combat_sport",
      "combat_sports",
      "running",
      "cycling",
      "athletics",
      "match",
      "competition",
      "tournament"
    ]),
    fashion_lifestyle: Object.freeze([
      "fashion",
      "mode",
      "fashion_show",
      "runway",
      "streetwear",
      "sneakers",
      "designer",
      "fashion_popup",
      "clothing_drop",
      "popup_store",
      "drop",
      "creators_market"
    ]),
    food: Object.freeze([
      "food",
      "gastronomy",
      "restaurant_event",
      "street_food",
      "food_festival",
      "tasting",
      "culinary",
      "food_market",
      "brunch_event",
      "chef_event"
    ]),
    nightlife: Object.freeze([
      "nightlife",
      "club",
      "nightclub",
      "party",
      "dj_set",
      "night_event",
      "afterparty",
      "rave",
      "dance_party"
    ]),
    family: Object.freeze([
      "family",
      "kids",
      "children",
      "family_event",
      "young_audience",
      "workshop_children",
      "family_show",
      "parenting_event"
    ]),
    local: Object.freeze([
      "braderie",
      "neighbourhood_party",
      "market",
      "street_festival",
      "association_event",
      "festival",
      "local_festival"
    ])
  });
  const TAGS = Object.freeze(Object.keys(DOMAINES).concat(
    Object.values(DOMAINES).flat(),
    ["live", "automobile"]
  ));
  const TAG_SET = new Set(TAGS);
  const INTEREST_MATCHING = Object.freeze({
    rap: Object.freeze(["rap", "hip_hop", "french_rap", "trap", "drill", "rap_concert"]),
    concerts: Object.freeze([
      "concert",
      "live",
      "live_music",
      "showcase",
      "gig",
      "performance_music",
      "music_festival"
    ]),
    cinema: Object.freeze([
      "cinema",
      "film",
      "screening",
      "projection",
      "avant_premiere",
      "premiere",
      "festival_cinema",
      "film_festival",
      "rencontre_realisateur",
      "rencontre_equipe_film",
      "cine_debat"
    ]),
    manga_anime: Object.freeze([
      "manga",
      "anime",
      "manga_anime_gaming",
      "japanimation",
      "cosplay",
      "convention_manga",
      "convention_anime",
      "mangaka",
      "anime_screening",
      "signing_manga",
      "manga_festival"
    ]),
    exhibitions: Object.freeze([
      "exhibition",
      "exposition",
      "vernissage",
      "gallery",
      "art_exhibition",
      "photography_exhibition",
      "museum_exhibition",
      "retrospective"
    ]),
    sport: Object.freeze([
      "sport",
      "match",
      "tournament",
      "competition",
      "running",
      "basketball",
      "tennis",
      "combat_sport",
      "combat_sports",
      "cycling",
      "athletics"
    ]),
    football: Object.freeze([
      "football",
      "soccer",
      "football_match",
      "ligue1",
      "coupe",
      "losc",
      "futsal"
    ]),
    fashion: Object.freeze([
      "fashion",
      "mode",
      "fashion_show",
      "runway",
      "streetwear",
      "sneakers",
      "designer",
      "fashion_popup",
      "clothing_drop",
      "creators_market"
    ]),
    food: Object.freeze([
      "food",
      "gastronomy",
      "restaurant_event",
      "street_food",
      "food_festival",
      "tasting",
      "culinary",
      "food_market",
      "brunch_event",
      "chef_event"
    ]),
    nightlife: Object.freeze([
      "nightlife",
      "club",
      "nightclub",
      "party",
      "dj_set",
      "night_event",
      "afterparty",
      "rave",
      "dance_party"
    ]),
    family: Object.freeze([
      "family",
      "kids",
      "children",
      "family_event",
      "young_audience",
      "workshop_children",
      "family_show",
      "parenting_event"
    ]),
    theatre: Object.freeze([
      "theatre",
      "theater",
      "play",
      "stage_play",
      "dramatic_art",
      "theatre_premiere",
      "theatre_festival"
    ]),
    festivals: Object.freeze([
      "festival",
      "music_festival",
      "film_festival",
      "festival_cinema",
      "food_festival",
      "cultural_festival",
      "manga_festival",
      "local_festival"
    ])
  });
  const INTEREST_ALIASES = Object.freeze({
    rap: "rap",
    concerts: "concerts",
    cinema: "cinema",
    manga: "manga_anime",
    manga_anime: "manga_anime",
    expos: "exhibitions",
    exhibitions: "exhibitions",
    sport: "sport",
    football: "football",
    mode: "fashion",
    fashion: "fashion",
    food: "food",
    nuit: "nightlife",
    nightlife: "nightlife",
    famille: "family",
    family: "family",
    theatre: "theatre",
    festivals: "festivals"
  });
  const INTEREST_LABELS = Object.freeze({
    rap: "Rap",
    concerts: "Concerts",
    cinema: "Cin\xE9ma",
    manga_anime: "Manga / Anime",
    exhibitions: "Expositions",
    sport: "Sport",
    football: "Football",
    fashion: "Mode",
    food: "Food",
    nightlife: "Vie nocturne",
    family: "Famille",
    theatre: "Th\xE9\xE2tre",
    festivals: "Festivals"
  });
  const ALIASES = Object.freeze({
    "hip hop": "hip_hop",
    "hip-hop": "hip_hop",
    "r&b": "rnb",
    "r b": "rnb",
    "k-pop": "kpop",
    "dj set": "dj_set",
    "stand up": "standup",
    "street festival": "street_festival",
    "neighborhood party": "neighbourhood_party",
    "popup store": "popup_store",
    "pop up": "popup",
    "pop-up": "popup",
    "creative market": "creators_market",
    "combat sport": "combat_sport",
    "live music": "live_music",
    "performance music": "performance_music",
    "french rap": "french_rap",
    "rap concert": "rap_concert",
    "avant premi\xE8re": "avant_premiere",
    "film festival": "film_festival",
    "festival cin\xE9ma": "festival_cinema",
    "rencontre r\xE9alisateur": "rencontre_realisateur",
    "cin\xE9 d\xE9bat": "cine_debat",
    "art exhibition": "art_exhibition",
    "photo exhibition": "photography_exhibition",
    "museum exhibition": "museum_exhibition",
    "convention manga": "convention_manga",
    "convention anime": "convention_anime",
    "anime screening": "anime_screening",
    "signing manga": "signing_manga",
    "fashion show": "fashion_show",
    "fashion popup": "fashion_popup",
    "clothing drop": "clothing_drop",
    "food festival": "food_festival",
    "street food": "street_food",
    "food market": "food_market",
    "brunch event": "brunch_event",
    "chef event": "chef_event",
    "night club": "nightclub",
    "night event": "night_event",
    "after party": "afterparty",
    "dance party": "dance_party",
    "family event": "family_event",
    "young audience": "young_audience",
    "workshop children": "workshop_children",
    "family show": "family_show",
    "parenting event": "parenting_event",
    "stage play": "stage_play",
    "dramatic art": "dramatic_art",
    "theatre premiere": "theatre_premiere",
    "theatre festival": "theatre_festival",
    "local festival": "local_festival",
    "manga festival": "manga_festival"
  });
  const LABELS = Object.freeze({
    rap: "Rap",
    hip_hop: "Hip-hop",
    rnb: "R&B",
    afro: "Afro",
    pop: "Pop",
    rock: "Rock",
    electro: "\xC9lectro",
    jazz: "Jazz",
    reggae: "Reggae",
    kpop: "K-pop",
    concert: "Concert",
    live: "Live",
    showcase: "Showcase",
    dj_set: "DJ set",
    cinema: "Cin\xE9ma",
    exhibition: "Exposition",
    vernissage: "Vernissage",
    theatre: "Th\xE9\xE2tre",
    dance: "Danse",
    standup: "Stand-up",
    festival: "Festival",
    manga: "Manga",
    anime: "Anime",
    convention: "Convention",
    cosplay: "Cosplay",
    gaming: "Gaming",
    sport: "Sport",
    football: "Football",
    match: "Match",
    tournament: "Tournoi",
    running: "Course",
    fashion: "Mode",
    sneakers: "Sneakers",
    streetwear: "Streetwear",
    popup: "Pop-up",
    braderie: "Braderie",
    neighbourhood_party: "F\xEAte de quartier",
    market: "March\xE9",
    street_festival: "Festival de rue",
    association_event: "\xC9v\xE9nement associatif",
    automobile: "Automobile",
    film: "Film",
    screening: "Projection",
    projection: "Projection",
    avant_premiere: "Avant-premi\xE8re",
    festival_cinema: "Festival cin\xE9ma",
    film_festival: "Festival cin\xE9ma",
    rencontre_realisateur: "Rencontre r\xE9alisateur",
    rencontre_equipe_film: "Rencontre \xE9quipe film",
    cine_debat: "Cin\xE9-d\xE9bat",
    exposition: "Exposition",
    gallery: "Galerie",
    art_exhibition: "Exposition d\u2019art",
    photography_exhibition: "Exposition photo",
    museum_exhibition: "Exposition de mus\xE9e",
    retrospective: "R\xE9trospective",
    theater: "Th\xE9\xE2tre",
    play: "Pi\xE8ce",
    stage_play: "Pi\xE8ce de th\xE9\xE2tre",
    dramatic_art: "Art dramatique",
    theatre_premiere: "Premi\xE8re th\xE9\xE2tre",
    theatre_festival: "Festival de th\xE9\xE2tre",
    manga_anime_gaming: "Manga / Anime / Gaming",
    japanimation: "Japanimation",
    convention_manga: "Convention manga",
    convention_anime: "Convention anime",
    mangaka: "Mangaka",
    anime_screening: "Projection anime",
    signing_manga: "D\xE9dicace manga",
    manga_festival: "Festival manga",
    soccer: "Football",
    football_match: "Match de football",
    ligue1: "Ligue 1",
    coupe: "Coupe",
    losc: "LOSC",
    futsal: "Futsal",
    competition: "Comp\xE9tition",
    tennis: "Tennis",
    combat_sport: "Sport de combat",
    cycling: "Cyclisme",
    athletics: "Athl\xE9tisme",
    mode: "Mode",
    fashion_show: "D\xE9fil\xE9",
    runway: "Podium",
    designer: "Cr\xE9ateur",
    fashion_popup: "Pop-up mode",
    clothing_drop: "Drop mode",
    food: "Food",
    gastronomy: "Gastronomie",
    restaurant_event: "\xC9v\xE9nement restaurant",
    street_food: "Street food",
    food_festival: "Festival food",
    tasting: "D\xE9gustation",
    culinary: "Cuisine",
    food_market: "March\xE9 food",
    brunch_event: "Brunch",
    chef_event: "\xC9v\xE9nement chef",
    nightlife: "Vie nocturne",
    club: "Club",
    nightclub: "Bo\xEEte de nuit",
    party: "Soir\xE9e",
    night_event: "\xC9v\xE9nement nocturne",
    afterparty: "After",
    rave: "Rave",
    dance_party: "Soir\xE9e dansante",
    family: "Famille",
    kids: "Enfants",
    children: "Enfants",
    family_event: "\xC9v\xE9nement famille",
    young_audience: "Jeune public",
    workshop_children: "Atelier enfants",
    family_show: "Spectacle famille",
    parenting_event: "Parentalit\xE9",
    theater: "Th\xE9\xE2tre",
    play: "Pi\xE8ce",
    stage_play: "Pi\xE8ce de th\xE9\xE2tre",
    cultural_festival: "Festival culturel",
    local_festival: "Festival local"
  });
  function texte(value) {
    return String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }
  function normaliserTag(value) {
    const brut = texte(value).replace(/\s+/g, " ");
    const alias = ALIASES[brut] || brut;
    const tag = alias.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return TAG_SET.has(tag) ? tag : "";
  }
  function normaliserTags(values) {
    const liste = Array.isArray(values) ? values : values == null ? [] : [values];
    const tags = [];
    liste.forEach((value) => {
      const tag = normaliserTag(value);
      if (tag && !tags.includes(tag)) tags.push(tag);
    });
    return tags;
  }
  function normaliserInteret(value) {
    const brut = texte(value).replace(/\s+/g, " ");
    const slug = (ALIASES[brut] || brut).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return INTEREST_ALIASES[slug] || slug;
  }
  function normaliserTagSouple(value) {
    const brut = texte(value).replace(/\s+/g, " ");
    const alias = ALIASES[brut] || brut;
    return alias.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }
  function tagsDe(event) {
    const e = event || {};
    const explicites = [
      e.explicit_interest_tags,
      e.explicitInterestTags,
      e.interest_tags,
      e.interestTags
    ].flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value]).map(normaliserTagSouple).filter(Boolean);
    const annonces = normaliserTags(e.announcement_tags || e.announcementTags || e.taxonomy_tags || e.taxonomyTags || e.event_tags || e.eventTags);
    return [.../* @__PURE__ */ new Set([...explicites, ...annonces])];
  }
  function correspondances(event, interests) {
    const tags = new Set(tagsDe(event));
    const ids = Array.isArray(interests) ? interests : [];
    return ids.flatMap((id) => {
      const canonique = normaliserInteret(id);
      const suivis = INTEREST_MATCHING[canonique] || [normaliserTagSouple(canonique)];
      const matches = suivis.filter((tag) => tags.has(tag));
      return matches.length ? [{ id, tags: matches }] : [];
    });
  }
  function domainesDe(event) {
    const tags = new Set(tagsDe(event));
    return Object.entries(DOMAINES).filter(([, values]) => values.some((tag) => tags.has(tag))).map(([domain]) => domain);
  }
  function libelles(tags) {
    return normaliserTags(tags).map((tag) => LABELS[tag] || tag);
  }
  root.AutourAnnoncesTaxonomie = Object.freeze({
    DOMAINES,
    TAGS,
    INTEREST_MATCHING,
    INTEREST_ALIASES,
    INTEREST_LABELS,
    INTERETS: INTEREST_MATCHING,
    LABELS,
    normaliserTag,
    normaliserTags,
    normaliserInteret,
    tagsDe,
    domainesDe,
    correspondances,
    libelles
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
