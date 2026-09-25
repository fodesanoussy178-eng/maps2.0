const DIACRITIQUES = /[̀-ͯ]/g;

export const VERIFICATION_STATUSES = Object.freeze([
  "verified", "probable", "candidate", "uncertain", "rejected",
]);

export const SOURCE_RANKS = Object.freeze({
  official_structure: 1,
  official_government: 2,
  institutional: 3,
  public_directory: 4,
  data_partner: 5,
  credible_secondary: 6,
  lead_only: 7,
});

export const SOLIDARITY_NETWORKS = Object.freeze([
  "Restos du Cœur", "Croix-Rouge", "Secours populaire", "Secours catholique",
  "Emmaüs", "CCAS", "Mission Locale", "CIDFF", "épicerie solidaire",
  "accueil de jour", "centre d'hébergement",
]);

const WORDINGS = Object.freeze({
  food: ["aide alimentaire", "distribution alimentaire", "repas gratuit", "épicerie solidaire", "accueil de jour"],
  /* « FOYER » EST LE MOT LE PLUS COURANT, ET IL MANQUAIT.
     Les structures réelles de la zone testée s'appellent « CHRS », « foyer de
     jeunes travailleurs », « résidence sociale », « pension de famille » ou
     « accueil de nuit ». Aucune de ces requêtes n'était posée : la découverte
     cherchait « hébergement urgence » et ne voyait donc pas le parc social.
     Aucune exécution `housing` n'avait d'ailleurs jamais été lancée au
     25/09/2026 — toutes portaient sur `food`. */
  housing: ["hébergement urgence", "centre hébergement", "accueil de jour", "mise à l'abri",
            "foyer hébergement", "foyer jeunes travailleurs", "CHRS",
            "résidence sociale", "pension de famille", "accueil de nuit"],
  health: ["centre de santé solidaire", "soins gratuits", "permanence santé"],
  admin: ["aide démarches administratives", "accès aux droits", "permanence sociale"],
  clothing: ["vestiaire solidaire", "don vêtements", "aide vêtements"],
  hygiene: ["douche solidaire", "hygiène accueil de jour", "laverie solidaire"],
  employment: ["Mission Locale", "aide emploi", "insertion professionnelle"],
  students: ["aide étudiants", "épicerie solidaire étudiante", "aide alimentaire étudiants"],
  listening: ["écoute psychologique gratuite", "soutien psychologique", "permanence écoute"],
});

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(DIACRITIQUES, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function buildQueries(city, category = "food", networks = SOLIDARITY_NETWORKS) {
  const place = String(city || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 100);
  if (!place) return [];
  const generic = WORDINGS[category] || [String(category || "aide locale")];
  return [...new Set([
    ...generic.map((term) => `${term} ${place}`),
    ...networks.map((network) => `${network} ${place}`),
  ])].slice(0, 24);
}

/* ---------------------------------------------------------------------------
   UNE ADRESSE DE COURRIEL N'EST PAS UNE ADRESSE DE PAGE

   Mesuré le 25/09/2026. Trois candidats Restos du Cœur de Tourcoing ont été
   rejetés pour `page_injoignable`, avec ces source_url :

     https://ad59a.centre.tourcoing-virolois.restosducoeur.org
     https://ad59a.centre.tourcoing-epideme.restosducoeur.org
     https://ad59a.centre.tourcoing-orions.restosducoeur.org

   Ces hôtes n'existent pas. Les VRAIES adresses publiées par l'association
   départementale sont des COURRIELS de la même forme :

     ad59a.centre.tourcoing-virolois@restosducoeur.org

   Le modèle avait remplacé l'arobase par un point. La garde de lecture de page
   a fait son travail — rien de faux n'a été publié — mais le rejet disait
   « page injoignable », ce qui laissait croire à un site en panne plutôt qu'à
   une URL fabriquée. On reconnaît donc la forme, on refuse sans dépenser une
   lecture, et le motif dit la vérité.

   La règle est étroite à dessein : un sous-domaine qui contient à la fois un
   séparateur de boîte (`.centre.`, `.contact.`, `.accueil.`) et un tiret dans
   son dernier label est le motif d'un courriel, pas d'un hôte. On ne refuse
   jamais un sous-domaine ordinaire — `n-lille.secours-catholique.org` et
   `lillemetropole.croix-rouge.fr` passent, et ils sont réels.
--------------------------------------------------------------------------- */
const BOITES = /^(centre|contact|accueil|secretariat|info|infos|bureau|siege)$/;

export function urlDeriveeDunCourriel(url) {
  let host = "";
  try { host = new URL(String(url)).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return false; }
  const labels = host.split(".");
  /* Un hôte de courriel recomposé porte au moins quatre labels : la boîte, son
     suffixe, puis le domaine et son extension. */
  if (labels.length < 4) return false;
  return labels.slice(0, -2).some((label, index, sous) =>
    BOITES.test(label) && index + 1 < sous.length && sous[index + 1].includes("-"));
}

export function sourceType(url, officialDomain, city) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return "lead_only"; }
  const official = normalizeText(officialDomain).replace(/ /g, "");
  if (official && (host === official || host.endsWith(`.${official}`))) return "official_structure";
  /* LE SITE D'UNE COMMUNE EST UNE SOURCE OFFICIELLE, MÊME SANS « ville- ».
     `tourcoing.fr` est le site de la mairie de Tourcoing ; il était rangé en
     « source secondaire crédible », au même niveau qu'un blog. Conséquence
     mesurée : la page du CCAS sur le site de la ville — nom, adresse et
     service confirmés — plafonnait à « candidat » et n'était jamais publiée.
     On ne peut pas lister les 35 000 communes ; on compare le domaine au nom
     du territoire demandé, ce qui est exact et vaut pour toutes. */
  const commune = normalizeText(city).replace(/ /g, "-");
  if (commune && new RegExp(`(^|\\.)${commune.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(fr|com|eu|org)$`).test(host))
    return "official_government";
  if (/\.gouv\.fr$|(^|\.)service-public\.fr$/.test(host) || /(^|\.)(ville|mairie|metropole|departement|region)[.-]/.test(host))
    return "official_government";
  if (/restosducoeur\.org$|croix-rouge\.fr$|secourspopulaire\.fr$|secours-catholique\.org$|emmaus-france\.org$/.test(host))
    return "official_structure";
  if (/data\.gouv\.fr$|dora\.inclusion\.gouv\.fr$|annuaire.*public/.test(host)) return "public_directory";
  return "credible_secondary";
}

