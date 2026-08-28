/* LE CONTEXTE TERRITORIAL TEMPORAIRE — ce qui doit rester vrai

   Le premier cas réel est la Braderie de Lille. Aucun test ci-dessous ne le
   sait : ils fabriquent une manifestation quelconque, avec une fenêtre, des
   zones et des sources officielles, exactement comme la base en publiera une
   pour la Fête de la Musique ou un marathon. C'est le contrat qu'on vérifie :
   « Autour comprend qu'un territoire change temporairement », pas « Autour
   connaît la Braderie ».

   Ce fichier couvre les six garanties demandées :
     activation, géographie, temps, budget du modèle, déduplication, et la
     non-régression hors période. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../territoire.js";
import "../temporel.js";
import "../availability.js";
import "../signaux.js";
import "../core.js";
import { sourceApplicationSync } from "./source.mjs";

const T = globalThis.AutourTerritoire;
const CORE = globalThis.AutourCore;
const html = sourceApplicationSync(import.meta.url);

const h = (n) => n * 3600e3;
const j = (n) => n * 24 * 3600e3;

/* Un samedi à 14 h 30, l'instant de référence de tout ce fichier. */
const SAMEDI_1430 = Date.UTC(2026, 8, 5, 12, 30, 0);
const DEBUT = Date.UTC(2026, 8, 5, 6, 0, 0);        // samedi 08:00 Paris
const FIN = Date.UTC(2026, 8, 6, 21, 0, 0);         // dimanche 23:00 Paris
const APERCU = Date.UTC(2026, 7, 31, 22, 0, 0);     // cinq jours avant

/* Deux zones voisines, assez proches pour qu'un pas de quatre cents mètres
   fasse passer de l'une à l'autre — c'est le cas qui compte. */
const CENTRE = [50.6371, 3.0630];
const WAZEMMES = [50.6259, 3.0530];

const contexte = (extra) => T.normaliserContexte(Object.assign({
  slug: "manifestation-test",
  name: "Manifestation de test",
  emoji: "🧺",
  starts_at: DEBUT,
  ends_at: FIN,
  preview_starts_at: APERCU,
  priority: 10,
  metadata: {
    libelle: "Manifestation",
    sources_officielles: ["manif_officiel", "ville_officielle"],
    rayon_visibilite_m: 25000,
  },
  zones: [
    { slug: "centre", name: "Centre", lat: CENTRE[0], lng: CENTRE[1],
      rayon_m: 500, priorite: 10 },
    { slug: "wazemmes", name: "Wazemmes", lat: WAZEMMES[0], lng: WAZEMMES[1],
      rayon_m: 500, priorite: 30 },
  ],
}, extra || {}));

/* ==========================================================================
   1. ACTIVATION — le bouton existe quand il doit, et pas une minute de plus
   ======================================================================== */

test("avant l’aperçu, aucun bouton n’existe", () => {
  const c = contexte();
  assert.equal(T.phase(c, APERCU - h(1)), T.PHASES.ABSENT);
  assert.equal(T.bouton(c, APERCU - h(1)), null);
});

test("pendant l’aperçu, le bouton existe et dit « bientôt »", () => {
  const c = contexte();
  const b = T.bouton(c, APERCU + h(2));
  assert.equal(T.phase(c, APERCU + h(2)), T.PHASES.AVANT);
  assert.ok(b, "le bouton doit exister quelques jours avant");
  assert.equal(b.libelle, "Manifestation · bientôt");
  assert.equal(b.actif, false, "annoncer n’est pas commander");
});

test("pendant la manifestation, le bouton est pleinement actif", () => {
  const c = contexte();
  const b = T.bouton(c, SAMEDI_1430);
  assert.equal(T.phase(c, SAMEDI_1430), T.PHASES.PENDANT);
  assert.equal(b.libelle, "Manifestation");
  assert.equal(b.actif, true);
});

test("après la fin, le bouton disparaît tout seul", () => {
  const c = contexte();
  /* Le lundi suivant : rien à retirer à la main, rien à déployer. C'est la
     garantie qui évite qu'un mode événementiel survive à son événement. */
  assert.equal(T.phase(c, FIN + h(1)), T.PHASES.APRES);
  assert.equal(T.bouton(c, FIN + h(1)), null);
  assert.equal(T.bouton(c, FIN + j(2)), null);
});

test("sans aperçu déclaré, il n’y a tout simplement pas de phase d’annonce", () => {
  const c = contexte({ preview_starts_at: null });
  assert.equal(T.phase(c, DEBUT - h(1)), T.PHASES.ABSENT);
  assert.equal(T.phase(c, DEBUT + h(1)), T.PHASES.PENDANT);
});

test("une configuration incomplète ne produit aucun bouton", () => {
  /* Mieux vaut pas de bouton du tout qu'un bouton dont on ne sait pas quand il
     doit disparaître. */
  assert.equal(T.normaliserContexte({ slug: "x", starts_at: DEBUT }), null);
  assert.equal(T.normaliserContexte({ slug: "x", ends_at: FIN }), null);
  assert.equal(T.normaliserContexte({ starts_at: DEBUT, ends_at: FIN }), null);
  assert.equal(T.normaliserContexte({ slug: "x", starts_at: FIN, ends_at: DEBUT }), null,
    "une fin avant le début n’est pas une fenêtre");
});

test("hors de portée, le bouton n’a rien à annoncer", () => {
  const c = contexte();
  const rouen = [49.4432, 1.0993];
  assert.equal(T.contexteActif([c], SAMEDI_1430, rouen), null);
  /* Tourcoing, à douze kilomètres : le bouton peut exister — c'est une
     décision de produit, portée par `rayon_visibilite_m`, pas par du code. */
  assert.ok(T.contexteActif([c], SAMEDI_1430, [50.7239, 3.1612]));
});

