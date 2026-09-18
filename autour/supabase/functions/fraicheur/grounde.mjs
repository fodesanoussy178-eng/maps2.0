/* ===========================================================================
   VOIE 3 — LE MODÈLE GROUNDÉ, ET SEULEMENT LE RELIQUAT

   POURQUOI LE GROUNDING EST OBLIGATOIRE

   Un modèle interrogé sans recherche produit une réponse plausible tirée de
   son entraînement. C'est ce qui a donné, dans `place_enrichments`,
   44 fiches à confiance moyenne 0,57 et zéro horaire structuré : des phrases
   bien formées sur des lieux que personne n'était allé voir.

   Avec la recherche activée, la réponse est adossée à des pages, et leurs
   adresses reviennent dans la réponse de l'API. C'est ce qui distingue un
   EXTRACTEUR d'un ORACLE — et c'est la seule chose qu'on demande ici.

   ON NE DEMANDE JAMAIS « CE LIEU EST-IL ENCORE OUVERT ». On demande d'extraire
   un statut de ce qui a été trouvé. La différence n'est pas rhétorique : la
   première question appelle une opinion, la seconde une lecture.

   LA RÈGLE MÉCANIQUE

   Pas d'URL exploitable parmi les citations → `inconnu` → aucune écriture. Ce
   fichier l'applique dans le code appelant, pas dans l'invite : une consigne
   écrite dans un prompt est une intention, une vérification en est une.

   LA FORME DE LA RÉPONSE a été mesurée par `enrichir-lieu` : les vraies
   sources sont les annotations `url_citation` posées par l'API à côté du
   texte, jamais les URL écrites dans le texte — celles-là, le modèle peut les
   inventer, et une citation inventée est exactement ce qu'on interdit.
=========================================================================== */

import { INCONNU, dateISO, urlExploitable, validerContrat } from "./voies.mjs";

export const POINT_DE_TERMINAISON =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

/* ---- L'INVITE -----------------------------------------------------------
   Nettoyée avant d'approcher le modèle : le nom d'un lieu vient d'une base
   qu'un contributeur alimente, donc d'un inconnu. Ni saut de ligne, ni
   caractère de contrôle, ni ponctuation qui permette d'écrire une consigne. */
