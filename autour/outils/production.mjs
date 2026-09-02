/* Le déploiement, rejoué en local aussi fidèlement qu'on peut le faire.

   Un rapport qui dit « il suffit de brancher la commande de build » n'a jamais
   déployé. Ce banc refait la chaîne entière, dans l'ordre où Vercel la fait :

     1. TÉLÉVERSEMENT — on copie le dossier racine du projet en respectant
        `.vercelignore`. Ce qui est exclu ici n'existe pas pour la suite.
     2. INSTALLATION — Vercel installe les dépendances du dossier racine. Sans
        `package.json`, la commande de build échouerait sur `esbuild`.
     3. BUILD — `buildCommand` de `vercel.json`, exécuté à la racine.
     4. SERVICE — `outputDirectory` est servi en statique, avec les en-têtes et
        les réécritures de `vercel.json`. `middleware.js` s'exécute avant, et
        `api/` répond depuis la RACINE du projet, pas depuis la sortie.

   Puis on vérifie ce qui doit l'être : le HTML servi est bien celui attendu,
   les scripts sont les allégés, aucune route n'est cassée, et surtout rien de
   privé n'est atteignable — ce qui n'était PAS le cas avant cette passe.

   Usage :
     node outils/production.mjs            # build + contrat HTTP
     node outils/production.mjs --garder   # laisse le serveur ouvert
*/

import { createServer } from "node:http";
import { readFile, rm, mkdir, cp, symlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const BAC = process.env.AUTOUR_BAC || "/tmp/autour-production";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".md": "text/markdown; charset=utf-8", ".sql": "application/x-sql",
};

const resultats = [];
function verifier(nom, condition, detail) {
  resultats.push({ nom, ok: !!condition });
  console.log((condition ? "  ok     " : "  ÉCHEC  ") + nom +
    (condition || !detail ? "" : "  — " + detail));
}

/* ---- 1. Téléversement : ce que Vercel reçoit --------------------------- */

const config = JSON.parse(await readFile(join(RACINE, "vercel.json"), "utf8"));
const ignore = (await readFile(join(RACINE, ".vercelignore"), "utf8"))
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

console.log("\n──── 1. téléversement ────\n");
console.log("  .vercelignore écarte : " + ignore.join(", "));

await rm(BAC, { recursive: true, force: true });
await mkdir(BAC, { recursive: true });
for (const entree of await readdir(RACINE)) {
  if (ignore.includes(entree)) continue;
  await cp(join(RACINE, entree), join(BAC, entree), { recursive: true });
}
await cp(join(RACINE, ".vercelignore"), join(BAC, ".vercelignore"));

for (const exclu of ["tests", "docs", "supabase"])
  verifier("« " + exclu + " » n’est même pas téléversé", !existsSync(join(BAC, exclu)));
verifier("« outils » l’est : la commande de build en a besoin", existsSync(join(BAC, "outils")));

/* ---- 2. Installation --------------------------------------------------- */

console.log("\n──── 2. installation ────\n");
const paquet = JSON.parse(await readFile(join(BAC, "package.json"), "utf8"));
verifier("package.json déclare esbuild là où Vercel installe",
  !!(paquet.devDependencies && paquet.devDependencies.esbuild));
/* On réutilise les dépendances déjà installées du dépôt plutôt que de repartir
   du registre : ce que le banc éprouve, c'est le build, pas npm. Un lien
   plutôt qu'une copie — 211 Mo recopiés à chaque exécution ne prouveraient
   rien de plus, et Node résout les modules à travers un lien. */
await symlink(join(RACINE, "..", "node_modules"), join(BAC, "node_modules"), "dir");
console.log("  dépendances en place");

/* ---- 3. Build ---------------------------------------------------------- */

