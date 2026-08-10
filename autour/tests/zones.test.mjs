/* Les jeux de démarrage par zone : ce qui décide qu'un lieu d'aide y entre.

   Ces fichiers sont la SEULE source de propositions au tout premier
   démarrage — avant Overpass, avant Nominatim, avant la géolocalisation.
   La première version n'y mettait que des commerces et des loisirs : sur
   1055 lieux récoltés pour Lille et Paris, pas une banque alimentaire, pas un
   hébergement. Quelqu'un qui ouvrait Autour pour trouver un foyer tombait sur
   une liste de restaurants.

   On ne peut pas interroger Overpass depuis les tests — et il ne faudrait pas.
   Ce qui se teste ici, c'est la classification : quels tags sont demandés, et
   dans quelle famille chaque lieu atterrit. */
import test from "node:test";
import assert from "node:assert";
import { versLieu, eclaircir, AIDE, REQUETES, REQUETES_AIDE, REQUETES_RESTE,
         cleTuile } from "../outils/zones.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const villes = JSON.parse(readFileSync(join(ICI, "../outils/villes.json"), "utf8"));

const lieu = (tags, i = 1) =>
  versLieu({ type: "node", id: i, lat: 50.6 + i * 1e-4, lon: 3.05 + i * 1e-4, tags });

test("les tags d'aide sont réellement demandés à Overpass", () => {
  const demande = REQUETES.map(([k, v]) => k + "=" + v).join(" ");
  // les trois familles qui font qu'Autour sert à quelque chose quand on n'a rien
  assert.match(demande, /social_facility/);
  assert.match(demande, /food_bank/);
  assert.match(demande, /soup_kitchen/);
  assert.match(demande, /shelter/);
  assert.match(demande, /employment_agency/);
});

test("l'aide et le reste sont demandés séparément, et l'aide reste légère", () => {
  /* Tout demander d'un coup a fait répondre 504 aux trois instances sur les
     tuiles denses (Paris, Lille nord). Séparé, une tuile qui sature perd ses
     restaurants, jamais ses banques alimentaires. */
  const aide = REQUETES_AIDE.map(([k, v]) => k + "=" + v).join(" ");
  const reste = REQUETES_RESTE.map(([k, v]) => k + "=" + v).join(" ");
  assert.match(aide, /social_facility/);
  assert.match(aide, /employment_agency/);
  assert.doesNotMatch(aide, /restaurant/, "l'aide ne doit pas porter le poids des commerces");
  assert.match(reste, /restaurant/);
  assert.doesNotMatch(reste, /social_facility/);
  // et rien ne doit se retrouver dans les deux : on paierait deux fois
  const cles = (g) => new Set(g.flatMap(([k, v]) => v.split("|").map((x) => k + "=" + x)));
  const a = cles(REQUETES_AIDE), r = cles(REQUETES_RESTE);
  const communs = [...a].filter((x) => r.has(x));
  assert.deepEqual(communs, [], "tags demandés deux fois : " + communs.join(", "));
  // REQUETES reste l'union des deux, pour le classement
  assert.equal(REQUETES.length, REQUETES_AIDE.length + REQUETES_RESTE.length);
});

test("un 504 n'est pas un verdict : on repasse une fois", () => {
  /* Observé sur huit tuiles : `overpass-api.de` refuse en 8 à 12 s — un rejet
     de charge, pas un calcul qui n'aboutit pas — et les tuiles tombées ne sont
     pas que les denses (Amiens, Reims et Dijon aussi). Un seul tour rendait
     donc une saturation passagère définitive. */
  const src = readFileSync(join(ICI, "../outils/zones.mjs"), "utf8");
  assert.match(src, /const PAUSE_ENTRE_TOURS = 20000;/);
  assert.match(src, /const premier = await unTour\(b, groupe, sortie\);\s*\n\s*if \(premier\) return premier;/);
  assert.match(src, /return unTour\(b, groupe, sortie\);/);
  // et le budget doit tenir : 2 tours × 3 instances × délai + pause, deux fois
  const delai = Number(/const DELAI_MS = (\d+);/.exec(src)[1]);
  const pireCas = 2 * (2 * 3 * delai + 20000) / 60000;
  assert.ok(pireCas < 25, "pire cas " + pireCas.toFixed(1) + " min > budget de la tâche");
});

