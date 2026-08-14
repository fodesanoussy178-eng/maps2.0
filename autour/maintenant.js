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
    TROP_LOIN:        "trop_loin",
    POSITION_INCONNUE: "position_inconnue",
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
    const pos = ctx.position;
    if (!Array.isArray(pos) || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1]))
      return refus(RAISONS.POSITION_INCONNUE);
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng))
      return refus(RAISONS.TROP_LOIN);

    const d = distanceM(pos[0], pos[1], item.lat, item.lng);
    const rayon = Number(ctx.rayonMax) > 0 ? Number(ctx.rayonMax) : RAYON_MAX_M;
    if (d > rayon) return refus(RAISONS.TROP_LOIN);

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
     3. LA SÉLECTION

     Le plus proche d'abord : « maintenant » se lit avec les pieds. À distance
     égale, celui qui finit le plus tôt passe devant — c'est celui qu'on
     risque de manquer.

     On ne complète JAMAIS jusqu'à trois. S'il n'y a qu'un événement fiable,
     le bloc en montre un.
     =================================================================== */
  function selection(items, contexte) {
    const ctx = contexte || {};
    const retenus = [];
    for (const item of (items || [])) {
      const verdict = fiable(item, ctx);
      if (verdict.retenu) retenus.push({ item, distance: verdict.distance });
    }
    retenus.sort((a, b) => (a.distance - b.distance) ||
      (horodatage(a.item.finLe) - horodatage(b.item.finLe)));
    const combien = Number(ctx.places) > 0 ? Number(ctx.places) : PLACES;
    return retenus.slice(0, combien).map((r) => r.item);
  }

  /* Combien il y en a en tout — le bloc n'en montre que trois, mais il doit
     pouvoir dire qu'il y en a davantage sans mentir sur le nombre. */
  function total(items, contexte) {
    return (items || []).filter((i) => fiable(i, contexte).retenu).length;
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
      ligne: "Rien en cours près de toi à cette heure-ci.",
      sortie: "Voir ce qui ouvre autour",
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
    fiable, selection, total, etat, textes, distanceM,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
