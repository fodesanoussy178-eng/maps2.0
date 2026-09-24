/* ---------------------------------------------------------------------------
   CE QUE LA FICHE POURRA PROPOSER, ET CE QU'ELLE DEVRA REFUSER

   Ces tests gardent trois promesses faites à l'utilisateur :

   — « Réserver » ne s'affiche que si la source a dit « on s'inscrit ici ».
     Un lien repêché dans une description ne vaut pas billetterie ; il devient
     `website`, et la fiche l'affiche sous « Site web ».
   — « Appeler » compose un numéro réel. Tout ce qui ne se ramène pas à la
     forme E.164 exigée par la contrainte de la table est refusé, parce qu'un
     numéro faux fait sonner chez quelqu'un.
   — Une coordonnée trouvée une fois ne disparaît pas quand la source
     s'appauvrit.
--------------------------------------------------------------------------- */

import assert from "node:assert/strict";
import test from "node:test";

import {
  contactsOpenAgenda, coordonneesDansTexte, telephoneE164,
} from "../supabase/functions/sync-openagenda/contacts.mjs";
import {normalizeOpenAgendaEvent} from "../supabase/functions/sync-openagenda/normalize.mjs";
import {lilleTestSource} from "../supabase/functions/sync-openagenda/config.mjs";
import {fusionnerEvenementFaits} from "../supabase/functions/shared/evenements-canoniques.mjs";

/* La contrainte `events_phone_e164`, recopiée telle quelle : ce que ce test
   accepte doit être ce que la base accepte, sinon la synchronisation tombe. */
const CONTRAINTE_BASE = /^\+[1-9][0-9]{6,14}$/;

const source = lilleTestSource();
const now = new Date("2026-08-20T10:00:00.000Z");

