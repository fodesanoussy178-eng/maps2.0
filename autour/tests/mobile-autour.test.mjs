/* CE QUE LES CAPTURES MOBILES ONT MONTRÉ, ET CE QUI NE DOIT PLUS REVENIR.

   Chaque test de ce fichier correspond à une fiche réellement observée sur
   téléphone. Aucun n'est théorique : la valeur attendue est celle qui aurait
   dû s'afficher, et la valeur qu'on refuse est celle qui s'affichait.

   Une remarque qui vaut pour tout le fichier : rien de ce qui est vérifié ici
   ne dépend de la taille de l'écran. C'est délibéré, et c'est le fond du
   problème constaté — les mêmes données doivent produire la même fiche sur
   ordinateur et sur téléphone. Ce qui différait n'était pas le classement,
   c'était le temps dont les sources disposaient pour répondre. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { normaliserDatatourisme } from "../api/datatourisme.js";
import { sourceApplication, corpsApplication } from "./source.mjs";

await import("../availability.js");
await import("../aide-rayon.js");
const DISPO = globalThis.AutourAvailability;
const RAYON = globalThis.AutourAideRayon;

const html = await sourceApplication(import.meta.url);
const corps = await corpsApplication(import.meta.url);
const apiLieux = await readFile(new URL("../api/lieux.js", import.meta.url), "utf8");
const apiDatatourisme = await readFile(new URL("../api/datatourisme.js", import.meta.url), "utf8");

/* Un POI DATAtourisme minimal : seuls le titre, la description et les types
   varient d'un cas à l'autre — ce sont exactement les trois entrées dont la
   règle dit qu'elles décident, dans cet ordre. */
function poi({titre, description = "", types = ["PointOfInterest"]}) {
  return normaliserDatatourisme({
    uuid: "cas-" + titre, label: {fr: titre},
    hasDescription: {fr: description}, type: types,
    isLocatedAt: {geo: {latitude: 50.6929, longitude: 3.1746}},
  });
}
const categorieDe = (entree) => (poi(entree) || {}).cat;

/* ==========================================================================
   1. LA NATURE DE L'ACTIVITÉ D'ABORD, LE TYPE DE LIEU ENSUITE
   ======================================================================== */

test("« Visite privée de l’exposition Le Liban de Serge Najjar » est de la culture, jamais un bar", () => {
  /* LA FICHE DE LA CAPTURE. Elle sortait sous « 🍺 Bars ».

     La cause n'était pas une règle sur les bars : c'était `/bar|pub/` testé en
     SOUS-CHAÎNE sur le titre et la description collés ensemble. « ouvert au
     public » contient « pub ». Un seul mot, jamais lu comme un mot, décidait
     de la catégorie d'une exposition. */
  const cat = categorieDe({
    titre: "Visite privée de l’exposition Le Liban de Serge Najjar",
    description: "Une visite guidée de l’exposition, ouverte au public sur réservation.",
  });
  assert.notEqual(cat, "bar", "une exposition n’est jamais un bar");
  assert.equal(cat, "musee", "c’est une activité culturelle : exposition");
});

test("la même exposition déclarée comme événement donne la même réponse", () => {
  /* La source peut déclarer un type d'événement ou pas ; la fiche affichée ne
     doit pas dépendre de ce détail de catalogue. */
  assert.equal(categorieDe({
    titre: "Visite privée de l’exposition Le Liban de Serge Najjar",
    description: "Exposition photographique.",
    types: ["CulturalEvent"],
  }), "musee");
});

test("« visite de lieux patrimoniaux » reste du patrimoine, même si le texte dit « brasserie »", () => {
  /* L'autre fiche de la capture. Elle sortait sous « 🍔 Restaurants » parce
     que la description mentionne une halte dans une brasserie. Le mot est
     dans le décor du parcours, pas dans sa nature. */
  const cat = categorieDe({
    titre: "Visite de lieux patrimoniaux",
    description: "Parcours dans le centre historique, avec une halte à la brasserie du XIXe siècle.",
  });
  assert.notEqual(cat, "resto", "un mot de la description ne définit pas l’activité");
  assert.equal(cat, "musee");
});

test("un vrai établissement reste classé par ce qu’il est", () => {
  /* La correction ne doit pas fabriquer l'erreur inverse : refuser de
     reconnaître un bar quand c'en est un. */
  assert.equal(categorieDe({titre: "Le Bar à Vin", description: "Cave et dégustation."}), "bar");
  assert.equal(categorieDe({titre: "Restaurant Le Comptoir", description: "Cuisine du marché."}), "resto");
  assert.equal(categorieDe({titre: "Cinéma Le Fresnoy"}), "cinema");
  assert.equal(categorieDe({titre: "Bibliothèque municipale"}), "biblio");
});

