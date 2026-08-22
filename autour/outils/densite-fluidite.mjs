/* ===========================================================================
   AUTOUR SE DÉGRADE-T-IL AVEC LA DENSITÉ LOCALE ?

   Deux retours de micro-freezes viennent de Paris ; ailleurs, c'est fluide.
   Ce banc répond à la seule question qui compte : quelle FONCTION grossit
   anormalement quand il y a beaucoup de lieux dans un petit rayon.

   IL MESURE, à densité contrôlée et à appareil/réseau identiques :

     · le nombre de lieux à chaque étage du pipeline
       (bruts injectés → dédupliqués → visibles → filtrés → scorés → candidats) ;
     · le temps de chaque phase : accueil:visibles / filtrage / classement,
       recommandations, rendu_carte, rendu_panneau, resoudreCollisions,
       fusion:permanent, reconstruction ;
     · les tâches longues > 50 ms et le pire blocage du fil principal.

   DEUX EXPÉRIENCES :

     1. Tourcoing → Lille → Paris, à densités représentatives, MÊME appareil.
        (Les comptes par source réels demanderaient Overpass en direct, bloqué
        dans ce bac à sable ; on injecte des densités représentatives, écrites
        noir sur blanc dans chaque ligne.)

     2. Paris à 50 / 100 / 150 / 250 / 500 candidats. Là, SEULE la densité
        change : c'est la courbe de dégradation, et le rapport temps/N vs
        temps/N² dit quelle phase est super-linéaire.

     AUTOUR_RACINE=autour node autour/outils/densite-fluidite.mjs
   ======================================================================== */

import { chromium, devices } from "playwright";
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

/* Des lieux serrés dans un petit rayon : c'est ce que « dense » veut dire.
   On répartit `combien` lieux dans un carré d'environ 1,2 km de côté, la maille
   se resserrant à mesure qu'ils sont nombreux — exactement le cas Paris. */
function lieuxDenses(centre, combien) {
  const cote = Math.ceil(Math.sqrt(combien));
  const etendue = 0.011;                       // ~1,2 km
  return Array.from({ length: combien }, (_, i) => {
    const x = i % cote, y = Math.floor(i / cote);
    return {
      type: "node", id: 9000 + i,
      lat: centre.lat + (y / cote - 0.5) * etendue,
      lon: centre.lng + (x / cote - 0.5) * etendue * 1.5,
      tags: { name: "Lieu " + (i + 1),
        amenity: ["restaurant", "cafe", "bar", "cinema", "library", "pharmacy", "bakery", "bank"][i % 8],
        opening_hours: "Mo-Su 00:00-24:00" },
    };
  });
}
function evenementsDenses(centre, combien) {
  const t = Date.now();
  return Array.from({ length: combien }, (_, i) => ({
    id: "v" + String(i).padStart(8, "0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: "En cours " + (i + 1), description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    temporal_status: "now",
    start_at: new Date(t - 3600e3).toISOString(), end_at: new Date(t + 3600e3).toISOString(),
    place_name: "Salle", address: "1 rue", city: "V", insee_code: null,
    lat: centre.lat + ((i % 10) - 5) * 0.0009, lng: centre.lng + ((i % 8) - 4) * 0.0011,
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null, last_synced_at: new Date().toISOString(),
  }));
}

function scriptGoogleStub() {
  window.__gmap = null;
  class StubMap {
    constructor(el, opts) { this._c = { lat: opts.center.lat, lng: opts.center.lng };
      this._z = opts.zoom; this._l = Object.create(null); window.__gmap = this; }
    getCenter() { const c = this._c; return { lat: () => c.lat, lng: () => c.lng }; }
    getZoom() { return this._z; }
    setCenter(c) { this._c = { lat: c.lat, lng: c.lng }; this._emit("bounds_changed"); }
    setZoom(z) { this._z = z; this._emit("bounds_changed"); }
    setOptions() {}
    addListener(name, cb) { (this._l[name] = this._l[name] || []).push(cb); return { remove() {} }; }
    _emit(name) { (this._l[name] || []).forEach((cb) => { try { cb(); } catch (e) {} }); }
    __panBy(a, b) { this._c.lat += a; this._c.lng += b; this._emit("bounds_changed"); }
    __idle() { this._emit("idle"); }
  }
  window.google = { maps: { Map: StubMap, event: { addListener: (o, n, cb) => o.addListener(n, cb) } } };
}
function scriptInstrumentation() {
  const F = { heartbeatWorstMs: 0, longTasks: 0, longTaskWorstMs: 0,
    counts: { resoudreCollisions: 0 },
    reset() { this.heartbeatWorstMs = 0; this.longTasks = 0; this.longTaskWorstMs = 0;
      this.counts.resoudreCollisions = 0; },
    read() { return { heartbeatWorstMs: Math.round(this.heartbeatWorstMs), longTasks: this.longTasks,
      longTaskWorstMs: Math.round(this.longTaskWorstMs), resoudreCollisions: this.counts.resoudreCollisions }; } };
  window.__fluid = F;
  let d = performance.now();
  setInterval(() => { const t = performance.now(), e = t - d - 32; d = t;
    if (e > F.heartbeatWorstMs) F.heartbeatWorstMs = e; }, 32);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => {
      F.longTasks += 1; F.longTaskWorstMs = Math.max(F.longTaskWorstMs, e.duration);
    })).observe({ type: "longtask", buffered: true });
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

