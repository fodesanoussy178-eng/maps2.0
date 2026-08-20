/* Dix minutes d'usage intensif, sans jamais recharger la page.

   Le démarrage à froid se mesure en une seconde ; une session, non. Ce qui se
   dégrade sur la durée ne se voit sur aucun jalon : des écouteurs qu'on
   rebranche sans détacher les anciens, une collection de lieux qui ne
   redescend jamais, des marqueurs qui s'accumulent hors de la carte, un cache
   qui gonfle. Rien de tout cela ne casse à la première minute — mais au bout
   de dix, l'application est lente chez quelqu'un qui ne l'a jamais rechargée.

   Le banc joue donc une vraie session : des recherches de ville qui
   s'enchaînent, des allers-retours vers « autour de moi », des groupes
   temporels, le panneau ouvert et refermé, la fiche d'un lieu. Toutes les
   trente secondes, il relève ce qui pourrait grossir, et il vérifie qu'aucune
   ville quittée ne revient à l'écran.

   Usage :
     node outils/session-longue.mjs                # dix minutes
     node outils/session-longue.mjs --minutes=2    # pour une mise au point
     AUTOUR_RACINE=livraison node outils/session-longue.mjs
*/

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { chromium, devices } from "playwright";

const RACINE = process.env.AUTOUR_RACINE || join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const MINUTES = Number((process.argv.find((a) => a.startsWith("--minutes=")) || "--minutes=10").slice(10));

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};

/* Les mêmes quatre villes que le banc des contextes : deux voisines, deux
   lointaines. C'est l'enchaînement qui compte, pas la géographie. */
const VILLES = {
  tourcoing: { centre: [50.7236, 3.1610], bb: ["50.6934", "50.7480", "3.1194", "3.1929"] },
  lille:     { centre: [50.6292, 3.0573], bb: ["50.5949", "50.6570", "2.9557", "3.1413"] },
  paris:     { centre: [48.8566, 2.3522], bb: ["48.8156", "48.9022", "2.2242", "2.4699"] },
  rouen:     { centre: [49.4432, 1.0999], bb: ["49.4100", "49.4750", "1.0200", "1.1600"] },
};

function poisAutour([lat, lng], prefixe, n = 40) {
  return Array.from({ length: n }, (_, i) => ({
    type: "node", id: prefixe.charCodeAt(0) * 100000 + i,
    lat: lat + ((i % 6) - 3) * 0.0016,
    lon: lng + (Math.floor(i / 6) - 3) * 0.0022,
    tags: { name: prefixe + " lieu " + (i + 1),
            amenity: ["restaurant", "cafe", "bar", "cinema", "library"][i % 5],
            opening_hours: "Mo-Su 00:00-24:00" },
  }));
}
function evenementsAutour([lat, lng], prefixe, n = 6) {
  const t = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: prefixe.slice(0, 1).toLowerCase() + String(i).padStart(7, "0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: prefixe + " concert " + (i + 1), description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    temporal_status: "happening_now",
    start_at: new Date(t - 3600e3).toISOString(), end_at: new Date(t + 3600e3).toISOString(),
    place_name: prefixe + " salle", address: "1 rue", city: prefixe, insee_code: null,
    lat: lat + 0.0009 * (i + 1), lng: lng + 0.0007,
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null, last_synced_at: new Date().toISOString(),
  }));
}
const DONNEES = Object.fromEntries(Object.entries(VILLES).map(([nom, v]) => [nom, {
  pois: poisAutour(v.centre, nom.toUpperCase()), evts: evenementsAutour(v.centre, nom.toUpperCase()),
}]));
const NOMS = Object.keys(VILLES).map((v) => v.toUpperCase());

function villeLaPlusProche(lat, lng) {
  let meilleure = "tourcoing", d = Infinity;
  for (const [nom, v] of Object.entries(VILLES)) {
    const x = (v.centre[0] - lat) ** 2 + (v.centre[1] - lng) ** 2;
    if (x < d) { d = x; meilleure = nom; }
  }
  return meilleure;
}

