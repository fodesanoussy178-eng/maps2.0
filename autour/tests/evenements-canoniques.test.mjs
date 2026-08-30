import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {
  EVENT_KINDS,
} from "../supabase/functions/shared/evenements-canoniques.mjs";
import {normaliserEvenementCanonique} from "../supabase/functions/shared/evenements-canoniques.mjs";
import {normaliserAnnonce} from "../supabase/functions/shared/annonces.mjs";
import {normalizeOpenAgendaEvent} from "../supabase/functions/sync-openagenda/normalize.mjs";
import {lilleTestSource} from "../supabase/functions/sync-openagenda/config.mjs";
import {PISCINE_PAYSAGE} from "./fixtures-piscine-paysage.mjs";

const navigateur = {};
vm.runInNewContext(await readFile(new URL("../evenements-canoniques.js", import.meta.url), "utf8"), navigateur);
const EVENEMENTS = navigateur.AutourEvenements;

await import("../core.js");
await import("../temporel.js");

test("Ninho annoncé dans le titre devient concert rap et artiste Pour toi", () => {
  const {fields} = normaliserAnnonce({title: "Ninho en concert"}, {source: "openagenda"});
  assert.deepEqual(fields.artist_names, ["Ninho"]);
  assert.deepEqual(fields.music_genres, ["rap"]);
  assert.equal(fields.event_kind, "concert");
  assert.ok(fields.announcement_tags.includes("concert"));
  assert.ok(fields.announcement_tags.includes("rap"));
  assert.ok(fields.announcement_tags.includes("artist_ninho"));
});

test("artistes français rap/R&B/pop et artistes internationaux gardent plusieurs genres", () => {
  const cas = [
    ["Aya Nakamura en showcase", ["Aya Nakamura"], ["rnb", "pop", "afro"]],
    ["Aya en concert", ["Aya Nakamura"], ["rnb", "pop", "afro"]],
    ["Concert Angèle", ["Angèle"], ["pop"]],
    ["Gazo live", ["Gazo"], ["rap", "drill"]],
    ["Kendrick Lamar concert", ["Kendrick Lamar"], ["rap"]],
    ["The Weeknd en concert", ["The Weeknd"], ["rnb", "pop"]],
  ];
  for (const [title, artists, genres] of cas) {
    const result = normaliserEvenementCanonique({title});
    assert.deepEqual(result.artist_names, artists, title);
    assert.deepEqual(result.music_genres, genres, title);
    for (const genre of genres) assert.ok(result.announcement_tags.includes(genre), `${title}: ${genre}`);
    assert.ok(result.announcement_tags.includes(`artist_${artists[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_")}`));
  }
});

test("les artistes structurés et leurs genres priment sur les heuristiques du titre", () => {
  const result = normaliserEvenementCanonique({
    title: "Ninho en concert",
    eventType: "showcase",
    performers: [{name: "Ninho"}],
    music_genres: ["classique"],
  });
  assert.equal(result.event_kind, "showcase");
  assert.deepEqual(result.artist_names, ["Ninho"]);
  assert.deepEqual(result.music_genres, ["classical"]);
  assert.ok(result.announcement_tags.includes("showcase"));
  assert.ok(!result.music_genres.includes("rap"));
});

test("un artiste inconnu ne reçoit aucun genre inventé", () => {
  const result = normaliserEvenementCanonique({
    title: "Zed Inconnu en concert",
    performer: "Zed Inconnu",
  });
  assert.deepEqual(result.artist_names, ["Zed Inconnu"]);
  assert.deepEqual(result.music_genres, []);
  assert.equal(result.event_kind, "concert");
  assert.ok(result.announcement_tags.includes("concert"));
  assert.ok(!result.announcement_tags.some((tag) => ["rap", "rnb", "pop", "rock", "afro", "electro"].includes(tag)));
});

