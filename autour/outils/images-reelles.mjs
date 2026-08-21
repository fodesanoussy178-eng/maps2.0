/* CINQ LIEUX RÉELS DE LILLE, ROUBAIX ET TOURCOING.
   QUELLE SOURCE DONNE EFFECTIVEMENT UNE PHOTO ?

   Ce banc ne teste pas des cas d'école : il prend cinq établissements qui
   existent, avec leur identité Wikidata publique, et il fait tourner LE
   résolveur — le vrai, `images.js`, chargé comme la page le charge.

   TROIS MODES, ET ILS NE DISENT PAS LA MÊME CHOSE

     (défaut)   Ce qui SERAIT demandé. Aucun réseau. Pour chaque lieu on
                affiche l'enchaînement exact des appels que le résolveur
                ferait, dans l'ordre, avec leurs URL. Utile pour relire la
                chaîne ; ne mesure rien.

     --routage  Le routage, sur un corpus SIMULÉ et annoncé comme tel. Prouve
                que l'ordre des sources est respecté et que les règles de droit
                s'appliquent. Ne dit rien sur les photos qui existent vraiment.

     --live     LA MESURE. Va chercher les tags réels dans OpenStreetMap via
                Overpass, puis interroge réellement Commons et Wikidata. C'est
                le seul mode dont le tableau décrit le monde. Il demande un
                accès sortant vers overpass, commons.wikimedia.org et
                www.wikidata.org.

   Usage :
     node outils/images-reelles.mjs            → ce qui serait demandé
     node outils/images-reelles.mjs --routage  → le routage, corpus simulé
     node outils/images-reelles.mjs --live     → la mesure réelle
*/

import { readFile } from "node:fs/promises";
import vm from "node:vm";

/* ---- Les cinq lieux ------------------------------------------------------

   L'identifiant Wikidata est l'identité publique du lieu, pas une supposition
   sur ce qu'OpenStreetMap en dit : c'est `--live` qui relève les tags réels.
   Chacun est vérifiable sur wikidata.org/wiki/<QID>. */
const LIEUX = [
  { titre: "Palais des Beaux-Arts de Lille", ville: "Lille",     cat: "musee",     qid: "Q2628596" },
  { titre: "Gare de Lille-Flandres",         ville: "Lille",     cat: "train",     qid: "Q801098" },
  { titre: "La Piscine",                     ville: "Roubaix",   cat: "musee",     qid: "Q1955748" },
  { titre: "La Condition Publique",          ville: "Roubaix",   cat: "spectacle", qid: "Q22979739" },
  { titre: "Le Grand Mix",                   ville: "Tourcoing", cat: "concert",   qid: "Q16303798" },
];

/* L'emprise de la métropole : assez large pour les trois villes, assez serrée
   pour qu'Overpass réponde. */
const EMPRISE = "50.55,2.95,50.80,3.30";
const OVERPASS = "https://overpass-api.de/api/interpreter";

/* ---- Le résolveur, chargé comme la page le charge ----------------------- */
async function resolveur() {
  const code = await readFile(new URL("../images.js", import.meta.url), "utf8");
  const window = {};
  vm.runInContext(code, vm.createContext({ window, console }));
  return window.AutourImages;
}

/* ======================================================================== */
/*  Mode 1 — ce qui serait demandé                                          */
/* ======================================================================== */

function chaine(IMAGES, lieu) {
  const etapes = [];
  const existante = IMAGES.depuisSourceExistante(lieu);
  etapes.push(["1 · source existante", existante ? existante.image_source : "rien"]);

  const osm = IMAGES.imageOsmAutorisee(lieu);
  etapes.push(["2 · tag OSM image",
    osm && osm.visuel ? "site officiel → " + osm.visuel.image_url
      : osm && osm.commons ? "renvoie vers " + osm.commons
      : (lieu.tags && lieu.tags.image ? "refusé (droit non clair)" : "absent")]);

  const tags = IMAGES.depuisTagsOsm(lieu);
  etapes.push(["2 · wikimedia_commons",
    tags.commons ? "GET " + IMAGES.urlApiCommons(tags.commons).slice(0, 96) + "…" : "absent"]);
  etapes.push(["3 · wikidata",
    tags.wikidata ? "GET " + IMAGES.urlApiWikidata(tags.wikidata) : "absent"]);
  etapes.push(["4 · photo Autour", IMAGES.depuisPhotoAutour(lieu) ? "présente" : "aucune"]);
  etapes.push(["5 · Google Places",
    IMAGES.depuisGoogle(lieu) ? "disponible en repli" : "aucune (clé/fiche absente)"]);
  return etapes;
}

