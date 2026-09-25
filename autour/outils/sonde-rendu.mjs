/* LA SONDE DE RENDU : CE QUE LE NAVIGATEUR FAIT, PAS CE QUE LA FEUILLE DIT.
 *
 * « La présence d'un media query CSS n'est pas une validation. » Cet outil
 * ouvre la page dans Chromium et MESURE — des boîtes, des largeurs, des
 * couleurs de comportement — au lieu de relire des règles. Trois choses qu'un
 * fichier ne prouve jamais :
 *
 *   · un débordement horizontal, une cible sous 44 px, un chevauchement ;
 *   · la géométrie des trois volets et l'état réel du voile ;
 *   · ce qui se passe quand une source tombe, et le trajet complet
 *     marqueur → fiche compacte → volet de détail.
 *
 * Trois défauts ont été trouvés par cette sonde et par aucune relecture :
 * un `:has()` imbriqué (sélecteur invalide, donc règle muette), la pastille de
 * navigation flottante prise pour une colonne de gauche, et un panneau ignoré
 * parce qu'il était mesuré à la frame où son animation d'entrée commence.
 *
 *   node outils/sonde-rendu.mjs largeurs   [320,390,768,1024,1100,1280,1440,1920]
 *   node outils/sonde-rendu.mjs volets     [la fiche comme colonne de droite]
 *   node outils/sonde-rendu.mjs pannes     [503, requête qui pend, JSON tronqué]
 *   node outils/sonde-rendu.mjs parcours   [marqueur → fiche compacte → détail]
 *
 * Elle sert la LIVRAISON par défaut (`livraison/`, ce que Vercel envoie), sur
 * un serveur statique éphémère. `AUTOUR_SOURCE=.` sert le dépôt à la place.
 *
 * Chromium : `AUTOUR_CHROME` ou le chemin de l'image Playwright. Leaflet vient
 * d'un CDN que certains environnements bloquent ; on le sert depuis
 * `node_modules/leaflet` quand il est là, sinon la carte reste absente et la
 * sonde le dit plutôt que de faire semblant.
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, stat, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, resolve } from "node:path";

const MODE = process.argv[2] || "largeurs";
const RACINE = resolve(fileURLToPath(new URL("..", import.meta.url)),
  process.env.AUTOUR_SOURCE || "livraison");
const LARGEURS = (process.argv[3] || "320,390,768,1024,1100,1280,1440,1920")
  .split(",").map(Number);
const TOURCOING = {latitude: 50.7236, longitude: 3.1610};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64");
const TYPES = {".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".css":"text/css", ".json":"application/json", ".png":"image/png",
  ".svg":"image/svg+xml", ".webp":"image/webp", ".ico":"image/x-icon"};

/* Un lieu ouvert en permanence, à la forme EXACTE d'une réponse Overpass :
   c'est le contrat que l'application lit, et un lieu fermé serait écarté par le
   classement — ce qui ferait croire à une panne d'affichage. */
const LIEUX = {elements: [{type:"node", id:101, lat:50.7240, lon:3.1615,
  tags:{name:"Le Grand Mix", amenity:"bar", "addr:city":"Tourcoing", opening_hours:"24/7"}}]};

async function cheminChromium() {
  const candidats = [process.env.AUTOUR_CHROME,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);
  for (const c of candidats) { try { await access(c); return c; } catch {} }
  return null;
}
async function leaflet(nom) {
  for (const base of [join(RACINE, "..", "node_modules/leaflet/dist/"),
                      "node_modules/leaflet/dist/"]) {
    try { return await readFile(join(base, nom), "utf8"); } catch {}
  }
  return null;
}

