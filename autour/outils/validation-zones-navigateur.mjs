/* Validation navigateur réelle des zones autonomes.

   Ce banc n'utilise pas les fonctions internes pour changer de ville : il
   ouvre la vraie page, donne une position au navigateur, clique la loupe et
   soumet les recherches. Les réponses réseau sont des fixtures géographiques
   déterministes afin de vérifier le branchement de l'application, sans
   dépendre d'un fournisseur externe pendant le test.

   Usage :
     node outils/validation-zones-navigateur.mjs
     AUTOUR_TRACE=1 node outils/validation-zones-navigateur.mjs
*/

import {chromium, webkit} from "playwright";
import {createServer} from "node:http";
import {readFile, stat} from "node:fs/promises";
import {join, extname} from "node:path";

const RACINE = new URL("..", import.meta.url).pathname;
const LEAFLET = join(new URL("../..", import.meta.url).pathname, "node_modules/leaflet/dist");
const ZONES = Object.freeze({
  /* Nominatim renvoie [sud, nord, ouest, est]. */
  mel:    {label:"MEL", ville:"Lille", centre:[50.6292,3.0573], bb:["50.50","50.82","2.80","3.35"]},
  paris:  {label:"Paris", ville:"Paris", centre:[48.8566,2.3522], bb:["48.70","49.05","2.10","2.65"]},
  angers: {label:"Angers", ville:"Angers", centre:[47.4784,-0.5632], bb:["47.36","47.60","-0.78","-0.34"]},
  rennes: {label:"Rennes", ville:"Rennes", centre:[48.1173,-1.6778], bb:["47.99","48.25","-1.88","-1.46"]},
  rouen:  {label:"Rouen", ville:"Rouen", centre:[49.4432,1.0993], bb:["49.32","49.58","0.88","1.32"]},
});
const ORDRE_ZONES = ["mel","paris","angers","rennes","rouen"];
const VUES = [
  {nom:"desktop-1440", width:1440, height:900, isMobile:false, hasTouch:false},
  {nom:"mobile-390", width:390, height:844, isMobile:true, hasTouch:true},
  {nom:"mobile-320", width:320, height:700, isMobile:true, hasTouch:true},
];
const TYPES = {".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml"};
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64");
const maintenant = Date.now();
const resultats = [];
const trace = (...args) => { if (process.env.AUTOUR_TRACE) console.log("  [trace]", ...args); };

function verifier(nom, ok, detail = "") {
  resultats.push({nom, ok, detail});
  console.log(`${ok ? "  ok   " : "  ÉCHEC"} ${nom}${detail ? " — " + detail : ""}`);
}

