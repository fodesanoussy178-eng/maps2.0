import assert from "node:assert/strict";
import test from "node:test";

import "../explications.js";

const E = globalThis.AutourExplications;
const {explication, resumeCourt, resumeGoogle, SOURCES} = E;

test("le résumé publié par Google passe avant tout le reste", () => {
  const l = {titre:"Restos du Cœur", cat:"alimentaire",
    resumeGoogle:"Antenne ouverte les mardis et jeudis matin."};
  const e = explication(l);
  assert.equal(e.source, SOURCES.GOOGLE);
  assert.equal(e.generique, false);
  assert.equal(e.texte, "Antenne ouverte les mardis et jeudis matin.");
  assert.match(e.mention, /Google/);
});

test("à défaut, la description du lieu dans OpenStreetMap", () => {
  const l = {titre:"Le Relais", cat:"asso", tags:{description:"Vestiaire ouvert le samedi."}};
  const e = explication(l);
  assert.equal(e.source, SOURCES.OSM);
  assert.equal(e.generique, false);
  assert.equal(e.texte, "Vestiaire ouvert le samedi.");
});

test("à défaut, ce que fait le réseau — reconnu par le nom, partout en France", () => {
  // aucune règle de ville : c'est le nom qui identifie le réseau
  for (const nom of ["Mission Locale de Tourcoing", "Mission locale de Marseille",
                     "MISSION LOCALE PARIS 18E"]) {
    const e = explication({titre:nom, cat:"emploi"});
    assert.equal(e.source, SOURCES.RESEAU);
    assert.equal(e.generique, true);
    assert.match(e.texte, /16-25 ans/);
  }
});

test("les grands réseaux d'aide sont expliqués", () => {
  const attendus = [
    ["Restos du Cœur Lille-Sud", /alimentaire/i],
    ["Les Restaurants du Coeur", /alimentaire/i],
    ["Secours Populaire Français", /vestiaire/i],
    ["Secours Catholique", /[ée]coute/i],
    ["Croix-Rouge française", /premiers secours/i],
    ["Banque Alimentaire du Nord", /redistribue/i],
    ["Emmaüs Roubaix", /occasion/i],
    ["CCAS de Tourcoing", /mairie/i],
    ["France Travail Lille Fives", /demandeur d’emploi/i],
    ["Cap Emploi 59", /handicap/i],
    ["Épicerie solidaire du quartier", /courses/i],
    ["Accueil de jour La Halte", /sans rendez-vous/i],
    ["Maison France Services", /d[ée]marches/i],
  ];
  for (const [nom, motif] of attendus) {
    const e = explication({titre:nom, cat:"asso"});
    assert.ok(e.texte, nom + " doit être expliqué");
    assert.match(e.texte, motif, nom);
  }
});

test("à défaut d'un réseau connu, le tag OpenStreetMap explique le type", () => {
  const cas = [
    [{social_facility:"food_bank"}, /denr[ée]es/i],
    [{social_facility:"soup_kitchen"}, /repas chauds/i],
    [{social_facility:"shelter"}, /115/],
    [{social_facility:"clothing_bank"}, /v[êe]tements/i],
    [{amenity:"social_centre"}, /quartier/i],
    [{healthcare:"centre"}, /tiers payant/i],
    [{amenity:"toilets"}, /toilettes/i],
  ];
  for (const [tags, motif] of cas) {
    const e = explication({titre:"Structure sans nom connu", cat:"asso", tags});
    assert.equal(e.source, SOURCES.TYPE);
    assert.match(e.texte, motif, JSON.stringify(tags));
  }
});

test("le public accueilli est dit quand OpenStreetMap le précise", () => {
  const e = explication({titre:"Halte de nuit", cat:"hebergement",
    tags:{social_facility:"shelter", "social_facility:for":"homeless;women"}});
  assert.equal(e.public, "Public accueilli : personnes sans logement, femmes.");
});

test("en dernier recours, la catégorie — et jamais rien d'inventé", () => {
  const e = explication({titre:"Association du coin", cat:"hebergement"});
  assert.equal(e.source, SOURCES.CATEGORIE);
  assert.match(e.texte, /115/);
  // un lieu hors du champ de l'aide n'a pas d'explication fabriquée
  const rien = explication({titre:"Le Bistrot des Halles", cat:"resto"});
  assert.equal(rien.texte, "");
  assert.equal(rien.source, null);
});

test("l'origine du texte est toujours dite", () => {
  const google = explication({titre:"X", cat:"asso", resumeGoogle:"Texte."});
  const type   = explication({titre:"X", cat:"asso", tags:{social_facility:"food_bank"}});
  assert.match(google.mention, /Google/);
  assert.match(type.mention, /type de structure/);
  // une explication de réseau ne se présente jamais comme écrite par le lieu
  assert.equal(explication({titre:"Restos du Cœur", cat:"alimentaire"}).generique, true);
});

test("le résumé court tient sur une ligne sans couper un mot", () => {
  const l = {titre:"CCAS de Roubaix", cat:"asso"};
  const court = resumeCourt(l, 60);
  assert.ok(court.length <= 62, court);
  assert.doesNotMatch(court, /\s…$/);
  // une phrase déjà courte n'est pas tronquée
  assert.equal(resumeCourt({titre:"X", cat:"asso", resumeGoogle:"Court."}, 60), "Court.");
});

test("les deux formes de résumé Google sont lues, jamais les avis", () => {
  assert.equal(resumeGoogle({generativeSummary:{overview:{text:"A"}}}), "A");
  assert.equal(resumeGoogle({generativeSummary:{description:{text:"B"}}}), "B");
  assert.equal(resumeGoogle({editorialSummary:{text:"C"}}), "C");
  // le résumé d'avis raconte une expérience, pas un service : il est ignoré
  assert.equal(resumeGoogle({reviewSummary:{text:{text:"Très bon accueil !"}}}), "");
  assert.equal(resumeGoogle({}), "");
  assert.equal(resumeGoogle(null), "");
});

test("aucune règle ne dépend d'une ville", () => {
  const source = E.RESEAUX.map(([re]) => String(re)).join(" ");
  for (const ville of ["lille", "tourcoing", "roubaix", "paris", "lyon", "marseille"])
    assert.doesNotMatch(source.toLowerCase(), new RegExp(ville));
});
