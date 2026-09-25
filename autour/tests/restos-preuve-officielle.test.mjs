/* FINIR LA PREUVE D'UNE ANTENNE — SANS FORCER LA PUBLICATION

   Quinze candidats « Restos du Cœur » pour Tourcoing, zéro publié. En allant
   lire les sources officielles depuis la base, trois faits mesurés le
   25/09/2026 :

     · les adresses annoncées EXISTENT — la Base Adresse Nationale les confirme
       toutes — mais les coordonnées écrites par le modèle étaient dispersées
       sur 2,5 km, et aucune ne tombait sur le point officiel ;
     · le registre des entreprises ne connaît qu'UN établissement ouvert des
       Restaurants du Cœur à Tourcoing (204 rue des Cinq Voies, SIRET
       33986341700053) et un fermé. Les cinq « antennes » de quartier ne sont
       donc pas des établissements : leurs noms viennent d'adresses de COURRIEL
       de l'annuaire interne AD59A ;
     · les pages officielles répondent 200 et sont rendues par JavaScript :
       ni `streetAddress`, ni `postalCode`, ni « 59200 » dans le HTML.

   Ces tests fixent les règles de la vérification et, surtout, celles du REFUS :
   sans identité d'antenne attestée, rien n'est publié — et l'écran reste sans
   Restos du Cœur, ce qui est la réponse honnête. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL(
  "../supabase/migrations/20260925140000_local_discovery_preuve_officielle.sql",
  import.meta.url), "utf8");
const discovery = readFileSync(new URL(
  "../supabase/functions/local-discovery/discovery.mjs", import.meta.url), "utf8");

/* ==========================================================================
   1. LES SOURCES, DANS L'ORDRE DU LOT
   ======================================================================== */

test("l'adresse et les coordonnées viennent d'une source officielle", () => {
  assert.match(sql, /api-adresse\.data\.gouv\.fr/,
    "la Base Adresse Nationale est la source officielle des adresses françaises");
  /* Et ce sont SES coordonnées qui gagnent, pas celles du candidat. */
  assert.match(sql, /lat = \(\(f -> 'geometry' -> 'coordinates'\) ->> 1\)/);
  assert.match(sql, /ban_id = f -> 'properties' ->> 'id'/);
});

test("l'identité locale vient du registre officiel des entreprises", () => {
  assert.match(sql, /recherche-entreprises\.api\.gouv\.fr/);
  /* `minimal=true` est obligatoire avec `include` : sans lui l'API rend 400. */
  assert.match(sql, /minimal=true/);
  assert.match(sql, /matching_etablissements/);
  /* L'établissement doit être OUVERT. Un centre fermé ne se publie pas. */
  assert.match(sql, /etat_administratif'\) = 'A'/);
  assert.match(sql, /etablissement_ferme_au_registre/);
});

test("aucune URL n'est fabriquée depuis un courriel", () => {
  /* Le garde-fou vit dans la découverte, et cette migration n'en crée aucune
     de son côté : elle n'écrit que des adresses rendues par une API
     officielle. */
  assert.match(discovery, /export function urlDeriveeDunCourriel/);
  assert.doesNotMatch(sql, /https?:\/\/' \|\|/,
    "aucune URL ne doit être concaténée à partir d'un champ de candidat");
});

/* ==========================================================================
   2. LES REFUS — CE QUI EMPÊCHE UNE FICHE DOUTEUSE
   ======================================================================== */

test("un score de géocodage ne suffit pas : la rue doit être la même", () => {
  /* Mesuré sur le CCAS. « 26 rue de la Bienveillance » n'existe pas à
     Tourcoing ; la BAN a rendu « 26 Rue de la Baille », score 0,646, bonne
     commune, type housenumber — toutes les conditions de score passaient, et
     l'adresse a été remplacée par une autre rue à 800 m. */
  assert.match(sql, /v_commun/);
  assert.match(sql, /Bienveillance/,
    "le cas qui a révélé le défaut doit rester écrit dans le code");
  assert.match(sql, /not v_commun then/);
});

test("l'adresse de la source n'est jamais perdue", () => {
  /* C'est elle qui a permis de retrouver, après coup, la seule adresse
     faussement confirmée sur 49. */
  assert.match(sql, /add column if not exists address_source/);
  assert.match(sql, /v_demandee := coalesce\(c\.address_source, c\.address\)/);
});

test("les quatre éléments minimaux sont exigés avant publication", () => {
  const bloc = sql.slice(sql.indexOf("function public.local_discovery_publier"));
  for (const condition of [
    /c\.address_verified_at is null/,     // localisation
    /c\.siret is null/,                   // identité de l'antenne
    /v_cat is null/,                      // service pertinent
    /c\.last_verified_at < now\(\) - interval '365 days'/, // source récente
  ]) assert.match(bloc, condition);
});

test("ce qui n'est pas prouvé reste candidat, avec ce qui manque", () => {
  assert.match(sql, /missing_evidence/);
  for (const manque of ["adresse_non_confirmee", "identite_antenne_non_confirmee",
    "service_non_atteste", "source_trop_ancienne", "antenne_absente_du_registre"])
    assert.ok(sql.includes(manque), "le motif « " + manque + " » doit exister");
  /* Et `rejected` ne devient pas `candidate` sans raison. */
  assert.match(sql, /then 'candidate' else verification_status end/);
});

/* ==========================================================================
   3. UNE STRUCTURE, UN LIEU — ET DEUX ANTENNES, DEUX LIEUX
   ======================================================================== */

test("la publication est clé sur la structure, pas sur la découverte", () => {
  /* `source_fingerprint` est propre à chaque passage : quatre découvertes de la
     Croix-Rouge de Tourcoing avaient créé quatre lieux. L'identifiant externe
     est donc celui de la structure — SIRET, à défaut identifiant BAN. */
  assert.match(sql, /coalesce\(c\.siret, c\.ban_id, c\.source_fingerprint\)/);
});

test("une structure publiée n'est plus servie deux fois", () => {
  const bloc = sql.slice(sql.indexOf("function public.local_discovery_nearby"));
  assert.match(bloc, /distinct on \(c\.place_id\)/);
  assert.match(bloc, /p\.duplicate_of is null/);
  /* Le candidat le mieux prouvé de chaque lieu gagne. */
  assert.match(bloc, /\(c\.siret is not null\) desc/);
});

test("deux antennes distinctes gardent deux identités", () => {
  /* Le rayon de rapprochement reste court : deux antennes d'un même réseau
     peuvent être à deux rues l'une de l'autre. */
  assert.match(sql, /120\) p;/);
  /* Et la règle de fond est inchangée côté découverte : jamais le téléphone
     seul, jamais le domaine seul, jamais le réseau seul. */
  assert.match(discovery, /Le téléphone seul,\s*\n?\s*.{0,30}ne dit que « même association »/s);
});

test("la fonction de lecture reste accordée au navigateur", () => {
  const bloc = sql.slice(sql.indexOf("function public.local_discovery_nearby"));
  assert.match(bloc, /grant execute on function public\.local_discovery_nearby[\s\S]*?to anon, authenticated, service_role/);
  assert.match(bloc, /security definer/i);
});
