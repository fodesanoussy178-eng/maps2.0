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

  /* ---- Classification interne pondérée -----------------------------------
     Un lieu n'a pas « une » catégorie : un cinéma est une sortie, une sortie
     culturelle et une sortie familiale, et il doit remonter dans les trois.
     Chaque appartenance porte donc un poids de 0 à 1 — 1 = c'est exactement
     ce qu'est le lieu, en dessous = c'est un usage réel mais secondaire.
     Les tags OSM alimentent cette couche, ils ne la remplacent pas : la
     nomenclature OSM décrit le mobilier urbain, pas ce qu'on vient y faire. */
  const CATEGORY_RELATIONS = Object.freeze({
    cinema: {cinema:1, outing:.9, culture:.8, family:.65},
    spectacle: {show:1, outing:.9, culture:.85},
    concert: {concert:1, outing:.9, culture:.8},
    parc: {park:1, family:.85, outing:.75, sport:.6},
    terrain: {sport:1, outing:.5},
    biblio: {library:1, study:.9, culture:.75, family:.7, services:.6},
    coworking: {coworking:1, study:.9, services:.7},
    musee: {museum:1, culture:.9, outing:.8, family:.7},
    asso: {association:1, help:.85},
    alimentaire: {food_aid:1, help:.95},
    hebergement: {shelter:1, help:.95},
    emploi: {employment:1, help:.85, services:.7},
    sante: {health:1, help:.85, services:.7},
    marche: {market:1, eat:.85, outing:.7, buy:.65},
    resto: {restaurant:1, eat:.95},
    fastfood: {restaurant:1, eat:.95},
    cafe: {cafe:1, eat:.8, study:.6},
    boulangerie: {bakery:1, eat:.9, buy:.55},
    bar: {bar:1, outing:.9},
    friperie: {buy:1, outing:.5},
    commerce: {buy:1},
    mairie: {services:1},
    ecole: {education:1},
    metro: {transport:1, services:.7},
    bus: {transport:1, services:.7},
    velo: {transport:1, services:.7, sport:.5},
    toilettes: {services:1},
    recharge: {services:1},
    event: {event:1, outing:.85},
    popup: {event:1, outing:.85, buy:.7},
    collecte: {event:1, help:.85},
    studio: {event:1, culture:.8},
    sport: {sport:1, event:.9},
    food: {event:1, eat:.9, outing:.75},
    rencontre: {event:1, outing:.85},
    autre: {event:1},
  });

  /* Poids planchers appliqués aux catégories déjà portées par la donnée
     entrante : elles sont déclarées mais sans provenance, donc jamais au
     même niveau qu'une catégorie déduite d'un tag explicite. */
  const DECLARED_WEIGHT = .8;

  const TEMPORARY_CATEGORIES = Object.freeze([
    "event", "popup", "rencontre", "sport", "collecte", "studio", "food", "autre",
  ]);

  /* L'accueil Explorer propose des destinations où l'on va maintenant. Les
     services, l'aide, l'hébergement, les établissements scolaires et les
     commerces génériques restent accessibles par leur besoin ou recherche,
     mais ne gagnent jamais simplement parce qu'ils sont voisins. */
  const DISCOVERY_EXCLUDED_CATEGORIES = new Set([
    "alimentaire", "asso", "collecte", "commerce", "ecole", "emploi",
    "hebergement", "mairie", "recharge", "sante", "toilettes",
    "metro", "bus", "tram", "train", "velo",
  ]);

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’']/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const CATEGORY_ALIASES = Object.freeze({
    restaurant: "resto", restaurants: "resto", fast_food: "fastfood", snack: "fastfood",
    bakery: "boulangerie", boulangerie: "boulangerie", coffee_shop: "cafe", coffee: "cafe",
    bar: "bar", museum: "musee", musee: "musee", library: "biblio", bibliotheque: "biblio",
    park: "parc", garden: "parc", marketplace: "marche", market: "marche",
    theatre: "spectacle", theater: "spectacle", cinema: "cinema", supermarket: "commerce",
    shop: "commerce", event: "event", concert: "concert", sport: "sport",
  });

  const FOOD_SPECIALTIES = Object.freeze({
    cafe: ["cafe", "coffee", "espresso", "salon de the", "tea"],
    boulangerie: ["boulangerie", "bakery", "patisserie", "pain", "viennoiserie"],
    burger: ["burger", "hamburger", "cheeseburger"],
    pizza: ["pizza", "pizzeria"],
    japonais: ["japonais", "japanese", "sushi", "ramen", "yakitori"],
    italien: ["italien", "italian", "pasta", "trattoria"],
    kebab: ["kebab", "doner", "shawarma", "tacos"],
  });

  function canonicalSlug(value) {
    const slug = normalizeText(value).replace(/\s+/g, "_");
    return CATEGORY_ALIASES[slug] || slug || null;
  }

  function normalizeFoodSpecialty(place) {
    const p = place || {};
    const text = normalizeText([
      p.foodSpecialty, p.food_specialty, p.cuisine, p.cuisines, p.speciality,
      p.specialty, p.title, p.titre, p.name, p.description,
    ].filter(Boolean).join(" "));
    for (const [specialty, words] of Object.entries(FOOD_SPECIALTIES)) {
      if (words.some((word) => text.includes(word))) return specialty;
    }
    return null;
  }

  /* Taxonomie unique pour le classement, la déduplication éditoriale et les
     cartes. Les catégories fournisseur sont conservées dans `cat`; cette
     projection stable évite qu'un écran traite `restaurant`, `resto` et
     `fast_food` comme trois natures différentes. */
  function taxonomieCanonique(place) {
    const p = place || {};
    const tags = p.tags || {};
    const valeurs = [p.canonicalCategory, p.canonical_category, p.cat, p.categorie,
      p.category, ...(Array.isArray(p.categories) ? p.categories : []),
      tags.amenity, tags.shop, tags.cuisine].filter(Boolean);
    const categories = unique(valeurs.map(canonicalSlug));
    const text = normalizeText([p.title, p.titre, p.name, p.description, p.cuisine].filter(Boolean).join(" "));
    let category = categories[0] || null;
    const evenement = p.isTemporary === true || p.entity_type === "event" || p.entityType === "event";
    const specialty = evenement ? null : normalizeFoodSpecialty(p);
    if (!category && specialty) category = specialty === "cafe" ? "cafe" : "resto";
    if (!category && /\b(restaurant|restauration|manger|food)\b/.test(text)) category = "resto";
    const food = specialty || ["resto", "fastfood", "cafe", "boulangerie", "food", "marche"].includes(category)
      ? (specialty || null) : null;
    return {
      category,
      categories: unique([category, ...categories]),
      foodSpecialty: food,
      family: food || (category && ["resto", "fastfood", "cafe", "boulangerie", "food", "marche"].includes(category)
        ? "food" : category),
    };
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function parseTime(value, timeZone) {
    if (value == null || value === "") return null;
    const temporal = root.AutourTemps;
    const time = temporal && typeof temporal.toEpochInZone === "function"
      ? temporal.toEpochInZone(value, timeZone || temporal.DEFAULT_TIMEZONE)
      : (typeof value === "number" ? value : new Date(value).getTime());
    return Number.isFinite(time) ? time : null;
  }

  function firstDateValue(item, fields) {
    const source = item || {};
    for (const field of fields) {
      if (source[field] == null || source[field] === "") continue;
      if (parseTime(source[field], source.timezone || source.timeZone) != null) return source[field];
    }
    return null;
  }

  /* Ajoute un jeu de catégories pondérées sans jamais dégrader un poids déjà
     acquis : un lieu classé « cinéma » à 1 par son tag ne redescend pas à .8
     parce qu'une règle textuelle plus faible le mentionne aussi. */
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
    (keys || []).forEach((key) => { delete target[key]; });
  }

  /* Renvoie la carte complète { catégorie: poids }, triée du plus au moins
     pertinent. C'est la vraie sortie du moteur ; classifyPlace n'en est que
     la projection en liste, conservée pour tout le code existant. */
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
      tags.event,
    ].filter(Boolean).join(" "));
    const weights = {};
    (Array.isArray(p.categories) ? p.categories : []).forEach((category) => {
      if (category) addWeights(weights, {[category]: DECLARED_WEIGHT});
    });

    if (primary) addWeights(weights, {[primary]: 1});
    addWeights(weights, CATEGORY_RELATIONS[primary]);

    const amenity = normalizeText(tags.amenity);
    const leisure = normalizeText(tags.leisure);
    const tourism = normalizeText(tags.tourism);
    const office = normalizeText(tags.office);
    const socialFacility = normalizeText(tags.social_facility);
    const transportPlace = ["bus", "metro", "velo"].includes(primary) ||
      /\b(bus stop|tram stop|station|subway|bicycle parking|bicycle rental)\b/.test(type);

    if (amenity === "cinema" || leisure === "cinema" || (!transportPlace && CINEMA_WORDS.test(text))) {
      addWeights(weights, CATEGORY_RELATIONS.cinema);
    }
    if (amenity === "theatre" || type.includes("theater") || type.includes("theatre")) {
      addWeights(weights, CATEGORY_RELATIONS.spectacle);
      if (!CINEMA_WORDS.test(text)) dropWeights(weights, ["cinema"]);
    }

    if (amenity === "library" || (!transportPlace && /\b(bibliotheque|mediatheque|library)\b/.test(text))) {
      addWeights(weights, CATEGORY_RELATIONS.biblio);
    }
    if (leisure === "park" || leisure === "garden" || primary === "parc" || type === "park" || type === "garden") {
      addWeights(weights, CATEGORY_RELATIONS.parc);
    }
    if (leisure === "playground") addWeights(weights, {playground:1, family:.95, park:.8, sport:.5});
    if (leisure === "swimming pool") addWeights(weights, {swimming_pool:1, sport:.85, family:.8});
    if (leisure === "bowling alley") addWeights(weights, {bowling_alley:1, outing:.85, family:.8, sport:.5});
    if (tourism === "zoo") addWeights(weights, {zoo:1, family:.95, outing:.8});
    if (tourism === "farm" || /\b(ferme pedagogique|educational farm)\b/.test(text)) {
      addWeights(weights, {educational_farm:1, family:.9, outing:.7});
    }
    if (tourism === "museum" || (!transportPlace && /\b(musee|museum)\b/.test(text))) {
      addWeights(weights, CATEGORY_RELATIONS.musee);
    }
    if (amenity === "marketplace" || /\b(marche|market)\b/.test(text)) {
      addWeights(weights, CATEGORY_RELATIONS.marche);
    }
    if (amenity === "social centre" || amenity === "community centre" || office === "association" || socialFacility) {
      addWeights(weights, {help:.95, association:1});
    }
    if (amenity === "social centre" || amenity === "community centre") addWeights(weights, {family:.7});

    const isTemporary = p.isTemporary === true || p.temporaire === true || TEMPORARY_CATEGORIES.includes(primary);
    if (isTemporary) addWeights(weights, {event:1});
    if (CINEMA_EVENT_WORDS.test(text)) addWeights(weights, {cinema:1, event:.9, outing:.85, culture:.8});
    if (isTemporary && /\b(atelier|workshop)\b/.test(text)) addWeights(weights, {workshop:1, event:.95, family:.75});
    if (isTemporary && /\b(enfant|enfants|kids?|children?|jeune public)\b/.test(text)) addWeights(weights, {kids_event:1, family:.95, event:.9});
    if ((isTemporary && /\b(jeunesse|youth|jeunes)\b/.test(text)) || normalizeText(tags.club) === "youth") {
      addWeights(weights, {youth_activity:1, family:.85});
      if(isTemporary) addWeights(weights, {event:.9});
    }
    if (isTemporary && /\b(famille|familial|family|fete locale)\b/.test(text)) addWeights(weights, {family_event:1, family:.95, event:.9});

    const familyRestaurant = [tags.highchair, tags.kids_area, tags.family, tags.changing_table].some((value) => /^(yes|designated)$/i.test(String(value || "")));
    if ((primary === "resto" || primary === "fastfood" || type.includes("restaurant")) && (familyRestaurant || FAMILY_WORDS.test(text))) {
      addWeights(weights, {restaurant:1, family:familyRestaurant ? .8 : .65});
    }

    const accessibleSport = (weights.sport > 0 || primary === "terrain" || primary === "sport") &&
      (/\b(accessible|tout public|all ages|debutant|beginner)\b/.test(text) || /^(yes|designated)$/i.test(String(tags.wheelchair || "")));
    if(accessibleSport) addWeights(weights, {family:.7});

    const ordinarySchool = ORDINARY_SCHOOL_TYPES.has(type) ||
      [tags.amenity, tags.school].some((value) => ORDINARY_SCHOOL_TYPES.has(normalizeText(value))) ||
      /\b(ecole|college|lycee|creche|groupe scolaire|primary school|secondary school|high school)\b/.test(text);
    if (ordinarySchool && !(isTemporary && FAMILY_WORDS.test(text))) {
      dropWeights(weights, ["family", ...FAMILY_CATEGORIES]);
    }

    return weights;
  }

  /* Projection en liste, ordonnée du poids le plus fort au plus faible : le
     premier élément reste la catégorie « principale » pour tout le code qui
     n'a pas besoin des poids. */
  function sortByWeight(weights) {
    return Object.keys(weights || {}).sort((a, b) => weights[b] - weights[a]);
  }

  function classifyPlace(place) {
    return sortByWeight(classifyPlaceWeighted(place));
  }

  /* Poids d'un lieu déjà classé pour une catégorie donnée. Un item porte sa
     carte de poids dans categoryWeights ; à défaut on retombe sur sa liste
     de catégories, où l'appartenance vaut 1 et l'absence 0. */
  function categoryWeight(item, category) {
    if (!item || !category) return 0;
    const weights = item.categoryWeights;
    let weight = weights ? Number(weights[category]) : 0;
    if (!Number.isFinite(weight)) weight = 0;
    // la carte de poids ne fait pas autorité contre une appartenance déclarée :
    // un item recomposé hors de toCommonItem n'a que cat / categories
    if (item.cat === category) weight = Math.max(weight, 1);
    else if ((item.categories || []).includes(category)) weight = Math.max(weight, DECLARED_WEIGHT);
    return weight;
  }

  /* Poids le plus fort parmi un jeu de catégories : c'est ce qui permet à un
     même lieu de remonter dans plusieurs besoins sans y peser pareil. */
  function bestCategoryWeight(item, categories) {
    return (categories || []).reduce((best, category) => Math.max(best, categoryWeight(item, category)), 0);
  }

  function toCommonItem(raw, defaults) {
    const source = (defaults && defaults.source) || raw.source || "unknown";
    const title = raw.title || raw.titre || raw.name || "";
    const latitude = Number(raw.latitude != null ? raw.latitude : raw.lat);
    const longitude = Number(raw.longitude != null ? raw.longitude : raw.lng);
    /* Les flux canoniques parlent `start_at/end_at`, les publications
       historiques `debut_le/fin_le` et le modèle commun `startsAt/endsAt`.
       Tous doivent aboutir au même contrat, sans dépendre d'un champ texte
       `quand` qui n'est pas une donnée temporelle structurée. */
    const timeZone = raw.timezone || raw.timeZone;
    const startsAt = parseTime(firstDateValue(raw, [
      "start_at", "startAt", "event_start_at", "eventStartAt", "startsAt", "debutLe", "debut_le",
    ]), timeZone);
    const endsAt = parseTime(firstDateValue(raw, [
      "end_at", "endAt", "event_end_at", "eventEndAt", "endsAt", "finLe", "fin_le",
    ]), timeZone);
    const openingHours = raw.openingHours != null ? raw.openingHours : (raw.horaires || raw.quand || null);
    const isTemporary = raw.isTemporary != null
      ? !!raw.isTemporary
      : raw.entity_type === "event" || TEMPORARY_CATEGORIES.includes(raw.cat);
    const categoryWeights = classifyPlaceWeighted(Object.assign({}, raw, { title, source, isTemporary }));
    const categories = sortByWeight(categoryWeights);
    const taxonomy = taxonomieCanonique(Object.assign({}, raw, {title, isTemporary}));

    return Object.assign({}, raw, {
      categoryWeights,
      id: String(raw.id),
      source,
      sources: unique([...(raw.sources || []), source]),
      title,
      description: raw.description || "",
      latitude,
      longitude,
      categories,
      canonicalCategory: taxonomy.category,
      canonicalCategories: taxonomy.categories,
      foodSpecialty: taxonomy.foodSpecialty,
      canonicalFamily: taxonomy.family,
      startsAt,
      endsAt,
      openingHours,
      isTemporary,
      entity_type: isTemporary ? "event" : "place",
      url: raw.url || "",
      image: raw.image || "",
      imageSource: raw.imageSource || "",
      sourceRefs: Object.assign({}, raw.sourceRefs || {}, raw.idGoogle ? {googlePlaceId:raw.idGoogle} : {},
        raw.idOsm ? {osmId:raw.idOsm} : {}, raw.idDatatourisme ? {datatourismeId:raw.idDatatourisme} : {}),
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

  /* LAQUELLE DES DESCRIPTIONS REPRÉSENTE LE LIEU ?

     L'identité Autour reste souveraine. Pour un même commerce, Google est
     ensuite la source la plus précise (nom, coordonnées, horaires, photo),
     puis viennent les catalogues et OSM.

     Les trois rangs ajoutés au-dessus sont ceux d'une manifestation : quand la
     même brocante est décrite par le flux officiel, par l'agenda de la Ville
     et par DATAtourisme, la déduplication n'en garde qu'UNE — mais laquelle
     survit n'est pas indifférent. Un horaire officiel vaut mieux qu'un horaire
     recopié. */
  const SOURCE_RANK = Object.freeze({
    contexte_officiel:7, institutionnel:6, organisateur:5,
    autour:4, google_places:3, openagenda:2, datatourisme:2, openstreetmap:1,
  });

  /* Des horaires « fiables » sont des horaires qu'on peut lire : une grille
     publiée, ou au minimum un état ouvert/fermé affirmé. « Voir sur place »
     est une absence d'horaires qui se donne l'air d'en être. */
  function fiabiliteHoraires(item) {
    if (!item) return 0;
    if (Array.isArray(item.horaires) && item.horaires.length) return 2;
    const brut = item.openingHours || item.quand;
    if (brut && String(brut).trim() && !/^voir sur place$/i.test(String(brut).trim())) return 2;
    if (item.ouvert === true || item.ouvert === false) return 1;
    return 0;
  }

  /* LEQUEL DES DEUX REPRÉSENTE LE LIEU ?

     L'ordre est celui du produit, et il ne dépend plus de l'ordre d'arrivée
     asynchrone des fournisseurs :

       1. un vrai nom — une fiche nommée ne disparaît jamais derrière « Parcs » ;
       2. les données les plus complètes ;
       3. la source la plus fiable ;
       4. des horaires exploitables ;
       5. la pertinence déjà calculée, en dernier recours.

     Les paliers sont volontairement disjoints : un critère supérieur ne peut
     pas être renversé par l'accumulation des suivants. */
  function scoreRepresentant(item) {
    const pertinence = Number(item && item.rankScore);
    return (estSansNom(item) ? 0 : 100000)
      + dataQuality(item) * 100
      + (SOURCE_RANK[item && item.source] || 0) * 20
      + fiabiliteHoraires(item) * 5
      + (Number.isFinite(pertinence) ? Math.min(4, Math.max(0, pertinence) / 100) : 0);
  }

  function mergeDuplicate(left, right) {
    const merged = Object.assign({}, left);
    const preferred = scoreRepresentant(right) > scoreRepresentant(left) ? right : left;
    const fallback = preferred === right ? left : right;
    Object.assign(merged, fallback, preferred);
    // fusionner deux fiches, c'est réunir leurs appartenances en gardant le
    // poids le plus fort : la source la mieux renseignée fait foi catégorie
    // par catégorie, pas en bloc
    const categoryWeights = {};
    [left, right].forEach((side) => {
      if (side.categoryWeights) addWeights(categoryWeights, side.categoryWeights);
      (side.categories || []).forEach((category) => addWeights(categoryWeights, {[category]: DECLARED_WEIGHT}));
      if (side.cat) addWeights(categoryWeights, {[side.cat]: 1});
    });
    merged.categoryWeights = categoryWeights;
    merged.categories = sortByWeight(categoryWeights);
    merged.sources = unique([...(left.sources || [left.source]), ...(right.sources || [right.source])]);
    merged.sourceRefs = Object.assign({}, left.sourceRefs || {}, right.sourceRefs || {});
    /* Les métadonnées canoniques d'une manifestation doivent survivre à la
       fusion avec une autre source : le meilleur représentant peut être le
       plus complet sur l'adresse ou l'image, sans être celui qui connaît
       l'artiste. On réunit donc les preuves au lieu de laisser Object.assign
       écraser un tableau renseigné par un tableau vide. */
    for(const champ of ["announcement_tags", "performers", "artist_names", "music_genres"]){
      const alias = champ === "announcement_tags" ? "announcementTags"
        : champ === "artist_names" ? "artistNames"
        : champ === "music_genres" ? "musicGenres" : null;
      const valeurs = [left[champ], right[champ], alias && left[alias], alias && right[alias]]
        .flatMap((valeur)=>Array.isArray(valeur) ? valeur : []);
      if(valeurs.length){
        const uniques = unique(valeurs);
        merged[champ] = uniques;
        if(alias) merged[alias] = uniques;
      }
    }
    const typeEvenement = left.event_kind || right.event_kind || left.eventKind || right.eventKind || null;
    if(typeEvenement){ merged.event_kind = typeEvenement; merged.eventKind = typeEvenement; }
    merged.source = preferred.source || fallback.source;
    /* LE VRAI NOM SURVIT TOUJOURS À LA FUSION.

       C'est la règle qui empêche « Parc Clemenceau » de redevenir « Parcs »
       parce que l'autre relevé, mieux noté sur un autre critère, n'avait pas
       de nom. Le libellé de catégorie n'est qu'un repli : il ne reprend la
       main que lorsque plus personne n'a de nom à proposer. */
    const nomme = !estSansNom(preferred) ? preferred
      : (!estSansNom(fallback) ? fallback : null);
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
    merged.imageSource = preferred.image ? (preferred.imageSource || fallback.imageSource || "")
      : (fallback.imageSource || "");
    merged.imageAttribution = preferred.image ? (preferred.imageAttribution || fallback.imageAttribution || "")
      : (fallback.imageAttribution || "");
    /* Une source prioritaire ne doit pas gagner avec du vide. Une fiche OSM
       peut être moins détaillée qu'une publication ou un catalogue ouvert ;
       `Object.assign` seul laisserait alors un `null` effacer l'information. */
    const renseigne = (value) => {
      if (value == null || value === "") return false;
      if (Array.isArray(value)) return value.length > 0;
      return true; // false et 0 sont des informations, pas des absences
    };
    ["note","avis","rating","userRatingCount","ouvert","prixN","prix","horaires",
      "openingHours","tel","pmr","idGoogle","resumeGoogle","descriptionSource"]
      .forEach((field) => {
        merged[field] = renseigne(preferred[field]) ? preferred[field] : fallback[field];
      });
    merged.startsAt = preferred.startsAt != null ? preferred.startsAt : fallback.startsAt;
    merged.endsAt = preferred.endsAt != null ? preferred.endsAt : fallback.endsAt;
    merged.debutLe = merged.startsAt;
    merged.finLe = merged.endsAt;
    ["start_at", "end_at", "startAt", "endAt", "event_start_at", "event_end_at"]
      .forEach((field) => {
        merged[field] = renseigne(preferred[field]) ? preferred[field] : fallback[field];
      });

    /* CE QUI QUALIFIE LES DATES SUIT LES DATES.

       Les deux bornes étaient déjà protégées : un `null` ne les écrasait pas.
       Mais ce qui les QUALIFIE ne l'était pas, et passait dans l'`Object.assign`
       plus haut. Une fiche OSM mieux notée — elle a un nom, une adresse, des
       horaires d'ouverture — imposait donc son `quand` de remplissage
       (« Voir sur place ») et son absence de confiance temporelle à un
       événement dont la base connaît pourtant le jour et l'heure. `libelleHoraires`
       rejette explicitement ce placeholder et retombait sur « Horaires
       inconnus » : même affiche, même description — celles-là sont protégées —
       mais plus d'horaire.

       La règle est donc : le côté qui APPORTE la date apporte aussi ce qui la
       décrit. Quand aucun des deux n'a de date, on retrouve le comportement
       d'avant. */
    const cotéTemporel = [preferred, fallback].find((c) => c && c.startsAt != null) || preferred;
    const autreCoté = cotéTemporel === preferred ? fallback : preferred;
    ["quand", "dateConfidence", "temporalStatus", "date_confidence", "temporal_status"]
      .forEach((field) => {
        merged[field] = renseigne(cotéTemporel[field]) ? cotéTemporel[field] : autreCoté[field];
      });

    /* Le modèle canonique est la seule source lue par les écrans. La fusion
       de deux fournisseurs ne doit donc pas remplacer un fait connu par un
       `null` de la fiche préférée (ni mélanger événement et lieu). */
    const fusionnerCanonique = (gauche, droite) => {
      if (!gauche && !droite) return null;
      const result = Object.assign({}, gauche || {}, droite || {});
      const keys = new Set([...(gauche ? Object.keys(gauche) : []), ...(droite ? Object.keys(droite) : [])]);
      keys.forEach((key) => {
        const value = droite && droite[key];
        const fallbackValue = gauche && gauche[key];
        if (!renseigne(value) && renseigne(fallbackValue)) result[key] = fallbackValue;
      });
      return result;
    };
    if (left.isTemporary && right.isTemporary && root.AutourEntites &&
        root.AutourEntites.fusionnerEvenementsCanoniques) {
      /* Les événements ont un contrat de fusion distinct des lieux. Le
         dédoublonnage a déjà prouvé qu'il s'agit de la même occurrence ; on
         reconstruit alors UN CanonicalEvent à partir des deux versions, au
         lieu de conserver le représentant arrivé en premier. */
      const canonique = root.AutourEntites.fusionnerEvenementsCanoniques([left, right]);
      if (canonique) {
        merged.eventCanonical = canonique;
        const champs = {
          title: canonique.title,
          titre: canonique.title,
          description: canonique.description,
          category: canonique.category,
          cat: canonique.cat,
          categories: canonique.categories,
          latitude: canonique.latitude,
          longitude: canonique.longitude,
          lat: canonique.lat,
          lng: canonique.lng,
          startsAt: canonique.startsAt,
          endsAt: canonique.endsAt,
          debutLe: canonique.startsAt,
          finLe: canonique.endsAt,
          start_at: canonique.start_at,
          end_at: canonique.end_at,
          date_confidence: canonique.date_confidence,
          dateConfidence: canonique.date_confidence,
          temporal_status: canonique.temporal_status,
          temporalStatus: canonique.temporal_status,
          timezone: canonique.timezone,
          event_kind: canonique.event_kind,
          eventKind: canonique.eventKind,
          announcement_tags: canonique.announcement_tags,
          announcementTags: canonique.announcementTags,
          tags: canonique.tags,
          artist_names: canonique.artist_names,
          artistNames: canonique.artistNames,
          music_genres: canonique.music_genres,
          musicGenres: canonique.musicGenres,
          performers: canonique.performers,
          metro_area: canonique.metro_area,
          metroArea: canonique.metroArea,
          territory_slug: canonique.territory_slug,
          importance_level: canonique.importance_level,
          importanceLevel: canonique.importanceLevel,
          announced_at: canonique.announced_at,
          announcedAt: canonique.announcedAt,
          event_source: canonique.event_source,
          event_source_url: canonique.event_source_url,
          event_sources: canonique.event_sources,
          event_source_urls: canonique.event_source_urls,
          primary_source: canonique.primary_source,
          primarySource: canonique.primary_source,
          place_source: canonique.place_source,
          venue_name: canonique.venue_name,
          organizer_name: canonique.organizer_name,
          price_amount: canonique.price_amount,
          price_text: canonique.price_text,
          is_free: canonique.is_free,
          price_confidence: canonique.price_confidence,
          audience: canonique.audience,
          min_age: canonique.min_age,
          reservation_required: canonique.reservation_required,
          reservation_text: canonique.reservation_text,
          image: canonique.image_url,
          imageSource: canonique.image_source,
          image_url: canonique.image_url,
          image_source: canonique.image_source,
          image_source_url: canonique.image_source_url,
          image_author: canonique.image_author,
          image_license: canonique.image_license,
          image_confidence: canonique.image_confidence,
          image_width: canonique.image_width,
          image_height: canonique.image_height,
          image_scope: "evenement",
          image_sources: canonique.image_sources,
          imageSources: canonique.imageSources,
          image_source_urls: canonique.image_source_urls,
          imageSourceUrls: canonique.imageSourceUrls,
          entity_type: "event",
          isTemporary: true,
        };
        Object.entries(champs).forEach(([key, value]) => {
          if (renseigne(value) || ["is_free", "reservation_required", "lat", "lng", "latitude", "longitude"].includes(key))
            merged[key] = value;
        });
      }
    } else if (left.eventCanonical || right.eventCanonical) {
      merged.eventCanonical = fusionnerCanonique(left.eventCanonical, right.eventCanonical);
    }
    if (left.placeCanonical || right.placeCanonical)
      merged.placeCanonical = fusionnerCanonique(left.placeCanonical, right.placeCanonical);
    return merged;
  }

  function sameTitle(a, b) {
    const clean = (value) => normalizeText(value).replace(/\b(le|la|les|l|the)\b/g, " ").replace(/\s+/g, " ").trim();
    const left = clean(a);
    const right = clean(b);
    return !!left && !!right && (left === right || (left.length > 7 && right.length > 7 && (left.includes(right) || right.includes(left))));
  }

  /* Les relevés ouverts peuvent garder une faute de frappe ou une ville
     suffixée là où Google donne le nom commercial complet. On accepte cette
     preuve plus faible UNIQUEMENT entre fournisseurs, pour le même premier
     mot significatif, à très forte ressemblance et à très courte distance.
     Ainsi « Pepe Chiken byFast Good cuisine » rejoint « Pepe Chicken By
     Fastgood Cuisine – Tourcoing », sans confondre deux commerces voisins. */
  function distanceEdition(left, right) {
    const previous = Array.from({length:right.length + 1}, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      let diagonal = previous[0]; previous[0] = i;
      for (let j = 1; j <= right.length; j += 1) {
        const before = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1,
          diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
        diagonal = before;
      }
    }
    return previous[right.length];
  }

  function titlesNearlySame(a, b) {
    const clean = (value) => normalizeText(value).replace(/\b(le|la|les|l|the)\b/g, " ")
      .replace(/\s+/g, " ").trim();
    const left = clean(a), right = clean(b);
    const firstLeft = left.split(" ")[0] || "", firstRight = right.split(" ")[0] || "";
    if (firstLeft.length < 4 || firstLeft !== firstRight) return false;
    const compactLeft = left.replace(/\s/g, ""), compactRight = right.replace(/\s/g, "");
    const short = compactLeft.length <= compactRight.length ? compactLeft : compactRight;
    const long = short === compactLeft ? compactRight : compactLeft;
    if (short.length < 12) return false;
    const compared = long.slice(0, short.length);
    return (1 - distanceEdition(short, compared) / short.length) >= 0.9;
  }

  /* ---- Identité d'un lieu : nom, identifiant, adresse ---------------------

     Dédupliquer, c'est répondre à « ces deux fiches désignent-elles la même
     chose ? ». Six preuves entrent dans la réponse, de la plus forte à la plus
     faible : un identifiant externe partagé, un nom normalisé identique, une
     catégorie commune, une adresse identique, la distance qui les sépare, et
     — pour ce qui n'a pas de nom du tout — la seule ressemblance de nature à
     courte distance.

     Une seule est décisive à elle seule : l'identifiant. C'est le fournisseur
     lui-même qui affirme que c'est le même objet. Toutes les autres se
     combinent, parce qu'aucune ne suffit : deux « Central » voisins peuvent
     être un café et un hôtel, deux « Parcs » à cent mètres sont presque
     toujours deux morceaux du même parc. */

  const NAME_ARTICLES = /\b(le|la|les|l|un|une|des|du|de|d|au|aux|the|a)\b/g;

  /* Les abréviations qu'un relevé écrit d'un côté et développe de l'autre.
     Ce ne sont pas des synonymes : ce sont deux écritures du même mot. */
  const NAME_VARIANTS = Object.freeze([
    [/\bst\b/g, "saint"], [/\bste\b/g, "sainte"], [/\bsts\b/g, "saints"],
    [/\bmt\b/g, "mont"], [/\bnd\b/g, "notre dame"],
    [/\bpl\b/g, "place"], [/\bav\b/g, "avenue"], [/\bbd\b/g, "boulevard"],
    [/\bmr\b/g, "monsieur"], [/\bet\b/g, " "], [/\band\b/g, " "],
  ]);

  /* Singulier approximatif. Il ne s'agit pas de faire de la grammaire : il
     s'agit que « Parcs » et « Parc » se comparent. La règle s'applique aux
     DEUX côtés, donc une règle fausse produit deux formes également fausses —
     elle ne crée pas de rapprochement qui n'existerait pas. Les mots courts
     sont épargnés : « bus » n'est pas un pluriel. */
  function singulierApproche(word) {
    if (word.length <= 4) return word;
    if (/[sx]$/.test(word)) return word.slice(0, -1);
    return word;
  }

  /* Le nom d'un lieu, ramené à ce qui l'identifie : sans casse, sans accent,
     sans ponctuation, sans article, sans marque de pluriel. */
  function normaliserNomLieu(value) {
    let text = normalizeText(value);
    if (!text) return "";
    NAME_VARIANTS.forEach((paire) => { text = text.replace(paire[0], paire[1]); });
    text = text.replace(NAME_ARTICLES, " ").replace(/\s+/g, " ").trim();
    return text.split(" ").map(singulierApproche).filter(Boolean).join(" ");
  }

  /* Une adresse dit la même chose de deux façons selon la source : « 12 rue de
     la Paix » ou « 12 R. Paix ». On retire ce qui est un rôle de voie et on
     garde le numéro et le nom propre — c'est là qu'est l'information. */
  const ADDRESS_ROLES = /\b(rue|r|avenue|av|boulevard|bd|place|pl|chemin|ch|impasse|allee|route|rte|quai|square|cours|voie|passage|residence|batiment|bat|bis|ter)\b/g;

  function normaliserAdresse(value) {
    const text = normalizeText(value)
      .replace(ADDRESS_ROLES, " ").replace(NAME_ARTICLES, " ")
      .replace(/\s+/g, " ").trim();
    return text.split(" ").map(singulierApproche).filter(Boolean).join(" ");
  }

  /* Un lieu sans nom exploitable en porte le drapeau, ou n'a tout simplement
     rien à afficher. Les deux cas se traitent pareil : ce lieu n'a pas
     d'identité propre, seulement une nature et une position. */
  function estSansNom(item) {
    if (!item) return true;
    if (item.sansNom === true) return true;
    const titre = String(item.title || item.titre || "").trim();
    return titre.length < 2;
  }

  /* L'adresse ne sert de preuve que lorsqu'elle en est une. Une fiche
     OpenStreetMap sans numéro ni rue retombe sur son propre libellé : tous les
     parcs anonymes d'une ville partageraient alors « l'adresse » Parcs, et se
     fondraient les uns dans les autres à travers toute la carte. */
  function adresseComparable(item) {
    if (!item) return "";
    const adresse = normaliserAdresse(item.adresse || item.address || item.addr);
    if (!adresse) return "";
    if (adresse === normaliserNomLieu(item.title || item.titre)) return "";
    // un nom de commune seul n'est pas une adresse : sans numéro, il faut au
    // moins deux mots pour désigner un point et non un quartier entier
    if (!/\d/.test(adresse) && adresse.split(" ").length < 2) return "";
    return adresse;
  }

  /* Les identifiants que les fournisseurs attachent à leurs fiches. Deux
     fiches qui en partagent un sont le même objet, point : c'est la source qui
     le dit, et aucune heuristique de nom ne vaut cette affirmation. */
  function identifiantsExternes(item) {
    const refs = new Set();
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

  /* Un parc, un terrain, un marché ne sont pas des points : OpenStreetMap les
     décrit par plusieurs polygones, parfois à trois cents mètres l'un de
     l'autre. Les comparer au rayon d'un commerce revient à afficher quatre
     fois le même parc — c'est exactement ce qu'on veut faire disparaître. */
  const SPREAD_CATEGORIES = Object.freeze(["parc", "park", "terrain", "sport",
    "marche", "swimming_pool", "cimetiere", "plage", "foret"]);

  const DEDUP_RADIUS = Object.freeze({
    nomme: 120,          // deux relevés du même commerce
    nommeEtendu: 400,    // deux morceaux du même parc
    typo: 180,           // faute de frappe entre fournisseurs
    adresse: 60,         // noms différents, même adresse exacte
    sansNomEtendu: 500,  // les morceaux anonymes d'un même parc
    sansNom: 90,         // ailleurs, deux objets anonymes voisins
  });

  function estEtendu(item) {
    return [item.cat, ...(item.categories || [])]
      .some((category) => SPREAD_CATEGORIES.includes(category));
  }

  function estTransportItem(item) {
    return [item.cat, ...(item.categories || [])]
      .some((category) => TRANSPORT_CATEGORIES.includes(category));
  }

  /* Jusqu'où deux objets anonymes de même nature sont-ils le même objet ?

     Pour un objet étendu, loin : un parc décrit par cinq polygones s'étale sur
     des centaines de mètres, et ses morceaux ne sont pas cinq parcs.

     Partout ailleurs, très près. Deux arrêts anonymes à deux cents mètres sont
     deux points de montée ; deux toilettes publiques à deux cents mètres sont
     deux dépannages, et faire disparaître le plus proche serait un vrai
     préjudice. Le rayon serré ne ramasse alors que ce qui est manifestement un
     doublon de relevé — un nœud et son bâtiment, la même chose vue deux fois. */
  function rayonSansNom(a, b) {
    if (estEtendu(a) || estEtendu(b)) return DEDUP_RADIUS.sansNomEtendu;
    return DEDUP_RADIUS.sansNom;
  }

  /* Un nom seul ne suffit pas : un « Central » café et un « Central » hôtel
     voisins sont deux destinations. Deux sources ne se fusionnent que si leur
     catégorie interne a un usage en commun, en plus du nom normalisé et de la
     proximité géographique. */
  function sameCategory(a, b) {
    const left = unique([a && a.cat, ...((a && a.categories) || [])]);
    const right = new Set(unique([b && b.cat, ...((b && b.categories) || [])]));
    if(left.some((category) => right.has(category))) return true;
    /* Google et OSM ne découpent pas toujours pareil un même établissement :
       « restaurant », « fast-food », café et bar peuvent désigner la même
       enseigne. Cette équivalence est volontairement étroite ; elle ne mêle
       ni l'aide, ni le transport, ni deux commerces génériques voisins. */
    const restauration = new Set(["resto","fastfood","cafe","bar"]);
    return left.some((category) => restauration.has(category)) &&
      [...right].some((category) => restauration.has(category));
  }

  /* Deux occurrences d'un même événement ne se confondent que si elles
     tombent dans la même fenêtre : la même exposition ce soir et demain soir
     sont deux propositions, pas un doublon. */
  function memeFenetre(existing, item) {
    if (!item.isTemporary) return true;
    if (existing.startsAt == null || item.startsAt == null) return true;
    return Math.abs(existing.startsAt - item.startsAt) <= 3 * 3600 * 1000;
  }

  function memeEnregistrement(existing, item, distanceBetween, options) {
    if (!!existing.isTemporary !== !!item.isTemporary) return false;
    if (existing.entity_type && item.entity_type && existing.entity_type !== item.entity_type) return false;
    /* Un identifiant fournisseur stable est une preuve plus forte qu'une
       catégorie dérivée. Une fiche en cache peut être « event », puis la
       version fraîche « concert » après enrichissement des mots-clés : ce
       sont toujours le même événement, et l'afficher deux fois ferait
       sauter la liste au moment où le réseau répond. */
    if (existing.id != null && item.id != null && String(existing.id) === String(item.id)) return true;
    if (memeIdentifiantExterne(existing, item)) return true;
    /* Un contexte éditorial peut contenir deux animations distinctes au même
       endroit et dans la même fenêtre — par exemple la Braderie des enfants
       et un atelier associé. Quand leurs identifiants diffèrent, l'absence de
       référence externe commune doit préserver les deux occurrences au lieu
       d'appliquer la déduplication géographique des lieux. */
    if (options && options.preserveDistinctEvents && existing.isTemporary && item.isTemporary)
      return false;
    /* Une station et une destination peuvent porter exactement le même
       nom à la même adresse. Les fusionner donne à la station la photo, la
       note et la catégorie du café voisin, puis la fait remonter dans Manger.
       L'homonymie ne franchit donc jamais la frontière transport / lieu où
       l'on va. */
    if (estTransportItem(existing) !== estTransportItem(item)) return false;
    if (!sameCategory(existing, item)) return false;

    const distance = distanceBetween(existing.latitude, existing.longitude,
      item.latitude, item.longitude);
    if (!Number.isFinite(distance)) return false;

    /* DEUX OBJETS ANONYMES DE MÊME NATURE, À QUELQUES PAS.

       Rien ne les distingue à l'écran : ils portent le même libellé de
       catégorie, la même icône, et le lecteur ne peut pas dire lequel est
       lequel. C'est très exactement la quadruple carte « Parcs ». Le rayon
       dépend de la nature : un objet étendu se lit sur plusieurs centaines de
       mètres, un arrêt de transport anonyme reste distinct de son voisin. */
    const anonymeGauche = estSansNom(existing);
    const anonymeDroit = estSansNom(item);
    if (anonymeGauche && anonymeDroit) {
      if (distance > rayonSansNom(existing, item)) return false;
      return memeFenetre(existing, item);
    }
    /* Un lieu nommé n'est jamais absorbé par un lieu anonyme : on perdrait un
       vrai nom au profit d'un libellé de catégorie. */
    if (anonymeGauche !== anonymeDroit) return false;

    const titreGauche = existing.title || existing.titre;
    const titreDroit = item.title || item.titre;
    const nomGauche = normaliserNomLieu(titreGauche);
    const memeNom = !!nomGauche && nomGauche === normaliserNomLieu(titreDroit);
    const sameName = memeNom || sameTitle(titreGauche, titreDroit);
    const typoCrossProvider = !sameName && existing.source !== item.source &&
      titlesNearlySame(titreGauche, titreDroit);

    if (!sameName && !typoCrossProvider) {
      /* Reste l'adresse. Deux relevés du même établissement peuvent
         l'orthographier autrement tout en donnant le même numéro dans la même
         rue ; à quelques dizaines de mètres, c'est une preuve suffisante. */
      const adresse = adresseComparable(existing);
      if (!adresse || adresse !== adresseComparable(item)) return false;
      if (distance > DEDUP_RADIUS.adresse) return false;
      return memeFenetre(existing, item);
    }

    const limite = typoCrossProvider ? DEDUP_RADIUS.typo
      : (estEtendu(existing) || estEtendu(item) ? DEDUP_RADIUS.nommeEtendu : DEDUP_RADIUS.nomme);
    if (distance > limite) return false;
    return memeFenetre(existing, item);
  }

  function dedupeItems(items, distanceBetween, options) {
    const result = [];
    /* Toutes les heuristiques géographiques sont bornées à 500 m. Parcourir
       toute la collection pour chaque fiche rendait pourtant l'ingestion
       quadratique. La grille ne DÉCIDE rien : elle ne fait que fournir les
       voisins possibles ; `memeEnregistrement` reste l'unique règle et les
       indices sont triés pour conserver exactement le premier rapprochement
       qu'aurait trouvé `findIndex`. Les identifiants stables gardent leur
       index séparé, car eux valent preuve même si les coordonnées divergent. */
    const pas = 0.004;
    const grille = new Map();
    const parId = new Map();
    const parRef = new Map();
    const cellule = (item) => {
      const lat = Number(item && item.latitude);
      const lng = Number(item && item.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng)
        ? [Math.floor(lat / pas), Math.floor(lng / pas)] : null;
    };
    const enregistrer = (item, index) => {
      if (item && item.id != null) parId.set(String(item.id), index);
      identifiantsExternes(item).forEach((ref) => parRef.set(ref, index));
      const c = cellule(item);
      if (!c) return;
      const cle = c[0] + ":" + c[1];
      if (!grille.has(cle)) grille.set(cle, new Set());
      grille.get(cle).add(index);
    };
    const candidats = (item) => {
      const indices = new Set();
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
      const found = candidats(item).find((index) =>
        memeEnregistrement(result[index], item, distanceBetween, options));
      if (found === undefined) {
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

  /* ---- Regroupement logique ----------------------------------------------
     dedupeItems() répond à « ces deux fiches sont-elles le même enregistrement
     vu par deux sources ? ». Ce n'est pas la même question que « ces objets
     désignent-ils le même endroit pour quelqu'un qui regarde la carte ? ».

     Un pôle d'échange comme Phalempins existe dans OpenStreetMap sous la forme
     d'une station de métro, de deux bouches de métro, d'un arrêt de bus par
     sens et parfois d'un arrêt de tram — objets distincts, légitimement, pour
     qui cartographie le réseau. Sur la carte d'Autour, c'est UN endroit. Les
     titres ne sont pas identiques (« Phalempins », « Métro Phalempins »,
     « Phalempins - Quai 2 ») et les distances dépassent les 120 m du
     dédoublonnage : aucune des deux conditions de dedupeItems n'est remplie,
     et six pastilles se superposaient.

     On regroupe donc par famille d'usage + nom normalisé + proximité, avec un
     rayon propre à chaque famille : large pour un pôle de transport qui
     s'étale sur un carrefour, serré pour des commerces qui se touchent sans
     être le même. Rien n'est supprimé — les membres restent attachés au
     représentant, et l'ETA comme les itinéraires continuent de les voir. */

  const TRANSPORT_CATEGORIES = Object.freeze(["metro", "bus", "tram", "train", "velo"]);

  /* Mots qui décrivent le rôle de l'objet, pas l'endroit. « Métro Phalempins »
     et « Arrêt Phalempins » nomment le même lieu ; les retirer fait apparaître
     le nom réel. La liste reste courte et explicite : deviner large ferait
     fusionner « Gare » et « Gare Saint-Sauveur ». */
  const TRANSPORT_ROLE_WORDS = /\b(gare|station|arret|halte|metro|tram|tramway|bus|autobus|quai|voie|acces|entree|sortie|bouche|platform|stop|parking velo|velo|station velo)\b/g;
  const NAME_NOISE = /\b(le|la|les|l|du|de|des|d|the|saint|st)\b/g;

  function normalizePlaceName(value, family) {
    let text = normalizeText(value);
    if (family === "transport") {
      text = text.replace(TRANSPORT_ROLE_WORDS, " ");
      /* « Phalempins - Quai 2 », « Phalempins (direction CHU) » : le numéro de
         quai ou la direction distingue deux objets du MÊME lieu.
         Uniquement pour un transport : ailleurs, le chiffre fait partie du nom
         et l'effacer confondait « Bistrot 33 » avec « Bistrot 44 » — deux
         adresses différentes réduites à un seul marqueur. */
      text = text.replace(/\b\d+\b/g, " ").replace(/\bdirection\b.*$/, " ");
    }
    return text.replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim();
  }

  function placeFamily(item) {
    if (!item) return "autre";
    const categories = [item.cat, ...(item.categories || [])];
    if (categories.some((category) => TRANSPORT_CATEGORIES.includes(category))) return "transport";
    return "autre";
  }

  /* Rayons choisis d'après la réalité du terrain, pas au jugé, et distincts
     selon la force de la preuve :

       · `exact` — les deux noms normalisés sont IDENTIQUES. C'est la preuve
         la plus forte, on accepte donc une distance plus grande : un pôle
         d'échange s'étale sur un carrefour entier, et deux relevés du même
         commerce importés de sources différentes dérivent d'une centaine de
         mètres.
       · `inclus` — l'un des noms contient l'autre (« Gare Lille Flandres » et
         « Lille Flandres »). Preuve plus faible, donc rayon plus serré :
         sinon « Marché » et « Marché de Wazemmes » finiraient confondus.

     Deux boulangeries homonymes à 600 m restent deux boulangeries. */
  const GROUPING_RADIUS = Object.freeze({
    transport: { exact: 350, inclus: 300 },
    autre:     { exact: 200, inclus: 120 },
  });

  /* Renvoie la nature du rapprochement, ou null s'il n'y en a pas : c'est elle
     qui décide du rayon applicable. */
  function nameRelation(left, right) {
    if (!left || !right) return null;
    if (left === right) return "exact";
    // le plus court doit rester assez long pour ne pas être un mot
    // passe-partout — « gare » ou « parc » ne rapprochent rien
    const short = left.length <= right.length ? left : right;
    const long = short === left ? right : left;
    return short.length >= 5 && long.indexOf(short) !== -1 ? "inclus" : null;
  }

  /* Quel membre représente le groupe ? Celui qui porte le plus d'information :
     un objet nommé passe devant un objet anonyme, une station devant une
     bouche, et à égalité le plus proche du barycentre. */
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
    /* Même principe que pour le dédoublonnage : le rayon maximal est 350 m,
       donc seuls les groupes présents dans les cellules voisines peuvent
       convenir. Le test de famille, de nom et de distance reste inchangé. */
    const pas = 0.003;
    const grille = new Map();
    const cellule = (item) => {
      const lat = Number(item && item.latitude);
      const lng = Number(item && item.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng)
        ? [Math.floor(lat / pas), Math.floor(lng / pas)] : null;
    };
    const enregistrer = (item, index) => {
      const c = cellule(item);
      if (!c) return;
      const cle = c[0] + ":" + c[1];
      if (!grille.has(cle)) grille.set(cle, new Set());
      grille.get(cle).add(index);
    };
    const candidats = (item) => {
      const c = cellule(item);
      if (!c) return groups.map((_, index) => index);
      const indices = new Set();
      for (let x = c[0] - 2; x <= c[0] + 2; x += 1) {
        for (let y = c[1] - 2; y <= c[1] + 2; y += 1) {
          const proches = grille.get(x + ":" + y);
          if (proches) proches.forEach((index) => indices.add(index));
        }
      }
      return [...indices].sort((a, b) => a - b);
    };

    (items || []).forEach((item) => {
      // un événement daté n'est pas un lieu : deux concerts au même endroit
      // sont deux propositions distinctes, jamais un « hub »
      if (item.isTemporary) { groups.push({ members: [item], family: "evenement" }); return; }
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

      if (foundIndex !== undefined) {
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
      // le représentant hérite des appartenances de tout le groupe : chercher
      // « bus » doit encore trouver un pôle représenté par sa station de métro
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
        nbRegroupes: group.members.length,
      });
    });
  }

  /* ---- Requêtes composées ------------------------------------------------
     « cinéma Lille » demande deux choses à la fois : une intention et une
     destination. Jusqu'ici seule la forme avec préposition était comprise
     (« restaurant à Lille ») ; sans elle, la requête partait entière dans la
     recherche plein texte et la carte ne bougeait pas.

     On sépare donc avant d'interroger quoi que ce soit. Le vocabulaire des
     catégories vit dans l'application, pas ici : l'appelant fournit `isIntent`.
     On ne devine jamais qu'un mot est une ville — c'est le géocodeur qui
     tranche, et lui seul. */

  const PREPOSITIONS = /\s+(?:a|à|au|aux|sur|vers|dans|en|pres de|près de|autour de)\s+/i;
  const LEADING_PREPOSITION = /^(?:a|à|au|aux|sur|vers|dans|en|pres de|près de|autour de)\s+/i;
  const TRAILING_PREPOSITION = /\s+(?:a|à|au|aux|sur|vers|dans|en|de|du|des)$/i;

  function parseSearchQuery(query, options) {
    const settings = options || {};
    const isIntent = typeof settings.isIntent === "function" ? settings.isIntent : () => false;
    /* « Ce début de phrase est-il une intention ? » et « cette saisie entière
       est-elle une intention ? » ne sont pas la même question, et y répondre
       pareil cassait deux cas opposés :
         · en tête de phrase il faut être TOLÉRANT — « restaurant italien Lyon »
           n'est reconnu que si « restaurant italien » passe par sous-chaîne ;
         · sur la saisie entière il faut être STRICT — « Bar-le-Duc » contient
           « bar » et devenait une intention, donc n'était jamais géocodé.
       L'appelant fournit donc les deux ; à défaut, le comportement est le
       même qu'avant. */
    const isWholeIntent = typeof settings.isWholeIntent === "function"
      ? settings.isWholeIntent : isIntent;
    /* « Ce morceau peut-il être un lieu ? » — sans cette question, on coupait
       n'importe où pourvu que le début ressemble à une intention :
       « Lille restaurant indien » donnait la destination « indien ». */
    const isDestination = typeof settings.isDestination === "function"
      ? settings.isDestination : () => true;
    const raw = String(query || "").trim().replace(/\s+/g, " ");
    if (!raw) return { intention: "", destination: "", raw };

    /* On cherche la PLUS LONGUE intention reconnue qui laisse encore une
       destination — « activité enfant Tourcoing » doit donner « activité
       enfant », pas « activité ».

       Ce balayage passe AVANT la découpe par préposition, et pas l'inverse :
       toutes les prépositions ne séparent pas une destination. « bar à vin
       Roubaix » coupé sur « à » donnait la destination « vin Roubaix ». Le
       vocabulaire de l'application sait, lui, que « bar à vin » est une seule
       intention ; la préposition ne sert que de repli. */
    const words = raw.split(" ");
    const propre = (t, motif) => t.replace(motif, "").trim();

    // 1. intention d'abord, destination ensuite — « cinéma Lille »
    for (let cut = words.length - 1; cut >= 1; cut -= 1) {
      const head = propre(words.slice(0, cut).join(" "), TRAILING_PREPOSITION);
      const tail = propre(words.slice(cut).join(" "), LEADING_PREPOSITION);
      if (!head || !tail) continue;                  // « restaurant à » ne vise rien
      if (isIntent(head) && isDestination(tail)) return { intention: head, destination: tail, raw };
    }

    /* 2. destination d'abord — « Lille restaurant indien », « Paris cinéma ».
       C'est une façon de taper au moins aussi courante que l'autre, et elle
       n'était pas prévue : la requête partait entière au géocodeur, qui ne
       trouvait rien, et la carte ne bougeait pas. */
    for (let cut = 1; cut < words.length; cut += 1) {
      const head = propre(words.slice(0, cut).join(" "), TRAILING_PREPOSITION);
      const tail = propre(words.slice(cut).join(" "), LEADING_PREPOSITION);
      if (!head || !tail) continue;
      if (isDestination(head) && isIntent(tail)) return { intention: tail, destination: head, raw };
    }

    /* 3. repli : une préposition sépare explicitement, même sans vocabulaire
       connu — mais seulement si ce qu'elle laisse à droite peut être un lieu.
       Sans cette condition, « bar à vin » partait chercher la commune « vin ». */
    const byPreposition = raw.split(PREPOSITIONS);
    if (byPreposition.length === 2 && byPreposition[0].trim() && byPreposition[1].trim()
        && isDestination(byPreposition[1].trim())) {
      return { intention: byPreposition[0].trim(), destination: byPreposition[1].trim(), raw };
    }

    /* 4. rien à couper. Une phrase qui COMMENCE par un mot du vocabulaire est
       une demande, pas un nom de lieu : « restaurant indien » est une
       intention entière, quand « Bar-le-Duc » — un seul mot, absent du
       vocabulaire — est une commune. */
    if (isWholeIntent(raw)) return { intention: raw, destination: "", raw };
    if (words.length > 1 && isWholeIntent(words[0])) return { intention: raw, destination: "", raw };
    return { intention: "", destination: raw, raw };
  }

  /* Les horaires d'un lieu, lus par le module qui fait autorité là-dessus.
     Passé au moteur temporel plutôt que réimplémenté : une exposition longue a
     besoin de la même lecture qu'un café. */
  const disponibiliteMemo = new WeakMap();
  function disponibiliteDe(item, at, arrival) {
    const module = root.AutourAvailability;
    if(!module) return null;
    if(!item || (typeof item !== "object" && typeof item !== "function"))
      return module.getPlaceAvailability(item, at, arrival);
    let cache = disponibiliteMemo.get(item);
    if(!cache){ cache = new Map(); disponibiliteMemo.set(item, cache); }
    const temporaire = item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat);
    const cleTemps = temporaire ? Number(at) : Math.floor(Number(at) / 60000);
    const cleArrivee = arrival == null ? ""
      : (temporaire ? Number(arrival) : Math.floor(Number(arrival) / 60000));
    const cle = cleTemps + "|" + cleArrivee;
    if(cache.has(cle)) return cache.get(cle);
    const resultat = module.getPlaceAvailability(item, at, arrival);
    if(cache.size >= 4) cache.clear();
    cache.set(cle, resultat);
    return resultat;
  }

  function isAvailableNow(item, at) {
    const now = at == null ? Date.now() : Number(at);
    const temps = root.AutourTemps;

    /* Le moteur temporel décide, et lui seul. L'ancienne règle acceptait tout
       ce qui commençait dans les douze heures — et surtout, elle acceptait un
       événement SANS date : `startsAt` nul ne déclenchait aucun refus, si bien
       qu'un événement dont la date n'avait pas pu être lue passait pour un
       événement en cours. C'est ce qui remplissait « maintenant » de choses
       prévues des semaines plus tard. */
    if (temps) {
      const etat = temps.statutTemporel(item, now, { disponibilite: disponibiliteDe });
      if (item.isTemporary) return temps.estMaintenant(etat.status || etat.statut);
      return etat.status === "now" && ["open_now", "closing_soon"].includes(etat.openingStatus);
    }

    // repli si le module n'est pas chargé : au moins ne rien affirmer de faux
    if (item.isTemporary) {
      if (item.startsAt == null) return false;
      if (item.endsAt != null && item.endsAt < now) return false;
      return item.startsAt <= now + 2 * 3600 * 1000;
    }
    const dispo = disponibiliteDe(item, now);
    if (dispo && dispo.status === "permanently_closed") return false;
    if (dispo && dispo.status !== "unknown") return dispo.isOpenNow;
    if (item.ouvert === true) return true;
    if (item.ouvert === false) return false;
    return false;
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
    /* L'accueil n'est ni une recherche Manger ni une recherche Sortir : il
       doit faire remonter ce qui mérite un détour dans l'immédiat. Les
       événements, activités, culture et marchés reçoivent donc une vraie
       correspondance exacte ; un simple commerce ne peut les devancer. */
    explorer: Object.freeze({
      categories:["event", "studio", "concert", "spectacle", "show", "bar", "cinema",
        "musee", "museum", "culture", "marche", "food", "sport", "terrain",
        "swimming_pool", "parc", "park", "resto", "fastfood", "cafe"],
      exact:["event", "studio", "concert", "spectacle", "bar", "cinema", "musee",
        "museum", "culture", "marche", "food", "sport", "terrain", "swimming_pool"],
      open:115, event:205, distance:88, distanceScale:2200, rating:8,
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
    // besoins secondaires : ils vivent derrière « Plus » dans l'interface,
    // mais ils ont besoin d'un profil propre pour être classés correctement
    etudier: Object.freeze({
      categories: ["study", "biblio", "library", "coworking", "cafe", "services"],
      exact: ["biblio", "library", "coworking", "study"],
      open: 190, event: 40, distance: 110, distanceScale: 1800, rating: 4,
    }),
    culture: Object.freeze({
      categories: ["culture", "musee", "museum", "cinema", "spectacle", "show", "concert", "studio", "biblio", "library"],
      exact: ["musee", "museum", "cinema", "spectacle", "concert", "culture"],
      open: 115, event: 170, distance: 80, distanceScale: 2400, rating: 8,
    }),
    // « Bouger » remplace l'ancien besoin « Sport » : même intention, un mot
    // qu'on emploie vraiment. L'ancien identifiant reste accepté.
    bouger: Object.freeze({
      categories: ["sport", "terrain", "swimming_pool", "velo", "park", "parc"],
      exact: ["sport", "terrain", "swimming_pool"],
      open: 140, event: 130, distance: 100, distanceScale: 2000, rating: 5,
    }),
    sport: Object.freeze({
      categories: ["sport", "terrain", "swimming_pool", "velo", "park", "parc"],
      exact: ["sport", "terrain", "swimming_pool"],
      open: 140, event: 130, distance: 100, distanceScale: 2000, rating: 5,
    }),
    // « Chiller » : s'asseoir quelque part sans but précis. L'ouverture compte
    // plus que la note, et la proximité plus que tout.
    chiller: Object.freeze({
      categories: ["cafe", "bar", "parc", "park", "biblio", "library", "outing"],
      exact: ["cafe", "parc", "park", "biblio", "library"],
      open: 175, event: 45, distance: 135, distanceScale: 1400, rating: 6,
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

  function isDiscoveryCandidate(item) {
    if (!item) return false;
    if (item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat)) return true;
    return ![item.cat, ...(item.categories || [])]
      .some((category) => DISCOVERY_EXCLUDED_CATEGORIES.has(category));
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

  /* ---- Estimation de proximité ------------------------------------------
     Le classement utilise uniquement une estimation locale à pied lorsqu'aucun
     temps explicite n'est fourni. Les trajets voiture et transports collectifs
     sont désormais délégués aux applications de navigation externes. */
  const ARRIVAL_GRACE_MS = 15 * 60000;
  const EVENT_DEPARTURE_WINDOW_MS = 2 * 3600 * 1000;

  function walkingEta(distance) {
    const minutes = travelMinutes(distance);
    if (minutes == null) return null;
    return Object.freeze({
      minutes, walkMinutes: minutes, waitMinutes: 0, rideMinutes: 0,
      transfers: 0, mode: "walk", realtime: false, confidence: "estimated",
    });
  }

  function resolveEta(ctx, item, distance) {
    const provided = typeof ctx.etaFor === "function" ? ctx.etaFor(item, distance) : null;
    if (provided && Number.isFinite(Number(provided.minutes))) {
      return Object.assign({
        walkMinutes: null, waitMinutes: null, rideMinutes: null, transfers: 0,
        mode: "transit", realtime: false, confidence: "planned",
      }, provided, {minutes: Number(provided.minutes)});
    }
    return walkingEta(distance);
  }

  function closingTime(item) {
    return parseTime(item.closesAt != null ? item.closesAt
      : (item.fermeA != null ? item.fermeA : item.closingAt));
  }

  /* Que vaut ce lieu une fois qu'on y est vraiment ? Réponse en trois temps :
     réalisable, dégradé, ou hors-jeu. Un restaurant qui ferme avant l'arrivée
     et un concert déjà commencé depuis une heure ne sont pas des résultats. */
  function arrivalOutlook(item, arrival, temporary, startsAt, endsAt, now) {
    if (arrival == null) return {state: "unknown", score: 0, reason: ""};

    if (temporary) {
      if (endsAt != null && endsAt <= arrival) {
        return {state: "missed", score: -1000, reason: "Terminé avant votre arrivée"};
      }
      // un événement déjà commencé au moment de la recherche est « en cours »,
      // pas « raté » : on n'arrive pas en retard à une expo ouverte toute la
      // journée. Le contrôle d'horaire ne vaut que pour ce qui n'a pas commencé.
      if (startsAt == null || (now != null && startsAt <= now)) return {state: "open", score: 0, reason: ""};
      if (arrival <= startsAt) {
        /* Pour un événement de demain, partir maintenant n'est pas le scénario
           de la personne. Le déclarer « faisable » parce qu'elle arriverait
           vingt-trois heures trop tôt donnait à tous les événements lointains
           la même priorité qu'à ceux de ce soir, avec des raisons absurdes du
           type « 1 435 min avant le début ». On ne juge un départ immédiat que
           dans la fenêtre où il est réellement plausible. */
        if (now != null && startsAt - now > EVENT_DEPARTURE_WINDOW_MS)
          return {state: "scheduled", score: 0, reason: ""};
        const early = Math.round((startsAt - arrival) / 60000);
        return {
          state: "onTime", score: 60,
          reason: early <= 5 ? "Vous arrivez juste à temps" : "Vous y êtes " + early + " min avant le début",
        };
      }
      const late = Math.round((arrival - startsAt) / 60000);
      if (arrival - startsAt <= ARRIVAL_GRACE_MS) {
        return {state: "late", score: 15, reason: "Commencé, vous arrivez " + late + " min après"};
      }
      return {state: "tooLate", score: -260, reason: "Déjà commencé depuis " + late + " min"};
    }

    // ---- lieux permanents : la disponibilité fait autorité ----------------
    // Une seule source de vérité pour les horaires (voir availability.js) ;
    // le classement ne relit jamais un opening_hours de son côté.
    const dispo = disponibiliteDe(item, now, arrival);

    if (dispo && dispo.status === "permanently_closed") {
      // définitivement fermé : jamais recommandé, quel que soit le mode
      return {state: "permanentlyClosed", score: -100000, reason: dispo.label, dispo};
    }

    if (dispo && dispo.status !== "unknown") {
      if (dispo.isOpenAtArrival === false) {
        return {state: "closedOnArrival", score: -1000, reason: "Fermé à votre arrivée", dispo};
      }
      if (!dispo.isOpenNow) {
        // fermé maintenant mais atteignable plus tard : utile hors mode
        // « Maintenant », écarté dedans
        return {state: "closedNow", score: -400, reason: dispo.label, dispo};
      }
      if (dispo.meetsMargin === false) {
        // ouvert à l'arrivée, mais trop peu de temps pour que ça vaille le
        // déplacement — c'est le musée à 17:57
        return {state: "closingSoon", score: -220, reason: dispo.reason || dispo.label, dispo};
      }
      if (dispo.status === "closing_soon") {
        return {state: "closingSoon", score: -120, reason: dispo.reason || dispo.label, dispo};
      }
      return {state: "open", score: 0, reason: dispo.label, dispo};
    }

    // ---- repli : horaires illisibles, mais une heure de fermeture connue --
    const closes = closingTime(item);
    if (closes != null && closes <= arrival) {
      return {state: "closedOnArrival", score: -1000, reason: "Fermé à votre arrivée", dispo};
    }
    if (closes != null && closes - arrival <= 30 * 60000) {
      const left = Math.round((closes - arrival) / 60000);
      return {state: "closingSoon", score: -60, reason: "Ferme " + left + " min après votre arrivée", dispo};
    }
    return {state: "open", score: 0, reason: "", dispo};
  }

  function etaLabel(eta) {
    if (!eta || !Number.isFinite(eta.minutes)) return "";
    const suffix = eta.realtime ? " (temps réel)" : "";
    if (eta.mode === "walk") return eta.minutes + " min à pied" + suffix;
    if (eta.transfers > 0) return eta.minutes + " min · " + eta.transfers + " corresp." + suffix;
    return eta.minutes + " min" + suffix;
  }

  /* Pertinence textuelle d'un lieu pour une requête : titre d'abord, puis
     catégorie et adresse. Rend 0 quand aucune requête n'est posée, ce qui
     laisse le classement inchangé. */
  function searchRelevance(item, query) {
    const q = normalizeText(query);
    if (!q) return 0;
    const mots = q.split(" ").filter((m) => m.length > 2);
    if (!mots.length) return 0;
    const titre = normalizeText(item.title || item.titre);
    const reste = normalizeText([item.cat, item.adresse, item.cuisine,
      ...(item.categories || [])].filter(Boolean).join(" "));
    let score = 0;
    mots.forEach((mot) => {
      if (titre === mot) score += 1;
      else if (titre.includes(mot)) score += .7;
      else if (reste.includes(mot)) score += .35;
    });
    return Math.min(1, score / mots.length);
  }

  /* Le nombre d'avis tempère la note : 4,9 sur trois avis ne vaut pas 4,5 sur
     huit cents. Croissance logarithmique, bornée. */
  function reviewWeight(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(1, Math.log10(n + 1) / 3);
  }

  /* LA PROXIMITÉ EST UN PALIER, PAS UNE GRADUATION.

     Comparée à la minute, la distance décidait de tout : elle passe avant la
     qualité des données et avant le score, et deux lieux ne sont pratiquement
     jamais à la même minute. Un lieu à 140 m devançait donc mécaniquement
     toute proposition plus intéressante à 350 m — alors que la différence
     vécue entre les deux est nulle : c'est le même « à côté ».

     On compare donc des paliers de trajet. À l'intérieur d'un palier, ce sont
     la pertinence, la qualité et le score qui tranchent ; entre deux paliers,
     la proximité reprend tous ses droits — vingt minutes de marche ne sont pas
     deux minutes. La distance exacte reste le dernier départage de la liste,
     après le score, pour que l'ordre demeure stable et déterministe. */
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

  /* Le départage fin, relégué en toute fin de tri : à pertinence, qualité et
     score égaux, le plus proche passe devant. */
  function compareDistanceFine(a, b) {
    const left = a.rankBreakdown.etaMinutes;
    const right = b.rankBreakdown.etaMinutes;
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    return a.rankBreakdown.distance - b.rankBreakdown.distance;
  }

  /* La priorité temporelle est volontairement discrète : un événement n'est
     pas seulement « plus ou moins loin dans le futur ». L'ordre produit est
     celui qui aide réellement à décider : en cours → imminent → aujourd'hui
     → demain → cette semaine → futur. La date exacte ne départage qu'à
     l'intérieur d'un même groupe. */
  function eventTemporalBucket(item, now) {
    if (!item || !item.rankBreakdown || !item.rankBreakdown.temporary) return null;
    const temporal = item.rankTemporalCanonical || item.rankTemporal;
    const start = item.rankStart;
    const temps = root.AutourTemps;
    if (temporal === "now" || (temps && temporal === temps.STATUTS.EN_COURS)) return 0;
    if (temporal === "soon" || (temps && temporal === temps.STATUTS.IMMINENT)) return 1;
    if (!Number.isFinite(start)) return 6; // date inconnue : utile, jamais prioritaire

    const timeZone = item.timezone || item.timeZone || temps?.DEFAULT_TIMEZONE;
    const localDay = (value) => {
      if (temps && typeof temps.partsLocales === "function") {
        const p = temps.partsLocales(value, timeZone);
        return Date.UTC(p.annee, p.mois - 1, p.jour) / 86400000;
      }
      const d = new Date(value);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
    };
    const daysAway = localDay(start) - localDay(now);
    if (daysAway <= 0) return 2;
    if (daysAway === 1) return 3;
    if (daysAway <= 7) return 4;
    return 5;
  }

  /* Entre deux événements, le groupe temporel décide avant tous les signaux
     souples, puis la date réelle avant le trajet. Une série récurrente est
     ainsi classée sur sa prochaine séance et non sur un `startsAt` périmé. */
  function compareEventDate(a, b) {
    if (!a.rankBreakdown.temporary || !b.rankBreakdown.temporary) return 0;
    const now = Math.min(
      Number.isFinite(a.rankStart) ? a.rankStart : Infinity,
      Number.isFinite(b.rankStart) ? b.rankStart : Infinity,
    );
    /* `rankTemporal` est calculé avec le même `now` par rankResults. On le
       transporte explicitement pour garder ce comparateur pur et testable. */
    const reference = Number.isFinite(a.rankNow) ? a.rankNow
      : Number.isFinite(b.rankNow) ? b.rankNow : now;
    const bucketA = eventTemporalBucket(a, reference);
    const bucketB = eventTemporalBucket(b, reference);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const left = a.rankBreakdown.temporalDistance;
    const right = b.rankBreakdown.temporalDistance;
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
    return 0;
  }

  /* ======================================================================
     DIVERSITÉ

     Une sortie brute d'un catalogue géographique met quatre parcs en tête
     parce que la ville en compte quatre à trois cents mètres. Ce n'est pas une
     sélection, c'est un inventaire trié par distance — et ça se lit exactement
     comme ça.

     CE QUE FAIT CETTE PASSE, ET SURTOUT CE QU'ELLE NE FAIT PAS.

     Elle RÉORDONNE une fenêtre de tête déjà classée. Elle n'ajoute rien,
     n'invente rien, n'écarte rien : les mêmes résultats sortent, dans un ordre
     où les premières lignes ne répètent pas la même nature. Un remplaçant
     n'est promu que si son score reste dans une marge étroite de celui qu'il
     devance — sans quoi on troquerait une bonne proposition contre une moins
     bonne au seul motif qu'elle est différente, ce qui est exactement le
     travers inverse. Quand aucun candidat acceptable n'existe, la répétition
     est conservée : deux bons parcs valent mieux qu'un parc et un médiocre.
     ====================================================================== */

  const DIVERSITE = Object.freeze({
    fenetre: 8,               // les premières lignes, celles qu'on lit vraiment
    maxParSousCategorie: 2,   // le plafond dur demandé
    maxParFamille: 2,         // trois façons de manger ne font pas une variété
    tolerance: .18,           // marge de score pour préférer une autre nature
    toleranceLarge: .32,      // marge élargie une fois le plafond dur atteint
  });

  /* Les grandes natures de proposition. La sous-catégorie reste le critère
     principal — c'est elle qui produit « parc, parc, parc, parc » — mais sans
     une seconde maille, trois façons de manger d'affilée passeraient pour de
     la variété. */
  const FAMILLES_DIVERSITE = Object.freeze({
    resto:"manger", fastfood:"manger", cafe:"manger", marche:"manger", food:"manger",
    bar:"sortir", concert:"sortir", spectacle:"sortir", cinema:"sortir",
    studio:"sortir", popup:"sortir",
    event:"evenement", rencontre:"evenement", collecte:"evenement",
    parc:"dehors", park:"dehors", terrain:"dehors", sport:"dehors",
    swimming_pool:"dehors", velo:"dehors",
    musee:"culture", biblio:"culture", coworking:"culture",
  });

  function sousCategorieDe(item) {
    if (!item) return "autre";
    if (item.sousCat) return String(item.sousCat);
    if (item.foodSpecialty) return "food:" + String(item.foodSpecialty);
    if (item.canonicalCategory) return String(item.canonicalCategory);
    if (item.cat) return String(item.cat);
    return (item.categories || [])[0] || "autre";
  }

  function familleDiversite(item) {
    if (item && item.canonicalFamily === "food") return "manger";
    const sous = sousCategorieDe(item);
    if (sous.startsWith("food:")) return "manger";
    return FAMILLES_DIVERSITE[sous] || "autre";
  }

  function scoreDiversite(item) {
    const score = Number(item && item.rankScore);
    return Number.isFinite(score) ? score : 0;
  }

  function diversifierResultats(results, options) {
    const o = options === true ? {} : (options || {});
    const liste = (results || []).slice();
    if (liste.length <= 2) return liste;

    const fenetre = Math.max(1, Number(o.fenetre) || DIVERSITE.fenetre);
    const max = Math.max(1, Number(o.maxParSousCategorie) || DIVERSITE.maxParSousCategorie);
    const maxFamille = Math.max(1, Number(o.maxParFamille) || DIVERSITE.maxParFamille);
    const tolerance = o.tolerance == null ? DIVERSITE.tolerance : Number(o.tolerance);
    const toleranceLarge = o.toleranceLarge == null
      ? DIVERSITE.toleranceLarge : Number(o.toleranceLarge);
    /* Un remplaçant se cherche dans le voisinage immédiat de la fenêtre, pas
       au fond de la liste : promouvoir le trentième résultat pour varier
       reviendrait à dégrader la sélection. */
    const portee = fenetre * 2;

    const restants = liste.slice();
    const choisis = [];
    const vues = new Map();
    const familles = new Map();
    const compteSous = (item) => vues.get(sousCategorieDe(item)) || 0;
    const compteFamille = (item) => familles.get(familleDiversite(item)) || 0;

    while (choisis.length < fenetre && restants.length) {
      const tete = restants[0];
      let indice = 0;
      /* Deux mailles, et il suffit que l'une des deux soit tendue : la
         sous-catégorie — c'est elle qui produit « parc, parc, parc, parc » —
         et la famille, sans quoi trois façons de manger d'affilée passeraient
         pour de la variété. */
      const dejaVu = compteSous(tete);
      const dejaVuFamille = compteFamille(tete);
      if (dejaVu >= 1 || dejaVuFamille >= maxFamille) {
        const reference = scoreDiversite(tete);
        const marge = (dejaVu >= max || dejaVuFamille >= maxFamille) ? toleranceLarge : tolerance;
        const plancher = reference - Math.abs(reference) * marge;
        /* Le premier candidat de qualité comparable qui apporte une nature
           encore absente — et qui ne surcharge pas une famille déjà nourrie. */
        let remplacant = restants.findIndex((item, i) => i > 0 && i < portee &&
          scoreDiversite(item) >= plancher && compteSous(item) === 0 &&
          compteFamille(item) < maxFamille && compteFamille(item) <= dejaVuFamille);
        /* Rien d'inédit : on se contente d'une famille différente, toujours à
           qualité comparable. */
        if (remplacant < 0) remplacant = restants.findIndex((item, i) => i > 0 && i < portee &&
          scoreDiversite(item) >= plancher && compteSous(item) < max &&
          compteFamille(item) < maxFamille &&
          familleDiversite(item) !== familleDiversite(tete));
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
    const deduped = dedupeItems(results || [], distanceBetween, {
      preserveDistinctEvents: !!ctx.preserveDistinctEvents,
    });

    /* ---- Filtrage temporel, AVANT toute notion de pertinence --------------
       La proximité et les centres d'intérêt ne doivent jamais faire remonter
       un événement futur dans « maintenant ». On tranche donc le temps en
       premier, sur la seule autorité du moteur temporel, et on ne calcule un
       score que sur ce qui a survécu. */
    const temps = root.AutourTemps;
    const survivants = [];
    deduped.forEach((item) => {
      const startsAt = parseTime(item.startsAt != null ? item.startsAt : item.debutLe,
        item.timezone || item.timeZone);
      const endsAt = parseTime(item.endsAt != null ? item.endsAt : item.finLe,
        item.timezone || item.timeZone);
      const temporary = item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat);
      const date = Object.assign({}, item, {startsAt, endsAt, isTemporary: temporary});
      const etat = temps ? temps.statutTemporel(date, now, { disponibilite: disponibiliteDe }) : null;

      // un événement terminé n'est plus un résultat, à aucun créneau
      if (temporary && etat && etat.status === temps.STATUTS_TEMPORELS.PAST) return;
      if (temporary && !etat && endsAt != null && endsAt < now) return;
      if (ctx.nowOnly) {
        /* `etat` vient d'être calculé, parfois au prix d'une lecture complète
           des horaires. Le repasser à isAvailableNow recalculait exactement le
           même statut pour chaque candidat. On applique ici la même règle sur
           cet état déjà disponible, et on ne garde l'ancien chemin qu'en repli
           quand le moteur temporel n'est pas chargé. */
        const disponible = temps && etat
          ? (temporary
            ? temps.estMaintenant(etat.status || etat.statut)
            : (etat.status === "now" && ["open_now", "closing_soon"].includes(etat.openingStatus)))
          : isAvailableNow(date, now);
        if (!disponible) return;
      }

      survivants.push({ item, startsAt, endsAt, temporary, etat });
    });

    /* ---- Contraintes dures, avant tout calcul de pertinence --------------
       Une contrainte exclut ; une préférence ordonne. Les mélanger donne soit
       des écrans vides (« moins de 15 € » appliqué comme un tri), soit des
       résultats hors sujet (« accessible » traité comme un simple bonus).
       Et une donnée INCONNUE ne vaut jamais « non » : un lieu dont on ignore
       le prix n'est pas un lieu trop cher. */
    const intention = ctx.intention || null;
    const signaux = root.AutourSignaux;
    const profilDe = (item) => {
      if (!signaux) return null;
      if (!item.__signaux) {
        try { Object.defineProperty(item, "__signaux", { value: signaux.signauxDe(item), enumerable: false }); }
        catch (e) { return signaux.signauxDe(item); }
      }
      return item.__signaux;
    };

    function contrainteRefusee(item, contrainte, profil, dispo) {
      if (contrainte.type === "budget") {
        const max = Number(contrainte.max);
        if (max === 0) {
          // gratuit demandé : on n'exclut que ce qu'on SAIT payant
          if (item.gratuit === true) return false;
          if (item.gratuit === false) return true;
          return Number(item.prix) > 0;
        }
        const prix = Number(item.prix);
        if (Number.isFinite(prix) && prix > 0) return prix > max;
        // le niveau de prix Google : 1 ≈ 10 €, 2 ≈ 20 €, 3 ≈ 40 €, 4 ≈ 70 €
        const paliers = [0, 12, 25, 45, 80];
        const n = Number(item.prixN);
        if (Number.isFinite(n) && paliers[n] != null) return paliers[n] > max;
        return false;                       // prix inconnu : on ne tranche pas
      }
      if (contrainte.type === "signal") {
        const ok = signaux ? signaux.satisfait(profil, contrainte.id) : null;
        return ok === false;                // inconnu : on laisse passer
      }
      if (contrainte.type === "ouvertApres") {
        if (!dispo || dispo.status === "unknown" || !dispo.closesAtTime) return false;
        const [h, m] = String(dispo.closesAtTime).split(":").map(Number);
        if (!Number.isFinite(h)) return false;
        /* Une fermeture à 02:00 est PLUS TARD que 21:00, pas plus tôt : c'est
           le lendemain. Sans ce report, « ouvert tard » écartait précisément
           les lieux qui ferment le plus tard. */
        let fin = h * 60 + (m || 0);
        if (fin <= 6 * 60) fin += 24 * 60;
        return fin < contrainte.minutes;
      }
      return false;
    }

    /* Un arrêt de métro ou une station de vélos sert à ALLER quelque part ;
       ce n'est pas un endroit où l'on va. Ces objets remontaient pourtant en
       tête de « Sortir » : ouverts 24 h/24, tout près, et rattachés à `sport`
       par le vélo. On ne les propose donc comme résultat que si le transport
       a été demandé explicitement. */
    const transportDemande = categories.some((c) => TRANSPORT_CATEGORIES.includes(c));

    const classes = survivants.map(({ item, startsAt, endsAt, temporary, etat }) => {
      if (!transportDemande && hasAnyCategory(item, TRANSPORT_CATEGORIES)) {
        /* Sauf s'il est vraiment autre chose : une gare qui est aussi un
           monument reste un monument. On compare donc les forces plutôt que
           de se contenter d'un seuil — une station de vélos tient à `sport`
           par 0,8, ce qui suffisait à la faire passer pour une sortie. */
        const forceTransport = bestCategoryWeight(item, TRANSPORT_CATEGORIES);
        const forceDemandee = bestCategoryWeight(item,
          categories.filter((c) => !TRANSPORT_CATEGORIES.includes(c)));
        if (forceDemandee < forceTransport) return null;
      }
      /* Les contraintes dures : elles excluent, et elles s'appliquent avant
         qu'on ait calculé le moindre point de pertinence. La proximité ne
         doit jamais rattraper un lieu qui coûte trois fois le budget. */
      /* Le profil de signaux sert à deux choses : l'adéquation à ce qui a été
         demandé, et la saison. Il n'était calculé que pour la première, si
         bien qu'un classement sans intention ignorait complètement le
         contexte saisonnier. */
      const profil = (intention || ctx.saison) ? profilDe(item) : null;
      if (intention && intention.contraintes.length) {
        const dispo = disponibiliteDe(item, now);
        const refuse = intention.contraintes.some((c) => contrainteRefusee(item, c, profil, dispo));
        if (refuse) return null;
      }

      // un lieu entre dans un besoin s'il y a une appartenance, même
      // secondaire — c'est ce qui fait qu'un parc sort dans Famille ET Sortir
      const categoryFit = bestCategoryWeight(item, categories);
      if (categoryFit <= 0) return null;

      const latitude = Number(item.latitude != null ? item.latitude : item.lat);
      const longitude = Number(item.longitude != null ? item.longitude : item.lng);
      const distance = distanceBetween(position[0], position[1], latitude, longitude);
      if (!Number.isFinite(distance) || distance > radius) return null;

      // ... mais il n'y pèse pas pareil : le poids sépare le cinéma qui est
      // une sortie de la brasserie qui en est vaguement une
      const exactWeight = bestCategoryWeight(item, profile.exact);
      const exactMatch = exactWeight >= .8;
      const intentMatch = exactMatch ? 2 : 1;
      let score = (exactMatch ? 145 : 105) + Math.round(categoryFit * 35 + exactWeight * 25);
      const quality = dataQuality(item);
      score += quality;
      /* Une publication Autour est une information fraîche posée par une
         personne du quartier. Elle est seulement avantagée APRÈS les filtres
         de pertinence, disponibilité et temporalité : elle ne peut donc pas
         faire remonter un événement fini, fermé ou hors sujet. */
      const community = item.source === "autour" || item.dbId != null ||
        (item.sources || []).includes("autour");
      if (community) score += 18;

      // pertinence de recherche : décisive quand une requête est posée,
      // sans effet quand il n'y en a pas
      const relevance = searchRelevance(item, ctx.requete);
      if (ctx.requete) {
        if (relevance <= 0) return null;      // hors sujet : on ne le montre pas
        score += relevance * 220;
      }
      /* Les préférences : elles ordonnent sans exclure. Une caractéristique
         demandée et VÉRIFIÉE vaut beaucoup ; inconnue, elle ne vaut ni bonus
         ni malus — sinon demander « calme » écarterait tout OpenStreetMap. */
      let adequation = 0;
      let signauxTenus = [];
      if (intention && signaux && profil) {
        const demandes = intention.preferences.filter((p) => p.type === "signal")
          .concat(intention.ambiance.map((a) => ({ type: "signal", id: a.id, poids: a.poids })))
          .concat(intention.contraintes.filter((c) => c.type === "signal"));
        const vus = new Set();
        let total = 0;
        let obtenu = 0;
        demandes.forEach((d) => {
          if (vus.has(d.id)) return;
          vus.add(d.id);
          const poids = d.poids == null ? 1 : d.poids;
          total += poids;
          const v = signaux.force(profil, d.id);
          if (v == null) return;                    // inconnu : neutre, ni bonus ni malus
          obtenu += v * poids;
          if (v >= .5) signauxTenus.push(d.id);
        });
        /* Normalisée : « à quel point ce lieu répond à ce qui a été demandé »,
           entre 0 et 1. Le poids qui suit doit dominer la distance — c'est
           l'ordre voulu : d'abord l'adéquation, la proximité ensuite. Une
           bibliothèque à deux kilomètres répond mieux à « où bosser » qu'un
           bar à cinquante mètres, et doit passer devant. */
        adequation = total > 0 ? obtenu / total : 0;
        score += adequation * 520;
      }

      /* La saison et l'heure, sans météo : le calendrier suffit à savoir qu'on
         ne cherche pas une terrasse un 15 janvier à 22 h. Ça ORDONNE, ça
         n'exclut pas — et seulement si le lieu porte réellement le signal. */
      if (signaux && profil && ctx.saison) {
        Object.entries(ctx.saison).forEach(([id, poids]) => {
          const v = signaux.force(profil, id);
          if (v == null) return;                  // inconnu : aucun effet
          score += v * poids * 90;
        });
      }

      /* ---- LE CONTEXTE TERRITORIAL TEMPORAIRE --------------------------

         Pas un second score : des POINTS DE PLUS, dans le même score, calculés
         par `territoire.js`. C'est la seule façon d'obtenir ce qu'on veut sans
         obtenir ce qu'on ne veut pas.

         Ce que ça change : pendant la manifestation, une activité en cours, un
         événement officiellement lié, une chose qui commence dans vingt
         minutes ou un lieu à l'intérieur du périmètre passent devant leurs
         semblables.

         Ce que ça NE PEUT PAS changer, et c'est délibéré : le tri regarde
         d'abord la faisabilité, puis la fenêtre temporelle. Un bonus de score
         n'y touche pas. Un événement terminé, un lieu fermé, un résultat hors
         sujet ne remontent donc jamais — et le bonus est borné, pour qu'aucune
         accumulation de signaux ne renverse l'adéquation à ce qui a été
         demandé. */
      if (ctx.territorial && root.AutourTerritoire) {
        score += root.AutourTerritoire.bonus(
          Object.assign({}, item, {isTemporary: temporary, startsAt, endsAt}),
          ctx.territorial.contexte,
          {maintenant: now, zone: ctx.territorial.zone || null,
           statut: etat ? etat.statut : null});
      }

      // le nombre d'avis conforte la note au lieu de la remplacer
      score += reviewWeight(item.avis) * 18;
      const poidsDistance = intention && intention.preferences.some((p) => p.type === "proche")
        ? profile.distance * 1.6 : profile.distance;
      score += poidsDistance * Math.exp(-distance / profile.distanceScale);

      const temporalStart = temporary && etat && etat.debut != null ? etat.debut : startsAt;
      const temporalDistance = temporary && temporalStart != null
        ? Math.max(0, temporalStart - now) : null;
      const temporalSection = temporary && etat && temps
        ? temps.sectionTemporelle(etat, now) : null;
      let availability = 2;
      let temporalReason = temporary && etat && temps
        ? temps.libelleTemporel(item, now, {statut: etat}) : "";
      const openingStatus = etat && etat.openingStatus;
      if (openingStatus === "open_now") {
        availability = 4;
        score += profile.open;
      } else if (openingStatus === "closing_soon") {
        availability = 2;
        score += profile.open * .35;
      } else if (openingStatus === "closed" || item.ouvert === false) {
        availability = 0;
        score -= ctx.nowOnly ? 1000 : 155;
      } else {
        score -= 12;
      }

      if (temporary) {
        // le statut vient du moteur : sur un événement récurrent c'est la
        // prochaine occurrence réelle qui compte, pas le début de la période
        const debut = temporalStart;
        const inProgress = etat
          ? etat.status === "now"
          : startsAt != null && startsAt <= now && (endsAt == null || endsAt >= now);
        const imminent = etat
          ? etat.status === "soon"
          : debut != null && debut >= now && debut - now <= 2 * 3600 * 1000;
        const minutesUntil = debut == null ? null : Math.round((debut - now) / 60000);
        if (inProgress) {
          availability = 6;
          score += profile.event + 70;
          temporalReason = "En cours";
        } else if (imminent && minutesUntil != null) {
          availability = 5;
          score += profile.event + Math.max(0, 120 - minutesUntil);
          temporalReason = "Commence dans " + Math.max(1, minutesUntil) + " min";
        } else if (debut != null) {
          /* La date est une disponibilité, pas un détail de score : ce soir
             peut rivaliser avec un lieu ouvert, ce week-end reste visible,
             tandis qu'un événement lointain ne passe plus automatiquement
             devant tout établissement ouvert. Le tri précis par date prend
             ensuite le relais entre événements d'un même horizon. */
          if (etat && ["today", "tonight", "weekend"].includes(etat.status))
            availability = Math.max(availability, 4);
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

      // le trajet réel, puis ce qu'il implique une fois sur place
      const eta = resolveEta(ctx, item, distance);
      const minutes = eta ? eta.minutes : null;
      const arrival = minutes == null ? null : now + minutes * 60000;
      // sur un événement récurrent, l'arrivée se juge par rapport à la
      // prochaine occurrence, pas au début de la période de récurrence
      const outlook = arrivalOutlook(item, arrival, temporary,
        temporalStart,
        // la fin réelle de l'occurrence, jamais la durée supposée : inventer
        // une fin ferait rater un événement dont on ignore la durée
        temporary && etat && etat.occurrence && etat.occurrence.fin != null
          ? etat.occurrence.fin : endsAt,
        now);

      score += outlook.score;
      // la faisabilité joue sur la disponibilité, pas seulement sur le score :
      // le tri regarde la disponibilité en premier et le score en dernier, donc
      // une pénalité de points ne suffirait pas à faire descendre un lieu
      // inatteignable de la première place
      // un lieu définitivement fermé n'est pas un résultat, jamais, quel que
      // soit le mode : ce n'est pas une question de disponibilité mais de
      // qualité de donnée
      if (outlook.state === "permanentlyClosed") return null;

      /* Hors service pour une raison que les horaires ne portent pas : un
         collège pendant les vacances scolaires est « ouvert » au sens d'OSM
         et pourtant fermé. On le relègue plutôt que de le supprimer — il
         reste une information, mais jamais une recommandation. */
      if (typeof ctx.horsService === "function" && ctx.horsService(item, now)) {
        availability = 0;
        score -= 400;
      }

      if (outlook.state === "missed" || outlook.state === "closedOnArrival" ||
          outlook.state === "closedNow") {
        // hors résultats en mode « maintenant », sinon relégué en fin de liste
        // plutôt que masqué en silence : un lieu fermé reste utile pour plus tard
        if (ctx.nowOnly) return null;
        availability = 0;
      } else if (outlook.state === "tooLate") {
        availability = Math.min(availability, 1);
      } else if (outlook.state === "closingSoon") {
        // ouvert à l'arrivée mais pour trop peu de temps : doit passer
        // derrière tout ce qui est réellement faisable, donc sous la valeur
        // par défaut d'un lieu dont on ignore l'horaire
        availability = Math.min(availability, 1);
      } else if (outlook.state === "onTime" || outlook.state === "late") {
        availability = Math.max(availability, 5);
      } else if (outlook.state === "open" && outlook.dispo) {
        // ouverture confirmée par l'horaire, pas seulement supposée
        availability = Math.max(availability, 4);
      }
      if (eta && eta.realtime) score += 10;

      const trip = etaLabel(eta);
      let rankReason;
      if (outlook.reason) rankReason = outlook.reason;
      else if (temporalReason) rankReason = temporalReason;
      else if (openingStatus === "open_now") rankReason = "Ouvert maintenant";
      else if (openingStatus === "closing_soon") rankReason = "Ferme bientôt";
      else if (openingStatus === "unknown") rankReason = "Horaires inconnus";
      else rankReason = "Le plus proche";
      if (trip) rankReason += " · " + trip;

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
        rankTemporalCanonical: etat ? etat.status : null,
        temporal: etat || null,
        openingStatus: openingStatus || null,
        rankSection: temporalSection,
        rankStart: temporalStart,
        rankNow: now,
        rankRelevance: relevance,
        rankBreakdown: {availability, intentMatch, distance, community:community ? 1 : 0,
          startsAt: temporalStart, temporalDistance, temporary, quality,
          categoryFit, etaMinutes: minutes, relevance,
          /* L'adéquation aux caractéristiques demandées, par quarts. Le tri
             regardait la distance bien avant le score : « où bosser » plaçait
             donc le bar d'en face devant la bibliothèque, parce qu'il est plus
             près et qu'il compte comme « sortie » dans le profil générique.
             L'ordre voulu est : ce qui est faisable, ce qui correspond à ce
             qui a été demandé, PUIS la distance. Par quarts, pour ne pas
             réordonner sur du bruit — et à zéro partout quand la requête ne
             demande aucune caractéristique, donc sans effet. */
          fit: Math.round(adequation * 4) / 4},
      });
    }).filter(Boolean).sort((a, b) =>
      /* La faisabilité reste le garde-fou absolu : une séance qu'on ne peut
         plus attraper ne doit pas devancer une proposition ouverte. Dès que
         deux événements sont faisables, leur fenêtre temporelle devient le
         critère principal : en cours, imminent, aujourd'hui, demain, semaine,
         futur. Pour un lieu pérenne face à un événement, compareEventDate
         renvoie 0 et le classement habituel reste intact. */
      b.rankBreakdown.availability - a.rankBreakdown.availability ||
      compareEventDate(a, b) ||
      (b.rankBreakdown.fit || 0) - (a.rankBreakdown.fit || 0) ||
      b.rankBreakdown.intentMatch - a.rankBreakdown.intentMatch ||
      (b.rankBreakdown.relevance || 0) - (a.rankBreakdown.relevance || 0) ||
      b.rankBreakdown.community - a.rankBreakdown.community ||
      // « le plus proche » se juge en temps de trajet réel, pas à vol d'oiseau :
      // un lieu à 400 m de l'autre côté du canal est plus loin qu'un lieu à 2 km
      // desservi directement
      compareEta(a, b) ||
      b.rankBreakdown.quality - a.rankBreakdown.quality ||
      b.rankScore - a.rankScore ||
      // à tout le reste égal, le plus proche : c'est un départage, plus un critère
      compareDistanceFine(a, b)
    );

    /* La diversité s'applique APRÈS le classement, et seulement quand
       l'appelant la demande — une recherche explicite (« pizzeria ») veut des
       pizzerias, pas de la variété. */
    return ctx.diversite ? diversifierResultats(classes, ctx.diversite) : classes;
  }

  root.AutourCore = Object.freeze({
    FAMILY_CATEGORIES,
    DISCOVERY_EXCLUDED_CATEGORIES,
    CATEGORY_RELATIONS,
    normalizeText,
    canonicalSlug,
    normalizeFoodSpecialty,
    taxonomieCanonique,
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
    etaLabel,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
