/* LE MOTEUR D'AIDE — CE QU'UNE STRUCTURE EST, PAS CE QU'ELLE S'APPELLE

   Le défaut rapporté tenait en un exemple :

     VIENNOISERIE ROYALE CROIX ROUGE → structure d'aide alimentaire

   Une boulangerie, promue centre d'aide par deux mots de son enseigne. La
   cause n'était pas une donnée manquante mais une règle fausse : `pertinence()`
   testait ses expressions de réseaux sur un texte dont le NOM était le premier
   élément, et rendait alors une certitude.

   Ces tests fixent la règle inverse, et ils la fixent des deux côtés : le nom
   seul ne fait jamais entrer dans Aide, ET les vraies structures continuent
   d'y entrer. Une correction qui viderait l'écran ne serait pas une
   correction. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../comprendre.js";
import "../aide-intentions.js";
import "../aide-taxonomie.js";
import "../aide-classement.js";
import "../aide-rayon.js";
import "../aide-contexte-ia.js";
import "../aide.js";
import { sourceApplicationSync } from "./source.mjs";

const TAXO = globalThis.AutourAideTaxonomie;
const C = globalThis.AutourAideClassement;
const R = globalThis.AutourAideRayon;
const IA = globalThis.AutourAideContexteIA;
const A = globalThis.AutourAide;
const html = sourceApplicationSync(import.meta.url);

/* ==========================================================================
   1. LE FAUX POSITIF QUI A DÉCLENCHÉ TOUT ÇA
   ======================================================================== */

const VIENNOISERIE = Object.freeze({
  id: "osmnode1", titre: "VIENNOISERIE ROYALE CROIX ROUGE",
  cat: "cafe", tags: { shop: "bakery", "addr:street": "rue de la Croix Rouge" },
  lat: 50.63, lng: 3.05,
});

test("une boulangerie nommée « Croix Rouge » n’entre dans aucune aide", () => {
  const v = C.capacites(VIENNOISERIE);
  assert.equal(v.aide, false, "aucune capacité d’aide ne doit être reconnue");
  Object.entries(v.capacites).forEach(([capacite, accorde]) =>
    assert.equal(accorde, false, capacite + " ne doit pas être accordée"));
});

test("elle est refusée pour ce qu’elle EST, pas faute de points", () => {
  /* Le refus porte un nom, et ce nom compte : « exclusion » veut dire que sa
     nature contredit le besoin. Un simple « sous le seuil » laisserait croire
     qu'un peu plus de signal suffirait. */
  const v = C.evaluer(VIENNOISERIE, "manger");
  assert.equal(v.accorde, false);
  assert.equal(v.refus, C.REFUS.EXCLUSION);
  assert.match(v.pourquoi, /commerce alimentaire/);
});

test("son adresse ne la sauve pas non plus", () => {
  /* « rue de la Croix Rouge » est dans les tags. Le nom ET l'adresse sont des
     textes : ni l'un ni l'autre ne prouve un service. */
  assert.equal(A.estSolution(VIENNOISERIE, ["manger"]), false);
  assert.equal(A.estSolution(VIENNOISERIE, ["securite"]), false);
  assert.equal(A.estSolution(VIENNOISERIE, ["autre"]), false);
});

test("elle reste un lieu d’Autour — seul Aide l’écarte", () => {
  /* Un lieu exclu d'Aide n'est pas supprimé : c'est une boulangerie, elle a sa
     place dans Explorer. Le classement d'Aide ne touche pas à `cat`. */
  const avant = JSON.stringify(VIENNOISERIE);
  C.capacites(VIENNOISERIE);
  assert.equal(JSON.stringify(VIENNOISERIE), avant, "aucun lieu n’est modifié");
  assert.equal(VIENNOISERIE.cat, "cafe", "sa catégorie de commerce est intacte");
});

test("les autres noms trompeurs tombent de la même façon", () => {
  const pieges = [
    [{ titre: "Sécurité Auto Lille", cat: "commerce", tags: { shop: "car_repair" } }, "securite"],
    [{ titre: "Restaurant du Secours", cat: "resto", tags: { amenity: "restaurant" } }, "manger"],
    [{ titre: "Hôtel de la Croix Rouge", cat: "commerce", tags: { tourism: "hotel" } }, "logement"],
    [{ titre: "Café Solidarité", cat: "cafe", tags: { amenity: "cafe" } }, "manger"],
    [{ titre: "Pharmacie du Secours Populaire", cat: "sante", tags: { amenity: "pharmacy" } }, "manger"],
  ];
  pieges.forEach(([lieu, besoin]) => {
    const v = C.evaluer(lieu, besoin);
    assert.equal(v.accorde, false, lieu.titre + " ne doit pas être une aide " + besoin);
  });
});

