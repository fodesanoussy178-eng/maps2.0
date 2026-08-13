(function (root) {
  "use strict";

  /* ===================================================================
     « À quoi ça sert ? »

     Dans le mode Aide, une liste de noms ne suffit pas. « CCAS », « Mission
     locale », « Banque alimentaire » ne veulent rien dire pour quelqu'un qui
     n'a jamais eu à s'en servir — et c'est précisément cette personne-là qui
     ouvre l'écran Aide. Chaque lieu doit donc dire ce qu'on y fait, ce qu'il
     faut apporter, et si on peut simplement pousser la porte.

     Trois sources, dans cet ordre, jamais mélangées :

       1. la description publiée par Google pour ce lieu, si elle est affichée
          sur une carte Google ;
       2. la description publiée par une source ouverte ou la structure ;
       3. à défaut, ce que fait CE TYPE de structure — une explication de
          réseau ou de tag, valable partout en France, affichée comme telle.

     La distinction compte : les deux premières parlent du lieu, la troisième
     parle de la catégorie. On ne présente jamais la troisième comme si le
     lieu l'avait écrite, et on n'invente aucun horaire, aucune condition et
     aucun service qui ne soit vrai du réseau entier.
     =================================================================== */

  const SOURCES = Object.freeze({
    GOOGLE: "google",
    OSM: "openstreetmap",
    RESEAU: "reseau",
    TYPE: "type",
    CATEGORIE: "categorie",
  });

  const MENTION = Object.freeze({
    google: "Description : Google Maps",
    openstreetmap: "Description : OpenStreetMap",
    reseau: "Ce que fait ce réseau",
    type: "Ce que fait ce type de structure",
    categorie: "Ce que fait ce type de structure",
  });

  /* ---- Réseaux nationaux -------------------------------------------------
     Reconnus par leur nom, donc valables à Lille comme à Marseille. Ce sont
     des faits sur le réseau, pas sur l'antenne : « sur rendez-vous » n'est
     écrit que là où c'est la règle générale du réseau. */
  const RESEAUX = [
    [/rest(?:o|aurant)s?\s*du\s*c(?:oe|œ|o)ur/i,
     "Aide alimentaire gratuite : paniers et repas. L’inscription se fait au centre, " +
     "avec une pièce d’identité et un justificatif de ressources. Beaucoup de centres " +
     "n’ouvrent que pendant la campagne d’hiver — vérifier les horaires avant de venir."],
    [/secours\s*populaire/i,
     "Solidarité générale : aide alimentaire, vestiaire, accès aux vacances et aux loisirs, " +
     "aide aux démarches. L’accueil se fait le plus souvent sur rendez-vous."],
    [/secours\s*catholique/i,
     "Accueil, écoute et accompagnement des personnes en difficulté : aide aux démarches, " +
     "aide financière ponctuelle, ateliers. Ouvert à tous, sans condition de religion."],
    [/croix[-\s]rouge/i,
     "Aide alimentaire et vestimentaire, accueil social, formation aux premiers secours. " +
     "Certaines antennes tiennent aussi des consultations de santé."],
    [/banque\s*alimentaire/i,
     "Elle collecte les denrées et les redistribue aux associations du territoire. " +
     "Elle ne distribue en général pas aux particuliers : passer par une association partenaire."],
    [/emma(ü|u)s/i,
     "Boutiques solidaires : meubles, vêtements et objets d’occasion à petit prix. " +
     "Les communautés accueillent aussi des personnes sans logement, en échange d’un travail."],
    [/\bccas\b|centre\s*communal\s*d.?action\s*sociale/i,
     "Le service social de la mairie. Domiciliation (avoir une adresse sans logement), " +
     "aides d’urgence, instruction des demandes d’aide sociale, orientation. Gratuit."],
    [/mission\s*locale/i,
     "Accompagnement gratuit des 16-25 ans sortis de l’école : emploi, formation, logement, " +
     "santé, transport, et parfois une aide financière. Sur rendez-vous."],
    [/france\s*travail|p[oô]le\s*emploi/i,
     "Service public de l’emploi : inscription comme demandeur d’emploi, offres, formation, " +
     "allocations. La plupart des démarches se font en ligne ou sur rendez-vous."],
    [/cap\s*emploi/i,
     "Accompagnement vers l’emploi des personnes en situation de handicap, et appui aux " +
     "employeurs qui recrutent. Gratuit, sur orientation ou sur rendez-vous."],
    [/maison\s*de\s*l['’\s]?emploi/i,
     "Guichet local qui réunit plusieurs acteurs de l’emploi et de l’insertion pour " +
     "informer, orienter et accompagner."],
    [/samu\s*social|\b115\b/i,
     "Dispositif d’urgence sociale : mise à l’abri, maraudes, orientation. Le 115 est " +
     "gratuit et joignable 24 h/24."],
    [/restaurant\s*social|resto\s*social/i,
     "Repas complets à prix très réduit ou gratuits, servis sur place."],
    [/[ée]picerie\s*(solidaire|sociale)/i,
     "Courses à 10-30 % du prix normal, sur orientation d’un travailleur social et pour " +
     "une durée limitée. On choisit ses produits comme dans un magasin."],
    [/accueil\s*de\s*jour/i,
     "Lieu ouvert la journée où se poser, se laver, laver son linge, manger, et être " +
     "orienté. Sans rendez-vous."],
    [/permanence\s*d.?acc[èe]s\s*aux\s*soins|\bpass\b\s*sant[ée]/i,
     "Consultations pour les personnes sans couverture maladie, à l’hôpital et sans avance de frais."],
    [/maison\s*(france\s*services|de\s*services\s*au\s*public)/i,
     "Un seul guichet pour les démarches administratives courantes : impôts, retraite, " +
     "santé, emploi, papiers. Accompagnement gratuit, avec ou sans rendez-vous."],
  ];

  /* ---- Types de structure, lus dans les tags OpenStreetMap ---------------
     Ce sont des définitions de tag, donc vraies partout où le tag est posé. */
  const PAR_TAG = [
    ["social_facility", {
      food_bank:      "Collecte et distribution de denrées alimentaires.",
      soup_kitchen:   "Repas chauds servis sur place, généralement sans inscription.",
      shelter:        "Hébergement d’urgence ou de nuit. Le nombre de places est limité et " +
                      "attribué au fil de la journée : appeler le 115 avant de se déplacer.",
      clothing_bank:  "Vestiaire solidaire : vêtements gratuits ou à très petit prix.",
      day_centre:     "Accueil de jour : se poser, se laver, laver son linge, être orienté. " +
                      "Sans rendez-vous.",
      outreach:       "Équipe qui va à la rencontre des personnes plutôt que d’attendre " +
                      "qu’elles viennent : maraudes, permanences de rue.",
      food:           "Distribution alimentaire.",
      healthcare:     "Soins et accompagnement en santé, souvent sans avance de frais.",
      workshop:       "Atelier d’insertion : travail accompagné pour repartir vers l’emploi.",
      group_home:     "Logement collectif accompagné.",
      assisted_living:"Logement accompagné pour personnes âgées ou en perte d’autonomie.",
      nursing_home:   "Hébergement médicalisé de longue durée.",
      hospice:        "Accompagnement de fin de vie.",
      ambulatory_care:"Soins de jour, sans hospitalisation.",
    }],
    ["amenity", {
      social_facility:"Structure d’action sociale : accueil, accompagnement et orientation.",
      social_centre:  "Centre social : permanences, ateliers et activités ouverts au quartier, " +
                      "et accompagnement des familles.",
      community_centre:"Lieu de quartier : activités, associations et permanences.",
      food_bank:      "Collecte et distribution de denrées alimentaires.",
      shower:         "Douches accessibles au public.",
      toilets:        "Toilettes accessibles au public.",
      drinking_water: "Point d’eau potable, gratuit.",
      clinic:         "Consultations médicales sans hospitalisation.",
      doctors:        "Cabinet médical.",
      hospital:       "Hôpital : urgences et consultations.",
      pharmacy:       "Pharmacie : médicaments, conseils et certains dépistages.",
      dentist:        "Cabinet dentaire.",
      townhall:       "Mairie : état civil, papiers, et orientation vers le service social.",
      library:        "Bibliothèque : lecture, ordinateurs et internet, souvent gratuits.",
      shelter:        "Abri, généralement non gardé.",
    }],
    ["healthcare", {
      centre:         "Centre de santé : consultations de médecine générale, souvent en tiers " +
                      "payant (rien à avancer).",
      dispensary:     "Dispensaire : soins courants à faible coût.",
      psychotherapist:"Consultations en santé mentale.",
      midwife:        "Sage-femme : suivi de grossesse et santé des femmes.",
      nurse:          "Soins infirmiers.",
    }],
    ["office", {
      employment_agency: "Agence pour l’emploi : offres, inscription et accompagnement.",
      charity:           "Association caritative : accueil, aide directe et orientation.",
      ngo:               "Association : accueil, écoute et orientation.",
      government:        "Service public : démarches administratives.",
    }],
  ];

  /* Le public visé, quand OpenStreetMap le précise. C'est ce qui évite un
     déplacement inutile : un accueil réservé aux femmes ou aux mineurs ne
     recevra pas tout le monde. */
  const PUBLIC = {
    homeless: "personnes sans logement",
    senior: "personnes âgées",
    disabled: "personnes en situation de handicap",
    child: "enfants",
    juvenile: "mineurs",
    orphan: "enfants sans famille",
    migrant: "personnes migrantes",
    refugee: "personnes réfugiées",
    unemployed: "personnes sans emploi",
    drug_addicted: "personnes en addiction",
    abused: "personnes victimes de violences",
    victim: "personnes victimes de violences",
    women: "femmes",
    diseased: "personnes malades",
    mental_health: "santé mentale",
    underprivileged: "personnes en précarité",
  };

  /* ---- Dernier recours : la catégorie ----------------------------------- */
  const PAR_CATEGORIE = {
    alimentaire: "Aide alimentaire : repas ou colis. Les conditions et les horaires varient " +
                 "beaucoup d’un lieu à l’autre — appeler avant de se déplacer.",
    collecte:    "Point de collecte et de don.",
    hebergement: "Mise à l’abri ou hébergement. Les places s’attribuent au fil de la journée : " +
                 "appeler le 115 (gratuit, 24 h/24) avant de se déplacer.",
    sante:       "Lieu de soins. Vérifier avant de venir si l’accueil se fait sans rendez-vous.",
    emploi:      "Accompagnement vers l’emploi et accès aux droits. Gratuit.",
    asso:        "Association : accueil, écoute et orientation vers les aides existantes.",
    toilettes:   "Toilettes accessibles au public.",
    mairie:      "Mairie : papiers, état civil, et orientation vers le service social (CCAS).",
  };

  function texteNettoye(v) {
    if (typeof v !== "string") return "";
    const t = v.replace(/\s+/g, " ").trim();
    return t;
  }

  function resumeGoogle(place) {
    const p = place || {};
    const generative = p.generativeSummary || {};
    return texteNettoye(generative.overview && generative.overview.text)
      || texteNettoye(generative.description && generative.description.text)
      || texteNettoye(p.editorialSummary && p.editorialSummary.text)
      || "";
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
    const noms = String(brut).split(";")
      .map((x) => PUBLIC[x.trim()])
      .filter(Boolean);
    if (!noms.length) return "";
    return "Public accueilli : " + noms.join(", ") + ".";
  }

  /* ---- Le point d'entrée -------------------------------------------------
     Retourne toujours un objet : `texte` peut être vide, mais le contrat ne
     change pas. `source` dit d'où ça vient, `generique` dit si la phrase
     parle du lieu ou de sa catégorie. */
  function explication(item) {
    const l = item || {};
    const tags = l.tags || {};

    const google = texteNettoye(l.resumeGoogle);
    if (google) return { texte:google, source:SOURCES.GOOGLE, generique:false,
      mention:MENTION.google, public:publicDe(tags) };
    const propre = texteNettoye(l.description) || texteNettoye(tags.description) || texteNettoye(tags.note);
    if (propre && l.descriptionSource === "google") {
      return { texte: propre, source: SOURCES.GOOGLE, generique:false,
        mention:MENTION.google, public:publicDe(tags) };
    }
    if (propre) return { texte: propre, source: SOURCES.OSM, generique: false,
                         mention: MENTION.openstreetmap, public: publicDe(tags) };

    const reseau = reseauDe(l.titre || l.title || l.nom);
    if (reseau) return { texte: reseau, source: SOURCES.RESEAU, generique: true,
                         mention: MENTION.reseau, public: publicDe(tags) };

    const type = typeDe(tags);
    if (type) return { texte: type, source: SOURCES.TYPE, generique: true,
                       mention: MENTION.type, public: publicDe(tags) };

    const cat = PAR_CATEGORIE[l.cat];
    if (cat) return { texte: cat, source: SOURCES.CATEGORIE, generique: true,
                      mention: MENTION.categorie, public: publicDe(tags) };

    return { texte: "", source: null, generique: false, mention: "", public: publicDe(tags) };
  }

  /* Une phrase, pour une ligne de liste : la première du descriptif. */
  function resumeCourt(item, maxi) {
    const e = explication(item);
    if (!e.texte) return "";
    const limite = maxi || 120;
    const premiere = e.texte.split(/(?<=[.!?])\s/)[0] || e.texte;
    if (premiere.length <= limite) return premiere;
    const coupe = premiere.slice(0, limite);
    const espace = coupe.lastIndexOf(" ");
    return (espace > 40 ? coupe.slice(0, espace) : coupe).replace(/[,;:]$/, "") + "…";
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
    resumeCourt,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
