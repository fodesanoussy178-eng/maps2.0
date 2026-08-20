/* L'ICÔNE DOIT DIRE LE TYPE RÉEL DU LIEU.

   « Phalempins » et « Pont de Neuville » sont deux stations de la ligne 2 du
   métro à Tourcoing. Elles s'affichaient avec une icône de vélo.

   La cause n'était pas la table des tags — elle connaît le métro — mais la
   façon de la lire : `REQUETES.find` rend la PREMIÈRE règle qui correspond,
   dans l'ordre du fichier, et les stations de vélo y sont écrites avant les
   transports. Un objet portant à la fois `station=subway` et un tag de
   stationnement vélo était donc classé « vélo » parce que le vélo venait plus
   haut dans une liste.

   Ces tests exécutent la classification, ils ne relisent pas la source : ils
   posent des tags OSM réels et vérifient le mode obtenu. */

import assert from "node:assert/strict";
import test from "node:test";
import { sourceApplication } from "./source.mjs";

const html = await sourceApplication(import.meta.url);

/* On évalue les morceaux de source qui portent la classification, comme le
   font déjà les tests du coordinateur de sources. */
function tranche(debut, fin) {
  const i = html.indexOf(debut);
  const j = html.indexOf(fin, i);
  assert.ok(i > 0 && j > i, "tranche introuvable : " + debut.slice(0, 48));
  return html.slice(i, j);
}

const CLASSIFICATION = new Function(
  /* `sansAccents` délègue à comprendre.js quand il est chargé ; hors du
     navigateur il n'y a rien à déléguer, et c'est le repli qui travaille. */
  "var COMPRENDRE = null;" +
  tranche("function sansAccents(s){", "\n\n") +
  tranche("const CATS = {", "\n/* ---- L'icône dit le type réel") +
  tranche("const SOUS_TYPES = [", "\n\n/* Mission locale") +
  tranche("const CATS_TRANSPORT = new Set(", "\nlet coucheTransport") +
  tranche("const REQUETES = [", "\n\n/* ---- Les tags trop vagues") +
  "return {CATS, REQUETES, SOUS_TYPES, categorieAffichee, categorieTransport," +
  " modeTransportOsm, modeTransportNom};"
)();

const { CATS, REQUETES, categorieAffichee, categorieTransport, modeTransportOsm } = CLASSIFICATION;

/* Le chemin exact de la production : la règle donne la famille, les tags
   donnent le mode. */
function categoriserOsm(tags) {
  const regle = REQUETES.find(([k, v]) => tags[k] === v);
  if (!regle) return null;
  return categorieTransport(regle[2], tags.name || "", tags);
}

const emojiDe = (tags) => {
  const cat = categoriserOsm(tags);
  return cat ? categorieAffichee({ cat, tags, type: tags.amenity || "" }).emoji : null;
};

/* ======================================================================== */
/*  Les deux stations qui ont motivé le correctif                           */
/* ======================================================================== */

/* Telles qu'OSM les décrit : le mode est porté par `station=subway`, tandis
   que `railway=station` ne dit que « ferroviaire ». L'arceau à vélos de
   l'entrée se retrouve souvent sur le même objet — c'est lui qui gagnait. */
const PHALEMPINS = {
  name: "Phalempins", railway: "station", station: "subway", subway: "yes",
  public_transport: "station", amenity: "bicycle_parking",
};
const PONT_DE_NEUVILLE = {
  name: "Pont de Neuville", railway: "station", station: "subway", subway: "yes",
  public_transport: "station", amenity: "bicycle_parking",
};

test("Phalempins est une station de métro, pas une station de vélo", () => {
  assert.equal(categoriserOsm(PHALEMPINS), "metro");
  assert.equal(emojiDe(PHALEMPINS), "🚇");
});

test("Pont de Neuville est une station de métro, pas une station de vélo", () => {
  assert.equal(categoriserOsm(PONT_DE_NEUVILLE), "metro");
  assert.equal(emojiDe(PONT_DE_NEUVILLE), "🚇");
});

test("une station de métro sans tag vélo reste évidemment du métro", () => {
  assert.equal(emojiDe({ name: "Phalempins", railway: "station", station: "subway" }), "🚇");
  assert.equal(emojiDe({ name: "Pont de Neuville", railway: "subway_entrance" }), "🚇");
});

/* ======================================================================== */
/*  La règle générale : aucun ferroviaire ne peut finir en vélo             */
/* ======================================================================== */

