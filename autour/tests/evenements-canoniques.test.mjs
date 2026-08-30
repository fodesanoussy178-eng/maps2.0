import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_KINDS,
} from "../supabase/functions/shared/evenements-canoniques.mjs";
import {normaliserEvenementCanonique} from "../supabase/functions/shared/evenements-canoniques.mjs";
import {normaliserAnnonce} from "../supabase/functions/shared/annonces.mjs";

await import("../core.js");

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
