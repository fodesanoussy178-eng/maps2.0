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

       · `now`, `past`, `unknown_date` sont des verdicts fermes → repris tels
         quels ;
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
        const debut = toEpoch(t.start != null ? t.start : (t.begin != null ? t.begin : t.debut));
        const fin = toEpoch(t.end != null ? t.end : t.fin);
        if (debut != null || fin != null) brutes.push({ debut, fin });
      });
    });

    if (!brutes.length) {
      const debut = toEpoch(item.startsAt != null ? item.startsAt
        : (item.debutLe != null ? item.debutLe : item.debut_le));
      const fin = toEpoch(item.endsAt != null ? item.endsAt
        : (item.finLe != null ? item.finLe : item.fin_le));
      if (debut != null || fin != null) brutes.push({ debut, fin });
    }

    return brutes
      .filter((p) => p.debut != null || p.fin != null)
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
    if (source.temporalStatus) {
      const ferme = STATUTS_CANONIQUES[source.temporalStatus];
      const periodes = normaliserPeriodes(source);
      const occurrence = prochaineOccurrence(periodes, t);
      const commun = {
        timeZone,
        debut: occurrence ? occurrence.debut : null,
        fin: occurrence ? finEffective(occurrence) : null,
        occurrence, occurrences: periodes.length,
        canonique: source.temporalStatus,
      };
      if (source.annule) commun.annule = true;
      if (ferme) return Object.assign({ statut: ferme }, commun);

      // `soon` / `upcoming` : pas maintenant. Reste à savoir où le ranger,
      // ce que seule la date locale peut dire.
      if (commun.debut == null) return Object.assign({ statut: STATUTS.INCONNU }, commun);
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
    if (source.annule) return { statut: STATUTS.PASSE, timeZone, annule: true };

    const periodes = normaliserPeriodes(source);
    if (!periodes.length) return { statut: STATUTS.INCONNU, timeZone };

    const occurrence = prochaineOccurrence(periodes, t);
    if (!occurrence || occurrence.debut == null) return { statut: STATUTS.INCONNU, timeZone };

    const debut = occurrence.debut;
    const fin = finEffective(occurrence);
    const commun = { timeZone, debut, fin, occurrence, occurrences: periodes.length };

    if (fin != null && fin <= t) return Object.assign({ statut: STATUTS.PASSE }, commun);

    if (debut <= t) {
      const etendue = (fin == null ? 0 : fin - debut);
      if (etendue > SEUIL_PERIODE_LONGUE_MS) {
        /* Exposition, saison, musée : la période ne dit pas si on peut y aller
           à cet instant. Ce sont les horaires du jour qui tranchent, et sans
           eux on ne prétend pas que c'est ouvert. */
        const dispo = typeof o.disponibilite === "function" ? o.disponibilite(source, t) : null;
        if (!dispo || dispo.status === "unknown")
          return Object.assign({ statut: STATUTS.INCONNU, periodeLongue: true }, commun);
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

    if (etat.statut === STATUTS.PLUS_TARD) return p.heure >= 18 ? "ce_soir" : "aujourdhui";

    // ce week-end : le samedi et le dimanche qui viennent
    const jour = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
      .format(new Date(etat.debut));
    const dansUneSemaine = etat.debut - t < 7 * 24 * 3600 * 1000;
    if (dansUneSemaine && (jour === "Sat" || jour === "Sun")) return "ce_week_end";
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
    sectionTemporelle,
    partsLocales,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
