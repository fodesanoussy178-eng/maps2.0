import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import "../temporel.js";
import "../maintenant.js";

const M = globalThis.AutourMaintenant;
const racine = new URL("../", import.meta.url);
const lire = (f) => readFile(fileURLToPath(new URL(f, racine)), "utf8");

/* ==========================================================================
   LA QUESTION QU'ON POSE QUAND LA NUIT NE RÉPOND PAS

   La règle ne bouge pas : « horaire inconnu » n'est jamais « ouvert ». Un lieu
   non vérifié n'est pas affiché — il est NOMMÉ, pour qu'on aille lui poser la
   question, hors du chemin critique et avec le cache d'abord.

   Ce fichier vérifie les deux moitiés : ce que le module désigne, et la
   discipline de dépense de l'appelant.
   ======================================================================== */

const JOUR = Date.UTC(2026, 7, 14, 13, 0, 0);    // 15 h 00 à Paris
const NUIT = Date.UTC(2026, 7, 14, 23, 45, 0);   // 01 h 45 à Paris
const ICI = [50.7236, 3.1610];                   // Tourcoing

const ctx = (extra) => Object.assign({
  maintenant: NUIT, position: ICI, positionConnue: true,
  positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false, timeZone: "Europe/Paris",
}, extra || {});

/* Le cas courant à une heure du matin : un lieu réel, nommé, situé — et
   aucun horaire. `ouvert:null` est exactement ce que rend `availability.js`
   quand il ne sait pas, et `tempsValide:false` en découle. */
const sansHoraires = (id, categorie, extra) => Object.assign({
  id, categorie, cat: categorie,
  titre: "Lieu " + id, title: "Lieu " + id,
  entity_type: "place", canonical_id: id,
  canonical: { entity_type: "place", id, title: "Lieu " + id, category: categorie },
  tempsValide: false, ouvert: null, ferme: false,
  lat: ICI[0] + 0.0012, lng: ICI[1], adresse: "1 rue de Test",
}, extra || {});

const ouvert = (id, categorie, extra) => Object.assign(
  sansHoraires(id, categorie), { tempsValide: true, ouvert: true }, extra || {});

const evenement = (t) => ({
  id: "ev1", estEvenement: true, annule: false,
  titre: "Concert de nuit", title: "Concert de nuit",
  categorie: "event", entity_type: "event", canonical_id: "ev1",
  canonical: { entity_type: "event", id: "ev1", title: "Concert de nuit", category: "event" },
  tempsValide: true, enCours: true, dateIncertaine: false,
  debutLe: t - 3600e3, finLe: t + 3600e3,
  lat: ICI[0] + 0.001, lng: ICI[1], ferme: false,
});

const ids = (liste) => liste.map((x) => x.id).sort();

/* ==========================================================================
   1. LA RÈGLE NE BOUGE PAS
   ======================================================================== */

test("un bar sans horaires n'est pas affiché avant vérification", () => {
  const sortie = M.selection([sansHoraires("bar", "bar")], ctx());
  assert.equal(sortie.length, 0,
    "aucune supposition : sans réponse, il reste dehors");
});

test("le désigner à vérifier n'est pas l'afficher", () => {
  const items = [sansHoraires("bar", "bar")];
  assert.equal(M.selection(items, ctx()).length, 0);
  assert.deepEqual(ids(M.candidatsNocturnesAVerifier(items, ctx())), ["bar"]);
});

/* ==========================================================================
   2. QUAND LA QUESTION SE POSE, ET QUAND ELLE NE SE POSE PAS
   ======================================================================== */

test("en journée, on ne demande jamais rien", () => {
  assert.deepEqual(M.candidatsNocturnesAVerifier(
    [sansHoraires("bar", "bar")], ctx({ maintenant: JOUR })), []);
});

test("un événement en cours rend la question inutile", () => {
  /* La hiérarchie tient : le filet n'est pas consulté, donc rien n'est
     dépensé pour l'alimenter. */
  const items = [evenement(NUIT), sansHoraires("bar", "bar")];
  const sortie = M.selection(items, ctx());
  assert.equal(sortie[0].id, "ev1");
  /* Et l'appelant n'appelle même pas cette fonction dans ce cas — voir
     `verifierNuitSiEcranVide`. Le module, lui, ne demande que le manque. */
  assert.ok(M.candidatsNocturnesAVerifier(items, ctx()).length <= M.NUIT_MAX_VERIFICATIONS);
});

test("trois lieux confirmés ouverts : aucune question, aucun appel", () => {
  const items = [ouvert("a", "bar"), ouvert("b", "fastfood"),
                 ouvert("c", "commerce"), sansHoraires("d", "bar")];
  /* Le filet trouve ses trois places sans rien demander. La sélection
     affichée, elle, en montre moins : la règle de diversité s'applique — trois
     lieux où l'on mange et boit répondent à la même question. C'est le
     comportement voulu, et il n'appelle aucune dépense supplémentaire. */
  assert.equal(M.selectionRepliNocturne(items, ctx()).length, 3);
  assert.ok(M.selection(items, ctx()).length > 0, "l'écran n'est pas vide");
  assert.deepEqual(M.candidatsNocturnesAVerifier(items, ctx()), [],
    "les places sont prises : demander serait dépenser pour rien");
});

