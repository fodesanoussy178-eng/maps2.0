import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../maintenant.js";
import { sourceApplicationSync } from "./source.mjs";

const M = globalThis.AutourMaintenant;
const html = sourceApplicationSync(import.meta.url);

const T = Date.UTC(2026, 7, 14, 20, 0, 0);          // l'instant de référence
const ICI = [50.6292, 3.0573];
const h = (n) => n * 3600e3;

/* Un événement parfaitement fiable : en cours, daté des deux côtés, à 300 m.
   Chaque cas ci-dessous n'en change QU'UNE chose — c'est ce qui permet de dire
   quel critère a refusé. */
const bon = (extra) => Object.assign({
  id: "e1", estEvenement: true, annule: false,
  enCours: true, dateIncertaine: false,
  debutLe: T - h(1), finLe: T + h(1),
  lat: 50.6312, lng: 3.0573, ferme: false,
}, extra || {});

const ctx = (extra) => Object.assign({
  maintenant: T, position: ICI, positionConnue: true,
  positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false,
}, extra || {});

/* ==========================================================================
   1. LA RÈGLE TEMPORELLE, MOT POUR MOT

   `start_at <= NOW() AND end_at >= NOW()`. Rien d'autre n'entre.
   ======================================================================== */

test("un événement commencé et non terminé entre", () => {
  const v = M.fiable(bon(), ctx());
  assert.equal(v.retenu, true, v.raison);
});

test("un événement qui n'a pas commencé n'entre jamais", () => {
  for (const dans of [h(0.1), h(1), h(24), h(24 * 30)]) {
    const v = M.fiable(bon({ debutLe: T + dans, finLe: T + dans + h(2) }), ctx());
    assert.equal(v.retenu, false, "commence dans " + dans / 3600e3 + " h");
    assert.equal(v.raison, M.RAISONS.PAS_COMMENCE);
  }
});

