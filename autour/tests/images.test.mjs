/* LES PHOTOS RÉELLES DES LIEUX, DE BOUT EN BOUT.

   Ces tests portent sur quatre choses, et rien d'autre :

     1. le bug OpenAgenda — `https://img.openagenda.com/main/` → HTTP 400 — est
        corrigé À SA SOURCE, en recomposant l'URL depuis le champ d'origine, et
        ne peut plus être réécrit ;
     2. l'ordre des sources est celui qui a été demandé, et une source ne passe
        jamais devant celle qui la précède ;
     3. les règles de droit sont des règles, pas des intentions : sans licence
        lisible, sans auteur, ou avec une déclaration de génération par un
        modèle, aucune image n'entre dans une carte ;
     4. le dessin ne bouge pas. Les emplacements, le repli teinté et le
        `figcaption` sont exactement ceux d'avant.

   Tout est éprouvé sans réseau : les fonctions qui DÉCIDENT sont pures, et
   celles qui demandent reçoivent leur `fetch`. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { sourceApplication } from "./source.mjs";
import {
  construireUrlImage, creditsImage, imageOpenAgenda, urlNommeUnFichier,
} from "../supabase/functions/sync-openagenda/image.mjs";
import { normalizeOpenAgendaEvent } from "../supabase/functions/sync-openagenda/normalize.mjs";
import { lilleTestSource } from "../supabase/functions/sync-openagenda/config.mjs";

const html = await sourceApplication(import.meta.url);
const code = await readFile(new URL("../images.js", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase/migrations/20260821224416_provenance_images.sql", import.meta.url), "utf8");
const zones = await readFile(new URL("../outils/zones.mjs", import.meta.url), "utf8");

/* Le résolveur, chargé comme la page le charge : un script classique qui se
   pose sur un objet global. Aucun DOM, aucun réseau — c'est précisément ce
   qui le rend éprouvable. */
function resolveur(reponses) {
  const window = {};
  const contexte = vm.createContext({ window, console });
  vm.runInContext(code, contexte);
  const api = window.AutourImages;
  const demandes = [];
  api._demandes = demandes;
  api._fetch = async (url) => {
    demandes.push(String(url));
    const cle = Object.keys(reponses || {}).find((motif) => String(url).includes(motif));
    if (!cle) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => reponses[cle] };
  };
  return api;
}

/* ======================================================================== */
/*  1. Le bug OpenAgenda : retrouver le champ, reconstruire l'URL           */
/* ======================================================================== */

/* La forme exacte que rend l'API v2 : deux morceaux, `base` et `filename`.
   L'ancien code lisait `base` — troisième clé de sa liste de priorités, et
   une chaîne qui commence bien par https:// — et s'arrêtait là. */
const IMAGE_V2 = {
  base: "https://img.openagenda.com/main/",
  filename: "5f3c1ab4e2c14.jpg",
  size: { width: 1500, height: 1000 },
  variants: [
    { filename: "5f3c1ab4e2c14_thumb.jpg", type: "thumbnail", size: { width: 400, height: 267 } },
  ],
};

test("une URL d'image nomme un fichier — un répertoire n'en est pas une", () => {
  assert.equal(urlNommeUnFichier("https://img.openagenda.com/main/"), false);
  assert.equal(urlNommeUnFichier("https://img.openagenda.com/main"), false);
  assert.equal(urlNommeUnFichier("https://cdn.openagenda.com/thumbnails/"), false);
  assert.equal(urlNommeUnFichier("https://img.openagenda.com/main/5f3c.jpg"), true);
  assert.equal(urlNommeUnFichier("https://img.openagenda.com/main/5f3c.jpg?v=2"), true);
});

test("l'affiche OpenAgenda est recomposée base + filename, jamais base seule", () => {
  assert.equal(construireUrlImage(IMAGE_V2),
    "https://img.openagenda.com/main/5f3c1ab4e2c14.jpg");
  /* LA RÉGRESSION EXACTE : `base` seule ne devient jamais une URL. */
  assert.equal(construireUrlImage({ base: "https://img.openagenda.com/main/" }), "");
  assert.equal(construireUrlImage({ base: "https://img.openagenda.com/main/", filename: "" }), "");
});

