/* Serveur de banc d'essai : sert `autour/` en statique ET exécute les vraies
   fonctions Edge (`api/*.js`), qui sont des handlers Request → Response
   standards. Ce n'est donc pas une maquette : c'est le même code que Vercel
   exécute, avec le même contrôle de forme sur `/api/lieux`. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = process.env.AUTOUR_RACINE ||
  join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

const TYPES = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".webmanifest":"application/manifest+json",
};

const ROUTES = {
  "/api/lieux": "../autour/api/lieux.js",
  "/api/commune": "../autour/api/commune.js",
  "/api/datatourisme": "../autour/api/datatourisme.js",
  "/api/decouvertes": "../autour/api/decouvertes.js",
};
const handlers = {};
for (const [route, chemin] of Object.entries(ROUTES)) {
  try { handlers[route] = (await import(join(RACINE, "api", route.split("/").pop() + ".js"))).default; }
  catch (e) { console.warn("route indisponible :", route, e.message); }
}

async function corpsStatique(chemin) {
  const complet = join(RACINE, chemin === "/" ? "index.html" : decodeURIComponent(chemin));
  if (!complet.startsWith(RACINE)) return null;
  try {
    const info = await stat(complet);
    if (info.isDirectory()) return null;
    return { contenu: await readFile(complet), type: TYPES[extname(complet)] || "application/octet-stream" };
  } catch { return null; }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  const handler = handlers[url.pathname];
  if (handler) {
    try {
      const reponse = await handler(new Request("https://banc.test" + req.url, { method: req.method }));
      const entetes = {};
      reponse.headers.forEach((v, k) => { entetes[k] = v; });
      res.writeHead(reponse.status, entetes);
      res.end(Buffer.from(await reponse.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, {"content-type":"application/json"});
      res.end(JSON.stringify({ erreur: String(e && e.message) }));
    }
    return;
  }
  // les liens de partage sont réécrits vers index.html, comme en production
  const chemin = /^\/(l|e)\//.test(url.pathname) ? "/index.html" : url.pathname;
  const fichier = await corpsStatique(chemin);
  if (!fichier) { res.writeHead(404); res.end("introuvable"); return; }
  res.writeHead(200, {"content-type": fichier.type, "cache-control":"no-store"});
  res.end(fichier.contenu);
}).listen(PORT, "127.0.0.1", () => console.log("banc prêt sur http://127.0.0.1:" + PORT));
