/* LA CASCADE D'IMAGE D'UN ÉVÉNEMENT — CE QU'ELLE ACCEPTE, ET CE QU'ELLE REFUSE

   Le défaut rapporté : la fiche de l'événement NeS affiche le placeholder
   « VISUEL AUTOUR ». Le traçage a montré que le résolveur n'était pas en
   cause — il n'avait rien à résoudre. Mesuré en base le 25/09/2026 :

     · datatourisme : 1 137 événements à venir, ZÉRO image, et 1 097 sans
       aucune URL officielle. La source ne sert ni `hasMainRepresentation` ni
       `source_url`.
     · `artist_names` est lu par trois modules et écrit par personne : le
       barreau « image officielle de l'artiste » n'a aucune entrée.
     · 120 événements `venue_official` / `organizer_official` portaient
       l'adresse de leur propre page, et personne ne la lisait.

   Ces tests fixent les deux barreaux ajoutés, et surtout leurs refus : une
   page qui ne nomme pas l'événement ne l'illustre pas, et l'affiche d'un
   autre événement ne devient jamais celle de celui-ci. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../images.js";

const IMAGES = globalThis.AutourImages;
const migration = readFileSync(new URL(
  "../supabase/migrations/20260925120000_evenements_image_cascade.sql", import.meta.url), "utf8");

/* ==========================================================================
   1. LES DEUX NOUVELLES PROVENANCES
   ======================================================================== */

test("la page officielle de l'événement est une provenance à part entière", () => {
  const v = IMAGES.visuelEvenement({
    image_url: "https://aeronef.fr/sites/aeronef/files/styles/16x9_1920/public/a.jpg",
    image_source: "event_page",
    image_source_url: "https://aeronef.fr/agenda/forumbenjaminbriere",
    image_confidence: 0.85, image_usage_status: "remote_only",
    image_checked_at: "2026-09-25T10:00:00Z",
  });
  assert.ok(v, "l'image écrite par la cascade doit être affichable");
  assert.equal(v.image_source, "event_page");
  assert.equal(v.image_type, "event_poster");
  assert.equal(v.image_source_name, "Page officielle de l’événement");
  assert.equal(v.image_confidence, "high");
  assert.equal(v.image_confidence_score, 0.85);
  assert.equal(v.image_usage_status, "remote_only");
  assert.equal(v.image_checked_at, "2026-09-25T10:00:00Z");
});

test("une photo de salle est étiquetée comme telle, jamais comme l'affiche", () => {
  const v = IMAGES.visuelEvenement({
    image_url: "https://upload.wikimedia.org/a/b/Aeronef.jpg",
    image_source: "places", image_license: "CC BY-SA 4.0",
    image_author: "Quelqu’un", image_confidence: 0.5,
  });
  assert.ok(v);
  /* « venue » et pas « event_poster » : la fiche doit pouvoir dire « photo du
     lieu » au lieu de laisser croire à une photo de la soirée. */
  assert.equal(v.image_type, "venue");
  assert.equal(v.image_confidence, "medium");
  assert.equal(v.image_confidence_score, 0.5);
  assert.equal(v.image_source_name, "Photo du lieu");
});

/* ==========================================================================
   2. LE DROIT D'USAGE, DIT PLUTÔT QUE SUPPOSÉ
   ======================================================================== */

test("un droit d'usage inconnu ne devient jamais « réutilisable »", () => {
  const affiche = IMAGES.visuelEvenement({
    image_url: "https://exemple.test/affiche.jpg", image_source: "openagenda",
  });
  assert.equal(affiche.image_usage_status, "remote_only");

  const libre = IMAGES.visuelEvenement({
    image_url: "https://upload.wikimedia.org/a/b/c.jpg",
    image_source: "wikimedia_commons", image_license: "CC0",
  });
  assert.equal(libre.image_usage_status, "reusable");

  /* Une valeur explicite de la source prime : elle sait mieux que nous. */
  const dit = IMAGES.visuelEvenement({
    image_url: "https://exemple.test/a.jpg", image_source: "openagenda",
    image_license: "CC0", image_usage_status: "remote_only",
  });
  assert.equal(dit.image_usage_status, "remote_only");
});

test("la confiance accepte un niveau comme un nombre, et garde les deux", () => {
  const paliers = [[1, "high"], [0.85, "high"], [0.8, "high"], [0.5, "medium"],
                   [0.49, "low"], [0, "low"]];
  for (const [score, niveau] of paliers) {
    const v = IMAGES.visuelEvenement({image_url: "https://x.test/a.jpg",
      image_source: "openagenda", image_confidence: score});
    assert.equal(v.image_confidence, niveau, "score " + score);
    assert.equal(v.image_confidence_score, score);
  }
  const mot = IMAGES.visuelEvenement({image_url: "https://x.test/a.jpg",
    image_source: "openagenda", image_confidence: "medium"});
  assert.equal(mot.image_confidence, "medium");
  assert.equal(mot.image_confidence_score, null);
});

/* ==========================================================================
   3. CE QUE LA CASCADE D'AMONT REFUSE — LU DANS LA MIGRATION
   ======================================================================== */

test("la page doit nommer l'événement, sinon son image n'est pas la sienne", () => {
  assert.match(migration, /la page ne nomme pas l''événement/);
  /* Le titre de la page ou son `og:title`, pas son corps : le corps d'une page
     d'agenda nomme les vingt concerts du mois. */
  assert.match(migration, /og:title/);
});

test("l'affiche d'un autre événement ne devient jamais la photo du lieu", () => {
  /* La seule image de « La Condition Publique - Roubaix » dans `places` est
     une affiche openagenda d'un autre concert : `image_type = 'place_photo'`
     est donc la condition qui empêche de la reprendre. */
  assert.match(migration, /p\.image_type = 'place_photo'/);
  assert.match(migration, /nullif\(btrim\(coalesce\(p\.image_license, ''\)\), ''\) is not null/);
});

test("rien n'est recopié, et la colonne le dit", () => {
  assert.match(migration, /image_usage_status = 'remote_only'/);
  assert.match(migration, /events_image_usage_check/);
  /* Et le résolveur ne connaît que trois droits d'usage : pas de quatrième
     valeur qui voudrait dire « on verra ». */
  const v = IMAGES.visuelEvenement({image_url: "https://x.test/a.jpg",
    image_source: "openagenda", image_usage_status: "peut_etre"});
  assert.equal(v.image_usage_status, "remote_only");
});

test("l'enrichissement est en amont : le client ne part jamais sur le Web", () => {
  /* La cascade vit dans des fonctions de base appelées par lot, pas à
     l'ouverture d'une fiche. `images.js` ne fait aucun `fetch`. */
  const source = readFileSync(new URL("../images.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.match(migration, /create or replace function public\.evenements_recolter_page/);
  assert.match(migration, /create or replace function public\.evenements_verser_page/);
});
