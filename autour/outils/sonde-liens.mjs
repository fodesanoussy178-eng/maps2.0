/* ===========================================================================
   LE LIEN OUVRE-T-IL CE QU'IL PROMET ?

   Un code HTTP 200 dit que la page est servie ; il ne dit pas que le bon écran
   s'ouvre. Or c'est toute la promesse du bouton de ChatGPT : « Voir les aides
   dans Autour » doit poser quelqu'un devant les aides, pas devant la carte de
   sa ville.

   Cette sonde ouvre donc les vraies URL dans un vrai navigateur, sur la vraie
   livraison, et regarde CE QUI EST À L'ÉCRAN. Les appels réseau sont servis
   comme dans `sonde-rendu.mjs` : la découverte locale avec sa sortie réelle,
   les tuiles par un pixel, Leaflet depuis node_modules. Rien n'est simulé du
   côté de l'application elle-même.

     node outils/sonde-liens.mjs
   ======================================================================== */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, access, stat } from "node:fs/promises";
import { join, resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "livraison");
const TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const TOURCOING = {latitude: 50.72373, longitude: 3.160758};

/* La braderie réelle du 26/09/2026, telle que `evenements_locaux` la rend.
   Sans elle, la sonde mesurerait un écran vide et ne dirait rien du lien. */
const EVENEMENTS = [
  {id: "3957e0d9-da67-4376-a9d2-0ebf1f7bbff3", title: "Grande Braderie d'Automne à Tissel",
   description: "La Braderie continue chez Tissel !", category: "Braderie",
   start_at: "2026-09-26T08:00:00+00:00", end_at: "2026-09-26T15:00:00+00:00",
   timezone: "Europe/Paris", temporal_status: "soon", date_confidence: "exact",
   price_text: "Entrée libre", is_free: true, place_name: "TISSEL", venue_name: "TISSEL",
   address: "17 rue du Nouveau Monde, 59100 Roubaix", city: "Roubaix",
   lat: 50.697789, lng: 3.17596, primary_source: "openagenda", event_source: "openagenda",
   source_url: "https://openagenda.com/roubaix/events/52612740",
   event_source_url: "https://openagenda.com/roubaix/events/52612740",
   image_url: null, cancelled: false, last_synced_at: "2026-09-25T12:00:47.785Z",
   event_kind: "braderie", importance_level: "local", announcement_tags: ["braderie", "local"],
   zone_id: "mel", artist_names: [], music_genres: [], audience: null},
];

/* La sortie réelle de `local_discovery_nearby` pour Tourcoing, relevée le
   25/09/2026 — la même que celle de `sonde-rendu.mjs`. */
const DECOUVERTE = [
  {id: "9072d1c4-f65c-42d8-bdf8-93e650498647", name: "CCAS de Tourcoing",
   lat: 50.7231, lng: 3.1604, address: "26 Rue de la Bienveillance",
   postal_code: "59200", city: "Tourcoing", category: "mairie",
   service_categories: ["administrative_assistance", "food", "meals"],
   phone: "03 20 11 34 34", official_url: "https://www.tourcoing.fr/",
   verification_status: "verified", confidence: "0.880",
   last_verified_at: "2026-09-24T21:59:33.498Z", entity_status: "unknown",
   reopens_at: null, closure_reason: null, next_distribution_at: null, distance_m: 70},
];

async function cheminChromium() {
  for (const c of [process.env.AUTOUR_CHROME,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean)) {
    try { await access(c); return c; } catch {}
  }
  return null;
}
async function leaflet(nom) {
  for (const base of [join(RACINE, "..", "node_modules/leaflet/dist/"),
                      "node_modules/leaflet/dist/"]) {
    try { return await readFile(join(base, nom), "utf8"); } catch {}
  }
  return null;
}

/* LE SERVEUR REJOUE LA RÈGLE DE L'HÉBERGEUR : un chemin inconnu qui n'est pas
   un fichier est servi par l'application, exactement comme les réécritures de
   `vercel.json` le font en production. C'est cette règle-là qu'on teste. */