test("on sert la plus petite image qui reste assez large, pas l'original systématique", () => {
  /* 1000 px suffit à une carte : on ne descend pas les 3000 px de l'original. */
  assert.equal(construireUrlImage({
    base: "https://img.openagenda.com/main/",
    filename: "grand.jpg", size: { width: 3000, height: 2000 },
    variants: [{ filename: "moyen.jpg", size: { width: 1000, height: 667 } }],
  }), "https://img.openagenda.com/main/moyen.jpg");
  /* Aucun variant assez large : l'original vaut mieux qu'une vignette floue. */
  assert.equal(construireUrlImage(IMAGE_V2), "https://img.openagenda.com/main/5f3c1ab4e2c14.jpg");
});

test("les formes historiques d'OpenAgenda restent lues", () => {
  assert.equal(construireUrlImage("https://cdn.openagenda.com/main/a.jpg"),
    "https://cdn.openagenda.com/main/a.jpg");
  assert.equal(construireUrlImage({ originalImage: "https://cdn.openagenda.com/main/b.jpg" }),
    "https://cdn.openagenda.com/main/b.jpg");
  assert.equal(construireUrlImage({ thumbnail: "https://cdn.openagenda.com/thumbnails/c.jpg" }),
    "https://cdn.openagenda.com/thumbnails/c.jpg");
  /* Un variant qui porte sa propre base ne se fait pas recoller la mauvaise. */
  assert.equal(construireUrlImage({
    base: "https://img.openagenda.com/main/",
    variants: [{ base: "https://cdn.openagenda.com/thumbnails/", filename: "d.jpg", size: { width: 1200, height: 800 } }],
  }), "https://cdn.openagenda.com/thumbnails/d.jpg");
});

test("le crédit photo d'OpenAgenda cesse d'être jeté", () => {
  assert.equal(creditsImage({ credits: "© Ville de Lille" }), "© Ville de Lille");
  assert.equal(creditsImage(null, { imageCredits: "Photo : Maxime B." }), "Photo : Maxime B.");
  assert.equal(creditsImage(null, {}), "");
});

test("l'événement normalisé porte l'URL correcte ET sa provenance", () => {
  const source = lilleTestSource();
  const normalise = normalizeOpenAgendaEvent({
    uid: "78801027",
    title: { fr: "Atelier porte-clef" },
    location: { name: "Gare Saint Sauveur", geo: { latitude: 50.627319, longitude: 3.069793 } },
    timings: [{ begin: "2026-09-05T10:00:00+0200", end: "2026-09-05T17:00:00+0200" }],
    image: IMAGE_V2,
    imageCredits: "© Ville de Lille",
    updatedAt: "2026-08-20T08:00:00.000Z",
  }, { source, now: new Date("2026-08-20T10:00:00.000Z") });

  assert.equal(normalise.image_url, "https://img.openagenda.com/main/5f3c1ab4e2c14.jpg");
  assert.equal(normalise.event.image_source, "openagenda");
  assert.equal(normalise.event.image_author, "© Ville de Lille");
  assert.match(normalise.event.image_license, /organisateur/);
  assert.match(normalise.event.image_source_url, /^https:\/\/openagenda\.com\//);
  assert.equal(normalise.event.image_updated_at, "2026-08-20T08:00:00.000Z");
});

test("un événement sans image ne fabrique aucune URL", () => {
  const source = lilleTestSource();
  const normalise = normalizeOpenAgendaEvent({
    uid: "1", title: { fr: "Sans affiche" },
    location: { geo: { latitude: 50.63, longitude: 3.06 } },
    timings: [{ begin: "2026-09-05T10:00:00+0200", end: "2026-09-05T17:00:00+0200" }],
    image: { base: "https://img.openagenda.com/main/" },
  }, { source, now: new Date("2026-08-20T10:00:00.000Z") });
  assert.equal(normalise.image_url, null);
  assert.equal(normalise.event.image_source, null);
});

test("la migration répare les lignes déjà écrites au lieu de masquer l'erreur", () => {
  assert.match(migration, /create or replace function public\.image_url_nomme_un_fichier/);
  // les URL cassées sont effacées, pas filtrées à l'affichage
  assert.match(migration, /update public\.events\s+set image_url = null/);
  assert.match(migration, /not public\.image_url_nomme_un_fichier\(image_url\)/);
  // et le bug ne peut plus être réécrit
  assert.match(migration, /add constraint events_image_url_nomme_un_fichier/);
  // les six champs du contrat existent en base
  for (const colonne of ["image_source", "image_source_url", "image_author",
    "image_license", "image_updated_at"])
    assert.match(migration, new RegExp("add column if not exists " + colonne), colonne);
  // et la lecture publique les rend
  assert.match(migration, /e\.image_source, e\.image_source_url, e\.image_author,/);
});

/* ======================================================================== */
/*  2. Ce qu'on accepte d'afficher                                          */
/* ======================================================================== */

test("le résolveur refuse une URL qui ne nomme aucun fichier", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.urlImageValide("https://img.openagenda.com/main/"), false);
  assert.equal(IMAGES.urlImageValide("http://exemple.test/a.jpg"), false, "jamais http nu");
  assert.equal(IMAGES.urlImageValide("data:image/png;base64,AAAA"), false);
  assert.equal(IMAGES.urlImageValide("https://upload.wikimedia.org/x/y/Facade.jpg"), true);
});

