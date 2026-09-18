/* LE LOT A — le contexte unique et la hiérarchie de pertinence.

   Ce que ce fichier protège, et qui est une décision produit avant d'être une
   règle de code :

       LE DÉCLARÉ SÉLECTIONNE, L'IMPLICITE ORDONNE.

   Autrement dit : une case cochée peut faire ENTRER quelque chose ; un
   comportement observé ne peut que DÉPLACER ce qui est déjà entré. C'est la
   condition pour qu'Autour puisse toujours répondre à « pourquoi je vois
   ça ? », et c'est ce qui sépare une recommandation d'un profilage.

   Le fichier couvre aussi le cas obligatoire du cahier des charges — Lille,
   un artiste suivi, un immense concert à Paris — dans ce que le lot A peut
   déjà tenir. Les phases de billetterie sont le lot B, et leurs assertions
   viendront s'ajouter ici. */
import test from "node:test";
import assert from "node:assert/strict";

/* Un `localStorage` de test : le module doit fonctionner avec, et sans. */
class Stockage {
  constructor(){ this.s = new Map(); }
  getItem(k){ return this.s.has(k) ? this.s.get(k) : null; }
  setItem(k, v){ this.s.set(k, String(v)); }
  removeItem(k){ this.s.delete(k); }
}
globalThis.localStorage = new Stockage();

await import("../signaux.js");
await import("../availability.js");
await import("../temporel.js");
await import("../zones-autonomes.js");
await import("../apprentissage.js");
await import("../pertinence.js");
await import("../cycle-evenement.js");
await import("../contexte-moteur.js");
await import("../annonces-taxonomie.js");
await import("../annonces-classement.js");
await import("../core.js");

const A = globalThis.AutourApprentissage;
const P = globalThis.AutourPertinence;
const C = globalThis.AutourContexteMoteur;
const CORE = globalThis.AutourCore;
const CYCLE = globalThis.AutourCycle;
const ANNONCES = globalThis.AutourAnnoncesClassement;

const MINUTE = 60e3;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

function neuf(){ globalThis.localStorage = new Stockage(); A._reinitialiser(); }

/* ==================================================================== */
/*  L'IMPLICITE NE SÉLECTIONNE JAMAIS                                    */
/* ==================================================================== */

test("le modèle implicite ne rend qu'un vecteur borné, jamais une liste d'admission", () => {
  neuf();
  for (let i = 0; i < 50; i += 1) A.noter("clic", "concert");
  const v = A.vecteur();
  Object.values(v).forEach((poids) => {
    assert.ok(poids > 0 && poids <= 1, "un poids implicite reste entre 0 et 1 : " + poids);
  });
  /* Cent clics ne valent pas cent fois un clic. C'est ce plafond qui rend
     impossible la dérive « plus je clique, plus ça écrase tout le reste ». */
  assert.equal(v.concert, 1);
});

test("un seul geste ne colore pas l'écran", () => {
  neuf();
  A.noter("clic", "musee");
  assert.equal(A.poids("musee"), 0, "trois points ne franchissent pas le seuil");
  A.noter("clic", "musee");
  assert.ok(A.poids("musee") > 0, "deux clics, eux, disent quelque chose");
});

test("un intérêt vieillit, et vieillit tout seul", () => {
  neuf();
  const t0 = Date.UTC(2026, 0, 10, 12);
  A.noter("sauvegarde", "concert", {now: t0});
  const avant = A.brut("concert", t0);
  const apres = A.brut("concert", t0 + 21 * JOUR);
  assert.ok(Math.abs(apres - avant / 2) < 0.2,
    "trois semaines valent exactement une demi-vie : " + avant + " → " + apres);
  assert.ok(A.brut("concert", t0 + 365 * JOUR) < 0.1, "un an plus tard, il ne reste rien");
});

test("un poids qui ne sait pas s'expliquer ne pèse pas", () => {
  neuf();
  A.noter("clic", "concert"); A.noter("clic", "concert");
  const vu = P.personnel({cat: "concert"}, {modele: A});
  assert.ok(vu.valeur > 0);
  assert.ok(vu.raison, "un poids qui compte porte sa phrase");

  /* Un modèle muet — ou éteint — ne peut rien pousser, même si le vecteur
     qu'on lui passe dit le contraire. C'est la barrière qui empêche une
     poussée anonyme d'exister. */
  const muet = {poids: () => 1, raison: () => null};
  const sansPhrase = P.personnel({cat: "concert"}, {modele: muet, vecteur: {concert: 1}});
  assert.equal(sansPhrase.valeur, 0, "sans phrase, aucun point");
});

test("éteindre efface, et le classement redevient celui de quelqu'un qui arrive", () => {
  neuf();
  A.noter("sauvegarde", "concert"); A.noter("sauvegarde", "musee");
  assert.ok(Object.keys(A.vecteur()).length > 0);
  A.definirActif(false);
  assert.deepEqual(A.vecteur(), {}, "éteint, il ne reste rien à lire");
  assert.equal(A.noter("clic", "concert"), null, "éteint, plus rien ne s'écrit");
  A.definirActif(true);
  assert.deepEqual(A.vecteur(), {}, "rallumer ne ressuscite pas ce qui a été effacé");
});

