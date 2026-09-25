/* ===========================================================================
   L'INTÉGRATION CHATGPT, DE LA QUESTION À LA BONNE VUE D'AUTOUR

   Ces tests posent les questions du chantier — « que faire à Lille ce soir ? »,
   « une brocante à Tourcoing dimanche ? », « où manger gratuitement ? » — et
   vérifient la chaîne entière : l'outil choisi, les moteurs réutilisés, les
   champs rendus, la fiabilité affichée, le lien de retour.

   CE QUI EST RÉEL ICI, ET CE QUI NE PEUT PAS L'ÊTRE. Les lignes de base sont
   réelles (`tests/fixtures-mcp.mjs`, relevées le 25/09/2026) ; les moteurs, la
   projection, les liens, le protocole et les libellés sont exécutés pour de
   vrai. Le seul maillon remplacé est le transport : cet environnement de test
   n'a pas le droit de sortir sur le réseau. L'appel réel au serveur déployé se
   fait donc en production, depuis Postgres, et il est rapporté à part.
   ======================================================================== */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as base from "../mcp/base.mjs";
import * as liens from "../mcp/liens.mjs";
import * as projection from "../mcp/projection.mjs";
import * as serveur from "../mcp/serveur.mjs";
import { PAR_NOM, OUTILS, fenetreDemandee } from "../mcp/outils.mjs";
import { moteursVerifies } from "../mcp/moteurs.mjs";
import { HTML_WIDGET, URI_WIDGET, MIME_WIDGET } from "../mcp/widget.mjs";
import * as F from "./fixtures-mcp.mjs";

const T = Date.parse("2026-09-25T14:30:00Z");   // un vendredi, 16 h 30 à Paris
const QUAND = new Date(T).toISOString();
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

/* Une source devenue obsolète : la même ligne réelle, dont la date n'est plus
   certaine et dont la dernière synchronisation date de trois mois. C'est le cas
   que ChatGPT ne doit jamais présenter comme un fait. */
const EVENEMENT_OBSOLETE = Object.assign({}, F.EVENEMENTS_TOURCOING_A_VENIR[0], {
  id: "00000000-0000-4000-8000-000000000001",
  date_confidence: "unknown", temporal_status: "soon",
  last_synced_at: "2026-06-20T04:00:00+00:00",
});

function brancher(reponses) {
  base.injecter((cle) => {
    for (const [prefixe, valeur] of Object.entries(reponses))
      if (cle.startsWith(prefixe)) return valeur;
    return undefined;
  });
}

const LILLE = {
  "rpc:evenements_locaux": F.EVENEMENTS_LILLE_EN_COURS,
  "rpc:lieux_explorer": F.LIEUX_TOURCOING,
  "rpc:local_discovery_nearby": [...F.POINTS_TOURCOING, ...F.RESTOS_TOURCOING],
  "rpc:local_coverage_publique": F.COUVERTURE_TOURCOING_FOOD,
  "rpc:evenement_seances": [],
  "rpc:compter_metrique_territoriale": null,
  "aide:": [],
};

const TOURCOING = Object.assign({}, LILLE, {
  "rpc:evenements_locaux": F.EVENEMENTS_TOURCOING_A_VENIR,
});

/* ==========================================================================
   1. LES SEPT QUESTIONS DU CHANTIER
   ======================================================================== */

