/* ===========================================================================
   La position approximative, demandable au lieu d'être seulement déposée

   CE QUI EXISTAIT DÉJÀ, ET POURQUOI ÇA NE SUFFIT PAS

   `middleware.js` dépose la ville approximative dans un cookie `autour_geo`,
   sur la réponse qui porte `index.html`. C'est le chemin le plus rapide — zéro
   aller-retour — et il reste le chemin principal : cette route ne le remplace
   pas.

   Mais un cookie peut ne pas être là. Le document peut venir d'un cache
   (navigation arrière, Service Worker, préchargement), le navigateur peut
   refuser les cookies, et Safari raccourcit la vie de ceux qui sont posés par
   un script. Dans ces cas-là, `positionServeur()` rendait `null` et le premier
   visiteur retombait sur « on ne sait pas où tu es » alors que le serveur, lui,
   le savait toujours.

   Cette route est donc le SECOND chemin vers la même information : le client
   ne l'appelle que quand le cookie manque.

   CE QU'ELLE RENVOIE, ET RIEN DE PLUS

   Deux nombres, un nom de ville, un pays. Pas d'adresse IP, pas
   d'identifiant, pas d'en-tête recopié, aucune journalisation. Les
   coordonnées sont arrondies à quatre décimales — soit une centaine de
   mètres, déjà plus fin que ne l'est la géolocalisation par IP elle-même.

   ELLE NE RÉSOUT AUCUNE ZONE, ET C'EST VOLONTAIRE

   Autour a déjà un moteur géographique : `zones-autonomes.js` côté client,
   `autour_zones` en base. En dupliquer la liste ici en ferait un second, qui
   divergerait au premier ajout de ville. Cette route rend donc un point, et
   c'est le client qui demande à `AutourZones` de quelle zone il relève — ou
   d'aucune.
   ======================================================================== */

export const config = { runtime: "edge" };

function nombre(valeur, max) {
  if (valeur == null || String(valeur).trim() === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

export default function handler(requete) {
  const h = requete.headers;
  const lat = nombre(h.get("x-vercel-ip-latitude"), 90);
  const lng = nombre(h.get("x-vercel-ip-longitude"), 180);

  /* La réponse dépend de qui demande : elle ne doit jamais être mise en cache
     par un intermédiaire, sinon le quartier d'une personne serait servi à la
     suivante. */
  const entetes = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
  };

  /* Aucune position fiable : on le dit, plutôt que de rendre un point inventé.
     200 et non 404 — l'absence d'en-tête est un cas NORMAL (développement
     local, en-têtes filtrés), pas une erreur que le client doit journaliser. */
  if (lat == null || lng == null)
    return new Response(JSON.stringify({ disponible: false }), { headers: entetes });

  let ville = "";
  // le nom arrive encodé (« Saint-Étienne » → « Saint-%C3%89tienne »)
  try { ville = decodeURIComponent(h.get("x-vercel-ip-city") || ""); } catch (e) { ville = ""; }

  return new Response(JSON.stringify({
    disponible: true,
    lat: Math.round(lat * 1e4) / 1e4,
    lng: Math.round(lng * 1e4) / 1e4,
    ville,
    pays: h.get("x-vercel-ip-country") || "",
    precision: "ville",
  }), { headers: entetes });
}
