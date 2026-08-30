/* Probe OSM conservée avec la requête du 30/08/2026.
   L'application continue d'interroger Overpass en direct ; cet extrait rend
   l'audit et les tests reproductibles sur les structures sensibles. Les
   compteurs bruts de la requête sont conservés dans metadata : 65 objets dans
   Tourcoing, 692 objets dans le cercle de 12 km, avant normalisation. */
export const metadata = Object.freeze({
  source: "openstreetmap",
  snapshotDate: "2026-08-30",
  rawCandidateCountTourcoing: 65,
  rawCandidateCount12km: 692,
  overpass: "https://overpass-api.de/api/interpreter",
  centre: { lat: 50.72373, lng: 3.160758 },
  rayonMetres: 12000,
});

const o = (id, titre, lat, lng, tags, adresse = "", telephone = "") => ({
  id, idOsm: id, titre, lat, lng, tags,
  cat: tags.amenity === "police" ? "securite" :
    tags.social_facility === "food_bank" ? "alimentaire" :
    tags.amenity === "social_centre" ? "asso" :
    tags.healthcare || tags.amenity === "hospital" ? "sante" : "asso",
  type: tags.amenity || tags.social_facility || tags.healthcare || "",
  adresse, tel: telephone, url: tags.website || "",
  officialName: tags.official_name || titre,
  source: "openstreetmap",
});

export default [
  o("node/639569442", "Police nationale", 50.724982, 3.1621543,
    { amenity: "police", official_name: "Commissariat de police de Tourcoing", operator: "Police nationale", phone: "+33 3 20 69 27 27" },
    "Tourcoing", "+33 3 20 69 27 27"),
  o("way/753568465", "Police Municipale", 50.7259696, 3.147761,
    { amenity: "police", "police:FR": "police_municipale", opening_hours: "Mo-Sa 07:00-01:30; Su 08:00-21:30" },
    "2 Contour de l'Abattoir, 59200 Tourcoing"),
  o("way/753568822", "Hôtel de police", 50.7271204, 3.148859,
    { amenity: "police", operator: "Police nationale", "police:FR": "police", official_name: "Hôtel de police de Tourcoing" },
    "49 Avenue de la Fin de la Guerre, 59200 Tourcoing"),
  o("node/8736330455", "Croix-Rouge Française - Unité Locale de Tourcoing", 50.7199778, 3.1419788,
    { amenity: "social_facility", social_facility: "food_bank", "social_facility:for": "underprivileged", brand: "Croix-Rouge Française", description: "Unité Locale de la Croix-Rouge Française de Tourcoing", website: "https://nord.croix-rouge.fr/tourcoing/" },
    "2 Rue de la Vigne, 59200 Tourcoing", "+33 3 20 25 37 94"),
  o("node/12487492410", "Mission locale", 50.7092946, 3.1668809,
    { amenity: "social_facility", social_facility: "outreach", "social_facility:for": "juvenile", description: "Mission Emploi Lys Tourcoing", website: "https://www.la-melt.fr/" },
    "Mission Emploi Lys Tourcoing, 200 rue de Roubaix, 59200 Tourcoing", "+33 3 20 28 82 20"),
  o("node/5981850121", "CCAS", 50.7248345, 3.1577982,
    { amenity: "social_facility", social_facility: "outreach", operator: "Mairie de Tourcoing" },
    "26 Rue de la Bienfaisance, 59200 Tourcoing", "+33 3 20 28 01 50"),
  o("node/7596218040", "Centre Social Marlière", 50.7381943, 3.1879648,
    { amenity: "social_centre" }, "Tourcoing"),
  o("node/11930066424", "Maison des Jeunes et de la Culture - Centre social La Fabrique", 50.7210317, 3.1431709,
    { amenity: "social_facility", "social_facility:for": "juvenile" }, "Tourcoing"),
  o("node/12433414389", "Centre d'information et d'orientation", 50.7207815, 3.1580586,
    { amenity: "social_facility", social_facility: "outreach", "social_facility:for": "juvenile", short_name: "CIO" },
    "2 rue Fidèle-Lehoucq, 59200 Tourcoing", "+33 3 20 25 93 03"),
  o("node/12492037123", "Point information jeunesse", 50.7242143, 3.1626591,
    { amenity: "social_facility", social_facility: "outreach", "social_facility:for": "juvenile" },
    "16 rue Paul-Doumer, 59200 Tourcoing", "+33 3 20 24 24 42"),
  o("node/12486884591", "Maison de santé Croix-Rouge", 50.7309677, 3.1790531,
    { healthcare: "centre", "ref:FR:FINESS": "590070876", "ref:FR:SIRET": "92419342800019" },
    "Tourcoing"),
  o("node/13529274557", "CeGIDD - CH Gustave Dron - Tourcoing", 50.7439391, 3.1817713,
    { amenity: "social_facility", healthcare: "counselling", "healthcare:speciality": "venereology", social_facility: "healthcare" },
    "155 Rue du Président Coty, 59200 Tourcoing", "+33 3 20 69 46 05"),
  o("node/12495682423", "Foyer Regain", 50.7231747, 3.1489634,
    { amenity: "social_facility", social_facility: "group_home", "social_facility:for": "underprivileged", "ref:FR:FINESS": "590062550" },
    "Tourcoing"),
  o("node/8037384392", "Centre social 3 villes", 50.6687589, 3.2010693,
    { amenity: "social_centre" }, "93 Rue du Docteur Albert Schweitzer, 59510 Hem"),
];