test("on ne demande jamais plus que ce qu'il manque", () => {
  const items = [ouvert("a", "bar"), ouvert("b", "fastfood")];
  for (let i = 0; i < 8; i += 1)
    items.push(sansHoraires("x" + i, "bar", { lat: ICI[0] + 0.001 + i * 0.0002 }));
  assert.equal(M.candidatsNocturnesAVerifier(items, ctx()).length, 1,
    "deux places prises sur trois : une seule question");
});

test("le nombre de questions est plafonné, quoi qu'il arrive", () => {
  const items = [];
  for (let i = 0; i < 40; i += 1)
    items.push(sansHoraires("x" + i, "bar", { lat: ICI[0] + 0.001 + i * 0.0002 }));
  assert.equal(M.candidatsNocturnesAVerifier(items, ctx()).length,
    M.NUIT_MAX_VERIFICATIONS, "pas de balayage de tous les POI");
});

/* ==========================================================================
   3. CE QU'ON NE DEMANDE PAS
   ======================================================================== */

test("un lieu déjà connu fermé n'est jamais redemandé", () => {
  const ferme = sansHoraires("f", "bar", { ouvert: false, tempsValide: true });
  assert.deepEqual(M.candidatsNocturnesAVerifier([ferme], ctx()), [],
    "payer pour confirmer un refus n'apporte rien");
});

test("une fermeture temporaire vérifiée clôt la question", () => {
  const travaux = sansHoraires("t", "bar", { temporary_closed: true });
  assert.deepEqual(M.candidatsNocturnesAVerifier([travaux], ctx()), []);
});

test("un statut déjà vérifié — ouvert ou fermé — n'est pas redemandé", () => {
  for (const statut of ["open", "closed", "permanently_closed"]) {
    assert.deepEqual(M.candidatsNocturnesAVerifier(
      [sansHoraires("s", "bar", { current_status: statut })], ctx()), [],
      statut + " : la réponse est là, la question ne se repose pas");
  }
});

test("les catégories hors de la nuit ne sont jamais interrogées", () => {
  for (const cat of ["banque", "metro", "bus", "sante", "pharmacie", "mairie",
                     "administration", "supermarche", "station_service", "ecole"]) {
    assert.deepEqual(M.candidatsNocturnesAVerifier(
      [sansHoraires("x-" + cat, cat)], ctx()), [],
      cat + " ne mérite pas un appel");
  }
});

test("seules les catégories de la nuit sont interrogées", () => {
  const items = ["bar", "fastfood", "resto", "cafe", "commerce"]
    .map((c, i) => sansHoraires(c, c, { lat: ICI[0] + 0.001 + i * 0.0001 }));
  const demandes = M.candidatsNocturnesAVerifier(items, ctx());
  assert.equal(demandes.length, M.NUIT_MAX_VERIFICATIONS);
  for (const d of demandes) assert.ok(M.NUIT_ADMISES.includes(d.categorie));
});

test("un lieu trop loin ne vaut pas un appel", () => {
  const loin = sansHoraires("loin", "bar", { lat: ICI[0] + 0.5 });
  assert.deepEqual(M.candidatsNocturnesAVerifier([loin], ctx({ rayonMax: 1000 })), []);
});

test("un lieu sans nom exploitable n'est pas interrogeable", () => {
  /* La clé du cache est construite sur le nom : sans nom, on ne saurait ni
     lire la réponse, ni l'écrire. */
  const anonyme = sansHoraires("a", "bar", { sansNom: true, titre: "", title: "" });
  assert.deepEqual(M.candidatsNocturnesAVerifier([anonyme], ctx()), []);
});

test("un événement n'est jamais un candidat nocturne", () => {
  const futur = Object.assign(evenement(NUIT), { enCours: false, id: "ev2",
    debutLe: NUIT + 86400e3 * 3, finLe: NUIT + 86400e3 * 3 + 3600e3 });
  assert.deepEqual(M.candidatsNocturnesAVerifier([futur], ctx()), []);
});

/* ==========================================================================
   4. L'ORDRE DES QUESTIONS
   ======================================================================== */

test("les plus proches d'abord", () => {
  const items = [
    sansHoraires("loin", "bar", { lat: ICI[0] + 0.020 }),
    sansHoraires("pres", "bar", { lat: ICI[0] + 0.0008 }),
    sansHoraires("moyen", "bar", { lat: ICI[0] + 0.008 }),
  ];
  assert.deepEqual(M.candidatsNocturnesAVerifier(items, ctx()).map((x) => x.id),
    ["pres", "moyen", "loin"]);
});

/* ==========================================================================
   5. LE VERDICT, UNE FOIS REVENU

   Le module ne parle pas au serveur : il lit ce que l'appelant a posé sur le
   lieu. Ces deux tests décrivent l'aller-retour complet, tel qu'il se produit
   au redessin suivant.
   ======================================================================== */

