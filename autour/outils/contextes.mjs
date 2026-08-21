/* ===========================================================================
   Le mélange des contextes géographiques — vérifié dans un vrai navigateur

   LE BUG, TEL QU'IL A ÉTÉ RAPPORTÉ : « je suis physiquement à Tourcoing, je
   recherche Lille. L'interface affiche Lille, mais certains lieux, marqueurs,
   recommandations et Maintenant continuent à provenir de Tourcoing. »

   POURQUOI UN BANC PLUTÔT QU'UN TEST UNITAIRE. Les tests unitaires prouvent la
   règle — un lieu de Tourcoing n'est pas dans la zone de Lille. Ils ne peuvent
   pas prouver qu'elle est branchée PARTOUT : c'est justement ce qui manquait,
   et ça ne se voit qu'en ouvrant l'application, en tapant « Lille », et en
   regardant ce qui reste à l'écran.

   Les deux villes sont à douze kilomètres et se touchent par leurs banlieues.
   Un banc Lille/Marseille passerait avec n'importe quelle bêtise.

     npm install playwright leaflet
     node outils/contextes.mjs                     (depuis la racine du dépôt)
   ======================================================================== */

import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = process.env.AUTOUR_RACINE || new URL("..", import.meta.url).pathname;
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml" };

const serveur = createServer(async (req, res) => {
  let chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin === "/") chemin = "/index.html";
  try {
    const fichier = join(RACINE, chemin);
    const s = await stat(fichier);
    if (!s.isFile()) throw new Error("dir");
    res.writeHead(200, { "content-type": TYPES[extname(fichier)] || "application/octet-stream" });
    res.end(await readFile(fichier));
  } catch { res.writeHead(404); res.end("non"); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

/* ---- Les trois villes, avec leurs vraies coordonnées et emprises --------- */
const VILLES = {
  tourcoing: { centre: [50.7236, 3.1610], bb: ["50.6934","50.7480","3.1194","3.1929"] },
  lille:     { centre: [50.6292, 3.0573], bb: ["50.5949","50.6570","2.9557","3.1413"] },
  paris:     { centre: [48.8566, 2.3522], bb: ["48.8156","48.9022","2.2242","2.4699"] },
  /* Rouen : un territoire du registre, loin des trois autres. Il éprouve un
     enchaînement de plus — Paris → Rouen — c'est-à-dire une bascule entre
     deux villes dont AUCUNE n'est la position physique. */
  rouen:     { centre: [49.4432, 1.0999], bb: ["49.4100","49.4750","1.0200","1.1600"] },
};

/* Des lieux ouverts en permanence, pour que « Maintenant » ait de quoi
   choisir, et des événements en cours pour la première priorité. */
function poisAutour([lat, lng], prefixe, n = 40) {
  return Array.from({ length: n }, (_, i) => ({
    type: "node", id: Number(prefixe) * 100000 + i,
    lat: lat + ((i % 6) - 3) * 0.0016,
    lon: lng + (Math.floor(i / 6) - 3) * 0.0022,
    tags: { name: prefixe + " lieu " + (i + 1),
            amenity: ["restaurant","cafe","bar","cinema","library"][i % 5],
            opening_hours: "Mo-Su 00:00-24:00" },
  }));
}
function evenementsAutour([lat, lng], prefixe, n = 6) {
  const t = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: prefixe.slice(0,1) + String(i).padStart(7,"0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: prefixe + " concert " + (i + 1), description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    temporal_status: "happening_now",
    start_at: new Date(t - 3600e3).toISOString(),
    end_at: new Date(t + 3600e3).toISOString(),
    place_name: prefixe + " salle", address: "1 rue", city: prefixe, insee_code: null,
    lat: lat + 0.0009 * (i + 1), lng: lng + 0.0007,
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null, last_synced_at: new Date().toISOString(),
  }));
}

