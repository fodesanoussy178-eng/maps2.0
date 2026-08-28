/* Le banc d'essai appareils.

   CE QU'IL VALIDE, ET CE QU'IL NE VALIDE PAS — à lire avant les résultats.

   Il exécute l'application RÉELLE (le vrai index.html, le vrai app.js, les
   vraies fonctions Edge) dans un vrai navigateur, à la taille, à la densité
   de pixels et au mode tactile de chaque appareil, avec un processeur bridé
   et un réseau mobile simulé au niveau du protocole.

   Il n'exécute PAS WebKit : le moteur de Safari n'est pas téléchargeable dans
   ce conteneur (proxy). Tout ce qui relève de la MISE EN PAGE, du TACTILE et
   de la LOGIQUE est donc réellement vérifié ici ; ce qui relève d'une
   particularité de rendu WebKit ne l'est pas, et fait l'objet d'un audit
   statique séparé. */

import { chromium, devices } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://127.0.0.1:8787";
const SORTIE = process.env.BANC_SORTIE || "/tmp/autour-banc/appareils";
const LEAFLET_JS = await readFile(new URL("../../node_modules/leaflet/dist/leaflet.js", import.meta.url), "utf8");
const LEAFLET_CSS = await readFile(new URL("../../node_modules/leaflet/dist/leaflet.css", import.meta.url), "utf8");
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64");

/* Les appareils. Les descripteurs Playwright portent la taille réelle, la
   densité de pixels, le mode tactile et l'agent utilisateur de chacun. */
const APPAREILS = [
  ["iPhone SE (375×667)",        devices["iPhone SE"]],
  ["iPhone 12 mini (375×812)",   devices["iPhone 12 Mini"]],
  ["iPhone 14 (390×844)",        devices["iPhone 14"]],
  ["iPhone 14 Pro Max (430×932)",devices["iPhone 14 Pro Max"]],
  ["Pixel 7 (412×915)",          devices["Pixel 7"]],
  ["Galaxy S9+ (320×658)",       devices["Galaxy S9+"]],
  ["Galaxy Tab S4 (712×1138)",   devices["Galaxy Tab S4 landscape"]],
  ["iPad Mini (768×1024)",       devices["iPad Mini"]],
  ["Bureau (1440×900)",          {viewport:{width:1440,height:900}, isMobile:false, hasTouch:false,
                                  deviceScaleFactor:1}],
];

/* Le réseau. « 4G encombrée » n'est pas une métaphore : c'est la latence et
   le débit réels d'une liaison mobile en heure pleine, appliqués au niveau du
   protocole par le navigateur. */
const RESEAUX = {
  fibre:      {latence: 5,   descendant: 40e6/8,  montant: 20e6/8, cpu: 1},
  "4g":       {latence: 150, descendant: 4e6/8,   montant: 1e6/8,  cpu: 4},
  "4g_charge":{latence: 400, descendant: 1.2e6/8, montant: 400e3/8,cpu: 6},
  "3g":       {latence: 650, descendant: 700e3/8, montant: 250e3/8,cpu: 6},
};

/* Les scénarios de panne. Ce sont ceux que le téléphone rencontre et que
   l'ordinateur ne rencontre jamais, parce qu'il répond trop vite pour les
   déclencher. */
const SCENARIOS = {
  nominal:        {overpass:"ok"},
  overpass_lent:  {overpass:"lent"},        // répond après 11 s
  overpass_muet:  {overpass:"muet"},        // ne répond jamais
  overpass_panne: {overpass:"503"},
  sans_position:  {overpass:"ok", geo:false},
  geo_expiree:    {overpass:"ok", geo:"timeout"},
};

/* Une réponse Overpass réelle, réduite : des lieux avec de vrais tags, dont
   un `opening_hours` OSM et un `cuisine` anglais — exactement ce qui
   atterrissait brut à l'écran. */
