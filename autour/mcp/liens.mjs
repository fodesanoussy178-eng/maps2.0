/* ===========================================================================
   LES LIENS DE RETOUR — CHATGPT DÉCOUVRE, AUTOUR FAIT LE RESTE

   Le partage l'a déjà tranché une fois : un lien Autour est un CHEMIN, pas un
   fragment (`docs/partage-og.md`). `#l=…` n'était jamais envoyé au serveur,
   donc aucune plateforme n'en tirait un titre. Les liens de ChatGPT suivent la
   même règle, et ajoutent deux routes que le produit n'avait pas :

     /event/<id>       la fiche d'un événement
     /place/<id>       la fiche d'un lieu
     /explorer?q=…     la recherche Autour, déjà écrite
     /solidarite?besoin=…  l'écran Solidarité, déjà ouvert sur le bon besoin

   POURQUOI PAS LA PAGE D'ACCUEIL. Une réponse qui vaut un clic mérite une
   destination : quelqu'un qui demande « une brocante à Tourcoing dimanche » et
   atterrit sur la carte de sa ville doit refaire tout le travail. Chaque lien
   porte donc ce qu'il faut pour rouvrir la MÊME vue : le point, la ville, la
   requête, la période.

   LA MESURE, ET SA LIMITE. `utm_source=chatgpt` et `utm_medium=app` disent
   d'où vient la visite ; `utm_campaign` dit QUEL OUTIL l'a produite, et
   `utm_content` la catégorie ou le besoin demandé. Rien d'autre ne passe dans
   l'URL : pas d'identifiant de conversation, pas de phrase de l'utilisateur,
   pas de position précise. On mesure des volumes par type de recherche, ce que
   le chantier demande, et on ne peut pas remonter à une personne.
   ======================================================================== */

const BASE_DEFAUT = "https://autour.eu";

export const UTM = Object.freeze({ source: "chatgpt", medium: "app" });

function base() {
  const env = (typeof process !== "undefined" && process.env) || {};
  return String(env.AUTOUR_BASE_URL || BASE_DEFAUT).replace(/\/$/, "");
}

export function slug(texte) {
  return String(texte || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/* Cinq décimales : onze mètres. Assez pour rouvrir la même vue, trop peu pour
   décrire où se tient quelqu'un. */
function coord(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? n.toFixed(5) : null;
}

function composer(chemin, params, { campagne, contenu } = {}) {
  const url = new URL(base() + chemin);
  for (const [cle, valeur] of Object.entries(params || {})) {
    if (valeur == null || valeur === "") continue;
    url.searchParams.set(cle, String(valeur));
  }
  url.searchParams.set("utm_source", UTM.source);
  url.searchParams.set("utm_medium", UTM.medium);
  if (campagne) url.searchParams.set("utm_campaign", String(campagne));
  if (contenu) url.searchParams.set("utm_content", String(contenu).slice(0, 40));
  return url.toString();
}

export function lienEvenement(id, { titre, campagne = "event", contenu } = {}) {
  const morceau = slug(titre);
  return composer("/event/" + encodeURIComponent(id) + (morceau ? "/" + morceau : ""),
    {}, { campagne, contenu });
}

export function lienLieu(id, { titre, lat, lng, campagne = "place", contenu } = {}) {
  const morceau = slug(titre);
  return composer("/place/" + encodeURIComponent(id) + (morceau ? "/" + morceau : ""),
    { lat: coord(lat), lng: coord(lng) }, { campagne, contenu });
}

export function lienExplorer({ q, ville, lat, lng, quand, campagne = "explorer", contenu } = {}) {
  return composer("/explorer", { q, ville, quand, lat: coord(lat), lng: coord(lng) },
    { campagne, contenu });
}

export function lienSolidarite({ besoin, ville, lat, lng, campagne = "solidarite", contenu } = {}) {
  return composer("/solidarite", { besoin, ville, lat: coord(lat), lng: coord(lng) },
    { campagne, contenu });
}

/* ---- LES APPELS À L'ACTION ---------------------------------------------
   Un libellé doit dire EXACTEMENT où il mène, et ne promettre que ce
   qu'Autour ajoute vraiment : la carte, l'itinéraire, les autres résultats,
   les favoris. « Ouvrir dans Autour » sur un lien qui ouvre la liste des
   aides serait déjà une petite tromperie. */
export const CTA = Object.freeze({
  evenement: "Voir la fiche dans Autour",
  lieu: "Voir sur la carte dans Autour",
  explorer: "Voir tous les résultats dans Autour",
  solidarite: "Voir les aides autour de moi dans Autour",
});
