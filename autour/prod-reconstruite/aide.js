(function(root) {
  "use strict";
  const BESOINS = Object.freeze([
    {
      id: "manger",
      emoji: "\u{1F37D}\uFE0F",
      label: "Manger",
      mots: [
        "manger",
        "faim",
        "plus assez pour manger",
        "rien a manger",
        "alimentaire",
        "nourriture",
        "repas",
        "frigo vide",
        "courses",
        "de quoi manger",
        "colis",
        "distribution",
        "soupe",
        "cantine",
        "nourrir mes enfants",
        "je n ai plus rien"
      ],
      cats: ["alimentaire", "collecte", "food"],
      reseaux: [
        /rest(?:o|aurant)s? du c(?:oe|œ|o)ur/i,
        /banque alimentaire/i,
        /[ée]picerie\s*(?:solidaire|sociale)/i,
        /secours populaire/i,
        /secours catholique/i,
        /croix[-\s]rouge/i,
        /restaurant social/i,
        /soupe populaire/i
      ],
      pourquoi: "Tu cherches de quoi manger."
    },
    {
      id: "logement",
      emoji: "\u{1F3E0}",
      label: "Logement",
      mots: [
        "logement",
        "loyer",
        "dormir",
        "hebergement",
        "abri",
        "sans logement",
        "a la rue",
        "expulsion",
        "expulse",
        "je dors dehors",
        "un toit",
        "foyer",
        "heberge",
        "aide au loyer",
        "impaye",
        "cal",
        "je peux plus payer"
      ],
      cats: ["hebergement", "asso", "mairie"],
      reseaux: [
        /\bccas\b/i,
        /samu\s*social/i,
        /\b115\b/i,
        /adil/i,
        /action logement/i,
        /\bcaf\b/i,
        /secours catholique/i
      ],
      pourquoi: "Tu cherches un h\xE9bergement ou une aide au logement."
    },
    {
      id: "travail",
      emoji: "\u{1F4BC}",
      label: "Travail / argent",
      mots: [
        "travail",
        "emploi",
        "mission locale",
        "mission emploi",
        "melt",
        "boulot",
        "job",
        "trouver du travail",
        "pas de travail",
        "chomage",
        "licencie",
        "formation",
        "me former",
        "apprentissage",
        "alternance",
        "stage",
        "cv",
        "recrutement",
        "entretien",
        "reconversion",
        "chercher un emploi",
        "sans emploi",
        // l'argent et le travail se cherchent ensemble : un même guichet
        // instruit souvent les deux
        "argent",
        "pas d argent",
        "dettes",
        "dette",
        "surendettement",
        "aide financiere",
        "fin de mois",
        "rsa",
        "allocation",
        "allocations",
        "sans ressources",
        "je n arrive plus a payer"
      ],
      cats: ["emploi", "asso", "mairie"],
      reseaux: [
        /mission locale|mission emploi|\bmelt\b/i,
        /france travail|p[oô]le emploi/i,
        /cap emploi/i,
        /maison de l['’\s]?emploi/i,
        /\bepide\b/i,
        /garantie jeunes/i
      ],
      pourquoi: "Tu cherches du travail ou une formation."
    },
    /* La mobilité manquait, et c'est un vrai trou : ne pas pouvoir se
       déplacer bloque tout le reste — un rendez-vous à la mission locale, un
       entretien, une distribution à l'autre bout de la ville. Les guichets
       existent (aide au permis, tarification solidaire, garages associatifs),
       mais personne ne les cherche sous le mot « mobilité ». */
    {
      /* `horsGrille`, comme hygiène et vêtements : le besoin entre dans le
         modèle et se reconnaît dans une phrase, mais l'écran garde ses dix
         cases. Ajouter une onzième case relève d'une décision de design, pas
         d'une correction de périmètre — et le design est gelé. */
      id: "mobilite",
      emoji: "\u{1F68C}",
      label: "Se d\xE9placer",
      horsGrille: true,
      mots: [
        "me deplacer",
        "deplacement",
        "transport",
        "transports",
        "bus",
        "metro",
        "tram",
        "train",
        "ticket",
        "abonnement",
        "titre de transport",
        "pas de voiture",
        "sans voiture",
        "je peux pas y aller",
        "permis",
        "code de la route",
        "auto ecole",
        "aide au permis",
        "velo solidaire",
        "mobilite",
        "trajet",
        "aller au travail",
        "pas les moyens de me deplacer"
      ],
      cats: ["mairie", "asso", "emploi"],
      reseaux: [
        /\bccas\b/i,
        /mission locale/i,
        /plateforme (?:de )?mobilit[ée]/i,
        /auto[- ]?[ée]cole sociale/i,
        /garage solidaire|garage associatif/i,
        /\bwimoov\b/i
      ],
      pourquoi: "Tu cherches une solution pour te d\xE9placer."
    },
    {
      id: "papiers",
      emoji: "\u{1F4C4}",
      label: "Papiers / d\xE9marches",
      mots: [
        "papiers",
        "demarche",
        "demarches",
        "administratif",
        "administrative",
        "dossier",
        "formulaire",
        "je comprends rien",
        "aide administrative",
        "titre de sejour",
        "carte d identite",
        "passeport",
        "impots",
        "declaration",
        "caf",
        "courrier",
        "en ligne",
        "numerique",
        "domiciliation",
        "adresse",
        "ecrire une lettre"
      ],
      cats: ["mairie", "asso", "emploi"],
      reseaux: [
        /(?:maison\s*)?france\s*services|maison\s*de services au public/i,
        /\bccas\b/i,
        /mairie/i,
        /prefecture/i,
        /mission locale/i,
        /point d['’\s]?acc[èe]s au droit/i
      ],
      pourquoi: "Tu cherches de l\u2019aide pour des d\xE9marches."
    },
    {
      id: "sante",
      emoji: "\u{1FA7A}",
      label: "Sant\xE9",
      mots: [
        "sante",
        "malade",
        "medecin",
        "docteur",
        "soigner",
        "soins",
        "dentiste",
        "hopital",
        "clinique",
        "urgences",
        "generaliste",
        "mal",
        "douleur",
        "medicament",
        "pharmacie",
        "vaccination",
        "depistage",
        "sans mutuelle",
        "pas de mutuelle",
        "sans carte vitale",
        "pas de securite sociale",
        "sans securite sociale",
        "pas d argent pour me soigner",
        "sans argent pour me soigner",
        "sante sexuelle",
        "contraception",
        "planning familial",
        "ivg",
        "grossesse",
        "enceinte",
        "sage femme",
        "sage-femme"
      ],
      cats: ["sante", "asso"],
      reseaux: [
        /permanence d['’\s]?acc[èe]s aux soins|\bpass\b\s*sant/i,
        /centre de sant[ée]/i,
        /h[oô]pital/i,
        /pharmacie/i,
        /m[ée]decins du monde/i,
        /croix[-\s]rouge/i
      ],
      pourquoi: "Tu cherches \xE0 te soigner."
    },
    {
      id: "jeunes",
      emoji: "\u{1F393}",
      label: "Jeunes / \xE9tudes",
      mots: [
        "jeune",
        "jeunes",
        "etudiant",
        "etudiante",
        "etudes",
        "lycee",
        "universite",
        "fac",
        "bourse",
        "crous",
        "scolarite",
        "orientation",
        "mission locale",
        "decrochage",
        "decrochage scolaire",
        "j ai 16 ans",
        "j ai 17 ans",
        "j ai 18 ans",
        "j ai 19 ans",
        "j ai 20 ans",
        "j ai 21 ans",
        "j ai 22 ans",
        "j ai 23 ans",
        "j ai 24 ans",
        "j ai 25 ans",
        "mineur"
      ],
      cats: ["emploi", "asso", "biblio"],
      reseaux: [
        /mission locale/i,
        /\bcrous\b/i,
        /\bcrij\b|information jeunesse/i,
        /point information jeunesse/i,
        /\bbij\b/i
      ],
      pourquoi: "Tu es jeune ou \xE9tudiant."
    },
    /* Hygiène et vêtements ne sont plus des cases à l'écran — dix cases, pas
       douze — mais restent des besoins à part entière : reconnus dans une
       phrase libre, et atteignables par « Autre aide », dont les catégories
       les incluent. Les retirer du modèle aurait fait perdre des douches et
       des vestiaires à ceux qui les cherchent. */
    {
      id: "hygiene",
      emoji: "\u{1F6BF}",
      label: "Hygi\xE8ne",
      horsGrille: true,
      mots: [
        "douche",
        "me laver",
        "laver",
        "hygiene",
        "toilettes",
        "wc",
        "laverie",
        "linge",
        "lessive",
        "propre",
        "sanitaire"
      ],
      cats: ["toilettes", "asso", "hebergement"],
      reseaux: [/bains[-\s]douches/i, /accueil de jour/i, /croix[-\s]rouge/i],
      pourquoi: "Tu cherches un endroit pour te laver ou laver ton linge."
    },
    {
      id: "vetements",
      emoji: "\u{1F455}",
      label: "V\xEAtements",
      horsGrille: true,
      mots: [
        "vetement",
        "vetements",
        "habits",
        "s habiller",
        "vestiaire",
        "chaussures",
        "manteau",
        "friperie solidaire",
        "habiller mes enfants"
      ],
      cats: ["collecte", "asso", "friperie"],
      reseaux: [
        /vestiaire/i,
        /secours populaire/i,
        /secours catholique/i,
        /croix[-\s]rouge/i,
        /emma(?:ü|u)s/i,
        /le relais/i
      ],
      pourquoi: "Tu cherches des v\xEAtements."
    },
    {
      id: "parler",
      emoji: "\u{1F4AC}",
      label: "Parler \xE0 quelqu\u2019un",
      mots: [
        "parler",
        "parler a quelqu un",
        "ecoute",
        "seul",
        "solitude",
        "isole",
        "isolement",
        "mal dans ma tete",
        "deprime",
        "depression",
        "anxiete",
        "angoisse",
        "ca va pas",
        "moral",
        "psy",
        "psychologue",
        "psychiatre",
        "psychotherapeute",
        "sante mentale",
        "cmp",
        "soutien moral",
        "j en peux plus",
        "besoin de parler",
        "j ai besoin de parler a quelqu un"
      ],
      cats: ["sante", "asso"],
      reseaux: [
        /\bcmp\b/i,
        /point [ée]coute/i,
        /maison des adolescents/i,
        /\bbapu\b/i,
        /sant[ée] psy [ée]tudiant/i,
        /mon soutien psy/i,
        /psychologue|psychoth[ée]rapeute|psychiatre/i,
        /planning familial/i,
        /sos amiti[ée]/i,
        /centre social/i
      ],
      pourquoi: "Tu cherches quelqu\u2019un \xE0 qui parler."
    },
    {
      id: "famille",
      emoji: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
      label: "Famille",
      mots: [
        "famille",
        "mes enfants",
        "garde",
        "creche",
        "nounou",
        "parent",
        "parents",
        "separation",
        "divorce",
        "pension",
        "scolarite",
        "cantine",
        "aide aux devoirs",
        "parentalite",
        "grossesse",
        "je suis enceinte",
        "bebe"
      ],
      cats: ["asso", "mairie", "sante"],
      reseaux: [
        /\bcaf\b/i,
        /\bpmi\b|protection maternelle/i,
        /centre social/i,
        /maison de quartier/i,
        /\bccas\b/i,
        /planning familial/i
      ],
      pourquoi: "Tu cherches de l\u2019aide pour ta famille."
    },
    {
      id: "securite",
      emoji: "\u{1F6E1}\uFE0F",
      label: "S\xE9curit\xE9",
      mots: [
        "violence",
        "violences",
        "frappe",
        "menace",
        "menacee",
        "peur",
        "harcelement",
        "harcele",
        "danger",
        "agression",
        "agressee",
        "agresse",
        "je ne me sens pas en securite",
        "porter plainte",
        "protection",
        "victime"
      ],
      cats: ["asso", "sante", "mairie", "hebergement"],
      reseaux: [
        /\b3919\b/i,
        /france victimes/i,
        /planning familial/i,
        /point d['’\s]?acces au droit/i,
        /commissariat|gendarmerie/i
      ],
      pourquoi: "Tu cherches de la protection ou du soutien."
    },
    {
      id: "autre",
      emoji: "\u2795",
      label: "Autre aide",
      mots: [
        "aide",
        "aider",
        "coup de main",
        "soutien",
        "accompagnement",
        "je sais pas ou aller",
        "je viens d arriver",
        "perdu",
        "orienter",
        "conseil",
        "dispositif",
        "dispositifs",
        "je ne connais pas",
        "quelqu un a qui parler"
      ],
      // « Autre » couvre aussi ce qui n'a plus de case : douches, vestiaires
      cats: [
        "asso",
        "mairie",
        "alimentaire",
        "hebergement",
        "sante",
        "emploi",
        "toilettes",
        "collecte",
        "friperie"
      ],
      reseaux: [
        /maison\s*france\s*services/i,
        /centre social/i,
        /maison de quartier/i,
        /\bccas\b/i
      ],
      pourquoi: "Tu cherches de l\u2019aide, sans savoir par o\xF9 commencer."
    }
  ]);
  const BESOIN_DE = (id) => BESOINS.find((b) => b.id === id) || null;
  const BESOINS_GRILLE = Object.freeze(BESOINS.filter((b) => !b.horsGrille));
  const SOUS_INTENTIONS_SANTE = Object.freeze([
    {
      id: "medicaments",
      mots: ["pharmacie", "medicament", "medicaments", "ordonnance", "drugstore"],
      lieux: [/\bpharmacy\b|\bdrugstore\b|\bpharmacie\b|\bm[ée]dicament/i]
    },
    {
      id: "soins",
      mots: [
        "medecin",
        "docteur",
        "generaliste",
        "voir un medecin",
        "me soigner",
        "consultation",
        "kine",
        "kinesitherapeute",
        "physiotherapeute"
      ],
      lieux: [
        /\bdoctor\b|\bdoctors\b|medical.center|medical.clinic|centre de sant/i,
        /g[ée]n[ée]raliste|m[ée]decin|docteur|physiotherapist|kin[ée]sith/i,
        /permanence d.acc[èe]s aux soins|\bpass\b.*sant|\bpass\b.*permanence/i
      ]
    },
    {
      id: "hopital",
      mots: ["hopital", "urgences", "urgence medicale", "clinique"],
      lieux: [/general.hospital|\bhospital\b|h[oô]pital|\burgences?\b/i]
    },
    {
      id: "dentaire",
      mots: ["dent", "dents", "mal aux dents", "dentiste", "dentaire"],
      lieux: [/dental.clinic|\bdentist\b|dentiste|dentaire/i]
    },
    {
      id: "mentale",
      mots: [
        "psy",
        "psychologue",
        "psychiatre",
        "psychotherapeute",
        "cmp",
        "cmpp",
        "sante mentale",
        "crise d angoisse",
        "crises d angoisse",
        "angoisse",
        "anxiete",
        "depression",
        "deprime",
        "besoin de parler",
        "parler a quelqu un"
      ],
      lieux: [
        /psych|psychiatr|psychotherap|counselling|\bcmp\b|\bcmpp\b|\bbapu\b/i,
        /point accueil [ée]coute|\bpaej\b|maison des adolescents|sant[ée] psy [ée]tudiant/i
      ]
    },
    {
      id: "depistage",
      mots: ["depistage", "test", "analyse", "analyses", "laboratoire", "vaccination"],
      lieux: [/medical.lab|laboratoire|d[ée]pistage|\bcegidd\b|vaccination/i]
    },
    {
      id: "sexuelle",
      mots: [
        "sante sexuelle",
        "grossesse",
        "enceinte",
        "contraception",
        "ivg",
        "planning familial",
        "sage femme",
        "sage-femme",
        "maternite"
      ],
      lieux: [/planning familial|sant[ée] sexuelle|contraception|\bivg\b|sage.femme|maternit|\bpmi\b/i]
    },
    {
      id: "acces",
      mots: [
        "gratuit",
        "gratuite",
        "sans argent",
        "pas d argent",
        "sans mutuelle",
        "pas de mutuelle",
        "sans securite sociale",
        "pas de securite sociale",
        "sans carte vitale",
        "pas de carte vitale",
        "sans couverture"
      ],
      lieux: [
        /permanence d.acc[èe]s aux soins|\bpass\b.*sant|\bcmp\b|\bcmpp\b|\bbapu\b/i,
        /sant[ée] psy [ée]tudiant|service de sant[ée] [ée]tudiant/i
      ]
    }
  ]);
  const CATEGORIES_DIRECTES = Object.freeze({
    /* `food` est une catégorie éditoriale de découverte : elle contient des
       restaurants, ateliers de cuisine et marchés. Ce n'est jamais, à elle
       seule, une preuve d'aide alimentaire. Les réseaux et les données
       explicitement `alimentaire` / `collecte` restent admis ci-dessous. */
    manger: ["alimentaire", "collecte"],
    logement: ["hebergement"],
    travail: ["emploi"],
    papiers: ["mairie"],
    sante: ["sante"],
    jeunes: [],
    hygiene: ["toilettes"],
    vetements: [],
    // Une pharmacie ou un hôpital générique ne répond pas, à lui seul, à une
    // demande de soutien psychologique. Pour « parler », le nom, le service
    // ou les tags doivent explicitement attester la santé mentale.
    parler: [],
    famille: [],
    securite: [],
    autre: []
  });
  const URGENCE = /\burgence|\b115\b|\b3114\b|samu social|maraude|sans[- ]abri|ce soir|cette nuit|tout de suite|je dors dehors\b|id[ée]es? suicidaires?|suicide/i;
  const CONDITIONS = Object.freeze([
    {
      motif: /mission locale/i,
      age: { min: 16, max: 25 },
      texte: "Pour les 16-25 ans sortis du syst\xE8me scolaire.",
      source: "reseau",
      confidence: 0.9
    },
    {
      motif: /\bcrous\b/i,
      public: ["\xE9tudiants"],
      texte: "R\xE9serv\xE9 aux \xE9tudiants.",
      source: "reseau",
      confidence: 0.9
    },
    {
      motif: /cap emploi/i,
      public: ["personnes en situation de handicap"],
      texte: "Pour les personnes en situation de handicap.",
      source: "reseau",
      confidence: 0.9
    },
    {
      motif: /france travail|p[oô]le emploi/i,
      texte: "Inscription pr\xE9alable n\xE9cessaire pour la plupart des d\xE9marches.",
      source: "reseau",
      confidence: 0.8
    },
    {
      motif: /[ée]picerie\s*(?:solidaire|sociale)/i,
      texte: "Acc\xE8s sur orientation d\u2019un travailleur social, pour une dur\xE9e limit\xE9e.",
      source: "reseau",
      confidence: 0.8
    },
    {
      motif: /rest(?:o|aurant)s? du c(?:oe|œ|o)ur/i,
      texte: "Inscription au centre, avec pi\xE8ce d\u2019identit\xE9 et justificatif de ressources.",
      source: "reseau",
      confidence: 0.85
    },
    {
      motif: /banque alimentaire/i,
      texte: "Ne distribue en g\xE9n\xE9ral pas directement aux particuliers.",
      source: "reseau",
      confidence: 0.85
    },
    {
      motif: /\bccas\b/i,
      texte: "Il faut habiter la commune.",
      source: "reseau",
      confidence: 0.8
    },
    {
      motif: /\b115\b|samu social/i,
      texte: "Appeler le 115 avant de se d\xE9placer : gratuit, 24 h/24.",
      source: "reseau",
      confidence: 0.95
    },
    {
      motif: /permanence d['’\s]?acc[èe]s aux soins|\bpass\b\s*sant/i,
      texte: "Pour les personnes malades en situation de pr\xE9carit\xE9, notamment sans couverture ou sans possibilit\xE9 de payer.",
      source: "reseau",
      confidence: 0.95
    },
    {
      motif: /\bcmpp\b/i,
      public: ["enfants", "adolescents", "familles"],
      texte: "Pour les enfants, les adolescents et leurs familles ; v\xE9rifier le secteur et les modalit\xE9s locales.",
      source: "reseau",
      confidence: 0.9
    },
    {
      motif: /\bpaej\b|point accueil [ée]coute jeunes/i,
      age: { min: 12, max: 25 },
      texte: "Accueil et \xE9coute pour les jeunes de 12 \xE0 25 ans ; ce n\u2019est pas un service de soins m\xE9dicalis\xE9s.",
      source: "reseau",
      confidence: 0.9
    },
    {
      motif: /\bbapu\b|bureau d['’\s]?aide psychologique universitaire/i,
      public: ["\xE9tudiants"],
      texte: "R\xE9serv\xE9 aux \xE9tudiants ; consultations prises en charge sans avance de frais.",
      source: "reseau",
      confidence: 0.95
    },
    {
      motif: /sant[ée] psy [ée]tudiant/i,
      public: ["\xE9tudiants"],
      texte: "R\xE9serv\xE9 aux \xE9tudiants \xE9ligibles au dispositif Sant\xE9 Psy \xC9tudiant.",
      source: "reseau",
      confidence: 0.95
    },
    {
      motif: /maison des adolescents/i,
      public: ["adolescents", "familles"],
      texte: "Pour les adolescents et leurs proches ; l\u2019\xE2ge d\u2019accueil d\xE9pend de la structure.",
      source: "reseau",
      confidence: 0.85
    }
  ]);
  function conditionDe(lieu) {
    const nom = String(lieu && (lieu.titre || lieu.title) || "");
    const trouve = CONDITIONS.find((c) => c.motif.test(nom));
    if (!trouve) return null;
    return {
      texte: trouve.texte,
      age: trouve.age || null,
      public: trouve.public || null,
      source: trouve.source,
      confidence: trouve.confidence
    };
  }
  function sansAccents(s) {
    const C = root.AutourComprendre;
    if (C && C.sansAccents) return C.sansAccents(s);
    return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  }
  function contient(t, mot) {
    const C = root.AutourComprendre;
    if (C && C.contient) return C.contient(t, mot);
    return t.indexOf(sansAccents(mot)) >= 0;
  }
  function besoinsDepuisPhrase(phrase) {
    const t = sansAccents(phrase);
    if (!t) return [];
    const trouves = [];
    BESOINS.forEach((b) => {
      const mots = b.mots.slice().sort((x, y) => y.length - x.length);
      let poids = 0;
      let vu = null;
      mots.forEach((m) => {
        if (!contient(t, m)) return;
        const p = m.includes(" ") ? 1 + Math.min(0.4, m.length / 100) : 0.8;
        if (p > poids) {
          poids = p;
          vu = m;
        }
      });
      if (poids > 0) trouves.push({ id: b.id, poids, mot: vu });
    });
    const precis = trouves.filter((x) => x.id !== "autre");
    const liste = precis.length ? precis : trouves;
    return liste.sort((a, b) => b.poids - a.poids);
  }
  function intentionsSanteDepuisPhrase(phrase) {
    const t = sansAccents(phrase);
    if (!t) return [];
    return SOUS_INTENTIONS_SANTE.map((intention) => {
      let poids = 0, mot = null;
      intention.mots.slice().sort((a, b) => b.length - a.length).forEach((m) => {
        if (!contient(t, m)) return;
        const p = m.includes(" ") ? 1 : 0.8;
        if (p > poids) {
          poids = p;
          mot = m;
        }
      });
      return poids ? { id: intention.id, poids, mot } : null;
    }).filter(Boolean).sort((a, b) => b.poids - a.poids);
  }
  function ageDepuisPhrase(phrase) {
    const t = sansAccents(phrase);
    const m = /\b(?:j ai|jai|age|ans)\D{0,6}(\d{1,2})\s*ans\b/.exec(t) || /\b(\d{1,2})\s*ans\b/.exec(t);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 10 && n <= 110 ? n : null;
  }
  function texteLieu(lieu) {
    const l = lieu || {};
    const tags = l.tags || {};
    return [
      l.titre,
      l.title,
      l.service,
      l.description,
      tags.social_facility,
      tags.amenity,
      tags.office,
      tags.healthcare,
      tags["healthcare:speciality"],
      tags["healthcare:counselling"]
    ].filter(Boolean).join(" ");
  }
  function categoriesLieu(lieu) {
    const l = lieu || {};
    return new Set([l.cat, ...l.categories || []].filter(Boolean));
  }
  function texteSanteLieu(lieu) {
    const l = lieu || {};
    return [texteLieu(l), l.type, l.primaryType, ...l.categories || []].filter(Boolean).join(" ");
  }
  function accesAdapteSante(lieu) {
    const l = lieu || {}, tags = l.tags || {};
    if (l.accesSanteDocumente === true || l.gratuit === true || l.prix === 0 || tags.fee === "no")
      return true;
    const acces = SOUS_INTENTIONS_SANTE.find((x) => x.id === "acces");
    return !!(acces && acces.lieux.some((re) => re.test(texteSanteLieu(l))));
  }
  function pertinenceSante(lieu, intentionId) {
    const intention = SOUS_INTENTIONS_SANTE.find((x) => x.id === intentionId);
    if (!intention || !lieu) return { poids: 0, direct: false };
    if (intentionId === "acces")
      return accesAdapteSante(lieu) ? { poids: 1, direct: true } : { poids: 0, direct: false };
    const direct = intention.lieux.some((re) => re.test(texteSanteLieu(lieu)));
    return { poids: direct ? 0.9 : 0, direct };
  }
  function estSolutionSante(lieu, intentions2, options) {
    const ids = (intentions2 || []).filter((id) => SOUS_INTENTIONS_SANTE.some((x) => x.id === id));
    const exigeAcces = ids.includes("acces") || !!(options && options.exigerAccesAdapte);
    if (exigeAcces && !accesAdapteSante(lieu)) return false;
    const services = ids.filter((id) => id !== "acces");
    if (services.length) return services.some((id) => pertinenceSante(lieu, id).direct);
    return categoriesLieu(lieu).has("sante") || SOUS_INTENTIONS_SANTE.filter((x) => x.id !== "acces").some((x) => x.lieux.some((re) => re.test(texteSanteLieu(lieu))));
  }
  function pertinence(lieu, besoinId) {
    const b = BESOIN_DE(besoinId);
    if (!b || !lieu) return { poids: 0, raison: "", sur: false, direct: false };
    const CLASSEMENT = root.AutourAideClassement;
    if (!CLASSEMENT) return pertinenceSansClassement(lieu, b);
    const v = CLASSEMENT.repond(lieu, besoinId);
    if (v && v.accorde) {
      if (!CLASSEMENT.estSolutionOntologique(lieu, [besoinId]))
        return {
          poids: 0,
          raison: "",
          sur: false,
          direct: false,
          refus: "preuve_ontologique_absente"
        };
      return {
        /* La confiance du classement, ramenée entre 0 et 1. Un lieu accepté
           est au moins au seuil, donc au moins à 0,5 : `pourquoi()` qui exige
           0,6 reste servi par les preuves solides et pas par les limites. */
        poids: Math.min(1, v.confiance / 100),
        raison: b.pourquoi,
        sur: v.certaine === true,
        direct: true,
        preuves: v.preuves
      };
    }
    if (categoriesLieu(lieu).has("asso"))
      return { poids: 0.25, raison: b.pourquoi, sur: false, direct: false };
    return {
      poids: 0,
      raison: "",
      sur: false,
      direct: false,
      refus: v ? v.refus : null
    };
  }
  function pertinenceSansClassement(lieu, b) {
    const directes = CATEGORIES_DIRECTES[b.id] || (b.id === "autre" ? b.cats : []);
    const cats = categoriesLieu(lieu);
    if (directes.some((c) => cats.has(c)))
      return { poids: 0.72, raison: b.pourquoi, sur: false, direct: true };
    if (cats.has("asso"))
      return { poids: 0.25, raison: b.pourquoi, sur: false, direct: false };
    return { poids: 0, raison: "", sur: false, direct: false };
  }
  const MAX_SECONDAIRES = 3;
  function intentions(phrase) {
    const trouves = besoinsDepuisPhrase(phrase).map((x) => x.id);
    if (!trouves.length) return { primaryNeed: null, secondaryNeeds: [], besoins: [] };
    const principal = trouves[0];
    const TAXO = root.AutourAideTaxonomie;
    const b = TAXO ? TAXO.besoin(principal) : null;
    const habituels = b ? b.secondaires : [];
    const secondaires = [];
    trouves.slice(1).forEach((id) => {
      if (secondaires.indexOf(id) < 0) secondaires.push(id);
    });
    habituels.forEach((id) => {
      if (id !== principal && secondaires.indexOf(id) < 0) secondaires.push(id);
    });
    return {
      primaryNeed: principal,
      secondaryNeeds: secondaires.slice(0, MAX_SECONDAIRES),
      /* Les identifiants Autour, pour l'appelant qui préfère sa propre forme. */
      besoins: trouves
    };
  }
  function capacitesDe(lieu) {
    const CLASSEMENT = root.AutourAideClassement;
    if (!CLASSEMENT) return null;
    return CLASSEMENT.capacites(lieu);
  }
  const TYPES_TOURISTIQUES = Object.freeze([
    "hotel",
    "lodging",
    "hostel",
    "motel",
    "guest_house",
    "tourist_attraction",
    "museum",
    "musee",
    "art_gallery",
    "historic_site",
    "monument",
    "tourism",
    "event",
    "festival",
    "concert",
    "theatre",
    "theater"
  ]);
  const RESEAUX_LOGEMENT_RECONNUS = /\b(?:ccas|samu\s*social|115|adil|action\s+logement|chrs|maison\s+relais|pension\s+de\s+famille|hebergement\s+d.?urgence)\b/i;
  const ALIAS_CATEGORIES_AIDE = Object.freeze({
    manger: ["manger", "food_aid", "food_assistance", "alimentaire", "collecte"],
    logement: ["logement", "housing_aid", "housing_assistance", "hebergement", "shelter"],
    travail: ["travail", "employment_aid", "employment_assistance", "financial_assistance", "emploi"],
    papiers: ["papiers", "administrative_aid", "administrative_help", "administrative_assistance", "mairie"],
    sante: ["sante", "health_aid", "health_assistance", "soins"],
    jeunes: ["jeunes", "youth_aid", "youth_support"],
    parler: ["parler", "listening_support", "emotional_support"],
    famille: ["famille", "family_support"],
    securite: ["securite", "safety", "safety_support"],
    autre: ["autre", "other_aid", "help"]
  });
  function normaliserCategorieAide(valeur) {
    return sansAccents(String(valeur || "")).trim().replace(/[\s-]+/g, "_");
  }
  function texteTypeLieu(lieu) {
    const l = lieu || {};
    const tags = l.tags || {};
    return [
      l.primaryType,
      l.type,
      l.placeType,
      l.category,
      l.cat,
      ...l.categories || [],
      tags.tourism,
      tags.historic,
      tags.amenity,
      tags.leisure
    ].filter(Boolean).map(sansAccents).join(" ");
  }
  function categoriesAideDocumentees(lieu) {
    const l = lieu || {};
    return new Set([
      ...Array.isArray(l.aidCategories) ? l.aidCategories : [],
      ...Array.isArray(l.aid_categories) ? l.aid_categories : [],
      ...Array.isArray(l.categoriesAide) ? l.categoriesAide : [],
      ...Array.isArray(l.categories_aide) ? l.categories_aide : []
    ].map(normaliserCategorieAide).filter(Boolean));
  }
  function estFournisseurAide(lieu, besoins) {
    const l = lieu || {};
    const ids = (besoins || []).filter(Boolean);
    const documentees = categoriesAideDocumentees(l);
    const fournisseurExplicite = l.isAidProvider === true || l.is_aid_provider === true;
    if (l.isAidProvider === false || l.is_aid_provider === false) return false;
    const classement = root.AutourAideClassement;
    if (classement) {
      const c = classement.classificationAide(l);
      if (c.excluded || !classement.estSolutionOntologique(l, ids)) return false;
    }
    if (fournisseurExplicite || documentees.size) {
      if (!documentees.size) return fournisseurExplicite;
      return ids.some((id) => {
        const besoin = normaliserCategorieAide(id);
        const aliases = ALIAS_CATEGORIES_AIDE[besoin] || [besoin];
        return aliases.some((alias) => documentees.has(normaliserCategorieAide(alias)));
      });
    }
    const tags = l.tags || {};
    const type = texteTypeLieu(lieu);
    const source = String(l.source || "").toLowerCase();
    if (TYPES_TOURISTIQUES.some((motif) => type.split(/\s+/).includes(sansAccents(motif))) || tags.tourism || tags.historic || tags.heritage) return false;
    if (l.isTemporary === true || l.temporaire === true) return false;
    if (["google_places", "datatourisme"].includes(source)) return false;
    if (ids.includes("logement")) {
      const nom = String(l.titre || l.title || l.name || "");
      if (/\b(?:maison|h[ôo]tel|logement)\b/i.test(nom) && !RESEAUX_LOGEMENT_RECONNUS.test(nom)) return false;
    }
    return true;
  }
  function estSolution(lieu, besoins, options) {
    const ids = (besoins || []).filter((id) => !!BESOIN_DE(id));
    if (!ids.length) return false;
    if (!estFournisseurAide(lieu, ids)) return false;
    const classement = root.AutourAideClassement;
    if (classement && !classement.estSolutionOntologique(lieu, ids)) return false;
    const o = options || {};
    return ids.some((id) => {
      const p = pertinence(lieu, id, { large: o.large === true });
      return p.direct === true || o.accepterLarge === true && p.poids > 0;
    });
  }
  function rendezVousDe(lieu) {
    const l = lieu || {};
    const tag = String((l.tags || {}).appointment || "").toLowerCase();
    if (["yes", "required", "only"].includes(tag)) return { label: "Sur rendez-vous", source: "OpenStreetMap" };
    if (["no", "walk_in"].includes(tag)) return { label: "Sans rendez-vous", source: "OpenStreetMap" };
    const condition = conditionDe(l);
    const texte = [condition && condition.texte, l.description, l.service].filter(Boolean).join(" ");
    if (/sans rendez-vous/i.test(texte)) return { label: "Sans rendez-vous", source: condition ? "R\xE9seau" : "Structure" };
    if (/rendez-vous/i.test(texte)) return { label: "Sur rendez-vous", source: condition ? "R\xE9seau" : "Structure" };
    return null;
  }
  function pourquoi(lieu, besoins, profil) {
    const raisons = [];
    (besoins || []).forEach((id) => {
      const p = pertinence(lieu, id);
      if (p.poids >= 0.6 && !raisons.includes(p.raison)) raisons.push(p.raison);
    });
    const cond = conditionDe(lieu);
    const age = profil && Number.isFinite(Number(profil.age)) ? Number(profil.age) : null;
    if (cond && cond.age && age != null && age >= cond.age.min && age <= cond.age.max)
      raisons.push("Tu as " + age + " ans, et ce r\xE9seau accompagne les " + cond.age.min + "-" + cond.age.max + " ans.");
    return raisons.join(" ");
  }
  function convient(lieu, profil) {
    const cond = conditionDe(lieu);
    if (!cond || !cond.age) return null;
    const age = profil && Number.isFinite(Number(profil.age)) ? Number(profil.age) : null;
    if (age == null) return null;
    return age >= cond.age.min && age <= cond.age.max;
  }
  const estUrgent = (phrase) => URGENCE.test(String(phrase || ""));
  function estServiceUrgence(lieu) {
    const classement = root.AutourAideClassement;
    return !!(classement && classement.estServiceUrgence(lieu));
  }
  const PERIMETRE = Object.freeze([
    "manger",
    "se loger",
    "travail et argent",
    "papiers et d\xE9marches",
    "sant\xE9",
    "\xE9tudes et jeunes",
    "parler \xE0 quelqu\u2019un",
    "famille",
    "s\xE9curit\xE9 et violences",
    "se d\xE9placer",
    "hygi\xE8ne",
    "v\xEAtements"
  ]);
  const OBJETS_REPARABLES = Object.freeze([
    {
      id: "velo",
      mots: ["velo", "velos", "bicyclette", "vtt", "trottinette"],
      requete: "r\xE9parateur de v\xE9los",
      libelle: "une r\xE9paration de v\xE9lo"
    },
    {
      id: "telephone",
      mots: ["telephone", "portable", "smartphone", "iphone", "mobile", "ecran casse"],
      requete: "r\xE9paration t\xE9l\xE9phone",
      libelle: "une r\xE9paration de t\xE9l\xE9phone"
    },
    {
      id: "informatique",
      mots: ["ordinateur", "ordi", "pc", "laptop", "tablette", "imprimante"],
      requete: "r\xE9paration informatique",
      libelle: "une r\xE9paration informatique"
    },
    {
      id: "voiture",
      mots: ["voiture", "auto", "automobile", "moteur", "pneu", "batterie de voiture"],
      requete: "garage automobile",
      libelle: "un garage"
    },
    {
      id: "serrure",
      mots: ["serrure", "cle", "cles", "verrou", "porte claquee", "enferme dehors"],
      requete: "serrurier",
      libelle: "un serrurier"
    },
    {
      id: "plomberie",
      mots: ["robinet", "fuite d eau", "plomberie", "chasse d eau", "canalisation", "chauffe eau"],
      requete: "plombier",
      libelle: "un plombier"
    },
    {
      id: "electricite",
      mots: ["prise electrique", "electricite", "compteur", "disjoncteur", "tableau electrique"],
      requete: "\xE9lectricien",
      libelle: "un \xE9lectricien"
    },
    {
      id: "chaussures",
      mots: ["chaussure", "chaussures", "basket", "baskets", "semelle", "talon"],
      requete: "cordonnier",
      libelle: "un cordonnier"
    },
    {
      id: "couture",
      mots: ["fermeture eclair", "ourlet", "retouche", "couture", "pantalon dechire"],
      requete: "retouche couture",
      libelle: "une retouche"
    },
    {
      id: "lunettes",
      mots: ["lunettes", "verre casse", "monture"],
      requete: "opticien",
      libelle: "un opticien"
    },
    {
      id: "montre",
      mots: ["montre", "horloge", "pile de montre"],
      requete: "horloger",
      libelle: "un horloger"
    },
    {
      id: "electromenager",
      mots: [
        "machine a laver",
        "lave linge",
        "lave vaisselle",
        "frigo",
        "refrigerateur",
        "four",
        "aspirateur",
        "television",
        "tele"
      ],
      requete: "r\xE9paration \xE9lectrom\xE9nager",
      libelle: "une r\xE9paration d\u2019\xE9lectrom\xE9nager"
    }
  ]);
  const SIGNES_PANNE = Object.freeze([
    "casse",
    "cassee",
    "cassees",
    "casses",
    "en panne",
    "panne",
    "creve",
    "crevee",
    "creves",
    "crevees",
    "abime",
    "abimee",
    "abimes",
    "abimees",
    "ne marche plus",
    "ne fonctionne plus",
    "marche plus",
    "fonctionne plus",
    "ne demarre plus",
    "demarre plus",
    "repare",
    "reparer",
    "reparation",
    "reparations",
    "reparateur",
    "depanner",
    "depannage",
    "fuit",
    "fuite",
    "bloque",
    "bloquee",
    "bloques",
    "bloquees",
    "coince",
    "coincee",
    "hs",
    "foutu",
    "foutue",
    "pete",
    "petee",
    "raye",
    "rayee",
    "troue",
    "trouee",
    "trouees",
    "troues"
  ]);
  const SERVICES_EXPLORER = Object.freeze([
    {
      id: "coiffeur",
      mots: ["coiffeur", "coiffeuse", "me faire couper les cheveux"],
      requete: "coiffeur",
      libelle: "un coiffeur"
    },
    {
      id: "pressing",
      mots: ["pressing", "nettoyage a sec", "laverie automatique"],
      requete: "pressing laverie",
      libelle: "un pressing"
    },
    {
      id: "veterinaire",
      mots: ["veterinaire", "mon chien est malade", "mon chat est malade"],
      requete: "v\xE9t\xE9rinaire",
      libelle: "un v\xE9t\xE9rinaire"
    }
  ]);
  const VERBES_RECHERCHE = Object.freeze([
    "je cherche",
    "ou trouver",
    "ou est",
    "je voudrais trouver",
    "j ai besoin d un",
    "j ai besoin d une",
    "il me faut",
    "trouver un",
    "trouver une"
  ]);
  function trouverDans(t, familles) {
    for (const famille of familles) {
      const mots = famille.mots.slice().sort((a, b) => b.length - a.length);
      for (const m of mots) {
        if (contient(t, m)) return { famille, mot: m };
      }
    }
    return null;
  }
  function domaineDeLaPhrase(phrase) {
    const t = sansAccents(phrase);
    if (!t) return { domaine: "aide", raison: "vide" };
    if (estUrgent(phrase)) return { domaine: "aide", raison: "urgence" };
    const routeur = root.AutourIntentions;
    if (routeur) {
      const r = routeur.router(phrase);
      if (routeur.mondeDe(r) === "explorer" && r.confidence >= routeur.SEUIL_CONFIANCE) {
        return {
          domaine: "explorer",
          raison: r.intent === "mobility_problem" ? "reparation" : r.intent === "local_service" ? "service" : "lieu",
          objet: r.category || null,
          requete: r.requete || phrase,
          libelle: r.libelle || null
        };
      }
    }
    const objet = trouverDans(t, OBJETS_REPARABLES);
    const panne = !!objet && SIGNES_PANNE.some((s) => contient(t, s));
    const besoins = besoinsDepuisPhrase(phrase);
    const besoinExplicite = besoins.some((b) => b.poids >= 1);
    if (besoinExplicite) return { domaine: "aide", raison: "besoin" };
    if (panne) {
      return {
        domaine: "explorer",
        raison: "reparation",
        objet: objet.famille.id,
        requete: objet.famille.requete,
        libelle: objet.famille.libelle
      };
    }
    if (besoins.length) return { domaine: "aide", raison: "besoin" };
    const service = trouverDans(t, SERVICES_EXPLORER);
    if (service && (VERBES_RECHERCHE.some((v) => contient(t, v)) || SIGNES_PANNE.some((s) => contient(t, s)) || service.mot === t.trim())) {
      return {
        domaine: "explorer",
        raison: "service",
        objet: service.famille.id,
        requete: service.famille.requete,
        libelle: service.famille.libelle
      };
    }
    return { domaine: "aide", raison: "inconnu" };
  }
  root.AutourAide = Object.freeze({
    BESOINS,
    BESOINS_GRILLE,
    BESOIN_DE,
    CONDITIONS,
    CATEGORIES_DIRECTES,
    SOUS_INTENTIONS_SANTE,
    besoinsDepuisPhrase,
    intentionsSanteDepuisPhrase,
    ageDepuisPhrase,
    pertinence,
    pertinenceSante,
    pourquoi,
    capacitesDe,
    intentions,
    MAX_SECONDAIRES,
    conditionDe,
    convient,
    estSolution,
    estSolutionSante,
    accesAdapteSante,
    estFournisseurAide,
    categoriesAideDocumentees,
    rendezVousDe,
    estUrgent,
    estServiceUrgence,
    PERIMETRE,
    OBJETS_REPARABLES,
    SERVICES_EXPLORER,
    domaineDeLaPhrase
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
