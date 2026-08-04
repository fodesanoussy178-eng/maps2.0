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

  const INTENT_PROFILES = Object.freeze({
    manger: Object.freeze({
      categories: ["resto", "fastfood", "cafe", "marche", "food", "restaurant", "eat"],
      exact: ["resto", "fastfood", "cafe", "marche", "food"],
      open: 150, event: 70, distance: 120, distanceScale: 1200, rating: 18,
    }),
    sortir: Object.freeze({
      categories: ["event", "studio", "concert", "spectacle", "show", "bar", "cinema", "outing", "culture", "sport", "terrain"],
      exact: ["event", "studio", "concert", "spectacle", "bar", "cinema", "sport"],
      open: 105, event: 185, distance: 85, distanceScale: 2200, rating: 7,
    }),
    famille: Object.freeze({
      categories: ["family", ...FAMILY_CATEGORIES, "parc", "biblio", "musee", "terrain", "sport"],
      exact: ["cinema", "parc", "biblio", "musee", "playground", "park", "library", "museum", "kids_event", "family_event"],
      open: 125, event: 150, distance: 95, distanceScale: 2000, rating: 5,
    }),
    aide: Object.freeze({
      categories: ["help", "alimentaire", "hebergement", "asso", "emploi", "sante", "toilettes", "collecte", "food_aid", "shelter", "association", "employment", "health", "mairie"],
      exact: ["alimentaire", "hebergement", "sante", "emploi", "asso", "collecte"],
      open: 205, event: 85, distance: 105, distanceScale: 2600, rating: 0,
    }),
    services: Object.freeze({
      categories: ["services", "metro", "bus", "velo", "biblio", "coworking", "musee", "parc", "mairie", "ecole", "toilettes", "recharge", "transport", "library", "museum", "park", "education"],
      exact: ["mairie", "toilettes", "recharge", "biblio", "coworking", "metro", "bus", "velo"],
      open: 115, event: 45, distance: 115, distanceScale: 1700, rating: 2,
    }),
  });

  function distanceApprox(aLat, aLng, bLat, bLng) {
    const lat = ((Number(aLat) + Number(bLat)) / 2) * Math.PI / 180;
    const dy = (Number(bLat) - Number(aLat)) * 111000;
    const dx = (Number(bLng) - Number(aLng)) * 111000 * Math.cos(lat);
    return Math.hypot(dx, dy);
  }

  function hasAnyCategory(item, categories) {
    const own = new Set([item.cat, ...(item.categories || [])]);
    return (categories || []).some((category) => own.has(category));
  }

  function dataQuality(item) {
    const values = [
      item.title || item.titre,
      item.address || item.adresse,
      item.description,
      item.openingHours || item.quand,
      item.phone || item.tel,
      item.url,
      item.image,
    ];
    let quality = values.filter((value) => value != null && String(value).trim()).length * 3;
    if (item.verifie) quality += 12;
    if ((item.sources || []).length > 1) quality += 7;
    return quality;
  }

  function travelMinutes(distance) {
    if (!Number.isFinite(distance)) return null;
    return Math.max(1, Math.round(distance / 80));
  }

  function rankResults(results, context) {
    const ctx = context || {};
    const intent = ctx.intent || "sortir";
    const profile = INTENT_PROFILES[intent] || INTENT_PROFILES.sortir;
    const now = Number.isFinite(Number(ctx.now)) ? Number(ctx.now) : Date.now();
    const distanceBetween = typeof ctx.distanceBetween === "function" ? ctx.distanceBetween : distanceApprox;
    const position = Array.isArray(ctx.position) ? ctx.position : [0, 0];
    const categories = Array.isArray(ctx.categories) && ctx.categories.length ? ctx.categories : profile.categories;
    const radius = Number.isFinite(Number(ctx.radius)) ? Number(ctx.radius) : Infinity;
    const deduped = dedupeItems(results || [], distanceBetween);

    return deduped.map((item) => {
      const startsAt = parseTime(item.startsAt != null ? item.startsAt : item.debutLe);
      const endsAt = parseTime(item.endsAt != null ? item.endsAt : item.finLe);
      const temporary = item.isTemporary === true || ["event", "popup", "collecte", "studio", "sport", "food"].includes(item.cat);
      if (temporary && endsAt != null && endsAt < now) return null;
      if (ctx.nowOnly && !isAvailableNow(Object.assign({}, item, {startsAt, endsAt, isTemporary:temporary}), now)) return null;
      if (!hasAnyCategory(item, categories)) return null;

      const latitude = Number(item.latitude != null ? item.latitude : item.lat);
      const longitude = Number(item.longitude != null ? item.longitude : item.lng);
      const distance = distanceBetween(position[0], position[1], latitude, longitude);
      if (!Number.isFinite(distance) || distance > radius) return null;

      const exactMatch = hasAnyCategory(item, profile.exact);
      const intentMatch = exactMatch ? 2 : 1;
      let score = exactMatch ? 145 : 105;
      const quality = dataQuality(item);
      score += quality;
      score += profile.distance * Math.exp(-distance / profile.distanceScale);

      let availability = 2;
      let temporalReason = "";
      if (item.ouvert === true) {
        availability = 4;
        score += profile.open;
      } else if (item.ouvert === false) {
        availability = 0;
        score -= ctx.nowOnly ? 1000 : 155;
      } else {
        score -= 12;
      }

      if (temporary) {
        const inProgress = (startsAt == null || startsAt <= now) && (endsAt == null || endsAt >= now);
        const minutesUntil = startsAt == null ? null : Math.round((startsAt - now) / 60000);
        if (inProgress) {
          availability = 6;
          score += profile.event + 70;
          temporalReason = "En cours";
        } else if (minutesUntil != null && minutesUntil >= 0 && minutesUntil <= 120) {
          availability = 5;
          score += profile.event + Math.max(0, 120 - minutesUntil);
          temporalReason = "Commence dans " + minutesUntil + " min";
        } else if (startsAt != null) {
          availability = Math.max(availability, 1);
          score += Math.max(20, profile.event * .35);
        }
      }

      if (intent === "aide") {
        const urgency = {hebergement:80, sante:78, alimentaire:72, collecte:65, emploi:42, asso:38, mairie:30};
        score += urgency[item.cat] || 20;
        if (item.solidaire) score += 30;
      }
      if (intent === "famille" && hasAnyCategory(item, ["kids_event", "family_event", "playground", "cinema", "park", "library"])) score += 34;
      if (intent === "manger") {
        if (Number.isFinite(Number(item.note))) score += Math.max(0, Number(item.note) - 3) * profile.rating;
        if (item.prix != null || item.gratuit === true) score += 8;
      } else if (Number.isFinite(Number(item.note))) {
        score += Math.max(0, Number(item.note) - 3) * profile.rating;
      }

      const minutes = travelMinutes(distance);
      let rankReason;
      if (temporalReason) rankReason = temporalReason + (minutes != null ? " · " + minutes + " min" : "");
      else if (item.ouvert === true) rankReason = "Ouvert maintenant" + (minutes != null ? " · " + minutes + " min" : "");
      else if (item.ouvert == null) rankReason = "Horaires inconnus" + (minutes != null ? " · " + minutes + " min" : "");
      else rankReason = "Le plus proche" + (minutes != null ? " · " + minutes + " min" : "");

      return Object.assign({}, item, {
        rankScore: Math.round(score * 10) / 10,
        rankReason,
        rankDistance: distance,
        rankBreakdown: {availability, intentMatch, distance, startsAt, quality},
      });
    }).filter(Boolean).sort((a, b) =>
      b.rankBreakdown.availability - a.rankBreakdown.availability ||
      b.rankBreakdown.intentMatch - a.rankBreakdown.intentMatch ||
      a.rankBreakdown.distance - b.rankBreakdown.distance ||
      (a.rankBreakdown.startsAt || Infinity) - (b.rankBreakdown.startsAt || Infinity) ||
      b.rankBreakdown.quality - a.rankBreakdown.quality ||
      b.rankScore - a.rankScore
    );
  }

  root.AutourCore = Object.freeze({
    FAMILY_CATEGORIES,
    normalizeText,
    classifyPlace,
    toCommonItem,
    matchesCategory,
    dedupeItems,
    isAvailableNow,
    INTENT_PROFILES,
    rankResults,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
