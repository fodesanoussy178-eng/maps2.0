(function(root) {
  "use strict";
  const PREUVE = Object.freeze({
    CERTAINE: "certaine",
    FORTE: "forte",
    FAIBLE: "faible"
  });
  const t = (cle, valeurs, preuve, note) => Object.freeze({
    cle,
    valeurs: Object.freeze([].concat(valeurs)),
    preuve,
    note: note || ""
  });
  const x = (cle, valeurs, raison) => Object.freeze({
    cle,
    valeurs: Object.freeze([].concat(valeurs)),
    raison
  });
  const c = (id, preuve) => Object.freeze({ id, preuve });
  const BESOINS = Object.freeze([
    /* ---- MANGER ----------------------------------------------------------
           LA DISTINCTION LA PLUS IMPORTANTE DE TOUT CE FICHIER.
    
           Dans Explorer, une boulangerie est « Manger ». Dans Aide > Manger, une
           boulangerie n'est PAS de l'aide alimentaire. Ce n'est pas une nuance :
           c'est la différence entre proposer un commerce à quelqu'un qui n'a pas
           d'argent, et lui proposer une distribution.
    
           D'où des exclusions larges sur le commerce alimentaire, et une seule
           façon de les lever : un tag qui dit explicitement l'aide. */
    {
      id: "manger",
      capacite: "food_assistance",
      categories: [
        c("alimentaire", PREUVE.CERTAINE),
        c("collecte", PREUVE.FORTE),
        c("asso", PREUVE.FAIBLE)
      ],
      types: [
        "banque_alimentaire",
        "distribution_alimentaire",
        "epicerie_solidaire",
        "soupe_populaire",
        "restaurant_social",
        "accueil_de_jour_repas",
        "association_alimentaire"
      ],
      tags: [
        t("social_facility", ["food_bank", "soup_kitchen", "food_sharing"], PREUVE.CERTAINE),
        t(
          "amenity",
          ["food_bank"],
          PREUVE.CERTAINE,
          "les Restos du C\u0153ur et les banques alimentaires sont tagu\xE9s des deux fa\xE7ons"
        ),
        t(
          "social_facility",
          ["day_centre", "outreach"],
          PREUVE.FAIBLE,
          "un accueil de jour sert souvent des repas, mais pas toujours"
        ),
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: ["meals", "food", "food_bank", "soup_kitchen", "grocery"],
      synonymes: [
        /banque alimentaire/i,
        /[ée]picerie\s*(?:solidaire|sociale)/i,
        /rest(?:o|aurant)s? du c(?:oe|œ|o)ur/i,
        /soupe populaire/i,
        /restaurant social/i,
        /distribution alimentaire/i,
        /colis alimentaire/i,
        /aide alimentaire/i
      ],
      exclusions: [
        x(
          "shop",
          [
            "bakery",
            "pastry",
            "supermarket",
            "convenience",
            "greengrocer",
            "butcher",
            "deli",
            "confectionery",
            "chocolate",
            "cheese",
            "seafood",
            "alcohol",
            "beverages",
            "wine"
          ],
          "un commerce alimentaire vend, il ne distribue pas"
        ),
        x(
          "amenity",
          [
            "restaurant",
            "fast_food",
            "cafe",
            "bar",
            "pub",
            "ice_cream",
            "food_court",
            "marketplace",
            "vending_machine"
          ],
          "un \xE9tablissement de restauration n'est pas une aide alimentaire"
        )
      ],
      secondaires: ["vetements", "hygiene", "papiers"]
    },
    /* ---- LOGEMENT --------------------------------------------------------
       `amenity=shelter` est EXCLU à dessein : dans OpenStreetMap c'est un
       abribus ou un abri de pique-nique. Le confondre avec un hébergement
       envoie quelqu'un dormir sous un abri de bus. */
    {
      id: "logement",
      capacite: "housing_assistance",
      categories: [
        c("hebergement", PREUVE.CERTAINE),
        c("asso", PREUVE.FAIBLE),
        c("mairie", PREUVE.FAIBLE)
      ],
      types: [
        "hebergement_urgence",
        "chrs",
        "residence_sociale",
        "maison_relais",
        "pension_de_famille",
        "abri_de_nuit",
        "foyer",
        "accueil_de_nuit",
        "service_logement"
      ],
      tags: [
        /* DORMIR CE SOIR N'EST PAS ÊTRE LOGÉ QUELQUE PART.
        
                   Ces cinq valeurs étaient sur une même ligne, toutes CERTAINES. Sur
                   les données réelles de Tourcoing, « je dors dehors » répondait
                   alors, dans l'ordre :
        
                     1. Senioriales de Tourcoing - Résidences Seniors   567 m
                     2. Résidence Les Erables                           602 m
                     3. Résidence Gabriel Lecorne                       716 m
        
                   Trois résidences, aucune place ce soir. Elles ne sont pas des
                   erreurs de données — ce SONT des hébergements — mais les mettre au
                   même niveau qu'un abri de nuit, c'est envoyer sonner à la porte d'un
                   foyer pour personnes âgées quelqu'un qui n'a nulle part où aller.
        
                   On sépare donc ce qui héberge EN URGENCE de ce qui héberge AU LONG
                   COURS. `group_home` reste demandé — en France, un CHRS ou un foyer
                   de jeunes travailleurs est souvent tagué ainsi, et les retirer
                   reviendrait à perdre le parc social — mais il ne passe plus devant
                   l'abri de nuit. */
        t(
          "social_facility",
          ["shelter", "homeless_shelter", "emergency_shelter"],
          PREUVE.CERTAINE,
          "ceux-l\xE0 h\xE9bergent ce soir"
        ),
        t("amenity", ["refugee_site", "dormitory"], PREUVE.CERTAINE),
        t(
          "social_facility",
          ["group_home", "assisted_living"],
          PREUVE.FORTE,
          "foyer, r\xE9sidence, CHRS : un vrai h\xE9bergement, mais pas une place ce soir"
        ),
        /* Un EHPAD n'est une réponse pour personne qui dort dehors. Il reste
           trouvable — c'est un hébergement — au dernier rang de la preuve. */
        t("social_facility", ["nursing_home"], PREUVE.FAIBLE),
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: ["shelter", "housing", "accommodation", "night_shelter"],
      synonymes: [
        /\bccas\b/i,
        /samu\s*social/i,
        /\b115\b/i,
        /\badil\b/i,
        /action logement/i,
        /h[ée]bergement d['’\s]?urgence/i,
        /\bchrs\b/i,
        /r[ée]sidence sociale/i,
        /maison relais/i,
        /pension de famille/i
      ],
      exclusions: [
        x(
          "amenity",
          ["shelter"],
          "dans OpenStreetMap, `amenity=shelter` est un abribus ou un abri de pique-nique"
        ),
        x(
          "tourism",
          [
            "hotel",
            "hostel",
            "motel",
            "guest_house",
            "apartment",
            "chalet",
            "camp_site",
            "caravan_site"
          ],
          "un h\xE9bergement marchand n'est pas un h\xE9bergement d'urgence"
        ),
        x("office", ["estate_agent"], "une agence immobili\xE8re vend ou loue")
      ],
      /* « je dors dehors » n'est pas qu'une question de logement : c'est aussi
         une question de sécurité, et souvent de quelqu'un à qui parler. */
      secondaires: ["securite", "parler", "papiers", "hygiene"]
    },
    /* ---- TRAVAIL / ARGENT ------------------------------------------------
       Une banque n'est pas une aide financière. C'est le faux positif le plus
       coûteux de cette catégorie, et il est structurel — pas nominal. */
    {
      id: "travail",
      capacite: "financial_assistance",
      categories: [
        c("emploi", PREUVE.CERTAINE),
        c("mairie", PREUVE.FAIBLE),
        c("asso", PREUVE.FAIBLE)
      ],
      types: [
        "mission_locale",
        "france_travail",
        "cap_emploi",
        "maison_de_l_emploi",
        "service_social",
        "ccas",
        "point_conseil_budget",
        "structure_insertion"
      ],
      tags: [
        t("office", ["employment_agency"], PREUVE.CERTAINE),
        t("government", ["employment_agency", "social_welfare"], PREUVE.CERTAINE),
        t("social_facility", ["outreach"], PREUVE.FAIBLE),
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: [
        "employment",
        "job_seeking",
        "training",
        "social_welfare",
        "financial_advice",
        "budget_advice"
      ],
      synonymes: [
        /mission locale|mission emploi|\bmelt\b/i,
        /france travail|p[oô]le emploi/i,
        /cap emploi/i,
        /maison de l['’\s]?emploi/i,
        /\bepide\b/i,
        /garantie jeunes/i,
        /point conseil budget/i,
        /\bccas\b/i,
        /chantier d['’\s]?insertion|entreprise d['’\s]?insertion/i
      ],
      exclusions: [
        x(
          "amenity",
          ["bank", "bureau_de_change", "atm"],
          "une banque g\xE8re de l'argent, elle n'aide pas les personnes sans ressources"
        ),
        x(
          "office",
          [
            "insurance",
            "financial",
            "accountant",
            "estate_agent",
            "tax_advisor",
            "lawyer"
          ],
          "un service financier ou juridique payant n'est pas une aide"
        ),
        x(
          "shop",
          ["pawnbroker", "money_lender"],
          "pr\xEAter contre gage n'est pas une aide financi\xE8re"
        )
      ],
      secondaires: ["jeunes", "papiers", "mobilite"]
    },
    /* ---- PAPIERS / DÉMARCHES --------------------------------------------- */
    {
      id: "papiers",
      capacite: "administrative_help",
      categories: [
        c("mairie", PREUVE.FORTE),
        c("emploi", PREUVE.FAIBLE),
        c("asso", PREUVE.FAIBLE)
      ],
      types: [
        "mairie",
        "france_services",
        "ccas",
        "point_acces_au_droit",
        "ecrivain_public",
        "permanence_juridique",
        "domiciliation"
      ],
      tags: [
        t("amenity", ["townhall"], PREUVE.CERTAINE),
        t("office", ["government"], PREUVE.FORTE),
        t(
          "government",
          ["public_service", "social_welfare", "register_office"],
          PREUVE.CERTAINE
        ),
        t("amenity", ["social_facility"], PREUVE.FAIBLE),
        t(
          "amenity",
          ["post_office"],
          PREUVE.FAIBLE,
          "une France Services est souvent h\xE9berg\xE9e dans un bureau de poste"
        )
      ],
      services: [
        "administrative_assistance",
        "legal_advice",
        "translation",
        "domiciliation",
        "digital_assistance"
      ],
      synonymes: [
        /(?:maison\s*)?france\s*services|maison de services au public/i,
        /\bccas\b/i,
        /pr[ée]fecture/i,
        /sous[-\s]pr[ée]fecture/i,
        /point d['’\s]?acc[èe]s au droit/i,
        /[ée]crivain public/i,
        /permanence juridique/i,
        /\bcidff\b/i
      ],
      exclusions: [
        x(
          "office",
          ["lawyer", "notary", "tax_advisor", "accountant"],
          "un cabinet payant n'est pas une aide aux d\xE9marches"
        ),
        x(
          "shop",
          ["copyshop", "stationery"],
          "un magasin de photocopies n'accompagne personne"
        )
      ],
      secondaires: ["travail", "logement"]
    },
    /* ---- SANTÉ ------------------------------------------------------------
       `amenity=veterinary` est exclu, et ce n'est pas une plaisanterie : le
       tag est proche, le nom contient souvent « clinique », et envoyer
       quelqu'un de malade chez un vétérinaire est le genre d'erreur qu'on ne
       remarque qu'une fois qu'elle est arrivée. */
    {
      id: "sante",
      capacite: "healthcare",
      categories: [c("sante", PREUVE.CERTAINE), c("asso", PREUVE.FAIBLE)],
      types: [
        "hopital",
        "centre_de_sante",
        "pass",
        "cabinet_medical",
        "pharmacie",
        "cmp",
        "planning_familial",
        "pmi",
        "cegidd"
      ],
      tags: [
        t("amenity", ["hospital", "clinic", "doctors", "dentist"], PREUVE.CERTAINE),
        t("healthcare", [
          "centre",
          "doctor",
          "clinic",
          "hospital",
          "dentist",
          "psychotherapist",
          "counselling",
          "midwife"
        ], PREUVE.CERTAINE),
        t("amenity", ["pharmacy", "health_post"], PREUVE.FORTE),
        t("healthcare", [
          "pharmacy",
          "laboratory",
          "physiotherapist",
          "alternative",
          "nurse"
        ], PREUVE.FORTE)
      ],
      services: [
        "medical_care",
        "consultation",
        "vaccination",
        "screening",
        "sexual_health",
        "dental_care"
      ],
      synonymes: [
        /permanence d['’\s]?acc[èe]s aux soins|\bpass\b\s*sant/i,
        /centre de sant[ée]/i,
        /h[oô]pital/i,
        /\bchu\b|\bchr\b/i,
        /m[ée]decins du monde/i,
        /planning familial/i,
        /\bcegidd\b/i,
        /\bpmi\b|protection maternelle/i
      ],
      exclusions: [
        x("amenity", ["veterinary"], "un v\xE9t\xE9rinaire soigne les animaux"),
        x(
          "shop",
          [
            "optician",
            "hearing_aids",
            "medical_supply",
            "herbalist",
            "nutrition_supplements",
            "cosmetics",
            "beauty"
          ],
          "un commerce de mat\xE9riel ou de bien-\xEAtre n'est pas un soin"
        ),
        x(
          "leisure",
          ["fitness_centre", "sports_centre"],
          "une salle de sport n'est pas un lieu de soin"
        )
      ],
      secondaires: ["parler", "famille"]
    },
    /* ---- JEUNES / ÉTUDES -------------------------------------------------
       Un établissement scolaire n'est pas un lieu d'aide : ses locaux ne sont
       pas ouverts au public, et quelqu'un qui cherche de l'aide n'y entrera
       pas. `amenity=youth_centre` est le tag qui compte. */
    {
      id: "jeunes",
      capacite: "youth_support",
      categories: [c("emploi", PREUVE.FAIBLE), c("asso", PREUVE.FAIBLE)],
      types: [
        "mission_locale",
        "point_information_jeunesse",
        "crij",
        "bij",
        "maison_des_adolescents",
        "crous",
        "foyer_jeunes_travailleurs"
      ],
      tags: [
        t("amenity", ["youth_centre"], PREUVE.CERTAINE),
        /* `child` est volontairement ABSENT. Le test terrain de Tourcoing
           rendait une PMI et un DITEP sous « Jeunes / études » : ces structures
           portent `social_facility:for=child`, qui désigne le petit enfant et
           ses parents, pas l'adolescent ou le jeune adulte qui cherche une
           orientation. Elles relèvent de FAMILLE — qui demande justement
           `child|family|parent` — et y restent. Quelqu'un de 19 ans qui cherche
           du travail n'a rien à faire dans une protection maternelle. */
        t("social_facility:for", ["juvenile", "student"], PREUVE.FORTE),
        t(
          "office",
          ["employment_agency"],
          PREUVE.FAIBLE,
          "une mission locale est taggu\xE9e ainsi, mais France Travail aussi"
        ),
        t("social_facility", ["outreach", "day_centre"], PREUVE.FAIBLE),
        /* Un équipement social qui déclare s'adresser aux jeunes : les deux
           tags ensemble disent une structure jeunesse — c'est la Maison des
           Jeunes et de la Culture, que `juvenile` seul laissait sous le seuil. */
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: [
        "youth_counselling",
        "orientation",
        "student_support",
        "job_seeking",
        "tutoring"
      ],
      synonymes: [
        /mission locale|mission emploi|\bmelt\b/i,
        /\bcrous\b/i,
        /\bcrij\b|information jeunesse/i,
        /point information jeunesse|\bpij\b/i,
        /\bbij\b/i,
        /maison des adolescents|\bmda\b/i,
        /\bpaej\b/i,
        /foyer de jeunes travailleurs|\bfjt\b/i
      ],
      exclusions: [
        x(
          "amenity",
          [
            "school",
            "college",
            "university",
            "kindergarten",
            "language_school",
            "driving_school",
            "music_school"
          ],
          "un \xE9tablissement d'enseignement n'accueille pas le public en demande d'aide"
        )
      ],
      secondaires: ["travail", "papiers", "parler"]
    },
    /* ---- PARLER À QUELQU'UN ----------------------------------------------
       Une pharmacie ou un hôpital générique ne répond pas à une demande de
       soutien psychologique. Il faut une spécialité déclarée. */
    {
      id: "parler",
      capacite: "emotional_support",
      categories: [c("sante", PREUVE.FAIBLE), c("asso", PREUVE.FAIBLE)],
      types: [
        "cmp",
        "cmpp",
        "bapu",
        "point_ecoute",
        "maison_des_adolescents",
        "psychologue",
        "centre_social",
        "association_ecoute"
      ],
      tags: [
        t("healthcare", ["psychotherapist", "counselling"], PREUVE.CERTAINE),
        t(
          "healthcare:speciality",
          ["psychiatry", "psychology", "psychotherapy"],
          PREUVE.CERTAINE
        ),
        t(
          "healthcare:counselling",
          ["*"],
          PREUVE.CERTAINE,
          "la cl\xE9 seule suffit : elle ne se pose que sur une structure d'\xE9coute"
        ),
        t("amenity", ["social_centre"], PREUVE.FAIBLE),
        t("social_facility", ["outreach"], PREUVE.FAIBLE)
      ],
      services: ["counselling", "psychological_support", "listening", "helpline"],
      synonymes: [
        /\bcmpp?\b/i,
        /point [ée]coute/i,
        /maison des adolescents/i,
        /\bbapu\b/i,
        /sant[ée] psy [ée]tudiant/i,
        /mon soutien psy/i,
        /sos amiti[ée]/i,
        /\bpaej\b/i,
        /psychologue|psychoth[ée]rapeute|psychiatre/i
      ],
      exclusions: [
        x(
          "amenity",
          ["pharmacy", "veterinary"],
          "d\xE9livrer un m\xE9dicament n'est pas \xE9couter"
        ),
        x("shop", ["books", "gift"], "un commerce n'est pas une \xE9coute")
      ],
      secondaires: ["sante", "securite", "jeunes"]
    },
    /* ---- FAMILLE ---------------------------------------------------------- */
    {
      id: "famille",
      capacite: "family_support",
      categories: [
        c("asso", PREUVE.FAIBLE),
        c("mairie", PREUVE.FAIBLE),
        c("sante", PREUVE.FAIBLE)
      ],
      types: [
        "caf",
        "pmi",
        "centre_social",
        "maison_de_quartier",
        "ludotheque",
        "reaap",
        "lieu_accueil_enfants_parents"
      ],
      tags: [
        t("social_facility:for", ["child", "family", "parent"], PREUVE.CERTAINE),
        t("healthcare:speciality", ["paediatrics"], PREUVE.FORTE),
        t("amenity", ["social_centre"], PREUVE.FAIBLE),
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: [
        "childcare",
        "parenting_support",
        "family_counselling",
        "family_mediation"
      ],
      synonymes: [
        /\bcaf\b/i,
        /\bpmi\b|protection maternelle/i,
        /centre social/i,
        /maison de quartier/i,
        /\bccas\b/i,
        /planning familial/i,
        /\breaap\b/i,
        /lieu d['’\s]?accueil enfants[- ]parents|\blaep\b/i,
        /m[ée]diation familiale/i
      ],
      exclusions: [
        x(
          "amenity",
          ["kindergarten", "childcare"],
          "une cr\xE8che garde des enfants, elle n'accompagne pas une famille en difficult\xE9"
        ),
        x(
          "shop",
          ["baby_goods", "toys", "clothes"],
          "un commerce pour enfants n'est pas un soutien \xE0 la parentalit\xE9"
        )
      ],
      secondaires: ["papiers", "sante", "parler"]
    },
    /* ---- SÉCURITÉ ---------------------------------------------------------
           LA CATÉGORIE QUI NE RENDAIT RIEN, ET POURQUOI.
    
           Deux causes, toutes deux structurelles :
    
             · `amenity=police` n'était demandé NULLE PART. Ni dans la requête
               Overpass du navigateur, ni dans l'outil de pré-calcul des zones.
               Aucun commissariat, aucune gendarmerie n'entrait jamais dans les
               données d'Autour : la catégorie ne pouvait pas rendre un résultat
               qu'elle n'avait jamais reçu.
             · aucune catégorie de lieu ne correspondait à « sécurité ». Un poste
               de police posé à la main n'aurait pu être reconnu que par son nom.
    
           Le tag `police=*` porte le corps : `police=national` (Police nationale),
           `police=municipal` (Police municipale), `police=gendarmerie`. Il n'est
           pas nécessaire — `amenity=police` suffit — mais quand il est là il
           nomme précisément ce qu'on a trouvé. */
    {
      id: "securite",
      capacite: "safety_support",
      /* `sante` est FAIBLE et non absent : un planning familial ou un centre
         de santé peut accompagner des victimes de violences. Faible signifie
         « il faut autre chose » — jamais « ça compte comme un commissariat ». */
      categories: [
        c("securite", PREUVE.CERTAINE),
        c("asso", PREUVE.FAIBLE),
        c("hebergement", PREUVE.FAIBLE),
        c("sante", PREUVE.FAIBLE)
      ],
      types: [
        "commissariat",
        "police_nationale",
        "police_municipale",
        "gendarmerie",
        "poste_de_police",
        "accueil_des_victimes",
        "aide_aux_victimes",
        "association_violences",
        "permanence_specialisee",
        "mise_a_l_abri"
      ],
      tags: [
        t(
          "amenity",
          ["police"],
          PREUVE.CERTAINE,
          "commissariat, poste de police, brigade de gendarmerie"
        ),
        t(
          "police",
          ["national", "municipal", "gendarmerie", "state", "barracks"],
          PREUVE.CERTAINE,
          "le corps, quand il est renseign\xE9"
        ),
        t(
          "social_facility:for",
          ["abused", "victim", "victims"],
          PREUVE.CERTAINE,
          "structures d'accompagnement des victimes"
        ),
        t(
          "social_facility",
          ["shelter", "emergency_shelter"],
          PREUVE.FAIBLE,
          "une mise \xE0 l'abri ne rel\xE8ve de la s\xE9curit\xE9 que si la donn\xE9e le dit"
        ),
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: [
        "victim_support",
        "protection",
        "legal_advice",
        "complaint",
        "domestic_violence_support",
        "emergency_accommodation"
      ],
      synonymes: [
        /commissariat/i,
        /police (?:nationale|municipale)/i,
        /poste de police/i,
        /gendarmerie/i,
        /brigade de gendarmerie/i,
        /\b3919\b/i,
        /france victimes/i,
        /aide aux victimes/i,
        /accueil des victimes/i,
        /\bcidff\b/i,
        /violences? (?:conjugales?|faites aux femmes|sexuelles?)/i,
        /point d['’\s]?acc[èe]s au droit/i,
        /planning familial/i,
        /\bsolidarit[ée] femmes\b/i,
        /\bcidff\b|centre d['’\s]?information sur les droits des femmes/i
      ],
      exclusions: [
        x(
          "shop",
          [
            "car_repair",
            "car",
            "car_parts",
            "tyres",
            "locksmith",
            "alarm",
            "security"
          ],
          "\xAB S\xE9curit\xE9 Auto \xBB, alarmes, serrurerie : du commerce, pas de la protection"
        ),
        x(
          "office",
          ["security", "insurance", "guard"],
          "une soci\xE9t\xE9 de gardiennage ou d'assurance ne prot\xE8ge pas une victime"
        ),
        x("amenity", ["prison"], "une prison n'accueille pas une personne en danger")
      ],
      secondaires: ["parler", "logement", "papiers"]
    },
    /* ---- HYGIÈNE, VÊTEMENTS, MOBILITÉ ------------------------------------
       Hors grille à l'écran — le design est gelé et garde ses dix cases — mais
       des besoins à part entière : reconnus dans une phrase, atteignables par
       « Autre aide ». Les retirer du modèle ferait perdre des douches et des
       vestiaires à ceux qui les cherchent. */
    {
      id: "hygiene",
      capacite: "hygiene_access",
      horsGrille: true,
      categories: [c("toilettes", PREUVE.FORTE), c("asso", PREUVE.FAIBLE)],
      types: ["bains_douches", "accueil_de_jour", "laverie_solidaire", "toilettes_publiques"],
      tags: [
        t("amenity", ["shower", "public_bath"], PREUVE.CERTAINE),
        t("amenity", ["toilets"], PREUVE.FORTE),
        t("social_facility", ["day_centre"], PREUVE.FAIBLE)
      ],
      services: ["shower", "laundry", "hygiene", "toilets"],
      synonymes: [
        /bains[-\s]douches/i,
        /accueil de jour/i,
        /laverie solidaire/i,
        /espace hygi[èe]ne/i,
        /\bdouches?\b/i,
        /\bsanitaires?\b/i
      ],
      exclusions: [
        x(
          "shop",
          ["laundry", "dry_cleaning", "beauty", "hairdresser"],
          "une laverie ou un salon payant n'est pas un acc\xE8s \xE0 l'hygi\xE8ne"
        )
      ],
      secondaires: ["logement", "manger"]
    },
    {
      id: "vetements",
      capacite: "clothing_assistance",
      horsGrille: true,
      categories: [
        c("collecte", PREUVE.FORTE),
        c("friperie", PREUVE.FAIBLE),
        c("asso", PREUVE.FAIBLE)
      ],
      types: ["vestiaire", "friperie_solidaire", "collecte_vetements"],
      tags: [
        t("social_facility", ["clothing_bank"], PREUVE.CERTAINE),
        t("shop", ["charity"], PREUVE.FORTE),
        t("shop", ["second_hand"], PREUVE.FAIBLE)
      ],
      services: ["clothing", "clothing_bank", "vestiaire"],
      synonymes: [
        /\bvestiaire\b/i,
        /secours populaire/i,
        /secours catholique/i,
        /emma(?:ü|u)s/i,
        /le relais/i,
        /friperie solidaire/i,
        /don de v[êe]tements/i
      ],
      exclusions: [
        x(
          "shop",
          ["clothes", "shoes", "boutique", "fashion_accessories"],
          "un magasin de v\xEAtements vend"
        )
      ],
      secondaires: ["manger", "hygiene"]
    },
    {
      /* Aucun tag OpenStreetMap ne décrit une plateforme de mobilité solidaire.
         La catégorie existe donc avec une confiance structurellement basse, et
         c'est la vérité de la donnée — pas un oubli. */
      id: "mobilite",
      capacite: "mobility_support",
      horsGrille: true,
      categories: [
        c("asso", PREUVE.FAIBLE),
        c("emploi", PREUVE.FAIBLE),
        c("mairie", PREUVE.FAIBLE)
      ],
      types: [
        "plateforme_mobilite",
        "garage_solidaire",
        "auto_ecole_sociale",
        "ccas",
        "mission_locale"
      ],
      tags: [
        t("social_facility", ["outreach"], PREUVE.FAIBLE),
        t("office", ["employment_agency"], PREUVE.FAIBLE),
        t("amenity", ["social_facility"], PREUVE.FAIBLE)
      ],
      services: ["mobility", "transport_assistance", "driving_licence_support"],
      synonymes: [
        /plateforme (?:de )?mobilit[ée]/i,
        /auto[- ]?[ée]cole sociale/i,
        /garage (?:solidaire|associatif)/i,
        /\bwimoov\b/i
      ],
      exclusions: [
        x(
          "shop",
          ["car", "car_repair", "bicycle", "motorcycle"],
          "un garage commercial n'est pas une aide \xE0 la mobilit\xE9"
        ),
        x(
          "amenity",
          ["fuel", "car_rental", "car_sharing", "driving_school"],
          "un service de transport payant n'est pas une aide"
        )
      ],
      secondaires: ["travail", "papiers"]
    }
  ]);
  const BESOIN_OUVERT = "autre";
  const SOURCE_PRIORITIES = Object.freeze({
    service_public: 400,
    dila: 400,
    institutionnel: 400,
    contexte_officiel: 400,
    social_officiel: 300,
    base_sociale_officielle: 300,
    data_gouv: 300,
    association_verifiee: 200,
    asso_verifiee: 200,
    openstreetmap: 100,
    osm: 100,
    unknown: 0
  });
  const CANONICAL_HELP_CATEGORIES = Object.freeze([
    "manger",
    "logement",
    "travail",
    "papiers",
    "sante",
    "jeunes",
    "parler",
    "famille",
    "securite",
    "autre",
    "hygiene",
    "vetements",
    "mobilite"
  ]);
  const SERVICE_TYPES = Object.freeze({
    commissariat: { categories: ["securite"], urgent: true },
    police_nationale: { categories: ["securite"], urgent: true },
    police_municipale: { categories: ["securite"], urgent: true },
    poste_de_police: { categories: ["securite"], urgent: true },
    gendarmerie: { categories: ["securite"], urgent: true },
    brigade_gendarmerie: { categories: ["securite"], urgent: true },
    ma_securite: { categories: ["securite"], urgent: false },
    aide_aux_victimes: { categories: ["securite", "parler"], urgent: false },
    accueil_victimes_urgence: { categories: ["securite", "parler"], urgent: true },
    accueil_violences: { categories: ["securite", "parler", "famille"], urgent: true },
    violences_conjugales: { categories: ["securite", "famille", "parler"], urgent: true },
    france_victimes: { categories: ["securite", "parler"], urgent: false },
    maison_justice_droit: { categories: ["securite", "papiers"], urgent: false },
    point_justice: { categories: ["securite", "papiers"], urgent: false },
    cidff: { categories: ["securite", "famille", "papiers"], urgent: false },
    protection_enfance: { categories: ["famille", "securite"], urgent: true },
    samu: { categories: ["sante"], urgent: true },
    smur: { categories: ["sante"], urgent: true },
    urgences_medicales: { categories: ["sante"], urgent: true },
    urgences_hospitalieres: { categories: ["sante"], urgent: true },
    pompiers_sdis: { categories: ["sante", "securite"], urgent: true },
    urgences_psychiatriques: { categories: ["sante", "parler"], urgent: true },
    samu_social: { categories: ["logement", "autre"], urgent: true },
    siao_115: { categories: ["logement", "autre"], urgent: true },
    hebergement_urgence: { categories: ["logement"], urgent: true },
    chu: { categories: ["logement"], urgent: true },
    chrs: { categories: ["logement"], urgent: true },
    accueil_jour_sans_domicile: { categories: ["logement", "hygiene"], urgent: true },
    mise_a_l_abri: { categories: ["logement", "securite"], urgent: true },
    banque_alimentaire: { categories: ["manger"], urgent: false },
    aide_alimentaire: { categories: ["manger"], urgent: false },
    distribution_alimentaire: { categories: ["manger"], urgent: false },
    epicerie_solidaire: { categories: ["manger"], urgent: false },
    restos_du_coeur: { categories: ["manger"], urgent: false },
    secours_populaire: { categories: ["manger"], urgent: false },
    croix_rouge_sociale: { categories: ["manger", "autre"], urgent: false },
    repas_chaud: { categories: ["manger"], urgent: false },
    maraude_alimentaire: { categories: ["manger"], urgent: false },
    mission_locale: { categories: ["travail", "jeunes"], urgent: false },
    mission_emploi: { categories: ["travail", "jeunes"], urgent: false },
    france_travail: { categories: ["travail"], urgent: false },
    cap_emploi: { categories: ["travail"], urgent: false },
    maison_de_l_emploi: { categories: ["travail"], urgent: false },
    plie: { categories: ["travail"], urgent: false },
    structure_insertion: { categories: ["travail"], urgent: false },
    chantier_insertion: { categories: ["travail"], urgent: false },
    entreprise_adaptee: { categories: ["travail"], urgent: false },
    ccas_aide_financiere: { categories: ["travail", "autre"], urgent: false },
    point_conseil_budget: { categories: ["travail"], urgent: false },
    banque_de_france_surendettement: { categories: ["travail", "papiers"], urgent: false },
    assistante_sociale: { categories: ["travail", "autre"], urgent: false },
    france_services: { categories: ["papiers", "autre"], urgent: false },
    mairie: { categories: ["papiers", "autre"], urgent: false },
    prefecture: { categories: ["papiers"], urgent: false },
    sous_prefecture: { categories: ["papiers"], urgent: false },
    ants_france_titres: { categories: ["papiers"], urgent: false },
    caf: { categories: ["papiers", "famille", "travail"], urgent: false },
    cpam: { categories: ["papiers", "sante"], urgent: false },
    finances_publiques: { categories: ["papiers"], urgent: false },
    domiciliation: { categories: ["papiers", "logement"], urgent: false },
    ecrivain_public: { categories: ["papiers"], urgent: false },
    hopital: { categories: ["sante"], urgent: false },
    centre_de_sante: { categories: ["sante"], urgent: false },
    maison_medicale: { categories: ["sante"], urgent: false },
    cabinet_medical: { categories: ["sante"], urgent: false },
    pharmacie: { categories: ["sante"], urgent: false },
    pmi: { categories: ["sante", "famille"], urgent: false },
    cmp: { categories: ["sante", "parler"], urgent: false },
    cmpp: { categories: ["sante", "parler", "famille"], urgent: false },
    maison_des_adolescents: { categories: ["jeunes", "parler", "famille"], urgent: false },
    csapa: { categories: ["sante", "parler"], urgent: false },
    caarud: { categories: ["sante", "parler"], urgent: false },
    cegidd: { categories: ["sante"], urgent: false },
    planning_familial: { categories: ["sante", "famille", "securite"], urgent: false },
    pass: { categories: ["sante", "papiers"], urgent: false },
    accompagnement_handicap: { categories: ["sante", "autre"], urgent: false },
    point_information_jeunesse: { categories: ["jeunes"], urgent: false },
    info_jeunes: { categories: ["jeunes"], urgent: false },
    crij: { categories: ["jeunes"], urgent: false },
    bij: { categories: ["jeunes"], urgent: false },
    pij: { categories: ["jeunes"], urgent: false },
    cio: { categories: ["jeunes"], urgent: false },
    crous: { categories: ["jeunes", "travail", "papiers"], urgent: false },
    foyer_jeunes_travailleurs: { categories: ["jeunes", "logement"], urgent: false },
    point_ecoute: { categories: ["parler"], urgent: false },
    association_ecoute: { categories: ["parler"], urgent: false },
    ligne_ecoute: { categories: ["parler"], urgent: false },
    centre_social: { categories: ["autre", "famille"], urgent: false },
    mediation_familiale: { categories: ["famille", "parler"], urgent: false },
    pmi_famille: { categories: ["famille", "sante"], urgent: false },
    aide_sociale_enfance: { categories: ["famille", "securite"], urgent: true },
    centre_maternel: { categories: ["famille", "logement"], urgent: false },
    maison_des_familles: { categories: ["famille"], urgent: false },
    ccas: { categories: ["autre", "papiers"], urgent: false },
    ccas_logement: { categories: ["logement", "autre"], urgent: false },
    mdph: { categories: ["autre", "sante", "papiers"], urgent: false },
    clic: { categories: ["autre"], urgent: false },
    aide_juridique: { categories: ["autre", "papiers"], urgent: false },
    inclusion_numerique: { categories: ["autre", "papiers"], urgent: false },
    mobilite_solidaire: { categories: ["autre", "travail"], urgent: false },
    service_social: { categories: ["autre", "travail"], urgent: false },
    residence_sociale: { categories: ["logement"], urgent: false },
    action_logement: { categories: ["logement"], urgent: false },
    adil: { categories: ["logement"], urgent: false },
    bains_douches: { categories: ["hygiene"], urgent: false },
    vestiaire: { categories: ["vetements"], urgent: false }
  });
  const SERVICE_TYPE_ALIASES = Object.freeze({
    "police": "commissariat",
    "police_station": "commissariat",
    "police_nationale": "police_nationale",
    "police_municipale": "police_municipale",
    "municipal_police": "police_municipale",
    "poste_police": "poste_de_police",
    "gendarmerie_nationale": "gendarmerie",
    "brigade_territoriale": "brigade_gendarmerie",
    "victim_support": "aide_aux_victimes",
    "france_victimes": "france_victimes",
    "domestic_violence_support": "violences_conjugales",
    "violences_conjugales": "violences_conjugales",
    "emergency_medical": "urgences_medicales",
    "medical_emergency": "urgences_medicales",
    "emergency_room": "urgences_hospitalieres",
    "emergency_department": "urgences_hospitalieres",
    "fire_station": "pompiers_sdis",
    "firefighters": "pompiers_sdis",
    "sdis": "pompiers_sdis",
    "samu_social": "samu_social",
    "siao": "siao_115",
    "115": "siao_115",
    "emergency_shelter": "hebergement_urgence",
    "hebergement_urgence": "hebergement_urgence",
    "social_shelter": "hebergement_urgence",
    "night_shelter": "hebergement_urgence",
    "mission_locale": "mission_locale",
    "mission_local": "mission_locale",
    "mission_emploi": "mission_emploi",
    "france_travail": "france_travail",
    "pole_emploi": "france_travail",
    "cap_emploi": "cap_emploi",
    "maison_de_lemploi": "maison_de_l_emploi",
    "maison_de_l_emploi": "maison_de_l_emploi",
    "france_services": "france_services",
    "maison_france_services": "france_services",
    "townhall": "mairie",
    "city_hall": "mairie",
    "prefecture": "prefecture",
    "hospital": "hopital",
    "general_hospital": "hopital",
    "medical_center": "centre_de_sante",
    "medical_clinic": "centre_de_sante",
    "doctor": "cabinet_medical",
    "pharmacy": "pharmacie",
    "psychotherapist": "cmp",
    "counselling": "point_ecoute",
    "youth_centre": "centre_social",
    "social_centre": "centre_social",
    "social_center": "centre_social",
    "food_bank": "banque_alimentaire",
    "soup_kitchen": "repas_chaud",
    "food_sharing": "distribution_alimentaire",
    "social_grocery": "epicerie_solidaire",
    "group_home": "structure_insertion",
    "assisted_living": "residence_sociale",
    "day_centre": "accueil_jour_sans_domicile",
    "outreach": "centre_social",
    "shelter": "hebergement_urgence",
    "register_office": "mairie",
    "employment_agency": "structure_insertion",
    "social_welfare": "service_social",
    "social_services_organization": "service_social",
    "welfare_organization": "service_social",
    "action_logement": "action_logement",
    "adil": "adil",
    "public_bath": "bains_douches",
    "shower": "bains_douches",
    "clothing_bank": "vestiaire"
  });
  const NON_AID_SERVICE_TYPES = Object.freeze([
    "hotel",
    "lodging",
    "hostel",
    "motel",
    "guest_house",
    "airbnb",
    "museum",
    "musee",
    "tourist_attraction",
    "attraction",
    "historic_site",
    "monument",
    "art_gallery",
    "event",
    "festival",
    "concert",
    "visit",
    "guided_visit",
    "restaurant",
    "fast_food",
    "cafe",
    "bar",
    "commerce",
    "shop",
    "retail",
    "tourism"
  ]);
  const PAR_ID = new Map(BESOINS.map((b) => [b.id, b]));
  const PAR_CAPACITE = new Map(BESOINS.map((b) => [b.capacite, b]));
  const besoin = (id) => PAR_ID.get(id) || null;
  const parCapacite = (capacite) => PAR_CAPACITE.get(capacite) || null;
  const capacites = () => BESOINS.map((b) => b.capacite);
  function capacitesVides() {
    const out = {};
    BESOINS.forEach((b) => {
      out[b.capacite] = false;
    });
    return out;
  }
  function tagsARecolter() {
    const parCle = /* @__PURE__ */ new Map();
    BESOINS.forEach((b) => {
      b.tags.forEach((tag) => {
        if (tag.valeurs.includes("*")) return;
        if (!parCle.has(tag.cle)) parCle.set(tag.cle, /* @__PURE__ */ new Set());
        tag.valeurs.forEach((v) => parCle.get(tag.cle).add(v));
      });
    });
    return [...parCle.entries()].map(([cle, valeurs]) => Object.freeze({ cle, valeurs: Object.freeze([...valeurs].sort()) }));
  }
  const CATEGORIES_REQUISES = Object.freeze([...new Set(
    BESOINS.flatMap((b) => b.categories.map((k) => k.id))
  )].sort());
  root.AutourAideTaxonomie = Object.freeze({
    PREUVE,
    BESOINS,
    BESOIN_OUVERT,
    CATEGORIES_REQUISES,
    SOURCE_PRIORITIES,
    CANONICAL_HELP_CATEGORIES,
    SERVICE_TYPES,
    SERVICE_TYPE_ALIASES,
    NON_AID_SERVICE_TYPES,
    besoin,
    parCapacite,
    capacites,
    capacitesVides,
    tagsARecolter
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
