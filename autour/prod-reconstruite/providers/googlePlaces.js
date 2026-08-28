(function(root) {
  "use strict";
  const typesVersCategorie = Object.freeze({
    restaurant: "resto",
    pizza_restaurant: "resto",
    meal_delivery: "resto",
    fast_food_restaurant: "fastfood",
    meal_takeaway: "fastfood",
    hamburger_restaurant: "fastfood",
    cafe: "cafe",
    bakery: "cafe",
    coffee_shop: "cafe",
    bar: "bar",
    pub: "bar",
    night_club: "concert",
    movie_theater: "cinema",
    performing_arts_theater: "spectacle",
    library: "biblio",
    museum: "musee",
    art_gallery: "musee",
    park: "parc",
    coworking_space: "coworking",
    hospital: "sante",
    general_hospital: "sante",
    medical_center: "sante",
    medical_clinic: "sante",
    dental_clinic: "sante",
    dentist: "sante",
    medical_lab: "sante",
    physiotherapist: "sante",
    pharmacy: "sante",
    doctor: "sante",
    drugstore: "sante",
    local_government_office: "mairie",
    city_hall: "mairie",
    post_office: "mairie",
    government_office: "emploi",
    employment_agency: "emploi",
    association_or_organization: "asso",
    non_profit_organization: "asso",
    social_services_organization: "asso",
    welfare_organization: "asso",
    school: "ecole",
    university: "ecole",
    primary_school: "ecole",
    secondary_school: "ecole",
    tourist_attraction: "musee",
    supermarket: "commerce",
    grocery_store: "commerce",
    convenience_store: "commerce",
    clothing_store: "friperie",
    thrift_store: "friperie",
    store: "commerce"
  });
  const niveauxPrix = Object.freeze({
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4
  });
  const champs = [
    "places.id",
    "places.displayName",
    "places.location",
    "places.rating",
    "places.photos",
    "places.userRatingCount",
    "places.currentOpeningHours.openNow",
    "places.primaryType",
    "places.types",
    "places.formattedAddress",
    "places.priceLevel",
    "places.regularOpeningHours.weekdayDescriptions",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.accessibilityOptions.wheelchairAccessibleEntrance"
  ].join(",");
  function texteDescription(place) {
    const generative = place && place.generativeSummary || {};
    return generative.overview && generative.overview.text || generative.description && generative.description.text || place && place.editorialSummary && place.editorialSummary.text || "";
  }
  function attribution(photo) {
    return (photo && photo.authorAttributions || []).map((author) => ({
      name: author.displayName || "",
      url: author.uri || ""
    })).filter((author) => author.name);
  }
  function photoUrl(photo, apiKey) {
    if (!photo || !photo.name || !apiKey) return "";
    return "https://places.googleapis.com/v1/" + photo.name + "/media?maxHeightPx=640&skipHttpRedirect=false&key=" + encodeURIComponent(apiKey);
  }
  function normaliserPlace(place, config) {
    const p = place || {};
    const position = p.location || {};
    const nom = p.displayName && p.displayName.text;
    if (!nom || !Number.isFinite(Number(position.latitude)) || !Number.isFinite(Number(position.longitude))) return null;
    const photos = (p.photos || []).map((photo) => ({
      url: photoUrl(photo, config.apiKey),
      attribution: attribution(photo),
      source: "google_places"
    })).filter((photo) => photo.url);
    const resultat = {
      name: nom,
      lat: Number(position.latitude),
      lng: Number(position.longitude),
      category: typesVersCategorie[p.primaryType] || config.defaultCategory || "commerce",
      primaryType: p.primaryType || "",
      categories: p.types || [],
      photos,
      openingHours: { weekdayDescriptions: (p.regularOpeningHours || {}).weekdayDescriptions || [] },
      rating: Number.isFinite(Number(p.rating)) ? { value: Number(p.rating), count: Number(p.userRatingCount) || 0 } : null,
      phone: p.nationalPhoneNumber || "",
      website: p.websiteUri || "",
      description: texteDescription(p),
      address: p.formattedAddress || "",
      source: "google_places",
      openNow: p.currentOpeningHours && p.currentOpeningHours.openNow,
      priceLevel: niveauxPrix[p.priceLevel],
      accessibility: { wheelchair: (p.accessibilityOptions || {}).wheelchairAccessibleEntrance },
      sourceRefs: { googlePlaceId: p.id || (typeof p.name === "string" ? p.name.replace(/^places\//, "") : "") }
    };
    return root.AutourProviders.normaliser(resultat);
  }
  async function request(path, config, options) {
    if (!config || !config.apiKey) return [];
    const r = await fetch("https://places.googleapis.com/v1/" + path, options);
    if (!r.ok) {
      const erreur = new Error("Google Places HTTP " + r.status);
      erreur.status = r.status;
      throw erreur;
    }
    return r.json();
  }
  async function nearby(lat, lng, config, options) {
    const body = { maxResultCount: 20, locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: options && options.radius || 1500 } } };
    if (options && options.types) body.includedTypes = options.types;
    const json = await request("places:searchNearby", config, {
      method: "POST",
      signal: options && options.signal,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": config.apiKey, "X-Goog-FieldMask": champs },
      body: JSON.stringify(body)
    });
    return (json.places || []).map((place) => normaliserPlace(place, config)).filter(Boolean);
  }
  async function search(query, lat, lng, config, options) {
    const json = await request("places:searchText", config, {
      method: "POST",
      signal: options && options.signal,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": config.apiKey, "X-Goog-FieldMask": champs },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "fr",
        maxResultCount: 12,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 6e3 } }
      })
    });
    return (json.places || []).map((place) => normaliserPlace(place, config)).filter(Boolean);
  }
  async function details(placeId, config) {
    if (!placeId || !config || !config.apiKey) return null;
    const json = await request(
      "places/" + encodeURIComponent(placeId) + "?languageCode=fr",
      config,
      { headers: {
        "X-Goog-Api-Key": config.apiKey,
        "X-Goog-FieldMask": "id,displayName,location,primaryType,formattedAddress,rating,userRatingCount,priceLevel,editorialSummary,generativeSummary,websiteUri,nationalPhoneNumber,regularOpeningHours,currentOpeningHours,accessibilityOptions.wheelchairAccessibleEntrance,photos"
      } }
    );
    return normaliserPlace(json, config);
  }
  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    googlePlaces: Object.freeze({ nearby, search, details, normaliserPlace, photoUrl, typesVersCategorie, niveauxPrix, champs })
  });
})(window);
