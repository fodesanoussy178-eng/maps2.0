/* ===========================================================================
   Test de stabilité intensif — Autour dans un vrai navigateur

   Ce que ça fait : sert `autour/` en statique, bouchonne TOUT ce qui sort
   (Overpass, Supabase, DATAtourisme, OpenAgenda, tuiles, SDK Google) et
   rejoue les parcours qui cassent une application cartographique :

     · ouvrir et fermer 30 fiches à la suite ;
     · 60 déplacements de carte plus rapides que le debounce ;
     · Explorer → Aide → Explorer → Créer → Explorer → Favoris → Explorer ;
     · les quatre cas temporels (en cours / demain / terminé / annulé) ;
     · Aide face à une détresse et face à une réparation ;
     · réseau lent, API en panne, géolocalisation refusée.

   Ce qu'il cherche : page blanche, panneaux superposés, carte reconstruite,
   marqueurs fantômes, requêtes qui s'accumulent, contexte perdu, RECHARGEMENT
   DE PAGE — c'est ce dernier qui a révélé le défaut d'historique.

   Prérequis (hors du dépôt, volontairement : ce sont des outils, pas des
   dépendances d'Autour) :

     npm install playwright leaflet @supabase/supabase-js
     node outils/stabilite.mjs

   Réglable par variables d'environnement : AUTOUR_RACINE, AUTOUR_CHROME,
   AUTOUR_LEAFLET_DIST, AUTOUR_SUPABASE_UMD.

   Leaflet et le SDK Supabase sont servis depuis le disque : leurs CDN ne sont
   pas toujours joignables, et sans eux la moitié des scénarios se testerait
   dans le vide sans que rien ne le dise.
   ======================================================================== */

import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
const SUPA = process.env.AUTOUR_SUPABASE_UMD ||
  "node_modules/@supabase/supabase-js/dist/umd/supabase.js";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";

const RACINE = process.env.AUTOUR_RACINE ||
  new URL("..", import.meta.url).pathname;
const CHROME = process.env.AUTOUR_CHROME ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml" };