function distanceCarree(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function zonePourPoint(lat, lng) {
  let choix = null, meilleur = Infinity;
  for (const [id, zone] of Object.entries(ZONES)) {
    const d = distanceCarree([Number(lat), Number(lng)], zone.centre);
    if (d < meilleur) { meilleur = d; choix = id; }
  }
  return choix;
}

function zonePourRequete(url, corps = "") {
  const texte = decodeURIComponent(`${url} ${corps}`);
  const autour = texte.match(/around:\d+,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (autour) return zonePourPoint(Number(autour[1]), Number(autour[2]));
  const boite = texte.match(/\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/);
  if (boite) return zonePourPoint((Number(boite[1]) + Number(boite[3])) / 2,
    (Number(boite[2]) + Number(boite[4])) / 2);
  const explicite = new URL(url).searchParams.get("zone_id");
  return explicite && ZONES[explicite] ? explicite : "mel";
}

function pois(zoneId) {
  const zone = ZONES[zoneId];
  return Array.from({length:8}, (_, i) => ({
    type:"node", id:`${zoneId}-poi-${i}`,
    lat:zone.centre[0] + ((i % 4) - 1.5) * 0.0012,
    lon:zone.centre[1] + (Math.floor(i / 4) - 0.5) * 0.0015,
    tags:{name:`${zone.label} lieu ${i + 1}`,
      amenity:i === 5 ? "social_facility" : ["restaurant","cafe","cinema","bar"][i % 4],
      social_facility:i === 5 ? "food_bank" : undefined,
      opening_hours:"Mo-Su 00:00-24:00"},
  }));
}

function evenement(zoneId, options = {}) {
  const zone = ZONES[zoneId];
  const majeur = options.majeur === true;
  return {
    id:majeur ? "paris-majeur-001" : `${zoneId}-normal-001`,
    publication_id:null,
    title:majeur ? "Paris concert majeur" : `${zone.label} événement normal`,
    description:majeur ? "Concert majeur à Paris" : `Événement local de la zone ${zone.label}`,
    category:"concert", timezone:"Europe/Paris", date_confidence:"exact",
    temporal_status:majeur ? "upcoming" : "now",
    start_at:new Date(maintenant + (majeur ? 3 * 3600e3 : -30 * 60e3)).toISOString(),
    end_at:new Date(maintenant + (majeur ? 5 * 3600e3 : 30 * 60e3)).toISOString(),
    announced_at:new Date(maintenant - 2 * 3600e3).toISOString(),
    place_name:`${zone.label} salle`, address:"1 rue Autour", city:zone.ville,
    insee_code:null, lat:zone.centre[0] + 0.001, lng:zone.centre[1] + 0.001,
    zone_id:zoneId, primary_source:"datatourisme", source_url:null,
    announcement_tags:["concert"], importance_level:majeur ? "major" : "local",
    importance_score:majeur ? 92 : 20, image_url:null, cancelled:false,
    last_source_update:null, last_synced_at:new Date().toISOString(), duplicate_of:null,
  };
}

function json(res, value, status = 200) {
  res.fulfill({status, contentType:"application/json", body:JSON.stringify(value)});
}

async function creerServeur() {
  const serveur = createServer(async (req, res) => {
    let chemin = decodeURIComponent((req.url || "/").split("?")[0]);
    if (chemin === "/") chemin = "/index.html";
    try {
      const fichier = join(RACINE, chemin);
      const racineAvecBarre = RACINE.endsWith("/") ? RACINE : RACINE + "/";
      if (!fichier.startsWith(racineAvecBarre)) throw new Error("chemin");
      const s = await stat(fichier);
      if (!s.isFile()) throw new Error("dir");
      res.writeHead(200, {"content-type":TYPES[extname(fichier)] || "application/octet-stream"});
      res.end(await readFile(fichier));
    } catch {
      res.writeHead(404); res.end("non");
    }
  });
  await new Promise((resolve) => serveur.listen(0, "127.0.0.1", resolve));
  return {serveur, base:`http://127.0.0.1:${serveur.address().port}`};
}

function donneesRpc(nom, params) {
  if (nom === "resoudre_territoire") {
    const id = zonePourPoint(Number(params.lat), Number(params.lng));
    return [{group_slug:id, slug:id, label:ZONES[id].label}];
  }
  if (nom === "evenements_locaux") {
    const id = params.zone_id;
    return ZONES[id] ? [evenement(id)] : [];
  }
  if (nom === "evenements_bassin") {
    const id = params.group_slug;
    return ZONES[id] ? [evenement(id)] : [];
  }
  if (nom === "evenements_majeurs_hors_zone") {
    const id = params.active_zone_id;
    return id === "paris" ? [evenement("mel", {majeur:true})] : [evenement("paris", {majeur:true})];
  }
  if (nom === "publications_locales" || nom === "contextes_territoriaux" ||
      nom === "evenements_contexte" || nom === "compter_metrique_territoriale") return [];
  return [];
}

async function configurerPage(page, base, zoneId, options = {}) {
  const position = ZONES[zoneId].centre;
  const erreurs = [];
  page.on("pageerror", (error) => erreurs.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") erreurs.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      erreurs.push(`http ${response.status()}: ${response.url()}`);
  });
  await page.addInitScript(({position, options}) => {
    const etat = {
      location_visit_count: options.visits ?? 3,
      location_permission_state: options.permission ?? "granted",
      onboarding_completed: options.onboardingCompleted ?? true,
      last_known_zone: options.zoneId,
      last_known_position: position,
      active_zone_id: options.zoneId,
    };
    localStorage.setItem("autour:localisation:v2", JSON.stringify(etat));
    localStorage.setItem("autour:active_zone_id", options.zoneId);
    localStorage.setItem("autour:geo-autorisee", options.permission === "granted" ? "1" : "");
    localStorage.setItem("autour:envies:v1", JSON.stringify(["concerts"]));
    if (options.onboardingStep) localStorage.setItem("autour:onboarding-localisation", options.onboardingStep);
    else localStorage.removeItem("autour:onboarding-localisation");
    const reponse = (data) => Promise.resolve({data, error:null});
    const requete = (nom, params) => {
      const query = params ? "?" + Object.entries(params).map(([key, value]) =>
        key.replace(/^p_/, "") + "=" + encodeURIComponent(value)).join("&") : "";
      return fetch("/rpc/" + nom + query).then((response) => response.json())
        .then((data) => ({data, error:null})).catch(() => ({data:[], error:null}));
    };
    window.supabase = {createClient:() => ({
      from:() => ({
        select:() => ({eq() { return this; }, order() { return this; },
          limit() { return this; }, maybeSingle:() => reponse(null),
          then:(resolve) => reponse([]).then(resolve)}),
      }),
      rpc:requete,
      auth:{getSession:() => reponse({session:null}),
        onAuthStateChange:() => ({data:{subscription:{unsubscribe(){}}}})},
      storage:{from:() => ({})},
    })};
  }, {position, options:Object.assign({zoneId}, options)});
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const corps = request.postData() || "";
    const local = url.startsWith(base);
    try {
      if (local && /\/rpc\//.test(url)) {
        const u = new URL(url);
        const nom = u.pathname.split("/").pop();
        const params = Object.fromEntries(u.searchParams.entries());
        return json(route, donneesRpc(nom, params));
      }
      if (local && /\/api\/lieux/.test(url)) {
        return json(route, {elements:pois(zonePourRequete(url, corps))});
      }
      if (local && /\/api\/(datatourisme|decouvertes|aide-institutionnelle|aide-structures)/.test(url)) {
        return json(route, {items:[]});
      }
      if (local && /\/api\/commune/.test(url)) {
        const u = new URL(url);
        const id = zonePourPoint(Number(u.searchParams.get("lat")), Number(u.searchParams.get("lng")));
        return json(route, {commune:ZONES[id].ville});
      }
      if (local && /\/zones\/.*\.json/.test(url)) return json(route, []);
      if (local && /\/vendeur\/supabase-.*\.js/.test(url))
        return route.fulfill({status:200, contentType:"text/javascript", body:""});
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/.*\.js/.test(url))
        return route.fulfill({status:200, contentType:"text/javascript", body:await readFile(join(LEAFLET, "leaflet.js"), "utf8")});
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/.*\.css/.test(url))
        return route.fulfill({status:200, contentType:"text/css", body:await readFile(join(LEAFLET, "leaflet.css"), "utf8")});
      if (/nominatim\.openstreetmap\.org\/search/.test(url)) {
        const q = (new URL(url).searchParams.get("q") || "").toLowerCase();
        const id = ORDRE_ZONES.find((candidate) => q.includes(candidate)) ||
          (q.includes("lille") ? "mel" : null);
        if (!id) return json(route, []);
        const zone = ZONES[id];
        return json(route, [{lat:String(zone.centre[0]), lon:String(zone.centre[1]),
          display_name:zone.ville, importance:0.8, boundingbox:zone.bb}]);
      }
      if (/nominatim\.openstreetmap\.org\/reverse/.test(url)) {
        const u = new URL(url);
        const id = zonePourPoint(Number(u.searchParams.get("lat")), Number(u.searchParams.get("lon")));
        return json(route, {address:{city:ZONES[id].ville}});
      }
      if (/fonts\.googleapis|fonts\.gstatic/.test(url))
        return route.fulfill({status:200, contentType:"text/css", body:""});
      if (/basemaps|tile|maps\.googleapis/.test(url)) {
        if (/\.png|tile|basemap/.test(url)) return route.fulfill({status:200, contentType:"image/png", body:PIXEL});
        return route.fulfill({status:200, contentType:"text/javascript", body:""});
      }
      if (/functions\/v1\/enrichir-lieu|functions\/v1\/enrichir/.test(url)) return json(route, {});
      if (/^https?:\/\//.test(url) && !local) return route.fulfill({status:204, body:""});
      return route.continue();
    } catch (error) {
      erreurs.push(`route: ${error.message}`);
      return route.abort();
    }
  });
  await page.goto(`${base}/index.html${options.testPosition === false ? "" : `?testPosition=${position[0]},${position[1]}`}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction((id) => typeof idZoneActive === "function" && idZoneActive() === id,
    zoneId, {timeout:10000});
  await page.waitForFunction((id) => typeof lieux !== "undefined" &&
    lieux.some((item) => item && (item.zone_id || item.zoneId) === id), zoneId, {timeout:10000});
  await page.waitForTimeout(350);
  return {erreurs};
}

async function etatPage(page) {
  return page.evaluate(() => {
    const local = typeof dansZoneActive === "function" ? (lieux || []).filter(dansZoneActive) : [];
    const noms = (liste) => liste.map((item) => String(item?.titre || item?.title || item?.nom || ""));
    return {
      active:typeof idZoneActive === "function" ? idZoneActive() : null,
      tous:noms(lieux || []), local:noms(local),
      zones:[...new Set(local.map((item) => item.zone_id || item.zoneId).filter(Boolean))],
      cross:(typeof evenementsMajeursHorsZone !== "undefined" ? evenementsMajeursHorsZone : []).map((item) => ({
        id:item.id, zone_id:item.zone_id, importance_level:item.importance_level,
      })),
      envies:typeof synchroniserEnvies === "function" && synchroniserEnvies()
        ? synchroniserEnvies().choisies() : [],
      propositions:typeof propositionsPourToi === "function"
        ? propositionsPourToi(12).map((item) => ({pool:item.pool, title:item.l?.titre, zone:item.zoneLabel})) : [],
      directClassement:typeof ANNONCES !== "undefined" && typeof ANNONCES.classer === "function" &&
        typeof evenementsMajeursHorsZone !== "undefined" && evenementsMajeursHorsZone[0]
        ? (() => { try { const event = evenementsMajeursHorsZone[0];
          const classe = ANNONCES.classer(event, {now:Date.now(), interests:["concerts"],
            distanceMeters:220000, pool:"major_cross_zone", activeZoneId:"mel",
            crossZoneMaxDistance:350000});
          const temporal = typeof AutourTemps !== "undefined" && AutourTemps.etatTemporalEvenement
            ? AutourTemps.etatTemporalEvenement(event, Date.now()) : null;
          return classe ? {score:classe.score, pool:classe.pool, matches:classe.matched_interests}
            : {rejected:true, raw:{id:event.id, zone:event.zone_id, level:event.importance_level,
              score:event.importance_score, start:event.start_at, end:event.end_at,
              temporal:event.temporal_status, confidence:event.date_confidence,
              tags:event.announcement_tags}, normalized:{entity:event.entity_type,
              temporary:event.isTemporary, start:event.debutLe, end:event.finLe,
              temporal:event.temporal_status, confidence:event.dateConfidence,
              tags:event.announcement_tags}, temporal:temporal && {status:temporal.status,
              statut:temporal.statut, debut:temporal.debut, fin:temporal.finReelle,
              known:temporal.hasKnownDate}};
        } catch (error) { return {error:error.message}; } })() : null,
      explorer:noms(typeof selectionner === "function" ? selectionner() : []),
      aide:noms(typeof candidatsAideZone === "function" ? candidatsAideZone() : []),
      pourtoi:[...document.querySelectorAll("[data-pt]")].map((item) => ({
        pool:item.getAttribute("data-pool"), text:item.textContent || "",
      })),
      bodyText:(document.body.innerText || "").slice(0, 20000),
      width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
      onboarding:!document.querySelector("#onboardingLocalisation")?.hidden,
      loading:!document.querySelector("#charge")?.hidden,
    };
  });
}

async function rechercher(page, id) {
  if (await page.evaluate(() => typeof modeAide !== "undefined" && modeAide)) {
    await page.locator('[data-nb="explorer"]').click();
    await page.waitForTimeout(100);
  }
  await page.locator("#btnLoupe").click();
  await page.locator("#rech").fill(ZONES[id].ville);
  await page.locator("#formRech").evaluate((form) => form.requestSubmit());
  try {
    await page.waitForFunction((zone) => typeof idZoneActive === "function" && idZoneActive() === zone,
      id, {timeout:10000});
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({active:typeof idZoneActive === "function" ? idZoneActive() : null,
      mode:typeof modeAide !== "undefined" ? modeAide : null,
      recherche:typeof recherche !== "undefined" ? recherche : null,
      input:document.querySelector("#rech")?.value || "",
      destination:typeof parseSearchQuery === "function" && typeof DECOUPAGE !== "undefined"
        ? parseSearchQuery("Paris", DECOUPAGE) : null,
      errors:window.__validationErrors || []}));
    throw new Error(`${error.message} diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await page.waitForFunction((zone) => typeof lieux !== "undefined" &&
    lieux.some((item) => item && (item.zone_id || item.zoneId) === zone), id, {timeout:10000});
  await page.waitForTimeout(300);
}

