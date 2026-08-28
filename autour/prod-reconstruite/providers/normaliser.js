(function(root) {
  "use strict";
  function texte(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function empreinte(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function autourId(input) {
    const p = input || {};
    if (p.autourId) return String(p.autourId);
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const position = Number.isFinite(lat) && Number.isFinite(lng) ? lat.toFixed(3) + "," + lng.toFixed(3) : "sans-position";
    return "autour:" + empreinte(texte(p.name || p.title || p.titre) + "|" + position);
  }
  function normaliser(input) {
    const p = input || {};
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const helpCategories = Array.isArray(p.help_categories) ? p.help_categories.filter(Boolean) : Array.isArray(p.helpCategories) ? p.helpCategories.filter(Boolean) : p.help_category ? [p.help_category] : [];
    const serviceTypes = Array.isArray(p.service_types) ? p.service_types.filter(Boolean) : Array.isArray(p.serviceTypes) ? p.serviceTypes.filter(Boolean) : p.service_type ? [p.service_type] : [];
    const photos = (Array.isArray(p.photos) ? p.photos : []).filter((photo) => photo && photo.url).map((photo) => ({
      url: String(photo.url),
      attribution: photo.attribution || "",
      source: photo.source || p.source || ""
    }));
    return {
      autourId: autourId(p),
      name: String(p.name),
      lat,
      lng,
      category: p.category || "commerce",
      primaryType: p.primaryType || p.type || "",
      institutionalType: p.institutionalType || "",
      categories: Array.isArray(p.categories) ? p.categories.filter(Boolean) : [],
      services: Array.isArray(p.services) ? p.services.filter(Boolean) : [],
      tags: p.tags && typeof p.tags === "object" ? p.tags : {},
      help_category: p.help_category || helpCategories[0] || "",
      help_categories: helpCategories,
      service_type: p.service_type || serviceTypes[0] || p.institutionalType || "",
      service_types: serviceTypes,
      classification_source: p.classification_source || p.classificationSource || p.source || "",
      classification_confidence: p.classification_confidence == null ? null : Number(p.classification_confidence),
      aliases: Array.isArray(p.aliases) ? p.aliases.filter(Boolean) : [],
      officialName: p.officialName || "",
      provenance: Array.isArray(p.provenance) ? p.provenance : [],
      photos,
      openingHours: p.openingHours || null,
      rating: p.rating || null,
      phone: p.phone || "",
      website: p.website || "",
      description: p.description || "",
      address: p.address || "",
      events: Array.isArray(p.events) ? p.events : [],
      source: p.source || "unknown",
      sourceRefs: Object.assign({}, p.sourceRefs || {}),
      updatedAt: p.updatedAt || null,
      accessibility: p.accessibility || null,
      priceLevel: p.priceLevel == null ? null : p.priceLevel,
      openNow: p.openNow
    };
  }
  function versInterne(input) {
    const p = normaliser(input);
    if (!p) return null;
    const premierePhoto = p.photos[0] || null;
    const heures = p.openingHours || {};
    return {
      id: p.autourId,
      autourId: p.autourId,
      titre: p.name,
      lat: p.lat,
      lng: p.lng,
      cat: p.category,
      type: p.primaryType || "",
      categories: p.categories,
      tags: p.tags,
      help_category: p.help_category,
      help_categories: p.help_categories,
      service_type: p.service_type,
      service_types: p.service_types,
      classification_source: p.classification_source,
      classification_confidence: p.classification_confidence,
      image: premierePhoto ? premierePhoto.url : "",
      imageSource: premierePhoto ? premierePhoto.source : "",
      imageAttribution: premierePhoto ? premierePhoto.attribution : "",
      horaires: heures.weekdayDescriptions || heures.weekdays || null,
      ouvert: p.openNow,
      note: p.rating && Number(p.rating.value),
      avis: p.rating && Number(p.rating.count),
      tel: p.phone,
      url: p.website,
      description: p.description,
      adresse: p.address,
      sourceRefs: p.sourceRefs,
      idGoogle: p.sourceRefs.googlePlaceId || "",
      idOsm: p.sourceRefs.osmId || "",
      idDatatourisme: p.sourceRefs.datatourismeId || "",
      prixN: p.priceLevel,
      pmr: p.accessibility && p.accessibility.wheelchair,
      source: p.source,
      updatedAt: p.updatedAt,
      institutionalType: p.institutionalType,
      services: p.services,
      aliases: p.aliases,
      officialName: p.officialName,
      provenance: p.provenance
    };
  }
  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    normaliser,
    versInterne,
    autourId
  });
})(window);
