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
    const startsAt = parseTime(raw.startsAt != null ? raw.startsAt : (raw.debutLe != null ? raw.debutLe : raw.debut_le));
    const endsAt = parseTime(raw.endsAt != null ? raw.endsAt : (raw.finLe != null ? raw.finLe : raw.fin_le));
    const openingHours = raw.openingHours != null ? raw.openingHours : (raw.horaires || raw.quand || null);
    const isTemporary = raw.isTemporary != null
      ? !!raw.isTemporary
      : TEMPORARY_CATEGORIES.includes(raw.cat);
    const categoryWeights = classifyPlaceWeighted(Object.assign({}, raw, { title, source, isTemporary }));
    const categories = sortByWeight(categoryWeights);

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
    if (family === "transport") text = text.replace(TRANSPORT_ROLE_WORDS, " ");
    // « Phalempins - Quai 2 », « Phalempins (direction CHU) » : le qualificatif
    // de quai ou de direction distingue deux objets du MÊME lieu
    text = text.replace(/\b\d+\b/g, " ").replace(/\bdirection\b.*$/, " ");
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

    (items || []).forEach((item) => {
      // un événement daté n'est pas un lieu : deux concerts au même endroit
      // sont deux propositions distinctes, jamais un « hub »
      if (item.isTemporary) { groups.push({ members: [item], family: "evenement" }); return; }
      const family = placeFamily(item);
      const name = normalizePlaceName(item.title || item.titre, family);
      if (!name) { groups.push({ members: [item], family, name }); return; }
      const radius = radii[family] || radii.autre;

      const found = groups.find((group) => {
        if (group.family !== family || !group.name) return false;
        const relation = nameRelation(group.name, name);
        if (!relation) return false;
        const limit = radius[relation];
        return group.members.some((member) => {
          const distance = distanceBetween(member.latitude, member.longitude, item.latitude, item.longitude);
          return Number.isFinite(distance) && distance <= limit;
        });
      });

      if (found) found.members.push(item);
      else groups.push({ members: [item], family, name });
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

  function parseSearchQuery(query, options) {
    const settings = options || {};
    const isIntent = typeof settings.isIntent === "function" ? settings.isIntent : () => false;
    const raw = String(query || "").trim().replace(/\s+/g, " ");
    if (!raw) return { intention: "", destination: "", raw };

    // forme explicite : la préposition dit où couper, on ne cherche pas plus loin
    const byPreposition = raw.split(PREPOSITIONS);
    if (byPreposition.length === 2 && byPreposition[0].trim() && byPreposition[1].trim()) {
      return { intention: byPreposition[0].trim(), destination: byPreposition[1].trim(), raw };
    }

    // forme juxtaposée : on prend la PLUS LONGUE intention reconnue qui laisse
    // encore une destination — « activité enfant Tourcoing » doit donner
    // « activité enfant », pas « activité »
    const words = raw.split(" ");
    for (let cut = words.length - 1; cut >= 1; cut -= 1) {
      const head = words.slice(0, cut).join(" ");
      const tail = words.slice(cut).join(" ");
      if (isIntent(head)) return { intention: head, destination: tail, raw };
    }

    // rien à couper : c'est une intention seule, ou une destination seule
    if (isIntent(raw)) return { intention: raw, destination: "", raw };
    return { intention: "", destination: raw, raw };
  }

  function isAvailableNow(item, at) {
    const now = at == null ? Date.now() : Number(at);
    if (item.isTemporary) {
      if (item.endsAt != null && item.endsAt < now) return false;
      if (item.startsAt != null && item.startsAt > now + 12 * 3600 * 1000) return false;
      return true;
    }
    // hors événement, l'horaire fait foi dès qu'on sait le lire ; le booléen
    // « ouvert » d'une source tierce ne sert plus que de repli
    const module = root.AutourAvailability;
    const dispo = module ? module.getPlaceAvailability(item, now) : null;
    if (dispo && dispo.status === "permanently_closed") return false;
    if (dispo && dispo.status !== "unknown") return dispo.isOpenNow;
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

  /* ---- ETA réel ----------------------------------------------------------
     Un temps de trajet n'est utile que s'il correspond à ce que la personne
     va réellement vivre : marche jusqu'à l'arrêt, attente, trajet,
     correspondances, marche finale. Le classement ne consomme donc pas une
     distance mais un ETA fourni par la couche transport (voir transit.js).
     Sans couche transport branchée, on retombe sur la marche : c'est faux
     pour un bus, mais c'est une durée honnête et jamais sous-estimée. */
  const ARRIVAL_GRACE_MS = 15 * 60000;

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
    const module = root.AutourAvailability;
    const dispo = module ? module.getPlaceAvailability(item, now, arrival) : null;

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

  function compareEta(a, b) {
    const left = a.rankBreakdown.etaMinutes;
    const right = b.rankBreakdown.etaMinutes;
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    return a.rankBreakdown.distance - b.rankBreakdown.distance;
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
      const temporary = item.isTemporary === true || TEMPORARY_CATEGORIES.includes(item.cat);
      if (temporary && endsAt != null && endsAt < now) return null;
      if (ctx.nowOnly && !isAvailableNow(Object.assign({}, item, {startsAt, endsAt, isTemporary:temporary}), now)) return null;
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

      // pertinence de recherche : décisive quand une requête est posée,
      // sans effet quand il n'y en a pas
      const relevance = searchRelevance(item, ctx.requete);
      if (ctx.requete) {
        if (relevance <= 0) return null;      // hors sujet : on ne le montre pas
        score += relevance * 220;
      }
      // le nombre d'avis conforte la note au lieu de la remplacer
      score += reviewWeight(item.avis) * 18;
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

      // le trajet réel, puis ce qu'il implique une fois sur place
      const eta = resolveEta(ctx, item, distance);
      const minutes = eta ? eta.minutes : null;
      const arrival = minutes == null ? null : now + minutes * 60000;
      const outlook = arrivalOutlook(item, arrival, temporary, startsAt, endsAt, now);

      score += outlook.score;
      // la faisabilité joue sur la disponibilité, pas seulement sur le score :
      // le tri regarde la disponibilité en premier et le score en dernier, donc
      // une pénalité de points ne suffirait pas à faire descendre un lieu
      // inatteignable de la première place
      // un lieu définitivement fermé n'est pas un résultat, jamais, quel que
      // soit le mode : ce n'est pas une question de disponibilité mais de
      // qualité de donnée
      if (outlook.state === "permanentlyClosed") return null;

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
      else if (item.ouvert === true) rankReason = "Ouvert maintenant";
      else if (item.ouvert == null) rankReason = "Horaires inconnus";
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
        rankRelevance: relevance,
        rankBreakdown: {availability, intentMatch, distance, startsAt, quality,
          categoryFit, etaMinutes: minutes, relevance},
      });
    }).filter(Boolean).sort((a, b) =>
      b.rankBreakdown.availability - a.rankBreakdown.availability ||
      b.rankBreakdown.intentMatch - a.rankBreakdown.intentMatch ||
      (b.rankBreakdown.relevance || 0) - (a.rankBreakdown.relevance || 0) ||
      // « le plus proche » se juge en temps de trajet réel, pas à vol d'oiseau :
      // un lieu à 400 m de l'autre côté du canal est plus loin qu'un lieu à 2 km
      // desservi directement
      compareEta(a, b) ||
      (a.rankBreakdown.startsAt || Infinity) - (b.rankBreakdown.startsAt || Infinity) ||
      b.rankBreakdown.quality - a.rankBreakdown.quality ||
      b.rankScore - a.rankScore
    );
  }

  root.AutourCore = Object.freeze({
    FAMILY_CATEGORIES,
    CATEGORY_RELATIONS,
    normalizeText,
    classifyPlace,
    classifyPlaceWeighted,
    categoryWeight,
    bestCategoryWeight,
    toCommonItem,
    matchesCategory,
    dedupeItems,
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
