/* ===========================================================================
   L'INVENTAIRE DÉJÀ PRÉPARÉ, LU COMME LE CLIENT LE LIT

   Le flux imposé par le chantier est : sources externes → agents Autour →
   vérification → base → MCP → ChatGPT. Ce fichier est l'avant-dernière flèche,
   et il n'a le droit de rien faire d'autre que LIRE.

   Trois conséquences concrètes :

     · les mêmes fonctions publiques que la page appelle — `evenements_locaux`,
       `lieux_explorer`, `local_discovery_nearby`, `evenement_seances` — et
       aucune requête inventée pour ChatGPT ;
     · la clé PUBLIABLE, celle du navigateur, jamais une clé de service. Une
       fonction serveur qui porterait `service_role` donnerait à ChatGPT un
       accès que le produit ne donne à personne ;
     · aucune écriture. La V1 est en lecture seule, et cela se voit dans le
       code : il n'y a pas de fonction d'écriture ici.

   LE CACHE EST UNE QUESTION DE VITESSE, PAS DE CONFORT. Une conversation
   ChatGPT enchaîne souvent deux outils sur la même ville (« que faire ce
   soir » puis « et une brocante dimanche ? »). Trente secondes de mémoire
   suffisent à ne pas payer deux fois la même lecture, et restent trop courtes
   pour servir un statut temporel périmé.
   ======================================================================== */

const URL_DEFAUT = "https://sxnzyvcgwbwnpjnqmpkp.supabase.co";
/* La même clé publiable que `app.js` : elle est publique par construction,
   bornée par RLS, et ne donne accès qu'à ce que tout visiteur peut lire. */
const CLE_DEFAUT = "sb_publishable_T4_3er0DEI9vX4YdEhPDIw_m3yV_FlM";

const CACHE_MS = 30000;
const DELAI_MS = 6000;

const cache = new Map();
let injection = null;

/* Les tests n'ont pas le droit de sortir du réseau, et ce serveur n'a pas le
   droit d'être testé sur des données inventées. Le compromis est explicite :
   on injecte des RÉPONSES RÉELLES, relevées en base, et le reste du chemin —
   projection, moteurs, classement, liens — est exécuté pour de vrai. */
export function injecter(reponses) {
  injection = reponses || null;
  cache.clear();
}

function config() {
  const env = (typeof process !== "undefined" && process.env) || {};
  return {
    url: String(env.SUPABASE_URL || env.AUTOUR_SUPABASE_URL || URL_DEFAUT).replace(/\/$/, ""),
    cle: String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || CLE_DEFAUT),
  };
}

function frais(cle) {
  const entree = cache.get(cle);
  if (!entree) return null;
  if (Date.now() - entree.le > CACHE_MS) { cache.delete(cle); return null; }
  return entree.valeur;
}

async function lire(chemin, init, cleCache, sansCache) {
  if (injection) {
    /* Une fonction laisse le test répondre par préfixe de clé — c'est plus
       lisible qu'une table dont les clés reproduisent le JSON des paramètres. */
    if (typeof injection === "function") {
      const valeur = await injection(cleCache, chemin, init);
      if (valeur === undefined) throw new Error("injection_absente:" + cleCache);
      return valeur;
    }
    if (!(cleCache in injection)) throw new Error("injection_absente:" + cleCache);
    return injection[cleCache];
  }
  const memo = sansCache ? null : frais(cleCache);
  if (memo) return memo;
  const { url, cle } = config();
  const reponse = await fetch(url + "/rest/v1/" + chemin, Object.assign({}, init, {
    headers: Object.assign({
      apikey: cle, Authorization: "Bearer " + cle,
      "content-type": "application/json", accept: "application/json",
    }, (init && init.headers) || {}),
    signal: AbortSignal.timeout(DELAI_MS),
  }));
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error("base_" + reponse.status + ":" + texte.slice(0, 160));
  const valeur = texte ? JSON.parse(texte) : null;
  if (!sansCache) cache.set(cleCache, { le: Date.now(), valeur });
  return valeur;
}

