/* =========================================================================
   EXPLORER, DANS UN VRAI NAVIGATEUR, AUX DEUX LARGEURS

   POURQUOI CE BANC EXISTE. Deux défauts ont vécu côte à côte sans qu'aucun
   test les voie, et pour la même raison : les tests du dépôt lisent la SOURCE.
   Ils savent dire « cette règle est écrite » ; ils ne savent pas dire « ce
   bouton produit quelque chose ».

     · Le geste qui ouvre Explorer avait été élargi à toutes les largeurs.
       Le CSS, lui, gardait `display:none` hors du mobile. L'état s'ouvrait
       correctement — `body.explorer-ouvert`, `hidden` retiré, contenu rempli —
       et il ne se passait rien à l'écran. Un test de source ne pouvait pas le
       voir : les deux moitiés étaient justes séparément.

     · Appuyer sur un lieu fermait le panneau et déplaçait la carte, sans
       jamais ouvrir le lieu. Là encore, chaque ligne était correcte.

   Le banc joue le parcours réel : ouvrir Explorer, appuyer sur un lieu,
   vérifier qu'on obtient le lieu. À 1440 px et à 390 px, parce que le premier
   défaut n'existait que sur l'une des deux largeurs.

   Les lieux d'inventaire sont injectés au format exact du RPC `lieux_explorer`
   (le bac à sable n'atteint pas Supabase) ; le geste, lui, est le vrai.

     node outils/explorer.mjs
   ========================================================================= */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const RACINE = process.env.AUTOUR_RACINE
  ? join(process.cwd(), process.env.AUTOUR_RACINE)
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = {".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};

const port = 8700 + Math.floor(Math.random()*200);
const serveur = createServer(async (req,res)=>{
  const chemin = normalize(new URL(req.url,"http://x").pathname).replace(/^(\.\.[/\\])+/,"");
  if (chemin.startsWith("/api/")) { res.writeHead(200,{"content-type":"application/json"}); return res.end("[]"); }
  try {
    const c = await readFile(join(RACINE, chemin === "/" ? "index.html" : chemin));
    res.writeHead(200,{"content-type":MIME[extname(chemin)]||"application/octet-stream"});
    res.end(c);
  } catch(e){ res.writeHead(404).end(""); }
});
await new Promise(r=>serveur.listen(port,r));

const nav = await chromium.launch({executablePath:CHROME,args:["--no-sandbox","--disable-dev-shm-usage"]});

/* Des lieux d'inventaire, au format exact du RPC `lieux_explorer`. */
const LIEUX = [
  {id:"11111111-1111-1111-1111-111111111111", slug:"palais", name:"Palais des Beaux-Arts",
   family:"culture", famille_label:"Culture, musées et expositions",
   lat:50.6310, lng:3.0625, address:"18 place de la République", commune:"Lille",
   description:"Un des plus grands musées de France.", official_url:"https://pba.lille.fr",
   image_url:null, image_source:null, image_type:null,
   opening_hours:"We-Su 10:00-18:00", horaires_fiables:true, distance_m:480},
  {id:"22222222-2222-2222-2222-222222222222", slug:"jardin", name:"Jardin Vauban",
   family:"nature", famille_label:"Parcs et nature",
   lat:50.6346, lng:3.0468, address:"Boulevard Vauban", commune:"Lille",
   description:"Un parc à l'anglaise.", official_url:null,
   image_url:null, image_source:null, image_type:null,
   opening_hours:"Mo-Su 07:30-21:00", horaires_fiables:true, distance_m:1100},
  {id:"33333333-3333-3333-3333-333333333333", slug:"mediatheque", name:"Médiathèque Jean Lévy",
   family:"bibliotheque", famille_label:"Bibliothèques et médiathèques",
   lat:50.6288, lng:3.0668, address:"32-34 rue Édouard Delesalle", commune:"Lille",
   description:null, official_url:null,
   image_url:null, image_source:null, image_type:null,
   opening_hours:"Tu-Sa 10:00-19:00", horaires_fiables:true, distance_m:700},
];

async function scenario(nom, viewport, mobile){
  const ctx = await nav.newContext({
    viewport, locale:"fr-FR", permissions:["geolocation"],
    geolocation:{latitude:50.6292,longitude:3.0573}, hasTouch:mobile, isMobile:mobile,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.setBlockedURLs",{urls:["*overpass*","*supabase*","*openagenda*","*nominatim*","*basemaps*","*cdnjs*","*fonts.g*","*jsdelivr*","*maps.googleapis*"]});
  const erreurs = [];
  page.on("pageerror", e=>erreurs.push(String(e.message||e).slice(0,200)));

  await page.goto("http://127.0.0.1:"+port+"/index.html",{waitUntil:"commit"});
  await page.waitForFunction(()=>window.AutourPerf && window.AutourPerf.temps.ui_ready,null,{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(2000);

  console.log("\n════ " + nom + " (" + viewport.width + "×" + viewport.height + ") ════");
  console.log("layout :", await page.evaluate(()=>document.body.dataset.layout));

  /* Ouvrir Explorer comme un humain : un clic sur le bouton. */
  await page.evaluate(()=>{
    const b = document.querySelector('[data-nb="explorer"]');
    if (b) b.click();
  });
  await page.waitForTimeout(800);

  const ouverture = await page.evaluate(()=>{
    const ed = document.getElementById("explorerDecouverte");
    const r = ed ? ed.getBoundingClientRect() : null;
    return {visible: !!r && r.height > 40 && r.width > 40,
      largeur: r ? Math.round(r.width) : 0, hauteur: r ? Math.round(r.height) : 0,
      gauche: r ? Math.round(r.left) : 0, haut: r ? Math.round(r.top) : 0};
  });
  console.log("Explorer visible :", ouverture);

  /* Poser des lieux d'inventaire et brancher le même chemin que le RPC. */
  await page.evaluate((lieuxInventaire)=>{
    const zone = document.getElementById("xpLieux"), titre = document.getElementById("xpLieuxTitre");
    titre.hidden = false; zone.hidden = false;
    zone.innerHTML = lieuxInventaire.map(carteLieuExplorer).join("");
    zone.querySelectorAll("[data-xp-lieu]").forEach((b)=>{
      b.onclick = ()=>{
        const l = lieuxInventaire.find((x)=>String(x.id) === b.dataset.xpLieu);
        if(!l) return;
        ouvrirLieuDepuisExplorer(l);
      };
    });
  }, LIEUX);
  await page.waitForTimeout(300);

  const avant = await page.evaluate(()=>({
    cartesLieux: document.querySelectorAll("[data-xp-lieu]").length,
    lieuxRuntime: lieux.length,
  }));
  console.log("lieux listés :", avant.cartesLieux, "· lieux du runtime avant :", avant.lieuxRuntime);


  /* LE GESTE : appuyer sur le premier lieu. */
  await page.evaluate(()=>document.querySelector("[data-xp-lieu]").click());
  await page.waitForTimeout(1800);

  const apres = await page.evaluate(()=>{
    const f = document.getElementById("ficheCompacte");
    return {
      explorerFerme: document.getElementById("explorerDecouverte")?.hidden,
      ficheOuverte: !!f && !f.hidden,
      ficheTexte: (f?.textContent||"").replace(/\s+/g," ").trim().slice(0,90),
      lieuEnAvant: typeof lieuEnAvant !== "undefined" ? lieuEnAvant : "n/a",
      lieuxRuntime: lieux.length,
      lieuAjoute: lieux.filter(x=>String(x.id).startsWith("place-")).map(x=>({id:x.id,titre:x.titre,cat:x.cat})),
    };
  });
  console.log("après le clic :", apres);
  console.log("erreurs JS :", erreurs.length ? erreurs.slice(0,5) : "aucune");

  await ctx.close();
  return {ouverture, apres, erreurs};
}

const ordi = await scenario("ordinateur", {width:1440,height:900}, false);
const tel  = await scenario("telephone",  {width:390,height:844}, true);

console.log("\n──── verdict ────");
const v = (nom, ok)=>console.log((ok?"  ✓ ":"  ✗ ")+nom);
v("ordinateur · Explorer s'affiche", ordi.ouverture.visible);
v("ordinateur · il prend la colonne de gauche", ordi.ouverture.largeur > 400 && ordi.ouverture.largeur < 700 && ordi.ouverture.gauche < 60);
v("ordinateur · le clic ouvre le lieu", ordi.apres.ficheOuverte && !!ordi.apres.lieuEnAvant);
v("ordinateur · le lieu entre dans la carte", ordi.apres.lieuAjoute.length === 1);
v("ordinateur · aucune erreur JS", ordi.erreurs.length === 0);
v("téléphone · Explorer s'affiche", tel.ouverture.visible);
v("téléphone · il monte du bas, pleine largeur", tel.ouverture.largeur > 330);
v("téléphone · le clic ouvre le lieu", tel.apres.ficheOuverte && !!tel.apres.lieuEnAvant);
v("téléphone · aucune erreur JS", tel.erreurs.length === 0);

await nav.close(); serveur.close();

process.exitCode = [ordi, tel].every((r)=>r.ouverture.visible && r.apres.ficheOuverte &&
  r.apres.lieuEnAvant && !r.erreurs.length) ? 0 : 1;
