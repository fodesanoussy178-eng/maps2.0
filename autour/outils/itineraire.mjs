/* « Y aller » : la fiche bascule, elle ne s'allonge pas.

   Avant, toucher « Y aller » dépliait un bloc au BAS de la fiche : il fallait
   faire défiler l'image, la catégorie, le prix, la description, l'adresse et
   les horaires pour atteindre les moyens de s'y rendre. La décision était
   prise — « j'y vais » — et l'écran continuait de parler d'autre chose.

   Désormais la feuille porte deux panneaux et n'en montre qu'un. Ce banc
   vérifie les cinq promesses de cette bascule, dans un vrai navigateur :

   1. elle est instantanée, sans nouveau rendu ni requête ;
   2. plus rien de la fiche classique ne reste à l'écran ;
   3. les quatre moyens sont là, avec leurs fournisseurs ;
   4. « Retour » repose la fiche exactement où on l'avait laissée ;
   5. « × » ferme tout et rend la carte.

   Usage :
     AUTOUR_LEAFLET_DIST=../node_modules/leaflet/dist node outils/itineraire.mjs
     node outils/itineraire.mjs --images   # capture les deux écrans
*/

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { chromium, devices } from "playwright";

const RACINE = process.env.AUTOUR_RACINE || process.env.RACINE_MESURE ||
  join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const MIME = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };

const pois = Array.from({length:8},(_,i)=>({type:"node",id:9000+i,
  lat:50.7236+((i%3)-1)*0.002, lon:3.1610+(Math.floor(i/3)-1)*0.002,
  tags:{name:"Boulangerie de la Latte "+(i+1), amenity:"cafe", opening_hours:"Mo-Su 06:00-22:00",
        "addr:street":"Rue de la Latte","addr:housenumber":"207","addr:city":"Tourcoing"}}));

const srv = createServer(async (rq,rs)=>{
  const c = normalize(new URL(rq.url,"http://x").pathname).replace(/^(\.\.[/\\])+/,"");
  try{ const b = await readFile(join(RACINE, c === "/" ? "index.html" : c));
    rs.writeHead(200,{"content-type":MIME[extname(c)]||"application/octet-stream"}); rs.end(b);
  }catch{ rs.writeHead(404).end(""); }
});
await new Promise(r=>srv.listen(0,r));
const BASE = "http://127.0.0.1:"+srv.address().port;

const b = await chromium.launch({executablePath:CHROME,
  args:["--no-sandbox","--disable-dev-shm-usage"]});
const ctx = await b.newContext(Object.assign({},devices["Pixel 5"],{
  permissions:["geolocation"], geolocation:{latitude:50.7236,longitude:3.1610}, locale:"fr-FR"}));
const page = await ctx.newPage();
const erreurs=[]; page.on("pageerror",e=>erreurs.push(String(e.message).slice(0,160)));

await page.route("**/*", async (route)=>{
  const u = route.request().url();
  if(u.startsWith(BASE) && !/\/rpc\/|\/api\//.test(u)) return route.continue();
  const json = (d)=>route.fulfill({status:200,contentType:"application/json",
    headers:{"access-control-allow-origin":"*"},body:JSON.stringify(d)});
  if(/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(u))
    return route.fulfill({status:200,contentType:"image/png",
      body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64")});
  if(/leaflet.*\.js(\?|$)/.test(u)) return route.fulfill({status:200,contentType:"text/javascript",
    body:await readFile(join(LEAFLET,"leaflet.js"),"utf8")});
  if(/leaflet.*\.css(\?|$)/.test(u)) return route.fulfill({status:200,contentType:"text/css",
    body:await readFile(join(LEAFLET,"leaflet.css"),"utf8")});
  if(/routing\.openstreetmap\.de/.test(u)) return json({routes:[{duration:540,distance:440,
    geometry:{coordinates:[[3.1610,50.7236],[3.1620,50.7246]]}}]});
  if(/overpass|\/api\/lieux/.test(u)) return json({elements:pois});
  if(/supabase-js|@supabase/.test(u) && /\.js/.test(u))
    return route.fulfill({status:200,contentType:"text/javascript",body:""});
  return json([]);
});
await page.addInitScript(()=>{ const rep=(d)=>Promise.resolve({data:d,error:null});
  window.supabase={createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:()=>rep(null)}),
    order(){return this}, limit(){return this}, then:(r)=>rep([]).then(r)})}),
    rpc:()=>rep([]), auth:{getSession:()=>rep({session:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}, storage:{from:()=>({})}})};});

await page.goto(BASE+"/index.html");
await page.waitForFunction(()=>typeof lieux !== "undefined" && lieux.length > 0,null,{timeout:20000});
await page.waitForTimeout(1200);

const res=[];
const ok=(n,c,d)=>{res.push(!!c);console.log((c?"  ✓ ":"  ✗ ")+n+(c||!d?"":"  → "+d));};

// ouvrir la fiche d'un lieu
await page.evaluate(()=>{ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(lieux[0].id)); });
await page.waitForSelector("#ficheLieu",{timeout:8000});
await page.waitForTimeout(400);
const avant = await page.evaluate(()=>({
  mode: modeFeuille,
  lieuVisible: !document.querySelector("#ficheLieu").hidden,
  itinVisible: !document.querySelector("#ficheItineraire").hidden,
  aYAller: !!document.querySelector("#btnYAller"),
}));
ok("la fiche s'ouvre en mode lieu", avant.mode==="lieu"&&avant.lieuVisible&&!avant.itinVisible, JSON.stringify(avant));
ok("le bouton « Y aller » est là", avant.aYAller);