test("ce qui est retenu est montrable en clair", () => {
  neuf();
  A.noter("sauvegarde", "concert"); A.noter("sauvegarde", "concert");
  const vu = A.exporter();
  assert.equal(vu.actif, true);
  assert.equal(vu.interets.length, 1);
  assert.equal(vu.interets[0].cle, "concert");
  assert.ok(vu.interets[0].raison, "chaque ligne de l'export sait se dire");
});

test("une clé qui n'est pas une catégorie est refusée", () => {
  neuf();
  /* La barrière qui empêche une phrase de recherche, un nom de lieu ou un
     identifiant d'atterrir dans le modèle. Elle est dans le module, pas dans
     la convention d'appel : un appelant distrait ne peut pas la contourner. */
  assert.equal(A.noter("recherche", "je cherche un endroit où dormir ce soir"), null);
  assert.equal(A.noter("clic", ""), null);
  assert.equal(A.noter("clic", "a"), null);
  assert.deepEqual(A.vecteur(), {});
});

test("le stockage qui refuse n'empêche jamais de se servir d'Autour", () => {
  A._reinitialiser();
  globalThis.localStorage = {
    getItem(){ throw new Error("bloqué"); },
    setItem(){ throw new Error("bloqué"); },
    removeItem(){},
  };
  assert.doesNotThrow(() => A.noter("clic", "concert"));
  assert.doesNotThrow(() => A.vecteur());
  neuf();
});

/* ==================================================================== */
/*  LA HIÉRARCHIE EST CONTEXTUELLE                                       */
/* ==================================================================== */

test("chaque espace a son ordre, et la faisabilité passe avant tout là où elle figure", () => {
  Object.entries(P.HIERARCHIES).forEach(([nom, ordre]) => {
    ordre.forEach((critere) => assert.ok(P.CRITERES.includes(critere),
      nom + " nomme un critère inconnu : " + critere));
    assert.equal(ordre[ordre.length - 1], "diversite",
      nom + " : la variété est au dernier rang, elle ne coûte jamais la tête de liste");
    if (ordre.includes("faisabilite")) assert.equal(ordre[0], "faisabilite",
      nom + " : rien ne passe devant la faisabilité");
  });
  /* Là où se joue la différence : dans « Maintenant » le temps et les pieds
     commandent ; dans « Pour toi » c'est la personne. */
  assert.ok(P.HIERARCHIES.maintenant.indexOf("temporalite") < P.HIERARCHIES.maintenant.indexOf("personnel"));
  assert.ok(P.HIERARCHIES.maintenant.indexOf("proximite") < P.HIERARCHIES.maintenant.indexOf("personnel"));
  assert.equal(P.HIERARCHIES.pourtoi[0], "personnel");
  assert.ok(P.HIERARCHIES.pourtoi.indexOf("personnel") < P.HIERARCHIES.pourtoi.indexOf("temporalite"));
});

test("la popularité n'est pas un rang de la hiérarchie", () => {
  /* Elle reste un ingrédient du score — les avis, la note — capable de
     départager deux propositions équivalentes, jamais d'en renverser une.
     Ce n'est pas une règle qui la déclare inférieure à la personnalisation
     partout : c'est une place dans un ordre. */
  assert.ok(!P.CRITERES.includes("popularite"));
  Object.values(P.HIERARCHIES).forEach((ordre) => assert.ok(!ordre.includes("popularite")));
  /* L'AMPLEUR, elle, en est un : un événement exceptionnel porte loin. */
  assert.ok(P.CRITERES.includes("importance"));
  assert.equal(P.importance({importance_level: "major"}), 1);
  assert.equal(P.importance({importance_level: "local"}), 0.25);
  assert.equal(P.importance({titre: "un café"}), 0, "un lieu pérenne n'a pas d'ampleur");
});

test("le déclaré passe devant le déduit à l'intérieur du même critère", () => {
  const comparer = P.comparateur("pourtoi", {});
  const declare = {rankBreakdown: {declare: 1, perso: 0}};
  const deduit = {rankBreakdown: {declare: 0, perso: 1}};
  assert.ok(comparer(declare, deduit) < 0, "ce qui a été coché passe devant ce qui a été observé");
});

test("sans hiérarchie nommée, le comparateur n'existe pas", () => {
  /* C'est ce qui permet de câbler la hiérarchie écran par écran : un appelant
     qui ne la demande pas garde exactement le tri d'avant. */
  assert.equal(P.comparateur(null, {}), null);
  assert.equal(P.comparateur("inconnue", {}), null);
});

/* ==================================================================== */
/*  LE CONTEXTE EST UNIQUE                                               */
/* ==================================================================== */

test("un seul instant gouverne tout le contexte", () => {
  const instant = Date.UTC(2026, 5, 20, 20, 30);
  const ctx = C.contexte({instant, creneau: "weekend", zone: {id: "mel"},
    regarde: [50.63, 3.06], moi: [50.72, 3.16]});
  assert.equal(ctx.instant, instant);
  assert.equal(ctx.heure, new Date(instant).getHours());
  assert.equal(ctx.jour, new Date(instant).getDay());
  assert.ok(Object.isFrozen(ctx), "un contexte ne se modifie pas après coup");
});

