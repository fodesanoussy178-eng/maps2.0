(function (root) {
  "use strict";

  /* ===================================================================
     CLASSER UNE STRUCTURE — DANS CET ORDRE, ET PAS UN AUTRE

     LA RÈGLE QUI MANQUAIT

     Autour ne doit JAMAIS décider qu'un lieu est une structure d'aide parce
     qu'un mot apparaît dans son nom. C'est tout. Le reste de ce fichier n'est
     que la mise en œuvre de cette phrase.

     L'ORDRE D'EXAMEN, ET POURQUOI IL EST DANS CE SENS

       1. le TYPE réel du lieu          ce qu'il EST
       2. les CATÉGORIES d'Autour       ce que nos données en disent
       3. les TAGS OpenStreetMap        ce que la carte en dit
       4. les SERVICES déclarés         ce qu'il fait
       5. la DESCRIPTION                ce qu'il dit de lui-même
       6. les SOURCES institutionnelles ce qu'une institution en dit
       7. le NOM                        comment il s'appelle

     Le nom est en dernier, et il pèse le moins. Ce n'est pas un détail de
     réglage : c'est l'inversion exacte de ce qui produisait

       VIENNOISERIE ROYALE CROIX ROUGE → aide alimentaire certaine

     UNE STRUCTURE A DES CAPACITÉS, PAS UNE CATÉGORIE

     On ne demande plus « à quelle case appartient ce lieu ? » mais « que
     peut-il, pour quelqu'un qui a besoin d'aide ? ». Une mission locale peut
     travail + jeunes + papiers. Une association pour victimes peut sécurité +
     écoute + hébergement. C'est le même objet, vu par plusieurs besoins.

     CE QUE CE FICHIER NE FAIT PAS

     Il ne lit pas la taxonomie « en gros » : il l'applique littéralement.
     Ajouter un tag ou une exclusion se fait dans `aide-taxonomie.js`, et rien
     ici ne bouge. Il ne connaît ni le DOM, ni la carte, ni le réseau.
     =================================================================== */

  const TAXO = root.AutourAideTaxonomie;

  /* ===================================================================
     1. CE QUE VAUT CHAQUE PREUVE

     Les poids ne sont pas des réglages libres : ils encodent la règle du
     produit. Une preuve structurelle porte à elle seule au-delà du seuil ;
     aucune accumulation de preuves nominales n'y arrive.
     =================================================================== */
  const POIDS = Object.freeze({
    /* Ce que le lieu EST. Une preuve certaine passe seule. */
    tagCertain:      60,
    tagFort:         40,
    tagFaible:       18,
    categorieCertaine: 55,
    categorieForte:  40,
    categorieFaible: 20,
    /* Ce qu'il FAIT, déclaré explicitement. Aussi fort qu'un type. */
    service:         55,
    /* Le type de structure est la preuve décisive pour Logement. Un nom
       reconnu sur une catégorie sociale reste volontairement moins fort qu'un
       champ ou un tag qui donne le type. */
    typeStructure:   70,
    typeNom:         45,
    /* Ce qu'une institution en dit. */
    institutionnel:  50,
    /* Ce qu'il dit de lui-même : utile, jamais décisif seul. */
    description:     25,
    /* Comment il s'appelle. Faible, et c'est le fond du sujet.

       DEUX POIDS POUR UN NOM, ET LA DIFFÉRENCE EST TOUTE LA RÈGLE.

       Un réseau national reconnu dans le nom — « Action Logement », « ADIL »,
       « Mission Locale » — est une information réelle. Mais elle ne vaut que
       si quelque chose d'autre la CORROBORE : une catégorie compatible, un
       tag, un service. Seule, elle ne dépasse jamais le seuil, et c'est
       exactement ce qui doit arriver à une viennoiserie qui porte le nom
       d'une organisation humanitaire.

       Corroborer n'est pas contredire : une structure dont le type CONTREDIT
       le besoin est écartée bien avant, par les exclusions. */
    reseauNom:       12,
    /* 35 et non 30 : la valeur avait été calibrée quand une catégorie déduite
       des tags ajoutait encore ses points par-dessus le tag dont elle sortait.
       En supprimant cet écho, on a retiré une vingtaine de points à TOUS les
       lieux OpenStreetMap — et une Mission locale tagguée `office=employment_agency`
       tombait à 48 sur « Jeunes / études », deux points sous le seuil, alors
       que le réseau est par définition celui des 16-25 ans.

       Relever ce poids ne rouvre pas la porte à la viennoiserie : ce qui
       interdit à un nom de classer seul n'est pas son poids, c'est
       `structurelle` — sans une preuve venue d'ailleurs, le verdict est
       REFUS.NOM_SEUL quel que soit le barème. */
    reseauNomCorrobore: 35,
    motNom:           8,
  });

  /* Au-dessus, la structure est proposée. En dessous, elle ne l'est pas —
     même si l'on en a « un peu » l'impression. Mieux vaut deux structures
     fiables que dix douteuses. */
  const SEUIL = 50;

  /* Les preuves qui viennent du NOM, et elles seules. Isolées ici parce que
     c'est sur cette liste que porte la règle la plus importante du fichier. */
  const NOMINALES = Object.freeze(["reseauNom", "motNom"]);

  const LOGEMENT_REFUS = Object.freeze({
    TYPE_NON_LOGEMENT: "type_non_logement",
    PUBLIC_INCOMPATIBLE: "public_incompatible",
    PUBLIC_INCONNU: "public_inconnu",
  });

  const REFUS = Object.freeze({
    NOM_SEUL:    "nom_seul",
    EXCLUSION:   "exclusion",
    SOUS_SEUIL:  "sous_seuil",
    TYPE_NON_LOGEMENT: LOGEMENT_REFUS.TYPE_NON_LOGEMENT,
    PUBLIC_INCOMPATIBLE: LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE,
    PUBLIC_INCONNU: LOGEMENT_REFUS.PUBLIC_INCONNU,
    AUCUNE:      "aucune_preuve",
  });

  /* ===================================================================
     2. LIRE UN LIEU SANS RIEN SUPPOSER
     =================================================================== */
  function texteSansAccents(valeur) {
    const C = root.AutourComprendre;
    if (C && C.sansAccents) return C.sansAccents(valeur);
    return String(valeur == null ? "" : valeur).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, " ").replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  const tagsDe = (lieu) => (lieu && lieu.tags) || {};

  const nomDe = (lieu) =>
    String((lieu && (lieu.titre || lieu.title || lieu.name)) || "");

  /* La description, l'adresse et le nom NE SONT PAS mélangés. Une première
     version les concaténait — c'est très exactement ce qui donnait au nom le
     pouvoir d'une donnée. */
  const descriptionDe = (lieu) => {
    const l = lieu || {};
    return [l.description, l.note, tagsDe(l).description, tagsDe(l).note]
      .filter(Boolean).join(" ");
  };

  /* Les catégories d'Autour, quelle que soit leur provenance. */
  function categoriesDe(lieu) {
    const l = lieu || {};
    return new Set([l.cat, ...(l.categories || [])].filter(Boolean));
  }

  /* Les services DÉCLARÉS. Trois provenances, toutes explicites — aucune n'est
     déduite d'un texte libre. `social_facility:for` est le tag qui dit à QUI
     une structure s'adresse : c'est la donnée la plus utile du secteur social
     dans OpenStreetMap, et elle était totalement ignorée. */
  function servicesDe(lieu) {
    const l = lieu || {};
    const tags = tagsDe(l);
    const brut = []
      .concat(Array.isArray(l.services) ? l.services : [])
      .concat(l.service ? [l.service] : [])
      .concat(String(tags["social_facility:for"] || "").split(";"))
      .concat(String(tags.service || "").split(";"))
      .concat(String(tags.social_facility || "").split(";"));
    return new Set(brut.map((s) => texteSansAccents(s)).filter(Boolean));
  }

  /* Une source institutionnelle : un catalogue public, une collectivité, un
     partenaire déclaré. Jamais « le site a l'air officiel ». */
  const SOURCES_INSTITUTIONNELLES = Object.freeze(
    ["datatourisme", "contexte_officiel", "institutionnel", "organisateur",
     "data_gouv", "data_inclusion", "partenaire"]);

  function estInstitutionnel(lieu) {
    const l = lieu || {};
    const sources = [].concat(l.sources || [], l.source || [], l.primary_source || [])
      .map((s) => String(s).toLowerCase());
    if (sources.some((s) => SOURCES_INSTITUTIONNELLES.includes(s))) return true;
    /* Un enrichissement vérifié dont la provenance est officielle : c'est le
       calque de `place_enrichments`, et il a déjà passé l'examen de
       provenance côté serveur. */
    const v = l.verifie;
    return !!(v && v.priorite && v.priorite !== "tiers");
  }

  /* ===================================================================
     3. ONTOLOGIE LOGEMENT

     `cat=hebergement` est une famille de collecte, pas le type réel d'une
     structure. Un `social_facility=group_home` peut être un foyer ; un SIAO,
     un CCAS, un AVDL ou un FSL peuvent aider à trouver ou garder un logement
     sans héberger personne. On garde donc une description dédiée, utilisable
     par le verdict et par le tri, au lieu de faire passer toute cette famille
     par la même porte.
     =================================================================== */
  const TYPES_LOGEMENT = TAXO.TYPES_LOGEMENT || {};
  const CATEGORIES_AIDE_STRUCTURELLES = new Set([
    "hebergement", "asso", "mairie", "emploi", "sante", "securite",
    "alimentaire", "collecte", "toilettes", "friperie",
  ]);

  function listeValeur(lieu, noms) {
    const l = lieu || {};
    for (const nom of noms) {
      if (l[nom] != null && l[nom] !== "")
        return Array.isArray(l[nom]) ? l[nom].slice() : [l[nom]];
    }
    return null;
  }

  function boolValeur(valeur) {
    if (typeof valeur === "boolean") return valeur;
    if (valeur == null || valeur === "") return null;
    const v = texteSansAccents(valeur);
    if (["yes", "oui", "true", "1", "libre", "ouvert"].includes(v)) return true;
    if (["no", "non", "false", "0", "ferme", "fermee", "sur orientation"].includes(v)) return false;
    return null;
  }

  function boolChamp(lieu, noms, tagNoms) {
    const l = lieu || {};
    for (const nom of noms) {
      if (l[nom] != null && l[nom] !== "") {
        const v = boolValeur(l[nom]);
        if (v !== null) return v;
      }
    }
    const tags = tagsDe(lieu);
    for (const nom of tagNoms || []) {
      if (tags[nom] != null && tags[nom] !== "") {
        const v = boolValeur(tags[nom]);
        if (v !== null) return v;
      }
    }
    return null;
  }

  function premierValeur(valeur) {
    if (Array.isArray(valeur)) {
      const v = valeur.find((x) => x != null && x !== "");
      return v == null ? null : premierValeur(v);
    }
    if (valeur && typeof valeur === "object")
      return premierValeur(valeur.valeur ?? valeur.value ?? valeur.numero ?? null);
    return valeur == null || valeur === "" ? null : valeur;
  }

  function horairesDe(lieu) {
    const l = lieu || {};
    const valeur = l.horaires ?? l.horaire ?? l.quand ?? l.opening_hours ??
      (l.tags && l.tags.opening_hours) ?? null;
    if (valeur == null || valeur === "") return null;
    if (Array.isArray(valeur)) {
      if (!valeur.length || valeur.every((v) => v == null || v === "")) return null;
      if (valeur.length === 1 && valeur[0] === "Voir sur place") return null;
      return valeur.slice();
    }
    return valeur === "Voir sur place" ? null : valeur;
  }

  function valeurTypeLogement(valeur) {
    const cle = texteSansAccents(valeur).replace(/[\s-]+/g, " ").trim();
    if (!cle) return null;
    for (const [type, definition] of Object.entries(TYPES_LOGEMENT)) {
      const alias = [type, ...(definition.aliases || [])]
        .map((x) => texteSansAccents(x).replace(/[\s-]+/g, " ").trim());
      if (alias.includes(cle)) return type;
    }
    return null;
  }

  function contientExpression(texte, expression) {
    const t = " " + texteSansAccents(texte).replace(/[\s-]+/g, " ").trim() + " ";
    const e = " " + texteSansAccents(expression).replace(/[\s-]+/g, " ").trim() + " ";
    return e.length > 2 && t.includes(e);
  }

  function typeParTexteLogement(lieu) {
    const l = lieu || {};
    const texte = [nomDe(lieu), ...(Array.isArray(l.aliases) ? l.aliases : [])]
      .concat([l.description, l.note]).filter(Boolean).join(" ");
    const candidats = Object.entries(TYPES_LOGEMENT)
      .flatMap(([type, definition]) => [type, ...(definition.aliases || [])]
        .map((alias) => ({ type, alias })))
      .sort((a, b) => String(b.alias).length - String(a.alias).length);
    const trouve = candidats.find((c) => contientExpression(texte, c.alias));
    return trouve ? trouve.type : null;
  }

  function categorieLogementDocumentee(lieu) {
    const valeurs = listeValeur(lieu, ["aidCategories", "aid_categories",
      "categoriesAide", "categories_aide"]) || [];
    return valeurs.some((v) => ["logement", "hebergement", "housing aid",
      "housing assistance"].includes(texteSansAccents(v).replace(/[\s-]+/g, " ")));
  }

  function estContexteLogement(lieu) {
    const l = lieu || {};
    const cats = categoriesDe(l);
    const tags = tagsDe(l);
    const source = estInstitutionnel(l);
    return cats.has("hebergement") || categorieLogementDocumentee(l) || source ||
      !!tags.social_facility || tags.amenity === "social_facility" ||
      !!l.type_structure || !!l.typeStructure ||
      !!l.service_type || !!l.serviceType;
  }

  function typeStructureDe(lieu) {
    const l = lieu || {};
    const champs = ["type_structure", "typeStructure", "service_type", "serviceType",
      "institutionalType", "institutional_type"];
    for (const nom of champs) {
      const valeur = valeurTypeLogement(l[nom]);
      if (valeur) return { type: valeur, preuve: "champ", structurelle: true };
    }

    const tags = tagsDe(lieu);
    const social = texteSansAccents(tags.social_facility);
    const amenity = texteSansAccents(tags.amenity);
    if (["shelter", "homeless_shelter", "emergency_shelter"].includes(social))
      return { type: "hebergement_urgence", preuve: "tag", structurelle: true };
    if (social === "group_home")
      return { type: "foyer", preuve: "tag", structurelle: true };
    if (social === "assisted_living")
      return { type: "logement_accompagne", preuve: "tag", structurelle: true };
    if (social === "day_centre")
      return { type: "accueil_de_jour", preuve: "tag", structurelle: true };
    if (["refugee_site", "dormitory"].includes(amenity))
      return { type: "hebergement_urgence", preuve: "tag", structurelle: true };

    const parNom = typeParTexteLogement(lieu);
    if (!parNom) return null;
    /* Les dispositifs d'orientation peuvent être classés comme `asso` ou
       `mairie` sans porter la catégorie `hebergement`. Leur nom explicite est
       alors la seule porte d'entrée ; il ne transforme pas pour autant un
       autre équipement social en logement. */
    if (!estContexteLogement(lieu) &&
        !["siao", "ccas", "fsl", "avdl", "intermediation_locative",
          "logement_accompagne"].includes(parNom))
      return null;
    const cats = categoriesDe(lieu);
    const structurelle = [...cats].some((cat) => CATEGORIES_AIDE_STRUCTURELLES.has(cat)) ||
      estInstitutionnel(lieu) || categorieLogementDocumentee(lieu);
    return { type: parNom, preuve: "nom", structurelle };
  }

  function confianceExplicite(lieu) {
    const l = lieu || {};
    const brut = l.confidence ?? l.confiance ?? l.confidenceAide;
    const n = Number(brut);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
  }

  function sourceDe(lieu) {
    const l = lieu || {};
    return premierValeur(l.source ?? l.par ?? l.sources ?? l.primary_source ?? null);
  }

  function decrireLogement(lieu) {
    const l = lieu || {};
    const type = typeStructureDe(lieu);
    const definition = type ? TYPES_LOGEMENT[type.type] : null;
    const besoins = listeValeur(lieu, ["besoins_servis", "besoinsServis"]);
    const publics = listeValeur(lieu, ["public_admis", "publicAdmis", "publics_admis",
      "publicsAdmis", "public", "publics"]);
    const horaires = horairesDe(lieu);
    const acces = boolChamp(lieu, ["acces_libre", "accesLibre", "accessLibre",
      "open_to_public"], ["access"]);
    const orientation = boolChamp(lieu, ["orientation_requise", "orientationRequise",
      "referral_required", "admission_required"], ["referral"]);
    const urgence = boolChamp(lieu, ["urgence_possible", "urgencePossible"], ["emergency"]);
    const effectif = boolChamp(lieu, ["hebergement_effectif", "hebergementEffectif",
      "accommodation_available"], []);
    const typeConfidence = type
      ? type.preuve === "champ" ? 1 : type.preuve === "tag" ? .85 : .65 : null;
    return {
      type_structure: type ? type.type : null,
      besoins_servis: besoins || (definition ? definition.besoins_servis : null),
      public_admis: publics || (definition ? definition.public_admis : null),
      acces_libre: acces !== null ? acces : (definition ? definition.acces_libre : null),
      orientation_requise: orientation !== null ? orientation
        : (definition ? definition.orientation_requise : null),
      urgence_possible: urgence !== null ? urgence : (definition ? definition.urgence_possible : null),
      hebergement_effectif: effectif !== null ? effectif
        : (definition ? definition.hebergement_effectif : null),
      horaires: horaires === "Voir sur place" ? null : horaires,
      telephone: premierValeur(l.telephone ?? l.tel ?? (l.tags && l.tags.phone) ?? null),
      source: sourceDe(l),
      confidence: confianceExplicite(l) ?? typeConfidence,
      fonction: definition ? definition.fonction : null,
      age_admis: definition ? definition.age_admis || null : null,
    };
  }

  function texteProfil(profil) {
    const p = profil || {};
    return texteSansAccents([p.public, p.public_admis, p.situation, p.situations,
      p.statut, p.genre, p.besoins].flat().filter(Boolean).join(" "));
  }

  function profilLogement(profil) {
    const p = profil || {};
    const t = texteProfil(p);
    const age = Number.isFinite(Number(p.age)) ? Number(p.age) : null;
    return {
      age,
      jeune: (age != null && age >= 16 && age <= 30) || /\bjeune|etudiant|etudiante\b/.test(t),
      adulte: (age != null && age >= 18) || /\badulte|majeur|majeure\b/.test(t),
      parent: p.parent === true || p.parents === true || /\b(?:parent|mere|pere|famille)\b/.test(t),
      enfant: p.enfant === true || p.children === true || /\benfant|bebe|adolescent|mineur\b/.test(t),
      enceinte: p.enceinte === true || p.pregnant === true || /\benceinte|grossesse\b/.test(t),
    };
  }

  function compatibilitePublic(type, profil) {
    if (["centre_parental", "centre_maternel"].includes(type)) {
      if (!profil) return { statut: null, refus: LOGEMENT_REFUS.PUBLIC_INCONNU };
      const p = profilLogement(profil);
      if (type === "centre_parental")
        return p.parent && p.enfant
          ? { statut: true, refus: null }
          : { statut: false, refus: LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE };
      return p.enceinte || p.parent && p.enfant
        ? { statut: true, refus: null }
        : { statut: false, refus: LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE };
    }
    if (["foyer_jeunes_travailleurs", "residence_habitat_jeunes"].includes(type)) {
      if (!profil) return { statut: null, refus: null };
      const p = profilLogement(profil);
      if (p.age != null)
        return p.age >= 16 && p.age <= 30
          ? { statut: true, refus: null }
          : { statut: false, refus: LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE };
      return p.jeune ? { statut: true, refus: null }
        : { statut: false, refus: LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE };
    }
    if (["chrs", "residence_sociale", "maison_relais", "pension_de_famille"].includes(type)) {
      if (!profil) return { statut: null, refus: null };
      const p = profilLogement(profil);
      if (p.age != null && p.age < 18)
        return { statut: false, refus: LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE };
    }
    return { statut: true, refus: null };
  }

  function compatibiliteLogement(lieu, options) {
    const info = decrireLogement(lieu);
    if (!info.type_structure) return { info, statut: null, refus: null };
    const type = TYPES_LOGEMENT[info.type_structure];
    if (!type || !info.besoins_servis || !info.besoins_servis.includes("logement"))
      return { info, statut: false, refus: LOGEMENT_REFUS.TYPE_NON_LOGEMENT };
    const profil = options && (options.profil || options.profile);
    const publicite = compatibilitePublic(info.type_structure, profil);
    return { info, statut: publicite.statut, refus: publicite.refus };
  }

  /* ===================================================================
     3. LES PREUVES, UNE PAR UNE
     =================================================================== */
  function preuveTag(tag, tags) {
    const valeur = tags[tag.cle];
    if (valeur == null || valeur === "") return null;
    /* `["*"]` : la clé seule suffit. `healthcare:counselling` ne se pose pas
       sur autre chose qu'une structure d'écoute. */
    if (tag.valeurs.includes("*")) return tag.preuve;
    const lues = String(valeur).split(";").map((v) => v.trim().toLowerCase());
    return tag.valeurs.some((v) => lues.includes(v)) ? tag.preuve : null;
  }

  function poidsDeTag(preuve) {
    if (preuve === TAXO.PREUVE.CERTAINE) return POIDS.tagCertain;
    if (preuve === TAXO.PREUVE.FORTE) return POIDS.tagFort;
    return POIDS.tagFaible;
  }

  function poidsDeCategorie(preuve) {
    if (preuve === TAXO.PREUVE.CERTAINE) return POIDS.categorieCertaine;
    if (preuve === TAXO.PREUVE.FORTE) return POIDS.categorieForte;
    return POIDS.categorieFaible;
  }

  /* Une exclusion qui mord. Elle décrit ce que le lieu EST — un commerce, un
     abribus, un vétérinaire — et cela ne se discute pas avec un nom. */
  function exclusionQuiMord(b, tags, cats) {
    for (const ex of b.exclusions) {
      const valeur = tags[ex.cle];
      if (valeur != null && valeur !== "") {
        const lues = String(valeur).split(";").map((v) => v.trim().toLowerCase());
        if (ex.valeurs.some((v) => lues.includes(v))) return ex;
      }
      /* La même exclusion vaut sur les catégories d'Autour : un lieu venu de
         Google ou d'une publication n'a pas de tag OSM, mais il a une
         catégorie, et un restaurant reste un restaurant. */
      if (ex.valeurs.some((v) => cats.has(v))) return ex;
    }
    return null;
  }

  /* ===================================================================
     4. LE VERDICT, POUR UN BESOIN

     Rend toujours le détail — pas seulement oui/non. C'est ce qui permet à
     l'interface de dire POURQUOI une structure est là, et à quiconque relit
     ce code de comprendre une décision sans la rejouer.
     =================================================================== */
  function evaluer(lieu, besoinId) {
    const b = TAXO.besoin(besoinId);
    const vide = { accorde: false, confiance: 0, preuves: [], refus: REFUS.AUCUNE };
    if (!b || !lieu) return vide;

    const options = arguments[2] || {};
    const logement = besoinId === "logement" ? compatibiliteLogement(lieu, options || {}) : null;
    const typeLogement = logement ? typeStructureDe(lieu) : null;
    const decorer = (verdict) => logement
      ? Object.assign(verdict, {
        logement: logement.info,
        compatibiliteLogement: logement.statut,
      }) : verdict;
    /* Les structures très spécialisées ne sont jamais des réponses génériques
       quand le public n'est pas établi. Une MECS reste de la protection de
       l'enfance ; un centre parental ou maternel sans profil compatible n'est
       pas un hébergement à proposer au hasard. */
    if (logement && (logement.refus === LOGEMENT_REFUS.TYPE_NON_LOGEMENT ||
        logement.refus === LOGEMENT_REFUS.PUBLIC_INCOMPATIBLE ||
        logement.refus === LOGEMENT_REFUS.PUBLIC_INCONNU ||
        logement.info.type_structure &&
        ["centre_parental", "centre_maternel"].includes(logement.info.type_structure) &&
        logement.statut !== true)) {
      return decorer({ accorde: false, confiance: 0, preuves: [],
        refus: logement.refus || LOGEMENT_REFUS.PUBLIC_INCONNU,
        pourquoi: logement.refus === LOGEMENT_REFUS.TYPE_NON_LOGEMENT
          ? "ce dispositif ne fournit pas un hébergement pour ce besoin"
          : "le public admis n’est pas compatible ou n’est pas renseigné" });
    }

    const tags = tagsDe(lieu);
    const cats = categoriesDe(lieu);
    const services = servicesDe(lieu);
    const preuves = [];
    let confiance = 0;
    let structurelle = false;      // une preuve autre que le nom
    let certaine = false;          // une preuve qui ne se discute pas

    const ajouter = (genre, poids, quoi) => {
      confiance += poids;
      preuves.push({ genre, poids, quoi });
      if (NOMINALES.indexOf(genre) < 0) structurelle = true;
    };

    /* 1 & 3. le type réel, dit par un champ, un tag, ou un nom corroboré par
       une catégorie/source sociale. Un nom isolé reste nominal et ne passe
       jamais. */
    if (logement && typeLogement && typeLogement.structurelle) {
      const poids = typeLogement.preuve === "nom" ? POIDS.typeNom : POIDS.typeStructure;
      if (typeLogement.preuve !== "nom") certaine = true;
      ajouter("type_structure", poids, "type_structure=" + typeLogement.type);
    }

    b.tags.forEach((tag) => {
      const preuve = preuveTag(tag, tags);
      if (!preuve) return;
      if (preuve === TAXO.PREUVE.CERTAINE) certaine = true;
      ajouter("tag", poidsDeTag(preuve), tag.cle + "=" + tag.valeurs.join("|"));
    });

    /* 2. les catégories d'Autour — structurelles, jamais nominales.

       UNE CATÉGORIE N'EST PAS UNE SECONDE PREUVE : C'EST LA PREMIÈRE, RELUE.

       La catégorie d'un lieu OpenStreetMap n'est pas observée, elle est
       DÉDUITE de ses tags par `REQUETES` dans `app.js`. `social_facility=outreach`
       donne `asso` ; `amenity=townhall` donne `mairie`. Additionner le tag et la
       catégorie, c'est donc compter le même fait deux fois, et le premier test
       terrain autour de Tourcoing a montré exactement où ça mène :

         « Point information jeunesse »  →  AIDE ALIMENTAIRE, confiance 56
           social_facility=outreach (18) + amenity=social_facility (18)
           + catégorie asso (20) = 56 ≥ 50

       Trois indices faibles franchissent le seuil sans qu'aucune donnée ne
       parle jamais de nourriture. Un point information jeunesse n'est pas une
       distribution alimentaire, et envoyer quelqu'un qui n'a rien à manger
       vers un point information jeunesse, c'est le même échec que la
       viennoiserie — par un autre chemin.

       La règle : quand un TAG a déjà parlé pour ce besoin, la catégorie qui en
       découle n'ajoute rien. Elle reste consignée dans les preuves, à zéro,
       pour qu'on voie qu'elle a été lue et écartée en connaissance de cause.
       Elle ne compte, et ne peut rendre le verdict CERTAIN, que lorsqu'aucun
       tag n'a parlé — un lieu venu de Google ou d'une publication n'a pas de
       tags, et sa catégorie est alors la seule chose qu'on sache de lui. */
    const tagAParle = preuves.some((preuve) => preuve.genre === "tag");
    b.categories.forEach((k) => {
      if (!cats.has(k.id)) return;
      /* Une catégorie générique `hebergement` ne dit pas si le lieu héberge,
         oriente ou accompagne. Pour Logement elle est donc insuffisante seule.
         Les catégories d'aide explicitement publiées restent recevables. */
      if (besoinId === "logement" && k.id === "hebergement" &&
          (!logement || !logement.info.type_structure) &&
          !categorieLogementDocumentee(lieu)) {
        preuves.push({ genre: "categorie", poids: 0, quoi: k.id,
                       echo: "type de structure non renseigné" });
        return;
      }
      if (tagAParle) {
        preuves.push({ genre: "categorie", poids: 0, quoi: k.id,
                       echo: "déduite des tags déjà comptés" });
        return;
      }
      if (k.preuve === TAXO.PREUVE.CERTAINE) certaine = true;
      ajouter("categorie", poidsDeCategorie(k.preuve), k.id);
    });

    /* 4. les services explicitement déclarés. */
    b.services.forEach((s) => {
      if (!services.has(texteSansAccents(s))) return;
      certaine = true;
      ajouter("service", POIDS.service, s);
    });

    /* 6. la source institutionnelle — elle ne vaut que si quelque chose
       d'autre rattache déjà le lieu au besoin. Une source officielle ne rend
       pas une boulangerie sociale ; elle confirme ce qui est déjà là. */
    /* Un catalogue public confirme qu'une fiche existe ; il ne transforme
       pas une association familiale en aide alimentaire, emploi ou santé.
       La confirmation ne compte donc que si la fiche porte déjà une
       catégorie métier non générique compatible avec le besoin. */
    const categorieInstitutionnelleCompatible = b.categories.some((k) =>
      k.id !== "asso" && cats.has(k.id));
    if (structurelle && estInstitutionnel(lieu) && categorieInstitutionnelleCompatible)
      ajouter("institutionnel", POIDS.institutionnel, "source publique");

    /* 5. la description, quand elle nomme le service. */
    const description = texteSansAccents(descriptionDe(lieu));
    if (description && b.synonymes.some((re) => re.test(description)))
      ajouter("description", POIDS.description, "description");

    /* 7. LE NOM, EN DERNIER ET POUR PEU.

       `structurelle` est déjà connu à ce point : toutes les preuves qui ne
       viennent pas du nom ont été examinées avant. C'est ce qui permet de
       distinguer un réseau CORROBORÉ d'un nom qui parle tout seul. */
    const nom = nomDe(lieu);
    if (nom && b.synonymes.some((re) => re.test(nom)))
      ajouter("reseauNom",
        structurelle ? POIDS.reseauNomCorrobore : POIDS.reseauNom,
        "réseau reconnu dans le nom");

    /* ---- Les refus, dans l'ordre où ils doivent tomber ------------------ */

    /* L'exclusion structurelle. Elle ne cède qu'à une preuve CERTAINE : une
       épicerie solidaire tagguée `shop=convenience` ET `social_facility=food_bank`
       reste une épicerie solidaire. */
    const exclusion = exclusionQuiMord(b, tags, cats);
    if (exclusion && !certaine)
      return decorer({ accorde: false, confiance: 0, preuves,
               refus: REFUS.EXCLUSION, pourquoi: exclusion.raison });

    /* LA RÈGLE. Un mot dans le nom, et rien d'autre : c'est non. Pas « c'est
       faible », pas « c'est sous le seuil » — c'est non, et le refus porte son
       nom pour qu'on puisse le compter. */
    if (preuves.length && !structurelle)
      return decorer({ accorde: false, confiance: 0, preuves, refus: REFUS.NOM_SEUL,
               pourquoi: "le nom évoque ce besoin, mais rien dans les données ne l’atteste" });

    if (!preuves.length) return decorer(vide);
    if (confiance < SEUIL)
      return decorer({ accorde: false, confiance, preuves, refus: REFUS.SOUS_SEUIL });

    return decorer({ accorde: true, confiance, preuves, refus: null, certaine });
  }

  /* ===================================================================
     5. TOUTES LES CAPACITÉS D'UN COUP

     C'est la forme que le reste d'Autour consomme : une structure, et ce
     qu'elle peut. Une mission locale rend `financial_assistance` ET
     `youth_support` ; c'est le même objet, vu par deux besoins.
     =================================================================== */
  function capacites(lieu, options) {
    const out = TAXO.capacitesVides();
    const detail = {};
    let meilleure = 0;
    TAXO.BESOINS.forEach((b) => {
      const v = evaluer(lieu, b.id, options);
      detail[b.capacite] = v;
      out[b.capacite] = v.accorde;
      if (v.accorde) meilleure = Math.max(meilleure, v.confiance);
    });
    const aide = Object.keys(out).some((k) => out[k]);
    return { capacites: out, detail, aide, confiance: meilleure };
  }

  /* Une structure entre-t-elle dans Aide, tous besoins confondus ? C'est la
     question que pose « Autre aide », et le garde-fou de tout l'écran. */
  const estAide = (lieu, options) => capacites(lieu, options).aide;

  /* Un lieu répond-il à CE besoin ? `autre` accepte toute capacité reconnue :
     c'est le recours de qui ne sait pas nommer ce qu'il cherche.

     Il rend TOUJOURS la même forme de verdict, y compris pour « autre ». Une
     première version y rendait l'objet de capacités — qui n'a pas de champ
     `accorde` — et l'appelant, ne le trouvant pas, concluait au refus : « Autre
     aide » ne proposait plus rien. Une fonction qui change de forme selon son
     argument est une fonction qui se trompera. */
  function repond(lieu, besoinId, options) {
    if (besoinId === TAXO.BESOIN_OUVERT) {
      const c = capacites(lieu, options);
      const retenus = Object.keys(c.detail).filter((k) => c.detail[k].accorde);
      return {
        accorde: c.aide,
        confiance: c.confiance,
        preuves: retenus.flatMap((k) => c.detail[k].preuves),
        certaine: retenus.some((k) => c.detail[k].certaine),
        refus: c.aide ? null : REFUS.AUCUNE,
        capacites: c.capacites,
      };
    }
    const b = TAXO.besoin(besoinId);
    if (!b) return { accorde: false, confiance: 0, preuves: [], refus: REFUS.AUCUNE };
    return evaluer(lieu, besoinId, options);
  }

  /* Les besoins auxquels une structure répond, du plus sûr au moins sûr. */
  function besoinsDe(lieu, options) {
    return TAXO.BESOINS
      .map((b) => ({ id: b.id, capacite: b.capacite, verdict: evaluer(lieu, b.id, options) }))
      .filter((x) => x.verdict.accorde)
      .sort((a, b) => b.verdict.confiance - a.verdict.confiance);
  }

  /* ===================================================================
     6. L'ORDRE DES RÉSULTATS

     Pour Aide, la distance n'est pas le premier signal et la note d'une source
     ne rattrape pas une mauvaise réponse. L'ordre métier est explicite :

       1. compatibilité réelle avec le besoin
       2. possibilité réelle d'accès
       3. temps de trajet
       4. ouverture / disponibilité
       5. confiance et fraîcheur de la source

     `comparer` reçoit parfois seulement un lieu (l'écran ajoute alors son
     verdict dans `verdictAide`) et parfois un objet de test complet. Les
     fonctions ci-dessous relisent l'ontologie logement directement pour que
     le contrat reste vrai sans dépendre de `app.js`.
     =================================================================== */
  function prioriteAcces(lieu) {
    const info = decrireLogement(lieu);
    if (!info.type_structure) return null;
    if (info.acces_libre === true) return 3;
    if (info.orientation_requise === true) return 2;
    if (info.acces_libre === false) return 0;
    return 1;
  }

  function prioriteUrgence(lieu) {
    const info = decrireLogement(lieu);
    if (!info.type_structure) return null;
    if (info.urgence_possible === true && info.hebergement_effectif === true) return 3;
    if (info.urgence_possible === true) return 2;
    if (info.hebergement_effectif === true) return 1;
    return 0;
  }

  function prioriteOuverture(lieu) {
    if (lieu && lieu.ouvert === true) return 2;
    if (lieu && lieu.ouvert === false) return 0;
    return 1;
  }

  function confianceSource(lieu, verdict) {
    const info = decrireLogement(lieu);
    const preuve = Number(info.confidence);
    const source = estInstitutionnel(lieu) ? 2 : info.source ? 1 : 0;
    return (Number.isFinite(preuve) ? preuve : 0) + source;
  }

  function comparer(a, b) {
    const va = (a && a.verdictAide) || {}, vb = (b && b.verdictAide) || {};
    const ia = decrireLogement(a), ib = decrireLogement(b);

    /* 1 — une incompatibilité n'est jamais rattrapée par une minute gagnée.
       En pratique les incompatibles sont filtrées avant le tri ; ce garde-fou
       protège aussi les appelants qui comparent une liste brute. */
    const ca = va.compatibiliteLogement, cb = vb.compatibiliteLogement;
    if (typeof ca === "boolean" && typeof cb === "boolean" && ca !== cb)
      return cb ? 1 : -1;
    if (ia.type_structure && ib.type_structure && ia.type_structure !== ib.type_structure) {
      const sa = ia.besoins_servis && ia.besoins_servis.includes("logement") ? 1 : 0;
      const sb = ib.besoins_servis && ib.besoins_servis.includes("logement") ? 1 : 0;
      if (sa !== sb) return sb - sa;
    }

    /* Une mise à l'abri immédiate est une compatibilité supérieure pour une
       demande urgente. Une orientation SIAO peut rester dans la liste, mais ne
       doit pas être confondue avec un hébergement effectif. */
    const ua = prioriteUrgence(a), ub = prioriteUrgence(b);
    if (ua !== null && ub !== null && ua !== ub) return ub - ua;

    /* 2 — librement accessible, puis accessible sur orientation, puis
       inconnu ; l'inconnu ne devient jamais un « non ». */
    const aa = prioriteAcces(a), ab = prioriteAcces(b);
    if (aa !== null && ab !== null && aa !== ab) return ab - aa;

    /* 3 — les minutes vécues, avec les paliers 0-10 / 10-20 / 20-30 / 30-45
       / >45. La compatibilité a déjà été traitée au-dessus. */
    const rayon = root.AutourAideRayon;
    if (rayon && rayon.comparerTemps) {
      const trajet = rayon.comparerTemps(a, b);
      if (trajet) return trajet;
    }

    /* 4 — la porte ouverte intervient après le temps nécessaire pour y aller. */
    const ouvert = prioriteOuverture(b) - prioriteOuverture(a);
    if (ouvert) return ouvert;

    /* 5 — la confiance de la source, puis la preuve certaine et la finesse du
       classement. Aucune source ne peut donc devancer une structure adaptée
       et accessible uniquement parce qu'elle est mieux documentée. */
    const source = confianceSource(b, vb) - confianceSource(a, va);
    if (source) return source;
    const certaine = (vb.certaine ? 1 : 0) - (va.certaine ? 1 : 0);
    if (certaine) return certaine;
    const confiance = (vb.confiance || 0) - (va.confiance || 0);
    if (confiance) return confiance;
    const spec = specialisation(a) - specialisation(b);
    if (spec) return spec;
    return (fraicheur(b) || 0) - (fraicheur(a) || 0);
  }

  /* Combien de besoins cette structure couvre-t-elle ? Peu = spécialisée. */
  function specialisation(lieu) {
    const n = (lieu && lieu.capacitesAide)
      ? Object.keys(lieu.capacitesAide).filter((k) => lieu.capacitesAide[k]).length
      : 0;
    return n === 0 ? 99 : n;
  }

  const ouvert = (lieu) => !!(lieu && lieu.ouvert === true);

  function fraicheur(lieu) {
    const l = lieu || {};
    const t = Date.parse(l.majLe || l.updated_at || l.last_synced_at || "");
    return Number.isFinite(t) ? t : 0;
  }

  root.AutourAideClassement = Object.freeze({
    POIDS, SEUIL, REFUS, LOGEMENT_REFUS, NOMINALES, SOURCES_INSTITUTIONNELLES,
    TYPES_LOGEMENT, evaluer, capacites, estAide, repond, besoinsDe, comparer,
    typeStructureDe, decrireLogement, compatibiliteLogement,
    servicesDe, categoriesDe, estInstitutionnel,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
