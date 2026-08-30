import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  AERONEF_ARRESTED_DEVELOPMENT,
  INSTITUT_MONDE_ARABE_TOURCOING,
} from "./fixtures-entites-medias.mjs";

const evenementSource = await readFile(new URL("../evenements-canoniques.js", import.meta.url), "utf8");
const entitesSource = await readFile(new URL("../entites-canoniques.js", import.meta.url), "utf8");
const imagesSource = await readFile(new URL("../images.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const ecransSource = await readFile(new URL("../differe/ecrans.js", import.meta.url), "utf8");

function modules() {
  const contexte = vm.createContext({window: {}, console});
  vm.runInContext(evenementSource, contexte);
  vm.runInContext(entitesSource, contexte);
  vm.runInContext(imagesSource, contexte);
  return {
    ENTITES: contexte.AutourEntites,
    IMAGES: contexte.window.AutourImages,
  };
}

test("CanonicalEvent et CanonicalPlace sont deux contrats disjoints", () => {
  const {ENTITES} = modules();
  const event = ENTITES.CanonicalEvent({
    title: "Animation **Paysage**",
    description: "Chaque dimanche de 16h à 17h30. 4 € par enfant.",
    start_at: "2026-08-30T14:00:00.000Z",
    end_at: "2026-08-30T15:30:00.000Z",
    event_source: "openagenda",
    event_source_url: "https://openagenda.com/events/paysage",
    place_source: "openstreetmap",
    image_source: "openagenda",
    image_url: "https://img.openagenda.com/main/paysage.jpg",
    isTemporary: true,
  });
  const place = ENTITES.CanonicalPlace({
    title: "Institut du Monde Arabe - Tourcoing",
    source: "openstreetmap",
    isTemporary: false,
  });

  assert.equal(event.entity_type, "event");
  assert.equal(place.entity_type, "place");
  assert.equal(ENTITES.estEvenement({entity_type: "place", isTemporary: true, cat: "sport"}), false,
    "un lieu permanent explicite ne doit jamais devenir un événement");
  assert.equal(event.event_source, "openagenda");
  assert.equal(event.place_source, "openstreetmap");
  assert.equal(place.event_source, null);
  assert.equal(place.event_source_url, null);
  assert.equal(place.is_free, null, "un prix absent n'est pas une gratuité");
  assert.match(ENTITES.tarifLieu(place), /Tarif à vérifier/);
  assert.equal(ENTITES.CanonicalEvent({
    title: "Événement avec photo de fiche Places",
    isTemporary: true,
    image_source: "google_places",
    image_url: "https://places.googleapis.com/v1/places/X/photos/Y/media?key=k",
  }).image_url, null, "Google Places reste une photo de lieu, jamais une affiche");
  assert.equal(ENTITES.tarifLieu(ENTITES.CanonicalPlace({price_text: "Entrée libre"})), "Entrée libre");
  assert.doesNotMatch(JSON.stringify(event), /undefined|\[object Object\]|\*\*|\[[^\]]+\]\(/);
});

test("le lieu permanent garde une formulation sûre pour ses inconnues", () => {
  const {ENTITES} = modules();
  const place = ENTITES.CanonicalPlace(INSTITUT_MONDE_ARABE_TOURCOING);
  assert.equal(place.organizer_name, null);
  assert.equal(ENTITES.organisateurLieu(place), "Organisateur non renseigné");
  assert.equal(ENTITES.horaireLieu(place), "Horaires à vérifier");
  assert.equal(ENTITES.tarifLieu(place), "Tarif à vérifier");
  assert.doesNotMatch(JSON.stringify(place), /undefined|\[object Object\]|\*\*|\[[^\]]+\]\(/);
});

test("les familles d'événements et de lieux gardent leurs inconnues explicites", () => {
  const {ENTITES} = modules();
  for (const title of ["Concert", "Exposition", "Animation jeunesse", "Fête de quartier"]) {
    const event = ENTITES.CanonicalEvent({title, isTemporary: true});
    assert.equal(event.entity_type, "event", title);
    assert.equal(event.is_free, null, title);
    assert.equal(event.start_at, null, title);
  }
  for (const [title, cat] of [["Musée", "museum"], ["Restaurant", "restaurant"], ["Parc", "park"]]) {
    const place = ENTITES.CanonicalPlace({title, cat, source: "openstreetmap"});
    assert.equal(place.entity_type, "place", title);
    assert.equal(place.is_free, null, title);
    assert.equal(ENTITES.tarifLieu(place), "Tarif à vérifier", title);
    assert.equal(ENTITES.horaireLieu(place), "Horaires à vérifier", title);
  }
});

test("le média événementiel officiel est prioritaire sans règle liée au titre", async () => {
  const {ENTITES, IMAGES} = modules();
  const event = ENTITES.CanonicalEvent(AERONEF_ARRESTED_DEVELOPMENT);
  const media = await IMAGES.resoudre(event);
  assert.equal(media.image_source, "venue_official");
  assert.equal(media.image_type, "event_poster");
  assert.equal(media.image_scope, "evenement");
  assert.equal(media.image_fallback_reason, null);
  assert.match(media.image_url, /arrested-development\.jpg$/);

  const generic = ENTITES.CanonicalEvent({
    title: "Concert officiel générique",
    event_source: "venue_official",
    image_source: "venue_official",
    image_url: "https://salle.example.org/media/affiche-generique.jpg",
    image_type: "event_poster",
    isTemporary: true,
  });
  const genericMedia = await IMAGES.resoudre(generic);
  assert.equal(genericMedia.image_source, "venue_official");
  assert.equal(genericMedia.image_type, "event_poster");
  assert.equal(genericMedia.image_fallback_reason, null);
});

test("une image de lieu ne traverse pas la frontière vers un événement", async () => {
  const {ENTITES, IMAGES} = modules();
  const event = ENTITES.CanonicalEvent({
    title: "Événement sans affiche",
    isTemporary: true,
    image_scope: "lieu",
    image_source: "site_officiel",
    image_url: "https://salle.example.org/photos/facade.jpg",
  });
  assert.equal(await IMAGES.resoudre(event), null);
  assert.equal(await IMAGES.resoudre({
    entity_type: "event", isTemporary: true,
    image_source: "site_officiel",
    image_url: "https://salle.example.org/photos/facade.jpg",
  }), null, "une photo de salle non déclarée comme média événementiel reste exclue");
  const fallback = await IMAGES.resoudre({
    entity_type: "event",
    id: "event-with-explicit-venue-fallback",
    title: "Événement sans affiche",
    isTemporary: true,
    venue_image_url: "https://salle.example.org/photos/facade.jpg",
    venue_image_source: "site_officiel",
  });
  assert.equal(fallback.image_scope, "evenement");
  assert.equal(fallback.image_fallback_reason, "venue_fallback");
});

test("la résolution d'un lieu peut utiliser une photo officielle portée par OSM", async () => {
  const {ENTITES, IMAGES} = modules();
  const place = ENTITES.CanonicalPlace(INSTITUT_MONDE_ARABE_TOURCOING);
  const media = await IMAGES.resoudre({...place, tags: INSTITUT_MONDE_ARABE_TOURCOING.tags,
    url: INSTITUT_MONDE_ARABE_TOURCOING.website});
  assert.equal(media.image_source, "site_officiel");
  assert.equal(media.image_scope, "lieu");
  assert.match(media.image_url, /ima-tourcoing\.jpg$/);
});

test("le renderer choisit contain pour les affiches et cover pour les lieux", () => {
  const {ENTITES, IMAGES} = modules();
  assert.equal(ENTITES.mediaCanonique({
    entity_type: "event", image_type: "event_poster", image_scope: "event",
    image_width: 1600, image_height: 900,
  }).object_fit, "contain");
  assert.equal(IMAGES.modeImage({
    image_type: "place_photo", image_scope: "lieu",
    image_width: 1600, image_height: 900,
  }).object_fit, "cover");
  assert.equal(IMAGES.modeImage({
    image_type: "event_poster", image_scope: "evenement",
    image_width: 320, image_height: 480,
  }).can_upscale, false);
  assert.equal(IMAGES.modeImage({
    image_type: "organizer", image_scope: "event",
    image_width: 1600, image_height: 900,
  }).object_fit, "contain");
  assert.equal(IMAGES.modeImage({
    image_type: "institutional", image_scope: "lieu",
    image_width: 1600, image_height: 900,
  }).object_fit, "cover");
});

test("les renderers détaillés lisent le lieu canonique, sans repli gratuit ou undefined", () => {
  assert.match(appSource, /function donneesEvenement\(l\)/);
  assert.match(appSource, /function donneesLieu\(l\)/);
  assert.match(appSource, /function mediaDe\(l\)/);
  assert.match(appSource, /function gratuitDe\(l\)/);
  assert.match(ecransSource, /const lieu = evenement \? null : donneesLieu\(l\);/);
  assert.doesNotMatch(ecransSource, /l\.places==null\?'Entrée libre'/);
  assert.doesNotMatch(ecransSource, /esc\(l\.par\)/);
  assert.match(ecransSource, /ENTITES\.organisateurLieu\(lieu \|\| l\)/);
});