test("la découpe des moments est celle de l'application, au chiffre près", () => {
  /* Déplacer du code n'est pas une occasion de déplacer un comportement :
     une découpe « plus propre » qui ferait commencer le matin à 5 h
     changerait ce que quelqu'un voit à 5 h du matin. */
  assert.equal(C.momentDe(5).nom, "cette nuit");
  assert.equal(C.momentDe(6).nom, "ce matin");
  assert.equal(C.momentDe(12).nom, "ce midi");
  assert.equal(C.momentDe(15).nom, "cet après-midi");
  assert.equal(C.momentDe(20).nom, "ce soir");
  assert.equal(C.momentDe(23).nom, "cette nuit");
});

test("le contexte n'invente rien : un module absent laisse un trou, pas une valeur", () => {
  const ctx = C.contexte({instant: Date.now(), signaux: null, temps: null, zones: null, modele: null});
  assert.equal(ctx.saison, null);
  assert.equal(ctx.nuit, null);
  assert.equal(ctx.fenetre, null);
  assert.equal(ctx.zone.id, null);
  assert.deepEqual(ctx.perso, {});
});

test("où l'on regarde et où l'on est restent deux choses", () => {
  const ailleurs = C.contexte({instant: Date.now(), regarde: [48.85, 2.35], moi: [50.63, 3.06]});
  assert.equal(ailleurs.surPlace, false);
  assert.deepEqual(ailleurs.point.regarde, [48.85, 2.35]);
  assert.deepEqual(ailleurs.point.moi, [50.63, 3.06]);
  const chezSoi = C.contexte({instant: Date.now(), regarde: [50.63, 3.06], moi: [50.63, 3.06]});
  assert.equal(chezSoi.surPlace, true);
});

test("le contexte ne rend le vecteur que si la personnalisation est allumée", () => {
  neuf();
  A.noter("sauvegarde", "concert"); A.noter("sauvegarde", "concert");
  assert.ok(Object.keys(C.contexte({instant: Date.now(), modele: A}).perso).length > 0);
  A.definirActif(false);
  const eteint = C.contexte({instant: Date.now(), modele: A});
  assert.deepEqual(eteint.perso, {});
  assert.equal(eteint.personnalisation, false);
  neuf();
});

/* ==================================================================== */
/*  LE CLASSEMENT : CE QUE L'IMPLICITE PEUT, ET CE QU'IL NE PEUT PAS     */
/* ==================================================================== */

const now = Date.UTC(2026, 5, 20, 20, 0);

function lieu(extra){
  return Object.assign({
    id: String(Math.random()), titre: "Lieu", cat: "cafe",
    lat: 50.6300, lng: 3.0600, ouvert: true,
    quand: "Mo-Su 08:00-23:00",
  }, extra || {});
}

test("un intérêt implicite ne fait entrer personne", () => {
  neuf();
  for (let i = 0; i < 6; i += 1) A.noter("sauvegarde", "musee");
  /* Un musée FERMÉ, dans une catégorie adorée, en mode « maintenant ». Aucun
     poids implicite ne doit le faire apparaître : la porte est fermée, et un
     goût ne l'ouvre pas. */
  const ferme = lieu({cat: "musee", titre: "Musée fermé", quand: "Mo-Su 10:00-12:00", ouvert: false});
  const ouvert = lieu({cat: "cafe", titre: "Café ouvert"});
  const sortie = CORE.rankResults([ferme, ouvert], {
    intent: "sortir", position: [50.63, 3.06], now, nowOnly: true,
    categories: ["cafe", "musee"], interets: A.vecteur(now), hierarchie: "maintenant",
  });
  assert.ok(!sortie.some((x) => x.titre === "Musée fermé"),
    "un goût n'ouvre pas une porte fermée");
});

test("à situation égale, l'intérêt implicite ordonne", () => {
  neuf();
  for (let i = 0; i < 6; i += 1) A.noter("sauvegarde", "musee");
  /* Deux lieux ouverts, à la même distance, dans le même créneau. Là — et
     seulement là — le comportement a le droit de trancher.

     L'heure compte : un après-midi, pas 22 h. `availability.js` connaît les
     marges par type, et arriver au musée une heure avant la fermeture n'est
     pas une visite — il tombe alors derrière le café pour une raison qui n'a
     rien à voir avec le goût, et c'est très bien ainsi. */
  const apresMidi = Date.UTC(2026, 5, 20, 12, 0);
  const musee = lieu({cat: "musee", titre: "Musée", quand: "Mo-Su 08:00-23:00"});
  const cafe = lieu({cat: "cafe", titre: "Café"});
  const sortie = CORE.rankResults([cafe, musee], {
    intent: "sortir", position: [50.63, 3.06], now: apresMidi,
    categories: ["cafe", "musee"], interets: A.vecteur(apresMidi), hierarchie: "explorer",
  });
  assert.equal(sortie[0].titre, "Musée");
  assert.ok(sortie[0].rankPersoRaison, "et la carte peut dire pourquoi");
});

