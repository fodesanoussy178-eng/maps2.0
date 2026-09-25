/* ---------------------------------------------------------------------------
   « Y ALLER » DEPUIS UN BON PLAN

   Une carte d'offre était un `<a>` vers le jeu de données source. Un tap
   ouvrait donc data.enseignementsup-recherche.gouv.fr — informatif, mais ce
   n'est pas la question qu'on se pose devant une cafétéria à 800 m. Les trois
   gestes sont maintenant distincts : voir où c'est, y aller, lire la source.

   CE QUE CES TESTS GARDENT

   — Une offre sans position n'écrit AUCUN bouton. Il n'y a rien à centrer, et
     un « Y aller » vers nulle part est pire que son absence.
   — Le lien vers l'organisme reste obligatoire : c'est lui qui rend l'offre
     vérifiable au lieu d'affirmée.
   — La mémoire du choix d'application est VISIBLE et ANNULABLE. Un réglage
     retenu sans moyen de le défaire n'est plus un choix.
   — Le géocodage refuse plutôt que d'approcher : la BAN répond toujours
     quelque chose, et un point à 300 km porterait une distance affichée sans
     hésiter.
--------------------------------------------------------------------------- */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const ecrans = readFileSync(new URL("../differe/ecrans.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
/* Les règles de style ont quitté le document pour `autour.css` ; le poids du
   document, lui, se mesure toujours sur le document. */
const feuilleDeStyle = readFileSync(new URL("../autour.css", import.meta.url), "utf8");
const geo = readFileSync(
  new URL("../supabase/migrations/20260920110000_offres_geocodage_ban.sql", import.meta.url), "utf8");

/* ==========================================================================
   1. LA CARTE
   ======================================================================== */
test("une offre sans position n'écrit ni « Sur la carte » ni « Y aller »", () => {
  const carte = app.slice(app.indexOf("function carteOffre"), app.indexOf("function heureCourte"));
  assert.match(carte, /const situee = Number\.isFinite\(lat\) && Number\.isFinite\(lng\)/);
  assert.match(carte, /const gestes = situee\s*\n?\s*\?/);
  assert.match(carte, /: '';/);
});

test("la carte n'est plus un lien unique, et la source en reste un", () => {
  const carte = app.slice(app.indexOf("function carteOffre"), app.indexOf("function heureCourte"));
  assert.match(carte, /return '<div class="of-carte"/);
  assert.match(carte, /<a class="of-source" href="'\+esc\(o\.source_url\)/);
  /* Un lien dans un lien n'est pas du HTML valide : c'est la raison technique
     du changement, et elle doit rester vraie. */
  assert.doesNotMatch(carte, /<a class="of-carte"/);
});

test("les coordonnées voyagent dans les attributs, avec un seul gestionnaire", () => {
  const ecran = app.slice(app.indexOf("async function ouvrirBonsPlansEtudiants"));
  assert.match(ecran, /hote\.addEventListener\("click"/);
  assert.match(ecran, /closest\("\[data-of-centrer\]"\)/);
  assert.match(ecran, /closest\("\[data-of-yaller\]"\)/);
  assert.match(ecran, /closest\("\[data-of-oublier\]"\)/);
});

test("centrer ferme la feuille : centrer sous un panneau ne montre rien", () => {
  const ecran = app.slice(app.indexOf("async function ouvrirBonsPlansEtudiants"));
  assert.match(ecran, /allerVers\(point, \(m\)=>Math\.max\(m\.getZoom\(\), 17\)\)/);
  assert.match(ecran, /fermerFeuille\(\);\s*\n\s*toast\(centrer\.getAttribute\("data-of-nom"\)/);
});

/* ==========================================================================
   2. LA MÉMOIRE DU CHOIX
   ======================================================================== */
test("les quatre applications sont nommées une seule fois", () => {
  const liste = app.slice(app.indexOf("const APPLIS_ITINERAIRE"), app.indexOf("function appliItineraireMemorisee"));
  for (const cle of ["google", "apple", "waze", "citymapper"]) {
    assert.match(liste, new RegExp('cle:"' + cle + '"'), cle);
  }
  /* Aucun logo : le dépôt n'en porte aucun, et un logo redessiné à la main
     serait un faux logo. */
  assert.doesNotMatch(app, /logo-(?:google|waze|apple|citymapper)/i);
});

test("un stockage refusé ne casse rien : le choix vaut pour cette fois", () => {
  const bloc = app.slice(app.indexOf("function appliItineraireMemorisee"), app.indexOf("const NATURE_OFFRE"));
  /* Navigation privée, quota, stockage bloqué : trois façons pour
     localStorage de lever. Les trois accès sont gardés. */
  assert.equal((bloc.match(/catch\(e\)/g) || []).length, 3);
  assert.match(bloc, /return APPLIS_ITINERAIRE\.find\(a=>a\.cle === cle\) \|\| null/);
});

test("la mémoire est visible sur le bouton et annulable dans l'écran", () => {
  const carte = app.slice(app.indexOf("function carteOffre"), app.indexOf("function heureCourte"));
  assert.match(carte, /appli \? 'Y aller · '\+esc\(appli\.nom\) : 'Y aller'/);
  const ecran = app.slice(app.indexOf("async function ouvrirBonsPlansEtudiants"));
  assert.match(ecran, /data-of-oublier="1"/);
  assert.match(ecran, /Changer d’application/);
  /* Et les libellés déjà écrits redeviennent génériques immédiatement :
     laisser « Y aller · Waze » après l'oubli ferait mentir l'écran. */
  assert.match(ecran, /querySelectorAll\("\[data-of-yaller\]"\)\.forEach\(b=>\{ b\.textContent = "Y aller"; \}\)/);
});

test("un choix déjà retenu n'ouvre pas de feuille pour faire confirmer", () => {
  const choix = ecrans.slice(ecrans.indexOf("function ouvrirChoixItineraire"));
  assert.match(choix, /if\(memorisee\)\{/);
  /* L'ouverture reste attachée au clic : un `window.open` après un `await`
     est bloqué comme une popup. */
  assert.match(choix, /a\.click\(\);/);
  assert.doesNotMatch(choix, /window\.open/);
});

test("Citymapper reçoit la destination, et le départ seulement s'il existe", () => {
  const url = ecrans.slice(ecrans.indexOf("function urlItineraireExterne"),
    ecrans.indexOf("function ouvrirChoixItineraire"));
  assert.match(url, /citymapper\.com\/directions\?endcoord="\+encodeURIComponent\(arrivee\)/);
  assert.match(url, /origine \? "&startcoord="\+encodeURIComponent\(origine\) : ""/);
  /* Un départ inventé enverrait quelqu'un depuis un endroit où il n'est pas. */
  const choix = ecrans.slice(ecrans.indexOf("function ouvrirChoixItineraire"));
  assert.match(choix, /pointGeographiqueValide\(positionMoi\) \? positionMoi : null/);
});

test("l'écran de choix réutilise les classes existantes du panneau itinéraire", () => {
  const choix = ecrans.slice(ecrans.indexOf("function ouvrirChoixItineraire"));
  assert.match(choix, /class="itin-externes"/);
  assert.match(choix, /class="itin-lien"/);
  /* La règle a été écrite quand la feuille de style vivait dans `index.html`
     et frôlait son plafond ; elle réutilise donc des classes existantes plutôt
     que d'en créer. La feuille est sortie depuis (`autour.css`), la règle n'a
     pas changé, et le document reste léger. */
  assert.match(feuilleDeStyle, /\.of-carte \.itin-liens\{margin-top:9px\}/);
  assert.ok(index.length < 200000, "index.html : " + index.length + " caractères");
});

/* ==========================================================================
   3. LE GÉOCODAGE
   ======================================================================== */
test("le géocodage refuse plutôt que d'approcher", () => {
  /* La BAN répond toujours quelque chose : « Cafétéria » lui tire une rue
     quelque part en France avec un score de 0,2. */
  assert.match(geo, /if coalesce\(v_score, 0\) < 0\.6 then/);
  assert.match(geo, /v_cp_demande is not null and v_cp is not null and v_cp <> v_cp_demande/);
  assert.match(geo, /statut = 'refusee'/);
});

test("une position venue de la source n'est jamais écrasée par un appariement", () => {
  assert.match(geo, /where id = g\.offer_id and lat is null and lng is null/);
  assert.match(geo, /coord_source = 'ban', coord_score = v_score/);
  /* Et la provenance est stockée : une fiche qui affiche « 820 m » doit
     pouvoir dire d'où vient ce 820. */
  assert.match(geo, /add column if not exists coord_source text/);
});

test("la file ne se bloque pas et ne redemande pas l'impossible", () => {
  /* Un délai long n'est pas patient : il immobilise pg_net pour toutes les
     autres fonctions, synchronisations d'événements comprises. */
  assert.match(geo, /timeout_milliseconds => 5000/);
  assert.match(geo, /g\.statut in \('refusee','echec'\)\s*\n?\s*and g\.lancee_le > now\(\) - interval '30 days'/);
  /* Une demande sans réponse ne reste pas « en cours » pour toujours : sinon
     l'offre serait bloquée à jamais. */
  assert.match(geo, /if g\.lancee_le < now\(\) - interval '1 hour' then/);
});

test("la file des géocodages n'est pas lisible par le public", () => {
  assert.match(geo, /alter table public\.offer_geocodages enable row level security/);
  assert.match(geo, /revoke all on public\.offer_geocodages from anon, authenticated/);
  assert.match(geo, /revoke all on function public\.offres_geocoder_lancer\(integer\) from public, anon, authenticated/);
  assert.match(geo, /revoke all on function public\.offres_geocoder_verser\(\) from public, anon, authenticated/);
});
