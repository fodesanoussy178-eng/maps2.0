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
    /* ---- DIRE « JE NE SAIS PAS ENCORE QUE TU AIMES ÇA » -----------------
       Une proposition d'exploration n'a aucune envie à citer : la phrase
       nomme alors ce que l'événement EST, d'après ses propres tags, et
       annonce franchement qu'elle sort des goûts suivis. Sans elle, la carte
       arriverait sans justification et « Pour toi » mentirait sur son propre
       critère. */
    const enonce = labels.length ? labels.join(" \xB7 ")
      : ["\xC0 d\xE9couvrir", ...TAXONOMIE.libelles(TAXONOMIE.tagsDe(e)).slice(0, 2)].join(" \xB7 ");
    return enonce + " \xB7 " + qualificatif + (bassin ? " dans " + bassin : "");
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
    const cycle = root.AutourCycle;

    /* ---- LA BASCULE VERS « MAINTENANT » ---------------------------------

       Un événement qui commence dans vingt minutes à trois rues d'ici n'est
       plus une recommandation : c'est quelque chose à faire tout de suite, et
       sa place est dans « Maintenant ». Le garder ici en plus, c'est le
       montrer deux fois avec deux niveaux d'urgence différents — et laisser
       « Pour toi » revendiquer un classement qui ne lui appartient plus.

       MAIS SEULEMENT S'IL EST À PORTÉE, et cette condition manquait. Sans
       elle, un concert parisien imminent quittait « Pour toi » pour un
       « Maintenant » qui le rejetait aussitôt : à deux cent vingt kilomètres,
       il ne passe aucun filtre de proximité. L'événement s'évaporait entre
       deux espaces exactement à l'heure où il comptait le plus. Hors de
       portée, il reste donc ici, avec le mot juste — « ce soir ». */
    if (cycle && etat && cycle.basculeVersMaintenant(etat.status, distance,
        {porteeM: o.porteeMaintenantM})) return null;
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
    const announcementTags = TAXONOMIE.tagsDe(e);
    /* ---- LA BULLE FERMÉE ÉTAIT ICI --------------------------------------

       « Pas de correspondance, donc rien à dire » : l'appariement servait de
       portail, pas de classement. Un quartier pouvait organiser sa braderie,
       son concours de pétanque et son vide-grenier — si la personne avait
       coché « rap » un soir d'installation, elle ne voyait plus jamais rien
       d'autre. Les goûts devenaient les murs du produit.

       Une absence de correspondance devient donc une PROPOSITION
       D'EXPLORATION : elle garde son score, sans la bonification d'affinité,
       elle se range derrière les correspondances, et `classerPourToi` ne lui
       laisse qu'une minorité de places. La préférence pèse sur le classement
       — elle ne décide plus seule de ce qui existe.

       UNE SEULE EXIGENCE : l'événement doit porter ses propres tags. Sans
       eux, personne ne peut dire ce qu'il est, donc la carte ne pourrait pas
       expliquer sa présence — et une proposition inexplicable n'est pas de
       l'exploration, c'est du remplissage. */
    const exploration = matches.length === 0;
    if (exploration && !announcementTags.length) return null;
    const userInterests = [...new Set((Array.isArray(o.interests) ? o.interests : []).map((interest) => String(interest || "").trim()).filter(Boolean))];
    const matchedInterests = [...new Set(matches.map((match) => String(match.id)))];
    const matchingTags = [...new Set(matches.flatMap((match) => match.tags))];
    const announced = announcedAt(e);
    /* ---- LE CYCLE, LU UNE FOIS ------------------------------------------
       La phase sert au score, au groupe et à la phrase affichée. Trois
       lectures du même fait, c'est trois occasions de ne pas dire pareil. */
    const phaseCycle = cycle ? cycle.phaseDe(e, now) : null;
    const urgence = phaseCycle && cycle ? cycle.urgenceAjustee(phaseCycle, distance) : 0;
    /* LA FRAÎCHEUR D'UNE ANNONCE ET LA PHASE « ANNONCE » SONT LE MÊME FAIT.
       Les additionner le comptait deux fois, et le résultat était absurde : à
       l'ouverture de la billetterie, l'événement marquait MOINS qu'au jour de
       son annonce, parce que les douze points de fraîcheur perdus dépassaient
       les onze points d'échéance gagnés. On ne compte donc le fait qu'une
       fois, du côté du cycle, qui est désormais la source. */
    const dejaComptee = phaseCycle && cycle && phaseCycle.phase === cycle.PHASES.ANNONCE;
    const score = Math.max(0, Math.round(
      50 + sourcePriority(e) + importancePoints(e.importance_level || e.importanceLevel) + (dejaComptee ? 0 : noveltyPoints(announced, now)) + proximityPoints(distance) + (Number(e.local_rarity_score) || 0) + (Number(e.quality_score) || 0) +
      /* L'ÉCHÉANCE DE L'INFORMATION, bornée. Une billetterie qui ouvre ce
         matin, trois jours avant le concert : autant de raisons de le dire
         maintenant plutôt que la semaine prochaine. Bornée à 30 points pour
         qu'aucune échéance ne renverse à elle seule l'ampleur et la
         pertinence personnelle, qui la précèdent dans la hiérarchie. */
      Math.min(30, Math.round(urgence * 0.35)) +
      /* L'AFFINITÉ, DEVENUE UN POIDS. Tant qu'elle ouvrait ou fermait la
         porte, elle ne pesait rien dans l'ordre : deux événements appariés
         se classaient uniquement sur l'ampleur et la distance, et un
         événement apparié à trois envies suivies ne valait pas mieux qu'un
         autre apparié à une seule. Bornée à trois envies pour qu'un
         événement fourre-tout ne dépasse pas un grand concert attendu. */
      Math.min(3, matches.length) * 6 +
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
      exploration,
      score,
      reason: reasonFor(e, matches),
      group: announced != null ? "nouvelles_annonces" : "a_ne_pas_manquer",
      announcedAt: announced,
      startAt: start,
      endAt: end,
      temporal: etat,
      temporal_status: etat ? etat.status : null,
      /* LA PHASE DU CYCLE, lue une fois et transportée. « Pour toi » et
         « À venir » écrivent la même phrase parce qu'ils lisent la même
         lecture, pas parce qu'ils appliquent deux fois la même règle. */
      phase: phaseCycle ? phaseCycle.phase : null,
      phase_libelle: phaseCycle ? phaseCycle.libelle : null,
      phase_horloge: phaseCycle ? phaseCycle.horloge : null,
      echeance: urgence,
      jours_restants: phaseCycle ? phaseCycle.joursRestants : null,
      isNew: announced != null && now - announced >= 0 && now - announced <= NOUVELLE_MS
      ,pool: o.pool || "local"
      ,crossZone: o.pool === "major_cross_zone"
    };
  }
  /* ---- LA PART D'EXPLORATION -------------------------------------------

     Un panneau qui ne montre que ce qu'on a déjà déclaré aimer n'apprend
     plus rien à personne. Un quart des places — au moins une dès qu'il y en
     a trois — revient donc à des propositions qui ne correspondent à AUCUNE
     envie suivie, prises dans l'ordre de leur score.

     La réserve est un PLAFOND, jamais un plancher imposé aux
     correspondances : elle ne retient que ce que l'exploration peut
     réellement remplir, et quand les correspondances manquent, l'exploration
     prend toute la place restante plutôt que de laisser le panneau vide. */
  const PART_EXPLORATION = 0.25;
  function reserveExploration(max, disponibles) {
    if (!(max >= 3) || !disponibles) return 0;
    return Math.min(disponibles, Math.max(1, Math.floor(max * PART_EXPLORATION)));
  }
  function classerPourToi(events, options) {
    const o = options || {};
    const vues = new Set(Array.isArray(o.seenIds) ? o.seenIds : []);
    const masquees = new Set(Array.isArray(o.hiddenIds) ? o.hiddenIds : []);
    const result = (Array.isArray(events) ? events : []).filter((event) => event && !masquees.has(event.id)).map((event) => classer(event, o)).filter(Boolean).sort((a, b) => {
      if (a.group !== b.group) return a.group === "nouvelles_annonces" ? -1 : 1;
      /* L'exploration passe DERRIÈRE les correspondances de son groupe : la
         préférence garde la main sur l'ordre, la découverte est un appoint
         visible en fin de liste, pas une surprise en tête de panneau. */
      const ae = a.exploration ? 1 : 0, be = b.exploration ? 1 : 0;
      if (ae !== be) return ae - be;
      const av = vues.has(a.event.id) ? 1 : 0, bv = vues.has(b.event.id) ? 1 : 0;
      if (av !== bv) return av - bv;
      if (a.score !== b.score) return b.score - a.score;
      return (a.startAt || Infinity) - (b.startAt || Infinity);
    });
    const max = Math.max(0, Number.isFinite(Number(o.limit)) ? Number(o.limit) : 6);
    const affinites = result.filter((item) => !item.exploration);
    const explorations = result.filter((item) => item.exploration);
    const placesAffinite = Math.min(affinites.length,
      Math.max(0, max - reserveExploration(max, explorations.length)));
    const gardes = new Set([
      ...affinites.slice(0, placesAffinite),
      ...explorations.slice(0, Math.max(0, max - placesAffinite))
    ]);
    /* On refiltre `result` pour que l'ordre affiché reste celui du tri, sans
       recoller deux listes dans un ordre que le comparateur n'a pas décidé. */
    return result.filter((item) => gardes.has(item)).map((item) => Object.assign(item, {
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
    PART_EXPLORATION,
    reserveExploration,
    libelleGroupe,
    libelleDate
    ,CROSS_ZONE_MIN_SCORE
    ,eventZoneId
    ,isMajor
    ,majorScope
    ,poolAutorise
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
