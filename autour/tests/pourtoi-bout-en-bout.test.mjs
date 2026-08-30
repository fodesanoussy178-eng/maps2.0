/* LE CONTRAT ENTRE LA BASE ET LE CLASSEMENT.

   `classerPourToi` n'apparie pas des titres : il lit les `announcement_tags`,
   borne par le bassin et pondère par l'importance. Si `versEvenementCanonique`
   n'en recopie aucun, chaque fiche arrive nue, `correspondances()` ne trouve
   rien et `classer()` rejette TOUT — « Pour toi » est vide sans qu'aucune
   erreur ne s'affiche. Ce test suit une ligne de RPC jusqu'au résultat. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../core.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = lire("../app.js");

/* Le chemin du navigateur charge les deux contrats avant l'application. Le
   test les installe aussi afin que la trace ci-dessous ne s'arrête pas au
   simple `toCommonItem`. */
new Function("globalThis", lire("../evenements-canoniques.js"))(globalThis);
new Function("globalThis", lire("../entites-canoniques.js"))(globalThis);

/* Les deux modules sont des IIFE : la taxonomie d'abord, le classement la lit
   à son chargement. */
new Function("globalThis", lire("../annonces-taxonomie.js"))(globalThis);
new Function("globalThis", lire("../annonces-classement.js"))(globalThis);
const ANNONCES = globalThis.AutourAnnoncesClassement;
const TAXONOMIE = globalThis.AutourAnnoncesTaxonomie;

/* `versEvenementCanonique` ne dépend que de trois choses hors d'elle-même. */
function extraireVersEvenement() {
  const i = app.search(/^function versEvenementCanonique\(/m);
  assert.ok(i >= 0, "versEvenementCanonique est introuvable");
  let k = app.indexOf("{", i), prof = 0, fin = -1;
  for (let n = k; n < app.length; n += 1) {
    if (app[n] === "{") prof += 1;
    else if (app[n] === "}") { prof -= 1; if (prof === 0) { fin = n + 1; break; } }
  }
  return new Function("normaliserItem", "visuelEvenement", "commune",
    app.slice(i, fin) + "; return versEvenementCanonique;")(
      (item, source) => {
        const commun = globalThis.AutourCore.toCommonItem(item, { source });
        return Object.assign(commun, {
          entity_type: "event",
          eventCanonical: globalThis.AutourEntites.CanonicalEvent(commun),
        });
      },
      () => null,
      "Tourcoing");
}
const versEvenementCanonique = extraireVersEvenement();

/* Une ligne telle que `evenements_bassin('mel')` la rend réellement. */
const DEMAIN = new Date(Date.now() + 36 * 3600 * 1000);
const ligneRpc = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Concert rap au Grand Mix",
  description: "Une soirée rap.",
  category: "concert",
  place_name: "Le Grand Mix", address: "5 place Notre Dame",
  city: "Tourcoing", insee_code: "59599",
  lat: 50.7236, lng: 3.161,
  start_at: DEMAIN.toISOString(),
  end_at: new Date(DEMAIN.getTime() + 3 * 3600 * 1000).toISOString(),
  timezone: "Europe/Paris",
  date_confidence: "exact", temporal_status: "soon",
  announcement_tags: ["rap", "hip_hop", "concert"],
  metro_area: "mel", territory_slug: "tourcoing",
  importance_level: "important", importance_score: 60,
  announced_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  primary_source: "openagenda", cancelled: false,
};

test("les métadonnées de recommandation survivent à la canonisation", () => {
  const item = versEvenementCanonique(ligneRpc);
  assert.deepEqual(item.announcement_tags, ["rap", "hip_hop", "concert"]);
  assert.equal(item.metro_area, "mel");
  assert.equal(item.importance_level, "important");
  assert.ok(item.announced_at, "announced_at doit être transmis");
  assert.equal(item.date_confidence, "exact");
  assert.equal(item.temporal_status, "soon");
  assert.equal(item.primary_source, "openagenda");
  /* Le classement lit indifféremment les deux graphies : les deux doivent
     être posées, sans quoi un module qui ne connaît qu'une forme voit du vide. */
  assert.deepEqual(TAXONOMIE.tagsDe(item).includes("rap"), true);
});

