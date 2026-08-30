import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import dora from "../data/aide-dora-tourcoing.js";
import finess from "../data/aide-finess-tourcoing.js";
import dila from "../data/aide-institutionnelle-dila-59599.js";
import osm from "../data/aide-osm-tourcoing.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fenetre = {};
const iife = (p, args = ["globalThis", "window"]) =>
  new Function(...args, lire(p))(...args.map((name) => name === "globalThis" ? fenetre : fenetre));

iife("../aide-taxonomie.js");
iife("../aide-classement.js");
iife("../aide-structures.js");
iife("../providers/normaliser.js", ["window"]);
iife("../providers/osm.js", ["window"]);
iife("../providers/aideAutour.js");
iife("../providers/aideInstitutionnelle.js", ["window"]);
iife("../providers/aideDora.js", ["globalThis", "window"]);
iife("../providers/aideFiness.js", ["globalThis", "window"]);

const AIDE = fenetre.AutourAideStructures;
const P = fenetre.AutourProviders;
const BESOINS = ["manger", "logement", "travail", "papiers", "sante", "jeunes", "parler", "famille", "securite", "autre"];

function interne(canonique) {
  return P.versInterne(canonique);
}

test("les cinq sources convergent vers le contrat AideStructure", () => {
  const fiches = [
    P.aideAutour ? P.aideAutour.normaliser({}) : null,
    P.aideDora.normaliser(dora[0]),
    P.aideFiness.normaliser(finess[0]),
    P.aideInstitutionnelle.normaliser(dila.records[0]),
    P.aideOsm.normaliser(osm[0]),
  ].filter(Boolean);
  assert.equal(fiches.length, 4, "les adapters structurés doivent tous produire une fiche");
  fiches.forEach((fiche) => {
    assert.equal(fiche.kind, "AideStructure");
    assert.equal(fiche.aideStructure, true);
    assert.ok(fiche.name && fiche.address !== undefined);
    assert.ok(fiche.identifiers && fiche.provenance.length);
    BESOINS.forEach((id) => {
      const besoin = fenetre.AutourAideTaxonomie.besoin(id);
      if (!besoin) return;
      assert.ok(fiche.capacities[besoin.capacite], `${fiche.name}: capacité absente ${besoin.capacite}`);
      assert.equal(typeof fiche.capacities[besoin.capacite].confidence, "number");
      assert.ok(Array.isArray(fiche.capacities[besoin.capacite].provenance));
    });
  });
  assert.equal(P.aideAutour.normaliser({ id: "commerce", name: "Boulangerie", lat: 50.72,
    lng: 3.16, category: "commerce" }), null, "Autour ne verse pas les commerces dans Aide");
});

test("les cas obligatoires sont couverts par le type ou le service, jamais par le nom", () => {
  const mission = interne(P.aideDora.normaliser(dora.find((x) => x.id === "mission-emploi-lys-t")));
  assert.equal(mission.type, "mission_locale");
  assert.equal(mission.capacitesAide.financial_assistance, true);
  assert.equal(mission.capacitesAide.youth_support, true);

  const secours = interne(P.aideDora.normaliser(dora.find((x) => x.id === "secours-populaire-roubaix")));
  assert.equal(secours.capacitesAide.food_assistance, true);

  const ccas = interne(P.aideDora.normaliser(dora.find((x) => x.id === "ccas-de-tourcoing")));
  assert.equal(ccas.capacitesAide.administrative_help, true);
  assert.equal(ccas.capacitesAide.housing_assistance, true);

  const caf = interne(P.aideDora.normaliser(dora.find((x) => x.id === "caf-du-nord-tourcoing")));
  assert.equal(caf.capacitesAide.family_support, true);

  const types = [
    ["RESIDENCE SOCIALE FJT", "housing_assistance"],
    ["CHRS PIERRE", "housing_assistance"],
    ["CMP ADULTES", "healthcare"],
    ["SCE DE PMI", "family_support"],
  ];
  types.forEach(([debut, capacite]) => {
    const fiche = finess.map(P.aideFiness.normaliser).find((x) => x && x.name.startsWith(debut));
    assert.ok(fiche, `FINESS ${debut} absent`);
    assert.equal(fiche.capacitesAide[capacite], true, `${fiche.name} → ${capacite}`);
  });

  const police = interne(P.aideOsm.normaliser(osm[0]));
  assert.equal(police.capacitesAide.safety_support, true);
  const policeSansCategorie = P.aideOsm.normaliser({ id: "node/police-sans-cat", name: "Poste", lat: 50.72,
    lng: 3.16, tags: { amenity: "police" } });
  assert.equal(policeSansCategorie.category, "securite");
  assert.equal(policeSansCategorie.capacitesAide.safety_support, true);
});

