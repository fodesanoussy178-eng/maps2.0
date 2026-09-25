/* ARTIST_NAMES — LE PRODUCTEUR QUI MANQUAIT

   CE QUI MANQUAIT, MESURÉ LE 25/09/2026

   `artist_names` était lu par `core.js`, `entites-canoniques.js` et trois RPC,
   et écrit par personne : ZÉRO nom sur 1 903 événements à venir. Deux causes :
   les champs structurés du contrat (`performers`, `artists`, `lineup`) ne sont
   servis ni par OpenAgenda ni par DATAtourisme, et le repli par le titre était
   un ANNUAIRE FERMÉ de seize célébrités — « NES », « Jazzy Bazz » et « Nono La
   Grinta » n'y étaient pas et n'y seraient jamais.

   Ces tests fixent le producteur ET ses refus. Les refus comptent plus que les
   acceptations : `artist_names` sert ensuite à chercher une PHOTO DE PERSONNE,
   et une exposition prise pour quelqu'un serait un mensonge que personne ne
   signalerait. Toutes les fixtures sont des lignes réelles de la base. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliserEvenementCanonique, normaliserArtistes,
  rangExtractionArtiste, refusArtisteDepuisTitre,
} from "../supabase/functions/shared/evenements-canoniques.mjs";
import { normaliserAnnonce } from "../supabase/functions/shared/annonces.mjs";

/* Lignes recopiées de `events` le 25/09/2026, sans retouche. */
const NES = Object.freeze({
  title: "NES", category: null,
  announcement_tags: ["rap", "music", "sport", "concert"],
  venue_name: "La Condition Publique - Roubaix",
  place_name: "La Condition Publique - Roubaix",
  description: "NeS sublime sa passion du rap en discipline, un moyen de dépasser ses doutes " +
    "et de livrer une musique cathartique, sincère et exigeante. Originaire du Val-de-Marne, " +
    "il s’impose très jeune comme l’un des espoirs les plus marquants de sa génération.",
});
const JAZZY = Object.freeze({
  title: "Jazzy Bazz", category: "concert",
  announcement_tags: ["festival", "concert", "rap", "music", "jazz"],
  venue_name: "La Condition Publique - Roubaix",
  description: "Le concert de Jazzy Bazz initialement prévu le 25/10/2025 à La Condition " +
    "Publique de Roubaix est reporté au 02/10/2026, même salle, même heure.",
});
const NONO = Object.freeze({
  title: "Nono La Grinta", category: "concert",
  announcement_tags: ["concert", "rap"], place_name: "Le Splendid",
  description: "La Grinta, comprenez la détermination, la hargne ou encore la rage de " +
    "vaincre… Un trait de caractère qui a été le moteur de la carrière de Nono La Grinta.",
});

const noms = (record) => normaliserEvenementCanonique(record).artist_names;

/* ==========================================================================
   1. LES TROIS CAS QUI ONT DÉCLENCHÉ CE FICHIER
   ======================================================================== */

test("la scène locale entre enfin — NeS, Jazzy Bazz, Nono La Grinta", () => {
  assert.deepEqual(noms(NES), ["NES"]);
  assert.deepEqual(noms(JAZZY), ["Jazzy Bazz"]);
  assert.deepEqual(noms(NONO), ["Nono La Grinta"]);
  /* Le nom ORIGINAL est conservé : « NES » n'est pas réécrit en « Nes ». */
  assert.equal(noms(NES)[0], NES.title);
});

test("le rang de l'extraction voyage avec le nom", () => {
  const canonique = normaliserEvenementCanonique(NES);
  assert.equal(canonique.artist_name_source, "title");
  /* Un nom déclaré par la source vaut mieux qu'un nom lu dans un titre, et la
     différence doit être lisible : la résolution d'image en dépend. */
  assert.equal(rangExtractionArtiste({title: "Soirée", performers: ["Ninho"],
    category: "concert"}), "structured");
  assert.equal(rangExtractionArtiste({title: "Ninho en concert"}), "profile");
  assert.equal(rangExtractionArtiste({title: "Marché du Vieux-Lille",
    announcement_tags: ["concert"], description: "Le Marché du Vieux-Lille."}), null);
});

/* ==========================================================================
   2. LES CHAMPS STRUCTURÉS PASSENT AVANT LE TITRE
   ======================================================================== */

test("un champ structuré est lu avant le titre, sans doublon", () => {
  const record = {title: "Soirée du Grand Mix", category: "concert",
    performers: ["Ninho", "Gazo", "Ninho"], place_name: "Le Grand Mix",
    description: "Une soirée."};
  assert.deepEqual(noms(record), ["Ninho", "Gazo"]);
  assert.equal(normaliserEvenementCanonique(record).artist_name_source, "structured");
});

test("une affiche à plusieurs noms rend plusieurs artistes", () => {
  const record = {title: "Jazzy Bazz + Nono La Grinta", category: "concert",
    announcement_tags: ["concert", "rap"], place_name: "Le Splendid",
    description: "Jazzy Bazz et Nono La Grinta partagent l’affiche pour une soirée rap."};
  assert.deepEqual(noms(record), ["Jazzy Bazz", "Nono La Grinta"]);
});

