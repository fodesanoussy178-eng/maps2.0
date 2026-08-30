import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import "../comprendre.js";
import "../aide-intentions.js";
import "../aide-taxonomie.js";
import "../aide-classement.js";
import "../aide-rayon.js";
import "../aide.js";

const MOTEUR = globalThis.AutourAideIntentions;
const TAXONOMIE = globalThis.AutourAideTaxonomie;
const CLASSEMENT = globalThis.AutourAideClassement;
const AIDE = globalThis.AutourAide;
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

/* Les providers navigateur sont des IIFE qui reçoivent `window`. Les charger
   dans une fenêtre isolée permet de tester le même contrat que l'application,
   sans dépendre d'un DOM ni d'un appel réseau. */
const providerWindow = {};
const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
new Function("window", lire("../providers/normaliser.js"))(providerWindow);
new Function("window", lire("../providers/osm.js"))(providerWindow);
const PROVIDERS = providerWindow.AutourProviders;

const ids = (phrase) => MOTEUR.analyserBesoins(phrase).besoins.map((x) => x.besoin);

function entreesLexique() {
  return MOTEUR.CATEGORIES.flatMap((besoin) =>
    MOTEUR.LEXIQUE[besoin].map((expression) => ({ besoin, expression })));
}

test("le lexique de production est le contrat paramétré des dix catégories", async (t) => {
  assert.deepEqual(Object.keys(MOTEUR.LEXIQUE).sort(), MOTEUR.CATEGORIES.slice().sort());
  const entrees = entreesLexique();
  const nonReconues = [];
  let reconnu = 0;

  /* Un sous-test par catégorie garde le contrat lisible, mais les expressions
     viennent toutes de `LEXIQUE` : il n'existe volontairement aucune copie
     manuelle des mots dans cette suite. */
  for (const besoin of MOTEUR.CATEGORIES) {
    await t.test(besoin, () => {
      MOTEUR.LEXIQUE[besoin].forEach((expression) => {
        const resultat = MOTEUR.analyserBesoins(expression);
        const trouve = resultat.besoins.some((x) => x.besoin === besoin);
        if (trouve) reconnu += 1;
        else nonReconues.push({ besoin, expression });
        assert.ok(trouve, `${expression} → ${resultat.besoins.map((x) => x.besoin).join(", ") || "aucun"}`);
      });
    });
  }

  /* Les sous-tests ont déjà exercé chaque entrée. Ce contrôle agrégé produit
     le chiffre demandé dans la sortie de la suite et conserve la liste exacte
     en cas de régression. */
  assert.equal(reconnu, entrees.length,
    `lexique: total=${entrees.length}, reconnu=${reconnu}, taux=${(reconnu / entrees.length * 100).toFixed(2)}%; ` +
    `expressions non reconnues: ${nonReconues.map((x) => `${x.besoin}: ${x.expression}`).join(" | ")}`);
  console.log(`Lexique Aide — total: ${entrees.length} · reconnu: ${reconnu} · taux: ${(reconnu / entrees.length * 100).toFixed(2)}% · attendu: 100%`);
});

test("la normalisation conserve le contrat entre formes accentuées et non accentuées", () => {
  [
    ["j’ai faim", "j'ai faim", "manger"],
    ["Pôle emploi", "pole emploi", "travail"],
    ["Sécurité", "securite", "securite"],
  ].forEach(([accentuee, sansAccent, besoin]) => {
    assert.ok(ids(accentuee).includes(besoin), `${accentuee} → ${besoin}`);
    assert.ok(ids(sansAccent).includes(besoin), `${sansAccent} → ${besoin}`);
    assert.deepEqual(ids(accentuee), ids(sansAccent), `${accentuee} et ${sansAccent} doivent être équivalents`);
  });
  assert.ok(ids("g plus de thune").includes("travail"), "la correction SMS existante doit rester active");
  assert.ok(ids("jsp ou aller").includes("autre"), "la correction SMS existante doit rester active");
});

