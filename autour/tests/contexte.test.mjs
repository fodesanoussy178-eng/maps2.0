import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceApplicationSync } from "./source.mjs";

await import("../contexte.js");
const C = globalThis.AutourContexte;
const html = sourceApplicationSync(import.meta.url);

/* ==========================================================================
   LE BUG QU'ON RÉPARE, ET COMMENT ON LE REJOUE

   « Je suis physiquement à Tourcoing, je recherche Lille. L'interface affiche
   Lille, mais certains lieux, marqueurs, recommandations et Maintenant
   continuent à provenir de Tourcoing. »

   Les coordonnées et les emprises ci-dessous sont les vraies. C'est important :
   les deux villes sont à douze kilomètres, elles se touchent presque par leurs
   banlieues, et c'est précisément ce qui rend un filtre approximatif inutile.
   Un test avec Lille et Marseille passerait avec n'importe quelle bêtise.
   ======================================================================== */

const TOURCOING = { centre: [50.7236, 3.1610],
                    emprise: [[50.6934, 3.1194], [50.7480, 3.1929]] };
const LILLE     = { centre: [50.6292, 3.0573],
                    emprise: [[50.5949, 2.9557], [50.6570, 3.1413]] };
const PARIS     = { centre: [48.8566, 2.3522],
                    emprise: [[48.8156, 2.2242], [48.9022, 2.4699]] };

const zTourcoing = C.zoneRecherche("Tourcoing", TOURCOING.centre, TOURCOING.emprise);
const zLille     = C.zoneRecherche("Lille", LILLE.centre, LILLE.emprise);
const zParis     = C.zoneRecherche("Paris", PARIS.centre, PARIS.emprise);
const moiTourcoing = C.zoneMoi(TOURCOING.centre, "Tourcoing");

/* Un jeu de lieux réaliste : quelques-uns bien au centre de chaque ville, et
   surtout DEUX cas limites — le sud de Tourcoing et le nord de Lille, qui sont
   ce que le filtre doit trancher correctement. */
const lieuxTourcoing = [
  { id: "t1", titre: "Café du Centre",      lat: 50.7236, lng: 3.1610 },
  { id: "t2", titre: "Resto Grand-Place",   lat: 50.7180, lng: 3.1550 },
  { id: "t3", titre: "Salle du Fresnoy",    lat: 50.7300, lng: 3.1700 },
  { id: "t4", titre: "Bord sud (limite)",   lat: 50.6950, lng: 3.1250 },
];
const lieuxLille = [
  { id: "l1", titre: "L’Aéronef",           lat: 50.6390, lng: 3.0760 },
  { id: "l2", titre: "UGC Ciné Cité",       lat: 50.6330, lng: 3.0700 },
  { id: "l3", titre: "Café Méo",            lat: 50.6420, lng: 3.0620 },
  { id: "l4", titre: "Bord nord (limite)",  lat: 50.6540, lng: 3.1000 },
];
const lieuxParis = [
  { id: "p1", titre: "Olympia",             lat: 48.8700, lng: 2.3290 },
  { id: "p2", titre: "Le Grand Rex",        lat: 48.8700, lng: 2.3480 },
];
const TOUT = [...lieuxTourcoing, ...lieuxLille, ...lieuxParis];

const idsDe = (liste) => liste.map((l) => l.id).sort();

/* ==========================================================================
   1. LES SEPT SCÉNARIOS OBLIGATOIRES
   ======================================================================== */

test("Tourcoing → recherche Lille → 0 résultat Tourcoing", () => {
  const retenus = C.filtrer(TOUT, zLille);
  const restes = retenus.filter((l) => l.id.startsWith("t"));
  assert.deepEqual(restes, [], "des lieux de Tourcoing survivent : " +
    restes.map((l) => l.titre).join(", "));
  assert.deepEqual(idsDe(retenus), ["l1", "l2", "l3", "l4"]);
});

test("Tourcoing → Lille → Paris → aucun reste de Lille", () => {
  let zone = moiTourcoing;
  zone = zLille;
  zone = zParis;
  const retenus = C.filtrer(TOUT, zone);
  assert.deepEqual(idsDe(retenus), ["p1", "p2"]);
  assert.equal(retenus.filter((l) => l.id.startsWith("l")).length, 0);
});

test("Paris → Revenir autour de moi → uniquement Tourcoing", () => {
  /* Le retour se fait sur la zone « moi ». La carte est alors recentrée sur la
     personne : la vue ne peut donc pas faire rentrer Paris par la fenêtre. */
  const vue = [[50.7100, 3.1400], [50.7380, 3.1820]];   // Tourcoing au zoom 16
  const retenus = C.filtrer(TOUT, moiTourcoing, { vue });
  assert.deepEqual(idsDe(retenus), ["t1", "t2", "t3", "t4"]);
});

