/* ===========================================================================
   Fabrique les jeux de démarrage par zone

   Ce que ça produit : `zones/<lat>,<lng>.json`, un fichier par tuile de 0,1°
   — la clé exacte que le client calcule (`lat.toFixed(1)`), pour qu'une seule
   requête suffise à la trouver, sans index à télécharger d'abord.

   À quoi ça sert : au TOUT premier démarrage, sur un téléphone qui n'a rien en
   mémoire, c'est la seule source qui ne dépende ni d'Overpass, ni de
   Nominatim, ni d'une permission de géolocalisation. Le fichier est servi
   comme un statique par le CDN : une requête vers notre propre origine, et
   l'écran a ses cinq propositions.

   Une tuile de 0,1° fait environ 11 km sur 7. On ne peut donc pas se contenter
   d'interroger son centre : quelqu'un à l'autre bout n'aurait que des lieux à
   cinq kilomètres, que le classement écarte (rayon 2,5 km). On interroge donc
   la tuile ENTIÈRE d'une seule requête, puis on éclaircit le résultat sur une
   grille pour que la couverture soit régulière au lieu d'être un tas au centre.

   Usage :
     node outils/zones.mjs                      # les villes de villes.json
     node outils/zones.mjs 50.7176,3.1611       # la tuile qui contient ce point
     node outils/zones.mjs --liste mes-villes.json

   Ce script a besoin d'un accès réseau à Overpass. Il n'invente rien : si une
   tuile ne rend aucun lieu exploitable, aucun fichier n'est écrit pour elle.
   ======================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..");
const SORTIE = join(RACINE, "zones");

/* Uniquement des instances qui portent la planète entière. `overpass.osm.ch`
   figurait ici : c'est l'instance SUISSE, elle ne contient que la Suisse. Elle
   répondait donc « zéro objet » en huit dixièmes de seconde à toute requête
   française — une réponse valide, rapide, et complètement fausse. */
const SERVEURS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/* Les mêmes familles que l'application demande au démarrage. Volontairement
   restreint : ce fichier sert à remplir cinq lignes, pas à embarquer une ville
   entière dans le CDN.

   L'AIDE EST ICI DÉLIBÉRÉMENT PRÉSENTE. La première version ne demandait que
   des commerces et des loisirs : sur les 1055 lieux récoltés pour Lille et
   Paris, il n'y avait pas une seule banque alimentaire, pas un hébergement,
   pas un service d'emploi. Or ces zones sont la seule source disponible au
   tout premier démarrage, avant Overpass et avant la géolocalisation —
   c'est-à-dire exactement le moment où quelqu'un qui cherche un foyer ou un
   repas ne peut pas se permettre d'attendre. Ces lieux passent donc en
   premier, et l'éclaircissage ne les touche pas. */
const REQUETES = [
  // -- aide : la raison d'être de ces jeux de données
  ["amenity", "social_facility|food_bank|refugee_site|dormitory"],
  ["social_facility", "food_bank|soup_kitchen|shelter|group_home|homeless_shelter|emergency_shelter|assisted_living|outreach|day_centre|clothing_bank"],
  ["office", "employment_agency|association|ngo|charity"],
  ["healthcare", "centre"],
  // -- le reste
  ["amenity", "restaurant|fast_food|cafe|bar|pub|ice_cream|marketplace|cinema|theatre|library|arts_centre|community_centre|social_centre|hospital|clinic|doctors|pharmacy|townhall"],
  ["shop", "bakery|pastry|greengrocer|butcher|clothes|second_hand|books|convenience|charity"],
  ["leisure", "park|garden|pitch|sports_centre|playground"],
  ["tourism", "museum|gallery|artwork|viewpoint"],
];

const CATEGORIE = {
  // -- aide
  social_facility:"asso", food_bank:"alimentaire", soup_kitchen:"alimentaire",
  refugee_site:"hebergement", dormitory:"hebergement", shelter:"hebergement",
  group_home:"hebergement", homeless_shelter:"hebergement",
  emergency_shelter:"hebergement", assisted_living:"hebergement",
  outreach:"asso", day_centre:"asso", clothing_bank:"asso", social_centre:"asso",
  employment_agency:"emploi", association:"asso", ngo:"asso", charity:"asso",
  hospital:"sante", clinic:"sante", doctors:"sante", pharmacy:"sante", centre:"sante",
  townhall:"mairie",
  // -- le reste
  restaurant:"resto", fast_food:"fastfood", cafe:"cafe", bar:"bar", pub:"bar",
  ice_cream:"cafe", marketplace:"marche", cinema:"cinema", theatre:"spectacle",
  library:"biblio", arts_centre:"musee", community_centre:"asso",
  bakery:"cafe", pastry:"cafe", greengrocer:"commerce", butcher:"commerce",
  clothes:"commerce", second_hand:"friperie", books:"commerce", convenience:"commerce",
  park:"parc", garden:"parc", pitch:"terrain", sports_centre:"sport", playground:"playground",
  museum:"musee", gallery:"musee", artwork:"musee", viewpoint:"parc",
};

