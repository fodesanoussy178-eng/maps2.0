/* =========================================================================
   MESURER AVANT DE MODIFIER

   Ce script joue un démarrage à froid d'Autour dans un vrai navigateur, sur un
   téléphone simulé — processeur ralenti, réseau bridé — et rend le chemin
   critique étape par étape :

     chargement page → JS → carte → géolocalisation → cache → Supabase →
     Overpass/autres sources → déduplication → classement → rendu

   Il ne modifie rien. Il répond à une seule question : OÙ PARTENT LES
   MILLISECONDES.

   Toutes les sources externes sont servies localement avec une latence
   choisie, pour que la mesure soit reproductible et pour pouvoir jouer
   « Overpass à 5 secondes » ou « Overpass en panne » à volonté.

   Usage :
     node outils/chemin-critique.mjs                       # profil par défaut
     node outils/chemin-critique.mjs --profil=overpass-lent
     node outils/chemin-critique.mjs --profil=hors-ligne --json
   ========================================================================= */

import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { chromium, devices } from "playwright";

const RACINE = process.env.RACINE_MESURE || join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const POSITION_TEST = process.env.AUTOUR_TEST_POSITION
  ? "?testPosition=" + encodeURIComponent(process.env.AUTOUR_TEST_POSITION) : "";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
};

/* ---- Profils de réseau et de sources ------------------------------------ */

const PROFILS = {
  /* Le cas courant : un réseau mobile correct, des sources qui répondent en
     une à deux secondes. C'est là que l'application doit déjà paraître
     instantanée. */
  "defaut": {
    cpu: 4, download: 1.6e6 / 8, upload: 750e3 / 8, latence: 150,
    sources: { overpass: 1800, supabase: 700, openagenda: 1200, commune: 600,
               datatourisme: 1500, google: 500, tuiles: 120, cdn: 300 },
  },
  "geolocalisation-lente": {
    cpu: 4, download: 1.6e6 / 8, upload: 750e3 / 8, latence: 150,
    geolocation: 4000,
    sources: { overpass: 1800, supabase: 700, openagenda: 1200, commune: 600,
               datatourisme: 1500, google: 500, tuiles: 120, cdn: 300 },
  },
  "supabase-lent": {
    cpu: 4, download: 1.6e6 / 8, upload: 750e3 / 8, latence: 150,
    sources: { overpass: 1800, supabase: 5000, openagenda: 1200, commune: 600,
               datatourisme: 1500, google: 500, tuiles: 120, cdn: 300 },
  },
  "google-lent": {
    cpu: 4, download: 1.6e6 / 8, upload: 750e3 / 8, latence: 150,
    sources: { overpass: 1800, supabase: 700, openagenda: 1200, commune: 600,
               datatourisme: 1500, google: 5000, tuiles: 120, cdn: 300 },
  },
  /* Overpass traîne. Rien d'autre ne change : c'est exactement le cas décrit
     — « si Overpass prend 3 ou 5 secondes ». */
  "overpass-lent": {
    cpu: 4, download: 1.6e6 / 8, upload: 750e3 / 8, latence: 150,
    sources: { overpass: 5000, supabase: 700, openagenda: 1200, commune: 600,
               datatourisme: 1500, google: 500, tuiles: 120, cdn: 300 },
  },
  /* Réseau médiocre de bout en bout. */
  "reseau-lent": {
    cpu: 6, download: 400e3 / 8, upload: 400e3 / 8, latence: 400,
    sources: { overpass: 4000, supabase: 2000, openagenda: 3000, commune: 2000,
               datatourisme: 3500, google: 3000, tuiles: 800, cdn: 1500 },
  },
  /* Tout ce qui est distant échoue. L'application doit rester utilisable. */
  "hors-ligne": {
    cpu: 4, download: 1.6e6 / 8, upload: 750e3 / 8, latence: 150,
    sources: { overpass: "panne", supabase: "panne", openagenda: "panne",
               commune: "panne", datatourisme: "panne", google: "panne", tuiles: "panne",
               cdn: "panne" },
  },
  /* Un ordinateur de bureau sur fibre : le plancher incompressible du code. */
  "rapide": {
    cpu: 1, download: 0, upload: 0, latence: 0,
    sources: { overpass: 60, supabase: 40, openagenda: 60, commune: 30,
               datatourisme: 60, google: 20, tuiles: 10, cdn: 20 },
  },
};

