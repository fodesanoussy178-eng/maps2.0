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
  /* Le corps de la bascule est une fonction nommée depuis qu'une lecture
     proposée (« un lieu près de moi ») peut la déclencher elle aussi : deux
     chemins vers Explorer, un seul code. */
  const bloc = /function basculerVersExplorer\(requete\)\{[\s\S]*?\n  \}/.exec(html);
  assert.ok(bloc, "le gestionnaire de bascule doit exister");
  assert.match(html, /corps\.querySelectorAll\("\[data-vers-explorer\]"\)/,
    "le bouton de redirection doit appeler la bascule");
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
  // la garantie passe désormais par etatDonnees() : « rien » ne peut pas être
  // conclu tant que l'état n'est pas READY_WITHOUT_RESULTS
  assert.match(html, /if\(etatGroupe === ETATS_DONNEES\.LOCATION_UNKNOWN\)\s*\n?\s*return '<p class="fb-statut">Choisis un point de départ/);
  assert.match(html, /if\(!positionConnue\(\)\)\s*\n?\s*return ETATS_DONNEES\.LOCATION_UNKNOWN;/);
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

/* ======================================================================== */
/*  Explorer / Maintenant : la présentation cible                           */
/* ======================================================================== */

test("un événement en cours prend une carte blanche, pas une pastille de commerce", () => {
  assert.match(html, /class="evc"/);
  assert.match(html, /class="evc-rond"/);
  // icône + titre + lieu + distance et heure de fin
  assert.match(html, /\.evc\{display:flex;align-items:center;/);
  assert.match(html, /const bas = \[dist, fin \? "jusqu’à "\+fin : ""\]\.filter\(Boolean\)\.join\(" · "\);/);
});

test("la carte-événement passe AVANT l'affiche : un événement en cours d'abord", () => {
  const i = html.indexOf('class="evc"');
  const j = html.indexOf('class="affiche ');
  assert.ok(i > 0 && j > 0 && i < j,
    "placée après, la branche affiche capturait tous les événements et .evc n'était jamais atteinte");
});

test("seul ce qui a réellement lieu prend la carte blanche", () => {
  assert.match(html,
    /if\(estTemporaire\(l\) && !l\.annule && TEMPS\.estMaintenant\(statutTemps\(l\)\.statut\)\)\{/);
});

test("la liste « ⚡ Maintenant (N) » existe, compacte et comptée", () => {
  assert.match(html, /function blocMaintenantAccueil\(\)\{/);
  assert.match(html, /class="mn" data-testid="maintenant-liste"/);
  assert.match(html, /<b>Maintenant<\/b>'\+/);
  // le compteur dit COMBIEN il y en a en tout, pas combien on en montre
  assert.match(html, /<span>\('\+combien\+'\)<\/span>/);
  assert.match(html, /Voir tout \('\+combien\+'\)/);
});

test("le bloc réserve sa place dès le premier rendu, dans les quatre états", () => {
  /* CE QUI CASSAIT : la fonction rendait "" tant qu'il n'y avait rien. La
     géolocalisation prend une seconde, les événements une autre — pendant ce
     temps la section n'existait pas et les boutons du dessous occupaient sa
     place. À l'arrivée des données, le bloc s'insérait et poussait tout vers
     le bas, sous le doigt de quelqu'un qui appuyait déjà. */
  const bloc = /function blocMaintenantAccueil\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  // hors du créneau, le bloc n'a rien à dire : c'est le seul retour vide
  assert.match(bloc[0], /if\(creneau !== "maintenant" \|\| modeAide\) return "";/);
  const retoursVides = (bloc[0].match(/return "";/g) || []).length;
  assert.equal(retoursVides, 2,
    "un retour vide hors créneau, un si le module manque — et aucun autre");
  assert.doesNotMatch(bloc[0], /if\(!liste\.length\) return "";/,
    "un bloc vide doit occuper sa place, pas disparaître");
  /* La hauteur est réservée en CSS, et sur le CORPS plutôt que sur la carte :
     additionner une hauteur d'en-tête SUPPOSÉE donnait quatre pixels d'écart,
     que le banc de navigateur a mesurés. L'en-tête garde sa taille naturelle,
     le corps réserve exactement trois lignes plus le pied — et les lignes ont
     une hauteur FIXE, pas déduite de leur contenu. */
  assert.match(html, /\.mn-corps\{min-height:calc\(3 \* var\(--mn-ligne\) \+ var\(--mn-pied\)\)/);
  assert.match(html, /:root\{--mn-ligne:\d+px;--mn-pied:\d+px\}/);
  assert.match(html, /\.mn-l\{[^}]*height:var\(--mn-ligne\)/);
  assert.match(html, /<div class="mn-corps">/);
});

test("les quatre états sont rendus, et aucun ne déplace l'interface", () => {
  const bloc = /function blocMaintenantAccueil\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /data-mn-etat="'\+esc\(etat\)\+'"/);
  assert.match(bloc, /M\.ETATS\.READY/);
  assert.match(bloc, /M\.ETATS\.LOADING/);
  // pendant la collecte : un état léger et neutre, sans texte à lire
  assert.match(bloc, /class="mn-attente" aria-hidden="true"/);
  assert.match(html, /\.mn-attente i\{height:var\(--mn-ligne\)/);
  // vide et erreur occupent la même hauteur que trois lignes
  assert.match(html, /\.mn-rien\{flex:1/);
  assert.match(bloc, /aria-busy="'\+\(etat === M\.ETATS\.LOADING\)\+'"/);
});

test("les trois emplacements ne sont jamais remplis artificiellement", () => {
  const bloc = /function blocMaintenantAccueil\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  // on rend ce que la sélection donne, sans compléter jusqu'à trois
  assert.match(bloc, /liste\.map\(ligneMaintenant\)/);
  assert.doesNotMatch(bloc, /slice\(0, *MAINTENANT_APERCU\)/,
    "la troncature appartient au module de sélection, pas à l'affichage");
});

test("une ligne ouvre son événement, sans menu intermédiaire", () => {
  const bloc = /corps\.querySelectorAll\("\[data-mn\]"\)[\s\S]*?\}\);/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /pousserEcran\(\(\)=>ouvrirDetail\(l\.id\)\)/);
});

test("un événement en cours n'est jamais affiché deux fois dans la feuille", () => {
  assert.match(html, /const dejaListes = new Set\(enCours\.slice\(0, MAINTENANT_APERCU\)\.map\(l=>l\.id\)\);/);
  assert.match(html, /reco = reco\.filter\(l=>!dejaListes\.has\(l\.id\)\);/);
  assert.match(html, /const titre = enCours\.length \? "Autour de toi"/,
    "deux sections nommées « maintenant » diraient la même chose deux fois");
});

/* ======================================================================== */
/*  Les cinq états, à un seul endroit                                       */
/* ======================================================================== */

test("les cinq états demandés existent, nommés", () => {
  for (const e of ["location_unknown", "location_loading", "data_loading",
                   "ready_with_results", "ready_without_results"]) {
    assert.match(html, new RegExp('"' + e + '"'), e + " doit être un état nommé");
  }
  assert.match(html, /ERROR:\s+"error"/,
    "une panne est un sixième état : ce n'est jamais un résultat vide");
});

test("l'ordre des tests est la règle métier", () => {
  const bloc = /function etatDonnees\(nombreResultats\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc, "etatDonnees doit exister");
  const ou = (e) => bloc[0].indexOf(e);
  // on ne parle jamais de « rien » avant de savoir où l'on regarde
  assert.ok(ou("LOCATION_LOADING") < ou("DATA_LOADING"));
  assert.ok(ou("LOCATION_UNKNOWN") < ou("DATA_LOADING"));
  assert.ok(ou("LOCATION_UNKNOWN") < ou("READY_WITHOUT_RESULTS"));
  // un chargement n'est pas un vide, et une panne non plus
  assert.ok(ou("DATA_LOADING") < ou("READY_WITHOUT_RESULTS"));
  assert.ok(ou("ERROR") < ou("READY_WITHOUT_RESULTS"));
  // le vide est la toute dernière conclusion possible
  assert.equal(ou("READY_WITHOUT_RESULTS"),
    Math.max(...["LOCATION_LOADING","LOCATION_UNKNOWN","DATA_LOADING",
                 "READY_WITH_RESULTS","ERROR","READY_WITHOUT_RESULTS"].map(ou)));
});

test("une panne ne peut jamais être lue comme zéro résultat", () => {
  const bloc = /function etatDonnees\(nombreResultats\)\{[\s\S]*?\n\}/.exec(html);
  assert.match(bloc[0], /if\(panneTechnique\(\)\) return ETATS_DONNEES\.ERROR;/);
  const iErreur = bloc[0].indexOf("ERROR");
  const iVide = bloc[0].indexOf("READY_WITHOUT_RESULTS");
  assert.ok(iErreur < iVide, "la panne se conclut AVANT le vide");
});

test("les trois affichages lisent la même fonction, aucun ne recopie la règle", () => {
  // le bandeau flottant, le statut de groupe et le statut de recherche
  assert.match(html, /const etat = etatDonnees\(retenus\);/);
  assert.match(html, /const etatGroupe = etatDonnees\(0\);/);
  assert.match(html, /const etat = etatDonnees\(nombreResultats\);/);
});

test("une recherche en cours avec des résultats déjà là ne repasse pas en chargement", () => {
  const bloc = /function etatDonnees\(nombreResultats\)\{[\s\S]*?\n\}/.exec(html);
  assert.match(bloc[0],
    /if\(rechercheEnCours\(\)\)\s*\n?\s*return n \? ETATS_DONNEES\.READY_WITH_RESULTS : ETATS_DONNEES\.DATA_LOADING;/,
    "sinon la liste se vide puis se remplit — le saut de mise en page qu'on veut supprimer");
});

/* ======================================================================== */
/*  Aide : périmètre explicite                                              */
/* ======================================================================== */

test("« se déplacer » est un besoin reconnu, sans onzième case à l'écran", () => {
  const aide = readFileSync(new URL("../aide.js", import.meta.url), "utf8");
  assert.match(aide, /id: "mobilite", emoji: "🚌", label: "Se déplacer", horsGrille: true,/);
});

test("le périmètre d'Aide est déclaré dans le modèle, pas dans l'écran", () => {
  const aide = readFileSync(new URL("../aide.js", import.meta.url), "utf8");
  assert.match(aide, /const PERIMETRE = Object\.freeze\(\[/);
  assert.match(html, /const domaines = \(AIDE && AIDE\.PERIMETRE\) \|\| \[\];/,
    "deux listes finiraient par différer");
});

test("hors périmètre, Autour le dit au lieu de proposer des structures au hasard", () => {
  assert.match(html, /redirectionExplorer = \{horsPerimetre:true, propositions:/);
  assert.match(html, /Je ne suis pas sûr d’avoir compris\./);
  assert.match(html, /data-testid="aide-hors-perimetre"/);
  // deux portes restent ouvertes, aucune n'est imposée
  assert.match(html, /data-aide-reformuler/);
  assert.match(html, /data-aide-general/);
});

test("une phrase mal comprise reçoit au plus trois lectures, jamais un menu", () => {
  // les lectures viennent du routeur, pas d'une liste recopiée dans la page
  assert.match(html, /ROUTEUR\.router\(phrase\)\.suggestions/);
  assert.match(html, /lectures\.slice\(0,3\)/, "trois au plus, jamais six");
  assert.match(html, /\(r\.propositions \|\| \[\]\)\.slice\(0,3\)/);
  // icône ET mot : aucune proposition ne repose sur le seul dessin
  assert.match(html, /esc\(p\.icone\)[\s\S]{0,40}esc\(p\.label\)/);
  assert.match(html, /data-aide-lecture/);
});

/* ======================================================================== */
/*  Safari mobile                                                           */
/* ======================================================================== */

test("la hauteur suit la fenêtre réellement visible sur iOS", () => {
  assert.match(html, /html,body\{height:100%;height:100dvh;overscroll-behavior:none\}/);
  // aucun 100vh actif : sur Safari iOS il inclut la barre d'URL
  const regles = html.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(regles, /:\s*100vh/);
});

test("les encoches sont lues par un seul token", () => {
  assert.match(html, /--safe-t:env\(safe-area-inset-top,0px\)/);
  assert.match(html, /top:calc\(var\(--haut-entete, 64px\) \+ var\(--safe-t, 0px\) \+ 10px\);/);
});

/* ======================================================================== */
/*  Densité : les cartes d'événement passent par l'anti-collision           */
/* ======================================================================== */

test("les cartes d'événement sont vues par le résolveur de collisions", () => {
  // posées sans être déclarées ici, elles n'étaient jamais masquées ni
  // basculées : cinq événements dans cent mètres donnaient cinq cartes empilées
  assert.match(html, /const eti = el && el\.querySelector\("\.poi-eti, \.evc-txt"\);/);
  assert.match(html, /const rond = el && el\.querySelector\("\.poi-rond, \.evc-rond"\);/);
  assert.match(html, /\.evc-txt\.masquee\{display:none\}/);
});

test("les pastilles réservent leur place avant tout placement d'étiquette", () => {
  const bloc = /entrees\.forEach\(\(\{rond\}\)=>\{[\s\S]*?\}\);/.exec(html);
  assert.ok(bloc, "les pastilles doivent être enregistrées dans la grille");
  assert.match(bloc[0], /enregistrer\(\{x:rr\.left-cadre\.left/);
  // et cet enregistrement précède la boucle de décision
  assert.ok(html.indexOf("entrees.forEach(({rond})=>{") < html.indexOf("const decisions=[];"));
});

/* ======================================================================== */
/*  OpenAgenda : borné, mis en cache, et sans effacement en cas de panne    */
/* ======================================================================== */

test("chaque requête OpenAgenda est bornée dans le temps", () => {
  assert.match(html, /const DELAI_OPENAGENDA_MS = 6000;/);
  assert.match(html, /AbortSignal\.timeout\(DELAI_OPENAGENDA_MS\)/);
});

test("la concurrence est limitée pour ne pas déclencher de rate limit", () => {
  assert.match(html, /const CONCURRENCE_OPENAGENDA = 3;/);
  assert.match(html, /async function parLots\(taches, limite\)\{/);
  assert.match(html, /\}\), CONCURRENCE_OPENAGENDA\);/);
});

test("une panne OpenAgenda rend la dernière réponse valide, jamais rien", () => {
  const bloc = /async function evenementsOpenAgenda\(lat,lng\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /return enCache \? enCache\.items : null;/,
    "un échec ne doit pas vider les événements déjà affichés");
  assert.match(bloc[0], /if\(enCache && Date\.now\(\) - enCache\.le < CACHE_OPENAGENDA_MS\) return enCache\.items;/);
});

test("une tâche en échec n'arrête pas les autres", () => {
  const bloc = /async function parLots\(taches, limite\)\{[\s\S]*?\n\}/.exec(html);
  assert.match(bloc[0], /catch\(e\)\{ resultats\[i\] = \{status:"rejected", reason:e\}; \}/);
});

/* ======================================================================== */
/*  Événements posés au même endroit : une pile, pas une carte à grappes    */
/* ======================================================================== */

test("l'empilement ne touche QUE les événements", () => {
  const bloc = /function empilerEvenements\(items\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc, "empilerEvenements doit exister");
  assert.match(bloc[0], /if\(!l \|\| !estTemporaire\(l\)\)\{ sortie\.push\(item\); return; \}/,
    "les lieux permanents et les grappes existantes doivent passer intacts");
});

test("le regroupement général n'a pas été étendu au zoom 16", () => {
  // `grouper` garde sa porte : au zoom 16 et au-delà, chacun son marqueur
  assert.match(html, /if\(map\.getZoom\(\) >= 16\) return liste\.map\(l=>\(\{seul:l\}\)\);/);
  // et l'empilement est une passe SÉPARÉE, posée sur la sortie de grouper
  assert.match(html, /empilerEvenements\(grouper\(choisis\)\)\.forEach\(item=>\{/);
});

test("le seuil est en pixels d'écran, pas en mètres", () => {
  assert.match(html, /const SEUIL_EMPILEMENT_PX = 24;/);
  const bloc = /function empilerEvenements\(items\)\{[\s\S]*?\n\}/.exec(html);
  assert.match(bloc[0], /map\.latLngToLayerPoint\(\[l\.lat, l\.lng\]\)/,
    "« indissociable au zoom actuel » ne se mesure qu'à l'écran");
});

test("une pile rend un seul marqueur, avec son compteur", () => {
  assert.match(html, /const id = "pile:"\+tete\.id\+"x"\+g\.length;/);
  assert.match(html, /'<i class="evc-plus">\+'\+\(g\.length-1\)\+'<\/i>'/);
  // le compteur est posé en absolu : il n'élargit pas le marqueur
  assert.match(html, /\.evc-plus\{position:absolute;/);
});

test("l'ordre de la liste suit la règle demandée", () => {
  const bloc = /function ordonnerPile\(membres\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc, "ordonnerPile doit exister");
  // 1. en cours · 2. début le plus proche · 3. pertinence
  assert.match(bloc[0], /const enCours = TEMPS\.estMaintenant\(etat\.statut\) \? 0 : 1;/);
  assert.match(bloc[0], /Math\.abs\(etat\.debut - t\)/);
  assert.match(bloc[0], /rang\.has\(l\.id\) \? rang\.get\(l\.id\) : 9999/);
  assert.match(bloc[0], /\(ka\[0\]-kb\[0\]\) \|\| \(ka\[1\]-kb\[1\]\) \|\| \(ka\[2\]-kb\[2\]\)/);
});

test("la liste réutilise la fiche compacte, sans nouveau panneau", () => {
  const bloc = /function ouvrirPileCompacte\(g\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /\$\("#ficheCompacte"\)/,
    "un panneau de plus serait un panneau de plus à connaître");
  assert.match(bloc[0], /pousserEcran\(\(\)=>ouvrirDetail\(l\.id\)\)/);
});
