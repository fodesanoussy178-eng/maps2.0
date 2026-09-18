/* LE CYCLE D'UN ÉVÉNEMENT — deux horloges, et il faut les distinguer.

   UN ÉVÉNEMENT N'A PAS UNE DATE, IL EN A DEUX SORTES :

     · L'HORLOGE DE L'ÉVÉNEMENT — `start_at`, `end_at`. Elle dit quand ça se
       passe. C'est elle, et elle seule, qui décide de « Maintenant ».
     · L'HORLOGE DE SON INFORMATION — `announced_at`, `presale_at`,
       `tickets_open_at`, et les échéances déduites (J-3, jour J). Elle dit
       quand il y a quelque chose à SAVOIR. C'est elle qui décide de
       « Pour toi » et de « À venir ».

   Les confondre produit exactement deux fautes, et les deux étaient possibles
   avant ce module :

     · une billetterie qui ouvre ce matin faisait passer un concert de juin
       pour quelque chose qui se passe maintenant. Des billets disponibles ne
       sont pas un concert en cours ;
     · un concert de ce soir restait rangé « à venir » avec la même phrase
       tiède qu'il avait il y a trois mois, alors que c'est le seul moment où
       il fallait vraiment le dire.

   QUAND LES DEUX HORLOGES PARLENT, CELLE DE L'ÉVÉNEMENT L'EMPORTE. Un concert
   dans trois jours n'est plus une nouvelle de billetterie : c'est un concert
   dans trois jours. L'ordre de détermination ci-dessous n'est donc pas un
   détail d'implémentation, c'est la règle.

   CE MODULE N'AUTORISE RIEN À ENTRER DANS « MAINTENANT ». Aucune phase, aucune
   urgence, aucun montant de points ne peut y faire entrer quoi que ce soit :
   la porte reste `event_temporal_status = now`, tranchée en base et traduite
   par `temporel.js`. Ce module dit comment PRÉSENTER et CLASSER un événement,
   jamais s'il a le droit d'exister quelque part.

   UNE PHASE ABSENTE NE S'INVENTE JAMAIS. Pas de `tickets_open_at` publié, pas
   de phase billetterie — l'événement passe directement à « à venir ». C'est la
   même règle que « aucune heure de fin n'est inventée pour faire entrer un
   événement dans `now` », et elle a la même raison : une promesse fausse coûte
   un déplacement pour rien, ou une attente devant une billetterie qui n'ouvre
   pas.

   IL N'Y A QU'UN SEUL EXEMPLAIRE DE CHAQUE ÉVÉNEMENT. Une phase n'est pas une
   copie : c'est une lecture de la même ligne à un instant donné. Rien n'est
   dupliqué, rien n'est recréé à chaque transition. */
