/* LA RECHERCHE D'AIDE, OBSERVÉE PENDANT QU'ELLE SE DÉROULE.

   Le point de la correction n'est pas le résultat final : c'est ce que l'écran
   montre PENDANT. On ralentit donc le relais palier par palier — le premier
   répond vite, les suivants traînent — et on photographie l'écran toutes les
   secondes. C'est la seule façon de vérifier qu'il ne dit jamais « je n'ai
   pas trouvé » alors qu'il cherche encore. */

import { chromium, devices } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://127.0.0.1:8787";
const SORTIE = process.env.BANC_SORTIE || "/tmp/autour-banc/aide";
const LEAFLET_JS = await readFile(new URL("../../node_modules/leaflet/dist/leaflet.js", import.meta.url),"utf8");
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","base64");
const attendre = (ms)=>new Promise((r)=>setTimeout(r,ms));

/* Une structure par palier : c'est ce qui rend l'élargissement observable. */
const PAR_RAYON = {
  1200: [{type:"node", id:11, lat:50.6931, lon:3.1749, tags:{amenity:"social_facility",
    social_facility:"food_bank", name:"Restos du Cœur — Tourcoing", opening_hours:"We 09:00-12:00"}}],
  3000: [{type:"node", id:12, lat:50.7050, lon:3.1600, tags:{amenity:"social_facility",
    social_facility:"soup_kitchen", name:"Épicerie solidaire Le Panier", opening_hours:"Tu,Th 14:00-17:00"}}],
  5000: [{type:"node", id:13, lat:50.7200, lon:3.1400, tags:{amenity:"social_facility",
    social_facility:"food_bank", name:"Banque alimentaire du Nord", opening_hours:"Mo-Fr 08:00-16:00"}}],
  10000:[{type:"node", id:14, lat:50.7500, lon:3.1000, tags:{amenity:"social_facility",
    social_facility:"food_bank", name:"Secours populaire — Roubaix", opening_hours:"We-Sa 09:00-17:00"}}],
};

async function scenario(nom, options) {
  const navigateur = await chromium.launch({executablePath:process.env.CHROMIUM || undefined});
  const contexte = await navigateur.newContext({
    ...devices["iPhone 14"], locale:"fr-FR", timezoneId:"Europe/Paris",
    permissions:["geolocation"], geolocation:{latitude:50.6929, longitude:3.1746, accuracy:25},
  });
  await contexte.route("**/cdnjs.cloudflare.com/**leaflet.js",(r)=>r.fulfill({status:200,contentType:"text/javascript",body:LEAFLET_JS}));
  await contexte.route("**/cdnjs.cloudflare.com/**",(r)=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await contexte.route("**basemaps.cartocdn.com/**",(r)=>r.fulfill({status:200,contentType:"image/png",body:PIXEL}));
  await contexte.route("**fonts.googleapis.com/**",(r)=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await contexte.route("**fonts.gstatic.com/**",(r)=>r.abort());
  await contexte.route("**supabase.co/**",(r)=>r.fulfill({status:503,body:"{}"}));
  await contexte.route("**googleapis.com/**",(r)=>r.fulfill({status:503,body:"{}"}));
  await contexte.route("**openstreetmap.org/**",(r)=>r.fulfill({status:503,body:"[]"}));
  await contexte.route("**/api/datatourisme**",(r)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({items:[]})}));
  await contexte.route("**/api/decouvertes**",(r)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({items:[],actif:false})}));
  await contexte.route("**/api/commune**",(r)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({commune:"Tourcoing"})}));

  const appels = [];
  await contexte.route("**/api/lieux**", async (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") || "");
    const rayon = Number((q.match(/around:(\d+)/) || [])[1] || 0);
    const aide = q.includes("area.fr");
    appels.push({rayon, aide, t: Date.now()});
    if (!aide) return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({elements:[]})});
    if (options.panne) return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({erreur:"indisponible"})});
    await attendre(options.retard(rayon));
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({elements: PAR_RAYON[rayon] || []})});
  });

  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror",(e)=>erreurs.push(String(e && e.message || e)));
  const cdp = await contexte.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:350,
    downloadThroughput:1.2e6/8, uploadThroughput:400e3/8});
  await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});

  await page.goto(BASE + "/", {waitUntil:"commit"});
  await page.waitForFunction(()=>typeof window.__premiereDonnee !== "undefined" || document.readyState === "complete",
    null,{timeout:30000}).catch(()=>{});
  await page.waitForTimeout(2000);

  // entrer dans Aide, puis choisir « Manger »
  await page.evaluate(()=>{ const b=document.querySelector('[data-nb="aide"]'); if(b) b.click(); });
  await page.waitForTimeout(900);
  const depart = Date.now();
  await page.evaluate(()=>{ const b=document.querySelector('[data-sa="manger"]'); if(b) b.click(); });

  const film = [];
  await mkdir(join(SORTIE, nom), {recursive:true});
  for (let i = 0; i < 26; i += 1) {
    const t = Date.now() - depart;
    const image = await page.evaluate(()=>{
      const f = document.querySelector("#feuilleBesoins");
      const texte = f ? (f.innerText || "") : "";
      return {
        cherche: !!document.querySelector('[data-testid="aide-recherche"]'),
        libelleRecherche: (document.querySelector('[data-testid="aide-recherche"]')||{}).textContent || null,
        impasse: !!document.querySelector('[data-testid="aide-vide"]'),
        elargi: (document.querySelector('[data-testid="aide-rayon-elargi"]')||{}).textContent || null,
        cartes: document.querySelectorAll(".ac-aide").length,
        noms: [...document.querySelectorAll(".aa-nom")].map((e)=>e.textContent.trim()),
        osmBrut: /\b(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?[, ]\d{2}:\d{2}-\d{2}:\d{2}/.test(texte),
      };
    });
    film.push({t, ...image});
    if ([1,4,9,16,25].includes(i))
      await page.screenshot({path: join(SORTIE, nom, "t" + String(t).padStart(5,"0") + "ms.png")});
    await page.waitForTimeout(1000);
  }
  await navigateur.close();
  return {nom, appels: appels.filter((a)=>a.aide).map((a)=>a.rayon), film, erreurs:[...new Set(erreurs)]};
}

const resultats = [];
/* 1. Le premier palier répond vite, les suivants traînent : c'est la vie
      d'un réseau mobile, et c'est là que l'écran mentait. */
resultats.push(await scenario("paliers_lents", {retard:(r)=> r <= 1200 ? 900 : r <= 3000 ? 5000 : 9000}));
/* 2. Le relais tombe : ce qui est connu doit rester, et l'impasse ne doit pas
      s'afficher tant qu'on cherche. */
resultats.push(await scenario("relais_en_panne", {panne:true, retard:()=>0}));

await writeFile(join(SORTIE, "rapport.json"), JSON.stringify(resultats, null, 1));
for (const r of resultats) {
  console.log("\n=== " + r.nom + " ===");
  console.log("paliers interrogés :", r.appels.join(" → ") || "aucun");
  console.log("t(ms)  cherche  impasse  cartes  noms");
  for (const i of r.film)
    if (i.t < 22000)
      console.log(String(i.t).padStart(6), String(i.cherche).padStart(8), String(i.impasse).padStart(8),
        String(i.cartes).padStart(7), " ", i.noms.join(" | ").slice(0,70), i.elargi ? " ⟨"+i.elargi.slice(0,48)+"⟩" : "");
  console.log("format OSM brut vu :", r.film.some((i)=>i.osmBrut));
  console.log("erreurs JS :", r.erreurs.length ? r.erreurs : "aucune");
}
