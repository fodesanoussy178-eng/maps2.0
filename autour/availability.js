(function (root) {
  "use strict";

  /* ---- Disponibilité réelle d'un lieu -------------------------------------
     Une seule fonction fait autorité : getPlaceAvailability. Tout le reste de
     l'application — carte, fiches, classement — la consomme et n'interprète
     jamais un horaire de son côté.

     Quatre états sont soigneusement distingués, parce que les confondre est
     exactement ce qui trompe l'utilisateur :
       · horaires absents      → « Horaires non renseignés », jamais « Ouvert »
       · lieu fermé maintenant → avec, si on la connaît, l'heure de réouverture
       · fermeture temporaire  → l'établissement existe, il rouvrira
       · fermeture définitive  → il ne faut plus le proposer du tout

     Règle qui prime sur toutes les autres : on n'invente jamais un horaire.
     Une donnée qu'on ne sait pas lire redevient « inconnue ». */

  const DEFAULT_TIMEZONE = "Europe/Paris";

  /* Marges minimales avant fermeture, par type de lieu. Arriver au musée
     3 minutes avant la fermeture n'est pas « faisable » : c'est une visite
     qu'on n'a pas. */
  const MARGES_MINUTES = Object.freeze({
    restaurant: 45, resto: 45, fastfood: 45, cafe: 30, bar: 30,
    musee: 60, museum: 60,
    commerce: 20, friperie: 20, buy: 20, marche: 20,
    parc: 15, park: 15, playground: 15, terrain: 15,
    biblio: 30, library: 30, coworking: 30,
    cinema: 30,
    piscine: 45, swimming_pool: 45,
    defaut: 30,
  });

  const JOURS = Object.freeze({mo:0, tu:1, we:2, th:3, fr:4, sa:5, su:6});
  const JOUR_NOM = Object.freeze(["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"]);
  const JOUR_ORDRE = Object.freeze(["mo","tu","we","th","fr","sa","su"]);
  const MINUTES_JOUR = 1440;

  /* ---- Horloge locale du lieu --------------------------------------------
     Un lieu se juge à son heure, pas à celle du serveur ni du navigateur.
     On projette l'instant dans le fuseau du lieu et on raisonne ensuite en
     heure murale. Le décalage est recalculé à chaque appel, donc un
     changement d'heure ne fausse que les minutes qui l'entourent. */
  function partsInZone(timestamp, timeZone) {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false, weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = {};
    format.formatToParts(new Date(timestamp)).forEach((part) => { parts[part.type] = part.value; });
    // certains moteurs rendent minuit comme « 24 »
    const hour = Number(parts.hour) % 24;
    const weekdays = {Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6};
    return {
      year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
      hour, minute: Number(parts.minute), second: Number(parts.second),
      weekday: weekdays[parts.weekday],
      minuteOfDay: hour * 60 + Number(parts.minute),
    };
  }

  function zoneOf(place) {
    return (place && (place.timezone || place.timeZone)) || DEFAULT_TIMEZONE;
  }

  /* Toutes les dates métier passent par le même parseur que les événements.
     Le fallback reste nécessaire quand availability.js est testé seul, avant
     le chargement de temporel.js. */
  function epochInZone(value, timeZone) {
    if (value == null || value === "") return null;
    const T = root.AutourTemps;
    const parsed = T && typeof T.toEpochInZone === "function"
      ? T.toEpochInZone(value, timeZone || DEFAULT_TIMEZONE)
      : (typeof value === "number" ? value : new Date(value).getTime());
    return Number.isFinite(parsed) ? parsed : null;
  }

  /* Instant (ms UTC) correspondant à minuit local du jour de `timestamp`. */
  function localMidnight(timestamp, timeZone) {
    const parts = partsInZone(timestamp, timeZone);
    const elapsed = (parts.minuteOfDay * 60 + parts.second) * 1000;
    return timestamp - elapsed;
  }

  function minutesToClock(minutes) {
    const normalised = ((Math.round(minutes) % MINUTES_JOUR) + MINUTES_JOUR) % MINUTES_JOUR;
    const h = Math.floor(normalised / 60);
    const m = normalised % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  /* ---- Jours fériés français ---------------------------------------------
     `PH off` est extrêmement fréquent dans OpenStreetMap ; l'ignorer ferait
     annoncer « Ouvert » un 1er mai. */
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return {month, day};
  }

  function isFrenchHoliday(year, month, day) {
    const fixed = [[1,1],[5,1],[5,8],[7,14],[8,15],[11,1],[11,11],[12,25]];
    if (fixed.some(([m, d]) => m === month && d === day)) return true;
    const easter = easterSunday(year);
    const easterDate = Date.UTC(year, easter.month - 1, easter.day);
    const target = Date.UTC(year, month - 1, day);
    const offsetDays = Math.round((target - easterDate) / 86400000);
    // lundi de Pâques, Ascension, lundi de Pentecôte
    return offsetDays === 1 || offsetDays === 39 || offsetDays === 50;
  }

  /* ---- Lecture d'un opening_hours OpenStreetMap ---------------------------
     Sous-ensemble volontairement restreint de la spécification : jours,
     plages horaires, `off`, passage après minuit, `24/7`, `PH`. Tout ce qui
     sort de ce cadre (sunset, semaines paires, dates précises…) fait échouer
     la lecture entière et le lieu repasse en « horaires inconnus ». C'est
     délibéré : mieux vaut ne rien annoncer qu'annoncer faux. */
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
      if (!found[2]) { jours.push(start); continue; }
      const end = JOURS[found[2]];
      // Sa-Mo enjambe la fin de semaine
      for (let i = start; ; i = (i + 1) % 7) {
        jours.push(i);
        if (i === end) break;
      }
    }
    return {jours, feries};
  }

  function plagesDeSelecteur(selector) {
    const plages = [];
    for (const token of selector.split(",")) {
      const found = token.trim().match(RE_PLAGE);
      if (!found) return null;
      const start = Number(found[1]) * 60 + Number(found[2]);
      let end = Number(found[3]) * 60 + Number(found[4]);
      if (end === 0 && start > 0) end = MINUTES_JOUR;          // « 18:00-00:00 »
      if (end <= start) end += MINUTES_JOUR;                    // « 22:00-02:00 »
      if (start < 0 || start >= MINUTES_JOUR || end > 2 * MINUTES_JOUR) return null;
      plages.push({start, end});
    }
    return plages.length ? plages : null;
  }

  function parseOpeningHours(spec) {
    if (spec == null) return null;
    const text = String(spec).trim().toLowerCase().replace(/\s+/g, " ");
    if (!text) return null;
    // ces mentions ne sont pas des horaires : les lire serait en inventer
    if (/^(voir sur place|sur place|nc|inconnu|unknown|\?)$/.test(text)) return null;
    if (text === "24/7" || text === "24/7 open") {
      return {days: JOUR_ORDRE.map(() => [{start: 0, end: MINUTES_JOUR}]), holidaysClosed: false};
    }

    const days = [[], [], [], [], [], [], []];
    let holidaysClosed = false;
    let touched = false;

    for (const rawRule of text.split(";")) {
      const rule = rawRule.trim().replace(/^open\s+/, "");
      if (!rule) continue;

      // sépare le sélecteur de jours du sélecteur horaire
      const split = rule.match(/^((?:(?:mo|tu|we|th|fr|sa|su|ph)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)+)?(.*)$/);
      if (!split) return null;
      const selecteurJours = (split[1] || "").trim();
      const reste = (split[2] || "").trim();

      const cible = selecteurJours ? joursDeSelecteur(selecteurJours) : {jours: [0,1,2,3,4,5,6], feries: false};
      if (!cible) return null;

      const ferme = /^(off|closed)$/.test(reste);
      if (cible.feries) {
        if (!ferme) return null;      // « PH 10:00-13:00 » : hors périmètre lu
        holidaysClosed = true;
        touched = true;
        if (!cible.jours.length) continue;
      }

      if (ferme) {
        cible.jours.forEach((jour) => { days[jour] = []; });
        touched = true;
        continue;
      }

      if (reste === "24/7") {
        cible.jours.forEach((jour) => { days[jour] = [{start: 0, end: MINUTES_JOUR}]; });
        touched = true;
        continue;
      }

      const plages = plagesDeSelecteur(reste);
      if (!plages) return null;       // syntaxe hors périmètre → horaires inconnus
      cible.jours.forEach((jour) => { days[jour] = plages.slice(); });
      touched = true;
    }

    return touched ? {days, holidaysClosed} : null;
  }

  /* ---- Sources d'horaires -------------------------------------------------
     Une source faible ne doit jamais remplacer une source forte. L'ancien
     code parcourait les champs dans l'ordre d'arrivée du fournisseur : un
     `24/7` OSM pouvait donc gagner sur la page officielle, et une fermeture
     dominicale disparaissait. Le rang est désormais explicite et indépendant
     de la forme du payload.

       6 fermeture exceptionnelle officielle récente
       5 horaires officiels
       4 horaires fournis par une structure vérifiée
       3 donnée structurée avec provenance connue
       2 OpenStreetMap
       1 déclaration ponctuelle sans grille
       0 inconnu */
  const SOURCE_PRIORITY = Object.freeze({
    fermeture_officielle: 6,
    officielle: 5,
    structure_verifiee: 4,
    structure: 3,
    osm: 2,
    declaree: 1,
    inconnue: 0,
  });
  const HORAIRES_A_VERIFIER = "Horaires à vérifier";

  function texteNormalise(value) {
    return String(value == null ? "" : value).normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  const CATEGORIES_24_7_SUSPECTES = new Set([
    "biblio", "bibliotheque", "library", "mediatheque", "musee", "museum",
    "mairie", "administration", "mission locale", "caf", "centre social",
    "ecole", "school", "france travail",
  ]);
  const NOMS_24_7_SUSPECTS = new Set([
    "bibliotheque", "bibliotheques", "mediatheque", "mediatheques",
    "musee", "musees", "mairie", "mission locale", "caf",
    "centre social", "ecole", "france travail", "restaurant", "restaurants",
    "cafe", "cafes", "bar", "bars", "cinema", "cinemas", "musees",
    "parc", "parcs", "activite", "activites", "sortie", "sorties",
    "lieu", "lieux",
  ]);

  function estSuspect24h7(place) {
    const l = place || {};
    const categorie = texteNormalise(l.cat || l.categorie || l.category);
    const titre = texteNormalise(l.titre || l.title || l.name);
    const adresse = texteNormalise(l.adresse || l.address || l.addr);
    const categorieSuspecte = CATEGORIES_24_7_SUSPECTES.has(categorie) ||
      [...CATEGORIES_24_7_SUSPECTES].some((mot) => categorie.includes(mot));
    const nomGenerique = NOMS_24_7_SUSPECTS.has(titre);
    /* Un libellé générique sans adresse ne désigne pas un bâtiment. Un id OSM
       seul est une origine technique, pas une identité physique. */
    return categorieSuspecte || nomGenerique || (!titre && !adresse);
  }

  function valeurSource(place) {
    const l = place || {};
    const metadata = l.verifie && typeof l.verifie === "object" ? l.verifie : {};
    return l.source_priority || l.sourcePriority || metadata.priorite ||
      l.openingHoursProvenance || l.opening_hours_provenance || "";
  }

  function rangDepuisProvenance(value) {
    if (Number.isFinite(Number(value))) {
      const rang = Number(value);
      if (rang >= SOURCE_PRIORITY.inconnue && rang <= SOURCE_PRIORITY.fermeture_officielle)
        return rang;
    }
    const p = texteNormalise(value);
    if (!p) return 0;
    if (p.includes("site officiel") || p.includes("agenda officiel") ||
        p.includes("billetterie officielle") || p === "official" || p === "officielle")
      return SOURCE_PRIORITY.officielle;
    if (p.includes("institution") || p.includes("verifie") || p.includes("verified") ||
        p.includes("verified_structure") || p === "structure verifiee")
      return SOURCE_PRIORITY.structure_verifiee;
    if (p.includes("osm") || p.includes("openstreetmap")) return SOURCE_PRIORITY.osm;
    if (p.includes("google") || p.includes("structured") || p.includes("structure") || p === "tiers")
      return SOURCE_PRIORITY.structure;
    return 0;
  }

  function ajouterCandidat(candidats, spec, source, rang, provenance) {
    if (spec == null || spec === "") return;
    candidats.push({spec, source, rang, provenance: provenance || null});
  }

  function sourcesHoraires(place) {
    const l = place || {};
    const candidats = [];
    const provenance = valeurSource(l);
    const rangProvenance = rangDepuisProvenance(provenance);
    const metadataSources = [l.scheduleSources, l.openingHoursSources,
      l.availabilitySources, l.sourcesHoraires, l.horairesSources]
      .filter(Array.isArray).flat();

    metadataSources.forEach((entree) => {
      if (!entree) return;
      const spec = entree.spec != null ? entree.spec
        : entree.opening_hours != null ? entree.opening_hours
          : entree.openingHours != null ? entree.openingHours
            : entree.value;
      const rang = Number.isFinite(Number(entree.priority)) ? Number(entree.priority)
        : rangDepuisProvenance(entree.source || entree.provenance || entree.type);
      const source = rang >= SOURCE_PRIORITY.officielle ? "officielle"
        : rang >= SOURCE_PRIORITY.structure_verifiee ? "structure-verifiee"
          : rang >= SOURCE_PRIORITY.structure ? "structure" : "osm";
      ajouterCandidat(candidats, spec, source, rang || SOURCE_PRIORITY.inconnue,
        entree.source || entree.provenance || null);
    });

    /* La fermeture exceptionnelle est traitée séparément dans
       `fermetureExceptionnelleActive`. Ces champs-ci sont les grilles
       normales, mais leur provenance reste prioritaire sur OSM. */
    [l.officialOpeningHours, l.official_opening_hours, l.officialHours,
      l.horairesOfficiels, l.horaires_officiels].forEach((spec) =>
        ajouterCandidat(candidats, spec, "officielle", SOURCE_PRIORITY.officielle, "official"));

    [l.verifiedOpeningHours, l.verified_opening_hours, l.creatorOpeningHours,
      l.horairesStructureVerifiee, l.horaires_structure_verifies].forEach((spec) =>
        ajouterCandidat(candidats, spec, "structure-verifiee", SOURCE_PRIORITY.structure_verifiee, "verified_structure"));

    /* `openingHoursExplicit` est la donnée normalisée historique. Elle gagne
       sur OSM, mais ne se fait passer pour officielle que si sa provenance le
       dit explicitement. */
    const rangExplicite = rangProvenance || SOURCE_PRIORITY.structure;
    ajouterCandidat(candidats, l.openingHoursExplicit, "explicite", rangExplicite, provenance || "structured");
    [l.openingHoursStructured, l.opening_hours_structured, l.horairesStructures,
      l.opening_hours_canonical].forEach((spec) =>
        ajouterCandidat(candidats, spec, "structure", SOURCE_PRIORITY.structure, "structured"));

    /* Quand l'enrichissement officiel a été appliqué sur le champ historique
       `quand`, son enveloppe `verifie` reste la preuve de provenance. */
    if (rangProvenance >= SOURCE_PRIORITY.officielle)
      ajouterCandidat(candidats, l.quand, "officielle", rangProvenance, provenance);
    else if (rangProvenance >= SOURCE_PRIORITY.structure_verifiee)
      ajouterCandidat(candidats, l.quand, "structure-verifiee", rangProvenance, provenance);

    ajouterCandidat(candidats, (l.tags || {}).opening_hours, "osm", SOURCE_PRIORITY.osm, "osm");
    if (rangProvenance < SOURCE_PRIORITY.structure_verifiee)
      ajouterCandidat(candidats, l.openingHours, "osm", SOURCE_PRIORITY.osm, "osm");
    ajouterCandidat(candidats, l.opening_hours, "osm", SOURCE_PRIORITY.osm, "osm");
    ajouterCandidat(candidats, l.quand, "osm", SOURCE_PRIORITY.osm, "osm");
    return candidats;
  }

  function signatureSchedule(schedule) {
    return JSON.stringify(schedule && schedule.days);
  }

  function resolveSchedule(place) {
    const candidats = sourcesHoraires(place).map((candidate) =>
      Object.assign({}, candidate, {parsed: parseOpeningHours(candidate.spec)}))
      .filter((candidate) => candidate.parsed);
    if (!candidats.length) return {schedule: null, source: null, rank: 0, candidate: null};

    const meilleurRang = Math.max(...candidats.map((candidate) => candidate.rang));
    const meilleurs = candidats.filter((candidate) => candidate.rang === meilleurRang);
    const signatures = new Set(meilleurs.map((candidate) => signatureSchedule(candidate.parsed)));
    if (signatures.size > 1) {
      return {schedule: null, source: null, rank: meilleurRang, candidate: null,
        conflict: true, candidates: meilleurs};
    }
    const choisi = meilleurs[0];
    return {schedule: choisi.parsed, source: choisi.source, rank: choisi.rang,
      candidate: choisi, candidates: meilleurs, conflict: false};
  }

  function fermetureExceptionnelleActive(place, instant) {
    const l = place || {};
    const provenanceRank = rangDepuisProvenance(valeurSource(l));
    const jusquau = l.closure_until || l.closureUntil || l.fermeture_jusquau ||
      l.fermetureJusquau;
    /* L'enrichissement officiel publie parfois la fermeture sous forme d'une
       date de fin plutôt que d'un objet. Une date seule couvre toute la
       journée annoncée, sans être confondue avec un horaire OSM. */
    if (jusquau && provenanceRank >= SOURCE_PRIORITY.structure_verifiee) {
      const texte = String(jusquau).trim();
      const fin = /^\d{4}-\d{2}-\d{2}$/.test(texte)
        ? epochInZone(texte + "T23:59:59", zoneOf(l)) : epochInZone(texte, zoneOf(l));
      if (Number.isFinite(fin) && fin > instant)
        return {active: true, reason: l.closure_reason || l.closureReason ||
          "Fermeture exceptionnelle officielle"};
    }
    const entrees = [l.officialExceptionalClosure, l.official_exceptional_closure,
      l.fermetureExceptionnelleOfficielle, l.fermeture_exceptionnelle_officielle,
      l.exceptionalClosure, l.fermetureExceptionnelle, l.officialClosure]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value) => value != null && value !== false && value !== "");
    for (const entree of entrees) {
      if (entree === true || /^(closed|ferme|fermé|off)$/i.test(String(entree).trim()))
        return {active: true, reason: "Fermeture exceptionnelle officielle"};
      if (typeof entree !== "object") continue;
      if (entree.closed === false || entree.active === false) continue;
      const debut = entree.from || entree.start || entree.debut || entree.date;
      const fin = entree.until || entree.to || entree.end || entree.fin;
      const tDebut = debut ? epochInZone(debut, zoneOf(l)) : -Infinity;
      const tFin = fin ? epochInZone(fin, zoneOf(l)) : Infinity;
      if (Number.isFinite(tDebut) && tDebut > instant) continue;
      if (Number.isFinite(tFin) && tFin <= instant) continue;
      return {active: true, reason: entree.reason || entree.raison ||
        "Fermeture exceptionnelle officielle"};
    }
    return {active: false, reason: null};
  }

  function marginFor(place) {
    const explicit = Number(place && place.minimumMargin);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const keys = [place && place.cat, ...((place && place.categories) || [])];
    for (const key of keys) {
      if (key && MARGES_MINUTES[key] != null) return MARGES_MINUTES[key];
    }
    return MARGES_MINUTES.defaut;
  }

  /* Intervalles d'ouverture en minutes depuis minuit local d'aujourd'hui, sur
     une fenêtre glissante. La veille compte : une plage 22:00-02:00 déborde
     sur aujourd'hui. */
  function buildIntervals(schedule, reference, timeZone, daysAhead) {
    const midnight = localMidnight(reference, timeZone);
    const intervals = [];
    for (let offset = -1; offset <= daysAhead; offset += 1) {
      const dayStart = midnight + offset * MINUTES_JOUR * 60000;
      const parts = partsInZone(dayStart + 12 * 3600000, timeZone);   // midi : jamais ambigu
      if (schedule.holidaysClosed && isFrenchHoliday(parts.year, parts.month, parts.day)) continue;
      const plages = schedule.days[parts.weekday] || [];
      plages.forEach((plage) => {
        intervals.push({
          start: dayStart + plage.start * 60000,
          end: dayStart + plage.end * 60000,
          dayOffset: offset,
          weekday: parts.weekday,
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

  /* ---- Fonction centrale --------------------------------------------------
     `place` : le lieu. `now` : instant courant. `arrival` : heure d'arrivée
     estimée (ETA porte-à-porte) — facultative. */
  function getPlaceAvailability(place, now, arrival, options) {
    const target = place || {};
    const opts = options || {};
    const timeZone = zoneOf(target);
    const instant = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const arriveAt = Number.isFinite(Number(arrival)) ? Number(arrival) : null;

    const base = {
      status: "unknown", isOpenNow: false, isOpenAtArrival: null,
      opensAt: null, closesAt: null, opensAtTime: null, closesAtTime: null,
      label: "Horaires non renseignés", reason: null, source: null,
      sourceRank: SOURCE_PRIORITY.inconnue, provenance: null,
      scheduleText: null, conflict: false, suspect24h7: false,
      timeZone, marginMinutes: marginFor(target), meetsMargin: null,
    };

    // 1. fermeture définitive : le lieu ne doit plus être proposé du tout
    if (target.permanentlyClosed === true || target.definitivementFerme === true) {
      return Object.assign({}, base, {
        status: "permanently_closed", isOpenAtArrival: false,
        label: "Définitivement fermé",
        reason: target.closureReason || "Signalé comme définitivement fermé",
      });
    }

    // 2. fermeture temporaire : l'établissement existe et rouvrira
    if (target.temporarilyClosed === true || target.fermetureTemporaire === true ||
        target.temporary_closed === true) {
      return Object.assign({}, base, {
        status: "closed", isOpenAtArrival: false,
        label: "Fermé temporairement",
        reason: target.closureReason || null,
      });
    }

    /* Une fermeture exceptionnelle officielle est la seule information qui
       puisse suspendre une grille habituelle sans l'effacer. Elle est testée
       avant OSM, avant un booléen « ouvert » et avant tout calcul d'intervalle. */
    const fermeture = fermetureExceptionnelleActive(target, instant);
    if (fermeture.active) {
      return Object.assign({}, base, {
        status: "closed", isOpenAtArrival: false,
        label: "Fermé exceptionnellement",
        reason: fermeture.reason,
        source: "fermeture-officielle",
        sourceRank: SOURCE_PRIORITY.fermeture_officielle,
      });
    }

    const resolution = resolveSchedule(target);
    const {schedule, source} = resolution;

    /* Un statut fermé ne peut être pris en compte sans provenance au moins
       vérifiée. Un « open » faible ne doit pas écraser une grille officielle,
       mais un état officiel fermé reste une fermeture actuelle explicite. */
    const provenanceRank = rangDepuisProvenance(valeurSource(target));
    const statutCourant = texteNormalise(target.current_status || target.currentStatus);
    const fermetureCourante = (statutCourant === "closed" || statutCourant === "temporary closed" ||
      statutCourant === "permanently closed") &&
      provenanceRank >= SOURCE_PRIORITY.structure_verifiee;
    if (fermetureCourante) {
      return Object.assign({}, base, {
        status: statutCourant === "permanently closed" ? "permanently_closed" : "closed",
        isOpenAtArrival: false,
        label: statutCourant === "permanently closed" ? "Définitivement fermé" : "Fermé",
        reason: target.closure_reason || target.closureReason || null,
        source: provenanceRank >= SOURCE_PRIORITY.officielle ? "officielle" : "structure-verifiee",
        sourceRank: provenanceRank,
        provenance: valeurSource(target) || null,
      });
    }

    /* Un statut d'ouverture officiel ou vérifié est une observation plus
       forte qu'une grille OSM. Il reste ponctuel : on ne l'utilise que pour
       l'instant demandé, jamais pour « Ce soir » quand le résolveur lui
       interdit les statuts ponctuels. */
    if (statutCourant === "open" && provenanceRank >= SOURCE_PRIORITY.structure_verifiee &&
        opts.allowPointStatus !== false &&
        (!schedule || resolution.rank < provenanceRank)) {
      return Object.assign({}, base, {
        status: "open", isOpenNow: true, label: "Ouvert",
        reason: "Statut vérifié prioritaire sur une source horaire plus faible",
        source: provenanceRank >= SOURCE_PRIORITY.officielle ? "officielle" : "structure-verifiee",
        sourceRank: provenanceRank, provenance: valeurSource(target) || null,
      });
    }

    // 3. aucun horaire lisible : on le dit, on ne suppose rien.
    if (!schedule) {
      if (resolution.conflict) {
        return Object.assign({}, base, {
          label: HORAIRES_A_VERIFIER,
          reason: "Des sources de même niveau se contredisent",
          conflict: true,
          sourceRank: resolution.rank || SOURCE_PRIORITY.inconnue,
        });
      }
      /* Un statut ponctuel issu d'une structure officielle ou vérifiée est
         exploitable pour l'instant demandé. Il est volontairement consulté
         avant le booléen historique : une source faible ne peut pas annuler
         une affirmation plus forte. Il n'est jamais utilisé pour une heure
         future (« Ce soir »). */
      if (statutCourant === "open" && provenanceRank >= SOURCE_PRIORITY.structure_verifiee &&
          opts.allowPointStatus !== false) {
        return Object.assign({}, base, {
          status: "open", isOpenNow: true, label: "Ouvert",
          reason: "Statut vérifié sans grille détaillée",
          source: provenanceRank >= SOURCE_PRIORITY.officielle ? "officielle" : "structure-verifiee",
          sourceRank: provenanceRank, provenance: valeurSource(target) || null,
        });
      }
      // Google peut savoir « ouvert maintenant » sans nous donner la grille :
      // c'est exploitable pour l'instant présent, jamais pour l'arrivée.
      if ((target.ouvert === true || target.ouvert === false) &&
          !resolution.conflict && opts.allowPointStatus !== false) {
        const open = target.ouvert === true;
        return Object.assign({}, base, {
          status: open ? "open" : "closed",
          isOpenNow: open,
          isOpenAtArrival: null,
          label: open ? "Ouvert" : "Fermé",
          reason: "Horaires détaillés non renseignés",
          source: "declaree",
          sourceRank: SOURCE_PRIORITY.declaree,
        });
      }
      return base;
    }

    const suspect24h7 = source === "osm" &&
      String(resolution.candidate && resolution.candidate.spec || "").trim().toLowerCase() === "24/7" &&
      estSuspect24h7(target);
    if (suspect24h7) {
      return Object.assign({}, base, {
        label: HORAIRES_A_VERIFIER,
        reason: "Un lieu générique ne peut pas être confirmé comme ouvert 24/7",
        source, sourceRank: resolution.rank, provenance: resolution.candidate && resolution.candidate.provenance,
        scheduleText: resolution.candidate && resolution.candidate.spec,
        suspect24h7: true,
      });
    }

    const intervals = buildIntervals(schedule, instant, timeZone, 9);
    const current = intervalAt(intervals, instant);
    const upcoming = nextOpening(intervals, instant);
    const margin = base.marginMinutes;

    const result = Object.assign({}, base, {
      source, sourceRank: resolution.rank || SOURCE_PRIORITY.inconnue,
      provenance: resolution.candidate && resolution.candidate.provenance,
      scheduleText: resolution.candidate && resolution.candidate.spec,
      isOpenNow: !!current,
    });

    if (current) {
      result.status = "open";
      result.closesAt = new Date(current.end).toISOString();
      result.closesAtTime = formatIn(current.end, timeZone);
      const minutesLeft = Math.round((current.end - instant) / 60000);
      if (minutesLeft <= margin) {
        result.status = "closing_soon";
        result.reason = "Ferme dans " + minutesLeft + " min";
      }
      result.label = "Ouvert • ferme à " + result.closesAtTime;
    } else if (upcoming) {
      result.opensAt = new Date(upcoming.start).toISOString();
      result.opensAtTime = formatIn(upcoming.start, timeZone);
      const minutesUntil = Math.round((upcoming.start - instant) / 60000);
      result.status = minutesUntil <= 60 ? "opening_soon" : "closed";

      if (upcoming.dayOffset === 0) {
        result.label = "Fermé • ouvre à " + result.opensAtTime;
      } else if (upcoming.dayOffset === 1) {
        // ferme pour aujourd'hui, mais rouvre demain
        result.label = "Fermé aujourd’hui";
        result.reason = "Ouvre demain à " + result.opensAtTime;
      } else {
        result.label = "Fermé • ouvre " + JOUR_NOM[upcoming.weekday] + " à " + result.opensAtTime;
      }
    } else {
      result.status = "closed";
      result.label = "Fermé";
      result.reason = "Aucune réouverture connue dans les prochains jours";
    }

    // 4. faisabilité à l'arrivée — le cœur du « réellement faisable »
    if (arriveAt != null) {
      const atArrival = intervalAt(intervals, arriveAt);
      result.isOpenAtArrival = !!atArrival;
      if (atArrival) {
        const minutesLeft = Math.round((atArrival.end - arriveAt) / 60000);
        result.meetsMargin = minutesLeft >= margin;
        if (!result.meetsMargin) {
          result.reason = "Ferme " + minutesLeft + " min après votre arrivée";
        }
      } else {
        result.meetsMargin = false;
      }
    }

    return result;
  }

  /* Contrat d'ouverture commun aux surfaces. `getPlaceAvailability` conserve
     son vocabulaire détaillé pour les appels historiques ; cette projection
     porte le vocabulaire produit stable et peut aussi être évaluée sur une
     fenêtre future (par exemple Ce soir). */
  function etatOuverture(place, now, options) {
    const o = options || {};
    const instant = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const courant = getPlaceAvailability(place, instant, null, o);
    const openingStatus = courant.status === "open" ? "open_now"
      : courant.status === "closing_soon" ? "closing_soon"
        : courant.status === "permanently_closed" || courant.status === "closed" ||
          courant.status === "opening_soon" ? "closed" : "unknown";
    const base = Object.assign({}, courant, {openingStatus, canonicalStatus: openingStatus});
    const fenetre = o.window || o.fenetre || null;
    if (!fenetre || !Number.isFinite(Number(fenetre.debut)) || !Number.isFinite(Number(fenetre.fin)))
      return base;
    const debut = Number(fenetre.debut), fin = Number(fenetre.fin);
    if (fin <= debut) return base;
    const aDebut = getPlaceAvailability(place, debut, null,
      Object.assign({}, o, {allowPointStatus:false}));
    let accessible = aDebut && (aDebut.status === "open" || aDebut.status === "closing_soon");
    let observation = aDebut;
    if (!accessible && aDebut && aDebut.opensAt) {
      const ouverture = epochInZone(aDebut.opensAt, zoneOf(place));
      if (Number.isFinite(ouverture) && ouverture < fin) {
        observation = getPlaceAvailability(place, Math.min(fin - 60000, ouverture + 60000), null,
          Object.assign({}, o, {allowPointStatus:false}));
        accessible = observation.status === "open" || observation.status === "closing_soon";
      }
    }
    if (accessible) {
      return Object.assign(base, {
        openingStatus: "open_tonight", canonicalStatus: "open_tonight",
        windowAvailability: observation,
      });
    }
    return Object.assign(base, {windowAvailability: observation || aDebut || null});
  }

  root.AutourAvailability = Object.freeze({
    DEFAULT_TIMEZONE,
    MARGES_MINUTES,
    SOURCE_PRIORITY,
    HORAIRES_A_VERIFIER,
    parseOpeningHours,
    resolveSchedule,
    estSuspect24h7,
    getPlaceAvailability,
    etatOuverture,
    marginFor,
    isFrenchHoliday,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
