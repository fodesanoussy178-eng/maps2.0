/* LA COMPOSITION D'EXPLORER, POINT PAR POINT.

   Quatre règles de cette passe, écrites ici pour qu'on ne les reperde pas :
   le bloc « nouveau » est une PROJECTION de « Pour toi » et non une seconde
   source, « Maintenant » fait la taille de ce qu'il montre, l'interface
   principale n'a pas de bouton pour se fermer, et rien ne promet une
   notification qui n'existe pas. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sourceApplication } from "./source.mjs";

const html = await sourceApplication(import.meta.url);
/* Le moteur de « Maintenant » est un module à part : les règles qui le
   concernent se lisent dans son fichier, pas dans la page. */
const moteur = await readFile(new URL("../maintenant.js", import.meta.url), "utf8");

/* La source SANS ses commentaires. Un commentaire peut nommer une chose
   précisément parce qu'elle n'est pas là — dire « Me prévenir n'existe pas
   encore » ne doit pas compter comme l'afficher. */
const rendu = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ======================================================================== */
/*  1. « ✨ NOUVEAU POUR TOI » — une projection, pas une source             */
/* ======================================================================== */

test("le bloc « nouveau » lit « Pour toi », il ne recalcule rien", () => {
  const bloc = /function nouveauPourToi\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc, "nouveauPourToi doit exister");
  assert.match(bloc[0], /propositionsPourToi\(\)/,
    "il doit partir de la liste déjà classée pour le panneau de droite");
  /* Aucune requête, aucun second classement : une seconde source de vérité
     voudrait dire deux réponses possibles à la même question. */
  assert.doesNotMatch(bloc[0], /rpc\(|fetch\(|await /);
  assert.doesNotMatch(bloc[0], /lieux\.filter|\.sort\(/,
    "reclasser ici ferait diverger les deux écrans");
});

test("« nouveau » veut dire nouveau ET non lu", () => {
  const bloc = /function nouveauPourToi\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /find\(x=>!x\.vu && x\.nouveau\)/,
    "une proposition déjà lue, ou connue depuis une semaine, n'est pas une nouvelle");
  assert.match(bloc, /\|\| null/, "sans rien à annoncer, le bloc n'existe pas");
});

test("le bloc disparaît complètement quand il n'y a rien", () => {
  const bloc = /function blocNouveauPourToi\(\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /if\(!x\) return "";/,
    "pas de cadre vide, pas de titre seul : rien du tout");
  assert.match(bloc[0], /if\(creneau !== "maintenant" \|\| modeAide\) return "";/);
});

test("il se pose entre les onglets de temps et « Maintenant »", () => {
  assert.match(html, /ongletsTemps\(\)\+\s*\n\s*blocNouveauPourToi\(\)\+\s*\n\s*blocMaintenantAccueil\(\)/);
});

test("l'ouvrir le marque lu, comme à droite — une seule notion de « lu »", () => {
  const liant = /querySelectorAll\("\[data-npt\]"\)[\s\S]{0,320}?\}\);/.exec(html);
  assert.ok(liant, "le bloc doit être cliquable");
  assert.match(liant[0], /marquerVu\(\[id\]\)/);
  assert.match(liant[0], /ouvrirDetail\(id\)/);
});