test("LA RÈGLE : un mot dans le nom, et rien d’autre, ne suffit jamais", () => {
  /* Le cas nu : le nom porte un réseau réel, et absolument aucune donnée
     structurelle. C'est le refus qui doit tomber, et il porte son propre nom
     pour qu'on puisse le compter. */
  const nu = { titre: "Banque alimentaire de quelque part" };
  const v = C.evaluer(nu, "manger");
  assert.equal(v.accorde, false);
  assert.equal(v.refus, C.REFUS.NOM_SEUL);
  assert.ok(v.preuves.length > 0, "le nom a bien été vu…");
  assert.ok(v.preuves.every((p) => C.NOMINALES.includes(p.genre)),
    "…mais aucune preuve non nominale ne l’accompagne");
});

test("aucun poids nominal ne peut atteindre le seuil à lui seul", () => {
  /* Une garantie chiffrée plutôt qu'une intention : même en cumulant tout ce
     que le nom peut rapporter, on reste sous la barre. */
  const nominal = C.POIDS.reseauNom + C.POIDS.motNom;
  assert.ok(nominal < C.SEUIL,
    "le nom rapporte au plus " + nominal + ", le seuil est à " + C.SEUIL);
  /* Corroboré, il pèse davantage — mais « corroboré » veut dire qu'une preuve
     structurelle existe déjà, donc que le nom n'est plus seul. */
  assert.ok(C.POIDS.reseauNomCorrobore < C.SEUIL,
    "même corroboré, le nom ne franchit pas le seuil tout seul");
});

/* ==========================================================================
   2. LES VRAIES STRUCTURES ENTRENT
   ======================================================================== */

test("un commissariat est une aide à la sécurité", () => {
  const cas = [
    { titre: "Commissariat de police", cat: "securite", tags: { amenity: "police", police: "national" } },
    { titre: "Police municipale", cat: "securite", tags: { amenity: "police", police: "municipal" } },
    { titre: "Brigade de gendarmerie", cat: "securite", tags: { amenity: "police", police: "gendarmerie" } },
    /* Sans nom exploitable : le tag suffit, et c'est tout l'intérêt. */
    { titre: "", cat: "securite", tags: { amenity: "police" } },
  ];
  cas.forEach((l) => {
    const v = C.evaluer(l, "securite");
    assert.equal(v.accorde, true, (l.titre || "(sans nom)") + " doit être retenu");
    assert.equal(v.certaine, true, "le tag `amenity=police` ne se discute pas");
  });
});

test("une structure d’aide aux victimes aussi, sans être un commissariat", () => {
  const assoc = { titre: "France Victimes 59", cat: "asso",
                  tags: { "social_facility:for": "abused" } };
  const v = C.capacites(assoc);
  assert.equal(v.capacites.safety_support, true);
  /* Et elle peut couvrir plusieurs besoins à la fois : c'est le point du
     modèle par capacités. */
  assert.equal(C.evaluer(assoc, "securite").accorde, true);
});

test("une banque alimentaire est une aide alimentaire", () => {
  const cas = [
    { titre: "Banque alimentaire du Nord", cat: "alimentaire", tags: { social_facility: "food_bank" } },
    { titre: "Restos du Cœur", cat: "alimentaire", tags: { amenity: "food_bank" } },
    { titre: "", cat: "alimentaire", tags: { social_facility: "soup_kitchen" } },
    /* Une épicerie solidaire tagguée AUSSI comme commerce : la preuve certaine
       l'emporte sur l'exclusion, sinon on perdrait les vraies. */
    { titre: "Épicerie solidaire", cat: "alimentaire",
      tags: { shop: "convenience", social_facility: "food_bank" } },
  ];
  cas.forEach((l) => assert.equal(C.evaluer(l, "manger").accorde, true,
    (l.titre || "(sans nom)") + " doit être une aide alimentaire"));
});