test("le producteur est déterministe et sans doublon", () => {
  const record = {title: "Jazzy Bazz & Jazzy Bazz", category: "concert",
    announcement_tags: ["concert", "rap"],
    description: "Jazzy Bazz revient sur scène."};
  const a = noms(record), b = noms(record);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["Jazzy Bazz"]);
  /* Et l'ordre suit celui de l'affiche, pas un tri arbitraire. */
  assert.deepEqual(normaliserArtistes({performers: ["Gazo", "Ninho"]}), ["Gazo", "Ninho"]);
});

/* ==========================================================================
   3. LES REFUS — CE QUI COMPTE VRAIMENT
   ======================================================================== */

test("un titre qui nomme un événement n'est pas un artiste", () => {
  for (const [titre, description] of [
    ["Marché du Vieux-Lille", "Le Marché du Vieux-Lille se tient chaque dimanche matin."],
    ["Exposition Panorama 28", "L’exposition Panorama 28 présente les travaux du Fresnoy."],
    ["Nuit des bibliothèques", "La Nuit des bibliothèques revient cette année."],
    ["Brocante vélos", "La Brocante vélos se tient place de la Mairie."],
  ]) {
    const record = {title: titre, category: "concert",
      announcement_tags: ["concert"], description};
    assert.deepEqual(noms(record), [], titre);
    assert.equal(refusArtisteDepuisTitre(record, {eventKind: "concert"}),
      "le titre nomme un événement ou une page");
  }
});

test("une page de site rangée en concert n'est pas un artiste", () => {
  /* Mesuré : le collecteur `venue_official` a rangé « Mentions légales »,
     « Politique de confidentialité » et « Notre mission » parmi les concerts.
     Ces titres ne doivent jamais devenir des noms de personne. */
  for (const titre of ["Mentions légales", "Politique de confidentialité",
    "Déclaration d'accessibilité", "À propos du Zénith de Lille", "Notre mission"]) {
    assert.deepEqual(noms({title: titre, category: "concert",
      announcement_tags: ["concert"], place_name: "Zénith de Lille",
      description: titre + " du Zénith de Lille."}), [], titre);
  }
});

test("un lieu, une salle ou une catégorie ne devient jamais un artiste", () => {
  const salle = {title: "Le Splendid", category: "concert",
    announcement_tags: ["concert", "rap"], place_name: "Le Splendid",
    description: "Le Splendid accueille une soirée rap."};
  assert.deepEqual(noms(salle), []);
  assert.equal(refusArtisteDepuisTitre(salle, {eventKind: "concert"}),
    "le titre est le nom du lieu, de l’organisateur ou de la catégorie");

  /* Et le cas inverse : le titre contenu dans le nom du lieu. */
  assert.deepEqual(noms({title: "Condition Publique", category: "concert",
    announcement_tags: ["concert", "rap"], venue_name: "La Condition Publique - Roubaix",
    description: "La Condition Publique reçoit une soirée rap."}), []);

  /* Un organisateur non plus. */
  assert.deepEqual(noms({title: "Aeronef", category: "concert",
    announcement_tags: ["concert"], organizer_name: "Aeronef",
    description: "Aeronef organise une soirée."}), []);
});

test("la source doit reparler du nom — sinon on ne l'invente pas", () => {
  const record = {title: "Aura Invalides", category: "concert",
    announcement_tags: ["concert"], place_name: "Les Invalides",
    description: "Un spectacle immersif sous le dôme."};
  assert.deepEqual(noms(record), []);
  assert.equal(refusArtisteDepuisTitre(record, {eventKind: "concert"}),
    "la description de la source ne reparle pas de ce nom");
});

test("un genre, une date, un titre trop long ne sont pas des noms", () => {
  const base = {category: "concert", announcement_tags: ["concert", "rap"]};
  assert.deepEqual(noms({...base, title: "Rap", description: "Une soirée rap."}), []);
  assert.deepEqual(noms({...base, title: "02/10/2026", description: "Le 02/10/2026."}), []);
  assert.deepEqual(noms({...base, title: "Une très longue annonce de six mots au moins ici",
    description: "Une très longue annonce de six mots au moins ici."}), []);
  assert.deepEqual(noms({...base, title: 'Cycle : "Jazz au féminin"',
    description: 'Cycle : "Jazz au féminin" revient.'}), []);
});

test("sans contexte musical venu de la SOURCE, aucun nom n'est extrait", () => {
  /* Le titre ne prouve pas son propre contexte : la page « Politique de
     confidentialité » du Zénith est rangée en `concert` par son collecteur. */
  const record = {title: "Nono La Grinta", category: "exposition",
    announcement_tags: ["exposition"], place_name: "Le Fresnoy",
    description: "Une exposition consacrée à Nono La Grinta."};
  assert.deepEqual(noms(record), []);
  assert.equal(refusArtisteDepuisTitre(record),
    "aucun contexte musical dans les métadonnées de la source");
});

