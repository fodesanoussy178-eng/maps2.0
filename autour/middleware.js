/* ===========================================================================
   Savoir où est la personne AVANT que la page ne s'exécute

   À froid — nouveau téléphone, aucun localStorage — Autour ne savait pas où
   elle était. Il fallait attendre `navigator.geolocation` : une demande de
   permission, puis un point GPS. Entre deux cents millisecondes et huit
   secondes, et très souvent jamais, parce que la permission est refusée. Tant
   que ce point n'arrivait pas, aucune proposition ne pouvait être calculée :
   « autour de toi » suppose un « toi » quelque part.

   Vercel connaît déjà la ville approximative de qui demande la page — c'est
   dans les en-têtes de la requête, dérivé de l'adresse IP. On la dépose donc
   dans un cookie, sur la réponse qui porte `index.html` elle-même. Le script
   de la page le lit à l'analyse, sans un seul aller-retour de plus et sans
   rien demander à personne.

   Ce n'est pas de la géolocalisation : c'est la ville, à quelques kilomètres
   près, et le code le dit (`precision: "ville"`). Ça suffit à proposer un
   quartier ; ça ne suffit pas à dire « à 4 minutes à pied », et l'application
   ne le prétend pas tant que le vrai point n'est pas arrivé.

   Aucune donnée n'est stockée côté serveur, rien n'est journalisé, le cookie
   n'est pas un identifiant : il porte deux nombres et un nom de ville, il
   vaut une heure, et il est lisible par le script de la page (c'est tout son
   intérêt) — donc surtout pas `HttpOnly`.
   ======================================================================== */

export const config = {
  runtime: "edge",
  // uniquement le document : ni les modules, ni les images, ni /api
  matcher: ["/", "/index.html", "/l/:chemin*", "/e/:chemin*"],
};

const UNE_HEURE = 3600;

function nombre(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function middleware(requete) {
  const h = requete.headers;
  const lat = nombre(h.get("x-vercel-ip-latitude"));
  const lng = nombre(h.get("x-vercel-ip-longitude"));

  const reponse = new Response(null, { headers: { "x-middleware-next": "1" } });
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return reponse;                       // rien de fiable : on ne dit rien

  // le nom arrive encodé (« Saint-Étienne » → « Saint-%C3%89tienne »)
  let ville = "";
  try { ville = decodeURIComponent(h.get("x-vercel-ip-city") || ""); } catch (e) { ville = ""; }

  const charge = JSON.stringify({
    lat: Math.round(lat * 1e4) / 1e4,     // ~11 m : c'est déjà plus précis que
    lng: Math.round(lng * 1e4) / 1e4,     // ne l'est la géolocalisation par IP
    ville,
    pays: h.get("x-vercel-ip-country") || "",
    precision: "ville",
  });

  reponse.headers.set("set-cookie",
    "autour_geo=" + encodeURIComponent(charge) +
    "; Path=/; Max-Age=" + UNE_HEURE + "; SameSite=Lax; Secure");
  return reponse;
}
