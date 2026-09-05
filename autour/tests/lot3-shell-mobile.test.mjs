/* ===========================================================================
   LOT 3 — Navigation mobile, Maintenant / Pour toi, Explorer, Solidarité

   Une hiérarchie produit, et ce qu'elle interdit :

     · TROIS destinations dans la barre basse, pas six. Ce qui en sort ne
       disparaît pas — Créer devient un geste, Profil un menu, Pour toi une
       lecture — mais rien ne revient s'y asseoir.
     · EXPLORER n'est plus une seconde lecture de Maintenant. S'il montre les
       mêmes trois résultats, il ne sert à rien.
     · LE DESKTOP NE BOUGE PAS. Toutes les règles de ce lot sont bornées au
       mobile ; la pastille de six entrées reste ce qu'elle était.

   Et une règle qui traverse tout le lot : aucun moteur n'est réécrit. Le
   classement, les règles de « Maintenant », la temporalité et la taxonomie
   sont hors de portée — plusieurs tests le vérifient explicitement.
   ======================================================================== */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sourceApplication } from "./source.mjs";

const source = await sourceApplication(import.meta.url);
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const ecrans = await readFile(new URL("../differe/ecrans.js", import.meta.url), "utf8");

const nav = html.slice(html.indexOf('<nav id="navBas">'), html.indexOf("</nav>", html.indexOf('<nav id="navBas">')));
/* Le bloc mobile du lot : c'est là que doivent vivre toutes ses règles de
   mise en page, et nulle part ailleurs. */
const blocMobile = html.slice(html.indexOf("LOT 3 · LE SHELL MOBILE"),
                              html.indexOf("/* Les filtres ne flottent plus"));

/* ---- 1. Trois destinations, et trois seulement ------------------------- */

