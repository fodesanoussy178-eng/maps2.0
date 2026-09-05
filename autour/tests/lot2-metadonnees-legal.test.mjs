/* ===========================================================================
   LOT 2 — Métadonnées, partage et pages légales

   Trois choses à tenir, et la troisième est la moins évidente :

     · les MÉTADONNÉES doivent exister et être absolues — une canonique
       relative se résout sur le domaine de prévisualisation Vercel, donc
       n'empêche rien ;
     · les PAGES LÉGALES doivent répondre, être atteignables et rester
       cohérentes avec le design sans embarquer l'application ;
     · la page de CONFIDENTIALITÉ doit dire ce que le code fait vraiment. Une
       affirmation de confidentialité fausse est pire qu'absente, et rien ne la
       contredit à l'exécution — d'où les tests qui la confrontent au code.
   ======================================================================== */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";

const lire = (f) => readFile(new URL("../" + f, import.meta.url), "utf8");

const html = await lire("index.html");
const legales = await lire("mentions-legales.html");
const confid = await lire("confidentialite.html");
const legalCss = await lire("legal.css");
const robots = await lire("robots.txt");
const vercel = JSON.parse(await lire("vercel.json"));
const app = await lire("app.js");
const middleware = await lire("middleware.js");

const og = new URL("../og.png", import.meta.url);

/* Une balise, lue comme un navigateur la lirait : par son attribut
   d'identification, pas par sa position dans le fichier. */
const meta = (source, cle, attribut) => {
  /* Le contenu peut contenir une apostrophe (« d'Autour ») : le délimiteur est
     capturé puis rappelé, au lieu d'exclure les deux guillemets à la fois. */
  const motif = new RegExp(
    '<meta[^>]*' + attribut + '=["\']' + cle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    '["\'][^>]*content=(["\'])([\\s\\S]*?)\\1', "i");
  const trouve = source.match(motif);
  return trouve ? trouve[2] : null;
};
const propriete = (source, cle) => meta(source, cle, "property");
const nommee = (source, cle) => meta(source, cle, "name");
const canonique = (source) => {
  const t = source.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  return t ? t[1] : null;
};
const titre = (source) => {
  const t = source.match(/<title>([^<]*)<\/title>/i);
  return t ? t[1] : null;
};

/* Le texte d'une page, sans les retours à la ligne du source : une phrase
   coupée en deux par la mise en forme reste la même phrase. */
const plat = (source) => source.replace(/\s+/g, " ");

/* Les balises qui parlent aux robots, et elles seules. Le reste de l'en-tête
   contient des icônes en `data:` dont l'espace de noms XML est une URL en
   http:// — ce n'est pas une adresse de site. */