test("aucun objet ferroviaire, métro ou tram n'est classé comme vélo", () => {
  /* Chaque combinaison porte AUSSI un tag vélo : c'est précisément le cas qui
     produisait le bogue. Aucune ne doit ressortir en « velo ». */
  const ferroviaires = [
    { station: "subway" }, { subway: "yes" }, { railway: "subway" },
    { railway: "subway_entrance" }, { railway: "station" }, { railway: "halt" },
    { railway: "tram_stop" }, { station: "light_rail" }, { tram: "yes" },
    { station: "train" }, { train: "yes" },
  ];
  ferroviaires.forEach((base) => {
    ["bicycle_parking", "bicycle_rental"].forEach((velo) => {
      const tags = Object.assign({ name: "Essai" }, base, { amenity: velo });
      const cat = categoriserOsm(tags);
      assert.notEqual(cat, "velo",
        "classé vélo alors que les tags disent le rail : " + JSON.stringify(tags));
      assert.ok(["metro", "tram", "train"].includes(cat),
        "mode ferroviaire attendu, obtenu « " + cat + " » pour " + JSON.stringify(tags));
    });
  });
});

test("le résolveur de mode connaît chaque forme de tag du terrain", () => {
  /* Table unitaire : ce que `modeTransportOsm` sait lire, y compris les
     formes qu'Autour ne va pas chercher lui-même mais qu'une autre source
     peut porter. */
  const formes = [
    [{ station: "subway" }, "metro"], [{ subway: "yes" }, "metro"],
    [{ railway: "subway" }, "metro"], [{ railway: "subway_entrance" }, "metro"],
    [{ railway: "tram_stop" }, "tram"], [{ station: "light_rail" }, "tram"],
    [{ tram: "yes" }, "tram"], [{ light_rail: "yes" }, "tram"],
    [{ railway: "station" }, "train"], [{ railway: "halt" }, "train"],
    [{ station: "train" }, "train"], [{ train: "yes" }, "train"],
    [{ highway: "bus_stop" }, "bus"], [{ amenity: "bus_station" }, "bus"],
    [{ bus: "yes" }, "bus"], [{ trolleybus: "yes" }, "bus"],
    [{ amenity: "bicycle_rental" }, "velo"], [{ amenity: "bicycle_parking" }, "velo"],
  ];
  formes.forEach(([tags, mode]) => {
    assert.equal(modeTransportOsm(tags), mode, JSON.stringify(tags));
  });
});

test("chaque mode réellement collecté porte son propre pictogramme", () => {
  /* De bout en bout, et uniquement sur des combinaisons qu'Autour demande
     vraiment à Overpass : un tag que la table n'interroge pas décrit un objet
     qui n'arrive jamais, et l'affirmer serait se rassurer à vide. */
  const attendus = [
    [{ station: "subway" }, "metro", "🚇"],
    [{ railway: "station", subway: "yes" }, "metro", "🚇"],
    [{ railway: "subway_entrance" }, "metro", "🚇"],
    [{ railway: "tram_stop" }, "tram", "🚋"],
    [{ railway: "tram_stop", station: "light_rail" }, "tram", "🚋"],
    [{ highway: "bus_stop" }, "bus", "🚌"],
    [{ amenity: "bus_station" }, "bus", "🚌"],
    [{ railway: "station" }, "train", "🚆"],
    [{ railway: "halt" }, "train", "🚆"],
    [{ amenity: "bicycle_rental" }, "velo", "🚲"],
    [{ amenity: "bicycle_parking" }, "velo", "🚲"],
  ];
  attendus.forEach(([tags, cat, emoji]) => {
    const complet = Object.assign({ name: "Essai" }, tags);
    assert.equal(categoriserOsm(complet), cat, JSON.stringify(tags));
    assert.equal(emojiDe(complet), emoji, JSON.stringify(tags));
  });
});

test("une gare n'est pas un métro, et un tram n'est pas un bus", () => {
  /* La confusion inverse coûte aussi un trajet : on n'envoie personne
     chercher une bouche de métro devant une gare TER. */
  assert.equal(categoriserOsm({ name: "Tourcoing", railway: "station" }), "train");
  assert.equal(categoriserOsm({ name: "Tourcoing", railway: "station", station: "subway" }), "metro");
  assert.equal(categoriserOsm({ name: "Ligne R", railway: "tram_stop" }), "tram");
  assert.equal(categoriserOsm({ name: "Ligne 12", highway: "bus_stop" }), "bus");
});

