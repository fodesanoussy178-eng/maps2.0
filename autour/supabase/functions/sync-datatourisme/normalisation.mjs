/* ===========================================================================
   Normalisation DATAtourisme → événement canonique Autour

   Ce module est PUR : aucun accès réseau, aucun accès base. C'est ce qui le
   rend testable, et c'est là que vivent les décisions difficiles — comment
   lire une date, quand refuser de conclure, quand deux annonces désignent le
   même événement.

   LA RÈGLE QUI COMMANDE TOUT LE RESTE

   On n'invente pas d'heure de fin. DATAtourisme publie très souvent une
   `startDate` et une `endDate` en JOURNÉES (« 2026-08-15 »), sans heure. La
   tentation est d'écrire 00:00 → 23:59 et de déclarer l'événement « en
   cours » toute la journée : c'est ainsi qu'un festival de trois jours
   devient « Maintenant » à quatre heures du matin, et que quelqu'un se
   déplace pour rien.

   On enregistre donc ce qu'on sait — la journée — et on le DIT :
   `date_confidence = "day"`. Le statut temporel est calculé en base, et
   `day` n'y ouvre jamais la porte de `now`. L'information n'est pas perdue,
   elle est seulement qualifiée.

   AUCUNE VILLE N'EST NOMMÉE ICI. Une zone arrive en paramètre, avec son
   rectangle ; le même code vaut pour Lille, Toulouse ou une commune qui
   n'existe pas encore dans la table.
   ======================================================================== */

import {normaliserAnnonce, fusionnerAnnonceFields} from "../shared/annonces.mjs";

/* ---- Lecture défensive du JSON-LD ---------------------------------------
   DATAtourisme rend du JSON-LD : une même information s'y présente comme
   chaîne, tableau, objet multilingue ou objet `@value`. On aplatit sans
   jamais supposer une forme. */

export function valeur(brut, profondeur = 0) {
  if (profondeur > 6 || brut == null) return "";
  if (typeof brut === "string" || typeof brut === "number") return String(brut);
  if (Array.isArray(brut)) {
    for (const item of brut) {
      const trouve = valeur(item, profondeur + 1);
      if (trouve) return trouve;
    }
    return "";
  }
  if (typeof brut !== "object") return "";
  for (const cle of ["fr", "@value", "value", "label", "name", "text", "content"]) {
    if (brut[cle] != null) {
      const trouve = valeur(brut[cle], profondeur + 1);
      if (trouve) return trouve;
    }
  }
  for (const candidat of Object.values(brut)) {
    const trouve = valeur(candidat, profondeur + 1);
    if (trouve) return trouve;
  }
  return "";
}

export function texte(brut) {
  return valeur(brut).replace(/\s+/g, " ").trim();
}

export function liste(brut) {
  return Array.isArray(brut) ? brut : (brut == null ? [] : [brut]);
}

export function lire(objet, cles) {
  for (const cle of cles) {
    if (objet && objet[cle] != null) return objet[cle];
  }
  return null;
}

export function nombre(brut, maximum) {
  if (brut == null || brut === "") return null;
  const n = Number(valeur(brut));
  return Number.isFinite(n) && Math.abs(n) <= maximum ? n : null;
}

/* ---- Les dates, et ce qu'on accepte d'en dire ---------------------------

   Trois formes, trois confiances :
     · « 2026-08-15T20:30:00+02:00 » → horodatage complet     → exact
     · « 2026-08-15 » (+ éventuellement une heure séparée)    → day
     · tout le reste                                          → rien

   `analyserDate` ne rend jamais une date « à peu près » : soit elle sait,
   soit elle rend null et l'appelant en tirera `unknown`. */
export function analyserDate(brut) {
  const s = texte(brut);
  if (!s) return null;

  // horodatage complet : une heure y figure explicitement
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const t = Date.parse(s.replace(" ", "T"));
    if (!Number.isFinite(t)) return null;
    return { iso: new Date(t).toISOString(), precision: "exact", jour: s.slice(0, 10) };
  }

  // journée seule
  const jour = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (jour) {
    const t = Date.parse(s + "T00:00:00Z");
    if (!Number.isFinite(t)) return null;
    return { iso: new Date(t).toISOString(), precision: "day", jour: s };
  }

  return null;
}

