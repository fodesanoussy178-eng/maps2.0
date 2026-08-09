(function (root) {
  "use strict";

  /* ===================================================================
     Comprendre une phrase, pas seulement des mots-clés

     La recherche savait déjà faire beaucoup : séparer une destination d'une
     intention (« cinéma Lille », « Lille restaurant indien »), reconnaître
     soixante cuisines, une trentaine de catégories, un budget écrit en
     chiffres ou en toutes lettres. Ce qu'elle ne savait pas faire, c'est
     comprendre une SITUATION : « un endroit calme où travailler », « je veux
     me poser dehors », « un truc romantique pas cher ce soir ».

     Ce module traduit une phrase en intention structurée. Il ne cherche rien
     et ne classe rien : il dit ce que la phrase demande. Le classement, lui,
     reste dans core.js.

     Deux principes tiennent tout le reste :

       · une ONTOLOGIE unique. Un synonyme s'ajoute à un seul endroit, et il
         vaut pour la recherche, les tests et les puces affichées. Multiplier
         les tables de correspondance, c'est garantir qu'elles divergeront ;

       · la séparation entre CONTRAINTE et PRÉFÉRENCE. « moins de 15 € » et
         « ouvert maintenant » excluent ; « plutôt calme » et « pas trop loin »
         ordonnent. Les mélanger produit soit des écrans vides, soit des
         résultats hors sujet. Et une donnée INCONNUE n'est jamais un « non » :
         un café dont on ignore s'il a du wifi n'est pas un café sans wifi.
     =================================================================== */

  const SIGNAUX = Object.freeze([
    "calme", "romantique", "festif", "famille", "travail", "etude",
    "dehors", "interieur", "wifi", "gratuit", "pas_cher", "accessible",
    "adapte_groupes", "adapte_solo",
  ]);

  /* ---- L'ontologie -------------------------------------------------------
     Pour chaque signal : comment les gens le disent, et ce que ça implique.
     `categories` liste les catégories de l'application que le signal désigne
     naturellement — c'est ce qui permet à « où bosser » de trouver une
     bibliothèque sans que personne n'ait tapé « bibliothèque ».

     `dur` marque les signaux qui, lorsqu'ils sont demandés explicitement,
     valent contrainte et non préférence : demander un lieu accessible en
     fauteuil n'est pas une envie. */
  const ONTOLOGIE = Object.freeze({
    travail: {
      label: "Travailler",
      mots: ["travailler", "travail", "bosser", "taffer", "taffe", "boulot",
             "coworking", "teletravail", "bureau", "laptop", "ordinateur",
             "avancer sur", "un peu de travail"],
      categories: ["coworking", "biblio", "cafe"],
      implique: ["calme"],
    },
    etude: {
      label: "Étudier",
      mots: ["etudier", "reviser", "revision", "revisions", "etude", "etudes",
             "bosser mes cours", "cours", "examen", "partiel", "partiels",
             "memoire", "these", "devoirs"],
      categories: ["biblio", "coworking", "cafe"],
      implique: ["calme"],
    },
    calme: {
      label: "Calme",
      mots: ["calme", "tranquille", "posé", "pose", "au calme", "silencieux",
             "silence", "chill", "peinard", "paisible", "reposant", "zen",
             "pas trop de monde", "sans bruit", "discret"],
      categories: ["biblio", "parc", "cafe", "musee"],
    },
    romantique: {
      label: "Romantique",
      mots: ["romantique", "date", "rencard", "rancard", "en couple", "couple",
             "a deux", "en amoureux", "amoureux", "tete a tete", "diner aux chandelles",
             "premier rendez vous"],
      categories: ["resto", "bar", "parc"],
      groupe: "couple",
    },
    festif: {
      label: "Festif",
      mots: ["faire la fete", "la fete", "fete", "danser", "danse", "ambiance",
             "sortir en boite", "boite", "clubbing", "teuf", "guincher",
             "musique forte", "dj", "soiree"],
      categories: ["bar", "concert", "spectacle", "event"],
    },
    famille: {
      label: "En famille",
      mots: ["famille", "en famille", "enfant", "enfants", "gosse", "gosses",
             "gamin", "gamins", "petits", "mes petits", "bebe", "poussette",
             "parents", "avec les enfants", "activite enfant"],
      categories: ["parc", "cinema", "musee", "biblio", "terrain"],
      groupe: "famille",
    },
    dehors: {
      label: "Dehors",
      mots: ["dehors", "exterieur", "en plein air", "plein air", "terrasse",
             "au soleil", "au vert", "prendre l air", "dans un parc", "en terrasse"],
      categories: ["parc", "terrain", "marche"],
    },
    interieur: {
      label: "À l’intérieur",
      mots: ["a l interieur", "interieur", "au chaud", "a l abri", "couvert",
             "il pleut", "sous la pluie", "au sec"],
      categories: ["musee", "biblio", "cinema", "cafe", "commerce"],
    },
    wifi: {
      label: "Wifi",
      mots: ["wifi", "wi fi", "internet", "connexion", "reseau"],
      dur: true,
    },
    accessible: {
      label: "Accessible",
      mots: ["accessible", "pmr", "fauteuil", "fauteuil roulant", "handicap",
             "mobilite reduite", "sans marche"],
      dur: true,
    },
    gratuit: {
      label: "Gratuit",
      mots: ["gratuit", "gratuite", "gratos", "sans payer", "sans argent",
             "rien depenser", "free", "libre acces", "entree libre", "fauche"],
      dur: true,
    },
    pas_cher: {
      label: "Pas cher",
      mots: ["pas cher", "pas chere", "abordable", "petit budget", "economique",
             "peu cher", "bon marche", "pas ruineux", "sans me ruiner", "cheap"],
    },
    adapte_solo: {
      label: "Seul",
      mots: ["seul", "seule", "tout seul", "toute seule", "solo", "en solo",
             "sans personne", "de mon cote"],
      groupe: "solo",
    },
    adapte_groupes: {
      label: "À plusieurs",
      mots: ["potes", "des potes", "avec des potes", "entre amis", "amis",
             "entre potes", "groupe", "en groupe", "a plusieurs", "bande",
             "collegues", "copains"],
      groupe: "amis",
    },
  });

  /* Ce que la phrase demande de FAIRE, quand ce n'est ni une catégorie ni une
     ambiance. « manger », « sortir », « boire un verre » : des intentions au
     sens de l'application. */
  const INTENTIONS = Object.freeze({
    manger: { label: "Manger",
      mots: ["manger", "bouffer", "diner", "dejeuner", "casser la croute",
             "restaurant", "resto", "un truc a manger", "grignoter", "brunch"],
      categories: ["resto", "fastfood", "cafe", "marche", "food"] },
    boire: { label: "Boire un verre",
      mots: ["boire", "un verre", "prendre un verre", "apero", "aperitif",
             "biere", "cocktail", "vin"],
      categories: ["bar", "cafe"] },
    sortir: { label: "Sortir",
      mots: ["sortir", "sortie", "faire quelque chose", "un truc a faire",
             "que faire", "quoi faire", "s occuper", "une activite", "activite"],
      categories: ["event", "concert", "spectacle", "cinema", "bar", "musee"] },
    poser: { label: "Se poser",
      mots: ["me poser", "se poser", "poser", "trainer", "glander", "buller",
             "souffler", "prendre le temps"],
      categories: ["cafe", "parc", "bar", "biblio"] },
    culture: { label: "Culture",
      mots: ["expo", "exposition", "musee", "culture", "galerie", "spectacle",
             "theatre", "concert", "film", "cinema"],
      categories: ["musee", "cinema", "spectacle", "concert"] },
    bouger: { label: "Bouger",
      mots: ["bouger", "sport", "courir", "footing", "nager", "transpirer",
             "s entrainer", "seance de sport"],
      categories: ["terrain", "sport", "parc"] },
  });

  /* ---- Horaires ---------------------------------------------------------- */
  const CRENEAUX_TEXTE = Object.freeze([
    [/\b(ce soir|cette soiree|tantot|apres le boulot|apres le travail)\b/, "soir"],
    [/\b(ce week[- ]?end|cette fin de semaine|samedi|dimanche)\b/, "weekend"],
    [/\b(demain|apres[- ]demain|la semaine prochaine|prochainement|plus tard|a venir|bientot)\b/, "avenir"],
    [/\b(maintenant|tout de suite|la tout de suite|dans l heure|immediatement)\b/, "maintenant"],
  ]);

  const TARD = /\b(tard|ouvert tard|apres minuit|nocturne|de nuit|la nuit|jusqu a pas d heure)\b/;
  const APRES_HEURE = /\bapres\s+(\d{1,2})\s*h(?:\s*(\d{2}))?\b/;
  const AVANT_HEURE = /\bavant\s+(\d{1,2})\s*h(?:\s*(\d{2}))?\b/;

  /* ---- Budget ------------------------------------------------------------
     Le montant est CONSERVÉ. L'ancienne version le traduisait en une pastille
     « petit budget » au-dessus de 0 € et en « gratuit » au-dessus de 20 € —
     si bien que « moins de 30 euros » demandait des lieux gratuits. */
  const NOMBRES = new Map(Object.entries({
    un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
    neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
    quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50,
    cent: 100, "vingt cinq": 25, "trente cinq": 35, "dix huit": 18, "dix sept": 17,
  }));

  const PROCHE = /\b(pres|proche|a cote|pas loin|dans le coin|du quartier|a pied|tout pres)\b/;

  function sansAccents(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, " ").replace(/[^a-z0-9€\s-]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function montant(t) {
    // « moins de 15€ », « max 30 euros », « -de 10 », « 15 balles »
    const chiffre = /(?:moins de|max(?:imum)?|jusqu a|sous|pas plus de|-\s*de)?\s*(\d{1,3})\s*(?:e\b|eur\b|euros?|€|balles?)/
      .exec(t);
    if (chiffre) return Number(chiffre[1]);
    const lettres = /([a-z ]{3,28})\s*(?:euros?|balles?|€)/.exec(t);
    if (!lettres) return null;
    const mots = lettres[1].trim().split(/\s+/);
    for (let d = Math.max(0, mots.length - 3); d < mots.length; d += 1) {
      const cle = mots.slice(d).join(" ");
      if (NOMBRES.has(cle)) return NOMBRES.get(cle);
    }
    return null;
  }

  /* Un mot de l'ontologie est reconnu sur les FRONTIÈRES de mots. Sans ça,
     « seul » se déclenchait dans « seulement » et « bar » dans « Bar-le-Duc ».
     C'est exactement le type de faux positif que ce module doit éviter. */
  /* Les mots qui ne désignent jamais un lieu. Sans eux, le découpage d'une
     requête sortait des « communes » comme « un endroit », « je veux » ou
     « soir » et partait les géocoder. Une ville, elle, n'est faite d'aucun de
     ces mots — c'est ce qui permet de les séparer sans liste de villes. */
  const MOTS_OUTILS = new RegExp("\\b(" + [
    "un", "une", "des", "de", "du", "d", "au", "aux", "a",
    "pour", "avec", "sans", "dans", "chez", "vers", "par", "sur",
    "ou", "et", "que", "qui", "quoi", "quelque", "chose", "truc", "trucs",
    "je", "j", "me", "moi", "on", "nous", "tu", "te", "veux", "voudrais",
    "cherche", "chercher", "trouver", "aller", "faire", "envie", "besoin",
    "endroit", "endroits", "lieu", "lieux", "coin", "spot", "plan",
    "soir", "soiree", "matin", "midi", "apres", "avant", "nuit", "journee",
    "aujourd", "hui", "demain", "samedi", "dimanche", "week", "end",
    "maintenant", "tard", "tot", "moins", "plus", "max", "maximum", "minimum",
    "est", "ce", "cette", "ces", "mon", "ma", "mes", "son", "sa", "ses",
  ].join("|") + ")\\b", "g");

  function nettoyer(t, consommes) {
    let reste = t;
    (consommes || []).forEach((m) => { reste = reste.split(sansAccents(m)).join(" "); });
    return reste.replace(MOTS_OUTILS, " ").replace(/\s+/g, " ").trim();
  }

  function contient(t, expression) {
    const e = sansAccents(expression);
    if (!e) return false;
    const i = t.indexOf(e);
    if (i < 0) return false;
    const avant = i === 0 ? " " : t[i - 1];
    const apres = i + e.length >= t.length ? " " : t[i + e.length];
    return /[\s-]/.test(avant) && /[\s-]/.test(apres);
  }

  function trouver(table, t) {
    const vus = [];
    Object.entries(table).forEach(([id, def]) => {
      // la plus longue expression gagne : « pas cher » avant « cher »
      const mot = (def.mots || []).slice().sort((a, b) => b.length - a.length)
        .find((m) => contient(t, m));
      if (mot) vus.push({ id, def, mot });
    });
    return vus;
  }

  /* ---- Le point d'entrée -------------------------------------------------
     `options.categorieDe(mot)` et `options.cuisineDe(mot)` viennent de
     l'application : le vocabulaire des catégories et des cuisines existe
     déjà, on ne le recopie pas ici. */
  function analyser(phrase, options) {
    const o = options || {};
    const brut = String(phrase == null ? "" : phrase);
    const t = sansAccents(brut);

    const intention = {
      zone: o.zone || null,
      categories: [],
      intentions: [],
      ambiance: [],
      budget: { max: null, gratuit: false, pasCher: false },
      horaire: { creneau: null, tard: false, apres: null, avant: null, ouvertMaintenant: false },
      groupe: null,
      contraintes: [],
      preferences: [],
      cuisine: null,
      reste: brut.trim(),
      chips: [],
    };
    if (!t) return intention;

    const cats = new Set();
    const consommes = [];
    const ajouterChip = (id, type, label) => {
      if (!intention.chips.some((c) => c.id === id)) intention.chips.push({ id, type, label });
    };

    // 1. ce que la phrase demande de faire
    trouver(INTENTIONS, t).forEach(({ id, def, mot }) => {
      intention.intentions.push(id);
      (def.categories || []).forEach((c) => cats.add(c));
      consommes.push(mot);
      ajouterChip("intention:" + id, "intention", def.label);
    });

    // 2. l'ambiance et les caractéristiques demandées
    trouver(ONTOLOGIE, t).forEach(({ id, def, mot }) => {
      consommes.push(mot);
      if (def.groupe && !intention.groupe) intention.groupe = def.groupe;
      if (id === "gratuit") { intention.budget.gratuit = true; return; }
      if (id === "pas_cher") { intention.budget.pasCher = true; return; }

      const poids = 1;
      intention.ambiance.push({ id, poids });
      (def.categories || []).forEach((c) => cats.add(c));
      (def.implique || []).forEach((autre) => {
        if (!intention.ambiance.some((a) => a.id === autre))
          intention.ambiance.push({ id: autre, poids: .6, implicite: true });
      });
      // un signal « dur » demandé explicitement devient une contrainte
      (def.dur ? intention.contraintes : intention.preferences)
        .push({ type: "signal", id, poids });
      ajouterChip("signal:" + id, def.dur ? "contrainte" : "ambiance", def.label);
    });

    /* 3. le vocabulaire déjà connu de l'application : catégories et cuisines.
       Cherché dans ce que l'ontologie n'a PAS consommé, et non dans la phrase
       entière : « un endroit calme où travailler » proposait sinon la
       catégorie « Emploi & droits », parce que le mot « travail » y figure.
       Un mot déjà compris comme une ambiance ne doit pas être relu comme une
       catégorie. */
    const disponible = nettoyer(t, consommes);
    if (typeof o.cuisineDe === "function") {
      const c = o.cuisineDe(disponible);
      if (c) { intention.cuisine = c; ajouterChip("cuisine:" + c, "cuisine", o.libelleCuisine ? o.libelleCuisine(c) : c); }
    }
    if (typeof o.categorieDe === "function") {
      const cat = o.categorieDe(disponible);
      if (cat) { cats.add(cat); ajouterChip("cat:" + cat, "categorie", (o.libelleCategorie && o.libelleCategorie(cat)) || cat); }
    }

    // 4. budget
    const n = montant(t);
    if (n != null) {
      intention.budget.max = n;
      intention.contraintes.push({ type: "budget", max: n });
      ajouterChip("budget:max", "contrainte", "≤ " + n + " €");
    } else if (intention.budget.gratuit) {
      intention.contraintes.push({ type: "budget", max: 0 });
      ajouterChip("budget:gratuit", "contrainte", "Gratuit");
    } else if (intention.budget.pasCher) {
      intention.preferences.push({ type: "signal", id: "pas_cher", poids: 1 });
      ajouterChip("signal:pas_cher", "ambiance", "Pas cher");
    }

    // 5. horaires
    for (const [motif, id] of CRENEAUX_TEXTE) {
      if (motif.test(t)) { intention.horaire.creneau = id; break; }
    }
    if (TARD.test(t)) intention.horaire.tard = true;
    const ap = APRES_HEURE.exec(t);
    if (ap) intention.horaire.apres = Number(ap[1]) * 60 + Number(ap[2] || 0);
    const av = AVANT_HEURE.exec(t);
    if (av) intention.horaire.avant = Number(av[1]) * 60 + Number(av[2] || 0);
    if (intention.horaire.creneau === "maintenant") intention.horaire.ouvertMaintenant = true;

    if (intention.horaire.creneau)
      ajouterChip("creneau:" + intention.horaire.creneau, "horaire",
        { maintenant: "Maintenant", soir: "Ce soir", weekend: "Ce week-end", avenir: "À venir" }[intention.horaire.creneau]);
    if (intention.horaire.apres != null) {
      intention.contraintes.push({ type: "ouvertApres", minutes: intention.horaire.apres });
      ajouterChip("horaire:apres", "contrainte", "Après " + Math.floor(intention.horaire.apres / 60) + "h");
    } else if (intention.horaire.tard) {
      intention.contraintes.push({ type: "ouvertApres", minutes: 21 * 60 });
      ajouterChip("horaire:tard", "contrainte", "Ouvert tard");
    }

    // 6. proximité — une préférence, jamais une contrainte
    if (PROCHE.test(t)) {
      intention.preferences.push({ type: "proche", poids: 1 });
      ajouterChip("proche", "ambiance", "Tout près");
    }

    // 7. zone
    if (intention.zone) intention.chips.unshift({ id: "zone", type: "zone", label: intention.zone });

    intention.categories = [...cats];

    /* Ce qui n'a été reconnu par personne. C'est la matière de la recherche
       sémantique à venir : tant qu'elle n'existe pas, ce reste sert de
       requête plein texte, et surtout il est mesurable. */
    intention.reste = nettoyer(t, consommes);

    return intention;
  }

  /* Ce fragment est-il du VOCABULAIRE de l'application plutôt qu'un lieu ?
     Question posée par le découpage d'une requête : « un endroit calme où
     travailler » se coupait en destination « où travailler », et « où bosser
     avec wifi après 20h » en destination « 20h ». Le géocodeur, sollicité sur
     ces morceaux, renvoyait n'importe quoi ou rien — et la carte partait.

     Un fragment est du vocabulaire s'il est entièrement compris et qu'il ne
     reste rien derrière. « Lille » n'est compris par personne : ce n'est pas
     du vocabulaire, donc ça peut être un lieu. */
  const HEURE_SEULE = /^\s*(\d{1,2})\s*h\s*(\d{2})?\s*$/;

  function estVocabulaire(fragment, options) {
    const t = sansAccents(fragment);
    if (!t) return true;
    if (HEURE_SEULE.test(t)) return true;            // « 20h » n'est pas une ville
    if (/^\d+\s*(e|eur|euros?|€|balles?)?$/.test(t)) return true;
    /* Un fragment est du vocabulaire dès qu'il ne reste RIEN une fois retirés
       les mots compris et les mots outils. « un endroit » et « je veux » ne
       sont pas des intentions — mais ce ne sont pas des lieux non plus, et
       c'est la seule chose qui importe ici. */
    const st = analyser(fragment, options || {});
    const reste = st.reste;
    if (!reste) return true;
    if (HEURE_SEULE.test(reste)) return true;
    // « faire la » laissait « la » : un fragment sans le moindre mot de trois
    // lettres ne nomme aucun endroit
    return reste.split(" ").every((mot) => mot.length < 3);
  }

  /* Une intention est-elle exploitable ? Sans ça, une phrase entièrement
     incomprise déclencherait un filtrage vide et un écran blanc. */
  function estExploitable(intention) {
    if (!intention) return false;
    return !!(intention.categories.length || intention.intentions.length
      || intention.ambiance.length || intention.cuisine
      || intention.budget.max != null || intention.budget.gratuit
      || intention.horaire.creneau || intention.contraintes.length);
  }

  /* Retirer une interprétation : l'utilisateur doit pouvoir dire « non, pas
     ça ». On reconstruit une intention amputée plutôt que de re-parser, pour
     que le retrait soit exactement ce qu'il annonce. */
  function sansChip(intention, id) {
    const copie = JSON.parse(JSON.stringify(intention));
    copie.chips = copie.chips.filter((c) => c.id !== id);
    const [type, valeur] = String(id).split(":");

    if (type === "zone") copie.zone = null;
    if (type === "cat") copie.categories = copie.categories.filter((c) => c !== valeur);
    if (type === "cuisine") copie.cuisine = null;
    if (type === "intention") {
      copie.intentions = copie.intentions.filter((i) => i !== valeur);
      const def = INTENTIONS[valeur];
      if (def) copie.categories = copie.categories.filter((c) => !(def.categories || []).includes(c));
    }
    if (type === "signal") {
      copie.ambiance = copie.ambiance.filter((a) => a.id !== valeur);
      copie.contraintes = copie.contraintes.filter((c) => c.id !== valeur);
      copie.preferences = copie.preferences.filter((p) => p.id !== valeur);
      if (valeur === "pas_cher") copie.budget.pasCher = false;
    }
    if (type === "budget") {
      copie.budget = { max: null, gratuit: false, pasCher: false };
      copie.contraintes = copie.contraintes.filter((c) => c.type !== "budget");
    }
    if (type === "creneau") copie.horaire.creneau = null;
    if (type === "horaire") {
      copie.horaire.tard = false; copie.horaire.apres = null;
      copie.contraintes = copie.contraintes.filter((c) => c.type !== "ouvertApres");
    }
    if (type === "proche") copie.preferences = copie.preferences.filter((p) => p.type !== "proche");
    return copie;
  }

  /* ---- Le journal de ce qui n'est pas compris -----------------------------
     Pour savoir quels synonymes ajouter, il faut savoir ce que les gens
     écrivent et que l'ontologie rate. On ne journalise donc QUE `reste` —
     le résidu, une fois retirés les mots compris et les mots outils — et
     jamais la phrase entière.

     Trois garde-fous, parce qu'un résidu peut contenir un nom propre :
       · rien ne quitte l'appareil. Le journal vit en localStorage, il n'est
         envoyé nulle part, et il n'y a pas de serveur pour le recevoir ;
       · on compte les occurrences, on ne garde pas d'horodatage précis ni
         d'ordre — un journal n'est pas un historique de navigation ;
       · un fragment qui ressemble à un identifiant (chiffres, arobase,
         adresse) n'est pas retenu du tout.

     Ce qu'on en fait : `AutourComprendre.journalReste()` rend le décompte,
     trié. C'est la mesure qui dira si le parser suffit ou non. */
  const CLE_JOURNAL = "autour.restes";
  const JOURNAL_MAX = 200;                 // entrées distinctes conservées
  const RESTE_MAX = 40;                    // caractères par fragment

  // ce qui ne doit jamais entrer dans le journal
  const SENSIBLE = /\d|@|https?:|\brue\b|\bavenue\b|\bboulevard\b|\bimpasse\b|\bplace\b/;

  function lireJournal() {
    try {
      const brut = root.localStorage && root.localStorage.getItem(CLE_JOURNAL);
      const j = brut ? JSON.parse(brut) : null;
      return j && typeof j === "object" ? j : {};
    } catch (e) { return {}; }
  }

  function noterReste(reste) {
    const brut = String(reste == null ? "" : reste);
    // on regarde le texte AVANT normalisation : `sansAccents` retire « @ » et
    // les points, ce qui aurait laissé passer une adresse électronique
    if (SENSIBLE.test(brut.toLowerCase())) return false;
    const t = sansAccents(brut);
    if (!t || t.length < 3 || t.length > RESTE_MAX) return false;
    if (SENSIBLE.test(t)) return false;
    const journal = lireJournal();
    journal[t] = (journal[t] || 0) + 1;
    const cles = Object.keys(journal);
    if (cles.length > JOURNAL_MAX) {
      // on garde les plus fréquents : ce sont eux qui méritent un synonyme
      const tries = cles.sort((a, b) => journal[b] - journal[a]).slice(0, JOURNAL_MAX);
      const reduit = {};
      tries.forEach((c) => { reduit[c] = journal[c]; });
      try { root.localStorage.setItem(CLE_JOURNAL, JSON.stringify(reduit)); } catch (e) {}
      return true;
    }
    try { root.localStorage.setItem(CLE_JOURNAL, JSON.stringify(journal)); } catch (e) {}
    return true;
  }

  function journalReste() {
    const journal = lireJournal();
    return Object.entries(journal)
      .map(([fragment, n]) => ({ fragment, n }))
      .sort((a, b) => b.n - a.n || a.fragment.localeCompare(b.fragment));
  }

  function viderJournalReste() {
    try { root.localStorage.removeItem(CLE_JOURNAL); } catch (e) {}
  }

  root.AutourComprendre = Object.freeze({
    SIGNAUX, ONTOLOGIE, INTENTIONS,
    sansAccents, montant, contient,
    analyser, estExploitable, estVocabulaire, sansChip,
    noterReste, journalReste, viderJournalReste,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