const serveur = createServer(async (req, res) => {
  let chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin === "/" || chemin.startsWith("/l/") || chemin.startsWith("/e/")) chemin = "/index.html";
  const fichier = join(RACINE, chemin);
  try {
    const s = await stat(fichier);
    if (!s.isFile()) throw new Error("dir");
    res.writeHead(200, { "content-type": TYPES[extname(fichier)] || "application/octet-stream" });
    res.end(await readFile(fichier));
  } catch { res.writeHead(404); res.end("non"); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

/* ---- Un jeu de lieux et d'événements plausible, servi par les bouchons ---- */
const CENTRE = { lat: 50.6292, lng: 3.0573 };          // une ville quelconque
const osmElements = Array.from({ length: 40 }, (_, i) => ({
  type: "node", id: 1000 + i,
  lat: CENTRE.lat + (i % 8) * 0.0016 - 0.006,
  lon: CENTRE.lng + Math.floor(i / 8) * 0.0022 - 0.005,
  tags: {
    name: "Lieu d'essai " + (i + 1),
    ...(i % 5 === 0 ? { amenity: "restaurant" }
      : i % 5 === 1 ? { amenity: "cafe" }
      : i % 5 === 2 ? { leisure: "park" }
      : i % 5 === 3 ? { amenity: "library" }
      : { amenity: "social_facility", social_facility: "food_bank" }),
    "opening_hours": "Mo-Su 00:00-24:00",
  },
}));

const maintenant = Date.now();
const evenements = [
  { id:"11111111-1111-1111-1111-111111111111", publication_id:null, title:"Concert en cours",
    description:"", category:"concert", start_at:new Date(maintenant-3600e3).toISOString(),
    end_at:new Date(maintenant+3600e3).toISOString(), timezone:"Europe/Paris",
    temporal_status:"now", date_confidence:"exact", place_name:"Salle A", address:"1 rue A",
    city:"Ville", insee_code:null, lat:CENTRE.lat+0.001, lng:CENTRE.lng+0.001,
    primary_source:"datatourisme", source_url:null, image_url:null, cancelled:false,
    last_source_update:null, last_synced_at:new Date().toISOString() },
  { id:"22222222-2222-2222-2222-222222222222", publication_id:null, title:"Marché demain",
    description:"", category:"marche", start_at:new Date(maintenant+30*3600e3).toISOString(),
    end_at:new Date(maintenant+34*3600e3).toISOString(), timezone:"Europe/Paris",
    temporal_status:"upcoming", date_confidence:"exact", place_name:"Place B", address:"2 rue B",
    city:"Ville", insee_code:null, lat:CENTRE.lat+0.002, lng:CENTRE.lng+0.002,
    primary_source:"datatourisme", source_url:null, image_url:null, cancelled:false,
    last_source_update:null, last_synced_at:new Date().toISOString() },
  { id:"33333333-3333-3333-3333-333333333333", publication_id:null, title:"Atelier annulé",
    description:"", category:"event", start_at:new Date(maintenant-1800e3).toISOString(),
    end_at:new Date(maintenant+1800e3).toISOString(), timezone:"Europe/Paris",
    temporal_status:"past", date_confidence:"exact", place_name:"Lieu C", address:"3 rue C",
    city:"Ville", insee_code:null, lat:CENTRE.lat+0.003, lng:CENTRE.lng+0.003,
    primary_source:"datatourisme", source_url:null, image_url:null, cancelled:true,
    last_source_update:null, last_synced_at:new Date().toISOString() },
];

const compteurs = { overpass:0, evenements:0, publications:0, datatourisme:0 };

async function bouchonner(page, { lent = false, panne = false } = {}) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (corps, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(corps) });

    /* Les routes serveur sont sur NOTRE origine : elles doivent être
       bouchonnées avant la passe-plat vers le serveur de fichiers, sinon
       /api/lieux répond 404 et l'application n'a jamais aucun lieu. */
    if (url.startsWith(BASE) && !/\/api\//.test(url)) return route.continue();

    // tuiles de fond : un pixel, jamais le vrai CDN
    if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });

    /* Leaflet vient d'un CDN injoignable depuis ce bac à sable : on sert la
       même version depuis le disque, sinon la carte n'existe jamais et tous
       les scénarios « carte » se testent dans le vide. */
    if (/leaflet.*\.js(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
    if (/leaflet.*\.css(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/css",
        body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
    /* Le SDK Supabase vient lui aussi d'un CDN injoignable ici : sans lui,
       `createClient` est absent, aucun événement n'est jamais demandé, et les
       scénarios « événements » se testeraient dans le vide. */
    if (/supabase-js|@supabase/.test(url) && /\.js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: await readFile(SUPA, "utf8") });
    // le SDK Google n'est pas joignable ici : on le fait échouer proprement,
    // ce qui est exactement le repli CARTO/OSM que l'application doit tenir
    if (/maps\.googleapis\.com/.test(url)) return route.abort("failed");

    if (lent) await new Promise((r) => setTimeout(r, 3000));
    if (panne) return route.abort("failed");

    if (/\/api\/lieux/.test(url)) { compteurs.overpass++; return json({ elements: osmElements }); }
    if (/overpass/.test(url))     { compteurs.overpass++; return json({ elements: osmElements }); }
    if (/\/api\/datatourisme/.test(url)) { compteurs.datatourisme++; return json({ items: [] }); }
    if (/\/api\/commune/.test(url)) return json({ nom: "Ville d'essai" });
    if (/rpc\/evenements_proches/.test(url)) { compteurs.evenements++; return json(evenements); }
    if (/rpc\/publications_proches/.test(url)) { compteurs.publications++; return json([]); }
    if (/rpc\//.test(url) || /supabase/.test(url)) return json([]);
    if (/openagenda/.test(url)) return json({ events: [], agendas: [] });
    if (/nominatim/.test(url)) return json([]);
    if (/router\.project-osrm|routing/.test(url)) return json({ routes: [] });
    return json({});
  });
}

/* ---- Instrumentation : ce qu'on ne veut jamais voir --------------------- */
const anomalies = [];
function surveiller(page, etiquette) {
  page.on("pageerror", (e) => anomalies.push(`[${etiquette}] erreur JS : ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // les 4xx/5xx bouchonnés et les avertissements de ressources ne comptent pas
    if (/Failed to load resource|net::ERR|favicon|manifest/.test(t)) return;
    // journalisation volontaire d'une source indisponible : c'est le
    // comportement attendu, pas un défaut
    if (/OpenAgenda|Google Maps|maps\.googleapis|Refused to execute/.test(t)) return;
    anomalies.push(`[${etiquette}] console.error : ${t.slice(0, 200)}`);
  });
}

const etatUI = () => ({
  // combien de panneaux principaux sont ouverts EN MÊME TEMPS
  panneaux: ["feuille", "feuilleBesoins", "ficheCompacte", "rechercheOverlay"]
    .filter((id) => { const e = document.getElementById(id); return e && !e.hidden; }),
  carte: !!(window.__map && document.getElementById("map") &&
            document.getElementById("map").classList.contains("leaflet-container")),
  marqueurs: document.querySelectorAll(".leaflet-marker-icon").length,
  navActif: [...document.querySelectorAll("#navBas .nb.actif")].map((b) => b.dataset.nb),
  scrollBody: document.body.scrollTop,
  centre: window.__carteCentre ? window.__carteCentre() : null,
});

const resultats = [];
const ok = (nom, condition, detail = "") =>
  resultats.push({ nom, ok: !!condition, detail });

async function nouvelOnglet(navigateur, opts = {}) {
  const ctx = await navigateur.newContext({
    ...(opts.mobile ? devices["iPhone 13"] : {}),
    permissions: ["geolocation"],
    geolocation: { latitude: CENTRE.lat, longitude: CENTRE.lng },
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  surveiller(page, opts.etiquette || "page");
  await bouchonner(page, opts);
  await page.addInitScript(() => {
    /* `map`, `lieux`, `creneau` sont des `let` de script : ils n'existent pas
       sur window. On attrape donc l'instance de carte par un init hook
       Leaflet, posé dès que le CDN affecte window.L. */
    let vraiL;
    Object.defineProperty(window, "L", {
      configurable: true,
      get() { return vraiL; },
      set(v) {
        vraiL = v;
        // Leaflet affecte d'abord un objet VIDE puis le remplit : on ne peut
        // pas poser le hook dans le setter, il faut attendre L.Map.
        const attente = setInterval(() => {
          if (!vraiL || !vraiL.Map || !vraiL.Map.addInitHook) return;
          clearInterval(attente);
          vraiL.Map.addInitHook(function () {
            window.__map = this;
            window.__cartesCreees = (window.__cartesCreees || 0) + 1;
          });
        }, 0);
      },
    });
    window.__carteCentre = () => {
      const m = window.__map;
      if (!m || !m.getCenter) return null;
      const c = m.getCenter();
      return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), z: m.getZoom() };
    };
    window.__creneauActif = () => {
      const t = document.querySelector('.ong[aria-selected="true"]');
      return t ? t.dataset.creneau : null;
    };
  });
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  // exposer l'instance de carte pour pouvoir vérifier qu'elle ne change pas
  await page.waitForFunction(() => !!document.getElementById("map"), null, { timeout: 15000 });
  await page.waitForTimeout(opts.attente || 3500);
  return { ctx, page };
}

const navigateur = await chromium.launch({ executablePath: CHROME });

/* ===================================================================== */
/* 1. FICHES — ouvrir et fermer 30 lieux successivement                  */
/* ===================================================================== */
{
  const { ctx, page } = await nouvelOnglet(navigateur, { mobile: true, etiquette: "fiches" });
  const avant = await page.evaluate(etatUI);
  let superpositions = 0, blanches = 0, echecsOuverture = 0;

  for (let i = 0; i < 30; i++) {
    const ouvert = await page.evaluate((n) => {
      const ids = (window.visibles ? window.visibles() : []).map((l) => l.id);
      if (!ids.length) return false;
      const id = ids[n % ids.length];
      if (typeof window.ouvrirDetail !== "function") return false;
      window.pileEcrans = [];
      window.ouvrirDetail(id);
      return true;
    }, i);
    if (!ouvert) { echecsOuverture++; continue; }
    await page.waitForTimeout(70);

    const pendant = await page.evaluate(etatUI);
    // une fiche ouverte = « feuille » seule ; jamais deux panneaux principaux
    const principaux = pendant.panneaux.filter((p) => p !== "ficheCompacte");
    if (principaux.length > 1) superpositions++;
    const contenu = await page.evaluate(() =>
      (document.getElementById("feuille").textContent || "").trim().length);
    if (contenu < 20) blanches++;

    await page.evaluate(() => window.fermerFeuille && window.fermerFeuille());
    await page.waitForTimeout(50);
  }

  const apres = await page.evaluate(etatUI);
  ok("fiches · 30 ouvertures/fermetures sans échec", echecsOuverture === 0,
     `${echecsOuverture} échec(s)`);
  ok("fiches · aucune page blanche", blanches === 0, `${blanches} fiche(s) vide(s)`);
  ok("fiches · aucune superposition de panneaux", superpositions === 0,
     `${superpositions} superposition(s)`);
  ok("fiches · la carte survit aux 30 cycles", apres.carte === true);
  ok("fiches · le scroll du corps n'est pas resté bloqué", apres.scrollBody === 0);
  ok("fiches · aucun panneau resté ouvert à la fin", apres.panneaux.filter(p=>p!=="feuilleBesoins").length === 0,
     apres.panneaux.join("+"));
  ok("fiches · les marqueurs n'ont pas disparu", apres.marqueurs > 0,
     `${avant.marqueurs} → ${apres.marqueurs}`);
  await ctx.close();
}

/* ===================================================================== */
/* 2. CARTE — déplacements rapides et répétés                            */
/* ===================================================================== */
{
  const { ctx, page } = await nouvelOnglet(navigateur, { etiquette: "carte" });
  const idCarte = await page.evaluate(() => { window.__ref = window.__map; return true; });
  const avantRequetes = compteurs.overpass;

  // 60 déplacements rapides dans plusieurs directions
  for (let i = 0; i < 60; i++) {
    await page.evaluate((n) => {
      const m = window.__map; if (!m) return;
      const c = m.getCenter();
      const dx = [0.004, -0.004, 0.006, -0.006][n % 4];
      const dy = [0.003, -0.003, -0.005, 0.005][n % 4];
      m.setView([c.lat + dy, c.lng + dx], m.getZoom(), { animate: false });
    }, i);
    await page.waitForTimeout(45);   // plus rapide que le debounce de 350 ms
  }
  await page.waitForTimeout(2500);

  const apres = await page.evaluate(etatUI);
  const memeCarte = await page.evaluate(() => window.__ref === window.__map);
  const requetes = compteurs.overpass - avantRequetes;
  const fantomes = await page.evaluate(() => {
    // un marqueur « fantôme » : présent dans le DOM mais hors de la liste
    const dom = document.querySelectorAll(".leaflet-marker-icon").length;
    return { dom, memoire: (window.visibles ? window.visibles() : []).length };
  });

  ok("carte · une seule instance après 60 déplacements", memeCarte === true);
  ok("carte · le debounce a limité les requêtes", requetes <= 20,
     `${requetes} requête(s) pour 60 déplacements`);
  ok("carte · aucune accumulation de marqueurs", fantomes.dom <= fantomes.memoire + 5,
     `${fantomes.dom} marqueurs pour ${fantomes.memoire} lieux`);
  ok("carte · la carte reste vivante", apres.carte === true);
  await ctx.close();
}

/* ===================================================================== */
/* 3. NAVIGATION — Explorer → Aide → Explorer → Créer → …                */
/* ===================================================================== */
{
  const { ctx, page } = await nouvelOnglet(navigateur, { mobile: true, etiquette: "nav" });
  await page.evaluate(() => { window.__ref = window.__map; });

  // on règle un contexte reconnaissable dans Explorer
  // on règle le contexte comme le ferait un doigt : en touchant l'onglet
  await page.evaluate(() => {
    const t = document.querySelector('.ong[data-creneau="soir"]');
    if (t) t.click();
  });
  await page.waitForTimeout(400);
  const contexteAvant = await page.evaluate(() => ({
    creneau: window.__creneauActif(),
    recherche: (document.getElementById("rech") || {}).value || "",
  }));
  const vueAvant = await page.evaluate(() => window.__carteCentre());

  const parcours = ["aide", "explorer", "creer", "explorer", "favoris", "explorer"];
  let superpositions = 0;
  for (const onglet of parcours) {
    await page.evaluate((o) => {
      const b = document.querySelector(`#navBas [data-nb="${o}"]`);
      if (b) b.click();
    }, onglet);
    await page.waitForTimeout(400);
    const e = await page.evaluate(etatUI);
    const principaux = e.panneaux.filter((p) => p !== "ficheCompacte");
    if (principaux.length > 1) superpositions++;
  }
  await page.waitForTimeout(400);

  const memeCarte = await page.evaluate(() => window.__ref === window.__map);
  const contexteApres = await page.evaluate(() => ({
    creneau: window.__creneauActif(),
    recherche: (document.getElementById("rech") || {}).value || "",
  }));
  const vueApres = await page.evaluate(() => window.__carteCentre());
  const finale = await page.evaluate(etatUI);

  ok("navigation · carte conservée sur tout le parcours", memeCarte === true);
  ok("navigation · aucune superposition de panneaux", superpositions === 0,
     `${superpositions} superposition(s)`);
  ok("navigation · la vue de carte n'a pas bougé",
     JSON.stringify(vueAvant) === JSON.stringify(vueApres),
     `${JSON.stringify(vueAvant)} → ${JSON.stringify(vueApres)}`);
  ok("navigation · le créneau d'Explorer est rendu au retour",
     contexteApres.creneau === contexteAvant.creneau,
     `${contexteAvant.creneau} → ${contexteApres.creneau}`);
  ok("navigation · la recherche d'Explorer est rendue au retour",
     contexteApres.recherche === contexteAvant.recherche,
     `« ${contexteAvant.recherche} » → « ${contexteApres.recherche} »`);
  ok("navigation · un seul onglet allumé, et c'est Explorer",
     finale.navActif.length === 1 && finale.navActif[0] === "explorer",
     finale.navActif.join("+"));
  await ctx.close();
}

