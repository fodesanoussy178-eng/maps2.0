/* ---------------------------------------------------------------------------
   L'ORGANISATION N'EST PAS LE POINT DE SERVICE

   LA DISTINCTION, ET POURQUOI ELLE DÉCIDE DE TOUT

   Une ORGANISATION est une personne morale : un SIREN, des SIRET, un objet
   déclaré. Elle sert à VÉRIFIER — l'identité, la provenance, l'existence
   légale, l'état ouvert ou fermé.

   Un POINT DE SERVICE est un endroit où quelqu'un est reçu : une adresse, un
   service rendu, des horaires, un téléphone, des conditions d'accès, une date
   de dernière vérification. Il sert à AIDER.

   Une même organisation en exploite souvent plusieurs. Mesuré le 25/09/2026 :
   le registre officiel déclare DEUX établissements des « LES RESTAURANTS DU
   COEUR » (SIREN 339863417) à Tourcoing, dont un ouvert — et la commune compte
   CINQ centres de distribution réels, dont les adresses sont confirmées par la
   Base Adresse Nationale. Les trois quarts des points de service de ce réseau
   n'ont aucune existence au registre : ils sont tenus depuis la même personne
   morale, dans des locaux prêtés — une salle paroissiale, une maison des
   services, un centre social.

   CE QUE CELA INTERDIT

   Répondre « Restos du Cœur — association départementale » à quelqu'un qui
   cherche à manger. Ce n'est pas une réponse : c'est le nom de celui qui
   organise. La réponse est un endroit, une heure et une distance.

   L'ORDRE DE RAISONNEMENT. Il n'est pas indicatif : c'est le seul ordre qui
   part du besoin et non de la base.

     1. le besoin de la personne ;
     2. le service cherché ;
     3. les points de service qui rendent ce service ;
     4. l'organisation de rattachement — pour vérifier, pas pour répondre ;
     5. distance, horaires, disponibilité, fiabilité ;
     6. la recommandation.

   CE QUI NE FUSIONNE JAMAIS DEUX POINTS DE SERVICE

   Un identifiant d'organisation identifie l'ORGANISATION. Il peut CORROBORER
   un rapprochement, jamais le décider. Deux points qui partagent un SIRET, un
   SIREN, un réseau, un téléphone ou un domaine restent deux points tant que
   leur emplacement ne dit pas le contraire.

   C'est la règle que ce fichier tient, et elle est dite ici une seule fois
   pour les sept lecteurs qui en dépendent : `local_discovery`, Solidarité, la
   recherche, « Pour toi », les agents d'enrichissement, le dédoublonnage et la
   génération des fiches.
--------------------------------------------------------------------------- */

/* Les identifiants qui désignent une PERSONNE MORALE. Aucun ne suffit à dire
   « c'est le même endroit ». */
export const IDENTIFIANTS_D_ORGANISATION = Object.freeze([
  "siret", "siren", "rna", "institutional_id", "finess_pm", "finessPm",
]);

/* Les identifiants qui désignent un SITE, par construction de la source. Un
   FINESS d'entité géographique EST un établissement géographique : deux sites
   d'une même personne morale en portent deux différents. Ceux-là peuvent
   décider seuls. */
export const IDENTIFIANTS_DE_SITE = Object.freeze([
  "finess_ege", "finessEge", "ban_id", "banId", "osm_id", "osmId",
]);

/* Les signaux qui disent « même réseau » et qu'on a vus confondus avec « même
   endroit » : un numéro départemental, un domaine national, un nom de réseau. */
export const SIGNAUX_DE_RESEAU = Object.freeze([
  "phone", "telephone", "domain", "source_domain", "network", "reseau",
]);

export const ORDRE_DE_RAISONNEMENT = Object.freeze([
  "besoin de la personne",
  "service cherché",
  "points de service pertinents",
  "organisation de rattachement (vérification)",
  "distance, horaires, disponibilité, fiabilité",
  "recommandation",
]);

/* Le bloc injecté dans les invites des agents. Il dit la distinction, l'ordre,
   et l'exemple qui a coûté le plus cher — parce qu'une règle sans son
   contre-exemple se réinterprète. */
export const DOCTRINE_POINT_DE_SERVICE = `DISTINCTION OBLIGATOIRE : ORGANISATION / POINT DE SERVICE.
Une ORGANISATION est une personne morale (SIREN, SIRET, objet déclaré) : elle sert
à VÉRIFIER l'identité et la provenance. Un POINT DE SERVICE est un endroit où une
personne est reçue : adresse, service rendu, horaires, téléphone, conditions
d'accès. C'est lui qui AIDE, et c'est lui que tu dois rendre.

Une même organisation exploite souvent PLUSIEURS points de service, et la plupart
n'existent pas au registre des entreprises : ils sont tenus dans des locaux
prêtés. Ne conclus donc jamais d'un identifiant d'organisation qu'il n'y a qu'un
seul endroit.

INSUFFISANT : « Restos du Cœur — association départementale ».
ATTENDU : « Restos du Cœur — point de distribution X, <adresse>, aide
alimentaire, <horaires>, à <distance> ».

Raisonne dans cet ordre : ${ORDRE_DE_RAISONNEMENT.join(" → ")}.

NE FUSIONNE JAMAIS deux points de service parce qu'ils partagent un SIRET, un
SIREN, un réseau, un téléphone ou un domaine Internet. Deux adresses distinctes
d'un même réseau sont deux réponses distinctes.`;

