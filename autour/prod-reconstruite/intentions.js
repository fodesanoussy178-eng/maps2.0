(function(root) {
  "use strict";
  const CATEGORIES = Object.freeze({
    /* ---- Les besoins d'aide ---- */
    manger: { icone: "\u{1F37D}\uFE0F", label: "Manger", monde: "aide" },
    logement: { icone: "\u{1F3E0}", label: "Logement", monde: "aide" },
    travail: { icone: "\u{1F4BC}", label: "Travail / argent", monde: "aide" },
    papiers: { icone: "\u{1F4C4}", label: "Papiers / d\xE9marches", monde: "aide" },
    sante: { icone: "\u{1FA7A}", label: "Sant\xE9", monde: "aide" },
    jeunes: { icone: "\u{1F393}", label: "Jeunes / \xE9tudes", monde: "aide" },
    parler: { icone: "\u{1F4AC}", label: "Parler \xE0 quelqu\u2019un", monde: "aide" },
    famille: { icone: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", label: "Famille", monde: "aide" },
    securite: { icone: "\u{1F6E1}\uFE0F", label: "S\xE9curit\xE9", monde: "aide" },
    urgence: { icone: "\u{1F6A8}", label: "Urgence", monde: "aide" },
    mobilite: { icone: "\u{1F68C}", label: "Se d\xE9placer", monde: "aide" },
    hygiene: { icone: "\u{1F6BF}", label: "Hygi\xE8ne", monde: "aide" },
    vetements: { icone: "\u{1F455}", label: "V\xEAtements", monde: "aide" },
    aide: { icone: "\u{1F91D}", label: "Aide", monde: "aide" },
    /* ---- Explorer ---- */
    sortir: { icone: "\u{1F389}", label: "Sortir", monde: "explorer" },
    sport: { icone: "\u26BD", label: "Sport", monde: "explorer" },
    chiller: { icone: "\u2615", label: "Chiller", monde: "explorer" },
    bouger: { icone: "\u{1F6B2}", label: "Bouger", monde: "explorer" },
    lieu: { icone: "\u{1F4CD}", label: "Lieu", monde: "explorer" },
    recherche: { icone: "\u{1F50D}", label: "Rechercher", monde: "explorer" },
    service: { icone: "\u{1F527}", label: "Service", monde: "explorer" }
  });
  const ICONES_A_VARIANTE = Object.freeze(["\u{1F37D}\uFE0F", "\u{1F6E1}\uFE0F"]);
  const FAUTES = Object.freeze([
    [/\bg\b/g, "j ai"],
    // « g faim »
    [/\bjai\b/g, "j ai"],
    [/\bja\b/g, "j ai"],
    [/\bchui\b|\bchuis\b|\bjsuis\b/g, "je suis"],
    [/\bjsp\b/g, "je sais pas"],
    [/\bstp\b|\bsvp\b/g, ""],
    [/\bpk\b/g, "pourquoi"],
    [/\bqqn\b|\bqqun\b/g, "quelqu un"],
    [/\bdun\b/g, "d un"],
    [/\bdune\b/g, "d une"],
    [/\bou\b(?=\s+(manger|dormir|trouver|aller|est|sont))/g, "ou"],
    [/\bdehor\b/g, "dehors"],
    [/\bapart\b|\bappart\b/g, "appartement"],
    [/\btaf\b/g, "travail"],
    [/\bboulot\b/g, "travail"],
    [/\bbouffe\b|\bbouffer\b/g, "manger"],
    [/\bresto\b|\brestos\b/g, "restaurant"],
    [/\bmedcin\b|\bmedecein\b/g, "medecin"],
    [/\bpharmaci\b/g, "pharmacie"],
    [/\bvelos\b/g, "velo"],
    [/\bpapier\b/g, "papiers"],
    [/\benfant\b/g, "enfants"],
    [/\betude\b/g, "etudes"],
    [/\bdemarche\b/g, "demarches"]
  ]);
  function normaliser(texte) {
    let t = String(texte == null ? "" : texte).toLowerCase();
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/[’'`]/g, " ");
    t = t.replace(/[^a-z0-9]+/g, " ");
    t = " " + t.replace(/\s+/g, " ").trim() + " ";
    FAUTES.forEach(([motif, remplacement]) => {
      t = t.replace(motif, remplacement);
    });
    return t.replace(/\s+/g, " ").trim();
  }
  const contient = (t, expr) => (" " + t + " ").indexOf(" " + expr + " ") >= 0;
  const contientUn = (t, liste) => liste.some((e) => contient(t, e));
  const LEXIQUE = Object.freeze({
    manger: {
      defaut: "explorer",
      intentAide: "food_need",
      intentExplorer: "explore_place",
      mots: [
        "manger",
        "faim",
        "nourriture",
        "alimentaire",
        "repas",
        "restaurant",
        "fast food",
        "kebab",
        "tacos",
        "pizza",
        "burger",
        "sandwich",
        "brasserie",
        "dejeuner",
        "diner",
        "petit dejeuner",
        "gouter",
        "cantine",
        "epicerie",
        "courses",
        "colis alimentaire",
        "soupe populaire",
        "frigo vide",
        "aide alimentaire",
        "banque alimentaire",
        "distribution alimentaire"
      ],
      aideFort: [
        "faim",
        "aide alimentaire",
        "banque alimentaire",
        "colis alimentaire",
        "soupe populaire",
        "frigo vide",
        "distribution alimentaire"
      ],
      explorerFort: [
        "restaurant",
        "kebab",
        "tacos",
        "pizza",
        "burger",
        "sandwich",
        "brasserie",
        "fast food"
      ]
    },
    logement: {
      defaut: "explorer",
      intentAide: "housing_need",
      intentExplorer: "explore_place",
      mots: [
        "logement",
        "appartement",
        "maison",
        "hebergement",
        "dormir",
        "dors",
        "toit",
        "loger",
        "loyer",
        "foyer",
        "hotel",
        "auberge",
        "chambre",
        "domicile",
        "expulsion",
        "expulse",
        "heberge",
        "sdf",
        "sans abri",
        "a la rue",
        "dans la rue",
        "ou dormir"
      ],
      aideFort: [
        "sdf",
        "sans abri",
        "a la rue",
        "dans la rue",
        "expulsion",
        "expulse",
        "hebergement d urgence",
        "je dors dehors",
        "dormir dehors"
      ],
      explorerFort: ["hotel", "auberge"]
    },
    travail: {
      defaut: "aide",
      intentAide: "work_need",
      intentExplorer: "explore_place",
      mots: [
        "travail",
        "emploi",
        "job",
        "mission",
        "argent",
        "revenu",
        "salaire",
        "chomage",
        "embauche",
        "recrutement",
        "cv",
        "entretien",
        "rsa",
        "allocation",
        "dettes",
        "surendettement",
        "licencie",
        "interim"
      ],
      aideFort: ["chomage", "rsa", "surendettement", "dettes"],
      explorerFort: []
    },
    papiers: {
      defaut: "aide",
      intentAide: "admin_need",
      intentExplorer: "explore_place",
      mots: [
        "papiers",
        "demarches",
        "administratif",
        "prefecture",
        "caf",
        "titre de sejour",
        "carte vitale",
        "identite",
        "dossier",
        "formulaire",
        "permis",
        "declaration",
        "impots",
        "domiciliation",
        "france services",
        "passeport"
      ],
      aideFort: ["titre de sejour", "france services", "domiciliation", "prefecture"],
      explorerFort: []
    },
    sante: {
      defaut: "explorer",
      intentAide: "health_need",
      intentExplorer: "explore_place",
      mots: [
        "sante",
        "medecin",
        "docteur",
        "pharmacie",
        "hopital",
        "malade",
        "douleur",
        "consultation",
        "dentiste",
        "psychologue",
        "psy",
        "infirmier",
        "soins",
        "soigner",
        "me soigner",
        "urgences",
        "mutuelle",
        "generaliste",
        "kine",
        "ophtalmo",
        "gyneco",
        "vaccin",
        "securite sociale",
        "secu",
        "sans mutuelle",
        "pas de mutuelle",
        "sans securite sociale"
      ],
      aideFort: [
        "sans mutuelle",
        "pas de mutuelle",
        "sans securite sociale",
        "me soigner",
        "soigner"
      ],
      explorerFort: [
        "pharmacie",
        "dentiste",
        "hopital",
        "kine",
        "ophtalmo",
        "gyneco",
        "medecin",
        "docteur"
      ]
    },
    jeunes: {
      defaut: "aide",
      intentAide: "study_need",
      intentExplorer: "explore_place",
      mots: [
        "etudiant",
        "etudes",
        "ecole",
        "fac",
        "universite",
        "formation",
        "alternance",
        "orientation",
        "mission locale",
        "jeune",
        "stage",
        "apprentissage",
        "bourse",
        "crous",
        "lycee",
        "scolarite"
      ],
      aideFort: ["mission locale", "crous", "bourse", "alternance", "orientation"],
      explorerFort: []
    },
    parler: {
      defaut: "aide",
      intentAide: "social_support",
      intentExplorer: "explore_place",
      mots: [
        "parler",
        "discuter",
        "seul",
        "solitude",
        "ecoute",
        "ecouter",
        "soutien",
        "isole",
        "isolement",
        "deprime",
        "depression",
        "moral",
        "angoisse",
        "anxiete",
        "mal dans ma tete"
      ],
      aideFort: ["solitude", "isolement", "depression", "mal dans ma tete", "ecoute"],
      explorerFort: []
    },
    famille: {
      defaut: "aide",
      intentAide: "family_need",
      intentExplorer: "explore_place",
      mots: [
        "famille",
        "enfants",
        "bebe",
        "parent",
        "pere",
        "mere",
        "maman",
        "papa",
        "garde",
        "creche",
        "parentalite",
        "nounou",
        "grossesse",
        "enceinte",
        "separation",
        "divorce"
      ],
      aideFort: ["parentalite", "grossesse", "enceinte"],
      explorerFort: ["creche"]
    },
    securite: {
      defaut: "aide",
      intentAide: "safety_need",
      intentExplorer: "explore_place",
      mots: [
        "securite",
        "danger",
        "agression",
        "agresse",
        "harcelement",
        "harcele",
        "violence",
        "violences",
        "menace",
        "menacee",
        "menacent",
        "peur",
        "vol",
        "vole",
        "battue",
        "frappe"
      ],
      aideFort: ["agression", "harcelement", "violence", "violences", "menace", "peur"],
      explorerFort: []
    },
    mobilite: {
      defaut: "aide",
      intentAide: "mobility_problem",
      intentExplorer: "mobility_problem",
      /* Volontairement SANS « vélo », « voiture », « pneu » : ces mots-là
         nomment un objet, pas un besoin de déplacement. Une phrase qui les
         contient passe par la couche « panne » quand il y a un signe de
         panne, et ne doit rien conclure quand il n'y en a pas — « j'ai vendu
         mon vélo » n'est ni une aide, ni une réparation. */
      mots: [
        "bus",
        "metro",
        "tram",
        "train",
        "transport",
        "ticket",
        "abonnement",
        "permis de conduire",
        "me deplacer",
        "deplacement",
        "trajet",
        "titre de transport"
      ],
      aideFort: ["me deplacer", "permis de conduire", "titre de transport"],
      explorerFort: []
    },
    hygiene: {
      defaut: "aide",
      intentAide: "social_support",
      intentExplorer: "explore_place",
      mots: [
        "douche",
        "me laver",
        "hygiene",
        "toilettes",
        "laverie",
        "linge",
        "lessive",
        "sanitaire"
      ],
      aideFort: ["me laver", "douche"],
      explorerFort: ["laverie"]
    },
    vetements: {
      defaut: "aide",
      intentAide: "social_support",
      intentExplorer: "explore_place",
      mots: [
        "vetements",
        "habits",
        "vestiaire",
        "chaussures",
        "manteau",
        "friperie",
        "habiller"
      ],
      aideFort: ["vestiaire"],
      explorerFort: ["friperie"]
    }
  });
  const DETRESSE = Object.freeze([
    "je n ai rien",
    "je n ai plus rien",
    "j ai rien",
    "j ai plus rien",
    "je n ai pas",
    "j ai pas",
    "je n ai plus",
    "j ai plus",
    "plus rien",
    "rien a manger",
    "pas de quoi",
    "plus de quoi",
    "sans",
    "aucun",
    "aucune",
    "besoin d aide",
    "j ai besoin d aide",
    "aidez moi",
    "aide moi",
    "je peux plus",
    "je peux pas payer",
    "je n arrive plus",
    "je dors dehors",
    "je vais dormir dehors",
    "a la rue",
    "dans la rue",
    "gratuit",
    "gratuite",
    "pas cher du tout",
    "sans argent",
    "pas d argent",
    "en galere",
    "galere",
    "je suis perdu",
    "je sais pas ou aller",
    "urgence",
    "urgent",
    "ce soir",
    "cette nuit"
  ]);
  const RECHERCHE = Object.freeze([
    "je cherche",
    "je recherche",
    "cherche",
    "recherche",
    "ou trouver",
    "ou est",
    "ou sont",
    "ou puis je",
    "ou manger",
    "ou boire",
    "ou dormir",
    "ou aller",
    "ou faire",
    "je veux",
    "j ai envie",
    "je voudrais",
    "il me faut",
    "je souhaite",
    "un bon",
    "une bonne",
    "meilleur",
    "meilleure",
    "pas cher",
    "sympa",
    "pres de",
    "a cote",
    "autour de moi",
    "ouvert",
    "ouverte",
    "horaires",
    "reserver",
    "reservation",
    "adresse",
    "recommande"
  ]);
  const URGENCE = Object.freeze([
    "quelqu un me suit",
    "quelqu un me poursuit",
    "on me suit",
    "on me poursuit",
    "je suis en danger",
    "au secours",
    "aidez moi vite",
    "je vais mourir",
    "je veux mourir",
    "suicide",
    "me suicider",
    "en train de me frapper",
    "il me frappe",
    "elle me frappe",
    "on me frappe",
    "je suis agresse",
    "je suis agressee",
    "violences conjugales",
    "je me fais agresser",
    "j ai ete agresse",
    "j ai ete agressee",
    "je suis blesse",
    "je saigne",
    "je suis menace",
    "je suis menacee",
    "j ai tres peur",
    "j ai peur pour ma vie"
  ]);
  const OBJETS_REPARABLES = Object.freeze([
    {
      id: "velo",
      mots: ["velo", "bicyclette", "vtt", "trottinette"],
      requete: "r\xE9parateur de v\xE9los",
      libelle: "une r\xE9paration de v\xE9lo"
    },
    {
      id: "telephone",
      mots: ["telephone", "portable", "smartphone", "iphone", "ecran"],
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
      mots: ["voiture", "auto", "moteur", "pneu", "batterie"],
      requete: "garage automobile",
      libelle: "un garage"
    },
    {
      id: "serrure",
      mots: ["serrure", "cle", "cles", "verrou"],
      requete: "serrurier",
      libelle: "un serrurier"
    },
    {
      id: "plomberie",
      mots: ["robinet", "fuite d eau", "plomberie", "chasse d eau", "chauffe eau"],
      requete: "plombier",
      libelle: "un plombier"
    },
    {
      id: "electricite",
      mots: ["prise electrique", "electricite", "disjoncteur", "compteur"],
      requete: "\xE9lectricien",
      libelle: "un \xE9lectricien"
    },
    {
      id: "chaussures",
      mots: ["chaussure", "chaussures", "basket", "baskets", "semelle"],
      requete: "cordonnier",
      libelle: "un cordonnier"
    },
    {
      id: "lunettes",
      mots: ["lunettes", "monture", "verre"],
      requete: "opticien",
      libelle: "un opticien"
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
        "television"
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
    "crevaison",
    "abime",
    "abimee",
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
    "coince",
    "coincee",
    "hs",
    "foutu",
    "pete",
    "raye",
    "troue",
    "trouee"
  ]);
  const SERVICES = Object.freeze([
    {
      id: "coiffeur",
      mots: ["coiffeur", "coiffeuse", "couper les cheveux", "barbier"],
      requete: "coiffeur"
    },
    {
      id: "pressing",
      mots: ["pressing", "nettoyage a sec", "laverie automatique"],
      requete: "pressing"
    },
    { id: "veterinaire", mots: ["veterinaire", "veto"], requete: "v\xE9t\xE9rinaire" },
    {
      id: "banque",
      mots: ["banque", "distributeur", "retirer de l argent"],
      requete: "banque"
    },
    {
      id: "poste",
      mots: ["poste", "bureau de poste", "colis", "timbre"],
      requete: "bureau de poste"
    }
  ]);
  const INTENTS = Object.freeze([
    "explore_place",
    "food_need",
    "housing_need",
    "work_need",
    "admin_need",
    "health_need",
    "study_need",
    "social_support",
    "family_need",
    "safety_need",
    "urgent_emergency",
    "mobility_problem",
    "local_service",
    "unknown"
  ]);
  const SEUIL_CONFIANCE = 0.55;
  function trouverFamille(t, familles) {
    for (const f of familles) {
      const mots = f.mots.slice().sort((a, b) => b.length - a.length);
      for (const m of mots) if (contient(t, m)) return { famille: f, mot: m };
    }
    return null;
  }
  function router(phrase) {
    const t = normaliser(phrase);
    if (!t) {
      return resultat("unknown", null, 0, "Phrase vide.", false, []);
    }
    if (contientUn(t, URGENCE)) {
      return resultat(
        "urgent_emergency",
        "urgence",
        0.99,
        "Formulation de mise en danger imm\xE9diate reconnue mot pour mot.",
        true,
        []
      );
    }
    const objet = trouverFamille(t, OBJETS_REPARABLES);
    const panne = !!objet && contientUn(t, SIGNES_PANNE);
    const detresseForte = DETRESSE.filter((d) => contient(t, d) && d.length > 8).length > 0;
    if (panne && !detresseForte) {
      return resultat(
        "mobility_problem",
        "mobilite",
        0.9,
        "Objet r\xE9parable nomm\xE9 (" + objet.famille.id + ") avec un signe de panne.",
        false,
        [],
        { requete: objet.famille.requete, libelle: objet.famille.libelle }
      );
    }
    const service = trouverFamille(t, SERVICES);
    if (service && (contientUn(t, RECHERCHE) || t.trim() === service.mot)) {
      return resultat(
        "local_service",
        "service",
        0.88,
        "M\xE9tier ou commerce nomm\xE9 avec une intention de recherche.",
        false,
        [],
        { requete: service.famille.requete }
      );
    }
    const marqueursDetresse = DETRESSE.filter((d) => contient(t, d));
    const marqueursRecherche = RECHERCHE.filter((r) => contient(t, r));
    const scores = [];
    for (const [cat, def2] of Object.entries(LEXIQUE)) {
      const touches = def2.mots.filter((m) => contient(t, m));
      if (!touches.length) continue;
      const base = Math.max(...touches.map((m) => m.includes(" ") ? 0.55 : 0.4));
      const aideFort = def2.aideFort.some((m) => contient(t, m));
      const explorerFort = def2.explorerFort.some((m) => contient(t, m));
      const score = base + (aideFort ? 0.3 : 0) + (explorerFort ? 0.3 : 0) + 0.05 * (touches.length - 1);
      scores.push({ cat, def: def2, touches, base, score, aideFort, explorerFort });
    }
    if (!scores.length) {
      return resultat(
        "unknown",
        null,
        0.2,
        "Aucun terme du dictionnaire reconnu.",
        false,
        interpretations(t)
      );
    }
    scores.sort((a, b) => b.score - a.score);
    const gagnant = scores[0];
    const def = gagnant.def;
    const peutExplorer = def.defaut === "explorer" || def.explorerFort.length > 0;
    const poidsDetresse = (marqueursDetresse.length ? 0.45 : 0) + (gagnant.aideFort ? 0.35 : 0);
    const poidsRecherche = !peutExplorer ? 0 : def.defaut === "explorer" ? (marqueursRecherche.length ? 0.4 : 0) + (gagnant.explorerFort ? 0.35 : 0) : gagnant.explorerFort ? 0.35 + (marqueursRecherche.length ? 0.4 : 0) : 0;
    const versAide = poidsDetresse > poidsRecherche || poidsDetresse === poidsRecherche && def.defaut === "aide";
    const intent = versAide ? def.intentAide : def.intentExplorer;
    let confiance = Math.min(
      0.97,
      gagnant.base + Math.max(poidsDetresse, poidsRecherche, 0.2)
    );
    const talonne = scores.length > 1 && gagnant.score - scores[1].score < 0.1;
    if (talonne) confiance = Math.min(confiance, SEUIL_CONFIANCE - 0.05);
    const pourquoi = versAide ? "Termes de \xAB " + gagnant.cat + " \xBB avec une formulation de manque ou de besoin." : "Termes de \xAB " + gagnant.cat + " \xBB avec une formulation de recherche de lieu.";
    if (confiance < SEUIL_CONFIANCE) {
      const candidats = talonne ? [gagnant.cat, scores[1].cat] : [gagnant.cat];
      return resultat(
        intent,
        gagnant.cat,
        confiance,
        talonne ? "Deux cat\xE9gories au coude \xE0 coude : \xAB " + gagnant.cat + " \xBB et \xAB " + scores[1].cat + " \xBB." : pourquoi + " Signal trop faible pour trancher.",
        false,
        interpretations(t, candidats)
      );
    }
    const urgent = versAide && (gagnant.cat === "securite" || gagnant.cat === "logement" && contientUn(t, [
      "ce soir",
      "cette nuit",
      "je dors dehors",
      "a la rue",
      "dans la rue"
    ]));
    return resultat(intent, gagnant.cat, confiance, pourquoi, urgent, []);
  }
  function interpretations(t, probables) {
    const choix = [];
    const cats = Array.isArray(probables) ? probables : probables ? [probables] : [];
    for (const id of cats) {
      if (CATEGORIES[id] && !choix.some((c) => c.id === id)) {
        choix.push({ id, icone: CATEGORIES[id].icone, label: CATEGORIES[id].label });
      }
    }
    choix.push({ id: "lieu", icone: CATEGORIES.lieu.icone, label: "Un lieu pr\xE8s de moi" });
    choix.push({ id: "aide", icone: CATEGORIES.aide.icone, label: "Une aide" });
    return choix.slice(0, 3);
  }
  function resultat(intent, category, confidence, reason, is_urgent, suggestions, extra) {
    return Object.assign({
      intent,
      category,
      confidence: Math.round(confidence * 100) / 100,
      /* `reason` ne s'affiche JAMAIS : elle sert au diagnostic quand une
         phrase est mal comprise. La montrer serait exhiber la mécanique. */
      reason,
      is_urgent: !!is_urgent,
      suggestions: suggestions || []
    }, extra || {});
  }
  function mondeDe(resultatRouteur) {
    const r = resultatRouteur || {};
    if (r.intent === "urgent_emergency") return "urgence";
    if (r.intent === "unknown") return "question";
    if (r.confidence < SEUIL_CONFIANCE) return "question";
    if (r.intent === "explore_place" || r.intent === "local_service" || r.intent === "mobility_problem") return "explorer";
    return "aide";
  }
  root.AutourIntentions = Object.freeze({
    CATEGORIES,
    ICONES_A_VARIANTE,
    INTENTS,
    LEXIQUE,
    SEUIL_CONFIANCE,
    DETRESSE,
    RECHERCHE,
    URGENCE,
    OBJETS_REPARABLES,
    SERVICES,
    SIGNES_PANNE,
    normaliser,
    router,
    mondeDe,
    icone: (id) => (CATEGORIES[id] || {}).icone || "",
    label: (id) => (CATEGORIES[id] || {}).label || ""
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