test("sans licence lisible, Wikimedia ne s'affiche pas", () => {
  const IMAGES = resolveur();
  const base = {
    image_url: "https://upload.wikimedia.org/a/b/Facade.jpg",
    image_source: "wikimedia_commons",
    image_author: "Jean Photographe",
  };
  assert.equal(IMAGES.visuel(base), null, "aucune licence = droit inconnu");
  assert.equal(IMAGES.visuel({ ...base, image_license: "Fair use" }), null);
  assert.equal(IMAGES.visuel({ ...base, image_license: "All rights reserved" }), null);
  assert.ok(IMAGES.visuel({ ...base, image_license: "CC BY-SA 4.0" }));
  assert.ok(IMAGES.visuel({ ...base, image_license: "CC0" }));
  assert.ok(IMAGES.visuel({ ...base, image_license: "Public domain" }));
});

test("une image déclarée générée par un modèle ne représente jamais un lieu réel", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.visuel({
    image_url: "https://upload.wikimedia.org/a/b/Vue.jpg",
    image_source: "wikimedia_commons", image_license: "CC BY 4.0",
    image_author: "AI-generated with Stable Diffusion",
  }), null);
  assert.equal(IMAGES.visuel({
    image_url: "https://cdn.midjourney.com/a/b.png",
    image_source: "wikimedia_commons", image_license: "CC0",
  }), null);
  assert.equal(IMAGES.sentIA("Image générée par une IA"), true);
  assert.equal(IMAGES.sentIA("Photographie de la façade"), false);
});

test("une source inconnue n'entre pas — `image_source` reste borné au vocabulaire connu", () => {
  const IMAGES = resolveur();
  assert.deepEqual([...IMAGES.SOURCES], ["openagenda", "datatourisme", "structure", "autour",
    "site_officiel", "wikimedia_commons", "artist_official", "organizer_official",
    "venue_official", "institutional", "google_places"]);
  assert.equal(IMAGES.visuel({ image_url: "https://x.test/a.jpg", image_source: "gemini" }), null);
  assert.equal(IMAGES.visuel({ image_url: "https://x.test/a.jpg", image_source: "" }), null);
});

/* ======================================================================== */
/*  3. La photo doit être CELLE DU LIEU                                     */
/* ======================================================================== */

test("seuls les tags portés par l'objet lui-même sont suivis", () => {
  const IMAGES = resolveur();
  const tags = IMAGES.depuisTagsOsm({ tags: {
    wikidata: "Q2628596",
    wikimedia_commons: "Category:Palais des Beaux-Arts de Lille",
    image: "https://upload.wikimedia.org/a/b/Pba.jpg",
  }});
  assert.equal(tags.wikidata, "Q2628596");
  assert.equal(tags.commons, "Category:Palais des Beaux-Arts de Lille");
});