async function mesureVille(navigateur, nom, centre, lieux, evenements) {
  const ctx = await navigateur.newContext({
    ...devices["iPhone 13"], permissions: ["geolocation"],
    geolocation: { latitude: centre.lat, longitude: centre.lng }, locale: "fr-FR",
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
    if (/\/api\/lieux|overpass/.test(url)) return json({ elements: lieuxDenses(centre, lieux) });
    if (/rpc\/evenements_proches/.test(url)) return json(evenementsDenses(centre, evenements));
    if (/rpc\//.test(url)) return json([]);
    if (/\/api\/commune/.test(url)) return json({ nom });
    if (/nominatim|openagenda|routing|osrm/.test(url)) return json([]);
    return json({});
  });
  await page.addInitScript(scriptGoogleStub);
  await page.addInitScript(scriptInstrumentation);
  await page.addInitScript(scriptSupabaseStub);
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="maintenant-liste"]');
    return e && e.dataset.mnEtat && e.dataset.mnEtat !== "loading";
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !!window.__gmap, null, { timeout: 8000 }).catch(() => {});
  /* Wrapper de comptage des collisions posé après définition. */
  await page.evaluate(() => {
    const F = window.__fluid;
    if (typeof window.resoudreCollisions === "function" && !window.resoudreCollisions.__e) {
      const f = window.resoudreCollisions;
      const g = function (...a) { F.counts.resoudreCollisions += 1; return f.apply(this, a); };
      g.__e = true; window.resoudreCollisions = g;
    }
  });
  await page.evaluate(() => window.__fluid.reset());
  /* On laisse le classement différé et les collisions se poser complètement. */
  await page.waitForTimeout(3500);
  /* Un déplacement, pour mesurer resoudreCollisions à cette densité. */
  await page.evaluate(async () => {
    const g = window.__gmap; if (!g) return;
    const t0 = performance.now();
    await new Promise((res) => { const fr = () => { g.__panBy(0.00004, 0.00005);
      if (performance.now() - t0 < 1500) requestAnimationFrame(fr); else { g.__idle(); res(); } };
      requestAnimationFrame(fr); });
  });
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const p = JSON.parse(document.documentElement.dataset.autourPerf || "{}");
    const cpu = p.cpu || {}, j = p.jauges || {};
    const phase = (k) => cpu[k] ? { t: Math.round(cpu[k].totalMs), pire: Math.round(cpu[k].pireMs), n: cpu[k].nombre } : { t: 0, pire: 0, n: 0 };
    let visibles = null;
    try { visibles = window.visibles ? window.visibles().length : null; } catch (e) {}
    return {
      dedup: j["lieux:total"] ?? (window.lieux ? window.lieux.length : null),
      visibles: j["accueil:visibles"] ?? visibles,
      filtres: j["accueil:filtres"] ?? null,
      scores: j["accueil:scores"] ?? null,
      candidats: j["recommandations:candidats"] ?? null,
      tVisibles: phase("accueil:visibles"), tFiltrage: phase("accueil:filtrage"),
      tClassement: phase("accueil:classement"), tReco: phase("recommandations"),
      tCarte: phase("rendu_carte"), tPanneau: phase("rendu_panneau"),
      tColl: phase("resoudreCollisions"), tFusion: phase("fusion:permanent"),
      tRecon: phase("reconstruction"),
    };
  });
  const f = await page.evaluate(() => window.__fluid.read());
  await ctx.close();
  return { nom, injecte: lieux, evenements, ...m, ...f };
}

