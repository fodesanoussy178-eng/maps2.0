/* ===========================================================================
   Overpass, mutualisé au bord du réseau

   Chaque téléphone qui ouvrait Autour lançait sa propre requête Overpass vers
   une instance publique. Deux personnes du même quartier payaient deux fois la
   même chose ; en heure pleine, l'instance répond en cinq, dix ou vingt
   secondes, et parfois pas du tout. C'était la dépendance qui décidait du
   temps de démarrage à froid, et elle n'est ni à nous ni maîtrisable.

   Cette fonction met Overpass DERRIÈRE notre propre origine :

     · la réponse est mise en cache par le CDN pour la journée
       (`s-maxage=86400`), et servie périmée pendant une semaine pendant
       qu'elle se rafraîchit en fond (`stale-while-revalidate`) ;
     · la clé de cache est l'URL, donc la zone arrondie : tout un quartier
       partage la même entrée ;
     · la première personne d'une zone paie l'attente une fois, côté serveur,
       pour tout le monde et pour la semaine ;
     · une instance muette bascule sur la suivante sans que le client le sache.

   Si le relais tombe, le client conserve Google Places, DATAtourisme,
   Supabase, les jeux de zone et ses caches locaux. Il ne relance pas les mêmes
   instances publiques depuis chaque téléphone : cela doublerait seulement la
   panne et la consommation réseau.
   ======================================================================== */

export const config = { runtime: "edge" };

/* Uniquement des instances qui portent la planète entière. `overpass.osm.ch`
   figurait ici : c'est l'instance SUISSE. Elle répondait « zéro objet » en huit
   dixièmes de seconde à toute requête française, et cette réponse vide partait
   au CDN avec vingt-quatre heures de fraîcheur — un quartier entier servi vide
   à tout le monde pendant une journée. */
const SERVEURS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/* Une route ouverte sur Overpass serait un relais pour n'importe quelle
   requête. On n'accepte donc que la forme exacte que produit l'application :
   une lecture JSON, un groupe de `nwr`, une sortie bornée. Tout le reste est
   refusé — pas filtré, refusé. */
const FORME = /^\[out:json\]\[timeout:\d{1,2}\];\((?:nwr(?:\(around:\d{1,5},-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?\)|\(-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?\))\[[^\];]{1,400}\];){1,40}\);out center \d{1,4};$/;
const LONGUEUR_MAX = 4096;
const SORTIE_MAX = 400;
const DELAI_TOTAL_MS = 9000;          // l'enrichissement ne doit pas vivre 20 s
const DELAI_SERVEUR_MS = 7500;
const DECALAGE_SERVEUR_MS = 350;      // requêtes couvertures, sans triple rafale

function refus(message, statut) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8",
               "cache-control": statut >= 500 ? "no-store" : "public, max-age=60" },
  });
}

export default async function handler(requete) {
  const url = new URL(requete.url);
  const q = url.searchParams.get("q") || "";

  if (q.length > LONGUEUR_MAX) return refus("requête trop longue", 413);
  if (!FORME.test(q)) return refus("forme de requête non acceptée", 400);
  const sortie = Number((q.match(/out center (\d+);$/) || [])[1] || 0);
  if (!sortie || sortie > SORTIE_MAX) return refus("sortie non bornée", 400);

  const debut = Date.now();
  const controleurs = [];
  const attendre = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let termine = false;

  /* Une instance lente ne doit plus imposer sept secondes avant même que la
     suivante soit contactée. Les tentatives sont légèrement décalées ; la
     première réponse JSON exploitable gagne et annule les autres. */
  const tentatives = SERVEURS.map(async (serveur, index) => {
    if (index) await attendre(index * DECALAGE_SERVEUR_MS);
    if (termine) throw new Error("overpass_annule");
    const controleur = new AbortController();
    controleurs.push(controleur);
    const minuteur = setTimeout(() => controleur.abort(), DELAI_SERVEUR_MS);
    try {
      const r = await fetch(serveur, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        signal: controleur.signal,
      });
      if (!r.ok) throw new Error("overpass_" + r.status);
      const j = await r.json();
      if (!j || !Array.isArray(j.elements)) throw new Error("overpass_invalide");
      return { elements:j.elements, serveur };
    } finally { clearTimeout(minuteur); }
  });

  let gagnant = null;
  let minuteurTotal = null;
  const delaiTotal = new Promise((resolve, reject) => {
    minuteurTotal = setTimeout(() => reject(new Error("overpass_delai_total")), DELAI_TOTAL_MS);
  });
  const annulerAmont = () => {
    termine = true;
    controleurs.forEach(c => c.abort());
  };
  if (requete.signal) requete.signal.addEventListener("abort", annulerAmont, {once:true});
  try {
    gagnant = await Promise.race([
      Promise.any(tentatives),
      delaiTotal,
    ]);
  } catch (e) {
    console.warn("Autour /api/lieux : instances indisponibles", {
      duree_ms:Date.now()-debut, raison:e && e.message || "inconnue"
    });
  } finally {
    termine = true;
    clearTimeout(minuteurTotal);
    controleurs.forEach(c => c.abort());
    if (requete.signal) requete.signal.removeEventListener("abort", annulerAmont);
  }

  if (gagnant) {
    const vide = gagnant.elements.length === 0;
    return new Response(JSON.stringify({ elements: gagnant.elements }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        /* Une réponse vide valide est exploitable, mais reste fraîche moins
           longtemps qu'un quartier peuplé. Elle ne devient plus un faux 503. */
        "cache-control": vide
          ? "public, s-maxage=900, stale-while-revalidate=3600"
          : "public, s-maxage=86400, stale-while-revalidate=604800",
        "x-autour-source": "overpass",
        "x-autour-duration": String(Date.now()-debut),
      },
    });
  }

  /* Toutes muettes. On répond 503 sans le mettre en cache : le client retombe
     sur ce qu'il a (jeu rapide, cache local, données de zone) et retentera
     plus tard — il ne doit jamais rester devant un écran vide à cause de ça. */
  return refus("aucune instance Overpass disponible", 503);
}
