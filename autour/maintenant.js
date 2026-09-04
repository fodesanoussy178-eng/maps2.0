(function (root) {
  "use strict";

  /* ===================================================================
     « Voilà ce que tu peux faire maintenant »

     L'OBJECTIF, ÉCRIT EN UNE PHRASE

     On ouvre Autour, on attend un instant, et au centre de l'écran apparaît
     une petite liste de choses réellement possibles tout de suite. Sans
     appuyer sur rien, sans avoir à comprendre l'interface.

     TROIS DÉFAUTS QUE CE MODULE EXISTE POUR SUPPRIMER

     1. LE BLOC QUI POUSSE TOUT VERS LE BAS. `blocMaintenantAccueil` rendait
        une chaîne vide tant qu'il n'y avait rien à montrer. Quand les
        événements arrivaient — une seconde plus tard, parfois deux — la
        section apparaissait et repoussait les boutons sous le doigt de la
        personne qui était en train d'appuyer. La place doit être RÉSERVÉE dès
        le premier rendu, et rester la même dans les quatre états.

     2. « PAS DE RÉSULTAT » DIT TROP TÔT. Une géolocalisation en cours, une
        recherche qui tourne et un vrai vide se ressemblent quand on ne
        regarde que le nombre de résultats. Ce module distingue les quatre
        situations et ne laisse jamais l'une se faire passer pour l'autre.

     3. LE REMPLISSAGE. Trois emplacements réservés invitent à les remplir.
        Mettre un événement de demain dans « Maintenant » parce qu'il ne reste
        qu'une ligne vide, c'est envoyer quelqu'un devant une porte fermée. On
        montre ce qui est fiable, fût-ce un seul, fût-ce aucun.

     CE QUE CE MODULE NE FAIT PAS

     Il ne calcule aucun statut temporel : c'est le backend qui dit `now`, et
     `temporel.js` qui le lit. Il ne dessine rien non plus. Il décide
     seulement CE QUI A LE DROIT d'entrer, et DANS QUEL ÉTAT on se trouve.
     =================================================================== */

  /* ===================================================================
     1. LES QUATRE ÉTATS

     Quatre, pas trois : `empty` et `error` se ressemblent à l'écran mais ne
     veulent pas dire la même chose. « Il n'y a rien en cours près de toi »
     est une réponse ; « je n'ai pas pu chercher » est un incident. Les
     confondre fait croire à un quartier mort là où il y a une panne réseau.
     =================================================================== */
  const ETATS = Object.freeze({
    LOADING: "loading",
    READY:   "ready",
    EMPTY:   "empty",
    ERROR:   "error",
  });

  /* ===================================================================
     1 bis. CE QUE « MAINTENANT » VEUT DIRE

     Il ne veut plus dire « événements en cours ». Il veut dire : QU'EST-CE QUE
     JE PEUX FAIRE, LÀ, DANS LA ZONE QUE JE REGARDE ?

     Un quartier n'a pas un concert à toute heure. S'en tenir aux événements
     laissait le bloc vide l'essentiel du temps — alors qu'à cette même heure
     il y a un restaurant ouvert à deux rues, un cinéma dont la séance commence
     dans vingt minutes, un musée encore ouvert assez longtemps pour y aller.
     Ce sont des réponses à la question posée ; les taire n'était pas de la
     rigueur, c'était un écran vide.

     Quatre natures, dans cet ordre de priorité. L'ordre n'est pas décoratif :
     un événement en cours est rare et périssable, un restaurant ouvert ne
     l'est pas.

       event_now     un événement a commencé et n'est pas fini
       session_soon  une séance, un départ, un début imminent — on a le temps
                     d'y arriver
       activity_now  un lieu d'activité ouvert : cinéma, musée, piscine, parc,
                     bibliothèque
       open_now      un lieu ouvert où l'on peut aller tout de suite

     CE QUI N'ENTRE JAMAIS, ET LA RÈGLE NE BOUGE PAS D'UN POUCE :
     un événement futur ne sert JAMAIS à remplir. Un concert demain n'est pas
     « maintenant », même s'il ne reste qu'une ligne vide. Un restaurant fermé
     non plus. Un cinéma sans séance atteignable non plus.
     =================================================================== */
  const NATURES = Object.freeze({
    EVENEMENT: "event_now",
    SEANCE:    "session_soon",
    ACTIVITE:  "activity_now",
    OUVERT:    "open_now",
  });

  /* L'ordre de priorité, écrit une fois. */
  const RANG = Object.freeze({
    [NATURES.EVENEMENT]: 0,
    [NATURES.SEANCE]:    1,
    [NATURES.ACTIVITE]:  2,
    [NATURES.OUVERT]:    3,
  });

  /* Une séance qui commence dans deux heures n'est pas « maintenant » ; une
     qui commence dans trois minutes n'est pas atteignable. La fenêtre dit les
     deux bornes, et elle est volontairement courte. */
  const SEANCE_MIN_MS = 5 * 60000;
  const SEANCE_MAX_MS = 75 * 60000;

  /* Les familles servent à la DIVERSITÉ, pas au classement. Trois fast-foods
     répondent trois fois à la même question ; un événement, un cinéma et un
     restaurant répondent à trois questions différentes. */
  const FAMILLES = Object.freeze({
    event: "sortir", concert: "sortir", spectacle: "sortir", popup: "sortir",
    rencontre: "sortir", studio: "sortir",
    cinema: "ecran",
    musee: "culture", biblio: "culture", mairie: "culture",
    resto: "manger", fastfood: "manger", food: "manger", marche: "manger",
    cafe: "boire", bar: "boire",
    sport: "bouger", terrain: "bouger", parc: "bouger", piscine: "bouger",
    velo: "bouger",
    collecte: "aide", alimentaire: "aide", asso: "aide", hebergement: "aide",
  });

  const familleDe = (item) => {
    const canonique = item && (item.canonicalFamily || item.foodSpecialty);
    if (canonique === "food" || ["resto", "fastfood", "cafe", "boulangerie", "marche",
      "burger", "pizza", "japonais", "italien", "kebab"].includes(canonique)) return "manger";
    return canonique || (item && item.famille) ||
      FAMILLES[(item && (item.canonicalCategory || item.categorie)) || ""] || "autre";
  };

  /* Dans un aperçu de trois cartes, un seul lieu de bouche suffit. Un café,
     un bar et un restaurant répondent à la même envie pratique ; la deuxième
     place doit laisser respirer une activité, une culture ou une sortie. */
  const estNourriture = (item, famille) => {
    const f = famille || familleDe(item);
    return f === "manger" ||
      ["resto", "restaurant", "fastfood", "food", "marche", "cafe", "bar", "boulangerie",
       "boulangerie", "bakery"].includes(String(item && item.categorie || "").toLowerCase());
  };

  /* Les catégories qui valent « activité » plutôt que simple « ouvert ». Un
     musée ouvert est une sortie ; une supérette ouverte est une commodité. */
  const ACTIVITES = Object.freeze(["cinema", "musee", "biblio", "parc", "terrain",
    "piscine", "sport", "spectacle", "concert", "coworking"]);

  /* ---- CE QUI N'EST PAS UNE PROPOSITION ---------------------------------

     Un supermarché ouvert, une pharmacie ouverte, une station de métro : ce
     sont des commodités. Elles ont leur place sur la carte et dans « Autour
     de toi » — on doit pouvoir les trouver — mais elles n'ont rien à faire
     dans une sélection qui répond à « qu'est-ce que je fais maintenant ».

     La règle d'admission des LIEUX était « ouvert + assez proche ». À cette
     heure-ci, dans n'importe quel centre-ville, cela décrit d'abord Carrefour,
     Zara et la pharmacie de garde : « Maintenant » se remplissait donc de
     l'annuaire des commerces ouverts, et les trois places qu'il possède —
     les seules qu'on lit d'un coup d'œil — étaient prises avant que le
     moindre concert n'arrive.

     Elles restent admissibles quand on les DEMANDE : « pharmacie ouverte
     maintenant » est une intention explicite, et là c'est exactement ce
     qu'il faut montrer. C'est le seul cas.

     LES SERVICES FINANCIERS EN FONT PARTIE, et ils n'y étaient pas. Non par
     choix : la catégorie « banque » n'existait nulle part, et une agence
     arrivait ici étiquetée « commerce ». Elle était donc écartée par accident
     — pour la mauvaise raison, et seulement tant que cet accident durait.
     Maintenant qu'elle porte son nom, elle doit être nommée ici aussi :
     retirer de l'argent est une course, jamais une proposition de sortie. */
  const COMMODITES = Object.freeze(["commerce", "friperie", "marche", "sante",
    "metro", "bus", "tram", "train", "velo", "recharge", "toilettes",
    "mairie", "ecole", "emploi", "banque"]);

  const estCommodite = (categorie) => COMMODITES.indexOf(categorie) >= 0;

  /* Une commodité n'entre que si la personne l'a nommée — catégorie choisie
     dans l'interface, ou tapée en toutes lettres. `demandees` est la liste
     que l'appelant a comprise ; il n'y a aucune devinette ici. */
  function commoditeDemandee(categorie, ctx) {
    const demandees = (ctx && ctx.categoriesDemandees) || null;
    if (!demandees || !demandees.length) return false;
    return demandees.indexOf(categorie) >= 0;
  }

  /* Trois emplacements, réservés dès le premier rendu et jamais davantage.
     Trois est le nombre qu'on lit d'un coup d'œil sans choisir. */
  const PLACES = 3;

  /* Au-delà, « autour de toi » devient faux. Une demi-heure à pied est déjà
     beaucoup pour quelque chose qui a lieu MAINTENANT et qui finira peut-être
     avant qu'on arrive. */
  const RAYON_MAX_M = 3000;

  /* ===================================================================
     2. CE QUI A LE DROIT D'ENTRER

     La règle est volontairement stricte, et chaque refus porte un nom : quand
     le bloc est vide, on doit pouvoir dire POURQUOI sans relire le code.
     =================================================================== */
  const RAISONS = Object.freeze({
    PAS_UN_EVENEMENT: "pas_un_evenement",
    ANNULE:           "annule",
    PAS_EN_COURS:     "pas_en_cours",
    DATE_INCERTAINE:  "date_incertaine",
    PAS_COMMENCE:     "pas_commence",
    DEJA_FINI:        "deja_fini",
    SANS_FIN:         "sans_fin",
    FERME:            "ferme",
    COMMODITE:        "commodite",
    FERME_VERIFIE:    "ferme_verifie",
    TROP_LOIN:        "trop_loin",
    POSITION_INCONNUE: "position_inconnue",
    PAS_OUVERT:       "pas_ouvert",
    HORAIRE_INCONNU:  "horaire_inconnu",
    FERME_TROP_TOT:   "ferme_trop_tot",
    SEANCE_TROP_LOIN: "seance_trop_loin",
    SEANCE_TROP_PROCHE: "seance_trop_proche",
    SANS_NOM:         "sans_nom",
    CATEGORIE_INVALIDE: "categorie_invalide",
    IDENTITE_CANONIQUE_INVALIDE: "identite_canonique_invalide",
    TEMPS_INEXPLOITABLE: "temps_inexploitable",
    RETENU:           "retenu",
  });

  /* Une icône, un libellé de catégorie ou un tiret ne sont pas un nom. Cette
     règle appartient au moteur : une fiche qui arrive ici sans titre
     exploitable ne doit pouvoir atteindre aucun rendu de « Maintenant ». */
  function nomExploitable(value) {
    const texte = String(value == null ? "" : value).trim();
    return texte.length >= 2 && /[\p{L}\p{N}]/u.test(texte);
  }

  function categorieExploitable(value) {
    const categorie = String(value == null ? "" : value).trim().toLowerCase();
    /* Les catégories canoniques sont des slugs ; un pictogramme ou une
       phrase fournisseur ne peut pas servir à classer une proposition. */
    return /^[a-z][a-z0-9_-]*$/.test(categorie);
  }

  /* « Maintenant » ne classe que des entités canoniques déjà enrichies. Le
     fallback historique `id` seul ne suffit pas : il permettait à une ligne
     issue d'un fournisseur incomplet de se glisser jusqu'à l'interface. */
  function qualiteProposition(item) {
    if (!item || item.sansNom === true ||
        !nomExploitable(item.titre || item.title || item.name))
      return refus(RAISONS.SANS_NOM);
    const categorie = String(item.canonicalCategory || item.categorie || item.category || item.cat || "").trim();
    const categorieCanonique = String(item.canonicalCategory || (item.canonical &&
      (item.canonical.category || item.canonical.categorie || item.canonical.cat)) || "").trim();
    if (!categorieExploitable(categorie) || !categorieExploitable(categorieCanonique) ||
        categorie.toLowerCase() !== categorieCanonique.toLowerCase())
      return refus(RAISONS.CATEGORIE_INVALIDE);
    const type = String(item.entity_type || item.entityType || "").toLowerCase();
    const identifiant = item.canonical_id || item.canonicalId ||
      (item.canonical && item.canonical.id) || null;
    if (!(type === "event" || type === "place") || identifiant == null ||
        String(identifiant).trim() === "" ||
        !item.canonical || typeof item.canonical !== "object")
      return refus(RAISONS.IDENTITE_CANONIQUE_INVALIDE);
    /* Les événements sont validés par `fiable` avec leurs deux bornes. Pour
       un lieu permanent, l'application doit transmettre un verdict
       d'ouverture horodaté ; un booléen historique ne suffit plus. */
    /* UN « OUVERT » VÉRIFIÉ EST UN VERDICT HORODATÉ, LUI AUSSI.

       `tempsValide` vient de `availability.js`, qui ne sait rien dire d'un
       lieu sans horaires — et c'est le cas de la plupart des lieux la nuit.
       Le calque vérifié répond exactement à cette question-là : quand il a
       écrit « open », exiger en plus un verdict d'horaires revenait à jeter
       la réponse qu'on était allé chercher. `disponible()` traitait déjà ce
       statut comme faisant autorité (`ouvertVerifie`) ; ce contrôle-ci ne le
       savait pas, et refusait le lieu avant qu'il y arrive. */
    if (!item.estEvenement && item.tempsValide !== true &&
        item.current_status !== "open")
      return refus(RAISONS.TEMPS_INEXPLOITABLE);
    return { retenu: true, raison: RAISONS.RETENU, distance: null };
  }

  const TERRE_M = 6371000;
  function distanceM(aLat, aLng, bLat, bLng) {
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLng = (bLng - aLng) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * TERRE_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* `item` est déjà normalisé par l'application :
       { id, estEvenement, annule, enCours, dateIncertaine,
         debutLe, finLe, lat, lng, ferme }
     `enCours` est le verdict de `temporel.js`, qui le tient du backend. On ne
     le recalcule pas — mais on revérifie les bornes, parce qu'un verdict est
     un résumé et que les bornes sont la règle. */
  function fiable(item, contexte) {
    const ctx = contexte || {};
    const t = Number(ctx.maintenant) || Date.now();

    if (!item || !item.estEvenement) return refus(RAISONS.PAS_UN_EVENEMENT);
    if (item.annule) return refus(RAISONS.ANNULE);

    /* LE VOCABULAIRE DES STATUTS N'APPARTIENT PAS À CE MODULE.

       Une première version comparait `item.statut` à la chaîne « now ». Le
       moteur temporel dit en réalité « happening_now », et rien n'entrait
       jamais dans « Maintenant » — le bloc restait vide en permanence sans
       qu'aucun test de logique ne le voie, puisque les tests employaient le
       même mot inventé.

       On ne compare donc plus de chaînes : l'appelant transmet le verdict de
       `temporel.js`, qui est la seule autorité sur ce sujet. Deux booléens,
       et aucune façon de se tromper de dialecte. */
    /* En production, le verdict canonique est recalculé ici depuis les mêmes
       bornes que les fiches et le classement. Les champs historiques restent
       uniquement le repli des tests/consommateurs qui chargent ce module seul. */
    const T = root.AutourTemps;
    const etat = T && typeof T.statutTemporel === "function"
      ? T.statutTemporel(item, t, {disponibilite:ctx.disponibilite || ctx.availabilityAt}) : null;
    if (etat) {
      if (etat.status === "unknown") return refus(RAISONS.DATE_INCERTAINE);
      if (etat.status === "past") return refus(etat.annule ? RAISONS.ANNULE : RAISONS.DEJA_FINI);
      if (etat.status !== "now") return refus(RAISONS.PAS_EN_COURS);
    } else {
      if (item.dateIncertaine) return refus(RAISONS.DATE_INCERTAINE);
      if (!item.enCours) return refus(RAISONS.PAS_EN_COURS);
    }

    /* LA RÈGLE, REVÉRIFIÉE ICI MÊME.

       `start_at <= NOW() AND end_at >= NOW()`. Une heure de fin absente n'est
       jamais inventée : sans elle, on ne sait pas si c'est encore en cours, et
       « on ne sait pas » ne rentre pas. */
    /* `Number(null)` et `Number("")` valent tous les deux ZÉRO, et zéro est un
       nombre fini. Une première version s'y est laissé prendre : un événement
       sans date de début passait le contrôle, puis « 0 > maintenant » était
       faux, et il entrait dans « Maintenant ». Une date absente doit être
       reconnue comme absente, pas convertie en 1er janvier 1970. */
    const debut = horodatage(item.debutLe);
    const fin = horodatage(item.finLe);
    if (debut === null) return refus(RAISONS.DATE_INCERTAINE);
    if (fin === null) return refus(RAISONS.SANS_FIN);
    if (debut > t) return refus(RAISONS.PAS_COMMENCE);
    if (fin < t) return refus(RAISONS.DEJA_FINI);

    /* Le lieu fermé, QUAND l'information existe. La plupart des lieux
       OpenStreetMap n'ont aucun horaire : les écarter tous viderait le bloc
       pour rien. On n'écarte donc que ce qu'on sait fermé. */
    if (item.ferme === true) return refus(RAISONS.FERME);

    /* Sans position valide, « autour de toi » n'a pas de sens : on ne peut ni
       classer ni promettre une distance. Ce n'est pas un vide, c'est une
       question sans réponse — et l'état l'appellera par son nom. */
    const d = distanceDe(item, ctx);
    if (d === null) return refus(RAISONS.POSITION_INCONNUE);
    if (!Number.isFinite(d)) return refus(RAISONS.TROP_LOIN);
    if (d > rayonDe(ctx)) return refus(RAISONS.TROP_LOIN);

    return { retenu: true, raison: RAISONS.RETENU, distance: d };
  }

  function refus(raison) { return { retenu: false, raison, distance: null }; }

  /* Un horodatage utilisable, ou `null`. Volontairement strict : seul un
     nombre fini et strictement positif compte. `null`, `undefined`, `""` et
     `NaN` sont tous « on ne sait pas », et ils doivent le rester. */
  function horodatage(valeur) {
    if (valeur == null || valeur === "") return null;
    const n = Number(valeur);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /* ===================================================================
     2 bis. LA DISPONIBILITÉ IMMÉDIATE

     `fiable` répond pour les ÉVÉNEMENTS. `disponible` répond pour tout le
     reste : est-ce que je peux y aller, là, tout de suite ?

     C'est ici que se joue la différence entre un moteur d'événements et un
     moteur de disponibilité. Le premier laissait le bloc vide l'essentiel du
     temps ; le second répond à la question qu'on pose vraiment.
     =================================================================== */
  function disponible(item, contexte) {
    const ctx = contexte || {};
    const t = Number(ctx.maintenant) || Date.now();

    /* Un événement passe d'abord par la règle des événements, qui n'a pas
       bougé d'un pouce : commencé, non terminé, daté des deux côtés. */
    if (item && item.estEvenement) {
      const v = fiable(item, ctx);
      if (v.retenu) return retenu(NATURES.EVENEMENT, v.distance);

      /* UNE SEULE EXCEPTION, ET CE N'EST PAS DU REMPLISSAGE : la séance qui
         commence dans quelques minutes. « Le film est dans vingt minutes » est
         une réponse à « qu'est-ce que je peux faire maintenant » — pas « le
         concert est demain ». La fenêtre est courte des deux côtés : trop tôt
         et on n'y sera pas, trop tard et ce n'est plus maintenant.

         SEULS DEUX REFUS OUVRENT CE CHEMIN, et ce sont les deux refus de
         TIMING. `fiable` répond `pas_en_cours` avant même de regarder les
         bornes — le verdict du moteur temporel passe en premier, c'est voulu —
         si bien qu'une première version, qui n'acceptait que `pas_commence`,
         ne trouvait jamais aucune séance. Une annulation, une date incertaine
         ou une fin manquante, elles, ne deviennent JAMAIS une séance : ce
         serait exactement le remplissage qu'on refuse. */
      if (v.raison !== RAISONS.PAS_COMMENCE && v.raison !== RAISONS.PAS_EN_COURS)
        return refusNature(v.raison);
      const debut = horodatage(item.debutLe);
      if (debut === null) return refusNature(RAISONS.DATE_INCERTAINE);
      if (horodatage(item.finLe) === null) return refusNature(RAISONS.SANS_FIN);
      const dans = debut - t;
      // déjà commencé mais pas « en cours » selon le moteur : c'est fini
      if (dans <= 0) return refusNature(RAISONS.DEJA_FINI);
      if (dans > SEANCE_MAX_MS) return refusNature(RAISONS.SEANCE_TROP_LOIN);
      if (dans < SEANCE_MIN_MS) return refusNature(RAISONS.SEANCE_TROP_PROCHE);
      const d = distanceDe(item, ctx);
      if (d === null) return refusNature(RAISONS.POSITION_INCONNUE);
      if (d > rayonDe(ctx)) return refusNature(RAISONS.TROP_LOIN);
      return retenu(NATURES.SEANCE, d);
    }

    /* ---- LE CALQUE VÉRIFIÉ PASSE EN PREMIER -----------------------------

       Ordre de vérité : un enrichissement officiel frais l'emporte sur une
       donnée institutionnelle récente, qui l'emporte sur un tag OpenStreetMap,
       ancien ou non. Le serveur a déjà refusé d'écrire un statut qu'aucune
       source assez sûre n'appuyait (voir `peutEcraserOsm`) : ce qui arrive ici
       a donc déjà passé cet examen, et on n'en refait pas un second.

       Une fermeture temporaire EXCLUT. C'est le cas qui justifie à lui seul
       toute cette couche : le lieu que nos données disent ouvert et dont la
       page officielle annonce des travaux ne doit plus être proposé. */
    if (item.temporary_closed === true) return refusNature(RAISONS.FERME_VERIFIE);
    if (item.current_status === "closed" || item.current_status === "permanently_closed")
      return refusNature(RAISONS.FERME_VERIFIE);
    /* À l'inverse, un « ouvert » vérifié lève l'inconnu que nos données
       laissaient : c'est exactement ce qu'on est allé chercher. */
    const ouvertVerifie = item.current_status === "open";

    /* En production, l'état d'ouverture partagé prime sur les anciens
       booléens portés par le modèle Maintenant. Le petit adaptateur conserve
       les champs du lieu canonique pour que ce module ne reparsé jamais
       `opening_hours` lui-même. Les fixtures historiques, chargées sans
       availability.js, continuent naturellement par le chemin de repli. */
    const A = root.AutourAvailability;
    if (A && typeof A.etatOuverture === "function") {
      const source = Object.assign({}, item.canonical || {}, item, {
        cat: item.categorie || item.canonicalCategory || item.cat,
        category: item.category || item.canonicalCategory || item.categorie || item.cat,
        openingHours: item.openingHours || item.opening_hours || item.horaires || item.quand,
        timezone: item.timezone || item.timeZone || (item.canonical && item.canonical.timezone),
      });
      const ouverture = A.etatOuverture(source, t);
      /* L'inconnu d'`availability.js` cède devant un « ouvert » vérifié, et
         devant lui seul : c'est précisément le silence que le calque est allé
         lever. Un « closed » calculé sur de vrais horaires, lui, garde le
         dernier mot — on ne montre jamais ouvert ce que les horaires ferment. */
      if ((!ouverture || ouverture.openingStatus === "unknown") && !ouvertVerifie)
        return refusNature(RAISONS.HORAIRE_INCONNU);
      if (ouverture && ouverture.openingStatus === "closed")
        return refusNature(RAISONS.PAS_OUVERT);
      if (item.ouvertALArrivee === false)
        return refusNature(RAISONS.FERME_TROP_TOT);
    }

    /* Un LIEU. Trois conditions, et pas une de moins.

       `ouvert` vaut `true`, `false` ou `null`. Le `null` est le cas le plus
       fréquent — la plupart des lieux OpenStreetMap n'ont aucun horaire — et
       c'est précisément celui qu'il ne faut pas confondre avec « ouvert » :
       envoyer quelqu'un devant une porte close parce qu'on ne savait pas est
       exactement ce qu'on veut éviter. Dans « Maintenant », l'inconnu ne
       passe pas. */
    if (item.ouvert !== true && !ouvertVerifie) {
      return refusNature(item.ouvert === false ? RAISONS.PAS_OUVERT
                                               : RAISONS.HORAIRE_INCONNU);
    }
    /* Ouvert, mais pour combien de temps ? `availability.js` connaît les
       marges par type — arriver au musée trois minutes avant la fermeture
       n'est pas une visite. Quand il dit non, on l'écoute. */
    if (item.ouvertALArrivee === false) return refusNature(RAISONS.FERME_TROP_TOT);

    const d = distanceDe(item, ctx);
    if (d === null) return refusNature(RAISONS.POSITION_INCONNUE);
    if (d > rayonDe(ctx)) return refusNature(RAISONS.TROP_LOIN);

    /* UNE PROGRAMMATION EN COURS EST UNE SORTIE, PAS UNE OUVERTURE.

       Un musée ouvert est une commodité culturelle ; un musée qui a une
       exposition en ce moment est une proposition. C'est la même distinction
       qu'entre « c'est ouvert » et « il s'y passe quelque chose », et elle
       vaut une remontée franche : `ACTIVITE` passe devant `OUVERT` dans RANG.

       `programme_soon`, lui, ne remonte JAMAIS ici : ce qui commence demain
       n'a pas lieu maintenant, et le faire entrer viderait le mot de son sens.
       Il appartient aux créneaux « ce soir » et « à venir ». */
    const programmeEnCours = Array.isArray(item.programme_now) && item.programme_now.length > 0;

    /* Ouvert, proche, et pourtant pas une proposition : voir COMMODITES.
       Une programmation vérifiée lève cette exclusion — une salle qui joue ce
       soir n'est plus une commodité, quoi que dise sa catégorie. */
    if (estCommodite(item.categorie) && !commoditeDemandee(item.categorie, ctx)
        && !programmeEnCours)
      return refusNature(RAISONS.COMMODITE);

    const activite = programmeEnCours || ACTIVITES.indexOf(item.categorie) >= 0;
    return retenu(activite ? NATURES.ACTIVITE : NATURES.OUVERT, d);
  }

  const retenu = (nature, distance) =>
    ({ retenu: true, nature, raison: RAISONS.RETENU, distance });
  const refusNature = (raison) =>
    ({ retenu: false, nature: null, raison, distance: null });

  function rayonDe(ctx) {
    return Number(ctx.rayonMax) > 0 ? Number(ctx.rayonMax) : RAYON_MAX_M;
  }

  function distanceDe(item, ctx) {
    /* UNE POSITION DE REPLI N'EST PAS UNE POSITION.

       Quand la géolocalisation est refusée, Autour pose quand même la carte
       quelque part — une ville déduite d'une adresse IP, un point par défaut.
       `pointDeReference()` rend donc des coordonnées parfaitement valides, et
       les lieux ouverts alentour passaient tous : le bloc affichait trois
       restaurants « autour de toi » à quelqu'un dont personne ne savait où il
       était. Tant que le point n'est pas CONNU — mesuré, ou choisi — rien
       n'est autour de qui que ce soit. */
    if (ctx.positionConnue === false) return null;
    const pos = ctx.position;
    if (!Array.isArray(pos) || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return Infinity;
    return distanceM(pos[0], pos[1], item.lat, item.lng);
  }

  /* ===================================================================
     3 bis. CE SOIR

     « Ce soir » n'est pas un filtre d'agenda. Il répond par couches : ce qui
     se passe, une séance, une activité ouverte, puis un lieu pertinent ouvert.
     Le point important est l'instant de contrôle : le matin, on sonde la plage
     de ce soir, jamais l'état à l'heure où la personne consulte.
     =================================================================== */
  const UTILITAIRES_SOIR = new Set([
    "commerce", "supermarche", "sante", "pharmacie",
    "station_service", "essence", "metro", "bus", "tram",
    "train", "velo", "recharge", "toilettes", "mairie", "administration",
    "banque", "ecole", "emploi", "france_travail", "caf",
  ]);
  const LIEUX_PERTINENTS_SOIR = new Set([
    "resto", "restaurant", "fastfood", "food", "cafe", "bar", "cinema",
    "musee", "museum", "biblio", "bibliotheque", "library", "parc", "terrain",
    "piscine", "sport", "spectacle", "concert", "coworking",
  ]);

  function horodatageSoir(value, timeZone) {
    if (value == null || value === "") return null;
    const T = root.AutourTemps;
    const t = T && typeof T.toEpochInZone === "function"
      ? T.toEpochInZone(value, timeZone || "Europe/Paris")
      : (typeof value === "number" ? value : new Date(value).getTime());
    return Number.isFinite(t) ? t : null;
  }

  function bornesSoir(ctx) {
    const o = ctx || {};
    if (Number.isFinite(Number(o.soirDebut)) && Number.isFinite(Number(o.soirFin)))
      return {debut:Number(o.soirDebut), fin:Number(o.soirFin)};
    const T = root.AutourTemps;
    if (T && typeof T.fenetreSoir === "function")
      return T.fenetreSoir(Number(o.maintenant) || Date.now(), o.timeZone || "Europe/Paris");
    /* Repli uniquement pour les tests/consommateurs qui chargent ce module seul.
       L'application charge temporel.js et prend le chemin au-dessus, qui gère
       aussi les changements d'heure. */
    const d = new Date(Number(o.maintenant) || Date.now());
    const debut = new Date(d);
    debut.setHours(18, 0, 0, 0);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);
    fin.setHours(0, 0, 0, 0);
    return {debut:debut.getTime(), fin:fin.getTime()};
  }

  function evenementDe(item) {
    return !!(item && (item.estEvenement || item.isTemporary || item.event === true));
  }

  function seanceDe(item) {
    if (!item) return false;
    const nature = String(item.nature || item.kind || item.type || "").toLowerCase();
    return item.session === true || nature === "session" || nature === "screening" ||
      nature === NATURES.SEANCE || item.isSession === true;
  }

  function categorieDe(item) {
    return String(item && (item.canonicalCategory || item.categorie || item.category || item.cat) || "").toLowerCase()
      .replace(/[ -]+/g, "_");
  }

  function evenementDansSoir(item, ctx, bornes) {
    const T = root.AutourTemps;
    if (T && typeof T.estDansFenetre === "function")
      return T.estDansFenetre(item, bornes, Number(ctx.maintenant) || Date.now(), {
        disponibilite:ctx.disponibilite || ctx.availabilityAt,
      });
    const timeZone = item && (item.timezone || item.timeZone);
    const debut = horodatageSoir(item && (item.start_at ?? item.startAt ?? item.startsAt ?? item.debutLe), timeZone);
    const fin = horodatageSoir(item && (item.end_at ?? item.endAt ?? item.endsAt ?? item.finLe), timeZone);
    if (debut == null || fin == null || fin <= debut) return false;
    if (debut >= bornes.fin || fin <= bornes.debut) return false;
    const verdict = typeof ctx.statutTemporel === "function"
      ? ctx.statutTemporel(item, Math.max(bornes.debut, Math.min(Number(ctx.maintenant) || bornes.debut, bornes.fin - 1))) : null;
    const statut = verdict && String(verdict.statut || verdict).toLowerCase();
    if (["past", "unknown", "unknown_date", "annule", "cancelled"].includes(statut)) return false;
    return true;
  }

  function disponiblePendantSoir(item, ctx, bornes) {
    const A = root.AutourAvailability;
    if (A && typeof A.etatOuverture === "function") {
      const etat = A.etatOuverture(item, Number(ctx.maintenant) || Date.now(), {fenetre:bornes});
      if (!etat || etat.openingStatus === "unknown" || etat.openingStatus === "closed") return null;
      return etat.windowAvailability || etat;
    }
    const tester = ctx && (ctx.disponibilite || ctx.disponibiliteA || ctx.availabilityAt);
    if (typeof tester !== "function") return null;
    /* Tous les appels portent sur ce soir. On ne demande jamais l'état à
       ctx.maintenant, ce qui était la cause du vide observé le matin. */
    const premier = tester(item, bornes.debut);
    if (!premier || premier.status === "unknown" || premier.status === "permanently_closed") return null;
    const ouvert = premier.status === "open" || premier.status === "closing_soon";
    if (ouvert) return premier;
    const prochaine = premier.opensAt
      ? horodatageSoir(premier.opensAt, item && (item.timezone || item.timeZone)) : NaN;
    if (!Number.isFinite(prochaine) || prochaine >= bornes.fin) return null;
    const apresOuverture = tester(item, prochaine + 60000);
    if (!apresOuverture || apresOuverture.status === "unknown" ||
        apresOuverture.status === "permanently_closed") return null;
    return (apresOuverture.status === "open" || apresOuverture.status === "closing_soon")
      ? apresOuverture : null;
  }

  function trierSoir(a, b) {
    const da = horodatageSoir(a.item && (a.item.start_at ?? a.item.startAt ?? a.item.startsAt ?? a.item.debutLe),
      a.item && (a.item.timezone || a.item.timeZone));
    const db = horodatageSoir(b.item && (b.item.start_at ?? b.item.startAt ?? b.item.startsAt ?? b.item.debutLe),
      b.item && (b.item.timezone || b.item.timeZone));
    return (a.distance - b.distance) || ((da == null ? Infinity : da) - (db == null ? Infinity : db));
  }

  function selectionCeSoir(items, contexte) {
    const ctx = contexte || {};
    const bornes = bornesSoir(ctx);
    const couches = [[], [], [], []];
    for (const item of (items || [])) {
      if (!item) continue;
      const distance = distanceDe(item, ctx);
      if (distance == null || !Number.isFinite(distance) || distance > rayonDe(ctx)) continue;
      if (evenementDe(item) && evenementDansSoir(item, ctx, bornes)) {
        const session = seanceDe(item);
        (session ? couches[1] : couches[0]).push({item, distance,
          nature:session ? NATURES.SEANCE : NATURES.EVENEMENT});
        continue;
      }
      if (evenementDe(item)) continue;
      const categorie = categorieDe(item);
      if (UTILITAIRES_SOIR.has(categorie)) continue;
      const dispo = disponiblePendantSoir(item, ctx, bornes);
      if (!dispo) continue;
      const cleProgrammeProchain = "programme_" + "soon";
      const activite = ACTIVITES.includes(categorie) ||
        (Array.isArray(item[cleProgrammeProchain]) && item[cleProgrammeProchain].length > 0);
      if (activite) couches[2].push({item, distance, nature:NATURES.ACTIVITE, dispo});
      else if (LIEUX_PERTINENTS_SOIR.has(categorie))
        couches[3].push({item, distance, nature:NATURES.OUVERT, dispo});
    }
    const max = Number(ctx.places) > 0 ? Number(ctx.places) : PLACES;
    const resultat = [];
    for (const couche of couches) {
      couche.sort(trierSoir);
      for (const candidat of couche) {
        if (resultat.length >= max)
          return resultat.map((x) => Object.assign({}, x.item, {nature:x.nature}));
        resultat.push(candidat);
      }
    }
    return resultat.map((x) => Object.assign({}, x.item, {nature:x.nature}));
  }

  /* ===================================================================
     3. LA SÉLECTION

     Trois règles, dans cet ordre :

       1. la NATURE d'abord — un événement en cours est rare et périssable, un
          restaurant ouvert ne l'est pas ;
       2. la DIVERSITÉ ensuite — trois fast-foods répondent trois fois à la
          même question. Un événement, un cinéma et un restaurant répondent à
          trois questions différentes, et c'est ce qu'on veut voir ;
       3. la DISTANCE enfin — « maintenant » se lit avec les pieds.

     On ne complète JAMAIS avec quelque chose qui n'est pas disponible. S'il
     n'y a qu'une proposition, le bloc en montre une.
     =================================================================== */
  /* ===================================================================
     3 ter. LE FILET NOCTURNE

     LA RÈGLE GÉNÉRALE NE BOUGE PAS. Un commerce ordinaire n'est pas une
     proposition : `COMMODITES` l'écarte, et c'est ce qui empêche « Maintenant »
     de devenir l'annuaire des épiceries ouvertes. À quinze heures, une supérette
     ouverte n'a rien à y faire.

     À deux heures du matin, la même supérette est parfois la seule chose utile
     à cent mètres. Et « Rien à afficher dans cette zone » est alors faux : il y
     a quelque chose, on a simplement refusé de le dire.

     CE FILET NE S'OUVRE QUE SUR UN ÉCRAN VIDE. Il est évalué après — jamais
     avant — le constat que la sélection éditoriale ne rend rien. Un événement,
     une séance, une activité ou un lieu déjà retenu le rend inutile : la
     hiérarchie en cours > bientôt > programme > repli est préservée par
     construction, puisque le repli n'est consulté qu'une fois les trois
     premières couches vides.

     IL NE RÉÉCRIT AUCUNE RÈGLE D'OUVERTURE. Il rappelle `disponible()` avec les
     catégories de la nuit déclarées comme demandées — exactement le mécanisme
     qui existe déjà pour « pharmacie ouverte maintenant ». Tout le reste tient
     donc sans une ligne de plus : une fermeture vérifiée exclut, un horaire
     inconnu exclut, un lieu trop loin exclut. L'inconnu ne devient jamais
     meilleur qu'un ouvert confirmé, parce qu'il n'entre pas du tout.

     CE QU'IL N'ADMET PAS, même la nuit : transports, banques, administrations,
     santé, infrastructures. Une station de métro ouverte n'est pas une sortie.
     =================================================================== */

  /* Les heures où l'on cherche autre chose. Bornes locales au territoire :
     22 h à Rouen n'est pas 22 h ailleurs, et c'est l'heure du lieu qui décide. */
  const NUIT_DEBUT_H = 22;
  const NUIT_FIN_H = 5;

  /* Ce qui a un sens la nuit. Les bars, la restauration tardive et les lieux de
     sortie sont déjà admissibles le jour ; ils figurent ici parce que le filet
     doit pouvoir les classer, pas parce qu'il les débloque. L'apport réel du
     filet, c'est `commerce` — l'épicerie ouverte, écartée le reste du temps. */
  const NUIT_ADMISES = Object.freeze(["bar", "pub", "cafe", "resto", "restaurant",
    "fastfood", "food", "commerce", "spectacle", "concert", "cinema"]);

  /* Ce qui n'en a aucun, à aucune heure. Une pharmacie de garde reste
     joignable par la demande explicite, qui n'est pas ce chemin-ci. */
  const NUIT_REFUSEES = Object.freeze(["metro", "bus", "tram", "train", "velo",
    "recharge", "toilettes", "banque", "mairie", "administration", "ecole",
    "emploi", "france_travail", "caf", "sante", "pharmacie", "station_service",
    "essence", "supermarche"]);

  function heureLocaleDe(ctx) {
    const o = ctx || {};
    if (Number.isFinite(Number(o.heureLocale))) return Number(o.heureLocale);
    const t = Number(o.maintenant) || Date.now();
    const T = root.AutourTemps;
    if (T && typeof T.partsLocales === "function")
      return T.partsLocales(t, o.timeZone || "Europe/Paris").heure;
    return new Date(t).getHours();
  }

  function estNuit(ctx) {
    const h = heureLocaleDe(ctx);
    return Number.isFinite(h) && (h >= NUIT_DEBUT_H || h < NUIT_FIN_H);
  }

  const admiseLaNuit = (categorie) =>
    NUIT_ADMISES.indexOf(categorie) >= 0 && NUIT_REFUSEES.indexOf(categorie) < 0;

  /* Une vraie photo pèse dans le choix, jamais dans l'admission : à défaut, le
     pictogramme de catégorie reste, et aucune image n'est inventée. */
  const aPhoto = (item) => {
    const u = item && (item.image_url || item.imageUrl || item.image);
    return typeof u === "string" && /^https?:\/\//.test(u);
  };

  /* La qualité de ce qu'on sait : un nom lisible, une adresse, des horaires.
     Trois petits points valent mieux qu'un lieu dont on ne peut rien dire. */
  function qualiteInfos(item) {
    let n = 0;
    if (nomExploitable(item && (item.titre || item.title))) n += 1;
    if (item && (item.adresse || item.address)) n += 1;
    if (item && (item.openingHours || item.opening_hours || item.horaires)) n += 1;
    return n;
  }

  function selectionRepliNocturne(items, contexte) {
    const ctx = contexte || {};
    if (!estNuit(ctx)) return [];
    const combien = Number(ctx.places) > 0 ? Number(ctx.places) : PLACES;

    /* On déclare les catégories de la nuit comme demandées : `disponible()`
       lève alors sa seule exclusion de commodité, et garde toutes les autres. */
    const ctxNuit = Object.assign({}, ctx, {
      categoriesDemandees: NUIT_ADMISES.slice(),
    });

    const pool = [];
    for (const item of (items || [])) {
      if (!item || evenementDe(item)) continue;
      const cat = categorieDe(item);
      if (!admiseLaNuit(cat)) continue;
      if (!qualiteProposition(item).retenu) continue;
      const v = disponible(item, ctxNuit);
      if (!v.retenu) continue;
      pool.push({ item, nature: v.nature, distance: v.distance, categorie: cat });
    }
    if (!pool.length) return [];

    /* Le classement du filet. L'ouverture est déjà acquise — `disponible` n'a
       laissé passer que du confirmé — donc on départage sur ce qui rend une
       proposition utile à cette heure : d'abord la proximité, par paliers de
       cent mètres pour ne pas faire gagner un trottoir contre une photo, puis
       la richesse de la fiche, puis l'image, puis le type de lieu. */
    const rangCategorie = (cat) => {
      if (cat === "bar" || cat === "pub") return 0;
      if (cat === "fastfood" || cat === "food") return 1;
      if (cat === "resto" || cat === "restaurant") return 1;
      if (cat === "cafe") return 2;
      if (cat === "commerce") return 3;
      return 4;
    };
    pool.sort((a, b) => {
      const pa = Math.round((a.distance || 0) / 100);
      const pb = Math.round((b.distance || 0) / 100);
      return (pa - pb)
        || (qualiteInfos(b.item) - qualiteInfos(a.item))
        || ((aPhoto(b.item) ? 1 : 0) - (aPhoto(a.item) ? 1 : 0))
        || (rangCategorie(a.categorie) - rangCategorie(b.categorie))
        || ((a.distance || 0) - (b.distance || 0));
    });

    /* On ne remplit que ce qui existe. Un seul bon bar ouvert donne un seul
       résultat — ajouter deux commerces médiocres pour faire trois serait
       exactement le remplissage que ce module refuse partout ailleurs. */
    const choisis = [];
    const vus = new Set();
    for (const c of pool) {
      if (choisis.length >= combien) break;
      const cle = String(c.item.id != null ? c.item.id : c.item.titre || "");
      if (cle && vus.has(cle)) continue;
      if (cle) vus.add(cle);
      choisis.push(c);
    }
    return choisis.map((c) => Object.assign({}, c.item,
      { nature: c.nature, repliNocturne: true }));
  }

  /* ===================================================================
     3 quater. LA QUESTION QU'ON POSE QUAND LA NUIT NE RÉPOND PAS

     « Horaire inconnu » n'est pas « ouvert », et cette règle ne bouge d'un
     millimètre nulle part dans ce fichier : un lieu dont l'ouverture n'est
     pas vérifiée n'est jamais montré comme ouvert. C'est justement pour ça
     qu'il faut aller CHERCHER la réponse plutôt que la supposer.

     À une heure du matin, la plupart des lieux d'OpenStreetMap n'ont aucun
     horaire. Le filet nocturne les écarte tous, à juste titre, et l'écran
     reste vide — non parce que la ville dort, mais parce que nos données se
     taisent. Autour sait déjà lever ce silence : `place_enrichments` et la
     fonction `enrichir-lieu` existent, avec leur cache et leur budget.

     CE QUE CETTE FONCTION FAIT, ET RIEN D'AUTRE : elle NOMME les deux ou
     trois lieux qu'il vaudrait la peine d'interroger. Elle n'interroge pas,
     elle ne classe pas, elle ne rend rien d'affichable. L'appelant lira le
     cache d'abord, décidera ensuite, et redessinera si — et seulement si —
     une réponse « ouvert » revient. Rien de tout cela n'est sur le chemin
     d'un rendu : l'ouverture d'Autour n'attend jamais cette vérification.

     ELLE NE S'OUVRE QUE SUR UN MANQUE RÉEL. Tant que le filet trouve assez de
     lieux confirmés ouverts, elle rend une liste vide et aucun appel n'est
     dépensé.
     =================================================================== */

  /* Deux ou trois, jamais un balayage. On ne va pas chercher une réponse
     qu'on n'aurait pas la place d'afficher. */
  const NUIT_MAX_VERIFICATIONS = 3;

  /* Le statut est-il VRAIMENT sans réponse, ou déjà tranché ? Un lieu qu'on
     sait fermé — par ses horaires, par une fermeture temporaire, par le
     calque vérifié — n'a rien à nous apprendre : le redemander serait une
     dépense pour confirmer un refus. */
  function statutNocturneSansReponse(item) {
    if (!item) return false;
    if (item.ferme === true) return false;
    if (item.temporary_closed === true) return false;
    if (item.current_status === "closed" ||
        item.current_status === "permanently_closed") return false;
    if (item.current_status === "open") return false;
    return item.ouvert == null;
  }

  function candidatsNocturnesAVerifier(items, contexte) {
    const ctx = contexte || {};
    if (!estNuit(ctx)) return [];
    const combien = Number(ctx.places) > 0 ? Number(ctx.places) : PLACES;

    /* LE CONFIRMÉ D'ABORD, LA QUESTION ENSUITE. Le filet est rejoué ici pour
       compter ce qui tient DÉJÀ debout ; s'il remplit les places, il n'y a
       rien à demander et rien à dépenser. */
    const confirmes = selectionRepliNocturne(items, ctx);
    if (confirmes.length >= combien) return [];
    const manque = combien - confirmes.length;
    const deja = new Set(confirmes.map((x) => String(x.id)));

    const pool = [];
    for (const item of (items || [])) {
      if (!item || evenementDe(item)) continue;
      if (deja.has(String(item.id))) continue;
      if (!admiseLaNuit(categorieDe(item))) continue;
      if (!statutNocturneSansReponse(item)) continue;
      /* L'identité et le nom, oui ; le verdict d'ouverture, non — c'est
         précisément ce qui manque et ce qu'on part chercher. On emprunte donc
         les contrôles d'identité de `qualiteProposition` en neutralisant le
         seul qu'on sait faux ici, plutôt que d'en écrire une seconde version
         qui finirait par diverger. */
      if (!qualiteProposition(Object.assign({}, item, { tempsValide: true })).retenu)
        continue;
      const d = distanceDe(item, ctx);
      if (d === null || d > rayonDe(ctx)) continue;
      pool.push({ item, distance: d });
    }
    if (!pool.length) return [];

    /* Les plus proches, puis les mieux renseignés : à budget égal, une
       réponse sur un lieu à cent mètres vaut mieux qu'à deux kilomètres. */
    pool.sort((a, b) => (a.distance - b.distance)
      || (qualiteInfos(b.item) - qualiteInfos(a.item)));
    return pool.slice(0, Math.min(manque, NUIT_MAX_VERIFICATIONS))
      .map((x) => x.item);
  }

  function candidats(items, contexte) {
    const ctx = contexte || {};
    const out = [];
    for (const item of (items || [])) {
      const qualite = qualiteProposition(item);
      if (!qualite.retenu) continue;
      const v = disponible(item, ctx);
      if (v.retenu) {
        out.push({ item, nature: v.nature, distance: v.distance,
                   famille: familleDe(item), rang: RANG[v.nature] });
      }
    }
    /* Le tri de base : nature, puis distance. À nature ET distance égales, le
       plus urgent — celui qui ferme ou finit le plus tôt. */
    out.sort((a, b) => (a.rang - b.rang) || (a.distance - b.distance) ||
      ((horodatage(a.item.finLe) || Infinity) - (horodatage(b.item.finLe) || Infinity)));
    return out;
  }

  function selection(items, contexte) {
    const ctx = contexte || {};
    const combien = Number(ctx.places) > 0 ? Number(ctx.places) : PLACES;
    const pool = candidats(items, ctx);

    /* LA DIVERSITÉ SE PREND EN DEUX PASSES, ET C'EST VOULU.

       Un tri « une famille sur deux » mélangerait les priorités : il ferait
       passer un café ouvert devant un concert en cours pour cause de variété.
       On prend donc d'abord le MEILLEUR de chaque famille, dans l'ordre de
       priorité ; si les places ne sont pas toutes prises, on complète avec le
       reste du classement. Le premier résultat est toujours le meilleur au
       sens strict — la variété ne coûte jamais la tête de liste. */
    const choisis = [];
    const famillesPrises = new Set();
    let nourriturePrise = false;
    for (const c of pool) {
      if (choisis.length >= combien) break;
      if (famillesPrises.has(c.famille)) continue;
      if (estNourriture(c.item, c.famille) && nourriturePrise) continue;
      famillesPrises.add(c.famille);
      if (estNourriture(c.item, c.famille)) nourriturePrise = true;
      choisis.push(c);
    }
    for (const c of pool) {
      if (choisis.length >= combien) break;
      if (choisis.indexOf(c) >= 0) continue;
      if (estNourriture(c.item, c.famille) && nourriturePrise) continue;
      if (estNourriture(c.item, c.famille)) nourriturePrise = true;
      choisis.push(c);
    }
    /* LE FILET, ET SEULEMENT ICI.

       La condition est le constat, pas une heuristique : la sélection
       éditoriale n'a rien rendu. Tant qu'elle rend ne serait-ce qu'un
       résultat — un événement en cours, une séance, une activité, un lieu —
       ce chemin n'est jamais emprunté, et la hiérarchie tient d'elle-même. */
    if (!choisis.length) return selectionRepliNocturne(items, ctx);

    /* On rend l'ordre de priorité, pas l'ordre de cueillette. */
    choisis.sort((a, b) => (a.rang - b.rang) || (a.distance - b.distance));
    return choisis.map((c) => Object.assign({}, c.item, { nature: c.nature }));
  }

  /* Le moteur ne possède qu'une vitrine : trois propositions éditorialisées.
     Même l'API publique `total` parle de cette sélection, jamais du bassin
     brut de candidats ; le classement interne peut toujours sonder
     `candidats` sans l'exposer à l'interface. */
  function total(items, contexte) {
    return selection(items, contexte).length;
  }

  /* ===================================================================
     4. L'ÉTAT

     L'ordre des questions est le fond du sujet, et il a déjà coûté un défaut :
     une géolocalisation refusée s'affichait comme « rien autour de toi ».
     Quelqu'un en concluait que son quartier était vide alors qu'Autour ne
     savait simplement pas où il était.

     On demande donc, dans cet ordre :
       · est-ce que quelque chose a échoué ?        → error
       · est-ce qu'on cherche encore ?              → loading
       · est-ce qu'on a trouvé ?                    → ready
       · sinon, et seulement sinon                  → empty
     =================================================================== */
  function etat(contexte) {
    const ctx = contexte || {};
    const combien = Number(ctx.resultats) || 0;

    /* Des résultats fiables valent mieux qu'un message : une source en panne
       pendant qu'une autre a répondu ne doit pas effacer ce qu'on a. */
    if (combien > 0) return ETATS.READY;

    /* On demande la POSITION avant de demander les données, et l'ordre a
       coûté un blocage : quand la géolocalisation échouait, la recherche
       d'événements restait « en cours » indéfiniment — puisqu'elle attendait
       un point de départ qui n'arrivait jamais — et le bloc affichait ses
       trois barres grises pour l'éternité.

       Tant qu'on cherche activement la position, c'est un chargement. Dès
       qu'on a fini de chercher SANS l'avoir, c'est une question sans réponse,
       et sûrement pas un « rien autour de toi » : on ne peut pas dire ça à
       quelqu'un dont on ignore où il est. */
    if (ctx.positionEnCours) return ETATS.LOADING;
    if (ctx.positionRefusee || !ctx.positionConnue) return ETATS.ERROR;

    if (ctx.panne) return ETATS.ERROR;
    if (ctx.chargement) return ETATS.LOADING;

    return ETATS.EMPTY;
  }

  /* Ce qui s'écrit dans chaque état. Aucun de ces textes ne parle de code, de
     source ni de statut : ils disent ce qui se passe, du point de vue de la
     personne qui regarde. */
  const TEXTES = Object.freeze({
    [ETATS.LOADING]: { titre: "Maintenant", ligne: "" },
    [ETATS.EMPTY]: {
      titre: "Maintenant",
      /* Le mot a changé avec le sens du bloc. Tant qu'il ne montrait que des
         événements, « rien en cours » était juste. Maintenant qu'il montre
         aussi les lieux ouverts, un bloc vide veut dire que même les portes
         sont closes — et c'est ce qu'il faut écrire. */
      ligne: "Rien d’ouvert ni en cours dans cette zone à cette heure-ci.",
      sortie: "Voir plus loin",
    },
    [ETATS.ERROR]: {
      titre: "Maintenant",
      ligne: "Impossible de savoir ce qui se passe autour de toi.",
      sortie: "Réessayer",
    },
    positionRefusee: {
      titre: "Maintenant",
      ligne: "Autour ne sait pas où tu es.",
      sortie: "Choisir un point de départ",
    },
  });

  function textes(etatCourant, contexte) {
    const ctx = contexte || {};
    /* Le refus explicite ET l'absence de position mènent au même mot. Une
       première version ne regardait que le refus : quand la géolocalisation
       échouait autrement — délai dépassé, appareil sans capteur — l'écran
       affichait « impossible de savoir ce qui se passe », qui ressemble à une
       panne d'Autour alors que la question est ailleurs. */
    if (ctx.positionRefusee || (etatCourant === ETATS.ERROR && !ctx.positionConnue))
      return TEXTES.positionRefusee;
    return TEXTES[etatCourant] || TEXTES[ETATS.EMPTY];
  }

  root.AutourMaintenant = Object.freeze({
    ETATS, PLACES, RAYON_MAX_M, RAISONS, TEXTES,
    NATURES, RANG, FAMILLES, ACTIVITES, COMMODITES, estCommodite,
    SEANCE_MIN_MS, SEANCE_MAX_MS,
    fiable, disponible, candidats, selection, selectionCeSoir, total, etat, textes,
    selectionRepliNocturne, estNuit, NUIT_ADMISES, NUIT_REFUSEES,
    NUIT_DEBUT_H, NUIT_FIN_H,
    candidatsNocturnesAVerifier, statutNocturneSansReponse, NUIT_MAX_VERIFICATIONS,
    distanceM, familleDe, estNourriture, nomExploitable, categorieExploitable,
    qualiteProposition,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
