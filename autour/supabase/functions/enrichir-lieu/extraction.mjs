/* ---------------------------------------------------------------------------
   Ce qu'on demande, ce qu'on accepte de croire

   Ce module ne parle à personne : ni réseau, ni base, ni environnement. Il
   fabrique l'invite, classe les sources citées, et transforme la réponse d'un
   modèle en faits — ou en rien. C'est la partie qui décide, donc c'est la
   partie qui doit être éprouvable sans clé et sans quota, depuis `node --test`.

   TROIS RÈGLES, ET AUCUNE N'A D'EXCEPTION

   1. UNE DONNÉE SANS SOURCE N'EXISTE PAS. Le modèle peut écrire ce qu'il veut ;
      si l'API n'a cité aucune page d'ancrage, tout est jeté. On ne garde pas
      « la partie plausible ».

   2. ON N'INVENTE JAMAIS CE QUI MANQUE. Un horaire absent reste absent. Une
      colonne nulle veut dire « on ne sait pas », et « on ne sait pas » n'est
      pas « non ». C'est la règle de `donnees.js`, et elle vaut ici avec
      d'autant plus de force que la source est un modèle de langage.

   3. LA PROVENANCE DÉCIDE DU POUVOIR. Une page officielle récente a le droit
      d'écraser un `opening_hours` OpenStreetMap ancien — c'est tout l'intérêt
      de cette source. Un blog, un annuaire ou un agrégateur n'ont jamais ce
      droit, quelle que soit leur assurance. Le classement des sources n'est
      donc pas une décoration : c'est le mécanisme de sécurité.
--------------------------------------------------------------------------- */

/* ====================================================================== */
/*  L'identité d'un lieu                                                  */
/* ====================================================================== */

/* Les lieux d'Autour viennent d'OpenStreetMap, de Google ou d'une
   publication : aucun identifiant commun, et celui d'OSM change quand un
   contributeur remplace un nœud par un contour. La clé est donc calculée à
   partir de ce qui ne bouge pas — le nom normalisé et la position arrondie —
   exactement comme la déduplication reconnaît deux fois le même lieu.

   Quatre décimales valent une dizaine de mètres : assez fin pour distinguer
   deux commerces mitoyens, assez grossier pour que le même lieu relevé par
   deux sources tombe sur la même clé. */
const ARTICLES = /\b(le|la|les|l|un|une|des|du|de|d|au|aux|the|a)\b/g;
const DIACRITIQUES = new RegExp("[\\u0300-\\u036f]", "g");

