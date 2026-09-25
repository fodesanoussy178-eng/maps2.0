/* ---------------------------------------------------------------------------
   COMPRENDRE UN MOT QU'ON N'A PAS PROGRAMMÉ

   LE DÉFAUT QUE CE FICHIER CORRIGE. `WORDINGS` disait à l'agent quoi
   chercher : « aide alimentaire », « épicerie solidaire », neuf entrées. Tout
   ce qui n'y figurait pas était invisible. Une ville qui organise une « Nuit
   des ateliers », un « Village des réparateurs » ou une « Journée du réemploi »
   n'existait pas pour Autour tant que personne n'avait tapé ces mots dans une
   constante.

   C'est le mauvais sens de lecture. Un territoire ne produit pas les
   catégories qu'on lui a prévues ; il produit ce qu'il produit, et c'est à
   nous de comprendre. Ce module fait donc l'inverse : il part du LIBELLÉ
   RÉEL et de ce que la page raconte, et il en déduit une famille.

   TROIS RÈGLES, ET ELLES SE TIENNENT

   1. LE LIBELLÉ ORIGINAL NE SE PERD JAMAIS. « Bourse aux jouets » reste
      « Bourse aux jouets ». On ajoute une famille pour pouvoir ranger et
      filtrer ; on ne remplace pas le nom que les gens emploient, qui est le
      seul qu'ils reconnaîtront sur une affiche.

   2. INCONNU N'EST PAS REJETÉ. Un libellé qu'aucun motif ne reconnaît
      redescend sur sa famille la plus générale — `evenement_local` — au lieu
      de disparaître. C'est exactement le cas que `WORDINGS` traitait par
      l'absence, et c'est celui qui compte : les formes nouvelles sont par
      définition celles qu'on n'a pas listées.

   3. ON REGROUPE LES SYNONYMES, ON NE FUSIONNE PAS LES CONCEPTS. Brocante,
      vide-grenier et puces désignent la même chose et partagent une famille.
      Un marché de créateurs et une brocante, non : on n'y va pas pour les
      mêmes raisons, et quelqu'un qui cherche l'un serait déçu de trouver
      l'autre. Une sous-catégorie par événement serait aussi inutile qu'aucune.
--------------------------------------------------------------------------- */

const DIACRITIQUES = /[̀-ͯ]/g;

