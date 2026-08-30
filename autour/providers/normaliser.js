(function (root) {
  "use strict";

  /* Le contrat d'échange entre les fournisseurs et Autour. Les composants UI
     ne lisent jamais une réponse Google, OSM ou DATAtourisme brute : ils ne
     reçoivent que ce format, puis le noyau existant le projette vers ses
     champs historiques pendant la transition. */
  function texte(value) {
    return String(value || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim();
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
    const position = Number.isFinite(lat) && Number.isFinite(lng)
      ? lat.toFixed(3) + "," + lng.toFixed(3) : "sans-position";
    return "autour:" + empreinte(texte(p.name || p.title || p.titre) + "|" + position);
  }

  function normaliser(input) {
    const p = input || {};
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const photos = (Array.isArray(p.photos) ? p.photos : []).filter((photo) => photo && photo.url)
      .map((photo) => ({
        url: String(photo.url),
        attribution: photo.attribution || "",
        source: photo.source || p.source || "",
      }));
    return {
      kind: p.kind || (p.aideStructure ? "AideStructure" : "Place"),
      aideStructure: p.aideStructure === true,
      autourId: autourId(p),
      name: String(p.name),
      lat, lng,
      category: p.category || "commerce",
      primaryType: p.primaryType || p.type || "",
      categories: Array.isArray(p.categories) ? p.categories.filter(Boolean) : [],
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
      openNow: p.openNow,
      officialName: p.officialName || "",
      aliases: Array.isArray(p.aliases) ? p.aliases.filter(Boolean) : [],
      institutionalType: p.institutionalType || p.institutional_type || "",
      type_structure: p.type_structure || p.typeStructure || "",
      service_type: p.service_type || p.serviceType || "",
      service_types: Array.isArray(p.service_types) ? p.service_types.filter(Boolean) : [],
      services: Array.isArray(p.services) ? p.services.filter(Boolean) : [],
      tags: Object.assign({}, p.tags || {}),
      commune: p.commune || p.city || "",
      postalCode: p.postalCode || p.code_postal || "",
      identifiers: Object.assign({}, p.identifiers || {}),
      provenance: Array.isArray(p.provenance) ? p.provenance : [],
      capacities: Object.assign({}, p.capacities || {}),
      capacityEvidence: Object.assign({}, p.capacityEvidence || {}),
      capacitesAide: Object.assign({}, p.capacitesAide || {}),
      confianceAide: p.confianceAide == null ? null : p.confianceAide,
      status: p.status || null,
      capacityHints: Object.assign({}, p.capacityHints || {}),
    };
  }

  /* Adaptateur temporaire : tout le reste de l'application peut continuer à
     consommer `lieux` sans connaître les fournisseurs. */
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
      kind: p.kind,
      aideStructure: p.aideStructure,
      officialName: p.officialName,
      aliases: p.aliases,
      institutionalType: p.institutionalType,
      type_structure: p.type_structure,
      service_type: p.service_type,
      service_types: p.service_types,
      services: p.services,
      tags: p.tags,
      commune: p.commune,
      postalCode: p.postalCode,
      identifiers: p.identifiers,
      provenance: p.provenance,
      capacities: p.capacities,
      capacityEvidence: p.capacityEvidence,
      capacitesAide: p.capacitesAide,
      confianceAide: p.confianceAide,
      status: p.status,
      capacityHints: p.capacityHints,
    };
  }

  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    normaliser, versInterne, autourId,
  });
})(window);
