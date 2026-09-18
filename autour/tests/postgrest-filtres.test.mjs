import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* ---------------------------------------------------------------------------
   UN FILTRE POSTGREST SANS OPÉRATEUR N'EST PAS UN FILTRE

   `events?id=<uuid>` a l'air d'une requête par identifiant. PostgREST, lui, y
   lit une colonne `id` comparée à… rien de connu, et rend une 400. Le chemin
   de relecture des annonces canoniques a fait ça huit mille fois par jour sans
   qu'aucun test ne s'en aperçoive : la fonction appelante attrapait l'erreur,
   rendait `{}`, et la synchronisation continuait comme si l'annonce n'avait
   jamais existé. Une panne silencieuse coûte plus cher qu'une panne bruyante.

   La règle vérifiée ici est mécanique : dans une fonction Edge, toute valeur
   de filtre visant une table connue des migrations commence par un opérateur
   PostgREST. `select`, `order`, `limit`, `offset`, `on_conflict` et `columns`
   ne sont pas des filtres et n'en prennent pas.
--------------------------------------------------------------------------- */

const RACINE = new URL("../", import.meta.url).pathname;
const MIGRATIONS = join(RACINE, "supabase/migrations");
const FONCTIONS = join(RACINE, "supabase/functions");

const RESERVES = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
/* La liste des opérateurs de PostgREST, telle que la documentation la publie.
   `not.` et les logiques `or.`/`and.` en font partie : ce sont des préfixes de
   valeur, pas des noms de colonne. */
const OPERATEURS = [
  "eq", "gt", "gte", "lt", "lte", "neq", "like", "ilike", "match", "imatch",
  "in", "is", "isdistinct", "fts", "plfts", "phfts", "wfts", "cs", "cd", "ov",
  "sl", "sr", "nxr", "nxl", "adj", "not", "or", "and", "all", "any",
];
const OPERATEUR = new RegExp("^(?:" + OPERATEURS.join("|") + ")\\.");

function fichiers(racine, suffixes) {
  const sortie = [];
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiers(chemin, suffixes));
    else if (suffixes.some((s) => entree.endsWith(s))) sortie.push(chemin);
  }
  return sortie;
}

/* Les tables ne sont pas recopiées ici : elles sont lues dans les migrations.
   Une table ajoutée demain est donc couverte sans que personne y pense. */
function relationsConnues() {
  const noms = new Set();
  for (const fichier of fichiers(MIGRATIONS, [".sql"])) {
    const sql = readFileSync(fichier, "utf8");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)) {
      noms.add(m[1].toLowerCase());
    }
  }
  return noms;
}

/* Un chemin REST commence par un nom de relation suivi de `?`. On ne retient
   que les chaînes littérales : une URL construite par `new URL()` vers une API
   tierce ne ressemble pas à ça et n'est pas concernée. */
function filtresDouteux(source, relations) {
  const fautes = [];
  for (const m of source.matchAll(/([a-z0-9_]+)\?([^"'`\n]*)/gi)) {
    const relation = m[1].toLowerCase();
    if (!relations.has(relation)) continue;
    for (const param of m[2].split("&")) {
      const separateur = param.indexOf("=");
      if (separateur <= 0) continue;
      const nom = param.slice(0, separateur);
      const valeur = param.slice(separateur + 1);
      if (RESERVES.has(nom) || !/^[a-z0-9_]+$/i.test(nom)) continue;
      if (!OPERATEUR.test(valeur)) fautes.push(relation + "?" + param);
    }
  }
  return fautes;
}

test("aucune fonction Edge ne filtre PostgREST sans opérateur", () => {
  const relations = relationsConnues();
  assert.ok(relations.has("events"), "les migrations doivent au moins déclarer `events`");
  const fautes = [];
  for (const fichier of fichiers(FONCTIONS, [".ts", ".mjs"])) {
    for (const faute of filtresDouteux(readFileSync(fichier, "utf8"), relations)) {
      fautes.push(fichier.slice(RACINE.length) + " : " + faute);
    }
  }
  assert.deepEqual(fautes, [],
    "un filtre sans opérateur rend 400 et se lit comme une absence de donnée");
});

test("la relecture des annonces canoniques vise bien une ligne", () => {
  for (const nom of ["sync-datatourisme", "sync-openagenda"]) {
    const source = readFileSync(join(FONCTIONS, nom, "index.ts"), "utf8");
    assert.match(source, /"events\?id=eq\." \+ encodeURIComponent\(eventId\)/,
      nom + " doit relire l'annonce par `id=eq.<uuid>`");
  }
});
