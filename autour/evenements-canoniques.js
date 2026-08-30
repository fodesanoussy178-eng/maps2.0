(function (root) {
  "use strict";

  /* Objet unique lu par toutes les vues événementielles. Les champs historiques
     de l'application peuvent encore exister sur l'item, mais ils ne sont plus
     une seconde source de vérité pour une fiche temporaire. */

  const DEFAULT_TIMEZONE = "Europe/Paris";

  function list(value) {
    return Array.isArray(value) ? value : (value == null ? [] : [value]);
  }

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

  function first(record, fields) {
    for (const field of fields) {
      const value = record && record[field];
      if (value != null && value !== "") return value;
    }
    return null;
  }

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  }

  function nettoyerDescription(value) {
    let source = decodeEntities(text(value));
    if (!source) return "";
    return source
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi, "$1 ($2)")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
      /* Le lien reste utilisable ; seule l'enveloppe Markdown disparaît. */
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1 ($2)")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/(^|\s)#{1,6}\s+/g, "$1")
      .replace(/(^|\s)[*_~`]+/g, "$1")
      .replace(/[*_~`]+(?=\s|$)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function bool(value) {
    if (typeof value === "boolean") return value;
    const normalized = text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (["true", "yes", "oui", "gratuit", "free", "no fee"].includes(normalized)) return true;
    if (["false", "no", "non", "payant", "paid"].includes(normalized)) return false;
    return null;
  }

  function amount(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
    const match = String(value).replace(/\u202f/g, " ").match(/\d+(?:[,.]\d{1,2})?/);
    if (!match) return null;
    const parsed = Number(match[0].replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function currencyAmount(value) {
    const match = String(value || "").replace(/\u202f/g, " ")
      .match(/(\d+(?:[,.]\d{1,2})?)\s*(?:€|euros?|eur)(?=\b|\s|$)/i);
    return match ? amount(match[1]) : null;
  }

  function offer(record) {
    return list(first(record, ["offers", "offer", "pricing", "tariff", "tarif"]))
      .find((item) => item && typeof item === "object") || null;
  }

  function sentenceWith(source, expression) {
    const value = nettoyerDescription(source);
    if (!value) return "";
    const match = value.match(new RegExp("[^.!?\\n]*" + expression.source + "[^.!?\\n]*[.!?]?", "i"));
    return match ? match[0].trim() : "";
  }

  function tarif(record, description) {
    const structuredOffer = offer(record);
    const structuredAmount = amount(first(structuredOffer || {}, ["price_amount", "priceAmount", "price", "amount", "value"])) ??
      amount(first(record, ["price_amount", "priceAmount", "amount", "prix"]));
    const structuredText = nettoyerDescription(first(structuredOffer || {}, ["description", "label", "name", "text"])) ||
      nettoyerDescription(first(record, ["price_text", "priceText", "tariff_text", "tarif_text"]));
    const structuredFree = bool(first(structuredOffer || {}, ["is_free", "isFree", "free", "gratuit"])) ??
      bool(first(record, ["is_free", "isFree", "free", "gratuit"]));
    const candidate = structuredText || description;
    const parsed = currencyAmount(candidate) ?? (structuredText ? amount(candidate) : null);
    const hasCurrency = /(?:€|euros?|eur)(?=\b|\s|$)/i.test(candidate);
    const explicitFree = /\b(?:gratuit(?:e|s)?|entrée\s+libre|ac(?:c|ç)ès\s+libre)\b/i.test(candidate);

    if (structuredAmount != null || (structuredText && parsed != null && hasCurrency)) {
      return {
        price_amount: structuredAmount ?? parsed,
        price_text: structuredText || sentenceWith(description, /\d+(?:[,.]\d{1,2})?\s*(?:€|euros?|eur)(?=\b|\s|$)/i) || `${structuredAmount ?? parsed} €`,
        is_free: false,
        price_confidence: "high",
      };
    }
    if (structuredFree === true || (structuredFree == null && explicitFree))
      return {price_amount: 0, price_text: "Entrée libre", is_free: true, price_confidence: structuredFree === true ? "high" : "medium"};
    if (structuredFree === false)
      return {price_amount: null, price_text: null, is_free: false, price_confidence: "unknown"};
    if (parsed != null && hasCurrency)
      return {price_amount: parsed, price_text: sentenceWith(description, /\d+(?:[,.]\d{1,2})?\s*(?:€|euros?|eur)(?=\b|\s|$)/i) || `${parsed} €`, is_free: false, price_confidence: "medium"};
    return {price_amount: null, price_text: null, is_free: null, price_confidence: "unknown"};
  }

  function publicData(record, description) {
    const publicSource = nettoyerDescription(first(record, ["audience", "public", "audience_text", "audienceText"]));
    const directAge = amount(first(record, ["min_age", "minAge", "age_min", "ageMin", "minimum_age"]));
    const ageMatch = description.match(/(?:dès|des|à partir de|a partir de)\s*(\d+)\s*ans?/i);
    const minAge = directAge ?? (ageMatch ? Number(ageMatch[1]) : null);
    if (publicSource) return {audience: publicSource, min_age: minAge};
    if (/\benfants?\b|\bfamilles?\b|\bfamilial(?:e|es)?\b/i.test(description))
      return {audience: "Enfants et familles", min_age: minAge};
    return {audience: null, min_age: minAge};
  }

  function reservationData(record, description) {
    const required = bool(first(record, ["reservation_required", "reservationRequired", "booking_required", "bookingRequired"]));
    const directText = nettoyerDescription(first(record, ["reservation_text", "reservationText", "booking_text", "bookingText"]));
    const reservationText = directText || sentenceWith(description, /réservation|reservation|inscription|billetterie/i);
    if (required != null) return {reservation_required: required, reservation_text: reservationText || null};
    if (/\bsans\s+(?:réservation|reservation|inscription)\b/i.test(description))
      return {reservation_required: false, reservation_text: reservationText || null};
    if (/(?:réservation|reservation|inscription)\s+(?:obligatoire|requise|nécessaire|necessaire)/i.test(description))
      return {reservation_required: true, reservation_text: reservationText || null};
    return {reservation_required: null, reservation_text: reservationText || null};
  }

  const WEEKDAYS = {
    lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
  };

  function instantLocal(day, hour, minute, timezone) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return null;
    const hh = String(hour).padStart(2, "0"), mm = String(minute).padStart(2, "0");
    let instant = Date.parse(`${day}T${hh}:${mm}:00Z`);
    if (!Number.isFinite(instant)) return null;
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        const parts = {};
        new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone || DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(new Date(instant)).forEach((part) => { parts[part.type] = part.value; });
        const seen = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
          Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute));
        const wanted = Date.parse(`${day}T${hh}:${mm}:00Z`);
        const corrected = wanted - (seen - instant);
        if (corrected === instant) break;
        instant = corrected;
      }
      return new Date(instant).toISOString();
    } catch (error) {
      return null;
    }
  }

  function horaireRecurrent(description, startAt, timezone) {
    const dayMatch = String(startAt || "").match(/^(\d{4}-\d{2}-\d{2})$/);
    if (!dayMatch) return null;
    const source = nettoyerDescription(description).normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const weekdayMatch = source.match(/\b(?:chaque|tous les|toutes les)\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?\b/);
    const hoursMatch = source.match(/\b(?:de\s*)?(\d{1,2})h(?:([0-5]\d))?\s*(?:a|à|[-–])\s*(\d{1,2})h(?:([0-5]\d))?\b/);
    if (!weekdayMatch || !hoursMatch) return null;
    const [year, month, day] = dayMatch[1].split("-").map(Number);
    if (WEEKDAYS[weekdayMatch[1]] !== new Date(Date.UTC(year, month - 1, day)).getUTCDay()) return null;
    const startHour = Number(hoursMatch[1]), startMinute = Number(hoursMatch[2] || 0);
    const endHour = Number(hoursMatch[3]), endMinute = Number(hoursMatch[4] || 0);
    if (startHour > 23 || endHour > 23) return null;
    const start = instantLocal(dayMatch[1], startHour, startMinute, timezone);
    const end = instantLocal(dayMatch[1], endHour, endMinute, timezone);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return null;
    return {start_at: start, end_at: end};
  }

  function confidence(record, startAt, endAt) {
    const direct = first(record, ["date_confidence", "dateConfidence", "date_precision", "datePrecision"]);
    if (direct != null) return String(direct);
    const hasTime = (value) => typeof value === "number" || value instanceof Date ||
      /(?:T|\s)\d{1,2}:\d{2}/.test(String(value || ""));
    return hasTime(startAt) || hasTime(endAt) ? "exact" : startAt ? "day" : "unknown";
  }

  function normaliserEvenement(record) {
    const input = record && typeof record === "object" ? record : {};
    const description = nettoyerDescription(first(input, [
      "description", "description_long", "descriptionLong", "longDescription", "description_short", "descriptionShort",
    ]));
    let startAt = first(input, ["start_at", "startAt", "event_start_at", "eventStartAt", "debut_le", "debutLe"]);
    let endAt = first(input, ["end_at", "endAt", "event_end_at", "eventEndAt", "fin_le", "finLe"]);
    const timezone = text(first(input, ["timezone", "timeZone"])) || DEFAULT_TIMEZONE;
    const recurrent = !endAt ? horaireRecurrent(description, startAt, timezone) : null;
    if (recurrent) {
      startAt = recurrent.start_at;
      endAt = recurrent.end_at;
    }
    const price = tarif(input, description);
    const audience = publicData(input, description);
    const reservation = reservationData(input, description);
    const source = text(first(input, ["event_source", "eventSource", "primary_source", "primarySource", "source"]));
    const sourceUrl = text(first(input, ["event_source_url", "eventSourceUrl", "source_url", "sourceUrl", "url"]));
    const venueName = nettoyerDescription(first(input, ["venue_name", "venueName", "place_name", "placeName", "location_name", "locationName"]));
    const organizerName = nettoyerDescription(first(input, ["organizer_name", "organizerName", "organizer", "organisateur"]));
    return {
      title: nettoyerDescription(first(input, ["title", "titre", "name", "headline"])) || null,
      event_kind: first(input, ["event_kind", "eventKind"]) || null,
      start_at: startAt || null,
      end_at: endAt || null,
      timezone,
      temporal_status: text(first(input, ["temporal_status", "temporalStatus"])) || null,
      date_confidence: confidence(input, startAt, endAt),
      ...price,
      ...audience,
      ...reservation,
      venue_name: venueName || null,
      organizer_name: organizerName || null,
      description: description || null,
      event_source: source || null,
      event_source_url: sourceUrl || null,
      place_source: text(first(input, ["place_source", "placeSource", "venue_source", "venueSource"])) || null,
      image_source: text(first(input, ["image_source", "imageSource"])) || null,
      image_source_url: text(first(input, ["image_source_url", "imageSourceUrl"])) || null,
      cancelled:input.cancelled === true || input.annule === true || input.status === "cancelled",
    };
  }

  function tarifEvenement(event) {
    if (!event) return "Tarif à vérifier";
    if (event.is_free === true) return "Entrée libre";
    if (event.price_text && event.price_confidence !== "unknown") return event.price_text;
    if (event.price_amount != null && Number.isFinite(Number(event.price_amount))) return Number(event.price_amount) + " €";
    return "Tarif à vérifier";
  }

  function publicEvenement(event) {
    if (!event || !event.audience) return "Public à vérifier";
    return event.min_age == null ? event.audience : event.audience + " · dès " + event.min_age + " ans";
  }

  function reservationEvenement(event) {
    if (!event || event.reservation_required == null) return "Réservation à vérifier";
    if (event.reservation_text) return event.reservation_text;
    return event.reservation_required ? "Réservation obligatoire" : "Sans réservation";
  }

  root.AutourEvenements = Object.freeze({
    nettoyerDescription,
    normaliserEvenement,
    tarifEvenement,
    publicEvenement,
    reservationEvenement,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
