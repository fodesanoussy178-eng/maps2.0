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

   Le client garde son chemin direct vers Overpass en secours : en local, sur
   une préproduction sans fonctions, ou si cette route tombe, l'application
   continue exactement comme avant.
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
const DELAI_MS = 20000;               // côté serveur on peut attendre : c'est
                                      // le CDN qui répondra aux suivants

function refus(message, statut) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8",
               "cache-control": "public, max-age=60" },
  });
}

export default async function handler(requete) {
  const url = new URL(requete.url);
  const q = url.searchParams.get("q") || "";

  if (q.length > LONGUEUR_MAX) return refus("requête trop longue", 413);
  if (!FORME.test(q)) return refus("forme de requête non acceptée", 400);
  const sortie = Number((q.match(/out center (\d+);$/) || [])[1] || 0);
  if (!sortie || sortie > SORTIE_MAX) return refus("sortie non bornée", 400);

  const arret = AbortSignal.timeout ? AbortSignal.timeout(DELAI_MS) : undefined;

  for (const serveur of SERVEURS) {
    try {
      const r = await fetch(serveur, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        signal: arret,
      });
      if (!r.ok) continue;                       // 429, 504 : au suivant
      const j = await r.json();
      if (!j || !Array.isArray(j.elements)) continue;
      /* Une réponse vide n'est jamais mise en cache. Elle peut être vraie — un
         hameau sans commerce — mais elle peut aussi venir d'une instance
         incomplète ou tronquée, et la garder un jour coûterait un quartier
         entier. On essaie la suivante ; si toutes disent vide, on répond 503
         avec une minute de cache, et le client garde ce qu'il a. */
      if (!j.elements.length) continue;
      return new Response(JSON.stringify({ elements: j.elements }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          /* Un jour de fraîcheur, une semaine de survie. Une boulangerie ne
             déménage pas dans la journée ; et une donnée d'hier vaut
             infiniment mieux qu'un écran vide pendant qu'on la rafraîchit. */
          "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800",
          "x-autour-source": "overpass",
        },
      });
    } catch (e) { /* instance muette : on essaie la suivante */ }
  }

  /* Toutes muettes. On répond 503 avec un cache court : le client retombe sur
     ce qu'il a (jeu rapide, cache local, données de zone) et retentera plus
     tard — il ne doit jamais rester devant un écran vide à cause de ça. */
  return refus("aucune instance Overpass disponible", 503);
}