export function nettoyer(valeur, maximum = 120) {
  return String(valeur == null ? "" : valeur)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["'`<>{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function invite(objet) {
  const o = objet || {};
  const nom = nettoyer(o.nom);
  const commune = nettoyer(o.commune, 60);
  const adresse = nettoyer(o.adresse, 120);
  return [
    "Tu es un extracteur. Tu ne réponds qu'à partir des pages trouvées par la recherche.",
    "",
    "Objet : " + nom + (commune ? " à " + commune : "") + (adresse ? ", " + adresse : ""),
    "",
    "Cherche les pages publiques qui parlent de cet objet, puis EXTRAIS de ce que tu as trouvé :",
    "  · statut : « ouvert » si une page atteste qu'il fonctionne toujours,",
    "    « ferme_definitivement » si une page atteste une fermeture définitive,",
    "    « inconnu » dans TOUS les autres cas, y compris si tu hésites ;",
    "  · date_information : la date de la page qui l'atteste, au format AAAA-MM-JJ ;",
    "  · url_source : l'adresse exacte de cette page ;",
    "  · confiance : entre 0 et 1.",
    "",
    "N'extrais AUCUN horaire : ce n'est pas demandé et ce ne sera pas lu.",
    "Si aucune page ne tranche, réponds « inconnu ». Une réponse « inconnu » est",
    "un résultat correct et attendu ; une réponse inventée ne l'est jamais.",
    "",
    'Réponds par un seul objet JSON : {"statut":"…","date_information":"…","url_source":"…","confiance":0.0}',
  ].join("\n");
}

export function corpsRequete(objet, modele) {
  return {
    model: modele,
    input: [{ type: "text", text: invite(objet) }],
    tools: [{ type: "google_search" }],
  };
}

/* ---- LA LECTURE DE LA RÉPONSE ------------------------------------------ */

const typeEtape = (etape) => String((etape && (etape.type ?? etape.kind)) ?? "");

export function etapesDe(reponse) {
  const p = reponse && typeof reponse === "object" ? reponse : {};
  for (const champ of ["steps", "etapes", "outputs", "output", "candidates"]) {
    if (Array.isArray(p[champ])) return p[champ].filter((e) => e && typeof e === "object");
  }
  return [];
}

/* Les annotations, et rien qu'elles. Une URL tapée par le modèle dans son
   texte n'est pas une source : c'est une chaîne de caractères plausible. */
export function citations(etapes) {
  const sorties = [];
  for (const etape of etapes || []) {
    if (typeEtape(etape) !== "model_output") continue;
    for (const bloc of Array.isArray(etape.content) ? etape.content : []) {
      const brutes = bloc && bloc.annotations;
      if (!Array.isArray(brutes)) continue;
      for (const annotation of brutes) {
        if (!annotation || typeof annotation !== "object") continue;
        if (String(annotation.type ?? "") !== "url_citation") continue;
        const url = urlExploitable(annotation.url ?? annotation.uri);
        if (url) sorties.push(url);
        if (sorties.length >= 20) return sorties;
      }
    }
  }
  return sorties;
}

export function texteDesEtapes(etapes) {
  const morceaux = [];
  for (const etape of etapes || []) {
    if (typeEtape(etape) !== "model_output") continue;
    for (const bloc of Array.isArray(etape.content) ? etape.content : []) {
      if (bloc && typeof bloc.text === "string") morceaux.push(bloc.text);
    }
  }
  return morceaux.join("\n");
}

export function extraireObjet(texte) {
  const source = String(texte == null ? "" : texte);
  const debut = source.indexOf("{");
  const fin = source.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  try {
    const valeur = JSON.parse(source.slice(debut, fin + 1));
    return valeur && typeof valeur === "object" ? valeur : null;
  } catch {
    return null;
  }
}

/* Le même hôte, pas la même URL : le modèle peut citer la page d'accueil d'un
   site et raconter la page profonde. Comparer les domaines accepte la
   première, refuse une adresse qui ne vient d'aucune recherche. */
function memeHote(a, b) {
  try { return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase(); }
  catch { return false; }
}

/* LE VERDICT. Trois refus successifs, tous mécaniques :
     1. pas de citation du tout → `inconnu` ;
     2. l'URL annoncée ne vient d'aucune citation → `inconnu` ;
     3. le contrat de sortie n'est pas respecté → `inconnu`.
   Chacun rend `inconnu`, donc aucune écriture. Une voie qui se tait ne coûte
   que son appel ; une voie qui invente coûte la confiance de tout le reste. */
export function verdict(reponseApi) {
  const etapes = etapesDe(reponseApi);
  const sources = citations(etapes);
  if (!sources.length) return { ...INCONNU, refus: "aucune_citation" };

  const objet = extraireObjet(texteDesEtapes(etapes));
  if (!objet) return { ...INCONNU, refus: "reponse_illisible" };

  const annoncee = urlExploitable(objet.url_source);
  const adossee = annoncee && sources.some((s) => s === annoncee || memeHote(s, annoncee))
    ? annoncee
    /* Le modèle n'a pas cité sa page, mais la recherche en a rapporté une :
       on garde la première citation plutôt que l'adresse qu'il a écrite. */
    : (String(objet.statut ?? "") === "ferme_definitivement" ? sources[0] : null);
  if (!adossee) return { ...INCONNU, refus: "url_non_adossee" };

  const valide = validerContrat({
    statut: objet.statut,
    date_information: dateISO(objet.date_information),
    url_source: adossee,
    confiance: objet.confiance,
  });
  if (valide.statut === "inconnu") return { ...INCONNU, refus: "contrat_non_respecte" };
  return { ...valide, citations: sources.length };
}