test("l'intégration Aide ne complète pas le lexique avec l'ancienne table de mots", () => {
  [
    "ma mère m'a viré",
    "je suis étudiant j'ai plus d'argent et rien à manger",
    "je sais pas où aller",
  ].forEach((phrase) => {
    assert.deepEqual(AIDE.besoinsDepuisPhrase(phrase).map((x) => x.id), ids(phrase),
      `${phrase} doit suivre exactement le moteur de lexique`);
  });
});

/* Une ligne par catégorie, uniquement pour le contrat structurel (et non pour
   le lexique). Les tags sont ceux que la collecte OSM demande réellement ; le
   nom ne sert jamais de preuve. Chaque ligne suit exactement le même pipeline. */
const CONTRAT_STRUCTURES = Object.freeze([
  { besoin: "manger", phrase: "j'ai la dalle", type: "banque_alimentaire",
    collecte: ["social_facility", "food_bank"],
    raw: { titre: "Banque alimentaire", cat: "alimentaire", type: "banque_alimentaire",
      tags: { social_facility: "food_bank" } } },
  { besoin: "logement", phrase: "je dors dehors", type: "chrs",
    collecte: ["social_facility", "group_home"],
    raw: { titre: "CHRS du secteur", cat: "hebergement", type: "chrs", ouvert: false,
      tags: { social_facility: "group_home" } } },
  { besoin: "travail", phrase: "taf", type: "mission_locale",
    collecte: ["office", "employment_agency"],
    raw: { titre: "Mission Locale", cat: "emploi", type: "mission_locale",
      tags: { office: "employment_agency" } } },
  { besoin: "papiers", phrase: "ANEF", type: "france_services",
    collecte: ["government", "public_service"],
    raw: { titre: "France Services", cat: "mairie", type: "france_services",
      tags: { government: "public_service" } } },
  { besoin: "sante", phrase: "hosto", type: "centre_de_sante",
    collecte: ["healthcare", "centre"],
    raw: { titre: "Centre de santé", cat: "sante", type: "centre_de_sante",
      tags: { healthcare: "centre" } } },
  { besoin: "jeunes", phrase: "CROUS", type: "point_information_jeunesse",
    collecte: ["amenity", "youth_centre"],
    raw: { titre: "Point Information Jeunesse", cat: "asso", type: "point_information_jeunesse",
      tags: { amenity: "youth_centre" } } },
  { besoin: "parler", phrase: "personne à qui parler", type: "cmp",
    collecte: ["healthcare", "counselling"],
    raw: { titre: "CMP", cat: "sante", type: "cmp",
      tags: { healthcare: "counselling" } } },
  { besoin: "famille", phrase: "mère isolée", type: "centre_social",
    collecte: ["amenity", "social_centre"],
    raw: { titre: "Centre social", cat: "asso", type: "centre_social",
      tags: { amenity: "social_centre" } } },
  { besoin: "securite", phrase: "police", type: "commissariat",
    collecte: ["amenity", "police"],
    raw: { titre: "Commissariat", cat: "securite", type: "commissariat",
      tags: { amenity: "police" } } },
  { besoin: "autre", phrase: "je ne sais pas où aller", type: "centre_social",
    collecte: ["amenity", "social_centre"],
    raw: { titre: "Centre social", cat: "asso", type: "centre_social",
      tags: { amenity: "social_centre" } } },
]);