const DONNEES = {
  tourcoing: { pois: poisAutour(VILLES.tourcoing.centre, "TOURCOING"),
               evts: evenementsAutour(VILLES.tourcoing.centre, "TOURCOING") },
  lille:     { pois: poisAutour(VILLES.lille.centre, "LILLE"),
               evts: evenementsAutour(VILLES.lille.centre, "LILLE") },
  paris:     { pois: poisAutour(VILLES.paris.centre, "PARIS"),
               evts: evenementsAutour(VILLES.paris.centre, "PARIS") },
  rouen:     { pois: poisAutour(VILLES.rouen.centre, "ROUEN"),
               evts: evenementsAutour(VILLES.rouen.centre, "ROUEN") },
};

/* Quelle ville sert-on pour un point donné ? Exactement comme un vrai backend :
   la requête porte des coordonnées, la réponse porte ce qu'il y a là-bas. */
function villeLaPlusProche(lat, lng) {
  let meilleure = null, d = Infinity;
  for (const [nom, v] of Object.entries(VILLES)) {
    const dd = (v.centre[0] - lat) ** 2 + (v.centre[1] - lng) ** 2;
    if (dd < d) { d = dd; meilleure = nom; }
  }
  return meilleure;
}

/* Une requête qu'on peut faire traîner à volonté : c'est le scénario
   « réponse de Tourcoing qui revient après le passage à Lille ». */
let retardTourcoing = 0;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const resultats = [];
function verifier(nom, ok, detail) {
  resultats.push({ nom, ok, detail: detail || "" });
  console.log((ok ? "  ok   " : "  ÉCHEC") + "  " + nom + (detail ? "  — " + detail : ""));
}

const nav = await chromium.launch({ executablePath: CHROME });
const ctx = await nav.newContext({
  ...devices["Desktop Chrome"], permissions: ["geolocation"],
  geolocation: { latitude: VILLES.tourcoing.centre[0], longitude: VILLES.tourcoing.centre[1] },
  locale: "fr-FR",
});
/* LA POSITION DÉDUITE DE L'ADRESSE IP, comme en production : le middleware la
   dépose dans un cookie sur la réponse qui porte `index.html`. Sans elle,
   Autour démarre sur son repli parisien, puis saute deux cents kilomètres à
   l'arrivée du GPS — un vol pendant lequel le zoom passe sous le seuil de
   chargement, si bien qu'aucun lieu de Tourcoing n'était jamais demandé. Le
   banc mesurait alors une ville vide. En vrai, l'adresse IP tombe sur la bonne
   agglomération : c'est ce cas-là qu'il faut éprouver. */
await ctx.addCookies([{
  name: "autour_geo",
  value: encodeURIComponent(JSON.stringify({
    lat: VILLES.tourcoing.centre[0], lng: VILLES.tourcoing.centre[1], ville: "Tourcoing" })),
  url: BASE,
}]);
const page = await ctx.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(e.message));