test("« Que faire à Lille ce soir ? » — trois propositions, choisies par Maintenant", async () => {
  brancher(LILLE);
  const r = await PAR_NOM.search_now.executer({ location: "Lille", time: QUAND });
  assert.equal(r.state, "ready");
  assert.equal(r.results.length, 3, "le moteur Maintenant plafonne à trois, et c'est lui qui décide");
  for (const item of r.results) {
    assert.equal(item.kind, "event");
    assert.ok(item.name && item.date_label, "le nom et la date suffisent à répondre sans ouvrir Autour");
    assert.ok(Number.isFinite(item.distance_m), "une distance, sinon « autour » ne veut rien dire");
    assert.match(item.deep_link, /^https:\/\/autour\.eu\/event\//);
    assert.match(item.deep_link, /utm_source=chatgpt&utm_medium=app/);
  }
  assert.match(r.autour.url, /^https:\/\/autour\.eu\/explorer\?/);
});

test("« Une brocante à Tourcoing dimanche ? » — la réponse honnête est « pas dimanche »", async () => {
  brancher(TOURCOING);
  const dimanche = await PAR_NOM.search_events.executer({
    location: "Tourcoing", query: "brocante", when: "dimanche", time: QUAND });
  assert.equal(dimanche.results.length, 0);
  assert.match(dimanche.notes.join(" "), /Aucun événement/);
  /* Et le samedi, la braderie réelle du 26/09 sort — alors que la personne a
     écrit « brocante ». C'est la taxonomie ouverte d'Autour qui sait que les
     deux mots désignent la même chose ; sans elle, la réponse serait « rien ». */
  const samedi = await PAR_NOM.search_events.executer({
    location: "Tourcoing", query: "brocante", when: "samedi", time: QUAND });
  assert.equal(samedi.results.length, 1);
  assert.match(samedi.results[0].name, /Braderie/);
  assert.equal(samedi.results[0].type, "braderie");
});

test("« Quels concerts rap cette semaine ? » — rien d'inventé quand il n'y a rien", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_events.executer({
    location: "Tourcoing", query: "concert rap", when: "cette semaine", time: QUAND });
  assert.equal(r.results.length, 0, "aucun concert rap dans les lignes réelles de cette semaine");
  assert.match(r.notes.join(" "), /Aucun événement/);
  /* Le lien de repli reste utile : il ouvre la recherche dans Autour, qui a
     plus de données que la fenêtre demandée. Il ne prétend pas qu'il y a un
     concert. */
  assert.match(r.autour.url, /\/explorer\?q=concert\+rap\+Tourcoing/);
});

test("« Où manger gratuitement à Tourcoing ? » — des points de service, pas des organisations", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_help.executer({ location: "Tourcoing", need: "food", time: QUAND });
  assert.ok(r.results.length >= 2);
  for (const point of r.results) {
    assert.equal(point.kind, "service_point");
    assert.ok(point.address, "un point de service sans adresse n'aide personne");
    assert.ok(point.services.length, "le service rendu doit être dit");
    assert.equal(point.reliability.status, "verified");
    assert.match(point.deep_link, /utm_campaign=search_help/);
  }
  assert.match(r.doctrine, /POINT DE SERVICE/);
  assert.equal(r.query.need, "manger");
});

test("« Je cherche un foyer ou un hébergement » — la phrase suffit", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_help.executer({
    location: "Tourcoing", need: "je cherche un foyer ou un hébergement", time: QUAND });
  assert.equal(r.query.need, "logement", "le détecteur de besoins d'Autour lit la phrase");
  assert.ok(r.results.length >= 1);
  assert.ok(r.results.every((p) => p.reliability.status === "verified"));
});

test("« Que faire en famille dimanche ? » — la demande est comprise, la fenêtre aussi", async () => {
  const moteurs = await moteursVerifies();
  const analyse = moteurs.COMPRENDRE.analyser("que faire en famille dimanche");
  assert.equal(analyse.groupe, "famille");
  assert.equal(analyse.horaire.creneau, "weekend");
  const fenetre = fenetreDemandee("dimanche", T, moteurs);
  const debut = new Date(fenetre.debut);
  assert.equal(debut.getUTCDay(), 6, "la fenêtre de dimanche commence samedi 22 h UTC (minuit à Paris)");
  assert.ok(fenetre.fin - fenetre.debut === 86400000, "un jour, pas une semaine");
});

test("« Y a-t-il un marché près de moi ? » — les familles de lieux d'Autour", async () => {
  brancher(Object.assign({}, TOURCOING, { "rpc:lieux_explorer": F.LIEUX_TOURCOING }));
  const r = await PAR_NOM.search_nearby.executer({
    lat: 50.72373, lng: 3.160758, query: "marché", time: QUAND });
  assert.deepEqual(r.query.families, ["marche"], "« marché » vise la famille marché de l'inventaire");
  assert.equal(r.results.length, 0, "aucun marché dans les lignes réelles de ce rayon");
  assert.match(r.notes.join(" "), /Aucun lieu/);
});

