import assert from "node:assert/strict";
import test from "node:test";

import {
  analyserDate, analyserHeure, instantLocal, analyserPeriode,
  analyserPosition, analyserAdresse, estEvenement, normaliserEvenement,
  titreNormalise, cleDedup, similariteTitre, memeEvenement,
  dedupliquer, normaliserLot, dansLaZone, cleCommune, communeDeLaZone,
} from "../supabase/functions/sync-datatourisme/normalisation.mjs";

/* La zone d'essai est un rectangle nommé, exactement comme une ligne de
   `event_areas`. Aucun test ne doit pouvoir passer grâce au mot « Lille ». */
const ZONE_LILLE = {
  id: 1, code: "lille", name: "Lille et la Métropole européenne",
  timezone: "Europe/Paris",
  min_lat: 50.55, min_lng: 2.90, max_lat: 50.75, max_lng: 3.25,
};
const ZONE_TOULOUSE = {
  id: 6, code: "toulouse", name: "Toulouse Métropole", timezone: "Europe/Paris",
  min_lat: 43.53, min_lng: 1.35, max_lat: 43.68, max_lng: 1.52,
};

function poi(surcharges = {}) {
  return {
    uuid: "abc-123",
    "@type": ["schema:Event", "EntertainmentAndEvent"],
    label: {fr: "Concert au Grand Sud"},
    hasDescription: {fr: "Un concert"},
    isLocatedAt: [{
      geo: {latitude: "50.6292", longitude: "3.0573"},
      label: {fr: "Salle du Grand Sud"},
      address: {streetAddress: "5 rue de l'Europe", postalCode: "59000", addressLocality: "Lille"},
    }],
    takesPlaceAt: [{startDate: "2026-08-15", endDate: "2026-08-15"}],
    ...surcharges,
  };
}

/* ======================================================================== */
test("une date horodatée est lue comme exacte", () => {
  const d = analyserDate("2026-08-15T20:30:00+02:00");
  assert.equal(d.precision, "exact");
  assert.equal(d.iso, "2026-08-15T18:30:00.000Z");
});

test("une journée seule est lue comme journée, jamais comme exacte", () => {
  const d = analyserDate("2026-08-15");
  assert.equal(d.precision, "day");
  assert.equal(d.jour, "2026-08-15");
});

test("une date illisible ne produit rien plutôt qu'une approximation", () => {
  for (const brut of ["", null, "bientôt", "été 2026", "15/08/2026"]) {
    assert.equal(analyserDate(brut), null, `« ${brut} » ne doit pas être daté`);
  }
});

test("une heure isolée est lue, et une heure impossible est refusée", () => {
  assert.equal(analyserHeure("20:30"), "20:30");
  assert.equal(analyserHeure("2026-08-15T09:05:00"), "09:05");
  assert.equal(analyserHeure("29:99"), null);
  assert.equal(analyserHeure("le soir"), null);
});

test("une heure locale est recomposée dans le fuseau de la zone, pas en UTC", () => {
  // en août, Paris est à UTC+2 : 20:30 local, c'est 18:30 UTC
  assert.equal(instantLocal("2026-08-15", "20:30", "Europe/Paris"), "2026-08-15T18:30:00.000Z");
  // en janvier, UTC+1
  assert.equal(instantLocal("2026-01-15", "20:30", "Europe/Paris"), "2026-01-15T19:30:00.000Z");
});

/* ---- La règle qui commande tout ---------------------------------------- */
test("des journées sans heure ne deviennent JAMAIS une période exacte", () => {
  const p = analyserPeriode(poi(), {maintenant: Date.parse("2026-08-15T12:00:00Z")});
  assert.equal(p.confidence, "day",
    "une journée sans heure ne doit pas se déguiser en horaire connu");
});

test("une fin absente interdit la confiance exacte", () => {
  const p = analyserPeriode(poi({
    takesPlaceAt: [{startDate: "2026-08-15T20:30:00+02:00"}],
  }), {maintenant: Date.parse("2026-08-01T12:00:00Z")});
  assert.equal(p.end_at, null, "aucune fin ne doit être inventée");
  assert.notEqual(p.confidence, "exact");
});

test("une journée accompagnée de ses heures redevient exacte", () => {
  const p = analyserPeriode(poi({
    takesPlaceAt: [{
      startDate: "2026-08-15", startTime: "20:30",
      endDate: "2026-08-15", endTime: "23:00",
    }],
  }), {maintenant: Date.parse("2026-08-01T12:00:00Z")});
  assert.equal(p.confidence, "exact");
  assert.equal(p.start_at, "2026-08-15T18:30:00.000Z");
  assert.equal(p.end_at, "2026-08-15T21:00:00.000Z");
});

