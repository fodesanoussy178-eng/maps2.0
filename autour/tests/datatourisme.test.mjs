import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import datatourisme, { normaliserDatatourisme } from "../api/datatourisme.js";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const api = await readFile(new URL("../api/datatourisme.js", import.meta.url), "utf8");

test("DATAtourisme est normalisé côté Function, sans clé dans le contrat client", () => {
  const lieu = normaliserDatatourisme({
    uuid:"musee-1", label:{fr:"Musée du quartier"}, type:["PlaceOfInterest", "Museum"],
    hasDescription:{fr:"Une collection locale."},
    isLocatedAt:{
      geo:{latitude:50.631, longitude:3.059},
      address:{streetAddress:"12 rue des Arts", postalCode:"59000", addressLocality:"Lille"},
      openingHoursSpecification:[{dayOfWeek:["Monday", "Tuesday"], opens:"09:00", closes:"18:00"}],
    },
    hasMainRepresentation:{contentUrl:"https://cdn.example.test/musee.jpg"},
  });
  assert.deepEqual(lieu && {id:lieu.id, source:lieu.source, cat:lieu.cat, lat:lieu.lat, lng:lieu.lng}, {
    id:"datatourisme:musee-1", source:"datatourisme", cat:"musee", lat:50.631, lng:3.059,
  });
  assert.equal(lieu.officialOpeningHours, "mo,tu 09:00-18:00");
  assert.equal(lieu.image, "https://cdn.example.test/musee.jpg");
  assert.equal(lieu.isTemporary, false);
  assert.match(lieu.adresse, /rue des Arts/);
  assert.ok(!Object.hasOwn(lieu, "api_key"));
});

test("les coordonnées des réponses catalogue placées en liste sont conservées", () => {
  const lieu = normaliserDatatourisme({
    uuid:"catalogue-geo-1", label:"Lieu du catalogue", type:"PlaceOfInterest",
    isLocatedAt:[{geo:{latitude:50.6292, longitude:3.0573}}],
  });
  assert.deepEqual(lieu && [lieu.lat, lieu.lng], [50.6292, 3.0573]);

  const sansCoordonnee = normaliserDatatourisme({
    uuid:"catalogue-sans-geo", label:"Sans coordonnées", type:"PlaceOfInterest",
    isLocatedAt:[{}],
  });
  assert.equal(sansCoordonnee, null);
});

test("les représentations imbriquées et les types scolaires sont normalisés sans deviner", () => {
  const ecole = normaliserDatatourisme({
    uuid:"ecole-1", label:"Lycée public", type:"SchoolOrEducationalOrganization",
    isLocatedAt:[{geo:{latitude:50.63, longitude:3.06}}],
    hasMainRepresentation:[{resourceLocator:{contentUrl:"https://cdn.example.test/lycee.jpg"}}],
  });
  assert.equal(ecole.cat, "ecole");
  assert.equal(ecole.image, "https://cdn.example.test/lycee.jpg");
});

test("un événement DATAtourisme porte ses dates et les événements terminés disparaissent", () => {
  const futur = normaliserDatatourisme({
    uuid:"concert-1", label:"Concert du soir", type:"EntertainmentAndEvent",
    isLocatedAt:{geo:{latitude:50.63, longitude:3.06}},
    takesPlaceAt:{startDate:"2030-08-18T18:00:00+02:00", endDate:"2030-08-18T22:00:00+02:00"},
  });
  assert.equal(futur.cat, "concert");
  assert.equal(futur.isTemporary, true);
  assert.ok(futur.debutLe < futur.finLe);

  const termine = normaliserDatatourisme({
    uuid:"concert-passe", label:"Concert terminé", type:"EntertainmentAndEvent",
    isLocatedAt:{geo:{latitude:50.63, longitude:3.06}},
    takesPlaceAt:{startDate:"2020-01-01T18:00:00+01:00", endDate:"2020-01-01T22:00:00+01:00"},
  });
  assert.equal(termine, null);
});

test("la route DATAtourisme borne la requête, garde la clé serveur et met la zone en cache", () => {
  assert.match(api, /process\.env\.DATATOURISME_API_KEY/);
  assert.match(api, /"x-api-key":cleApi/);
  assert.match(api, /geo_distance:rLat \+ "," \+ rLng \+ "," \+ RAYON/);
  assert.match(api, /page_size:String\(LIMITE\)/);
  assert.match(api, /s-maxage=600, stale-while-revalidate=86400/);
  assert.match(api, /const CACHE_MS = 10 \* 60 \* 1000/);
  assert.doesNotMatch(api, /api_key=/);
  assert.doesNotMatch(index, /DATATOURISME_API_KEY/);
  assert.match(index, /\/api\/datatourisme\?lat=/);
});

test("la Function envoie la clé uniquement en en-tête et renvoie une projection sûre", async () => {
  const avantFetch = globalThis.fetch;
  const avantCle = process.env.DATATOURISME_API_KEY;
  let demande = null;
  process.env.DATATOURISME_API_KEY = "test-secret-not-exposed";
  globalThis.fetch = async (url, options) => {
    demande = {url:String(url), options};
    return new Response(JSON.stringify({objects:[{
      uuid:"proxy-1", label:"Parc public", type:"PlaceOfInterest",
      isLocatedAt:{geo:{latitude:45.679,longitude:1.234}},
    }]}), {status:200, headers:{"content-type":"application/json"}});
  };
  try {
    const response = await datatourisme(new Request("https://autour.test/api/datatourisme?lat=45.679&lng=1.234"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].source, "datatourisme");
    assert.match(demande.url, /geo_distance=45\.68%2C1\.23%2C3km/);
    assert.match(demande.url, /page_size=50/);
    assert.doesNotMatch(demande.url, /test-secret-not-exposed|api_key=/);
    assert.equal(demande.options.headers["x-api-key"], "test-secret-not-exposed");
  } finally {
    globalThis.fetch = avantFetch;
    if (avantCle == null) delete process.env.DATATOURISME_API_KEY;
    else process.env.DATATOURISME_API_KEY = avantCle;
  }
});

test("DATAtourisme complète OSM sans bloquer ni modifier l'interface", () => {
  assert.match(index, /let permanentPlaces=\[\], datatourismePlaces=\[\], externalEvents=\[\], userPublications=\[\];/);
  assert.match(index, /\.\.\.datatourismePlaces/);
  assert.match(index, /fusionner\(r,"datatourisme"\)/);
  assert.match(index, /if\(!o\.cats\) travaux\.push\(/);
  assert.match(index, /if\(r\.status === 404 \|\| r\.status === 405\)\{ relaisDatatourisme = false; return \[\]; \}/);
  assert.match(index, /let reco = recommandationsAccueil\(7\)/);
  assert.match(index, /const ACCUEIL_MAX = 7/);
  assert.match(index, /const pourToi = recommandationsAccueil\(ACCUEIL_MAX\)/);
  assert.match(index, /choisis\.push\(\.\.\.pourToi\.slice\(0,ACCUEIL_MAX\)\)/);
});
