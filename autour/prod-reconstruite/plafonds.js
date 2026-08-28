(function(root) {
  "use strict";
  const MAINTENANT_APERCU = 3;
  const MAINTENANT_TOUT = 10;
  const EXPLORER = Object.freeze({ peu: 5, normale: 10, dense: 15 });
  const PLAFOND_ABSOLU = 20;
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
  function limiteMaintenant() {
    return MAINTENANT_TOUT;
  }
  function appliquer(liste, limite) {
    const l = Array.isArray(liste) ? liste : [];
    const max = Math.min(
      Number.isFinite(limite) ? limite : PLAFOND_ABSOLU,
      PLAFOND_ABSOLU
    );
    return l.length <= max ? l.slice() : l.slice(0, max);
  }
  root.AutourPlafonds = Object.freeze({
    MAINTENANT_APERCU,
    MAINTENANT_TOUT,
    EXPLORER,
    PLAFOND_ABSOLU,
    SEUIL_NORMALE,
    SEUIL_DENSE,
    densite,
    limiteExplorer,
    limiteMaintenant,
    appliquer
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