const navigateur = await chromium.launch({ executablePath: CHROME });

const TOURCOING = { lat: 50.7236, lng: 3.1614 };
const LILLE = { lat: 50.6371, lng: 3.0713 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

console.log("\n════ 1. TOURCOING → LILLE → PARIS (densités représentatives, même appareil) ════");
const villes = [];
villes.push(await mesureVille(navigateur, "Tourcoing", TOURCOING, 40, 6));
villes.push(await mesureVille(navigateur, "Lille", LILLE, 120, 12));
villes.push(await mesureVille(navigateur, "Paris", PARIS, 300, 30));

const n = (v, w = 5) => String(v == null ? "—" : v).padStart(w);
function tableau(rows) {
  console.log("\n  ── comptes du pipeline ──");
  console.log("  ville        injecté  dédup  visibles  filtrés  scorés  candidats");
  for (const m of rows)
    console.log("  " + m.nom.padEnd(11) + n(m.injecte, 7) + n(m.dedup, 7) + n(m.visibles, 9) +
      n(m.filtres, 9) + n(m.scores, 8) + n(m.candidats, 10));
  console.log("\n  ── temps par phase (totalMs / pire appel) ──");
  console.log("  ville        visibles  filtrage  classmt   reco   carte  panneau  collis  fusion  recon   LT>50 pireLT  bloc");
  for (const m of rows) {
    const c = (p) => (p.t + "/" + p.pire).padStart(8);
    console.log("  " + m.nom.padEnd(11) + c(m.tVisibles) + c(m.tFiltrage) + c(m.tClassement) +
      (m.tReco.t + "/" + m.tReco.pire).padStart(7) + (m.tCarte.t + "/" + m.tCarte.pire).padStart(7) +
      c(m.tPanneau) + c(m.tColl) + c(m.tFusion) + c(m.tRecon) +
      n(m.longTasks, 6) + n(m.longTaskWorstMs, 7) + n(m.heartbeatWorstMs, 6));
  }
}
tableau(villes);

console.log("\n════ 2. PARIS — COURBE DE DÉGRADATION (50 → 500 candidats) ════");
const sweep = [];
for (const N of [50, 100, 150, 250, 500])
  sweep.push(await mesureVille(navigateur, "Paris " + N, PARIS, N, Math.min(30, Math.round(N / 10))));
tableau(sweep);

/* ---- Où est la croissance super-linéaire ? -------------------------------
   Pour chaque phase, on regarde le temps par lieu injecté. S'il est CONSTANT,
   la phase est linéaire (bonne). S'il MONTE avec N, la phase est super-linéaire
   — c'est elle qui rend Paris moins fluide que Tourcoing. */
console.log("\n──── temps par lieu injecté (µs) — s'il monte, la phase est super-linéaire ────");
const phases = [["visibles", "tVisibles"], ["filtrage", "tFiltrage"], ["classement", "tClassement"],
  ["reco", "tReco"], ["rendu_carte", "tCarte"], ["collisions", "tColl"],
  ["fusion", "tFusion"], ["reconstruction", "tRecon"]];
console.log("  phase          " + sweep.map((m) => n(m.injecte, 7)).join(""));
for (const [label, cle] of phases) {
  const parLieu = sweep.map((m) => Math.round((m[cle].t * 1000) / m.injecte));
  const monte = parLieu[parLieu.length - 1] > parLieu[0] * 1.8;
  console.log("  " + (label + (monte ? " ⚠" : "  ")).padEnd(15) + parLieu.map((v) => n(v, 7)).join("") +
    (monte ? "   ← super-linéaire" : ""));
}

serveur.close();
await navigateur.close();
console.log("\nMesure terminée.");
