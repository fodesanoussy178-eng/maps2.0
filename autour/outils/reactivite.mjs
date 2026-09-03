/* ===========================================================================
   L'IMPRESSION DE BUG, MESURÉE

   POURQUOI CE BANC EXISTE À CÔTÉ DE `vitesse.mjs` ET `fluidite.mjs`

   Les trois bancs posent trois questions différentes, et aucune ne remplace
   les autres :

     · `vitesse.mjs`   — « quand vois-je quelque chose ? » Le DÉMARRAGE.
     · `fluidite.mjs`  — « est-ce que ça saccade PENDANT le geste ? » Le fil
                          principal, image par image, avec le vrai chemin
                          Google Maps. Le budget de blocage vit là-bas.
     · celui-ci        — « est-ce que j'ai bien appuyé ? »

   La troisième question est la seule que l'utilisateur se pose à voix haute.
   Elle ne parle ni de démarrage ni d'images par seconde : elle parle du délai
   entre le DOIGT et le PREMIER PIXEL QUI BOUGE. Au-delà d'un dixième de
   seconde, un humain doute — il ré-appuie, ou il croit que c'est cassé. Ce
   banc mesure ce délai sur chaque interaction, et il échoue quand le doute
   redevient possible.

   Il garde aussi les trois états qui donnent une impression de panne même
   quand tout est rapide :

     · un écran qui se VIDE pendant qu'il se recalcule ;
     · un bandeau de chargement qui SURVIT au contenu qu'il annonçait ;
     · une carte qui DISPARAÎT pendant qu'on la déplace.

   ---------------------------------------------------------------------------
   QUATRE PIÈGES DE MESURE, ENCODÉS ICI PARCE QU'ILS ONT DÉJÀ MENTI

   Ce banc a d'abord signalé quatre interactions « sans réaction ». Les quatre
   étaient des défauts de la MESURE, pas du produit. Les corriger à l'aveugle
   aurait abîmé du code sain. Les protections sont donc dans le banc, et elles
   y restent :

     1. UNE FICHE OUVERTE RECOUVRE LA CARTE. Un geste de carte lancé après
        l'ouverture d'une fiche atterrit sur la fiche. On remet donc la carte
        au premier plan AVANT de mesurer — et `elementFromPoint` vérifie que
        c'est bien `#map` qui est sous le doigt.

     2. LE BOUTON DE RETOUR EST MASQUÉ TANT QU'ON NE S'EST PAS ÉLOIGNÉ, et
        `majBoutons()` n'est rappelé qu'après un VRAI geste — jamais après un
        `setView` programmatique. Un éloignement de test doit donc se terminer
        par un vrai déplacement à la souris, sinon le clic mesuré n'existe pas.

     3. L'OVERLAY DE RECHERCHE RESTE OUVERT en 320 px et recouvre tout.

     4. L'HORLOGE NE DOIT PAS ENJAMBER LE PROTOCOLE. Armer l'observateur dans
        un appel puis cliquer dans un autre ajoute l'aller-retour Playwright à
        la mesure — on lisait 470 ms là où l'application répond en 8 ms.
        L'horloge est donc démarrée DANS la page, par l'événement lui-même.

   La préparation de chaque acte se fait HORS chronomètre. Ce qui est mesuré
   est le geste, et rien d'autre.

   Usage :
     node outils/reactivite.mjs
     AUTOUR_REACTIVITE_VUE=320 node outils/reactivite.mjs
     AUTOUR_CHROME=/chemin/vers/chrome node outils/reactivite.mjs
   =========================================================================== */

import { chromium, webkit } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = process.env.AUTOUR_RACINE || new URL("..", import.meta.url).pathname;
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium";
/* Résolu depuis CE fichier, pas depuis le répertoire d'appel ni depuis
   `RACINE` : le banc se lance indifféremment depuis `autour/` ou la racine, et
   continue de trouver Leaflet quand on lui fait servir une copie du site
   (`AUTOUR_RACINE`) pour éprouver une régression. */
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST
  || new URL("../../node_modules/leaflet/dist", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".svg": "image/svg+xml" };

/* Lille : le même point que les autres bancs, pour que trois mesures d'un
   même dépôt parlent du même endroit. */
const HUB = { lat: 50.6371, lng: 3.0713, nom: "Lille-Flandres" };

