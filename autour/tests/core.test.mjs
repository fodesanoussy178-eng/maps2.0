import assert from "node:assert/strict";
import test from "node:test";

await import("../core.js");

const {
  FAMILY_CATEGORIES,
  classifyPlace,
  dedupeItems,
  isAvailableNow,
  matchesCategory,
  normalizeText,
  rankResults,
  toCommonItem,
} = globalThis.AutourCore;

const distance = (aLat, aLng, bLat, bLng) => {
  const dy = (bLat-aLat) * 111_000;
  const dx = (bLng-aLng) * 73_000;
  return Math.hypot(dx,dy);
};

test("normalise les accents et la casse", () => {
  assert.equal(normalizeText("Séance CINÉMA — Pathé"), "seance cinema pathe");
});

test("le mapping famille éditorial est explicite et stable", () => {
  assert.deepEqual(FAMILY_CATEGORIES, [
    "cinema", "playground", "park", "museum", "library", "swimming_pool",
    "bowling_alley", "zoo", "educational_farm", "kids_event",
    "family_event", "workshop", "youth_activity",
  ]);
});

test("un cinéma OSM appartient à cinéma, culture, sortie et famille", () => {
  const categories = classifyPlace({
    cat:"cinema", title:"Le Fresnoy", tags:{amenity:"cinema"},
  });
  for(const category of ["cinema","culture","outing","family"])
    assert.ok(categories.includes(category), category);
});

test("un théâtre n'est pas un cinéma sans preuve explicite", () => {
  const theatre = classifyPlace({cat:"spectacle", title:"Théâtre municipal", tags:{amenity:"theatre"}});
  assert.ok(!theatre.includes("cinema"));
  const projection = classifyPlace({cat:"spectacle", title:"Projection de film", tags:{amenity:"theatre"}});
  assert.ok(projection.includes("cinema"));
});

test("les écoles ordinaires sont exclues de famille", () => {
  const categories = classifyPlace({cat:"ecole", title:"École des enfants", tags:{amenity:"school"}});
  assert.ok(!categories.includes("family"));
  assert.ok(FAMILY_CATEGORIES.every(category=>!categories.includes(category)));
  assert.ok(!classifyPlace({title:"Établissement",tags:{school:"primary_school"}}).includes("family"));
});

test("les valeurs OSM avec underscore conservent le mapping éditorial", () => {
  assert.ok(classifyPlace({tags:{leisure:"swimming_pool"}}).includes("swimming_pool"));
  assert.ok(classifyPlace({tags:{leisure:"bowling_alley"}}).includes("bowling_alley"));
  assert.ok(classifyPlace({tags:{amenity:"community_centre"}}).includes("family"));
});

test("un marché, un terrain ou un atelier commercial ne deviennent pas famille", () => {
  assert.ok(!classifyPlace({cat:"commerce",title:"Jana Market"}).includes("family"));
  assert.ok(!classifyPlace({cat:"terrain",title:"Terrain municipal"}).includes("family"));
  assert.ok(!classifyPlace({cat:"commerce",title:"L'Atelier Créacœur"}).includes("family"));
});

test("un arrêt nommé d'après un parc, un musée ou un cinéma reste un transport", () => {
  for(const title of ["Parc des Francs", "Musée du Centre", "UGC Les Écrans"]){
    const categories = classifyPlace({cat:"bus",title,type:"bus_stop",tags:{highway:"bus_stop"}});
    assert.ok(!categories.includes("family"), title);
    assert.ok(!categories.includes("cinema"), title);
  }
});

test("un centre social et un sport explicitement accessible rejoignent famille", () => {
  assert.ok(classifyPlace({cat:"asso",title:"Centre social",tags:{amenity:"social_centre"}}).includes("family"));
  assert.ok(classifyPlace({cat:"terrain",title:"Basket accessible",tags:{wheelchair:"yes"}}).includes("family"));
});

test("un événement jeunesse temporaire rejoint famille et événements", () => {
  const item = toCommonItem({
    id:"1", cat:"event", title:"Atelier jeune public", lat:50.72, lng:3.16,
    isTemporary:true,
  }, {source:"openagenda"});
  assert.ok(matchesCategory(item,"event"));
  assert.ok(matchesCategory(item,"family"));
  assert.ok(matchesCategory(item,"workshop"));
  assert.ok(matchesCategory(item,"kids_event"));
});