/* Une heure isolée, telle que DATAtourisme la publie parfois à côté de la
   date (`startTime` / `endTime`). Elle ne vaut que collée à une journée. */
export function analyserHeure(brut) {
  const s = texte(brut);
  const m = s.match(/(?:^|T)(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

/* Recompose un instant à partir d'une journée et d'une heure locale, dans le
   fuseau de la zone. Sans bibliothèque de fuseaux : on demande à Intl où
   tombe ce moment-là, puis on corrige du décalage constaté. Deux passes
   suffisent, y compris autour des changements d'heure. */
export function instantLocal(jour, heure, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(jour || ""))) return null;
  const hhmm = heure || "00:00";
  let t = Date.parse(jour + "T" + hhmm + ":00Z");
  if (!Number.isFinite(t)) return null;
  for (let passe = 0; passe < 2; passe += 1) {
    const decalage = decalageMinutes(t, timeZone);
    if (decalage == null) return new Date(t).toISOString();
    const corrige = Date.parse(jour + "T" + hhmm + ":00Z") - decalage * 60000;
    if (corrige === t) break;
    t = corrige;
  }
  return new Date(t).toISOString();
}

function decalageMinutes(epoch, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Paris", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = {};
    fmt.formatToParts(new Date(epoch)).forEach((part) => { p[part.type] = part.value; });
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour === "24" ? "0" : p.hour), Number(p.minute), Number(p.second));
    return Math.round((local - epoch) / 60000);
  } catch { return null; }
}

/* ---- La période d'un événement -----------------------------------------

   On lit TOUTES les périodes publiées, on écarte celles qui sont terminées,
   et on garde celle qui compte à cet instant : en cours, sinon la prochaine.
   Juger un festival annuel sur sa première édition — ou sur l'étendue de
   toutes ses éditions — était l'erreur d'origine.

   La confiance de la période est celle de son maillon le plus faible : une
   fin en journée avec un début horodaté reste `day`. */
export function analyserPeriode(poi, options = {}) {
  const maintenant = options.maintenant == null ? Date.now() : Number(options.maintenant);
  const timeZone = options.timeZone || "Europe/Paris";

  const brutes = liste(lire(poi, ["takesPlaceAt", "eventSchedule", "schema:eventSchedule"]));
  const periodes = [];

  for (const item of brutes) {
    if (!item || typeof item !== "object") continue;
    const debut = analyserDate(lire(item, ["startDate", "schema:startDate"]));
    const fin = analyserDate(lire(item, ["endDate", "schema:endDate"]));
    if (!debut) continue;

    const heureDebut = analyserHeure(lire(item, ["startTime", "schema:startTime"]));
    const heureFin = analyserHeure(lire(item, ["endTime", "schema:endTime"]));

    // une journée + une heure publiée à côté redevient un horodatage réel
    const debutIso = debut.precision === "day" && heureDebut
      ? instantLocal(debut.jour, heureDebut, timeZone) : debut.iso;
    const precisionDebut = debut.precision === "day" && heureDebut ? "exact" : debut.precision;

    let finIso = null, precisionFin = null;
    if (fin) {
      finIso = fin.precision === "day" && heureFin
        ? instantLocal(fin.jour, heureFin, timeZone)
        : (fin.precision === "day"
            // fin de journée : c'est bien la fin du jour publié, mais on ne
            // prétend pas connaître l'heure — la confiance reste « day »
            ? instantLocal(fin.jour, "23:59", timeZone)
            : fin.iso);
      precisionFin = fin.precision === "day" && heureFin ? "exact" : fin.precision;
    }

    periodes.push({
      start_at: debutIso,
      end_at: finIso,
      // le maillon faible commande, et une fin absente interdit `exact`
      confidence: !finIso ? "day"
        : (precisionDebut === "exact" && precisionFin === "exact" ? "exact" : "day"),
    });
  }

  if (!periodes.length) return { start_at: null, end_at: null, confidence: "unknown" };

  periodes.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const enCours = periodes.find((p) =>
    Date.parse(p.start_at) <= maintenant &&
    (p.end_at == null || Date.parse(p.end_at) >= maintenant));
  if (enCours) return enCours;
  const suivante = periodes.find((p) => Date.parse(p.start_at) > maintenant);
  if (suivante) return suivante;
  return periodes[periodes.length - 1];
}

