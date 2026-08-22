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
    reseauNomCorrobore: 30,
    motNom:           8,
  });

  /* Au-dessus, la structure est proposée. En dessous, elle ne l'est pas —
     même si l'on en a « un peu » l'impression. Mieux vaut deux structures
     fiables que dix douteuses. */
  const SEUIL = 50;

  /* Les preuves qui viennent du NOM, et elles seules. Isolées ici parce que
     c'est sur cette liste que porte la règle la plus importante du fichier. */
  const NOMINALES = Object.freeze(["reseauNom", "motNom"]);

  const REFUS = Object.freeze({
    NOM_SEUL:    "nom_seul",
    EXCLUSION:   "exclusion",
    SOUS_SEUIL:  "sous_seuil",
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
     "data_gouv", "partenaire"]);

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

    /* 1 & 3. le type réel, dit par les tags. */
    b.tags.forEach((tag) => {
      const preuve = preuveTag(tag, tags);
      if (!preuve) return;
      if (preuve === TAXO.PREUVE.CERTAINE) certaine = true;
      ajouter("tag", poidsDeTag(preuve), tag.cle + "=" + tag.valeurs.join("|"));
    });

    /* 2. les catégories d'Autour — structurelles, jamais nominales. */
    b.categories.forEach((k) => {
      if (!cats.has(k.id)) return;
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
    if (structurelle && estInstitutionnel(lieu))
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
      return { accorde: false, confiance: 0, preuves,
               refus: REFUS.EXCLUSION, pourquoi: exclusion.raison };

    /* LA RÈGLE. Un mot dans le nom, et rien d'autre : c'est non. Pas « c'est
       faible », pas « c'est sous le seuil » — c'est non, et le refus porte son
       nom pour qu'on puisse le compter. */
    if (preuves.length && !structurelle)
      return { accorde: false, confiance: 0, preuves, refus: REFUS.NOM_SEUL,
               pourquoi: "le nom évoque ce besoin, mais rien dans les données ne l’atteste" };

    if (!preuves.length) return vide;
    if (confiance < SEUIL)
      return { accorde: false, confiance, preuves, refus: REFUS.SOUS_SEUIL };

    return { accorde: true, confiance, preuves, refus: null, certaine };
  }

  /* ===================================================================
     5. TOUTES LES CAPACITÉS D'UN COUP

     C'est la forme que le reste d'Autour consomme : une structure, et ce
     qu'elle peut. Une mission locale rend `financial_assistance` ET
     `youth_support` ; c'est le même objet, vu par deux besoins.
     =================================================================== */
  function capacites(lieu) {
    const out = TAXO.capacitesVides();
    const detail = {};
    let meilleure = 0;
    TAXO.BESOINS.forEach((b) => {
      const v = evaluer(lieu, b.id);
      detail[b.capacite] = v;
      out[b.capacite] = v.accorde;
      if (v.accorde) meilleure = Math.max(meilleure, v.confiance);
    });
    const aide = Object.keys(out).some((k) => out[k]);
    return { capacites: out, detail, aide, confiance: meilleure };
  }

  /* Une structure entre-t-elle dans Aide, tous besoins confondus ? C'est la
     question que pose « Autre aide », et le garde-fou de tout l'écran. */
  const estAide = (lieu) => capacites(lieu).aide;

  /* Un lieu répond-il à CE besoin ? `autre` accepte toute capacité reconnue :
     c'est le recours de qui ne sait pas nommer ce qu'il cherche.

     Il rend TOUJOURS la même forme de verdict, y compris pour « autre ». Une
     première version y rendait l'objet de capacités — qui n'a pas de champ
     `accorde` — et l'appelant, ne le trouvant pas, concluait au refus : « Autre
     aide » ne proposait plus rien. Une fonction qui change de forme selon son
     argument est une fonction qui se trompera. */
  function repond(lieu, besoinId) {
    if (besoinId === TAXO.BESOIN_OUVERT) {
      const c = capacites(lieu);
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
    return evaluer(lieu, besoinId);
  }

  /* Les besoins auxquels une structure répond, du plus sûr au moins sûr. */
  function besoinsDe(lieu) {
    return TAXO.BESOINS
      .map((b) => ({ id: b.id, capacite: b.capacite, verdict: evaluer(lieu, b.id) }))
      .filter((x) => x.verdict.accorde)
      .sort((a, b) => b.verdict.confiance - a.verdict.confiance);
  }

  /* ===================================================================
     6. L'ORDRE DES RÉSULTATS

     Pour Aide, la pertinence passe avant la quantité. L'ordre est celui du
     produit, et chaque critère est disjoint du suivant : un critère supérieur
     ne se renverse pas par accumulation des inférieurs.

       1. la correspondance exacte au besoin
       2. la fiabilité de la classification
       3. la spécialisation réelle de la structure
       4. la disponibilité, quand elle est connue
       5. la distance
       6. la fraîcheur de la donnée
     =================================================================== */
  function comparer(a, b) {
    const va = (a && a.verdictAide) || {}, vb = (b && b.verdictAide) || {};
    /* 1 & 2 — une preuve certaine devant une preuve construite, puis la
       confiance elle-même. */
    const certaine = (vb.certaine ? 1 : 0) - (va.certaine ? 1 : 0);
    if (certaine) return certaine;
    const confiance = (vb.confiance || 0) - (va.confiance || 0);
    if (Math.abs(confiance) >= 10) return confiance;
    /* 3 — une structure qui ne fait QUE ça passe devant celle qui fait tout.
       Une association généraliste n'est pas une réponse aussi bonne qu'une
       structure spécialisée, même si les deux « peuvent ». */
    const spec = specialisation(a) - specialisation(b);
    if (spec) return spec;
    /* 4 — ouvert maintenant, quand on le sait. L'inconnu ne pénalise pas. */
    const dispo = (ouvert(b) ? 1 : 0) - (ouvert(a) ? 1 : 0);
    if (dispo) return dispo;
    /* 5 — la distance, enfin. */
    const da = Number(a && a.rankDistance), db = Number(b && b.rankDistance);
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
    /* 6 — à tout le reste égal, la donnée la plus fraîche. */
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
    POIDS, SEUIL, REFUS, NOMINALES, SOURCES_INSTITUTIONNELLES,
    evaluer, capacites, estAide, repond, besoinsDe, comparer,
    servicesDe, categoriesDe, estInstitutionnel,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
