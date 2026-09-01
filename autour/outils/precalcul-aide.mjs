/*
 * Pré-calcul national du bassin Aide.
 *
 * Les fichiers data·inclusion sont nationaux, mais trop volumineux pour être
 * lus à chaque ouverture de l'application. Ce programme les réduit par code
 * INSEE et ne conserve que les structures qui portent un service d'aide
 * explicitement déclaré. Il est volontairement générique : les zones passées
 * en entrée peuvent être remplacées sans modifier le moteur ou l'interface.
 *
 * Usage :
 *   node outils/precalcul-aide.mjs \
 *     --structures /chemin/structures.json \
 *     --services /chemin/services.json \
 *     --output data/aide-precalcule-villes.js
 */
import { readFile, writeFile } from "node:fs/promises";

const ZONES_DEFAUT = Object.freeze({
  "59599": { nom: "Tourcoing", lat: 50.72373, lng: 3.160758 },
  "59350": { nom: "Lille", lat: 50.62925, lng: 3.05726 },
  "49007": { nom: "Angers", lat: 47.47842, lng: -0.56316 },
  "35238": { nom: "Rennes", lat: 48.11198, lng: -1.67429 },
  "75056": { nom: "Paris", lat: 48.85661, lng: 2.35222 },
});

const SOURCE_DATASET = "https://www.data.gouv.fr/datasets/referentiel-de-loffre-dinsertion-sociale-et-professionnelle-data-inclusion/";
const SNAPSHOT_DATE = "2026-08-31";

function argument(nom, defaut) {
  const index = process.argv.indexOf(nom);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
}

function liste(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value == null || value === "" ? [] : [value];
}

function texte(value) {
  return String(value == null ? "" : value).trim();
}

