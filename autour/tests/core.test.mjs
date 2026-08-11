import assert from "node:assert/strict";
import test from "node:test";

await import("../core.js");

const {
  FAMILY_CATEGORIES,
  classifyPlace,
  dedupeItems,
  isDiscoveryCandidate,
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

test("Explorer laisse les services ciblés hors des recommandations génériques", () => {
  assert.equal(isDiscoveryCandidate({cat:"hebergement",categories:["hebergement","shelter"]}), false);
  assert.equal(isDiscoveryCandidate({cat:"ecole",categories:["ecole","education"]}), false);
  assert.equal(isDiscoveryCandidate({cat:"commerce",categories:["commerce","buy"]}), false);
  assert.equal(isDiscoveryCandidate({cat:"marche",categories:["marche","market"]}), true);
  assert.equal(isDiscoveryCandidate({cat:"event",isTemporary:true,categories:["event"]}), true);
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
  const osm = toCommonItem({
    id:"osm1",cat:"cinema",title:"Cinéma Le Fresnoy",lat:50.72,lng:3.16,
    note:null,avis:null,horaires:null,image:"",
  }, {source:"openstreetmap"});
  const google = toCommonItem({
    id:"g1",cat:"cinema",title:"Cinema Le Fresnoy",lat:50.7201,lng:3.1601,
    note:4.7,avis:812,horaires:["lundi: 10:00–22:00"],image:"https://example.test/fresnoy.jpg",
  }, {source:"google_places"});
  const result = dedupeItems([osm,google],distance);
  assert.equal(result.length,1);
  assert.deepEqual(new Set(result[0].sources),new Set(["openstreetmap","google_places"]));
  assert.equal(result[0].note,4.7);
  assert.equal(result[0].avis,812);
  assert.deepEqual(result[0].horaires,["lundi: 10:00–22:00"]);
  assert.equal(result[0].image,"https://example.test/fresnoy.jpg");
});

test("un transport et un établissement homonymes restent deux lieux", () => {
  const station = toCommonItem({
    id:"metro1",cat:"metro",title:"Phalempins",lat:50.72,lng:3.16,
  }, {source:"openstreetmap"});
  const cafe = toCommonItem({
    id:"g2",cat:"cafe",title:"Phalempins",lat:50.7201,lng:3.1601,
    note:3.9,avis:813,image:"https://example.test/phalempins.jpg",
  }, {source:"google_places"});
  const result = dedupeItems([station,cafe],distance);
  assert.equal(result.length,2);
  assert.deepEqual(result.map(x=>x.cat),["metro","cafe"]);
});

test("la déduplication exige aussi une catégorie commune", () => {
  const cafe = toCommonItem({id:"cafe",cat:"cafe",title:"Le Central",lat:50.72,lng:3.16}, {source:"openstreetmap"});
  const hotel = toCommonItem({id:"hotel",cat:"hebergement",title:"Le Central",lat:50.7201,lng:3.1601}, {source:"datatourisme"});
  assert.equal(dedupeItems([cafe,hotel],distance).length, 2);
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

test("les événements suivent des horizons temporels explicites avant la proximité", () => {
  const now = Date.UTC(2026, 7, 17, 10, 0); // 17 août, 12:00 à Paris
  const base = {cat:"concert",categories:["concert","outing"],isTemporary:true,
    latitude:50.72,longitude:3.16,lat:50.72,lng:3.16};
  const ranked = rankResults([
    {...base,id:"futur",title:"Septembre",startsAt:Date.UTC(2026,8,27,12),endsAt:Date.UTC(2026,8,27,15)},
    {...base,id:"semaine",title:"Cette semaine",startsAt:Date.UTC(2026,7,21,12),endsAt:Date.UTC(2026,7,21,15)},
    {...base,id:"demain",title:"Demain",startsAt:Date.UTC(2026,7,18,12),endsAt:Date.UTC(2026,7,18,15)},
    {...base,id:"aujourdhui",title:"Cet après-midi",startsAt:Date.UTC(2026,7,17,16),endsAt:Date.UTC(2026,7,17,18)},
    {...base,id:"imminent",title:"Dans une heure",startsAt:now+3600000,endsAt:now+3*3600000},
    {...base,id:"encours",title:"En cours",startsAt:now-3600000,endsAt:now+3600000},
  ], {intent:"sortir",position:[50.72,3.16],now,distanceBetween:distance,
      etaFor:(item)=>({minutes:item.id === "futur" ? 1 : 40,mode:"walk"})});
  assert.deepEqual(ranked.map((item)=>item.id),
    ["encours","imminent","aujourdhui","demain","semaine","futur"]);
});

test("une publication Autour pertinente précède une source catalogue équivalente", () => {
  const base = {cat:"resto",categories:["resto","restaurant","eat"],latitude:50.72,longitude:3.16,lat:50.72,lng:3.16,ouvert:true};
  const ranked = rankResults([
    {...base,id:"osm",title:"Bistrot local",source:"openstreetmap"},
    {...base,id:"autour",title:"Cantine du quartier",source:"autour",dbId:"publication-1"},
  ], {intent:"manger",position:[50.72,3.16],nowOnly:true,distanceBetween:distance});
  assert.deepEqual(ranked.map((item)=>item.id), ["autour","osm"]);
});

test("Explorer privilégie culture et marché sur un simple lieu proche", () => {
  const base = {ouvert:true,latitude:50.72,longitude:3.16,lat:50.72,lng:3.16};
  const ranked = rankResults([
    {...base,id:"resto-proche",title:"Restaurant voisin",cat:"resto",categories:["resto","restaurant","eat"],lat:50.72001,latitude:50.72001},
    {...base,id:"musee",title:"Musée",cat:"musee",categories:["musee","museum","culture","outing"],lat:50.7201,latitude:50.7201},
    {...base,id:"marche",title:"Marché",cat:"marche",categories:["marche","market","eat","outing"],lat:50.7202,latitude:50.7202},
  ], {intent:"explorer",categories:["resto","musee","culture","marche"],position:[50.72,3.16],distanceBetween:distance});
  assert.deepEqual(ranked.map(x=>x.id), ["musee","marche","resto-proche"]);
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

/* ---- Classification multi-catégories pondérée --------------------------- */

const {
  classifyPlaceWeighted, categoryWeight, bestCategoryWeight, arrivalOutlook, INTENT_PROFILES,
} = globalThis.AutourCore;

test("un lieu appartient à plusieurs catégories, avec des poids distincts", () => {
  const poids = classifyPlaceWeighted({cat:"cinema", title:"Le Fresnoy", tags:{amenity:"cinema"}});
  // le cinéma EST un cinéma, et il est aussi une sortie, de la culture et
  // une destination famille — mais pas au même degré
  assert.equal(poids.cinema, 1);
  for(const categorie of ["outing","culture","family"]) assert.ok(poids[categorie] > 0, categorie);
  assert.ok(poids.outing > poids.family, "la sortie prime sur la famille");
  assert.ok(poids.cinema > poids.culture);
});

test("les exemples produit se retrouvent tels quels dans la classification", () => {
  const parc = classifyPlaceWeighted({cat:"parc", tags:{leisure:"park"}});
  for(const categorie of ["family","outing","sport"]) assert.ok(parc[categorie] > 0, "parc/"+categorie);

  const mediatheque = classifyPlaceWeighted({cat:"biblio", title:"Médiathèque centrale"});
  for(const categorie of ["study","culture","family","services"])
    assert.ok(mediatheque[categorie] > 0, "médiathèque/"+categorie);
});

test("la liste de catégories reste ordonnée du plus pertinent au moins", () => {
  const categories = classifyPlace({cat:"cinema", tags:{amenity:"cinema"}});
  assert.equal(categories[0], "cinema");
  assert.ok(categories.indexOf("outing") < categories.indexOf("family"));
});

test("un tag OSM ne fixe pas à lui seul la catégorie affichée", () => {
  // OSM ne connaît que amenity=library ; l'UX doit en tirer quatre usages
  const poids = classifyPlaceWeighted({tags:{amenity:"library"}, title:"Bibliothèque"});
  assert.ok(Object.keys(poids).length >= 4);
  assert.equal(poids.library, 1);
});

test("un même lieu remonte dans plusieurs besoins", () => {
  const cinema = toCommonItem({id:"1", cat:"cinema", titre:"Cinéma", lat:50.63, lng:3.06, tags:{amenity:"cinema"}}, {source:"osm"});
  assert.ok(bestCategoryWeight(cinema, INTENT_PROFILES.sortir.categories) > 0, "Sortir");
  assert.ok(bestCategoryWeight(cinema, INTENT_PROFILES.famille.categories) > 0, "Famille");
  assert.ok(bestCategoryWeight(cinema, INTENT_PROFILES.culture.categories) > 0, "Culture");
  assert.equal(bestCategoryWeight(cinema, INTENT_PROFILES.manger.categories), 0, "pas Manger");
});

test("categoryWeight retombe sur les catégories déclarées hors toCommonItem", () => {
  assert.equal(categoryWeight({cat:"resto"}, "resto"), 1);
  assert.ok(categoryWeight({categories:["eat"]}, "eat") > 0);
  assert.equal(categoryWeight({categories:["eat"]}, "sport"), 0);
});

/* ---- ETA réel et faisabilité ------------------------------------------- */

const LIEU = (extra) => Object.assign({
  id:"x", titre:"Lieu", cat:"resto", lat:50.640, lng:3.070, ouvert:true,
}, extra);

test("le classement utilise l'ETA fourni plutôt que la distance à vol d'oiseau", () => {
  const proche = LIEU({id:"proche", lat:50.6305, lng:3.0605});
  const loin   = LIEU({id:"loin",   lat:50.6500, lng:3.0900});
  const classement = rankResults([proche, loin], {
    intent:"manger", position:[50.63,3.06], now:Date.now(), distanceBetween:distance,
    // le lieu le plus proche est de l'autre côté d'une coupure urbaine
    etaFor:l=>l.id === "proche" ? {minutes:35, mode:"transit"} : {minutes:9, mode:"transit"},
  });
  assert.equal(classement[0].id, "loin");
  assert.equal(classement[0].rankBreakdown.etaMinutes, 9);
});

test("un lieu fermé à l'arrivée est écarté en mode maintenant", () => {
  const now = Date.now();
  const ferme = LIEU({id:"ferme", closesAt: now + 10*60000});
  const ouvert = LIEU({id:"ouvert", lat:50.641, closesAt: now + 4*3600000});
  const contexte = {
    intent:"manger", position:[50.63,3.06], now, distanceBetween:distance,
    etaFor:()=>({minutes:25, mode:"transit"}),
  };
  const strict = rankResults([ferme, ouvert], Object.assign({nowOnly:true}, contexte));
  assert.deepEqual(strict.map(l=>l.id), ["ouvert"]);

  // hors mode maintenant il reste visible, mais relégué et annoncé comme tel
  const large = rankResults([ferme, ouvert], contexte);
  assert.equal(large[large.length-1].id, "ferme");
  assert.match(large[large.length-1].rankReason, /Fermé à votre arrivée/);
});

test("un événement qu'on ne peut plus attraper est fortement déclassé", () => {
  const now = Date.now();
  const contexte = {
    intent:"sortir", position:[50.63,3.06], now, distanceBetween:distance,
    etaFor:()=>({minutes:40, mode:"transit"}),
  };
  const rate = {id:"rate", titre:"Concert", cat:"concert", lat:50.640, lng:3.070,
    isTemporary:true, startsAt: now + 5*60000, endsAt: now + 3*3600000};
  const atteignable = {id:"ok", titre:"Autre concert", cat:"concert", lat:50.641, lng:3.071,
    isTemporary:true, startsAt: now + 90*60000, endsAt: now + 4*3600000};

  const classement = rankResults([rate, atteignable], contexte);
  assert.equal(classement[0].id, "ok");
  assert.match(classement[0].rankReason, /avant le début/);
  assert.match(classement.find(l=>l.id==="rate").rankReason, /Déjà commencé/);
});

test("arriver dans la fenêtre acceptable reste proposé", () => {
  const now = Date.now();
  const debut = now + 10*60000;
  const vu = arrivalOutlook({}, now + 18*60000, true, debut, now + 3*3600000, now);
  assert.equal(vu.state, "late");
  assert.ok(vu.score > 0, "une arrivée à 8 min du début reste utile");
});

test("un événement déjà en cours n'est pas traité comme une arrivée en retard", () => {
  const now = Date.now();
  const vu = arrivalOutlook({}, now + 20*60000, true, now - 2*3600000, now + 2*3600000, now);
  assert.equal(vu.state, "open");
  assert.equal(vu.score, 0);
});

test("l'ETA temps réel est annoncé comme tel dans la raison affichée", () => {
  const classement = rankResults([LIEU({})], {
    intent:"manger", position:[50.63,3.06], now:Date.now(), distanceBetween:distance,
    etaFor:()=>({minutes:12, mode:"transit", realtime:true, transfers:1}),
  });
  assert.match(classement[0].rankReason, /12 min/);
  assert.match(classement[0].rankReason, /temps réel/);
  assert.match(classement[0].rankReason, /corresp/);
});

test("sans couche transport, le classement retombe sur un temps de marche", () => {
  const classement = rankResults([LIEU({})], {
    intent:"manger", position:[50.63,3.06], now:Date.now(), distanceBetween:distance,
  });
  assert.equal(classement[0].rankEta.mode, "walk");
  assert.equal(classement[0].rankEta.confidence, "estimated");
  assert.match(classement[0].rankReason, /à pied/);
});