const serveur = createServer(async (req, res) => {
  const chemin = normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const contenu = await readFile(join(RACINE, chemin === "/" ? "index.html" : chemin));
    res.writeHead(200, { "content-type": MIME[extname(chemin)] || "application/octet-stream" });
    res.end(contenu);
  } catch { res.writeHead(404).end(""); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

const navigateur = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--js-flags=--expose-gc"],
});
const contexte = await navigateur.newContext(Object.assign({}, devices["Pixel 5"], {
  permissions: ["geolocation"], geolocation: { latitude: 50.7236, longitude: 3.1610 }, locale: "fr-FR",
}));
const page = await contexte.newPage();

const erreurs = [];
const requetes = new Map();
page.on("pageerror", (e) => erreurs.push(String(e.message || e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  /* Une tuile précalculée qui n'existe pas est un 404 ATTENDU : le repli est
     précisément ce que le code prévoit (voir docs/demarrage-a-froid.md).
     Le compter comme une anomalie ferait échouer le banc sur un comportement
     normal — et masquerait les vraies erreurs sous le bruit. */
  if (/OpenAgenda|Google Maps|maps\.googleapis|Refused to execute|favicon/.test(t)) return;
  if (/Failed to load resource.*40[34]/.test(t)) return;
  erreurs.push("console: " + t.slice(0, 160));
});

const json = (d) => ({ status: 200, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(d) });

await page.route("**/*", async (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) && !/\/rpc\/|\/api\//.test(u)) return route.continue();
  requetes.set(u.split("?")[0], (requetes.get(u.split("?")[0]) || 0) + 1);
  if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(u))
    return route.fulfill({ status: 200, contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  if (/leaflet.*\.js(\?|$)/.test(u))
    return route.fulfill({ status: 200, contentType: "text/javascript",
      body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
  if (/leaflet.*\.css(\?|$)/.test(u))
    return route.fulfill({ status: 200, contentType: "text/css",
      body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
  if (/supabase-js|@supabase/.test(u) && /\.js/.test(u))
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  if (/nominatim/.test(u)) {
    const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || ["", ""])[1]).toLowerCase();
    const clef = Object.keys(VILLES).find((v) => q.includes(v));
    if (!clef) return route.fulfill(json([]));
    const v = VILLES[clef];
    return route.fulfill(json([{ lat: String(v.centre[0]), lon: String(v.centre[1]),
      display_name: clef, importance: 0.8, boundingbox: v.bb }]));
  }
  if (/overpass|\/api\/lieux/.test(u)) {
    const corps = decodeURIComponent(route.request().postData() || u);
    const autour = corps.match(/around:\d+,(-?\d+\.\d+),(-?\d+\.\d+)/);
    const boite = corps.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/);
    const p = autour ? [+autour[1], +autour[2]]
            : boite ? [(+boite[1] + +boite[3]) / 2, (+boite[2] + +boite[4]) / 2]
            : VILLES.tourcoing.centre;
    return route.fulfill(json({ elements: DONNEES[villeLaPlusProche(p[0], p[1])].pois }));
  }
  if (/rpc\/evenements_proches/.test(u)) {
    const n = (k) => { const m = u.match(new RegExp("[?&]" + k + "=(-?\\d+\\.?\\d*)")); return m ? +m[1] : null; };
    const s2 = n("sud"), o2 = n("ouest"), n2 = n("nord"), e2 = n("est");
    const ville = [s2, o2, n2, e2].every((x) => x !== null)
      ? villeLaPlusProche((s2 + n2) / 2, (o2 + e2) / 2) : "tourcoing";
    return route.fulfill(json(DONNEES[ville].evts));
  }
  if (/rpc\//.test(u)) return route.fulfill(json([]));
  if (/geo\.api\.gouv|\/api\/commune/.test(u)) return route.fulfill(json([{ nom: "Tourcoing" }]));
  return route.fulfill(json([]));
});

await page.addInitScript(() => {
  const rep = (d) => Promise.resolve({ data: d, error: null });
  window.supabase = { createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => rep(null) }),
      order() { return this; }, limit() { return this; }, then: (r) => rep([]).then(r) }) }),
    rpc: (n, p) => {
      const q = p ? "?" + Object.entries(p).map(([k, v]) =>
        k.replace(/^p_/, "") + "=" + encodeURIComponent(v)).join("&") : "";
      return fetch("/rpc/" + n + q).then((r) => r.json())
        .then((d) => ({ data: d, error: null })).catch(() => ({ data: [], error: null }));
    },
    auth: { getSession: () => rep({ session: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  }) };
});