test("le nom de tête décide, pas l’ordre d’une liste", () => {
  /* « Brasserie du Théâtre » est une brasserie ; « Théâtre de la Brasserie »
     est un théâtre. Un parcours de règles dans l'ordre du fichier rendrait le
     même verdict aux deux. */
  assert.equal(categorieDe({titre: "Brasserie du Théâtre", description: "Cuisine traditionnelle."}), "resto");
  assert.equal(categorieDe({titre: "Théâtre de la Brasserie", description: "Salle de 300 places."}), "spectacle");
});

/* ==========================================================================
   2. LES SOUS-CHAÎNES QUI DÉCIDAIENT À LA PLACE DES MOTS
   ======================================================================== */

test("le pluriel français en -aux est un pluriel", () => {
  /* « patrimonial » donne « patrimoniaux », et le suffixe `e?s?` ne le voyait
     pas. « Visite de lieux patrimoniaux » — l'exemple même de cet audit —
     retombait donc sur « Événement » dès que la description ne contenait
     aucun autre mot culturel. « patrimoniales » passait, « patrimoniaux » non. */
  for (const titre of ["Visite de lieux patrimoniaux", "Visite de sites patrimoniaux",
                       "Visite de lieux patrimoniales", "Visite du patrimoine"])
    assert.equal(categorieDe({titre, description: "Ouvert au public."}), "musee", titre);
});

test("un hôtel qui ne loge personne n’est pas un hébergement", () => {
  /* En français « hôtel » désigne aussi un bâtiment public. Tous sortaient en
     Hébergement — et dans Aide, cela envoyait quelqu'un qui cherche à dormir
     vers la mairie. */
  const attendus = [
    ["Hôtel de Ville", "mairie"], ["Hôtel des Postes", "mairie"],
    ["Hôtel de Police", "mairie"], ["Hôtel du Département", "mairie"],
    ["Hôtel-Dieu", "sante"],
    ["Hôtel Ibis Lille", "hebergement"], ["Camping des Dunes", "hebergement"],
  ];
  for (const [titre, attendu] of attendus)
    assert.equal(categorieDe({titre, description: "Bâtiment ouvert au public."}), attendu, titre);
});

test("les coïncidences de lettres ne classent plus rien", () => {
  const pieges = [
    // « Barbieux » contient « bar ». Le parc Barbieux, à Roubaix.
    [{titre: "Parc Barbieux", description: "Grand parc urbain."}, "parc", "bar"],
    // « public » contient « pub »
    [{titre: "Exposition photo", description: "Ouvert au public tous les jours."}, "musee", "bar"],
    // « démarches » contient « marche »
    [{titre: "Point d’accès au droit", description: "Accompagnement dans vos démarches administratives."}, null, "marche"],
    // « parcours » contient « parc »
    [{titre: "Boutique de créateurs", description: "À deux pas du parcours street art."}, "commerce", "parc"],
  ];
  for (const [entree, attendu, refuse] of pieges) {
    const cat = categorieDe(entree);
    assert.notEqual(cat, refuse, "« " + entree.titre + " » ne doit pas être « " + refuse + " »");
    if (attendu) assert.equal(cat, attendu, "« " + entree.titre + " »");
  }
});

test("la classification lit des mots bornés, jamais des morceaux de mots", () => {
  /* La règle vaut au-delà des quatre cas ci-dessus : c'est la forme des
     motifs qui la garantit. Un test de source pour que la prochaine règle
     ajoutée suive la même discipline. */
  assert.match(apiDatatourisme, /function mots\(valeur\)/);
  assert.match(apiDatatourisme, /function dit\(texteMots, termes\)/);
  assert.match(apiDatatourisme, /function motif\(terme\)/);
  assert.match(apiDatatourisme, /"\(\?:\^\| \)" \+ radical \+ "e\?s\?\(\?= \|\$\)"/);
  // et les deux lecteurs passent par ce motif-là, pas par le leur
  assert.match(apiDatatourisme, /termes\.some\(\(terme\) => motif\(terme\)\.test\(texteMots\)\)/);
  assert.match(apiDatatourisme, /const trouve = motif\(terme\)\.exec\(texteMots\);/);
  // et les anciens motifs de sous-chaîne ont disparu
  assert.doesNotMatch(apiDatatourisme, /\/bar\|pub\/\.test/);
  assert.doesNotMatch(apiDatatourisme, /\/restaurant\|brasserie\/\.test/);
});

