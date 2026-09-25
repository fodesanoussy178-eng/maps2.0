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
/* `autour.css` porte les règles de style depuis qu'elles ont quitté
   `index.html` : la source lue ici reste « le document et sa feuille ». */
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8") + "\n" +
  readFileSync(new URL("../autour.css", import.meta.url), "utf8");
const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const migration = lire("supabase/migrations/20260920100000_evenements_locaux_contacts.sql");

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
  /* Un seul créneau ce jour-là : la plage le décrit bien. */
  assert.deepEqual(rendu.jours[0].creneaux, ["10h00–18h00"]);
  /* DEUX SÉANCES NE SONT PAS DEUX PLAGES. Mesuré sur une vraie fiche
     (« Eternelle Notre-Dame », 116 occurrences) : chaque occurrence porte son
     heure de début et, comme fin, l'heure de FERMETURE DU LIEU. Écrire
     « 08h00–18h00 / 09h00–18h00 » donnait deux séances de dix heures qui se
     chevauchent. On n'écrit donc que les débuts, et la fermeture une fois. */
  assert.deepEqual(rendu.jours[1].creneaux, ["08h00", "09h00"]);
  assert.equal(rendu.jours[1].fin, "18h00");
  assert.equal(rendu.jours[0].fin, null, "une séance seule n'a pas de fermeture à part");
});

test("trois séances d'un même jour s'écrivent « 14h00 / 16h30 / 20h30 »", () => {
  const rendu = TEMPS.libelleSeances([
    seance("2026-10-02T12:00:00Z", "2026-10-02T21:00:00Z"),
    seance("2026-10-02T14:30:00Z", "2026-10-02T21:00:00Z"),
    seance("2026-10-02T18:30:00Z", "2026-10-02T21:00:00Z"),
  ]);
  assert.deepEqual(rendu.jours[0].creneaux, ["14h00", "16h30", "20h30"]);
  assert.equal(rendu.jours[0].fin, "23h00");
});

test("des fins réellement différentes restent des plages distinctes", () => {
  const rendu = TEMPS.libelleSeances([
    seance("2026-10-02T12:00:00Z", "2026-10-02T14:00:00Z"),
    seance("2026-10-02T16:00:00Z", "2026-10-02T18:00:00Z"),
  ]);
  assert.deepEqual(rendu.jours[0].creneaux, ["14h00–16h00", "18h00–20h00"]);
  assert.equal(rendu.jours[0].fin, null);
});