test("l'enseigne, l'exploitant et le sujet ne sont PAS le lieu", () => {
  const IMAGES = resolveur();
  /* Une boulangerie de quartier qui porte `brand:wikidata` recevrait le logo
     de la chaîne : c'est exactement « la bonne catégorie, le mauvais lieu ». */
  const tags = IMAGES.depuisTagsOsm({ tags: {
    "brand:wikidata": "Q37158",
    "operator:wikidata": "Q1234",
    "subject:wikidata": "Q42",
  }});
  assert.equal(tags.wikidata, "");
  assert.equal(tags.commons, "");
  for (const interdit of ["brand:wikidata", "operator:wikidata", "subject:wikidata"])
    assert.ok(IMAGES.TAGS_INTERDITS.includes(interdit), interdit);
});

test("un identifiant Wikidata mal formé n'est jamais suivi", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.depuisTagsOsm({ tags: { wikidata: "Lille" } }).wikidata, "");
  assert.equal(IMAGES.depuisTagsOsm({ tags: { wikimedia_commons: "Palais" } }).commons, "");
});

test("le tag OSM `image` n'est retenu que si l'on sait de qui il est", () => {
  const IMAGES = resolveur();
  /* Le serveur de quelqu'un d'autre : on n'affiche pas, et on ne copie pas. */
  assert.equal(IMAGES.imageOsmAutorisee({ tags: { image: "https://photo-libre.test/x.jpg" } }), null);
  /* Le site officiel du lieu : l'exploitant publie sa propre photo. */
  const officiel = IMAGES.imageOsmAutorisee({
    titre: "Le Grand Mix",
    tags: { image: "https://legrandmix.com/media/facade.jpg", website: "https://legrandmix.com/" },
  });
  assert.equal(officiel.visuel.image_source, "site_officiel");
  assert.equal(officiel.visuel.image_author, "Le Grand Mix");
  /* Wikimedia : on repasse par Commons pour obtenir la licence. */
  const wm = IMAGES.imageOsmAutorisee({
    tags: { image: "https://upload.wikimedia.org/wikipedia/commons/a/b3/Palais.jpg" },
  });
  assert.equal(wm.commons, "File:Palais.jpg");
});

/* ======================================================================== */
/*  4. Wikimedia Commons : miniature, page source, auteur, licence          */
/* ======================================================================== */

const COMMONS_OK = {
  query: { pages: [{
    title: "File:Palais des Beaux-Arts de Lille.jpg",
    imageinfo: [{
      url: "https://upload.wikimedia.org/wikipedia/commons/a/b3/Palais.jpg",
      thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b3/Palais.jpg/800px-Palais.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Palais_des_Beaux-Arts_de_Lille.jpg",
      timestamp: "2019-05-04T11:20:31Z",
      extmetadata: {
        Artist: { value: '<a href="https://commons.wikimedia.org/wiki/User:Velvet">Velvet</a>' },
        LicenseShortName: { value: "CC BY-SA 4.0" },
        ImageDescription: { value: "Façade du Palais des Beaux-Arts de Lille" },
      },
    }],
  }] },
};

test("Commons rend une miniature optimisée, sa page source, son auteur et sa licence", () => {
  const IMAGES = resolveur();
  const v = IMAGES.lireCommons(COMMONS_OK);
  assert.match(v.image_url, /\/thumb\/.*800px-Palais\.jpg$/, "la miniature, pas l'original");
  assert.equal(v.image_source, "wikimedia_commons");
  assert.equal(v.image_source_url,
    "https://commons.wikimedia.org/wiki/File:Palais_des_Beaux-Arts_de_Lille.jpg");
  assert.equal(v.image_author, "Velvet", "le HTML de Commons ne descend jamais dans la page");
  assert.equal(v.image_license, "CC BY-SA 4.0");
  assert.equal(v.image_updated_at, "2019-05-04T11:20:31Z");
});

test("la vignette est demandée à la largeur d'affichage, pas en pleine taille", () => {
  const IMAGES = resolveur();
  assert.match(IMAGES.urlApiCommons("File:X.jpg"), /iiurlwidth=800/);
  assert.match(IMAGES.urlApiCommons("File:X.jpg"), /iiprop=url%7Cextmetadata%7Ctimestamp/);
});

