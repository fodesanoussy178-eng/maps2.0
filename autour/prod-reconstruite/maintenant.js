(function(root) {
  "use strict";
  const ETATS = Object.freeze({
    LOADING: "loading",
    READY: "ready",
    EMPTY: "empty",
    ERROR: "error"
  });
  const NATURES = Object.freeze({
    EVENEMENT: "event_now",
    SEANCE: "session_soon",
    ACTIVITE: "activity_now",
    OUVERT: "open_now"
  });
  const RANG = Object.freeze({
    [NATURES.EVENEMENT]: 0,
    [NATURES.SEANCE]: 1,
    [NATURES.ACTIVITE]: 2,
    [NATURES.OUVERT]: 3
  });
  const SEANCE_MIN_MS = 5 * 6e4;
  const SEANCE_MAX_MS = 75 * 6e4;
  const FAMILLES = Object.freeze({
    event: "sortir",
    concert: "sortir",
    spectacle: "sortir",
    popup: "sortir",
    rencontre: "sortir",
    studio: "sortir",
    cinema: "ecran",
    musee: "culture",
    biblio: "culture",
    mairie: "culture",
    resto: "manger",
    fastfood: "manger",
    food: "manger",
    marche: "manger",
    cafe: "boire",
    bar: "boire",
    sport: "bouger",
    terrain: "bouger",
    parc: "bouger",
    piscine: "bouger",
    velo: "bouger",
    collecte: "aide",
    alimentaire: "aide",
    asso: "aide",
    hebergement: "aide"
  });
  const familleDe = (item) => item && item.famille || FAMILLES[item && item.categorie || ""] || "autre";
  const ACTIVITES = Object.freeze([
    "cinema",
    "musee",
    "biblio",
    "parc",
    "terrain",
    "piscine",
    "sport",
    "spectacle",
    "concert",
    "coworking"
  ]);
  const COMMODITES = Object.freeze([
    "commerce",
    "friperie",
    "marche",
    "sante",
    "metro",
    "bus",
    "tram",
    "train",
    "velo",
    "recharge",
    "toilettes",
    "mairie",
    "ecole",
    "emploi"
  ]);
  const estCommodite = (categorie) => COMMODITES.indexOf(categorie) >= 0;
  function commoditeDemandee(categorie, ctx) {
    const demandees = ctx && ctx.categoriesDemandees || null;
    if (!demandees || !demandees.length) return false;
    return demandees.indexOf(categorie) >= 0;
  }
  const PLACES = 3;
  const RAYON_MAX_M = 3e3;
  const RAISONS = Object.freeze({
    PAS_UN_EVENEMENT: "pas_un_evenement",
    ANNULE: "annule",
    PAS_EN_COURS: "pas_en_cours",
    DATE_INCERTAINE: "date_incertaine",
    PAS_COMMENCE: "pas_commence",
    DEJA_FINI: "deja_fini",
    SANS_FIN: "sans_fin",
    FERME: "ferme",
    COMMODITE: "commodite",
    FERME_VERIFIE: "ferme_verifie",
    TROP_LOIN: "trop_loin",
    POSITION_INCONNUE: "position_inconnue",
    PAS_OUVERT: "pas_ouvert",
    HORAIRE_INCONNU: "horaire_inconnu",
    FERME_TROP_TOT: "ferme_trop_tot",
    SEANCE_TROP_LOIN: "seance_trop_loin",
    SEANCE_TROP_PROCHE: "seance_trop_proche",
    RETENU: "retenu"
  });
  const TERRE_M = 6371e3;
  function distanceM(aLat, aLng, bLat, bLng) {
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLng = (bLng - aLng) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * TERRE_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fiable(item, contexte) {
    const ctx = contexte || {};
    const t = Number(ctx.maintenant) || Date.now();
    if (!item || !item.estEvenement) return refus(RAISONS.PAS_UN_EVENEMENT);
    if (item.annule) return refus(RAISONS.ANNULE);
    if (item.dateIncertaine) return refus(RAISONS.DATE_INCERTAINE);
    if (!item.enCours) return refus(RAISONS.PAS_EN_COURS);
    const debut = horodatage(item.debutLe);
    const fin = horodatage(item.finLe);
    if (debut === null) return refus(RAISONS.DATE_INCERTAINE);
    if (fin === null) return refus(RAISONS.SANS_FIN);
    if (debut > t) return refus(RAISONS.PAS_COMMENCE);
    if (fin < t) return refus(RAISONS.DEJA_FINI);
    if (item.ferme === true) return refus(RAISONS.FERME);
    const d = distanceDe(item, ctx);
    if (d === null) return refus(RAISONS.POSITION_INCONNUE);
    if (!Number.isFinite(d)) return refus(RAISONS.TROP_LOIN);
    if (d > rayonDe(ctx)) return refus(RAISONS.TROP_LOIN);
    return { retenu: true, raison: RAISONS.RETENU, distance: d };
  }
  function refus(raison) {
    return { retenu: false, raison, distance: null };
  }
  function horodatage(valeur) {
    if (valeur == null || valeur === "") return null;
    const n = Number(valeur);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function disponible(item, contexte) {
    const ctx = contexte || {};
    const t = Number(ctx.maintenant) || Date.now();
    if (item && item.estEvenement) {
      const v = fiable(item, ctx);
      if (v.retenu) return retenu(NATURES.EVENEMENT, v.distance);
      if (v.raison !== RAISONS.PAS_COMMENCE && v.raison !== RAISONS.PAS_EN_COURS)
        return refusNature(v.raison);
      const debut = horodatage(item.debutLe);
      if (debut === null) return refusNature(RAISONS.DATE_INCERTAINE);
      if (horodatage(item.finLe) === null) return refusNature(RAISONS.SANS_FIN);
      const dans = debut - t;
      if (dans <= 0) return refusNature(RAISONS.DEJA_FINI);
      if (dans > SEANCE_MAX_MS) return refusNature(RAISONS.SEANCE_TROP_LOIN);
      if (dans < SEANCE_MIN_MS) return refusNature(RAISONS.SEANCE_TROP_PROCHE);
      const d2 = distanceDe(item, ctx);
      if (d2 === null) return refusNature(RAISONS.POSITION_INCONNUE);
      if (d2 > rayonDe(ctx)) return refusNature(RAISONS.TROP_LOIN);
      return retenu(NATURES.SEANCE, d2);
    }
    if (item.temporary_closed === true) return refusNature(RAISONS.FERME_VERIFIE);
    if (item.current_status === "closed" || item.current_status === "permanently_closed")
      return refusNature(RAISONS.FERME_VERIFIE);
    const ouvertVerifie = item.current_status === "open";
    if (item.ouvert !== true && !ouvertVerifie) {
      return refusNature(item.ouvert === false ? RAISONS.PAS_OUVERT : RAISONS.HORAIRE_INCONNU);
    }
    if (item.ouvertALArrivee === false) return refusNature(RAISONS.FERME_TROP_TOT);
    const d = distanceDe(item, ctx);
    if (d === null) return refusNature(RAISONS.POSITION_INCONNUE);
    if (d > rayonDe(ctx)) return refusNature(RAISONS.TROP_LOIN);
    const programmeEnCours = Array.isArray(item.programme_now) && item.programme_now.length > 0;
    if (estCommodite(item.categorie) && !commoditeDemandee(item.categorie, ctx) && !programmeEnCours)
      return refusNature(RAISONS.COMMODITE);
    const activite = programmeEnCours || ACTIVITES.indexOf(item.categorie) >= 0;
    return retenu(activite ? NATURES.ACTIVITE : NATURES.OUVERT, d);
  }
  const retenu = (nature, distance) => ({ retenu: true, nature, raison: RAISONS.RETENU, distance });
  const refusNature = (raison) => ({ retenu: false, nature: null, raison, distance: null });
  function rayonDe(ctx) {
    return Number(ctx.rayonMax) > 0 ? Number(ctx.rayonMax) : RAYON_MAX_M;
  }
  function distanceDe(item, ctx) {
    if (ctx.positionConnue === false) return null;
    const pos = ctx.position;
    if (!Array.isArray(pos) || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return Infinity;
    return distanceM(pos[0], pos[1], item.lat, item.lng);
  }
  function candidats(items, contexte) {
    const ctx = contexte || {};
    const out = [];
    for (const item of items || []) {
      const v = disponible(item, ctx);
      if (v.retenu) {
        out.push({
          item,
          nature: v.nature,
          distance: v.distance,
          famille: familleDe(item),
          rang: RANG[v.nature]
        });
      }
    }
    out.sort((a, b) => a.rang - b.rang || a.distance - b.distance || (horodatage(a.item.finLe) || Infinity) - (horodatage(b.item.finLe) || Infinity));
    return out;
  }
  function selection(items, contexte) {
    const ctx = contexte || {};
    const combien = Number(ctx.places) > 0 ? Number(ctx.places) : PLACES;
    const pool = candidats(items, ctx);
    const choisis = [];
    const famillesPrises = /* @__PURE__ */ new Set();
    for (const c of pool) {
      if (choisis.length >= combien) break;
      if (famillesPrises.has(c.famille)) continue;
      famillesPrises.add(c.famille);
      choisis.push(c);
    }
    for (const c of pool) {
      if (choisis.length >= combien) break;
      if (choisis.indexOf(c) >= 0) continue;
      choisis.push(c);
    }
    choisis.sort((a, b) => a.rang - b.rang || a.distance - b.distance);
    return choisis.map((c) => Object.assign({}, c.item, { nature: c.nature }));
  }
  function total(items, contexte) {
    return candidats(items, contexte).length;
  }
  function etat(contexte) {
    const ctx = contexte || {};
    const combien = Number(ctx.resultats) || 0;
    if (combien > 0) return ETATS.READY;
    if (ctx.positionEnCours) return ETATS.LOADING;
    if (ctx.positionRefusee || !ctx.positionConnue) return ETATS.ERROR;
    if (ctx.panne) return ETATS.ERROR;
    if (ctx.chargement) return ETATS.LOADING;
    return ETATS.EMPTY;
  }
  const TEXTES = Object.freeze({
    [ETATS.LOADING]: { titre: "Maintenant", ligne: "" },
    [ETATS.EMPTY]: {
      titre: "Maintenant",
      /* Le mot a changé avec le sens du bloc. Tant qu'il ne montrait que des
         événements, « rien en cours » était juste. Maintenant qu'il montre
         aussi les lieux ouverts, un bloc vide veut dire que même les portes
         sont closes — et c'est ce qu'il faut écrire. */
      ligne: "Rien d\u2019ouvert ni en cours dans cette zone \xE0 cette heure-ci.",
      sortie: "Voir plus loin"
    },
    [ETATS.ERROR]: {
      titre: "Maintenant",
      ligne: "Impossible de savoir ce qui se passe autour de toi.",
      sortie: "R\xE9essayer"
    },
    positionRefusee: {
      titre: "Maintenant",
      ligne: "Autour ne sait pas o\xF9 tu es.",
      sortie: "Choisir un point de d\xE9part"
    }
  });
  function textes(etatCourant, contexte) {
    const ctx = contexte || {};
    if (ctx.positionRefusee || etatCourant === ETATS.ERROR && !ctx.positionConnue)
      return TEXTES.positionRefusee;
    return TEXTES[etatCourant] || TEXTES[ETATS.EMPTY];
  }
  root.AutourMaintenant = Object.freeze({
    ETATS,
    PLACES,
    RAYON_MAX_M,
    RAISONS,
    TEXTES,
    NATURES,
    RANG,
    FAMILLES,
    ACTIVITES,
    COMMODITES,
    estCommodite,
    SEANCE_MIN_MS,
    SEANCE_MAX_MS,
    fiable,
    disponible,
    candidats,
    selection,
    total,
    etat,
    textes,
    distanceM,
    familleDe
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