await page.goto(BASE + "/index.html");
await page.waitForTimeout(3000);

/* ---- Ce qu'on relève, et qui ne doit pas dériver ------------------------ */

const releve = () => page.evaluate(() => {
  const compte = (liste) => {
    const c = {};
    (liste || []).forEach((l) => {
      const n = ((l && (l.titre || l.title)) || "").toUpperCase();
      ["TOURCOING", "LILLE", "PARIS", "ROUEN"].forEach((v) => {
        if (n.includes(v)) c[v] = (c[v] || 0) + 1;
      });
    });
    return c;
  };
  let poses = 0;
  try { (typeof marqueurs !== "undefined" ? marqueurs : new Map()).forEach(() => { poses += 1; }); } catch (e) {}
  const memoire = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return {
    memoireMo: memoire,
    noeuds: document.getElementsByTagName("*").length,
    lieux: (typeof lieux !== "undefined" ? lieux : []).length,
    marqueurs: poses,
    stockage: Object.keys(localStorage).reduce((s, k) => s + (localStorage.getItem(k) || "").length, 0),
    zone: typeof zoneActive !== "undefined" && zoneActive
      ? { type: zoneActive.type, nom: zoneActive.nom } : null,
    visibles: compte(typeof visibles === "function" ? visibles() : []),
    maintenant: compte(typeof selectionMaintenant === "function" ? selectionMaintenant() : []),
  };
});