export function normaliser(valeur) {
  return String(valeur || "").normalize("NFD").replace(DIACRITIQUES, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/* ---------------------------------------------------------------------------
   LES FAMILLES

   Volontairement peu nombreuses. Une famille sert à RANGER — filtrer une
   carte, remplir un onglet — pas à décrire. La description, c'est le libellé
   original qui la porte.

   Chaque sous-catégorie liste les formulations qui la désignent réellement.
   Ce ne sont pas des mots-clés de recherche : ce sont des SYNONYMES à
   reconnaître dans un nom d'événement déjà trouvé. La différence est tout le
   sujet — on n'a plus besoin de prévoir le mot pour trouver la chose, on en a
   besoin pour la ranger, et se tromper de rangement coûte beaucoup moins cher
   que de ne pas voir.
--------------------------------------------------------------------------- */
export const FAMILLES = Object.freeze({
  vente_occasion: {
    parent: "evenement_local",
    synonymes: ["brocante", "vide grenier", "vide greniers", "puces", "braderie",
      "deballage", "bourse aux jouets", "bourse aux vetements", "bourse aux livres",
      "troc", "vente de quartier", "foire a tout", "marche aux puces", "seconde main",
      "reemploi", "ressourcerie", "donnerie", "gratiferia"],
    tags: ["occasion", "local"],
    audiences: ["famille"],
  },
  marche_createurs: {
    parent: "evenement_local",
    synonymes: ["marche artisanal", "marche de createurs", "marche des createurs",
      "marche de noel", "marche nocturne", "marche gourmand", "marche du terroir",
      "salon des metiers d art", "village des artisans"],
    tags: ["artisanat", "local"],
  },
  marche_alimentaire: {
    parent: "evenement_local",
    synonymes: ["marche hebdomadaire", "marche alimentaire", "marche bio",
      "marche de producteurs", "marche fermier"],
    tags: ["alimentation", "local"],
  },
  fete_locale: {
    parent: "evenement_local",
    synonymes: ["fete de quartier", "fete locale", "fete communale", "ducasse",
      "kermesse", "fete foraine", "carnaval", "feu d artifice", "bal populaire",
      "guinguette", "fete des voisins", "fete de la musique"],
    tags: ["fete", "local"],
    audiences: ["famille"],
  },
  atelier_initiation: {
    parent: "culture_loisirs",
    synonymes: ["atelier", "initiation", "stage decouverte", "cours d essai",
      "demonstration", "atelier participatif", "fablab", "repair cafe",
      "village des reparateurs", "atelier reparation", "nuit des ateliers"],
    tags: ["apprendre", "participatif"],
  },
  projection_spectacle: {
    parent: "culture_loisirs",
    synonymes: ["projection", "seance de cinema", "cine plein air", "ciné club",
      "cine club", "spectacle", "concert", "theatre", "lecture", "conte",
      "exposition", "vernissage", "visite guidee", "portes ouvertes"],
    tags: ["culture"],
  },
  rencontre_associative: {
    parent: "vie_associative",
    synonymes: ["forum des associations", "assemblee generale", "rencontre associative",
      "journee portes ouvertes association", "benevolat", "appel a benevoles",
      "cafe associatif", "reunion publique", "conseil de quartier"],
    tags: ["association", "local"],
  },
  permanence_service: {
    parent: "service_public",
    synonymes: ["permanence", "accueil sur rendez vous", "consultation gratuite",
      "ecrivain public", "point justice", "permanence juridique", "permanence sociale",
      "accompagnement administratif"],
    tags: ["demarches"],
  },
  collecte_solidaire: {
    parent: "solidarite",
    synonymes: ["collecte", "collecte alimentaire", "banque alimentaire",
      "distribution alimentaire", "maraude", "don du sang", "collecte de jouets",
      "collecte de vetements", "epicerie solidaire", "repas solidaire"],
    tags: ["solidarite", "don"],
  },
  sport_participatif: {
    parent: "sport",
    synonymes: ["course", "trail", "randonnee", "marche populaire", "tournoi",
      "initiation sportive", "sport en famille", "cyclo", "vide ton sac sportif"],
    tags: ["sport"],
    audiences: ["famille"],
  },
});

/* Les indices qui trahissent une NATURE quand le libellé exact est inconnu.
   « Nuit des ateliers » contient « atelier » ; « Village des réparateurs »
   contient « reparateur ». On ne cherche pas le nom entier, on cherche ce que
   le nom dit. C'est ce qui permet de comprendre un mot jamais vu. */
const INDICES = Object.freeze([
  [/\b(brocante|puce|vide|troc|bourse|occasion|reemploi|ressourcerie|donnerie)\b/, "vente_occasion"],
  [/\b(createur|artisan|artisanal|terroir|nocturne)\b/, "marche_createurs"],
  [/\b(marche|halle)\b/, "marche_alimentaire"],
  [/\b(fete|ducasse|kermesse|carnaval|bal|guinguette|feu d artifice|foraine)\b/, "fete_locale"],
  [/\b(atelier|initiation|stage|fablab|repar|bricol|couture|jardinage)\b/, "atelier_initiation"],
  [/\b(projection|cinema|cine|spectacle|concert|theatre|exposition|expo|visite|conference|lecture|conte)\b/, "projection_spectacle"],
  [/\b(association|associatif|benevol|forum|conseil de quartier|reunion publique)\b/, "rencontre_associative"],
  [/\b(permanence|consultation|accompagnement|ecrivain public|juridique|administratif)\b/, "permanence_service"],
  [/\b(collecte|distribution|maraude|solidaire|don du sang|banque alimentaire)\b/, "collecte_solidaire"],
  [/\b(course|trail|randonnee|tournoi|sportif|sportive|marathon|cyclo)\b/, "sport_participatif"],
]);

/* Les publics, lus dans le texte plutôt que devinés.

   LE PLURIEL COMPTE, ET IL A DÉJÀ COÛTÉ UN TEST. `\benfant\b` ne reconnaît
   pas « enfants » : la frontière de mot tombe sur le « s ». « Atelier
   parents-enfants » ressortait donc sans public, ce qui est exactement
   l'inverse de ce qu'il annonce. Chaque motif tolère désormais sa marque
   du pluriel. */
const PUBLICS = Object.freeze([
  [/\b(familles?|familial(?:e|es|aux)?|parents? et enfants?|tout public)\b/, "famille"],
  [/\b(enfants?|jeunesses?|kids|petite enfance|ados?|adolescents?)\b/, "enfants"],
  [/\b(etudiants?|campus|universitaires?)\b/, "etudiants"],
  [/\b(seniors?|aines?|retraites?|troisieme age)\b/, "seniors"],
  [/\b(gratuits?|gratuite|entree libre|prix libre|sans inscription)\b/, "acces_libre"],
]);

/* ---------------------------------------------------------------------------
   RATTACHER

   `libelle` est le nom réel de la chose trouvée. `texte` est ce que la page
   en dit — il sert de second avis quand le nom seul ne suffit pas, ce qui est
   précisément le cas des noms inventés par une ville.

   Le résultat porte TOUJOURS `original_label`. `subcategory` peut être nulle :
   cela veut dire « on sait que c'est un événement local, on ne sait pas encore
   dire lequel ». C'est une réponse honnête, et elle vaut mieux qu'un rangement
   inventé ou qu'un rejet.
--------------------------------------------------------------------------- */
export function rattacher(libelle, texte) {
  const nom = normaliser(libelle);
  const contexte = normaliser(texte).slice(0, 4000);
  const ensemble = (nom + " " + contexte).trim();

  /* 1. Le synonyme exact, dans le NOM. C'est le rattachement le plus sûr :
        quelqu'un a écrit « vide-grenier », il s'agit d'un vide-grenier. */
  let famille = null;
  let parVoie = null;
  for (const [cle, def] of Object.entries(FAMILLES)) {
    if (def.synonymes.some((s) => nom.includes(normaliser(s)))) { famille = cle; parVoie = "synonyme_libelle"; break; }
  }

  /* 2. Sinon, ce que le nom SUGGÈRE. « Nuit des ateliers » n'est dans aucune
        liste, mais elle contient « atelier ». */
  if (!famille) {
    const indice = INDICES.find(([motif]) => motif.test(nom));
    if (indice) { famille = indice[1]; parVoie = "indice_libelle"; }
  }

  /* 3. Sinon, ce que la PAGE raconte. Un nom purement inventé — « Les
        Rendez-vous du 12 » — ne dit rien ; sa page, si. */
  if (!famille && contexte) {
    for (const [cle, def] of Object.entries(FAMILLES)) {
      if (def.synonymes.some((s) => contexte.includes(normaliser(s)))) { famille = cle; parVoie = "synonyme_page"; break; }
    }
    if (!famille) {
      const indice = INDICES.find(([motif]) => motif.test(contexte));
      if (indice) { famille = indice[1]; parVoie = "indice_page"; }
    }
  }

  const def = famille ? FAMILLES[famille] : null;
  const audiences = PUBLICS.filter(([motif]) => motif.test(ensemble)).map(([, nom_]) => nom_);

  return {
    /* Ce que les gens lisent sur l'affiche. Jamais réécrit. */
    original_label: String(libelle || "").trim(),
    /* INCONNU N'EST PAS REJETÉ : sans famille, on reste au parent le plus
       général plutôt que de rendre null et de laisser l'appelant jeter. */
    category_parent: def ? def.parent : "evenement_local",
    subcategory: famille,
    tags: [...new Set([...(def ? def.tags : []), ...(famille ? [] : ["type_a_qualifier"])])],
    audiences: [...new Set([...(def && def.audiences ? def.audiences : []), ...audiences])],
    /* Par où on l'a compris. Sans cela, on ne saurait pas distinguer un
       rattachement sûr d'une devinette sur le texte de la page. */
    rattachement: parVoie || "parent_par_defaut",
  };
}

/* ---------------------------------------------------------------------------
   LES QUESTIONS OUVERTES

   Elles ne nomment aucune catégorie — c'est le point. On demande ce qui se
   passe, pas si un vide-grenier a lieu. Ce que la ville répond définit le
   champ, au lieu que notre liste le borne d'avance.

   `WORDINGS` n'est pas supprimé pour autant : il reste utile comme amorce
   quand on sait déjà ce qu'on cherche (la solidarité, où l'exhaustivité prime
   sur la surprise). Il n'est simplement plus la frontière.
--------------------------------------------------------------------------- */
export function questionsOuvertes(ville, { horizon = "7 jours" } = {}) {
  const lieu = String(ville || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 100);
  if (!lieu) return [];
  return [
    `Que se passe-t-il à ${lieu} aujourd'hui ?`,
    `Que se passe-t-il à ${lieu} ce week-end ?`,
    `Quels événements temporaires ont lieu à ${lieu} dans les ${horizon} ?`,
    `Quelles activités locales sont proposées à ${lieu} prochainement ?`,
    `Quels événements gratuits ont lieu à ${lieu} cette semaine ?`,
    `Quelles activités familiales sont proposées à ${lieu} ?`,
    `Agenda des associations et maisons de quartier de ${lieu}`,
    `Marchés, brocantes et rendez-vous de quartier à ${lieu}`,
  ];
}
