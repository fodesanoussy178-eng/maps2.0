/* ===========================================================================
   « À LILLE », « À TOURCOING », « PRÈS DE MOI »

   ChatGPT transmet ce que la personne a écrit : un nom de ville, parfois des
   coordonnées, parfois rien. Ce fichier traduit cela en un point et une zone
   Autour, et il le fait dans cet ordre :

     1. LES CINQ ZONES PRODUIT (`zones-autonomes.js`). C'est le registre que le
        client met dans chaque donnée et chaque cache ; `evenements_locaux` et
        `lieux_explorer` en ont besoin. Hors de ces zones, Autour n'a ni
        programmation ni données, et le dire est plus utile que de chercher.
     2. LES COMMUNES DÉJÀ PRÉCALCULÉES (`data/aide-precalcule-villes.js`) :
        Lille, Tourcoing, Paris, Rennes, Angers, avec leur centre et leur code
        INSEE. Zéro appel réseau pour les villes que le produit sert vraiment.
     3. LA BASE ADRESSE NATIONALE, et seulement en dernier recours : un appel,
        borné à trois secondes, mis en mémoire. Elle fait autorité sur ce qui
        est une commune française ; nous ne devinons pas à sa place.

   CE FICHIER NE GÉOCODE PAS UNE ADRESSE PRÉCISE. Le MCP répond à « autour de
   quelle ville », pas « au 12 rue des Lilas » : une intégration conversationnelle
   qui géocoderait des adresses complètes collecterait une précision dont elle
   n'a aucun usage.
   ======================================================================== */

import precalcule from "../data/aide-precalcule-villes.js";
import { moteurs } from "./moteurs.mjs";

const BAN = "https://api-adresse.data.gouv.fr/search/";
const cacheBan = new Map();

const COMMUNES = Object.freeze(Object.entries(precalcule).map(([insee, zone]) => Object.freeze({
  nom: String(zone.nom || ""), insee, lat: Number(zone.lat), lng: Number(zone.lng),
})).filter((c) => c.nom && Number.isFinite(c.lat) && Number.isFinite(c.lng)));

function sansAccents(valeur) {
  return String(valeur || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function zoneDe(lat, lng) {
  const { ZONES } = await moteurs();
  return ZONES.zoneIdForPoint([lat, lng]);
}

async function point(nom, lat, lng, insee, source) {
  const zoneId = await zoneDe(lat, lng);
  const { ZONES } = await moteurs();
  return {
    nom, lat, lng, insee: insee || null, zoneId,
    zoneLabel: zoneId ? ZONES.label(zoneId) : null,
    couvert: !!zoneId,
    source,
  };
}

/* Une zone produit répond aussi à son nom de ville : « Lille » EST la
   métropole lilloise, et c'est le centre de la zone qu'il faut viser. */
async function parZone(texte) {
  const { ZONES } = await moteurs();
  const cible = sansAccents(texte);
  for (const def of ZONES.DEFINITIONS || []) {
    if (sansAccents(def.city) === cible || sansAccents(def.label) === cible || def.id === cible)
      return point(def.city, def.lat, def.lng, null, "zone_produit");
  }
  return null;
}

function parCommune(texte) {
  const cible = sansAccents(texte);
  const trouvee = COMMUNES.find((c) => sansAccents(c.nom) === cible);
  return trouvee ? point(trouvee.nom, trouvee.lat, trouvee.lng, trouvee.insee, "commune_precalculee") : null;
}

async function parBan(texte) {
  const cle = sansAccents(texte);
  if (!cle) return null;
  if (cacheBan.has(cle)) return cacheBan.get(cle);
  try {
    const url = BAN + "?q=" + encodeURIComponent(texte) + "&type=municipality&limit=1";
    const reponse = await fetch(url, { headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3000) });
    if (!reponse.ok) return null;
    const json = await reponse.json();
    const f = (json && json.features || [])[0];
    const coords = f && f.geometry && f.geometry.coordinates;
    if (!coords) { cacheBan.set(cle, null); return null; }
    const resolu = await point(String(f.properties && (f.properties.city || f.properties.name) || texte),
      Number(coords[1]), Number(coords[0]),
      (f.properties && f.properties.citycode) || null, "base_adresse_nationale");
    cacheBan.set(cle, resolu);
    return resolu;
  } catch (e) { return null; }
}

/* `lat`/`lng` fournis gagnent toujours : ils viennent de l'appareil de la
   personne, et aucune recherche de nom ne peut être plus juste que cela. */
export async function resoudre({ location, lat, lng } = {}) {
  const latitude = Number(lat), longitude = Number(lng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    const p = await point(String(location || "").trim() || null, latitude, longitude, null, "coordonnees");
    if (!p.nom) p.nom = p.zoneLabel;
    return p;
  }
  const texte = String(location || "").trim();
  if (!texte) return null;
  return (await parZone(texte)) || parCommune(texte) || (await parBan(texte));
}

export const VILLES_PRECALCULEES = COMMUNES;
export { sansAccents };
