/* Configuration des sources OpenAgenda.

   L'UID de l'agenda ne doit exister qu'ici. Le reste du connecteur reçoit
   cette configuration et reste réutilisable pour une autre source, sans
   modifier le navigateur.
*/

export const OPENAGENDA_SOURCES = Object.freeze({
  lille: Object.freeze({
    provider: "openagenda",
    territory: "lille",
    agendaSlug: "ville-de-lille",
    agendaUID: "57621068",
    sourceAgenda: "ville-de-lille",
    sourceAgendaUid: "57621068",
    officialName: "Ville de Lille",
    timezone: "Europe/Paris",
    enabled: true,
  }),
});

export const OPENAGENDA_TEST = Object.freeze({
  source: OPENAGENDA_SOURCES.lille,
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
  territory: "lille",
  relative: Object.freeze(["current", "upcoming"]),
  rollingHorizonDays: 30,
  braderieMinimumEnd: "2026-09-13T21:59:59.999Z",
  horizonTimezone: "Europe/Paris",
});

export function openAgendaSyncPeriod(now = new Date()) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(start.getTime())) throw new TypeError("date de synchronisation invalide");
  const rollingEnd = new Date(start.getTime() + OPENAGENDA_SYNC.rollingHorizonDays * 86_400_000);
  const minimumEnd = new Date(OPENAGENDA_SYNC.braderieMinimumEnd);
  return {
    start: start.toISOString(),
    end: new Date(Math.max(rollingEnd.getTime(), minimumEnd.getTime())).toISOString(),
  };
}

export function sourceOpenAgenda(code = "lille") {
  const source = OPENAGENDA_SOURCES[code];
  if (!source || !source.enabled) throw new Error(`source OpenAgenda inactive : ${code}`);
  return source;
}