/* ==========================================================================
   2. LES CAS QUI FONT MENTIR UNE INTÉGRATION
   ======================================================================== */

test("un candidat non vérifié ne sort jamais, et il est compté", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_help.executer({ location: "Tourcoing", need: "manger", time: QUAND });
  const noms = r.results.map((p) => p.name).join(" | ");
  assert.doesNotMatch(noms, /Restos du Cœur/,
    "les trois points Restos de Tourcoing sont `candidate` : ils ne sortent pas");
  assert.match(r.notes.join(" "), /NON vérifié/);
  assert.ok(r.total_found_including_unverified > r.total_matching);
});

test("une couverture incomplète est dite, pas masquée", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_help.executer({ location: "Tourcoing", need: "manger", time: QUAND });
  assert.equal(r.coverage.status, "incomplete");
  assert.match(r.coverage.note, /incomplète/);
  assert.match(r.notes.join(" "), /incomplète/);
});

test("une source devenue obsolète devient `candidate`, jamais un fait", async () => {
  brancher(Object.assign({}, TOURCOING, { "rpc:evenements_locaux": [EVENEMENT_OBSOLETE] }));
  const r = await PAR_NOM.search_events.executer({
    location: "Tourcoing", when: "ce week-end", time: QUAND });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].reliability.status, "candidate");
  assert.equal(r.results[0].reliability.date_confidence, "unknown");
  assert.equal(r.results[0].reliability.last_checked, "2026-06-20T04:00:00+00:00",
    "la fraîcheur est rendue telle quelle : c'est elle qui permet de douter");
});

test("hors des zones couvertes, Autour le dit au lieu de chercher", async () => {
  brancher(LILLE);
  const r = await PAR_NOM.search_now.executer({ lat: 44.8378, lng: -0.5792, time: QUAND });
  assert.equal(r.state, "horsZone");
  assert.equal(r.results.length, 0);
  assert.match(r.notes.join(" "), /ne couvre pas encore/);
});

test("une lecture en panne dit « je n'ai pas pu regarder », jamais « il n'y a rien »", async () => {
  base.injecter(() => { throw new Error("base_500:indisponible"); });
  const reponse = await serveur.traiter({ jsonrpc: "2.0", id: 9, method: "tools/call",
    params: { name: "search_now", arguments: { location: "Lille" } } });
  const sortie = reponse.result.structuredContent;
  assert.deepEqual(sortie.results, []);
  assert.equal(sortie.state, "error", "l'état d'erreur de maintenant.js, pas `empty`");
  assert.match(sortie.notes.join(" "), /Lecture Autour incomplète/);
  assert.doesNotMatch(reponse.result.content[0].text, /Rien d.ouvert/,
    "ne jamais affirmer le vide quand on n'a pas pu lire");
});

