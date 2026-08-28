(function(root) {
  "use strict";
  async function nearby(lat, lng, options) {
    const signal = options && options.signal;
    const r = await fetch("/api/datatourisme?lat=" + encodeURIComponent(Number(lat).toFixed(2)) + "&lng=" + encodeURIComponent(Number(lng).toFixed(2)), { signal });
    if (!r.ok) return [];
    const json = await r.json();
    return (json.items || []).map((item) => root.AutourProviders.normaliser({
      autourId: item.autourId || void 0,
      name: item.titre || item.name,
      lat: item.lat,
      lng: item.lng,
      category: item.cat || item.category,
      categories: item.categories || [],
      photos: item.image ? [{ url: item.image, source: item.imageSource || "datatourisme" }] : [],
      openingHours: { weekdays: item.horaires || [] },
      description: item.description || "",
      address: item.adresse || "",
      source: "datatourisme",
      sourceRefs: { datatourismeId: item.id || item.uuid || "" },
      updatedAt: item.updatedAt || null
    })).filter(Boolean);
  }
  root.AutourProviders = Object.assign(root.AutourProviders || {}, { datatourisme: Object.freeze({ nearby }) });
})(window);
