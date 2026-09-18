import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import lexique, { nonVerifies, parSousType, MODES_ACCES, COUTS }
  from "../data/aide-solidarite-lexique.js";

const migration = (nom) =>
  readFileSync(new URL("../supabase/migrations/" + nom, import.meta.url), "utf8");
const FICHE = migration("20260918090000_lot8_fiche_solidaire.sql");
const LEXIQUE_SQL = migration("20260918091000_lot8_lexique_solidaire.sql");

const SOUS_TYPES = Object.freeze([
  "hebergement_urgence", "logement_jeunes", "action_sociale_generale", "sante_mentale",
  "accueil_jeunes", "aide_materielle", "violences_femmes", "gestionnaire",
]);

/* ======================================================================== */
test("les seize termes sont là, et le dix-septième reste inconnu", () => {
  assert.equal(lexique.length, 16, "seize termes vérifiés, pas quinze, pas dix-sept");
  assert.equal(nonVerifies.length, 1);
  assert.equal(nonVerifies[0].terme, "ALORE");
  assert.equal(nonVerifies[0].statut, "UNKNOWN");
  assert.ok(!lexique.some((e) => /alore/i.test(e.terme)),
    "un terme non vérifié n'obtient pas de fiche");
});

test("chaque sous-type de la famille solidarite a au moins un terme", () => {
  SOUS_TYPES.forEach((sous) => {
    assert.ok(parSousType[sous] && parSousType[sous].length,
      "aucun terme pour " + sous + " : le sous-type ne sert à rien");
  });
  lexique.forEach((e) => assert.ok(SOUS_TYPES.includes(e.sous_type),
    e.terme + " : sous-type inconnu " + e.sous_type));
});

test("la phrase dit ce qui s'y passe, pas le développement du sigle", () => {
  lexique.forEach((e) => {
    const phrase = e.quoi_concretement;
    assert.ok(phrase.length >= 60 && phrase.length <= 400,
      e.terme + " : la phrase fait " + phrase.length + " caractères");
    assert.notEqual(phrase.trim(), e.nom.trim(),
      e.terme + " : la phrase ne peut pas être le développement du sigle");
    assert.ok(!/^[A-Z]{2,6}\s*[:—-]/.test(phrase.trim()),
      e.terme + " : la phrase commence par un sigle plutôt que par ce qui s'y passe");
  });
});

test("les champs fermés ne contiennent que leurs valeurs, ou rien", () => {
  lexique.forEach((e) => {
    if (e.mode_acces != null) assert.ok(MODES_ACCES.includes(e.mode_acces), e.terme);
    if (e.cout != null) assert.ok(COUTS.includes(e.cout), e.terme);
    assert.ok(e.anonymat === null || typeof e.anonymat === "boolean", e.terme);
    assert.ok(Array.isArray(e.public_vise), e.terme);
  });
});

/* ---- LES RÈGLES DE SÉCURITÉ (B.6) -------------------------------------- */

test("B.6.1 — aucune adresse pour la mise à l'abri des femmes victimes de violences", () => {
  lexique.filter((e) => e.sous_type === "violences_femmes").forEach((e) => {
    assert.equal(e.adresse_publiable, false,
      e.terme + " : publier une adresse de mise à l'abri met des personnes en danger");
    assert.equal(e.telephone_cle, "3919",
      e.terme + " : la fiche doit porter le 3919");
  });
  assert.match(LEXIQUE_SQL, /solidarite_lexique_mise_a_l_abri_sans_adresse/);
  assert.match(FICHE, /places_violences_femmes_sans_adresse/);
});

test("B.6.2 — l'hébergement d'urgence donne le 115, jamais une porte", () => {
  const urgence = lexique.filter((e) => e.sous_type === "hebergement_urgence");
  assert.ok(urgence.length, "le sous-type existe, il doit avoir des termes");
  urgence.forEach((e) => {
    assert.equal(e.telephone_cle, "115", e.terme);
    assert.ok(["telephone", "orientation"].includes(e.mode_acces),
      e.terme + " : on n'entre pas dans un hébergement d'urgence en se présentant");
  });
  assert.match(LEXIQUE_SQL, /solidarite_lexique_urgence_par_le_115/);
  assert.match(FICHE, /places_hebergement_urgence_par_le_115/);
});

