/* ===========================================================================
   Annuaire institutionnel pour Aide

   Cette route n'est pas un proxy générique. Elle interroge uniquement
   l'Annuaire de l'administration et des services publics, sur le département
   de la position demandée, pour les réseaux d'insertion connus. La réponse
   est une projection publique minimale : les champs personnels et les
   données sans rapport avec la découverte ne traversent jamais la route.
   ======================================================================== */

import snapshotTourcoing from "../data/aide-institutionnelle-dila-59599.js";

export const config = { runtime: "edge" };

const API = "https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";
/* Export communal de la Base de données locales DILA, publié comme ressource
   du jeu data.gouv.fr. L'index permet de suivre automatiquement la dernière
   version sans embarquer l'archive nationale de plusieurs centaines de Mo. */
const DATA_GOUV_COMMUNES = "https://lecomarquage.service-public.gouv.fr/donnees_locales_v4/all/";
const ANNUAIRE = "https://lannuaire.service-public.gouv.fr/";
const GEO = "https://geo.api.gouv.fr/communes";
const GEO_REGIONS = "https://geo.api.gouv.fr/regions/";
const GEO_DEPARTEMENTS = "https://geo.api.gouv.fr/departements/";
const REQUETES = Object.freeze([
  "mission locale",
  "mission emploi",
  "france travail",
  "cap emploi",
  "maison de l'emploi",
]);
const BESOINS = new Set(["travail", "jeunes"]);
const RAYON_MIN = 500;
const RAYON_MAX = 20000;
const LIMITE = 100;
const DELAI_MS = 5000;
const TYPES_BASE_LOCALE = Object.freeze({
  "mission locale": ["mission_locale"],
  "mission emploi": ["mission_locale"],
  "france travail": ["france_travail"],
  "cap emploi": ["cap_emploi"],
  "maison de l'emploi": ["maison_emploi", "maison_de_l_emploi"],
});

function nombre(value, maximum) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= maximum ? n : null;
}

function reponse(body, status = 200, cache = "public, s-maxage=3600, stale-while-revalidate=86400") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      "x-autour-source": "service_public",
    },
  });
}

function decouperJSON(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function adresseAvecCoordonnees(record) {
  const adresses = decouperJSON(record && record.adresse, []);
  if (!Array.isArray(adresses)) return null;
  return adresses.find((a) => nombre(a && (a.latitude ?? a.lat), 90) != null &&
    nombre(a && (a.longitude ?? a.lon ?? a.lng), 180) != null) || null;
}

function distanceMetres(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projection(record, lat, lng, rayon) {
  if (!record || !record.id) return null;
  const adresse = adresseAvecCoordonnees(record);
  if (!adresse) return null;
  const rLat = nombre(adresse.latitude ?? adresse.lat, 90);
  const rLng = nombre(adresse.longitude ?? adresse.lon ?? adresse.lng, 180);
  const distance = distanceMetres(lat, lng, rLat, rLng);
  if (distance > rayon) return null;

  /* Liste blanche explicite. `mission`, téléphone, site et horaires sont
     publics ; les courriels, personnes affectées et autres champs de
     l'annuaire ne sont pas nécessaires à la carte. */
  return {
    id: String(record.id),
    nom: record.nom || "",
    sigle: record.sigle || "",
    ancien_nom: record.ancien_nom || "",
    siret: record.siret || "",
    siren: record.siren || "",
    adresse: record.adresse || "",
    telephone: record.telephone || "",
    site_internet: record.site_internet || "",
    plage_ouverture: record.plage_ouverture || "",
    mission: record.mission || "",
    date_modification_datetime: record.date_modification_datetime || null,
    url_service_public: record.url_service_public || "",
    distance_m: Math.round(distance),
  };
}

function slugue(value) {
  return String(value == null ? "" : value).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "-").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function premierJSONLD(html) {
  const scripts = String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const value = JSON.parse(match[1].trim());
      if (value && typeof value === "object") return value;
    } catch (e) {
      /* Une page peut contenir un bloc JSON-LD secondaire mal formé. */
    }
  }
  return null;
}

