/* Point d'entrée source pour les référentiels Aide. Les adapters du navigateur
   restent séparés ; cette route ne fait que servir les extraits locaux et, si
   les secrets d'amont sont présents, compléter DORA/FINESS côté serveur. */
import doraSnapshot from "../data/aide-dora-tourcoing.js";
import finessSnapshot from "../data/aide-finess-tourcoing.js";

export const config = { runtime: "edge" };

const CENTRE = { lat: 50.72373, lng: 3.160758 };
const SOURCES = new Set(["autour", "dora", "finess"]);
const RAYON_MIN = 500;
const RAYON_MAX = 20000;
const DORA_API = "https://api.data.inclusion.beta.gouv.fr/api/v1/search";

function nombre(value, maximum) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= maximum ? n : null;
}

function distanceM(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function reponse(body, status = 200, cache = "public, s-maxage=3600, stale-while-revalidate=86400") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache,
      "x-autour-source": "aide-structures" },
  });
}

function coordonnees(item) {
  const lat = nombre(item && (item.latitude ?? item.lat), 90);
  const lng = nombre(item && (item.longitude ?? item.lng ?? item.lon), 180);
  return lat == null || lng == null ? null : { lat, lng };
}

function dansRayon(items, lat, lng, rayon) {
  return (items || []).filter((item) => {
    const c = coordonnees(item);
    return c && distanceM({lat, lng}, c) <= rayon;
  });
}

async function doraDistant(url, signal) {
  const token = typeof process !== "undefined" && process.env &&
    (process.env.DORA_API_TOKEN || process.env.DATA_INCLUSION_API_TOKEN);
  if (!token) return [];
  const r = await fetch(url, {
    headers: { accept: "application/json", authorization: "Bearer " + token },
    signal,
  });
  if (!r.ok) return [];
  const body = await r.json();
  return body.results || body.items || body.data || [];
}

async function finessDistant(signal) {
  const url = typeof process !== "undefined" && process.env &&
    (process.env.FINESS_AIDE_URL || process.env.FINESS_STRUCTURES_URL);
  if (!url) return [];
  const r = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!r.ok) return [];
  const body = await r.json();
  const items = Array.isArray(body) ? body : (body.items || body.pmej || []);
  /* FINESS NG regroupe les établissements géographiques (`ege`) sous une
     même personne morale. Une fiche par EGE est indispensable : sinon deux
     sites qui partagent un SIRET s'écrasent l'un l'autre dans la carte. */
  return items.flatMap((item) => {
    const eges = Array.isArray(item && item.ege) ? item.ege : [];
    if (!eges.length) return [item];
    return eges.map((ege) => Object.assign({}, item, {
      ege: [ege],
      adresse: ege.adresse || item.adresse,
      contact: ege.contact || item.contact,
      categorieentiteGeographiqueExercice: ege.categorieentiteGeographiqueExercice,
    }));
  });
}

export default async function handler(request) {
  if (request.method && request.method !== "GET") return reponse({items: []}, 405, "no-store");
  const url = new URL(request.url);
  const source = url.searchParams.get("source") || "autour";
  const lat = nombre(url.searchParams.get("lat"), 90);
  const lng = nombre(url.searchParams.get("lng"), 180);
  const rayon = Math.min(RAYON_MAX, Math.max(RAYON_MIN, nombre(url.searchParams.get("radius"), RAYON_MAX) || 15000));
  if (!SOURCES.has(source) || lat == null || lng == null) return reponse({items: []}, 400, "public, max-age=60");

  let items = source === "dora" ? doraSnapshot.slice() : source === "finess" ? finessSnapshot.slice() : [];
  try {
    if (source === "dora") {
      const q = new URL(DORA_API);
      q.searchParams.set("lat", String(lat)); q.searchParams.set("lon", String(lng));
      q.searchParams.set("distance", String(Math.ceil(rayon / 1000))); q.searchParams.set("size", "500");
      q.searchParams.set("exclure_doublons", "false");
      items = items.concat(await doraDistant(q, request.signal));
    }
    if (source === "finess") items = items.concat(await finessDistant(request.signal));
  } catch (error) {
    /* Le snapshot reste une réponse utile quand un amont est indisponible. */
  }
  const seen = new Set();
  const uniques = dansRayon(items, lat, lng, rayon).filter((item) => {
    const key = String(item.id || item.slug || item.doraId || item.finessEge || item.finessPm || item.siret || JSON.stringify(item));
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return reponse({items: uniques, source, centre: CENTRE, rayon, snapshot: true});
}
