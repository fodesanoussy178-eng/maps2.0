(function(root) {
  "use strict";
  const PHASES = Object.freeze({
    ABSENT: "absent",
    AVANT: "avant",
    PENDANT: "pendant",
    APRES: "apres"
  });
  const TERRE_M = 6371e3;
  function distanceM(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const dLat = (bLat - aLat) * r;
    const dLng = (bLng - aLng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * TERRE_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function nombre(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function horodatage(valeur) {
    if (valeur == null || valeur === "") return null;
    if (valeur instanceof Date) {
      const t2 = valeur.getTime();
      return Number.isFinite(t2) ? t2 : null;
    }
    if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
    const t = Date.parse(String(valeur));
    return Number.isFinite(t) ? t : null;
  }
  function point(p) {
    if (Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      return [Number(p[0]), Number(p[1])];
    if (p && Number.isFinite(Number(p.lat)) && (Number.isFinite(Number(p.lng)) || Number.isFinite(Number(p.lon))))
      return [Number(p.lat), Number(p.lng != null ? p.lng : p.lon)];
    return null;
  }
  const RAYON_ZONE_DEFAUT_M = 800;
  const RAYON_VISIBILITE_DEFAUT_M = 25e3;
  function normaliserZone(brut) {
    const z = brut || {};
    const centre = point([
      z.lat != null ? z.lat : z.latitude,
      z.lng != null ? z.lng : z.longitude
    ]);
    const slug = String(z.slug || z.zone_slug || "").trim();
    if (!slug) return null;
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
      metadata: z.metadata || {}
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
    const zones = (Array.isArray(c.zones) ? c.zones : []).map(normaliserZone).filter(Boolean).sort((a, b) => a.priorite - b.priorite);
    return Object.freeze({
      slug,
      nom: String(c.name || c.nom || slug),
      /* Le bouton dit « Braderie », pas « Braderie de Lille 2026 » : c'est un
         bouton, pas un titre. Le nom complet reste pour les écrans. */
      libelle: String(meta.libelle || meta.label || c.name || c.nom || slug),
      emoji: String(c.emoji || meta.emoji || "\u{1F4CD}"),
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
        (Array.isArray(meta.sources_officielles) ? meta.sources_officielles : []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      ),
      rayonVisibiliteM: nombre(meta.rayon_visibilite_m) || RAYON_VISIBILITE_DEFAUT_M,
      zones: Object.freeze(zones),
      metadata: meta
    });
  }
  function depuisLignes(lignes) {
    const parSlug = /* @__PURE__ */ new Map();
    (lignes || []).forEach((ligne) => {
      if (!ligne) return;
      const slug = String(ligne.slug || "").trim();
      if (!slug) return;
      if (!parSlug.has(slug)) parSlug.set(slug, Object.assign({}, ligne, { zones: [] }));
      const entree = parSlug.get(slug);
      const zone = ligne.zone_slug || ligne.zone && ligne.zone.slug;
      if (zone) entree.zones.push(ligne.zone || {
        slug: ligne.zone_slug,
        nom: ligne.zone_name,
        lat: ligne.zone_lat,
        lng: ligne.zone_lng,
        rayon_m: ligne.zone_rayon_m,
        priorite: ligne.zone_priorite,
        metadata: ligne.zone_metadata
      });
    });
    return [...parSlug.values()].map(normaliserContexte).filter(Boolean);
  }
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
      libelle: p === PHASES.AVANT ? contexte.libelle + " \xB7 bient\xF4t" : contexte.libelle,
      actif: p === PHASES.PENDANT
    });
  }
  function contexteActif(contextes, maintenant, position) {
    const t = horodatage(maintenant) == null ? Date.now() : Number(maintenant);
    const p = point(position);
    const candidats = (contextes || []).map((c) => c && c.slug && c.debutLe != null ? c : normaliserContexte(c)).filter(Boolean).filter((c) => VISIBLES.indexOf(phase(c, t)) >= 0).filter((c) => !p || visibleDepuis(p, c));
    if (!candidats.length) return null;
    candidats.sort((a, b) => a.priorite - b.priorite || a.debutLe - b.debutLe);
    return candidats[0];
  }
  function visibleDepuis(p, contexte) {
    const d = distanceAuCentre(p, contexte);
    return d == null || d <= contexte.rayonVisibiliteM;
  }
  function dansZone(p, zone) {
    const c = point(p);
    if (!c || !zone) return false;
    if (zone.contour && zone.contour.length >= 3) return dansContour(c, zone.contour);
    if (zone.lat == null || zone.lng == null) return false;
    return distanceM(c[0], c[1], zone.lat, zone.lng) <= zone.rayonM;
  }
  function dansContour(c, contour) {
    let dedans = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const [yi, xi] = contour[i];
      const [yj, xj] = contour[j];
      const traverse = yi > c[0] !== yj > c[0] && c[1] < (xj - xi) * (c[0] - yi) / (yj - yi) + xi;
      if (traverse) dedans = !dedans;
    }
    return dedans;
  }
  function zoneDe(position, contexte) {
    const p = point(position);
    if (!p || !contexte) return null;
    const dedans = contexte.zones.filter((z) => dansZone(p, z));
    if (!dedans.length) return null;
    return dedans.sort((a, b) => distanceM(p[0], p[1], a.lat, a.lng) - distanceM(p[0], p[1], b.lat, b.lng) || a.priorite - b.priorite)[0];
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
  const SEUIL_DEPLACEMENT_M = 400;
  const SEUIL_CENTRE_M = 400;
  const RETOUR_PREMIER_PLAN_MS = 5 * 6e4;
  const RAISONS = Object.freeze({
    OUVERTURE: "ouverture",
    PREMIERE: "premiere_evaluation",
    DEPLACEMENT: "deplacement",
    CENTRE: "centre_carte",
    ZONE: "changement_de_zone",
    EXPIRATION: "information_expiree",
    PREMIER_PLAN: "retour_premier_plan"
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
      if ((avant.zone || null) !== (c.zone || null)) raisons.push(RAISONS.ZONE);
      if (avant.expireLe != null && t >= avant.expireLe) raisons.push(RAISONS.EXPIRATION);
      if (c.retourPremierPlan && avant.maintenant != null && t - avant.maintenant >= RETOUR_PREMIER_PLAN_MS)
        raisons.push(RAISONS.PREMIER_PLAN);
    }
    const aRafraichir = perimes(c.donnees, t);
    return Object.freeze({
      recalculer: raisons.length > 0,
      resynchroniser: aRafraichir.length > 0,
      aRafraichir: Object.freeze(aRafraichir),
      raisons: Object.freeze(raisons)
    });
  }
  const NATURES = Object.freeze({
    PERIMETRE: "perimetre",
    // zones, rues, emprise officielle
    EQUIPEMENTS: "equipements",
    // toilettes fixes, stations, permanents
    PROGRAMME: "programme",
    // stands, animations annoncées, restauration
    TEMPOREL: "temporel"
    // en cours, commence, se termine, annulation
  });
  const TTL = Object.freeze({
    [NATURES.PERIMETRE]: 7 * 24 * 3600 * 1e3,
    [NATURES.EQUIPEMENTS]: 24 * 3600 * 1e3,
    [NATURES.PROGRAMME]: 30 * 60 * 1e3,
    [NATURES.TEMPOREL]: 2 * 60 * 1e3
  });
  const PRIORITE_RAFRAICHISSEMENT = Object.freeze({
    [NATURES.TEMPOREL]: 0,
    [NATURES.PROGRAMME]: 1,
    [NATURES.EQUIPEMENTS]: 2,
    [NATURES.PERIMETRE]: 3
  });
  function ttlDe(nature) {
    return TTL[nature] != null ? TTL[nature] : TTL[NATURES.PROGRAMME];
  }
  function perime(vuLe, nature, maintenant) {
    const t = Number.isFinite(Number(maintenant)) ? Number(maintenant) : Date.now();
    const vu = horodatage(vuLe);
    if (vu == null) return true;
    return t - vu >= ttlDe(nature);
  }
  function perimes(donnees, maintenant) {
    const d = donnees || {};
    return Object.keys(NATURES).map((k) => NATURES[k]).filter((nature) => Object.prototype.hasOwnProperty.call(d, nature)).filter((nature) => perime(d[nature], nature, maintenant)).sort((a, b) => PRIORITE_RAFRAICHISSEMENT[a] - PRIORITE_RAFRAICHISSEMENT[b]);
  }
  const RANG_SOURCE = Object.freeze({
    contexte_officiel: 6,
    institutionnel: 5,
    organisateur: 4,
    agenda_officiel: 3,
    datatourisme: 2,
    openstreetmap: 1,
    tiers: 0
  });
  const ALIAS_SOURCE = Object.freeze({
    openagenda: "agenda_officiel",
    datatourisme: "datatourisme",
    osm: "openstreetmap",
    openstreetmap: "openstreetmap",
    google_places: "tiers",
    autour: "tiers"
  });
  function rangSource(source, contexte) {
    const nom = String(source == null ? "" : source).trim().toLowerCase();
    if (!nom) return RANG_SOURCE.tiers;
    if (contexte && contexte.sourcesOfficielles.indexOf(nom) >= 0)
      return RANG_SOURCE.contexte_officiel;
    if (RANG_SOURCE[nom] != null) return RANG_SOURCE[nom];
    const alias = ALIAS_SOURCE[nom];
    return alias != null ? RANG_SOURCE[alias] : RANG_SOURCE.tiers;
  }
  const RANG_AUTORITE = RANG_SOURCE.agenda_officiel;
  function peutAffirmerOuverture(sources, contexte) {
    const noms = (Array.isArray(sources) ? sources : [sources]).map((s) => String(s == null ? "" : s && s.source || s).trim().toLowerCase()).filter(Boolean);
    if (!noms.length) return false;
    const distinctes = [...new Set(noms)];
    if (distinctes.some((n) => rangSource(n, contexte) >= RANG_AUTORITE)) return true;
    return distinctes.filter((n) => rangSource(n, contexte) > RANG_SOURCE.tiers).length >= 2;
  }
  function changementCritique(avant, apres) {
    const a = avant == null ? "unknown" : String(avant);
    const b = apres == null ? "unknown" : String(apres);
    if (a === b) return false;
    if (b === "open" && (a === "unknown" || a === "")) return true;
    if (a === "open" && (b === "closed" || b === "temporary_closed" || b === "permanently_closed")) return true;
    return false;
  }
  const POIDS = Object.freeze({
    officiel: 60,
    // publié par une source officielle de la manifestation
    dansZone: 40,
    // à l'intérieur d'un périmètre déclaré
    enCours: 90,
    // ça se passe maintenant
    commenceTot: 70,
    // ça commence dans moins de 30 min
    finitBientot: 25,
    // ça se termine bientôt : y aller vaut d'y aller vite
    temporaire: 35,
    // activité temporaire liée à la période
    ouvertUtile: 20,
    // lieu pertinent, ouvert maintenant
    service: 10
    // service contextuel utile
  });
  const BONUS_MAX = 250;
  const COMMENCE_TOT_MS = 30 * 6e4;
  const FINIT_BIENTOT_MS = 45 * 6e4;
  const CATEGORIES_SERVICE = Object.freeze([
    "toilettes",
    "eau",
    "metro",
    "bus",
    "tram",
    "train",
    "velo",
    "sante",
    "recharge"
  ]);
  function sourcesDe(item) {
    const l = item || {};
    const liste = Array.isArray(l.sources) ? l.sources.slice() : [];
    if (l.source) liste.push(l.source);
    if (l.primary_source) liste.push(l.primary_source);
    return liste.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  function estOfficiel(item, contexte) {
    if (!item || !contexte) return false;
    if (item.contexteTerritorial === contexte.slug) return true;
    if (!contexte.sourcesOfficielles.length) return false;
    return sourcesDe(item).some((s) => contexte.sourcesOfficielles.indexOf(s) >= 0);
  }
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
      dansZone: !!zoneDe([
        l.lat != null ? l.lat : l.latitude,
        l.lng != null ? l.lng : l.longitude
      ], contexte),
      enCours,
      commenceTot: !enCours && debut != null && debut > t && debut - t <= COMMENCE_TOT_MS,
      finitBientot: enCours && fin != null && fin > t && fin - t <= FINIT_BIENTOT_MS,
      temporaire: estActiviteDuContexte(l, contexte, t),
      ouvertUtile: !l.isTemporary && l.ouvert === true && CATEGORIES_SERVICE.indexOf(l.cat) < 0,
      service: CATEGORIES_SERVICE.indexOf(l.cat) >= 0
    });
  }
  function bonus(item, contexte, options) {
    if (!contexte) return 0;
    const s = signaux(item, contexte, options);
    let total = 0;
    Object.keys(POIDS).forEach((cle) => {
      if (s[cle]) total += POIDS[cle];
    });
    const zone = options && options.zone;
    if (s.dansZone && zone && zone.priorite <= 10) total += 10;
    return Math.min(BONUS_MAX, total);
  }
  const SERVICES = Object.freeze([
    Object.freeze({ id: "toilettes", emoji: "\u{1F6BB}", label: "Toilettes", cats: ["toilettes"] }),
    Object.freeze({ id: "eau", emoji: "\u{1F6B0}", label: "Eau", cats: ["eau"] }),
    Object.freeze({
      id: "transport",
      emoji: "\u{1F687}",
      label: "M\xE9tro",
      cats: ["metro", "tram", "train", "bus"]
    }),
    Object.freeze({
      id: "aide",
      emoji: "\u2764\uFE0F",
      label: "Point d\u2019aide",
      cats: ["sante", "asso", "alimentaire", "hebergement"]
    }),
    Object.freeze({ id: "velo", emoji: "\u{1F6B2}", label: "Parking v\xE9lo", cats: ["velo"] })
  ]);
  const LIBELLE_TRANSPORT = Object.freeze({
    metro: "M\xE9tro",
    tram: "Tram",
    train: "Gare",
    bus: "Bus"
  });
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
        if (l.ouvert === false) return;
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
        label: famille.id === "transport" ? LIBELLE_TRANSPORT[meilleur.cat] || famille.label : famille.label,
        item: meilleur,
        distance: meilleureDistance
      }));
    });
    return sortie;
  }
  const REFUS = Object.freeze({
    BUDGET: "budget_epuise",
    CACHE_FRAIS: "cache_frais",
    RIEN_NE_MANQUE: "rien_ne_manque",
    SOURCE_OFFICIELLE: "source_officielle",
    DONNEE_FRAICHE: "donnee_fraiche"
  });
  function enrichissementAutorise(lieu, options) {
    const o = options || {};
    const t = Number.isFinite(Number(o.maintenant)) ? Number(o.maintenant) : Date.now();
    if (Number(o.budgetRestant) <= 0)
      return refus(REFUS.BUDGET);
    const expire = horodatage(o.cacheExpireLe);
    if (expire != null && expire > t) return refus(REFUS.CACHE_FRAIS);
    const manques = Array.isArray(o.manques) ? o.manques.filter(Boolean) : [];
    if (!manques.length) return refus(REFUS.RIEN_NE_MANQUE);
    const repondues = new Set(Array.isArray(o.deja) ? o.deja : []);
    const restants = manques.filter((m) => !repondues.has(m));
    if (!restants.length)
      return refus(o.sourceOfficielle ? REFUS.SOURCE_OFFICIELLE : REFUS.DONNEE_FRAICHE);
    return Object.freeze({ autorise: true, raison: null, manques: Object.freeze(restants) });
  }
  function refus(raison) {
    return Object.freeze({ autorise: false, raison, manques: Object.freeze([]) });
  }
  const METRIQUES = Object.freeze([
    "territorial_mode_opened",
    "territorial_zone_changed",
    "territorial_recompute",
    "territorial_cache_hit",
    "territorial_cache_miss",
    "territorial_results_count",
    "territorial_gemini_requested",
    "territorial_gemini_skipped_fresh_data",
    "territorial_gemini_budget_blocked"
  ]);
  const compteurs = /* @__PURE__ */ Object.create(null);
  const parZone = /* @__PURE__ */ Object.create(null);
  function compter(nom, valeur, zone) {
    if (METRIQUES.indexOf(nom) < 0) return false;
    const n = Number(valeur);
    const pas = Number.isFinite(n) ? Math.trunc(n) : 1;
    compteurs[nom] = (compteurs[nom] || 0) + pas;
    if (zone && typeof zone === "string" && /^[a-z0-9-]{1,40}$/.test(zone)) {
      const ligne = parZone[zone] || (parZone[zone] = /* @__PURE__ */ Object.create(null));
      ligne[nom] = (ligne[nom] || 0) + pas;
    }
    return true;
  }
  function rapport() {
    return {
      compteurs: Object.assign({}, compteurs),
      zones: JSON.parse(JSON.stringify(parZone))
    };
  }
  function oublier() {
    Object.keys(compteurs).forEach((k) => {
      delete compteurs[k];
    });
    Object.keys(parZone).forEach((k) => {
      delete parZone[k];
    });
  }
  root.AutourTerritoire = Object.freeze({
    PHASES,
    RAISONS,
    NATURES,
    TTL,
    PRIORITE_RAFRAICHISSEMENT,
    RANG_SOURCE,
    RANG_AUTORITE,
    POIDS,
    BONUS_MAX,
    SERVICES,
    METRIQUES,
    REFUS,
    SEUIL_DEPLACEMENT_M,
    SEUIL_CENTRE_M,
    RETOUR_PREMIER_PLAN_MS,
    MAX_SERVICES,
    COMMENCE_TOT_MS,
    FINIT_BIENTOT_MS,
    normaliserContexte,
    normaliserZone,
    depuisLignes,
    phase,
    bouton,
    contexteActif,
    zoneDe,
    dansZone,
    dansPerimetre,
    distanceAuPerimetre,
    doitReevaluer,
    ttlDe,
    perime,
    perimes,
    rangSource,
    peutAffirmerOuverture,
    changementCritique,
    signaux,
    bonus,
    estOfficiel,
    services,
    enrichissementAutorise,
    compter,
    rapport,
    oublier,
    distanceM
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
