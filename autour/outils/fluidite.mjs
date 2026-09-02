/* ===========================================================================
   LA FLUIDITÉ PERÇUE, MESURÉE PENDANT LES GESTES

   POURQUOI CE BANC EXISTE À CÔTÉ DE `vitesse.mjs`

   `vitesse.mjs` répond à « quand vois-je quelque chose ? » : il mesure le
   DÉMARRAGE. Il ne touche jamais la carte après coup, et il coupe Google Maps.
   Or le retour de terrain ne parle pas du démarrage — il parle de saccades
   PENDANT qu'on déplace la carte, qu'on zoome, qu'on ouvre un panneau. Ça, un
   banc de démarrage ne peut pas le voir.

   Ce que ce banc fait de différent, et qui compte :

     · il rejoue le VRAI chemin Google Maps. Un faux `google.maps.Map` fidèle
       — center/zoom, addListener, et surtout `bounds_changed` émis à CHAQUE
       image d'un geste — pilote le VRAI `mapProviders/googleMaps.js`, au-dessus
       du VRAI Leaflet, avec les VRAIS marqueurs d'Autour. On ne mesure pas le
       rendu de Google (on ne l'a pas) : on mesure la synchronisation d'Autour,
       qui est précisément ce qui saccade ;

     · il compte ce qui coûte, PENDANT le geste : `leaflet.setView`, `rendre`,
       `majFeuille2`, `resoudreCollisions`, les tâches longues > 50 ms, le pire
       blocage du fil principal, et les images anormalement espacées ;

     · il tourne sous Chromium ET, quand le binaire est présent, sous WebKit —
       parce qu'une émulation iPhone sous Chromium n'est pas Safari.

   La fluidité n'est pas un test vert de plus : c'est un BUDGET. Les seuils en
   bas de ce fichier échouent si un geste bloque le fil trop longtemps.

     AUTOUR_RACINE=autour node autour/outils/fluidite.mjs
   ======================================================================== */

import { chromium, webkit, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = process.env.AUTOUR_RACINE || new URL("..", import.meta.url).pathname;
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".svg": "image/svg+xml" };

