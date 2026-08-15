import test from "node:test";
import assert from "node:assert/strict";
import "../intentions.js";

const I = globalThis.AutourIntentions;

/* ==========================================================================
   Les 60 phrases de référence

   Colonnes : la phrase telle qu'on l'écrit vraiment, l'intention attendue,
   et le monde vers lequel Autour doit basculer.

   `monde` vaut "aide", "explorer", "urgence" ou "question" — c'est la seule
   chose que l'utilisateur perçoit. L'intention, elle, sert au diagnostic.
   ======================================================================== */
const CAS = [
  /* ---- Manger : le mot est le même, l'intention non ---------------- 1-8 */
  ["où manger ?",                            "explore_place",   "explorer"],
  ["je veux manger une pizza",               "explore_place",   "explorer"],
  ["je cherche un resto pas cher",           "explore_place",   "explorer"],
  ["un bon kebab près de moi",               "explore_place",   "explorer"],
  ["je n'ai rien à manger",                  "food_need",       "aide"],
  ["j'ai faim et pas d'argent",              "food_need",       "aide"],
  ["g faim",                                 "food_need",       "aide"],
  ["distribution alimentaire gratuite",      "food_need",       "aide"],

  /* ---- Logement : hôtel ou rue ------------------------------------ 9-15 */
  ["je cherche un hôtel",                    "explore_place",   "explorer"],
  ["je cherche un logement pour mes vacances", "explore_place", "explorer"],
  ["je dors dehors",                         "housing_need",    "aide"],
  ["je dors dehor",                          "housing_need",    "aide"],
  ["je vais dormir dehors ce soir",          "housing_need",    "aide"],
  ["besoin dun appart je peux plus payer",   "housing_need",    "aide"],
  ["je suis à la rue",                       "housing_need",    "aide"],

  /* ---- Travail et argent ----------------------------------------- 16-21 */
  ["je cherche du travail",                  "work_need",       "aide"],
  ["besoin taf",                             "work_need",       "aide"],
  ["j'ai plus d'argent",                     "work_need",       "aide"],
  ["besoin d'un boulot",                     "work_need",       "aide"],
  ["je suis au chômage sans ressources",     "work_need",       "aide"],
  ["j'ai des dettes je peux plus payer",     "work_need",       "aide"],

  /* ---- Papiers et démarches -------------------------------------- 22-27 */
  ["jai perdu mes papiers",                  "admin_need",      "aide"],
  ["j'ai besoin d'aide pour ma CAF",         "admin_need",      "aide"],
  ["je comprends pas mes papiers",           "admin_need",      "aide"],
  ["titre de séjour",                        "admin_need",      "aide"],
  ["besoin d'aide pour un dossier",          "admin_need",      "aide"],
  ["ma carte vitale est perdue",             "admin_need",      "aide"],

  /* ---- Santé : chercher un lieu vs manquer de soins -------------- 28-34 */
  ["je cherche une pharmacie",               "explore_place",   "explorer"],
  ["cherche médecin",                        "explore_place",   "explorer"],
  ["où est le dentiste le plus proche",      "explore_place",   "explorer"],
  ["je suis malade et j'ai pas de mutuelle", "health_need",     "aide"],
  ["je peux pas payer mes soins",            "health_need",     "aide"],
  ["j'ai besoin d'un psy gratuit",           "health_need",     "aide"],
  ["sans sécurité sociale pour me soigner",  "health_need",     "aide"],

  /* ---- Jeunes et études ------------------------------------------ 35-38 */
  ["je suis étudiant sans ressources",       "study_need",      "aide"],
  ["besoin d'aide pour mon orientation",     "study_need",      "aide"],
  ["je cherche une alternance",              "study_need",      "aide"],
  ["j'ai besoin d'une bourse",               "study_need",      "aide"],

  /* ---- Parler à quelqu'un ---------------------------------------- 39-42 */
  ["j'ai besoin de parler",                  "social_support",  "aide"],
  ["je me sens seul",                        "social_support",  "aide"],
  ["besoin d'écoute",                        "social_support",  "aide"],
  ["je suis isolé et déprimé",               "social_support",  "aide"],

  /* ---- Famille --------------------------------------------------- 43-45 */
  ["besoin d'aide pour la garde de mes enfants", "family_need", "aide"],
  ["je suis enceinte et sans ressources",    "family_need",     "aide"],
  ["aide à la parentalité",                  "family_need",     "aide"],

  /* ---- Sécurité et urgence --------------------------------------- 46-51 */
  ["quelqu'un me poursuit",                  "urgent_emergency", "urgence"],
  ["quelqu'un me suit",                      "urgent_emergency", "urgence"],
  ["je subis des violences conjugales",      "urgent_emergency", "urgence"],
  ["je suis en danger",                      "urgent_emergency", "urgence"],
  ["j'ai été agressé",                       "urgent_emergency", "urgence"],
  ["j'ai peur de rentrer chez moi",          "safety_need",      "aide"],

  /* ---- Réparations et services : ni Aide, ni découverte ---------- 52-58 */
  ["mon vélo est crevé",                     "mobility_problem", "explorer"],
  ["velo crevé",                             "mobility_problem", "explorer"],
  ["mon vélo est cassé",                     "mobility_problem", "explorer"],
  ["où réparer mon téléphone",               "mobility_problem", "explorer"],
  ["mon ordinateur est cassé",               "mobility_problem", "explorer"],
  ["ma machine à laver est en panne",        "mobility_problem", "explorer"],
  ["je cherche un coiffeur",                 "local_service",    "explorer"],

  /* ---- Les pièges ------------------------------------------------ 59-62 */
  ["je suis cassé",                          "unknown",          "question"],
  ["je n'ai plus rien à manger et mon vélo est cassé", "food_need", "aide"],
  ["azerty qwerty",                          "unknown",          "question"],
  ["",                                       "unknown",          "question"],
];