test("il n'affiche que ce qui existe vraiment", () => {
  const bloc = /function blocNouveauPourToi\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  // pas d'image : le pictogramme de la catégorie, jamais une photo d'ailleurs
  assert.match(bloc, /imageDe\(l\)\s*\n?\s*\?/);
  assert.match(bloc, /categorieAffichee\(l\)/);
  // sans date ni lieu exploitables, la ligne disparaît
  assert.match(bloc, /\.filter\(Boolean\)\.join\(" · "\)/);
  assert.match(bloc, /bas \? '<i>/);
});

/* ======================================================================== */
/*  2. « Maintenant » fait la taille de ce qu'il montre                     */
/* ======================================================================== */

test("la hauteur n'est réservée que pendant la collecte", () => {
  assert.match(html,
    /\.mn\[data-mn-etat="loading"\] \.mn-corps\{\s*\n?\s*min-height:calc\(3 \* var\(--mn-ligne\)/,
    "la réserve protège l'arrivée des données, pas l'affichage du résultat");
  assert.match(html, /\.mn-corps\{display:flex;flex-direction:column\}/);
  // « loading » est bien l'état que le moteur nomme
  assert.match(moteur, /LOADING: "loading"/);
});

test("deux résultats occupent deux lignes, pas trois", () => {
  /* La liste est rendue telle quelle : rien ne la complète jusqu'à trois. */
  const bloc = /function blocMaintenantAccueil\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /liste\.map\(ligneMaintenant\)\.join\(""\)/);
  assert.doesNotMatch(bloc, /while\s*\(|\.padEnd\(|Array\(MAINTENANT_APERCU\)/,
    "aucune ligne fantôme ne complète la liste");
});

test("le maximum reste trois", () => {
  assert.match(html, /const MAINTENANT_APERCU = \(window\.AutourMaintenant \|\| \{\}\)\.PLACES \|\| 3/);
  assert.match(moteur, /const PLACES = 3;/);
});

test("l'état vide ne mime plus une liste absente", () => {
  assert.doesNotMatch(html, /\.mn-rien\{flex:1/);
  assert.match(html, /\.mn-rien\{display:flex;flex-direction:column/);
});

/* ======================================================================== */
/*  3. L'interface principale ne se referme pas sur elle-même               */
/* ======================================================================== */

test("sur grand écran, le panneau racine n'a pas de croix", () => {
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("/* ---- grappes de marqueurs"));
  assert.match(desktop, /#feuilleBesoins\.accueil \.fb-x\{display:none\}/);
});

test("la croix reste partout où l'on veut vraiment sortir", () => {
  /* Sur mobile la feuille monte PAR-DESSUS la carte : on doit pouvoir la
     refermer. Et dès qu'on est descendu dans une catégorie, même sur grand
     écran, la feuille redevient quelque chose dont on sort. */
  assert.match(html, /<button class="fb-x" id="fbFermer" aria-label="Fermer">/);
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("/* ---- grappes de marqueurs"));
  assert.doesNotMatch(desktop, /#feuilleBesoins \.fb-x\{display:none\}/,
    "seule la racine perd sa croix, pas la feuille entière");
  // la croix de la feuille de détail, elle, ne bouge pas
  assert.match(html, /<button class="feuille-x" id="feuilleX" aria-label="Fermer">/);
});

/* ======================================================================== */
/*  4. Rien ne promet une notification qui n'existe pas                     */
/* ======================================================================== */

test("« Me prévenir » n'est pas affiché tant que rien ne le tient", () => {
  assert.doesNotMatch(rendu, /Me prévenir/,
    "un bouton qui promet un rappel sans mécanisme de rappel est un mensonge");
  // et rien n'en simule un
  assert.doesNotMatch(rendu, /Notification\.requestPermission|showTrigger|serviceWorker\.register/);
  /* Le code dit tout de même POURQUOI il n'est pas là et où il se brancherait :
     sans cette trace, la prochaine passe le rajouterait à l'aveugle. */
  assert.match(html, /LA RÉFÉRENCE MONTRE AUSSI « Me prévenir »/);
});

test("le rang d'actions existe déjà, prêt à en accueillir un", () => {
  const rang = /function actionsProposition\(l\)\{[\s\S]*?\n\}/.exec(html);
  assert.ok(rang, "les actions d'une carte doivent avoir leur propre fonction");
  assert.match(rang[0], /data-pt-voir/, "« Voir → » reste fonctionnel");
  assert.match(html, /actionsProposition\(l\)\+/,
    "la carte passe par ce rang : ajouter un bouton n'obligera pas à la refaire");
});

test("« Voir → » ouvre bien la fiche", () => {
  const liant = /querySelectorAll\("\[data-pt-voir\]"\)[\s\S]{0,320}?\}\);/.exec(html);
  assert.ok(liant);
  assert.match(liant[0], /ouvrirDetailPourToi\(b\.dataset\.ptVoir\)/);
  assert.match(liant[0], /stopPropagation\(\)/);
  assert.match(html, /const ouvrirDetailPourToi = \(id\)=>\{[\s\S]{0,220}marquerVu\(\[id\]\)[\s\S]{0,240}ouvrirDetail\(id\)/);
});

/* ======================================================================== */
/*  5. Ce qui a été obtenu et ne doit pas repartir                          */
/* ======================================================================== */

test("aucune requête n'a été ajoutée par cette composition", () => {
  ["blocNouveauPourToi", "nouveauPourToi", "majPourToi", "propositionsPourToi",
   "grilleRaccourcisAutour", "actionsProposition"].forEach(nom=>{
    const f = new RegExp("function "+nom+"\\([^)]*\\)\\{[\\s\\S]*?\\n\\}").exec(html);
    assert.ok(f, nom + " doit exister");
    assert.doesNotMatch(f[0], /fetch\(|\.rpc\(|overpass\(/,
      nom + " ne doit déclencher aucune requête");
  });
});

test("« Pour toi » attend que le chemin critique ait rendu la main", () => {
  assert.match(html, /function amorcerPourToi\(\)\{[\s\S]{0,260}ORDO\.differer/);
  assert.match(html, /prechargerEcrans\(\);[\s\S]{0,320}amorcerPourToi\(\);/);
});