function rpc(nom, params, options) {
  const cleCache = "rpc:" + nom + ":" + JSON.stringify(params);
  return lire("rpc/" + nom, { method: "POST", body: JSON.stringify(params) }, cleCache,
    options && options.cache === false);
}

/* ---- ÉVÉNEMENTS ---------------------------------------------------------
   `RAYON_EVENEMENTS_M` est le `RAYON_PUBLICATIONS_M` d'`app.js` : cinq
   kilomètres autour du point demandé. La page l'élargit à la vue de la carte ;
   un serveur n'a pas de vue, donc il garde le rayon nominal. */
const RAYON_EVENEMENTS_M = 5000;

export function emprise(lat, lng, rayonM = RAYON_EVENEMENTS_M) {
  const dLat = rayonM / 111320;
  const dLng = rayonM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { s: lat - dLat, n: lat + dLat, o: lng - dLng, e: lng + dLng };
}

export function evenements(zoneId, lat, lng, { rayonM = RAYON_EVENEMENTS_M, limite = 120 } = {}) {
  const b = emprise(lat, lng, rayonM);
  return rpc("evenements_locaux", {
    p_zone_id: zoneId, p_sud: b.s, p_ouest: b.o, p_nord: b.n, p_est: b.e, p_limite: limite,
  });
}

export function seances(eventId, limite = 40) {
  return rpc("evenement_seances", { p_event_id: eventId, p_limite: limite });
}

export function lieux(zoneId, { famille = null, lat, lng, rayonM = 3000, limite = 30 } = {}) {
  return rpc("lieux_explorer", {
    p_zone_id: zoneId, p_famille: famille, p_lat: lat, p_lng: lng,
    p_rayon_m: rayonM, p_limite: limite,
  });
}

export function pointsDeService(lat, lng, { rayonM = 15000, limite = 80 } = {}) {
  return rpc("local_discovery_nearby", {
    p_lat: lat, p_lng: lng, p_radius_m: Math.round(rayonM), p_limit: limite,
  });
}

/* La couverture est la seule chose qu'Autour sait sur sa propre ignorance.
   `local_coverage` n'est pas lisible par `anon` — à raison : elle porte aussi
   des compteurs d'exploitation. La vue publique n'en rend que le verdict. */
export function couverture(territoire, categorie) {
  return rpc("local_coverage_publique", { p_territoire: territoire, p_categorie: categorie || null });
}

/* ---- FICHES ------------------------------------------------------------
   `events` et `places` sont en lecture publique (RLS « lecture publique »).
   La liste de colonnes est ÉCRITE ICI, jamais `select=*` : c'est la première
   barrière de confidentialité, avant même la projection. */
const COLONNES_EVENEMENT = [
  "id", "title", "description", "category", "start_at", "end_at", "timezone",
  "temporal_status", "date_confidence", "price_text", "price_amount", "is_free",
  "audience", "min_age", "reservation_required", "reservation_text", "booking_url",
  "website", "phone", "place_name", "venue_name", "address", "city", "insee_code",
  "lat", "lng", "primary_source", "source_url", "event_source", "event_source_url",
  "image_url", "image_source", "image_source_url", "image_author", "image_license",
  "cancelled", "last_source_update", "last_synced_at", "artist_names", "music_genres",
  "event_kind", "importance_level", "performers", "organizer", "organizer_name",
  "ticket_url", "announcement_tags", "zone_id", "duplicate_of",
].join(",");

/* `places` ne porte NI téléphone NI services : ces deux-là vivent dans la
   découverte locale, et c'est `local_discovery_nearby` qui les rend, avec le
   statut de vérification. `get_place` va donc les chercher là — la même
   fonction publique que Solidarité — au lieu d'inventer une colonne. */
const COLONNES_LIEU = [
  "id", "slug", "name", "category", "family", "lat", "lng", "address", "postal_code",
  "city", "commune", "insee_code", "zone_id", "description", "official_url",
  "image_url", "image_source", "image_author", "image_license", "opening_hours",
  "opening_hours_source", "temporarily_closed", "closed_until", "closure_reason",
  "status", "updated_at", "last_seen_at",
].join(",");

