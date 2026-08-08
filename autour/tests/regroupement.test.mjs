import test from "node:test";
import assert from "node:assert/strict";
import "../core.js";

const {
  normalizePlaceName, placeFamily, groupLogicalPlaces, parseSearchQuery, toCommonItem,
} = globalThis.AutourCore;

/* distance équirectangulaire, suffisante aux échelles où l'on regroupe */
function distance(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos((aLat + bLat) * rad / 2);
  const y = (bLat - aLat) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

const lieu = (id, titre, cat, dLat, dLng, extra) => toCommonItem(Object.assign({
  id, titre, cat, lat: 50.7167 + dLat, lng: 3.1611 + dLng,
}, extra), { source: "osm" });

/* ---- Normalisation des noms -------------------------------------------- */

test("le rôle de l'objet disparaît du nom d'un lieu de transport", () => {
  const attendu = "phalempins";
  for (const nom of ["Phalempins", "Métro Phalempins", "Station Phalempins",
                     "Arrêt Phalempins", "Phalempins - Quai 2", "Phalempins (direction CHU)"])
    assert.equal(normalizePlaceName(nom, "transport"), attendu, nom);
});

test("hors transport, le nom garde ses mots : deux commerces ne se confondent pas", () => {
  // « station » est un mot de rôle SEULEMENT pour un transport ; une
  // station-service reste une station-service
  assert.notEqual(normalizePlaceName("Station Total", "autre"),
                  normalizePlaceName("Total", "autre"));
});

test("la famille se lit dans les catégories, pas dans le titre", () => {
  assert.equal(placeFamily(lieu("a", "Phalempins", "metro", 0, 0)), "transport");
  assert.equal(placeFamily(lieu("b", "Phalempins", "bus", 0, 0)), "transport");
  assert.equal(placeFamily(lieu("c", "Le Phalempins", "bar", 0, 0)), "autre");
});

/* ---- Regroupement d'un pôle -------------------------------------------- */

test("un pôle d'échange devient un seul objet visuel", () => {
  // objets tels qu'OpenStreetMap les décrit réellement : une station, deux
  // bouches, un arrêt de bus par sens
  const pole = [
    lieu("n1", "Phalempins", "metro", 0, 0),
    lieu("n2", "Métro Phalempins", "metro", 0.00035, 0.0002),
    lieu("n3", "Phalempins - Quai 2", "metro", -0.0003, 0.0004),
    lieu("n4", "Phalempins", "bus", 0.0009, -0.0006),
    lieu("n5", "Phalempins (direction CHU)", "bus", -0.0011, 0.0008),
  ];
  const groupes = groupLogicalPlaces(pole, distance);
  assert.equal(groupes.length, 1, "cinq objets, un seul lieu");
  assert.equal(groupes[0].nbRegroupes, 5);
  assert.equal(groupes[0].regroupes.length, 4);
  // la station de métro représente le pôle, pas un arrêt de bus
  assert.equal(groupes[0].cat, "metro");
  // et le pôle reste trouvable par « bus »
  assert.ok(groupes[0].categories.includes("bus"));
});

test("le nom le plus court suffit quand l'autre le contient", () => {
  const gare = [
    lieu("g1", "Gare Lille Flandres", "train", 0, 0),
    lieu("g2", "Lille Flandres", "metro", 0.0004, 0.0003),
  ];
  assert.equal(groupLogicalPlaces(gare, distance).length, 1);
});

test("deux arrêts homonymes éloignés restent deux objets", () => {
  // 350 m est le rayon des pôles à nom identique : au-delà, deux endroits
  const loin = [
    lieu("a", "République", "metro", 0, 0),
    lieu("b", "République", "metro", 0.02, 0.02),
  ];
  assert.equal(groupLogicalPlaces(loin, distance).length, 2);
});

test("un nom identique tolère plus de distance qu'un nom inclus", () => {
  // 160 m : au-delà des 120 m du dédoublonnage historique, mais deux relevés
  // du même commerce importés de sources différentes dérivent d'autant
  const memeNom = [
    lieu("a", "Le Bistrot des Halles", "resto", 0, 0),
    lieu("b", "Le Bistrot des Halles", "resto", -0.00128, 0.0008),
  ];
  assert.equal(groupLogicalPlaces(memeNom, distance).length, 1,
    "noms identiques à 160 m : un seul lieu");

  // preuve plus faible — l'un contient l'autre — donc rayon plus serré
  const nomInclus = [
    lieu("c", "Marché", "marche", 0, 0),
    lieu("d", "Marché de Wazemmes", "marche", -0.00128, 0.0008),
  ];
  assert.equal(groupLogicalPlaces(nomInclus, distance).length, 2,
    "nom seulement inclus à 160 m : deux lieux");
});

test("deux commerces homonymes à plusieurs centaines de mètres restent deux", () => {
  const branches = [
    lieu("a", "Boulangerie Delcourt", "commerce", 0, 0),
    lieu("b", "Boulangerie Delcourt", "commerce", -0.0058, -0.0008),
  ];
  assert.equal(groupLogicalPlaces(branches, distance).length, 2,
    "650 m : deux boutiques, pas un doublon");
});

test("un nom trop court ne sert pas de point commun", () => {
  // « gd » après nettoyage : quatre lettres, on ne fusionne pas là-dessus
  const courts = [
    lieu("a", "CHU", "metro", 0, 0),
    lieu("b", "CHU Eurasanté", "bus", 0.0002, 0.0002),
  ];
  const groupes = groupLogicalPlaces(courts, distance);
  assert.equal(groupes.length, 2, "trois lettres ne suffisent pas à fusionner");
});

test("le regroupement ne touche pas aux commerces voisins mais distincts", () => {
  const commerces = [
    lieu("a", "Boulangerie Paul", "commerce", 0, 0),
    lieu("b", "Pharmacie du Centre", "sante", 0.0001, 0.0001),
  ];
  assert.equal(groupLogicalPlaces(commerces, distance).length, 2);
});

test("deux événements au même endroit restent deux propositions", () => {
  const soir = Date.now() + 3600e3;
  const evenements = [
    lieu("e1", "Concert", "event", 0, 0, { isTemporary: true, debutLe: soir }),
    lieu("e2", "Concert", "event", 0, 0, { isTemporary: true, debutLe: soir + 7200e3 }),
  ];
  assert.equal(groupLogicalPlaces(evenements, distance).length, 2);
});

test("un objet sans nom n'est jamais regroupé avec un autre sans nom", () => {
  const anonymes = [
    lieu("a", "", "bus", 0, 0),
    lieu("b", "", "bus", 0.0001, 0),
  ];
  assert.equal(groupLogicalPlaces(anonymes, distance).length, 2);
});

/* ---- Requêtes composées ------------------------------------------------- */

const INTENTIONS = new Set(["cinema", "cinéma", "restaurant", "restaurants", "sortir",
                            "activité enfant", "activité", "bar"]);
const isIntent = (t) => INTENTIONS.has(String(t).toLowerCase());

test("une requête composée sépare intention et destination", () => {
  const cas = [
    ["cinéma Lille",            "cinéma",          "Lille"],
    ["restaurant Roubaix",      "restaurant",      "Roubaix"],
    ["sortir Lille",            "sortir",          "Lille"],
    ["activité enfant Tourcoing", "activité enfant", "Tourcoing"],
    ["restaurants à Lille",     "restaurants",     "Lille"],
    ["bar vers Roubaix",        "bar",             "Roubaix"],
  ];
  for (const [entree, intention, destination] of cas) {
    const r = parseSearchQuery(entree, { isIntent });
    assert.equal(r.intention, intention, entree);
    assert.equal(r.destination, destination, entree);
  }
});

test("l'intention la plus longue gagne", () => {
  // « activité enfant » et « activité » sont tous deux connus : couper au plus
  // long laisse la bonne destination
  const r = parseSearchQuery("activité enfant Tourcoing", { isIntent });
  assert.equal(r.intention, "activité enfant");
  assert.equal(r.destination, "Tourcoing");
});

test("une ville seule est une destination, une catégorie seule une intention", () => {
  assert.deepEqual(
    { i: parseSearchQuery("Lille", { isIntent }).intention, d: parseSearchQuery("Lille", { isIntent }).destination },
    { i: "", d: "Lille" });
  assert.deepEqual(
    { i: parseSearchQuery("cinéma", { isIntent }).intention, d: parseSearchQuery("cinéma", { isIntent }).destination },
    { i: "cinéma", d: "" });
});

test("une requête vide ne produit rien", () => {
  const r = parseSearchQuery("   ", { isIntent });
  assert.equal(r.intention, "");
  assert.equal(r.destination, "");
});

test("sans vocabulaire fourni, tout est traité comme une destination", () => {
  // aucune supposition : c'est le géocodeur qui tranchera
  const r = parseSearchQuery("cinéma Lille");
  assert.equal(r.intention, "");
  assert.equal(r.destination, "cinéma Lille");
});

test("la saisie entière se juge plus strictement qu'un début de phrase", () => {
  // « Bar-le-Duc » contient « bar » : tolérer la sous-chaîne sur la saisie
  // entière confisquait la commune, qui n'était donc jamais géocodée
  const large = (t) => /bar/i.test(t);            // reconnaissance par sous-chaîne
  const strict = (t) => /^bar$/i.test(t);         // égalité exacte

  const commune = parseSearchQuery("Bar-le-Duc", {isIntent: large, isWholeIntent: strict});
  assert.equal(commune.intention, "");
  assert.equal(commune.destination, "Bar-le-Duc");

  const boisson = parseSearchQuery("bar", {isIntent: large, isWholeIntent: strict});
  assert.equal(boisson.intention, "bar");
  assert.equal(boisson.destination, "");

  // en tête de phrase, la tolérance reste utile
  const compose = parseSearchQuery("bar à vin Roubaix", {isIntent: large, isWholeIntent: strict});
  assert.equal(compose.destination, "Roubaix");

  // sans isWholeIntent, le comportement d'avant est conservé
  const defaut = parseSearchQuery("Bar-le-Duc", {isIntent: large});
  assert.equal(defaut.intention, "Bar-le-Duc");
});

/* ---- Destination en tête de phrase -------------------------------------- */

const EST_LIEU = new Set(["lille", "paris", "roubaix", "tourcoing", "bar-le-duc"]);
const isDestination = (t) => EST_LIEU.has(String(t).toLowerCase());

test("la destination peut précéder l'intention", () => {
  const opts = {isIntent, isDestination, isWholeIntent: (t) => INTENTIONS.has(String(t).toLowerCase())};
  for (const [entree, intention, destination] of [
    ["Lille restaurant",        "restaurant", "Lille"],
    ["Paris cinéma",            "cinéma",     "Paris"],
    ["Roubaix bar",             "bar",        "Roubaix"],
    ["Tourcoing activité enfant","activité enfant","Tourcoing"],
  ]) {
    const r = parseSearchQuery(entree, opts);
    assert.equal(r.intention, intention, entree);
    assert.equal(r.destination, destination, entree);
  }
});

test("on ne coupe pas sur un morceau qui ne peut pas être un lieu", () => {
  const opts = {isIntent, isDestination, isWholeIntent: (t) => INTENTIONS.has(String(t).toLowerCase())};
  // « restaurant » est une intention, mais « indien » n'est pas un lieu :
  // couper là visait une destination inexistante et la carte ne bougeait pas
  const r = parseSearchQuery("restaurant indien", opts);
  assert.equal(r.destination, "");
  assert.equal(r.intention, "restaurant indien");
});

test("une phrase commençant par un mot du vocabulaire est une demande", () => {
  const opts = {isIntent, isDestination, isWholeIntent: (t) => INTENTIONS.has(String(t).toLowerCase())};
  assert.equal(parseSearchQuery("bar à vin", opts).destination, "");
  // alors qu'un nom propre inconnu du vocabulaire reste une destination
  assert.equal(parseSearchQuery("Bar-le-Duc", opts).intention, "");
  assert.equal(parseSearchQuery("Bar-le-Duc", opts).destination, "Bar-le-Duc");
});

test("un chiffre dans un nom n'est effacé que pour un transport", () => {
  // « Quai 2 » distingue deux accès du même pôle ; « Bistrot 33 » et
  // « Bistrot 44 » sont deux adresses différentes
  assert.equal(normalizePlaceName("Phalempins - Quai 2", "transport"),
               normalizePlaceName("Phalempins - Quai 3", "transport"));
  assert.notEqual(normalizePlaceName("Bistrot 33", "autre"),
                  normalizePlaceName("Bistrot 44", "autre"));

  // et sur la carte : deux enseignes numérotées voisines restent deux lieux
  const numerotes = [
    lieu("a", "Restaurant 3", "resto", 0, 0),
    lieu("b", "Restaurant 7", "resto", 0.0008, 0.0006),
  ];
  assert.equal(groupLogicalPlaces(numerotes, distance).length, 2);
});
