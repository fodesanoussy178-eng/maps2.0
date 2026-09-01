(function (root) {
  "use strict";

  const AIDE = () => root.AutourAideStructures;

  function normaliser(record) {
    const p = record || {};
    /* La liste permanente contient aussi des commerces classés `friperie`,
       `sante` ou `mairie`. Une catégorie technique ne suffit donc jamais à
       transformer un commerce en structure sociale : Autour doit avoir
       explicitement marqué la fiche comme AideStructure. */
    const aide = p.aideStructure === true || p.kind === "AideStructure";
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
