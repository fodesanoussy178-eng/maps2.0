import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../territoire.js";
import "../images.js";
import "../core.js";

const T = globalThis.AutourTerritoire;
const I = globalThis.AutourImages;
const C = globalThis.AutourCore;
const root = fileURLToPath(new URL("..", import.meta.url));
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const migration = readFileSync(new URL(
  "../supabase/migrations/20260902090000_photos_braderie_finale.sql", import.meta.url), "utf8");

const debut = Date.parse("2026-09-05T06:00:00Z");
const fin = Date.parse("2026-09-06T16:00:00Z");
const apercu = Date.parse("2026-09-01T22:00:00Z");

function contexte() {
  return T.normaliserContexte({
    slug: "rendez-vous-test",
    name: "Rendez-vous test",
    starts_at: debut,
    ends_at: fin,
    preview_starts_at: apercu,
    timezone: "Europe/Paris",
    metadata: {
      libelle: "Rendez-vous",
      phase_jour_avant_ouverture: true,
      etats_bouton: {
        avant: {emoji: "🛍️", suffixe: "· bientôt"},
        jour: {emoji: "🛍️", suffixe: "· aujourd’hui"},
        pendant: {emoji: "⚡", suffixe: "· maintenant"},
      },
    },
  });
}

test("le contexte majeur expose avant, jour J, pendant puis absent", () => {
  const c = contexte();
  assert.equal(T.bouton(c, Date.parse("2026-09-02T08:00:00Z")).libelle,
    "Rendez-vous · bientôt");
  assert.equal(T.bouton(c, Date.parse("2026-09-05T05:00:00Z")).libelle,
    "Rendez-vous · aujourd’hui");
  assert.equal(T.bouton(c, debut).libelle, "Rendez-vous · maintenant");
  assert.equal(T.bouton(c, debut).emoji, "⚡");
  assert.equal(T.bouton(c, fin), null);
});

test("la date du jour J est calculée depuis la fenêtre du contexte", () => {
  const c = contexte();
  assert.equal(T.phase(c, Date.parse("2026-09-04T21:00:00Z")), T.PHASES.AVANT);
  assert.equal(T.phase(c, Date.parse("2026-09-05T00:00:00Z")), T.PHASES.JOUR);
  assert.equal(T.phase(c, Date.parse("2026-09-05T05:59:59Z")), T.PHASES.JOUR);
});

test("une image OpenAgenda garde les six champs de provenance", () => {
  const v = I.visuel({
    image_url: "https://img.openagenda.com/main/a.full.image.jpg",
    image_source: "openagenda",
    image_source_url: "https://openagenda.com/ville-de-lille/events/1",
    image_author: "© Ville de Lille",
    image_license: "affiche fournie par l’organisateur",
    image_updated_at: "2026-08-24T09:41:16Z",
    image_scope: "evenement",
  });
  assert.deepEqual({
    image_url: v.image_url,
    image_source: v.image_source,
    image_source_url: v.image_source_url,
    image_author: v.image_author,
    image_license: v.image_license,
    image_updated_at: v.image_updated_at,
  }, {
    image_url: "https://img.openagenda.com/main/a.full.image.jpg",
    image_source: "openagenda",
    image_source_url: "https://openagenda.com/ville-de-lille/events/1",
    image_author: "© Ville de Lille",
    image_license: "affiche fournie par l’organisateur",
    image_updated_at: "2026-08-24T09:41:16Z",
  });
});

test("Wikimedia sans licence exploitable et Google Images restent exclus", () => {
  assert.equal(I.visuel({
    image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg",
    image_source: "wikimedia_commons",
    image_source_url: "https://commons.wikimedia.org/wiki/File:X.jpg",
  }), null);
  assert.doesNotMatch(app, /Google Images/i);
});

test("le contexte est lié à evenements_majeurs sans créer un doublon", () => {
  assert.match(migration, /references public\.evenements_majeurs \(motif_titre\)/);
  assert.match(migration, /evenements_contexte/);
  assert.match(migration, /e\.duplicate_of is null/);
  assert.match(migration, /association_terms/);
  assert.doesNotMatch(migration, /insert into public\.evenements_majeurs/i);
});

test("deux animations éditoriales distinctes au même lieu restent distinctes", () => {
  const commun = {
    isTemporary: true, entity_type: "event", cat: "event",
    latitude: 50.627, longitude: 3.069, adresse: "17 boulevard Jean-Baptiste Lebas",
    startsAt: Date.parse("2026-09-05T06:00:00Z"),
    endsAt: Date.parse("2026-09-05T17:00:00Z"),
  };
  const a = Object.assign({}, commun, {id: "evt-a", title: "Braderie des enfants"});
  const b = Object.assign({}, commun, {id: "evt-b", title: "Atelier associé"});
  const distance = () => 0;
  assert.equal(C.dedupeItems([a, b], distance).length, 1);
  assert.equal(C.dedupeItems([a, b], distance, {preserveDistinctEvents:true}).length, 2);
});

test("les images Aide sont différées et limitées aux résultats visibles", () => {
  assert.match(app, /programmerPhotosAide\(\);/);
  assert.match(app, /solutionsAide\(IMAGES\.MAX_CANDIDATS \|\| 8, \{noModel:true\}\)/);
  assert.match(app, /IMAGES\.resoudreLot\(candidats, \{[\s\S]{0,500}google:false/);
  assert.match(app, /loading="lazy"/);
});