test("sans vecteur, le classement est exactement celui d'avant", () => {
  const items = [lieu({titre: "A", lat: 50.6310}), lieu({titre: "B", cat: "musee", lat: 50.6305})];
  const base = {intent: "sortir", position: [50.63, 3.06], now, categories: ["cafe", "musee"]};
  const sans = CORE.rankResults(items, base).map((x) => x.titre);
  const avecVecteurVide = CORE.rankResults(items, Object.assign({}, base, {interets: {}})).map((x) => x.titre);
  assert.deepEqual(avecVecteurVide, sans);
  sans.forEach((_, i) => {
    const r = CORE.rankResults(items, base)[i];
    assert.equal(r.rankBreakdown.perso, 0);
    assert.equal(r.rankPersoRaison, null);
  });
});

/* ==================================================================== */
/*  LE CAS OBLIGATOIRE : Lille, un artiste suivi, un concert à Paris     */
/* ==================================================================== */

/* UN SEUL ÉVÉNEMENT, SUIVI D'UN BOUT À L'AUTRE DE SA VIE.

   C'est le même objet à chaque étape — annonce, billetterie, J-3, jour J,
   terminé. Rien n'est dupliqué, rien n'est recréé : seule l'heure à laquelle
   on le regarde change. C'est exactement ce que le produit demande, et c'est
   aussi ce que ce fichier doit prouver.

   Trois espaces, trois questions distinctes, et on les pose à chaque étape :

     MAINTENANT  « puis-je y aller là, tout de suite ? »
     POUR TOI    « est-ce que ça me concerne ? »
     À VENIR     « est-ce que je dois l'anticiper ? »

   La personne est à Lille. Le concert est à Paris La Défense Arena, à
   220 km. Elle suit l'artiste — c'est une case cochée, pas une déduction. */

const LILLE = [50.6292, 3.0573];
const PARIS_ARENA = {lat: 48.8938, lng: 2.2297};
const DISTANCE_PARIS = 220e3;

/* Le jour du concert : un samedi de juin, 20 h à Paris. */
const CONCERT_DEBUT = Date.UTC(2026, 5, 20, 18, 0);
const CONCERT_FIN = CONCERT_DEBUT + 3 * HEURE;
/* La billetterie ouvre trois mois avant, un mardi à 10 h. */
const BILLETTERIE = Date.UTC(2026, 2, 10, 9, 0);
/* L'annonce, une semaine avant l'ouverture. */
const ANNONCE = BILLETTERIE - 7 * JOUR;

function concertParis(){
  return {
    id: "concert-paris",
    title: "Artiste X — Paris La Défense Arena",
    titre: "Artiste X — Paris La Défense Arena",
    category: "concert", cat: "concert", isTemporary: true,
    lat: PARIS_ARENA.lat, lng: PARIS_ARENA.lng,
    zone_id: "paris", metro_area: "idf",
    start_at: new Date(CONCERT_DEBUT).toISOString(),
    end_at: new Date(CONCERT_FIN).toISOString(),
    startsAt: CONCERT_DEBUT, endsAt: CONCERT_FIN,
    date_confidence: "exact", timezone: "Europe/Paris",
    importance_level: "major", importance_score: 95,
    music_genres: ["rap"], announcement_tags: ["concert", "rap"],
    announced_at: new Date(ANNONCE).toISOString(),
    tickets_open_at: new Date(BILLETTERIE).toISOString(),
    primary_source: "openagenda", cancelled: false, avis: 0,
  };
}

/* Un petit concert de quartier, à Lille, dans dix jours. Il sert de témoin :
   il ne doit jamais disparaître parce qu'un géant parisien existe. */
function concertLocal(quand){
  return {
    id: "concert-local",
    title: "Scène ouverte du Vieux-Lille", titre: "Scène ouverte du Vieux-Lille",
    category: "concert", cat: "concert", isTemporary: true,
    lat: 50.6420, lng: 3.0640, zone_id: "mel", metro_area: "mel",
    start_at: new Date(quand).toISOString(),
    end_at: new Date(quand + 2 * HEURE).toISOString(),
    startsAt: quand, endsAt: quand + 2 * HEURE,
    date_confidence: "exact", timezone: "Europe/Paris",
    importance_level: "local", importance_score: 12,
    announcement_tags: ["concert"], music_genres: [],
    primary_source: "openagenda", cancelled: false, avis: 0,
  };
}

function distanceDepuisLille(item){
  return item && String(item.id).indexOf("paris") >= 0 ? DISTANCE_PARIS : 1800;
}

/* Les trois espaces, tels que l'application les construit réellement. */

function espaceMaintenant(items, instant){
  /* `nowOnly` et le rayon regardé : la porte de « Maintenant » est la même
     pour tout le monde, et elle est géographique autant que temporelle. */
  return CORE.rankResults(items, {
    intent: "sortir", position: LILLE, now: instant, nowOnly: true,
    categories: ["concert", "cafe", "musee"], radius: 3000,
    distanceBetween: (aLat, aLng, bLat, bLng) =>
      distanceDepuisLille({id: bLat === PARIS_ARENA.lat ? "concert-paris" : "local"}),
    hierarchie: "maintenant",
  });
}