await page.route("**/*", async (route) => {
  const u = route.request().url();
  const json = (c) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(c) });
  if (process.env.AUTOUR_TRACE && !u.startsWith(BASE) && !/tile|\.png/.test(u))
    console.log("  [net]", route.request().method(), u.slice(0, 80));
  /* `/api/lieux` est le relais Overpass d'Autour, servi par la même origine que
     la page : il faut donc l'intercepter AVANT le passe-plat vers le serveur
     statique, sinon il répond 404, l'application note « relais absent » et
     n'interroge plus jamais aucun lieu. Le banc mesurait alors un écran vide et
     appelait ça une réussite. */
  if (u.startsWith(BASE) && !/\/rpc\/|\/api\//.test(u)) return route.continue();
  if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(u))
    return route.fulfill({ status: 200, contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64") });
  if (/leaflet.*\.js(\?|$)/.test(u))
    return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
  if (/leaflet.*\.css(\?|$)/.test(u))
    return route.fulfill({ status: 200, contentType: "text/css", body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
  if (/supabase-js|@supabase/.test(u) && /\.js/.test(u))
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });

  /* Le géocodeur : il rend la vraie emprise de la ville demandée. C'est elle
     qui définit ensuite la zone active. */
  if (/nominatim/.test(u)) {
    const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || ["",""])[1]).toLowerCase();
    const clef = Object.keys(VILLES).find((v) => q.includes(v));
    if (!clef) return json([]);
    const v = VILLES[clef];
    return json([{ lat: String(v.centre[0]), lon: String(v.centre[1]),
      display_name: clef, importance: 0.8, boundingbox: v.bb }]);
  }

  /* Les lieux : la réponse dépend du point demandé, et celle de Tourcoing peut
     être retardée à la demande. */
  if (/overpass|\/api\/lieux/.test(u)) {
    /* La requête Overpass porte soit un rayon — `(around:1500,lat,lng)` — soit
       une emprise — `(sud,ouest,nord,est)`. Les deux commencent par un point
       qui suffit à savoir de quelle ville on parle. */
    const corps = decodeURIComponent(route.request().postData() || u);
    const autour = corps.match(/around:\d+,(-?\d+\.\d+),(-?\d+\.\d+)/);
    const boite = corps.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/);
    const p = autour ? [+autour[1], +autour[2]]
            : boite ? [(+boite[1] + +boite[3]) / 2, (+boite[2] + +boite[4]) / 2]
            : VILLES.tourcoing.centre;
    const ville = villeLaPlusProche(p[0], p[1]);
    if (process.env.AUTOUR_TRACE) console.log("  [lieux]", ville, p.map((x) => x.toFixed(3)).join(","));
    if (ville === "tourcoing" && retardTourcoing) await dormir(retardTourcoing);
    return json({ elements: DONNEES[ville].pois });
  }
  if (/rpc\/evenements_proches/.test(u)) {
    /* La vraie fonction prend une emprise (p_sud, p_ouest, p_nord, p_est), pas
       un point. Le premier bouchon lisait `lat`/`lng`, ne trouvait rien, et
       servait Tourcoing à tout le monde — y compris à Lille, dont les
       événements n'arrivaient donc jamais. */
    const n = (k) => { const m = u.match(new RegExp("[?&]" + k + "=(-?\\d+\\.?\\d*)")); return m ? +m[1] : null; };
    const s2 = n("sud"), o2 = n("ouest"), n2 = n("nord"), e2 = n("est");
    const ville = [s2, o2, n2, e2].every((x) => x !== null)
      ? villeLaPlusProche((s2 + n2) / 2, (o2 + e2) / 2) : "tourcoing";
    if (process.env.AUTOUR_TRACE) console.log("  [événements]", ville);
    return json(DONNEES[ville].evts);
  }
  if (/rpc\//.test(u)) return json([]);
  if (/geo\.api\.gouv|\/api\/commune/.test(u)) return json([{ nom: "Tourcoing" }]);
  return json([]);
});

await page.addInitScript(({ evts }) => {
  const rep = (d) => Promise.resolve({ data: d, error: null });
  /* Le SDK Supabase, réduit à ce que la page en fait. `rpc` passe par le réseau
     pour que la route ci-dessus décide de la ville — un bouchon qui répondrait
     tout seul mentirait exactement sur le point qu'on mesure. */
  window.supabase = { createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => rep(null) }),
      order() { return this; }, limit() { return this; }, then: (r) => rep([]).then(r) }) }),
    rpc: (n, p) => {
      /* Les paramètres passent par l'URL pour que la route puisse décider de la
         ville : un bouchon qui répondrait tout seul mentirait sur le point
         exact qu'on mesure. */
      const q = p ? "?" + Object.entries(p).map(([k, v]) =>
        k.replace(/^p_/, "") + "=" + encodeURIComponent(v)).join("&") : "";
      return fetch("/rpc/" + n + q).then((r) => r.json())
        .then((d) => ({ data: d, error: null })).catch(() => ({ data: [], error: null }));
    },
    auth: { getSession: () => rep({ session: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  }) };
  void evts;
}, { evts: 1 });

