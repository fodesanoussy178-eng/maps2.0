/* Point d'entrée source pour les référentiels Aide. Les adapters du navigateur
   restent séparés ; cette route sert un pré-calcul national par commune puis,
   si les secrets d'amont sont présents, le complète par DORA/FINESS. */
import doraSnapshot from "../data/aide-dora-tourcoing.js";
import finessSnapshot from "../data/aide-finess-tourcoing.js";
import aidePrecalcule, { metadata as aidePrecalculeMetadata } from "../data/aide-precalcule-villes.js";

export const config = { runtime: "edge" };

const SOURCES = new Set(["autour", "dora", "finess"]);
const RAYON_MIN = 500;
const RAYON_MAX = 20000;
const RESULTATS_MAX = 60;
const DORA_API = "https://api.data.inclusion.beta.gouv.fr/api/v1/search";
const ZONE_PRECALCULEE_MAX_M = 30000;

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

function reponse(body, status = 200, cache = "public, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=604800") {
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

async function communePour(lat, lng, signal) {
  const url = "https://geo.api.gouv.fr/communes?lat=" + encodeURIComponent(lat) +
    "&lon=" + encodeURIComponent(lng) + "&fields=code,nom&format=json";
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: signal || (AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined),
  });
  if (!response.ok) throw new Error("commune_" + response.status);
  const communes = await response.json();
  const commune = Array.isArray(communes) ? communes[0] : null;
  if (!commune || !commune.code) throw new Error("commune_absente");
  return commune;
}

function distanceDuCentre(record, lat, lng) {
  const c = coordonnees(record);
  return c ? distanceM({lat, lng}, c) : Infinity;
}

/* Le pré-calcul national est aussi le dernier filet quand geo.api.gouv.fr est
   lent ou indisponible. Il ne fabrique pas une commune et ne fait pas suivre
   un bassin à l'autre : le choix est borné au centre connu le plus proche,
   puis chaque fiche est à nouveau filtrée sur ses coordonnées et le rayon
   demandé. Au-delà de 30 km, l'absence de zone reste une absence de données. */
function zonePrecalculeeProche(lat, lng) {
  const candidats = Object.entries(aidePrecalcule || {}).map(([code, zone]) => ({
    code, distance: zone && Number.isFinite(Number(zone.lat)) && Number.isFinite(Number(zone.lng))
      ? distanceM({lat, lng}, {lat: Number(zone.lat), lng: Number(zone.lng)}) : Infinity,
  })).sort((a, b) => a.distance - b.distance);
  const meilleur = candidats[0];
  return meilleur && meilleur.distance <= ZONE_PRECALCULEE_MAX_M ? meilleur : null;
}

function localParCommune(source, code, lat, lng, rayon) {
  const zone = aidePrecalcule && aidePrecalcule[String(code)];
  let items = zone && Array.isArray(zone.records) ? zone.records.slice() : [];

  /* Le flux FINESS ne doit pas devenir un alias silencieux de tout
     data·inclusion : seules les lignes dont le producteur est FINESS entrent
     dans cette branche. Le flux DORA/data·inclusion, lui, peut agréger les
     producteurs d'insertion nationaux documentés par data·inclusion. */
  if (source === "finess") items = items.filter((item) => item.dataProvider === "finess");

  /* Les anciens extraits Tourcoing restent utiles comme fixture de secours,
     mais leur portée est strictement bornée à la commune qu'ils nomment. Ils
     ne peuvent plus nourrir Lille, Roubaix ou une ville sans pré-calcul. */
  if (String(code) === "59599") {
    if (source === "dora") items = items.concat(doraSnapshot.filter((item) =>
      String(item.cityCode || item.city_code || "") === "59599"));
    if (source === "finess") items = items.concat(finessSnapshot.filter((item) =>
      /^tourcoing(?:\s|$)/i.test(String(item.commune || "")) &&
      /^59200/.test(String(item.codePostal || item.code_postal || ""))));
  }

  return items.filter((item) => distanceDuCentre(item, lat, lng) <= rayon);
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
  const limite = Math.min(RESULTATS_MAX, Math.max(1,
    Math.trunc(nombre(url.searchParams.get("limit"), RESULTATS_MAX) || RESULTATS_MAX)));
  if (!SOURCES.has(source) || lat == null || lng == null) return reponse({items: []}, 400, "public, max-age=60");

  let items = [];
  let commune = null;
  const sourceStatus = [];
  try {
    if (source !== "autour") {
      const code = url.searchParams.get("city_code");
      let zoneFallback = false;
      if (code) commune = { code: code };
      else {
        try {
          commune = await communePour(lat, lng, request.signal);
        } catch (error) {
          const proche = zonePrecalculeeProche(lat, lng);
          if (!proche) throw error;
          commune = { code: proche.code };
          zoneFallback = true;
        }
      }
      items = localParCommune(source, commune.code, lat, lng, rayon);
      sourceStatus.push({
        source: "data_inclusion",
        state: items.length ? "ok" : "empty",
        scope: String(commune.code),
        ...(zoneFallback ? {scopeFallback: "centre_precalcule_borne"} : {}),
        snapshotDate: aidePrecalculeMetadata && aidePrecalculeMetadata.snapshotDate || null,
      });
    }
    if (source === "dora") {
      const q = new URL(DORA_API);
      q.searchParams.set("lat", String(lat)); q.searchParams.set("lon", String(lng));
      q.searchParams.set("distance", String(Math.ceil(rayon / 1000)));
      q.searchParams.set("size", String(limite));
      q.searchParams.set("exclure_doublons", "false");
      const distant = await doraDistant(q, request.signal);
      items = items.concat(distant);
      if (distant.length) sourceStatus.push({source: "dora", state: "ok", count: distant.length});
      else if (typeof process !== "undefined" && process.env &&
        (process.env.DORA_API_TOKEN || process.env.DATA_INCLUSION_API_TOKEN))
        sourceStatus.push({source: "dora", state: "empty"});
      else sourceStatus.push({source: "dora", state: "not_configured"});
    }
    if (source === "finess") {
      const distant = await finessDistant(request.signal);
      items = items.concat(distant);
      if (distant.length) sourceStatus.push({source: "finess", state: "ok", count: distant.length});
      else if (typeof process !== "undefined" && process.env &&
        (process.env.FINESS_AIDE_URL || process.env.FINESS_STRUCTURES_URL))
        sourceStatus.push({source: "finess", state: "empty"});
      else sourceStatus.push({source: "finess", state: "not_configured"});
    }
  } catch (error) {
    sourceStatus.push({source, state: "unavailable", reason: String(error && error.message || "amont_indisponible")});
  }
  const seen = new Set();
  const uniques = dansRayon(items, lat, lng, rayon).filter((item) => {
    const key = String(item.id || item.slug || item.doraId || item.finessEge || item.finessPm || item.siret || JSON.stringify(item));
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return reponse({items: uniques.slice(0, limite), source, centre: {lat, lng}, rayon,
    cityCode: commune && commune.code || null,
    snapshot: items.some((item) => item && item.source === "data_inclusion"),
    sourceStatus,
  });
}
