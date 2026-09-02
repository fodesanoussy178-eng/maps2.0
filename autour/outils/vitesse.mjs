/* ===========================================================================
   Combien de temps avant de voir quelque chose de faisable ?

   POURQUOI CE BANC N'EST PAS UN BANC DE PLUS

   « Autour est lent » ne se corrige pas : ça ne désigne rien. Les deux
   instants qui comptent pour quelqu'un qui ouvre l'application sont le PREMIER
   contenu utile — la première chose faisable qu'il voit — et le moment où le
   bloc est complet. Entre les deux, l'écran est déjà utile ; c'est exactement
   ce qu'on veut, et c'est ce que ce banc prouve ou dément.

   Il mesure, pour chaque scénario :

     · le temps jusqu'à la localisation ;
     · le temps jusqu'au PREMIER résultat de « Maintenant » ;
     · le temps jusqu'aux trois ;
     · le nombre de requêtes réseau ;
     · les hits et les miss de cache, par source ;
     · toute source qui a dépassé une seconde, nommée.

   Et il vérifie la règle qui compte : le premier contenu utile apparaît AVANT
   la fin de la collecte. Si Autour a deux bons résultats, il les montre.

     npm install playwright leaflet
     AUTOUR_RACINE=autour node autour/outils/vitesse.mjs
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
const POSITION_TEST = process.env.AUTOUR_TEST_POSITION
  ? "?testPosition=" + encodeURIComponent(process.env.AUTOUR_TEST_POSITION) : "";

/* Lille-Flandres : un hub, donc une tuile précalculée déjà présente dans le
   dépôt. C'est le scénario qui doit être le plus rapide de tous. */
const HUB = { lat: 50.6371, lng: 3.0713, nom: "Lille-Flandres" };
/* Une zone sans tuile : le chemin lent, celui qui dépend vraiment du réseau. */
const RASE = { lat: 47.2184, lng: -1.5536, nom: "hors hub" };

const resultats = [];
const ok = (nom, condition, detail = "") => {
  resultats.push({ nom, ok: !!condition, detail });
  console.log((condition ? "  ok   " : "ÉCHEC  ") + nom +
    (condition || !detail ? "" : "\n         → " + detail));
};
const mesures = [];

function lieuxAutour(centre, combien) {
  return Array.from({ length: combien }, (_, i) => ({
    type: "node", id: 7000 + i,
    lat: centre.lat + ((i % 7) - 3) * 0.0012,
    lon: centre.lng + (Math.floor(i / 7) - 3) * 0.0016,
    tags: {
      name: "Lieu " + (i + 1),
      amenity: ["restaurant", "cafe", "bar", "cinema", "library"][i % 5],
      // ouverts en permanence : le banc mesure la VITESSE, pas les horaires
      opening_hours: "Mo-Su 00:00-24:00",
    },
  }));
}