/* ---- Ce que renvoie chaque source simulée ------------------------------- */

const REPONSES = {
  overpass: () => JSON.stringify({ elements: jeuOverpass() }),
  commune: () => JSON.stringify({ commune: "Zone de test", cp: "00000" }),
  datatourisme: () => JSON.stringify({ lieux: [] }),
  openagenda: () => JSON.stringify({ events: [] }),
  supabase: () => JSON.stringify([]),
};

/* Un quartier dense plausible : cinquante objets, dont des parcs anonymes et
   des commerces — de quoi faire travailler déduplication et classement comme
   en vrai. Aucune ville n'est nommée : c'est une grille autour du point
   demandé. */
function jeuOverpass() {
  const out = [];
  const base = [50.0, 3.0];
  const familles = [
    ["amenity", "restaurant", "Table"], ["amenity", "cafe", "Café"],
    ["amenity", "bar", "Bar"], ["leisure", "park", null],
    ["amenity", "cinema", "Cinéma"], ["tourism", "museum", "Musée"],
    ["amenity", "library", "Bibliothèque"], ["leisure", "pitch", null],
  ];
  for (let i = 0; i < 50; i += 1) {
    const f = familles[i % familles.length];
    const tags = { [f[0]]: f[1] };
    if (f[2]) tags.name = f[2] + " " + (i + 1);
    out.push({
      type: "node", id: 1000 + i,
      lat: base[0] + ((i % 7) - 3) * 0.0018,
      lon: base[1] + (Math.floor(i / 7) - 3) * 0.0022,
      tags,
    });
  }
  return out;
}

/* ---- Le serveur local --------------------------------------------------- */

function servir(port) {
  return new Promise((pret) => {
    const serveur = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const chemin = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
      try {
        const contenu = await readFile(join(RACINE, chemin === "/" ? "index.html" : chemin));
        /* L'hébergement compresse : mesurer sans compression reviendrait à
           inventer un problème qui n'existe pas en production, et à optimiser
           un octet qui ne voyage jamais. */
        const compressible = /^(text|application)\/(html|javascript|css|json)/
          .test(MIME[extname(chemin)] || "");
        const accepte = /gzip/.test(req.headers["accept-encoding"] || "");
        const entetes = { "content-type": MIME[extname(chemin)] || "application/octet-stream" };
        /* Les mêmes règles de cache qu'en production (voir vercel.json) :
           sans elles, la deuxième visite mesurerait un navigateur amnésique
           que personne n'a jamais utilisé. */
        entetes["cache-control"] = /\.js$/.test(chemin)
          ? "public, max-age=31536000, immutable"
          : (/\/zones\//.test(chemin) ? "public, s-maxage=86400, max-age=600"
                                     : "public, max-age=0, must-revalidate");
        if (compressible && accepte) {
          entetes["content-encoding"] = "gzip";
          res.writeHead(200, entetes);
          return res.end(gzipSync(contenu));
        }
        res.writeHead(200, entetes);
        res.end(contenu);
      } catch (e) {
        res.writeHead(404).end("");
      }
    });
    serveur.listen(port, () => pret(serveur));
  });
}

/* ---- Le routage des sources externes ------------------------------------ */