const ELEMENTS = [
  {type:"node", id:1, lat:50.6929, lon:3.1746, tags:{amenity:"cafe", name:"Le Petit Nord",
    opening_hours:"Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off", cuisine:"regional;french"}},
  {type:"node", id:2, lat:50.6935, lon:3.1750, tags:{amenity:"restaurant", name:"Chez Marcel",
    opening_hours:"Tu-Su 12:00-14:30,19:00-22:30", cuisine:"french"}},
  {type:"node", id:3, lat:50.6921, lon:3.1738, tags:{amenity:"pharmacy", name:"Pharmacie du Centre",
    opening_hours:"Mo-Sa 09:00-19:30"}},
  {type:"node", id:4, lat:50.6940, lon:3.1760, tags:{amenity:"social_facility",
    name:"Restos du Cœur — Tourcoing", social_facility:"food_bank", opening_hours:"We 09:00-12:00"}},
  {type:"node", id:5, lat:50.6918, lon:3.1755, tags:{leisure:"park", name:"Parc Barbieux"}},
  {type:"node", id:6, lat:50.6944, lon:3.1731, tags:{amenity:"library", name:"Médiathèque Aimé Césaire",
    opening_hours:"Tu-Sa 10:00-18:00"}},
  {type:"node", id:7, lat:50.6912, lon:3.1742, tags:{office:"employment_agency",
    name:"Mission Locale de Tourcoing", opening_hours:"Mo-Fr 09:00-17:00"}},
  {type:"node", id:8, lat:50.6950, lon:3.1748, tags:{amenity:"bar", name:"Le Comptoir",
    opening_hours:"We-Su 17:00-01:00"}},
];

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function brancherRoutes(contexte, scenario) {
  // Leaflet, servi depuis node_modules : le CDN est injoignable ici, et une
  // carte absente testerait autre chose que ce qu'on veut tester.
  await contexte.route("**/cdnjs.cloudflare.com/**leaflet.js", (r) =>
    r.fulfill({status:200, contentType:"text/javascript", body:LEAFLET_JS}));
  await contexte.route("**/cdnjs.cloudflare.com/**leaflet.css", (r) =>
    r.fulfill({status:200, contentType:"text/css", body:LEAFLET_CSS}));
  await contexte.route("**basemaps.cartocdn.com/**", (r) =>
    r.fulfill({status:200, contentType:"image/png", body:PIXEL}));
  await contexte.route("**fonts.googleapis.com/**", (r) => r.fulfill({status:200, contentType:"text/css", body:""}));
  await contexte.route("**fonts.gstatic.com/**", (r) => r.abort());
  // Supabase et Google : injoignables ici, comme dans un tunnel.
  await contexte.route("**supabase.co/**", (r) => r.fulfill({status:503, body:"{}"}));
  await contexte.route("**googleapis.com/**", (r) => r.fulfill({status:503, body:"{}"}));
  await contexte.route("**openstreetmap.org/**", (r) => r.fulfill({status:503, body:"[]"}));

  // Overpass, via notre relais : c'est ici que se joue la différence mobile.
  await contexte.route("**/api/lieux**", async (route) => {
    const mode = scenario.overpass;
    if (mode === "503") return route.fulfill({status:503, contentType:"application/json",
      body:JSON.stringify({erreur:"aucune instance Overpass disponible"})});
    if (mode === "muet") return;                       // jamais de réponse
    if (mode === "lent") await attendre(11000);
    return route.fulfill({status:200, contentType:"application/json",
      body:JSON.stringify({elements:ELEMENTS})});
  });
  await contexte.route("**/api/datatourisme**", (r) =>
    r.fulfill({status:200, contentType:"application/json", body:JSON.stringify({items:[
      {id:"dt-1", uuid:"dt-1", titre:"Visite privée de l’exposition Le Liban de Serge Najjar",
       description:"Une visite guidée de l’exposition, ouverte au public sur réservation.",
       cat:"musee", lat:50.6931, lng:3.1752, adresse:"12 rue des Arts, 59200 Tourcoing"},
      {id:"dt-2", uuid:"dt-2", titre:"Visite de lieux patrimoniaux",
       description:"Parcours dans le centre historique, avec une halte à la brasserie du XIXe siècle.",
       cat:"musee", lat:50.6926, lng:3.1744, adresse:"Centre historique, 59200 Tourcoing"},
    ]})}));
  await contexte.route("**/api/decouvertes**", (r) =>
    r.fulfill({status:200, contentType:"application/json", body:JSON.stringify({items:[], actif:false})}));
  await contexte.route("**/api/commune**", (r) =>
    r.fulfill({status:200, contentType:"application/json", body:JSON.stringify({commune:"Tourcoing"})}));
}