test("parmi plusieurs séances, c'est celle qui compte maintenant qui est retenue", () => {
  const maintenant = Date.parse("2026-08-15T12:00:00Z");
  const p = analyserPeriode(poi({
    takesPlaceAt: [
      {startDate: "2026-06-01T20:00:00Z", endDate: "2026-06-01T22:00:00Z"},
      {startDate: "2026-08-15T11:00:00Z", endDate: "2026-08-15T14:00:00Z"},
      {startDate: "2026-09-01T20:00:00Z", endDate: "2026-09-01T22:00:00Z"},
    ],
  }), {maintenant});
  assert.equal(p.start_at, "2026-08-15T11:00:00.000Z",
    "une série ne doit pas être jugée sur sa première séance, passée depuis des mois");
});

test("sans séance en cours, c'est la prochaine à venir qui est retenue", () => {
  const p = analyserPeriode(poi({
    takesPlaceAt: [
      {startDate: "2026-06-01T20:00:00Z", endDate: "2026-06-01T22:00:00Z"},
      {startDate: "2026-09-01T20:00:00Z", endDate: "2026-09-01T22:00:00Z"},
    ],
  }), {maintenant: Date.parse("2026-08-15T12:00:00Z")});
  assert.equal(p.start_at, "2026-09-01T20:00:00.000Z");
});

test("aucune période lisible donne une confiance inconnue", () => {
  const p = analyserPeriode(poi({takesPlaceAt: [{startDate: "cet été"}]}), {});
  assert.deepEqual(p, {start_at: null, end_at: null, confidence: "unknown"});
});

/* ---- Lieu --------------------------------------------------------------- */
test("les coordonnées sont lues, y compris sous forme de chaînes", () => {
  const p = analyserPosition(poi());
  assert.equal(p.lat, 50.6292);
  assert.equal(p.lng, 3.0573);
});

test("un POI sans coordonnées ne produit pas un point à (0,0)", () => {
  assert.equal(analyserPosition({isLocatedAt: [{label: "quelque part"}]}), null);
});