test("une Mission Locale couvre plusieurs besoins à la fois", () => {
  const ml = { titre: "Mission Locale de Lille", cat: "emploi",
               tags: { office: "employment_agency" } };
  const v = C.capacites(ml);
  assert.equal(v.capacites.financial_assistance, true, "Travail / argent");
  assert.equal(v.capacites.youth_support, true, "Jeunes / études");
  /* Papiers : POSSIBLE, et seulement si un service le dit. Sans donnée, on ne
     l'affirme pas — c'est la différence entre « peut » et « on suppose ». */
  assert.equal(v.capacites.administrative_help, false,
    "sans service déclaré, on n’affirme pas l’aide aux démarches");

  const avecService = Object.assign({}, ml, {
    services: ["administrative_assistance"] });
  assert.equal(C.capacites(avecService).capacites.administrative_help, true,
    "un service explicitement déclaré, lui, l’atteste");
});

test("une association pour victimes peut aussi héberger et écouter", () => {
  const assoc = { titre: "Solidarité Femmes", cat: "asso",
                  tags: { "social_facility:for": "abused",
                          social_facility: "emergency_shelter" } };
  const v = C.capacites(assoc);
  assert.equal(v.capacites.safety_support, true, "Sécurité");
  assert.equal(v.capacites.housing_assistance, true, "Logement");
});

test("un POI touristique ne devient pas une aide par sa catégorie ou son nom", () => {
  const pieges = [
    { titre: "Maison du Collectionneur", cat: "hebergement", source: "google_places",
      primaryType: "museum" },
    { titre: "Hôtel de la Gare", cat: "hebergement", source: "google_places",
      primaryType: "lodging" },
    { titre: "Monument aux héros", cat: "hebergement", type: "monument" },
    { titre: "Distribution du week-end", cat: "event", type: "event" },
  ];
  pieges.forEach((lieu) => assert.equal(A.estSolution(lieu, ["logement"]), false,
    lieu.titre + " ne doit pas franchir la frontière Aide"));
});

test("un fournisseur d’aide structuré est reconnu par ses catégories déclarées", () => {
  const chrs = { titre: "CHRS Lille", cat: "hebergement", is_aid_provider: true,
    aid_categories: ["housing_aid"] };
  assert.equal(A.estSolution(chrs, ["logement"]), true);
  assert.equal(A.estSolution(chrs, ["manger"]), false,
    "une catégorie logement ne doit pas répondre à Manger");
});

/* ==========================================================================
   3. MANGER N'EST PAS AIDE ALIMENTAIRE
   ======================================================================== */

test("un restaurant classique reste Explorer, jamais Aide", () => {
  const resto = { titre: "Le Bistrot du Coin", cat: "resto", tags: { amenity: "restaurant" } };
  assert.equal(C.evaluer(resto, "manger").accorde, false);
  assert.equal(C.capacites(resto).aide, false);
  assert.equal(resto.cat, "resto", "il reste un restaurant pour Explorer");
});

test("aucun commerce alimentaire n’entre dans Aide > Manger", () => {
  ["bakery", "supermarket", "convenience", "greengrocer", "butcher", "pastry"]
    .forEach((shop) => {
      const l = { titre: "Commerce " + shop, cat: "commerce", tags: { shop } };
      assert.equal(C.evaluer(l, "manger").accorde, false, shop + " ne doit pas passer");
    });
  ["restaurant", "fast_food", "cafe", "bar", "pub", "marketplace"]
    .forEach((amenity) => {
      const l = { titre: "Établissement " + amenity, cat: "resto", tags: { amenity } };
      assert.equal(C.evaluer(l, "manger").accorde, false, amenity + " ne doit pas passer");
    });
});

/* ==========================================================================
   4. L'ORDRE D'EXAMEN, VÉRIFIÉ DANS LA SOURCE
   ======================================================================== */