async function modeAppels(IMAGES) {
  titre("CE QUI SERAIT DEMANDÉ", "aucun réseau — la chaîne, pas la mesure");
  for (const base of LIEUX) {
    const lieu = { ...base, id: base.qid, tags: { wikidata: base.qid } };
    console.log("\n▸ " + base.titre + " · " + base.ville);
    for (const [etape, verdict] of chaine(IMAGES, lieu)) {
      console.log("   " + etape.padEnd(24) + verdict);
    }
  }
  console.log("\nAucune de ces lignes ne dit qu'une photo EXISTE : relancer avec --live.");
}

/* ======================================================================== */
/*  Mode 2 — le routage, sur un corpus annoncé comme simulé                 */
/* ======================================================================== */

/* CE CORPUS EST INVENTÉ, ET C'EST ASSUMÉ.

   Il ne prétend pas décrire les fichiers réels de Commons : il reproduit les
   FORMES que l'API rend, y compris celles qui doivent être refusées. Il sert
   à prouver le routage et les règles de droit, jamais à annoncer une photo. */
const CORPUS = {
  "Q2628596": {                                   // catégorie → fichier → licence libre
    tags: { wikidata: "Q2628596", wikimedia_commons: "Category:Palais des Beaux-Arts de Lille" },
    reponses: {
      "list=categorymembers": { query: { categorymembers: [{ title: "File:PBA-simule.jpg" }] } },
      "prop=imageinfo": imageinfo("PBA-simule.jpg", "CC BY-SA 4.0", "Photographe simulé"),
    },
  },
  "Q801098": {                                    // wikidata → P18 → licence libre
    tags: { wikidata: "Q801098" },
    reponses: {
      "wbgetclaims": { claims: { P18: [{ mainsnak: { datavalue: { value: "Gare-simulee.jpg" } } }] } },
      "prop=imageinfo": imageinfo("Gare-simulee.jpg", "CC0", ""),
    },
  },
  "Q1955748": {                                   // licence non libre → refusé
    tags: { wikidata: "Q1955748", wikimedia_commons: "File:Piscine-simulee.jpg" },
    reponses: { "prop=imageinfo": imageinfo("Piscine-simulee.jpg", "Fair use", "Inconnu") },
  },
  "Q22979739": {                                  // tag image sur le site officiel du lieu
    tags: { wikidata: "Q22979739", image: "https://laconditionpublique.com/photos/halle.jpg",
      website: "https://laconditionpublique.com/" },
    reponses: {},
  },
  "Q16303798": {                                  // rien chez Wikimedia → repli Google
    tags: { wikidata: "Q16303798" },
    reponses: {},
    photosGoogle: [{ url: "https://places.googleapis.com/v1/places/S/photos/P/media?key=demo",
      attribution: [{ name: "Contributeur Google", url: "https://maps.google.com/" }] }],
  },
};

function imageinfo(fichier, licence, auteur) {
  return { query: { pages: [{
    title: "File:" + fichier,
    imageinfo: [{
      url: "https://upload.wikimedia.org/wikipedia/commons/a/b3/" + fichier,
      thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b3/" + fichier + "/800px-" + fichier,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:" + fichier,
      timestamp: "2024-06-01T09:00:00Z",
      extmetadata: {
        Artist: { value: auteur }, LicenseShortName: { value: licence },
        ImageDescription: { value: "Corpus simulé — ne décrit aucun fichier réel." },
      },
    }],
  }] } };
}

function fetchSimule(reponses) {
  return async (url) => {
    const cle = Object.keys(reponses).find((motif) => String(url).includes(motif));
    if (!cle) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => reponses[cle] };
  };
}

