/* ===========================================================================
   Fabrique les jeux de démarrage par zone

   Ce que ça produit : `zones/<lat>,<lng>.json`, un fichier par carré de 0,1°
   (environ une agglomération), contenant les lieux du centre de la zone sous
   la forme que l'application sait fusionner directement.

   À quoi ça sert : au TOUT premier démarrage, sur un téléphone qui n'a rien en
   mémoire, c'est la seule source qui ne dépende ni d'Overpass, ni de
   Nominatim, ni d'une permission de géolocalisation. Le fichier est servi
   comme un statique par le CDN : une requête vers notre propre origine, et
   l'écran a ses cinq propositions.

   Quand le relancer : ces données vieillissent lentement (un commerce ouvre,
   un autre ferme). Une fois par mois suffit largement, et rien ne casse si on
   l'oublie — le fichier reste valable, et les sources fraîches le remplacent
   silencieusement à chaque ouverture.

   Usage :
     node outils/zones.mjs                      # les villes de villes.json
     node outils/zones.mjs 50.7176,3.1611       # une zone précise
     node outils/zones.mjs --liste mes-villes.json

   Ce script a besoin d'un accès réseau à Overpass. Il n'invente rien : si une
   zone ne rend aucun lieu, aucun fichier n'est écrit pour elle.
   ======================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..");
const SORTIE = join(RACINE, "zones");

const SERVEURS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

/* Les mêmes clés que l'application demande au démarrage. Volontairement
   restreint : ce fichier sert à remplir cinq lignes, pas à embarquer une
   ville entière dans le CDN. */
const REQUETES = [
  ["amenity", "restaurant|fast_food|cafe|bar|pub|ice_cream|marketplace|cinema|theatre|library|arts_centre|community_centre"],
  ["shop", "bakery|pastry|greengrocer|butcher|clothes|second_hand|books|convenience"],
  ["leisure", "park|garden|pitch|sports_centre|playground"],
  ["tourism", "museum|gallery|artwork|viewpoint"],
];

const CATEGORIE = {
  restaurant:"resto", fast_food:"fastfood", cafe:"cafe", bar:"bar", pub:"bar",
  ice_cream:"cafe", marketplace:"marche", cinema:"cinema", theatre:"spectacle",
  library:"biblio", arts_centre:"musee", community_centre:"asso",
  bakery:"cafe", pastry:"cafe", greengrocer:"commerce", butcher:"commerce",
  clothes:"commerce", second_hand:"friperie", books:"commerce", convenience:"commerce",
  park:"parc", garden:"parc", pitch:"terrain", sports_centre:"sport", playground:"playground",
  museum:"musee", gallery:"musee", artwork:"musee", viewpoint:"parc",
};

const RAYON_M = 1200;
const PLAFOND = 60;                 // de quoi classer, pas de quoi tout charger
const ATTENTE_ENTRE_ZONES = 4000;   // on reste poli avec les instances publiques

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function requete(lat, lng) {
  const bloc = REQUETES
    .map(([cle, valeurs]) => `nwr(around:${RAYON_M},${lat},${lng})["${cle}"~"^(${valeurs})$"];`)
    .join("");
  return `[out:json][timeout:60];(${bloc});out center ${PLAFOND};`;
}

async function interroger(lat, lng) {
  for (const serveur of SERVEURS) {
    try {
      const r = await fetch(serveur, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(requete(lat, lng)),
      });
      if (!r.ok) { console.warn("  ", serveur, "→ HTTP", r.status); continue; }
      const j = await r.json();
      if (j && Array.isArray(j.elements)) return j.elements;
    } catch (e) { console.warn("  ", serveur, "→", e.message); }
  }
  return null;
}

/* La forme exacte que `fusionner()` sait absorber. On ne garde que ce qui sert
   à dessiner une carte et à la reclasser : pas de description, pas de
   géométrie, pas de tags décoratifs. Un fichier de zone doit rester petit —
   c'est tout son intérêt. */
function versLieu(e) {
  const t = e.tags || {};
  const p = e.center || e;
  if (!p.lat || !p.lon || !t.name) return null;      // sans nom, aucun intérêt
  const type = t.amenity || t.shop || t.leisure || t.tourism || "";
  const cat = CATEGORIE[type];
  if (!cat) return null;
  const tags = {};
  for (const k of ["opening_hours","internet_access","outdoor_seating","wheelchair",
                   "fee","cuisine","phone","website","access","playground"])
    if (t[k]) tags[k] = t[k];
  return {
    id: "osm" + e.type + e.id, cat, titre: t.name,
    adresse: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || t.name,
    cp: [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" "),
    lat: p.lat, lng: p.lon,
    quand: t.opening_hours || "Voir sur place",
    cuisine: t.cuisine || "",
    gratuit: t.fee !== "yes", prix: t.fee === "yes" ? 6 : 0,
    pmr: t.wheelchair === "yes" ? true : undefined,
    par: "OpenStreetMap", tags,
  };
}

async function fabriquer(lat, lng, nom) {
  const cle = lat.toFixed(1) + "," + lng.toFixed(1);
  process.stdout.write("zone " + cle + (nom ? " (" + nom + ")" : "") + " … ");
  const elements = await interroger(lat, lng);
  if (!elements) { console.log("aucune réponse — zone ignorée"); return false; }
  const lieux = elements.map(versLieu).filter(Boolean);
  if (!lieux.length) { console.log("aucun lieu exploitable — zone ignorée"); return false; }
  mkdirSync(SORTIE, { recursive: true });
  const fichier = join(SORTIE, cle + ".json");
  writeFileSync(fichier, JSON.stringify({
    zone: cle, centre: [Number(lat.toFixed(4)), Number(lng.toFixed(4))],
    nom: nom || "", genere_le: new Date().toISOString(),
    source: "OpenStreetMap via Overpass", lieux,
  }));
  console.log(lieux.length + " lieux");
  return true;
}

const args = process.argv.slice(2);
let cibles = [];

const iListe = args.indexOf("--liste");
if (iListe >= 0 && args[iListe + 1]) {
  cibles = JSON.parse(readFileSync(args[iListe + 1], "utf8"));
} else if (args[0] && /^-?\d/.test(args[0])) {
  const [lat, lng] = args[0].split(",").map(Number);
  cibles = [{ lat, lng }];
} else {
  const parDefaut = join(ICI, "villes.json");
  if (!existsSync(parDefaut)) {
    console.error("Aucune liste de villes. Donne une coordonnée, ou crée outils/villes.json.");
    process.exit(1);
  }
  cibles = JSON.parse(readFileSync(parDefaut, "utf8"));
}

let faites = 0;
for (const [i, c] of cibles.entries()) {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
  if (await fabriquer(c.lat, c.lng, c.nom)) faites += 1;
  if (i < cibles.length - 1) await attendre(ATTENTE_ENTRE_ZONES);
}
console.log("\n" + faites + " zone(s) écrite(s) dans " + SORTIE);
if (!faites) process.exit(2);
