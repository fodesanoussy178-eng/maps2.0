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
      id: "manger", emoji: "🍲", label: "Manger",
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
      id: "travail", emoji: "💼", label: "Travail / formation",
      mots: ["travail", "emploi", "boulot", "job", "trouver du travail",
             "pas de travail", "chomage", "licencie", "formation", "me former",
             "apprentissage", "alternance", "stage", "cv", "recrutement",
             "entretien", "reconversion", "chercher un emploi", "sans emploi"],
      cats: ["emploi", "asso"],
      reseaux: [/mission locale/i, /france travail|p[oô]le emploi/i, /cap emploi/i,
                /maison de l['’\s]?emploi/i, /\bepide\b/i, /garantie jeunes/i],
      pourquoi: "Tu cherches du travail ou une formation.",
    },
    {
      id: "papiers", emoji: "📄", label: "Papiers / démarches",
      mots: ["papiers", "demarche", "demarches", "administratif", "administrative",
             "dossier", "formulaire", "je comprends rien", "aide administrative",
             "titre de sejour", "carte d identite", "passeport", "impots",
             "declaration", "courrier", "en ligne", "numerique", "domiciliation",
             "adresse", "ecrire une lettre"],
      cats: ["mairie", "asso", "emploi"],
      reseaux: [/maison\s*(?:france\s*services|de services au public)/i, /\bccas\b/i,
                /mairie/i, /prefecture/i, /mission locale/i, /point d['’\s]?acces au droit/i],
      pourquoi: "Tu cherches de l’aide pour des démarches.",
    },
    {
      id: "argent", emoji: "💶", label: "Argent",
      mots: ["argent", "pas d argent", "fauche", "dettes", "dette", "surendettement",
             "facture", "factures", "impaye", "aide financiere", "budget",
             "fin de mois", "rsa", "allocation", "allocations", "prime",
             "je n arrive plus a payer", "sans ressources"],
      cats: ["asso", "mairie", "emploi"],
      reseaux: [/\bccas\b/i, /\bcaf\b/i, /secours catholique/i, /secours populaire/i,
                /point conseil budget/i, /\bcrous\b/i],
      pourquoi: "Tu as des difficultés financières.",
    },
    {
      id: "sante", emoji: "🩺", label: "Santé",
      mots: ["sante", "malade", "medecin", "docteur", "soigner", "soins",
             "dentiste", "psy", "psychologue", "mal", "douleur", "medicament",
             "pharmacie", "vaccination", "depistage", "sans mutuelle",
             "pas de securite sociale", "j ai besoin de parler a quelqu un"],
      cats: ["sante", "asso"],
      reseaux: [/permanence d['’\s]?acc[èe]s aux soins|\bpass\b\s*sant/i,
                /centre de sant[ée]/i, /\bcmp\b/i, /planning familial/i,
                /m[ée]decins du monde/i, /croix[-\s]rouge/i],
      pourquoi: "Tu cherches à te soigner ou à parler à quelqu’un.",
    },
    {
      id: "jeunes", emoji: "🎓", label: "Jeunes / études",
      mots: ["jeune", "jeunes", "etudiant", "etudiante", "etudes", "lycee",
             "universite", "fac", "bourse", "crous", "scolarite", "orientation",
             "j ai 16 ans", "j ai 17 ans", "j ai 18 ans", "j ai 19 ans",
             "j ai 20 ans", "j ai 21 ans", "j ai 22 ans", "j ai 23 ans",
             "j ai 24 ans", "j ai 25 ans", "mineur"],
      cats: ["emploi", "asso", "biblio"],
      reseaux: [/mission locale/i, /\bcrous\b/i, /\bcrij\b|information jeunesse/i,
                /point information jeunesse/i, /\bbij\b/i],
      pourquoi: "Tu es jeune ou étudiant.",
    },
    {
      id: "hygiene", emoji: "🚿", label: "Hygiène",
      mots: ["douche", "me laver", "laver", "hygiene", "toilettes", "wc",
             "laverie", "linge", "lessive", "propre", "sanitaire"],
      cats: ["toilettes", "asso", "hebergement"],
      reseaux: [/bains[-\s]douches/i, /accueil de jour/i, /croix[-\s]rouge/i],
      pourquoi: "Tu cherches un endroit pour te laver ou laver ton linge.",
    },
    {
      id: "vetements", emoji: "👕", label: "Vêtements",
      mots: ["vetement", "vetements", "habits", "s habiller", "vestiaire",
             "chaussures", "manteau", "friperie solidaire", "habiller mes enfants"],
      cats: ["collecte", "asso", "friperie"],
      reseaux: [/vestiaire/i, /secours populaire/i, /secours catholique/i,
                /croix[-\s]rouge/i, /emma(?:ü|u)s/i, /le relais/i],
      pourquoi: "Tu cherches des vêtements.",
    },
    {
      id: "autre", emoji: "🤝", label: "Autre aide",
      mots: ["aide", "aider", "coup de main", "soutien", "accompagnement",
             "je sais pas ou aller", "je viens d arriver", "perdu", "orienter",
             "conseil", "quelqu un a qui parler"],
      cats: ["asso", "mairie", "alimentaire", "hebergement", "sante", "emploi"],
      reseaux: [/maison\s*france\s*services/i, /centre social/i, /maison de quartier/i,
                /\bccas\b/i],
      pourquoi: "Tu cherches de l’aide, sans savoir par où commencer.",
    },
  ]);

  const BESOIN_DE = (id) => BESOINS.find((b) => b.id === id) || null;

  /* ---- Urgence -----------------------------------------------------------
     Ce n'est pas un besoin de plus : c'est une gravité. Elle traverse les
     besoins et remonte ce qui accueille sans rendez-vous. */
  const URGENCE = /\burgence|\b115\b|\b115\b|samu social|maraude|sans[- ]abri|ce soir|cette nuit|tout de suite|je dors dehors\b/i;

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
    const trouves = [];
    BESOINS.forEach((b) => {
      // l'expression la plus longue d'abord : « pas de travail » avant « travail »
      const mots = b.mots.slice().sort((x, y) => y.length - x.length);
      let poids = 0;
      let vu = null;
      mots.forEach((m) => {
        if (!contient(t, m)) return;
        // une expression longue est un signal plus sûr qu'un mot isolé
        const p = m.includes(" ") ? 1 : .8;
        if (p > poids) { poids = p; vu = m; }
      });
      if (poids > 0) trouves.push({ id: b.id, poids, mot: vu });
    });
    // « autre » ne se déclenche que si rien de plus précis n'a été trouvé
    const precis = trouves.filter((x) => x.id !== "autre");
    const liste = precis.length ? precis : trouves;
    return liste.sort((a, b) => b.poids - a.poids);
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

  /* ---- Un lieu répond-il à un besoin ? -----------------------------------
     Retourne un poids de 0 à 1 et la raison. Le nom qui désigne un réseau
     connu vaut plus qu'une simple appartenance de catégorie : une Mission
     locale pour « travail », c'est sûr ; une association pour « travail »,
     c'est possible. */
  function pertinence(lieu, besoinId, options) {
    const b = BESOIN_DE(besoinId);
    if (!b || !lieu) return { poids: 0, raison: "" };
    const o = options || {};
    const nom = String(lieu.titre || lieu.title || "");
    const cats = new Set([lieu.cat, ...(lieu.categories || [])]);

    if (b.reseaux.some((re) => re.test(nom)))
      return { poids: 1, raison: b.pourquoi, sur: true };
    if (b.cats.some((c) => cats.has(c)))
      return { poids: .6, raison: b.pourquoi, sur: false };
    // un service précisé par le nom (« vestiaire », « douches ») compte aussi
    if (b.mots.some((m) => m.length > 4 && contient(sansAccents(nom), m)))
      return { poids: .8, raison: b.pourquoi, sur: false };
    if (o.large && cats.has("asso")) return { poids: .25, raison: b.pourquoi, sur: false };
    return { poids: 0, raison: "" };
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

  const estUrgent = (phrase) => URGENCE.test(String(phrase || ""));

  root.AutourAide = Object.freeze({
    BESOINS, BESOIN_DE, CONDITIONS,
    besoinsDepuisPhrase, ageDepuisPhrase, pertinence, pourquoi,
    conditionDe, convient, estUrgent,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