async function modeRoutage(IMAGES) {
  titre("LE ROUTAGE", "corpus SIMULÉ — prouve l'ordre et les règles, pas les photos");
  const lignes = [];
  for (const base of LIEUX) {
    const c = CORPUS[base.qid];
    const lieu = { ...base, id: base.qid, tags: c.tags, photosGoogle: c.photosGoogle };
    const v = await IMAGES.resoudre(lieu, { fetch: fetchSimule(c.reponses) });
    lignes.push(ligne(base, v, c.tags));
  }
  tableau(lignes);
}

/* ======================================================================== */
/*  Mode 3 — la mesure réelle                                               */
/* ======================================================================== */

async function tagsReels() {
  const q = `[out:json][timeout:25];
nwr(${EMPRISE})["wikidata"~"^(${LIEUX.map((l) => l.qid).join("|")})$"];
out center tags;`;
  const r = await fetch(OVERPASS, {
    method: "POST",
    body: "data=" + encodeURIComponent(q),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!r.ok) throw new Error("Overpass HTTP " + r.status);
  const json = await r.json();
  const parQid = new Map();
  for (const e of json.elements || []) {
    const t = e.tags || {};
    if (t.wikidata && !parQid.has(t.wikidata)) parQid.set(t.wikidata, t);
  }
  return parQid;
}

async function modeLive(IMAGES) {
  titre("LA MESURE RÉELLE", "OpenStreetMap + Wikimedia, en direct");
  let parQid;
  try {
    parQid = await tagsReels();
  } catch (e) {
    console.error("Overpass injoignable : " + e.message);
    console.error("Sans les tags réels, ce mode ne mesure rien. Arrêt.");
    process.exitCode = 1;
    return;
  }
  const lignes = [];
  for (const base of LIEUX) {
    const tags = parQid.get(base.qid);
    if (!tags) {
      console.log("· " + base.titre + " : aucun objet OSM ne porte " + base.qid + " dans l'emprise.");
    }
    const lieu = { ...base, id: base.qid, tags: tags || { wikidata: base.qid } };
    const v = await IMAGES.resoudre(lieu, { fetch });
    lignes.push(ligne(base, v, tags));
  }
  tableau(lignes);
}

/* ======================================================================== */
/*  Affichage                                                               */
/* ======================================================================== */

function titre(quoi, precision) {
  console.log("\n" + "═".repeat(78));
  console.log(quoi + "  —  " + precision);
  console.log("═".repeat(78));
}

function ligne(base, v, tags) {
  return {
    lieu: base.titre,
    ville: base.ville,
    tags: tags ? ["image", "wikimedia_commons", "wikidata"].filter((k) => tags[k]).join(",") || "—" : "—",
    source: v ? v.image_source : "aucune (placeholder)",
    licence: v ? (v.image_license || "—") : "—",
    auteur: v ? (v.image_author || "—") : "—",
    url: v ? v.image_url : "",
  };
}

function tableau(lignes) {
  const colonnes = [["lieu", 32], ["ville", 10], ["tags", 24], ["source", 20], ["licence", 22]];
  console.log("");
  console.log(colonnes.map(([c, l]) => c.toUpperCase().padEnd(l)).join(""));
  console.log(colonnes.map(([, l]) => "─".repeat(l - 1) + " ").join(""));
  for (const r of lignes) {
    console.log(colonnes.map(([c, l]) => String(r[c]).slice(0, l - 1).padEnd(l)).join(""));
  }
  console.log("\nDétail :");
  for (const r of lignes) {
    console.log("  ▸ " + r.lieu);
    console.log("      source  : " + r.source);
    console.log("      auteur  : " + r.auteur);
    console.log("      licence : " + r.licence);
    console.log("      url     : " + (r.url || "—"));
  }
  const avec = lignes.filter((r) => r.url).length;
  const sans = lignes.length - avec;
  console.log("\n" + avec + (avec > 1 ? " lieux reçoivent" : " lieu reçoit") + " une photo sur " +
    lignes.length + " ; " + sans + (sans > 1 ? " gardent" : " garde") + " le placeholder actuel.");
}

const args = process.argv.slice(2);
const IMAGES = await resolveur();
if (args.includes("--live")) await modeLive(IMAGES);
else if (args.includes("--routage")) await modeRoutage(IMAGES);
else await modeAppels(IMAGES);
