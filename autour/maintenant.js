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

  const familleDe = (item) => (item && item.famille) ||
    FAMILLES[(item && item.categorie) || ""] || "autre";

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
     qu'il faut montrer. C'est le seul cas. */
  const COMMODITES = Object.freeze(["commerce", "friperie", "marche", "sante",
    "metro", "bus", "tram", "train", "velo", "recharge", "toilettes",
    "mairie", "ecole", "emploi"]);

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
    RETENU:           "retenu",
  });

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
    if (item.dateIncertaine) return refus(RAISONS.DATE_INCERTAINE);
    if (!item.enCours) return refus(RAISONS.PAS_EN_COURS);

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
  function candidats(items, contexte) {
    const ctx = contexte || {};
    const out = [];
    for (const item of (items || [])) {
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
    for (const c of pool) {
      if (choisis.length >= combien) break;
      if (famillesPrises.has(c.famille)) continue;
      famillesPrises.add(c.famille);
      choisis.push(c);
    }
    for (const c of pool) {
      if (choisis.length >= combien) break;
      if (choisis.indexOf(c) >= 0) continue;
      choisis.push(c);
    }
    /* On rend l'ordre de priorité, pas l'ordre de cueillette. */
    choisis.sort((a, b) => (a.rang - b.rang) || (a.distance - b.distance));
    return choisis.map((c) => Object.assign({}, c.item, { nature: c.nature }));
  }

  /* Combien il y en a en tout — le bloc n'en montre que trois, mais il doit
     pouvoir dire qu'il y en a davantage sans mentir sur le nombre. */
  function total(items, contexte) {
    return candidats(items, contexte).length;
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
    fiable, disponible, candidats, selection, total, etat, textes,
    distanceM, familleDe,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
