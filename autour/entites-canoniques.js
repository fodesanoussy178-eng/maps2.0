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
    return Object.assign({
      entity_type: "event",
      title: clean(first(raw, ["title", "titre", "name", "headline"])) || normalized.title || null,
      event_kind: normalized.event_kind || null,
      start_at: normalized.start_at || null,
      end_at: normalized.end_at || null,
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
    }, media, {
      image_scope: "event",
    });
  }

  function CanonicalPlace(record) {
    const raw = record && typeof record === "object" ? record : {};
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
      title: clean(first(raw, ["title", "titre", "name"])) || null,
      description: clean(first(raw, ["description", "description_long"])) || null,
      category: first(raw, ["category", "cat", "primaryCategory"]) || null,
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