const DIACRITIQUES = /[̀-ͯ]/g;

function normaliser(valeur) {
  return String(valeur ?? "").normalize("NFD").replace(DIACRITIQUES, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function valeur(objet, cles) {
  for (const cle of cles) {
    const brut = objet?.[cle] ?? objet?.identifiers?.[cle] ?? objet?.sourceRefs?.[cle];
    if (brut != null && String(brut).trim() !== "") return String(brut).replace(/\s+/g, "").toUpperCase();
  }
  return null;
}

export function distanceM(a, b) {
  const lat1 = Number(a?.lat), lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat), lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/* LE MÊME ENDROIT, AU SENS PHYSIQUE. Une adresse normalisée identique, ou
   moins de `rayon` mètres. Deux antennes d'un réseau sont régulièrement à
   deux rues l'une de l'autre : le rayon reste court. */
export function memeEmplacement(a, b, rayon = 120) {
  const adresseA = normaliser(a?.address ?? a?.adresse);
  if (adresseA && adresseA === normaliser(b?.address ?? b?.adresse)) return true;
  return distanceM(a, b) <= rayon;
}

/* ---------------------------------------------------------------------------
   DEUX FICHES DÉCRIVENT-ELLES LE MÊME POINT DE SERVICE ?

   Trois façons de conclure OUI, et une seule règle commune : l'emplacement
   doit être le même. Rien ne s'en dispense.

     · un identifiant DE SITE partagé (FINESS d'entité géographique, id BAN,
       id OpenStreetMap) : la source elle-même désigne un site ;
     · le même nom au même endroit ;
     · un identifiant d'ORGANISATION partagé, au même endroit — il corrobore,
       il ne décide pas ;
     · le même téléphone au même endroit : c'est le même guichet sous deux
       noms (« CCAS » et « Centre Communal d'Action Sociale »).

   Et la règle qui a manqué : deux fiches au même endroit dont les identifiants
   de SITE diffèrent restent DEUX points. Un même bâtiment héberge une
   permanence et une épicerie solidaire.
--------------------------------------------------------------------------- */
export function memePointDeService(a, b, {rayon = 120} = {}) {
  if (!a || !b) return false;

  const siteA = valeur(a, IDENTIFIANTS_DE_SITE), siteB = valeur(b, IDENTIFIANTS_DE_SITE);
  if (siteA && siteB) return siteA === siteB;

  const ici = memeEmplacement(a, b, rayon);
  if (!ici) return false;

  if (normaliser(a.name ?? a.nom) && normaliser(a.name ?? a.nom) === normaliser(b.name ?? b.nom))
    return true;

  const orgA = valeur(a, IDENTIFIANTS_D_ORGANISATION);
  const orgB = valeur(b, IDENTIFIANTS_D_ORGANISATION);
  if (orgA && orgB) return orgA === orgB;

  const telA = valeur(a, ["phone", "telephone"]);
  return !!telA && telA === valeur(b, ["phone", "telephone"]);
}

/* ---------------------------------------------------------------------------
   LA CLÉ D'UN POINT DE SERVICE

   Elle doit changer quand le POINT change, et rester stable quand seule la
   découverte change. Un SIRET ne remplit ni l'une ni l'autre condition : il
   est partagé par tous les points d'une organisation, donc il les écrase les
   uns sur les autres.

   Mesuré : keyée sur le SIRET, la publication faisait d'Emmaüs Tourcoing et de
   la Croix-Rouge de Tourcoing un lieu chacun — ce qui va bien tant qu'une
   organisation n'a qu'un point, et casse dès qu'elle en a deux.

   L'ordre est donc : l'identifiant BAN de l'adresse (un point), sinon le nom
   normalisé plus les coordonnées arrondies (un point), sinon l'empreinte de la
   source (faute de mieux, et cela reste une découverte, pas un point).
--------------------------------------------------------------------------- */
export function clePointDeService(fiche) {
  const p = fiche || {};
  const ban = valeur(p, ["ban_id", "banId"]);
  if (ban) return "ban:" + ban;
  const nom = normaliser(p.name ?? p.nom).replace(/ /g, "_");
  const lat = Number(p.lat), lng = Number(p.lng);
  if (nom && Number.isFinite(lat) && Number.isFinite(lng))
    return "lieu:" + nom + "@" + lat.toFixed(4) + "," + lng.toFixed(4);
  const empreinte = p.source_fingerprint ?? p.sourceFingerprint;
  return empreinte ? "decouverte:" + String(empreinte) : null;
}
