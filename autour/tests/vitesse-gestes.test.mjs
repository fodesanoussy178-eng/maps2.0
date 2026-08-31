import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sourceApplication } from "./source.mjs";

const src = await sourceApplication(import.meta.url);
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appSeul = await readFile(new URL("../app.js", import.meta.url), "utf8");
/* Le corps de l'application se lit désormais en deux fichiers : `app.js`
   pour le chemin critique, `differe/ecrans.js` pour les écrans qu'un
   geste ouvre. Les règles ci-dessous portent sur le corps, pas sur la
   répartition — sauf celle qui pèse `app.js`, qui garde `appSeul`. */
const app = src;

/* ======================================================================== */
/*  Le chemin critique : rien d'utile ne doit attendre 680 ko               */
/* ======================================================================== */

test("le corps du programme est un fichier archivable, pas un bloc en ligne", () => {
  /* Mesuré : en ligne, PAS UNE LIGNE ne s'exécutait avant que les 680 ko du
     document ne soient arrivés — 1,3 s à chaque visite, puisqu'un document
     HTML se revalide là où un .js s'archive pour un an. Sorti dans app.js :
     interface vivante à 411 ms au lieu de 1351 ms. */
  assert.match(index, /<script src="app\.js\?v=[a-f0-9]{8}" defer><\/script>/);
  assert.doesNotMatch(index, /<script>\s*\n\s*\/\* =+\s*\n\s*Autour/,
    "le corps ne doit plus être recopié en ligne");
  // et il reste petit : c'est ce qui arrive en premier sur le réseau
  assert.ok(index.length < 200000,
    "index.html doit rester léger, vu : " + Math.round(index.length / 1024) + " ko");
  assert.ok(appSeul.length > 400000, "app.js porte bien le corps du programme");
});

test("aucun script ne bloque l'analyse du document", () => {
  const balises = index.match(/<script src="[^"]+"[^>]*>/g) || [];
  const locales = balises.filter((b) => !/^<script src="https?:/.test(b));
  assert.ok(locales.length >= 20, "les modules doivent être là");
  locales.forEach((b) => assert.match(b, /\bdefer\b/,
    "script bloquant l'analyse : " + b));
});

test("l'ordre d'exécution est préservé : les modules avant le corps", () => {
  /* `defer` conserve l'ordre du document. Le corps lit `window.AutourCore`,
     `window.AutourContexte` et consorts au moment de son évaluation : il doit
     rester LE DERNIER. */
  const dernier = index.lastIndexOf('<script src="app.js');
  ["core.js", "contexte.js", "ordonnanceur.js", "maintenant.js"].forEach((m) => {
    const i = index.indexOf('<script src="' + m);
    assert.ok(i > 0 && i < dernier, m + " doit être chargé avant app.js");
  });
});

/* ======================================================================== */
/*  Un geste, une conséquence                                              */
/* ======================================================================== */

test("la poignée ne laisse pas le clic doubler le glissement", () => {
  /* Le défaut vécu : tirer la poignée vers le haut faisait « moyenne →
     dépliée » au relâchement, puis « dépliée → réduite » au clic qui suit.
     Deux crans pour un geste — et vers le bas, la feuille se fermait. */
  assert.match(app, /let glissementAAgi = false;/);
  assert.match(app, /if\(glissementAAgi\)\{ glissementAAgi = false; return; \}/);
  const bloc = /poigneeFeuille\.addEventListener\("pointerup"[\s\S]*?\n\}\);/.exec(app)[0];
  assert.match(bloc, /glissementAAgi = true;[\s\S]*?reglerEtatFeuille/);
  assert.match(bloc, /glissementAAgi = true; reduireDUnCran\(\);/);
});

test("un geste de poignée interrompu rend la main", () => {
  assert.match(app, /poigneeFeuille\.addEventListener\("pointercancel",relacherPoignee\);/);
});

test("faire défiler le panneau ne le ferme pas", () => {
  /* Le panneau défile ET écoutait le balayage sur lui-même : tirer la liste
     vers le bas de plus de 90 px — c'est-à-dire défiler — le fermait. */
  const bloc = /feuilleDetail\.addEventListener\("touchend"[\s\S]*?\n\},\{passive:true\}\);/.exec(app)[0];
  assert.match(bloc, /if\(depart\.scroll > 2\) return;/,
    "un balayage ne ferme que s'il part du haut");
  assert.match(bloc, /if\(feuilleDetail\.scrollTop > 2\) return;/,
    "un geste qui a fait défiler a servi à défiler");
  assert.match(app, /feuilleDetail\.addEventListener\("touchcancel"/);
});

test("un pincement n'est pas un balayage", () => {
  const bloc = /feuilleDetail\.addEventListener\("touchstart"[\s\S]*?\n\},\{passive:true\}\);/.exec(app)[0];
  assert.match(bloc, /if\(e\.touches\.length > 1\)/);
});

test("la hauteur du panneau s'écrit une fois par image, et seulement si elle change", () => {
  /* Appelée par un ResizeObserver, donc à chaque image des 220 ms
     d'animation : un getBoundingClientRect (mise en page synchrone forcée) et
     une écriture de variable CSS sur documentElement (invalidation du style de
     tout le document), treize fois par ouverture. */
  assert.match(app, /let syncHauteurPlanifiee = false;/);
  assert.match(app, /if\(hauteur === hauteurFeuillePubliee\) return;/);
  const bloc = /function synchroniserHauteurFeuille\(\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /if\(syncHauteurPlanifiee\) return;/);
  assert.match(bloc, /requestAnimationFrame\(mesurerHauteurFeuille\)/);
});