test("le contexte le plus prioritaire l’emporte, et il n’y en a qu’un", () => {
  const a = contexte({ slug: "secondaire", priority: 90 });
  const b = contexte({ slug: "principal", priority: 5 });
  assert.equal(T.contexteActif([a, b], SAMEDI_1430, CENTRE).slug, "principal");
});

/* ==========================================================================
   2. GÉOGRAPHIE — huit mètres ne sont pas quatre cents
   ======================================================================== */

const memoire = (position, zone) => ({
  maintenant: SAMEDI_1430 - 60000, position, centre: position, zone,
  expireLe: SAMEDI_1430 + h(1),
});

/* Un déplacement de `metres` vers le nord depuis un point. */
const versLeNord = (p, metres) => [p[0] + metres / 111320, p[1]];

test("trente mètres ne déclenchent rien du tout", () => {
  const avant = memoire(CENTRE, "centre");
  const v = T.doitReevaluer(avant, {
    maintenant: SAMEDI_1430, position: versLeNord(CENTRE, 30),
    centre: versLeNord(CENTRE, 30), zone: "centre", donnees: {},
  });
  assert.equal(v.recalculer, false, "un GPS qui frissonne ne coûte rien");
  assert.equal(v.resynchroniser, false);
});

test("quatre cents mètres déclenchent une nouvelle évaluation", () => {
  const avant = memoire(CENTRE, "centre");
  const v = T.doitReevaluer(avant, {
    maintenant: SAMEDI_1430, position: versLeNord(CENTRE, 420),
    centre: versLeNord(CENTRE, 420), zone: "centre", donnees: {},
  });
  assert.equal(v.recalculer, true);
  assert.ok(v.raisons.includes(T.RAISONS.DEPLACEMENT));
});

test("changer de zone déclenche une évaluation, même sans avoir bougé loin", () => {
  const avant = memoire(CENTRE, "centre");
  const v = T.doitReevaluer(avant, {
    maintenant: SAMEDI_1430, position: versLeNord(CENTRE, 20),
    centre: versLeNord(CENTRE, 20), zone: "wazemmes", donnees: {},
  });
  assert.equal(v.recalculer, true);
  assert.ok(v.raisons.includes(T.RAISONS.ZONE));
});

test("le centre de carte compte autant que la position", () => {
  /* Quelqu'un à Tourcoing qui déplace la carte sur Wazemmes regarde
     volontairement ailleurs : c'est le point regardé qui commande. */
  const avant = memoire(CENTRE, "centre");
  const v = T.doitReevaluer(avant, {
    maintenant: SAMEDI_1430, position: CENTRE, centre: WAZEMMES,
    zone: "centre", donnees: {},
  });
  assert.equal(v.recalculer, true);
  assert.ok(v.raisons.includes(T.RAISONS.CENTRE));
});

test("un déplacement ne resynchronise JAMAIS à lui seul", () => {
  /* C'est la garantie la plus importante du mode : recalculer est local et
     gratuit, resynchroniser rappelle OpenAgenda, DATAtourisme ou le modèle.
     Un pas de quatre cents mètres ne doit pas payer le second. */
  const avant = memoire(CENTRE, "centre");
  const v = T.doitReevaluer(avant, {
    maintenant: SAMEDI_1430, position: versLeNord(CENTRE, 900),
    centre: versLeNord(CENTRE, 900), zone: "wazemmes",
    donnees: { [T.NATURES.PERIMETRE]: SAMEDI_1430 - h(1) },
  });
  assert.equal(v.recalculer, true);
  assert.equal(v.resynchroniser, false,
    "un périmètre vu il y a une heure est encore parfaitement valable");
});

test("le retour au premier plan ne réévalue qu’après une vraie absence", () => {
  const court = T.doitReevaluer(
    { maintenant: SAMEDI_1430 - 60000, position: CENTRE, centre: CENTRE, zone: "centre" },
    { maintenant: SAMEDI_1430, position: CENTRE, centre: CENTRE, zone: "centre",
      retourPremierPlan: true, donnees: {} });
  assert.equal(court.recalculer, false, "une minute d’absence ne change rien");
  const long = T.doitReevaluer(
    { maintenant: SAMEDI_1430 - h(2), position: CENTRE, centre: CENTRE, zone: "centre" },
    { maintenant: SAMEDI_1430, position: CENTRE, centre: CENTRE, zone: "centre",
      retourPremierPlan: true, donnees: {} });
  assert.equal(long.recalculer, true);
  assert.ok(long.raisons.includes(T.RAISONS.PREMIER_PLAN));
});

test("la zone se lit dans la configuration, jamais dans une liste de quartiers", () => {
  const c = contexte();
  assert.equal(T.zoneDe(CENTRE, c).slug, "centre");
  assert.equal(T.zoneDe(WAZEMMES, c).slug, "wazemmes");
  assert.equal(T.zoneDe([50.7239, 3.1612], c), null, "Tourcoing n’est dans aucune zone");
  /* Et le code ne contient pas de quartiers écrits en dur : c'est ce qui
     permet d'ajouter une manifestation sans déployer. */
  assert.doesNotMatch(html, /"wazemmes"|'wazemmes'/i,
    "aucun nom de quartier ne doit vivre dans le programme");
});

test("dans deux secteurs qui se recouvrent, c’est le plus PROCHE qui répond", () => {
  /* Trouvé sur la configuration réelle : le secteur du centre a un rayon qui
     mord sur le Vieux-Lille. Trié par priorité, quelqu’un rue de la Monnaie
     s’entendait répondre « Lille-Centre ». La priorité dit l’importance d’un
     secteur, pas où l’on se trouve. */
  const c = T.normaliserContexte({
    slug: "recouvrement", name: "Recouvrement",
    starts_at: DEBUT, ends_at: FIN,
    zones: [
      { slug: "grand-secteur", name: "Grand secteur", lat: CENTRE[0], lng: CENTRE[1],
        rayon_m: 900, priorite: 10 },
      { slug: "petit-secteur", name: "Petit secteur", lat: CENTRE[0] + 0.0065,
        lng: CENTRE[1], rayon_m: 400, priorite: 80 },
    ],
  });
  /* Au cœur du petit secteur, et pourtant dans les deux. */
  assert.equal(T.zoneDe([CENTRE[0] + 0.0065, CENTRE[1]], c).slug, "petit-secteur");
  /* Au cœur du grand, le grand répond. */
  assert.equal(T.zoneDe(CENTRE, c).slug, "grand-secteur");
});

