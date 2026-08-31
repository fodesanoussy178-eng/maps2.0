(function (root) {
  "use strict";

  /* ===================================================================
     COMBIEN EN MONTRER — ET POURQUOI PAS TOUT

     « Voir tout » a été débouché : il ne cachait plus rien. C'était la
     correction d'un défaut, pas une direction de produit — et poussée jusqu'au
     bout elle donne un annuaire. Or Autour ne répond pas à « qu'est-ce qui
     existe ici », mais à « qu'est-ce que je fais maintenant ». Deux cents
     réponses, c'est la même chose que zéro : personne ne choisit dans deux
     cents.

     Le compteur et la liste de « Maintenant » disent la même chose : la
     sélection éditorialisée qui sera effectivement présentée. Il n'existe
     aucun second niveau d'annuaire derrière ce créneau.

     MIEUX VAUT SEPT EXCELLENTES QUE DIX. Le plafond est un maximum, jamais un
     objectif : rien ici ne complète une liste courte pour atteindre le chiffre.
     =================================================================== */

  /* Maintenant : exactement la vitrine éditorialisée, jamais plus. */
  const MAINTENANT_APERCU = 3;

  /* Explorer : le plafond suit la densité de la zone. Une place de village
     avec quatre commerces n'a pas besoin de quinze lignes ; un centre-ville
     dense en mérite plus que dix, sinon on rate la moitié du quartier. */
  const EXPLORER = Object.freeze({ peu: 5, normale: 10, dense: 15 });
  const PLAFOND_ABSOLU = 20;

  /* Les seuils de densité portent sur ce que la zone CONTIENT, pas sur ce
     qu'on va montrer : c'est la richesse du terrain qui décide de la largeur
     de la vitrine. */
  const SEUIL_NORMALE = 12;
  const SEUIL_DENSE = 40;

  function densite(connus) {
    const n = Number(connus) || 0;
    if (n >= SEUIL_DENSE) return "dense";
    if (n >= SEUIL_NORMALE) return "normale";
    return "peu";
  }

  function limiteExplorer(connus) {
    return Math.min(EXPLORER[densite(connus)] || EXPLORER.normale, PLAFOND_ABSOLU);
  }

  function limiteMaintenant() { return MAINTENANT_APERCU; }

  /* Appliquer un plafond, c'est COUPER — jamais réordonner. L'ordre qui
     arrive ici porte déjà tout le travail du moteur : nature (event_now,
     session_soon, activity_now, open_now), pertinence, distance, diversité.
     Un tri de plus à la fin défferait ce travail sans rien savoir de lui. */
  function appliquer(liste, limite) {
    const l = Array.isArray(liste) ? liste : [];
    const max = Math.min(
      Number.isFinite(limite) ? limite : PLAFOND_ABSOLU, PLAFOND_ABSOLU);
    return l.length <= max ? l.slice() : l.slice(0, max);
  }

  root.AutourPlafonds = Object.freeze({
    MAINTENANT_APERCU, EXPLORER, PLAFOND_ABSOLU,
    SEUIL_NORMALE, SEUIL_DENSE,
    densite, limiteExplorer, limiteMaintenant, appliquer,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
