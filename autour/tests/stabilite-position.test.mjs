import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function blocFonction(nom){
  const debut = app.search(new RegExp("^function " + nom + "\\(", "m"));
  assert.ok(debut >= 0, nom + " est introuvable");
  const ouverture = app.indexOf("{", debut);
  let profondeur = 0;
  for(let i = ouverture; i < app.length; i += 1){
    if(app[i] === "{") profondeur += 1;
    if(app[i] === "}"){
      profondeur -= 1;
      if(profondeur === 0) return app.slice(debut, i + 1);
    }
  }
  throw new Error("fonction non fermée : " + nom);
}

test("le Bitmoji est une commande de retour GPS, pas une ouverture de fiche", () => {
  const bloc = /if\(\$\("#hdAvatar"\)\) \$\("#hdAvatar"\)\.onclick = e=>\{[\s\S]*?\n\};/.exec(app)?.[0];
  assert.ok(bloc, "le clic du Bitmoji doit être câblé explicitement");
  assert.match(bloc, /e\.stopPropagation\(\);/);
  assert.match(bloc, /fermerLocalisation\(\);/);
  assert.match(bloc, /revenirAutourDeMoi\(\);/);
});

test("un retour demandé pendant un GPS en vol est consommé par la prochaine mesure", () => {
  const retour = blocFonction("revenirAutourDeMoi");
  const position = blocFonction("appliquerPosition");
  const suivi = blocFonction("suivreMaPosition");
  assert.match(retour, /retourPositionDemande = true;/);
  assert.match(retour, /suivreMaPosition\(\{reproposer:true\}\);/);
  assert.match(position, /const retourDemande = retourPositionDemande;/);
  assert.match(position, /retourPositionDemande = false;/);
  assert.match(position, /if\(retourDemande\) reinitialiserContextePourRetour\(\);/);
  assert.match(position, /const doitRestaurerZone = retourDemande \|\| !destinationAvant;/);
  assert.match(suivi, /if\(localisationEnCours\) return;/);
  assert.match(suivi, /if\(retourPositionDemande\) retourPositionDemande = false;/);
});

test("le retour GPS invalide la ville regardée et recharge Aide autour du vrai point", () => {
  const position = blocFonction("appliquerPosition");
  const retour = blocFonction("revenirAutourDeMoi");
  const aide = blocFonction("rafraichirAideDepuisZone");
  assert.match(position, /if\(retourDemande\) annulerChargementsZone\(\);/);
  assert.match(position, /if\(bouge && CTX && \(retourDemande \|\| !zoneActive/);
  assert.match(position, /if\(modeAide\) rafraichirAideDepuisZone\(\);/);
  assert.match(retour, /definirZoneActive\(CTX \? CTX\.zoneMoi\(positionMoi, commune\) : null\);/);
  assert.match(retour, /reinitialiserContextePourRetour\(\);/);
  assert.match(retour, /rafraichirAideDepuisZone\(\);/);
  assert.match(aide, /chargerAideZone\(\{force:true\}\)/);
  assert.match(aide, /if\(modeAide && !destinationActive\(\)\)/);
});

test("une réponse Aide d'une bascule précédente ne repeint pas une vue plus récente", () => {
  const bloc = blocFonction("basculerAide");
  assert.match(app, /let revisionModeAide = 0;/);
  assert.match(bloc, /const revision = \+\+revisionModeAide;/);
  assert.match(bloc, /if\(!modeAide \|\| revision !== revisionModeAide\) return;/);
});

test("les générations gardent les changements rapides de ville et de catégorie étanches", () => {
  const generation = blocFonction("nouvelleGeneration");
  const courante = blocFonction("generationCourante");
  const annulation = blocFonction("annulerChargementsZone");
  assert.match(generation, /if\(precedente\) precedente\.controleur\.abort\(\);/);
  assert.match(courante, /if\(!generation \|\| generation\.signal\.aborted\) return false;/);
  assert.match(courante, /if\(!porteeValide\(generation\.portee\)\) return false;/);
  assert.match(annulation, /g\.controleur\.abort\(\)/);
  assert.match(annulation, /chargementsZone\.clear\(\);/);
});
