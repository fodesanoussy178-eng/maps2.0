(function(root) {
  "use strict";
  const DEFAULT_TIMEZONE = "Europe/Paris";
  const MARGES_MINUTES = Object.freeze({
    restaurant: 45,
    resto: 45,
    fastfood: 45,
    cafe: 30,
    bar: 30,
    musee: 60,
    museum: 60,
    commerce: 20,
    friperie: 20,
    buy: 20,
    marche: 20,
    parc: 15,
    park: 15,
    playground: 15,
    terrain: 15,
    biblio: 30,
    library: 30,
    coworking: 30,
    cinema: 30,
    piscine: 45,
    swimming_pool: 45,
    defaut: 30
  });
  const JOURS = Object.freeze({ mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 });
  const JOUR_NOM = Object.freeze(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]);
  const JOUR_ORDRE = Object.freeze(["mo", "tu", "we", "th", "fr", "sa", "su"]);
  const MINUTES_JOUR = 1440;
  function partsInZone(timestamp, timeZone) {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const parts = {};
    format.formatToParts(new Date(timestamp)).forEach((part) => {
      parts[part.type] = part.value;
    });
    const hour = Number(parts.hour) % 24;
    const weekdays = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour,
      minute: Number(parts.minute),
      second: Number(parts.second),
      weekday: weekdays[parts.weekday],
      minuteOfDay: hour * 60 + Number(parts.minute)
    };
  }
  function zoneOf(place) {
    return place && (place.timezone || place.timeZone) || DEFAULT_TIMEZONE;
  }
  function localMidnight(timestamp, timeZone) {
    const parts = partsInZone(timestamp, timeZone);
    const elapsed = (parts.minuteOfDay * 60 + parts.second) * 1e3;
    return timestamp - elapsed;
  }
  function minutesToClock(minutes) {
    const normalised = (Math.round(minutes) % MINUTES_JOUR + MINUTES_JOUR) % MINUTES_JOUR;
    const h = Math.floor(normalised / 60);
    const m = normalised % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = (h + l - 7 * m + 114) % 31 + 1;
    return { month, day };
  }
  function isFrenchHoliday(year, month, day) {
    const fixed = [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]];
    if (fixed.some(([m, d]) => m === month && d === day)) return true;
    const easter = easterSunday(year);
    const easterDate = Date.UTC(year, easter.month - 1, easter.day);
    const target = Date.UTC(year, month - 1, day);
    const offsetDays = Math.round((target - easterDate) / 864e5);
    return offsetDays === 1 || offsetDays === 39 || offsetDays === 50;
  }
  const RE_JOUR = /^(mo|tu|we|th|fr|sa|su|ph)(?:\s*-\s*(mo|tu|we|th|fr|sa|su))?$/;
  const RE_PLAGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
  function joursDeSelecteur(selector) {
    const jours = [];
    let feries = false;
    for (const token of selector.split(",")) {
      const found = token.trim().match(RE_JOUR);
      if (!found) return null;
      if (found[1] === "ph") {
        if (found[2]) return null;
        feries = true;
        continue;
      }
      const start = JOURS[found[1]];
      if (!found[2]) {
        jours.push(start);
        continue;
      }
      const end = JOURS[found[2]];
      for (let i = start; ; i = (i + 1) % 7) {
        jours.push(i);
        if (i === end) break;
      }
    }
    return { jours, feries };
  }
  function plagesDeSelecteur(selector) {
    const plages = [];
    for (const token of selector.split(",")) {
      const found = token.trim().match(RE_PLAGE);
      if (!found) return null;
      const start = Number(found[1]) * 60 + Number(found[2]);
      let end = Number(found[3]) * 60 + Number(found[4]);
      if (end === 0 && start > 0) end = MINUTES_JOUR;
      if (end <= start) end += MINUTES_JOUR;
      if (start < 0 || start >= MINUTES_JOUR || end > 2 * MINUTES_JOUR) return null;
      plages.push({ start, end });
    }
    return plages.length ? plages : null;
  }
  function parseOpeningHours(spec) {
    if (spec == null) return null;
    const text = String(spec).trim().toLowerCase().replace(/\s+/g, " ");
    if (!text) return null;
    if (/^(voir sur place|sur place|nc|inconnu|unknown|\?)$/.test(text)) return null;
    if (text === "24/7" || text === "24/7 open") {
      return { days: JOUR_ORDRE.map(() => [{ start: 0, end: MINUTES_JOUR }]), holidaysClosed: false };
    }
    const days = [[], [], [], [], [], [], []];
    let holidaysClosed = false;
    let touched = false;
    for (const rawRule of text.split(";")) {
      const rule = rawRule.trim().replace(/^open\s+/, "");
      if (!rule) continue;
      const split = rule.match(/^((?:(?:mo|tu|we|th|fr|sa|su|ph)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)+)?(.*)$/);
      if (!split) return null;
      const selecteurJours = (split[1] || "").trim();
      const reste = (split[2] || "").trim();
      const cible = selecteurJours ? joursDeSelecteur(selecteurJours) : { jours: [0, 1, 2, 3, 4, 5, 6], feries: false };
      if (!cible) return null;
      const ferme = /^(off|closed)$/.test(reste);
      if (cible.feries) {
        if (!ferme) return null;
        holidaysClosed = true;
        touched = true;
        if (!cible.jours.length) continue;
      }
      if (ferme) {
        cible.jours.forEach((jour) => {
          days[jour] = [];
        });
        touched = true;
        continue;
      }
      if (reste === "24/7") {
        cible.jours.forEach((jour) => {
          days[jour] = [{ start: 0, end: MINUTES_JOUR }];
        });
        touched = true;
        continue;
      }
      const plages = plagesDeSelecteur(reste);
      if (!plages) return null;
      cible.jours.forEach((jour) => {
        days[jour] = plages.slice();
      });
      touched = true;
    }
    return touched ? { days, holidaysClosed } : null;
  }
  function resolveSchedule(place) {
    const candidates = [
      { spec: place.openingHoursExplicit, source: "explicite" },
      { spec: (place.tags || {}).opening_hours, source: "osm" },
      { spec: place.openingHours, source: "osm" },
      { spec: place.quand, source: "osm" },
      { spec: place.officialOpeningHours, source: "officielle" },
      { spec: place.verifie ? place.creatorOpeningHours : null, source: "createur-verifie" }
    ];
    for (const candidate of candidates) {
      if (candidate.spec == null || candidate.spec === "") continue;
      const parsed = parseOpeningHours(candidate.spec);
      if (parsed) return { schedule: parsed, source: candidate.source };
    }
    return { schedule: null, source: null };
  }
  function marginFor(place) {
    const explicit = Number(place && place.minimumMargin);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const keys = [place && place.cat, ...place && place.categories || []];
    for (const key of keys) {
      if (key && MARGES_MINUTES[key] != null) return MARGES_MINUTES[key];
    }
    return MARGES_MINUTES.defaut;
  }
  function buildIntervals(schedule, reference, timeZone, daysAhead) {
    const midnight = localMidnight(reference, timeZone);
    const intervals = [];
    for (let offset = -1; offset <= daysAhead; offset += 1) {
      const dayStart = midnight + offset * MINUTES_JOUR * 6e4;
      const parts = partsInZone(dayStart + 12 * 36e5, timeZone);
      if (schedule.holidaysClosed && isFrenchHoliday(parts.year, parts.month, parts.day)) continue;
      const plages = schedule.days[parts.weekday] || [];
      plages.forEach((plage) => {
        intervals.push({
          start: dayStart + plage.start * 6e4,
          end: dayStart + plage.end * 6e4,
          dayOffset: offset,
          weekday: parts.weekday
        });
      });
    }
    return intervals.sort((a, b) => a.start - b.start);
  }
  function intervalAt(intervals, instant) {
    return intervals.find((slot) => slot.start <= instant && instant < slot.end) || null;
  }
  function nextOpening(intervals, instant) {
    return intervals.find((slot) => slot.start > instant) || null;
  }
  function formatIn(timestamp, timeZone) {
    const parts = partsInZone(timestamp, timeZone);
    return minutesToClock(parts.minuteOfDay);
  }
  function getPlaceAvailability(place, now, arrival) {
    const target = place || {};
    const timeZone = zoneOf(target);
    const instant = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const arriveAt = Number.isFinite(Number(arrival)) ? Number(arrival) : null;
    const base = {
      status: "unknown",
      isOpenNow: false,
      isOpenAtArrival: null,
      opensAt: null,
      closesAt: null,
      opensAtTime: null,
      closesAtTime: null,
      label: "Horaires non renseign\xE9s",
      reason: null,
      source: null,
      timeZone,
      marginMinutes: marginFor(target),
      meetsMargin: null
    };
    if (target.permanentlyClosed === true || target.definitivementFerme === true) {
      return Object.assign({}, base, {
        status: "permanently_closed",
        isOpenAtArrival: false,
        label: "D\xE9finitivement ferm\xE9",
        reason: target.closureReason || "Signal\xE9 comme d\xE9finitivement ferm\xE9"
      });
    }
    if (target.temporarilyClosed === true || target.fermetureTemporaire === true) {
      return Object.assign({}, base, {
        status: "closed",
        isOpenAtArrival: false,
        label: "Ferm\xE9 temporairement",
        reason: target.closureReason || null
      });
    }
    const { schedule, source } = resolveSchedule(target);
    if (!schedule) {
      if (target.ouvert === true || target.ouvert === false) {
        const open = target.ouvert === true;
        return Object.assign({}, base, {
          status: open ? "open" : "closed",
          isOpenNow: open,
          isOpenAtArrival: null,
          label: open ? "Ouvert" : "Ferm\xE9",
          reason: "Horaires d\xE9taill\xE9s non renseign\xE9s",
          source: "declaree"
        });
      }
      return base;
    }
    const intervals = buildIntervals(schedule, instant, timeZone, 9);
    const current = intervalAt(intervals, instant);
    const upcoming = nextOpening(intervals, instant);
    const margin = base.marginMinutes;
    const result = Object.assign({}, base, { source, isOpenNow: !!current });
    if (current) {
      result.status = "open";
      result.closesAt = new Date(current.end).toISOString();
      result.closesAtTime = formatIn(current.end, timeZone);
      const minutesLeft = Math.round((current.end - instant) / 6e4);
      if (minutesLeft <= margin) {
        result.status = "closing_soon";
        result.reason = "Ferme dans " + minutesLeft + " min";
      }
      result.label = "Ouvert \xB7 ferme \xE0 " + heureFr(result.closesAtTime);
    } else if (upcoming) {
      result.opensAt = new Date(upcoming.start).toISOString();
      result.opensAtTime = formatIn(upcoming.start, timeZone);
      const minutesUntil = Math.round((upcoming.start - instant) / 6e4);
      result.status = minutesUntil <= 60 ? "opening_soon" : "closed";
      if (upcoming.dayOffset === 0) {
        result.label = "Ferm\xE9 \xB7 ouvre \xE0 " + heureFr(result.opensAtTime);
      } else if (upcoming.dayOffset === 1) {
        result.label = "Ferm\xE9 aujourd\u2019hui";
        result.reason = "Ouvre demain \xE0 " + heureFr(result.opensAtTime);
      } else {
        result.label = "Ferm\xE9 \xB7 ouvre " + JOUR_NOM[upcoming.weekday] + " \xE0 " + heureFr(result.opensAtTime);
      }
    } else {
      result.status = "closed";
      result.label = "Ferm\xE9";
      result.reason = "Aucune r\xE9ouverture connue dans les prochains jours";
    }
    if (arriveAt != null) {
      const atArrival = intervalAt(intervals, arriveAt);
      result.isOpenAtArrival = !!atArrival;
      if (atArrival) {
        const minutesLeft = Math.round((atArrival.end - arriveAt) / 6e4);
        result.meetsMargin = minutesLeft >= margin;
        if (!result.meetsMargin) {
          result.reason = "Ferme " + minutesLeft + " min apr\xE8s votre arriv\xE9e";
        }
      } else {
        result.meetsMargin = false;
      }
    }
    return result;
  }
  function heureFr(hhmm) {
    const trouve = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!trouve) return String(hhmm || "");
    const heures = Number(trouve[1]);
    return trouve[2] === "00" ? heures + "h" : heures + "h" + trouve[2];
  }
  function minutesEnHeureFr(minutes) {
    const total = (Math.round(minutes) % MINUTES_JOUR + MINUTES_JOUR) % MINUTES_JOUR;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? h + "h" : h + "h" + String(m).padStart(2, "0");
  }
  function journeeFr(plages) {
    if (!plages || !plages.length) return "Ferm\xE9";
    if (plages.length === 1 && plages[0].start === 0 && plages[0].end === MINUTES_JOUR)
      return "24h/24";
    return plages.map((p) => minutesEnHeureFr(p.start) + " \u2013 " + minutesEnHeureFr(p.end)).join(", ");
  }
  function semaineFrancaise(place) {
    const { schedule } = resolveSchedule(place || {});
    if (!schedule) return null;
    const lignes = [];
    for (let jour = 0; jour < 7; jour += 1) {
      const texte = journeeFr(schedule.days[jour]);
      const derniere = lignes[lignes.length - 1];
      if (derniere && derniere.horaire === texte) derniere.fin = jour;
      else lignes.push({ debut: jour, fin: jour, horaire: texte });
    }
    return {
      jours: lignes.map((ligne) => ({
        jour: ligne.debut === ligne.fin ? JOUR_NOM[ligne.debut] : ligne.fin === ligne.debut + 1 ? JOUR_NOM[ligne.debut] + " et " + JOUR_NOM[ligne.fin] : JOUR_NOM[ligne.debut] + " au " + JOUR_NOM[ligne.fin],
        premierJour: ligne.debut,
        dernierJour: ligne.fin,
        horaire: ligne.horaire
      })),
      feriesFermes: !!schedule.holidaysClosed
    };
  }
  function journeeFrancaise(place, weekday) {
    const { schedule } = resolveSchedule(place || {});
    if (!schedule) return null;
    const jour = (Math.round(Number(weekday)) % 7 + 7) % 7;
    return journeeFr(schedule.days[jour]);
  }
  root.AutourAvailability = Object.freeze({
    DEFAULT_TIMEZONE,
    MARGES_MINUTES,
    parseOpeningHours,
    getPlaceAvailability,
    marginFor,
    isFrenchHoliday,
    heureFr,
    semaineFrancaise,
    journeeFrancaise,
    JOUR_NOM
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