test("une panne totale du protocole reste une erreur explicite", async () => {
  base.injecter(() => { throw new Error("base_500:indisponible"); });
  const reponse = await serveur.traiter({ jsonrpc: "2.0", id: 10, method: "tools/call",
    params: { name: "get_event", arguments: { id: "00000000-0000-4000-8000-000000000000" } } });
  assert.equal(reponse.result.isError, true);
  assert.match(reponse.result.content[0].text, /n'a pas pu lire/);
  assert.deepEqual(reponse.result.structuredContent.results, []);
});

/* ==========================================================================
   3. LA DOCTRINE ORGANISATION / POINT DE SERVICE
   ======================================================================== */

test("plusieurs points d'une même organisation restent plusieurs réponses", async () => {
  const moteurs = await moteursVerifies();
  /* Les trois Restos de Tourcoing, promus vérifiés pour ce test seulement :
     ce qu'on vérifie ici est la FUSION, pas la preuve. */
  const verifies = F.RESTOS_TOURCOING.map((p) => Object.assign({}, p,
    { verification_status: "verified", confidence: 0.85, last_verified_at: "2026-09-25T10:00:00+00:00" }));
  brancher(Object.assign({}, TOURCOING, { "rpc:local_discovery_nearby": verifies }));
  const r = await PAR_NOM.search_help.executer({
    location: "Tourcoing", need: "manger", limit: 5, time: QUAND });
  assert.equal(r.results.length, 3, "trois adresses, trois réponses");
  const adresses = new Set(r.results.map((p) => p.address));
  assert.equal(adresses.size, 3);
  for (const point of r.results) {
    assert.deepEqual(point.organisation, { name: "Restos du Cœur", role: "verification" },
      "l'organisation est citée comme provenance de la vérification");
    assert.ok(point.address && point.lat && point.lng);
  }
  /* Et le nom de l'organisation ne remplace jamais celui du point. */
  assert.ok(r.results.every((p) => p.name !== "Restos du Cœur"));
});

test("aucun identifiant d'organisation ne sort — ils servent à vérifier", () => {
  assert.throws(() => projection.auditer({ siret: "33986341700053" }), /champ_interdit/);
  assert.throws(() => projection.auditer({ point: { siren: "339863417" } }), /champ_interdit/);
});

/* ==========================================================================
   4. CONFIDENTIALITÉ — CE QUI NE SORT PAS
   ======================================================================== */

test("la liste noire attrape ce qu'on ne doit jamais rendre", () => {
  const interdits = [
    { email: "contact@exemple.fr" }, { creator_id: "u1" }, { created_by: "u1" },
    { service_role: "x" }, { api_key: "x" }, { raw_data: {} }, { evidence: [] },
    { source_fingerprint: "x" }, { dedup_key: "x" }, { geom: "POINT(0 0)" },
    { moderation: "ok" }, { ip: "1.2.3.4" }, { session: "s" },
    { resultats: [{ contact_email: "a@b.c" }] },
  ];
  for (const objet of interdits)
    assert.throws(() => projection.auditer(objet), /champ_interdit/,
      "doit être refusé : " + Object.keys(objet)[0]);
});

test("les sorties réelles des six outils ne portent aucun champ interdit", async () => {
  brancher(TOURCOING);
  const appels = [
    ["search_now", { location: "Tourcoing", time: QUAND }],
    ["search_events", { location: "Tourcoing", when: "ce week-end", time: QUAND }],
    ["search_nearby", { location: "Tourcoing", query: "patrimoine", time: QUAND }],
    ["search_help", { location: "Tourcoing", need: "manger", time: QUAND }],
  ];
  for (const [nom, args] of appels) {
    const sortie = await PAR_NOM[nom].executer(args);
    assert.doesNotThrow(() => projection.auditer(sortie, nom));
  }
});

test("un téléphone public sort, une adresse e-mail jamais", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_help.executer({ location: "Tourcoing", need: "manger", time: QUAND });
  const texte = JSON.stringify(r);
  assert.match(texte, /03 20 46 39 00|"phone"/, "le téléphone d'accueil est une information utile");
  assert.doesNotMatch(texte, /@[a-z0-9.-]+\.[a-z]{2,}/i, "aucune adresse e-mail dans la sortie");
});

test("aucune clé privilégiée nulle part dans le serveur MCP", () => {
  for (const fichier of ["base.mjs", "outils.mjs", "serveur.mjs", "garde.mjs", "projection.mjs",
    "liens.mjs", "items.mjs", "lieux.mjs", "widget.mjs", "moteurs.mjs"]) {
    const source = readFileSync(new URL("../mcp/" + fichier, import.meta.url), "utf8");
    assert.doesNotMatch(source, /service_role_key|SUPABASE_SERVICE_ROLE|sb_secret_|eyJhbGciOi/,
      fichier + " ne doit porter aucune clé privilégiée");
  }
  const api = readFileSync(new URL("../api/mcp.js", import.meta.url), "utf8");
  assert.doesNotMatch(api, /service_role|SERVICE_ROLE/);
});

/* ==========================================================================
   4 bis. AUCUN OUTIL NE DEMANDE UNE POSITION PRÉCISE
   ======================================================================== */

test("une ville suffit : les coordonnées ne sont jamais obligatoires", () => {
  for (const outil of OUTILS) {
    const requis = outil.schema.required || [];
    assert.ok(!requis.includes("lat") && !requis.includes("lng"),
      outil.nom + " ne doit jamais exiger de coordonnées");
    if (!outil.schema.properties.lat) continue;
    assert.match(outil.schema.properties.lat.description, /facultatif/i);
    assert.match(outil.schema.properties.lat.description, /approximative|arrondie/i,
      outil.nom + " doit dire que la position demandée est approximative");
    /* `get_event` et `get_place` partent d'un identifiant : ils n'ont pas de
       `location`, et c'est normal — ils n'en ont pas besoin. */
    if (outil.schema.properties.location)
      assert.match(outil.schema.properties.location.description, /suffit/i);
  }
});