/* 390 et 320 : le téléphone courant, et le plus étroit encore en service.
   C'est en 320 que les panneaux se recouvrent — donc là que les pièges de
   mesure ci-dessus se déclenchent. */
const VUES = [
  { nom: "mobile-390", width: 390, height: 844 },
  { nom: "mobile-320", width: 320, height: 700 },
];

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

function lieuxAutour(centre, combien) {
  return Array.from({ length: combien }, (_, i) => ({
    type: "node", id: 9000 + i,
    lat: centre.lat + ((i % 9) - 4) * 0.0011,
    lon: centre.lng + (Math.floor(i / 9) - 4) * 0.0015,
    tags: { name: "Lieu " + (i + 1),
      amenity: ["restaurant", "cafe", "bar", "cinema", "library", "pharmacy"][i % 6],
      opening_hours: "Mo-Su 00:00-24:00" },
  }));
}

function evenementsAutour(centre, combien) {
  const t = Date.now();
  return Array.from({ length: combien }, (_, i) => ({
    id: "r" + String(i).padStart(8, "0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: "Événement " + (i + 1), description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    temporal_status: "now",
    start_at: new Date(t - 36e5).toISOString(),
    end_at: new Date(t + 36e5).toISOString(),
    place_name: "Salle " + (i + 1), venue_name: "Salle " + (i + 1),
    address: (i + 1) + " rue de la Fête", city: centre.nom, insee_code: null,
    lat: centre.lat + 0.001, lng: centre.lng + 0.001,
    zone_id: "mel", primary_source: "openagenda", source_url: null,
    announcement_tags: ["concert"], importance_level: "local", importance_score: 20,
    image_url: null, cancelled: false, duplicate_of: null,
    last_source_update: null, last_synced_at: new Date().toISOString(),
  }));
}

/* Le stub Supabase : les lectures répondent, rien n'est attendu. Le banc ne
   mesure pas le réseau — il mesure la réaction de l'interface au doigt. */
const scriptSupabaseStub = () => {
  const reponse = (data) => Promise.resolve({ data, error: null });
  window.supabase = { createClient: () => ({
    from: () => ({ select: () => ({ eq() { return this; }, order() { return this; },
      limit() { return this; }, maybeSingle: () => reponse(null),
      then: (r) => reponse([]).then(r) }) }),
    /* Les RPC repartent vers les fixtures du banc. Les court-circuiter ici
       priverait l'application de ses événements, et « fiche événement »
       n'aurait plus rien à ouvrir. */
    rpc: (nom, params) => {
      const q = params ? "?" + Object.entries(params).map(([k, v]) =>
        k.replace(/^p_/, "") + "=" + encodeURIComponent(v)).join("&") : "";
      return fetch("/rpc/" + nom + q).then((r) => r.json())
        .then((data) => ({ data, error: null })).catch(() => ({ data: [], error: null }));
    },
    auth: { getSession: () => reponse({ session: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  }) };
};

/* L'horloge vit dans la page. `armer` la démarre sur l'événement lui-même —
   c'est le seul moyen de ne pas compter l'aller-retour du protocole. */
const scriptInstrumentation = () => {
  window.__rx = null;

  /* L'HORLOGE PART DU DOIGT, PAS DU CODE DU BANC.

     Ce script est injecté avant tout script de la page : son écouteur est donc
     le PREMIER de la chaîne de capture, avant ceux de l'application. C'est
     indispensable — un gestionnaire applicatif qui bloque le fil AVANT que
     notre horloge ne démarre serait invisible, et le banc déclarerait
     « instantané » une interaction qui fait douter l'utilisateur. Une
     régression de 350 ms injectée en test est passée inaperçue tant que
     l'horloge démarrait sur un écouteur posé après coup. */
  window.__dernierAppui = null;
  const stamp = () => { window.__dernierAppui = performance.now(); };
  ["pointerdown", "mousedown", "touchstart", "click", "keydown"]
    .forEach((t) => document.addEventListener(t, stamp, true));
  const masse = () => {
    const zones = [...document.querySelectorAll(
      "#feuille, #pourToi, #feuilleBesoins, #ficheCompacte, #ficheLieu, #map")];
    return zones.reduce((n, z) => n + ((z.innerText || "").trim().length), 0)
      + document.querySelectorAll(".leaflet-marker-icon, .rc-carte, .evc").length * 20;
  };
  window.__masse = masse;

  window.__armer = (selecteur) => {
    const etat = { t0: null, premier: null, mutations: 0, vide: null,
      arme: performance.now(), longtaskMax: 0, masseAvant: masse(), carteAvant: null };
    window.__dernierAppui = null;
    try {
      if (typeof map !== "undefined" && map && map.getCenter)
        etat.carteAvant = [map.getCenter().lat, map.getCenter().lng, map.getZoom()];
    } catch (e) {}

    /* On remonte au tout premier signal d'entrée reçu depuis l'armement : si
       l'application a bloqué le fil entre le doigt et nous, ce délai compte. */
    const demarrer = () => {
      if (etat.t0 != null) return;
      const appui = window.__dernierAppui;
      etat.t0 = (appui != null && appui >= etat.arme) ? appui : performance.now();
    };
    etat.demarrer = demarrer;

    etat.obs = new MutationObserver((muts) => {
      etat.mutations += muts.length;
      if (etat.t0 != null && etat.premier == null)
        etat.premier = Math.round(performance.now() - etat.t0);
    });
    etat.obs.observe(document.body, { childList: true, subtree: true,
      attributes: true, characterData: true,
      attributeFilter: ["class", "hidden", "style"] });

    try {
      etat.lt = new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          etat.longtaskMax = Math.max(etat.longtaskMax, Math.round(e.duration));
      });
      etat.lt.observe({ entryTypes: ["longtask"] });
    } catch (e) {}

    /* Un écran qui se vide pendant un recalcul est une panne perçue, même si
       tout revient une demi-seconde plus tard. On échantillonne pour le voir. */
    etat.tick = setInterval(() => {
      if (etat.t0 == null) return;
      if (masse() < etat.masseAvant * 0.35 && etat.vide == null)
        etat.vide = Math.round(performance.now() - etat.t0);
    }, 60);

    /* Quand l'acte est un vrai appui, l'horloge part de l'appui lui-même. */
    if (selecteur) {
      const el = document.querySelector(selecteur);
      if (el) {
        el.addEventListener("pointerdown", demarrer, true);
        el.addEventListener("click", demarrer, true);
      }
    }
    window.__rx = etat;
    return !!selecteur;
  };

  window.__lire = () => {
    const e = window.__rx;
    if (!e) return null;
    e.obs.disconnect();
    if (e.lt) e.lt.disconnect();
    clearInterval(e.tick);
    const c = document.querySelector("#charge");
    let carteApres = null;
    try {
      if (typeof map !== "undefined" && map && map.getCenter)
        carteApres = [map.getCenter().lat, map.getCenter().lng, map.getZoom()];
    } catch (err) {}
    /* On interroge le point RÉELLEMENT touché par le geste, pas un point
       arbitraire : sinon le contrôle parle d'un endroit que personne n'a visé. */
    const pt = e.point || { x: innerWidth / 2, y: innerHeight * 0.26 };
    /* Deux choses distinctes : ce qu'on MONTRE à l'humain (les deux premiers
       ancêtres, lisibles) et ce qu'on VÉRIFIE (toute la chaîne). Un marqueur
       est la carte : un geste qui part de lui la déplace comme un autre. */
    const chaine = (() => {
      const el = document.elementFromPoint(pt.x, pt.y);
      if (!el) return [];
      const n = (x) => (x.id ? "#" + x.id
        : x.tagName.toLowerCase() + (x.className ? "." + String(x.className).split(" ")[0] : ""));
      const ch = []; let cur = el;
      while (cur && cur !== document.body) { ch.push(n(cur)); cur = cur.parentElement; }
      return ch;
    })();
    const sousLeDoigt = chaine.slice(0, 2).join(" < ") || "rien";
    const surLaCarte = chaine.some((n) => n === "#map" || /leaflet/.test(n));
    return {
      demarree: e.t0 != null, premier: e.premier, mutations: e.mutations,
      vide: e.vide, longtaskMax: e.longtaskMax,
      bandeau: c && !c.hidden ? (c.textContent || "").trim().slice(0, 24) : "",
      masseAvant: e.masseAvant, masseApres: window.__masse(),
      carteAvant: e.carteAvant, carteApres, sousLeDoigt, surLaCarte,
    };
  };
};

async function ouvrir(navigateur, vue) {
  const ctx = await navigateur.newContext({
    viewport: { width: vue.width, height: vue.height },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    permissions: ["geolocation"],
    geolocation: { latitude: HUB.lat, longitude: HUB.lng },
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push("console: " + m.text()); });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (c) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(c) });
    if (url.startsWith(BASE) && !/\/api\/|\/rpc\//.test(url)) return route.continue();
    /* AVANT les tuiles : `maps/api/js` contient « googleapis.com/maps » et se
       ferait servir un PNG, ce que le navigateur signale en erreur console. */
    if (/maps\.googleapis\.com\/maps\/api\/js/.test(url)) return route.abort("failed");
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
    if (/\/api\/lieux|overpass/.test(url)) return json({ elements: lieuxAutour(HUB, 36) });
    if (/rpc\/evenements_locaux|rpc\/evenements_proches/.test(url))
      return json(evenementsAutour(HUB, 6));
    if (/rpc\//.test(url)) return json([]);
    if (/\/api\/commune/.test(url)) return json({ commune: HUB.nom, nom: HUB.nom });
    if (/\/api\//.test(url)) return json({ items: [] });
    if (/nominatim|openagenda|routing|osrm/.test(url)) return json([]);
    return json({});
  });

  await page.addInitScript(scriptSupabaseStub);
  await page.addInitScript(scriptInstrumentation);
  await page.goto(BASE + "/index.html?testPosition=" + HUB.lat + "," + HUB.lng);
  await page.waitForFunction(() => typeof idZoneActive === "function",
    null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1800);
  return { ctx, page, erreurs };
}

/* PIÈGE 1 ET 3 : rendre la carte réellement atteignable. Hors chronomètre. */
async function remettreLaCarteDevant(page) {
  await page.evaluate(() => {
    ["#rechercheOverlay", "#ficheLieu", "#ficheCompacte", "#locationPopover"]
      .forEach((sel) => { const e = document.querySelector(sel); if (e) e.hidden = true; });
    try { fermerFicheCompacte(); } catch (e) {}
    try { pileEcrans = []; } catch (e) {}
    try { reglerEtatFeuille("reduite"); } catch (e) {}
  });
  await page.locator('[data-nb="explorer"]').click({ timeout: 3000, force: true }).catch(() => {});
  await page.waitForTimeout(450);
}

/* La feuille basse occupe une part variable de l'écran selon la largeur et son
   état. Plutôt que de deviner une fraction — 26 % marchait en 390 et frappait
   les onglets en 320 — on CHERCHE le premier point où la carte est réellement
   au premier plan. Le banc reste juste quand la maquette bouge. */
async function pointLibreSurLaCarte(page) {
  return page.evaluate(() => {
    const m = document.querySelector("#map");
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    for (let part = 0.12; part <= 0.72; part += 0.04) {
      const y = Math.round(r.top + r.height * part);
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      let cur = el;
      while (cur && cur !== document.body) {
        if (cur.id === "map" || /leaflet/.test(String(cur.className || ""))) return { x, y };
        cur = cur.parentElement;
      }
    }
    return null;
  });
}

/* PIÈGE 2 : s'éloigner pour de vrai, geste souris compris, sinon le bouton
   de retour reste masqué et l'acte mesuré n'a jamais lieu. */
async function seloigner(page) {
  await page.evaluate(() => {
    if (typeof map !== "undefined" && map)
      map.setView([map.getCenter().lat + 0.05, map.getCenter().lng + 0.05], 13);
  });
  await page.waitForTimeout(400);
  const b = await page.locator("#map").boundingBox().catch(() => null);
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 20, b.y + b.height * 0.6 - 20);
    await page.mouse.up();
  }
  await page.waitForTimeout(700);
}