test("B.6.3 — aucun horaire, nulle part, sur cette famille", () => {
  lexique.forEach((e) => {
    Object.keys(e).forEach((champ) => assert.ok(!/horaire|opening|ouverture/i.test(champ),
      e.terme + " : le lexique ne porte pas d'horaire (" + champ + ")"));
    assert.ok(!/\b\d{1,2}\s?h\s?\d{0,2}\b/i.test(e.quoi_concretement),
      e.terme + " : une heure dans la phrase est un horaire deviné");
  });
  /* Et côté base : seules les sources qui publient l'horaire peuvent en poser
     un. Une vérification par modèle n'en est pas une. */
  assert.match(FICHE, /places_solidarite_horaires_deterministes/);
  assert.match(FICHE, /opening_hours_source in \('osm','data_inclusion','finess','service_public','site_officiel'\)/);
});

test("B.6.4 — une fiche solidaire non relue n'est jamais active", () => {
  assert.match(FICHE, /solidarite_exige_relecture/);
  assert.match(FICHE, /new\.status = 'active' and new\.relu_le is null/);
  assert.match(FICHE, /relu_le is not null/, "la fonction d'affichage doit filtrer sur la relecture");
});

test("le lexique ne contient ni adresse ni numéro local : il décrit des types", () => {
  const texte = JSON.stringify(lexique);
  assert.ok(!/\b\d{1,3}\s?(?:bis|ter)?\s?(?:rue|avenue|boulevard|place|allée|chemin)\b/i.test(texte),
    "une adresse s'est glissée dans un fichier qui décrit des types");
  assert.ok(!/\b0[1-9](?:[\s.-]?\d{2}){4}\b/.test(texte),
    "un numéro de téléphone local s'est glissé dans un fichier qui décrit des types");
});

/* ---- B.3 — UN GESTIONNAIRE N'EST PAS UN LIEU --------------------------- */

test("le sous-type gestionnaire ne s'affiche pas sur la carte", () => {
  assert.match(FICHE, /\('gestionnaire',\s+'solidarite',[^\n]*false/,
    "`gestionnaire` doit être inséré avec affiche = false");
  assert.match(FICHE, /and t\.affiche/,
    "la fonction d'affichage doit écarter les organismes gestionnaires");
  assert.ok(parSousType.gestionnaire.includes("ALEFPA"));
  assert.ok(parSousType.gestionnaire.includes("La Sauvegarde du Nord"));
});

/* ---- LES DEUX COPIES DISENT LA MÊME CHOSE ------------------------------ */

/* Le même texte vit en JS et en SQL, parce que le navigateur n'a pas de base
   et que le pipeline n'a pas de navigateur. Deux copies divergent toujours,
   sauf quand quelque chose les compare : ce test régénère le bloc `values`
   depuis le JS et exige de le retrouver mot pour mot dans la migration. */
test("le lexique SQL est exactement le lexique JS", () => {
  const q = (v) => v == null ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
  const arr = (v) => !v || !v.length ? "'{}'::text[]" : "array[" + v.map(q).join(", ") + "]";
  const b = (v) => v == null ? "null" : (v ? "true" : "false");
  const attendu = lexique.map((e) => "  (" + [
    q(e.terme), q(e.nom), q(e.sous_type), q(e.quoi_concretement),
    q(e.mode_acces), q(e.cout), b(e.anonymat), arr(e.public_vise),
    q(e.telephone_cle), b(e.adresse_publiable), b(e.aussi_gestionnaire),
    q(e.a_confirmer || null), arr(e.sources),
  ].join(",\n   ") + ")").join(",\n");
  assert.ok(LEXIQUE_SQL.includes(attendu),
    "la migration et le fichier de données ont divergé : régénérer le bloc `values`");
});

test("le terme inconnu est consigné en base, pas seulement en commentaire", () => {
  assert.match(LEXIQUE_SQL, /solidarite_termes_inconnus/);
  assert.match(LEXIQUE_SQL, /\('ALORE',/);
});

test("les sous-types du lexique existent dans la migration des sous-types", () => {
  SOUS_TYPES.forEach((sous) => assert.ok(FICHE.includes("('" + sous + "',"),
    sous + " : absent de `place_sous_types`"));
});
