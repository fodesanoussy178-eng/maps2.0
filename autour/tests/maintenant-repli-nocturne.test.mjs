import test from "node:test";
import assert from "node:assert/strict";
import "../temporel.js";
import "../maintenant.js";

const M = globalThis.AutourMaintenant;

/* ==========================================================================
   LE FILET NOCTURNE

   La règle générale ne bouge pas : un commerce ordinaire n'est pas une
   proposition. Ce fichier vérifie la seule exception — et surtout qu'elle
   reste une exception.

   Deux instants de référence, en heure de PARIS (août, donc UTC+2) :
     JOUR = 15 h 00 — un commerce ouvert ne doit jamais remonter
     NUIT = 01 h 45 — l'heure de l'exemple, à Tourcoing
   ======================================================================== */
const JOUR = Date.UTC(2026, 7, 14, 13, 0, 0);   // 15 h 00 à Paris
const NUIT = Date.UTC(2026, 7, 14, 23, 45, 0);  // 01 h 45 le lendemain
const ICI = [50.7236, 3.1610];                  // Tourcoing
const h = (n) => n * 3600e3;

const ctx = (extra) => Object.assign({
  maintenant: NUIT, position: ICI, positionConnue: true,
  positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false, timeZone: "Europe/Paris",
}, extra || {});

/* Un lieu ouvert, nommé, situé. `ouvert:true` est ce que le module exige :
   l'inconnu n'entre pas, et ce fichier ne cherche pas à le contourner. */
const lieu = (id, categorie, extra) => Object.assign({
  id, categorie, cat: categorie,
  titre: "Lieu " + id, title: "Lieu " + id,
  entity_type: "place", canonical_id: id,
  canonical: { entity_type: "place", id, title: "Lieu " + id, category: categorie },
  tempsValide: true,
  ouvert: true, ferme: false,
  lat: ICI[0] + 0.0015, lng: ICI[1],
  adresse: "1 rue de Test",
}, extra || {});

/* Un événement en cours, daté des deux côtés. */
const evenement = (t) => ({
  id: "ev1", estEvenement: true, annule: false,
  titre: "Concert de nuit", title: "Concert de nuit",
  categorie: "event", entity_type: "event", canonical_id: "ev1",
  canonical: { entity_type: "event", id: "ev1", title: "Concert de nuit", category: "event" },
  tempsValide: true, enCours: true, dateIncertaine: false,
  debutLe: t - h(1), finLe: t + h(1),
  lat: ICI[0] + 0.001, lng: ICI[1], ferme: false,
});

/* La nuit de l'exemple : un fast-food, un bar, une épicerie. */
const NUIT_TOURCOING = [
  lieu("bar", "bar", { lat: ICI[0] + 0.0012, lng: ICI[1] }),
  lieu("fast", "fastfood", { lat: ICI[0] + 0.0018, lng: ICI[1] }),
  lieu("epicerie", "commerce", { lat: ICI[0] + 0.0025, lng: ICI[1] }),
];

/* ==========================================================================
   1. LE JOUR, RIEN NE CHANGE
   ======================================================================== */

test("en journée, une épicerie ouverte ne remonte jamais dans Maintenant", () => {
  const sortie = M.selection([lieu("epicerie", "commerce")],
    ctx({ maintenant: JOUR }));
  assert.equal(sortie.length, 0,
    "à 15 h, une supérette ouverte reste une commodité : "
    + sortie.map((s) => s.id).join(", "));
});

test("en journée, le filet ne s'ouvre jamais, même sans rien d'autre", () => {
  assert.deepEqual(
    M.selectionRepliNocturne(NUIT_TOURCOING, ctx({ maintenant: JOUR })), []);
});

/* Un bar ouvert n'a jamais été une commodité : il entre par la règle
   générale, de jour comme de nuit. Ce test fixe cette frontière — le filet
   n'a pas à s'attribuer ce que « Maintenant » proposait déjà. */
