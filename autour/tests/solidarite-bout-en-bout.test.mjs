/* SOLIDARITÉ, DE LA SOURCE PUBLIQUE À L'ÉCRAN

   Le défaut rapporté : « Manger » affiche « Aucune structure fiable trouvée
   dans cette zone pour le moment » alors que des structures existent
   réellement à Tourcoing. Le traçage a montré quatre points de perte
   distincts, mesurés en base et dans le code le 25/09/2026 :

     1. `local_discovery_nearby` existe, est accordée à `anon`, rend bien le
        candidat vérifié — et AUCUN fichier du client ne l'appelle. Trouver
        n'était pas publier ; publier n'était pas servir.
     2. Branchée naïvement, la ligne PERD son service : le contrat
        `AideStructure` lit `services`, jamais `service_categories`.
     3. Les sources n'écrivent pas le même mot pour le même service —
        `food_distribution`, `emergency_food`, `social_grocery`,
        `emergency_housing` — et le moteur comparait à l'identique.
     4. L'extrait FINESS de Tourcoing était filtré sur `^59200`, ce qui
        écartait un vrai CHRS dont le code postal est un CEDEX.

   Ces tests fixent les quatre corrections ET les garde-fous qu'elles ne
   doivent pas desserrer : un nom seul ne fait jamais entrer dans Solidarité,
   et deux antennes d'un même réseau ne fusionnent jamais sur leur téléphone. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../comprendre.js";
import "../aide-intentions.js";
import "../aide-taxonomie.js";
import "../aide-classement.js";
import "../aide-structures.js";
import "../aide-rayon.js";
import "../aide-contexte-ia.js";
import "../aide.js";
import { sourceApplicationSync } from "./source.mjs";

globalThis.window = globalThis;
await import("../providers/normaliser.js");
await import("../providers/aideDecouverte.js");
await import("../providers/aideFiness.js");

const AIDE = globalThis.AutourAideStructures;
const A = globalThis.AutourAide;
const TAXO = globalThis.AutourAideTaxonomie;
const DECOUVERTE = globalThis.AutourProviders.aideDecouverte;
const FINESS = globalThis.AutourProviders.aideFiness;
const source = sourceApplicationSync(import.meta.url);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const modules = readFileSync(new URL("../outils/modules.mjs", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/aide-structures.js", import.meta.url), "utf8");

/* La ligne EXACTE que `local_discovery_nearby` rendait le 25/09/2026 pour
   Tourcoing. Recopiée sans retouche : c'est le seul candidat vérifié et
   rattaché à un lieu que la base contenait ce jour-là. */
const CCAS = Object.freeze({
  id: "9072d1c4-f65c-42d8-bdf8-93e650498647",
  name: "CCAS de Tourcoing", lat: 50.7231, lng: 3.1604,
  address: "26 Rue de la Bienveillance", postal_code: "59200", city: "Tourcoing",
  category: "mairie",
  service_categories: ["administrative_assistance", "food", "meals"],
  phone: "03 20 11 34 34",
  official_url: "https://www.tourcoing.fr/Ma-vie-pratique/Solidarite-social/Le-CCAS-Centre-communal-d-action-sociale",
  verification_status: "verified", confidence: "0.880",
  last_verified_at: "2026-09-24 21:59:33.498+00", entity_status: "unknown",
  reopens_at: null, closure_reason: null, next_distribution_at: null, distance_m: 0,
});

const retenue = (structure, besoin) =>
  !!structure && A.estSolution(structure, [besoin]) && AIDE.fiable(structure, [besoin]) &&
  structure.trustLevel !== "unknown";

/* ==========================================================================
   1. LE PONT QUI MANQUAIT
   ======================================================================== */

test("la découverte locale est servie à l'écran, pas seulement écrite en base", () => {
  assert.match(source, /local_discovery_nearby/,
    "aucun appel à la fonction de lecture publique de la découverte");
  assert.match(source, /lieuxAideDecouverte/);
  assert.match(source, /publierAideSource\(locaux, "local_discovery"\)/);
  assert.match(html, /providers\/aideDecouverte\.js/);
  assert.match(modules, /providers\/aideDecouverte\.js/);
});