const chercher = async (ville) => {
  await page.evaluate((v) => {
    const champ = document.querySelector("#rech");
    if (!champ) return;
    champ.value = v;
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    const f = champ.closest("form") || document.querySelector("form");
    if (f) f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, ville);
  await page.waitForTimeout(1400);
};

const gestes = [
  async () => { await page.evaluate(() => { if (typeof ouvrirFeuille2 === "function") ouvrirFeuille2("racine"); }); },
  async () => { await page.evaluate(() => { if (typeof fermerFeuille2 === "function") fermerFeuille2(); }); },
  async () => { await page.evaluate(() => {
    const b = document.querySelector('[data-creneau="soir"]'); if (b) b.click(); }); },
  async () => { await page.evaluate(() => {
    const b = document.querySelector('[data-creneau="maintenant"]'); if (b) b.click(); }); },
  async () => { await page.evaluate(() => {
    const l = (window.lieux || [])[0];
    if (l && typeof ouvrirDetail === "function") ouvrirDetail(l.id); }); },
  async () => { await page.evaluate(() => { if (typeof fermerFeuille === "function") fermerFeuille(); }); },
  async () => { await page.evaluate(() => {
    const b = document.querySelector("#btnAutourDeMoi");
    if (b) b.click(); else if (typeof revenirAutourDeMoi === "function") revenirAutourDeMoi(); }); },
];

/* ---- La session --------------------------------------------------------- */

const anomalies = [];
const points = [];
const depart = Date.now();
const fin = depart + MINUTES * 60000;
const villes = ["Lille", "Paris", "Rouen", "Tourcoing"];
let tour = 0, prochainReleve = 0;

points.push(Object.assign({ t: 0 }, await releve()));
console.log("  session de " + MINUTES + " min — relevé toutes les 30 s\n");
console.log("     t     mém    nœuds  lieux  marq  stockage  zone");

while (Date.now() < fin) {
  const ville = villes[tour % villes.length];
  await chercher(ville);

  /* Aucune ville quittée ne doit revenir à l'écran : c'est la règle qu'on
     éprouve à chaque tour, pas seulement au premier. */
  const apres = await releve();
  const attendu = ville.toUpperCase();
  for (const autre of NOMS) {
    if (autre === attendu) continue;
    if (apres.visibles[autre]) anomalies.push(
      "t+" + Math.round((Date.now() - depart) / 1000) + "s · " + autre +
      " reste visible après « " + ville + " » (" + JSON.stringify(apres.visibles) + ")");
    if (apres.maintenant[autre]) anomalies.push(
      "t+" + Math.round((Date.now() - depart) / 1000) + "s · Maintenant garde " + autre +
      " après « " + ville + " »");
  }
  if (!apres.visibles[attendu]) anomalies.push(
    "t+" + Math.round((Date.now() - depart) / 1000) + "s · écran vide sur « " + ville + " »");

  for (const geste of gestes) { await geste(); await page.waitForTimeout(220); }

  const t = Date.now() - depart;
  if (t >= prochainReleve) {
    prochainReleve = t + 30000;
    const p = Object.assign({ t: Math.round(t / 1000) }, await releve());
    points.push(p);
    console.log("  " + String(p.t + "s").padStart(6) + String(p.memoireMo == null ? "—" : p.memoireMo + " Mo").padStart(9) +
      String(p.noeuds).padStart(9) + String(p.lieux).padStart(7) + String(p.marqueurs).padStart(6) +
      String(Math.round(p.stockage / 1024) + " ko").padStart(10) + "  " +
      (p.zone ? p.zone.type + " " + (p.zone.nom || "") : "—"));
  }
  tour += 1;
}

const dernier = points[points.length - 1];
/* LA RÉFÉRENCE EST LE PALIER, PAS LE DÉPART.

   Les lieux des villes déjà vues restent volontairement en mémoire — c'est ce
   qui rend le retour instantané. La collection grossit donc jusqu'à ce que les
   quatre villes aient été visitées, puis se stabilise. Comparer la dixième
   minute à la première mesurerait cette montée voulue, pas une fuite. On prend
   donc comme référence le relevé qui suit le premier tour complet des quatre
   villes. */
const premier = points[4] || points[points.length > 2 ? points.length - 2 : 1] || points[0];
const croissance = (cle) => (premier[cle] ? Math.round((dernier[cle] / premier[cle] - 1) * 100) : 0);

console.log("\n──── dérive sur " + MINUTES + " minutes ────");
console.log("  tours de recherche       : " + tour);
console.log("  mémoire       " + premier.memoireMo + " Mo → " + dernier.memoireMo + " Mo   (" + croissance("memoireMo") + " %)");
console.log("  nœuds DOM     " + premier.noeuds + " → " + dernier.noeuds + "   (" + croissance("noeuds") + " %)");
console.log("  lieux         " + premier.lieux + " → " + dernier.lieux + "   (" + croissance("lieux") + " %)");
console.log("  marqueurs     " + premier.marqueurs + " → " + dernier.marqueurs);
console.log("  localStorage  " + Math.round(premier.stockage / 1024) + " ko → " + Math.round(dernier.stockage / 1024) + " ko");

const resultats = [];
const ok = (nom, condition, detail) => {
  resultats.push(condition);
  console.log((condition ? "  ok     " : "  ÉCHEC  ") + nom + (condition || !detail ? "" : "  — " + detail));
};

console.log("\n──── verdict ────");
ok("aucune erreur JavaScript pendant toute la session", erreurs.length === 0,
   erreurs.slice(0, 3).join(" | "));
ok("aucune ville quittée ne revient à l’écran", anomalies.length === 0,
   anomalies.slice(0, 4).join(" | "));
ok("aucun écran vide sur une ville demandée",
   !anomalies.some((a) => /écran vide/.test(a)));
/* Les seuils : ce ne sont pas des objectifs de performance, ce sont des
   détecteurs de fuite. Une collection bornée peut grossir un peu ; elle ne
   peut pas doubler parce qu'on a cherché quarante villes. */
ok("les nœuds du document ne dérivent pas", croissance("noeuds") < 40,
   premier.noeuds + " → " + dernier.noeuds);
ok("la collection de lieux reste bornée", dernier.lieux < premier.lieux * 3 + 200,
   premier.lieux + " → " + dernier.lieux);
ok("les marqueurs ne s’accumulent pas hors écran", dernier.marqueurs <= 200,
   String(dernier.marqueurs));
ok("le stockage local reste borné", dernier.stockage < 3 * 1024 * 1024,
   Math.round(dernier.stockage / 1024) + " ko");
if (dernier.memoireMo != null)
  ok("la mémoire ne double pas sur la durée", dernier.memoireMo < premier.memoireMo * 2 + 20,
     premier.memoireMo + " Mo → " + dernier.memoireMo + " Mo");

const total = resultats.length, passes = resultats.filter(Boolean).length;
console.log("\n" + passes + "/" + total + " vérifications passées");

await navigateur.close();
await new Promise((r) => serveur.close(r));
process.exitCode = passes === total ? 0 : 1;
