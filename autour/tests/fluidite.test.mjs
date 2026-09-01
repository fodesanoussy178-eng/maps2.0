import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceApplicationSync } from "./source.mjs";

const html = sourceApplicationSync(import.meta.url);

/* Ces tests lisent la source. C'est volontaire et c'est la convention du
   dépôt : l'application est une page unique sans point d'entrée importable,
   et ces contrats sont exactement ceux qu'une refonte distraite casserait
   sans que rien ne le signale. */

/* ======================================================================== */
/*  « Y aller » répond, il ne renvoie pas vers une deuxième décision        */
/* ======================================================================== */

test("« Y aller » de la fiche carte bascule en itinéraire, il ne rouvre pas un menu", () => {
  assert.match(html, /f\.querySelector\("\.fc-y"\)\.onclick[\s\S]{0,420}afficherTrajet\(l\)/,
    "toucher « Y aller » doit produire les moyens d’y aller, pas une fiche à relire");
});

test("« Y aller » et « Voir » ouvrent la fiche par le même chemin", () => {
  // deux boutons voisins qui ouvrent le même écran doivent laisser le bouton
  // retour du téléphone se comporter pareil
  const y = /f\.querySelector\("\.fc-y"\)\.onclick = \(\)=>\{[\s\S]{0,520}?\n  \};/.exec(html);
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
/*  « Y aller » remplace la fiche, il ne l'allonge pas                       */
/* ======================================================================== */

test("la feuille de détail porte deux panneaux, pas deux fiches", () => {
  /* La fiche du lieu et les moyens d'y aller sont deux panneaux du MÊME
     rendu : basculer ne reconstruit rien et ne redemande rien. */
  assert.match(html, /<div class="d-lieu" id="ficheLieu">/);
  assert.match(html, /<div class="itin" id="ficheItineraire" hidden><\/div>/);
  assert.match(html, /let modeFeuille = "lieu";/);
  assert.match(html, /function basculerModeFeuille\(mode\)\{/);
});

test("le mode itinéraire masque tout ce qui décrit le lieu", () => {
  /* Une fois la décision prise, l'image, la catégorie, le prix, la
     description, les horaires et les gestes de découverte n'ont plus rien à
     faire à l'écran : c'est le panneau entier qui disparaît, pas chaque bloc
     un par un. */
  const bloc = /function basculerModeFeuille\(mode\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /lieu\.hidden = versItineraire;/);
  assert.match(bloc, /itineraire\.hidden = !versItineraire;/);
  assert.doesNotMatch(bloc, /innerHTML/,
    "basculer ne doit rien rendre : c'est ce qui le rend instantané");
});

test("« Retour » repose la fiche là où on l’avait laissée", () => {
  const bloc = /function basculerModeFeuille\(mode\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /if\(versItineraire\) defilementFiche = f\.scrollTop;/);
  assert.match(bloc, /f\.scrollTop = versItineraire \? 0 : defilementFiche;/);
  assert.match(html, /retour\.onclick = \(\)=>\{[\s\S]{0,320}?basculerModeFeuille\("lieu"\);/);
  /* Le focus suit la bascule, sinon il reste sur un bouton qui vient de
     disparaître — un clavier ou un lecteur d'écran se retrouve nulle part. */
  assert.match(html, /if\(yAller\) yAller\.focus\(\{preventScroll:true\}\);/);
  assert.match(html, /retour\.focus\(\{preventScroll:true\}\);/);
  /* Deux « Retour » côte à côte ne ramèneraient pas au même endroit. */
  assert.match(bloc, /if\(pile\) pile\.hidden = versItineraire;/);
});

test("choisir un mode interne part en navigation, il ne rouvre pas la fiche", () => {
  assert.match(html, /entrerNav\(options\[Number\(b\.dataset\.opt\)\], l\.titre\)/);
  const bloc = /zone\.querySelectorAll\("\[data-opt\]"\)[\s\S]{0,220}?\}\);/.exec(html)[0];
  assert.doesNotMatch(bloc, /basculerModeFeuille\("lieu"\)|ouvrirDetail/,
    "on est en train de se déplacer : la fiche du lieu ne revient pas");
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
  const bloc = /function basculerVersExplorer\(requete\)\{[\s\S]*?\n {2}\}/.exec(html);
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

test("le compte de « Maintenant » vient de la sélection du moteur", () => {
  assert.match(html, /function totalMaintenant\(\)\{\s*return selectionMaintenant\(\)\.length;\s*\}/);
  assert.match(html, /const enCours = selectionMaintenant\(\)\.length;/);
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
/*  Navigation principale et stabilité du rendu                             */
/* ======================================================================== */

test("la navigation basse porte les six entrées, dans l'ordre", () => {
  const debut = html.indexOf('<nav id="navBas">');
  const fin = html.indexOf("</nav>", debut);
  const nav = html.slice(debut, fin);
  const ordre = [...nav.matchAll(/data-nb="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordre, ["maintenant", "explorer", "creer", "pourtoi", "aide", "profil"]);
});

test("« Maintenant » est une entrée principale et garde ses créneaux", () => {
  assert.match(html, /data-nb="maintenant"/);
  // Les quatre créneaux restent disponibles dans la feuille.
  assert.match(html, /\{ id:"maintenant", label:"Maintenant"\s*\}/);
  assert.match(html, /function ongletsTemps\(\)\{/);
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
  /* Le nombre est celui du BLOC, pas un second comptage. La pastille comptait
     avec le moteur temporel (les seuls événements) pendant que le bloc comptait
     avec le moteur de disponibilité (événements, séances, activités, lieux
     ouverts) : elle annonçait « 0 » — donc restait cachée — au-dessus d'un bloc
     qui proposait trois choses. */
  assert.match(bloc[0], /const n = \(modeNav \|\| modePose \|\| modeAide\) \? 0 : totalMaintenant\(\);/);
  // la pastille reprend exactement la sélection servie par le bloc
  assert.match(bloc[0], /if\(compte\) compte\.textContent = String\(n\);/);
});

test("la pastille suit les données même sans carte", () => {
  // Leaflet vient d'un CDN : il peut manquer, la pastille doit rester juste
  assert.match(html, /majBadgeMaintenant\(\);[\s\S]{0,100}if\(!map\)\{[\s\S]{0,100}return;/);
});

test("un appui sur la pastille ouvre la liste, pas un menu", () => {
  assert.match(html, /\$\("#badgeMaintenant"\)\.onclick = ouvrirSurfaceMaintenant;/);
  const bloc = /function ouvrirSurfaceMaintenant\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /creneau = "maintenant";/);
  assert.match(bloc[0], /ouvrirFeuille2\("racine"\);/);
  assert.match(bloc[0], /marquerNavigation\("maintenant"\)/);
});

test("la pastille s'efface là où la carte appartient à autre chose", () => {
  assert.match(html, /body\.nav #badgeMaintenant,body\.pose #badgeMaintenant\{display:none\}/);
  const bloc = /function majBadgeMaintenant\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.match(bloc[0], /modeNav \|\| modePose \|\| modeAide/);
});

/* ======================================================================== */
/*  Les marqueurs restent collés à la carte pendant qu'on la déplace        */
/* ======================================================================== */

test("la couche Leaflet suit Google en continu, mais regroupée par image", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  /* Chaque `bounds_changed` déclenche un suivi — les marqueurs restent collés —
     mais `suivre` ne fait PLUS un setView synchrone : il ne planifie qu'UNE
     image. `bounds_changed` part plusieurs fois par image chez Google ;
     répondre à chacune reprojetait tout Leaflet deux ou trois fois pour rien. */
  assert.match(g, /carte\.addListener\("bounds_changed", suivre\);/);
  assert.match(g, /carte\.addListener\("idle", reconcilier\);/,
    "`idle` réconcilie exactement, une fois le geste fini");
  const suivre = /const suivre = \(\) => \{[\s\S]*?\n {4}\};/.exec(g);
  assert.ok(suivre, "le suivi est une fonction unique");
  assert.match(suivre[0], /requestAnimationFrame\(appliquerVue\)/,
    "un seul setView par image : le suivi est regroupé sur la prochaine image");
  assert.doesNotMatch(suivre[0], /setView/,
    "le suivi ne fait plus lui-même le setView — c'est l'image regroupée qui l'exécute");
});

test("le garde-fou de synchronisation empêche la boucle Google ↔ Leaflet", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  const suivre = /const suivre = \(\) => \{[\s\S]*?\n {4}\};/.exec(g);
  assert.match(suivre[0], /if \(synchronisation\) return;/,
    "un mouvement venu de Leaflet ne doit pas relancer un suivi");
  const appliquer = /const appliquerVue = \(\) => \{[\s\S]*?\n {4}\};/.exec(g);
  assert.ok(appliquer, "la synchro réelle vit dans appliquerVue");
  assert.match(appliquer[0], /synchronisation = true;[\s\S]*setView[\s\S]*synchronisation = false;/,
    "le garde-fou entoure le setView, pas l'écouteur");
});

test("pendant un geste Google, Autour ne recompose pas à chaque image", () => {
  const g = readFileSync(new URL("../mapProviders/googleMaps.js", import.meta.url), "utf8");
  /* Le fournisseur expose l'état du geste ; `idle` le referme AVANT la synchro
     finale, pour que la cascade complète s'exécute une fois sur ce setView. */
  assert.match(g, /enGeste:enGesteGoogle/, "l'état du geste est exposé à l'application");
  const rec = /const reconcilier = \(\) => \{[\s\S]*?\n {4}\};/.exec(g);
  assert.match(rec[0], /enGeste = false;[\s\S]*appliquerVue\(\);/,
    "hors geste avant la dernière synchro : sa cascade doit s'exécuter");
  /* Côté application : la cascade coûteuse est sautée tant que le geste dure. */
  assert.match(html, /if\(fournisseurGoogleActif && fournisseurGoogleActif\.enGeste && fournisseurGoogleActif\.enGeste\(\)\)\s*\n?\s*return;/);
  const moveend = /map\.on\("moveend zoomend"[\s\S]*?majEpaisseurs\(\); majEtiquettes\(\); majBoutons\(\); planifierCollisions\(\);/.exec(html);
  assert.ok(moveend, "la cascade existe toujours — pour le hors-geste et le natif Leaflet");
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
    /if\(estTemporaire\(l\) && !l\.annule && TEMPS\.estMaintenant\(statutTemps\(l\)\.status\)\)\{/);
});

test("la liste « ⚡ Maintenant (3) » existe, compacte et comptée", () => {
  assert.match(html, /function blocMaintenantAccueil\(\)\{/);
  assert.match(html, /class="mn" data-testid="maintenant-liste"/);
  assert.match(html, /<b>Maintenant<\/b>'\+/);
  assert.match(html, /const combien = liste\.length;/);
  assert.match(html, /'<span>\('\+combien\+'\)<\/span>'/);
  assert.doesNotMatch(html, /MAINTENANT_TOUT|data-mn-tout|["'`]10\+["'`]/);
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
  /* LA RÉSERVE VAUT PENDANT LA COLLECTE, ET SEULEMENT LÀ.

     Elle est en CSS et sur le CORPS plutôt que sur la carte : additionner une
     hauteur d'en-tête SUPPOSÉE donnait quatre pixels d'écart, que le banc de
     navigateur a mesurés. L'en-tête garde sa taille naturelle, le corps
     réserve exactement trois lignes plus le pied — des lignes de hauteur
     FIXE, pas déduite de leur contenu.

     Mais une fois la réponse connue, la garder affichait une ligne et demie
     de blanc sous deux résultats : trois emplacements dessinés pour un
     contenu qui n'en remplit que deux. « Maximum trois », pas « toujours
     trois » — le bloc fait donc la taille de ce qu'il montre. */
  assert.match(html,
    /\.mn\[data-mn-etat="loading"\] \.mn-corps\{\s*\n?\s*min-height:calc\(3 \* var\(--mn-ligne\) \+ var\(--mn-pied\)\)/);
  assert.match(html, /\.mn-corps\{display:flex;flex-direction:column\}/,
    "hors collecte, le corps fait la taille de son contenu");
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
  /* Vide et erreur ne miment plus une liste absente : ils disent ce qu'ils
     ont à dire et s'arrêtent là. */
  assert.doesNotMatch(html, /\.mn-rien\{flex:1/);
  assert.match(html, /\.mn-rien\{display:flex;flex-direction:column/);
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
  /* Maintenant rend son échantillon sélectionné directement. Le panneau ne
     compose donc plus une deuxième liste générique susceptible de recopier un
     événement déjà affiché. */
  assert.match(html, /corps\.innerHTML = ongletsTemps\(\)\+blocMaintenantAccueil\(\)\+blocAideAccueil\(\);/);
  assert.doesNotMatch(html, /corps\.innerHTML = ongletsTemps\(\)\+besoinsRapidesHTML/);
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
  /* La mesure se fait maintenant en UNE passe (étiquette + pastille lues
     d'affilée, 2n getBoundingClientRect au lieu de 3n) ; les pastilles sont
     ensuite enregistrées AVANT la boucle de décision, comme avant. */
  const bloc = /boites\.forEach\(\(\{rr\}\)=>\{[\s\S]*?\}\);/.exec(html);
  assert.ok(bloc, "les pastilles doivent être enregistrées dans la grille");
  assert.match(bloc[0], /enregistrer\(\{x:rr\.left-cadre\.left/);
  assert.ok(html.indexOf("boites.forEach(({rr})=>{") < html.indexOf("const decisions=[];"));
  // la passe de lecture unique : étiquette ET pastille, une fois chacune
  assert.match(html, /const boites = entrees\.map\(\(\{eti,rond\}\)=>\(\{[\s\S]*?r:eti\.getBoundingClientRect\(\),[\s\S]*?rr:rond\.getBoundingClientRect\(\),/);
});

test("la résolution de collisions ne se rejoue pas pour une vue identique", () => {
  /* Plusieurs `moveend` peuvent viser le même point : sans garde-fou, on
     refaisait 120 getBoundingClientRect pour un résultat identique. */
  assert.match(html, /let derniereSignatureCollision = null;/);
  assert.match(html, /if\(signature === derniereSignatureCollision\) return;/);
  // la signature bouge quand les marqueurs sont reconstruits
  assert.match(html, /revisionMarqueurs\+\+;/);
  assert.match(html, /"~"\+revisionMarqueurs/);
});

/* ======================================================================== */
/*  OpenAgenda : aucune lecture fournisseur dans le bundle navigateur        */
/* ======================================================================== */

test("OpenAgenda est désactivé côté navigateur pendant le test serveur", () => {
  assert.doesNotMatch(html, /https:\/\/api\.openagenda\.com/);
  assert.doesNotMatch(html, /CLE_OPENAGENDA/);
  assert.match(html, /async function evenementsOpenAgenda\(\)\{[\s\S]*?return null;/);
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
  assert.match(bloc[0], /const enCours = TEMPS\.estMaintenant\(etat\.status\) \? 0 : 1;/);
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

/* ======================================================================== */
/*  Supabase territorial : SWR borné, coalescé et sans mélange              */
/* ======================================================================== */

test("le cache Supabase est géographique, court et borné", () => {
  assert.match(html, /return "geo@"\+Number\(lat\)\.toFixed\(2\)\+","\+Number\(lng\)\.toFixed\(2\);/);
  assert.match(html, /const CACHE_COUCHE_FRAICHE_MS = 5 \* 60 \* 1000;/);
  assert.match(html, /const CACHE_COUCHE_MAX_MS = 30 \* 60 \* 1000;/);
  assert.match(html, /const CACHE_COUCHES_ZONES_MAX = 4;/);
});

test("une zone ne possède qu'une requête Supabase en vol", () => {
  const bloc = html.slice(html.indexOf("async function rafraichirCoucheSupabase"),
    html.indexOf("function chargerCoucheSupabase", html.indexOf("async function rafraichirCoucheSupabase")));
  assert.match(bloc, /if\(requetesCouchesSupabase\.has\(cle\)\) return requetesCouchesSupabase\.get\(cle\);/);
  assert.match(bloc, /Promise\.all\(\[\s*chargerPublications\(lat,lng\), chargerEvenementsCanoniques\(lat,lng(?:,portee)?\)/);
  assert.match(bloc, /if\(okPublications \|\| okEvenements\)/,
    "une panne totale ne doit jamais remplacer le cache par du vide");
});

test("les deux flux Supabase ne reconstruisent la collection qu'une fois", () => {
  assert.match(html, /function fusionnerLots\(lots, opts\)/);
  assert.match(html, /differerReconstruction:true/);
  assert.match(html, /if\(modifie\) finaliserFusion\(opts\);/);
});

/* ======================================================================== */
/*  Le classement d'accueil n'est calculé qu'une fois par état              */
/* ======================================================================== */

test("un même état ne reclasse pas la liste pour la carte, l'accueil et le panneau", () => {
  /* Ouvrir un panneau enchaîne, dans la même tâche synchrone, le classement de
     la carte, de l'accueil et du panneau — souvent identiques. On garde le
     résultat le temps de la tâche et on le réutilise ; le cache meurt à la
     microtâche suivante, donc au prochain état tout est recalculé. Aucun risque
     de péremption : rien ne change entre deux instructions synchrones. */
  assert.match(html, /let recoBurstCache = null;/);
  assert.match(html, /let classement = recoBurstCache\.get\(cleBurst\);/);
  assert.match(html, /queueMicrotask\(\(\)=>\{ recoBurstCache = null; \}\)/,
    "le cache ne survit pas à la tâche : pas de résultat périmé");
  // la clé porte l'état dont dépend le classement, dont la révision des lieux
  assert.match(html, /const cleBurst = /);
  assert.match(html, /"\|r"\+revisionLieux/);
  assert.match(html, /revisionLieux\+\+;/, "une donnée nouvelle invalide le cache");
});
