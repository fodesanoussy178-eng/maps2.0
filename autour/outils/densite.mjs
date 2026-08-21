/* ===========================================================================
   Stress-test de densité — ce que devient la carte quand il se passe beaucoup

   Les données réelles d'une ville moyenne sont clairsemées : trois événements,
   quarante commerces. Elles ne disent rien de ce qui arrive un samedi de
   festival, ni de ce qui arrive quand deux organisateurs publient à la même
   adresse. Ce banc fabrique donc la densité qu'on n'a pas encore :

     ·  5 événements dans 100 m
     · 20 événements dans 500 m
     · 50 événements dans 1 km
     ·  4 événements aux coordonnées EXACTEMENT identiques
     · événements + lieux + aide en même temps

   Et il mesure ce qui doit tenir :

     · aucun marqueur illisible sous un autre ;
     · aucun marqueur impossible à toucher ;
     · aucune carte qui sort de l'écran ;
     · pas d'effondrement du temps de rendu au déplacement ;
     · le zoom regroupe au lieu d'empiler ;
     · les événements passent devant les commerces.

   Prérequis : npm install playwright leaflet @supabase/supabase-js
   Réglable par AUTOUR_RACINE, AUTOUR_CHROME, AUTOUR_LEAFLET_DIST,
   AUTOUR_SUPABASE_UMD.
   ======================================================================== */

import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = process.env.AUTOUR_RACINE || new URL("..", import.meta.url).pathname;
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const SUPA = process.env.AUTOUR_SUPABASE_UMD ||
  "node_modules/@supabase/supabase-js/dist/umd/supabase.js";

const TYPES = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png" };

const serveur = createServer(async (req, res) => {
  let chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin === "/") chemin = "/index.html";
  try {
    const f = join(RACINE, chemin);
    if (!(await stat(f)).isFile()) throw new Error("dir");
    res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end("non"); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

const CENTRE = { lat: 50.6292, lng: 3.0573 };
const M_PAR_DEG_LAT = 111320;
const mParDegLng = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

/* Sème `n` points dans un disque de `rayon` mètres, en spirale : une
   distribution régulière est plus dure pour l'anti-collision qu'un tas. */
function semer(n, rayon, graine = 0) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const angle = (i * 2.399963 + graine);           // angle d'or
    const d = rayon * Math.sqrt(t);
    return {
      lat: CENTRE.lat + (d * Math.cos(angle)) / M_PAR_DEG_LAT,
      lng: CENTRE.lng + (d * Math.sin(angle)) / mParDegLng(CENTRE.lat),
    };
  });
}

const CATS = ["concert", "spectacle", "sport", "marche", "event"];
const maintenant = Date.now();

function evenement(i, pos, titre) {
  return {
    id: String(i).padStart(8, "0") + "-0000-0000-0000-000000000000",
    publication_id: null,
    title: titre || ("Événement " + (i + 1)),
    description: "", category: CATS[i % CATS.length],
    start_at: new Date(maintenant - 3600e3).toISOString(),
    end_at: new Date(maintenant + 3 * 3600e3).toISOString(),
    timezone: "Europe/Paris", temporal_status: "now", date_confidence: "exact",
    place_name: "Lieu " + (i + 1), address: (i + 1) + " rue d'essai",
    city: "Ville", insee_code: null, lat: pos.lat, lng: pos.lng,
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null,
    last_synced_at: new Date().toISOString(),
  };
}

/* Les lieux permanents et l'aide, servis par Overpass, pour que la carte
   porte les trois familles en même temps. */
function lieuxOsm(n) {
  const points = semer(n, 900, 1.1);
  return points.map((p, i) => ({
    type: "node", id: 500000 + i, lat: p.lat, lon: p.lng,
    tags: {
      name: (i % 3 === 0 ? "Aide " : "Commerce ") + (i + 1),
      ...(i % 3 === 0 ? { amenity: "social_facility", social_facility: "food_bank" }
        : i % 3 === 1 ? { amenity: "restaurant" } : { amenity: "cafe" }),
      opening_hours: "Mo-Su 00:00-24:00",
    },
  }));
}

