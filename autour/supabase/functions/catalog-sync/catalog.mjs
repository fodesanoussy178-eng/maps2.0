/* ---------------------------------------------------------------------------
   Normalisation du catalogue transport.data.gouv.fr — logique pure.

   Volontairement séparée du handler Deno : aucune dépendance à Deno, au
   réseau ni à Supabase, donc testable directement sous Node.

   Principe de prudence : l'API du Point d'Accès National n'a pas pu être
   observée depuis l'environnement de développement (accès sortant bloqué).
   Les correspondances de champs ci-dessous couvrent donc plusieurs formes
   plausibles, et le payload brut est conservé intégralement en base — si la
   normalisation se révèle incomplète, on renormalise sans re-télécharger.
   Aucune valeur n'est inventée : un champ absent reste null.
--------------------------------------------------------------------------- */

/* Territoires de test. Ajouter un territoire doit être une donnée, pas du
   code : c'est ce qui évite de recoder la fonctionnalité ville par ville. */
export const SCOPES = Object.freeze({
  // Métropole Européenne de Lille
  mel: Object.freeze({
    label: "Métropole Européenne de Lille",
    siren: ["245900410"],
    // codes INSEE des principales communes de la MEL, utilisés quand le
    // catalogue ne rattache pas le jeu de données à l'AOM
    insee: ["59350", "59512", "59009", "59646", "59328", "59360", "59299",
            "59220", "59378", "59457", "59522", "59173", "59356", "59005"],
    match: /m[ée]tropole\s+europ[ée]enne\s+de\s+lille|\bmel\b|\blille\b|\broubaix\b|\btourcoing\b|\bvilleneuve[- ]d.ascq\b/i,
  }),
  // garde-fou : « toute la France » reste possible mais doit être demandé
  france: Object.freeze({label: "France entière", siren: [], insee: [], match: /.*/}),
});

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/* Une ressource du PAN : URL + format, plus le type de flux temps réel quand
   il est déclaré. On ne télécharge rien ici — phase 0 découvre, n'importe pas. */
export function normalizeResource(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = firstString(raw.url, raw.original_url, raw.latest_url);
  if (!url) return null;
  return {
    url,
    title: firstString(raw.title, raw.name),
    format: firstString(raw.format, raw.mime, raw.type),
    realtime_kind: firstString(raw.features && raw.features.join
      ? raw.features.join(",") : null, raw.realtime_kind),
    updated_at: firstString(raw.updated, raw.last_update, raw.updated_at),
  };
}

/* Le PAN décrit la couverture tantôt par un objet, tantôt par une liste, et
   les noms de champs varient selon les endpoints. */
export function extractCoverage(dataset) {
  const zones = [
    ...asArray(dataset.covered_area),
    ...asArray(dataset.covered_areas),
    ...asArray(dataset.aom),
  ].filter((zone) => zone && typeof zone === "object");

  const seen = new Set();
  const coverage = [];
  for (const zone of zones) {
    const areaName = firstString(zone.name, zone.nom, zone.label);
    const insee = firstString(zone.insee, zone.insee_code, zone.code_insee,
      zone.city && zone.city.insee);
    const siren = firstString(zone.siren, zone.aom && zone.aom.siren);
    if (!areaName && !insee && !siren) continue;

    const key = (insee || "") + "|" + (areaName || "");
    if (seen.has(key)) continue;
    seen.add(key);

    coverage.push({
      area_name: areaName,
      area_type: firstString(zone.type, zone.area_type),
      insee_code: insee,
      siren,
      // géométrie seulement si le catalogue en fournit une ; sinon null
      geom: geoJsonToEwkt(zone.geometry || zone.geom || null),
      source: "transport.data.gouv.fr",
    });
  }
  return coverage;
}

/* GeoJSON → EWKT. On passe par du texte parce que la colonne est typée
   geometry : Postgres applique la fonction d'entrée du type, ce qui
   fonctionne quel que soit le schéma d'installation de PostGIS. */
