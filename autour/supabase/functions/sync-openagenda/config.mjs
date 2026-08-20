/* Configuration générique OpenAgenda.

   Les sources de production vivent dans `territory_sources`. Ce module ne
   conserve que les invariants du connecteur et le témoin Lille utilisé par le
   mode test historique. Aucun territoire de production n'est sélectionné ici.
*/

export const OPENAGENDA_TEST = Object.freeze({
  territory: "lille",
  agendaUID: "57621068",
  agendaSlug: "ville-de-lille",
  search: "Atelier porte-clef moule",
  eventUID: "78801027",
  expectedTitle: "Atelier porte-clef moule - Braderie des enfants 2026",
  expectedDate: "2026-09-05",
  expectedStartLocal: "10:00",
  expectedEndLocal: "17:00",
  expectedVenue: "Gare Saint Sauveur",
  horizonEnd: "2026-09-13T21:59:59.999Z",
});

export const OPENAGENDA_SYNC = Object.freeze({
  provider: "openagenda",
  relative: Object.freeze(["current", "upcoming"]),
  rollingHorizonDays: 30,
  orchestratorConcurrency: 2,
});

function requiredText(value, field) {
  const result = value == null ? "" : String(value).trim();
  if (!result) throw new Error(`source OpenAgenda sans ${field}`);
  return result;
}

function metadataObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function openAgendaSourceFromRegistry(sourceRow, territoryRow) {
  if (!sourceRow || !territoryRow) throw new Error("registre OpenAgenda incomplet");
  const metadata = metadataObject(sourceRow.metadata);
  const territory = requiredText(territoryRow.slug, "territoire");
  const agendaUID = requiredText(sourceRow.source_identifier, "agendaUID");
  const agendaSlug = requiredText(metadata.agenda_slug, "agendaSlug");
  if (String(sourceRow.provider) !== OPENAGENDA_SYNC.provider) {
    throw new Error(`provider OpenAgenda inattendu : ${sourceRow.provider}`);
  }
  if (!/^\d+$/.test(agendaUID)) throw new Error(`agendaUID OpenAgenda invalide : ${agendaUID}`);
  return Object.freeze({
    registryId: Number(sourceRow.id),
    territoryId: Number(territoryRow.id),
    provider: OPENAGENDA_SYNC.provider,
    territory,
    territoryName: requiredText(territoryRow.name, "nom de territoire"),
    territoryGroup: territoryRow.group_slug ? String(territoryRow.group_slug) : territory,
    agendaSlug,
    agendaUID,
    sourceAgenda: agendaSlug,
    sourceAgendaUid: agendaUID,
    officialName: requiredText(sourceRow.source_name, "source_name"),
    timezone: requiredText(territoryRow.timezone, "timezone"),
    priority: Number(sourceRow.priority) || 100,
    enabled: sourceRow.active === true && territoryRow.active === true,
  });
}

export function lilleTestSource() {
  return Object.freeze({
    registryId: null,
    territoryId: null,
    provider: OPENAGENDA_SYNC.provider,
    territory: OPENAGENDA_TEST.territory,
    territoryName: "Lille",
    territoryGroup: "mel",
    agendaSlug: OPENAGENDA_TEST.agendaSlug,
    agendaUID: OPENAGENDA_TEST.agendaUID,
    sourceAgenda: OPENAGENDA_TEST.agendaSlug,
    sourceAgendaUid: OPENAGENDA_TEST.agendaUID,
    officialName: "Ville de Lille",
    timezone: "Europe/Paris",
    priority: 10,
    enabled: true,
  });
}

export function openAgendaSyncPeriod(now = new Date()) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(start.getTime())) throw new TypeError("date de synchronisation invalide");
  const end = new Date(start.getTime() + OPENAGENDA_SYNC.rollingHorizonDays * 86_400_000);
  return {start: start.toISOString(), end: end.toISOString()};
}

export async function mapWithConcurrency(items, limit, worker) {
  const values = Array.from(items || []);
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, values.length || 1));
  const results = new Array(values.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {status: "fulfilled", value: await worker(values[index], index)};
      } catch (reason) {
        results[index] = {status: "rejected", reason};
      }
    }
  }
  await Promise.all(Array.from({length: concurrency}, () => runWorker()));
  return results;
}
