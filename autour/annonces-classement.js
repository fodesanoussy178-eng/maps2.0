(function(root) {
  "use strict";
  const TAXONOMIE = root.AutourAnnoncesTaxonomie;
  const NOUVELLE_MS = 72 * 3600 * 1e3;
  const SOURCE_POINTS = Object.freeze({
    artist_official: 28,
    venue_official: 26,
    organizer_official: 26,
    institutional: 25,
    ticketing_authorized: 23,
    openagenda: 20,
    datatourisme: 18,
    verified_agenda: 16,
    unknown: 0
  });
  const CROSS_ZONE_MIN_SCORE = 80;
  function epoch(value, timeZone) {
    if (value == null || value === "") return null;
    const T = root.AutourTemps;
    const n = T && typeof T.toEpochInZone === "function"
      ? T.toEpochInZone(value, timeZone || "Europe/Paris")
      : (value instanceof Date ? value.getTime() : new Date(value).getTime());
    return Number.isFinite(n) ? n : null;
  }
  function eventStart(event) {
    const e = event || {};
    return epoch(e.event_start_at || e.eventStartAt || e.start_at || e.debutLe,
      e.timezone || e.timeZone);
  }
  function eventEnd(event) {
    const e = event || {};
    return epoch(e.event_end_at || e.eventEndAt || e.end_at || e.finLe,
      e.timezone || e.timeZone);
  }
  function announcedAt(event) {
    const e = event || {};
    return epoch(e.announced_at || e.announcedAt);
  }
  function sourcePriority(event) {
    const e = event || {};
    const direct = String(e.announcement_source || e.announcementSource || "").toLowerCase();
    if (SOURCE_POINTS[direct] != null) return SOURCE_POINTS[direct];
    const primary = String(e.primary_source || e.primarySource || e.source || "").toLowerCase();
    return SOURCE_POINTS[primary] || SOURCE_POINTS.unknown;
  }
  function importancePoints(level) {
    return { local: 8, important: 16, major: 24 }[String(level || "local")] || 0;
  }
  function proximityPoints(distanceMeters) {
    const d = Number(distanceMeters);
    if (!Number.isFinite(d)) return 0;
    if (d <= 1e3) return 15;
    if (d <= 5e3) return 11;
    if (d <= 15e3) return 7;
    if (d <= 3e4) return 2;
    return -40;
  }
  function importanceLevel(event) {
    return String(event?.importance_level || event?.importanceLevel || "local");
  }
  function isMajor(event) {
    const explicit = event?.is_major ?? event?.isMajor;
    if (explicit != null) return explicit === true || explicit === "true";
    return importanceLevel(event) === "major";
  }
  function majorScope(event) {
    const scope = String(event?.major_scope || event?.majorScope || "").trim().toLowerCase();
    if (["city", "regional", "national"].includes(scope)) return scope;
    return isMajor(event) ? "regional" : null;
  }
  function eventBasin(event) {
    return String(event?.metro_area || event?.metroArea || event?.territory_group || "").trim();
  }
  function eventZoneId(event) {
    return String(event?.zone_id || event?.zoneId || "").trim().toLowerCase() || null;
  }
  function poolAutorise(event, options) {
    const o = options || {};
    const active = String(o.activeZoneId || "").trim().toLowerCase();
    const itemZone = eventZoneId(event);
    if(!active) return true;
    /* Une donnée sans identité ne peut pas franchir la frontière d'une zone
       autonome. Les appels historiques sans activeZoneId gardent leur contrat
       pour permettre la migration progressive des fiches déjà en mémoire. */
    if(!itemZone) return false;
    const pool = o.pool || "local";
    if(pool === "major_cross_zone"){
      return itemZone !== active && isMajor(event) && majorScope(event) !== "city" &&
        Number(event?.importance_score ?? event?.importanceScore) >=
          (Number(o.majorCrossZoneMinScore) || CROSS_ZONE_MIN_SCORE);
    }
    return itemZone === active;
  }
  function reasonFor(event, matches) {
    const e = event || {};
    const labels = matches.map((match) => {
      const canonique = TAXONOMIE.normaliserInteret(match.id);
      return TAXONOMIE.INTEREST_LABELS[canonique] || String(match.id);
    });
    const niveau = importanceLevel(e);
    const qualificatif = isMajor(e) ? "\xE9v\xE9nement majeur" : niveau === "important" ? "\xE9v\xE9nement important" : "\xE9v\xE9nement local";
    const bassin = String(e.metro_area_label || e.metroAreaLabel || e.territory_label || "").trim();
    return labels.join(" \xB7 ") + " \xB7 " + qualificatif + (bassin ? " dans " + bassin : "");
  }
  function territoireCompatible(event, options, distanceMeters) {
    const level = importanceLevel(event);
    const userBasin = String(options?.metroArea || options?.metro_area || options?.territoryGroup || "").trim();
    const basin = eventBasin(event);
    const distance = Number(distanceMeters);
    if(options?.pool === "major_cross_zone"){
      return isMajor(event) && majorScope(event) !== "city" && (!Number.isFinite(distance) ||
        distance <= (Number(options?.crossZoneMaxDistance) || 350e3));
    }
    if (level === "local") {
      return !Number.isFinite(distance) || distance <= (Number(options?.localMaxDistance) || 8e3);
    }
    if (userBasin && basin && userBasin === basin) return true;
    if (level === "major") {
      return !Number.isFinite(distance) || distance <= (Number(options?.majorMaxDistance) || 12e4);
    }
    return !Number.isFinite(distance) || distance <= (Number(options?.importantMaxDistance) || 45e3);
  }
  function noveltyPoints(announced, now) {
    if (announced == null) return 0;
    const age = Math.max(0, now - announced);
    return age <= NOUVELLE_MS ? 20 : age <= 30 * 864e5 ? 8 : 0;
  }
  function fiable(event, now) {
    const e = event || {};
    const start = eventStart(e);
    const confidence = String(e.date_confidence || e.dateConfidence || "unknown");
    const T = root.AutourTemps;
    if (T && typeof T.etatTemporalEvenement === "function") {
      const etat = T.etatTemporalEvenement(e, now == null ? Date.now() : now);
      return etat.hasKnownDate && start != null && ["exact", "day"].includes(confidence);
    }
    return start != null && ["exact", "day"].includes(confidence);
  }
  function classer(event, options) {
    const e = event || {};
    const o = options || {};
    const now = epoch(o.now) || Date.now();
    const T = root.AutourTemps;
    const etat = T && typeof T.etatTemporalEvenement === "function"
      ? T.etatTemporalEvenement(e, now) : null;
    const start = etat && etat.debut != null ? etat.debut : eventStart(e);
    const end = etat && etat.finReelle != null ? etat.finReelle : eventEnd(e);
    if (!fiable(e, now) || start <= now || end != null && end <= now) return null;
    if (etat && (!["soon", "today", "tonight", "weekend", "upcoming"].includes(etat.status) || !etat.hasKnownDate)) return null;
    if (e.cancelled || e.annule || e.status === "cancelled") return null;
    const distance = typeof o.distanceFor === "function" ? o.distanceFor(e) : o.distanceMeters;
    if (!poolAutorise(e, o)) return null;
    if (o.pool !== "major_cross_zone" && o.local === false) return null;
    if (!territoireCompatible(e, o, distance)) return null;
    /* Le bassin est un enrichissement utile au classement local, mais le pool
       cross-zone a déjà une identité de zone et une limite de distance
       explicites. Exiger `metro_area` ici rejetait un événement majeur Paris
       reçu par le RPC dès qu'une ligne ancienne n'avait pas encore ce champ,
       alors même qu'il satisfaisait parfaitement la règle « autre zone,
       majeur, score >= 80, à moins de 350 km ». */
    if (o.pool !== "major_cross_zone" && !eventBasin(e) && proximityPoints(distance) < 0) return null;
    if (!TAXONOMIE) return null;
    const matches = TAXONOMIE.correspondances(e, o.interests || []);
    if (!matches.length) return null;
    const announcementTags = TAXONOMIE.tagsDe(e);
    const userInterests = [...new Set((Array.isArray(o.interests) ? o.interests : []).map((interest) => String(interest || "").trim()).filter(Boolean))];
    const matchedInterests = [...new Set(matches.map((match) => String(match.id)))];
    const matchingTags = [...new Set(matches.flatMap((match) => match.tags))];
    const announced = announcedAt(e);
    const score = Math.max(0, Math.round(
      50 + sourcePriority(e) + importancePoints(e.importance_level || e.importanceLevel) + noveltyPoints(announced, now) + proximityPoints(distance) + (Number(e.local_rarity_score) || 0) + (Number(e.quality_score) || 0) +
      (o.pool === "major_cross_zone" ? 12 : 0)
    ));
    return {
      event: e,
      event_id: e.id == null ? null : String(e.id),
      announcement_tags: announcementTags,
      domains: TAXONOMIE.domainesDe(e),
      user_interests: userInterests,
      matched_interests: matchedInterests,
      matching_tags: matchingTags,
      importance_level: importanceLevel(e),
      is_major: isMajor(e),
      isMajor: isMajor(e),
      major_scope: majorScope(e),
      majorScope: majorScope(e),
      matches,
      score,
      reason: reasonFor(e, matches),
      group: announced != null ? "nouvelles_annonces" : "a_ne_pas_manquer",
      announcedAt: announced,
      startAt: start,
      endAt: end,
      temporal: etat,
      temporal_status: etat ? etat.status : null,
      isNew: announced != null && now - announced >= 0 && now - announced <= NOUVELLE_MS
      ,pool: o.pool || "local"
      ,crossZone: o.pool === "major_cross_zone"
    };
  }
  function classerPourToi(events, options) {
    const o = options || {};
    const vues = new Set(Array.isArray(o.seenIds) ? o.seenIds : []);
    const masquees = new Set(Array.isArray(o.hiddenIds) ? o.hiddenIds : []);
    const result = (Array.isArray(events) ? events : []).filter((event) => event && !masquees.has(event.id)).map((event) => classer(event, o)).filter(Boolean).sort((a, b) => {
      if (a.group !== b.group) return a.group === "nouvelles_annonces" ? -1 : 1;
      const av = vues.has(a.event.id) ? 1 : 0, bv = vues.has(b.event.id) ? 1 : 0;
      if (av !== bv) return av - bv;
      if (a.score !== b.score) return b.score - a.score;
      return (a.startAt || Infinity) - (b.startAt || Infinity);
    });
    const max = Number.isFinite(Number(o.limit)) ? Number(o.limit) : 6;
    return result.slice(0, Math.max(0, max)).map((item) => Object.assign(item, {
      seen: vues.has(item.event.id)
    }));
  }
  function libelleGroupe(group) {
    return group === "nouvelles_annonces" ? "Nouvelles annonces" : "\xC0 ne pas manquer";
  }
  function libelleDate(event, options) {
    const T = root.AutourTemps;
    const now = options && options.now != null ? options.now : Date.now();
    if (T && typeof T.libelleDate === "function") {
      const etat = T.etatTemporalEvenement(event, now);
      return T.libelleDate(event, now, {statut:etat, ignoreStatus:true});
    }
    const start = eventStart(event);
    if (start == null) return "";
    const d = new Date(start);
    const jour = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const confidence = String(event.date_confidence || event.dateConfidence || "unknown");
    return confidence === "exact" ? jour + " \xB7 " + heure : jour;
  }
  root.AutourAnnoncesClassement = Object.freeze({
    NOUVELLE_MS,
    eventStart,
    eventEnd,
    announcedAt,
    fiable,
    territoireCompatible,
    classer,
    classerPourToi,
    libelleGroupe,
    libelleDate
    ,CROSS_ZONE_MIN_SCORE
    ,eventZoneId
    ,isMajor
    ,majorScope
    ,poolAutorise
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
