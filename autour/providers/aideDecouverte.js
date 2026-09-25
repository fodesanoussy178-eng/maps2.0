(function (root) {
  "use strict";

  /* ===================================================================
     LA DÉCOUVERTE LOCALE, ENFIN SERVIE À L'ÉCRAN

     LE DÉFAUT QUE CE FICHIER CORRIGE, MESURÉ LE 25/09/2026.

     `local_discovery` cherche, vérifie et publie. La base contenait ce
     jour-là 55 candidats pour Tourcoing, dont un VÉRIFIÉ et rattaché à un
     lieu — le CCAS de Tourcoing, `service_categories` = `administrative_
     assistance, food, meals`, confiance 0,88. La fonction de lecture publique
     `local_discovery_nearby` existait, était accordée à `anon`, et rendait
     bien cette ligne.

     Personne ne l'appelait. Aucun fichier du client ne nommait cette
     fonction : ni `app.js`, ni un provider, ni `/api`. La chaîne
     « trouvé → candidat → vérifié → publié » s'arrêtait donc juste avant
     l'écran, et Solidarité > Manger affichait « Aucune structure fiable
     trouvée » alors qu'une structure vérifiée existait en base.

     CE QUE CE FICHIER FAIT, ET RIEN DE PLUS. Il traduit une ligne de
     `local_discovery_nearby` vers le contrat `AideStructure`. Il ne décide
     pas qu'une structure aide : `service_categories` part dans `services`,
     et c'est `AutourAideClassement` — donc la taxonomie — qui tranche.

     LE PIÈGE MESURÉ. Passer la ligne brute au normaliseur PERD le service :
     le contrat lit `services` / `service_types`, jamais `service_categories`.
     Mesuré sur le CCAS : sans cette traduction, `fiable(manger)` rend `false`
     et la structure reste invisible, alors que tout le reste est bon. C'est
     très exactement le point de perte que ce fichier existe pour fermer.
     =================================================================== */

  const AIDE = () => root.AutourAideStructures;
  const texte = (v) => String(v == null ? "" : v).trim();
  const nombre = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  /* Une confiance de candidat est écrite en base comme `numeric` : PostgREST
     la rend en chaîne (« 0.880 »). La convertir ici évite que le contrat la
     lise comme un texte et retombe sur la confiance par défaut de la source. */
  function confiance(ligne) {
    const n = nombre(ligne && ligne.confidence);
    if (n == null) return null;
    return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
  }

  /* `entity_status` est le vocabulaire de la découverte : `active`,
     `temporarily_closed`, `inactive`, `unknown`. Le contrat `AideStructure`
     attend `open` / `closed` / `permanently_closed` / `unknown`. On traduit,
     et `unknown` reste `unknown` : ne pas savoir n'est pas être ouvert. */
  function statut(ligne) {
    const brut = texte(ligne && ligne.entity_status).toLowerCase();
    if (brut === "active") return "open";
    if (brut === "temporarily_closed") return "closed";
    if (brut === "inactive") return "permanently_closed";
    return "unknown";
  }

  function details(ligne) {
    const p = ligne || {};
    const services = Array.isArray(p.service_categories) ? p.service_categories : [];
    const verifiee = texte(p.verification_status).toLowerCase() === "verified";
    return {
      source: "local_discovery",
      aideStructure: true,
      id: p.id, autourId: p.id,
      name: texte(p.name), officialName: texte(p.name),
      lat: nombre(p.lat), lng: nombre(p.lng),
      address: texte(p.address),
      postalCode: texte(p.postal_code),
      commune: texte(p.city),
      category: texte(p.category) || "asso",
      categories: texte(p.category) ? [texte(p.category)] : [],
      /* Les catégories de service publiées par la découverte SONT des
         services déclarés : une page officielle a été lue et le service y a
         été vu. Elles n'entrent pas comme catégories de lieu — ce serait
         confondre « ce que la structure fait » avec « ce qu'elle est ». */
      services,
      service_types: services,
      phone: texte(p.phone),
      website: texte(p.official_url),
      officialUrl: texte(p.official_url) || null,
      status: {value: statut(p), confidence: confiance(p) ?? 0,
               updatedAt: p.last_verified_at || null},
      /* La fraîcheur d'une fiche découverte est la date de sa DERNIÈRE
         vérification, pas celle de son écriture : c'est la seule qui dise
         quand un humain ou un lecteur de page a revu le service. */
      updatedAt: p.last_verified_at || null,
      lastSourceUpdate: p.last_verified_at || null,
      sourceConfidence: confiance(p) ?? (verifiee ? .8 : .6),
      sourceRefs: {autourId: p.id},
      provenance: [{
        source: "local_discovery", id: p.id, url: texte(p.official_url) || null,
        updatedAt: p.last_verified_at || null, confidence: confiance(p) ?? .6,
      }],
      /* Ce que la découverte sait de plus et qu'aucune autre source ne donne :
         la prochaine distribution annoncée, et la raison d'une fermeture
         temporaire. Conservés tels quels ; l'écran décide s'il les montre. */
      nextDistributionAt: p.next_distribution_at || null,
      reopensAt: p.reopens_at || null,
      closureReason: texte(p.closure_reason) || null,
      verificationStatus: texte(p.verification_status) || null,
    };
  }

  function normaliser(ligne) {
    if (!AIDE()) return null;
    const p = details(ligne);
    if (!p.name || p.lat == null || p.lng == null) return null;
    const structure = AIDE().normaliser(p);
    if (!structure) return null;
    /* Le normaliseur ne connaît pas ces trois champs : on les repose après
       lui plutôt que d'élargir un contrat partagé par cinq inventaires. */
    return Object.assign(structure, {
      nextDistributionAt: p.nextDistributionAt,
      reopensAt: p.reopensAt,
      closureReason: p.closureReason,
      verificationStatus: p.verificationStatus,
    });
  }

  /* `lignes` est ce que `local_discovery_nearby` a rendu. Ce provider ne fait
     aucun appel réseau lui-même : c'est `app.js` qui tient le client Supabase
     en lecture, comme pour `lieux_explorer`. */
  async function nearby(lat, lng, options) {
    const o = options || {};
    const rayon = Math.min(20000, Math.max(500, Number(o.radius) || 15000));
    return (o.records || []).map(normaliser).filter(Boolean)
      .filter((structure) => AIDE().distanceM({lat, lng}, structure) <= rayon);
  }

  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    aideDecouverte: Object.freeze({normaliser, nearby, details}),
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