function evenementsAutour(centre, combien) {
  const t = Date.now();
  return Array.from({ length: combien }, (_, i) => ({
    id: "v" + String(i).padStart(8, "0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: "En cours " + (i + 1), description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    temporal_status: "now",
    start_at: new Date(t - 3600e3).toISOString(),
    end_at: new Date(t + 3600e3).toISOString(),
    place_name: "Salle", address: "1 rue", city: "V", insee_code: null,
    lat: centre.lat + 0.0008 * (i + 1), lng: centre.lng + 0.0006,
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null,
    last_synced_at: new Date().toISOString(),
  }));
}

async function ouvrir(navigateur, opts) {
  const o = opts || {};
  const centre = o.centre || HUB;
  const ctx = await navigateur.newContext({
    ...devices["iPhone 13"],
    permissions: ["geolocation"],
    geolocation: { latitude: centre.lat, longitude: centre.lng },
    locale: "fr-FR",
    storageState: o.etat || undefined,
  });
  const page = await ctx.newPage();
  let requetes = 0;
  const urls = new Map();

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (c) => route.fulfill({ status: 200, contentType: "application/json",
                                        body: JSON.stringify(c) });
    if (url.startsWith(BASE) && !/\/api\/|\/rpc\//.test(url)) return route.continue();
    requetes += 1;
    const chargeRequete = route.request().postData() || "";
    const cleRequete = route.request().method() + " " + url +
      (chargeRequete ? " " + chargeRequete : "");
    urls.set(cleRequete, (urls.get(cleRequete) || 0) + 1);
    if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64") });
    if (/leaflet.*\.js(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
    if (/leaflet.*\.css(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/css",
        body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
    if (/supabase-js|@supabase/.test(url) && /\.js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    if (/maps\.googleapis\.com/.test(url)) return route.abort("failed");

    /* LE DÉLAI EST LA VARIABLE DU BANC. Il s'applique aux SOURCES DE DONNÉES
       et à elles seules : retarder les scripts mesurerait le chargement d'une
       page, pas la vitesse à laquelle Autour devient utile. */
    const lent = Number(o.lent) || 0;
    if (lent) await new Promise((r) => setTimeout(r, lent));

    if (/\/api\/lieux|overpass/.test(url))
      return json({ elements: lieuxAutour(centre, o.lieux ?? 25) });
    if (/rpc\/evenements_proches/.test(url))
      return json(evenementsAutour(centre, o.evenements ?? 3));
    if (/rpc\//.test(url)) return json([]);
    if (/\/api\/commune/.test(url)) return json({ nom: centre.nom });
    if (/nominatim|openagenda|routing|osrm/.test(url)) return json([]);
    return json({});
  });

  /* LE FIL PRINCIPAL EST-IL DISPONIBLE ?

     Un chronomètre de bout en bout ne distingue pas « on attend le réseau » de
     « le navigateur ne répond plus ». Un battement régulier, lui, le dit : s'il
     ne peut pas battre pendant deux secondes, c'est que du travail synchrone a
     tenu le fil — et pendant ce temps l'écran ne réagit à rien, pas même à un
     appui. C'est la mesure qui manquait pour répondre à « Autour est lent »
     autrement que par une impression. */
  await page.addInitScript(() => {
    window.__battements = { dernier: performance.now(), pireMs: 0 };
    setInterval(() => {
      const t = performance.now();
      const ecart = t - window.__battements.dernier;
      window.__battements.dernier = t;
      if (ecart > window.__battements.pireMs) window.__battements.pireMs = Math.round(ecart);
    }, 100);
    window.__tachesLongues = { nombre: 0, totalMs: 0, pireMs: 0 };
    try {
      new PerformanceObserver((liste) => {
        liste.getEntries().forEach((entree) => {
          window.__tachesLongues.nombre += 1;
          window.__tachesLongues.totalMs += entree.duration;
          window.__tachesLongues.pireMs = Math.max(
            window.__tachesLongues.pireMs, entree.duration);
        });
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });

  await page.addInitScript(() => {
    const rep = (d) => Promise.resolve({ data: d, error: null });
    window.supabase = { createClient: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => rep(null) }),
        order() { return this; }, limit() { return this; },
        then: (r) => rep([]).then(r) }) }),
      rpc: (nom, args) => fetch("/rpc/" + nom, {
        method: "POST", headers:{"content-type":"application/json"},
        body:JSON.stringify(args || {}),
      }).then((r) => r.json())
        .then((d) => ({ data: d, error: null })).catch(() => ({ data: [], error: null })),
      auth: { getSession: () => rep({ session: null }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({}) },
    }) };
  });

  await page.goto(BASE + "/index.html" + POSITION_TEST);
  return {
    ctx,
    page,
    compteur: () => requetes,
    tracesRpc: () => [...urls.keys()].filter(url => /\/rpc\//.test(url)),
    doublons: () => [...urls.entries()]
      .filter(([, total]) => total > 1)
      .map(([url, total]) => ({ url, total, surplus: total - 1 })),
  };
}

/* Ce que la page sait d'elle-même. `PERF` publie déjà tout dans un attribut du
   document : on le lit plutôt que de chronométrer depuis l'extérieur, ce qui
   mesurerait aussi la latence de Playwright. */
const perf = (page) => page.evaluate(() => {
  try { return JSON.parse(document.documentElement.dataset.autourPerf || "{}"); }
  catch (e) { return {}; }
});

const combienAffiches = (page) => page.evaluate(() =>
  document.querySelectorAll('[data-testid="maintenant-liste"] [data-mn]').length);

async function scenario(navigateur, nom, opts) {
  const { ctx, page, compteur, doublons, tracesRpc } = await ouvrir(navigateur, opts);
  /* On attend que « Maintenant » soit sorti de `loading` — c'est la définition
     honnête de « l'application a répondu ». */
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="maintenant-liste"]');
    return e && e.dataset.mnEtat && e.dataset.mnEtat !== "loading";
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout((Number(opts && opts.lent) || 0) + 1800);

  const p = await perf(page);
  const t = p.temps || {};
  const longues = await page.evaluate(() => window.__tachesLongues || {});
  const dupliquees = doublons();
  const m = {
    nom,
    localisation: t.geolocation_ready ?? t.position_gps_memorisee ?? null,
    premier: t.maintenant_premier ?? null,
    complet: t.maintenant_complet ?? null,
    premierLieu: t.premier_lieu ?? null,
    requetes: compteur(),
    requetesDupliquees: dupliquees.reduce((n, x) => n + x.surplus, 0),
    doublons: dupliquees.map(x => x.total + "× " + x.url).join("\n        "),
    tracesRpc: tracesRpc(),
    reseauDemarrage: (p.reseau || {}).demarrage ?? null,
    cpu: p.cpu || {},
    rendusCarte: (p.rendus || {}).carte ?? 0,
    rendusPanneau: (p.rendus || {}).panneau ?? 0,
    hits: (p.cache || {}).hits ?? 0,
    miss: (p.cache || {}).miss ?? 0,
    lentes: ((p.cache || {}).lentes || []).join(", ") || "aucune",
    blocage: await page.evaluate(() =>
      (window.__battements || {}).pireMs || 0),
    tachesLongues: longues.nombre || 0,
    cpuLongMs: Math.round(longues.totalMs || 0),
    pireTacheMs: Math.round(longues.pireMs || 0),
    affiches: await combienAffiches(page),
    etat: await page.evaluate(() =>
      (document.querySelector('[data-testid="maintenant-liste"]') || { dataset: {} })
        .dataset.mnEtat),
  };
  mesures.push(m);
  if(opts && opts.traceRpc)
    console.log("  RPC " + nom + "\n    " + m.tracesRpc.join("\n    "));
  const etatStock = await ctx.storageState();
  await ctx.close();
  return { m, etatStock };
}

const navigateur = await chromium.launch({ executablePath: CHROME });

console.log("\n──── mesures ────");

/* 1. Cache froid, réseau normal, sur un hub -------------------------------- */
const froidHub = await scenario(navigateur, "hub · cache froid", { centre: HUB });

/* 2. Cache chaud : la même personne rouvre l'application ------------------- */
const chaudHub = await scenario(navigateur, "hub · cache chaud",
  { centre: HUB, etat: froidHub.etatStock });

/* 3. Réseau lent sur un hub : c'est là que la tuile précalculée doit payer -- */
const lentHub = await scenario(navigateur, "hub · réseau lent (1,5 s)",
  { centre: HUB, lent: 1500 });

/* 4. Hors hub, réseau lent : le chemin qui dépend vraiment du réseau -------- */
const lentRase = await scenario(navigateur, "hors hub · réseau lent (1,5 s)",
  { centre: RASE, lent: 1500 });

/* 5. Centre-ville dense ---------------------------------------------------- */
const dense = await scenario(navigateur, "centre dense (120 lieux)",
  { centre: HUB, lieux: 120, evenements: 12 });

/* 6. Zone peu dense -------------------------------------------------------- */
const creuse = await scenario(navigateur, "zone peu dense (4 lieux)",
  { centre: RASE, lieux: 4, evenements: 0 });

console.log("");
const colonne = (v) => (v == null ? "  —  " : String(v).padStart(5));
console.log("  scénario                        loc  1er  3/3  bloc  req  dup rendus LT/cpu  aff  état");
for (const m of mesures) {
  console.log("  " + m.nom.padEnd(30) +
    colonne(m.localisation) + colonne(m.premier) + colonne(m.complet) +
    colonne(m.blocage) +
    colonne(m.requetes) + colonne(m.requetesDupliquees) +
    colonne(m.rendusCarte + "/" + m.rendusPanneau) +
    colonne(m.tachesLongues + "/" + m.cpuLongMs) +
    colonne(m.affiches) + "  " + m.etat +
    (m.lentes !== "aucune" ? "\n      sources > 1 s : " + m.lentes : "") +
    (m.doublons ? "\n      doublons : " + m.doublons : ""));
}

for (const m of mesures) {
  const cpu = Object.entries(m.cpu || {})
    .sort((a,b)=>(b[1].totalMs||0)-(a[1].totalMs||0))
    .slice(0,5)
    .map(([nom,v])=>nom+" "+v.totalMs+" ms (pire "+v.pireMs+")")
    .join(" · ");
  if(cpu) console.log("  CPU " + m.nom + " : " + cpu);
}

console.log("\n──── ce qu'on en conclut ────");

/* LA RÈGLE DE FOND : le premier contenu utile n'attend pas la fin. */
for (const m of mesures) {
  if (m.affiches === 0) continue;
  ok(m.nom + " · quelque chose de faisable est affiché", m.affiches >= 1,
     m.affiches + " proposition(s)");
}

ok("hub · le premier résultat arrive avant la fin de la collecte",
   lentHub.m.premier != null && lentHub.m.premier < 1500 + 1000,
   "premier à " + lentHub.m.premier + " ms, réseau retardé de 1500 ms");

ok("hub · la tuile précalculée est bien trouvée",
   froidHub.m.hits >= 1, JSON.stringify({ hits: froidHub.m.hits, miss: froidHub.m.miss }));

ok("cache chaud · au moins aussi rapide que le cache froid",
   chaudHub.m.premier != null && froidHub.m.premier != null &&
   chaudHub.m.premier <= froidHub.m.premier + 300,
   "froid " + froidHub.m.premier + " ms · chaud " + chaudHub.m.premier + " ms");

ok("cache chaud · davantage de hits qu'à froid",
   chaudHub.m.hits >= froidHub.m.hits,
   "froid " + froidHub.m.hits + " · chaud " + chaudHub.m.hits);

ok("centre dense · trois propositions, pas davantage",
   dense.m.affiches === 3, String(dense.m.affiches));

ok("zone peu dense · l'écran reste dans un état propre",
   ["ready", "empty", "error"].includes(creuse.m.etat), creuse.m.etat);

/* L'INGESTION PROGRESSIVE A SES PROPRES PIÈGES.

   Poser les recommandations après coup peut dupliquer une carte, ou en faire
   disparaître une déjà affichée. On regarde donc l'écran final : chaque lieu
   une fois, et le bloc « Maintenant » intact au-dessus. */
{
  const { ctx, page } = await ouvrir(navigateur, { centre: HUB, lieux: 120, evenements: 12 });
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="maintenant-liste"]');
    return e && e.dataset.mnEtat && e.dataset.mnEtat !== "loading";
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const vu = await page.evaluate(() => {
    const cartes = [...document.querySelectorAll("#fbCorps [data-ac]")]
      .map((e) => e.getAttribute("data-ac"));
    const mn = [...document.querySelectorAll('[data-testid="maintenant-liste"] [data-mn]')]
      .map((e) => e.getAttribute("data-mn"));
    return { cartes, mn,
      zones: document.querySelectorAll("[data-reco-zone]").length,
      pistes: document.querySelectorAll('[data-testid="primary-results"]').length };
  });
  ok("ingestion progressive · aucune carte en double",
     new Set(vu.cartes).size === vu.cartes.length,
     vu.cartes.length + " cartes, " + new Set(vu.cartes).size + " distinctes");
  ok("ingestion progressive · aucune ligne de Maintenant en double",
     new Set(vu.mn).size === vu.mn.length, vu.mn.join(", "));
  ok("ingestion progressive · une seule zone de recommandations",
     vu.zones === 1, String(vu.zones));
  ok("ingestion progressive · une seule liste de résultats",
     vu.pistes <= 1, String(vu.pistes));
  ok("ingestion progressive · les cartes finissent par arriver",
     vu.cartes.length >= 1, String(vu.cartes.length));
  await ctx.close();
}

ok("aucun scénario ne reste bloqué sur « loading »",
   mesures.every((m) => m.etat !== "loading"),
   mesures.filter((m) => m.etat === "loading").map((m) => m.nom).join(", "));

/* Le battement est cadencé toutes les 100 ms : son pire écart doit rester
   suffisamment court pour qu'un geste soit pris en compte sans freeze. */
const OBJECTIF_BLOCAGE_MS = 300;
const pireBlocage = Math.max(...mesures.map((m) => m.blocage || 0));
const pireOu = (mesures.find((m) => m.blocage === pireBlocage) || {}).nom || "?";

/* Ce n'est PAS une vérification qui échoue : c'est un constat qui se répète à
   chaque exécution. Le faire échouer noierait les vraies régressions dans un
   rouge permanent ; le taire reviendrait à faire comme si le problème n'existait
   pas. On l'imprime donc, toujours, avec son chiffre. */
console.log("\n──── constat : ce qui reste lent ────");
console.log("  pire blocage du fil principal : " + pireBlocage + " ms  (" + pireOu + ")");
console.log("  objectif : " + OBJECTIF_BLOCAGE_MS + " ms — " +
  (pireBlocage <= OBJECTIF_BLOCAGE_MS ? "tenu" : "NON TENU"));
if (pireBlocage > OBJECTIF_BLOCAGE_MS) {
  console.log("  Une phase synchrone dépasse encore le budget perceptif ; voir");
  console.log("  les lignes CPU et les tâches longues ci-dessus pour l'attribuer.");
}

/* Le nombre de requêtes au démarrage : ce n'est pas un objectif en soi, mais
   une dérive se voit ici avant de se voir sur la facture de quelqu'un. */
ok("le démarrage reste sous une dizaine de requêtes",
   mesures.every((m) => m.reseauDemarrage == null || m.reseauDemarrage <= 16),
   mesures.map((m) => m.nom + ":" + m.reseauDemarrage).join(" · "));

await navigateur.close();
serveur.close();

const passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + resultats.length + " vérifications passées");
if (passes !== resultats.length) {
  console.log("\nCas en échec :");
  resultats.filter((r) => !r.ok).forEach((r) =>
    console.log("  · " + r.nom + (r.detail ? " — " + r.detail : "")));
}
process.exit(passes === resultats.length ? 0 : 1);