async function testerNavigateur(nom, moteur, base) {
  let browser;
  try {
    browser = await moteur.launch({headless:true});
    const page = await browser.newPage({viewport:VUES[0]});
    let pageInfo = await configurerPage(page, base, "mel");
    trace(nom, "MEL prête");
    let etat = await etatPage(page);
    verifier(`${nom} charge MEL en 1440`, etat.active === "mel" && etat.local.length > 0,
      `local=${etat.local.length}, zones=${etat.zones.join(",")}`);
    verifier(`${nom} MEL n'affiche pas Paris dans Explorer`,
      !etat.explorer.some((texte) => /paris/i.test(texte)) && !etat.local.some((texte) => /paris/i.test(texte)));
    verifier(`${nom} MEL ne reste pas en chargement`, !etat.loading);
    verifier(`${nom} MEL sans erreur JavaScript`, pageInfo.erreurs.length === 0, pageInfo.erreurs.slice(0, 2).join(" | "));

    trace(nom, "ouverture Pour toi");
    await page.locator('[data-nb="pourtoi"]').click();
    trace(nom, "Pour toi ouvert");
    await page.waitForFunction(() => typeof evenementsMajeursHorsZone !== "undefined" &&
      evenementsMajeursHorsZone.some((event) => event.zone_id === "paris"), null, {timeout:10000});
    trace(nom, "majeur chargé");
    await page.waitForTimeout(300);
    etat = await etatPage(page);
    const majeur = etat.pourtoi.find((item) => item.pool === "major_cross_zone");
    verifier(`${nom} le majeur Paris apparaît dans Pour toi MEL`, !!majeur,
      `cross=${etat.cross.length}, envies=${etat.envies.join(",")}, propositions=${JSON.stringify(etat.propositions)}, direct=${JSON.stringify(etat.directClassement)}`);
    verifier(`${nom} le majeur Paris est marqué « À Paris »`, !!majeur && /À Paris/i.test(majeur.text),
      majeur ? majeur.text.slice(0, 140) : "carte absente");
    trace(nom, "ouverture Aide");
    await page.locator('[data-nb="aide"]').click();
    trace(nom, "Aide ouverte");
    await page.waitForTimeout(250);
    etat = await etatPage(page);
    verifier(`${nom} Aide reste locale en MEL`, etat.aide.every((texte) => !/paris/i.test(texte)) &&
      !etat.bodyText.match(/Paris concert majeur/i));

    for (const id of ORDRE_ZONES.slice(1)) {
      trace(nom, "recherche", id);
      await rechercher(page, id);
      etat = await etatPage(page);
      verifier(`${nom} bascule vers ${id}`, etat.active === id && etat.local.length > 0 &&
        etat.zones.length === 1 && etat.zones[0] === id,
        `active=${etat.active}, zones=${etat.zones.join(",")}`);
      verifier(`${nom} ${id} ne conserve pas la zone précédente`,
        !etat.tous.some((texte) => new RegExp(id === "paris" ? "MEL" : "PARIS", "i").test(texte)));
    }
    await rechercher(page, "mel");
    trace(nom, "retour MEL");
    etat = await etatPage(page);
    verifier(`${nom} retour final vers MEL`, etat.active === "mel" && etat.zones.length === 1 && etat.zones[0] === "mel");
    await page.close();

    for (const vue of VUES.slice(1)) {
      trace(nom, "viewport", vue.nom);
      const mobile = await browser.newPage({viewport:vue, isMobile:true, hasTouch:true});
      const info = await configurerPage(mobile, base, "mel");
      const mobileState = await etatPage(mobile);
      verifier(`${nom} ${vue.nom} rendu sans débordement`, mobileState.width === vue.width &&
        mobileState.scrollWidth <= vue.width + 1 && !mobileState.loading,
        `width=${mobileState.width}, scrollWidth=${mobileState.scrollWidth}`);
      verifier(`${nom} ${vue.nom} sans erreur JavaScript`, info.erreurs.length === 0, info.erreurs.slice(0, 2).join(" | "));
      await mobile.close();
    }

    const onboarding = await browser.newPage({viewport:VUES[1], isMobile:true, hasTouch:true});
    trace(nom, "onboarding visite 1");
    const first = await configurerPage(onboarding, base, "mel", {
      testPosition:false, visits:0, permission:"prompt", onboardingCompleted:false,
    });
    await onboarding.evaluate(() => demarrerLocalisation());
    await onboarding.waitForTimeout(150);
    let localState = await etatPage(onboarding);
    verifier(`${nom} GPS visite 1 montre l'invitation`, localState.onboarding);
    await onboarding.close();

    const second = await browser.newPage({viewport:VUES[1], isMobile:true, hasTouch:true});
    await configurerPage(second, base, "mel", {
      testPosition:false, visits:1, permission:"prompt", onboardingCompleted:false,
      onboardingStep:"localisation",
    });
    await second.evaluate(() => demarrerLocalisation());
    await second.waitForTimeout(150);
    localState = await etatPage(second);
    verifier(`${nom} GPS visite 2 repropose discrètement`, localState.onboarding);
    await second.close();

    const third = await browser.newPage({viewport:VUES[1], isMobile:true, hasTouch:true});
    await configurerPage(third, base, "mel", {
      testPosition:false, visits:2, permission:"prompt", onboardingCompleted:false,
      onboardingStep:"localisation",
    });
    await third.evaluate(() => demarrerLocalisation());
    await third.waitForTimeout(150);
    localState = await etatPage(third);
    verifier(`${nom} GPS visite 3+ ne relance pas l'onboarding`, !localState.onboarding);
    await third.close();

    const granted = await browser.newPage({viewport:VUES[1], isMobile:true, hasTouch:true});
    await configurerPage(granted, base, "mel", {
      testPosition:false, visits:8, permission:"granted", onboardingCompleted:true,
    });
    await granted.context().grantPermissions(["geolocation"], {origin:base});
    await granted.evaluate(() => demarrerLocalisation());
    await granted.waitForTimeout(250);
    localState = await etatPage(granted);
    verifier(`${nom} permission déjà accordée reste silencieuse`, !localState.onboarding && localState.active === "mel");
    await granted.close();
    await browser.close();
  } catch (error) {
    trace(nom, "exception", error.stack || error.message);
    verifier(`${nom} scénario navigateur complet`, false, error.stack || error.message);
    if (browser) await browser.close().catch(() => {});
  }
}

const {serveur, base} = await creerServeur();
try {
  await testerNavigateur("Chromium", chromium, base);
  await testerNavigateur("WebKit", webkit, base);
} finally {
  await new Promise((resolve) => serveur.close(resolve));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\nRésultat navigateur : ${resultats.length - echecs.length}/${resultats.length} contrôles réussis`);
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec.`);
  process.exitCode = 1;
}