function ficheEnregistrement(data, id, url, type) {
  const location = data && data.location || {};
  const address = location.address || {};
  const geo = location.geo || {};
  const street = String(address.streetAddress || "").trim();
  const split = street.match(/^(.*?)(?=\d+\s)/);
  const contacts = Array.isArray(data && data.contactPoint) ? data.contactPoint : [];
  const telephone = contacts.filter((contact) => contact && contact.telephone)
    .map((contact) => ({ valeur: contact.telephone }));
  const opening = Array.isArray(data && data.openingHoursSpecification)
    ? data.openingHoursSpecification.map((hours) => ({
      nom_jour_debut: String(hours.dayOfWeek || "").split("/").pop(),
      nom_jour_fin: String(hours.dayOfWeek || "").split("/").pop(),
      valeur_heure_debut_1: hours.opens || "",
      valeur_heure_fin_1: hours.closes || "",
      valeur_heure_debut_2: "",
      valeur_heure_fin_2: "",
    })) : [];
  return {
    id,
    nom: data && data.name || "",
    sigle: "",
    ancien_nom: "",
    pivot: [type],
    adresse: [{
      complement1: split ? split[1].trim() : "",
      numero_voie: split ? street.slice(split[0].length).trim() : street,
      code_postal: address.postalCode || "",
      nom_commune: address.addressLocality || "",
      latitude: geo.latitude,
      longitude: geo.longitude,
    }],
    telephone,
    site_internet: data && data.url ? [{ valeur: data.url }] : [],
    plage_ouverture: opening,
    mission: data && data.serviceType || "",
    date_modification_datetime: null,
    url_service_public: url,
  };
}

async function texteAmont(url, signal) {
  const r = await fetch(url, {
    headers: { accept: "text/html,application/json" },
    signal: signal || (AbortSignal.timeout ? AbortSignal.timeout(DELAI_MS) : undefined),
  });
  if (!r.ok) throw new Error("service_public_" + r.status);
  return r.text();
}

async function objetAmont(url, signal) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    signal: signal || (AbortSignal.timeout ? AbortSignal.timeout(DELAI_MS) : undefined),
  });
  if (!r.ok) throw new Error("geo_" + r.status);
  return r.json();
}

async function baseLocale(url, lieu) {
  const index = await texteAmont(DATA_GOUV_COMMUNES, lieu.signal);
  const versions = [...index.matchAll(/href=["']([^"']*data\.gouv_commune\/)["']/gi)]
    .map((match) => match[1]).sort();
  const version = versions.at(-1);
  if (!version) throw new Error("base_locale_version_absente");
  const relationUrl = new URL(String(lieu.code) + ".json", new URL(version, DATA_GOUV_COMMUNES)).toString();
  const relation = JSON.parse(await texteAmont(relationUrl, lieu.signal));
  const parType = new Map();
  (relation.commune && relation.commune[0] && relation.commune[0].type_service_local || [])
    .forEach((entry) => {
      const type = String(entry && entry.code_type_service_local || "");
      const ids = Array.isArray(entry && entry.organisme) ? entry.organisme.map(String) : [];
      if (type && ids.length) parType.set(type, ids);
    });

  const region = await objetAmont(GEO_REGIONS + encodeURIComponent(lieu.codeRegion) + "?fields=nom&format=json", lieu.signal);
  const departement = await objetAmont(GEO_DEPARTEMENTS + encodeURIComponent(lieu.codeDepartement) + "?fields=nom&format=json", lieu.signal);
  const regionSlug = slugue(region && region.nom);
  const departementSlug = slugue(departement && departement.nom);
  const idsParType = new Map();
  Object.values(TYPES_BASE_LOCALE).flat().forEach((type) => {
    if (!idsParType.has(type)) idsParType.set(type, parType.get(type) || []);
  });
  const toutes = new Map();
  idsParType.forEach((ids, type) => ids.forEach((id) => toutes.set(id, type)));
  const fiches = await Promise.allSettled([...toutes].map(async ([id, type]) => {
    const url = ANNUAIRE + regionSlug + "/" + departementSlug + "/" + id;
    const page = await texteAmont(url, lieu.signal);
    const data = premierJSONLD(page);
    if (!data || !data.location || !data.location.geo) throw new Error("fiche_structurée_absente");
    return ficheEnregistrement(data, id, url, type);
  }));
  const records = fiches.filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  return { records, relationUrl, version, parType };
}

