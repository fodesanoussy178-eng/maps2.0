import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/* Ces tests lisent la source. C'est volontaire et c'est la convention du
   dépôt : l'application est une page unique sans point d'entrée importable,
   et ces contrats sont exactement ceux qu'une refonte distraite casserait
   sans que rien ne le signale. */

/* ======================================================================== */
/*  « Y aller » répond, il ne renvoie pas vers une deuxième décision        */
/* ======================================================================== */

test("« Y aller » de la fiche carte déplie le trajet, il ne rouvre pas un menu", () => {
  assert.match(html, /f\.querySelector\("\.fc-y"\)\.onclick[\s\S]{0,240}afficherTrajet\(l\)/,
    "toucher « Y aller » doit produire les temps de trajet, pas une fiche à relire");
});

test("« Y aller » et « Voir » ouvrent la fiche par le même chemin", () => {
  // deux boutons voisins qui ouvrent le même écran doivent laisser le bouton
  // retour du téléphone se comporter pareil
  const y = /f\.querySelector\("\.fc-y"\)\.onclick = \(\)=>\{[\s\S]{0,240}?\};/.exec(html);
  assert.ok(y, "le gestionnaire de « Y aller » doit exister");
  assert.match(y[0], /pileEcrans=\[\];/);
  assert.match(y[0], /pousserEcran\(/);
});

test("les temps à pied et à vélo s'affichent avant toute réponse réseau", () => {
  // estimation à vol d'oiseau d'abord, routage réel ensuite : jamais d'attente
  // devant un panneau vide
  assert.match(html, /const droit = \(profil\)=>\(\{ coords:\[depart,dest\], reel:false,/);
  assert.match(html, /Routage indisponible : les temps sont estimés à vol d’oiseau\./);
});

test("les modes complexes restent chez Maps, ils ne sont pas réimplémentés", () => {
  assert.match(html, /liensItinerairesExternes\(depart, dest\)/);
});

/* ======================================================================== */
/*  Conservation du contexte                                                */
/* ======================================================================== */

test("fermer une fiche rend la vue qu'on avait, pas la position GPS", () => {
  assert.match(html, /let vueAvantTrajet = null;/);
  assert.match(html, /if\(!vueAvantTrajet && map\)\{/,
    "la vue doit être retenue au premier tracé seulement");
  assert.match(html,
    /if\(vueAvantTrajet\) allerVers\(vueAvantTrajet\.centre, vueAvantTrajet\.zoom/);
});

test("le point de retour n'est pas écrasé en changeant de mode de trajet", () => {
  // passer de « à pied » à « vélo » retrace des segments : si la vue était
  // recapturée à chaque tracé, on reviendrait sur un cadrage d'itinéraire
  const bloc = /function dessinerSegments\(segments\)\{[\s\S]{0,420}?effacerLignes\(\);/.exec(html);
  assert.ok(bloc, "dessinerSegments doit exister");
  assert.match(bloc[0], /if\(!vueAvantTrajet && map\)/);
});

test("Explorer est photographié en le quittant et reposé en revenant", () => {
  assert.match(html, /function capturerContexteExplorer\(\)\{/);
  assert.match(html, /function restaurerContexteExplorer\(\)\{/);
  assert.match(html,
    /if\(ongletCourant === "explorer" && id !== "explorer"\) capturerContexteExplorer\(\);/,
    "la photo doit être prise AVANT que l'onglet suivant ne remette Explorer à plat");
  assert.match(html, /if\(!restaurerContexteExplorer\(\)\) ouvrirAccueilFeuille\(\);/);
});

test("le contexte rendu couvre le créneau, les filtres et la recherche", () => {
  const bloc = /function capturerContexteExplorer\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  for (const champ of ["creneau", "filtreActif", "recherche", "montrerFermes",
                       "catsActives", "filtresHumains", "selectionAccueil", "scroll"]) {
    assert.match(bloc[0], new RegExp(champ), "le contexte doit retenir " + champ);
  }
});

test("entrer dans Aide continue de repartir d'une page nette", () => {
  // la remise à plat en ENTRANT est une décision produit : elle ne doit pas
  // avoir été emportée par la restauration du contexte
  assert.match(html, /\/\/ on repart toujours de la question/);
  assert.match(html, /function basculerAide\(\)\{[\s\S]{0,400}?redirectionExplorer = null;/);
});

test("l'onglet allumé suit aussi les navigations déclenchées par le code", () => {
  assert.match(html, /function marquerNavigation\(id\)\{/);
  assert.match(html, /nav\.querySelectorAll\("\.nb"\)\.forEach\(x=>x\.classList\.toggle\("actif", x\.dataset\.nb === id\)\);/);
});

/* ======================================================================== */
/*  Aide n'envoie plus une réparation chez une assistante sociale           */
/* ======================================================================== */

test("une phrase hors Aide ouvre la porte d'Explorer au lieu des structures", () => {
  assert.match(html, /const domaine = AIDE\.domaineDeLaPhrase \? AIDE\.domaineDeLaPhrase\(phrase\) : \{domaine:"aide"\};/);
  assert.match(html, /if\(domaine\.domaine === "explorer"\)\{/);
  assert.match(html, /function ecranRedirectionExplorer\(\)\{/);
  assert.match(html, /Ça ressemble plutôt à/);
});

test("la bascule vers Explorer arrive avec la recherche déjà écrite", () => {
  const bloc = /corps\.querySelectorAll\("\[data-vers-explorer\]"\)[\s\S]*?\}\);/.exec(html);
  assert.ok(bloc, "le gestionnaire de bascule doit exister");
  assert.match(bloc[0], /ouvrirResultats\(requete\)/,
    "on ne dépose pas la personne devant un champ vide");
  assert.match(bloc[0], /champ\.value = requete/);
  assert.match(bloc[0], /marquerNavigation\("explorer"\)/);
});

test("on peut refuser la redirection et rester dans Aide", () => {
  assert.match(html, /data-aide-rester/);
  assert.match(html, /Non, j’ai besoin d’aide/);
});

test("la redirection ne survit pas à une sortie d'Aide", () => {
  // sinon rouvrir Aide afficherait l'écran de réparation d'il y a trois jours
  assert.match(html, /function basculerAide\(\)\{[\s\S]{0,400}?redirectionExplorer = null;/);
});

test("le champ Aide propose des exemples et dit où va le reste", () => {
  assert.match(html, /placeholder="« je n’ai rien à manger »"/);
  assert.match(html, /class="ab-exemples"/);
  assert.match(html, /« je dors dehors »/);
  // la phrase est concaténée dans la source : on vérifie ses deux moitiés
  assert.match(html, /Pour une réparation, un commerce ou un /);
  assert.match(html, /service, utilise Explorer\./);
});

/* ======================================================================== */
/*  « Maintenant » : compréhensible, et jamais rempli artificiellement      */
/* ======================================================================== */

test("le compte de « Maintenant » interroge le moteur temporel, pas le classement", () => {
  const bloc = /function compterMaintenant\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc, "compterMaintenant doit exister");
  assert.match(bloc[0], /TEMPS\.estMaintenant\(statutTemps\(l, t\)\.statut\)/,
    "le nombre doit venir du statut temporel, seule autorité sur « maintenant »");
  assert.match(bloc[0], /!estTemporaire\(l\) \|\| l\.annule/,
    "un événement annulé ne compte pas");
});

test("« Maintenant » porte son éclair et son compte", () => {
  assert.match(html, /const libelle = maintenant \? "⚡ "\+c\.label : c\.label;/);
  assert.match(html, /class="ong-compte"/);
});

test("le compteur ne déplace jamais les onglets voisins", () => {
  assert.match(html, /\.ong-maintenant\{position:relative;padding-right:38px\}/,
    "la place du badge doit être réservée en permanence");
  assert.match(html, /\.ong-compte\{position:absolute;/);
});

test("« Maintenant » vide propose « À venir » au lieu d'une impasse", () => {
  assert.match(html, /Rien en cours près de toi\./);
  assert.match(html, /data-creneau-vers="avenir"/);
  assert.match(html, /Voir ce qui arrive bientôt →/);
});

test("un état vide ne recouvre jamais une vraie panne", () => {
  assert.match(html,
    /if\(technique && !\/Rien d’ouvert à proximité\/\.test\(technique\)\) return technique;/,
    "une erreur réseau ou une position refusée doit rester lisible");
});

test("le pont vers « À venir » passe par le même chemin qu'un onglet", () => {
  const bloc = /corps\.querySelectorAll\("\[data-creneau-vers\]"\)[\s\S]*?\}\);/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /filtreMaintenant = creneau === "maintenant";/,
    "un seul comportement à maintenir pour les deux chemins");
});

test("rien ne parle de « rien autour de toi » sans position connue", () => {
  assert.match(html, /if\(!positionConnue\(\)\)\s*\n?\s*return '<p class="fb-statut">Choisis un point de départ/);
});

/* ======================================================================== */
/*  Ce que cette passe ne devait PAS changer                                */
/* ======================================================================== */

test("la navigation basse garde ses cinq entrées, dans l'ordre", () => {
  const ordre = [...html.matchAll(/data-nb="([a-z]+)"/g)].map((m) => m[1]);
  const nav = ordre.filter((x, i) => ordre.indexOf(x) === i);
  assert.deepEqual(nav, ["explorer", "aide", "creer", "favoris", "profil"]);
});

test("aucun onglet principal n'a été ajouté pour « Maintenant »", () => {
  assert.doesNotMatch(html, /data-nb="maintenant"/);
  // « Maintenant » reste un créneau à l'intérieur d'Explorer
  assert.match(html, /\{ id:"maintenant", label:"Maintenant"\s*\}/);
});

test("la carte reste une seule instance vivante", () => {
  // `map = L.map(` : la construction elle-même, pas les mentions en commentaire
  const creations = [...html.matchAll(/\bmap = L\.map\(/g)];
  assert.equal(creations.length, 1, "la carte ne doit être construite qu'une fois");
  assert.doesNotMatch(html, /map\.remove\(\)/, "la carte ne doit jamais être détruite");
});

test("les fiches et la feuille restent exclusives", () => {
  assert.match(html, /const layerManager = \{/);
  assert.match(html, /Une seule couche principale reste interactive/);
});

/* ======================================================================== */
/*  Le fond de carte reste un support discret                               */
/* ======================================================================== */

test("le fond Google est stylé, jamais laissé au Google Maps par défaut", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  assert.match(g, /const STYLE_MINIMAL = Object\.freeze\(\[/);
  assert.match(g, /styles:STYLE_MINIMAL,/,
    "sans `styles`, la carte rend le Google Maps par défaut : POI, enseignes, couleurs saturées");
});

test("les POI et les transports du fond sont éteints", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  assert.match(g, /\{ featureType:"poi",\s*stylers:\[\{visibility:"off"\}\] \}/,
    "les commerces du fond concurrencent les marqueurs d'Autour");
  assert.match(g, /\{ featureType:"transit", stylers:\[\{visibility:"off"\}\] \}/);
  assert.match(g, /elementType:"labels\.icon",\s*stylers:\[\{visibility:"off"\}\]/,
    "aucune pastille du fond ne doit pouvoir être prise pour un marqueur Autour");
});

test("aucun mapId ne vient neutraliser le style", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  assert.doesNotMatch(g, /mapId\s*:/, "un mapId ferait ignorer `styles` silencieusement");
});

test("la palette du fond reste claire et désaturée", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  const couleurs = [...g.matchAll(/color:"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  assert.ok(couleurs.length >= 8, "le style doit couvrir les surfaces principales");
  for (const c of couleurs) {
    const [r, v, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const max = Math.max(r, v, b), min = Math.min(r, v, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    assert.ok(max >= 0x88, `${c} est trop sombre pour un fond clair`);
    assert.ok(saturation <= 0.12, `${c} est trop saturé pour un fond discret`);
  }
});

test("le repli autonome préfère le style le plus épuré", () => {
  const ordre = [...html.matchAll(/nom:"(CARTO Positron|CARTO Voyager|OpenStreetMap)"/g)]
    .map((m) => m[1]);
  assert.equal(ordre[0], "CARTO Positron",
    "Positron est le gris-beige désaturé ; Voyager est le style coloré");
  assert.deepEqual(ordre, ["CARTO Positron", "CARTO Voyager", "OpenStreetMap"]);
});

/* ======================================================================== */
/*  La pastille « ⚡ Maintenant · N » posée sur la carte                     */
/* ======================================================================== */

test("la pastille existe, centrée sur la carte, avec son sous-titre", () => {
  assert.match(html, /<button id="badgeMaintenant" hidden aria-live="polite">/);
  assert.match(html, /<b>Maintenant<\/b>/);
  assert.match(html, /En cours près de toi/);
  assert.match(html, /#badgeMaintenant\{position:fixed;left:50%;transform:translateX\(-50%\);/);
});

test("la pastille disparaît à zéro au lieu d'afficher « Maintenant · 0 »", () => {
  const bloc = /function majBadgeMaintenant\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc, "majBadgeMaintenant doit exister");
  assert.match(bloc[0], /badge\.hidden = n === 0;/);
  assert.match(bloc[0], /compterMaintenant\(\)/,
    "le nombre affiché doit être celui du moteur temporel");
});

test("la pastille suit les données même sans carte", () => {
  // Leaflet vient d'un CDN : il peut manquer, la pastille doit rester juste
  assert.match(html, /majBadgeMaintenant\(\);\n  if\(!map\) return;/);
});

test("un appui sur la pastille ouvre la liste, pas un menu", () => {
  const bloc = /\$\("#badgeMaintenant"\)\.onclick = \(\)=>\{[\s\S]*?\n\};/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /creneau = "maintenant";/);
  assert.match(bloc[0], /ouvrirFeuille2\("racine"\);/);
  assert.match(bloc[0], /marquerNavigation\("explorer"\)/);
});

test("la pastille s'efface là où la carte appartient à autre chose", () => {
  assert.match(html, /body\.nav #badgeMaintenant,body\.pose #badgeMaintenant\{display:none\}/);
  const bloc = /function majBadgeMaintenant\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.match(bloc[0], /modeNav \|\| modePose \|\| modeAide/);
});

/* ======================================================================== */
/*  Les marqueurs restent collés à la carte pendant qu'on la déplace        */
/* ======================================================================== */

test("la couche Leaflet suit Google en continu, pas seulement en fin de geste", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  assert.match(g, /carte\.addListener\("bounds_changed", suivre\);/,
    "sans suivi continu, les marqueurs restent figés pendant le déplacement");
  assert.match(g, /carte\.addListener\("idle", suivre\);/,
    "`idle` reste le filet de fin de geste");
});

test("le garde-fou de synchronisation empêche la boucle Google ↔ Leaflet", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  const bloc = /const suivre = \(\) => \{[\s\S]*?\n    \};/.exec(g);
  assert.ok(bloc, "le suivi doit être une fonction unique, partagée par les deux écouteurs");
  assert.match(bloc[0], /if \(synchronisation\) return;/);
  assert.match(bloc[0], /synchronisation = true;/);
});