export function normaliserNom(valeur) {
  return String(valeur ?? "")
    .normalize("NFD").replace(DIACRITIQUES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(ARTICLES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* `Number(null)` vaut ZÉRO, et zéro est un nombre fini : sans le test
   d'absence, un lieu sans coordonnées recevrait la clé du point (0, 0), au
   large du golfe de Guinée — et tous les lieux sans position partageraient le
   même enrichissement. */
function coordonnee(valeur) {
  if (valeur == null || String(valeur).trim() === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

export function cleLieu(nom, lat, lng) {
  const n = normaliserNom(nom);
  if (n.length < 2) return null;
  const y = coordonnee(lat), x = coordonnee(lng);
  if (y == null || x == null) return null;
  return `${n.replace(/ /g, "-")}@${y.toFixed(4)},${x.toFixed(4)}`;
}

/* ====================================================================== */
/*  Le classement des sources                                             */
/* ====================================================================== */

/* L'ordre est celui du produit, et il se lit de gauche à droite : site
   officiel du lieu, agenda officiel du lieu, billetterie du lieu, site
   municipal ou institutionnel, et le reste en dernier recours. */
export const PRIORITES = Object.freeze([
  "site_officiel", "agenda_officiel", "billetterie_officielle",
  "institutionnel", "tiers",
]);

const RANG_PRIORITE = Object.freeze(
  Object.fromEntries(PRIORITES.map((p, i) => [p, i])));

/* Ces mots décrivent une CATÉGORIE, pas une identité. « musee-picasso.fr »
   appartient au musée Picasso ; « musee.fr » n'appartient à aucun musée en
   particulier, et laisser « musee » servir de preuve d'appartenance ferait
   passer n'importe quel annuaire pour le site officiel du lieu. */
const MOTS_GENERIQUES = new Set([
  "musee", "musees", "theatre", "cinema", "cinemas", "piscine", "mairie",
  "centre", "maison", "palais", "parc", "jardin", "salle", "espace",
  "complexe", "stade", "hotel", "restaurant", "brasserie", "chateau",
  "eglise", "bibliotheque", "mediatheque", "galerie", "atelier", "ferme",
  "marche", "halle", "halles", "place", "gare", "office", "tourisme",
  "culture", "sport", "sports", "club", "association", "ville", "commune",
  "france", "paris", "saint", "sainte", "notre", "dame",
]);

/* Un site institutionnel se reconnaît à son domaine, pas à son contenu. La
   liste est délibérément courte et vise des FORMES de domaine françaises :
   elle ne nomme aucune ville — une ville est une donnée, jamais une condition
   dans le code. */
const FORMES_INSTITUTIONNELLES = [
  /\.gouv\.fr$/, /\.fr\.gouv$/, /\.cnrs\.fr$/, /\.culture\.fr$/,
  /(^|[.-])mairie([.-]|$)/, /(^|[.-])ville([.-]|$)/, /(^|[.-])villede/,
  /(^|[.-])cc[.-]/, /(^|[.-])ca[.-]/, /(^|[.-])agglo/, /agglo([.-]|$)/,
  /metropole/, /departement/, /(^|[.-])cd\d{2}([.-]|$)/, /(^|[.-])region/,
  /(^|[.-])ot[.-]/, /officedetourisme/, /tourisme([.-]|$)/,
  /(^|[.-])prefecture/, /academie/, /\.education\.fr$/,
];

/* Les plateformes de billetterie tierces. Y voir la « billetterie officielle »
   du lieu serait une erreur de degré : ce sont des revendeurs, ils publient ce
   qu'on leur donne, et leurs pages survivent souvent à l'événement. */
const PLATEFORMES_BILLETTERIE = [
  "billetweb", "weezevent", "helloasso", "fnacspectacles", "ticketmaster",
  "digitick", "shotgun", "mapado", "yurplan", "placeminute", "seetickets",
  "dice.fm", "eventbrite", "billetreduc", "ticketac",
];

const CHEMIN_BILLETTERIE = /billet|ticket|reserv|boutique/i;
const CHEMIN_AGENDA =
  /agenda|evenement|événement|sortir|programm|exposition|saison|spectacle|actualit/i;

function hote(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return {host: u.hostname.toLowerCase().replace(/^www\./, ""), chemin: u.pathname};
  } catch {
    return null;
  }
}

/* Le domaine, débarrassé de ses points et de ses tirets, pour y chercher un
   nom de lieu écrit d'une traite (« palaisdesbeauxarts.fr »). */
function noyauDomaine(host) {
  const labels = host.split(".");
  // on retire l'extension, et « co » de « co.uk » et compagnie
  const utiles = labels.slice(0, Math.max(1, labels.length - 1))
    .filter((l) => l !== "co" && l !== "com");
  return utiles.join("").replace(/[^a-z0-9]/g, "");
}

/* Le nom écrit d'une traite. DEUX formes, et il en faut deux : un domaine
   écrit « palaisdesbeauxarts.fr » garde les articles que la normalisation
   retire, tandis qu'on peut aussi croiser « theatrenord » là où le nom dit
   « Théâtre du Nord ». Comparer les deux coûte une concaténation et évite de
   rater la moitié des sites officiels. */
function formesCompactes(nom) {
  const sansAccent = String(nom ?? "")
    .normalize("NFD").replace(DIACRITIQUES, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [sansAccent, normaliserNom(nom).replace(/ /g, "")]
    .filter((f) => f.length >= 5);
}

/* Le domaine appartient-il au lieu lui-même ? Deux preuves acceptées, et une
   seule suffit : le nom écrit d'une traite, ou un mot distinctif — assez long
   pour ne pas être un hasard, et qui ne soit ni générique ni le nom de la
   commune. Sans quoi le domaine de la ville deviendrait le site officiel de
   tout ce qui s'y trouve. */
export function domaineDuLieu(host, nom, commune) {
  const noyau = noyauDomaine(host);
  if (!noyau) return false;
  const normalise = normaliserNom(nom);
  if (!normalise) return false;
  if (formesCompactes(nom).some((forme) => noyau.includes(forme))) return true;

  const communeNormalisee = new Set(normaliserNom(commune).split(" ").filter(Boolean));
  return normalise.split(" ").some((mot) =>
    mot.length >= 6 && !MOTS_GENERIQUES.has(mot) && !communeNormalisee.has(mot) &&
    noyau.includes(mot));
}

/* LE DOMAINE DE LA COMMUNE EST INSTITUTIONNEL, ET AUCUNE VILLE N'EST ÉCRITE
   ICI POUR AUTANT.

   Une mairie française publie sur un domaine qui porte le nom de la commune.
   On ne peut pas les énumérer, et il ne faut pas : le nom de la commune est
   une DONNÉE, celle du lieu qu'on interroge. On la compare, on ne la code
   pas. */
function domaineDeLaCommune(host, commune) {
  const nom = normaliserNom(commune).replace(/ /g, "");
  if (nom.length < 3) return false;
  return host.split(".").some((label) => label.replace(/[^a-z0-9]/g, "").includes(nom));
}

export function prioriteSource(url, contexte) {
  const ctx = contexte || {};
  const decoupe = hote(url);
  if (!decoupe) return null;
  const {host, chemin} = decoupe;

  if (domaineDuLieu(host, ctx.nom, ctx.commune)) {
    if (CHEMIN_BILLETTERIE.test(chemin)) return "billetterie_officielle";
    if (CHEMIN_AGENDA.test(chemin)) return "agenda_officiel";
    return "site_officiel";
  }
  if (PLATEFORMES_BILLETTERIE.some((p) => host.includes(p))) return "tiers";
  if (FORMES_INSTITUTIONNELLES.some((forme) => forme.test(host)) ||
      domaineDeLaCommune(host, ctx.commune)) {
    return CHEMIN_AGENDA.test(chemin) ? "agenda_officiel" : "institutionnel";
  }
  return "tiers";
}

/* Les sources citées, classées, la meilleure en tête. */
export function classerSources(sources, contexte) {
  const vues = new Set();
  const sorties = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const url = String((source && source.url) || "");
    const priorite = prioriteSource(url, contexte);
    if (!priorite || vues.has(url)) continue;
    vues.add(url);
    sorties.push({
      url,
      titre: String((source && source.titre) || "").slice(0, 160),
      priorite,
    });
  }
  sorties.sort((a, b) => RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite]);
  return sorties;
}

/* LE DROIT D'ÉCRASER OPENSTREETMAP.

   C'est la décision la plus lourde de ce module, et elle tient en une ligne :
   seule une source qui appartient au lieu ou à une institution peut le faire.
   Un agrégateur qui affirme « ouvert de 9h à 19h » avec aplomb ne l'obtient
   jamais — et c'est précisément parce qu'ils l'affirment tous avec aplomb que
   la règle porte sur la PROVENANCE et non sur la formulation. */
const AUTORISEES_A_ECRASER = new Set([
  "site_officiel", "agenda_officiel", "billetterie_officielle", "institutionnel",
]);

export function peutEcraserOsm(priorite, confiance) {
  return AUTORISEES_A_ECRASER.has(priorite) && Number(confiance) >= 0.7;
}

/* ====================================================================== */
/*  L'invite                                                              */
/* ====================================================================== */

/* Elle est écrite ici, en entier. Les seules valeurs interpolées sont celles
   du lieu, déjà bornées et nettoyées par l'appelant : un modèle qu'on
   interroge sur un lieu ne doit jamais recevoir de consigne venue du client.

   ELLE COMMENCE PAR DIRE QUE C'EST UNE TÂCHE DE RECHERCHE, et ce n'est pas un
   ornement. Interrogé sans cette consigne, le modèle répond de mémoire : il
   sait qu'un vélodrome existe à Roubaix, il en parle avec aplomb, et l'API ne
   cite aucune page — `webSearchQueries` vide, `groundingChunks` vide. La
   réponse est alors jetée par `construireFait`, ce qui est la bonne règle, mais
   l'appel a coûté trente secondes pour rien.

   Une information locale et actuelle ne se connaît pas : elle se lit. On le
   lui dit, et on lui dit quoi taper.

   ET ELLE DEMANDE DE LA PROSE AVANT LE JSON. Ce n'est pas une préférence de
   style, c'est la condition des citations. Mesuré sur la même question posée
   deux fois, avec le même modèle et la même clé :

     Euro 2024, réponse en texte libre ..............  6 citations
     Euro 2024, même question, sortie JSON contrainte   0 citation

   Les annotations de l'API portent un `start_index` et un `end_index` : elles
   s'ancrent sur des passages de prose. Une réponse qui n'est que du JSON n'a
   aucun passage à annoter, et ressort donc sans une seule source — que
   `construireFait` jette, à raison. C'est vrai que la contrainte vienne d'un
   `response_format` ou, comme ici, d'une consigne d'invite.

   D'où les deux temps : la prose porte la preuve, le JSON porte les données,
   et `extraireObjet` sait déjà prendre l'objet au milieu d'un texte. */
export function invite(lieu, options) {
  const l = lieu || {};
  const o = options || {};
  const aujourdhui = new Date(o.maintenant ?? Date.now());
  const jour = aujourdhui.toISOString().slice(0, 10);
  const situe = [l.adresse, l.commune].filter(Boolean).join(", ");
  /* Ce qu'on lui demande de taper : le nom exact, et la commune quand on la
     connaît. Les deux viennent du client, donc déjà nettoyés par `propre`. */
  const recherche = [l.nom, l.commune].filter(Boolean).join(" ");

  const lignes = [
    `Nous sommes le ${jour}.`,
    "",
    "TÂCHE DE RECHERCHE — ce n'est pas une question de culture générale.",
    "",
    "Les informations demandées sont LOCALES et ACTUELLES : elles changent, et",
    "tu ne peux pas les connaître de mémoire. Tu DOIS utiliser l'outil de",
    "recherche Google AVANT de répondre. Une réponse fondée sur tes seules",
    "connaissances internes est une réponse fausse, même si elle te paraît",
    "juste — et elle sera rejetée, parce qu'elle ne cite aucune page.",
    "",
    "COMMENCE PAR CHERCHER. Interroge au minimum :",
    `- « ${recherche} » — le nom exact du lieu, avec sa commune ;`,
    `- « ${recherche} horaires ouverture » ;`,
    `- « ${recherche} programme » ou « ${recherche} site officiel ».`,
    "",
    "Puis lis les pages trouvées, et ne réponds qu'à partir d'elles.",
    "",
    `Vérifie les informations pratiques du lieu suivant, en France :`,
    `- nom : ${l.nom}`,
    situe ? `- adresse : ${situe}` : `- position : ${l.lat}, ${l.lng}`,
    l.categorie ? `- type : ${l.categorie}` : "",
    l.horairesConnus
      ? `- horaires que nous avons, peut-être périmés : ${l.horairesConnus}`
      : "- nous n'avons aucun horaire pour ce lieu.",
    "",
    "ORDRE DES SOURCES, à respecter strictement :",
    "1. le site officiel du lieu ;",
    "2. son agenda ou sa programmation officielle ;",
    "3. sa page de billetterie officielle ;",
    "4. le site de la commune, de l'agglomération ou d'une institution publique ;",
    "5. une source tierce SEULEMENT si aucune des précédentes ne dit rien.",
    "",
    "RÈGLES ABSOLUES :",
    "- N'invente aucune information. Si tu ne l'as pas lue, réponds null.",
    "- Ne déduis pas des horaires d'un lieu voisin ni d'un autre établissement du même nom.",
    "- Si les sources se contredisent, retiens la plus officielle et la plus récente.",
    "- Donne la date de publication de la source dans `date_source` si tu la vois.",
    "- `confiance` vaut 1 quand une page officielle l'affirme noir sur blanc,",
    "  et descend vers 0 à mesure que tu extrapoles. Sois sévère.",
    "",
    "RÉPONDS EN DEUX TEMPS, ET L'ORDRE COMPTE.",
    "",
    "1. D'abord deux ou trois phrases en français qui résument ce que tu as lu,",
    "   en nommant les pages. Ce paragraphe n'est pas une politesse : les",
    "   citations de l'API s'ancrent sur des passages de PROSE, et une réponse",
    "   qui ne serait que du JSON n'en porte aucune. Sans citation, la donnée",
    "   est jetée — tu aurais cherché pour rien.",
    "",
    "2. Ensuite seulement, l'objet JSON, sans balises de code :",
    '{"statut": "ouvert" | "ferme" | "ferme_temporairement" | "ferme_definitivement" | "inconnu",',
    ' "horaires_du_jour": string | null,',
    ' "horaires_semaine": string | null,   // syntaxe OpenStreetMap opening_hours, ex "Tu-Su 10:00-18:00; Mo off"',
    ' "prochaine_ouverture": string ISO 8601 | null,',
    ' "fermeture_temporaire": true | false | null,',
    ' "motif_fermeture": string | null,',
    ' "fermeture_jusquau": "AAAA-MM-JJ" | null,',
    ' "programme_now": [{"titre": string, "debut": ISO | null, "fin": ISO | null, "url": string | null}],',
    ' "programme_soon": [{"titre": string, "debut": ISO | null, "fin": ISO | null, "url": string | null}],',
    ' "url_billetterie": string | null,',
    ' "url_officielle": string | null,',
    ' "date_source": "AAAA-MM-JJ" | null,',
    ' "confiance": nombre entre 0 et 1}',
    "",
    "`programme_now` ne contient que ce qui se déroule AUJOURD'HUI ou en ce moment.",
    "`programme_soon` ne contient que les quatorze prochains jours, au maximum cinq entrées.",
    "Si tu n'as rien trouvé de sûr, réponds l'objet avec `statut` = \"inconnu\" et des null.",
    "Mais cherche d'abord : répondre \"inconnu\" sans avoir lancé une recherche",
    "n'est pas une réponse prudente, c'est une réponse non faite.",
  ];
  return lignes.filter((ligne) => ligne !== "").join("\n");
}

/* ====================================================================== */
/*  La lecture de la réponse                                              */
/* ====================================================================== */

/* Le mode JSON strict de l'API n'est pas compatible avec l'outil de recherche :
   il faut choisir entre un format garanti et un ancrage réel. L'ancrage est ce
   qui rend cette source honnête — on le garde, et on analyse défensivement. */
export function extraireObjet(texte) {
  const brut = String(texte ?? "").trim();
  if (!brut) return null;
  const sansCloture = brut
    .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const debut = sansCloture.indexOf("{");
  const fin = sansCloture.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return null;
  try {
    const lu = JSON.parse(sansCloture.slice(debut, fin + 1));
    return lu && typeof lu === "object" && !Array.isArray(lu) ? lu : null;
  } catch {
    return null;
  }
}

function chaine(valeur, maximum) {
  if (valeur == null) return null;
  const s = String(valeur).trim();
  if (!s || s === "null" || s === "undefined") return null;
  return s.length > maximum ? s.slice(0, maximum).trim() : s;
}

function lienHttps(valeur) {
  const s = chaine(valeur, 500);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    // un lien qu'on affichera : il part en https, ou il ne part pas
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/* Une date rendue par un modèle peut tomber n'importe où — une année recopiée
   de travers suffit. On n'accepte qu'une fenêtre plausible autour de
   maintenant, et le reste redevient « on ne sait pas ». */
function horodatage(valeur, maintenant, avantMs, apresMs) {
  const s = chaine(valeur, 40);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  if (t < maintenant - avantMs) return null;
  if (t > maintenant + apresMs) return null;
  return new Date(t).toISOString();
}

const AN = 365 * 24 * 3600 * 1000;
const JOUR = 24 * 3600 * 1000;

const STATUTS = Object.freeze({
  ouvert: "open",
  open: "open",
  ferme: "closed",
  closed: "closed",
  ferme_temporairement: "temporary_closed",
  temporary_closed: "temporary_closed",
  ferme_definitivement: "permanently_closed",
  permanently_closed: "permanently_closed",
});

/* Les horaires ne sont acceptés que sous une forme qui RESSEMBLE à la syntaxe
   OpenStreetMap. On ne les analyse pas ici : `availability.js` est le seul
   lecteur d'horaires de l'application, et dupliquer sa grammaire garantirait
   qu'un jour les deux ne diront plus la même chose. Il rendra « inconnu » sur
   ce qu'il ne sait pas lire — c'est le filet, et il existe déjà. */
const FORME_HORAIRES = /^[A-Za-z0-9 :,;–—+-]{3,200}$/;

function horairesOsm(valeur) {
  const s = chaine(valeur, 200);
  if (!s) return null;
  const propre = s.replace(/[–—]/g, "-");
  if (!FORME_HORAIRES.test(propre)) return null;
  // au moins une heure : sans chiffre-deux-points-chiffre, ce n'est pas une grille
  return /\d{1,2}:\d{2}/.test(propre) || /24\/7/.test(propre) ? propre : null;
}

function programme(liste, maintenant, fenetreMs, maximum) {
  const sorties = [];
  for (const entree of Array.isArray(liste) ? liste : []) {
    const e = entree || {};
    const titre = chaine(e.titre || e.title, 140);
    if (!titre) continue;
    const debut = horodatage(e.debut, maintenant, 400 * JOUR, fenetreMs);
    const fin = horodatage(e.fin, maintenant, JOUR, 400 * JOUR);
    sorties.push({titre, debut, fin, url: lienHttps(e.url)});
    if (sorties.length >= maximum) break;
  }
  return sorties;
}

/* ====================================================================== */
/*  La fraîcheur                                                          */
/* ====================================================================== */

/* Combien de temps cette réponse vaut-elle ? Pas la même chose selon ce qu'on
   a trouvé, et c'est ce qui rend le budget tenable :

     · une programmation change tous les jours ;
     · une grille d'horaires ne bouge qu'aux saisons ;
     · une fermeture annoncée jusqu'à une date se connaît jusque-là ;
     · et un lieu sur lequel on n'a RIEN trouvé mérite d'être mis en cache
       aussi — sans quoi les lieux muets seraient les plus coûteux de tous,
       redemandés à chaque ouverture de l'application. */
export const DUREES = Object.freeze({
  programme: JOUR,
  horaires: 7 * JOUR,
  fermeture: 7 * JOUR,
  inconnu: 3 * JOUR,
});

export function expiration(fait, maintenant) {
  const t = Number(maintenant) || Date.now();
  if (!fait || fait.current_status === "unknown") return new Date(t + DUREES.inconnu);
  if (fait.programme_now.length || fait.programme_soon.length) {
    return new Date(t + DUREES.programme);
  }
  if (fait.temporary_closed === true || fait.current_status === "permanently_closed") {
    return new Date(t + DUREES.fermeture);
  }
  return new Date(t + DUREES.horaires);
}

/* ====================================================================== */
/*  Le fait, ou rien                                                      */
/* ====================================================================== */

/* Rend la ligne à écrire en base, ou `null` quand il n'y a rien à écrire —
   c'est-à-dire quand aucune source n'a été citée. Un `statut: unknown` avec
   des sources, lui, EST un résultat : il dit « on a cherché, on n'a pas
   trouvé », et il évite de rechercher demain. */
export function construireFait(brut, contexte) {
  const ctx = contexte || {};
  const maintenant = Number(ctx.maintenant) || Date.now();
  const sources = classerSources(ctx.sources, ctx);

  /* Pas de page citée, pas de fait. C'est toute la règle, et elle passe avant
     la lecture de quoi que ce soit d'autre. */
  if (!sources.length) return null;

  const p = brut && typeof brut === "object" ? brut : {};
  const priorite = sources[0].priorite;

  /* La confiance annoncée par le modèle est un plafond, pas une mesure : elle
     est plafonnée par la qualité de la meilleure source réellement citée. Un
     modèle très sûr de lui qui n'a lu qu'un annuaire reste un annuaire. */
  const annoncee = Number(p.confiance);
  const brute = Number.isFinite(annoncee) ? Math.min(1, Math.max(0, annoncee)) : 0;
  const plafond = priorite === "tiers" ? 0.5
    : priorite === "institutionnel" ? 0.85 : 1;
  const confiance = Math.round(Math.min(brute, plafond) * 100) / 100;

  const statut = STATUTS[String(p.statut || "").toLowerCase()] ?? "unknown";
  const fermetureTemporaire = p.fermeture_temporaire === true ? true
    : p.fermeture_temporaire === false ? false
    : statut === "temporary_closed" ? true : null;

  const fait = {
    current_status: statut,
    today_hours: chaine(p.horaires_du_jour, 120),
    opening_hours: horairesOsm(p.horaires_semaine),
    next_open_at: horodatage(p.prochaine_ouverture, maintenant, JOUR, 60 * JOUR),
    temporary_closed: fermetureTemporaire,
    closure_reason: chaine(p.motif_fermeture, 200),
    closure_until: dateSeule(p.fermeture_jusquau, maintenant),
    programme_now: programme(p.programme_now, maintenant, 2 * JOUR, 5),
    programme_soon: programme(p.programme_soon, maintenant, 21 * JOUR, 5),
    ticket_url: lienHttps(p.url_billetterie),
    official_url: lienHttps(p.url_officielle),
    source_priority: priorite,
    sources: sources.slice(0, 5),
    confidence: confiance,
    last_verified_at: dateSource(p.date_source, maintenant, sources),
  };

  /* UN FAIT SANS CONFIANCE N'EST PAS UN FAIT. En dessous du seuil, on garde la
     ligne — elle a coûté un appel, et elle évite de le repayer demain — mais
     vidée de tout ce qu'elle affirmait. C'est « on a cherché, on ne sait pas »,
     ce qui est une information, et ce n'est pas la même chose que « fermé ». */
  if (confiance < 0.4) return Object.assign(vide(sources, priorite), {
    confidence: confiance,
    last_verified_at: fait.last_verified_at,
  });

  /* Un statut affirmé sans qu'aucune source ne l'appuie assez pour écraser
     OpenStreetMap ne doit pas décider du déplacement de quelqu'un. On garde ce
     qui informe — la programmation, la billetterie, le site officiel — et on
     abandonne ce qui déciderait à la place de sources plus fiables.

     CE QUI MANQUAIT : SEULE LA FERMETURE DÉFINITIVE ÉTAIT RETIRÉE.

     Un agrégateur — priorité « tiers », confiance 0,5 — pouvait donc encore
     écrire `current_status: "open"`. Et « open » n'est pas un détail : c'est
     le seul mot qui fait entrer dans « Maintenant » un lieu dont Autour ne
     connaît aucun horaire (`ouvertVerifie` dans maintenant.js). Une source
     tierce obtenait ainsi, seule, le pouvoir de faire passer une information
     de « inconnu » à « ouvert maintenant » — exactement la bascule qu'aucune
     source tierce ne doit pouvoir provoquer seule, parce qu'elle envoie
     quelqu'un marcher vingt minutes.

     Les trois bascules critiques sont donc traitées ensemble :

       inconnu → ouvert      envoie devant une porte peut-être close
       ouvert  → fermé       empêche d'y aller pour rien
       ouvert  → définitif   retire le lieu de la carte

     Aucune ne survit à une provenance insuffisante ; tout le reste, si. */
  if (!peutEcraserOsm(priorite, confiance)) {
    fait.current_status = "unknown";
    fait.opening_hours = null;
    fait.temporary_closed = fait.temporary_closed === true ? null : fait.temporary_closed;
  }

  return fait;
}

function vide(sources, priorite) {
  return {
    current_status: "unknown", today_hours: null, opening_hours: null,
    next_open_at: null, temporary_closed: null, closure_reason: null,
    closure_until: null, programme_now: [], programme_soon: [],
    ticket_url: null, official_url: null,
    source_priority: priorite, sources: sources.slice(0, 5),
    confidence: 0, last_verified_at: null,
  };
}

function dateSeule(valeur, maintenant) {
  const s = chaine(valeur, 20);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + "T12:00:00Z");
  if (!Number.isFinite(t)) return null;
  if (t < maintenant - 30 * JOUR || t > maintenant + 2 * AN) return null;
  return s;
}

/* La date de la SOURCE, pas celle de notre appel : c'est elle qui autorise une
   donnée officielle récente à primer sur un `opening_hours` ancien. Quand le
   modèle ne la donne pas, on ne l'invente pas — on ne remonte simplement pas
   plus loin que l'instant où on a lu la page. */
function dateSource(valeur, maintenant, sources) {
  const s = chaine(valeur, 20);
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s + "T12:00:00Z");
    if (Number.isFinite(t) && t <= maintenant + JOUR && t > maintenant - 10 * AN) {
      return new Date(t).toISOString();
    }
  }
  return sources.length ? new Date(maintenant).toISOString() : null;
}

/* La ligne complète, prête pour PostgREST. */
export function ligneEnrichissement(fait, lieu, meta) {
  const l = lieu || {};
  const m = meta || {};
  const maintenant = Number(m.maintenant) || Date.now();
  return {
    place_key: l.cle,
    place_name: String(l.nom).slice(0, 200),
    commune: l.commune ? String(l.commune).slice(0, 120) : null,
    category: l.categorie ? String(l.categorie).slice(0, 40) : null,
    lat: Number.isFinite(Number(l.lat)) ? Number(l.lat) : null,
    lng: Number.isFinite(Number(l.lng)) ? Number(l.lng) : null,
    ...fait,
    checked_at: new Date(maintenant).toISOString(),
    expires_at: expiration(fait, maintenant).toISOString(),
    model: m.modele ?? null,
    run_ms: Number.isFinite(Number(m.duree)) ? Math.round(Number(m.duree)) : null,
  };
}

/* ======================================================================
   MODE AIDE — CHOISIR ET ORDONNER, JAMAIS PRODUIRE

   POURQUOI ICI, ET PAS DANS UNE SECONDE FONCTION

   Autour a un seul appel de modèle : celui-ci. Il porte la clé — qui ne
   quitte jamais Supabase —, la réservation de budget, le plafond du jour et
   la trace. Ouvrir une deuxième porte pour Aide, ce serait dupliquer ces
   quatre choses, donc en oublier une. Le mode Aide est donc un MODE de
   l'appel existant : même secret, même budget, même plafond, même trace.

   CE QUI CHANGE PAR RAPPORT À L'AUTRE MODE

   L'enrichissement fait chercher le modèle sur le web : c'est son métier là-bas,
   et les citations sont la preuve. Ici, c'est exactement l'inverse. Le modèle
   reçoit une liste fermée de structures déjà récupérées et vérifiées par la
   taxonomie, et il n'a le droit que de la RÉORDONNER. Aucun outil de recherche
   ne lui est donné : lui en donner un serait lui tendre le moyen d'inventer
   une adresse ou un service, très exactement ce qu'on lui interdit.

   ET LA GARANTIE N'EST PAS DANS CE TEXTE

   Une invite bien écrite n'est pas un contrôle. Le contrôle est
   `lireOrdreAide`, qui jette tout identifiant qu'on ne lui a pas donné — puis
   `AutourAideContexteIA.valider` côté navigateur, qui refait le même travail.
   Le texte ci-dessous dit la règle ; le code la tient.
   ====================================================================== */

/* Ce qu'on montre du candidat au modèle. Assez pour juger, jamais assez pour
   identifier qui regarde : pas de photo, pas d'historique, pas d'identifiant
   de session. */
function ligneCandidat(c) {
  const parts = [
    `id=${c.id}`,
    `nom="${String(c.name ?? "").slice(0, 80)}"`,
    c.category ? `categorie=${c.category}` : "",
    Number.isFinite(Number(c.distanceM)) ? `distance=${Math.round(c.distanceM)}m` : "",
    Number(c.confidence) ? `confiance=${Math.round(Number(c.confidence))}` : "",
  ];
  const tags = Object.entries(c.osm || {}).slice(0, 8)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`);
  if (tags.length) parts.push(`tags[${tags.join(" ")}]`);
  const capacites = Object.entries(c.capabilities || {})
    .filter(([, oui]) => oui).map(([k]) => k);
  if (capacites.length) parts.push(`capacites[${capacites.join(" ")}]`);
  if (c.openingHours) parts.push(`horaires="${String(c.openingHours).slice(0, 60)}"`);
  return "- " + parts.filter(Boolean).join(" ");
}

export function inviteAide(contexte) {
  const c = contexte || {};
  const candidats = Array.isArray(c.candidatePlaces) ? c.candidatePlaces : [];
  const regles = Array.isArray(c.rules) ? c.rules : [];

  const lignes = [
    "Tu aides une personne qui cherche de l'aide sociale en France.",
    "",
    "TA TÂCHE EST UN TRI, PAS UNE RECHERCHE.",
    "",
    "On te donne une liste FERMÉE de structures déjà récupérées et déjà",
    "vérifiées. Tu ne peux rien y ajouter. Tu choisis lesquelles répondent",
    "vraiment à la demande, et dans quel ordre les montrer.",
    "",
    "OÙ ELLE SE TROUVE :",
    `- position : ${c.userLat}, ${c.userLng}`,
    c.selectedCity ? `- commune : ${c.selectedCity}` : "",
    c.currentRadius ? `- rayon déjà exploré : ${Math.round(c.currentRadius)} m` : "",
    "",
    "CE QU'ELLE DEMANDE :",
    c.requestedHelpCategory
      ? `- catégorie choisie : ${c.requestedHelpCategory}`
      : "- aucune catégorie choisie.",
    /* La phrase telle qu'elle a été tapée. Elle sert ici, et nulle part
       ailleurs : elle n'est écrite dans aucune table, aucun journal, aucune
       métrique. */
    c.userFreeText ? `- ses mots : « ${c.userFreeText} »` : "",
    "",
    `LES ${candidats.length} STRUCTURES DISPONIBLES — la liste complète, et la seule :`,
    ...candidats.map(ligneCandidat),
    "",
    "CATÉGORIES AUTORISÉES, et aucune autre :",
    (Array.isArray(c.allowedCategories) ? c.allowedCategories : []).join(", "),
    "",
    "RÈGLES ABSOLUES :",
    ...regles.map((r) => `- ${r}`),
    "- Ne réponds JAMAIS avec un id qui n'est pas dans la liste ci-dessus.",
    "- Si une structure ne répond pas à la demande, mets-la dans `rejectedPlaceIds`",
    "  plutôt que de l'ordonner en dernier : dire non est une réponse utile.",
    "- Si rien ne convient, rends `rankedPlaceIds` vide. C'est une réponse valable.",
    "",
    "L'ORDRE QUE TU RENDS, dans cet esprit :",
    "1. ce qui répond exactement au besoin exprimé, avant ce qui « peut aussi » ;",
    "2. une structure spécialisée avant une association généraliste ;",
    "3. ce qui est ouvert ou ouvre bientôt, quand on le sait ;",
    "4. le plus proche, en dernier critère seulement.",
    "",
    "RÉPONDS UNIQUEMENT PAR CET OBJET JSON, sans balises de code, sans phrase :",
    '{"primaryNeed": string | null,          // une des catégories autorisées',
    ' "secondaryNeeds": [string],            // au plus 3, catégories autorisées',
    ' "rankedPlaceIds": [string],            // des ids de la liste, dans ton ordre',
    ' "rejectedPlaceIds": [string],          // des ids de la liste, écartés',
    ' "explanations": {"<id>": "une phrase courte, en français"}}',
    "",
    "`explanations` ne décrit que ce que les données montrent. N'y affirme",
    "jamais un horaire, un service, un téléphone ou une adresse : tu n'en as pas.",
  ];
  return lignes.filter((ligne) => ligne !== "").join("\n");
}

/* La lecture de ce qui revient — et le filtre qui rend le mode sûr.

   Le même travail est refait côté navigateur par `AutourAideContexteIA.valider`.
   Ce n'est pas de la redondance décorative : le serveur ne doit pas laisser
   sortir un identifiant inventé, et le client ne doit pas faire confiance au
   serveur pour ça. Chacun tient sa propre porte. */
export function lireOrdreAide(texte, contexte) {
  const c = contexte || {};
  const brut = extraireObjet(texte);
  const permis = new Set((Array.isArray(c.allowedPlaceIds) ? c.allowedPlaceIds : [])
    .map(String));
  const categories = new Set((Array.isArray(c.allowedCategories) ? c.allowedCategories : [])
    .map(String));
  const vide = {
    primaryNeed: null, secondaryNeeds: [], rankedPlaceIds: [],
    rejectedPlaceIds: [], explanations: {}, ecartes: 0,
  };
  if (!brut || typeof brut !== "object") return vide;

  let ecartes = 0;
  const idsPermis = (liste) => (Array.isArray(liste) ? liste : [])
    .map(String)
    .filter((id) => { if (permis.has(id)) return true; ecartes++; return false; });

  const categorie = (v) => {
    const s = v == null ? "" : String(v);
    if (categories.has(s)) return s;
    if (s) ecartes++;
    return null;
  };

  const primaire = categorie(brut.primaryNeed);
  const secondaires = (Array.isArray(brut.secondaryNeeds) ? brut.secondaryNeeds : [])
    .map(categorie).filter((s) => s && s !== primaire).slice(0, 3);

  const explications = {};
  Object.entries(brut.explanations || {}).forEach(([id, phrase]) => {
    if (!permis.has(String(id))) { ecartes++; return; }
    explications[String(id)] = String(phrase).replace(/\s+/g, " ").trim().slice(0, 200);
  });

  return {
    primaryNeed: primaire,
    secondaryNeeds: secondaires,
    rankedPlaceIds: idsPermis(brut.rankedPlaceIds),
    rejectedPlaceIds: idsPermis(brut.rejectedPlaceIds),
    explanations: explications,
    /* Combien de fois le modèle a tenté de sortir du cadre. Un nombre, pas un
       texte : il se compte sans rien révéler de la demande. */
    ecartes,
  };
}
