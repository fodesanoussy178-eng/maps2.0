(function(root) {
  "use strict";
  function normaliser(item) {
    const p = item || {};
    return root.AutourProviders.normaliser({
      autourId: p.autourId || void 0,
      name: p.titre || p.name,
      lat: p.lat,
      lng: p.lng,
      category: p.cat || p.category,
      categories: p.categories || [],
      address: p.adresse || "",
      phone: p.tel || "",
      website: p.url || "",
      description: p.description || "",
      tags: p.tags || {},
      openingHours: { weekdays: p.horaires || [] },
      openNow: p.ouvert,
      aliases: p.aliases || [],
      officialName: p.officialName || "",
      institutionalType: p.institutionalType || "",
      services: p.services || [],
      provenance: p.provenance || [],
      source: "openstreetmap",
      sourceRefs: { osmId: p.idOsm || p.osmId || p.id || "" }
    });
  }
  root.AutourProviders = Object.assign(root.AutourProviders || {}, { osm: Object.freeze({ normaliser }) });
})(window);
