(function(root) {
  "use strict";
  const SOURCES = Object.freeze({ TAG: "tag", CATEGORIE: "categorie", PRIX: "prix" });
  const PLAFOND_INFERENCE = 0.75;
  const PAR_TAG = [
    // wifi : seul `internet_access` en parle. Aucune catégorie ne permet de
    // l'affirmer — un café n'a pas « forcément » du wifi.
    ["internet_access", (v) => /^(wlan|yes|wifi|terminal)$/.test(v) ? { wifi: 1 } : null],
    ["internet_access:fee", (v) => v === "no" ? { wifi: 0.9 } : null],
    ["wheelchair", (v) => v === "yes" ? { accessible: 1 } : v === "limited" ? { accessible: 0.5 } : null],
    ["outdoor_seating", (v) => v === "yes" ? { dehors: 1 } : null],
    ["indoor_seating", (v) => v === "yes" ? { interieur: 0.9 } : null],
    ["fee", (v) => v === "no" ? { gratuit: 0.9 } : null],
    ["access", (v) => /^(yes|public|permissive)$/.test(v) ? { gratuit: 0.5 } : null],
    ["quiet_hours", () => ({ calme: 0.8 })],
    ["laptop_friendly", (v) => v === "yes" ? { travail: 1 } : null],
    ["power_supply", (v) => v === "yes" ? { travail: 0.7 } : null],
    ["socket", (v) => v === "yes" ? { travail: 0.6 } : null],
    ["study_room", (v) => v === "yes" ? { etude: 1, calme: 0.8 } : null],
    ["dance", (v) => v === "yes" ? { festif: 0.9 } : null],
    ["dancing", (v) => v === "yes" ? { festif: 0.9 } : null],
    ["live_music", (v) => v === "yes" ? { festif: 0.8 } : null],
    ["playground", (v) => v === "yes" ? { famille: 0.9 } : null],
    ["baby_feeding", () => ({ famille: 0.8 })],
    ["changing_table", (v) => v === "yes" ? { famille: 0.8 } : null],
    ["max_age", () => ({ famille: 0.7 })],
    ["min_age", () => ({ famille: 0.5 })],
    ["reservation", (v) => v === "required" ? { adapte_solo: 0.3 } : null]
  ];
  const PAR_CATEGORIE = Object.freeze({
    biblio: { calme: 0.75, etude: 0.75, travail: 0.7, interieur: 0.7, gratuit: 0.7, adapte_solo: 0.7 },
    coworking: { travail: 0.75, etude: 0.6, calme: 0.6, interieur: 0.7, adapte_solo: 0.6 },
    musee: { calme: 0.65, interieur: 0.7, famille: 0.5, adapte_solo: 0.6, interieur_: 0 },
    parc: { dehors: 0.75, calme: 0.5, famille: 0.7, gratuit: 0.7, adapte_groupes: 0.6 },
    terrain: { dehors: 0.75, adapte_groupes: 0.7, famille: 0.5, gratuit: 0.6 },
    sport: { adapte_groupes: 0.6, dehors: 0.4 },
    /* La catégorie « café » couvre ici les boulangeries et salons de thé :
       en faire un lieu de travail à 0,45 suffisait à placer une boulangerie
       devant une bibliothèque. L'inférence reste, faible ; ce sont les tags
       (`power_supply`, `internet_access`, `laptop_friendly`) qui tranchent. */
    cafe: { travail: 0.3, calme: 0.35, interieur: 0.6, adapte_solo: 0.6 },
    bar: { festif: 0.6, adapte_groupes: 0.7, interieur: 0.6 },
    concert: { festif: 0.75, adapte_groupes: 0.7 },
    spectacle: { interieur: 0.6, adapte_groupes: 0.5 },
    cinema: { interieur: 0.7, famille: 0.6, romantique: 0.5, adapte_solo: 0.5 },
    resto: { interieur: 0.55, adapte_groupes: 0.5 },
    fastfood: { interieur: 0.4, pas_cher: 0.6 },
    marche: { dehors: 0.6, famille: 0.4 },
    friperie: { interieur: 0.5, pas_cher: 0.5 },
    toilettes: { gratuit: 0.5 },
    playground: { famille: 0.75, dehors: 0.75, gratuit: 0.7 }
  });
  const PAR_CATEGORIE_TRANSVERSE = Object.freeze({
    library: { calme: 0.7, etude: 0.7, travail: 0.65, gratuit: 0.65 },
    park: { dehors: 0.75, calme: 0.5, famille: 0.65, gratuit: 0.7 },
    study: { etude: 0.7, travail: 0.65, calme: 0.6 },
    family: { famille: 0.7 },
    kids_event: { famille: 0.75 },
    culture: { interieur: 0.5 },
    outing: { adapte_groupes: 0.5 }
  });
  function fusionner(cible, ajouts, source) {
    if (!ajouts) return;
    Object.entries(ajouts).forEach(([signal, valeur]) => {
      if (!Number.isFinite(valeur) || valeur <= 0) return;
      const v = source === SOURCES.CATEGORIE ? Math.min(valeur, PLAFOND_INFERENCE) : valeur;
      const connu = cible[signal];
      if (!connu || v > connu.valeur || connu.source === SOURCES.CATEGORIE && source === SOURCES.TAG)
        cible[signal] = { valeur: source === SOURCES.TAG ? valeur : v, source };
    });
  }
  function signauxDe(lieu) {
    const l = lieu || {};
    const tags = l.tags || {};
    const out = {};
    PAR_TAG.forEach(([cle, lire]) => {
      const v = tags[cle];
      if (v == null) return;
      fusionner(out, lire(String(v).toLowerCase()), SOURCES.TAG);
    });
    fusionner(out, PAR_CATEGORIE[l.cat], SOURCES.CATEGORIE);
    (l.categories || []).forEach((c) => {
      fusionner(out, PAR_CATEGORIE[c], SOURCES.CATEGORIE);
      fusionner(out, PAR_CATEGORIE_TRANSVERSE[c], SOURCES.CATEGORIE);
    });
    if (l.gratuit === true || l.prix === 0) fusionner(out, { gratuit: 0.9, pas_cher: 0.9 }, SOURCES.PRIX);
    if (Number.isFinite(Number(l.prixN))) {
      const n = Number(l.prixN);
      if (n <= 1) fusionner(out, { pas_cher: 1 }, SOURCES.PRIX);
      else if (n >= 3) fusionner(out, { romantique: 0.3 }, SOURCES.PRIX);
    }
    if (l.pmr === true) fusionner(out, { accessible: 1 }, SOURCES.TAG);
    return out;
  }
  function force(signaux, id) {
    const s = signaux && signaux[id];
    return s ? s.valeur : null;
  }
  function satisfait(signaux, id) {
    const v = force(signaux, id);
    if (v == null) return null;
    return v > 0;
  }
  function saisonDe(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    const m = d.getMonth() + 1;
    if (m >= 6 && m <= 8) return "ete";
    if (m === 12 || m <= 2) return "hiver";
    return m >= 3 && m <= 5 ? "printemps" : "automne";
  }
  const SAISON = Object.freeze({
    ete: { dehors: 0.35, interieur: -0.15 },
    printemps: { dehors: 0.2 },
    automne: { interieur: 0.15 },
    hiver: { dehors: -0.3, interieur: 0.3 }
  });
  function nuit(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    const h = d.getHours();
    const m = d.getMonth() + 1;
    const coucher = m >= 5 && m <= 8 ? 21 : m === 4 || m === 9 ? 20 : 18;
    return h >= coucher || h < 7;
  }
  function contexteSaison(date, vacances) {
    const bonus = Object.assign({}, SAISON[saisonDe(date)] || {});
    if (nuit(date)) {
      bonus.dehors = (bonus.dehors || 0) - 0.3;
      bonus.interieur = (bonus.interieur || 0) + 0.2;
    }
    if (vacances) bonus.famille = (bonus.famille || 0) + 0.3;
    return bonus;
  }
  root.AutourSignaux = Object.freeze({
    SOURCES,
    PLAFOND_INFERENCE,
    PAR_CATEGORIE,
    PAR_CATEGORIE_TRANSVERSE,
    signauxDe,
    force,
    satisfait,
    saisonDe,
    nuit,
    contexteSaison,
    SAISON
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