test("la fusion de sources ne perd ni artiste, ni genre, ni type", () => {
  const Core = globalThis.AutourCore;
  const gauche = Core.toCommonItem({
    id: "event-same", title: "Concert au parc", cat: "event", isTemporary: true,
    lat: 48.8566, lng: 2.3522, artist_names: ["Ninho"], music_genres: ["rap"],
    event_kind: "concert", announcement_tags: ["concert", "rap", "artist_ninho"],
  }, {source: "datatourisme"});
  const droite = Core.toCommonItem({
    id: "event-same", title: "Concert au parc", cat: "event", isTemporary: true,
    lat: 48.8566, lng: 2.3522, event_kind: "concert", announcement_tags: ["concert"],
  }, {source: "openagenda"});
  const fusion = Core.dedupeItems([gauche, droite], () => 0)[0];
  assert.deepEqual(fusion.artist_names, ["Ninho"]);
  assert.deepEqual(fusion.music_genres, ["rap"]);
  assert.equal(fusion.event_kind, "concert");
  assert.ok(fusion.announcement_tags.includes("artist_ninho"));
});

test("les types structurés et textuels restent des manifestations temporaires", () => {
  const exemples = [
    ["concert", "Concert"], ["showcase", "Showcase"], ["dj_set", "DJ set"],
    ["festival", "Festival"], ["open_air", "Open air"], ["fete", "Fête"],
    ["fete_populaire", "Fête populaire"], ["fete_foraine", "Fête foraine"],
    ["carnaval", "Carnaval"], ["kermesse", "Kermesse"], ["guinguette", "Guinguette"],
    ["bal", "Bal"], ["feu_artifice", "Feu d'artifice"], ["braderie", "Braderie"],
    ["brocante", "Brocante"], ["vide_grenier", "Vide-grenier"], ["marche_de_noel", "Marché de Noël"],
    ["fete_de_la_musique", "Fête de la musique"], ["fan_zone", "Fan zone"],
  ];
  assert.deepEqual(new Set(exemples.map(([kind]) => kind)), new Set(EVENT_KINDS));
  for (const [expected, title] of exemples) {
    const result = normaliserEvenementCanonique({title});
    assert.equal(result.event_kind, expected, title);
    assert.ok(result.announcement_tags.includes(expected), `${title} doit produire son tag`);
  }
});

test("fixture La Piscine : l'événement canonique conserve tarif, public, âge et réservation", () => {
  const normalized = normalizeOpenAgendaEvent(PISCINE_PAYSAGE, {
    source: lilleTestSource(),
    now: new Date("2026-08-20T10:00:00.000Z"),
  });
  const event = normalized.event;
  assert.equal(event.title, "Paysage");
  assert.equal(event.start_at, "2026-08-30T14:00:00.000Z");
  assert.equal(event.end_at, "2026-08-30T15:30:00.000Z");
  assert.equal(event.date_confidence, "exact");
  assert.equal(event.price_amount, 4);
  assert.match(event.price_text, /4 € par enfant/);
  assert.equal(event.is_free, false);
  assert.equal(event.audience, "Enfants et familles");
  assert.equal(event.min_age, 4);
  assert.equal(event.reservation_required, false);
  assert.match(event.reservation_text, /Sans réservation/);
  assert.doesNotMatch(event.description, /\*\*/);
  assert.match(event.description, /https:\/\/www\.roubaix-lapiscine\.com/);
  assert.equal(event.event_source, "openagenda");
  assert.equal(event.place_source, "openstreetmap");
});

test("l'objet navigateur unique garde les mêmes faits et refuse une gratuité implicite", () => {
  const event = EVENEMENTS.normaliserEvenement({
    title: PISCINE_PAYSAGE.title,
    description: PISCINE_PAYSAGE.description,
    start_at: "2026-08-30T14:00:00.000Z",
    end_at: "2026-08-30T15:30:00.000Z",
    timezone: "Europe/Paris",
    date_confidence: "exact",
    event_source: "openagenda",
    event_source_url: PISCINE_PAYSAGE.canonicalUrl,
    place_source: "openstreetmap",
    venue_name: PISCINE_PAYSAGE.location.name,
  });
  assert.equal(event.title, "Paysage");
  assert.equal(event.price_amount, 4);
  assert.equal(event.is_free, false);
  assert.match(EVENEMENTS.tarifEvenement(event), /4 € par enfant/);
  assert.equal(event.audience, "Enfants et familles");
  assert.equal(event.min_age, 4);
  assert.equal(event.reservation_required, false);
  assert.doesNotMatch(event.description, /\*\*/);
  assert.equal(event.event_source, "openagenda");
  assert.equal(event.place_source, "openstreetmap");
});