export function geoJsonToEwkt(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  const ring = (coords) => "(" + coords
    .map((point) => Number(point[0]) + " " + Number(point[1]))
    .join(",") + ")";
  const polygon = (coords) => "(" + coords.map(ring).join(",") + ")";

  try {
    if (geometry.type === "Polygon") {
      if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) return null;
      return "SRID=4326;MULTIPOLYGON(" + polygon(geometry.coordinates) + ")";
    }
    if (geometry.type === "MultiPolygon") {
      if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) return null;
      return "SRID=4326;MULTIPOLYGON(" + geometry.coordinates.map(polygon).join(",") + ")";
    }
  } catch (error) {
    return null;      // géométrie illisible : on n'en fabrique pas une
  }
  return null;        // Point, LineString… hors périmètre d'une couverture
}

export function normalizeDataset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const panId = firstString(raw.id, raw.datagouv_id, raw.slug);
  const title = firstString(raw.title, raw.name);
  const dataType = firstString(raw.type, raw.data_type);
  // sans identifiant, sans titre ou sans type, la ligne n'est pas exploitable
  if (!panId || !title || !dataType) return null;

  const resources = asArray(raw.resources).map(normalizeResource).filter(Boolean);
  const formats = [...new Set(resources.map((r) => r.format).filter(Boolean))];
  const coverage = extractCoverage(raw);

  const aomSiren = firstString(
    raw.aom && raw.aom.siren,
    raw.covered_area && raw.covered_area.aom && raw.covered_area.aom.siren,
    coverage.map((zone) => zone.siren).find(Boolean));
  const aomName = firstString(
    raw.aom && raw.aom.name,
    raw.covered_area && raw.covered_area.aom && raw.covered_area.aom.name);

  const areaType = firstString(raw.covered_area && raw.covered_area.type);

  return {
    dataset: {
      pan_id: panId,
      slug: firstString(raw.slug),
      title,
      data_type: dataType,
      formats,
      licence: firstString(raw.licence, raw.license),
      publisher: firstString(
        raw.publisher && raw.publisher.name, raw.publisher,
        raw.organization && raw.organization.name, raw.organization),
      aom_siren: aomSiren,
      aom_name: aomName,
      national: areaType === "country" ||
        coverage.some((zone) => /^france$/i.test(zone.area_name || "")),
      page_url: firstString(raw.page_url, raw.url),
      resources,
      raw,
      pan_updated_at: firstString(raw.updated, raw.updated_at, raw.last_update),
    },
    coverage,
  };
}

/* Un jeu de données entre dans le périmètre s'il est rattaché à l'AOM, à une
   commune du territoire, ou si son intitulé le désigne explicitement. */
export function matchesScope(normalized, scopeKey) {
  const scope = SCOPES[scopeKey];
  if (!scope) return false;
  if (scopeKey === "france") return true;
  const {dataset, coverage} = normalized;

  if (dataset.aom_siren && scope.siren.includes(dataset.aom_siren)) return true;
  if (coverage.some((zone) => zone.siren && scope.siren.includes(zone.siren))) return true;
  if (coverage.some((zone) => zone.insee_code && scope.insee.includes(zone.insee_code))) return true;

  // le national couvre la MEL, mais l'inclure ici noierait le test de phase 0
  if (dataset.national) return false;

  const texte = [dataset.title, dataset.publisher, dataset.aom_name,
    ...coverage.map((zone) => zone.area_name)].filter(Boolean).join(" ");
  return scope.match.test(texte);
}

/* Point d'entrée de normalisation d'une réponse complète du catalogue. */
export function normalizeCatalog(payload, scopeKey) {
  const rows = Array.isArray(payload) ? payload
    : (payload && Array.isArray(payload.data) ? payload.data : []);
  const seen = rows.length;
  const kept = [];
  let rejected = 0;

  for (const row of rows) {
    const normalized = normalizeDataset(row);
    if (!normalized) { rejected += 1; continue; }
    if (!matchesScope(normalized, scopeKey)) continue;
    kept.push(normalized);
  }
  return {seen, kept, rejected};
}
