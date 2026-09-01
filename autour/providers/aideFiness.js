(function (root) {
  "use strict";

  const AIDE = () => root.AutourAideStructures;
  const texte = (v) => String(v == null ? "" : v).trim();
  const liste = (v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
  const normal = (v) => texte(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const unique = (v) => [...new Set(liste(v).filter(Boolean).map(texte))];

  /* Les codes d'activité sont ceux du champ FINESS
     `categorieentiteGeographiqueExercice`, donc une donnée structurée. Les
     libellés déjà fournis par un export aplati sont également acceptés. Un
     code inconnu reste candidat mais n'est pas transformé en aide par son
     nom : il sera refusé par la taxonomie faute de preuve. */
  const TYPES_PAR_CODE = Object.freeze({
    "101": "hopital", "109": "hopital", "124": "centre_de_sante", "146": "hopital",
    "156": "cmp", "189": "cmpp", "197": "centre_social", "202": "residence_sociale",
    "207": "accueil_de_jour", "209": "service_social", "214": "chrs", "219": "chu",
    "221": "bapu", "223": "pmi", "228": "planning_familial", "246": "structure_insertion",
    "247": "structure_insertion", "249": "structure_insertion", "257": "foyer_jeunes_travailleurs",
    "258": "pension_de_famille", "259": "residence_sociale", "286": "structure_insertion",
    "292": "cmp", "295": "service_social", "300": "structure_insertion", "330": "structure_insertion",
    "355": "hopital", "365": "hopital", "382": "foyer_hebergement", "412": "logement_accompagne",
    "425": "cmp", "437": "foyer_hebergement", "443": "hebergement_urgence", "445": "service_social",
    "603": "centre_de_sante", "604": "centre_de_sante", "611": "centre_de_sante", "617": "centre_de_sante",
    "620": "pharmacie", "637": "centre_de_sante", "638": "cegidd", "640": "service_social",
    "645": "centre_de_sante", "646": "centre_de_sante",
  });
  const TYPES_PAR_LIBELLE = Object.freeze({
    "centre medico psychologique": "cmp", "centre medico psychologique pour enfants": "cmpp",
    "cmp": "cmp", "cmpp": "cmpp", "centre de sante": "centre_de_sante",
    "centre de soins infirmiers": "centre_de_sante", "chrs": "chrs", "centre d hebgt": "chrs",
    "centre d hebergement": "chrs", "chu": "chu", "foyer de jeunes travailleurs": "foyer_jeunes_travailleurs",
    "fjt": "foyer_jeunes_travailleurs", "pension de famille": "pension_de_famille",
    "residence sociale": "residence_sociale", "centre de planification": "planning_familial",
    "protection maternelle": "pmi", "maison relais": "pension_de_famille", "commissariat": "commissariat",
    "gendarmerie": "gendarmerie",
  });
  const CATEGORIES = Object.freeze({
    hopital: ["sante"], centre_de_sante: ["sante"], cmp: ["sante", "parler"], cmpp: ["sante", "parler", "jeunes"],
    residence_sociale: ["hebergement"], accueil_de_jour: ["hebergement", "asso"], service_social: ["asso", "mairie"],
    chrs: ["hebergement", "asso"], chu: ["hebergement", "asso"], bapu: ["parler", "jeunes"], pmi: ["sante", "famille"],
    planning_familial: ["sante", "famille"], structure_insertion: ["emploi", "asso"], foyer_jeunes_travailleurs: ["hebergement", "jeunes"],
    pension_de_famille: ["hebergement"], foyer_hebergement: ["hebergement"], logement_accompagne: ["hebergement"],
    pharmacie: ["sante"], cegidd: ["sante"], commissariat: ["securite"], gendarmerie: ["securite"], centre_social: ["famille", "asso"],
  });

  function details(record) {
    const p = record || {};
    /* Le pré-calcul peut contenir une ligne publiée par FINESS à l'intérieur
       du référentiel national data·inclusion. Elle est déjà aplatie et
       géolocalisée : la repasser dans le parseur FINESS imbriqué perdrait ses
       catégories et la ferait devenir une fiche sans type. Sa provenance
       reste honnêtement data·inclusion (et non FINESS direct). */
    if (p.source === "data_inclusion") {
      const refs = p.sourceRefs || {};
      const finessEge = p.finessEge || refs.finessEge;
      const finessPm = p.finessPm || refs.finessPm;
      return {
        name: texte(p.name || p.nom || p.officialName),
        officialName: texte(p.name || p.nom || p.officialName),
        lat: p.lat ?? p.latitude, lng: p.lng ?? p.longitude,
        address: p.address || p.adresse || "",
        postalCode: p.postalCode || p.code_postal || "",
        commune: p.commune || p.city || "",
        category: p.category || (p.categories || [])[0] || "autre",
        categories: p.categories || [],
        primaryType: p.primaryType || p.type_structure || p.typology || "",
        type_structure: p.type_structure || p.typology || "",
        institutionalType: p.institutionalType || p.type_structure || "",
        services: unique(p.services || p.service_types),
        description: texte(p.description),
        phone: p.phone || p.telephone || "",
        photos: Array.isArray(p.photos) ? p.photos : [],
        image: p.image || p.image_url || "",
        imageSource: p.imageSource || p.image_source || "",
        imageAttribution: p.imageAttribution || p.image_attribution || "",
        imageSourceUrl: p.imageSourceUrl || p.image_source_url || "",
        imageAuthor: p.imageAuthor || p.image_author || "",
        imageLicense: p.imageLicense || p.image_license || "",
        imageUpdatedAt: p.imageUpdatedAt || p.image_updated_at || null,
        source: "data_inclusion", dataProvider: p.dataProvider || "finess",
        finessEge, finessPm, siret: p.siret || refs.siret,
        sourceRefs: Object.assign({}, refs, { ...(finessEge ? {finessEge} : {}),
          ...(finessPm ? {finessPm} : {}), ...(p.siret ? {siret: p.siret} : {}) }),
        updatedAt: p.updatedAt || p.date_maj || null,
        provenance: p.provenance || [{ source: "data_inclusion",
          id: p.id || null, url: p.officialUrl || p.lien_source || null,
          updatedAt: p.updatedAt || null, confidence: p.sourceConfidence || .88 }],
        officialUrl: p.officialUrl || p.lien_source || null,
        sourceConfidence: p.sourceConfidence || .88,
      };
    }
    const pm = p.informationsGeneralesPMEJ || p.pm || p;
    const ege = liste(p.ege)[0] || {};
    const e = p.informationsGeneralesEGE || ege.informationsGeneralesEGE || ege || p;
    const categoryCode = texte(p.categorieentiteGeographiqueExercice || p.codeCategorie || p.code_categorie ||
      ege.categorieentiteGeographiqueExercice || e.categorieentiteGeographiqueExercice);
    const controlled = [p.typeStructure, p.type_structure, p.typeEtablissement, p.categorie, p.libelleCategorie,
      p.activite, e.typeStructure, e.categorie, e.libelleCategorie, ege.typeStructure, ege.categorie];
    let type = TYPES_PAR_CODE[categoryCode] || "";
    for (const value of controlled) {
      const key = normal(value);
      const found = Object.entries(TYPES_PAR_LIBELLE).find(([alias]) => key === alias || key.includes(alias));
      if (found) { type = found[1]; break; }
    }
    const addressValue = ege.adresse || p.adresse || e.adresse || pm.adresse;
    const address = liste(addressValue)[0] || {};
    const addressText = typeof address === "string" ? address :
      (address.ligneUne || address.ligneQuatre || "");
    const geo = address.coordonneesGeographique || p.coordonneesGeographique || {};
    const lat = p.lat ?? p.latitude ?? geo.coordonneeY;
    const lng = p.lng ?? p.longitude ?? geo.coordonneeX;
    const name = texte(p.name || p.nom || e.nomEgeLong || e.nomEgeCourt || ege.nomEgeLong || ege.nomEgeCourt ||
      pm.denominationLonguePmSmsse || pm.denominationPm);
    const finessEge = e.numFinessEge || ege.numFinessEge || p.numFinessEge;
    const finessPm = pm.numFinessPm || p.numFinessPm;
    const siret = e.siret || ege.siret || p.siret;
    const contacts = liste(ege.contact || p.contact);
    const telephone = p.telephone || p.telephones ||
      (contacts[0] && contacts[0].telecom && contacts[0].telecom.telephone);
    const phone = liste(telephone)[0] || "";
    return {
      name, officialName: name, lat, lng,
      address: [addressText, address.codePostal || p.codePostal, address.ligneAcheminement || p.commune].filter(Boolean).join(", "),
      postalCode: address.codePostal || p.codePostal, commune: address.ligneAcheminement || p.commune,
      category: (CATEGORIES[type] || [])[0] || "autre",
      categories: CATEGORIES[type] || [], primaryType: type, type_structure: type,
      institutionalType: categoryCode ? "FINESS:" + categoryCode : type,
      services: unique(p.services || p.servicesDeclarés), description: texte(p.description || e.description), phone,
      source: "finess", finessEge, finessPm, siret,
      sourceRefs: Object.assign({}, p.sourceRefs || {}, { ...(finessEge ? {finessEge} : {}), ...(finessPm ? {finessPm} : {}), ...(siret ? {siret} : {}) }),
      dateFermeture: e.dateFermeture || ege.dateFermeture || pm.dateFermeture || p.dateFermeture,
      etatObjet: ege.etatObjet || e.etatObjet || p.etatObjet,
      updatedAt: ege.dateDerniereMaj || e.dateDerniereMaj || p.dateDerniereMaj || null,
      provenance: [{source: "finess", id: finessEge || finessPm || siret || null, url: "https://www.data.gouv.fr/datasets/finess-structures-1", updatedAt: ege.dateDerniereMaj || e.dateDerniereMaj || p.dateDerniereMaj || null, confidence: 0.96}],
    };
  }

  function normaliser(record) {
    if (!AIDE()) return null;
    const p = details(record);
    if (!p.name || p.lat == null || p.lng == null) return null;
    return AIDE().normaliser(p);
  }

  async function nearby(lat, lng, options) {
    const o = options || {};
    const params = new URLSearchParams({
      lat: Number(lat).toFixed(5), lng: Number(lng).toFixed(5),
      radius: String(Math.min(20000, Math.max(500, Number(o.radius) || 15000))),
      needs: (o.needs || []).join(","), source: "finess",
    });
    const response = await fetch("/api/aide-structures?" + params, {signal: o.signal});
    if (!response.ok) return [];
    const body = await response.json();
    return (body.items || []).map(normaliser).filter(Boolean);
  }

  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    aideFiness: Object.freeze({normaliser, nearby, details}),
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