function sansAccents(value) {
  return texte(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isoDate(value) {
  const date = Number(value);
  if (Number.isFinite(date) && date > 0) return new Date(date).toISOString();
  return texte(value) || null;
}

function media(record) {
  const image = texte(record.image || record.image_url || record.photo_url || record.photo);
  if (!image) return {};
  const sourceBrute = texte(record.image_source || record.imageSource || record.photo_source);
  const source = ["data_inclusion", "dora", "finess", "service_public", "data_gouv"].includes(sourceBrute)
    ? "institutional" : sourceBrute || "institutional";
  return {
    image,
    imageSource: source,
    imageSourceUrl: texte(record.image_source_url || record.imageSourceUrl || record.lien_source),
    imageAuthor: texte(record.image_author || record.imageAuthor || record.photo_author),
    imageLicense: texte(record.image_license || record.imageLicense || record.photo_license),
    imageUpdatedAt: isoDate(record.image_updated_at || record.imageUpdatedAt || record.date_maj),
    photos: [{
      url: image,
      source,
      sourceUrl: texte(record.image_source_url || record.imageSourceUrl || record.lien_source),
      author: texte(record.image_author || record.imageAuthor || record.photo_author),
      license: texte(record.image_license || record.imageLicense || record.photo_license),
      updatedAt: isoDate(record.image_updated_at || record.imageUpdatedAt || record.date_maj),
    }],
  };
}

function servicesEtCategories(serviceRows, record) {
  const services = new Set();
  const categories = new Set();
  const types = new Set();
  const themes = serviceRows.flatMap((service) => liste(service.thematiques));
  const normalized = themes.map(sansAccents);
  const reseaux = liste(record.reseaux_porteurs).map(sansAccents);
  const searchable = sansAccents([record.nom, record.description, ...reseaux].join(" "));

  const add = (categorie, service, type) => {
    categories.add(categorie);
    if (service) services.add(service);
    if (type) types.add(type);
  };

  for (const theme of normalized) {
    if (theme.startsWith("logement-hebergement--"))
      add("hebergement", "housing", "logement_accompagne");
    if (theme.startsWith("sante--"))
      add("sante", "medical_care", "centre_de_sante");
    if (theme.startsWith("difficultes-administratives-ou-juridiques--"))
      add("mairie", "administrative_assistance", "service_social");
    if (theme.startsWith("trouver-un-emploi--") || theme.startsWith("preparer-sa-candidature--") ||
        theme.startsWith("choisir-un-metier--") || theme.startsWith("se-former--"))
      add("emploi", "employment", "structure_insertion");
    if (theme.startsWith("famille--"))
      add("asso", "family_support", "centre_social");
  }

  if (reseaux.some((x) => /restos?-du-coeur|banques?-alimentaires?|secours-populaire/.test(x)))
    add("alimentaire", "food", "association_alimentaire");
  if (reseaux.some((x) => /france-service|aidants-connect/.test(x)))
    add("mairie", "administrative_assistance", "france_services");
  if (reseaux.some((x) => /ccas-cias/.test(x)) || /\bccas\b|centre communal d action sociale/.test(searchable))
    add("mairie", "administrative_assistance", "ccas");
  if (reseaux.some((x) => /france-travail|mission-locale|cap-emploi|chrs|aci|ei|etti/.test(x)))
    add("emploi", "employment", "structure_insertion");
  if (reseaux.some((x) => /chrs/.test(x)) || /\bchrs\b|centre d hebergement|accueil de nuit|abri de nuit/.test(searchable))
    add("hebergement", "housing", "chrs");
  const santeStructure = /centre medico|\bcmp\b|centre de sante|cegidd|planning familial|\bpmi\b/.test(sansAccents(record.nom));
  if (reseaux.some((x) => /cmp|sante|planning/.test(x)) || santeStructure)
    add("sante", "medical_care", "centre_de_sante");

  /* Une mention alimentaire générique est volontairement insuffisante : dans
     data·inclusion elle décrit parfois un atelier, une aide aux aidants ou le
     service général d'un CCAS. La preuve doit venir d'un service matériel,
     d'un texte qui décrit effectivement la distribution/les repas, ou d'un
     réseau alimentaire identifié. */
  const alimentationForte = /restos? du coeur|secours populaire|banque alimentaire|epicerie (?:sociale|solidaire)|distribution alimentaire|aide alimentaire|colis alimentaire|restaurant social|restauration solidaire|repas solidaire|village alimentaire|bons d achats alimentaires|cheques alimentaires/.test(searchable);
  const alimentationService = serviceRows.some((service) => {
    const serviceText = sansAccents([service.nom, service.description, service.type].join(" "));
    const theme = liste(service.thematiques).map(sansAccents)
      .includes("equipement-et-alimentation--alimentation");
    return theme && (/aide-materielle|distribution|repas|alimentaire|epicerie/.test(serviceText) ||
      /restos? du coeur|secours populaire|banque alimentaire|epicerie (?:sociale|solidaire)|distribution alimentaire|aide alimentaire|colis alimentaire|restaurant social|restauration solidaire|repas solidaire|village alimentaire|bons d achats alimentaires|cheques alimentaires/.test(serviceText));
  });
  const alimentationReseau = reseaux.some((x) => /restos?-du-coeur|banques?-alimentaires?|secours-populaire/.test(x));
  if (alimentationForte || alimentationService || alimentationReseau)
    add("alimentaire", "food", "association_alimentaire");

  return { services: [...services], categories: [...categories], types: [...types] };
}

function structureAvecServices(record, serviceRows) {
  const themes = serviceRows.flatMap((service) => liste(service.thematiques));
  const classification = servicesEtCategories(serviceRows, record);
  if (!classification.categories.length) return null;
  const lat = Number(record.latitude);
  const lng = Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const producteur = texte(record.source) || "inconnu";
  const sourceUrl = texte(record.lien_source) || SOURCE_DATASET;
  return {
    id: "data-inclusion:" + texte(record.id),
    name: texte(record.nom),
    officialName: texte(record.nom),
    lat,
    lng,
    address: [record.adresse, record.complement_adresse, record.code_postal, record.commune]
      .filter(Boolean).join(", "),
    postalCode: texte(record.code_postal),
    commune: texte(record.commune),
    cityCode: texte(record.code_insee),
    categories: classification.categories,
    category: classification.categories[0],
    services: classification.services,
    service_types: classification.services,
    type_structure: classification.types[0] || "",
    typology: classification.types[0] || "",
    types: classification.types,
    phone: texte(record.telephone),
    website: texte(record.site_web),
    siret: texte(record.siret),
    description: texte(record.description),
    openingHours: texte(record.horaires_accueil) || null,
    source: "data_inclusion",
    dataProvider: producteur,
    sourceRefs: { dataInclusionId: texte(record.id), dataProvider: producteur },
    officialUrl: sourceUrl,
    updatedAt: isoDate(record.date_maj),
    lastSourceUpdate: isoDate(record.date_maj),
    sourceConfidence: 0.88,
    provenance: [{
      source: "data_inclusion",
      id: texte(record.id),
      url: sourceUrl,
      updatedAt: isoDate(record.date_maj),
      confidence: 0.88,
      producer: producteur,
    }],
    ...media(record),
  };
}

const structuresPath = argument("--structures", "data/structures-inclusion.json");
const servicesPath = argument("--services", "data/services-inclusion.json");
const outputPath = argument("--output", "data/aide-precalcule-villes.js");
const zonesPath = argument("--zones", null);
const snapshotDate = argument("--snapshot-date", SNAPSHOT_DATE);
const ZONES = zonesPath
  ? JSON.parse(await readFile(zonesPath, "utf8"))
  : ZONES_DEFAUT;
const [structures, services] = await Promise.all([
  readFile(structuresPath, "utf8").then(JSON.parse),
  readFile(servicesPath, "utf8").then(JSON.parse),
]);

const servicesParStructure = new Map();
for (const service of services) {
  const id = texte(service.structure_id);
  if (!id) continue;
  if (!servicesParStructure.has(id)) servicesParStructure.set(id, []);
  servicesParStructure.get(id).push(service);
}

const zones = {};
for (const [code, zone] of Object.entries(ZONES)) {
  const records = structures.filter((record) => texte(record.code_insee) === code)
    .map((record) => structureAvecServices(record, servicesParStructure.get(texte(record.id)) || []))
    .filter(Boolean);
  zones[code] = { ...zone, codeInsee: code, records };
}

const body = "/* Généré par outils/precalcul-aide.mjs depuis data·inclusion. */\n" +
  "export const metadata = Object.freeze(" + JSON.stringify({
    source: "data_inclusion",
    snapshotDate,
    dataset: SOURCE_DATASET,
    zoneCount: Object.keys(zones).length,
  }) + ");\n\n" +
  "export const zones = Object.freeze(" + JSON.stringify(zones) + ");\n\n" +
  "export default zones;\n";
await writeFile(outputPath, body);
console.log(JSON.stringify({ output: outputPath, zones: Object.fromEntries(Object.entries(zones).map(([code, zone]) => [code, zone.records.length])) }));