test("les 60 phrases de référence sont comprises", () => {
  const echecs = [];
  for (const [phrase, intentAttendu, mondeAttendu] of CAS) {
    const r = I.router(phrase);
    const monde = I.mondeDe(r);
    if (r.intent !== intentAttendu || monde !== mondeAttendu) {
      echecs.push(`« ${phrase} » → ${r.intent}/${monde} ` +
        `(attendu ${intentAttendu}/${mondeAttendu}, conf ${r.confidence}) — ${r.reason}`);
    }
  }
  assert.deepEqual(echecs, [], "\n" + echecs.join("\n"));
});

test("chaque phrase rend le contrat complet", () => {
  for (const [phrase] of CAS) {
    const r = I.router(phrase);
    assert.ok(I.INTENTS.includes(r.intent), phrase + " : intent hors liste");
    assert.equal(typeof r.confidence, "number");
    assert.ok(r.confidence >= 0 && r.confidence <= 1, phrase + " : confiance hors bornes");
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0, phrase + " : reason vide");
    assert.equal(typeof r.is_urgent, "boolean");
    assert.ok(Array.isArray(r.suggestions));
    assert.ok(r.suggestions.length <= 3, phrase + " : plus de trois interprétations");
  }
});

/* ==========================================================================
   Ce qui distingue vraiment les deux mondes
   ======================================================================== */

test("le contexte l'emporte sur le mot-clé", () => {
  // le mot « manger » est dans les deux, l'intention non
  assert.equal(I.mondeDe(I.router("où manger ?")), "explorer");
  assert.equal(I.mondeDe(I.router("je n'ai rien à manger")), "aide");
  // idem pour « logement »
  assert.equal(I.mondeDe(I.router("je cherche un logement pour mes vacances")), "explorer");
  assert.equal(I.mondeDe(I.router("je vais dormir dehors ce soir")), "aide");
});