test("une catégorie Commons n'est pas une image : on passe par ses membres", async () => {
  const IMAGES = resolveur({
    "list=categorymembers": { query: { categorymembers: [
      { title: "Category:Interior" },                       // pas un fichier
      { title: "File:Palais des Beaux-Arts de Lille.jpg" },
    ] } },
    "prop=imageinfo": COMMONS_OK,
  });
  const v = await IMAGES.resoudreCommons("Category:Palais des Beaux-Arts de Lille",
    { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "wikimedia_commons");
  assert.match(IMAGES._demandes[0], /list=categorymembers/);
});

test("Wikidata sert d'aiguillage vers Commons, jamais d'image en soi", async () => {
  const IMAGES = resolveur({
    "wbgetclaims": { claims: { P18: [{ mainsnak: { datavalue: {
      value: "Palais des Beaux-Arts de Lille.jpg" } } }] } },
    "prop=imageinfo": COMMONS_OK,
  });
  const v = await IMAGES.resoudreWikidata("Q2628596", { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "wikimedia_commons");
  assert.match(IMAGES._demandes[0], /entity=Q2628596/);
  assert.equal(IMAGES.lireWikidata({ claims: {} }), "");
});

/* ======================================================================== */
/*  5. L'ordre des sources                                                  */
/* ======================================================================== */

test("l'ordre demandé est respecté : OSM avant Wikidata, Google en dernier", async () => {
  const IMAGES = resolveur({
    "wbgetclaims": { claims: { P18: [{ mainsnak: { datavalue: { value: "Palais.jpg" } } }] } },
    "prop=imageinfo": COMMONS_OK,
  });
  const lieu = {
    id: "osmway1", titre: "Palais des Beaux-Arts", lat: 50.6292, lng: 3.0623,
    tags: { wikidata: "Q2628596", wikimedia_commons: "File:Palais.jpg" },
    photosGoogle: [{ url: "https://places.googleapis.com/v1/places/X/photos/Y/media?key=k" }],
  };
  const v = await IMAGES.resoudre(lieu, { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "wikimedia_commons");
  /* Commons a répondu : Wikidata n'a même pas été demandé, Google non plus. */
  assert.equal(IMAGES._demandes.some((u) => u.includes("wbgetclaims")), false);
  assert.equal(IMAGES._demandes.some((u) => u.includes("googleapis")), false);
});

test("Google Places n'est atteint que lorsque tout le reste a échoué", async () => {
  const IMAGES = resolveur();      // aucune réponse : Commons et Wikidata échouent
  const lieu = {
    id: "osmway2", titre: "Café sans photo", lat: 50.63, lng: 3.06,
    tags: { wikidata: "Q999999" },
    photosGoogle: [{ url: "https://places.googleapis.com/v1/places/X/photos/Y/media?key=k",
      attribution: [{ name: "Camille R.", url: "https://maps.google.com/u" }] }],
  };
  const v = await IMAGES.resoudre(lieu, { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "google_places");
  assert.equal(v.image_author, "Camille R.");
  assert.equal(IMAGES.creditObligatoire(v), true, "Google exige son crédit à côté de la photo");
  assert.equal(IMAGES.persistable(v), false, "et n'est jamais conservée");
});

test("un lieu sans rien de fiable garde son placeholder", async () => {
  const IMAGES = resolveur();
  const v = await IMAGES.resoudre({ id: "osmnode3", titre: "Boulangerie", lat: 50.6, lng: 3.1,
    tags: { "brand:wikidata": "Q37158" } }, { fetch: IMAGES._fetch });
  assert.equal(v, null, "null veut dire « garde la tuile teintée », jamais « affiche quand même »");
});

test("une photo déjà résolue ne redemande rien", async () => {
  const IMAGES = resolveur();
  const lieu = {
    id: "evt1", isTemporary: true,
    image: "https://img.openagenda.com/main/affiche.jpg", imageSource: "openagenda",
  };
  const v = await IMAGES.resoudre(lieu, { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "openagenda");
  assert.equal(IMAGES._demandes.length, 0);
});

test("la photo Places d'une fiche Google redescend au rang de repli", async () => {
  const IMAGES = resolveur({ "prop=imageinfo": COMMONS_OK });
  const lieu = {
    id: "g1", titre: "Musée", lat: 50.62, lng: 3.06,
    image: "https://places.googleapis.com/v1/places/X/photos/Y/media?key=k",
    imageSource: "google_places",
    tags: { wikimedia_commons: "File:Palais.jpg" },
  };
  const v = await IMAGES.resoudre(lieu, { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "wikimedia_commons",
    "Commons passe devant une photo Places déjà posée sur la fiche");
});

/* ======================================================================== */
/*  6. Les événements : l'affiche avant le bâtiment                         */
/* ======================================================================== */

test("l'affiche officielle d'un événement passe avant toute photo du lieu", async () => {
  const IMAGES = resolveur({ "prop=imageinfo": COMMONS_OK });
  const evenement = {
    id: "evt2", isTemporary: true, titre: "Concert au Grand Mix",
    image: "https://img.openagenda.com/main/affiche-concert.jpg", imageSource: "openagenda",
    tags: { wikidata: "Q16303798" },        // le lieu a une photo Commons
  };
  const v = await IMAGES.resoudre(evenement, { fetch: IMAGES._fetch });
  assert.equal(v.image_source, "openagenda");
  assert.equal(v.image_scope, "evenement");
});

test("une photo de bâtiment ne remplace jamais une affiche déjà posée", () => {
  const IMAGES = resolveur();
  const evenement = { image: "https://img.openagenda.com/main/a.jpg",
    imageSource: "openagenda", image_scope: "evenement" };
  const photoDuLieu = IMAGES.visuel({
    image_url: "https://upload.wikimedia.org/a/b/Facade.jpg",
    image_source: "wikimedia_commons", image_license: "CC BY-SA 4.0", image_author: "Velvet",
  });
  assert.equal(IMAGES.appliquer(evenement, photoDuLieu), false);
  assert.equal(evenement.image, "https://img.openagenda.com/main/a.jpg");

  /* Mais un événement SANS affiche peut recevoir la photo de la salle : une
     tuile vide n'est pas préférable, et l'affiche reprendra sa place dès
     qu'elle existera. */
  const sansAffiche = { image: "", image_scope: "evenement" };
  assert.equal(IMAGES.appliquer(sansAffiche, photoDuLieu), true);
  assert.equal(sansAffiche.imageSource, "wikimedia_commons");
});

test("le contrat événement refuse Google Places et classe les sources fiables", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.visuelEvenement({
    image_url: "https://places.googleapis.com/v1/places/X/photos/Y/media?key=k",
    image_source: "google_places",
  }), null);
  assert.equal(IMAGES.visuelEvenement({
    image_url: "https://img.openagenda.com/main/affiche.jpg",
    image_source: "openagenda",
  }).image_type, "event_poster");
  assert.equal(IMAGES.visuelEvenement({
    image_url: "https://cdn.exemple.fr/organisateur.jpg",
    image_source: "organizer_official",
  }).image_type, "organizer");
  assert.equal(IMAGES.visuelEvenement({
    image_url: "https://salle.exemple.fr/affiche.jpg",
    image_source: "",
    source: "venue_official",
  }).image_type, "venue");
});

test("les fallbacks sont graphiques et déterminés par la catégorie", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.fallbackEvenement("cinema").key, "cinema");
  assert.equal(IMAGES.fallbackEvenement("cinema").emoji, "🎬");
  assert.equal(IMAGES.fallbackEvenement("manga").key, "manga");
  assert.equal(IMAGES.fallbackEvenement("manga").emoji, "🎯");
  assert.equal(IMAGES.fallbackEvenement("autre").key, "event");
});

test("le ratio distingue paysage, affiche, carré et petite source sans l'upscaler", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.ratioImage(1600, 900), "event-couverture-paysage");
  assert.equal(IMAGES.ratioImage(600, 900), "event-couverture-portrait");
  assert.equal(IMAGES.ratioImage(1000, 1000), "event-couverture-carre");
  assert.equal(IMAGES.ratioImage(320, 480), "event-couverture-portrait event-couverture-basse");
  assert.equal(IMAGES.ratioImage(500, 1200), "event-couverture-portrait");

  /* UNE AFFICHE SE LIT EN ENTIER, QUELLE QUE SOIT SA FORME.
     Le ratio seul envoyait tout ce qui dépasse 1.35 en `cover`, donc recadré :
     sur une affiche paysage, cela coupe le titre, la date ou le nom de la
     salle — l'information même. Le type déclaré tranche avant le ratio. */
  assert.equal(IMAGES.ratioImage(1600, 900, "event_poster"),
    "event-couverture-paysage event-couverture-affiche");
  assert.equal(IMAGES.ratioImage(600, 900, "event_poster"),
    "event-couverture-portrait event-couverture-affiche");
  assert.equal(IMAGES.ratioImage(0, 0, "event_poster"),
    "event-couverture-inconnue event-couverture-affiche");
  /* Une vraie photo garde son recadrage : on ne change que les affiches. */
  assert.equal(IMAGES.ratioImage(1600, 900, "venue"), "event-couverture-paysage");
  assert.equal(IMAGES.ratioImage(1600, 900), "event-couverture-paysage");
});