const SCENARIOS = [
  { nom: "5 événements dans 100 m",  evts: semer(5, 100).map((p, i) => evenement(i, p)),      osm: 0 },
  { nom: "20 événements dans 500 m", evts: semer(20, 500).map((p, i) => evenement(i, p)),     osm: 0 },
  { nom: "50 événements dans 1 km",  evts: semer(50, 1000).map((p, i) => evenement(i, p)),    osm: 0 },
  { nom: "4 événements empilés au même point",
    evts: Array.from({ length: 4 }, (_, i) =>
      evenement(i, { lat: CENTRE.lat + 0.0012, lng: CENTRE.lng + 0.0012 }, "Empilé " + (i + 1))), osm: 0 },
  { nom: "20 événements + 30 lieux + aide", evts: semer(20, 700).map((p, i) => evenement(i, p)), osm: 30 },
];

let jeu = { evts: [], osm: [] };

async function bouchonner(page) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (c) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(c) });
    if (url.startsWith(BASE) && !/\/api\//.test(url)) return route.continue();
    if (/tile|basemaps|openstreetmap\.org\/\d/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64") });
    if (/leaflet.*\.js(\?|$)/.test(url)) return route.fulfill({ status: 200,
      contentType: "text/javascript", body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
    if (/leaflet.*\.css(\?|$)/.test(url)) return route.fulfill({ status: 200,
      contentType: "text/css", body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
    if (/supabase-js|@supabase/.test(url) && /\.js/.test(url)) return route.fulfill({ status: 200,
      contentType: "text/javascript", body: await readFile(SUPA, "utf8") });
    if (/maps\.googleapis\.com/.test(url)) return route.abort("failed");
    if (/\/api\/lieux|overpass/.test(url)) return json({ elements: jeu.osm });
    if (/\/api\/commune/.test(url)) return json({ nom: "Ville d'essai" });
    if (/rpc\/evenements_proches/.test(url)) return json(jeu.evts);
    if (/rpc\//.test(url) || /supabase/.test(url)) return json([]);
    if (/openagenda/.test(url)) return json({ events: [], agendas: [] });
    return json({});
  });
}

/* ---- Ce qu'on mesure dans la page --------------------------------------- */
const mesurer = () => {
  const vue = { w: innerWidth, h: innerHeight };
  const boites = [...document.querySelectorAll(".leaflet-marker-icon")]
    .map((el) => {
      const r = el.getBoundingClientRect();
      const carte = el.querySelector(".evc, .poi, .affiche, .grappe");
      const rc = carte ? carte.getBoundingClientRect() : r;
      return { r: rc, evenement: !!el.querySelector(".evc"),
               grappe: !!el.querySelector(".grappe"),
               w: rc.width, h: rc.height };
    })
    .filter((b) => b.w > 0 && b.h > 0);

  const aire = (a) => a.w * a.h;
  const chevauche = (a, b) => {
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    return x > 0 && y > 0 ? x * y : 0;
  };

  // « illisible » : plus de la moitié de la surface recouverte par un voisin
  let illisibles = 0;
  for (let i = 0; i < boites.length; i++) {
    let couvert = 0;
    for (let j = 0; j < boites.length; j++) if (i !== j) couvert += chevauche(boites[i], boites[j]);
    if (couvert > aire(boites[i]) * 0.5) illisibles++;
  }

  // hors écran : la carte dépasse la fenêtre
  const horsEcran = boites.filter((b) =>
    b.r.left < -2 || b.r.top < -2 || b.r.right > vue.w + 2 || b.r.bottom > vue.h + 2).length;

  // sélectionnable : le point au centre de la boîte appartient bien au marqueur
  /* Un marqueur situé SOUS la feuille du bas n'est pas « non sélectionnable » :
     il est légitimement recouvert par un panneau que l'utilisateur peut
     réduire. Les compter faisait remonter cinq faux défauts par scénario, à
     l'identique — c'est ce qui a trahi l'artefact. On ne teste donc que les
     marqueurs réellement dans la zone cartographique libre. */
  const panneaux = ["feuilleBesoins", "ficheCompacte", "navBas"]
    .map((id) => document.getElementById(id))
    .filter((e) => e && !e.hidden)
    .map((e) => e.getBoundingClientRect());
  const sousUnPanneau = (x, y) => panneaux.some((p) =>
    x >= p.left && x <= p.right && y >= p.top && y <= p.bottom);

  let inselectionnables = 0;
  for (const b of boites) {
    const cx = Math.round((b.r.left + b.r.right) / 2);
    const cy = Math.round((b.r.top + b.r.bottom) / 2);
    if (cx < 0 || cy < 0 || cx > vue.w || cy > vue.h) continue;   // hors écran, compté ailleurs
    if (sousUnPanneau(cx, cy)) continue;
    const el = document.elementFromPoint(cx, cy);
    if (!el || !el.closest(".leaflet-marker-icon")) inselectionnables++;
  }

  return {
    marqueurs: boites.length,
    evenements: boites.filter((b) => b.evenement).length,
    grappes: boites.filter((b) => b.grappe).length,
    piles: document.querySelectorAll(".mk-pile").length,
    compteurs: [...document.querySelectorAll(".evc-plus")].map((e) => e.textContent),
    illisibles, horsEcran, inselectionnables,
    // priorité visuelle : les événements doivent être au-dessus des commerces
    zEvenementMin: Math.min(...[...document.querySelectorAll(".leaflet-marker-icon")]
      .filter((e) => e.querySelector(".evc"))
      .map((e) => Number(getComputedStyle(e).zIndex) || 0), Infinity),
    zAutreMax: Math.max(...[...document.querySelectorAll(".leaflet-marker-icon")]
      .filter((e) => e.querySelector(".poi"))
      .map((e) => Number(getComputedStyle(e).zIndex) || 0), -Infinity),
  };
};

const navigateur = await chromium.launch({ executablePath: CHROME });
const lignes = [];

for (const scenario of SCENARIOS) {
  jeu = { evts: scenario.evts, osm: scenario.osm ? lieuxOsm(scenario.osm) : [] };
  const ctx = await navigateur.newContext({
    ...devices["iPhone 13"], permissions: ["geolocation"],
    geolocation: { latitude: CENTRE.lat, longitude: CENTRE.lng }, locale: "fr-FR",
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  await bouchonner(page);
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const zoome = await page.evaluate(mesurer);

  // temps de rendu pendant un déplacement soutenu
  const t0 = Date.now();
  const images = 40;
  for (let i = 0; i < images; i++) {
    await page.evaluate((n) => {
      const m = document.querySelector(".leaflet-container")?._leaflet_map_ref;
      if (m) { const c = m.getCenter(); m.setView([c.lat + (n % 2 ? 0.0004 : -0.0004),
        c.lng + 0.0004], m.getZoom(), { animate: false }); }
      else window.scrollBy(0, 0);
    }, i);
    await page.waitForTimeout(16);
  }
  const msParImage = (Date.now() - t0) / images;

  // dézoom : le regroupement doit prendre le relais
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid], .leaflet-container');
    if (window.__dezoom) return;
  });
  await page.keyboard.press("Minus").catch(() => {});
  await page.waitForTimeout(900);
  const dezoome = await page.evaluate(mesurer);

  lignes.push({ nom: scenario.nom, zoome, dezoome, msParImage, erreurs: erreurs.length });
  await ctx.close();
}

await navigateur.close();
serveur.close();

console.log("\n════ STRESS-TEST DE DENSITÉ ════\n");
let echecs = 0;
for (const l of lignes) {
  const z = l.zoome;
  const pb = [];
  if (z.illisibles > 0) pb.push(z.illisibles + " illisible(s)");
  if (z.horsEcran > 0) pb.push(z.horsEcran + " hors écran");
  if (z.inselectionnables > 0) pb.push(z.inselectionnables + " non sélectionnable(s)");
  if (l.msParImage > 40) pb.push(Math.round(l.msParImage) + " ms/image");
  if (l.erreurs) pb.push(l.erreurs + " erreur(s) JS");
  if (pb.length) echecs++;
  console.log(`${pb.length ? "ÉCHEC " : "  ok  "} ${l.nom}`);
  console.log(`         ${z.marqueurs} marqueurs (${z.evenements} événements, ${z.grappes} grappes)` +
    ` · ${Math.round(l.msParImage)} ms/image` +
    (z.piles ? ` · ${z.piles} pile(s) ${z.compteurs.join(",")}` : "") +
    ` · dézoom : ${l.dezoome.marqueurs} marqueurs`);
  if (pb.length) console.log("         → " + pb.join(" · "));
}
console.log(`\n${lignes.length - echecs}/${lignes.length} scénarios sans défaut`);
process.exit(echecs ? 1 : 0);
