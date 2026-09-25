/* CE QUE DATAtourisme PUBLIAIT, ET QUE LA REQUÊTE NE DEMANDAIT PLUS.

   Mesuré en base avant d'écrire une ligne : sur 1 572 événements DATAtourisme,
   `place_name` NULL 1 572 fois, `source_url` NULL 1 572 fois, `website` NULL
   1 566 fois. Le normaliseur cherchait bien un nom de lieu et une URL — mais
   la réponse de l'API ne les contenait pas, parce que passer `fields` REMPLACE
   la sélection par défaut, et que celle-ci contenait `hasContact`.

   Ces tests fixent les deux moitiés : la requête redemande les champs, et le
   normaliseur sait les lire — sans jamais rien fabriquer. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contactsDatatourisme, normaliserEvenement }
  from "../supabase/functions/sync-datatourisme/normalisation.mjs";

const index = readFileSync(new URL("../supabase/functions/sync-datatourisme/index.ts",
  import.meta.url), "utf8");

/* ---- La requête -------------------------------------------------------- */

test("la requête demande à nouveau les agents de contact et le nom du lieu", () => {
  for (const champ of ["hasContact", "hasBookingContact", "isLocatedAt.rdfs:label"]) {
    assert.ok(index.includes(`"${champ}"`), champ + " doit être demandé");
  }
});

test("la sonde n'écrit rien et passe avant l'ouverture d'une course", () => {
  const i = index.indexOf('mode") === "sonde"');
  assert.ok(i > 0, "le mode sonde doit exister");
  assert.ok(i < index.indexOf("const course = await ouvrirCourse"),
    "un diagnostic ne doit pas ouvrir de course de synchronisation");
  /* La sonde ne rend que des chemins de clés et des types, jamais de valeurs. */
  const sonde = index.slice(index.indexOf("async function sonder"),
    index.indexOf("async function poisDeLaZone"));
  assert.match(sonde, /formes/);
  assert.doesNotMatch(sonde, /CLE_DATATOURISME/,
    "aucune clé d'API ne doit approcher la réponse du diagnostic");
});