await page.goto(BASE + "/index.html");
await page.waitForTimeout(6000);

/* ---- Ce qu'on observe --------------------------------------------------- */
async function etat() {
  return page.evaluate(() => {
    const dedans = (l) => typeof dansZoneActive === "function" ? dansZoneActive(l) : true;
    const visibles = (typeof lieux !== "undefined" ? lieux : []).filter(dedans);
    const compte = (liste) => {
      const c = { TOURCOING: 0, LILLE: 0, PARIS: 0, ROUEN: 0, autre: 0 };
      liste.forEach((l) => {
        const n = ((l && (l.titre || l.title || l.nom)) || "").toUpperCase();
        if (n.includes("TOURCOING")) c.TOURCOING += 1;
        else if (n.includes("LILLE")) c.LILLE += 1;
        else if (n.includes("PARIS")) c.PARIS += 1;
        else if (n.includes("ROUEN")) c.ROUEN += 1;
        else c.autre += 1;
      });
      return c;
    };
    /* Les marqueurs réellement posés sur la carte. La variable locale porte un
       autre nom que la globale : une première version l'appelait `marqueurs`
       elle aussi, masquait donc celle de la page, et comptait fièrement zéro
       marqueur partout — y compris là où il y en avait quarante-six. */
    const poses = [];
    try {
      marqueurs.forEach((m) => {
        if (m && m._lieu) poses.push(m._lieu);
        if (m && m._pile) m._pile.forEach((x) => poses.push(x));
      });
    } catch (e) { poses.push({ titre: "LECTURE IMPOSSIBLE " + e.message }); }
    const corps = document.querySelector("#fbCorps");
    const copie = corps && corps.cloneNode(true);
    /* « Revenir autour de Tourcoing » est une commande légitime depuis Lille,
       pas un résultat resté dans la feuille. On la retire avant de vérifier le
       contenu de la zone demandée. */
    if(copie) copie.querySelectorAll("[data-retour-moi]").forEach(x=>x.remove());
    return {
      zone: typeof zoneActive !== "undefined" && zoneActive
        ? { type: zoneActive.type, nom: zoneActive.nom,
            lat: Math.round(zoneActive.lat * 1000) / 1000 } : null,
      zoneAffichee: typeof zoneAffichee !== "undefined" ? zoneAffichee : null,
      feuilleNiveau: typeof feuilleNiveau !== "undefined" ? feuilleNiveau : null,
      portee: typeof porteeCourante !== "undefined" ? porteeCourante : null,
      enMemoire: (typeof lieux !== "undefined" ? lieux : []).length,
      visibles: compte(visibles),
      maintenant: compte(typeof selectionMaintenant === "function" ? selectionMaintenant() : []),
      marqueurs: compte(poses),
      recos: compte(typeof recommandationsAccueil === "function" ? recommandationsAccueil(12) : []),
      texte: copie ? copie.textContent : "",
      cartesDom: corps ? [...corps.querySelectorAll("[data-ac]")].map((x)=>{
        const id = x.getAttribute("data-ac");
        const courant = (typeof lieux !== "undefined" ? lieux : []).find((l)=>String(l.id) === id);
        return {id, texte:(x.textContent || "").trim().slice(0, 80),
          courant:courant && courant.titre};
      }) : [],
      mentionsTourcoing: copie
        ? [...copie.querySelectorAll("*")]
            .filter((x)=>/TOURCOING/i.test(x.textContent || "") &&
              ![...x.children].some((y)=>/TOURCOING/i.test(y.textContent || "")))
            .map((x)=>({tag:x.tagName, classe:x.className,
              id:x.getAttribute("data-ac") || x.getAttribute("data-mn") || "",
              texte:(x.textContent || "").trim()})).slice(0, 6)
        : [],
      refuses: (typeof lieux !== "undefined" ? lieux : []).filter((l) => !dedans(l))
        .slice(0, 4).map((l) => (l.titre || "?") + " @" + l.lat + "," + l.lng),
    };
  });
}