test("l'adapter FINESS lit aussi la structure imbriquée du format nouvelle génération", () => {
  const fiche = P.aideFiness.normaliser({
    informationsGeneralesPMEJ: { pmSmsseId: "50000", numFinessPm: "590000001",
      denominationLonguePmSmsse: "Personne morale test" },
    ege: [{
      informationsGeneralesEGE: { egeId: "90000", numFinessEge: "590000002",
        nomEgeLong: "CHRS imbriqué", siret: "12345678900010" },
      categorieentiteGeographiqueExercice: "214", etatObjet: "A",
      adresse: [{ ligneQuatre: "1 RUE DU TEST", codePostal: "59200",
        ligneAcheminement: "TOURCOING", coordonneesGeographique: { coordonneeX: "3.16", coordonneeY: "50.72" } }],
      contact: [{ telecom: { telephone: "0320000000" } }],
    }],
  });
  assert.ok(fiche);
  assert.equal(fiche.primaryType, "chrs");
  assert.equal(fiche.identifiers.finessEge, "590000002");
  assert.equal(fiche.capacitesAide.housing_assistance, true);
});

test("le nom seul ne crée aucune capacité", () => {
  const dilaNomSeul = P.aideInstitutionnelle.normaliser({
    id: "nom-seul", nom: "Secours populaire", adresse: [{ numero_voie: "1 rue Test",
      code_postal: "59200", nom_commune: "Tourcoing", latitude: 50.72, longitude: 3.16 }],
  });
  assert.equal(dilaNomSeul.primaryType, "");
  assert.equal(dilaNomSeul.capacitesAide.food_assistance, false);
  assert.equal(dilaNomSeul.capacitesAide.financial_assistance, false);

  const doraNomSeul = P.aideDora.normaliser({ id: "nom-dora", name: "Secours populaire",
    address1: "1 rue Test", postalCode: "59200", city: "Tourcoing", latitude: 50.72, longitude: 3.16 });
  assert.equal(doraNomSeul.primaryType, "");
  assert.equal(doraNomSeul.capacitesAide.food_assistance, false);
});

test("la fermeture est conservée et n'empêche pas l'affichage", () => {
  const ferme = AIDE.normaliser({ source: "finess", name: "CHRS fermé", type_structure: "chrs",
    category: "hebergement", status: "closed", lat: 50.72, lng: 3.16,
    address: "1 rue du Foyer, 59200 Tourcoing", sourceRefs: { finessEge: "590999999" } });
  assert.equal(ferme.status.value, "closed");
  assert.equal(ferme.status.ouvert, false);
  assert.equal(AIDE.affichable(ferme), true);
  assert.equal(AIDE.fiable(ferme, ["logement"]), true);
});

test("la déduplication suit les identifiants officiels puis le triplet de secours", () => {
  const memeSiret = AIDE.dedupe([
    { source: "dora", name: "CCAS Tourcoing", lat: 50.7248, lng: 3.1578, address: "26 rue Bienfaisance",
      category: "mairie", type_structure: "ccas", siret: "26590599200011", doraId: "ccas-a" },
    { source: "service_public", name: "Centre communal", lat: 50.7248, lng: 3.1578, address: "26 rue Bienfaisance",
      category: "mairie", type_structure: "ccas", siret: "26590599200011", servicePublicId: "ccas-b" },
  ]);
  assert.equal(memeSiret.length, 1);
  assert.deepEqual(new Set(memeSiret[0].sources), new Set(["dora", "service_public"]));

  const nomsIdentifies = AIDE.dedupe([
    { source: "dora", name: "Même site", lat: 50.72, lng: 3.16, address: "1 rue A", type_structure: "ccas", doraId: "one" },
    { source: "finess", name: "Même site", lat: 50.72, lng: 3.16, address: "1 rue A", type_structure: "service_social", finessEge: "590000001" },
  ]);
  assert.equal(nomsIdentifies.length, 2, "deux identités officielles distinctes ne se fusionnent pas au nom");

  const etablissements = AIDE.dedupe([
    { source: "finess", name: "Deux sites d'une même personne morale", lat: 50.72, lng: 3.16,
      address: "1 rue A", type_structure: "chrs", finessEge: "590000010", siret: "11111111100010" },
    { source: "finess", name: "Deux sites d'une même personne morale", lat: 50.721, lng: 3.161,
      address: "2 rue B", type_structure: "chrs", finessEge: "590000011", siret: "11111111100010" },
  ]);
  assert.equal(etablissements.length, 2, "un SIRET partagé ne fusionne pas deux FINESS EGE");

  const secours = AIDE.dedupe([
    { source: "unknown", name: "Même lieu", lat: 50.72, lng: 3.16, address: "1 rue A" },
    { source: "unknown", name: "Même lieu", lat: 50.7201, lng: 3.1601, address: "1 rue A" },
  ]);
  assert.equal(secours.length, 1);
});