test("requête Tourcoing lente → recherche Lille avant sa fin → réponse ignorée", () => {
  /* La portée est un simple numéro, et c'est tout ce qu'il faut : la requête
     note le sien au départ, on le compare à l'arrivée. */
  let portee = 1;
  const partie = portee;                       // la requête Tourcoing part
  portee += 1;                                 // on cherche Lille pendant ce temps
  const accepte = partie === portee;
  assert.equal(accepte, false, "une réponse d’une zone quittée a été acceptée");

  /* Et même si on l'acceptait par erreur, le filtre la reprendrait : c'est la
     deuxième barrière, celle qui ne dépend d'aucun ordonnancement. */
  assert.deepEqual(C.filtrer(lieuxTourcoing, zLille), []);
});

test("cache Tourcoing chaud + Lille froid → aucun mélange", () => {
  const cache = new Map();
  cache.set(C.cleCache(zTourcoing, "resto", "now"), lieuxTourcoing);
  const cleLille = C.cleCache(zLille, "resto", "now");
  assert.equal(cache.has(cleLille), false,
    "la clé de Lille tombe dans la case de Tourcoing : " + cleLille);
  assert.notEqual(C.cleCache(zTourcoing, "resto", "now"), cleLille);
  // et la catégorie et la période séparent aussi, dans la même zone
  assert.notEqual(C.cleCache(zLille, "resto", "now"), C.cleCache(zLille, "cinema", "now"));
  assert.notEqual(C.cleCache(zLille, "resto", "now"), C.cleCache(zLille, "resto", "ce-soir"));
});

test("Maintenant Lille → uniquement des éléments situés dans la zone Lille", () => {
  /* « Maintenant » ne choisit pas dans `lieux` : il choisit dans les lieux de
     la zone active. C'est la même liste filtrée, en amont de toute sélection. */
  const source = C.filtrer(TOUT, zLille);
  const trois = source.slice(0, 3);
  assert.equal(trois.length, 3);
  trois.forEach((l) => assert.ok(C.dansZone(l, zLille), l.titre + " n’est pas à Lille"));
});

test("marqueurs Lille → aucun ancien marqueur Tourcoing", () => {
  /* Les marqueurs suivent exactement la même liste que le reste : ce qui n'est
     pas retenu n'est pas dessiné, et `rendre()` retire ce qu'il ne garde pas. */
  const dessines = new Set(C.filtrer(TOUT, zLille).map((l) => l.id));
  lieuxTourcoing.forEach((l) =>
    assert.equal(dessines.has(l.id), false, "marqueur fantôme : " + l.titre));
});

/* ==========================================================================
   2. LES CAS LIMITES QUI FONT LA DIFFÉRENCE
   ======================================================================== */

test("le rayon ne rouvre pas la porte que l’emprise ferme", () => {
  /* Le trou de la première version : l'emprise de Lille fait treize kilomètres
     de large, donc son rayon en vaut neuf, donc le sud de Tourcoing y entrait.
     Quand l'emprise existe, elle décide seule. */
  const sudTourcoing = { lat: 50.6950, lng: 3.1250 };
  assert.ok(C.distance(sudTourcoing.lat, sudTourcoing.lng, LILLE.centre[0], LILLE.centre[1])
    < C.rayonZone(zLille), "le cas limite ne teste plus rien : il est hors rayon");
  assert.equal(C.dansZone(sudTourcoing, zLille), false);
});

test("la marge évite une carte trouée le long des frontières", () => {
  /* Une limite communale ne se sent pas sous les pieds : un lieu à trois cents
     mètres du panneau fait partie de la sortie qu'on prépare. */
  const justeDehors = { lat: LILLE.emprise[1][0] + 0.003, lng: 3.06 };  // ~330 m
  assert.ok(C.dansZone(justeDehors, zLille));
  const franchementDehors = { lat: LILLE.emprise[1][0] + 0.03, lng: 3.06 }; // ~3,3 km
  assert.equal(C.dansZone(franchementDehors, zLille), false);
});

test("sans emprise, la zone vaut un rayon — jamais rien du tout", () => {
  const sansEmprise = C.zoneRecherche("Bar-le-Duc", [48.7710, 5.1620], null);
  assert.equal(C.rayonZone(sansEmprise), C.RAYON_DEFAUT_M);
  assert.ok(C.dansZone({ lat: 48.7750, lng: 5.1700 }, sansEmprise));
  assert.equal(C.dansZone({ lat: 48.9000, lng: 5.1700 }, sansEmprise), false);
});