console.log("\n──── 3. build ────\n");
const [commande, ...args] = config.buildCommand.split(" ");
let sortieBuild = "";
try {
  sortieBuild = execFileSync(commande, args, { cwd: BAC, encoding: "utf8" });
} catch (e) {
  console.error(String(e.stdout || "") + String(e.stderr || ""));
  verifier("la commande de build réussit", false, config.buildCommand);
}
const SORTIE = join(BAC, config.outputDirectory);
verifier("la commande de build réussit", existsSync(SORTIE), config.buildCommand);
verifier("le build n’écrit rien hors de la sortie",
  !/écrit dans (?!livraison)/.test(sortieBuild));
console.log(sortieBuild.split("\n").filter((l) => /total|contient|fichier/.test(l))
  .map((l) => "  " + l.trim()).join("\n"));

/* ---- 4. Service : en-têtes, réécritures, middleware, api --------------- */

const regleEntetes = (chemin) => {
  /* Les motifs de Vercel sont des chemins, pas des expressions régulières
     libres. Ceux d'Autour tiennent dans une traduction simple, et c'est cette
     traduction qu'on éprouve — pas une réimplémentation du routeur. */
  for (const regle of config.headers) {
    const motif = "^" + regle.source
      .replace(/\/:chemin\(\(\?!api\/\|zones\/\)\.\*\)/, "/((?!api/|zones/).*)")
      .replace(/^\//, "/") + "$";
    if (new RegExp(motif).test(chemin))
      return Object.fromEntries(regle.headers.map((h) => [h.key.toLowerCase(), h.value]));
  }
  return {};
};

const reecrire = (chemin) => {
  for (const regle of config.rewrites) {
    const motif = "^" + regle.source.replace(/:([a-zA-Z]+)/g, "[^/]+") + "$";
    if (new RegExp(motif).test(chemin)) return regle.destination;
  }
  return chemin;
};

const middleware = (await import(join(BAC, "middleware.js"))).default;
const fonctions = new Map();
for (const f of await readdir(join(BAC, "api")))
  if (f.endsWith(".js"))
    fonctions.set("/api/" + f.replace(/\.js$/, ""), (await import(join(BAC, "api", f))).default);

const serveur = createServer(async (rq, rs) => {
  const url = new URL(rq.url, "http://x");
  let chemin = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");

  /* Le middleware d'abord : c'est lui qui pose le cookie de ville sur la
     réponse qui porte index.html — tout le démarrage à froid en dépend. */
  let entetesMiddleware = {};
  try {
    const reponse = middleware(new Request("https://autour.eu" + rq.url,
      { headers: { "x-vercel-ip-latitude": "50.7236", "x-vercel-ip-longitude": "3.1610",
                   "x-vercel-ip-city": "Tourcoing", "x-vercel-ip-country": "FR" } }));
    if (reponse && reponse.headers)
      reponse.headers.forEach((v, k) => { if (k === "set-cookie") entetesMiddleware[k] = v; });
  } catch (e) { /* le middleware ne doit jamais empêcher une réponse */ }

  const fonction = fonctions.get(chemin);
  if (fonction) {
    const reponse = await fonction(new Request("https://autour.eu" + rq.url));
    const corps = await reponse.text();
    const entetes = {};
    reponse.headers.forEach((v, k) => { entetes[k] = v; });
    rs.writeHead(reponse.status, entetes);
    return rs.end(corps);
  }

  if (chemin === "/") chemin = "/index.html";
  const apresReecriture = reecrire(chemin);
  const fichier = join(SORTIE, apresReecriture === chemin ? chemin : apresReecriture);
  try {
    const contenu = await readFile(fichier);
    const entetes = Object.assign({
      "content-type": MIME[extname(fichier)] || "application/octet-stream",
    }, regleEntetes(apresReecriture), entetesMiddleware);
    if (/gzip/.test(rq.headers["accept-encoding"] || "") &&
        /^(text|application)\/(html|javascript|css|json)/.test(entetes["content-type"])) {
      entetes["content-encoding"] = "gzip";
      rs.writeHead(200, entetes);
      return rs.end(gzipSync(contenu));
    }
    rs.writeHead(200, entetes);
    rs.end(contenu);
  } catch (e) {
    rs.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("NOT_FOUND");
  }
});
await new Promise((r) => serveur.listen(Number(process.env.PORT || 0), r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

console.log("\n──── 4. contrat HTTP ────\n");
const demander = async (chemin, entetes) => {
  const r = await fetch(BASE + chemin, { headers: entetes || {}, redirect: "manual" });
  return { statut: r.status, entetes: Object.fromEntries(r.headers), texte: await r.text() };
};

const index = await demander("/");
verifier("/ sert bien le document d’Autour",
  index.statut === 200 && /<title>Autour · /.test(index.texte), String(index.statut));
verifier("le HTML se revalide à chaque ouverture",
  /max-age=0/.test(index.entetes["cache-control"] || "") &&
  /must-revalidate/.test(index.entetes["cache-control"] || ""),
  index.entetes["cache-control"]);
verifier("le middleware pose toujours le cookie de ville",
  /autour_geo=/.test(index.entetes["set-cookie"] || ""), index.entetes["set-cookie"]);

/* Le chemin critique est-il bien livré en deux étages ? Le shell doit pouvoir
   accuser réception d'un geste sans attendre le moteur. Le moteur complet
   reste un seul paquet différé ; les modules individuels restent présents pour
   les liens directs et le diagnostic, mais le HTML n'en demande aucun. */
const scripts = [...index.texte.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
  .filter((s) => !/^https?:/.test(s));
verifier("le document charge un seul shell critique", scripts.length === 1 &&
  /^autour-shell\.js\?v=[a-f0-9]{8}$/.test(scripts[0] || ""),
  scripts.length + " scripts");
const shell = await demander("/" + scripts[0]);
const moteur = index.texte.match(/data-autour-moteur="1"[^>]+href="(autour\.js\?v=[a-f0-9]{8})"/);
verifier("le shell dispose d’un moteur versionné à précharger",
  shell.statut === 200 && !!moteur, index.texte.slice(0, 160));
const app = moteur ? await demander("/" + moteur[1])
  : { statut: 404, texte: "", entetes: {} };
const appSource = await readFile(join(RACINE, "app.js"), "utf8");
verifier("autour.js servi est le bundle allégé",
  app.statut === 200 && app.texte.includes("function ouvrirFeuille("),
  Math.round(app.texte.length / 1024) + " ko servis");
/* « Plus AUCUN commentaire » serait faux, et le dire serait se mentir :
   esbuild conserve quelques commentaires courts collés à un élément de
   tableau, et il ajoute ses propres annotations `/* @__PURE__ *\/`. Ce qui
   compte, c'est que la PROSE soit partie — les blocs de plusieurs lignes qui
   expliquent le pourquoi, et qui pesaient 47 % du poids compressé. */
const commentaires = [...app.texte.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0])
  .filter((c) => !/@__PURE__/.test(c));
const resteCommentaires = commentaires.reduce((n, c) => n + c.length, 0);
const sourceCommentaires = [...appSource.matchAll(/\/\*[\s\S]*?\*\//g)]
  .reduce((n, m) => n + m[0].length, 0);
/* esbuild garde les commentaires collés à un élément de tableau ou à une
   propriété d'objet : ils lui servent d'ancrage. Il en reste donc une poignée,
   et c'est très bien — ce qu'on voulait retirer, c'est le volume. */
verifier("il ne reste qu’une poignée de commentaires",
  resteCommentaires < sourceCommentaires * 0.05,
  Math.round(resteCommentaires / 1024) + " ko sur " +
  Math.round(sourceCommentaires / 1024) + " ko de commentaires en source");
console.log("     " + commentaires.length + " commentaires subsistent (" +
  Math.round(resteCommentaires / 1024 * 10) / 10 + " ko), soit " +
  Math.round(resteCommentaires / sourceCommentaires * 100) + " % du volume d’origine");
verifier("autour.js garde ses noms de fonctions", /function ouvrirFeuille\(/.test(app.texte));
verifier("les modules .js sont immuables pour un an",
  /max-age=31536000/.test(app.entetes["cache-control"] || "") &&
  /immutable/.test(app.entetes["cache-control"] || ""), app.entetes["cache-control"]);

/* Le shell et le moteur doivent répondre : une empreinte qui ne suit pas, et
   c'est un 404 sur le démarrage. */
const manquants = [];
for (const s of scripts) if ((await demander("/" + s)).statut !== 200) manquants.push(s);
if (moteur && (await demander("/" + moteur[1])).statut !== 200) manquants.push(moteur[1]);
verifier("aucun script du document ne manque à l’appel", manquants.length === 0,
  manquants.join(", "));

const differe = await demander("/differe/ecrans.js" +
  (/\?v=[a-f0-9]{8}/.exec(await readFile(join(SORTIE, "app.js"), "utf8")) || [""])[0]);
verifier("le module différé est servi et immuable",
  differe.statut === 200 && /immutable/.test(differe.entetes["cache-control"] || ""));

const zone = await demander("/zones/50.7,3.1.json");
verifier("les jeux de zone gardent leur cache long",
  zone.statut === 200 && /s-maxage=604800/.test(zone.entetes["cache-control"] || ""),
  zone.entetes["cache-control"]);
verifier("manifest.json est servi", (await demander("/manifest.json")).statut === 200);
verifier("le SDK Supabase vendorisé est servi",
  (await demander("/vendeur/supabase-2.108.2.js")).statut === 200);

console.log("\n  ── routes ──");
for (const route of ["/l/abc123", "/e/abc123"]) {
  const r = await demander(route);
  verifier(route + " rend l’application", r.statut === 200 && /<title>Autour · /.test(r.texte),
    String(r.statut));
}
const commune = await demander("/api/commune?lat=50.7236&lng=3.1610");
verifier("/api/commune répond depuis la racine du projet",
  commune.statut > 0 && commune.statut !== 404, String(commune.statut));

console.log("\n  ── ce qui ne doit PAS être atteignable ──");
const prives = [
  "/supabase/migrations/20260820112353_territorial_event_orchestrator.sql",
  "/supabase/functions/sync-openagenda/index.ts",
  "/supabase/functions/sync-openagenda/dedup.mjs",
  "/tests/source.mjs", "/tests/cache.test.mjs",
  "/outils/alleger.mjs", "/outils/villes.json", "/outils/hubs.json",
  "/docs/chemin-critique.md", "/docs/comptes.md",
  "/vercel.json", "/package.json", "/.vercelignore",
  "/middleware.js", "/api/lieux.js", "/api/commune.js",
  "/livraison/app.js",
];
const exposes = [];
for (const chemin of prives) if ((await demander(chemin)).statut === 200) exposes.push(chemin);
verifier("aucune source privée n’est servie", exposes.length === 0, exposes.join(", "));
console.log("     " + prives.length + " chemins éprouvés, tous en 404");

/* ---- 5. L'application, dans un navigateur, sur l'arbre servi ------------ */

console.log("\n──── 5. l’application sur le build ────\n");
const { chromium, devices } = await import("playwright");
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const navigateur = await chromium.launch({
  executablePath: process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const contexte = await navigateur.newContext(Object.assign({}, devices["Pixel 5"], {
  permissions: ["geolocation"], geolocation: { latitude: 50.7236, longitude: 3.1610 },
  locale: "fr-FR",
}));
const page = await contexte.newPage();
const erreursJs = [];
page.on("pageerror", (e) => erreursJs.push(String(e.message).slice(0, 160)));

/* Toutes les URL externes sont notées : c'est ainsi qu'on prouve que
   l'orchestration OpenAgenda reste côté serveur. */
const sorties = [];
await page.route("**/*", async (route) => {
  const u = route.request().url();
  /* Le relais `/api/lieux` est une vraie fonction du bord : elle appelle
     Overpass pour de bon, et ce bac n'a pas de réseau sortant. Section 4 l'a
     déjà éprouvée pour ce qu'elle est ; ici on veut l'application, pas le
     relais. Tout le reste du site est servi tel qu'il est construit. */
  if (u.startsWith(BASE) && !/\/api\/lieux/.test(u)) return route.continue();
  if (!u.startsWith(BASE)) sorties.push(u);
  const json = (d) => route.fulfill({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(d) });
  if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(u))
    return route.fulfill({ status: 200, contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64") });
  if (/leaflet.*\.js(\?|$)/.test(u)) return route.fulfill({ status: 200,
    contentType: "text/javascript", body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
  if (/leaflet.*\.css(\?|$)/.test(u)) return route.fulfill({ status: 200,
    contentType: "text/css", body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
  if (/overpass|\/api\/lieux/.test(u)) return json({ elements: Array.from({ length: 12 }, (_, i) => ({
    type: "node", id: 7000 + i, lat: 50.7236 + ((i % 4) - 2) * 0.002,
    lon: 3.1610 + (Math.floor(i / 4) - 1) * 0.002,
    tags: { name: "Lieu " + (i + 1), amenity: ["cafe", "restaurant", "pharmacy", "library"][i % 4],
            opening_hours: "Mo-Su 00:00-24:00" } })) });
  return json([]);
});
await page.addInitScript(() => {
  const rep = (d) => Promise.resolve({ data: d, error: null });
  window.__supabaseAppele = 0;
  window.supabase = { createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => rep(null) }),
      order() { return this; }, limit() { return this; }, then: (r) => rep([]).then(r) }) }),
    rpc: (nom) => { window.__supabaseAppele += 1; window.__dernierRpc = nom; return rep([]); },
    auth: { getSession: () => rep({ session: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) } }) };
});

await page.goto(BASE + "/index.html");
await page.waitForFunction(() => typeof lieux !== "undefined" && lieux.length > 0,
  null, { timeout: 25000 });
await page.waitForTimeout(1500);

const demarrage = await page.evaluate(() => ({
  lieux: lieux.length,
  carte: typeof map !== "undefined" && !!map,
  google: !!(window.AutourMapProviders && window.AutourMapProviders.googleMaps),
  supabase: window.__supabaseAppele,
  rpc: window.__dernierRpc || null,
}));
verifier("l’application démarre et trouve des lieux", demarrage.lieux > 0, String(demarrage.lieux));
const maintenant = await page.evaluate(async () => {
  ouvrirSurfaceMaintenant();
  await new Promise((r) => setTimeout(r, 80));
  const liste = document.querySelector('[data-testid="maintenant-liste"]');
  return { etat: liste && liste.dataset.mnEtat,
    visible: !!(liste && liste.getBoundingClientRect().height) };
});
verifier("« Maintenant » sort de son état de chargement",
  maintenant.visible && maintenant.etat && maintenant.etat !== "loading", JSON.stringify(maintenant));
verifier("la carte est là", demarrage.carte);
verifier("le fournisseur Google Maps est chargé et disponible", demarrage.google);
verifier("Supabase est interrogé (couche territoriale)",
  demarrage.supabase > 0, demarrage.supabase + " appel(s), dernier : " + demarrage.rpc);

/* L'orchestration reste côté serveur : le navigateur résout une zone, il
   n'appelle jamais OpenAgenda ni la fonction de synchronisation. */
verifier("OpenAgenda n’est jamais appelé depuis le navigateur",
  !sorties.some((u) => /api\.openagenda\.com|functions\/v1\/sync-openagenda/.test(u)),
  sorties.filter((u) => /openagenda/.test(u)).join(", "));

const aide = await page.evaluate(async () => {
  if(!document.body.classList.contains("aide")) basculerAide();
  ouvrirFeuille2("aide");
  await new Promise((r) => setTimeout(r, 400));
  const actif = document.body.classList.contains("aide");
  const contenu = (document.querySelector("#fbCorps") || { textContent: "" }).textContent;
  const squelette = document.querySelectorAll("#fbCorps [data-testid=\"squelette\"]").length;
  const panneau = document.querySelector("#feuilleBesoins");
  if(panneau && !panneau.hidden) fermerFeuille2({nettoyerHistorique:false});
  if(document.body.classList.contains("aide")) basculerAide();
  return { actif, aQuelqueChose: contenu.trim().length > 40 || squelette === 3,
    longueur: contenu.trim().length, squelette };
});
verifier("Aide s’ouvre et affiche quelque chose", aide.actif && aide.aQuelqueChose,
  JSON.stringify(aide));

/* La création se fait en trois temps : choisir un type, poser un point, puis
   remplir. Le formulaire vit dans le module différé — c'est donc le chemin qui
   prouve que le découpage n'a rien cassé, pas la première étape. */
const creation = await page.evaluate(async () => {
  ouvrirCreation();
  await new Promise((r) => setTimeout(r, 300));
  const f = document.querySelector("#feuille");
  const types = f ? f.querySelectorAll("[data-type]").length : 0;

  const premier = f && f.querySelector("[data-type]");
  if (premier) premier.click();
  await new Promise((r) => setTimeout(r, 400));
  const enPose = document.body.classList.contains("pose") ||
    (typeof modePose !== "undefined" && modePose);

  if (typeof validerPose === "function") validerPose();
  await new Promise((r) => setTimeout(r, 900));
  const feuille = document.querySelector("#feuille");
  const champs = feuille && !feuille.hidden
    ? feuille.querySelectorAll("input,textarea,select").length : 0;
  fermerFeuille();
  return { types, enPose, champs };
});
verifier("la création propose les types à publier", creation.types > 0, JSON.stringify(creation));
verifier("choisir un type entre en mode pose", creation.enPose, JSON.stringify(creation));
verifier("poser un point ouvre le formulaire (module différé)",
  creation.champs > 0, JSON.stringify(creation));

const favori = await page.evaluate(() => {
  const id = lieux[0].id;
  const avant = estGarde(id);
  basculerGarde(id);
  const apres = estGarde(id);
  basculerGarde(id);
  return { avant, apres, revenu: estGarde(id) };
});
verifier("un favori se pose et se retire",
  favori.avant !== favori.apres && favori.revenu === favori.avant, JSON.stringify(favori));

const profil = await page.evaluate(async () => {
  await ouvrirProfil();
  await new Promise((r) => setTimeout(r, 700));
  const f = document.querySelector("#feuille");
  const texte = f && !f.hidden ? f.textContent.replace(/\s+/g, " ").trim() : "";
  fermerFeuille();
  return { visible: !!texte, extrait: texte.slice(0, 70) };
});
verifier("le profil s’ouvre (module différé chargé à la demande)",
  profil.visible, profil.extrait);

verifier("aucune erreur JavaScript sur le build servi", erreursJs.length === 0,
  erreursJs.join(" | "));

await navigateur.close();

/* ---- Verdict ----------------------------------------------------------- */

const total = resultats.length, passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + total + " vérifications passées");
console.log("\n  racine du build : " + BAC);
console.log("  dossier servi   : " + SORTIE);
if (process.argv.includes("--garder")) {
  console.log("  serveur ouvert sur " + BASE + " (Ctrl-C pour arrêter)");
} else {
  await new Promise((r) => serveur.close(r));
  process.exitCode = passes === total ? 0 : 1;
}