async function mesurer(page, acte) {
  if (acte.preparer) await acte.preparer(page);
  await page.evaluate((sel) => window.__armer(sel), acte.selecteur || null);
  await acte.geste(page);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => window.__lire());
  return r || {};
}

function actes(page, vue) {
  const tap = (sel) => ({ selecteur: sel,
    geste: async (p) => { await p.locator(sel).first().click({ timeout: 4000 }).catch(() => {}); } });
  /* Les ouvertures de fiche passent par la porte applicative : elles n'ont pas
     d'élément stable à écouter, l'horloge part donc juste avant l'appel. */
  const parAppel = (fn) => ({
    geste: async (p) => { await p.evaluate((src) => {
      window.__rx.demarrer();
      // eslint-disable-next-line no-new-func
      new Function(src)();
    }, fn); } });

  return [
    { nom: "Maintenant", ...tap('[data-nb="maintenant"]') },
    { nom: "Explorer", ...tap('[data-nb="explorer"]') },
    { nom: "Pour toi", ...tap('[data-nb="pourtoi"]') },
    { nom: "Aide", ...tap('[data-nb="aide"]') },
    { nom: "recherche", ...tap("#btnLoupe") },
    { nom: "retour", preparer: remettreLaCarteDevant, ...tap('[data-nb="explorer"]') },
    { nom: "fiche lieu", preparer: remettreLaCarteDevant,
      ...parAppel("const l=(lieux||[]).find(x=>x&&x.id&&!x.isTemporary); if(l) ouvrirDetail(l.id);") },
    { nom: "fiche événement", preparer: remettreLaCarteDevant,
      ...parAppel("const e=(lieux||[]).find(x=>x&&x.id&&x.isTemporary); if(e) ouvrirDetail(e.id);") },
    { nom: "pan", preparer: remettreLaCarteDevant, geste: async (p) => {
        const pt = await pointLibreSurLaCarte(p);
        if (!pt) return;
        await p.evaluate((q) => { if (window.__rx) window.__rx.point = q; }, pt);
        const cx = pt.x, cy = pt.y;
        await p.mouse.move(cx, cy);
        await p.evaluate(() => window.__rx.demarrer());
        await p.mouse.down();
        for (let i = 1; i <= 8; i += 1) {
          await p.mouse.move(cx - i * 14, cy - i * 9);
          await p.waitForTimeout(16);
        }
        await p.mouse.up();
      } },
    { nom: "pinch", preparer: remettreLaCarteDevant, geste: async (p) => {
        const pt = await pointLibreSurLaCarte(p);
        if (pt) await p.evaluate((q) => { if (window.__rx) window.__rx.point = q; }, pt);
        await p.evaluate(() => {
          window.__rx.demarrer();
          if (typeof map !== "undefined" && map) map.setZoom(Math.max(11, map.getZoom() - 3));
        });
      } },
    { nom: "changement de zone",
      preparer: async (p) => { await remettreLaCarteDevant(p); await seloigner(p); },
      ...tap("#btnAutourDeMoi") },
    { nom: "GPS",
      preparer: async (p) => { await remettreLaCarteDevant(p); await seloigner(p); },
      ...parAppel("if(typeof revenirAutourDeMoi==='function') revenirAutourDeMoi();") },
  ];
}

