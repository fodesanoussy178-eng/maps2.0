(function (root) {
  "use strict";

  /* ===================================================================
     Moteur temporel — « est-ce que ça a lieu maintenant ? »

     Le bloc « Pour toi, maintenant » proposait des événements prévus des
     semaines plus tard. Trois causes, toutes dans le modèle de données :

       · un événement SANS date exploitable passait pour disponible. La règle
         était « si startsAt est nul, on ne bloque pas » — un événement dont la
         date n'a pas pu être lue devenait donc un événement en cours ;
       · une exposition de juin à septembre était « en cours » 24 h sur 24,
         parce qu'on ne regardait que la période, jamais les horaires du jour ;
       · la fenêtre d'imminence était de douze heures, ce qui rangeait dans
         « maintenant » ce qui commence après le dîner.

     On sépare donc deux questions qui étaient mélangées : QUAND ça a lieu
     (ce fichier) et OÙ c'est classé (le ranking). Le statut est calculé
     d'abord ; le classement ne voit que ce qui a passé ce filtre.

     Rien ici ne devine : sans date lisible, le statut est `unknown`, et
     `unknown` n'est jamais « maintenant ».
     =================================================================== */

  const STATUTS = Object.freeze({
    EN_COURS:    "happening_now",
    IMMINENT:    "starting_soon",
    PLUS_TARD:   "later_today",
    A_VENIR:     "upcoming",
    PASSE:       "past",
    INCONNU:     "unknown",
    /* Contrat commun inter-surfaces. Les alias historiques ci-dessus restent
       exposés pour les fournisseurs et les tests plus anciens, mais aucun
       écran ne doit plus en déduire son propre calendrier. */
    NOW:         "now",
    SOON:        "soon",
    TODAY:       "today",
    TONIGHT:     "tonight",
    WEEKEND:     "weekend",
    UPCOMING:    "upcoming",
    PAST:        "past",
  });

  const STATUTS_TEMPORELS = Object.freeze({
    NOW: "now", SOON: "soon", TODAY: "today", TONIGHT: "tonight",
    WEEKEND: "weekend", UPCOMING: "upcoming", PAST: "past", UNKNOWN: "unknown",
  });

  /* ---- Ce que la base a déjà tranché -------------------------------------
     Les événements de la couche canonique arrivent avec un `temporalStatus`
     calculé par Postgres (`event_temporal_status`), à l'instant de la requête
     et selon une règle stricte : `now` exige un début passé, une fin future,
     des heures connues et un événement non annulé.

     Ce fichier ne refait pas ce calcul et ne le contredit jamais. Il traduit.
     La raison est simple : deux moteurs qui répondent chacun de leur côté
     finissent par ne pas répondre pareil, et c'est toujours l'utilisateur qui
     paie l'écart — un événement annoncé « maintenant » alors qu'il commence
     samedi.

     La traduction n'est pas totale, et c'est délibéré :

       · `past`, `unknown_date` sont des verdicts fermes → repris tels quels ;
       · `now` est repris pour une séance courte. Pour une période de plus de
         36 h, les horaires du jour doivent encore confirmer que le lieu est
         réellement ouvert ;
       · `soon` et `upcoming` disent seulement « pas maintenant ». La base les
         sépare à 24 h, ce qui ne dit pas s'il faut ranger l'événement dans
         « ce soir », « ce week-end » ou « à venir ». C'est une question
         d'affichage local, tranchée ici, à partir de la date réelle et du
         fuseau du lieu.

     Conséquence voulue : un événement canonique n'est JAMAIS « imminent ».
     `estMaintenant` ne peut donc être vrai que si la base a dit `now`. */
  const STATUTS_CANONIQUES = Object.freeze({
    now:          STATUTS.EN_COURS,
    past:         STATUTS.PASSE,
    unknown_date: STATUTS.INCONNU,
  });

  /* Deux heures : au-delà, ce n'est plus « maintenant ». Cette fenêtre reste
     la définition commune de l'imminence et de l'onglet Maintenant. */
  const FENETRE_IMMINENT_MS = 2 * 3600 * 1000;

  /* « Bientôt » est une fenêtre glissante des prochaines heures. Elle ne
     dépend ni de l'heure civile (matin/soir), ni d'un écran : les événements
     et les prochaines ouvertures lisent cette même borne. */
  const FENETRE_BIENTOT_MS = 6 * 3600 * 1000;

  /* Au-delà de 36 h, une « période » n'est plus une séance : c'est une
     exposition, une saison, un musée. Sa disponibilité ne se lit plus dans la
     période mais dans les horaires du jour. */
  const SEUIL_PERIODE_LONGUE_MS = 36 * 3600 * 1000;

  /* Sans heure de fin, on ne sait pas quand ça se termine. Plutôt que
     d'inventer une durée, on borne l'affichage : passé ce délai, un événement
     commencé n'est plus annoncé comme en cours. C'est une règle d'affichage
     assumée, pas une donnée. */
  /* Conservé comme alias de migration uniquement. Aucune durée n'est plus
     ajoutée à une occurrence qui n'a pas de fin réelle. */
  const DUREE_SUPPOSEE_MS = null;

  const DEFAULT_TIMEZONE = "Europe/Paris";

  function toEpoch(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function toEpochInZone(value, timeZone) {
    if (value == null || value === "") return null;
    if (value instanceof Date || typeof value === "number") return toEpoch(value);
    const text = String(value).trim();
    if (!text) return null;
    /* Une date/heure sans offset est une heure murale du lieu, pas une heure
       UTC implicite du navigateur. Les valeurs déjà zonées gardent leur
       instant absolu. */
    if (/^\d{4}-\d{2}-\d{2}(?:$|[T\s]\d{1,2}:\d{2})/.test(text) &&
        !/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2})(?::(\d{2}))?)?/);
      if (match) {
        return epochLocal({annee:Number(match[1]), mois:Number(match[2]), jour:Number(match[3]),
          heure:Number(match[4] || 0), minute:Number(match[5] || 0)}, timeZone || DEFAULT_TIMEZONE);
      }
    }
    return toEpoch(value);
  }

  const DEBUTS_STRUCTURES = Object.freeze([
    "start_at", "startAt", "event_start_at", "eventStartAt",
    "startsAt", "debutLe", "debut_le",
  ]);
  const FINS_STRUCTURES = Object.freeze([
    "end_at", "endAt", "event_end_at", "eventEndAt",
    "endsAt", "finLe", "fin_le",
  ]);

  function premiereValeur(source, champs) {
    const item = source || {};
    for (const champ of champs) {
      if (item[champ] != null && item[champ] !== "") return item[champ];
    }
    return null;
  }

  function premiereDate(source, champs) {
    const item = source || {};
    for (const champ of champs) {
      const valeur = item[champ];
      if (valeur == null || valeur === "") continue;
      if (toEpoch(valeur) != null) return valeur;
    }
    return null;
  }

  function confianceDate(source) {
    const item = source || {};
    return item.dateConfidence != null ? item.dateConfidence
      : item.date_confidence != null ? item.date_confidence
        : item.datePrecision != null ? item.datePrecision : item.date_precision;
  }

  function precisionDate(source, periode) {
    const confidence = String(confianceDate(source) || "").toLowerCase();
    if (["exact", "datetime", "date_time", "full", "precis", "precise"].includes(confidence)) return "exact";
    if (["day", "date", "jour", "approximate_day", "day_only"].includes(confidence)) return "day";
    if (["unknown", "unknown_date", "inconnu", "uncertain", "approximate"].includes(confidence)) return "unknown";
    if (!periode || periode.debut == null) return "unknown";
    /* En l'absence de l'ancien texte, deux bornes structurées restent une
       date exploitable. Une valeur numérique est déjà un instant ; une chaîne
       ISO sans heure, elle, ne doit pas recevoir une heure inventée. */
    const debutBrut = premiereDate(source, DEBUTS_STRUCTURES);
    const finBrut = premiereDate(source, FINS_STRUCTURES);
    const aHeure = (value) => typeof value === "number" || value instanceof Date ||
      /(?:T|\s)\d{1,2}:\d{2}/.test(String(value || ""));
    return aHeure(debutBrut) || aHeure(finBrut) ? "exact" : "day";
  }

  function normaliserTemporalite(source) {
    const item = source || {};
    const periodes = normaliserPeriodes(item);
    const premier = periodes[0] || null;
    const tz = item.timezone || item.timeZone || DEFAULT_TIMEZONE;
    const debutBrut = premiereDate(item, DEBUTS_STRUCTURES);
    const finBrut = premiereDate(item, FINS_STRUCTURES);
    const dateConfidence = confianceDate(item) || null;
    const precision = precisionDate(item, premier);
    const startAt = premier && premier.debut != null ? premier.debut : null;
    const endAt = premier && premier.fin != null ? premier.fin : null;
    const startLocal = startAt == null ? null : partsLocales(startAt, tz);
    const endLocal = endAt == null ? null : partsLocales(endAt, tz);
    return {
      periodes,
      start_at: debutBrut,
      end_at: finBrut,
      startAt,
      endAt,
      dateConfidence,
      precision,
      temporalStatus: item.temporalStatus || item.temporal_status || null,
      timezone: tz,
      timeZone: tz,
      dateLocale: startLocal && {year:startLocal.annee, month:startLocal.mois, day:startLocal.jour},
      heureLocale: startLocal && {hour:startLocal.heure, minute:startLocal.minute},
      endDateLocale: endLocal && {year:endLocal.annee, month:endLocal.mois, day:endLocal.jour},
      endHeureLocale: endLocal && {hour:endLocal.heure, minute:endLocal.minute},
      hasKnownDate: startAt != null,
      hasKnownTime: startAt != null && precision === "exact",
    };
  }

  /* ---- Les occurrences d'un objet, quelle que soit sa source --------------
     Supabase publie debut_le/fin_le, OpenAgenda une liste de `timings`, une
     publication maison debutLe/finLe. On ramène tout à la même forme : une
     liste de périodes triées. Une récurrence n'est rien d'autre que plusieurs
     périodes — la traiter comme un bloc continu de juin à septembre était
     l'erreur. */
  function normaliserPeriodes(source) {
    const item = source || {};
    const timeZone = item.timezone || item.timeZone || DEFAULT_TIMEZONE;
    const brutes = [];

    const listes = [item.occurrences, item.timings, item.periodes];
    listes.forEach((liste) => {
      if (!Array.isArray(liste)) return;
      liste.forEach((t) => {
        if (!t) return;
        const debut = toEpochInZone(premiereDate(t, ["start_at", "startAt", "start", "begin", "debut"]),
          t.timezone || t.timeZone || timeZone);
        const fin = toEpochInZone(premiereDate(t, ["end_at", "endAt", "end", "fin"]),
          t.timezone || t.timeZone || timeZone);
        if (debut != null || fin != null) brutes.push({ debut, fin });
      });
    });

    if (!brutes.length) {
      const debut = toEpochInZone(premiereDate(item, DEBUTS_STRUCTURES), timeZone);
      const fin = toEpochInZone(premiereDate(item, FINS_STRUCTURES), timeZone);
      if (debut != null || fin != null) brutes.push({ debut, fin });
    }

    return brutes
      .filter((p) => (p.debut != null || p.fin != null) &&
        (p.debut == null || p.fin == null || p.fin > p.debut))
      .sort((a, b) => (a.debut == null ? Infinity : a.debut) - (b.debut == null ? Infinity : b.debut));
  }

  function finEffective(periode) {
    return periode && periode.fin != null ? periode.fin : null;
  }

  /* L'occurrence qui compte : celle en cours, sinon la prochaine à venir.
     Sans elle, une série hebdomadaire était jugée sur sa première séance —
     passée depuis des mois — ou sur toute son étendue. */
  function prochaineOccurrence(periodes, now) {
    const t = now == null ? Date.now() : Number(now);
    const liste = Array.isArray(periodes) ? periodes : normaliserPeriodes(periodes);
    if (!liste.length) return null;

    const enCours = liste.find((p) => {
      const fin = finEffective(p);
      return p.debut != null && fin != null && p.debut <= t && fin > t;
    });
    if (enCours) return enCours;

    const suivante = liste.find((p) => p.debut != null && p.debut > t);
    if (suivante) return suivante;

    // que des périodes terminées, ou des périodes sans début exploitable
    const derniere = liste[liste.length - 1];
    return (derniere && derniere.debut != null) ? derniere : null;
  }

  /* ---- Jour local, dans le fuseau du LIEU --------------------------------
     « Ce soir » et « ce week-end » n'ont de sens que là où se trouve
     l'endroit. Calculer dans le fuseau du navigateur donnait un jour de
     décalage dès qu'on regardait ailleurs — ou depuis un serveur en UTC. */
  function partsLocales(epoch, timeZone) {
    const fmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
    });
    const parts = {};
    fmt.formatToParts(new Date(epoch)).forEach((p) => { parts[p.type] = p.value; });
    return {
      annee: Number(parts.year), mois: Number(parts.month), jour: Number(parts.day),
      heure: Number(parts.hour === "24" ? "0" : parts.hour), minute: Number(parts.minute),
      jourSemaine: parts.weekday,
    };
  }

  function memeJour(a, b, timeZone) {
    const x = partsLocales(a, timeZone), y = partsLocales(b, timeZone);
    return x.annee === y.annee && x.mois === y.mois && x.jour === y.jour;
  }

  /* Les créneaux de l'interface sont des jours civils, pas des durées de
     24 heures. Ces petites fonctions convertissent un jour local en borne
     UTC en tenant compte du décalage du lieu (y compris les changements
     d'heure). */
  function jourSemaine(epoch, timeZone) {
    const nom = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || DEFAULT_TIMEZONE, weekday: "short",
    }).format(new Date(epoch));
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nom);
  }

  function ordinalLocal(p) {
    return Date.UTC(p.annee, p.mois - 1, p.jour) / 86400000;
  }

  function partiesOrdinal(ordinal, heure, minute) {
    const d = new Date(ordinal * 86400000);
    return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1,
      jour: d.getUTCDate(), heure: heure || 0, minute: minute || 0 };
  }

  function epochLocal(p, timeZone) {
    let suppose = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure || 0, p.minute || 0);
    for (let i = 0; i < 2; i += 1) {
      const reel = partsLocales(suppose, timeZone);
      const ecart = Date.UTC(reel.annee, reel.mois - 1, reel.jour,
        reel.heure, reel.minute) -
        Date.UTC(p.annee, p.mois - 1, p.jour, p.heure || 0, p.minute || 0);
      suppose -= ecart;
    }
    return suppose;
  }

  function fenetreJour(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    const debut = epochLocal(Object.assign({}, p, {heure: 0, minute: 0}), timeZone);
    return { debut, fin: epochLocal(partiesOrdinal(ordinalLocal(p) + 1, 0, 0), timeZone) };
  }

  function fenetreSoir(epoch, timeZone) {
    const jour = fenetreJour(epoch, timeZone);
    const p = partsLocales(jour.debut, timeZone);
    return {
      debut: epochLocal(Object.assign({}, p, {heure: 18, minute: 0}), timeZone),
      fin: jour.fin,
    };
  }

  function fenetreBientot(epoch, timeZone) {
    const t = epoch == null ? Date.now() : Number(epoch);
    return { debut: t, fin: t + FENETRE_BIENTOT_MS, timeZone: timeZone || DEFAULT_TIMEZONE };
  }

  function fenetreWeekEnd(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    const ordinal = ordinalLocal(p);
    const semaine = jourSemaine(epoch, timeZone);
    /* samedi/dimanche : le week-end déjà commencé ; lundi-vendredi : le
       prochain samedi. Il n'y a jamais de test « samedi dans les 7 jours ». */
    const decalage = semaine === 6 ? 0 : semaine === 0 ? -1 : 6 - semaine;
    const samedi = ordinal + decalage;
    return {
      debut: epochLocal(partiesOrdinal(samedi, 0, 0), timeZone),
      fin: epochLocal(partiesOrdinal(samedi + 2, 0, 0), timeZone),
    };
  }

  function periodeIntersecte(etat, fenetre) {
    if (!etat || etat.debut == null || !fenetre) return false;
    const fin = etat.fin == null ? etat.debut : etat.fin;
    return etat.debut < fenetre.fin && fin > fenetre.debut;
  }

  /* Une surface ne reparcourt plus ses dates pour décider si une occurrence
     appartient à sa fenêtre. Cette primitive sert à Ce soir, Ce week-end et
     aux notifications : elle exige une vraie fin, donc une occurrence sans
     borne complète ne peut pas être présentée comme un rendez-vous fiable. */
  function estDansFenetre(source, fenetre, now, options) {
    const o = options || {};
    const f = fenetre || {};
    const debutFenetre = Number(f.debut), finFenetre = Number(f.fin);
    if (!Number.isFinite(debutFenetre) || !Number.isFinite(finFenetre) || finFenetre <= debutFenetre)
      return false;
    const t = now == null ? Date.now() : Number(now);
    const item = source || {};
    if (item.annule || item.cancelled || item.status === "cancelled") return false;
    return normaliserPeriodes(item).some((periode) =>
      periode.debut != null && periode.fin != null && periode.fin > t &&
      periode.debut < finFenetre && periode.fin > debutFenetre);
  }

  function fenetreSurface(surface, epoch, timeZone) {
    const t = epoch == null ? Date.now() : Number(epoch);
    const tz = timeZone || DEFAULT_TIMEZONE;
    switch (String(surface || "")) {
      case "maintenant":
        return {debut:t, fin:t + FENETRE_IMMINENT_MS, timeZone:tz};
      case "soir":
      case "ce_soir":
        return Object.assign(fenetreSoir(t, tz), {timeZone:tz});
      case "bientot":
        return fenetreBientot(t, tz);
      case "weekend":
      case "ce_week_end":
        return Object.assign(fenetreWeekEnd(t, tz), {timeZone:tz});
      case "avenir":
      case "upcoming":
        return {debut:t, fin:null, timeZone:tz};
      default:
        return {debut:t, fin:null, timeZone:tz};
    }
  }

  /* Une exposition, une saison ou un musée peut être dans sa période sans
     être accessible à cet instant. Ce verdict est commun aux données locales
     et canoniques : la provenance du statut ne change pas les horaires. */
  function statutPeriodeLongue(source, t, timeZone, commun, options) {
    const o = options || {};
    const dispo = typeof o.disponibilite === "function" ? o.disponibilite(source, t) : null;
    if (!dispo || dispo.status === "unknown")
      return Object.assign({ statut: STATUTS.INCONNU, periodeLongue: true }, commun);
    if (dispo.status === "permanently_closed")
      return Object.assign({ statut: STATUTS.PASSE, periodeLongue: true, dispo }, commun);
    if (dispo.isOpenNow)
      return Object.assign({ statut: STATUTS.EN_COURS, periodeLongue: true, dispo }, commun);

    /* Fermée à cette heure : ce qui intéresse n'est pas le début de la
       période — souvent des semaines en arrière — mais la prochaine
       ouverture. Sans cette bascule, une expo de juin à septembre
       s'annonçait « Ce soir · 22:47 », l'heure de son ouverture en juin. */
    const ouvre = dispo.opensAt ? toEpochInZone(dispo.opensAt, timeZone) : NaN;
    const suivant = Number.isFinite(ouvre) && ouvre > t ? ouvre : null;
    if (suivant == null)
      return Object.assign({ statut: STATUTS.PLUS_TARD, periodeLongue: true, dispo }, commun);
    /* Jamais « imminent » : une exposition qui rouvre dans une heure n'est
       pas un événement qui commence, c'est un lieu encore fermé. */
    const statut = memeJour(suivant, t, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR;
    return Object.assign({ statut, periodeLongue: true, dispo }, commun,
      { debut: suivant, dansMs: suivant - t });
  }

  /* ---- Le statut canonique ----------------------------------------------
     `disponibilite` est injectée par l'appelant : c'est elle qui sait lire les
     horaires d'ouverture. On ne la réimplémente pas ici, et on ne suppose
     jamais qu'un lieu est ouvert quand elle ne répond pas. */
  function statutTemporelLegacy(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    const o = options || {};
    const source = item || {};
    const timeZone = source.timezone || source.timeZone || o.timeZone || DEFAULT_TIMEZONE;

    /* La base a déjà répondu : on ne recalcule pas, on traduit. */
    const temporalStatus = source.temporalStatus || source.temporal_status;
    if (temporalStatus) {
      const ferme = STATUTS_CANONIQUES[temporalStatus];
      const periodes = normaliserPeriodes(source);
      const occurrence = prochaineOccurrence(periodes, t);
      const precision = precisionDate(source, occurrence);
      const commun = {
        timeZone,
        debut: occurrence ? occurrence.debut : null,
        fin: occurrence ? finEffective(occurrence) : null,
        finReelle: occurrence ? occurrence.fin : null,
        occurrence, occurrences: periodes.length,
        canonique: temporalStatus,
        dateConfidence: confianceDate(source) || null,
        precision,
      };
      if (source.annule || source.cancelled || source.status === "cancelled") commun.annule = true;
      if (commun.annule) return Object.assign({ statut: STATUTS.PASSE }, commun);
      if (ferme === STATUTS.PASSE || ferme === STATUTS.INCONNU)
        return Object.assign({ statut: ferme }, commun);
      if (ferme === STATUTS.EN_COURS) {
        /* Le cache `temporal_status` est recalculé en base, mais une réponse
           ancienne, un fuseau invalide ou une date écrasée ne doit jamais
           transformer un événement futur en événement en cours. Les dates
           explicites sont le dernier garde-fou de lecture. */
        if (commun.debut != null && commun.finReelle != null &&
            commun.debut <= t && commun.finReelle > t) {
          if (commun.finReelle - commun.debut > SEUIL_PERIODE_LONGUE_MS)
            return statutPeriodeLongue(source, t, timeZone, commun, o);
          return Object.assign({ statut: ferme }, commun);
        }
        if (commun.debut == null || commun.finReelle == null)
          return Object.assign({ statut: STATUTS.INCONNU }, commun);
        return Object.assign({
          statut: commun.finReelle <= t ? STATUTS.PASSE
            : (memeJour(commun.debut, t, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR),
          dansMs: commun.debut - t,
        }, commun);
      }

      // `soon` / `upcoming` : pas maintenant. Reste à savoir où le ranger,
      // ce que seule la date locale peut dire.
      if (commun.debut == null) return Object.assign({ statut: STATUTS.INCONNU }, commun);
      if (commun.finReelle != null && commun.finReelle <= t)
        return Object.assign({ statut: STATUTS.PASSE }, commun);
      if (commun.debut <= t)
        return Object.assign({ statut: STATUTS.INCONNU }, commun);
      return Object.assign({
        statut: memeJour(commun.debut, t, timeZone) ? STATUTS.PLUS_TARD : STATUTS.A_VENIR,
        dansMs: commun.debut - t,
      }, commun);
    }

    // un lieu permanent : son statut est celui de ses horaires, rien d'autre
    if (!source.isTemporary) {
      const dispo = typeof o.disponibilite === "function" ? o.disponibilite(source, t) : null;
      if (!dispo || dispo.status === "unknown") return { statut: STATUTS.INCONNU, timeZone };
      if (dispo.status === "permanently_closed") return { statut: STATUTS.PASSE, timeZone };
      return { statut: dispo.isOpenNow ? STATUTS.EN_COURS : STATUTS.PLUS_TARD, timeZone, dispo };
    }

    // une annulation prime sur toute considération d'horaire
    if (source.annule || source.cancelled || source.status === "cancelled")
      return { statut: STATUTS.PASSE, timeZone, annule: true };

    const periodes = normaliserPeriodes(source);
    if (!periodes.length) return { statut: STATUTS.INCONNU, timeZone };

    const occurrence = prochaineOccurrence(periodes, t);
    if (!occurrence || occurrence.debut == null) return { statut: STATUTS.INCONNU, timeZone };

    const debut = occurrence.debut;
    const fin = finEffective(occurrence);
    const commun = { timeZone, debut, fin, occurrence, occurrences: periodes.length,
      dateConfidence: confianceDate(source) || null,
      precision: precisionDate(source, occurrence) };

    /* Une confiance explicitement inconnue est un verdict, même si un
       fournisseur a laissé des bornes qui ressemblent à une date. Cette
       borne protège la règle « date réellement inconnue » dans le chemin
       local ; seuls les champs structurés complets sans ce marqueur peuvent
       rétablir une date exacte. */
    if (commun.precision === "unknown")
      return Object.assign({ statut: STATUTS.INCONNU }, commun);

    if (fin != null && fin <= t) return Object.assign({ statut: STATUTS.PASSE }, commun);

    if (debut <= t) {
      /* Une occurrence commencée sans fin réelle ne peut pas être déclarée
         passée ni en cours : le moteur conserve l'incertitude. */
      if (fin == null) return Object.assign({ statut: STATUTS.INCONNU }, commun);
      const etendue = (fin == null ? 0 : fin - debut);
      if (etendue > SEUIL_PERIODE_LONGUE_MS) {
        return statutPeriodeLongue(source, t, timeZone, commun, o);
      }
      return Object.assign({ statut: STATUTS.EN_COURS }, commun);
    }

    if (debut - t <= FENETRE_IMMINENT_MS)
      return Object.assign({ statut: STATUTS.IMMINENT, dansMs: debut - t }, commun);

    if (memeJour(debut, t, timeZone))
      return Object.assign({ statut: STATUTS.PLUS_TARD }, commun);

    return Object.assign({ statut: STATUTS.A_VENIR }, commun);
  }

  function estEvenement(source) {
    const item = source || {};
    return item.isTemporary === true || item.temporaire === true ||
      item.entity_type === "event" || item.entityType === "event" ||
      !!(item.temporalStatus || item.temporal_status);
  }

  function statutOuverture(dispo) {
    if (!dispo || dispo.status === "unknown") return "unknown";
    if (dispo.status === "permanently_closed" || dispo.status === "closed" ||
        dispo.status === "opening_soon") return "closed";
    if (dispo.status === "closing_soon") return "closing_soon";
    return dispo.isOpenNow ? "open_now" : "closed";
  }

  /* Le statut canonique est calculé depuis les bornes normalisées. Le verdict
     SQL reste disponible dans `sourceTemporalStatus` pour l'audit, mais un
     cache ancien ne peut plus transformer une date future en « terminé » ou
     « maintenant ». */
  function statutCanonique(source, t, legacy, options) {
    const item = source || {};
    const o = options || {};
    const timeZone = item.timezone || item.timeZone || o.timeZone || DEFAULT_TIMEZONE;
    const periodes = normaliserPeriodes(item);
    const occurrence = prochaineOccurrence(periodes, t);
    const debut = occurrence && occurrence.debut != null ? occurrence.debut : null;
    const fin = occurrence && occurrence.fin != null ? occurrence.fin : null;
    const evenement = estEvenement(item);
    const annule = !!(item.annule || item.cancelled || item.status === "cancelled");
    const precision = precisionDate(item, occurrence);

    if (annule) return STATUTS_TEMPORELS.PAST;
    if (evenement) {
      if ((legacy && legacy.canonique === "unknown_date") || precision === "unknown")
        return STATUTS_TEMPORELS.UNKNOWN;
      if (debut == null) return STATUTS_TEMPORELS.UNKNOWN;
      if (fin != null && fin <= t) return STATUTS_TEMPORELS.PAST;
      if (debut <= t) {
        /* Une occurrence commencée sans fin n'est pas prouvée en cours. */
        if (fin == null) return STATUTS_TEMPORELS.UNKNOWN;
        if (legacy && legacy.periodeLongue && legacy.statut !== STATUTS.EN_COURS)
          return statutCanoniqueDepuisLegacy(legacy, debut, t, timeZone);
        return fin > t ? STATUTS_TEMPORELS.NOW : STATUTS_TEMPORELS.PAST;
      }
      const dans = debut - t;
      if (dans <= FENETRE_IMMINENT_MS) return STATUTS_TEMPORELS.SOON;
      if (periodeIntersecte({debut, fin}, fenetreWeekEnd(t, timeZone)))
        return STATUTS_TEMPORELS.WEEKEND;
      if (memeJour(debut, t, timeZone)) {
        return partsLocales(debut, timeZone).heure >= 18
          ? STATUTS_TEMPORELS.TONIGHT : STATUTS_TEMPORELS.TODAY;
      }
      return STATUTS_TEMPORELS.UPCOMING;
    }

    const dispo = legacy && legacy.dispo
      ? legacy.dispo
      : (typeof o.disponibilite === "function" ? o.disponibilite(item, t) : null);
    const ouverture = statutOuverture(dispo);
    if (ouverture === "open_now" || ouverture === "closing_soon") return STATUTS_TEMPORELS.NOW;
    if (ouverture === "closed" && dispo && dispo.opensAt) {
      const ouvre = toEpoch(dispo.opensAt);
      if (Number.isFinite(ouvre) && ouvre > t && ouvre - t <= FENETRE_IMMINENT_MS)
        return STATUTS_TEMPORELS.SOON;
      if (Number.isFinite(ouvre) && memeJour(ouvre, t, timeZone))
        return partsLocales(ouvre, timeZone).heure >= 18
          ? STATUTS_TEMPORELS.TONIGHT : STATUTS_TEMPORELS.TODAY;
    }
    if (ouverture === "unknown") return STATUTS_TEMPORELS.UNKNOWN;
    return ouverture === "closed" ? STATUTS_TEMPORELS.UPCOMING : STATUTS_TEMPORELS.UNKNOWN;
  }

  function statutCanoniqueDepuisLegacy(legacy, debut, t, timeZone) {
    if (!legacy || legacy.statut === STATUTS.INCONNU) return STATUTS_TEMPORELS.UNKNOWN;
    if (legacy.statut === STATUTS.PASSE) return STATUTS_TEMPORELS.PAST;
    if (legacy.statut === STATUTS.EN_COURS) return STATUTS_TEMPORELS.NOW;
    if (legacy.statut === STATUTS.IMMINENT) return STATUTS_TEMPORELS.SOON;
    if (legacy.statut === STATUTS.PLUS_TARD)
      return partsLocales(debut, timeZone).heure >= 18
        ? STATUTS_TEMPORELS.TONIGHT : STATUTS_TEMPORELS.TODAY;
    if (legacy.statut === STATUTS.A_VENIR) {
      return periodeIntersecte({debut, fin:legacy.finReelle}, fenetreWeekEnd(t, timeZone))
        ? STATUTS_TEMPORELS.WEEKEND : STATUTS_TEMPORELS.UPCOMING;
    }
    return STATUTS_TEMPORELS.UNKNOWN;
  }

  function ajouterEtatCanonique(legacy, source, t, options) {
    const item = source || {};
    const timeZone = item.timezone || item.timeZone || (options && options.timeZone) || DEFAULT_TIMEZONE;
    const etat = Object.assign({}, legacy || {});
    const status = statutCanonique(item, t, etat, options);
    const periode = etat.occurrence || prochaineOccurrence(normaliserPeriodes(item), t);
    /* Les lieux longs peuvent déplacer `debut` vers leur prochaine ouverture;
       ce déplacement fait partie du verdict partagé et ne doit pas être
       réécrasé par le début historique de la saison. */
    const prochaineOuverture = !item.isTemporary && etat.dispo && etat.dispo.opensAt
      ? toEpochInZone(etat.dispo.opensAt, timeZone) : null;
    const debut = etat.debut != null ? etat.debut
      : (periode && periode.debut != null ? periode.debut
        : (Number.isFinite(prochaineOuverture) && prochaineOuverture > t ? prochaineOuverture : null));
    const finReelle = periode && periode.fin != null ? periode.fin : etat.finReelle;
    const dispo = etat.dispo || null;
    const debutLocal = debut == null ? null : partsLocales(debut, timeZone);
    const finLocal = finReelle == null ? null : partsLocales(finReelle, timeZone);
    return Object.assign(etat, {
      status,
      canonicalStatus: status,
      temporalStatus: status,
      sourceTemporalStatus: etat.canonique || item.temporalStatus || item.temporal_status || null,
      timeZone,
      timezone: timeZone,
      start_at: premiereValeur(item, DEBUTS_STRUCTURES),
      end_at: premiereValeur(item, FINS_STRUCTURES),
      debut: debut == null ? null : debut,
      finReelle: finReelle == null ? null : finReelle,
      startAt: debut == null ? null : debut,
      endAt: finReelle == null ? null : finReelle,
      dateLocale: debutLocal && {year:debutLocal.annee, month:debutLocal.mois, day:debutLocal.jour},
      heureLocale: debutLocal && {hour:debutLocal.heure, minute:debutLocal.minute},
      endDateLocale: finLocal && {year:finLocal.annee, month:finLocal.mois, day:finLocal.jour},
      endHeureLocale: finLocal && {hour:finLocal.heure, minute:finLocal.minute},
      hasKnownDate: debut != null,
      hasKnownTime: debut != null && (etat.precision || precisionDate(item, periode)) === "exact",
      openingStatus: statutOuverture(dispo),
      availability: dispo,
      now: t,
    });
  }

  /* Point d'entrée unique consommé par les surfaces, les fiches et les
     notifications. `statut` reste l'alias historique ; `status` est le
     contrat désormais commun. */
  function statutTemporel(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    return ajouterEtatCanonique(statutTemporelLegacy(item, t, options), item, t, options);
  }

  /* Point d'entrée unique pour les événements. L'objet canonique ne porte pas
     les attributs historiques d'un lieu permanent (`isTemporary`, `debutLe`),
     donc on lui donne seulement ce marqueur technique avant de déléguer au
     même moteur. Aucun horaire d'ouverture du lieu ne peut ainsi remplacer les
     bornes start_at/end_at de l'événement. */
  function etatTemporalEvenement(event, now, options) {
    const source = Object.assign({}, event || {}, {isTemporary: true});
    return statutTemporel(source, now, options);
  }

  /* Les seuls statuts qui ont leur place dans « Maintenant ». Le ranking ne
     décide pas de ça : la proximité ou les goûts ne doivent jamais y faire
     entrer un événement de la semaine prochaine. */
  function estMaintenant(statut) {
    return statut === STATUTS.EN_COURS || statut === STATUTS.IMMINENT ||
      statut === STATUTS_TEMPORELS.NOW || statut === STATUTS_TEMPORELS.SOON;
  }

  /* ---- Ce qui s'écrit sur la carte --------------------------------------
     La date réelle passe devant le temps de trajet : « Commence dans 35 min »
     décide d'y aller, « 9 min à pied » ne décide de rien tout seul. */
  const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  function heureLocale(epoch, timeZone) {
    const p = partsLocales(epoch, timeZone);
    return String(p.heure).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0");
  }

  function libelleTemporel(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    const etat = (options && options.statut) || statutTemporel(item, t, options);
    const tz = etat.timeZone;
    const status = etat.status || (
      etat.statut === STATUTS.EN_COURS ? STATUTS_TEMPORELS.NOW :
      etat.statut === STATUTS.IMMINENT ? STATUTS_TEMPORELS.SOON :
      etat.statut === STATUTS.PLUS_TARD ? STATUTS_TEMPORELS.TODAY :
      etat.statut === STATUTS.A_VENIR ? STATUTS_TEMPORELS.UPCOMING :
      etat.statut === STATUTS.PASSE ? STATUTS_TEMPORELS.PAST : STATUTS_TEMPORELS.UNKNOWN);

    switch (status) {
      case STATUTS_TEMPORELS.NOW:
        return etat.periodeLongue && etat.dispo && etat.dispo.closesAtTime
          ? "En cours · jusqu’à " + etat.dispo.closesAtTime
          : "Maintenant";

      case STATUTS_TEMPORELS.SOON: {
        const minutes = Math.max(1, Math.round(etat.dansMs / 60000));
        return "Commence dans " + minutes + " min";
      }

      case STATUTS_TEMPORELS.TODAY:
      case STATUTS_TEMPORELS.TONIGHT: {
        if (etat.debut == null)
          return etat.dispo && etat.dispo.opensAtTime ? "Ouvre à " + etat.dispo.opensAtTime : "Plus tard";
        const p = partsLocales(etat.debut, tz);
        return (status === STATUTS_TEMPORELS.TONIGHT || p.heure >= 18 ? "Ce soir · " : "Aujourd’hui · ") + heureLocale(etat.debut, tz);
      }

      case STATUTS_TEMPORELS.WEEKEND:
      case STATUTS_TEMPORELS.UPCOMING: {
        if (etat.debut == null) return "Date à vérifier";
        const p = partsLocales(etat.debut, tz);
        const demain = fenetreJour(t, tz).fin;
        if (memeJour(etat.debut, demain, tz)) return "Demain · " + heureLocale(etat.debut, tz);
        const index = jourSemaine(etat.debut, tz);
        const jourLabel = JOURS[index];
        return jourLabel + " " + p.jour + " " + MOIS[p.mois - 1] + " · " + heureLocale(etat.debut, tz);
      }

      case STATUTS_TEMPORELS.PAST:
        return etat.annule ? "Annulé" : "Terminé";

      default:
        /* Une borne connue reste affichable même si le statut est `unknown`
           (par exemple un début connu sans fin). Ce n'est pas une date à
           vérifier : c'est une date partiellement renseignée. */
        return (etat.hasKnownDate || etat.debut != null) && etat.precision !== "unknown" &&
          etat.canonique !== "unknown_date"
          ? libelleDate(item, t, {statut: etat}) : "Date à vérifier";
    }
  }

  /* Libellé descriptif commun aux cartes et aux fiches. `libelleTemporel`
     reste utile pour les badges (« Maintenant », « Ce soir »), mais il ne doit
     pas être mélangé à une date détaillée : une vue pouvait afficher l'heure
     structurée pendant qu'une autre tombait sur « Date à vérifier ». */
  function libelleDate(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    const etat = (options && options.statut) || statutTemporel(item, t, options);
    if (!etat) return "Date à vérifier";
    const status = etat.status || (etat.statut === STATUTS.PASSE ? STATUTS_TEMPORELS.PAST : null);
    if (status === STATUTS_TEMPORELS.UNKNOWN && !etat.hasKnownDate && etat.debut == null)
      return "Date à vérifier";
    if (status === STATUTS_TEMPORELS.PAST && !(options && options.ignoreStatus))
      return etat.annule ? "Annulé" : "Terminé";

    const periode = etat.occurrence || null;
    const debut = periode && periode.debut != null ? periode.debut : etat.debut;
    if (debut == null) return "Date à vérifier";
    const precision = etat.precision || precisionDate(item, periode);
    const p = partsLocales(debut, etat.timeZone || DEFAULT_TIMEZONE);
    const date = new Intl.DateTimeFormat("fr-FR", {
      weekday:"long", day:"numeric", month:"long", timeZone:etat.timeZone || DEFAULT_TIMEZONE,
    }).format(new Date(debut));
    const jour = date.charAt(0).toUpperCase() + date.slice(1);
    if (precision !== "exact") return jour;

    const heure = (epoch) => heureLocale(epoch, etat.timeZone || DEFAULT_TIMEZONE).replace(":", "h");
    const fin = periode && periode.fin != null ? periode.fin : etat.finReelle;
    return jour + " · " + heure(debut) +
      (Number.isFinite(fin) && fin > debut ? "–" + heure(fin) : "");
  }

  /* ---- Où ranger ce qui n'est pas « maintenant » -------------------------
     Un événement futur n'est pas une erreur : il a juste sa place ailleurs.
     Les sections sont calculées dans le fuseau du lieu. */
  function sectionTemporelle(etat, now) {
    const t = now == null ? Date.now() : Number(now);
    if (!etat || etat.debut == null) return null;
    const status = etat.status || (
      etat.statut === STATUTS.EN_COURS ? STATUTS_TEMPORELS.NOW :
      etat.statut === STATUTS.IMMINENT ? STATUTS_TEMPORELS.SOON :
      etat.statut === STATUTS.PLUS_TARD ? STATUTS_TEMPORELS.TODAY :
      etat.statut === STATUTS.A_VENIR ? STATUTS_TEMPORELS.UPCOMING :
      etat.statut === STATUTS.PASSE ? STATUTS_TEMPORELS.PAST : STATUTS_TEMPORELS.UNKNOWN);
    if (status === STATUTS_TEMPORELS.NOW || status === STATUTS_TEMPORELS.SOON) return "maintenant";
    if (status === STATUTS_TEMPORELS.PAST || status === STATUTS_TEMPORELS.UNKNOWN) return null;
    if (status === STATUTS_TEMPORELS.TONIGHT) return "ce_soir";
    if (status === STATUTS_TEMPORELS.WEEKEND) return "ce_week_end";

    const tz = etat.timeZone;
    const p = partsLocales(etat.debut, tz);

    /* Le week-end courant est calculé avant « aujourd'hui » afin qu'un samedi
       déjà entamé reste bien dans ce week-end, jamais dans celui d'après. */
    const weekend = fenetreWeekEnd(t, tz);
    if (periodeIntersecte(etat, weekend)) return "ce_week_end";

    /* Un événement plus tard dans la journée reste « aujourd'hui », même si
       la base l'a rangé `upcoming` parce qu'il est au-delà de sa fenêtre
       `soon`. */
    const aujourdHui = fenetreJour(t, tz);
    if (periodeIntersecte(etat, aujourdHui)) return p.heure >= 18 ? "ce_soir" : "aujourdhui";
    return "a_venir";
  }

  root.AutourTemps = Object.freeze({
    STATUTS,
    STATUTS_TEMPORELS,
    STATUTS_CANONIQUES,
    FENETRE_IMMINENT_MS,
    FENETRE_BIENTOT_MS,
    SEUIL_PERIODE_LONGUE_MS,
    DUREE_SUPPOSEE_MS,
    DEFAULT_TIMEZONE,
    normaliserPeriodes,
    normaliserTemporalite,
    statutOuverture,
    prochaineOccurrence,
    statutTemporel,
    etatTemporalEvenement,
    estMaintenant,
    libelleTemporel,
    libelleDate,
    sectionTemporelle,
    estDansFenetre,
    fenetreSurface,
    partsLocales,
    fenetreJour,
    fenetreSoir,
    fenetreBientot,
    fenetreWeekEnd,
    toEpoch,
    toEpochInZone,
    heureLocale,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
