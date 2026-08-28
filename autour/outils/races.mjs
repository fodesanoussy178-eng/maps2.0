/* LES SIX SITUATIONS OÙ DEUX RÉPONSES SE CROISENT.

   Une seule règle est vérifiée ici, et elle vaut pour les six : une réponse
   partie AVANT ne doit jamais écraser une réponse partie APRÈS. Le reste —
   l'écran ne se fige pas, l'écran ne ment pas — en découle.

   Chaque scénario est piloté sur un vrai navigateur, réseau et processeur
   bridés, avec un relais dont on contrôle le retard requête par requête. */

import { chromium, devices } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.BANC_BASE || "http://127.0.0.1:8787";
const SORTIE = process.env.BANC_SORTIE || "/tmp/autour-banc/races";
const LEAFLET = await readFile(new URL("../../node_modules/leaflet/dist/leaflet.js", import.meta.url), "utf8");
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","base64");
const dodo = (ms)=>new Promise((r)=>setTimeout(r,ms));

/* Deux jeux de structures qui ne se confondent pas : c'est ce qui rend
   l'écrasement visible. « ALIMENTAIRE » répond à Manger, « ABRI » à Logement. */
const ALIMENTAIRE = [{type:"node", id:31, lat:50.6931, lon:3.1749, tags:{amenity:"social_facility",
  social_facility:"food_bank", name:"ALIMENTAIRE Restos du Cœur", opening_hours:"We 09:00-12:00"}}];
const ABRI = [{type:"node", id:32, lat:50.6933, lon:3.1747, tags:{amenity:"social_facility",
  social_facility:"shelter", name:"ABRI Halte de nuit", opening_hours:"Mo-Su 19:00-08:00"}}];

async function ouvrir(options) {
  const o = options || {};
  const nav = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const ctx = await nav.newContext({
    ...devices["iPhone 14"], locale:"fr-FR", timezoneId:"Europe/Paris",
    permissions: o.sansPosition ? [] : ["geolocation"],
    geolocation: o.sansPosition ? undefined : {latitude:50.6929, longitude:3.1746, accuracy:25},
  });
  await ctx.route("**/cdnjs.cloudflare.com/**leaflet.js",(r)=>r.fulfill({status:200,contentType:"text/javascript",body:LEAFLET}));
  await ctx.route("**/cdnjs.cloudflare.com/**",(r)=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await ctx.route("**basemaps.cartocdn.com/**",(r)=>r.fulfill({status:200,contentType:"image/png",body:PIXEL}));
  await ctx.route("**fonts.**",(r)=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await ctx.route("**supabase.co/**",(r)=>r.fulfill({status:503,body:"{}"}));
  await ctx.route("**googleapis.com/**",(r)=>r.fulfill({status:503,body:"{}"}));
  await ctx.route("**openstreetmap.org/**",(r)=>r.fulfill({status:503,body:"[]"}));
  await ctx.route("**/api/datatourisme**",(r)=>r.fulfill({status:200,contentType:"application/json",body:'{"items":[]}'}));
  await ctx.route("**/api/decouvertes**",(r)=>r.fulfill({status:200,contentType:"application/json",body:'{"items":[],"actif":false}'}));
  await ctx.route("**/api/commune**",(r)=>r.fulfill({status:200,contentType:"application/json",body:'{"commune":"Tourcoing"}'}));
  const appels = [];
  await ctx.route("**/api/lieux**", async (route)=>{
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q")||"");
    const aide = q.includes("area.fr");
    const abri = /shelter|hebergement/.test(q) || /social_facility/.test(q);
    appels.push({t:Date.now(), aide, rayon:Number((q.match(/around:(\d+)/)||[])[1]||0)});
    if (!aide) return route.fulfill({status:200,contentType:"application/json",body:'{"elements":[]}'});
    const retard = o.retard ? o.retard(appels.length) : 0;
    if (retard) await dodo(retard);
    const jeu = o.jeu ? o.jeu(appels.length) : ALIMENTAIRE;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({elements:jeu})});
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror",(e)=>erreurs.push(String(e && e.message || e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:o.latence||300,
    downloadThroughput:1.2e6/8, uploadThroughput:400e3/8});
  await cdp.send("Emulation.setCPUThrottlingRate",{rate:o.cpu||4});
  return {nav, ctx, page, erreurs, appels};
}

