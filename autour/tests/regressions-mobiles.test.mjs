import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceApplicationSync } from "./source.mjs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = sourceApplicationSync(import.meta.url);

test("Maintenant n'a plus de chemin d'affichage long", () => {
  assert.doesNotMatch(app, /MAINTENANT_TOUT/);
  assert.doesNotMatch(app, /data-mn-tout/);
  assert.doesNotMatch(app, /classerLieux\(evenementsMaintenant\(\)/);
  assert.match(app, /const liste = selectionMaintenant\(\);\s*const combien = liste\.length;/);
  assert.match(app, /const enCours = selectionMaintenant\(\)\.length;/);
  assert.match(app, /feuilleNiveau === "racine" && zoneAffichee && creneau !== "maintenant"/);
  assert.match(app, /if\(compte\) compte\.textContent = String\(n\);/);
});

test("Maintenant porte le titre, la catégorie, l'identité et le temps canoniques", () => {
  const bloc = app.slice(app.indexOf("function versItemMaintenant"),
    app.indexOf("function contexteMaintenant"));
  for (const motif of [
    /const canonique = evenement \? donneesEvenement\(l\) : donneesLieu\(l\);/,
    /titre, title:titre, categorie, category:categorie/,
    /canonical_id:canonicalId, canonical:canonique/,
    /sansNom:l\.sansNom === true \|\| !nomMaintenantExploitable\(titre\)/,
    /tempsValide/,
  ]) assert.match(bloc, motif);
  assert.match(app, /if\(!nomMaintenantExploitable\(titre\) \|\| !l\.cat\) return "";/);
  assert.match(source, /M\.selection\(itemsMaintenant\(ctx\), ctx\)/);
  assert.match(app, /id:e\.id == null \|\| e\.id === "" \? "" : "evt"\+e\.id/);
  assert.match(app, /id:p\.id == null \|\| p\.id === "" \? "" : "pub"\+p\.id/);
});

test("aucune carte Maintenant ne peut afficher un titre vide", () => {
  const ligne = /function ligneMaintenant\(l\)\{[\s\S]*?\n\}\n\nconst ORDO/.exec(app);
  assert.ok(ligne, "ligneMaintenant doit garder une garde avant son rendu");
  assert.match(ligne[0], /nomMaintenantExploitable\(titre\)/);
  assert.match(ligne[0], /esc\(titre\)/);
});

test("les contrôles sont non-déplaçables sans neutraliser le pan de la carte", () => {
  assert.doesNotMatch(html, /\bdraggable\s*=\s*["']true["']/i);
  assert.match(html, /button, \[role="button"\], summary\{[\s\S]*?-webkit-user-drag:none;[\s\S]*?touch-action:manipulation;/);
  assert.match(html, /#navBas, #navBas button,[\s\S]*?touch-action:none;/);
  assert.match(html, /#feuilleBesoins \.fb-poignee\{touch-action:none;/);
  assert.match(html, /#feuilleBesoins \.fb-corps\{touch-action:auto\}/);
  assert.match(html, /#feuilleBesoins \.ong-temps\{touch-action:pan-x\}/);
  assert.match(app, /document\.addEventListener\("dragstart"/);
  assert.match(app, /document\.addEventListener\("selectstart"/);
  assert.doesNotMatch(app, /#navBas[\s\S]{0,500}pointermove/);
});

test("la navigation basse conserve ses boîtes et son centrage", () => {
  assert.match(html, /#navBas\{contain:layout\}/);
  assert.match(html, /#navBas \.nb, #navBas \.nb-creer\{flex:1 0 0;min-width:0\}/);
  assert.match(html, /#navBas \.nb\.actif\{margin:0;transform:none\}/);
  assert.match(html, /#navBas \.nb-plus\{pointer-events:none\}/);
  assert.doesNotMatch(html, /body\.pourtoi-ouvert\s+#navBas\s*\{/);
});

test("le contenu du sheet réserve la safe area et la barre basse", () => {
  assert.match(html, /height:100dvh/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /#feuilleBesoins\.accueil\{max-height:min\(760px,calc\(100dvh - 154px\)\)\}/);
  assert.match(html, /padding-bottom:calc\(var\(--nav-height\) \+ 20px\)/);
});