test("un mot isolé du nom ne remplace plus une catégorie établie par un tag", () => {
  /* Côté application, la même faute existait : `affinerCategorie` promouvait
     en « cinéma » dès que « ciné », « film » ou « projection » APPARAISSAIT
     dans la liste complète des appartenances — un magasin « Ciné Photo », un
     bar qui projette les matchs. On compare désormais les forces. */
  assert.match(html, /const poids = classifyPlaceWeighted\(\{cat, title:nom, tags\}\);/);
  assert.match(html, /if\(\(poids\.cinema \|\| 0\) > 0 && \(poids\.cinema \|\| 0\) > \(poids\[cat\] \|\| 0\)\) return "cinema";/);
  assert.doesNotMatch(html, /classifyPlace\(\{cat, title:nom\}\)\.includes\("cinema"\)/);
});

test("la classification ne regarde ni l’écran, ni l’appareil", () => {
  /* C'est ce qui garantit qu'une même donnée produit la même fiche sur
     ordinateur et sur téléphone : la chaîne de classification n'a aucune
     entrée qui dépende de l'un ou de l'autre. */
  for (const interdit of [/navigator\./, /matchMedia/, /innerWidth/, /userAgent/, /window\./]) {
    assert.doesNotMatch(apiDatatourisme, interdit,
      "la classification ne doit dépendre d’aucune propriété d’appareil");
  }
});

/* ==========================================================================
   3. LES HORAIRES, EN FRANÇAIS ET JAMAIS EN SYNTAXE OSM
   ======================================================================== */

test("le statut calculé est l’information principale, écrit à la française", () => {
  const midi = Date.parse("2026-07-15T12:00:00+02:00");   // un mercredi
  assert.equal(DISPO.getPlaceAvailability({cat: "resto", quand: "Mo-Su 09:00-23:30"}, midi).label,
    "Ouvert · ferme à 23h30");
  assert.equal(DISPO.getPlaceAvailability({cat: "cinema", quand: "Mo-Su 14:00-23:00"}, midi).label,
    "Fermé · ouvre à 14h");
});

test("un opening_hours devient une semaine lisible : lundi, mardi, mercredi…", () => {
  const semaine = DISPO.semaineFrancaise({quand: "Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off"});
  assert.deepEqual(semaine.jours, [
    {jour: "lundi au vendredi", premierJour: 0, dernierJour: 4, horaire: "8h – 12h, 14h – 18h"},
    {jour: "samedi", premierJour: 5, dernierJour: 5, horaire: "9h – 12h"},
    {jour: "dimanche", premierJour: 6, dernierJour: 6, horaire: "Fermé"},
  ]);
  assert.equal(DISPO.semaineFrancaise({quand: "24/7"}).jours[0].horaire, "24h/24");
  /* La fiche de la capture affichait « Mo,We-Su 07:00-13:00 » sous « Quand ». */
  const boulangerie = DISPO.semaineFrancaise({quand: "Mo,We-Su 07:00-13:00"});
  assert.deepEqual(boulangerie.jours.map((l) => l.jour + " : " + l.horaire), [
    "lundi : 7h – 13h", "mardi : Fermé", "mercredi au dimanche : 7h – 13h",
  ]);
});

test("des horaires illisibles restent non rendus, jamais recopiés", () => {
  /* Écrire un horaire faux coûte un déplacement pour rien. On préfère ne rien
     dire — et surtout ne pas recopier la chaîne d'origine. */
  assert.equal(DISPO.semaineFrancaise({quand: "Voir sur place"}), null);
  assert.equal(DISPO.semaineFrancaise({quand: "sunrise-sunset"}), null);
  assert.equal(DISPO.journeeFrancaise({}, 0), null);
});

