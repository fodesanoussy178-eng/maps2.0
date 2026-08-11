/* ===========================================================================
   DATAtourisme, derrière l'origine Autour

   La clé reste exclusivement dans l'environnement Vercel : le navigateur ne
   connaît que cette route et ne reçoit qu'une projection compacte des POI.
   L'URL amont est entièrement construite ici (aucun paramètre fournisseur ne
   traverse la frontière), ce qui évite d'en faire un proxy générique.
   ======================================================================== */

export const config = { runtime: "edge" };

const CATALOGUE = "https://api.datatourisme.fr/v1/catalog";
const RAYON = "3km";
const LIMITE = 50;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 120;
const cache = new Map();

function nombre(value, maximum) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= maximum ? n : null;
}

function valeur(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return valeur(value[0]);
  if (typeof value === "object") {
    const priorite = ["fr", "@value", "value", "label", "name", "text", "content"];
    for (const cle of priorite) {
      if (value[cle] != null) {
        const trouve = valeur(value[cle]);
        if (trouve) return trouve;
      }
    }
    for (const candidate of Object.values(value)) {
      const trouve = valeur(candidate);
      if (trouve) return trouve;
    }
  }
  return "";
}

function liste(value) {
  return Array.isArray(value) ? value : (value == null ? [] : [value]);
}

function lire(object, cles) {
  for (const cle of cles) {
    if (object && object[cle] != null) return object[cle];
  }
  return null;
}

function texte(value) {
  return valeur(value).replace(/\s+/g, " ").trim();
}