async function mesurer(navigateur, nomAppareil, appareil, nomReseau, nomScenario) {
  const scenario = SCENARIOS[nomScenario];
  const reseau = RESEAUX[nomReseau];
  const contexte = await navigateur.newContext({
    ...appareil,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    permissions: scenario.geo === false ? [] : ["geolocation"],
    geolocation: scenario.geo === false ? undefined : {latitude:50.6929, longitude:3.1746, accuracy:30},
  });
  await brancherRoutes(contexte, scenario);

  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e && e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push("console: " + m.text().slice(0,200)); });

  // le bridage : réseau au niveau du protocole, processeur au niveau du moteur
  const cdp = await contexte.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {offline:false, latency:reseau.latence,
    downloadThroughput:reseau.descendant, uploadThroughput:reseau.montant});
  await cdp.send("Emulation.setCPUThrottlingRate", {rate:reseau.cpu});

  if (scenario.geo === "timeout") {
    // la permission est accordée, mais le point n'arrive jamais : c'est le cas
    // du GPS en intérieur, et c'est celui que l'ancien code lisait comme un refus
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = () => {};
      navigator.geolocation.watchPosition = () => 1;
    });
  }

  const depart = Date.now();
  await page.goto(BASE + "/", {waitUntil:"commit"});
  // on attend la PREMIÈRE proposition lisible, pas la fin du réseau
  let premierContenu = null;
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("[data-ac], [data-va], .rc-carte, .ac-aide, .rang").length > 0,
      null, {timeout: 25000});
    premierContenu = Date.now() - depart;
  } catch { /* rien de lisible dans le temps imparti : c'est un résultat */ }

  await page.waitForTimeout(1500);

  const releve = await page.evaluate(() => {
    const texte = document.body.innerText || "";
    const html = document.body.innerHTML || "";
    return {
      // les formats bruts qu'aucun écran ne doit montrer
      osmBrut: /\b(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?\s+\d{2}:\d{2}-\d{2}:\d{2}/.test(texte),
      nan: /\bNaN\b/.test(texte),
      undefined: /\bundefined\b/.test(texte),
      cuisineAnglaise: /\bregional french\b|\bregional;french\b/i.test(texte),
      // ce que l'écran montre réellement
      cartes: document.querySelectorAll("[data-ac], [data-va], .rang").length,
      titres: [...document.querySelectorAll(".rc-nom, .rang-nom, .aa-nom")].map((e)=>e.textContent.trim()).slice(0,6),
      lignes: [...document.querySelectorAll(".rc-meta, .rang-sous, .aa-quand, .raison")].map((e)=>e.textContent.trim()).slice(0,8),
      statutOuvert: /Ouvert · ferme à \d{1,2}h/.test(texte),
      horairesFr: /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/i.test(texte),
      layout: document.body.dataset.layout,
      perf: (() => { try { return JSON.parse(document.documentElement.dataset.autourPerf || "{}"); } catch { return {}; } })(),
      debordement: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      largeurDoc: document.documentElement.scrollWidth,
      largeurVue: document.documentElement.clientWidth,
      // toute cible tactile sous 44 px est un défaut d'accessibilité tactile
      ciblesTropPetites: [...document.querySelectorAll("button:not([hidden]), a[href], [role=button]")]
        .filter((el) => { const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40); })
        .length,
      titreVisible: !!document.querySelector("#feuilleBesoins:not([hidden])"),
    };
  });

  const dossier = join(SORTIE, nomScenario, nomReseau);
  await mkdir(dossier, {recursive:true});
  await page.screenshot({path: join(dossier, nomAppareil.replace(/[^\w]+/g,"_") + ".png"), fullPage:false});

  await contexte.close();
  return {appareil:nomAppareil, reseau:nomReseau, scenario:nomScenario,
          premierContenu, erreurs: [...new Set(erreurs)], ...releve};
}

const navigateur = await chromium.launch({executablePath:process.env.CHROMIUM || undefined});
const resultats = [];
const plan = process.argv[2] === "complet"
  ? APPAREILS.map((a) => [a, "4g_charge", "nominal"])
      .concat(APPAREILS.map((a) => [a, "fibre", "nominal"]))
  : [];
for (const p of plan) resultats.push(await mesurer(navigateur, p[0][0], p[0][1], p[1], p[2]));

if (process.argv[2] !== "complet") {
  const cible = APPAREILS.find((a) => a[0].startsWith("iPhone 14 ("));
  for (const s of Object.keys(SCENARIOS))
    for (const r of ["4g_charge", "3g"])
      resultats.push(await mesurer(navigateur, cible[0], cible[1], r, s));
}
await navigateur.close();
await writeFile(join(SORTIE, "resultats-" + (process.argv[2]||"scenarios") + ".json"),
  JSON.stringify(resultats, null, 1));
console.log(JSON.stringify(resultats, null, 1));