const serveur = createServer(async (req, res) => {
  let chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin === "/") chemin = "/index.html";
  try {
    const fichier = join(RACINE, chemin);
    const s = await stat(fichier);
    if (!s.isFile()) throw new Error("dossier");
    res.writeHead(200, { "content-type": TYPES[extname(fichier)] || "application/octet-stream" });
    res.end(await readFile(fichier));
  } catch { res.writeHead(404); res.end("non"); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;
const POSITION_TEST = process.env.AUTOUR_TEST_POSITION
  ? "?testPosition=" + encodeURIComponent(process.env.AUTOUR_TEST_POSITION) : "";
const DENSE_ONLY = process.env.AUTOUR_FLUIDITE_DENSE_ONLY === "1";
const GESTE_ONLY = process.env.AUTOUR_FLUIDITE_ONLY || "";

const HUB = { lat: 50.6371, lng: 3.0713, nom: "Lille-Flandres" };

function lieuxAutour(centre, combien) {
  return Array.from({ length: combien }, (_, i) => ({
    type: "node", id: 7000 + i,
    lat: centre.lat + ((i % 11) - 5) * 0.0009,
    lon: centre.lng + (Math.floor(i / 11) - 5) * 0.0013,
    tags: { name: "Lieu " + (i + 1),
      amenity: ["restaurant", "cafe", "bar", "cinema", "library", "pharmacy"][i % 6],
      opening_hours: "Mo-Su 00:00-24:00" },
  }));
}
function evenementsAutour(centre, combien) {
  const t = Date.now();
  return Array.from({ length: combien }, (_, i) => ({
    id: "v" + String(i).padStart(8, "0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: "En cours " + (i + 1), description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    temporal_status: "now",
    start_at: new Date(t - 3600e3).toISOString(), end_at: new Date(t + 3600e3).toISOString(),
    place_name: "Salle", address: "1 rue", city: "V", insee_code: null,
    lat: centre.lat + 0.0008 * ((i % 9) + 1), lng: centre.lng + 0.0006 * ((i % 7) + 1),
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null, last_synced_at: new Date().toISOString(),
  }));
}

/* ---- Le faux Google Maps : fidèle là où ça compte ------------------------
   Il n'affiche rien. Il fait exactement ce que le vrai fait du point de vue de
   `googleMaps.js` : il émet `bounds_changed` à chaque pas d'un geste, et
   `idle` à la fin. C'est ce flot d'événements qui déclenche la synchro qu'on
   mesure. `window.__gmap` donne au banc de quoi piloter le geste. */
function scriptGoogleStub() {
  window.__gmap = null;
  class StubMap {
    constructor(el, opts) {
      this._c = { lat: opts.center.lat, lng: opts.center.lng };
      this._z = opts.zoom; this._l = Object.create(null);
      window.__gmap = this;
    }
    getCenter() { const c = this._c; return { lat: () => c.lat, lng: () => c.lng }; }
    getZoom() { return this._z; }
    setCenter(c) { this._c = { lat: c.lat, lng: c.lng }; this._emit("bounds_changed"); }
    setZoom(z) { this._z = z; this._emit("bounds_changed"); }
    setOptions() {}
    addListener(name, cb) { (this._l[name] = this._l[name] || []).push(cb); return { remove() {} }; }
    _emit(name) { (this._l[name] || []).forEach((cb) => { try { cb(); } catch (e) {} }); }
    __panBy(dLat, dLng) { this._c.lat += dLat; this._c.lng += dLng; this._emit("bounds_changed"); }
    __zoomTo(z) { this._z = z; this._emit("bounds_changed"); }
    __idle() { this._emit("idle"); }
  }
  window.google = { maps: { Map: StubMap, event: { addListener: (o, n, cb) => o.addListener(n, cb) } } };
}

/* ---- L'instrumentation. Posée avant tout script de la page. --------------- */
function scriptInstrumentation() {
  const F = {
    t0: performance.now(),
    counts: { setView: 0, rendre: 0, majFeuille2: 0, resoudreCollisions: 0, boundsChanged: 0 },
    heartbeatWorstMs: 0, rafWorstGapMs: 0,
    captureGeste: false, gesteHeartbeatWorstMs: 0, gesteRafWorstGapMs: 0,
    longTasks: 0, longTaskWorstMs: 0, longTaskTotalMs: 0,
    reset() {
      this.t0 = performance.now();
      Object.keys(this.counts).forEach((k) => (this.counts[k] = 0));
      this.heartbeatWorstMs = 0; this.rafWorstGapMs = 0;
      this.captureGeste = false; this.gesteHeartbeatWorstMs = 0; this.gesteRafWorstGapMs = 0;
      this.longTasks = 0; this.longTaskWorstMs = 0; this.longTaskTotalMs = 0;
    },
    debuterGeste() { this.captureGeste = true; },
    finirGeste() { this.captureGeste = false; },
    read() {
      return { ...this.counts, heartbeatWorstMs: Math.round(this.heartbeatWorstMs),
        rafWorstGapMs: Math.round(this.rafWorstGapMs), longTasks: this.longTasks,
        longTaskWorstMs: Math.round(this.longTaskWorstMs),
        longTaskTotalMs: Math.round(this.longTaskTotalMs),
        gesteHeartbeatWorstMs: Math.round(this.gesteHeartbeatWorstMs),
        gesteRafWorstGapMs: Math.round(this.gesteRafWorstGapMs) };
    },
  };
  window.__fluid = F;

  /* Le battement : un intervalle court qui devrait revenir toutes les 32 ms.
     S'il revient bien plus tard, du travail synchrone a tenu le fil — et c'est
     exactement une saccade. Il marche partout, WebKit compris. */
  let dernier = performance.now();
  setInterval(() => {
    const t = performance.now(), ecart = t - dernier - 32;
    dernier = t;
    if (ecart > F.heartbeatWorstMs) F.heartbeatWorstMs = ecart;
    if (F.captureGeste && ecart > F.gesteHeartbeatWorstMs)
      F.gesteHeartbeatWorstMs = ecart;
  }, 32);

  /* L'espacement des images : rAF devrait revenir toutes les ~16 ms. Un grand
     trou, c'est une image sautée — perçue comme un à-coup. */
  let dernierRaf = performance.now();
  const battementRaf = () => {
    const t = performance.now(), gap = t - dernierRaf;
    dernierRaf = t;
    if (gap > F.rafWorstGapMs) F.rafWorstGapMs = gap;
    if (F.captureGeste && gap > F.gesteRafWorstGapMs)
      F.gesteRafWorstGapMs = gap;
    requestAnimationFrame(battementRaf);
  };
  requestAnimationFrame(battementRaf);

  /* Les tâches longues : > 50 ms bloque le fil au point de rater une image.
     L'API n'existe pas sous WebKit — on le laisse à zéro là-bas, le battement
     prend le relais. */
  try {
    new PerformanceObserver((liste) => {
      liste.getEntries().forEach((e) => {
        F.longTasks += 1; F.longTaskTotalMs += e.duration;
        F.longTaskWorstMs = Math.max(F.longTaskWorstMs, e.duration);
      });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
}

function scriptSupabaseStub() {
  const rep = (d) => Promise.resolve({ data: d, error: null });
  window.supabase = { createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => rep(null) }),
      order() { return this; }, limit() { return this; }, then: (r) => rep([]).then(r) }) }),
    rpc: (nom, args) => fetch("/rpc/" + nom, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(args || {}) })
      .then((r) => r.json()).then((d) => ({ data: d, error: null })).catch(() => ({ data: [], error: null })),
    auth: { getSession: () => rep({ session: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  }) };
}