function extraireRequetes() {
  const debut = app.indexOf("const REQUETES = [");
  const fin = app.indexOf("];", debut);
  assert.ok(debut >= 0 && fin > debut, "la table de collecte OSM est introuvable");
  return new Set([...app.slice(debut, fin).matchAll(/\["([^"]+)","([^"]+)","([^"]+)"\]/g)]
    .map((m) => `${m[1]}=${m[2]}`));
}

function executerPipeline(spec, index) {
  const intention = MOTEUR.analyserBesoins(spec.phrase);
  assert.ok(intention.besoins.some((x) => x.besoin === spec.besoin),
    `${spec.phrase} ne comprend pas ${spec.besoin}`);

  const collecte = Object.assign({
    id: `contrat-${index}`,
    lat: 50.70 + index / 10000,
    lng: 3.15 + index / 10000,
    adresse: "1 rue du Contrat",
  }, spec.raw);
  const normalise = PROVIDERS.osm.normaliser(collecte);
  assert.ok(normalise, `${spec.besoin}: provider → normalisation a rejeté la fiche`);
  const interne = PROVIDERS.versInterne(normalise);
  assert.ok(interne, `${spec.besoin}: la projection interne a rejeté la fiche`);
  const lieu = Object.assign({}, collecte, interne);
  const verdict = CLASSEMENT.repond(lieu, spec.besoin);
  assert.equal(verdict.accorde, true, `${spec.besoin}: taxonomie/classement a refusé la structure`);
  assert.equal(AIDE.estSolution(lieu, [spec.besoin]), true,
    `${spec.besoin}: la solution n'est pas sélectionnable par Aide`);
  assert.ok(lieu.titre && Number.isFinite(lieu.lat) && Number.isFinite(lieu.lng),
    `${spec.besoin}: résultat non affichable`);
  return { intention, collecte, normalise, lieu, verdict };
}

test("le contrat besoin → collecte → provider → normalisation → taxonomie → classement est identique pour les dix catégories", () => {
  const requetes = extraireRequetes();
  assert.equal(CONTRAT_STRUCTURES.length, MOTEUR.CATEGORIES.length);
  CONTRAT_STRUCTURES.forEach((spec, index) => {
    assert.ok(MOTEUR.CATEGORIES.includes(spec.besoin), `${spec.besoin} n'est pas une catégorie du moteur`);
    const description = TAXONOMIE.besoin(spec.besoin);
    if (description) {
      assert.ok(description.types.includes(spec.type),
        `${spec.type} n'est pas un type canonique de ${spec.besoin}`);
    } else {
      /* « Autre aide » est explicitement le besoin ouvert de la taxonomie :
         son contrat est de proposer une capacité sociale reconnue, pas de
         créer une onzième description de structure. */
      assert.equal(spec.besoin, TAXONOMIE.BESOIN_OUVERT);
      assert.ok(TAXONOMIE.BESOINS.some((b) => b.types.includes(spec.type)),
        `${spec.type} n'est porté par aucune capacité pour Autre aide`);
    }
    assert.ok(requetes.has(`${spec.collecte[0]}=${spec.collecte[1]}`),
      `${spec.besoin}: ${spec.collecte.join("=")} n'est pas demandé par la collecte`);
    executerPipeline(spec, index);
  });
});

test("une solution logement reste affichable quand elle est fermée, tandis qu'un hôtel commercial est refusé", () => {
  const logement = executerPipeline(CONTRAT_STRUCTURES.find((x) => x.besoin === "logement"), 20);
  assert.equal(logement.lieu.ouvert, false);
  assert.equal(logement.verdict.accorde, true, "fermé ne signifie pas absence de solution logement");

  const hotel = Object.assign({
    id: "hotel-commercial",
    lat: 50.70, lng: 3.15,
    titre: "Hôtel commercial",
    cat: "hebergement",
    type: "hotel",
    tags: { tourism: "hotel" },
    source: "openstreetmap",
  });
  const verdict = CLASSEMENT.repond(hotel, "logement");
  assert.equal(verdict.accorde, false);
  assert.equal(AIDE.estSolution(hotel, ["logement"]), false);
});

test("un résultat fiable proche reste prioritaire sur un résultat fiable éloigné", () => {
  const spec = CONTRAT_STRUCTURES.find((x) => x.besoin === "logement");
  const proche = executerPipeline(spec, 30).lieu;
  const eloigne = executerPipeline(spec, 31).lieu;
  Object.assign(proche, { rankDistance: 500, verdictAide: CLASSEMENT.repond(proche, "logement") });
  Object.assign(eloigne, { rankDistance: 12000, verdictAide: CLASSEMENT.repond(eloigne, "logement") });
  assert.ok(CLASSEMENT.comparer(proche, eloigne) < 0,
    "le classement doit préférer la structure fiable la plus proche");
});
