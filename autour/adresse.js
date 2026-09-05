(function (root) {
  "use strict";

  /* ===================================================================
     CHERCHER UNE VILLE OU UNE ADRESSE, SANS CLÉ ET SANS DEVINER

     LE DÉFAUT QU'ON CORRIGE

     Autour savait déjà voyager : `rechercheGeographique()` interroge
     Nominatim et déplace la carte. Mais Nominatim est un service mondial,
     bénévole, qui plafonne à une requête par seconde et demande qu'on ne
     l'appelle pas depuis chaque téléphone. On ne pouvait donc pas s'en servir
     pour de la SAISIE — une suggestion à chaque lettre l'aurait saturé — et
     la seule façon de changer de ville était de taper un nom entier puis de
     valider, sans savoir si l'application avait compris.

     La Base Adresse Nationale répond à exactement ce besoin : elle est
     française, publique, sans clé, conçue pour l'autocomplétion, et elle
     connaît les quatre échelles dont on a besoin — la commune (« Lille »,
     « Tourcoing »), le lieu-dit, la voie (« Place de la République Lille »)
     et le numéro.

     CE QUE CE MODULE EST

     Une fonction de recherche et un chercheur à saisie. Rien d'autre : il ne
     connaît ni le DOM, ni la carte, ni les zones. Il rend des points nommés ;
     c'est l'appelant qui décide ce qu'il en fait, et c'est `AutourZones` —
     jamais ce fichier — qui dit de quelle zone un point relève.

     CE QU'IL NE FAIT PAS

       · il ne déplace rien et n'affiche rien ;
       · il ne décide pas qu'une saisie est une ville plutôt qu'une intention ;
       · il ne crée aucune zone, et n'en connaît pas la liste ;
       · il ne retient rien entre deux appels, hors le cache de saisie décrit
         plus bas.
     =================================================================== */

  var POINT_ENTREE = "https://api-adresse.data.gouv.fr/search/";

  /* Cinq. Au-delà, la liste déroule sous le clavier d'un téléphone et la
     sixième réponse n'est jamais celle qu'on voulait. */
  var LIMITE_DEFAUT = 5;

  /* Deux caractères ne discriminent rien : « li » rend la France entière et
     la BAN elle-même refuse en deçà de trois. On ne part donc pas. */
  var LONGUEUR_MIN = 3;

  /* 250 ms : sous ce seuil on tire une requête par lettre, au-dessus la liste
     paraît en retard sur les doigts. Mesuré comme le seuil où la suggestion
     arrive avant que le regard ne revienne sur l'écran. */
  var DELAI_SAISIE_MS = 250;

  var DELAI_RESEAU_MS = 6000;

  /* L'ordre dans lequel on préfère les réponses à score comparable. Une
     personne qui tape « Lille » veut la commune, pas la rue Lille à Roubaix ;
     une personne qui tape une adresse complète veut le numéro. La BAN donne
     un score, mais il ne départage pas ces deux intentions — ce rang si. */
  var RANG_TYPE = { municipality: 0, locality: 1, street: 2, housenumber: 3 };

  function texte(valeur) {
    return valeur == null ? "" : String(valeur).trim();
  }

  function nombre(valeur) {
    var n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  }

  /* Une saisie exploitable, et la même règle des deux côtés : ce qui ne part
     pas en requête ne doit pas non plus vider la liste affichée. */
  function saisieExploitable(valeur) {
    return texte(valeur).length >= LONGUEUR_MIN;
  }

  /* Un résultat de la BAN, ramené au vocabulaire d'Autour. On ne recopie que
     ce dont l'application se sert : tout le reste de la fiche BAN — score
     brut, identifiants internes, découpage administratif — resterait du
     bruit que personne ne lit. */
  function normaliser(fonctionnalite) {
    if (!fonctionnalite || typeof fonctionnalite !== "object") return null;
    var p = fonctionnalite.properties || {};
    var g = fonctionnalite.geometry || {};
    var coords = Array.isArray(g.coordinates) ? g.coordinates : [];
    var lng = nombre(coords[0]);
    var lat = nombre(coords[1]);
    if (lat == null || lng == null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    var type = texte(p.type) || "municipality";
    var ville = texte(p.city) || texte(p.name);
    var libelle = texte(p.label) || ville;
    if (!libelle) return null;

    return Object.freeze({
      id: texte(p.id) || (type + ":" + lat.toFixed(5) + "," + lng.toFixed(5)),
      libelle: libelle,
      ville: ville,
      codePostal: texte(p.postcode),
      insee: texte(p.citycode),
      contexte: texte(p.context),
      type: type,
      /* Une commune couvre un territoire ; une adresse est un point. Le
         cadrage n'est donc pas le même, et l'appelant a besoin de le savoir
         sans réinterpréter le type. */
      estCommune: type === "municipality",
      lat: lat,
      lng: lng,
      score: nombre(p.score) || 0,
    });
  }

  function classer(resultats) {
    return resultats.slice().sort(function (a, b) {
      var rangA = RANG_TYPE[a.type];
      var rangB = RANG_TYPE[b.type];
      if (rangA == null) rangA = 9;
      if (rangB == null) rangB = 9;
      /* Le score de la BAN reste l'arbitre principal : lui seul sait que
         « Tourcoing » vaut mieux que « Rue de Tourcoing » pour cette saisie.
         Le rang ne départage qu'un quasi-ex æquo — sinon une commune
         lointaine passerait devant l'adresse exacte qu'on vient de taper. */
      var ecart = b.score - a.score;
      if (Math.abs(ecart) > 0.08) return ecart;
      return rangA - rangB;
    });
  }

  function construireUrl(requete, options) {
    var o = options || {};
    var limite = Number.isFinite(Number(o.limite)) ? Number(o.limite) : LIMITE_DEFAUT;
    var params = new URLSearchParams();
    params.set("q", texte(requete));
    params.set("limit", String(Math.max(1, Math.min(20, limite))));
    /* La BAN sait pondérer autour d'un point. On le lui donne quand on l'a :
       « république » depuis Lille doit rendre la place de la République de
       Lille avant celle de Paris. C'est une PONDÉRATION, pas un filtre : une
       recherche explicite d'une autre ville reste possible. */
    if (Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng))) {
      params.set("lat", String(Number(o.lat)));
      params.set("lon", String(Number(o.lng)));
    }
    if (o.type) params.set("type", String(o.type));
    return POINT_ENTREE + "?" + params.toString();
  }

  /* Une recherche. Rend TOUJOURS un tableau : une panne de réseau, une
     réponse illisible ou un service indisponible rendent une liste vide, pas
     une exception. La seule chose qui remonte est l'annulation, parce qu'elle
     n'est pas un échec et que l'appelant doit pouvoir l'ignorer sans
     l'afficher. */
  async function chercher(requete, options) {
    var o = options || {};
    if (!saisieExploitable(requete)) return [];
    var fetcher = o.fetch || root.fetch;
    if (typeof fetcher !== "function") return [];

    var signal = o.signal;
    var horloge = null;
    /* Un réseau lent ne doit pas laisser une suggestion en attente
       indéfiniment. Quand l'appelant ne fournit pas son propre signal, on
       pose notre propre borne. */
    if (!signal && typeof AbortController === "function") {
      var controleur = new AbortController();
      signal = controleur.signal;
      horloge = setTimeout(function () { controleur.abort(); }, DELAI_RESEAU_MS);
    }

    try {
      var reponse = await fetcher(construireUrl(requete, o), { signal: signal });
      if (!reponse || !reponse.ok) return [];
      var charge = await reponse.json();
      var liste = charge && Array.isArray(charge.features) ? charge.features : [];
      return classer(liste.map(normaliser).filter(Boolean));
    } catch (e) {
      if (e && (e.name === "AbortError" || e.name === "TimeoutError")) throw e;
      return [];
    } finally {
      if (horloge != null) clearTimeout(horloge);
    }
  }

  /* ===================================================================
     LE CHERCHEUR À SAISIE

     Trois problèmes que `chercher()` seule ne résout pas, et qu'on ne peut
     pas laisser à chaque appelant :

       1. UNE REQUÊTE PAR LETTRE. Le délai les regroupe.
       2. LES RÉPONSES DANS LE DÉSORDRE. Sur un réseau lent, la réponse de
          « lil » peut arriver après celle de « lille » et écraser la bonne.
          Chaque saisie annule la précédente ET porte un numéro : une réponse
          qui n'est plus la dernière est jetée, même si elle est arrivée.
       3. LA MÊME QUESTION DEUX FOIS. Effacer une lettre puis la retaper est
          le geste le plus courant d'un clavier de téléphone ; sans mémoire,
          il coûte deux requêtes pour une seule réponse.
     =================================================================== */
  function creerChercheur(options) {
    var o = options || {};
    var delai = Number.isFinite(Number(o.delai)) ? Number(o.delai) : DELAI_SAISIE_MS;
    var surResultats = typeof o.surResultats === "function" ? o.surResultats : function () {};
    var surEtat = typeof o.surEtat === "function" ? o.surEtat : function () {};

    var minuterie = null;
    var controleur = null;
    var generation = 0;
    var memoire = new Map();
    var MEMOIRE_MAX = 24;

    function annuler() {
      if (minuterie != null) { clearTimeout(minuterie); minuterie = null; }
      if (controleur) { try { controleur.abort(); } catch (e) {} controleur = null; }
      /* La génération avance même à l'annulation : une réponse déjà partie ne
         doit pas rendre la main après un effacement. */
      generation += 1;
    }

    function retenir(cle, resultats) {
      memoire.set(cle, resultats);
      while (memoire.size > MEMOIRE_MAX) memoire.delete(memoire.keys().next().value);
    }

    async function lancer(requete, mien) {
      controleur = typeof AbortController === "function" ? new AbortController() : null;
      surEtat("recherche");
      try {
        var resultats = await chercher(requete, Object.assign({}, o, {
          signal: controleur ? controleur.signal : undefined,
        }));
        if (mien !== generation) return;
        retenir(requete, resultats);
        surEtat(resultats.length ? "pret" : "vide");
        surResultats(resultats, requete);
      } catch (e) {
        if (mien !== generation) return;
        /* Une annulation n'est pas une panne : elle ne change pas ce qui est
           affiché, parce qu'une saisie plus récente s'en charge déjà. */
        if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return;
        surEtat("erreur");
        surResultats([], requete);
      }
    }

    function saisir(valeur) {
      var requete = texte(valeur);
      annuler();
      if (!saisieExploitable(requete)) { surEtat("inactif"); surResultats([], requete); return; }
      if (memoire.has(requete)) {
        var connus = memoire.get(requete);
        surEtat(connus.length ? "pret" : "vide");
        surResultats(connus, requete);
        return;
      }
      var mien = generation;
      minuterie = setTimeout(function () { minuterie = null; lancer(requete, mien); }, delai);
    }

    return Object.freeze({ saisir: saisir, annuler: annuler });
  }

  root.AutourAdresse = Object.freeze({
    POINT_ENTREE: POINT_ENTREE,
    LONGUEUR_MIN: LONGUEUR_MIN,
    DELAI_SAISIE_MS: DELAI_SAISIE_MS,
    LIMITE_DEFAUT: LIMITE_DEFAUT,
    saisieExploitable: saisieExploitable,
    construireUrl: construireUrl,
    normaliser: normaliser,
    classer: classer,
    chercher: chercher,
    creerChercheur: creerChercheur,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
