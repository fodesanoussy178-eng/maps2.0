import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceApplicationSync } from "./source.mjs";

await import("../plafonds.js");
const P = globalThis.AutourPlafonds;
const html = sourceApplicationSync(import.meta.url);

const liste = (n) => Array.from({ length: n }, (_, i) => ({ id: "l" + i, rang: i }));

/* ==========================================================================
   « Voir tout » avait été débouché — c'était la correction d'un défaut, pas
   une direction de produit. Poussée jusqu'au bout, elle donne un annuaire.
   Autour ne répond pas à « qu'est-ce qui existe ici » mais à « qu'est-ce que
   je fais maintenant » : deux cents réponses valent zéro réponse.
   ========================================================================== */

test("3 résultats connus → Voir tout en montre 3", () => {
  assert.equal(P.appliquer(liste(3), P.limiteMaintenant()).length, 3);
});

test("8 résultats connus → Voir tout en montre 8", () => {
  /* Le plafond est un maximum, jamais un objectif : rien ne complète une
     liste courte pour atteindre le chiffre. Sept excellentes valent mieux
     que dix. */
  assert.equal(P.appliquer(liste(8), P.limiteMaintenant()).length, 8);
});

test("18 résultats Maintenant → Voir tout en montre 10", () => {
  assert.equal(P.appliquer(liste(18), P.limiteMaintenant()).length, 10);
});

test("100 résultats Maintenant → Voir tout en montre 10", () => {
  assert.equal(P.appliquer(liste(100), P.limiteMaintenant()).length, 10);
});

test("zone peu dense → 5 au maximum dans Explorer", () => {
  assert.equal(P.densite(4), "peu");
  assert.equal(P.limiteExplorer(4), 5);
  assert.equal(P.appliquer(liste(4), P.limiteExplorer(4)).length, 4);
});

test("zone normale → 10 au maximum", () => {
  assert.equal(P.densite(20), "normale");
  assert.equal(P.appliquer(liste(20), P.limiteExplorer(20)).length, 10);
});

test("centre-ville dense → 15 au maximum", () => {
  assert.equal(P.densite(120), "dense");
  assert.equal(P.appliquer(liste(120), P.limiteExplorer(120)).length, 15);
});

test("aucun cas ne dépasse jamais vingt", () => {
  /* Le plafond absolu ne dépend d'aucun réglage : même appelé avec mille,
     même sur une zone qu'on déclarerait très dense. */
  for (const n of [0, 1, 19, 20, 21, 200, 5000]) {
    assert.ok(P.appliquer(liste(n), 1000).length <= P.PLAFOND_ABSOLU);
    assert.ok(P.appliquer(liste(n), Infinity).length <= P.PLAFOND_ABSOLU);
    assert.ok(P.limiteExplorer(n) <= P.PLAFOND_ABSOLU);
  }
});

test("l’ordre de pertinence survit à la coupe", () => {
  /* Couper, jamais réordonner. L'ordre qui arrive porte déjà tout le travail
     du moteur — nature, pertinence, distance, diversité ; un tri de plus à la
     fin le déferait sans rien savoir de lui. */
  const source = liste(40);
  const coupe = P.appliquer(source, P.limiteMaintenant());
  assert.deepEqual(coupe.map((x) => x.rang), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // et les objets sont les mêmes, pas des copies remaniées
  coupe.forEach((x, i) => assert.equal(x, source[i]));
});

test("couper ne touche pas à la liste d’origine", () => {
  const source = liste(30);
  P.appliquer(source, 10);
  assert.equal(source.length, 30, "le compteur doit rester honnête");
});

test("aucun mélange entre deux villes : la coupe vient après le filtre de zone", () => {
  /* Le plafond s'applique à ce que la zone active a retenu — il ne peut donc
     pas faire entrer un lieu d'ailleurs. La preuve est structurelle : la
     source de « Voir tout » est `recommandationsAccueil`, qui filtre par
     `dansZoneActive` avant tout classement. */
  assert.match(html, /lieux\.filter\(l=>dansZoneActive\(l\) && nomExploitable\(l\) && isDiscoveryCandidate\(l\)\)/);
  const bloc = html.slice(html.indexOf("const connus = recommandationsAccueil"),
                          html.indexOf("const connus = recommandationsAccueil") + 420);
  assert.match(bloc, /PLAF\.appliquer\(connus,/);
});

test("le compteur dit ce qu’Autour connaît, la liste ce qu’il propose", () => {
  /* « Maintenant (18) » veut dire « Autour en connaît dix-huit ». La liste en
     montre dix : c'est une sélection. Confondre les deux, c'est soit mentir
     sur ce qu'on sait, soit noyer ce qu'on propose. */
  assert.match(html, /const connus = recommandationsAccueil\(Infinity, \{tout:true\}\);/);
  assert.match(html, /PLAF\.limiteMaintenant\(\) : PLAF\.limiteExplorer\(connus\.length\)/);
});

test("le module est chargé avant le code qui s’en sert", () => {
  const i = html.indexOf('src="plafonds.js?v=');
  assert.ok(i > 0);
  assert.ok(i < html.indexOf("const PLAF = window.AutourPlafonds"));
});

test("au bout de la liste, des intentions — jamais « Charger plus »", () => {
  /* Ni pagination infinie ni bouton « Charger plus » : les deux transforment
     une sélection en catalogue, et personne ne choisit dans un catalogue. */
  // aucun bouton de chargement : on cherche le geste, pas le mot en commentaire
  assert.doesNotMatch(html, /<button[^>]*>[^<]*(Charger plus|Voir plus de r)/i);
  assert.doesNotMatch(html, /data-(charger|page|plus)=/i);
  assert.match(html, /function suitesUtiles\(connus, montres\)\{/);
  ["Ce soir", "Ce week-end", "Changer de catégorie", "Explorer cette zone"]
    .forEach((geste) => assert.ok(html.includes(">" + geste + "<"), "manque : " + geste));
  assert.match(html, /\$\("#feuille"\)\.querySelectorAll\("\[data-suite\]"\)/);
});

test("on n’explique la coupe que lorsqu’il y a une coupe", () => {
  // « 8 sur 8 » n'apprend rien ; « 10 sur 42 » explique pourquoi ça s'arrête
  assert.match(html, /const note = connus > montres/);
  assert.match(html, /Autour en connaît '\+connus\+' ici/);
});