function texteNormalise(value) {
  return texte(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function date(value) {
  const brute = valeur(value);
  if (!brute) return null;
  const resultat = Date.parse(brute);
  return Number.isFinite(resultat) ? resultat : null;
}

function horaire(value) {
  const s = valeur(value).trim();
  const match = s.match(/(?:T|^)(\d{1,2}:\d{2})(?::\d{2})?/);
  return match ? match[1].padStart(5, "0") : "";
}

function jours(value) {
  const correspondances = {
    monday:"mo", mardi:"tu", tuesday:"tu", wednesday:"we", mercredi:"we",
    thursday:"th", jeudi:"th", friday:"fr", vendredi:"fr", saturday:"sa",
    samedi:"sa", sunday:"su", dimanche:"su",
  };
  const trouves = liste(value).map((jour) => {
    const cle = texteNormalise(jour).split(/[\/#]/).pop();
    return correspondances[cle] || "";
  }).filter(Boolean);
  return [...new Set(trouves)];
}

/* Sous-ensemble prudent de schema:OpeningHoursSpecification → opening_hours.
   Une règle ambiguë n'est jamais inventée : on la laisse inconnue plutôt que
   d'affirmer qu'un lieu est ouvert. */
function horairesOsm(specifications) {
  const lignes = [];
  for (const spec of liste(specifications)) {
    if (!spec || typeof spec !== "object") continue;
    const ouvre = horaire(lire(spec, ["opens", "startTime", "openingTime", "schema:opens", "schema:startTime"]));
    const ferme = horaire(lire(spec, ["closes", "endTime", "closingTime", "schema:closes", "schema:endTime"]));
    const joursSemaine = jours(lire(spec, ["dayOfWeek", "schema:dayOfWeek"]));
    if (!ouvre || !ferme || !joursSemaine.length) continue;
    lignes.push(joursSemaine.join(",") + " " + ouvre + "-" + ferme);
  }
  return [...new Set(lignes)].join("; ");
}

function coordonnees(poi) {
  const lieuBrut = lire(poi, ["isLocatedAt", "location", "locatedAt"]);
  const lieu = liste(lieuBrut).find((item) => item && typeof item === "object") || {};
  const geoBrut = lire(lieu, ["geo", "schema:geo"]) || lire(poi, ["geo", "geometry"]);
  const geo = liste(geoBrut).find((item) => item && typeof item === "object") || {};
  const latitude = nombre(lire(geo, ["latitude", "lat", "schema:latitude"]), 90);
  const longitude = nombre(lire(geo, ["longitude", "lng", "lon", "schema:longitude"]), 180);
  if (latitude != null && longitude != null) return { latitude, longitude, lieu };
  const coordinates = lire(geo, ["coordinates", "geojson"]);
  const tableau = Array.isArray(coordinates) ? coordinates
    : (coordinates && Array.isArray(coordinates.coordinates) ? coordinates.coordinates : null);
  if (!tableau || tableau.length < 2) return null;
  const lng = nombre(tableau[0], 180), lat = nombre(tableau[1], 90);
  return lat == null || lng == null ? null : { latitude:lat, longitude:lng, lieu };
}

function categorie(poi, label, description) {
  const types = liste(poi.type || poi["@type"]).map(texteNormalise).join(" ");
  const mots = texteNormalise([label, description, types].join(" "));
  if (/entertainmentandevent|culturalevent|event|festival|concert|exhibition|manifestation/.test(types)) {
    if (/concert|musique/.test(mots)) return "concert";
    if (/theatre|spectacle|danse/.test(mots)) return "spectacle";
    if (/sport|match|tournoi/.test(mots)) return "sport";
    if (/marche|brocante|vide grenier/.test(mots)) return "marche";
    return "event";
  }
  if (/school|education|educational|lycee|college|university|campus/.test(types) ||
      /\b(lycee|college|ecole|universite|campus)\b/.test(mots)) return "ecole";
  if (/sport|leisure|swimming|stadium|golf|hiking|activity/.test(types)) return "sport";
  if (/culturalsite|heritage|historic|monument|architectural|touristattraction/.test(types)) return "musee";
  if (/market|marche|localproducts/.test(types)) return "marche";
  if (/restaurant|brasserie/.test(mots)) return "resto";
  if (/fast.?food|snack/.test(mots)) return "fastfood";
  if (/cafe|coffee|salon de the/.test(mots)) return "cafe";
  if (/bar|pub/.test(mots)) return "bar";
  if (/cinema/.test(mots)) return "cinema";
  if (/museum|musee/.test(mots)) return "musee";
  if (/library|bibliotheque|mediatheque/.test(mots)) return "biblio";
  if (/park|parc|jardin/.test(mots)) return "parc";
  if (/market|marche/.test(mots)) return "marche";
  if (/hotel|camping|accommodation|hebergement/.test(mots)) return "hebergement";
  if (/shop|boutique|commerce/.test(mots)) return "commerce";
  return "commerce";
}

function imageUrl(value, depth = 0) {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return /^https:\/\//i.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageUrl(item, depth + 1);
      if (url) return url;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const priorite = ["url", "uri", "contentUrl", "schema:contentUrl", "schema:url",
    "resourceLocator", "foaf:depiction", "@id"];
  for (const cle of priorite) {
    const url = imageUrl(value[cle], depth + 1);
    if (url) return url;
  }
  return "";
}

function image(poi) {
  const representationBrute = lire(poi, ["hasMainRepresentation", "mainRepresentation", "image"]);
  return imageUrl(representationBrute);
}

function adresse(lieu) {
  const adresseBrute = lire(lieu, ["address", "schema:address"]);
  const brute = liste(adresseBrute).find((item) => item && typeof item === "object") || {};
  const rue = texte(lire(brute, ["streetAddress", "schema:streetAddress", "addressLine"]));
  const cp = texte(lire(brute, ["postalCode", "schema:postalCode"]));
  const ville = texte(lire(brute, ["addressLocality", "schema:addressLocality", "city"]));
  return { adresse:[rue, cp, ville].filter(Boolean).join(", "), cp:[cp, ville].filter(Boolean).join(" ") };
}

function periode(poi) {
  const periodeBrute = lire(poi, ["takesPlaceAt", "eventSchedule", "schema:eventSchedule"]);
  const periodes = liste(periodeBrute).map((item) => {
    const debut = date(lire(item, ["startDate", "schema:startDate"]));
    const fin = date(lire(item, ["endDate", "schema:endDate"]));
    return { debut, fin };
  }).filter((item) => item.debut != null || item.fin != null);
  if (!periodes.length) return { debut:null, fin:null };
  const maintenant = Date.now();
  const utile = periodes.find((item) => item.fin == null || item.fin >= maintenant)
    || periodes[periodes.length - 1];
  return utile;
}

/* Fonction exportée pour les tests : le contrat entre l'API et Autour reste
   explicitement un POI interne, sans données ni URL sensibles de l'amont. */
export function normaliserDatatourisme(poi) {
  if (!poi || typeof poi !== "object") return null;
  const position = coordonnees(poi);
  const id = texte(lire(poi, ["uuid", "id", "identifier"]));
  const label = texte(lire(poi, ["label", "name", "title"]));
  if (!position || !id || !label) return null;

  const description = texte(lire(poi, ["hasDescription", "description"]));
  const dates = periode(poi);
  if (dates.fin != null && dates.fin < Date.now()) return null;
  const cat = categorie(poi, label, description);
  const permanent = !/event|festival|concert|exhibition|manifestation/.test(
    liste(poi.type || poi["@type"]).map(texteNormalise).join(" ")) && dates.debut == null;
  const lieu = position.lieu || {};
  const openingHours = horairesOsm(lire(lieu, ["openingHoursSpecification", "schema:openingHoursSpecification"]));
  const ou = adresse(lieu);

  return {
    id:"datatourisme:" + id,
    source:"datatourisme",
    cat,
    titre:label,
    description,
    adresse:ou.adresse,
    cp:ou.cp,
    lat:position.latitude,
    lng:position.longitude,
    image:image(poi),
    url:"", // une fiche Autour ne doit pas rediriger vers une URL fournisseur imprévisible
    par:"DATAtourisme",
    officialOpeningHours:openingHours || null,
    quand: openingHours || "Horaires non renseignés",
    debutLe:permanent ? null : dates.debut,
    finLe:permanent ? null : dates.fin,
    isTemporary:!permanent,
    type:liste(poi.type || poi["@type"]).map(texte).join(" "),
  };
}

function reponse(body, status, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":cacheControl,
      "x-autour-source":"datatourisme",
    },
  });
}

/* Les diagnostics ne contiennent ni URL complète, ni en-tête, ni secret. Ils
   servent à distinguer une configuration manquante, un refus du catalogue et
   une panne réseau dans les journaux Vercel, sans changer le contrat public. */
function diagnostiquer(type, details = {}) {
  console.warn(JSON.stringify({source:"datatourisme", type, ...details}));
}

function nettoyerCache() {
  const maintenant = Date.now();
  for (const [cle, entree] of cache) {
    if (entree.expire <= maintenant || cache.size > CACHE_MAX) cache.delete(cle);
  }
}

export default async function handler(requete) {
  if (requete.method && requete.method !== "GET")
    return reponse({items:[]}, 405, "public, max-age=60");
  const url = new URL(requete.url);
  const lat = nombre(url.searchParams.get("lat"), 90);
  const lng = nombre(url.searchParams.get("lng"), 180);
  if (lat == null || lng == null) return reponse({items:[]}, 400, "public, max-age=60");

  // ~1,1 km : un petit déplacement garde la même entrée CDN et mémoire.
  const rLat = lat.toFixed(2), rLng = lng.toFixed(2);
  const cle = rLat + "," + rLng;
  nettoyerCache();
  const trouve = cache.get(cle);
  if (trouve && trouve.expire > Date.now())
    return reponse({items:trouve.items}, 200, "public, s-maxage=600, stale-while-revalidate=86400");

  const cleApi = typeof process !== "undefined" && process.env
    ? process.env.DATATOURISME_API_KEY : "";
  if (!cleApi) {
    diagnostiquer("environment_missing");
    return reponse({items:[]}, 503, "public, max-age=60");
  }

  const params = new URLSearchParams({
    geo_distance:rLat + "," + rLng + "," + RAYON,
    page_size:String(LIMITE), lang:"fr",
    // Chaque champ est demandé explicitement : pas de réponse brute inutile.
    fields:"uuid,label,type,isLocatedAt.geo,isLocatedAt.address,isLocatedAt.openingHoursSpecification,hasDescription,hasMainRepresentation,hasMainRepresentation.url,hasMainRepresentation.uri,hasMainRepresentation.contentUrl,hasMainRepresentation.resourceLocator,takesPlaceAt",
  });
  let resultat;
  try {
    const arret = AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined;
    resultat = await fetch(CATALOGUE + "?" + params.toString(), {
      headers:{"x-api-key":cleApi, accept:"application/json"}, signal:arret,
    });
  } catch (erreur) {
    diagnostiquer("network_error", {
      name:erreur && erreur.name ? erreur.name : "Error",
      code:erreur && erreur.cause && erreur.cause.code ? erreur.cause.code : null,
    });
    return reponse({items:[]}, 503, "public, max-age=60");
  }
  if (!resultat.ok) {
    diagnostiquer("upstream_http", {status:resultat.status});
    return reponse({items:[]}, 503, "public, max-age=60");
  }
  try {
    const json = await resultat.json();
    const items = (Array.isArray(json && json.objects) ? json.objects : [])
      .map(normaliserDatatourisme).filter(Boolean).slice(0, LIMITE);
    cache.set(cle, {items, expire:Date.now() + CACHE_MS});
    return reponse({items}, 200, "public, s-maxage=600, stale-while-revalidate=86400");
  } catch (erreur) {
    diagnostiquer("payload_error", {name:erreur && erreur.name ? erreur.name : "Error"});
    return reponse({items:[]}, 503, "public, max-age=60");
  }
}