/* ---- LES BUDGETS ---------------------------------------------------------

   Ils ne décrivent pas la performance d'aujourd'hui : ils décrivent la limite
   au-delà de laquelle un humain doute. Le dixième de seconde est la frontière
   classique du « instantané ». Les mesures actuelles tiennent entre 3 et 22 ms
   sur les douze interactions : le budget laisse donc plus de quatre fois la
   marge, et n'échoue que sur une vraie régression, jamais sur du bruit.

   Le blocage du fil pendant un geste a son propre banc — `fluidite.mjs`, avec
   son budget de 300 ms image par image. Ici on ne garde qu'un garde-fou
   grossier : un geste ne doit pas emporter le fil principal une demi-seconde. */
const BUDGET_REACTION_MS = 100;
const BUDGET_LONGTASK_GESTE_MS = 500;

const resultats = [];
const chrome = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
let webkitDispo = true;
let wk = null;
try { wk = await webkit.launch(); }
catch (e) { webkitDispo = false; }

const navigateurs = [{ nom: "Chromium", instance: chrome }];
if (webkitDispo) navigateurs.push({ nom: "WebKit", instance: wk });

try {
  for (const nav of navigateurs) {
    for (const vue of VUES) {
      const { ctx, page, erreurs } = await ouvrir(nav.instance, vue);
      for (const acte of actes(page, vue)) {
        const m = await mesurer(page, acte);
        resultats.push({ navigateur: nav.nom, vue: vue.nom, acte: acte.nom, ...m });
        await page.waitForTimeout(250);
      }
      const propres = erreurs.filter((e) => !/favicon|net::|Failed to fetch/i.test(e));
      if (process.env.AUTOUR_REACTIVITE_DEBUG && propres.length)
        console.log("  [debug erreurs] " + propres.slice(0, 3).join(" | ").slice(0, 400));
      resultats.filter((r) => r.navigateur === nav.nom && r.vue === vue.nom)
        .forEach((r) => { r.erreurs = propres.length; });
      await page.close(); await ctx.close();
    }
  }
} finally {
  await chrome.close();
  if (wk) await wk.close();
  await new Promise((r) => serveur.close(r));
}

