/* Le contrat du chargement à la demande.

   Le démarrage à froid n'était pas lent à cause d'un calcul : il était lent
   parce que la page téléchargeait tout le programme avant d'en exécuter la
   première ligne. Les écrans qu'un geste ouvre — la fiche d'un lieu,
   l'itinéraire, la publication, le compte — ne servent à personne pendant
   cette attente. Ils vivent donc dans `differe/ecrans.js`, que la page ne
   charge pas.

   Ce fichier vérifie les quatre promesses de ce découpage :

   1. le module reste hors du document ;
   2. chaque nom déplacé existe quand même dès la première seconde ;
   3. un module indisponible ne vide pas l'écran ;
   4. le chemin critique ne dépend d'aucune fonction partie. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const differe = await readFile(new URL("../differe/ecrans.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

const NOMS = JSON.parse("[" +
  /const ECRANS_DIFFERES = \[([\s\S]*?)\];/.exec(app)[1]
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/,\s*$/, "") + "]");

test("les écrans différés ne sont pas chargés par la page", () => {
  assert.doesNotMatch(index, /differe\//,
    "le document ne doit mentionner aucun module différé");
  assert.match(app, /const MODULE_ECRANS = "differe\/ecrans\.js";/);
});

test("chaque nom déplacé est bien défini dans le module, et lui seul", () => {
  assert.ok(NOMS.length >= 20, "la liste doit couvrir les écrans secondaires");
  for (const nom of NOMS) {
    assert.match(differe, new RegExp("^(?:async )?function " + nom + "\\s*\\(", "m"),
      nom + " doit être défini dans differe/ecrans.js");
    assert.doesNotMatch(app, new RegExp("^(?:async )?function " + nom + "\\s*\\(", "m"),
      nom + " ne doit plus peser sur le chemin critique");
  }
});

test("une amorce existe pour chaque nom, dès la première seconde", () => {
  /* Sans elle, un appui pendant le téléchargement lèverait une
     `ReferenceError` au lieu d'ouvrir l'écran. */
  const bloc = /function amorcerEcrans\(\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /ECRANS_DIFFERES\.forEach/);
  assert.match(bloc, /window\[nom\] = amorce;/);
  assert.match(bloc, /amorce\.amorce = true;/);
  assert.match(app, /^amorcerEcrans\(\);$/m,
    "les amorces doivent être posées à l'exécution du fichier, pas plus tard");
});

test("l'amorce rappelle la vraie fonction, sans tourner en rond", () => {
  const bloc = /function ecranAuBesoin\(nom, args\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /const vraie = window\[nom\];/);
  assert.match(bloc, /vraie\.amorce === true/,
    "un module arrivé sans remplacer l'amorce doit s'arrêter, pas se rappeler");
  assert.match(bloc, /return vraie\.apply\(null, args\);/);
});

test("l'écran ne se vide jamais pendant l'aller-retour", () => {
  const bloc = /function ecranAuBesoin\(nom, args\)\{[\s\S]*?\n\}/.exec(app)[0];
  /* `charge()` garde ce qui est affiché et pose une pastille discrète dès que
     l'écran porte déjà quelque chose : c'est la règle « zéro écran vide ». */
  assert.match(bloc, /charge\("Ouverture…"\);/);
  assert.match(bloc, /\.catch\(err=>\{[\s\S]*?charge\(null\);/,
    "un échec doit retirer l'indicateur, pas le laisser tourner");
  assert.match(bloc, /toast\("Écran indisponible/,
    "un geste sans réponse est pire qu'un refus : il faut le dire");
});

test("un échec ne condamne pas le geste suivant", () => {
  const bloc = /function auBesoin\(module\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /modulesDifferes\.delete\(module\);/,
    "une promesse rompue mémorisée rendrait l'écran définitivement inaccessible");
  assert.match(bloc, /const dejaLa = modulesDifferes\.get\(module\);\s*\n\s*if\(dejaLa\) return dejaLa;/,
    "deux appuis rapprochés ne doivent télécharger qu'une fois");
});

test("le module est demandé à l'inactivité, après le démarrage", () => {
  const bloc = /function prechargerEcrans\(\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /ORDO && ORDO\.differer/,
    "la tranche d'inactivité attend que le fil principal soit libre");
  assert.match(app, /prechargerEcrans\(\);/);
  /* Il doit partir APRÈS la main rendue au navigateur, sinon il redevient du
     chemin critique sous un autre nom. */
  const demarrage = /apresPeinture\(\(\)=>chargerLeDemarrage\(rapide\)\);[\s\S]*?prechargerEcrans\(\);/;
  assert.match(app, demarrage,
    "le préchargement suit le démarrage, il ne le précède pas");
});

test("le chemin critique n'appelle aucune fonction restée dans le module", () => {
  /* La règle de sûreté du découpage : `app.js` ne peut appeler qu'un nom
     amorcé. Un appel vers une fonction partie SANS amorce serait une
     `ReferenceError` le jour où ce chemin s'exécute. */
  const definiesDansDiffere = [...differe.matchAll(/^(?:async )?function ([A-Za-zÀ-ÿ_$][\w$À-ÿ]*)\s*\(/gm)]
    .map((m) => m[1]);
  const amorces = new Set(NOMS);
  const nu = app.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
  for (const nom of definiesDansDiffere) {
    if (amorces.has(nom)) continue;
    assert.doesNotMatch(nu, new RegExp("\\b" + nom + "\\s*\\("),
      nom + " est appelée depuis le chemin critique sans amorce");
  }
});
