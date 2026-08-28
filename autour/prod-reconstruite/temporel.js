(function(root) {
  "use strict";
  const STATUTS = Object.freeze({
    EN_COURS: "happening_now",
    IMMINENT: "starting_soon",
    PLUS_TARD: "later_today",
    A_VENIR: "upcoming",
    PASSE: "past",
    INCONNU: "unknown"
  });
  const STATUTS_CANONIQUES = Object.freeze({
    now: STATUTS.EN_COURS,
    past: STATUTS.PASSE,
    unknown_date: STATUTS.INCONNU
  });
  const FENETRE_IMMINENT_MS = 2 * 3600 * 1e3;
  const SEUIL_PERIODE_LONGUE_MS = 36 * 3600 * 1e3;
  const DUREE_SUPPOSEE_MS = 3 * 3600 * 1e3;
  const DEFAULT_TIMEZONE = "Europe/Paris";
  function toEpoch(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }
  function dateCivil(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const ordinal = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const d = new Date(ordinal);
    return Number.isFinite(ordinal) && d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === Number(match[2]) - 1 && d.getUTCDate() === Number(match[3]) ? ordinal : null;
  }
  function isoCivil(ordinal) {
    return new Date(ordinal).toISOString().slice(0, 10);
  }
  function fenetresTemporelles(temporal) {
    const liste = Array.isArray(temporal?.time_windows) ? temporal.time_windows : Array.isArray(temporal?.windows) ? temporal.windows : [];
    const sorties = liste.map((item) => {
      const start2 = String(item?.start_time ?? item?.startTime ?? item?.start ?? "");
      const end2 = String(item?.end_time ?? item?.endTime ?? item?.end ?? "");
      const debut2 = start2.match(/^(\d{2}):(\d{2})$/);
      const fin2 = end2.match(/^(\d{2}):(\d{2})$/);
      if (!debut2 || !fin2) return null;
      const debutMinutes = Number(debut2[1]) * 60 + Number(debut2[2]);
      const finMinutes = Number(fin2[1]) * 60 + Number(fin2[2]);
      if (debutMinutes > 1439 || finMinutes > 1439) return null;
      let offset = Number(item?.end_day_offset ?? item?.endDayOffset);
      if (!Number.isInteger(offset)) offset = finMinutes <= debutMinutes ? 1 : 0;
      if (offset < 0 || offset > 2) return null;
      return { start: debutMinutes, end: finMinutes, offset };
    }).filter(Boolean);
    if (sorties.length) return sorties;
    const start = String(temporal?.start_time || "").match(/^(\d{2}):(\d{2})$/);
    const end = String(temporal?.end_time || "").match(/^(\d{2}):(\d{2})$/);
    if (!start || !end) return [];
    const debut = Number(start[1]) * 60 + Number(start[2]);
    const fin = Number(end[1]) * 60 + Number(end[2]);
    if (debut > 1439 || fin > 1439) return [];
    return [{ start: debut, end: fin, offset: fin <= debut ? 1 : 0 }];
  }
  function reglesMensuelles(temporal) {
    const liste = Array.isArray(temporal?.monthly_rules) ? temporal.monthly_rules : [];
    return liste.map((rule) => {
      const weekday = Number(rule?.weekday ?? rule?.weekday_number ?? rule?.jour);
      const ordinal = Number(rule?.ordinal ?? rule?.nth ?? rule?.rang);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !Number.isInteger(ordinal) || ordinal === 0 || ordinal < -1 || ordinal > 4) return null;
      return { weekday, ordinal, windows: fenetresTemporelles(rule) };
    }).filter(Boolean);
  }
  function exceptionMap(temporal) {
    const liste = Array.isArray(temporal?.exceptions) ? temporal.exceptions : Array.isArray(temporal?.exceptional_dates) ? temporal.exceptional_dates : Array.isArray(temporal?.closed_dates) ? temporal.closed_dates : [];
    const map = /* @__PURE__ */ new Map();
    liste.forEach((item) => {
      const date = String(item?.date ?? item?.date_unique ?? item?.day ?? "");
      if (!dateCivil(date)) return;
      const status = String(item?.status ?? item?.statut ?? "").toLowerCase();
      map.set(date, {
        closed: item?.closed === true || /closed|ferme|annul/.test(status),
        windows: fenetresTemporelles(item)
      });
    });
    return map;
  }
  function datesBornes(temporal, now, timeZone, mensuel) {
    let premier = dateCivil(temporal?.date_unique || temporal?.period_start);
    let dernier = dateCivil(temporal?.date_unique || temporal?.period_end);
    if (premier == null && dernier == null) {
      const local = partsLocales(now, timeZone);
      const courant = Date.UTC(local.annee, local.mois - 1, local.jour);
      premier = courant - (mensuel ? 62 : 14) * 864e5;
      dernier = courant + (mensuel ? 731 : 370) * 864e5;
    } else {
      if (premier == null) premier = dernier - 730 * 864e5;
      if (dernier == null) dernier = premier + 730 * 864e5;
    }
    if (!Number.isFinite(premier) || !Number.isFinite(dernier) || dernier < premier) return null;
    return { premier, dernier: Math.min(dernier, premier + 730 * 864e5) };
  }
  function dateMensuelle(annee, mois, weekday, ordinal) {
    if (ordinal === -1) {
      const dernier = new Date(Date.UTC(annee, mois, 0));
      const jour2 = dernier.getUTCDate();
      const actuel2 = dernier.getUTCDay() === 0 ? 7 : dernier.getUTCDay();
      return Date.UTC(annee, mois - 1, jour2 - (actuel2 - weekday + 7) % 7);
    }
    const premier = new Date(Date.UTC(annee, mois - 1, 1));
    const actuel = premier.getUTCDay() === 0 ? 7 : premier.getUTCDay();
    const jour = 1 + (weekday - actuel + 7) % 7 + (ordinal - 1) * 7;
    const candidate = new Date(Date.UTC(annee, mois - 1, jour));
    return candidate.getUTCMonth() === mois - 1 ? candidate.getTime() : null;
  }
  function occurrencesPourRegle(temporal, source, now, schedule) {
    if (/cancel|annul|closed|ferme|postpon/i.test(String(schedule?.status || schedule?.statut || "")))
      return [];
    const timezone = source.timezone || source.timeZone || DEFAULT_TIMEZONE;
    const regles = reglesMensuelles(schedule);
    const aJoursContraints = regles.length > 0 || Array.isArray(schedule?.weekdays);
    const bornes = datesBornes(schedule, now, timezone, regles.length > 0);
    if (!bornes) return [];
    const exceptions = exceptionMap(schedule);
    const windowsRacine = fenetresTemporelles(schedule);
    const actifs = Array.isArray(schedule?.weekdays) ? schedule.weekdays.map(Number).filter((j) => j >= 1 && j <= 7) : regles.length ? [] : schedule?.date_unique ? [] : [1, 2, 3, 4, 5, 6, 7];
    const exclus = new Set((Array.isArray(schedule?.excluded_weekdays) ? schedule.excluded_weekdays : []).map(Number));
    const jours = /* @__PURE__ */ new Set();
    for (let jour = bornes.premier; jour <= bornes.dernier; jour += 864e5) {
      const d = new Date(jour);
      const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      if (actifs.includes(weekday) && !exclus.has(weekday)) jours.add(jour);
    }
    regles.forEach((rule) => {
      const debut = new Date(bornes.premier), fin = new Date(bornes.dernier);
      for (let annee = debut.getUTCFullYear(); annee <= fin.getUTCFullYear(); annee += 1) {
        for (let mois = 1; mois <= 12; mois += 1) {
          const jour = dateMensuelle(annee, mois, rule.weekday, rule.ordinal);
          if (jour != null && jour >= bornes.premier && jour <= bornes.dernier) jours.add(jour);
        }
      }
    });
    if (!aJoursContraints && bornes.premier === bornes.dernier) jours.add(bornes.premier);
    const sorties = [];
    [...jours].sort((a, b) => a - b).forEach((jour) => {
      const date = isoCivil(jour);
      const exception = exceptions.get(date);
      if (exception?.closed) return;
      const regle = regles.find((rule) => dateMensuelle(
        new Date(jour).getUTCFullYear(),
        new Date(jour).getUTCMonth() + 1,
        rule.weekday,
        rule.ordinal
      ) === jour);
      const windows = exception?.windows?.length ? exception.windows : regle?.windows?.length ? regle.windows : windowsRacine;
      windows.forEach((window2) => {
        const d = new Date(jour);
        const p = {
          annee: d.getUTCFullYear(),
          mois: d.getUTCMonth() + 1,
          jour: d.getUTCDate(),
          heure: Math.floor(window2.start / 60),
          minute: window2.start % 60
        };
        const finJour = jour + window2.offset * 864e5;
        const f = new Date(finJour);
        const q = {
          annee: f.getUTCFullYear(),
          mois: f.getUTCMonth() + 1,
          jour: f.getUTCDate(),
          heure: Math.floor(window2.end / 60),
          minute: window2.end % 60
        };
        const start = epochLocal(p, timezone), end = epochLocal(q, timezone);
        if (end > start) sorties.push({ debut: start, fin: end, date, end_day_offset: window2.offset });
      });
    });
    return sorties;
  }
  function occurrencesTemporelles(source, now) {
    const temporal = source && (source.temporal_data || source.temporalData);
    if (!temporal || typeof temporal !== "object") return [];
    const sessions = Array.isArray(temporal.sessions) ? temporal.sessions : Array.isArray(temporal.events) ? temporal.events : [];
    if (sessions.length) return sessions.flatMap((session) => occurrencesPourRegle(temporal, source, now, Object.assign({}, session, {
      exceptions: session?.exceptions || temporal.exceptions || temporal.exceptional_dates || temporal.closed_dates
    })));
    return occurrencesPourRegle(temporal, source, now, temporal);
  }
  function normaliserPeriodes(source, now) {
    const item = source || {};
    const brutes = [];
    const temporelles = occurrencesTemporelles(item, now == null ? Date.now() : now);
    if (temporelles.length) brutes.push(...temporelles);
    const temporal = item.temporal_data || item.temporalData;
    const temporalKeys = temporal && typeof temporal === "object" ? Object.keys(temporal).filter((key) => !["provenance", "uncertain_fields"].includes(key)) : [];
    if (!temporelles.length && !temporalKeys.length) {
      const listes = [item.occurrences, item.timings, item.periodes];
      listes.forEach((liste) => {
        if (!Array.isArray(liste)) return;
        liste.forEach((t) => {
          if (!t) return;
          if (t.cancelled === true || /cancel|annul/i.test(String(t.status || t.statut || ""))) return;
          const debut = toEpoch(t.start != null ? t.start : t.start_at != null ? t.start_at : t.begin != null ? t.begin : t.debut);
          const fin = toEpoch(t.end != null ? t.end : t.end_at != null ? t.end_at : t.fin);
          if (debut != null || fin != null) brutes.push({ debut, fin });
        });
      });
    }
    if (!brutes.length) {
      const debut = toEpoch(item.startsAt != null ? item.startsAt : item.debutLe != null ? item.debutLe : item.debut_le != null ? item.debut_le : item.start_at);
      const fin = toEpoch(item.endsAt != null ? item.endsAt : item.finLe != null ? item.finLe : item.fin_le != null ? item.fin_le : item.end_at);
      if (debut != null || fin != null) brutes.push({ debut, fin });
    }
    return brutes.filter((p) => (p.debut != null || p.fin != null) && (p.debut == null || p.fin == null || p.fin > p.debut)).sort((a, b) => (a.debut == null ? Infinity : a.debut) - (b.debut == null ? Infinity : b.debut));
  }
  function finEffective(periode) {
    if (!periode) return null;
    if (periode.fin != null) return periode.fin;
    if (periode.debut != null) return periode.debut + DUREE_SUPPOSEE_MS;
    return null;
  }
  function periodeCanoniqueFiable(ligne) {
    if (!ligne || ligne.cancelled === true || /cancel|annul/i.test(String(ligne.status || ligne.statut || ""))) return null;
    const confiance = String(ligne.date_confidence ?? ligne.dateConfidence ?? "").toLowerCase();
    if (confiance === "unknown" || confiance === "day" || /incertain|unknown/.test(confiance)) return null;
    const debut = toEpoch(ligne.start_at != null ? ligne.start_at : ligne.start != null ? ligne.start : ligne.begin != null ? ligne.begin : ligne.debut);
    const fin = toEpoch(ligne.end_at != null ? ligne.end_at : ligne.end != null ? ligne.end : ligne.fin);
    if (debut == null || fin == null || fin <= debut) return null;
    return { debut, fin };
  }
  function prochainePeriode(liste, now) {
    if (!liste.length) return null;
    const t = now == null ? Date.now() : Number(now);
    const enCours = liste.find((p) => p.debut <= t && p.fin > t);
    if (enCours) return enCours;
    const suivante = liste.find((p) => p.debut > t);
    return suivante || liste[liste.length - 1];
  }
  function dateLabel(epoch, now, timeZone) {
    const p = partsLocales(epoch, timeZone);
    if (memeJour(epoch, now, timeZone)) return "Aujourd\u2019hui";
    const demain = fenetreJour(now, timeZone).fin;
    if (memeJour(epoch, demain, timeZone)) return "Demain";
    const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const mois = [
      "janvier",
      "f\xE9vrier",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "ao\xFBt",
      "septembre",
      "octobre",
      "novembre",
      "d\xE9cembre"
    ];
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      weekday: "short"
    }).format(new Date(epoch));
    const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    return (jours[index] || "") + " " + p.jour + " " + mois[p.mois - 1];
  }
  function periodeDatee(source, now) {
    const lignes = Array.isArray(source?.occurrences) && source.occurrences.length ? source.occurrences : Array.isArray(source?.timings) ? source.timings : [];
    const canoniques = lignes.map(periodeCanoniqueFiable).filter(Boolean).sort((a, b) => a.debut - b.debut);
    const canonique = prochainePeriode(canoniques, now);
    if (canonique) return { periode: canonique, source: "occurrence" };
    const debut = toEpoch(source?.start_at != null ? source.start_at : source?.startsAt != null ? source.startsAt : source?.debutLe != null ? source.debutLe : source?.debut_le);
    const fin = toEpoch(source?.end_at != null ? source.end_at : source?.endsAt != null ? source.endsAt : source?.finLe != null ? source.finLe : source?.fin_le);
    if (debut != null && fin != null && fin > debut)
      return { periode: { debut, fin }, source: "structured" };
    const temporal = source?.temporal_data || source?.temporalData;
    const valeurs = Array.isArray(temporal?.events) && temporal.events.length ? temporal.events : [temporal];
    const datee = valeurs.some((valeur) => valeur && (valeur.date_unique || valeur.period_start || valeur.period_end || Array.isArray(valeur.weekdays) && valeur.weekdays.length || Array.isArray(valeur.monthly_rules) && valeur.monthly_rules.length));
    if (!datee) return null;
    const enrichie = prochainePeriode(normaliserPeriodes(source, now), now);
    return enrichie && enrichie.fin != null ? { periode: enrichie, source: "temporal_data" } : null;
  }
  function libelleHorairesEvenement(source, now) {
    const t = now == null ? Date.now() : Number(now);
    const choisi = periodeDatee(source, t);
    if (!choisi) return null;
    const tz = source.timezone || source.timeZone || DEFAULT_TIMEZONE;
    const debut = choisi.periode.debut, fin = choisi.periode.fin;
    const debutDate = dateLabel(debut, t, tz);
    const finDate = memeJour(debut, fin, tz) ? "" : dateLabel(fin, t, tz) + " \xB7 ";
    return debutDate + " \xB7 " + heureLocale(debut, tz) + " \u2192 " + finDate + heureLocale(fin, tz);
  }
  function prochaineOccurrence(periodes, now) {
    const t = now == null ? Date.now() : Number(now);
    const liste = Array.isArray(periodes) ? periodes : normaliserPeriodes(periodes, t);
    if (!liste.length) return null;
    const enCours = liste.find((p) => {
      const fin = finEffective(p);
      return p.debut != null && p.debut <= t && (fin == null || fin > t);
    });
    if (enCours) return enCours;
    const suivante = liste.find((p) => p.debut != null && p.debut > t);
    if (suivante) return suivante;
    const derniere = liste[liste.length - 1];
    return derniere && derniere.debut != null ? derniere : null;
  }
  function partsLocales(epoch, timeZone) {
    const fmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false
    });
    const parts = {};
    fmt.formatToParts(new Date(epoch)).forEach((p) => {
      parts[p.type] = p.value;
    });
    return {
      annee: Number(parts.year),
      mois: Number(parts.month),
      jour: Number(parts.day),
      heure: Number(parts.hour === "24" ? "0" : parts.hour),
      minute: Number(parts.minute),
      jourSemaine: parts.weekday
    };
  }
  function memeJour(a, b, timeZone) {
    const x = partsLocales(a, timeZone), y = partsLocales(b, timeZone);
    return x.annee === y.annee && x.mois === y.mois && x.jour === y.jour;
  }
  function jourSemaine(epoch, timeZone) {
    const nom = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      weekday: "short"
    }).format(new Date(epoch));
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nom);
  }
  function ordinalLocal(p) {
    return Date.UTC(p.annee, p.mois - 1, p.jour) / 864e5;
  }
  function partiesOrdinal(ordinal, heure, minute) {
    const d = new Date(ordinal * 864e5);
    return {
      annee: d.getUTCFullYear(),
      mois: d.getUTCMonth() + 1,
      jour: d.getUTCDate(),
      heure: heure || 0,
      minute: minute || 0
    };
  }
  function epochLocal(p, timeZone) {
    let suppose = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure || 0, p.minute || 0);
    for (let i = 0; i < 2; i += 1) {
      const reel = partsLocales(suppose, timeZone);
      const ecart = Date.UTC(
        reel.annee,
        reel.mois - 1,
        reel.jour,
        reel.heure,
        reel.minute
      ) - Date.UTC(p.annee, p.mois - 1, p.jour, p.heure || 0, p.minute || 0);
      suppose -= ecart;
    }
    return suppose;
  }
  function fenetreJour(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    const debut = epochLocal(Object.assign({}, p, { heure: 0, minute: 0 }), timeZone);
    return { debut, fin: epochLocal(partiesOrdinal(ordinalLocal(p) + 1, 0, 0), timeZone) };
  }
  function fenetreSoir(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    const ordinal = ordinalLocal(p);
    return {
      debut: epochLocal(partiesOrdinal(ordinal, 19, 0), timeZone),
      fin: epochLocal(partiesOrdinal(ordinal + 1, 0, 0), timeZone)
    };
  }
  function fenetreWeekEnd(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    const ordinal = ordinalLocal(p);
    const semaine = jourSemaine(epoch, timeZone);
    const decalage = semaine === 6 ? 0 : semaine === 0 ? -1 : 6 - semaine;
    const samedi = ordinal + decalage;
    return {
      debut: epochLocal(partiesOrdinal(samedi, 0, 0), timeZone),
      fin: epochLocal(partiesOrdinal(samedi + 2, 0, 0), timeZone)
    };
  }
  function periodeIntersecte(etat, fenetre) {
    if (!etat || etat.debut == null || !fenetre) return false;
    const fin = etat.fin == null ? etat.debut : etat.fin;
    return etat.debut < fenetre.fin && fin > fenetre.debut;
  }
  function estDansCoupure(periodes, now, timeZone) {
    const liste = Array.isArray(periodes) ? periodes : [];
    const precedent = [...liste].reverse().find((p) => p.fin != null && p.fin <= now);
    const suivante = liste.find((p) => p.debut != null && p.debut > now);
    return !!(precedent && suivante && memeJour(precedent.debut, suivante.debut, timeZone) && memeJour(suivante.debut, now, timeZone));
  }
  function statutSessionsCanoniques(source, now, timeZone) {
    if (source?.annule || source?.cancelled || source?.status === "cancelled")
      return { statut: STATUTS.PASSE, timeZone, annule: true, occurrences: 0 };
    const lignes = Array.isArray(source?.occurrences) ? source.occurrences : Array.isArray(source?.timings) ? source.timings : [];
    if (lignes.length < 2) return null;
    const periodes = normaliserPeriodes(Object.assign({}, source, { temporal_data: null }), now);
    const occurrence = prochaineOccurrence(periodes, now);
    if (!occurrence) {
      const toutesAnnulees = lignes.length > 0 && lignes.every((ligne2) => ligne2?.cancelled === true || /cancel|annul/i.test(String(ligne2?.status || ligne2?.statut || "")));
      return toutesAnnulees ? { statut: STATUTS.PASSE, timeZone, annule: true, occurrences: 0 } : { statut: STATUTS.INCONNU, timeZone, occurrences: 0 };
    }
    const ligne = lignes.find((x) => {
      const debut = toEpoch(x.start_at != null ? x.start_at : x.start != null ? x.start : x.begin);
      return debut === occurrence.debut;
    });
    const commun = {
      timeZone,
      debut: occurrence.debut,
      fin: finEffective(occurrence),
      finReelle: occurrence.fin,
      occurrence,
      occurrences: periodes.length,
      canonique: "occurrences"
    };
    if (ligne?.cancelled === true || /cancel|annul/i.test(String(ligne?.status || ligne?.statut || "")))
      return Object.assign({ statut: STATUTS.PASSE, annule: true }, commun);
    if (occurrence.debut <= now) {
      if (occurrence.fin == null || ligne?.date_confidence === "unknown")
        return Object.assign({ statut: STATUTS.INCONNU }, commun);
      return occurrence.fin > now ? Object.assign({ statut: STATUTS.EN_COURS }, commun) : Object.assign({ statut: STATUTS.PASSE }, commun);
    }
    if (ligne?.date_confidence === "unknown")
      return Object.assign({ statut: STATUTS.INCONNU }, commun);
    const dansMs = occurrence.debut - now;
    return Object.assign({
      statut: dansMs <= FENETRE_IMMINENT_MS && memeJour(occurrence.debut, now, timeZone) ? STATUTS.IMMINENT : memeJour(occurrence.debut, now, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR,
      dansMs
    }, commun);
  }
  function statutPeriodeLongue(source, t, timeZone, commun, options) {
    const o = options || {};
    const dispo = typeof o.disponibilite === "function" ? o.disponibilite(source, t) : null;
    if (!dispo || dispo.status === "unknown")
      return Object.assign({ statut: STATUTS.INCONNU, periodeLongue: true }, commun);
    if (dispo.status === "permanently_closed")
      return Object.assign({ statut: STATUTS.PASSE, periodeLongue: true, dispo }, commun);
    if (dispo.isOpenNow)
      return Object.assign({ statut: STATUTS.EN_COURS, periodeLongue: true, dispo }, commun);
    const ouvre = dispo.opensAt ? Date.parse(dispo.opensAt) : NaN;
    const suivant = Number.isFinite(ouvre) && ouvre > t ? ouvre : null;
    if (suivant == null)
      return Object.assign({ statut: STATUTS.PLUS_TARD, periodeLongue: true, dispo }, commun);
    const statut = memeJour(suivant, t, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR;
    return Object.assign(
      { statut, periodeLongue: true, dispo },
      commun,
      { debut: suivant, dansMs: suivant - t }
    );
  }
  function statutTemporel(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    const o = options || {};
    const source = item || {};
    const timeZone = source.timezone || source.timeZone || o.timeZone || DEFAULT_TIMEZONE;
    const sessionsCanoniques = statutSessionsCanoniques(source, t, timeZone);
    if (sessionsCanoniques) return sessionsCanoniques;
    const temporalStatus = source.temporalStatus || source.temporal_status;
    if (temporalStatus) {
      const ferme = STATUTS_CANONIQUES[temporalStatus];
      const periodes2 = normaliserPeriodes(source, t);
      const occurrence2 = prochaineOccurrence(periodes2, t);
      const commun2 = {
        timeZone,
        debut: occurrence2 ? occurrence2.debut : null,
        fin: occurrence2 ? finEffective(occurrence2) : null,
        finReelle: occurrence2 ? occurrence2.fin : null,
        occurrence: occurrence2,
        occurrences: periodes2.length,
        canonique: temporalStatus
      };
      if (source.annule || source.cancelled || source.status === "cancelled") commun2.annule = true;
      if (commun2.annule) return Object.assign({ statut: STATUTS.PASSE }, commun2);
      if (ferme === STATUTS.PASSE || ferme === STATUTS.INCONNU)
        return Object.assign({ statut: ferme }, commun2);
      if (ferme === STATUTS.EN_COURS) {
        if (commun2.debut != null && commun2.finReelle != null && commun2.debut <= t && commun2.finReelle > t) {
          if (commun2.finReelle - commun2.debut > SEUIL_PERIODE_LONGUE_MS)
            return statutPeriodeLongue(source, t, timeZone, commun2, o);
          return Object.assign({ statut: ferme }, commun2);
        }
        if (commun2.debut == null || commun2.finReelle == null)
          return Object.assign({ statut: STATUTS.INCONNU }, commun2);
        return Object.assign({
          statut: commun2.finReelle <= t ? STATUTS.PASSE : memeJour(commun2.debut, t, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR,
          dansMs: commun2.debut - t
        }, commun2);
      }
      if (commun2.debut == null) return Object.assign({ statut: STATUTS.INCONNU }, commun2);
      if (commun2.finReelle != null && commun2.finReelle <= t)
        return Object.assign({ statut: STATUTS.PASSE }, commun2);
      if (commun2.debut <= t)
        return Object.assign({ statut: STATUTS.INCONNU }, commun2);
      return Object.assign({
        statut: memeJour(commun2.debut, t, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR,
        dansMs: commun2.debut - t
      }, commun2);
    }
    if (!source.isTemporary) {
      const dispo = typeof o.disponibilite === "function" ? o.disponibilite(source, t) : null;
      if (!dispo || dispo.status === "unknown") return { statut: STATUTS.INCONNU, timeZone };
      if (dispo.status === "permanently_closed") return { statut: STATUTS.PASSE, timeZone };
      return { statut: dispo.isOpenNow ? STATUTS.EN_COURS : STATUTS.PLUS_TARD, timeZone, dispo };
    }
    if (source.annule || source.cancelled || source.status === "cancelled")
      return { statut: STATUTS.PASSE, timeZone, annule: true };
    const temporalData = source.temporal_data || source.temporalData;
    const temporalStatusLocal = String(temporalData?.status || temporalData?.statut || "").toLowerCase();
    if (/cancel|annul|closed|ferme/.test(temporalStatusLocal))
      return { statut: STATUTS.PASSE, timeZone, annule: true };
    if (/postpon|report|reschedul/.test(temporalStatusLocal))
      return { statut: STATUTS.INCONNU, timeZone };
    const periodes = normaliserPeriodes(source, t);
    if (!periodes.length) return { statut: STATUTS.INCONNU, timeZone };
    const occurrence = prochaineOccurrence(periodes, t);
    if (!occurrence || occurrence.debut == null) return { statut: STATUTS.INCONNU, timeZone };
    const debut = occurrence.debut;
    const fin = finEffective(occurrence);
    const commun = { timeZone, debut, fin, occurrence, occurrences: periodes.length };
    if (fin != null && fin <= t) return Object.assign({ statut: STATUTS.PASSE }, commun);
    if (debut <= t) {
      const etendue = fin == null ? 0 : fin - debut;
      if (etendue > SEUIL_PERIODE_LONGUE_MS) {
        return statutPeriodeLongue(source, t, timeZone, commun, o);
      }
      return Object.assign({ statut: STATUTS.EN_COURS }, commun);
    }
    if (estDansCoupure(periodes, t, timeZone))
      return Object.assign({ statut: STATUTS.PLUS_TARD, dansMs: debut - t }, commun);
    if (debut - t <= FENETRE_IMMINENT_MS)
      return Object.assign({ statut: STATUTS.IMMINENT, dansMs: debut - t }, commun);
    if (memeJour(debut, t, timeZone))
      return Object.assign({ statut: STATUTS.PLUS_TARD }, commun);
    return Object.assign({ statut: STATUTS.A_VENIR }, commun);
  }
  function estMaintenant(statut) {
    return statut === STATUTS.EN_COURS || statut === STATUTS.IMMINENT;
  }
  const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const MOIS = [
    "janv.",
    "f\xE9vr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "ao\xFBt",
    "sept.",
    "oct.",
    "nov.",
    "d\xE9c."
  ];
  function heureLocale(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    return String(p.heure).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0");
  }
  function libelleTemporel(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    const etat = options && options.statut || statutTemporel(item, t, options);
    const tz = etat.timeZone;
    switch (etat.statut) {
      case STATUTS.EN_COURS:
        return etat.periodeLongue && etat.dispo && etat.dispo.closesAtTime ? "En cours \xB7 jusqu\u2019\xE0 " + etat.dispo.closesAtTime : "Maintenant";
      case STATUTS.IMMINENT: {
        const minutes = Math.max(1, Math.round(etat.dansMs / 6e4));
        return "Commence dans " + minutes + " min";
      }
      case STATUTS.PLUS_TARD: {
        if (etat.debut == null)
          return etat.dispo && etat.dispo.opensAtTime ? "Ouvre \xE0 " + etat.dispo.opensAtTime : "Plus tard";
        const p = partsLocales(etat.debut, tz);
        return (p.heure >= 18 ? "Ce soir \xB7 " : "Aujourd\u2019hui \xB7 ") + heureLocale(etat.debut, tz);
      }
      case STATUTS.A_VENIR: {
        const p = partsLocales(etat.debut, tz);
        const demain = new Date(t + 24 * 3600 * 1e3).getTime();
        if (memeJour(etat.debut, demain, tz)) return "Demain \xB7 " + heureLocale(etat.debut, tz);
        const j = new Date(etat.debut);
        const jourSemaine2 = JOURS[Number(new Intl.DateTimeFormat(
          "en-US",
          { timeZone: tz, weekday: "short" }
        ).format(j) === "Sun" ? 0 : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(j)))];
        return jourSemaine2 + " " + p.jour + " " + MOIS[p.mois - 1] + " \xB7 " + heureLocale(etat.debut, tz);
      }
      case STATUTS.PASSE:
        return etat.annule ? "Annul\xE9" : "Termin\xE9";
      default:
        return "Date \xE0 v\xE9rifier";
    }
  }
  function sectionTemporelle(etat, now) {
    const t = now == null ? Date.now() : Number(now);
    if (!etat || etat.debut == null) return null;
    const fin = etat.finReelle != null ? etat.finReelle : etat.fin;
    if (fin != null && fin <= t) return null;
    if (estMaintenant(etat.statut)) return "maintenant";
    if (etat.statut === STATUTS.PASSE) return null;
    const tz = etat.timeZone;
    const p = partsLocales(etat.debut, tz);
    const soir = fenetreSoir(t, tz);
    if (periodeIntersecte(etat, soir) && (etat.finReelle != null || etat.debut >= soir.debut)) return "ce_soir";
    const weekend = fenetreWeekEnd(t, tz);
    if (periodeIntersecte(etat, weekend)) return "ce_week_end";
    const aujourdHui = fenetreJour(t, tz);
    if (periodeIntersecte(etat, aujourdHui)) return "aujourdhui";
    return "a_venir";
  }
  root.AutourTemps = Object.freeze({
    STATUTS,
    STATUTS_CANONIQUES,
    FENETRE_IMMINENT_MS,
    SEUIL_PERIODE_LONGUE_MS,
    DUREE_SUPPOSEE_MS,
    DEFAULT_TIMEZONE,
    normaliserPeriodes,
    prochaineOccurrence,
    statutTemporel,
    estMaintenant,
    libelleTemporel,
    libelleHorairesEvenement,
    sectionTemporelle,
    partsLocales,
    fenetreJour,
    fenetreSoir,
    fenetreWeekEnd
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