/* ---- LE VERDICT ---------------------------------------------------------- */
console.log("\n──── réactivité perçue : doigt → premier pixel ────\n");
console.log("navigateur vue          acte                 1er chg   vide   longtask  bandeau");
for (const r of resultats) {
  console.log(
    r.navigateur.padEnd(10), r.vue.padEnd(13), r.acte.padEnd(20),
    String(r.premier == null ? "—" : r.premier + "ms").padStart(7),
    String(r.vide == null ? "non" : r.vide + "ms").padStart(6),
    String((r.longtaskMax || 0) + "ms").padStart(9),
    (r.bandeau || "—"));
}

let echecs = 0;
const verifier = (nom, ok, detail) => {
  if (!ok) { echecs += 1; console.error("  ÉCHEC " + nom + (detail ? " — " + detail : "")); }
  return ok;
};

console.log("\n──── budgets ────");
for (const r of resultats) {
  const ou = r.navigateur + " · " + r.vue + " · " + r.acte;

  /* Un acte qui ne démarre pas l'horloge n'a pas eu lieu : c'est un défaut du
     banc, pas du produit, et il doit se voir plutôt que passer pour un succès. */
  verifier(ou + " · le geste a bien eu lieu", r.demarree === true && r.mutations > 0,
    "horloge=" + r.demarree + " mutations=" + r.mutations);

  if (r.demarree && r.mutations > 0) {
    verifier(ou + " · réaction sous " + BUDGET_REACTION_MS + " ms",
      r.premier != null && r.premier <= BUDGET_REACTION_MS,
      "premier changement " + (r.premier == null ? "jamais" : r.premier + " ms"));
  }

  verifier(ou + " · l'écran ne se vide pas", r.vide == null,
    r.vide != null ? "vidé à " + r.vide + " ms" : "");

  verifier(ou + " · aucun bandeau résiduel", !r.bandeau,
    r.bandeau ? "« " + r.bandeau + " » reste affiché" : "");

  verifier(ou + " · aucune erreur JS", !r.erreurs, r.erreurs + " erreur(s)");

  if (r.acte === "pan" || r.acte === "pinch") {
    verifier(ou + " · fil principal sous " + BUDGET_LONGTASK_GESTE_MS + " ms",
      (r.longtaskMax || 0) <= BUDGET_LONGTASK_GESTE_MS,
      "pire tâche " + r.longtaskMax + " ms");
    /* La carte doit rester la carte pendant qu'on la manipule : si un panneau
       la recouvre, le geste ne l'atteint pas et l'utilisateur croit à un gel. */
    verifier(ou + " · la carte est sous le doigt",
      r.surLaCarte === true, "sous le doigt : " + r.sousLeDoigt);
    verifier(ou + " · la carte a suivi le geste",
      JSON.stringify(r.carteAvant) !== JSON.stringify(r.carteApres),
      "centre et zoom inchangés");
  }
}

const pires = [...resultats]
  .filter((r) => r.premier != null)
  .sort((a, b) => b.premier - a.premier).slice(0, 3);
console.log("\nles trois réactions les plus lentes : " +
  pires.map((r) => r.acte + " " + r.premier + " ms (" + r.vue + ")").join(" · "));
console.log(resultats.length + " interactions mesurées" +
  (webkitDispo ? " sous Chromium et WebKit" : "  (WebKit non exécuté ici — binaire absent du bac à sable)"));

if (echecs) {
  console.error("\n" + echecs + " budget(s) de réactivité dépassé(s).");
  process.exitCode = 1;
} else {
  console.log("\nTous les budgets de réactivité sont tenus.");
}
