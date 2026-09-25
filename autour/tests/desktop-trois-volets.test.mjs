/* LES TROIS VOLETS SUR ORDINATEUR, ET LE LIEN ENTRE EUX.

   Sur ordinateur, la géométrie était déjà à deux volets : recommandations à
   gauche, carte en fond. Le détail d'un lieu, lui, montait encore du BAS sur
   toute la largeur, avec un voile par-dessus la carte — le geste du pouce
   transposé à une fenêtre de 1 440 px. Pendant qu'on lit une fiche, la carte
   était donc couverte aux deux tiers ET inerte, au moment précis où l'on veut
   voir où est le lieu.

   Ce fichier fixe trois choses :
     · la fiche prend la colonne de droite à partir de 1 280 px ;
     · la carte reste vivante — le voile ne la couvre plus ;
     · la liste parle à la carte : `revelerSurCarte` met le lieu en avant et le
       ramène dans la partie visible, avec un encombrement MESURÉ.

   Mesuré aussi dans Chromium, à 320, 390, 768, 1024, 1100, 1280, 1440 et
   1920 px (sonde de rendu) : sous 1 280 px la feuille du bas est inchangée,
   au-dessus la fiche est à droite, la poignée disparaît, le voile est
   transparent et traversable, et aucun débordement horizontal n'apparaît. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const css = lire("autour.css");
const app = lire("app.js");
const ecrans = lire("differe/ecrans.js");

/* ==========================================================================
   1. LA GÉOMÉTRIE
   ======================================================================== */