test("une ligne vérifiée de la découverte entre dans Manger", () => {
  const structure = DECOUVERTE.normaliser(CCAS);
  assert.ok(structure, "la ligne doit se normaliser");
  assert.equal(retenue(structure, "manger"), true);
  assert.equal(structure.trustLevel, "verified_help");
});

test("le service déclaré voyage — c'est le piège qui vidait l'écran", () => {
  /* Passer la ligne brute au contrat commun perd `service_categories` : le
     contrat lit `services` / `service_types`. Sans la traduction du provider,
     la structure reste invisible dans Manger alors que tout le reste est bon. */
  const brute = AIDE.normaliser(Object.assign({}, CCAS, {source: "autour"}));
  assert.equal([...brute.services].length, 0);
  assert.equal(AIDE.fiable(brute, ["manger"]), false);

  const traduite = DECOUVERTE.normaliser(CCAS);
  assert.deepEqual([...traduite.services].sort(),
    ["administrative_assistance", "food", "meals"]);
});

test("la découverte ne sert que ce qu'elle a vérifié, et garde sa provenance", () => {
  const structure = DECOUVERTE.normaliser(CCAS);
  assert.equal(structure.source, "local_discovery");
  assert.equal(structure.verificationStatus, "verified");
  assert.equal(structure.officialUrl, CCAS.official_url);
  assert.equal(structure.sourceConfidence, 0.88);
  /* `entity_status: unknown` ne devient jamais « ouvert » : ne pas savoir
     n'est pas savoir. */
  assert.equal(structure.status.value, "unknown");
});

test("le rayon de la découverte est respecté", async () => {
  const proche = await DECOUVERTE.nearby(50.7231, 3.1604, {records: [CCAS], radius: 5000});
  assert.equal(proche.length, 1);
  const loin = await DECOUVERTE.nearby(48.8566, 2.3522, {records: [CCAS], radius: 5000});
  assert.equal(loin.length, 0);
});

/* ==========================================================================
   2. LE MÊME SERVICE, DANS LA LANGUE DE SA SOURCE
   ======================================================================== */

const structure = (valeurs) => AIDE.normaliser(Object.assign({
  source: "local_discovery", aideStructure: true, id: "t1",
  name: "Structure de test", lat: 50.72, lng: 3.16,
  sourceConfidence: 0.8, updatedAt: "2026-09-01T00:00:00Z",
}, valeurs));

test("les libellés réellement observés en base disent le bon besoin", () => {
  /* Relevé dans `local_discovery_candidates` le 25/09/2026. */
  for (const service of ["food_distribution", "emergency_food", "social_grocery"])
    assert.equal(retenue(structure({category: "asso", services: [service]}), "manger"), true,
      service + " devrait prouver l'aide alimentaire");
  for (const service of ["emergency_housing", "night_shelter", "hebergement d urgence"])
    assert.equal(retenue(structure({category: "asso", services: [service]}), "logement"), true,
      service + " devrait prouver l'hébergement");
});

test("un mot qui ne dit aucun service ne prouve aucun besoin", () => {
  /* `social_support` est le libellé le plus fréquent après `food` dans les
     candidats mesurés. « Soutien social » ne dit ni un repas ni un lit, et il
     ne doit donc rien ouvrir tout seul. */
  const s = structure({category: "asso", services: ["social_support"]});
  assert.equal(retenue(s, "manger"), false);
  assert.equal(retenue(s, "logement"), false);
});

test("la racine se dérive des services canoniques, pas d'une liste à rallonge", () => {
  /* La table est indexée par service CANONIQUE : ajouter un service à un
     besoin lui donne ses variantes du même coup. */
  const manger = TAXO.besoin("manger");
  assert.ok(manger.services.some((s) => TAXO.racineService(s)),
    "au moins un service de Manger doit porter une racine");
  assert.equal(TAXO.racineService("service_inconnu_de_la_table"), null);
});

test("le nom seul ne fait toujours pas entrer dans Solidarité", () => {
  /* Le faux positif fondateur : une boulangerie promue aide alimentaire par
     deux mots de son enseigne. La couche sémantique ne doit pas le rouvrir. */
  const boulangerie = structure({name: "VIENNOISERIE ROYALE CROIX ROUGE",
    category: "autre", tags: {shop: "bakery"}});
  assert.equal(retenue(boulangerie, "manger"), false);
  /* Et le symétrique, côté Logement : « foyer » vient d'être ajouté aux
     synonymes ; il ne doit pas suffire seul. */
  const nomSeul = structure({name: "Foyer du Vieux Tourcoing", category: "autre"});
  assert.equal(retenue(nomSeul, "logement"), false);
});

