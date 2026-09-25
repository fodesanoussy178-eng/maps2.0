/* ===========================================================================
   CE QUI SORT D'AUTOUR, ET RIEN D'AUTRE

   Une réponse MCP part vers un service tiers, et de là vers une conversation.
   La règle est donc l'inverse de celle d'une API interne : rien ne sort par
   défaut. Chaque champ rendu est ÉCRIT ICI, un par un, et un contrôle final
   relit l'objet produit pour refuser tout ce qui ressemble à une donnée
   privée, à un secret ou à une preuve technique interne.

   POURQUOI UN CONTRÔLE EN PLUS D'UNE LISTE BLANCHE. La liste blanche protège
   tant qu'on la tient à jour ; le contrôle protège quand on l'oublie. Les deux
   coûtent quelques microsecondes et disent la même chose de deux façons — et
   c'est la seconde qui rattrapera l'ajout distrait d'un `raw_data` dans six
   mois.

   NE SORTENT JAMAIS : une adresse e-mail (même « publique » : elle appartient à
   quelqu'un), un identifiant d'utilisateur ou de créateur, un jeton, une clé,
   un SIRET ou SIREN (l'organisation sert à VÉRIFIER, pas à répondre), une
   empreinte de déduplication, une preuve de découverte, un compteur interne,
   un journal, une décision de modération.
   ======================================================================== */

/* Les clés refusées, par motif. Le motif sert au message d'erreur : un test qui
   échoue doit dire POURQUOI ce champ n'a rien à faire dehors. */
const INTERDITS = Object.freeze([
  [/(^|_)e?mail($|_)/i, "une adresse e-mail appartient à quelqu'un"],
  [/(^|_)(creator|created_by|created_for|user|uid|author_id|owner)($|_)/i, "identifiant de personne"],
  [/(^|_)(token|secret|apikey|api_key|service_role|password|bearer)($|_)/i, "secret"],
  [/(^|_)(siret|siren|rna|finess|finess_pm|finess_ege)($|_)/i,
    "identifiant d'organisation : il sert à vérifier, pas à répondre"],
  [/(^|_)(dedup_key|source_fingerprint|place_keys|raw_data|evidence|missing_evidence)($|_)/i,
    "preuve ou clé technique interne"],
  [/(^|_)(moderation|signalement|report_count|ip|ip_hash|session)($|_)/i, "donnée d'exploitation"],
  [/(^|_)(geom|announcement_provenance|provenance)($|_)/i, "structure interne"],
]);

export function auditer(valeur, chemin = "$") {
  if (valeur == null || typeof valeur !== "object") return valeur;
  if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => auditer(v, chemin + "[" + i + "]"));
    return valeur;
  }
  for (const cle of Object.keys(valeur)) {
    for (const [motif, motifRaison] of INTERDITS) {
      if (motif.test(cle))
        throw new Error("champ_interdit:" + chemin + "." + cle + " — " + motifRaison);
    }
    auditer(valeur[cle], chemin + "." + cle);
  }
  return valeur;
}