export async function evenement(id) {
  const rows = await lire("events?id=eq." + encodeURIComponent(id) + "&select=" + COLONNES_EVENEMENT +
    "&limit=1", { method: "GET" }, "event:" + id);
  return (rows || [])[0] || null;
}

export async function lieu(id) {
  const filtre = /^[0-9a-f-]{36}$/i.test(String(id))
    ? "id=eq." + encodeURIComponent(id) : "slug=eq." + encodeURIComponent(id);
  const rows = await lire("places?" + filtre + "&select=" + COLONNES_LIEU + "&limit=1",
    { method: "GET" }, "place:" + id);
  return (rows || [])[0] || null;
}

/* ---- MESURE AGRÉGÉE ----------------------------------------------------
   `compter_metrique_territoriale` est la fonction que la page utilise déjà
   pour ses compteurs de territoire : un jour, un contexte, une zone, un nom de
   métrique, un entier. Elle n'accepte rien d'autre — pas d'identifiant, pas de
   requête, pas d'adresse IP. C'est exactement la mesure que ce chantier
   demande, et c'est tout ce qu'on peut y mettre. */
export async function mesurer(metrique, zone, valeur = 1) {
  if (injection) return null;
  try {
    return await rpc("compter_metrique_territoriale", {
      p_context: "chatgpt", p_metrique: String(metrique).slice(0, 60),
      p_valeur: Number(valeur) || 1, p_zone: zone ? String(zone).slice(0, 40) : null,
    }, { cache: false });
  } catch (e) { return null; }
}

/* ---- LE RÉFÉRENTIEL D'AIDE, LU PAR LA ROUTE QUI EXISTE DÉJÀ -------------
   `data/aide-precalcule-villes.js` pèse cinq mégaoctets : l'importer dans une
   fonction de bord la ferait dépasser sa limite de taille et coûterait son
   analyse à chaque démarrage à froid. Or Autour a DÉJÀ une route qui sert ce
   référentiel, filtré par rayon, avec six heures de cache CDN : celle que le
   navigateur appelle. On l'appelle donc pareil, ce qui garantit en plus que
   ChatGPT et l'écran Solidarité voient exactement la même liste. */
export async function aideStructures(lat, lng, { source = "dora", rayonM = 6000, limite = 60 } = {}) {
  const cleCache = "aide:" + source + ":" + lat.toFixed(3) + "," + lng.toFixed(3) + ":" + rayonM;
  if (injection) {
    const valeur = typeof injection === "function"
      ? await injection(cleCache, "aide-structures", null) : injection[cleCache];
    if (valeur === undefined) throw new Error("injection_absente:" + cleCache);
    return valeur;
  }
  const memo = frais(cleCache);
  if (memo) return memo;
  const env = (typeof process !== "undefined" && process.env) || {};
  const origine = String(env.AUTOUR_BASE_URL || "https://autour.eu").replace(/\/$/, "");
  const url = origine + "/api/aide-structures?source=" + encodeURIComponent(source) +
    "&lat=" + lat.toFixed(5) + "&lng=" + lng.toFixed(5) +
    "&radius=" + Math.round(rayonM) + "&limit=" + Math.round(limite);
  const reponse = await fetch(url, { headers: { accept: "application/json" },
    signal: AbortSignal.timeout(DELAI_MS) });
  if (!reponse.ok) throw new Error("aide_" + reponse.status);
  const corps = await reponse.json();
  const items = (corps && corps.items) || [];
  cache.set(cleCache, { le: Date.now(), valeur: items });
  return items;
}

export async function quota(cle, max, fenetreS) {
  const rows = await rpc("mcp_quota", { p_cle: cle, p_max: max, p_fenetre_s: fenetreS },
    { cache: false });
  return (rows || [])[0] || null;
}

export const RAYONS = Object.freeze({ EVENEMENTS_M: RAYON_EVENEMENTS_M });
