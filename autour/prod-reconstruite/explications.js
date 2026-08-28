(function(root) {
  "use strict";
  const SOURCES = Object.freeze({
    GOOGLE: "google",
    OSM: "openstreetmap",
    RESEAU: "reseau",
    TYPE: "type",
    CATEGORIE: "categorie"
  });
  const MENTION = Object.freeze({
    google: "Description : Google Maps",
    openstreetmap: "Description : OpenStreetMap",
    reseau: "Ce que fait ce r\xE9seau",
    type: "Ce que fait ce type de structure",
    categorie: "Ce que fait ce type de structure"
  });
  const RESEAUX = [
    [
      /rest(?:o|aurant)s?\s*du\s*c(?:oe|œ|o)ur/i,
      "Aide alimentaire gratuite : paniers et repas. L\u2019inscription se fait au centre, avec une pi\xE8ce d\u2019identit\xE9 et un justificatif de ressources. Beaucoup de centres n\u2019ouvrent que pendant la campagne d\u2019hiver \u2014 v\xE9rifier les horaires avant de venir."
    ],
    [
      /secours\s*populaire/i,
      "Solidarit\xE9 g\xE9n\xE9rale : aide alimentaire, vestiaire, acc\xE8s aux vacances et aux loisirs, aide aux d\xE9marches. L\u2019accueil se fait le plus souvent sur rendez-vous."
    ],
    [
      /secours\s*catholique/i,
      "Accueil, \xE9coute et accompagnement des personnes en difficult\xE9 : aide aux d\xE9marches, aide financi\xE8re ponctuelle, ateliers. Ouvert \xE0 tous, sans condition de religion."
    ],
    [
      /croix[-\s]rouge/i,
      "Aide alimentaire et vestimentaire, accueil social, formation aux premiers secours. Certaines antennes tiennent aussi des consultations de sant\xE9."
    ],
    [
      /banque\s*alimentaire/i,
      "Elle collecte les denr\xE9es et les redistribue aux associations du territoire. Elle ne distribue en g\xE9n\xE9ral pas aux particuliers : passer par une association partenaire."
    ],
    [
      /emma(ü|u)s/i,
      "Boutiques solidaires : meubles, v\xEAtements et objets d\u2019occasion \xE0 petit prix. Les communaut\xE9s accueillent aussi des personnes sans logement, en \xE9change d\u2019un travail."
    ],
    [
      /\bccas\b|centre\s*communal\s*d.?action\s*sociale/i,
      "Le service social de la mairie. Domiciliation (avoir une adresse sans logement), aides d\u2019urgence, instruction des demandes d\u2019aide sociale, orientation. Gratuit."
    ],
    [
      /mission\s*locale/i,
      "Accompagnement gratuit des 16-25 ans sortis de l\u2019\xE9cole : emploi, formation, logement, sant\xE9, transport, et parfois une aide financi\xE8re. Sur rendez-vous."
    ],
    [
      /france\s*travail|p[oô]le\s*emploi/i,
      "Service public de l\u2019emploi : inscription comme demandeur d\u2019emploi, offres, formation, allocations. La plupart des d\xE9marches se font en ligne ou sur rendez-vous."
    ],
    [
      /cap\s*emploi/i,
      "Accompagnement vers l\u2019emploi des personnes en situation de handicap, et appui aux employeurs qui recrutent. Gratuit, sur orientation ou sur rendez-vous."
    ],
    [
      /maison\s*de\s*l['’\s]?emploi/i,
      "Guichet local qui r\xE9unit plusieurs acteurs de l\u2019emploi et de l\u2019insertion pour informer, orienter et accompagner."
    ],
    [
      /samu\s*social|\b115\b/i,
      "Dispositif d\u2019urgence sociale : mise \xE0 l\u2019abri, maraudes, orientation. Le 115 est gratuit et joignable 24 h/24."
    ],
    [
      /restaurant\s*social|resto\s*social/i,
      "Repas complets \xE0 prix tr\xE8s r\xE9duit ou gratuits, servis sur place."
    ],
    [
      /[ée]picerie\s*(solidaire|sociale)/i,
      "Courses \xE0 10-30 % du prix normal, sur orientation d\u2019un travailleur social et pour une dur\xE9e limit\xE9e. On choisit ses produits comme dans un magasin."
    ],
    [
      /accueil\s*de\s*jour/i,
      "Lieu ouvert la journ\xE9e o\xF9 se poser, se laver, laver son linge, manger, et \xEAtre orient\xE9. Sans rendez-vous."
    ],
    [
      /permanence\s*d.?acc[èe]s\s*aux\s*soins|\bpass\b\s*sant[ée]/i,
      "Consultations pour les personnes sans couverture maladie, \xE0 l\u2019h\xF4pital et sans avance de frais."
    ],
    [
      /maison\s*(france\s*services|de\s*services\s*au\s*public)/i,
      "Un seul guichet pour les d\xE9marches administratives courantes : imp\xF4ts, retraite, sant\xE9, emploi, papiers. Accompagnement gratuit, avec ou sans rendez-vous."
    ]
  ];
  const PAR_TAG = [
    ["social_facility", {
      food_bank: "Collecte et distribution de denr\xE9es alimentaires.",
      soup_kitchen: "Repas chauds servis sur place, g\xE9n\xE9ralement sans inscription.",
      shelter: "H\xE9bergement d\u2019urgence ou de nuit. Le nombre de places est limit\xE9 et attribu\xE9 au fil de la journ\xE9e : appeler le 115 avant de se d\xE9placer.",
      clothing_bank: "Vestiaire solidaire : v\xEAtements gratuits ou \xE0 tr\xE8s petit prix.",
      day_centre: "Accueil de jour : se poser, se laver, laver son linge, \xEAtre orient\xE9. Sans rendez-vous.",
      outreach: "\xC9quipe qui va \xE0 la rencontre des personnes plut\xF4t que d\u2019attendre qu\u2019elles viennent : maraudes, permanences de rue.",
      food: "Distribution alimentaire.",
      healthcare: "Soins et accompagnement en sant\xE9, souvent sans avance de frais.",
      workshop: "Atelier d\u2019insertion : travail accompagn\xE9 pour repartir vers l\u2019emploi.",
      group_home: "Logement collectif accompagn\xE9.",
      assisted_living: "Logement accompagn\xE9 pour personnes \xE2g\xE9es ou en perte d\u2019autonomie.",
      nursing_home: "H\xE9bergement m\xE9dicalis\xE9 de longue dur\xE9e.",
      hospice: "Accompagnement de fin de vie.",
      ambulatory_care: "Soins de jour, sans hospitalisation."
    }],
    ["amenity", {
      social_facility: "Structure d\u2019action sociale : accueil, accompagnement et orientation.",
      social_centre: "Centre social : permanences, ateliers et activit\xE9s ouverts au quartier, et accompagnement des familles.",
      community_centre: "Lieu de quartier : activit\xE9s, associations et permanences.",
      food_bank: "Collecte et distribution de denr\xE9es alimentaires.",
      shower: "Douches accessibles au public.",
      toilets: "Toilettes accessibles au public.",
      drinking_water: "Point d\u2019eau potable, gratuit.",
      clinic: "Consultations m\xE9dicales sans hospitalisation.",
      doctors: "Cabinet m\xE9dical.",
      hospital: "H\xF4pital : urgences et consultations.",
      pharmacy: "Pharmacie : m\xE9dicaments, conseils et certains d\xE9pistages.",
      dentist: "Cabinet dentaire.",
      townhall: "Mairie : \xE9tat civil, papiers, et orientation vers le service social.",
      library: "Biblioth\xE8que : lecture, ordinateurs et internet, souvent gratuits.",
      shelter: "Abri, g\xE9n\xE9ralement non gard\xE9."
    }],
    ["healthcare", {
      centre: "Centre de sant\xE9 : consultations de m\xE9decine g\xE9n\xE9rale, souvent en tiers payant (rien \xE0 avancer).",
      dispensary: "Dispensaire : soins courants \xE0 faible co\xFBt.",
      psychotherapist: "Consultations en sant\xE9 mentale.",
      midwife: "Sage-femme : suivi de grossesse et sant\xE9 des femmes.",
      nurse: "Soins infirmiers."
    }],
    ["office", {
      employment_agency: "Agence pour l\u2019emploi : offres, inscription et accompagnement.",
      charity: "Association caritative : accueil, aide directe et orientation.",
      ngo: "Association : accueil, \xE9coute et orientation.",
      government: "Service public : d\xE9marches administratives."
    }]
  ];
  const PUBLIC = {
    homeless: "personnes sans logement",
    senior: "personnes \xE2g\xE9es",
    disabled: "personnes en situation de handicap",
    child: "enfants",
    juvenile: "mineurs",
    orphan: "enfants sans famille",
    migrant: "personnes migrantes",
    refugee: "personnes r\xE9fugi\xE9es",
    unemployed: "personnes sans emploi",
    drug_addicted: "personnes en addiction",
    abused: "personnes victimes de violences",
    victim: "personnes victimes de violences",
    women: "femmes",
    diseased: "personnes malades",
    mental_health: "sant\xE9 mentale",
    underprivileged: "personnes en pr\xE9carit\xE9"
  };
  const PAR_CATEGORIE = {
    alimentaire: "Aide alimentaire : repas ou colis. Les conditions et les horaires varient beaucoup d\u2019un lieu \xE0 l\u2019autre \u2014 appeler avant de se d\xE9placer.",
    collecte: "Point de collecte et de don.",
    hebergement: "Mise \xE0 l\u2019abri ou h\xE9bergement. Les places s\u2019attribuent au fil de la journ\xE9e : appeler le 115 (gratuit, 24 h/24) avant de se d\xE9placer.",
    sante: "Lieu de soins. V\xE9rifier avant de venir si l\u2019accueil se fait sans rendez-vous.",
    emploi: "Accompagnement vers l\u2019emploi et acc\xE8s aux droits. Gratuit.",
    asso: "Association : accueil, \xE9coute et orientation vers les aides existantes.",
    toilettes: "Toilettes accessibles au public.",
    mairie: "Mairie : papiers, \xE9tat civil, et orientation vers le service social (CCAS)."
  };
  function texteNettoye(v) {
    if (typeof v !== "string") return "";
    const t = v.replace(/\s+/g, " ").trim();
    return t;
  }
  function resumeGoogle(place) {
    const p = place || {};
    const generative = p.generativeSummary || {};
    return texteNettoye(generative.overview && generative.overview.text) || texteNettoye(generative.description && generative.description.text) || texteNettoye(p.editorialSummary && p.editorialSummary.text) || "";
  }
  function reseauDe(nom) {
    const n = nom || "";
    for (const [re, texte] of RESEAUX) if (re.test(n)) return texte;
    return "";
  }
  function typeDe(tags) {
    const t = tags || {};
    for (const [cle, table] of PAR_TAG) {
      const valeur = t[cle];
      if (valeur && table[valeur]) return table[valeur];
    }
    return "";
  }
  function publicDe(tags) {
    const t = tags || {};
    const brut = t["social_facility:for"] || t["social_facility:For"] || "";
    const noms = String(brut).split(";").map((x) => PUBLIC[x.trim()]).filter(Boolean);
    if (!noms.length) return "";
    return "Public accueilli : " + noms.join(", ") + ".";
  }
  function explication(item) {
    const l = item || {};
    const tags = l.tags || {};
    const google = texteNettoye(l.resumeGoogle);
    if (google) return {
      texte: google,
      source: SOURCES.GOOGLE,
      generique: false,
      mention: MENTION.google,
      public: publicDe(tags)
    };
    const propre = texteNettoye(l.description) || texteNettoye(tags.description) || texteNettoye(tags.note);
    if (propre && l.descriptionSource === "google") {
      return {
        texte: propre,
        source: SOURCES.GOOGLE,
        generique: false,
        mention: MENTION.google,
        public: publicDe(tags)
      };
    }
    if (propre) return {
      texte: propre,
      source: SOURCES.OSM,
      generique: false,
      mention: MENTION.openstreetmap,
      public: publicDe(tags)
    };
    const reseau = reseauDe(l.titre || l.title || l.nom);
    if (reseau) return {
      texte: reseau,
      source: SOURCES.RESEAU,
      generique: true,
      mention: MENTION.reseau,
      public: publicDe(tags)
    };
    const type = typeDe(tags);
    if (type) return {
      texte: type,
      source: SOURCES.TYPE,
      generique: true,
      mention: MENTION.type,
      public: publicDe(tags)
    };
    const cat = PAR_CATEGORIE[l.cat];
    if (cat) return {
      texte: cat,
      source: SOURCES.CATEGORIE,
      generique: true,
      mention: MENTION.categorie,
      public: publicDe(tags)
    };
    return { texte: "", source: null, generique: false, mention: "", public: publicDe(tags) };
  }
  function resumeCourt(item, maxi) {
    const e = explication(item);
    if (!e.texte) return "";
    const limite = maxi || 120;
    const premiere = e.texte.split(/(?<=[.!?])\s/)[0] || e.texte;
    if (premiere.length <= limite) return premiere;
    const coupe = premiere.slice(0, limite);
    const espace = coupe.lastIndexOf(" ");
    return (espace > 40 ? coupe.slice(0, espace) : coupe).replace(/[,;:]$/, "") + "\u2026";
  }
  root.AutourExplications = Object.freeze({
    SOURCES,
    MENTION,
    RESEAUX,
    PAR_TAG,
    PAR_CATEGORIE,
    PUBLIC,
    resumeGoogle,
    explication,
    resumeCourt
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