/* ---- Coordonnées et adresse -------------------------------------------- */

export function analyserPosition(poi) {
  const lieu = liste(lire(poi, ["isLocatedAt", "location", "locatedAt"]))
    .find((item) => item && typeof item === "object") || {};
  const geo = liste(lire(lieu, ["geo", "schema:geo"]) || lire(poi, ["geo", "geometry"]))
    .find((item) => item && typeof item === "object") || {};

  const lat = nombre(lire(geo, ["latitude", "lat", "schema:latitude"]), 90);
  const lng = nombre(lire(geo, ["longitude", "lng", "lon", "schema:longitude"]), 180);
  if (lat != null && lng != null) return { lat, lng, lieu };

  const coords = lire(geo, ["coordinates", "geojson"]);
  const tableau = Array.isArray(coords) ? coords
    : (coords && Array.isArray(coords.coordinates) ? coords.coordinates : null);
  if (!tableau || tableau.length < 2) return null;
  const x = nombre(tableau[0], 180), y = nombre(tableau[1], 90);
  return x == null || y == null ? null : { lat: y, lng: x, lieu };
}

export function analyserAdresse(lieu) {
  const brute = liste(lire(lieu, ["address", "schema:address"]))
    .find((item) => item && typeof item === "object") || {};
  const rue = texte(lire(brute, ["streetAddress", "schema:streetAddress", "addressLine"]));
  const cp = texte(lire(brute, ["postalCode", "schema:postalCode"]));
  const ville = texte(lire(brute, ["addressLocality", "schema:addressLocality", "city"]));
  const insee = texte(lire(brute, ["insee", "inseeCode", "schema:inseeCode"]));
  return {
    address: [rue, cp, ville].filter(Boolean).join(", ") || null,
    city: ville || null,
    insee_code: /^\d{5}$/.test(insee) ? insee : null,
  };
}

/* ---- Catégorie ---------------------------------------------------------
   Volontairement grossière et alignée sur les catégories que l'interface
   connaît déjà. Une catégorie fausse est moins grave qu'une date fausse,
   mais elle ne doit pas se déguiser en information sûre. */
export function analyserCategorie(poi, titre, description) {
  const types = liste(poi.type || poi["@type"]).map((t) => sansAccents(texte(t))).join(" ");
  const mots = sansAccents([titre, description].join(" "));
  if (/concert|musique|festival de musique/.test(mots + " " + types)) return "concert";
  if (/theatre|spectacle|danse|cirque|opera/.test(mots + " " + types)) return "spectacle";
  if (/sport|match|tournoi|course|randonnee/.test(mots + " " + types)) return "sport";
  if (/marche|brocante|vide.?grenier|foire/.test(mots + " " + types)) return "marche";
  if (/exposition|vernissage|musee|galerie/.test(mots + " " + types)) return "musee";
  if (/cinema|projection|film/.test(mots + " " + types)) return "cinema";
  if (/atelier|conference|rencontre|lecture/.test(mots + " " + types)) return "biblio";
  return "event";
}

