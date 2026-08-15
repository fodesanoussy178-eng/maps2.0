/* =========================================================================
   LE SERVICE DE COMPTES QUAND LE RÉSEAU LE BLOQUE

   Signalé depuis le terrain : « Connexion impossible pour le moment. » à
   l'écran de publication, et le bouton répond la même chose indéfiniment.

   Ce banc rejoue exactement ça. Le SDK Supabase — désormais servi par notre
   propre origine — est rendu injoignable, puis disponible, pour vérifier les
   deux propriétés qui manquaient :

     · chaque essai RETENTE réellement (avant : réponse « non » en 0 ms, sans
       qu'aucune requête ne parte) ;
     · le rétablissement du réseau suffit, SANS RECHARGER LA PAGE (avant :
       l'échec était mémorisé pour toute la durée de la session).

   Servir le fichier nous-mêmes rend le cas rare — c'était le but — mais pas
   impossible : une coupure réseau au mauvais moment produit le même effet.
   C'est donc toujours ce comportement-là qu'on éprouve, et avec le VRAI SDK.

   Usage : node outils/comptes-hors-ligne.mjs
   ========================================================================= */

import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { chromium, devices } from "playwright";

const RACINE = process.env.RACINE_MESURE || new URL("..", import.meta.url).pathname;
const MIME = {".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const serveur = createServer(async (req,res)=>{
  const c = normalize(new URL(req.url,"http://x").pathname).replace(/^(\.\.[/\\])+/,"");
  try{
    const b = await readFile(join(RACINE, c === "/" ? "index.html" : c));
    const t = MIME[extname(c)] || "application/octet-stream";
    const gz = /gzip/.test(req.headers["accept-encoding"]||"") && /text|javascript|json/.test(t);
    res.writeHead(200, Object.assign({"content-type":t}, gz?{"content-encoding":"gzip"}:{}));
    res.end(gz?gzipSync(b):b);
  }catch(e){ res.writeHead(404).end(""); }
});
await new Promise(r=>serveur.listen(8777,r));

const nav = await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args:["--no-sandbox","--disable-dev-shm-usage"]});
const ctx = await nav.newContext(Object.assign({}, devices["Pixel 5"],
  {permissions:["geolocation"], geolocation:{latitude:50.72,longitude:3.16}, locale:"fr-FR"}));
const page = await ctx.newPage();
/* Le SDK vient maintenant de notre origine. On le coupe pour de bon, puis on
   le rétablit — sans recharger la page. C'est le vrai fichier qui est chargé :
   le banc éprouve donc aussi que le SDK vendorisé fonctionne réellement. */
const logs = [];
page.on("console", m => logs.push(m.text()));
let sdkDisponible = false;
let demandesSdk = 0;
await page.route(/\/vendeur\/supabase-.*\.js$/, route => {
  demandesSdk += 1;
  return sdkDisponible ? route.fallback() : route.abort("failed");
});

await page.goto("http://127.0.0.1:8777/index.html",{waitUntil:"commit"});
await page.waitForFunction(()=>window.AutourPerf&&window.AutourPerf.temps.ui_ready,null,{timeout:20000});
await page.waitForTimeout(1500);

const essai = async (n)=> page.evaluate(async ()=>{
  const t0 = performance.now();
  const r = await envoyerLienCompte("test@exemple.test");
  return { ...r, ms: Math.round(performance.now()-t0) };
});
console.log("— SDK injoignable —");
console.log("essai 1 :", JSON.stringify(await essai()));
console.log("essai 2 :", JSON.stringify(await essai()));
/* Le réseau revient. Sans recharger la page, la tentative suivante doit
   réellement repartir : c'est tout l'objet du correctif. */
sdkDisponible = true;
console.log("\n— réseau rétabli, sans rechargement —");
const r = await essai();
console.log("essai 3 :", JSON.stringify({ok:r.ok, message:r.message||"(aucun)", ms:r.ms}));
console.log("\nwindow.supabase présent :", await page.evaluate(()=>!!window.supabase));
console.log("requêtes SDK parties :", demandesSdk, "(une par essai : la preuve qu'on retente)");
console.log("journal :", logs.filter(l=>/upabase/i.test(l)).join(" | ") || "(rien)");

/* Le critère porte sur le CHARGEUR, pas sur le backend. Ce banc n'a pas accès
   au vrai Supabase : une fois le SDK chargé, l'appel Auth échoue forcément sur
   le réseau, et c'est une réponse différente — donc une preuve. Ce qu'on
   vérifie est qu'on a franchi le chargeur : le message n'est plus celui du
   service injoignable, et `window.supabase` existe. */
const chargeurFranchi = await page.evaluate(()=>!!window.supabase);
const messageDuChargeur = /service de connexion est injoignable/i.test(r.message || "");
const attendu = chargeurFranchi && !messageDuChargeur;
console.log("\n" + (attendu
  ? "✓ le rétablissement du réseau suffit, sans recharger la page"
  : "✗ l'échec reste mémorisé : la seule issue est de recharger"));
if (!attendu) process.exitCode = 1;

await nav.close(); serveur.close();