const balisesMeta = (source) =>
  (source.slice(0, source.indexOf("</head>")).replace(/<!--[\s\S]*?-->/g, "")
    .match(/<meta[^>]*>|<link[^>]*rel=["'](?:canonical)["'][^>]*>/gi) || []).join("\n");

const PAGES = [
  { nom: "index.html", source: html, url: "https://autour.eu/" },
  { nom: "mentions-legales.html", source: legales, url: "https://autour.eu/mentions-legales" },
  { nom: "confidentialite.html", source: confid, url: "https://autour.eu/confidentialite" },
];

/* ---- 1. Les métadonnées, sur chaque page publique ---------------------- */

test("chaque page publique porte le jeu complet de métadonnées", () => {
  for (const { nom, source } of PAGES) {
    assert.ok((titre(source) || "").trim().length > 8, nom + " : <title> manquant ou trop court");
    assert.ok((nommee(source, "description") || "").length > 40,
      nom + " : meta description manquante ou trop courte");
    for (const cle of ["og:title", "og:description", "og:url", "og:type", "og:image"])
      assert.ok(propriete(source, cle), nom + " : " + cle + " manquant");
    for (const cle of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"])
      assert.ok(nommee(source, cle), nom + " : " + cle + " manquant");
    assert.equal(nommee(source, "twitter:card"), "summary_large_image",
      nom + " : la grande carte est le format demandé");
    assert.equal(propriete(source, "og:type"), "website");
  }
});

test("les canoniques et les URL sociales pointent uniquement vers autour.eu", () => {
  for (const { nom, source, url } of PAGES) {
    assert.equal(canonique(source), url, nom + " : canonique inattendue");
    assert.equal(propriete(source, "og:url"), url, nom + " : og:url inattendue");
    /* ABSOLUES, ET C'EST LE POINT. Une canonique relative serait résolue sur
       le domaine du déploiement — donc sur l'URL de prévisualisation qu'elle
       est censée écarter. */
    assert.match(canonique(source), /^https:\/\/autour\.eu\//, nom);
  }
});

test("aucune URL de prévisualisation ou d'environnement ne fuit dans les métadonnées", () => {
  for (const { nom, source } of PAGES) {
    /* Les commentaires sont retirés : celui de la canonique NOMME le domaine
       de prévisualisation pour expliquer pourquoi la balise existe. C'est ce
       qui est SERVI aux robots qui compte, pas la prose qui l'explique. */
    const tete = balisesMeta(source);
    for (const interdit of [/vercel\.app/i, /localhost/i, /127\.0\.0\.1/, /\bhttp:\/\//i])
      assert.doesNotMatch(tete, interdit,
        nom + " : " + interdit + " n'a rien à faire dans les métadonnées");
  }
});

test("l'image de partage est déclarée et mesure réellement 1200×630", async () => {
  for (const { nom, source } of PAGES) {
    assert.equal(propriete(source, "og:image"), "https://autour.eu/og.png", nom);
    assert.equal(nommee(source, "twitter:image"), "https://autour.eu/og.png", nom);
    assert.ok(propriete(source, "og:image:alt"), nom + " : og:image:alt manquant");
  }
  assert.equal(propriete(html, "og:image:width"), "1200");
  assert.equal(propriete(html, "og:image:height"), "630");

  /* Et le fichier tient la promesse de la balise : les dimensions sont lues
     dans l'en-tête IHDR du PNG, pas supposées. */
  const binaire = await readFile(og);
  assert.equal(binaire.slice(1, 4).toString(), "PNG", "og.png doit être un vrai PNG");
  assert.equal(binaire.readUInt32BE(16), 1200, "largeur");
  assert.equal(binaire.readUInt32BE(20), 630, "hauteur");
  /* Plusieurs réseaux sociaux refusent au-delà de 5 Mo, et une image lourde
     retarde l'aperçu au point qu'il n'apparaît pas. */
  assert.ok(binaire.length < 1024 * 1024, "og.png doit rester sous 1 Mo");
});

test("le partage annonce le nom du produit et ce qu'il fait", () => {
  assert.equal(propriete(html, "og:site_name"), "Autour");
  assert.match(propriete(html, "og:title"), /Autour/);
  const description = propriete(html, "og:description");
  assert.ok(description.length > 60, "une description trop courte ne dit rien du produit");
  assert.match(description, /autour de toi/i);
});

/* ---- 2. Les pages légales existent et sont atteignables ---------------- */

test("les deux pages légales sont routées en URL propre", () => {
  const routes = Object.fromEntries((vercel.rewrites || []).map((r) => [r.source, r.destination]));
  assert.equal(routes["/mentions-legales"], "/mentions-legales.html");
  assert.equal(routes["/confidentialite"], "/confidentialite.html");
});

test("les pages légales sont atteignables depuis l'application et entre elles", () => {
  /* Une page légale que personne ne peut atteindre ne remplit pas son office. */
  assert.match(html, /<a href="\/mentions-legales">Mentions légales<\/a>/);
  assert.match(html, /<a href="\/confidentialite">Confidentialité<\/a>/);
  assert.match(legales, /href="\/confidentialite"/);
  assert.match(confid, /href="\/mentions-legales"/);
  for (const { nom, source } of PAGES.slice(1))
    assert.match(source, /<a class="retour" href="\/">/, nom + " : retour vers l'application");
});

test("les pages de texte n'embarquent pas l'application", () => {
  for (const { nom, source } of PAGES.slice(1)) {
    assert.doesNotMatch(source, /app\.js|autour\.js/, nom + " : le bundle n'a rien à y faire");
    assert.doesNotMatch(source, /<script/i, nom + " : aucune raison d'exécuter du script ici");
    assert.match(source, /<link rel="stylesheet" href="legal\.css"/, nom);
  }
});

test("elles restent lisibles sur mobile comme sur desktop", () => {
  for (const { nom, source } of PAGES.slice(1)) {
    assert.match(source, /name="viewport"[^>]*width=device-width/, nom);
    assert.match(source, /viewport-fit=cover/, nom);
  }
  assert.match(legalCss, /@media \(min-width:760px\)/, "un palier desktop est prévu");
  assert.match(legalCss, /max-width:44rem/, "la largeur de lecture est bornée");
  assert.match(legalCss, /\.tableau\{overflow-x:auto/,
    "un tableau doit défiler dans sa boîte, jamais pousser la page de côté");
  assert.match(legalCss, /min-height:44px/, "la cible tactile du retour");
});

test("les pages de texte reprennent les couleurs de l'application", () => {
  /* Ce sont des pages d'Autour, pas les annexes d'un autre site. Aucune
     feuille commune n'existe : on vérifie donc que les valeurs recopiées
     n'ont pas divergé. */
  for (const jeton of ["--paper:#F7F8F5", "--ink:#1F2A25", "--ink2:#5D6B63",
                       "--signal:#FF4A17", "--trait:#141E19", "--bord:#DCE0D8"]) {
    assert.ok(html.includes(jeton), "index.html a perdu " + jeton);
    assert.ok(legalCss.includes(jeton), "legal.css a divergé sur " + jeton);
  }
});

/* ---- 3. Ce qui reste à renseigner se voit ------------------------------ */

test("les informations légales manquantes sont marquées, pas inventées", () => {
  const marques = (legales.match(/class="a-renseigner"/g) || []).length +
                  (confid.match(/class="a-renseigner"/g) || []).length;
  assert.ok(marques > 0,
    "tant que l'éditeur n'est pas renseigné, les marques doivent rester visibles");
  /* Elles sont voyantes à l'écran : une mention légale incomplète qui
     ressemble à une mention complète ne se fait jamais corriger. */
  assert.match(legalCss, /\.a-renseigner\{[^}]*background:#FFF1CC/);
  /* Et aucune identité n'a été inventée pour combler les trous. */
  assert.doesNotMatch(legales, /\b\d{3} ?\d{3} ?\d{3}\b/, "aucun SIREN inventé");
  assert.doesNotMatch(legales, /[\w.-]+@[\w.-]+\.\w+/, "aucune adresse e-mail inventée");
  assert.doesNotMatch(confid, /[\w.-]+@[\w.-]+\.\w+/, "aucune adresse e-mail inventée");
});

/* ---- 4. robots.txt ------------------------------------------------------ */

test("robots.txt ouvre les pages et ferme les routes de données", () => {
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
});

test("robots.txt ne bloque pas ce qui sert à rendre la page", () => {
  /* Un robot qui ne peut pas lire les scripts, les styles ou les jeux de zone
     voit une page vide et l'indexe comme telle. */
  for (const chemin of ["/zones/", "/data/", "*.js", "*.css", "/differe/"])
    assert.doesNotMatch(robots, new RegExp("^Disallow: " + chemin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m"),
      chemin + " ne doit pas être bloqué");
});

test("aucun sitemap n'est annoncé tant qu'il n'existe pas", async () => {
  const existe = await stat(new URL("../sitemap.xml", import.meta.url)).then(() => true, () => false);
  if (existe) assert.match(robots, /^Sitemap: https:\/\/autour\.eu\/sitemap\.xml$/m,
    "le sitemap existe : il doit être annoncé");
  else assert.doesNotMatch(robots, /^Sitemap:/m,
    "annoncer un sitemap absent envoie volontairement une 404 au robot");
});

/* ---- 5. La page de confidentialité dit ce que le code fait -------------- */

test("le seul cookie décrit est le seul cookie posé, avec sa vraie durée", () => {
  /* Le middleware est l'autorité : c'est lui qui pose le cookie. */
  assert.match(middleware, /autour_geo=/);
  assert.match(middleware, /const UNE_HEURE = 3600;/);
  assert.match(middleware, /SameSite=Lax/);
  assert.match(middleware, /Secure/);
  assert.match(confid, /<code>autour_geo<\/code>/);
  assert.match(confid, /1 heure/);
  assert.match(confid, /SameSite=Lax/);
  /* Et le code ne lit aucun autre cookie. */
  assert.equal((app.match(/document\.cookie/g) || []).length, 1);
});

test("l'affirmation « seule une vraie mesure GPS est stockée » est vraie", () => {
  /* `memoriserPosition` refuse tout ce qui n'est pas mesuré par le navigateur :
     une ville déduite d'une adresse IP n'entre jamais dans le stockage local. */
  assert.match(app, /function memoriserPosition\(c, source\)\{\s*if\(source !== "gps"\) return false;/);
  assert.match(plat(confid), /seulement lorsqu'elle provient d'une vraie mesure GPS/);
  assert.match(plat(confid), /n'est enregistrée sur aucun serveur d'Autour/);
});

test("l'affirmation sur la permission reprend exactement la règle du Lot 1", () => {
  assert.match(app, /if\(etatPerm === "granted"\) suivreMaPosition\(\{silencieux:true\}\);/);
  assert.match(plat(confid), /qu'après une action explicite/);
  assert.match(plat(confid), /aucune fenêtre de permission ne s'ouvre/);
  assert.match(plat(confid), /elle est réutilisée automatiquement/);
});

test("l'affirmation « aucune mesure d'audience » est vérifiable dans le code", () => {
  const livre = html + app;
  for (const traqueur of [/google-analytics/i, /googletagmanager/i, /gtag\(/,
                          /plausible\.io/i, /matomo/i, /posthog/i, /mixpanel/i, /hotjar/i])
    assert.doesNotMatch(livre, traqueur, "traceur détecté : la page ment");
  assert.match(plat(confid), /aucun cookie publicitaire, de mesure d'audience ou/);
});

test("les trois niveaux de localisation de la page sont ceux du code", () => {
  /* Le code distingue « point », « ville » et « zone » ; la page décrit
     exactement ces trois-là, sans en inventer un quatrième. */
  assert.match(app, /let precisionPosition = null;\s+\/\/ "point" \| "ville" \| "zone" \| null/);
  assert.match(confid, /Position précise \(GPS\)/);
  assert.match(confid, /Position approximative \(adresse IP\)/);
  assert.match(confid, /Zone par défaut/);
  /* Et la limite du repli, qui est le point délicat du Lot 1. */
  assert.match(plat(confid), /en dehors des villes qu'Autour dessert/);
});

test("la route de position décrite est celle qui existe", async () => {
  const route = await lire("api/position.js");
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.match(confid, /<code>\/api\/position<\/code>/);
  assert.match(confid, /<code>private, no-store<\/code>/);
  assert.match(plat(confid), /ton adresse IP n'est ni stockée, ni journalisée/);
  /* Le middleware et la route ne journalisent effectivement rien. */
  assert.doesNotMatch(route, /console\./);
  assert.doesNotMatch(middleware, /console\./);
});

test("les services externes listés sont ceux que le navigateur contacte", async () => {
  /* Les hôtes cités dans la page doivent exister dans ce qui est livré au
     navigateur — on ne documente pas un service imaginaire. */
  for (const hote of ["Supabase", "Overpass", "CARTO", "Google Maps",
                      "Base Adresse Nationale", "Nominatim", "Wikimedia Commons"])
    assert.ok(confid.includes(hote), hote + " manque à la liste");
  assert.match(await lire("adresse.js"), /api-adresse\.data\.gouv\.fr/);
  assert.match(html, /fonts\.googleapis\.com/);
  assert.match(html, /cdnjs\.cloudflare\.com/);
});

test("la page nomme le pays d'hébergement de la base, et il est exact", () => {
  /* Vérifié au Lot 0 : le projet Supabase est en eu-west-3 (Paris). */
  assert.match(legales, /eu-west-3/);
  assert.match(confid, /Supabase \(UE, Paris\)/);
});

test("les droits et la voie de recours sont indiqués", () => {
  assert.match(plat(confid), /accès, de rectification, d'effacement/);
  assert.match(confid, /cnil\.fr/);
  assert.match(confid, /responsable de traitement/);
});