function baseLocaleStatique(commune) {
  if (String(commune && commune.code) !== snapshotTourcoing.code_insee_commune) return null;
  return {
    records: snapshotTourcoing.records,
    relationUrl: snapshotTourcoing.source_export,
    version: snapshotTourcoing.snapshot_date,
    parType: null,
  };
}

function filtrerBaseLocale(records, terme, parType) {
  const types = TYPES_BASE_LOCALE[terme] || [];
  if (parType && typeof parType.get === "function") {
    const ids = new Set(types.flatMap((type) => parType.get(type) || []));
    return records.filter((record) => ids.has(String(record.id)));
  }
  const needle = slugue(terme);
  return records.filter((record) => slugue(JSON.stringify(record)).includes(needle));
}

async function jsonAmont(url, signal) {
  const r = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Autour/1.0 (+https://autour.eu/)",
    },
    signal: signal || (AbortSignal.timeout ? AbortSignal.timeout(DELAI_MS) : undefined),
  });
  if (!r.ok) throw new Error("service_public_" + r.status);
  const j = await r.json();
  const records = Array.isArray(j) ? j : (j && Array.isArray(j.results) ? j.results : []);
  return records;
}

export default async function handler(requete) {
  if (requete.method && requete.method !== "GET")
    return reponse({ erreur: "méthode non acceptée" }, 405, "no-store");

  const url = new URL(requete.url);
  const lat = nombre(url.searchParams.get("lat"), 90);
  const lng = nombre(url.searchParams.get("lng"), 180);
  const rayon = Math.min(RAYON_MAX, Math.max(RAYON_MIN,
    nombre(url.searchParams.get("radius"), RAYON_MAX) || 6000));
  const besoins = new Set((url.searchParams.get("needs") || "")
    .split(",").map((x) => x.trim()).filter(Boolean));
  if (lat == null || lng == null || !besoins.size ||
      ![...besoins].every((x) => BESOINS.has(x)))
    return reponse({ items: [] }, 400, "public, max-age=60");

  try {
    const communes = await jsonAmont(
      GEO + "?lat=" + encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lng) +
      "&fields=code,nom,codeDepartement,codeRegion&format=json", requete.signal);
    const commune = communes[0] || {};
    const departement = commune.codeDepartement;
    if (!/^(?:\d{2,3}|2A|2B)$/.test(String(departement || ""))) return reponse({ items: [] });

    const fields = ["id", "nom", "sigle", "ancien_nom", "siret", "siren", "adresse",
      "telephone", "site_internet", "plage_ouverture", "mission",
      "date_modification_datetime", "url_service_public"].join(",");
    let resultats = [];
    /* Une requête combinée évite de déclencher la protection anti-abus du
       relais avec cinq appels parallèles. Le pivot administratif est la
       preuve métier qui manque aux noms commerciaux comme « Mission Emploi ».
       `search(*)` couvre les variantes de nom, de sigle et de mission. */
    const q = new URL(API);
    const recherches = REQUETES.map((terme) => 'search(*,"' + terme + '")');
    recherches.unshift('pivot LIKE "mission_locale"');
    q.searchParams.set("where", 'code_insee_commune LIKE "' + departement + '%" and (' +
      recherches.join(" or ") + ')');
    q.searchParams.set("limit", String(LIMITE));
    q.searchParams.set("select", fields);
    try {
      resultats = await jsonAmont(q, requete.signal);
    } catch (e) {
      let base;
      try {
        base = await baseLocale(endpointLieu(commune, requete.signal), commune);
      } catch (fallbackError) {
        base = baseLocaleStatique(commune);
        if (!base) throw fallbackError;
      }
      resultats = base.records;
    }
    const uniques = new Map();
    resultats.forEach((record) => {
      const item = projection(record, lat, lng, rayon);
      if (item) uniques.set(item.id, item);
    });
    return reponse({ items: [...uniques.values()] });
  } catch (e) {
    return reponse({ items: [] }, 503, "public, max-age=60");
  }
}

function endpointLieu(commune, signal) {
  return {
    code: commune.code,
    codeRegion: commune.codeRegion,
    codeDepartement: commune.codeDepartement,
    signal,
  };
}