function categorieDe(url) {
  if (/overpass/.test(url)) return "overpass";
  if (/supabase/.test(url)) return "supabase";
  if (/openagenda/.test(url)) return "openagenda";
  if (/maps\.googleapis|places\.googleapis/.test(url)) return "google";
  if (/\/api\/commune|nominatim/.test(url)) return "commune";
  if (/\/api\/datatourisme|\/api\/lieux/.test(url)) return "datatourisme";
  if (/basemaps|tile\./.test(url)) return "tuiles";
  if (/cdnjs|fonts\.g|jsdelivr/.test(url)) return "cdn";
  return null;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function brancherSources(page, profil, journal) {
  /* N'intercepter QUE l'extérieur. Router les requêtes de même origine les
     ferait toutes passer par le réseau : l'interception désactive le cache
     HTTP du navigateur, et la deuxième visite retéléchargerait ce qu'elle est
     précisément censée avoir gardé. La mesure mentirait exactement là où elle
     compte le plus. */
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
    const url = route.request().url();
    const categorie = categorieDe(url);
    if (!categorie) return route.abort();
    const reglage = profil.sources[categorie];
    const depart = Date.now();
    if (reglage === "panne") {
      journal.push({ categorie, url, etat: "panne", a: depart });
      return route.abort("failed");
    }
    await attendre(Number(reglage) || 0);
    journal.push({ categorie, url, ms: Date.now() - depart });
    if (categorie === "cdn" && /leaflet.*\.js(?:\?|$)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: await readFile(join(LEAFLET, "leaflet.js"), "utf8"),
      });
    }
    if (categorie === "cdn" && /leaflet.*\.css(?:\?|$)/.test(url)) {
      return route.fulfill({
        status: 200, contentType: "text/css",
        headers: { "access-control-allow-origin": "*" },
        body: await readFile(join(LEAFLET, "leaflet.css"), "utf8"),
      });
    }
    const corps = REPONSES[categorie] ? REPONSES[categorie]() : "";
    return route.fulfill({
      status: 200,
      contentType: categorie === "cdn" && /\.js$/.test(url)
        ? "application/javascript" : "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: corps,
    });
  });
}

/* ---- La mesure ---------------------------------------------------------- */