test("l'extraction textuelle vise le montant, pas l'heure qui le précède", () => {
  const input = {
    title: "Paysage",
    description: "Chaque dimanche de 16h à 17h30. 4 € par enfant, en plus de l'entrée du musée.",
  };
  assert.equal(EVENEMENTS.normaliserEvenement(input).price_amount, 4);
  assert.equal(normaliserEvenementCanonique(input).price_amount, 4);
});

test("une gratuité explicite devient Entrée libre, et rien d'autre", () => {
  const event = EVENEMENTS.normaliserEvenement({title: "Visite", is_free: true});
  assert.equal(event.is_free, true);
  assert.equal(event.price_amount, 0);
  assert.equal(EVENEMENTS.tarifEvenement(event), "Entrée libre");
});

test("un horaire et une date structurés restent lisibles sans inventer", () => {
  const event = EVENEMENTS.normaliserEvenement({
    title: "Atelier", start_at: "2026-08-30T14:00:00.000Z", end_at: "2026-08-30T15:30:00.000Z",
    timezone: "Europe/Paris", date_confidence: "exact",
  });
  const now = Date.parse("2026-08-20T10:00:00Z");
  const etat = globalThis.AutourTemps.etatTemporalEvenement(event, now);
  const texte = globalThis.AutourTemps.libelleDate(event, now, {statut: etat});
  assert.equal(texte, "Dimanche 30 août · 16h00–17h30");
  assert.notEqual(texte, "Date à vérifier");
});

test("un horaire récurrent complète seulement l'occurrence compatible", () => {
  const input = {
    title: "Paysage",
    description: "Chaque dimanche de 16h à 17h30",
    start_at: "2026-08-30",
    timezone: "Europe/Paris",
  };
  const browserEvent = EVENEMENTS.normaliserEvenement(input);
  const serverEvent = normaliserEvenementCanonique(input);
  for (const event of [browserEvent, serverEvent]) {
    assert.equal(event.start_at, "2026-08-30T14:00:00.000Z");
    assert.equal(event.end_at, "2026-08-30T15:30:00.000Z");
    assert.equal(event.date_confidence, "exact");
  }
  const incompatible = EVENEMENTS.normaliserEvenement({...input, start_at: "2026-08-31"});
  assert.equal(incompatible.start_at, "2026-08-31");
  assert.equal(incompatible.end_at, null);
});

test("le nettoyage conserve les URL utiles sans laisser de Markdown", () => {
  const event = EVENEMENTS.normaliserEvenement({
    title: "**Paysage**", description: "<p>**Paysage** [infos](https://example.test/paysage)</p>",
  });
  assert.equal(event.title, "Paysage");
  assert.equal(event.description, "Paysage infos (https://example.test/paysage)");
  assert.doesNotMatch(event.description, /[*_`<]/);
});

test("les fallbacks ne fabriquent ni gratuité, ni date, ni réservation", () => {
  const unknown = EVENEMENTS.normaliserEvenement({title: "Événement", description: "Venez quand vous voulez."});
  assert.equal(unknown.is_free, null);
  assert.equal(unknown.price_amount, null);
  assert.equal(EVENEMENTS.tarifEvenement(unknown), "Tarif à vérifier");
  assert.equal(unknown.date_confidence, "unknown");
  assert.equal(unknown.reservation_required, null);
  assert.equal(EVENEMENTS.reservationEvenement(unknown), "Réservation à vérifier");
});