test("la sonde déployée est fermée, en lecture seule, et ne rend aucune valeur", () => {
  const sonde = readFileSync(new URL("../supabase/functions/sonde-datatourisme/index.ts",
    import.meta.url), "utf8");
  assert.match(sonde, /x-sync-secret/, "la même porte que les synchronisations");
  assert.match(sonde, /memeSecret/);
  /* Aucune écriture : ni REST Supabase, ni table, ni course. */
  for (const interdit of ["rest(", "/rest/v1/", "method: \"POST\"", "event_sync_runs"]) {
    assert.ok(!sonde.includes(interdit), "une sonde n'écrit rien : " + interdit);
  }
  /* Elle ne rend que des chemins et des types — jamais le contenu d'une fiche. */
  assert.match(sonde, /formeDe/);
  assert.ok(!/JSON\.stringify\(\s*(?:charge|lot|poi)\b/.test(sonde),
    "la charge brute ne doit jamais sortir de la sonde");
});

test("la mesure est écrite là où la décision se lit", () => {
  const normalisation = readFileSync(new URL(
    "../supabase/functions/sync-datatourisme/normalisation.mjs", import.meta.url), "utf8");
  /* Le commentaire porte la date, l'échantillon et le verdict : sans eux, la
     prochaine personne re-devinera ce qui a déjà été mesuré. */
  assert.match(normalisation, /100 POI/);
  assert.match(normalisation, /place_name` reste NULL|place_name\s+reste NULL/);
  assert.match(index, /MESURÉ, PAS SUPPOSÉ/);
});

/* ---- La lecture des agents -------------------------------------------- */

test("`hasBookingContact` promet une réservation, `hasContact` seulement un contact", () => {
  const contacts = contactsDatatourisme({
    hasContact: [{"foaf:homepage": ["https://theatre-du-nord.fr/"],
      "schema:telephone": ["03 20 14 24 24"], "schema:email": ["contact@theatre.fr"]}],
    hasBookingContact: [{"foaf:homepage": "https://billetterie.theatre-du-nord.fr/spectacle"}],
  });
  assert.equal(contacts.booking_url, "https://billetterie.theatre-du-nord.fr/spectacle");
  assert.equal(contacts.website, "https://theatre-du-nord.fr/");
  assert.equal(contacts.phone, "+33320142424");
  assert.equal(contacts.email, "contact@theatre.fr");
});

test("un contact seul ne devient jamais une billetterie", () => {
  const contacts = contactsDatatourisme({
    hasContact: [{"foaf:homepage": "https://mairie-exemple.fr"}],
  });
  assert.equal(contacts.booking_url, null, "rien ne dit qu'on réserve là");
  /* `urlPropre` repasse par `new URL()` : la racine reprend sa barre finale. */
  assert.equal(contacts.website, "https://mairie-exemple.fr/");
});

test("les deux dialectes de clés sont lus, préfixé comme nu", () => {
  const prefixe = contactsDatatourisme({
    hasContact: [{"schema:telephone": "+33 3 20 14 24 24", "schema:email": "A@B.FR"}]});
  const nu = contactsDatatourisme({hasContact: [{telephone: "0320142424", email: "a@b.fr"}]});
  assert.equal(prefixe.phone, nu.phone);
  assert.equal(prefixe.email, "a@b.fr");
  assert.equal(nu.email, "a@b.fr");
});

test("un numéro non normalisable n'est pas écrit — la colonne le refuserait", () => {
  const contacts = contactsDatatourisme({
    hasContact: [{"schema:telephone": ["informations au 3960"]}]});
  assert.equal(contacts.phone, null);
});

test("une URL qui n'est pas une URL ne passe pas", () => {
  for (const faux of ["nous contacter", "www.exemple.fr", "javascript:alert(1)", ""]) {
    assert.equal(contactsDatatourisme({hasContact: [{"foaf:homepage": faux}]}).website, null, faux);
  }
});

test("un POI sans agent de contact rend quatre valeurs nulles, pas des chaînes vides", () => {
  assert.deepEqual(contactsDatatourisme({}),
    {booking_url: null, website: null, phone: null, email: null});
  assert.deepEqual(contactsDatatourisme(null),
    {booking_url: null, website: null, phone: null, email: null});
});

test("l'agent le plus complet gagne, et l'ordre de lecture est stable", () => {
  /* Deux agents, le premier muet sur le téléphone : la lecture continue. */
  const contacts = contactsDatatourisme({
    hasContact: [{"schema:email": "a@b.fr"}, {"schema:telephone": "0320142424"}],
  });
  assert.equal(contacts.email, "a@b.fr");
  assert.equal(contacts.phone, "+33320142424");
});

/* ---- Jusqu'à la ligne écrite en base ---------------------------------- */

const POI = {
  type: ["Event", "EntertainmentAndEvent", "CulturalEvent", "Concert"],
  uuid: "5d9f1876-74cc-35cb-9ae1-230fd59457b4",
  label: {"@fr": "Duke Ellington Sacred Concert"},
  lastUpdate: "2026-09-23",
  isLocatedAt: [{
    "rdfs:label": {"@fr": "Temple protestant"},
    geo: {latitude: 49.4421411, longitude: 1.0872528},
    address: [{postalCode: "76000", streetAddress: ["16 Place Martin Luther King"],
      addressLocality: "Rouen"}],
  }],
  takesPlaceAt: [{startDate: "2027-10-10", startTime: "20:00",
    endDate: "2027-10-10", endTime: "21:30"}],
  hasDescription: [{description: {"@fr": "Une tournée de jazz sacré."}}],
  hasContact: [{"foaf:homepage": ["https://temple-rouen.fr/"],
    "schema:telephone": ["02 35 71 00 00"]}],
  hasBookingContact: [{"foaf:homepage": "https://billetterie.example.org/duke"}],
};

test("un POI réel sort avec son lieu nommé et ses quatre coordonnées", () => {
  const sortie = normaliserEvenement(POI, {timeZone: "Europe/Paris"});
  assert.ok(sortie, "le POI doit être accepté");
  /* La lecture du nom de lieu est vérifiée ici sur un POI qui en porte un.
     L'endpoint mesuré n'en sert aucun aujourd'hui (voir le commentaire de
     `normalisation.mjs`) : ce test garde la lecture prête, il ne prétend pas
     que la source la remplit. */
  assert.equal(sortie.event.place_name, "Temple protestant",
    "quand la source nomme le lieu, il doit arriver jusqu'à la colonne");
  assert.equal(sortie.event.booking_url, "https://billetterie.example.org/duke");
  assert.equal(sortie.event.website, "https://temple-rouen.fr/");
  assert.equal(sortie.event.phone, "+33235710000");
  assert.equal(sortie.event.email, null);
  assert.equal(sortie.event.city, "Rouen");
});

test("rien n'est fabriqué : sans agent, les quatre colonnes restent nulles", () => {
  const sansContact = {...POI};
  delete sansContact.hasContact;
  delete sansContact.hasBookingContact;
  const sortie = normaliserEvenement(sansContact, {timeZone: "Europe/Paris"});
  assert.equal(sortie.event.booking_url, null);
  assert.equal(sortie.event.website, null);
  assert.equal(sortie.event.phone, null);
  assert.equal(sortie.event.email, null);
  /* L'identifiant du POI est une ressource RDF : il ne devient jamais un lien
     présenté à une personne. */
  assert.ok(!String(sortie.event.source_url || "").includes("data.datatourisme.fr"));
});
