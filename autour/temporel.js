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

  /* Deux heures : au-delà, ce n'est plus « maintenant », c'est « ce soir ».
     C'est la fenêtre demandée, et elle vaut partout — aucune règle locale. */
  const FENETRE_IMMINENT_MS = 2 * 3600 * 1000;

  /* Au-delà de 36 h, une « période » n'est plus une séance : c'est une
     exposition, une saison, un musée. Sa disponibilité ne se lit plus dans la
     période mais dans les horaires du jour. */
  const SEUIL_PERIODE_LONGUE_MS = 36 * 3600 * 1000;

  /* Sans heure de fin, on ne sait pas quand ça se termine. Plutôt que
     d'inventer une durée, on borne l'affichage : passé ce délai, un événement
     commencé n'est plus annoncé comme en cours. C'est une règle d'affichage
     assumée, pas une donnée. */
  const DUREE_SUPPOSEE_MS = 3 * 3600 * 1000;

  const DEFAULT_TIMEZONE = "Europe/Paris";

  function toEpoch(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
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
    return {
      periodes,
      dateConfidence: confianceDate(item) || null,
      precision: precisionDate(item, periodes[0]),
      temporalStatus: item.temporalStatus || item.temporal_status || null,
      timeZone: item.timezone || item.timeZone || DEFAULT_TIMEZONE,
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
    const brutes = [];

    const listes = [item.occurrences, item.timings, item.periodes];
    listes.forEach((liste) => {
      if (!Array.isArray(liste)) return;
      liste.forEach((t) => {
        if (!t) return;
        const debut = toEpoch(premiereDate(t, ["start_at", "startAt", "start", "begin", "debut"]));
        const fin = toEpoch(premiereDate(t, ["end_at", "endAt", "end", "fin"]));
        if (debut != null || fin != null) brutes.push({ debut, fin });
      });
    });

    if (!brutes.length) {
      const debut = toEpoch(premiereDate(item, DEBUTS_STRUCTURES));
      const fin = toEpoch(premiereDate(item, FINS_STRUCTURES));
      if (debut != null || fin != null) brutes.push({ debut, fin });
    }

    return brutes
      .filter((p) => (p.debut != null || p.fin != null) &&
        (p.debut == null || p.fin == null || p.fin > p.debut))
      .sort((a, b) => (a.debut == null ? Infinity : a.debut) - (b.debut == null ? Infinity : b.debut));
  }

  function finEffective(periode) {
    if (!periode) return null;
    if (periode.fin != null) return periode.fin;
    if (periode.debut != null) return periode.debut + DUREE_SUPPOSEE_MS;
    return null;
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
      return p.debut != null && p.debut <= t && (fin == null || fin > t);
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
    const ouvre = dispo.opensAt ? Date.parse(dispo.opensAt) : NaN;
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
  function statutTemporel(item, now, options) {
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

  /* Les seuls statuts qui ont leur place dans « Maintenant ». Le ranking ne
     décide pas de ça : la proximité ou les goûts ne doivent jamais y faire
     entrer un événement de la semaine prochaine. */
  function estMaintenant(statut) {
    return statut === STATUTS.EN_COURS || statut === STATUTS.IMMINENT;
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

    switch (etat.statut) {
      case STATUTS.EN_COURS:
        return etat.periodeLongue && etat.dispo && etat.dispo.closesAtTime
          ? "En cours · jusqu’à " + etat.dispo.closesAtTime
          : "Maintenant";

      case STATUTS.IMMINENT: {
        const minutes = Math.max(1, Math.round(etat.dansMs / 60000));
        return "Commence dans " + minutes + " min";
      }

      case STATUTS.PLUS_TARD: {
        if (etat.debut == null)
          return etat.dispo && etat.dispo.opensAtTime ? "Ouvre à " + etat.dispo.opensAtTime : "Plus tard";
        const p = partsLocales(etat.debut, tz);
        return (p.heure >= 18 ? "Ce soir · " : "Aujourd’hui · ") + heureLocale(etat.debut, tz);
      }

      case STATUTS.A_VENIR: {
        const p = partsLocales(etat.debut, tz);
        const demain = new Date(t + 24 * 3600 * 1000).getTime();
        if (memeJour(etat.debut, demain, tz)) return "Demain · " + heureLocale(etat.debut, tz);
        const j = new Date(etat.debut);
        const jourSemaine = JOURS[Number(new Intl.DateTimeFormat("en-US",
          { timeZone: tz, weekday: "short" }).format(j) === "Sun" ? 0
          : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
              .indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(j)))];
        return jourSemaine + " " + p.jour + " " + MOIS[p.mois - 1] + " · " + heureLocale(etat.debut, tz);
      }

      case STATUTS.PASSE:
        return etat.annule ? "Annulé" : "Terminé";

      default:
        return "Date à vérifier";
    }
  }

  /* Libellé descriptif commun aux cartes et aux fiches. `libelleTemporel`
     reste utile pour les badges (« Maintenant », « Ce soir »), mais il ne doit
     pas être mélangé à une date détaillée : une vue pouvait afficher l'heure
     structurée pendant qu'une autre tombait sur « Date à vérifier ». */
  function libelleDate(item, now, options) {
    const t = now == null ? Date.now() : Number(now);
    const etat = (options && options.statut) || statutTemporel(item, t, options);
    if (!etat || etat.statut === STATUTS.INCONNU) return "Date à vérifier";
    if (etat.statut === STATUTS.PASSE && !(options && options.ignoreStatus))
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
    if (estMaintenant(etat.statut)) return "maintenant";
    if (etat.statut === STATUTS.PASSE) return null;

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
    STATUTS_CANONIQUES,
    FENETRE_IMMINENT_MS,
    SEUIL_PERIODE_LONGUE_MS,
    DUREE_SUPPOSEE_MS,
    DEFAULT_TIMEZONE,
    normaliserPeriodes,
    normaliserTemporalite,
    prochaineOccurrence,
    statutTemporel,
    estMaintenant,
    libelleTemporel,
    libelleDate,
    sectionTemporelle,
    partsLocales,
    fenetreJour,
    fenetreSoir,
    fenetreWeekEnd,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
