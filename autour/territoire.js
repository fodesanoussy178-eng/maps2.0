(function (root) {
  "use strict";

  /* ===================================================================
     UN TERRITOIRE QUI CHANGE TEMPORAIREMENT

     CE QUE CE MODULE EST

     Une COUCHE DE CONTEXTE posée sur le moteur d'Autour. Rien de plus. Il
     n'existe ni deuxième carte, ni deuxième moteur de recommandation, ni
     deuxième système d'événements : pendant une manifestation majeure, le même
     moteur reçoit simplement un renseignement de plus — « à cet endroit et
     pendant cette période, ces signaux comptent davantage ».

     LA BRADERIE EST LE PREMIER CAS, PAS UNE EXCEPTION CODÉE

     Aucune règle ici ne connaît le mot « Braderie ». Ce fichier ne sait que
     lire une configuration : un nom, une emoji, une fenêtre de temps, des
     zones, des sources officielles. La Fête de la Musique, un carnaval, un
     marathon ou un marché de Noël passeront par exactement le même chemin,
     sans une ligne de code de plus.

     CE QUE CE MODULE NE FAIT PAS

       · il ne charge rien : aucune requête ne part d'ici ;
       · il ne dessine rien : il ne connaît ni le DOM ni la carte ;
       · il ne calcule aucun statut temporel : `temporel.js` fait autorité ;
       · il ne crée aucun objet en base : un vide-grenier reste un événement,
         un restaurant reste un lieu, des toilettes restent un service. Le
         contexte change leur PERTINENCE, jamais leur nature.

     Il répond à six questions, et à rien d'autre :

       1. le bouton doit-il exister, et que dit-il ?
       2. dans quelle zone suis-je ?
       3. dois-je réévaluer — et faut-il pour autant rappeler quelqu'un ?
       4. cette information a-t-elle vieilli, compte tenu de sa nature ?
       5. quel poids ce résultat mérite-t-il dans le contexte ?
       6. cette source a-t-elle le droit d'affirmer ça ?
     =================================================================== */

  /* ===================================================================
     1. LES QUATRE PHASES

     Quatre, parce que « avant » et « absent » ne se ressemblent qu'à l'écran.
     Avant, le bouton existe et annonce ; absent, il n'existe pas. Et APRES
     n'est pas un état durable : c'est la disparition, et elle est automatique.
     Aucun code n'est à retirer le lundi matin.
     =================================================================== */
  const PHASES = Object.freeze({
    ABSENT:  "absent",
    AVANT:   "avant",
    PENDANT: "pendant",
    APRES:   "apres",
  });

  const TERRE_M = 6371000;

  function distanceM(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const dLat = (bLat - aLat) * r;
    const dLng = (bLng - aLng) * r;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * TERRE_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function nombre(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /* Un horodatage utilisable, ou `null`. Volontairement strict, et pour la
     même raison qu'ailleurs dans Autour : `Number(null)` vaut zéro, et zéro
     est une date — le 1er janvier 1970. Une date absente doit rester absente,
     sinon un contexte sans fin devient un contexte terminé depuis 56 ans. */
  function horodatage(valeur) {
    if (valeur == null || valeur === "") return null;
    if (valeur instanceof Date) {
      const t = valeur.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
    const t = Date.parse(String(valeur));
    return Number.isFinite(t) ? t : null;
  }

  function point(p) {
    if (Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      return [Number(p[0]), Number(p[1])];
    if (p && Number.isFinite(Number(p.lat)) &&
        (Number.isFinite(Number(p.lng)) || Number.isFinite(Number(p.lon))))
      return [Number(p.lat), Number(p.lng != null ? p.lng : p.lon)];
    return null;
  }

  /* ===================================================================
     2. LIRE LA CONFIGURATION

     La base publie des colonnes en `snake_case` ; le reste d'Autour parle
     autrement. La traduction se fait ICI, une fois, pour que personne d'autre
     n'ait à connaître le schéma — et pour qu'un contexte fabriqué à la main
     dans un test soit exactement le même objet qu'un contexte lu en base.

     Rien n'est deviné. Un contexte sans début, sans fin ou sans identifiant
     est REFUSÉ : mieux vaut pas de bouton du tout qu'un bouton dont on ne sait
     pas quand il doit disparaître.
     =================================================================== */
  const RAYON_ZONE_DEFAUT_M = 800;
  /* Jusqu'où le bouton existe. À Tourcoing, pendant la Braderie, il peut avoir
     un sens — mais le mode devra dire honnêtement qu'on n'est pas dans le
     périmètre. Au-delà, c'est une notification pour une ville où l'on n'est
     pas : le bouton n'existe plus. */
  const RAYON_VISIBILITE_DEFAUT_M = 25000;

  function normaliserZone(brut) {
    const z = brut || {};
    const centre = point([z.lat != null ? z.lat : z.latitude,
                          z.lng != null ? z.lng : z.longitude]);
    const slug = String(z.slug || z.zone_slug || "").trim();
    if (!slug) return null;
    /* Un contour est une liste de points ; c'est la forme que publient les
       jeux de données officiels quand ils existent. Sans contour, un cercle —
       jamais une liste de quartiers écrite dans le code. */
    const contour = Array.isArray(z.contour) ? z.contour.map(point).filter(Boolean) : [];
    if (!centre && contour.length < 3) return null;
    return Object.freeze({
      slug,
      nom: String(z.nom || z.name || slug),
      lat: centre ? centre[0] : moyenne(contour, 0),
      lng: centre ? centre[1] : moyenne(contour, 1),
      rayonM: nombre(z.rayon_m != null ? z.rayon_m : z.rayonM) || RAYON_ZONE_DEFAUT_M,
      /* Plus petit = plus prioritaire, comme `event_areas.priorite` : une
         seule convention dans tout Autour. */
      priorite: nombre(z.priorite != null ? z.priorite : z.priority) || 100,
      contour: Object.freeze(contour.map((p) => Object.freeze(p))),
      metadata: z.metadata || {},
    });
  }

  function moyenne(points, i) {
    if (!points.length) return null;
    return points.reduce((s, p) => s + p[i], 0) / points.length;
  }

  function normaliserContexte(brut) {
    const c = brut || {};
    const slug = String(c.slug || "").trim();
    const debut = horodatage(c.starts_at != null ? c.starts_at : c.debutLe);
    const fin = horodatage(c.ends_at != null ? c.ends_at : c.finLe);
    if (!slug || debut == null || fin == null || fin <= debut) return null;

    const meta = c.metadata || {};
    const zones = (Array.isArray(c.zones) ? c.zones : [])
      .map(normaliserZone).filter(Boolean)
      .sort((a, b) => a.priorite - b.priorite);

    return Object.freeze({
      slug,
      nom: String(c.name || c.nom || slug),
      /* Le bouton dit « Braderie », pas « Braderie de Lille 2026 » : c'est un
         bouton, pas un titre. Le nom complet reste pour les écrans. */
      libelle: String(meta.libelle || meta.label || c.name || c.nom || slug),
      emoji: String(c.emoji || meta.emoji || "📍"),
      debutLe: debut,
      finLe: fin,
      apercuLe: horodatage(c.preview_starts_at != null ? c.preview_starts_at : c.apercuLe),
      fuseau: String(c.timezone || c.fuseau || "Europe/Paris"),
      territoire: c.territory_slug || c.territoire || null,
      priorite: nombre(c.priority != null ? c.priority : c.priorite) || 100,
      urlOfficielle: c.official_url || c.urlOfficielle || null,
      /* Les sources qui font autorité SUR CETTE MANIFESTATION. Elles ne sont
         pas devinées : elles sont déclarées dans la configuration, et c'est ce
         qui permet à un événement « officiellement lié » d'être reconnu sans
         chercher un mot dans un titre. */
      sourcesOfficielles: Object.freeze(
        (Array.isArray(meta.sources_officielles) ? meta.sources_officielles : [])
          .map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
      rayonVisibiliteM: nombre(meta.rayon_visibilite_m) || RAYON_VISIBILITE_DEFAUT_M,
      zones: Object.freeze(zones),
      metadata: meta,
    });
  }

  /* Une liste de lignes plates `(contexte, zone)` — la forme que rend une
     jointure SQL — redevient une liste de contextes portant leurs zones. */
  function depuisLignes(lignes) {
    const parSlug = new Map();
    (lignes || []).forEach((ligne) => {
      if (!ligne) return;
      const slug = String(ligne.slug || "").trim();
      if (!slug) return;
      if (!parSlug.has(slug)) parSlug.set(slug, Object.assign({}, ligne, { zones: [] }));
      const entree = parSlug.get(slug);
      const zone = ligne.zone_slug || (ligne.zone && ligne.zone.slug);
      if (zone) entree.zones.push(ligne.zone || {
        slug: ligne.zone_slug, nom: ligne.zone_name, lat: ligne.zone_lat,
        lng: ligne.zone_lng, rayon_m: ligne.zone_rayon_m,
        priorite: ligne.zone_priorite, metadata: ligne.zone_metadata,
      });
    });
    return [...parSlug.values()].map(normaliserContexte).filter(Boolean);
  }

  /* ===================================================================
     3. LE BOUTON

     Trois états visibles, et une disparition qui ne demande aucune
     intervention :

       avant    🧺 Braderie · bientôt   (le programme, ce qui est déjà certain)
       pendant  🧺 Braderie             (ce qui vaut la peine, là, autour)
       après    —                       (le lundi, Autour redevient Autour)
     =================================================================== */
  function phase(contexte, maintenant) {
    const t = horodatage(maintenant) == null ? Date.now() : Number(maintenant);
    if (!contexte) return PHASES.ABSENT;
    if (t >= contexte.finLe) return PHASES.APRES;
    if (t >= contexte.debutLe) return PHASES.PENDANT;
    if (contexte.apercuLe != null && t >= contexte.apercuLe) return PHASES.AVANT;
    return PHASES.ABSENT;
  }

  const VISIBLES = Object.freeze([PHASES.AVANT, PHASES.PENDANT]);

  function bouton(contexte, maintenant) {
    const p = phase(contexte, maintenant);
    if (VISIBLES.indexOf(p) < 0) return null;
    return Object.freeze({
      slug: contexte.slug,
      phase: p,
      emoji: contexte.emoji,
      /* Le suffixe est le seul écart entre les deux états. Deux boutons
         différents demanderaient à être appris deux fois. */
      libelle: p === PHASES.AVANT ? contexte.libelle + " · bientôt" : contexte.libelle,
      actif: p === PHASES.PENDANT,
    });
  }

  /* Lequel, quand plusieurs se chevauchent ? Le plus prioritaire, et à égalité
     celui qui commence le plus tôt. Un seul bouton : deux contextes actifs en
     même temps sur la même ville sont un cas de configuration, pas un cas
     d'interface. */
  function contexteActif(contextes, maintenant, position) {
    const t = horodatage(maintenant) == null ? Date.now() : Number(maintenant);
    const p = point(position);
    const candidats = (contextes || [])
      .map((c) => (c && c.slug && c.debutLe != null ? c : normaliserContexte(c)))
      .filter(Boolean)
      .filter((c) => VISIBLES.indexOf(phase(c, t)) >= 0)
      /* Hors de portée, le bouton n'a rien à annoncer : quelqu'un à Rouen n'a
         pas besoin de savoir qu'une brocante a lieu à Lille. */
      .filter((c) => !p || visibleDepuis(p, c));
    if (!candidats.length) return null;
    candidats.sort((a, b) => (a.priorite - b.priorite) || (a.debutLe - b.debutLe));
    return candidats[0];
  }

  function visibleDepuis(p, contexte) {
    const d = distanceAuCentre(p, contexte);
    return d == null || d <= contexte.rayonVisibiliteM;
  }

  /* ===================================================================
     4. LES ZONES

     Un périmètre n'est pas homogène : le Vieux-Lille, Wazemmes et le centre
     n'ont ni la même densité, ni les mêmes horaires, ni les mêmes services.
     Les zones viennent de la configuration — jamais d'une liste de quartiers
     écrite dans `app.js` avec des `if`.
     =================================================================== */
  function dansZone(p, zone) {
    const c = point(p);
    if (!c || !zone) return false;
    if (zone.contour && zone.contour.length >= 3) return dansContour(c, zone.contour);
    if (zone.lat == null || zone.lng == null) return false;
    return distanceM(c[0], c[1], zone.lat, zone.lng) <= zone.rayonM;
  }

  /* Lancer de rayon : le classique, et il suffit. Les périmètres officiels
     sont des polygones simples de quelques dizaines de points. */
  function dansContour(c, contour) {
    let dedans = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const [yi, xi] = contour[i];
      const [yj, xj] = contour[j];
      const traverse = (yi > c[0]) !== (yj > c[0]) &&
        c[1] < ((xj - xi) * (c[0] - yi)) / (yj - yi) + xi;
      if (traverse) dedans = !dedans;
    }
    return dedans;
  }

  function zoneDe(position, contexte) {
    const p = point(position);
    if (!p || !contexte) return null;
    const dedans = contexte.zones.filter((z) => dansZone(p, z));
    if (!dedans.length) return null;
    /* LA PLUS PROCHE GAGNE, PAS LA PLUS IMPORTANTE.

       Une première version triait par priorité. Sur la configuration réelle,
       ça donnait ceci : quelqu'un rue de la Monnaie, en plein Vieux-Lille,
       s'entendait répondre « Lille-Centre » — parce que le secteur du centre
       est déclaré plus important et que son rayon mordait de sept cents
       mètres sur le Vieux-Lille. Même chose au Palais des Beaux-Arts, avalé
       par le centre alors qu'il est le secteur de la braderie de la BD.

       La priorité dit l'IMPORTANCE d'un secteur ; elle ne dit pas où l'on se
       trouve. À la question « dans quelle zone suis-je ? », la seule réponse
       juste est la plus proche — et la priorité ne sert plus qu'à départager
       deux secteurs à distance égale. */
    return dedans.sort((a, b) =>
      (distanceM(p[0], p[1], a.lat, a.lng) - distanceM(p[0], p[1], b.lat, b.lng)) ||
      (a.priorite - b.priorite))[0];
  }

  function dansPerimetre(position, contexte) {
    return !!zoneDe(position, contexte);
  }

  function distanceAuCentre(p, contexte) {
    if (!contexte || !contexte.zones.length) return null;
    let min = Infinity;
    contexte.zones.forEach((z) => {
      if (z.lat == null || z.lng == null) return;
      min = Math.min(min, distanceM(p[0], p[1], z.lat, z.lng));
    });
    return Number.isFinite(min) ? min : null;
  }

  /* À quelle distance du périmètre ? Zéro quand on est dedans. C'est ce que le
     mode écrit à quelqu'un qui l'ouvre depuis Tourcoing, plutôt que de faire
     croire qu'il y est. */
  function distanceAuPerimetre(position, contexte) {
    const p = point(position);
    if (!p || !contexte || !contexte.zones.length) return null;
    if (dansPerimetre(p, contexte)) return 0;
    let min = Infinity;
    contexte.zones.forEach((z) => {
      if (z.lat == null || z.lng == null) return;
      min = Math.min(min, Math.max(0, distanceM(p[0], p[1], z.lat, z.lng) - z.rayonM));
    });
    return Number.isFinite(min) ? min : null;
  }

  /* ===================================================================
     5. QUAND RÉÉVALUER — ET SURTOUT, QUOI

     DEUX CHOSES QUE TOUT LE MONDE CONFOND, ET QUI COÛTENT CHER À CONFONDRE.

     RECALCULER, c'est refaire distance, temps d'accès et classement à partir
     de ce qu'on a DÉJÀ. C'est gratuit, c'est local, et Autour doit pouvoir le
     faire cent fois sans qu'une seule requête ne parte.

     RESYNCHRONISER, c'est rappeler OpenAgenda, DATAtourisme, l'Overpass ou le
     modèle. C'est lent, ça coûte, et ça dépend UNIQUEMENT de l'âge des données
     — jamais du fait que quelqu'un ait fait trois pas.

     Un GPS qui varie de huit mètres ne déclenche rien du tout. C'est le défaut
     le plus banal de ce genre de mode, et le plus cher le jour où cent mille
     personnes sont au même endroit.
     =================================================================== */
  const SEUIL_DEPLACEMENT_M = 400;      // entre 300 et 500, comme demandé
  const SEUIL_CENTRE_M = 400;
  const RETOUR_PREMIER_PLAN_MS = 5 * 60000;

  const RAISONS = Object.freeze({
    OUVERTURE:       "ouverture",
    PREMIERE:        "premiere_evaluation",
    DEPLACEMENT:     "deplacement",
    CENTRE:          "centre_carte",
    ZONE:            "changement_de_zone",
    EXPIRATION:      "information_expiree",
    PREMIER_PLAN:    "retour_premier_plan",
  });

  function doitReevaluer(precedent, courant) {
    const c = courant || {};
    const t = Number.isFinite(Number(c.maintenant)) ? Number(c.maintenant) : Date.now();
    const raisons = [];

    if (c.ouverture) raisons.push(RAISONS.OUVERTURE);
    if (!precedent) {
      if (!raisons.length) raisons.push(RAISONS.PREMIERE);
    } else {
      const avant = precedent;
      const a = point(avant.position), b = point(c.position);
      if (a && b && distanceM(a[0], a[1], b[0], b[1]) >= SEUIL_DEPLACEMENT_M)
        raisons.push(RAISONS.DEPLACEMENT);
      const ca = point(avant.centre), cb = point(c.centre);
      if (ca && cb && distanceM(ca[0], ca[1], cb[0], cb[1]) >= SEUIL_CENTRE_M)
        raisons.push(RAISONS.CENTRE);
      /* Le changement de zone compte même quand on n'a bougé que de vingt
         mètres : franchir la limite de Wazemmes change ce qui est pertinent,
         pas la distance parcourue. */
      if ((avant.zone || null) !== (c.zone || null)) raisons.push(RAISONS.ZONE);
      if (avant.expireLe != null && t >= avant.expireLe) raisons.push(RAISONS.EXPIRATION);
      if (c.retourPremierPlan && avant.maintenant != null &&
          t - avant.maintenant >= RETOUR_PREMIER_PLAN_MS)
        raisons.push(RAISONS.PREMIER_PLAN);
    }

    /* La resynchronisation ne lit AUCUNE de ces raisons. Elle ne regarde que
       l'âge des données, nature par nature — c'est toute la différence entre
       un mode qui tient la charge et un mode qui appelle trois fournisseurs
       chaque fois qu'un téléphone se retourne dans une poche. */
    const aRafraichir = perimes(c.donnees, t);

    return Object.freeze({
      recalculer: raisons.length > 0,
      resynchroniser: aRafraichir.length > 0,
      aRafraichir: Object.freeze(aRafraichir),
      raisons: Object.freeze(raisons),
    });
  }

  /* ===================================================================
     6. LE CACHE SUIT LA NATURE DE L'INFORMATION

     Un périmètre de manifestation ne change pas de la semaine ; « ça se
     termine dans dix minutes » change en dix minutes. Leur donner le même TTL,
     c'est soit rafraîchir un plan de rues toutes les deux minutes, soit
     annoncer comme en cours une animation finie depuis une heure.

     La fraîcheur est PRIORISÉE, pas uniforme : ce qui est très temporel se
     rafraîchit d'abord, et le reste attend.
     =================================================================== */
  const NATURES = Object.freeze({
    PERIMETRE: "perimetre",       // zones, rues, emprise officielle
    EQUIPEMENTS: "equipements",   // toilettes fixes, stations, permanents
    PROGRAMME: "programme",       // stands, animations annoncées, restauration
    TEMPOREL: "temporel",         // en cours, commence, se termine, annulation
  });

  const TTL = Object.freeze({
    [NATURES.PERIMETRE]:   7 * 24 * 3600 * 1000,
    [NATURES.EQUIPEMENTS]: 24 * 3600 * 1000,
    [NATURES.PROGRAMME]:   30 * 60 * 1000,
    [NATURES.TEMPOREL]:    2 * 60 * 1000,
  });

  /* Plus petit = rafraîchi en premier. C'est l'ordre dans lequel un budget de
     requêtes limité doit être dépensé. */
  const PRIORITE_RAFRAICHISSEMENT = Object.freeze({
    [NATURES.TEMPOREL]:    0,
    [NATURES.PROGRAMME]:   1,
    [NATURES.EQUIPEMENTS]: 2,
    [NATURES.PERIMETRE]:   3,
  });

  function ttlDe(nature) {
    return TTL[nature] != null ? TTL[nature] : TTL[NATURES.PROGRAMME];
  }

  function perime(vuLe, nature, maintenant) {
    const t = Number.isFinite(Number(maintenant)) ? Number(maintenant) : Date.now();
    const vu = horodatage(vuLe);
    if (vu == null) return true;               // jamais vu : à chercher
    return t - vu >= ttlDe(nature);
  }

  /* `donnees` est `{perimetre: t, programme: t, …}` : la date de dernière
     synchronisation de chaque nature. Rend la liste de ce qui a vieilli,
     la plus périssable en tête. */
  function perimes(donnees, maintenant) {
    const d = donnees || {};
    return Object.keys(NATURES)
      .map((k) => NATURES[k])
      .filter((nature) => Object.prototype.hasOwnProperty.call(d, nature))
      .filter((nature) => perime(d[nature], nature, maintenant))
      .sort((a, b) => PRIORITE_RAFRAICHISSEMENT[a] - PRIORITE_RAFRAICHISSEMENT[b]);
  }

  /* ===================================================================
     7. QUI A LE DROIT D'AFFIRMER QUOI

     Une information qui décide d'un DÉPLACEMENT n'a pas le droit de reposer
     sur n'importe quoi. Faire passer un lieu de « on ne sait pas » à « ouvert
     maintenant », ou d'« ouvert » à « fermé », envoie quelqu'un marcher vingt
     minutes — ou l'en empêche. Une source tierce, seule, ne peut pas faire ça.

     L'ordre est celui du produit :

       source officielle de la manifestation
       > institution publique (Ville, métropole)
       > organisateur officiel
       > agenda officiel (OpenAgenda de la collectivité)
       > DATAtourisme
       > OpenStreetMap
       > source tierce
     =================================================================== */
  const RANG_SOURCE = Object.freeze({
    contexte_officiel: 6,
    institutionnel:    5,
    organisateur:      4,
    agenda_officiel:   3,
    datatourisme:      2,
    openstreetmap:     1,
    tiers:             0,
  });

  /* Les noms tels que les portent réellement les objets d'Autour. Une source
     inconnue vaut « tiers » : le défaut est la prudence, jamais l'autorité. */
  const ALIAS_SOURCE = Object.freeze({
    openagenda: "agenda_officiel",
    datatourisme: "datatourisme",
    osm: "openstreetmap",
    openstreetmap: "openstreetmap",
    google_places: "tiers",
    autour: "tiers",
  });

  function rangSource(source, contexte) {
    const nom = String(source == null ? "" : source).trim().toLowerCase();
    if (!nom) return RANG_SOURCE.tiers;
    /* Une source déclarée officielle PAR LA CONFIGURATION du contexte passe
       devant tout le reste. C'est ce qui permet d'ajouter la source d'une
       nouvelle manifestation sans toucher au code. */
    if (contexte && contexte.sourcesOfficielles.indexOf(nom) >= 0)
      return RANG_SOURCE.contexte_officiel;
    if (RANG_SOURCE[nom] != null) return RANG_SOURCE[nom];
    const alias = ALIAS_SOURCE[nom];
    return alias != null ? RANG_SOURCE[alias] : RANG_SOURCE.tiers;
  }

  /* Le seuil au-dessus duquel une source parle seule. En dessous, il faut deux
     sources INDÉPENDANTES qui disent la même chose. */
  const RANG_AUTORITE = RANG_SOURCE.agenda_officiel;

  function peutAffirmerOuverture(sources, contexte) {
    const noms = (Array.isArray(sources) ? sources : [sources])
      .map((s) => String(s == null ? "" : (s && s.source) || s).trim().toLowerCase())
      .filter(Boolean);
    if (!noms.length) return false;
    const distinctes = [...new Set(noms)];
    if (distinctes.some((n) => rangSource(n, contexte) >= RANG_AUTORITE)) return true;
    /* La corroboration : deux sources indépendantes qui affirment la même
       chose valent une source autorisée. Deux relevés de la même source n'en
       font toujours qu'un. */
    return distinctes.filter((n) => rangSource(n, contexte) > RANG_SOURCE.tiers).length >= 2;
  }

  /* Les transitions qui déplacent quelqu'un. Elles seules exigent l'autorité
     ci-dessus ; le reste (une URL de billetterie, une photo) ne coûte rien à
     personne s'il vient d'ailleurs. */
  function changementCritique(avant, apres) {
    const a = avant == null ? "unknown" : String(avant);
    const b = apres == null ? "unknown" : String(apres);
    if (a === b) return false;
    if (b === "open" && (a === "unknown" || a === "")) return true;
    if (a === "open" && (b === "closed" || b === "temporary_closed" ||
        b === "permanently_closed")) return true;
    return false;
  }

  /* ===================================================================
     8. LES SIGNAUX DU CONTEXTE — DES POINTS, PAS UN SECOND MOTEUR

     Il n'y a pas de deuxième score. Ce qui suit s'AJOUTE au score du moteur
     existant, et rien d'autre ne change : la faisabilité reste le premier
     critère de tri, la temporalité le deuxième. Un contexte ne peut donc pas
     faire remonter un événement terminé, un lieu fermé ou hors sujet.

     LE PIÈGE À NE PAS TOMBER DEDANS. Un bonus au mot « braderie » dans le
     titre ferait remonter n'importe quoi qui le contient — y compris un article
     de blog, une friterie qui s'appelle « La Braderie », ou un événement de
     l'an dernier. Le lien au contexte se lit dans la PROVENANCE et dans la
     GÉOGRAPHIE, jamais dans le texte.

     Les poids sont volontairement modestes et bornés : ils ordonnent entre
     bons résultats, ils ne repêchent pas un mauvais.
     =================================================================== */
  const POIDS = Object.freeze({
    officiel:      60,   // publié par une source officielle de la manifestation
    dansZone:      40,   // à l'intérieur d'un périmètre déclaré
    enCours:       90,   // ça se passe maintenant
    commenceTot:   70,   // ça commence dans moins de 30 min
    finitBientot:  25,   // ça se termine bientôt : y aller vaut d'y aller vite
    temporaire:    35,   // activité temporaire liée à la période
    ouvertUtile:   20,   // lieu pertinent, ouvert maintenant
    service:       10,   // service contextuel utile
  });

  /* Le total ne peut pas dépasser cette borne, quoi qu'il arrive. C'est la
     garantie chiffrée que « contient le mot Braderie » — ou n'importe quelle
     accumulation de signaux — ne renverse pas l'adéquation (jusqu'à 520 points
     dans le moteur) ni la distance. */
  const BONUS_MAX = 250;

  const COMMENCE_TOT_MS = 30 * 60000;
  const FINIT_BIENTOT_MS = 45 * 60000;

  const CATEGORIES_SERVICE = Object.freeze(["toilettes", "eau", "metro", "bus",
    "tram", "train", "velo", "sante", "recharge"]);

  function sourcesDe(item) {
    const l = item || {};
    const liste = Array.isArray(l.sources) ? l.sources.slice() : [];
    if (l.source) liste.push(l.source);
    if (l.primary_source) liste.push(l.primary_source);
    return liste.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }

  /* Officiellement lié : la provenance le dit, ou le chargeur l'a marqué au
     moment où il l'a lu dans le flux officiel. Deux chemins, aucun ne passe
     par le titre. */
  function estOfficiel(item, contexte) {
    if (!item || !contexte) return false;
    if (item.contexteTerritorial === contexte.slug) return true;
    if (!contexte.sourcesOfficielles.length) return false;
    return sourcesDe(item).some((s) => contexte.sourcesOfficielles.indexOf(s) >= 0);
  }

  /* Temporaire ET dans la fenêtre du contexte. Une exposition qui court depuis
     mars n'est pas une activité de la manifestation, même si elle a lieu
     pendant. */
  function estActiviteDuContexte(item, contexte, maintenant) {
    if (!item || !item.isTemporary || !contexte) return false;
    const debut = horodatage(item.startsAt != null ? item.startsAt : item.debutLe);
    if (debut == null) return false;
    return debut >= contexte.debutLe && debut <= contexte.finLe;
  }

  function signaux(item, contexte, options) {
    const o = options || {};
    const t = Number.isFinite(Number(o.maintenant)) ? Number(o.maintenant) : Date.now();
    const l = item || {};
    const debut = horodatage(l.startsAt != null ? l.startsAt : l.debutLe);
    const fin = horodatage(l.endsAt != null ? l.endsAt : l.finLe);
    const enCours = o.statut === "happening_now" || o.enCours === true;

    return Object.freeze({
      officiel: estOfficiel(l, contexte),
      dansZone: !!zoneDe([l.lat != null ? l.lat : l.latitude,
                          l.lng != null ? l.lng : l.longitude], contexte),
      enCours,
      commenceTot: !enCours && debut != null && debut > t && debut - t <= COMMENCE_TOT_MS,
      finitBientot: enCours && fin != null && fin > t && fin - t <= FINIT_BIENTOT_MS,
      temporaire: estActiviteDuContexte(l, contexte, t),
      ouvertUtile: !l.isTemporary && l.ouvert === true &&
        CATEGORIES_SERVICE.indexOf(l.cat) < 0,
      service: CATEGORIES_SERVICE.indexOf(l.cat) >= 0,
    });
  }

  function bonus(item, contexte, options) {
    if (!contexte) return 0;
    const s = signaux(item, contexte, options);
    let total = 0;
    Object.keys(POIDS).forEach((cle) => { if (s[cle]) total += POIDS[cle]; });
    /* Une zone prioritaire pèse un peu plus : le centre pendant la Braderie
       n'est pas Flandres. Modeste, et seulement à l'intérieur du périmètre. */
    const zone = options && options.zone;
    if (s.dansZone && zone && zone.priorite <= 10) total += 10;
    return Math.min(BONUS_MAX, total);
  }

  /* ===================================================================
     9. « UTILE AUTOUR DE TOI »

     Un bloc court, APRÈS les propositions, jamais à leur place. La mission
     reste QUOI + QUAND + OÙ ; ceci est ce qu'on cherche quand on y est déjà.

     Ces objets ne deviennent PAS des événements pour autant : des toilettes
     restent un service, une station reste une station, un poste de secours
     reste une aide et il passe par le système Aide existant.
     =================================================================== */
  const SERVICES = Object.freeze([
    Object.freeze({ id: "toilettes", emoji: "🚻", label: "Toilettes", cats: ["toilettes"] }),
    Object.freeze({ id: "eau", emoji: "🚰", label: "Eau", cats: ["eau"] }),
    Object.freeze({ id: "transport", emoji: "🚇", label: "Métro",
                    cats: ["metro", "tram", "train", "bus"] }),
    Object.freeze({ id: "aide", emoji: "❤️", label: "Point d’aide",
                    cats: ["sante", "asso", "alimentaire", "hebergement"] }),
    Object.freeze({ id: "velo", emoji: "🚲", label: "Parking vélo", cats: ["velo"] }),
  ]);

  const LIBELLE_TRANSPORT = Object.freeze({
    metro: "Métro", tram: "Tram", train: "Gare", bus: "Bus",
  });

  /* Compact, et le mot compte : cinq lignes de services au-dessus de trois
     propositions inverseraient la hiérarchie du produit. */
  const MAX_SERVICES = 4;

  function services(items, options) {
    const o = options || {};
    const p = point(o.position);
    const rayon = Number(o.rayonMax) > 0 ? Number(o.rayonMax) : 1200;
    const sortie = [];

    SERVICES.forEach((famille) => {
      if (sortie.length >= MAX_SERVICES) return;
      let meilleur = null;
      let meilleureDistance = Infinity;
      (items || []).forEach((l) => {
        if (!l || famille.cats.indexOf(l.cat) < 0) return;
        if (l.ouvert === false) return;         // un service fermé n'aide personne
        const lat = l.lat != null ? l.lat : l.latitude;
        const lng = l.lng != null ? l.lng : l.longitude;
        if (!p || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
        const d = distanceM(p[0], p[1], Number(lat), Number(lng));
        if (d > rayon || d >= meilleureDistance) return;
        meilleur = l;
        meilleureDistance = d;
      });
      if (!meilleur) return;
      sortie.push(Object.freeze({
        id: famille.id,
        emoji: famille.emoji,
        label: famille.id === "transport"
          ? (LIBELLE_TRANSPORT[meilleur.cat] || famille.label) : famille.label,
        item: meilleur,
        distance: meilleureDistance,
      }));
    });

    return sortie;
  }

  /* ===================================================================
     10. LE DERNIER KILOMÈTRE, ET SEULEMENT LUI

     Le mode ne dépend PAS du modèle. Sans clé, sans quota, sans réseau vers
     lui, `🧺` continue de fonctionner sur les événements canoniques, les
     sources officielles, OpenAgenda, DATAtourisme, OpenStreetMap et le cache.
     Ce qui suit ne dit donc jamais « il faut appeler » : il dit « il est
     inutile d'appeler », ce qui est une garantie de coût, pas de service.

     Un appel n'est autorisé que si TOUTES les portes précédentes sont fermées :
     rien ne manque, une source officielle répond déjà, le cache est encore
     valable, le budget est épuisé — dans ces quatre cas, aucun appel.
     =================================================================== */
  const REFUS = Object.freeze({
    BUDGET:            "budget_epuise",
    CACHE_FRAIS:       "cache_frais",
    RIEN_NE_MANQUE:    "rien_ne_manque",
    SOURCE_OFFICIELLE: "source_officielle",
    DONNEE_FRAICHE:    "donnee_fraiche",
  });

  function enrichissementAutorise(lieu, options) {
    const o = options || {};
    const t = Number.isFinite(Number(o.maintenant)) ? Number(o.maintenant) : Date.now();

    /* Le budget d'abord : c'est le seul refus qui protège d'une facture, et il
       ne doit dépendre d'aucune autre condition. */
    if (Number(o.budgetRestant) <= 0)
      return refus(REFUS.BUDGET);

    const expire = horodatage(o.cacheExpireLe);
    if (expire != null && expire > t) return refus(REFUS.CACHE_FRAIS);

    const manques = Array.isArray(o.manques) ? o.manques.filter(Boolean) : [];
    if (!manques.length) return refus(REFUS.RIEN_NE_MANQUE);

    /* Une source officielle qui répond déjà à ce qui manque ferme la porte :
       payer une recherche pour retrouver ce qu'OpenAgenda a déjà dit est la
       dépense la plus inutile du système. */
    const repondues = new Set(Array.isArray(o.deja) ? o.deja : []);
    const restants = manques.filter((m) => !repondues.has(m));
    if (!restants.length)
      return refus(o.sourceOfficielle ? REFUS.SOURCE_OFFICIELLE : REFUS.DONNEE_FRAICHE);

    return Object.freeze({ autorise: true, raison: null, manques: Object.freeze(restants) });
  }

  function refus(raison) {
    return Object.freeze({ autorise: false, raison, manques: Object.freeze([]) });
  }

  /* ===================================================================
     11. CE QU'ON MESURE, ET CE QU'ON NE MESURE PAS

     Des compteurs, rien d'autre. Aucun texte, aucune phrase saisie dans Aide,
     aucun identifiant de personne — et ce n'est pas une intention, c'est une
     contrainte du code : `compter` refuse tout nom qui n'est pas dans la liste
     gelée ci-dessous, et n'enregistre jamais autre chose qu'un entier.

     Ce qu'on veut pouvoir dire après la manifestation : combien d'ouvertures,
     quelles zones, combien de recalculs, combien ont coûté une requête
     externe, combien d'appels au modèle ont réellement servi, et combien de
     fois Autour a répondu depuis son seul cache.
     =================================================================== */
  const METRIQUES = Object.freeze([
    "territorial_mode_opened",
    "territorial_zone_changed",
    "territorial_recompute",
    "territorial_cache_hit",
    "territorial_cache_miss",
    "territorial_results_count",
    "territorial_gemini_requested",
    "territorial_gemini_skipped_fresh_data",
    "territorial_gemini_budget_blocked",
  ]);

  const compteurs = Object.create(null);
  const parZone = Object.create(null);

  function compter(nom, valeur, zone) {
    if (METRIQUES.indexOf(nom) < 0) return false;
    const n = Number(valeur);
    const pas = Number.isFinite(n) ? Math.trunc(n) : 1;
    compteurs[nom] = (compteurs[nom] || 0) + pas;
    /* La zone est un slug de configuration — « wazemmes », « centre » — pas
       une position. Elle dit quel quartier a été consulté, jamais où était
       quelqu'un. */
    if (zone && typeof zone === "string" && /^[a-z0-9-]{1,40}$/.test(zone)) {
      const ligne = parZone[zone] || (parZone[zone] = Object.create(null));
      ligne[nom] = (ligne[nom] || 0) + pas;
    }
    return true;
  }

  function rapport() {
    return { compteurs: Object.assign({}, compteurs),
             zones: JSON.parse(JSON.stringify(parZone)) };
  }

  function oublier() {
    Object.keys(compteurs).forEach((k) => { delete compteurs[k]; });
    Object.keys(parZone).forEach((k) => { delete parZone[k]; });
  }

  root.AutourTerritoire = Object.freeze({
    PHASES, RAISONS, NATURES, TTL, PRIORITE_RAFRAICHISSEMENT,
    RANG_SOURCE, RANG_AUTORITE, POIDS, BONUS_MAX, SERVICES, METRIQUES, REFUS,
    SEUIL_DEPLACEMENT_M, SEUIL_CENTRE_M, RETOUR_PREMIER_PLAN_MS,
    MAX_SERVICES, COMMENCE_TOT_MS, FINIT_BIENTOT_MS,
    normaliserContexte, normaliserZone, depuisLignes,
    phase, bouton, contexteActif,
    zoneDe, dansZone, dansPerimetre, distanceAuPerimetre,
    doitReevaluer, ttlDe, perime, perimes,
    rangSource, peutAffirmerOuverture, changementCritique,
    signaux, bonus, estOfficiel, services,
    enrichissementAutorise,
    compter, rapport, oublier,
    distanceM,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