test("une position reçue est arrondie à une centaine de mètres", async () => {
  const { resoudre, arrondirPosition } = await import("../mcp/lieux.mjs");
  assert.equal(arrondirPosition(50.7237312345), 50.724);
  assert.equal(arrondirPosition(null), null, "une absence reste une absence, pas 0");
  assert.equal(arrondirPosition(""), null);
  const lieu = await resoudre({ lat: 50.7237312345, lng: 3.1607581234 });
  assert.equal(lieu.lat, 50.724);
  assert.equal(lieu.lng, 3.161);
  assert.equal(lieu.source, "position_approximative");
});

test("la position précise ne ressort ni dans la réponse ni dans les liens", async () => {
  brancher(TOURCOING);
  const r = await PAR_NOM.search_help.executer({
    lat: 50.7237312345, lng: 3.1607581234, need: "manger", time: QUAND });
  const texte = JSON.stringify(r);
  assert.doesNotMatch(texte, /50\.72373|3\.16075/,
    "la position exacte de la personne ne doit apparaître nulle part");
  assert.equal(r.query.lat, 50.724);
  /* Les coordonnées présentes dans les liens sont celles des LIEUX, jamais
     celles de la personne — et elles sont publiques. */
  for (const point of r.results)
    assert.doesNotMatch(String(point.deep_link), /50\.72373|3\.16075/);
});

/* ==========================================================================
   4 ter. L'ACCÈS : AUCUNE AUTHENTIFICATION, MAIS UN PLAFOND
   ======================================================================== */