function espacePourToi(items, instant, envies){
  const locaux = ANNONCES.classerPourToi(items.filter((e) => e.zone_id === "mel"), {
    now: instant, interests: envies, activeZoneId: "mel", pool: "local",
    metroArea: "mel", distanceFor: distanceDepuisLille, limit: 6,
  });
  const majeurs = ANNONCES.classerPourToi(items.filter((e) => e.zone_id !== "mel"), {
    now: instant, interests: envies, activeZoneId: "mel", pool: "major_cross_zone",
    distanceFor: distanceDepuisLille, limit: 6,
  });
  return majeurs.concat(locaux).sort((a, b) => b.score - a.score);
}

function espaceAvenir(items, instant, vecteur, envies){
  return CORE.rankResults(items, {
    intent: "sortir", position: LILLE, now: instant,
    categories: ["concert"], radius: 400e3,
    distanceBetween: (aLat, aLng, bLat, bLng) =>
      bLat === PARIS_ARENA.lat ? DISTANCE_PARIS : 1800,
    interets: vecteur || null, envies: envies || null, hierarchie: "avenir",
  });
}

function dans(espace, id){
  return espace.some((x) => (x.id || x.event_id) === id);
}
function rang(espace, id){
  return espace.findIndex((x) => (x.id || x.event_id) === id);
}

/* -------------------------------------------------------------------- */
/*  ÉTAPE 1 — annoncé, dans plus de trois mois                           */
/* -------------------------------------------------------------------- */

test("étape 1 · annoncé dans trois mois : il concerne, il ne presse pas", () => {
  neuf();
  const t = ANNONCE + 2 * HEURE;
  const paris = concertParis();
  const local = concertLocal(t + 10 * JOUR);
  const items = [paris, local];

  const phase = CYCLE.phase(paris, t);
  assert.equal(phase.phase, CYCLE.PHASES.ANNONCE);
  assert.equal(phase.horloge, "information");
  assert.match(phase.libelle, /Nouvelle annonce/);

  /* MAINTENANT : rien. Ni le concert de juin, ni celui de dans dix jours. */
  const maintenant = espaceMaintenant(items, t);
  assert.equal(dans(maintenant, "concert-paris"), false);
  assert.equal(dans(maintenant, "concert-local"), false);

  /* POUR TOI : le concert parisien est là, par le pool majeur hors zone. */
  const pourToi = espacePourToi(items, t, ["rap", "concerts"]);
  assert.equal(dans(pourToi, "concert-paris"), true);
  const fiche = pourToi.find((x) => x.event_id === "concert-paris");
  assert.equal(fiche.phase, CYCLE.PHASES.ANNONCE);
  assert.equal(fiche.crossZone, true, "220 km : il vient du pool majeur hors zone");

  /* À VENIR : présent, et le local aussi — un géant n'efface pas le quartier. */
  const avenir = espaceAvenir(items, t, null, ["concerts"]);
  assert.equal(dans(avenir, "concert-paris"), true);
  assert.equal(dans(avenir, "concert-local"), true);
});

/* -------------------------------------------------------------------- */
/*  ÉTAPE 2 — la billetterie ouvre                                       */
/* -------------------------------------------------------------------- */

test("étape 2 · la billetterie ouvre : l'information devient urgente, pas l'événement", () => {
  neuf();
  const t = BILLETTERIE + HEURE;
  const paris = concertParis();
  const local = concertLocal(t + 10 * JOUR);
  const items = [paris, local];

  const phase = CYCLE.phase(paris, t);
  assert.equal(phase.phase, CYCLE.PHASES.BILLETTERIE_OUVERTE);
  assert.match(phase.libelle, /Billetterie ouverte/);
  /* LA DISTINCTION QUI FAIT TOUT LE LOT : l'information presse, l'événement
     est toujours dans trois mois. */
  assert.equal(phase.horloge, "information");
  assert.ok(phase.debut > t + 80 * JOUR);
  assert.ok(phase.urgence > CYCLE.URGENCE[CYCLE.PHASES.ANNONCE]);

  /* MAINTENANT : toujours rien. Des billets disponibles ne sont pas un
     concert en cours, et aucune urgence ne peut ouvrir cette porte. */
  const maintenant = espaceMaintenant(items, t);
  assert.equal(dans(maintenant, "concert-paris"), false,
    "une billetterie qui ouvre ne fait entrer personne dans « Maintenant »");

  /* POUR TOI : il remonte, et il le dit. */
  const pourToi = espacePourToi(items, t, ["rap", "concerts"]);
  const fiche = pourToi.find((x) => x.event_id === "concert-paris");
  assert.ok(fiche, "il est là");
  assert.equal(fiche.phase, CYCLE.PHASES.BILLETTERIE_OUVERTE);
  assert.match(fiche.phase_libelle, /Billetterie ouverte/);
  assert.equal(fiche.phase_horloge, "information");

  /* Et il remonte VRAIMENT : plus haut qu'au moment de la simple annonce. */
  const avantOuverture = espacePourToi([concertParis(), local], ANNONCE + 2 * HEURE,
    ["rap", "concerts"]).find((x) => x.event_id === "concert-paris");
  assert.ok(fiche.score > avantOuverture.score,
    "l'ouverture de la billetterie pèse plus que l'annonce : " +
    fiche.score + " contre " + avantOuverture.score);

  /* À VENIR : c'est son espace. Il y passe devant le petit concert local,
     pourtant dix fois plus proche dans le temps ET dans l'espace — parce que
     la distance temporelle est un facteur, pas le seul. */
  const avenir = espaceAvenir(items, t, null, ["concerts"]);
  assert.ok(rang(avenir, "concert-paris") < rang(avenir, "concert-local"));
  assert.equal(dans(avenir, "concert-local"), true, "le local reste visible");
});

