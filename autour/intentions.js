(function (root) {
  "use strict";

  /* ===================================================================
     Comprendre ce que les gens écrivent, pas ce qu'Autour sait nommer

     Deux problèmes distincts vivent ici, et ils ont la même cause : Autour
     parlait sa propre langue.

     1. LES SYMBOLES. Une même fonction portait deux icônes selon l'écran, et
        certaines demandaient une interprétation. `securite` était écrit avec
        U+1F6E1 SANS le sélecteur de variante U+FE0F : sur plusieurs
        plateformes ce point de code ne rend pas un bouclier mais un glyphe
        texte, ou un carré, ou autre chose. Un symbole de protection qu'on ne
        reconnaît pas est pire qu'une absence de symbole.

     2. LES MOTS. Il fallait écrire « logement » pour trouver un logement.
        Personne n'écrit ça. On écrit « besoin dun appart », « je dors
        dehor », « g faim ».

     LA RÈGLE QUI COMMANDE TOUT : le CONTEXTE prime sur le mot-clé.

       « où manger ? »            → un restaurant   (Explorer)
       « je n'ai rien à manger »  → une aide        (Aide)

     Le mot « manger » est dans les deux. Un moteur de mots-clés se trompe
     forcément une fois sur deux — et l'erreur qui coûte cher est toujours la
     même : envoyer quelqu'un qui a faim vers une carte de restaurants.

     On lit donc la phrase entière : une couche déterministe pour ce qui est
     évident ou critique, puis un score pour le reste. Et quand le score est
     bas, on ne fait pas semblant : on propose deux ou trois lectures.

     Rien de tout cela ne se voit à l'écran. Aucun « intention détectée »,
     aucun pourcentage. La compréhension doit être invisible.
     =================================================================== */

  /* ===================================================================
     1. LES CATÉGORIES ET LEURS ICÔNES — SOURCE DE VÉRITÉ UNIQUE

     Toute icône affichée pour une de ces fonctions DOIT venir d'ici. Deux
     tables d'emojis finissent toujours par diverger, et l'utilisateur voit
     alors deux symboles pour une même chose sans comprendre pourquoi.

     Trois règles pour le choix :

       · l'icône doit être devinable AVANT de lire le texte. On ne choisit
         jamais un symbole parce qu'il est joli ;
       · jamais de sélecteur de variante manquant. Les emojis dessinés à
         l'origine comme des pictogrammes (bouclier, alerte, maison…) exigent
         U+FE0F pour être rendus en couleur. Sans lui, le rendu dépend de la
         plateforme, et c'est exactement ce qui rendait `securite` illisible ;
       · l'icône ne porte JAMAIS l'information seule. Elle accompagne un mot,
         et la couleur n'ajoute rien qui ne soit déjà écrit.
     =================================================================== */
  const CATEGORIES = Object.freeze({
    /* ---- Les besoins d'aide ---- */
    manger:    { icone: "🍽️", label: "Manger",             monde: "aide" },
    logement:  { icone: "🏠",  label: "Logement",           monde: "aide" },
    travail:   { icone: "💼",  label: "Travail / argent",   monde: "aide" },
    papiers:   { icone: "📄",  label: "Papiers / démarches", monde: "aide" },
    sante:     { icone: "🩺",  label: "Santé",              monde: "aide" },
    jeunes:    { icone: "🎓",  label: "Jeunes / études",    monde: "aide" },
    parler:    { icone: "💬",  label: "Parler à quelqu’un", monde: "aide" },
    famille:   { icone: "👨‍👩‍👧", label: "Famille",       monde: "aide" },
    securite:  { icone: "🛡️", label: "Sécurité",           monde: "aide" },
    urgence:   { icone: "🚨",  label: "Urgence",            monde: "aide" },
    mobilite:  { icone: "🚌",  label: "Se déplacer",        monde: "aide" },
    hygiene:   { icone: "🚿",  label: "Hygiène",            monde: "aide" },
    vetements: { icone: "👕",  label: "Vêtements",          monde: "aide" },
    aide:      { icone: "🤝",  label: "Aide",               monde: "aide" },

    /* ---- Explorer ---- */
    sortir:    { icone: "🎉",  label: "Sortir",             monde: "explorer" },
    sport:     { icone: "⚽",  label: "Sport",              monde: "explorer" },
    chiller:   { icone: "☕",  label: "Chiller",            monde: "explorer" },
    bouger:    { icone: "🚲",  label: "Bouger",             monde: "explorer" },
    lieu:      { icone: "📍",  label: "Lieu",               monde: "explorer" },
    recherche: { icone: "🔍",  label: "Rechercher",         monde: "explorer" },
    service:   { icone: "🔧",  label: "Service",            monde: "explorer" },
  });

  /* Le sélecteur de variante, vérifié plutôt que supposé. Un test lit cette
     liste : si quelqu'un ajoute demain une icône pictographique sans U+FE0F,
     il le saura avant l'utilisateur. */
  const ICONES_A_VARIANTE = Object.freeze(["🍽️", "🛡️"]);

  /* ===================================================================
     2. NORMALISATION SILENCIEUSE

     On corrige la casse, les accents, les apostrophes, les espaces, les
     pluriels simples et les fautes fréquentes — mais UNIQUEMENT pour
     comprendre. Le texte affiché reste celui que la personne a écrit : lui
     renvoyer une version corrigée revient à lui dire qu'elle a mal écrit.
     =================================================================== */
  const FAUTES = Object.freeze([
    [/\bg\b/g, "j ai"],                 // « g faim »
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
    [/\bdemarche\b/g, "demarches"],
  ]);

  function normaliser(texte) {
    let t = String(texte == null ? "" : texte).toLowerCase();
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");   // accents
    t = t.replace(/[’'`]/g, " ");                              // apostrophes
    t = t.replace(/[^a-z0-9]+/g, " ");                         // ponctuation
    t = " " + t.replace(/\s+/g, " ").trim() + " ";
    FAUTES.forEach(([motif, remplacement]) => { t = t.replace(motif, remplacement); });
    return t.replace(/\s+/g, " ").trim();
  }

  const contient = (t, expr) => (" " + t + " ").indexOf(" " + expr + " ") >= 0;
  const contientUn = (t, liste) => liste.some((e) => contient(t, e));

  /* ===================================================================
     3. LE DICTIONNAIRE

     `mots` : ce dont on parle. `detresse` et `recherche` : dans quel monde.
     Un mot de `mots` seul ne décide de rien pour les catégories qui existent
     des deux côtés — c'est le rôle des marqueurs ci-dessous.
     =================================================================== */
  /* `defaut` : le monde d'une catégorie quand la phrase ne dit rien d'autre.
     Chercher « du travail » ou « des papiers » n'est JAMAIS chercher un lieu à
     découvrir — ces catégories n'existent que du côté d'Aide. Faire d'Explorer
     le défaut universel envoyait « je cherche du travail » vers une carte.

     `aideFort` / `explorerFort` : les mots qui tranchent à eux seuls. « faim »
     n'a pas besoin de contexte, « kebab » non plus. Les autres mots attendent
     un marqueur de monde. */
  const LEXIQUE = Object.freeze({
    manger: {
      defaut: "explorer", intentAide: "food_need", intentExplorer: "explore_place",
      mots: ["manger", "faim", "nourriture", "alimentaire", "repas", "restaurant",
             "fast food", "kebab", "tacos", "pizza", "burger", "sandwich", "brasserie",
             "dejeuner", "diner", "petit dejeuner", "gouter", "cantine", "epicerie",
             "courses", "colis alimentaire", "soupe populaire", "frigo vide",
             "aide alimentaire", "banque alimentaire", "distribution alimentaire"],
      aideFort: ["faim", "aide alimentaire", "banque alimentaire", "colis alimentaire",
                 "soupe populaire", "frigo vide", "distribution alimentaire"],
      explorerFort: ["restaurant", "kebab", "tacos", "pizza", "burger", "sandwich",
                     "brasserie", "fast food"],
    },
    logement: {
      defaut: "explorer", intentAide: "housing_need", intentExplorer: "explore_place",
      mots: ["logement", "appartement", "maison", "hebergement", "dormir", "dors",
             "toit", "loger", "loyer", "foyer", "hotel", "auberge", "chambre",
             "domicile", "expulsion", "expulse", "heberge", "sdf", "sans abri",
             "a la rue", "dans la rue", "ou dormir"],
      aideFort: ["sdf", "sans abri", "a la rue", "dans la rue", "expulsion", "expulse",
                 "hebergement d urgence", "je dors dehors", "dormir dehors"],
      explorerFort: ["hotel", "auberge"],
    },
    travail: {
      defaut: "aide", intentAide: "work_need", intentExplorer: "explore_place",
      mots: ["travail", "emploi", "job", "mission", "argent", "revenu", "salaire",
             "chomage", "embauche", "recrutement", "cv", "entretien", "rsa",
             "allocation", "dettes", "surendettement", "licencie", "interim"],
      aideFort: ["chomage", "rsa", "surendettement", "dettes"],
      explorerFort: [],
    },
    papiers: {
      defaut: "aide", intentAide: "admin_need", intentExplorer: "explore_place",
      mots: ["papiers", "demarches", "administratif", "prefecture", "caf",
             "titre de sejour", "carte vitale", "identite", "dossier", "formulaire",
             "permis", "declaration", "impots", "domiciliation",
             "france services", "passeport"],
      aideFort: ["titre de sejour", "france services", "domiciliation", "prefecture"],
      explorerFort: [],
    },
    sante: {
      defaut: "explorer", intentAide: "health_need", intentExplorer: "explore_place",
      mots: ["sante", "medecin", "docteur", "pharmacie", "hopital", "malade",
             "douleur", "consultation", "dentiste", "psychologue", "psy",
             "infirmier", "soins", "soigner", "me soigner", "urgences", "mutuelle",
             "generaliste", "kine", "ophtalmo", "gyneco", "vaccin",
             "securite sociale", "secu", "sans mutuelle", "pas de mutuelle",
             "sans securite sociale"],
      aideFort: ["sans mutuelle", "pas de mutuelle", "sans securite sociale",
                 "me soigner", "soigner"],
      explorerFort: ["pharmacie", "dentiste", "hopital", "kine", "ophtalmo",
                     "gyneco", "medecin", "docteur"],
    },
    jeunes: {
      defaut: "aide", intentAide: "study_need", intentExplorer: "explore_place",
      mots: ["etudiant", "etudes", "ecole", "fac", "universite", "formation",
             "alternance", "orientation", "mission locale", "jeune", "stage",
             "apprentissage", "bourse", "crous", "lycee", "scolarite"],
      aideFort: ["mission locale", "crous", "bourse", "alternance", "orientation"],
      explorerFort: [],
    },
    parler: {
      defaut: "aide", intentAide: "social_support", intentExplorer: "explore_place",
      mots: ["parler", "discuter", "seul", "solitude", "ecoute", "ecouter",
             "soutien", "isole", "isolement", "deprime", "depression", "moral",
             "angoisse", "anxiete", "mal dans ma tete"],
      aideFort: ["solitude", "isolement", "depression", "mal dans ma tete", "ecoute"],
      explorerFort: [],
    },
    famille: {
      defaut: "aide", intentAide: "family_need", intentExplorer: "explore_place",
      mots: ["famille", "enfants", "bebe", "parent", "pere", "mere", "maman",
             "papa", "garde", "creche", "parentalite", "nounou", "grossesse",
             "enceinte", "separation", "divorce"],
      aideFort: ["parentalite", "grossesse", "enceinte"],
      explorerFort: ["creche"],
    },
    securite: {
      defaut: "aide", intentAide: "safety_need", intentExplorer: "explore_place",
      mots: ["securite", "danger", "agression", "agresse", "harcelement",
             "harcele", "violence", "violences", "menace", "menacee", "menacent",
             "peur", "vol", "vole", "battue", "frappe"],
      aideFort: ["agression", "harcelement", "violence", "violences", "menace", "peur"],
      explorerFort: [],
    },
    mobilite: {
      defaut: "aide", intentAide: "mobility_problem", intentExplorer: "mobility_problem",
      /* Volontairement SANS « vélo », « voiture », « pneu » : ces mots-là
         nomment un objet, pas un besoin de déplacement. Une phrase qui les
         contient passe par la couche « panne » quand il y a un signe de
         panne, et ne doit rien conclure quand il n'y en a pas — « j'ai vendu
         mon vélo » n'est ni une aide, ni une réparation. */
      mots: ["bus", "metro", "tram", "train", "transport", "ticket",
             "abonnement", "permis de conduire", "me deplacer", "deplacement",
             "trajet", "titre de transport"],
      aideFort: ["me deplacer", "permis de conduire", "titre de transport"],
      explorerFort: [],
    },
    hygiene: {
      defaut: "aide", intentAide: "social_support", intentExplorer: "explore_place",
      mots: ["douche", "me laver", "hygiene", "toilettes", "laverie", "linge",
             "lessive", "sanitaire"],
      aideFort: ["me laver", "douche"],
      explorerFort: ["laverie"],
    },
    vetements: {
      defaut: "aide", intentAide: "social_support", intentExplorer: "explore_place",
      mots: ["vetements", "habits", "vestiaire", "chaussures", "manteau",
             "friperie", "habiller"],
      aideFort: ["vestiaire"],
      explorerFort: ["friperie"],
    },
  });

  /* ---- Les marqueurs de monde -------------------------------------------
     Ce sont eux qui tranchent, pas les mots de catégorie. */

  /* La détresse : on n'a pas, on n'a plus, on ne peut pas. */
  const DETRESSE = Object.freeze([
    "je n ai rien", "je n ai plus rien", "j ai rien", "j ai plus rien",
    "je n ai pas", "j ai pas", "je n ai plus", "j ai plus",
    "plus rien", "rien a manger", "pas de quoi", "plus de quoi",
    "sans", "aucun", "aucune",
    "besoin d aide", "j ai besoin d aide", "aidez moi", "aide moi",
    "je peux plus", "je peux pas payer", "je n arrive plus",
    "je dors dehors", "je vais dormir dehors", "a la rue", "dans la rue",
    "gratuit", "gratuite", "pas cher du tout", "sans argent", "pas d argent",
    "en galere", "galere", "je suis perdu", "je sais pas ou aller",
    "urgence", "urgent", "ce soir", "cette nuit",
  ]);

  /* La recherche d'un lieu : on cherche, on veut, on a envie. */
  const RECHERCHE = Object.freeze([
    "je cherche", "je recherche", "cherche", "recherche", "ou trouver", "ou est", "ou sont", "ou puis je",
    "ou manger", "ou boire", "ou dormir", "ou aller", "ou faire",
    "je veux", "j ai envie", "je voudrais", "il me faut", "je souhaite",
    "un bon", "une bonne", "meilleur", "meilleure", "pas cher", "sympa",
    "pres de", "a cote", "autour de moi", "ouvert", "ouverte", "horaires",
    "reserver", "reservation", "adresse", "recommande",
  ]);

  /* L'urgence vitale ou la mise en danger immédiate. Déterministe, et elle
     passe avant tout le reste : une erreur ici ne se rattrape pas. */
  const URGENCE = Object.freeze([
    "quelqu un me suit", "quelqu un me poursuit", "on me suit", "on me poursuit",
    "je suis en danger", "au secours", "aidez moi vite", "je vais mourir",
    "je veux mourir", "suicide", "me suicider", "en train de me frapper",
    "il me frappe", "elle me frappe", "on me frappe", "je suis agresse",
    "je suis agressee", "violences conjugales", "je me fais agresser",
    "j ai ete agresse", "j ai ete agressee", "je suis blesse", "je saigne",
    "je suis menace", "je suis menacee", "j ai tres peur", "j ai peur pour ma vie",
  ]);

  /* Une panne ou une réparation : ce n'est ni de l'aide sociale, ni un lieu à
     découvrir — c'est un artisan à trouver. */
  const OBJETS_REPARABLES = Object.freeze([
    { id: "velo", mots: ["velo", "bicyclette", "vtt", "trottinette"],
      requete: "réparateur de vélos", libelle: "une réparation de vélo" },
    { id: "telephone", mots: ["telephone", "portable", "smartphone", "iphone", "ecran"],
      requete: "réparation téléphone", libelle: "une réparation de téléphone" },
    { id: "informatique", mots: ["ordinateur", "ordi", "pc", "laptop", "tablette", "imprimante"],
      requete: "réparation informatique", libelle: "une réparation informatique" },
    { id: "voiture", mots: ["voiture", "auto", "moteur", "pneu", "batterie"],
      requete: "garage automobile", libelle: "un garage" },
    { id: "serrure", mots: ["serrure", "cle", "cles", "verrou"],
      requete: "serrurier", libelle: "un serrurier" },
    { id: "plomberie", mots: ["robinet", "fuite d eau", "plomberie", "chasse d eau", "chauffe eau"],
      requete: "plombier", libelle: "un plombier" },
    { id: "electricite", mots: ["prise electrique", "electricite", "disjoncteur", "compteur"],
      requete: "électricien", libelle: "un électricien" },
    { id: "chaussures", mots: ["chaussure", "chaussures", "basket", "baskets", "semelle"],
      requete: "cordonnier", libelle: "un cordonnier" },
    { id: "lunettes", mots: ["lunettes", "monture", "verre"],
      requete: "opticien", libelle: "un opticien" },
    { id: "electromenager", mots: ["machine a laver", "lave linge", "lave vaisselle",
                                   "frigo", "refrigerateur", "four", "aspirateur", "television"],
      requete: "réparation électroménager", libelle: "une réparation d’électroménager" },
  ]);

  const SIGNES_PANNE = Object.freeze([
    "casse", "cassee", "cassees", "casses", "en panne", "panne",
    "creve", "crevee", "creves", "crevees", "crevaison",
    "abime", "abimee", "ne marche plus", "ne fonctionne plus", "marche plus",
    "fonctionne plus", "ne demarre plus", "demarre plus",
    "repare", "reparer", "reparation", "reparations", "reparateur",
    "depanner", "depannage", "fuit", "fuite", "bloque", "bloquee",
    "coince", "coincee", "hs", "foutu", "pete", "raye", "troue", "trouee",
  ]);

  /* Un service ou un commerce cherché explicitement : Explorer, pas Aide. */
  const SERVICES = Object.freeze([
    { id: "coiffeur", mots: ["coiffeur", "coiffeuse", "couper les cheveux", "barbier"],
      requete: "coiffeur" },
    { id: "pressing", mots: ["pressing", "nettoyage a sec", "laverie automatique"],
      requete: "pressing" },
    { id: "veterinaire", mots: ["veterinaire", "veto"], requete: "vétérinaire" },
    { id: "banque", mots: ["banque", "distributeur", "retirer de l argent"],
      requete: "banque" },
    { id: "poste", mots: ["poste", "bureau de poste", "colis", "timbre"],
      requete: "bureau de poste" },
  ]);

  /* ===================================================================
     4. LE ROUTEUR

     Ordre des couches, et il est le cœur de la correction :

       0. urgence vitale      — déterministe, rien ne passe avant
       1. panne d'objet       — objet nommé ET signe de panne
       2. service cherché     — un métier nommé, avec intention de recherche
       3. détresse explicite  — « je dors dehors », « je n'ai rien à manger »
       4. score par catégorie — le reste, pondéré par les marqueurs de monde
       5. rien de sûr         — on propose, on n'invente pas
     =================================================================== */
  const INTENTS = Object.freeze([
    "explore_place", "food_need", "housing_need", "work_need", "admin_need",
    "health_need", "study_need", "social_support", "family_need", "safety_need",
    "urgent_emergency", "mobility_problem", "local_service", "unknown",
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

    /* --- 0. Urgence : déterministe, jamais un score ---------------------- */
    if (contientUn(t, URGENCE)) {
      return resultat("urgent_emergency", "urgence", 0.99,
        "Formulation de mise en danger immédiate reconnue mot pour mot.", true, []);
    }

    /* --- 1. Panne : un objet nommé ET un signe de panne ------------------
       Les deux sont exigés. « je suis cassé » parle d'une personne, pas d'une
       chose, et doit rester dans Aide. */
    const objet = trouverFamille(t, OBJETS_REPARABLES);
    const panne = !!objet && contientUn(t, SIGNES_PANNE);
    /* Une détresse EXPLICITE l'emporte quand même : « je n'ai plus rien à
       manger et mon vélo est cassé » parle d'abord de quelqu'un qui a faim. */
    const detresseForte = DETRESSE.filter((d) => contient(t, d) && d.length > 8).length > 0;

    if (panne && !detresseForte) {
      return resultat("mobility_problem", "mobilite", 0.9,
        "Objet réparable nommé (" + objet.famille.id + ") avec un signe de panne.",
        false, [], { requete: objet.famille.requete, libelle: objet.famille.libelle });
    }

    /* --- 2. Service explicitement cherché -------------------------------- */
    const service = trouverFamille(t, SERVICES);
    if (service && (contientUn(t, RECHERCHE) || t.trim() === service.mot)) {
      return resultat("local_service", "service", 0.88,
        "Métier ou commerce nommé avec une intention de recherche.",
        false, [], { requete: service.famille.requete });
    }

    /* --- 3 et 4. Score par catégorie ------------------------------------- */
    const marqueursDetresse = DETRESSE.filter((d) => contient(t, d));
    const marqueursRecherche = RECHERCHE.filter((r) => contient(t, r));

    const scores = [];
    for (const [cat, def] of Object.entries(LEXIQUE)) {
      const touches = def.mots.filter((m) => contient(t, m));
      if (!touches.length) continue;
      // une expression pèse plus qu'un mot isolé : elle est moins ambiguë
      const base = Math.max(...touches.map((m) => (m.includes(" ") ? 0.55 : 0.4)));
      const aideFort = def.aideFort.some((m) => contient(t, m));
      const explorerFort = def.explorerFort.some((m) => contient(t, m));
      /* Le classement ne se joue pas sur `base` seul : « sans sécurité
         sociale pour me soigner » touche `securite` par un mot et `sante`
         par quatre, dont deux qui tranchent. Un mot qui décide vaut plus
         qu'un mot qui figure. */
      const score = base + (aideFort ? 0.3 : 0) + (explorerFort ? 0.3 : 0) +
        0.05 * (touches.length - 1);
      scores.push({ cat, def, touches, base, score, aideFort, explorerFort });
    }

    if (!scores.length) {
      // aucun mot connu : on ne devine pas
      return resultat("unknown", null, 0.2,
        "Aucun terme du dictionnaire reconnu.", false, interpretations(t));
    }

    scores.sort((a, b) => b.score - a.score);
    const gagnant = scores[0];
    const def = gagnant.def;

    /* Toutes les catégories n'existent pas des deux côtés. Chercher « du
       travail », « des papiers » ou « quelqu'un à qui parler » n'est jamais
       chercher un lieu à découvrir : ces catégories n'ont pas de versant
       Explorer, et faire d'Explorer le défaut universel envoyait « je cherche
       du travail » vers une carte de commerces. Une catégorie ne peut donc
       basculer vers Explorer que si elle y existe. */
    const peutExplorer = def.defaut === "explorer" || def.explorerFort.length > 0;

    /* Le monde : la détresse gagne sur la recherche à égalité de signal, et
       c'est délibéré. Se tromper en envoyant quelqu'un vers de l'aide coûte
       une lecture ; se tromper dans l'autre sens envoie quelqu'un qui a faim
       vers une carte de restaurants. */
    const poidsDetresse = (marqueursDetresse.length ? 0.45 : 0) +
      (gagnant.aideFort ? 0.35 : 0);                    // « faim », « à la rue »
    /* Et « je cherche » ne suffit pas partout. Dans une catégorie qui vit
       d'abord du côté d'Aide, il faut un mot qui désigne vraiment un
       commerce : « où est-ce que je peux prendre une douche » cherche une
       douche publique, pas une laverie ; « je cherche une alternance » ne
       cherche pas un lieu. Un marqueur de recherche n'y pèse donc que
       s'il accompagne un mot d'Explorer. */
    const poidsRecherche = !peutExplorer ? 0
      : def.defaut === "explorer"
        ? (marqueursRecherche.length ? 0.4 : 0) + (gagnant.explorerFort ? 0.35 : 0)
        : gagnant.explorerFort ? 0.35 + (marqueursRecherche.length ? 0.4 : 0) : 0;

    /* À signal nul des deux côtés — « je cherche du travail », « jai perdu
       mes papiers » — c'est le monde par défaut de la catégorie qui tranche,
       pas le hasard d'un mot. */
    const versAide = poidsDetresse > poidsRecherche ||
      (poidsDetresse === poidsRecherche && def.defaut === "aide");
    const intent = versAide ? def.intentAide : def.intentExplorer;
    /* Le plancher de 0,2 : une catégorie reconnue sans marqueur de monde
       reste une catégorie reconnue. Sans lui, « besoin taf » tombait sous le
       seuil et Autour posait une question dont il avait déjà la réponse. */
    let confiance = Math.min(0.97,
      gagnant.base + Math.max(poidsDetresse, poidsRecherche, 0.2));

    /* Deux catégories au coude à coude, c'est une phrase qui parle de deux
       choses — « j'ai besoin de vêtements et de manger ». Trancher au
       centième d'écart reviendrait à tirer au sort en ayant l'air sûr de soi.
       On abaisse la confiance sous le seuil, ce qui déclenche les
       propositions : la personne choisit en un geste, et on ne lui a pas
       imposé une lecture qu'on n'avait pas. */
    const talonne = scores.length > 1 && (gagnant.score - scores[1].score) < 0.1;
    if (talonne) confiance = Math.min(confiance, SEUIL_CONFIANCE - 0.05);

    const pourquoi = versAide
      ? "Termes de « " + gagnant.cat + " » avec une formulation de manque ou de besoin."
      : "Termes de « " + gagnant.cat + " » avec une formulation de recherche de lieu.";

    if (confiance < SEUIL_CONFIANCE) {
      const candidats = talonne ? [gagnant.cat, scores[1].cat] : [gagnant.cat];
      return resultat(intent, gagnant.cat, confiance,
        (talonne
          ? "Deux catégories au coude à coude : « " + gagnant.cat + " » et « " +
            scores[1].cat + " »."
          : pourquoi + " Signal trop faible pour trancher."),
        false, interpretations(t, candidats));
    }

    const urgent = versAide &&
      (gagnant.cat === "securite" ||
       (gagnant.cat === "logement" && contientUn(t, ["ce soir", "cette nuit", "je dors dehors",
                                                      "a la rue", "dans la rue"])));

    return resultat(intent, gagnant.cat, confiance, pourquoi, urgent, []);
  }

  /* Quand on n'est pas sûr, on propose — deux ou trois lectures, jamais plus.
     Un menu de six choix est une façon polie de rendre le problème. */
  function interpretations(t, probables) {
    const choix = [];
    const cats = Array.isArray(probables) ? probables : (probables ? [probables] : []);
    for (const id of cats) {
      if (CATEGORIES[id] && !choix.some((c) => c.id === id)) {
        choix.push({ id, icone: CATEGORIES[id].icone, label: CATEGORIES[id].label });
      }
    }
    /* Les deux portes de sortie viennent toujours en dernier, et seulement
       s'il reste de la place : quand on a deux lectures précises à proposer,
       « une aide » en troisième n'ajoute rien qu'un choix de plus. */
    choix.push({ id: "lieu", icone: CATEGORIES.lieu.icone, label: "Un lieu près de moi" });
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
      suggestions: suggestions || [],
    }, extra || {});
  }

  /* Le monde vers lequel router : Aide, Explorer, ou une question. */
  function mondeDe(resultatRouteur) {
    const r = resultatRouteur || {};
    if (r.intent === "urgent_emergency") return "urgence";
    if (r.intent === "unknown") return "question";
    if (r.confidence < SEUIL_CONFIANCE) return "question";
    if (r.intent === "explore_place" || r.intent === "local_service" ||
        r.intent === "mobility_problem") return "explorer";
    return "aide";
  }

  root.AutourIntentions = Object.freeze({
    CATEGORIES, ICONES_A_VARIANTE, INTENTS, LEXIQUE, SEUIL_CONFIANCE,
    DETRESSE, RECHERCHE, URGENCE, OBJETS_REPARABLES, SERVICES, SIGNES_PANNE,
    normaliser, router, mondeDe,
    icone: (id) => (CATEGORIES[id] || {}).icone || "",
    label: (id) => (CATEGORIES[id] || {}).label || "",
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
