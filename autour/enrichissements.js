/* LE CALQUE VÉRIFIÉ, VU DEPUIS LE NAVIGATEUR.

   Ce fichier ne contient AUCUNE intelligence : elle est déjà écrite, côté
   serveur, dans la fonction `enrichir-lieu` et son module `extraction.mjs`.
   Ici on fait trois choses, et rien d'autre :

     1. lire le cache `place_enrichments` pour les lieux qu'on affiche ;
     2. demander une vérification pour les rares candidats à qui il manque
        vraiment quelque chose ;
     3. poser le résultat sur les lieux, et redessiner discrètement.

   CE QU'IL NE FAIT JAMAIS

   Il n'attend pas. Autour affiche ce qu'il sait, puis ceci arrive — ou
   n'arrive pas. Une panne du modèle, un budget épuisé, un réseau coupé : dans
   les trois cas l'écran garde exactement ce qu'il montrait. C'est la seule
   propriété qui compte ici, et elle est obtenue en ne mettant jamais cette
   couche sur le chemin d'un rendu.

   AUCUN SECRET NE DESCEND ICI. La fonction est protégée par `verify_jwt` et
   s'appelle avec la clé PUBLIABLE — celle qui est déjà dans la page pour
   toutes les autres lectures Supabase, et qui est publique par construction.
   `GEMINI_API_KEY` ne quitte jamais Supabase. */