test("la fiche sépare les séances par « / » et ne dit la fermeture qu'une fois", () => {
  const ecrans = readFileSync(new URL("../differe/ecrans.js", import.meta.url), "utf8");
  const bloc = ecrans.slice(ecrans.indexOf("async function chargerSeances"),
    ecrans.indexOf("async function chargerCanal"));
  assert.match(bloc, /creneaux\.join\(" \/ "\)/,
    "le séparateur des séances est « / », jamais un tiret de plage");
  assert.match(bloc, /j\.fin \?/, "la fermeture commune est dite à part");
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
  /* La ligne est passée de « lien ou rien » à « lien, numéro ou adresse » :
     c'est `lienResa` qui décide maintenant, pas la seule URL. */
  assert.match(source, /<dt>Réservation<\/dt><dd>'\+\s*\n?\s*\(lienResa/);
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
test("evenements_locaux transporte les moyens de joindre, SANS l'adresse", () => {
  /* LE CHOIX A ÉTÉ RETOURNÉ DEUX FOIS, ET LA MESURE A TRANCHÉ. `email` avait
     été exposée au nom de « on expose ce qui est AFFICHÉ » : la ligne
     « Réservation » propose d'écrire quand il n'y a ni lien ni numéro.
     Chiffré ensuite, sur 3 871 événements : 184 portent une adresse, et DEUX
     n'ont que ça pour tout contact. Mesuré aussi côté API, avec la clé
     publiable : `GET /rest/v1/events?select=email` rendait la liste à un
     anonyme. Deux fiches y gagnaient un `mailto:`, cent quatre-vingt-quatre
     organisateurs y perdaient le fait que leur adresse ne se récolte pas en
     une requête. La RPC ne la transporte plus (voir la migration
     20260925010000, qui porte la mesure). */
  const rpc = lire("supabase/migrations/20260925010000_evenements_email_hors_chemin_public.sql");
  assert.match(rpc, /e\.reservation_text, e\.booking_url, e\.phone, e\.website,/);
  assert.ok(!/e\.email/.test(rpc), "l'adresse ne descend plus dans le navigateur");
  for (const colonne of ["booking_url", "phone", "website"])
    assert.match(rpc, new RegExp("(^|\\s)" + colonne + " text,"), colonne);
  /* La colonne reste en base : elle documente la provenance, et c'est elle que
     l'exception de la garde e-mail nomme. */
  assert.match(migration, /(^|\s)email text,/);
});

test("la liste de colonnes et la liste de valeurs ont la même longueur", () => {
  /* Un décalage d'une seule colonne ne se voit qu'à l'exécution, sur une RPC
     que toute la carte appelle. */
  const rpc = lire("supabase/migrations/20260925010000_evenements_email_hors_chemin_public.sql");
  const entete = rpc.slice(rpc.indexOf("returns table ("), rpc.indexOf("language sql"));
  const colonnes = (entete.match(/^\s+\w+ [a-z]/gm) || []).length;
  const corps = rpc.slice(rpc.indexOf("as $function$"), rpc.indexOf("from public.events e"));
  /* Les virgules d'un appel — `event_temporal_status(a, b, c, d, now())` — ne
     séparent pas des colonnes. On réduit donc chaque parenthèse à un jeton
     avant de compter, sinon le compteur accuse la RPC de son propre défaut. */
  let sansAppels = corps.split("select")[1];
  for (let passe = 0; passe < 8; passe += 1) sansAppels = sansAppels.replace(/\([^()]*\)/g, "");
  const valeurs = sansAppels.split(",").length;
  assert.equal(colonnes, 59, "59 colonnes déclarées — 60 moins l'adresse");
  assert.equal(valeurs, 59, "59 valeurs sélectionnées");
});

/* ==========================================================================
   5. RÉSERVER PAR OÙ — LES TROIS MOYENS
   ======================================================================== */
test("la ligne Réservation mène quelque part : lien, numéro ou adresse", () => {
  assert.equal(EVENEMENTS.lienReservationEvenement(ev({booking_url: "https://billet.fr/a"})).genre, "url");
  assert.equal(EVENEMENTS.lienReservationEvenement(ev({phone: "+33320475060"})).href, "tel:+33320475060");
  assert.equal(EVENEMENTS.lienReservationEvenement(ev({email: "Info@Lille.FR"})).href, "mailto:info@lille.fr");
  /* Rien de fabriqué : sans moyen, la phrase reste une phrase. */
  assert.equal(EVENEMENTS.lienReservationEvenement(ev({})), null);
  /* Un numéro que la base refuserait ne devient pas un `tel:`. */
  assert.equal(EVENEMENTS.lienReservationEvenement(ev({phone: "0320475060"})), null);
});

test("l'ordre est celui du moindre effort pour qui lit", () => {
  const tout = ev({booking_url: "https://billet.fr/a", phone: "+33320475060", email: "a@b.fr"});
  assert.equal(EVENEMENTS.lienReservationEvenement(tout).genre, "url");
  const sansLien = ev({phone: "+33320475060", email: "a@b.fr"});
  assert.equal(EVENEMENTS.lienReservationEvenement(sansLien).genre, "telephone");
});

test("un mailto ne s'ouvre pas dans un onglet neuf", () => {
  /* `target=_blank` sur un `mailto:` laisse un onglet vide derrière le client
     de messagerie. La fiche ne le pose que sur les liens externes. */
  assert.match(source, /lienResa\.externe \? ' target="_blank" rel="noopener"' : ''/);
});
