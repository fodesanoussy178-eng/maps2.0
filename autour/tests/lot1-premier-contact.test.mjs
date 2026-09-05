/* ===========================================================================
   LOT 1 — Premier contact, localisation et recherche d'adresse

   Ce que ces tests défendent, en une phrase : Autour doit être utilisable par
   quelqu'un qui n'a jamais accordé la géolocalisation, et qui ne l'accordera
   peut-être jamais.

   Trois familles :

     · la PERMISSION — jamais demandée toute seule, toujours après un geste ;
     · la POSITION APPROXIMATIVE — utile pour choisir une zone déjà ouverte,
       et incapable d'en ouvrir une nouvelle ;
     · la RECHERCHE D'ADRESSE — la voie manuelle, qui doit rester praticable
       sur un réseau lent et ne jamais mélanger deux villes.
   ======================================================================== */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

const zonesSrc = await readFile(new URL("../zones-autonomes.js", import.meta.url), "utf8");
new Function("globalThis", zonesSrc)(globalThis);
const Z = globalThis.AutourZones;

const adresseSrc = await readFile(new URL("../adresse.js", import.meta.url), "utf8");
new Function("globalThis", adresseSrc)(globalThis);
const A = globalThis.AutourAdresse;

const positionApi = (await import("../api/position.js")).default;

const requete = (entetes) => ({ headers: new Headers(entetes || {}) });

/* ---- 1. La permission n'est jamais arrachée ----------------------------- */

test("une permission déjà accordée redonne la position précise, toute seule", () => {
  const bloc = app.slice(app.indexOf("async function demarrerLocalisation()"),
                         app.indexOf("function lancerOnboardingLocalisation()"));
  assert.match(bloc, /if\(etatPerm === "granted"\) suivreMaPosition\(\{silencieux:true\}\);/,
    "une permission acquise doit continuer à servir sans rien redemander");
});

test("une permission jamais demandée n'ouvre aucune popup au chargement", () => {
  const bloc = app.slice(app.indexOf("async function demarrerLocalisation()"),
                         app.indexOf("function lancerOnboardingLocalisation()"));
  /* La branche `prompt` pose un panneau d'Autour — pas la permission native.
     Le seul appel à `suivreMaPosition` de ce bloc est celui de `granted`. */
  const prompt = bloc.slice(bloc.indexOf('else if(etatPerm === "prompt")'));
  assert.doesNotMatch(prompt, /suivreMaPosition/,
    "la branche « jamais demandée » ne doit jamais appeler la géolocalisation");
  assert.match(prompt, /afficherOnboarding|proposerPosition/,
    "elle doit se contenter d'expliquer et d'attendre un geste");
});

test("un refus laisse l'application entière, et ne redemande rien", () => {
  const bloc = app.slice(app.indexOf("async function demarrerLocalisation()"),
                         app.indexOf("function lancerOnboardingLocalisation()"));
  const refus = bloc.slice(bloc.indexOf('etatPerm === "denied"'));
  assert.doesNotMatch(refus, /suivreMaPosition/);
  assert.match(refus, /proposerPosition\(\);/,
    "la voie manuelle — chercher une ville — doit rester proposée");
});