test("une ligne RPC taguée rap ressort pour une surveillance Rap", () => {
  const item = versEvenementCanonique(ligneRpc);
  const classes = ANNONCES.classerPourToi([item], {
    now: Date.now(),
    interests: ["rap"],
    seenIds: [], hiddenIds: [],
    limit: 6,
    distanceFor: () => 2000,
    metroArea: "mel",
    territorySlug: "tourcoing",
  });
  assert.equal(classes.length, 1, "l'événement doit être proposé, pas rejeté");
  assert.ok(classes[0].matched_interests.includes("rap"));
  assert.equal(classes[0].event.id, "evt" + ligneRpc.id);
  assert.ok(classes[0].score > 0);
});

test("la copie locale sans tags est fusionnée avec la copie MEL enrichie", () => {
  const {local, enrichie} = lignesDoublons();
  const fusion = bassinPourToiAvec([local], [enrichie]);
  assert.equal(fusion.length, 1);
  assert.deepEqual(fusion[0].announcement_tags, ["rap", "concert", "exposition"]);
  assert.deepEqual(fusion[0].eventCanonical.announcement_tags, ["rap", "concert", "exposition"]);
  assert.deepEqual(fusion[0].eventCanonical.artist_names, ["Ninho"]);
  assert.equal(fusion[0].eventCanonical.image_source, "openagenda");
  assert.match(fusion[0].eventCanonical.image_url, /affiche-rap\.jpg$/);
  assert.equal(fusion[0].eventCanonical.reservation_required, false);
});

test("la fusion reste identique quand la version MEL arrive avant la locale", () => {
  const {local, enrichie} = lignesDoublons();
  const fusion = bassinPourToiAvec([enrichie], [local]);
  assert.equal(fusion.length, 1);
  assert.deepEqual(fusion[0].eventCanonical.announcement_tags, ["rap", "concert", "exposition"]);
  assert.deepEqual(fusion[0].eventCanonical.artist_names, ["Ninho"]);
  assert.match(fusion[0].eventCanonical.image_url, /affiche-rap\.jpg$/);
});

test("deux sources apportent chacune des faits sans s'effacer", () => {
  const {local, enrichie} = lignesDoublons();
  local.eventCanonical.price_text = "4 € par enfant";
  local.price_text = "4 € par enfant";
  local.eventCanonical.audience = "Enfants et familles";
  local.audience = "Enfants et familles";
  const fusion = bassinPourToiAvec([local], [enrichie]);
  const event = fusion[0].eventCanonical;
  assert.equal(event.price_text, "4 € par enfant");
  assert.equal(event.audience, "Enfants et familles");
  assert.equal(event.reservation_required, false);
  assert.ok(event.description.includes("artiste invité"));
  assert.equal(event.event_source, "openagenda");
  assert.equal(event.image_source, "openagenda");
});

test("après un rechargement propre, le même événement MEL est recommandable", () => {
  const {local, enrichie} = lignesDoublons();
  const reponseFraiche = bassinPourToiAvec([local], [enrichie]);
  const classes = ANNONCES.classerPourToi(reponseFraiche, optionsClassement(["rap"]));
  assert.equal(classes.length, 1);
  assert.ok(classes[0].matched_interests.includes("rap"));
  assert.ok(TAXONOMIE.tagsDe(classes[0].event).includes("exposition"));
});

test("Rap, Artistes & concerts et Expositions matchent séparément et ensemble", () => {
  const {local, enrichie} = lignesDoublons();
  const event = bassinPourToiAvec([local], [enrichie])[0];
  for (const interest of ["rap", "Artistes & concerts", "Expositions"]) {
    const classes = ANNONCES.classerPourToi([event], optionsClassement([interest]));
    assert.equal(classes.length, 1, interest);
  }
  const ensemble = ANNONCES.classerPourToi([event], optionsClassement([
    "rap", "Artistes & concerts", "Expositions",
  ]));
  assert.equal(ensemble.length, 1);
  assert.deepEqual(new Set(ensemble[0].matched_interests),
    new Set(["rap", "Artistes & concerts", "Expositions"]));
});

