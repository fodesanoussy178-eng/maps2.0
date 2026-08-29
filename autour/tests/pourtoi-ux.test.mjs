import assert from "node:assert/strict";
import test from "node:test";
import { sourceApplication } from "./source.mjs";

const source = await sourceApplication(import.meta.url);
const app = source.slice(source.indexOf("function carteProposition"));

test("la carte Pour toi conserve les images Claude et ouvre toute sa surface", () => {
  const carte = source.slice(
    source.indexOf("function carteProposition"),
    source.indexOf("function actionsProposition"),
  );
  assert.doesNotMatch(carte, /<<<<<<<|=======|>>>>>>>/);
  assert.match(carte, /visuelCarteEvenement\(l, c, "pt"\)/);
  assert.match(carte, /pt-image-shell event-fallback-carte/);
  assert.doesNotMatch(carte, /\? '<img class="pt-img"/);
  assert.match(carte, /data-pt=/);
  assert.match(carte, /role="button" tabindex="0"/);
});

test("Pour toi relie clic, clavier et Voir à la fiche existante", () => {
  const gestes = source.slice(
    source.indexOf("function brancherPourToi"),
    source.indexOf("function marquerVu"),
  );
  assert.match(gestes, /querySelectorAll\("\[data-pt\]"\)/);
  assert.match(gestes, /carte\.onclick/);
  assert.match(gestes, /carte\.onkeydown/);
  assert.match(gestes, /ouvrirDetailPourToi\(carte\.dataset\.pt\)/);
  assert.match(gestes, /querySelectorAll\("\[data-pt-voir\]"\)/);
  assert.match(gestes, /event\.stopPropagation\(\)/);
  assert.match(gestes, /pousserEcran\(\(\)=>ouvrirDetail\(id\)\)/);
});

test("les actions internes restent séparées de l'ouverture de carte", () => {
  const actions = source.slice(
    source.indexOf("function actionsProposition"),
    source.indexOf("function blocSurveillances"),
  );
  assert.match(actions, /pt-billet/);
  assert.match(actions, /data-pt-save/);
  assert.match(actions, /data-pt-share/);
  assert.match(actions, /data-pt-hide/);
  const gestes = source.slice(
    source.indexOf("function brancherPourToi"),
    source.indexOf("function marquerVu"),
  );
  assert.match(gestes, /querySelectorAll\("\.pt-billet"\)/);
  assert.match(gestes, /lien\.onclick=\(event\)=>\{\s*event\.stopPropagation\(\)/);
  assert.match(gestes, /data-pt-save[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(gestes, /data-pt-share[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(gestes, /data-pt-hide[\s\S]*?event\.stopPropagation\(\)/);
});

test("les surveillances sont rendues avant les recommandations", () => {
  assert.match(source, /corps\.innerHTML = blocSurveillances\(\) \+ contenu;/);
  const bloc = source.slice(
    source.indexOf("function blocSurveillances"),
    source.indexOf("function rendreGroupePourToi"),
  );
  assert.match(bloc, /Tes surveillances/);
  assert.match(bloc, /<button id="ptGerer">Gérer<\/button>/);
  const tete = source.slice(source.indexOf('<div class="pt-tete">'), source.indexOf('<div class="pt-corps"'));
  assert.doesNotMatch(tete, /ptGerer/);
});

test("les deux fonctions de l'avatar existent vraiment", () => {
  /* Elles étaient appelées sans être définies. `avatarChoisi` part de
     `majEnteteLieu`, que `demarrer()` exécute : la ReferenceError coupait
     l'amorçage avant la carte, et Explorer restait vide. Le défaut n'était
     visible nulle part tant que la production servait l'ancien arbre. */
  ["avatarChoisi", "sauvegarderAvatar"].forEach((nom) => {
    assert.match(source, new RegExp("function\\s+" + nom + "\\s*\\("),
      nom + " est appelée mais n'est pas définie");
  });
});

test("l'avatar est un choix visuel local réutilisé près de la ville", () => {
  assert.match(source, /const AVATARS_ONBOARDING = Object\.freeze\(\["🧍🏻", "🧍🏼", "🧍🏽", "🧍🏾", "🧍🏿"\]\)/);
  assert.match(source, /avatar:\"\"/);
  assert.match(source, /localStorage\.setItem\(\"autour:profil\", JSON\.stringify\(PROFIL\)\)/);
  assert.match(source, /id="onboardingAvatars" hidden role="group"/);
  assert.match(source, /data-avatar/);
  assert.match(source, /id="hdAvatar" hidden aria-hidden="true"/);
  assert.match(source, /avatar\.textContent = choix;/);
});

test("la protection tactile garde un seul chemin de clic compatible Safari", () => {
  assert.match(app, /Un clic standard est volontaire ici/);
  assert.match(app, /carte\.onclick = \(event\)=>/);
  assert.match(app, /carte\.onkeydown = \(event\)=>/);
  assert.match(app, /event\.target[\s\S]{0,120}closest\("a,button"\)/);
});