/* Les familles d'aide, nommées une seule fois. */
const AIDE = new Set(["alimentaire","hebergement","asso","emploi","sante","mairie"]);

/* Ce que le nom dit d'une structure sociale quand le tag reste vague. Même
   raisonnement que dans l'application (`affinerCategorie`) : les deux doivent
   rester d'accord, sinon la zone pré-calculée range un foyer ailleurs que la
   recherche ne le cherche. */
const NOM_HEBERGEMENT = /foyer|chrs|\bcada\b|\bhuda\b|residence sociale|maison relais|pension de famille|abri de nuit|halte de nuit|hebergement|dortoir|sans[- ]abri/;
const NOM_ALIMENTAIRE = /epicerie solidaire|banque alimentaire|restos? du c(o|oe)ur|soupe populaire|distribution alimentaire|aide alimentaire/;
const sansAccents = (s) =>
  (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const DEMI_TUILE = 0.05;            // une tuile de 0,1° : [k-0,05 ; k+0,05[
const SORTIE_OVERPASS = 700;        // ce qu'on demande à Overpass, borné
const GRILLE = 6;                   // 6×6 cellules pour éclaircir régulièrement
const PAR_CELLULE = 5;
const PLAFOND = 150;                // couvre la tuile ; le client n'en fusionne que le voisinage
/* L'aide échappe à l'éclaircissage, mais pas à toute borne : une tuile du
   centre de Paris ne doit pas remplir le fichier avec ses seules pharmacies.
   Elle garde une part réservée, et confortable. */
const PLAFOND_AIDE = 70;
const ATTENTE_ENTRE_TUILES = Number(process.env.ATTENTE_TUILES || 4000);
/* Soixante-quinze secondes par instance, pas cent quatre-vingts. Une instance
   qui n'a pas répondu en une minute et quart est saturée : insister coûte le
   quadruple du temps pour le même silence, alors que la suivante répondra
   peut-être tout de suite. */
const DELAI_MS = 75000;

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* La clé EXACTE que calcule le client (`cleZoneStatique`). Toute divergence
   ici produirait des fichiers que personne ne demandera jamais. */
const cleTuile = (lat, lng) => lat.toFixed(1) + "," + lng.toFixed(1);

function bornesTuile(cle) {
  const [lat, lng] = cle.split(",").map(Number);
  return { s: lat - DEMI_TUILE, n: lat + DEMI_TUILE,
           o: lng - DEMI_TUILE, e: lng + DEMI_TUILE, lat, lng };
}

/* `nw` et non `nwr`. Une tuile de 0,1° de Paris contient des dizaines de
   milliers d'objets correspondants ; ce qui coûte cher n'est pas ce qu'Overpass
   renvoie — c'est borné par `out center` — mais ce qu'il doit parcourir pour le
   trouver. Les relations sont la partie la plus lourde de ce parcours et
   n'apportent presque aucun commerce : un restaurant est un nœud, un parc est
   un chemin. On les laisse de côté. */
function requete(b) {
  const zone = `(${b.s.toFixed(4)},${b.o.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)})`;
  const bloc = REQUETES
    .map(([cle, valeurs]) => `nw${zone}["${cle}"~"^(${valeurs})$"];`)
    .join("");
  return `[out:json][timeout:70];(${bloc});out center ${SORTIE_OVERPASS};`;
}

/* Chaque tuile commence par une instance différente : douze requêtes de suite
   sur la même l'aurait fait basculer en limitation, et c'est précisément ce
   qu'on cherche à éviter. */
let tourServeur = 0;
async function interroger(b) {
  const ordre = SERVEURS.slice(tourServeur % SERVEURS.length)
    .concat(SERVEURS.slice(0, tourServeur % SERVEURS.length));
  tourServeur += 1;
  for (const serveur of ordre) {
    const debut = Date.now();
    try {
      const r = await fetch(serveur, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded",
                   "user-agent": "Autour/1.0 (https://autour.eu) generation-zones" },
        body: "data=" + encodeURIComponent(requete(b)),
        signal: AbortSignal.timeout(DELAI_MS),
      });
      const duree = ((Date.now() - debut) / 1000).toFixed(1) + " s";
      const nom = serveur.replace(/https:\/\/|\/api.*/g, "");
      if (!r.ok) { console.warn("    ", nom, "→ HTTP", r.status, "après", duree); continue; }
      const j = await r.json();
      if (j && Array.isArray(j.elements)) {
        /* Zéro objet sur une tuile d'agglomération n'est pas une réponse :
           c'est une instance qui ne couvre pas ce territoire, ou qui a tronqué.
           On passe à la suivante plutôt que de conclure qu'il n'y a rien. */
        if (!j.elements.length) {
          console.warn("    ", nom, "→ 0 objet en", duree, "— instance ignorée");
          continue;
        }
        console.log("    ", nom, "→", j.elements.length, "objets en", duree);
        return j.elements;
      }
    } catch (e) {
      console.warn("    ", serveur.replace(/https:\/\/|\/api.*/g, ""), "→", e.message,
        "après", ((Date.now() - debut) / 1000).toFixed(1) + " s");
    }
  }
  return null;
}

