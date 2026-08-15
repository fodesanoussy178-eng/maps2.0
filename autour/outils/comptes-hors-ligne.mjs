/* =========================================================================
   LE SERVICE DE COMPTES QUAND LE RÉSEAU LE BLOQUE

   Signalé depuis le terrain : « Connexion impossible pour le moment. » à
   l'écran de publication, et le bouton répond la même chose indéfiniment.

   Ce banc rejoue exactement ça. Le CDN qui sert le SDK Supabase est simulé —
   d'abord injoignable, puis disponible — pour vérifier les deux propriétés
   qui manquaient :

     · chaque essai RETENTE réellement (avant : réponse « non » en 0 ms, sans
       qu'aucune requête ne parte) ;
     · le rétablissement du réseau suffit, SANS RECHARGER LA PAGE (avant :
       l'échec était mémorisé pour toute la durée de la session).

   Un bloqueur de publicités, un réseau d'entreprise ou une panne de CDN
   produisent la même situation.

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
/* Le CDN du SDK est simulé : cet environnement ne l'atteint pas, et on veut
   pouvoir basculer de « injoignable » à « disponible » sans recharger la page.
   Le faux SDK expose juste ce que `connecter()` appelle. */
let cdnDisponible = false;
const FAUX_SDK = `window.supabase = {
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ data: [], error: null }) }),
  }),
};`;
await page.route(/jsdelivr|unpkg/, route =>
  cdnDisponible
    ? route.fulfill({ status:200, contentType:"application/javascript", body:FAUX_SDK })
    : route.abort("failed"));
const logs=[]; page.on("console",m=>logs.push(m.text()));

await page.goto("http://127.0.0.1:8777/index.html",{waitUntil:"commit"});
await page.waitForFunction(()=>window.AutourPerf&&window.AutourPerf.temps.ui_ready,null,{timeout:20000});
await page.waitForTimeout(1500);

const essai = async (n)=> page.evaluate(async ()=>{
  const t0 = performance.now();
  const r = await envoyerLienCompte("test@exemple.test");
  return { ...r, ms: Math.round(performance.now()-t0) };
});
console.log("— CDN bloqué —");
console.log("essai 1 :", JSON.stringify(await essai()));
console.log("essai 2 :", JSON.stringify(await essai()));
/* Le réseau revient. Sans recharger la page, la tentative suivante doit
   réellement repartir : c'est tout l'objet du correctif. */
cdnDisponible = true;
console.log("\n— réseau rétabli, sans rechargement —");
const r = await essai();
console.log("essai 3 :", JSON.stringify({ok:r.ok, message:r.message||"(aucun)", ms:r.ms}));
console.log("\nwindow.supabase présent :", await page.evaluate(()=>!!window.supabase));
console.log("journal :", logs.filter(l=>/upabase/i.test(l)).join(" | ") || "(rien)");

const attendu = r.ok;
console.log("\n" + (attendu
  ? "✓ le rétablissement du réseau suffit, sans recharger la page"
  : "✗ l'échec reste mémorisé : la seule issue est de recharger"));
if (!attendu) process.exitCode = 1;

await nav.close(); serveur.close();
