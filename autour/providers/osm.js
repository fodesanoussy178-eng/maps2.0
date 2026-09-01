(function (root) {
  "use strict";
  function normaliser(item) {
    const p = item || {};
    const tags = Object.assign({}, p.tags || {});
    const finess = tags["ref:FR:FINESS"] || tags["ref:FR:FINESS:EGE"] || tags["ref:FR:FINESS:PM"] || "";
    const siret = tags["ref:FR:SIRET"] || "";
    const categoryFromTags = tags.amenity === "police" ? "securite" :
      ["hospital", "clinic", "doctors", "dentist"].includes(tags.amenity) || tags.healthcare ? "sante" :
      ["food_bank"].includes(tags.social_facility) || tags.amenity === "food_bank" ? "alimentaire" :
      ["shelter", "homeless_shelter", "emergency_shelter", "group_home", "assisted_living", "dormitory"].includes(tags.social_facility) ? "hebergement" :
      ["townhall"].includes(tags.amenity) || tags.government === "public_service" ? "mairie" :
      tags.office === "employment_agency" ? "emploi" :
      ["social_facility", "social_centre"].includes(tags.amenity) || tags.office === "association" || tags.office === "ngo" ? "asso" : "";
    const category = p.cat || p.category || categoryFromTags;
    const aideParTag = !!categoryFromTags;
    const brut = {
      kind: p.aideStructure ? "AideStructure" : "Place",
      aideStructure: p.aideStructure === true || aideParTag || ["alimentaire", "hebergement", "emploi", "sante", "securite", "mairie", "asso"].includes(category),
      autourId:p.autourId || undefined, name:p.titre || p.name, lat:p.lat, lng:p.lng,
      category, categories:p.categories || (category ? [category] : []), address:p.adresse || "",
      phone:p.tel || "", website:p.url || "", description:p.description || "",
      image:p.image || (tags.image && /^https?:\/\//i.test(tags.image) ? tags.image : ""),
      imageSource:p.imageSource || (tags.image && /^https?:\/\//i.test(tags.image) ? "site_officiel" : ""),
      imageSourceUrl:p.imageSourceUrl || p.url || "",
      openingHours:{weekdays:p.horaires || []}, openNow:p.ouvert,
      source:"openstreetmap", sourceRefs:Object.assign({},
        p.sourceRefs || {},
        {osmId:p.idOsm || p.osmId || p.id || ""},
        finess ? {finess} : {}, siret ? {siret} : {}),
      primaryType:p.type || "", type:p.type || "", tags,
      services:p.services || (p.service ? [p.service] : []),
      aliases:p.aliases || [], officialName:p.officialName || "",
      commune:p.commune || p.cp || "", postalCode:p.postalCode || "",
      updatedAt:p.updatedAt || null,
    };
    const aide = root.AutourAideStructures;
    return brut.aideStructure && aide ? aide.normaliser(brut) : root.AutourProviders.normaliser(brut);
  }
  const aideOsm = Object.freeze({normaliser});
  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    osm:Object.freeze({normaliser}), aideOsm,
  });
})(window);
