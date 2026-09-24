/* ---------------------------------------------------------------------------
   LA FICHE D'UN ÉVÉNEMENT — CE QU'ELLE PEUT PROPOSER, ET CE QU'ELLE REFUSE

   Trois boutons de la fiche lisaient des champs de LIEU — `l.url`, `l.tel` —
   qui n'existent jamais sur un événement. « Appeler » et « Site web » étaient
   donc grisés en permanence, y compris sur une fiche dont la base connaissait
   le numéro. Ces tests gardent la correction ET ses limites :

   — « Réserver » ne s'affiche que sur un lien que la SOURCE a désigné comme
     une inscription. Un lien repêché dans une description est rangé dans
     `website` exprès, et n'arrive donc jamais ici.
   — « Appeler » ne compose que de l'E.164 validé.
   — Une liste de séances qui répète le même créneau est pire qu'une plage :
     elle a l'air précise.
--------------------------------------------------------------------------- */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { sourceApplicationSync } from "./source.mjs";

const source = sourceApplicationSync(import.meta.url);
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260920100000_evenements_locaux_contacts.sql", import.meta.url), "utf8");

function charger(fichier) {
  const racine = {};
  new Function("globalThis", "window",
    readFileSync(new URL("../" + fichier, import.meta.url), "utf8"))(racine, racine);
  return racine;
}
const EVENEMENTS = charger("evenements-canoniques.js").AutourEvenements;
const TEMPS = charger("temporel.js").AutourTemps;

const ev = (champs) => EVENEMENTS.normaliserEvenement(Object.assign({title: "Atelier"}, champs));

/* ==========================================================================
   1. LES TROIS RÉPONSES
   ======================================================================== */
test("« Site web » descend du plus précis au plus général", () => {
  assert.equal(
    EVENEMENTS.siteEvenement(ev({booking_url: "https://billet.fr/a", website: "https://site.fr",
      event_source_url: "https://openagenda.com/x"})),
    "https://billet.fr/a");
  assert.equal(
    EVENEMENTS.siteEvenement(ev({website: "https://site.fr", event_source_url: "https://openagenda.com/x"})),
    "https://site.fr/");
  /* La dernière marche mène toujours quelque part : un événement a toujours
     une source. C'est elle qui rend le bouton cliquable au lieu de gris. */
  assert.equal(
    EVENEMENTS.siteEvenement(ev({event_source_url: "https://openagenda.com/x"})),
    "https://openagenda.com/x");
  assert.equal(EVENEMENTS.siteEvenement(ev({})), "");
});

test("un lien qui n'est pas du http(s) ne devient jamais un bouton", () => {
  for (const mauvais of ["javascript:alert(1)", "sur place", "data:text/html,x", "ftp://x.fr"]) {
    assert.equal(EVENEMENTS.siteEvenement(ev({booking_url: mauvais})), "", mauvais);
    assert.equal(EVENEMENTS.reservationUrlEvenement(ev({booking_url: mauvais})), "", mauvais);
  }
});

test("« Appeler » ne compose que de l'E.164 validé", () => {
  assert.equal(EVENEMENTS.telephoneEvenement(ev({phone: "+33320475060"})), "+33320475060");
  for (const mauvais of ["03 20 47 50 60", "0320475060", "+330320475060", "appeler la mairie", ""]) {
    assert.equal(EVENEMENTS.telephoneEvenement(ev({phone: mauvais})), "", JSON.stringify(mauvais));
  }
});

test("« Réserver » ne vient QUE de booking_url", () => {
  assert.equal(EVENEMENTS.reservationUrlEvenement(ev({booking_url: "https://billet.fr/a"})),
    "https://billet.fr/a");
  /* Un site d'organisateur n'est pas une billetterie, et une fiche source
     encore moins. Les proposer sous « Réserver » ferait cliquer pour rien. */
  assert.equal(EVENEMENTS.reservationUrlEvenement(ev({website: "https://site.fr"})), "");
  assert.equal(EVENEMENTS.reservationUrlEvenement(ev({event_source_url: "https://openagenda.com/x"})), "");
});

test("la phrase de la source passe avant le booléen", () => {
  assert.equal(EVENEMENTS.reservationEvenement(ev({reservation_text: "Inscriptions à la billetterie."})),
    "Inscriptions à la billetterie.");
  assert.equal(EVENEMENTS.reservationEvenement(ev({reservation_required: true})), "Réservation obligatoire");
  assert.equal(EVENEMENTS.reservationEvenement(ev({booking_url: "https://billet.fr/a"})), "Réservation en ligne");
  assert.equal(EVENEMENTS.reservationEvenement(ev({})), "Réservation à vérifier");
});

/* ==========================================================================
   2. LES SÉANCES
   ======================================================================== */
const seance = (debut, fin) => ({start_at: debut, end_at: fin || null, timezone: "Europe/Paris"});

test("les séances sont groupées par jour et leurs créneaux listés", () => {
  const rendu = TEMPS.libelleSeances([
    seance("2026-09-21T06:00:00Z", "2026-09-21T16:00:00Z"),
    seance("2026-09-20T08:00:00Z", "2026-09-20T16:00:00Z"),
    seance("2026-09-21T07:00:00Z", "2026-09-21T16:00:00Z"),
  ]);
  assert.equal(rendu.jours.length, 2);
  assert.equal(rendu.jours[0].jour, "Dimanche 20 septembre");
  assert.deepEqual(rendu.jours[0].creneaux, ["10h00–18h00"]);
  assert.deepEqual(rendu.jours[1].creneaux, ["08h00–18h00", "09h00–18h00"]);
});

