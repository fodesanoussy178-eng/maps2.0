import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sourceApplication } from "./source.mjs";

const html = await sourceApplication(import.meta.url);
const temporel = await readFile(new URL("../temporel.js", import.meta.url), "utf8");
const ecrans = await readFile(new URL("../differe/ecrans.js", import.meta.url), "utf8");
await import("../temporel.js");
const T = globalThis.AutourTemps;

test("les trois accès Maintenant partagent exactement la même action", () => {
  const action = html.slice(html.indexOf("function ouvrirSurfaceMaintenant"),
    html.indexOf("function brancherBesoinsRapides"));
  assert.match(action, /creneau = "maintenant";/);
  assert.match(action, /filtreMaintenant = true;/);
  assert.match(action, /ongletCourant = "maintenant";/);
  assert.match(action, /ouvrirFeuille2\("racine"\);/);

  const rapides = html.slice(html.indexOf("function brancherBesoinsRapides"),
    html.indexOf("function besoinsRapidesHTML"));
  assert.match(rapides, /if\(id === "maintenant"\)\{\s*ouvrirSurfaceMaintenant\(\);/);
  const badge = html.slice(html.indexOf("function majBadgeMaintenant"),
    html.indexOf("function blocMaintenantAccueil"));
  assert.match(badge, /badge\.onclick = ouvrirSurfaceMaintenant;/);
  assert.match(html, /#appHeader\{pointer-events:none\}/);
  assert.match(html, /#appHeader button,#appHeader a,#appHeader \[role="button"\]\{pointer-events:auto\}/);
  assert.match(html, /#badgeMaintenant\{position:fixed[\s\S]*?z-index:670;/);

  const navigation = html.slice(html.indexOf('\$("#navBas").querySelectorAll'),
    html.indexOf('if(id === "pourtoi")'));
  assert.match(navigation, /if\(id === "maintenant"\)\{\s*ouvrirSurfaceMaintenant\(\);/);
});

test("Maintenant reste une sélection unique bornée à trois, sans 10+", () => {
  const bloc = html.slice(html.indexOf("function recommandationsAccueil"),
    html.indexOf("function avecEpingles"));
  assert.match(bloc, /const choix = selectionMaintenant\(\);/);
  assert.match(bloc, /Math\.min\(3, max\)/);
  assert.match(html, /function blocMaintenantAccueil\(\)[\s\S]*?selectionMaintenant\(\)/);
  assert.match(html, /const n = modeNav \|\| modePose \? 0 : modeAide \? aideTop\.length : totalMaintenant\(\);/);
  assert.doesNotMatch(html, /Maintenant\s*\(\s*10\+\s*\)/);
});

test("Bientôt est un créneau glissant issu du moteur temporel commun", () => {
  const creneaux = html.slice(html.indexOf("const CRENEAUX"), html.indexOf("const SECTIONS_DU_CRENEAU"));
  assert.match(creneaux, /id:"bientot",\s+label:"Bientôt"/);
  assert.match(creneaux, /id:"avenir",\s+label:"À venir"/);
  assert.match(creneaux, /id:"weekend",\s+label:"Ce week-end"/);
  assert.doesNotMatch(creneaux, /Ce soir/);
  const visibles = html.slice(html.indexOf("const CRENEAUX_VISIBLES"),
    html.indexOf("/* Le créneau choisi"));
  assert.match(visibles, /filter\(c=>c\.id !== "bientot"\)/);
  assert.doesNotMatch(visibles, /Object\.assign/);
  assert.match(visibles, /filter\(c=>c\.id !== "bientot"\)/);
  const onglets = html.slice(html.indexOf("function ongletsTemps"),
    html.indexOf("/* Ce qu'on écrit quand un groupe est vide"));
  assert.match(onglets, /CRENEAUX_VISIBLES\.map/);
  assert.match(html, /function recommandationsBientot\(limite\)[\s\S]*?fenetreSurface\("bientot"/);
  assert.match(html, /if\(creneau === "bientot" && !modeAide\)/);
  assert.match(temporel, /const FENETRE_BIENTOT_MS = 6 \* 3600 \* 1000;/);
  assert.match(temporel, /case "bientot":\s*return fenetreBientot/);

  const now = Date.parse("2026-09-01T10:00:00+02:00");
  const dansCinqHeures = {
    id: "evt-bientot", title: "Session à venir", category: "event",
    isTemporary: true, entity_type: "event", timezone: "Europe/Paris",
    start_at: "2026-09-01T15:00:00", end_at: "2026-09-01T16:00:00",
    date_confidence: "exact",
  };
  const fenetre = T.fenetreSurface("bientot", now, "Europe/Paris");
  assert.equal(T.estDansFenetre(dansCinqHeures, fenetre, now), true);
  assert.equal(T.estDansFenetre(Object.assign({}, dansCinqHeures, {
    start_at: "2026-09-01T17:00:00", end_at: "2026-09-01T18:00:00",
  }), fenetre, now), false);
});

test("la fiche compacte desktop reste à droite et au-dessus de la navigation", () => {
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
    html.indexOf("/* ---- grappes de marqueurs"));
  const fiche = desktop.slice(desktop.indexOf("#ficheCompacte"),
    desktop.indexOf("#bandeauGeo"));
  assert.match(fiche, /left:auto;right:var\(--marge-desktop\)/);
  assert.match(fiche, /top:calc\(var\(--safe-t\) \+ var\(--marge-desktop\) \+ 74px\)/);
  assert.match(fiche, /bottom:calc\(var\(--marge-desktop\) \+ 92px \+ 16px\)/);
  assert.match(fiche, /width:min\(390px,31vw\)/);
  assert.match(fiche, /max-height:calc\(/);
  assert.match(fiche, /overflow-y:auto/);
  const mobile = html.slice(0, html.indexOf("@media (min-width:1100px)"));
  assert.match(mobile, /#ficheCompacte\{position:absolute;left:12px;right:12px;[\s\S]*?bottom:calc\(var\(--nav-height\) \+ 12px\)/);
});

test("une prochaine ouverture est exposée par le même état canonique", () => {
  const now = Date.parse("2026-09-01T10:00:00+02:00");
  const ouvreDansTroisHeures = now + 3 * 3600 * 1000;
  const etat = T.statutTemporel({id: "lieu", title: "Lieu", category: "cafe"}, now, {
    disponibilite: () => ({
      status: "closed",
      isOpenNow: false,
      opensAt: new Date(ouvreDansTroisHeures).toISOString(),
    }),
  });
  assert.equal(etat.debut, ouvreDansTroisHeures);
  assert.equal(etat.hasKnownDate, true);
  assert.equal(etat.status, "today");
});

test("les applications externes restent sous les modes internes et reçoivent la destination", () => {
  const fiche = ecrans.slice(ecrans.indexOf("async function afficherTrajet"));
  assert.ok(fiche.indexOf('id="itinModes"') < fiche.indexOf("liensItinerairesExternes(depart, dest)"));
  assert.match(ecrans, /class="itin-externes"/);
  assert.match(ecrans, /Continuer avec une application/);
  assert.match(ecrans, /lien\("Google Maps", "google"/);
  assert.match(ecrans, /lien\("Apple Plans", "apple"/);
  assert.match(ecrans, /urlItineraireExterne\(fournisseur, mode, depart, destination\)/);
});

test("l'avatar contrôle la localisation et le marqueur suit le GPS sans être déplaçable", () => {
  assert.match(html, /id="btnLieu"/);
  assert.match(html, /id="locationPopoverReturn"/);
  assert.match(html, /Revenir à ma position/);
  assert.match(html, /className:"mk mk-user"/);
  assert.match(html, /class="moi-avatar"/);
  assert.match(html, /draggable:false/);
  assert.match(html, /if\(moi\)\{\s*moi\.setLatLng\(c\);\s*actualiserAvatarCarte\(\);/);
  assert.match(html, /\.mk-user\{user-select:none;-webkit-user-select:none;-webkit-user-drag:none;touch-action:none\}/);
  assert.match(html, /document\.addEventListener\("dragstart"/);
  assert.match(html, /document\.addEventListener\("selectstart"/);
});

test("la barre basse garde une géométrie stable entre desktop et mobile", () => {
  assert.match(html, /#navBas\.nb, #navBas \.nb-creer|#navBas \.nb, #navBas \.nb-creer/);
  assert.match(html, /#navBas \.nb\.actif\{margin:0;transform:none\}/);
  assert.match(html, /#navBas\{width:100%;left:0;right:0;bottom:0/);
  assert.match(html, /--maquette-nav-h:88px/);
  assert.match(html, /--maquette-nav-h-mobile:76px/);
  assert.match(html, /bottom:24px;\s*width:var\(--maquette-nav-w\);\s*height:var\(--maquette-nav-h\)/);
  assert.match(html, /bottom:16px;\s*width:calc\(100% - \(2 \* var\(--maquette-bord-mobile\)\)\);\s*height:var\(--maquette-nav-h-mobile\)/);
  assert.match(html, /#navBas\{position:absolute;left:0;right:0;bottom:0;z-index:910;/);
  assert.match(html, /#pourToi \.pt-corps\{padding-bottom:calc\(14px \+ var\(--safe-b\)\)\}/);
});

test("Créer est centré par une colonne centrale réservée", () => {
  assert.match(html, /#navBas\{\s*display:grid;\s*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(html, /#navBas \.nb-creer\{\s*position:absolute;\s*left:50%;\s*top:0;\s*width:20%;\s*height:100%;\s*transform:translateX\(-50%\)/);
  assert.match(html, /#navBas \.nb\[data-nb="explorer"\]\{grid-column:2\}/);
  assert.match(html, /#navBas \.nb\[data-nb="pourtoi"\]\{grid-column:4\}/);
  assert.match(html, /#navBas \.nb-creer\.actif\{transform:translateX\(-50%\)\}/);
  assert.match(html, /#navBas \.nb-creer \.nb-plus\{width:64px;height:64px;margin-top:-18px\}/);
  assert.match(html, /#navBas \.nb-creer \.nb-plus\{width:56px;height:56px;margin-top:-14px\}/);
  assert.match(html, /#navBas \.nb-creer\{padding:0 10px;justify-content:flex-start\}/);
  assert.match(html, /#navBas \.nb-creer\{padding:0 2px;justify-content:flex-start\}/);
  assert.match(html, /#navBas \.nb\[data-nb="profil"\]\{display:none\}/);
  assert.match(html, /id="btnProfilEntete"/);
  assert.match(html, /if\(\$\("#btnProfilEntete"\)\)[\s\S]*?ongletCourant = "profil";[\s\S]*?ouvrirProfil\(\);/);
});

test("les panneaux partagent un axe haut et restent hors de la zone de navigation", () => {
  assert.match(html, /--maquette-bord:32px/);
  assert.match(html, /--maquette-ecart:24px/);
  assert.match(html, /--maquette-panneau-top:144px/);
  assert.match(html, /#feuilleBesoins,#feuilleBesoins\.accueil,#feuilleBesoins\.deplie,[\s\S]*?#pourToi\{\s*top:calc\(var\(--safe-t\) \+ var\(--maquette-panneau-top\)\)/);
  assert.match(html, /max-height:calc\(100dvh - var\(--safe-t\) - var\(--maquette-panneau-top\) -[\s\S]*?var\(--maquette-nav-h\)/);
  assert.match(html, /bottom:calc\(16px \+ var\(--maquette-nav-h-mobile\) \+ var\(--maquette-ecart-mobile\)\)/);
  assert.match(html, /#onboardingLocalisation:not\(\[hidden\]\) ~ #pourToi\{\s*top:calc\(var\(--safe-t\) \+ 264px\)/);
});
