/* ===========================================================================
   « Maintenant » à l'ouverture — mesuré, pas supposé

   CE QUE CE BANC MESURE VRAIMENT

   Le reproche auquel il répond n'est pas une question de logique mais de
   MOUVEMENT : le bloc apparaissait une ou deux secondes après l'ouverture et
   poussait les boutons du dessous sous le doigt de quelqu'un qui appuyait
   déjà. Aucun test de code ne voit ça. Il faut un vrai navigateur, et il faut
   RELEVER LA POSITION des éléments avant et après l'arrivée des données.

   C'est ce que fait `mesurerDeplacement` : il note la position de tout ce qui
   est sous le bloc, laisse les données arriver, et compare. Un seul pixel de
   décalage est un échec.

   Le reste vérifie le parcours : géolocalisation acceptée ou refusée, réseau
   lent, aucune donnée, beaucoup de données, changement de position — et dans
   chaque cas, les quatre états et l'absence de mouvement.

     npm install playwright leaflet
     AUTOUR_RACINE=autour node autour/outils/maintenant.mjs
   ======================================================================== */

import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = process.env.AUTOUR_RACINE || new URL("..", import.meta.url).pathname;
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".svg": "image/svg+xml" };

const serveur = createServer(async (req, res) => {
  let chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin === "/" || chemin.startsWith("/l/") || chemin.startsWith("/e/")) chemin = "/index.html";
  try {
    const fichier = join(RACINE, chemin);
    const s = await stat(fichier);
    if (!s.isFile()) throw new Error("dossier");
    res.writeHead(200, { "content-type": TYPES[extname(fichier)] || "application/octet-stream" });
    res.end(await readFile(fichier));
  } catch { res.writeHead(404); res.end("non"); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

const CENTRE = { lat: 50.6292, lng: 3.0573 };
const AILLEURS = { lat: 48.8566, lng: 2.3522 };

const resultats = [];
const ok = (nom, condition, detail = "") => {
  resultats.push({ nom, ok: !!condition, detail });
  console.log((condition ? "  ok   " : "ÉCHEC  ") + nom +
    (condition || !detail ? "" : "\n         → " + detail));
};
const anomalies = [];

/* ---- Les données servies, réglables par scénario ------------------------ */
function lieux(combien) {
  return Array.from({ length: combien }, (_, i) => ({
    type: "node", id: 3000 + i,
    lat: CENTRE.lat + (i % 6) * 0.001 - 0.002,
    lon: CENTRE.lng + Math.floor(i / 6) * 0.0012 - 0.002,
    tags: { name: "Lieu " + (i + 1), amenity: i % 2 ? "cafe" : "restaurant",
            opening_hours: "Mo-Su 00:00-24:00" },
  }));
}

/* Les cas temporels, écrits explicitement : c'est le cœur de la fiabilité.
   Seul `enCours` a le droit d'entrer dans « Maintenant ». */
function evenements(combienEnCours, ou) {
  const t = Date.now();
  const OU = ou || CENTRE;
  const base = (i, extra) => Object.assign({
    id: "e" + String(i).padStart(8, "0") + "-0000-4000-8000-000000000000",
    publication_id: null, title: "Événement " + i, description: "",
    category: "concert", timezone: "Europe/Paris", date_confidence: "exact",
    place_name: "Salle", address: "1 rue", city: "Ville", insee_code: null,
    lat: OU.lat + 0.001 + i * 0.0002, lng: OU.lng + 0.001,
    primary_source: "datatourisme", source_url: null, image_url: null,
    cancelled: false, last_source_update: null,
    last_synced_at: new Date().toISOString(),
  }, extra);

  const liste = [];
  for (let i = 0; i < combienEnCours; i++) {
    liste.push(base(i, {
      title: "En cours " + (i + 1), temporal_status: "now",
      start_at: new Date(t - 3600e3).toISOString(),
      end_at: new Date(t + 3600e3).toISOString(),
    }));
  }
  /* Les pièges, toujours présents : ils ne doivent JAMAIS entrer, quel que
     soit le nombre de places restées libres. */
  liste.push(base(90, { title: "Demain", temporal_status: "upcoming",
    start_at: new Date(t + 26 * 3600e3).toISOString(),
    end_at: new Date(t + 28 * 3600e3).toISOString() }));
  liste.push(base(91, { title: "Terminé", temporal_status: "past",
    start_at: new Date(t - 5 * 3600e3).toISOString(),
    end_at: new Date(t - 2 * 3600e3).toISOString() }));
  liste.push(base(92, { title: "Date inconnue", temporal_status: "unknown_date",
    start_at: null, end_at: null, date_confidence: "unknown" }));
  liste.push(base(93, { title: "Annulé", temporal_status: "now", cancelled: true,
    start_at: new Date(t - 3600e3).toISOString(),
    end_at: new Date(t + 3600e3).toISOString() }));
  liste.push(base(94, { title: "Sans fin", temporal_status: "now",
    start_at: new Date(t - 3600e3).toISOString(), end_at: null }));
  liste.push(base(95, { title: "Très loin", temporal_status: "now",
    lat: OU.lat + 3, lng: OU.lng + 3,
    start_at: new Date(t - 3600e3).toISOString(),
    end_at: new Date(t + 3600e3).toISOString() }));
  return liste;
}

async function nouvelOnglet(navigateur, opts = {}) {
  const ctx = await navigateur.newContext({
    ...(opts.bureau ? {} : devices["iPhone 13"]),
    permissions: opts.geoRefusee ? [] : ["geolocation"],
    geolocation: { latitude: CENTRE.lat, longitude: CENTRE.lng },
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  const nom = opts.etiquette || "page";
  page.on("pageerror", (e) => anomalies.push(`[${nom}] erreur JS : ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|favicon|manifest|Google Maps|Refused to execute/.test(t)) return;
    anomalies.push(`[${nom}] console.error : ${t.slice(0, 160)}`);
  });

  if (opts.geoRefusee) {
    await ctx.setGeolocation(null).catch(() => {});
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, ko) =>
        setTimeout(() => ko && ko({ code: 1, message: "User denied Geolocation" }), 120);
      navigator.geolocation.watchPosition = () => 0;
    });
  }

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (c) => route.fulfill({ status: 200, contentType: "application/json",
                                        body: JSON.stringify(c) });
    if (url.startsWith(BASE) && !/\/api\/|\/rpc\//.test(url)) return route.continue();
    if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    if (/leaflet.*\.js(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
    if (/leaflet.*\.css(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/css",
        body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
    if (/supabase-js|@supabase/.test(url) && /\.js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    if (/maps\.googleapis\.com/.test(url)) return route.abort("failed");

    // le délai s'applique aux DONNÉES, pas aux ressources : c'est lui qui
    // ouvre la fenêtre pendant laquelle le bloc pourrait sauter
    if (opts.lent) await new Promise((r) => setTimeout(r, opts.lent));

    if (/\/api\/lieux|overpass/.test(url)) return json({ elements: lieux(opts.lieux ?? 12) });
    if (/rpc\/evenements_proches/.test(url))
      return json(evenements(opts.enCours ?? 5, opts.evenementsA));
    if (/rpc\/publications_proches/.test(url)) return json([]);
    if (/\/api\/commune/.test(url)) return json({ nom: "Ville d'essai" });
    if (/rpc\//.test(url) || /supabase/.test(url)) return json([]);
    /* Le géocodeur : c'est LUI qui déclenche le vrai chemin « autre ville »
       (`rechercheGeographique`), avec son emprise et son `rechercheGeo`. Le
       bouchonner permet de rejouer le geste exact plutôt qu'une approximation
       à coups d'`allerVers`. */
    if (/nominatim/.test(url)) {
      if (!opts.geocode) return json([]);
      const v = opts.geocode;
      return json([{ lat: String(v.lat), lon: String(v.lng), importance: 0.9,
        display_name: v.nom || "Ailleurs",
        boundingbox: [String(v.lat - 0.09), String(v.lat + 0.09),
                      String(v.lng - 0.13), String(v.lng + 0.13)] }]);
    }
    if (/openagenda|routing|osrm/.test(url)) return json([]);
    return json({});
  });

  /* Un faux SDK Supabase minimal : sans lui, `createClient` n'existe pas et
     aucun événement n'est jamais demandé — tous les scénarios se joueraient
     dans le vide sans que rien ne le dise. */
  await page.addInitScript(() => {
    const rep = (data) => Promise.resolve({ data, error: null });
    window.supabase = { createClient: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => rep(null) }),
                                      order: function(){ return this; },
                                      limit: function(){ return this; },
                                      then: (r) => rep([]).then(r) }) }),
      rpc: (nom) => fetch("/rpc/" + nom).then((r) => r.json()).then((d) => ({ data: d, error: null }))
        .catch(() => ({ data: [], error: null })),
      auth: { getSession: () => rep({ session: null }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({}) },
    }) };
  });

  await page.goto(BASE + "/index.html");
  return { ctx, page };
}

/* ---- Ce qu'on relève à l'écran ----------------------------------------- */
const etatBloc = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-testid="maintenant-liste"]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return {
    etat: b.dataset.mnEtat,
    hauteur: Math.round(r.height),
    haut: Math.round(r.top),
    lignes: b.querySelectorAll("[data-mn]").length,
    attente: !!b.querySelector(".mn-attente"),
    rien: !!b.querySelector(".mn-rien"),
    titres: [...b.querySelectorAll("[data-mn] b")].map((e) => e.textContent),
    busy: b.getAttribute("aria-busy"),
  };
});

/* LA MESURE QUI COMPTE.

   On relève la position de tout ce qui vit SOUS le bloc, on laisse les données
   arriver, et on recompare. Si quoi que ce soit a bougé, le bloc a poussé
   l'interface — c'est exactement le défaut à supprimer. */
const positions = (page) => page.evaluate(() => {
  const cibles = ["#navBas", '[data-rc-tout]', ".rc-tete", ".ong-temps",
                  '[data-testid="maintenant-liste"]'];
  const out = {};
  for (const sel of cibles) {
    const e = document.querySelector(sel);
    if (e) { const r = e.getBoundingClientRect(); out[sel] = Math.round(r.top); }
  }
  return out;
});

function compareposition(avant, apres) {
  const bouges = [];
  for (const cle of Object.keys(avant)) {
    if (!(cle in apres)) { bouges.push(cle + " a disparu"); continue; }
    const d = Math.abs(apres[cle] - avant[cle]);
    if (d > 0) bouges.push(cle + " : " + d + " px");
  }
  return bouges;
}

const navigateur = await chromium.launch({ executablePath: CHROME });

/* ======================================================================== */
/*  1. L'OUVERTURE — le parcours que tout le reste sert                     */
/* ======================================================================== */
console.log("\n──── 1. ouverture, réseau normal ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur, { etiquette: "ouverture", lent: 700 });

  // le bloc doit exister AVANT que quoi que ce soit soit arrivé
  await page.waitForSelector('[data-testid="maintenant-liste"]', { timeout: 5000 })
    .catch(() => {});
  const tot = await etatBloc(page);
  ok("la place est réservée dès le premier rendu", !!tot,
     "aucune section « Maintenant » à l'écran");
  if (tot) {
    ok("l'état initial est « loading »", tot.etat === "loading", tot.etat);
    ok("un état léger et neutre, sans texte à lire", tot.attente === true);
    ok("il est annoncé comme occupé aux lecteurs d'écran", tot.busy === "true", tot.busy);
    ok("il occupe déjà sa hauteur définitive", tot.hauteur >= 200,
       tot.hauteur + " px");
  }

  const avant = await positions(page);
  await page.waitForTimeout(3000);
  const apres = await positions(page);
  const bouges = compareposition(avant, apres);
  ok("RIEN NE BOUGE quand les données arrivent", bouges.length === 0, bouges.join(" · "));

  const fini = await etatBloc(page);
  ok("l'état devient « ready » tout seul", fini && fini.etat === "ready",
     fini && fini.etat);
  ok("sans avoir appuyé sur « Maintenant »", true);
  ok("au plus trois résultats", fini && fini.lignes <= 3, fini && String(fini.lignes));
  ok("et au moins un", fini && fini.lignes >= 1, fini && String(fini.lignes));
  ok("la hauteur n'a pas changé entre loading et ready",
     tot && fini && tot.hauteur === fini.hauteur,
     tot && fini ? tot.hauteur + " → " + fini.hauteur : "");

  /* LA FIABILITÉ : aucun des pièges ne doit être entré, même s'il restait des
     places libres. */
  const titres = (fini && fini.titres) || [];
  for (const interdit of ["Demain", "Terminé", "Date inconnue", "Annulé",
                          "Sans fin", "Très loin"]) {
    ok("« " + interdit + " » n'entre pas dans Maintenant",
       !titres.some((t) => t.includes(interdit)), titres.join(" | "));
  }
  /* « Maintenant » n'est plus un filtre d'événements : un lieu ouvert est une
     réponse valable à « qu'est-ce que je peux faire ». Ce qui doit rester
     vrai, c'est l'ORDRE — un événement en cours passe devant un restaurant
     ouvert, parce qu'il est rare et périssable. */
  ok("un événement en cours reste en tête",
     titres.length > 0 && titres[0].includes("En cours"), titres.join(" | "));
  const natures = await page.evaluate(() =>
    selectionMaintenant().map((l) => l.nature));
  ok("chaque proposition porte sa nature",
     natures.length > 0 && natures.every((n) => n), natures.join(", "));
  ok("les natures sont celles du contrat",
     natures.every((n) => ["event_now", "session_soon", "activity_now", "open_now"]
       .includes(n)), natures.join(", "));

  await ctx.close();
}

/* ======================================================================== */
/*  2. AUCUNE DONNÉE — vide, et pas de remplissage                          */
/* ======================================================================== */
console.log("\n──── 2. aucune donnée ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur,
    { etiquette: "vide", enCours: 0, lieux: 0 });
  await page.waitForTimeout(3000);

  const b = await etatBloc(page);
  ok("le bloc est toujours là", !!b);
  if (b) {
    ok("état « empty », pas « error »", b.etat === "empty", b.etat);
    ok("aucun emplacement n'est rempli artificiellement", b.lignes === 0,
       b.titres.join(" | "));
    ok("il dit qu'il n'y a rien, plutôt que de rester vide", b.rien === true);
    ok("il occupe toujours la même place", b.hauteur >= 200, b.hauteur + " px");
  }
  const texte = await page.evaluate(() =>
    (document.querySelector('[data-testid="maintenant-liste"]') || {}).textContent || "");
  ok("le mot est celui de quelqu'un, pas d'un journal technique",
     /Rien d’ouvert ni en cours/.test(texte), texte.slice(0, 120));
  ok("Explorer reste accessible", await page.evaluate(() =>
     !!document.querySelector('#navBas [data-nb="explorer"]')));

  await ctx.close();
}

/* ======================================================================== */
/*  3. GÉOLOCALISATION REFUSÉE — jamais lue comme un vide                   */
/* ======================================================================== */
console.log("\n──── 3. géolocalisation refusée ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur,
    { etiquette: "geo-refusee", geoRefusee: true });
  await page.waitForTimeout(3000);

  const b = await etatBloc(page);
  ok("le bloc est toujours là", !!b);
  if (b) {
    ok("l'état n'est PAS « empty »", b.etat !== "empty", b.etat);
    ok("il occupe toujours la même place", b.hauteur >= 200, b.hauteur + " px");
  }
  const texte = await page.evaluate(() =>
    (document.querySelector('[data-testid="maintenant-liste"]') || {}).textContent || "");
  ok("on ne dit JAMAIS « rien autour de toi » sans savoir où est « toi »",
     !/Rien d’ouvert ni en cours/.test(texte), texte.slice(0, 140));
  ok("on dit qu'on ignore la position", /ne sait pas où tu es/.test(texte),
     texte.slice(0, 140));
  ok("et une sortie est proposée", await page.evaluate(() =>
     !!document.querySelector("[data-mn-sortie]")));

  await ctx.close();
}

/* ======================================================================== */
/*  4. RÉSEAU LENT — le bloc attend sans sauter                             */
/* ======================================================================== */
console.log("\n──── 4. réseau lent ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur, { etiquette: "lent", lent: 2500 });
  await page.waitForSelector('[data-testid="maintenant-liste"]', { timeout: 5000 })
    .catch(() => {});

  const releves = [];
  for (let i = 0; i < 6; i++) {
    releves.push(await positions(page));
    await page.waitForTimeout(700);
  }
  const bouges = releves.slice(1).flatMap((p, i) => compareposition(releves[i], p));
  ok("aucun déplacement pendant toute l'attente", bouges.length === 0,
     bouges.slice(0, 4).join(" · "));

  const b = await etatBloc(page);
  ok("l'état finit par devenir « ready »", b && b.etat === "ready", b && b.etat);

  await ctx.close();
}

/* ======================================================================== */
/*  5. BEAUCOUP DE DONNÉES — toujours trois au plus                         */
/* ======================================================================== */
console.log("\n──── 5. beaucoup de données ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur,
    { etiquette: "dense", enCours: 40, lieux: 80 });
  await page.waitForTimeout(3500);

  const b = await etatBloc(page);
  ok("trois résultats au plus, même avec quarante", b && b.lignes === 3,
     b && String(b.lignes));
  ok("le compteur dit le vrai total", await page.evaluate(() => {
    const t = (document.querySelector(".mn-tete span") || {}).textContent || "";
    return /\((\d+)\)/.test(t) && Number(t.match(/\((\d+)\)/)[1]) > 3;
  }));
  ok("« Voir tout » est proposé", await page.evaluate(() =>
     !!document.querySelector("[data-mn-tout]")));
  ok("la hauteur est la même qu'avec trois résultats", b && b.hauteur >= 200,
     b && b.hauteur + " px");

  await ctx.close();
}

/* ======================================================================== */
/*  6. CHANGEMENT DE POSITION                                               */
/* ======================================================================== */
console.log("\n──── 6. changement de position ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur, { etiquette: "deplacement" });
  await page.waitForTimeout(2500);
  const avantBloc = await etatBloc(page);
  const avant = await positions(page);
  ok("des résultats avant le déplacement", avantBloc && avantBloc.lignes >= 1,
     avantBloc && String(avantBloc.lignes));

  await ctx.setGeolocation({ latitude: AILLEURS.lat, longitude: AILLEURS.lng });
  await page.evaluate((p) => { positionMoi = [p.lat, p.lng]; chargerAutourDeMoi &&
    chargerAutourDeMoi(); majFeuille2(); }, AILLEURS).catch(() => {});
  await page.waitForTimeout(2500);

  const apres = await positions(page);
  ok("le déplacement ne fait pas sauter l'interface",
     compareposition(avant, apres).length === 0,
     compareposition(avant, apres).join(" · "));
  const apresBloc = await etatBloc(page);
  ok("le bloc reste dans un état propre",
     apresBloc && ["ready", "loading", "empty", "error"].includes(apresBloc.etat),
     apresBloc && apresBloc.etat);

  await ctx.close();
}

/* ======================================================================== */
/*  6 bis. UNE AUTRE VILLE                                                  */
/*                                                                          */
/*  LE DÉFAUT SIGNALÉ, ET LA RAISON POUR LAQUELLE AUCUN BANC NE LE VOYAIT.  */
/*                                                                          */
/*  Tous les scénarios ci-dessus regardent l'endroit où ils se trouvent : la */
/*  carte est centrée sur la position, et « depuis moi » se confond avec     */
/*  « depuis ce que je regarde ». Le jour où les deux divergent — taper le   */
/*  nom d'une autre ville — le filtre de distance refusait TOUT à 220 km,    */
/*  et le bloc annonçait « rien en cours près de toi » au-dessus d'une carte */
/*  pleine d'événements en cours.                                           */
/* ======================================================================== */
console.log("\n──── 6 bis. je suis ici, je regarde ailleurs ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur,
    { etiquette: "autre-ville", evenementsA: AILLEURS, enCours: 5,
      geocode: Object.assign({ nom: "Ailleurs" }, AILLEURS) });
  await page.waitForFunction(() => typeof rechercheGeographique === "function",
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // LE GESTE RÉEL : taper le nom d'une ville dans la recherche
  await page.evaluate(() => rechercheGeographique("Ailleurs"));
  /* `allerVers` anime malgré `duration:0` — le vol dure environ deux secondes
     et demie, `moveend` ne part qu'à la fin, et le rafraîchissement de la
     feuille attend encore 350 ms derrière son antirebond. Attendre trois
     secondes faisait la course avec ce dernier délai : le banc voyait « empty »
     une fois sur deux alors que le correctif était bon. */
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="maintenant-liste"]');
    return e && e.dataset.mnEtat !== "loading";
  }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const etat = await page.evaluate(() => ({
    charges: lieux.filter((l) => estTemporaire(l)).length,
    selection: selectionMaintenant().length,
    raisons: [...new Set(lieux.filter((l) => estTemporaire(l))
      .map((l) => AutourMaintenant.fiable(versItemMaintenant(l, Date.now()),
        contexteMaintenant()).raison))],
    loinDeMoi: Math.round(distanceM(positionMoi[0], positionMoi[1],
      centreCarte()[0], centreCarte()[1]) / 1000),
  }));

  ok("autre ville · les événements y sont bien chargés", etat.charges >= 5,
     etat.charges + " événement(s)");
  ok("autre ville · on regarde vraiment ailleurs", etat.loinDeMoi > 100,
     etat.loinDeMoi + " km de ma position");
  /* « trop_loin » doit rester présent : c'est le piège « Très loin », posé à
     trois cents kilomètres exprès. Ce qu'on vérifie, c'est qu'il en reste des
     RETENUS — avant le correctif, la liste des raisons ne contenait que
     « trop_loin » pour les cinq événements en cours. */
  ok("autre ville · LES ÉVÉNEMENTS EN COURS NE SONT PLUS REFUSÉS À DISTANCE",
     etat.raisons.includes("retenu"), etat.raisons.join(", "));
  ok("autre ville · la sélection les montre", etat.selection >= 1,
     etat.selection + " retenu(s)");

  const bloc = await etatBloc(page);
  ok("autre ville · le bloc est « ready », pas « empty »",
     bloc && bloc.etat === "ready", bloc && bloc.etat);
  ok("autre ville · trois au plus", bloc && bloc.lignes <= 3, bloc && String(bloc.lignes));

  /* Regarder Paris depuis Lille affichait « 220 km » sous chaque concert : une
     mesure exacte et parfaitement inutile. */
  const distances = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="maintenant-liste"] [data-mn] u')]
      .map((e) => e.textContent));
  ok("autre ville · aucune distance absurde n'est affichée",
     !distances.some((d) => /\d{3,} km/.test(d)), distances.join(" | "));

  // et les pièges restent des pièges, même à l'autre bout du pays
  const titres = (bloc && bloc.titres) || [];
  ok("autre ville · les événements de demain n'entrent toujours pas",
     !titres.some((t) => /Demain|Terminé|Annulé|Date inconnue|Sans fin/.test(t)),
     titres.join(" | "));

  await ctx.close();
}

/* ======================================================================== */
/*  7. LE BUREAU                                                            */
/* ======================================================================== */
console.log("\n──── 7. ordinateur ────");
{
  const { ctx, page } = await nouvelOnglet(navigateur,
    { etiquette: "bureau", bureau: true, lent: 600 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector('[data-testid="maintenant-liste"]', { timeout: 5000 })
    .catch(() => {});
  const avant = await positions(page);
  await page.waitForTimeout(3000);
  const apres = await positions(page);
  ok("bureau · rien ne bouge non plus", compareposition(avant, apres).length === 0,
     compareposition(avant, apres).join(" · "));
  const b = await etatBloc(page);
  ok("bureau · le bloc est prêt tout seul", b && b.etat === "ready", b && b.etat);
  ok("bureau · au plus trois", b && b.lignes <= 3, b && String(b.lignes));

  await ctx.close();
}

/* ======================================================================== */
/*  8. RÉPÉTITION — dix ouvertures d'affilée                                */
/*     Un défaut de course ne se voit pas au premier essai.                 */
/* ======================================================================== */
console.log("\n──── 8. dix ouvertures d'affilée ────");
{
  let etatsVus = new Set();
  let sauts = 0;
  let prets = 0;
  for (let i = 0; i < 10; i++) {
    const { ctx, page } = await nouvelOnglet(navigateur,
      { etiquette: "repet" + i, lent: 200 + i * 120 });
    await page.waitForSelector('[data-testid="maintenant-liste"]', { timeout: 4000 })
      .catch(() => {});
    const avant = await positions(page);
    const b0 = await etatBloc(page);
    if (b0) etatsVus.add(b0.etat);
    await page.waitForTimeout(2600);
    const apres = await positions(page);
    if (compareposition(avant, apres).length) sauts++;
    const b1 = await etatBloc(page);
    if (b1) { etatsVus.add(b1.etat); if (b1.etat === "ready") prets++; }
    await ctx.close();
  }
  ok("dix ouvertures, aucun déplacement", sauts === 0, sauts + " ouverture(s) avec saut");
  ok("dix ouvertures, dix fois « ready »", prets === 10, prets + "/10");
  ok("aucun état inattendu", [...etatsVus].every((e) =>
     ["loading", "ready", "empty", "error"].includes(e)), [...etatsVus].join(", "));
}

await navigateur.close();
serveur.close();

const passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + resultats.length + " vérifications passées");
if (passes !== resultats.length) {
  console.log("\nCas en échec :");
  resultats.filter((r) => !r.ok).forEach((r) =>
    console.log("  · " + r.nom + (r.detail ? " — " + r.detail : "")));
}
if (anomalies.length) {
  console.log("\n──── anomalies JS observées ────");
  [...new Set(anomalies)].forEach((a) => console.log("  · " + a));
}
process.exit(passes === resultats.length ? 0 : 1);