test("la déduplication fusionne les sources et les catégories", () => {
  const osm = toCommonItem({id:"osm1",cat:"cinema",title:"Cinéma Le Fresnoy",lat:50.72,lng:3.16}, {source:"openstreetmap"});
  const google = toCommonItem({id:"g1",cat:"cinema",title:"Cinema Le Fresnoy",lat:50.7201,lng:3.1601,note:4.7}, {source:"google_places"});
  const result = dedupeItems([osm,google],distance);
  assert.equal(result.length,1);
  assert.deepEqual(new Set(result[0].sources),new Set(["openstreetmap","google_places"]));
  assert.equal(result[0].note,4.7);
});

test("maintenant garde l'inconnu et le bientôt, retire le terminé", () => {
  const now = Date.now();
  assert.equal(isAvailableNow({isTemporary:false,ouvert:undefined},now),true);
  assert.equal(isAvailableNow({isTemporary:true,startsAt:now+2*3600e3,endsAt:now+4*3600e3},now),true);
  assert.equal(isAvailableNow({isTemporary:true,startsAt:now-4*3600e3,endsAt:now-1},now),false);
});

test("le classement retire les événements terminés et les doublons", () => {
  const now = Date.now();
  const base = {cat:"event",categories:["event","outing"],lat:50.72,lng:3.16,latitude:50.72,longitude:3.16,isTemporary:true};
  const ranked = rankResults([
    {...base,id:"1",title:"Concert du quartier",titre:"Concert du quartier",startsAt:now-1000,endsAt:now+3600e3},
    {...base,id:"2",title:"Concert du quartier",titre:"Concert du quartier",lat:50.7201,lng:3.1601,latitude:50.7201,longitude:3.1601,startsAt:now-1000,endsAt:now+3600e3},
    {...base,id:"3",title:"Concert terminé",titre:"Concert terminé",startsAt:now-7200e3,endsAt:now-1000},
  ], {intent:"sortir",position:[50.72,3.16],now,distanceBetween:distance});
  assert.equal(ranked.length,1);
  assert.match(ranked[0].rankReason,/En cours/);
});

test("le classement Maintenant privilégie l'ouvert et conserve les horaires inconnus", () => {
  const commun = {cat:"resto",categories:["restaurant","eat"],latitude:50.72,longitude:3.16,lat:50.72,lng:3.16};
  const ranked = rankResults([
    {...commun,id:"open",title:"Ouvert",titre:"Ouvert",ouvert:true},
    {...commun,id:"unknown",title:"Inconnu",titre:"Inconnu",latitude:50.7202,lat:50.7202},
    {...commun,id:"closed",title:"Fermé",titre:"Fermé",ouvert:false},
  ], {intent:"manger",position:[50.72,3.16],nowOnly:true,distanceBetween:distance});
  assert.deepEqual(ranked.map(x=>x.id),["open","unknown"]);
  assert.match(ranked[1].rankReason,/Horaires inconnus/);
});

test("chaque intention applique son propre périmètre éditorial", () => {
  const items = [
    toCommonItem({id:"cinema",cat:"cinema",title:"Cinéma",lat:50.72,lng:3.16,ouvert:true},{source:"osm"}),
    toCommonItem({id:"food",cat:"resto",title:"Restaurant",lat:50.7201,lng:3.16,ouvert:true},{source:"osm"}),
    toCommonItem({id:"help",cat:"alimentaire",title:"Aide alimentaire",lat:50.7202,lng:3.16,ouvert:true},{source:"osm"}),
  ];
  const context = {position:[50.72,3.16],distanceBetween:distance};
  assert.deepEqual(rankResults(items,{...context,intent:"famille"}).map(x=>x.id),["cinema"]);
  assert.deepEqual(rankResults(items,{...context,intent:"manger"}).map(x=>x.id),["food"]);
  assert.deepEqual(rankResults(items,{...context,intent:"aide"}).map(x=>x.id),["help"]);
});