test("dans le doute, la détresse l'emporte sur la découverte", () => {
  // se tromper vers l'aide coûte une lecture ; se tromper dans l'autre sens
  // envoie quelqu'un qui a faim vers une carte de restaurants
  const r = I.router("je n'ai plus rien à manger et mon vélo est cassé");
  assert.equal(r.intent, "food_need");
  assert.equal(I.mondeDe(r), "aide");
});

test("l'urgence passe avant tout et lève is_urgent", () => {
  for (const p of ["quelqu'un me poursuit", "je suis en danger", "au secours"]) {
    const r = I.router(p);
    assert.equal(r.intent, "urgent_emergency", p);
    assert.equal(r.is_urgent, true, p);
    assert.ok(r.confidence > 0.9, p);
  }
});

test("un dormeur dehors ce soir est marqué urgent", () => {
  assert.equal(I.router("je vais dormir dehors ce soir").is_urgent, true);
});

test("une réparation exige un objet ET une panne", () => {
  assert.equal(I.router("mon vélo est cassé").intent, "mobility_problem");
  // « cassé » sans objet parle d'une personne
  assert.equal(I.router("je suis cassé").intent, "unknown");
  // un objet sans panne ne conclut à rien
  assert.notEqual(I.router("j'ai vendu mon vélo").intent, "mobility_problem");
});

test("une réparation rend la recherche à préremplir", () => {
  const r = I.router("mon vélo est crevé");
  assert.match(r.requete, /vélo/i);
  assert.ok(r.libelle && r.libelle.length > 3);
});

/* ==========================================================================
   Normalisation : les fautes ne doivent jamais bloquer
   ======================================================================== */

test("les formulations imparfaites restent comprises", () => {
  const paires = [
    ["g faim", "food_need"],
    ["besoin taf", "work_need"],
    ["ou manger", "explore_place"],
    ["jai perdu mes papiers", "admin_need"],
    ["besoin dun appart je peux plus payer", "housing_need"],
    ["velo crevé", "mobility_problem"],
    ["cherche médecin", "explore_place"],
    ["je dors dehor", "housing_need"],
  ];
  for (const [phrase, attendu] of paires) {
    assert.equal(I.router(phrase).intent, attendu, `« ${phrase} »`);
  }
});

