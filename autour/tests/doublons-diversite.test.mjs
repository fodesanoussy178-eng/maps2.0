import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../core.js";
import { sourceApplicationSync } from "./source.mjs";

const html = sourceApplicationSync(import.meta.url);

const {
  dedupeItems, diversifierResultats, normaliserNomLieu, normaliserAdresse,
  estSansNom, memeIdentifiantExterne, sousCategorieDe, familleDiversite,
  rankResults, toCommonItem,
} = globalThis.AutourCore;

/* Aucune de ces vérifications ne connaît de ville : tout part de coordonnées
   relatives à un point de référence quelconque, exactement comme le fait
   l'application à partir de la zone active. Les repères ci-dessous sont donc
   des décalages en degrés, pas des adresses. */
const ORIGINE = [50.0, 3.0];

function distance(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos((aLat + bLat) * rad / 2);
  const y = (bLat - aLat) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/* ~111 m par millidegré de latitude : les décalages ci-dessous se lisent
   directement en centaines de mètres. */
const lieu = (extra) => toCommonItem(Object.assign({
  id: String(Math.random()), cat: "parc", titre: "Parcs", sansNom: true,
  lat: ORIGINE[0], lng: ORIGINE[1],
}, extra), { source: extra && extra.source ? extra.source : "openstreetmap" });

/* ====================================================================== */
/*  1. Normalisation des noms                                             */
/* ====================================================================== */

test("le nom se compare sans casse, sans accent, sans ponctuation ni article", () => {
  const attendu = normaliserNomLieu("Parc Clemenceau");
  for (const variante of ["parc clemenceau", "PARC CLÉMENCEAU", "Le Parc Clemenceau",
                          "Parc  Clémenceau !", "Parc-Clemenceau", "L’espace… non"])
    if (variante !== "L’espace… non") assert.equal(normaliserNomLieu(variante), attendu, variante);
});

test("le singulier et le pluriel désignent la même chose", () => {
  assert.equal(normaliserNomLieu("Parcs"), normaliserNomLieu("Parc"));
  assert.equal(normaliserNomLieu("Jardins publics"), normaliserNomLieu("Jardin public"));
  // …mais un mot court qui finit par « s » n'est pas un pluriel
  assert.equal(normaliserNomLieu("Bus"), "bus");
});

test("les abréviations évidentes rejoignent leur forme développée", () => {
  assert.equal(normaliserNomLieu("St Michel"), normaliserNomLieu("Saint Michel"));
  assert.equal(normaliserNomLieu("Ste Anne"), normaliserNomLieu("Sainte Anne"));
});

test("deux noms réellement différents ne se confondent pas", () => {
  assert.notEqual(normaliserNomLieu("Parc Clemenceau"), normaliserNomLieu("Parc Barbieux"));
  assert.notEqual(normaliserNomLieu("Le Central"), normaliserNomLieu("Le Centre"));
});

test("l'adresse se compare sans son rôle de voie", () => {
  assert.equal(normaliserAdresse("12 rue de la Paix"), normaliserAdresse("12 R. Paix"));
  assert.notEqual(normaliserAdresse("12 rue de la Paix"), normaliserAdresse("14 rue de la Paix"));
});

/* ====================================================================== */
/*  2. Déduplication réelle                                               */
/* ====================================================================== */

test("quatre relevés anonymes du même parc ne font qu'une carte", () => {
  // le cas exact décrit : quatre objets « Parcs » côte à côte
  const parcs = [
    lieu({ id: "p1" }),
    lieu({ id: "p2", lat: ORIGINE[0] + 0.0012 }),
    lieu({ id: "p3", lat: ORIGINE[0] - 0.0016, lng: ORIGINE[1] + 0.001 }),
    lieu({ id: "p4", lng: ORIGINE[1] + 0.002 }),
  ];
  assert.equal(dedupeItems(parcs, distance).length, 1);
});

test("deux parcs nommés différemment restent deux propositions", () => {
  const a = lieu({ id: "a", titre: "Parc Clemenceau", sansNom: false });
  const b = lieu({ id: "b", titre: "Parc Barbieux", sansNom: false, lat: ORIGINE[0] + 0.001 });
  assert.equal(dedupeItems([a, b], distance).length, 2);
});

test("un même parc morcelé en plusieurs polygones redevient un seul lieu", () => {
  // un objet étendu se lit sur plusieurs centaines de mètres : ses morceaux
  // portent le même nom et n'en désignent qu'un
  const a = lieu({ id: "a", titre: "Parc Clemenceau", sansNom: false });
  const b = lieu({ id: "b", titre: "Parc Clemenceau", sansNom: false, lat: ORIGINE[0] + 0.0027 });
  assert.equal(dedupeItems([a, b], distance).length, 1);
});

test("deux commerces homonymes à trois cents mètres restent deux commerces", () => {
  // ce qui vaut pour un parc ne vaut pas pour une enseigne : deux boulangeries
  // de la même chaîne dans la même rue sont deux adresses
  const a = lieu({ id: "a", cat: "resto", titre: "Le Comptoir", sansNom: false });
  const b = lieu({ id: "b", cat: "resto", titre: "Le Comptoir", sansNom: false,
    lat: ORIGINE[0] + 0.0027 });
  assert.equal(dedupeItems([a, b], distance).length, 2);
});

test("un identifiant externe partagé suffit, même sans nom commun", () => {
  const osm = lieu({ id: "osm-1", cat: "cafe", titre: "Chez Marcel", sansNom: false,
    idGoogle: "PLACE-XYZ" });
  const google = lieu({ id: "g-1", cat: "cafe", titre: "Marcel Café", sansNom: false,
    idGoogle: "PLACE-XYZ", lat: ORIGINE[0] + 0.0004, source: "google_places" });
  assert.ok(memeIdentifiantExterne(osm, google));
  assert.equal(dedupeItems([osm, google], distance).length, 1);
});

test("la même adresse exacte réunit deux orthographes d'un même établissement", () => {
  const a = lieu({ id: "a", cat: "resto", titre: "Pizzeria Napoli", sansNom: false,
    adresse: "14 rue des Fleurs" });
  const b = lieu({ id: "b", cat: "resto", titre: "Napoli Pizza", sansNom: false,
    adresse: "14 R. des Fleurs", lat: ORIGINE[0] + 0.0003, source: "google_places" });
  assert.equal(dedupeItems([a, b], distance).length, 1);
});

test("une adresse qui n'est qu'un libellé de catégorie ne fusionne rien", () => {
  /* Les relevés sans numéro ni rue retombent parfois sur leur propre libellé.
     Si cette pseudo-adresse comptait comme preuve, tous les objets anonymes
     d'une même nature fusionneraient à travers la carte entière. */
  const a = lieu({ id: "a", cat: "musee", titre: "Musées", adresse: "Musées" });
  const b = lieu({ id: "b", cat: "musee", titre: "Musées", adresse: "Musées",
    lat: ORIGINE[0] + 0.02 });
  assert.equal(dedupeItems([a, b], distance).length, 2, "deux kilomètres, deux lieux");
});

test("un lieu nommé n'est jamais absorbé par un lieu anonyme", () => {
  const anonyme = lieu({ id: "anon" });
  const nomme = lieu({ id: "nomme", titre: "Parc Clemenceau", sansNom: false,
    lat: ORIGINE[0] + 0.0005 });
  const uniques = dedupeItems([anonyme, nomme], distance);
  assert.equal(uniques.length, 2);
});

test("la fusion garde le vrai nom, jamais le libellé de catégorie", () => {
  // même enregistrement vu deux fois : l'un des deux relevés porte le nom
  const sansNom = lieu({ id: "même", cat: "parc", titre: "Parcs" });
  const avecNom = lieu({ id: "même", cat: "parc", titre: "Parc Clemenceau",
    sansNom: false, source: "google_places" });
  const [fusionne] = dedupeItems([sansNom, avecNom], distance);
  assert.equal(fusionne.titre, "Parc Clemenceau");
  assert.equal(fusionne.title, "Parc Clemenceau");
  assert.equal(estSansNom(fusionne), false);
});

test("à nom égal, la fiche la mieux renseignée représente le lieu", () => {
  const pauvre = lieu({ id: "x", cat: "cafe", titre: "Chez Marcel", sansNom: false });
  const riche = lieu({ id: "x", cat: "cafe", titre: "Chez Marcel", sansNom: false,
    adresse: "3 rue Haute", tel: "0300000000", url: "https://exemple.test",
    horaires: ["lundi: 08:00–19:00"], image: "https://exemple.test/i.jpg",
    description: "Un café", source: "google_places" });
  const [fusionne] = dedupeItems([pauvre, riche], distance);
  assert.equal(fusionne.tel, "0300000000");
  assert.deepEqual(fusionne.horaires, ["lundi: 08:00–19:00"]);
});

test("deux arrêts anonymes voisins restent deux arrêts", () => {
  // le rayon large des objets anonymes est réservé à ce qui est étendu : deux
  // arrêts à deux cents mètres sont deux points de montée distincts
  const a = lieu({ id: "a", cat: "bus", titre: "Bus" });
  const b = lieu({ id: "b", cat: "bus", titre: "Bus", lat: ORIGINE[0] + 0.0018 });
  assert.equal(dedupeItems([a, b], distance).length, 2);
});

test("les toilettes anonymes les plus proches ne disparaissent pas", () => {
  // faire disparaître le dépannage le plus proche serait un vrai préjudice :
  // seul le doublon manifeste — le même objet relevé deux fois — est fusionné
  const a = lieu({ id: "a", cat: "toilettes", titre: "Toilettes" });
  const b = lieu({ id: "b", cat: "toilettes", titre: "Toilettes", lat: ORIGINE[0] + 0.0018 });
  assert.equal(dedupeItems([a, b], distance).length, 2);
  const jumeau = lieu({ id: "c", cat: "toilettes", titre: "Toilettes",
    lat: ORIGINE[0] + 0.0002 });
  assert.equal(dedupeItems([a, jumeau], distance).length, 1);
});

test("la déduplication vaut pour tout ce qui est affiché, liste comme carte", () => {
  // liste et marqueurs lisent la même collection, construite par une seule
  // déduplication : il n'existe pas de chemin qui contourne la règle
  assert.match(html, /lieux = fusionnerFichesFournisseurs\(dedupeItems\(\[/);
  assert.match(html, /const dedupliques = dedupeItems\(\[\.\.\.parId\.values\(\)\], distanceM\);/);
});

/* ====================================================================== */
/*  3. Le vrai nom plutôt que la catégorie                                */
/* ====================================================================== */

test("le nom réel est cherché partout avant de retomber sur la catégorie", () => {
  assert.match(html, /const CLES_NOM_OSM = \[/);
  assert.match(html, /function nomReelOsm\(tags\)\{/);
  for (const cle of ["name", "name:fr", "official_name", "brand", "addr:housename"])
    assert.ok(html.includes('"' + cle + '"'), "la clé " + cle + " doit être consultée");
  // …mais jamais l'exploitant : « Ville de … » exploite un parc, ce n'est pas
  // son nom, et l'afficher reviendrait à en inventer un
  const cles = /const CLES_NOM_OSM = \[[\s\S]*?\];/.exec(html)[0];
  assert.doesNotMatch(cles, /"operator"/);
  // et le libellé de catégorie ne sert plus qu'à ça : le dernier recours
  assert.match(html, /titre: nom \|\| CATS\[cat\]\.label,/);
  assert.match(html, /sansNom: !nom,/);
});

test("le libellé de catégorie n'est plus jamais recopié en guise d'adresse", () => {
  assert.doesNotMatch(html, /\|\| \(t\.name\|\|CATS\[cat\]\.label\)/);
});

/* ====================================================================== */
/*  4. Diversité                                                          */
/* ====================================================================== */

const classe = (id, cat, score) => ({ id, cat, titre: id, rankScore: score });

test("quatre parcs d'affilée deviennent une sélection variée", () => {
  const entree = [
    classe("parc1", "parc", 200), classe("parc2", "parc", 198),
    classe("parc3", "parc", 196), classe("parc4", "parc", 194),
    classe("resto", "resto", 190), classe("bar", "bar", 188),
    classe("musee", "musee", 186),
  ];
  const sortie = diversifierResultats(entree, { fenetre: 5 });
  const cats = sortie.slice(0, 5).map((l) => l.cat);
  const parcs = cats.filter((c) => c === "parc").length;
  assert.ok(parcs <= 2, "au plus deux parcs en tête, vu : " + cats.join(", "));
  assert.equal(sortie[0].id, "parc1", "la tête de liste reste le meilleur résultat");
});

test("la diversité réordonne, elle ne retire ni n'invente rien", () => {
  const entree = [
    classe("a", "parc", 200), classe("b", "parc", 199), classe("c", "parc", 198),
    classe("d", "resto", 197), classe("e", "resto", 196),
  ];
  const sortie = diversifierResultats(entree, { fenetre: 4 });
  assert.equal(sortie.length, entree.length);
  assert.deepEqual(new Set(sortie.map((l) => l.id)), new Set(entree.map((l) => l.id)));
});

test("un résultat nettement moins bon ne remonte pas pour faire joli", () => {
  const entree = [
    classe("parc1", "parc", 300), classe("parc2", "parc", 295),
    classe("mediocre", "bar", 40),
  ];
  const sortie = diversifierResultats(entree, { fenetre: 3 });
  assert.deepEqual(sortie.map((l) => l.id), ["parc1", "parc2", "mediocre"],
    "la qualité prime : on garde deux bons parcs plutôt qu'un mauvais bar");
});

test("sans alternative, la répétition est conservée telle quelle", () => {
  const entree = [classe("a", "parc", 200), classe("b", "parc", 199), classe("c", "parc", 198)];
  assert.deepEqual(diversifierResultats(entree, { fenetre: 3 }).map((l) => l.id),
    ["a", "b", "c"]);
});

test("trois façons de manger d'affilée ne passent pas pour de la variété", () => {
  const entree = [
    classe("resto", "resto", 200), classe("fastfood", "fastfood", 199),
    classe("cafe", "cafe", 198), classe("parc", "parc", 197),
  ];
  const sortie = diversifierResultats(entree, { fenetre: 3 });
  const familles = sortie.slice(0, 3).map(familleDiversite);
  assert.ok(familles.filter((f) => f === "manger").length <= 2,
    "vu : " + familles.join(", "));
});

test("la sous-catégorie est celle du lieu, pas une famille inventée", () => {
  assert.equal(sousCategorieDe({ cat: "parc" }), "parc");
  assert.equal(sousCategorieDe({ categories: ["cafe"] }), "cafe");
  assert.equal(familleDiversite({ cat: "cafe" }), "manger");
  assert.equal(familleDiversite({ cat: "parc" }), "dehors");
});

test("le classement n'applique la diversité que lorsqu'on la demande", () => {
  const items = [
    { id: "p1", cat: "parc", titre: "Parc A", lat: ORIGINE[0], lng: ORIGINE[1], ouvert: true },
    { id: "p2", cat: "parc", titre: "Parc B", lat: ORIGINE[0] + 0.001, lng: ORIGINE[1], ouvert: true },
    { id: "p3", cat: "parc", titre: "Parc C", lat: ORIGINE[0] + 0.002, lng: ORIGINE[1], ouvert: true },
    { id: "b1", cat: "bar", titre: "Bar", lat: ORIGINE[0] + 0.003, lng: ORIGINE[1], ouvert: true },
  ].map((x) => toCommonItem(x, { source: "openstreetmap" }));
  const contexte = { intent: "explorer", position: ORIGINE, now: Date.now(),
    distanceBetween: distance };
  const brut = rankResults(items, contexte);
  const varie = rankResults(items, Object.assign({ diversite: { fenetre: 4 } }, contexte));
  assert.equal(brut.length, varie.length);
  const parcsEnTete = varie.slice(0, 3).filter((l) => l.cat === "parc").length;
  assert.ok(parcsEnTete <= 2, "la diversité demandée doit s'appliquer");
});

test("l'accueil demande la diversité, une recherche précise ne la demande pas", () => {
  assert.match(html, /function diversiteDemandee\(\)\{/);
  assert.match(html, /diversite:diversiteDemandee\(\)/);
  const bloc = /function diversiteDemandee\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /if\(modeAide\) return null;/);
  assert.match(bloc, /if\(catsActives && catsActives\.size\) return null;/);
  assert.match(bloc, /if\(rechercheTexte\(\)\) return null;/);
});

/* ====================================================================== */
/*  5. La proximité ne décide plus seule                                  */
/* ====================================================================== */

test("un lieu un peu plus loin mais meilleur passe devant le plus proche", () => {
  const proche = toCommonItem({ id: "proche", cat: "cafe", titre: "Café d’en bas",
    lat: ORIGINE[0] + 0.00126, lng: ORIGINE[1], ouvert: true }, { source: "openstreetmap" });
  const meilleur = toCommonItem({ id: "meilleur", cat: "cafe", titre: "Le Bon Café",
    lat: ORIGINE[0] + 0.00315, lng: ORIGINE[1], ouvert: true,
    adresse: "2 rue Haute", tel: "0300000000", url: "https://exemple.test",
    description: "Torréfaction sur place", image: "https://exemple.test/i.jpg",
    horaires: ["lundi: 08:00–19:00"], note: 4.7, avis: 900 }, { source: "google_places" });
  const classement = rankResults([proche, meilleur], {
    intent: "chiller", position: ORIGINE, now: Date.now(), distanceBetween: distance,
  });
  assert.equal(classement[0].id, "meilleur",
    "140 m ne doit pas battre 350 m quand la proposition est nettement meilleure");
});

test("une différence de trajet réelle reprend tous ses droits", () => {
  // deux paliers de marche d'écart : là, la proximité redevient décisive
  const proche = toCommonItem({ id: "proche", cat: "cafe", titre: "Café",
    lat: ORIGINE[0] + 0.001, lng: ORIGINE[1], ouvert: true }, { source: "openstreetmap" });
  const loin = toCommonItem({ id: "loin", cat: "cafe", titre: "Autre café",
    lat: ORIGINE[0] + 0.02, lng: ORIGINE[1], ouvert: true,
    adresse: "2 rue Haute", tel: "0300000000", url: "https://exemple.test",
    description: "Un café", image: "https://exemple.test/i.jpg",
    horaires: ["lundi: 08:00–19:00"] }, { source: "google_places" });
  const classement = rankResults([loin, proche], {
    intent: "chiller", position: ORIGINE, now: Date.now(), distanceBetween: distance,
  });
  assert.equal(classement[0].id, "proche");
});

/* ====================================================================== */
/*  6. « Autour cherche » : léger, non bloquant, et il s'en va tout seul   */
/* ====================================================================== */

test("l'indicateur de recherche est une ligne, pas un écran", () => {
  assert.match(html, /function indicateurRechercheHTML\(nombreResultats\)\{/);
  assert.match(html, /Autour cherche autour de toi…/);
  const bloc = /function indicateurRechercheHTML\(nombreResultats\)\{[\s\S]*?\n\}/.exec(html)[0];
  // il disparaît de lui-même dès qu'il y a de quoi choisir
  assert.match(bloc, /if\(Number\(nombreResultats\) >= ASSEZ_DE_RESULTATS\) return "";/);
  assert.match(bloc, /role="status"/);
  // aucun voile, aucun blocage : la carte reste utilisable pendant ce temps
  assert.doesNotMatch(bloc, /position:fixed|inset:0|aria-modal/);
});

test("l'indicateur se pose sous les résultats, il ne les remplace pas", () => {
  assert.match(html,
    /reco\.map\(carteRecommandation\)\.join\(""\)\+'<\/div>'\+\s*\n\s*indicateurRechercheHTML\(reco\.length\)/);
});

test("le style de l'indicateur reste discret et respecte les préférences d'animation", () => {
  assert.match(html, /\.fb-statut\.cherche\{/);
  assert.match(html, /@keyframes cherche-respire\{/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{\s*\n\s*\.cherche-pastille\{animation:none/);
});

/* ====================================================================== */
/*  7. Jamais de liste qui disparaît puis réapparaît                      */
/* ====================================================================== */

test("les cartes précédentes tiennent la place pendant un nouveau classement", () => {
  assert.match(html, /let dernierRecoRendu = null;/);
  const bloc = /function recoDejaCalculee\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /dernierRecoRendu\.portee === porteeCourante/);
  // le squelette n'est plus qu'un dernier recours, quand on n'a jamais rien montré
  assert.ok(bloc.indexOf("dernierRecoRendu") < bloc.indexOf("statutGroupeHTML()"));
});

test("le report d'affichage ne franchit pas une frontière de zone", () => {
  const bloc = /function definirZoneActive\(zone\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(bloc, /dernierRecoRendu = null;/,
    "les cartes d'une ville quittée ne doivent jamais servir de patience");
});

/* ====================================================================== */
/*  8. Déplacement de carte                                               */
/* ====================================================================== */

test("une vue identique ne relance ni rendu ni requête", () => {
  assert.match(html, /const empreinteDeLaVue = \(\)=>\{/);
  assert.match(html, /if\(vue === empreinteVue\) return;/);
  // et le tout reste derrière la temporisation existante
  assert.match(html, /clearTimeout\(minuteurRendu\);/);
});

/* ====================================================================== */
/*  9. Cache et contexte géographique                                     */
/* ====================================================================== */

test("une clé de cache porte la zone dont elle parle", () => {
  // sans ça, la zone qu'on vient de demander recevrait les lieux de celle
  // qu'on a quittée : le premier arrivé servirait le second
  assert.match(html, /function cleZone\(lat, lng, z, cats\)\{\s*\n\s*return idZoneActive\(\)\+/);
});

test("un déplacement de quelques mètres ne redemande rien", () => {
  assert.match(html, /distanceM\(dernierChargement\[0\], dernierChargement\[1\], lat, lng\) < 800\) return Promise\.resolve\(\[\]\);/);
  assert.match(html, /if\(!o\.force && zonesVues\.has\(cle\)\) return Promise\.resolve\(\[\]\);/);
});

test("les données très temporelles se rafraîchissent bien plus souvent que les lieux", () => {
  const permanent = /const CACHE_HEURES = (\d+);/.exec(html);
  const temporaire = /if\(!o\.force && Date\.now\(\)-dernier < (\d+)\*60\*1000\) return Promise\.resolve\(\[\]\);/
    .exec(html);
  assert.ok(permanent && temporaire);
  const heuresPermanent = Number(permanent[1]);
  const heuresTemporaire = Number(temporaire[1]) / 60;
  assert.ok(heuresTemporaire < heuresPermanent / 10,
    "« Maintenant » doit vivre bien moins longtemps que les POI permanents");
});

/* ====================================================================== */
/*  10. « Maintenant » : trois, puis dix, jamais davantage                */
/* ====================================================================== */

test("« Maintenant » montre uniquement les trois propositions du moteur", () => {
  assert.doesNotMatch(html, /MAINTENANT_TOUT|data-mn-tout/);
  assert.match(html, /const liste = selectionMaintenant\(\);\s*const combien = liste\.length;/);
  assert.match(html, /const enCours = selectionMaintenant\(\)\.length;/);
  assert.match(html, /M\.selection\(itemsMaintenant\(ctx\), ctx\)/);
});

/* ====================================================================== */
/*  11. Aucune règle attachée à une ville                                 */
/* ====================================================================== */

/* Les villes ont parfaitement le droit d'apparaître dans les explications —
   c'est même comme ça qu'on raconte un cas réel. Ce qui est interdit, c'est
   qu'une ville existe dans le CODE : une condition, un seuil, une table de
   correspondance qui ferait qu'Autour se comporte autrement ici qu'ailleurs.
   On retire donc les commentaires avant de regarder. */
function sansCommentaires(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((ligne) => ligne.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
}

test("aucune règle n'est écrite pour une ville en particulier", () => {
  const core = sansCommentaires(readFileSync(new URL("../core.js", import.meta.url), "utf8"));
  const villes = ["tourcoing", "lille", "roubaix", "marseille", "bordeaux", "toulouse"];
  for (const ville of villes)
    assert.doesNotMatch(core, new RegExp(ville, "i"),
      "core.js ne doit contenir aucune logique nommant " + ville);

  /* Côté application, les mêmes règles doivent partir des coordonnées et de
     la zone active — jamais d'un nom de commune codé en dur. */
  const bloc = /function diversiteDemandee\(\)\{[\s\S]*?\n\}/.exec(html)[0] +
    /function recommandationsAccueil\(limite, options\)\{[\s\S]*?\n\}/.exec(html)[0];
  for (const ville of villes)
    assert.doesNotMatch(sansCommentaires(bloc), new RegExp(ville, "i"));
  // le centre du classement vient de la zone active, pas d'une ville nommée
  assert.match(html, /const centre = centreZoneActive\(\) \|\| \(map \? \[map\.getCenter\(\)\.lat, map\.getCenter\(\)\.lng\] : null\);/);
});
