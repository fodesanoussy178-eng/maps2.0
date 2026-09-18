/* ===========================================================================
   data·inclusion — la source qui portait déjà les champs qui manquaient

   CE QUE ÇA REMPLACE

   `data/aide-dora-tourcoing.js` est un extrait figé de sept structures, daté
   du 24 août 2026, borné à une commune. Il a rendu service : il a permis de
   construire Aide sans dépendre d'un jeton. Mais un fichier figé ne dit ni
   qu'une permanence a fermé, ni qu'un service a changé de public, et il ne
   grandit pas d'une ville.

   data·inclusion publie exactement ce que la fiche solidaire doit afficher —
   publics visés, modes d'orientation, frais, types de service — sous un
   vocabulaire contrôlé, national, gratuit et rafraîchi. Passer du fichier à
   l'API ne demande aucun modèle : c'est une traduction de vocabulaire.

   CE QUI RESTE FIGÉ, ET POURQUOI

   L'extrait ne disparaît pas : il devient le repli. Sans jeton, ou pendant une
   panne d'amont, une ville qui avait sept fiches en garde sept. Ce qu'il perd,
   c'est son rang : il n'est plus la source, il est ce qui reste quand la
   source ne répond pas. `sourceStatus` le dit à voix haute.

   CE QUE CE MODULE NE FAIT PAS

   Il ne classe pas. Le verdict d'aide reste celui d'`AutourAideClassement`,
   qui lit les types et services déclarés. Ici on traduit des codes en champs,
   et un code inconnu ressort tel quel plutôt que rangé de force dans une case
   voisine.

   Il n'invente aucun horaire. `horaires_ouverture` de data·inclusion est de
   l'`opening_hours` OSM, donc parsable ; s'il est absent, la fiche n'a pas
   d'horaire, et c'est tout (voir la règle A.7 de autour/docs/fraicheur.md).
=========================================================================== */

/* La base est configurable parce qu'elle a déjà bougé une fois (v0 → v1) et
   qu'une montée de version ne doit pas demander un déploiement de code. */
export const BASE_PAR_DEFAUT = "https://api.data.inclusion.beta.gouv.fr/api/v1";
export const CHEMIN_RECHERCHE = "/search/services";
export const DELAI_MS = 6000;