test("le nom est examiné en dernier, et pèse le moins", () => {
  const source = readFileSync(new URL("../aide-classement.js", import.meta.url), "utf8");
  const bloc = /function evaluer\(lieu, besoinId\) \{[\s\S]*?\n  \}/.exec(source)[0];
  const ordre = ["b.tags.forEach", "b.categories.forEach", "b.services.forEach",
                 "estInstitutionnel(lieu)", "descriptionDe(lieu)", "nomDe(lieu)"];
  let precedent = -1;
  ordre.forEach((marque) => {
    const i = bloc.indexOf(marque);
    assert.ok(i > precedent, marque + " doit venir après ce qui le précède");
    precedent = i;
  });
  /* Et le poids suit l'ordre : le nom sous tout le reste. */
  assert.ok(C.POIDS.motNom < C.POIDS.description);
  assert.ok(C.POIDS.description < C.POIDS.tagFort);
  assert.ok(C.POIDS.tagFort < C.POIDS.tagCertain);
  assert.ok(C.POIDS.tagCertain >= C.SEUIL, "une preuve certaine passe seule");
});

test("le nom et la description ne sont jamais mélangés", () => {
  /* C'est la faute d'origine : `texteLieu()` concaténait le titre et la
     description, et le nom héritait du pouvoir d'une donnée. */
  const source = readFileSync(new URL("../aide-classement.js", import.meta.url), "utf8");
  const bloc = /const descriptionDe = \(lieu\) => \{[\s\S]*?\n  \};/.exec(source)[0];
  assert.doesNotMatch(bloc, /titre|title|\bname\b/,
    "la description ne doit contenir aucune trace du nom");
});

/* ==========================================================================
   5. LE RAYON PROGRESSIF
   ======================================================================== */

test("on cherche près, puis plus loin, et jamais au hasard", () => {
  assert.deepEqual(R.PALIERS, [3000, 5000, 10000, 20000]);
  assert.equal(R.premier(), 3000);
  assert.equal(R.palierSuivant(3000), 5000);
  assert.equal(R.palierSuivant(20000), null, "au-delà, ce n’est plus « autour de toi »");
});

test("assez de résultats fiables arrête la recherche", () => {
  const trois = [{}, {}, {}];
  assert.equal(R.evaluer(trois, 3000).elargir, false, "trois suffisent, on s’arrête");
  assert.equal(R.evaluer([{}], 3000).elargir, true, "un seul, on élargit");
  assert.equal(R.evaluer([], 20000).elargir, false, "au dernier palier, on ne peut plus");
});

test("on n’élargit jamais pour remplir : deux fiables valent mieux que dix douteux", () => {
  /* `evaluer` ne compte que des résultats DÉJÀ retenus par le classement. Le
     seuil est bas — trois — précisément pour ne pas aller chercher loin ce
     qu'on a près. */
  assert.ok(R.SUFFISANT <= 3, "le seuil d’arrêt reste bas : " + R.SUFFISANT);
});

test("quand le rayon s’élargit, l’écran peut le dire", () => {
  const loin = [{ rankDistance: 7400 }, { rankDistance: 2100 }];
  const a = R.annonce(loin, 10000);
  assert.equal(a.elargi, true);
  assert.equal(a.texte,
    "Aucun résultat très proche. Voici les aides disponibles à moins de 8 km.");
  /* La distance annoncée est celle des résultats RÉELS, pas du palier
     interrogé : annoncer « moins de 10 km » serait exact et inutile. */
  assert.match(a.texte, /8 km/);
  assert.equal(R.annonce(loin, 3000), null, "au premier palier, rien à annoncer");
  assert.equal(R.annonce([], 10000), null, "sans résultat, rien à annoncer non plus");
});

/* ==========================================================================
   6. CE QUE LE MODÈLE REÇOIT, ET CE QU'IL N'A PAS LE DROIT DE RENDRE
   ======================================================================== */

const CTX = IA.contexte({
  userLat: 50.6292, userLng: 3.0573, selectedCity: "Lille",
  currentRadius: 3000, requestedHelpCategory: "securite",
  userFreeText: "mon copain me frappe",
  candidatePlaces: [
    { id: "a", titre: "Commissariat central", cat: "securite", lat: 50.63, lng: 3.06,
      rankDistance: 420, tags: { amenity: "police" } },
  ],
});

test("le modèle reçoit le contexte géographique, pas seulement une question", () => {
  ["userLat", "userLng", "selectedCity", "currentRadius", "requestedHelpCategory",
   "userFreeText", "candidatePlaces"].forEach((cle) =>
    assert.ok(cle in CTX, cle + " doit être transmis"));
  assert.equal(CTX.currentRadius, 3000, "il doit savoir dans quel rayon Autour cherche");
  assert.equal(CTX.candidatePlaces.length, 1, "et sur quels candidats réels il travaille");
  assert.equal(CTX.candidatePlaces[0].osm.amenity, "police",
    "avec les tags qui ont servi à décider");
});