test("un événement terminé n'entre jamais", () => {
  const v = M.fiable(bon({ debutLe: T - h(4), finLe: T - h(1) }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.DEJA_FINI);
});

test("les bornes sont inclusives, comme l'écrit la règle", () => {
  // start_at <= NOW() : un événement qui commence à la seconde près est en cours
  assert.equal(M.fiable(bon({ debutLe: T, finLe: T + h(1) }), ctx()).retenu, true);
  // end_at >= NOW() : celui qui finit à la seconde près l'est encore
  assert.equal(M.fiable(bon({ debutLe: T - h(1), finLe: T }), ctx()).retenu, true);
});

test("une heure de fin absente n'est jamais inventée", () => {
  /* Sans fin, on ne sait pas si c'est encore en cours. « On ne sait pas » ne
     rentre pas dans « Maintenant » — c'est ce qui y mettait des événements
     terminés depuis des heures. */
  for (const fin of [null, undefined, NaN, ""]) {
    const v = M.fiable(bon({ finLe: fin }), ctx());
    assert.equal(v.retenu, false, JSON.stringify(fin));
    assert.equal(v.raison, M.RAISONS.SANS_FIN);
  }
});

test("une date incertaine n'entre jamais", () => {
  const v = M.fiable(bon({ dateIncertaine: true }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.DATE_INCERTAINE);
  // et un début absent, même dit « en cours », reste incertain
  assert.equal(M.fiable(bon({ debutLe: null }), ctx()).raison, M.RAISONS.DATE_INCERTAINE);
});

test("le verdict du moteur temporel fait autorité, et il n'est pas contourné", () => {
  /* Même parfaitement daté dans la fenêtre, un événement que le moteur ne dit
     pas « en cours » n'entre pas : c'est lui qui connaît le fuseau, les
     annulations et les récurrences.

     Et le VOCABULAIRE ne vit pas ici : une première version comparait la
     chaîne « now » alors que le moteur dit « happening_now ». Le bloc restait
     vide en permanence, et les tests ne le voyaient pas puisqu'ils employaient
     le même mot inventé. On transmet donc un booléen. */
  const v = M.fiable(bon({ enCours: false }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.PAS_EN_COURS);
});

test("un événement annulé n'entre jamais", () => {
  const v = M.fiable(bon({ annule: true }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.ANNULE);
});

test("un lieu permanent n'est pas un événement en cours", () => {
  const v = M.fiable(bon({ estEvenement: false }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.PAS_UN_EVENEMENT);
});

/* ==========================================================================
   2. LE LIEU, LA DISTANCE, LA POSITION
   ======================================================================== */

test("un lieu qu'on SAIT fermé n'entre pas", () => {
  const v = M.fiable(bon({ ferme: true }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.FERME);
});

test("un horaire inconnu n'écarte pas — sinon le bloc serait vide pour rien", () => {
  /* La plupart des lieux OpenStreetMap n'ont aucune donnée d'ouverture. On
     n'écarte que ce qu'on sait fermé, jamais ce qu'on ignore. */
  for (const ferme of [undefined, null, false]) {
    assert.equal(M.fiable(bon({ ferme }), ctx()).retenu, true, String(ferme));
  }
});

test("au-delà d'une distance raisonnable, « autour de toi » devient faux", () => {
  const loin = bon({ lat: 50.75, lng: 3.0573 });        // ~13 km
  const v = M.fiable(loin, ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.TROP_LOIN);
  // et le rayon est réglable, pour les tests comme pour un futur réglage
  assert.equal(M.fiable(loin, ctx({ rayonMax: 20000 })).retenu, true);
});

test("sans position valide, rien n'est fiable — et ce n'est pas un vide", () => {
  for (const pos of [null, undefined, [], [NaN, 3], ["a", "b"]]) {
    const v = M.fiable(bon(), ctx({ position: pos }));
    assert.equal(v.retenu, false, JSON.stringify(pos));
    assert.equal(v.raison, M.RAISONS.POSITION_INCONNUE);
  }
});

/* ==========================================================================
   3. LA SÉLECTION : TROIS AU PLUS, JAMAIS COMPLÉTÉE
   ======================================================================== */

const aDistance = (metres, extra) =>
  bon(Object.assign({ lat: ICI[0] + metres / 111320, lng: ICI[1] }, extra || {}));

test("au plus trois, même quand il y en a dix", () => {
  const dix = Array.from({ length: 10 }, (_, i) =>
    aDistance(100 + i * 50, { id: "e" + i }));
  assert.equal(M.selection(dix, ctx()).length, 3);
  assert.equal(M.total(dix, ctx()), 10, "le total, lui, dit la vérité");
});

test("le plus proche d'abord", () => {
  const liste = [aDistance(900, { id: "loin" }), aDistance(120, { id: "pres" }),
                 aDistance(400, { id: "moyen" })];
  assert.deepEqual(M.selection(liste, ctx()).map((x) => x.id),
    ["pres", "moyen", "loin"]);
});

test("à distance égale, celui qui finit le plus tôt passe devant", () => {
  // c'est celui qu'on risque de manquer
  const liste = [
    aDistance(200, { id: "tard", finLe: T + h(3) }),
    aDistance(200, { id: "bientot", finLe: T + h(1) }),
  ];
  assert.deepEqual(M.selection(liste, ctx()).map((x) => x.id), ["bientot", "tard"]);
});

test("on ne complète JAMAIS jusqu'à trois", () => {
  /* Trois emplacements réservés invitent à les remplir. Mettre un événement
     de demain parce qu'il reste une ligne vide, c'est envoyer quelqu'un
     devant une porte fermée. */
  const unSeulFiable = [
    aDistance(200, { id: "vrai" }),
    aDistance(300, { id: "demain", debutLe: T + h(20), finLe: T + h(22) }),
    aDistance(300, { id: "fini", debutLe: T - h(5), finLe: T - h(2) }),
    aDistance(300, { id: "sansdate", dateIncertaine: true }),
    aDistance(300, { id: "annule", annule: true }),
  ];
  const choisis = M.selection(unSeulFiable, ctx());
  assert.equal(choisis.length, 1);
  assert.equal(choisis[0].id, "vrai");
});

test("aucun événement fiable rend une liste vide, pas un remplissage", () => {
  const aucun = [aDistance(300, { id: "demain", debutLe: T + h(20), finLe: T + h(22) })];
  assert.deepEqual(M.selection(aucun, ctx()), []);
  assert.equal(M.total(aucun, ctx()), 0);
});

test("« Ce soir » parcourt les couches dans l'ordre et sonde l'heure du soir", () => {
  const soirDebut = T;
  const soirFin = T + h(4);
  const consultation = T - h(12); // le matin : open_now serait faux ici
  const appels = [];
  const items = [
    bon({id:"evenement", debutLe:soirDebut + h(1), finLe:soirDebut + h(2)}),
    bon({id:"seance", nature:"session", session:true,
      debutLe:soirDebut + h(1.5), finLe:soirDebut + h(2.5)}),
    lieu({id:"cinema", categorie:"cinema", lat:ICI[0] + 400 / 111320}),
    lieu({id:"restaurant", categorie:"resto", lat:ICI[0] + 500 / 111320}),
    lieu({id:"supermarche", categorie:"supermarche", lat:ICI[0] + 100 / 111320}),
  ];
  const choix = M.selectionCeSoir(items, {
    maintenant: consultation, position: ICI, positionConnue:true, rayonMax:3000,
    soirDebut, soirFin, places:3,
    disponibilite:(item, instant) => {
      appels.push({id:item.id, instant});
      return {status:"open", isOpenNow:true};
    },
  });
  assert.deepEqual(choix.map((x) => x.id), ["evenement", "seance", "cinema"]);
  assert.ok(appels.length > 0);
  assert.ok(appels.every((appel) => appel.instant === soirDebut),
    "les horaires doivent être évalués pendant la plage du soir");
  assert.ok(!appels.some((appel) => appel.id === "supermarche"),
    "les commerces utilitaires sont exclus du fallback éditorial");
});

test("« Ce soir » retombe sur un lieu pertinent, sans transformer l'inconnu en ouvert", () => {
  const soirDebut = T;
  const soirFin = T + h(4);
  const appels = [];
  const choix = M.selectionCeSoir([
    lieu({id:"inconnu", categorie:"resto"}),
    lieu({id:"pharmacie", categorie:"pharmacie"}),
    lieu({id:"bar", categorie:"bar", lat:ICI[0] + 500 / 111320}),
  ], {
    maintenant:T - h(12), position:ICI, positionConnue:true, rayonMax:3000,
    soirDebut, soirFin,
    disponibilite:(item, instant) => {
      appels.push({id:item.id, instant});
      return item.id === "inconnu" ? {status:"unknown"} : {status:"open"};
    },
  });
  assert.deepEqual(choix.map((x) => x.id), ["bar"]);
  assert.ok(appels.every((appel) => appel.instant === soirDebut));
  assert.ok(!choix.some((x) => x.id === "pharmacie"));
});

/* ==========================================================================
   4. LES QUATRE ÉTATS

   L'ordre des questions est le fond du sujet : une géolocalisation refusée
   s'affichait comme « rien autour de toi », et quelqu'un en concluait que son
   quartier était vide alors qu'Autour ignorait où il était.
   ======================================================================== */

test("les quatre états existent, et seulement eux", () => {
  assert.deepEqual(Object.values(M.ETATS).sort(),
    ["empty", "error", "loading", "ready"]);
});

test("pendant la géolocalisation : loading", () => {
  assert.equal(M.etat(ctx({ resultats: 0, positionEnCours: true, positionConnue: false })),
    M.ETATS.LOADING);
});

test("pendant la collecte des données : loading", () => {
  assert.equal(M.etat(ctx({ resultats: 0, chargement: true })), M.ETATS.LOADING);
});

test("des résultats fiables : ready", () => {
  assert.equal(M.etat(ctx({ resultats: 2 })), M.ETATS.READY);
});

test("rien de fiable, mais tout a répondu : empty", () => {
  assert.equal(M.etat(ctx({ resultats: 0 })), M.ETATS.EMPTY);
});

test("une géolocalisation refusée n'est JAMAIS lue comme un vide", () => {
  /* Le défaut qui a coûté le plus cher : « rien autour de toi » affiché à
     quelqu'un dont on ignorait la position. Ce n'est pas une réponse, c'est
     une question sans réponse. */
  const refuse = M.etat(ctx({ resultats: 0, positionRefusee: true, positionConnue: false }));
  assert.equal(refuse, M.ETATS.ERROR);
  assert.notEqual(refuse, M.ETATS.EMPTY);
  // et le texte le dit avec ses propres mots
  const mots = M.textes(refuse, ctx({ positionRefusee: true }));
  assert.match(mots.ligne, /ne sait pas où tu es/);
  assert.ok(mots.sortie, "une sortie est toujours proposée");
});

test("une panne technique n'est jamais lue comme un vide non plus", () => {
  const panne = M.etat(ctx({ resultats: 0, panne: true }));
  assert.equal(panne, M.ETATS.ERROR);
  assert.match(M.textes(panne, ctx()).ligne, /Impossible/);
});

test("des résultats l'emportent sur une panne partielle", () => {
  // une source en panne pendant qu'une autre a répondu n'efface pas ce qu'on a
  assert.equal(M.etat(ctx({ resultats: 2, panne: true })), M.ETATS.READY);
  assert.equal(M.etat(ctx({ resultats: 2, chargement: true })), M.ETATS.READY);
  assert.equal(M.etat(ctx({ resultats: 1, positionRefusee: true })), M.ETATS.READY);
});

test("aucun texte d'état ne parle de code, de source ni de statut", () => {
  for (const [id, t] of Object.entries(M.TEXTES)) {
    const tout = (t.titre + " " + t.ligne + " " + (t.sortie || "")).toLowerCase();
    for (const jargon of ["erreur 5", "http", "api", "overpass", "supabase",
                          "statut", "timeout", "null", "undefined"]) {
      assert.ok(!tout.includes(jargon), id + " ne doit pas dire « " + jargon + " »");
    }
  }
});

/* ==========================================================================
   5. LE PARCOURS D'OUVERTURE

   L'utilisateur ne doit pas avoir à appuyer sur « Maintenant » : le créneau
   est déjà celui-là au démarrage, et le bloc se rend tout seul.
   ======================================================================== */

test("« Maintenant » est le créneau d'ouverture, sans geste", () => {
  assert.match(html, /let creneau = "maintenant";/);
  // le bloc est posé dans le corps de l'accueil, pas derrière un bouton
  assert.match(html, /blocMaintenantAccueil\(\)\+/);
});

test("le bouton sert à rouvrir ou actualiser, pas à obtenir la première fois", () => {
  // l'onglet existe et il est actif au départ
  assert.match(html, /data-creneau="'\+c\.id\+'"/);
  assert.match(html, /\(c\.id===creneau\?' actif':''\)/);
  // et « Maintenant » est le premier créneau de la liste
  assert.match(html, /CRENEAUX\s*=/);
});

test("l'application délègue la sélection au module, sans la refaire", () => {
  assert.match(html, /function selectionMaintenant\(\)\{/);
  assert.match(html, /M\.selection\(itemsMaintenant\(ctx\), ctx\)/);
  assert.match(html, /M\.total\(/);
  assert.match(html, /M\.etat\(Object\.assign\(\{resultats:liste\.length\}, ctx\)\)/);
  // un seul contexte par rendu : deux calculs séparés finissent par diverger
  assert.match(html, /function contexteMaintenant\(\)\{/);
});

test("le statut temporel vient du moteur, il n'est pas recalculé", () => {
  const versItem = html.slice(html.indexOf("function versItemMaintenant"),
                              html.indexOf("function contexteMaintenant"));
  assert.match(versItem, /enCours: TEMPS\.estMaintenant\(statut\)/,
    "le vocabulaire des statuts appartient à temporel.js, pas à maintenant.js");
  assert.match(versItem, /ferme:estFerme\(l\)/);
});

test("chaque état vide propose une sortie, jamais une impasse", () => {
  assert.match(html, /data-mn-sortie="'\+esc\(etat\)\+'"/);
  const sortie = html.slice(html.indexOf('querySelectorAll("[data-mn-sortie]")'),
                            html.indexOf('querySelectorAll("[data-creneau-vers]")'));
  assert.match(sortie, /ouvrirRecherche\(\)/, "position inconnue → choisir un point");
  assert.match(sortie, /chargerAutourDuPoint/, "panne → réessayer");
  assert.match(sortie, /majFeuille2\(\)/, "vide → Explorer reste accessible");
});

/* ==========================================================================
   6. « AUTOUR » DE QUOI ?

   LE DÉFAUT SIGNALÉ : taper le nom d'une autre ville chargeait bien ses
   événements en cours — la carte s'y rendait, les données arrivaient — puis
   le bloc affichait « rien en cours près de toi » au-dessus d'une carte
   pleine d'événements en cours.

   La cause : Autour connaît trois points — là où vous ÊTES, la ville que vous
   avez DEMANDÉE, et ce que la carte MONTRE — et chaque partie du code en
   choisissait un. Le chargement suivait la carte (juste), le classement et le
   filtre de distance suivaient la position (faux ailleurs). Les premiers
   mal-classaient ; le dernier EXCLUAIT, à 220 km.
   ======================================================================== */

test("le point de référence est celui qu'on regarde, pas celui où l'on est", () => {
  assert.match(html, /function pointDeReference\(\)\{/);
  // le filtre, le classement et les distances lisent tous le même point
  const ctxFn = html.slice(html.indexOf("function contexteMaintenant()"),
                           html.indexOf("function selectionMaintenant"));
  assert.match(ctxFn, /const ref = pointDeReference\(\);/);
  assert.match(html, /const \[lat,lng\] = pointDeReference\(\) \|\| positionMoi;/,
    "classerLieux doit partir du point regardé");
});

test("une ville choisie vaut une position connue", () => {
  /* Choisir une ville, c'est dire soi-même où l'on regarde. Sans ça, le bloc
     annonçait « Autour ne sait pas où tu es » alors qu'on venait justement de
     le lui dire. */
  const ctxFn = html.slice(html.indexOf("function contexteMaintenant()"),
                           html.indexOf("function selectionMaintenant"));
  assert.match(ctxFn, /positionConnue: positionConnue\(\) \|\| !!rechercheGeo/);
  assert.match(ctxFn, /positionRefusee:[\s\S]{0,80}&& !rechercheGeo/);
});

test("« autour » va aussi loin que ce qu'on voit", () => {
  /* Un rayon fixe se trompe d'une deuxième façon : `allerVers` décale
     volontairement le centre de la carte pour que le point visé ne soit pas
     caché par la feuille du bas. Au zoom 13 ce décalage vaut sept kilomètres,
     et des événements parfaitement visibles tombaient hors du rayon. */
  assert.match(html, /function rayonRegarde\(\)\{/);
  assert.match(html, /Math\.max\(socle, demiDiagonale\)/);
  assert.match(html, /rayonMax: rayonRegarde\(\)/);
  // le module accepte bien un rayon fourni par l'appelant
  const loin = { id: "x", estEvenement: true, annule: false, enCours: true,
                 dateIncertaine: false, debutLe: T - h(1), finLe: T + h(1),
                 lat: 50.75, lng: 3.0573, ferme: false };
  const base = { maintenant: T, position: ICI, positionConnue: true };
  assert.equal(M.fiable(loin, base).retenu, false, "hors du rayon par défaut");
  assert.equal(M.fiable(loin, Object.assign({ rayonMax: 20000 }, base)).retenu, true);
});

test("on n'affiche pas une distance depuis un endroit où l'on n'est pas", () => {
  // « 220 km » sous chaque concert est une mesure exacte et inutile
  assert.match(html, /function jeSuisDansLaZoneRegardee\(\)\{/);
  assert.match(html, /const dist = jeSuisDansLaZoneRegardee\(\)/);
});

test("la feuille se rafraîchit quand la carte change de ville", () => {
  /* La sélection dépend du point regardé : déplacer la carte change sa
     réponse. Mais seule l'arrivée de NOUVELLES données déclenchait un rendu —
     zone déjà en cache, rien n'arrivait, rien ne se redessinait. */
  const suivi = html.slice(html.indexOf('map.on("moveend zoomend"'),
                           html.indexOf('map.on("click"'));
  assert.match(suivi, /planifierRendu\(\{accueil:true, feuille:true\}\)/);
});

/* ==========================================================================
   7. UN MOTEUR DE DISPONIBILITÉ, PLUS UN FILTRE D'ÉVÉNEMENTS

   « Maintenant » ne veut plus dire « événements en cours ». Il veut dire :
   qu'est-ce que je peux faire, là, dans la zone que je regarde ? Un quartier
   n'a pas un concert à toute heure — s'en tenir aux événements laissait le
   bloc vide l'essentiel du temps, alors qu'il y a un restaurant ouvert à deux
   rues et un cinéma dont la séance commence dans vingt minutes.
   ======================================================================== */

const lieu = (extra) => Object.assign({
  id: "l1", estEvenement: false, annule: false,
  lat: ICI[0] + 300 / 111320, lng: ICI[1],
  ouvert: true, ouvertALArrivee: true, categorie: "resto",
}, extra || {});

test("les quatre natures sont exactement celles du contrat", () => {
  assert.deepEqual(Object.values(M.NATURES).sort(),
    ["activity_now", "event_now", "open_now", "session_soon"]);
});

test("un événement en cours reste la première des natures", () => {
  const v = M.disponible(bon(), ctx());
  assert.equal(v.retenu, true);
  assert.equal(v.nature, M.NATURES.EVENEMENT);
});

test("un lieu ouvert est une réponse valable", () => {
  const v = M.disponible(lieu(), ctx());
  assert.equal(v.retenu, true, v.raison);
  assert.equal(v.nature, M.NATURES.OUVERT);
});

test("un lieu d'activité ouvert est une sortie", () => {
  // un musée ouvert est une sortie ; une supérette ouverte est une commodité
  for (const cat of ["cinema", "musee", "biblio", "parc", "piscine"]) {
    assert.equal(M.disponible(lieu({ categorie: cat }), ctx()).nature,
      M.NATURES.ACTIVITE, cat);
  }
  // un restaurant ou un café ouvert reste une proposition : on y va
  assert.equal(M.disponible(lieu({ categorie: "resto" }), ctx()).nature,
    M.NATURES.OUVERT);
});

test("une commodité ouverte n'est PAS une proposition", () => {
  /* « Maintenant » possède trois places. Ouvert + assez proche décrit, dans
     n'importe quel centre-ville, d'abord Carrefour, Zara, la pharmacie et la
     bouche de métro : les trois places étaient prises avant qu'un concert
     n'arrive. Ces lieux restent sur la carte et dans « Autour de toi » ; ils
     ne se proposent plus d'eux-mêmes. */
  for (const cat of M.COMMODITES) {
    const v = M.disponible(lieu({ categorie: cat }), ctx());
    assert.equal(v.retenu, false, cat + " ne doit pas se proposer seul");
    assert.equal(v.raison, M.RAISONS.COMMODITE, cat);
  }
  // les catégories nommées par le mot « commodité » sont bien celles-là
  ["commerce", "sante", "metro", "bus", "tram", "train", "velo"]
    .forEach((c) => assert.ok(M.estCommodite(c), c));
  ["cinema", "musee", "concert", "resto", "cafe", "bar", "parc"]
    .forEach((c) => assert.ok(!M.estCommodite(c), c + " n'est pas une commodité"));
});

test("une commodité DEMANDÉE revient aussitôt", () => {
  /* « pharmacie ouverte maintenant » est une demande, pas une suggestion :
     c'est exactement ce qu'il faut montrer. La liste des catégories demandées
     vient de l'interface ou d'une phrase comprise — jamais d'une devinette. */
  const demande = ctx({ categoriesDemandees: ["sante"] });
  const v = M.disponible(lieu({ categorie: "sante" }), demande);
  assert.equal(v.retenu, true, "une pharmacie demandée doit entrer");
  assert.equal(v.nature, M.NATURES.OUVERT);
  // demander la pharmacie ne fait pas rentrer le supermarché avec elle
  assert.equal(M.disponible(lieu({ categorie: "commerce" }), demande).raison,
    M.RAISONS.COMMODITE);
});

test("un lieu FERMÉ n'entre jamais, même s'il reste une place libre", () => {
  const v = M.disponible(lieu({ ouvert: false }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.PAS_OUVERT);
});

test("un horaire INCONNU ne passe pas non plus", () => {
  /* C'est le cas le plus fréquent, et le plus dangereux à confondre avec
     « ouvert » : envoyer quelqu'un devant une porte close parce qu'on ne
     savait pas. Dans « Maintenant », l'inconnu ne passe pas — ailleurs dans
     Autour, il reste affiché avec « horaires non renseignés ». */
  for (const inconnu of [null, undefined]) {
    const v = M.disponible(lieu({ ouvert: inconnu }), ctx());
    assert.equal(v.retenu, false, String(inconnu));
    assert.equal(v.raison, M.RAISONS.HORAIRE_INCONNU);
  }
});

test("un lieu qui ferme avant qu'on arrive n'entre pas", () => {
  // arriver au musée trois minutes avant la fermeture n'est pas une visite
  const v = M.disponible(lieu({ categorie: "musee", ouvertALArrivee: false }), ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.FERME_TROP_TOT);
});

/* ---- La séance imminente : la seule exception, et elle est bornée ------- */

test("une séance qui commence bientôt est une réponse à « maintenant »", () => {
  const seance = bon({ debutLe: T + 20 * 60000, finLe: T + 140 * 60000,
                       enCours: false, categorie: "cinema" });
  const v = M.disponible(seance, ctx());
  assert.equal(v.retenu, true, v.raison);
  assert.equal(v.nature, M.NATURES.SEANCE);
});

test("mais la fenêtre est étroite des DEUX côtés", () => {
  // trop loin : ce n'est plus « maintenant »
  const tard = bon({ debutLe: T + 3 * h(1), finLe: T + 5 * h(1), enCours: false });
  assert.equal(M.disponible(tard, ctx()).raison, M.RAISONS.SEANCE_TROP_LOIN);
  // trop proche : on n'y sera pas
  const juste = bon({ debutLe: T + 60000, finLe: T + h(2), enCours: false });
  assert.equal(M.disponible(juste, ctx()).raison, M.RAISONS.SEANCE_TROP_PROCHE);
});

test("UN ÉVÉNEMENT DE DEMAIN NE REMPLIT JAMAIS UNE LIGNE VIDE", () => {
  /* La règle qui ne bouge pas d'un pouce. Un concert demain n'est pas
     « maintenant », même s'il ne reste que des places libres. */
  const demain = bon({ debutLe: T + 26 * h(1), finLe: T + 28 * h(1), enCours: false });
  const v = M.disponible(demain, ctx());
  assert.equal(v.retenu, false);
  assert.equal(v.raison, M.RAISONS.SEANCE_TROP_LOIN);
  // et la sélection ne le rattrape pas non plus
  assert.deepEqual(M.selection([demain], ctx()), []);
});

test("un événement passé ou annulé ne devient jamais une séance", () => {
  assert.equal(M.disponible(bon({ debutLe: T - h(5), finLe: T - h(2), enCours: false }),
    ctx()).raison, M.RAISONS.DEJA_FINI);
  assert.equal(M.disponible(bon({ annule: true }), ctx()).raison, M.RAISONS.ANNULE);
  assert.equal(M.disponible(bon({ dateIncertaine: true }), ctx()).raison,
    M.RAISONS.DATE_INCERTAINE);
});

/* ---- La priorité et la diversité --------------------------------------- */

test("l'ordre de priorité est respecté", () => {
  const liste = [
    lieu({ id: "resto", categorie: "resto" }),
    lieu({ id: "cine", categorie: "cinema" }),
    bon({ id: "concert" }),
  ];
  assert.deepEqual(M.selection(liste, ctx()).map((x) => x.id),
    ["concert", "cine", "resto"]);
});

test("la diversité évite trois fois la même réponse", () => {
  /* Trois fast-foods répondent trois fois à la même question. Un événement,
     un cinéma et un restaurant répondent à trois questions différentes. */
  const liste = [
    lieu({ id: "burger1", categorie: "fastfood", lat: ICI[0] + 0.001 }),
    lieu({ id: "burger2", categorie: "fastfood", lat: ICI[0] + 0.0011 }),
    lieu({ id: "burger3", categorie: "resto", lat: ICI[0] + 0.0012 }),
    lieu({ id: "cafe", categorie: "cafe", lat: ICI[0] + 0.004 }),
    lieu({ id: "cine", categorie: "cinema", lat: ICI[0] + 0.005 }),
    lieu({ id: "sport", categorie: "sport", lat: ICI[0] + 0.006 }),
  ];
  const choisis = M.selection(liste, ctx()).map((x) => x.id);
  assert.equal(choisis.length, 3);
  const familles = new Set(choisis.map((id) =>
    M.familleDe(liste.find((l) => l.id === id))));
  assert.equal(familles.size, 3, "trois familles distinctes : " + choisis.join(", "));
});

test("la variété ne coûte jamais la tête de liste", () => {
  /* Un tri « une famille sur deux » ferait passer un café ouvert devant un
     concert en cours pour cause de variété. Le premier reste le meilleur au
     sens strict. */
  const liste = [
    lieu({ id: "cafe", categorie: "cafe", lat: ICI[0] + 0.0001 }),
    bon({ id: "concert", lat: ICI[0] + 0.02 }),
  ];
  assert.equal(M.selection(liste, ctx())[0].id, "concert");
});

test("on ne propose jamais plus d'un lieu lié à la nourriture", () => {
  const trois = [
    lieu({ id: "a", categorie: "resto", lat: ICI[0] + 0.001 }),
    lieu({ id: "b", categorie: "resto", lat: ICI[0] + 0.002 }),
    lieu({ id: "c", categorie: "resto", lat: ICI[0] + 0.003 }),
  ];
  assert.equal(M.selection(trois, ctx()).length, 1);
  // mais jamais avec du fermé, même si c'est le seul type disponible
  const fermes = trois.map((l) => Object.assign({}, l, { ouvert: false }));
  assert.deepEqual(M.selection(fermes, ctx()), []);
});

test("chaque proposition retenue porte sa nature", () => {
  const liste = [bon({ id: "e" }), lieu({ id: "l", categorie: "cafe" })];
  const choisis = M.selection(liste, ctx());
  assert.deepEqual(choisis.map((x) => x.nature),
    [M.NATURES.EVENEMENT, M.NATURES.OUVERT]);
});

test("sans position CONNUE, rien n'est autour de personne", () => {
  /* Quand la géolocalisation est refusée, Autour pose quand même la carte
     quelque part — une ville déduite d'une adresse IP. Les coordonnées sont
     valides, et les lieux ouverts alentour passaient tous : trois restaurants
     « autour de toi » pour quelqu'un dont personne ne savait où il était. */
  const aucune = ctx({ positionConnue: false });
  assert.equal(M.disponible(lieu(), aucune).raison, M.RAISONS.POSITION_INCONNUE);
  assert.equal(M.disponible(bon(), aucune).raison, M.RAISONS.POSITION_INCONNUE);
  assert.deepEqual(M.selection([lieu(), bon()], aucune), []);
});

test("l'application transmet l'ouverture depuis availability.js, pas d'ailleurs", () => {
  const versItem = html.slice(html.indexOf("function versItemMaintenant"),
                              html.indexOf("function contexteMaintenant"));
  assert.match(versItem, /dispoDe\(l, arriveeEstimee/);
  assert.match(versItem, /dispo\.status === "open" \? true/);
  assert.match(versItem, /dispo\.status === "unknown" \? null : false/);
  assert.match(versItem, /ouvertALArrivee = dispo\.isOpenAtArrival/);
});

test("l'accueil délègue « Ce soir » aux couches temporelles", () => {
  assert.match(html, /function recommandationsCeSoir\(limite\)\{/);
  const bloc = html.slice(html.indexOf("function recommandationsCeSoir"),
    html.indexOf("function recommandationsAccueil", html.indexOf("function recommandationsCeSoir")));
  assert.match(bloc, /selectionCeSoir/);
  assert.match(bloc, /soirDebut:soir && soir\.debut/);
  assert.match(bloc, /allowPointStatus:false/);
  assert.match(html, /if\(creneau === "soir" && !modeAide\)/);
});

test("la ligne dit le bon temps selon la nature", () => {
  // « jusqu'à 20:00 » sous un cinéma dont la séance commence à 20:00 dirait
  // exactement le contraire de la vérité
  assert.match(html, /function tempsMaintenant\(l\)\{/);
  assert.match(html, /commence dans "\+dans\+" min"/);
  assert.match(html, /"ouvert jusqu’à "\+d\.closesAtTime/);
});