const serveur = createServer(async (requete, reponse) => {
  const url = new URL(requete.url, "http://local");
  const chemin = decodeURIComponent(url.pathname);
  const fichier = resolve(RACINE, chemin === "/" ? "index.html" : chemin.replace(/^\/+/, ""));
  const servirApplication = async () => {
    reponse.writeHead(200, {"content-type": TYPES[".html"]});
    reponse.end(await readFile(join(RACINE, "index.html")));
  };
  if (!fichier.startsWith(RACINE)) { reponse.writeHead(403); reponse.end(); return; }
  try {
    if (!(await stat(fichier)).isFile()) return servirApplication();
    reponse.writeHead(200, {"content-type": TYPES[extname(fichier)] || "application/octet-stream"});
    reponse.end(await readFile(fichier));
  } catch { return servirApplication(); }
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${serveur.address().port}`;

const executablePath = await cheminChromium();
if (!executablePath) { console.error("✗ aucun Chromium"); serveur.close(); process.exit(1); }
const navigateur = await chromium.launch({executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]});
const leafletJs = await leaflet("leaflet.js");
const leafletCss = await leaflet("leaflet.css");

async function ouvrir(chemin) {
  const contexte = await navigateur.newContext({
    viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, locale: "fr-FR",
    permissions: ["geolocation"], geolocation: TOURCOING,
  });
  await contexte.addInitScript(() => {
    try { localStorage.setItem("autour:onboarding-localisation", "termine"); } catch (e) {}
  });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e.message).slice(0, 160)));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (/leaflet\.js/.test(url) && leafletJs)
      return route.fulfill({status: 200, contentType: "text/javascript", body: leafletJs});
    if (/leaflet\.css/.test(url) && leafletCss)
      return route.fulfill({status: 200, contentType: "text/css", body: leafletCss});
    if (/\.png|tile|basemaps/.test(url))
      return route.fulfill({status: 200, contentType: "image/png", body: PNG});
    if (/rpc\/evenements_locaux/.test(url))
      return route.fulfill({status: 200, contentType: "application/json",
        body: JSON.stringify(EVENEMENTS)});
    if (/rpc\/local_discovery_nearby/.test(url))
      return route.fulfill({status: 200, contentType: "application/json",
        body: JSON.stringify(DECOUVERTE)});
    if (/supabase\.co/.test(url))
      return route.fulfill({status: 200, contentType: "application/json", body: "[]"});
    if (/api-adresse|geo\.api\.gouv/.test(url))
      return route.fulfill({status: 200, contentType: "application/json",
        body: JSON.stringify({features: [{properties: {city: "Tourcoing", citycode: "59599"},
          geometry: {coordinates: [3.160758, 50.72373]}}]})});
    return route.fulfill({status: 200, contentType: "application/json", body: "[]"});
  });
  await page.goto(BASE + chemin, {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForTimeout(3500);
  return {page, contexte, erreurs};
}

const cas = [
  /* LE TÉMOIN. Sans lui, « la braderie n'apparaît pas » ne dit pas si c'est le
     lien qui a échoué ou la sonde qui n'a pas de quoi l'afficher. */
  {nom: "témoin · accueil sans lien",
   chemin: "/?testPosition=50.72373,3.160758",
   verifier: async (page) => {
     const corps = await page.textContent("body").catch(() => "");
     return {braderieVisible: /Braderie d.Automne/i.test(corps || "")};
   }},
  {nom: "solidarité · besoin manger",
   chemin: "/solidarite?besoin=manger&ville=Tourcoing&lat=50.72373&lng=3.16076&utm_source=chatgpt",
   verifier: async (page) => {
     const feuille = await page.$("#feuilleBesoins");
     const visible = feuille ? await feuille.isVisible() : false;
     const titre = await page.textContent("#fbTitre").catch(() => "");
     return {visible, titre: (titre || "").trim()};
   }},
  {nom: "explorer · brocante Tourcoing",
   chemin: "/explorer?q=brocante+Tourcoing&ville=Tourcoing&lat=50.72373&lng=3.16076&utm_source=chatgpt",
   verifier: async (page) => {
     const champ = await page.inputValue("#rech").catch(() => "");
     const corps = await page.textContent("body").catch(() => "");
     /* CE QUE CETTE SONDE PEUT DIRE, ET CE QU'ELLE NE PEUT PAS.

        Elle mesure que l'application a bien reçu le lien et en a tiré
        l'intention — « brocante » — sans erreur. Elle ne peut pas mesurer le
        RENDU des résultats : le témoin ci-dessus montre que la braderie
        n'apparaît pas non plus sur l'accueil avec les mêmes fixtures. Le
        chargement d'un événement demande le contexte territorial complet, que
        cette sonde ne rejoue pas. Ce rendu-là se vérifie en production. */
     return {intention: champ, resultatsMesurables: /Braderie d.Automne/i.test(corps || "")};
   }},
];

let sortie = 0;
for (const c of cas) {
  const {page, contexte, erreurs} = await ouvrir(c.chemin);
  const etat = await c.verifier(page);
  const dur = erreurs.filter((e) => !/ResizeObserver|Failed to fetch/.test(e));
  console.log("· " + c.nom);
  console.log("  URL      " + c.chemin.slice(0, 78));
  console.log("  écran    " + JSON.stringify(etat));
  console.log("  erreurs  " + (dur.length ? dur.slice(0, 3).join(" | ") : "aucune"));
  if (c.nom.startsWith("témoin") && !etat.braderieVisible)
    console.log("  note     le témoin ne rend pas l'événement : cette sonde ne mesure pas le rendu");
  await page.screenshot({path: "/tmp/sonde-lien-" + c.nom.split(" ")[0] + ".png"});
  if (dur.length) sortie = 1;
  await contexte.close();
}
await navigateur.close();
serveur.close();
process.exit(sortie);
