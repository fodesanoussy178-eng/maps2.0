/* Audit déterministe du bassin Aide pré-calculé.
 *
 * Il ne compte pas des commerces ou des mots-clés : chaque colonne est le
 * verdict de la taxonomie Aide sur une fiche data·inclusion géolocalisée.
 *
 *   node outils/audit-aide-national.mjs
 */
import { readFileSync } from "node:fs";
import zones from "../data/aide-precalcule-villes.js";

const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fenetre = {};
const iife = (p, args = ["globalThis", "window"]) =>
  new Function(...args, lire(p))(...args.map(() => fenetre));

iife("../aide-taxonomie.js");
iife("../aide-classement.js");
iife("../aide-structures.js");
iife("../providers/aideDora.js", ["globalThis", "window"]);

const P = fenetre.AutourProviders;
const CAPACITES = Object.freeze({
  Manger: "food_assistance",
  Logement: "housing_assistance",
  Sante: "healthcare",
  Papiers: "administrative_help",
  Travail: "financial_assistance",
});
const motFood = /restos? du coeur|secours populaire|banque alimentaire|epicerie|distribution alimentaire|aide alimentaire|restaurant social|restauration solidaire|repas solidaire|village alimentaire/i;

function fiche(code, record) {
  const value = P.aideDora.normaliser(record);
  return value && value.trustLevel !== "unknown" ? value : null;
}

function score(ficheValue, category) {
  const name = String(ficheValue.name || "");
  const type = String(ficheValue.primaryType || "");
  const food = category === "Manger" && (motFood.test(name) || type === "association_alimentaire");
  return (food ? 100 : 0) + (type ? 10 : 0) + (ficheValue.officialUrl ? 1 : 0);
}

function audit(code, zone) {
  const fiches = zone.records.map((record) => fiche(code, record)).filter(Boolean);
  const counts = {};
  const samples = {};
  for (const [category, capacity] of Object.entries(CAPACITES)) {
    const matches = fiches.filter((value) => value.capacitesAide[capacity]);
    counts[category] = matches.length;
    samples[category] = matches
      .sort((a, b) => score(b, category) - score(a, category) || a.name.localeCompare(b.name, "fr"))
      .slice(0, 2)
      .map((value) => ({ name: value.name, commune: value.commune, source: value.provenance[0]?.producer || value.source,
        url: value.officialUrl }));
  }
  const producers = {};
  zone.records.forEach((record) => { producers[record.dataProvider] = (producers[record.dataProvider] || 0) + 1; });
  return { city: zone.nom, code, records: zone.records.length, counts, producers, samples };
}

const results = Object.entries(zones).map(([code, zone]) => audit(code, zone));
console.log("Ville | Manger | Logement | Santé | Papiers | Travail | Fiches");
console.log("--- | ---: | ---: | ---: | ---: | ---: | ---:");
results.forEach((result) => console.log(`${result.city} | ${result.counts.Manger} | ${result.counts.Logement} | ${result.counts.Sante} | ${result.counts.Papiers} | ${result.counts.Travail} | ${result.records}`));
console.log("\nÉchantillons vérifiables :");
results.forEach((result) => {
  console.log(`\n${result.city} (${result.code})`);
  Object.entries(result.samples).forEach(([category, values]) => {
    console.log(`  ${category}: ${values.map((value) => `${value.name} — ${value.source}`).join(" ; ") || "aucune"}`);
  });
});
console.log("\nProducteurs présents par zone :");
results.forEach((result) => console.log(`  ${result.city}: ${Object.entries(result.producers).map(([source, count]) => `${source}=${count}`).join(", ")}`));