test("un bar ouvert reste une proposition ordinaire, pas un repli", () => {
  const sortie = M.selection([lieu("bar", "bar")], ctx({ maintenant: JOUR }));
  assert.equal(sortie.length, 1);
  assert.ok(!sortie[0].repliNocturne, "il vient du chemin normal");
});

test("en journée avec un événement, la sélection reste éditoriale", () => {
  const sortie = M.selection([evenement(JOUR), lieu("epicerie", "commerce")],
    ctx({ maintenant: JOUR }));
  assert.equal(sortie.length, 1);
  assert.equal(sortie[0].id, "ev1");
  assert.ok(!sortie.some((s) => s.repliNocturne), "aucun repli le jour");
});

/* ==========================================================================
   2. LA NUIT SANS ÉVÉNEMENT : LE FILET S'OUVRE
   ======================================================================== */

test("à 01 h 45, l'épicerie ouverte entre au lieu d'un écran vide", () => {
  const sortie = M.selection([lieu("epicerie", "commerce")], ctx());
  assert.equal(sortie.length, 1, "l'écran ne doit plus être vide");
  assert.equal(sortie[0].id, "epicerie");
  assert.equal(sortie[0].repliNocturne, true,
    "ce résultat vient du filet, et le dit");
});

test("la nuit de Tourcoing : jusqu'à trois propositions, jamais davantage", () => {
  const sortie = M.selection(NUIT_TOURCOING, ctx());
  assert.ok(sortie.length > 0, "l'écran ne doit plus être vide");
  assert.ok(sortie.length <= 3, "jamais plus de trois : " + sortie.length);
});

test("le filet ne dépasse jamais trois résultats", () => {
  const beaucoup = [];
  for (let i = 0; i < 12; i += 1)
    beaucoup.push(lieu("ep" + i, "commerce", { lat: ICI[0] + 0.001 + i * 0.0002 }));
  assert.equal(M.selectionRepliNocturne(beaucoup, ctx()).length, 3);
});

test("un seul bon lieu ouvert donne un seul résultat, jamais un remplissage", () => {
  const sortie = M.selection([lieu("seul", "commerce")], ctx());
  assert.equal(sortie.length, 1);
  assert.equal(sortie[0].id, "seul");
});

/* ==========================================================================
   3. L'ÉVÉNEMENT PASSE TOUJOURS AVANT
   ======================================================================== */

test("la nuit, un événement disponible rend le filet inutile", () => {
  const sortie = M.selection([evenement(NUIT), lieu("epicerie", "commerce")], ctx());
  assert.equal(sortie[0].id, "ev1", "l'événement ouvre la liste");
  assert.ok(!sortie.some((s) => s.repliNocturne),
    "le filet n'est pas consulté quand la sélection rend quelque chose");
});

/* ==========================================================================
   4. FERMÉ OU INCONNU : JAMAIS
   ======================================================================== */

test("un lieu fermé n'est jamais choisi par le filet", () => {
  const sortie = M.selection([lieu("ferme", "bar", { ouvert: false })], ctx());
  assert.equal(sortie.length, 0);
});

test("un horaire inconnu ne vaut jamais mieux qu'un ouvert confirmé", () => {
  const inconnu = lieu("inconnu", "bar", { ouvert: null, lat: ICI[0] + 0.0002 });
  const confirme = lieu("confirme", "bar", { ouvert: true, lat: ICI[0] + 0.004 });
  const sortie = M.selection([inconnu, confirme], ctx());
  assert.equal(sortie.length, 1, "seul l'ouvert confirmé entre");
  assert.equal(sortie[0].id, "confirme",
    "même plus loin, le confirmé passe devant l'inconnu plus proche");
});

test("une fermeture vérifiée exclut, quelle que soit l'heure", () => {
  const sortie = M.selection(
    [lieu("travaux", "bar", { temporary_closed: true })], ctx());
  assert.equal(sortie.length, 0);
});

/* ==========================================================================
   5. LES EXCLUSIONS DE CATÉGORIE
   ======================================================================== */

/* Ces contrôles visent le FILET. Le chemin normal a ses propres exclusions,
   que cette passe ne touche pas : `COMMODITES` ne connaît par exemple pas
   « banque », et une banque ouverte y entre donc déjà — constat antérieur à
   ce filet, et hors de son périmètre. */