const serveur = createServer(async (requete, reponse) => {
  const chemin = decodeURIComponent(new URL(requete.url, "http://local").pathname);
  const fichier = resolve(RACINE, chemin === "/" ? "index.html" : chemin.replace(/^\/+/, ""));
  if (!fichier.startsWith(RACINE)) { reponse.writeHead(403); reponse.end(); return; }
  try {
    if (!(await stat(fichier)).isFile()) throw new Error("dossier");
    reponse.writeHead(200, {"content-type": TYPES[extname(fichier)] || "application/octet-stream"});
    reponse.end(await readFile(fichier));
  } catch { reponse.writeHead(404); reponse.end("absent"); }
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${serveur.address().port}`;

const executablePath = await cheminChromium();
if (!executablePath) {
  console.error("✗ aucun Chromium trouvé — poser AUTOUR_CHROME");
  serveur.close(); process.exit(1);
}
const navigateur = await chromium.launch({executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]});
const leafletJs = await leaflet("leaflet.js");
const leafletCss = await leaflet("leaflet.css");
if (!leafletJs) console.error("⚠ leaflet absent de node_modules : la carte ne s'installera pas");

async function ouvrir({largeur, panne = null, fixtures = false}) {
  const contexte = await navigateur.newContext({
    viewport: {width: largeur, height: largeur < 700 ? 844 : 900},
    isMobile: largeur < 700, hasTouch: largeur < 700, locale: "fr-FR",
    ...(fixtures ? {permissions: ["geolocation"], geolocation: TOURCOING} : {}),
  });
  if (fixtures) {
    await contexte.addInitScript(() => {
      try { localStorage.setItem("autour:onboarding-localisation", "termine"); } catch (e) {}
    });
  }
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e.message).slice(0, 140)));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) {
      if (fixtures && /\/api\/lieux/.test(url)) {
        if (panne === "osm503") return route.fulfill({status: 503, body: "{}"});
        return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(LIEUX)});
      }
      if (fixtures && /\/api\/commune/.test(url))
        return route.fulfill({status: 200, contentType: "application/json", body: '{"commune":"Tourcoing"}'});
      if (fixtures && /\/api\//.test(url))
        return route.fulfill({status: 200, contentType: "application/json", body: "[]"});
      return route.continue();
    }
    if (/leaflet\.js/.test(url) && leafletJs) {
      /* `map` est un `let` de module : invisible depuis la sonde. On enveloppe
         la fabrique `L.map` pour garder une poignée sur l'instance. */
      return route.fulfill({status: 200, contentType: "text/javascript",
        body: leafletJs + "\n;(function(){var f=L.map;L.map=function(){" +
          "var m=f.apply(this,arguments);window.__carte=m;return m;};})();"});
    }
    if (/leaflet\.css/.test(url) && leafletCss)
      return route.fulfill({status: 200, contentType: "text/css", body: leafletCss});
    if (/\.png|tile|basemaps/.test(url))
      return route.fulfill({status: 200, contentType: "image/png", body: PNG});
    const supabase = /supabase\.co/.test(url);
    if (panne === "503" && supabase)
      return route.fulfill({status: 503, contentType: "application/json", body: '{"message":"indisponible"}'});
    if (panne === "pend" && supabase) return;                       // la requête pend
    if (panne === "tronque" && supabase)
      return route.fulfill({status: 200, contentType: "application/json", body: '[{"id":"a","title":"Trav'});
    if (supabase) return route.fulfill({status: 200, contentType: "application/json", body: "[]"});
    return route.fulfill({status: 204, body: ""});
  });
  await page.goto(`${BASE}/index.html`, {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForTimeout(fixtures ? 6000 : 2500);
  return {contexte, page, erreurs};
}

const MESURES = {
  /* Ce qu'une relecture de CSS ne voit pas : la page telle qu'elle tient. */
  async largeurs() {
    for (const largeur of LARGEURS) {
      const {contexte, page, erreurs} = await ouvrir({largeur});
      const m = await page.evaluate(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" &&
            s.display !== "none" && Number(s.opacity) > .05;
        };
        const petites = [...document.querySelectorAll(
          "button,a[href],input,select,textarea,[role=button]")].filter(visible)
          .map((el) => ({quoi: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
              (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0,2).join(".") : "") +
              (el.getAttribute("aria-label") ? "[" + el.getAttribute("aria-label").slice(0,18) + "]" : ""),
            l: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height)}))
          .filter((b) => b.l < 44 || b.h < 44);
        return {debordement: Math.max(document.documentElement.scrollWidth,
          document.body.scrollWidth) - window.innerWidth,
          carte: !!document.querySelector("#map .leaflet-pane, #map"),
          navBas: !!document.querySelector("#navBas"), petites};
      });
      console.log(String(largeur).padStart(5) + "px  débordement:" + m.debordement +
        "  carte:" + (m.carte ? "oui" : "NON") + "  navBas:" + (m.navBas ? "oui" : "NON") +
        "  cibles<44px:" + m.petites.length +
        (m.petites.length ? " → " + m.petites.map((p) => p.quoi + " " + p.l + "×" + p.h).join(", ") : "") +
        "  erreursJS:" + erreurs.length);
      await contexte.close();
    }
  },
  /* La fiche comme colonne de droite, et la carte qui reste vivante. */
  async volets() {
    for (const largeur of LARGEURS) {
      const {contexte, page, erreurs} = await ouvrir({largeur});
      const m = await page.evaluate(async () => {
        const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
        const f = document.querySelector("#feuille"), voile = document.querySelector("#voile");
        /* Le contenu qu'`ouvrirFeuille` insère : c'est `#ficheLieu` qui décide
           de la géométrie du volet. */
        f.innerHTML = '<button class="feuille-x"></button><button class="poignee"></button>' +
          '<div class="d-lieu" id="ficheLieu"><h2 class="titre">Un lieu</h2></div>';
        f.hidden = false;
        if (voile) voile.hidden = false;
        const r = f.getBoundingClientRect();
        const styleVoile = voile && !voile.hidden ? getComputedStyle(voile) : null;
        const encombrement = typeof window.encombrementCarte === "function"
          ? window.encombrementCarte() : "absent";
        let reveler = "carte absente";
        if (window.__carte && typeof window.revelerSurCarte === "function") {
          const bornes = window.__carte.getBounds(), avant = window.__carte.getCenter();
          window.revelerSurCarte({id: "sonde", lat: avant.lat,
            lng: bornes.getEast() - (bornes.getEast() - avant.lng) * 0.06});
          await attendre(800);
          const apres = window.__carte.getCenter();
          const bouge = (a, b) => Math.abs(a.lat - b.lat) > 1e-7 || Math.abs(a.lng - b.lng) > 1e-7;
          const pointCache = bouge(avant, apres);
          const centre = window.__carte.getCenter();
          window.revelerSurCarte({id: "sonde2", lat: centre.lat, lng: centre.lng});
          await attendre(800);
          reveler = {pointCache, pointDejaVisible: bouge(centre, window.__carte.getCenter()),
            focusLieu: document.body.classList.contains("focus-lieu")};
        }
        return {fiche: {x: Math.round(r.left), l: Math.round(r.width), h: Math.round(r.height)},
          poignee: getComputedStyle(f.querySelector(".poignee")).display !== "none",
          animation: getComputedStyle(f).animationName,
          voile: styleVoile ? styleVoile.pointerEvents : "caché",
          encombrement, reveler,
          debordement: Math.max(document.documentElement.scrollWidth,
            document.body.scrollWidth) - window.innerWidth};
      });
      console.log(String(largeur).padStart(5) + "px  fiche x=" + String(m.fiche.x).padStart(4) +
        " l=" + String(m.fiche.l).padStart(4) + "  poignée:" + (m.poignee ? "oui" : "non ") +
        "  voile:" + m.voile + "  " + m.animation +
        "  révéler:" + JSON.stringify(m.reveler) + "  débordement:" + m.debordement +
        "  erreursJS:" + erreurs.length);
      await contexte.close();
    }
  },
  /* Une source qui tombe ne doit pas faire un écran blanc ni un écran muet. */
  async pannes() {
    for (const panne of [null, "503", "pend", "tronque", "osm503"]) {
      for (const largeur of [390, 1440]) {
        const {contexte, page, erreurs} = await ouvrir({largeur, panne, fixtures: true});
        const m = await page.evaluate(() => {
          const peint = (sel) => {
            const el = document.querySelector(sel);
            if (!el || el.hidden) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const peinture = performance.getEntriesByType("paint")
            .find((p) => p.name === "first-contentful-paint");
          const texte = (document.body.innerText || "").replace(/\s+/g, " ").trim();
          return {carte: peint("#map"), navBas: peint("#navBas"),
            texte: texte.slice(0, 90), lettres: texte.length,
            fcp: peinture ? Math.round(peinture.startTime) : null,
            debordement: Math.max(document.documentElement.scrollWidth,
              document.body.scrollWidth) - window.innerWidth};
        });
        console.log(String(largeur).padStart(5) + "px  " + String(panne || "tout va bien").padEnd(9) +
          "  carte:" + (m.carte ? "oui" : "NON") + "  nav:" + (m.navBas ? "oui" : "NON") +
          "  fcp:" + m.fcp + "ms  texte:" + m.lettres + "  débordement:" + m.debordement +
          "  erreursJS:" + erreurs.length + "\n        « " + m.texte + " »");
        await contexte.close();
      }
    }
  },
  /* Le trajet : un marqueur, la fiche compacte, le volet de détail. */
  async parcours() {
    for (const largeur of [390, 1440]) {
      const {contexte, page, erreurs} = await ouvrir({largeur, fixtures: true});
      await page.evaluate(() => { if (window.__carte) window.__carte.setView([50.7240, 3.1615], 17); });
      await page.waitForTimeout(1200);
      const compacte = await page.evaluate(() => {
        const m = document.querySelector(".leaflet-marker-icon.mk-fix");
        if (!m) return null;
        /* Le gestionnaire réel de l'application reçoit cet événement : Leaflet
           écoute `click` sur l'élément du marqueur. */
        m.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
        return true;
      });
      await page.waitForTimeout(1200);
      const m = await page.evaluate(() => {
        const fc = document.querySelector("#ficheCompacte");
        const actions = fc && !fc.hidden
          ? [...fc.querySelectorAll("button,a")].map((b) => (b.textContent || "").trim()).filter(Boolean)
          : [];
        const voir = [...(fc ? fc.querySelectorAll("button") : [])]
          .find((b) => (b.textContent || "").trim() === "Voir");
        const boite = voir ? voir.getBoundingClientRect() : null;
        const dessus = boite ? document.elementFromPoint(
          Math.round(boite.left + boite.width / 2), Math.round(boite.top + boite.height / 2)) : null;
        if (voir) voir.click();
        return {actions, cibleVoir: boite ? {l: Math.round(boite.width), h: Math.round(boite.height),
          atteignable: !!dessus && (dessus === voir || voir.contains(dessus))} : null};
      });
      await page.waitForTimeout(1500);
      const fiche = await page.evaluate(() => {
        const f = document.querySelector("#feuille");
        const r = f && !f.hidden ? f.getBoundingClientRect() : null;
        return {ouverte: !!r,
          boite: r ? {x: Math.round(r.left), y: Math.round(r.top), l: Math.round(r.width)} : null,
          titre: (f && f.querySelector("h2") ? f.querySelector("h2").textContent : "").slice(0, 40),
          actions: [...(f ? f.querySelectorAll("button,a") : [])]
            .map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 10),
          marqueurEnAvant: document.querySelectorAll(".leaflet-marker-icon.en-avant").length,
          voile: (() => { const v = document.querySelector("#voile");
            return v && !v.hidden ? getComputedStyle(v).pointerEvents : "caché"; })(),
          debordement: Math.max(document.documentElement.scrollWidth,
            document.body.scrollWidth) - window.innerWidth};
      });
      console.log(String(largeur).padStart(5) + "px  marqueur:" + (compacte ? "cliqué" : "ABSENT") +
        "  compacte:" + JSON.stringify(m.actions) + "  cible « Voir »:" + JSON.stringify(m.cibleVoir) +
        "\n        fiche:" + JSON.stringify(fiche) + "  erreursJS:" + erreurs.length);
      await contexte.close();
    }
  },
};

try {
  const mesure = MESURES[MODE];
  if (!mesure) {
    console.error("modes : " + Object.keys(MESURES).join(", "));
    process.exitCode = 1;
  } else {
    console.log("— " + MODE + " — " + RACINE);
    await mesure();
  }
} finally {
  await navigateur.close();
  serveur.close();
}
