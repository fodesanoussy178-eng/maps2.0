/*
 * Banc d'acceptation navigateur de la passe « France + mobile ».
 *
 * Le serveur est volontairement minuscule et les réponses sont produites à
 * partir des coordonnées demandées. Le banc ne crée donc pas cinq catalogues :
 * il vérifie que le même trajet client (zone -> événements -> lieux) reste
 * cohérent quand le centre change. Les réponses Supabase, DATAtourisme et OSM
 * restent des sources séparées pour pouvoir tester une panne ou une réponse
 * vide sans transformer les autres en erreur.
 *
 *   npm run banc:appareils
 *   AUTOUR_CHROME=/chemin/vers/chrome npm run banc:appareils
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, resolve } from "node:path";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const TYPES = Object.freeze({
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
});
const IMAGE_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64",
);

const VILLES = Object.freeze({
  tourcoing: { nom: "Tourcoing", centre: [50.7236, 3.1610], slug: "tourcoing" },
  paris: { nom: "Paris", centre: [48.8566, 2.3522], slug: "paris" },
  marseille: { nom: "Marseille", centre: [43.2965, 5.3698], slug: "marseille" },
  rennes: { nom: "Rennes", centre: [48.1173, -1.6778], slug: "rennes" },
  angers: { nom: "Angers", centre: [47.4784, -0.5632], slug: "angers" },
});

const EVENTS_BY_CITY = Object.freeze({
  tourcoing: { artist: "Ninho", genre: ["rap"], kind: "concert" },
  paris: { artist: "Aya Nakamura", genre: ["rnb", "pop", "afro"], kind: "showcase" },
  marseille: { artist: "Gazo", genre: ["rap", "drill"], kind: "festival" },
  rennes: { artist: "Angèle", genre: ["pop"], kind: "open_air" },
  angers: { artist: "Kendrick Lamar", genre: ["rap"], kind: "concert" },
});

function villePour(lat, lng) {
  return Object.entries(VILLES).reduce((meilleure, [slug, ville]) => {
    const distance = (ville.centre[0] - lat) ** 2 + (ville.centre[1] - lng) ** 2;
    return !meilleure || distance < meilleure.distance ? { slug, distance } : meilleure;
  }, null).slug;
}

function poisPour(slug, nombre = 8) {
  const ville = VILLES[slug];
  return Array.from({ length: nombre }, (_, index) => ({
    type: "node", id: (Object.keys(VILLES).indexOf(slug) + 1) * 10000 + index,
    lat: ville.centre[0] + ((index % 4) - 1.5) * 0.0012,
    lon: ville.centre[1] + (Math.floor(index / 4) - 0.5) * 0.0015,
    tags: {
      name: `${ville.nom} lieu permanent ${index + 1}`,
      amenity: ["cafe", "restaurant", "cinema", "library"][index % 4],
      opening_hours: "Mo-Su 00:00-24:00",
    },
  }));
}

function evenementsPour(slug, nombre = 2) {
  const ville = VILLES[slug];
  const fiche = EVENTS_BY_CITY[slug];
  const maintenant = Date.now();
  return Array.from({ length: nombre }, (_, index) => ({
    id: `${slug}-event-${index + 1}`,
    title: `${fiche.artist} ${fiche.kind.replaceAll("_", " ")} · ${ville.nom}`,
    description: "Banc national Autour",
    category: "concert",
    event_kind: fiche.kind,
    artist_names: [fiche.artist],
    music_genres: fiche.genre,
    announcement_tags: [fiche.kind, ...fiche.genre, `artist_${fiche.artist.toLowerCase().replaceAll(" ", "_")}`],
    performers: [fiche.artist],
    timezone: "Europe/Paris",
    date_confidence: "exact",
    temporal_status: "happening_now",
    start_at: new Date(maintenant - 30 * 60 * 1000).toISOString(),
    end_at: new Date(maintenant + 90 * 60 * 1000).toISOString(),
    place_name: `${ville.nom} scène ${index + 1}`,
    address: "1 place publique",
    city: ville.nom,
    lat: ville.centre[0] + index * 0.001,
    lng: ville.centre[1] + index * 0.001,
    primary_source: "datatourisme",
    source_url: null,
    image_url: null,
    cancelled: false,
    last_synced_at: new Date().toISOString(),
  }));
}

const DONNEES = Object.fromEntries(Object.keys(VILLES).map((slug) => [slug, {
  pois: poisPour(slug),
  events: evenementsPour(slug),
}]));

function chiffres(url, noms) {
  const parsed = new URL(url);
  return noms.map((nom) => Number(parsed.searchParams.get(nom))).map((nombre) =>
    Number.isFinite(nombre) ? nombre : null);
}

function texteRequete(request) {
  return decodeURIComponent(request.postData() || request.url());
}

async function ouvrirNavigateur() {
  const candidats = [
    process.env.AUTOUR_CHROME,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ].filter(Boolean);
  for (const candidat of candidats) {
    try { await access(candidat); return chromium.launch({ executablePath: candidat }); } catch {}
  }
  return chromium.launch();
}

const serveur = createServer(async (request, response) => {
  const chemin = decodeURIComponent(new URL(request.url, "http://local").pathname);
  const relatif = chemin === "/" ? "index.html" : chemin.replace(/^\/+/, "");
  const fichier = resolve(RACINE, relatif);
  if (!fichier.startsWith(resolve(RACINE))) {
    response.writeHead(403); response.end(); return;
  }
  try {
    const info = await stat(fichier);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": TYPES[extname(fichier)] || "application/octet-stream" });
    response.end(await readFile(fichier));
  } catch {
    response.writeHead(404); response.end("not found");
  }
});
await new Promise((resolveServeur) => serveur.listen(0, "127.0.0.1", resolveServeur));
const BASE = `http://127.0.0.1:${serveur.address().port}`;

const resultats = [];
function verifier(nom, ok, detail = "") {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? "  ok   " : "  ÉCHEC"} ${nom}${detail ? ` — ${detail}` : ""}`);
}

async function lancerScenario({
  nom, slug = "tourcoing", largeur = 390, hauteur = 844, reseau = "rapide",
  geolocalisation = "test", interactions = false, sourceDefaillante = null, sourceVide = null,
}) {
  const ville = VILLES[slug];
  const erreurs = [];
  const requetes = { events: 0, places: 0, permanent: 0, permanentItems: 0 };
  const browser = await ouvrirNavigateur();
  const context = await browser.newContext({
    viewport: { width: largeur, height: hauteur },
    isMobile: largeur <= 430,
    hasTouch: largeur <= 430,
    locale: "fr-FR",
    permissions: geolocalisation === "refusee" ? [] : ["geolocation"],
    geolocation: { latitude: ville.centre[0], longitude: ville.centre[1] },
  });
  await context.addInitScript(({ base, etatGeo }) => {
    const resultat = (data = []) => Promise.resolve({ data, error: null });
    const chaine = () => {
      const valeur = {
        select() { return valeur; }, eq() { return valeur; }, neq() { return valeur; },
        in() { return valeur; }, order() { return valeur; }, limit() { return valeur; },
        maybeSingle() { return resultat(null); }, single() { return resultat(null); },
        then(resolve, reject) { return resultat([]).then(resolve, reject); },
      };
      return valeur;
    };
    window.supabase = {
      createClient: () => ({
        from: chaine,
        rpc: (nom, parametres = {}) => fetch(`${base}/rpc/${nom}?${Object.entries(parametres)
          .map(([cle, valeur]) => `${cle.replace(/^p_/, "")}=${encodeURIComponent(valeur)}`).join("&")}`)
          .then((reponse) => reponse.json()).then((data) => ({ data, error: null }))
          .catch(() => ({ data: [], error: null })),
        auth: {
          getSession: () => resultat({ session: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        storage: { from: () => ({}) },
      }),
    };
    localStorage.setItem("autour:onboarding-localisation", "termine");
    localStorage.removeItem("autour:position");
    if (etatGeo === "lente") {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (success, error, options) =>
        setTimeout(() => original(success, error, options), 1100);
    }
  }, { base: BASE, etatGeo: geolocalisation });
  const page = await context.newPage();
  page.on("pageerror", (error) => erreurs.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|manifest|net::|Failed to load resource/i.test(message.text()))
      erreurs.push(`console: ${message.text()}`);
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const parsed = new URL(url);
    const json = (data, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(data),
    });
    const delai = reseau === "lent" && (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/rpc/"))
      ? 650 : 0;
    if (delai) await new Promise((resolveDelay) => setTimeout(resolveDelay, delai));

    if (url.startsWith(BASE)) {
      if (parsed.pathname.startsWith("/rpc/")) {
        const villeDuPoint = (() => {
          const [sud, ouest, nord, est] = chiffres(url, ["sud", "ouest", "nord", "est"]);
          if ([sud, ouest, nord, est].every(Number.isFinite)) return villePour((sud + nord) / 2, (ouest + est) / 2);
          const lat = Number(parsed.searchParams.get("lat"));
          const lng = Number(parsed.searchParams.get("lng"));
          return Number.isFinite(lat) && Number.isFinite(lng) ? villePour(lat, lng) : slug;
        })();
        if (parsed.pathname.endsWith("/evenements_proches") || parsed.pathname.endsWith("/evenements_bassin")) {
          requetes.events += 1;
          if (sourceDefaillante === "events") return json({ error: "events_down" }, 503);
          if (sourceVide === "events") return json([]);
          return json(DONNEES[villeDuPoint].events);
        }
        if (parsed.pathname.endsWith("/publications_proches")) return json([]);
        if (parsed.pathname.endsWith("/resoudre_territoire")) {
          return json([{ slug: villeDuPoint, group_slug: villeDuPoint, name: VILLES[villeDuPoint].nom }]);
        }
        return json([]);
      }
      if (parsed.pathname === "/api/lieux") {
        requetes.places += 1;
        if (sourceDefaillante === "osm") return json({ error: "osm_down" }, 503);
        const contenu = texteRequete(route.request());
        const autour = contenu.match(/around:\d+,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
        const villeDuPoint = autour ? villePour(Number(autour[1]), Number(autour[2])) : slug;
        return json({ elements: DONNEES[villeDuPoint].pois });
      }
      if (parsed.pathname === "/api/datatourisme") {
        requetes.permanent += 1;
        if (sourceDefaillante === "datatourisme") return json({ error: "datatourisme_down" }, 503);
        if (sourceVide === "datatourisme") return json([]);
        const lat = Number(parsed.searchParams.get("lat"));
        const lng = Number(parsed.searchParams.get("lng"));
        const villeDuPoint = Number.isFinite(lat) && Number.isFinite(lng) ? villePour(lat, lng) : slug;
        const items = DONNEES[villeDuPoint].pois.map((lieu) => ({
          id: `dt-${lieu.id}`, name: lieu.tags.name, lat: lieu.lat, lon: lieu.lon,
          category: "tourism", openingHours: "Mo-Su 00:00-24:00",
        }));
        requetes.permanentItems += items.length;
        return json(items);
      }
      if (parsed.pathname === "/api/commune") {
        const villeDuPoint = villePour(Number(parsed.searchParams.get("lat")), Number(parsed.searchParams.get("lng")));
        return json({ commune: VILLES[villeDuPoint].nom });
      }
      return route.continue();
    }

    if (/cdnjs.cloudflare.com\/ajax\/libs\/leaflet\/.*leaflet\.js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(join(process.cwd(), "node_modules/leaflet/dist/leaflet.js"), "utf8") });
    if (/cdnjs.cloudflare.com\/ajax\/libs\/leaflet\/.*leaflet\.css/.test(url))
      return route.fulfill({ status: 200, contentType: "text/css", body: await readFile(join(process.cwd(), "node_modules/leaflet/dist/leaflet.css"), "utf8") });
    if (/googleapis\.com\/maps\/api\/js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: "window.__autourGoogleMapsReady && window.__autourGoogleMapsReady();" });
    if (/\.png(?:\?|$)|tile|basemaps|googleapis\.com\/maps/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png", body: IMAGE_1PX });
    if (/nominatim\.openstreetmap\.org/.test(url)) return json([]);
    return route.fulfill({ status: 204, body: "" });
  });

  const query = geolocalisation === "test" ? `?testPosition=${ville.centre.join(",")}` : "";
  await page.goto(`${BASE}/index.html${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(reseau === "lent" || geolocalisation === "lente" ? 6500 : 3500);

  const etat = await page.evaluate(() => ({
    largeurDocument: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    largeurFenetre: window.innerWidth,
    texte: document.body.innerText,
    cartes: document.querySelectorAll("[data-ac]").length,
    evenements: [...document.querySelectorAll("[data-ac]")].filter((element) => /concert|showcase|festival|open air/i.test(element.textContent || "")).length,
  }));
  verifier(`${nom} · zéro débordement horizontal`, etat.largeurDocument <= etat.largeurFenetre + 1,
    `${etat.largeurDocument}/${etat.largeurFenetre}`);
  verifier(`${nom} · contenu ou repli explicite`, etat.cartes > 0 || /position|choisis|quartier|autour/i.test(etat.texte),
    `${etat.cartes} carte(s)`);
  if (geolocalisation !== "refusee" && !sourceDefaillante && !sourceVide) {
    verifier(`${nom} · événements disponibles avant les lieux permanents`, requetes.events > 0 && requetes.permanentItems > 0,
      `events=${requetes.events}, permanents=${requetes.permanentItems}`);
  } else if (sourceDefaillante === "events" || sourceVide === "events") {
    verifier(`${nom} · événements indisponibles sans écran mort`, requetes.places > 0 && etat.cartes > 0,
      `places=${requetes.places}, cartes=${etat.cartes}`);
  } else if (sourceDefaillante === "osm" || sourceDefaillante === "datatourisme" || sourceVide === "datatourisme") {
    verifier(`${nom} · une source indisponible laisse les autres répondre`, requetes.events > 0 && etat.cartes > 0,
      `events=${requetes.events}, cartes=${etat.cartes}, permanents=${requetes.permanentItems}`);
  } else {
    verifier(`${nom} · refus géolocalisation sans erreur applicative`, /position|choisis|quartier|autour/i.test(etat.texte), etat.texte.slice(0, 100));
  }
  if (interactions) {
    const boutonsCreneau = page.locator("[data-creneau]");
    for (let i = 0; i < await boutonsCreneau.count(); i++) await boutonsCreneau.nth(i).tap().catch(() => {});
    await page.locator("#btnLoupe").click().catch(() => {});
    await page.locator("#rech").fill("Paris").catch(() => {});
    await page.locator("#rech").press("Enter").catch(() => {});
    await page.waitForTimeout(500);
    await page.locator("[data-ac]").first().tap().catch(() => {});
    await page.locator("#fbFermer").click().catch(() => {});
    await page.locator("#btnNotifs").tap().catch(() => {});
    await page.locator("#ptFermer").tap().catch(() => {});
    await page.locator("[data-nb='aide']").tap().catch(() => {});
    await page.locator("[data-nb='explorer']").tap().catch(() => {});
    verifier(`${nom} · navigation/recherche/fiches tactiles`, erreurs.length === 0, erreurs.slice(0, 2).join(" | "));
  }
  verifier(`${nom} · zéro erreur JS applicative`, erreurs.length === 0, erreurs.slice(0, 2).join(" | "));
  await browser.close();
  return { erreurs, requetes, etat };
}

try {
  console.log("\n=== Largeurs mobile, tablette et desktop ===");
  for (const largeur of [320, 375, 390, 430, 768, 1280])
    await lancerScenario({ nom: `Tourcoing ${largeur}px`, largeur, geolocalisation: "test", interactions: largeur === 390 });

  console.log("\n=== Géolocalisation immédiate, lente et refusée ===");
  await lancerScenario({ nom: "Paris · GPS immédiat", slug: "paris", geolocalisation: "immediate" });
  await lancerScenario({ nom: "Marseille · GPS lent", slug: "marseille", geolocalisation: "lente", reseau: "lent" });
  await lancerScenario({ nom: "Rennes · GPS refusé", slug: "rennes", geolocalisation: "refusee" });

  console.log("\n=== Résilience des sources ===");
  await lancerScenario({ nom: "Paris · source événements en panne", slug: "paris", sourceDefaillante: "events" });
  await lancerScenario({ nom: "Marseille · source OSM en panne", slug: "marseille", sourceDefaillante: "osm" });
  await lancerScenario({ nom: "Rennes · DATAtourisme vide", slug: "rennes", sourceVide: "datatourisme" });
  await lancerScenario({ nom: "Angers · événements vides, lieux de repli", slug: "angers", sourceVide: "events" });

  console.log("\n=== Démarrage national : cinq villes, même moteur ===");
  for (const slug of Object.keys(VILLES))
    await lancerScenario({ nom: `${VILLES[slug].nom} · cold start`, slug, geolocalisation: "test" });
} finally {
  serveur.close();
}

const echecs = resultats.filter((resultat) => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
if (echecs.length) process.exitCode = 1;
