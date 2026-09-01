(function (root) {
  "use strict";

  const AIDE = () => root.AutourAideStructures;
  const texte = (v) => String(v == null ? "" : v).trim();
  const liste = (v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
  const normal = (v) => texte(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const unique = (v) => [...new Set(liste(v).filter(Boolean).map(texte))];
  const sourcePhoto = (v) => {
    const source = texte(v);
    return ["data_inclusion", "dora", "finess", "service_public", "data_gouv"].includes(source)
      ? "institutional" : source || "institutional";
  };

  function photos(record) {
    const p = record || {};
    const direct = p.image || p.image_url || p.photo_url || p.photo;
    const items = Array.isArray(p.photos) ? p.photos.slice() : [];
    if (!items.length && direct) items.push({
      url: direct,
      attribution: p.imageAttribution || p.image_attribution || p.image_author || "",
      source: sourcePhoto(p.imageSource || p.image_source),
      sourceUrl: p.imageSourceUrl || p.image_source_url || p.lien_source || "",
      author: p.imageAuthor || p.image_author || "",
      license: p.imageLicense || p.image_license || "",
      updatedAt: p.imageUpdatedAt || p.image_updated_at || p.date_maj || null,
    });
    return items.filter((photo) => photo && (photo.url || photo.image_url)).map((photo) => ({
      url: photo.url || photo.image_url,
      attribution: photo.attribution || "",
      source: sourcePhoto(photo.source || photo.image_source),
      sourceUrl: photo.sourceUrl || photo.source_url || photo.image_source_url || p.lien_source || "",
      author: photo.author || photo.image_author || "",
      license: photo.license || photo.image_license || "",
      updatedAt: photo.updatedAt || photo.image_updated_at || null,
    }));
  }

  /* Ces correspondances lisent des champs contrôlés DORA : typology,
     typologyDisplay, nationalLabels et réseaux porteurs. La description et
     le nom restent des preuves textuelles faibles du moteur, jamais une
     classification de l'adapter. */
  const TYPES = Object.freeze({
    "mission locale": "mission_locale", "ml": "mission_locale", "maison de l emploi": "maison_de_l_emploi",
    "france travail": "france_travail", "cap emploi": "cap_emploi",
    "ccas": "ccas", "centre communal d action sociale": "ccas",
    "france services": "france_services", "france service": "france_services", "chrs": "chrs",
    "centre d hebergement et de reinsertion sociale": "chrs",
    "chu": "chu", "hebergement d urgence": "hebergement_urgence",
    "foyer de jeunes travailleurs": "foyer_jeunes_travailleurs", "fjt": "foyer_jeunes_travailleurs",
    "habitat jeunes": "residence_habitat_jeunes", "pension de famille": "pension_de_famille",
    "residence sociale": "residence_sociale", "cmp": "cmp", "cmpp": "cmpp",
    "centre de sante": "centre_de_sante", "centre de santé": "centre_de_sante",
    "centre social": "centre_social", "maison des adolescents": "maison_des_adolescents",
    "point information jeunesse": "point_information_jeunesse",
    "aide aux victimes": "aide_aux_victimes", "commissariat": "commissariat", "caf": "caf",
    "caisse d allocations familiales": "caf", "siae": "structure_insertion",
    "gendarmerie": "gendarmerie", "police municipale": "police_municipale",
  });
  const CATEGORIES = Object.freeze({
    mission_locale: ["emploi", "asso"], france_travail: ["emploi"], cap_emploi: ["emploi"],
    maison_de_l_emploi: ["emploi"], ccas: ["mairie", "asso"], france_services: ["mairie"],
    chrs: ["hebergement", "asso"], chu: ["hebergement", "asso"], hebergement_urgence: ["hebergement", "asso"],
    foyer_jeunes_travailleurs: ["hebergement", "emploi", "asso"], residence_habitat_jeunes: ["hebergement", "asso"],
    pension_de_famille: ["hebergement", "asso"], residence_sociale: ["hebergement", "asso"],
    cmp: ["sante", "asso"], cmpp: ["sante", "jeunes", "parler"], centre_de_sante: ["sante"],
    centre_social: ["asso", "famille"], maison_des_adolescents: ["jeunes", "parler", "famille"],
    point_information_jeunesse: ["jeunes"], aide_aux_victimes: ["securite", "asso"],
    commissariat: ["securite"], gendarmerie: ["securite"], police_municipale: ["securite"],
    association_alimentaire: ["alimentaire", "asso"], structure_insertion: ["emploi", "asso"],
    caf: ["asso", "mairie"],
  });
  const SERVICES = Object.freeze({
    mission_locale: ["employment", "job_seeking", "training", "orientation", "youth_counselling"],
    france_travail: ["employment", "job_seeking", "training"], cap_emploi: ["employment", "job_seeking"],
    maison_de_l_emploi: ["employment", "job_seeking", "training"], ccas: ["social_welfare", "administrative_assistance", "financial_advice", "family_support"],
    france_services: ["administrative_assistance", "digital_assistance"], caf: ["family_support", "administrative_assistance"],
    association_alimentaire: ["food_bank", "food"], structure_insertion: ["employment", "job_seeking", "training"],
    chrs: ["social_welfare"], chu: ["social_welfare"], hebergement_urgence: ["social_welfare"],
    foyer_jeunes_travailleurs: ["youth_counselling"], residence_habitat_jeunes: ["youth_counselling"],
    pension_de_famille: ["social_welfare"], residence_sociale: ["social_welfare"],
    cmp: ["psychological_support", "counselling"], cmpp: ["psychological_support", "counselling"],
    centre_de_sante: ["medical_care", "consultation"], centre_social: ["family_counselling", "social_welfare"],
    maison_des_adolescents: ["youth_counselling", "counselling", "family_counselling"],
    point_information_jeunesse: ["orientation", "youth_counselling"],
    aide_aux_victimes: ["victim_support", "legal_advice"], commissariat: ["protection", "complaint"],
    gendarmerie: ["protection", "complaint"], police_municipale: ["protection"],
  });

  function typologie(record) {
    const p = record || {};
    const controlled = [p.typology, p.typologyDisplay, p.type, p.type_structure,
      ...liste(p.nationalLabels), ...liste(p.reseaux_porteurs), ...liste(p.reseauxPorteurs)];
    for (const value of controlled) {
      const key = normal(value);
      if (!key) continue;
      if (TYPES[key]) return TYPES[key];
      const found = Object.entries(TYPES).find(([alias]) => key === alias || key.includes(alias) || alias.includes(key));
      if (found) return found[1];
    }
    if ([...liste(p.services), ...liste(p.service_types)].some((value) =>
      /food bank|food assistance|aide alimentaire|repas|distribution alimentaire/.test(normal(value))))
      return "association_alimentaire";
    return "";
  }

  function fields(record) {
    const p = record || {};
    const dataInclusion = p.source === "data_inclusion";
    const source = dataInclusion ? "data_inclusion" : "dora";
    const sourceId = p.id || p.slug || null;
    const address = p.address1 || p.address || p.adresse || "";
    const city = p.city || p.commune || p.nom_commune || "";
    const code = p.postalCode || p.code_postal || p.codePostal || "";
    const lat = p.latitude ?? p.lat;
    const lng = p.longitude ?? p.lon ?? p.lng;
    const type = typologie(p);
    const networks = unique([...(liste(p.reseaux_porteurs)), ...(liste(p.nationalLabels))]);
    const media = photos(p);
    return {
      source,
      dataProvider: p.dataProvider || (dataInclusion ? "dora" : "dora"),
      doraId: dataInclusion ? null : (p.doraId || sourceId),
      id: sourceId,
      name: p.name || p.nom,
      officialName: p.name || p.nom,
      lat, lng,
      address: [address, code, city].filter(Boolean).join(", "),
      postalCode: code, commune: city,
      category: (CATEGORIES[type] || [])[0] || "autre",
      categories: [...new Set([...(CATEGORIES[type] || []), ...(p.categories || [])])],
      primaryType: type,
      type_structure: type,
      institutionalType: p.typology || p.typologyDisplay || type,
      /* Une fiche data·inclusion porte déjà les services déclarés par son
         producteur. Réinjecter la liste générique du type (notamment
         `centre_social -> social_welfare`) créerait des capacités que la
         fiche n'a jamais publiées. Les réponses DORA historiques gardent
         leur enrichissement de typologie, car elles n'ont pas toujours le
         champ de services détaillé. */
      services: unique([...(dataInclusion ? [] : (SERVICES[type] || [])),
        ...(liste(p.services)), ...(liste(p.service_types)), ...networks]),
      description: p.description || p.fullDesc || p.shortDesc || "",
      phone: p.phone || p.telephone || "",
      email: p.email || p.courriel || "",
      website: p.website || p.site_web || p.url || p.lien_source || "",
      openingHours: p.openingHours || p.horaires_accueil || null,
      photos: media,
      isObsolete: p.isObsolete,
      status: p.status,
      updatedAt: p.modificationDate || p.date_maj || p.updatedAt || null,
      sourceRefs: Object.assign({}, p.sourceRefs || {}, {
        ...(p.siret ? {siret: p.siret} : {}),
        ...(dataInclusion && sourceId ? {dataInclusionId: sourceId} : {}),
        ...(!dataInclusion && sourceId ? {doraId: sourceId} : {}),
      }),
      officialUrl: p.officialUrl || p.lien_source || (p.slug ? "https://dora.inclusion.gouv.fr/structures/" + p.slug : null),
      provenance: [{
        source,
        id: dataInclusion ? (p.sourceRefs && p.sourceRefs.dataInclusionId) || sourceId : sourceId,
        url: p.officialUrl || p.lien_source || (p.slug ? "https://dora.inclusion.gouv.fr/structures/" + p.slug : null),
        updatedAt: p.modificationDate || p.date_maj || null,
        confidence: dataInclusion ? 0.88 : 0.90,
        ...(p.dataProvider ? {producer: p.dataProvider} : {}),
      }],
      sourceConfidence: dataInclusion ? 0.88 : 0.90,
    };
  }

  function normaliser(record) {
    if (!AIDE()) return null;
    const p = fields(record);
    if (!p.name || p.lat == null || p.lng == null) return null;
    return AIDE().normaliser(p);
  }

  async function nearby(lat, lng, options) {
    const o = options || {};
    const params = new URLSearchParams({
      lat: Number(lat).toFixed(5), lng: Number(lng).toFixed(5),
      radius: String(Math.min(20000, Math.max(500, Number(o.radius) || 15000))),
      needs: (o.needs || []).join(","), source: "dora",
    });
    const response = await fetch("/api/aide-structures?" + params, {signal: o.signal});
    if (!response.ok) return [];
    const body = await response.json();
    return (body.items || []).map(normaliser).filter(Boolean);
  }

  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    aideDora: Object.freeze({normaliser, nearby, typologie}),
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