async function mesurer(nomProfil, options) {
  const o = options || {};
  const profil = PROFILS[nomProfil];
  if (!profil) throw new Error("profil inconnu : " + nomProfil);

  const port = 8100 + Math.floor(Math.random() * 400);
  const serveur = await servir(port);
  const navigateur = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const contexte = await navigateur.newContext(Object.assign({}, devices["Pixel 5"], {
    permissions: o.geo === false ? [] : ["geolocation"],
    geolocation: { latitude: 50.0, longitude: 3.0 },
    locale: "fr-FR",
  }));
  const page = await contexte.newPage();
  /* L'observateur de tâches longues est posé AVANT la page : c'est la seule
     façon de voir les blocages du fil principal qui se produisent pendant
     l'analyse des scripts, donc avant que le code de l'application n'existe. */
  await page.addInitScript(() => {
    window.__tachesLongues = [];
    try {
      new PerformanceObserver((liste) => {
        liste.getEntries().forEach((e) =>
          window.__tachesLongues.push({ debut: e.startTime, duree: e.duration }));
      }).observe({ type: "longtask", buffered: true });
    } catch (e) {}
  });
  if (profil.geolocation) {
    await page.addInitScript((delai) => {
      const geo = navigator.geolocation;
      if (!geo) return;
      const proto = Object.getPrototypeOf(geo);
      const original = proto && proto.getCurrentPosition;
      if (typeof original !== "function") return;
      proto.getCurrentPosition = function (...args) {
        setTimeout(() => original.apply(this, args), delai);
      };
    }, profil.geolocation);
  }
  const journalReseau = [];
  await brancherSources(page, profil, journalReseau);

  const session = await contexte.newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: profil.cpu });
  if (profil.download) {
    await session.send("Network.emulateNetworkConditions", {
      offline: false, latency: profil.latence,
      downloadThroughput: profil.download, uploadThroughput: profil.upload,
    });
  }

  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e.message || e).slice(0, 200)));

  const t0 = Date.now();
  await page.goto("http://127.0.0.1:" + port + "/index.html" + POSITION_TEST, { waitUntil: "commit" });
  /* Le shell doit répondre à un contact avant que le moteur complet ne soit
     évalué. On déclenche un `pointerdown` dès que le shell se déclare prêt et
     mesure le temps synchrone jusqu'à l'état actif du bouton. */
  await page.waitForFunction(() =>
    performance.getEntriesByName("autour:shell_ready").length > 0,
    null, { timeout: 3000 }).catch(() => {});
  const reactionShell = await page.evaluate(() => {
    const cible = document.querySelector("#btnAide,[data-nb]");
    if (!cible) return null;
    const debut = performance.now();
    cible.dispatchEvent(new Event("pointerdown", { bubbles:true, cancelable:true }));
    const fin = performance.now();
    const actif = cible.classList.contains("actif") || cible.getAttribute("aria-pressed") === "true";
    return { ms: Math.round(fin - debut), actif };
  });
  // on laisse la séquence de démarrage se dérouler entièrement
  await page.waitForTimeout(o.attente || 9000);
  /* LA DEUXIÈME VISITE EST LA VRAIE VISITE.

     La première paie tout : le document, les modules, le cache local encore
     vide. Toutes les suivantes — c'est-à-dire la quasi-totalité des ouvertures
     réelles — devraient partir d'un navigateur qui a déjà tout en mémoire et
     d'un stockage local qui sait où l'on était. C'est ce chiffre-là qui dit si
     l'application « s'ouvre » ou « se charge ». */
  if (o.repeat) {
    /* L'interception de requêtes (`page.route`) passe par `Fetch.enable`, qui
       DÉSACTIVE le cache HTTP du navigateur pour toute la page. Mesurer une
       deuxième visite avec le routage actif reviendrait donc à mesurer un
       navigateur amnésique — exactement le contraire de ce qu'on cherche.
       On retire le routage et on bloque l'extérieur par la voie CDP, qui
       n'a pas cet effet de bord. Les sources distantes sont alors en panne :
       c'est volontaire, ça isole le coût du code lui-même. */
    await page.unrouteAll();
    await session.send("Network.setBlockedURLs", {
      urls: ["*overpass*", "*supabase*", "*openagenda*", "*nominatim*",
             "*/api/*", "*basemaps*", "*cdnjs*", "*fonts.g*", "*jsdelivr*",
             "*maps.googleapis*"],
    });
    await page.goto("http://127.0.0.1:" + port + "/index.html" + POSITION_TEST, { waitUntil: "commit" });
    await page.waitForTimeout(o.attente || 6000);
  }

  const releve = await page.evaluate((reactionShell) => {
    const P = window.AutourPerf;
    const peintures = {};
    performance.getEntriesByType("paint").forEach((e) => {
      peintures[e.name] = Math.round(e.startTime);
    });
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const ressources = performance.getEntriesByType("resource")
      .map((r) => ({
        nom: r.name.replace(/^https?:\/\/[^/]+/, "").split("?")[0],
        type: r.initiatorType,
        debut: Math.round(r.startTime),
        duree: Math.round(r.duration),
        octets: r.transferSize || 0,
      }))
      .sort((a, b) => a.debut - b.debut);
    return {
      peintures,
      navigation: {
        responseEnd: Math.round(nav.responseEnd || 0),
        domInteractive: Math.round(nav.domInteractive || 0),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        chargement: Math.round(nav.loadEventEnd || 0),
      },
      jalons: P ? P.rapport() : {},
      chaine: P ? P.chaine() : [],
      tranches100: P ? P.tranches100(2000) : [],
      verdict: P ? P.verdict() : {},
      reseau: P ? P.reseau : null,
      cache: P ? P.cache : null,
      cpu: P ? P.cpu : null,
      lcp: P ? Math.round(P.lcp) : 0,
      ressources,
      taches: (window.__tachesLongues || []).slice(0, 25),
      premierePeintureUtile: window.__premierePeintureUtile || null,
      reactionShell,
    };
  }, reactionShell);

  releve.profil = nomProfil;
  releve.erreurs = erreurs;
  releve.journalReseau = journalReseau.map((x) => ({
    categorie: x.categorie, url: x.url, ms: x.ms == null ? "panne" : x.ms,
  }));
  releve.total = Date.now() - t0;

  await navigateur.close();
  await new Promise((r) => serveur.close(r));
  return releve;
}

/* ---- Rendu lisible ------------------------------------------------------ */

const CIBLES = {
  "first-contentful-paint": 300,
  map_ready: 500,
  premier_lieu: 700,
  maintenant_pret: 1000,
};