test("un contour officiel l’emporte sur le cercle d’approximation", () => {
  const c = T.normaliserContexte({
    slug: "avec-contour", name: "Avec contour",
    starts_at: DEBUT, ends_at: FIN,
    zones: [{ slug: "rue", name: "Une rue", priorite: 10, contour: [
      [50.630, 3.050], [50.630, 3.060], [50.640, 3.060], [50.640, 3.050],
    ] }],
  });
  assert.equal(T.zoneDe([50.635, 3.055], c).slug, "rue");
  assert.equal(T.zoneDe([50.650, 3.055], c), null);
});

test("hors du périmètre, on dit la distance plutôt que de faire croire qu’on y est", () => {
  const c = contexte();
  assert.equal(T.distanceAuPerimetre(CENTRE, c), 0);
  const d = T.distanceAuPerimetre([50.7239, 3.1612], c);
  assert.ok(d > 8000, "Tourcoing est loin du périmètre : " + d);
});

/* ==========================================================================
   3. TEMPS — aucun mélange, jamais
   ======================================================================== */

test("le TTL suit la nature de l’information, pas une constante unique", () => {
  assert.ok(T.ttlDe(T.NATURES.PERIMETRE) >= j(1),
    "un périmètre ne change pas de la semaine");
  assert.ok(T.ttlDe(T.NATURES.TEMPOREL) <= 5 * 60000,
    "« se termine bientôt » ne survit pas cinq minutes");
  assert.ok(T.ttlDe(T.NATURES.PROGRAMME) > T.ttlDe(T.NATURES.TEMPOREL));
  assert.ok(T.ttlDe(T.NATURES.EQUIPEMENTS) > T.ttlDe(T.NATURES.PROGRAMME));
});

test("le plus périssable se rafraîchit d’abord", () => {
  const vieux = SAMEDI_1430 - j(30);
  const ordre = T.perimes({
    [T.NATURES.PERIMETRE]: vieux,
    [T.NATURES.EQUIPEMENTS]: vieux,
    [T.NATURES.PROGRAMME]: vieux,
    [T.NATURES.TEMPOREL]: vieux,
  }, SAMEDI_1430);
  assert.deepEqual(ordre, [T.NATURES.TEMPOREL, T.NATURES.PROGRAMME,
    T.NATURES.EQUIPEMENTS, T.NATURES.PERIMETRE]);
});

test("une information jamais vue est à chercher ; une fraîche ne l’est pas", () => {
  assert.equal(T.perime(null, T.NATURES.PROGRAMME, SAMEDI_1430), true);
  assert.equal(T.perime(SAMEDI_1430 - 60000, T.NATURES.PROGRAMME, SAMEDI_1430), false);
  assert.equal(T.perime(SAMEDI_1430 - h(1), T.NATURES.PROGRAMME, SAMEDI_1430), true);
});

/* Le moteur temporel reste seul juge : ces tests vérifient que le contexte ne
   lui désobéit pas. */
test("une activité terminée ne peut pas être remontée par le contexte", () => {
  const c = contexte();
  const fini = {
    id: "e1", titre: "Brocante vinyles", cat: "marche", isTemporary: true,
    lat: CENTRE[0], lng: CENTRE[1],
    startsAt: SAMEDI_1430 - h(6), endsAt: SAMEDI_1430 - h(1),
    source: "manif_officiel",
  };
  const classement = CORE.rankResults([fini], {
    intent: "sortir", position: CENTRE, now: SAMEDI_1430,
    categories: ["marche", "event"], radius: 5000,
    territorial: { contexte: c, zone: c.zones[0] },
  });
  assert.equal(classement.length, 0,
    "aucun bonus de contexte ne repêche un événement fini");
});

test("un événement de dimanche n’est jamais « maintenant » le samedi", () => {
  const c = contexte();
  const demain = {
    id: "e2", titre: "Concert", cat: "concert", isTemporary: true,
    lat: CENTRE[0], lng: CENTRE[1],
    startsAt: SAMEDI_1430 + j(1), endsAt: SAMEDI_1430 + j(1) + h(2),
    temporalStatus: "upcoming", source: "manif_officiel",
  };
  const classement = CORE.rankResults([demain], {
    intent: "sortir", position: CENTRE, now: SAMEDI_1430,
    categories: ["concert"], radius: 5000, nowOnly: true,
    territorial: { contexte: c, zone: c.zones[0] },
  });
  assert.equal(classement.length, 0,
    "« maintenant » ne se remplit jamais avec demain, contexte ou pas");
});

test("une période de deux jours ne rend rien actif 24 h sur 24", () => {
  /* Le piège du multi-jours : la manifestation dure du samedi au dimanche,
     ce qui ne veut pas dire qu'un stand est ouvert à 2 h 30 du matin. Sans
     heure connue, l'heure reste inconnue — et l'inconnu n'entre pas. */
  const c = contexte();
  const sansHeure = {
    id: "e3", titre: "Stand", cat: "marche", isTemporary: true,
    lat: CENTRE[0], lng: CENTRE[1],
    startsAt: DEBUT, endsAt: FIN, temporalStatus: "unknown_date",
    source: "manif_officiel",
  };
  const nuit = Date.UTC(2026, 8, 6, 0, 30, 0);       // 02:30 heure de Paris
  const classement = CORE.rankResults([sansHeure], {
    intent: "sortir", position: CENTRE, now: nuit,
    categories: ["marche"], radius: 5000, nowOnly: true,
    territorial: { contexte: c, zone: c.zones[0] },
  });
  assert.equal(classement.length, 0,
    "une date de journée ne devient pas une heure d’ouverture");
});