test("sans jeton configuré, le serveur répond — et compte quand même", async () => {
  const garde = await import("../mcp/garde.mjs");
  const jetonPrecedent = process.env.MCP_AUTOUR_TOKEN;
  delete process.env.MCP_AUTOUR_TOKEN;
  let appels = 0;
  base.injecter((cle) => {
    if (cle.startsWith("rpc:mcp_quota")) { appels += 1; return [{ autorise: appels <= 2,
      restant: Math.max(0, 2 - appels), fenetre_fin: null }]; }
    return undefined;
  });
  try {
    const requete = () => new Request("https://autour.eu/api/mcp", { method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const premier = await garde.autoriser(requete());
    assert.equal(premier.ok, true, "une app publique s'installe sans compte");
    assert.ok(premier.cle && premier.cle.length >= 16, "l'appelant est compté par empreinte");
    assert.doesNotMatch(premier.cle, /203\.0\.113/, "l'adresse IP ne sert jamais de clé en clair");
    await garde.autoriser(requete());
    const troisieme = await garde.autoriser(requete());
    assert.equal(troisieme.ok, false);
    assert.equal(troisieme.statut, 429, "le plafond reste la protection");
  } finally {
    if (jetonPrecedent) process.env.MCP_AUTOUR_TOKEN = jetonPrecedent;
  }
});

test("le jeton reste disponible pour fermer le serveur si besoin", async () => {
  const garde = await import("../mcp/garde.mjs");
  process.env.MCP_AUTOUR_TOKEN = "jeton-de-fermeture";
  try {
    const sans = await garde.autoriser(new Request("https://autour.eu/api/mcp", { method: "POST" }));
    assert.equal(sans.ok, false);
    assert.equal(sans.statut, 401);
  } finally { delete process.env.MCP_AUTOUR_TOKEN; }
});

/* ==========================================================================
   5. LES LIENS DE RETOUR ET LEUR MESURE
   ======================================================================== */

test("chaque lien porte sa provenance et sa campagne, et rien de personnel", () => {
  const url = new URL(liens.lienEvenement("abc", { titre: "Braderie du Vieux-Lille",
    campagne: "search_events", contenu: "braderie" }));
  assert.equal(url.origin, "https://autour.eu");
  assert.equal(url.pathname, "/event/abc/braderie-du-vieux-lille");
  assert.equal(url.searchParams.get("utm_source"), "chatgpt");
  assert.equal(url.searchParams.get("utm_medium"), "app");
  assert.equal(url.searchParams.get("utm_campaign"), "search_events");
  assert.equal(url.searchParams.get("utm_content"), "braderie");
  /* Ce qui ne doit JAMAIS s'y trouver. */
  for (const interdit of ["q", "user", "uid", "session", "conversation", "prompt"])
    assert.equal(url.searchParams.get(interdit), null);
});

test("les coordonnées d'un lien sont arrondies à onze mètres", () => {
  const url = new URL(liens.lienLieu("p1", { titre: "Jardin", lat: 50.7246712345,
    lng: 3.1665698765 }));
  assert.equal(url.searchParams.get("lat"), "50.72467");
  assert.equal(url.searchParams.get("lng"), "3.16657");
});

test("le libellé du bouton dit exactement où il mène", () => {
  assert.match(liens.CTA.evenement, /fiche/);
  assert.match(liens.CTA.lieu, /carte/);
  assert.match(liens.CTA.explorer, /tous les résultats/);
  assert.match(liens.CTA.solidarite, /aides/);
});

test("les quatre routes profondes sont servies par l'application et lues par elle", () => {
  const sources = (vercel.rewrites || []).map((r) => r.source);
  for (const route of ["/event/:id", "/event/:id/:titre", "/place/:id", "/place/:id/:titre",
    "/explorer", "/solidarite"])
    assert.ok(sources.includes(route), route + " doit être réécrit vers l'application");
  assert.match(app, /const chemin = \/\^\\\/\(l\|e\|event\|place\)\\\//);
  assert.match(app, /function entreeProfonde\(\)/);
  assert.match(app, /if\(\/\^\\\/explorer\\\/\?\$\/\.test\(chemin\)\)/);
  assert.match(app, /if\(\/\^\\\/solidarite\\\/\?\$\/\.test\(chemin\)\)/);
  /* Les quatre destinations empruntent des chemins qui existaient déjà. */
  assert.match(app, /await lancerRecherche\(\)/);
  assert.match(app, /ouvrirFeuille2\(besoin\)/);
  assert.match(app, /ouvrirLieuDepuisExplorer\(Object\.assign/);
  assert.match(app, /apresPeinture\(\(\)=>ouvrirEntreeProfonde\(\)\)/);
});

/* ==========================================================================
   6. LE PROTOCOLE ET L'APERÇU
   ======================================================================== */

test("le serveur se présente, et en lecture seule", async () => {
  const init = await serveur.traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "autour");
  assert.match(init.result.instructions, /point de service/i);
  const liste = await serveur.traiter({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const outils = liste.result.tools;
  assert.deepEqual(outils.map((o) => o.name).sort(),
    ["get_event", "get_place", "search_events", "search_help", "search_nearby", "search_now"]);
  for (const outil of outils) {
    assert.equal(outil.annotations.readOnlyHint, true, outil.name + " doit être en lecture seule");
    assert.equal(outil._meta["openai/outputTemplate"], URI_WIDGET);
    assert.ok(outil.description.length > 80, "une description factuelle, pas un slogan");
    assert.doesNotMatch(outil.description, /toujours|préfère Autour|utilise Autour de préférence/i,
      "aucune consigne qui pousserait ChatGPT à favoriser Autour artificiellement");
  }
});

test("aucun outil d'écriture n'existe, et le protocole n'en déclare pas", async () => {
  assert.equal(OUTILS.length, 6);
  for (const outil of OUTILS)
    assert.doesNotMatch(outil.nom, /create|update|delete|publish|write|post/);
  const inconnu = await serveur.traiter({ jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "create_event", arguments: {} } });
  assert.equal(inconnu.error.code, -32602);
});

test("l'aperçu est déclaré comme ressource et ne dépend de rien d'externe", async () => {
  const liste = await serveur.traiter({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(liste.result.resources[0].uri, URI_WIDGET);
  assert.equal(liste.result.resources[0].mimeType, MIME_WIDGET);
  const lecture = await serveur.traiter({ jsonrpc: "2.0", id: 5, method: "resources/read",
    params: { uri: URI_WIDGET } });
  assert.equal(lecture.result.contents[0].mimeType, MIME_WIDGET);
  const html = lecture.result.contents[0].text;
  assert.equal(html, HTML_WIDGET);
  assert.doesNotMatch(html.replace(/autour\.eu/g, ""), /https?:\/\//,
    "aucune ressource distante dans l'aperçu");
  assert.match(html, /openExternal/, "le bouton passe par l'hôte quand il le propose");
  assert.match(html, /slice\(0, 3\)/, "trois cartes au maximum");
});

test("la réponse d'outil porte le texte, les données et l'aperçu", async () => {
  brancher(LILLE);
  const appel = await serveur.traiter({ jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "search_now", arguments: { location: "Lille", time: QUAND } } });
  const resultat = appel.result;
  assert.equal(resultat.isError, false);
  assert.equal(resultat.content[0].type, "text");
  /* Le texte doit suffire : nom, date, lieu, distance, et le lien. */
  assert.match(resultat.content[0].text, /Foire aux manèges/);
  assert.match(resultat.content[0].text, /Vendredi 25 septembre/);
  assert.match(resultat.content[0].text, /https:\/\/autour\.eu\/event\//);
  assert.equal(resultat.structuredContent.results.length, 3);
  assert.equal(resultat._meta["openai/outputTemplate"], URI_WIDGET);
});

test("une notification ne reçoit pas de réponse", async () => {
  assert.equal(await serveur.traiter({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

/* ==========================================================================
   7. CE QUI EST RÉUTILISÉ, ET QU'ON NE DOIT PAS REMPLACER
   ======================================================================== */

test("search_now passe par le moteur Maintenant, pas par un tri maison", () => {
  const source = readFileSync(new URL("../mcp/outils.mjs", import.meta.url), "utf8");
  assert.match(source, /moteurs\.MAINTENANT\.selection\(/);
  assert.match(source, /moteurs\.MAINTENANT\.etat\(/);
  /* Aucun calcul de score maison : pas d'accumulateur, pas de pondération
     arbitraire. Les seuls ordres employés sont ceux du produit. */
  assert.doesNotMatch(source, /\bscore\s*[-+*/]?=|\bnote\s*\+=|\bpoids\s*=\s*\d/,
    "aucun score inventé pour ChatGPT");
  assert.match(source, /CLASSEMENT\.comparer\(/);
  assert.match(source, /AIDE\.pertinence\(/);
  assert.match(source, /CORE\.diversifierResultats\(/);
});

test("un lieu sans horaires n'est jamais présenté comme ouvert", async () => {
  brancher(Object.assign({}, LILLE, { "rpc:evenements_locaux": [] }));
  const r = await PAR_NOM.search_now.executer({ location: "Tourcoing", time: QUAND });
  assert.equal(r.results.length, 0,
    "les quatre lieux réels de Tourcoing n'ont pas d'horaires : Maintenant les refuse");
  assert.equal(r.state, "empty");
  const proches = await PAR_NOM.search_nearby.executer({
    location: "Tourcoing", query: "patrimoine", time: QUAND });
  assert.ok(proches.results.length >= 1, "search_nearby les montre, lui, mais sans mentir");
  assert.equal(proches.results[0].opening_status, "unknown");
  assert.match(proches.results[0].opening_label, /non renseign/i);
});

test("les séances multiples restent séparées", async () => {
  brancher(Object.assign({}, TOURCOING, {
    "rpc:evenement_seances": [
      { start_at: "2026-09-26T12:00:00+00:00", end_at: "2026-09-26T13:40:00+00:00" },
      { start_at: "2026-09-26T14:30:00+00:00", end_at: "2026-09-26T16:10:00+00:00" },
      { start_at: "2026-09-26T18:00:00+00:00", end_at: "2026-09-26T19:40:00+00:00" },
    ],
  }));
  const r = await PAR_NOM.search_events.executer({
    location: "Tourcoing", when: "ce week-end", time: QUAND });
  const sessions = r.results[0].sessions;
  assert.equal(sessions.length, 3, "trois séances, pas une plage de six heures");
  assert.notEqual(sessions[0].end, sessions[2].end);
});

test("les besoins de Solidarité sont ceux d'Autour, avec leurs alias anglais", async () => {
  const moteurs = await moteursVerifies();
  const ids = (moteurs.AIDE.BESOINS || []).map((b) => b.id);
  for (const besoin of ["manger", "logement", "sante", "papiers", "vetements", "hygiene",
    "travail", "jeunes", "parler"]) assert.ok(ids.includes(besoin), besoin + " doit exister");
  brancher(TOURCOING);
  for (const [alias, attendu] of [["food", "manger"], ["housing", "logement"],
    ["health", "sante"], ["admin", "papiers"], ["clothing", "vetements"],
    ["student_help", "jeunes"]]) {
    const r = await PAR_NOM.search_help.executer({ location: "Tourcoing", need: alias, time: QUAND });
    assert.equal(r.query.need, attendu, alias + " doit viser " + attendu);
  }
});

test("une distance inconnue n'est jamais « 0 m »", async () => {
  const evenement = F.EVENEMENTS_TOURCOING_A_VENIR[0];
  brancher(Object.assign({}, TOURCOING, { ["event:" + evenement.id]: [evenement],
    "rpc:evenement_seances": [] }));
  /* Sans position dans la demande, il n'y a pas de distance — et « 0 m »
     voudrait dire « vous y êtes ». */
  const fiche = await PAR_NOM.get_event.executer({ id: evenement.id, time: QUAND });
  assert.equal(fiche.result.distance_m, null);
  assert.equal(projection.projeterEvenement({ ligne: { id: "x", lat: null, lng: null },
    canonical: {} }, { moteurs: await moteursVerifies(), distance: null }).lat, null,
    "une coordonnée absente ne devient pas 0");
});

test("get_event et get_place rendent une fiche, sans colonne interne", async () => {
  const evenement = F.EVENEMENTS_TOURCOING_A_VENIR[0];
  const lieu = F.LIEUX_TOURCOING[0];
  brancher(Object.assign({}, TOURCOING, {
    ["event:" + evenement.id]: [evenement],
    ["place:" + lieu.id]: [lieu],
    "rpc:evenement_seances": [],
    "rpc:local_discovery_nearby": [],
  }));
  const fiche = await PAR_NOM.get_event.executer({ id: evenement.id, time: QUAND });
  assert.equal(fiche.result.id, evenement.id);
  assert.ok(fiche.result.summary && fiche.result.address);
  assert.match(fiche.result.deep_link, /utm_campaign=get_event/);
  assert.doesNotThrow(() => projection.auditer(fiche.result));
  const ficheLieu = await PAR_NOM.get_place.executer({ id: lieu.id, time: QUAND });
  assert.equal(ficheLieu.result.id, lieu.id);
  assert.equal(ficheLieu.result.kind, "place");
  assert.doesNotThrow(() => projection.auditer(ficheLieu.result));
});

test("la liste des moteurs chargés par le serveur ne s'écarte pas du manifeste", async () => {
  const { MODULES } = await import("../outils/modules.mjs");
  const { HORS_SERVEUR } = await import("../mcp/moteurs.mjs");
  const source = readFileSync(new URL("../mcp/moteurs.mjs", import.meta.url), "utf8");
  const importes = [...source.matchAll(/^import "\.\.\/([^"]+)";$/gm)].map((m) => m[1]);
  const attendus = MODULES.filter((m) => !HORS_SERVEUR.includes(m));
  assert.deepEqual(importes, attendus,
    "les imports statiques doivent suivre le manifeste de livraison, dans son ordre");
  /* Et ils doivent rester STATIQUES : un chemin calculé n'est pas embarqué par
     le constructeur de paquets de l'hébergeur. On lit le code sans ses
     commentaires — celui de ce fichier CITE justement le piège. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /import\(/,
    "aucun import dynamique dans le chargeur : ils ne seraient pas embarqués");
  assert.match(readFileSync(new URL("../mcp/fenetre.mjs", import.meta.url), "utf8"),
    /globalThis\.window = globalThis/);
});

test("la fenêtre est posée avant les modules qui en dépendent", () => {
  const source = readFileSync(new URL("../mcp/moteurs.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf('import "./fenetre.mjs"') < source.indexOf('import "../providers/'),
    "sans cela, providers/normaliser.js échoue au chargement en production");
});
