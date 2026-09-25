/* ===========================================================================
   DE LA LIGNE DE BASE À L'ITEM QUE LES MOTEURS ATTENDENT

   `maintenant.js` refuse tout ce qu'il ne reconnaît pas, et il a raison :
   `qualiteProposition` exige une identité canonique, une catégorie qui
   concorde, et un verdict d'ouverture HORODATÉ pour un lieu. Un item bricolé
   passe donc les contrôles… en étant refusé, silencieusement, pour « identité
   canonique invalide ». C'est le piège qu'on ne voit pas : le bloc reste vide
   et rien n'a l'air cassé.

   Ce fichier est donc la traduction — et UNIQUEMENT la traduction. Il fait
   côté serveur ce que `versItemMaintenant(l, t)` fait dans `app.js`, avec les
   mêmes autorités :

     · `entites-canoniques.js` pour l'identité (`CanonicalEvent`/`CanonicalPlace`) ;
     · `temporel.js` pour le verdict temporel (jamais recalculé ici) ;
     · `availability.js` pour l'ouverture d'un lieu, y compris « à l'arrivée » ;
     · `core.js` pour la taxonomie.

   Aucune règle d'éligibilité, de distance ou de classement n'est écrite ici :
   elles appartiennent à `maintenant.js`, qui les appliquera ensuite.
   ======================================================================== */

/* Dix minutes nominales, comme `APPROCHE_NOMINALE_MS` dans `app.js` : la marge
   par type de lieu fait le vrai travail, et une valeur nominale rend le
   résultat mémorisable. */
const APPROCHE_NOMINALE_MS = 10 * 60000;