function texte(valeur, max = 240) {
  const t = String(valeur == null ? "" : valeur).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/* `Number(null)` vaut ZÉRO, et zéro est un nombre fini. Sans ce contrôle, une
   distance inconnue sortait en « 0 m » — c'est-à-dire « vous y êtes » — et une
   coordonnée absente en « 0, 0 », au large du golfe de Guinée. Trouvé sur
   `get_event` appelé sans position : la fiche annonçait « 0 m ». */
function nombreOuRien(valeur) {
  if (valeur == null || valeur === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

function coord(valeur) {
  const n = nombreOuRien(valeur);
  return n == null ? null : Math.round(n * 1e6) / 1e6;
}

function metres(valeur) {
  const n = nombreOuRien(valeur);
  return n == null ? null : Math.round(n);
}

/* ---- LA FIABILITÉ, DITE EN TROIS MOTS ----------------------------------
   `verified` : une source fiable l'affirme, et la date est certaine.
   `candidate` : Autour l'a trouvé mais ne l'a pas encore prouvé — il ne doit
   JAMAIS être présenté comme un fait.
   `cancelled` : la source dit annulé. Ce n'est pas un défaut de fiabilité,
   c'est une information, et elle passe devant le reste.

   Pour un événement, la certitude porte sur la DATE : c'est ce qui décide si
   quelqu'un se déplace pour rien. `date_confidence` vient de la base, qui la
   tient de la source. */
export function fiabiliteEvenement(ligne) {
  const confiance = String(ligne.date_confidence || "unknown");
  return {
    status: ligne.cancelled ? "cancelled" : (confiance === "exact" ? "verified" : "candidate"),
    date_confidence: confiance,
    source: ligne.event_source || ligne.primary_source || null,
    last_checked: ligne.last_synced_at || ligne.last_source_update || null,
  };
}

export function projeterEvenement(item, contexte = {}) {
  const ligne = item.ligne || item;
  const { moteurs, distance, seances, deepLink, cta, now } = contexte;
  const T = moteurs && moteurs.TEMPS;
  const canonique = item.canonical || {};
  const type = typeDEvenement(ligne, item, canonique);
  const sortie = {
    id: ligne.id,
    kind: "event",
    name: texte(canonique.title || ligne.title, 160),
    type,
    type_label: libelleType(type, moteurs),
    summary: texte(ligne.description, 200),
    date_label: T && typeof T.libelleDate === "function"
      ? texte(T.libelleDate(Object.assign({}, ligne, { start_at: ligne.start_at, end_at: ligne.end_at }),
          now == null ? Date.now() : now), 80) : null,
    start: ligne.start_at || null,
    end: ligne.end_at || null,
    timezone: ligne.timezone || "Europe/Paris",
    /* Les séances restent SÉPARÉES : « 14h00, 16h30, 20h00 » et jamais
       « 14h00–20h00 », qui décrirait une séance de six heures. */
    sessions: Array.isArray(seances) && seances.length
      ? seances.slice(0, 12).map((s) => ({ start: s.start_at, end: s.end_at || null }))
      : null,
    venue: texte(ligne.venue_name || ligne.place_name, 120),
    address: texte(ligne.address, 160),
    city: texte(ligne.city, 80),
    lat: coord(ligne.lat), lng: coord(ligne.lng),
    distance_m: metres(distance),
    price_text: texte(ligne.price_text, 80),
    is_free: ligne.is_free == null ? null : !!ligne.is_free,
    audience: texte(ligne.audience, 60),
    booking_url: ligne.booking_url || ligne.ticket_url || null,
    website: ligne.website || null,
    source_url: ligne.event_source_url || ligne.source_url || null,
    image: ligne.image_url
      ? { url: ligne.image_url, credit: texte(ligne.image_author, 80),
          license: texte(ligne.image_license, 80), source: ligne.image_source || null }
      : null,
    reliability: fiabiliteEvenement(ligne),
    deep_link: deepLink || null,
    cta: cta || null,
  };
  return auditer(sortie, "event");
}

/* « event » n'est pas un type : c'est le mot que la base emploie quand la
   source n'a rien dit. L'écrire dans une réponse ajoute du bruit et ne dit
   rien à personne. On prend donc, dans l'ordre : le genre d'événement publié,
   la catégorie de la source quand elle existe, un tag d'annonce qui décrit la
   nature (jamais « local », qui décrit la portée), et sinon rien du tout. */
const TYPES_VIDES = new Set(["event", "evenement", "événement", "autre", "", "local"]);

function typeDEvenement(ligne, item, canonique) {
  const candidats = [ligne.event_kind, ligne.category,
    ...(Array.isArray(ligne.announcement_tags) ? ligne.announcement_tags : []),
    item.categorie, canonique && canonique.category];
  for (const candidat of candidats) {
    const valeur = String(candidat || "").trim();
    if (valeur && !TYPES_VIDES.has(valeur.toLowerCase())) return valeur;
  }
  return null;
}

function libelleType(type, moteurs) {
  const TAXO = moteurs && moteurs.ANNONCES_TAXONOMIE;
  if (!TAXO || !type) return null;
  try {
    const libelles = TAXO.libelles([type]);
    return libelles && libelles[0] && libelles[0] !== type ? libelles[0] : null;
  } catch (e) { return null; }
}

/* ---- LIEUX -------------------------------------------------------------
   Un lieu d'Autour est publié : il a été vu par une source et rangé dans une
   famille. Sa fiabilité porte sur l'OUVERTURE, pas sur une date : c'est
   `availability.js` qui a tranché, et « horaires inconnus » est un état rendu
   tel quel — jamais traduit en « ouvert ». */
export function projeterLieu(item, contexte = {}) {
  const ligne = item.ligne || item;
  const { distance, deepLink, cta } = contexte;
  const dispo = item.disponibilite || {};
  const sortie = {
    id: ligne.id,
    kind: "place",
    name: texte(ligne.name, 160),
    type: ligne.family || item.categorie || null,
    type_label: texte(ligne.famille_label, 60),
    summary: texte(ligne.description, 200),
    address: texte(ligne.address, 160),
    city: texte(ligne.commune || ligne.city, 80),
    lat: coord(ligne.lat), lng: coord(ligne.lng),
    distance_m: metres(distance != null ? distance : ligne.distance_m),
    opening_status: dispo.status || (ligne.etat_horaire === "inconnu" ? "unknown" : ligne.etat_horaire) || "unknown",
    opening_label: texte(dispo.label, 80),
    opening_hours: texte(ligne.opening_hours, 160),
    website: ligne.official_url || null,
    image: ligne.image_url
      ? { url: ligne.image_url, credit: texte(ligne.image_author, 80),
          license: texte(ligne.image_license, 80), source: ligne.image_source || ligne.image_type || null }
      : null,
    reliability: {
      status: ligne.verification_status === "candidate" ? "candidate" : "published",
      opening_hours_known: !!(ligne.horaires_fiables || ligne.opening_hours),
      source: ligne.image_source === "wikimedia" ? "places" : "places",
      last_checked: ligne.updated_at || ligne.last_seen_at || null,
    },
    deep_link: deepLink || null,
    cta: cta || null,
  };
  return auditer(sortie, "place");
}

/* ---- POINTS DE SERVICE -------------------------------------------------
   LA DOCTRINE, APPLIQUÉE À LA SORTIE. Ce qu'on rend est un ENDROIT OÙ L'ON EST
   REÇU : un nom de point, une adresse, un service, des horaires, une distance.
   L'organisation n'apparaît que comme provenance de la vérification, et sans
   ses identifiants : ils servent à prouver l'identité, pas à répondre à
   quelqu'un qui cherche à manger ce soir.

   Deux points d'une même organisation sortent donc SÉPARÉMENT, avec leurs deux
   adresses. Rien ici ne regroupe par réseau, par téléphone ni par domaine. */
export function projeterPointDeService(structure, contexte = {}) {
  const { besoin, distance, deepLink, cta, couverture, moteurs } = contexte;
  const statut = String(structure.verificationStatus || "").toLowerCase();
  const confiance = Number(structure.sourceConfidence);
  const services = [...new Set([...(structure.services || [])])].slice(0, 8);
  const servicesLisibles = libellesDeServices(services, moteurs);
  const sortie = {
    id: structure.autourId || structure.id,
    kind: "service_point",
    name: texte(structure.officialName || structure.name, 160),
    /* Le réseau tel qu'AUTOUR le reconnaît dans son propre vocabulaire
       (`AutourAide.BESOINS[].reseaux`), et seulement s'il le reconnaît. Il sert
       à dire « c'est bien un point des Restos du Cœur » ; il ne sert jamais à
       fusionner deux adresses. */
    organisation: organisationDe(structure, moteurs),
    need: besoin || null,
    services,
    /* `food_bank` ou `administrative_assistance` sont les mots des SOURCES.
       Ce qu'une personne lit doit être le mot d'Autour — « Manger »,
       « Papiers / démarches » —, et c'est la taxonomie de Solidarité qui fait
       le pont, pas une table écrite ici. */
    service_labels: servicesLisibles.length ? servicesLisibles : null,
    address: texte(structure.address, 160),
    city: texte(structure.commune, 80),
    postal_code: texte(structure.postalCode, 12),
    lat: coord(structure.lat), lng: coord(structure.lng),
    distance_m: metres(distance),
    hours: texte(structure.openingHours, 160),
    opening_status: (structure.status && structure.status.value) || "unknown",
    next_distribution: structure.nextDistributionAt || null,
    phone: texte(structure.phone, 30),
    website: structure.officialUrl || structure.website || null,
    access_conditions: conditionsDe(structure, besoin, moteurs),
    reliability: {
      status: statut === "verified" || statut === "probable" ? "verified"
        : statut === "candidate" ? "candidate" : (structure.trustLevel === "verified_help" ? "verified" : "candidate"),
      confidence: Number.isFinite(confiance) ? Math.round(confiance * 100) / 100 : null,
      last_verified_at: structure.updatedAt || structure.lastSourceUpdate || null,
      source: structure.source || null,
      trust_level: structure.trustLevel || null,
    },
    coverage: couverture || null,
    deep_link: deepLink || null,
    cta: cta || null,
  };
  return auditer(sortie, "service_point");
}

function libellesDeServices(services, moteurs) {
  const TAXO = moteurs && moteurs.AIDE_TAXONOMIE;
  const AIDE = moteurs && moteurs.AIDE;
  if (!TAXO || !AIDE) return [];
  const vus = new Set();
  const libelles = [];
  for (const service of services) {
    const besoin = (TAXO.BESOINS || []).find((b) => (b.services || []).includes(service));
    if (!besoin || vus.has(besoin.id)) continue;
    vus.add(besoin.id);
    const libelle = (AIDE.BESOINS || []).find((b) => b.id === besoin.id);
    if (libelle && libelle.label) libelles.push(libelle.label);
  }
  return libelles;
}

function organisationDe(structure, moteurs) {
  const AIDE = moteurs && moteurs.AIDE;
  const nom = String(structure.officialName || structure.name || "");
  if (!AIDE || !nom) return null;
  for (const besoin of AIDE.BESOINS || []) {
    for (const motif of besoin.reseaux || []) {
      const trouve = nom.match(motif);
      if (trouve) return { name: texte(trouve[0], 80), role: "verification" };
    }
  }
  return null;
}

function conditionsDe(structure, besoin, moteurs) {
  const AIDE = moteurs && moteurs.AIDE;
  if (!AIDE || typeof AIDE.conditionDe !== "function") return null;
  try {
    const condition = AIDE.conditionDe(structure, besoin);
    if (!condition) return null;
    return texte(condition.label || condition.libelle || condition.id || condition, 120);
  } catch (e) { return null; }
}

export const CHAMPS = Object.freeze({
  evenement: Object.freeze(["id", "kind", "name", "type", "type_label", "summary", "date_label",
    "start", "end", "timezone", "sessions", "venue", "address", "city", "lat", "lng", "distance_m",
    "price_text", "is_free", "audience", "booking_url", "website", "source_url", "image",
    "reliability", "deep_link", "cta"]),
  lieu: Object.freeze(["id", "kind", "name", "type", "type_label", "summary", "address", "city",
    "lat", "lng", "distance_m", "opening_status", "opening_label", "opening_hours", "website",
    "image", "reliability", "deep_link", "cta"]),
  pointDeService: Object.freeze(["id", "kind", "name", "organisation", "need", "services", "address",
    "city", "postal_code", "lat", "lng", "distance_m", "hours", "opening_status", "next_distribution",
    "phone", "website", "access_conditions", "reliability", "coverage", "deep_link", "cta"]),
});

export { INTERDITS };
