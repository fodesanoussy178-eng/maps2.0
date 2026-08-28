(function(root) {
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
    "youth_activity"
  ]);
  const ORDINARY_SCHOOL_TYPES = /* @__PURE__ */ new Set([
    "school",
    "college",
    "secondary school",
    "primary school",
    "kindergarten",
    "childcare",
    "creche"
  ]);
  const CINEMA_WORDS = /\b(cinema|cine|cgr|ugc|kinepolis|pathe|le fresnoy|projection|film|screening|movie)\b/;
  const FAMILY_WORDS = /\b(famille|familial|family|enfant|enfants|jeunesse|jeune public|kids?|children?|atelier|workshop|fete locale|youth)\b/;
  const CINEMA_EVENT_WORDS = /\b(screening|movie|film|projection|seance cinema)\b/;
  const CATEGORY_RELATIONS = Object.freeze({
    cinema: { cinema: 1, outing: 0.9, culture: 0.8, family: 0.65 },
    spectacle: { show: 1, outing: 0.9, culture: 0.85 },
    concert: { concert: 1, outing: 0.9, culture: 0.8 },
    parc: { park: 1, family: 0.85, outing: 0.75, sport: 0.6 },
    terrain: { sport: 1, outing: 0.5 },
    biblio: { library: 1, study: 0.9, culture: 0.75, family: 0.7, services: 0.6 },
    coworking: { coworking: 1, study: 0.9, services: 0.7 },
    musee: { museum: 1, culture: 0.9, outing: 0.8, family: 0.7 },
    asso: { association: 1, help: 0.85 },
    alimentaire: { food_aid: 1, help: 0.95 },
    hebergement: { shelter: 1, help: 0.95 },
    emploi: { employment: 1, help: 0.85, services: 0.7 },
    sante: { health: 1, help: 0.85, services: 0.7 },
    marche: { market: 1, eat: 0.85, outing: 0.7, buy: 0.65 },
    resto: { restaurant: 1, eat: 0.95 },
    fastfood: { restaurant: 1, eat: 0.95 },
    cafe: { cafe: 1, eat: 0.8, study: 0.6 },
    bar: { bar: 1, outing: 0.9 },
    friperie: { buy: 1, outing: 0.5 },
    commerce: { buy: 1 },
    mairie: { services: 1 },
    ecole: { education: 1 },
    metro: { transport: 1, services: 0.7 },
    bus: { transport: 1, services: 0.7 },
    velo: { transport: 1, services: 0.7, sport: 0.5 },
    toilettes: { services: 1 },
    recharge: { services: 1 },
    event: { event: 1, outing: 0.85 },
    popup: { event: 1, outing: 0.85, buy: 0.7 },
    collecte: { event: 1, help: 0.85 },
    studio: { event: 1, culture: 0.8 },
    sport: { sport: 1, event: 0.9 },
    food: { event: 1, eat: 0.9, outing: 0.75 },
    rencontre: { event: 1, outing: 0.85 },
    autre: { event: 1 }
  });
  const DECLARED_WEIGHT = 0.8;
  const TEMPORARY_CATEGORIES = Object.freeze([
    "event",
    "popup",
    "rencontre",
    "sport",
    "collecte",
    "studio",
    "food",
    "autre"
  ]);
  const DISCOVERY_EXCLUDED_CATEGORIES = /* @__PURE__ */ new Set([
    "alimentaire",
    "asso",
    "collecte",
    "commerce",
    "ecole",
    "emploi",
    "hebergement",
    "mairie",
    "recharge",
    "sante",
    "toilettes",
    "metro",
    "bus",
    "tram",
    "train",
    "velo"
  ]);
  function normalizeText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
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
  function addWeights(target, entries, scale) {
    const factor = scale == null ? 1 : Number(scale);
    Object.keys(entries || {}).forEach((key) => {
      if (!key) return;
      const value = Number(entries[key]) * factor;
      if (!Number.isFinite(value) || value <= 0) return;
      if (!(target[key] >= value)) target[key] = value;
    });
  }
  function dropWeights(target, keys) {
    (keys || []).forEach((key) => {
      delete target[key];
    });
  }
  function classifyPlaceWeighted(place) {
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
      tags.event
    ].filter(Boolean).join(" "));
    const weights = {};
    (Array.isArray(p.categories) ? p.categories : []).forEach((category) => {
      if (category) addWeights(weights, { [category]: DECLARED_WEIGHT });
    });
    if (primary) addWeights(weights, { [primary]: 1 });
    addWeights(weights, CATEGORY_RELATIONS[primary]);
    const amenity = normalizeText(tags.amenity);
    const leisure = normalizeText(tags.leisure);
    const tourism = normalizeText(tags.tourism);
    const office = normalizeText(tags.office);
    const socialFacility = normalizeText(tags.social_facility);
    const transportPlace = ["bus", "metro", "velo"].includes(primary) || /\b(bus stop|tram stop|station|subway|bicycle parking|bicycle rental)\b/.test(type);
    if (amenity === "cinema" || leisure === "cinema" || !transportPlace && CINEMA_WORDS.test(text)) {
      addWeights(weights, CATEGORY_RELATIONS.cinema);
    }
    if (amenity === "theatre" || type.includes("theater") || type.includes("theatre")) {
      addWeights(weights, CATEGORY_RELATIONS.spectacle);
      if (!CINEMA_WORDS.test(text)) dropWeights(weights, ["cinema"]);
    }
    if (amenity === "library" || !transportPlace && /\b(bibliotheque|mediatheque|library)\b/.test(text)) {
      addWeights(weights, CATEGORY_RELATIONS.biblio);
    }
    if (leisure === "park" || leisure === "garden" || primary === "parc" || type === "park" || type === "garden") {
      addWeights(weights, CATEGORY_RELATIONS.parc);
    }
    if (leisure === "playground") addWeights(weights, { playground: 1, family: 0.95, park: 0.8, sport: 0.5 });
    if (leisure === "swimming pool") addWeights(weights, { swimming_pool: 1, sport: 0.85, family: 0.8 });
    if (leisure === "bowling alley") addWeights(weights, { bowling_alley: 1, outing: 0.85, family: 0.8, sport: 0.5 });
    if (tourism === "zoo") addWeights(weights, { zoo: 1, family: 0.95, outing: 0.8 });
    if (tourism === "farm" || /\b(ferme pedagogique|educational farm)\b/.test(text)) {
      addWeights(weights, { educational_farm: 1, family: 0.9, outing: 0.7 });
    }
    if (tourism === "museum" || !transportPlace && /\b(musee|museum)\b/.test(text)) {
      addWeights(weights, CATEGORY_RELATIONS.musee);
    }
    if (amenity === "marketplace" || /\b(marche|market)\b/.test(text)) {
      addWeights(weights, CATEGORY_RELATIONS.marche);
    }
    if (amenity === "social centre" || amenity === "community centre" || office === "association" || socialFacility) {
      addWeights(weights, { help: 0.95, association: 1 });
    }
    if (amenity === "social centre" || amenity === "community centre") addWeights(weights, { family: 0.7 });
    const isTemporary = p.isTemporary === true || p.temporaire === true || TEMPORARY_CATEGORIES.includes(primary);
    if (isTemporary) addWeights(weights, { event: 1 });
    if (CINEMA_EVENT_WORDS.test(text)) addWeights(weights, { cinema: 1, event: 0.9, outing: 0.85, culture: 0.8 });
    if (isTemporary && /\b(atelier|workshop)\b/.test(text)) addWeights(weights, { workshop: 1, event: 0.95, family: 0.75 });
    if (isTemporary && /\b(enfant|enfants|kids?|children?|jeune public)\b/.test(text)) addWeights(weights, { kids_event: 1, family: 0.95, event: 0.9 });
    if (isTemporary && /\b(jeunesse|youth|jeunes)\b/.test(text) || normalizeText(tags.club) === "youth") {
      addWeights(weights, { youth_activity: 1, family: 0.85 });
      if (isTemporary) addWeights(weights, { event: 0.9 });
    }
    if (isTemporary && /\b(famille|familial|family|fete locale)\b/.test(text)) addWeights(weights, { family_event: 1, family: 0.95, event: 0.9 });
    const familyRestaurant = [tags.highchair, tags.kids_area, tags.family, tags.changing_table].some((value) => /^(yes|designated)$/i.test(String(value || "")));
    if ((primary === "resto" || primary === "fastfood" || type.includes("restaurant")) && (familyRestaurant || FAMILY_WORDS.test(text))) {
      addWeights(weights, { restaurant: 1, family: familyRestaurant ? 0.8 : 0.65 });
    }
    const accessibleSport = (weights.sport > 0 || primary === "terrain" || primary === "sport") && (/\b(accessible|tout public|all ages|debutant|beginner)\b/.test(text) || /^(yes|designated)$/i.test(String(tags.wheelchair || "")));
    if (accessibleSport) addWeights(weights, { family: 0.7 });
    const ordinarySchool = ORDINARY_SCHOOL_TYPES.has(type) || [tags.amenity, tags.school].some((value) => ORDINARY_SCHOOL_TYPES.has(normalizeText(value))) || /\b(ecole|college|lycee|creche|groupe scolaire|primary school|secondary school|high school)\b/.test(text);
    if (ordinarySchool && !(isTemporary && FAMILY_WORDS.test(text))) {
      dropWeights(weights, ["family", ...FAMILY_CATEGORIES]);
    }
    return weights;
  }
  function sortByWeight(weights) {
    return Object.keys(weights || {}).sort((a, b) => weights[b] - weights[a]);
  }
  function classifyPlace(place) {
    return sortByWeight(classifyPlaceWeighted(place));
  }
  function categoryWeight(item, category) {
    if (!item || !category) return 0;
    const weights = item.categoryWeights;
    let weight = weights ? Number(weights[category]) : 0;
    if (!Number.isFinite(weight)) weight = 0;
    if (item.cat === category) weight = Math.max(weight, 1);
    else if ((item.categories || []).includes(category)) weight = Math.max(weight, DECLARED_WEIGHT);
    return weight;
  }
  function bestCategoryWeight(item, categories) {
    return (categories || []).reduce((best, category) => Math.max(best, categoryWeight(item, category)), 0);
  }
  function toCommonItem(raw, defaults) {
    const source = defaults && defaults.source || raw.source || "unknown";
    const title = raw.title || raw.titre || raw.name || "";
    const latitude = Number(raw.latitude != null ? raw.latitude : raw.lat);
    const longitude = Number(raw.longitude != null ? raw.longitude : raw.lng);
    const startsAt = parseTime(raw.startsAt != null ? raw.startsAt : raw.debutLe != null ? raw.debutLe : raw.debut_le);
    const endsAt = parseTime(raw.endsAt != null ? raw.endsAt : raw.finLe != null ? raw.finLe : raw.fin_le);
    const openingHours = raw.openingHours != null ? raw.openingHours : raw.horaires || raw.quand || null;
    const isTemporary = raw.isTemporary != null ? !!raw.isTemporary : TEMPORARY_CATEGORIES.includes(raw.cat);
    const categoryWeights = classifyPlaceWeighted(Object.assign({}, raw, { title, source, isTemporary }));
    const categories = sortByWeight(categoryWeights);
    return Object.assign({}, raw, {
      categoryWeights,
      id: String(raw.id),
      source,
      sources: unique([...raw.sources || [], source]),
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
      imageSource: raw.imageSource || "",
      sourceRefs: Object.assign(
        {},
        raw.sourceRefs || {},
        raw.idGoogle ? { googlePlaceId: raw.idGoogle } : {},
        raw.idOsm ? { osmId: raw.idOsm } : {},
        raw.idDatatourisme ? { datatourismeId: raw.idDatatourisme } : {},
        raw.siret ? { siret: String(raw.siret) } : {},
        raw.siren ? { siren: String(raw.siren) } : {}
      ),
      titre: title,
      lat: latitude,
      lng: longitude,
      debutLe: startsAt,
      finLe: endsAt
    });
  }
  function matchesCategory(item, category) {
    if (!item || !category) return false;
    return item.cat === category || (item.categories || []).includes(category);
  }
  const SOURCE_RANK = Object.freeze({
    contexte_officiel: 7,
    institutionnel: 6,
    service_public: 6,
    organisateur: 5,
    autour: 4,
    google_places: 3,
    openagenda: 2,
    datatourisme: 2,
    openstreetmap: 1
  });
  function fiabiliteHoraires(item) {
    if (!item) return 0;
    if (Array.isArray(item.horaires) && item.horaires.length) return 2;
    const brut = item.openingHours || item.quand;
    if (brut && String(brut).trim() && !/^voir sur place$/i.test(String(brut).trim())) return 2;
    if (item.ouvert === true || item.ouvert === false) return 1;
    return 0;
  }
  function scoreRepresentant(item) {
    const pertinence = Number(item && item.rankScore);
    const misAJour = Date.parse(item && (item.updatedAt || item.updated_at || item.majLe || item.last_synced_at || ""));
    const fraicheur = Number.isFinite(misAJour) ? Math.floor(misAJour / 1e6) : 0;
    return (estSansNom(item) ? 0 : 1e5) + (SOURCE_RANK[item && item.source] || 0) * 1e9 + fraicheur + dataQuality(item) * 10 + fiabiliteHoraires(item) * 5 + (Number.isFinite(pertinence) ? Math.min(4, Math.max(0, pertinence) / 100) : 0);
  }
  function mergeDuplicate(left, right) {
    const merged = Object.assign({}, left);
    const preferred = scoreRepresentant(right) > scoreRepresentant(left) ? right : left;
    const fallback = preferred === right ? left : right;
    Object.assign(merged, fallback, preferred);
    const categoryWeights = {};
    [left, right].forEach((side) => {
      if (side.categoryWeights) addWeights(categoryWeights, side.categoryWeights);
      (side.categories || []).forEach((category) => addWeights(categoryWeights, { [category]: DECLARED_WEIGHT }));
      if (side.cat) addWeights(categoryWeights, { [side.cat]: 1 });
    });
    merged.categoryWeights = categoryWeights;
    merged.categories = sortByWeight(categoryWeights);
    merged.sources = unique([...left.sources || [left.source], ...right.sources || [right.source]]);
    merged.sourceRefs = Object.assign({}, fallback.sourceRefs || {}, preferred.sourceRefs || {});
    const conflits = [...left.sourceConflicts || [], ...right.sourceConflicts || []];
    const champsIdentite = [
      "title",
      "titre",
      "address",
      "adresse",
      "url",
      "tel",
      "officialName"
    ];
    champsIdentite.forEach((field) => {
      const gauche = left[field], droit = right[field];
      if (gauche == null || gauche === "" || droit == null || droit === "") return;
      if (JSON.stringify(gauche) === JSON.stringify(droit)) return;
      conflits.push({
        field,
        values: [gauche, droit],
        sources: [left.source || "unknown", right.source || "unknown"]
      });
    });
    const refsGauche = left.sourceRefs || {}, refsDroit = right.sourceRefs || {};
    Object.keys(refsGauche).forEach((field) => {
      if (refsDroit[field] == null || String(refsGauche[field]) === String(refsDroit[field])) return;
      conflits.push({
        field: "sourceRefs." + field,
        values: [refsGauche[field], refsDroit[field]],
        sources: [left.source || "unknown", right.source || "unknown"]
      });
    });
    merged.sourceConflicts = conflits.filter((entry, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(entry)) === index);
    merged.aliases = unique([...left.aliases || [], ...right.aliases || []]);
    merged.provenance = [...left.provenance || [], ...right.provenance || []].filter((entry, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(entry)) === index);
    merged.source = preferred.source || fallback.source;
    const nomme = !estSansNom(preferred) ? preferred : !estSansNom(fallback) ? fallback : null;
    if (nomme) {
      merged.title = nomme.title || nomme.titre;
      merged.titre = merged.title;
      merged.sansNom = false;
    } else {
      merged.sansNom = true;
    }
    merged.description = preferred.description || fallback.description || "";
    merged.url = preferred.url || fallback.url || "";
    merged.image = preferred.image || fallback.image || "";
    merged.imageSource = preferred.image ? preferred.imageSource || fallback.imageSource || "" : fallback.imageSource || "";
    merged.imageAttribution = preferred.image ? preferred.imageAttribution || fallback.imageAttribution || "" : fallback.imageAttribution || "";
    const renseigne = (value) => {
      if (value == null || value === "") return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    };
    [
      "note",
      "avis",
      "rating",
      "userRatingCount",
      "ouvert",
      "prixN",
      "prix",
      "horaires",
      "openingHours",
      "tel",
      "pmr",
      "idGoogle",
      "resumeGoogle",
      "descriptionSource"
    ].forEach((field) => {
      merged[field] = renseigne(preferred[field]) ? preferred[field] : fallback[field];
    });
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
    return !!left && !!right && (left === right || left.length > 7 && right.length > 7 && (left.includes(right) || right.includes(left)));
  }
  function distanceEdition(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= right.length; j += 1) {
        const before = previous[j];
        previous[j] = Math.min(
          previous[j] + 1,
          previous[j - 1] + 1,
          diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
        );
        diagonal = before;
      }
    }
    return previous[right.length];
  }
  function titlesNearlySame(a, b) {
    const clean = (value) => normalizeText(value).replace(/\b(le|la|les|l|the)\b/g, " ").replace(/\s+/g, " ").trim();
    const left = clean(a), right = clean(b);
    const firstLeft = left.split(" ")[0] || "", firstRight = right.split(" ")[0] || "";
    if (firstLeft.length < 4 || firstLeft !== firstRight) return false;
    const compactLeft = left.replace(/\s/g, ""), compactRight = right.replace(/\s/g, "");
    const short = compactLeft.length <= compactRight.length ? compactLeft : compactRight;
    const long = short === compactLeft ? compactRight : compactLeft;
    if (short.length < 12) return false;
    const compared = long.slice(0, short.length);
    return 1 - distanceEdition(short, compared) / short.length >= 0.9;
  }
  const NAME_ARTICLES = /\b(le|la|les|l|un|une|des|du|de|d|au|aux|the|a)\b/g;
  const NAME_VARIANTS = Object.freeze([
    [/\bst\b/g, "saint"],
    [/\bste\b/g, "sainte"],
    [/\bsts\b/g, "saints"],
    [/\bmt\b/g, "mont"],
    [/\bnd\b/g, "notre dame"],
    [/\bpl\b/g, "place"],
    [/\bav\b/g, "avenue"],
    [/\bbd\b/g, "boulevard"],
    [/\bmr\b/g, "monsieur"],
    [/\bet\b/g, " "],
    [/\band\b/g, " "]
  ]);
  function singulierApproche(word) {
    if (word.length <= 4) return word;
    if (/[sx]$/.test(word)) return word.slice(0, -1);
    return word;
  }
  function normaliserNomLieu(value) {
    let text = normalizeText(value);
    if (!text) return "";
    NAME_VARIANTS.forEach((paire) => {
      text = text.replace(paire[0], paire[1]);
    });
    text = text.replace(NAME_ARTICLES, " ").replace(/\s+/g, " ").trim();
    return text.split(" ").map(singulierApproche).filter(Boolean).join(" ");
  }
  const ADDRESS_ROLES = /\b(rue|r|avenue|av|boulevard|bd|place|pl|chemin|ch|impasse|allee|route|rte|quai|square|cours|voie|passage|residence|batiment|bat|bis|ter)\b/g;
  function normaliserAdresse(value) {
    const text = normalizeText(value).replace(ADDRESS_ROLES, " ").replace(NAME_ARTICLES, " ").replace(/\s+/g, " ").trim();
    return text.split(" ").map(singulierApproche).filter(Boolean).join(" ");
  }
  function estSansNom(item) {
    if (!item) return true;
    if (item.sansNom === true) return true;
    const titre = String(item.title || item.titre || "").trim();
    return titre.length < 2;
  }
  function adresseComparable(item) {
    if (!item) return "";
    const adresse = normaliserAdresse(item.adresse || item.address || item.addr);
    if (!adresse) return "";
    if (adresse === normaliserNomLieu(item.title || item.titre)) return "";
    if (!/\d/.test(adresse) && adresse.split(" ").length < 2) return "";
    return adresse;
  }
  function identifiantsExternes(item) {
    const refs = /* @__PURE__ */ new Set();
    if (!item) return refs;
    const declares = item.sourceRefs || {};
    Object.keys(declares).forEach((cle) => {
      if (declares[cle] != null && declares[cle] !== "") refs.add(cle + ":" + String(declares[cle]));
    });
    if (item.idGoogle) refs.add("googlePlaceId:" + item.idGoogle);
    if (item.idOsm) refs.add("osmId:" + item.idOsm);
    if (item.idDatatourisme) refs.add("datatourismeId:" + item.idDatatourisme);
    if (item.dbId != null && item.dbId !== "") refs.add("dbId:" + String(item.dbId));
    return refs;
  }
  function memeIdentifiantExterne(a, b) {
    const gauche = identifiantsExternes(a);
    if (!gauche.size) return false;
    const droit = identifiantsExternes(b);
    if (!droit.size) return false;
    for (const ref of gauche) if (droit.has(ref)) return true;
    return false;
  }
  function siteComparable(item) {
    const brut = item && (item.officialSite || item.website || item.url || item.site);
    if (!brut) return "";
    try {
      const url = new URL(/^https?:\/\//i.test(String(brut)) ? String(brut) : "https://" + String(brut));
      return (url.hostname || "").toLowerCase().replace(/^www\./, "") + (url.pathname || "").replace(/\/+$/, "").toLowerCase();
    } catch (e) {
      return String(brut).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    }
  }
  function telephoneComparable(item) {
    const brut = item && (item.tel || item.phone || item.telephone);
    const chiffres = String(brut || "").replace(/\D/g, "");
    if (!chiffres) return "";
    return chiffres.replace(/^0033/, "0").replace(/^33(?=\d{9}$)/, "0");
  }
  function aliasCompatible(a, b) {
    const gauche = [a && (a.title || a.titre), ...a && a.aliases || []].map(normaliserNomLieu).filter((x) => x && x.length >= 5);
    const droit = [b && (b.title || b.titre), ...b && b.aliases || []].map(normaliserNomLieu).filter((x) => x && x.length >= 5);
    return gauche.some((x) => droit.some((y) => x === y || x.length >= 12 && y.length >= 12 && (x.includes(y) || y.includes(x))));
  }
  function sourceAutoritative(item) {
    return [item && item.source, ...item && item.sources || []].some((s) => [
      "service_public",
      "institutionnel",
      "data_gouv",
      "contexte_officiel"
    ].includes(String(s || "").toLowerCase()));
  }
  function memeIdentiteDocumentee(a, b, distanceBetween) {
    if (!a || !b || a.isTemporary || b.isTemporary) return false;
    const distance = distanceBetween(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude
    );
    if (!Number.isFinite(distance) || distance > 500) return false;
    const siteGauche = siteComparable(a), siteDroit = siteComparable(b);
    if (siteGauche && siteGauche === siteDroit && (sourceAutoritative(a) || sourceAutoritative(b) || aliasCompatible(a, b))) return true;
    const telGauche = telephoneComparable(a), telDroit = telephoneComparable(b);
    if (telGauche && telGauche === telDroit && distance <= 180 && (sourceAutoritative(a) || sourceAutoritative(b) || aliasCompatible(a, b))) return true;
    return estTransportItem(a) === estTransportItem(b) && sameCategory(a, b) && distance <= 80 && aliasCompatible(a, b);
  }
  const SPREAD_CATEGORIES = Object.freeze([
    "parc",
    "park",
    "terrain",
    "sport",
    "marche",
    "swimming_pool",
    "cimetiere",
    "plage",
    "foret"
  ]);
  const DEDUP_RADIUS = Object.freeze({
    nomme: 120,
    // deux relevés du même commerce
    nommeEtendu: 400,
    // deux morceaux du même parc
    typo: 180,
    // faute de frappe entre fournisseurs
    adresse: 60,
    // noms différents, même adresse exacte
    sansNomEtendu: 500,
    // les morceaux anonymes d'un même parc
    sansNom: 90
    // ailleurs, deux objets anonymes voisins
  });
  function estEtendu(item) {
    return [item.cat, ...item.categories || []].some((category) => SPREAD_CATEGORIES.includes(category));
  }
  function estTransportItem(item) {
    return [item.cat, ...item.categories || []].some((category) => TRANSPORT_CATEGORIES.includes(category));
  }
  function rayonSansNom(a, b) {
    if (estEtendu(a) || estEtendu(b)) return DEDUP_RADIUS.sansNomEtendu;
    return DEDUP_RADIUS.sansNom;
  }
  function sameCategory(a, b) {
    const left = unique([a && a.cat, ...a && a.categories || []]);
    const right = new Set(unique([b && b.cat, ...b && b.categories || []]));
    if (left.some((category) => right.has(category))) return true;
    const restauration = /* @__PURE__ */ new Set(["resto", "fastfood", "cafe", "bar"]);
    return left.some((category) => restauration.has(category)) && [...right].some((category) => restauration.has(category));
  }
  function memeFenetre(existing, item) {
    if (!item.isTemporary) return true;
    if (existing.startsAt == null || item.startsAt == null) return true;
    return Math.abs(existing.startsAt - item.startsAt) <= 3 * 3600 * 1e3;
  }
  function memeEnregistrement(existing, item, distanceBetween) {
    if (!!existing.isTemporary !== !!item.isTemporary) return false;
    if (existing.id != null && item.id != null && String(existing.id) === String(item.id)) return true;
    if (memeIdentifiantExterne(existing, item)) return true;
    if (memeIdentiteDocumentee(existing, item, distanceBetween)) return true;
    if (estTransportItem(existing) !== estTransportItem(item)) return false;
    if (!sameCategory(existing, item)) return false;
    const distance = distanceBetween(
      existing.latitude,
      existing.longitude,
      item.latitude,
      item.longitude
    );
    if (!Number.isFinite(distance)) return false;
    const anonymeGauche = estSansNom(existing);
    const anonymeDroit = estSansNom(item);
    if (anonymeGauche && anonymeDroit) {
      if (distance > rayonSansNom(existing, item)) return false;
      return memeFenetre(existing, item);
    }
    if (anonymeGauche !== anonymeDroit) return false;
    const titreGauche = existing.title || existing.titre;
    const titreDroit = item.title || item.titre;
    const nomGauche = normaliserNomLieu(titreGauche);
    const memeNom = !!nomGauche && nomGauche === normaliserNomLieu(titreDroit);
    const sameName = memeNom || sameTitle(titreGauche, titreDroit);
    const typoCrossProvider = !sameName && existing.source !== item.source && titlesNearlySame(titreGauche, titreDroit);
    if (!sameName && !typoCrossProvider) {
      const adresse = adresseComparable(existing);
      if (!adresse || adresse !== adresseComparable(item)) return false;
      if (distance > DEDUP_RADIUS.adresse) return false;
      return memeFenetre(existing, item);
    }
    const limite = typoCrossProvider ? DEDUP_RADIUS.typo : estEtendu(existing) || estEtendu(item) ? DEDUP_RADIUS.nommeEtendu : DEDUP_RADIUS.nomme;
    if (distance > limite) return false;
    return memeFenetre(existing, item);
  }
  function dedupeItems(items, distanceBetween) {
    const result = [];
    const pas = 4e-3;
    const grille = /* @__PURE__ */ new Map();
    const parId = /* @__PURE__ */ new Map();
    const parRef = /* @__PURE__ */ new Map();
    const cellule = (item) => {
      const lat = Number(item && item.latitude);
      const lng = Number(item && item.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [Math.floor(lat / pas), Math.floor(lng / pas)] : null;
    };
    const enregistrer = (item, index) => {
      if (item && item.id != null) parId.set(String(item.id), index);
      identifiantsExternes(item).forEach((ref) => parRef.set(ref, index));
      const c = cellule(item);
      if (!c) return;
      const cle = c[0] + ":" + c[1];
      if (!grille.has(cle)) grille.set(cle, /* @__PURE__ */ new Set());
      grille.get(cle).add(index);
    };
    const candidats = (item) => {
      const indices = /* @__PURE__ */ new Set();
      if (item && item.id != null && parId.has(String(item.id)))
        indices.add(parId.get(String(item.id)));
      identifiantsExternes(item).forEach((ref) => {
        if (parRef.has(ref)) indices.add(parRef.get(ref));
      });
      const c = cellule(item);
      if (!c) return [...indices].sort((a, b) => a - b);
      for (let x = c[0] - 2; x <= c[0] + 2; x += 1) {
        for (let y = c[1] - 2; y <= c[1] + 2; y += 1) {
          const proches = grille.get(x + ":" + y);
          if (proches) proches.forEach((index) => indices.add(index));
        }
      }
      return [...indices].sort((a, b) => a - b);
    };
    (items || []).forEach((item) => {
      const found = candidats(item).find((index) => memeEnregistrement(result[index], item, distanceBetween));
      if (found === void 0) {
        const index = result.length;
        result.push(item);
        enregistrer(item, index);
      } else {
        result[found] = mergeDuplicate(result[found], item);
        enregistrer(result[found], found);
      }
    });
    return result;
  }
  const TRANSPORT_CATEGORIES = Object.freeze(["metro", "bus", "tram", "train", "velo"]);
  const TRANSPORT_ROLE_WORDS = /\b(gare|station|arret|halte|metro|tram|tramway|bus|autobus|quai|voie|acces|entree|sortie|bouche|platform|stop|parking velo|velo|station velo)\b/g;
  const NAME_NOISE = /\b(le|la|les|l|du|de|des|d|the|saint|st)\b/g;
  function normalizePlaceName(value, family) {
    let text = normalizeText(value);
    if (family === "transport") {
      text = text.replace(TRANSPORT_ROLE_WORDS, " ");
      text = text.replace(/\b\d+\b/g, " ").replace(/\bdirection\b.*$/, " ");
    }
    return text.replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim();
  }
  function placeFamily(item) {
    if (!item) return "autre";
    const categories = [item.cat, ...item.categories || []];
    if (categories.some((category) => TRANSPORT_CATEGORIES.includes(category))) return "transport";
    return "autre";
  }
  const GROUPING_RADIUS = Object.freeze({
    transport: { exact: 350, inclus: 300 },
    autre: { exact: 200, inclus: 120 }
  });
  function nameRelation(left, right) {
    if (!left || !right) return null;
    if (left === right) return "exact";
    const short = left.length <= right.length ? left : right;
    const long = short === left ? right : left;
    return short.length >= 5 && long.indexOf(short) !== -1 ? "inclus" : null;
  }
  const FAMILY_RANK = Object.freeze({ train: 5, metro: 4, tram: 3, bus: 2, velo: 1 });
  function representativeScore(item) {
    let score = FAMILY_RANK[item.cat] || 0;
    if (normalizeText(item.title || item.titre)) score += 10;
    if (item.openingHours) score += 2;
    if (item.rating || item.note) score += 2;
    if (Number.isFinite(Number(item.reviewCount || item.avis))) score += 1;
    return score;
  }
  function groupLogicalPlaces(items, distanceBetween, options) {
    const settings = options || {};
    const radii = Object.assign({}, GROUPING_RADIUS, settings.radius);
    const groups = [];
    const pas = 3e-3;
    const grille = /* @__PURE__ */ new Map();
    const cellule = (item) => {
      const lat = Number(item && item.latitude);
      const lng = Number(item && item.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [Math.floor(lat / pas), Math.floor(lng / pas)] : null;
    };
    const enregistrer = (item, index) => {
      const c = cellule(item);
      if (!c) return;
      const cle = c[0] + ":" + c[1];
      if (!grille.has(cle)) grille.set(cle, /* @__PURE__ */ new Set());
      grille.get(cle).add(index);
    };
    const candidats = (item) => {
      const c = cellule(item);
      if (!c) return groups.map((_, index) => index);
      const indices = /* @__PURE__ */ new Set();
      for (let x = c[0] - 2; x <= c[0] + 2; x += 1) {
        for (let y = c[1] - 2; y <= c[1] + 2; y += 1) {
          const proches = grille.get(x + ":" + y);
          if (proches) proches.forEach((index) => indices.add(index));
        }
      }
      return [...indices].sort((a, b) => a - b);
    };
    (items || []).forEach((item) => {
      if (item.isTemporary) {
        groups.push({ members: [item], family: "evenement" });
        return;
      }
      const family = placeFamily(item);
      const name = normalizePlaceName(item.title || item.titre, family);
      if (!name) {
        groups.push({ members: [item], family, name });
        enregistrer(item, groups.length - 1);
        return;
      }
      const radius = radii[family] || radii.autre;
      const foundIndex = candidats(item).find((index) => {
        const group = groups[index];
        if (group.family !== family || !group.name) return false;
        const relation = nameRelation(group.name, name);
        if (!relation) return false;
        const limit = radius[relation];
        return group.members.some((member) => {
          const distance = distanceBetween(member.latitude, member.longitude, item.latitude, item.longitude);
          return Number.isFinite(distance) && distance <= limit;
        });
      });
      if (foundIndex !== void 0) {
        groups[foundIndex].members.push(item);
        enregistrer(item, foundIndex);
      } else {
        groups.push({ members: [item], family, name });
        enregistrer(item, groups.length - 1);
      }
    });
    return groups.map((group) => {
      if (group.members.length === 1) return group.members[0];
      const best = group.members.slice().sort((a, b) => representativeScore(b) - representativeScore(a))[0];
      const categoryWeights = {};
      group.members.forEach((member) => {
        if (member.categoryWeights) addWeights(categoryWeights, member.categoryWeights);
        (member.categories || []).forEach((category) => addWeights(categoryWeights, { [category]: DECLARED_WEIGHT }));
        if (member.cat) addWeights(categoryWeights, { [member.cat]: 1 });
      });
      return Object.assign({}, best, {
        categoryWeights,
        categories: sortByWeight(categoryWeights),
        // ce qui a été replié reste joignable : l'itinéraire vers un pôle
        // doit pouvoir viser la bouche de métro exacte, pas le barycentre
        regroupes: group.members.filter((member) => member !== best),
        nbRegroupes: group.members.length
      });
    });
  }
  const PREPOSITIONS = /\s+(?:a|à|au|aux|sur|vers|dans|en|pres de|près de|autour de)\s+/i;
  const LEADING_PREPOSITION = /^(?:a|à|au|aux|sur|vers|dans|en|pres de|près de|autour de)\s+/i;
  const TRAILING_PREPOSITION = /\s+(?:a|à|au|aux|sur|vers|dans|en|de|du|des)$/i;
  function parseSearchQuery(query, options) {
    const settings = options || {};
    const isIntent = typeof settings.isIntent === "function" ? settings.isIntent : () => false;
    const isWholeIntent = typeof settings.isWholeIntent === "function" ? settings.isWholeIntent : isIntent;
    const isDestination = typeof settings.isDestination === "function" ? settings.isDestination : () => true;
    const raw = String(query || "").trim().replace(/\s+/g, " ");
    if (!raw) return { intention: "", destination: "", raw };
    const words = raw.split(" ");
    const propre = (t, motif) => t.replace(motif, "").trim();
    for (let cut = words.length - 1; cut >= 1; cut -= 1) {
      const head = propre(words.slice(0, cut).join(" "), TRAILING_PREPOSITION);
      const tail = propre(words.slice(cut).join(" "), LEADING_PREPOSITION);
      if (!head || !tail) continue;
      if (isIntent(head) && isDestination(tail)) return { intention: head, destination: tail, raw };
    }
    for (let cut = 1; cut < words.length; cut += 1) {
      const head = propre(words.slice(0, cut).join(" "), TRAILING_PREPOSITION);
      const tail = propre(words.slice(cut).join(" "), LEADING_PREPOSITION);
      if (!head || !tail) continue;
      if (isDestination(head) && isIntent(tail)) return { intention: tail, destination: head, raw };
    }
    const byPreposition = raw.split(PREPOSITIONS);
    if (byPreposition.length === 2 && byPreposition[0].trim() && byPreposition[1].trim() && isDestination(byPreposition[1].trim())) {
      return { intention: byPreposition[0].trim(), destination: byPreposition[1].trim(), raw };
    }
    if (isWholeIntent(raw)) return { intention: raw, destination: "", raw };
    if (words.length > 1 && isWholeIntent(words[0])) return { intention: raw, destination: "", raw };
    return { intention: "", destination: raw, raw };
  }
  const disponibiliteMemo = /* @__PURE__ */ new WeakMap();
  function disponibiliteDe(item, at, arrival) {
    const module = root.AutourAvailability;
    if (!module) return null;
    if (!item || typeof item !== "object" && typeof item !== "function")
      return module.getPlaceAvailability(item, at, arrival);
    let cache = disponibiliteMemo.get(item);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      disponibiliteMemo.set(item, cache);
    }
    const temporaire = item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat);
    const cleTemps = temporaire ? Number(at) : Math.floor(Number(at) / 6e4);
    const cleArrivee = arrival == null ? "" : temporaire ? Number(arrival) : Math.floor(Number(arrival) / 6e4);
    const cle = cleTemps + "|" + cleArrivee;
    if (cache.has(cle)) return cache.get(cle);
    const resultat = module.getPlaceAvailability(item, at, arrival);
    if (cache.size >= 4) cache.clear();
    cache.set(cle, resultat);
    return resultat;
  }
  function isAvailableNow(item, at) {
    const now = at == null ? Date.now() : Number(at);
    const temps = root.AutourTemps;
    if (temps) {
      const etat = temps.statutTemporel(item, now, { disponibilite: disponibiliteDe });
      if (item.isTemporary) return temps.estMaintenant(etat.statut);
      if (etat.statut === temps.STATUTS.INCONNU) return item.ouvert !== false;
      return temps.estMaintenant(etat.statut);
    }
    if (item.isTemporary) {
      if (item.startsAt == null) return false;
      if (item.endsAt != null && item.endsAt < now) return false;
      return item.startsAt <= now + 2 * 3600 * 1e3;
    }
    const dispo = disponibiliteDe(item, now);
    if (dispo && dispo.status === "permanently_closed") return false;
    if (dispo && dispo.status !== "unknown") return dispo.isOpenNow;
    return item.ouvert !== false;
  }
  const INTENT_PROFILES = Object.freeze({
    manger: Object.freeze({
      categories: ["resto", "fastfood", "cafe", "marche", "food", "restaurant", "eat"],
      exact: ["resto", "fastfood", "cafe", "marche", "food"],
      open: 150,
      event: 70,
      distance: 120,
      distanceScale: 1200,
      rating: 18
    }),
    sortir: Object.freeze({
      categories: ["event", "studio", "concert", "spectacle", "show", "bar", "cinema", "outing", "culture", "sport", "terrain"],
      exact: ["event", "studio", "concert", "spectacle", "bar", "cinema", "sport"],
      open: 105,
      event: 185,
      distance: 85,
      distanceScale: 2200,
      rating: 7
    }),
    /* L'accueil n'est ni une recherche Manger ni une recherche Sortir : il
       doit faire remonter ce qui mérite un détour dans l'immédiat. Les
       événements, activités, culture et marchés reçoivent donc une vraie
       correspondance exacte ; un simple commerce ne peut les devancer. */
    explorer: Object.freeze({
      categories: [
        "event",
        "studio",
        "concert",
        "spectacle",
        "show",
        "bar",
        "cinema",
        "musee",
        "museum",
        "culture",
        "marche",
        "food",
        "sport",
        "terrain",
        "swimming_pool",
        "parc",
        "park",
        "resto",
        "fastfood",
        "cafe"
      ],
      exact: [
        "event",
        "studio",
        "concert",
        "spectacle",
        "bar",
        "cinema",
        "musee",
        "museum",
        "culture",
        "marche",
        "food",
        "sport",
        "terrain",
        "swimming_pool"
      ],
      open: 115,
      event: 205,
      distance: 88,
      distanceScale: 2200,
      rating: 8
    }),
    famille: Object.freeze({
      categories: ["family", ...FAMILY_CATEGORIES, "parc", "biblio", "musee", "terrain", "sport"],
      exact: ["cinema", "parc", "biblio", "musee", "playground", "park", "library", "museum", "kids_event", "family_event"],
      open: 125,
      event: 150,
      distance: 95,
      distanceScale: 2e3,
      rating: 5
    }),
    aide: Object.freeze({
      categories: ["help", "alimentaire", "hebergement", "asso", "emploi", "sante", "toilettes", "collecte", "food_aid", "shelter", "association", "employment", "health", "mairie"],
      exact: ["alimentaire", "hebergement", "sante", "emploi", "asso", "collecte"],
      open: 205,
      event: 85,
      distance: 105,
      distanceScale: 2600,
      rating: 0
    }),
    // besoins secondaires : ils vivent derrière « Plus » dans l'interface,
    // mais ils ont besoin d'un profil propre pour être classés correctement
    etudier: Object.freeze({
      categories: ["study", "biblio", "library", "coworking", "cafe", "services"],
      exact: ["biblio", "library", "coworking", "study"],
      open: 190,
      event: 40,
      distance: 110,
      distanceScale: 1800,
      rating: 4
    }),
    culture: Object.freeze({
      categories: ["culture", "musee", "museum", "cinema", "spectacle", "show", "concert", "studio", "biblio", "library"],
      exact: ["musee", "museum", "cinema", "spectacle", "concert", "culture"],
      open: 115,
      event: 170,
      distance: 80,
      distanceScale: 2400,
      rating: 8
    }),
    // « Bouger » remplace l'ancien besoin « Sport » : même intention, un mot
    // qu'on emploie vraiment. L'ancien identifiant reste accepté.
    bouger: Object.freeze({
      categories: ["sport", "terrain", "swimming_pool", "velo", "park", "parc"],
      exact: ["sport", "terrain", "swimming_pool"],
      open: 140,
      event: 130,
      distance: 100,
      distanceScale: 2e3,
      rating: 5
    }),
    sport: Object.freeze({
      categories: ["sport", "terrain", "swimming_pool", "velo", "park", "parc"],
      exact: ["sport", "terrain", "swimming_pool"],
      open: 140,
      event: 130,
      distance: 100,
      distanceScale: 2e3,
      rating: 5
    }),
    // « Chiller » : s'asseoir quelque part sans but précis. L'ouverture compte
    // plus que la note, et la proximité plus que tout.
    chiller: Object.freeze({
      categories: ["cafe", "bar", "parc", "park", "biblio", "library", "outing"],
      exact: ["cafe", "parc", "park", "biblio", "library"],
      open: 175,
      event: 45,
      distance: 135,
      distanceScale: 1400,
      rating: 6
    }),
    services: Object.freeze({
      categories: ["services", "metro", "bus", "velo", "biblio", "coworking", "musee", "parc", "mairie", "ecole", "toilettes", "recharge", "transport", "library", "museum", "park", "education"],
      exact: ["mairie", "toilettes", "recharge", "biblio", "coworking", "metro", "bus", "velo"],
      open: 115,
      event: 45,
      distance: 115,
      distanceScale: 1700,
      rating: 2
    })
  });
  function distanceApprox(aLat, aLng, bLat, bLng) {
    const lat = (Number(aLat) + Number(bLat)) / 2 * Math.PI / 180;
    const dy = (Number(bLat) - Number(aLat)) * 111e3;
    const dx = (Number(bLng) - Number(aLng)) * 111e3 * Math.cos(lat);
    return Math.hypot(dx, dy);
  }
  function hasAnyCategory(item, categories) {
    const own = /* @__PURE__ */ new Set([item.cat, ...item.categories || []]);
    return (categories || []).some((category) => own.has(category));
  }
  function isDiscoveryCandidate(item) {
    if (!item) return false;
    if (item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat)) return true;
    return ![item.cat, ...item.categories || []].some((category) => DISCOVERY_EXCLUDED_CATEGORIES.has(category));
  }
  function dataQuality(item) {
    const values = [
      item.title || item.titre,
      item.address || item.adresse,
      item.description,
      item.openingHours || item.quand,
      item.phone || item.tel,
      item.url,
      item.image
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
  const ARRIVAL_GRACE_MS = 15 * 6e4;
  const EVENT_DEPARTURE_WINDOW_MS = 2 * 3600 * 1e3;
  function walkingEta(distance) {
    const minutes = travelMinutes(distance);
    if (minutes == null) return null;
    return Object.freeze({
      minutes,
      walkMinutes: minutes,
      waitMinutes: 0,
      rideMinutes: 0,
      transfers: 0,
      mode: "walk",
      realtime: false,
      confidence: "estimated"
    });
  }
  function resolveEta(ctx, item, distance) {
    const provided = typeof ctx.etaFor === "function" ? ctx.etaFor(item, distance) : null;
    if (provided && Number.isFinite(Number(provided.minutes))) {
      return Object.assign({
        walkMinutes: null,
        waitMinutes: null,
        rideMinutes: null,
        transfers: 0,
        mode: "transit",
        realtime: false,
        confidence: "planned"
      }, provided, { minutes: Number(provided.minutes) });
    }
    return walkingEta(distance);
  }
  function closingTime(item) {
    return parseTime(item.closesAt != null ? item.closesAt : item.fermeA != null ? item.fermeA : item.closingAt);
  }
  function arrivalOutlook(item, arrival, temporary, startsAt, endsAt, now) {
    if (arrival == null) return { state: "unknown", score: 0, reason: "" };
    if (temporary) {
      if (endsAt != null && endsAt <= arrival) {
        return { state: "missed", score: -1e3, reason: "Termin\xE9 avant votre arriv\xE9e" };
      }
      if (startsAt == null || now != null && startsAt <= now) return { state: "open", score: 0, reason: "" };
      if (arrival <= startsAt) {
        if (now != null && startsAt - now > EVENT_DEPARTURE_WINDOW_MS)
          return { state: "scheduled", score: 0, reason: "" };
        const early = Math.round((startsAt - arrival) / 6e4);
        return {
          state: "onTime",
          score: 60,
          reason: early <= 5 ? "Vous arrivez juste \xE0 temps" : "Vous y \xEAtes " + early + " min avant le d\xE9but"
        };
      }
      const late = Math.round((arrival - startsAt) / 6e4);
      if (arrival - startsAt <= ARRIVAL_GRACE_MS) {
        return { state: "late", score: 15, reason: "Commenc\xE9, vous arrivez " + late + " min apr\xE8s" };
      }
      return { state: "tooLate", score: -260, reason: "D\xE9j\xE0 commenc\xE9 depuis " + late + " min" };
    }
    const dispo = disponibiliteDe(item, now, arrival);
    if (dispo && dispo.status === "permanently_closed") {
      return { state: "permanentlyClosed", score: -1e5, reason: dispo.label, dispo };
    }
    if (dispo && dispo.status !== "unknown") {
      if (dispo.isOpenAtArrival === false) {
        return { state: "closedOnArrival", score: -1e3, reason: "Ferm\xE9 \xE0 votre arriv\xE9e", dispo };
      }
      if (!dispo.isOpenNow) {
        return { state: "closedNow", score: -400, reason: dispo.label, dispo };
      }
      if (dispo.meetsMargin === false) {
        return { state: "closingSoon", score: -220, reason: dispo.reason || dispo.label, dispo };
      }
      if (dispo.status === "closing_soon") {
        return { state: "closingSoon", score: -120, reason: dispo.reason || dispo.label, dispo };
      }
      return { state: "open", score: 0, reason: dispo.label, dispo };
    }
    const closes = closingTime(item);
    if (closes != null && closes <= arrival) {
      return { state: "closedOnArrival", score: -1e3, reason: "Ferm\xE9 \xE0 votre arriv\xE9e", dispo };
    }
    if (closes != null && closes - arrival <= 30 * 6e4) {
      const left = Math.round((closes - arrival) / 6e4);
      return { state: "closingSoon", score: -60, reason: "Ferme " + left + " min apr\xE8s votre arriv\xE9e", dispo };
    }
    return { state: "open", score: 0, reason: "", dispo };
  }
  function etaLabel(eta) {
    if (!eta || !Number.isFinite(eta.minutes)) return "";
    const suffix = eta.realtime ? " (temps r\xE9el)" : "";
    if (eta.mode === "walk") return eta.minutes + " min \xE0 pied" + suffix;
    if (eta.transfers > 0) return eta.minutes + " min \xB7 " + eta.transfers + " corresp." + suffix;
    return eta.minutes + " min" + suffix;
  }
  function searchRelevance(item, query) {
    const q = normalizeText(query);
    if (!q) return 0;
    const mots = q.split(" ").filter((m) => m.length > 2);
    if (!mots.length) return 0;
    const titre = normalizeText(item.title || item.titre);
    const reste = normalizeText([
      item.cat,
      item.adresse,
      item.cuisine,
      ...item.categories || []
    ].filter(Boolean).join(" "));
    let score = 0;
    mots.forEach((mot) => {
      if (titre === mot) score += 1;
      else if (titre.includes(mot)) score += 0.7;
      else if (reste.includes(mot)) score += 0.35;
    });
    return Math.min(1, score / mots.length);
  }
  function reviewWeight(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(1, Math.log10(n + 1) / 3);
  }
  const PALIER_TRAJET_MIN = 5;
  function palierTrajet(item) {
    const minutes = item.rankBreakdown.etaMinutes;
    if (Number.isFinite(minutes)) return Math.floor(minutes / PALIER_TRAJET_MIN);
    const distance = item.rankBreakdown.distance;
    if (!Number.isFinite(distance)) return null;
    const estimees = travelMinutes(distance);
    return estimees == null ? null : Math.floor(estimees / PALIER_TRAJET_MIN);
  }
  function compareEta(a, b) {
    const left = palierTrajet(a);
    const right = palierTrajet(b);
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    return 0;
  }
  function compareDistanceFine(a, b) {
    const left = a.rankBreakdown.etaMinutes;
    const right = b.rankBreakdown.etaMinutes;
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    return a.rankBreakdown.distance - b.rankBreakdown.distance;
  }
  function eventTemporalBucket(item, now) {
    if (!item || !item.rankBreakdown || !item.rankBreakdown.temporary) return null;
    const temporal = item.rankTemporal;
    const start = item.rankStart;
    const temps = root.AutourTemps;
    if (temps && temporal === temps.STATUTS.EN_COURS) return 0;
    if (temps && temporal === temps.STATUTS.IMMINENT) return 1;
    if (!Number.isFinite(start)) return 6;
    const timeZone = item.timezone || item.timeZone || temps?.DEFAULT_TIMEZONE;
    const localDay = (value) => {
      if (temps && typeof temps.partsLocales === "function") {
        const p = temps.partsLocales(value, timeZone);
        return Date.UTC(p.annee, p.mois - 1, p.jour) / 864e5;
      }
      const d = new Date(value);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 864e5;
    };
    const daysAway = localDay(start) - localDay(now);
    if (daysAway <= 0) return 2;
    if (daysAway === 1) return 3;
    if (daysAway <= 7) return 4;
    return 5;
  }
  function compareEventDate(a, b) {
    if (!a.rankBreakdown.temporary || !b.rankBreakdown.temporary) return 0;
    const now = Math.min(
      Number.isFinite(a.rankStart) ? a.rankStart : Infinity,
      Number.isFinite(b.rankStart) ? b.rankStart : Infinity
    );
    const reference = Number.isFinite(a.rankNow) ? a.rankNow : Number.isFinite(b.rankNow) ? b.rankNow : now;
    const bucketA = eventTemporalBucket(a, reference);
    const bucketB = eventTemporalBucket(b, reference);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const left = a.rankBreakdown.temporalDistance;
    const right = b.rankBreakdown.temporalDistance;
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
    return 0;
  }
  const DIVERSITE = Object.freeze({
    fenetre: 8,
    // les premières lignes, celles qu'on lit vraiment
    maxParSousCategorie: 2,
    // le plafond dur demandé
    maxParFamille: 2,
    // trois façons de manger ne font pas une variété
    tolerance: 0.18,
    // marge de score pour préférer une autre nature
    toleranceLarge: 0.32
    // marge élargie une fois le plafond dur atteint
  });
  const FAMILLES_DIVERSITE = Object.freeze({
    resto: "manger",
    fastfood: "manger",
    cafe: "manger",
    marche: "manger",
    food: "manger",
    bar: "sortir",
    concert: "sortir",
    spectacle: "sortir",
    cinema: "sortir",
    studio: "sortir",
    popup: "sortir",
    event: "evenement",
    rencontre: "evenement",
    collecte: "evenement",
    parc: "dehors",
    park: "dehors",
    terrain: "dehors",
    sport: "dehors",
    swimming_pool: "dehors",
    velo: "dehors",
    musee: "culture",
    biblio: "culture",
    coworking: "culture"
  });
  function sousCategorieDe(item) {
    if (!item) return "autre";
    if (item.sousCat) return String(item.sousCat);
    if (item.cat) return String(item.cat);
    return (item.categories || [])[0] || "autre";
  }
  function familleDiversite(item) {
    return FAMILLES_DIVERSITE[sousCategorieDe(item)] || "autre";
  }
  function scoreDiversite(item) {
    const score = Number(item && item.rankScore);
    return Number.isFinite(score) ? score : 0;
  }
  function diversifierResultats(results, options) {
    const o = options === true ? {} : options || {};
    const liste = (results || []).slice();
    if (liste.length <= 2) return liste;
    const fenetre = Math.max(1, Number(o.fenetre) || DIVERSITE.fenetre);
    const max = Math.max(1, Number(o.maxParSousCategorie) || DIVERSITE.maxParSousCategorie);
    const maxFamille = Math.max(1, Number(o.maxParFamille) || DIVERSITE.maxParFamille);
    const tolerance = o.tolerance == null ? DIVERSITE.tolerance : Number(o.tolerance);
    const toleranceLarge = o.toleranceLarge == null ? DIVERSITE.toleranceLarge : Number(o.toleranceLarge);
    const portee = fenetre * 2;
    const restants = liste.slice();
    const choisis = [];
    const vues = /* @__PURE__ */ new Map();
    const familles = /* @__PURE__ */ new Map();
    const compteSous = (item) => vues.get(sousCategorieDe(item)) || 0;
    const compteFamille = (item) => familles.get(familleDiversite(item)) || 0;
    while (choisis.length < fenetre && restants.length) {
      const tete = restants[0];
      let indice = 0;
      const dejaVu = compteSous(tete);
      const dejaVuFamille = compteFamille(tete);
      if (dejaVu >= 1 || dejaVuFamille >= maxFamille) {
        const reference = scoreDiversite(tete);
        const marge = dejaVu >= max || dejaVuFamille >= maxFamille ? toleranceLarge : tolerance;
        const plancher = reference - Math.abs(reference) * marge;
        let remplacant = restants.findIndex((item, i) => i > 0 && i < portee && scoreDiversite(item) >= plancher && compteSous(item) === 0 && compteFamille(item) < maxFamille && compteFamille(item) <= dejaVuFamille);
        if (remplacant < 0) remplacant = restants.findIndex((item, i) => i > 0 && i < portee && scoreDiversite(item) >= plancher && compteSous(item) < max && compteFamille(item) < maxFamille && familleDiversite(item) !== familleDiversite(tete));
        if (remplacant > 0) indice = remplacant;
      }
      const retenu = restants.splice(indice, 1)[0];
      choisis.push(retenu);
      const sous = sousCategorieDe(retenu);
      vues.set(sous, (vues.get(sous) || 0) + 1);
      const famille = familleDiversite(retenu);
      familles.set(famille, (familles.get(famille) || 0) + 1);
    }
    return choisis.concat(restants);
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
    const temps = root.AutourTemps;
    const survivants = [];
    deduped.forEach((item) => {
      const startsAt = parseTime(item.startsAt != null ? item.startsAt : item.debutLe);
      const endsAt = parseTime(item.endsAt != null ? item.endsAt : item.finLe);
      const temporary = item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat);
      const date = Object.assign({}, item, { startsAt, endsAt, isTemporary: temporary });
      const etat = temps ? temps.statutTemporel(date, now, { disponibilite: disponibiliteDe }) : null;
      if (temporary && etat && etat.statut === temps.STATUTS.PASSE) return;
      const finRetenue = temporary && etat && etat.occurrence && etat.occurrence.fin != null ? etat.occurrence.fin : endsAt;
      if (temporary && finRetenue != null && finRetenue <= now) return;
      if (temporary && !etat && endsAt != null && endsAt < now) return;
      if (ctx.nowOnly) {
        const disponible = temps && etat ? temporary ? temps.estMaintenant(etat.statut) : etat.statut === temps.STATUTS.INCONNU ? item.ouvert !== false : temps.estMaintenant(etat.statut) : isAvailableNow(date, now);
        if (!disponible) return;
      }
      survivants.push({ item, startsAt, endsAt, temporary, etat });
    });
    const intention = ctx.intention || null;
    const signaux = root.AutourSignaux;
    const profilDe = (item) => {
      if (!signaux) return null;
      if (!item.__signaux) {
        try {
          Object.defineProperty(item, "__signaux", { value: signaux.signauxDe(item), enumerable: false });
        } catch (e) {
          return signaux.signauxDe(item);
        }
      }
      return item.__signaux;
    };
    function contrainteRefusee(item, contrainte, profil, dispo) {
      if (contrainte.type === "budget") {
        const max = Number(contrainte.max);
        if (max === 0) {
          if (item.gratuit === true) return false;
          if (item.gratuit === false) return true;
          return Number(item.prix) > 0;
        }
        const prix = Number(item.prix);
        if (Number.isFinite(prix) && prix > 0) return prix > max;
        const paliers = [0, 12, 25, 45, 80];
        const n = Number(item.prixN);
        if (Number.isFinite(n) && paliers[n] != null) return paliers[n] > max;
        return false;
      }
      if (contrainte.type === "signal") {
        const ok = signaux ? signaux.satisfait(profil, contrainte.id) : null;
        return ok === false;
      }
      if (contrainte.type === "ouvertApres") {
        if (!dispo || dispo.status === "unknown" || !dispo.closesAtTime) return false;
        const [h, m] = String(dispo.closesAtTime).split(":").map(Number);
        if (!Number.isFinite(h)) return false;
        let fin = h * 60 + (m || 0);
        if (fin <= 6 * 60) fin += 24 * 60;
        return fin < contrainte.minutes;
      }
      return false;
    }
    const transportDemande = categories.some((c) => TRANSPORT_CATEGORIES.includes(c));
    const classes = survivants.map(({ item, startsAt, endsAt, temporary, etat }) => {
      if (!transportDemande && hasAnyCategory(item, TRANSPORT_CATEGORIES)) {
        const forceTransport = bestCategoryWeight(item, TRANSPORT_CATEGORIES);
        const forceDemandee = bestCategoryWeight(
          item,
          categories.filter((c) => !TRANSPORT_CATEGORIES.includes(c))
        );
        if (forceDemandee < forceTransport) return null;
      }
      const profil = intention || ctx.saison ? profilDe(item) : null;
      if (intention && intention.contraintes.length) {
        const dispo = disponibiliteDe(item, now);
        const refuse = intention.contraintes.some((c) => contrainteRefusee(item, c, profil, dispo));
        if (refuse) return null;
      }
      const categoryFit = bestCategoryWeight(item, categories);
      if (categoryFit <= 0) return null;
      const latitude = Number(item.latitude != null ? item.latitude : item.lat);
      const longitude = Number(item.longitude != null ? item.longitude : item.lng);
      const distance = distanceBetween(position[0], position[1], latitude, longitude);
      if (!Number.isFinite(distance) || distance > radius) return null;
      const exactWeight = bestCategoryWeight(item, profile.exact);
      const exactMatch = exactWeight >= 0.8;
      const intentMatch = exactMatch ? 2 : 1;
      let score = (exactMatch ? 145 : 105) + Math.round(categoryFit * 35 + exactWeight * 25);
      const quality = dataQuality(item);
      score += quality;
      const community = item.source === "autour" || item.dbId != null || (item.sources || []).includes("autour");
      if (community) score += 18;
      const relevance = searchRelevance(item, ctx.requete);
      if (ctx.requete) {
        if (relevance <= 0) return null;
        score += relevance * 220;
      }
      let adequation = 0;
      let signauxTenus = [];
      if (intention && signaux && profil) {
        const demandes = intention.preferences.filter((p) => p.type === "signal").concat(intention.ambiance.map((a) => ({ type: "signal", id: a.id, poids: a.poids }))).concat(intention.contraintes.filter((c) => c.type === "signal"));
        const vus = /* @__PURE__ */ new Set();
        let total = 0;
        let obtenu = 0;
        demandes.forEach((d) => {
          if (vus.has(d.id)) return;
          vus.add(d.id);
          const poids = d.poids == null ? 1 : d.poids;
          total += poids;
          const v = signaux.force(profil, d.id);
          if (v == null) return;
          obtenu += v * poids;
          if (v >= 0.5) signauxTenus.push(d.id);
        });
        adequation = total > 0 ? obtenu / total : 0;
        score += adequation * 520;
      }
      if (signaux && profil && ctx.saison) {
        Object.entries(ctx.saison).forEach(([id, poids]) => {
          const v = signaux.force(profil, id);
          if (v == null) return;
          score += v * poids * 90;
        });
      }
      if (ctx.territorial && root.AutourTerritoire) {
        score += root.AutourTerritoire.bonus(
          Object.assign({}, item, { isTemporary: temporary, startsAt, endsAt }),
          ctx.territorial.contexte,
          {
            maintenant: now,
            zone: ctx.territorial.zone || null,
            statut: etat ? etat.statut : null
          }
        );
      }
      score += reviewWeight(item.avis) * 18;
      const poidsDistance = intention && intention.preferences.some((p) => p.type === "proche") ? profile.distance * 1.6 : profile.distance;
      score += poidsDistance * Math.exp(-distance / profile.distanceScale);
      const temporalStart = temporary && etat && etat.debut != null ? etat.debut : startsAt;
      const temporalDistance = temporary && temporalStart != null ? Math.max(0, temporalStart - now) : null;
      const temporalSection = temporary && etat && temps ? temps.sectionTemporelle(etat, now) : null;
      let availability = 2;
      let temporalReason = temporary && etat && temps ? temps.libelleTemporel(item, now, { statut: etat }) : "";
      if (item.ouvert === true) {
        availability = 4;
        score += profile.open;
      } else if (item.ouvert === false) {
        availability = 0;
        score -= ctx.nowOnly ? 1e3 : 155;
      } else {
        score -= 12;
      }
      if (temporary) {
        const debut = temporalStart;
        const inProgress = etat ? etat.statut === temps.STATUTS.EN_COURS : startsAt != null && startsAt <= now && (endsAt == null || endsAt >= now);
        const imminent = etat ? etat.statut === temps.STATUTS.IMMINENT : debut != null && debut >= now && debut - now <= 2 * 3600 * 1e3;
        const minutesUntil = debut == null ? null : Math.round((debut - now) / 6e4);
        if (inProgress) {
          availability = 6;
          score += profile.event + 70;
          temporalReason = "En cours";
        } else if (imminent && minutesUntil != null) {
          availability = 5;
          score += profile.event + Math.max(0, 120 - minutesUntil);
          temporalReason = "Commence dans " + Math.max(1, minutesUntil) + " min";
        } else if (debut != null) {
          if (etat && etat.statut === temps.STATUTS.PLUS_TARD)
            availability = Math.max(availability, 4);
          score += Math.max(20, profile.event * 0.35);
        }
      }
      if (intent === "aide") {
        const urgency = { hebergement: 80, sante: 78, alimentaire: 72, collecte: 65, emploi: 42, asso: 38, mairie: 30 };
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
      const eta = resolveEta(ctx, item, distance);
      const minutes = eta ? eta.minutes : null;
      const arrival = minutes == null ? null : now + minutes * 6e4;
      const outlook = arrivalOutlook(
        item,
        arrival,
        temporary,
        temporalStart,
        // la fin réelle de l'occurrence, jamais la durée supposée : inventer
        // une fin ferait rater un événement dont on ignore la durée
        temporary && etat && etat.occurrence && etat.occurrence.fin != null ? etat.occurrence.fin : endsAt,
        now
      );
      score += outlook.score;
      if (outlook.state === "permanentlyClosed") return null;
      if (typeof ctx.horsService === "function" && ctx.horsService(item, now)) {
        availability = 0;
        score -= 400;
      }
      if (outlook.state === "missed" || outlook.state === "closedOnArrival" || outlook.state === "closedNow") {
        if (ctx.nowOnly) return null;
        availability = 0;
      } else if (outlook.state === "tooLate") {
        availability = Math.min(availability, 1);
      } else if (outlook.state === "closingSoon") {
        availability = Math.min(availability, 1);
      } else if (outlook.state === "onTime" || outlook.state === "late") {
        availability = Math.max(availability, 5);
      } else if (outlook.state === "open" && outlook.dispo) {
        availability = Math.max(availability, 4);
      }
      if (eta && eta.realtime) score += 10;
      const trip = etaLabel(eta);
      let rankReason;
      if (outlook.reason) rankReason = outlook.reason;
      else if (temporalReason) rankReason = temporalReason;
      else if (item.ouvert === true) rankReason = "Ouvert maintenant";
      else if (item.ouvert == null) rankReason = "Horaires inconnus";
      else rankReason = "Le plus proche";
      if (trip) rankReason += " \xB7 " + trip;
      return Object.assign({}, item, {
        rankScore: Math.round(score * 10) / 10,
        rankReason,
        rankDistance: distance,
        rankEta: eta,
        rankArrival: arrival,
        rankOutlook: outlook.state,
        rankAvailability: outlook.dispo || null,
        // statut temporel déjà calculé : l'interface s'en sert pour classer en
        // sections sans refaire le travail ni risquer une réponse différente
        rankSignals: profil || null,
        rankMatched: signauxTenus,
        rankFit: Math.round(adequation * 100) / 100,
        rankTemporal: etat ? etat.statut : null,
        rankSection: temporalSection,
        rankStart: temporalStart,
        rankNow: now,
        rankRelevance: relevance,
        rankBreakdown: {
          availability,
          intentMatch,
          distance,
          community: community ? 1 : 0,
          startsAt: temporalStart,
          temporalDistance,
          temporary,
          quality,
          categoryFit,
          etaMinutes: minutes,
          relevance,
          /* L'adéquation aux caractéristiques demandées, par quarts. Le tri
             regardait la distance bien avant le score : « où bosser » plaçait
             donc le bar d'en face devant la bibliothèque, parce qu'il est plus
             près et qu'il compte comme « sortie » dans le profil générique.
             L'ordre voulu est : ce qui est faisable, ce qui correspond à ce
             qui a été demandé, PUIS la distance. Par quarts, pour ne pas
             réordonner sur du bruit — et à zéro partout quand la requête ne
             demande aucune caractéristique, donc sans effet. */
          fit: Math.round(adequation * 4) / 4
        }
      });
    }).filter(Boolean).sort(
      (a, b) => (
        /* La faisabilité reste le garde-fou absolu : une séance qu'on ne peut
           plus attraper ne doit pas devancer une proposition ouverte. Dès que
           deux événements sont faisables, leur fenêtre temporelle devient le
           critère principal : en cours, imminent, aujourd'hui, demain, semaine,
           futur. Pour un lieu pérenne face à un événement, compareEventDate
           renvoie 0 et le classement habituel reste intact. */
        b.rankBreakdown.availability - a.rankBreakdown.availability || compareEventDate(a, b) || (b.rankBreakdown.fit || 0) - (a.rankBreakdown.fit || 0) || b.rankBreakdown.intentMatch - a.rankBreakdown.intentMatch || (b.rankBreakdown.relevance || 0) - (a.rankBreakdown.relevance || 0) || b.rankBreakdown.community - a.rankBreakdown.community || // « le plus proche » se juge en temps de trajet réel, pas à vol d'oiseau :
        // un lieu à 400 m de l'autre côté du canal est plus loin qu'un lieu à 2 km
        // desservi directement
        compareEta(a, b) || b.rankBreakdown.quality - a.rankBreakdown.quality || b.rankScore - a.rankScore || // à tout le reste égal, le plus proche : c'est un départage, plus un critère
        compareDistanceFine(a, b)
      )
    );
    return ctx.diversite ? diversifierResultats(classes, ctx.diversite) : classes;
  }
  root.AutourCore = Object.freeze({
    FAMILY_CATEGORIES,
    DISCOVERY_EXCLUDED_CATEGORIES,
    CATEGORY_RELATIONS,
    normalizeText,
    classifyPlace,
    classifyPlaceWeighted,
    categoryWeight,
    bestCategoryWeight,
    toCommonItem,
    matchesCategory,
    isDiscoveryCandidate,
    dedupeItems,
    normaliserNomLieu,
    normaliserAdresse,
    estSansNom,
    identifiantsExternes,
    memeIdentifiantExterne,
    diversifierResultats,
    sousCategorieDe,
    familleDiversite,
    DIVERSITE,
    DEDUP_RADIUS,
    normalizePlaceName,
    placeFamily,
    groupLogicalPlaces,
    TRANSPORT_CATEGORIES,
    parseSearchQuery,
    isAvailableNow,
    INTENT_PROFILES,
    rankResults,
    searchRelevance,
    reviewWeight,
    arrivalOutlook,
    walkingEta,
    etaLabel
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