test("étape 2 bis · passé sa fenêtre, une billetterie n'est plus une nouvelle", () => {
  const paris = concertParis();
  const tard = BILLETTERIE + CYCLE.FENETRE_OUVERTURE_MS + HEURE;
  const phase = CYCLE.phase(paris, tard);
  assert.equal(phase.phase, CYCLE.PHASES.A_VENIR);
  assert.equal(phase.libelle, null,
    "« en vente depuis trois semaines » est un état, pas une information");
});

/* -------------------------------------------------------------------- */
/*  ÉTAPE 3 — J-3                                                        */
/* -------------------------------------------------------------------- */

test("étape 3 · J-3 : le wording change, la priorité monte, la distance compte", () => {
  neuf();
  const t = CONCERT_DEBUT - 3 * JOUR;
  const paris = concertParis();
  const local = concertLocal(t + 20 * JOUR);
  const items = [paris, local];

  const phase = CYCLE.phase(paris, t);
  assert.equal(phase.phase, CYCLE.PHASES.APPROCHE);
  assert.equal(phase.joursRestants, 3);
  assert.match(phase.libelle, /Dans 3 jours/);
  /* L'horloge de l'événement a repris la main : ce n'est plus une nouvelle de
     billetterie, c'est un concert dans trois jours. */
  assert.equal(phase.horloge, "evenement");

  /* LA FAISABILITÉ DU DÉPLACEMENT : à 220 km, l'approche presse PLUS, parce
     que c'est maintenant qu'il faut s'organiser. */
  const loin = CYCLE.urgenceAjustee(phase, DISTANCE_PARIS);
  const proche = CYCLE.urgenceAjustee(phase, 1800);
  assert.ok(loin > proche, "un déplacement lointain se prépare : " + loin + " > " + proche);

  /* MAINTENANT : toujours non. Trois jours, ce n'est pas maintenant. */
  assert.equal(dans(espaceMaintenant(items, t), "concert-paris"), false);

  /* POUR TOI : présent, avec la bonne phrase et une urgence supérieure à
     celle de la billetterie. */
  const fiche = espacePourToi(items, t, ["rap", "concerts"])
    .find((x) => x.event_id === "concert-paris");
  assert.ok(fiche);
  assert.equal(fiche.phase, CYCLE.PHASES.APPROCHE);
  assert.match(fiche.phase_libelle, /Dans 3 jours/);
  assert.ok(fiche.echeance > CYCLE.URGENCE[CYCLE.PHASES.BILLETTERIE_OUVERTE]);

  /* À VENIR : en tête. */
  const avenir = espaceAvenir(items, t, null, ["concerts"]);
  assert.equal(rang(avenir, "concert-paris"), 0);
});

test("étape 3 bis · le compte à rebours descend tout seul", () => {
  const paris = concertParis();
  const dit = (jours) => CYCLE.phase(paris, CONCERT_DEBUT - jours * JOUR).libelle;
  assert.match(dit(3), /Dans 3 jours/);
  assert.match(dit(2), /Dans 2 jours/);
  assert.match(dit(1), /Demain/);
});

/* -------------------------------------------------------------------- */
/*  ÉTAPE 4 — le jour J                                                  */
/* -------------------------------------------------------------------- */

test("étape 4 · jour J : « ce soir », et Pour toi ne garde pas un classement périmé", () => {
  neuf();
  /* Le matin du concert, 9 h à Paris. */
  const t = CONCERT_DEBUT - 11 * HEURE;
  const paris = concertParis();
  const items = [paris];

  const phase = CYCLE.phase(paris, t);
  assert.equal(phase.phase, CYCLE.PHASES.JOUR_J);
  assert.match(phase.libelle, /Ce soir/);
  assert.equal(phase.joursRestants, 0);
  assert.equal(phase.horloge, "evenement");

  /* La faisabilité tempère : on ne part pas à 220 km sur un coup de tête. */
  assert.ok(CYCLE.urgenceAjustee(phase, DISTANCE_PARIS) <
            CYCLE.urgenceAjustee(phase, 1500));

  /* MAINTENANT : pas encore. Il commence dans onze heures. */
  assert.equal(dans(espaceMaintenant(items, t), "concert-paris"), false);

  /* POUR TOI : il y est, avec « ce soir ». */
  const fiche = espacePourToi(items, t, ["rap", "concerts"])
    .find((x) => x.event_id === "concert-paris");
  assert.ok(fiche, "le jour J, il est encore une information à anticiper");
  assert.match(fiche.phase_libelle, /Ce soir/);
});

