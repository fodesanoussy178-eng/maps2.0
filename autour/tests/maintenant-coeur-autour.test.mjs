/* ---------------------------------------------------------------------------
   MAINTENANT, LE CŒUR D'AUTOUR

   On ouvre Autour : trois propositions, un cœur sur chacune, une croix pour
   rendre la carte. Dessous, six envies pour aller plus loin sans changer de
   question, puis la frise — À venir, Ce week-end.

   Ces tests gardent quatre promesses :
     1. les envies relisent LE MÊME bassin que les trois places — un lieu
        fermé ou un événement de demain n'y entre pas davantage ;
     2. les mesures comptent des créneaux, jamais des personnes, et ne partent
        nulle part ;
     3. aucune donnée commerciale ne peut toucher la sélection organique ;
     4. l'interface ne dit « Maintenant » qu'une fois, et se referme pour de bon.
--------------------------------------------------------------------------- */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../maintenant.js";

const M = globalThis.AutourMaintenant;
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../autour.css", import.meta.url), "utf8");
const confidentialite = readFileSync(new URL("../confidentialite.html", import.meta.url), "utf8");

/* Vendredi 14 août 2026, 22 h à Paris. */
const T = Date.UTC(2026, 7, 14, 20, 0, 0);
const ICI = [50.6292, 3.0573];
const h = (n) => n * 3600e3;

const evenement = (id, extra) => Object.assign({
  id, estEvenement: true, annule: false,
  titre: "Concert " + id, title: "Concert " + id, categorie: "concert",
  entity_type: "event", canonical_id: id,
  canonical: { entity_type: "event", id, title: "Concert " + id, category: "concert" },
  tempsValide: true, enCours: true, dateIncertaine: false,
  debutLe: T - h(1), finLe: T + h(1),
  lat: 50.6312, lng: 3.0573, ferme: false,
}, extra || {});

const lieu = (id, categorie, extra) => Object.assign({
  id, estEvenement: false, annule: false,
  titre: "Lieu " + id, title: "Lieu " + id, categorie,
  entity_type: "place", canonical_id: id,
  canonical: { entity_type: "place", id, title: "Lieu " + id, category: categorie },
  tempsValide: true, ferme: false, current_status: "open",
  lat: 50.6302, lng: 3.0573,
}, extra || {});

const ctx = (extra) => Object.assign({
  maintenant: T, position: ICI, positionConnue: true,
  positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false,
}, extra || {});

const ids = (liste) => liste.map((x) => x.id).sort();

const MONDE = [
  evenement("concert"),
  evenement("demain", { enCours: false, debutLe: T + h(20), finLe: T + h(23) }),
  lieu("resto", "resto"),
  lieu("resto-ferme", "resto", { current_status: "closed", ferme: true, tempsValide: false }),
  lieu("musee", "musee"),
  lieu("cinema", "cinema"),
  lieu("parc", "parc"),
  lieu("piscine", "piscine"),
  lieu("bar-gratuit", "bar", { gratuit: true }),
  lieu("supermarche", "commerce"),
];

/* ==========================================================================
   1. LES ENVIES : LE MÊME BASSIN, UN FILTRE DE PLUS
   ======================================================================== */

test("six envies, dans l'ordre de la référence", () => {
  assert.deepEqual(M.CATEGORIES_EXPLORATION.map((c) => c.id),
    ["sortir", "manger", "culture", "sport", "nature", "gratuit"]);
  for (const c of M.CATEGORIES_EXPLORATION) {
    assert.ok(c.emoji && c.label, c.id);
    assert.ok(Object.isFrozen(c));
  }
});

test("chaque envie ne rend que ce qui est faisable maintenant", () => {
  assert.deepEqual(ids(M.explorerCategorie(MONDE, ctx(), "manger")), ["resto"],
    "le restaurant fermé n'entre pas, même dans « Manger »");
  assert.deepEqual(ids(M.explorerCategorie(MONDE, ctx(), "sortir")), ["bar-gratuit", "cinema", "concert"],
    "le concert de demain n'est jamais « maintenant »");
  assert.deepEqual(ids(M.explorerCategorie(MONDE, ctx(), "culture")), ["cinema", "musee"]);
  assert.deepEqual(ids(M.explorerCategorie(MONDE, ctx(), "sport")), ["piscine"]);
  assert.deepEqual(ids(M.explorerCategorie(MONDE, ctx(), "nature")), ["parc"]);
});

