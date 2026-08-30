(function (root) {
  "use strict";

  /*
   * Moteur de compréhension du texte libre d'Aide.
   *
   * Ce fichier ne connaît ni les lieux, ni les tags, ni les catégories de
   * structures. Il ne fait que transformer une phrase utilisateur en besoins
   * normalisés. La nature d'une structure reste du ressort de
   * `aide-taxonomie.js` et `aide-classement.js`.
   *
   * Contrat principal :
   *   detecterBesoins("j'ai faim")
   *   // [{ besoin: "manger", score: 0.95 }]
   *   // .urgence vaut null ou { detectee: true, score, signaux }
   *
   * `analyserBesoins` est la forme objet explicite, utile aux intégrations
   * qui préfèrent lire séparément `besoins` et `urgence`.
   */

  const CATEGORIES = Object.freeze([
    "manger", "logement", "travail", "papiers", "sante", "jeunes",
    "parler", "famille", "securite", "autre",
  ]);

  const LIBELLES = Object.freeze({
    manger: "Manger",
    logement: "Logement",
    travail: "Travail / argent",
    papiers: "Papiers / démarches",
    sante: "Santé",
    jeunes: "Jeunes / études",
    parler: "Parler à quelqu’un",
    famille: "Famille",
    securite: "Sécurité",
    autre: "Autre aide",
  });

  /* Le dictionnaire est organisé par besoin, et jamais par structure. Les
     expressions complètes sont conservées : elles pèsent davantage qu'un
     mot ambigu comme « mère », « mission » ou « adresse ». */
  const LEXIQUE = Object.freeze({
    manger: [
      "manger", "nourriture", "alimentaire", "alimentation", "repas",
      "repas gratuit", "repas chaud", "dejeuner", "diner", "petit dej",
      "petit dejeuner", "bouffe", "bouffer", "graille", "grailler", "dalle",
      "j ai la dalle", "faim", "j ai faim", "crever de faim", "rien a manger",
      "plus rien a manger", "pas mange", "pas de quoi manger", "frigo vide",
      "placards vides", "courses", "faire les courses", "panier alimentaire",
      "colis alimentaire", "aide alimentaire", "distribution alimentaire",
      "distribution de repas", "epicerie solidaire", "epicerie sociale",
      "banque alimentaire", "resto solidaire", "cantine solidaire",
      "soupe populaire", "soupe", "maraude alimentaire", "invendus",
      "produits alimentaires", "produits de premiere necessite",
      "bon alimentaire", "ticket alimentaire", "cheque alimentaire",
      "bon de courses", "alimentation bebe", "lait bebe", "lait infantile",
    ],
    logement: [
      "logement", "loger", "hebergement", "heberger", "dormir", "ou dormir",
      "dormir quelque part", "dormir ce soir", "dormir dehors", "dors dehors",
      "je dors dehors", "a la rue",
      "dans la rue", "sdf", "sans domicile", "sans abri", "clochard",
      "foyer", "foyer d hebergement", "refuge", "abri", "abri de nuit",
      "accueil de nuit", "hebergement d urgence", "urgence logement", "115",
      "chu", "chrs", "residence sociale", "maison relais", "pension de famille",
      "fjt", "foyer jeune travailleur", "habitat jeunes", "residence habitat jeunes",
      "appart", "appartement", "studio", "piaule", "chambre", "toit",
      "avoir un toit", "trouver un toit", "chez quelqu un", "heberge chez quelqu un",
      "squatter", "squat", "expulsion", "expulse", "vire de chez moi",
      "mes parents m ont vire", "mes parents m ont vire de chez moi",
      "ma mere m a vire", "ma mere m a vire de chez elle", "mon mec m a vire",
      "ma meuf m a vire", "plus de logement", "perdre mon logement",
      "risque de perdre mon logement", "preavis", "loyer", "loyer impaye",
      "impayes", "dette de loyer", "caution", "depot de garantie", "garant",
      "visale", "proprietaire", "bailleur", "hlm", "logement social",
      "demande hlm", "dalo", "fsl", "action logement", "adil",
    ],
    travail: [
      "travail", "boulot", "emploi", "job", "taf", "taff", "bosser",
      "boulotter", "trouver du travail", "chercher du travail", "pas de travail",
      "recherche d emploi",
      "chomage", "chomeur", "sans emploi", "au chomage", "demandeur d emploi",
      "recrutement", "embauche", "cdi", "cdd", "interim", "mission",
      "petit boulot", "job etudiant", "saisonnier", "extras", "stage",
      "alternance", "apprentissage", "contrat pro", "formation", "reconversion",
      "cv", "curriculum vitae", "lettre de motivation", "entretien",
      "entretien d embauche", "candidature", "postuler", "france travail",
      "pole emploi", "mission locale", "cap emploi", "maison de l emploi",
      "insertion", "chantier d insertion", "argent", "thune", "tunes", "tune",
      "sous", "fric", "oseille", "ble", "maille", "love", "loved", "cash",
      "fauche", "fauchee", "a sec", "sans un rond", "plus un rond",
      "pas d argent", "plus d argent", "plus de thune", "plus de tunes",
      "galere d argent", "probleme d argent",
      "difficultes financieres", "galere financiere", "fins de mois",
      "fin de mois difficile", "decouvert", "dette", "dettes", "endette",
      "surendette", "surendettement", "facture", "factures", "factures impayees",
      "electricite impayee", "gaz impaye", "eau impayee", "aide financiere",
      "secours financier", "rsa", "prime activite", "allocation", "allocations",
      "prestations sociales", "droits sociaux",
    ],
    papiers: [
      "papiers", "paperasse", "demarches", "demarche administrative",
      "administratif", "administration", "documents", "dossier", "formulaire",
      "remplir un dossier", "faire un dossier", "monter un dossier",
      "envoyer un dossier", "comprendre un courrier", "lettre officielle",
      "courrier administratif", "aide pour ecrire", "ecrivain public",
      "domiciliation", "adresse administrative", "attestation", "justificatif",
      "justificatif de domicile", "acte de naissance", "etat civil", "mairie",
      "prefecture", "sous prefecture", "anef", "titre de sejour", "carte de sejour",
      "recepisse", "renouvellement", "regularisation", "naturalisation",
      "nationalite", "passeport", "carte d identite", "cni", "permis",
      "permis de conduire", "carte grise", "certificat d immatriculation",
      "impots", "declaration d impots", "taxes", "caf dossier", "cpam dossier",
      "ameli", "franceconnect", "compte bloque", "mot de passe administration",
      "demarches en ligne", "numerique", "ordinateur pour demarche",
      "scanner", "imprimer des papiers", "photocopie", "france services",
      "maison france services", "acces au droit", "aide juridique", "droits",
      "avocat gratuit", "permanence juridique",
    ],
    sante: [
      "sante", "medecin", "docteur", "generaliste", "medecin traitant",
      "consultation", "soins", "se soigner", "malade", "maladie", "douleur",
      "j ai mal", "blessure", "blesse", "urgence medicale", "hopital", "hosto",
      "urgences", "clinique", "centre de sante", "maison de sante", "pharmacie",
      "medicaments", "medocs", "traitement", "ordonnance", "dentiste", "dents",
      "mal aux dents", "ophtalmo", "yeux", "lunettes", "gyneco", "gynecologue",
      "grossesse", "enceinte", "ivg", "contraception", "planning familial",
      "depistage", "test vih", "ist", "mst", "vaccination", "vaccin", "cpam",
      "assurance maladie", "ameli", "carte vitale", "mutuelle", "css",
      "complementaire sante solidaire", "pass", "permanence d acces aux soins",
      "sante mentale", "psy", "psychologue", "psychiatre", "depression",
      "anxiete", "crise d angoisse", "mal etre", "je vais mal", "insomnie",
      "addiction", "alcool", "drogue", "toxicomanie", "sevrage",
      "sans mutuelle", "pas de mutuelle", "sans securite sociale",
      "pas de securite sociale", "sans carte vitale", "pas de carte vitale",
      "pas d argent pour me soigner", "sans argent pour me soigner",
    ],
    jeunes: [
      "jeune", "jeunes", "ado", "adolescent", "mineur", "etudiant", "etudiante",
      "etudes", "ecole", "college", "lycee", "fac", "universite", "campus",
      "formation", "orientation", "orientation scolaire", "orientation professionnelle",
      "parcoursup", "parcours sup", "inscription", "inscription ecole",
      "inscription fac", "rentree", "scolarite", "decrochage scolaire",
      "decrocheur", "j ai arrete l ecole", "reprendre les etudes", "diplome",
      "brevet", "bac", "bts", "but", "licence", "master", "concours",
      "apprentissage", "alternance", "stage", "job etudiant", "mission locale",
      "cej", "contrat engagement jeune", "garantie jeunes", "epide",
      "ecole de la deuxieme chance", "e2c", "cio", "crous", "bourse",
      "bourse etudiante", "bourse scolaire", "logement etudiant",
      "residence universitaire", "resto u", "restaurant universitaire",
      "carte etudiante", "cv jeune", "premier emploi",
    ],
    parler: [
      "parler", "parler a quelqu un", "besoin de parler", "quelqu un a qui parler",
      "ecouter", "ecoute", "etre ecoute", "soutien", "soutien moral",
      "soutien psychologique", "moral", "pas le moral", "ca va pas", "je vais mal",
      "mal etre", "solitude", "seul", "seule", "je suis seul", "isole", "isolement",
      "personne a qui parler", "personne ne m ecoute", "besoin d aide",
      "besoin de soutien", "craquer", "je craque", "a bout", "j en peux plus",
      "j en ai marre", "perdu", "perdue", "anxieux", "anxieuse", "angoisse",
      "angoisse", "stresse", "deprime", "triste", "rupture", "separation", "deuil",
      "deces", "harcelement", "victime", "numero d ecoute", "ligne d ecoute",
      "permanence d ecoute", "psy", "psychologue", "groupe de parole",
      "association d ecoute",
    ],
    famille: [
      "famille", "familial", "parents", "parent", "pere", "mere", "papa", "maman",
      "enfant", "enfants", "bebe", "nourrisson", "fils", "fille", "ado",
      "parentalite", "parent isole", "mere isolee", "pere isole", "famille monoparentale",
      "famille nombreuse", "grossesse", "enceinte", "naissance", "maternite", "pmi",
      "protection maternelle infantile", "caf", "allocations familiales",
      "prestations familiales", "rsa parent", "prime naissance", "garde enfant",
      "garde d enfant", "creche", "assistante maternelle", "nounou", "mode de garde",
      "centre social", "mediation familiale", "mediateur familial", "conflit familial",
      "probleme avec mes parents", "probleme avec mon enfant", "separation", "divorce",
      "pension alimentaire", "impaye pension", "aripa", "violences familiales",
      "violences conjugales", "planning familial", "aide aux parents", "soutien parental",
      "reaap", "laep", "lieu accueil enfants parents",
    ],
    securite: [
      "securite", "danger", "en danger", "pas en securite", "peur", "j ai peur",
      "menace", "menaces", "menace", "agresse", "agressee", "agression", "attaque",
      "harcele", "harcelee", "harcelement", "violences", "violent", "violence conjugale",
      "violence familiale", "violence sexuelle", "agression sexuelle", "viol", "attouchements",
      "battu", "battue", "frappe", "coups", "mon conjoint me frappe", "mon mec me frappe",
      "ma meuf me frappe", "persecution", "stalking", "suivi dans la rue",
      "quelqu un me suit", "mon ex me suit", "cambriolage", "vol", "racket", "extorsion",
      "escroquerie", "arnaque", "police", "commissariat", "gendarmerie", "porter plainte",
      "plainte", "main courante", "victime", "aide aux victimes", "protection",
      "refuge femmes", "mise a l abri", "ordonnance de protection",
      "enfance en danger",
    ],
    autre: [
      "aide", "besoin d aide", "aidez moi", "pouvez vous m aider", "je cherche de l aide",
      "je sais pas ou aller", "je ne sais pas ou aller", "qui peut m aider", "ou aller",
      "vers qui me tourner", "organisme", "association", "service social",
      "travailleur social", "assistante sociale", "assistant social", "accompagnement",
      "accompagnement social", "permanence", "accueil", "orientation", "conseil",
      "information", "probleme", "galere", "je galere", "situation compliquee",
      "urgence", "besoin de quelque chose", "autre", "autre probleme", "je sais pas quoi faire",
    ],
  });

  /* Expressions très générales : elles restent utiles comme filet de sécurité,
     mais ne doivent pas créer un faux besoin au milieu d'une phrase précise. */
  const SIGNAUX_FAIBLES = new Set([
    "manger", "nourriture", "repas", "courses", "dormir", "logement", "foyer",
    "travail", "emploi", "mission", "argent", "sous", "facture", "dossier",
    "administration", "documents", "permis", "sante", "malade", "douleur", "psy",
    "formation", "stage", "jeune", "ado", "parler", "soutien", "moral", "perdu",
    "famille", "parent", "mere", "pere", "enfant", "securite", "peur", "victime",
    "aide", "probleme", "galere", "urgence", "police", "17", "112", "114", "119",
  ]);

  /* Corrections intentionnelles et bornées : elles couvrent les formes SMS ou
     les fautes fréquentes sans introduire de distance floue qui multiplierait
     les faux positifs. */
  const CORRECTIONS = Object.freeze([
    [/\bg\b/g, "j ai"],
    [/\bjai\b/g, "j ai"],
    [/\bja\b/g, "j ai"],
    [/\bchui\b|\bchuis\b|\bjsuis\b/g, "je suis"],
    [/\bjsp\b/g, "je sais pas"],
    [/\bjpp\b/g, "j en peux plus"],
    [/\bqqn\b|\bqqun\b/g, "quelqu un"],
    [/\bdun\b/g, "d un"],
    [/\bdune\b/g, "d une"],
    [/\bdehor\b/g, "dehors"],
    [/\bapart\b|\bappart\b/g, "appartement"],
    [/\btaf\b|\btaff\b/g, "travail"],
    [/\bboulot\b/g, "travail"],
    [/\bbouffe\b|\bbouffer\b/g, "manger"],
    [/\bmedoc\b/g, "medicaments"],
    [/\bmedcin\b|\bmedecin\b/g, "medecin"],
    [/\bpharmaci\b/g, "pharmacie"],
    [/\betude\b/g, "etudes"],
    [/\bdemarche\b/g, "demarches"],
    [/\bsejour\b/g, "sejour"],
  ]);

  const URGENCES = Object.freeze([
    "au secours", "aidez moi vite", "je suis en danger", "quelqu un me suit",
    "mon ex me suit", "on me suit", "quelqu un me poursuit", "on me poursuit",
    "suivi dans la rue", "stalking", "je vais mourir", "je veux mourir",
    "suicide", "me suicider", "en train de me frapper", "il me frappe",
    "elle me frappe", "on me frappe", "je suis agresse", "je suis agressee",
    "violences conjugales", "violence conjugale", "je me fais agresser",
    "j ai ete agresse", "j ai ete agressee", "je suis blesse", "je saigne",
    "je suis menace", "je suis menacee", "j ai tres peur", "j ai peur pour ma vie",
    "dormir dehors", "dormir dehors ce soir", "je dors dehors", "je dors dehors ce soir",
    "sans abri ce soir",
    "hebergement d urgence", "urgence logement", "urgence medicale", "urgence",
  ]);

  const AGE_JEUNE = /\b(?:j ai|je suis age de|age de)\s+(?:1[0-9]|2[0-5])\s+ans\b/;

  function sansAccents(texte) {
    return String(texte == null ? "" : texte)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[œ]/g, "oe")
      .replace(/[æ]/g, "ae");
  }

  function normaliser(texte) {
    let t = sansAccents(texte)
      .replace(/[’'`]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    CORRECTIONS.forEach(([motif, remplacement]) => {
      t = t.replace(motif, remplacement);
    });
    return t.replace(/\s+/g, " ").trim();
  }

  function contient(t, expression) {
    const mot = normaliser(expression);
    return !!mot && (" " + t + " ").includes(" " + mot + " ");
  }

  const longueur = (expression) => normaliser(expression).split(" ").filter(Boolean).length;

  function signauxUrgence(t) {
    const signaux = URGENCES.filter((expression) => contient(t, expression));

    /* Les numéros d'urgence ne sont des signaux que dans un contexte d'appel
       ou de protection. Ainsi « j'ai 17 ans » reste Jeunes / études. */
    if (/(?:appelle|appelez|composer|compose|joindre|contacter|numero|numéro|police|gendarmerie|au)\s+(?:le\s+)?(?:17|112|114|119)\b/.test(t)) {
      signaux.push("numero d urgence");
    }
    if (/(?:appelle|appelez|composer|compose|joindre|contacter|numero|numéro)\s+(?:le\s+)?3919\b/.test(t)) {
      signaux.push("numero 3919");
    }
    return [...new Set(signaux)];
  }

  function scoreSignaux(expressions, t) {
    const trouves = expressions.filter((expression) => contient(t, expression));
    if (!trouves.length) return null;

    const uniques = [...new Set(trouves.map(normaliser))];
    const plusLong = Math.max(...uniques.map(longueur));
    const fort = uniques.some((expression) => longueur(expression) >= 2 && !SIGNAUX_FAIBLES.has(expression));
    const plusieurs = uniques.length > 1;
    let score = plusLong >= 4 ? 0.88 : plusLong >= 2 ? 0.78 : 0.58;
    if (fort) score += 0.07;
    if (plusieurs) score += Math.min(0.12, 0.04 * (uniques.length - 1));
    return {
      score: Math.min(0.99, Math.round(score * 100) / 100),
      signaux: uniques,
    };
  }

  function calculer(texte) {
    const t = normaliser(texte);
    const urgences = signauxUrgence(t);
    const candidats = [];

    CATEGORIES.forEach((besoin) => {
      const expressions = LEXIQUE[besoin].slice();
      /* 17, 112, 114, 119 et 3919 sont des numéros, pas des catégories :
         « j'ai 17 ans » ne doit pas déclencher Sécurité. Ils ne deviennent
         des signaux qu'avec un verbe d'appel ou un contexte de protection. */
      if (besoin === "securite" &&
          (/(?:appelle|appelez|composer|compose|joindre|contacter|numero|police|gendarmerie|au)\s+(?:le\s+)?(?:17|112|114|119|3919)\b/.test(t) ||
           /^(?:17|112|114|119|3919)$/.test(t))) {
        expressions.push("17", "112", "114", "119", "3919");
      }
      let resultat = scoreSignaux(expressions, t);
      /* L'âge déclaré est un signal implicite de Jeunes / études, déjà pris
         en charge par l'ancien moteur Aide. Il ne doit toutefois pas annuler
         un besoin plus concret comme « pas de travail ». */
      if (besoin === "jeunes" && AGE_JEUNE.test(t)) {
        resultat = resultat || { score: 0, signaux: [] };
        resultat.score = Math.max(resultat.score, .68);
        resultat.signaux = [...new Set([...(resultat.signaux || []), "age jeune"])];
      }
      if (resultat) candidats.push({ besoin, ...resultat });
    });

    const precis = candidats.filter((c) => c.besoin !== "autre");
    const meilleurs = precis.length ? precis : candidats;
    const plusHaut = meilleurs.reduce((max, c) => Math.max(max, c.score), 0);
    const seuil = precis.length ? Math.max(0.58, plusHaut - 0.34) : 0.5;
    let besoins = meilleurs
      .filter((c) => c.score >= seuil)
      .sort((a, b) => b.score - a.score || CATEGORIES.indexOf(a.besoin) - CATEGORIES.indexOf(b.besoin))
      .map(({ besoin, score }) => ({ besoin, score }));

    /* `autre` est le filet de sécurité, mais il reste une déclaration du
       lexique comme les neuf autres catégories. Quand la phrase est
       exactement une expression déclarée sous `autre` et qu'elle correspond
       aussi à une catégorie plus précise (`orientation`, `besoin d'aide`, …),
       conserver cette deuxième lecture rend le contrat du dictionnaire
       vérifiable sans faire remonter « autre » dans les phrases plus longues.
       La règle est dérivée du lexique : elle ne recopie aucun mot ici. */
    const autreEstExpressionExacte = LEXIQUE.autre.some((expression) =>
      normaliser(expression) === t);
    if (precis.length && autreEstExpressionExacte) {
      const autre = candidats.find((c) => c.besoin === "autre");
      if (autre && !besoins.some((x) => x.besoin === "autre"))
        besoins = besoins.concat({ besoin: "autre", score: autre.score })
          .sort((a, b) => b.score - a.score || CATEGORIES.indexOf(a.besoin) - CATEGORIES.indexOf(b.besoin));
    }

    return {
      besoins,
      urgence: urgences.length ? {
        detectee: true,
        score: 0.99,
        signaux: urgences,
      } : null,
    };
  }

  function analyserBesoins(texte) {
    return calculer(texte);
  }

  function detecterBesoins(texte) {
    const analyse = calculer(texte);
    const liste = analyse.besoins.slice();
    /* La liste reste le contrat le plus simple demandé par l'interface. La
       propriété non énumérable conserve ce contrat tout en laissant l'urgence
       accessible directement (`detecterBesoins(t).urgence`). */
    Object.defineProperties(liste, {
      urgence: { value: analyse.urgence, enumerable: false },
      besoins: { value: liste, enumerable: false },
    });
    return liste;
  }

  function detecterUrgence(texte) {
    return calculer(texte).urgence;
  }

  root.AutourAideIntentions = Object.freeze({
    CATEGORIES,
    LIBELLES,
    LEXIQUE,
    URGENCES,
    normaliser,
    analyserBesoins,
    detecterBesoins,
    detecterUrgence,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