test("étape 4 bis · quand il devient imminent ET atteignable, il quitte « Pour toi »", () => {
  /* Le même concert, mais à Lille. Une heure avant : c'est « Maintenant » qui
     en parle désormais, et « Pour toi » le lâche — sans quoi il serait
     annoncé deux fois, avec deux niveaux d'urgence différents. */
  const t = CONCERT_DEBUT - HEURE;
  const aLille = Object.assign(concertParis(), {
    id: "concert-proche", zone_id: "mel", metro_area: "mel",
    lat: 50.6420, lng: 3.0640, importance_level: "important", importance_score: 60,
  });
  const pourToi = ANNONCES.classerPourToi([aLille], {
    now: t, interests: ["rap", "concerts"], activeZoneId: "mel", pool: "local",
    metroArea: "mel", distanceFor: () => 1200, limit: 6,
  });
  assert.equal(pourToi.length, 0,
    "imminent et à douze cents mètres : sa place est dans « Maintenant »");
});

test("étape 4 ter · imminent mais hors de portée, il reste dans « Pour toi »", () => {
  /* LE TROU QUE CETTE RÈGLE BOUCHE. Sans elle, le concert parisien quittait
     « Pour toi » pour un « Maintenant » qui le rejetait à 220 km : il
     s'évaporait entre deux espaces, exactement à l'heure où il comptait le
     plus. On ne peut pas y aller ; on peut vouloir le savoir. */
  const t = CONCERT_DEBUT - HEURE;
  const items = [concertParis()];
  assert.equal(dans(espaceMaintenant(items, t), "concert-paris"), false,
    "à 220 km, « Maintenant » n'en veut pas");
  const pourToi = espacePourToi(items, t, ["rap", "concerts"]);
  assert.equal(dans(pourToi, "concert-paris"), true,
    "il ne doit donc disparaître de nulle part");
});

test("étape 4 quater · en cours et à côté : « Maintenant », et là seulement", () => {
  const t = CONCERT_DEBUT + HEURE;
  const aLille = Object.assign(concertParis(), {
    id: "concert-proche", zone_id: "mel", metro_area: "mel",
    lat: 50.6420, lng: 3.0640,
  });
  const phase = CYCLE.phase(aLille, t);
  assert.equal(phase.phase, CYCLE.PHASES.EN_COURS);
  assert.match(phase.libelle, /En cours/);
  assert.equal(phase.urgence, 100);

  const maintenant = CORE.rankResults([aLille], {
    intent: "sortir", position: LILLE, now: t, nowOnly: true,
    categories: ["concert"], radius: 5000,
    distanceBetween: () => 1500, hierarchie: "maintenant",
  });
  assert.equal(dans(maintenant, "concert-proche"), true);
  assert.equal(maintenant[0].rankPhase, CYCLE.PHASES.EN_COURS);

  const pourToi = ANNONCES.classerPourToi([aLille], {
    now: t, interests: ["rap", "concerts"], activeZoneId: "mel", pool: "local",
    metroArea: "mel", distanceFor: () => 1500, limit: 6,
  });
  assert.equal(pourToi.length, 0, "un seul espace en parle à la fois");
});

/* -------------------------------------------------------------------- */
/*  ÉTAPE 5 — terminé                                                    */
/* -------------------------------------------------------------------- */

test("étape 5 · terminé : il sort de partout, sans exception", () => {
  neuf();
  for (let i = 0; i < 8; i += 1) A.noter("sauvegarde", "concert");
  const t = CONCERT_FIN + HEURE;
  const paris = concertParis();
  const local = concertLocal(t + 5 * JOUR);
  const items = [paris, local];

  assert.equal(CYCLE.phase(paris, t).phase, CYCLE.PHASES.TERMINE);
  assert.equal(CYCLE.phase(paris, t).urgence, 0);

  assert.equal(dans(espaceMaintenant(items, t), "concert-paris"), false);
  assert.equal(dans(espacePourToi(items, t, ["rap", "concerts"]), "concert-paris"), false);
  assert.equal(dans(espaceAvenir(items, t, A.vecteur(t), ["concerts"]), "concert-paris"), false,
    "ni l'ampleur, ni le goût, ni une case cochée ne ressuscitent un concert fini");

  /* Et la vie locale continue. */
  assert.equal(dans(espaceAvenir(items, t, A.vecteur(t), ["concerts"]), "concert-local"), true);
});

/* -------------------------------------------------------------------- */
/*  LA COHÉRENCE D'ENSEMBLE                                              */
/* -------------------------------------------------------------------- */

