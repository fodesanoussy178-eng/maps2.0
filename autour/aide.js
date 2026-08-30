(function (root) {
  "use strict";

  /* ===================================================================
     Partir du problème, pas de l'administration

     L'écran Aide demandait « quel type de structure cherches-tu ? » sans le
     dire : ses six entrées étaient « Parler à une association », « Emploi et
     droits »… c'est-à-dire l'organigramme de l'action sociale. Or personne
     n'ouvre cet écran en sachant ce qu'est un CCAS, une PASS ou une épicerie
     solidaire. On le sait quand on n'en a plus besoin.

     Cette couche est donc une ontologie de BESOINS, distincte des catégories
     de lieux. Un besoin (« manger », « papiers ») mène à plusieurs types de
     structures ET à des opportunités temporaires — une distribution ce soir
     vaut mieux qu'un guichet ouvert demain.

     Trois règles :

       · une correspondance besoin → structure n'est jamais une certitude.
         Elle porte un poids, et l'interface dit pourquoi le lieu est proposé ;
       · une condition d'accès (âge, public) ne s'invente pas. Elle vient du
         RÉSEAU, pas de l'antenne, et c'est écrit comme tel ;
       · rien de ce qui est tapé ici n'est conservé. Le mode Aide parle de
         situations personnelles : on en tire un besoin normalisé
         (`alimentation`, `emploi`) et on jette la phrase.
     =================================================================== */

  /* ---- Les besoins, dans les mots de tout le monde ------------------------ */
  const BESOINS = Object.freeze([
    {
      id: "manger", emoji: "🍽️", label: "Manger",
      mots: ["manger", "faim", "plus assez pour manger", "rien a manger",
             "alimentaire", "nourriture", "repas", "frigo vide", "courses",
             "de quoi manger", "colis", "distribution", "soupe", "cantine",
             "nourrir mes enfants", "je n ai plus rien"],
      cats: ["alimentaire", "collecte", "food"],
      reseaux: [/rest(?:o|aurant)s? du c(?:oe|œ|o)ur/i, /banque alimentaire/i,
                /[ée]picerie\s*(?:solidaire|sociale)/i, /secours populaire/i,
                /secours catholique/i, /croix[-\s]rouge/i, /restaurant social/i,
                /soupe populaire/i],
      pourquoi: "Tu cherches de quoi manger.",
    },
    {
      id: "logement", emoji: "🏠", label: "Logement",
      mots: ["logement", "loyer", "dormir", "hebergement", "abri", "sans logement",
             "a la rue", "expulsion", "expulse", "je dors dehors", "un toit",
             "foyer", "heberge", "aide au loyer", "impaye", "cal", "je peux plus payer"],
      cats: ["hebergement", "asso", "mairie"],
      reseaux: [/\bccas\b/i, /samu\s*social/i, /\b115\b/i, /adil/i,
                /action logement/i, /\bcaf\b/i, /secours catholique/i],
      pourquoi: "Tu cherches un hébergement ou une aide au logement.",
    },
    {
      id: "travail", emoji: "💼", label: "Travail / argent",
      mots: ["travail", "emploi", "boulot", "job", "trouver du travail",
             "pas de travail", "chomage", "licencie", "formation", "me former",
             "apprentissage", "alternance", "stage", "cv", "recrutement",
             "entretien", "reconversion", "chercher un emploi", "sans emploi",
             // l'argent et le travail se cherchent ensemble : un même guichet
             // instruit souvent les deux
             "argent", "pas d argent", "dettes", "dette", "surendettement",
             "aide financiere", "fin de mois", "rsa", "allocation", "allocations",
             "sans ressources", "je n arrive plus a payer"],
      cats: ["emploi", "asso", "mairie"],
      reseaux: [/mission locale/i, /france travail|p[oô]le emploi/i, /cap emploi/i,
                /maison de l['’\s]?emploi/i, /\bepide\b/i, /garantie jeunes/i],
      pourquoi: "Tu cherches du travail ou une formation.",
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
      id: "mobilite", emoji: "🚌", label: "Se déplacer", horsGrille: true,
      mots: ["me deplacer", "deplacement", "transport", "transports", "bus",
             "metro", "tram", "train", "ticket", "abonnement", "titre de transport",
             "pas de voiture", "sans voiture", "je peux pas y aller",
             "permis", "code de la route", "auto ecole", "aide au permis",
             "velo solidaire", "mobilite", "trajet", "aller au travail",
             "pas les moyens de me deplacer"],
      cats: ["mairie", "asso", "emploi"],
      reseaux: [/\bccas\b/i, /mission locale/i, /plateforme (?:de )?mobilit[ée]/i,
                /auto[- ]?[ée]cole sociale/i, /garage solidaire|garage associatif/i,
                /\bwimoov\b/i],
      pourquoi: "Tu cherches une solution pour te déplacer.",
    },
    {
      id: "papiers", emoji: "📄", label: "Papiers / démarches",
      mots: ["papiers", "demarche", "demarches", "administratif", "administrative",
             "dossier", "formulaire", "je comprends rien", "aide administrative",
             "titre de sejour", "carte d identite", "passeport", "impots",
             "declaration", "caf", "courrier", "en ligne", "numerique", "domiciliation",
             "adresse", "ecrire une lettre"],
      cats: ["mairie", "asso", "emploi"],
      reseaux: [/(?:maison\s*)?france\s*services|maison\s*de services au public/i, /\bccas\b/i,
                /mairie/i, /prefecture/i, /mission locale/i, /point d['’\s]?acc[èe]s au droit/i],
      pourquoi: "Tu cherches de l’aide pour des démarches.",
    },
    {
      id: "sante", emoji: "🩺", label: "Santé",
      mots: ["sante", "malade", "medecin", "docteur", "soigner", "soins",
             "dentiste", "hopital", "clinique", "urgences", "generaliste",
             "mal", "douleur", "medicament", "pharmacie", "vaccination",
             "depistage", "sans mutuelle", "pas de mutuelle", "sans carte vitale",
             "pas de securite sociale", "sans securite sociale",
             "pas d argent pour me soigner", "sans argent pour me soigner",
             "sante sexuelle", "contraception", "planning familial", "ivg",
             "grossesse", "enceinte", "sage femme", "sage-femme"],
      cats: ["sante", "asso"],
      reseaux: [/permanence d['’\s]?acc[èe]s aux soins|\bpass\b\s*sant/i,
                /centre de sant[ée]/i, /h[oô]pital/i, /pharmacie/i,
                /m[ée]decins du monde/i, /croix[-\s]rouge/i],
      pourquoi: "Tu cherches à te soigner.",
    },
    {
      id: "jeunes", emoji: "🎓", label: "Jeunes / études",
      mots: ["jeune", "jeunes", "etudiant", "etudiante", "etudes", "lycee",
             "universite", "fac", "bourse", "crous", "scolarite", "orientation",
             "mission locale", "decrochage", "decrochage scolaire",
             "j ai 16 ans", "j ai 17 ans", "j ai 18 ans", "j ai 19 ans",
             "j ai 20 ans", "j ai 21 ans", "j ai 22 ans", "j ai 23 ans",
             "j ai 24 ans", "j ai 25 ans", "mineur"],
      cats: ["emploi", "asso", "biblio"],
      reseaux: [/mission locale/i, /\bcrous\b/i, /\bcrij\b|information jeunesse/i,
                /point information jeunesse/i, /\bbij\b/i],
      pourquoi: "Tu es jeune ou étudiant.",
    },
    /* Hygiène et vêtements ne sont plus des cases à l'écran — dix cases, pas
       douze — mais restent des besoins à part entière : reconnus dans une
       phrase libre, et atteignables par « Autre aide », dont les catégories
       les incluent. Les retirer du modèle aurait fait perdre des douches et
       des vestiaires à ceux qui les cherchent. */
    {
      id: "hygiene", emoji: "🚿", label: "Hygiène", horsGrille: true,
      mots: ["douche", "me laver", "laver", "hygiene", "toilettes", "wc",
             "laverie", "linge", "lessive", "propre", "sanitaire"],
      cats: ["toilettes", "asso", "hebergement"],
      reseaux: [/bains[-\s]douches/i, /accueil de jour/i, /croix[-\s]rouge/i],
      pourquoi: "Tu cherches un endroit pour te laver ou laver ton linge.",
    },
    {
      id: "vetements", emoji: "👕", label: "Vêtements", horsGrille: true,
      mots: ["vetement", "vetements", "habits", "s habiller", "vestiaire",
             "chaussures", "manteau", "friperie solidaire", "habiller mes enfants"],
      cats: ["collecte", "asso", "friperie"],
      reseaux: [/vestiaire/i, /secours populaire/i, /secours catholique/i,
                /croix[-\s]rouge/i, /emma(?:ü|u)s/i, /le relais/i],
      pourquoi: "Tu cherches des vêtements.",
    },
    {
      id: "parler", emoji: "💬", label: "Parler à quelqu’un",
      mots: ["parler", "parler a quelqu un", "ecoute", "seul", "solitude",
             "isole", "isolement", "mal dans ma tete", "deprime", "depression",
             "anxiete", "angoisse", "ca va pas", "moral", "psy", "psychologue",
             "psychiatre", "psychotherapeute", "sante mentale", "cmp",
             "soutien moral", "j en peux plus", "besoin de parler",
             "j ai besoin de parler a quelqu un"],
      cats: ["sante", "asso"],
      reseaux: [/\bcmp\b/i, /point [ée]coute/i, /maison des adolescents/i,
                /\bbapu\b/i, /sant[ée] psy [ée]tudiant/i, /mon soutien psy/i,
                /psychologue|psychoth[ée]rapeute|psychiatre/i,
                /planning familial/i, /sos amiti[ée]/i, /centre social/i],
      pourquoi: "Tu cherches quelqu’un à qui parler.",
    },
    {
      id: "famille", emoji: "👨‍👩‍👧", label: "Famille",
      mots: ["famille", "mes enfants", "garde", "creche", "nounou", "parent",
             "parents", "separation", "divorce", "pension", "scolarite",
             "cantine", "aide aux devoirs", "parentalite", "grossesse",
             "je suis enceinte", "bebe"],
      cats: ["asso", "mairie", "sante"],
      reseaux: [/\bcaf\b/i, /\bpmi\b|protection maternelle/i, /centre social/i,
                /maison de quartier/i, /\bccas\b/i, /planning familial/i],
      pourquoi: "Tu cherches de l’aide pour ta famille.",
    },
    {
      id: "securite", emoji: "🛡️", label: "Sécurité",
      mots: ["violence", "violences", "frappe", "menace", "menacee", "peur",
             "harcelement", "harcele", "danger", "agression", "agressee",
             "agresse",
             "je ne me sens pas en securite", "porter plainte", "protection",
             "victime"],
      cats: ["asso", "sante", "mairie", "hebergement"],
      reseaux: [/\b3919\b/i, /france victimes/i, /planning familial/i,
                /point d['’\s]?acces au droit/i, /commissariat|gendarmerie/i],
      pourquoi: "Tu cherches de la protection ou du soutien.",
    },
    {
      id: "autre", emoji: "➕", label: "Autre aide",
      mots: ["aide", "aider", "coup de main", "soutien", "accompagnement",
             "je sais pas ou aller", "je viens d arriver", "perdu", "orienter",
             "conseil", "dispositif", "dispositifs", "je ne connais pas",
             "quelqu un a qui parler"],
      // « Autre » couvre aussi ce qui n'a plus de case : douches, vestiaires
      cats: ["asso", "mairie", "alimentaire", "hebergement", "sante", "emploi",
             "toilettes", "collecte", "friperie"],
      reseaux: [/maison\s*france\s*services/i, /centre social/i, /maison de quartier/i,
                /\bccas\b/i],
      pourquoi: "Tu cherches de l’aide, sans savoir par où commencer.",
    },
  ]);

  const BESOIN_DE = (id) => BESOINS.find((b) => b.id === id) || null;
  /* Ce qui s'affiche en cases. Dix, pas plus : au-delà, la grille redevient
     un formulaire administratif. Les autres besoins restent reconnus. */
  const BESOINS_GRILLE = Object.freeze(BESOINS.filter((b) => !b.horsGrille));

  /* Sous-intentions de santé : elles ne sont jamais affichées comme de
     nouvelles catégories. Elles servent uniquement à éviter qu'une pharmacie
     réponde à « mal aux dents », ou qu'un cabinet privé soit présenté comme
     une aide gratuite. */
  const SOUS_INTENTIONS_SANTE = Object.freeze([
    { id: "medicaments",
      mots: ["pharmacie", "medicament", "medicaments", "ordonnance", "drugstore"],
      lieux: [/\bpharmacy\b|\bdrugstore\b|\bpharmacie\b|\bm[ée]dicament/i] },
    { id: "soins",
      mots: ["medecin", "docteur", "generaliste", "voir un medecin", "me soigner",
             "consultation", "kine", "kinesitherapeute", "physiotherapeute"],
      lieux: [/\bdoctor\b|\bdoctors\b|medical.center|medical.clinic|centre de sant/i,
              /g[ée]n[ée]raliste|m[ée]decin|docteur|physiotherapist|kin[ée]sith/i,
              /permanence d.acc[èe]s aux soins|\bpass\b.*sant|\bpass\b.*permanence/i] },
    { id: "hopital",
      mots: ["hopital", "urgences", "urgence medicale", "clinique"],
      lieux: [/general.hospital|\bhospital\b|h[oô]pital|\burgences?\b/i] },
    { id: "dentaire",
      mots: ["dent", "dents", "mal aux dents", "dentiste", "dentaire"],
      lieux: [/dental.clinic|\bdentist\b|dentiste|dentaire/i] },
    { id: "mentale",
      mots: ["psy", "psychologue", "psychiatre", "psychotherapeute", "cmp", "cmpp",
             "sante mentale", "crise d angoisse", "crises d angoisse", "angoisse",
             "anxiete", "depression", "deprime", "besoin de parler", "parler a quelqu un"],
      lieux: [/psych|psychiatr|psychotherap|counselling|\bcmp\b|\bcmpp\b|\bbapu\b/i,
              /point accueil [ée]coute|\bpaej\b|maison des adolescents|sant[ée] psy [ée]tudiant/i] },
    { id: "depistage",
      mots: ["depistage", "test", "analyse", "analyses", "laboratoire", "vaccination"],
      lieux: [/medical.lab|laboratoire|d[ée]pistage|\bcegidd\b|vaccination/i] },
    { id: "sexuelle",
      mots: ["sante sexuelle", "grossesse", "enceinte", "contraception", "ivg",
             "planning familial", "sage femme", "sage-femme", "maternite"],
      lieux: [/planning familial|sant[ée] sexuelle|contraception|\bivg\b|sage.femme|maternit|\bpmi\b/i] },
    { id: "acces",
      mots: ["gratuit", "gratuite", "sans argent", "pas d argent", "sans mutuelle",
             "pas de mutuelle", "sans securite sociale", "pas de securite sociale",
             "sans carte vitale", "pas de carte vitale", "sans couverture"],
      lieux: [/permanence d.acc[èe]s aux soins|\bpass\b.*sant|\bcmp\b|\bcmpp\b|\bbapu\b/i,
              /sant[ée] psy [ée]tudiant|service de sant[ée] [ée]tudiant/i] },
  ]);

  /* `asso` est une catégorie de collecte, pas une preuve qu'une structure
     répond à tous les besoins. On garde les associations dans le catalogue et
     les résultats larges, mais une sélection précise ne retient que les
     catégories réellement spécialisées ou un réseau/nom qui l'atteste. */
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
    autre: [],
  });

  /* ---- Urgence -----------------------------------------------------------
     Ce n'est pas un besoin de plus : c'est une gravité. Elle traverse les
     besoins et remonte ce qui accueille sans rendez-vous. */
  const URGENCE = /\burgence|\b115\b|\b3114\b|samu social|maraude|sans[- ]abri|ce soir|cette nuit|tout de suite|je dors dehors\b|id[ée]es? suicidaires?|suicide/i;

  /* ---- Conditions d'accès connues ----------------------------------------
     Elles viennent du RÉSEAU, jamais de l'antenne. C'est ce qui permet de
     dire « en général, ce réseau accueille les 16-25 ans » sans transformer
     une règle nationale en promesse locale. Aucune condition n'est inventée :
     un réseau absent de cette table n'a pas de condition affichée. */
  const CONDITIONS = Object.freeze([
    { motif: /mission locale/i, age: { min: 16, max: 25 },
      texte: "Pour les 16-25 ans sortis du système scolaire.", source: "reseau", confidence: .9 },
    { motif: /\bcrous\b/i, public: ["étudiants"],
      texte: "Réservé aux étudiants.", source: "reseau", confidence: .9 },
    { motif: /cap emploi/i, public: ["personnes en situation de handicap"],
      texte: "Pour les personnes en situation de handicap.", source: "reseau", confidence: .9 },
    { motif: /france travail|p[oô]le emploi/i,
      texte: "Inscription préalable nécessaire pour la plupart des démarches.",
      source: "reseau", confidence: .8 },
    { motif: /[ée]picerie\s*(?:solidaire|sociale)/i,
      texte: "Accès sur orientation d’un travailleur social, pour une durée limitée.",
      source: "reseau", confidence: .8 },
    { motif: /rest(?:o|aurant)s? du c(?:oe|œ|o)ur/i,
      texte: "Inscription au centre, avec pièce d’identité et justificatif de ressources.",
      source: "reseau", confidence: .85 },
    { motif: /banque alimentaire/i,
      texte: "Ne distribue en général pas directement aux particuliers.",
      source: "reseau", confidence: .85 },
    { motif: /\bccas\b/i,
      texte: "Il faut habiter la commune.", source: "reseau", confidence: .8 },
    { motif: /\b115\b|samu social/i,
      texte: "Appeler le 115 avant de se déplacer : gratuit, 24 h/24.",
      source: "reseau", confidence: .95 },
    { motif: /permanence d['’\s]?acc[èe]s aux soins|\bpass\b\s*sant/i,
      texte: "Pour les personnes malades en situation de précarité, notamment sans couverture ou sans possibilité de payer.",
      source: "reseau", confidence: .95 },
    { motif: /\bcmpp\b/i, public: ["enfants", "adolescents", "familles"],
      texte: "Pour les enfants, les adolescents et leurs familles ; vérifier le secteur et les modalités locales.",
      source: "reseau", confidence: .9 },
    { motif: /\bpaej\b|point accueil [ée]coute jeunes/i, age: { min: 12, max: 25 },
      texte: "Accueil et écoute pour les jeunes de 12 à 25 ans ; ce n’est pas un service de soins médicalisés.",
      source: "reseau", confidence: .9 },
    { motif: /\bbapu\b|bureau d['’\s]?aide psychologique universitaire/i,
      public: ["étudiants"], texte: "Réservé aux étudiants ; consultations prises en charge sans avance de frais.",
      source: "reseau", confidence: .95 },
    { motif: /sant[ée] psy [ée]tudiant/i, public: ["étudiants"],
      texte: "Réservé aux étudiants éligibles au dispositif Santé Psy Étudiant.",
      source: "reseau", confidence: .95 },
    { motif: /maison des adolescents/i, public: ["adolescents", "familles"],
      texte: "Pour les adolescents et leurs proches ; l’âge d’accueil dépend de la structure.",
      source: "reseau", confidence: .85 },
  ]);

  function conditionDe(lieu) {
    const nom = String((lieu && (lieu.titre || lieu.title)) || "");
    const trouve = CONDITIONS.find((c) => c.motif.test(nom));
    if (!trouve) return null;
    return { texte: trouve.texte, age: trouve.age || null, public: trouve.public || null,
             source: trouve.source, confidence: trouve.confidence };
  }

  function sansAccents(s) {
    const C = root.AutourComprendre;
    if (C && C.sansAccents) return C.sansAccents(s);
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, " ").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function contient(t, mot) {
    const C = root.AutourComprendre;
    if (C && C.contient) return C.contient(t, mot);
    return t.indexOf(sansAccents(mot)) >= 0;
  }

  /* ---- De la phrase au besoin --------------------------------------------
     « j'ai 20 ans et je trouve pas de travail » → travail, jeunes.
     On ne garde que les identifiants normalisés : la phrase n'est pas
     conservée, et ce module ne l'écrit nulle part. */
  function besoinsDepuisPhrase(phrase) {
    const t = sansAccents(phrase);
    if (!t) return [];
    const trouvesLegacy = [];
    BESOINS.forEach((b) => {
      // l'expression la plus longue d'abord : « pas de travail » avant « travail »
      const mots = b.mots.slice().sort((x, y) => y.length - x.length);
      let poids = 0;
      let vu = null;
      mots.forEach((m) => {
        if (!contient(t, m)) return;
        // une expression longue est un signal plus sûr qu'un mot isolé
        const p = m.includes(" ") ? 1 + Math.min(.4, m.length / 100) : .8;
        if (p > poids) { poids = p; vu = m; }
      });
      if (poids > 0) trouvesLegacy.push({ id: b.id, poids, mot: vu });
    });

    /* Le lexique du texte libre vit dans son propre module. Le repli legacy
       ci-dessus reste volontairement présent : il protège les besoins
       internes `hygiene`, `vetements` et `mobilite`, ainsi que le démarrage
       d'une page qui aurait encore un cache de scripts ancien. Aucun lieu ne
       passe par cette couche : elle ne reçoit que la phrase de l'utilisateur. */
    const MOTEUR = root.AutourAideIntentions;
    const analyse = MOTEUR && typeof MOTEUR.analyserBesoins === "function"
      ? MOTEUR.analyserBesoins(phrase) : null;
    const parBesoin = new Map((analyse && analyse.besoins || [])
      .map((x) => [x.besoin, x]));
    const legacyParBesoin = new Map(trouvesLegacy.map((x) => [x.id, x]));
    const trouves = BESOINS.map((b) => {
      const moderne = parBesoin.get(b.id);
      const legacy = legacyParBesoin.get(b.id);
      if (!moderne && !legacy) return null;
      if (!moderne) return legacy;
      /* `poids` conserve la convention historique : une expression reconnue
         vaut au moins 1 et déclenche le domaine Aide avant les réparations.
         Le score de confiance public reste, lui, celui du moteur dédié. */
      return {
        id: b.id,
        poids: moderne.score >= .78 ? Math.max(1, moderne.score) : moderne.score,
        score: moderne.score,
        mot: moderne.signaux && moderne.signaux[0] || (legacy && legacy.mot) || null,
      };
    }).filter(Boolean);
    // « autre » ne se déclenche que si rien de plus précis n'a été trouvé
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
        const p = m.includes(" ") ? 1 : .8;
        if (p > poids) { poids = p; mot = m; }
      });
      return poids ? { id: intention.id, poids, mot } : null;
    }).filter(Boolean).sort((a, b) => b.poids - a.poids);
  }

  /* L'âge, quand la personne le dit d'elle-même. Sert à savoir si une
     condition connue la concerne — jamais à construire un profil. */
  function ageDepuisPhrase(phrase) {
    const t = sansAccents(phrase);
    const m = /\b(?:j ai|jai|age|ans)\D{0,6}(\d{1,2})\s*ans\b/.exec(t)
      || /\b(\d{1,2})\s*ans\b/.exec(t);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 10 && n <= 110 ? n : null;
  }

  function texteLieu(lieu) {
    const l = lieu || {};
    const tags = l.tags || {};
    return [l.titre, l.title, l.service, l.description,
      tags.social_facility, tags.amenity, tags.office, tags.healthcare,
      tags["healthcare:speciality"], tags["healthcare:counselling"]]
      .filter(Boolean).join(" ");
  }

  function categoriesLieu(lieu) {
    const l = lieu || {};
    return new Set([l.cat, ...(l.categories || [])].filter(Boolean));
  }

  function texteSanteLieu(lieu) {
    const l = lieu || {};
    return [texteLieu(l), l.type, l.primaryType, ...(l.categories || [])]
      .filter(Boolean).join(" ");
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
    return { poids: direct ? .9 : 0, direct };
  }

  function estSolutionSante(lieu, intentions, options) {
    const ids = (intentions || []).filter((id) => SOUS_INTENTIONS_SANTE.some((x) => x.id === id));
    const exigeAcces = ids.includes("acces") || !!(options && options.exigerAccesAdapte);
    if (exigeAcces && !accesAdapteSante(lieu)) return false;
    const services = ids.filter((id) => id !== "acces");
    if (services.length) return services.some((id) => pertinenceSante(lieu, id).direct);
    return categoriesLieu(lieu).has("sante") || SOUS_INTENTIONS_SANTE
      .filter((x) => x.id !== "acces").some((x) => x.lieux.some((re) => re.test(texteSanteLieu(lieu))));
  }

  /* ---- Un lieu répond-il à un besoin ? -----------------------------------

     CE QUE CETTE FONCTION FAISAIT, ET POURQUOI C'ÉTAIT FAUX

     Elle testait ses expressions de réseaux — dont `/croix[-\s]rouge/` — sur un
     texte dont le NOM était le premier élément, et rendait alors
     `poids: 1, sur: true`. Le nom, seul, suffisait donc à faire d'une
     boulangerie une structure d'aide alimentaire :

       VIENNOISERIE ROYALE CROIX ROUGE → aide alimentaire certaine

     Les deux règles suivantes avaient le même défaut en plus discret : une
     catégorie large valait `.72`, et un mot du besoin trouvé dans le nom
     valait `.8` — au-dessus du seuil, sans qu'aucune donnée n'atteste rien.

     CE QU'ELLE FAIT MAINTENANT

     Rien. Elle DÉLÈGUE à `aide-classement.js`, qui examine le type réel, les
     catégories, les tags, les services, la description, la source — et le nom
     en dernier, pour peu. Cette fonction ne fait plus que traduire son verdict
     dans la forme que le reste d'Autour attend déjà.

     Le repli sans le classement chargé n'est PAS l'ancienne règle : c'est la
     catégorie seule. Mieux vaut ne rien proposer que reproduire le défaut
     qu'on corrige. */
  function pertinence(lieu, besoinId) {
    const b = BESOIN_DE(besoinId);
    /* Une seule forme de retour, quelle que soit la branche : un appelant qui
       lit `direct` ne doit jamais tomber sur `undefined` selon le chemin pris. */
    if (!b || !lieu) return { poids: 0, raison: "", sur: false, direct: false };

    const CLASSEMENT = root.AutourAideClassement;
    if (!CLASSEMENT) return pertinenceSansClassement(lieu, b);

    const options = arguments[2] || {};
    /* Le profil n'est jamais inventé ; quand l'appelant le fournit, il sert
       seulement aux structures dont le public est réellement conditionnel
       (FJT, centre parental/maternel, CHRS mineur/adulte). */
    const v = options.profil || options.profile
      ? CLASSEMENT.repond(lieu, besoinId, options)
      : CLASSEMENT.repond(lieu, besoinId);
    if (v && v.accorde) {
      return {
        /* La confiance du classement, ramenée entre 0 et 1. Un lieu accepté
           est au moins au seuil, donc au moins à 0,5 : `pourquoi()` qui exige
           0,6 reste servi par les preuves solides et pas par les limites. */
        poids: Math.min(1, v.confiance / 100),
        raison: b.pourquoi,
        sur: v.certaine === true,
        direct: true,
        preuves: v.preuves,
      };
    }

    /* L'association généraliste reste un recours dans « Autre aide » et dans
       les listes élargies — jamais une réponse à « Travail » ou « Santé ».
       `direct:false` est ce qui l'écarte de toute sélection précise. */
    if (categoriesLieu(lieu).has("asso"))
      return { poids: .25, raison: b.pourquoi, sur: false, direct: false };

    return { poids: 0, raison: "", sur: false, direct: false,
             refus: v ? v.refus : null };
  }

  /* Le repli, volontairement pauvre : la catégorie, et rien d'autre. Aucune
     lecture de nom, jamais — c'est la règle du produit, pas une optimisation
     du chemin nominal. */
  function pertinenceSansClassement(lieu, b) {
    const directes = CATEGORIES_DIRECTES[b.id] || (b.id === "autre" ? b.cats : []);
    const cats = categoriesLieu(lieu);
    if (directes.some((c) => cats.has(c)))
      return { poids: .72, raison: b.pourquoi, sur: false, direct: true };
    if (cats.has("asso"))
      return { poids: .25, raison: b.pourquoi, sur: false, direct: false };
    return { poids: 0, raison: "", sur: false, direct: false };
  }

  /* ---- Une phrase, plusieurs intentions ---------------------------------

     « mon copain me frappe » ne demande pas une chose mais plusieurs : se
     mettre en sécurité, parler à quelqu'un, et peut-être dormir ailleurs ce
     soir. Répondre par une seule case, c'est répondre à côté.

     Le besoin PRINCIPAL et `besoinsExprimes` viennent exclusivement du moteur
     de texte libre. `besoinsSecondaires` vient de la taxonomie : ce sont des
     pistes d'accompagnement, jamais des choses que la personne a dites.
     Rien n'est deviné à partir d'un nom de structure.

     La forme rendue est celle que le modèle rendrait s'il était branché —
     `{primaryNeed, secondaryNeeds}`. C'est voulu : le mode doit répondre
     pareil avec ou sans lui, et le jour où il arrive, il complète au lieu de
     remplacer. */
  const MAX_SECONDAIRES = 3;

  function intentions(phrase) {
    const MOTEUR = root.AutourAideIntentions;
    const analyse = MOTEUR && typeof MOTEUR.analyserBesoins === "function"
      ? MOTEUR.analyserBesoins(phrase) : null;
    const bruts = analyse && Array.isArray(analyse.besoins)
      ? analyse.besoins.slice().sort((a, z) => (z.score || 0) - (a.score || 0)) : [];

    /* La liste publique est volontairement séparée des suggestions de la
       taxonomie. L'ordre du moteur est l'ordre de confiance décroissante :
       son premier besoin est donc le principal. */
    const exprimesAvecScores = [];
    const vus = new Set();
    bruts.forEach((x) => {
      if (!x || typeof x.besoin !== "string" || vus.has(x.besoin)) return;
      vus.add(x.besoin);
      exprimesAvecScores.push({ besoin: x.besoin, score: x.score });
    });
    const besoinsExprimes = exprimesAvecScores.map((x) => x.besoin);
    const principal = besoinsExprimes[0] || null;

    const TAXO = root.AutourAideTaxonomie;
    const b = principal && TAXO ? TAXO.besoin(principal) : null;
    const besoinsSecondaires = [];
    (b && Array.isArray(b.secondaires) ? b.secondaires : []).forEach((id) => {
      if (id !== principal && !vus.has(id) && besoinsSecondaires.indexOf(id) < 0)
        besoinsSecondaires.push(id);
    });
    const secondaires = besoinsSecondaires.slice(0, MAX_SECONDAIRES);

    return {
      primaryNeed: principal,
      /* Identifiants réellement détectés dans la phrase, sans taxonomie. */
      besoinsExprimes,
      /* Les scores restent disponibles sans polluer la liste affichée. */
      besoinsExprimesAvecScores: exprimesAvecScores,
      /* Suggestions écrites dans aide-taxonomie.js, jamais des expressions. */
      besoinsSecondaires: secondaires,
      secondaryNeeds: secondaires,
      /* Alias historique conservé pour les intégrations existantes. */
      besoins: besoinsExprimes,
    };
  }

  /* Toutes les capacités d'une structure, dans les mots du modèle de données.
     C'est par elle qu'une mission locale apparaît à la fois dans « Travail »
     et dans « Jeunes » : une structure a des capacités, pas une case. */
  function capacitesDe(lieu) {
    const CLASSEMENT = root.AutourAideClassement;
    if (!CLASSEMENT) return null;
    return CLASSEMENT.capacites(lieu);
  }

  /* Une catégorie de recherche n'est pas, à elle seule, une preuve sociale.
     Google peut répondre « hôtel » à la requête « hébergement d'urgence » et
     le chemin historique lui donnait alors la catégorie `hebergement` par
     défaut. Ces garde-fous restent légers : ils ne remplacent pas la
     taxonomie, ils empêchent seulement un POI touristique ou un événement de
     franchir la frontière Aide par son libellé. */
  const TYPES_TOURISTIQUES = Object.freeze([
    "hotel", "lodging", "hostel", "motel", "guest_house", "tourist_attraction",
    "museum", "musee", "art_gallery", "historic_site", "monument", "tourism",
    "event", "festival", "concert", "theatre", "theater",
  ]);
  const RESEAUX_LOGEMENT_RECONNUS =
    /\b(?:ccas|samu\s*social|115|adil|action\s+logement|chrs|maison\s+relais|pension\s+de\s+famille|hebergement\s+d.?urgence)\b/i;
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
    autre: ["autre", "other_aid", "help"],
  });

  function normaliserCategorieAide(valeur) {
    return sansAccents(String(valeur || "")).trim().replace(/[\s-]+/g, "_");
  }

  function texteTypeLieu(lieu) {
    const l = lieu || {};
    const tags = l.tags || {};
    return [l.primaryType, l.type, l.placeType, l.category, l.cat,
      ...(l.categories || []), tags.tourism, tags.historic, tags.amenity,
      tags.leisure].filter(Boolean).map(sansAccents).join(" ");
  }

  function categoriesAideDocumentees(lieu) {
    const l = lieu || {};
    return new Set([...(Array.isArray(l.aidCategories) ? l.aidCategories : []),
      ...(Array.isArray(l.aid_categories) ? l.aid_categories : []),
      ...(Array.isArray(l.categoriesAide) ? l.categoriesAide : []),
      ...(Array.isArray(l.categories_aide) ? l.categories_aide : [])]
      .map(normaliserCategorieAide).filter(Boolean));
  }

  function estFournisseurAide(lieu, besoins) {
    const l = lieu || {};
    const ids = (besoins || []).filter(Boolean);
    const documentees = categoriesAideDocumentees(l);
    const fournisseurExplicite = l.isAidProvider === true || l.is_aid_provider === true;
    if (l.isAidProvider === false || l.is_aid_provider === false) return false;
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
    if (TYPES_TOURISTIQUES.some((motif) => type.split(/\s+/).includes(sansAccents(motif))) ||
        tags.tourism || tags.historic || tags.heritage) return false;
    /* Les événements restent admis uniquement lorsqu'une source les a
       explicitement marqués comme aide (aidCategories/isAidProvider). */
    if (l.isTemporary === true || l.temporaire === true) return false;
    if (["google_places", "datatourisme"].includes(source)) return false;

    if (ids.includes("logement")) {
      const nom = String(l.titre || l.title || l.name || "");
      if (/\b(?:maison|h[ôo]tel|logement)\b/i.test(nom) &&
          !RESEAUX_LOGEMENT_RECONNUS.test(nom)) return false;
    }
    return true;
  }

  function estSolution(lieu, besoins, options) {
    const ids = (besoins || []).filter((id) => !!BESOIN_DE(id));
    if (!ids.length) return false;
    if (!estFournisseurAide(lieu, ids)) return false;
    const o = options || {};
    return ids.some((id) => {
      const p = pertinence(lieu, id, {
        large: o.large === true,
        profil: o.profil || o.profile,
      });
      return p.direct === true || (o.accepterLarge === true && p.poids > 0);
    });
  }

  /* Rendez-vous : seulement une information explicitement publiée par le
     lieu, un tag OSM, ou une règle de réseau connue. L'absence reste « non
     renseigné », jamais « sans rendez-vous ». */
  function rendezVousDe(lieu) {
    const l = lieu || {};
    const tag = String((l.tags || {}).appointment || "").toLowerCase();
    if (["yes", "required", "only"].includes(tag)) return { label: "Sur rendez-vous", source: "OpenStreetMap" };
    if (["no", "walk_in"].includes(tag)) return { label: "Sans rendez-vous", source: "OpenStreetMap" };
    const condition = conditionDe(l);
    const texte = [condition && condition.texte, l.description, l.service].filter(Boolean).join(" ");
    if (/sans rendez-vous/i.test(texte)) return { label: "Sans rendez-vous", source: condition ? "Réseau" : "Structure" };
    if (/rendez-vous/i.test(texte)) return { label: "Sur rendez-vous", source: condition ? "Réseau" : "Structure" };
    return null;
  }

  /* ---- « Pourquoi Autour te le propose » ---------------------------------
     Une phrase, construite uniquement à partir de ce que la personne a
     indiqué et de ce que la donnée dit. Jamais une condition inventée. */
  function pourquoi(lieu, besoins, profil) {
    const raisons = [];
    (besoins || []).forEach((id) => {
      const p = pertinence(lieu, id);
      if (p.poids >= .6 && !raisons.includes(p.raison)) raisons.push(p.raison);
    });
    const cond = conditionDe(lieu);
    const age = profil && Number.isFinite(Number(profil.age)) ? Number(profil.age) : null;
    if (cond && cond.age && age != null && age >= cond.age.min && age <= cond.age.max)
      raisons.push("Tu as " + age + " ans, et ce réseau accompagne les "
        + cond.age.min + "-" + cond.age.max + " ans.");
    return raisons.join(" ");
  }

  /* Ce lieu est-il pour cette personne ?
     `true` / `false` / `null`. `null` domine : sans information sur l'âge ou
     sans condition connue, on ne dit rien plutôt que de trancher. */
  function convient(lieu, profil) {
    const cond = conditionDe(lieu);
    if (!cond || !cond.age) return null;
    const age = profil && Number.isFinite(Number(profil.age)) ? Number(profil.age) : null;
    if (age == null) return null;
    return age >= cond.age.min && age <= cond.age.max;
  }

  const estUrgent = (phrase) => {
    const MOTEUR = root.AutourAideIntentions;
    if (MOTEUR && typeof MOTEUR.detecterUrgence === "function" &&
        MOTEUR.detecterUrgence(phrase)) return true;
    return URGENCE.test(String(phrase || ""));
  };

/* Ce vers quoi Aide sait réellement orienter. Écrit ici plutôt que dans
   l'interface : c'est une propriété du modèle, et l'écran qui l'affiche doit
   la lire, pas la recopier — deux listes finissent toujours par différer. */
  /* Écrit dans les mots de tout le monde, et dans ceux de la grille juste
     au-dessus. « Emploi et insertion », « urgence sociale », « accompagnement
     des jeunes » sont les mots des institutions, pas ceux de quelqu'un qui
     cherche du travail ou un endroit où dormir : cette liste s'affiche à
     l'écran, elle doit se lire sans traduction. */
  const PERIMETRE = Object.freeze([
    "manger", "se loger", "travail et argent", "papiers et démarches",
    "santé", "études et jeunes", "parler à quelqu’un", "famille",
    "sécurité et violences", "se déplacer", "hygiène", "vêtements",
  ]);

  /* ===================================================================
     « Mon vélo est cassé » n'est pas une demande d'aide sociale

     Le champ libre d'Aide accepte n'importe quelle phrase, et c'est voulu :
     personne ne doit avoir à choisir une catégorie avant de pouvoir dire ce
     qui lui arrive. Mais toute phrase n'appartient pas à Aide.

     Ce que faisait le code : une phrase non reconnue tombait sur « autre » et
     l'écran affichait les structures qui orientent — CCAS, associations,
     France Services. Quelqu'un qui vient de taper « mon vélo est crevé » se
     voyait donc proposer un centre communal d'action sociale. C'est absurde
     pour lui, et c'est pire que ça : ça dilue Aide, qui doit rester l'endroit
     où l'on va quand on dort dehors ou qu'on n'a plus de quoi manger.

     La traduction se fait ici, pas dans la tête de l'utilisateur. On ne lui
     demande jamais « dans quelle catégorie classez-vous votre demande ? ».

     LA RÈGLE DE PRUDENCE : une réparation n'est reconnue que si un OBJET
     identifiable est nommé. Un symptôme sans objet reste dans Aide. « J'ai
     mal », « je suis cassé », « ça ne va plus » ne partent pas chez un
     réparateur — ces phrases-là parlent de la personne, pas d'une chose. Et
     un besoin social reconnu l'emporte toujours : dans le doute, on garde la
     personne dans Aide plutôt que de l'envoyer acheter quelque chose.
     =================================================================== */

  /* Ce qui casse, et chez qui on le fait réparer. Le libellé est ce que la
     personne lira ; la requête est ce qu'Explorer cherchera. */
  const OBJETS_REPARABLES = Object.freeze([
    { id: "velo", mots: ["velo", "velos", "bicyclette", "vtt", "trottinette"],
      requete: "réparateur de vélos", libelle: "une réparation de vélo" },
    { id: "telephone", mots: ["telephone", "portable", "smartphone", "iphone", "mobile", "ecran casse"],
      requete: "réparation téléphone", libelle: "une réparation de téléphone" },
    { id: "informatique", mots: ["ordinateur", "ordi", "pc", "laptop", "tablette", "imprimante"],
      requete: "réparation informatique", libelle: "une réparation informatique" },
    { id: "voiture", mots: ["voiture", "auto", "automobile", "moteur", "pneu", "batterie de voiture"],
      requete: "garage automobile", libelle: "un garage" },
    { id: "serrure", mots: ["serrure", "cle", "cles", "verrou", "porte claquee", "enferme dehors"],
      requete: "serrurier", libelle: "un serrurier" },
    { id: "plomberie", mots: ["robinet", "fuite d eau", "plomberie", "chasse d eau", "canalisation", "chauffe eau"],
      requete: "plombier", libelle: "un plombier" },
    { id: "electricite", mots: ["prise electrique", "electricite", "compteur", "disjoncteur", "tableau electrique"],
      requete: "électricien", libelle: "un électricien" },
    { id: "chaussures", mots: ["chaussure", "chaussures", "basket", "baskets", "semelle", "talon"],
      requete: "cordonnier", libelle: "un cordonnier" },
    { id: "couture", mots: ["fermeture eclair", "ourlet", "retouche", "couture", "pantalon dechire"],
      requete: "retouche couture", libelle: "une retouche" },
    { id: "lunettes", mots: ["lunettes", "verre casse", "monture"],
      requete: "opticien", libelle: "un opticien" },
    { id: "montre", mots: ["montre", "horloge", "pile de montre"],
      requete: "horloger", libelle: "un horloger" },
    { id: "electromenager", mots: ["machine a laver", "lave linge", "lave vaisselle", "frigo",
                                   "refrigerateur", "four", "aspirateur", "television", "tele"],
      requete: "réparation électroménager", libelle: "une réparation d’électroménager" },
  ]);

  /* Le signe qu'on parle d'une chose abîmée, pas d'une situation. Les mots
     sont volontairement peu nombreux : mieux vaut laisser une réparation dans
     Aide que d'envoyer quelqu'un en détresse chez un commerçant. */
  /* LES ACCORDS SONT ÉCRITS, PAS DEVINÉS.
     `contient` (comprendre.js) compare des MOTS ENTIERS : « bloque » ne
     reconnaît pas « bloquée », et « casse » ne reconnaît pas « cassées ». Une
     première version ne listait que le masculin singulier et laissait donc
     « ma serrure est bloquée » dans Aide. Chaque forme utile est écrite ici —
     c'est verbeux, mais un radical tronqué attraperait « bloc » ou « case »,
     ce qui est bien pire qu'une liste longue. */
  const SIGNES_PANNE = Object.freeze([
    "casse", "cassee", "cassees", "casses",
    "en panne", "panne", "creve", "crevee", "creves", "crevees",
    "abime", "abimee", "abimes", "abimees",
    "ne marche plus", "ne fonctionne plus", "marche plus", "fonctionne plus",
    "ne demarre plus", "demarre plus",
    "repare", "reparer", "reparation", "reparations", "reparateur",
    "depanner", "depannage",
    "fuit", "fuite", "bloque", "bloquee", "bloques", "bloquees",
    "coince", "coincee", "hs", "foutu", "foutue", "pete", "petee",
    "raye", "rayee", "troue", "trouee", "trouees", "troues",
  ]);

  /* Certaines demandes ne sont pas des pannes mais restent du ressort
     d'Explorer : on cherche un commerce ou un service, pas une structure
     sociale. Elles exigent une intention de recherche explicite. */
  const SERVICES_EXPLORER = Object.freeze([
    { id: "coiffeur", mots: ["coiffeur", "coiffeuse", "me faire couper les cheveux"],
      requete: "coiffeur", libelle: "un coiffeur" },
    { id: "pressing", mots: ["pressing", "nettoyage a sec", "laverie automatique"],
      requete: "pressing laverie", libelle: "un pressing" },
    { id: "veterinaire", mots: ["veterinaire", "mon chien est malade", "mon chat est malade"],
      requete: "vétérinaire", libelle: "un vétérinaire" },
  ]);

  const VERBES_RECHERCHE = Object.freeze([
    "je cherche", "ou trouver", "ou est", "je voudrais trouver", "j ai besoin d un",
    "j ai besoin d une", "il me faut", "trouver un", "trouver une",
  ]);

  function trouverDans(t, familles) {
    for (const famille of familles) {
      // l'expression la plus longue d'abord : « batterie de voiture » avant « voiture »
      const mots = famille.mots.slice().sort((a, b) => b.length - a.length);
      for (const m of mots) {
        if (contient(t, m)) return { famille, mot: m };
      }
    }
    return null;
  }

  /* Rend le domaine d'une phrase :

       { domaine:"aide" }                       — un besoin social, reconnu ou non
       { domaine:"explorer", requete, libelle } — une réparation ou un service

     `domaine:"aide"` est le défaut, et c'est délibéré : ce champ est celui
     d'Aide, et une phrase qu'on ne sait pas lire ne doit pas éjecter la
     personne vers un moteur de recherche de commerces. */
  function domaineDeLaPhrase(phrase) {
    const t = sansAccents(phrase);
    if (!t) return { domaine: "aide", raison: "vide" };

    // une urgence ferme la question tout de suite
    if (estUrgent(phrase)) return { domaine: "aide", raison: "urgence" };

    /* LE ROUTEUR D'INTENTIONS A LE DERNIER MOT QUAND IL DIT « EXPLORER ».

       Ce champ ne connaissait que les mots d'Aide, et il les reconnaissait
       partout : « je cherche une pharmacie » contient « pharmacie », donc
       c'était un besoin de santé, donc on restait dans Aide. « Un bon kebab
       près de moi » ne ressemblait à rien de connu, donc on restait dans Aide
       aussi, par défaut. Dans les deux cas la personne cherchait un lieu.

       `intentions.js` lit la phrase entière au lieu de ses mots. On ne lui
       délègue que le basculement vers Explorer, et seulement quand il est sûr
       de lui : dire « aide » reste le défaut, et tout le reste du champ —
       besoins, poids, pertinence — ne change pas. */
    const routeur = root.AutourIntentions;
    if (routeur) {
      const r = routeur.router(phrase);
      if (routeur.mondeDe(r) === "explorer" && r.confidence >= routeur.SEUIL_CONFIANCE) {
        return {
          domaine: "explorer",
          raison: r.intent === "mobility_problem" ? "reparation"
            : r.intent === "local_service" ? "service" : "lieu",
          objet: r.category || null,
          requete: r.requete || phrase,
          libelle: r.libelle || null,
        };
      }
    }

    // une panne : il faut ET un objet nommé ET un signe de panne
    const objet = trouverDans(t, OBJETS_REPARABLES);
    const panne = !!objet && SIGNES_PANNE.some((s) => contient(t, s));

    /* L'ORDRE COMPTE, ET IL A COÛTÉ UN BUG.
       « Ma machine à laver est en panne » contient « laver », qui est un mot
       du besoin « hygiène » (douche, laverie). Faire gagner le besoin social
       dès qu'il est reconnu renvoyait donc cette phrase vers des douches
       publiques.

       On distingue la force du signal : `besoinsDepuisPhrase` pèse 1 ou plus
       une EXPRESSION (« rien a manger », « je dors dehors »), et seulement .8
       un mot isolé qui peut appartenir à deux mondes. Une expression
       l'emporte toujours ; un mot isolé cède devant une panne caractérisée. */
    const besoins = besoinsDepuisPhrase(phrase);
    const besoinExplicite = besoins.some((b) => b.poids >= 1);
    if (besoinExplicite) return { domaine: "aide", raison: "besoin" };

    if (panne) {
      return {
        domaine: "explorer", raison: "reparation",
        objet: objet.famille.id,
        requete: objet.famille.requete,
        libelle: objet.famille.libelle,
      };
    }

    if (besoins.length) return { domaine: "aide", raison: "besoin" };

    // un service explicitement cherché
    const service = trouverDans(t, SERVICES_EXPLORER);
    if (service && (VERBES_RECHERCHE.some((v) => contient(t, v)) ||
                    SIGNES_PANNE.some((s) => contient(t, s)) ||
                    service.mot === t.trim())) {
      return {
        domaine: "explorer", raison: "service",
        objet: service.famille.id,
        requete: service.famille.requete,
        libelle: service.famille.libelle,
      };
    }

    // un objet nommé sans signe de panne : on ne conclut pas. « J'ai vendu mon
    // vélo » n'est pas une demande de réparation.
    return { domaine: "aide", raison: "inconnu" };
  }

  root.AutourAide = Object.freeze({
    BESOINS, BESOINS_GRILLE, BESOIN_DE, CONDITIONS, CATEGORIES_DIRECTES,
    SOUS_INTENTIONS_SANTE, besoinsDepuisPhrase, intentionsSanteDepuisPhrase,
    ageDepuisPhrase, pertinence, pertinenceSante, pourquoi, capacitesDe,
    intentions, MAX_SECONDAIRES,
    detecterBesoins: root.AutourAideIntentions && root.AutourAideIntentions.detecterBesoins,
    analyserBesoins: root.AutourAideIntentions && root.AutourAideIntentions.analyserBesoins,
    conditionDe, convient, estSolution, estSolutionSante, accesAdapteSante,
    estFournisseurAide, categoriesAideDocumentees,
    rendezVousDe, estUrgent, PERIMETRE,
    OBJETS_REPARABLES, SERVICES_EXPLORER, domaineDeLaPhrase,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
