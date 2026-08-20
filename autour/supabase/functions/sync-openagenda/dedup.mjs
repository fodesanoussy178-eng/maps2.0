/* Miroir volontairement strict de public.event_dedup_key(). La base reste
   l'arbitre de la déduplication inter-sources : titre, coordonnées à trois
   décimales et heure UTC doivent coïncider ensemble. */

function withoutAccents(value) {
  return String(value ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function normalizedTitle(value) {
  return withoutAccents(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function postgresRound(value, decimals) {
  const factor = 10 ** decimals;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
  return rounded.toFixed(decimals);
}

export function eventDedupKey(title, latitude, longitude, startAt) {
  const normalized = normalizedTitle(title);
  if (latitude == null || longitude == null || startAt == null || startAt === "") return null;
  const lat = Number(latitude), lng = Number(longitude);
  const date = startAt ? new Date(startAt) : null;
  if (!normalized || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      !date || !Number.isFinite(date.getTime())) return null;
  const hour = date.toISOString().slice(0, 13).replace(/[-T:]/g, "");
  return [normalized, postgresRound(lat, 3), postgresRound(lng, 3), hour].join("|");
}