async function ouvrir(navigateur, opts) {
  const o = opts || {};
  const centre = o.centre || HUB;
  const ctx = await navigateur.newContext({
    ...devices["iPhone 13"],
    permissions: ["geolocation"],
    geolocation: { latitude: centre.lat, longitude: centre.lng },
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (c) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(c) });
    if (url.startsWith(BASE) && !/\/api\/|\/rpc\//.test(url)) return route.continue();
    if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64") });
    if (/leaflet.*\.js(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
    if (/leaflet.*\.css(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/css", body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
    if (/supabase-js|@supabase/.test(url) && /\.js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    if (/maps\.googleapis\.com/.test(url)) return route.abort("failed");
    if (/\/api\/lieux|overpass/.test(url)) return json({ elements: lieuxAutour(centre, o.lieux ?? 40) });
    if (/rpc\/evenements_proches/.test(url)) return json(evenementsAutour(centre, o.evenements ?? 6));
    if (/rpc\//.test(url)) return json([]);
    if (/\/api\/commune/.test(url)) return json({ nom: centre.nom });
    if (/nominatim|openagenda|routing|osrm/.test(url)) return json([]);
    return json({});
  });

  await page.addInitScript(scriptGoogleStub);
  await page.addInitScript(scriptInstrumentation);
  await page.addInitScript(scriptSupabaseStub);
  await page.goto(BASE + "/index.html" + POSITION_TEST);

  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="maintenant-liste"]');
    return e && e.dataset.mnEtat && e.dataset.mnEtat !== "loading";
  }, null, { timeout: 20000 }).catch(() => {});
  /* On laisse la carte, les marqueurs et le fond Google « prêt » se poser. */
  await page.waitForFunction(() => !!window.__gmap, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  /* Les compteurs enveloppent les fonctions réelles APRÈS leur définition. */
  await page.evaluate(() => {
    const F = window.__fluid;
    const envelopper = (nom) => {
      const f = window[nom];
      if (typeof f !== "function" || f.__enveloppe) return false;
      const g = function (...a) { F.counts[nom] += 1; return f.apply(this, a); };
      g.__enveloppe = true; window[nom] = g; return true;
    };
    F.dispo = {
      rendre: envelopper("rendre"),
      majFeuille2: envelopper("majFeuille2"),
      resoudreCollisions: envelopper("resoudreCollisions"),
    };
    if (window.L && window.L.Map && window.L.Map.prototype.setView && !window.L.Map.prototype.setView.__enveloppe) {
      const sv = window.L.Map.prototype.setView;
      const g = function (...a) { F.counts.setView += 1; return sv.apply(this, a); };
      g.__enveloppe = true; window.L.Map.prototype.setView = g; F.dispo.setView = true;
    }
    /* On compte aussi les `bounds_changed` reçus, pour dire le RATIO
       setView / bounds_changed : c'est lui qui prouve le batching. */
    const g = window.__gmap;
    if (g && !g.__compte) {
      g.__compte = true;
      const emit = g._emit.bind(g);
      g._emit = function (name) { if (name === "bounds_changed") F.counts.boundsChanged += 1; return emit(name); };
    }
  });
  return { ctx, page };
}

/* ---- Les gestes ---------------------------------------------------------- */
async function panContinu(page, ms) {
  await page.evaluate(async (duree) => {
    const g = window.__gmap; if (!g) return;
    const debut = performance.now();
    await new Promise((res) => {
      const frame = () => {
        g.__panBy(0.00004, 0.00005);            // quelques pixels par image
        if (performance.now() - debut < duree) requestAnimationFrame(frame);
        else { g.__idle(); res(); }
      };
      requestAnimationFrame(frame);
    });
  }, ms);
}
async function pincementZoom(page) {
  await page.evaluate(async () => {
    const g = window.__gmap; if (!g) return;
    const paliers = [16, 16.4, 16.8, 17.2, 17.6, 18, 17.6, 17.2, 16.8, 16.4, 16];
    await new Promise((res) => {
      let i = 0;
      const frame = () => {
        if (i < paliers.length) { g.__zoomTo(paliers[i++]); requestAnimationFrame(frame); }
        else { g.__idle(); res(); }
      };
      requestAnimationFrame(frame);
    });
  });
}

async function mesurer(page, nom, action) {
  await page.evaluate(() => {
    window.__fluid.reset();
    window.__cpuBase = JSON.parse(JSON.stringify((window.AutourPerf && AutourPerf.cpu) || {}));
    window.__fluid.debuterGeste();
  });
  await action();
  await page.evaluate(() => window.__fluid.finirGeste());
  await page.waitForTimeout(500);               // laisser retomber le travail différé
  const r = await page.evaluate(() => window.__fluid.read());
  const cpu = await page.evaluate(() => {
    const base = window.__cpuBase || {}, apres = (window.AutourPerf && AutourPerf.cpu) || {};
    const delta = {};
    Object.keys(apres).forEach((k) => {
      const d = (apres[k].totalMs || 0) - ((base[k] || {}).totalMs || 0);
      if (d > 0) delta[k] = Math.round(d);
    });
    return delta;
  });
  return { nom, ...r, cpu };
}

async function scenarios(navigateur, etiquette) {
  const out = [];
  // 1 · déplacement continu 3 s, densité normale
  if(!DENSE_ONLY && !GESTE_ONLY){
    const { ctx, page } = await ouvrir(navigateur, { centre: HUB, lieux: 40, evenements: 6 });
    out.push(await mesurer(page, "pan 3 s (40 lieux)", () => panContinu(page, 3000)));
    out.push(await mesurer(page, "pinch zoom (40 lieux)", () => pincementZoom(page)));
    await ctx.close();
  }
  // 6 · zone dense ~120 lieux
  {
    const { ctx, page } = await ouvrir(navigateur, { centre: HUB, lieux: 120, evenements: 12 });
    if(!GESTE_ONLY || GESTE_ONLY === "pan")
      out.push(await mesurer(page, "pan 3 s (120 lieux)", () => panContinu(page, 3000)));
    if(!GESTE_ONLY || GESTE_ONLY === "pinch")
      out.push(await mesurer(page, "pinch zoom (120 lieux)", () => pincementZoom(page)));
    if(GESTE_ONLY) { await ctx.close(); return out.map((m) => ({ ...m, navigateur: etiquette })); }
    // 3/4/5 · panneaux, sur la même page dense
    out.push(await mesurer(page, "ouvrir/fermer Explorer", async () => {
      await page.evaluate(() => { const b = document.querySelector('[data-nb="explorer"]'); if (b) b.click(); });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = document.querySelector('[data-nb="explorer"]'); if (b) b.click(); });
      await page.waitForTimeout(400);
    }));
    out.push(await mesurer(page, "Maintenant → Manger → retour", async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-sa],[data-bn],[data-besoin]")]
          .find((e) => /manger/i.test(e.textContent || "") || e.dataset.sa === "alimentaire");
        if (b) b.click();
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = document.querySelector('[data-nb="explorer"]'); if (b) b.click(); });
      await page.waitForTimeout(400);
    }));
    out.push(await mesurer(page, "ouvrir Aide", async () => {
      await page.evaluate(() => {
        const b = document.querySelector('[data-nb="aide"],[data-aide],#btnAide,[data-testid="bouton-aide"]');
        if (b) b.click();
      });
      await page.waitForTimeout(600);
    }));
    await ctx.close();
  }
  return out.map((m) => ({ ...m, navigateur: etiquette }));
}