test("à chaque étape, un seul exemplaire et jamais deux espaces à la fois", () => {
  const etapes = [
    ["annonce", ANNONCE + 2 * HEURE],
    ["billetterie", BILLETTERIE + HEURE],
    ["J-3", CONCERT_DEBUT - 3 * JOUR],
    ["jour J", CONCERT_DEBUT - 11 * HEURE],
    ["en cours", CONCERT_DEBUT + HEURE],
    ["terminé", CONCERT_FIN + HEURE],
  ];
  etapes.forEach(([nom, t]) => {
    const items = [concertParis(), concertLocal(CONCERT_DEBUT + 30 * JOUR)];
    const maintenant = espaceMaintenant(items, t);
    const pourToi = espacePourToi(items, t, ["rap", "concerts"]);
    const avenir = espaceAvenir(items, t, null, ["concerts"]);

    [maintenant, pourToi, avenir].forEach((espace, i) => {
      const ids = espace.map((x) => x.id || x.event_id);
      assert.equal(ids.length, new Set(ids).size,
        nom + " · espace " + i + " : un même événement y figure deux fois");
    });

    /* « Maintenant » et « Pour toi » ne parlent jamais du même objet en même
       temps : l'un dit « vas-y », l'autre « retiens-le ». */
    const ici = new Set(maintenant.map((x) => x.id));
    pourToi.forEach((x) => assert.equal(ici.has(x.event_id), false,
      nom + " : « " + x.event_id + " » est annoncé dans les deux espaces"));
  });
});

test("les phases traversées sont celles du cycle, dans l'ordre, sans en sauter", () => {
  const paris = concertParis();
  const vues = [
    CYCLE.phase(paris, ANNONCE + HEURE).phase,
    CYCLE.phase(paris, BILLETTERIE - 20 * HEURE).phase,
    CYCLE.phase(paris, BILLETTERIE + HEURE).phase,
    CYCLE.phase(paris, CONCERT_DEBUT - 30 * JOUR).phase,
    CYCLE.phase(paris, CONCERT_DEBUT - 3 * JOUR).phase,
    CYCLE.phase(paris, CONCERT_DEBUT - 11 * HEURE).phase,
    CYCLE.phase(paris, CONCERT_DEBUT + HEURE).phase,
    CYCLE.phase(paris, CONCERT_FIN + HEURE).phase,
  ];
  assert.deepEqual(vues, [
    CYCLE.PHASES.ANNONCE,
    CYCLE.PHASES.BILLETTERIE_BIENTOT,
    CYCLE.PHASES.BILLETTERIE_OUVERTE,
    CYCLE.PHASES.A_VENIR,
    CYCLE.PHASES.APPROCHE,
    CYCLE.PHASES.JOUR_J,
    CYCLE.PHASES.EN_COURS,
    CYCLE.PHASES.TERMINE,
  ]);
  /* Et l'ordre suit celui du cycle déclaré : aucune phase ne revient en
     arrière au fil du temps. */
  const rangs = vues.map((p) => CYCLE.CYCLE.indexOf(p));
  rangs.forEach((r, i) => { if (i) assert.ok(r > rangs[i - 1], "retour en arrière : " + vues[i]); });
});

/* -------------------------------------------------------------------- */
/*  NON-RÉGRESSION : LES PETITS ÉVÉNEMENTS LOCAUX                        */
/* -------------------------------------------------------------------- */

test("un géant lointain n'efface pas la vie locale de « À venir »", () => {
  neuf();
  const t = BILLETTERIE + HEURE;
  const locaux = [2, 5, 9, 14].map((j, i) => Object.assign(concertLocal(t + j * JOUR),
    {id: "local-" + i, titre: "Concert de quartier " + i, title: "Concert de quartier " + i}));
  const avenir = espaceAvenir([concertParis()].concat(locaux), t, null, ["concerts"]);
  locaux.forEach((l) => assert.equal(dans(avenir, l.id), true, l.id + " a disparu"));
  assert.ok(avenir.length >= 5);
});

test("sans envie cochée ni comportement, l'ordre de « À venir » reste défendable", () => {
  neuf();
  /* Personne ne suit rien : le classement ne doit pas se mettre à préférer le
     géant parisien « par défaut ». L'ampleur joue, mais après la faisabilité,
     et le local reste présent et lisible. */
  const t = BILLETTERIE + HEURE;
  const locaux = [2, 6].map((j, i) => Object.assign(concertLocal(t + j * JOUR),
    {id: "local-" + i, titre: "Quartier " + i, title: "Quartier " + i}));
  const avenir = espaceAvenir([concertParis()].concat(locaux), t, null, null);
  locaux.forEach((l) => assert.equal(dans(avenir, l.id), true));
});

test("un petit concert local garde son cycle, comme les grands", () => {
  /* Le cycle n'est pas réservé aux événements majeurs : un vide-grenier de
     quartier à trois jours dit « dans 3 jours » comme tout le monde. */
  const t = Date.UTC(2026, 5, 1, 9, 0);
  const local = concertLocal(t + 3 * JOUR);
  const phase = CYCLE.phase(local, t);
  assert.equal(phase.phase, CYCLE.PHASES.APPROCHE);
  assert.match(phase.libelle, /Dans 3 jours/);
});

test("« Maintenant » reste local : il ne s'ouvre pas au lointain sous prétexte d'ampleur", () => {
  /* La règle produit absolue : « Maintenant » répond avec les pieds. Un
     événement majeur en cours à 220 km n'y entre pas davantage qu'un autre. */
  const t = CONCERT_DEBUT + HEURE;
  const maintenant = espaceMaintenant([concertParis()], t);
  assert.equal(dans(maintenant, "concert-paris"), false);
});