function evenement(overrides = {}) {
  return {
    uid: "78801027",
    title: {fr: "Atelier porte-clef"},
    timezone: "Europe/Paris",
    location: {
      name: "Gare Saint Sauveur",
      address: {streetAddress: "17 bd Jean Baptiste Lebas", postalCode: "59046", addressLocality: "Lille"},
      geo: {latitude: 50.627319, longitude: 3.069793},
    },
    canonicalUrl: "https://openagenda.com/ville-de-lille/events/78801027_atelier",
    timings: [{begin: "2026-09-05T10:00:00+0200", end: "2026-09-05T17:00:00+0200"}],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
test("les trois écritures françaises d'un même numéro donnent le même E.164", () => {
  for (const ecriture of ["03 20 47 50 60", "03.20.47.50.60", "0320475060",
    "+33 3 20 47 50 60", "+33 (0)3 20 47 50 60", "0033 3 20 47 50 60"]) {
    const normalise = telephoneE164(ecriture);
    assert.equal(normalise, "+33320475060", `écriture refusée : ${ecriture}`);
    assert.match(normalise, CONTRAINTE_BASE);
  }
});

test("un numéro que la base refuserait n'est jamais rendu", () => {
  /* « +33 0 3 … » : l'indicatif national et le zéro de service cumulés. La
     forme E.164 générale l'accepterait ; le plan français, non. */
  assert.equal(telephoneE164("+330320475060"), null);
  assert.equal(telephoneE164("12"), null);
  assert.equal(telephoneE164("03 20 47 50"), null);
  assert.equal(telephoneE164("appeler la mairie"), null);
  assert.equal(telephoneE164(""), null);
  assert.equal(telephoneE164(null), null);
});

test("un numéro étranger garde son indicatif au lieu d'être francisé", () => {
  assert.equal(telephoneE164("+32 2 511 24 24"), "+3225112424");
});

/* -------------------------------------------------------------------------- */
test("registration porte le lien, le numéro et l'adresse jusqu'à la fiche", () => {
  const contacts = contactsOpenAgenda({
    registration: [
      {type: "link", value: "https://billetterie.lille.fr/atelier"},
      {type: "phone", value: "03 20 47 50 60"},
      {type: "email", value: "Billetterie@Lille.fr"},
    ],
  });
  assert.deepEqual(contacts, {
    booking_url: "https://billetterie.lille.fr/atelier",
    phone: "+33320475060",
    email: "billetterie@lille.fr",
    website: null,
  });
});

test("une registration sans type est reconnue à la forme de sa valeur", () => {
  const contacts = contactsOpenAgenda({
    registration: ["https://billetterie.lille.fr/atelier", "mailto:info@lille.fr", "03 20 47 50 60"],
  });
  assert.equal(contacts.booking_url, "https://billetterie.lille.fr/atelier");
  assert.equal(contacts.email, "info@lille.fr");
  assert.equal(contacts.phone, "+33320475060");
});

test("une registration illisible ne produit aucun champ plutôt qu'un champ faux", () => {
  const contacts = contactsOpenAgenda({
    registration: [{type: "link", value: "sur place"}, {type: "phone", value: "aux horaires d'ouverture"}],
  });
  assert.deepEqual(contacts, {booking_url: null, phone: null, email: null, website: null});
});

/* -------------------------------------------------------------------------- */
test("le repêchage lit l'URL, le courriel et le numéro d'une description", () => {
  const trouve = coordonneesDansTexte(
    "Renseignements au 03.20.47.50.60, inscriptions sur https://lille.fr/braderie ou par courriel : bonjour@lille.fr.");
  assert.equal(trouve.url, "https://lille.fr/braderie");
  assert.equal(trouve.email, "bonjour@lille.fr");
  assert.equal(trouve.phone, "+33320475060");
});

test("une date écrite en chiffres n'est pas prise pour un numéro", () => {
  assert.equal(coordonneesDansTexte("Ouvert du 01/02/2026 au 05/06/2026, de 10:00 à 18:00").phone, null);
  assert.equal(coordonneesDansTexte("Référence 0320475060123 du dossier").phone, null);
});

test("le lien de la fiche OpenAgenda elle-même n'est pas présenté comme le site", () => {
  const trouve = coordonneesDansTexte(
    "Plus d'informations sur https://openagenda.com/ville-de-lille/events/78801027_atelier",
    {exclure: ["https://openagenda.com/ville-de-lille/events/78801027_atelier"]});
  assert.equal(trouve.url, null);
});

test("un lien repêché dans le texte devient le site, jamais la billetterie", () => {
  const contacts = contactsOpenAgenda(
    {description: {fr: "Tout est expliqué sur https://gare-saint-sauveur.lille.fr"}},
    {textes: ["Tout est expliqué sur https://gare-saint-sauveur.lille.fr"]});
  assert.equal(contacts.booking_url, null);
  assert.equal(contacts.website, "https://gare-saint-sauveur.lille.fr/");
});

test("le site déclaré par l'agenda prime sur celui repêché dans le texte", () => {
  const contacts = contactsOpenAgenda(
    {website: "https://officiel.lille.fr"},
    {textes: ["voir aussi https://ailleurs.example.org"]});
  assert.equal(contacts.website, "https://officiel.lille.fr/");
});

/* -------------------------------------------------------------------------- */
test("la normalisation complète pose les quatre champs et le tarif des conditions", () => {
  const normalized = normalizeOpenAgendaEvent(evenement({
    conditions: {fr: "Tarif unique 5 €, réservation conseillée"},
    registration: [
      {type: "link", value: "https://billetterie.lille.fr/atelier"},
      {type: "phone", value: "03 20 47 50 60"},
    ],
  }), {source, now});
  assert.equal(normalized.event.booking_url, "https://billetterie.lille.fr/atelier");
  assert.equal(normalized.event.phone, "+33320475060");
  assert.match(normalized.event.phone, CONTRAINTE_BASE);
  assert.equal(normalized.event.price_text, "Tarif unique 5 €, réservation conseillée");
  assert.equal(normalized.event.price_amount, 5);
  assert.equal(normalized.event.is_free, false);
  /* L'URL source reste celle de la fiche OpenAgenda : elle n'a pas bougé. */
  assert.equal(normalized.event.source_url, "https://openagenda.com/ville-de-lille/events/78801027_atelier");
});

test("sans registration, la description fournit le numéro et le site", () => {
  const normalized = normalizeOpenAgendaEvent(evenement({
    description: {fr: "Atelier ouvert à tous."},
    longDescription: {fr: "Inscriptions au 03 20 47 50 60 ou sur https://gare-saint-sauveur.lille.fr"},
  }), {source, now});
  assert.equal(normalized.event.phone, "+33320475060");
  assert.equal(normalized.event.website, "https://gare-saint-sauveur.lille.fr/");
  assert.equal(normalized.event.booking_url, null);
});

test("un événement sans aucune coordonnée laisse les quatre champs nuls", () => {
  const normalized = normalizeOpenAgendaEvent(evenement(), {source, now});
  assert.equal(normalized.event.booking_url, null);
  assert.equal(normalized.event.phone, null);
  assert.equal(normalized.event.email, null);
  assert.equal(normalized.event.website, null);
});

/* -------------------------------------------------------------------------- */
test("une synchronisation appauvrie n'efface pas une coordonnée déjà connue", () => {
  const fusion = fusionnerEvenementFaits(
    {phone: "+33320475060", booking_url: "https://billetterie.lille.fr/atelier",
      email: "billetterie@lille.fr", website: "https://lille.fr"},
    {phone: null, booking_url: null, email: "", website: null, title: "Atelier porte-clef"});
  assert.equal(fusion.phone, "+33320475060");
  assert.equal(fusion.booking_url, "https://billetterie.lille.fr/atelier");
  assert.equal(fusion.email, "billetterie@lille.fr");
  assert.equal(fusion.website, "https://lille.fr");
});

test("une coordonnée corrigée à la source remplace bien l'ancienne", () => {
  const fusion = fusionnerEvenementFaits(
    {phone: "+33320475060"},
    {phone: "+33328000000"});
  assert.equal(fusion.phone, "+33328000000");
});
