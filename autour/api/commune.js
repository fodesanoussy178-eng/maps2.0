/* ===========================================================================
   Nominatim, mutualisé au bord du réseau

   Même problème qu'Overpass, en plus net : Nominatim demande explicitement
   qu'on n'envoie pas de trafic massif depuis des clients, et sa politique
   d'usage plafonne à une requête par seconde. Chaque ouverture d'Autour en
   lançait une — parfois deux.

   Le nom d'une commune ne change pas. On le met donc en cache un mois, et le
   quartier entier partage la même entrée grâce à l'arrondi des coordonnées.
   Le client n'a plus besoin d'attendre Nominatim pour afficher quoi que ce
   soit : le cookie posé par le middleware lui donne déjà le nom de la ville,
   et cette route ne fait que le préciser.
   ======================================================================== */

export const config = { runtime: "edge" };

const DELAI_MS = 8000;

/* `Number(null)` vaut zéro, et `Number("")` aussi : sans le premier test, une
   coordonnée absente devenait le point (0, 0) et Nominatim était interrogé
   pour le golfe de Guinée. Une valeur manquante se refuse, elle ne
   s'interprète pas. */
function nombre(v, max) {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

export default async function handler(requete) {
  const url = new URL(requete.url);
  const lat = nombre(url.searchParams.get("lat"), 90);
  const lng = nombre(url.searchParams.get("lng"), 180);
  if (lat == null || lng == null)
    return new Response(JSON.stringify({ erreur: "coordonnées invalides" }),
      { status: 400, headers: { "content-type": "application/json" } });

  // ~1 km : deux personnes du même quartier partagent la même entrée de cache
  const rLat = lat.toFixed(2), rLng = lng.toFixed(2);

  try {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=" +
      rLat + "&lon=" + rLng,
      { headers: { "accept-language": "fr",
                   // la politique de Nominatim demande de s'identifier
                   "user-agent": "Autour/1.0 (https://autour.eu)" },
        signal: AbortSignal.timeout ? AbortSignal.timeout(DELAI_MS) : undefined });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const a = j.address || {};
    const nom = a.city || a.town || a.village || a.municipality || a.county || "";
    return new Response(JSON.stringify({
      commune: nom, pays: (a.country_code || "").toUpperCase(),
    }), { headers: {
      "content-type": "application/json; charset=utf-8",
      // un mois : le nom d'une ville n'est pas une donnée volatile
      "cache-control": "public, s-maxage=2592000, stale-while-revalidate=2592000",
    }});
  } catch (e) {
    return new Response(JSON.stringify({ commune: "" }), {
      status: 503,
      headers: { "content-type": "application/json",
                 "cache-control": "public, max-age=60" },
    });
  }
}