export function sansAccents(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/* Le type DATAtourisme dit-il qu'il s'agit d'un ÉVÉNEMENT ? La couche
   canonique ne contient que des événements ; un château n'y a pas sa place,
   il relève des lieux et passe par un autre chemin. */
export function estEvenement(poi) {
  const types = liste(poi && (poi.type || poi["@type"])).map((t) => sansAccents(texte(t))).join(" ");
  return /event|festival|manifestation|spectacle|concert|exhibition|saleevent|businessevent|sportsevent|culturalevent|socialevent|practicalevent|entertainmentandevent/
    .test(types);
}

/* ---- Titre normalisé et clé de rapprochement ---------------------------
   Miroir exact de `event_texte_normalise` et `event_dedup_key` en SQL. Les
   deux doivent rendre la même chose, sinon la fonction de synchronisation
   croit insérer et la base voit un conflit — ou l'inverse, ce qui est pire. */
export function titreNormalise(titre) {
  return sansAccents(titre).replace(/[^a-z0-9]+/g, " ").trim();
}

export function cleDedup(titre, lat, lng, startAt) {
  const t = titreNormalise(titre);
  if (!t || lat == null || lng == null || !startAt) return null;
  const d = new Date(startAt);
  if (!Number.isFinite(d.getTime())) return null;
  const horodatage = d.toISOString().slice(0, 13).replace(/[-T:]/g, "");
  return [t, arrondi(lat, 3), arrondi(lng, 3), horodatage].join("|");
}

/* `round()` de PostgreSQL sur numeric arrondit à l'écart de zéro (half-up),
   là où `Math.round` de JavaScript arrondit vers +∞. Sur -0,0005 les deux
   divergent, et deux moitiés du pipeline calculent alors des clés
   différentes pour le même événement. */
function arrondi(x, decimales) {
  const facteur = 10 ** decimales;
  const n = Math.sign(x) * Math.round(Math.abs(x) * facteur) / facteur;
  return n.toFixed(decimales);
}

/* ===========================================================================
   Normalisation d'un POI complet
   ======================================================================== */

export function normaliserEvenement(poi, options = {}) {
  if (!poi || typeof poi !== "object") return null;
  if (!estEvenement(poi)) return null;

  const externalId = texte(lire(poi, ["uuid", "identifier", "@id", "id"]));
  const title = texte(lire(poi, ["label", "rdfs:label", "name", "title"]));
  const position = analyserPosition(poi);
  // sans identifiant, sans titre ou sans coordonnées, l'événement ne peut ni
  // être retrouvé, ni affiché, ni dédupliqué : on le compte et on l'écarte
  if (!externalId || !title || !position) return null;

  const timeZone = options.timeZone || "Europe/Paris";
  const periode = analyserPeriode(poi, { ...options, timeZone });
  const description = texte(lire(poi, ["hasDescription", "description", "shortDescription"]));
  const ou = analyserAdresse(position.lieu || {});
  const placeName = texte(lire(position.lieu || {}, ["label", "name", "schema:name"]));
  const annonce = normaliserAnnonce(poi, {
    source: "datatourisme",
    externalId,
    sourceUrl: texte(lire(poi, ["url", "sameAs", "source"])),
  });
  const rawEvent = annonce.tagEvidence?.length
    ? {...poi, announcement_tag_evidence: annonce.tagEvidence}
    : poi;

  return {
    external_id: externalId,
    source: "datatourisme",
    source_url: annonce.provenance?.source_url || null,
    raw_event: rawEvent,
    announcement_provenance: annonce.provenance,
    event: {
      title: title.slice(0, 200),
      description: description || null,
      category: analyserCategorie(poi, title, description),
      start_at: periode.start_at,
      end_at: periode.end_at,
      timezone: timeZone,
      date_confidence: periode.confidence,
      place_name: placeName || null,
      address: ou.address,
      city: ou.city,
      insee_code: ou.insee_code,
      lat: position.lat,
      lng: position.lng,
      primary_source: "datatourisme",
      source_url: null,
      image_url: null,
      cancelled: false,
      last_source_update: analyserDate(
        lire(poi, ["lastUpdate", "lastUpdateDatatourisme", "dc:modified"]))?.iso || null,
      ...annonce.fields,
    },
  };
}

/* ---- La zone décide de ce qui la concerne -------------------------------

   LE RECTANGLE NE SUFFIT PAS À DIRE « MÉTROPOLE ».

   Un rectangle assez large pour contenir Halluin au nord et Carnin au sud
   contient aussi Orchies, Cysoing, Bailleul et un morceau de Belgique. Le
   rectangle sert donc à INTERROGER le catalogue ; ce qui décide de garder,
   c'est la liste des communes de la zone, quand elle existe.

   On compare des NOMS, pas des codes INSEE : `insee_code` est NULL sur la
   totalité des événements de la base — aucune source amont ne le fournit —
   tandis que `city` est toujours renseigné. Une zone sans `commune_keys`
   garde le comportement d'avant : le rectangle seul. */
export function cleCommune(nom) {
  return String(nom || "")
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte")
    .replace(/[^a-z0-9]+/g, "");
}

export function communeDeLaZone(ville, area) {
  const liste = area && Array.isArray(area.commune_keys) ? area.commune_keys : null;
  if (!liste || !liste.length) return true;   // zone sans liste : le rectangle décide seul
  const cle = cleCommune(ville);
  return cle ? liste.includes(cle) : false;
}

export function dansLaZone(lat, lng, area, ville) {
  if (!area || lat == null || lng == null) return false;
  if (lat < area.min_lat || lat > area.max_lat) return false;
  if (lng < area.min_lng || lng > area.max_lng) return false;
  return communeDeLaZone(ville, area);
}

/* ===========================================================================
   Déduplication

   Trois niveaux, du plus sûr au plus prudent :

     1. même source + même external_id → le même événement, sans discussion.
        Ce niveau est tenu par la base (UNIQUE sur event_sources), pas ici.

     2. titre normalisé identique + coordonnées à ~100 m + début à l'heure
        près → la clé `dedup_key`, tenue par la base elle aussi.

     3. titre très proche + coordonnées proches + horaires proches. C'est le
        seul niveau heuristique, et il est délibérément timide.

   LE DOUTE PROFITE À LA SÉPARATION. Deux concerts différents dans la même
   salle le même soir sont deux événements ; les fondre parce qu'ils partagent
   une adresse ferait disparaître celui que quelqu'un cherchait. On ne
   rapproche donc jamais sur la seule proximité géographique.
   ======================================================================== */

const SEUIL_TITRE = 0.87;        // similarité au-dessus de laquelle on rapproche
const SEUIL_DISTANCE_M = 150;
const SEUIL_HORAIRE_MS = 2 * 3600 * 1000;

export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* Similarité par bigrammes (Sørensen–Dice) : robuste aux mots réordonnés et
   aux fautes légères, sans dépendance. */
export function similariteTitre(a, b) {
  const x = titreNormalise(a), y = titreNormalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrammes = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      set.set(g, (set.get(g) || 0) + 1);
    }
    return set;
  };
  const ga = bigrammes(x), gb = bigrammes(y);
  if (!ga.size || !gb.size) return 0;
  let communs = 0;
  for (const [g, n] of ga) communs += Math.min(n, gb.get(g) || 0);
  return (2 * communs) / (
    [...ga.values()].reduce((s, n) => s + n, 0) +
    [...gb.values()].reduce((s, n) => s + n, 0));
}