test("la fiche devient la colonne de droite à partir de 1 280 px", () => {
  const bloc = css.slice(css.indexOf("@media (min-width:1280px)"));
  assert.ok(bloc, "le palier 1 280 px doit exister");
  assert.match(bloc, /#feuille:has\(#ficheLieu\)/);
  assert.match(bloc, /right:var\(--marge-desktop\)/);
  assert.match(bloc, /width:var\(--detail\)/);
  /* La largeur se contracte pour laisser de la carte : c'est la raison d'être
     du palier à 1 280 et non à 1 100. */
  assert.match(bloc, /--detail:min\(var\(--pourtoi\)/);
  assert.match(bloc, /300px/);
});

test("sous 1 280 px, la feuille du bas n'est pas touchée", () => {
  /* La règle de base reste celle d'origine : left/right 0, ancrée en bas. */
  assert.match(css, /#feuille\{position:absolute;left:0;right:0;bottom:0/);
  const avant1280 = css.slice(0, css.indexOf("@media (min-width:1280px)"));
  assert.ok(!/#feuille:has\(#ficheLieu\)/.test(avant1280),
    "aucune règle de colonne ne doit s'appliquer avant le palier");
});

test("la carte reste cliquable quand la fiche est un volet", () => {
  const bloc = css.slice(css.indexOf("@media (min-width:1280px)"));
  assert.match(bloc, /body:has\(#feuille:not\(\[hidden\]\) #ficheLieu\) #voile/);
  assert.match(bloc, /pointer-events:none/);
});

test("aucun `:has()` imbriqué dans un autre — c'est invalide, donc silencieux", () => {
  /* LE PIÈGE, RENCONTRÉ ICI MÊME. `body:has(#feuille:not([hidden]):has(#ficheLieu))`
     est un `:has()` dans un `:has()` : le sélecteur est invalide, la règle est
     ignorée sans un mot, et le fichier a l'air de dire le contraire de ce que
     le navigateur fait. Mesuré : le voile restait cliquable. La règle
     ci-dessous vaut pour toute la feuille, pas seulement pour ce cas. */
  const imbrique = /:has\([^()]*(?:\([^()]*\)[^()]*)*:has\(/;
  /* On teste les RÈGLES, pas la prose : le commentaire qui explique le piège
     contient justement l'écriture fautive, en exemple. */
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.ok(!imbrique.test(sansCommentaires),
    "un :has() imbriqué rend la règle invalide et muette");
});

/* ==========================================================================
   2. L'ENCOMBREMENT, MESURÉ ET NON DEVINÉ
   ======================================================================== */

function encombrementAvec(panneaux, {largeur, hauteur}) {
  const source = app.slice(app.indexOf("const PANNEAUX_CARTE"),
    app.indexOf("function revelerSurCarte"));
  assert.ok(source.includes("function encombrementCarte"), "fonction introuvable");
  const element = (boite) => ({
    hidden: false,
    getBoundingClientRect: () => boite,
  });
  const rect = (x, y, l, h) => ({left: x, top: y, right: x + l, bottom: y + h, width: l, height: h});
  const objets = new Map(Object.entries(panneaux).map(([sel, b]) =>
    [sel, element(rect(b.x, b.y, b.l, b.h))]));
  const faux$ = (sel) => objets.get(sel) || null;
  const style = (el) => ({display: "block", visibility: "visible",
    opacity: panneaux.__opacite === el ? "0" : "1", pointerEvents: "auto"});
  const carte = {getContainer: () => ({
    getBoundingClientRect: () => rect(0, 0, largeur, hauteur)})};
  return new Function("$", "getComputedStyle", "map",
    source + "; return encombrementCarte;")(faux$, style, carte)();
}

const BUREAU = {largeur: 1440, hauteur: 900};

test("la pastille de navigation flottante n'est pas une colonne de gauche", () => {
  /* MESURÉ DANS CHROMIUM : à 1 440 px, `#navBas` est une pastille CENTRÉE de
     1 120 px de large, dont le bord gauche tombe à 160 px. La première version
     classait par « touche le bord gauche » : elle y voyait une colonne et
     volait 40 % de la carte. La forme tranche — plus large que haute, donc une
     bande, et une bande basse. */
  const m = encombrementAvec({"#navBas": {x: 160, y: 788, l: 1120, h: 88}}, BUREAU);
  assert.equal(m.paddingTopLeft[0], 14, "rien à gauche");
  assert.ok(m.paddingBottomRight[1] >= 100, "une bande basse : " + m.paddingBottomRight[1]);
});

test("le volet de droite est compté comme tel, même à opacité nulle", () => {
  /* La fiche est mesurée à la frame où son animation d'entrée commence : son
     opacité vaut alors 0. L'écarter pour ça revenait à ne jamais compter le
     seul panneau pour lequel cette fonction existe. */
  const panneaux = {"#feuille": {x: 1010, y: 102, l: 420, h: 770}};
  const m = encombrementAvec(panneaux, BUREAU);
  assert.ok(m.paddingBottomRight[0] >= 430,
    "le volet de droite doit être réservé : " + m.paddingBottomRight[0]);
  assert.equal(m.paddingTopLeft[0], 14);
});

test("la barre d'envies est une bande haute, le panneau de gauche une colonne", () => {
  const m = encombrementAvec({
    "#appHeader": {x: 28, y: 28, l: 1384, h: 58},
    "#feuilleBesoins": {x: 28, y: 102, l: 530, h: 700},
  }, BUREAU);
  assert.ok(m.paddingTopLeft[1] >= 86, "bande haute : " + m.paddingTopLeft[1]);
  assert.ok(m.paddingTopLeft[0] >= 558, "colonne de gauche : " + m.paddingTopLeft[0]);
});

test("sur téléphone, la feuille du bas est une bande basse", () => {
  const m = encombrementAvec({"#feuille": {x: 0, y: 500, l: 390, h: 344}},
    {largeur: 390, hauteur: 844});
  /* Bornée à 40 % de la hauteur : une feuille qui occupe 40 % de l'écran ne
     peut pas réserver tout l'écran, sinon `panInside` n'aurait plus de zone
     utile où poser le point. */
  assert.ok(m.paddingBottomRight[1] >= 300, "bande basse : " + m.paddingBottomRight[1]);
  assert.ok(m.paddingBottomRight[1] <= Math.round(844 * 0.4), "bornée");
  assert.equal(m.paddingBottomRight[0], 14, "rien à droite");
});

test("deux volets ne peuvent pas fermer la carte : chaque côté est borné", () => {
  const m = encombrementAvec({
    "#feuilleBesoins": {x: 0, y: 0, l: 900, h: 900},
    "#feuille": {x: 1000, y: 0, l: 440, h: 900},
  }, BUREAU);
  const plafond = Math.round(1440 * 0.4);
  assert.ok(m.paddingTopLeft[0] <= plafond, "gauche bornée : " + m.paddingTopLeft[0]);
  assert.ok(m.paddingBottomRight[0] <= plafond, "droite bornée : " + m.paddingBottomRight[0]);
  assert.ok(m.paddingTopLeft[0] + m.paddingBottomRight[0] < 1440,
    "il doit rester de la carte");
});

test("sans carte installée, la mesure ne prétend rien", () => {
  const source = app.slice(app.indexOf("const PANNEAUX_CARTE"),
    app.indexOf("function revelerSurCarte"));
  const sansCarte = new Function("$", "getComputedStyle", "map",
    source + "; return encombrementCarte;")(() => null, () => ({}), null);
  assert.equal(sansCarte(), null);
});

/* ==========================================================================
   3. LA LISTE PARLE À LA CARTE
   ======================================================================== */

test("ouvrir une fiche depuis la liste met le lieu en avant sur la carte", () => {
  const bloc = ecrans.slice(ecrans.indexOf("function ouvrirDetail"),
    ecrans.indexOf("async function chargerSeances"));
  assert.match(bloc, /revelerSurCarte\(l\)/,
    "le lien liste → carte manquait, et c'est tout l'intérêt des trois volets");
});

test("`revelerSurCarte` déplace la carte seulement si le point est caché", () => {
  const source = app.slice(app.indexOf("function revelerSurCarte"),
    app.indexOf("/* La liste des événements posés au même endroit"));
  /* `panInside` de Leaflet ne bouge que si le point est hors de la zone utile :
     c'est ce qui garantit qu'on ne vole pas le cadrage choisi. Mesuré dans
     Chromium à huit largeurs : un point caché ramène la carte, un point déjà
     visible ne la bouge pas d'un pixel. */
  assert.match(source, /panInside/);
  assert.match(source, /mettreEnAvant/);
  assert.match(source, /Number\.isFinite\(lat\)/,
    "un lieu sans coordonnées ne doit pas faire bouger la carte");
});

test("la mise en avant est relâchée quand la fiche se referme", () => {
  assert.match(app, /mettreEnAvant\(null\)/);
});