/* ==========================================================================
   4. LES SIGNAUX — ils ordonnent, ils ne repêchent pas
   ======================================================================== */

const evenement = (extra) => Object.assign({
  id: "x", titre: "Quelque chose", cat: "marche", isTemporary: true,
  lat: CENTRE[0], lng: CENTRE[1],
  startsAt: SAMEDI_1430 - h(1), endsAt: SAMEDI_1430 + h(3),
}, extra || {});

test("le lien au contexte se lit dans la provenance, jamais dans le titre", () => {
  const c = contexte();
  /* Le piège : donner des points à ce qui contient le mot de la manifestation
     ferait remonter une friterie qui porte ce nom, un article, ou l'édition de
     l'an dernier. */
  const parLeTitre = evenement({ titre: "Manifestation vinyles", source: "openstreetmap" });
  const parLaSource = evenement({ titre: "Vinyles", source: "manif_officiel" });
  assert.equal(T.signaux(parLeTitre, c, { maintenant: SAMEDI_1430 }).officiel, false);
  assert.equal(T.signaux(parLaSource, c, { maintenant: SAMEDI_1430 }).officiel, true);
  assert.ok(T.bonus(parLaSource, c, { maintenant: SAMEDI_1430 }) >
            T.bonus(parLeTitre, c, { maintenant: SAMEDI_1430 }));
});