test("aucun écran ne peut plus afficher la chaîne OpenStreetMap telle quelle", () => {
  /* `libelleHoraires` rendait `l.quand` dès que Google n'avait pas de grille,
     c'est-à-dire pour la majorité de la carte. Les quatre sorties possibles
     sont désormais : le statut, la ligne Google, la journée en français,
     l'absence. */
  assert.match(html, /function libelleHoraires\(l\)\{/);
  assert.doesNotMatch(html, /if\(l\.quand && !\/\^\(Voir sur place\|Horaires indicatifs\)\$\/i\.test\(l\.quand\)\) return l\.quand;/);
  assert.match(html, /if\(d && d\.status !== "unknown" && d\.label\) return d\.label;/);
  assert.match(html, /DISPO\.journeeFrancaise\(l, jourDeLaSemaine\(\)\)/);
  assert.match(html, /return "Horaires non renseignés";/);
  /* Une publication, elle, garde la phrase de son auteur : « Samedi 12
     septembre · 20h30 → 23h » n'est pas de la syntaxe de base de données,
     c'est du français écrit par quelqu'un. */
  assert.match(html, /if\(estTemporaire\(l\)\)\{[\s\S]{0,400}?return l\.quand \|\| "Bientôt";/);
  // la fiche non plus : « Quand » passe par le même libellé
  assert.match(html, /'<div><dt>Quand<\/dt><dd>'\+esc\(libelleHoraires\(l\)\)\+'<\/dd><\/div>'/);
  // ni le texte de partage, qui expédiait la syntaxe OSM par SMS
  assert.match(html, /const txt = l\.titre\+" — "\+l\.adresse\+", "\+l\.cp\+" · "\+libelleHoraires\(l\)/);
});

test("le type de cuisine est traduit, ou tu", () => {
  /* La liste affichait `x.cuisine.replace(/[_;]/g," ")` : « regional french »
     sous un restaurant, en anglais, séparateurs OSM compris. */
  assert.match(html, /function libelleCuisine\(brut\)\{/);
  assert.doesNotMatch(html, /x\.cuisine\.replace\(\/\[_;\]\/g," "\)/);
  assert.match(html, /const cuisine = libelleCuisine\(x\.cuisine\);/);
});

/* ==========================================================================
   4. AIDE : CHERCHER PRÈS D'ABORD, ET PUBLIER EN CHEMIN
   ======================================================================== */

test("la recherche commence par la proximité immédiate", () => {
  assert.equal(RAYON.premier(), 1200, "ce qu’on atteint à pied, et qui revient vite");
  assert.deepEqual(RAYON.PALIERS, [1200, 3000, 5000, 10000, 20000],
    "puis le quartier, la commune, les communes voisines, l’intercommunalité");
});

test("Aide affiche ce qu’elle sait déjà avant d’interroger qui que ce soit", () => {
  /* L'écran partait vide et attendait OpenStreetMap. Les structures d'un
     quartier ne bougent pas d'un jour à l'autre : la tuile locale les contient
     dès la deuxième ouverture. Corollaire direct de l'exigence « une API
     indisponible ne supprime pas des lieux déjà connus » — ils sont affichés
     avant que la moindre requête ne parte, donc rien ne peut les retirer. */
  const debut = html.indexOf("async function chargerAideVraiment");
  const aide = html.slice(debut, html.indexOf("/* « restaurant à Lille »", debut));
  assert.match(aide, /const connus = resultatsAideDansTerritoire\(lireCacheProche\(lat,lng\) \|\| \[\]\);/);
  assert.match(aide, /if\(connus\.length\)\{\s*\n\s*fusionner\(connus,"permanent"\);/);
  // et ce que les paliers rapportent alimente la tuile pour la fois suivante
  assert.match(aide, /completerCacheLieux\(lat,lng,locaux\);/);
  /* La tuile est COMPLÉTÉE, pas remplacée : les catégories d'aide ne sont pas
     dans `CATS_DEPART`, donc écraser ferait disparaître les unes ou les autres
     selon qui a écrit en dernier. */
  assert.match(html, /function completerCacheLieux\(lat,lng,nouveaux\)\{/);
  assert.match(html, /const existants = lireCacheLieux\(lat,lng\) \|\| \[\];/);
});

test("une distance inconnue ne s’écrit pas « NaN »", () => {
  /* Sur les captures : « NaN km » et « NaN min à pied » en tête de fiche.
     `distanceDepuisZone` rend `NaN` tant qu'aucune position n'est connue, et
     `(NaN/1000).toFixed(1)` rend « NaN ». Sur un ordinateur la position arrive
     avant la première fiche ; sur un téléphone, c'est le cas normal des
     premières secondes. */
  assert.match(html, /const formatDist = \(m\)=> !Number\.isFinite\(Number\(m\)\) \? ""/);
  assert.match(html, /\(Number\.isFinite\(distanceDepuisZone\(l\)\)\s*\n\s*\? '<span>'\+formatDist\(distanceDepuisZone\(l\)\)/);
});

test("chaque palier publie ce qu’il trouve, sans attendre les suivants", () => {
  const debut = html.indexOf("async function chargerAideVraiment");
  const aide = html.slice(debut, html.indexOf("/* « restaurant à Lille »", debut));
  assert.match(aide, /fusionner\(locaux,"permanent"\);[\s\S]{0,300}?definirEtatRechercheVersionne\("overpass",SEARCH_STATES\.SUCCESS,generation\);\s*\n\s*majFeuille2\(\);/);
  /* Et le palier le plus proche a le budget le plus court : il est là pour
     revenir vite, pas pour être exhaustif. */
  assert.match(aide, /const budget = palier <= 1500 \? 5000 : palier <= 5000 \? 8000 : 12000;/);
});

test("un transport muet arrête la recherche au lieu de la répéter plus large", () => {
  /* Un palier en échec rendait zéro résultat, ce que la règle d'élargissement
     lisait comme « pas assez près » : on repartait pour un palier plus large,
     plus lent, voué au même échec. Quatre fois — vingt secondes d'attente sur
     mobile pour une panne d'une seconde. */
  const debut = html.indexOf("async function chargerAideVraiment");
  const aide = html.slice(debut, html.indexOf("/* « restaurant à Lille »", debut));
  assert.match(aide, /if\(!r \|\| !r\.ok\)\{[\s\S]{0,400}?SEARCH_STATES\.OVERPASS_UNAVAILABLE,generation\);\s*\n\s*break;/);
});

test("« je cherche » et « je n’ai pas trouvé » ne se disent plus pareil", () => {
  /* L'écran rendait l'impasse dès que la liste était vide — donc avant que la
     moindre requête ait répondu. `aideEnCours` existait, posé et levé au bon
     endroit, mais personne ne le lisait. */
  assert.match(html, /return enteteBesoinAide\(titre\)\+\(aideEnCours \? rechercheAideHTML\(\) : aucuneSolutionHTML\(\)\);/);
  assert.match(html, /function rechercheAideHTML\(\)\{/);
  assert.match(html, /data-testid="aide-recherche"/);
  // et le drapeau redescend quoi qu'il arrive, y compris si la recherche est remplacée
  assert.match(html, /aidesEnVol = Math\.max\(0, aidesEnVol - 1\);\s*\n\s*aideEnCours = aidesEnVol > 0;/);
});

test("Aide cherche enfin quand la position arrive après coup", () => {
  /* TROUVÉ EN PILOTANT L'APPLICATION, PAS EN LA LISANT.

     `basculerAide` ne lançait la recherche que `if(modeAide && positionMoi)`,
     et rien ne la relançait quand le point arrivait ensuite. Sur un ordinateur
     la position vient du réseau en une fraction de seconde : elle est toujours
     là avant qu'un doigt n'atteigne l'onglet. Sur un téléphone elle met une à
     quinze secondes — et quelqu'un qui ouvre Aide l'ouvre tout de suite.

     L'écran affichait alors « Je n'ai pas trouvé de solution », sans avoir
     cherché, et aucune requête ne partait jamais. Reproductible au banc. */
  assert.match(html, /if\(modeAide\) chargerAideSiBesoin\(bouge\);/);
  const bloc = html.slice(html.indexOf("function appliquerPosition"),
    html.indexOf("function appliquerPosition") + 3600);
  assert.match(bloc, /if\(modeAide\) chargerAideSiBesoin\(bouge\);/,
    "la relance appartient au moment où la position arrive");
});

test("une recherche d’aide annulée n’interdit pas la suivante", () => {
  /* Deux appuis rapides sur l'onglet Aide : le premier entre et lance, le
     second sort et ANNULE, le troisième revient — et trouvait une entrée
     « chargement en cours » pointant sur la recherche morte. Il rendait cette
     promesse-là sans rien relancer, et l'écran restait sur l'impasse.

     Sur un téléphone — latence, aucun retour sous le doigt — taper deux fois
     est le geste normal de quelqu'un qui doute que son appui ait été pris. */
  assert.match(html, /const enVol = chargementsAideEnCours\.get\(cleChargement\);/);
  assert.match(html, /if\(!o\.force && generationCourante\(enVol\.generation\)\) return enVol\.promesse;/);
  assert.match(html, /chargementsAideEnCours\.delete\(cleChargement\);/);
  assert.match(html, /chargementsAideEnCours\.set\(cleChargement,\{promesse, generation\}\);/);
});

test("une panne de source se dit comme une panne, pas comme une absence d’aide", () => {
  /* Observé au banc, relais coupé : l'écran annonçait « Je n'ai pas trouvé de
     solution suffisamment fiable autour de cette zone » — pour quelqu'un qui
     cherche à manger, cela se lit « il n'y a pas d'aide près de chez toi ».
     C'est faux, et c'est la pire phrase possible à ce moment-là. */
  assert.match(html, /function sourceAideIndisponible\(\)\{/);
  assert.match(html, /if\(sourceAideIndisponible\(\)\)\s*\n?\s*return '<div class="as-vide" data-testid="aide-source-indisponible">'/);
  assert.match(html, /l’annuaire des structures n’a pas répondu/);
  /* Et devant une panne, la seule action qui a du sens est de réessayer — pas
     de reformuler un besoin qui n'était pas en cause. */
  const bloc = html.slice(html.indexOf('data-testid="aide-source-indisponible"'),
    html.indexOf('data-testid="aide-source-indisponible"') + 900);
  assert.match(bloc, /data-etat-action="retry"/);
  assert.doesNotMatch(bloc, /data-as="reformuler"/);
});

test("dans Aide, « Réessayer » relance la recherche d’aide", () => {
  /* Le bouton relançait `chargerAutourDuPoint`, le chemin d'exploration, qui
     ne demande aucune des catégories sociales : il semblait travailler et ne
     rapportait jamais rien. */
  assert.match(html, /if\(modeAide\)\{\s*\n\s*chargerAideSiBesoin\(true\);/);
});

test("aucune source d’Aide ne peut retenir l’écran indéfiniment", () => {
  /* `fetch` n'a pas de délai par défaut. Sur mobile, une connexion perdue sans
     être fermée laisse la promesse en vol — et c'est la fin de la
     coordination qui retire le voile ET libère la clé de chargement. */
  assert.match(html, /const AIDE_DELAI_SOURCE_MS = 9000;/);
  assert.match(html, /avecDelai\(lieuxDatatourisme\(lat,lng,generation\.signal\),\s*\n?\s*AIDE_DELAI_SOURCE_MS/);
  assert.match(html, /avecDelai\(chercherGoogle\(r\.q, lat, lng,\{signal:generation\.signal\}\),\s*\n?\s*AIDE_DELAI_SOURCE_MS/);
  // et le voile part dans tous les cas, pas seulement pour la génération courante
  assert.match(html, /\], \(\)=>generationCourante\(generation\)\);[\s\S]{0,400}?\n  charge\(null\);/);
});

test("une source muette ne gèle plus le rechargement d’une zone", () => {
  /* Le piège n'était pas seulement l'attente : c'est le `finally` de
     `Promise.allSettled` qui retire la clé de `chargementsZone`, et tant
     qu'elle y est, `chargerZone` rend la MÊME promesse morte à chaque
     demande. Une seule socket perdue — le quotidien d'un changement d'antenne
     — gelait définitivement le rechargement de cette zone. */
  const debut = html.indexOf("function chargerZone(lat, lng, opts)");
  const zone = html.slice(debut, html.indexOf("promesse.generation = generation;", debut));
  for (const source of [
    /avecDelai\(lieuxDatatourisme\(lat,lng,signal\), ZONE_DELAI_SOURCE_MS/,
    /avecDelai\(decouvertesAncrees\(lat,lng,signal\), ZONE_DELAI_MODELE_MS/,
    /avecDelai\(notesGoogle\(lat,lng,\{signal\}\), ZONE_DELAI_SOURCE_MS/,
    /avecDelai\(chargerCoucheSupabase\(lat,lng\), ZONE_DELAI_SOURCE_MS/,
  ]) assert.match(zone, source);
  /* OpenStreetMap n'y figure pas : il porte déjà son propre minuteur, et
     c'est lui qui décide si la zone est « vue ». */
  assert.match(zone, /vraisLieux\(lat, lng, large \? bornesVisibles\(\) : null,/);
});

/* ==========================================================================
   5. LE RELAIS : LA FORME D'AIDE ÉTAIT REFUSÉE
   ======================================================================== */

test("le relais accepte la requête d’Aide restreinte à la France", async () => {
  /* Elle repartait en 400 à chaque appel. Le client ne rejoue jamais Overpass
     en direct derrière le relais : Aide n'obtenait donc AUCUN lieu
     OpenStreetMap. La panne se lisait côté écran comme « Overpass
     indisponible », c'est-à-dire comme le réseau. */
  const { default: relais } = await import("../api/lieux.js");
  const fetchOrigine = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("réseau neutralisé pour le test"); };
  const avertir = console.warn;
  console.warn = () => {};
  try {
    const aide = '[out:json][timeout:8];area["ISO3166-1"="FR"]->.fr;' +
      '(nwr(around:1200,50.69,3.17)(area.fr)["amenity"~"^(social_facility)$"];);out center 180;';
    const r = await relais(new Request("https://exemple.test/api/lieux?q=" + encodeURIComponent(aide)));
    assert.notEqual(r.status, 400, "la forme d’Aide doit être acceptée");
    assert.equal(r.status, 503, "elle échoue ici seulement parce que le réseau est neutralisé");
  } finally {
    globalThis.fetch = fetchOrigine;
    console.warn = avertir;
  }
});

test("le relais reste fermé à tout le reste", async () => {
  const { default: relais } = await import("../api/lieux.js");
  const refusees = [
    "[out:json][timeout:8];out meta;",
    // une aire rappelée sans être déclarée
    '[out:json][timeout:8];(nwr(around:1200,50.69,3.17)(area.fr)["amenity"~"^(x)$"];);out center 180;',
    // un préambule sans rappel
    '[out:json][timeout:8];area["ISO3166-1"="FR"]->.fr;(nwr(around:1200,50.69,3.17)["amenity"~"^(x)$"];);out center 180;',
    // une sortie qui n'est pas la nôtre
    '[out:json][timeout:8];(nwr(around:1200,50.69,3.17)["amenity"~"^(x)$"];);out body 180;',
  ];
  for (const q of refusees) {
    const r = await relais(new Request("https://exemple.test/api/lieux?q=" + encodeURIComponent(q)));
    assert.equal(r.status, 400, "doit être refusée : " + q);
  }
});

test("le client laisse au relais le temps que le relais s’accorde", () => {
  /* Le client coupait à 4,5 s au démarrage et 6 s sur demande ; le relais
     s'accordait 9 s. La fonction Edge écoute `requete.signal` : chaque
     abandon du navigateur annulait le travail amont, et le CDN n'enregistrait
     donc jamais rien. Sur mobile — où la coupure tombait toujours avant la
     réponse — la zone restait froide indéfiniment. */
  assert.match(html, /const RELAIS_DELAI_MS = 12000;/);
  assert.match(html, /Math\.max\(msMax \|\| 0, RELAIS_DELAI_MS\)/);
  const total = Number((apiLieux.match(/const DELAI_TOTAL_MS = (\d+);/) || [])[1]);
  const serveur = Number((apiLieux.match(/const DELAI_SERVEUR_MS = (\d+);/) || [])[1]);
  assert.ok(total < 12000, "le relais doit rendre la main avant que le client ne coupe");
  assert.ok(serveur < total, "une instance ne peut pas dépasser le budget total");
  /* Et le `timeout:` écrit DANS la requête est celui qu'Overpass s'accorde :
     il était calé sur le budget de l'écran, donc plus court que celui du
     relais — une requête large n'avait mathématiquement aucune chance. */
  assert.match(html, /const secondesOverpass = Math\.min\(25, Math\.max\(8, Math\.round\(delai\/1000\)\)\);/);
});

/* ==========================================================================
   6. LA FICHE : IMAGE, SOURCE, ET RIEN D'INVENTÉ
   ======================================================================== */

test("une fiche sans photo a le même repli, quelle que soit la porte d’entrée", () => {
  /* `couvertureLieu` posait `sans-photo`, `couvertureAide` non : deux fiches
     sans photo ne se ressemblaient pas selon l'écran d'où l'on venait. Et le
     repli affichait un pictogramme DEUX FOIS PLUS PETIT que celui qu'une
     image recouvre de toute façon. */
  assert.match(html, /'<figure class="aide-couverture'\+\(photo\?'':' sans-photo'\)\+'/);
  assert.match(html, /'<figure class="aide-couverture'\+\(l\.image\?'':' sans-photo'\)\+'/);
  const taille = html.match(/\.aide-couverture\.sans-photo>span\{font-size:(\d+)px/);
  assert.ok(taille && Number(taille[1]) >= 56,
    "sans photo, le pictogramme est le visuel : il ne peut pas être plus petit");
});

test("aucune image n’est associée sur la foi d’un mot du descriptif", async () => {
  /* Le résolveur d'image l'interdit déjà — une seule règle, écrite une fois —
     et il doit continuer : c'est elle qui empêche qu'une fiche mal classée
     hérite en plus de la photo de sa fausse catégorie. */
  const resolveur = await readFile(new URL("../images.js", import.meta.url), "utf8");
  assert.match(resolveur, /aucune photo\s*\n?\s*de catégorie/);
  assert.match(resolveur, /UNE PHOTO REPRÉSENTE CE LIEU-CI/);
});

test("la fiche nomme sa source au lieu d’écrire « undefined »", () => {
  /* `esc(l.par)` : les lieux venus d'un catalogue n'ont pas de `par`, et
     `esc(undefined)` rend la chaîne « undefined ». C'était affiché sous
     « Posté par » sur chaque fiche DATAtourisme. */
  assert.match(html, /'<div><dt>Source<\/dt><dd>'\+esc\(sourceAide\(l\)\)\+'<\/dd><\/div>'/);
  assert.doesNotMatch(html, /<dt>Posté par<\/dt><dd>'\+esc\(l\.par\)/);
});

/* ==========================================================================
   7. CE QUE SAFARI NE SAIT PAS FAIRE

   Le moteur de Safari n'est pas exécutable dans l'environnement de test : ces
   règles-là se vérifient donc par lecture, pas par rendu. Elles portent sur
   les seules constructions récentes que l'application emploie.
   ======================================================================== */

test("chaque fond en color-mix a un repli uni déclaré avant lui", async () => {
  /* `color-mix()` demande Safari 16.2 / iOS 16.2. En dessous, la déclaration
     entière est JETÉE — pas dégradée. Une couverture ou une vignette sans
     repli n'a alors aucun fond, et la tuile teintée qui EST la réponse d'une
     fiche sans photo disparaît sur les iPhone non mis à jour.

     La cascade fait le travail à condition que le repli soit déclaré AVANT :
     le navigateur qui comprend le mélange écrase, celui qui ne le comprend
     pas garde la couleur unie. */
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const styles = page.replace(/\/\*[\s\S]*?\*\//g, "");
  const regles = styles.split("}");
  for (const regle of regles) {
    if (!/background\s*:[^;]*color-mix/.test(regle)) continue;
    const avant = regle.slice(0, regle.search(/background\s*:[^;]*color-mix/));
    assert.match(avant, /background\s*:\s*(#[0-9A-Fa-f]{3,8}|rgb|var\(|[a-z]+)\s*;/,
      "un fond color-mix sans repli uni :\n" + regle.trim().slice(0, 160));
  }
});

test("le code livré n’emploie aucune construction qui manque à Safari", async () => {
  /* Les fonctions ajoutées n'utilisent ni regard arrière (`(?<=`), absent de
     Safari avant 16.4, ni `Array.at`, ni `Object.hasOwn`, ni `structuredClone`,
     ni `:has()`. Ce test lit les fichiers réellement servis au navigateur. */
  const livres = ["app.js", "availability.js", "temporel.js", "aide-rayon.js", "differe/ecrans.js"];
  for (const fichier of livres) {
    const source = await readFile(new URL("../" + fichier, import.meta.url), "utf8");
    for (const [nom, motif] of [
      ["regard arrière", /\(\?<[=!]/],
      ["Array.prototype.at", /\.at\(\s*-?\d/],
      ["Object.hasOwn", /Object\.hasOwn\(/],
      ["structuredClone", /structuredClone\(/],
      ["Array.prototype.toSorted", /\.toSorted\(/],
    ]) assert.doesNotMatch(source, motif, nom + " dans " + fichier);
  }
});

test("la géolocalisation garde son repli Safari", () => {
  /* Safari ne répond pas à `permissions.query({name:"geolocation"})`. La trace
     locale est le seul moyen de savoir qu'une autorisation a déjà été donnée —
     et c'est elle que le nouveau chemin d'erreur consulte pour relancer la
     veille au lieu de déclarer un refus. */
  assert.match(html, /const CLE_GEO_OK = "autour:geo-autorisee";/);
  assert.match(html, /return geoDejaAutorisee\(\) \? "granted" : "prompt";/);
  assert.match(html, /if\(geoDejaAutorisee\(\)\) veillerSurLaPosition\(\);/);
  // et tout accès au stockage reste protégé : Safari en navigation privée jette
  const cache = html.slice(html.indexOf("function completerCacheLieux"),
    html.indexOf("function completerCacheLieux") + 900);
  assert.match(cache, /lireCacheLieux\(lat,lng\)/);
  assert.match(html, /function lireCacheLieux\(lat,lng\)\{[\s\S]*?catch\(e\)\{ return null; \}/);
});

/* ==========================================================================
   8. LA PARITÉ ORDINATEUR / TÉLÉPHONE
   ======================================================================== */

test("rien dans le corps de l’application ne branche sur l’appareil", () => {
  /* Le responsive décrit la présentation. Aucune requête, aucun délai, aucun
     classement ne doit dépendre d'un userAgent ni d'un modèle d'appareil —
     c'est ce qui rend une même donnée équivalente des deux côtés. */
  assert.doesNotMatch(corps, /navigator\.userAgent/);
  assert.doesNotMatch(corps, /navigator\.platform/);
  assert.doesNotMatch(corps, /maxTouchPoints/);
});

test("les délais réseau sont écrits une fois, pour tout le monde", () => {
  /* Il n'existe pas de budget « mobile » et de budget « bureau » : il existe
     un budget d'écran (court, parce que personne n'attend) et un budget
     d'arrière-plan (long, parce que le relais travaille pour le quartier). */
  for (const constante of [
    /const OVERPASS_DELAI_BOOT = \d+;/,
    /const OVERPASS_DELAI_DEMANDE = \d+;/,
    /const RELAIS_DELAI_MS = \d+;/,
    /const AIDE_DELAI_SOURCE_MS = \d+;/,
  ]) assert.match(html, constante);
});