test("Logement connaît les mots des vraies structures", () => {
  const synonymes = TAXO.besoin("logement").synonymes.map(String).join(" ");
  for (const mot of ["foyer", "jeunes travailleurs", "nuit"])
    assert.ok(synonymes.includes(mot), "« " + mot + " » manque aux synonymes de Logement");
  assert.ok(TAXO.besoin("logement").services.includes("foyer"));
});

/* ==========================================================================
   3. LE TERRITOIRE — UNE STRUCTURE VÉRIFIÉE NE DISPARAÎT PAS SANS UN MOT
   ======================================================================== */

test("un code postal CEDEX reste un code postal de la même ville", () => {
  assert.doesNotMatch(api, /\/\^59200\/\.test/,
    "le filtre exact sur 59200 écartait un vrai CHRS de Tourcoing");
  assert.match(api, /\^59\\d\{3\}\$/);
});

test("le CHRS de Tourcoing dont le code est un CEDEX entre dans Logement", () => {
  /* Ligne exacte de l'extrait FINESS du 30/08/2026 : commune
     « TOURCOING CEDEX », code 59331 — un vrai CHRS, écarté par son seul code
     postal avant la correction. */
  const evie = FINESS.normaliser({
    finessEge: "590783718", siret: "78385325200071",
    nom: "CENTRE D'HEBGT ET DE RÉADAPTATION SOCIALE EVIE TOURCOING",
    codeCategorie: "214", adresse: "50 BOULEVARD GAMBETTA", codePostal: "59331",
    commune: "TOURCOING CEDEX", lat: 50.71415, lng: 3.158616,
    telephone: "0320280280", dateDerniereMaj: "2025-06-04", etatObjet: "A",
  });
  assert.equal(retenue(evie, "logement"), true);
  assert.equal(evie.type_structure, "chrs");
});

test("le plafond de résultats coupe le plus loin, pas le dernier arrivé", async () => {
  /* LE DÉFAUT QUI VIDAIT « MANGER », MESURÉ.

     75 fiches du pré-calcul national tombent dans les 5 km demandés autour de
     Tourcoing ; le plafond en rend 60. L'unique structure d'aide ALIMENTAIRE de
     la commune — SECOURS POPULAIRE - COMITE DE TOURCOING, à 1 549 m —
     occupait la position 61 dans l'ordre de l'extrait. Elle était coupée d'une
     place par un plafond qui gardait l'ordre du fichier. */
  const handler = (await import("../api/aide-structures.js")).default;
  const reponse = await handler(new Request(
    "https://autour.test/api/aide-structures?lat=50.72360&lng=3.16100&radius=5000&source=dora"));
  const corps = await reponse.json();
  const noms = (corps.items || []).map((item) => String(item.name || item.nom || ""));
  assert.ok(noms.length > 0, "la route doit répondre hors réseau, par le centre pré-calculé");
  assert.ok(noms.some((nom) => /secours populaire/i.test(nom)),
    "la seule aide alimentaire de la commune doit être dans la réponse");

  /* Et la règle elle-même : la liste rendue est croissante en distance. */
  const distance = (a, b) => {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const centre = {lat: 50.7236, lng: 3.1610};
  const distances = (corps.items || []).map((item) => {
    const lat = Number(item.latitude ?? item.lat), lng = Number(item.longitude ?? item.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? distance(centre, {lat, lng}) : Infinity;
  });
  for (let i = 1; i < distances.length; i += 1)
    assert.ok(distances[i] >= distances[i - 1] - 1,
      "la fiche " + i + " est plus proche que la précédente : le tri par distance a sauté");
});

test("une structure écartée par le rayon dit qu'elle existe et à quelle distance", () => {
  assert.match(source, /function aideHorsRayon\(/);
  assert.match(source, /aide-hors-rayon/);
  assert.match(source, /phraseHorsRayonAide\(besoinsSelectionnesAide\(\)\)/);
  /* La phrase ne remplace jamais la liste : elle ne s'affiche qu'à côté d'un
     écran vide, et elle dit un nombre et une distance, pas une promesse. */
  assert.match(source, /au-delà du rayon affiché/);
});
