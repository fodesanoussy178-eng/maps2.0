/* BANC TEMPORAIRE — ce qui consomme les dix secondes d'Aide.

   Il tourne pendant le build Vercel, depuis le même réseau que le relais, et
   n'écrit rien : il mesure et il imprime. Quatre formes de la MÊME recherche
   d'Aide, sur chacune des trois instances Overpass, pour séparer ce qui coûte :

     tag      l'aire résolue par son tag ISO3166-1 — ce que fait la production
     id       la même aire, désignée par son identifiant (pas de balayage)
     sans     aucune aire — la borne `around` seule
     id1sel   l'aire par identifiant, mais un seul sélecteur au lieu de sept

   `tag` contre `sans` donne le coût total de l'aire ; `tag` contre `id` isole
   le balayage des aires ; `id` contre `id1sel` donne le coût par sélecteur.

   À SUPPRIMER une fois la mesure faite. */

const SERVEURS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const LAT = 50.7239, LNG = 3.1612;      /* Tourcoing, à 3 km de la Belgique */
const AIRE_FRANCE = 3602202162;          /* relation OSM 2202162 */
const SELECTEURS = [
  ['social_facility', 'food_bank|soup_kitchen|shelter|group_home|homeless_shelter|emergency_shelter|assisted_living|nursing_home|outreach|day_centre|clothing_bank|food_sharing'],
  ['amenity', 'food_bank|refugee_site|dormitory|social_facility|social_centre|community_centre|youth_centre|police|hospital|clinic|doctors|pharmacy|dentist|health_post|townhall|post_office|toilets|shower|public_bath'],
  ['office', 'association|ngo|charity|employment_agency'],
  ['community_centre', 'community_centre'],
  ['club', 'social|charity|sport|culture|youth'],
  ['government', 'employment_agency|social_welfare|public_service|register_office'],
  ['healthcare', 'centre|doctor|clinic|hospital|pharmacy|dentist|laboratory|physiotherapist|psychotherapist|counselling'],
];

function requete(prefixe, filtreAire, selecteurs) {
  const bloc = selecteurs
    .map(([k, v]) => `nwr(around:3000,${LAT},${LNG})${filtreAire}["${k}"~"^(${v})$"];`).join("");
  return `[out:json][timeout:25];${prefixe}(${bloc});out center 180;`;
}
const FORMES = {
  tag:    requete('area["ISO3166-1"="FR"]->.fr;', "(area.fr)", SELECTEURS),
  id:     requete(`area(${AIRE_FRANCE})->.fr;`,   "(area.fr)", SELECTEURS),
  sans:   requete("",                              "",         SELECTEURS),
  id1sel: requete(`area(${AIRE_FRANCE})->.fr;`,   "(area.fr)", SELECTEURS.slice(1, 2)),
};

async function mesurer(serveur, q) {
  const debut = Date.now();
  try {
    const r = await fetch(serveur, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded",
                "user-agent": "Autour/banc (+https://autour.eu/)"},
      body: "data=" + encodeURIComponent(q),
      signal: AbortSignal.timeout(30000),
    });
    const texte = await r.text();
    let n = null;
    try { n = (JSON.parse(texte).elements || []).length; } catch (e) { n = "—"; }
    return {ms: Date.now() - debut, statut: r.status, elements: n};
  } catch (e) {
    return {ms: Date.now() - debut, statut: "ÉCHEC", elements: String(e && e.name || e)};
  }
}

console.log("\n════════ BANC OVERPASS — recherche d'Aide, Tourcoing ════════");
for (const [nom, q] of Object.entries(FORMES)) {
  console.log(`\n── ${nom}  (${q.length} caractères)`);
  for (const s of SERVEURS) {
    const r = await mesurer(s, q);
    console.log("   " + new URL(s).host.padEnd(26) +
      String(r.ms).padStart(6) + " ms   statut " + String(r.statut).padEnd(7) +
      "  éléments " + r.elements);
  }
}
console.log("\n════════ fin du banc ════════\n");