/* ==========================================================================
   4. CE QUE L'IMPORT ÉCRIT VRAIMENT
   ======================================================================== */

test("l'annonce normalisée porte artist_names jusqu'à la base", () => {
  const {fields} = normaliserAnnonce(NES, {source: "openagenda",
    externalId: "95539747", sourceUrl: "https://openagenda.com/roubaix/events/95539747"});
  assert.deepEqual(fields.artist_names, ["NES"]);
  /* Et le tag `artist_*` en découle, donc « Pour toi » sait le lire. */
  assert.ok(fields.announcement_tags.includes("artist_nes"));
  /* `performers` reprend les artistes quand la source n'en donne pas d'autres. */
  assert.deepEqual(fields.performers, ["NES"]);
});

test("aucun nom n'est écrit pour un événement sans artiste", () => {
  const {fields} = normaliserAnnonce({title: "Marché du Vieux-Lille",
    announcement_tags: ["concert"], description: "Le Marché du Vieux-Lille."},
    {source: "datatourisme"});
  assert.equal(fields.artist_names, undefined);
});

/* ==========================================================================
   5. UNE PHOTO D'ARTISTE NE REMPLACE JAMAIS UNE AFFICHE
   ======================================================================== */

test("la cascade n'écrase jamais une image déjà présente", async () => {
  const { readFileSync } = await import("node:fs");
  for (const fichier of ["20260925120000_evenements_image_cascade.sql",
    "20260925130000_evenements_image_cascade_planifiee.sql"]) {
    const sql = readFileSync(new URL("../supabase/migrations/" + fichier, import.meta.url), "utf8");
    /* Chaque étape de la cascade ne regarde QUE les événements sans image :
       une vraie affiche d'événement ne peut donc pas être remplacée par une
       photo de lieu ni par un portrait. C'est la garde, et elle est structurelle
       — pas une précaution d'ordre d'exécution. */
    const etapes = sql.split("create or replace function").slice(1)
      .filter((bloc) => /update public\.events/.test(bloc));
    assert.ok(etapes.length > 0, fichier + " : aucune étape d'écriture trouvée");
    for (const bloc of etapes)
      assert.match(bloc, /ev\.image_url is null/,
        fichier + " : une étape écrit sans vérifier que l'image est absente");
  }
});

/* ==========================================================================
   6. UNE AFFICHE TROUVÉE NE DISPARAÎT PAS À LA SYNCHRO SUIVANTE
   ======================================================================== */

test("une source muette n'efface pas l'image d'une autre", async () => {
  const { fusionnerEvenementFaits } =
    await import("../supabase/functions/shared/evenements-canoniques.mjs");

  /* LE DÉFAUT, MESURÉ EN PRODUCTION LE 25/09/2026. L'événement NeS existe dans
     les deux catalogues. À 06:00:56 la synchro OpenAgenda lui a apporté son
     affiche ; à 09:34:04 la synchro DATAtourisme a réécrit la même ligne avec
     `image_url: null` — DATAtourisme ne sert aucune image — et l'affiche a
     disparu. Quatre fois par jour. */
  const existant = {
    title: "NES", primary_source: "openagenda",
    image_url: "https://img.openagenda.com/main/ac77b70e788f41f9a7c70e109096118c.full.image.jpg",
    image_source: "openagenda", image_source_url: "https://openagenda.com/roubaix/events/95539747",
    image_type: "event_poster", image_confidence: 0.9, image_usage_status: "remote_only",
    image_updated_at: "2026-08-06T07:40:28Z", image_checked_at: "2026-09-25T10:00:00Z",
    image_author: null, image_license: null,
  };
  const datatourisme = {
    title: "NES", image_url: null, image_source: null, image_source_url: null,
    image_author: null, image_license: null, image_updated_at: null,
  };

  const fusionne = fusionnerEvenementFaits(existant, datatourisme);
  assert.equal(fusionne.image_url, existant.image_url, "l'affiche doit survivre");
  assert.equal(fusionne.image_source, "openagenda");
  assert.equal(fusionne.image_type, "event_poster");
  assert.equal(fusionne.image_confidence, 0.9);
  assert.equal(fusionne.image_usage_status, "remote_only");
  assert.equal(fusionne.image_checked_at, "2026-09-25T10:00:00Z");
  assert.equal(fusionne.image_updated_at, "2026-08-06T07:40:28Z");
});

test("une source qui DONNE une image remplace bien l'ancienne", () => {
  /* La protection ne doit pas figer une image : elle empêche l'effacement par
     le silence, pas la mise à jour par une source qui parle. */
  return import("../supabase/functions/shared/evenements-canoniques.mjs")
    .then(({ fusionnerEvenementFaits }) => {
      const fusionne = fusionnerEvenementFaits(
        {image_url: "https://ancienne.test/a.jpg", image_source: "openagenda"},
        {image_url: "https://nouvelle.test/b.jpg", image_source: "event_page",
         image_type: "event_poster"});
      assert.equal(fusionne.image_url, "https://nouvelle.test/b.jpg");
      assert.equal(fusionne.image_source, "event_page");
    });
});