/* La forme exacte que `fusionner()` sait absorber. On ne garde que ce qui sert
   à dessiner une carte et à la reclasser : pas de description, pas de
   géométrie, pas de tags décoratifs. Un fichier de zone doit rester petit —
   c'est tout son intérêt. */
const TAGS_UTILES = ["opening_hours","internet_access","outdoor_seating","indoor_seating",
  "wheelchair","fee","cuisine","phone","website","access","playground","power_supply"];

function versLieu(e) {
  const t = e.tags || {};
  const p = e.center || e;
  if (!p.lat || !p.lon || !t.name) return null;      // sans nom, aucun intérêt
  /* `CATEGORIE` est indexée par VALEUR, pas par couple clé/valeur : deux clés
     qui partagent une valeur se confondent. `shelter` en est le cas :
     `social_facility=shelter` est un hébergement d'urgence, `amenity=shelter`
     est un abribus. On écarte donc explicitement les valeurs ambiguës portées
     par la mauvaise clé, avant toute lecture. */
  if (t.amenity === "shelter" && !t.social_facility) return null;
  /* Le sous-tag social passe AVANT `amenity` : `amenity=social_facility` +
     `social_facility=food_bank` est une banque alimentaire, pas une asso.
     Lire `amenity` d'abord aurait rangé toute l'aide dans un même tas. */
  const type = t.social_facility || t.healthcare || t.office
            || t.amenity || t.shop || t.leisure || t.tourism || "";
  let cat = CATEGORIE[type];
  if (!cat) return null;
  /* `amenity=social_facility` sans sous-tag : c'est le nom qui tranche. */
  if (cat === "asso" && t.amenity === "social_facility" && !t.social_facility) {
    const n = sansAccents(t.name);
    if (NOM_ALIMENTAIRE.test(n)) cat = "alimentaire";
    else if (NOM_HEBERGEMENT.test(n)) cat = "hebergement";
  }
  const tags = {};
  for (const k of TAGS_UTILES) if (t[k]) tags[k] = t[k];
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

/* Éclaircir sans concentrer. Overpass rend ce qu'il trouve dans l'ordre de sa
   base : garder les 170 premiers donnerait 170 lieux d'un même quartier. On
   découpe donc la tuile en cellules et on prend les meilleurs de chacune —
   « meilleur » voulant seulement dire ici : celui dont on sait le plus de
   choses, donc celui qu'on saura classer. */
function richesse(l) {
  return Object.keys(l.tags).length
       + (l.adresse && l.adresse !== l.titre ? 2 : 0)
       + (l.quand !== "Voir sur place" ? 3 : 0)
       + (l.cp ? 1 : 0);
}

function eclaircir(lieux, b) {
  /* L'aide ne passe pas par l'éclaircissage. Un quartier a cent restaurants
     et deux banques alimentaires : les répartir « équitablement » par cellule
     revient à laisser tomber l'aide, puisqu'elle perd toujours au nombre.
     Elle est donc gardée en entier et retirée du tirage — ce sont quelques
     dizaines de lieux par tuile, et ce sont ceux qui comptent le plus. */
  const aide = lieux.filter((l) => AIDE.has(l.cat))
    .sort((x, y) => richesse(y) - richesse(x)).slice(0, PLAFOND_AIDE);
  const reste = lieux.filter((l) => !AIDE.has(l.cat));
  const cellules = new Map();
  reste.forEach((l) => {
    const i = Math.min(GRILLE - 1, Math.max(0,
      Math.floor(((l.lat - b.s) / (b.n - b.s)) * GRILLE)));
    const j = Math.min(GRILLE - 1, Math.max(0,
      Math.floor(((l.lng - b.o) / (b.e - b.o)) * GRILLE)));
    const cle = i + ":" + j;
    if (!cellules.has(cle)) cellules.set(cle, []);
    cellules.get(cle).push(l);
  });

  // l'aide d'abord, en entier : le plafond ne s'applique qu'au reste
  const retenus = aide.slice();
  // on fait plusieurs tours : un tour prend le meilleur de chaque cellule, ce
  // qui répartit avant d'approfondir
  for (let tour = 0; tour < PAR_CELLULE && retenus.length < PLAFOND; tour += 1) {
    for (const [, liste] of cellules) {
      if (retenus.length >= PLAFOND) break;
      if (tour === 0) liste.sort((x, y) => richesse(y) - richesse(x));
      if (liste[tour]) retenus.push(liste[tour]);
    }
  }
  // variété : pas cinquante restaurants d'affilée dans le fichier
  const parCat = new Map();
  retenus.forEach((l) => parCat.set(l.cat, (parCat.get(l.cat) || 0) + 1));
  return { retenus, cellules: cellules.size, parCat: Object.fromEntries(parCat) };
}

async function fabriquer(cle, noms) {
  const b = bornesTuile(cle);
  console.log("tuile " + cle + (noms.length ? " (" + noms.join(", ") + ")" : ""));
  const elements = await interroger(b);
  if (!elements) { console.log("    aucune réponse — tuile ignorée\n"); return false; }
  const lieux = elements.map(versLieu).filter(Boolean);
  if (!lieux.length) { console.log("    aucun lieu exploitable — tuile ignorée\n"); return false; }

  const { retenus, cellules, parCat } = eclaircir(lieux, b);
  mkdirSync(SORTIE, { recursive: true });
  writeFileSync(join(SORTIE, cle + ".json"), JSON.stringify({
    zone: cle, centre: [b.lat, b.lng],
    bornes: [Number(b.s.toFixed(4)), Number(b.o.toFixed(4)),
             Number(b.n.toFixed(4)), Number(b.e.toFixed(4))],
    noms, genere_le: new Date().toISOString(),
    source: "OpenStreetMap via Overpass · ODbL",
    lieux: retenus,
  }));
  console.log("    " + lieux.length + " exploitables → " + retenus.length +
    " retenus sur " + cellules + " cellules");
  console.log("    " + Object.entries(parCat).map(([c, n]) => c + ":" + n).join(" ") + "\n");
  return true;
}

/* Le classement est la seule chose testable sans réseau — et c'est aussi la
   seule qui décide si l'aide finit dans le fichier ou non. On l'expose pour
   que `tests/zones.test.mjs` la vérifie, sans lancer la récolte. */
export { versLieu, eclaircir, CATEGORIE, AIDE, REQUETES, cleTuile };

/* ---- Entrée ------------------------------------------------------------- */
/* Importé par un test : on s'arrête ici, rien ne doit partir sur le réseau. */
if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // rien : le module sert de bibliothèque
} else {
const args = process.argv.slice(2);
let cibles = [];

const iListe = args.indexOf("--liste");
if (iListe >= 0 && args[iListe + 1]) {
  cibles = JSON.parse(readFileSync(args[iListe + 1], "utf8"));
} else if (args[0] && /^-?\d/.test(args[0])) {
  const [lat, lng] = args[0].split(",").map(Number);
  cibles = [{ lat, lng, nom: args[0] }];
} else {
  const parDefaut = join(ICI, "villes.json");
  if (!existsSync(parDefaut)) {
    console.error("Aucune liste de villes. Donne une coordonnée, ou crée outils/villes.json.");
    process.exit(1);
  }
  cibles = JSON.parse(readFileSync(parDefaut, "utf8"));
}

/* Plusieurs villes tombent dans la même tuile — Roubaix et Tourcoing, par
   exemple. On les fusionne : une tuile, un fichier, une requête. */
const tuiles = new Map();
for (const c of cibles) {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
  const cle = cleTuile(c.lat, c.lng);
  if (!tuiles.has(cle)) tuiles.set(cle, []);
  if (c.nom) tuiles.get(cle).push(c.nom);
}

console.log(cibles.length + " point(s) → " + tuiles.size + " tuile(s)\n");
let faites = 0;
const liste = [...tuiles.entries()];
for (const [i, [cle, noms]] of liste.entries()) {
  if (await fabriquer(cle, noms)) faites += 1;
  if (i < liste.length - 1) await attendre(ATTENTE_ENTRE_TUILES);
}
console.log(faites + "/" + tuiles.size + " tuile(s) écrite(s) dans " + SORTIE);
if (!faites) process.exit(2);
}
