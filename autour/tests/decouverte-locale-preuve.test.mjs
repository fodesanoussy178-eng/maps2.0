/* LA DÉCOUVERTE LOCALE — CE QU'ELLE CHERCHE, ET CE QU'ELLE REFUSE

   Deux corrections mesurées le 25/09/2026, chacune sur des données réelles de
   Tourcoing, et deux garde-fous qu'elles ne doivent pas desserrer. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQueries, coverageAssessment, deduplicate, samePlace, urlDeriveeDunCourriel,
} from "../supabase/functions/local-discovery/discovery.mjs";
import { readFileSync } from "node:fs";

const fonction = readFileSync(
  new URL("../supabase/functions/local-discovery/index.ts", import.meta.url), "utf8");

/* ==========================================================================
   1. UNE ADRESSE DE COURRIEL N'EST PAS UNE ADRESSE DE PAGE
   ======================================================================== */

test("les hôtes fabriqués depuis un courriel sont reconnus", () => {
  /* Les trois source_url réellement écrites en base pour les Restos du Cœur
     de Tourcoing. Le modèle avait remplacé l'arobase de
     `ad59a.centre.tourcoing-virolois@restosducoeur.org` par un point. */
  for (const url of [
    "https://ad59a.centre.tourcoing-virolois.restosducoeur.org",
    "https://ad59a.centre.tourcoing-epideme.restosducoeur.org",
    "https://ad59a.centre.tourcoing-orions.restosducoeur.org",
  ]) assert.equal(urlDeriveeDunCourriel(url), true, url);
});

test("les vrais sous-domaines des réseaux passent", () => {
  /* Tous relevés en base, tous réels. Une garde qui les refuserait coûterait
     plus qu'elle ne protège. */
  for (const url of [
    "https://n-lille.secours-catholique.org",
    "https://lillemetropole.croix-rouge.fr",
    "https://nord.croix-rouge.fr",
    "https://ad59a-restosducoeur.org",
    "https://www.monad59a-restosducoeur.org/annuairecourriel-6/x",
    "https://programmes.net-andes.org",
    "https://nordflandres.cidff.info",
    "https://www.tourcoing.fr/Ma-vie-pratique/Solidarite-social",
  ]) assert.equal(urlDeriveeDunCourriel(url), false, url);
});

test("une URL non lisible n'est pas une URL en panne", () => {
  /* Le motif comptait pour `page_injoignable`, ce qui laissait croire à un
     site hors service plutôt qu'à une URL inventée. */
  assert.match(fonction, /urlDeriveeDunCourriel/);
  assert.match(fonction, /url_derivee_d_un_courriel/);
});

/* ==========================================================================
   2. CHERCHER AVEC LES MOTS DES VRAIES STRUCTURES
   ======================================================================== */

test("Logement cherche foyer, CHRS et résidence sociale", () => {
  const requetes = buildQueries("Tourcoing", "housing").join(" | ").toLowerCase();
  for (const mot of ["foyer", "chrs", "résidence sociale", "pension de famille",
                     "accueil de nuit"])
    assert.ok(requetes.includes(mot), "« " + mot + " » n'est pas cherché");
  assert.ok(requetes.includes("tourcoing"));
});

/* ==========================================================================
   3. LES GARDE-FOUS QUI NE BOUGENT PAS
   ======================================================================== */

test("deux antennes d'un réseau ne fusionnent pas sur leur téléphone", () => {
  const virolois = {name: "Les Restos du Cœur - Centre Tourcoing Virolois",
    address: "204 rue des Cinq Voies", lat: 50.7180, lng: 3.1520, phone: "03 20 24 00 00"};
  const europe = {name: "Les Restos du Cœur - Centre Tourcoing Europe",
    address: "8 rue de l'Europe", lat: 50.7290, lng: 3.1700, phone: "03 20 24 00 00"};
  assert.equal(samePlace(virolois, europe), false);
  const { accepted } = deduplicate([virolois, europe]);
  assert.equal(accepted.length, 2);
});

test("le même guichet sous deux noms, à la même adresse, fusionne", () => {
  const court = {name: "CCAS de Tourcoing", address: "26 rue de la Bienveillance",
    lat: 50.7231, lng: 3.1604, phone: "03 20 11 34 34"};
  const long = {name: "Centre Communal d'Action Sociale de Tourcoing",
    address: "26 rue de la Bienveillance", lat: 50.7231, lng: 3.1604, phone: "03 20 11 34 34"};
  assert.equal(samePlace(court, long), true);
});

test("une preuve insuffisante laisse la couverture incomplète", () => {
  /* Ne jamais publier une structure douteuse pour remplir l'écran : la
     couverture reste incomplète et la découverte reste demandée. */
  const maigre = coverageAssessment({known: 1, verified: 0, sourceCount: 1});
  assert.equal(maigre.status, "incomplete");
  assert.equal(maigre.shouldDiscover, true);
});
