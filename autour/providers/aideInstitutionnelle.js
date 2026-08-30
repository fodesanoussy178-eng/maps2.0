(function(root) {
  "use strict";
  const RESEAU = /mission\s+locale|mission\s+emploi|\bmelt\b/i;
  const FRANCE_TRAVAIL = /france\s+travail|p[oô]le\s+emploi/i;
  const CAP_EMPLOI = /cap\s+emploi/i;
  const MAISON_EMPLOI = /maison\s+de\s+l['’ ]?emploi/i;
  const TYPES = Object.freeze([
    [/france\s*services?/i, "france_services"],
    [/centre\s+communal\s+d['’ ]action\s+sociale|\bccas\b/i, "ccas"],
    [/caisse\s+d['’ ]allocations\s+familiales|\bcaf\b/i, "caf"],
    [/protection\s+maternelle|\bpmi\b/i, "pmi"],
    [/centre\s+m[ée]dico[- ]psychologique|\bcmp\b/i, "cmp"],
    [/centre\s+m[ée]dico[- ]psycho[- ]p[ée]dagogique|\bcmpp\b/i, "cmpp"],
    [/centre\s+de\s+sant[ée]|maison\s+de\s+sant[ée]/i, "centre_de_sante"],
    [/planning\s+familial|planification\s+familiale/i, "planning_familial"],
    [/commissariat|police\s+nationale/i, "commissariat"],
    [/police\s+municipale/i, "police_municipale"],
    [/gendarmerie|brigade/i, "gendarmerie"],
    [/aide\s+aux\s+victimes|victimes/i, "aide_aux_victimes"],
    [/centre\s+social|maison\s+de\s+quartier/i, "centre_social"],
    [/point\s+information\s+jeunesse|\bcrij\b|\bbij\b/i, "point_information_jeunesse"],
    [/foyer\s+de\s+jeunes\s+travailleurs|\bfjt\b/i, "foyer_jeunes_travailleurs"],
  ]);
  function texte(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }
  function json(value, fallback) {
    if (value == null || value === "") return fallback;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  function liste(value) {
    const v = json(value, value);
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }
  function adresse(record) {
    return liste(record && record.adresse).find((a) => a && Number.isFinite(Number(a.latitude ?? a.lat)) && Number.isFinite(Number(a.longitude ?? a.lon ?? a.lng))) || null;
  }
  function lignesTelephone(record) {
    return liste(record && record.telephone).map((x) => {
      if (typeof x === "string") return x;
      return x && (x.valeur || x.value || x.numero || x.telephone || "");
    }).map(texte).filter(Boolean);
  }
  function site(record) {
    const v = liste(record && record.site_internet).find(Boolean);
    if (typeof v === "string") return texte(v);
    return texte(v && (v.valeur || v.value || v.url || v.site || ""));
  }
  /* Les jours arrivent en anglais dans l'export DILA. On les rend une seule
     fois, ici, plutôt que de laisser « Monday » traverser jusqu'à l'écran. La
     table accepte aussi les formes déjà françaises : appliquée deux fois, elle
     ne change rien. */
  const JOURS_FR = Object.freeze({
    monday: "lundi", tuesday: "mardi", wednesday: "mercredi", thursday: "jeudi",
    friday: "vendredi", saturday: "samedi", sunday: "dimanche",
    lundi: "lundi", mardi: "mardi", mercredi: "mercredi", jeudi: "jeudi",
    vendredi: "vendredi", samedi: "samedi", dimanche: "dimanche"
  });

  function jourFrancais(value) {
    const brut = texte(value).toLowerCase();
    if (!brut) return "";
    /* Le champ peut porter « Nord/Monday » : seul le dernier segment nomme
       le jour. */
    const dernier = brut.split("/").pop().trim();
    return JOURS_FR[dernier] || dernier;
  }

  /* L'export DILA nomme ses colonnes `nom_jour_debut`, `valeur_heure_debut_1`,
     `valeur_heure_fin_1`, et une seconde plage en `_2` pour les structures qui
     ferment le midi. Rien de tout cela n'était lu : la fonction cherchait
     `nom_jour`, `heure_debut`, `heure_fin`, qui n'existent pas dans cet
     export — d'où une liste vide et « horaires inconnus » sur des structures
     dont la base connaît pourtant les heures. */
  function horaires(record) {
    const lignes = [];
    liste(record && record.plage_ouverture).forEach((x) => {
      if (typeof x === "string") {
        if (x.trim()) lignes.push(x.trim());
        return;
      }
      if (!x || typeof x !== "object") return;
      const debutJour = jourFrancais(x.nom_jour_debut || x.nom_jour || x.jour || x.day || x.dayOfWeek);
      const finJour = jourFrancais(x.nom_jour_fin);
      if (!debutJour) return;
      const jour = finJour && finJour !== debutJour ? debutJour + " à " + finJour : debutJour;
      const plages = [
        [texte(x.valeur_heure_debut_1 || x.heure_debut || x.debut || x.start || x.opens),
         texte(x.valeur_heure_fin_1 || x.heure_fin || x.fin || x.end || x.closes)],
        [texte(x.valeur_heure_debut_2), texte(x.valeur_heure_fin_2)]
      ].filter(([d, f]) => d && f).map(([d, f]) => d + "-" + f);
      if (plages.length) lignes.push(jour + " " + plages.join(", "));
    });
    return [...new Set(lignes)];
  }
  function typeStructure(record) {
    const adresseBrute = liste(record && record.adresse)[0] || {};
    /* Le pivot et le type de service local sont les champs contrôlés DILA.
       `mission` et le complément d'adresse sont des informations de service
       publiées par l'annuaire. Le nom administratif n'est volontairement pas
       une source de classification : « Secours populaire » seul ne crée pas
       une aide alimentaire. */
    const texteStructure = [
      ...(liste(record && record.pivot)),
      ...(liste(record && record.type_service_local)),
      record && record.code_type_service_local,
      adresseBrute.complement1,
      record && record.mission,
      site(record)
    ].map(texte).join(" ");
    const typeExplicite = TYPES.find(([expression]) => expression.test(texteStructure));
    if (typeExplicite) return typeExplicite[1];
    if (RESEAU.test(texteStructure)) return "mission_locale";
    if (FRANCE_TRAVAIL.test(texteStructure)) return "france_travail";
    if (CAP_EMPLOI.test(texteStructure)) return "cap_emploi";
    if (MAISON_EMPLOI.test(texteStructure)) return "maison_de_l_emploi";
    /* Un enregistrement DILA sans type ou mission structurante reste un
       candidat de l'annuaire, mais il ne reçoit pas artificiellement la
       capacité emploi. Le nom administratif n'est pas une preuve. */
    return "";
  }
  function nomAffiche(record) {
    const a = liste(record && record.adresse)[0] || {};
    const commercial = texte(a.complement1);
    return /mission\s+emploi|\bmelt\b/i.test(commercial) ? commercial : texte(record && (record.nom || record.sigle));
  }
  const CATEGORIES = Object.freeze({
    mission_locale: ["emploi", "asso"], france_travail: ["emploi"], cap_emploi: ["emploi"],
    maison_de_l_emploi: ["emploi"], france_services: ["mairie"], ccas: ["mairie", "asso"],
    caf: ["asso", "mairie"], pmi: ["sante", "famille"], cmp: ["sante", "parler"],
    cmpp: ["sante", "parler", "jeunes"], centre_de_sante: ["sante"], planning_familial: ["sante", "famille"],
    commissariat: ["securite"], police_municipale: ["securite"], gendarmerie: ["securite"],
    aide_aux_victimes: ["securite", "asso"], centre_social: ["asso", "famille"],
    point_information_jeunesse: ["jeunes"], foyer_jeunes_travailleurs: ["hebergement", "jeunes"],
    structure_insertion: ["emploi"],
  });
  const SERVICES = Object.freeze({
    mission_locale: ["employment", "job_seeking", "training", "orientation"],
    france_travail: ["employment", "job_seeking", "training"], cap_emploi: ["employment", "job_seeking"],
    maison_de_l_emploi: ["employment", "job_seeking", "training"], france_services: ["administrative_assistance", "digital_assistance"],
    ccas: ["social_welfare", "administrative_assistance", "financial_advice"], caf: ["family_support", "administrative_assistance"],
    pmi: ["medical_care", "family_counselling"], cmp: ["psychological_support", "counselling"],
    cmpp: ["psychological_support", "counselling"], centre_de_sante: ["medical_care", "consultation"],
    planning_familial: ["sexual_health", "family_counselling"], commissariat: ["protection", "complaint"],
    police_municipale: ["protection"], gendarmerie: ["protection", "complaint"],
    aide_aux_victimes: ["victim_support", "legal_advice"], centre_social: ["family_counselling", "social_welfare"],
    point_information_jeunesse: ["orientation", "youth_counselling"], foyer_jeunes_travailleurs: ["youth_counselling"],
    structure_insertion: ["employment", "job_seeking"],
  });
  function normaliser(record) {
    if (!record || !record.id) return null;
    const a = adresse(record);
    if (!a) return null;
    const lat = Number(a.latitude ?? a.lat);
    const lng = Number(a.longitude ?? a.lon ?? a.lng);
    const officialName = texte(record.nom);
    const commercial = texte((liste(record.adresse)[0] || {}).complement1);
    const primaryType = typeStructure(record);
    const phone = lignesTelephone(record)[0] || "";
    const website = site(record);
    const aliases = [officialName, record.sigle, record.ancien_nom, commercial].map(texte).filter(Boolean);
    const sourceUrl = texte(record.url_service_public);
    const categories = CATEGORIES[primaryType] || [];
    const helpCategories = primaryType === "mission_locale" ? ["travail", "jeunes"] :
      primaryType === "france_services" ? ["papiers", "famille"] :
      primaryType === "ccas" ? ["logement", "travail", "papiers", "famille"] :
      primaryType === "caf" ? ["famille", "papiers"] :
      primaryType === "pmi" ? ["sante", "famille"] :
      primaryType === "cmp" || primaryType === "cmpp" ? ["sante", "parler"] :
      primaryType === "aide_aux_victimes" ? ["securite", "parler"] :
      primaryType === "centre_social" ? ["famille", "parler"] :
      primaryType === "foyer_jeunes_travailleurs" ? ["logement", "jeunes"] :
      categories.includes("securite") ? ["securite"] :
      categories.includes("sante") ? ["sante"] :
      categories.includes("hebergement") ? ["logement"] : [];
    const brut = {
      autourId: "service-public:" + String(record.id),
      name: nomAffiche(record),
      officialName,
      aliases: [...new Set(aliases)],
      institutionalType: primaryType,
      primaryType,
      help_category: helpCategories[0],
      help_categories: helpCategories,
      service_type: primaryType,
      service_types: [primaryType],
      classification_source: "service_public",
      classification_confidence: 1,
      lat,
      lng,
      category: categories[0] || "autre",
      categories,
      services: SERVICES[primaryType] || [],
      phone,
      website,
      description: texte(record.mission),
      address: [
        a.numero_voie,
        a.type_voie,
        a.nom_voie,
        a.code_postal,
        a.nom_commune
      ].map(texte).filter(Boolean).join(", "),
      openingHours: { weekdayDescriptions: horaires(record) },
      source: "service_public",
      sourceRefs: {
        servicePublicId: String(record.id),
        ...record.siret ? { siret: String(record.siret) } : {},
        ...record.siren ? { siren: String(record.siren) } : {}
      },
      status: record.date_fermeture || record.dateFermeture ? "closed" : null,
      provenance: [{
        source: "service_public",
        id: String(record.id),
        updatedAt: record.date_modification_datetime || null,
        url: sourceUrl
      }],
      updatedAt: record.date_modification_datetime || null,
      aideStructure: true,
      sourceConfidence: 0.96,
    };
    return root.AutourAideStructures ? root.AutourAideStructures.normaliser(brut) : brut;
  }
  async function nearby(lat, lng, options) {
    const o = options || {};
    const besoins = [...new Set((o.needs || []).filter(Boolean))];
    if (!besoins.length) return [];
    const p = new URLSearchParams({
      lat: Number(lat).toFixed(5),
      lng: Number(lng).toFixed(5),
      radius: String(Math.min(2e4, Math.max(500, Number(o.radius) || 6e3))),
      needs: besoins.join(",")
    });
    const r = await fetch(
      "/api/aide-institutionnelle?" + p.toString(),
      { signal: o.signal }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return (data.items || []).map(normaliser).filter(Boolean);
  }
  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    aideInstitutionnelle: Object.freeze({ nearby, normaliser, typeStructure, horaires, jourFrancais })
  });
})(window);