test("le même créneau vu par deux sources n'apparaît qu'une fois", () => {
  const rendu = TEMPS.libelleSeances([
    seance("2026-09-20T08:00:00Z", "2026-09-20T16:00:00Z"),
    seance("2026-09-20T08:00:00Z", "2026-09-20T16:00:00Z"),
    seance("2026-09-20T08:00:00Z", "2026-09-20T16:00:00Z"),
  ]);
  assert.deepEqual(rendu.jours[0].creneaux, ["10h00–18h00"]);
});

test("une séance sans fin n'affiche que son heure de début", () => {
  const rendu = TEMPS.libelleSeances([seance("2026-09-20T08:00:00Z", null)]);
  assert.deepEqual(rendu.jours[0].creneaux, ["10h00"]);
});

test("la liste est bornée et dit ce qu'elle n'affiche pas", () => {
  const jours = [];
  for (let i = 1; i <= 12; i += 1) jours.push(seance("2026-10-" + String(i).padStart(2, "0") + "T08:00:00Z"));
  const rendu = TEMPS.libelleSeances(jours, {maximum: 5});
  assert.equal(rendu.jours.length, 5);
  assert.equal(rendu.restantes, 7);
});

test("aucune séance ne produit aucune ligne, jamais une ligne vide", () => {
  assert.deepEqual(TEMPS.libelleSeances([]), {jours: [], restantes: 0});
  assert.deepEqual(TEMPS.libelleSeances(null), {jours: [], restantes: 0});
  assert.deepEqual(TEMPS.libelleSeances([{start_at: "pas une date"}]), {jours: [], restantes: 0});
});

/* ==========================================================================
   3. CE QUE LA FICHE ÉCRIT
   ======================================================================== */
test("les boutons d'un événement lisent l'événement, plus le lieu", () => {
  assert.match(source, /const tel = evenement\s*\?\s*\(EVENEMENTS && EVENEMENTS\.telephoneEvenement/);
  assert.match(source, /const site = evenement\s*\n?\s*\?\s*\(EVENEMENTS && EVENEMENTS\.siteEvenement/);
  assert.match(source, /\(tel \? '<a class="act" href="tel:'\+esc\(tel\)/);
  /* Et l'absence grise encore : un bouton actif qui ne mène nulle part est
     pire que son absence. */
  assert.match(source, /disabled aria-label="Téléphone non renseigné"/);
  assert.match(source, /disabled aria-label="Site non renseigné"/);
});

test("la ligne du tarif porte la billetterie, et la réservation est cliquable", () => {
  assert.match(source, /<dt>Tarif &amp; billetterie<\/dt>/);
  assert.match(source, /resaUrl \? ' <a class="prix-tag g" href="'\+esc\(resaUrl\)/);
  assert.match(source, /<dt>Réservation<\/dt><dd>'\+\s*\n?\s*\(resaUrl/);
});

test("les séances passent par une question, pas par la table", () => {
  assert.match(source, /sbLecture\.rpc\("evenement_seances", \{\s*\n?\s*p_event_id:l\.dbId/);
  /* La table porte `raw_data` et n'accorde rien à `anon` : si quelqu'un la
     lisait directement, il faudrait l'ouvrir. */
  assert.doesNotMatch(source, /from\("event_occurrences"\)|rpc\("event_occurrences"/);
  /* Une séance unique est déjà dite par la ligne « Quand ». */
  assert.match(source, /if\(rendu\.jours\.length < 2 && creneaux < 2\) return;/);
});

test("la croix de fermeture a sa colonne, et le titre ne passe plus dessous", () => {
  assert.match(index, /#feuille \.d-haut,#feuille h2\.titre\{padding-right:60px\}/);
});

/* ==========================================================================
   4. CE QUI SORT DE LA BASE
   ======================================================================== */
test("evenements_locaux transporte les trois champs affichés, et pas l'adresse", () => {
  assert.match(migration, /e\.reservation_text, e\.booking_url, e\.phone, e\.website,/);
  assert.match(migration, /^\s*booking_url text,$/m);
  assert.match(migration, /^\s*phone text,$/m);
  assert.match(migration, /^\s*website text,$/m);
  /* `email` reste dehors : la fiche ne propose pas d'écrire, donc rien ne
     justifie de l'envoyer sur le réseau de quelqu'un. */
  assert.doesNotMatch(migration, /e\.email/);
  assert.doesNotMatch(migration, /^\s*email text,$/m);
});

test("la liste de colonnes et la liste de valeurs ont la même longueur", () => {
  /* Un décalage d'une seule colonne ne se voit qu'à l'exécution, sur une RPC
     que toute la carte appelle. */
  const entete = migration.slice(migration.indexOf("returns table ("), migration.indexOf("language sql"));
  const colonnes = (entete.match(/^\s+\w+ [a-z]/gm) || []).length;
  const corps = migration.slice(migration.indexOf("as $function$"), migration.indexOf("from public.events e"));
  /* Les virgules d'un appel — `event_temporal_status(a, b, c, d, now())` — ne
     séparent pas des colonnes. On réduit donc chaque parenthèse à un jeton
     avant de compter, sinon le compteur accuse la RPC de son propre défaut. */
  let sansAppels = corps.split("select")[1];
  for (let passe = 0; passe < 8; passe += 1) sansAppels = sansAppels.replace(/\([^()]*\)/g, "");
  const valeurs = sansAppels.split(",").length;
  assert.equal(colonnes, 59, "59 colonnes déclarées");
  assert.equal(valeurs, 59, "59 valeurs sélectionnées");
});