test("la permission native ne part que derrière un geste explicite", () => {
  // le bouton du panneau, le bandeau, et « utiliser ma position »
  assert.match(app, /\$\("#onboardingAction"\)\.onclick=\(\)=>\{/);
  assert.match(app, /\$\("#bandeauOk"\)\.onclick=\(\)=>\{[^}]*suivreMaPosition\(\{reproposer:true\}\);/);
  assert.match(app, /if\(b\.dataset\.ou === "position"\)\{ suivreMaPosition\(\); return; \}/);
  /* Et le démarrage lui-même ne la déclenche pas : il appelle
     `demarrerLocalisation`, dont les branches sont vérifiées ci-dessus. */
  assert.match(app, /if\(!positionTest\) demarrerLocalisation\(\);/);
});

/* ---- 2. La position approximative, et sa limite ------------------------- */

test("les en-têtes Vercel donnent une position approximative minimale", async () => {
  const reponse = positionApi(requete({
    "x-vercel-ip-latitude": "50.6292",
    "x-vercel-ip-longitude": "3.0573",
    "x-vercel-ip-city": "Lille",
    "x-vercel-ip-country": "FR",
  }));
  const charge = await reponse.json();
  assert.equal(charge.disponible, true);
  assert.equal(charge.lat, 50.6292);
  assert.equal(charge.lng, 3.0573);
  assert.equal(charge.ville, "Lille");
  assert.equal(charge.precision, "ville");
  /* Le strict nécessaire, et rien de plus : aucune adresse IP, aucun en-tête
     recopié, aucun identifiant. */
  assert.deepEqual(Object.keys(charge).sort(),
    ["disponible", "lat", "lng", "pays", "precision", "ville"]);
  /* Et jamais mise en cache par un intermédiaire : la réponse dépend de qui
     demande, la servir à la personne suivante serait une fuite. */
  assert.equal(reponse.headers.get("cache-control"), "private, no-store");
});

test("le nom de ville encodé est rendu lisible", async () => {
  const charge = await positionApi(requete({
    "x-vercel-ip-latitude": "45.4397",
    "x-vercel-ip-longitude": "4.3872",
    "x-vercel-ip-city": "Saint-%C3%89tienne",
  })).json();
  assert.equal(charge.ville, "Saint-Étienne");
});

test("sans en-têtes, la route le dit au lieu d'inventer un point", async () => {
  const reponse = positionApi(requete({}));
  assert.equal(reponse.status, 200, "une absence d'en-tête est normale, pas une erreur");
  assert.deepEqual(await reponse.json(), { disponible: false });
});

test("des en-têtes aberrants ne produisent aucune position", async () => {
  for (const entetes of [
    { "x-vercel-ip-latitude": "999", "x-vercel-ip-longitude": "3" },
    { "x-vercel-ip-latitude": "50.6", "x-vercel-ip-longitude": "" },
    { "x-vercel-ip-latitude": "pas-un-nombre", "x-vercel-ip-longitude": "3" },
  ]) {
    assert.deepEqual(await positionApi(requete(entetes)).json(), { disponible: false });
  }
});

test("la route ne connaît aucune zone : elle rend un point, pas un territoire", async () => {
  const source = await readFile(new URL("../api/position.js", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const zone of Z.ids)
    assert.doesNotMatch(code, new RegExp('"' + zone + '"'),
      zone + " ne doit pas être écrite dans la route : le client résout la zone");
  assert.doesNotMatch(code, /zone/i,
    "aucun second moteur géographique côté serveur");
});

test("une IP hors des zones ouvertes n'ouvre aucune zone", () => {
  /* Le fait, d'abord : Toulouse, Lyon et Bordeaux ne relèvent d'aucune zone. */
  assert.equal(Z.zoneIdForPoint([43.6047, 1.4442]), null, "Toulouse");
  assert.equal(Z.zoneIdForPoint([45.7640, 4.8357]), null, "Lyon");
  assert.equal(Z.zoneIdForPoint([44.8378, -0.5792]), null, "Bordeaux");

  /* Et la conséquence, dans le démarrage : la position IP n'est retenue que si
     elle tombe dans une zone ouverte. Sinon c'est le repli — jamais une zone
     nouvelle, jamais le point de Toulouse conservé comme « autour de moi ». */
  assert.match(app, /const zoneDuServeur = duServeur\s*\n?\s*\? zoneOuvertePour\(\[duServeur\.lat, duServeur\.lng\]\) : null;/);
  assert.match(app, /else if\(duServeur && zoneDuServeur\)\{/);
  assert.match(app, /originePosition = "repli"; precisionPosition = "zone";/);
  /* Le repli est une zone qui existe déjà, désignée par son identifiant. */
  assert.match(app, /const ZONE_REPLI_PRODUIT = "mel";/);
  assert.match(app, /ZONES\.definition\(ZONE_REPLI_PRODUIT\)/);
});

test("le repli complète aussi la route, avec la même règle", () => {
  const bloc = app.slice(app.indexOf("async function completerParPositionServeur()"),
                         app.indexOf("/* ---- La dernière position"));
  assert.match(bloc, /if\(!zoneOuvertePour\(\[point\.lat, point\.lng\]\)\) return false;/,
    "la route obéit à la même règle que le cookie : hors zone, on n'ouvre rien");
  assert.match(bloc, /if\(originePosition === "gps" \|\| originePosition === "manual"\) return false;/,
    "une vérité déjà connue ne redescend jamais vers une approximation");
});

test("le repli n'est pas une position, et ne peut pas dire « autour de toi »", () => {
  assert.match(app,
    /const positionConnue = \(\)=>originePosition !== null && originePosition !== "repli";/);
});

test("la carte existe pendant toute la résolution, sans loader bloquant", () => {
  /* L'écran est peint avant que quoi que ce soit de réseau ne parte : le
     jalon `ui_ready` précède le chargement, et la complétion par la route est
     explicitement posée après la peinture. */
  assert.ok(app.indexOf('PERF.jalon("ui_ready")') <
            app.indexOf("apresPeinture(()=>chargerLeDemarrage(rapide))"));
  assert.match(app, /apresPeinture\(\(\)=>completerParPositionServeur\(\)\);/);
});

/* ---- 3. La recherche d'adresse ----------------------------------------- */

const fauxService = (features) => async () => ({
  ok: true, json: async () => ({ type: "FeatureCollection", features }),
});

const commune = (nom, ville, lat, lng, score) => ({
  properties: { id: nom, label: nom, city: ville, type: "municipality",
                postcode: "59000", citycode: "59350", score: score },
  geometry: { coordinates: [lng, lat] },
});
const voie = (label, ville, lat, lng, score) => ({
  properties: { id: label, label: label, city: ville, type: "street",
                postcode: "59000", citycode: "59350", score: score },
  geometry: { coordinates: [lng, lat] },
});

test("la recherche interroge la Base Adresse Nationale, sans clé", () => {
  assert.equal(A.POINT_ENTREE, "https://api-adresse.data.gouv.fr/search/");
  const url = A.construireUrl("Lille", { limite: 5 });
  assert.match(url, /^https:\/\/api-adresse\.data\.gouv\.fr\/search\/\?/);
  assert.match(url, /q=Lille/);
  assert.match(url, /limit=5/);
  assert.doesNotMatch(url, /key|token|api[-_]?key/i, "aucune clé n'est requise");
});

test("« Lille » et « Tourcoing » rendent leur commune", async () => {
  for (const [nom, lat, lng] of [["Lille", 50.6292, 3.0573], ["Tourcoing", 50.7236, 3.1611]]) {
    const res = await A.chercher(nom, { fetch: fauxService([commune(nom, nom, lat, lng, 0.9)]) });
    assert.equal(res.length, 1);
    assert.equal(res[0].ville, nom);
    assert.equal(res[0].estCommune, true);
    assert.equal(res[0].lat, lat);
    /* Et le point rendu relève bien de la zone attendue — c'est `AutourZones`
       qui le dit, pas ce module. */
    assert.equal(Z.zoneIdForPoint([res[0].lat, res[0].lng]), "mel");
  }
});

test("une adresse précise reste une adresse, pas une commune", async () => {
  const res = await A.chercher("Place de la République Lille", {
    fetch: fauxService([voie("Place de la République 59000 Lille", "Lille", 50.6329, 3.0626, 0.87)]),
  });
  assert.equal(res.length, 1);
  assert.equal(res[0].estCommune, false);
  assert.equal(res[0].type, "street");
  assert.equal(res[0].ville, "Lille");
});

test("à score comparable, la commune passe devant la rue du même nom", async () => {
  const res = await A.chercher("Tourcoing", {
    fetch: fauxService([
      voie("Rue de Tourcoing, Roubaix", "Roubaix", 50.69, 3.17, 0.90),
      commune("Tourcoing", "Tourcoing", 50.7236, 3.1611, 0.88),
    ]),
  });
  assert.equal(res[0].estCommune, true, "qui tape une ville veut la ville");
});

test("un score franchement meilleur reste prioritaire sur le type", async () => {
  const res = await A.chercher("12 rue Nationale Lille", {
    fetch: fauxService([
      voie("12 Rue Nationale 59000 Lille", "Lille", 50.6335, 3.0575, 0.96),
      commune("Nationale", "Nationale", 44.0, 1.0, 0.40),
    ]),
  });
  assert.equal(res[0].estCommune, false);
});

test("une saisie trop courte ne part jamais sur le réseau", async () => {
  let appels = 0;
  const compteur = async () => { appels += 1; return { ok: true, json: async () => ({ features: [] }) }; };
  assert.equal(A.saisieExploitable("li"), false);
  assert.deepEqual(await A.chercher("li", { fetch: compteur }), []);
  assert.equal(appels, 0);
});

test("un service en panne rend une liste vide, jamais une exception", async () => {
  assert.deepEqual(await A.chercher("Lille", { fetch: async () => ({ ok: false, status: 503 }) }), []);
  assert.deepEqual(await A.chercher("Lille", { fetch: async () => { throw new Error("réseau"); } }), []);
  assert.deepEqual(await A.chercher("Lille", {
    fetch: async () => ({ ok: true, json: async () => { throw new Error("json"); } }),
  }), []);
});

test("une réponse illisible ne produit aucune suggestion inventée", async () => {
  const res = await A.chercher("Lille", {
    fetch: fauxService([
      { properties: { label: "Sans point", type: "municipality" }, geometry: {} },
      { properties: { label: "Hors monde", type: "municipality" }, geometry: { coordinates: [999, 999] } },
      null,
    ]),
  });
  assert.deepEqual(res, []);
});

test("le chercheur à saisie regroupe les frappes et annule la précédente", async () => {
  const partis = [];
  const chercheur = A.creerChercheur({
    delai: 5,
    fetch: async (url) => { partis.push(url); return { ok: true, json: async () => ({ features: [] }) }; },
    surResultats: () => {},
  });
  chercheur.saisir("Lil");
  chercheur.saisir("Lill");
  chercheur.saisir("Lille");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(partis.length, 1, "trois frappes, une seule requête");
  assert.match(partis[0], /q=Lille/, "et c'est la dernière saisie qui part");
});

test("une réponse en retard n'écrase pas une saisie plus récente", async () => {
  const rendus = [];
  const chercheur = A.creerChercheur({
    delai: 1,
    fetch: async (url) => {
      const lent = /q=Lil(&|$)/.test(url);
      await new Promise((r) => setTimeout(r, lent ? 30 : 1));
      return { ok: true, json: async () => ({
        features: [commune(lent ? "Lisieux" : "Lille", lent ? "Lisieux" : "Lille", 50.6, 3.05, 0.9)],
      }) };
    },
    surResultats: (res) => rendus.push(res.map((x) => x.ville)),
  });
  chercheur.saisir("Lil");
  await new Promise((r) => setTimeout(r, 5));
  chercheur.saisir("Lille");
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!rendus.some((r) => r.includes("Lisieux")),
    "la réponse de la saisie abandonnée ne doit jamais s'afficher");
  assert.deepEqual(rendus[rendus.length - 1], ["Lille"]);
});

test("retaper une saisie déjà posée ne coûte pas une seconde requête", async () => {
  let appels = 0;
  const chercheur = A.creerChercheur({
    delai: 1,
    fetch: async () => { appels += 1; return { ok: true, json: async () => ({ features: [] }) }; },
    surResultats: () => {},
  });
  chercheur.saisir("Lille");
  await new Promise((r) => setTimeout(r, 20));
  chercheur.saisir("Lille");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(appels, 1);
});

/* ---- 4. Aucun mélange entre zones -------------------------------------- */

test("choisir une adresse emprunte le basculement de zone, pas un second chemin", () => {
  /* Un seul endroit sait basculer de zone. La recherche Nominatim comme la
     Base Adresse Nationale y passent : même invalidation de portée, même
     annulation des requêtes en vol, donc la même garantie qu'aucun résultat
     de l'ancienne ville ne survit dans la nouvelle. */
  assert.match(app, /async function poserZoneGeographique\(q, zone, generationRecherche, options\)\{/);
  assert.match(app, /return poserZoneGeographique\(q, zone, generationRecherche\);/,
    "la recherche Nominatim délègue au basculement commun");
  assert.match(app, /if\(x\.adresse\)\{[\s\S]{0,400}poserZoneGeographique\(/,
    "la sélection d'une adresse aussi");

  const bloc = app.slice(app.indexOf("async function poserZoneGeographique"),
                         app.indexOf("/* ---- Favoris, côté écran"));
  assert.match(bloc, /definirZoneActive\(CTX \? CTX\.zoneRecherche\(/);
  assert.match(bloc, /annulerChargementsZone\("recherche:zone"\);/);
  assert.match(bloc, /selectionAccueil = null;/);
});

test("la saisie ne relance pas une recherche en boucle sur sa propre réponse", () => {
  /* `surResultats` rappelle `suggerer`, qui appelle `saisir` : sans ce
     drapeau, la mémoire du chercheur rendrait la main immédiatement et les
     deux s'appelleraient sans fin. */
  assert.match(app, /if\(!\(options && options\.depuisAdresse\)\)\{\s*\n\s*const chercheur = chercheurAdresses\(\);/);
  assert.match(app, /suggerer\(requete, \{depuisAdresse:true\}\);/);
  assert.match(app, /if\(rechercheTexte\(\) === requete\)/,
    "une réponse qui ne porte plus sur ce qui est à l'écran ne redessine rien");
});

/* ---- 5. Ce que le lot ne devait pas toucher ---------------------------- */

test("la recherche d'adresse ne touche ni au scoring, ni à « Maintenant », ni à la carte", () => {
  /* On ne vérifie pas leur contenu ici — leurs propres tests s'en chargent.
     On vérifie que le premier contact ne s'est pas invité dedans. Les
     commentaires citent `AutourZones` pour dire qu'ils ne s'en servent PAS :
     on regarde donc le code, pas la prose. */
  const code = adresseSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const interdit of [/rankResults/, /POIDS/, /AutourMaintenant/, /statutTemps/,
                          /AutourZones/, /document\./, /\bmap\./, /L\.map/])
    assert.doesNotMatch(code, interdit, String(interdit) + " n'a rien à faire ici");
  /* Le seul point d'entrée réseau du module est la Base Adresse Nationale. */
  const hotes = code.match(/https?:\/\/[^"'\s]+/g) || [];
  assert.deepEqual(hotes, ["https://api-adresse.data.gouv.fr/search/"]);
});
