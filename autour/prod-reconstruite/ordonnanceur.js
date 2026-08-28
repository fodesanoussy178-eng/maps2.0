(function(root) {
  "use strict";
  function planifier(fn, options) {
    const delai = options && options.timeout || 200;
    if (typeof root.requestIdleCallback === "function") {
      const id2 = root.requestIdleCallback(fn, { timeout: delai });
      return () => {
        try {
          root.cancelIdleCallback(id2);
        } catch (e) {
        }
      };
    }
    const id = setTimeout(() => fn({
      didTimeout: true,
      timeRemaining: () => 0
    }), 0);
    return () => clearTimeout(id);
  }
  function differer(travail, options) {
    const o = options || {};
    let annule = false;
    const stop = planifier((echeance) => {
      if (annule) return;
      if (typeof o.valide === "function" && !o.valide()) return;
      travail(echeance);
    }, o);
    return () => {
      annule = true;
      stop();
    };
  }
  const LOT_MIN = 8;
  const BUDGET_MS = 8;
  function parLots(items, traiter, options) {
    const o = options || {};
    const liste = items || [];
    let i = 0;
    let annule = false;
    let stopCourant = null;
    return new Promise((fini) => {
      const tranche = (echeance) => {
        if (annule) return fini({ annule: true, traites: i });
        if (typeof o.valide === "function" && !o.valide()) {
          return fini({ annule: true, traites: i });
        }
        const debut = now();
        let dansCeLot = 0;
        while (i < liste.length) {
          traiter(liste[i], i);
          i += 1;
          dansCeLot += 1;
          const reste = echeance && typeof echeance.timeRemaining === "function" ? echeance.timeRemaining() : 0;
          if (dansCeLot >= LOT_MIN && (reste <= 1 || now() - debut >= BUDGET_MS)) break;
        }
        if (typeof o.apresLot === "function") o.apresLot(i, liste.length);
        if (i >= liste.length) return fini({ annule: false, traites: i });
        stopCourant = planifier(tranche, o);
      };
      stopCourant = planifier(tranche, o);
      if (o.recevoirAnnulation) {
        o.recevoirAnnulation(() => {
          if (annule) return;
          annule = true;
          if (stopCourant) stopCourant();
          fini({ annule: true, traites: i });
        });
      }
    });
  }
  function now() {
    try {
      return performance.now();
    } catch (e) {
      return Date.now();
    }
  }
  root.AutourOrdonnanceur = Object.freeze({
    planifier,
    differer,
    parLots,
    LOT_MIN,
    BUDGET_MS
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
