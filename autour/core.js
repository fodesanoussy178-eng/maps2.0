(function (root) {
  "use strict";

  const FAMILY_CATEGORIES = Object.freeze([
    "cinema",
    "playground",
    "park",
    "museum",
    "library",
    "swimming_pool",
    "bowling_alley",
    "zoo",
    "educational_farm",
    "kids_event",
    "family_event",
    "workshop",
    "youth_activity",
  ]);

  const ORDINARY_SCHOOL_TYPES = new Set([
    "school",
    "college",
    "secondary school",
    "primary school",
    "kindergarten",
    "childcare",
    "creche",
  ]);

  const CINEMA_WORDS = /\b(cinema|cine|cgr|ugc|kinepolis|pathe|le fresnoy|projection|film|screening|movie)\b/;
  const FAMILY_WORDS = /\b(famille|familial|family|enfant|enfants|jeunesse|jeune public|kids?|children?|atelier|workshop|fete locale|youth)\b/;
  const CINEMA_EVENT_WORDS = /\b(screening|movie|film|projection|seance cinema)\b/;

  const CATEGORY_RELATIONS = Object.freeze({
    cinema: ["cinema", "outing", "culture", "family"],
    spectacle: ["show", "outing", "culture"],
    concert: ["concert", "outing", "culture"],
    parc: ["park", "outing", "family", "sport"],
    terrain: ["sport"],
    biblio: ["library", "services", "study", "family"],
    coworking: ["services", "study"],
    musee: ["museum", "culture", "outing", "family"],
    asso: ["association", "help"],
    alimentaire: ["help", "food_aid"],
    hebergement: ["help", "shelter"],
    emploi: ["help", "services", "employment"],
    sante: ["help", "services", "health"],
    marche: ["market", "eat", "buy", "outing"],
    resto: ["restaurant", "eat"],
    fastfood: ["restaurant", "eat"],
    cafe: ["cafe", "eat", "study"],
    bar: ["bar", "outing"],
    friperie: ["buy"],
    commerce: ["buy"],
    mairie: ["services"],
    ecole: ["education"],
    metro: ["transport", "services"],
    bus: ["transport", "services"],
    velo: ["transport", "services", "sport"],
    toilettes: ["services"],
    recharge: ["services"],
    event: ["event", "outing"],
    popup: ["event", "outing", "buy"],
    collecte: ["event", "help"],
    studio: ["event", "culture"],
    sport: ["event", "sport"],
    food: ["event", "eat", "outing"],
  });

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’']/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function parseTime(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function classifyPlace(place) {
    const p = place || {};
    const tags = p.tags || {};
    const primary = p.cat || p.primaryCategory || p.category || "";
    const type = normalizeText(p.type || p.placeType || tags.amenity || tags.leisure || tags.tourism || "");
    const text = normalizeText([
      p.title,
      p.titre,
      p.name,
      p.description,
      p.eventCategory,
      p.keywords,
      p.type,
      tags.name,
      tags.description,
      tags.event,
    ].filter(Boolean).join(" "));
    const categories = new Set(Array.isArray(p.categories) ? p.categories : []);

    if (primary) categories.add(primary);
    (CATEGORY_RELATIONS[primary] || []).forEach((category) => categories.add(category));

    const amenity = normalizeText(tags.amenity);
    const leisure = normalizeText(tags.leisure);
    const tourism = normalizeText(tags.tourism);
    const office = normalizeText(tags.office);
    const socialFacility = normalizeText(tags.social_facility);
    const transportPlace = ["bus", "metro", "velo"].includes(primary) ||
      /\b(bus stop|tram stop|station|subway|bicycle parking|bicycle rental)\b/.test(type);

    if (amenity === "cinema" || leisure === "cinema" || (!transportPlace && CINEMA_WORDS.test(text))) {
      ["cinema", "outing", "culture", "family"].forEach((category) => categories.add(category));
    }
    if (amenity === "theatre" || type.includes("theater") || type.includes("theatre")) {
      ["show", "outing", "culture"].forEach((category) => categories.add(category));
      if (!CINEMA_WORDS.test(text)) categories.delete("cinema");
    }

    if (amenity === "library" || (!transportPlace && /\b(bibliotheque|mediatheque|library)\b/.test(text))) {
      ["library", "services", "study", "family"].forEach((category) => categories.add(category));
    }
    if (leisure === "park" || leisure === "garden" || primary === "parc" || type === "park" || type === "garden") {
      ["park", "outing", "family", "sport"].forEach((category) => categories.add(category));
    }
    if (leisure === "playground") ["playground", "park", "family", "sport"].forEach((category) => categories.add(category));
    if (leisure === "swimming pool") ["swimming_pool", "family", "sport"].forEach((category) => categories.add(category));
    if (leisure === "bowling alley") ["bowling_alley", "family", "sport", "outing"].forEach((category) => categories.add(category));
    if (tourism === "zoo") ["zoo", "family", "outing"].forEach((category) => categories.add(category));
    if (tourism === "farm" || /\b(ferme pedagogique|educational farm)\b/.test(text)) {
      ["educational_farm", "family", "outing"].forEach((category) => categories.add(category));
    }
    if (tourism === "museum" || (!transportPlace && /\b(musee|museum)\b/.test(text))) {
      ["museum", "culture", "family", "outing"].forEach((category) => categories.add(category));
    }
    if (amenity === "marketplace" || /\b(marche|market)\b/.test(text)) {
      ["market", "eat", "buy", "outing"].forEach((category) => categories.add(category));
    }
    if (amenity === "social centre" || amenity === "community centre" || office === "association" || socialFacility) {
      ["help", "association"].forEach((category) => categories.add(category));
    }
    if (amenity === "social centre" || amenity === "community centre") categories.add("family");

    const isTemporary = p.isTemporary === true || p.temporaire === true || ["event", "popup", "collecte", "studio", "sport", "food"].includes(primary);
    if (isTemporary) categories.add("event");
    if (CINEMA_EVENT_WORDS.test(text)) ["cinema", "event", "outing", "culture"].forEach((category) => categories.add(category));
    if (isTemporary && /\b(atelier|workshop)\b/.test(text)) ["workshop", "event", "family"].forEach((category) => categories.add(category));
    if (isTemporary && /\b(enfant|enfants|kids?|children?|jeune public)\b/.test(text)) ["kids_event", "event", "family"].forEach((category) => categories.add(category));
    if ((isTemporary && /\b(jeunesse|youth|jeunes)\b/.test(text)) || normalizeText(tags.club) === "youth") {
      ["youth_activity", "family"].forEach((category) => categories.add(category));
      if(isTemporary) categories.add("event");
    }
    if (isTemporary && /\b(famille|familial|family|fete locale)\b/.test(text)) ["family_event", "event", "family"].forEach((category) => categories.add(category));

    const familyRestaurant = [tags.highchair, tags.kids_area, tags.family, tags.changing_table].some((value) => /^(yes|designated)$/i.test(String(value || "")));
    if ((primary === "resto" || primary === "fastfood" || type.includes("restaurant")) && (familyRestaurant || FAMILY_WORDS.test(text))) {
      categories.add("restaurant");
      categories.add("family");
    }

    const accessibleSport = (categories.has("sport") || primary === "terrain" || primary === "sport") &&
      (/\b(accessible|tout public|all ages|debutant|beginner)\b/.test(text) || /^(yes|designated)$/i.test(String(tags.wheelchair || "")));
    if(accessibleSport) categories.add("family");

    const ordinarySchool = ORDINARY_SCHOOL_TYPES.has(type) ||
      [tags.amenity, tags.school].some((value) => ORDINARY_SCHOOL_TYPES.has(normalizeText(value))) ||
      /\b(ecole|college|lycee|creche|groupe scolaire|primary school|secondary school|high school)\b/.test(text);
    if (ordinarySchool && !(isTemporary && FAMILY_WORDS.test(text))) {
      categories.delete("family");
      FAMILY_CATEGORIES.forEach((category) => categories.delete(category));
    }

    return unique([...categories]);
  }

  function toCommonItem(raw, defaults) {
    const source = (defaults && defaults.source) || raw.source || "unknown";
    const title = raw.title || raw.titre || raw.name || "";
    const latitude = Number(raw.latitude != null ? raw.latitude : raw.lat);
    const longitude = Number(raw.longitude != null ? raw.longitude : raw.lng);
    const startsAt = parseTime(raw.startsAt != null ? raw.startsAt : (raw.debutLe != null ? raw.debutLe : raw.debut_le));
    const endsAt = parseTime(raw.endsAt != null ? raw.endsAt : (raw.finLe != null ? raw.finLe : raw.fin_le));
    const openingHours = raw.openingHours != null ? raw.openingHours : (raw.horaires || raw.quand || null);
    const isTemporary = raw.isTemporary != null
      ? !!raw.isTemporary
      : ["event", "popup", "collecte", "studio", "sport", "food"].includes(raw.cat);
    const categories = classifyPlace(Object.assign({}, raw, { title, source, isTemporary }));

    return Object.assign({}, raw, {
      id: String(raw.id),
      source,
      sources: unique([...(raw.sources || []), source]),
      title,
      description: raw.description || "",
      latitude,
      longitude,
      categories,
      startsAt,
      endsAt,
      openingHours,
      isTemporary,
      url: raw.url || "",
      image: raw.image || "",
      titre: title,
      lat: latitude,
      lng: longitude,
      debutLe: startsAt,
      finLe: endsAt,
    });
  }

  function matchesCategory(item, category) {
    if (!item || !category) return false;
    return item.cat === category || (item.categories || []).includes(category);
  }

  function mergeDuplicate(left, right) {
    const merged = Object.assign({}, left);
    const preferred = right.source === "autour" ? right : left;
    const fallback = preferred === right ? left : right;
    Object.assign(merged, fallback, preferred);
    merged.categories = unique([...(left.categories || []), ...(right.categories || [])]);
    merged.sources = unique([...(left.sources || [left.source]), ...(right.sources || [right.source])]);
    merged.source = preferred.source || fallback.source;
    merged.description = preferred.description || fallback.description || "";
    merged.url = preferred.url || fallback.url || "";
    merged.image = preferred.image || fallback.image || "";
    merged.startsAt = preferred.startsAt != null ? preferred.startsAt : fallback.startsAt;
    merged.endsAt = preferred.endsAt != null ? preferred.endsAt : fallback.endsAt;
    merged.debutLe = merged.startsAt;
    merged.finLe = merged.endsAt;
    return merged;
  }

  function sameTitle(a, b) {
    const clean = (value) => normalizeText(value).replace(/\b(le|la|les|l|the)\b/g, " ").replace(/\s+/g, " ").trim();
    const left = clean(a);
    const right = clean(b);
    return !!left && !!right && (left === right || (left.length > 7 && right.length > 7 && (left.includes(right) || right.includes(left))));
  }

  function dedupeItems(items, distanceBetween) {
    const result = [];
    (items || []).forEach((item) => {
      const found = result.findIndex((existing) => {
        if (!!existing.isTemporary !== !!item.isTemporary) return false;
        if (!sameTitle(existing.title || existing.titre, item.title || item.titre)) return false;
        const distance = distanceBetween(existing.latitude, existing.longitude, item.latitude, item.longitude);
        if (!Number.isFinite(distance) || distance > 120) return false;
        if (!item.isTemporary) return true;
        if (existing.startsAt == null || item.startsAt == null) return true;
        return Math.abs(existing.startsAt - item.startsAt) <= 3 * 3600 * 1000;
      });
      if (found === -1) result.push(item);
      else result[found] = mergeDuplicate(result[found], item);
    });
    return result;
  }

  function isAvailableNow(item, at) {
    const now = at == null ? Date.now() : Number(at);
    if (item.isTemporary) {
      if (item.endsAt != null && item.endsAt < now) return false;
      if (item.startsAt != null && item.startsAt > now + 12 * 3600 * 1000) return false;
      return true;
    }
    return item.ouvert !== false;
  }

  root.AutourCore = Object.freeze({
    FAMILY_CATEGORIES,
    normalizeText,
    classifyPlace,
    toCommonItem,
    matchesCategory,
    dedupeItems,
    isAvailableNow,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
