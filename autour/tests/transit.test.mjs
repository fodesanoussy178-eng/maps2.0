import assert from "node:assert/strict";
import test from "node:test";

await import("../transit.js");

const T = globalThis.AutourTransit;

/* Un jeu de sections Navitia réaliste : marche, attente, bus temps réel,
   correspondance, métro théorique, marche finale. */
function trajetNavitia(){
  return {
    nb_transfers: 1,
    status: "",
    sections: [
      {type:"street_network", duration:300},
      {type:"waiting",        duration:240},
      {type:"public_transport", duration:600, data_freshness:"realtime",
       display_informations:{code:"C1", direction:"Lille", network:"Réseau test"}},
      {type:"transfer",       duration:120},
      {type:"public_transport", duration:420, data_freshness:"base_schedule",
       display_informations:{code:"M2"}},
      {type:"street_network", duration:180},
    ],
  };
}

test("l'ETA additionne marche, attente, trajet et correspondances", () => {
  const eta = T.navitiaJourneyToEta(trajetNavitia(), "navitia");
  assert.equal(eta.walkMinutes, 8);      // 5 + 3
  assert.equal(eta.waitMinutes, 4);
  assert.equal(eta.rideMinutes, 17);     // 10 + 7
  assert.equal(eta.transferMinutes, 2);
  assert.equal(eta.minutes, 31);         // et surtout : pas 17
  assert.equal(eta.transfers, 1);
  assert.deepEqual(eta.lines, ["C1", "M2"]);
});

test("un seul segment temps réel suffit à marquer l'ETA comme constaté", () => {
  const eta = T.navitiaJourneyToEta(trajetNavitia(), "navitia");
  assert.equal(eta.realtime, true);
  assert.equal(eta.confidence, "observed");
});

test("sans temps réel, l'ETA reste un horaire théorique déclaré comme tel", () => {
  const trajet = trajetNavitia();
  trajet.sections.forEach(s=>{ if(s.data_freshness) s.data_freshness = "base_schedule"; });
  const eta = T.navitiaJourneyToEta(trajet, "navitia");
  assert.equal(eta.realtime, false);
  assert.equal(eta.confidence, "planned");
});

test("une perturbation remonte jusqu'à l'ETA", () => {
  const trajet = trajetNavitia();
  trajet.status = "SIGNIFICANT_DELAYS";
  assert.equal(T.navitiaJourneyToEta(trajet, "navitia").disruption, "SIGNIFICANT_DELAYS");
});

test("sans provider transport, la marche sert de repli et s'annonce comme estimée", async () => {
  const eta = await T.planTrip({from:[50.63,3.06], to:[50.64,3.07], cache:null});
  assert.equal(eta.mode, "walk");
  assert.equal(eta.confidence, "estimated");
  assert.ok(eta.minutes > 0);
  assert.equal(eta.waitMinutes, 0);
});

test("le territoire choisit le provider : le plus spécifique passe devant", () => {
  const lille = T.registerProvider({
    id:"test-lille", label:"Réseau local", realtime:true, priority:50,
    covers:([lat,lng])=>lat>50.5 && lat<50.8 && lng>2.9 && lng<3.2,
    plan:async()=>null,
  });
  const national = T.registerProvider({
    id:"test-national", label:"National", priority:10,
    covers:()=>true, plan:async()=>null,
  });

  assert.equal(T.resolveProvider([50.63,3.06]).id, "test-lille");
  // hors du territoire local, on retombe sur le national sans rien changer
  assert.equal(T.resolveProvider([43.6,1.44]).id, "test-national");

  T.unregisterProvider(lille.id);
  T.unregisterProvider(national.id);
});

test("un provider en panne dégrade vers la marche au lieu de casser la recherche", async () => {
  const casse = T.registerProvider({
    id:"test-casse", priority:99, covers:()=>true,
    plan:async()=>{ throw new Error("réseau injoignable"); },
  });
  const eta = await T.planTrip({from:[50.63,3.06], to:[50.64,3.07], cache:null});
  assert.equal(eta.mode, "walk");
  T.unregisterProvider(casse.id);
});

test("un trajet en transport plus lent que la marche n'est pas proposé", async () => {
  const lent = T.registerProvider({
    id:"test-lent", priority:99, covers:()=>true,
    plan:async()=>T.composeEta([
      {mode:"walk", minutes:5},{mode:"wait", minutes:25},{mode:"ride", minutes:30},
    ], {provider:"test-lent"}),
  });
  // ~1,2 km : 15 min à pied contre 60 min en transport
  const eta = await T.planTrip({from:[50.63,3.06], to:[50.64,3.07], cache:null});
  assert.equal(eta.mode, "walk");
  T.unregisterProvider(lent.id);
});

test("sans clé, aucun provider transport ne s'enregistre", () => {
  assert.equal(T.createNavitiaProvider(null), null);
  assert.equal(T.createNavitiaProvider({token:""}), null);
  const avecCle = T.createNavitiaProvider({token:"abc", fetch:async()=>({ok:true, json:async()=>({})})});
  assert.equal(avecCle.realtime, true);
  assert.equal(avecCle.covers([50.63,3.06]), true);   // France
  assert.equal(avecCle.covers([48.85,-70]), false);   // hors territoire
});

test("le provider national interroge le flux temps réel au départ demandé", async () => {
  let vue = null;
  const provider = T.createNavitiaProvider({
    token:"cle-test",
    fetch:async(url)=>{ vue = url; return {ok:true, json:async()=>({journeys:[trajetNavitia()]})}; },
  });
  const eta = await provider.plan({from:[50.63,3.06], to:[50.64,3.07], departAt:Date.now()});
  assert.match(vue, /data_freshness=realtime/);
  assert.match(vue, /from=3.06%3B50.63/);
  assert.equal(eta.minutes, 31);
});

test("le cache évite de redemander le même trajet dans la minute", async () => {
  let appels = 0;
  const provider = T.registerProvider({
    id:"test-cache", priority:99, covers:()=>true,
    plan:async()=>{ appels += 1; return T.composeEta([{mode:"ride", minutes:9}]); },
  });
  const cache = T.createCache(120000);
  const trajet = {from:[50.63,3.06], to:[50.90,3.40], cache};
  await T.planTrip(trajet);
  await T.planTrip(trajet);
  assert.equal(appels, 1);
  T.unregisterProvider(provider.id);
});
