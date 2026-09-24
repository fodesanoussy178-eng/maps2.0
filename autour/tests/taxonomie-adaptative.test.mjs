/* ---------------------------------------------------------------------------
   COMPRENDRE UN MOT QU'ON N'A PAS PROGRAMMÉ

   Le défaut corrigé : `WORDINGS` était la frontière du découvrable. Neuf
   entrées, et tout le reste invisible. Une ville qui invente une « Nuit des
   ateliers » n'existait pas pour Autour.

   Ces tests gardent les trois règles qui remplacent cette frontière, et
   surtout la troisième, qui est la plus facile à perdre : un libellé que rien
   ne reconnaît doit être RANGÉ AU PARENT, jamais jeté. Les formes nouvelles
   sont par définition celles qu'on n'a pas listées ; un pipeline qui les
   rejette ne découvrira jamais rien de neuf.
--------------------------------------------------------------------------- */

import test from "node:test";
import assert from "node:assert/strict";
import {
  FAMILLES, questionsOuvertes, rattacher,
} from "../supabase/functions/local-discovery/taxonomie.mjs";

/* ==========================================================================
   1. LE CAS QUI MOTIVE TOUT LE MODULE
   ======================================================================== */
test("un libellé absent de toute liste est compris par ce qu'il dit", () => {
  /* « Nuit des ateliers » n'est dans aucun WORDINGS, et n'a pas besoin d'y
     être : le mot « atelier » suffit à savoir de quoi il s'agit. */
  const r = rattacher("Nuit des ateliers", "");
  assert.equal(r.subcategory, "atelier_initiation");
  assert.equal(r.category_parent, "culture_loisirs");
  assert.equal(r.original_label, "Nuit des ateliers");
});

test("un nom qui ne dit rien est compris par sa page", () => {
  const r = rattacher("Les Rendez-vous du 12",
    "Projection en plein air suivie d'un débat, entrée libre, cour de la mairie.");
  assert.equal(r.subcategory, "projection_spectacle");
  assert.equal(r.rattachement, "synonyme_page");
  assert.ok(r.audiences.includes("acces_libre"));
});

test("un nom incompréhensible est RANGÉ, jamais rejeté", () => {
  /* La règle la plus importante du module. Un pipeline qui jette ce qu'il ne
     nomme pas ne découvrira jamais une forme nouvelle. */
  const r = rattacher("Zorglub Festivus", "");
  assert.equal(r.category_parent, "evenement_local");
  assert.equal(r.subcategory, null);
  assert.equal(r.rattachement, "parent_par_defaut");
  assert.ok(r.tags.includes("type_a_qualifier"), "et il est signalé comme à qualifier");
  assert.equal(r.original_label, "Zorglub Festivus");
});

/* ==========================================================================
   2. REGROUPER LES SYNONYMES SANS FUSIONNER LES CONCEPTS
   ======================================================================== */
test("brocante, vide-grenier et puces sont la même famille", () => {
  const familles = ["Brocante du Virolois", "Vide-grenier des Francs",
    "Puces de Tourcoing", "Bourse aux jouets", "Journée du réemploi"]
    .map((l) => rattacher(l, "").subcategory);
  assert.deepEqual([...new Set(familles)], ["vente_occasion"]);
});

test("un marché de créateurs n'est pas une brocante", () => {
  /* On n'y va pas pour les mêmes raisons. Quelqu'un qui cherche l'un serait
     déçu de trouver l'autre. */
  assert.notEqual(rattacher("Marché de créateurs", "").subcategory,
                  rattacher("Brocante du centre", "").subcategory);
  assert.equal(rattacher("Marché artisanal de Noël", "").subcategory, "marche_createurs");
});

test("le libellé original survit au rangement", () => {
  for (const nom of ["Bourse aux jouets", "Ducasse de la Bourgogne", "Nuit des ateliers"]) {
    assert.equal(rattacher(nom, "").original_label, nom);
  }
});

test("aucune famille ne se crée par événement", () => {
  /* Une sous-catégorie par événement serait aussi inutile qu'aucune. Le
     nombre de familles est fini et petit : c'est ce qui les rend filtrables. */
  assert.ok(Object.keys(FAMILLES).length <= 14, "familles : " + Object.keys(FAMILLES).length);
  const parents = new Set(Object.values(FAMILLES).map((f) => f.parent));
  assert.ok(parents.size <= 7, "parents : " + [...parents].join(", "));
});

/* ==========================================================================
   3. LES PUBLICS, LUS ET NON DEVINÉS
   ======================================================================== */
test("les publics viennent du texte, pas d'une supposition", () => {
  assert.ok(rattacher("Atelier parents-enfants", "").audiences.includes("enfants"));
  assert.ok(rattacher("Repas de quartier", "Entrée libre, tout public").audiences.includes("acces_libre"));
  /* Rien dans le texte, rien d'affirmé — sauf ce que la famille porte
     elle-même (une brocante est familiale par nature). */
  assert.deepEqual(rattacher("Conférence sur le climat", "").audiences, []);
});

/* ==========================================================================
   4. LES QUESTIONS NE NOMMENT AUCUNE CATÉGORIE
   ======================================================================== */
test("les questions ouvertes demandent ce qui se passe, pas si X a lieu", () => {
  const q = questionsOuvertes("Tourcoing");
  assert.ok(q.length >= 6);
  assert.ok(q.every((x) => x.includes("Tourcoing")));
  assert.ok(q.some((x) => /Que se passe-t-il/.test(x)));
  /* Le test qui compte : aucune question ne présuppose une catégorie
     précise du catalogue. Si elles le faisaient, on aurait juste déplacé
     WORDINGS dans une autre constante. */
  const q0 = q.slice(0, 6).join(" ").toLowerCase();
  for (const mot of ["brocante", "vide-grenier", "épicerie solidaire", "atelier"])
    assert.ok(!q0.includes(mot), "question trop dirigée : " + mot);
});

test("une ville vide ne produit aucune question", () => {
  assert.deepEqual(questionsOuvertes(""), []);
  assert.deepEqual(questionsOuvertes(null), []);
});