(function (root) {
  "use strict";

  const MINUTE = 60e3;
  const HEURE = 60 * MINUTE;
  const JOUR = 24 * HEURE;

  const PHASES = Object.freeze({
    ANNONCE: "annonce",
    PREVENTE: "prevente",
    BILLETTERIE_BIENTOT: "billetterie_bientot",
    BILLETTERIE_OUVERTE: "billetterie_ouverte",
    A_VENIR: "a_venir",
    APPROCHE: "approche",
    JOUR_J: "jour_j",
    EN_COURS: "en_cours",
    TERMINE: "termine",
  });

  /* L'ordre du cycle, tel qu'il se raconte. Il sert aux tests et à la
     documentation ; le code, lui, ne s'en sert jamais pour décider — décider
     par un rang ferait dépendre le produit de l'ordre d'un tableau. */
  const CYCLE = Object.freeze([
    PHASES.ANNONCE, PHASES.PREVENTE, PHASES.BILLETTERIE_BIENTOT,
    PHASES.BILLETTERIE_OUVERTE, PHASES.A_VENIR, PHASES.APPROCHE,
    PHASES.JOUR_J, PHASES.EN_COURS, PHASES.TERMINE,
  ]);

  /* Trois jours : le seuil où l'on cesse de « noter la date » pour commencer à
     s'organiser. C'est aussi ce que le cahier des charges demande. */
  const APPROCHE_MS = 3 * JOUR;

  /* Une billetterie qui vient d'ouvrir est une nouvelle pendant deux jours.
     Au-delà, elle est simplement « en vente » — ce n'est plus une information,
     c'est un état, et un état ne mérite pas de remonter tout seul. */
  const FENETRE_OUVERTURE_MS = 2 * JOUR;

  /* Une ouverture annoncée devient imminente à 48 h, et se dit « demain » dans
     les 36 dernières heures si c'est bien le lendemain civil. */
  const OUVERTURE_PROCHE_MS = 2 * JOUR;

  /* Une annonce est neuve pendant trois jours. La même valeur que
     `annonces-classement.js` emploie déjà pour sa pastille « nouveau » : deux
     seuils différents pour la même idée finiraient par se contredire à
     l'écran. */
  const ANNONCE_NEUVE_MS = 3 * JOUR;

  /* AU-DELÀ DE CETTE DISTANCE, ON NE DÉCIDE PLUS D'Y ALLER SUR UN COUP DE
     TÊTE. Le seuil ne dit pas « c'est impossible » — un TGV Lille-Paris est
     une heure — il dit « ça ne se décide pas dans les dix minutes ». Il sert à
     deux choses opposées et cohérentes : baisser l'urgence du jour J, parce
     qu'on ne part pas là-bas maintenant, et AUGMENTER celle de l'approche,
     parce que c'est justement à trois jours qu'il faut s'organiser. */
  const SEUIL_SPONTANE_M = 30e3;
  const SEUIL_LOINTAIN_M = 100e3;

  function nombre(valeur) {
    const n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  }

  function epoch(valeur, fuseau) {
    if (valeur == null || valeur === "") return null;
    const T = root.AutourTemps;
    if (T && typeof T.toEpochInZone === "function") {
      const n = T.toEpochInZone(valeur, fuseau || "Europe/Paris");
      return Number.isFinite(n) ? n : null;
    }
    const n = valeur instanceof Date ? valeur.getTime() : new Date(valeur).getTime();
    return Number.isFinite(n) ? n : null;
  }

  function fuseauDe(evenement) {
    const e = evenement || {};
    return e.timezone || e.timeZone || "Europe/Paris";
  }

  function premier(evenement, champs) {
    const e = evenement || {};
    for (let i = 0; i < champs.length; i += 1) {
      const v = e[champs[i]];
      if (v != null && v !== "") return v;
    }
    return null;
  }

  function debutDe(evenement) {
    return epoch(premier(evenement, ["startsAt", "start_at", "event_start_at", "eventStartAt", "debutLe"]),
      fuseauDe(evenement));
  }
  function finDe(evenement) {
    return epoch(premier(evenement, ["endsAt", "end_at", "event_end_at", "eventEndAt", "finLe"]),
      fuseauDe(evenement));
  }
  function annonceDe(evenement) {
    return epoch(premier(evenement, ["announced_at", "announcedAt"]), fuseauDe(evenement));
  }
  function preventeDe(evenement) {
    return epoch(premier(evenement, ["presale_at", "presaleAt"]), fuseauDe(evenement));
  }
  function billetterieDe(evenement) {
    return epoch(premier(evenement, ["tickets_open_at", "ticketsOpenAt"]), fuseauDe(evenement));
  }

  function annule(evenement) {
    const e = evenement || {};
    return e.cancelled === true || e.annule === true || e.status === "cancelled";
  }

  /* La date est-elle assez sûre pour qu'on ose en tirer une échéance ?
     « Du 10 au 15 août », sans heure, ne permet pas d'annoncer « dans 3 jours »
     avec un compte à rebours : on dirait une précision qu'on n'a pas. */
  function dateExploitable(evenement) {
    const confiance = String(premier(evenement, ["date_confidence", "dateConfidence"]) || "unknown");
    return confiance === "exact";
  }

  function memeJourLocal(a, b, fuseau) {
    const T = root.AutourTemps;
    if (!T || typeof T.partsLocales !== "function") {
      const x = new Date(a), y = new Date(b);
      return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
    }
    const p = T.partsLocales(a, fuseau), q = T.partsLocales(b, fuseau);
    return p.annee === q.annee && p.mois === q.mois && p.jour === q.jour;
  }

  /* Le lendemain civil, pas « dans 24 heures ». À 23 h, un événement de 8 h le
     lendemain est « demain » et non « dans 9 heures » — c'est ainsi qu'on en
     parle, et c'est ce qui rend la phrase juste après minuit. */
  function demainLocal(t, quand, fuseau) {
    return memeJourLocal(quand - JOUR, t, fuseau);
  }

  function joursRestants(t, debut, fuseau) {
    if (debut == null) return null;
    if (memeJourLocal(debut, t, fuseau)) return 0;
    if (demainLocal(t, debut, fuseau)) return 1;
    return Math.max(2, Math.round((debut - t) / JOUR));
  }

  /* ---- Les phases -------------------------------------------------------- */

  function jourJLibelle(debut, fuseau) {
    const T = root.AutourTemps;
    const p = T && typeof T.partsLocales === "function" ? T.partsLocales(debut, fuseau) : null;
    const heure = p ? p.heure : new Date(debut).getHours();
    if (heure >= 18) return "🎤 Ce soir";
    if (heure >= 12) return "🎤 Cet après-midi";
    return "🎤 Aujourd’hui";
  }

  function approcheLibelle(jours) {
    if (jours === 1) return "🔥 Demain";
    return "🔥 Dans " + jours + " jours";
  }

  /* L'urgence de l'INFORMATION, entre 0 et 100. Elle ne dit pas l'importance
     de l'événement — c'est `importance_level` qui la porte — mais à quel point
     il y a quelque chose à savoir MAINTENANT à son sujet. */
  const URGENCE = Object.freeze({
    [PHASES.EN_COURS]: 100,
    [PHASES.JOUR_J]: 90,
    [PHASES.BILLETTERIE_OUVERTE]: 72,
    [PHASES.BILLETTERIE_BIENTOT]: 55,
    [PHASES.PREVENTE]: 50,
    [PHASES.ANNONCE]: 40,
    [PHASES.A_VENIR]: 15,
    [PHASES.TERMINE]: 0,
  });

  /* L'APPROCHE PRESSE PLUS QU'UNE BILLETTERIE QUI OUVRE, et l'échelle doit le
     dire. Une billetterie reste ouverte des semaines ; trois jours avant un
     concert, c'est le dernier moment où l'on peut encore s'organiser — trouver
     un train, prévenir quelqu'un, décaler une soirée. Une première échelle
     mettait J-3 à 60 contre 72 pour la billetterie : à trois jours du concert,
     l'écran aurait continué de parler de billets. */
  function urgenceApproche(jours) {
    return jours <= 1 ? 86 : jours === 2 ? 80 : 74;
  }

  function resultat(phase, options) {
    const o = options || {};
    return {
      phase,
      libelle: o.libelle || null,
      urgence: o.urgence == null ? (URGENCE[phase] || 0) : o.urgence,
      /* Jusqu'à quand cette lecture reste vraie. C'est ce qui rend une phase
         cachable sans risque de vieillir à l'écran : passé cet instant, il
         faut redemander. `null` veut dire « rien de prévu ne la changera ». */
      expireLe: o.expireLe == null ? null : o.expireLe,
      joursRestants: o.joursRestants == null ? null : o.joursRestants,
      debut: o.debut == null ? null : o.debut,
      fin: o.fin == null ? null : o.fin,
      annule: !!o.annule,
      /* Cette phase parle-t-elle de l'événement, ou de son information ?
         C'est la distinction qui empêche « billetterie ouverte » de se lire
         comme « ça se passe maintenant ». */
      horloge: o.horloge || "evenement",
    };
  }

  /* LA FONCTION QUI TRANCHE. Pure : mêmes entrées, même sortie, aucun état. */
  function phase(evenement, maintenant) {
    const e = evenement || {};
    const t = Number.isFinite(Number(maintenant)) ? Number(maintenant) : Date.now();
    const fuseau = fuseauDe(e);
    const debut = debutDe(e);
    const fin = finDe(e);

    if (annule(e)) return resultat(PHASES.TERMINE, {libelle: "Annulé", urgence: 0, annule: true, debut, fin});
    if (debut == null) return null;                 // sans date, pas de cycle
    if (fin != null && fin <= t)
      return resultat(PHASES.TERMINE, {libelle: "Terminé", debut, fin});

    /* ---- L'HORLOGE DE L'ÉVÉNEMENT D'ABORD --------------------------------
       Elle l'emporte sur celle de l'information. Un concert qui commence dans
       une heure n'est plus une nouvelle de billetterie. */

    if (debut <= t && fin != null && fin > t)
      return resultat(PHASES.EN_COURS, {libelle: "⚡ En cours", expireLe: fin, debut, fin, joursRestants: 0});

    /* Commencé sans fin connue : la couche canonique refuse de conclure, et ce
       module aussi. On ne dit ni « en cours » ni « terminé ». */
    if (debut <= t && fin == null) return resultat(PHASES.EN_COURS,
      {libelle: "⚡ En cours", urgence: 60, expireLe: null, debut, fin, horloge: "evenement"});

    const jours = dateExploitable(e) ? joursRestants(t, debut, fuseau) : null;

    if (jours === 0) return resultat(PHASES.JOUR_J,
      {libelle: jourJLibelle(debut, fuseau), expireLe: debut, debut, fin, joursRestants: 0});

    if (jours != null && jours <= APPROCHE_MS / JOUR) return resultat(PHASES.APPROCHE,
      {libelle: approcheLibelle(jours), urgence: urgenceApproche(jours),
       /* La phase change au prochain minuit local : c'est ce qui fait passer
          « dans 3 jours » à « dans 2 jours » sans qu'on ait à y penser. */
       expireLe: prochainMinuit(t, fuseau), debut, fin, joursRestants: jours});

    /* ---- L'HORLOGE DE L'INFORMATION -------------------------------------- */

    const billetterie = billetterieDe(e);
    if (billetterie != null) {
      if (t >= billetterie && t < billetterie + FENETRE_OUVERTURE_MS)
        return resultat(PHASES.BILLETTERIE_OUVERTE,
          {libelle: "🎟️ Billetterie ouverte", expireLe: billetterie + FENETRE_OUVERTURE_MS,
           debut, fin, joursRestants: jours, horloge: "information"});
      if (t < billetterie && billetterie - t <= OUVERTURE_PROCHE_MS)
        return resultat(PHASES.BILLETTERIE_BIENTOT, {
          libelle: demainLocal(t, billetterie, fuseau)
            ? "🎟️ Billetterie demain"
            : "🎟️ Billetterie " + dansCombien(billetterie - t),
          urgence: demainLocal(t, billetterie, fuseau) ? 65 : 55,
          expireLe: billetterie, debut, fin, joursRestants: jours, horloge: "information"});
    }

    const prevente = preventeDe(e);
    if (prevente != null) {
      if (t >= prevente && t < prevente + FENETRE_OUVERTURE_MS)
        return resultat(PHASES.PREVENTE, {libelle: "🎟️ Prévente ouverte",
          urgence: 58, expireLe: prevente + FENETRE_OUVERTURE_MS,
          debut, fin, joursRestants: jours, horloge: "information"});
      if (t < prevente && prevente - t <= OUVERTURE_PROCHE_MS)
        return resultat(PHASES.PREVENTE, {
          libelle: demainLocal(t, prevente, fuseau)
            ? "🎟️ Prévente demain"
            : "🎟️ Prévente " + dansCombien(prevente - t),
          expireLe: prevente, debut, fin, joursRestants: jours, horloge: "information"});
    }

    const annonce = annonceDe(e);
    if (annonce != null && t >= annonce && t - annonce <= ANNONCE_NEUVE_MS)
      return resultat(PHASES.ANNONCE, {libelle: "🆕 Nouvelle annonce",
        expireLe: annonce + ANNONCE_NEUVE_MS, debut, fin, joursRestants: jours,
        horloge: "information"});

    /* Rien de neuf à dire : l'événement existe, il est devant nous, et c'est
       tout. C'est le cas le plus fréquent, et il ne mérite aucune emphase. */
    return resultat(PHASES.A_VENIR, {
      libelle: null,
      urgence: jours != null && jours <= 14 ? 25 : jours != null && jours <= 60 ? 15 : 8,
      expireLe: jours != null ? prochainMinuit(t, fuseau) : null,
      debut, fin, joursRestants: jours});
  }

  function dansCombien(ms) {
    const heures = Math.round(ms / HEURE);
    if (heures <= 1) return "dans 1 h";
    if (heures < 24) return "dans " + heures + " h";
    return "dans " + Math.round(ms / JOUR) + " jours";
  }

  function prochainMinuit(t, fuseau) {
    const T = root.AutourTemps;
    if (T && typeof T.fenetreJour === "function") {
      const jour = T.fenetreJour(t, fuseau);
      if (jour && Number.isFinite(jour.fin)) return jour.fin;
    }
    const d = new Date(t);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  /* ---- La distance change ce qu'une phase veut dire ---------------------- */

  /* L'URGENCE AJUSTÉE PAR LA FAISABILITÉ DU DÉPLACEMENT.

     Le jour J d'un concert à 220 km n'est pas le jour J du concert d'en bas :
     on ne part pas à Paris sur un coup de tête entre deux tâches. L'urgence
     baisse — l'information reste, l'injonction disparaît.

     L'APPROCHE, ELLE, FAIT L'INVERSE. C'est précisément à trois jours et à
     220 km qu'il faut s'organiser : train, hébergement, quelqu'un à prévenir.
     Un événement lointain à J-3 est donc PLUS urgent qu'un événement d'à côté
     à J-3, pas moins.

     Les deux règles ne se contredisent pas : elles disent la même chose, qu'un
     déplacement lointain se prépare et ne s'improvise pas. */
  function urgenceAjustee(etatPhase, distanceMetres) {
    if (!etatPhase) return 0;
    const d = nombre(distanceMetres);
    const base = etatPhase.urgence;
    if (d == null) return base;
    if (etatPhase.phase === PHASES.JOUR_J || etatPhase.phase === PHASES.EN_COURS) {
      if (d > SEUIL_LOINTAIN_M) return Math.round(base * 0.8);
      if (d > SEUIL_SPONTANE_M) return Math.round(base * 0.92);
      return base;
    }
    if (etatPhase.phase === PHASES.APPROCHE && d > SEUIL_LOINTAIN_M)
      return Math.min(100, base + 8);
    return base;
  }

  /* CET ÉVÉNEMENT QUITTE-T-IL « POUR TOI » POUR « MAINTENANT » ?

     Deux conditions, et la seconde manquait cruellement. L'horloge de
     l'événement doit dire `now` ou `soon` — c'est `temporel.js` qui tranche,
     jamais ce module — ET il faut pouvoir y aller.

     Sans la seconde, un concert parisien imminent disparaissait de « Pour toi »
     pour entrer dans un « Maintenant » qui le rejetterait aussitôt : à 220 km,
     il ne passe aucun filtre de proximité. L'événement s'évaporait entre deux
     espaces, exactement à l'heure où il comptait le plus.

     Hors de portée, il reste donc où il était, avec le bon mot — « ce soir ».
     On ne peut pas y aller, mais on peut vouloir le savoir. */
  function basculeVersMaintenant(statutTemporel, distanceMetres, options) {
    const o = options || {};
    const statut = String(statutTemporel || "");
    if (statut !== "now" && statut !== "soon") return false;
    const d = nombre(distanceMetres);
    if (d == null) return true;                 // distance inconnue : on ne bloque pas
    const portee = nombre(o.porteeM);
    return d <= (portee == null ? SEUIL_SPONTANE_M : portee);
  }

  /* ---- La lecture unique, mémorisée -------------------------------------- */

  /* UNE SEULE SOURCE, ET UN SEUL CALCUL PAR OBJET.

     La phase est demandée par le classement, par la carte, par la feuille et
     par « À venir ». La recalculer partout, c'est payer quatre fois le même
     travail sur cent cinquante objets — et risquer quatre réponses différentes
     si deux appelants ne passent pas exactement le même instant.

     Le cache est porté par l'objet, non énumérable (il ne doit apparaître ni
     dans un JSON, ni dans une copie), et il porte l'instant de calcul. Il est
     jeté dès que la phase a expiré : c'est `expireLe` qui le dit, pas une
     durée arbitraire. */
  function phaseDe(evenement, maintenant) {
    if (!evenement || typeof evenement !== "object") return null;
    const t = Number.isFinite(Number(maintenant)) ? Number(maintenant) : Date.now();
    const cache = evenement.__cycle;
    if (cache && cache.calculeeA <= t && (cache.valeur == null || cache.valeur.expireLe == null || cache.valeur.expireLe > t))
      return cache.valeur;
    const valeur = phase(evenement, t);
    try {
      Object.defineProperty(evenement, "__cycle",
        {value: {calculeeA: t, valeur}, enumerable: false, configurable: true, writable: true});
    } catch (e) { /* objet gelé : on rend la valeur sans la retenir */ }
    return valeur;
  }

  root.AutourCycle = Object.freeze({
    PHASES, CYCLE, URGENCE,
    APPROCHE_MS, FENETRE_OUVERTURE_MS, ANNONCE_NEUVE_MS,
    SEUIL_SPONTANE_M, SEUIL_LOINTAIN_M,
    phase, phaseDe, urgenceAjustee, basculeVersMaintenant,
    debutDe, finDe, annonceDe, preventeDe, billetterieDe,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
