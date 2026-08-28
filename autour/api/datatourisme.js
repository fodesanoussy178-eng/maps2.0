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

/* ===========================================================================
   CE QUE C'EST, PUIS OÙ ÇA SE PASSE

   CE QUI SE PASSAIT, ET CE QUE ÇA COÛTAIT

   Cette fonction collait le libellé, la description et les types dans une
   seule chaîne, puis y cherchait des motifs en SOUS-CHAÎNE, un par un, dans
   l'ordre du fichier. Trois conséquences, toutes constatées en production :

     · « pub » vit dans « ouvert au public ». « Visite privée de l'exposition
       Le Liban de Serge Najjar » sortait donc en BARS ;
     · « bar » vit dans « Barbieux ». Le parc Barbieux, à Roubaix, sortait
       en BARS ;
     · « marche » vit dans « démarches », « parc » dans « parcours », et un
       seul mot croisé au fond d'une description suffisait à décider — « une
       halte à la brasserie » faisait d'une visite patrimoniale un
       RESTAURANT.

   LA RÈGLE, DÉSORMAIS

   1. Aucun mot n'est jamais cherché en sous-chaîne. On lit des MOTS, bornés.
   2. On détermine d'abord la NATURE DE L'ACTIVITÉ — titre, description et
      type d'événement pris ensemble. Une visite, une exposition, un parcours
      patrimonial sont des activités, et c'est leur THÈME qui décide.
   3. Le type de lieu ne se demande qu'ENSUITE, et seulement s'il n'y a pas
      d'activité. Un type déclaré par la source fait autorité ; le titre vient
      après ; la description ne décide jamais seule de ce qu'est un
      établissement — elle le mentionne, elle ne le définit pas.

   Conséquence directe, et c'est le contrat : « visite de lieux patrimoniaux »
   reste du patrimoine même si le texte contient « brasserie », et « Visite
   privée de l'exposition Le Liban de Serge Najjar » est de la culture, jamais
   un bar.
   ======================================================================== */

/* Le texte, réduit à des mots séparés par une espace : c'est ce qui rend
   `\b` fiable et ce qui interdit définitivement la sous-chaîne. */