/* ===================================================================== */
/* 4. ÉVÉNEMENTS — ce qui a le droit d'être « Maintenant »               */
/* ===================================================================== */
{
  const { ctx, page } = await nouvelOnglet(navigateur, { etiquette: "evenements" });
  const verdicts = await page.evaluate(() => {
    const T = window.AutourTemps;
    const evts = (window.visibles ? window.visibles() : []).filter((l) => l.temporalStatus);
    const par = (titre) => evts.find((e) => (e.titre || "").includes(titre));
    const estMaintenant = (l) => !!l && T.estMaintenant(window.statutTemps(l, Date.now()).statut);
    return {
      trouves: evts.map((e) => e.titre),
      enCours: estMaintenant(par("en cours")),
      demain: estMaintenant(par("demain")),
      annule: estMaintenant(par("annulé")),
      compte: typeof window.compterMaintenant === "function" ? window.compterMaintenant() : -1,
    };
  });

  ok("événements · un événement en cours est « Maintenant »", verdicts.enCours === true,
     JSON.stringify(verdicts.trouves));
  ok("événements · un événement de demain n'est JAMAIS « Maintenant »", verdicts.demain === false);
  ok("événements · un événement annulé n'est JAMAIS « Maintenant »", verdicts.annule === false);
  ok("événements · le compteur ne retient que ce qui a lieu", verdicts.compte === 1,
     `compte = ${verdicts.compte}`);

  const onglet = await page.evaluate(() => {
    const html = typeof window.ongletsTemps === "function" ? window.ongletsTemps() : "";
    return { html, eclair: html.includes("⚡"), badge: /ong-compte"[^>]*>1</.test(html) };
  });
  ok("événements · l'onglet affiche ⚡ Maintenant · 1", onglet.eclair && onglet.badge,
     onglet.html.slice(0, 160));
  await ctx.close();
}

/* ===================================================================== */
/* 5. AIDE — la traduction se fait à la place de l'utilisateur           */
/* ===================================================================== */
{
  const { ctx, page } = await nouvelOnglet(navigateur, { mobile: true, etiquette: "aide" });
  const cas = [
    ["je dors dehors", "aide"],
    ["je n'ai rien à manger", "aide"],
    ["mon vélo est crevé", "explorer"],
    ["mon téléphone est cassé", "explorer"],
  ];
  const verdicts = await page.evaluate((liste) =>
    liste.map(([phrase, attendu]) => ({
      phrase, attendu,
      obtenu: window.AutourAide.domaineDeLaPhrase(phrase).domaine,
      requete: window.AutourAide.domaineDeLaPhrase(phrase).requete || null,
    })), cas);
  for (const v of verdicts)
    ok(`aide · « ${v.phrase} » → ${v.attendu}`, v.obtenu === v.attendu,
       `obtenu ${v.obtenu}${v.requete ? " (" + v.requete + ")" : ""}`);

  // le parcours réel : taper une réparation dans Aide doit proposer Explorer
  await page.evaluate(() => document.querySelector('#navBas [data-nb="aide"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const champ = document.getElementById("champBesoin");
    champ.value = "mon vélo est crevé";
    document.getElementById("formBesoin").dispatchEvent(new Event("submit", {cancelable:true, bubbles:true}));
  });
  await page.waitForTimeout(400);
  const ecran = await page.evaluate(() => {
    const corps = document.getElementById("fbCorps");
    return {
      texte: (corps.textContent || "").slice(0, 220),
      redirection: !!corps.querySelector("[data-vers-explorer]"),
      sortie: !!corps.querySelector("[data-aide-rester]"),
    };
  });
  ok("aide · une réparation propose Explorer, pas des structures sociales",
     ecran.redirection === true, ecran.texte);
  ok("aide · on peut refuser et rester dans Aide", ecran.sortie === true);
  ok("aide · aucune mention de CCAS ou d'association pour un vélo crevé",
     !/CCAS|association|France Services/i.test(ecran.texte), ecran.texte);

  // et le bouton fait vraiment basculer
  await page.evaluate(() => document.querySelector("[data-vers-explorer]").click());
  await page.waitForTimeout(700);
  const apres = await page.evaluate(() => ({
    nav: [...document.querySelectorAll("#navBas .nb.actif")].map((b) => b.dataset.nb),
    recherche: (document.getElementById("rech") || {}).value || "",
    aide: document.body.classList.contains("aide"),
  }));
  ok("aide · la bascule allume Explorer", apres.nav.join() === "explorer", apres.nav.join());
  ok("aide · la recherche arrive déjà écrite", /vélo/i.test(apres.recherche), apres.recherche);
  ok("aide · le mode Aide est bien quitté", apres.aide === false);
  await ctx.close();
}

/* ===================================================================== */
/* 6. RÉSEAU — lent, en panne, hors ligne                                */
/* ===================================================================== */
for (const scenario of [{ lent: true, nom: "réseau lent" }, { panne: true, nom: "API en panne" }]) {
  const { ctx, page } = await nouvelOnglet(navigateur,
    { ...scenario, etiquette: scenario.nom, attente: 12000 });
  const e = await page.evaluate(etatUI);
  const utilisable = await page.evaluate(() => {
    const nav = document.getElementById("navBas");
    const rech = document.getElementById("rech");
    return {
      navVisible: !!nav && !nav.hidden && nav.getClientRects().length > 0,
      rechercheUtilisable: !!rech && !rech.disabled,
      texte: (document.body.innerText || "").slice(0, 4000),
    };
  });
  ok(`${scenario.nom} · la navigation basse reste utilisable`, utilisable.navVisible === true);
  ok(`${scenario.nom} · la recherche reste utilisable`, utilisable.rechercheUtilisable === true);
  ok(`${scenario.nom} · la carte existe toujours`, e.carte === true);
  ok(`${scenario.nom} · aucune erreur technique brute à l'écran`,
     !/(TypeError|undefined is not|NetworkError|HTTP 5\d\d|\[object Object\])/.test(utilisable.texte));
  await ctx.close();
}

/* ===================================================================== */
/* 7. GÉOLOCALISATION — refusée                                          */
/* ===================================================================== */
{
  const ctx = await navigateur.newContext({ ...devices["iPhone 13"], locale: "fr-FR" });
  const page = await ctx.newPage();
  surveiller(page, "geo refusée");
  await bouchonner(page);
  await ctx.grantPermissions([]);   // aucune permission : la demande sera refusée
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const texte = await page.evaluate(() => document.body.innerText || "");
  ok("géoloc refusée · jamais « rien autour de toi » sans position",
     !/rien autour de toi/i.test(texte));
  ok("géoloc refusée · l'application propose de choisir un point de départ",
     /point de départ|Où veux-tu regarder|Choisir une ville|position/i.test(texte),
     texte.slice(0, 200));
  await ctx.close();
}

/* ===================================================================== */
await navigateur.close();
serveur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log("\n════ TEST DE STABILITÉ INTENSIF ════\n");
for (const r of resultats)
  console.log(`${r.ok ? "  ok  " : "ÉCHEC "} ${r.nom}${r.detail && !r.ok ? "  — " + r.detail : ""}`);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
if (anomalies.length) {
  console.log("\n──── anomalies JS observées ────");
  [...new Set(anomalies)].slice(0, 25).forEach((a) => console.log("  · " + a));
}
process.exit(echecs.length || anomalies.length ? 1 : 0);