test("l'enrichissement confirme « ouvert » : le lieu devient éligible", () => {
  const brut = sansHoraires("fast", "fastfood");
  assert.equal(M.selection([brut], ctx()).length, 0, "avant : rien");

  /* Ce que `ENR.appliquer` pose sur le lieu quand le serveur répond `open`. */
  const verifie = Object.assign({}, brut, { current_status: "open" });
  const sortie = M.selection([verifie], ctx());
  assert.equal(sortie.length, 1, "après : il entre");
  assert.equal(sortie[0].id, "fast");
  /* Le fast-food de l'exemple entre par le chemin ORDINAIRE : la restauration
     n'a jamais été une commodité. Ce que la vérification a levé, c'est le
     silence sur ses horaires, pas une exclusion de catégorie. */
  assert.ok(!sortie[0].repliNocturne);

  /* L'épicerie, elle, n'entre que par le filet — et seulement une fois la
     réponse revenue. C'est là que la vérification change vraiment l'écran. */
  const epicerie = Object.assign(sansHoraires("ep", "commerce"), { current_status: "open" });
  const parLeFilet = M.selection([epicerie], ctx());
  assert.equal(parLeFilet.length, 1);
  assert.equal(parLeFilet[0].repliNocturne, true);
});

test("l'enrichissement répond « fermé » ou « inconnu » : le lieu reste dehors", () => {
  const brut = sansHoraires("bar", "bar");
  for (const statut of ["closed", "permanently_closed", "unknown"]) {
    const apres = Object.assign({}, brut, { current_status: statut });
    assert.equal(M.selection([apres], ctx()).length, 0,
      statut + " ne fait entrer personne");
  }
  const travaux = Object.assign({}, brut, { temporary_closed: true });
  assert.equal(M.selection([travaux], ctx()).length, 0);
});

test("un « ouvert » vérifié ne dépasse jamais les trois places", () => {
  const items = [];
  for (let i = 0; i < 9; i += 1)
    items.push(Object.assign(sansHoraires("v" + i, "commerce",
      { lat: ICI[0] + 0.001 + i * 0.0002 }), { current_status: "open" }));
  const sortie = M.selection(items, ctx());
  assert.ok(sortie.length > 0, "neuf réponses « ouvert » ne laissent pas l'écran vide");
  assert.ok(sortie.length <= 3, "et n'en remplissent jamais plus de trois");
});

/* ==========================================================================
   6. LA DISCIPLINE DE DÉPENSE, CÔTÉ APPELANT
   ======================================================================== */

test("la vérification nocturne n'est jamais sur le chemin d'un rendu", async () => {
  const src = await lire("app.js");
  assert.match(src,
    /ORDO\.differer\(\(\)=>verifierNuitSiEcranVide\(/,
    "elle est différée, comme les autres couches d'enrichissement");
  const bloc = /function verifierNuitSiEcranVide\([\s\S]*?\n\}\n/.exec(src);
  assert.ok(bloc, "verifierNuitSiEcranVide est introuvable");
  assert.doesNotMatch(bloc[0], /\bawait connecter\(\)[\s\S]{0,80}return \[\]/,
    "elle ne rend rien à afficher : elle complète, ou elle n'arrive pas");
});

test("le cache et son TTL sont consultés avant tout appel au modèle", async () => {
  const src = await lire("app.js");
  const bloc = /function verifierNuitSiEcranVide\([\s\S]*?\n\}\n/.exec(src)[0];
  const posCache = bloc.indexOf("calqueVerifie(");
  const posTtl = bloc.indexOf("e.expires_at) > Date.now()", posCache);
  const posAppel = bloc.indexOf("await demanderVerification(", posTtl);
  assert.ok(posCache > 0 && posTtl > posCache && posAppel > posTtl,
    "cache d'abord, fraîcheur ensuite, appel en dernier");
});

test("un cache frais ne déclenche aucun appel au modèle", async () => {
  const src = await lire("app.js");
  const bloc = /function verifierNuitSiEcranVide\([\s\S]*?\n\}\n/.exec(src)[0];
  /* Seules les entrées non fraîches rejoignent la file de demandes... */
  assert.match(bloc, /if\(!frais\) aDemander\.push\(x\);/);
  /* ...et `territoire.js` refuse encore une entrée fraîche, budget compris. */
  assert.match(bloc, /deciderVerification\(x\.l, \["unknownCurrentStatus"\],\s*\n?\s*connus\.get\(x\.cle\)\);/);
});

test("une même clé n'est jamais demandée deux fois dans la session", async () => {
  const src = await lire("app.js");
  const bloc = /function verifierNuitSiEcranVide\([\s\S]*?\n\}\n/.exec(src)[0];
  assert.match(bloc, /!nuitDejaInterrogee\.has\(cle\)/);
  assert.match(bloc, /nuitDejaInterrogee\.add\(x\.cle\);/);
});

test("une sélection éditoriale non vide coupe court", async () => {
  const src = await lire("app.js");
  const bloc = /function verifierNuitSiEcranVide\([\s\S]*?\n\}\n/.exec(src)[0];
  assert.match(bloc, /if\(liste\.length && !liste\.every\(x=>x && x\.repliNocturne\)\) return;/,
    "un événement ou une activité rend cette couche inutile");
});