/* ======================================================================== */
/*  7. Le contrat, et ce qu'il ne fait pas                                  */
/* ======================================================================== */

test("un visuel porte toujours les six champs demandés", () => {
  const IMAGES = resolveur();
  const v = IMAGES.lireCommons(COMMONS_OK);
  for (const champ of ["image_url", "image_source", "image_source_url",
    "image_author", "image_license", "image_updated_at"])
    assert.ok(Object.prototype.hasOwnProperty.call(v, champ), champ);
});

test("poser un visuel écrit la provenance ET les champs que le rendu connaît", () => {
  const IMAGES = resolveur();
  const lieu = { id: "x", titre: "Palais" };
  assert.equal(IMAGES.appliquer(lieu, IMAGES.lireCommons(COMMONS_OK)), true);
  // ce que le rendu existant lit, inchangé
  assert.match(lieu.image, /800px-Palais\.jpg$/);
  assert.equal(lieu.imageSource, "wikimedia_commons");
  assert.equal(lieu.imageAttribution[0].name, "Velvet");
  // et le contrat, à côté
  assert.equal(lieu.image_license, "CC BY-SA 4.0");
  assert.match(lieu.image_source_url, /commons\.wikimedia\.org\/wiki\/File:/);
});

test("rien n'est téléchargé ni réhébergé : le résolveur ne lit que du JSON", () => {
  assert.doesNotMatch(code, /storage\.from|upload\(|createObjectURL|arrayBuffer|blob\(/,
    "aucune copie de fichier ne doit exister dans le résolveur");
  assert.match(code, /accept: "application\/json"/);
});

/* LA MÊME RÈGLE DANS TROIS LANGAGES.

   `urlNommeUnFichier` (connecteur), `urlImageValide` (navigateur) et
   `public.image_url_nomme_un_fichier` (base) disent la même chose dans trois
   runtimes différents. Ce test compare les deux implémentations JavaScript cas
   par cas ; la troisième est écrite juste en dessous, sur les mêmes cas, pour
   qu'une divergence saute aux yeux à la relecture. */
const CAS_URL = [
  ["https://img.openagenda.com/main/", false],                 // LE bug
  ["https://cdn.openagenda.com/thumbnails/", false],
  ["https://img.openagenda.com/main", false],
  ["https://img.openagenda.com/main/5f3c.jpg", true],
  ["https://upload.wikimedia.org/wikipedia/commons/a/b3/P.jpg", true],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/P.jpg?width=800", true],
  ["https://places.googleapis.com/v1/places/X/photos/Y/media?key=k", true],
];

test("connecteur et navigateur se prononcent identiquement sur les mêmes URL", () => {
  const IMAGES = resolveur();
  for (const [url, attendu] of CAS_URL) {
    assert.equal(urlNommeUnFichier(url), attendu, "connecteur : " + url);
    assert.equal(IMAGES.urlImageValide(url), attendu, "navigateur : " + url);
  }
  // la base dit la même chose, et sa nuance est écrite noir sur blanc
  assert.match(migration, /create or replace function public\.image_dernier_segment/);
  assert.match(migration, /position\('\?' in url\) > 0/);
});

test("le résolveur borne ce qu'il demande", () => {
  const IMAGES = resolveur();
  assert.equal(IMAGES.MAX_CANDIDATS, 8);
  assert.equal(IMAGES.MAX_SIMULTANEES, 3);
  assert.match(code, /AbortSignal\.timeout/);
});

/* ======================================================================== */
/*  8. Le dessin ne bouge pas                                               */
/* ======================================================================== */

test("les emplacements, le repli teinté et le crédit sont exactement ceux d'avant", () => {
  // la carte de recommandation : figure teintée, image en surimpression, crédit
  assert.match(html, /class="rc-photo rc-photo-vide"[^>]*style="--teinte:/);
  assert.match(html, /onload="this\.classList\.add\(\\'vue\\'\);window\.AutourPerf/);
  assert.match(html, /<figcaption>Photo : '\+attributionPhoto\(l\)/);
  // la ligne de résultat : même tuile, même émoji de repli
  assert.match(html, /<span class="ac-photo"[^>]*style="--teinte:/);
  // et rien n'est attendu : lazy + async, comme avant
  assert.match(html, /loading="lazy" decoding="async"/);
});

test("Pour toi et la fiche retirent une URL cassée sans bloquer le rendu", () => {
  assert.match(html, /function imageEvenementErreur\(img\)/);
  assert.match(html, /onerror="imageEvenementErreur\(this\)"/);
  assert.match(html, /function couvertureEvenement\(l, c\)/);
  assert.match(html, /function provenanceImage\(l\)/);
  assert.match(html, /Source : /);
  assert.match(html, /event-couverture-paysage/);
  assert.match(html, /event-couverture-portrait/);
  assert.match(html, /event-couverture-basse/);
  assert.match(html, /loading="lazy" decoding="async"/);
});

test("les photos arrivent après les données essentielles, jamais avant", () => {
  // le résolveur est appelé depuis l'enrichissement différé, et sans await
  assert.match(html, /if\(IMAGES\) IMAGES\.resoudreLot\(classement, \{redessiner:rendre1\}\)\.catch/);
  assert.match(html, /ORDO\.differer\(\(\)=>enrichirCandidats\(pourToi/);
});

test("le résolveur est chargé avec son empreinte, comme les autres modules", () => {
  assert.match(html, /<script src="images\.js\?v=[a-f0-9]{8}" defer><\/script>/);
});

test("les jeux de zone transportent enfin les tags qui portent une photo", () => {
  for (const tag of ["image", "wikimedia_commons", "wikidata"])
    assert.match(zones, new RegExp('"' + tag + '"'), tag);
});

test("une photo Places ne se glisse pas dans le cache local", () => {
  assert.match(html, /function sansPhotoGoogle\(l\)\{/);
  assert.match(html, /garder\.push\(sansPhotoGoogle\(alleger\(l\)\)\)/);
});

test("l'affiche est rendue entière, sans toucher aux dimensions du cadre", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  /* La règle vient APRÈS celle du paysage — même spécificité, c'est l'ordre
     qui tranche — et ne touche QUE l'ajustement. */
  const paysage = html.indexOf(".event-couverture.event-couverture-paysage img");
  const affiche = html.indexOf(".event-couverture.event-couverture-affiche img");
  assert.ok(affiche > paysage, "la règle affiche doit suivre celle du paysage");
  assert.match(html, /\.event-couverture\.event-couverture-affiche img\{object-fit:contain/);

  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /data-image-type="/, "le type doit être posé sur la figure");
  assert.match(app, /cadre && cadre\.dataset \? cadre\.dataset\.imageType : ""/,
    "et relu au chargement de l'image");
  assert.match(app, /"event-couverture-affiche"\)/,
    "la classe doit être retirée avant d'être reposée");
});