test("la vue de la carte n’ouvre que la zone « autour de moi »", () => {
  /* Explorer le quartier d'à côté sans rien chercher, c'est légitime : la carte
     EST la déclaration d'intention. Dézoomer depuis Lille pour voir réapparaître
     Tourcoing, non — sinon le filtre ne servirait à rien. */
  const vueLarge = [[50.55, 2.90], [50.80, 3.25]];      // toute la métropole
  assert.ok(C.dansZone(lieuxTourcoing[0], moiTourcoing, { vue: vueLarge }));
  assert.equal(C.dansZone(lieuxTourcoing[0], zLille, { vue: vueLarge }), false);
});

test("l’identité d’une zone est son endroit, pas son nom", () => {
  /* Le nom de commune arrive par une requête, deux secondes après la position.
     S'il entrait dans la clé, la zone changerait d'identité toute seule et
     jetterait ses caches au pire moment. */
  const avant = C.zoneMoi(TOURCOING.centre, "ton quartier");
  const apres = C.zoneMoi(TOURCOING.centre, "Tourcoing");
  assert.equal(C.idZone(avant), C.idZone(apres));
  assert.ok(C.memeZone(avant, apres));
  assert.equal(C.memeZone(moiTourcoing, zTourcoing), false, "« moi » et « recherche » " +
    "au même endroit ne filtrent pas pareil : ce ne sont pas les mêmes zones");
});

test("une zone est gelée : on en change, on ne la retouche pas", () => {
  assert.ok(Object.isFrozen(zLille));
  const copie = { ...zLille };
  try { zLille.lat = 0; } catch (e) { /* strict mode */ }
  assert.equal(zLille.lat, copie.lat);
});

test("un point illisible n’entre nulle part", () => {
  assert.equal(C.dansZone(null, zLille), false);
  assert.equal(C.dansZone({ lat: NaN, lng: 3 }, zLille), false);
  assert.equal(C.dansZone({ lat: "50.6", lng: "3.0" }, zLille), false);
});

test("sans zone déclarée, on ne filtre rien", () => {
  /* Le tout début de session : la position n'est pas encore connue. Vider
     l'écran par principe serait pire que le mélange qu'on répare. */
  assert.equal(C.filtrer(TOUT, null).length, TOUT.length);
  assert.ok(C.dansZone(lieuxParis[0], null));
});

/* ==========================================================================
   3. CE QUE L'APPLICATION EN FAIT

   Les tests ci-dessus prouvent la règle. Ceux-ci prouvent qu'elle est
   réellement branchée — c'est la moitié qui manquait : la logique était juste,
   personne ne l'appelait.
   ======================================================================== */

test("le module est chargé avant le code qui s’en sert", () => {
  const i = html.indexOf('src="contexte.js?v=');
  assert.ok(i > 0, "le module n’est pas chargé par la page");
  assert.ok(i < html.indexOf("const CTX = window.AutourContexte"));
});

test("il y a une zone active et une portée, déclarées une seule fois", () => {
  assert.match(html, /let zoneActive = null;/);
  assert.match(html, /let porteeCourante = 0;/);
  assert.match(html, /const porteeValide = \(p\)=> p === porteeCourante;/);
  assert.equal((html.match(/^let zoneActive = null;$/gm) || []).length, 1);
});

test("changer de zone incrémente la portée et vide les mémoires", () => {
  const bloc = html.slice(html.indexOf("function definirZoneActive"),
                          html.indexOf("function dansZoneActive"));
  assert.match(bloc, /porteeCourante \+= 1;/);
  assert.match(bloc, /oublierItemsMaintenant\(\);/);
  assert.match(bloc, /recoCache = null;/);
  assert.match(bloc, /selectionAccueil = null;/);
});