/* La recherche passe par le champ, comme un vrai usage — pas par un appel
   direct à `rechercheGeographique`, qui sauterait tout ce qui l'entoure. */
async function chercher(ville) {
  /* ON MESURE CE QUI SE VOIT, PAS CE QU'ON ATTEND. Une première version rendait
     la durée de son propre `waitForTimeout` : trois mille cinq cents
     millisecondes à chaque bascule, quelle que soit la vitesse réelle. Un
     chiffre qui ne mesure que la patience de celui qui l'écrit. */
  const t0 = Date.now();
  await page.evaluate((v) => {
    const champ = document.querySelector("#rech");
    champ.value = v;
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const f = champ.closest("form");
    if (f) f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, ville);

  const jalon = async (predicat, arg, timeout = 12000) => {
    try { await page.waitForFunction(predicat, arg, { timeout, polling: 60 });
          return Date.now() - t0; }
    catch (e) { return null; }
  };
  const zone = await jalon((v) => typeof zoneActive !== "undefined" && zoneActive
    && zoneActive.type === "recherche"
    && (zoneActive.nom || "").toLowerCase().includes(v.toLowerCase()), ville);
  /* « Le premier lieu de la nouvelle zone », c'est n'importe quel lieu qui
     passe le filtre : après la bascule, tout ce qui reste affichable appartient
     à la ville demandée — c'est précisément ce que ce banc vérifie par
     ailleurs. Chercher le nom de la ville dans le titre mesurerait autre chose :
     la tuile précalculée porte de VRAIS noms lillois, pas le mot « Lille », et
     le jalon la manquait donc alors qu'elle est justement ce qui remplit
     l'écran en premier. */
  const premier = await jalon(() => typeof lieux !== "undefined" &&
    lieux.some((l) => dansZoneActive(l)));
  const trois = await jalon(() => {
    const s = typeof selectionMaintenant === "function" ? selectionMaintenant() : [];
    return s.length >= 3 && s.every((l) => dansZoneActive(l));
  }, null, 2500);
  await page.waitForTimeout(1200);         // laisser retomber les arrivées tardives
  return { zone, premier, trois };
}

console.log("\n=== 1. Ouverture à Tourcoing ===");
let e = await etat();
console.log("   zone active :", JSON.stringify(e.zone), "· portée", e.portee,
            "· en mémoire", e.enMemoire);
if (process.env.AUTOUR_TRACE) console.log("   refusés :", JSON.stringify(e.refuses));
verifier("la zone active à l’ouverture est la position de la personne",
  !!e.zone && e.zone.type === "moi", JSON.stringify(e.zone));
verifier("l’écran parle bien de Tourcoing",
  e.visibles.TOURCOING > 0 && e.visibles.LILLE === 0,
  JSON.stringify(e.visibles));

console.log("\n=== 2. Recherche « Lille » ===");
const tLille = await chercher("Lille");
e = await etat();
console.log("   zone active :", JSON.stringify(e.zone), "· portée", e.portee,
            "· feuille", JSON.stringify(e.zoneAffichee), e.feuilleNiveau,
            "· en mémoire", e.enMemoire, "· bascule", JSON.stringify(tLille));
verifier("Tourcoing → recherche Lille → 0 résultat Tourcoing",
  e.visibles.TOURCOING === 0, "visibles " + JSON.stringify(e.visibles));
verifier("marqueurs Lille → aucun ancien marqueur Tourcoing",
  e.marqueurs.TOURCOING === 0, "marqueurs " + JSON.stringify(e.marqueurs));
verifier("Maintenant Lille → uniquement des éléments de la zone Lille",
  e.maintenant.TOURCOING === 0 && e.maintenant.PARIS === 0,
  "Maintenant " + JSON.stringify(e.maintenant));
verifier("recommandations → aucune de Tourcoing",
  e.recos.TOURCOING === 0, "recos " + JSON.stringify(e.recos));
verifier("la feuille ne cite plus Tourcoing",
  !/TOURCOING/i.test(e.texte), JSON.stringify({mentions:e.mentionsTourcoing, cartes:e.cartesDom}));
verifier("les lieux de Tourcoing restent en mémoire (le retour doit être instantané)",
  e.enMemoire > e.visibles.LILLE, "en mémoire " + e.enMemoire);

console.log("\n=== 3. Puis « Paris » ===");
const tParis = await chercher("Paris");
e = await etat();
console.log("   zone active :", JSON.stringify(e.zone), "· bascule", JSON.stringify(tParis));
verifier("Tourcoing → Lille → Paris → aucun reste de Lille",
  e.visibles.LILLE === 0 && e.visibles.TOURCOING === 0,
  "visibles " + JSON.stringify(e.visibles));
verifier("Maintenant Paris → ni Lille ni Tourcoing",
  e.maintenant.LILLE === 0 && e.maintenant.TOURCOING === 0,
  "Maintenant " + JSON.stringify(e.maintenant));
verifier("marqueurs Paris → aucun reste",
  e.marqueurs.LILLE === 0 && e.marqueurs.TOURCOING === 0,
  "marqueurs " + JSON.stringify(e.marqueurs));

console.log("\n=== 3 bis. Puis « Rouen » : deux villes de suite, aucune n'est chez soi ===");
const tRouen = await chercher("Rouen");
e = await etat();
console.log("   zone active :", JSON.stringify(e.zone), "· bascule", JSON.stringify(tRouen));
verifier("Paris → Rouen → aucun reste de Paris",
  e.visibles.PARIS === 0 && e.visibles.LILLE === 0 && e.visibles.TOURCOING === 0,
  "visibles " + JSON.stringify(e.visibles));
verifier("Rouen → la zone active est bien Rouen",
  !!e.zone && e.zone.type === "recherche" && /rouen/i.test(e.zone.nom || ""),
  JSON.stringify(e.zone));
verifier("Maintenant Rouen → ni Paris, ni Lille, ni Tourcoing",
  e.maintenant.PARIS === 0 && e.maintenant.LILLE === 0 && e.maintenant.TOURCOING === 0,
  "Maintenant " + JSON.stringify(e.maintenant));
verifier("marqueurs Rouen → aucun reste des villes précédentes",
  e.marqueurs.PARIS === 0 && e.marqueurs.LILLE === 0 && e.marqueurs.TOURCOING === 0,
  "marqueurs " + JSON.stringify(e.marqueurs));
verifier("recommandations Rouen → aucune de Paris",
  e.recos.PARIS === 0, "recos " + JSON.stringify(e.recos));
verifier("l'écran ne reste pas vide à Rouen",
  e.visibles.ROUEN > 0, "visibles " + JSON.stringify(e.visibles));

console.log("\n=== 4. « Revenir autour de moi » ===");
const t0 = Date.now();
await page.evaluate(() => {
  const b = document.querySelector("#btnAutourDeMoi");
  if (b) b.click(); else revenirAutourDeMoi();
});
let msRetour = null;
try {
  await page.waitForFunction(() => typeof zoneActive !== "undefined" && zoneActive
    && zoneActive.type === "moi"
    && lieux.some((l) => dansZoneActive(l) && (l.titre || "").includes("TOURCOING")),
    null, { timeout: 12000, polling: 60 });
  msRetour = Date.now() - t0;
} catch (e) {}
await page.waitForTimeout(1500);
e = await etat();
console.log("   zone active :", JSON.stringify(e.zone), "· retour", msRetour + " ms");
verifier("Paris → Revenir autour de moi → uniquement Tourcoing",
  e.visibles.PARIS === 0 && e.visibles.LILLE === 0 && e.visibles.TOURCOING > 0,
  "visibles " + JSON.stringify(e.visibles));
verifier("la zone active redevient la position physique",
  !!e.zone && e.zone.type === "moi", JSON.stringify(e.zone));
verifier("Maintenant revient à Tourcoing",
  e.maintenant.PARIS === 0 && e.maintenant.LILLE === 0,
  "Maintenant " + JSON.stringify(e.maintenant));

console.log("\n=== 5. Requête Tourcoing lente, recherche Lille avant sa fin ===");
retardTourcoing = 4000;
/* On relance un chargement de Tourcoing, puis on part à Lille pendant qu'il
   traîne. Sa réponse arrivera quatre secondes plus tard, alors qu'on regarde
   Lille : elle porte l'ancienne portée et doit être jetée. */
await page.evaluate(() => { if (typeof chargerZone === "function")
  chargerZone(50.7236, 3.1610, { force: true }); });
await page.waitForTimeout(300);
await chercher("Lille");
await page.waitForTimeout(5000);                 // largement après la réponse lente
e = await etat();
console.log("   zone active :", JSON.stringify(e.zone), "· portée", e.portee);
verifier("réponse Tourcoing arrivée après le passage à Lille → ignorée",
  e.visibles.TOURCOING === 0 && e.marqueurs.TOURCOING === 0 && e.maintenant.TOURCOING === 0,
  "visibles " + JSON.stringify(e.visibles) + " marqueurs " + JSON.stringify(e.marqueurs));
retardTourcoing = 0;

console.log("\n=== 6. Cache Tourcoing chaud, Lille froid ===");
/* Rechargement complet : le cache disque de Tourcoing est chaud (on y a passé
   toute la session), celui de Lille aussi désormais. On rouvre sur Tourcoing et
   on repart à Lille immédiatement, sans laisser le réseau répondre. */
await page.goto(BASE + "/index.html");
await page.waitForTimeout(2500);
await chercher("Lille");
e = await etat();
verifier("cache Tourcoing chaud + Lille → aucun mélange",
  e.visibles.TOURCOING === 0, "visibles " + JSON.stringify(e.visibles));

/* ---- Verdict ------------------------------------------------------------ */
console.log("\n=== Temps de bascule (depuis l’appui sur Entrée) ===");
const ligne = (quoi, t) => console.log("  " + quoi.padEnd(40) +
  (t === null ? "jamais" : t + " ms"));
ligne("Lille · zone active changée", tLille.zone);
ligne("Lille · premier lieu de Lille visible", tLille.premier);
ligne("Lille · trois propositions Maintenant", tLille.trois);
ligne("Paris · zone active changée", tParis.zone);
ligne("Paris · premier lieu de Paris visible", tParis.premier);
ligne("Paris · trois propositions Maintenant", tParis.trois);
ligne("Rouen · zone active changée", tRouen.zone);
ligne("Rouen · premier lieu de Rouen visible", tRouen.premier);
ligne("Rouen · trois propositions Maintenant", tRouen.trois);
ligne("retour autour de moi", msRetour);
const lents = [tLille.premier, tParis.premier].filter((t) => t === null || t > 2500);
if (lents.length) console.log("  ⚠ une bascule dépasse 2,5 s ou n’aboutit pas");
if (erreurs.length) {
  console.log("\nErreurs JavaScript :");
  [...new Set(erreurs)].forEach((m) => console.log("  " + m));
}
const echecs = resultats.filter((r) => !r.ok);
console.log("\n" + (resultats.length - echecs.length) + "/" + resultats.length + " vérifications passées");
await nav.close(); serveur.close();
process.exit(echecs.length || erreurs.length ? 1 : 0);