function mots(valeur) {
  return " " + texteNormalise(valeur).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

/* Un terme peut être une expression ; le pluriel français est toléré, rien
   d'autre. Le motif est ancré des deux côtés.

   LE PLURIEL EN -AUX NE S'OBTIENT PAS EN AJOUTANT UNE LETTRE. « patrimonial »
   donne « patrimoniaux », et le suffixe `e?s?` ne le voyait pas : « visite de
   lieux patrimoniaux » — l'exemple même de cet audit — retombait sur
   « Événement » dès que la description ne contenait aucun autre mot culturel.
   « patrimoniales » passait, « patrimoniaux » non. */
function motif(terme) {
  const radical = /al$/.test(terme) ? terme.slice(0, -2) + "a(?:l|ux)" : terme;
  return new RegExp("(?:^| )" + radical + "e?s?(?= |$)");
}

function dit(texteMots, termes) {
  return termes.some((terme) => motif(terme).test(texteMots));
}

/* ---- 1. La nature de l'activité ------------------------------------------
   Ce qu'on VIENT FAIRE. Une activité n'est pas un établissement : elle a lieu
   quelque part, et l'endroit qui l'héberge ne la définit pas. */
const ACTIVITES = ["visite", "visite guidee", "visite libre", "exposition", "expo",
  "vernissage", "parcours", "circuit", "balade", "promenade guidee", "randonnee",
  "atelier", "conference", "rencontre", "lecture", "projection", "seance",
  "spectacle", "representation", "concert", "recital", "festival", "animation",
  "decouverte", "initiation", "degustation", "stage", "tournoi", "competition",
  "match", "course", "brocante", "vide grenier", "braderie", "marche de noel",
  "journee du patrimoine", "journees du patrimoine", "portes ouvertes"];

/* ---- Le thème d'une activité, dans l'ordre où il tranche ------------------
   Le patrimoine et l'exposition passent en tête : ce sont eux que les mots de
   décor — une brasserie citée dans un itinéraire, un café mentionné à
   l'arrivée — faisaient perdre. */
const THEMES = [
  ["musee", ["exposition", "expo", "vernissage", "patrimoine", "patrimonial",
             "monument", "monumental", "musee", "galerie", "collection",
             "oeuvre", "art", "artistique", "peinture", "sculpture",
             "photographie", "histoire", "historique", "archeologie",
             "architecture", "chateau", "abbaye", "cathedrale", "beffroi"]],
  ["cinema",    ["cinema", "film", "projection", "court metrage", "long metrage"]],
  ["concert",   ["concert", "musique", "musical", "recital", "chorale",
                 "orchestre", "fanfare", "dj", "jazz", "rock", "chanson"]],
  ["spectacle", ["spectacle", "theatre", "danse", "cirque", "humour",
                 "marionnette", "conte", "opera", "representation"]],
  ["sport",     ["sport", "sportif", "match", "tournoi", "course", "randonnee",
                 "trail", "cyclisme", "natation", "competition"]],
  ["marche",    ["marche", "brocante", "vide grenier", "braderie", "foire",
                 "puces", "marche de noel"]],
  ["food",      ["degustation", "gastronomie", "gastronomique", "culinaire",
                 "food truck", "street food", "banquet", "repas partage"]],
];

/* ---- 2. Le type de lieu --------------------------------------------------
   Cherché dans les types déclarés d'abord, dans le NOM ensuite. Un
   établissement s'annonce par son enseigne ; ce qu'une description raconte
   de lui n'est pas ce qu'il est. */
const LIEUX = [
  ["musee",     ["musee", "museum", "galerie d art", "maison de la culture"]],
  ["biblio",    ["bibliotheque", "mediatheque", "ludotheque"]],
  ["cinema",    ["cinema"]],
  ["spectacle", ["theatre", "salle de spectacle", "opera"]],
  ["concert",   ["salle de concert", "conservatoire"]],
  ["parc",      ["parc", "jardin", "square", "arboretum"]],
  ["marche",    ["marche", "halle", "halles"]],
  ["fastfood",  ["fast food", "snack", "friterie", "kebab", "sandwicherie"]],
  ["cafe",      ["cafe", "coffee shop", "salon de the", "brasserie artisanale"]],
  ["bar",       ["bar", "pub", "taverne", "brasserie bar", "bar a vin", "bar a bieres"]],
  ["resto",     ["restaurant", "brasserie", "auberge", "bistrot", "creperie",
                 "pizzeria", "table"]],
  /* UN HÔTEL QUI NE LOGE PERSONNE.

     « Hôtel de Ville », « Hôtel-Dieu », « Hôtel des Postes », « Hôtel de
     Police » : en français, « hôtel » désigne aussi un bâtiment public. Tous
     sortaient en Hébergement — et dans Aide, cela envoyait quelqu'un qui
     cherche à dormir vers la mairie. Le nom de tête décide : à position égale,
     `lieuDe` retient le terme le plus long, donc « hotel de ville » l'emporte
     sur « hotel ». */
  ["mairie", ["hotel de ville", "hotel du departement", "hotel de region",
              "hotel de police", "hotel des postes", "hotel de la prefecture",
              "hotel des impots"]],
  ["sante", ["hotel dieu"]],
  ["hebergement", ["hotel", "camping", "gite", "chambre d hotes", "auberge de jeunesse",
                   "hebergement", "residence de tourisme"]],
  ["commerce",  ["boutique", "magasin", "commerce", "librairie", "epicerie"]],
];

function themeDe(texteMots) {
  for (const [cat, termes] of THEMES) if (dit(texteMots, termes)) return cat;
  return null;
}

/* LE NOM COMMENCE PAR CE QUE LA CHOSE EST.

   « Brasserie du Théâtre » est une brasserie ; « Théâtre de la Brasserie »
   est un théâtre. Un ordre de liste ne sait pas faire la différence — il
   rendrait le même verdict aux deux — alors que la langue, elle, le dit :
   le nom de tête vient en premier. On retient donc le terme qui apparaît le
   plus tôt dans l'enseigne, et le plus précis à position égale. */
function lieuDe(texteMots) {
  let meilleur = null;
  for (const [cat, termes] of LIEUX) {
    for (const terme of termes) {
      const trouve = motif(terme).exec(texteMots);
      if (!trouve) continue;
      const position = trouve.index;
      if (!meilleur || position < meilleur.position ||
          (position === meilleur.position && terme.length > meilleur.longueur))
        meilleur = {cat, position, longueur:terme.length};
    }
  }
  return meilleur ? meilleur.cat : null;
}

function categorie(poi, label, description) {
  const types = texteNormalise(liste(poi.type || poi["@type"]).join(" "));
  const typesMots = mots(types);
  const titreMots = mots(label);
  const descriptionMots = mots(description);
  /* Le tout, pour la seule question qui a besoin du tout : de quoi parle-t-on.
     Aucune décision de type de LIEU ne lit cette chaîne-là. */
  const toutMots = mots([label, description, types].join(" "));

  /* Les types scolaires font autorité et n'ont pas de thème : un lycée n'est
     pas une exposition parce qu'il en accueille une. */
  if (/school|education|educational|university|campus/.test(types) ||
      dit(titreMots, ["lycee", "college", "ecole", "universite", "campus", "groupe scolaire"]))
    return "ecole";

  /* --- 1. La nature de l'activité --------------------------------------- */
  /* Un type d'événement déclaré, ou une activité NOMMÉE DANS LE TITRE. Un mot
     d'activité croisé dans une description ne suffit pas : « cave et
     dégustation » décrit ce qu'on fait chez un caviste, ça n'en fait pas une
     dégustation itinérante. */
  const typeEvenement = /entertainmentandevent|culturalevent|sportsevent|businessevent|event|festival|exhibition|manifestation|showevent/
    .test(types);
  const theme = (texte) => themeDe(texte);
  if (typeEvenement || dit(titreMots, ACTIVITES)) {
    /* Le titre décide en premier : c'est lui qui nomme l'activité. La
       description ne sert qu'à défaut, et les types en dernier recours. */
    return theme(titreMots) || theme(descriptionMots) || theme(typesMots) || "event";
  }

  /* --- 2. Le type de lieu ------------------------------------------------ */
  /* Les types déclarés par le catalogue font autorité : la source a déjà
     répondu, on ne la corrige pas avec de la prose. */
  if (/culturalsite|heritage|historic|monument|architectural|touristattraction|museum/.test(types))
    return "musee";
  if (/sport|leisure|swimming|stadium|golf|hiking|activity/.test(types)) return "sport";
  if (/market|localproducts/.test(types)) return "marche";
  if (/foodestablishment|restaurant/.test(types)) return "resto";
  if (/accommodation|campground|hotel|lodgingbusiness/.test(types)) return "hebergement";
  if (/store|shop|retail/.test(types)) return "commerce";
  if (/park|garden/.test(types)) return "parc";

  /* Puis l'enseigne, par son nom de tête. */
  const lieu = lieuDe(titreMots);
  if (lieu) return lieu;

  /* L'activité annoncée par la seule description : elle passe APRÈS
     l'enseigne, jamais avant. */
  if (dit(descriptionMots, ACTIVITES))
    return theme(descriptionMots) || theme(toutMots) || "event";

  /* En dernier recours, et uniquement pour un thème net — la description ne
     peut plus produire « bar » ni « restaurant » à elle seule. */
  const dernier = theme(toutMots);
  if (dernier === "musee" || dernier === "parc") return dernier;

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

function texteLicence(value, depth = 0) {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => texteLicence(item, depth + 1)).join(" ");
  if (typeof value !== "object") return "";
  return ["license", "licence", "rights", "dc:rights", "schema:license", "schema:copyrightNotice"]
    .map((cle) => texteLicence(value[cle], depth + 1)).join(" ");
}

function imageAutorisee(representation) {
  const licence = texteLicence(representation);
  // Une représentation sans droit explicite peut être une image tierce : elle
  // reste dans le catalogue mais ne quitte jamais le serveur DATAtourisme.
  if (!/(creativecommons\.org|\bcc[- ]?by\b|\bcc0\b|public[ -]domain|open[ -]data|etalab|odbl)/i.test(licence)) return "";
  return imageUrl(representation);
}

function image(poi) {
  const representationBrute = lire(poi, ["hasMainRepresentation", "mainRepresentation", "image"]);
  return imageAutorisee(representationBrute);
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

  const imagePoi = image(poi);
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
    image:imagePoi,
    imageSource:imagePoi ? "datatourisme_licence" : "",
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
    fields:"uuid,label,type,isLocatedAt.geo,isLocatedAt.address,isLocatedAt.openingHoursSpecification,hasDescription,hasMainRepresentation,hasMainRepresentation.url,hasMainRepresentation.uri,hasMainRepresentation.contentUrl,hasMainRepresentation.resourceLocator,hasMainRepresentation.license,hasMainRepresentation.licence,hasMainRepresentation.rights,hasMainRepresentation.dc:rights,takesPlaceAt",
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