test("Gratuit ne se devine pas : la source l'a écrit, ou c'est un parc", () => {
  assert.deepEqual(ids(M.explorerCategorie(MONDE, ctx(), "gratuit")), ["bar-gratuit", "parc"]);
});

test("une commodité ouverte n'est une envie pour personne", () => {
  for (const c of M.CATEGORIES_EXPLORATION)
    assert.ok(!ids(M.explorerCategorie(MONDE, ctx(), c.id)).includes("supermarche"), c.id);
});

test("une envie inconnue, une position inconnue ou un hors-zone ne rendent rien", () => {
  assert.deepEqual(M.explorerCategorie(MONDE, ctx(), "shopping"), []);
  assert.deepEqual(M.explorerCategorie(MONDE, ctx({ positionConnue: false }), "manger"), []);
  assert.deepEqual(M.explorerCategorie(MONDE, ctx({ zoneTerritoriale: false }), "manger"), []);
});

test("l'ordre d'une envie reste celui de la vitrine : ce qui se passe d'abord", () => {
  const sortir = M.explorerCategorie(MONDE, ctx(), "sortir");
  assert.equal(sortir[0].id, "concert");
  assert.equal(sortir[0].nature, M.NATURES.EVENEMENT);
  assert.match(sortir[0].motifMaintenant, /^categorie_sortir$/);
});

/* ==========================================================================
   2. LES MESURES : UN CRÉNEAU, JAMAIS UNE PERSONNE
   ======================================================================== */

test("la liste des gestes comptés est fermée", () => {
  for (const nom of ["impression", "detail", "favori_intention", "favori_ajout", "favori_retrait", "itineraire",
    "billetterie", "reservation", "contact", "ignoree", "fermeture", "categorie"])
    assert.ok(M.MESURES.includes(nom), nom);
  assert.ok(Object.isFrozen(M.MESURES));
});

test("le grain d'une mesure est zone × envie × jour × heure", () => {
  const c = M.creneauMesure({ maintenant: T, timeZone: "Europe/Paris", zone: "lille-centre" }, "sortir");
  assert.deepEqual(c, { zone: "lille-centre", famille: "sortir", date: "2026-08-14",
    jour: "ven", tranche: "22-23" });
  // aucune position, aucun identifiant : le créneau ne sait rien d'autre
  assert.deepEqual(Object.keys(c).sort(), ["date", "famille", "jour", "tranche", "zone"]);
});

test("la tranche d'avant minuit ne déborde pas sur 24", () => {
  const c = M.creneauMesure({ maintenant: Date.UTC(2026, 7, 14, 22, 30), timeZone: "Europe/Paris" });
  assert.equal(c.tranche, "00-01");
  assert.equal(c.jour, "sam");
  assert.equal(c.zone, "sans-zone");
});