/* Les trois conditions doivent tenir ENSEMBLE. Une seule ne prouve rien. */
export function memeEvenement(a, b) {
  if (!a || !b) return false;
  if (similariteTitre(a.title, b.title) < SEUIL_TITRE) return false;
  if (a.lat == null || b.lat == null) return false;
  if (distanceM(a.lat, a.lng, b.lat, b.lng) > SEUIL_DISTANCE_M) return false;

  // sans date des deux côtés, on ne peut pas conclure : on garde deux lignes
  if (!a.start_at || !b.start_at) return false;
  const ecart = Math.abs(Date.parse(a.start_at) - Date.parse(b.start_at));
  return Number.isFinite(ecart) && ecart <= SEUIL_HORAIRE_MS;
}

/* La comparaison heuristique reste exactement la même, mais ses candidats
   sont indexés spatialement et par mots de titre. Le lot DATAtourisme peut
   contenir plusieurs milliers de POI : comparer chaque paire faisait croître
   le coût au carré et épuisait le worker avant l'écriture des tags. Les neuf
   cases voisines couvrent les événements à moins de 150 m ; la comparaison
   finale continue de faire foi, donc l'index ne peut pas créer un faux doublon. */
function clesIndexDedup(event) {
  if (!event || event.lat == null || event.lng == null) return [];
  const lat = Number(event.lat), lng = Number(event.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const mots = titreNormalise(event.title).split(" ").filter((mot) => mot.length >= 3);
  const uniques = [...new Set(mots)].slice(0, 8);
  const celluleLat = Math.floor(lat / 0.002);
  const celluleLng = Math.floor(lng / 0.002);
  const cles = [];
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      for (const mot of uniques) cles.push(`${mot}|${celluleLat + dLat}|${celluleLng + dLng}`);
    }
  }
  return cles;
}