test("le modèle ne peut pas inventer un lieu", () => {
  const v = IA.valider({
    primaryNeed: "securite",
    rankedPlaceIds: ["a", "STRUCTURE-QUI-N-EXISTE-PAS"],
  }, CTX);
  assert.deepEqual([...v.rankedPlaceIds], ["a"], "l’invention est jetée");
  assert.equal(v.aInvente, true, "et elle est comptée");
  assert.equal(v.rejets[0].motif, IA.MOTIFS.LIEU_INVENTE);
});

test("le modèle ne peut pas inventer une catégorie", () => {
  const v = IA.valider({ primaryNeed: "licorne", secondaryNeeds: ["parler", "dragon"] }, CTX);
  assert.equal(v.primaryNeed, null);
  assert.deepEqual([...v.secondaryNeeds], ["parler"]);
});

test("le modèle peut rendre plusieurs intentions", () => {
  const v = IA.valider({ primaryNeed: "securite",
                         secondaryNeeds: ["parler", "logement"] }, CTX);
  assert.equal(v.primaryNeed, "securite");
  assert.deepEqual([...v.secondaryNeeds], ["parler", "logement"]);
});

test("une explication ne vaut que pour un lieu réel", () => {
  const v = IA.valider({ explanations: { a: "Accueille les victimes.", zzz: "inventé" } }, CTX);
  assert.equal(v.explanations.a, "Accueille les victimes.");
  assert.equal(v.explanations.zzz, undefined);
});

test("un modèle qui oublie la moitié de la liste ne la fait pas disparaître", () => {
  const reels = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const ctx = Object.assign({}, CTX, { allowedPlaceIds: ["a", "b", "c"] });
  const v = IA.valider({ rankedPlaceIds: ["c"] }, ctx);
  const ordonne = IA.appliquer(reels, v);
  assert.equal(ordonne[0].id, "c", "son ordre est respecté…");
  assert.equal(ordonne.length, 3, "…et le reste n’est pas perdu");
});

test("les règles voyagent avec le contexte, pas cachées dans une invite", () => {
  assert.ok(CTX.rules.some((r) => /inventer/i.test(r)));
  assert.ok(CTX.allowedPlaceIds.includes("a"));
  assert.ok(CTX.allowedCategories.includes("securite"));
});

