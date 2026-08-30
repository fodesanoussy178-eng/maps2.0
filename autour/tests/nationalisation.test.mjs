import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {corpsApplicationSync} from "./source.mjs";

const lire = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const territoires = lire("../supabase/migrations/20260820112353_territorial_event_orchestrator.sql");
const national = lire("../supabase/migrations/20260830100000_generalisation_territoires_france.sql");
const canonique = lire("../supabase/migrations/20260830100500_evenements_artistes_types.sql");
const app = corpsApplicationSync(import.meta.url);

test("les cinq villes d'acceptation passent par le registre territorial commun", () => {
  for (const slug of ["tourcoing", "paris", "marseille", "rennes", "angers"]) {
    assert.match(`${territoires}\n${national}`, new RegExp(`['"]${slug}['"]`), slug);
  }
  assert.match(national, /insert into public\.event_areas/i);
  assert.match(national, /\('angers',/);
  assert.match(national, /\('rennes',/);
  assert.match(national, /'datatourisme', 'national-feed'/);
  assert.match(national, /selection.*event_areas/i);
});

test("Marseille et Rennes n'ajoutent pas de catalogue manuel", () => {
  assert.doesNotMatch(national, /openagenda/i);
  assert.doesNotMatch(national, /api\.|https?:\/\//i);
  assert.match(national, /pipeline|normaliseur/i);
});

test("un démarrage sans localisation n'invente plus Tourcoing", () => {
  assert.doesNotMatch(app, /POSITION_REPLI/);
  assert.match(app, /CENTRE_CARTE_FRANCE/);
  assert.match(app, /positionMoi = null; commune = COMMUNE_INCONNUE/);
  assert.match(app, /if\(!positionMoi\)\{/);
});

test("une panne d'une couche laisse les autres sources visibles", () => {
  assert.match(app, /Promise\.all\(\[\s*chargerPublications\(lat,lng\), chargerEvenementsCanoniques\(lat,lng\)\s*\]\)/s);
  assert.match(app, /okPublications \|\| okEvenements/);
  assert.match(app, /Promise\.allSettled\(travaux\)/);
  assert.match(app, /lieuxDatatourisme/);
});

test("le contrat SQL expose les métadonnées canoniques jusqu'aux RPC", () => {
  for (const colonne of ["artist_names", "music_genres", "event_kind"]) assert.match(canonique, new RegExp(colonne));
  assert.match(canonique, /create function public\.evenements_proches/);
  assert.match(canonique, /create function public\.evenements_bassin/);
  assert.match(canonique, /artist_names text\[\], music_genres text\[\], event_kind text/);
  assert.match(app, /isTemporary:true/);
});