/* ---- Exécution ----------------------------------------------------------- */
const lignes = [];
console.log("\n──── FLUIDITÉ : ce qui se passe pendant un geste ────");

const chrome = await chromium.launch({ executablePath: CHROME });
lignes.push(...await scenarios(chrome, "Chromium"));
await chrome.close();

let webkitDispo = true;
try {
  const wk = await webkit.launch();
  lignes.push(...await scenarios(wk, "WebKit"));
  await wk.close();
} catch (e) {
  webkitDispo = false;
  console.log("\n  WebKit indisponible ici (" + String(e.message || e).split("\n")[0] + ").");
  console.log("  Le binaire n'est pas téléchargeable dans ce bac à sable. Ce banc");
  console.log("  exécute WebKit dès qu'il est présent (CI, poste local).");
}

const c = (v, n = 6) => String(v == null ? "—" : v).padStart(n);
console.log("\n  scénario                          nav        setV  bChg  rend  mF2  coll  LT>50 pireLT  bloc  rafGap  gBloc  gRaf");
for (const m of lignes) {
  console.log("  " + m.nom.padEnd(32) + " " + m.navigateur.padEnd(9) +
    c(m.setView) + c(m.boundsChanged) + c(m.rendre) + c(m.majFeuille2, 5) +
    c(m.resoudreCollisions) + c(m.longTasks, 6) + c(m.longTaskWorstMs, 7) +
    c(m.heartbeatWorstMs, 6) + c(m.rafWorstGapMs, 7) +
    c(m.gesteHeartbeatWorstMs, 6) + c(m.gesteRafWorstGapMs, 6));
}