function nombre(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

/* ---- ÉVÉNEMENTS ---------------------------------------------------------
   Une ligne d'`evenements_locaux` porte déjà le verdict de la base
   (`temporal_status`, `date_confidence`). On le transmet ; `temporel.js` le
   traduit, et `maintenant.js` revérifie les bornes. */
export function itemEvenement(ligne, t, moteurs) {
  const { ENTITES, TEMPS, CORE } = moteurs;
  const tz = ligne.timezone || "Europe/Paris";
  const canonique = ENTITES.normaliserEvenement(Object.assign({}, ligne, {
    title: ligne.title, event_source: ligne.event_source || ligne.primary_source,
    event_source_url: ligne.event_source_url || ligne.source_url,
  }));
  const epoch = (valeur) => {
    if (valeur == null || valeur === "") return null;
    return nombre(TEMPS.toEpochInZone(valeur, tz));
  };
  const temporal = TEMPS.statutTemporel(Object.assign({}, ligne, {
    timezone: tz, temporalStatus: ligne.temporal_status, dateConfidence: ligne.date_confidence,
  }), t) || {};
  const statut = temporal.status || temporal.statut || null;
  const debutLe = temporal.debut != null ? temporal.debut : epoch(ligne.start_at);
  const finLe = temporal.finReelle != null ? temporal.finReelle : epoch(ligne.end_at);
  const categorie = (canonique && (canonique.category || canonique.cat)) || ligne.category || "event";
  const item = {
    id: "evt" + ligne.id, dbId: ligne.id,
    estEvenement: true, annule: !!ligne.cancelled,
    enCours: TEMPS.estMaintenant(statut),
    status: statut, temporalStatus: statut, temporal,
    dateIncertaine: statut === "unknown",
    dateConfidence: ligne.date_confidence, date_confidence: ligne.date_confidence,
    start_at: ligne.start_at, end_at: ligne.end_at, timezone: tz,
    debutLe, finLe, lat: nombre(ligne.lat), lng: nombre(ligne.lng),
    ferme: false,
    titre: canonique && canonique.title || ligne.title,
    title: canonique && canonique.title || ligne.title,
    categorie, category: categorie, canonicalCategory: categorie,
    entity_type: "event", canonical_id: String(canonique && canonique.id != null ? canonique.id : ligne.id),
    canonical: canonique,
    tempsValide: debutLe !== null && finLe !== null,
    ouvert: null, ouvertALArrivee: null,
    current_status: null, temporary_closed: null, programme_now: null,
    /* Ce que la projection publique lira ensuite : on garde la ligne d'origine
       à côté de l'item, jamais mélangée dedans. */
    ligne,
  };
  /* `toCommonItem` pose la taxonomie canonique et les alias de champs que les
     autres moteurs (diversité, pertinence) lisent. Il ne doit pas écraser la
     catégorie que l'identité canonique a fixée. */
  const commun = CORE.toCommonItem(item, { source: ligne.event_source || ligne.primary_source || "autour" });
  return Object.assign(commun, {
    categorie, category: categorie, canonicalCategory: categorie,
    canonical: canonique, canonical_id: item.canonical_id, entity_type: "event",
    estEvenement: true, tempsValide: item.tempsValide, debutLe, finLe,
    enCours: item.enCours, temporalStatus: statut, dateIncertaine: item.dateIncertaine,
    ligne,
  });
}

/* ---- LIEUX -------------------------------------------------------------
   `lieux_explorer` rend un état d'horaires (`etat_horaire`, `ouvre_a`,
   `ferme_a`) et la grille brute (`opening_hours`). C'est `availability.js` qui
   tranche — lui seul distingue « fermé » de « horaires inconnus ». */
export function itemLieu(ligne, t, moteurs) {
  const { ENTITES, AVAILABILITY, CORE } = moteurs;
  const brut = {
    id: ligne.id, name: ligne.name, title: ligne.name,
    lat: nombre(ligne.lat), lng: nombre(ligne.lng),
    address: ligne.address, commune: ligne.commune || ligne.city,
    category: ligne.category || ligne.family, cat: ligne.category || ligne.family,
    family: ligne.family,
    openingHours: ligne.opening_hours || null, opening_hours: ligne.opening_hours || null,
    officialUrl: ligne.official_url || null,
    image_url: ligne.image_url || null, image_type: ligne.image_type || null,
    image_author: ligne.image_author || null, image_license: ligne.image_license || null,
    description: ligne.description || "",
    permanentlyClosed: ligne.status === "permanently_closed" || null,
    temporarily_closed: ligne.temporarily_closed === true ? true : null,
    timezone: ligne.opening_hours_tz || "Europe/Paris",
    updated_at: ligne.updated_at || ligne.last_seen_at || null,
  };
  const canonique = ENTITES.normaliserLieu(brut);
  const dispo = AVAILABILITY.getPlaceAvailability(brut, t, t + APPROCHE_NOMINALE_MS) || {};
  const categorie = (canonique && (canonique.category || canonique.cat)) || brut.category || "";
  const item = {
    id: "lieu" + ligne.id, dbId: ligne.id,
    estEvenement: false, annule: false,
    lat: brut.lat, lng: brut.lng,
    titre: canonique && canonique.name || ligne.name,
    title: canonique && canonique.name || ligne.name,
    categorie, category: categorie, canonicalCategory: categorie,
    entity_type: "place",
    canonical_id: String(canonique && canonique.id != null ? canonique.id : ligne.id),
    canonical: canonique,
    openingHours: brut.openingHours, opening_hours: brut.opening_hours,
    timezone: brut.timezone,
    tempsValide: dispo.status === "open" || dispo.status === "closing_soon",
    ouvert: dispo.status === "open" ? true : dispo.status === "unknown" ? null : false,
    ouvertALArrivee: dispo.isOpenAtArrival,
    ferme: dispo.status === "permanently_closed",
    current_status: null,
    temporary_closed: ligne.temporarily_closed === true ? true : null,
    programme_now: null,
    disponibilite: dispo,
    ligne,
  };
  const commun = CORE.toCommonItem(item, { source: "places" });
  return Object.assign(commun, {
    categorie, category: categorie, canonicalCategory: categorie,
    canonical: canonique, canonical_id: item.canonical_id, entity_type: "place",
    estEvenement: false, tempsValide: item.tempsValide, ouvert: item.ouvert,
    ouvertALArrivee: item.ouvertALArrivee, ferme: item.ferme,
    disponibilite: dispo, ligne,
  });
}

export const NOMINAL = Object.freeze({ APPROCHE_MS: APPROCHE_NOMINALE_MS });