test("aucune manifestation n’est nommée dans la logique", () => {
  /* La Braderie est le PREMIER CAS, pas une exception codée. Le module de
     contexte ne la connaît pas du tout ; l'application ne la connaît que dans
     la prose qui explique pourquoi ce code existe. Ni chaîne de caractères, ni
     identifiant : sinon la manifestation suivante demanderait du code. */
  const moteur = readFileSync(new URL("../territoire.js", import.meta.url), "utf8");
  [["le moteur de contexte", moteur], ["l’application", html]].forEach(([quoi, code]) => {
    assert.doesNotMatch(code, /braderie[A-Za-z0-9_]*\s?[=:(]/i,
      quoi + " ne doit porter aucun identifiant nommé d’après une manifestation");
    assert.doesNotMatch(code, /["`][^"`\n]{0,60}braderie/i,
      quoi + " ne doit porter aucune chaîne de caractères nommant une manifestation");
  });
  /* Le seul endroit où le nom a le droit d'exister est la configuration —
     c'est-à-dire des DONNÉES, corrigeables par un UPDATE. */
  const migration = readFileSync(new URL(
    "../supabase/migrations/20260822065901_contexte_territorial_braderie_lille_2026.sql",
    import.meta.url), "utf8");
  assert.match(migration, /'braderie-lille-2026'/,
    "le premier cas réel vit dans la configuration, et nulle part ailleurs");
});

test("le bonus est borné : aucune accumulation ne renverse le moteur", () => {
  const c = contexte();
  const tout = evenement({ source: "manif_officiel", contexteTerritorial: c.slug });
  const b = T.bonus(tout, c, { maintenant: SAMEDI_1430, statut: "happening_now",
                               zone: c.zones[0] });
  assert.ok(b <= T.BONUS_MAX, "le bonus doit rester borné : " + b);
  /* L'adéquation à ce qui a été demandé pèse jusqu'à 520 points dans le
     moteur. Le contexte ne doit pas pouvoir la dominer. */
  assert.ok(T.BONUS_MAX < 520);
});

test("ce qui est en cours passe devant ce qui commence bientôt", () => {
  const c = contexte();
  const enCours = T.bonus(evenement(), c, { maintenant: SAMEDI_1430, statut: "happening_now" });
  const bientot = T.bonus(evenement({ startsAt: SAMEDI_1430 + 15 * 60000,
    endsAt: SAMEDI_1430 + h(2) }), c, { maintenant: SAMEDI_1430 });
  const plusTard = T.bonus(evenement({ startsAt: SAMEDI_1430 + h(5),
    endsAt: SAMEDI_1430 + h(7) }), c, { maintenant: SAMEDI_1430 });
  assert.ok(enCours > bientot, "en cours > commence bientôt");
  assert.ok(bientot > plusTard, "commence bientôt > commence plus tard");
});

test("hors du périmètre, un objet ne touche pas le bonus de zone", () => {
  const c = contexte();
  const dedans = T.signaux(evenement(), c, { maintenant: SAMEDI_1430 });
  const dehors = T.signaux(evenement({ lat: 50.7239, lng: 3.1612 }), c,
    { maintenant: SAMEDI_1430 });
  assert.equal(dedans.dansZone, true);
  assert.equal(dehors.dansZone, false);
});

test("le contexte change la pertinence, jamais la nature", () => {
  /* Un restaurant reste un lieu, des toilettes restent un service, un métro
     reste une mobilité. Le module ne produit aucun objet et n'en retypise
     aucun : il rend des points. */
  const c = contexte();
  const resto = { id: "r", cat: "resto", titre: "Moules-frites",
                  lat: CENTRE[0], lng: CENTRE[1], ouvert: true };
  const avant = JSON.stringify(resto);
  T.bonus(resto, c, { maintenant: SAMEDI_1430 });
  assert.equal(JSON.stringify(resto), avant, "aucun objet n’est modifié");
});

/* ==========================================================================
   5. « UTILE AUTOUR DE TOI » — compact, et des services qui restent services
   ======================================================================== */

test("le bloc de services prend le plus proche de chaque famille", () => {
  const s = T.services([
    { id: "t1", cat: "toilettes", lat: CENTRE[0] + 0.001, lng: CENTRE[1] },
    { id: "t2", cat: "toilettes", lat: CENTRE[0] + 0.010, lng: CENTRE[1] },
    { id: "m1", cat: "metro", lat: CENTRE[0] + 0.002, lng: CENTRE[1] },
    { id: "a1", cat: "sante", lat: CENTRE[0] + 0.003, lng: CENTRE[1] },
  ], { position: CENTRE, rayonMax: 3000 });
  assert.deepEqual(s.map(x => x.item.id), ["t1", "m1", "a1"]);
  assert.equal(s[1].label, "Métro");
});

test("un service fermé n’aide personne, et n’apparaît pas", () => {
  const s = T.services([
    { id: "t1", cat: "toilettes", lat: CENTRE[0], lng: CENTRE[1], ouvert: false },
  ], { position: CENTRE, rayonMax: 3000 });
  assert.deepEqual(s, []);
});

test("le bloc reste compact", () => {
  const beaucoup = ["toilettes", "eau", "metro", "sante", "velo"].map((cat, i) =>
    ({ id: cat, cat, lat: CENTRE[0] + i * 0.0005, lng: CENTRE[1] }));
  assert.ok(T.services(beaucoup, { position: CENTRE, rayonMax: 3000 }).length
    <= T.MAX_SERVICES);
});

/* ==========================================================================
   6. QUI A LE DROIT D’AFFIRMER QUOI
   ======================================================================== */

test("une source tierce seule ne peut pas déclarer « ouvert maintenant »", () => {
  const c = contexte();
  assert.equal(T.peutAffirmerOuverture(["tiers"], c), false);
  assert.equal(T.peutAffirmerOuverture(["google_places"], c), false);
  assert.equal(T.peutAffirmerOuverture([], c), false);
});

test("une source officielle de la manifestation parle seule", () => {
  const c = contexte();
  assert.equal(T.peutAffirmerOuverture(["manif_officiel"], c), true);
  assert.equal(T.peutAffirmerOuverture(["openagenda"], c), true);
  assert.equal(T.rangSource("manif_officiel", c), T.RANG_SOURCE.contexte_officiel);
});

test("deux sources indépendantes valent une source autorisée", () => {
  const c = contexte();
  assert.equal(T.peutAffirmerOuverture(["openstreetmap", "datatourisme"], c), true);
  assert.equal(T.peutAffirmerOuverture(["openstreetmap", "openstreetmap"], c), false,
    "deux relevés de la même source n’en font toujours qu’un");
});

test("seules les transitions qui déplacent quelqu’un sont critiques", () => {
  assert.equal(T.changementCritique("unknown", "open"), true);
  assert.equal(T.changementCritique("open", "closed"), true);
  assert.equal(T.changementCritique("open", "permanently_closed"), true);
  assert.equal(T.changementCritique("closed", "unknown"), false);
  assert.equal(T.changementCritique("open", "open"), false);
});

/* ==========================================================================
   7. LE MODÈLE — quatre portes fermées, et il ne part rien
   ======================================================================== */

const manque = { manques: ["missingOpeningHours"], budgetRestant: 10 };

test("une donnée officielle déjà fraîche n’appelle jamais le modèle", () => {
  const v = T.enrichissementAutorise({}, Object.assign({}, manque, {
    deja: ["missingOpeningHours"], sourceOfficielle: true, maintenant: SAMEDI_1430 }));
  assert.equal(v.autorise, false);
  assert.equal(v.raison, T.REFUS.SOURCE_OFFICIELLE);
});

test("un cache encore valable n’appelle jamais le modèle", () => {
  const v = T.enrichissementAutorise({}, Object.assign({}, manque, {
    cacheExpireLe: SAMEDI_1430 + h(3), maintenant: SAMEDI_1430 }));
  assert.equal(v.autorise, false);
  assert.equal(v.raison, T.REFUS.CACHE_FRAIS);
});

test("un budget épuisé n’appelle jamais le modèle", () => {
  const v = T.enrichissementAutorise({}, { manques: ["missingOpeningHours"],
    budgetRestant: 0, maintenant: SAMEDI_1430 });
  assert.equal(v.autorise, false);
  assert.equal(v.raison, T.REFUS.BUDGET);
});

test("rien ne manque : rien à demander", () => {
  const v = T.enrichissementAutorise({}, { manques: [], budgetRestant: 10 });
  assert.equal(v.autorise, false);
  assert.equal(v.raison, T.REFUS.RIEN_NE_MANQUE);
});

test("un manque précis, un budget, aucun cache : là, et seulement là", () => {
  const v = T.enrichissementAutorise({}, Object.assign({}, manque,
    { maintenant: SAMEDI_1430 }));
  assert.equal(v.autorise, true);
  assert.deepEqual([...v.manques], ["missingOpeningHours"]);
});

test("le mode ne dépend pas du modèle", () => {
  /* Sans clé, sans quota, sans réseau vers lui : le classement reste le
     classement, et il rend toujours ses résultats. Rien dans ce chemin
     n'appelle quoi que ce soit. */
  const c = contexte();
  const enCours = evenement({ temporalStatus: "now", source: "manif_officiel" });
  const classement = CORE.rankResults([enCours], {
    intent: "sortir", position: CENTRE, now: SAMEDI_1430,
    categories: ["marche"], radius: 5000,
    territorial: { contexte: c, zone: c.zones[0] },
  });
  assert.equal(classement.length, 1, "le mode fonctionne sans enrichissement");
});

/* ==========================================================================
   8. DÉDUPLICATION — trois sources, une seule proposition
   ======================================================================== */

test("le même concert vu par trois sources ne produit qu’une proposition", () => {
  const commun = {
    cat: "concert", title: "Concert de la Grand Place",
    lat: CENTRE[0], lng: CENTRE[1], isTemporary: true,
    startsAt: SAMEDI_1430, endsAt: SAMEDI_1430 + h(2),
  };
  const items = [
    CORE.toCommonItem(Object.assign({ id: "of" }, commun), { source: "contexte_officiel" }),
    CORE.toCommonItem(Object.assign({ id: "oa" }, commun), { source: "openagenda" }),
    CORE.toCommonItem(Object.assign({ id: "dt" }, commun), { source: "datatourisme" }),
  ];
  const fusionnes = CORE.dedupeItems(items, T.distanceM);
  assert.equal(fusionnes.length, 1, "trois descriptions, un seul événement");
  assert.equal(fusionnes[0].source, "contexte_officiel",
    "c’est la description officielle qui reste à l’écran");
  assert.deepEqual(new Set(fusionnes[0].sources),
    new Set(["contexte_officiel", "openagenda", "datatourisme"]),
    "la provenance complète est conservée");
});

/* ==========================================================================
   9. OBSERVABILITÉ — des compteurs, et rien qui ressemble à une personne
   ======================================================================== */

test("les métriques demandées existent toutes", () => {
  ["territorial_mode_opened", "territorial_zone_changed", "territorial_recompute",
   "territorial_cache_hit", "territorial_cache_miss", "territorial_results_count",
   "territorial_gemini_requested", "territorial_gemini_skipped_fresh_data",
   "territorial_gemini_budget_blocked"].forEach((m) =>
    assert.ok(T.METRIQUES.includes(m), m + " doit être mesurable"));
});

test("rien d’autre qu’un compteur connu ne peut être écrit", () => {
  T.oublier();
  assert.equal(T.compter("territorial_mode_opened", 1, "centre"), true);
  /* Une phrase saisie dans Aide n'a aucun chemin pour arriver ici, et ce
     n'est pas une intention : c'est un refus. */
  assert.equal(T.compter("je cherche à manger ce soir", 1), false);
  assert.equal(T.compter("territorial_mode_opened", 1, "50.62,3.05"), true,
    "le compteur global passe…");
  const r = T.rapport();
  assert.equal(r.compteurs.territorial_mode_opened, 2);
  assert.deepEqual(Object.keys(r.zones), ["centre"],
    "…mais une position ne devient jamais une clé de zone");
  T.oublier();
});

/* ==========================================================================
   10. RÉGRESSION — hors période, Autour est exactement Autour
   ======================================================================== */

test("hors période, le classement est identique au classement sans contexte", () => {
  const c = contexte();
  const jeu = [
    { id: "a", titre: "Café", cat: "cafe", lat: CENTRE[0] + 0.001, lng: CENTRE[1], ouvert: true },
    { id: "b", titre: "Musée", cat: "musee", lat: CENTRE[0] + 0.002, lng: CENTRE[1], ouvert: true },
    { id: "d", titre: "Brocante", cat: "marche", lat: CENTRE[0], lng: CENTRE[1],
      isTemporary: true, temporalStatus: "now",
      startsAt: SAMEDI_1430 - h(1), endsAt: SAMEDI_1430 + h(2), source: "manif_officiel" },
  ];
  const base = { intent: "sortir", position: CENTRE, now: FIN + j(3),
                 categories: ["cafe", "musee", "marche"], radius: 5000 };
  const sans = CORE.rankResults(jeu, base);
  /* Le lundi suivant, `contexteTerritorialClassement()` rend `null` : c'est
     littéralement le même appel. */
  const apres = CORE.rankResults(jeu, Object.assign({}, base, { territorial: null }));
  assert.deepEqual(apres.map((x) => x.id), sans.map((x) => x.id));
  assert.deepEqual(apres.map((x) => x.rankScore), sans.map((x) => x.rankScore));
  assert.equal(T.bouton(c, FIN + j(3)), null);
});

test("le contexte ne fait jamais passer un mauvais résultat devant un bon", () => {
  const c = contexte();
  /* Un lieu FERMÉ, officiellement lié à la manifestation et dans la zone
     prioritaire, contre un lieu ouvert sans aucun lien. La faisabilité est le
     premier critère de tri du moteur ; aucun bonus de score ne la traverse. */
  const jeu = [
    { id: "ferme", titre: "Stand fermé", cat: "marche", lat: CENTRE[0], lng: CENTRE[1],
      ouvert: false, source: "manif_officiel", contexteTerritorial: c.slug },
    { id: "ouvert", titre: "Café ouvert", cat: "cafe", lat: CENTRE[0] + 0.004,
      lng: CENTRE[1], ouvert: true, source: "openstreetmap" },
  ];
  const classement = CORE.rankResults(jeu, {
    intent: "sortir", position: CENTRE, now: SAMEDI_1430,
    categories: ["marche", "cafe"], radius: 5000,
    territorial: { contexte: c, zone: c.zones[0] },
  });
  assert.equal(classement[0].id, "ouvert",
    "ouvert et sans lien passe devant fermé et officiel");
});

/* ==========================================================================
   11. LE CÂBLAGE — ce que l'application doit réellement faire
   ======================================================================== */

test("le module est chargé par la page, avec son empreinte", () => {
  assert.match(html, /<script src="territoire\.js\?v=[a-f0-9]{8}" defer><\/script>/);
});

test("le bouton se pose à côté de « ⚡ Maintenant », pas ailleurs", () => {
  assert.match(html, /function besoinsDuMoment\(\)\{/);
  assert.match(html, /const apresMaintenant = rapides\.findIndex\(x=>x\.id === "maintenant"\);/);
  assert.match(html, /besoinsDuMoment\(\)\.map\(b=>\{/);
});

test("le contexte entre dans le moteur existant, pas dans un second", () => {
  /* Un seul score, un seul classement : `territorial` est un paramètre de
     `rankResults`, comme la saison. */
  const appels = html.match(/territorial:contexteTerritorialClassement\(\),/g) || [];
  assert.ok(appels.length >= 3,
    "recommandations, feuille et aide doivent tous recevoir le contexte");
  assert.doesNotMatch(html, /function rankTerritorial|rankResultsTerritorial/,
    "aucun second moteur de classement");
});

test("Aide reste le système Aide", () => {
  /* Pas d'« Aide Braderie » : le contexte fait seulement remonter les
     structures temporaires dans l'Aide existante, par la même ontologie. */
  assert.doesNotMatch(html, /AIDE_TERRITORIAL|aideTerritoriale|BESOINS_BRADERIE/);
});

test("le déplacement de carte demande au module, il ne décide pas lui-même", () => {
  assert.match(html, /reevaluerTerritorial\(\);/);
  assert.match(html, /const verdict = TERR\.doitReevaluer\(etatTerritorial, courant\);/);
  assert.match(html, /if\(verdict\.resynchroniser\) void chargerContextesTerritoriaux\(\);/);
});

test("la lecture du contexte ne bloque jamais un rendu", () => {
  const bloc = /function chargerContextesTerritoriaux\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /lireCacheContextes\(\)/, "le cache sert avant le réseau");
  assert.match(bloc, /console\.error\("Contextes territoriaux :"/,
    "une lecture en échec ne fait rien apparaître, et ne casse rien");
});

/* ==========================================================================
   12. LA CONFIGURATION — des données, pas un catalogue
   ======================================================================== */

/* La migration d'origine a été appliquée en production en TROIS temps —
   le schéma, le premier cas de configuration, puis le budget et les métriques.
   Le dépôt porte désormais ces trois versions telles qu'elles ont réellement
   été jouées ; les vérifications ci-dessous portent sur leur somme. */
const migration = [
  "20260822065827_contexte_territorial_temporaire_schema",
  "20260822065901_contexte_territorial_braderie_lille_2026",
  "20260822065956_contexte_territorial_budget_metriques_sante",
].map((nom) => readFileSync(
  new URL("../supabase/migrations/" + nom + ".sql", import.meta.url), "utf8")).join("\n");

test("la configuration porte exactement ce qui a été demandé", () => {
  const contexte = /create table if not exists public\.territorial_contexts \([\s\S]*?\n\);/
    .exec(migration)[0];
  ["slug", "name", "emoji", "starts_at", "ends_at", "preview_starts_at",
   "timezone", "territory_id", "active", "priority", "official_url", "metadata"]
    .forEach((c) => assert.match(contexte, new RegExp("\\n  " + c + "\\s"), c + " manque"));

  const zones = /create table if not exists public\.territorial_context_zones \([\s\S]*?\n\);/
    .exec(migration)[0];
  ["context_id", "slug", "name", "priority", "metadata"]
    .forEach((c) => assert.match(zones, new RegExp("\\n  " + c + "\\s"), c + " manque"));
});

test("aucun second catalogue d’événements n’est créé", () => {
  /* C'est la règle absolue : les événements restent dans `events` et
     `event_occurrences`, avec les mêmes règles de vérité et la même
     déduplication. Le contexte dit seulement ce qui compte davantage. */
  const tables = [...migration.matchAll(/create table if not exists public\.([a-z_]+)/g)]
    .map((m) => m[1]);
  assert.deepEqual(tables.sort(), [
    "enrichment_usage_daily", "territorial_context_zones",
    "territorial_contexts", "territorial_metrics_daily",
  ]);
  assert.doesNotMatch(migration, /create table[^;]*\b(events|event_occurrences|publications)\b/);
});

test("un visiteur non connecté lit le contexte, et il ne le lit que dans sa fenêtre", () => {
  /* Le mode doit être utilisable INTÉGRALEMENT sans compte : la lecture est
     ouverte à `anon`. Et elle est bornée à la fenêtre, pour que le bouton ne
     puisse pas être fabriqué depuis le navigateur hors période. */
  assert.match(migration, /create policy "contextes: lecture dans la fenêtre"[\s\S]*?to anon, authenticated/);
  assert.match(migration, /now\(\) >= coalesce\(preview_starts_at, starts_at\)/);
  assert.match(migration, /now\(\) < ends_at/);
  assert.match(migration, /grant execute on function public\.contextes_territoriaux[\s\S]{0,120}to anon, authenticated;/);
  /* Et l'écriture n'est ouverte à personne. */
  assert.match(migration, /revoke insert, update, delete on public\.territorial_contexts from anon, authenticated;/);
});

test("le budget est réservé avant l’appel, et ne se rend jamais", () => {
  const table = /create table if not exists public\.enrichment_usage_daily \([\s\S]*?\n\);/
    .exec(migration)[0];
  ["day", "requested", "launched", "successful", "failed"]
    .forEach((c) => assert.match(table, new RegExp("\\n  " + c + "\\s"), c + " manque"));
  /* L'atomicité tient à UN SEUL UPDATE conditionnel : c'est le verrou de ligne
     qui empêche dix requêtes simultanées de lire toutes « 399 ». */
  assert.match(migration, /update public\.enrichment_usage_daily u\s*\n\s*set launched = u\.launched \+ 1[\s\S]*?where u\.day = jour and u\.launched < limite/);
  assert.match(migration, /return query select false, coalesce\(v_lances, 0\), limite;/);
  /* La clôture consigne l'issue, elle ne rend pas de budget : un appel payé
     reste payé, qu'il ait trouvé ou non. */
  const cloture = /create or replace function public\.cloturer_enrichissement[\s\S]*?\$function\$;/
    .exec(migration)[0];
  assert.doesNotMatch(cloture, /launched = /,
    "clôturer ne doit jamais décrémenter ce qui a été lancé");
});

test("les métriques ne peuvent porter que des compteurs connus", () => {
  const rpc = /create or replace function public\.compter_metrique_territoriale[\s\S]*?\$function\$;/
    .exec(migration)[0];
  T.METRIQUES.forEach((m) => assert.ok(rpc.includes("'" + m + "'"), m + " doit être accepté"));
  /* Une liste fermée, un slug, un entier borné : rien d'autre n'a de chemin
     jusqu'à cette table. Pas de phrase, pas d'identifiant, pas de position. */
  assert.match(rpc, /if p_metrique not in \(/);
  assert.match(rpc, /if contexte !~ '\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$' then return; end if;/);
  assert.match(rpc, /least\(greatest\(coalesce\(p_valeur, 1\), 1\), 1000\)/);
  const table = /create table if not exists public\.territorial_metrics_daily \([\s\S]*?\n\);/
    .exec(migration)[0];
  assert.doesNotMatch(table, /user_id|texte|phrase|message|lat |lng /,
    "aucune donnée personnelle n’a sa place ici");
});

test("le préchauffage existe, et rien ne le déclenche tout seul", () => {
  /* Il dépense du budget de vérification : le planifier serait décider d'une
     dépense à la place de quelqu'un. La fonction existe, la décision reste
     humaine. */
  assert.match(migration, /create or replace function private\.prechauffer_contexte/);
  assert.match(migration, /create or replace function private\.candidats_prechauffage/);
  assert.doesNotMatch(migration, /cron\.schedule/,
    "aucun cron ne doit dépenser du budget sans qu’on l’ait demandé");
  /* Et surtout : aucun secret ne descend dans le navigateur, `verify_jwt`
     n'est pas désactivée. C'est le serveur qui présente la clé du Vault. */
  assert.match(migration, /from vault\.decrypted_secrets/);
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.enrichir-lieu\][\s\S]*?verify_jwt = true/);
});

test("la santé de chaque source est lisible, et reste privée", () => {
  assert.match(migration, /create or replace function public\.sante_sources_evenements/);
  assert.match(migration, /dernier_succes\s+timestamptz/);
  assert.match(migration, /dernier_echec\s+timestamptz/);
  assert.match(migration, /revoke all on function public\.sante_sources_evenements\(\) from public, anon, authenticated;/);
});

test("le premier cas réel est une ligne de données, corrigeable par un UPDATE", () => {
  assert.match(migration, /insert into public\.territorial_contexts \(/);
  assert.match(migration, /on conflict \(slug\) do update set/,
    "une date qui change doit se corriger sans migration");
  /* Les zones aussi : le périmètre officiel remplacera l'approximation par un
     simple UPDATE du contour. */
  assert.match(migration, /'approximation_centre_rayon'/);
  assert.match(migration, /on conflict \(context_id, slug\) do update set/);
});

/* ==========================================================================
   13. LA BASCULE QUI DÉPLACE QUELQU'UN
   ======================================================================== */

test("une source tierce ne peut pas faire passer un lieu de inconnu à ouvert", () => {
  /* Le défaut : seule la fermeture DÉFINITIVE était retirée quand la
     provenance ne suffisait pas. Un agrégateur pouvait donc encore écrire
     `current_status: "open"` — et « open » est précisément le mot qui fait
     entrer dans « Maintenant » un lieu dont Autour ne connaît aucun horaire.
     Une source tierce obtenait ainsi, seule, le pouvoir d'envoyer quelqu'un
     marcher vingt minutes vers une porte peut-être close. */
  const extraction = readFileSync(new URL(
    "../supabase/functions/enrichir-lieu/extraction.mjs", import.meta.url), "utf8");
  const bloc = /if \(!peutEcraserOsm\(priorite, confiance\)\) \{[\s\S]*?\n  \}/.exec(extraction)[0];
  assert.match(bloc, /fait\.current_status = "unknown";/,
    "aucun statut affirmé ne survit à une provenance insuffisante");
  assert.doesNotMatch(bloc, /=== "permanently_closed"\s*\n?\s*\? "unknown"/,
    "la règle ne doit plus porter sur la seule fermeture définitive");
  /* Et les provenances autorisées restent celles qui appartiennent au lieu ou
     à une institution — jamais un agrégateur. */
  assert.match(extraction,
    /AUTORISEES_A_ECRASER = new Set\(\[\s*\n?\s*"site_officiel", "agenda_officiel", "billetterie_officielle", "institutionnel",/);
});

test("« Maintenant » ne fait entrer un statut vérifié que s’il vient d’être vérifié", () => {
  /* Le calque n'entre dans la décision que FRAIS : un « ouvert » d'il y a trois
     jours est un souvenir, pas un état. */
  const client = readFileSync(new URL("../enrichissements.js", import.meta.url), "utf8");
  assert.match(client, /const frais = e\.expires_at \? Date\.parse\(e\.expires_at\) > Date\.now\(\) : false;/);
  assert.match(client, /if\(frais\)\{\s*\n\s*if\(e\.current_status && e\.current_status !== "unknown"\)\{/);
});

/* ==========================================================================
   14. LE TEMPS QUI PASSE PENDANT QU'ON REGARDE
   ======================================================================== */

test("le mode ouvert bat au rythme de l’information la plus périssable", () => {
  /* « Se termine à 15 h » devient faux à 15 h, que la carte ait bougé ou non.
     Le battement n'existe QUE pendant que le mode est ouvert et que quelqu'un
     regarde — et il ne fait que recalculer. */
  assert.match(html, /battementTerritorial = setInterval\(\(\)=>\{/);
  assert.match(html, /\}, TERR\.TTL\[TERR\.NATURES\.TEMPOREL\]\);/,
    "la période vient du module, pas d’un nombre écrit dans app.js");
  const bloc = /function reglerBattementTerritorial\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /document\.visibilityState !== "hidden"/,
    "recalculer pour un écran que personne ne regarde coûterait une batterie");
  assert.match(bloc, /modeTerritorial && !!contexteTerritorial/);
  /* Et il ne rappelle personne : c'est `reevaluerTerritorial` qui décide, et
     lui seul sait séparer recalcul et resynchronisation. */
  const tick = /battementTerritorial = setInterval\(\(\)=>\{[\s\S]*?\}, TERR\.TTL/.exec(html)[0];
  assert.doesNotMatch(tick, /chargerZone|chargerDonneesTemporaires|fetch\(/,
    "un battement ne déclenche aucune requête");
});

test("le mode se referme tout seul quand le contexte cesse d’exister", () => {
  /* Minuit passe, la manifestation se termine, l'application était ouverte :
     rien à retirer à la main. */
  const bloc = /function majContexteTerritorial\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /if\(!contexteTerritorial && modeTerritorial\)\{/);
  assert.match(bloc, /modeTerritorial = false;/);
});