test("une recherche de ville fait le basculement complet", () => {
  const bloc = html.slice(html.indexOf("async function rechercheGeographique"),
                          html.indexOf("/* ---- Favoris, côté écran"));
  assert.match(bloc, /definirZoneActive\(CTX \? CTX\.zoneRecherche\(q, centre, zone\.emprise \|\| null\) : null\);/);
  assert.match(bloc, /annulerChargementsZone\(\);/);
  assert.match(bloc, /rendre\(\);/);          // les marqueurs de l’ancienne zone partent
  assert.match(bloc, /majAccueil\(\);/);      // les recommandations aussi
  assert.match(bloc, /chargerZone\(centre\[0\], centre\[1\]/);
});

test("« Revenir autour de moi » est le seul chemin de retour", () => {
  const retour = html.slice(html.indexOf("function revenirAutourDeMoi"),
                            html.indexOf("$(\"#btnAutourDeMoi\").onclick"));
  assert.match(retour, /definirZoneActive\(CTX \? CTX\.zoneMoi\(positionMoi, commune\) : null\);/);
  assert.match(retour, /annulerChargementsZone\(\);/);
  /* Et personne d'autre ne repose la zone sur la position : la seule autre
     occurrence est l'ouverture, et le suivi GPS quand on N'A PAS cherché de
     ville. Trois, pas quatre. */
  assert.equal((html.match(/definirZoneActive\(CTX\.zoneMoi\(/g) || []).length, 2);
});

test("une mesure GPS ne ramène pas la carte à soi quand on regarde ailleurs", () => {
  assert.match(html,
    /if\(bouge && CTX && \(!zoneActive \|\| zoneActive\.type === CTX\.TYPES\.MOI\)\)\s*\n?\s*definirZoneActive\(CTX\.zoneMoi\(c, commune\)\);/);
});

test("tout ce qui s’affiche passe par le filtre de zone", () => {
  // la carte
  assert.match(html, /if\(!dansZoneActive\(l\)\) return false;/);
  assert.match(html, /selectionAccueil\.includes\(l\.id\) && dansZoneActive\(l\)/);
  // les recommandations
  assert.match(html, /lieux\.filter\(l=>dansZoneActive\(l\) && nomExploitable\(l\) && isDiscoveryCandidate\(l\)\)/);
  assert.match(html, /lieux\.filter\(l=>dansZoneActive\(l\) && estTemporaire\(l\) && nomExploitable\(l\)\)/);
  // les résultats de la feuille
  assert.match(html, /lieux\.filter\(dansZoneActive\)\.filter\(nomExploitable\)/);
  // « Maintenant »
  assert.match(html, /const source = lieux\.filter\(dansZoneActive\);/);
});

test("« Maintenant » se souvient par zone, pas seulement par minute", () => {
  /* Sans la zone dans la clé, revenir à Tourcoing servait la mémoire de Lille :
     même minute, même nombre de lieux, réponse d'une autre ville. */
  assert.match(html, /const cle = idZoneActive\(\) \+ "\|" \+ minute \+ "\|" \+ source\.length;/);
});

test("le classement part du centre de la zone, pas de la position physique", () => {
  assert.match(html, /const centre = centreZoneActive\(\) \|\| \(map \? \[map\.getCenter\(\)\.lat/);
  assert.match(html, /moi: centreZoneActive\(\) \|\| \[0,0\],/);
  assert.doesNotMatch(html, /moi: \(rechercheGeo \? \[rechercheGeo\.lat/);
});

test("les distances affichées partent de la zone regardée", () => {
  assert.match(html, /function distanceDepuisZone\(l\)\{/);
  assert.doesNotMatch(html, /formatDist\(distanceM\(positionMoi\[0\],positionMoi\[1\],l\.lat,l\.lng\)\)/);
});

test("une réponse d’une zone quittée est ignorée, quelle que soit sa source", () => {
  /* La portée voyage avec la génération : toutes les sources passent par
     `generationCourante`, donc toutes sont couvertes d'un coup — Overpass,
     DATAtourisme, Google, publications, événements. */
  assert.match(html, /signal:controleur\.signal, portee:porteeCourante/);
  assert.match(html, /if\(!porteeValide\(generation\.portee\)\) return false;/);
  assert.match(html, /function annulerChargementsZone\(\)\{/);
  const bloc = html.slice(html.indexOf("function annulerChargementsZone"),
                          html.indexOf("function annulerChargementsZone") + 600);
  assert.match(bloc, /g\.controleur\.abort\(\)/);
  assert.match(bloc, /chargementsZone\.clear\(\);/);
  assert.match(bloc, /dernierChargement = null;/);
});

test("les clés de cache portent la zone", () => {
  assert.match(html, /return idZoneActive\(\)\+"#"\+lat\.toFixed\(2\)/);
  assert.match(html, /cle=idZoneActive\(\)\+"#"\+lat\.toFixed\(2\)\+","\+lng\.toFixed\(2\)/);
});

test("les requêtes d’aide visent la zone active", () => {
  assert.match(html, /function chargerAideZone\(options\)\{/);
  assert.doesNotMatch(html, /chargerAide\(positionMoi\[0\], positionMoi\[1\]/);
});