function afficher(r) {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  PROFIL : " + r.profil + "   (总 " + r.total + " ms d'observation)");
  console.log("════════════════════════════════════════════════════════════");

  console.log("\n── Cibles ──");
  Object.entries(CIBLES).forEach(([cle, cible]) => {
    const v = r.peintures[cle] != null ? r.peintures[cle] : r.jalons[cle];
    const etat = v == null ? "—" : (v <= cible ? "✓" : "✗");
    console.log("  " + etat + "  " + cle.padEnd(26) +
      (v == null ? "absent" : v + " ms").padStart(9) + "   cible " + cible + " ms");
  });

  console.log("\n── Navigation ──");
  Object.entries(r.navigation).forEach(([k, v]) =>
    console.log("     " + k.padEnd(26) + (v + " ms").padStart(9)));
  if (r.lcp) console.log("     " + "LCP".padEnd(26) + (r.lcp + " ms").padStart(9));
  if (r.reactionShell) console.log("     " + "réaction shell".padEnd(26) +
    (r.reactionShell.ms + " ms").padStart(9) +
    (r.reactionShell.actif ? "   état actif ✓" : "   état actif ✗"));

  console.log("\n── Chaîne de démarrage ──");
  r.chaine.forEach((l) =>
    console.log("     " + l.etape.padEnd(22) + String(l.a).padStart(9) +
                "   (+" + l.duree + ")"));

  console.log("\n── Tranches de 100 ms (0–2000 ms) ──");
  r.tranches100.forEach((l) => console.log("     " + String(l.debut).padStart(4) +
    "–" + String(l.fin).padEnd(4) + "  " + (l.jalons.join(" · ") || "—")));

  console.log("\n── Jalons, dans l'ordre ──");
  Object.entries(r.jalons).forEach(([k, v]) =>
    console.log("     " + String(v + " ms").padStart(8) + "  " + k));

  console.log("\n── Ce qui a été téléchargé (ordre d'arrivée) ──");
  const parType = {};
  r.ressources.forEach((x) => {
    parType[x.type] = (parType[x.type] || 0) + x.duree;
  });
  r.ressources.slice(0, 30).forEach((x) =>
    console.log("     " + String(x.debut + " ms").padStart(8) + " +" +
      String(x.duree + " ms").padStart(7) + "  " +
      String(Math.round(x.octets / 1024) + " ko").padStart(8) + "  " + x.nom));

  if (r.taches.length) {
    console.log("\n── Tâches longues (fil principal bloqué) ──");
    r.taches.forEach((t) =>
      console.log("     " + String(Math.round(t.debut) + " ms").padStart(8) +
        "  " + Math.round(t.duree) + " ms"));
    const total = r.taches.reduce((s, t) => s + t.duree, 0);
    console.log("     total bloqué : " + Math.round(total) + " ms");
  }

  console.log("\n── Réseau simulé ──");
  console.log("     " + JSON.stringify(r.journalReseau));
  if (r.reseau) {
    console.log("\n── Requêtes réellement parties ──");
    console.log("     total : " + r.reseau.total +
      " · démarrage : " + r.reseau.demarrage +
      " · Promises partagées : " + r.reseau.partages);
    Object.entries(r.reseau.parSource || {}).forEach(([source, nombre]) =>
      console.log("     " + source.padEnd(24) + nombre));
    if (Object.keys(r.reseau.partagesParSource || {}).length)
      console.log("     partages : " + JSON.stringify(r.reseau.partagesParSource));
  }
  if (r.cache) console.log("     cache : " + JSON.stringify(r.cache));
  if (r.erreurs.length) {
    console.log("\n── Erreurs JS ──");
    r.erreurs.forEach((e) => console.log("     " + e));
  }
  console.log("");
}

/* ---- Entrée ------------------------------------------------------------- */

const args = process.argv.slice(2);
const nomProfil = (args.find((a) => a.startsWith("--profil=")) || "--profil=defaut").slice(9);
const enJson = args.includes("--json");
const profils = nomProfil === "tous" ? Object.keys(PROFILS) : [nomProfil];

const repeat = args.includes("--repeat");
const resultats = [];
for (const p of profils) resultats.push(await mesurer(p, { repeat }));
if (enJson) console.log(JSON.stringify(resultats, null, 2));
else resultats.forEach(afficher);