const texte = (v) => String(v == null ? "" : v).trim();
const liste = (v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
const codes = (v) => [...new Set(liste(v).map((x) => texte(x).toLowerCase()).filter(Boolean))];
const nombre = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---- LE VOCABULAIRE CONTRÔLÉ, ET RIEN QUE LUI ---------------------------
   Ces tables traduisent les valeurs publiées par le schéma des données de
   l'insertion. Une valeur absente de la table n'est pas devinée : elle est
   recopiée telle quelle pour `public_vise`, et rend `null` pour les champs
   fermés (`mode_acces`, `cout`). Un champ nul se voit ; un champ deviné se
   propage. */

export const PUBLICS = Object.freeze({
  "adultes": "Adultes",
  "jeunes": "Jeunes",
  "jeunes-16-26": "16-26 ans",
  "seniors": "Seniors (+ de 65 ans)",
  "seniors-65": "Seniors (+ de 65 ans)",
  "familles": "Familles",
  "familles-enfants": "Familles avec enfants",
  "femmes": "Femmes",
  "etudiants": "Étudiants",
  "handicaps": "Personnes en situation de handicap",
  "handicaps-psychiques": "Handicap psychique",
  "handicaps-mentaux": "Handicap mental",
  "deficience-visuelle": "Déficience visuelle",
  "surdite": "Personnes sourdes ou malentendantes",
  "refugies": "Personnes réfugiées",
  "primo-arrivants": "Personnes primo-arrivantes",
  "sortants-de-detention": "Sortants de détention",
  "personnes-en-situation-illettrisme": "Situation d'illettrisme",
  "personnes-handicapees": "Personnes en situation de handicap",
  "public-langues-etrangeres": "Personnes allophones",
  "beneficiaires-rsa": "Bénéficiaires du RSA",
  "demandeurs-emploi": "Demandeurs d'emploi",
  "tous-publics": "Tous publics",
});

/* `mode_acces` est le champ le plus important de la fiche : c'est lui qui
   évite le trajet pour rien. L'ordre des tests EST la règle. Se présenter
   l'emporte sur téléphoner, qui l'emporte sur prendre rendez-vous : on
   annonce le chemin le plus simple qui soit réellement ouvert. L'orientation
   vient en dernier parce qu'elle ferme la porte directe. */
const ORIENTATION_BENEFICIAIRE = Object.freeze([
  [/^se-presenter/, "libre"],
  [/^telephoner/, "telephone"],
  [/^envoyer-un-(mail|courriel)/, "rendez_vous"],
  [/^completer-le-formulaire/, "rendez_vous"],
  [/^prendre-rendez-vous/, "rendez_vous"],
]);

export const COUTS = Object.freeze({
  "gratuit": "gratuit",
  "gratuit-sous-conditions": "participation",
  "adhesion": "participation",
  "payant": "payant",
  "pass-numerique": "participation",
});

export const MODES_ACCES = Object.freeze(["libre", "rendez_vous", "orientation", "telephone"]);
export const VALEURS_COUT = Object.freeze(["gratuit", "participation", "payant"]);

/* ---- LA TRADUCTION ------------------------------------------------------ */

export function publicVise(brut) {
  const profils = codes(brut && (brut.profils ?? brut.publics ?? brut.profils_precisions_type));
  return profils.map((code) => ({ code, label: PUBLICS[code] || code.replace(/-/g, " ") }));
}

export function modeAcces(brut) {
  const beneficiaire = codes(brut && (brut.modes_orientation_beneficiaire ?? brut.modesOrientationBeneficiaire));
  for (const [motif, valeur] of ORIENTATION_BENEFICIAIRE) {
    if (beneficiaire.some((code) => motif.test(code))) return valeur;
  }
  /* Seul un accompagnateur peut orienter : pour la personne concernée, la
     porte d'entrée n'est pas le lieu, c'est un prescripteur. Le dire est tout
     l'intérêt du champ. */
  const accompagnateur = codes(brut && (brut.modes_orientation_accompagnateur ?? brut.modesOrientationAccompagnateur));
  if (accompagnateur.length) return "orientation";
  return null;
}

export function cout(brut) {
  for (const code of codes(brut && (brut.frais ?? brut.frais_autres_precisions ?? brut.cout))) {
    if (COUTS[code]) return COUTS[code];
  }
  return null;
}

/* B.3 — UN GESTIONNAIRE N'EST PAS UN LIEU.

   data·inclusion rattache chaque service à une structure. Quand le service
   porte son propre nom et que la structure en porte un autre, la structure
   est l'organisme, pas l'adresse : c'est le cas d'ALEFPA ou de La Sauvegarde
   du Nord, qui gèrent des dizaines d'établissements. On garde les deux, dans
   deux champs, et on n'affiche jamais le siège comme un point d'accueil. */
export function organismeGestionnaire(brut) {
  const structure = (brut && (brut.structure || brut.structure_parente)) || {};
  const nomStructure = texte(structure.nom || brut && brut.nom_structure);
  const nomService = texte(brut && (brut.nom_service || brut.nom));
  if (!nomStructure || !nomService) return null;
  return nomStructure.toLowerCase() === nomService.toLowerCase() ? null : nomStructure;
}

/* ---- L'APLATISSEMENT ----------------------------------------------------
   L'API rend tantôt une structure, tantôt un service accompagné de sa
   structure, tantôt les deux dans une enveloppe `{service, structure,
   distance}`. Les trois formes décrivent le même objet : on les ramène à un
   seul dictionnaire, sans qu'un champ de service n'écrase un champ de
   structure porteur d'identité (SIRET, coordonnées, adresse). */
export function aplatir(entree) {
  if (!entree || typeof entree !== "object") return null;
  const service = entree.service && typeof entree.service === "object" ? entree.service : null;
  const structure = entree.structure && typeof entree.structure === "object" ? entree.structure : null;
  if (!service && !structure) return Object.assign({}, entree);
  const base = Object.assign({}, structure || {}, service || {});
  if (structure) {
    /* Un service hérite des coordonnées de sa structure quand il n'en publie
       pas : sans elles, il n'entre pas dans une carte. */
    for (const champ of ["latitude", "longitude", "adresse", "code_postal", "commune",
      "code_insee", "siret", "rna", "horaires_ouverture", "site_web", "telephone", "courriel"]) {
      if (base[champ] == null || base[champ] === "") base[champ] = structure[champ];
    }
    base.structure = structure;
    if (service && service.nom) base.nom_service = service.nom;
  }
  if (entree.distance != null) base.distance = entree.distance;
  return base;
}

export function lireListe(corps) {
  if (Array.isArray(corps)) return corps;
  const p = corps || {};
  for (const champ of ["items", "results", "data", "services", "structures"]) {
    if (Array.isArray(p[champ])) return p[champ];
  }
  return [];
}

/* ---- LA FICHE -----------------------------------------------------------
   Le résultat garde les noms de champs que les adapters du navigateur lisent
   déjà (`aideDora`), et ajoute la fiche utile de la partie B sous `fiche`.
   Rien n'est renommé : un adapter qui ignore `fiche` continue de marcher. */
export function normaliser(entree) {
  const brut = aplatir(entree);
  if (!brut) return null;
  const lat = nombre(brut.latitude ?? brut.lat);
  const lng = nombre(brut.longitude ?? brut.lon ?? brut.lng);
  const nom = texte(brut.nom_service || brut.nom || brut.name);
  if (!nom || lat == null || lng == null) return null;
  const identifiant = texte(brut.id || brut._di_surrogate_id || brut.identifiant);
  const source = texte(brut.source || (brut.structure && brut.structure.source)) || "data_inclusion";
  const publics = publicVise(brut);
  const acces = modeAcces(brut);
  const frais = cout(brut);
  const gestionnaire = organismeGestionnaire(brut);
  return {
    id: identifiant ? "data-inclusion:" + identifiant : null,
    name: nom,
    officialName: nom,
    lat, lng,
    address: texte(brut.adresse),
    postalCode: texte(brut.code_postal),
    commune: texte(brut.commune),
    cityCode: texte(brut.code_insee),
    siret: texte(brut.siret) || undefined,
    phone: texte(brut.telephone),
    email: texte(brut.courriel),
    website: texte(brut.site_web),
    description: texte(brut.presentation_resume || brut.presentation_detail),
    typology: texte(brut.typologie),
    type_structure: texte(brut.typologie),
    services: codes(brut.types ?? brut.thematiques),
    service_types: codes(brut.thematiques),
    nationalLabels: codes(brut.labels_nationaux),
    /* `horaires_ouverture` est de la syntaxe `opening_hours` d'OSM. On la
       transmet telle quelle : elle se parse, ou elle ne dit rien. Jamais de
       reformulation. */
    openingHours: texte(brut.horaires_ouverture) || null,
    isObsolete: brut.date_suspension ? true : undefined,
    source: "data_inclusion",
    dataProvider: source,
    officialUrl: texte(brut.lien_source) || null,
    updatedAt: texte(brut.date_maj) || null,
    lastSourceUpdate: texte(brut.date_maj) || null,
    sourceConfidence: 0.88,
    sourceRefs: {
      dataInclusionId: identifiant || undefined,
      ...(texte(brut.siret) ? { siret: texte(brut.siret) } : {}),
    },
    provenance: [{
      source: "data_inclusion",
      id: identifiant || null,
      url: texte(brut.lien_source) || null,
      updatedAt: texte(brut.date_maj) || null,
      confidence: 0.88,
      ...(source ? { producer: source } : {}),
    }],
    /* LA FICHE QUI SERT (partie B). `quoi_concretement` n'est pas repris du
       résumé de la source : ce résumé est écrit pour un référentiel, pas pour
       quelqu'un qui cherche une porte. Il reste nul ici et vient du lexique
       relu à la main. */
    fiche: {
      public_vise: publics,
      mode_acces: acces,
      cout: frais,
      anonymat: null,
      quoi_concretement: null,
      telephone_cle: null,
      type_structure: texte(brut.typologie) || null,
      organisme_gestionnaire: gestionnaire,
      /* La provenance de chaque champ, parce qu'un champ sans source ne se
         corrige pas : on ne saurait pas à qui le reprocher. */
      provenance: "data_inclusion",
    },
  };
}

/* ---- L'APPEL ------------------------------------------------------------ */

export function jeton(env) {
  const e = env || {};
  return texte(e.DATA_INCLUSION_API_TOKEN || e.DORA_API_TOKEN) || null;
}

export function urlRecherche({ base, lat, lng, rayonM, limite, codeCommune }) {
  const url = new URL((base || BASE_PAR_DEFAUT).replace(/\/+$/, "") + CHEMIN_RECHERCHE);
  if (lat != null && lng != null) {
    url.searchParams.set("lat", Number(lat).toFixed(6));
    url.searchParams.set("lon", Number(lng).toFixed(6));
  }
  /* L'API raisonne en kilomètres entiers. On arrondit vers le haut puis on
     refiltre au mètre côté appelant : mieux vaut recevoir trop et couper que
     perdre une structure à la frontière. */
  if (rayonM != null) url.searchParams.set("radius", String(Math.max(1, Math.ceil(Number(rayonM) / 1000))));
  if (codeCommune) url.searchParams.set("code_commune", String(codeCommune));
  url.searchParams.set("size", String(Math.min(100, Math.max(1, Number(limite) || 50))));
  url.searchParams.set("exclure_doublons", "true");
  return url;
}

/* Rend toujours un état, jamais une exception : une panne de data·inclusion
   est une absence de fiches, pas une panne d'Autour. */
export async function interroger(options) {
  const o = options || {};
  const cle = o.jeton !== undefined ? o.jeton : jeton(o.env);
  if (!cle) return { items: [], etat: { source: "data_inclusion", state: "not_configured" } };
  const url = urlRecherche({
    base: o.base || (o.env && o.env.DATA_INCLUSION_API_URL) || BASE_PAR_DEFAUT,
    lat: o.lat, lng: o.lng, rayonM: o.rayonM, limite: o.limite, codeCommune: o.codeCommune,
  });
  const appel = o.fetch || fetch;
  try {
    const reponse = await appel(String(url), {
      headers: { accept: "application/json", authorization: "Bearer " + cle },
      signal: o.signal || (typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(DELAI_MS) : undefined),
    });
    if (!reponse.ok) {
      return { items: [], etat: { source: "data_inclusion", state: "unavailable",
        reason: "http_" + reponse.status } };
    }
    const corps = await reponse.json();
    const items = lireListe(corps).map(normaliser).filter(Boolean);
    return { items, etat: { source: "data_inclusion", state: items.length ? "ok" : "empty",
      count: items.length } };
  } catch (erreur) {
    return { items: [], etat: { source: "data_inclusion", state: "unavailable",
      reason: texte(erreur && erreur.message) || "amont_indisponible" } };
  }
}
