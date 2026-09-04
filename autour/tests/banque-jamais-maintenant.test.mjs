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
   UNE BANQUE N'EST PAS UNE SORTIE

   Le défaut n'était pas dans « Maintenant » : il était en amont. Aucun type
   financier n'était traduit par le fournisseur Google, donc une agence
   bancaire, un distributeur ou un cabinet comptable tombaient sur la catégorie
   par défaut — « commerce ». Ils étaient écartés par accident, pour la
   mauvaise raison, et le jour où « commerce » a gagné une exception nocturne,
   l'accident cessait de protéger quoi que ce soit.

   Ces tests fixent les deux bouts : la classification en amont, et le refus
   en aval.
   ======================================================================== */

const NUIT = Date.UTC(2026, 7, 14, 23, 45, 0);   // 01 h 45 à Paris
const JOUR = Date.UTC(2026, 7, 14, 13, 0, 0);    // 15 h 00 à Paris
const ICI = [50.7236, 3.1610];

const ctx = (extra) => Object.assign({
  maintenant: JOUR, position: ICI, positionConnue: true,
  positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false, timeZone: "Europe/Paris",
}, extra || {});

const lieu = (id, categorie, extra) => Object.assign({
  id, categorie, cat: categorie,
  titre: "Lieu " + id, title: "Lieu " + id,
  entity_type: "place", canonical_id: id,
  canonical: { entity_type: "place", id, title: "Lieu " + id, category: categorie },
  tempsValide: true, ouvert: true, ferme: false,
  lat: ICI[0] + 0.0012, lng: ICI[1], adresse: "1 rue de Test",
}, extra || {});

/* ---- 1. En amont : la catégorie existe et elle est atteignable ---------- */

test("les types financiers de Google ne tombent plus sur « commerce »", async () => {
  const src = await lire("providers/googlePlaces.js");
  const table = src.slice(src.indexOf("const typesVersCategorie"),
    src.indexOf("const niveauxPrix"));
  for (const type of ["bank", "atm", "accounting", "insurance_agency"]) {
    assert.match(table, new RegExp("\\b" + type + ':\\s*"banque"'),
      type + " doit être traduit, sinon il hérite de defaultCategory");
  }
});

test("« banque » est une catégorie de la carte, avec son libellé et son icône", async () => {
  const src = await lire("app.js");
  const table = src.slice(src.indexOf("const CATS = {"),
    src.indexOf("/* ---- L'icône dit le type réel"));
  assert.match(table, /banque:\s*\{label:"Banques",\s*emoji:"🏦"/,
    "sans entrée dans CATS, une banque s'afficherait comme un événement");
});

/* ---- 2. En aval : jamais une proposition éditoriale -------------------- */

test("une banque ouverte n'entre jamais dans Maintenant, de jour", () => {
  assert.equal(M.selection([lieu("bnp", "banque")], ctx()).length, 0);
});

test("une banque ouverte n'entre jamais dans Maintenant, la nuit", () => {
  assert.equal(M.selection([lieu("bnp", "banque")], ctx({ maintenant: NUIT })).length, 0);
});

test("un distributeur ouvert 24 h sur 24 n'est pas une proposition nocturne", () => {
  /* Le cas qui rendait le sujet urgent : un distributeur est réellement
     ouvert à deux heures du matin. C'est vrai, et ce n'est pas une sortie. */
  const sortie = M.selection([lieu("atm", "banque")], ctx({ maintenant: NUIT }));
  assert.equal(sortie.length, 0, "l'écran vide vaut mieux qu'un distributeur");
});

test("« banque » est refusée par le filet nocturne comme par la règle générale", () => {
  assert.deepEqual(M.selectionRepliNocturne([lieu("bnp", "banque")],
    ctx({ maintenant: NUIT })), []);
  assert.ok(M.COMMODITES.includes("banque"),
    "les deux chemins doivent refuser, pas un seul");
});

test("même explicitement demandée, une banque reste hors du filet nocturne", () => {
  /* La demande explicite lève l'exclusion de commodité — c'est la règle de
     « pharmacie ouverte maintenant », et elle ne change pas. Le filet, lui,
     n'est pas une demande : il ne doit jamais servir de porte dérobée. */
  assert.deepEqual(M.selectionRepliNocturne([lieu("bnp", "banque")],
    ctx({ maintenant: NUIT, categoriesDemandees: ["banque"] })), []);
});

test("la reclassification ne rend pas les banques éligibles aux surprises", async () => {
  /* Elles arrivaient sous l'étiquette « commerce », déjà écartée. Changer leur
     nom sans le dire ici les aurait fait apparaître là où elles n'étaient pas. */
  const src = await lire("app.js");
  const bloc = /const CATS_SANS_INTERET = \[[^\]]*\]/.exec(src);
  assert.ok(bloc, "CATS_SANS_INTERET est introuvable");
  assert.match(bloc[0], /"banque"/);
});

test("une commodité financière ne déclenche aucune vérification payante", async () => {
  const src = await lire("enrichissements.js");
  const bloc = /const COMMODITES = \[[^\]]*\]/.exec(src);
  assert.ok(bloc);
  assert.match(bloc[0], /"banque"/,
    "la liste de enrichissements.js suit celle de maintenant.js, à dessein");
});