test("aucun nouvel appel au modèle n’est créé", () => {
  /* Autour en a déjà un — `enrichir-lieu`, avec son budget réservé. Ce module
     prépare et vérifie ; il n’appelle rien. */
  const source = readFileSync(new URL("../aide-contexte-ia.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|generativelanguage/);
});

/* ==========================================================================
   7. LE CÂBLAGE
   ======================================================================== */

test("la taxonomie fait demander les tags à OpenStreetMap", () => {
  /* La cause exacte du « Sécurité ne rend rien » : `amenity=police` n’était
     demandé nulle part. Une taxonomie qui décrit un tag que personne ne
     réclame ne sert à rien. */
  const police = TAXO.tagsARecolter()
    .find((t) => t.cle === "amenity").valeurs.includes("police");
  assert.equal(police, true, "la taxonomie doit réclamer `amenity=police`");
  assert.match(html, /\["amenity","police","securite"\]/,
    "et la requête Overpass du navigateur doit le demander");
  const zones = readFileSync(new URL("../outils/zones.mjs", import.meta.url), "utf8");
  assert.match(zones, /police/, "l’outil de pré-calcul des zones aussi");
});

test("« securite » est une catégorie de lieu à part entière", () => {
  assert.ok(TAXO.CATEGORIES_REQUISES.includes("securite"));
  assert.match(html, /securite:\s*\{label:"Sécurité & protection"/);
  assert.match(html, /const CATS_AIDE = \[[^\]]*"securite"/);
});

test("`aide.js` délègue au classement au lieu de lire des noms", () => {
  const source = readFileSync(new URL("../aide.js", import.meta.url), "utf8");
  const bloc = /function pertinence\(lieu, besoinId\) \{[\s\S]*?\n  \}/.exec(source)[0];
  assert.match(bloc, /CLASSEMENT\.repond\(lieu, besoinId\)/);
  assert.doesNotMatch(bloc, /b\.reseaux\.some/,
    "plus aucune décision ne se prend sur une expression testée contre un texte");
  assert.doesNotMatch(bloc, /b\.mots\.some/,
    "et plus aucune sur un mot du besoin trouvé dans le nom");
});

test("le rayon progressif est branché sur la vraie recherche", () => {
  assert.match(html, /RAYON_AIDE\.evaluer\(retenus, palier\)/);
  assert.match(html, /const retenus = lieux\.filter\(estSolutionAideLiee\)/,
    "on compte ce que l’écran retiendrait, pas ce qu’Overpass a ramené");
  assert.match(html, /data-testid="aide-rayon-elargi"/,
    "et l’écran peut dire que les résultats sont plus loin");
});

/* ==========================================================================
   8. LE TEXTE LIBRE — UNE PHRASE, PLUSIEURS INTENTIONS
   ======================================================================== */

test("les cinq phrases de référence donnent le bon besoin principal", () => {
  const cas = [
    ["je n’ai rien à manger", "manger"],
    ["je dors dehors", "logement"],
    ["mon copain me frappe", "securite"],
    ["j’ai 19 ans et je trouve pas de travail", "travail"],
    ["j’ai besoin de refaire mes papiers", "papiers"],
  ];
  cas.forEach(([phrase, attendu]) =>
    assert.equal(A.intentions(phrase).primaryNeed, attendu, phrase));
});

test("une phrase qui demande plusieurs choses les obtient toutes", () => {
  const dehors = A.intentions("je dors dehors");
  assert.equal(dehors.primaryNeed, "logement");
  assert.ok(dehors.secondaryNeeds.includes("securite"), "dormir dehors, c’est aussi un risque");
  assert.ok(dehors.secondaryNeeds.includes("parler"));

  const violences = A.intentions("mon copain me frappe");
  assert.equal(violences.primaryNeed, "securite");
  assert.ok(violences.secondaryNeeds.includes("parler"));
  assert.ok(violences.secondaryNeeds.includes("logement"), "partir demande où aller");

  const jeune = A.intentions("j’ai 19 ans et je trouve pas de travail");
  assert.equal(jeune.primaryNeed, "travail");
  assert.ok(jeune.besoinsExprimes.includes("jeunes"), "l’âge est dans la phrase");
  assert.ok(!jeune.secondaryNeeds.includes("jeunes"),
    "un besoin exprimé ne doit pas devenir une suggestion taxonomique");
});

test("la forme rendue est celle que le modèle rendrait", () => {
  /* Le mode répond pareil avec ou sans lui : quand le modèle arrivera, il
     complètera cette réponse au lieu de la remplacer. */
  const v = A.intentions("mon copain me frappe");
  assert.ok("primaryNeed" in v && "secondaryNeeds" in v);
  assert.ok(Array.isArray(v.secondaryNeeds));
  assert.ok(v.secondaryNeeds.length <= A.MAX_SECONDAIRES);
});

test("un besoin secondaire élargit la recherche sans la détourner", () => {
  assert.match(html, /const POIDS_BESOIN_SECONDAIRE = \.6;/);
  assert.match(html, /besoinsSecondairesAide\.indexOf\(id\) >= 0/,
    "le poids d’un besoin non nommé est réduit au classement");
  assert.match(html, /besoinsAide = dits\.concat\(secondaires\);/,
    "mais il entre bien dans la recherche");
  assert.match(html, /const besoins = phraseAideCourante\s+\? besoinsExprimesAide/,
    "Compris n’affiche que les besoins exprimés");
  assert.match(html, /Number\(b\.exprime\) - Number\(a\.exprime\)/,
    "les résultats exprimés restent devant les suggestions");
});

test("« manger » dans Aide ne renvoie pas ce que « manger » renvoie dans Explorer", () => {
  /* La distinction essentielle, vérifiée bout en bout : la même phrase, deux
     lieux, deux verdicts opposés. */
  const boulangerie = { titre: "Boulangerie du coin", cat: "cafe", tags: { shop: "bakery" } };
  const distribution = { titre: "Distribution alimentaire", cat: "alimentaire",
                         tags: { social_facility: "food_bank" } };
  assert.equal(A.intentions("je n’ai rien à manger").primaryNeed, "manger");
  assert.equal(A.estSolution(boulangerie, ["manger"]), false,
    "une boulangerie n’est pas une aide alimentaire");
  assert.equal(A.estSolution(distribution, ["manger"]), true);
});

/* ===================================================================
   CE QUE LE TERRAIN DE TOURCOING A APPRIS

   Les cas ci-dessous ne sont pas inventés : ce sont des objets
   OpenStreetMap réellement présents autour de Tourcoing, avec leurs tags
   tels qu'ils sont cartographiés, et qui étaient mal classés.
   =================================================================== */

test("une catégorie déduite des tags ne compte pas une seconde fois", () => {
  /* « Point information jeunesse », rue de Tourcoing. Trois indices faibles
     — dont deux disent la même chose et le troisième en découle — le
     franchissaient le seuil de l’AIDE ALIMENTAIRE. Rien, dans ces données,
     ne parle de nourriture. */
  const pij = { titre: "Point information jeunesse", cat: "asso",
                tags: { amenity: "social_facility", social_facility: "outreach",
                        "social_facility:for": "juvenile" } };
  const v = C.evaluer(pij, "manger");
  assert.equal(v.accorde, false,
    "un point information jeunesse n’est pas une distribution alimentaire");
  assert.equal(v.refus, C.REFUS.SOUS_SEUIL);

  const echo = v.preuves.find((p) => p.genre === "categorie");
  assert.ok(echo, "la catégorie reste consignée…");
  assert.equal(echo.poids, 0, "…mais à zéro, parce qu’elle sort des tags déjà comptés");
});

test("sans tags, la catégorie reste une preuve à part entière", () => {
  /* Un lieu venu de Google ou d’une publication n’a pas de tags OSM : sa
     catégorie n’est l’écho de rien, et c’est la seule chose qu’on sache. */
  const sansTags = { titre: "Distribution du mardi", cat: "alimentaire" };
  const v = C.evaluer(sansTags, "manger");
  assert.equal(v.accorde, true);
  assert.ok(v.preuves.some((p) => p.genre === "categorie" && p.poids > 0));
});

test("une PMI relève de la famille, pas de « jeunes et études »", () => {
  /* PMI de Wattrelos, DITEP de Tourcoing : `social_facility:for=child` désigne
     le petit enfant et ses parents. Quelqu’un de 19 ans qui cherche du travail
     n’a rien à y faire. */
  const pmi = { titre: "PMI", cat: "asso",
                tags: { amenity: "social_facility", social_facility: "ambulatory_care",
                        "social_facility:for": "child" } };
  assert.equal(C.evaluer(pmi, "jeunes").accorde, false);
  assert.equal(C.evaluer(pmi, "famille").accorde, true);
});

test("une maison des jeunes est bien une structure jeunesse", () => {
  /* MJC La Fabrique, Tourcoing : équipement social qui déclare s’adresser aux
     jeunes. Les deux tags ensemble suffisent ; aucun n’y arrive seul. */
  const mjc = { titre: "Maison des Jeunes et de la Culture - Centre social La Fabrique",
                cat: "asso",
                tags: { amenity: "social_facility", "social_facility:for": "juvenile" } };
  assert.equal(C.evaluer(mjc, "jeunes").accorde, true);
});

test("le nom d’un réseau ne classe toujours rien à lui seul", () => {
  /* Le garde-fou après le relèvement de `reseauNomCorrobore` : ce qui interdit
     à un nom de classer n’est pas son barème, c’est l’absence de preuve
     structurelle. */
  assert.ok(C.POIDS.reseauNomCorrobore > C.POIDS.reseauNom);
  const seulLeNom = { titre: "Mission Locale", cat: null, tags: {} };
  const v = C.evaluer(seulLeNom, "jeunes");
  assert.equal(v.accorde, false);
  assert.equal(v.refus, C.REFUS.NOM_SEUL);
  assert.ok(C.POIDS.reseauNomCorrobore < C.SEUIL,
    "un nom corroboré ne peut jamais franchir le seuil à lui seul");
});

/* ==========================================================================
   LE MODÈLE, BRANCHÉ SUR L'APPEL QUI EXISTE DÉJÀ

   Le contexte était préparé mais personne ne l'appelait. Ces tests fixent le
   branchement : un seul appel de modèle dans Autour, et un garde-fou qui tient
   des deux côtés.
   ======================================================================== */

test("Aide passe par `enrichir-lieu`, pas par une seconde route", () => {
  assert.match(html, /body:JSON\.stringify\(\{mode:"aide", contexte\}\)/,
    "le mode voyage dans le corps de l’appel existant");
  /* La seule route de modèle du client, et elle est unique. */
  const routes = [...html.matchAll(/functions\/v1\/([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(routes)], ["enrichir-lieu"],
    "aucune seconde fonction Edge n’est appelée : " + routes.join(", "));
});

test("le modèle reçoit les neuf champs demandés, et rien de plus", () => {
  const attendus = ["userLat", "userLng", "selectedCity", "currentRadius",
    "requestedHelpCategory", "userFreeText", "candidatePlaces",
    "allowedPlaceIds", "allowedCategories"];
  const ctx = IA.contexte({
    userLat: 50.72, userLng: 3.16, selectedCity: "Tourcoing", currentRadius: 5000,
    requestedHelpCategory: "manger", userFreeText: "j’ai rien à manger",
    candidatePlaces: [{ id: "a", titre: "Croix-Rouge", cat: "alimentaire",
                        lat: 50.73, lng: 3.17, tags: { social_facility: "food_bank" } }],
  });
  attendus.forEach((k) => assert.ok(k in ctx, k + " doit être transmis"));
  assert.ok(Array.isArray(ctx.rules) && ctx.rules.length,
    "les règles anti-invention voyagent avec le contexte");
  /* Ce qui ne part JAMAIS : rien qui identifie qui regarde. */
  const json = JSON.stringify(ctx);
  ["userId", "session", "token", "email", "deviceId"].forEach((interdit) =>
    assert.ok(!json.includes(interdit), interdit + " ne doit pas être transmis"));
});

test("un lieu que le modèle n’a pas reçu ne peut pas sortir de lui", () => {
  const ctx = IA.contexte({
    userLat: 50.72, userLng: 3.16, currentRadius: 3000,
    candidatePlaces: [{ id: "reel", titre: "CCAS", cat: "asso", lat: 50.72, lng: 3.16 }],
  });
  const v = IA.valider({
    primaryNeed: "manger",
    rankedPlaceIds: ["reel", "structure-inventee"],
    explanations: { "reel": "ok", "autre-invention": "sert des repas tous les soirs" },
  }, ctx);
  assert.deepEqual([...v.rankedPlaceIds], ["reel"]);
  assert.deepEqual(Object.keys(v.explanations), ["reel"]);
  assert.equal(v.aInvente, true, "l’écart est compté, pas seulement corrigé");
});

test("un ordre qui arrive en retard ne s’applique pas à une autre liste", () => {
  /* La clé voyage avec le verdict : c’est ce qui empêche un classement calculé
     pour une position ou une phrase d’appliquer son ordre à la suivante. */
  assert.match(html, /ordreModeleAide = Object\.assign\(\{cle\}, valide\)/);
  assert.match(html, /ordreModeleAide\.cle === cleOrdreAide\(ordonnes\)/);
});

test("une panne du modèle laisse l’écran tel qu’il est", () => {
  /* Aucun `throw`, aucun écran vide : le classement d’Autour est déjà posé et
     reste la réponse par défaut. */
  assert.match(html, /return ordonnes\.slice\(0, limite \|\| 5\);/,
    "sans réponse du modèle, c’est l’ordre d’Autour qui sort");
  assert.match(html, /const ordonnes = notes\.map\(/,
    "et il est calculé avant, pas à la place");
});

test("la phrase privée ne survit pas à l’écran", () => {
  assert.match(html, /function oublierPhraseAide\(\)/);
  assert.match(html, /phraseAideCourante = null;/);
  /* Elle n’est écrite nulle part : ni stockage local, ni métrique, ni journal. */
  assert.ok(!/localStorage\.[a-zA-Z]+\([^)]*phraseAide/.test(html));
  assert.ok(!/compterTerritorial\([^)]*phraseAide/.test(html));
  assert.ok(!/journal\.(info|warn|error)\([^)]*phraseAideCourante/.test(html));
});