(function(){
  "use strict";

  /* Au plus cinq candidats par vague : c'est la limite demandée, et c'est
     surtout la protection la plus efficace contre l'explosion de coût, parce
     qu'elle agit avant tout le reste. */
  const MAX_CANDIDATS = 5;
  /* Trois vérifications en vol au maximum. Au-delà, on n'accélère plus rien :
     on empile des requêtes que le navigateur sérialise de toute façon. */
  const MAX_SIMULTANEES = 3;
  /* Une même clé ne repart pas deux fois dans la même session, même si le
     serveur a répondu « rien trouvé ». Le serveur a son propre cache ; celui-ci
     évite d'aller le lui demander. */
  const demandees = new Set();
  const enVol = new Map();
  let sortiesSimultanees = 0;

  /* ---- L'identité d'un lieu ---------------------------------------------
     STRICTEMENT la même règle que `cleLieu` dans extraction.mjs. Le serveur
     recalcule la clé de son côté — il ne fait jamais confiance à la nôtre pour
     écrire — mais les deux doivent tomber d'accord, sinon on lirait un cache
     qu'on ne remplit jamais. */
  const ARTICLES = /\b(le|la|les|l|un|une|des|du|de|d|au|aux|the|a)\b/g;
  const DIACRITIQUES = new RegExp("[\\u0300-\\u036f]", "g");

  function normaliserNom(valeur){
    return String(valeur == null ? "" : valeur)
      .normalize("NFD").replace(DIACRITIQUES, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(ARTICLES, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function coordonnee(valeur){
    if(valeur == null || String(valeur).trim() === "") return null;
    const n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  }

  function cleLieu(nom, lat, lng){
    const n = normaliserNom(nom);
    if(n.length < 2) return null;
    const y = coordonnee(lat), x = coordonnee(lng);
    if(y == null || x == null) return null;
    return n.replace(/ /g, "-")+"@"+y.toFixed(4)+","+x.toFixed(4);
  }

  /* ---- Ce qui manque vraiment --------------------------------------------
     On ne dépense pas un appel pour « améliorer ». On en dépense un quand une
     information PRÉCISE manque, est périmée, ou se contredit — et seulement
     pour un lieu qu'on est en train de proposer.

     `donnees.js` répond déjà à cette question pour le prix et les horaires ;
     on l'appelle, on ne la réécrit pas. Ce qui suit ajoute les manques qu'elle
     ne couvre pas : le statut inconnu, la programmation absente d'un lieu
     culturel, la fermeture soupçonnée, la billetterie manquante. */
  const AVEC_PROGRAMME = ["cinema", "musee", "spectacle", "concert", "biblio"];
  /* Une commodité n'est jamais enrichie : « Maintenant » ne les propose plus,
     et payer une recherche web pour un supermarché n'améliorerait rien de ce
     qu'on montre. La liste est celle de maintenant.js, à dessein. */
  const COMMODITES = ["commerce", "friperie", "sante", "metro", "bus", "tram",
    "train", "velo", "recharge", "toilettes", "mairie", "ecole", "emploi"];
  const MOTS_FERMETURE =
    /\b(fermeture|travaux|renovation|provisoire|reouverture|momentanement)\b/i;
  /* Au-delà, un horaire n'est plus une information : c'est un souvenir. */
  const HORAIRES_PERIMES_MS = 180 * 24 * 3600 * 1000;

  function sansAccents(v){
    return String(v == null ? "" : v).normalize("NFD")
      .replace(DIACRITIQUES, "").toLowerCase();
  }

  function manques(lieu, options){
    const o = options || {};
    const maintenant = Number.isFinite(o.maintenant) ? o.maintenant : Date.now();
    const raisons = [];
    if(!lieu) return raisons;
    if(COMMODITES.indexOf(lieu.cat) >= 0) return raisons;

    const horaires = lieu.quand || lieu.opening_hours;
    if(!horaires || String(horaires).trim() === "" || horaires === "Voir sur place")
      raisons.push("missingOpeningHours");
    else {
      const vus = Date.parse(lieu.majLe || lieu.updated_at || "");
      if(Number.isFinite(vus) && maintenant - vus > HORAIRES_PERIMES_MS)
        raisons.push("staleOpeningHours");
    }
    if(lieu.ouvert == null && !raisons.length) raisons.push("unknownCurrentStatus");

    if(AVEC_PROGRAMME.indexOf(lieu.cat) >= 0 &&
       !(Array.isArray(lieu.programme_now) && lieu.programme_now.length))
      raisons.push("missingProgramme");

    if(MOTS_FERMETURE.test(sansAccents(lieu.description)+" "+sansAccents(lieu.titre)))
      raisons.push("suspectedTemporaryClosure");

    /* Le manque le plus massif du catalogue réel : les événements
       DATAtourisme arrivent sans aucune URL. Quelqu'un qui veut y aller n'a
       nulle part où cliquer. */
    const estEvenement = !!(lieu.debutLe || lieu.isTemporary);
    if(estEvenement && !lieu.url && !lieu.ticket_url)
      raisons.push("missingTicketUrl");

    return raisons;
  }

  /* ---- Poser le calque sur un lieu ---------------------------------------
     Ce qui ne vaut que FRAIS : un statut d'ouverture périmé est un mensonge en
     puissance. Une adresse, elle, ne devient pas fausse en vieillissant. */
  function appliquer(lieu, e){
    if(!lieu || !e) return false;
    let change = false;
    const frais = e.expires_at ? Date.parse(e.expires_at) > Date.now() : false;

    if(frais){
      if(e.current_status && e.current_status !== "unknown"){
        lieu.current_status = e.current_status; change = true;
      }
      if(e.temporary_closed != null){ lieu.temporary_closed = e.temporary_closed; change = true; }
      /* Les horaires n'écrasent la donnée existante que si le serveur les a
         jugés dignes de le faire — il a déjà appliqué `peutEcraserOsm` et rend
         `null` sinon. On ne refait pas cet arbitrage ici. */
      if(e.opening_hours){ lieu.quand = e.opening_hours; change = true; }
      if(e.today_hours){ lieu.horairesDuJour = e.today_hours; change = true; }
      if(e.next_open_at){ lieu.next_open_at = e.next_open_at; change = true; }
      if(Array.isArray(e.programme_now) && e.programme_now.length){
        lieu.programme_now = e.programme_now; change = true;
      }
      if(Array.isArray(e.programme_soon) && e.programme_soon.length){
        lieu.programme_soon = e.programme_soon; change = true;
      }
    }
    if(e.ticket_url && !lieu.ticket_url){ lieu.ticket_url = e.ticket_url; change = true; }
    if(e.official_url && !lieu.url){ lieu.url = e.official_url; change = true; }

    /* La provenance ne se perd jamais : l'écran doit pouvoir dire d'où vient
       ce qu'il affirme, et depuis quand. */
    if(change || e.sources){
      lieu.verifie = {
        frais,
        le: e.last_verified_at || e.checked_at || null,
        confiance: Number(e.confidence) || 0,
        priorite: e.source_priority || null,
        sources: Array.isArray(e.sources) ? e.sources : [],
      };
    }
    return change;
  }

  window.AutourEnrichissements = {
    MAX_CANDIDATS, MAX_SIMULTANEES,
    cleLieu, normaliserNom, manques, appliquer,
    /* Exposés pour que l'appelant puisse mesurer et pour les tests : la file
       ne se pilote pas depuis l'extérieur. */
    _etat: ()=>({demandees:demandees.size, enVol:enVol.size, sorties:sortiesSimultanees}),
    _reserver(cle){
      if(demandees.has(cle) || sortiesSimultanees >= MAX_SIMULTANEES) return false;
      demandees.add(cle); sortiesSimultanees += 1; return true;
    },
    _liberer(){ sortiesSimultanees = Math.max(0, sortiesSimultanees - 1); },
    _oublier(){ demandees.clear(); enVol.clear(); sortiesSimultanees = 0; },
  };
})();
