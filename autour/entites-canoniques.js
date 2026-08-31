(function (root) {
  "use strict";

  /*
     Contrat commun de l'interface. Un objet événement et un objet lieu ont
     des vies différentes : les champs qui décrivent l'un ne servent jamais
     de valeur de repli à l'autre.

     Le noyau historique peut encore porter les mêmes informations sous leurs
     noms anciens (`debutLe`, `gratuit`, `image`). Elles sont adaptées ici une
     seule fois ; les écrans lisent ensuite le résultat canonique.
  */

  const DEFAULT_TIMEZONE = "Europe/Paris";

  function text(value) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
    if (typeof value !== "object") return "";
    for (const key of ["fr", "name", "label", "text", "value", "content", "@value", "description"]) {
      if (value[key] != null) {
        const found = text(value[key]);
        if (found) return found;
      }
    }
    return "";
  }

  function clean(value) {
    const cleaner = root.AutourEvenements && root.AutourEvenements.nettoyerDescription;
    if (cleaner) return cleaner(value);
    return text(value)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1 ($2)")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/[*_~`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function first(record, fields) {
    const input = record || {};
    for (const field of fields) {
      if (input[field] != null && input[field] !== "") return input[field];
    }
    return null;
  }

  function bool(value) {
    if (typeof value === "boolean") return value;
    const normalized = clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (["true", "yes", "oui", "gratuit", "free", "no fee"].includes(normalized)) return true;
    if (["false", "no", "non", "payant", "paid"].includes(normalized)) return false;
    return null;
  }

  function number(value) {
    if (value == null || value === "") return null;
    const parsed = typeof value === "number"
      ? value
      : Number(String(value).replace(/\u202f/g, " ").replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function source(value) {
    const result = text(value);
    return result && result !== "unknown" ? result : null;
  }

  function hasValue(value) {
    if (value == null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }

  function values(value) {
    return Array.isArray(value) ? value : (hasValue(value) ? [value] : []);
  }

  function stableValue(value) {
    if (value == null) return "";
    if (typeof value === "object") {
      try { return JSON.stringify(value, Object.keys(value).sort()); }
      catch (error) { return String(value); }
    }
    return String(value).trim().toLowerCase();
  }

  function unique(valuesToKeep) {
    const seen = new Set();
    return (valuesToKeep || []).filter((value) => {
      if (!hasValue(value)) return false;
      const key = stableValue(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function eventRecord(record) {
    const nested = record && record.eventCanonical && typeof record.eventCanonical === "object"
      ? record.eventCanonical : {};
    const raw = record || {};
    const result = Object.assign({}, nested, raw);
    Object.keys(nested).forEach((key) => {
      if (!hasValue(raw[key]) && hasValue(nested[key])) result[key] = nested[key];
    });
    ["announcement_tags", "announcementTags", "tags", "artist_names", "artistNames",
      "music_genres", "musicGenres", "performers"].forEach((key) => {
      const merged = unique([...values(nested[key]), ...values(raw[key])]);
      if (merged.length) result[key] = merged;
    });
    return result;
  }

  const EVENT_SOURCE_SCORE = Object.freeze({
    venue_official: 8, artist_official: 8, organizer_official: 8,
    institutional: 7, verified_agenda: 6, ticketing_authorized: 6,
    openagenda: 5, datatourisme: 4, openstreetmap: 2,
  });

  function eventSourceScore(record) {
    const value = String(first(record, ["event_source", "eventSource", "primary_source", "primarySource", "source"]) || "").toLowerCase();
    return EVENT_SOURCE_SCORE[value] || 0;
  }

  function mediaScore(record) {
    const input = eventRecord(record);
    const scope = String(first(input, ["image_scope", "imageScope"]) || "").toLowerCase();
    const type = String(first(input, ["image_type", "imageType"]) || "").toLowerCase();
    const sourceName = String(first(input, ["image_source", "imageSource"]) || "").toLowerCase();
    const sourceScore = EVENT_SOURCE_SCORE[sourceName] || 0;
    const eventScope = scope === "event" || scope === "evenement" ? 100 : 0;
    const poster = type === "event_poster" || type === "poster" ? 10 : 0;
    const dimensions = hasValue(first(input, ["image_width", "imageWidth"])) &&
      hasValue(first(input, ["image_height", "imageHeight"])) ? 1 : 0;
    return eventScope + poster + sourceScore + dimensions;
  }

  function dateScore(record) {
    const confidence = String(first(record, ["date_confidence", "dateConfidence", "date_precision", "datePrecision"]) || "").toLowerCase();
    const exact = confidence === "exact" ? 3 : confidence === "day" ? 2 : 0;
    return exact * 100 + (hasValue(first(record, ["end_at", "endAt", "fin_le", "finLe"])) ? 1 : 0) + eventSourceScore(record) / 100;
  }

  function valueScore(value, field, record) {
    if (!hasValue(value)) return -Infinity;
    if (["start_at", "startAt", "event_start_at", "eventStartAt", "debut_le", "debutLe",
      "end_at", "endAt", "event_end_at", "eventEndAt", "fin_le", "finLe"].includes(field))
      return dateScore(record);
    if (["image_url", "imageUrl", "image"].includes(field)) return 100 + eventSourceScore(record);
    if (["event_source", "eventSource", "primary_source", "primarySource", "source"].includes(field))
      return 100 + eventSourceScore(record);
    if (typeof value === "string") return value.trim().length;
    if (Array.isArray(value)) return value.length;
    return 1;
  }

  function pickEventValue(records, fields) {
    const candidates = [];
    records.forEach((record) => {
      const input = eventRecord(record);
      fields.forEach((field) => {
        const value = input[field];
        if (hasValue(value)) candidates.push({value, score: valueScore(value, field, input)});
      });
    });
    candidates.sort((left, right) => right.score - left.score ||
      stableValue(left.value).localeCompare(stableValue(right.value)));
    return candidates[0] ? candidates[0].value : null;
  }

  function eventArrays(records, fields) {
    return unique(records.flatMap((record) => {
      const input = eventRecord(record);
      return fields.flatMap((field) => values(input[field]));
    }));
  }

  function mergeObjects(objects) {
    const result = {};
    (objects || []).forEach((object) => {
      if (!object || typeof object !== "object" || Array.isArray(object)) return;
      Object.entries(object).forEach(([key, value]) => {
        if (!hasValue(value)) return;
        if (value && typeof value === "object" && !Array.isArray(value))
          result[key] = mergeObjects([result[key], value]);
        else if (!hasValue(result[key]) || (typeof value === "string" && String(value).length > String(result[key]).length))
          result[key] = value;
      });
    });
    return result;
  }

  function mergedEventRecord(records) {
    const inputs = (records || []).map(eventRecord).filter((record) => record && typeof record === "object");
    if (!inputs.length) return {};
    const result = {};
    const keys = new Set(inputs.flatMap((record) => Object.keys(record)));
    const arrayFields = new Set([
      "announcement_tags", "announcementTags", "tags", "event_tags", "eventTags",
      "taxonomy_tags", "taxonomyTags", "interest_tags", "interestTags",
      "explicit_interest_tags", "explicitInterestTags", "artist_names", "artistNames",
      "music_genres", "musicGenres", "performers", "sources", "event_sources", "eventSources",
      "source_urls", "sourceUrls", "image_sources", "imageSources", "categories", "eventCategories",
    ]);
    keys.forEach((key) => {
      if (key === "eventCanonical") return;
      if (arrayFields.has(key)) {
        result[key] = unique(inputs.flatMap((input) => values(input[key])));
      } else if (inputs.some((input) => input[key] && typeof input[key] === "object" && !Array.isArray(input[key]))) {
        result[key] = mergeObjects(inputs.map((input) => input[key]));
      } else {
        result[key] = pickEventValue(inputs, [key]);
      }
    });

    const union = (fields) => eventArrays(inputs, fields);
    const tags = union(["announcement_tags", "announcementTags", "tags", "event_tags", "eventTags",
      "taxonomy_tags", "taxonomyTags", "interest_tags", "interestTags", "explicit_interest_tags", "explicitInterestTags"]);
    const artists = union(["artist_names", "artistNames"]);
    const genres = union(["music_genres", "musicGenres"]);
    const performers = union(["performers"]);
    if (tags.length) {
      result.announcement_tags = tags;
      result.announcementTags = tags;
    }
    if (artists.length) {
      result.artist_names = artists;
      result.artistNames = artists;
    }
    if (genres.length) {
      result.music_genres = genres;
      result.musicGenres = genres;
    }
    if (performers.length) result.performers = performers;

    const categories = union(["categories", "eventCategories", "category", "cat", "event_category", "eventCategory"]);
    if (categories.length) result.categories = categories;

    /* Les dates et leur confiance forment un seul fait. Choisir chaque champ
       indépendamment permettait à une copie riche en dates de récupérer la
       confiance `unknown` de l'autre copie et de redevenir inexploitable. */
    const dates = inputs.filter((input) => hasValue(first(input, [
      "start_at", "startAt", "event_start_at", "eventStartAt", "debut_le", "debutLe",
      "end_at", "endAt", "event_end_at", "eventEndAt", "fin_le", "finLe",
    ]))).sort((left, right) => dateScore(right) - dateScore(left));
    const dateOwner = dates[0] || inputs[0];
    const dateField = (fields) => pickEventValue([dateOwner, ...inputs], fields);
    const start = dateField(["start_at", "startAt", "event_start_at", "eventStartAt", "debut_le", "debutLe"]);
    const end = dateField(["end_at", "endAt", "event_end_at", "eventEndAt", "fin_le", "finLe"]);
    if (start != null) {
      result.start_at = start;
      result.startAt = start;
      result.debut_le = start;
      result.debutLe = start;
    }
    if (end != null) {
      result.end_at = end;
      result.endAt = end;
      result.fin_le = end;
      result.finLe = end;
    }
    const confidence = pickEventValue([dateOwner], ["date_confidence", "dateConfidence", "date_precision", "datePrecision"]);
    if (confidence != null) {
      result.date_confidence = confidence;
      result.dateConfidence = confidence;
    }
    const temporal = pickEventValue([dateOwner], ["temporal_status", "temporalStatus"]);
    if (temporal != null) {
      result.temporal_status = temporal;
      result.temporalStatus = temporal;
    }
    const timezone = pickEventValue([dateOwner, ...inputs], ["timezone", "timeZone"]);
    if (timezone != null) result.timezone = timezone;

    /* Un média est un enregistrement cohérent : son URL, son type et sa
       provenance doivent venir de la même source. Une affiche événementielle
       explicite passe toujours devant une photo de lieu de repli, quel que
       soit l'ordre des réponses. */
    const media = inputs.map((input) => {
      const candidate = eventRecord(input);
      return {
        input: candidate,
        url: first(candidate, ["image_url", "imageUrl", "image"]),
        score: mediaScore(candidate),
      };
    }).filter((candidate) => hasValue(candidate.url))
      .sort((left, right) => right.score - left.score ||
        String(left.url).localeCompare(String(right.url)));
    if (media[0]) {
      const image = media[0].input;
      [
        ["image_url", ["image_url", "imageUrl", "image"]],
        ["image_type", ["image_type", "imageType"]],
        ["image_source", ["image_source", "imageSource"]],
        ["image_source_url", ["image_source_url", "imageSourceUrl"]],
        ["image_author", ["image_author", "imageAuthor"]],
        ["image_license", ["image_license", "imageLicense"]],
        ["image_confidence", ["image_confidence", "imageConfidence"]],
        ["image_width", ["image_width", "imageWidth", "width"]],
        ["image_height", ["image_height", "imageHeight", "height"]],
        ["image_scope", ["image_scope", "imageScope"]],
      ].forEach(([key, fields]) => {
        const value = first(image, fields);
        if (hasValue(value)) result[key] = value;
      });
    }

    const eventSources = union(["event_source", "eventSource", "primary_source", "primarySource", "source"]);
    const eventSourceUrls = union(["event_source_url", "eventSourceUrl", "source_url", "sourceUrl"]);
    if (eventSources.length) {
      result.event_sources = eventSources;
      result.eventSources = eventSources;
      result.event_source = pickEventValue(inputs, ["event_source", "eventSource", "primary_source", "primarySource", "source"]);
      result.primary_source = result.event_source;
      result.primarySource = result.event_source;
    }
    if (eventSourceUrls.length) {
      result.event_source_urls = eventSourceUrls;
      result.eventSourceUrls = eventSourceUrls;
      result.event_source_url = pickEventValue(inputs, ["event_source_url", "eventSourceUrl", "source_url", "sourceUrl"]);
    }
    result.eventCanonical = null;
    return result;
  }

  function mediaFields(input, scope, defaultType) {
    const raw = input || {};
    const rawScope = text(first(raw, ["image_scope", "imageScope"]));
    const imageUrl = text(first(raw, ["image_url", "imageUrl", "image"]));
    const imageScope = rawScope === "evenement" || rawScope === "event"
      ? "event" : rawScope === "lieu" || rawScope === "place" ? "place" : scope;
    const declaredType = text(first(raw, ["image_type", "imageType"]));
    const type = declaredType || (imageUrl ? defaultType : null);
    return {
      image_url: imageUrl || null,
      image_type: type || null,
      image_source: source(first(raw, ["image_source", "imageSource"])),
      image_source_url: text(first(raw, ["image_source_url", "imageSourceUrl"])),
      image_author: clean(first(raw, ["image_author", "imageAuthor"])),
      image_license: clean(first(raw, ["image_license", "imageLicense"])),
      image_confidence: source(first(raw, ["image_confidence", "imageConfidence"])),
      image_width: number(first(raw, ["image_width", "imageWidth", "width"])),
      image_height: number(first(raw, ["image_height", "imageHeight", "height"])),
      image_scope: imageScope,
    };
  }

  function CanonicalEvent(record) {
    const raw = record && typeof record === "object" ? record : {};
    const normalized = root.AutourEvenements && root.AutourEvenements.normaliserEvenement
      ? root.AutourEvenements.normaliserEvenement(raw)
      : raw;
    const media = mediaFields(raw, "event", "event_poster");
    if (media.image_scope === "place" || media.image_source === "google_places") {
      media.image_url = null;
      media.image_type = null;
      media.image_source = null;
      media.image_source_url = "";
      media.image_author = "";
      media.image_license = "";
      media.image_confidence = null;
    }
    const eventId = first(raw, ["id", "event_id", "eventId", "dbId"]);
    const category = first(raw, ["category", "cat", "event_category", "eventCategory"]);
    const categories = unique([
      ...values(first(raw, ["categories", "eventCategories"])),
      ...values(category),
    ]);
    const latitude = number(first(raw, ["latitude", "lat"]));
    const longitude = number(first(raw, ["longitude", "lng"]));
    const tags = unique([
      ...values(first(raw, ["announcement_tags", "announcementTags"])),
      ...values(first(raw, ["tags", "event_tags", "eventTags", "taxonomy_tags", "taxonomyTags"])),
    ]);
    const artists = unique(values(first(raw, ["artist_names", "artistNames"])));
    const genres = unique(values(first(raw, ["music_genres", "musicGenres"])));
    const performers = unique(values(first(raw, ["performers"])));
    return Object.assign({
      entity_type: "event",
      id: eventId == null ? null : String(eventId),
      title: clean(first(raw, ["title", "titre", "name", "headline"])) || normalized.title || null,
      event_kind: normalized.event_kind || null,
      eventKind: normalized.event_kind || null,
      category: clean(category) || null,
      cat: clean(category) || null,
      categories,
      start_at: normalized.start_at || null,
      end_at: normalized.end_at || null,
      startsAt: normalized.start_at ? new Date(normalized.start_at).getTime() : null,
      endsAt: normalized.end_at ? new Date(normalized.end_at).getTime() : null,
      latitude,
      longitude,
      lat: latitude,
      lng: longitude,
      timezone: normalized.timezone || DEFAULT_TIMEZONE,
      temporal_status: normalized.temporal_status || null,
      date_confidence: normalized.date_confidence || "unknown",
      price_amount: normalized.price_amount == null ? null : normalized.price_amount,
      price_text: normalized.price_text || null,
      is_free: normalized.is_free === true ? true : normalized.is_free === false ? false : null,
      price_confidence: normalized.price_confidence || "unknown",
      audience: normalized.audience || null,
      min_age: normalized.min_age == null ? null : normalized.min_age,
      reservation_required: normalized.reservation_required == null ? null : normalized.reservation_required,
      reservation_text: normalized.reservation_text || null,
      venue_name: normalized.venue_name || null,
      organizer_name: normalized.organizer_name || null,
      description: clean(normalized.description || first(raw, ["description", "description_long"])) || null,
      event_source: source(normalized.event_source),
      event_source_url: normalized.event_source_url || null,
      place_source: source(normalized.place_source),
      place_source_url: source(first(raw, ["place_source_url", "placeSourceUrl"])),
      announcement_tags: tags,
      announcementTags: tags,
      tags,
      artist_names: artists,
      artistNames: artists,
      music_genres: genres,
      musicGenres: genres,
      performers,
      metro_area: first(raw, ["metro_area", "metroArea", "territory_group"]) || null,
      metroArea: first(raw, ["metro_area", "metroArea", "territory_group"]) || null,
      territory_slug: first(raw, ["territory_slug", "territorySlug"]) || null,
      importance_level: first(raw, ["importance_level", "importanceLevel"]) || "local",
      importanceLevel: first(raw, ["importance_level", "importanceLevel"]) || "local",
      announced_at: first(raw, ["announced_at", "announcedAt"]) || null,
      announcedAt: first(raw, ["announced_at", "announcedAt"]) || null,
      source: source(first(raw, ["event_source", "eventSource", "primary_source", "primarySource", "source"])),
      primary_source: source(first(raw, ["event_source", "eventSource", "primary_source", "primarySource", "source"])),
    }, media, {
      image_scope: "event",
    });
  }

  function fusionnerEvenementsCanoniques(records) {
    const inputs = (records || []).filter((record) => record && typeof record === "object");
    if (!inputs.length) return null;
    const merged = mergedEventRecord(inputs);
    const canonical = CanonicalEvent(merged);
    const sources = eventArrays(inputs, ["event_source", "eventSource", "primary_source", "primarySource", "source"]);
    const sourceUrls = eventArrays(inputs, ["event_source_url", "eventSourceUrl", "source_url", "sourceUrl"]);
    if (sources.length) {
      canonical.event_sources = sources;
      canonical.eventSources = sources;
    }
    if (sourceUrls.length) {
      canonical.event_source_urls = sourceUrls;
      canonical.eventSourceUrls = sourceUrls;
    }
    const imageSources = eventArrays(inputs, ["image_source", "imageSource"]);
    const imageSourceUrls = eventArrays(inputs, ["image_source_url", "imageSourceUrl"]);
    if (imageSources.length) {
      canonical.image_sources = imageSources;
      canonical.imageSources = imageSources;
    }
    if (imageSourceUrls.length) {
      canonical.image_source_urls = imageSourceUrls;
      canonical.imageSourceUrls = imageSourceUrls;
    }
    return canonical;
  }

  function CanonicalPlace(record) {
    const raw = record && typeof record === "object" ? record : {};
    const placeId = first(raw, ["id", "place_id", "placeId", "dbId"]);
    const media = mediaFields(raw, "place", "place_photo");
    const hours = clean(first(raw, ["opening_hours", "openingHours", "horaires", "quand"]));
    /* Une photo de portée événement ne devient jamais la photo officielle
       d'un lieu par simple projection du modèle commun. */
    if (media.image_scope === "event" || media.image_type === "event_poster" ||
        ["openagenda", "artist_official", "organizer_official"].includes(media.image_source)) {
      media.image_url = null;
      media.image_type = null;
      media.image_source = null;
      media.image_source_url = "";
      media.image_author = "";
      media.image_license = "";
      media.image_confidence = null;
    }
    const freeText = clean(first(raw, ["price_text", "priceText", "tariff_text", "tarif_text"]));
    const free = bool(first(raw, ["is_free", "isFree", "free", "gratuit"])) ??
      (/\b(?:gratuit(?:e|s)?|entrée\s+libre|accès\s+libre)\b/i.test(freeText) ? true : null);
    const amount = number(first(raw, ["price_amount", "priceAmount", "prix"]));
    const priceText = freeText;
    const explicitPrice = amount != null || !!priceText || free != null;
    return Object.assign({
      entity_type: "place",
      id: placeId == null ? null : String(placeId),
      title: clean(first(raw, ["title", "titre", "name"])) || null,
      description: clean(first(raw, ["description", "description_long"])) || null,
      category: clean(first(raw, ["category", "cat", "primaryCategory"])) || null,
      address: clean(first(raw, ["address", "adresse"])) || null,
      city: clean(first(raw, ["city", "commune", "cp"])) || null,
      lat: number(first(raw, ["lat", "latitude"])),
      lng: number(first(raw, ["lng", "longitude"])),
      opening_hours: hours || null,
      openingHours: hours || null,
      timezone: text(first(raw, ["timezone", "timeZone"])) || DEFAULT_TIMEZONE,
      price_amount: amount,
      price_text: priceText || null,
      is_free: free === true ? true : free === false ? false : null,
      price_confidence: explicitPrice ? (first(raw, ["price_confidence", "priceConfidence"]) || "medium") : "unknown",
      organizer_name: null,
      venue_name: clean(first(raw, ["venue_name", "venueName"])) || clean(first(raw, ["title", "titre", "name"])) || null,
      event_source: null,
      event_source_url: null,
      place_source: source(first(raw, ["place_source", "placeSource", "source"])),
      place_source_url: source(first(raw, ["place_source_url", "placeSourceUrl", "source_url", "sourceUrl"])),
      reservation_required: null,
      reservation_text: null,
    }, media, {
      image_scope: "place",
    });
  }

  function isEvent(record) {
    /* Un enregistrement explicitement permanent gagne toujours contre une
       catégorie historique ambiguë (`sport`, `food`, etc.). Un terrain, un
       restaurant ou un musée ne devient pas une manifestation simplement
       parce que son fournisseur lui a attribué un tag qui peut aussi servir
       aux événements. */
    if (record && (record.entity_type === "place" || record.entityType === "place" ||
      record.isTemporary === false || record.temporaire === false)) return false;
    return !!(record && (record.entity_type === "event" || record.entityType === "event" ||
      record.isTemporary === true || record.temporaire === true || record.eventCanonical));
  }

  function entity(record) {
    return isEvent(record) ? CanonicalEvent(record) : CanonicalPlace(record);
  }

  function tarifLieu(place) {
    const p = place && place.entity_type === "place" ? place : CanonicalPlace(place);
    if (p.is_free === true) return "Entrée libre";
    if (p.price_text && p.price_confidence !== "unknown") return p.price_text;
    if (p.price_amount != null) return String(p.price_amount) + " €";
    return "Tarif à vérifier";
  }

  function organisateurLieu(place) {
    const p = place && place.entity_type === "place" ? place : CanonicalPlace(place);
    return p.organizer_name || "Organisateur non renseigné";
  }

  function horaireLieu(place) {
    const p = place && place.entity_type === "place" ? place : CanonicalPlace(place);
    const value = clean(p.openingHours || p.opening_hours);
    return value && !/^(voir sur place|horaires indicatifs)$/i.test(value)
      ? value : "Horaires à vérifier";
  }

  function media(entityValue) {
    const e = entityValue || {};
    const result = mediaFields(e, e.entity_type === "event" ? "event" : "place",
      e.entity_type === "event" ? "event_poster" : "place_photo");
    const type = result.image_type || "";
    const scope = result.image_scope;
    const fit = scope === "event" || type === "event_poster" ? "contain" : "cover";
    const width = Number(result.image_width), height = Number(result.image_height);
    return Object.assign(result, {
      object_fit: fit,
      low_resolution: width > 0 && height > 0 && width < 600 && height < 600,
      can_upscale: !(width > 0 && height > 0 && width < 600 && height < 600),
    });
  }

  root.AutourEntites = Object.freeze({
    CanonicalEvent,
    fusionnerEvenementsCanoniques,
    CanonicalPlace,
    normaliserEvenement: CanonicalEvent,
    normaliserLieu: CanonicalPlace,
    entiteCanonique: entity,
    estEvenement: isEvent,
    tarifLieu,
    organisateurLieu,
    horaireLieu,
    mediaCanonique: media,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