test("la normalisation absorbe casse, accents, apostrophes et espaces", () => {
  const formes = ["Je Dors DEHORS", "je dors dehors", "  je   dors  dehors  ",
                  "j’ai faim", "j'ai faim", "J’AI FAIM"];
  for (const f of formes) {
    const n = I.normaliser(f);
    assert.ok(!/[A-ZÀ-ÿ’']/.test(n), f + " → « " + n + " » mal normalisé");
    assert.ok(!/\s{2,}/.test(n), f + " : espaces multiples");
  }
});

test("la normalisation ne sert qu'à comprendre, jamais à réécrire", () => {
  // le routeur ne rend aucun texte corrigé destiné à l'affichage
  const r = I.router("g faim");
  assert.equal(r.texteCorrige, undefined);
  assert.equal(r.phrase, undefined);
});

/* ==========================================================================
   Confiance et interprétations
   ======================================================================== */

test("une phrase incomprise ne fait pas semblant", () => {
  const r = I.router("azerty qwerty");
  assert.equal(r.intent, "unknown");
  assert.ok(r.confidence < I.SEUIL_CONFIANCE);
  assert.equal(I.mondeDe(r), "question");
});

test("une confiance faible propose au plus trois lectures", () => {
  const r = I.router("azerty qwerty");
  assert.ok(r.suggestions.length >= 2 && r.suggestions.length <= 3);
  for (const s of r.suggestions) {
    assert.ok(s.icone && s.label, "chaque proposition porte une icône ET un mot");
  }
});

test("`reason` existe pour le diagnostic mais n'est pas un texte d'interface", () => {
  const r = I.router("je dors dehors");
  assert.ok(r.reason.length > 10);
  // aucune trace de jargon destiné à l'écran
  for (const [phrase] of CAS) {
    const x = I.router(phrase);
    assert.doesNotMatch(x.reason, /score de confiance|catégorisé|intention détectée/i);
  }
});

/* ==========================================================================
   Les icônes : une source unique, universelle
   ======================================================================== */

test("chaque catégorie a une icône et un mot", () => {
  for (const [id, c] of Object.entries(I.CATEGORIES)) {
    assert.ok(c.icone && c.icone.length > 0, id + " doit avoir une icône");
    assert.ok(c.label && c.label.length > 1, id + " doit avoir un libellé lisible");
    assert.ok(["aide", "explorer"].includes(c.monde), id + " doit appartenir à un monde");
  }
});

test("les icônes attendues sont exactement celles demandées", () => {
  const attendu = {
    manger: "🍽️", logement: "🏠", travail: "💼", papiers: "📄", sante: "🩺",
    jeunes: "🎓", parler: "💬", securite: "🛡️", urgence: "🚨", aide: "🤝",
    sport: "⚽", sortir: "🎉", chiller: "☕", bouger: "🚲",
    lieu: "📍", recherche: "🔍",
  };
  for (const [id, icone] of Object.entries(attendu)) {
    assert.equal(I.icone(id), icone, id + " doit porter " + icone);
  }
});

test("sécurité est un bouclier, jamais un objet ambigu", () => {
  const s = I.icone("securite");
  assert.equal(s, "🛡️");
  // et le sélecteur de variante est bien là : sans lui, le rendu dépend de la
  // plateforme et le bouclier peut devenir un glyphe méconnaissable
  assert.ok(s.includes("️"), "le sélecteur de variante U+FE0F est obligatoire");
  // rien qui évoque un sac, un achat ou un objet sans rapport
  for (const interdit of ["👜", "🛍️", "🎒", "💼"]) {
    assert.notEqual(s, interdit);
  }
});

test("les icônes pictographiques portent toutes leur sélecteur de variante", () => {
  for (const icone of I.ICONES_A_VARIANTE) {
    assert.ok(icone.includes("️"), icone + " doit porter U+FE0F");
  }
  /* Et aucune icône déclarée ne doit être un pictogramme nu. La règle n'est
     pas « tel intervalle de points de code » — c'est Unicode qui la donne :
     un caractère Emoji dont la présentation par défaut n'est PAS emoji
     (Emoji_Presentation = false) se dessine en glyphe texte tant qu'on ne lui
     ajoute pas U+FE0F. ⚽ et ☕ sont déjà emoji par défaut ; 🛡 et 🍽 ne le
     sont pas, et c'est très exactement ce qui rendait le bouclier illisible. */
  const nus = Object.entries(I.CATEGORIES)
    .filter(([, c]) => {
      const premier = [...c.icone][0];
      return /\p{Emoji}/u.test(premier) && !/\p{Emoji_Presentation}/u.test(premier) &&
        !c.icone.includes("️");
    })
    .map(([id]) => id);
  assert.deepEqual(nus, [], "icônes pictographiques sans U+FE0F : " + nus.join(", "));

  // et la liste documentée doit être exactement celle qu'Unicode impose
  const imposees = Object.values(I.CATEGORIES)
    .filter((c) => {
      const premier = [...c.icone][0];
      return /\p{Emoji}/u.test(premier) && !/\p{Emoji_Presentation}/u.test(premier);
    })
    .map((c) => c.icone);
  assert.deepEqual([...I.ICONES_A_VARIANTE].sort(), [...new Set(imposees)].sort(),
    "ICONES_A_VARIANTE doit lister exactement les icônes qui exigent U+FE0F");
});

test("une même fonction n'a qu'une seule icône", () => {
  const parIcone = new Map();
  for (const [id, c] of Object.entries(I.CATEGORIES)) {
    if (!parIcone.has(c.icone)) parIcone.set(c.icone, []);
    parIcone.get(c.icone).push(id);
  }
  const doublons = [...parIcone.entries()].filter(([, ids]) => ids.length > 1);
  assert.deepEqual(doublons, [],
    "deux fonctions partagent une icône : " + JSON.stringify(doublons));
});

test("le vocabulaire reste celui du quotidien", () => {
  const labels = Object.values(I.CATEGORIES).map((c) => c.label.toLowerCase()).join(" ");
  for (const jargon of ["accompagnement", "dispositif", "insertion", "usager",
                        "bénéficiaire", "prescripteur", "référent"]) {
    assert.ok(!labels.includes(jargon), jargon + " est un mot d'administration");
  }
});

/* ==========================================================================
   Une seule table d'icônes pour toute l'application

   Ces tests lisent les sources plutôt que le DOM : l'application n'a pas de
   point d'entrée importable, et c'est la convention du dépôt. Ce qu'ils
   vérifient est simple — la grille d'Aide et la carte doivent afficher le
   MÊME symbole pour la MÊME fonction. Deux tables d'emojis finissent
   toujours par diverger, et l'utilisateur voit alors deux dessins pour une
   même chose sans comprendre pourquoi.
   ======================================================================== */
import { readFile } from "node:fs/promises";
import { sourceApplication } from "./source.mjs";

/* Voir tests/source.mjs : le corps du programme a quitté `index.html` pour
   `app.js` sans que le contrat lu ici ne change. */
const lire = (f) => f === "index.html"
  ? sourceApplication(import.meta.url)
  : readFile(new URL("../" + f, import.meta.url), "utf8");

/* La grille d'Aide et la source de vérité doivent coïncider, catégorie par
   catégorie. `mobilite` porte le même identifiant des deux côtés. */
test("la grille d'Aide porte exactement les icônes de la source de vérité", async () => {
  const src = await lire("aide.js");
  const ecarts = [];
  const re = /id:\s*"([a-z]+)",\s*emoji:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const [, id, emoji] = m;
    const attendu = I.icone(id);
    if (attendu && emoji !== attendu) ecarts.push(`${id} : aide.js « ${emoji} », attendu « ${attendu} »`);
  }
  assert.deepEqual(ecarts, [], "\n" + ecarts.join("\n"));
});

/* Sur la carte, les identifiants ne sont pas les mêmes — une catégorie de
   lieu n'est pas un besoin — mais les fonctions qui se recouvrent doivent se
   ressembler. La liste est explicite : on ne devine pas les équivalences. */
const MEMES_FONCTIONS = Object.freeze({
  hebergement: "logement",   // un toit
  sante: "sante",            // se soigner
  emploi: "travail",         // travailler
  ecole: "jeunes",           // étudier
  friperie: "vetements",     // s'habiller
  asso: "aide",              // être aidé
  bus: "mobilite",           // se déplacer
  sport: "sport",
  cafe: "chiller",
  velo: "bouger",
});

test("la carte et Aide ne donnent pas deux symboles à une même fonction", async () => {
  const src = await lire("index.html");
  const table = src.slice(src.indexOf("const CATS = {"));
  const ecarts = [];
  for (const [catCarte, catAide] of Object.entries(MEMES_FONCTIONS)) {
    const m = new RegExp("\\b" + catCarte + ":\\s*\\{[^}]*emoji:\\s*\"([^\"]+)\"").exec(table);
    assert.ok(m, catCarte + " est introuvable dans CATS");
    const attendu = I.icone(catAide);
    if (m[1] !== attendu) {
      ecarts.push(`${catCarte} : carte « ${m[1] }», Aide « ${attendu} » (${catAide})`);
    }
  }
  assert.deepEqual(ecarts, [], "\n" + ecarts.join("\n"));
});

test("aucune icône de la carte n'est un pictogramme nu", async () => {
  for (const fichier of ["index.html", "aide.js"]) {
    const src = await lire(fichier);
    const nus = new Set();
    const re = /emoji:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const premier = [...m[1]][0];
      if (/\p{Emoji}/u.test(premier) && !/\p{Emoji_Presentation}/u.test(premier) &&
          !m[1].includes("️")) nus.add(m[1]);
    }
    assert.deepEqual([...nus], [],
      fichier + " : icônes sans U+FE0F, illisibles selon la plateforme");
  }
});