test("un foyer est un hébergement, quel que soit son tag", () => {
  // le sous-tag explicite
  for (const v of ["shelter", "group_home", "homeless_shelter",
                   "emergency_shelter", "assisted_living"])
    assert.equal(lieu({ name: "Structure", amenity: "social_facility", social_facility: v }).cat,
      "hebergement", v + " devrait être un hébergement");
  // le tag nu, où seul le nom renseigne
  assert.equal(lieu({ name: "Foyer Notre-Dame", amenity: "social_facility" }).cat, "hebergement");
  assert.equal(lieu({ name: "CHRS Le Relais", amenity: "social_facility" }).cat, "hebergement");
  assert.equal(lieu({ name: "Résidence sociale Wazemmes", amenity: "social_facility" }).cat,
    "hebergement");
});

test("le sous-tag prime sur amenity : une banque alimentaire n'est pas une asso", () => {
  assert.equal(lieu({ name: "Restos du Cœur", amenity: "social_facility",
    social_facility: "food_bank" }).cat, "alimentaire");
  assert.equal(lieu({ name: "Soupe populaire", amenity: "social_facility",
    social_facility: "soup_kitchen" }).cat, "alimentaire");
  // et le tag nu, décidé par le nom
  assert.equal(lieu({ name: "Épicerie solidaire du Vieux-Lille",
    amenity: "social_facility" }).cat, "alimentaire");
});

test("les autres services d'aide tombent dans leur famille", () => {
  assert.equal(lieu({ name: "Mission locale", office: "employment_agency" }).cat, "emploi");
  assert.equal(lieu({ name: "Centre de santé", healthcare: "centre" }).cat, "sante");
  assert.equal(lieu({ name: "Mairie de Lille", amenity: "townhall" }).cat, "mairie");
  assert.equal(lieu({ name: "Accueil de jour", amenity: "social_facility",
    social_facility: "day_centre" }).cat, "asso");
});

test("un abribus n'est pas un hébergement", () => {
  // `amenity=shelter` est un abri de bus ou de pique-nique : l'inclure aurait
  // rempli « Hébergement » d'arrêts de bus
  assert.equal(lieu({ name: "Abri voyageurs", amenity: "shelter" }), null);
});

test("l'aide échappe à l'éclaircissage, qu'elle perdrait toujours au nombre", () => {
  const b = { s: 50.55, n: 50.65, o: 3.0, e: 3.1 };
  // un quartier réaliste : beaucoup de restaurants, deux lieux d'aide
  const lieux = [];
  for (let i = 0; i < 400; i += 1)
    lieux.push({ cat: "resto", titre: "Resto " + i, lat: 50.6, lng: 3.05,
      tags: {}, adresse: "x", quand: "Voir sur place", cp: "" });
  lieux.push({ cat: "alimentaire", titre: "Banque alimentaire", lat: 50.6, lng: 3.05,
    tags: {}, adresse: "y", quand: "Voir sur place", cp: "" });
  lieux.push({ cat: "hebergement", titre: "Foyer", lat: 50.6, lng: 3.05,
    tags: {}, adresse: "z", quand: "Voir sur place", cp: "" });

  const { retenus } = eclaircir(lieux, b);
  const titres = retenus.map((l) => l.titre);
  assert.ok(titres.includes("Banque alimentaire"), "la banque alimentaire a été éliminée");
  assert.ok(titres.includes("Foyer"), "le foyer a été éliminé");
  assert.ok(retenus.every((l) => AIDE.has(l.cat) || l.cat === "resto"));
});

test("les villes couvertes incluent celles qu'on a promises", () => {
  const tuiles = new Set(villes.map((v) => cleTuile(v.lat, v.lng)));
  // Lille, Paris, et les villes nommées ensuite
  const attendues = {
    "Lille":   cleTuile(50.63, 3.06),
    "Paris":   cleTuile(48.86, 2.35),
    "Angers":  cleTuile(47.47, -0.55),
    "Rouen":   cleTuile(49.44, 1.09),
    "Nantes":  cleTuile(47.22, -1.55),
    "Bordeaux":cleTuile(44.84, -0.58),
    "Lyon":    cleTuile(45.76, 4.84),
    "Marseille":cleTuile(43.30, 5.38),
  };
  for (const [nom, cle] of Object.entries(attendues))
    assert.ok(tuiles.has(cle), nom + " n'est couverte par aucune tuile (" + cle + ")");
});

test("chaque ville a des coordonnées exploitables", () => {
  for (const v of villes) {
    assert.ok(Number.isFinite(v.lat) && Number.isFinite(v.lng), v.nom + " : coordonnées absentes");
    assert.ok(v.lat > 41 && v.lat < 52, v.nom + " : latitude hors de France");
    assert.ok(v.lng > -5.5 && v.lng < 9.7, v.nom + " : longitude hors de France");
    assert.ok(v.nom && v.nom.length > 2, "une ville sans nom");
  }
});
