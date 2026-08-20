/* =========================================================================
   LES GESTES, DANS UN VRAI NAVIGATEUR

   Les tests du dépôt lisent la source : ils vérifient qu'une règle est écrite.
   Ils ne peuvent pas voir qu'un geste produit DEUX conséquences, parce que ça
   ne se lit nulle part — ça se produit à l'exécution, quand `pointerup` et
   `click` se suivent, ou quand un défilement et un balayage se disputent le
   même doigt.

   Ce banc rejoue les gestes réellement décrits par la personne qui a testé :
   tirer la poignée, faire défiler le panneau, ouvrir et refermer plusieurs
   fois. Il vérifie qu'une action produit une conséquence, et une seule.

   Usage : node outils/interactions.mjs
   ========================================================================= */

import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { chromium, devices } from "playwright";

const RACINE = process.env.RACINE_MESURE || join(dirname(fileURLToPath(import.meta.url)), "..");
/* La source du dépôt, distincte de ce qu'on sert. `RACINE_MESURE` peut viser
   une copie de livraison, réimprimée sans commentaires : y chercher une règle
   au caractère près ne dirait plus rien de l'application. */
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function servir(port) {
  return new Promise((pret) => {
    const serveur = createServer(async (req, res) => {
      const chemin = normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
      try {
        const contenu = await readFile(join(RACINE, chemin === "/" ? "index.html" : chemin));
        const type = MIME[extname(chemin)] || "application/octet-stream";
        const gz = /gzip/.test(req.headers["accept-encoding"] || "") && /text|javascript|json/.test(type);
        res.writeHead(200, Object.assign({ "content-type": type },
          gz ? { "content-encoding": "gzip" } : {}));
        res.end(gz ? gzipSync(contenu) : contenu);
      } catch (e) { res.writeHead(404).end(""); }
    });
    serveur.listen(port, () => pret(serveur));
  });
}

const resultats = [];
const latences = [];
function verifier(nom, condition, detail) {
  resultats.push({ nom, ok: !!condition, detail: detail || "" });
  console.log((condition ? "  ✓ " : "  ✗ ") + nom + (condition || !detail ? "" : "  → " + detail));
}

const port = 8600 + Math.floor(Math.random() * 300);
const serveur = await servir(port);
const navigateur = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const contexte = await navigateur.newContext(Object.assign({}, devices["Pixel 5"], {
  permissions: ["geolocation"], geolocation: { latitude: 50.0, longitude: 3.0 },
  locale: "fr-FR", hasTouch: true, isMobile: true,
}));
const page = await contexte.newPage();
/* L'extérieur est coupé : ces gestes ne dépendent d'aucune source, et une
   requête qui traîne rendrait le banc capricieux. */
const session = await contexte.newCDPSession(page);
await session.send("Network.setBlockedURLs", {
  urls: ["*overpass*", "*supabase*", "*openagenda*", "*nominatim*", "*/api/*",
         "*basemaps*", "*cdnjs*", "*fonts.g*", "*jsdelivr*", "*maps.googleapis*"],
});

const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e.message || e).slice(0, 160)));

await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil: "commit" });
await page.waitForFunction(() => window.AutourPerf && window.AutourPerf.temps.ui_ready, null,
  { timeout: 15000 });
await page.waitForTimeout(1200);

const etat = () => page.evaluate(() => {
  const f = document.getElementById("feuilleBesoins");
  if (!f || f.hidden) return "fermee";
  return f.classList.contains("deplie") ? "deplie"
       : f.classList.contains("reduite") ? "reduite" : "moyenne";
});

/* ---- 1. La poignée : un geste, un cran ---------------------------------- */

console.log("\n── La poignée du panneau ──");

async function ouvrirPanneau(mesurer = false) {
  const debut = Date.now();
  await page.evaluate(() => {
    if (typeof ouvrirFeuille2 === "function") ouvrirFeuille2("racine");
  });
  await page.waitForFunction(() => {
    const f = document.getElementById("feuilleBesoins");
    return f && !f.hidden;
  });
  if (mesurer) latences.push({ geste:"ouvrir Autour de toi", ms:Date.now()-debut });
  await page.waitForTimeout(400);
}
await ouvrirPanneau(true);
verifier("le panneau s'ouvre en position moyenne", (await etat()) === "moyenne", await etat());

/* Un glissement vers le haut sur la poignée. Avec l'ancien code, `pointerup`
   montait d'un cran puis le `click` qui suit en montait un second. */
async function glisserPoignee(dy) {
  const boite = await page.locator("#fbPoignee").boundingBox();
  const x = boite.x + boite.width / 2;
  const y = boite.y + boite.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i += 1) await page.mouse.move(x, y + (dy * i) / 5);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

await glisserPoignee(-90);
verifier("un glissement vers le haut monte d'UN cran (moyenne → dépliée)",
  (await etat()) === "deplie", "état : " + (await etat()));

await glisserPoignee(110);
verifier("un glissement vers le bas descend d'UN cran (dépliée → moyenne)",
  (await etat()) === "moyenne", "état : " + (await etat()));

/* Un appui bref, sans déplacement : c'est le clic qui doit agir, une fois.
   Le `try` n'est pas de la prudence décorative : sur une version où le
   glissement précédent a fermé le panneau, la poignée n'existe plus, et un
   banc qui s'effondre là ne dirait pas CE QUI a échoué. */