export function confidenceFor(source, identityEvidence = 0, serviceEvidence = 0) {
  const rank = SOURCE_RANKS[source] || 7;
  const sourceScore = Math.max(0.25, 1 - (rank - 1) * 0.11);
  return Math.round(Math.min(sourceScore, (identityEvidence + serviceEvidence) / 2) * 100) / 100;
}

export function verificationStatus(candidate) {
  const c = candidate || {};
  if (c.rejection_reason) return "rejected";
  if (!c.source_url || !c.name || !c.city) return "uncertain";
  const rank = SOURCE_RANKS[c.source_type] || 7;
  const identity = Number(c.identity_evidence || 0);
  const service = Number(c.service_evidence || 0);
  if (rank <= 3 && identity >= 0.8 && service >= 0.8) return "verified";
  if (rank <= 5 && identity >= 0.65 && service >= 0.65) return "probable";
  if (identity >= 0.45 || service >= 0.45) return "candidate";
  return "uncertain";
}

export function sourceFingerprint(url, name, address) {
  return [String(url || "").replace(/[?#].*$/, "").replace(/\/$/, ""), normalizeText(name), normalizeText(address)].join("|");
}

function distanceM(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return Infinity;
  const r = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*r/2) ** 2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lng-a.lng)*r/2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

/* ---------------------------------------------------------------------------
   DEUX ANTENNES NE SONT PAS UN DOUBLON

   Quatre centres des Restos du Cœur à Tourcoing — Bourgogne, Épidème, Orions,
   Virolois — partagent un réseau, un site, souvent un standard téléphonique.
   Ce sont quatre adresses différentes, et quelqu'un qui cherche à manger a
   besoin de la plus proche, pas d'une seule d'entre elles.

   Un identifiant officiel (SIRET, FINESS) tranche seul : il désigne un
   établissement. Rien d'autre ne tranche seul — surtout pas le téléphone, qui
   était jusqu'ici suffisant à lui tout seul pour fusionner. Il faut désormais
   une CONCORDANCE : la même identité (nom) et la même implantation (adresse
   ou 120 mètres). Le téléphone ne fait que renforcer, il ne décide plus.
--------------------------------------------------------------------------- */
export function samePlace(a, b) {
  const officialIds = ["siret", "finess", "institutional_id"];
  for (const key of officialIds) {
    if (a?.[key] && b?.[key]) return String(a[key]) === String(b[key]);
  }
  const sameName = normalizeText(a?.name) === normalizeText(b?.name);
  const adresseA = normalizeText(a?.address);
  const sameAddress = !!adresseA && adresseA === normalizeText(b?.address);
  const memeEndroit = sameAddress || distanceM(a, b) <= 120;
  if (sameName && memeEndroit) return true;
  /* Même téléphone ET même endroit : c'est le même guichet sous deux noms
     (« CCAS » et « Centre Communal d'Action Sociale »). Le téléphone seul,
     lui, ne dit que « même association ». */
  const phone = normalizeText(a?.phone).replace(/ /g, "");
  return !!phone && phone === normalizeText(b?.phone).replace(/ /g, "") && memeEndroit;
}

export function deduplicate(candidates, existing = []) {
  const accepted = [], duplicates = [];
  for (const candidate of candidates || []) {
    const found = [...existing, ...accepted].find((place) => samePlace(candidate, place));
    if (found) duplicates.push({candidate, duplicate_of: found.id || found.source_fingerprint || null});
    else accepted.push(candidate);
  }
  return {accepted, duplicates};
}

export function coverageAssessment({known = 0, verified = 0, sourceCount = 0, sourceFailures = 0} = {}) {
  const incomplete = known < 3 || verified < 2 || sourceCount < 2 || sourceFailures > 0;
  return {
    status: sourceFailures > 0 ? "unknown" : incomplete ? "incomplete" : "adequate",
    shouldDiscover: incomplete,
    score: Math.min(1, (Math.min(known, 5) / 5) * .35 + (Math.min(verified, 3) / 3) * .45 + (Math.min(sourceCount, 3) / 3) * .2),
  };
}

/* ---------------------------------------------------------------------------
   LA PREUVE, QUAND LE FOURNISSEUR N'EN DONNE PLUS

   L'agent reposait sur une garde simple : une URL n'est recevable que si
   l'outil de recherche l'a citée. Le diagnostic du 24 septembre a montré que
   cette garde ne peut PAS être satisfaite — l'endpoint `interactions` de
   Gemini ne rend aucune liste d'URL consultées. Son étape
   `google_search_result` ne contient que `search_suggestions` et une
   `signature` opaque de 91 ko. Résultat mesuré : 33 candidats, 33 rejets,
   quatre exécutions de suite, pour une raison qui n'était pas la bonne.

   ON NE DESSERRE PAS LA GARDE POUR AUTANT. Sans vérification, un modèle peut
   écrire « restosducoeur.org/tourcoing » et se citer lui-même : il
   fabriquerait sa propre preuve, et Autour publierait une adresse que
   personne n'a lue.

   On remplace donc « l'outil l'a citée » par quelque chose de plus fort :
   NOUS allons lire la page. Une URL est une preuve si elle répond, et si la
   page qu'elle rend parle bien de cette structure-là — son nom, ou son code
   postal, ou sa rue. C'est vérifiable, ça ne dépend d'aucun format de
   fournisseur, et ça reste vrai le jour où l'on changera de modèle.
--------------------------------------------------------------------------- */

/* Le texte lisible d'une page, sans balises ni scripts. Grossier et suffisant :
   on y cherche un nom propre et un code postal, pas du sens. */
export function texteDePage(html) {
  return normalizeText(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " "));
}

/* Les mots d'un nom qui identifient vraiment. « Les Restos du Cœur - Centre
   Tourcoing Bourgogne » contient « restos », « coeur », « tourcoing »,
   « bourgogne » ; « les », « du », « de » n'identifient rien. */
const MOTS_VIDES = new Set(["les","des","du","de","la","le","el","aux","au","et",
  "centre","antenne","association","comite","unite","locale","France","francais",
  "francaise","solidaire","social","sociale","ville","maison"]);

export function motsIdentifiants(nom) {
  return normalizeText(nom).split(" ")
    .filter((mot) => mot.length >= 4 && !MOTS_VIDES.has(mot));
}

/* ---------------------------------------------------------------------------
   CE QUE LA PAGE PROUVE RÉELLEMENT

   Trois niveaux, et ils ne se valent pas :
     · le nom ET une ancre géographique (code postal ou ville) → identité
       établie : cette page parle de CETTE structure, dans CETTE commune ;
     · le nom seul → la page parle de la structure, mais peut-être d'une autre
       antenne du même réseau. C'est une piste, pas une identité ;
     · rien → la page ne parle pas d'elle. Le modèle a proposé une URL qui ne
       soutient pas son candidat.

   Le service (« on y distribue des repas ») demande en plus qu'un mot du
   domaine apparaisse. Une page d'accueil de réseau national mentionne le nom
   et la ville sans rien dire du service rendu à cette adresse.
--------------------------------------------------------------------------- */
const MOTS_SERVICE = Object.freeze({
  food: ["alimentaire", "repas", "epicerie", "distribution", "colis", "panier", "restauration"],
  housing: ["hebergement", "abri", "logement", "accueil de nuit", "urgence"],
  health: ["sante", "soins", "medical", "consultation", "infirmier"],
  admin: ["demarches", "administratif", "droits", "permanence", "ecrivain public"],
  clothing: ["vetement", "vestiaire", "friperie"],
  hygiene: ["douche", "hygiene", "laverie", "lave linge"],
  employment: ["emploi", "insertion", "mission locale", "formation"],
  students: ["etudiant", "campus", "universitaire", "crous"],
  listening: ["ecoute", "psychologique", "soutien moral", "parole"],
});

export function preuveDansPage(texte, {nom, codePostal, ville, categorie} = {}) {
  const page = String(texte || "");
  if (!page) return {identite: 0, service: 0, raison: "page_vide"};

  const mots = motsIdentifiants(nom);
  const nomVu = mots.length > 0 && mots.filter((mot) => page.includes(mot)).length >= Math.min(2, mots.length);
  const cpVu = !!codePostal && page.includes(normalizeText(codePostal));
  const villeVue = !!ville && page.includes(normalizeText(ville));
  const ancre = cpVu || villeVue;

  const termes = MOTS_SERVICE[categorie] || [];
  const serviceVu = termes.some((terme) => page.includes(normalizeText(terme)));

  if (!nomVu) return {identite: 0, service: 0, raison: "nom_absent_de_la_page"};
  if (!ancre) return {identite: 0.5, service: serviceVu ? 0.5 : 0, raison: "commune_non_confirmee"};
  return {
    identite: 0.9,
    service: serviceVu ? 0.85 : 0.3,
    raison: serviceVu ? null : "service_non_affirme_par_la_page",
  };
}

export function publishable(candidate) {
  return ["verified", "probable"].includes(candidate?.verification_status || verificationStatus(candidate));
}
