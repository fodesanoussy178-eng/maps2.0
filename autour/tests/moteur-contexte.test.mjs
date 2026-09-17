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
await import("../contexte-moteur.js");
await import("../core.js");

const A = globalThis.AutourApprentissage;
const P = globalThis.AutourPertinence;
const C = globalThis.AutourContexteMoteur;
const CORE = globalThis.AutourCore;

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

/* Ce que le lot A peut déjà tenir. Les phases de billetterie — annonce,
   prévente, ouverture, J-3, jour J — sont le lot B et s'ajouteront ici. */

const CONCERT_PARIS = {
  id: "concert-paris", titre: "Artiste X — Paris La Défense Arena",
  cat: "concert", isTemporary: true,
  lat: 48.8938, lng: 2.2297,
  startsAt: now + 90 * JOUR, endsAt: now + 90 * JOUR + 3 * HEURE,
  date_confidence: "exact",
  importance_level: "major", importance_score: 95,
  music_genres: ["rap"], announcement_tags: ["concert", "rap", "artist_x"],
  avis: 0,
};

test("un immense concert lointain n'entre jamais dans « Maintenant »", () => {
  neuf();
  for (let i = 0; i < 8; i += 1) A.noter("sauvegarde", "concert");
  const local = lieu({cat: "cafe", titre: "Café du coin"});
  const sortie = CORE.rankResults([CONCERT_PARIS, local], {
    intent: "sortir", position: [50.63, 3.06], now, nowOnly: true,
    categories: ["cafe", "concert"], interets: A.vecteur(now),
    envies: ["concerts", "rap"], hierarchie: "maintenant",
  });
  assert.ok(!sortie.some((x) => x.id === "concert-paris"),
    "« Maintenant » veut dire maintenant — ni l'ampleur, ni le goût, ni une case cochée n'y changent rien");
});

test("le même concert passe devant dans « Pour toi », et sait dire pourquoi", () => {
  neuf();
  for (let i = 0; i < 8; i += 1) A.noter("sauvegarde", "concert");
  /* Un petit concert local, plus proche et plus tôt. Dans « Pour toi », la
     personne passe avant les kilomètres : l'artiste suivi doit gagner. */
  const petit = {
    id: "petit-concert", titre: "Scène ouverte du quartier", cat: "concert",
    isTemporary: true, lat: 50.6305, lng: 3.0605,
    startsAt: now + 3 * JOUR, endsAt: now + 3 * JOUR + 2 * HEURE,
    date_confidence: "exact", importance_level: "local", avis: 0,
  };
  const sortie = CORE.rankResults([petit, CONCERT_PARIS], {
    intent: "sortir", position: [50.63, 3.06], now,
    categories: ["concert"], radius: 400e3,
    interets: A.vecteur(now), envies: ["concerts", "rap"], hierarchie: "pourtoi",
  });
  assert.equal(sortie[0].id, "concert-paris",
    "à 220 km, mais c'est l'artiste qu'elle suit et l'événement est majeur");
  assert.ok(sortie.some((x) => x.id === "petit-concert"),
    "le local ne disparaît pas pour autant");
});

test("la popularité brute n'écrase pas la personnalisation", () => {
  neuf();
  for (let i = 0; i < 8; i += 1) A.noter("sauvegarde", "concert");
  /* Un lieu très noté, très proche, très ouvert — et sans rapport avec ce que
     la personne suit. Il ne doit pas passer devant le concert suivi dans
     « Pour toi ». Ce n'est pas une règle qui interdit aux avis de compter :
     c'est leur place dans l'ordre. */
  const celebre = lieu({titre: "Brasserie très notée", cat: "cafe", note: 4.9, avis: 12000});
  const sortie = CORE.rankResults([celebre, CONCERT_PARIS], {
    intent: "sortir", position: [50.63, 3.06], now,
    categories: ["cafe", "concert"], radius: 400e3,
    interets: A.vecteur(now), envies: ["concerts"], hierarchie: "pourtoi",
  });
  assert.equal(sortie[0].id, "concert-paris");
});
