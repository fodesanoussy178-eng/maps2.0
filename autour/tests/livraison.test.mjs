/* La livraison allégée : ce qu'elle a le droit de faire, et pas plus.

   `outils/alleger.mjs` produit la copie qu'on déploie : le même programme,
   sans les commentaires. C'est de loin le plus gros levier du démarrage à
   froid — 137 ko gzip sur 312, mesurés — et c'est aussi le genre de
   transformation qui peut corrompre un programme en silence si on la fait à
   coups d'expressions régulières.

   Ces tests fixent les garde-fous : un vrai analyseur, aucune minification
   des identifiants, aucune transposition de syntaxe, et une vérification que
   les déclarations de premier niveau sont toutes là, dans le même ordre. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

import { MODULES, MODULES_DIFFERES } from "./empreintes.mjs";

const outil = await readFile(new URL("../outils/alleger.mjs", import.meta.url), "utf8");

test("le retrait passe par un analyseur, pas par des expressions régulières", () => {
  /* Une barre oblique peut être une division, un littéral d'expression
     régulière ou le début d'un commentaire. Se tromper une fois suffit. */
  assert.match(outil, /import \{ transform \} from "esbuild";/);
  assert.match(outil, /legalComments: "none"/);
});

test("rien n’est minifié ni transposé", () => {
  /* Renommer les identifiants rendrait toute pile d'appels de production
     illisible ; transposer changerait le code au lieu de l'alléger. */
  assert.match(outil, /minify: false/);
  assert.match(outil, /minifyIdentifiers: false/);
  assert.match(outil, /minifySyntax: false/);
  assert.match(outil, /minifyWhitespace: false/);
  assert.match(outil, /target: "esnext"/);
});

test("l’outil refuse de livrer si une déclaration a bougé", () => {
  const bloc = /function declarations\(source\) \{[\s\S]*?\n\}/.exec(outil)[0];
  assert.match(bloc, /matchAll/);
  assert.match(outil, /avant\.length !== apres\.length \|\| avant\.some\(\(n, i\) => n !== apres\[i\]\)/);
  assert.match(outil, /process\.exitCode = 1;/);
});

test("le dépôt n’est jamais modifié par l’allègement", () => {
  /* La prose appartient à la source. L'outil écrit ailleurs, toujours. */
  assert.match(outil, /const SORTIE = join\(RACINE, iSortie === -1 \? "livraison" : args\[iSortie \+ 1\]\);/);
  assert.doesNotMatch(outil, /writeFile\(join\(RACINE,/,
    "aucune écriture ne doit viser la racine du dépôt");
});

test("la copie allégée n’entre pas dans le dépôt", async () => {
  const ignore = await readFile(new URL("../../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^autour\/livraison$/m,
    "un dossier généré commité finit par diverger de sa source");
});

test("ni le banc, ni les tests, ni les migrations ne sont livrés", () => {
  const bloc = /const HORS_LIVRAISON = new Set\(\[[^\]]*\]\)/.exec(outil)[0];
  for (const dossier of ["outils", "tests", "docs", "supabase"])
    assert.match(bloc, new RegExp('"' + dossier + '"'), dossier + " ne doit pas être servi");
});

/* ---- La preuve, sur le vrai code ---------------------------------------- */

test("chaque module servi survit à l’allègement, déclarations intactes", async () => {
  /* On refait ici ce que fait l'outil, sur tous les fichiers réellement
     servis : si l'un d'eux ne repassait pas, la livraison serait cassée sans
     qu'aucun test unitaire ne le dise. */
  const declarations = (s) =>
    [...s.matchAll(/^(?:async )?function ([A-Za-zÀ-ÿ_$][\w$À-ÿ]*)\s*\(/gm)].map((m) => m[1]);

  let avant = 0, apres = 0;
  for (const module of MODULES.concat(MODULES_DIFFERES)) {
    const source = await readFile(new URL("../" + module, import.meta.url), "utf8");
    const { code } = await transform(source, {
      loader: "js", minify: false, minifyIdentifiers: false, minifySyntax: false,
      minifyWhitespace: false, legalComments: "none", target: "esnext",
    });
    assert.deepEqual(declarations(code), declarations(source),
      module + " perd ou déplace une déclaration à l’allègement");
    avant += source.length; apres += code.length;
  }
  /* Un fichier déjà dense peut grossir de quelques octets à la réimpression :
     c'est le TOTAL qui doit fondre, et franchement. Le jour où ce gain
     disparaîtrait, l'étape de livraison ne servirait plus à rien et il
     faudrait le savoir. */
  assert.ok(apres < avant * 0.75,
    "l’allègement doit retirer au moins un quart du code servi : " +
    Math.round(avant / 1024) + " ko → " + Math.round(apres / 1024) + " ko");
});
