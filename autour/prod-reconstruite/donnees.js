(function(root) {
  "use strict";
  const SOURCES = Object.freeze({
    OSM: "osm",
    GOOGLE: "google",
    HABITANT: "habitant",
    // publié dans Autour
    AGENDA: "agenda",
    // OpenAgenda et équivalents
    CATEGORIE: "categorie",
    // inférence assumée
    INCONNU: null
  });
  const CONFIANCE = Object.freeze({
    habitant_verifie: 1,
    google: 0.9,
    osm: 0.85,
    agenda: 0.85,
    habitant: 0.6,
    categorie: 0.4
  });
  const maintenant = () => (/* @__PURE__ */ new Date()).toISOString();
  const PALIERS = Object.freeze([
    { min: 0, max: 0 },
    { min: 1, max: 15 },
    { min: 15, max: 30 },
    { min: 30, max: 60 },
    { min: 60, max: null }
  ]);
  function vide(champ) {
    return Object.freeze({
      [champ]: null,
      source: null,
      confidence: 0,
      updated_at: null
    });
  }
  const PRIX_INCONNU = Object.freeze({
    level: null,
    min: null,
    max: null,
    currency: "EUR",
    source: null,
    confidence: 0,
    updated_at: null
  });
  function normaliserPrix(lieu) {
    const l = lieu || {};
    const vu = l.prixVuLe || l.updated_at || null;
    if (Number.isFinite(Number(l.prix)) && (l.prix > 0 || l.gratuit === true)) {
      const n2 = Number(l.prix);
      return {
        level: n2 === 0 ? 0 : null,
        min: n2,
        max: n2,
        currency: "EUR",
        source: SOURCES.HABITANT,
        confidence: l.verifie ? CONFIANCE.habitant_verifie : CONFIANCE.habitant,
        updated_at: vu
      };
    }
    if (l.gratuit === true) {
      return {
        level: 0,
        min: 0,
        max: 0,
        currency: "EUR",
        source: l.tags && l.tags.fee === "no" ? SOURCES.OSM : SOURCES.HABITANT,
        confidence: l.tags && l.tags.fee === "no" ? CONFIANCE.osm : CONFIANCE.habitant,
        updated_at: vu
      };
    }
    const n = Number(l.prixN);
    if (Number.isFinite(n) && PALIERS[n]) {
      return Object.assign({
        level: n,
        currency: "EUR",
        source: SOURCES.GOOGLE,
        confidence: CONFIANCE.google * 0.8,
        updated_at: vu
      }, PALIERS[n]);
    }
    return PRIX_INCONNU;
  }
  function depassePlafond(prix, plafond) {
    if (!prix || prix.confidence <= 0) return null;
    const max = Number(plafond);
    if (!Number.isFinite(max)) return null;
    if (max === 0) return prix.min != null && prix.min > 0;
    if (prix.min == null) return null;
    return prix.min > max;
  }
  const HORAIRES_INCONNUS = Object.freeze({
    open_now: null,
    next_open: null,
    next_close: null,
    source: null,
    confidence: 0,
    updated_at: null
  });
  function normaliserHoraires(lieu, at, disponibilite) {
    const l = lieu || {};
    const dispo = typeof disponibilite === "function" ? disponibilite(l, at) : disponibilite;
    if (!dispo || dispo.status === "unknown") return HORAIRES_INCONNUS;
    const confiance = dispo.source === "declaree" ? CONFIANCE.habitant : dispo.source === "officielle" ? CONFIANCE.habitant_verifie : dispo.source === "google" ? CONFIANCE.google : CONFIANCE.osm;
    return {
      open_now: dispo.status === "permanently_closed" ? false : !!dispo.isOpenNow,
      next_open: dispo.opensAt || null,
      next_close: dispo.closesAt || null,
      source: dispo.source === "declaree" ? SOURCES.HABITANT : dispo.source === "google" ? SOURCES.GOOGLE : SOURCES.OSM,
      confidence: confiance,
      updated_at: l.horairesVusLe || null,
      status: dispo.status,
      closesAtTime: dispo.closesAtTime || null,
      opensAtTime: dispo.opensAtTime || null
    };
  }
  function fermeAvant(horaires, minutes) {
    if (!horaires || horaires.confidence <= 0 || !horaires.closesAtTime) return null;
    const [h, m] = String(horaires.closesAtTime).split(":").map(Number);
    if (!Number.isFinite(h)) return null;
    let fin = h * 60 + (m || 0);
    if (fin <= 6 * 60) fin += 24 * 60;
    return fin < Number(minutes);
  }
  function profil(lieu, options) {
    const o = options || {};
    const signaux = root.AutourSignaux;
    return {
      prix: normaliserPrix(lieu),
      horaires: normaliserHoraires(lieu, o.at, o.disponibilite),
      signaux: signaux ? signaux.signauxDe(lieu) : {},
      updated_at: lieu && lieu.updated_at || null
    };
  }
  function manque(lieu, intention, options) {
    const p = profil(lieu, options);
    const besoins = [];
    const it = intention || {};
    const veutBudget = (it.contraintes || []).some((c) => c.type === "budget") || it.budget && (it.budget.max != null || it.budget.pasCher);
    const veutHoraire = (it.contraintes || []).some((c) => c.type === "ouvertApres") || it.horaire && it.horaire.ouvertMaintenant;
    if (veutBudget && p.prix.confidence <= 0) besoins.push("prix");
    if (veutHoraire && p.horaires.confidence <= 0) besoins.push("horaires");
    return besoins;
  }
  root.AutourDonnees = Object.freeze({
    SOURCES,
    CONFIANCE,
    PALIERS,
    PRIX_INCONNU,
    HORAIRES_INCONNUS,
    normaliserPrix,
    normaliserHoraires,
    depassePlafond,
    fermeAvant,
    profil,
    manque,
    maintenant
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
