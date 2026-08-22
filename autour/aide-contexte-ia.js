(function (root) {
  "use strict";

  /* ===================================================================
     CE QUE LE MODÈLE REÇOIT, ET CE QU'IL N'A PAS LE DROIT DE RENDRE

     LA PLACE DU MODÈLE DANS AIDE

       OSM + données publiques + partenaires + base Autour
                       ↓
                  normalisation
                       ↓
              taxonomie / capacités
                       ↓
            recherche géographique (paliers)
                       ↓
                 CANDIDATS RÉELS
                       ↓
                     modèle
                       ↓
       compréhension · classification · levée d'ambiguïté · ordre
                       ↓
                    résultats

     Le modèle est le DERNIER maillon, jamais le premier. Il ne fabrique pas la
     liste : il la comprend, la nettoie et la remet dans le bon ordre. Une
     structure qu'il n'a pas reçue ne peut pas sortir de lui — et ce n'est pas
     une consigne d'invite, c'est vérifié ici, après coup, sur les
     identifiants.

     CE QUE CE FICHIER NE FAIT PAS

     Il n'appelle rien. Aucun nouvel appel au modèle n'est créé : Autour en a
     déjà un, `enrichir-lieu`, avec son budget réservé et son plafond
     journalier. Ce fichier prépare ce qu'on transmettrait, et vérifie ce qui
     reviendrait. Le jour où Aide branche le modèle, le contexte géographique
     et le garde-fou anti-invention sont déjà là — c'est l'inverse qui serait
     coûteux à rattraper.
     =================================================================== */

  const TAXO = root.AutourAideTaxonomie;

  /* Ce qu'on transmet d'un candidat : de quoi le reconnaître et le juger, et
     rien de plus. Pas de photo, pas d'historique, pas de trace de qui
     regarde. */
  function candidat(lieu) {
    const l = lieu || {};
    const capacites = l.capacitesAide || null;
    return {
      id: String(l.id),
      name: String(l.titre || l.title || ""),
      category: l.cat || null,
      lat: Number(l.lat != null ? l.lat : l.latitude),
      lng: Number(l.lng != null ? l.lng : l.longitude),
      distanceM: Number.isFinite(Number(l.rankDistance))
        ? Math.round(Number(l.rankDistance)) : null,
      /* Les tags qui ont servi à décider — pas tout le sac de tags. C'est ce
         qui permet au modèle de lever une ambiguïté sans réinventer la
         classification. */
      osm: tagsUtiles(l),
      capabilities: capacites,
      confidence: Number(l.confianceAide) || 0,
      openingHours: l.quand || null,
      source: l.source || null,
    };
  }

  const CLES_UTILES = Object.freeze(["amenity", "social_facility",
    "social_facility:for", "office", "government", "healthcare",
    "healthcare:speciality", "healthcare:counselling", "police", "shop",
    "tourism", "leisure", "service"]);

  function tagsUtiles(lieu) {
    const tags = (lieu && lieu.tags) || {};
    const out = {};
    CLES_UTILES.forEach((k) => { if (tags[k]) out[k] = String(tags[k]); });
    return out;
  }

  /* ===================================================================
     LE CONTEXTE

     Le modèle doit savoir OÙ Autour cherche et DANS QUEL RAYON. Sans cela il
     raisonne dans le vide : il ne peut ni juger une distance, ni comprendre
     qu'une liste est courte parce que la zone est rurale.
     =================================================================== */
  function contexte(etat) {
    const e = etat || {};
    const candidats = (Array.isArray(e.candidatePlaces) ? e.candidatePlaces : [])
      .map(candidat);
    return {
      userLat: nombre(e.userLat),
      userLng: nombre(e.userLng),
      selectedCity: e.selectedCity ? String(e.selectedCity) : null,
      currentRadius: Number(e.currentRadius) || null,
      requestedHelpCategory: e.requestedHelpCategory || null,
      /* La phrase telle qu'elle a été tapée : le modèle en a besoin pour la
         comprendre. Elle ne sort pas d'ici vers un journal, une base ou une
         métrique — voir la note ci-dessous. */
      userFreeText: e.userFreeText ? String(e.userFreeText) : null,
      candidatePlaces: candidats,
      /* Ce que le modèle a le droit de rendre, écrit dans le contexte pour
         qu'aucune version d'invite ne puisse l'oublier. */
      allowedCategories: TAXO.BESOINS.map((b) => b.id).concat(TAXO.BESOIN_OUVERT),
      allowedPlaceIds: candidats.map((c) => c.id),
      rules: REGLES,
    };
  }

  const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  /* Les règles, transmises avec le contexte plutôt que cachées dans une
     invite : elles sont ainsi lisibles, testables, et les mêmes partout. */
  const REGLES = Object.freeze([
    "Ne jamais inventer une structure, une adresse, un horaire ou un téléphone.",
    "Ne retenir que des identifiants présents dans allowedPlaceIds.",
    "Ne jamais affirmer qu’une structure fournit un service que les données ne montrent pas.",
    "Ne retenir que des catégories présentes dans allowedCategories.",
    "Préférer deux structures sûres à dix approximatives.",
  ]);

  /* ===================================================================
     CE QUI REVIENT — VÉRIFIÉ, PAS CRU SUR PAROLE

     Une invite bien écrite n'est pas une garantie. La garantie est ici : tout
     identifiant que le modèle rend et qu'Autour ne lui a pas donné est jeté,
     et compté. Idem pour une catégorie inventée.
     =================================================================== */
  const MOTIFS = Object.freeze({
    LIEU_INVENTE: "lieu_invente",
    CATEGORIE_INVENTEE: "categorie_inventee",
    SERVICE_NON_ETAYE: "service_non_etaye",
  });

  function valider(reponse, ctx) {
    const r = reponse || {};
    const c = ctx || {};
    const permis = new Set(c.allowedPlaceIds || []);
    const categories = new Set(c.allowedCategories || []);
    const rejets = [];

    const garderId = (id) => {
      const s = String(id);
      if (permis.has(s)) return true;
      rejets.push({ motif: MOTIFS.LIEU_INVENTE, valeur: s });
      return false;
    };
    const garderCategorie = (id) => {
      const s = String(id);
      if (categories.has(s)) return true;
      rejets.push({ motif: MOTIFS.CATEGORIE_INVENTEE, valeur: s });
      return false;
    };

    const primaire = r.primaryNeed && garderCategorie(r.primaryNeed)
      ? String(r.primaryNeed) : null;
    const secondaires = (Array.isArray(r.secondaryNeeds) ? r.secondaryNeeds : [])
      .filter(garderCategorie).map(String)
      .filter((id) => id !== primaire);

    /* L'ordre rendu par le modèle, réduit à ce qui existe. On garde SON ordre
       — c'est ce qu'on lui a demandé — mais pas ses ajouts. */
    const ordre = (Array.isArray(r.rankedPlaceIds) ? r.rankedPlaceIds : [])
      .map(String).filter(garderId);
    const ecartes = (Array.isArray(r.rejectedPlaceIds) ? r.rejectedPlaceIds : [])
      .map(String).filter((id) => permis.has(id));

    /* Une explication ne vaut que pour un lieu réel, et ne devient jamais une
       affirmation de service : c'est du texte d'interface, pas une donnée. */
    const explications = {};
    Object.entries(r.explanations || {}).forEach(([id, texte]) => {
      if (!permis.has(String(id))) {
        rejets.push({ motif: MOTIFS.LIEU_INVENTE, valeur: String(id) });
        return;
      }
      explications[String(id)] = String(texte).slice(0, 200);
    });

    return Object.freeze({
      primaryNeed: primaire,
      secondaryNeeds: Object.freeze(secondaires),
      rankedPlaceIds: Object.freeze(ordre),
      rejectedPlaceIds: Object.freeze(ecartes),
      explanations: Object.freeze(explications),
      rejets: Object.freeze(rejets),
      /* Vrai quand le modèle a tenté d'ajouter quelque chose qu'on ne lui a
         pas donné. L'appelant peut alors préférer son propre ordre. */
      aInvente: rejets.length > 0,
    });
  }

  /* Appliquer l'ordre du modèle à la liste réelle. Ce qu'il n'a pas classé
     reste, à la suite, dans l'ordre d'Autour : un modèle qui oublie la moitié
     de la liste ne doit pas la faire disparaître. */
  function appliquer(resultats, valide) {
    const liste = Array.isArray(resultats) ? resultats : [];
    if (!valide || !valide.rankedPlaceIds.length) return liste.slice();
    const ecartes = new Set(valide.rejectedPlaceIds);
    const rang = new Map(valide.rankedPlaceIds.map((id, i) => [id, i]));
    return liste
      .filter((l) => !ecartes.has(String(l.id)))
      .slice()
      .sort((a, b) => {
        const ra = rang.has(String(a.id)) ? rang.get(String(a.id)) : Infinity;
        const rb = rang.has(String(b.id)) ? rang.get(String(b.id)) : Infinity;
        return ra - rb;
      });
  }

  root.AutourAideContexteIA = Object.freeze({
    REGLES, MOTIFS, CLES_UTILES,
    contexte, candidat, tagsUtiles, valider, appliquer,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