function indexerDedup(index, garde) {
  for (const cle of clesIndexDedup(garde && garde.event)) {
    const bucket = index.get(cle) || [];
    if (!bucket.includes(garde)) bucket.push(garde);
    index.set(cle, bucket);
  }
}

/* Réduit un lot à des événements distincts. Rend aussi le nombre de
   rapprochements effectués, pour que le journal de synchronisation le dise
   au lieu de laisser deviner. */
export function dedupliquer(entrees) {
  const gardes = [];
  const index = new Map();
  let fusionnes = 0;
  for (const entree of entrees || []) {
    if (!entree || !entree.event) continue;
    const candidats = new Set();
    for (const cle of clesIndexDedup(entree.event)) {
      for (const candidat of index.get(cle) || []) candidats.add(candidat);
    }
    const jumeau = [...candidats].find((g) => memeEvenement(g.event, entree.event));
    if (!jumeau) {
      gardes.push(entree);
      indexerDedup(index, entree);
      continue;
    }
    fusionnes += 1;
    // le doublon n'est pas jeté : il devient une provenance de plus du même
    // événement canonique, ce qui est exactement ce que event_sources sert
    const provenance = {source: entree.source, external_id: entree.external_id};
    if (entree.source_url || entree.event.source_url) {
      provenance.source_url = entree.source_url || entree.event.source_url;
    }
    if (entree.raw_event) provenance.raw_data = entree.raw_event;
    if (entree.event.last_source_update) {
      provenance.source_updated_at = entree.event.last_source_update;
    }
    jumeau.provenances = [...(jumeau.provenances || []), provenance];
    // on complète les trous sans jamais écraser une valeur déjà connue
    for (const [cle, valeurNouvelle] of Object.entries(entree.event)) {
      if (jumeau.event[cle] == null && valeurNouvelle != null) {
        jumeau.event[cle] = valeurNouvelle;
      }
    }
    Object.assign(jumeau.event, fusionnerAnnonceFields(jumeau.event, entree.event));
    indexerDedup(index, jumeau);
  }
  return { gardes, fusionnes };
}

/* ===========================================================================
   Le lot complet d'une zone : normaliser, filtrer, dédupliquer, compter.
   Un POI défectueux est compté puis oublié ; il n'interrompt rien.
   ======================================================================== */
export function normaliserLot(pois, area, options = {}) {
  const vus = liste(pois);
  const retenus = [];
  const rejets = [];

  for (const poi of vus) {
    let normalise = null;
    try {
      normalise = normaliserEvenement(poi, {
        ...options, timeZone: (area && area.timezone) || options.timeZone || "Europe/Paris",
      });
    } catch (erreur) {
      // un seul POI mal formé ne doit pas faire tomber la zone entière
      rejets.push({ raison: "exception", message: String(erreur && erreur.message || erreur) });
      continue;
    }
    if (!normalise) { rejets.push({ raison: "inexploitable" }); continue; }
    if (!dansLaZone(normalise.event.lat, normalise.event.lng, area, normalise.event.city)) {
      rejets.push({
        raison: communeDeLaZone(normalise.event.city, area) ? "hors_rectangle" : "hors_communes",
        ville: normalise.event.city || null,
      });
      continue;
    }
    retenus.push(normalise);
  }

  const { gardes, fusionnes } = dedupliquer(retenus);
  return { vus: vus.length, gardes, fusionnes, rejets: rejets.length, detailRejets: rejets };
}
