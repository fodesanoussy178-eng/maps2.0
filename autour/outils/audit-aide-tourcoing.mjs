/* Audit reproductible des cinq inventaires Aide autour de Tourcoing.
   Usage : `node outils/audit-aide-tourcoing.mjs` depuis `autour/`.
   Les requêtes distantes restent dans leurs routes respectives ; l'audit
   s'appuie sur les extraits versionnés, afin que les compteurs du rapport ne
   dépendent pas d'une panne réseau. */
import dora from "../data/aide-dora-tourcoing.js";
import finess from "../data/aide-finess-tourcoing.js";
import dila from "../data/aide-institutionnelle-dila-59599.js";
import osm from "../data/aide-osm-tourcoing.js";
import { readFileSync } from "node:fs";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fenetre = {};
const charger = (p, args = ["globalThis", "window"]) =>
  new Function(...args, lire(p))(...args.map(() => fenetre));

charger("../aide-taxonomie.js");
charger("../aide-classement.js");
charger("../aide-structures.js");
charger("../providers/normaliser.js", ["window"]);
charger("../providers/osm.js", ["window"]);
charger("../providers/aideInstitutionnelle.js", ["window"]);
charger("../providers/aideDora.js");
charger("../providers/aideFiness.js");

const TAXO = fenetre.AutourAideTaxonomie;
const AIDE = fenetre.AutourAideStructures;
const P = fenetre.AutourProviders;
const CENTRE = { lat: 50.72373, lng: 3.160758 };
const BESOINS = ["manger", "logement", "travail", "papiers", "sante", "jeunes", "parler", "famille", "securite", "autre"];

const sources = {
  autour: [], // permanentPlaces est injecté par l'application à l'exécution
  dora: dora.map(P.aideDora.normaliser).filter(Boolean),
  finess: finess.map(P.aideFiness.normaliser).filter(Boolean),
  service_public: dila.records.map(P.aideInstitutionnelle.normaliser).filter(Boolean),
  openstreetmap: osm.map(P.aideOsm.normaliser).filter(Boolean),
};
const brutes = Object.values(sources).flat();
const structures = AIDE.dedupe(brutes);

function preuvesPour(structure, besoin) {
  if (besoin === "autre") {
    return Object.values(structure.capacities || {}).flatMap((value) => value && value.evidence || []);
  }
  const description = TAXO.besoin(besoin);
  return description && structure.capacities[description.capacite]
    ? structure.capacities[description.capacite].evidence || [] : [];
}

function compteSources(liste) {
  return Object.fromEntries([...new Set(liste.flatMap((s) => s.sources || []))]
    .sort().map((source) => [source, liste.filter((s) => (s.sources || []).includes(source)).length]));
}

const audit = Object.fromEntries(BESOINS.map((besoin) => {
  const candidats = structures.filter((structure) => preuvesPour(structure, besoin).length > 0);
  const fiables = candidats.filter((structure) => AIDE.fiable(structure, [besoin]));
  const affichables = fiables.filter(AIDE.affichable);
  return [besoin, {
    candidates: candidats.length,
    reliable: fiables.length,
    displayable: affichables.length,
    sources: compteSources(affichables),
  }];
}));

console.log(JSON.stringify({
  scope: {
    centre: CENTRE,
    radiusMeters: 12000,
    communes: ["Tourcoing", "Roubaix", "Wattrelos", "Mouvaux", "Roncq", "Halluin", "Neuville-en-Ferrain", "Linselles", "Bondues", "Croix", "Hem", "Wasquehal"],
    note: "Le périmètre est un cercle de 12 km ; le classement conserve les communes voisines pertinentes, y compris hors Tourcoing.",
  },
  inventory: Object.fromEntries(Object.entries(sources).map(([source, records]) => [source, {
    raw: source === "openstreetmap" ? { tourcoing: 65, circle12km: 692 } : records.length,
    normalized: records.length,
    runtime: source === "autour",
  }])),
  deduplicated: structures.length,
  audit,
}, null, 2));
