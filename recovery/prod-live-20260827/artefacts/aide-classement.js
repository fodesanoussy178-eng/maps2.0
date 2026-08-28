(function(root) {
  "use strict";
  const TAXO = root.AutourAideTaxonomie;
  const POIDS = Object.freeze({
    /* Ce que le lieu EST. Une preuve certaine passe seule. */
    tagCertain: 60,
    tagFort: 40,
    tagFaible: 18,
    categorieCertaine: 55,
    categorieForte: 40,
    categorieFaible: 20,
    /* Ce qu'il FAIT, déclaré explicitement. Aussi fort qu'un type. */
    service: 55,
    /* Ce qu'une institution en dit. */
    institutionnel: 50,
    /* Ce qu'il dit de lui-même : utile, jamais décisif seul. */
    description: 25,
    /* Comment il s'appelle. Faible, et c'est le fond du sujet.
    
           DEUX POIDS POUR UN NOM, ET LA DIFFÉRENCE EST TOUTE LA RÈGLE.
    
           Un réseau national reconnu dans le nom — « Action Logement », « ADIL »,
           « Mission Locale » — est une information réelle. Mais elle ne vaut que
           si quelque chose d'autre la CORROBORE : une catégorie compatible, un
           tag, un service. Seule, elle ne dépasse jamais le seuil, et c'est
           exactement ce qui doit arriver à une viennoiserie qui porte le nom
           d'une organisation humanitaire.
    
           Corroborer n'est pas contredire : une structure dont le type CONTREDIT
           le besoin est écartée bien avant, par les exclusions. */
    reseauNom: 12,
    /* 35 et non 30 : la valeur avait été calibrée quand une catégorie déduite
           des tags ajoutait encore ses points par-dessus le tag dont elle sortait.
           En supprimant cet écho, on a retiré une vingtaine de points à TOUS les
           lieux OpenStreetMap — et une Mission locale tagguée `office=employment_agency`
           tombait à 48 sur « Jeunes / études », deux points sous le seuil, alors
           que le réseau est par définition celui des 16-25 ans.
    
           Relever ce poids ne rouvre pas la porte à la viennoiserie : ce qui
           interdit à un nom de classer seul n'est pas son poids, c'est
           `structurelle` — sans une preuve venue d'ailleurs, le verdict est
           REFUS.NOM_SEUL quel que soit le barème. */
    reseauNomCorrobore: 35,
    motNom: 8
  });
  const SEUIL = 50;
  const NOMINALES = Object.freeze(["reseauNom", "motNom"]);
  const REFUS = Object.freeze({
    NOM_SEUL: "nom_seul",
    EXCLUSION: "exclusion",
    SOUS_SEUIL: "sous_seuil",
    AUCUNE: "aucune_preuve"
  });
  function texteSansAccents(valeur) {
    const C = root.AutourComprendre;
    if (C && C.sansAccents) return C.sansAccents(valeur);
    return String(valeur == null ? "" : valeur).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  }
  const tagsDe = (lieu) => lieu && lieu.tags || {};
  const nomDe = (lieu) => String(lieu && (lieu.titre || lieu.title || lieu.name) || "");
  const nomsDe = (lieu) => [nomDe(lieu)].concat(Array.isArray(lieu && lieu.aliases) ? lieu.aliases : []).filter(Boolean).map(texteSansAccents);
  const typesDe = (lieu) => new Set([
    lieu && lieu.type,
    lieu && lieu.primaryType,
    lieu && lieu.institutionalType
  ].concat(Array.isArray(lieu && lieu.types) ? lieu.types : []).filter(Boolean).map(texteSansAccents));
  const descriptionDe = (lieu) => {
    const l = lieu || {};
    return [l.description, l.note, tagsDe(l).description, tagsDe(l).note].filter(Boolean).join(" ");
  };
  function categoriesDe(lieu) {
    const l = lieu || {};
    return new Set([l.cat, ...l.categories || []].filter(Boolean));
  }
  function servicesDe(lieu) {
    const l = lieu || {};
    const tags = tagsDe(l);
    const brut = [].concat(Array.isArray(l.services) ? l.services : []).concat(l.service ? [l.service] : []).concat(String(tags["social_facility:for"] || "").split(";")).concat(String(tags.service || "").split(";")).concat(String(tags.social_facility || "").split(";"));
    return new Set(brut.map((s) => texteSansAccents(s)).filter(Boolean));
  }
  const SOURCES_INSTITUTIONNELLES = Object.freeze(
    [
      "datatourisme",
      "contexte_officiel",
      "institutionnel",
      "organisateur",
      "data_gouv",
      "partenaire",
      "service_public"
    ]
  );
  function estInstitutionnel(lieu) {
    const l = lieu || {};
    const sources = [].concat(l.sources || [], l.source || [], l.primary_source || []).map((s) => String(s).toLowerCase());
    if (sources.some((s) => SOURCES_INSTITUTIONNELLES.includes(s))) return true;
    const v = l.verifie;
    return !!(v && v.priorite && v.priorite !== "tiers");
  }
  function preuveTag(tag, tags) {
    const valeur = tags[tag.cle];
    if (valeur == null || valeur === "") return null;
    if (tag.valeurs.includes("*")) return tag.preuve;
    const lues = String(valeur).split(";").map((v) => v.trim().toLowerCase());
    return tag.valeurs.some((v) => lues.includes(v)) ? tag.preuve : null;
  }
  function poidsDeTag(preuve) {
    if (preuve === TAXO.PREUVE.CERTAINE) return POIDS.tagCertain;
    if (preuve === TAXO.PREUVE.FORTE) return POIDS.tagFort;
    return POIDS.tagFaible;
  }
  function poidsDeCategorie(preuve) {
    if (preuve === TAXO.PREUVE.CERTAINE) return POIDS.categorieCertaine;
    if (preuve === TAXO.PREUVE.FORTE) return POIDS.categorieForte;
    return POIDS.categorieFaible;
  }
  function exclusionQuiMord(b, tags, cats) {
    for (const ex of b.exclusions) {
      const valeur = tags[ex.cle];
      if (valeur != null && valeur !== "") {
        const lues = String(valeur).split(";").map((v) => v.trim().toLowerCase());
        if (ex.valeurs.some((v) => lues.includes(v))) return ex;
      }
      if (ex.valeurs.some((v) => cats.has(v))) return ex;
    }
    return null;
  }
  const ONTOLOGIE = TAXO || {};
  const CATEGORY_ALIASES = Object.freeze({
    manger: "manger",
    food: "manger",
    food_aid: "manger",
    food_assistance: "manger",
    alimentaire: "manger",
    collecte: "manger",
    logement: "logement",
    shelter: "logement",
    housing_aid: "logement",
    housing_assistance: "logement",
    hebergement: "logement",
    travail: "travail",
    emploi: "travail",
    employment_aid: "travail",
    employment_assistance: "travail",
    financial_assistance: "travail",
    papiers: "papiers",
    mairie: "papiers",
    administrative_aid: "papiers",
    administrative_help: "papiers",
    administrative_assistance: "papiers",
    sante: "sante",
    health: "sante",
    healthcare: "sante",
    health_aid: "sante",
    health_assistance: "sante",
    soins: "sante",
    jeunes: "jeunes",
    youth_aid: "jeunes",
    youth_support: "jeunes",
    parler: "parler",
    listening_support: "parler",
    emotional_support: "parler",
    famille: "famille",
    family_support: "famille",
    securite: "securite",
    safety: "securite",
    safety_support: "securite",
    autre: "autre",
    other_aid: "autre",
    help: "autre",
    hygiene: "hygiene",
    hygiene_access: "hygiene",
    vetements: "vetements",
    clothing_assistance: "vetements",
    mobilite: "mobilite",
    mobility_support: "mobilite"
  });
  const SERVICE_TYPE_NAME_HINTS = Object.freeze([
    [/\bmission locale\b/, "mission_locale"],
    [/\bmission emploi\b|\bmelt\b/, "mission_emploi"],
    [/\bfrance travail\b|\bpole emploi\b/, "france_travail"],
    [/\bcap emploi\b/, "cap_emploi"],
    [/\bmaison de l emploi\b/, "maison_de_l_emploi"],
    [/\bcommissariat\b/, "commissariat"],
    [/\bpolice municipale\b/, "police_municipale"],
    [/\bpolice nationale\b/, "police_nationale"],
    [/\bposte de police\b/, "poste_de_police"],
    [/\bbrigade (?:de )?gendarmerie\b|\bbrigade territoriale\b/, "brigade_gendarmerie"],
    [/\bgendarmerie\b/, "gendarmerie"],
    [/\bfrance victimes\b/, "france_victimes"],
    [/\baide aux victimes\b|\baccueil des victimes\b/, "aide_aux_victimes"],
    [/\bviolences? conjugales?\b|\bviolences? familiales?\b/, "violences_conjugales"],
    [/\bmaison de justice et du droit\b/, "maison_justice_droit"],
    [/\bpoint justice\b|\bpoint d acces au droit\b/, "point_justice"],
    [/\bcidff\b/, "cidff"],
    [/\bprotection de l enfance\b|\baide sociale a l enfance\b/, "protection_enfance"],
    [/\bsamu social\b/, "samu_social"],
    [/\bsiao\b|\b115\b/, "siao_115"],
    [/\baccueil de jour\b/, "accueil_jour_sans_domicile"],
    [/\bhebergement d urgence\b|\bchrs\b|\bchu\b|\babri de nuit\b|\bhalte de nuit\b/, "hebergement_urgence"],
    [/\bsamu\b/, "samu"],
    [/\bsmur\b/, "smur"],
    [/\burgences? hospitalieres?\b/, "urgences_hospitalieres"],
    [/\burgences? medicales?\b/, "urgences_medicales"],
    [/\burgences? psychiatriques?\b/, "urgences_psychiatriques"],
    [/\bpompiers?\b|\bsdis\b/, "pompiers_sdis"],
    [/\bbanque alimentaire\b/, "banque_alimentaire"],
    [/\baide alimentaire\b/, "aide_alimentaire"],
    [/\bdistribution alimentaire\b|\bcolis alimentaires?\b/, "distribution_alimentaire"],
    [/\bepicerie solidaire\b|\bepicerie sociale\b/, "epicerie_solidaire"],
    [/\brestos? du (?:coeur|c\s*ur)\b/, "restos_du_coeur"],
    [/\bsecours populaire\b.*\bvetements?\b|\bvetements?.*\bsecours populaire\b/, "vestiaire"],
    [/\bsecours populaire\b/, "secours_populaire"],
    [/\brepas chaud\b|\bsoupe populaire\b/, "repas_chaud"],
    [/\bmaraude alimentaire\b/, "maraude_alimentaire"],
    [/\bccas\b|\bcentre communal d action sociale\b/, "ccas"],
    [/\bccas logement\b/, "ccas_logement"],
    [/\baction logement\b/, "action_logement"],
    [/\badil\b/, "adil"],
    [/\bfrance services\b|\bmaison france services\b/, "france_services"],
    [/\bmairie\b|\bmairie annexe\b/, "mairie"],
    [/\bprefecture\b/, "prefecture"],
    [/\bsous prefecture\b/, "sous_prefecture"],
    [/\bants\b|\bfrance titres\b/, "ants_france_titres"],
    [/\bcaf\b/, "caf"],
    [/\bcpam\b/, "cpam"],
    [/\bfinances publiques\b|\bcentre des impots\b/, "finances_publiques"],
    [/\bdomiciliation\b/, "domiciliation"],
    [/\becrivain public\b/, "ecrivain_public"],
    [/\bhopital\b/, "hopital"],
    [/\bcentre de sante\b/, "centre_de_sante"],
    [/\bmaison medicale\b/, "maison_medicale"],
    [/\bcabinet medical\b|\bmedecin\b|\bdocteur\b/, "cabinet_medical"],
    [/\bpharmacie\b/, "pharmacie"],
    [/\bpmi\b|\bprotection maternelle et infantile\b/, "pmi"],
    [/\bcmpp\b/, "cmpp"],
    [/\bcmp\b/, "cmp"],
    [/\bmaison des adolescents\b/, "maison_des_adolescents"],
    [/\bcsapa\b/, "csapa"],
    [/\bcaarud\b/, "caarud"],
    [/\bcegidd\b/, "cegidd"],
    [/\bplanning familial\b/, "planning_familial"],
    [/\bpass\b/, "pass"],
    [/\bpoint information jeunesse\b|\bpij\b/, "point_information_jeunesse"],
    [/\binfo jeunes\b|\bcrij\b|\bbij\b/, "info_jeunes"],
    [/\bcio\b/, "cio"],
    [/\bcrous\b/, "crous"],
    [/\bfoyer de jeunes travailleurs\b|\bfjt\b/, "foyer_jeunes_travailleurs"],
    [/\bmaison des jeunes\b|\bmjc\b/, "point_information_jeunesse"],
    [/\bpoint ecoute\b|\bsos amitie\b/, "point_ecoute"],
    [/\bpsychologue\b|\bpsychiatre\b/, "association_ecoute"],
    [/\bmediation familiale\b/, "mediation_familiale"],
    [/\bmaison des familles\b/, "maison_des_familles"],
    [/\bcentre social\b|\bmaison de quartier\b/, "centre_social"],
    [/\bbains douches?\b|\bespace hygiene\b/, "bains_douches"],
    [/\bvestiaire\b|\bdon de vetements?\b/, "vestiaire"],
    [/\bcroix rouge\b/, "croix_rouge_sociale"]
  ]);
  function cleOntologie(value) {
    return texteSansAccents(value).replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  }
  function listeDe(value) {
    if (Array.isArray(value)) return value;
    if (value == null || value === "") return [];
    return [value];
  }
  function sourceCanonique(value) {
    const cle = cleOntologie(value);
    if (!cle) return "unknown";
    if (/service_public|annuaire.*administration|dila/.test(cle)) return "service_public";
    if (/institutionnel|contexte_officiel|organisateur|datatourisme/.test(cle)) return "institutionnel";
    if (/social_officiel|base_sociale|data_gouv|datagouv/.test(cle)) return "social_officiel";
    if (/association_verifiee|asso_verifiee|verified_association/.test(cle)) return "association_verifiee";
    if (/openstreetmap|^osm$/.test(cle)) return "openstreetmap";
    return cle;
  }
  function sourcePrioritaire(lieu) {
    const l = lieu || {};
    const valeurs = [].concat(l.classification_source || l.classificationSource || []).concat(l.sources || [], l.source || [], l.primary_source || l.primarySource || []).concat((l.provenance || []).map((p) => p && p.source).filter(Boolean));
    let meilleur = { source: "unknown", priority: 0 };
    valeurs.forEach((value) => {
      const source = sourceCanonique(value);
      const priority = Number((ONTOLOGIE.SOURCE_PRIORITIES || {})[source] || 0);
      if (priority > meilleur.priority) meilleur = { source, priority };
    });
    if (l.verifie && l.verifie.priorite && l.verifie.priorite !== "tiers" && meilleur.priority < 200)
      meilleur = { source: "association_verifiee", priority: 200 };
    if (!valeurs.length && Object.keys(tagsDe(l)).length)
      meilleur = { source: "openstreetmap", priority: 100 };
    return meilleur;
  }
  function categorieCanonique(value) {
    const cle = cleOntologie(value);
    return CATEGORY_ALIASES[cle] || null;
  }
  function typeCanonique(value) {
    const cle = cleOntologie(value);
    const alias = (ONTOLOGIE.SERVICE_TYPE_ALIASES || {})[cle] || cle;
    return (ONTOLOGIE.SERVICE_TYPES || {})[alias] ? alias : null;
  }
  function candidateType(type, lieu, origin, sourceInfo, extra) {
    const serviceType = typeCanonique(type);
    const definition = serviceType && ONTOLOGIE.SERVICE_TYPES[serviceType];
    if (!definition) return null;
    const e = extra || {};
    return {
      serviceType,
      categories: (definition.categories || []).slice(),
      urgent: definition.urgent === true,
      origin: origin || "service_type",
      source: e.source || sourceInfo.source || "unknown",
      priority: Number.isFinite(Number(e.priority)) ? Number(e.priority) : sourceInfo.priority,
      certain: e.certain !== false,
      usable: e.usable !== false
    };
  }
  function candidateCategory(category, origin, sourceInfo, extra) {
    const id = categorieCanonique(category);
    if (!id) return null;
    const e = extra || {};
    return {
      serviceType: null,
      categories: [id],
      urgent: false,
      origin: origin || "help_category",
      source: e.source || sourceInfo.source || "unknown",
      priority: Number.isFinite(Number(e.priority)) ? Number(e.priority) : sourceInfo.priority,
      certain: e.certain !== false,
      usable: e.usable !== false
    };
  }
  function nomTypeCanonique(lieu) {
    const texte = texteSansAccents([nomDe(lieu), ...lieu && lieu.aliases || []].join(" ")).replace(/[-_]+/g, " ");
    return SERVICE_TYPE_NAME_HINTS.find(([re]) => re.test(texte)) || null;
  }
  function ajouterTagCandidats(lieu, candidats) {
    const tags = tagsDe(lieu);
    const source = { source: "openstreetmap", priority: 100 };
    const ajout = (type, extra) => {
      const c = candidateType(type, lieu, "tag", source, Object.assign({ certain: true }, extra || {}));
      if (c) candidats.push(c);
    };
    const amenity = cleOntologie(tags.amenity);
    const social = cleOntologie(tags.social_facility);
    const healthcare = cleOntologie(tags.healthcare);
    const office = cleOntologie(tags.office);
    const pour = cleOntologie(tags["social_facility:for"]);
    if (amenity === "police") {
      const corps = cleOntologie(tags.police);
      ajout(corps === "municipal" ? "police_municipale" : corps === "gendarmerie" || corps === "barracks" ? "gendarmerie" : corps === "national" || corps === "state" ? "police_nationale" : "commissariat");
    }
    if (amenity === "fire_station") ajout("pompiers_sdis");
    if (amenity === "hospital" && cleOntologie(tags.emergency) === "yes") ajout("urgences_hospitalieres");
    if (healthcare === "emergency") ajout("urgences_medicales");
    if (healthcare === "psychiatry" && cleOntologie(tags.emergency) === "yes") ajout("urgences_psychiatriques");
    if (social === "food_bank") ajout("banque_alimentaire");
    if (social === "soup_kitchen") ajout("repas_chaud");
    if (social === "food_sharing") ajout("distribution_alimentaire");
    if (social === "shelter" || social === "homeless_shelter" || social === "emergency_shelter")
      ajout("hebergement_urgence");
    if (social === "group_home" || social === "assisted_living") ajout("residence_sociale");
    if (social === "day_centre") ajout("centre_social");
    if (office === "employment_agency") ajout("structure_insertion");
    if (office === "association" || office === "ngo" || office === "charity") ajout("centre_social");
    if (amenity === "social_centre" || amenity === "community_centre") ajout("centre_social");
    if (amenity === "youth_centre") ajout("point_information_jeunesse");
    if (amenity === "pharmacy" || healthcare === "pharmacy") ajout("pharmacie");
    if (["hospital", "clinic", "doctor", "dentist", "centre", "laboratory", "physiotherapist"].includes(healthcare)) ajout(healthcare === "hospital" ? "hopital" : healthcare === "doctor" ? "cabinet_medical" : "centre_de_sante");
    if (tags["healthcare:counselling"] != null) ajout("point_ecoute");
    if (["juvenile", "student"].includes(pour)) ajout(pour === "student" ? "crous" : "point_information_jeunesse");
    if (["child", "family", "parent"].includes(pour)) ajout("pmi_famille");
  }
  function typesDeclares(lieu) {
    const l = lieu || {};
    return [].concat(l.service_type || l.serviceType || [], l.service_types || l.serviceTypes || []).concat(l.institutionalType || l.institutional_type || []).concat(l.primaryType || l.primary_type || []).concat(l.type || [], l.placeType || []).concat(Array.isArray(l.types) ? l.types : []);
  }
  function categoriesDeclarees(lieu) {
    const l = lieu || {};
    return [].concat(l.help_category || l.helpCategory || [], l.help_categories || l.helpCategories || []).concat(l.aid_categories || l.aidCategories || []).concat(l.categoriesAide || l.categories_aide || []);
  }
  function estTypeNonAide(lieu) {
    const l = lieu || {};
    const tags = tagsDe(lieu);
    const valeurs = typesDeclares(lieu).concat([
      tags.tourism,
      tags.historic,
      tags.amenity,
      tags.leisure,
      tags.shop,
      l.cat,
      ...l.categories || []
    ]).filter(Boolean).map(cleOntologie);
    if (valeurs.some((v) => (ONTOLOGIE.NON_AID_SERVICE_TYPES || []).includes(v))) return true;
    const nom = texteSansAccents([nomDe(lieu), ...l.aliases || []].join(" "));
    return /\bvisites? guidee?s?\b|\bvisites? touristiques?\b|\b(?:b&b|bb) hotel\b|\bhotel touristique\b/.test(nom);
  }
  function meilleurCandidat(a, b) {
    if (!a) return b;
    if (!b) return a;
    return [a, b].sort((x, y) => y.priority - x.priority || Number(y.certain) - Number(x.certain) || Number(y.origin !== "name_corroborated") - Number(x.origin !== "name_corroborated"))[0];
  }
  function classificationAide(lieu) {
    const l = lieu || {};
    const source = sourcePrioritaire(l);
    const candidats = [];
    const explicites = categoriesDeclarees(l);
    explicites.forEach((value) => {
      const c = candidateCategory(value, "help_category", source, {
        /* `is_aid_provider` est le contrat historique de la base sociale :
           il rend la catégorie fiable même si l'ancien champ `source` manque. */
        priority: source.priority || (l.is_aid_provider === true || l.isAidProvider === true ? 200 : 0),
        usable: source.priority >= 100 || l.is_aid_provider === true || l.isAidProvider === true
      });
      if (c) candidats.push(c);
    });
    typesDeclares(l).forEach((value) => {
      const c = candidateType(value, l, "service_type", source, {
        priority: source.priority || (l.service_type || l.serviceType || l.institutionalType ? 25 : 0),
        usable: source.priority >= 100 || !!(l.service_type || l.serviceType || l.institutionalType)
      });
      if (c) candidats.push(c);
    });
    ajouterTagCandidats(l, candidats);
    const hint = nomTypeCanonique(l);
    const valeursLegacy = [l.cat, ...l.categories || []].filter(Boolean).map(cleOntologie);
    const catsLegacy = valeursLegacy.map(categorieCanonique).filter(Boolean);
    const categorieStructurelleLegacy = valeursLegacy.some((id) => ![
      "event",
      "popup",
      "concert",
      "spectacle",
      "musee",
      "tourism",
      "commerce",
      "resto",
      "fastfood",
      "cafe",
      "bar",
      "food"
    ].includes(id));
    if (hint) {
      const c = candidateType(hint[1], l, "name_corroborated", source, {
        priority: source.priority >= 300 ? source.priority : catsLegacy.length ? 25 : 0,
        usable: source.priority >= 300 || categorieStructurelleLegacy,
        certain: false
      });
      if (c && (c.categories.some((id) => catsLegacy.includes(id)) || categorieStructurelleLegacy)) candidats.push(c);
      else if (c && source.priority >= 300) candidats.push(c);
    }
    const parCategorie = {};
    candidats.forEach((c) => c.categories.forEach((id) => {
      parCategorie[id] = meilleurCandidat(parCategorie[id], c);
    }));
    const parType = {};
    candidats.filter((c) => c.serviceType).forEach((c) => {
      parType[c.serviceType] = meilleurCandidat(parType[c.serviceType], c);
    });
    const positifs = Object.values(parCategorie);
    const negation = estTypeNonAide(l) && !positifs.some((c) => c.priority > 0 && c.origin !== "name_corroborated");
    const serviceTypes = Object.keys(parType).sort((a, b) => {
      const diff = parType[b].priority - parType[a].priority;
      return diff || a.localeCompare(b);
    });
    const helpCategories = Object.keys(parCategorie).sort((a, b) => {
      const diff = parCategorie[b].priority - parCategorie[a].priority;
      return diff || a.localeCompare(b);
    });
    const principal = positifs.slice().sort((a, b) => b.priority - a.priority || Number(b.certain) - Number(a.certain))[0] || null;
    const urgent = positifs.filter((c) => c.urgent && c.serviceType && c.priority >= 100 && c.origin !== "name_corroborated").sort((a, b) => b.priority - a.priority)[0] || null;
    return {
      help_category: helpCategories[0] || null,
      help_categories: helpCategories,
      service_type: serviceTypes[0] || null,
      service_types: serviceTypes,
      source: principal ? principal.source : source.source,
      source_priority: principal ? principal.priority : source.priority,
      evidence: candidats,
      byCategory: parCategorie,
      excluded: negation,
      urgentService: urgent,
      service_type_confident: !!urgent || !!(principal && principal.serviceType && principal.priority >= 100 && principal.origin !== "name_corroborated")
    };
  }
  function preuveOntologique(lieu, besoinId) {
    const c = classificationAide(lieu);
    const candidate = c.byCategory[besoinId] || null;
    return {
      classification: c,
      candidate,
      exploitable: !!candidate && candidate.usable === true && !c.excluded,
      urgente: !!c.urgentService && !c.excluded
    };
  }
  function estSolutionOntologique(lieu, besoins) {
    const ids = (besoins || []).filter(Boolean);
    if (!ids.length) return false;
    return ids.some((id) => preuveOntologique(lieu, id).exploitable);
  }
  function estServiceUrgence(lieu) {
    const c = classificationAide(lieu);
    return !c.excluded && !!c.urgentService;
  }
  function raisonTypeNonAide(lieu) {
    const tags = tagsDe(lieu);
    const shop = cleOntologie(tags.shop);
    const amenity = cleOntologie(tags.amenity);
    if (["bakery", "pastry", "supermarket", "convenience", "greengrocer", "butcher"].includes(shop)) return "un commerce alimentaire ne constitue pas une aide";
    if (["restaurant", "fast_food", "cafe", "bar"].includes(amenity))
      return "un \xE9tablissement de restauration ne constitue pas une aide";
    if (["hotel", "lodging", "hostel", "motel", "guest_house"].includes(cleOntologie(tags.tourism)))
      return "un h\xE9bergement marchand ne constitue pas une aide";
    return "ce type de lieu n'est pas un service d'aide";
  }
  function evaluer(lieu, besoinId) {
    const b = TAXO.besoin(besoinId);
    const vide = { accorde: false, confiance: 0, preuves: [], refus: REFUS.AUCUNE };
    if (!b || !lieu) return vide;
    const tags = tagsDe(lieu);
    const cats = categoriesDe(lieu);
    const services = servicesDe(lieu);
    const types = typesDe(lieu);
    const ontologie = preuveOntologique(lieu, besoinId);
    if (ontologie.classification.excluded)
      return {
        accorde: false,
        confiance: 0,
        preuves: [],
        refus: REFUS.EXCLUSION,
        pourquoi: raisonTypeNonAide(lieu)
      };
    const preuves = [];
    let confiance = 0;
    let structurelle = false;
    let certaine = false;
    const ajouter = (genre, poids, quoi) => {
      confiance += poids;
      preuves.push({ genre, poids, quoi });
      if (NOMINALES.indexOf(genre) < 0) structurelle = true;
    };
    if (ontologie.candidate && ontologie.exploitable) {
      const c = ontologie.candidate;
      const poids = c.origin === "name_corroborated" ? POIDS.reseauNomCorrobore : c.priority >= 100 ? POIDS.tagCertain : POIDS.service;
      if (c.certain && c.origin !== "name_corroborated") certaine = true;
      ajouter(
        c.serviceType ? "service_type" : "help_category",
        poids,
        c.serviceType ? "service_type=" + c.serviceType : "help_category=" + c.categories[0]
      );
    }
    b.tags.forEach((tag) => {
      const preuve = preuveTag(tag, tags);
      if (!preuve) return;
      if (preuve === TAXO.PREUVE.CERTAINE) certaine = true;
      ajouter("tag", poidsDeTag(preuve), tag.cle + "=" + tag.valeurs.join("|"));
    });
    const typeDeclare = b.types.find((type) => types.has(texteSansAccents(type)));
    if (typeDeclare) {
      certaine = true;
      ajouter("type", POIDS.service, typeDeclare);
    }
    const tagAParle = preuves.some((preuve) => preuve.genre === "tag");
    b.categories.forEach((k) => {
      if (!cats.has(k.id)) return;
      if (tagAParle) {
        preuves.push({
          genre: "categorie",
          poids: 0,
          quoi: k.id,
          echo: "d\xE9duite des tags d\xE9j\xE0 compt\xE9s"
        });
        return;
      }
      if (k.preuve === TAXO.PREUVE.CERTAINE) certaine = true;
      ajouter("categorie", poidsDeCategorie(k.preuve), k.id);
    });
    b.services.forEach((s) => {
      if (!services.has(texteSansAccents(s))) return;
      certaine = true;
      ajouter("service", POIDS.service, s);
    });
    if (structurelle && estInstitutionnel(lieu))
      ajouter("institutionnel", POIDS.institutionnel, "source publique");
    const description = texteSansAccents(descriptionDe(lieu));
    if (description && b.synonymes.some((re) => re.test(description)))
      ajouter("description", POIDS.description, "description");
    const nom = nomDe(lieu);
    const noms = [nom].concat(Array.isArray(lieu && lieu.aliases) ? lieu.aliases : []).filter(Boolean).map(texteSansAccents);
    if (noms.length && b.synonymes.some((re) => noms.some((nom2) => re.test(nom2))))
      ajouter(
        "reseauNom",
        structurelle ? POIDS.reseauNomCorrobore : POIDS.reseauNom,
        "r\xE9seau reconnu dans le nom"
      );
    const exclusion = exclusionQuiMord(b, tags, cats);
    if (exclusion && !certaine)
      return {
        accorde: false,
        confiance: 0,
        preuves,
        refus: REFUS.EXCLUSION,
        pourquoi: exclusion.raison
      };
    if (preuves.length && !structurelle)
      return {
        accorde: false,
        confiance: 0,
        preuves,
        refus: REFUS.NOM_SEUL,
        pourquoi: "le nom \xE9voque ce besoin, mais rien dans les donn\xE9es ne l\u2019atteste"
      };
    if (!preuves.length) return vide;
    if (confiance < SEUIL)
      return { accorde: false, confiance, preuves, refus: REFUS.SOUS_SEUIL };
    return { accorde: true, confiance, preuves, refus: null, certaine };
  }
  function capacites(lieu) {
    const out = TAXO.capacitesVides();
    const detail = {};
    let meilleure = 0;
    TAXO.BESOINS.forEach((b) => {
      const v = evaluer(lieu, b.id);
      detail[b.capacite] = v;
      out[b.capacite] = v.accorde;
      if (v.accorde) meilleure = Math.max(meilleure, v.confiance);
    });
    const aide = Object.keys(out).some((k) => out[k]);
    return { capacites: out, detail, aide, confiance: meilleure };
  }
  const estAide = (lieu) => capacites(lieu).aide;
  function repond(lieu, besoinId) {
    if (besoinId === TAXO.BESOIN_OUVERT) {
      const c = capacites(lieu);
      const retenus = Object.keys(c.detail).filter((k) => c.detail[k].accorde);
      return {
        accorde: c.aide,
        confiance: c.confiance,
        preuves: retenus.flatMap((k) => c.detail[k].preuves),
        certaine: retenus.some((k) => c.detail[k].certaine),
        refus: c.aide ? null : REFUS.AUCUNE,
        capacites: c.capacites
      };
    }
    const b = TAXO.besoin(besoinId);
    if (!b) return { accorde: false, confiance: 0, preuves: [], refus: REFUS.AUCUNE };
    return evaluer(lieu, besoinId);
  }
  function besoinsDe(lieu) {
    return TAXO.BESOINS.map((b) => ({ id: b.id, capacite: b.capacite, verdict: evaluer(lieu, b.id) })).filter((x) => x.verdict.accorde).sort((a, b) => b.verdict.confiance - a.verdict.confiance);
  }
  function comparer(a, b) {
    const va = a && a.verdictAide || {}, vb = b && b.verdictAide || {};
    const certaine = (vb.certaine ? 1 : 0) - (va.certaine ? 1 : 0);
    if (certaine) return certaine;
    const confiance = (vb.confiance || 0) - (va.confiance || 0);
    if (Math.abs(confiance) >= 10) return confiance;
    const spec = specialisation(a) - specialisation(b);
    if (spec) return spec;
    const dispo = (ouvert(b) ? 1 : 0) - (ouvert(a) ? 1 : 0);
    if (dispo) return dispo;
    const da = Number(a && a.rankDistance), db = Number(b && b.rankDistance);
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
    return (fraicheur(b) || 0) - (fraicheur(a) || 0);
  }
  function specialisation(lieu) {
    const n = lieu && lieu.capacitesAide ? Object.keys(lieu.capacitesAide).filter((k) => lieu.capacitesAide[k]).length : 0;
    return n === 0 ? 99 : n;
  }
  const ouvert = (lieu) => !!(lieu && lieu.ouvert === true);
  function fraicheur(lieu) {
    const l = lieu || {};
    const t = Date.parse(l.majLe || l.updated_at || l.last_synced_at || "");
    return Number.isFinite(t) ? t : 0;
  }
  root.AutourAideClassement = Object.freeze({
    POIDS,
    SEUIL,
    REFUS,
    NOMINALES,
    SOURCES_INSTITUTIONNELLES,
    evaluer,
    capacites,
    estAide,
    repond,
    besoinsDe,
    comparer,
    servicesDe,
    categoriesDe,
    estInstitutionnel,
    classificationAide,
    estSolutionOntologique,
    estServiceUrgence,
    sourcePrioritaire
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