const etat = (page)=>page.evaluate(()=>{
  const d=(f)=>{try{return f();}catch(e){return null;}};
  const feuille = document.querySelector("#feuilleBesoins");
  return {
    noms:[...document.querySelectorAll(".aa-nom")].map((e)=>e.textContent.trim()),
    cartes: document.querySelectorAll(".ac-aide").length,
    cherche: !!document.querySelector('[data-testid="aide-recherche"]'),
    impasse: !!document.querySelector('[data-testid="aide-vide"]'),
    panne: !!document.querySelector('[data-testid="aide-source-indisponible"]'),
    besoin: d(()=>sousAide), mode: d(()=>modeAide), enVol: d(()=>aidesEnVol),
    texte: feuille ? (feuille.innerText||"").slice(0,140) : "",
    brut: /\b(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?[, ]\d{2}:\d{2}-\d{2}:\d{2}|\bNaN\b|\bundefined\b/
      .test(document.body.innerText||""),
  };
});

async function amorcer(page) {
  await page.goto(BASE + "/", {waitUntil:"commit"});
  await page.waitForFunction(()=>document.querySelectorAll("[data-ac],[data-va],.rang,.fb-statut").length>0,
    null,{timeout:45000}).catch(()=>{});
}
const versAide = async (page)=>{
  await page.evaluate(()=>{const b=document.querySelector('[data-nb="aide"]'); if(b) b.click();});
  await page.waitForSelector('[data-sa="manger"]',{timeout:25000});
};

const resultats = [];
async function scenario(nom, verdictAttendu, corps) {
  const s = await ouvrir(corps.options || {});
  let observe = null, souci = null;
  try { observe = await corps.jouer(s); }
  catch (e) { souci = String(e && e.message || e); }
  await mkdir(SORTIE,{recursive:true});
  await s.page.screenshot({path: join(SORTIE, nom.replace(/[^\w]+/g,"_")+".png")}).catch(()=>{});
  await s.nav.close();
  const verdict = souci ? "ERREUR" : verdictAttendu(observe) ? "OK" : "ÉCHEC";
  resultats.push({nom, verdict, observe, souci, erreursJS:[...new Set(s.erreurs)].filter((e)=>!/Failed to fetch|ERR_/.test(e))});
  console.log((verdict==="OK"?"✓":"✗")+" "+nom+"  "+JSON.stringify(observe||souci).slice(0,220));
}

/* a. La géolocalisation arrive APRÈS l'ouverture d'Aide. */
await scenario("a · position tardive", (o)=>o && o.cartes>=1 && !o.impasse, {
  options:{sansPosition:true},
  jouer: async (s)=>{
    await amorcer(s.page);
    await versAide(s.page);
    await s.page.evaluate(()=>document.querySelector('[data-sa="manger"]').click());
    await dodo(1500);
    const avant = await etat(s.page);
    // le point arrive maintenant, six secondes après l'ouverture de l'écran
    await s.ctx.grantPermissions(["geolocation"]);
    await s.ctx.setGeolocation({latitude:50.6929, longitude:3.1746, accuracy:25});
    await s.page.evaluate(()=>{ if(typeof suivreMaPosition==="function") suivreMaPosition({silencieux:true}); });
    await dodo(9000);
    const apres = await etat(s.page);
    return {avantCartes:avant.cartes, cartes:apres.cartes, impasse:apres.impasse, noms:apres.noms};
  }});

/* b. Triple appui sur l'onglet Aide. */
await scenario("b · triple appui sur Aide", (o)=>o && o.cartes>=1 && !o.impasse, {
  jouer: async (s)=>{
    await amorcer(s.page);
    for (const d of [0,220,220]) { await dodo(d);
      await s.page.evaluate(()=>{const b=document.querySelector('[data-nb="aide"]'); if(b) b.click();}); }
    await s.page.waitForSelector('[data-sa="manger"]',{timeout:25000});
    await s.page.evaluate(()=>document.querySelector('[data-sa="manger"]').click());
    await dodo(9000);
    return await etat(s.page);
  }});

/* c. Va-et-vient rapide Explorer ↔ Aide. */
await scenario("c · va-et-vient Explorer↔Aide", (o)=>o && o.mode===true && o.cartes>=1 && !o.impasse, {
  jouer: async (s)=>{
    await amorcer(s.page);
    for (let i=0;i<6;i+=1){
      await s.page.evaluate(()=>{const b=document.querySelector('[data-nb="aide"]'); if(b) b.click();});
      await dodo(300);
      await s.page.evaluate(()=>{const b=document.querySelector('[data-nb="explorer"],[data-nb="carte"]');
        if(b) b.click(); else {const a=document.querySelector('[data-nb="aide"]'); if(a) a.click();}});
      await dodo(300);
    }
    await s.page.evaluate(()=>{const b=document.querySelector('[data-nb="aide"]'); if(b) b.click();});
    await s.page.waitForSelector('[data-sa="manger"]',{timeout:25000});
    await s.page.evaluate(()=>document.querySelector('[data-sa="manger"]').click());
    await dodo(9000);
    return await etat(s.page);
  }});

/* d. La carte est déplacée pendant que la recherche tourne. */
await scenario("d · carte déplacée pendant la recherche",
  (o)=>o && !o.brut && o.cartes>=1 && o.enVol===0, {
  options:{retard:()=>1200},
  jouer: async (s)=>{
    await amorcer(s.page);
    await versAide(s.page);
    await s.page.evaluate(()=>document.querySelector('[data-sa="manger"]').click());
    await dodo(800);
    await s.page.evaluate(()=>{ if(typeof map!=="undefined" && map && map.panBy) map.panBy([220,160]); });
    await dodo(12000);
    return await etat(s.page);
  }});

/* e. Le panneau est fermé puis rouvert pendant la recherche. */
await scenario("e · panneau fermé puis rouvert",
  (o)=>o && !o.brut && o.enVol===0 && o.utilisable, {
  options:{retard:()=>1200},
  jouer: async (s)=>{
    await amorcer(s.page);
    await versAide(s.page);
    await s.page.evaluate(()=>document.querySelector('[data-sa="manger"]').click());
    await dodo(700);
    await s.page.evaluate(()=>{const x=document.querySelector("#feuilleBesoins .feuille-x, #feuilleBesoins .fb-x");
      if(x) x.click();});
    await dodo(900);
    await s.page.evaluate(()=>{const b=document.querySelector('[data-nb="aide"]'); if(b) b.click();});
    await dodo(12000);
    const e = await etat(s.page);
    // « utilisable » = la grille des besoins est là et répond
    e.utilisable = await s.page.evaluate(()=>!!document.querySelector('[data-sa="manger"]'));
    return e;
  }});

/* f. LE CŒUR : une recherche lente est remplacée par une recherche rapide.
      La lente répond EN DERNIER — et ne doit rien écraser. */
await scenario("f · l’ancienne réponse n’écrase pas la nouvelle",
  (o)=>o && o.besoin==="logement" && !o.noms.some((n)=>n.startsWith("ALIMENTAIRE")), {
  options:{
    // la 1re requête d'aide (Manger) traîne 7 s ; les suivantes répondent vite
    retard:(n)=> n === 2 ? 7000 : 0,
    jeu:(n)=> n === 2 ? ALIMENTAIRE : ABRI,
  },
  jouer: async (s)=>{
    await amorcer(s.page);
    await versAide(s.page);
    await s.page.evaluate(()=>document.querySelector('[data-sa="manger"]').click());
    await dodo(900);
    /* On change d'avis AVANT que la première n'ait répondu : on retire la
       puce « Manger », ce qui ramène à la question, puis on choisit
       « Logement ». C'est le chemin réel dans l'interface. */
    await s.page.evaluate(()=>{const c=document.querySelector('[data-besoin-off="manger"]'); if(c) c.click();});
    await s.page.waitForSelector('[data-sa="logement"]',{timeout:15000});
    await s.page.evaluate(()=>document.querySelector('[data-sa="logement"]').click());
    await dodo(16000);   // largement après le retour de la lente (7 s)
    return await etat(s.page);
  }});

await writeFile(join(SORTIE,"rapport.json"), JSON.stringify(resultats,null,1));
const ko = resultats.filter((r)=>r.verdict!=="OK");
console.log("\n" + (resultats.length-ko.length) + "/" + resultats.length + " scénarios OK");
if (ko.length) { console.log("À REGARDER :"); ko.forEach((r)=>console.log(" -", r.nom, JSON.stringify(r.observe||r.souci).slice(0,300))); }
const bruts = resultats.filter((r)=>r.observe && r.observe.brut);
console.log("données brutes vues :", bruts.length ? bruts.map((r)=>r.nom) : "aucune");
const js = resultats.flatMap((r)=>r.erreursJS);
console.log("erreurs JS applicatives :", js.length ? js : "aucune");