test("sans les tags, le classement ne peut rien proposer — la régression d'origine", () => {
  const nu = versEvenementCanonique(Object.assign({}, ligneRpc, { announcement_tags: null }));
  const classes = ANNONCES.classerPourToi([nu], {
    now: Date.now(), interests: ["rap"], limit: 6,
    distanceFor: () => 2000, metroArea: "mel",
  });
  assert.equal(classes.length, 0,
    "c'est bien l'absence de tags qui vidait le panneau");
});

test("un chargement métropolitain vide libère la clé pour un nouvel essai", () => {
  const i = app.search(/^function rafraichirMetropole\(/m);
  const bloc = app.slice(i, app.indexOf("catch", i));
  assert.match(bloc, /if\(!liste\.length\)\{ metropoleEnCours = null; return; \}/);
});

/* OUVRIR CE QU'ON PROPOSE.

   La proposition et l'ouverture ne lisaient pas la même collection.
   `bassinPourToi()` concatène `lieux` et `evenementsMetropole` ; `ouvrirDetail`
   ne cherchait que dans `lieux`. Un événement métropolitain hors du rayon
   local était donc proposé, cliquable, annoncé « Ouvrir … » par son
   `aria-label` — et l'ouverture sortait en silence sur `if(!l) return`.
   Enregistrer, Partager et Masquer continuaient de fonctionner, parce qu'eux
   résolvent depuis `propositions` : d'où le symptôme « rien ne se passe »
   limité au clic sur la carte. */

function extraireFonction(source, nom) {
  const i = source.search(new RegExp("^(?:async )?function " + nom + "\\(", "m"));
  assert.ok(i >= 0, nom + " est introuvable");
  let prof = 0, fin = -1;
  for (let n = source.indexOf("{", i); n < source.length; n += 1) {
    if (source[n] === "{") prof += 1;
    else if (source[n] === "}") { prof -= 1; if (prof === 0) { fin = n + 1; break; } }
  }
  return source.slice(i, fin);
}

function bassinPourToiAvec(lieux, evenementsMetropole) {
  const bassin = extraireFonction(app, "bassinPourToi");
  return new Function(
    "lieux", "evenementsMetropole", "elementsDuContexte", "estCanonique", "dedupeItems", "distanceM",
    bassin + "; return bassinPourToi;")(
    lieux, evenementsMetropole, (items) => items || [], () => true,
    globalThis.AutourCore.dedupeItems,
    (lat1, lng1, lat2, lng2) => Math.hypot((Number(lat1) - Number(lat2)) * 111000,
      (Number(lng1) - Number(lng2)) * 70000)
  )();
}

function lignesDoublons() {
  const local = Object.assign({}, ligneRpc, {
    description: "",
    announcement_tags: null,
    image_url: null,
    image_source: null,
    artist_names: null,
    music_genres: null,
  });
  const enrichie = Object.assign({}, ligneRpc, {
    description: "Concert rap et exposition avec artiste invité.",
    announcement_tags: ["rap", "concert", "exposition"],
    artist_names: ["Ninho"],
    music_genres: ["rap"],
    image_url: "https://img.openagenda.com/main/affiche-rap.jpg",
    image_source: "openagenda",
    image_source_url: "https://openagenda.com/events/rap",
    reservation_required: false,
    reservation_text: "Sans réservation.",
  });
  const localCanonique = versEvenementCanonique(local);
  const enrichieCanonique = versEvenementCanonique(enrichie);
  /* Le stub de visuelEvenement du test n'a pas besoin de couvrir le renderer;
     on conserve toutefois ici le contrat RPC complet pour exercer la fusion
     des médias et de leur provenance, comme le fait l'application réelle. */
  Object.assign(enrichieCanonique, {
    image: enrichie.image_url,
    imageSource: enrichie.image_source,
    image_url: enrichie.image_url,
    image_source: enrichie.image_source,
    image_source_url: enrichie.image_source_url,
  });
  enrichieCanonique.eventCanonical = globalThis.AutourEntites.CanonicalEvent(enrichieCanonique);
  return {local: localCanonique, enrichie: enrichieCanonique};
}

function optionsClassement(interests) {
  return {
    now: Date.now(), interests, seenIds: [], hiddenIds: [], limit: 6,
    distanceFor: () => 2000, metroArea: "mel", territorySlug: "tourcoing",
  };
}

function resolveurAvec(lieux, evenementsMetropole) {
  return new Function("lieux", "evenementsMetropole",
    extraireFonction(app, "lieuParId") + "; return lieuParId;")(lieux, evenementsMetropole);
}

test("une proposition venue du seul bassin métropolitain est ouvrable", () => {
  const item = versEvenementCanonique(ligneRpc);
  const classes = ANNONCES.classerPourToi([item], {
    now: Date.now(), interests: ["rap"], seenIds: [], hiddenIds: [], limit: 6,
    distanceFor: () => 2000, metroArea: "mel", territorySlug: "tourcoing",
  });
  assert.equal(classes.length, 1, "l'événement doit d'abord être proposé");
  const id = classes[0].event.id;

  /* Le cas réel : la carte locale ne l'a jamais vu passer. */
  const lieuxLocaux = [{ id: "osm42", titre: "Un banc" }];
  assert.equal(lieuxLocaux.find((x) => x.id === id), undefined,
    "le montage doit bien représenter un événement absent de `lieux`");

  const lieuParId = resolveurAvec(lieuxLocaux, [item]);
  const trouve = lieuParId(id);
  assert.ok(trouve, "l'ouverture doit retrouver l'événement métropolitain");
  assert.equal(trouve.titre, "Concert rap au Grand Mix");
});

test("`lieux` reste prioritaire sur la copie métropolitaine", () => {
  const frais = { id: "evt1", titre: "Version fraîche" };
  const metro = { id: "evt1", titre: "Version du bassin" };
  const lieuParId = resolveurAvec([frais], [metro]);
  assert.equal(lieuParId("evt1").titre, "Version fraîche");
  assert.equal(lieuParId(null), null);
  assert.equal(lieuParId("inconnu"), null);
});

test("ouvrirDetail passe par le résolveur et non par `lieux` seul", () => {
  const ecrans = lire("../differe/ecrans.js");
  const bloc = extraireFonction(ecrans, "ouvrirDetail").slice(0, 200);
  assert.match(bloc, /const l = lieuParId\(id\);/,
    "ouvrirDetail doit résoudre l'identifiant sur le bassin complet");
});

test("Pour toi suit réellement bassin → CanonicalEvent → tags → matching → rendu", async () => {
  const trace = [];
  const lecture = {
    async rpc(nom, parametres) {
      trace.push({nom, parametres});
      return {data: [ligneRpc], error: null};
    },
  };
  const chargeur = new Function(
    "sbLecture", "PERF", "journal", "METROPOLE_LIMITE", "versEvenementCanonique",
    extraireFonction(app, "chargerEvenementsMetropole") +
      "; return chargerEvenementsMetropole;")(
    lecture, {requete: () => () => {}}, {warn: () => {}}, 300, versEvenementCanonique);

  /* 1. Chargement du bassin réel, avec le même mapper que l'application. */
  const bassin = await chargeur("mel");
  assert.deepEqual(trace.map((appel) => appel.nom), ["evenements_bassin"]);
  assert.equal(trace[0].parametres.p_group_slug, "mel");
  assert.equal(bassin.length, 1);
  const event = bassin[0];

  /* 2–3. Le contrat est bien un événement canonique et ses faits de
     recommandation sont encore disponibles au moment du matching. */
  assert.equal(event.entity_type, "event");
  assert.equal(event.eventCanonical.entity_type, "event");
  assert.ok(TAXONOMIE.tagsDe(event).includes("rap"));
  assert.ok(TAXONOMIE.tagsDe(event).includes("concert"));

  /* 4–5. Surveillances actives, classement, puis groupement et rendu de la
     carte : un événement compatible ne doit jamais disparaître entre deux
     étapes parce qu'un champ a changé de nom. */
  const classes = ANNONCES.classerPourToi(bassin, {
    now: Date.now(), interests: ["rap", "concerts"], seenIds: [], hiddenIds: [],
    limit: 6, distanceFor: () => 2000, metroArea: "mel", territorySlug: "tourcoing",
  });
  assert.equal(classes.length, 1);
  assert.deepEqual(classes[0].matched_interests, ["rap", "concerts"]);

  const propositions = classes.map((classe) => ({
    l: classe.event,
    pourquoi: {texte: classe.reason},
    groupe: classe.group,
    groupeLabel: ANNONCES.libelleGroupe(classe.group),
    matchedInterests: classe.matched_interests,
    score: classe.score,
  }));
  const echapper = (value) => String(value == null ? "" : value)
    .replace(/[&<>\"]/g, (character) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[character]));
  const renderers = new Function(
    "TAXONOMIE_ANNONCES", "ENVIES", "carteProposition", "esc",
    extraireFonction(app, "groupesInteretsPourToi") +
      extraireFonction(app, "rendreGroupePourToi") +
      "; return {groupesInteretsPourToi, rendreGroupePourToi};")(
    TAXONOMIE,
    {choisies: () => ["rap", "concerts"]},
    (proposition) => '<article data-pt="' + echapper(proposition.l.id) + '">' +
      echapper(proposition.l.title) + '</article>',
    echapper
  );
  const groupes = renderers.groupesInteretsPourToi(propositions);
  assert.deepEqual(groupes.map((groupe) => groupe.id), ["rap", "concerts"]);
  const html = groupes.map((groupe) => renderers.rendreGroupePourToi(
    groupe.label + " · " + groupe.propositions.length,
    "pourtoi-interet-" + groupe.id,
    groupe.propositions,
  )).join("");
  assert.match(html, /data-testid="pourtoi-interet-rap"/);
  assert.match(html, new RegExp('data-pt="' + event.id + '"'));
});

test("l'audit Paris conserve le bassin demandé sans dépendre d'un cas de titre", () => {
  const item = versEvenementCanonique(Object.assign({}, ligneRpc, {
    id: "22222222-3333-4444-5555-666666666666",
    title: "Concert rap à Paris",
    city: "Paris",
    lat: 48.8566,
    lng: 2.3522,
    metro_area: "paris",
    territory_slug: "paris",
  }));
  const classes = ANNONCES.classerPourToi([item], {
    now: Date.now(), interests: ["rap"], seenIds: [], hiddenIds: [], limit: 6,
    distanceFor: () => 1500, metroArea: "paris", territorySlug: "paris",
  });
  assert.equal(classes.length, 1, "un événement futur du bassin de Paris doit rester recommandable");
  assert.equal(classes[0].event.metro_area, "paris");
  assert.match(classes[0].event.cp, /^Paris/);
});

test("un changement de zone invalide aussi les réponses de bassin arrivées en retard", () => {
  const zone = app.slice(app.indexOf("function definirZoneActive"), app.indexOf("function dansZoneActive"));
  assert.match(zone, /bassinTerritorialActif = null;/);
  assert.match(zone, /evenementsMetropole = \[\];/);
  assert.match(zone, /metropoleEnCours = null;/);

  const events = app.slice(app.indexOf("async function chargerEvenementsCanoniques"),
    app.indexOf("async function rafraichirCoucheSupabase"));
  assert.match(events, /async function chargerEvenementsCanoniques\(lat,lng,portee = porteeCourante\)/);
  assert.match(events, /if\(porteeEvenements !== porteeCourante\) return;/);
  assert.match(app, /chargerEvenementsCanoniques\(lat,lng,portee\)/);

  const metro = app.slice(app.indexOf("function rafraichirMetropole"),
    app.indexOf("function bassinPourToi"));
  assert.match(metro, /porteeMetropole !== porteeCourante \|\| bassinCourant !== bassin/);
});