test("le journal reste local, agrégé, et s'oublie", () => {
  const bloc = app.slice(app.indexOf("const CLE_MESURES_MAINTENANT"),
    app.indexOf("/* ---- Ce que dit l'en-tête de Maintenant"));
  assert.match(bloc, /localStorage\.setItem\(CLE_MESURES_MAINTENANT/);
  assert.match(bloc, /const MESURES_RETENTION_J = 30;/);
  assert.doesNotMatch(bloc, /fetch\(|\.rpc\(|sendBeacon|XMLHttpRequest/,
    "rien ne part sur le réseau");
  assert.doesNotMatch(bloc, /positionMoi|pointDeReference|moiId/,
    "aucune position, aucune personne dans la clé");
  // l'objet entre dans la clé par son identifiant, jamais par son titre
  assert.match(bloc, /const cle = \[nom, c\.zone, c\.famille, c\.date, c\.jour, c\.tranche, objet\]\.join\("\|"\);/);
  assert.doesNotMatch(bloc, /\.titre|\.title|textContent\.trim\(\) !==/,
    "aucune attribution par titre");
  // une impression par proposition et par session, pas une par rendu
  assert.match(bloc, /if\(impressionsSession\.has\(id\)\) return;/);
  // la page de confidentialité le dit
  assert.match(confidentialite, /compteurs de gestes de Maintenant/);
});

/* ==========================================================================
   3. LA PERTINENCE D'ABORD — AUCUNE DONNÉE COMMERCIALE N'Y ENTRE
   ======================================================================== */

test("la sélection est aveugle à toute donnée commerciale", () => {
  const organique = M.selection(MONDE, ctx());
  const achetee = M.selection(MONDE, ctx({
    sponsor: "resto-ferme", sponsors: ["resto-ferme", "supermarche"], campagne: "c1",
    campaign_id: "c1", enchere: 1e6, current_price: 1e6, sponsor_candidate: true,
  }));
  assert.deepEqual(achetee.map((x) => x.id), organique.map((x) => x.id));
  assert.ok(organique.length <= M.PLACES);
  // et le moteur ne lit ces mots nulle part
  const source = readFileSync(new URL("../maintenant.js", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /sponsor|campagne|campaign|enchere|current_price/i);
});

/* ==========================================================================
   4. L'INTERFACE : UNE HIÉRARCHIE, UN CŒUR, UNE CROIX
   ======================================================================== */

test("seul un vrai favori est épinglé — pas tout ce qui a été affiché", () => {
  const bloc = /function favorisVerrouilles\(\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /favorisIds\.has\(cle\)/);
});

test("chaque proposition a son cœur, à côté du bouton qui l'ouvre — jamais dedans", () => {
  const ligne = /function ligneMaintenant\(l\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(ligne, /<article class="mn-l" data-mn-carte="/);
  assert.match(ligne, /<button class="mn-ouvrir" type="button" data-mn="/);
  assert.match(ligne, /'<\/button>'\+\s*\n\s*boutonCoeur\(l\)\+/);
  assert.match(ligne, /favorisEnMemoire\.set\(cleFavori\(l\), l\);/);
});

test("« Maintenant » ne se répète plus sur le même écran", () => {
  assert.doesNotMatch(html, /id="selecteurSurface"/);
  const rapides = app.slice(app.indexOf("const BESOINS_RAPIDES = ["),
    app.indexOf("];", app.indexOf("const BESOINS_RAPIDES = [")));
  assert.doesNotMatch(rapides, /maintenant/i);
  const bloc = /function blocMaintenantAccueil\(\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.doesNotMatch(bloc, /Maintenant<\/b>/);
  // le titre est porté une fois, par le panneau
  assert.match(app, /titrerFeuille\("⚡ Maintenant", sousTitreMaintenant\(\)\);/);
  // la capsule n'existe que panneau fermé, et l'onglet ne compte pas ce qu'on voit
  assert.match(app, /badge\.hidden = n === 0 \|\| panneauOuvert \|\| ailleurs;/);
  assert.match(app, /badge\.hidden = compte === 0 \|\| ouvertSousLesYeux;/);
});

test("Autour s'ouvre sur Maintenant, sauf quand on est venu pour autre chose", () => {
  const demarrer = app.slice(app.indexOf("async function demarrer("),
    app.indexOf("function demarrerSurZonePrecalculee("));
  assert.match(demarrer, /if\(!partage && !entreeProfonde\(\) && !maintenantFermeCetteSession\(\)\)/);
  assert.match(demarrer, /ouvrirSurfaceMaintenant\(\{auto:true\}\)/);
  // un geste arrivé avant la peinture garde la priorité
  assert.match(demarrer, /if\(feuilleNiveau === null && !modeNav && !modePose &&/);
  // la navigation basse désigne Maintenant d'emblée
  assert.match(html, /<button class="nb actif" data-nb="maintenant">/);
});

test("refermer Maintenant tient pour la session, et rend une capsule", () => {
  assert.match(app, /const CLE_MAINTENANT_FERME = "autour:maintenant-ferme:v1";/);
  assert.match(app, /sessionStorage\.getItem\(CLE_MAINTENANT_FERME\) === "1"/);
  // le glissement vers le bas depuis l'état réduit est un refus, comme la croix
  assert.match(app, /else if\(etat === "moyenne"\) reglerEtatFeuille\("reduite"\);\s*\n\s*else fermerFeuilleVolontairement\(\);/);
  const fermer = /function fermerFeuille2\(options\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(fermer, /majBadgeMaintenant\(\);/);
  assert.match(html, /<span class="bm-ouvrir" aria-hidden="true">/);
});

test("les envies ouvrent leur liste dans le panneau, avec un retour et une suite", () => {
  assert.match(app, /corps\.querySelectorAll\("\[data-mn-cat\]"\)/);
  assert.match(app, /if\(feuilleNiveau === "racine" && categorieMaintenant\)\{/);
  // « Voir tout » existe au second niveau, jamais dans les trois places
  assert.match(app, /data-mnc-tout="1"/);
  assert.doesNotMatch(app, /data-mn-tout/);
  // plus loin ou plus tard : les écrans qui existaient déjà
  assert.match(app, /manger:\{besoin:"manger"\}, sortir:\{besoin:"sortir"\}, sport:\{besoin:"bouger"\}/);
});

test("À venir et Ce week-end restent la frise de Maintenant", () => {
  const frise = /function blocPlusTardMaintenant\(\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(frise, /data-creneau="avenir"/);
  assert.match(frise, /data-creneau="weekend"/);
  // changer de créneau ne fait pas sortir de la section
  const bascules = app.match(/ongletCourant = "maintenant";\s*\n\s*categorieMaintenant = null;\s*\n\s*marquerNavigation\(ongletCourant\);/g) || [];
  assert.equal(bascules.length, 2);
});

test("un seul mécanisme, trois dispositions", () => {
  const section = css.slice(css.indexOf("MAINTENANT, LE CŒUR D'AUTOUR"));
  // téléphone : la feuille laisse toujours une bande de carte
  assert.match(section, /@media \(max-width:767px\)\{\s*\n\s*#feuilleBesoins\.accueil\.fb-maintenant/);
  // tablette debout : carte flottante centrée ; couchée : volet à gauche
  assert.match(section, /and \(orientation:portrait\)\{\s*\n\s*body:not\(\.aide\) #feuilleBesoins/);
  assert.match(section, /and \(orientation:landscape\)\{\s*\n\s*body:not\(\.aide\) #feuilleBesoins/);
  // la grille de trois cartes, à hauteur fixe pour ne rien pousser
  assert.match(section, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(section, /height:var\(--mn-carte\)/);
  // ordinateur : la croix existe aussi
  assert.match(section, /@media \(min-width:1100px\)\{\s*\n\s*#feuilleBesoins\.accueil \.fb-x\{display:grid\}/);
});

/* ==========================================================================
   5. LA FIABILITÉ DES MESURES
   ======================================================================== */

/* On exécute la VRAIE fonction d'app.js, extraite du fichier. */
const idObjet = new Function("return " + /function idObjetMaintenant\(l\)\{[\s\S]*?\n\}/.exec(app)[0])();

test("l'objet est nommé par son identifiant stable, jamais par son titre", () => {
  assert.equal(idObjet({ id: "evt9f1c", dbId: "9f1c", titre: "Jazz" }), "event:9f1c");
  assert.equal(idObjet({ id: "pub42", dbId: 42, titre: "Jazz" }), "publication:42");
  assert.equal(idObjet({ id: "evt77", dbId: "77", publication_id: 12 }), "publication:12");
  assert.equal(idObjet({ id: "place-abc", source: "places" }), "place:abc");
  assert.equal(idObjet({ id: "n3000", source: "osm", titre: "Jazz" }), "osm:n3000");
  assert.equal(idObjet({ id: "ChIJx", source: "google" }), "google:ChIJx");
  // deux homonymes ne se confondent pas
  assert.notEqual(idObjet({ id: "evt1", dbId: "1", titre: "Jazz" }),
                  idObjet({ id: "evt2", dbId: "2", titre: "Jazz" }));
  assert.equal(idObjet(null), "");
});

test("une action dans une fiche est attribuée par l'identifiant de la fiche", () => {
  const ecrans = readFileSync(new URL("../differe/ecrans.js", import.meta.url), "utf8");
  assert.match(ecrans, /<div class="d-lieu" id="ficheLieu" data-lieu="'\+esc\(l\.id\)\+'">/);
  const garde = app.slice(app.indexOf("/* Ce qu'on fait DANS une fiche ouverte depuis Maintenant."),
    app.indexOf("/* ---- Ce que dit l'en-tête de Maintenant"));
  assert.match(garde, /fichesDepuisMaintenant\.has\(fiche\.dataset\.lieu\)/);
  assert.match(garde, /lieux\.find\(x=>String\(x\.id\) === fiche\.dataset\.lieu\)/);
  assert.doesNotMatch(garde, /\.titre|querySelector\("\.titre"\)/);
  assert.doesNotMatch(app, /provenanceDetailMaintenant/);
});

test("favori_ajout n'est compté qu'une fois le favori réellement enregistré", () => {
  const coeur = app.slice(app.indexOf('const bouton = e.target.closest && e.target.closest("[data-coeur]");'),
    app.indexOf("const favorisEnMemoire = new Map();"));
  // au toucher : une intention, et seulement sans compte
  assert.match(coeur, /noterMesureMaintenant\("favori_intention", lieu\)/);
  assert.doesNotMatch(coeur, /"favori_ajout"/);
  // l'ajout est écrit APRÈS la réponse positive de la base, jamais avant
  const bascule = /async function basculerFavori\(l\)\{[\s\S]*?\n\}/.exec(app)[0];
  const ok = bascule.indexOf("if(!ok){");
  const retourEchec = bascule.indexOf("return;", ok);
  const compte = bascule.indexOf('noterMesureMaintenant(etait ? "favori_retrait" : "favori_ajout", l)');
  const compteSansCompte = bascule.indexOf("await exigerCompte(");
  assert.ok(ok > 0 && compte > retourEchec, "compté après le contrôle d'échec");
  assert.ok(compteSansCompte > 0 && compteSansCompte < ok,
    "le chemin sans compte sort avant l'enregistrement : rien n'y est compté");
});

/* ==========================================================================
   6. UNE RÉCURRENCE REPLIÉE EN UNE SEULE PLAGE N'EST PAS « EN COURS »
   Relevé en production le 26/09/2026 : « Marché de Wazemmes », publié par
   DATAtourisme du 1er janvier 8 h au 31 décembre 15 h, proposé un samedi à
   16 h 22 avec « jusqu'à 14:00 ».
   ======================================================================== */

const SAMEDI_16H22 = Date.parse("2026-09-26T14:22:00Z");
const annee = (id, debutUtc, finUtc, extra) => evenement(id, Object.assign({
  debutLe: Date.parse("2026-01-01T" + debutUtc + "Z"),
  finLe: Date.parse("2026-12-31T" + finUtc + "Z"),
  timezone: "Europe/Paris",
}, extra || {}));
const a16h22 = ctx({ maintenant: SAMEDI_16H22 });

test("un marché « toute l'année, 8 h → 15 h » n'est pas en cours à 16 h 22", () => {
  const marche = annee("marche-wazemmes", "06:00:00", "13:00:00");
  const v = M.fiable(marche, a16h22);
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.HORS_PLAGE_QUOTIDIENNE);
  assert.ok(!M.selection([marche], a16h22).some((x) => x.id === "marche-wazemmes"));
  // et il ne devient pas une « séance » pour autant
  assert.equal(M.disponible(marche, a16h22).retenu, false);
});

test("dans sa fenêtre quotidienne, la même plage reste en cours", () => {
  const halles = annee("halles", "07:00:00", "19:00:00");      // 9 h → 21 h à Paris
  assert.equal(M.fiable(halles, a16h22).retenu, true);
});

test("un festival de quelques jours n'est pas concerné, même hors de ses heures", () => {
  const festival = evenement("sustain", {
    debutLe: Date.parse("2026-09-23T18:00:00Z"), finLe: Date.parse("2026-09-27T18:00:00Z"),
    timezone: "Europe/Paris" });
  assert.equal(M.fiable(festival, a16h22).retenu, true);
});

test("une plage longue qui passe minuit, ou sans heure distincte, n'est pas filtrée", () => {
  const nuit = annee("nuit", "20:00:00", "03:00:00");          // 22 h → 5 h
  assert.equal(M.fiable(nuit, a16h22).retenu, true);
  const continu = annee("continu", "10:00:00", "10:00:00");
  assert.equal(M.fiable(continu, a16h22).retenu, true);
});

test("la famille d'une mesure est celle du moteur, pour tout l'objet", () => {
  const f = /function familleMaintenant\(l\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(f, /itemsMaintenant\(contexteMaintenant\(\)\)\.find\(i=>String\(i\.id\) === String\(l\.id\)\)/);
  assert.match(app, /const fam = famille \|\| familleMaintenant\(l\);/);
});

test("« Gratuit » : sur un lieu OSM, seul le tag fee=no fait foi", () => {
  const bloc = /function versItemMaintenant\(l, t\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /gratuit: l\.tags && typeof l\.tags === "object"\s*\n\s*\? l\.tags\.fee === "no"/);
});

test("Safari/iOS : la capsule se retire pendant la recherche, le volet évite l'encoche", () => {
  const section = css.slice(css.indexOf("MAINTENANT, LE CŒUR D'AUTOUR"));
  assert.match(section, /body:has\(#rechercheOverlay:not\(\[hidden\]\)\) #badgeMaintenant\{display:none\}/);
  assert.match(section, /left:calc\(16px \+ env\(safe-area-inset-left, 0px\)\);right:auto;/);
  assert.match(section, /body:not\(\.aide\) #feuilleBesoins \.fb-corps\{flex:1 1 auto;min-height:0\}/);
  // color-mix a son repli pour les Safari qui ne le connaissent pas
  assert.match(section, /background:#F7F8F5;background:color-mix\(/);
});