/* ======================================================================== */
/*  Explorer : jamais plusieurs secondes sans retour                        */
/* ======================================================================== */

test("taper ne recompose pas les marqueurs à chaque lettre", () => {
  const bloc = /\$\("#rech"\)\.oninput=e=>\{[\s\S]*?\n\};/.exec(app)[0];
  assert.doesNotMatch(bloc, /\n\s*rendre\(\);/,
    "rendre() ne doit plus être appelé à chaque frappe");
  assert.match(bloc, /minuteurRenduRecherche = setTimeout\(\(\)=>rendre\(\), \d+\);/);
  // les suggestions, elles, restent au rythme de la frappe
  assert.match(bloc, /minuteurSug = setTimeout\(\(\)=>suggerer\(recherche\), 130\);/);
});

test("une recherche de ville en remplace une autre, y compris en vol", () => {
  /* Sans annulation, taper une ville puis se raviser laissait les deux
     géocodages courir : c'est le premier arrivé qui déplaçait la carte. */
  assert.match(app, /nouvelleGeneration\("recherche:zone", destination, true\)/);
  assert.match(app, /await rechercheGeographique\(destination, generation\)/);
  assert.match(app, /if\(!generationCourante\(generation\)\) return;\s+\/\/ une autre recherche/);
  assert.match(app, /async function rechercheGeographique\(q, generationOuSignal\)\{[\s\S]{0,300}const zone = await geocoderVille\(q, null, signal\);/);
});

/* ======================================================================== */
/*  « Maintenant » : une sélection assumée, jamais un inventaire tronqué    */
/* ======================================================================== */

test("« Maintenant » dit qu'il cherche encore plutôt que de laisser croire au vide", () => {
  assert.match(app, /function aveuCouvertureMaintenant\(combienAffiches\)\{/);
  const bloc = /function aveuCouvertureMaintenant\(combienAffiches\)\{[\s\S]*?\n\}/.exec(app)[0];
  // rien tant que la sélection tient debout toute seule
  assert.match(bloc, /if\(combienAffiches >= MAINTENANT_APERCU\) return "";/);
  // rien non plus quand tout a répondu : le peu affiché est alors la vérité
  assert.match(bloc, /if\(!cherche && !panne\) return "";/);
  assert.doesNotMatch(bloc, /<button/, "un aveu ne réclame rien");
});

test("« Maintenant » n'ouvre pas une seconde liste", () => {
  assert.doesNotMatch(app, /MAINTENANT_TOUT|data-mn-tout/);
  assert.match(app, /const combien = liste\.length;/);
});

test("le principe de « Maintenant » n'a pas bougé", () => {
  // les mêmes trois sont servies par le moteur et par les compteurs
  assert.match(src, /MAINTENANT_APERCU = \(window\.AutourMaintenant \|\| \{\}\)\.PLACES \|\| 3/);
  assert.match(app, /const enCours = selectionMaintenant\(\)\.length;/);
  assert.match(app, /TEMPS\.estMaintenant\(statutTemps\(l, t\)\.statut\)/);
});

/* ======================================================================== */
/*  Ce que la passe précédente a acquis et qui ne doit pas se perdre        */
/* ======================================================================== */

test("déduplication, diversité, noms réels et paliers sont toujours en place", () => {
  assert.match(src, /lieux = fusionnerFichesFournisseurs\(dedupeItems\(\[/);
  assert.match(src, /diversite:diversiteDemandee\(\)/);
  assert.match(src, /function nomReelOsm\(tags\)\{/);
  assert.match(src, /titre: nom \|\| CATS\[cat\]\.label,/);
});

test("les cartes déjà rendues tiennent la place, et l'indicateur reste discret", () => {
  assert.match(src, /let dernierRecoRendu = null;/);
  assert.match(src, /function indicateurRechercheHTML\(nombreResultats\)\{/);
  assert.match(src, /Autour cherche autour de toi…/);
});

test("l'abandon des générations obsolètes est intact", () => {
  assert.match(src, /function generationCourante\(generation\)\{/);
  assert.match(src, /function annulerChargementsZone\(saufCanal\)\{/);
  assert.match(src, /if\(!o\.force && zonesVues\.has\(cle\)\) return Promise\.resolve\(\[\]\);/);
});

test("stale-while-revalidate reste le comportement du cache de zone", () => {
  const bloc = /const enCache = lireCacheProche\(lat,lng\);[\s\S]{0,400}/.exec(src)[0];
  assert.match(bloc, /fusionner\(enCache\);/);
  assert.match(bloc, /PERF\.jalon\("cached_pois_visible"\);/);
});

/* ======================================================================== */
/*  Vignettes : préparées, pas allumées                                     */
/* ======================================================================== */

test("l'emplacement d'une vignette existe et ne peut pas déplacer la mise en page", () => {
  // la tuile de repli occupe déjà la place finale ; l'image se pose dessus
  assert.match(index, /\.rc-photo\{display:block;height:74px/);
  assert.match(index, /\.rc-photo img\{position:absolute;inset:0/);
  assert.match(index, /\.ac-photo\{position:relative;[^}]*width:46px;height:46px/);
  assert.match(index, /\.ac-photo img\{position:absolute;inset:0/);
  // et rien de tout cela ne touche le fond de carte
  assert.doesNotMatch(index, /#map[^{]*\{[^}]*background-image/);
});

test("aucune image n'est sur le chemin critique", () => {
  const cartes = src.match(/<img loading="[^"]*"/g) || [];
  cartes.forEach((b) => assert.match(b, /loading="lazy"/,
    "toute vignette doit rester différée : " + b));
});