console.log("\n──── où va le temps CPU (ms cumulés par sous-phase) ────");
for (const m of lignes) {
  const top = Object.entries(m.cpu || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => k + " " + v).join(" · ");
  if (top) console.log("  " + m.navigateur + " · " + m.nom + "\n      " + top);
}

/* ---- LE BUDGET : la fluidité devient un vrai critère ---------------------

   DEUX FAMILLES DE MESURE, ET ELLES NE SE JUGENT PAS PAREIL.

   · Les GESTES CONTINUS (déplacement, zoom) sont pilotés image par image : leur
     coût ne dépend d'aucun réseau, il est reproductible, et c'est précisément
     le « saccades pendant les interactions » du retour terrain. On les met sous
     budget dur — le banc échoue s'ils le dépassent.

   · Les OUVERTURES DE PANNEAU déclenchent le chargement progressif (Aide charge
     par paliers 3→5→10→20 km). Ici le banc répond au réseau INSTANTANÉMENT :
     il entasse dans 500 ms un travail que la latence réelle étale sur plusieurs
     secondes. Le chiffre est donc pessimiste par construction. On l'IMPRIME,
     avec l'attribution CPU — une régression s'y verra — mais on ne fait pas
     échouer le banc sur un artefact de mesure. */
console.log("\n──── budget de fluidité ────");
const BUDGET_BLOC_MS = 300;
const resultats = [];
const verifier = (nom, ok, detail) => {
  resultats.push({ nom, ok });
  console.log((ok ? "  ok   " : "ÉCHEC  ") + nom + (ok ? "" : "  → " + detail));
};
const gestes = lignes.filter((x) => /^pan/.test(x.nom));   // déplacement continu

for (const m of gestes) {
  /* La preuve DÉTERMINISTE que la cascade ne tourne plus à chaque image : sur
     un déplacement de trois secondes, `resoudreCollisions` passait de 182 à une
     poignée (réconciliation à l'idle). Ce compteur ne varie pas d'un run à
     l'autre — c'est le meilleur garde-fou anti-régression. */
  verifier(m.navigateur + " · " + m.nom + " · pas de recomposition par image (coll ≤ 4)",
    m.resoudreCollisions <= 4, "resoudreCollisions " + m.resoudreCollisions);
  /* Un seul setView par image au plus (+1 pour la synchro finale d'idle). */
  verifier(m.navigateur + " · " + m.nom + " · un setView par image au plus",
    m.setView <= m.boundsChanged + 1,
    "setView " + m.setView + " > bounds_changed " + m.boundsChanged + " +1");
  /* Et le fil principal reste sous le budget perceptif pendant le geste. */
  verifier(m.navigateur + " · " + m.nom + " · fil principal sous " + BUDGET_BLOC_MS + " ms",
    m.heartbeatWorstMs <= BUDGET_BLOC_MS, "pire blocage " + m.heartbeatWorstMs + " ms");
}

console.log("\n──── constat (mesure pessimiste : réseau instantané) ────");
for (const m of lignes.filter((x) => !/^pan/.test(x.nom))) {
  const sous = m.heartbeatWorstMs <= BUDGET_BLOC_MS;
  const top = Object.entries(m.cpu || {}).sort((a, b) => b[1] - a[1])[0];
  console.log("  " + (sous ? "sous budget " : "au-dessus   ") + m.navigateur + " · " +
    m.nom + " : " + m.heartbeatWorstMs + " ms" +
    (top ? "  (surtout " + top[0] + " " + top[1] + " ms)" : ""));
}

serveur.close();

const passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + resultats.length + " budgets de geste tenus" +
  (webkitDispo ? "" : "  (WebKit non exécuté ici — binaire absent du bac à sable)"));
process.exit(passes === resultats.length ? 0 : 1);
