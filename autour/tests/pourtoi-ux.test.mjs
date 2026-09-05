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
  /* LOT 3 : le sélecteur de temps ouvre le panneau — « ce qui me correspond,
     ce week-end » est une requête légitime de cette surface. L'ordre que ce
     test défend est inchangé : les surveillances restent AVANT les
     recommandations. */
  assert.match(source, /corps\.innerHTML = tempsPourToi \+ blocSurveillances\(\) \+ contenu;/);
  assert.match(source, /const tempsPourToi = ongletsTemps\(\);/);
  const bloc = source.slice(
    source.indexOf("function blocSurveillances"),
    source.indexOf("function rendreGroupePourToi"),
  );
  assert.match(bloc, /Tes surveillances/);
  assert.match(bloc, /<button id="ptGerer">Modifier mes goûts<\/button>/);
  const tete = source.slice(source.indexOf('<div class="pt-tete">'), source.indexOf('<div class="pt-corps"'));
  assert.doesNotMatch(tete, /ptGerer/);
});

test("la sélection des goûts est un brouillon validé en une seule fois", () => {
  const selection = source.slice(
    source.indexOf("function commencerEditionEnvies"),
    source.indexOf("function blocSurveillances")
  );
  assert.match(selection, /data-testid="selection-gouts"/);
  assert.match(selection, /data-env-cancel/);
  assert.match(selection, /data-env-submit/);
  assert.match(selection, /(?:ENVIES|envies)\.basculerBrouillon\(editionEnvies\.ids/);
  assert.match(selection, /(?:ENVIES|envies)\.remplacer\(ids\)/);
  assert.match(selection, /rebaserPourToiApresChangementGouts\(\)/);
  assert.match(selection, /function annulerEditionEnvies\(\)[\s\S]*?fermerPourToi\(\)/);
  assert.doesNotMatch(selection, /ENVIES\.basculer\(/,
    "l'interface ne doit plus enregistrer chaque clic");
});

test("les actions de goûts restent atteignables au-dessus de la navigation", () => {
  assert.match(source, /#pourToi:has\(\.env-actions\)\{z-index:920\}/,
    "les actions du panneau desktop ne doivent pas passer sous la navigation");
  assert.match(source, /#feuille:has\(\.env-actions\)\{z-index:920\}/,
    "les actions de la feuille mobile ne doivent pas passer sous la navigation");
});

test("les goûts et les recommandations sont reconstruits par ID après reload", () => {
  assert.match(source, /function ouvrirPourToi\(\)[\s\S]*?rafraichirMetropole\(\)[\s\S]*?majPourToi\(\)/,
    "ouvrir Pour toi doit relancer le bassin après une nouvelle session");
  assert.doesNotMatch(
    source.slice(source.indexOf("function nouveautesPourToi"), source.indexOf("function noterConsultationPourToi")),
    /if\(!annoncees\.size && consultationCompte\)/,
    "une date de consultation ne doit pas effacer les recommandations non vues"
  );
  const pastille = source.slice(source.indexOf("function peindrePastillePourToi"), source.indexOf("function majPastillePourToi"));
  assert.match(pastille, /dataset\.count = String\(compte\)/);
  assert.match(source, /let rebasePourToiEnAttente = false/);
  assert.match(source, /function finaliserRebasePourToiSiPret\(\)[\s\S]*?retenirAnnoncees\(propositionsPourToi\(POURTOI_TOUT_MAX\)\)/);
});

test("Maintenant expose le bassin complet et son badge FOMO canonique", () => {
  assert.match(source, /id="navMaintenantBadge"/);
  assert.match(source, /const CLE_MAINTENANT_VU = "autour:maintenant-vu:v1"/);
  assert.match(source, /function idCanoniqueMaintenant\(item\)/);
  assert.match(source, /function candidatsMaintenant\(\)/);
  assert.match(source, /M\.candidats\(itemsMaintenant\(ctx\), ctx\)/);
  assert.match(source, /c && c\.item \? Object\.assign\(\{\}, c\.item, \{nature:c\.nature\}\)/);
  assert.match(source, /function marquerMaintenantCommeVu\(\)/);
  assert.match(source, /marquerMaintenantCommeVu\(\)[\s\S]*?ouvrirFeuille2\("racine"\);/);
  assert.match(source, /data-mn-candidats="'\+candidats\.length\+'/);
  assert.match(source, /badge\.dataset\.nouveaux = String\(nouveaux\)/);
  assert.match(source, /badge\.dataset\.count = String\(compte\)/);
});

test("sans goûts, Pour toi affiche l'onboarding au lieu d'inventer une personnalisation", () => {
  const pourToi = source.slice(source.indexOf("function majPourToi"), source.indexOf("function brancherPourToi"));
  assert.match(pourToi, /if\(!suivies\)/);
  assert.match(pourToi, /commencerEditionEnvies\("panneau"\)/);
  assert.match(pourToi, /selectionEnviesHTML\(\)/);
});

test("Pour toi distingue goûts absents, hydratation, zéro résultat et résultats", () => {
  assert.match(source, /const ETATS_POURTOI = Object\.freeze\(\{/);
  for(const etat of ["AUCUN_GOUT", "SANS_RESULTAT", "CHARGEMENT", "RESULTATS"])
    assert.match(source, new RegExp(etat+":"));
  assert.match(source, /const ETAT_DONNEES_POURTOI = Object\.freeze\(\{/);
  const pourToi = source.slice(source.indexOf("function majPourToi"), source.indexOf("function brancherPourToi"));
  assert.match(pourToi, /hydratationEnCours \|\| \(suivies && donneesEnCours\)/);
  assert.match(pourToi, /etat = ETATS_POURTOI\.SANS_RESULTAT/);
  assert.match(pourToi, /Pas encore assez de recommandations ici pour tes goûts/);
  assert.match(pourToi, /panneau\.dataset\.etat = etat/);
  assert.match(source, /function chargerInteretsCompte\(\)[\s\S]*?actualiserSurfacePourToi\(\)/);
  assert.match(source, /function appliquerSession\([\s\S]*?actualiserSurfacePourToi\(\)/);
});

test("Pour toi récupère le module de goûts publié après le premier rendu", () => {
  const synchroniseur = source.slice(
    source.indexOf("function synchroniserEnvies"),
    source.indexOf("function estConnecte")
  );
  const fenetre = {};
  const estConnecte = () => false;
  const synchroniser = new Function(
    "window", "estConnecte", "moiId",
    'let ENVIES = null; ' + synchroniseur + '; return synchroniserEnvies;'
  )(fenetre, estConnecte, null);
  assert.equal(synchroniser(), null);

  const api = { definirContexte() {} };
  fenetre.AutourEnvies = api;
  assert.equal(synchroniser(), api);
});

test("Pour toi est invalidé par les changements de zone, GPS et données", () => {
  assert.match(source, /function definirZoneActive\([\s\S]*?actualiserSurfacePourToi\(\)/);
  assert.match(source, /function appliquerPosition\([\s\S]*?if\(bouge\) actualiserSurfacePourToi\(\)/);
  assert.match(source, /function finaliserFusion\([\s\S]*?marquerDonneesPourToiPretes\(\)/);
  assert.match(source, /function rafraichirMetropole\([\s\S]*?chargerEvenementsMajeursHorsZone\(/);
  assert.doesNotMatch(source, /evenements_bassin/,
    "Pour toi ne doit plus charger un bassin distant complet");
});

test("la pastille exclut les recommandations vues et les goûts nouvellement pertinents", () => {
  const logique = source.slice(source.indexOf("function rebaserPourToiApresChangementGouts"), source.indexOf("function peindrePastillePourToi"));
  assert.match(logique, /const propositions = propositionsPourToi\(POURTOI_TOUT_MAX\)/);
  assert.match(logique, /retenirAnnoncees\(propositions\)/);
  assert.match(logique, /!annoncees\.has\(id\) && !vues\.has\(id\)/);
  const rendu = source.slice(source.indexOf("function majPourToi"), source.indexOf("function brancherPourToi"));
  assert.match(rendu, /peindrePastillePourToi\(nouveautesPourToi\(propositions\)\.length\)/);
});

test("un compte recharge et synchronise ses goûts sans migration de profil", () => {
  const compte = source.slice(source.indexOf("const CLE_INTERETS_COMPTE"), source.indexOf("/* Le pseudo public"));
  assert.match(compte, /const CLE_INTERETS_COMPTE = "autour_interests"/);
  assert.doesNotMatch(compte, new RegExp(["autour", "interets"].join("_")));
  assert.match(compte, /user_metadata/);
  assert.match(compte, /auth\.updateUser\(\{[\s\S]*data:\{\[CLE_INTERETS_COMPTE\]: choix\}/);
  assert.match(source, /await chargerInteretsCompte\(\)/);
  assert.doesNotMatch(compte, /from\("profiles"\)/,
    "les goûts ne doivent pas dépendre d'une nouvelle colonne publique");
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