test("la barre basse ne porte que trois destinations sur mobile", () => {
  /* Les six entrées restent dans le DOM — le desktop s'en sert — mais trois
     portent `nb-desktop` et quittent la barre sous 768px. */
  const toutes = [...nav.matchAll(/data-nb="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(toutes, ["maintenant", "explorer", "creer", "pourtoi", "aide", "profil"]);

  const sorties = [...nav.matchAll(/class="nb[^"]*nb-desktop[^"]*" data-nb="([a-z]+)"/g)]
    .map((m) => m[1]);
  assert.deepEqual(sorties.sort(), ["creer", "pourtoi"],
    "Créer et Pour toi quittent la barre ; Profil en était déjà absent");

  assert.match(blocMobile, /#navBas \.nb-desktop\{display:none\}/);
  /* Et les trois qui restent se partagent la largeur : la grille de référence
     en compte cinq avec des placements explicites, qui laisseraient
     Solidarité collée au bord droit d'une colonne disparue. */
  assert.match(html, /@media \(max-width:768px\)\{\s*\n\s*#navBas\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(html, /#navBas \.nb\[data-nb="aide"\]\{grid-column:3\}/);
});

test("le troisième onglet s'appelle Solidarité, et son backend n'a pas bougé", () => {
  assert.match(nav, /<span>Solidarité<\/span>/);
  assert.doesNotMatch(nav, /<span>Aide<\/span>/,
    "« Aide » se lit comme un support technique : ce produit n'en est pas un");
  /* L'identifiant interne ne change pas — c'est ce qui garantit que le
     classement, la taxonomie et les écrans d'aide ne sont pas touchés. */
  assert.match(nav, /data-nb="aide"/);
  assert.match(app, /if\(id === "aide"\)/);
});

/* ---- 2. Maintenant / Pour toi ------------------------------------------ */

test("le sélecteur de surface porte les deux lectures, et rien d'autre", () => {
  const barre = html.slice(html.indexOf('<div id="selecteurSurface"'),
                           html.indexOf("</div>", html.indexOf('<div id="selecteurSurface"')));
  const surfaces = [...barre.matchAll(/data-surface="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(surfaces, ["maintenant", "pourtoi"]);
  assert.match(barre, /⚡ Maintenant/);
  assert.match(barre, /♡ Pour toi/);
  assert.match(barre, /role="tablist"/);
});

test("« Pour toi » n'est pas devenu un quatrième onglet, et n'a pas disparu", () => {
  /* Il quitte la barre basse sur mobile, mais reste atteignable d'un geste
     depuis le sélecteur, et sa surface existe toujours. */
  assert.match(html, /class="nb nb-pourtoi nb-desktop" data-nb="pourtoi"/);
  assert.match(app, /function ouvrirPourToi\(\)\{/);
  assert.match(app, /function majPourToi\(\)\{/);
  assert.match(html, /id="pourToi"/);
});

test("les accès à Maintenant restent identiques, quel que soit le chemin", () => {
  /* Le marquage du sélecteur vit DANS l'ouverture de la surface, pas à chaque
     appel : c'est ce qui garde barre basse, besoin rapide et badge exactement
     équivalents. */
  const surface = app.slice(app.indexOf("function ouvrirSurfaceMaintenant"),
                            app.indexOf("function brancherBesoinsRapides"));
  assert.match(surface, /marquerSurface\("maintenant"\)/);
  const barre = app.slice(app.indexOf('$("#navBas").querySelectorAll'),
                          app.indexOf('if(id !== "pourtoi") fermerPourToi'));
  assert.match(barre, /if\(id === "maintenant"\)\{\s*ouvrirSurfaceMaintenant\(\);/,
    "aucun geste ne doit s'intercaler entre l'appui et la surface");
});

/* ---- 3. Le sélecteur temporel, dans les deux surfaces ------------------ */

test("les trois créneaux restent ceux du moteur, et sont exposés partout", () => {
  /* Aucune fenêtre n'est inventée : ce sont les créneaux existants, et le
     créneau interne « Bientôt » reste masqué comme avant. */
  for (const label of ["Maintenant", "À venir", "Ce week-end"])
    assert.match(app, new RegExp('label:"' + label + '"'), label);
  assert.match(app, /CRENEAUX\.filter\(c=>c\.id !== "bientot"\)/);

  /* Dans la feuille — donc dans Maintenant et Explorer — comme avant. */
  assert.ok((app.match(/ongletsTemps\(\)/g) || []).length >= 3);
  /* Et désormais aussi dans Pour toi. */
  assert.match(app, /const tempsPourToi = ongletsTemps\(\);/);
  assert.match(app, /corps\.innerHTML = tempsPourToi \+ blocSurveillances\(\) \+ contenu;/);
});

test("changer de créneau dans Pour toi n'en fait pas sortir", () => {
  const brancher = app.slice(app.indexOf("function brancherPourToi"),
                             app.indexOf("[data-pt]"));
  assert.match(brancher, /corps\.querySelectorAll\("\[data-creneau\]"\)/);
  assert.match(brancher, /majPourToi\(\)/);
  /* La porte de la feuille, elle, bascule vers Explorer — c'est voulu, et
     c'est justement la différence entre les deux. */
  assert.doesNotMatch(brancher, /ongletCourant = filtreMaintenant/);
  /* Et la logique temporelle elle-même n'est pas retouchée. */
  assert.match(brancher, /filtreMaintenant = creneau === "maintenant";/);
});

/* ---- 4. Explorer, surface de découverte -------------------------------- */

test("Explorer ouvre sa propre surface, pas une copie de Maintenant", () => {
  assert.match(html, /<div id="explorerDecouverte" hidden/);
  assert.match(app, /function ouvrirExplorerDecouverte\(\)\{/);
  const debut = app.indexOf('$("#navBas").querySelectorAll');
  const handler = app.slice(debut, app.indexOf("fermerExplorerDecouverte();", debut));
  assert.match(handler, /id === "explorer"[\s\S]{0,220}ouvrirExplorerDecouverte\(\)/);
});

test("Explorer propose des intentions, des sélections et des thématiques", () => {
  for (const intention of ["Culture", "Gratuit", "Étudier / travailler",
                           "Sport", "Insolite", "Famille"])
    assert.ok(app.includes('label:"' + intention + '"'), "intention : " + intention);
  for (const selection of ["Expos à voir cette semaine", "Sorties gratuites",
                           "Où étudier au calme", "Que faire quand il pleut",
                           "Musique et concerts", "Nature et balades"])
    assert.ok(app.includes('titre:"' + selection + '"'), "sélection : " + selection);
  assert.match(html, /id="xpIntentions"/);
  assert.match(html, /id="xpSelections"/);
  assert.match(html, /id="xpThemes"/);
  assert.match(html, /Rechercher une activité, un lieu, une envie/);
});

test("Explorer peut montrer ce que Maintenant écarte : plus tard", () => {
  /* Une sélection porte un créneau — donc elle sait proposer « les prochains
     jours », ce que Maintenant ne montrera jamais par construction. */
  assert.match(app, /creneau:"avenir"/);
  const lancer = app.slice(app.indexOf("function lancerDepuisExplorer"),
                           app.indexOf("let explorerDecouverteRemplie"));
  assert.match(lancer, /if\(entree\.creneau && CRENEAUX\.some\(c=>c\.id === entree\.creneau\)\) creneau = entree\.creneau;/,
    "le créneau passe par le moteur existant, jamais par une fenêtre inventée");
  assert.match(lancer, /appliquerPhrase\(entree\.phrase\);/,
    "chaque entrée compose une requête que l'application sait déjà exécuter");
});

test("Explorer ne crée aucun moteur de recommandation", () => {
  const bloc = app.slice(app.indexOf("const XP_INTENTIONS"),
                         app.indexOf("function ouvrirExplorerDecouverte"));
  for (const interdit of [/POIDS/, /rankResults/, /selectionMaintenant/,
                          /classer\(/, /score/i])
    assert.doesNotMatch(bloc, interdit, String(interdit) + " n'a rien à faire ici");
});

/* ---- 5. Créer, en bouton flottant -------------------------------------- */

test("Créer est un bouton flottant qui ouvre le workflow existant", () => {
  assert.match(html, /<button id="fabCreer" type="button"/);
  const fab = app.slice(app.indexOf('if($("#fabCreer"))'),
                        app.indexOf("function marquerSurface"));
  assert.match(fab, /ouvrirCreation\(\);/,
    "la même porte que l'onglet historique : mêmes permissions, même brouillon");
  assert.match(fab, /retourFormulaire = false;/);
});

test("le bouton flottant respecte la safe-area et s'efface sous un panneau", () => {
  assert.match(blocMobile, /#fabCreer\{[\s\S]*?bottom:calc\(var\(--nav-height\) \+ 16px\)/);
  /* `--nav-height` contient déjà la safe-area : l'ajouter une seconde fois
     décollerait le bouton d'une hauteur d'encoche. */
  assert.match(html, /--nav-height:calc\(var\(--safe-b\) \+ 58px\)/);
  /* Chaque classe citée par la règle doit être RÉELLEMENT posée quelque part
     dans le code : une règle qui nomme une classe que personne n'ajoute ne
     protège rien, et rien à l'écran ne le dit. */
  for (const etat of ["sheet-open", "pourtoi-ouvert", "explorer-ouvert"]) {
    assert.ok(blocMobile.includes("body." + etat + " #fabCreer"),
      "le bouton doit reculer sous : " + etat);
    assert.match(source, new RegExp('classList\\.(add|toggle)\\("' + etat + '"'),
      "personne ne pose la classe " + etat);
  }
  /* Le panneau modal, lui, ne pose aucune classe : il bascule son attribut
     `hidden`. Et il est écrit APRÈS le bouton dans le document, donc seul
     `:has()` peut remonter jusqu'à lui. */
  assert.ok(blocMobile.includes("body:has(#feuille:not([hidden])) #fabCreer"),
    "le bouton doit reculer sous le panneau #feuille");
  assert.match(html, /<section id="feuille" hidden/);
});

/* ---- 6. Profil / Plus --------------------------------------------------- */

test("le menu secondaire s'ouvre depuis le haut et porte les bonnes entrées", () => {
  assert.match(html, /id="btnProfilEntete"/);
  assert.match(app, /ouvrirMenuPlus\(\);/);
  const menu = ecrans.slice(ecrans.indexOf("const MENU_PLUS_LIENS"),
                            ecrans.indexOf("function ouvrirAPropos"));
  for (const entree of ["Mon compte", "Mes favoris", "Mes publications",
                        "Support", "Mentions légales", "Confidentialité",
                        "À propos d’Autour"])
    assert.ok(menu.includes(entree), "entrée manquante : " + entree);
});

test("aucune entrée du menu ne pointe vers une fonction qui n'existe pas", () => {
  /* La règle du lot : pas de fonctionnalité fictive. Chaque destination doit
     exister réellement dans le code. */
  /* `ouvrirFavoris` vit dans app.js, les deux autres dans le module d'écrans
     différés : on cherche donc dans la source entière, pas dans un fichier
     choisi d'avance. */
  for (const fn of ["ouvrirProfil", "ouvrirFavoris", "ouvrirMesPublications"])
    assert.match(source, new RegExp("function " + fn + "\\("), fn + " doit exister");
  const menu = ecrans.slice(ecrans.indexOf("const MENU_PLUS_LIENS"),
                            ecrans.indexOf("function ouvrirAPropos"));
  assert.match(menu, /if\(quoi === "favoris"\) return ouvrirFavoris\(\);/);
  assert.match(menu, /if\(quoi === "publications"\) return ouvrirMesPublications\(\);/);
  assert.match(menu, /return ouvrirProfil\(\);/, "« Mon compte » garde le comportement actuel");
});

test("le support ouvre un vrai courrier, les pages légales de vrais liens", () => {
  assert.match(ecrans, /href:"mailto:contact@autour\.eu"/);
  assert.match(ecrans, /href:"\/mentions-legales"/);
  assert.match(ecrans, /href:"\/confidentialite"/);
  /* Et leur contenu n'est pas recopié dans le JS : ce sont de vraies pages,
     avec leurs propres métadonnées et leur propre canonique. */
  assert.doesNotMatch(ecrans, /article 6 III/);
  assert.doesNotMatch(ecrans, /Vercel Inc/);
});

test("« À propos » dit ce qu'est Autour, sans devenir une page de présentation", () => {
  const apropos = ecrans.slice(ecrans.indexOf("function ouvrirAPropos"),
                               ecrans.indexOf("async function ouvrirProfil"));
  assert.match(apropos, /À propos d’Autour/);
  assert.match(apropos, /autour\.eu/);
  assert.ok(apropos.length < 1400, "trois lignes, pas une landing page");
});

/* ---- 7. Le desktop ne bouge pas ---------------------------------------- */

test("tout ce que ce lot ajoute est borné au mobile", () => {
  /* Hors du média mobile, aucune de ces pièces n'existe. */
  assert.match(html, /#selecteurSurface,#fabCreer,#explorerDecouverte\{display:none\}/);
  assert.match(blocMobile, /@media \(max-width:768px\)\{/);
  /* Et la barre desktop garde ses cinq colonnes et ses placements. */
  assert.match(html, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\);/);
  assert.match(html, /#navBas \.nb\[data-nb="pourtoi"\]\{grid-column:4\}/);
  assert.match(html, /#navBas \.nb\[data-nb="aide"\]\{grid-column:5\}/);
});

test("ce qui se rangeait sous l'en-tête descend, sans qu'aucune règle ne le sache", () => {
  /* Le sélecteur de surface prend ce créneau sur mobile. Une seule variable
     porte le décalage : les trois règles concernées ne la connaissent pas. */
  assert.match(html, /--sous-entete:calc\(var\(--header-bas\) \+ 10px\);/);
  assert.match(blocMobile, /:root\{--sous-entete:calc\(var\(--header-bas\) \+ 10px \+ 48px \+ 8px\)\}/);
  assert.match(html, /#charge\{position:absolute;top:var\(--sous-entete\)/);
});

/* ---- 8. Ce que le lot ne devait pas toucher ---------------------------- */

test("le moteur de Maintenant, le scoring et la temporalité sont intacts", () => {
  /* La règle des trois résultats. */
  assert.match(source, /Math\.min\(3, max\)/);
  /* Les créneaux du moteur, inchangés. */
  assert.match(app, /const CRENEAUX = \[/);
  assert.match(app, /SECTIONS_DU_CRENEAU/);
  /* Et la géolocalisation du Lot 1, que ce lot n'approche pas. */
  assert.match(app, /const positionConnue = \(\)=>originePosition !== null && originePosition !== "repli";/);
  assert.match(app, /const ZONE_REPLI_PRODUIT = "mel";/);
});