test("transports, banques et administrations n'entrent jamais par le filet", () => {
  for (const cat of ["metro", "bus", "tram", "train", "velo", "banque",
                     "mairie", "administration", "ecole", "emploi"]) {
    assert.deepEqual(M.selectionRepliNocturne([lieu("x-" + cat, cat)], ctx()), [],
      cat + " ne doit jamais entrer par le filet");
  }
});

test("santé et pharmacie n'entrent pas par le filet", () => {
  assert.deepEqual(M.selectionRepliNocturne([lieu("pharma", "pharmacie")], ctx()), []);
  assert.deepEqual(M.selectionRepliNocturne([lieu("sante", "sante")], ctx()), []);
});

test("les infrastructures techniques n'entrent pas par le filet", () => {
  for (const cat of ["station_service", "essence", "recharge", "toilettes",
                     "supermarche"]) {
    assert.deepEqual(M.selectionRepliNocturne([lieu("i-" + cat, cat)], ctx()), [],
      cat + " reste dehors");
  }
});

/* ==========================================================================
   6. AUCUN CANDIDAT : L'ÉTAT VIDE EST CONSERVÉ
   ======================================================================== */

test("sans aucun candidat valable, l'état vide reste l'état vide", () => {
  assert.equal(M.selection([], ctx()).length, 0);
  assert.equal(M.selection([lieu("m", "metro"),
    lieu("f", "commerce", { ouvert: false })], ctx()).length, 0);
});

/* ==========================================================================
   7. L'HEURE EST CELLE DU TERRITOIRE
   ======================================================================== */

test("la nuit se lit dans le fuseau du territoire, pas dans celui de la machine", () => {
  /* 01 h 45 à Paris est encore 19 h 45 à New York : le même instant ne donne
     pas la même réponse, et c'est le fuseau transmis qui tranche. */
  assert.equal(M.estNuit({ maintenant: NUIT, timeZone: "Europe/Paris" }), true);
  assert.equal(M.estNuit({ maintenant: NUIT, timeZone: "America/New_York" }), false);
});

test("les bornes de la nuit sont 22 h et 5 h", () => {
  const a = (heure) => M.estNuit({
    maintenant: Date.UTC(2026, 7, 14, heure - 2, 0, 0), timeZone: "Europe/Paris",
  });
  assert.equal(a(21), false);
  assert.equal(a(22), true);
  assert.equal(a(23), true);
  assert.equal(M.estNuit({ maintenant: Date.UTC(2026, 7, 14, 2, 0, 0),
    timeZone: "Europe/Paris" }), true);    // 04 h 00
  assert.equal(M.estNuit({ maintenant: Date.UTC(2026, 7, 14, 4, 0, 0),
    timeZone: "Europe/Paris" }), false);   // 06 h 00
});

/* ==========================================================================
   8. LE CLASSEMENT DU FILET
   ======================================================================== */

test("à distance comparable, la fiche la mieux renseignée passe devant", () => {
  const nu = lieu("nu", "commerce", { adresse: null, openingHours: null });
  const complet = lieu("complet", "commerce",
    { adresse: "2 rue Test", openingHours: "Mo-Su 18:00-02:00" });
  const sortie = M.selection([nu, complet], ctx());
  assert.equal(sortie[0].id, "complet");
});

test("à égalité par ailleurs, une vraie photo départage", () => {
  const sans = lieu("sans", "commerce");
  const avec = lieu("avec", "commerce", { image_url: "https://exemple.test/photo.jpg" });
  const sortie = M.selection([sans, avec], ctx());
  assert.equal(sortie[0].id, "avec");
});

test("le plus proche passe devant, par paliers de cent mètres", () => {
  const loin = lieu("loin", "commerce", { lat: ICI[0] + 0.010 });
  const pres = lieu("pres", "commerce", { lat: ICI[0] + 0.0008 });
  const sortie = M.selection([loin, pres], ctx());
  assert.equal(sortie[0].id, "pres");
});