test("l'adresse est recomposée, le code INSEE seulement s'il en a la forme", () => {
  const a = analyserAdresse(poi().isLocatedAt[0]);
  assert.equal(a.city, "Lille");
  assert.match(a.address, /rue de l'Europe/);
  assert.equal(a.insee_code, null, "un code INSEE absent ne doit pas être deviné");
});

/* ---- Ce qui entre dans la couche canonique ------------------------------ */
test("seuls les événements entrent : un château est écarté", () => {
  assert.equal(estEvenement(poi()), true);
  assert.equal(estEvenement({"@type": ["CulturalSite", "Castle"]}), false);
  assert.equal(normaliserEvenement({
    "@type": ["CulturalSite"], uuid: "x", label: "Château",
    isLocatedAt: [{geo: {latitude: 50.6, longitude: 3.05}}],
  }), null);
});

test("un POI sans identifiant, sans titre ou sans position est refusé", () => {
  assert.equal(normaliserEvenement(poi({uuid: ""})), null);
  assert.equal(normaliserEvenement(poi({label: ""})), null);
  assert.equal(normaliserEvenement(poi({isLocatedAt: []})), null);
});

test("un événement normalisé porte sa confiance de date et sa source", () => {
  const n = normaliserEvenement(poi(), {maintenant: Date.parse("2026-08-01T12:00:00Z")});
  assert.equal(n.source, "datatourisme");
  assert.equal(n.external_id, "abc-123");
  assert.equal(n.event.primary_source, "datatourisme");
  assert.equal(n.event.date_confidence, "day");
  assert.equal(n.event.cancelled, false);
  assert.equal(n.event.timezone, "Europe/Paris");
});

/* ---- La clé de rapprochement doit être celle de Postgres ---------------- */
test("le titre normalisé perd accents et ponctuation", () => {
  assert.equal(titreNormalise("Fête de la Musique — Édition 2026"),
    "fete de la musique edition 2026");
});

test("la clé de déduplication est stable et refuse les données incomplètes", () => {
  const cle = cleDedup("Fête de la Musique", 50.6292, 3.0573, "2026-08-15T18:30:00Z");
  assert.equal(cle, "fete de la musique|50.629|3.057|2026081518");
  assert.equal(cleDedup("", 50.6, 3.0, "2026-08-15T18:30:00Z"), null);
  assert.equal(cleDedup("Titre", null, 3.0, "2026-08-15T18:30:00Z"), null);
  assert.equal(cleDedup("Titre", 50.6, 3.0, null), null);
});

test("les longitudes négatives s'arrondissent comme le fait Postgres", () => {
  // Bordeaux : une divergence d'arrondi ici produirait deux événements pour un
  const cle = cleDedup("Marché", 44.8378, -0.5792, "2026-08-15T10:00:00Z");
  assert.equal(cle, "marche|44.838|-0.579|2026081510");
});

/* ---- Déduplication ------------------------------------------------------ */
test("deux titres identiques se reconnaissent, deux titres différents non", () => {
  assert.equal(similariteTitre("Fête de la Musique", "Fête de la musique"), 1);
  assert.ok(similariteTitre("Fête de la Musique", "Fete de la Musique 2026") > 0.8);
  assert.ok(similariteTitre("Concert de jazz", "Marché de Noël") < 0.4);
});

test("le même endroit ne suffit JAMAIS à fusionner deux événements", () => {
  const salle = {lat: 50.6292, lng: 3.0573, start_at: "2026-08-15T18:30:00Z"};
  assert.equal(memeEvenement(
    {...salle, title: "Concert de jazz"},
    {...salle, title: "Soirée électro"}), false,
    "deux concerts différents dans la même salle le même soir restent deux événements");
});

test("titre proche + lieu proche + horaire proche fusionnent", () => {
  assert.equal(memeEvenement(
    {title: "Fête de la Musique", lat: 50.6292, lng: 3.0573, start_at: "2026-08-15T18:30:00Z"},
    {title: "Fete de la musique", lat: 50.6293, lng: 3.0574, start_at: "2026-08-15T19:00:00Z"}),
    true);
});

test("un titre identique loin ou à une autre date ne fusionne pas", () => {
  const a = {title: "Fête de la Musique", lat: 50.6292, lng: 3.0573, start_at: "2026-08-15T18:30:00Z"};
  assert.equal(memeEvenement(a, {...a, lat: 50.70}), false, "10 km, ce n'est pas le même lieu");
  assert.equal(memeEvenement(a, {...a, start_at: "2026-08-20T18:30:00Z"}), false);
});

test("sans date des deux côtés, le doute conserve deux événements", () => {
  const a = {title: "Marché", lat: 50.6292, lng: 3.0573, start_at: null};
  assert.equal(memeEvenement(a, {...a}), false);
});

test("un doublon devient une provenance de plus, pas une ligne perdue", () => {
  const base = {lat: 50.6292, lng: 3.0573, start_at: "2026-08-15T18:30:00Z"};
  const {gardes, fusionnes} = dedupliquer([
    {source: "datatourisme", external_id: "a",
     event: {...base, title: "Fête de la Musique", description: null}},
    {source: "openagenda", external_id: "b",
     event: {...base, title: "Fete de la musique", description: "Une description"}},
  ]);
  assert.equal(gardes.length, 1);
  assert.equal(fusionnes, 1);
  assert.deepEqual(gardes[0].provenances, [{source: "openagenda", external_id: "b"}]);
  assert.equal(gardes[0].event.description, "Une description",
    "la fusion complète les trous sans écraser ce qui était connu");
});

test("la fusion n'écrase pas une valeur déjà connue", () => {
  const base = {lat: 50.6292, lng: 3.0573, start_at: "2026-08-15T18:30:00Z"};
  const {gardes} = dedupliquer([
    {source: "a", external_id: "1", event: {...base, title: "Concert", description: "Première"}},
    {source: "b", external_id: "2", event: {...base, title: "Concert", description: "Seconde"}},
  ]);
  assert.equal(gardes[0].event.description, "Première");
});

/* ---- La zone --------------------------------------------------------- */
test("une zone est un rectangle, et rien d'autre", () => {
  assert.equal(dansLaZone(50.6292, 3.0573, ZONE_LILLE), true);
  assert.equal(dansLaZone(43.6045, 1.4442, ZONE_LILLE), false);
  assert.equal(dansLaZone(43.6045, 1.4442, ZONE_TOULOUSE), true);
  assert.equal(dansLaZone(null, 3.05, ZONE_LILLE), false);
});

test("le même lot donne le même traitement quelle que soit la zone", () => {
  const toulousain = poi({
    uuid: "tls-1", label: {fr: "Concert au Bikini"},
    isLocatedAt: [{geo: {latitude: 43.6045, longitude: 1.4442}}],
  });
  const lot = normaliserLot([toulousain], ZONE_TOULOUSE, {maintenant: Date.now()});
  assert.equal(lot.gardes.length, 1);
  // exactement le même POI, jugé hors zone par le rectangle lillois
  const hors = normaliserLot([toulousain], ZONE_LILLE, {maintenant: Date.now()});
  assert.equal(hors.gardes.length, 0);
  assert.equal(hors.rejets, 1);
});

test("un POI défectueux est compté puis oublié, il ne fait pas tomber le lot", () => {
  const lot = normaliserLot([
    poi(),
    null,
    {"@type": ["Event"]},                       // ni identifiant ni position
    "pas un objet",
    poi({uuid: "def-456", isLocatedAt: []}),    // sans position
  ], ZONE_LILLE, {maintenant: Date.parse("2026-08-01T12:00:00Z")});

  assert.equal(lot.vus, 5);
  assert.equal(lot.gardes.length, 1, "le seul POI exploitable doit survivre aux quatre autres");
  assert.equal(lot.rejets, 4);
});

test("un lot vide ne casse rien", () => {
  const lot = normaliserLot([], ZONE_LILLE, {});
  assert.deepEqual({vus: lot.vus, gardes: lot.gardes.length, rejets: lot.rejets},
    {vus: 0, gardes: 0, rejets: 0});
});

/* ---- La liste de communes, et pourquoi elle ne peut pas être un rectangle */

const ZONE_MEL = {
  id: 1, code: "lille", name: "Métropole Européenne de Lille", timezone: "Europe/Paris",
  min_lat: 50.44, min_lng: 2.68, max_lat: 50.82, max_lng: 3.32,
  commune_keys: ["lille", "hellemmes", "lomme", "villeneuvedascq", "halluin",
                 "comines", "armentieres", "fachesthumesnil", "marcqenbaroeul"],
};

test("la clé de commune efface la ponctuation, les accents et la ligature", () => {
  assert.equal(cleCommune("Faches Thumesnil"), cleCommune("Faches-Thumesnil"));
  assert.equal(cleCommune("LILLE"), "lille");
  assert.equal(cleCommune("Marcq-en-Barœul"), "marcqenbaroeul");
  assert.equal(cleCommune("St-André-lez-Lille"), cleCommune("Saint-André-lez-Lille"));
  assert.equal(cleCommune(""), "");
});

test("les communes que le rectangle attrapait sans qu'elles soient la MEL sont refusées", () => {
  /* Orchies et Bailleul tombent dans le rectangle élargi ; elles ne sont pas
     de la métropole. C'est précisément ce que la liste sert à dire. */
  assert.equal(communeDeLaZone("Orchies", ZONE_MEL), false);
  assert.equal(communeDeLaZone("Bailleul", ZONE_MEL), false);
  assert.equal(communeDeLaZone("Lille", ZONE_MEL), true);
  assert.equal(communeDeLaZone("Halluin", ZONE_MEL), true);
});

test("les communes associées ne sont pas des communes étrangères", () => {
  /* Hellemmes et Lomme ne figurent pas dans la liste officielle des 95 : ce
     sont des communes associées de Lille. Les refuser viderait des salles. */
  assert.equal(communeDeLaZone("Hellemmes", ZONE_MEL), true);
  assert.equal(communeDeLaZone("Lomme", ZONE_MEL), true);
});

test("une ville absente ne passe pas quand la zone porte une liste", () => {
  assert.equal(communeDeLaZone(null, ZONE_MEL), false);
  assert.equal(communeDeLaZone("", ZONE_MEL), false);
});

test("une zone sans liste garde le comportement du rectangle seul", () => {
  assert.equal(communeDeLaZone("N'importe où", ZONE_LILLE), true);
  assert.equal(dansLaZone(50.6292, 3.0573, ZONE_LILLE), true);
});

test("Halluin entre par le nouveau rectangle et par la liste", () => {
  /* 50.787 était au-dessus de l'ancien plafond 50.75 : la commune n'était
     jamais interrogée. C'est l'explication de son zéro. */
  assert.equal(dansLaZone(50.7867, 3.1281, ZONE_MEL, "Halluin"), true);
  assert.equal(dansLaZone(50.7867, 3.1281, ZONE_LILLE), false);
  assert.equal(dansLaZone(50.6875, 2.8811, ZONE_MEL, "Armentières"), true);
  assert.equal(dansLaZone(50.4906, 2.9736, ZONE_MEL, "Carnin"), false); // pas dans la liste courte du test
});

test("le rectangle reste une condition, la liste ne le remplace pas", () => {
  assert.equal(dansLaZone(48.8566, 2.3522, ZONE_MEL, "Lille"), false);
});