try {
  await page.locator("#fbPoignee").click({ timeout: 3000 });
  await page.waitForTimeout(400);
verifier("un appui bref cycle d'UN cran (moyenne → dépliée)",
    (await etat()) === "deplie", "état : " + (await etat()));
} catch (e) {
  verifier("un appui bref cycle d'UN cran (moyenne → dépliée)", false,
    "la poignée n'était plus atteignable : " + String(e.message).split("\n")[0]);
}

/* ---- 1b. Les groupes temporels : retour visuel sous 100 ms -------------- */

console.log("\n── Changer de groupe temporel ──");
await page.evaluate(() => {
  if (typeof ouvrirFeuille2 === "function") ouvrirFeuille2("racine");
});
for (const [id, libelle] of [["soir","Ce soir"],["avenir","À venir"],["maintenant","Maintenant"]]) {
  const bouton = page.locator('[data-creneau="'+id+'"]');
  if (!(await bouton.count())) {
    verifier(libelle+" est disponible", false, "bouton absent");
    continue;
  }
  /* Mesure dans la page jusqu'au frame qui peut peindre le nouvel état. Les
     attentes d'actionnabilité propres à Playwright ne sont pas une latence de
     l'application et ne doivent pas être comptées. */
  const ms = Math.round(await page.evaluate(async (cible) => {
    const b = document.querySelector('[data-creneau="'+cible+'"]');
    const debut = performance.now();
    b.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now()-debut;
  }, id));
  latences.push({geste:libelle, ms});
  verifier(libelle+" répond en moins de 100 ms", ms < 100, ms+" ms");
  await page.waitForTimeout(350);
}

/* ---- 2. Défiler ne ferme pas ------------------------------------------- */

console.log("\n── Défiler le panneau de détail ──");

const detailOuvert = await page.evaluate(() => {
  const l = (window.lieux || [])[0];
  if (!l) return false;
  if (typeof ouvrirDetail === "function") { ouvrirDetail(l.id); return true; }
  return false;
});
if (!detailOuvert) {
  /* Sans lieu en mémoire (sources coupées), on éprouve la règle directement :
     c'est la condition de garde qui est en cause, pas l'ouverture du panneau. */
  const garde = await page.evaluate(() => {
    const f = document.getElementById("feuille");
    return !!f;
  });
  verifier("le panneau de détail existe", garde);
  const source = await readFile(join(SOURCE, "app.js"), "utf8");
  /* Espaces libres : la même règle s'écrit `if(x > 2)` dans le dépôt et
     `if (x > 2)` une fois réimprimée. C'est la règle qui compte. */
  const regle = (motif) => new RegExp(motif.replace(/ /g, "\\s*")).test(source);
  verifier("un balayage ne ferme que depuis le haut de la liste",
    regle("if \\( depart\\.scroll > 2 \\) return;") &&
    regle("if \\( feuilleDetail\\.scrollTop > 2 \\) return;"));
  verifier("un geste interrompu ne déclenche rien plus tard",
    regle('feuilleDetail\\.addEventListener\\( "touchcancel"'));
} else {
  await page.waitForTimeout(500);
  const ferme = await page.evaluate(async () => {
    const f = document.getElementById("feuille");
    f.scrollTop = 200;
    const envoyer = (type, y) => f.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      changedTouches: [new Touch({ identifier: 1, target: f, clientX: 100, clientY: y })],
      touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: f, clientX: 100, clientY: y })],
    }));
    envoyer("touchstart", 100);
    envoyer("touchend", 260);
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById("feuille").hidden;
  });
  verifier("faire défiler la liste vers le bas ne ferme pas le panneau", !ferme);
}

/* ---- 3. Stabilité après plusieurs cycles -------------------------------- */

console.log("\n── Ouvrir et fermer, dix fois ──");

await page.evaluate(() => { if (typeof fermerFeuille2 === "function") fermerFeuille2(); });
await page.waitForTimeout(300);
const etats = [];
for (let i = 0; i < 10; i += 1) {
  await ouvrirPanneau();
  etats.push(await etat());
  await page.evaluate(() => { if (typeof fermerFeuille2 === "function") fermerFeuille2(); });
  await page.waitForTimeout(220);
}
verifier("dix ouvertures donnent dix fois le même état",
  etats.every((e) => e === etats[0]), etats.join(", "));

const hauteurFinale = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--sheet-visible-height").trim());
verifier("la hauteur publiée retombe à zéro une fois le panneau fermé",
  hauteurFinale === "0px", "valeur : " + hauteurFinale);

/* ---- 4. Aucune erreur ---------------------------------------------------- */

console.log("\n── Journal ──");
verifier("aucune erreur JavaScript pendant les gestes", erreurs.length === 0,
  erreurs.join(" | "));
console.log("  latences : "+latences.map(x=>x.geste+" "+x.ms+" ms").join(" · "));

await navigateur.close();
await new Promise((r) => serveur.close(r));

const echecs = resultats.filter((r) => !r.ok);
console.log("\n" + (resultats.length - echecs.length) + "/" + resultats.length + " vérifications passées");
if (echecs.length) process.exitCode = 1;