const IMAGES = process.argv.includes("--images");
const capture = async (nom)=>{ if(IMAGES) await page.screenshot({path:"/tmp/autour-"+nom+".png"}); };
await capture("1-fiche");

// mesurer la bascule
const ms = Math.round(await page.evaluate(async ()=>{
  const t=performance.now();
  document.querySelector("#btnYAller").click();
  await new Promise(r=>requestAnimationFrame(r));
  return performance.now()-t;
}));
await page.waitForTimeout(120);
const apres = await page.evaluate(()=>{
  const f=document.querySelector("#feuille");
  const it=document.querySelector("#ficheItineraire");
  const visible=(s)=>{const e=f.querySelector(s);return !!(e&&e.getClientRects().length);};
  return {
    mode: modeFeuille,
    lieuCache: document.querySelector("#ficheLieu").hidden,
    itinVisible: !it.hidden,
    scroll: f.scrollTop,
    texteItin: it.textContent.replace(/\s+/g," ").trim().slice(0,200),
    modesInternes: [...it.querySelectorAll("[data-opt]")].map(x=>x.textContent.replace(/\s+/g," ").trim()),
    externes: [...it.querySelectorAll("[data-mode-externe]")].map(x=>({
      mode:x.dataset.modeExterne,
      liens:[...x.querySelectorAll(".itin-lien")].map(a=>a.textContent)})),
    retour: !!it.querySelector("#btnRetourItin"),
    croix: !!f.querySelector("#feuilleX"),
    // ce qui doit avoir disparu de l'écran
    fuites: ["#btnGarder","#btnPartLieu","#btnYAller",".d-haut",".titre-img",".faits",".horaires",".adresse",".actions"]
      .filter(visible),
  };
});
await capture("2-itineraire");
console.log("\n  bascule en "+ms+" ms");
ok("la bascule est instantanée (< 100 ms)", ms<100, ms+" ms");
ok("le panneau du lieu est masqué", apres.lieuCache);
ok("le panneau itinéraire est visible", apres.itinVisible && apres.mode==="itineraire");
ok("la feuille repart en haut", apres.scroll===0, String(apres.scroll));
ok("aucune information de la fiche classique ne reste à l'écran",
   apres.fuites.length===0, apres.fuites.join(", "));
ok("« ← Retour » et « × » sont présents", apres.retour && apres.croix);
ok("À pied et Vélo sont proposés", apres.modesInternes.length===2, JSON.stringify(apres.modesInternes));
ok("Voiture propose Google Maps, Apple Plans et Waze",
   JSON.stringify((apres.externes.find(x=>x.mode==="voiture")||{}).liens)==='["Google Maps","Apple Plans","Waze"]',
   JSON.stringify(apres.externes));
ok("Transports propose Google Maps et Apple Plans",
   JSON.stringify((apres.externes.find(x=>x.mode==="transports")||{}).liens)==='["Google Maps","Apple Plans"]');
console.log("\n  panneau : "+apres.texteItin+"\n");
console.log("  modes   : "+JSON.stringify(apres.modesInternes));

// retour
await page.waitForTimeout(900);      // laisser arriver le routage OSRM
const apresRoutage = await page.evaluate(()=>
  [...document.querySelectorAll("#ficheItineraire [data-opt]")].map(x=>x.textContent.replace(/\s+/g," ").trim()));
console.log("  après routage : "+JSON.stringify(apresRoutage));
ok("le routage réel remplit distance et durée",
   apresRoutage.every(t=>/\d+ min · \d/.test(t)), JSON.stringify(apresRoutage));

const msRetour = Math.round(await page.evaluate(async ()=>{
  const t=performance.now();
  document.querySelector("#btnRetourItin").click();
  await new Promise(r=>requestAnimationFrame(r));
  return performance.now()-t;
}));
const retourEtat = await page.evaluate(()=>({
  mode: modeFeuille,
  lieuVisible: !document.querySelector("#ficheLieu").hidden,
  itinCache: document.querySelector("#ficheItineraire").hidden,
  aYAller: !!document.querySelector("#btnYAller"),
}));
ok("« Retour » restaure la fiche du lieu ("+msRetour+" ms)",
   retourEtat.mode==="lieu"&&retourEtat.lieuVisible&&retourEtat.itinCache&&retourEtat.aYAller,
   JSON.stringify(retourEtat));

// la croix ferme tout
await page.evaluate(()=>{ document.querySelector("#btnYAller").click(); });
await page.waitForTimeout(150);
await page.evaluate(()=>document.querySelector("#feuilleX").click());
await page.waitForTimeout(400);
const ferme = await page.evaluate(()=>({
  feuille: document.querySelector("#feuille").hidden,
  voile: document.querySelector("#voile").hidden,
}));
ok("« × » ferme complètement la fiche", ferme.feuille && ferme.voile, JSON.stringify(ferme));

ok("aucune erreur JavaScript", erreurs.length===0, erreurs.join(" | "));
console.log("\n"+res.filter(Boolean).length+"/"+res.length+" vérifications passées");
await b.close(); srv.close();
process.exitCode = res.every(Boolean)?0:1;