/* ======================================================================== */
/*  Le nom ne sert qu'en dernier recours                                    */
/* ======================================================================== */

test("les tags l'emportent toujours sur le nom", () => {
  /* Un nom qui dit « vélo » ne défait pas un tag qui dit « métro ». */
  assert.equal(categoriserOsm({ name: "Station Vélo Phalempins", station: "subway" }), "metro");
  /* Et l'inverse : un nom qui dit « métro » ne transforme pas une vraie
     station V'Lille en station de métro. */
  assert.equal(categoriserOsm({ name: "Métro Phalempins", amenity: "bicycle_rental" }), "velo");
});

test("le nom ne tranche que si aucun tag ne dit le mode", () => {
  const { modeTransportNom } = CLASSIFICATION;
  assert.equal(modeTransportOsm({ public_transport: "station" }), null,
    "un tag générique ne doit pas prétendre connaître le mode");
  assert.equal(modeTransportNom("Métro Phalempins"), "metro");
  assert.equal(modeTransportNom("Gare de Tourcoing"), "train");
  assert.equal(modeTransportNom("Tramway R"), "tram");
  assert.equal(modeTransportNom("Arrêt de bus Leclercq"), "bus");
  assert.equal(modeTransportNom("V'Lille Phalempins"), "velo");
  assert.equal(modeTransportNom("Boulangerie Dupont"), null);
});

/* ======================================================================== */
/*  Les autres familles gardent l'icône de leur type réel                   */
/* ======================================================================== */

test("chaque type courant reçoit le pictogramme de son type, pas d'une famille", () => {
  const attendus = [
    [{ amenity: "restaurant" }, "🍔"], [{ amenity: "fast_food" }, "🍕"],
    [{ amenity: "cafe" }, "☕"],       [{ amenity: "bar" }, "🍺"],
    [{ amenity: "pub" }, "🍺"],        [{ leisure: "park" }, "🌳"],
    [{ leisure: "garden" }, "🌳"],     [{ amenity: "cinema" }, "🎬"],
    [{ amenity: "theatre" }, "🎭"],    [{ tourism: "museum" }, "🖼️"],
    [{ amenity: "library" }, "📚"],
  ];
  attendus.forEach(([tags, emoji]) => {
    assert.equal(emojiDe(Object.assign({ name: "Essai" }, tags)), emoji, JSON.stringify(tags));
  });
});

test("une pharmacie porte une pharmacie, pas un stéthoscope générique", () => {
  /* Le sous-type ne déplace PAS le lieu hors de « santé » : Aide doit
     continuer de le proposer à qui cherche des soins. Seule l'icône change. */
  const pharmacie = { name: "Pharmacie du Centre", amenity: "pharmacy" };
  assert.equal(categoriserOsm(pharmacie), "sante", "la catégorie reste « santé »");
  assert.equal(emojiDe(pharmacie), "💊");
  assert.equal(emojiDe({ name: "Pharmacie Lille", healthcare: "pharmacy" }), "💊");
  /* Les autres lieux de santé gardent l'icône de la famille. */
  assert.equal(emojiDe({ name: "CHU", amenity: "hospital" }), CATS.sante.emoji);
  assert.equal(emojiDe({ name: "Dr Martin", amenity: "doctors" }), CATS.sante.emoji);
});

test("le sous-type ne modifie que l'icône, jamais le reste du descripteur", () => {
  const base = CATS.sante;
  const affine = categorieAffichee({ cat: "sante", tags: { amenity: "pharmacy" }, type: "pharmacy" });
  assert.equal(affine.label, base.label, "le libellé de la famille est conservé");
  assert.equal(affine.eph, base.eph);
  assert.notEqual(affine.emoji, base.emoji);
  assert.equal(base.emoji, "🩺", "le descripteur d'origine n'est pas modifié");
});

/* ======================================================================== */
/*  Le branchement dans la production                                       */
/* ======================================================================== */

test("la conversion OSM passe bien par la résolution de mode", () => {
  assert.match(html,
    /const cat = affinerCategorie\(categorieTransport\(regle\[2\], nom, t\), nom, t\);/,
    "les tags doivent décider du mode avant tout affinage de nom");
});

test("aucun affinage de nom ne peut reclasser un transport", () => {
  assert.match(html, /if\(CATS_TRANSPORT\.has\(cat\)\) return cat;/,
    "un transport établi par ses tags doit sortir intact d'affinerCategorie");
});
