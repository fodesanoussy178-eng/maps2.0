(function (root) {
  "use strict";

  const AIDE = () => root.AutourAideStructures;

  function normaliser(record) {
    const p = record || {};
    const aide = p.aideStructure === true ||
      [p.cat, p.category, ...(Array.isArray(p.categories) ? p.categories : [])].some((category) =>
        ["alimentaire", "hebergement", "emploi", "sante", "securite", "mairie", "asso"].includes(category));
    if (!aide) return null;
    return AIDE() ? AIDE().normaliser(Object.assign({}, p, {
      source: "autour",
      autourId: p.autourId || p.id,
      sourceRefs: Object.assign({}, p.sourceRefs || {}, p.id ? { autourId: p.id } : {}),
    })) : null;
  }

  async function nearby(lat, lng, options) {
    const o = options || {};
    const rayon = Math.min(20000, Math.max(500, Number(o.radius) || 15000));
    return (o.records || []).map(normaliser).filter(Boolean)
      .filter((place) => AIDE().distanceM({lat, lng}, place) <= rayon);
  }

  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    aideAutour: Object.freeze({normaliser, nearby}),
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