test("deux fonctions distinctes de la carte ne partagent pas une icône", async () => {
  const src = await lire("index.html");
  const table = src.slice(src.indexOf("const CATS = {"), src.indexOf("const SERVICES = ["));
  const parIcone = new Map();
  const re = /(\w+):\s*\{label:"[^"]*",\s*emoji:"([^"]+)"/g;
  let m;
  while ((m = re.exec(table))) {
    if (!parIcone.has(m[2])) parIcone.set(m[2], []);
    parIcone.get(m[2]).push(m[1]);
  }
  const doublons = [...parIcone.entries()].filter(([, ids]) => ids.length > 1);
  assert.deepEqual(doublons, [],
    "deux catégories de carte partagent une icône : " + JSON.stringify(doublons));
});

/* ==========================================================================
   Le routeur est bien celui qui décide où va une phrase tapée
   ======================================================================== */
test("Aide délègue le basculement vers Explorer au routeur", async () => {
  const src = await lire("aide.js");
  assert.match(src, /AutourIntentions/,
    "domaineDeLaPhrase doit consulter le routeur d'intentions");
  assert.match(src, /mondeDe\(r\)\s*===\s*"explorer"/,
    "seul un verdict « explorer » est délégué ; « aide » reste le défaut");
});

test("le routeur est chargé avant Aide dans la page", async () => {
  const src = await lire("index.html");
  const iIntentions = src.indexOf('src="intentions.js?v=');
  const iAide = src.indexOf('src="aide.js?v=');
  assert.ok(iIntentions > 0, "intentions.js doit être chargé par la page");
  assert.ok(iIntentions < iAide, "intentions.js doit précéder aide.js");
});

test("les domaines annoncés à l'écran sont ceux de la grille, sans jargon", async () => {
  const src = await lire("aide.js");
  const bloc = /const PERIMETRE = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(src);
  assert.ok(bloc, "PERIMETRE doit exister");
  for (const jargon of ["insertion", "accompagnement", "dispositif", "usager",
                        "bénéficiaire", "urgence sociale", "prescripteur"]) {
    assert.ok(!bloc[1].includes(jargon),
      "« " + jargon + " » est un mot d'administration, pas un mot de quelqu'un qui cherche");
  }
});

test("deux catégories au coude à coude ne sont pas départagées au hasard", () => {
  const r = I.router("j’ai besoin de vêtements et de manger");
  assert.ok(r.confidence < I.SEUIL_CONFIANCE,
    "une phrase qui parle de deux choses ne doit pas afficher une fausse certitude");
  assert.equal(I.mondeDe(r), "question");
  const ids = r.suggestions.map((s) => s.id);
  assert.ok(ids.includes("manger") && ids.includes("vetements"),
    "les deux lectures possibles doivent être proposées : " + ids.join(", "));
  assert.ok(r.suggestions.length <= 3, "trois au plus, jamais un menu");
  for (const s of r.suggestions) {
    assert.ok(s.icone && s.label, "icône ET mot, jamais l'un sans l'autre");
  }
});

test("une catégorie qui domine nettement n'est pas remise en question", () => {
  // le pendant du test précédent : proposer quand on hésite, trancher sinon
  for (const p of ["je dors dehors", "besoin taf", "un bon kebab près de moi"]) {
    const r = I.router(p);
    assert.ok(r.confidence >= I.SEUIL_CONFIANCE, p + " : hésitation injustifiée");
    assert.deepEqual(r.suggestions, [], p + " : rien à proposer quand on est sûr");
  }
});
