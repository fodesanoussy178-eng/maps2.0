function panne(titre, corps) {
  const p = document.getElementById("panne");
  p.innerHTML = "<strong>" + titre + "</strong>" + corps + `<button onclick="document.getElementById('panne').hidden=true">Fermer</button>`;
  p.hidden = false;
}
const TEMPS = window.AutourTemps;
const EXPLIQUE = window.AutourExplications;
const COMPRENDRE = window.AutourComprendre;
const SIGNAUX = window.AutourSignaux;
const DONNEES = window.AutourDonnees;
const AIDE = window.AutourAide;
const IMAGES = window.AutourImages || null;
function sansAccents(s) {
  if (COMPRENDRE && COMPRENDRE.sansAccents) return COMPRENDRE.sansAccents(s);
  return String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
const journal = {
  info(...a) {
    if (window.__autourDebug) console.info(...a);
  },
  warn(...a) {
    if (window.__autourDebug) console.warn(...a);
  }
};
window.addEventListener("error", (e) => {
  console.error("Autour :", e && (e.error || e.message || e));
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Autour \xB7 promesse rejet\xE9e :", e && e.reason);
});
const {
  FAMILY_CATEGORIES,
  classifyPlaceWeighted,
  toCommonItem,
  matchesCategory,
  dedupeItems,
  groupLogicalPlaces,
  isDiscoveryCandidate,
  parseSearchQuery,
  isAvailableNow,
  rankResults
} = window.AutourCore;
let villeDetectee = null;
let canauxAMoi = [];
let originePosition = null;
let precisionPosition = null;
const positionConnue = () => originePosition !== null;
const positionPrecise = () => precisionPosition === "point";
const positionApprochee = () => positionConnue() && !positionPrecise();
const CTX = window.AutourContexte || null;
const ECRANS_DIFFERES = [
  /* la fiche d'un lieu */
  "ouvrirFicheCompacte",
  "ouvrirDetail",
  "faitsAide",
  /* l'itinéraire */
  "afficherTrajet",
  "entrerNav",
  "itineraireOSRM",
  "dessinerSegments",
  "urlItineraireExterne",
  "liensItinerairesExternes",
  /* publier */
  "ouvrirChoixLieu",
  "dessinerFormulaire",
  "publier",
  "reessayerPublication",
  "annulerPublication",
  "continuerPublication",
  /* le compte, le profil et les canaux */
  "ouvrirEcranCompte",
  "rendreEcranCompte",
  "ouvrirProfil",
  "ouvrirMesPublications",
  "ouvrirCanaux",
  "envoyerLienCompte",
  "verifierCodeCompte",
  "enregistrerProfilCompte",
  "seDeconnecter",
  "chargerCanal",
  "actionCreateur",
  "partagerInviter"
];
const VERSIONS_DIFFEREES = { "differe/ecrans.js": "?v=8071f53a" };
const MODULE_ECRANS = "differe/ecrans.js";
const modulesDifferes = /* @__PURE__ */ new Map();
function auBesoin(module) {
  const dejaLa = modulesDifferes.get(module);
  if (dejaLa) return dejaLa;
  const promesse = new Promise((tenu, rompu) => {
    const balise = document.createElement("script");
    balise.src = module + (VERSIONS_DIFFEREES[module] || "");
    balise.async = false;
    balise.onload = () => tenu(true);
    balise.onerror = () => rompu(new Error("module indisponible : " + module));
    document.head.appendChild(balise);
  }).catch((err) => {
    modulesDifferes.delete(module);
    throw err;
  });
  modulesDifferes.set(module, promesse);
  return promesse;
}
function ecranAuBesoin(nom, args) {
  charge("Ouverture\u2026");
  return auBesoin(MODULE_ECRANS).then(() => {
    charge(null);
    const vraie = window[nom];
    if (typeof vraie !== "function" || vraie.amorce === true)
      throw new Error("\xE9cran manquant : " + nom);
    return vraie.apply(null, args);
  }).catch((err) => {
    charge(null);
    majSignalMaj(false);
    console.error("\xC9cran diff\xE9r\xE9 :", err.message);
    toast("\xC9cran indisponible \u2014 r\xE9essaie dans un instant");
  });
}
function amorcerEcrans() {
  ECRANS_DIFFERES.forEach((nom) => {
    const amorce = function() {
      return ecranAuBesoin(nom, arguments);
    };
    amorce.amorce = true;
    window[nom] = amorce;
  });
}
amorcerEcrans();
function prechargerEcrans() {
  const aller = () => {
    auBesoin(MODULE_ECRANS).catch(() => {
    });
  };
  if (ORDO && ORDO.differer) ORDO.differer(aller, { timeout: 4e3 });
  else setTimeout(aller, 2e3);
}
const PLAF = window.AutourPlafonds || null;
let zoneActive = null;
let porteeCourante = 0;
let bassinTerritorialActif = null;
const porteeValide = (p) => p === porteeCourante;
function definirZoneActive(zone) {
  if (CTX && zoneActive && zone && CTX.memeZone(zoneActive, zone)) return porteeCourante;
  zoneActive = zone || null;
  porteeCourante += 1;
  oublierItemsMaintenant();
  recoCache = null;
  dernierRecoRendu = null;
  selectionAccueil = null;
  return porteeCourante;
}
function dansZoneActive(l) {
  if (!CTX || !zoneActive) return true;
  return CTX.dansZone(l, zoneActive, { vue: bornesVue() });
}
let bornesVueMemo = null;
function bornesVue() {
  if (bornesVueMemo) return bornesVueMemo.v;
  let v = null;
  if (map && map.getBounds) {
    try {
      const b = map.getBounds();
      v = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    } catch (e) {
      v = null;
    }
  }
  bornesVueMemo = { v };
  queueMicrotask(() => {
    bornesVueMemo = null;
  });
  return v;
}
function centreZoneActive() {
  if (zoneActive) return [zoneActive.lat, zoneActive.lng];
  return positionMoi;
}
const idZoneActive = () => CTX ? CTX.idZone(zoneActive) : "sans-zone";
function centreDonnees() {
  return centreZoneActive() || positionMoi || null;
}
function chargerAideZone(options) {
  const c = centreDonnees();
  return c ? chargerAide(c[0], c[1], options) : Promise.resolve([]);
}
function distanceDepuisZone(l) {
  const c = centreZoneActive() || positionMoi;
  if (!c || !l) return NaN;
  return distanceM(c[0], c[1], l.lat, l.lng);
}
let rechercheGeo = null;
let zoneAffichee = null;
const REGIMES = {
  local: { resultats: 10, rayon: 1500, limite: 300 },
  // ici, ou tout contre
  proche: { resultats: 5, rayon: 1200, limite: 120 },
  // l'agglomération
  voisine: { resultats: 4, rayon: 1e3, limite: 80 },
  // la même région
  loin: { resultats: 3, rayon: 800, limite: 50 }
  // l'autre bout du pays
};
const SEUIL_LOCAL_M = 8e3;
const SEUIL_PROCHE_M = 3e4;
const SEUIL_VOISINE_M = 12e4;
function dansEmprise(coords, emprise) {
  if (!coords || !Array.isArray(emprise) || emprise.length !== 2) return false;
  const [[sud, ouest], [nord, est]] = emprise;
  return coords[0] >= sud && coords[0] <= nord && coords[1] >= ouest && coords[1] <= est;
}
function regimeZone(zone, depuis, mesuree) {
  if (!zone) return "local";
  const pos = depuis || positionMoi;
  if (!pos) return "loin";
  const sure = mesuree === void 0 ? positionPrecise() : !!mesuree;
  const d = distanceM(pos[0], pos[1], zone.lat, zone.lng);
  if (sure && (dansEmprise(pos, zone.emprise) || d <= SEUIL_LOCAL_M))
    return "local";
  if (d <= SEUIL_PROCHE_M) return "proche";
  if (d <= SEUIL_VOISINE_M) return "voisine";
  return "loin";
}
function regimePoint(lat, lng) {
  if (!positionMoi) return "local";
  const d = distanceM(positionMoi[0], positionMoi[1], lat, lng);
  if (d <= SEUIL_LOCAL_M) return "local";
  if (d <= SEUIL_PROCHE_M) return "proche";
  if (d <= SEUIL_VOISINE_M) return "voisine";
  return "loin";
}
const reglagesZone = (zone) => REGIMES[regimeZone(zone)];
const plafondPour = (zone) => reglagesZone(zone).resultats;
const plafondResultats = () => plafondPour(rechercheGeo);
const surPlace = () => regimeZone(rechercheGeo) === "local";
function ressembleAUneZone(q) {
  const texte = (q || "").trim();
  if (texte.length < 3) return false;
  if (estTermeMetier(texte)) return false;
  if (COMPRENDRE && COMPRENDRE.estVocabulaire(texte, {
    cuisineDe: cuisineRecherchee,
    categorieDe: categorieRecherchee
  })) return false;
  return /^[\p{L}\d\s'’-]+$/u.test(texte);
}
const ZOOM_MIN_CHARGEMENT = 13;
const ZOOM_ZONE_MAX = 15;
const ZOOM_ZONE_MIN = ZOOM_MIN_CHARGEMENT;
async function rechercheGeographique(q, generationOuSignal) {
  const generationRecherche = generationOuSignal && generationOuSignal.controleur ? generationOuSignal : null;
  const signal = generationRecherche ? generationRecherche.signal : generationOuSignal;
  const zone = await geocoderVille(q, null, signal);
  if (!zone || !map) return false;
  recherche = "";
  if ($("#rech")) $("#rech").value = "";
  if (zone.emprise) {
    cadrerSur(zone.emprise, { maxZoom: ZOOM_ZONE_MAX, padding: [24, 24], animate: true });
    surLaCarte((m) => {
      if (m.getZoom() < ZOOM_ZONE_MIN) m.setZoom(ZOOM_ZONE_MIN);
    }, "zoom-mini");
  } else {
    allerVers([zone.lat, zone.lng], ZOOM_ZONE_MAX, { duration: 0.8 });
  }
  const e = zone.emprise;
  const c = map.getCenter();
  const centre = e ? [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2] : c ? [c.lat, c.lng] : [zone.lat, zone.lng];
  rechercheGeo = { nom: q, lat: centre[0], lng: centre[1], emprise: zone.emprise || null };
  definirZoneActive(CTX ? CTX.zoneRecherche(q, centre, zone.emprise || null) : null);
  if (generationRecherche && generationsActives.get(generationRecherche.canal) === generationRecherche)
    generationRecherche.portee = porteeCourante;
  annulerChargementsZone("recherche:zone");
  precalculPourZone(centre[0], centre[1], porteeCourante);
  if (!positionPrecise()) {
    originePosition = "manual";
    precisionPosition = "ville";
  }
  selectionAccueil = null;
  rendre();
  majAccueil();
  if (modeAide) chargerAide(centre[0], centre[1]);
  chargerZone(
    centre[0],
    centre[1],
    { reglages: reglagesZone(rechercheGeo), zoomVise: ZOOM_ZONE_MIN }
  );
  majBoutons();
  return true;
}
const favorisIds = /* @__PURE__ */ new Set();
let favorisCharges = false;
function refFavori(l) {
  if (!l) return "";
  if (l.dbId) return "";
  return (l.source || "osm") + ":" + l.id;
}
function cleFavori(l) {
  return l && l.dbId ? "pub:" + l.dbId : refFavori(l);
}
function estFavori(l) {
  return favorisIds.has(cleFavori(l));
}
async function chargerFavoris() {
  if (favorisCharges) return;
  if (!await connecter()) return;
  if (!moiId) return;
  favorisCharges = true;
  const lignes = await Store.favoris();
  favorisIds.clear();
  lignes.forEach((f) => favorisIds.add(f.publication_id ? "pub:" + f.publication_id : f.lieu_ref));
  majCoeurs();
}
async function basculerFavori(l) {
  const cle = cleFavori(l);
  if (!cle) return;
  const etait = favorisIds.has(cle);
  if (etait) favorisIds.delete(cle);
  else favorisIds.add(cle);
  majCoeurs();
  if (!estConnecte()) {
    if (etait) favorisIds.add(cle);
    else favorisIds.delete(cle);
    majCoeurs();
    await exigerCompte("favori", { cle });
    return;
  }
  const ok = etait ? await Store.retirerFavori(l) : await Store.ajouterFavori(l);
  if (!ok) {
    if (etait) favorisIds.add(cle);
    else favorisIds.delete(cle);
    majCoeurs();
    toast("Impossible d\u2019enregistrer ce favori");
    return;
  }
  majNavBas();
}
function majCoeurs() {
  document.querySelectorAll("[data-coeur]").forEach((b) => {
    const actif = favorisIds.has(b.dataset.coeur);
    b.classList.toggle("actif", actif);
    b.setAttribute("aria-pressed", String(actif));
    b.setAttribute("aria-label", actif ? "Retirer des favoris" : "Ajouter aux favoris");
  });
}
function boutonCoeur(l) {
  const cle = cleFavori(l);
  if (!cle) return "";
  const actif = favorisIds.has(cle);
  return '<button class="coeur' + (actif ? " actif" : "") + '" data-coeur="' + esc(cle) + '" aria-pressed="' + actif + '" aria-label="' + (actif ? "Retirer des favoris" : "Ajouter aux favoris") + '"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z"/></svg></button>';
}
document.addEventListener("click", (e) => {
  const bouton = e.target.closest && e.target.closest("[data-coeur]");
  if (!bouton) return;
  e.preventDefault();
  e.stopPropagation();
  const cle = bouton.dataset.coeur;
  const lieu = lieux.find((x) => cleFavori(x) === cle) || favorisEnMemoire.get(cle);
  if (lieu) basculerFavori(lieu);
});
const favorisEnMemoire = /* @__PURE__ */ new Map();
const disponibilitesParObjet = /* @__PURE__ */ new WeakMap();
let instantDisponibiliteDuTour = null;
function instantDisponibilite() {
  if (instantDisponibiliteDuTour != null) return instantDisponibiliteDuTour;
  instantDisponibiliteDuTour = instantCreneau().getTime();
  queueMicrotask(() => {
    instantDisponibiliteDuTour = null;
  });
  return instantDisponibiliteDuTour;
}
function dispoDe(l, arrivee, quand) {
  const module = window.AutourAvailability;
  if (!module) return null;
  const instant = quand == null ? instantDisponibilite() : quand;
  if (!l || typeof l !== "object" && typeof l !== "function")
    return module.getPlaceAvailability(l, instant, arrivee);
  let cache = disponibilitesParObjet.get(l);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    disponibilitesParObjet.set(l, cache);
  }
  const cleTemps = estTemporaire(l) ? instant : Math.floor(instant / 6e4);
  const cle = cleTemps + "|" + (arrivee == null ? "" : arrivee);
  if (cache.has(cle)) return cache.get(cle);
  const resultat = module.getPlaceAvailability(l, instant, arrivee);
  if (cache.size >= 4) cache.clear();
  cache.set(cle, resultat);
  return resultat;
}
function heureFrancaise(hhmm) {
  const module = window.AutourAvailability;
  return module && module.heureFr ? module.heureFr(hhmm) : String(hhmm || "");
}
function badgeDispo(l) {
  if (estTemporaire(l)) return "";
  const d = dispoDe(l);
  if (!d) return "";
  const classe = d.status === "open" ? "ouvert" : d.status === "unknown" ? "inconnu" : "ferme";
  return '<span class="' + classe + '">' + esc(d.label) + "</span>";
}
function estFerme(l) {
  const d = dispoDe(l);
  return !!d && (d.status === "closed" || d.status === "permanently_closed");
}
const PERF = {
  vus: /* @__PURE__ */ new Set(),
  lcp: 0,
  temps: /* @__PURE__ */ Object.create(null),
  rendus: { panneau: 0, carte: 0 },
  cpu: /* @__PURE__ */ Object.create(null),
  erreurs: 0,
  reseau: { total: 0, demarrage: 0, parSource: /* @__PURE__ */ Object.create(null) },
  demarrageTermine: false,
  expositionPlanifiee: false,
  exposer() {
    try {
      document.documentElement.dataset.autourPerf = JSON.stringify({
        temps: this.temps,
        reseau: this.reseau,
        rendus: this.rendus,
        cpu: this.cpu,
        erreurs: this.erreurs,
        demarrageTermine: this.demarrageTermine,
        cache: this.cache
      });
    } catch (e) {
    }
  },
  exposerBientot() {
    if (this.expositionPlanifiee) return;
    this.expositionPlanifiee = true;
    queueMicrotask(() => {
      this.expositionPlanifiee = false;
      this.exposer();
    });
  },
  jalon(nom) {
    if (this.vus.has(nom)) return;
    this.vus.add(nom);
    try {
      this.temps[nom] = Math.round(performance.now());
      performance.mark("autour:" + nom);
    } catch (e) {
    }
    this.exposer();
  },
  requete(source) {
    const nom = String(source || "autre");
    this.reseau.total += 1;
    this.reseau.parSource[nom] = (this.reseau.parSource[nom] || 0) + 1;
    if (!this.demarrageTermine) this.reseau.demarrage += 1;
    this.exposer();
    const depart = typeof performance !== "undefined" ? performance.now() : Date.now();
    return () => this.fini(nom, depart);
  },
  /* Une source qui dépasse la seconde est nommée. C'est la seule façon de
     répondre à « qu'est-ce qui est lent ? » par autre chose qu'une hypothèse. */
  SEUIL_LENT_MS: 1e3,
  fini(source, depart) {
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - depart);
    const c = this.cache;
    c.durees[source] = Math.max(c.durees[source] || 0, ms);
    if (ms >= this.SEUIL_LENT_MS && c.lentes.indexOf(source) < 0) c.lentes.push(source);
    this.exposer();
    return ms;
  },
  travail(nom, depart) {
    const ms = Math.round((performance.now ? performance.now() : Date.now()) - depart);
    const ligne = this.cpu[nom] || (this.cpu[nom] = { nombre: 0, totalMs: 0, pireMs: 0 });
    ligne.nombre += 1;
    ligne.totalMs += ms;
    ligne.pireMs = Math.max(ligne.pireMs, ms);
    this.exposerBientot();
    return ms;
  },
  /* Le cache : combien de fois on a évité le réseau. Un « hit » n'est pas une
     statistique de confort — c'est la différence entre un écran utile en
     trois cents millisecondes et un écran vide pendant deux secondes. */
  cache: {
    hits: 0,
    miss: 0,
    parSource: /* @__PURE__ */ Object.create(null),
    durees: /* @__PURE__ */ Object.create(null),
    lentes: []
  },
  touche(source, trouve) {
    const nom = String(source || "autre");
    this.cache[trouve ? "hits" : "miss"] += 1;
    const p = this.cache.parSource[nom] || (this.cache.parSource[nom] = { hits: 0, miss: 0 });
    p[trouve ? "hits" : "miss"] += 1;
    this.exposer();
  },
  finDemarrage() {
    this.demarrageTermine = true;
    this.exposer();
  },
  /* Une étape a une durée, pas seulement un instant. `mesure` la nomme pour
     qu'elle apparaisse telle quelle dans l'onglet Performance du navigateur —
     c'est ce qui permet de dire « la géolocalisation a coûté 900 ms » au lieu
     de le déduire de deux nombres. */
  mesure(nom, depuis, jusqua) {
    try {
      performance.measure(nom, "autour:" + depuis, "autour:" + jusqua);
    } catch (e) {
    }
  },
  rapport() {
    const lignes = {};
    performance.getEntriesByType("paint").forEach((e) => {
      lignes[e.name] = Math.round(e.startTime);
    });
    if (this.lcp) lignes["largest-contentful-paint"] = Math.round(this.lcp);
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav) {
      lignes["dom-interactive"] = Math.round(nav.domInteractive);
      lignes["dom-content-loaded"] = Math.round(nav.domContentLoadedEventEnd);
    }
    performance.getEntriesByType("mark").filter((m) => m.name.startsWith("autour:")).forEach((m) => {
      lignes[m.name.slice(7)] = Math.round(m.startTime);
    });
    return Object.fromEntries(Object.entries(lignes).sort((a, b) => a[1] - b[1]));
  },
  /* Les objectifs sont écrits ici pour que la mesure dise elle-même si elle
     les tient — sinon chacun garde en tête un chiffre différent. */
  OBJECTIFS: {
    "first-contentful-paint": 1e3,
    "largest-contentful-paint": 2500,
    ui_ready: 300,
    premier_lieu: 1500
  },
  verdict() {
    const r = this.rapport(), out = {};
    Object.entries(this.OBJECTIFS).forEach(([k, cible]) => {
      if (r[k] != null) out[k] = r[k] + " ms / " + cible + " ms " + (r[k] <= cible ? "\u2713" : "\u2717");
    });
    return out;
  },
  /* La chaîne du démarrage, dans l'ordre où elle se déroule, chaque maillon
     avec son instant et ce qu'il a coûté. C'est ce tableau qui répond à la
     seule question qui compte : QUI retient la première suggestion.
     Un maillon absent n'a pas eu lieu — une source en panne, un cache vide —
     et c'est une information, pas un trou. */
  CHAINE: [
    ["boot UI", "ui_ready"],
    ["position", ["position_serveur", "position_memoire", "geolocation_ready", "position_inconnue"]],
    ["cache local", "cache_lu"],
    ["1re source locale", "source_locale"],
    ["Overpass", "overpass_done"],
    ["Nominatim", "nominatim_done"],
    ["Supabase", "supabase_pret"],
    ["classement", "scoring_fait"],
    ["1re suggestion", "premier_lieu"]
  ],
  chaine() {
    const r = this.rapport();
    const lire = (cle) => {
      if (Array.isArray(cle)) {
        const trouves = cle.map((c) => r[c]).filter((v) => v != null);
        return trouves.length ? Math.min(...trouves) : null;
      }
      return r[cle] != null ? r[cle] : null;
    };
    const lignes = [];
    let precedent = 0;
    this.CHAINE.forEach(([nom, cle]) => {
      const t = lire(cle);
      if (t == null) {
        lignes.push({ etape: nom, a: "\u2014", duree: "\u2014" });
        return;
      }
      lignes.push({ etape: nom, a: t + " ms", duree: Math.max(0, t - precedent) + " ms" });
      precedent = Math.max(precedent, t);
    });
    return lignes;
  }
};
try {
  new PerformanceObserver((liste) => {
    liste.getEntries().forEach((e) => {
      PERF.lcp = e.startTime;
    });
  }).observe({ type: "largest-contentful-paint", buffered: true });
} catch (e) {
}
window.AutourPerf = PERF;
window.addEventListener("error", () => {
  PERF.erreurs += 1;
  PERF.exposer();
});
window.addEventListener("unhandledrejection", () => {
  PERF.erreurs += 1;
  PERF.exposer();
});
const aRefaire = { carte: false, accueil: false, filtres: false, feuille: false };
let renduPlanifie = 0;
let renduEnLot = false;
function planifierRendu(quoi) {
  Object.assign(aRefaire, quoi || {});
  if (renduPlanifie) return;
  const executer = () => {
    renduPlanifie = 0;
    const q = Object.assign({}, aRefaire);
    aRefaire.carte = aRefaire.accueil = aRefaire.filtres = aRefaire.feuille = false;
    renduEnLot = true;
    try {
      if (q.accueil) majAccueil();
      if (q.filtres) dessinerFiltres();
      if (q.carte) rendre();
      if (q.feuille || q.accueil || q.carte) majFeuille2();
    } finally {
      renduEnLot = false;
    }
    PERF.jalon("rendu_final");
  };
  renduPlanifie = typeof requestAnimationFrame === "function" ? requestAnimationFrame(executer) : setTimeout(executer, 16);
}
function apresPeinture(f) {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(f, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => f()));
}
const quandLibre = (f) => window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 400);
function useResponsiveLayout(onChange) {
  const medias = {
    mobile: window.matchMedia("(max-width: 767px)"),
    tablet: window.matchMedia("(min-width: 768px) and (max-width: 1099px)"),
    touch: window.matchMedia("(pointer: coarse)")
  };
  const read = () => ({
    isMobile: medias.mobile.matches,
    isTablet: medias.tablet.matches,
    isDesktop: !medias.mobile.matches && !medias.tablet.matches,
    isTouch: medias.touch.matches
  });
  let value = read();
  const listeners = /* @__PURE__ */ new Set();
  if (onChange) listeners.add(onChange);
  const notify = () => {
    value = read();
    listeners.forEach((listener) => listener(value));
  };
  Object.values(medias).forEach((media) => {
    if (media.addEventListener) media.addEventListener("change", notify);
    else media.addListener(notify);
  });
  if (onChange) onChange(value);
  return {
    get value() {
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => listeners.delete(listener);
    },
    destroy() {
      Object.values(medias).forEach((media) => {
        if (media.removeEventListener) media.removeEventListener("change", notify);
        else media.removeListener(notify);
      });
      listeners.clear();
    }
  };
}
let responsiveLayoutState = { isMobile: false, isTablet: false, isDesktop: true, isTouch: false };
let map;
const responsiveLayout = useResponsiveLayout((layout) => {
  responsiveLayoutState = layout;
  document.body.dataset.layout = layout.isMobile ? "mobile" : layout.isTablet ? "tablet" : "desktop";
  document.body.classList.toggle("touch", layout.isTouch);
  requestAnimationFrame(() => {
    synchroniserHauteurFeuille();
    if (map) map.invalidateSize({ pan: false });
  });
});
let hauteurFeuillePubliee = null;
let syncHauteurPlanifiee = false;
function mesurerHauteurFeuille() {
  syncHauteurPlanifiee = false;
  const feuille = document.getElementById("feuilleBesoins");
  const visible = feuille && !feuille.hidden && !responsiveLayoutState.isDesktop;
  const hauteur = visible ? Math.round(feuille.getBoundingClientRect().height) : 0;
  if (hauteur === hauteurFeuillePubliee) return;
  hauteurFeuillePubliee = hauteur;
  document.documentElement.style.setProperty("--sheet-visible-height", hauteur + "px");
}
function synchroniserHauteurFeuille() {
  if (syncHauteurPlanifiee) return;
  syncHauteurPlanifiee = true;
  requestAnimationFrame(mesurerHauteurFeuille);
}
const NOMS_COUCHES = Object.freeze({
  mainSheet: "mainSheet",
  placeDetails: "placeDetails",
  publishModal: "publishModal",
  confirmationDialog: "confirmationDialog",
  searchOverlay: "searchOverlay"
});
function rechercheDockeeDesktopDemandee() {
  return responsiveLayoutState.isDesktop && !modeNav && !modePose && feuilleNiveau !== null && feuilleNiveau !== "racine" && feuilleNiveau !== "plus" && feuilleNiveau !== "aide" && !!BESOIN_DE(feuilleNiveau);
}
const layerManager = {
  stack: [],
  activate(name) {
    const confirmation = name === NOMS_COUCHES.confirmationDialog;
    const rechercheDockee = name === NOMS_COUCHES.searchOverlay && rechercheDockeeDesktopDemandee();
    if (!confirmation) this.stack = this.stack.filter((x) => x === NOMS_COUCHES.confirmationDialog || rechercheDockee && x === NOMS_COUCHES.mainSheet);
    if (!this.stack.includes(name)) this.stack.push(name);
    const sheet = document.getElementById("feuilleBesoins");
    if (name !== NOMS_COUCHES.mainSheet && !rechercheDockee && sheet && !sheet.hidden) {
      sheet.dataset.suspended = "true";
      sheet.hidden = true;
    }
    if (name !== NOMS_COUCHES.searchOverlay) {
      const suggestions = document.getElementById("suggestions");
      if (suggestions) suggestions.hidden = true;
    }
    this.sync();
  },
  deactivate(name) {
    this.stack = this.stack.filter((x) => x !== name);
    const sheet = document.getElementById("feuilleBesoins");
    const autrePrincipale = this.stack.some((x) => x !== NOMS_COUCHES.confirmationDialog);
    if (!autrePrincipale && sheet && sheet.dataset.suspended === "true" && feuilleNiveau !== null && !modePose && !modeNav) {
      delete sheet.dataset.suspended;
      sheet.hidden = false;
      this.stack.push(NOMS_COUCHES.mainSheet);
    }
    this.sync();
  },
  top() {
    return this.stack[this.stack.length - 1] || null;
  },
  sync() {
    document.body.classList.toggle("ui-modal-open", this.stack.some((x) => [NOMS_COUCHES.placeDetails, NOMS_COUCHES.publishModal, NOMS_COUCHES.confirmationDialog].includes(x)));
    document.body.classList.toggle("sheet-open", this.stack.includes(NOMS_COUCHES.mainSheet));
    requestAnimationFrame(synchroniserHauteurFeuille);
  }
};
if (window.ResizeObserver) {
  new ResizeObserver(() => synchroniserHauteurFeuille()).observe(document.getElementById("feuilleBesoins"));
}
function normaliserItem(item, source) {
  return toCommonItem(item, { source });
}
function correspondCategorie(item, categorie) {
  return matchesCategory(item, categorie);
}
function correspondUneCategorie(item, categories) {
  return [...categories].some((categorie) => correspondCategorie(item, categorie));
}
function estTemporaire(item) {
  return !!(item && item.isTemporary);
}
const COULEURS_CAT = {
  resto: "#F5741F",
  fastfood: "#F5741F",
  cafe: "#B4713C",
  marche: "#E0952A",
  food: "#F5741F",
  bar: "#D2337A",
  event: "#E23A8C",
  concert: "#E23A8C",
  spectacle: "#E23A8C",
  studio: "#E23A8C",
  cinema: "#7C3AED",
  musee: "#0FA3A3",
  biblio: "#0FA3A3",
  popup: "#B14FE0",
  parc: "#2E9E4F",
  terrain: "#2E9E4F",
  sport: "#2E9E4F",
  velo: "#2E9E4F",
  alimentaire: "#B82A3A",
  hebergement: "#B82A3A",
  sante: "#B82A3A",
  asso: "#B82A3A",
  emploi: "#B82A3A",
  collecte: "#B82A3A",
  securite: "#B82A3A",
  metro: "#2673E8",
  bus: "#2673E8",
  tram: "#2673E8",
  train: "#2673E8",
  mairie: "#5D6B63",
  ecole: "#5D6B63",
  toilettes: "#5D6B63",
  recharge: "#5D6B63",
  friperie: "#B14FE0",
  commerce: "#B14FE0",
  rencontre: "#E0952A",
  autre: "#5D6B63"
};
const CATS = {
  /* ---- couche événements : ce qui se passe, publié par les gens ---- */
  event: { label: "\xC9v\xE9nement", emoji: "\u{1F50A}", eph: true },
  popup: { label: "Pop-up", emoji: "\u{1F9E2}", eph: true },
  rencontre: { label: "Rencontre", emoji: "\u{1F44B}", eph: true },
  sport: { label: "Sport", emoji: "\u26BD", eph: true },
  collecte: { label: "Distribution & aide", emoji: "\u{1F4E6}", eph: true },
  studio: { label: "Studio", emoji: "\u{1F3A7}", eph: true },
  food: { label: "Street food", emoji: "\u{1F35C}", eph: true },
  autre: { label: "Autre", emoji: "\u2728", eph: true },
  /* ---- couche permanente : la ville telle qu'elle existe ---- */
  resto: { label: "Restaurants", emoji: "\u{1F354}", eph: false },
  fastfood: { label: "Fast-food", emoji: "\u{1F355}", eph: false },
  cafe: { label: "Caf\xE9s", emoji: "\u2615", eph: false },
  bar: { label: "Bars", emoji: "\u{1F37A}", eph: false },
  cinema: { label: "Cin\xE9ma", emoji: "\u{1F3AC}", eph: false },
  spectacle: { label: "Spectacles", emoji: "\u{1F3AD}", eph: false },
  concert: { label: "Concerts", emoji: "\u{1F3B5}", eph: false },
  marche: { label: "March\xE9s", emoji: "\u{1F9FA}", eph: false },
  friperie: { label: "Friperies", emoji: "\u{1F455}", eph: false },
  commerce: { label: "Commerces", emoji: "\u{1F6CD}\uFE0F", eph: false },
  alimentaire: { label: "Aide alimentaire", emoji: "\u{1F96B}", eph: false },
  asso: { label: "Associations", emoji: "\u{1F91D}", eph: false },
  hebergement: { label: "H\xE9bergement", emoji: "\u{1F3E0}", eph: false },
  sante: { label: "Sant\xE9", emoji: "\u{1FA7A}", eph: false },
  emploi: { label: "Emploi & droits", emoji: "\u{1F4BC}", eph: false },
  /* LA CATÉGORIE QUI N'EXISTAIT PAS, ET C'EST POURQUOI « SÉCURITÉ » NE RENDAIT
     RIEN. Un commissariat n'avait aucune case où atterrir : même posé à la
     main dans les données, il n'aurait pu être reconnu que par son nom. */
  securite: { label: "S\xE9curit\xE9 & protection", emoji: "\u{1F6E1}\uFE0F", eph: false },
  biblio: { label: "Biblioth\xE8ques", emoji: "\u{1F4DA}", eph: false },
  coworking: { label: "Espaces de travail", emoji: "\u{1F4BB}", eph: false },
  musee: { label: "Mus\xE9es", emoji: "\u{1F5BC}\uFE0F", eph: false },
  parc: { label: "Parcs", emoji: "\u{1F333}", eph: false },
  terrain: { label: "Terrains", emoji: "\u{1F3C0}", eph: false },
  ecole: { label: "\xC9coles", emoji: "\u{1F393}", eph: false },
  mairie: { label: "Services", emoji: "\u{1F3DB}\uFE0F", eph: false },
  velo: { label: "Stations v\xE9lo", emoji: "\u{1F6B2}", eph: false },
  metro: { label: "M\xE9tro", emoji: "\u{1F687}", eph: false },
  // « Bus & tram » mélangeait deux réseaux distincts : chercher un tram
  // renvoyait des arrêts de bus, et l'inverse
  bus: { label: "Bus", emoji: "\u{1F68C}", eph: false },
  tram: { label: "Tram", emoji: "\u{1F68B}", eph: false },
  train: { label: "Gares", emoji: "\u{1F686}", eph: false },
  recharge: { label: "Recharge", emoji: "\u{1F50C}", eph: false },
  toilettes: { label: "Toilettes", emoji: "\u{1F6BB}", eph: false }
};
const SOUS_TYPES = [
  ["pharmacie", "\u{1F48A}", (t, type) => t.amenity === "pharmacy" || t.healthcare === "pharmacy" || type === "pharmacy"]
];
const DESCRIPTEURS_SOUS_TYPE = /* @__PURE__ */ new Map();
function categorieAffichee(l, defaut) {
  const base = l && CATS[l.cat] || defaut || CATS.event;
  if (!l) return base;
  const tags = l.tags || {};
  const trouve = SOUS_TYPES.find(([, , teste]) => teste(tags, l.type || ""));
  if (!trouve) return base;
  const cle = l.cat + "|" + trouve[0];
  let descripteur = DESCRIPTEURS_SOUS_TYPE.get(cle);
  if (!descripteur) {
    descripteur = Object.assign({}, base, { emoji: trouve[1] });
    DESCRIPTEURS_SOUS_TYPE.set(cle, descripteur);
  }
  return descripteur;
}
const SERVICES = [
  [/mission\s*locale/i, "Mission locale \xB7 16-25 ans"],
  [/france\s*travail|p[oô]le\s*emploi/i, "France Travail \xB7 demandeurs d\u2019emploi"],
  [/cap\s*emploi/i, "Cap emploi \xB7 handicap"],
  [/maison\s*de\s*l['’ ]?emploi/i, "Maison de l\u2019emploi"],
  [/ccas|centre\s*communal/i, "CCAS \xB7 aide sociale communale"],
  [/restos?\s*du\s*c(oe|œ|o)ur/i, "Restos du C\u0153ur"],
  [/secours\s*populaire/i, "Secours populaire"],
  [/secours\s*catholique/i, "Secours catholique"],
  [/croix[- ]rouge/i, "Croix-Rouge"],
  [/banque\s*alimentaire/i, "Banque alimentaire"],
  [/emma(ü|u)s/i, "Emma\xFCs"]
];
const CHAINES_FASTFOOD = /mc\s?do|burger\s?king|\bkfc\b|\bquick\b|subway|domino|pizza\s?hut|o'?tacos|five\s?guys|tacos|kebab|snack|friterie|frit|chicken|tender|nachos|sushi\s?shop|pok[eé]\b/i;
const CHAINES_CAFE = /starbucks|paul\b|brioche\s?dor|columbus|costa\s?coffee|boulangerie|patisserie|maison\s?kayser|pain\s?quotidien/i;
const NOM_HEBERGEMENT = /foyer|chrs|\bcada\b|\bhuda\b|\bchu\b|residence sociale|maison relais|pension de famille|abri de nuit|halte de nuit|hebergement|dortoir|sans[- ]abri|\bsdf\b/;
const NOM_ALIMENTAIRE = /epicerie solidaire|banque alimentaire|restos? du c(o|oe)ur|soupe populaire|distribution alimentaire|aide alimentaire|colis alimentaire/;
function affinerCategorie(cat, nom, tags) {
  if (cat === "asso" && tags && tags.amenity === "social_facility" && !tags.social_facility) {
    const n = sansAccents(nom || "");
    if (NOM_ALIMENTAIRE.test(n)) return "alimentaire";
    if (NOM_HEBERGEMENT.test(n)) return "hebergement";
  }
  if (!nom) return cat;
  if (CATS_TRANSPORT.has(cat)) return cat;
  const poids = classifyPlaceWeighted({ cat, title: nom, tags });
  if ((poids.cinema || 0) > 0 && (poids.cinema || 0) > (poids[cat] || 0)) return "cinema";
  if (cat === "resto" || cat === "fastfood" || cat === "cafe") {
    if (CHAINES_CAFE.test(nom)) return "cafe";
    if (CHAINES_FASTFOOD.test(nom)) return "fastfood";
  }
  return cat;
}
function preciserService(nom) {
  for (const [re, lab] of SERVICES) if (re.test(nom || "")) return lab;
  return "";
}
const NOMS_SOLIDAIRES = /emma(ü|u)s|vestiaire|solidair|secours|croix[- ]rouge|caritas|abb[ée]\s*pierre|sdf|sans[- ]abri|social|entraide|resto|banque\s*alimentaire|ccas|samu\s*social|accueil\s*de\s*jour/i;
function estSolidaire(nom, tagCharite) {
  return !!tagCharite || NOMS_SOLIDAIRES.test(nom || "") || !!preciserService(nom);
}
const SANS_CLASSEMENT = /* @__PURE__ */ new Set(["alimentaire", "asso", "hebergement", "emploi", "sante", "mairie"]);
const JAMAIS_AUTO = /* @__PURE__ */ new Set(["ecole", "mairie"]);
const CATS_TRANSPORT = /* @__PURE__ */ new Set(["metro", "bus", "tram", "train", "velo"]);
function modeTransportOsm(t) {
  if (!t) return null;
  if (t.station === "subway" || t.subway === "yes" || t.railway === "subway" || t.railway === "subway_entrance") return "metro";
  if (t.station === "light_rail" || t.railway === "tram_stop" || t.railway === "tram" || t.tram === "yes" || t.light_rail === "yes") return "tram";
  if (t.railway === "station" || t.railway === "halt" || t.station === "train" || t.train === "yes") return "train";
  if (t.highway === "bus_stop" || t.amenity === "bus_station" || t.station === "bus" || t.bus === "yes" || t.trolleybus === "yes") return "bus";
  if (t.amenity === "bicycle_rental" || t.amenity === "bicycle_parking") return "velo";
  return null;
}
const NOM_TRANSPORT = [
  [/\bm[ée]tros?\b/, "metro"],
  [/\btram(way)?s?\b/, "tram"],
  [/\b(gares?|haltes?)\b/, "train"],
  [/\b(arr[êe]ts? de bus|gare routi[èe]re)\b/, "bus"],
  [/\b(v[' ]?lille|v[ée]los?|cycles?)\b/, "velo"]
];
function modeTransportNom(nom) {
  const n = sansAccents(nom || "");
  for (const [re, mode] of NOM_TRANSPORT) if (re.test(n)) return mode;
  return null;
}
function categorieTransport(catRegle, nom, tags) {
  if (!CATS_TRANSPORT.has(catRegle)) return catRegle;
  return modeTransportOsm(tags) || modeTransportNom(nom) || catRegle;
}
let coucheTransport = false;
function transportsDemandes(ctx) {
  if (coucheTransport) return true;
  if (catsActives && [...catsActives].some((c) => CATS_TRANSPORT.has(c))) return true;
  if (CATS_TRANSPORT.has(filtreActif)) return true;
  const q = ctx && ctx.q;
  return !!(q && CATS_TRANSPORT.has(categorieRecherchee(q)));
}
const CATS_MANGER = ["resto", "fastfood", "cafe", "marche", "food"];
const SYNONYMES = {
  resto: ["restaurant", "resto", "manger", "brasserie", "diner", "dejeuner"],
  fastfood: ["fast food", "fastfood", "kebab", "burger", "tacos", "pizza", "snack", "friterie"],
  cafe: ["cafe", "coffee", "boulangerie", "salon de the", "brunch"],
  bar: ["bar", "pub", "biere", "apero", "boire", "verre", "cocktail"],
  cinema: ["cinema", "film", "seance"],
  spectacle: ["theatre", "spectacle", "scene", "comedie"],
  concert: ["concert", "musique", "boite", "club", "live"],
  marche: ["marche", "brocante", "halles"],
  friperie: ["friperie", "fripe", "vetement", "seconde main", "occasion", "vintage", "depot vente"],
  commerce: ["commerce", "boutique", "magasin", "courses", "supermarche", "epicerie", "coiffeur"],
  alimentaire: ["aide alimentaire", "banque alimentaire", "epicerie solidaire", "soupe populaire", "restos du coeur"],
  asso: ["asso", "association", "ong", "benevolat", "solidarite", "centre social", "maison de quartier"],
  hebergement: ["hebergement", "dormir", "abri", "foyer", "urgence", "115", "logement"],
  sante: [
    "sante",
    "hopital",
    "pharmacie",
    "medecin",
    "docteur",
    "dentiste",
    "clinique",
    "urgences",
    "psy",
    "psychologue",
    "psychiatre",
    "psychotherapeute",
    "cmp",
    "sante mentale"
  ],
  emploi: ["emploi", "mission locale", "mission emploi", "melt", "france travail", "pole emploi", "travail", "insertion", "cv"],
  biblio: ["bibliotheque", "mediatheque", "livre", "lecture", "etudier", "salle d etude", "reviser"],
  coworking: ["coworking", "espace de travail", "bureau partage", "tiers lieu", "travailler"],
  musee: ["musee", "galerie", "expo", "exposition"],
  parc: ["parc", "jardin", "square", "vert", "promenade"],
  terrain: ["terrain", "sport", "foot", "basket", "piscine", "skate", "gym", "muscu"],
  ecole: ["ecole", "college", "lycee", "universite", "fac", "campus"],
  mairie: ["mairie", "poste", "administration", "service public", "papiers"],
  velo: ["velo", "bike", "station velo", "libre service"],
  metro: ["metro", "station"],
  tram: ["tram", "tramway"],
  train: ["train", "gare", "ter", "sncf"],
  bus: ["bus", "tram", "arret", "transport"],
  recharge: ["recharge", "borne", "electrique"],
  toilettes: ["toilette", "wc", "sanitaire"],
  food: ["street food", "food truck", "cantine"],
  event: ["evenement", "event", "soiree", "anime"],
  popup: ["popup", "pop up", "vide grenier"],
  collecte: ["collecte", "don", "donner", "recolte", "distribution", "maraude"],
  rencontre: ["rencontre", "apero", "cafe rencontre", "discussion", "entraide voisins"]
};
const CUISINES = {
  turc: "turkish",
  turque: "turkish",
  kebab: "kebab",
  africain: "african",
  africaine: "african",
  afrique: "african",
  senegalais: "senegalese",
  ivoirien: "ivorian",
  ethiopien: "ethiopian",
  camerounais: "cameroonian",
  congolais: "congolese",
  malien: "malian",
  marocain: "moroccan",
  tunisien: "tunisian",
  algerien: "algerian",
  maghrebin: "moroccan",
  couscous: "moroccan",
  tajine: "moroccan",
  libanais: "lebanese",
  syrien: "syrian",
  oriental: "lebanese",
  italien: "italian",
  pizza: "pizza",
  pates: "italian",
  asiatique: "asian",
  asie: "asian",
  wok: "asian",
  japonais: "japanese",
  sushi: "sushi",
  ramen: "ramen",
  chinois: "chinese",
  vietnamien: "vietnamese",
  thai: "thai",
  thailandais: "thai",
  coreen: "korean",
  indien: "indian",
  pakistanais: "pakistani",
  grec: "greek",
  portugais: "portuguese",
  espagnol: "spanish",
  tapas: "tapas",
  mexicain: "mexican",
  bresilien: "brazilian",
  peruvien: "peruvian",
  antillais: "caribbean",
  creole: "caribbean",
  americain: "american",
  burger: "burger",
  francais: "french",
  brasserie: "french",
  vegetarien: "vegetarian",
  vegan: "vegan",
  halal: "halal",
  casher: "kosher",
  poisson: "seafood",
  "fruits de mer": "seafood"
};
const MOTS_NOMBRES = (() => {
  const u = ["", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"];
  const p = {
    0: "zero",
    1: "un",
    2: "deux",
    3: "trois",
    4: "quatre",
    5: "cinq",
    6: "six",
    7: "sept",
    8: "huit",
    9: "neuf",
    10: "dix",
    11: "onze",
    12: "douze",
    13: "treize",
    14: "quatorze",
    15: "quinze",
    16: "seize"
  };
  const m = /* @__PURE__ */ new Map();
  for (const [n, mot] of Object.entries(p)) m.set(mot, Number(n));
  m.set("une", 1);
  for (let i = 7; i <= 9; i++) m.set("dix " + u[i], 10 + i);
  const diz = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };
  for (const [d, mot] of Object.entries(diz)) {
    m.set(mot, Number(d));
    m.set(mot + " et un", Number(d) + 1);
    for (let i = 2; i <= 9; i++) m.set(mot + " " + u[i], Number(d) + i);
  }
  m.set("soixante dix", 70);
  m.set("soixante et onze", 71);
  for (let i = 2; i <= 9; i++) m.set("soixante " + (p[10 + i] || "dix " + u[i]), 70 + i);
  m.set("quatre vingt", 80);
  m.set("quatre vingts", 80);
  for (let i = 1; i <= 9; i++) m.set("quatre vingt " + u[i], 80 + i);
  m.set("quatre vingt dix", 90);
  for (let i = 1; i <= 9; i++) m.set("quatre vingt " + (p[10 + i] || "dix " + u[i]), 90 + i);
  m.set("cent", 100);
  return m;
})();
const INDEX_MOTS = (() => {
  const m = /* @__PURE__ */ new Map();
  for (const [id, mots] of Object.entries(CUISINES))
    m.set(sansAccents(id), { cuisine: mots });
  for (const [mot, val] of Object.entries(CUISINES))
    m.set(sansAccents(mot), { cuisine: val });
  for (const [id, c] of Object.entries(CATS))
    m.set(sansAccents(c.label), { cat: id });
  for (const [id, mots] of Object.entries(SYNONYMES))
    mots.forEach((x) => {
      if (!m.has(sansAccents(x))) m.set(sansAccents(x), { cat: id });
    });
  return m;
})();
function montantEuros(t) {
  const chiffres = /(\d{1,3})\s*(?:e\b|eu\b|euros?|€)/.exec(t);
  if (chiffres) return Number(chiffres[1]);
  const avant = /([a-z ]{3,28})\s*(?:euros?|balles?|€)/.exec(t);
  if (!avant) return null;
  const mots = avant[1].trim().split(/\s+/);
  for (let d = Math.max(0, mots.length - 4); d < mots.length; d++) {
    const cle = mots.slice(d).join(" ");
    if (MOTS_NOMBRES.has(cle)) return MOTS_NOMBRES.get(cle);
  }
  return null;
}
function cuisineRecherchee(q) {
  const t = sansAccents(q).trim();
  if (t.length < 3) return null;
  const direct = INDEX_MOTS.get(t);
  if (direct && direct.cuisine) return direct.cuisine;
  for (const [mot, val] of Object.entries(CUISINES)) {
    const m = sansAccents(mot);
    if (t.includes(m)) return val;
  }
  return null;
}
function categorieRecherchee(q) {
  const t = sansAccents(q).trim();
  if (t.length < 3) return null;
  const direct = INDEX_MOTS.get(t);
  if (direct && direct.cat) return direct.cat;
  for (const [id, c] of Object.entries(CATS)) {
    if (sansAccents(c.label).includes(t)) return id;
  }
  for (const [id, mots] of Object.entries(SYNONYMES)) {
    if (mots.some((m) => {
      const s = sansAccents(m);
      return s.includes(t) || t.includes(s);
    })) return id;
  }
  return null;
}
const BESOINS = [
  { id: "manger", emoji: "\u{1F374}", label: "Manger", sous: [
    { label: "Restaurants", cats: ["resto"] },
    { label: "Fast-food", cats: ["fastfood"] },
    { label: "Caf\xE9s", cats: ["cafe"] },
    { label: "March\xE9s et street food", cats: ["marche", "food"] }
  ] },
  { id: "sortir", emoji: "\u{1F389}", label: "Sortir", sous: [
    { label: "\xC9v\xE9nements", cats: ["event", "studio"] },
    { label: "Concerts et spectacles", cats: ["concert", "spectacle"] },
    { label: "Bars", cats: ["bar"] },
    { label: "Cin\xE9ma", cats: ["cinema"] },
    { label: "En famille", cats: ["family"] },
    { label: "Sport", cats: ["sport", "terrain"] },
    { label: "Boutiques et fripes", cats: ["friperie", "commerce", "popup"] }
  ] },
  { id: "chiller", emoji: "\u2615", label: "Chiller", sous: [
    { label: "Caf\xE9s", cats: ["cafe"] },
    { label: "Parcs et terrasses", cats: ["parc", "park"] },
    { label: "Biblioth\xE8ques", cats: ["biblio", "library"] },
    { label: "Bars tranquilles", cats: ["bar"] }
  ] },
  { id: "bouger", emoji: "\u26BD", label: "Bouger", sous: [
    { label: "Terrains et \xE9quipements", cats: ["terrain", "sport"] },
    { label: "Piscines", cats: ["swimming_pool"] },
    { label: "Plein air", cats: ["parc", "park"] },
    { label: "V\xE9lo", cats: ["velo"] }
  ] },
  { id: "famille", emoji: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", label: "Famille", secondaire: true, sous: [
    { label: "Cin\xE9ma", cats: ["cinema"] },
    { label: "Parcs et aires de jeux", cats: ["parc", "park", "playground"] },
    { label: "Biblioth\xE8ques et mus\xE9es", cats: ["biblio", "musee", "library", "museum"] },
    { label: "Piscines et loisirs", cats: ["swimming_pool", "bowling_alley", "zoo", "educational_farm"] },
    { label: "Activit\xE9s jeunesse", cats: ["kids_event", "family_event", "workshop", "youth_activity"] }
  ] },
  // l'aide n'est pas une liste de cases : c'est un mode entier, avec ses
  // propres priorités et ses besoins écrits en français, pas en tags
  { id: "aide", emoji: "\u2764\uFE0F", label: "Trouver de l\u2019aide", aide: true },
  // ---- Derrière « Plus » : les besoins réels mais moins fréquents. Ils ne
  // méritent pas une place permanente à l'écran, ils méritent d'exister.
  { id: "etudier", emoji: "\u{1F4DA}", label: "\xC9tudier", secondaire: true, sous: [
    { label: "Biblioth\xE8ques", cats: ["biblio", "library"] },
    { label: "Espaces de travail", cats: ["coworking"] },
    { label: "Caf\xE9s o\xF9 s\u2019installer", cats: ["cafe"] }
  ] },
  { id: "culture", emoji: "\u{1F3AD}", label: "Culture", secondaire: true, sous: [
    { label: "Mus\xE9es", cats: ["musee", "museum"] },
    { label: "Cin\xE9ma", cats: ["cinema"] },
    { label: "Concerts et spectacles", cats: ["concert", "spectacle"] },
    { label: "Expositions et ateliers", cats: ["studio", "workshop"] }
  ] },
  { id: "services", emoji: "\u{1F3D9}\uFE0F", label: "Services autour de moi", secondaire: true, sous: [
    { label: "Transports", cats: ["metro", "bus", "velo"] },
    { label: "Biblioth\xE8ques et mus\xE9es", cats: ["biblio", "coworking", "musee"] },
    { label: "Parcs et \xE9quipements", cats: ["parc"] },
    { label: "Services publics", cats: ["mairie"] },
    { label: "\xC9coles", cats: ["ecole"] },
    { label: "Toilettes et recharge", cats: ["toilettes", "recharge"] }
  ] }
];
const ETIQUETTES_CAT = {
  eat: "MANGER",
  restaurant: "MANGER",
  cafe: "MANGER",
  market: "MANGER",
  outing: "SORTIR",
  bar: "SORTIR",
  concert: "SORTIR",
  show: "SORTIR",
  event: "SORTIR",
  family: "FAMILLE",
  kids_event: "FAMILLE",
  playground: "FAMILLE",
  family_event: "FAMILLE",
  culture: "CULTURE",
  museum: "CULTURE",
  cinema: "CULTURE",
  sport: "SPORT",
  park: "PLEIN AIR",
  study: "\xC9TUDIER",
  library: "\xC9TUDIER",
  help: "AIDE",
  food_aid: "AIDE",
  shelter: "AIDE",
  health: "AIDE",
  services: "SERVICES",
  transport: "TRANSPORT",
  buy: "BOUTIQUES"
};
function etiquettesLisibles(l) {
  const vues = [];
  (l && l.categories || []).forEach((c) => {
    const e = ETIQUETTES_CAT[c];
    if (e && !vues.includes(e)) vues.push(e);
  });
  return vues.slice(0, 2);
}
const BESOINS_PRINCIPAUX = BESOINS.filter((b) => !b.secondaire);
const BESOINS_SECONDAIRES = BESOINS.filter((b) => b.secondaire);
const BESOIN_DE = (id) => BESOINS.find((b) => b.id === id);
const MOTS_BESOINS = (() => {
  const m = /* @__PURE__ */ new Set();
  BESOINS.forEach((b) => {
    m.add(sansAccents(b.id));
    m.add(sansAccents(b.label));
    (b.sous || []).forEach((s) => m.add(sansAccents(s.label)));
  });
  return m;
})();
function estTermeMetier(texte) {
  const t = sansAccents(String(texte || "")).trim();
  if (!t) return false;
  return INDEX_MOTS.has(t) || MOTS_BESOINS.has(t);
}
const REQUETES = [
  // -- aide, en premier car ce sont des sous-tags d'amenity plus génériques
  ["social_facility", "food_bank", "alimentaire"],
  ["social_facility", "soup_kitchen", "alimentaire"],
  // amenity=food_bank existe aussi, sans la clé social_facility : les Restos
  // du Cœur et les banques alimentaires sont tagués des deux façons
  ["amenity", "food_bank", "alimentaire"],
  /* Un « foyer », en France, c'est presque tout sauf `social_facility=shelter`.
     Cette famille ne demandait que `shelter`, `group_home` et `refugee_site` :
     sur huit foyers lillois tagués comme ils le sont réellement dans OSM, six
     n'étaient même pas demandés. On couvre donc les valeurs qui portent le
     parc social français — CHRS, résidence sociale, maison relais, pension de
     famille, abri de nuit, foyer de jeunes travailleurs.
     `amenity=shelter` reste EXCLU à dessein : dans OSM c'est un abribus ou un
     abri de pique-nique, pas un hébergement. */
  ["social_facility", "shelter", "hebergement"],
  ["social_facility", "group_home", "hebergement"],
  ["social_facility", "homeless_shelter", "hebergement"],
  ["social_facility", "emergency_shelter", "hebergement"],
  ["social_facility", "assisted_living", "hebergement"],
  ["social_facility", "nursing_home", "hebergement"],
  ["amenity", "refugee_site", "hebergement"],
  ["amenity", "dormitory", "hebergement"],
  // accueils de jour et permanences : ce sont eux qu'on cherche en premier
  // quand on a besoin d'aide, et aucun tag ne les ramenait
  ["social_facility", "outreach", "asso"],
  ["social_facility", "day_centre", "asso"],
  ["social_facility", "clothing_bank", "asso"],
  ["amenity", "social_facility", "asso"],
  ["amenity", "social_centre", "asso"],
  ["office", "association", "asso"],
  ["office", "ngo", "asso"],
  ["office", "charity", "asso"],
  // une maison de quartier est une asso, pas une salle de spectacle : elle
  // était classée dans Sortir et n'apparaissait donc jamais dans Aide
  ["amenity", "community_centre", "asso"],
  ["community_centre", "community_centre", "asso"],
  ["club", "social", "asso"],
  ["club", "charity", "asso"],
  ["club", "sport", "asso"],
  ["club", "culture", "asso"],
  ["club", "youth", "asso"],
  ["office", "employment_agency", "emploi"],
  // government=* plutôt que office=government, trop large : il ramenait les
  // impôts et les annexes administratives dans les services d'aide à l'emploi
  ["government", "employment_agency", "emploi"],
  ["government", "social_welfare", "emploi"],
  ["government", "public_service", "mairie"],
  ["government", "register_office", "mairie"],
  // une maison des jeunes est un lieu d'aide, pas un équipement de loisir
  ["amenity", "youth_centre", "asso"],
  ["social_facility", "food_sharing", "alimentaire"],
  /* -- SÉCURITÉ ET PROTECTION -------------------------------------------
     LE TAG QUI N'ÉTAIT DEMANDÉ NULLE PART. Ni ici, ni dans l'outil de
     pré-calcul des zones. Aucun commissariat, aucune gendarmerie n'entrait
     donc jamais dans les données d'Autour — et « Sécurité » ne pouvait pas
     rendre un résultat qu'elle n'avait jamais reçu.
     `police=*` (national, municipal, gendarmerie) voyage avec l'objet et dit
     lequel des trois on a trouvé ; il n'a pas besoin d'être demandé. */
  ["amenity", "police", "securite"],
  // -- santé
  ["amenity", "hospital", "sante"],
  ["amenity", "clinic", "sante"],
  ["amenity", "doctors", "sante"],
  ["amenity", "pharmacy", "sante"],
  ["amenity", "dentist", "sante"],
  ["amenity", "health_post", "sante"],
  ["healthcare", "centre", "sante"],
  ["healthcare", "doctor", "sante"],
  ["healthcare", "clinic", "sante"],
  ["healthcare", "hospital", "sante"],
  ["healthcare", "pharmacy", "sante"],
  ["healthcare", "dentist", "sante"],
  ["healthcare", "laboratory", "sante"],
  ["healthcare", "physiotherapist", "sante"],
  ["healthcare", "psychotherapist", "sante"],
  ["healthcare", "counselling", "sante"],
  // -- boutiques : la friperie avant les vêtements neufs, sinon elle est absorbée
  ["shop", "second_hand", "friperie"],
  ["shop", "charity", "friperie"],
  ["shop", "clothes", "friperie"],
  ["shop", "books", "commerce"],
  ["shop", "convenience", "commerce"],
  ["shop", "supermarket", "commerce"],
  ["shop", "greengrocer", "commerce"],
  ["shop", "butcher", "commerce"],
  ["shop", "hairdresser", "commerce"],
  ["shop", "bakery", "cafe"],
  // -- manger
  ["amenity", "restaurant", "resto"],
  ["amenity", "fast_food", "fastfood"],
  ["amenity", "cafe", "cafe"],
  ["amenity", "marketplace", "marche"],
  // -- sortir
  ["amenity", "bar", "bar"],
  ["amenity", "pub", "bar"],
  ["amenity", "biergarten", "bar"],
  ["amenity", "cinema", "cinema"],
  ["leisure", "cinema", "cinema"],
  ["amenity", "theatre", "spectacle"],
  ["amenity", "arts_centre", "spectacle"],
  ["amenity", "nightclub", "concert"],
  ["amenity", "music_venue", "concert"],
  // -- ville
  ["amenity", "library", "biblio"],
  ["amenity", "public_bookcase", "biblio"],
  // là où on peut réellement s'installer pour travailler : c'est ce que
  // demande « Étudier », pas un lycée dont les portes sont fermées au public
  ["amenity", "coworking_space", "coworking"],
  ["office", "coworking", "coworking"],
  ["tourism", "museum", "musee"],
  ["tourism", "gallery", "musee"],
  ["leisure", "park", "parc"],
  ["leisure", "garden", "parc"],
  ["leisure", "playground", "parc"],
  ["leisure", "bowling_alley", "terrain"],
  ["leisure", "pitch", "terrain"],
  ["leisure", "skatepark", "terrain"],
  ["leisure", "sports_centre", "terrain"],
  ["leisure", "swimming_pool", "terrain"],
  ["leisure", "fitness_centre", "terrain"],
  ["tourism", "zoo", "parc"],
  ["tourism", "farm", "parc"],
  ["amenity", "school", "ecole"],
  ["amenity", "college", "ecole"],
  ["amenity", "university", "ecole"],
  ["amenity", "townhall", "mairie"],
  ["amenity", "post_office", "mairie"],
  ["amenity", "toilets", "toilettes"],
  ["amenity", "shower", "toilettes"],
  ["amenity", "public_bath", "toilettes"],
  ["amenity", "charging_station", "recharge"],
  ["amenity", "bicycle_rental", "velo"],
  ["amenity", "bicycle_parking", "velo"],
  // -- transports
  ["station", "subway", "metro"],
  ["railway", "subway_entrance", "metro"],
  // une gare ferroviaire n'est pas une station de métro, et un arrêt de tram
  // n'est pas un arrêt de bus : la nomenclature de la carte doit dire le vrai
  // mode, sinon on envoie quelqu'un chercher un arrêt qui n'existe pas
  ["railway", "station", "train"],
  ["railway", "halt", "train"],
  ["railway", "tram_stop", "tram"],
  ["highway", "bus_stop", "bus"],
  ["amenity", "bus_station", "bus"]
];
const TAGS_PARTAGES = [
  ["amenity", "social_facility", ["asso", "hebergement", "alimentaire"]]
];
const SUPABASE_URL = "https://sxnzyvcgwbwnpjnqmpkp.supabase.co";
const SUPABASE_CLE = "sb_publishable_T4_3er0DEI9vX4YdEhPDIw_m3yV_FlM";
const CLE_PSEUDO_CREATEUR = "autour:creator_name";
let sb = null, sbLecture = null, moiId = null, monPseudo = "";
try {
  monPseudo = String(localStorage.getItem(CLE_PSEUDO_CREATEUR) || "").trim().slice(0, 50);
} catch (e) {
}
const SUPABASE_SDK = Object.freeze(["/vendeur/supabase-2.108.2.js?v=20260827"]);
const SUPABASE_ATTENTE_DEMARRAGE = 4e3;
const SUPABASE_ATTENTE_DEMANDE = 12e3;
const MESSAGE_SERVICE_INJOIGNABLE = "Le service de connexion est injoignable. Un bloqueur de publicit\xE9s ou le r\xE9seau peut en \xEAtre la cause. R\xE9essaie, ou passe par un autre r\xE9seau.";
let pSupabase = null;
let pConnexion = null;
function chargerScriptSupabase(src, attente) {
  return new Promise((ok) => {
    const el = document.createElement("script");
    let fini = false;
    const terminer = (disponible) => {
      if (fini) return;
      fini = true;
      clearTimeout(gardeFou);
      ok(disponible);
    };
    el.src = src;
    el.onload = () => terminer(!!window.supabase);
    el.onerror = () => terminer(false);
    const gardeFou = setTimeout(() => terminer(!!window.supabase), attente);
    PERF.requete("supabase_sdk");
    document.head.appendChild(el);
  });
}
function chargerSupabase(options) {
  if (window.supabase) return Promise.resolve(true);
  if (pSupabase) return pSupabase;
  const o = options || {};
  const echeance = Date.now() + (o.demande ? SUPABASE_ATTENTE_DEMANDE : SUPABASE_ATTENTE_DEMARRAGE);
  pSupabase = (async () => {
    for (const src of SUPABASE_SDK) {
      const reste = echeance - Date.now();
      if (reste < 250) break;
      if (await chargerScriptSupabase(src, reste)) return true;
      journal.warn("Supabase indisponible : " + src);
    }
    return false;
  })();
  const promesse = pSupabase;
  promesse.then((disponible) => {
    if (!disponible && pSupabase === promesse) pSupabase = null;
  });
  return promesse;
}
function lireClaimsJwt(jeton) {
  try {
    const partie = String(jeton || "").split(".")[1];
    if (!partie) return null;
    const base64 = partie.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((partie.length + 3) % 4);
    return JSON.parse(atob(base64));
  } catch (e) {
    return null;
  }
}
function sessionJwtDecalee(session2) {
  if (!session2 || !session2.access_token) return false;
  const claims = lireClaimsJwt(session2.access_token);
  if (!claims) return false;
  const maintenant = Math.floor(Date.now() / 1e3);
  return Number(claims.iat) > maintenant + 60 || Number(claims.exp) <= maintenant + 30;
}
async function reparerSession(session2) {
  if (!session2 || !sessionJwtDecalee(session2)) return session2 || null;
  try {
    PERF.requete("supabase_refresh");
    const { data, error } = await sb.auth.refreshSession(session2);
    if (error || !data || !data.session) throw error || new Error("session absente");
    return data.session;
  } catch (e) {
    try {
      await sb.auth.signOut({ scope: "local" });
    } catch (e2) {
    }
    return null;
  }
}
async function connecter(options) {
  if (sb) return sb;
  if (pConnexion) return pConnexion;
  pConnexion = (async () => {
    if (!await chargerSupabase(options)) return null;
    try {
      sbLecture = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "autour-public-read-v1"
        }
      });
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE);
      PERF.requete("supabase_session");
      const { data: { session: sessionBrute }, error } = await sb.auth.getSession();
      if (error) throw error;
      appliquerSession(await reparerSession(sessionBrute));
      sb.auth.onAuthStateChange((evenement, s) => {
        const avant = etatCompte;
        appliquerSession(s);
        if (etatCompte === "connecte" && avant !== "connecte") {
          chargerProfil().then(() => {
            chargerFavoris();
            rafraichirCanaux();
            majNavBas();
            reprendreActionEnAttente();
          });
        }
        if (evenement === "SIGNED_OUT") majNavBas();
      });
      if (estConnecte()) chargerProfil();
      return sb;
    } catch (e) {
      console.error("Identit\xE9 anonyme indisponible :", e.message || e);
      sb = null;
      return null;
    }
  })();
  const resultat = await pConnexion;
  if (!resultat) pConnexion = null;
  return resultat;
}
const COMPTES = window.AutourComptes || null;
let session = null;
let monProfil = null;
let etatCompte = COMPTES ? COMPTES.VISITEUR : "visiteur";
function estConnecte() {
  return etatCompte === "connecte";
}
function appliquerSession(s) {
  session = s || null;
  moiId = session && session.user ? session.user.id : null;
  etatCompte = COMPTES ? COMPTES.etatDe(session) : moiId ? "anonyme" : "visiteur";
  return etatCompte;
}
function monEmail() {
  return session && session.user && session.user.email || "";
}
async function chargerProfil() {
  if (!sb || !moiId) {
    monProfil = null;
    return null;
  }
  try {
    const { data, error } = await sb.from("profiles").select("display_name,notifications").eq("id", moiId).maybeSingle();
    if (error) throw error;
    monProfil = data || null;
    if (monProfil && monProfil.display_name) monPseudo = monProfil.display_name;
    return monProfil;
  } catch (e) {
    console.error("Profil indisponible :", e.message || e);
    return null;
  }
}
const REPRISES = /* @__PURE__ */ new Map();
function enregistrerReprise(action, fn) {
  REPRISES.set(action, fn);
}
async function exigerCompte(action, charge2) {
  if (!COMPTES || !COMPTES.exigeCompte(action)) return true;
  await connecter();
  if (estConnecte()) return true;
  COMPTES.mettreEnAttente(action, charge2 || null);
  ouvrirEcranCompte(action);
  return false;
}
async function reprendreActionEnAttente() {
  if (!COMPTES) return;
  const attente = COMPTES.reprendreAttente();
  if (!attente) return;
  const reprise = REPRISES.get(attente.action);
  if (!reprise) return;
  try {
    await reprise(attente.charge);
  } catch (e) {
    console.error("Reprise impossible :", e);
  }
}
async function assurerIdentitePublication() {
  if (!await connecter()) return null;
  if (!estConnecte()) return null;
  return { id: moiId, name: monPseudo || monProfil && monProfil.display_name || null };
}
function estPublicationAMoi(l) {
  return !!(l && l.dbId && moiId && l.creatorId === moiId);
}
function visuelPublication(p) {
  const url = p.image_url || p.image || "";
  const source = p.verifie ? "structure" : "autour";
  const v = IMAGES && IMAGES.visuel({
    image_url: url,
    image_source: source,
    image_source_url: p.url || "",
    image_author: p.creator_name || "",
    image_license: IMAGES ? IMAGES.licenceImplicite(source) : "",
    image_updated_at: p.updated_at || p.cree_le || null,
    image_scope: "evenement"
  });
  if (!v) return { image: "", imageSource: "", image_scope: "evenement" };
  return {
    image: v.image_url,
    imageSource: v.image_source,
    image_url: v.image_url,
    image_source: v.image_source,
    image_source_url: v.image_source_url,
    image_author: v.image_author,
    image_license: v.image_license,
    image_updated_at: v.image_updated_at,
    image_scope: "evenement"
  };
}
function versLieu(p) {
  const createdBy = p.created_by || p.creator_id || null;
  return normaliserItem({
    id: "pub" + p.id,
    dbId: p.id,
    cat: p.cat,
    titre: p.titre,
    description: p.description || "",
    adresse: p.adresse || "",
    cp: p.cp || commune,
    quand: p.quand || "Bient\xF4t",
    gratuit: p.gratuit,
    prix: p.prix,
    places: p.places,
    par: p.verifie ? "Structure v\xE9rifi\xE9e" : p.creator_name || "Habitant du quartier",
    creatorId: createdBy,
    creatorName: p.creator_name || "",
    verifie: p.verifie,
    mien: !!(moiId && createdBy === moiId),
    lat: p.lat,
    lng: p.lng,
    categories: Array.isArray(p.categories) ? p.categories : [p.cat],
    debutLe: p.debut_le ? new Date(p.debut_le).getTime() : null,
    finLe: p.fin_le ? new Date(p.fin_le).getTime() : null,
    isTemporary: true,
    url: p.url || "",
    /* L'affiche d'une publication appartient à qui l'a déposée : c'est la
       provenance la plus claire qu'Autour possède, et la seule qui n'ait
       aucune contrainte d'attribution externe. */
    ...visuelPublication(p),
    /* Une annulation était enregistrée en base, écrite dans le canal, et
       perdue ici : la carte et la fiche affichaient l'événement comme s'il
       avait lieu. Quelqu'un se déplaçait pour rien. */
    status: p.status || (p.annule ? "cancelled" : "active"),
    annule: p.status === "cancelled" || !!p.annule
  }, "autour");
}
const RAYON_PUBLICATIONS_M = 5e3;
function emprisePublications(lat, lng) {
  let dLat = RAYON_PUBLICATIONS_M / 111320;
  let dLng = RAYON_PUBLICATIONS_M / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const vue = bornesVisibles();
  if (vue) {
    const c = { lat: (Number(vue.s) + Number(vue.n)) / 2, lng: (Number(vue.o) + Number(vue.e)) / 2 };
    dLat = Math.max(dLat, Number(vue.n) - c.lat);
    dLng = Math.max(dLng, Number(vue.e) - c.lng);
  }
  return { s: lat - dLat, n: lat + dLat, o: lng - dLng, e: lng + dLng };
}
const CLE_CACHE_COUCHES_SUPABASE = "autour:supabase-zones:v1";
const CACHE_COUCHE_FRAICHE_MS = 5 * 60 * 1e3;
const CACHE_COUCHE_MAX_MS = 30 * 60 * 1e3;
const CACHE_COUCHES_ZONES_MAX = 4;
const requetesCouchesSupabase = /* @__PURE__ */ new Map();
const signaturesCouchesPubliees = /* @__PURE__ */ new Map();
let cacheCouchesSupabaseMemo = null;
function cleCoucheSupabase(lat, lng) {
  return "geo@" + Number(lat).toFixed(2) + "," + Number(lng).toFixed(2);
}
function cacheCouchesSupabase() {
  if (cacheCouchesSupabaseMemo) return cacheCouchesSupabaseMemo;
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(CLE_CACHE_COUCHES_SUPABASE) || "{}") || {};
  } catch (e) {
    cache = {};
  }
  const maintenant = Date.now();
  Object.keys(cache).forEach((cle) => {
    const entree = cache[cle];
    if (!entree || !Number.isFinite(entree.t) || maintenant - entree.t > CACHE_COUCHE_MAX_MS)
      delete cache[cle];
  });
  cacheCouchesSupabaseMemo = cache;
  return cache;
}
function ecrireCacheCouchesSupabase(cle, entree) {
  const cache = cacheCouchesSupabase();
  cache[cle] = {
    t: entree.t,
    publications: entree.publications || [],
    evenements: entree.evenements || []
  };
  const cles = Object.keys(cache).sort((a, b) => (cache[b].t || 0) - (cache[a].t || 0));
  cles.slice(CACHE_COUCHES_ZONES_MAX).forEach((c) => delete cache[c]);
  try {
    localStorage.setItem(CLE_CACHE_COUCHES_SUPABASE, JSON.stringify(cache));
  } catch (e) {
    cles.slice(1).forEach((c) => delete cache[c]);
    try {
      localStorage.setItem(CLE_CACHE_COUCHES_SUPABASE, JSON.stringify(cache));
    } catch (e2) {
    }
  }
}
function signatureCoucheSupabase(entree) {
  const champs = (l) => [
    l && l.id,
    l && l.titre,
    l && l.title,
    l && l.debutLe,
    l && l.finLe,
    l && l.start_at,
    l && l.end_at,
    l && l.temporalStatus,
    l && l.temporal_status,
    l && l.status,
    l && l.annule,
    l && l.cancelled,
    l && l.lat,
    l && l.lng,
    l && l.majLe,
    l && l.last_synced_at,
    l && JSON.stringify(l.temporal_data || l.temporalData || null),
    l && JSON.stringify(l.temporal_observations || []),
    l && JSON.stringify(l.temporal_conflicts || []),
    l && JSON.stringify(l.occurrences || l.timings || []),
    l && l.announced_at,
    l && l.presale_at,
    l && l.tickets_open_at,
    l && JSON.stringify(l.announcement_tags || l.announcementTags || []),
    l && l.importance_level,
    l && l.importance_score,
    l && JSON.stringify(l.performers || []),
    l && l.organizer,
    l && l.ticket_url,
    l && JSON.stringify(l.announcement_provenance || l.announcementProvenance || {}),
    l && l.image_url,
    l && l.image_updated_at,
    l && l.image_version
  ].join("~");
  return [
    ...(entree.publications || []).map(champs),
    "#",
    ...(entree.evenements || []).map(champs)
  ].join("|");
}
function coucheSupabaseToujoursCourante(cle, portee, lat, lng) {
  if (!porteeValide(portee)) return false;
  const centre = centreDonnees();
  if (!centre) return false;
  return cleCoucheSupabase(centre[0], centre[1]) === cle && distanceM(centre[0], centre[1], lat, lng) < 1600;
}
function publierCoucheSupabase(cle, entree, portee, lat, lng) {
  if (!coucheSupabaseToujoursCourante(cle, portee, lat, lng)) return false;
  const signature = signatureCoucheSupabase(entree);
  if (signaturesCouchesPubliees.get(cle) === signature) return false;
  signaturesCouchesPubliees.set(cle, signature);
  fusionnerLots([
    { donnees: entree.publications, flux: "user" },
    { donnees: entree.evenements, flux: "external" }
  ]);
  return !!((entree.publications || []).length || (entree.evenements || []).length);
}
async function chargerPublications(lat, lng) {
  if (!sbLecture) return null;
  const b = emprisePublications(lat, lng);
  const fini = PERF.requete("supabase_publications");
  try {
    const { data, error } = await sbLecture.rpc("publications_proches", {
      p_sud: Number(b.s),
      p_ouest: Number(b.o),
      p_nord: Number(b.n),
      p_est: Number(b.e),
      p_limite: 120
    });
    if (error) {
      console.error("Lecture des publications :", error.message);
      return null;
    }
    return (data || []).map(versLieu);
  } finally {
    fini();
  }
}
function visuelEvenement(e) {
  const v = IMAGES && IMAGES.visuel({
    image_url: e.image_url || "",
    image_source: e.image_source || (IMAGES ? IMAGES.normaliserAncienneSource({
      image: e.image_url,
      source: e.primary_source
    }) : ""),
    image_source_url: e.image_source_url || e.source_url || "",
    image_author: e.image_author || "",
    image_license: e.image_license || "",
    image_updated_at: e.image_updated_at || e.last_synced_at || null,
    image_scope: "evenement"
  });
  if (!v) return { image: "", imageSource: "", image_scope: "evenement" };
  return {
    image: v.image_url,
    imageSource: v.image_source,
    imageAttribution: IMAGES.creditObligatoire(v) && v.image_author ? [{ name: v.image_author, url: v.image_source_url }] : null,
    image_url: v.image_url,
    image_source: v.image_source,
    image_source_url: v.image_source_url,
    image_author: v.image_author,
    image_license: v.image_license,
    image_updated_at: v.image_updated_at,
    image_scope: "evenement"
  };
}
function versEvenementCanonique(e) {
  const debut = e.start_at ? new Date(e.start_at).getTime() : null;
  const fin = e.end_at ? new Date(e.end_at).getTime() : null;
  return normaliserItem({
    id: "evt" + e.id,
    dbId: e.id,
    cat: e.category || "event",
    titre: e.title,
    description: e.description || "",
    adresse: e.place_name || e.address || "",
    cp: [e.city, e.insee_code].filter(Boolean).join(" ") || commune,
    lat: e.lat,
    lng: e.lng,
    /* Conserver les noms de la RPC en plus des alias normalisés. Le moteur
       reçoit déjà `debutLe/finLe`, mais la fiche et les enrichissements ont
       besoin de pouvoir tracer la paire structurée d'origine sans dépendre
       d'un seul passage de normalisation. */
    start_at: e.start_at || null,
    end_at: e.end_at || null,
    debutLe: debut,
    finLe: fin,
    timezone: e.timezone || "Europe/Paris",
    /* Le verdict de la base, transmis intact. C'est lui qui décide de
       « Maintenant », pas la date ci-dessus. */
    temporalStatus: e.temporal_status,
    temporal_data: e.temporal_data || {},
    temporalData: e.temporal_data || {},
    temporal_observations: Array.isArray(e.temporal_observations) ? e.temporal_observations : [],
    temporal_conflicts: Array.isArray(e.temporal_conflicts) ? e.temporal_conflicts : [],
    occurrences: Array.isArray(e.occurrences) ? e.occurrences : Array.isArray(e.timings) ? e.timings : [],
    timings: Array.isArray(e.occurrences) ? e.occurrences : Array.isArray(e.timings) ? e.timings : [],
    event_start_at: e.start_at || null,
    event_end_at: e.end_at || null,
    announced_at: e.announced_at || null,
    announcedAt: e.announced_at || null,
    presale_at: e.presale_at || null,
    presaleAt: e.presale_at || null,
    tickets_open_at: e.tickets_open_at || null,
    ticketsOpenAt: e.tickets_open_at || null,
    announcement_tags: Array.isArray(e.announcement_tags) ? e.announcement_tags : [],
    announcementTags: Array.isArray(e.announcement_tags) ? e.announcement_tags : [],
    importance_level: e.importance_level || "local",
    importanceLevel: e.importance_level || "local",
    importance_score: Number.isFinite(Number(e.importance_score)) ? Number(e.importance_score) : 0,
    importanceScore: Number.isFinite(Number(e.importance_score)) ? Number(e.importance_score) : 0,
    performers: Array.isArray(e.performers) ? e.performers : [],
    organizer: e.organizer || null,
    ticket_url: e.ticket_url || null,
    announcement_provenance: e.announcement_provenance || {},
    announcementProvenance: e.announcement_provenance || {},
    metro_area: e.metro_area || e.metroArea || e.territory_group || null,
    metroArea: e.metro_area || e.metroArea || e.territory_group || null,
    territory_slug: e.territory_slug || e.territorySlug || null,
    territorySlug: e.territory_slug || e.territorySlug || null,
    territory_distance_km: Number.isFinite(Number(e.territory_distance_km)) ? Number(e.territory_distance_km) : null,
    dateConfidence: e.date_confidence,
    date_confidence: e.date_confidence,
    lastSourceUpdate: e.last_source_update || null,
    lastSyncedAt: e.last_synced_at || null,
    last_source_update: e.last_source_update || null,
    last_synced_at: e.last_synced_at || null,
    isTemporary: true,
    annule: !!e.cancelled,
    status: e.cancelled ? "cancelled" : "active",
    par: e.primary_source === "datatourisme" ? "DATAtourisme" : "Autour",
    url: "",
    // une fiche Autour ne redirige pas vers une URL fournisseur
    /* L'AFFICHE DE L'ÉVÉNEMENT, AVEC SA VRAIE PROVENANCE.
    
           Cette ligne écrivait `imageSource:"datatourisme_licence"` pour TOUTE
           image d'événement. Or DATAtourisme n'en fournit aucune — son connecteur
           écrit `image_url: null` — et les seules affiches en base viennent
           d'OpenAgenda. On étiquetait donc une affiche d'organisateur comme une
           image sous licence ouverte de catalogue, et `photoAutoriseeAide` la
           laissait passer sur ce faux titre.
    
           La provenance arrive maintenant de la base, où le connecteur l'a
           écrite. `image_scope` marque que c'est l'affiche de L'ÉVÉNEMENT : une
           photo du bâtiment ne viendra jamais la remplacer. */
    ...visuelEvenement(e),
    majLe: e.last_synced_at || null
  }, e.primary_source || "datatourisme");
}
async function chargerEvenementsCanoniques(lat, lng) {
  if (!sbLecture) return null;
  const b = emprisePublications(lat, lng);
  const finTerritoire = PERF.requete("supabase_territoire");
  const territoirePromesse = Promise.resolve(sbLecture.rpc("resoudre_territoire", {
    p_lat: Number(lat),
    p_lng: Number(lng),
    p_nom: communeUtile() || null
  })).then(({ data, error }) => {
    if (error) {
      console.error("R\xE9solution du territoire :", error.message);
      bassinTerritorialActif = null;
      return null;
    }
    bassinTerritorialActif = Array.isArray(data) ? data[0] || null : data || null;
    return bassinTerritorialActif;
  }).catch(() => {
    bassinTerritorialActif = null;
    return null;
  }).finally(finTerritoire);
  const fini = PERF.requete("supabase_evenements");
  try {
    const params = {
      p_sud: Number(b.s),
      p_ouest: Number(b.o),
      p_nord: Number(b.n),
      p_est: Number(b.e),
      p_limite: 120
    };
    const [territoire, base, annonces] = await Promise.all([
      territoirePromesse,
      sbLecture.rpc("evenements_proches", params),
      chargerAnnoncesCanoniques(lat, lng)
    ]);
    const { data, error } = base;
    if (error) {
      console.error("Lecture des \xE9v\xE9nements :", error.message);
      return null;
    }
    const annoncesParId = new Map((annonces || []).map((event) => [String(event.id), event]));
    return (data || []).map((event) => versEvenementCanonique({
      ...event,
      ...annoncesParId.get(String(event.id)) || {}
    })).filter(Boolean);
  } finally {
    fini();
  }
}
async function chargerAnnoncesCanoniques(lat, lng) {
  if (!sbLecture) return [];
  const b = emprisePublications(lat, lng);
  try {
    const { data, error } = await sbLecture.rpc("annonces_proches", {
      p_sud: Number(b.s),
      p_ouest: Number(b.o),
      p_nord: Number(b.n),
      p_est: Number(b.e),
      p_limite: 120
    });
    if (error) {
      journal.warn("Lecture des annonces canoniques indisponible :", error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (error) {
    journal.warn("Lecture des annonces canoniques indisponible :", error?.message || error);
    return [];
  }
}
async function rafraichirCoucheSupabase(cle, lat, lng, precedent, portee) {
  if (requetesCouchesSupabase.has(cle)) return requetesCouchesSupabase.get(cle);
  let promesse;
  promesse = (async () => {
    if (!await connecter()) return precedent || {
      t: 0,
      publications: [],
      evenements: [],
      okPublications: false,
      okEvenements: false
    };
    const [publications, evenements] = await Promise.all([
      chargerPublications(lat, lng),
      chargerEvenementsCanoniques(lat, lng)
    ]);
    const okPublications = Array.isArray(publications);
    const okEvenements = Array.isArray(evenements);
    const entree = {
      t: Date.now(),
      publications: okPublications ? publications : precedent && precedent.publications || [],
      evenements: okEvenements ? evenements : precedent && precedent.evenements || [],
      okPublications,
      okEvenements
    };
    if (okPublications || okEvenements) {
      cacheCouchesSupabase()[cle] = entree;
      ecrireCacheCouchesSupabase(cle, entree);
      publierCoucheSupabase(cle, entree, portee, lat, lng);
    }
    return entree;
  })().finally(() => {
    if (requetesCouchesSupabase.get(cle) === promesse) requetesCouchesSupabase.delete(cle);
  });
  requetesCouchesSupabase.set(cle, promesse);
  return promesse;
}
function chargerCoucheSupabase(lat, lng) {
  const cle = cleCoucheSupabase(lat, lng);
  const portee = porteeCourante;
  const cache = cacheCouchesSupabase();
  const entree = cache[cle];
  const age = entree ? Date.now() - entree.t : Infinity;
  if (entree && age <= CACHE_COUCHE_MAX_MS) {
    PERF.touche("supabase_zone", true);
    publierCoucheSupabase(cle, entree, portee, lat, lng);
    if (age > CACHE_COUCHE_FRAICHE_MS)
      void rafraichirCoucheSupabase(cle, lat, lng, entree, portee);
    return Promise.resolve(Object.assign({}, entree, { depuisCache: true }));
  }
  PERF.touche("supabase_zone", false);
  return rafraichirCoucheSupabase(cle, lat, lng, null, portee);
}
const Store = {
  get dispo() {
    return !!sb;
  },
  /* Dépose l'affiche dans le bucket « evenements », sous le dossier de son
     auteur — c'est ce chemin que la RLS du stockage vérifie. Un échec d'envoi
     ne doit jamais empêcher la publication : l'événement compte plus que
     son image. */
  async televerserImage(fichier) {
    if (!sb || !fichier || !moiId) return "";
    const extension = (fichier.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const chemin = moiId + "/" + Date.now() + "." + extension;
    const { error } = await sb.storage.from("evenements").upload(chemin, fichier, { cacheControl: "3600", upsert: false });
    if (error) {
      console.error("Image refus\xE9e :", error.message);
      return "";
    }
    const { data } = sb.storage.from("evenements").getPublicUrl(chemin);
    return data && data.publicUrl || "";
  },
  async publier(l) {
    const identite = await assurerIdentitePublication();
    if (!sb || !identite) return null;
    const { data, error } = await sb.from("publications").insert({
      creator_id: identite.id,
      created_by: identite.id,
      creator_name: identite.name,
      status: "active",
      cat: l.cat,
      titre: l.titre,
      adresse: l.adresse,
      cp: l.cp,
      quand: l.quand,
      gratuit: l.gratuit,
      prix: l.prix,
      places: l.places,
      lat: l.lat,
      lng: l.lng,
      image_url: l.image || null,
      debut_le: l.debutLe ? new Date(l.debutLe).toISOString() : null,
      fin_le: l.finLe ? new Date(l.finLe).toISOString() : null
    }).select().single();
    if (error) {
      console.error("Publication refus\xE9e :", error.message);
      toast(/row-level security|violates/i.test(error.message) ? "Limite de publications atteinte pour aujourd\u2019hui" : "Publication impossible");
      return null;
    }
    return versLieu(data);
  },
  async supprimer(dbId) {
    if (!sb || !dbId || !moiId) return false;
    const { data, error } = await sb.from("publications").delete().eq("id", dbId).select("id");
    if (error) {
      console.error("Suppression refus\xE9e :", error.message);
      return false;
    }
    return !!(data && data.length === 1);
  },
  async annuler(dbId) {
    if (!sb || !dbId || !moiId) return false;
    const { data, error } = await sb.from("publications").update({ status: "cancelled" }).eq("id", dbId).select("id,status");
    if (error) {
      console.error("Annulation refus\xE9e :", error.message);
      return false;
    }
    return !!(data && data.length === 1 && data[0].status === "cancelled");
  },
  /* ---- Favoris ------------------------------------------------------------
     Un favori vise soit une publication Autour, soit un lieu externe. Dans le
     second cas on garde un instantané : sans lui, la liste serait vide dès
     qu'on l'ouvre ailleurs qu'à l'endroit où on a enregistré. */
  async favoris() {
    if (!sb) return [];
    const { data, error } = await sb.from("favoris").select("id,publication_id,lieu_ref,titre,cat,adresse,lat,lng,cree_le").order("cree_le", { ascending: false });
    if (error) {
      console.error("Favoris indisponibles :", error.message);
      return [];
    }
    return data || [];
  },
  async ajouterFavori(l) {
    if (!sb || !estConnecte()) return false;
    const ligne = {
      membre: moiId,
      publication_id: l.dbId || null,
      lieu_ref: l.dbId ? null : refFavori(l),
      titre: l.titre || "Sans titre",
      cat: l.cat || null,
      adresse: l.adresse || null,
      lat: Number(l.lat),
      lng: Number(l.lng)
    };
    const { error } = await sb.from("favoris").insert(ligne);
    if (error && !/duplicate|unique/i.test(error.message)) {
      console.error("Favori refus\xE9 :", error.message);
      return false;
    }
    return true;
  },
  async retirerFavori(l) {
    if (!sb || !estConnecte()) return false;
    const requete = sb.from("favoris").delete().eq("membre", moiId);
    const { error } = l.dbId ? await requete.eq("publication_id", l.dbId) : await requete.eq("lieu_ref", refFavori(l));
    if (error) {
      console.error("Retrait refus\xE9 :", error.message);
      return false;
    }
    return true;
  },
  /* ---- Canaux d'événement ------------------------------------------------
     Coordination locale, pas messagerie. Il n'existe aucun canal sans
     événement, donc aucune boîte de réception pour qui n'en a pas. */
  // Les canaux où j'ai une raison d'être : créé, inscrit, ou suivi.
  async mesCanaux() {
    if (!sb || !moiId) return [];
    const { data, error } = await sb.rpc("mes_canaux");
    if (error) {
      console.error("Canaux indisponibles :", error.message);
      return [];
    }
    return data || [];
  },
  async canalDe(dbId) {
    if (!sb || !dbId) return null;
    const { data } = await sb.from("event_channels").select("id,admin,ferme").eq("publication_id", dbId).maybeSingle();
    return data || null;
  },
  async messages(channelId) {
    if (!sb || !channelId) return [];
    const { data } = await sb.from("event_messages").select("id,genre,changement,corps,details,cree_le").eq("channel_id", channelId).order("cree_le", { ascending: false }).limit(30);
    return data || [];
  },
  /* Les messages système ne s'écrivent pas d'ici : ils naissent du
     déclencheur qui observe la modification. On ne modifie donc que
     l'événement, et l'annonce suit toute seule. */
  async modifierEvenement(dbId, champs) {
    if (!sb || !dbId || !moiId) return false;
    const permis = /* @__PURE__ */ new Set([
      "titre",
      "adresse",
      "cp",
      "quand",
      "gratuit",
      "prix",
      "places",
      "lat",
      "lng",
      "image_url",
      "debut_le",
      "fin_le"
    ]);
    const propres = Object.fromEntries(Object.entries(champs || {}).filter(([cle]) => permis.has(cle)));
    if (!Object.keys(propres).length) return false;
    const { data, error } = await sb.from("publications").update(propres).eq("id", dbId).select("id");
    if (error) {
      console.error("Modification refus\xE9e :", error.message);
      return false;
    }
    return !!(data && data.length === 1);
  },
  // Annonce libre et courte, réservée à l'administrateur par la RLS.
  async annoncer(channelId, corps) {
    if (!sb || !channelId) return false;
    const texte = String(corps || "").trim();
    if (!texte || texte.length > 500) return false;
    const { error } = await sb.from("event_messages").insert({ channel_id: channelId, auteur: moiId, genre: "annonce", corps: texte });
    if (error) {
      console.error("Annonce refus\xE9e :", error.message);
      return false;
    }
    return true;
  },
  async rejoindre(channelId, role) {
    if (!channelId || !sb || !estConnecte()) return false;
    const { error } = await sb.from("event_participants").insert({ channel_id: channelId, membre: moiId, role: role || "participant" });
    if (error && !/duplicate|conflict/i.test(error.message)) {
      console.error("Inscription refus\xE9e :", error.message);
      return false;
    }
    return true;
  },
  async quitter(channelId) {
    if (!sb || !channelId) return false;
    const { error } = await sb.from("event_participants").delete().eq("channel_id", channelId).eq("membre", moiId);
    return !error;
  }
};
let permanentPlaces = [], datatourismePlaces = [], externalEvents = [], userPublications = [];
let lieux = [], publies = userPublications, marqueurs = /* @__PURE__ */ new Map(), etiquettes = [];
let filtreActif = "tout", recherche = "", modePose = false;
const COMMUNE_INCONNUE = "ton quartier";
let coucheVille, moi, positionMoi = null, commune = COMMUNE_INCONNUE;
let selectionAccueil = null;
const EPINGLE_MS = 10 * 60 * 1e3;
const publicationsEpinglees = /* @__PURE__ */ new Map();
function epinglerPublication(id) {
  publicationsEpinglees.set(id, Date.now());
}
function idsEpingles() {
  const t = Date.now();
  publicationsEpinglees.forEach((quand, id) => {
    if (t - quand > EPINGLE_MS) publicationsEpinglees.delete(id);
  });
  return [...publicationsEpinglees.keys()];
}
let routes = [];
let ligneCouches = [];
let vueAvantTrajet = null;
let modeNav = false;
const $ = (s) => document.querySelector(s);
const NAV_FLOTTANTE = matchMedia("(min-width:1100px)");
const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function alea(seed) {
  let h = hash(String(seed)) || 1;
  return () => {
    h = h * 1103515245 + 12345 & 2147483647;
    return (h >> 8) % 1e4 / 1e4;
  };
}
function toast(t) {
  const el = $("#toast");
  el.textContent = t;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.hidden = true, 2400);
}
function etat(t, montrer) {
  const b = $("#bandeauGeo"), z = $("#bandeauTxt");
  if (!b || !z) return;
  z.textContent = t;
  if (montrer !== void 0) b.hidden = !montrer;
}
function ecranDejaRempli() {
  return Array.isArray(selectionAccueil) && selectionAccueil.length > 0;
}
function charge(t) {
  const c = $("#charge");
  if (!t) {
    c.classList.remove("discret");
    c.hidden = true;
    return;
  }
  if (ecranDejaRempli()) {
    majSignalMaj(true);
    return;
  }
  c.classList.remove("discret");
  c.textContent = t;
  c.hidden = false;
}
function majSignalMaj(actif) {
  const c = $("#charge");
  if (!c) return;
  if (actif) {
    c.classList.add("discret");
    c.textContent = "Mise \xE0 jour\u2026";
    c.hidden = false;
  } else {
    c.classList.remove("discret");
    c.hidden = true;
  }
}
const SEARCH_STATES = Object.freeze({
  IDLE: "idle",
  REQUESTING_LOCATION: "requestingLocation",
  LOADING_PLACES: "loadingPlaces",
  LOADING_EVENTS: "loadingEvents",
  SUCCESS: "success",
  EMPTY: "empty",
  PARTIAL_ERROR: "partialError",
  LOCATION_DENIED: "locationDenied",
  NETWORK_ERROR: "networkError",
  OVERPASS_UNAVAILABLE: "overpassUnavailable"
});
const rechercheEtat = {
  location: SEARCH_STATES.IDLE,
  places: SEARCH_STATES.IDLE,
  events: SEARCH_STATES.IDLE,
  overpass: SEARCH_STATES.IDLE
};
function definirEtatRecherche(canal, etat2) {
  rechercheEtat[canal] = etat2;
  if (feuilleNiveau !== null) planifierRendu({ feuille: true });
  if (map) majBandeauVide(selectionner().length);
}
const proprietairesEtatRecherche = /* @__PURE__ */ new Map();
function prendreEtatRecherche(canal, generation) {
  if (generation) proprietairesEtatRecherche.set(canal, generation.id);
}
function definirEtatRechercheVersionne(canal, etat2, generation) {
  if (!generation || proprietairesEtatRecherche.get(canal) !== generation.id) return false;
  definirEtatRecherche(canal, etat2);
  return true;
}
function rechercheEnCours() {
  return rechercheEtat.location === SEARCH_STATES.REQUESTING_LOCATION || rechercheEtat.places === SEARCH_STATES.LOADING_PLACES || rechercheEtat.events === SEARCH_STATES.LOADING_EVENTS;
}
function etatErreurPartielle() {
  return rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE || rechercheEtat.places === SEARCH_STATES.PARTIAL_ERROR || rechercheEtat.events === SEARCH_STATES.PARTIAL_ERROR;
}
const SERVEURS = [
  "https://overpass.kumi.systems/api/interpreter",
  // le plus rapide et le moins saturé
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];
let relaisLieux = null;
let overpassEchecsConsecutifs = 0;
async function overpassRelaye(q, msMax, signal) {
  if (relaisLieux === false) return { ok: false, elements: [], raison: "relais_absent" };
  try {
    const stop = new AbortController();
    const t = setTimeout(() => stop.abort(), Math.max(msMax || 0, RELAIS_DELAI_MS));
    if (signal) signal.addEventListener("abort", () => stop.abort(), { once: true });
    PERF.requete("overpass");
    const r = await fetch("/api/lieux?q=" + encodeURIComponent(q), { signal: stop.signal });
    clearTimeout(t);
    if (r.status === 404 || r.status === 405) {
      relaisLieux = false;
      return { ok: false, elements: [], raison: "relais_absent" };
    }
    if (!r.ok) return { ok: false, elements: [], raison: "http_" + r.status };
    const j = await r.json();
    relaisLieux = true;
    PERF.jalon("relais_lieux");
    return j && Array.isArray(j.elements) ? { ok: true, elements: j.elements, raison: "relais" } : { ok: false, elements: [], raison: "reponse_invalide" };
  } catch (e) {
    return { ok: false, elements: [], raison: signal && signal.aborted ? "annule" : "delai" };
  }
}
async function overpass(q, msMax, signal, viaRelais) {
  const debut = Date.now();
  const budget = msMax || 14e3;
  const simule = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("simulateOverpassFailure") === "1";
  if (simule) {
    journal.warn("Overpass : panne simul\xE9e pour le test local");
    return { ok: false, elements: [], raison: "simulee" };
  }
  if (viaRelais) {
    return overpassRelaye(q, msMax, signal);
  }
  for (let i = 0; i < SERVEURS.length; i++) {
    const url = SERVEURS[i];
    if (signal && signal.aborted) return { ok: false, elements: [], raison: "annule" };
    const restant = budget - (Date.now() - debut);
    if (restant < 600) break;
    const serveursRestants = SERVEURS.length - i;
    const delaiTentative = Math.max(500, Math.floor(restant / serveursRestants));
    try {
      const stop = new AbortController();
      const t = setTimeout(() => stop.abort(), delaiTentative);
      if (signal) signal.addEventListener("abort", () => stop.abort(), { once: true });
      const r = await fetch(url, {
        method: "POST",
        signal: stop.signal,
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
      clearTimeout(t);
      if (!r.ok) {
        journal.warn("Overpass", r.status, url);
        continue;
      }
      const j = await r.json();
      if (j && Array.isArray(j.elements)) return { ok: true, elements: j.elements, raison: "direct" };
    } catch (e) {
      journal.warn("Overpass injoignable :", url, e.name || e);
    }
  }
  journal.warn("Overpass : aucun serveur n\u2019a r\xE9pondu");
  return { ok: false, elements: [], raison: "indisponible" };
}
async function geometrieVille(lat, lng) {
  const q1 = `[out:json][timeout:20];
(
way(around:800,${lat},${lng})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"];
way(around:800,${lat},${lng})[leisure~"^(park|garden|pitch)$"];
way(around:800,${lat},${lng})[landuse~"^(grass|forest|cemetery)$"];
way(around:800,${lat},${lng})[natural=water];
);
out geom;`;
  let resultat = await overpass(q1, 14e3);
  let els = resultat.ok ? resultat.elements : null;
  if (els && els.length) return els;
  const q2 = `[out:json][timeout:15];
way(around:450,${lat},${lng})[highway~"^(primary|secondary|tertiary|residential|pedestrian)$"];
out geom;`;
  resultat = await overpass(q2, 1e4);
  return resultat.ok ? resultat.elements : null;
}
const CATS_DEPART = /* @__PURE__ */ new Set([
  "resto",
  "fastfood",
  "cafe",
  "marche",
  "bar",
  "cinema",
  "spectacle",
  "concert",
  "friperie",
  "commerce",
  "biblio",
  "musee",
  "parc"
]);
const OVERPASS_DELAI_BOOT = 4500;
const OVERPASS_DELAI_DEMANDE = 6e3;
const RELAIS_DELAI_MS = 12e3;
const RAYON_BOOT = 900;
const PLAFOND_BOOT = 90;
const CLES_NOM_OSM = [
  "name",
  "name:fr",
  "official_name",
  "official_name:fr",
  "alt_name",
  "short_name",
  "loc_name",
  "brand",
  "addr:housename"
];
function nomReelOsm(tags) {
  const t = tags || {};
  for (const cle of CLES_NOM_OSM) {
    const valeur = t[cle];
    if (typeof valeur === "string" && valeur.trim().length >= 2) return valeur.trim();
  }
  return "";
}
async function vraisLieux(lat, lng, bornes, opts) {
  const o = opts || {};
  const garder = o.cats ? new Set(o.cats) : o.tout ? null : CATS_DEPART;
  const parCle = {};
  REQUETES.forEach(([k, v, cat]) => {
    if (garder && !garder.has(cat)) return;
    (parCle[k] = parCle[k] || []).push(v);
  });
  TAGS_PARTAGES.forEach(([k, v, cats]) => {
    if (garder && !cats.some((c) => garder.has(c))) return;
    const liste = parCle[k] = parCle[k] || [];
    if (!liste.includes(v)) liste.push(v);
  });
  if (!Object.keys(parCle).length) return [];
  const rayon = o.rayon || 1500;
  const plafond = o.limite || 300;
  const zone = bornes ? `(${bornes.s},${bornes.o},${bornes.n},${bornes.e})` : `(around:${rayon},${lat},${lng})`;
  const zonePays = o.pays === "FR" ? bornes ? `${zone}(area.fr)` : `(around:${rayon},${lat},${lng})(area.fr)` : zone;
  const prefixePays = o.pays === "FR" ? 'area["ISO3166-1"="FR"]->.fr;' : "";
  const bloc = Object.entries(parCle).map(([k, vs]) => `nwr${zonePays}["${k}"~"^(${vs.join("|")})$"];`).join("");
  const delai = o.delai || OVERPASS_DELAI_DEMANDE;
  const secondesOverpass = Math.min(25, Math.max(8, Math.round(delai / 1e3)));
  const resultat = await overpass(
    `[out:json][timeout:${secondesOverpass}];${prefixePays}(${bloc});out center ${plafond};`,
    delai,
    o.signal,
    true
  );
  if (!resultat.ok) return { ok: false, lieux: [], raison: resultat.raison };
  const lieuxOsm = resultat.elements.map((e) => {
    const t = e.tags || {}, p = e.center || e;
    if (!p.lat || !p.lon) return null;
    const regle = REQUETES.find(([k, v]) => t[k] === v);
    if (!regle) return null;
    const nom = nomReelOsm(t);
    const cat = affinerCategorie(categorieTransport(regle[2], nom, t), nom, t);
    const brut = {
      id: "osm" + e.type + e.id,
      cat,
      titre: nom || CATS[cat].label,
      description: t.description || t.note || "",
      tags: t,
      type: t.amenity || t.leisure || t.tourism || t.office || "",
      sansNom: !nom,
      // « un résultat sans nom exploitable »
      adresse: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || nom,
      cp: [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ") || commune,
      quand: t.opening_hours || "Voir sur place",
      cuisine: t.cuisine || "",
      // turkish, african, pizza…
      tel: t.phone || t["contact:phone"] || "",
      url: t.website || t["contact:website"] || "",
      pmr: t.wheelchair === "yes" ? true : t.wheelchair === "no" ? false : void 0,
      service: preciserService(nom),
      // Mission locale ≠ France Travail
      aliases: [
        t["addr:full"],
        t.official_name,
        t["official_name:fr"],
        t.alt_name,
        t.short_name
      ].filter(Boolean),
      officialName: t.official_name || t["official_name:fr"] || "",
      solidaire: estSolidaire(nom, regle[1] === "charity" || /^(social_facility|social_centre)$/.test(regle[1]) || regle[0] === "social_facility"),
      // L'absence de `fee` ne signifie rien. Seul `fee=no` autorise Autour à
      // écrire « Gratuit » ; `fee=yes` atteste au contraire que c'est payant.
      gratuit: t.fee === "no" ? true : t.fee === "yes" ? false : void 0,
      prix: t.fee === "no" ? 0 : t.fee === "yes" ? 6 : null,
      places: null,
      qr: false,
      par: "OpenStreetMap",
      lat: p.lat,
      lng: p.lon,
      idOsm: e.type + e.id
    };
    const fournisseur = window.AutourProviders && AutourProviders.osm;
    const normalise = fournisseur ? fournisseur.normaliser(brut) : null;
    return normaliserItem(normalise ? Object.assign({}, brut, AutourProviders.versInterne(normalise)) : brut, "openstreetmap");
  }).filter(Boolean);
  return { ok: true, lieux: lieuxOsm, raison: resultat.raison };
}
let relaisDecouvertes = null;
async function decouvertesAncrees(lat, lng, signal) {
  if (relaisDecouvertes === false) return [];
  const fournisseur = window.AutourProviders && AutourProviders.decouvertes;
  if (!fournisseur) return [];
  try {
    PERF.requete("decouvertes");
    const reponse = await fournisseur.autour(lat, lng, {
      signal,
      angle: angleDecouvertes(),
      ville: communeUtile()
    });
    if (!reponse.actif) {
      relaisDecouvertes = false;
      return [];
    }
    relaisDecouvertes = true;
    if (!reponse.items.length) return [];
    const { ancrees } = fournisseur.repartir(reponse.items, lieux);
    return ancrees.map((d) => normaliserItem(d, "gemini"));
  } catch (e) {
    return [];
  }
}
function angleDecouvertes() {
  if (modeAide) return "decouvrir";
  if (catsActives && [...catsActives].some((c) => ["resto", "fastfood", "cafe", "bar"].includes(c)))
    return "manger";
  return creneau === "maintenant" ? "sortir" : "sortir";
}
function communeUtile() {
  if (zoneActive && CTX && zoneActive.type === CTX.TYPES.RECHERCHE && zoneActive.nom)
    return zoneActive.nom;
  return villeDetectee && commune && commune !== "ton quartier" ? commune : "";
}
let relaisDatatourisme = null;
async function lieuxDatatourisme(lat, lng, signal) {
  if (relaisDatatourisme === false) return [];
  try {
    const fournisseur = window.AutourProviders && AutourProviders.datatourisme;
    if (!fournisseur) return [];
    PERF.requete("datatourisme");
    const places = await fournisseur.nearby(lat, lng, { signal });
    relaisDatatourisme = true;
    return places.map((p) => AutourProviders.versInterne(p)).filter((l) => l && !estTemporaire(l));
  } catch (e) {
    return [];
  }
}
async function evenementsOpenAgenda() {
  return null;
}
let dernierNom = [0, 0];
let relaisCommune = null;
const communesEnVol = /* @__PURE__ */ new Map();
async function communeRelayee(lat, lng) {
  if (relaisCommune === false) return void 0;
  const cle = lat.toFixed(2) + "," + lng.toFixed(2);
  if (communesEnVol.has(cle)) return communesEnVol.get(cle);
  const promesse = (async () => {
    try {
      PERF.requete("commune");
      const r = await fetch("/api/commune?lat=" + lat + "&lng=" + lng);
      if (r.status === 404 || r.status === 405) {
        relaisCommune = false;
        return void 0;
      }
      if (!r.ok) return null;
      const j = await r.json();
      relaisCommune = true;
      PERF.jalon("nominatim_done");
      return j && j.commune || null;
    } catch (e) {
      return void 0;
    }
  })();
  communesEnVol.set(cle, promesse);
  promesse.finally(() => communesEnVol.delete(cle));
  return promesse;
}
async function nomCommune(lat, lng) {
  const parRelais = await communeRelayee(lat, lng);
  if (parRelais !== void 0) return parRelais || "ton quartier";
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12`);
    const j = await r.json();
    const a = j.address || {};
    PERF.jalon("nominatim_done");
    return a.city || a.town || a.village || a.municipality || a.suburb || "ton quartier";
  } catch (e) {
    return "ton quartier";
  }
}
const LARGEURS = {
  motorway: 8,
  trunk: 7,
  primary: 6.5,
  secondary: 5.5,
  tertiary: 4.5,
  unclassified: 3.4,
  residential: 3.4,
  living_street: 3,
  service: 2,
  pedestrian: 2.6,
  footway: 1.2,
  path: 1.2,
  cycleway: 1.4,
  steps: 1.2,
  track: 1.4
};
const NOMMEES = /* @__PURE__ */ new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "pedestrian"]);
function dessinerVille(elements) {
  const rendu = L.canvas({ padding: 0.6 });
  const surfaces = [], eaux = [], batis = [], voiesFond = [], voies = [];
  elements.forEach((e) => {
    if (!e.geometry || e.geometry.length < 2) return;
    const pts = e.geometry.map((p) => [p.lat, p.lon]);
    const t = e.tags || {};
    if (t.building) {
      batis.push(pts);
      return;
    }
    if (t.natural === "water" || t.waterway) {
      if (t.waterway && t.natural !== "water") {
        voies.push({ pts, couleur: "var(--eau)", poids: 4, type: "eau" });
      } else eaux.push(pts);
      return;
    }
    if (t.leisure || t.landuse) {
      surfaces.push({ pts, vif: t.leisure === "pitch" });
      return;
    }
    if (t.highway) {
      const l = LARGEURS[t.highway];
      if (!l) return;
      const pieton = ["footway", "path", "steps", "cycleway", "track"].includes(t.highway);
      const vite = ["motorway", "trunk", "primary"].includes(t.highway);
      voiesFond.push({ pts, poids: l + 2.4, pieton, vite });
      voies.push({ pts, poids: l, pieton, vite, nom: NOMMEES.has(t.highway) ? t.name : null });
    }
  });
  const style = (o) => Object.assign({ renderer: rendu, interactive: false }, o);
  surfaces.forEach((s) => L.polygon(s.pts, style({
    stroke: false,
    fillColor: s.vif ? "#CBDFC2" : "var(--vert)",
    fillOpacity: 1,
    pane: "villePane"
  })).addTo(coucheVille));
  eaux.forEach((p) => L.polygon(p, style({ stroke: false, fillColor: "var(--eau)", fillOpacity: 1, pane: "villePane" })).addTo(coucheVille));
  batis.forEach((p) => L.polygon(p, style({ stroke: false, fillColor: "var(--bati)", fillOpacity: 1, pane: "villePane" })).addTo(coucheVille));
  voiesFond.forEach((v) => {
    const c = L.polyline(v.pts, style({
      color: v.vite ? "var(--vite-bord)" : "var(--liser\xE9)",
      weight: v.poids,
      opacity: v.pieton ? 0 : 1,
      lineJoin: "round",
      lineCap: "round",
      pane: "villePane"
    })).addTo(coucheVille);
    routes.push({ couche: c, base: v.poids });
  });
  voies.forEach((v) => {
    const c = L.polyline(v.pts, style({
      color: v.type === "eau" ? "var(--eau)" : v.vite ? "var(--vite)" : "var(--voie)",
      weight: v.poids,
      lineJoin: "round",
      lineCap: "round",
      dashArray: v.pieton ? "3 4" : null,
      pane: "villePane"
    })).addTo(coucheVille);
    routes.push({ couche: c, base: v.poids });
    if (v.nom && v.pts.length > 2) {
      const m = v.pts[Math.floor(v.pts.length / 2)];
      etiquettes.push(L.marker(m, {
        icon: L.divIcon({ className: "rue", html: '<span class="rue-in">' + esc(v.nom) + "</span>", iconSize: [0, 0] }),
        interactive: false,
        keyboard: false,
        pane: "ruesPane"
      }));
    }
  });
  majEpaisseurs();
  majEtiquettes();
}
function grilleSecours(lat, lng) {
  const rendu = L.canvas({ padding: 0.6 });
  const rnd = alea(lat.toFixed(3) + lng.toFixed(3));
  const angle = (rnd() - 0.5) * 0.7;
  const pasX = 16e-4, pasY = 11e-4;
  const N = 9;
  const style = (o) => Object.assign({ renderer: rendu, interactive: false, pane: "villePane" }, o);
  const P = (i, j) => {
    const x = i * pasX, y = j * pasY;
    return [
      lat + (x * Math.sin(angle) + y * Math.cos(angle)),
      lng + (x * Math.cos(angle) - y * Math.sin(angle))
    ];
  };
  for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
    if (rnd() < 0.14) continue;
    const m = 0.16;
    const coins = [P(i + m, j + m), P(i + 1 - m, j + m), P(i + 1 - m, j + 1 - m), P(i + m, j + 1 - m)];
    L.polygon(coins, style({ stroke: false, fillColor: "var(--bati)", fillOpacity: 1 })).addTo(coucheVille);
  }
  const vert1 = [P(-4, 1), P(-1.6, 1), P(-1.6, 3.2), P(-4, 3.2)];
  const vert2 = [P(2.2, -4), P(4.6, -4), P(4.6, -2), P(2.2, -2)];
  [vert1, vert2].forEach((v) => L.polygon(v, style({ stroke: false, fillColor: "var(--vert)", fillOpacity: 1 })).addTo(coucheVille));
  L.polygon(
    [P(-N, -2.4), P(N, -1.9), P(N, -1.3), P(-N, -1.8)],
    style({ stroke: false, fillColor: "var(--eau)", fillOpacity: 1 })
  ).addTo(coucheVille);
  const trace = (pts, poids, vite) => {
    const fond = L.polyline(pts, style({
      color: vite ? "var(--vite-bord)" : "var(--liser\xE9)",
      weight: poids + 2.4,
      lineJoin: "round",
      lineCap: "round"
    })).addTo(coucheVille);
    const dessus = L.polyline(pts, style({
      color: vite ? "var(--vite)" : "var(--voie)",
      weight: poids,
      lineJoin: "round",
      lineCap: "round"
    })).addTo(coucheVille);
    routes.push({ couche: fond, base: poids + 2.4 });
    routes.push({ couche: dessus, base: poids });
  };
  for (let i = -N; i <= N; i++) {
    const grand = i % 3 === 0;
    trace([P(i, -N), P(i, N)], grand ? 5.5 : 3.2, i === 0);
  }
  for (let j = -N; j <= N; j++) {
    const grand = j % 3 === 0;
    trace([P(-N, j), P(N, j)], grand ? 5.5 : 3.2, false);
  }
  majEpaisseurs();
}
const FONDS = [
  {
    nom: "CARTO Positron",
    url: "https://basemaps.cartocdn.com/rastertiles/positron/{z}/{x}/{y}{r}.png",
    opts: {
      subdomains: "abcd",
      maxZoom: 20,
      crossOrigin: true,
      attribution: '\xA9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \xA9 CARTO'
    }
  },
  {
    nom: "CARTO Voyager",
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    opts: {
      subdomains: "abcd",
      maxZoom: 20,
      crossOrigin: true,
      attribution: '\xA9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \xA9 <a href="https://carto.com/attributions">CARTO</a>'
    }
  },
  {
    nom: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    opts: {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '\xA9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }
  }
];
let promesseCarteGoogle = null;
let fondAutonomePose = false;
function attributionFondAutonome() {
  const attribution = document.querySelector("#attribution span");
  if (attribution) attribution.innerHTML = '\xA9 <a href="https://www.openstreetmap.org/copyright">OSM</a> \xB7 <a href="https://carto.com/attributions">CARTO</a>';
  const credits = document.getElementById("credits");
  if (credits) credits.textContent = "\xA9 OSM \xB7 CARTO";
}
function remettreFondAutonome() {
  if (!map || fondAutonomePose) return Promise.resolve(null);
  const centre = positionMoi || [map.getCenter().lat, map.getCenter().lng];
  if (!centre || !Number.isFinite(centre[0]) || !Number.isFinite(centre[1])) return Promise.resolve(null);
  fondAutonomePose = true;
  return poserFond().then((fond) => {
    if (fond) return fond;
    quandLibre(() => geometrieVille(centre[0], centre[1]).then((geo) => {
      if (geo && geo.length) dessinerVille(geo);
      else grilleSecours(centre[0], centre[1]);
    }));
    return null;
  });
}
window.addEventListener("autour:google-map-failed", () => {
  promesseCarteGoogle = Promise.resolve(false);
  attributionFondAutonome();
  remettreFondAutonome();
});
function preparerCarteGoogle(centre, zoom) {
  const fournisseur = window.AutourMapProviders && AutourMapProviders.googleMaps;
  if (!fournisseur || !CLE_GOOGLE) return Promise.resolve(false);
  promesseCarteGoogle = fournisseur.activer(document.getElementById("map"), centre, zoom, CLE_GOOGLE).then((ok) => {
    if (ok) {
      const attribution = document.querySelector("#attribution span");
      if (attribution) attribution.innerHTML = "\xA9 Google";
      const credits = document.getElementById("credits");
      if (credits) credits.textContent = "\xA9 Google \xB7 Donn\xE9es des fournisseurs";
      if (map && fournisseur.lierLeaflet) fournisseur.lierLeaflet(map);
    }
    return ok;
  }).catch(() => false);
  return promesseCarteGoogle;
}
async function googleMapsActif() {
  if (!promesseCarteGoogle) return false;
  const fournisseur = window.AutourMapProviders && AutourMapProviders.googleMaps;
  return !!await promesseCarteGoogle && !!(fournisseur && fournisseur.estActif && fournisseur.estActif());
}
function essayerFond(f) {
  return new Promise((resolve) => {
    const couche = L.tileLayer(f.url, Object.assign({ pane: "villePane" }, f.opts)).addTo(map);
    let ok = false, ko = 0, fini = false;
    const termine = (bon) => {
      if (fini) return;
      fini = true;
      if (!bon) surLaCarte((m) => m.removeLayer(couche));
      resolve(bon ? couche : null);
    };
    couche.on("tileload", () => {
      ok = true;
      termine(true);
    });
    couche.on("tileerror", () => {
      ko++;
      if (ko >= 4 && !ok) termine(false);
    });
    setTimeout(() => termine(ok), 2200);
  });
}
async function poserFond() {
  const essais = FONDS.map((f) => essayerFond(f).then((c) => c ? { f, c } : null));
  const gagnant = await Promise.race([
    ...essais.map((p) => p.then((r) => r || new Promise(() => {
    }))),
    // les échecs n'arbitrent pas
    Promise.allSettled(essais).then(() => null)
    // tous muets
  ]);
  essais.forEach((p) => p.then((r) => {
    if (r && gagnant && r.c !== gagnant.c) surLaCarte((m) => m.removeLayer(r.c));
  }));
  return gagnant ? gagnant.f.nom : null;
}
function majEpaisseurs() {
  if (!map) return;
  const f = clamp(Math.pow(2, map.getZoom() - 16), 0.35, 3.2);
  routes.forEach((r) => {
    try {
      r.couche.setStyle({ weight: r.base * f });
    } catch (e) {
    }
  });
}
let dernierClassement = [];
const MARGE_ECRAN = 6;
const CELLULE_COLLISION = 128;
let collisionPlanifiee = 0;
let revisionMarqueurs = 0;
let derniereSignatureCollision = null;
let revisionLieux = 0;
let recoBurstCache = null;
function resoudreCollisions() {
  if (!map) return;
  const centre = map.getCenter();
  const taille0 = map.getSize ? map.getSize() : { x: innerWidth, y: innerHeight };
  const signature = map.getZoom() + "@" + centre.lat.toFixed(5) + "," + centre.lng.toFixed(5) + "#" + marqueurs.size + "~" + revisionMarqueurs + "|" + derniereSelection.length + ":" + taille0.x + "x" + taille0.y;
  if (signature === derniereSignatureCollision) return;
  derniereSignatureCollision = signature;
  const assezPres = map.getZoom() >= 15;
  const rang = /* @__PURE__ */ new Map();
  derniereSelection.forEach((x, i) => rang.set(x.l.id, i));
  const priorite = ([id]) => rang.has(id) ? rang.get(id) : 9999;
  const conteneur = map.getContainer ? map.getContainer() : null;
  const cadre = conteneur ? conteneur.getBoundingClientRect() : { left: 0, top: 0 };
  const taille = map.getSize ? map.getSize() : { x: innerWidth, y: innerHeight };
  const grille = /* @__PURE__ */ new Map();
  const cellules = (b) => {
    const out = [];
    const x0 = Math.floor(b.x / CELLULE_COLLISION), x1 = Math.floor((b.x + b.w) / CELLULE_COLLISION);
    const y0 = Math.floor(b.y / CELLULE_COLLISION), y1 = Math.floor((b.y + b.h) / CELLULE_COLLISION);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x + ":" + y);
    return out;
  };
  const seCroisent = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const chevauche = (b) => {
    const candidates = /* @__PURE__ */ new Set();
    cellules(b).forEach((c) => (grille.get(c) || []).forEach((x) => candidates.add(x)));
    return [...candidates].some((x) => seCroisent(b, x));
  };
  const enregistrer = (b) => cellules(b).forEach((c) => {
    if (!grille.has(c)) grille.set(c, []);
    grille.get(c).push(b);
  });
  const entrees = [...marqueurs.entries()].filter(([id]) => !String(id).startsWith("grappe:")).sort((a, b) => priorite(a) - priorite(b)).map(([, m]) => {
    const el = m.getElement && m.getElement();
    const eti = el && el.querySelector(".poi-eti, .evc-txt");
    const rond = el && el.querySelector(".poi-rond, .evc-rond");
    return eti && rond ? { eti, rond } : null;
  }).filter(Boolean);
  entrees.forEach(({ eti }) => eti.classList.remove("masquee", "a-gauche"));
  if (conteneur) void conteneur.offsetWidth;
  const boites = entrees.map(({ eti, rond }) => ({
    eti,
    r: eti.getBoundingClientRect(),
    rr: rond.getBoundingClientRect()
  }));
  boites.forEach(({ rr }) => {
    if (rr.width > 0 && rr.height > 0)
      enregistrer({ x: rr.left - cadre.left, y: rr.top - cadre.top, w: rr.width, h: rr.height });
  });
  const decisions = [];
  boites.forEach(({ eti, r, rr }) => {
    if (!assezPres) {
      decisions.push({ eti, masquee: true, gauche: false });
      return;
    }
    const droite = { x: r.left - cadre.left, y: r.top - cadre.top, w: r.width, h: r.height };
    const recouvrement = Math.min(10, Math.max(6, rr.width * 0.3));
    const gauche = {
      x: rr.left - cadre.left + recouvrement - r.width,
      y: droite.y,
      w: droite.w,
      h: droite.h
    };
    const tient = (b) => b.w > 0 && b.h > 0 && b.x >= MARGE_ECRAN && b.x + b.w <= taille.x - MARGE_ECRAN && b.y >= MARGE_ECRAN && b.y + b.h <= taille.y - MARGE_ECRAN;
    let boite = droite, aGauche = false;
    if (!tient(boite) || chevauche(boite)) {
      boite = gauche;
      aGauche = true;
    }
    if (!tient(boite) || chevauche(boite)) {
      decisions.push({ eti, masquee: true, gauche: false });
      return;
    }
    enregistrer(boite);
    decisions.push({ eti, masquee: false, gauche: aGauche });
  });
  decisions.forEach((d) => {
    d.eti.classList.toggle("a-gauche", d.gauche);
    d.eti.classList.toggle("masquee", d.masquee);
  });
}
function planifierCollisions() {
  if (collisionPlanifiee) cancelAnimationFrame(collisionPlanifiee);
  collisionPlanifiee = requestAnimationFrame(() => {
    collisionPlanifiee = 0;
    resoudreCollisions();
  });
}
function majEtiquettes() {
  if (!map) return;
  const montrer = map.getZoom() >= 16;
  etiquettes.forEach((m) => {
    const dedans = map.getBounds().pad(0.1).contains(m.getLatLng());
    if (montrer && dedans) {
      if (!map.hasLayer(m)) m.addTo(map);
    } else if (map.hasLayer(m)) map.removeLayer(m);
  });
}
function estPasse(l) {
  if (estTemporaire(l)) return statutTemps(l).statut === TEMPS.STATUTS.PASSE;
  return l.endsAt != null && l.endsAt < Date.now();
}
function journaliserPipeline(source, brut, classes, dedupliques) {
  const apresMaintenant = (dedupliques || []).filter((l) => isAvailableNow(l, Date.now())).length;
  journal.info("[Autour][donn\xE9es]", {
    source,
    bruts: brut,
    apresClassification: (classes || []).length,
    apresDeduplication: (dedupliques || []).length,
    apresMaintenant
  });
}
function estGooglePlaces(l) {
  return !!(l && (l.source === "google_places" || l.idGoogle || l.sourceRefs && l.sourceRefs.googlePlaceId));
}
function familleDedupLieu(l) {
  return ["resto", "fastfood", "cafe", "bar"].includes(l && l.cat) ? "restauration" : l && l.cat;
}
function fusionnerFichesFournisseurs(candidats) {
  const liste = candidats || [];
  const aGoogle = liste.some(estGooglePlaces);
  const aAutre = liste.some((l) => !estGooglePlaces(l));
  if (!aGoogle || !aAutre) return liste.slice();
  const fusionnes = [];
  liste.forEach((l) => {
    const i = fusionnes.findIndex((existant2) => {
      if (!l || !existant2 || estTemporaire(l) || estTemporaire(existant2)) return false;
      if (estGooglePlaces(l) === estGooglePlaces(existant2)) return false;
      if (familleDedupLieu(l) !== familleDedupLieu(existant2)) return false;
      const proches = distanceM(l.lat, l.lng, existant2.lat, existant2.lng) <= 80;
      return proches && (nomsLieuxCompatibles(l.titre, existant2.titre) || adressesLieuxCompatibles(l.adresse, existant2.adresse));
    });
    if (i < 0) {
      fusionnes.push(l);
      return;
    }
    const existant = fusionnes[i], google = estGooglePlaces(l) ? l : existant, autre = google === l ? existant : l;
    const merged = Object.assign({}, autre, google);
    merged.sources = [.../* @__PURE__ */ new Set([...autre.sources || [autre.source], ...google.sources || [google.source]])];
    merged.categories = [.../* @__PURE__ */ new Set([...autre.categories || [], ...google.categories || []])];
    merged.sourceRefs = Object.assign({}, autre.sourceRefs || {}, google.sourceRefs || {});
    ["adresse", "tel", "url", "horaires", "description"].forEach((cle) => {
      merged[cle] = google[cle] || autre[cle] || "";
    });
    Object.assign(merged, visuelPrefere(google, autre));
    fusionnes[i] = merged;
  });
  return fusionnes;
}
function visuelPrefere(a, b) {
  const champs = [
    "image",
    "imageSource",
    "imageAttribution",
    "image_url",
    "image_source",
    "image_source_url",
    "image_author",
    "image_license",
    "image_updated_at",
    "image_scope"
  ];
  const sources = IMAGES ? IMAGES.SOURCES : [];
  const rang = (l) => {
    if (!l || !l.image) return Infinity;
    const i = sources.indexOf(l.imageSource);
    return i < 0 ? sources.length : i;
  };
  const gagnant = rang(a) <= rang(b) ? a : b;
  const out = {};
  if (rang(gagnant) === Infinity) return out;
  champs.forEach((cle) => {
    if (gagnant[cle] !== void 0) out[cle] = gagnant[cle];
  });
  return out;
}
function reconstruireLieux() {
  lieux = fusionnerFichesFournisseurs(dedupeItems([
    ...permanentPlaces,
    ...datatourismePlaces,
    ...externalEvents,
    ...userPublications
  ], distanceM));
  publies = userPublications;
  indexPerime = true;
  revisionLieux++;
}
const indexCategories = /* @__PURE__ */ new Map();
function reindexerCategories() {
  indexCategories.clear();
  lieux.forEach((l) => {
    (/* @__PURE__ */ new Set([l.cat, ...l.categories || []])).forEach((c) => {
      if (!c) return;
      if (!indexCategories.has(c)) indexCategories.set(c, []);
      indexCategories.get(c).push(l);
    });
  });
}
function lieuxDeCategorie(cat) {
  return indexCategories.get(cat) || [];
}
function categorieEnMemoire(cat) {
  return lieuxDeCategorie(cat).length > 0;
}
function fusionner(nouveaux, flux, opts) {
  if (!nouveaux || !nouveaux.length) return false;
  const debutCpu = performance.now();
  oublierItemsMaintenant();
  const o = opts || {};
  const type = flux || "permanent";
  const source = nouveaux[0] && nouveaux[0].source || type;
  const classes = nouveaux.map((l) => l.categories ? l : normaliserItem(l, source)).filter((l) => l.annule || !estPasse(l));
  const courant = type === "external" ? externalEvents : type === "user" ? userPublications : type === "datatourisme" ? datatourismePlaces : permanentPlaces;
  const parId = new Map(courant.map((l) => [l.id, l]));
  classes.forEach((l) => parId.set(l.id, l));
  const dedupliques = dedupeItems([...parId.values()], distanceM);
  if (type === "external") externalEvents = dedupliques;
  else if (type === "user") userPublications = dedupliques;
  else if (type === "datatourisme") datatourismePlaces = dedupliques;
  else permanentPlaces = dedupliques;
  journaliserPipeline(source, nouveaux.length, classes, dedupliques);
  PERF.travail("fusion:" + type, debutCpu);
  if (o.differerReconstruction) return true;
  finaliserFusion(o);
  return true;
}
function finaliserFusion(opts) {
  const debutCpu = performance.now();
  const o = opts || {};
  reconstruireLieux();
  if (!window.__premiereDonnee) {
    window.__premiereDonnee = true;
    performance.mark("autour:donnees");
    performance.measure("premi\xE8re donn\xE9e visible", "autour:script", "autour:donnees");
  }
  reindexerCategories();
  if (!o.silencieux) {
    planifierRendu({ carte: true, accueil: true, filtres: true });
    ouvrirLieuPartage();
  }
  if (document.body.classList.contains("pourtoi-ouvert")) majPourToi();
  PERF.travail("reconstruction", debutCpu);
}
function fusionnerLots(lots, opts) {
  let modifie = false;
  (lots || []).forEach((lot) => {
    if (fusionner(
      lot && lot.donnees,
      lot && lot.flux,
      Object.assign({}, opts || {}, { differerReconstruction: true })
    )) modifie = true;
  });
  if (modifie) finaliserFusion(opts);
  return modifie;
}
async function coordonnerSourcesVersionnees(sources, estCourante) {
  let exploitable = false;
  const travaux = (sources || []).map(async (source) => {
    try {
      const reponse = await source.charger();
      if (!estCourante()) return false;
      const publie = await source.publier(reponse);
      if (!estCourante()) return false;
      if (publie) exploitable = true;
      return !!publie;
    } catch (e) {
      if (estCourante() && typeof source.echec === "function") source.echec(e);
      return false;
    }
  });
  await Promise.allSettled(travaux);
  return estCourante() && exploitable;
}
const CACHE_HEURES = 24;
const cleCache = (lat, lng) => "autour:lieux:v5:" + lat.toFixed(3) + "," + lng.toFixed(3);
function lireCacheLieux(lat, lng) {
  try {
    const brut = localStorage.getItem(cleCache(lat, lng));
    if (!brut) return null;
    const o = JSON.parse(brut);
    if (Date.now() - o.t > CACHE_HEURES * 3600 * 1e3) return null;
    return o.l;
  } catch (e) {
    return null;
  }
}
const CACHE_RAYON_M = 1200;
function lireCacheProche(lat, lng) {
  const exact = lireCacheLieux(lat, lng);
  if (exact && exact.length) return exact;
  let meilleur = null, meilleureDistance = Infinity;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const cle = localStorage.key(i);
      if (!cle || cle.indexOf("autour:lieux:v5:") !== 0) continue;
      const [cLat, cLng] = cle.slice(16).split(",").map(Number);
      if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
      const d = distanceM(lat, lng, cLat, cLng);
      if (d > CACHE_RAYON_M || d >= meilleureDistance) continue;
      const o = JSON.parse(localStorage.getItem(cle) || "null");
      if (!o || Date.now() - o.t > CACHE_HEURES * 3600 * 1e3) continue;
      meilleur = o.l;
      meilleureDistance = d;
    }
  } catch (e) {
    return null;
  }
  return meilleur;
}
const FAMILLES_ECHANTILLON = [
  ["resto", "fastfood", "marche", "food"],
  ["cafe", "bar"],
  ["cinema", "musee", "spectacle", "concert"],
  ["parc", "park", "terrain", "swimming_pool"],
  ["event", "popup", "rencontre", "collecte", "studio", "sport", "autre"]
];
const ECHANTILLON_MAX = 5;
function echantillonImmediat(candidats) {
  const retenus = [];
  const vus = /* @__PURE__ */ new Set();
  const prendre = (l) => {
    if (!l || vus.has(l.id) || retenus.length >= ECHANTILLON_MAX) return;
    vus.add(l.id);
    retenus.push(l);
  };
  candidats.filter((l) => estFavori(l)).forEach(prendre);
  FAMILLES_ECHANTILLON.forEach((famille) => {
    if (retenus.length >= ECHANTILLON_MAX) return;
    prendre(candidats.find((l) => famille.includes(l.cat) && !vus.has(l.id)));
  });
  return retenus;
}
const CLE_RAPIDE = "autour:rapide:v1";
const RAPIDE_MAX = 50;
const RAPIDE_HEURES = 24;
const RAPIDE_RAYON_M = 2e3;
const CHAMPS_RAPIDE = [
  "id",
  "autourId",
  "cat",
  "categories",
  "titre",
  "adresse",
  "cp",
  "lat",
  "lng",
  "image",
  "imageSource",
  "imageAttribution",
  /* La provenance suit la photo jusque dans le cache. Une image sans son
     origine ne peut plus dire de quel droit on l'affiche à la réouverture :
     elle serait alors une image de source inconnue, donc à ne pas montrer. */
  "image_url",
  "image_source",
  "image_source_url",
  "image_author",
  "image_license",
  "image_updated_at",
  "image_scope",
  "note",
  "avis",
  "prix",
  "gratuit",
  "quand",
  "cuisine",
  "tags",
  "pmr",
  "source",
  "sourceRefs",
  "par",
  "isTemporary",
  "debutLe",
  "finLe",
  "service",
  "solidaire",
  "sansNom"
];
function estContenuGoogle(l) {
  return !!(l && (l.source === "google_places" || l.sourceRefs && l.sourceRefs.googlePlaceId));
}
function alleger(l) {
  const out = {};
  CHAMPS_RAPIDE.forEach((k) => {
    if (l[k] !== void 0) out[k] = l[k];
  });
  return out;
}
function sansPhotoGoogle(l) {
  if (!l || l.imageSource !== "google_places") return l;
  [
    "image",
    "imageSource",
    "imageAttribution",
    "image_url",
    "image_source",
    "image_source_url",
    "image_author",
    "image_license",
    "image_updated_at"
  ].forEach((k) => {
    delete l[k];
  });
  return l;
}
let dernierJeuRapide = 0;
function memoriserJeuRapide(choisis, reserve) {
  if (!positionMoi || !choisis || !choisis.length) return;
  if (Date.now() - dernierJeuRapide < 6e4) return;
  dernierJeuRapide = Date.now();
  quandLibre(() => {
    try {
      const vus = /* @__PURE__ */ new Set();
      const garder = [];
      [...choisis, ...reserve || []].forEach((l) => {
        if (estContenuGoogle(l)) return;
        if (!l || vus.has(l.id) || garder.length >= RAPIDE_MAX) return;
        vus.add(l.id);
        garder.push(sansPhotoGoogle(alleger(l)));
      });
      localStorage.setItem(CLE_RAPIDE, JSON.stringify({
        t: Date.now(),
        zone: positionMoi,
        commune,
        choisis: choisis.filter((l) => !estContenuGoogle(l)).map((l) => l.id),
        lieux: garder
      }));
    } catch (e) {
    }
  });
}
let zonesDisponibles = null;
const cleZoneStatique = (lat, lng) => lat.toFixed(1) + "," + lng.toFixed(1);
const RAPIDE_VOISINAGE = 25;
async function lieuxDeZone(lat, lng) {
  if (zonesDisponibles === false) return null;
  try {
    const fini = PERF.requete("zone_statique");
    const r = await fetch("zones/" + cleZoneStatique(lat, lng) + ".json");
    if (fini) fini();
    PERF.touche("zone_statique", r.ok);
    if (!r.ok) {
      if (r.status === 404) zonesDisponibles = false;
      return null;
    }
    const j = await r.json();
    if (!j || !Array.isArray(j.lieux) || !j.lieux.length) return null;
    zonesDisponibles = true;
    return j.lieux.map((l) => Object.assign({}, l, { _d: distanceM(lat, lng, l.lat, l.lng) })).sort((a, b) => a._d - b._d).slice(0, RAPIDE_VOISINAGE).map((l) => {
      delete l._d;
      return l;
    });
  } catch (e) {
    return null;
  }
}
function lireJeuRapide(lat, lng) {
  const manque = (raison) => {
    PERF.touche("jeu_rapide", false);
    return null;
  };
  try {
    const o = JSON.parse(localStorage.getItem(CLE_RAPIDE) || "null");
    if (!o || !o.lieux || !o.lieux.length) return manque("vide");
    const lieuxSansGoogle = o.lieux.filter((l) => !estContenuGoogle(l));
    if (lieuxSansGoogle.length !== o.lieux.length) {
      o.lieux = lieuxSansGoogle;
      o.choisis = (o.choisis || []).filter((id) => lieuxSansGoogle.some((l) => l.id === id));
      try {
        localStorage.setItem(CLE_RAPIDE, JSON.stringify(o));
      } catch (e) {
      }
    }
    if (!o.lieux.length) return manque("vide");
    if (Date.now() - o.t > RAPIDE_HEURES * 3600 * 1e3) return manque("perime");
    if (lat != null && o.zone && distanceM(lat, lng, o.zone[0], o.zone[1]) > RAPIDE_RAYON_M) return manque("ailleurs");
    PERF.touche("jeu_rapide", true);
    return o;
  } catch (e) {
    return manque("illisible");
  }
}
const CACHE_TUILES_MAX = 40;
function tuilesCache() {
  const tuiles = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const cle = localStorage.key(i);
      if (!cle || cle.indexOf("autour:lieux:v5:") !== 0) continue;
      let t = 0;
      try {
        t = (JSON.parse(localStorage.getItem(cle)) || {}).t || 0;
      } catch (e) {
      }
      tuiles.push({ cle, t });
    }
  } catch (e) {
    return [];
  }
  return tuiles.sort((a, b) => a.t - b.t);
}
function libererCache(combien) {
  const tuiles = tuilesCache();
  let libere = 0;
  for (const tuile of tuiles) {
    if (libere >= combien) break;
    try {
      localStorage.removeItem(tuile.cle);
      libere += 1;
    } catch (e) {
    }
  }
  return libere;
}
const CACHE_TUILE_MAX_LIEUX = 300;
function completerCacheLieux(lat, lng, nouveaux) {
  if (!nouveaux || !nouveaux.length) return false;
  const existants = lireCacheLieux(lat, lng) || [];
  const parId = /* @__PURE__ */ new Map();
  existants.forEach((l) => {
    if (l && l.id) parId.set(l.id, l);
  });
  nouveaux.forEach((l) => {
    if (l && l.id) parId.set(l.id, l);
  });
  let liste = [...parId.values()];
  if (liste.length > CACHE_TUILE_MAX_LIEUX)
    liste = liste.map((l) => ({ l, d: distanceM(lat, lng, l.lat, l.lng) })).sort((a, b) => (a.d || 0) - (b.d || 0)).slice(0, CACHE_TUILE_MAX_LIEUX).map((x) => x.l);
  return ecrireCacheLieux(lat, lng, liste);
}
function ecrireCacheLieux(lat, lng, l) {
  const cle = cleCache(lat, lng);
  const charge2 = JSON.stringify({ t: Date.now(), l });
  const surplus = tuilesCache().length - CACHE_TUILES_MAX + 1;
  if (surplus > 0) libererCache(surplus);
  try {
    localStorage.setItem(cle, charge2);
    return true;
  } catch (e) {
    if (!libererCache(Math.max(5, Math.ceil(CACHE_TUILES_MAX / 4)))) return false;
    try {
      localStorage.setItem(cle, charge2);
      return true;
    } catch (e2) {
      return false;
    }
  }
}
let dernierChargement = null;
let chargementEnCours = false;
const ZONE_DELAI_SOURCE_MS = 9e3;
const ZONE_DELAI_MODELE_MS = 15e3;
const chargementsZone = /* @__PURE__ */ new Map();
let numeroGeneration = 0;
const generationsActives = /* @__PURE__ */ new Map();
function nouvelleGeneration(canal, cle, force) {
  const precedente = generationsActives.get(canal);
  if (!force && precedente && precedente.cle === cle && !precedente.signal.aborted) return precedente;
  if (precedente) precedente.controleur.abort();
  const controleur = new AbortController();
  const generation = {
    id: ++numeroGeneration,
    canal,
    cle,
    controleur,
    signal: controleur.signal,
    portee: porteeCourante
  };
  generationsActives.set(canal, generation);
  return generation;
}
function generationCourante(generation) {
  if (!generation || generation.signal.aborted) return false;
  if (!porteeValide(generation.portee)) return false;
  return generationsActives.get(generation.canal) === generation;
}
function annulerChargementsZone(saufCanal) {
  generationsActives.forEach((g, canal) => {
    if (canal === saufCanal) return;
    try {
      g.controleur.abort();
    } catch (e) {
    }
    generationsActives.delete(canal);
  });
  chargementsZone.clear();
  chargementEnCours = false;
  dernierChargement = null;
}
function annulerGeneration(canal) {
  const generation = generationsActives.get(canal);
  if (generation) generation.controleur.abort();
  generationsActives.delete(canal);
}
function terminerGeneration(generation) {
  if (generationCourante(generation)) generationsActives.delete(generation.canal);
}
function bornesVisibles() {
  if (!map) return null;
  const b = map.getBounds(), c = b.getCenter();
  const dLat = Math.min(b.getNorth() - c.lat, 0.023);
  const dLng = Math.min(b.getEast() - c.lng, 0.023 / Math.max(0.2, Math.cos(c.lat * Math.PI / 180)));
  return {
    s: (c.lat - dLat).toFixed(5),
    n: (c.lat + dLat).toFixed(5),
    o: (c.lng - dLng).toFixed(5),
    e: (c.lng + dLng).toFixed(5)
  };
}
const zonesVues = /* @__PURE__ */ new Set();
function cleZone(lat, lng, z, cats) {
  return idZoneActive() + "#" + lat.toFixed(2) + "," + lng.toFixed(2) + "@" + Math.round(z / 2) + ":" + (cats ? [...cats].sort().join("+") : "depart");
}
function chargerZone(lat, lng, opts) {
  const o = opts || {};
  const zoomVise = o.zoomVise != null ? o.zoomVise : map ? map.getZoom() : 16;
  if (!o.sansCarte && (!map || zoomVise < ZOOM_MIN_CHARGEMENT)) return Promise.resolve([]);
  const zoom = zoomVise;
  const cle = cleZone(lat, lng, zoom, o.cats);
  const existant = chargementsZone.get(cle);
  if (!o.force && existant && generationCourante(existant.generation)) return existant;
  if (existant) chargementsZone.delete(cle);
  if (!o.force && zonesVues.has(cle)) return Promise.resolve([]);
  if (!o.force && !o.cats && dernierChargement && distanceM(dernierChargement[0], dernierChargement[1], lat, lng) < 800) return Promise.resolve([]);
  const canal = o.cats ? "zone:categories" : "zone:exploration";
  const generation = nouvelleGeneration(canal, cle, !!o.force);
  const signal = generation.signal;
  chargementEnCours = true;
  prendreEtatRecherche("overpass", generation);
  if (!o.osmSeulement) prendreEtatRecherche("places", generation);
  if (generationCourante(generation)) {
    if (!o.osmSeulement) definirEtatRechercheVersionne("places", SEARCH_STATES.LOADING_PLACES, generation);
    definirEtatRechercheVersionne("overpass", SEARCH_STATES.IDLE, generation);
  }
  const marqueDebut = "zone:debut:" + generation.id;
  try {
    performance.mark(marqueDebut);
  } catch (e) {
  }
  const enCache = lireCacheProche(lat, lng);
  let sourceExploitable = !!(enCache && enCache.length);
  if (sourceExploitable && generationCourante(generation)) {
    fusionner(enCache);
    PERF.jalon("cached_pois_visible");
  }
  const regl = o.reglages || REGIMES[regimePoint(lat, lng)];
  const large = regl === REGIMES.local;
  const travaux = [
    vraisLieux(
      lat,
      lng,
      large ? bornesVisibles() : null,
      { signal, cats: o.cats, delai: o.delai, rayon: regl.rayon, limite: regl.limite }
    ).then((r) => {
      if (!generationCourante(generation)) return;
      if (r && r.ok) {
        overpassEchecsConsecutifs = 0;
        zonesVues.add(cle);
        if (!o.cats) dernierChargement = [lat, lng];
        definirEtatRechercheVersionne("overpass", SEARCH_STATES.SUCCESS, generation);
        if (r.lieux.length) {
          sourceExploitable = true;
          fusionner(r.lieux);
          if (!o.cats) ecrireCacheLieux(lat, lng, r.lieux);
          PERF.jalon("fresh_pois_ready");
        }
      } else {
        if (!r || r.raison !== "annule") overpassEchecsConsecutifs += 1;
        definirEtatRechercheVersionne("overpass", SEARCH_STATES.OVERPASS_UNAVAILABLE, generation);
      }
      PERF.jalon("overpass_done");
      try {
        const fin = "zone:osm:" + generation.id;
        performance.mark(fin);
        performance.measure("lieux OpenStreetMap", marqueDebut, fin);
      } catch (e) {
      }
    })
  ];
  if (!o.cats && !o.osmSeulement) travaux.push(
    avecDelai(lieuxDatatourisme(lat, lng, signal), ZONE_DELAI_SOURCE_MS, [], signal).then((r) => {
      if (!generationCourante(generation) || !r || !r.length) return;
      sourceExploitable = true;
      fusionner(r, "datatourisme");
      PERF.jalon("datatourisme_done");
    })
  );
  if (!o.cats && !o.osmSeulement) travaux.push(
    avecDelai(decouvertesAncrees(lat, lng, signal), ZONE_DELAI_MODELE_MS, [], signal).then((r) => {
      if (!generationCourante(generation) || !r || !r.length) return;
      fusionner(r, "external");
      PERF.jalon("decouvertes_done");
    })
  );
  if (!o.cats && !o.osmSeulement && large) travaux.push(
    avecDelai(notesGoogle(lat, lng, { signal }), ZONE_DELAI_SOURCE_MS, [], signal).then((f) => {
      if (!generationCourante(generation) || !f || !f.length) return;
      sourceExploitable = true;
      greffeNotes(lieux, f);
      ajouterLieuxGoogle(f);
      PERF.jalon("google_pret");
    })
  );
  if (!o.cats && !o.osmSeulement) travaux.push(
    avecDelai(chargerCoucheSupabase(lat, lng), ZONE_DELAI_SOURCE_MS, null, signal).then((couche) => {
      if (!generationCourante(generation) || !couche) return;
      if ((couche.publications || []).length) {
        sourceExploitable = true;
        PERF.jalon("supabase_publications_ready");
      }
      if ((couche.evenements || []).length) {
        sourceExploitable = true;
        PERF.jalon("supabase_evenements_ready");
      }
    })
  );
  let promesse;
  promesse = Promise.allSettled(travaux).finally(() => {
    if (chargementsZone.get(cle) === promesse) chargementsZone.delete(cle);
    chargementEnCours = chargementsZone.size > 0;
    if (generationCourante(generation)) {
      if (!o.osmSeulement) definirEtatRechercheVersionne("places", sourceExploitable || lieux.length ? SEARCH_STATES.SUCCESS : SEARCH_STATES.EMPTY, generation);
      terminerGeneration(generation);
    }
  });
  promesse.generation = generation;
  chargementsZone.set(cle, promesse);
  return promesse;
}
function categoriesProbables() {
  const comptees = personnalisation && PROFIL && PROFIL.categories || {};
  const parUsage = Object.keys(comptees).sort((a, b) => comptees[b] - comptees[a]);
  const parDefaut = BESOINS_PRINCIPAUX.flatMap((b) => b.sous ? b.sous.flatMap((x) => x.cats) : []);
  const parFavoris = [...favorisEnMemoire.values()].map((l) => l && l.cat).filter(Boolean);
  return [.../* @__PURE__ */ new Set([...parFavoris, ...parUsage, ...parDefaut])];
}
let prechargementFait = false;
let prechargementEnCours = false;
const PRECHARGEMENT_CATEGORIES_MAX = 2;
function prechargerCategories() {
  if (prechargementFait || prechargementEnCours || !map || overpassEchecsConsecutifs > 0) return;
  const transports = /* @__PURE__ */ new Set(["bus", "metro", "tram", "train"]);
  const manquantes = categoriesProbables().filter((c) => !transports.has(c) && !categorieEnMemoire(c)).slice(0, PRECHARGEMENT_CATEGORIES_MAX);
  if (!manquantes.length) return;
  prechargementEnCours = true;
  chargerPourCats(manquantes).then(() => {
    prechargementFait = manquantes.some((c) => categorieEnMemoire(c));
    if (prechargementFait) PERF.jalon("fresh_pois_ready");
  }).finally(() => {
    prechargementEnCours = false;
  });
}
function chargerPourCats(cats) {
  if (!map || !cats || !cats.length) return Promise.resolve([]);
  const manquantes = cats.filter((c2) => !categorieEnMemoire(c2));
  if (!manquantes.length) return Promise.resolve([]);
  const c = map.getCenter();
  return chargerZone(c.lat, c.lng, { cats: manquantes });
}
const chargementsTemporaires = /* @__PURE__ */ new Map();
const derniersChargementsTemporaires = /* @__PURE__ */ new Map();
function chargerDonneesTemporaires(lat, lng, opts) {
  const o = opts || {};
  const cle = lat.toFixed(2) + "," + lng.toFixed(2);
  if (!o.force && chargementsTemporaires.has(cle)) return chargementsTemporaires.get(cle);
  const dernier = derniersChargementsTemporaires.get(cle) || 0;
  if (!o.force && Date.now() - dernier < 5 * 60 * 1e3) return Promise.resolve([]);
  const generation = nouvelleGeneration("donnees:temporaires", cle, !!o.force);
  prendreEtatRecherche("events", generation);
  if (generationCourante(generation)) {
    definirEtatRechercheVersionne("events", SEARCH_STATES.LOADING_EVENTS, generation);
    charge("Recherche des \xE9v\xE9nements autour de ce point\u2026");
  }
  let sourceExploitable = false;
  const travaux = [
    evenementsOpenAgenda(lat, lng).then((ev) => {
      if (!generationCourante(generation) || !Array.isArray(ev)) return;
      sourceExploitable = true;
      if (ev.length) fusionner(ev, "external");
    })
  ];
  travaux.push(
    chargerCoucheSupabase(lat, lng).then((couche) => {
      if (!generationCourante(generation) || !couche) return;
      sourceExploitable = couche.okPublications || couche.okEvenements || !!couche.depuisCache || sourceExploitable;
    })
  );
  let promesse;
  promesse = Promise.allSettled(travaux).then((resultats) => {
    if (!generationCourante(generation)) return;
    const erreurs = resultats.filter((x) => x.status === "rejected").length;
    if (erreurs === resultats.length) definirEtatRechercheVersionne("events", SEARCH_STATES.NETWORK_ERROR, generation);
    else if (erreurs) definirEtatRechercheVersionne("events", SEARCH_STATES.PARTIAL_ERROR, generation);
    else definirEtatRechercheVersionne("events", SEARCH_STATES.SUCCESS, generation);
    if (sourceExploitable) derniersChargementsTemporaires.set(cle, Date.now());
  }).finally(() => {
    if (chargementsTemporaires.get(cle) === promesse) chargementsTemporaires.delete(cle);
    if (generationCourante(generation)) {
      charge(null);
      planifierRendu({ accueil: true, feuille: true });
      terminerGeneration(generation);
    }
  });
  chargementsTemporaires.set(cle, promesse);
  return promesse;
}
function chargerAutourDuPoint(lat, lng, opts) {
  const o = opts || {};
  return Promise.allSettled([
    chargerZone(lat, lng, { force: !!o.force }),
    chargerDonneesTemporaires(lat, lng, { force: !!o.force })
  ]);
}
const chargementsEditoriaux = /* @__PURE__ */ new Map();
function chargerEditorial(type) {
  if (!map) return Promise.resolve([]);
  const c = map.getCenter();
  const cle = type + ":" + c.lat.toFixed(2) + "," + c.lng.toFixed(2);
  if (chargementsEditoriaux.has(cle)) return chargementsEditoriaux.get(cle);
  const cats = type === "family" ? ["cinema", "parc", "terrain", "musee", "biblio"] : type === "cinema" ? ["cinema"] : [];
  charge(type === "family" ? "Recherche des sorties en famille\u2026" : type === "cinema" ? "Recherche des cin\xE9mas et projections\u2026" : "Recherche des \xE9v\xE9nements autour de toi\u2026");
  const travaux = [chargerDonneesTemporaires(c.lat, c.lng)];
  if (cats.length) travaux.push(chargerZone(c.lat, c.lng, { cats }));
  const promesse = Promise.allSettled(travaux).finally(() => {
    chargementsEditoriaux.delete(cle);
    charge(null);
    rendre();
    majAccueil();
    majFeuille2();
  });
  chargementsEditoriaux.set(cle, promesse);
  return promesse;
}
function positionServeur() {
  try {
    const brut = (document.cookie.match(/(?:^|;\s*)autour_geo=([^;]*)/) || [])[1];
    if (!brut) return null;
    const o = JSON.parse(decodeURIComponent(brut));
    if (!o || !Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return null;
    if (Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) return null;
    return o;
  } catch (e) {
    return null;
  }
}
function positionMemorisee() {
  try {
    const v = JSON.parse(localStorage.getItem("autour:position") || "null");
    if (v && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180) return v;
  } catch (e) {
  }
  return null;
}
function positionLocaleDeTest() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
  const valeur = new URLSearchParams(location.search).get("testPosition");
  if (!valeur) return null;
  const [lat, lng] = valeur.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}
function memoriserPosition(c, source) {
  if (source !== "gps") return false;
  try {
    localStorage.setItem("autour:position", JSON.stringify(c));
    return true;
  } catch (e) {
    return false;
  }
}
const CLE_GEO_OK = "autour:geo-autorisee";
function noterAutorisationGeo(ok) {
  try {
    if (ok) localStorage.setItem(CLE_GEO_OK, "1");
    else localStorage.removeItem(CLE_GEO_OK);
  } catch (e) {
  }
}
function geoDejaAutorisee() {
  try {
    return localStorage.getItem(CLE_GEO_OK) === "1";
  } catch (e) {
    return false;
  }
}
async function permissionPosition() {
  if (!navigator.geolocation) return "absent";
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p && p.state) return p.state;
    }
  } catch (e) {
  }
  return geoDejaAutorisee() ? "granted" : "prompt";
}
const enAttenteDeCarte = [];
const ATTENTE_CARTE_MAX = 12;
function surLaCarte(action, cle) {
  if (map) {
    try {
      action(map);
    } catch (e) {
      console.error("Autour \xB7 carte :", e);
    }
    return true;
  }
  if (cle) {
    for (let i = enAttenteDeCarte.length - 1; i >= 0; i -= 1)
      if (enAttenteDeCarte[i].cle === cle) enAttenteDeCarte.splice(i, 1);
  }
  enAttenteDeCarte.push({ action, cle });
  while (enAttenteDeCarte.length > ATTENTE_CARTE_MAX) enAttenteDeCarte.shift();
  return false;
}
function rejouerSurLaCarte() {
  const file = enAttenteDeCarte.splice(0, enAttenteDeCarte.length);
  file.forEach(({ action }) => {
    try {
      action(map);
    } catch (e) {
      console.error("Autour \xB7 carte diff\xE9r\xE9e :", e);
    }
  });
}
function allerVers(coords, zoom, opts) {
  const lat = coords && Number(coords[0]), lng = coords && Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return surLaCarte((m) => {
    const z = typeof zoom === "function" ? zoom(m) : zoom;
    m.flyTo([lat, lng], z == null ? m.getZoom() : z, Object.assign({ duration: 0.7 }, opts));
  }, "deplacement");
}
function cadrerSur(bornes, opts) {
  if (!bornes) return false;
  return surLaCarte((m) => m.fitBounds(bornes, opts), "deplacement");
}
function zoomCarte(defaut) {
  return map ? map.getZoom() : defaut == null ? 16 : defaut;
}
function pointCarte() {
  if (map) return map.getCenter();
  const p = positionMoi || [0, 0];
  return { lat: p[0], lng: p[1] };
}
function effacerLignes() {
  const fournisseurGoogle = window.AutourMapProviders && AutourMapProviders.googleMaps;
  if (fournisseurGoogle && fournisseurGoogle.effacerItineraire) fournisseurGoogle.effacerItineraire();
  const couches = ligneCouches;
  ligneCouches = [];
  if (!couches.length) return;
  surLaCarte((m) => couches.forEach((c) => {
    try {
      m.removeLayer(c);
    } catch (e) {
    }
  }));
}
function centreCarte() {
  if (!map) return positionMoi;
  const c = map.getCenter();
  return [c.lat, c.lng];
}
let carteEnAttente = null;
const CSS_CARTE_ATTENTE_MAX = 3e3;
function lienStyleCarte() {
  return document.querySelector("link[data-leaflet-css]");
}
function styleCartePret() {
  const lien = lienStyleCarte();
  if (!lien) return true;
  return lien.media === "all";
}
window.AutourCarteRemesurer = () => {
  try {
    if (map) map.invalidateSize();
    else installerCarte();
  } catch (e) {
    console.error("Autour \xB7 carte :", e);
  }
};
setTimeout(() => {
  const lien = lienStyleCarte();
  if (lien && lien.media !== "all") {
    journal.warn("Feuille Leaflet lente : la carte s'installe sans attendre");
    lien.media = "all";
  }
  window.AutourCarteRemesurer();
}, CSS_CARTE_ATTENTE_MAX);
function installerCarte() {
  if (map || typeof L === "undefined" || !carteEnAttente) return false;
  if (!styleCartePret()) return false;
  const { centre, partage } = carteEnAttente;
  carteEnAttente = null;
  PERF.jalon("map_init_debut");
  map = L.map("map", { zoomControl: false, attributionControl: false, tap: false, preferCanvas: true }).setView(centre, partage ? 17 : 16);
  const fournisseurGoogle = window.AutourMapProviders && AutourMapProviders.googleMaps;
  if (fournisseurGoogle && fournisseurGoogle.estActif()) fournisseurGoogle.lierLeaflet(map);
  map.createPane("villePane");
  map.getPane("villePane").style.zIndex = 200;
  map.createPane("ruesPane");
  map.getPane("ruesPane").style.zIndex = 350;
  map.getPane("ruesPane").style.pointerEvents = "none";
  map.createPane("itinerairePane");
  map.getPane("itinerairePane").style.zIndex = 450;
  map.getPane("itinerairePane").style.pointerEvents = "none";
  PERF.jalon("map_ready");
  PERF.mesure("carte", "map_init_debut", "map_ready");
  coucheVille = L.layerGroup().addTo(map);
  moi = L.marker(positionMoi, {
    icon: L.divIcon({
      className: "mk mk-user",
      html: '<span class="moi-in"><i></i><b></b></span>',
      iconSize: [46, 46],
      iconAnchor: [23, 23]
    }),
    interactive: true,
    keyboard: true,
    title: "Vous \xEAtes ici",
    zIndexOffset: 400
  }).addTo(map);
  moi.on("click", () => toast("Vous \xEAtes ici"));
  document.body.classList.toggle("loin", map.getZoom() < 15);
  let minuteurRendu;
  let empreinteVue = null;
  const empreinteDeLaVue = () => {
    const c = map.getCenter();
    return c.lat.toFixed(3) + "," + c.lng.toFixed(3) + "@" + map.getZoom();
  };
  map.on("moveend zoomend", () => {
    const fournisseurGoogleActif = window.AutourMapProviders && AutourMapProviders.googleMaps;
    if (fournisseurGoogleActif) fournisseurGoogleActif.synchroniserDepuisLeaflet(map);
    document.body.classList.toggle("loin", map.getZoom() < 15);
    if (fournisseurGoogleActif && fournisseurGoogleActif.enGeste && fournisseurGoogleActif.enGeste())
      return;
    majEpaisseurs();
    majEtiquettes();
    majBoutons();
    planifierCollisions();
    clearTimeout(minuteurRendu);
    minuteurRendu = setTimeout(() => {
      const vue = empreinteDeLaVue();
      if (vue === empreinteVue) return;
      empreinteVue = vue;
      rendre();
      const c = map.getCenter();
      chargerZone(c.lat, c.lng);
      chargerDonneesTemporaires(c.lat, c.lng);
      if (catsActives) chargerPourCats([...catsActives]);
      planifierRendu({ accueil: true, feuille: true });
      reevaluerTerritorial();
    }, 350);
  });
  map.on("click", () => {
    if (feuilleNiveau !== null) fermerFeuille2();
  });
  window.addEventListener("autour:google-map-click", () => {
    if (feuilleNiveau !== null) fermerFeuille2();
  });
  rejouerSurLaCarte();
  planifierRendu({ carte: true });
  const [lat, lng] = positionMoi;
  (promesseCarteGoogle || Promise.resolve(false)).then((googleActif) => {
    const fournisseur = window.AutourMapProviders && AutourMapProviders.googleMaps;
    if (googleActif && fournisseur && fournisseur.estActif && fournisseur.estActif()) return;
    return remettreFondAutonome();
  });
  return true;
}
function attendreLeaflet() {
  if (map) return true;
  if (installerCarte()) return true;
  let balise = document.querySelector("script[data-leaflet]");
  if (!balise) {
    balise = document.createElement("script");
    balise.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    balise.async = true;
    balise.dataset.leaflet = "";
    document.head.appendChild(balise);
  }
  if (balise.dataset.autourEcoute === "1") return;
  balise.dataset.autourEcoute = "1";
  balise.addEventListener("load", () => {
    installerCarte();
  });
  balise.addEventListener("error", () => {
    carteEnAttente = null;
    journal.warn("Leaflet indisponible : Autour continue sans carte");
    toast("Carte indisponible \xB7 les propositions restent affich\xE9es");
  });
}
async function demarrer(coords) {
  PERF.jalon("boot_debut");
  const duServeur = coords ? null : positionServeur();
  if (coords) {
    originePosition = "gps";
    precisionPosition = "point";
    positionMoi = coords;
    PERF.jalon("position_gps_memorisee");
  } else if (duServeur) {
    originePosition = "server";
    precisionPosition = "ville";
    positionMoi = [duServeur.lat, duServeur.lng];
    if (duServeur.ville) commune = duServeur.ville;
    PERF.jalon("position_server");
  } else {
    originePosition = null;
    precisionPosition = null;
    positionMoi = [48.8566, 2.3522];
  }
  PERF.jalon("position_" + (originePosition || "inconnue"));
  const partage = lieuPartage();
  const centre = partage && partage.lat != null ? [partage.lat, partage.lng] : positionMoi;
  carteEnAttente = { centre, partage };
  attendreLeaflet();
  apresPeinture(() => preparerCarteGoogle(centre, partage ? 17 : 16));
  ["#appHeader", "#navBas", "#btnAide", "#btnTransports", "#attribution"].forEach((s) => $(s).hidden = false);
  PERF.jalon("ui_ready");
  majEnteteLieu();
  mesurerHeader();
  if (CTX && !zoneActive) definirZoneActive(CTX.zoneMoi(positionMoi, commune));
  const rapide = lireJeuRapide(positionMoi[0], positionMoi[1]);
  if (rapide) {
    if (rapide.commune) commune = rapide.commune;
    fusionner(rapide.lieux, "permanent", { silencieux: true });
    selectionAccueil = rapide.choisis;
  }
  dessinerFiltres();
  majRaccourcis();
  majFiltres();
  if (feuilleNiveau === null && !modeNav && !modePose) {
    if (rapide) ouvrirFeuille2("racine");
    else ouvrirAccueilFeuille();
  }
  if (rapide) {
    PERF.jalon("premier_lieu");
    PERF.jalon("source_locale");
  }
  if (!rapide && positionMoi) demarrerSurZonePrecalculee(positionMoi[0], positionMoi[1]);
  apresPeinture(() => chargerLeDemarrage(rapide));
  prechargerEcrans();
  amorcerPourToi();
  if (TERR) apresPeinture(() => {
    chargerContextesTerritoriaux().then(() => {
      if (majContexteTerritorial() || boutonTerritorial()) planifierRendu({ accueil: true, feuille: true });
    }).catch(() => {
    });
  });
}
function demarrerSurZonePrecalculee(lat, lng) {
  const generation = nouvelleGeneration("zone:precalculee", lat.toFixed(2) + "," + lng.toFixed(2));
  lieuxDeZone(lat, lng).then((depart) => {
    if (!generationCourante(generation) || !depart || !depart.length) return;
    if (lieux.length) return;
    fusionner(depart);
    PERF.jalon("source_locale");
    PERF.jalon("premier_lieu");
    charge(null);
  }).catch(() => {
  }).finally(() => terminerGeneration(generation));
}
function precalculPourZone(lat, lng, portee) {
  lieuxDeZone(lat, lng).then((depart) => {
    if (!porteeValide(portee) || !depart || !depart.length) return;
    if (lieux.some(dansZoneActive)) return;
    fusionner(depart);
    PERF.jalon("hub_zone_demandee");
    planifierRendu({ accueil: true, carte: true, feuille: true });
  }).catch(() => {
  });
}
function avecDelai(promesse, ms, valeur, signal) {
  return new Promise((resolve) => {
    let fini = false;
    const terminer = (resultat) => {
      if (fini) return;
      fini = true;
      clearTimeout(t);
      resolve(resultat);
    };
    const t = setTimeout(() => terminer(valeur), ms);
    if (signal) signal.addEventListener("abort", () => terminer(valeur), { once: true });
    Promise.resolve(promesse).then(terminer, () => terminer(valeur));
  });
}
function chargerLeDemarrage(rapide) {
  const [lat, lng] = positionMoi;
  const generation = nouvelleGeneration("demarrage", lat.toFixed(3) + "," + lng.toFixed(3));
  const signal = generation.signal;
  prendreEtatRecherche("places", generation);
  attendreLeaflet();
  if (positionConnue()) detecterVille(lat, lng);
  dernierNom = [lat, lng];
  definirEtatRechercheVersionne("places", SEARCH_STATES.LOADING_PLACES, generation);
  if (rapide) majSignalMaj(true);
  else charge("Recherche autour de toi\u2026");
  const enCache = lireCacheProche(lat, lng);
  PERF.jalon("cache_lu");
  if (enCache && enCache.length) {
    fusionner(enCache);
    charge(null);
    PERF.jalon("cached_pois_visible");
    PERF.jalon("source_locale");
    PERF.jalon("premier_lieu");
  }
  const sourcePrete = (nom) => {
    if (!generationCourante(generation)) return false;
    charge(null);
    definirEtatRechercheVersionne("places", SEARCH_STATES.SUCCESS, generation);
    PERF.jalon(nom);
    PERF.jalon("premier_lieu");
    planifierRendu({ accueil: true, carte: true, filtres: true });
    return true;
  };
  const travaux = [
    avecDelai(nomCommune(lat, lng), 2500, null, signal).then((n) => {
      if (generationCourante(generation) && n) commune = n;
    }),
    avecDelai(notesGoogle(lat, lng, { signal }), 4e3, [], signal).then((fiches) => {
      if (!generationCourante(generation) || !fiches || !fiches.length) return;
      greffeNotes(lieux, fiches);
      ajouterLieuxGoogle(fiches);
      sourcePrete("google_pret");
    }),
    avecDelai(lieuxDatatourisme(lat, lng, signal), 4e3, [], signal).then((reels) => {
      if (!generationCourante(generation) || !reels || !reels.length) return;
      fusionner(reels, "datatourisme");
      sourcePrete("datatourisme_done");
    }),
    /* Au démarrage à froid, la couche territoriale est une seule opération :
       cache éventuel d'abord, deux RPC parallèles ensuite, une publication.
       Les autres chemins du démarrage partagent exactement cette promesse. */
    avecDelai(chargerCoucheSupabase(lat, lng), 4500, null, signal).then((couche) => {
      if (!generationCourante(generation) || !couche) return;
      if ((couche.publications || []).length)
        PERF.jalon("supabase_publications_ready");
      if ((couche.evenements || []).length)
        PERF.jalon("supabase_evenements_ready");
      if ((couche.publications || []).length || (couche.evenements || []).length)
        sourcePrete("supabase_pret");
    }),
    avecDelai(connecter().then(() => Promise.allSettled([rafraichirCanaux(), chargerFavoris()])), 4500, [], signal).then(() => {
      if (generationCourante(generation)) PERF.jalon("supabase_pret");
    })
  ];
  Promise.allSettled(travaux).then(() => {
    if (!generationCourante(generation)) return;
    definirEtatRechercheVersionne("places", lieux.length ? SEARCH_STATES.SUCCESS : SEARCH_STATES.EMPTY, generation);
    majSignalMaj(false);
    charge(null);
    PERF.jalon("demarrage_termine");
    PERF.mesure("d\xE9marrage", "boot_debut", "demarrage_termine");
    PERF.finDemarrage();
    terminerGeneration(generation);
    setTimeout(() => {
      if (positionMoi && distanceM(lat, lng, positionMoi[0], positionMoi[1]) < 500)
        quandLibre(() => prechargerCategories());
    }, 8e3);
  });
  setTimeout(() => {
    if (positionMoi && distanceM(lat, lng, positionMoi[0], positionMoi[1]) < 500)
      quandLibre(() => chargerDonneesTemporaires(lat, lng, { sansPublications: true }));
  }, 5e3);
  chargerZone(lat, lng, {
    sansCarte: true,
    osmSeulement: true,
    delai: OVERPASS_DELAI_BOOT,
    reglages: { rayon: RAYON_BOOT, limite: PLAFOND_BOOT }
  });
}
const ECART_HORS_ZONE = 1200;
function carteHorsPosition() {
  if (!map || !positionMoi) return false;
  if (rechercheGeo) return true;
  const c = map.getCenter();
  return distanceM(positionMoi[0], positionMoi[1], c.lat, c.lng) > ECART_HORS_ZONE;
}
function majBoutons() {
  const retour = $("#btnAutourDeMoi");
  if (retour) retour.hidden = !map || modePose || modeNav || !carteHorsPosition();
}
try {
  localStorage.removeItem("autour:masquees");
} catch (e) {
}
let catsActives = null;
let filtreMaintenant = true;
let filtresHumains = /* @__PURE__ */ new Set();
const FILTRES_HUMAINS = [
  { id: "ouvert", label: "Ouvert", test: (l) => {
    const d = dispoDe(l);
    return d ? d.isOpenNow : l.ouvert === true;
  } },
  { id: "proche", label: "< 15 min \xE0 pied", test: (l, d) => d < 1200 },
  { id: "gratuit", label: "Gratuit", test: (l) => l.gratuit !== false && (l.prixN == null || l.prixN <= 1) },
  { id: "budget", label: "Petit budget", test: (l) => l.prixN != null && l.prixN <= 1 },
  { id: "famille", label: "En famille", test: (l) => correspondCategorie(l, "family") || FAMILY_CATEGORIES.some((c) => correspondCategorie(l, c)) },
  { id: "etudier", label: "\xC9tudier", cats: ["biblio", "coworking", "cafe"] },
  { id: "monde", label: "Rencontrer", cats: ["event", "concert", "bar", "asso", "terrain", "popup", "studio", "sport", "rencontre"] },
  { id: "libre", label: "Sans r\xE9servation", cats: [
    "parc",
    "biblio",
    "marche",
    "fastfood",
    "cafe",
    "commerce",
    "friperie",
    "toilettes",
    "terrain",
    "musee",
    "velo"
  ] },
  { id: "pmr", label: "Accessible PMR", test: (l) => l.pmr === true }
].map((f) => f.cats ? Object.assign(f, { test: (l) => f.cats.some((c) => correspondCategorie(l, c)) }) : f);
const CONTRAINTES = ["ouvert", "proche", "gratuit", "budget"];
const SUGGESTIONS_INTENTION = [
  { emoji: "\u{1F374}", label: "Manger" },
  { emoji: "\u{1F389}", label: "Sortir" }
];
const CRENEAUX = [
  { id: "maintenant", label: "Maintenant" },
  { id: "soir", label: "Ce soir", heure: 19 },
  { id: "weekend", label: "Ce week-end", heure: 16, weekend: true },
  { id: "avenir", label: "\xC0 venir" }
];
const SECTIONS_DU_CRENEAU = Object.freeze({
  maintenant: ["maintenant"],
  soir: ["ce_soir"],
  weekend: ["ce_week_end", "ce_soir"],
  avenir: ["aujourdhui", "a_venir"]
});
let creneau = "maintenant";
function instantCreneau() {
  const c = CRENEAUX.find((x) => x.id === creneau) || CRENEAUX[0];
  const d = /* @__PURE__ */ new Date();
  if (c.weekend) {
    const jour = d.getDay();
    if (jour !== 0 && jour !== 6) d.setDate(d.getDate() + (6 - jour));
  }
  if (c.heure != null) {
    d.setHours(c.heure, 0, 0, 0);
    if (d.getTime() < Date.now()) return /* @__PURE__ */ new Date();
  }
  return d;
}
function contexteSaison(quand) {
  if (!SIGNAUX) return null;
  const d = new Date(quand == null ? Date.now() : quand);
  return SIGNAUX.contexteSaison(d, !!vacancesScolaires(d));
}
const SCOLAIRE_FERME = /\b(college|coll[èe]ge|lyc[ée]e|[ée]cole|groupe scolaire|primaire|maternelle|cr[èe]che)\b/i;
function scolaireNonAccessible(l) {
  if (!l || l.cat !== "ecole") return false;
  const nom = String(l.titre || "");
  if (/\b(universit|iut\b|campus|sup[ée]rieur|grande [ée]cole|institut)/i.test(nom)) return false;
  return SCOLAIRE_FERME.test(nom) || !nom;
}
function horsService(l, quand) {
  if (!l || l.cat !== "ecole") return false;
  if (scolaireNonAccessible(l)) return true;
  return !!vacancesScolaires(new Date(quand == null ? Date.now() : quand));
}
function sectionDe(l, quand) {
  const t = quand == null ? Date.now() : quand;
  return TEMPS.sectionTemporelle(statutTemps(l, t), t);
}
function statutTemps(l, quand) {
  return TEMPS.statutTemporel(
    l,
    quand == null ? Date.now() : quand,
    { disponibilite: (x, t) => dispoDe(x, null, t) }
  );
}
function estVivant(l) {
  const t = instantCreneau().getTime();
  if (estTemporaire(l)) {
    if (creneau === "maintenant") return TEMPS.estMaintenant(statutTemps(l, t).statut);
    const sections = SECTIONS_DU_CRENEAU[creneau] || [];
    return sections.includes(sectionDe(l));
  }
  return creneau === "maintenant" ? !estFerme(l) : true;
}
function visibles() {
  return groupLogicalPlaces(visiblesBruts(), distanceM);
}
function visiblesBruts() {
  const q = recherche.trim().toLowerCase();
  if (Array.isArray(selectionAccueil) && !modeAide && !catsActives && !filtreMaintenant && !q)
    return lieux.filter((l) => selectionAccueil.includes(l.id) && dansZoneActive(l));
  const [mLat, mLng] = centreZoneActive() || positionMoi || [0, 0];
  const epingles = idsEpingles();
  return lieux.filter((l) => {
    if (!dansZoneActive(l)) return false;
    if (epingles.length && epingles.includes(l.id)) return true;
    if (!nomExploitable(l)) return false;
    if (catsActives && !correspondUneCategorie(l, catsActives)) return false;
    if (!catsActives && filtreActif !== "tout" && !correspondCategorie(l, filtreActif)) return false;
    if (filtreMaintenant && !estVivant(l)) return false;
    if (filtresHumains.size) {
      const d = distanceM(mLat, mLng, l.lat, l.lng);
      for (const f of FILTRES_HUMAINS)
        if (filtresHumains.has(f.id) && !f.test(l, d)) return false;
    }
    if (!q) return true;
    return (l.titre + " " + l.adresse + " " + (l.cuisine || "")).toLowerCase().includes(q);
  });
}
function heureLocale(ts, l) {
  const tz = l && (l.timezone || l.timeZone) || window.AutourAvailability && window.AutourAvailability.DEFAULT_TIMEZONE || void 0;
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}
let lieuEnAvant = null;
function mettreEnAvant(id) {
  lieuEnAvant = id || null;
  document.body.classList.toggle("focus-lieu", !!lieuEnAvant);
  marqueurs.forEach((m, cle) => {
    const el = m && m.getElement && m.getElement();
    if (el) el.classList.toggle("en-avant", !!lieuEnAvant && cle === lieuEnAvant);
  });
}
function ouvrirPileCompacte(g) {
  if (!Array.isArray(g) || !g.length) return;
  const f = $("#ficheCompacte");
  if (!f) return;
  mettreEnAvant(g[0].id);
  if (!responsiveLayoutState.isDesktop && feuilleNiveau !== null)
    reglerEtatFeuille("reduite");
  const t = Date.now();
  const ligne = (l) => {
    const c = categorieAffichee(l);
    const etat2 = statutTemps(l, t);
    const quand = l.annule ? "Annul\xE9" : TEMPS.libelleTemporel(l, t, { disponibilite: (x, q) => dispoDe(x, null, q), statut: etat2 });
    const dist = positionPrecise() ? formatDist(distanceDepuisZone(l)) : "";
    return '<button class="pl-l" data-pile="' + esc(l.id) + '"><span class="pl-rond" style="background:' + (COULEURS_CAT[l.cat] || "#5D6B63") + '">' + c.emoji + '</span><span class="pl-txt"><b>' + esc(l.titre) + "</b><i>" + esc([quand, dist].filter(Boolean).join(" \xB7 ")) + '</i></span><span class="pl-fl" aria-hidden="true">\u203A</span></button>';
  };
  const lieu = g[0].adresse || g[0].cp || "";
  f.innerHTML = '<div class="pl-tete"><b>' + g.length + " \xE9v\xE9nements ici</b>" + (lieu ? "<span>" + esc(lieu) + "</span>" : "") + '</div><div class="pl-liste">' + g.map(ligne).join("") + "</div>";
  f.hidden = false;
  f.querySelectorAll("[data-pile]").forEach((b) => b.onclick = () => {
    const l = g.find((x) => x.id === b.dataset.pile);
    if (!l) return;
    fermerFicheCompacte();
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(l.id));
  });
}
function fermerFicheCompacte() {
  const f = $("#ficheCompacte");
  if (f) {
    f.hidden = true;
    f.innerHTML = "";
  }
  mettreEnAvant(null);
}
function sousTitreMarqueur(l) {
  const heure = (t) => heureLocale(t, l);
  const eta = positionPrecise() ? l.rankEta : null;
  const trajet = eta && Number.isFinite(eta.minutes) ? eta.minutes + " min" : "";
  if (estTemporaire(l)) {
    const etat2 = statutTemps(l);
    const libelle = TEMPS.libelleTemporel(
      l,
      Date.now(),
      { disponibilite: (x, t) => dispoDe(x, null, t), statut: etat2 }
    );
    if (libelle) return "<span" + (etat2.statut === TEMPS.STATUTS.EN_COURS ? ' class="ouvre"' : "") + ">" + esc(libelle) + (trajet ? " \xB7 " + trajet : "") + "</span>";
  }
  if (l.startsAt && l.startsAt > Date.now())
    return "<span>" + heure(l.startsAt) + (trajet ? " \xB7 " + trajet : "") + "</span>";
  const d = dispoDe(l);
  if (d && d.status === "open" && d.closesAtTime)
    return '<span class="ouvre">Ouvert jusqu\u2019\xE0 ' + heureFrancaise(d.closesAtTime) + "</span>";
  if (d && (d.status === "closed" || d.status === "opening_soon") && d.opensAtTime)
    return "<span>Ouvre \xE0 " + heureFrancaise(d.opensAtTime) + "</span>";
  return trajet ? "<span>" + trajet + "</span>" : "";
}
function htmlMarqueur(l) {
  const c = categorieAffichee(l);
  if (estTemporaire(l) && !l.annule && TEMPS.estMaintenant(statutTemps(l).statut)) {
    const dist = positionPrecise() ? formatDist(distanceDepuisZone(l)) : "";
    const fin = l.finLe ? heureLocale(l.finLe, l) : "";
    const bas = [dist, fin ? "jusqu\u2019\xE0 " + fin : ""].filter(Boolean).join(" \xB7 ");
    const lieu = l.adresse || l.cp || "";
    return '<span class="mk-in"><div class="evc"><span class="evc-rond" style="background:' + (COULEURS_CAT[l.cat] || "#5D6B63") + '">' + c.emoji + '</span><span class="evc-txt"><b>' + esc(l.titre) + "</b>" + (lieu ? "<i>" + esc(lieu) + "</i>" : "") + (bas ? "<u>" + esc(bas) + "</u>" : "") + "</span></div></span>";
  }
  if (estTemporaire(l)) {
    const tilt = (hash(l.id) % 700 / 100 - 3.5).toFixed(2);
    const envoi = l.envoi === "retard" ? '<span class="a-envoi">Envoi\u2026</span>' : l.envoi === "echec" ? '<span class="a-envoi a-echec">Non publi\xE9 \xB7 R\xE9essayer</span>' : "";
    return '<span class="mk-in"><div class="affiche ' + (l.gratuit ? "gratuit" : "payant") + (l.annule ? " annulee" : "") + (l.envoi === "echec" ? " a-rate" : "") + '" style="--tilt:' + tilt + 'deg"><span class="a-haut"><span>' + c.emoji + "</span><span>" + (l.annule ? "ANNUL\xC9" : l.gratuit ? "GRATUIT" : l.prix + " \u20AC") + "</span>" + (l.places != null && !l.annule ? '<span class="a-places">\xB7 ' + l.places + " pl.</span>" : "") + envoi + '</span><span class="a-titre">' + esc(l.titre) + "</span>" + // un événement sans adresse écrivait littéralement « undefined »
    (l.adresse ? '<span class="a-lieu">' + esc(l.adresse) + "</span>" : "") + "</div></span>";
  }
  const evs = indexEvenements.get(l.titre) || 0;
  const ferme = estFerme(l);
  return '<span class="mk-in"><div class="poi' + (ferme ? " poi-ferme" : "") + '"><span class="poi-rond" style="background:' + (COULEURS_CAT[l.cat] || "#5D6B63") + '">' + c.emoji + (evs ? '<i class="poi-pastille">' + evs + "</i>" : "") + (ferme ? '<i class="poi-ferme-badge">Ferm\xE9</i>' : "") + '</span><span class="poi-eti"><b>' + esc(l.titre) + "</b>" + sousTitreMarqueur(l) + "</span></div></span>";
}
const TAILLE_GRAPPE = 70;
const EPINGLES_PRIORITAIRES = 6;
function grouper(liste) {
  if (map.getZoom() >= 16) return liste.map((l) => ({ seul: l }));
  const epingles = new Set(liste.slice(0, EPINGLES_PRIORITAIRES).map((l) => l.id));
  const seuls = [], cases = /* @__PURE__ */ new Map();
  liste.forEach((l) => {
    if (epingles.has(l.id)) {
      seuls.push({ seul: l });
      return;
    }
    if (!map) {
      seuls.push({ seul: l });
      return;
    }
    const p = map.latLngToLayerPoint([l.lat, l.lng]);
    const cle = Math.round(p.x / TAILLE_GRAPPE) + ":" + Math.round(p.y / TAILLE_GRAPPE);
    if (!cases.has(cle)) cases.set(cle, []);
    cases.get(cle).push(l);
  });
  return seuls.concat([...cases.values()].map((g) => g.length === 1 ? { seul: g[0] } : { grappe: g }));
}
const SEUIL_EMPILEMENT_PX = 24;
function empilerEvenements(items) {
  if (!map) return items;
  const sortie = [], piles = [];
  items.forEach((item) => {
    const l = item.seul;
    if (!l || !estTemporaire(l)) {
      sortie.push(item);
      return;
    }
    const p = map.latLngToLayerPoint([l.lat, l.lng]);
    const proche = piles.find((pile) => Math.abs(pile.p.x - p.x) <= SEUIL_EMPILEMENT_PX && Math.abs(pile.p.y - p.y) <= SEUIL_EMPILEMENT_PX);
    if (proche) proche.membres.push(l);
    else piles.push({ p, membres: [l] });
  });
  piles.forEach((pile) => {
    if (pile.membres.length === 1) sortie.push({ seul: pile.membres[0] });
    else sortie.push({ pile: ordonnerPile(pile.membres) });
  });
  return sortie;
}
function ordonnerPile(membres) {
  const t = Date.now();
  const rang = new Map(derniereSelection.map((x, i) => [x.l.id, i]));
  const cle = (l) => {
    const etat2 = statutTemps(l, t);
    const enCours = TEMPS.estMaintenant(etat2.statut) ? 0 : 1;
    const debut = etat2.debut == null ? Infinity : Math.abs(etat2.debut - t);
    return [enCours, debut, rang.has(l.id) ? rang.get(l.id) : 9999];
  };
  return membres.slice().sort((a, b) => {
    const ka = cle(a), kb = cle(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}
let indexEvenements = /* @__PURE__ */ new Map();
let indexPerime = true;
function majIndexEvenements() {
  if (!indexPerime) return;
  indexPerime = false;
  indexEvenements = /* @__PURE__ */ new Map();
  const permanents = lieux.filter((l) => !estTemporaire(l));
  const pas = 15e-4;
  const grille = /* @__PURE__ */ new Map();
  const cellule = (lat, lng) => Math.floor(lat / pas) + ":" + Math.floor(lng / pas);
  permanents.forEach((p) => {
    const cle = cellule(p.lat, p.lng);
    if (!grille.has(cle)) grille.set(cle, []);
    grille.get(cle).push(p);
  });
  lieux.forEach((e) => {
    if (!estTemporaire(e)) return;
    let proche = null, dMin = 80;
    const cx = Math.floor(e.lat / pas), cy = Math.floor(e.lng / pas);
    const candidats = [];
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++)
      candidats.push(...grille.get(x + ":" + y) || []);
    candidats.forEach((p) => {
      const d = distanceM(e.lat, e.lng, p.lat, p.lng);
      if (d < dMin) {
        dMin = d;
        proche = p;
      }
    });
    if (proche) indexEvenements.set(proche.titre, (indexEvenements.get(proche.titre) || 0) + 1);
  });
}
let derniereSelection = [];
let ecartesAuto = 0;
let regroupesAuto = 0;
const MARQUEURS_AU_REPOS = 6;
function auRepos(ctx) {
  return !ctx.q && !catsActives && filtreActif === "tout" && !filtresHumains.size && !modeAide && !rechercheGeo;
}
function selectionner() {
  const t0 = performance.now();
  const ctx = contexteActuel();
  const brut = visibles();
  const repos = auRepos(ctx);
  const cible = repos ? MARQUEURS_AU_REPOS : ctx.large ? POIDS.PLAFOND_LARGE : POIDS.PLAFOND_SERRE;
  const admis = brut.filter((l) => proposableAuto(l, ctx));
  regroupesAuto = brut.reduce((n, l) => n + ((l.nbRegroupes || 1) - 1), 0);
  let notes = admis.map((l) => {
    const r = scoreLieu(l, ctx);
    return { l, score: r.score, raison: r.raison, niveau: niveauLieu(l, ctx, r.score) };
  });
  const avant = notes.length;
  if (modeAide && !montrerFermes) notes = ecarterFermesSiAlternative(notes);
  ecartesAuto = brut.length - admis.length + (avant - notes.length);
  const explicite = !!(ctx.q || catsActives || filtreActif !== "tout" || filtresHumains.size);
  const retenus = (explicite ? notes : notes.filter((x) => x.niveau !== "C")).sort((a, b) => b.score - a.score).slice(0, cible);
  derniereSelection = retenus;
  if (window.__autourDebug)
    journal.info(
      "[Autour] re\xE7us",
      brut.length,
      "\xB7 \xE9cart\xE9s d'office",
      ecartesAuto,
      "\xB7 regroup\xE9s",
      regroupesAuto,
      "\xB7 retenus",
      retenus.length,
      "\xB7 niveau A",
      notes.filter((x) => x.niveau === "A").length,
      "\xB7 classement",
      (performance.now() - t0).toFixed(1) + " ms",
      "\xB7 meilleur",
      retenus[0] ? retenus[0].l.titre + " (" + Math.round(retenus[0].score) + ", " + retenus[0].raison + ")" : "\u2014"
    );
  return retenus.map((x) => x.l);
}
function raisonDe(id) {
  const x = derniereSelection.find((y) => y.l.id === id);
  return x ? x.raison : "";
}
function majBandeauVide(retenus) {
  const b = $("#bandeauVide");
  if (!b) return;
  const erreurPartielle = etatErreurPartielle();
  const etat2 = etatDonnees(retenus);
  const videReel = etat2 === ETATS_DONNEES.READY_WITHOUT_RESULTS && lieux.length > 0 && !montrerFermes;
  const erreurSansResultat = erreurPartielle && retenus === 0 && feuilleNiveau === null;
  const montrer = (erreurSansResultat || videReel) && !modeNav && $("#bandeauGeo").hidden;
  b.hidden = !montrer;
  if (!montrer) return;
  if (erreurPartielle) {
    $("#videTxt").textContent = "Certains lieux n\u2019ont pas pu \xEAtre charg\xE9s.";
    $("#videOk").textContent = "R\xE9essayer";
    $("#videOk").dataset.action = "retry";
    $("#videOk").hidden = false;
    return;
  }
  $("#videTxt").textContent = ecartesAuto ? "Rien d\u2019ouvert \xE0 proximit\xE9 pour le moment." : "Rien \xE0 afficher dans cette zone.";
  $("#videOk").textContent = "Tout voir";
  $("#videOk").dataset.action = "all";
  $("#videOk").hidden = !ecartesAuto;
}
const MARQUEURS_MAX_DEZOOME = 10;
function limiterMarqueurs(liste) {
  if (!map || map.getZoom() >= 16) return liste;
  const retenus = new Set(liste.slice(0, MARQUEURS_MAX_DEZOOME).map((l) => l.id));
  liste.forEach((l) => {
    if (estTemporaire(l)) retenus.add(l.id);
  });
  return liste.filter((l) => retenus.has(l.id));
}
function empreinteMarqueur(l) {
  return [l.titre, l.cat, l.lat, l.lng, l.ouvert, l.ferme, l.note, l.avis, l.envoi, l.annule].map((v) => v == null ? "" : String(v)).join("|");
}
function rendre() {
  const debutCpu = performance.now();
  PERF.rendus.carte += 1;
  PERF.exposer();
  majBadgeMaintenant();
  if (!map) {
    PERF.travail("rendu_carte", debutCpu);
    return;
  }
  majIndexEvenements();
  if (!rendre.mesure) {
    rendre.mesure = true;
    PERF.jalon("markers_ready");
  }
  if (modeNav) {
    marqueurs.forEach((m) => map.removeLayer(m));
    marqueurs.clear();
    PERF.travail("rendu_carte", debutCpu);
    return;
  }
  const garder = /* @__PURE__ */ new Set();
  const choisis = limiterMarqueurs(selectionner());
  majBandeauVide(choisis.length);
  empilerEvenements(grouper(choisis)).forEach((item) => {
    if (item.seul) {
      const l = item.seul;
      garder.add(l.id);
      const existant = marqueurs.get(l.id);
      if (existant) {
        const empreinte = empreinteMarqueur(l);
        existant._lieu = l;
        if (existant._empreinte !== empreinte) {
          existant._empreinte = empreinte;
          existant._envoi = l.envoi;
          existant.setLatLng([l.lat, l.lng]);
          existant.setIcon(L.divIcon({ className: "mk " + (estTemporaire(l) ? "mk-eph" : "mk-fix"), html: htmlMarqueur(l), iconSize: [0, 0] }));
        }
        return;
      }
      const eph = estTemporaire(l);
      const m2 = L.marker([l.lat, l.lng], {
        icon: L.divIcon({ className: "mk " + (eph ? "mk-eph" : "mk-fix"), html: htmlMarqueur(l), iconSize: [0, 0] }),
        riseOnHover: true,
        zIndexOffset: eph ? 200 : 0
      }).addTo(map);
      m2._lieu = l;
      m2._envoi = l.envoi;
      m2._empreinte = empreinteMarqueur(l);
      m2.on("click", () => {
        const courant = m2._lieu;
        if (courant.envoi === "echec") {
          reessayerPublication(courant.id);
          return;
        }
        mettreAJourProfil("clic", courant.cat);
        ouvrirFicheCompacte(courant);
      });
      marqueurs.set(l.id, m2);
      return;
    }
    if (item.pile) {
      const g2 = item.pile, tete = g2[0];
      const id2 = "pile:" + tete.id + "x" + g2.length;
      garder.add(id2);
      const existant = marqueurs.get(id2);
      if (existant) {
        existant._pile = g2;
        return;
      }
      const m2 = L.marker([tete.lat, tete.lng], {
        icon: L.divIcon({
          className: "mk mk-eph mk-pile",
          html: htmlMarqueur(tete) + '<i class="evc-plus">+' + (g2.length - 1) + "</i>",
          iconSize: [0, 0]
        }),
        riseOnHover: true,
        zIndexOffset: 220
      }).addTo(map);
      m2._pile = g2;
      m2.on("click", () => {
        mettreAJourProfil("clic", tete.cat);
        ouvrirPileCompacte(m2._pile);
      });
      marqueurs.set(id2, m2);
      return;
    }
    const g = item.grappe;
    const lat = g.reduce((s, l) => s + l.lat, 0) / g.length;
    const lng = g.reduce((s, l) => s + l.lng, 0) / g.length;
    const id = "grappe:" + lat.toFixed(4) + "," + lng.toFixed(4) + "x" + g.length;
    garder.add(id);
    if (marqueurs.has(id)) return;
    const parCat = {};
    g.forEach((x) => {
      parCat[x.cat] = (parCat[x.cat] || 0) + 1;
    });
    const dominante = Object.keys(parCat).sort((a, b) => parCat[b] - parCat[a])[0];
    const emo = (CATS[dominante] || {}).emoji || "";
    const m = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "mk",
        html: '<span class="mk-in"><div class="grappe">' + emo + " " + g.length + "</div></span>",
        iconSize: [0, 0]
      }),
      zIndexOffset: 100
    }).addTo(map);
    m.on("click", () => allerVers([lat, lng], (mc) => Math.min(mc.getZoom() + 2, 17), { duration: 0.55 }));
    marqueurs.set(id, m);
  });
  marqueurs.forEach((m, id) => {
    if (!garder.has(id)) {
      map.removeLayer(m);
      marqueurs.delete(id);
    }
  });
  revisionMarqueurs++;
  if (lieuEnAvant) mettreEnAvant(lieuEnAvant);
  planifierCollisions();
  PERF.travail("rendu_carte", debutCpu);
}
let pileEcrans = [];
let typeFeuille = null;
let modeFeuille = "lieu";
let defilementFiche = 0;
let publicationModifiee = false;
let dernierFocusFeuille = null;
let profondeurHistorique = 0;
let ignorerProchainPop = false;
let actionApresAbandon = null;
function pousserEcran(fn) {
  pileEcrans.push(fn);
  fn();
  history.pushState({ autour: true, profondeur: pileEcrans.length }, "", location.href);
  profondeurHistorique++;
}
function basculerModeFeuille(mode) {
  const f = $("#feuille");
  const lieu = $("#ficheLieu");
  const itineraire = $("#ficheItineraire");
  if (!f || !lieu || !itineraire || mode === modeFeuille) return false;
  const versItineraire = mode === "itineraire";
  if (versItineraire) defilementFiche = f.scrollTop;
  modeFeuille = versItineraire ? "itineraire" : "lieu";
  lieu.hidden = versItineraire;
  itineraire.hidden = !versItineraire;
  const pile = f.querySelector("#btnRetour");
  if (pile) pile.hidden = versItineraire;
  f.scrollTop = versItineraire ? 0 : defilementFiche;
  return true;
}
function retourEcran() {
  if (profondeurHistorique > 0) {
    history.back();
    return;
  }
  pileEcrans.pop();
  const precedent = pileEcrans[pileEcrans.length - 1];
  if (precedent) precedent();
  else demanderFermetureFeuille();
}
function ouvrirFeuille(html, options) {
  const o = options || {};
  $("#voile").hidden = false;
  const f = $("#feuille");
  if (f.hidden) dernierFocusFeuille = document.activeElement;
  typeFeuille = o.kind || (typeFeuille === "publication" && pileEcrans.length > 1 ? "publication" : "contenu");
  layerManager.activate(typeFeuille === "publication" ? NOMS_COUCHES.publishModal : NOMS_COUCHES.placeDetails);
  f.setAttribute("aria-label", o.ariaLabel || (typeFeuille === "publication" ? "Publier un \xE9v\xE9nement" : "Panneau Autour"));
  modeFeuille = "lieu";
  defilementFiche = 0;
  const retour = pileEcrans.length > 1 ? '<button class="retour" id="btnRetour">\u2039 Retour</button>' : "";
  f.innerHTML = '<button class="feuille-x" id="feuilleX" aria-label="Fermer">\u2715</button><button class="poignee" aria-label="Fermer"></button>' + retour + html;
  f.hidden = false;
  f.scrollTop = 0;
  f.querySelector("#feuilleX").onclick = () => demanderFermetureFeuille();
  f.querySelector(".poignee").onclick = () => demanderFermetureFeuille();
  const r = f.querySelector("#btnRetour");
  if (r) r.onclick = retourEcran;
  requestAnimationFrame(() => {
    const cible = f.querySelector("input:not([disabled]),button:not([disabled]),select:not([disabled]),textarea:not([disabled])");
    if (cible) cible.focus({ preventScroll: true });
  });
}
function fermerFeuille(options) {
  const o = options || {};
  const profondeur = profondeurHistorique;
  const coucheFermee = typeFeuille === "publication" ? NOMS_COUCHES.publishModal : NOMS_COUCHES.placeDetails;
  pileEcrans = [];
  typeFeuille = null;
  if (!o.preserverPublication) publicationModifiee = false;
  $("#voile").hidden = true;
  $("#feuille").hidden = true;
  $("#abandonVoile").hidden = true;
  layerManager.deactivate(NOMS_COUCHES.confirmationDialog);
  layerManager.deactivate(coucheFermee);
  if (o.nettoyerHistorique !== false && profondeur > 0) {
    profondeurHistorique = 0;
    ignorerProchainPop = true;
    history.go(-profondeur);
  }
  const avaitTrajet = ligneCouches.length > 0;
  effacerLignes();
  if (avaitTrajet) {
    if (vueAvantTrajet) allerVers(vueAvantTrajet.centre, vueAvantTrajet.zoom, { duration: 0.6 });
    else if (positionMoi) allerVers(positionMoi, 16, { duration: 0.6 });
  }
  vueAvantTrajet = null;
  const cible = dernierFocusFeuille;
  dernierFocusFeuille = null;
  requestAnimationFrame(() => {
    const retour = cible && document.contains(cible) && cible.getClientRects().length ? cible : $('[data-nb="creer"]');
    if (retour && !retour.hidden) retour.focus();
  });
}
function afficherConfirmationAbandon(action) {
  actionApresAbandon = action || (() => fermerFeuille());
  const v = $("#abandonVoile");
  v.hidden = false;
  layerManager.activate(NOMS_COUCHES.confirmationDialog);
  $("#abandonContinuer").focus();
}
function demanderFermetureFeuille(action) {
  const fermer = action || (() => fermerFeuille());
  if (typeFeuille === "publication" && publicationModifiee) {
    afficherConfirmationAbandon(fermer);
    return;
  }
  fermer();
}
$("#voile").onclick = () => demanderFermetureFeuille();
$("#feuille").onclick = (e) => e.stopPropagation();
$("#abandonDialog").onclick = (e) => e.stopPropagation();
$("#abandonVoile").onclick = continuerPublication;
$("#abandonContinuer").onclick = continuerPublication;
$("#abandonConfirmer").onclick = () => {
  const action = actionApresAbandon || (() => fermerFeuille());
  actionApresAbandon = null;
  publicationModifiee = false;
  $("#abandonVoile").hidden = true;
  layerManager.deactivate(NOMS_COUCHES.confirmationDialog);
  action();
};
window.addEventListener("popstate", () => {
  if (ignorerProchainPop) {
    ignorerProchainPop = false;
    return;
  }
  if (profondeurHistorique > 0 && !$("#feuille").hidden) {
    profondeurHistorique--;
    if (pileEcrans.length > 1) {
      pileEcrans.pop();
      pileEcrans[pileEcrans.length - 1]();
      return;
    }
    if (typeFeuille === "publication" && publicationModifiee) {
      history.pushState({ autour: true, profondeur: 1 }, "", location.href);
      profondeurHistorique++;
      afficherConfirmationAbandon(() => fermerFeuille());
      return;
    }
    fermerFeuille({ nettoyerHistorique: false });
    return;
  }
  if (ignorerPopFeuilleBesoins) {
    ignorerPopFeuilleBesoins = false;
    return;
  }
  if (historiqueFeuilleBesoins && feuilleNiveau !== null) {
    historiqueFeuilleBesoins = false;
    fermerFeuille2({ nettoyerHistorique: false });
    return;
  }
});
function elementsFocusables(conteneur) {
  return [...conteneur.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hidden && el.getClientRects().length);
}
document.addEventListener("keydown", (e) => {
  const abandonOuvert = !$("#abandonVoile").hidden;
  const feuilleOuverte = !$("#feuille").hidden;
  if (e.key === "Escape") {
    if (abandonOuvert) {
      e.preventDefault();
      continuerPublication();
      return;
    }
    if (feuilleOuverte) {
      e.preventDefault();
      if (pileEcrans.length > 1) retourEcran();
      else demanderFermetureFeuille();
      return;
    }
    if (modeNav) {
      e.preventDefault();
      quitterNav();
      return;
    }
    if (pourToiOuvert()) {
      e.preventDefault();
      fermerPourToi();
      return;
    }
    if (feuilleNiveau !== null) {
      e.preventDefault();
      fermerFeuille2();
      return;
    }
    if (modePose) {
      e.preventDefault();
      fermerModePose();
      return;
    }
    if ($("#rech") && $("#rech").value) {
      e.preventDefault();
      $("#btnFermerRech").click();
    }
    return;
  }
  if (e.key !== "Tab" || !abandonOuvert && !feuilleOuverte) return;
  const conteneur = abandonOuvert ? $("#abandonDialog") : $("#feuille");
  const focusables = elementsFocusables(conteneur);
  if (!focusables.length) {
    e.preventDefault();
    conteneur.focus();
    return;
  }
  const premier = focusables[0], dernier = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === premier) {
    e.preventDefault();
    dernier.focus();
  } else if (!e.shiftKey && document.activeElement === dernier) {
    e.preventDefault();
    premier.focus();
  }
});
let debutBalayageFeuille = null;
const feuilleDetail = $("#feuille");
feuilleDetail.addEventListener("touchstart", (e) => {
  if (e.touches.length > 1) {
    debutBalayageFeuille = null;
    return;
  }
  const t = e.changedTouches[0];
  debutBalayageFeuille = { x: t.clientX, y: t.clientY, scroll: feuilleDetail.scrollTop };
}, { passive: true });
feuilleDetail.addEventListener("touchend", (e) => {
  if (!debutBalayageFeuille) return;
  const depart = debutBalayageFeuille;
  debutBalayageFeuille = null;
  if (depart.scroll > 2) return;
  if (feuilleDetail.scrollTop > 2) return;
  const t = e.changedTouches[0], dy = t.clientY - depart.y;
  const dx = Math.abs(t.clientX - depart.x);
  if (dy > 90 && dx < 70) demanderFermetureFeuille();
}, { passive: true });
feuilleDetail.addEventListener(
  "touchcancel",
  () => {
    debutBalayageFeuille = null;
  },
  { passive: true }
);
function jourDeLaSemaine() {
  return ((/* @__PURE__ */ new Date()).getDay() + 6) % 7;
}
function horaireDuJour(l) {
  if (!l.horaires || !l.horaires.length) return "";
  const ligne = l.horaires[jourDeLaSemaine()] || "";
  return ligne.replace(/^[^:]*:\s*/, "");
}
function libelleHoraires(l) {
  if (estTemporaire(l) && TEMPS && TEMPS.libelleHorairesEvenement) {
    const evenement = TEMPS.libelleHorairesEvenement(l, Date.now());
    if (evenement) return evenement;
  }
  if (estTemporaire(l)) {
    const libelle = TEMPS && TEMPS.libelleTemporel ? TEMPS.libelleTemporel(l, Date.now(), { disponibilite: (x, t) => dispoDe(x, null, t) }) : "";
    if (libelle) return libelle;
    return l.quand || "Bient\xF4t";
  }
  const d = dispoDe(l);
  if (d && d.status !== "unknown" && d.label) return d.label;
  const horaire = horaireDuJour(l);
  if (horaire) return horaire;
  const DISPO = window.AutourAvailability;
  const jour = DISPO && DISPO.journeeFrancaise ? DISPO.journeeFrancaise(l, jourDeLaSemaine()) : null;
  if (jour) return jour === "Ferm\xE9" ? "Ferm\xE9 aujourd\u2019hui" : jour;
  return "Horaires non renseign\xE9s";
}
function horairesSemaine(l) {
  const aujourdhui = jourDeLaSemaine();
  if (l.horaires && l.horaires.length)
    return '<details class="horaires"><summary>Horaires de la semaine</summary>' + l.horaires.map((h, i) => '<div class="h-ligne' + (i === aujourdhui ? " h-jour" : "") + '">' + esc(h) + "</div>").join("") + "</details>";
  const DISPO = window.AutourAvailability;
  const semaine = DISPO && DISPO.semaineFrancaise ? DISPO.semaineFrancaise(l) : null;
  if (!semaine || !semaine.jours.length) return "";
  return '<details class="horaires"><summary>Horaires de la semaine</summary>' + semaine.jours.map((ligne) => {
    const actuel = aujourdhui >= ligne.premierJour && aujourdhui <= ligne.dernierJour;
    return '<div class="h-ligne' + (actuel ? " h-jour" : "") + '">' + esc(ligne.jour.charAt(0).toUpperCase() + ligne.jour.slice(1)) + " : " + esc(ligne.horaire) + "</div>";
  }).join("") + (semaine.feriesFermes ? '<div class="h-ligne">Ferm\xE9 les jours f\xE9ri\xE9s</div>' : "") + "</details>";
}
const CUISINES_FR = (() => {
  const table = /* @__PURE__ */ new Map();
  Object.entries(CUISINES).forEach(([mot, tag]) => {
    if (!table.has(tag)) table.set(tag, mot);
  });
  Object.entries({
    french: "Fran\xE7aise",
    italian: "Italienne",
    turkish: "Turque",
    lebanese: "Libanaise",
    moroccan: "Marocaine",
    tunisian: "Tunisienne",
    algerian: "Alg\xE9rienne",
    african: "Africaine",
    senegalese: "S\xE9n\xE9galaise",
    ivorian: "Ivoirienne",
    ethiopian: "\xC9thiopienne",
    cameroonian: "Camerounaise",
    congolese: "Congolaise",
    malian: "Malienne",
    syrian: "Syrienne",
    asian: "Asiatique",
    japanese: "Japonaise",
    chinese: "Chinoise",
    vietnamese: "Vietnamienne",
    thai: "Tha\xEFlandaise",
    korean: "Cor\xE9enne",
    indian: "Indienne",
    pakistani: "Pakistanaise",
    greek: "Grecque",
    portuguese: "Portugaise",
    spanish: "Espagnole",
    mexican: "Mexicaine",
    brazilian: "Br\xE9silienne",
    peruvian: "P\xE9ruvienne",
    caribbean: "Antillaise",
    american: "Am\xE9ricaine",
    vegetarian: "V\xE9g\xE9tarienne",
    vegan: "V\xE9gane",
    seafood: "Fruits de mer",
    kebab: "Kebab",
    pizza: "Pizza",
    burger: "Burger",
    sushi: "Sushi",
    ramen: "Ramen",
    tapas: "Tapas",
    halal: "Halal",
    kosher: "Casher",
    sandwich: "Sandwichs",
    crepe: "Cr\xEApes",
    bakery: "Boulangerie",
    coffee_shop: "Caf\xE9",
    ice_cream: "Glaces",
    regional: "Cuisine r\xE9gionale",
    international: "International",
    fish_and_chips: "Fish and chips",
    barbecue: "Barbecue",
    steak_house: "Grillades",
    friture: "Friterie",
    chicken: "Poulet",
    noodle: "Nouilles",
    curry: "Curry"
  }).forEach(([tag, libelle]) => table.set(tag, libelle));
  return table;
})();
function libelleCuisine(brut) {
  const valeurs = String(brut || "").split(/[;,]/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const lus = [];
  valeurs.forEach((v) => {
    const libelle = CUISINES_FR.get(v);
    if (libelle && !lus.includes(libelle)) lus.push(libelle);
  });
  if (!lus.length) return "";
  const texte = lus.slice(0, 2).join(" \xB7 ");
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
let gardes = /* @__PURE__ */ new Set();
try {
  gardes = new Set(JSON.parse(localStorage.getItem("autour:gardes") || "[]"));
} catch (e) {
}
const estGarde = (id) => gardes.has(id);
function basculerGarde(id) {
  if (gardes.has(id)) gardes.delete(id);
  else gardes.add(id);
  try {
    localStorage.setItem("autour:gardes", JSON.stringify([...gardes]));
  } catch (e) {
  }
  return gardes.has(id);
}
function blocExplication(l) {
  if (!EXPLIQUE) return "";
  const e = EXPLIQUE.explication(l);
  if (!e.texte && !e.public) return "";
  return '<section class="expli" id="expliBloc" data-pour="' + esc(String(l.id)) + '" data-source="' + esc(e.source || "") + '">' + (e.texte ? '<p class="expli-txt">' + esc(e.texte) + "</p>" : "") + (e.public ? '<p class="expli-public">' + esc(e.public) + "</p>" : "") + (e.mention ? '<p class="expli-src">' + esc(e.mention) + "</p>" : "") + "</section>";
}
function completerExplication(l) {
  if (!l || !l.idGoogle || estFicheAide(l) || l.description) return;
  descriptifGoogle(l.idGoogle).then((texte) => {
    if (!texte) return;
    l.description = texte;
    const bloc = $("#expliBloc");
    if (bloc && bloc.dataset.pour === String(l.id)) bloc.outerHTML = blocExplication(l);
  });
}
function noteVacances(l) {
  if (l.cat !== "ecole") return "";
  const v = vacancesScolaires(/* @__PURE__ */ new Date());
  if (!v) return "";
  return '<p class="non-verifie">Nous sommes ' + (v.sur ? "en " : "probablement en ") + v.nom + " : l\u2019\xE9tablissement est sans doute ferm\xE9.</p>";
}
function urlSiteSure(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch (e) {
    return "";
  }
}
function estFicheAide(l) {
  return !!(modeAide && l && (SET_AIDE.has(l.cat) || l.aideRaison));
}
function attributionPhoto(l) {
  const brut = l && l.imageAttribution;
  const auteurs = Array.isArray(brut) ? brut : brut ? [{ name: brut, url: "" }] : [];
  if (!auteurs.length) return "";
  return auteurs.map((a) => {
    const nom = esc(a && a.name || "");
    const url = urlSiteSure(a && a.url);
    return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">\xA9 ' + nom + "</a>" : "\xA9 " + nom;
  }).join(" \xB7 ");
}
function photoAutoriseeAide(l) {
  if (!l || !l.image) return "";
  const origine = l.imageSource || "";
  if (IMAGES && IMAGES.SOURCES.includes(origine)) return l.image;
  return ["datatourisme_licence", "autour_verifie"].includes(origine) ? l.image : "";
}
function couvertureAide(l, c) {
  const photo = photoAutoriseeAide(l);
  const teinte = COULEURS_CAT[l.cat] || "#B82A3A";
  return '<figure class="aide-couverture' + (photo ? "" : " sans-photo") + '" style="--teinte:' + teinte + '"><span aria-hidden="true">' + c.emoji + "</span>" + (photo ? '<img src="' + esc(photo) + '" loading="lazy" decoding="async" alt="">' : "") + (photo && l.imageAttribution ? "<figcaption>Photo : " + attributionPhoto(l) + "</figcaption>" : "") + "</figure>";
}
function couvertureLieu(l, c) {
  if (!l) return "";
  return '<figure class="aide-couverture' + (l.image ? "" : " sans-photo") + '" style="--teinte:' + (COULEURS_CAT[l.cat] || "#5D6B63") + '"><span aria-hidden="true">' + c.emoji + "</span>" + (l.image ? '<img src="' + esc(l.image) + '" loading="lazy" decoding="async" alt="">' : "") + (l.image && l.imageAttribution ? "<figcaption>Photo : " + attributionPhoto(l) + "</figcaption>" : "") + "</figure>";
}
function sourceAide(l) {
  const source = l && (l.source || (l.sources || [])[0]) || "";
  const libelles = {
    openstreetmap: "OpenStreetMap",
    google_places: "Google Maps",
    datatourisme: "DATAtourisme",
    autour: "Autour",
    openagenda: "Agenda officiel",
    gemini: "Recherche ancr\xE9e"
  };
  if (source === "autour" && l && l.par) return String(l.par);
  return libelles[source] || l && l.par || "Source non renseign\xE9e";
}
function dateMiseAJourAide(l) {
  const brute = l && (l.updated_at || l.updatedAt || l.horairesVusLe || l.prixVuLe || l.created_at);
  const date = brute ? new Date(brute) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
}
function statutAide(l) {
  if (estTemporaire(l)) {
    return TEMPS.libelleTemporel(l, Date.now(), { disponibilite: (x, t) => dispoDe(x, null, t) });
  }
  return libelleOuverture(l);
}
const VITESSES_KMH = { pied: 4.5, velo: 15 };
const EMOJI_MODE = { pied: "\u{1F6B6}", velo: "\u{1F6B2}" };
const LABEL_MODE = { pied: "\xC0 pied", velo: "V\xE9lo" };
function quitterNav() {
  if (!modeNav) return;
  modeNav = false;
  document.body.classList.remove("nav");
  $("#navBarre").hidden = true;
  ["#navBas", "#appHeader", "#btnTransports", "#attribution"].forEach((s) => {
    const el = $(s);
    if (el) el.hidden = false;
  });
  majFiltres();
  majRaccourcis();
  effacerLignes();
  $("#voile").hidden = false;
  $("#feuille").hidden = false;
  rendre();
  majBoutons();
}
const OSRM_PROFILS = {
  pied: "https://routing.openstreetmap.de/routed-foot/route/v1/foot/",
  velo: "https://routing.openstreetmap.de/routed-bike/route/v1/bike/"
};
function tempsTrajetMinutes(distanceMetres, kmh) {
  return Math.max(1, Math.round(distanceMetres / 1e3 / kmh * 60));
}
function coordonneeItineraire(point) {
  return Number(point[0]).toFixed(6) + "," + Number(point[1]).toFixed(6);
}
const slug = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
function lienVers(l) {
  const u = new URL(location.href);
  u.hash = "";
  u.search = "";
  if (l.dbId) {
    u.pathname = "/e/" + encodeURIComponent(l.dbId) + (slug(l.titre) ? "/" + slug(l.titre) : "");
    return u.toString();
  }
  u.pathname = "/l/" + l.lat.toFixed(5) + "," + l.lng.toFixed(5) + (slug(l.titre) ? "/" + slug(l.titre) : "");
  return u.toString();
}
function lieuPartage() {
  const chemin = /^\/(l|e)\/([^/]+)(?:\/([^/]*))?\/?$/.exec(location.pathname || "");
  if (chemin) {
    const [, type, cle, titre] = chemin;
    if (type === "e") return {
      dbId: decodeURIComponent(cle),
      lat: null,
      lng: null,
      titre: titre ? decodeURIComponent(titre) : ""
    };
    const c = /^(-?[\d.]+),(-?[\d.]+)$/.exec(decodeURIComponent(cle));
    if (c) return {
      lat: parseFloat(c[1]),
      lng: parseFloat(c[2]),
      titre: titre ? decodeURIComponent(titre) : ""
    };
  }
  const m = /^#l=(-?[\d.]+),(-?[\d.]+)(?:\|(.*))?$/.exec(location.hash || "");
  if (!m) return null;
  return {
    lat: parseFloat(m[1]),
    lng: parseFloat(m[2]),
    titre: m[3] ? decodeURIComponent(m[3]) : ""
  };
}
let partageOuvert = false;
function ouvrirLieuPartage() {
  if (partageOuvert) return;
  const p = lieuPartage();
  if (!p) return;
  const cible = p.dbId != null ? lieux.find((l) => String(l.dbId) === String(p.dbId)) : lieux.find((l) => distanceM(l.lat, l.lng, p.lat, p.lng) < 60);
  if (!cible) return;
  partageOuvert = true;
  allerVers([cible.lat, cible.lng], 17, { duration: 0.8 });
  setTimeout(() => {
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(cible.id));
  }, 850);
}
async function partagerLieu(l) {
  const url = lienVers(l);
  const txt = l.titre + " \u2014 " + l.adresse + ", " + l.cp + " \xB7 " + libelleHoraires(l);
  try {
    if (navigator.share) await navigator.share({ title: l.titre, text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + "\n" + url);
      toast("Lien copi\xE9");
    }
  } catch (e) {
  }
}
async function partagerApp() {
  try {
    if (navigator.share) await navigator.share({ title: "Autour", text: "Ce qui se passe autour de toi", url: location.href });
    else {
      await navigator.clipboard.writeText(location.href);
      toast("Lien copi\xE9");
    }
  } catch (e) {
  }
}
let brouillon = null, retourFormulaire = false;
function aujourdHui() {
  const d = /* @__PURE__ */ new Date();
  d.setMinutes(0, 0, 0);
  return d;
}
function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function prochaineHeure() {
  const d = /* @__PURE__ */ new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return String(d.getHours()).padStart(2, "0") + ":00";
}
function prochainSamedi() {
  const d = aujourdHui();
  const j = d.getDay();
  d.setDate(d.getDate() + (6 - j + 7) % 7 || 7);
  return d;
}
function libelleQuand(b) {
  if (!b.date) return "";
  const [a, m, j] = b.date.split("-").map(Number);
  const d = new Date(a, m - 1, j);
  const jour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(d);
  const h = b.heure ? " \xB7 " + b.heure.replace(":", "h") : "";
  const f = b.heure && b.fin ? " \u2192 " + b.fin.replace(":", "h") : "";
  return jour.charAt(0).toUpperCase() + jour.slice(1) + h + f;
}
function ouvrirModePose() {
  modePose = true;
  $("#viseur").hidden = false;
  $("#poseBarre").hidden = false;
  $("#navBas").hidden = true;
  $("#btnTransports").hidden = true;
  $("#btnPartager").hidden = true;
  $("#feuilleBesoins").hidden = true;
  $("#poseBarre .txt").textContent = retourFormulaire ? "D\xE9place la carte pour corriger l\u2019endroit." : "D\xE9place la carte : l\u2019\xE9pingle se pose ici.";
}
function fermerModePose() {
  modePose = false;
  $("#viseur").hidden = true;
  $("#poseBarre").hidden = true;
  $("#navBas").hidden = false;
  $("#btnTransports").hidden = false;
  majBoutons();
  majRaccourcis();
  majFeuille2();
}
const IMAGE_COTE_MAX = 1600;
async function preparerImage(fichier) {
  if (!fichier || !/^image\//.test(fichier.type || "")) return null;
  try {
    const bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
    const ratio = Math.min(1, IMAGE_COTE_MAX / Math.max(bitmap.width, bitmap.height));
    const largeur = Math.max(1, Math.round(bitmap.width * ratio));
    const hauteur = Math.max(1, Math.round(bitmap.height * ratio));
    const toile = document.createElement("canvas");
    toile.width = largeur;
    toile.height = hauteur;
    toile.getContext("2d").drawImage(bitmap, 0, 0, largeur, hauteur);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((r) => toile.toBlob(r, "image/jpeg", 0.82));
    if (!blob) return null;
    return new File([blob], "affiche.jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch (e) {
    return null;
  }
}
function nouveauBrouillon() {
  const c = pointCarte();
  return {
    lat: c.lat,
    lng: c.lng,
    titre: "",
    adresse: "",
    cat: typeAvantPose || "popup",
    date: isoDate(aujourdHui()),
    heure: prochaineHeure(),
    fin: "",
    gratuit: true,
    prix: 5,
    limite: false,
    places: 20,
    qr: false,
    imageFichier: null,
    imageApercu: ""
  };
}
function validerPose() {
  const c = pointCarte();
  if (retourFormulaire && brouillon) {
    brouillon.lat = c.lat;
    brouillon.lng = c.lng;
    publicationModifiee = true;
  } else {
    brouillon = nouveauBrouillon();
    publicationModifiee = false;
  }
  chargerAutourDuPoint(c.lat, c.lng, { force: true });
  retourFormulaire = false;
  fermerModePose();
  pileEcrans = [];
  pousserEcran(dessinerFormulaire);
}
function lieuxLibres() {
  const [lat, lng] = positionMoi;
  return lieux.filter((l) => !estTemporaire(l)).filter((l) => !indexEvenements.get(l.titre)).map((l) => Object.assign({}, l, { dist: distanceM(lat, lng, l.lat, l.lng) })).sort((a, b) => a.dist - b.dist).slice(0, 15);
}
async function chercherAdresse(q) {
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=6&q=" + encodeURIComponent(q));
    if (!r.ok) return [];
    return (await r.json()).map((a) => ({
      nom: a.display_name,
      lat: parseFloat(a.lat),
      lng: parseFloat(a.lon)
    }));
  } catch (e) {
    console.error("Recherche d\u2019adresse :", e);
    return [];
  }
}
const ATTENTE_VISIBLE_MS = 2e3;
const publicationsEnVol = /* @__PURE__ */ new Map();
function marquerPublication(id, etat2) {
  const p = userPublications.find((x) => x.id === id);
  if (!p) return;
  p.envoi = etat2;
  reconstruireLieux();
  planifierRendu({ carte: true, feuille: true });
}
const CLE_GOOGLE = "AIzaSyAFjDL4NtNNaTFhD-tbN4escj8xQ9Mpio4";
const GOOGLE_CONFIG = Object.freeze({ apiKey: CLE_GOOGLE, defaultCategory: "commerce" });
const TYPES_RESTO = ["restaurant", "cafe", "bar", "bakery", "meal_takeaway"];
const NIVEAU_PRIX = window.AutourProviders && AutourProviders.googlePlaces ? AutourProviders.googlePlaces.niveauxPrix : {};
const SYMBOLE_PRIX = ["Gratuit", "\u20AC", "\u20AC\u20AC", "\u20AC\u20AC\u20AC", "\u20AC\u20AC\u20AC\u20AC"];
const AVEC_PRIX = /* @__PURE__ */ new Set(["resto", "fastfood", "cafe", "bar", "commerce", "friperie", "marche"]);
const CAT_GOOGLE = window.AutourProviders && AutourProviders.googlePlaces ? AutourProviders.googlePlaces.typesVersCategorie : {};
function providerGoogle() {
  return window.AutourProviders && AutourProviders.googlePlaces;
}
function ficheGoogleInterne(fiche) {
  const p = window.AutourProviders && AutourProviders.versInterne ? AutourProviders.versInterne(fiche) : null;
  if (!p) return null;
  return Object.assign(p, {
    nom: p.titre,
    type: fiche && fiche.primaryType || "",
    adresse: p.adresse || p.titre,
    image: p.image || "",
    idGoogle: (p.sourceRefs || {}).googlePlaceId || p.idGoogle || "",
    descriptionSource: p.description ? "google" : ""
  });
}
function photoGoogle(place) {
  const fournisseur = providerGoogle();
  return fournisseur && fournisseur.normaliserPlace ? (ficheGoogleInterne(fournisseur.normaliserPlace(place, GOOGLE_CONFIG)) || {}).image || "" : "";
}
function mapperPlace(place) {
  const fournisseur = providerGoogle();
  return fournisseur ? ficheGoogleInterne(fournisseur.normaliserPlace(place, GOOGLE_CONFIG)) : null;
}
async function descriptifGoogle(idGoogle) {
  const fournisseur = providerGoogle();
  if (!fournisseur || !idGoogle) return "";
  try {
    const fiche = await fournisseur.details(idGoogle, GOOGLE_CONFIG);
    return fiche && fiche.description || "";
  } catch (e) {
    journal.warn("Descriptif Google indisponible");
    return "";
  }
}
async function enrichirGoogle(idGoogle) {
  const fournisseur = providerGoogle();
  if (!fournisseur || !idGoogle) return null;
  try {
    return ficheGoogleInterne(await fournisseur.details(idGoogle, GOOGLE_CONFIG));
  } catch (e) {
    journal.warn("Enrichissement Google indisponible");
    return null;
  }
}
const MAX_ENRICHIS = 5;
const ENR = window.AutourEnrichissements || null;
async function calqueVerifie(cles) {
  if (!ENR || !cles.length || !await connecter() || !sbLecture) return /* @__PURE__ */ new Map();
  const fini = PERF.requete("supabase_enrichissements");
  try {
    const { data, error } = await sbLecture.from("place_enrichments").select("*").in("place_key", cles.slice(0, 50));
    if (error) return /* @__PURE__ */ new Map();
    return new Map((data || []).map((e) => [e.place_key, e]));
  } catch (e) {
    return /* @__PURE__ */ new Map();
  } finally {
    fini();
  }
}
async function demanderVerification(lieu, raisons) {
  const cle = ENR && ENR.cleLieu(lieu.titre, lieu.lat, lieu.lng);
  if (!cle) return null;
  let session2 = null;
  try {
    if (!await connecter()) return null;
    ({ data: { session: session2 } } = await sb.auth.getSession());
  } catch (e) {
    return null;
  }
  if (!session2 || !session2.access_token) return null;
  if (!ENR._reserver(cle)) return null;
  const fini = PERF.requete("enrichir_lieu");
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/enrichir-lieu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_CLE,
        authorization: "Bearer " + session2.access_token
      },
      body: JSON.stringify({
        nom: lieu.titre,
        lat: lieu.lat,
        lng: lieu.lng,
        commune: lieu.cp || "",
        adresse: lieu.adresse || "",
        categorie: lieu.cat || "",
        horaires: lieu.quand || "",
        is_event: !!(lieu.isTemporary || lieu.debutLe || lieu.finLe),
        start_at: lieu.debutLe ? new Date(lieu.debutLe).toISOString() : null,
        end_at: lieu.finLe ? new Date(lieu.finLe).toISOString() : null,
        titre: lieu.titre || "",
        description: lieu.description || "",
        summary: lieu.resume || lieu.summary || "",
        notes: lieu.notes || "",
        source_text: lieu.note || "",
        source_url: lieu.image_source_url || lieu.url || "",
        dates: lieu.dates || null,
        programme: lieu.programme || null,
        source_fingerprint: ENR.empreinteSource(lieu),
        structured: {
          start_at: lieu.debutLe ? new Date(lieu.debutLe).toISOString() : null,
          end_at: lieu.finLe ? new Date(lieu.finLe).toISOString() : null,
          horaires: lieu.quand || null,
          programme: lieu.programme || null,
          temporal_data: lieu.temporal_data || lieu.temporalData || null,
          time_windows: lieu.time_windows || null,
          monthly_rules: lieu.monthly_rules || null,
          excluded_weekdays: lieu.excluded_weekdays || null,
          exceptions: lieu.exceptions || null,
          source_url: lieu.url || lieu.image_source_url || null
        },
        image: lieu.image_url ? {
          url: lieu.image_url,
          image_id: lieu.image_source_url || lieu.image_url,
          source_url: lieu.image_source_url || lieu.image_url,
          source_type: lieu.image_source || "",
          image_scope: lieu.image_scope || "",
          version: lieu.image_version || "",
          updated_at: lieu.image_updated_at || "",
          etag: lieu.image_etag || "",
          authorized: !!(lieu.image_scope === "evenement" && lieu.image_url)
        } : null
      }),
      signal: AbortSignal.timeout(2e4)
    });
    if (!r.ok) return null;
    const json = await r.json();
    if (json && json.raison === "budget du jour atteint") budgetVerificationEpuise = true;
    journal.info("enrichissement", lieu.titre, raisons.join(","), json.origine || "?");
    return json && json.enrichissement ? json.enrichissement : null;
  } catch (e) {
    return null;
  } finally {
    ENR._liberer();
    fini();
  }
}
function enrichirCandidats(classement, intention, redessiner) {
  if (!DONNEES || !Array.isArray(classement)) return;
  const rendre1 = () => {
    if (typeof redessiner === "function") redessiner();
  };
  const aDemander = classement.filter((l) => l.idGoogle && DONNEES.manque(l, intention, { disponibilite: (x, t) => dispoDe(x, null, t) }).length).slice(0, MAX_ENRICHIS);
  Promise.all(aDemander.map(async (l) => {
    const f = await enrichirGoogle(l.idGoogle);
    if (!f) return;
    ["prixN", "horaires", "ouvert", "tel", "url", "note", "avis", "image"].forEach((cle) => {
      if (f[cle] != null && f[cle] !== "") l[cle] = f[cle];
    });
  })).then(rendre1);
  if (IMAGES) IMAGES.resoudreLot(classement, { redessiner: rendre1 }).catch(() => {
  });
  if (!ENR) return;
  const candidats = classement.slice(0, ENR.MAX_CANDIDATS).map((l) => ({ l, cle: ENR.cleLieu(l.titre, l.lat, l.lng), raisons: ENR.manques(l) })).filter((x) => x.cle && x.raisons.length);
  if (!candidats.length) return;
  calqueVerifie(candidats.map((x) => x.cle)).then(async (connus) => {
    let change = false;
    const aVerifier = [];
    candidats.forEach((x) => {
      const e = connus.get(x.cle);
      if (e && ENR.appliquer(x.l, e)) change = true;
      const frais = e && e.expires_at && Date.parse(e.expires_at) > Date.now();
      if (!frais) aVerifier.push(x);
      else if (!ENR.compatible(x.l, e)) aVerifier.push(x);
    });
    if (change) rendre1();
    for (const x of aVerifier) {
      const restants = ENR.manques(x.l);
      const decision = deciderVerification(x.l, restants, connus.get(x.cle));
      if (!decision.autorise) continue;
      const e = await demanderVerification(x.l, decision.manques.length ? [...decision.manques] : x.raisons);
      if (e && ENR.appliquer(x.l, e)) rendre1();
    }
  });
}
let budgetVerificationEpuise = false;
function deciderVerification(lieu, restants, entree) {
  if (!TERR) return { autorise: restants.length > 0, manques: restants };
  const decision = TERR.enrichissementAutorise(lieu, {
    maintenant: Date.now(),
    manques: restants,
    cacheExpireLe: entree && entree.expires_at,
    budgetRestant: budgetVerificationEpuise ? 0 : 1,
    /* Une entrée produite par une source officielle a déjà répondu : ce qui
       ne figure plus dans `restants` a été rempli par elle. */
    sourceOfficielle: !!(entree && entree.source_priority && entree.source_priority !== "tiers")
  });
  if (decision.autorise) {
    compterTerritorial("territorial_gemini_requested");
    return decision;
  }
  compterTerritorial(decision.raison === TERR.REFUS.BUDGET ? "territorial_gemini_budget_blocked" : "territorial_gemini_skipped_fresh_data");
  return decision;
}
async function chercherGoogle(q, lat, lng, opts) {
  const o = opts || {};
  const fournisseur = providerGoogle();
  if (!fournisseur || !await googleMapsActif()) return [];
  try {
    return (await fournisseur.search(q, lat, lng, GOOGLE_CONFIG, { signal: o.signal })).map(ficheGoogleInterne).filter(Boolean);
  } catch (e) {
    if (!(e && e.name === "AbortError")) journal.warn("Recherche Google indisponible");
    return [];
  }
}
async function placesGoogle(lat, lng, types, signal) {
  const fournisseur = providerGoogle();
  if (!fournisseur || !await googleMapsActif()) return [];
  try {
    PERF.requete("google_places");
    return (await fournisseur.nearby(lat, lng, GOOGLE_CONFIG, { types, signal })).map(ficheGoogleInterne).filter(Boolean);
  } catch (e) {
    if (!(e && e.name === "AbortError")) journal.warn("Google Places indisponible");
    return [];
  }
}
async function notesGoogle(lat, lng, opts) {
  const o = opts || {};
  const listes = [placesGoogle(lat, lng, null, o.signal)];
  if (o.resto) listes.push(placesGoogle(lat, lng, TYPES_RESTO, o.signal));
  const fiches = (await Promise.all(listes)).flat();
  const uniques = /* @__PURE__ */ new Map();
  fiches.forEach((f) => {
    if (f && f.nom) uniques.set(f.idGoogle || f.nom + "|" + f.lat.toFixed(4), f);
  });
  return [...uniques.values()];
}
const zonesResto = /* @__PURE__ */ new Set();
const restaurationsEnCours = /* @__PURE__ */ new Map();
function completerRestauration(opts) {
  if (!positionMoi) return Promise.resolve([]);
  const o = opts || {}, [lat, lng] = centreZoneActive() || positionMoi, cle = idZoneActive() + "#" + lat.toFixed(2) + "," + lng.toFixed(2);
  if (o.force) zonesResto.delete(cle);
  if (zonesResto.has(cle)) return Promise.resolve([]);
  if (restaurationsEnCours.has(cle)) return restaurationsEnCours.get(cle);
  const generation = nouvelleGeneration("zone:restauration", cle, !!o.force);
  let promesse;
  promesse = placesGoogle(lat, lng, TYPES_RESTO, generation.signal).then((f) => {
    if (!generationCourante(generation) || !f.length) return [];
    zonesResto.add(cle);
    greffeNotes(lieux, f);
    ajouterLieuxGoogle(f);
    majAccueil();
    if (feuilleNiveau === "manger") majFeuille2();
    return f;
  }).catch(() => []).finally(() => {
    if (restaurationsEnCours.get(cle) === promesse) restaurationsEnCours.delete(cle);
    terminerGeneration(generation);
  });
  restaurationsEnCours.set(cle, promesse);
  return promesse;
}
function ajouterLieuxGoogle(fiches, catDefaut) {
  const ajouts = [];
  (fiches || []).forEach((f) => {
    if (!f || !f.nom) return;
    const service = preciserService(f.nom);
    let cat = affinerCategorie(CAT_GOOGLE[f.type] || f.cat || f.autourCat || catDefaut, f.nom);
    if (/Mission locale|France Travail|Cap emploi|Maison de l’emploi/.test(service)) cat = "emploi";
    else if (!cat && service) cat = "asso";
    const dejaPresent = lieux.find((l) => {
      if (!l || estTemporaire(l) || distanceM(l.lat, l.lng, f.lat, f.lng) >= 80) return false;
      const memeAdresse = adressesLieuxCompatibles(l.adresse, f.adresse);
      return (memeAdresse || nomsLieuxCompatibles(l.titre, f.nom)) && (memeAdresse || familleDedupLieu(l) === familleDedupLieu({ cat }));
    });
    if (!cat || dejaPresent) {
      if (dejaPresent) {
        appliquerFicheGoogle(dejaPresent, f);
        const canonique = permanentPlaces.find((l) => l.id === dejaPresent.id);
        if (canonique && canonique !== dejaPresent) appliquerFicheGoogle(canonique, f);
        planifierRendu({ carte: true, accueil: true, feuille: true });
      }
      return;
    }
    ajouts.push(normaliserItem(Object.assign({}, f, {
      id: f.id || f.autourId,
      cat,
      titre: f.nom,
      description: f.description || "",
      quand: "Voir sur place",
      gratuit: f.gratuit === true || f.prixN === 0 ? true : void 0,
      prix: f.prixN === 0 ? 0 : null,
      places: null,
      qr: false,
      par: "Google Maps",
      service,
      solidaire: f.solidaire === true || estSolidaire(f.nom, false),
      isAidProvider: f.isAidProvider === true ? true : f.isAidProvider === false ? false : void 0,
      imageSource: f.imageSource || "google_places"
    }), "google_places"));
  });
  if (ajouts.length) fusionner(ajouts, "permanent");
  return ajouts.length;
}
function nomsLieuxCompatibles(nomA, nomB) {
  const nettoyer = (nom) => sansAccents(nom || "").replace(/[^a-z0-9]+/g, " ").trim();
  const a = nettoyer(nomA), b = nettoyer(nomB);
  if (!a || !b) return false;
  if (a === b) return true;
  const ignorer = /* @__PURE__ */ new Set(["le", "la", "les", "de", "du", "des", "chez", "restaurant", "resto", "cafe", "bar", "brasserie", "snack", "fast", "food", "boulangerie"]);
  const mots = (nom) => [...new Set(nom.split(/\s+/).filter((m) => m.length > 2 && !ignorer.has(m)))];
  const aa = mots(a), bb = mots(b), communs = aa.filter((m) => bb.includes(m));
  if (aa.length === 1 && bb.length === 1 ? communs[0] && communs[0].length >= 5 : communs.length >= 2 && communs.length / Math.min(aa.length, bb.length) >= 2 / 3) return true;
  const distanceEdition = (x, y) => {
    const ligne2 = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i++) {
      let diagonal = ligne2[0];
      ligne2[0] = i;
      for (let j = 1; j <= y.length; j++) {
        const precedent = ligne2[j];
        ligne2[j] = Math.min(ligne2[j] + 1, ligne2[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
        diagonal = precedent;
      }
    }
    return ligne2[y.length];
  };
  const premierCommun = a.split(/\s+/)[0] === b.split(/\s+/)[0] && a.split(/\s+/)[0].length >= 4;
  const autreCommun = communs.some((m) => m.length >= 5);
  const fauteIsolee = aa.some((x) => x.length >= 5 && bb.some((y) => y.length >= 5 && distanceEdition(x, y) <= Math.max(1, Math.floor(Math.max(x.length, y.length) * 0.2))));
  if (premierCommun && autreCommun && fauteIsolee) return true;
  const premierA = a.split(/\s+/)[0], premierB = b.split(/\s+/)[0];
  const compactA = a.replace(/\s/g, ""), compactB = b.replace(/\s/g, "");
  if (!premierA || premierA.length < 4 || premierA !== premierB || Math.min(compactA.length, compactB.length) < 12) return false;
  const court = compactA.length <= compactB.length ? compactA : compactB;
  const long = compactA.length <= compactB.length ? compactB : compactA;
  let ligne = Array.from({ length: court.length + 1 }, (_, i) => i);
  for (let i = 1; i <= court.length; i++) {
    let diagonal = ligne[0];
    ligne[0] = i;
    for (let j = 1; j <= court.length; j++) {
      const precedent = ligne[j];
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diagonal + (court[i - 1] === long[j - 1] ? 0 : 1));
      diagonal = precedent;
    }
  }
  return 1 - ligne[court.length] / court.length >= 0.9;
}
function adressesLieuxCompatibles(adresseA, adresseB) {
  const nettoyer = (adresse) => sansAccents(adresse || "").replace(/[^a-z0-9]+/g, " ").trim();
  const a = nettoyer(adresseA), b = nettoyer(adresseB);
  return a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a));
}
function appliquerFicheGoogle(l, f) {
  if (!l || !f) return;
  if (Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng))) {
    l.lat = f.lat;
    l.lng = f.lng;
  }
  if (l.source !== "autour" && !l.dbId && f.nom) {
    l.titre = f.nom;
    l.title = f.nom;
  }
  [
    "note",
    "avis",
    "ouvert",
    "prixN",
    "horaires",
    "tel",
    "url",
    "pmr",
    "idGoogle",
    "description",
    "accesSanteDocumente"
  ].forEach((cle) => {
    if (f[cle] != null && f[cle] !== "") l[cle] = f[cle];
  });
  if (f.image && !l.image) {
    l.image = f.image;
    l.imageSource = f.imageSource || "google_places";
  }
  l.sourceRefs = Object.assign({}, l.sourceRefs || {}, f.sourceRefs || {}, f.idGoogle ? { googlePlaceId: f.idGoogle } : {});
}
function greffeNotes(liste, fiches) {
  (liste || []).forEach((l) => {
    let meilleur = null, dMin = 150;
    (fiches || []).forEach((f) => {
      const d = distanceM(l.lat, l.lng, f.lat, f.lng);
      if (d < dMin && (nomsLieuxCompatibles(l.titre, f.nom) || adressesLieuxCompatibles(l.adresse, f.adresse))) {
        dMin = d;
        meilleur = f;
      }
    });
    if (meilleur) {
      appliquerFicheGoogle(l, meilleur);
      const canonique = permanentPlaces.find((x) => x.id === l.id);
      if (canonique && canonique !== l) appliquerFicheGoogle(canonique, meilleur);
    }
  });
  planifierRendu({ carte: true, accueil: true, feuille: true });
}
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const formatDist = (m) => !Number.isFinite(Number(m)) ? "" : m < 1e3 ? Math.round(m / 10) * 10 + " m" : (m / 1e3).toFixed(1) + " km";
function distancePourListe(l) {
  const fournie = Number(l && l.dist);
  if (Number.isFinite(fournie)) return fournie;
  const calculee = distanceDepuisZone(l);
  return Number.isFinite(calculee) ? calculee : null;
}
function evenementsDe(lieu) {
  return lieux.filter((l) => estTemporaire(l) && l.adresse === lieu.titre);
}
let triListe = "auto";
function classerLieux(liste, sansPalmares) {
  const [lat, lng] = pointDeReference() || positionMoi;
  const dedans = liste.map((l) => {
    const d = distanceM(lat, lng, l.lat, l.lng);
    const evs = estTemporaire(l) ? [] : evenementsDe(l);
    return Object.assign({}, l, { dist: d, evs: evs.length, mien: !!l.mien });
  });
  dedans.sort((a, b) => {
    if (sansPalmares) return a.dist - b.dist;
    if (triListe === "distance") return a.dist - b.dist;
    if (triListe === "prix") {
      const pa = a.prixN == null ? 9 : a.prixN, pb = b.prixN == null ? 9 : b.prixN;
      if (pa !== pb) return pa - pb;
      const na = a.note || 0, nb = b.note || 0;
      if (na !== nb) return nb - na;
      return a.dist - b.dist;
    }
    if (triListe === "note") {
      const na = a.note || 0, nb = b.note || 0;
      if (na !== nb) return nb - na;
      const va = a.avis || 0, vb = b.avis || 0;
      if (va !== vb) return vb - va;
      return a.dist - b.dist;
    }
    if (a.mien !== b.mien) return a.mien ? -1 : 1;
    if (a.note && b.note && a.note !== b.note) return b.note - a.note;
    if (a.evs !== b.evs) return b.evs - a.evs;
    return a.dist - b.dist;
  });
  return dedans;
}
function classer(cat) {
  return classerLieux(lieux.filter((l) => correspondCategorie(l, cat)), SANS_CLASSEMENT.has(cat));
}
function ouvrirListe(cat) {
  const c = CATS[cat];
  if (!c) return;
  mettreAJourProfil("categorie", cat);
  if (SANS_CLASSEMENT.has(cat) && positionMoi)
    chargerAideZone().then(() => {
      if (filtreActif === cat) ouvrirListe(cat);
    });
  afficherListe(
    c.emoji,
    c.label,
    classer(cat),
    SANS_CLASSEMENT.has(cat),
    () => ouvrirListe(cat)
  );
}
function suitesUtiles(connus, montres) {
  const gestes = [];
  if (creneau === "maintenant") {
    gestes.push(['<button class="suite" data-suite="soir">Ce soir</button>']);
    gestes.push(['<button class="suite" data-suite="weekend">Ce week-end</button>']);
  }
  gestes.push(['<button class="suite" data-suite="categorie">Changer de cat\xE9gorie</button>']);
  gestes.push(['<button class="suite" data-suite="zone">Explorer cette zone</button>']);
  const note = connus > montres ? '<p class="suite-note">Autour en conna\xEEt ' + connus + " ici. En voici les " + montres + " meilleures \u2014 la suite passe par une autre envie.</p>" : "";
  return '<div class="suites">' + note + '<div class="suites-gestes">' + gestes.map((g) => g[0]).join("") + "</div></div>";
}
function afficherListe(emoji, titre, l, sansPalmares, redessiner, connus) {
  const avecNotes = l.some((x) => x.note);
  const avecPrix = l.some((x) => x.prixN != null);
  const critere = sansPalmares ? "Tri\xE9 par distance. Ces lieux ne sont pas class\xE9s : ils rendent tous le m\xEAme service." : triListe === "prix" ? avecPrix ? "Du moins cher au plus cher, \xE0 prix \xE9gal le mieux not\xE9. Le niveau de prix vient de Google, pas des commentaires." : "Aucun niveau de prix connu ici : l\u2019ordre retombe sur la distance." : triListe === "distance" ? "Du plus proche au plus loin." : triListe === "note" ? avecNotes ? "Les mieux not\xE9s d\u2019abord, \xE0 note \xE9gale le plus comment\xE9." : "Aucune note disponible ici : l\u2019ordre retombe sur la distance." : avecNotes ? "Class\xE9 par note, puis par ce qui s\u2019y passe, puis par distance." : "Class\xE9 par ce qui s\u2019y passe, puis par distance.";
  const tris = [["auto", "Pertinence"], ["note", "Mieux not\xE9s"], ["distance", "Plus proches"]];
  if (avecPrix || l.some((x) => AVEC_PRIX.has(x.cat))) tris.push(["prix", "Moins cher"]);
  const barreTri = sansPalmares ? "" : '<div class="tri-barre">' + tris.map(([id, lab]) => '<button class="tri' + (triListe === id ? " actif" : "") + '" data-tri="' + id + '">' + lab + "</button>").join("") + "</div>";
  const lignes = l.map((x, i) => {
    const c = categorieAffichee(x, { emoji: "\u{1F4CD}" });
    const distance = distancePourListe(x);
    const sous = [];
    if (x.note && !sansPalmares) sous.push('<span class="rang-note">\u2605 ' + x.note.toFixed(1) + (x.avis ? ' <span style="font-weight:500;color:var(--ink2)">(' + x.avis + ")</span>" : "") + "</span>");
    const badge = badgeDispo(x);
    if (badge) sous.push(badge);
    const cuisine = libelleCuisine(x.cuisine);
    if (cuisine) sous.push(esc(cuisine));
    if (x.prixN != null) sous.push('<span class="prix-n">' + SYMBOLE_PRIX[x.prixN] + "</span>");
    if (x.service) sous.push('<span class="service">' + esc(x.service) + "</span>");
    sous.push(esc(x.adresse || ""));
    if (!badge) sous.push(esc(libelleHoraires(x)));
    return '<button class="rang" data-va="' + esc(x.id) + '"><span class="rang-n">' + (i + 1) + '</span><span class="rang-emoji">' + c.emoji + '</span><span class="rang-txt"><span class="rang-nom">' + esc(x.titre) + (x.mien ? '<span class="badge mien">Ton ajout</span>' : "") + (x.evs ? '<span class="badge">' + x.evs + " ce soir</span>" : "") + '</span><span class="rang-sous">' + sous.join(" \xB7 ") + "</span></span>" + (Number.isFinite(distance) ? '<span class="rang-dist">' + formatDist(distance) + "</span>" : "") + "</button>";
  }).join("");
  ouvrirFeuille(
    '<div class="liste-tete"><h2>' + emoji + " " + esc(titre) + '</h2><span class="liste-compte">' + l.length + " autour</span></div>" + barreTri + '<p class="liste-tri">' + critere + "</p>" + (l.length ? lignes : '<p class="liste-vide">Rien de ce type dans le coin.<br>Tu peux en poser un avec le bouton +.</p>') + (l.length ? suitesUtiles(Number.isFinite(connus) ? connus : l.length, l.length) : "")
  );
  $("#feuille").querySelectorAll("[data-suite]").forEach((b) => b.onclick = () => {
    const quoi = b.dataset.suite;
    if (quoi === "soir" || quoi === "weekend") {
      creneau = quoi === "soir" ? "soir" : "weekend";
      filtreMaintenant = false;
      fermerFeuille();
      pileEcrans = [];
      ouvrirFeuille2("racine");
      majFeuille2();
      rendre();
      majFiltres();
      return;
    }
    fermerFeuille();
    pileEcrans = [];
    if (quoi === "zone") fermerFeuille2();
    else ouvrirFeuille2("racine");
  });
  $("#feuille").querySelectorAll("[data-tri]").forEach((b) => b.onclick = () => {
    triListe = b.dataset.tri;
    redessiner();
  });
  $("#feuille").querySelectorAll("[data-va]").forEach((b) => b.onclick = () => {
    const id = b.dataset.va, cible = lieux.find((x) => x.id === id);
    if (!cible) return;
    allerVers([cible.lat, cible.lng], (mc) => Math.max(mc.getZoom(), 17), { duration: 0.7 });
    pousserEcran(() => ouvrirDetail(id));
  });
}
function ouvrirResultats(q) {
  const cuisine = cuisineRecherchee(q);
  if (cuisine) {
    const trouves2 = lieux.filter((l) => {
      const c = sansAccents(l.cuisine || "");
      return c && (c.includes(cuisine) || cuisine.includes(c));
    });
    if (trouves2.length) {
      pileEcrans = [];
      pousserEcran(() => afficherListe(
        "\u{1F37D}\uFE0F",
        "\xAB " + q + " \xBB",
        classerLieux(trouves2, false),
        false,
        () => ouvrirResultats(q)
      ));
      return;
    }
  }
  const cat = categorieRecherchee(q);
  if (cat) {
    filtreActif = cat;
    dessinerFiltres();
    rendre();
    if (SANS_CLASSEMENT.has(cat) && positionMoi) chargerAideZone();
    pileEcrans = [];
    pousserEcran(() => ouvrirListe(cat));
    completerParGoogle(q, cat, () => ouvrirListe(cat));
    return;
  }
  const t = sansAccents(q);
  const trouves = lieux.filter((l) => sansAccents(l.titre + " " + (l.adresse || "") + " " + (l.cuisine || "")).includes(t));
  const montrer = () => {
    const encore = lieux.filter((l) => sansAccents(l.titre + " " + (l.adresse || "") + " " + (l.cuisine || "")).includes(t));
    afficherListe(
      "\u{1F50E}",
      "\xAB " + q + " \xBB",
      classerLieux(encore, false),
      false,
      () => ouvrirResultats(q)
    );
  };
  pileEcrans = [];
  pousserEcran(montrer);
  completerParGoogle(q, null, montrer);
}
const RESEAUX_AIDE = [
  { q: "Restos du C\u0153ur", cat: "alimentaire", besoins: ["manger"], solidaire: true },
  { q: "Banque Alimentaire", cat: "alimentaire", besoins: ["manger"], solidaire: true },
  { q: "\xE9picerie solidaire", cat: "alimentaire", besoins: ["manger"], solidaire: true },
  { q: "distribution alimentaire", cat: "alimentaire", besoins: ["manger"], solidaire: true },
  { q: "Secours Populaire", cat: "alimentaire", besoins: ["manger", "vetements", "autre"], solidaire: true },
  { q: "Secours Catholique", cat: "asso", besoins: ["logement", "papiers", "autre"], solidaire: true },
  { q: "Croix-Rouge", cat: "asso", besoins: ["sante", "manger", "vetements", "autre"], solidaire: true },
  { q: "CCAS action sociale", cat: "emploi", besoins: ["logement", "travail", "papiers", "famille", "autre"], solidaire: true },
  { q: "accueil de jour sans-abri", cat: "hebergement", besoins: ["logement", "hygiene", "securite"], urgent: true, solidaire: true },
  { q: "h\xE9bergement d'urgence", cat: "hebergement", besoins: ["logement", "securite"], urgent: true, solidaire: true },
  // accès aux droits et insertion : trois guichets distincts qu'OSM range
  // sous le même tag, et qui ne reçoivent pas les mêmes personnes
  { q: "Mission locale", cat: "emploi", besoins: ["travail", "jeunes"], solidaire: true },
  { q: "France Travail", cat: "emploi", besoins: ["travail"] },
  { q: "France Services acc\xE8s aux droits", cat: "emploi", besoins: ["papiers", "autre"], solidaire: true },
  { q: "vestiaire solidaire v\xEAtements", cat: "friperie", besoins: ["vetements", "autre"], solidaire: true },
  { q: "bains-douches municipaux", cat: "toilettes", besoins: ["hygiene", "autre"], solidaire: true },
  // Santé courante : ces lieux sont utiles, mais ne sont jamais présentés
  // comme gratuits sans donnée explicite de la fiche.
  { q: "pharmacie", cat: "sante", besoins: ["sante"], santeIntentions: ["medicaments"] },
  { q: "h\xF4pital urgences", cat: "sante", besoins: ["sante"], santeIntentions: ["hopital"], urgent: true },
  { q: "m\xE9decin g\xE9n\xE9raliste", cat: "sante", besoins: ["sante"], santeIntentions: ["soins"] },
  { q: "centre de sant\xE9", cat: "sante", besoins: ["sante"], santeIntentions: ["soins"] },
  { q: "kin\xE9sith\xE9rapeute physioth\xE9rapeute", cat: "sante", besoins: ["sante"], santeIntentions: ["soins"] },
  { q: "dentiste clinique dentaire", cat: "sante", besoins: ["sante"], santeIntentions: ["dentaire"] },
  { q: "laboratoire analyses m\xE9dicales", cat: "sante", besoins: ["sante"], santeIntentions: ["depistage"] },
  { q: "centre de d\xE9pistage CeGIDD", cat: "sante", besoins: ["sante"], santeIntentions: ["depistage", "sexuelle"], accesAdapte: true, solidaire: true },
  { q: "Planning Familial", cat: "sante", besoins: ["sante", "famille"], santeIntentions: ["sexuelle"], solidaire: true },
  { q: "PMI protection maternelle infantile", cat: "sante", besoins: ["sante", "famille"], santeIntentions: ["sexuelle"], solidaire: true },
  {
    q: "PASS permanence acc\xE8s aux soins",
    cat: "sante",
    besoins: ["sante"],
    santeIntentions: ["acces", "soins", "medicaments", "hopital", "dentaire", "depistage", "sexuelle"],
    accesAdapte: true,
    solidaire: true
  },
  // Soutien psychologique : Text Search complète les types Google, qui ne
  // proposent pas de type de requête « psychologist ». Les réseaux publics ou
  // pris en charge restent distingués d'un cabinet privé.
  {
    q: "CMP centre m\xE9dico-psychologique",
    cat: "sante",
    besoins: ["parler"],
    santeIntentions: ["mentale", "acces"],
    accesAdapte: true,
    solidaire: true
  },
  {
    q: "CMPP centre m\xE9dico-psycho-p\xE9dagogique",
    cat: "sante",
    besoins: ["parler", "famille", "jeunes"],
    santeIntentions: ["mentale", "acces"],
    accesAdapte: true,
    solidaire: true
  },
  {
    q: "BAPU bureau aide psychologique universitaire",
    cat: "sante",
    besoins: ["parler", "jeunes"],
    santeIntentions: ["mentale", "acces"],
    accesAdapte: true,
    solidaire: true
  },
  {
    q: "PAEJ point accueil \xE9coute jeunes",
    cat: "sante",
    besoins: ["parler", "jeunes"],
    santeIntentions: ["mentale"],
    solidaire: true
  },
  {
    q: "Maison des adolescents psychologue",
    cat: "sante",
    besoins: ["parler", "jeunes"],
    santeIntentions: ["mentale"],
    solidaire: true
  },
  {
    q: "Sant\xE9 Psy \xC9tudiant psychologue",
    cat: "sante",
    besoins: ["parler", "jeunes"],
    santeIntentions: ["mentale", "acces"],
    accesAdapte: true,
    solidaire: true
  },
  {
    q: "Mon soutien psy psychologue conventionn\xE9",
    cat: "sante",
    besoins: ["parler"],
    santeIntentions: ["mentale"]
  }
];
const zonesAideChargees = /* @__PURE__ */ new Map();
const chargementsAideEnCours = /* @__PURE__ */ new Map();
const AIDE_RAYON_RECHARGE = 5e3;
const AIDE_DELAI_SOURCE_MS = 9e3;
let rayonAidePalierEnCours = null;
const RAYON_AIDE = window.AutourAideRayon || null;
let besoinsSecondairesAide = [];
const POIDS_BESOIN_SECONDAIRE = 0.6;
let rayonAideAtteint = RAYON_AIDE ? RAYON_AIDE.premier() : 3e3;
let aideEnCours = false;
let aidesEnVol = 0;
let aideEtrangersEcartes = false;
function codePaysAide(l) {
  const tags = l && l.tags || {};
  const brut = l && (l.country_code || l.countryCode || l.pays || l.country || tags["addr:country"] || tags.country);
  if (brut) {
    const v = sansAccents(brut).replace(/[^a-z]/g, "");
    if (v === "fr" || v === "france" || v === "fra") return "FR";
    if (v === "be" || v === "belgique" || v === "belgium" || v === "belgie") return "BE";
    if (v.length === 2 || v.length === 3) return v.toUpperCase();
  }
  const texte = [l && l.adresse, l && l.cp, l && l.titre, l && l.title].filter(Boolean).join(" ");
  if (/\b(?:belgique|belgium|belgie|mouscron|moeskroen|courtrai|kortrijk)\b/i.test(texte)) return "BE";
  return null;
}
function estAideFrance(l) {
  const pays = codePaysAide(l);
  return !pays || pays === "FR";
}
function resultatsAideDansTerritoire(liste) {
  const retenus = [];
  (liste || []).forEach((l) => {
    if (!dansZoneActive(l)) return;
    if (!estAideFrance(l)) {
      aideEtrangersEcartes = true;
      return;
    }
    retenus.push(l);
  });
  return retenus;
}
async function lieuxAideInstitutionnels(lat, lng, contexte, signal) {
  const fournisseur = window.AutourProviders && AutourProviders.aideInstitutionnelle;
  const besoins = contexte && Array.isArray(contexte.besoins) ? contexte.besoins : [];
  if (!fournisseur || !besoins.some((id) => id === "travail" || id === "jeunes")) return [];
  try {
    const places = await fournisseur.nearby(lat, lng, { needs: besoins, radius: 15e3, signal });
    return places.map((p) => AutourProviders.versInterne(p)).filter(Boolean);
  } catch (e) {
    return [];
  }
}
const TYPES_GOOGLE_AIDE = /* @__PURE__ */ new Set([
  "association_or_organization",
  "non_profit_organization",
  "social_services_organization",
  "welfare_organization",
  "employment_agency",
  "government_office",
  "local_government_office",
  "city_hall",
  "post_office",
  "hospital",
  "general_hospital",
  "medical_center",
  "medical_clinic",
  "dental_clinic",
  "dentist",
  "medical_lab",
  "physiotherapist",
  "pharmacy",
  "doctor",
  "drugstore"
]);
const TYPES_GOOGLE_TOURISTIQUES = /* @__PURE__ */ new Set([
  "hotel",
  "lodging",
  "hostel",
  "motel",
  "guest_house",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "historic_site",
  "monument"
]);
function fournisseurGoogleAide(f, cat) {
  const types = [f && f.primaryType, f && f.type, ...f && f.categories || []].filter(Boolean).map((s) => String(s).toLowerCase());
  if (types.some((t) => TYPES_GOOGLE_TOURISTIQUES.has(t))) return false;
  if (TYPES_GOOGLE_AIDE.has(String(f && (f.primaryType || f.type) || "").toLowerCase())) return true;
  return cat === "sante" && types.some((t) => TYPES_GOOGLE_AIDE.has(t));
}
const IA_AIDE = window.AutourAideContexteIA || null;
let phraseAideCourante = null;
let ordreModeleAide = null;
let cleOrdreModeleAide = null;
let demandeOrdreAideEnCours = false;
function oublierPhraseAide() {
  phraseAideCourante = null;
  ordreModeleAide = null;
  cleOrdreModeleAide = null;
}
function contexteAideChargement() {
  const besoins = typeof besoinsSelectionnesAide === "function" ? besoinsSelectionnesAide().slice() : [];
  const choix = typeof sousAideChoisi === "function" ? sousAideChoisi() : null;
  const urgence = !!(choix && choix.urgentSeul);
  return {
    besoins,
    urgence,
    santeIntentions: Array.isArray(intentionsSanteAide) ? intentionsSanteAide.slice() : [],
    cats: choix && Array.isArray(choix.cats) ? choix.cats.slice() : CATS_AIDE.slice(),
    cle: urgence ? "urgence" : (besoins.slice().sort().join("+") || "general") + (intentionsSanteAide.length ? "|" + intentionsSanteAide.slice().sort().join("+") : "")
  };
}
function reseauxPourContexteAide(contexte) {
  if (contexte.urgence) return RESEAUX_AIDE.filter((r) => r.urgent).slice(0, 6);
  if (!contexte.besoins.length) return [];
  const principal = contexte.besoins[0];
  const correspond = (r) => (r.besoins || []).some((id) => contexte.besoins.includes(id));
  let eligibles = [
    ...RESEAUX_AIDE.filter((r) => (r.besoins || []).includes(principal)),
    ...RESEAUX_AIDE.filter((r) => correspond(r) && !(r.besoins || []).includes(principal))
  ];
  const intentions = contexte.santeIntentions || [];
  const services = intentions.filter((id) => id !== "acces");
  if (services.length)
    eligibles = eligibles.filter((r) => (r.santeIntentions || []).some((id) => services.includes(id)));
  if (intentions.includes("acces"))
    eligibles = eligibles.filter((r) => r.accesAdapte === true);
  return eligibles.slice(0, 6);
}
async function chargerAide(lat, lng, options) {
  const o = options || {};
  const contexte = contexteAideChargement();
  const cleZoneAide = idZoneActive() + "|" + contexte.cle;
  const deja = zonesAideChargees.get(cleZoneAide);
  if (o.force) zonesAideChargees.delete(cleZoneAide);
  else if (deja && distanceM(deja[0], deja[1], lat, lng) < AIDE_RAYON_RECHARGE) return;
  const cleChargement = idZoneActive() + "|" + lat.toFixed(2) + "," + lng.toFixed(2) + "|" + contexte.cle;
  const enVol = chargementsAideEnCours.get(cleChargement);
  if (enVol) {
    if (!o.force && generationCourante(enVol.generation)) return enVol.promesse;
    chargementsAideEnCours.delete(cleChargement);
  }
  const generation = nouvelleGeneration("zone:aide", cleChargement, !!o.force);
  prendreEtatRecherche("places", generation);
  prendreEtatRecherche("overpass", generation);
  aidesEnVol += 1;
  aideEnCours = true;
  definirEtatRechercheVersionne("places", SEARCH_STATES.LOADING_PLACES, generation);
  definirEtatRechercheVersionne("overpass", SEARCH_STATES.IDLE, generation);
  const promesse = (async () => {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const exploitable = await chargerAideVraiment(lat, lng, generation, contexte);
      if (exploitable && generationCourante(generation))
        zonesAideChargees.set(cleZoneAide, [lat, lng]);
    } finally {
      aidesEnVol = Math.max(0, aidesEnVol - 1);
      aideEnCours = aidesEnVol > 0;
      if (feuilleNiveau !== null) planifierRendu({ feuille: true });
      if (generationCourante(generation)) {
        const trouve = contexte.besoins.length ? lieux.some((l) => dansZoneActive(l) && AIDE && AIDE.estSolution(l, contexte.besoins)) : lieux.some((l) => dansZoneActive(l) && correspondUneCategorie(l, SET_AIDE));
        definirEtatRechercheVersionne("places", trouve ? SEARCH_STATES.SUCCESS : SEARCH_STATES.EMPTY, generation);
        terminerGeneration(generation);
      }
    }
  })();
  chargementsAideEnCours.set(cleChargement, { promesse, generation });
  try {
    return await promesse;
  } finally {
    const inscrit = chargementsAideEnCours.get(cleChargement);
    if (inscrit && inscrit.promesse === promesse)
      chargementsAideEnCours.delete(cleChargement);
  }
}
async function chargerAideVraiment(lat, lng, generation, contexte) {
  charge("Recherche des points d\u2019aide\u2026");
  aideEtrangersEcartes = false;
  const catsContexte = contexte.besoins.some((id) => id === "sante" || id === "parler") ? ["sante"] : contexte.cats.filter((cat) => CATS_AIDE.includes(cat));
  const reseaux = reseauxPourContexteAide(contexte);
  const exploitable = await coordonnerSourcesVersionnees([
    {
      /* L'annuaire public donne le type normalisé et l'identité officielle.
         OSM arrive ensuite pour compléter les objets non référencés, jamais
         pour remplacer cette source. */
      charger: () => lieuxAideInstitutionnels(lat, lng, contexte, generation.signal),
      publier: (locaux) => {
        const retenus = resultatsAideDansTerritoire(locaux || []);
        if (retenus.length) fusionner(retenus, "permanent");
        return !!retenus.length;
      }
    },
    {
      /* ---- LE RAYON PROGRESSIF ------------------------------------------
      
               On demandait neuf kilomètres, une fois, et personne ne savait à quelle
               distance les résultats avaient été trouvés. En centre-ville c'était la
               moitié de la métropole ; à la campagne, une permanence à douze
               kilomètres n'existait pas.
      
               On cherche donc d'abord très localement, et on n'élargit QUE si l'on
               n'a pas assez de structures fiables. On ne complète jamais une liste
               courte pour atteindre un chiffre : deux structures fiables valent
               mieux que dix douteuses.
      
               Chaque palier interroge OpenStreetMap et fusionne ; le compte se fait
               ensuite sur ce que l'écran retiendrait vraiment — `estSolutionAideLiee`,
               c'est-à-dire le classement complet, pas le nombre d'objets ramenés. */
      charger: async () => {
        const cats = catsContexte.length ? catsContexte : CATS_AIDE;
        const connus = resultatsAideDansTerritoire(lireCacheProche(lat, lng) || []);
        if (connus.length) {
          fusionner(connus, "permanent");
          majFeuille2();
          PERF.jalon("aide_cache_visible");
        }
        let palier = RAYON_AIDE ? RAYON_AIDE.premier() : 3e3;
        let dernierResultat = null;
        let jamaisRepondu = true;
        for (; ; ) {
          rayonAidePalierEnCours = palier;
          const budget = palier <= 1500 ? 5e3 : palier <= 5e3 ? 8e3 : 12e3;
          const r = await vraisLieux(
            lat,
            lng,
            null,
            { cats, rayon: palier, limite: 180, delai: budget, signal: generation.signal }
          );
          if (!generationCourante(generation)) return r;
          const locaux = r && r.ok ? resultatsAideDansTerritoire(r.lieux) : [];
          if (r && r.ok) {
            jamaisRepondu = false;
            dernierResultat = Object.assign({}, r, { lieux: locaux });
          } else if (jamaisRepondu) dernierResultat = r;
          rayonAideAtteint = palier;
          if (locaux.length) {
            fusionner(locaux, "permanent");
            completerCacheLieux(lat, lng, locaux);
            definirEtatRechercheVersionne("overpass", SEARCH_STATES.SUCCESS, generation);
            majFeuille2();
          }
          if (!RAYON_AIDE) break;
          if (!r || !r.ok) {
            if (r && r.raison === "annule") break;
            definirEtatRechercheVersionne("overpass", SEARCH_STATES.OVERPASS_UNAVAILABLE, generation);
            break;
          }
          const retenus = lieux.filter(estSolutionAideLiee);
          const verdict = RAYON_AIDE.evaluer(retenus, palier);
          if (!verdict.elargir) break;
          palier = verdict.prochain;
        }
        return dernierResultat;
      },
      publier: (r) => {
        const osm = r && r.ok ? r.lieux : [];
        if (r && r.ok) definirEtatRechercheVersionne("overpass", SEARCH_STATES.SUCCESS, generation);
        return osm.length > 0;
      },
      echec: () => definirEtatRechercheVersionne("overpass", SEARCH_STATES.OVERPASS_UNAVAILABLE, generation)
    },
    {
      /* AUCUNE SOURCE N'A LE DROIT DE NE JAMAIS RÉPONDRE.
      
               `fetch` n'a pas de délai par défaut. Sur un réseau mobile, une
               connexion qui se perd sans être fermée — un changement d'antenne, un
               portail captif — laisse la promesse en vol indéfiniment. Or la fin de
               `coordonnerSourcesVersionnees` est ce qui retire le voile
               « Recherche des points d'aide… » ET ce qui libère la clé de
               chargement : une seule socket muette gelait donc l'écran Aide et
               interdisait toute nouvelle recherche dans la même zone.
      
               C'est la panne « ça tourne dans le vide sur téléphone, jamais sur
               ordinateur » : sur une liaison stable la réponse arrive toujours, et
               le défaut manquant ne se voit pas.
      
               `avecDelai` rend une valeur neutre quand le temps est écoulé. La
               requête part quand même — elle finira peut-être et remplira les
               caches — mais elle ne retient plus personne. */
      charger: () => avecDelai(
        lieuxDatatourisme(lat, lng, generation.signal),
        AIDE_DELAI_SOURCE_MS,
        [],
        generation.signal
      ),
      publier: (tourisme) => {
        const locaux = resultatsAideDansTerritoire(tourisme || []);
        if (locaux.length) {
          fusionner(locaux, "datatourisme");
          majFeuille2();
        }
        return !!locaux.length;
      }
    },
    {
      charger: async () => {
        const garder = [];
        await Promise.all(reseaux.map(async (r) => {
          const res = await avecDelai(
            chercherGoogle(r.q, lat, lng, { signal: generation.signal }),
            AIDE_DELAI_SOURCE_MS,
            [],
            generation.signal
          );
          if (!generationCourante(generation)) return;
          res.forEach((f) => {
            if (distanceM(lat, lng, f.lat, f.lng) > 15e3) return;
            if (!dansZoneActive(f) || !estAideFrance(f)) {
              aideEtrangersEcartes = true;
              return;
            }
            f.solidaire = !!r.solidaire;
            f.accesSanteDocumente = r.accesAdapte === true;
            f.isAidProvider = fournisseurGoogleAide(f, r.cat);
            garder.push({ f, cat: r.cat });
          });
        }));
        return garder;
      },
      publier: (garder) => {
        const parCategorie = /* @__PURE__ */ new Map();
        (garder || []).forEach(({ f, cat }) => {
          if (!parCategorie.has(cat)) parCategorie.set(cat, []);
          parCategorie.get(cat).push(f);
        });
        parCategorie.forEach((fiches, cat) => ajouterLieuxGoogle(fiches, cat));
        if (parCategorie.size) majFeuille2();
        return !!(garder && garder.length);
      }
    }
  ], () => generationCourante(generation));
  charge(null);
  if (generationCourante(generation)) majAccueil();
  return exploitable;
}
function villeRecherchee(q) {
  const m = /(?:^|\s)(?:a|à|sur|vers|dans)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{2,}(?:[ -][A-Za-zÀ-ÿ][\wÀ-ÿ'’-]+){0,3})\s*$/.exec(q.trim());
  return m ? m[1].trim() : null;
}
const ECART_IMPORTANCE = 0.15;
async function geocoderVille(nom, pres, signal) {
  try {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=" + encodeURIComponent(nom),
      { signal, headers: { "Accept-Language": "fr" } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.length) return null;
    const depuis = pres || positionMoi;
    const meilleure = j.reduce((m, x) => Math.max(m, Number(x.importance) || 0), 0);
    const candidats = j.filter((x) => meilleure - (Number(x.importance) || 0) <= ECART_IMPORTANCE);
    const choisi = depuis ? candidats.reduce((a, x) => {
      const d = distanceM(depuis[0], depuis[1], parseFloat(x.lat), parseFloat(x.lon));
      return a && a.d <= d ? a : { x, d };
    }, null).x : candidats[0];
    const bb = choisi.boundingbox;
    return {
      lat: parseFloat(choisi.lat),
      lng: parseFloat(choisi.lon),
      nom: choisi.display_name || nom,
      emprise: Array.isArray(bb) && bb.length === 4 ? [[parseFloat(bb[0]), parseFloat(bb[2])], [parseFloat(bb[1]), parseFloat(bb[3])]] : null
    };
  } catch (e) {
    return null;
  }
}
async function rechercherAilleurs(phrase, ville) {
  const generation = nouvelleGeneration("recherche:ailleurs", phrase + "|" + ville, true);
  charge("Recherche \xE0 " + ville + "\u2026");
  try {
    const zone = await geocoderVille(ville, null, generation.signal);
    if (!generationCourante(generation)) return;
    const pos = zone ? [zone.lat, zone.lng] : null;
    const depuis = pos || positionMoi;
    const res = await chercherGoogle(phrase, depuis[0], depuis[1], { signal: generation.signal });
    if (!generationCourante(generation)) return;
    charge(null);
    if (!res.length) {
      toast("Rien trouv\xE9 \xE0 " + ville);
      return;
    }
    if (pos) allerVers(pos, 13, { duration: 0.8 });
    ajouterLieuxGoogle(res, "commerce");
    const ids = new Set(res.map((f) => "g" + hash(f.nom + f.lat)));
    const trouves = lieux.filter((l) => ids.has(l.id));
    if (!trouves.length) {
      toast("Rien trouv\xE9 \xE0 " + ville);
      return;
    }
    const vrai = positionMoi;
    positionMoi = depuis;
    const classes = classerLieux(trouves, false);
    positionMoi = vrai;
    const montres = classes.slice(0, plafondPour(zone));
    selectionAccueil = false;
    fermerFeuille2();
    pileEcrans = [];
    pousserEcran(() => afficherListe(
      "\u{1F4CD}",
      esc(ville),
      montres,
      false,
      () => rechercherAilleurs(phrase, ville)
    ));
  } finally {
    if (generationCourante(generation)) {
      charge(null);
      terminerGeneration(generation);
    }
  }
}
function completerParGoogle(q, catDefaut, redessiner) {
  if (!positionMoi) return;
  const generation = nouvelleGeneration("recherche:complement", q + "|" + (catDefaut || ""), true);
  chercherGoogle(q, positionMoi[0], positionMoi[1], { signal: generation.signal }).then((res) => {
    if (!generationCourante(generation) || !res.length) return;
    if (ajouterLieuxGoogle(res, catDefaut)) redessiner();
  }).finally(() => terminerGeneration(generation));
}
const MOMENTS = [
  // la mairie a disparu d'ici : elle était favorisée tous les matins alors
  // que personne n'ouvre l'app pour qu'on lui propose un guichet
  {
    de: 6,
    a: 11,
    nom: "ce matin",
    poids: { cafe: 3, marche: 3, emploi: 2, sante: 2, alimentaire: 2, coworking: 2 }
  },
  {
    de: 11,
    a: 14,
    nom: "ce midi",
    poids: { resto: 3, alimentaire: 3, fastfood: 2, cafe: 2, marche: 2 }
  },
  {
    de: 14,
    a: 18,
    nom: "cet apr\xE8s-midi",
    poids: { biblio: 2, coworking: 2, musee: 2, parc: 2, asso: 2, emploi: 2, terrain: 2, friperie: 2, commerce: 2 }
  },
  {
    de: 18,
    a: 23,
    nom: "ce soir",
    poids: { concert: 4, spectacle: 4, bar: 3, resto: 3, cinema: 3, fastfood: 2 }
  },
  {
    de: 23,
    a: 6,
    nom: "cette nuit",
    poids: { sante: 3, hebergement: 3, bar: 2, fastfood: 2 }
  }
];
function momentActuel() {
  const h = instantCreneau().getHours();
  return MOMENTS.find((m) => m.de < m.a ? h >= m.de && h < m.a : h >= m.de || h < m.a) || MOMENTS[0];
}
const SUGGESTIONS_MOMENT = {
  "ce matin": [
    { t: "Petit-d\xE9jeuner", cats: ["cafe"] },
    { t: "Bosser au calme", cats: ["biblio", "coworking", "cafe"] },
    { t: "March\xE9", cats: ["marche"] },
    { t: "Prendre l\u2019air", cats: ["parc"] }
  ],
  "ce midi": [
    { t: "Manger", cats: ["resto", "fastfood", "food"] },
    { t: "Pas cher", f: "budget" },
    { t: "Pr\xE8s de moi", f: "proche" },
    { t: "Ouvert maintenant", f: "ouvert" }
  ],
  "cet apr\xE8s-midi": [
    { t: "\xC9tudier", cats: ["biblio", "coworking", "cafe"] },
    { t: "Prendre l\u2019air", cats: ["parc"] },
    { t: "Fripes & pop-up", cats: ["friperie", "popup", "marche"] },
    { t: "Bouger", cats: ["terrain", "sport"] }
  ],
  "ce soir": [
    { t: "Restaurant", cats: ["resto"] },
    { t: "Sortir", cats: ["concert", "spectacle", "bar", "event"] },
    { t: "Cin\xE9ma", cats: ["cinema"] },
    { t: "Surprends-moi", hasard: true }
  ],
  "cette nuit": [
    { t: "Ouvert maintenant", f: "ouvert" },
    { t: "Pharmacie", cats: ["sante"] },
    { t: "Rentrer", cats: ["metro", "bus", "velo"] },
    { t: "Un abri", modeAide: true, sous: "dormir" }
  ]
};
function suggestionsDuMoment() {
  return SUGGESTIONS_MOMENT[momentActuel().nom] || SUGGESTIONS_MOMENT["cet apr\xE8s-midi"];
}
function appliquerSuggestion(s) {
  const z = $("#suggestions");
  if (z) z.hidden = true;
  const r = $("#rech");
  if (r) r.blur();
  if (s.hasard) {
    surprendre();
    return;
  }
  if (s.modeAide) {
    if (!modeAide) basculerAide();
    sousAide = s.sous || null;
    majFiltres();
    rendre();
    majAccueil();
    majFeuille2();
    return;
  }
  if (s.f) {
    filtresHumains.add(s.f);
    if (s.f === "famille") chargerEditorial("family");
    toutAfficher();
    majFiltres();
    toast(s.t);
    return;
  }
  catsActives = new Set(s.cats);
  filtreActif = "tout";
  selectionAccueil = false;
  chargerPourCats(s.cats);
  if (s.cats.includes("family")) chargerEditorial("family");
  else if (s.cats.includes("cinema")) chargerEditorial("cinema");
  else if (s.cats.includes("event")) chargerEditorial("events");
  if (s.aide && positionMoi) chargerAideZone();
  mettreAJourProfil("categorie", s.cats[0]);
  dessinerFiltres();
  majFiltres();
  rendre();
  toast(s.t);
}
function rangeeSuggestions() {
  return '<div class="sg-rapides">' + suggestionsDuMoment().map((s, i) => '<button class="sg-rapide" data-sug="' + i + '">' + esc(s.t) + "</button>").join("") + "</div>";
}
function brancherSuggestions(zone) {
  const liste = suggestionsDuMoment();
  zone.querySelectorAll("[data-sug]").forEach((b) => b.onclick = () => {
    zone.hidden = true;
    layerManager.deactivate(NOMS_COUCHES.searchOverlay);
    appliquerSuggestion(liste[Number(b.dataset.sug)]);
  });
}
const POIDS = {
  motCle: 40,
  // la recherche prime sur tout le reste
  ouvert: 25,
  tresProche: 20,
  // moins de RAYON_PROCHE mètres
  evenementImminent: 20,
  // commence dans les deux heures
  categorieRecente: 40,
  // tu es revenu plusieurs fois dessus : le signal doit peser
  populaire: 10,
  recent: 10,
  // publié aujourd'hui
  moment: 14,
  // pertinence horaire de la catégorie
  mien: 40,
  ferme: -70,
  eloigne: -15,
  ignore: -10,
  DECROISSANCE: 800,
  // mètres : au-delà l'envie de se déplacer chute
  RAYON_PROCHE: 400,
  PLAFOND_SERRE: 24,
  // marqueurs max en vue rapprochée
  PLAFOND_LARGE: 14,
  SEUIL_NIVEAU_B: 45
  // en dessous, le lieu passe en niveau C (masqué)
};
const PROFIL_VIDE = {
  categories: {},
  recherches: [],
  heures: {},
  rayon: 1200,
  ignores: {},
  vu: 0
};
let PROFIL = (() => {
  try {
    return Object.assign(
      {},
      PROFIL_VIDE,
      JSON.parse(localStorage.getItem("autour:profil") || "{}")
    );
  } catch (e) {
    return Object.assign({}, PROFIL_VIDE);
  }
})();
let personnalisation = localStorage.getItem("autour:perso") !== "non";
function enregistrerProfil() {
  try {
    localStorage.setItem("autour:profil", JSON.stringify(PROFIL));
  } catch (e) {
  }
}
function mettreAJourProfil(action, valeur) {
  if (!personnalisation) return;
  const h = (/* @__PURE__ */ new Date()).getHours();
  PROFIL.heures[h] = (PROFIL.heures[h] || 0) + 1;
  if (action === "categorie" && valeur)
    PROFIL.categories[valeur] = (PROFIL.categories[valeur] || 0) + 1;
  if (action === "clic" && valeur) {
    PROFIL.categories[valeur] = (PROFIL.categories[valeur] || 0) + 2;
    PROFIL.vu++;
  }
  if (action === "recherche" && valeur) {
    PROFIL.recherches.unshift(String(valeur).slice(0, 40));
    PROFIL.recherches = PROFIL.recherches.slice(0, 12);
  }
  if (action === "ignore" && valeur)
    PROFIL.ignores[valeur] = (PROFIL.ignores[valeur] || 0) + 1;
  enregistrerProfil();
}
function obtenirInteretsProbables() {
  const e = Object.entries(PROFIL.categories);
  if (!e.length) return [];
  const moyenne = e.reduce((s, [, n]) => s + n, 0) / e.length;
  return e.filter(([, n]) => n >= 2 && n >= moyenne).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
}
function reinitialiserProfil() {
  PROFIL = Object.assign({}, PROFIL_VIDE, { categories: {}, ignores: {}, heures: {}, recherches: [] });
  enregistrerProfil();
  toast("Pr\xE9f\xE9rences effac\xE9es");
  rendre();
  majAccueil();
}
function contexteActuel() {
  const d = instantCreneau();
  const c = map ? map.getCenter() : null;
  return {
    t: d.getTime(),
    heure: d.getHours(),
    jour: d.getDay(),
    moment: momentActuel(),
    centre: c ? [c.lat, c.lng] : positionMoi,
    /* Point de référence du classement. Normalement soi ; mais quand on est
       parti voir ailleurs, « loin de chez toi » n'est plus un défaut du lieu :
       tout Paris est loin de Tourcoing, et la pénalité de distance écartait
       alors l'intégralité des résultats de la zone demandée. */
    moi: centreZoneActive() || [0, 0],
    /* La vraie position, pour ce qui parle bien de la personne — un itinéraire
       part d'où l'on est, pas d'où l'on regarde. */
    positionReelle: positionMoi || [0, 0],
    q: sansAccents(recherche.trim()),
    interets: personnalisation ? obtenirInteretsProbables() : [],
    large: map ? map.getZoom() < 15 : false
  };
}
function vacancesScolaires(d) {
  const m = d.getMonth() + 1, j = d.getDate();
  if (m === 7 || m === 8) return { nom: "vacances d\u2019\xE9t\xE9", sur: true };
  if (m === 9 && j <= 1) return { nom: "vacances d\u2019\xE9t\xE9", sur: true };
  if (m === 10 && j >= 18) return { nom: "vacances de la Toussaint", sur: true };
  if (m === 11 && j <= 2) return { nom: "vacances de la Toussaint", sur: true };
  if (m === 12 && j >= 20) return { nom: "vacances de No\xEBl", sur: true };
  if (m === 1 && j <= 5) return { nom: "vacances de No\xEBl", sur: true };
  if (m === 2 || m === 3 && j <= 9) return { nom: "vacances d\u2019hiver", sur: false };
  if (m === 4 && j >= 8 || m === 5 && j <= 10) return { nom: "vacances de printemps", sur: false };
  return null;
}
function demandeExplicite(l, ctx) {
  if (catsActives && correspondUneCategorie(l, catsActives)) return true;
  if (correspondCategorie(l, filtreActif)) return true;
  if (!ctx.q || ctx.q.length < 3) return false;
  if (sansAccents(l.titre).includes(ctx.q)) return true;
  return categorieRecherchee(ctx.q) === l.cat;
}
let montrerFermes = false;
let modeAide = false;
const CATS_AIDE = [
  "alimentaire",
  "hebergement",
  "asso",
  "emploi",
  "sante",
  "toilettes",
  "collecte",
  "securite",
  "mairie"
];
const SET_AIDE = new Set(CATS_AIDE);
const SOUS_AIDE = (AIDE ? AIDE.BESOINS_GRILLE : []).map((b) => ({
  id: b.id,
  emoji: b.emoji,
  label: b.label,
  cats: b.cats
}));
const AIDE_URGENCE = {
  id: "urgence",
  emoji: "\u{1F6A8}",
  label: "Urgence",
  urgentSeul: true,
  cats: ["hebergement", "sante", "asso", "alimentaire"]
};
let sousAide = null;
let redirectionExplorer = null;
let besoinsAide = [];
let ageDeclare = null;
let intentionsSanteAide = [];
function sousAideChoisi() {
  if (sousAide === "urgence") return AIDE_URGENCE;
  return sousAide ? SOUS_AIDE.find((x) => x.id === sousAide) : null;
}
const URGENCE = {
  hebergement: 5,
  sante: 5,
  alimentaire: 4,
  collecte: 4,
  asso: 3,
  emploi: 3,
  friperie: 2,
  toilettes: 2,
  mairie: 2,
  food: 3
};
const URGENT_AU_NOM = /urgence|\b115\b|samu\s*social|sans[- ]abri|maraude|accueil\s*de\s*jour|halte\s*de\s*nuit|nuit[ée]e/i;
const POIDS_AIDE = {
  ouvert: 130,
  // 1. une porte ouverte maintenant prime sur tout
  aujourdhui: 60,
  // 2. sinon : ouvre encore aujourd'hui
  proximite: 90,
  // 3. proximité, décroissance douce
  DECROISSANCE: 1600,
  // on marche plus loin pour manger que pour un café
  urgence: 13,
  // 4. multiplié par le niveau d'urgence (1 à 5)
  pertinence: 165,
  // un réseau spécialisé gagne sur une catégorie large
  solidaire: 25,
  verifie: 18,
  ferme: -140,
  inconnu: -20
  // horaires inconnus : utile, mais après ce qui est sûr
};
function disponibleAujourdhui(l) {
  if (estTemporaire(l)) {
    const etat2 = statutTemps(l);
    if (etat2.statut === TEMPS.STATUTS.INCONNU) return null;
    if (etat2.statut === TEMPS.STATUTS.PASSE) return false;
    return etat2.statut !== TEMPS.STATUTS.A_VENIR;
  }
  const h = horaireDuJour(l);
  if (h) return !/ferm/i.test(h);
  if (l.ouvert === true) return true;
  return null;
}
function niveauUrgence(l) {
  if (AIDE && AIDE.estServiceUrgence && AIDE.estServiceUrgence(l)) return 5;
  return Math.min(4, URGENCE[l.cat] || 1);
}
function scoreAide(l, ctx) {
  const dMoi = distanceM(ctx.moi[0], ctx.moi[1], l.lat, l.lng);
  const dVue = ctx.centre ? distanceM(ctx.centre[0], ctx.centre[1], l.lat, l.lng) : dMoi;
  let s = 0, raisons = [];
  if (l.ouvert === true) {
    s += POIDS_AIDE.ouvert;
    raisons.push([POIDS_AIDE.ouvert, "Ouvert maintenant"]);
  } else if (l.ouvert === false) s += POIDS_AIDE.ferme;
  const dispo = disponibleAujourdhui(l);
  if (dispo === true && l.ouvert !== true) {
    s += POIDS_AIDE.aujourdhui;
    raisons.push([POIDS_AIDE.aujourdhui, "Ouvre encore aujourd\u2019hui"]);
  } else if (dispo === null) s += POIDS_AIDE.inconnu;
  const p = POIDS_AIDE.proximite * Math.exp(-Math.min(dMoi, dVue) / POIDS_AIDE.DECROISSANCE);
  s += p;
  if (dMoi < 700) raisons.push([p, "\xC0 quelques minutes"]);
  const u = niveauUrgence(l);
  s += u * POIDS_AIDE.urgence;
  if (u >= 5) raisons.push([u * POIDS_AIDE.urgence, "Service d\u2019urgence"]);
  const besoins = besoinsSelectionnesAide();
  if (AIDE && besoins.length) {
    const p2 = besoins.map((id) => AIDE.pertinence(l, id, { large: true })).filter((x) => x.direct).sort((a, b) => b.poids - a.poids)[0];
    if (p2) {
      const valeur = p2.poids * POIDS_AIDE.pertinence;
      s += valeur;
      raisons.push([valeur, p2.raison]);
    }
  }
  if (l.solidaire) {
    s += POIDS_AIDE.solidaire;
    raisons.push([POIDS_AIDE.solidaire, "Structure solidaire"]);
  }
  if (l.service) raisons.push([POIDS_AIDE.ouvert - 1, l.service]);
  if (l.verifie) s += POIDS_AIDE.verifie;
  raisons.sort((a, b) => b[0] - a[0]);
  return { score: s, raison: raisons.length ? raisons[0][1] : "Point d\u2019aide" };
}
function catsAideActives() {
  const s = sousAide && SOUS_AIDE.find((x) => x.id === sousAide);
  return s ? new Set(s.cats) : SET_AIDE;
}
function besoinsSelectionnesAide() {
  return besoinsAide.length ? besoinsAide : sousAide && sousAide !== "urgence" ? [sousAide] : [];
}
function estSolutionAideLiee(l) {
  if (!dansZoneActive(l)) return false;
  const choix = sousAideChoisi();
  if (choix && choix.urgentSeul)
    return !!(AIDE && AIDE.estServiceUrgence && AIDE.estServiceUrgence(l));
  const besoins = besoinsSelectionnesAide();
  if (!besoins.length) return correspondUneCategorie(l, catsAideActives());
  const liee = !!(AIDE && AIDE.estSolution(l, besoins));
  if (!liee) return false;
  if ((sousAide === "sante" || sousAide === "parler") && AIDE.estSolutionSante)
    return AIDE.estSolutionSante(
      l,
      intentionsSanteAide,
      { exigerAccesAdapte: intentionsSanteAide.includes("acces") }
    );
  return true;
}
function proposableAuto(l, ctx) {
  if (publicationsEpinglees.has(l.id)) return true;
  if (modeAide) {
    if (!estSolutionAideLiee(l)) return false;
    const s = sousAide && SOUS_AIDE.find((x) => x.id === sousAide);
    if (s && s.solidaireSeul && !l.solidaire) return false;
    if (s && s.urgentSeul && niveauUrgence(l) < 5) return false;
    return true;
  }
  if (demandeExplicite(l, ctx)) return true;
  if (JAMAIS_AUTO.has(l.cat)) return false;
  if (CATS_TRANSPORT.has(l.cat) && !transportsDemandes(ctx)) return false;
  if ((creneau === "maintenant" || filtreMaintenant) && !montrerFermes && estFerme(l)) return false;
  return true;
}
function ecarterFermesSiAlternative(liste) {
  const ouvertes = /* @__PURE__ */ new Set();
  liste.forEach((x) => {
    if (x.l.ouvert === true) ouvertes.add(x.l.cat);
  });
  return liste.filter((x) => x.l.ouvert !== false || !ouvertes.has(x.l.cat));
}
function scoreLieu(l, ctx) {
  if (modeAide) return scoreAide(l, ctx);
  let s = 0, raisons = [];
  const dMoi = distanceM(ctx.moi[0], ctx.moi[1], l.lat, l.lng);
  const dVue = ctx.centre ? distanceM(ctx.centre[0], ctx.centre[1], l.lat, l.lng) : dMoi;
  const eph = estTemporaire(l);
  s += 120 * Math.exp(-Math.min(dMoi, dVue) / POIDS.DECROISSANCE);
  if (dMoi < POIDS.RAYON_PROCHE) {
    s += POIDS.tresProche;
    raisons.push([POIDS.tresProche, "Pr\xE8s de toi"]);
  }
  if (dMoi > 2500) s += POIDS.eloigne;
  if (ctx.q && sansAccents(l.titre + " " + (l.cuisine || "")).includes(ctx.q)) {
    s += POIDS.motCle;
    raisons.push([POIDS.motCle, "Correspond \xE0 ta recherche"]);
  }
  if (l.ouvert === true) {
    s += POIDS.ouvert;
    raisons.push([POIDS.ouvert, "Ouvert maintenant"]);
  }
  if (l.ouvert === false) s += POIDS.ferme;
  if (eph) {
    s += 55;
    if (l.startsAt && l.startsAt > ctx.t && l.startsAt < ctx.t + 2 * 36e5) {
      s += POIDS.evenementImminent;
      raisons.push([POIDS.evenementImminent + 55, "Commence bient\xF4t"]);
    } else if (l.startsAt && l.startsAt <= ctx.t && (!l.endsAt || l.endsAt >= ctx.t)) {
      raisons.push([55, "\xC7a se passe maintenant"]);
    } else if (l.startsAt && l.startsAt > ctx.t) {
      raisons.push([55, "\xC0 venir"]);
    } else raisons.push([55, "Horaire \xE0 v\xE9rifier"]);
  }
  const pm = ctx.moment.poids[l.cat] || 0;
  if (pm) {
    s += pm * POIDS.moment;
    raisons.push([pm * POIDS.moment, "S\xE9lectionn\xE9 pour " + ctx.moment.nom]);
  }
  if (ctx.interets.includes(l.cat)) {
    s += POIDS.categorieRecente;
    raisons.push([POIDS.categorieRecente, "Tu regardes souvent " + ((CATS[l.cat] || {}).label || "\xE7a").toLowerCase()]);
  }
  if (PROFIL.ignores[l.cat]) s += POIDS.ignore * Math.min(3, PROFIL.ignores[l.cat]);
  if (l.avis) {
    const p = Math.min(POIDS.populaire, Math.log10(l.avis + 1) * 5);
    s += p;
    if (p > 6) raisons.push([p, "Appr\xE9ci\xE9 dans le quartier"]);
  }
  if (l.note) s += (l.note - 3.5) * 8;
  if (l.mien) s += POIDS.mien;
  if (l.verifie) s += 12;
  raisons.sort((a, b) => b[0] - a[0]);
  return { score: s, raison: raisons.length ? raisons[0][1] : "Autour de toi" };
}
function niveauLieu(l, ctx, sc) {
  if (modeAide) return "A";
  const dMoi = distanceM(ctx.moi[0], ctx.moi[1], l.lat, l.lng);
  const eph = estTemporaire(l);
  if (l.mien) return "A";
  if (dMoi < 250) return "A";
  if (eph && (!l.debutLe || l.debutLe < ctx.t + 6 * 36e5)) return "A";
  if (["sante", "hebergement", "alimentaire"].includes(l.cat) && ctx.heure >= 21) return "A";
  return sc >= POIDS.SEUIL_NIVEAU_B ? "B" : "C";
}
let feuilleNiveau = null;
let sousChoisi = null;
let historiqueFeuilleBesoins = false;
let ignorerPopFeuilleBesoins = false;
let dernierFocusMainSheet = null;
const NOM_FACULTATIF = /* @__PURE__ */ new Set(["toilettes", "recharge", "velo", "metro", "bus", "parc", "terrain"]);
function nomExploitable(l) {
  if (!l.titre || l.titre.trim().length < 2) return false;
  if (NOM_FACULTATIF.has(l.cat)) return true;
  return !l.sansNom;
}
let rayonRecherche = 2500;
function rayonDeLaZone() {
  if (!CTX || !zoneActive) return rayonRecherche;
  return Math.max(rayonRecherche, CTX.rayonZone(zoneActive) + CTX.MARGE_M);
}
let intentionCourante = null;
function elargirZone() {
  rayonRecherche = Math.min(rayonRecherche * 2, 2e4);
  surLaCarte((m) => m.setZoom(Math.max(12, m.getZoom() - 1)), "zoom");
  const centre = centreZoneActive() || positionMoi;
  if (centre) chargerZone(centre[0], centre[1], { force: true });
  toast("Zone \xE9largie \xE0 " + Math.round(rayonRecherche / 1e3) + " km");
  rendre();
  majAccueil();
}
function compterCats(cats) {
  const set = new Set(cats);
  const [lat, lng] = positionMoi || (map ? [map.getCenter().lat, map.getCenter().lng] : [0, 0]);
  let n = 0;
  for (const l of lieux) {
    if (!correspondUneCategorie(l, set)) continue;
    if (!nomExploitable(l)) continue;
    if (filtreMaintenant && !estVivant(l)) continue;
    if (distanceM(lat, lng, l.lat, l.lng) > rayonRecherche) continue;
    n++;
    if (n > 99) break;
  }
  return n;
}
function typeEditorial(sousChoix) {
  const cats = sousChoix && sousChoix.cats || [];
  if (cats.includes("family")) return "family";
  if (cats.includes("cinema")) return "cinema";
  if (cats.includes("event")) return "events";
  return "autre";
}
function categoriesClassementFeuille() {
  if (feuilleNiveau === "aide") {
    const choix = sousAideChoisi();
    return choix ? choix.cats : CATS_AIDE;
  }
  const besoin = BESOIN_DE(feuilleNiveau);
  if (!besoin || !besoin.sous) return [];
  if (sousChoisi !== null && besoin.sous[sousChoisi]) return besoin.sous[sousChoisi].cats;
  return [...new Set(besoin.sous.flatMap((x) => x.cats))];
}
function classementFeuille() {
  if (feuilleNiveau === null || feuilleNiveau === "racine" || feuilleNiveau === "plus") return [];
  const centre = positionMoi || (map ? [map.getCenter().lat, map.getCenter().lng] : [0, 0]);
  let candidats = lieux.filter(nomExploitable);
  if (feuilleNiveau === "aide") {
    const choix = sousAideChoisi();
    if (choix && choix.urgentSeul) candidats = candidats.filter((l) => niveauUrgence(l) >= 5);
  }
  const classement = rankResults(candidats, {
    intent: feuilleNiveau,
    intention: intentionCourante,
    categories: categoriesClassementFeuille(),
    position: centre,
    now: instantCreneau().getTime(),
    nowOnly: filtreMaintenant && !montrerFermes,
    radius: feuilleNiveau === "aide" ? Math.max(rayonRecherche, 6e3) : rayonRecherche,
    distanceBetween: distanceM,
    horsService,
    saison: contexteSaison(),
    /* Le contexte territorial entre ici comme la saison : un signal de plus
       dans le MÊME score. Aide y compris — il n'existe pas d'« Aide Braderie »,
       seulement l'Aide d'Autour, où les structures temporaires du moment
       remontent par la même ontologie et les mêmes règles. */
    territorial: contexteTerritorialClassement()
  });
  return classement;
}
function reinitialiserScrollFeuille() {
  requestAnimationFrame(() => {
    const corps = $("#fbCorps");
    if (corps) corps.scrollTo({ top: 0, behavior: "auto" });
  });
}
function instantanePanneau(corps) {
  if (!corps) return null;
  const cadre = corps.getBoundingClientRect();
  const ancre = [...corps.querySelectorAll("[data-ac]")].find((el) => el.getBoundingClientRect().bottom > cadre.top + 1);
  const actif = document.activeElement && corps.contains(document.activeElement) ? document.activeElement : null;
  return {
    niveau: feuilleNiveau,
    scrollTop: corps.scrollTop,
    id: ancre && ancre.getAttribute("data-ac"),
    decalage: ancre ? ancre.getBoundingClientRect().top - cadre.top : 0,
    focusId: actif && actif.getAttribute("data-ac")
  };
}
function restaurerPanneau(corps, instantane) {
  if (!corps || !instantane || instantane.niveau !== feuilleNiveau) return;
  requestAnimationFrame(() => {
    if (instantane.niveau !== feuilleNiveau) return;
    corps.scrollTop = instantane.scrollTop;
    if (instantane.scrollTop > 0 && instantane.id) {
      const ancre = [...corps.querySelectorAll("[data-ac]")].find((el) => el.getAttribute("data-ac") === instantane.id);
      if (ancre) {
        const delta = ancre.getBoundingClientRect().top - corps.getBoundingClientRect().top - instantane.decalage;
        if (Math.abs(delta) > 1) corps.scrollTop += delta;
      }
    }
    if (instantane.focusId) {
      const cible = [...corps.querySelectorAll("[data-ac]")].find((el) => el.getAttribute("data-ac") === instantane.focusId);
      if (cible) cible.focus({ preventScroll: true });
    }
  });
}
function etatFeuille() {
  const f = $("#feuilleBesoins");
  if (!f) return "moyenne";
  return f.classList.contains("deplie") ? "deplie" : f.classList.contains("reduite") ? "reduite" : "moyenne";
}
function reglerEtatFeuille(etat2) {
  const feuille = $("#feuilleBesoins");
  if (!feuille) return;
  feuille.classList.toggle("deplie", etat2 === "deplie");
  feuille.classList.toggle("reduite", etat2 === "reduite");
  const poignee = $("#fbPoignee");
  poignee.setAttribute("aria-expanded", String(etat2 === "deplie"));
  poignee.setAttribute(
    "aria-label",
    etat2 === "deplie" ? "R\xE9duire la feuille" : etat2 === "reduite" ? "Afficher les suggestions" : "Agrandir la feuille"
  );
  requestAnimationFrame(synchroniserHauteurFeuille);
}
function reglerFeuilleDeplie(deplie) {
  reglerEtatFeuille(deplie ? "deplie" : "moyenne");
}
function ouvrirFeuille2(niveau) {
  const etaitFermee = feuilleNiveau === null;
  if (etaitFermee) dernierFocusMainSheet = document.activeElement;
  feuilleNiveau = niveau;
  sousChoisi = null;
  const f = $("#feuilleBesoins");
  f.hidden = false;
  delete f.dataset.suspended;
  reglerFeuilleDeplie(false);
  layerManager.activate(NOMS_COUCHES.mainSheet);
  majFeuille2();
  reinitialiserScrollFeuille();
  if (etaitFermee) {
    history.pushState({ autourBesoins: true }, "", location.href);
    historiqueFeuilleBesoins = true;
  }
  const b = BESOIN_DE(niveau);
  const cats = niveau === "aide" || b && b.aide ? CATS_AIDE : b && b.sous ? b.sous.flatMap((x) => x.cats) : null;
  if (cats) {
    const manquantes = cats.filter((c) => !CATS_DEPART.has(c));
    if (manquantes.length) chargerPourCats(manquantes);
    if (niveau === "manger") completerRestauration();
    if (niveau === "famille") chargerEditorial("family");
    if (niveau === "sortir") chargerEditorial("events");
  }
}
function fermerFeuille2(options) {
  const o = options || {};
  feuilleNiveau = null;
  sousChoisi = null;
  const f = $("#feuilleBesoins");
  if (!f) return;
  f.hidden = true;
  delete f.dataset.suspended;
  reglerFeuilleDeplie(false);
  layerManager.deactivate(NOMS_COUCHES.mainSheet);
  synchroniserRechercheDesktop();
  majRaccourcis();
  if (o.nettoyerHistorique !== false && historiqueFeuilleBesoins) {
    historiqueFeuilleBesoins = false;
    ignorerPopFeuilleBesoins = true;
    history.back();
  }
  const focus = dernierFocusMainSheet;
  dernierFocusMainSheet = null;
  requestAnimationFrame(() => {
    const cible = focus && document.contains(focus) ? focus : $("#rech");
    if (cible && !cible.hidden) cible.focus({ preventScroll: true });
  });
}
function majFeuille2() {
  const debutCpu = performance.now();
  try {
    const f = $("#feuilleBesoins");
    if (!f || feuilleNiveau === null || modeNav || modePose) {
      if (f) f.hidden = true;
      synchroniserRechercheDesktop();
      synchroniserHauteurFeuille();
      return;
    }
    PERF.rendus.panneau += 1;
    PERF.exposer();
    f.hidden = false;
    synchroniserRechercheDesktop();
    const corps = $("#fbCorps");
    const stabilite = instantanePanneau(corps);
    const retour = $("#fbRetour");
    f.classList.remove("accueil");
    if (feuilleNiveau === "racine" && zoneAffichee) {
      remplirResultatsZone(zoneAffichee.nom, zoneAffichee.intention);
      restaurerPanneau(corps, stabilite);
      synchroniserHauteurFeuille();
      return;
    }
    if (feuilleNiveau === "racine") {
      const groupe = CRENEAUX.find((x) => x.id === creneau) || CRENEAUX[0];
      const titre = creneau === "maintenant" ? "Autour de toi" : groupe.label;
      $("#fbTitre").textContent = titre;
      retour.hidden = true;
      f.classList.add("accueil");
      const jeton = ++generationAccueil;
      if (annulerRecoDifferee) {
        annulerRecoDifferee();
        annulerRecoDifferee = null;
      }
      corps.innerHTML = blocOuRegarder() + chipsHTML() + /* Sur grand écran elles vivent dans la barre du haut : les rendre ici
         aussi les ferait exister deux fois pour un lecteur d'écran. */
      (NAV_FLOTTANTE.matches ? "" : besoinsRapidesHTML()) + ongletsTemps() + blocNouveauPourToi() + blocMaintenantAccueil() + blocAideAccueil() + '<div class="rc-tete"><strong>' + esc(titre) + '</strong><button class="rc-tout" data-rc-tout="1">Voir tout \u2192</button></div>' + /* Les six grandes portes d'abord — c'est par elles qu'on retrouve les
         lieux permanents et les commodités —, le classement ensuite. */
      (creneau === "maintenant" ? grilleRaccourcisAutour() : "") + '<div data-reco-zone="1">' + recoDejaCalculee(jeton) + "</div>" + (creneau === "maintenant" ? blocTransports() : "") + piedFeuille();
      if (!recoCache || recoCache.cle !== cleReco()) {
        annulerRecoDifferee = ORDO ? ORDO.differer(
          () => poserRecommandations(jeton, titre),
          { timeout: 300, valide: () => generationAccueil === jeton }
        ) : (poserRecommandations(jeton, titre), null);
      }
    } else if (feuilleNiveau === "plus") {
      $("#fbTitre").textContent = "Plus de cat\xE9gories";
      retour.hidden = false;
      corps.innerHTML = BESOINS_SECONDAIRES.map(
        (b) => '<button class="bn" data-bn="' + b.id + '"><em>' + b.emoji + "</em><b>" + esc(b.label) + "</b></button>"
      ).join("");
    } else if (feuilleNiveau === "aide") {
      $("#fbTitre").textContent = "Aide";
      retour.hidden = !sousAide;
      corps.innerHTML = redirectionExplorer ? ecranRedirectionExplorer() : sousAide ? ecranSolutionsAide() : ecranBesoinsAide();
    } else {
      const b = BESOIN_DE(feuilleNiveau);
      if (!b) {
        fermerFeuille2();
        return;
      }
      $("#fbTitre").textContent = b.emoji + " " + b.label;
      retour.hidden = false;
      const choix = b.sous.map((s, i) => ({ s, i, n: compterCats(s.cats) }));
      const selection = sousChoisi === null ? null : choix.find((x) => x.i === sousChoisi);
      corps.innerHTML = blocResultats() + '<p class="fb-section">Pr\xE9ciser mon besoin</p>' + choix.map((x) => '<button class="bn' + (sousChoisi === x.i ? " actif" : "") + '" data-sc="' + x.i + '"><b>' + esc(x.s.label) + "</b><i>" + x.n + "</i></button>").join("") + (selection && selection.n === 0 && !rechercheEnCours() ? messageVide(typeEditorial(selection.s)) : "");
    }
    brancherFeuille2();
    restaurerPanneau(corps, stabilite);
    requestAnimationFrame(synchroniserHauteurFeuille);
  } finally {
    PERF.travail("rendu_panneau", debutCpu);
  }
}
function piedFeuille() {
  return '<div class="fb-pied"><button data-pied="hasard">\u{1F3B2} Surprends-moi</button><button data-pied="partage">\u2197 Partager Autour</button><button data-pied="perso">' + (personnalisation ? "Ne plus personnaliser" : "Personnaliser") + "</button></div>";
}
function messageVide(type) {
  if (!positionConnue()) return '<div class="fb-vide" data-vide="inconnu"><p>Je ne sais pas encore o\xF9 chercher.</p>' + blocOuRegarder() + "</div>";
  return '<div class="fb-vide" data-vide="' + esc(type || "autre") + '">Je n\u2019ai rien trouv\xE9 dans cette zone. \xC7a ne veut pas dire qu\u2019il n\u2019y a rien.<div class="etat-vide-actions"><button data-vide-action="5km">\xC9largir \xE0 5 km</button><button data-vide-action="tout">Voir toutes les cat\xE9gories</button><button data-vide-action="publier">Publier un \xE9v\xE9nement</button></div></div>';
}
function squeletteHTML(n) {
  return '<div class="sq" data-testid="squelette" role="status" aria-live="polite"><span class="sq-dit">On cherche ce qui vaut le d\xE9tour autour de toi\u2026</span>' + Array.from({ length: n || 3 }, () => '<span class="sq-carte"><span class="sq-img"></span><span class="sq-txt"><i></i><i class="court"></i></span></span>').join("") + "</div>";
}
const ETATS_DONNEES = Object.freeze({
  LOCATION_UNKNOWN: "location_unknown",
  LOCATION_LOADING: "location_loading",
  DATA_LOADING: "data_loading",
  READY_WITH_RESULTS: "ready_with_results",
  READY_WITHOUT_RESULTS: "ready_without_results",
  ERROR: "error"
});
function panneTechnique() {
  return rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE || rechercheEtat.places === SEARCH_STATES.OVERPASS_UNAVAILABLE || rechercheEtat.places === SEARCH_STATES.NETWORK_ERROR || rechercheEtat.events === SEARCH_STATES.NETWORK_ERROR || etatErreurPartielle();
}
function etatDonnees(nombreResultats) {
  const n = Number(nombreResultats) || 0;
  if (rechercheEtat.location === SEARCH_STATES.REQUESTING_LOCATION)
    return ETATS_DONNEES.LOCATION_LOADING;
  if (!positionConnue())
    return ETATS_DONNEES.LOCATION_UNKNOWN;
  if (rechercheEnCours())
    return n ? ETATS_DONNEES.READY_WITH_RESULTS : ETATS_DONNEES.DATA_LOADING;
  if (n) return ETATS_DONNEES.READY_WITH_RESULTS;
  if (panneTechnique()) return ETATS_DONNEES.ERROR;
  return ETATS_DONNEES.READY_WITHOUT_RESULTS;
}
const ASSEZ_DE_RESULTATS = 4;
function indicateurRechercheHTML(nombreResultats) {
  if (Number(nombreResultats) >= ASSEZ_DE_RESULTATS) return "";
  return '<div class="fb-statut cherche" role="status" aria-live="polite" data-testid="indicateur-recherche"><i class="cherche-pastille" aria-hidden="true"></i><span>Autour cherche autour de toi\u2026</span></div>';
}
function statutRechercheHTML(nombreResultats) {
  const etat2 = etatDonnees(nombreResultats);
  if (etat2 === ETATS_DONNEES.LOCATION_LOADING) return squeletteHTML(3);
  if (etat2 === ETATS_DONNEES.LOCATION_UNKNOWN)
    return '<div class="fb-statut">Active ta position ou choisis un endroit sur la carte.</div>';
  if (etat2 === ETATS_DONNEES.DATA_LOADING) return squeletteHTML(3);
  if (rechercheEnCours() && nombreResultats) return indicateurRechercheHTML(nombreResultats);
  const sourceIndisponible = panneTechnique();
  if (nombreResultats && sourceIndisponible)
    return '<div class="fb-statut partiel"><span>R\xE9sultats disponibles \xB7 mise \xE0 jour incompl\xE8te</span><button data-etat-action="retry">Actualiser</button></div>';
  if (rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE || rechercheEtat.places === SEARCH_STATES.OVERPASS_UNAVAILABLE)
    return '<div class="fb-statut erreur">Certains lieux n\u2019ont pas pu \xEAtre charg\xE9s. R\xE9essayer.<br><button data-etat-action="retry">R\xE9essayer</button></div>';
  if (rechercheEtat.places === SEARCH_STATES.NETWORK_ERROR || rechercheEtat.events === SEARCH_STATES.NETWORK_ERROR)
    return '<div class="fb-statut erreur">Connexion indisponible. R\xE9essayer.<br><button data-etat-action="retry">R\xE9essayer</button></div>';
  if (etatErreurPartielle())
    return '<div class="fb-statut erreur">Certains lieux n\u2019ont pas pu \xEAtre charg\xE9s. R\xE9essayer.<br><button data-etat-action="retry">R\xE9essayer</button></div>';
  if (!nombreResultats)
    return '<div class="fb-statut">Rien d\u2019ouvert \xE0 proximit\xE9 pour le moment.<br><button data-etat-action="all">Voir tous les lieux</button><button data-etat-action="aide">Trouver de l\u2019aide</button></div>';
  return "";
}
function selectionResultatsFeuille(classement, limite) {
  const items = classement.slice(0, limite);
  if (feuilleNiveau !== "manger" || items.length < limite) return items;
  const complet = (l) => !!(l && l.image && Number.isFinite(Number(l.note)) && Number(l.avis) > 0 && Array.isArray(l.horaires) && l.horaires.length);
  const objectif = Math.min(2, classement.filter(complet).length);
  let presents = items.filter(complet).length;
  if (presents >= objectif) return items;
  const deja = new Set(items.map((l) => l.id));
  const candidats = classement.filter((l) => complet(l) && !deja.has(l.id));
  for (const candidat of candidats) {
    const aRemplacer = items.map((l, i) => ({ l, i })).reverse().find((x) => !complet(x.l));
    if (!aRemplacer) break;
    items[aRemplacer.i] = candidat;
    presents += 1;
    if (presents >= objectif) break;
  }
  const rang = new Map(classement.map((l, i) => [l.id, i]));
  return items.sort((a, b) => (rang.get(a.id) || 0) - (rang.get(b.id) || 0));
}
function blocResultats() {
  const classement = classementFeuille();
  const items = selectionResultatsFeuille(classement, 5);
  const statut = statutRechercheHTML(items.length);
  const chargement = rechercheEnCours();
  const ouverts = classement.filter((l) => l.ouvert === true || l.isTemporary && isAvailableNow(l, Date.now())).length;
  const nombreAffiche = items.length || (chargement ? 5 : 0);
  const entete = '<div class="fb-resultats-tete" data-testid="primary-results"><strong>' + nombreAffiche + " " + (nombreAffiche > 1 ? "solutions" : "solution") + " pr\xE8s de toi</strong><span>" + (ouverts ? ouverts + " " + (ouverts > 1 ? "ouvertes" : "ouverte") : "Les mieux class\xE9es") + "</span></div>";
  if (!items.length) return (nombreAffiche ? entete : "") + statut;
  const liste = items.map((l, index) => {
    const c = categorieAffichee(l, { emoji: "\u{1F4CD}" });
    const bouts = ['<span class="raison">' + esc(l.rankReason) + "</span>"];
    if (l.note) bouts.push("\u2605 " + l.note.toFixed(1) + (l.avis ? " (" + Number(l.avis).toLocaleString("fr-FR") + " avis)" : ""));
    const aQuoi = EXPLIQUE && SET_AIDE.has(l.cat) ? EXPLIQUE.resumeCourt(l, 110) : "";
    const photoVisible = l.image && !(IMAGES && IMAGES.creditObligatoire(l));
    const photo = photoVisible ? '<span class="ac-photo" style="--teinte:' + (COULEURS_CAT[l.cat] || "#5D6B63") + '"><i>' + c.emoji + '</i><img loading="lazy" decoding="async" fetchpriority="low" alt="" src="' + esc(l.image) + `" onload="this.classList.add('vue')" onerror="this.remove()"></span>` : "";
    return '<button class="ac-item" data-ac="' + esc(l.id) + '"><span class="ac-emoji">' + (index + 1) + "</span>" + photo + '<span class="ac-txt"><span class="ac-nom">' + esc(l.titre) + "</span>" + (aQuoi ? '<span class="ac-expli">' + esc(aQuoi) + "</span>" : "") + '<span class="ac-sous">' + bouts.join(" \xB7 ") + '</span></span><span class="ac-dist" aria-hidden="true">' + c.emoji + "</span></button>";
  }).join("") + (classement.length > 5 ? '<span class="fb-plus">Fais d\xE9filer pour pr\xE9ciser \xB7 ' + (classement.length - 5) + " autres r\xE9sultats</span>" : "");
  return entete + liste + statut;
}
const CATS_ACCUEIL = () => [...new Set(
  BESOINS_PRINCIPAUX.filter((b) => !b.aide).flatMap((b) => b.sous ? b.sous.flatMap((x) => x.cats) : [])
)].filter((c) => !CATS_TRANSPORT.has(c));
function diversiteDemandee() {
  if (modeAide) return null;
  if (catsActives && catsActives.size) return null;
  if (intentionCourante) return null;
  if (rechercheTexte()) return null;
  return { fenetre: ACCUEIL_MAX + 3 };
}
function rechercheTexte() {
  const champ = $("#rech");
  return champ && champ.value ? champ.value.trim() : "";
}
function recommandationsAccueil(limite, options) {
  const toutMontrer = !!(options && options.tout);
  const centre = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if (!centre) return [];
  if (!lieux.length) return [];
  const groupe = creneau === "maintenant";
  const cleBurst = (groupe ? "g" : "s") + "|" + creneau + "|" + (toutMontrer ? "1" : "0") + "|" + (catsActives && catsActives.size ? [...catsActives].sort().join(",") : "") + "|" + (filtreMaintenant ? "1" : "0") + "|" + (montrerFermes ? "1" : "0") + "|" + (modeAide ? "1" : "0") + "|" + centre[0].toFixed(4) + "," + centre[1].toFixed(4) + "|r" + revisionLieux;
  if (!recoBurstCache) {
    recoBurstCache = /* @__PURE__ */ new Map();
    queueMicrotask(() => {
      recoBurstCache = null;
    });
  }
  let classement = recoBurstCache.get(cleBurst);
  if (!classement) {
    const candidats = groupe ? lieux.filter((l) => dansZoneActive(l) && nomExploitable(l) && isDiscoveryCandidate(l)) : lieux.filter((l) => dansZoneActive(l) && estTemporaire(l) && nomExploitable(l));
    classement = rankResults(candidats, {
      intent: groupe ? "explorer" : "sortir",
      intention: intentionCourante,
      /* Une recherche qui a posé des catégories les impose ici aussi : sans ça,
         « un endroit calme où travailler » reposait le filtre puis affichait les
         recommandations génériques, catégories comprises. À défaut, toutes les
         catégories des besoins principaux — l'accueil ne présélectionne pas une
         intention, il montre ce qui est réellement faisable. */
      categories: catsActives && catsActives.size ? [...catsActives] : CATS_ACCUEIL(),
      position: centre,
      now: Date.now(),
      // le filtre « maintenant » n'a de sens que dans le groupe « maintenant » :
      // ailleurs c'est la section temporelle qui trie
      nowOnly: !toutMontrer && groupe && filtreMaintenant && !montrerFermes,
      radius: rayonDeLaZone(),
      distanceBetween: distanceM,
      horsService,
      saison: contexteSaison(),
      diversite: diversiteDemandee(),
      territorial: contexteTerritorialClassement()
    });
    recoBurstCache.set(cleBurst, classement);
  }
  if (!groupe) {
    const sections = SECTIONS_DU_CRENEAU[creneau] || [];
    const retenus = classement.filter((l) => sections.includes(l.rankSection)).sort((a, b) => (a.rankStart || 0) - (b.rankStart || 0));
    return Number.isFinite(limite) ? retenus.slice(0, limite || 12) : retenus;
  }
  dernierClassement = classement;
  const tout = avecEpingles(classement);
  return Number.isFinite(limite) ? tout.slice(0, limite || 12) : tout;
}
function avecEpingles(classement) {
  const epingles = idsEpingles();
  if (!epingles.length) return classement;
  const devant = [];
  epingles.forEach((id) => {
    const dansClassement = classement.find((l2) => l2.id === id);
    const l = dansClassement || lieux.find((x) => x.id === id);
    if (l && !devant.includes(l)) devant.push(l);
  });
  if (!devant.length) return classement;
  const ids = new Set(devant.map((l) => l.id));
  return devant.concat(classement.filter((l) => !ids.has(l.id)));
}
function lancerBesoinAide(phrase) {
  if (!AIDE) return;
  phraseAideCourante = String(phrase || "").slice(0, 300) || null;
  ordreModeleAide = null;
  cleOrdreModeleAide = null;
  const domaine = AIDE.domaineDeLaPhrase ? AIDE.domaineDeLaPhrase(phrase) : { domaine: "aide" };
  if (domaine.domaine === "explorer") {
    redirectionExplorer = domaine;
    besoinsAide = [];
    besoinsSecondairesAide = [];
    sousAide = null;
    intentionsSanteAide = [];
    majFeuille2();
    reinitialiserScrollFeuille();
    return;
  }
  redirectionExplorer = null;
  const lecture = AIDE.intentions ? AIDE.intentions(phrase) : null;
  const trouves = AIDE.besoinsDepuisPhrase(phrase);
  const santeTrouvee = trouves.some((x) => x.id === "sante" || x.id === "parler");
  intentionsSanteAide = santeTrouvee && AIDE.intentionsSanteDepuisPhrase ? AIDE.intentionsSanteDepuisPhrase(phrase).map((x) => x.id) : [];
  const age = AIDE.ageDepuisPhrase(phrase);
  if (age != null) ageDeclare = age;
  if (AIDE.estUrgent(phrase) && !trouves.length) {
    sousAide = "urgence";
    besoinsAide = [];
  } else if (trouves.length) {
    const dits = trouves.slice(0, 3).map((x) => x.id);
    const secondaires = lecture ? lecture.secondaryNeeds.filter((id) => dits.indexOf(id) < 0) : [];
    besoinsAide = dits.concat(secondaires);
    besoinsSecondairesAide = secondaires;
    sousAide = besoinsAide[0];
  } else {
    besoinsAide = [];
    besoinsSecondairesAide = [];
    sousAide = null;
    intentionsSanteAide = [];
    const ROUTEUR = window.AutourIntentions;
    const lectures = ROUTEUR ? ROUTEUR.router(phrase).suggestions || [] : [];
    redirectionExplorer = {
      horsPerimetre: true,
      propositions: lectures.slice(0, 3),
      requete: phrase
    };
  }
  chargerAideSiBesoin();
  majFeuille2();
  reinitialiserScrollFeuille();
  rendre();
}
function chargerAideSiBesoin(force) {
  if (!positionMoi) return;
  chargerAideZone({ force: !!force }).catch(() => {
  });
}
function blocAideAccueil() {
  if (creneau !== "maintenant" || modeAide) return "";
  return '<button class="aide-bloc" data-aide-accueil="1"><em>\u{1F91D}</em><span><b>Besoin d\u2019un coup de main&nbsp;?</b><i>Manger, logement, travail, papiers, sant\xE9\u2026</i></span><u>Voir \u2192</u></button>';
}
function ecranBesoinsAide() {
  return '<section class="ab" data-testid="aide-besoins"><p class="ab-entete"><b>\u2764\uFE0F Aide autour de toi</b><i>Trouve rapidement les structures et services qui peuvent t\u2019aider pr\xE8s de chez toi.</i></p><button class="ab-urgence" data-sa="urgence" data-testid="aide-urgence"><span class="abu-haut"><em>' + AIDE_URGENCE.emoji + '</em><b>Besoin d\u2019aide urgente&nbsp;?</b></span><span class="abu-quoi">Sant\xE9, mise \xE0 l\u2019abri, h\xE9bergement d\u2019urgence, danger imm\xE9diat</span><span class="abu-cta">Pour une situation urgente, commence ici \u2192</span></button><p class="ab-secours">Danger imm\xE9diat&nbsp;: <b>15</b> \xB7 <b>17</b> \xB7 <b>18</b> \xB7 <b>112</b> \xB7 <b>115</b>. Pr\xE9vention du suicide&nbsp;: <b>3114</b>. Autour oriente, il ne remplace pas les secours.</p><p class="ab-promesse">Explique ton besoin&nbsp;: Autour te propose les aides et les structures utiles autour de toi.</p><p class="ab-titre">De quoi as-tu besoin&nbsp;?</p><div class="ab-grille">' + SOUS_AIDE.map((b) => '<button class="ab-besoin" data-sa="' + esc(b.id) + '"><em>' + b.emoji + "</em><b>" + esc(b.label) + "</b></button>").join("") + '</div><p class="ab-sous">Ou explique-le simplement&nbsp;:</p><form class="ab-form" id="formBesoin"><input id="champBesoin" type="search" enterkeyhint="search" autocomplete="off" placeholder="\xAB je n\u2019ai rien \xE0 manger \xBB" aria-label="Explique ce dont tu as besoin"><button type="submit" class="ab-ok">Chercher</button></form><p class="ab-exemples">\xAB je dors dehors \xBB \xB7 \xAB j\u2019ai besoin d\u2019aide pour une d\xE9marche \xBB \xB7 \xAB j\u2019ai 20 ans et je trouve pas de travail \xBB</p><p class="ab-ailleurs-note">Pour une r\xE9paration, un commerce ou un service, utilise Explorer.</p><p class="ab-vie">Ce que tu \xE9cris ici reste sur ton t\xE9l\xE9phone. Autour n\u2019en garde que le besoin (\xAB manger \xBB, \xAB travail \xBB), jamais ta phrase.</p></section>';
}
function ecranRedirectionExplorer() {
  const r = redirectionExplorer || {};
  if (r.horsPerimetre) {
    const domaines = AIDE && AIDE.PERIMETRE || [];
    const props = (r.propositions || []).slice(0, 3);
    const choix = props.length ? '<div class="aba-lectures">' + props.map((p) => '<button class="aba-lecture" data-aide-lecture="' + esc(p.id) + '"><span aria-hidden="true">' + esc(p.icone) + "</span> " + esc(p.label) + "</button>").join("") + "</div>" : "";
    return '<section class="ab-ailleurs" data-testid="aide-hors-perimetre"><p class="aba-titre">Je ne suis pas s\xFBr d\u2019avoir compris.</p>' + (props.length ? '<p class="aba-sous">C\u2019\xE9tait plut\xF4t&nbsp;:</p>' + choix : "") + '<p class="aba-sous">Aide oriente vers&nbsp;: ' + esc(domaines.join(", ")) + '.</p><button class="aba-cta" data-aide-reformuler="1">Reformuler ma demande</button><button class="aba-rester" data-aide-general="1">Voir les structures qui orientent</button></section>';
  }
  return '<section class="ab-ailleurs" data-testid="aide-redirection"><p class="aba-titre">\xC7a ressemble plut\xF4t \xE0 ' + esc(r.libelle || "une recherche de commerce") + '.</p><p class="aba-sous">Ce n\u2019est pas ce qu\u2019Aide sait faire, mais Explorer, oui.</p><button class="aba-cta" data-vers-explorer="1">Chercher ' + esc(r.requete || "") + ' autour de moi \u2192</button><button class="aba-rester" data-aide-rester="1">Non, j\u2019ai besoin d\u2019aide</button></section>';
}
function ecranSolutionsAide() {
  const besoin = sousAideChoisi();
  const liste = solutionsAide();
  const titre = besoin ? besoin.emoji + " " + besoin.label : "Aide";
  if (!liste.length)
    return enteteBesoinAide(titre) + (aideEnCours ? rechercheAideHTML() : aucuneSolutionHTML());
  return enteteBesoinAide(titre) + annonceRayonAideHTML(liste) + '<div class="as-liste" data-testid="primary-results">' + liste.map(carteAide).join("") + "</div>" + /* La recherche continue derrière une première liste : le dire évite de
     croire que ces trois structures sont tout ce qui existe. */
  (aideEnCours ? rechercheAideHTML() : "") + (liste.length >= 3 ? '<button class="as-plus" data-as-plus="1">Voir plus loin</button>' : "");
}
function rechercheAideHTML() {
  const palier = rayonAidePalierEnCours;
  const ou = Number.isFinite(Number(palier)) ? Number(palier) < 1e3 ? Number(palier) + " m autour de toi" : Math.round(Number(palier) / 1e3) + " km autour de toi" : "autour de toi";
  return '<div class="fb-statut cherche" role="status" aria-live="polite" data-testid="aide-recherche"><i class="cherche-pastille" aria-hidden="true"></i><span>Recherche des aides \xE0 ' + esc(ou) + "\u2026</span></div>";
}
function annonceRayonAideHTML(liste) {
  if (!RAYON_AIDE) return "";
  const a = RAYON_AIDE.annonce(liste, rayonAideAtteint);
  return a ? '<p class="fb-statut" data-testid="aide-rayon-elargi">' + esc(a.texte) + "</p>" : "";
}
function enteteBesoinAide(titre) {
  const besoins = besoinsAide.length ? besoinsAide : sousAide ? [sousAide] : [];
  const puces = besoins.map((id) => {
    const b = AIDE && AIDE.BESOIN_DE(id);
    return b ? '<button class="cp" data-besoin-off="' + esc(id) + '">' + esc(b.label) + '<i aria-hidden="true">\u2715</i></button>' : "";
  }).join("") + (ageDeclare != null ? '<button class="cp" data-besoin-off="age">' + ageDeclare + ' ans<i aria-hidden="true">\u2715</i></button>' : "");
  return '<div class="as-tete"><strong>' + esc(titre) + "</strong></div>" + (puces ? '<div class="cps"><span class="cps-titre">Compris&nbsp;:</span>' + puces + "</div>" : "");
}
function cleOrdreAide(candidats) {
  const centre = positionMoi || (map ? [map.getCenter().lat, map.getCenter().lng] : [0, 0]);
  return [
    besoinsSelectionnesAide().join("+"),
    phraseAideCourante || "",
    rayonAideAtteint,
    centre[0].toFixed(3),
    centre[1].toFixed(3),
    candidats.length
  ].join("|");
}
function demanderOrdreAide(candidats) {
  if (!IA_AIDE || demandeOrdreAideEnCours || budgetVerificationEpuise) return;
  const cle = cleOrdreAide(candidats);
  if (cle === cleOrdreModeleAide) return;
  ordreModeleAide = null;
  const centre = positionMoi || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if (!centre) return;
  const contexte = IA_AIDE.contexte({
    userLat: centre[0],
    userLng: centre[1],
    selectedCity: villeDetectee || null,
    currentRadius: rayonAideAtteint,
    requestedHelpCategory: sousAideChoisi() ? sousAideChoisi().id : null,
    userFreeText: phraseAideCourante,
    candidatePlaces: candidats
  });
  demandeOrdreAideEnCours = true;
  cleOrdreModeleAide = cle;
  const fini = PERF.requete("aide_ordre_modele");
  (async () => {
    try {
      if (!await connecter()) return;
      const { data: { session: session2 } } = await sb.auth.getSession();
      if (!session2 || !session2.access_token) return;
      const r = await fetch(SUPABASE_URL + "/functions/v1/enrichir-lieu", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_CLE,
          authorization: "Bearer " + session2.access_token
        },
        body: JSON.stringify({ mode: "aide", contexte }),
        signal: AbortSignal.timeout(18e3)
      });
      if (!r.ok) return;
      const json = await r.json();
      if (json && json.raison === "budget du jour atteint") {
        budgetVerificationEpuise = true;
        return;
      }
      if (!json || !json.ordre) return;
      const valide = IA_AIDE.valider(json.ordre, contexte);
      if (valide.aInvente) journal.warn("aide : le mod\xE8le a propos\xE9 " + valide.rejets.length + " \xE9l\xE9ment(s) hors donn\xE9es \u2014 \xE9cart\xE9s");
      if (!valide.rankedPlaceIds.length) return;
      ordreModeleAide = Object.assign({ cle }, valide);
      if (feuilleNiveau === "aide" && sousAide) majFeuille2();
    } catch (e) {
    } finally {
      demandeOrdreAideEnCours = false;
      fini();
    }
  })();
}
function solutionsAide(limite) {
  const centre = positionMoi || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if (!centre || !AIDE) return [];
  const besoins = besoinsSelectionnesAide();
  const choix = sousAideChoisi();
  let candidats = lieux.filter((l) => dansZoneActive(l) && nomExploitable(l) && estSolutionAideLiee(l));
  const CLASSEMENT = window.AutourAideClassement || null;
  if (CLASSEMENT) candidats = candidats.map((l) => {
    const v = CLASSEMENT.capacites(l);
    return Object.assign({}, l, {
      capacitesAide: v.capacites,
      confianceAide: v.confiance,
      verdictAide: {
        confiance: v.confiance,
        certaine: Object.keys(v.detail).some((k) => v.detail[k].accorde && v.detail[k].certaine)
      }
    });
  });
  const classement = rankResults(candidats, {
    intent: "aide",
    intention: intentionCourante,
    // le filtrage métier est déjà fait ci-dessus ; toutes les catégories
    // d'aide restent admises ici pour qu'un réseau connu, rangé « asso », ne
    // soit pas éliminé par son seul tag technique.
    categories: [.../* @__PURE__ */ new Set([...CATS_AIDE, "mairie", "friperie", "food"])],
    position: centre,
    now: Date.now(),
    // en aide, on ne cache jamais ce qui est fermé : savoir qu'un guichet
    // ouvre demain à 9 h est une information, pas un déchet
    nowOnly: false,
    radius: Math.max(rayonRecherche, 6e3),
    distanceBetween: distanceM,
    territorial: contexteTerritorialClassement()
  });
  const notes = classement.map((l) => {
    const vus = besoins.map((id) => {
      const p = AIDE.pertinence(l, id, { large: true });
      const facteur = besoinsSecondairesAide.indexOf(id) >= 0 ? POIDS_BESOIN_SECONDAIRE : 1;
      return {
        poids: p.poids * facteur,
        raison: p.raison,
        sur: !!p.sur,
        direct: !!p.direct,
        precis: p.sur || id !== "jeunes" && id !== "autre"
      };
    }).filter((x) => x.poids > 0 && x.direct).sort((a, b) => b.poids - a.poids || (b.precis ? 1 : 0) - (a.precis ? 1 : 0));
    const meilleur = vus[0];
    if (!besoins.length) return { l, poids: SET_AIDE.has(l.cat) ? 0.5 : 0, raison: "", sur: false };
    return {
      l,
      poids: meilleur ? meilleur.poids : 0,
      raison: meilleur ? meilleur.raison : "",
      sur: !!(meilleur && meilleur.sur)
    };
  }).filter((x) => x.poids > 0);
  notes.sort((a, b) => (
    // Lien réel au besoin, puis disponibilité / horizon, puis marche : une
    // association voisine ne gagne jamais sur une permanence adaptée.
    b.poids - a.poids || prioriteDisponibiliteAide(b.l) - prioriteDisponibiliteAide(a.l) || /* L'ordre du produit, écrit une seule fois dans `aide-classement.js` :
       preuve certaine, confiance, spécialisation réelle, disponibilité,
       distance, fraîcheur. Pour Aide, la pertinence passe avant la quantité. */
    (CLASSEMENT ? CLASSEMENT.comparer(a.l, b.l) : 0) || (a.l.rankDistance || 0) - (b.l.rankDistance || 0)
  ));
  const ordonnes = notes.map((x) => Object.assign(x.l, { aideRaison: x.raison, aideSur: x.sur }));
  if (IA_AIDE) {
    demanderOrdreAide(ordonnes);
    if (ordreModeleAide && ordreModeleAide.cle === cleOrdreAide(ordonnes))
      return IA_AIDE.appliquer(ordonnes, ordreModeleAide).slice(0, limite || 5);
  }
  return ordonnes.slice(0, limite || 5);
}
function prioriteDisponibiliteAide(l) {
  if (estTemporaire(l)) {
    const etat2 = statutTemps(l);
    if (etat2.statut === TEMPS.STATUTS.EN_COURS) return 60;
    if (etat2.statut === TEMPS.STATUTS.IMMINENT) return 50;
    if (etat2.statut === TEMPS.STATUTS.PLUS_TARD) return 40;
    if (etat2.statut !== TEMPS.STATUTS.A_VENIR || etat2.debut == null) return 0;
    const jours = Math.round((etat2.debut - Date.now()) / 864e5);
    return jours <= 1 ? 30 : jours <= 7 ? 20 : 10;
  }
  const d = dispoDe(l);
  if (d && d.isOpenNow) return 35;
  if (d && d.status !== "unknown") return 25;
  return 20;
}
function ouvertOuImminent(l) {
  if (estTemporaire(l)) return TEMPS.estMaintenant(statutTemps(l).statut);
  const d = dispoDe(l);
  return !!(d && d.isOpenNow);
}
function carteAide(l) {
  favorisEnMemoire.set(cleFavori(l), l);
  const c = categorieAffichee(l, { emoji: "\u{1F91D}" });
  const photo = photoAutoriseeAide(l);
  const eph = estTemporaire(l);
  const quand = eph ? TEMPS.libelleTemporel(l, Date.now(), { disponibilite: (x, t) => dispoDe(x, null, t) }) : libelleOuverture(l);
  const etat2 = eph ? statutTemps(l).statut : null;
  const chaud = eph ? TEMPS.estMaintenant(etat2) : ouvertOuImminent(l);
  const expl = EXPLIQUE ? EXPLIQUE.explication(l) : null;
  const cond = AIDE.conditionDe(l);
  const pour = AIDE.convient(l, { age: ageDeclare });
  const dist = positionMoi ? formatDist(distanceDepuisZone(l)) : "";
  const eta = positionPrecise() && l.rankEta && Number.isFinite(l.rankEta.minutes) ? l.rankEta.minutes + " min" : "";
  return '<div class="ac-aide" role="button" tabindex="0" data-ac="' + esc(l.id) + '"><div class="aa-tete"><span class="aa-emoji">' + c.emoji + '</span><span class="aa-nom">' + esc(l.titre) + "</span>" + boutonCoeur(l) + '<span class="aa-visuel" style="--teinte:' + (COULEURS_CAT[l.cat] || "#B82A3A") + '"><i>' + c.emoji + "</i>" + (photo ? '<img loading="lazy" decoding="async" alt="" src="' + esc(photo) + `" onload="this.classList.add('vue')">` : "") + "</span></div>" + (expl && expl.texte ? '<p class="aa-quoi">' + esc(EXPLIQUE.resumeCourt(l, 150)) + "</p>" : "") + '<p class="aa-quand' + (chaud ? " chaud" : "") + '">' + esc(quand) + (dist ? " \xB7 " + esc(eta || dist) : "") + "</p>" + /* Une correspondance de réseau est une certitude ; une simple parenté de
     catégorie n'en est pas une, et la phrase doit le dire. Sans cette
     nuance, « ce lieu répond à ton besoin » se lit comme une promesse. */
  (l.aideRaison ? '<p class="aa-pourquoi"><b>' + (l.aideSur ? "Pourquoi c\u2019est propos\xE9&nbsp;:" : "Peut aider, \xE0 v\xE9rifier&nbsp;:") + "</b> " + esc(l.aideRaison) + (AIDE.pourquoi(l, besoinsAide, { age: ageDeclare }).includes("ans") ? " " + esc(AIDE.pourquoi(l, besoinsAide, { age: ageDeclare }).split(". ").pop()) : "") + "</p>" : "") + (cond ? '<p class="aa-cond">' + esc(cond.texte) + "<i>" + (cond.source === "reseau" ? "En g\xE9n\xE9ral, dans ce r\xE9seau" : "Source : " + cond.source) + "</i></p>" : "") + (pour === false ? '<p class="aa-hors">Ce r\xE9seau ne correspond pas \xE0 l\u2019\xE2ge que tu as indiqu\xE9.</p>' : "") + '<p class="aa-bas">' + (l.gratuit === true ? "Gratuit \xB7 " : "") + esc(l.adresse || "") + (l.tel ? ' \xB7 <a href="tel:' + esc(String(l.tel).replace(/\s/g, "")) + '">Appeler</a>' : "") + "</p>" + (fiableAide(l) ? "" : '<p class="aa-verif">\xC0 v\xE9rifier avant de se d\xE9placer.</p>') + "</div>";
}
function libelleOuverture(l) {
  const d = dispoDe(l);
  if (!d || d.status === "unknown") return "Horaires non renseign\xE9s";
  if (d.status === "permanently_closed") return "D\xE9finitivement ferm\xE9";
  if (d.isOpenNow) return d.closesAtTime ? "Ouvert jusqu\u2019\xE0 " + heureFrancaise(d.closesAtTime) : "Ouvert";
  if (d.opensAtTime) return d.reason || "Ouvre \xE0 " + heureFrancaise(d.opensAtTime);
  return "Ferm\xE9";
}
function fiableAide(l) {
  if (!DONNEES) return true;
  const h = DONNEES.normaliserHoraires(l, Date.now(), (x, t) => dispoDe(x, null, t));
  return h.confidence >= 0.8;
}
function sourceAideIndisponible() {
  return rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE;
}
function aucuneSolutionHTML() {
  if (sourceAideIndisponible())
    return '<div class="as-vide" data-testid="aide-source-indisponible"><p class="as-vide-titre">La recherche n\u2019a pas abouti&nbsp;: l\u2019annuaire des structures n\u2019a pas r\xE9pondu.</p><p class="as-vide-sous">Ce n\u2019est pas une r\xE9ponse sur ce qui existe autour de toi. R\xE9essaie dans un instant.</p><div class="as-vide-actions"><button class="pdep-btn pdep-fort" data-etat-action="retry">R\xE9essayer</button><button class="pdep-btn" data-as="ville">Chercher dans une autre ville</button><button class="pdep-btn" data-as="general">Voir les structures g\xE9n\xE9rales</button></div></div>';
  return '<div class="as-vide" data-testid="aide-vide"><p class="as-vide-titre">' + (aideEtrangersEcartes ? "Aucune aide fiable trouv\xE9e dans ce territoire. \xC9largir la recherche&nbsp;?" : "Je n\u2019ai pas trouv\xE9 de solution suffisamment fiable autour de cette zone.") + '</p><p class="as-vide-sous">\xC7a ne veut pas dire qu\u2019il n\u2019y en a pas.</p><div class="as-vide-actions"><button class="pdep-btn pdep-fort" data-as-plus="1">Chercher plus loin</button><button class="pdep-btn" data-as="ville">Changer de ville</button><button class="pdep-btn" data-as="general">Voir les structures g\xE9n\xE9rales</button><button class="pdep-btn" data-as="reformuler">Reformuler mon besoin</button></div></div>';
}
function puceCouleur(type) {
  return type === "contrainte" ? "dure" : type === "zone" ? "zone" : "";
}
function chipsHTML() {
  const st = intentionCourante;
  if (!st || !st.chips || !st.chips.length) return "";
  return '<div class="cps" data-testid="chips-comprises"><span class="cps-titre">Compris&nbsp;:</span>' + st.chips.map((c) => '<button class="cp ' + puceCouleur(c.type) + '" data-chip="' + esc(c.id) + '" aria-label="Retirer : ' + esc(c.label) + '">' + esc(c.label) + '<i aria-hidden="true">\u2715</i></button>').join("") + "</div>";
}
function retirerChip(id) {
  if (!intentionCourante || !COMPRENDRE) return;
  intentionCourante = COMPRENDRE.sansChip(intentionCourante, id);
  const [type, valeur] = String(id).split(":");
  if (type === "cat" && catsActives) {
    catsActives.delete(valeur);
    if (!catsActives.size) catsActives = null;
  }
  if (type === "intention" || type === "cuisine") {
    catsActives = null;
    filtreActif = "tout";
  }
  if (type === "creneau") {
    creneau = "maintenant";
    filtreMaintenant = true;
  }
  if (type === "budget") {
    filtresHumains.delete("budget");
    filtresHumains.delete("gratuit");
  }
  if (type === "proche") filtresHumains.delete("proche");
  if (type === "signal") {
    const f = FILTRE_DU_SIGNAL[valeur];
    if (f) filtresHumains.delete(f);
  }
  if (type === "zone") {
    revenirAutourDeMoi();
    return;
  }
  dessinerFiltres();
  majFiltres();
  rendre();
  majFeuille2();
}
const TERR = window.AutourTerritoire || null;
let contextesTerritoriaux = [];
let contexteTerritorial = null;
let zoneTerritoriale = null;
let modeTerritorial = false;
let etatTerritorial = null;
let contextesEnVol = null;
const CLE_CACHE_CONTEXTES = "autour:contextes-territoriaux:v1";
function lireCacheContextes() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_CACHE_CONTEXTES) || "null");
    if (!brut || !Array.isArray(brut.lignes)) return null;
    return brut;
  } catch (e) {
    return null;
  }
}
function ecrireCacheContextes(lignes) {
  try {
    localStorage.setItem(
      CLE_CACHE_CONTEXTES,
      JSON.stringify({ t: Date.now(), lignes: lignes.slice(0, 200) })
    );
  } catch (e) {
  }
}
function chargerContextesTerritoriaux() {
  if (!TERR) return Promise.resolve([]);
  const cache = lireCacheContextes();
  if (cache) {
    contextesTerritoriaux = TERR.depuisLignes(cache.lignes);
    PERF.touche("contextes_territoriaux", true);
    compterTerritorial("territorial_cache_hit");
    if (!TERR.perime(cache.t, TERR.NATURES.PERIMETRE)) return Promise.resolve(contextesTerritoriaux);
  } else {
    PERF.touche("contextes_territoriaux", false);
    compterTerritorial("territorial_cache_miss");
  }
  if (contextesEnVol) return contextesEnVol;
  contextesEnVol = (async () => {
    if (!await connecter() || !sbLecture) return contextesTerritoriaux;
    const ref = pointDeReference();
    const fini = PERF.requete("supabase_contextes");
    try {
      const { data, error } = await sbLecture.rpc("contextes_territoriaux", {
        p_lat: Array.isArray(ref) ? Number(ref[0]) : null,
        p_lng: Array.isArray(ref) ? Number(ref[1]) : null
      });
      if (error) {
        console.error("Contextes territoriaux :", error.message);
        return contextesTerritoriaux;
      }
      const lignes = data || [];
      ecrireCacheContextes(lignes);
      contextesTerritoriaux = TERR.depuisLignes(lignes);
      majContexteTerritorial();
      return contextesTerritoriaux;
    } finally {
      fini();
      contextesEnVol = null;
    }
  })();
  return contextesEnVol;
}
function majContexteTerritorial() {
  if (!TERR) return false;
  const ref = pointDeReference();
  const avant = contexteTerritorial && contexteTerritorial.slug;
  const avantZone = zoneTerritoriale && zoneTerritoriale.slug;
  contexteTerritorial = TERR.contexteActif(contextesTerritoriaux, Date.now(), ref);
  zoneTerritoriale = contexteTerritorial ? TERR.zoneDe(ref, contexteTerritorial) : null;
  if (!contexteTerritorial && modeTerritorial) {
    modeTerritorial = false;
    reglerBattementTerritorial();
  }
  return avant !== (contexteTerritorial && contexteTerritorial.slug) || avantZone !== (zoneTerritoriale && zoneTerritoriale.slug);
}
function boutonTerritorial() {
  return TERR && contexteTerritorial ? TERR.bouton(contexteTerritorial, Date.now()) : null;
}
function besoinsDuMoment() {
  const b = boutonTerritorial();
  if (!b) return BESOINS_RAPIDES;
  const rapides = BESOINS_RAPIDES.slice();
  const apresMaintenant = rapides.findIndex((x) => x.id === "maintenant");
  const entree = {
    id: "territorial",
    emoji: b.emoji,
    label: b.libelle,
    annonce: !b.actif
  };
  rapides.splice(apresMaintenant < 0 ? rapides.length : apresMaintenant + 1, 0, entree);
  return rapides;
}
function contexteTerritorialClassement() {
  if (!TERR || !contexteTerritorial) return null;
  if (TERR.phase(contexteTerritorial, Date.now()) !== TERR.PHASES.PENDANT) return null;
  return { contexte: contexteTerritorial, zone: zoneTerritoriale };
}
function reevaluerTerritorial(options) {
  if (!TERR || !contexteTerritorial) return null;
  const o = options || {};
  const zoneAvant = zoneTerritoriale && zoneTerritoriale.slug;
  majContexteTerritorial();
  const courant = {
    maintenant: Date.now(),
    position: positionMoi,
    centre: pointDeReference(),
    zone: zoneTerritoriale ? zoneTerritoriale.slug : null,
    ouverture: !!o.ouverture,
    retourPremierPlan: !!o.retourPremierPlan,
    donnees: {
      [TERR.NATURES.PERIMETRE]: (lireCacheContextes() || {}).t || null
    }
  };
  const verdict = TERR.doitReevaluer(etatTerritorial, courant);
  if (verdict.recalculer) {
    compterTerritorial("territorial_recompute");
    etatTerritorial = Object.assign({}, courant, { expireLe: Date.now() + TERR.TTL[TERR.NATURES.TEMPOREL] });
    oublierItemsMaintenant();
    planifierRendu({ accueil: true, feuille: true });
  }
  if (verdict.resynchroniser) void chargerContextesTerritoriaux();
  if (zoneAvant !== courant.zone) compterTerritorial("territorial_zone_changed");
  return verdict;
}
let battementTerritorial = null;
function reglerBattementTerritorial() {
  const doitBattre = modeTerritorial && !!contexteTerritorial && (typeof document === "undefined" || document.visibilityState !== "hidden");
  if (doitBattre === (battementTerritorial !== null)) return;
  if (!doitBattre) {
    clearInterval(battementTerritorial);
    battementTerritorial = null;
    return;
  }
  battementTerritorial = setInterval(() => {
    if (!modeTerritorial || !contexteTerritorial) {
      reglerBattementTerritorial();
      return;
    }
    reevaluerTerritorial();
  }, TERR.TTL[TERR.NATURES.TEMPOREL]);
}
function ouvrirModeTerritorial() {
  if (!contexteTerritorial) return;
  if (modeAide) basculerAide();
  modeTerritorial = true;
  creneau = "maintenant";
  filtreMaintenant = true;
  ongletCourant = "explorer";
  marquerNavigation("explorer");
  contexteExplorer = null;
  compterTerritorial("territorial_mode_opened");
  reevaluerTerritorial({ ouverture: true });
  ouvrirFeuille2("racine");
  reinitialiserScrollFeuille();
  rendre();
  majFeuille2();
  reglerBattementTerritorial();
}
function fermerModeTerritorial() {
  if (!modeTerritorial) return;
  modeTerritorial = false;
  reglerBattementTerritorial();
  planifierRendu({ accueil: true, feuille: true });
}
function servicesTerritoriaux() {
  if (!TERR || !modeTerritorial || !contexteTerritorial) return [];
  const ref = pointDeReference();
  if (!Array.isArray(ref)) return [];
  return TERR.services(lieux.filter(dansZoneActive).map((l) => ({
    id: l.id,
    cat: l.cat,
    titre: l.titre,
    lat: l.lat,
    lng: l.lng,
    ouvert: estFerme(l) ? false : l.ouvert == null ? null : l.ouvert
  })), { position: ref, rayonMax: Math.min(1500, rayonRegarde()) });
}
function blocServicesTerritoriaux() {
  const services = servicesTerritoriaux();
  if (!services.length) return "";
  return '<section class="tsv" data-testid="services-territoriaux"><p class="tsv-tete">UTILE AUTOUR DE TOI</p><ul class="tsv-l">' + services.map((s) => '<li><button data-tsv="' + esc(s.item.id) + '"><em aria-hidden="true">' + s.emoji + "</em><b>" + esc(s.label) + "</b><u>" + esc(formatDist(s.distance)) + "</u></button></li>").join("") + "</ul></section>";
}
function enTeteTerritoriale() {
  if (!TERR || !modeTerritorial || !contexteTerritorial) return "";
  const b = boutonTerritorial();
  if (!b) return "";
  const ref = pointDeReference();
  const dedans = TERR.dansPerimetre(ref, contexteTerritorial);
  const loin = dedans ? null : TERR.distanceAuPerimetre(ref, contexteTerritorial);
  const sous = b.phase === TERR.PHASES.AVANT ? "Le programme, avant que \xE7a commence" : dedans ? zoneTerritoriale ? zoneTerritoriale.nom : "Autour de toi" : loin != null ? "\xC0 " + formatDist(loin) + " du p\xE9rim\xE8tre" : "Hors du p\xE9rim\xE8tre";
  return '<section class="tterr" data-testid="entete-territoriale" data-tterr-phase="' + esc(b.phase) + '"><p class="tterr-tete"><em aria-hidden="true">' + esc(b.emoji) + "</em><b>" + esc(b.libelle.toUpperCase()) + '</b></p><p class="tterr-sous">' + esc(sous) + "</p>" + (dedans ? "" : '<button class="tterr-recentrer" data-tterr-recentrer="1">Recentrer sur ' + esc(contexteTerritorial.zones.length ? contexteTerritorial.nom : "le p\xE9rim\xE8tre") + "</button>") + "</section>";
}
function compterTerritorial(nom, valeur, zone) {
  if (!TERR) return;
  if (!TERR.compter(
    nom,
    valeur == null ? 1 : valeur,
    zone || zoneTerritoriale && zoneTerritoriale.slug || null
  )) return;
  planifierEnvoiMetriques();
}
let envoiMetriquesPlanifie = false;
function envoyerMetriquesTerritoriales() {
  if (!TERR || !contexteTerritorial || !sbLecture) return;
  const rapport = TERR.rapport();
  const noms = Object.keys(rapport.compteurs);
  if (!noms.length) return;
  TERR.oublier();
  const slug2 = contexteTerritorial.slug;
  noms.forEach((nom) => {
    void Promise.resolve(sbLecture.rpc("compter_metrique_territoriale", {
      p_context: slug2,
      p_metrique: nom,
      p_valeur: rapport.compteurs[nom],
      p_zone: null
    })).catch(() => {
    });
  });
  Object.entries(rapport.zones).forEach(([zone, lignes]) => {
    Object.entries(lignes).forEach(([nom, valeur]) => {
      void Promise.resolve(sbLecture.rpc("compter_metrique_territoriale", {
        p_context: slug2,
        p_metrique: nom,
        p_valeur: valeur,
        p_zone: zone
      })).catch(() => {
      });
    });
  });
}
function planifierEnvoiMetriques() {
  if (envoiMetriquesPlanifie || !TERR) return;
  envoiMetriquesPlanifie = true;
  const envoyer = () => {
    envoiMetriquesPlanifie = false;
    envoyerMetriquesTerritoriales();
  };
  if (ORDO) ORDO.differer(envoyer, { timeout: 4e3 });
  else setTimeout(envoyer, 4e3);
}
const BESOINS_RAPIDES = [
  { id: "manger", emoji: "\u{1F35C}", label: "Manger" },
  { id: "sortir", emoji: "\u{1F389}", label: "Sortir" },
  { id: "maintenant", emoji: "\u26A1", label: "Maintenant" },
  { id: "aide", emoji: "\u2764\uFE0F", label: "Aide" }
];
function brancherBesoinsRapides(racine) {
  if (!racine) return;
  racine.querySelectorAll("[data-br]").forEach((b) => b.onclick = () => {
    const id = b.dataset.br;
    if (id === "aide") {
      if (!modeAide) basculerAide();
      ouvrirFeuille2("aide");
      return;
    }
    if (id === "territorial") {
      if (modeTerritorial) {
        fermerModeTerritorial();
        majFeuille2();
        rendre();
        return;
      }
      ouvrirModeTerritorial();
      return;
    }
    if (id === "maintenant") {
      modeTerritorial = false;
      creneau = "maintenant";
      filtreMaintenant = true;
      majFeuille2();
      rendre();
      majFiltres();
      return;
    }
    if (modeAide) basculerAide();
    ouvrirFeuille2(id);
  });
}
function besoinsRapidesHTML() {
  return '<div class="br" data-testid="besoins-rapides">' + besoinsDuMoment().map((b) => {
    const actif = b.id === "territorial" ? modeTerritorial : b.id === "maintenant" ? creneau === "maintenant" && !modeTerritorial : b.id === "aide" ? modeAide : !!(catsActives && feuilleNiveau === b.id);
    return '<button class="br-b' + (actif ? " actif" : "") + (b.annonce ? " br-annonce" : "") + '" data-br="' + b.id + '"><em>' + b.emoji + "</em>" + esc(b.label) + "</button>";
  }).join("") + "</div>";
}
function compterMaintenant() {
  const t = Date.now();
  return lieux.reduce((n, l) => {
    if (!estTemporaire(l) || l.annule) return n;
    return TEMPS.estMaintenant(statutTemps(l, t).statut) ? n + 1 : n;
  }, 0);
}
function majBadgeMaintenant() {
  const badge = $("#badgeMaintenant");
  if (!badge) return;
  const n = modeNav || modePose || modeAide ? 0 : totalMaintenant();
  badge.hidden = n === 0;
  if (n === 0) return;
  const compte = $("#bmCompte");
  if (compte) compte.textContent = String(Math.min(n, MAINTENANT_APERCU));
  const sous = badge.querySelector(".bm-sous");
  const ou = zoneActive && CTX && zoneActive.type === CTX.TYPES.RECHERCHE && zoneActive.nom ? "\xC0 " + zoneActive.nom + " en ce moment" : "En cours pr\xE8s de toi";
  if (sous) sous.textContent = ou;
  badge.setAttribute("aria-label", n + " chose" + (n > 1 ? "s" : "") + " \xE0 faire \u2014 " + ou);
}
function evenementsMaintenant() {
  const t = Date.now();
  return lieux.filter((l) => estTemporaire(l) && !l.annule && TEMPS.estMaintenant(statutTemps(l, t).statut));
}
function tempsMaintenant(l) {
  const M = window.AutourMaintenant;
  if (M && l.nature === M.NATURES.SEANCE && l.debutLe) {
    const dans = Math.round((l.debutLe - Date.now()) / 6e4);
    return dans > 0 ? "commence dans " + dans + " min" : "commence maintenant";
  }
  if (M && (l.nature === M.NATURES.OUVERT || l.nature === M.NATURES.ACTIVITE)) {
    const d = dispoDe(l);
    if (d && d.closesAtTime) return "ouvert jusqu\u2019\xE0 " + heureFrancaise(d.closesAtTime);
    return "ouvert";
  }
  return l.finLe ? "jusqu\u2019\xE0 " + heureLocale(l.finLe, l) : "";
}
function ligneMaintenant(l) {
  const c = categorieAffichee(l);
  const dist = jeSuisDansLaZoneRegardee() ? formatDist(distanceDepuisZone(l)) : "";
  const bas = [dist, tempsMaintenant(l)].filter(Boolean).join(" \xB7 ");
  const lieu = l.adresse || l.cp || "";
  return '<button class="mn-l" data-mn="' + esc(l.id) + '"><span class="mn-rond" style="background:' + (COULEURS_CAT[l.cat] || "#5D6B63") + '">' + c.emoji + '</span><span class="mn-txt"><b>' + esc(l.titre) + "</b>" + (lieu ? "<i>" + esc(lieu) + "</i>" : "") + (bas ? "<u>" + esc(bas) + "</u>" : "") + '</span><span class="mn-fl" aria-hidden="true">\u203A</span></button>';
}
const ORDO = window.AutourOrdonnanceur || null;
const ENVIES = window.AutourEnvies || null;
const ANNONCES = window.AutourAnnoncesClassement || null;
const TAXONOMIE_ANNONCES = window.AutourAnnoncesTaxonomie || null;
const CLE_POURTOI_VU = "autour:pourtoi-vu:v1";
const CLE_POURTOI_MASQUES = "autour:pourtoi-masque:v1";
const POURTOI_MAX = 6;
const POURTOI_TOUT_MAX = 300;
const POURTOI_GROUPES_STATUT = Object.freeze({
  nouvelles: "pourtoi-nouvelles",
  aNePasManquer: "pourtoi-a-ne-pas-manquer"
});
const POURTOI_NOUVEAU_MS = 72 * 3600 * 1e3;
function marquesVues() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_POURTOI_VU) || "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch (e) {
    return /* @__PURE__ */ new Set();
  }
}
function ecrireMarquesVues(ids) {
  try {
    localStorage.setItem(CLE_POURTOI_VU, JSON.stringify([...ids].slice(-200)));
  } catch (e) {
  }
}
function marquesMasquees() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_POURTOI_MASQUES) || "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch (e) {
    return /* @__PURE__ */ new Set();
  }
}
function ecrireMarquesMasquees(ids) {
  try {
    localStorage.setItem(CLE_POURTOI_MASQUES, JSON.stringify([...ids].slice(-200)));
  } catch (e) {
  }
}
function masquerPourToi(id) {
  const masquees = marquesMasquees();
  masquees.add(String(id));
  ecrireMarquesMasquees(masquees);
}
function detecteDepuis(l) {
  if (!ANNONCES) return null;
  const t = ANNONCES.announcedAt(l);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0 || ms > POURTOI_NOUVEAU_MS) return null;
  const h = Math.floor(ms / 36e5);
  if (h < 1) return "d\xE9tect\xE9 il y a moins d\u2019une heure";
  if (h < 24) return "d\xE9tect\xE9 il y a " + h + " h";
  const j = Math.floor(h / 24);
  return "d\xE9tect\xE9 il y a " + j + " jour" + (j > 1 ? "s" : "");
}
function pourquoiAnnonce(x) {
  return {
    /* Le classement produit cette phrase à partir des tags qui ont réellement
       matché. Aucun libellé n'est déduit du domaine général de l'événement. */
    texte: x.reason || "correspondance explicite avec une envie suivie",
    solide: true
  };
}
function propositionsPourToi(limite = POURTOI_MAX) {
  if (!ENVIES || !ENVIES.choisies().length || !ANNONCES) return [];
  const vues = marquesVues();
  const classes = ANNONCES.classerPourToi(lieux, {
    now: Date.now(),
    interests: ENVIES.choisies(),
    seenIds: [...vues],
    hiddenIds: [...marquesMasquees()],
    limit: Number.isFinite(Number(limite)) ? Math.max(0, Number(limite)) : POURTOI_MAX,
    distanceFor: (event) => distanceDepuisZone(event),
    metroArea: bassinTerritorialActif?.group_slug || bassinTerritorialActif?.groupSlug || null,
    territorySlug: bassinTerritorialActif?.slug || null
  });
  return classes.map((classe) => ({
    l: classe.event,
    groupe: classe.group,
    groupeLabel: ANNONCES.libelleGroupe(classe.group),
    pourquoi: pourquoiAnnonce(classe),
    nouveau: classe.isNew ? detecteDepuis(classe.event) : null,
    vu: classe.seen,
    score: classe.score,
    matchedInterests: Array.isArray(classe.matched_interests) ? classe.matched_interests : []
  }));
}
function groupesInteretsPourToi(propositions) {
  if (!TAXONOMIE_ANNONCES) return [];
  const groupes = /* @__PURE__ */ new Map();
  const ordre = (ENVIES ? ENVIES.choisies() : []).map((id) => {
    const canonique = TAXONOMIE_ANNONCES.normaliserInteret(id);
    return { id: canonique, label: TAXONOMIE_ANNONCES.INTEREST_LABELS[canonique] || String(id) };
  });
  propositions.forEach((proposition) => {
    const ids = new Set((proposition.matchedInterests || []).map((id) => TAXONOMIE_ANNONCES.normaliserInteret(id)));
    ids.forEach((id) => {
      const entree = ordre.find((item) => item.id === id);
      if (!entree) return;
      if (!groupes.has(id)) groupes.set(id, { id, label: entree.label, propositions: [] });
      groupes.get(id).propositions.push(proposition);
    });
  });
  return ordre.map((item) => groupes.get(item.id)).filter(Boolean);
}
function dateProposition(l) {
  if (!l.debutLe) return "";
  const jour = new Date(l.debutLe).toLocaleDateString(
    "fr-FR",
    { day: "numeric", month: "long", year: "numeric" }
  );
  const debut = heureLocale(l.debutLe, l);
  const fin = Number.isFinite(l.finLe) ? heureLocale(l.finLe, l) : "";
  return debut ? jour + " \xB7 " + debut + (fin ? "\u2013" + fin : "") : jour;
}
function dateAnnonceProposition(value) {
  if (!value) return "";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function ligneBilletterie(l) {
  const lignes = [];
  if (l.presale_at) lignes.push("Pr\xE9vente \xB7 " + dateAnnonceProposition(l.presale_at));
  if (l.tickets_open_at) lignes.push("Billetterie \xB7 " + dateAnnonceProposition(l.tickets_open_at));
  return lignes.join(" \xB7 ");
}
function carteProposition(x) {
  const l = x.l;
  const dist = jeSuisDansLaZoneRegardee() ? formatDist(distanceDepuisZone(l)) : "";
  const ville = (l.cp || l.adresse || "").trim();
  const lieuLigne = [ville, dist].filter(Boolean).join(" \xB7 ");
  const date = dateProposition(l);
  const billetterie = ligneBilletterie(l);
  const tags = TAXONOMIE_ANNONCES ? TAXONOMIE_ANNONCES.libelles(l.announcement_tags || l.announcementTags || []).slice(0, 3) : [];
  const c = categorieAffichee(l);
  const visuel = l.image ? '<img class="pt-img" src="' + esc(l.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="pt-img pt-img-vide" aria-hidden="true">' + c.emoji + "</span>";
  const statut = x.groupe === "nouvelles_annonces" ? x.nouveau ? '<b class="pt-neuf">NOUVELLE ANNONCE</b><span>' + esc(x.nouveau) + "</span>" : '<b class="pt-neuf">ANNONCE PUBLI\xC9E</b>' : '<b class="pt-neuf">\xC0 NE PAS MANQUER</b>';
  return '<article class="pt-carte' + (x.vu ? " pt-vu" : "") + '" data-pt="' + esc(l.id) + '">' + visuel + '<div class="pt-txt"><p class="pt-haut">' + statut + "</p><h3>" + esc(l.titre) + "</h3>" + (date ? '<p class="pt-date">' + esc(date) + "</p>" : "") + (lieuLigne ? '<p class="pt-lieu">' + esc(lieuLigne) + "</p>" : "") + (tags.length ? '<p class="pt-tags">' + esc(tags.join(" \xB7 ")) + "</p>" : "") + (billetterie ? '<p class="pt-billetterie">' + esc(billetterie) + "</p>" : "") + '<p class="pt-pourquoi"><span aria-hidden="true">\u2728</span>Pourquoi Autour te le montre</p><p class="pt-raison">' + esc(x.pourquoi.texte) + "</p>" + actionsProposition(l) + "</div></article>";
}
function actionsProposition(l) {
  return '<p class="pt-actions">' + /* Même règle qu'en fiche : le lien n'existe que si une source vérifiée
     l'a réellement trouvé. Rien n'est affiché « au cas où ». */
  (l.ticket_url ? '<a class="pt-billet" href="' + esc(l.ticket_url) + '" target="_blank" rel="noopener">Billetterie</a>' : "") + '<button class="pt-action" data-pt-save="' + esc(l.id) + '" aria-label="Enregistrer">' + (estFavori(l) ? "Enregistr\xE9" : "Enregistrer") + '</button><button class="pt-action" data-pt-share="' + esc(l.id) + '" aria-label="Partager">Partager</button><button class="pt-action pt-action-discret" data-pt-hide="' + esc(l.id) + '" aria-label="Masquer">Masquer</button><button class="pt-voir" data-pt-voir="' + esc(l.id) + '">Voir \u2192</button></p>';
}
function blocSurveillances() {
  if (!ENVIES) return "";
  const suivies = ENVIES.details();
  return '<section class="pt-envies"><div class="pt-envies-tete"><strong>Tes surveillances</strong><button id="ptGerer">G\xE9rer</button></div>' + (suivies.length ? '<div class="pt-envies-liste">' + suivies.map((e) => '<span class="pt-envie"><em aria-hidden="true">' + e.emoji + "</em>" + esc(e.label) + "</span>").join("") + '<button class="pt-envie pt-envie-plus" id="ptPlus" aria-label="Ajouter une envie">+</button></div>' : '<p class="pt-envies-vide">Choisis ce que tu veux suivre : Autour te pr\xE9viendra quand quelque chose arrive.</p>') + (ENVIES.persistant() ? "" : '<p class="pt-envies-vide">Ton navigateur n\u2019enregistre pas ces choix : ils vaudront pour cette visite seulement.</p>') + "</section>";
}
function rendreGroupePourToi(label, identifiant, propositions) {
  if (!propositions.length) return "";
  const visibles2 = propositions.slice(0, 2);
  const reste = propositions.slice(2);
  return '<section class="pt-groupe" data-testid="' + identifiant + '"><h3 class="pt-groupe-titre">' + esc(label) + "</h3>" + visibles2.map(carteProposition).join("") + (reste.length ? '<div class="pt-groupe-suite" data-pt-suite="' + esc(identifiant) + '" hidden>' + reste.map(carteProposition).join("") + '</div><button class="pt-action pt-liste-plus" data-pt-expand="' + esc(identifiant) + '" aria-expanded="false">Voir les ' + propositions.length + " \u2192</button>" : "") + "</section>";
}
function majPourToi() {
  const panneau = $("#pourToi");
  const corps = $("#ptCorps");
  if (!panneau || !corps) return;
  const debutCpu = performance.now();
  const propositions = propositionsPourToi(POURTOI_TOUT_MAX);
  const suivies = ENVIES ? ENVIES.choisies().length : 0;
  let contenu;
  if (!suivies) {
    contenu = '<p class="pt-vide">Rien \xE0 suivre pour l\u2019instant. Dis \xE0 Autour ce qui t\u2019int\xE9resse et il te pr\xE9viendra quand \xE7a arrive.</p>';
  } else if (!propositions.length) {
    contenu = '<p class="pt-vide">Rien de neuf dans cette zone pour ce que tu suis. Autour continue de regarder.</p>';
  } else {
    contenu = groupesInteretsPourToi(propositions).map((groupe) => rendreGroupePourToi(
      groupe.label + " \xB7 " + groupe.propositions.length,
      "pourtoi-interet-" + groupe.id,
      groupe.propositions
    )).join("");
    if (!contenu) contenu = '<p class="pt-vide">Rien de neuf dans cette zone pour ce que tu suis. Autour continue de regarder.</p>';
  }
  corps.innerHTML = contenu + blocSurveillances();
  const nonVues = propositions.filter((x) => !x.vu && x.groupe === "nouvelles_annonces").length;
  const toutVu = $("#ptToutVu");
  if (toutVu) toutVu.hidden = !nonVues;
  const pastille = $("#notifPastille");
  if (pastille) pastille.hidden = !nonVues;
  brancherPourToi(propositions);
  PERF.travail("pour_toi", debutCpu);
}
function brancherPourToi(propositions) {
  const corps = $("#ptCorps");
  if (!corps) return;
  corps.querySelectorAll("[data-pt-voir]").forEach((b) => b.onclick = () => {
    const id = b.dataset.ptVoir;
    marquerVu([id]);
    if (!NAV_FLOTTANTE.matches) fermerPourToi();
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(id));
  });
  corps.querySelectorAll("[data-pt-expand]").forEach((b) => {
    b.onclick = (event) => {
      event.stopPropagation();
      const groupe = b.closest(".pt-groupe");
      const suite = groupe ? groupe.querySelector("[data-pt-suite]") : null;
      if (!suite) return;
      suite.hidden = false;
      b.hidden = true;
      b.setAttribute("aria-expanded", "true");
    };
  });
  corps.querySelectorAll("[data-pt-save]").forEach((b) => {
    b.onclick = async (event) => {
      event.stopPropagation();
      const item = propositions.find((x) => String(x.l.id) === String(b.dataset.ptSave));
      if (!item) return;
      await basculerFavori(item.l);
      b.textContent = estFavori(item.l) ? "Enregistr\xE9" : "Enregistrer";
    };
  });
  corps.querySelectorAll("[data-pt-share]").forEach((b) => {
    b.onclick = async (event) => {
      event.stopPropagation();
      const item = propositions.find((x) => String(x.l.id) === String(b.dataset.ptShare));
      if (item) await partagerLieu(item.l);
    };
  });
  corps.querySelectorAll("[data-pt-hide]").forEach((b) => {
    b.onclick = (event) => {
      event.stopPropagation();
      masquerPourToi(b.dataset.ptHide);
      majPourToi();
      toast("Annonce masqu\xE9e");
    };
  });
  const gerer = () => ouvrirEnvies();
  if ($("#ptGerer")) $("#ptGerer").onclick = gerer;
  if ($("#ptPlus")) $("#ptPlus").onclick = gerer;
  const toutVu = $("#ptToutVu");
  if (toutVu) toutVu.onclick = () => {
    marquerVu(propositions.map((x) => x.l.id));
    majPourToi();
  };
}
function marquerVu(ids) {
  const vues = marquesVues();
  ids.forEach((id) => vues.add(id));
  ecrireMarquesVues(vues);
}
function ouvrirEnvies() {
  if (!ENVIES) return;
  if (!NAV_FLOTTANTE.matches) fermerPourToi();
  pileEcrans = [];
  pousserEcran(() => {
    ouvrirFeuille(
      '<h2 class="titre">Tes envies</h2><p class="env-intro">Ce que tu coches sert \xE0 classer \xAB Pour toi \xBB et, plus tard, \xE0 te pr\xE9venir. Rien d\u2019autre n\u2019est d\xE9duit de ton usage.</p><div class="env-liste" id="envListe"></div>',
      { ariaLabel: "Choisir tes envies" }
    );
    peindreEnvies();
  });
}
let enviesGenresOuverts = null;
function peindreEnvies() {
  const zone = $("#envListe");
  if (!zone || !ENVIES) return;
  const carte = (e, genre) => {
    const on = ENVIES.suivie(e.id);
    return '<button type="button" class="env-b' + (genre ? " env-g" : "") + (on ? " actif" : "") + '" data-env="' + esc(e.id) + '" aria-pressed="' + on + '"><em aria-hidden="true">' + e.emoji + "</em><b>" + esc(e.label) + '</b><span class="env-etat" aria-hidden="true">' + (on ? "\u2713" : "+") + "</span></button>";
  };
  let ouvertRendu = false;
  zone.innerHTML = ENVIES.racines().map((e) => {
    if (!e.porteGenres) return carte(e, false);
    const genres = ENVIES.enfants(e.id);
    const suivis = genres.filter((g) => ENVIES.suivie(g.id)).length;
    const ouvert = enviesGenresOuverts === null ? suivis > 0 : enviesGenresOuverts;
    ouvertRendu = ouvert;
    const compte = suivis ? suivis + (suivis > 1 ? " genres suivis" : " genre suivi") : "Choisir un genre";
    return '<div class="env-groupe">' + carte(e, false) + '<button type="button" class="env-plier" data-plier="' + esc(e.id) + '" aria-expanded="' + ouvert + '"><span>' + esc(compte) + '</span><span class="env-chevron" aria-hidden="true">' + (ouvert ? "\u25B4" : "\u25BE") + '</span></button><div class="env-genres"' + (ouvert ? "" : " hidden") + ">" + genres.map((g) => carte(g, true)).join("") + "</div></div>";
  }).join("");
  zone.querySelectorAll("[data-env]").forEach((b) => b.onclick = () => {
    ENVIES.basculer(b.dataset.env);
    peindreEnvies();
    majPourToi();
  });
  zone.querySelectorAll("[data-plier]").forEach((b) => b.onclick = () => {
    enviesGenresOuverts = !ouvertRendu;
    peindreEnvies();
  });
}
function ouvrirPourToi() {
  const p = $("#pourToi");
  if (!p) return;
  p.hidden = false;
  document.body.classList.add("pourtoi-ouvert");
  majPourToi();
}
function fermerPourToi() {
  const p = $("#pourToi");
  if (!p) return;
  document.body.classList.remove("pourtoi-ouvert");
  if (!NAV_FLOTTANTE.matches) p.hidden = true;
}
function pourToiOuvert() {
  const p = $("#pourToi");
  if (!p) return false;
  return NAV_FLOTTANTE.matches ? document.body.classList.contains("pourtoi-ouvert") : !p.hidden;
}
function basculerPourToi() {
  if (!$("#pourToi")) return;
  if (pourToiOuvert()) return fermerPourToi();
  ouvrirPourToi();
}
function poserBesoinsRapides() {
  const hote = $("#barreEnvies");
  if (!hote) return;
  const enTete = NAV_FLOTTANTE.matches;
  hote.hidden = !enTete;
  hote.innerHTML = enTete ? besoinsRapidesHTML() : "";
  if (enTete) brancherBesoinsRapides(hote);
}
let generationAccueil = 0;
let annulerRecoDifferee = null;
let annulerPourToiDifferee = null;
let recoCache = null;
function cleReco() {
  const r = pointDeReference();
  return [
    lieux.length,
    creneau,
    filtreActif,
    triListe,
    montrerFermes ? 1 : 0,
    catsActives ? [...catsActives].sort().join("+") : "",
    filtresHumains ? [...filtresHumains].sort().join("+") : "",
    r ? r[0].toFixed(3) + "," + r[1].toFixed(3) : "?"
  ].join("|");
}
let dernierRecoRendu = null;
function recoDejaCalculee() {
  if (recoCache && recoCache.cle === cleReco()) return recoCache.html;
  if (dernierRecoRendu && dernierRecoRendu.portee === porteeCourante && dernierRecoRendu.html)
    return dernierRecoRendu.html;
  return statutGroupeHTML();
}
function poserRecommandations(jeton, titre) {
  const debutCpu = performance.now();
  try {
    if (jeton !== generationAccueil) return;
    const corps = $("#fbCorps");
    const zone = corps && corps.querySelector("[data-reco-zone]");
    if (!zone) return;
    const enCours = creneau === "maintenant" && !modeAide ? evenementsMaintenant() : [];
    let reco = recommandationsAccueil(7);
    if (enCours.length) {
      const dejaListes = new Set(enCours.slice(0, MAINTENANT_APERCU).map((l) => l.id));
      reco = reco.filter((l) => !dejaListes.has(l.id));
    }
    if (!reco.length && creneau === "maintenant") reco = echantillonImmediat(lieux.filter(nomExploitable));
    if (reco.length) PERF.jalon("cached_pois_visible");
    const html = reco.length ? '<div class="rc-piste rc-colonne" data-testid="primary-results">' + reco.map(carteRecommandation).join("") + "</div>" + indicateurRechercheHTML(reco.length) : dernierRecoRendu && dernierRecoRendu.portee === porteeCourante && dernierRecoRendu.html && rechercheEnCours() ? dernierRecoRendu.html : statutGroupeHTML();
    if (jeton !== generationAccueil) return;
    recoCache = { cle: cleReco(), html };
    if (reco.length) dernierRecoRendu = { portee: porteeCourante, html };
    zone.innerHTML = html;
    brancherGestesRecommandations(zone);
    PERF.jalon("recommandations_posees");
    if (ORDO) ORDO.differer(
      () => enrichirCandidats(
        reco,
        intentionCourante,
        () => {
          if (jeton === generationAccueil) planifierRendu({ accueil: true, feuille: true });
        }
      ),
      { timeout: 1500, valide: () => jeton === generationAccueil }
    );
  } finally {
    PERF.travail("recommandations", debutCpu);
  }
}
const MAINTENANT_APERCU = (window.AutourMaintenant || {}).PLACES || 3;
const MAINTENANT_TOUT = 10;
const APPROCHE_NOMINALE_MS = 10 * 6e4;
function arriveeEstimee(t) {
  return t + APPROCHE_NOMINALE_MS;
}
function versItemMaintenant(l, t) {
  const statut = statutTemps(l, t).statut;
  const evenement = estTemporaire(l);
  let ouvert = null, ouvertALArrivee = null;
  if (!evenement) {
    const dispo = dispoDe(l, arriveeEstimee(t), t);
    if (dispo) {
      ouvert = dispo.status === "open" ? true : dispo.status === "unknown" ? null : false;
      ouvertALArrivee = dispo.isOpenAtArrival;
    }
  }
  return {
    id: l.id,
    estEvenement: evenement,
    annule: !!l.annule,
    enCours: TEMPS.estMaintenant(statut),
    dateIncertaine: statut === "unknown",
    debutLe: l.debutLe,
    finLe: l.finLe,
    lat: l.lat,
    lng: l.lng,
    ferme: estFerme(l),
    categorie: l.cat,
    ouvert,
    ouvertALArrivee,
    /* Le calque vérifié, transmis tel quel. Le moteur en fait ce qu'il veut —
       exclure une fermeture confirmée, remonter une programmation en cours —
       et c'est lui seul qui décide : ce fichier ne fait que porter. */
    current_status: l.current_status || null,
    temporary_closed: l.temporary_closed == null ? null : l.temporary_closed,
    programme_now: Array.isArray(l.programme_now) ? l.programme_now : null
  };
}
function pointDeReference() {
  const c = centreCarte();
  return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : positionMoi;
}
const SEUIL_MEME_ZONE_M = 3e4;
function jeSuisDansLaZoneRegardee() {
  if (!positionPrecise() || !positionMoi) return false;
  const r = pointDeReference();
  if (!Array.isArray(r)) return false;
  return distanceM(positionMoi[0], positionMoi[1], r[0], r[1]) <= SEUIL_MEME_ZONE_M;
}
function rayonRegarde() {
  const socle = (window.AutourMaintenant || {}).RAYON_MAX_M || 3e3;
  if (!map || !map.getBounds) return socle;
  try {
    const b = map.getBounds(), c = b.getCenter();
    const demiDiagonale = distanceM(c.lat, c.lng, b.getNorth(), b.getEast());
    return Math.max(socle, demiDiagonale);
  } catch (e) {
    return socle;
  }
}
function contexteMaintenant() {
  const ref = pointDeReference();
  return {
    rayonMax: rayonRegarde(),
    maintenant: Date.now(),
    position: Array.isArray(ref) && Number.isFinite(ref[0]) ? ref : null,
    /* Choisir une ville, c'est dire soi-même où l'on regarde : on sait donc
       parfaitement de quoi on parle, même sans la moindre mesure GPS. */
    positionConnue: positionConnue() || !!rechercheGeo,
    positionEnCours: rechercheEtat.location === SEARCH_STATES.REQUESTING_LOCATION && !rechercheGeo,
    positionRefusee: rechercheEtat.location === SEARCH_STATES.LOCATION_DENIED && !rechercheGeo,
    chargement: rechercheEnCours(),
    panne: panneTechnique(),
    /* CE QUE LA PERSONNE A EXPLICITEMENT DEMANDÉ.
    
           « Maintenant » écarte les commodités — supermarché, pharmacie, métro —
           parce qu'une sélection de trois places ne doit pas se remplir de
           l'annuaire des commerces ouverts. Mais « pharmacie ouverte maintenant »
           est une demande, pas une suggestion : ce qui a été nommé revient.
    
           Rien n'est deviné ici : on ne transmet que des catégories choisies dans
           l'interface ou comprises dans une phrase tapée. */
    categoriesDemandees: categoriesDemandees()
  };
}
function categoriesDemandees() {
  const dites = /* @__PURE__ */ new Set();
  if (catsActives) catsActives.forEach((c) => dites.add(c));
  if (filtreActif && filtreActif !== "tout") dites.add(filtreActif);
  const q = intentionCourante && intentionCourante.chips;
  if (q) q.forEach((c) => {
    if (c && c.type === "cat" && c.id) dites.add(String(c.id).split(":")[1]);
  });
  return [...dites];
}
let itemsMemo = { cle: null, items: null };
const dispoMemo = /* @__PURE__ */ new Map();
const DISPO_MEMO_MAX = 600;
function itemMemoise(l, t, minute) {
  const cle = l.id + "|" + minute;
  const vu = dispoMemo.get(cle);
  if (vu) return vu;
  const item = versItemMaintenant(l, t);
  if (dispoMemo.size > DISPO_MEMO_MAX) dispoMemo.clear();
  dispoMemo.set(cle, item);
  return item;
}
function itemsMaintenant(ctx) {
  const minute = Math.floor(ctx.maintenant / 6e4);
  const source = lieux.filter(dansZoneActive);
  const cle = idZoneActive() + "|" + minute + "|" + source.length;
  if (itemsMemo.cle === cle) return itemsMemo.items;
  const items = source.map((l) => itemMemoise(l, ctx.maintenant, minute));
  itemsMemo = { cle, items };
  return items;
}
function oublierItemsMaintenant() {
  itemsMemo = { cle: null, items: null };
}
function selectionMaintenant() {
  const M = window.AutourMaintenant;
  if (!M) return [];
  const ctx = contexteMaintenant();
  const retenus = M.selection(itemsMaintenant(ctx), ctx);
  const parId = new Map(lieux.map((l) => [l.id, l]));
  return retenus.map((i) => {
    const l = parId.get(i.id);
    return l ? Object.assign({}, l, { nature: i.nature }) : null;
  }).filter(Boolean);
}
function totalMaintenant() {
  const M = window.AutourMaintenant;
  if (!M) return 0;
  const ctx = contexteMaintenant();
  return M.total(itemsMaintenant(ctx), ctx);
}
function aveuCouvertureMaintenant(combienAffiches) {
  if (combienAffiches >= MAINTENANT_APERCU) return "";
  const cherche = rechercheEnCours();
  const panne2 = panneTechnique();
  if (!cherche && !panne2) return "";
  return '<p class="mn-couverture" role="status">' + (cherche ? "Autour cherche encore : d\u2019autres propositions peuvent arriver." : "Une source n\u2019a pas r\xE9pondu \u2014 il se passe peut-\xEAtre plus de choses qu\u2019ici.") + "</p>";
}
function nouveauPourToi() {
  const propositions = propositionsPourToi();
  return propositions.find((x) => !x.vu && x.nouveau) || null;
}
function blocNouveauPourToi() {
  if (creneau !== "maintenant" || modeAide) return "";
  const x = nouveauPourToi();
  if (!x) return "";
  const l = x.l;
  const c = categorieAffichee(l);
  const visuel = l.image ? '<img class="npt-img" src="' + esc(l.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="npt-img npt-img-vide" aria-hidden="true">' + c.emoji + "</span>";
  const bas = [dateProposition(l), (l.cp || l.adresse || "").trim()].filter(Boolean).join(" \xB7 ");
  return '<section class="npt" data-testid="nouveau-pour-toi"><p class="npt-tete"><em aria-hidden="true">\u2728</em>NOUVEAU POUR TOI</p><button class="npt-l" data-npt="' + esc(l.id) + '">' + visuel + '<span class="npt-txt"><b>' + esc(l.titre) + "</b>" + (bas ? "<i>" + esc(bas) + "</i>" : "") + '</span><span class="npt-fl" aria-hidden="true">\u203A</span></button></section>';
}
function blocMaintenantAccueil() {
  if (creneau !== "maintenant" || modeAide) return "";
  const M = window.AutourMaintenant;
  if (!M) return "";
  const liste = selectionMaintenant();
  const combien = totalMaintenant();
  const ctx = contexteMaintenant();
  const etat2 = M.etat(Object.assign({ resultats: liste.length }, ctx));
  if (liste.length >= 1) PERF.jalon("maintenant_premier");
  if (liste.length >= MAINTENANT_APERCU) PERF.jalon("maintenant_complet");
  const mots = M.textes(etat2, ctx);
  const proposables = PLAF ? Math.min(combien, PLAF.limiteMaintenant()) : combien;
  const affiche = PLAF && combien > PLAF.limiteMaintenant() ? PLAF.limiteMaintenant() + "+" : String(proposables);
  const tete = '<p class="mn-tete"><em aria-hidden="true">\u26A1</em><b>Maintenant</b>' + (etat2 === M.ETATS.READY && combien ? "<span>(" + affiche + ")</span>" : "") + "</p>";
  let corps;
  if (etat2 === M.ETATS.READY) {
    const derriere = Math.min(combien, MAINTENANT_TOUT);
    corps = liste.map(ligneMaintenant).join("") + (derriere > liste.length ? '<button class="mn-tout" data-mn-tout="1">Voir tout (' + derriere + ")</button>" : "") + aveuCouvertureMaintenant(liste.length);
  } else if (etat2 === M.ETATS.LOADING) {
    corps = '<div class="mn-attente" aria-hidden="true"><i></i><i></i><i></i></div>';
  } else {
    corps = '<div class="mn-rien" role="status"><p>' + esc(mots.ligne) + "</p>" + (mots.sortie ? '<button class="mn-sortie" data-mn-sortie="' + esc(etat2) + '">' + esc(mots.sortie) + "</button>" : "") + "</div>";
  }
  if (modeTerritorial && etat2 === M.ETATS.READY)
    compterTerritorial("territorial_results_count", liste.length);
  return (modeTerritorial ? enTeteTerritoriale() : "") + '<section class="mn" data-testid="maintenant-liste" data-mn-etat="' + esc(etat2) + '" aria-busy="' + (etat2 === M.ETATS.LOADING) + '">' + tete + '<div class="mn-corps">' + corps + "</div></section>" + (modeTerritorial ? blocServicesTerritoriaux() : "");
}
function ongletsTemps() {
  const enCours = compterMaintenant();
  return '<div class="ong-temps" role="tablist" aria-label="Quand">' + CRENEAUX.map((c) => {
    const maintenant = c.id === "maintenant";
    const libelle = maintenant ? "\u26A1 " + c.label : c.label;
    const ouvrables = PLAF ? Math.min(enCours, PLAF.limiteMaintenant()) : enCours;
    const compte = maintenant && enCours ? '<span class="ong-compte" aria-hidden="true">' + (PLAF && enCours > PLAF.limiteMaintenant() ? ouvrables + "+" : ouvrables) + "</span>" : "";
    const lu = maintenant && enCours ? ' aria-label="' + esc(c.label) + " : " + enCours + " \xE9v\xE9nement" + (enCours > 1 ? "s" : "") + ' en cours"' : "";
    return '<button class="ong' + (maintenant ? " ong-maintenant" : "") + (c.id === creneau ? " actif" : "") + '" role="tab" aria-selected="' + (c.id === creneau) + '" data-creneau="' + c.id + '"' + lu + ">" + esc(libelle) + compte + "</button>";
  }).join("") + "</div>";
}
function statutGroupeHTML() {
  const etatGroupe = etatDonnees(0);
  if (etatGroupe === ETATS_DONNEES.LOCATION_LOADING || etatGroupe === ETATS_DONNEES.DATA_LOADING) return squeletteHTML(3);
  if (etatGroupe === ETATS_DONNEES.LOCATION_UNKNOWN)
    return '<p class="fb-statut">Choisis un point de d\xE9part pour voir ce qui se passe autour.</p>';
  if (creneau === "maintenant") {
    const technique = statutRechercheHTML(0);
    if (technique && !/Rien d’ouvert à proximité/.test(technique)) return technique;
    return '<div class="fb-statut" data-testid="maintenant-vide">Rien en cours pr\xE8s de toi.<br><button data-creneau-vers="avenir">Voir ce qui arrive bient\xF4t \u2192</button><button data-etat-action="all">Voir tous les lieux</button></div>';
  }
  const groupe = CRENEAUX.find((x) => x.id === creneau) || CRENEAUX[0];
  return '<p class="fb-statut">Rien d\u2019annonc\xE9 pour \xAB ' + esc(groupe.label.toLowerCase()) + " \xBB dans cette zone.<br>Les \xE9v\xE9nements arrivent au fil des publications.</p>";
}
function blocOuRegarder() {
  if (positionConnue()) return "";
  const intentions = [
    ...BESOINS_PRINCIPAUX.slice(0, 4).map((b) => ({ id: b.id, emoji: b.emoji, label: b.label })),
    { id: "aide", emoji: "\u2764\uFE0F", label: "Aide" }
  ];
  return '<section class="pdep" data-testid="ou-regarder"><p class="pdep-titre">O\xF9 veux-tu regarder ?</p><div class="pdep-actions"><button class="pdep-btn pdep-fort" data-ou="position">\u2316 Utiliser ma position</button><button class="pdep-btn" data-ou="ville">Choisir une ville</button></div><p class="pdep-sous">Ou commence par une envie :</p><div class="pdep-envies">' + intentions.map((i) => '<button class="pdep-envie" data-ou-besoin="' + esc(i.id) + '"><em>' + i.emoji + "</em>" + esc(i.label) + "</button>").join("") + "</div></section>";
}
function raisonCourte(l) {
  if (l.annule) return null;
  if (estTemporaire(l)) {
    const etat2 = statutTemps(l);
    if (etat2.statut === TEMPS.STATUTS.EN_COURS) return { t: "\u26A1 En cours", c: "chaud" };
    if (etat2.statut === TEMPS.STATUTS.IMMINENT) return { t: "\u26A1 Commence bient\xF4t", c: "chaud" };
    const section = TEMPS.sectionTemporelle(etat2, Date.now());
    if (section === "ce_soir") return { t: "Ce soir", c: "" };
    if (section === "ce_week_end") return { t: "Ce week-end", c: "" };
    return { t: "\xC9ph\xE9m\xE8re", c: "" };
  }
  const d = dispoDe(l);
  if (d && d.isOpenNow && d.closesAtTime && fermeDansMoinsDUneHeure(d))
    return { t: "Ferme bient\xF4t \xB7 " + heureFrancaise(d.closesAtTime), c: "tiede" };
  if (d && d.isOpenNow)
    return {
      t: d.closesAtTime ? "Ouvert \xB7 jusqu\u2019\xE0 " + heureFrancaise(d.closesAtTime) : "Ouvert maintenant",
      c: "ouvert"
    };
  const prix = DONNEES ? DONNEES.normaliserPrix(l) : null;
  if (prix && prix.level === 0 && prix.confidence >= 0.8) return { t: "Gratuit", c: "" };
  const avis = Number(l.avis);
  if (Number.isFinite(Number(l.note)) && Number(l.note) >= 4.5 && Number.isFinite(avis) && avis >= 50)
    return { t: "Appr\xE9ci\xE9 autour de toi", c: "" };
  return null;
}
function fermeDansMoinsDUneHeure(d) {
  if (!d || !d.closesAtTime) return false;
  const [h, m] = String(d.closesAtTime).split(":").map(Number);
  if (!Number.isFinite(h)) return false;
  const n = /* @__PURE__ */ new Date();
  let reste = h * 60 + (m || 0) - (n.getHours() * 60 + n.getMinutes());
  if (reste < -12 * 60) reste += 24 * 60;
  return reste > 0 && reste <= 60;
}
function carteRecommandation(l) {
  favorisEnMemoire.set(cleFavori(l), l);
  const c = categorieAffichee(l, { emoji: "\u{1F4CD}" });
  const eta = positionPrecise() ? l.rankEta : null;
  const dispo = l.rankAvailability;
  const cats = etiquettesLisibles(l).join(" \u2022 ") || (CATS[l.cat] ? CATS[l.cat].nom || l.cat : l.cat);
  const teinte = COULEURS_CAT[l.cat] || "#5D6B63";
  const visuel = '<figure class="rc-photo rc-photo-vide" style="--teinte:' + teinte + '"><i>' + c.emoji + "</i>" + (l.image ? '<img loading="lazy" decoding="async" alt="" src="' + esc(l.image) + `" onload="this.classList.add('vue');window.AutourPerf&&AutourPerf.jalon('images_ready')">` : "") + (l.image && l.imageAttribution ? "<figcaption>Photo : " + attributionPhoto(l) + "</figcaption>" : "") + "</figure>";
  const minutes = eta && Number.isFinite(eta.minutes) ? eta.minutes + " min" : "";
  const detail = [];
  const marcheSeule = eta && eta.walkMinutes && eta.walkMinutes === eta.minutes && !(eta.lines && eta.lines.length);
  if (eta && eta.walkMinutes && !marcheSeule) detail.push("\u{1F6B6} " + eta.walkMinutes + " min");
  if (eta && eta.lines && eta.lines.length) detail.push("\u{1F687} " + esc(eta.lines[0]));
  const dejaEnCours = estTemporaire(l) && statutTemps(l).statut === TEMPS.STATUTS.EN_COURS;
  const arrivee = l.rankArrival && !dejaEnCours && positionPrecise() ? "Arriv\xE9e " + heureLocale(l.rankArrival, l) : dispo && dispo.closesAtTime ? "Ferme \xE0 " + heureFrancaise(dispo.closesAtTime) : "";
  const quand = estTemporaire(l) ? TEMPS.libelleTemporel(
    l,
    instantCreneau().getTime(),
    { disponibilite: (x, t) => dispoDe(x, null, t), statut: statutTemps(l, instantCreneau().getTime()) }
  ) : "";
  const etatQuand = quand ? statutTemps(l, instantCreneau().getTime()).statut : "";
  const classeQuand = etatQuand === TEMPS.STATUTS.EN_COURS ? " en-cours" : etatQuand === TEMPS.STATUTS.IMMINENT ? " imminent" : etatQuand === TEMPS.STATUTS.INCONNU ? " flou" : "";
  const ou = l.adresse && l.adresse !== l.titre ? l.adresse : l.cp && l.cp !== l.titre && l.cp !== COMMUNE_INCONNUE ? l.cp : "";
  const d = distanceDepuisZone(l);
  const dist = Number.isFinite(d) ? formatDist(d) : "";
  const siteCinema = l.cat === "cinema" && l.url ? l.url : "";
  return '<div class="rc-carte' + (l.annule ? " annulee" : "") + '" role="button" tabindex="0" data-ac="' + esc(l.id) + '">' + visuel + '<span class="rc-corps"><span class="rc-haut"><span class="rc-cats" style="--cat:' + teinte + '">' + (l.annule ? '<b class="rc-annule">Annul\xE9</b>' : esc(cats)) + "</span>" + boutonCoeur(l) + '</span><span class="rc-nom">' + esc(l.titre) + "</span>" + (ou ? '<span class="rc-ou">' + esc(ou) + "</span>" : "") + (quand ? '<span class="rc-quand' + classeQuand + '" data-testid="carte-quand">' + esc(quand) + "</span>" : "") + (() => {
    const r = raisonCourte(l);
    return r && !quand ? '<span class="rc-pourquoi ' + r.c + '" data-testid="carte-pourquoi">' + esc(r.t) + "</span>" : "";
  })() + '<span class="rc-ligne">' + (l.note ? '<span class="rc-note">\u2605 ' + l.note.toFixed(1).replace(".", ",") + (l.avis ? " <i>(" + l.avis + ")</i>" : "") + "</span>" : '<span class="rc-note"></span>') + '<span class="rc-mesure">' + (dist ? '<span class="rc-dist">' + esc(dist) + "</span>" : "") + (minutes ? '<span class="rc-min">' + minutes + "</span>" : "") + "</span></span>" + (siteCinema ? '<a class="rc-lien" href="' + esc(siteCinema) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Voir le cin\xE9ma</a>' : "") + (detail.length ? '<span class="rc-trajet">' + detail.join(" ") + "</span>" : "") + (arrivee ? '<span class="rc-arrivee">' + esc(arrivee) + "</span>" : "") + "</span></div>";
}
const RACCOURCIS_AUTOUR = [
  { id: "activites", emoji: "\u{1F3C3}", label: "Activit\xE9s", teinte: "#2E9E4F", besoin: "bouger" },
  { id: "culture", emoji: "\u{1F3DB}\uFE0F", label: "Culture", teinte: "#6D3BEB", besoin: "culture" },
  {
    id: "musique",
    emoji: "\u{1F3B5}",
    label: "Musique",
    teinte: "#E0316E",
    besoin: "culture",
    sous: "Concerts et spectacles"
  },
  { id: "lieux", emoji: "\u2615", label: "Lieux", teinte: "#8A5A2B", besoin: "chiller" },
  {
    id: "sports",
    emoji: "\u26BD",
    label: "Sports",
    teinte: "#2673E8",
    besoin: "bouger",
    sous: "Terrains et \xE9quipements"
  },
  { id: "plus", emoji: "\u22EF", label: "Plus", teinte: "#5D6B63", besoin: "plus" }
];
function grilleRaccourcisAutour() {
  return '<section class="adt" data-testid="autour-de-toi"><div class="adt-grille">' + RACCOURCIS_AUTOUR.map((r) => '<button class="adt-b" data-adt="' + esc(r.id) + '"><span class="adt-rond" style="background:' + r.teinte + '">' + r.emoji + '</span><span class="adt-lab">' + esc(r.label) + "</span></button>").join("") + "</div></section>";
}
function ouvrirRaccourciAutour(id) {
  const r = RACCOURCIS_AUTOUR.find((x) => x.id === id);
  if (!r) return;
  if (modeAide) basculerAide();
  ouvrirFeuille2(r.besoin);
  if (!r.sous) return;
  const b = BESOIN_DE(r.besoin);
  const i = b && b.sous ? b.sous.findIndex((x) => x.label === r.sous) : -1;
  if (i >= 0) {
    sousChoisi = i;
    majFeuille2();
    rendre();
  }
}
function blocTransports() {
  if (!coucheTransport) return "";
  return '<div class="tr-bloc"><span class="tr-icone" aria-hidden="true">\u{1F68C}</span><span class="tr-txt"><span class="tr-titre">Transports autour de toi</span><span class="tr-lignes">Arr\xEAts et stations affich\xE9s sur la carte</span></span></div>';
}
function brancherFeuille2() {
  const corps = $("#fbCorps");
  corps.querySelectorAll('[role="button"][data-ac]').forEach((x) => x.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      x.click();
    }
  });
  corps.querySelectorAll("[data-rc-tout]").forEach((b) => b.onclick = () => {
    const groupe = CRENEAUX.find((x) => x.id === creneau) || CRENEAUX[0];
    const connus = recommandationsAccueil(Infinity, { tout: true });
    const tout = PLAF ? PLAF.appliquer(connus, creneau === "maintenant" ? PLAF.limiteMaintenant() : PLAF.limiteExplorer(connus.length)) : connus;
    pileEcrans = [];
    pousserEcran(() => afficherListe(
      "\u2728",
      creneau === "maintenant" ? "Autour de toi" : groupe.label,
      tout,
      false,
      () => b.click(),
      connus.length
    ));
  });
  corps.querySelectorAll("[data-chip]").forEach((b) => b.onclick = () => retirerChip(b.dataset.chip));
  corps.querySelectorAll("[data-retour-moi]").forEach((b) => b.onclick = revenirAutourDeMoi);
  brancherBesoinsRapides(corps);
  corps.querySelectorAll("[data-npt]").forEach((b) => b.onclick = () => {
    const id = b.dataset.npt;
    marquerVu([id]);
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(id));
  });
  corps.querySelectorAll("[data-adt]").forEach((b) => b.onclick = () => ouvrirRaccourciAutour(b.dataset.adt));
  corps.querySelectorAll("[data-adt-tout]").forEach((b) => b.onclick = () => ouvrirFeuille2("plus"));
  corps.querySelectorAll("[data-aide-accueil]").forEach((b) => b.onclick = () => {
    if (!modeAide) basculerAide();
    ouvrirFeuille2("aide");
  });
  corps.querySelectorAll("[data-sa]").forEach((b) => b.onclick = () => {
    sousAide = b.dataset.sa;
    besoinsAide = sousAide === "urgence" ? [] : [sousAide];
    intentionsSanteAide = sousAide === "parler" ? ["mentale"] : [];
    oublierPhraseAide();
    chargerAideSiBesoin();
    majFeuille2();
    reinitialiserScrollFeuille();
    rendre();
  });
  const form = $("#formBesoin");
  if (form) form.onsubmit = (e) => {
    e.preventDefault();
    const champ = $("#champBesoin");
    const phrase = (champ && champ.value || "").trim();
    if (!phrase) return;
    if (champ) champ.blur();
    lancerBesoinAide(phrase);
  };
  corps.querySelectorAll("[data-besoin-off]").forEach((b) => b.onclick = () => {
    const id = b.dataset.besoinOff;
    if (id === "age") {
      ageDeclare = null;
    } else {
      besoinsAide = besoinsAide.filter((x) => x !== id);
      if (sousAide === id) sousAide = besoinsAide[0] || null;
      if (sousAide !== "sante" && sousAide !== "parler") intentionsSanteAide = [];
    }
    majFeuille2();
  });
  corps.querySelectorAll("[data-as-plus]").forEach((b) => b.onclick = () => {
    elargirZone();
    chargerAideSiBesoin(true);
    majFeuille2();
  });
  function basculerVersExplorer(requete) {
    redirectionExplorer = null;
    if (modeAide) basculerAide();
    ouvrirAccueilFeuille();
    ongletCourant = "explorer";
    marquerNavigation("explorer");
    contexteExplorer = null;
    if (requete) {
      recherche = requete;
      const champ = $("#rech");
      if (champ) champ.value = requete;
      ouvrirResultats(requete);
    }
  }
  corps.querySelectorAll("[data-vers-explorer]").forEach((b) => b.onclick = () => {
    basculerVersExplorer((redirectionExplorer || {}).requete || "");
  });
  corps.querySelectorAll("[data-aide-lecture]").forEach((b) => b.onclick = () => {
    const id = b.dataset.aideLecture;
    if (id === "lieu") {
      basculerVersExplorer((redirectionExplorer || {}).requete || "");
      return;
    }
    redirectionExplorer = null;
    besoinsAide = AIDE && AIDE.BESOIN_DE(id) ? [id] : [];
    sousAide = besoinsAide[0] || "autre";
    intentionsSanteAide = [];
    chargerAideSiBesoin();
    majFeuille2();
    reinitialiserScrollFeuille();
  });
  corps.querySelectorAll("[data-aide-reformuler]").forEach((b) => b.onclick = () => {
    redirectionExplorer = null;
    besoinsAide = [];
    sousAide = null;
    intentionsSanteAide = [];
    oublierPhraseAide();
    majFeuille2();
    reinitialiserScrollFeuille();
  });
  corps.querySelectorAll("[data-aide-general]").forEach((b) => b.onclick = () => {
    redirectionExplorer = null;
    besoinsAide = [];
    sousAide = "autre";
    intentionsSanteAide = [];
    oublierPhraseAide();
    majFeuille2();
  });
  corps.querySelectorAll("[data-aide-rester]").forEach((b) => b.onclick = () => {
    redirectionExplorer = null;
    besoinsAide = [];
    sousAide = "autre";
    intentionsSanteAide = [];
    oublierPhraseAide();
    majFeuille2();
  });
  corps.querySelectorAll("[data-as]").forEach((b) => b.onclick = () => {
    const quoi = b.dataset.as;
    if (quoi === "ville") {
      ouvrirRecherche();
      const c = $("#rech");
      if (c) c.placeholder = "Dans quelle ville ?";
      return;
    }
    if (quoi === "general") {
      besoinsAide = [];
      sousAide = "autre";
      intentionsSanteAide = [];
      oublierPhraseAide();
      majFeuille2();
      return;
    }
    if (quoi === "reformuler") {
      besoinsAide = [];
      sousAide = null;
      intentionsSanteAide = [];
      oublierPhraseAide();
      majFeuille2();
      return;
    }
  });
  corps.querySelectorAll("[data-mn]").forEach((b) => b.onclick = () => {
    const l = lieux.find((x) => x.id === b.dataset.mn);
    if (!l) return;
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(l.id));
  });
  corps.querySelectorAll("[data-tsv]").forEach((b) => b.onclick = () => {
    const l = lieux.find((x) => x.id === b.dataset.tsv);
    if (!l) return;
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(l.id));
  });
  corps.querySelectorAll("[data-tterr-recentrer]").forEach((b) => b.onclick = () => {
    if (!contexteTerritorial || !contexteTerritorial.zones.length) return;
    const z = contexteTerritorial.zones[0];
    if (CTX) definirZoneActive(CTX.zoneRecherche(contexteTerritorial.nom, [z.lat, z.lng], null));
    allerVers([z.lat, z.lng], 15);
    reevaluerTerritorial({ ouverture: true });
    chargerAutourDuPoint(z.lat, z.lng, { force: true });
    majFeuille2();
  });
  corps.querySelectorAll("[data-mn-tout]").forEach((b) => b.onclick = () => {
    pileEcrans = [];
    pousserEcran(() => afficherListe(
      "\u26A1",
      "Maintenant",
      classerLieux(evenementsMaintenant(), false).slice(0, MAINTENANT_TOUT),
      false,
      () => {
        pileEcrans = [];
        majFeuille2();
      }
    ));
  });
  corps.querySelectorAll("[data-mn-sortie]").forEach((b) => b.onclick = () => {
    const M = window.AutourMaintenant;
    const ctx = contexteMaintenant();
    if (ctx.positionRefusee || !ctx.positionConnue) {
      ouvrirRecherche();
      return;
    }
    if (b.dataset.mnSortie === (M && M.ETATS.ERROR)) {
      const centre = pointCarte();
      rechercheEtat.overpass = SEARCH_STATES.IDLE;
      definirEtatRecherche("places", SEARCH_STATES.LOADING_PLACES);
      chargerAutourDuPoint(centre.lat, centre.lng, { force: true });
      majFeuille2();
      return;
    }
    if (creneau !== "maintenant") {
      majFeuille2();
      return;
    }
    montrerFermes = false;
    filtreActif = "tout";
    if (catsActives) catsActives.clear();
    majFeuille2();
    reinitialiserScrollFeuille();
  });
  corps.querySelectorAll("[data-creneau-vers]").forEach((b) => b.onclick = () => {
    const cible = b.dataset.creneauVers;
    if (creneau === cible) return;
    creneau = cible;
    filtreMaintenant = creneau === "maintenant";
    majFeuille2();
    reinitialiserScrollFeuille();
    rendre();
  });
  corps.querySelectorAll("[data-creneau]").forEach((b) => b.onclick = () => {
    if (creneau === b.dataset.creneau) return;
    const cible = b.dataset.creneau;
    creneau = cible;
    filtreMaintenant = creneau === "maintenant";
    const barre = b.closest("[role=tablist]");
    if (barre) barre.querySelectorAll("[data-creneau]").forEach((onglet) => {
      const actif = onglet === b;
      onglet.classList.toggle("actif", actif);
      onglet.setAttribute("aria-selected", String(actif));
    });
    reinitialiserScrollFeuille();
    apresPeinture(() => {
      if (creneau === cible)
        planifierRendu({ feuille: true, carte: true, filtres: true });
    });
  });
  corps.querySelectorAll("[data-ou]").forEach((b) => b.onclick = () => {
    if (b.dataset.ou === "position") {
      suivreMaPosition();
      return;
    }
    ouvrirRecherche();
    const champ = $("#rech");
    if (champ) {
      champ.value = "";
      champ.placeholder = "Dans quelle ville ?";
    }
  });
  corps.querySelectorAll("[data-ou-besoin]").forEach((b) => b.onclick = () => {
    const id = b.dataset.ouBesoin;
    if (id === "aide") {
      if (!modeAide) basculerAide();
      return;
    }
    ouvrirFeuille2(id);
  });
  corps.querySelectorAll("[data-bn]").forEach((b) => b.onclick = () => {
    const id = b.dataset.bn;
    if (id === "aide") {
      if (!modeAide) basculerAide();
      ouvrirFeuille2("aide");
      return;
    }
    if (modeAide) basculerAide();
    ouvrirFeuille2(id);
  });
  corps.querySelectorAll("[data-sc]").forEach((b) => b.onclick = () => {
    const bes = BESOIN_DE(feuilleNiveau);
    const i = Number(b.dataset.sc);
    sousChoisi = sousChoisi === i ? null : i;
    catsActives = sousChoisi === null ? null : new Set(bes.sous[i].cats);
    filtreActif = "tout";
    if (sousChoisi !== null) {
      mettreAJourProfil("categorie", bes.sous[i].cats[0]);
      chargerPourCats(bes.sous[i].cats);
      const editorial = typeEditorial(bes.sous[i]);
      if (editorial !== "autre") chargerEditorial(editorial);
      if (feuilleNiveau === "manger") completerRestauration();
    }
    rendre();
    majAccueil();
    majFeuille2();
    majRaccourcis();
    reinitialiserScrollFeuille();
  });
  corps.querySelectorAll("[data-sa]").forEach((b) => b.onclick = () => {
    sousAide = sousAide === b.dataset.sa ? null : b.dataset.sa;
    rendre();
    majAccueil();
    majFeuille2();
    reinitialiserScrollFeuille();
  });
  corps.querySelectorAll("[data-etat-action]").forEach((b) => b.onclick = () => {
    const action = b.dataset.etatAction;
    if (action === "aide") {
      if (!modeAide) basculerAide();
      ouvrirFeuille2("aide");
      return;
    }
    if (action === "all") {
      filtreMaintenant = false;
      montrerFermes = true;
      majFiltres();
      rendre();
      majFeuille2();
      reinitialiserScrollFeuille();
      return;
    }
    const centre = pointCarte();
    rechercheEtat.overpass = SEARCH_STATES.IDLE;
    definirEtatRecherche("places", SEARCH_STATES.LOADING_PLACES);
    if (modeAide) {
      chargerAideSiBesoin(true);
      majFeuille2();
      return;
    }
    chargerAutourDuPoint(centre.lat, centre.lng, { force: true });
    if (feuilleNiveau === "manger") completerRestauration({ force: true });
  });
  corps.querySelectorAll("[data-elargir]").forEach((b) => b.onclick = elargirZone);
  corps.querySelectorAll("[data-vide-action]").forEach((b) => b.onclick = () => {
    const action = b.dataset.videAction;
    if (action === "5km") {
      rayonRecherche = Math.max(rayonRecherche, 5e3);
      surLaCarte((m) => m.setZoom(Math.min(m.getZoom(), 14)), "zoom");
      const centre = map.getCenter();
      chargerAutourDuPoint(centre.lat, centre.lng, { force: true });
      if (sousChoisi !== null) {
        const besoin = BESOIN_DE(feuilleNiveau);
        const sous = besoin && besoin.sous[sousChoisi];
        const editorial = typeEditorial(sous);
        if (editorial !== "autre") chargerEditorial(editorial);
      }
      toast("Recherche \xE9largie \xE0 5 km");
      return;
    }
    if (action === "tout") {
      catsActives = null;
      sousChoisi = null;
      selectionAccueil = false;
      rendre();
      majAccueil();
      majFeuille2();
      majRaccourcis();
      return;
    }
    fermerFeuille2();
    retourFormulaire = false;
    ouvrirModePose();
  });
  corps.querySelectorAll("[data-pied]").forEach((b) => b.onclick = () => {
    const q = b.dataset.pied;
    if (q === "hasard") {
      fermerFeuille2();
      surprendre();
      return;
    }
    if (q === "partage") {
      partagerApp();
      return;
    }
    personnalisation = !personnalisation;
    try {
      localStorage.setItem("autour:perso", personnalisation ? "oui" : "non");
    } catch (e) {
    }
    if (!personnalisation) reinitialiserProfil();
    rendre();
    majAccueil();
    majFeuille2();
    toast(personnalisation ? "Suggestions personnalis\xE9es" : "Pr\xE9f\xE9rences oubli\xE9es");
  });
  brancherGestesRecommandations(corps);
}
function brancherGestesRecommandations(racine) {
  if (!racine) return;
  racine.querySelectorAll('[role="button"][data-ac]').forEach((x) => x.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      x.click();
    }
  });
  racine.querySelectorAll("[data-ac]").forEach((b) => b.onclick = () => {
    const id = b.dataset.ac, cible = lieux.find((x) => x.id === id);
    if (!cible) return;
    mettreAJourProfil("clic", cible.cat);
    allerVers([cible.lat, cible.lng], 17, { duration: 0.5 });
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(id));
  });
  racine.querySelectorAll("[data-coeur]").forEach(() => {
  });
}
function majRaccourcis() {
  const z = $("#raccourcis");
  if (!z) return;
  const plusActif = feuilleNiveau === "plus" || !!(BESOIN_DE(feuilleNiveau) || {}).secondaire;
  const ordre = BESOINS_PRINCIPAUX.filter((b) => b.id !== "aide");
  z.innerHTML = ordre.map((b) => {
    const actif = feuilleNiveau === b.id;
    return '<button class="rc' + (actif ? " actif" : "") + '" data-rc="' + b.id + '"><em>' + b.emoji + "</em>" + esc(b.label.replace(" autour de moi", "")) + "</button>";
  }).join("") + '<button class="rc' + (plusActif ? " actif" : "") + '" data-rc="plus"><em>\u2022\u2022\u2022</em>Plus</button>';
  z.querySelectorAll("[data-rc]").forEach((b) => b.onclick = () => {
    const id = b.dataset.rc;
    if (id === "plus") {
      if (modeAide) basculerAide();
      if (feuilleNiveau === "plus") {
        fermerFeuille2();
        return;
      }
      ouvrirFeuille2("plus");
      if (!rechercheDockeeDesktopDemandee()) fermerRecherche({ force: true });
      return;
    }
    if (id === "aide") {
      if (modeAide) {
        basculerAide();
        fermerFeuille2();
        return;
      }
      basculerAide();
      ouvrirFeuille2("aide");
      return;
    }
    if (modeAide) basculerAide();
    if (feuilleNiveau === id) {
      fermerFeuille2();
      return;
    }
    ouvrirFeuille2(id);
    if (!rechercheDockeeDesktopDemandee()) fermerRecherche({ force: true });
  });
}
function majFiltres() {
  const b = $("#btnLieu");
  if (b) b.classList.toggle("inconnu", !positionConnue());
  const z = $("#filtresHumains");
  if (!z) return;
  if (modeAide) {
    z.hidden = true;
    z.innerHTML = "";
    return;
  }
  const demande = z.dataset.force === "1";
  const actifs = filtresHumains.size > 0 || montrerFermes;
  const montrer = demande || actifs;
  z.hidden = !montrer;
  if (!montrer) {
    z.innerHTML = "";
    return;
  }
  const place = (id) => {
    const i = CONTRAINTES.indexOf(id);
    return i === -1 ? 99 : i;
  };
  const rang = (f) => (filtresHumains.has(f.id) ? 0 : 100) + place(f.id);
  const ordonnes = FILTRES_HUMAINS.slice().sort((a, b2) => rang(a) - rang(b2));
  const visibles2 = demande ? ordonnes : ordonnes.filter((f) => filtresHumains.has(f.id));
  z.innerHTML = visibles2.slice(0, 3).map((f) => '<button class="fh' + (filtresHumains.has(f.id) ? " actif" : "") + '" data-fh="' + f.id + '">' + f.label + "</button>").join("") + // les lieux fermés ne reviennent que sur demande explicite : c'est un
  // choix de l'utilisateur, jamais un défaut
  (demande || montrerFermes ? '<button class="fh' + (montrerFermes ? " actif" : "") + '" data-fermes="1" aria-pressed="' + (montrerFermes ? "true" : "false") + '">Lieux ferm\xE9s</button>' : "");
  z.querySelectorAll("[data-fh]").forEach((x) => x.onclick = () => {
    const id = x.dataset.fh;
    if (filtresHumains.has(id)) filtresHumains.delete(id);
    else filtresHumains.add(id);
    if (id === "famille" && filtresHumains.has(id)) chargerEditorial("family");
    majFiltres();
    rendre();
  });
  const bascule = z.querySelector("[data-fermes]");
  if (bascule) bascule.onclick = () => {
    montrerFermes = !montrerFermes;
    majFiltres();
    rendre();
    majFeuille2();
  };
}
function basculerAide() {
  modeAide = !modeAide;
  sousAide = null;
  besoinsAide = [];
  intentionsSanteAide = [];
  redirectionExplorer = null;
  document.body.classList.toggle("aide", modeAide);
  catsActives = null;
  sousChoisi = null;
  filtreActif = "tout";
  filtresHumains.clear();
  recherche = "";
  if ($("#rech")) $("#rech").value = "";
  selectionAccueil = null;
  montrerFermes = false;
  $("#suggestions").hidden = true;
  majFiltres();
  majRaccourcis();
  requestAnimationFrame(() => setTimeout(() => {
    rendre();
    majAccueil();
  }, 0));
  if (modeAide && positionMoi) {
    chargerAideZone().then(() => {
      rendre();
      majAccueil();
      majFeuille2();
    });
  }
}
function basculerMaintenant() {
  filtreMaintenant = !filtreMaintenant;
  majFiltres();
  rendre();
  majAccueil();
  majFeuille2();
}
function vitalite() {
  if (!positionMoi) return null;
  const [lat, lng] = positionMoi;
  const proches = lieux.filter((l) => distanceM(lat, lng, l.lat, l.lng) < 900);
  const ouverts = proches.filter((l) => l.ouvert === true).length;
  const evs = proches.filter((l) => estTemporaire(l) && !estPasse(l)).length;
  const score = ouverts + evs * 5;
  if (score >= 25) return { p: "\u{1F7E2}", t: "Quartier tr\xE8s vivant", n: ouverts, e: evs };
  if (score >= 8) return { p: "\u{1F7E1}", t: "Activit\xE9 normale", n: ouverts, e: evs };
  return { p: "\u{1F534}", t: "Quartier calme", n: ouverts, e: evs };
}
const MEMOIRE_SURPRISES = 12;
let surprisesVues = (() => {
  try {
    return JSON.parse(localStorage.getItem("autour:surprises") || "[]");
  } catch (e) {
    return [];
  }
})();
function memoriserSurprise(id) {
  surprisesVues.unshift(id);
  surprisesVues = surprisesVues.slice(0, MEMOIRE_SURPRISES);
  try {
    localStorage.setItem("autour:surprises", JSON.stringify(surprisesVues));
  } catch (e) {
  }
}
const CATS_SANS_INTERET = ["metro", "bus", "toilettes", "recharge", "velo", "commerce"];
function choisirSurprise(liste, ctx, profil) {
  const depuis = ctx.moi && ctx.moi[0] ? ctx.moi : ctx.centre;
  const possibles = liste.filter((l) => {
    if (l.ouvert === false) return false;
    if (JAMAIS_AUTO.has(l.cat)) return false;
    if (!l.titre || l.titre.length < 3) return false;
    if (CATS_SANS_INTERET.includes(l.cat)) return false;
    if (surprisesVues.includes(l.id)) return false;
    if ((profil.ignores[l.cat] || 0) >= 3) return false;
    return distanceM(depuis[0], depuis[1], l.lat, l.lng) <= 2500;
  });
  if (!possibles.length) return null;
  const notes = possibles.map((l) => {
    const r = scoreLieu(l, ctx);
    const vues = profil.categories[l.cat] || 0;
    const decouverte = 100 / (1 + vues);
    return {
      l,
      raison: r.raison,
      total: 0.7 * r.score + 0.2 * decouverte + 0.1 * (Math.random() * 100)
    };
  }).sort((a, b) => b.total - a.total);
  const haut = notes.slice(0, Math.min(5, notes.length));
  return haut[Math.floor(Math.random() * haut.length)];
}
function surprendre() {
  if (!map) return;
  const ctx = contexteActuel();
  const choix = choisirSurprise(lieux, ctx, PROFIL);
  if (!choix) {
    toast(surprisesVues.length ? "Plus rien de neuf dans le coin" : "Rien \xE0 proposer pour l\u2019instant");
    return;
  }
  const l = choix.l;
  memoriserSurprise(l.id);
  const depuis = ctx.moi && ctx.moi[0] ? ctx.moi : ctx.centre;
  const d = distanceM(depuis[0], depuis[1], l.lat, l.lng);
  const c = categorieAffichee(l, { emoji: "\u{1F4CD}", label: "" });
  allerVers([l.lat, l.lng], 17, { duration: 0.7 });
  pileEcrans = [];
  pousserEcran(() => {
    ouvrirFeuille(
      '<p class="sp-tete">\u{1F3B2} Surprise</p><h2 class="titre">' + esc(l.titre) + '</h2><p class="resume"><span>' + c.emoji + " " + esc(c.label) + "</span><span>" + formatDist(d) + "</span><span>" + tempsTrajetMinutes(d, VITESSES_KMH.pied) + " min \xE0 pied</span>" + (l.ouvert === true ? '<span class="ouvert">Ouvert</span>' : l.ouvert === false ? '<span class="ferme">Ferm\xE9</span>' : "") + (l.note ? "<span>\u2605 " + l.note.toFixed(1) + "</span>" : "") + '</p><p class="sp-raison">' + esc(choix.raison) + '</p><div class="actions"><button class="act act-1" id="spAller">Y aller</button><button class="act" id="spEncore">Une autre surprise</button><button class="act" id="spFiche">Voir la fiche</button></div><div class="trajet" id="trajet" hidden></div>'
    );
    $("#spAller").onclick = () => afficherTrajet(l);
    $("#spEncore").onclick = () => {
      mettreAJourProfil("ignore", l.cat);
      surprendre();
    };
    $("#spFiche").onclick = () => pousserEcran(() => ouvrirDetail(l.id));
  });
}
const FILTRE_DU_SIGNAL = Object.freeze({
  travail: "etudier",
  etude: "etudier",
  calme: "etudier",
  famille: "famille",
  accessible: "pmr",
  adapte_groupes: "monde",
  festif: "monde",
  pas_cher: "budget"
});
function interpreter(phrase) {
  const act = { cats: null, filtres: /* @__PURE__ */ new Set(), creneau: null, cuisine: null, dit: [], structure: null };
  if (!COMPRENDRE) return act;
  const st = COMPRENDRE.analyser(phrase, {
    cuisineDe: cuisineRecherchee,
    categorieDe: categorieRecherchee,
    libelleCategorie: (c) => (CATS[c] || {}).label || c
  });
  act.structure = st;
  act.cuisine = st.cuisine;
  const cats = new Set(st.categories);
  if (st.cuisine) CATS_MANGER.forEach((c) => cats.add(c));
  if (cats.size) act.cats = cats;
  st.ambiance.forEach((a) => {
    const f = FILTRE_DU_SIGNAL[a.id];
    if (f) act.filtres.add(f);
  });
  st.contraintes.forEach((c) => {
    if (c.type === "signal") {
      const f = FILTRE_DU_SIGNAL[c.id];
      if (f) act.filtres.add(f);
    }
  });
  if (st.preferences.some((p) => p.type === "proche")) act.filtres.add("proche");
  if (st.groupe === "famille") act.filtres.add("famille");
  act.creneau = st.horaire.creneau;
  act.dit = st.chips.filter((c) => c.type !== "zone").map((c) => c.label);
  if (st.reste && !modeAide) COMPRENDRE.noterReste(st.reste);
  return act;
}
function appliquerPhrase(phrase) {
  mettreAJourProfil("recherche", phrase);
  const ville = villeRecherchee(phrase);
  if (ville) {
    rechercherAilleurs(phrase, ville);
    return;
  }
  const a = interpreter(phrase);
  intentionCourante = a.structure;
  if (!a.dit.length) {
    intentionCourante = null;
    ouvrirResultats(phrase);
    return;
  }
  catsActives = a.cats;
  filtresHumains = a.filtres;
  if (a.creneau) {
    creneau = a.creneau;
    filtreMaintenant = true;
  }
  filtreActif = "tout";
  selectionAccueil = false;
  dessinerFiltres();
  majFiltres();
  rendre();
  if (a.cuisine) {
    const manger = lieux.filter((l) => [...a.cats].some((c) => correspondCategorie(l, c)));
    const correspond = (l) => {
      const c = sansAccents(l.cuisine || "");
      return !!c && (c.includes(a.cuisine) || a.cuisine.includes(c));
    };
    const classes = classerLieux(manger, false);
    const trouves = [...classes.filter(correspond), ...classes.filter((l) => !correspond(l))];
    pileEcrans = [];
    pousserEcran(() => afficherListe(
      "\u{1F37D}\uFE0F",
      "\xAB " + phrase + " \xBB",
      trouves,
      false,
      () => appliquerPhrase(phrase)
    ));
    toast("Compris : " + a.dit.join(" \xB7 "));
    return;
  }
  if (catsActives && catsActives.size) chargerPourCats([...catsActives]);
  const garde = catsActives;
  ouvrirAccueilFeuille();
  catsActives = garde;
  rendre();
  majFeuille2();
  toast("Compris : " + a.dit.join(" \xB7 "));
}
function toutAfficher() {
  selectionAccueil = false;
  rendre();
}
const ACCUEIL_MAX = 7;
const ACCUEIL_SEUIL = 55;
function majAccueil() {
  const debutCpu = performance.now();
  majBadgeMaintenant();
  if (!positionMoi || modeNav) {
    PERF.travail("accueil", debutCpu);
    return;
  }
  if (selectionAccueil === false) {
    PERF.travail("accueil", debutCpu);
    return;
  }
  const ctx = contexteActuel();
  const [lat, lng] = ctx.moi;
  const rayon = modeAide ? 6e3 : 2500;
  let debutEtape = performance.now();
  const visiblesAccueil = visibles();
  PERF.travail("accueil:visibles", debutEtape);
  debutEtape = performance.now();
  let notes = visiblesAccueil.filter((l) => nomExploitable(l) && proposableAuto(l, ctx));
  PERF.travail("accueil:filtrage", debutEtape);
  debutEtape = performance.now();
  notes = notes.map((l) => Object.assign({}, l, { dist: distanceM(lat, lng, l.lat, l.lng) })).filter((l) => l.dist < rayon).map((l) => {
    const r = scoreLieu(l, ctx);
    return Object.assign(l, { score: r.score, raison: r.raison });
  }).sort((a, b) => b.score - a.score);
  PERF.travail("accueil:classement", debutEtape);
  if (modeAide && !montrerFermes)
    notes = ecarterFermesSiAlternative(notes.map((l) => ({ l }))).map((x) => x.l);
  const reserve = notes.slice(0, RAPIDE_MAX);
  const choisis = [];
  const epingles = idsEpingles();
  if (epingles.length) {
    const vus = /* @__PURE__ */ new Set();
    epingles.forEach((id) => {
      if (vus.has(id) || choisis.length >= ACCUEIL_MAX) return;
      const l = notes.find((x) => x.id === id) || lieux.find((x) => x.id === id);
      if (!l) return;
      vus.add(id);
      choisis.push(l);
    });
    notes = notes.filter((l) => !vus.has(l.id));
  }
  if (modeAide) {
    const vues = /* @__PURE__ */ new Set();
    notes.forEach((l) => {
      if (choisis.length >= ACCUEIL_MAX || vues.has(l.cat)) return;
      vues.add(l.cat);
      choisis.push(l);
    });
    notes.forEach((l) => {
      if (choisis.length < ACCUEIL_MAX && !choisis.includes(l)) choisis.push(l);
    });
  } else {
    notes = notes.filter((l) => l.score >= ACCUEIL_SEUIL);
    const ev = notes.find((l) => estTemporaire(l));
    if (ev) choisis.push(ev);
    notes.forEach((l) => {
      if (choisis.length < ACCUEIL_MAX && !choisis.includes(l)) choisis.push(l);
    });
  }
  if (!modeAide && creneau === "maintenant") {
    const jetonCarte = ++generationAccueil;
    if (annulerPourToiDifferee) {
      annulerPourToiDifferee();
      annulerPourToiDifferee = null;
    }
    const affiner = () => {
      const debutAffinage = performance.now();
      if (jetonCarte !== generationAccueil) return;
      const pourToi2 = recommandationsAccueil(ACCUEIL_MAX);
      if (!pourToi2.length || jetonCarte !== generationAccueil) {
        PERF.travail("classement_differe", debutAffinage);
        return;
      }
      const ids = pourToi2.slice(0, ACCUEIL_MAX).map((l) => l.id);
      if (ids.join("|") === (selectionAccueil || []).join("|")) {
        PERF.travail("classement_differe", debutAffinage);
        return;
      }
      selectionAccueil = ids;
      PERF.jalon("selection_affinee");
      rendre();
      if (feuilleNiveau !== null) majFeuille2();
      PERF.travail("classement_differe", debutAffinage);
    };
    annulerPourToiDifferee = ORDO ? ORDO.differer(affiner, { timeout: 400, valide: () => jetonCarte === generationAccueil }) : (affiner(), null);
  }
  selectionAccueil = choisis.map((l) => l.id);
  if (choisis.length) PERF.jalon("scoring_fait");
  memoriserJeuRapide(choisis, reserve);
  if (renduEnLot) {
    PERF.travail("accueil", debutCpu);
    return;
  }
  if (feuilleNiveau !== null) majFeuille2();
  rendre();
  PERF.travail("accueil", debutCpu);
}
function dessinerFiltres() {
  majRaccourcis();
}
function appliquerPosition(p, opts) {
  const o = opts || {};
  const c = [p.coords.latitude, p.coords.longitude];
  noterAutorisationGeo(true);
  memoriserPosition(c, "gps");
  const venaitDeLApproximation = positionApprochee();
  const premiereFois = !positionConnue();
  const regimeAvant = regimeZone(rechercheGeo);
  const bouge = premiereFois || venaitDeLApproximation || !positionMoi || distanceM(positionMoi[0], positionMoi[1], c[0], c[1]) > 150;
  if (bouge) {
    annulerGeneration("demarrage");
    annulerGeneration("zone:precalculee");
  }
  positionMoi = c;
  originePosition = "gps";
  precisionPosition = "point";
  if (bouge && CTX && (!zoneActive || zoneActive.type === CTX.TYPES.MOI))
    definirZoneActive(CTX.zoneMoi(c, commune));
  $("#bandeauGeo").hidden = true;
  if (venaitDeLApproximation) {
    villeDetectee = null;
    commune = "ton quartier";
    $("#hdVille").textContent = "Autour de toi";
  }
  majEnteteLieu();
  detecterVille(c[0], c[1]);
  if (moi) moi.setLatLng(c);
  if (bouge && !o.discret) allerVers(c, 16, { duration: 0.9 });
  planifierRendu({ accueil: true, carte: true, feuille: true, filtres: true });
  if (modeAide) chargerAideSiBesoin(bouge);
  if (bouge) {
    chargerZone(c[0], c[1], { delai: OVERPASS_DELAI_BOOT });
    chargerDonneesTemporaires(c[0], c[1]);
    if (venaitDeLApproximation || distanceM(c[0], c[1], dernierNom[0], dernierNom[1]) > 2e3) {
      dernierNom = c;
      const generationCommune = nouvelleGeneration("contexte:commune", c[0].toFixed(2) + "," + c[1].toFixed(2), true);
      nomCommune(c[0], c[1]).then((n) => {
        if (generationCourante(generationCommune) && n) commune = n;
      }).finally(() => terminerGeneration(generationCommune));
    }
  }
  if (regimeAvant !== "local" && regimeZone(rechercheGeo) === "local") {
    journal.info("Arriv\xE9e dans la zone regard\xE9e : passage en mode local");
    chargerZone(
      rechercheGeo.lat,
      rechercheGeo.lng,
      { force: true, reglages: REGIMES.local }
    );
    planifierRendu({ accueil: true, feuille: true, carte: true });
    toast("Tu es \xE0 " + rechercheGeo.nom + " \xB7 voici ce qu\u2019il y a vraiment autour");
  } else if (!o.discret && (premiereFois || venaitDeLApproximation))
    toast("Position trouv\xE9e \xB7 autour de toi");
  definirEtatRecherche("location", SEARCH_STATES.SUCCESS);
}
const VEILLE_MIN_M = 120;
const VEILLE_MIN_MS = 2e4;
let veilleId = null;
let dernierePriseEnCompte = 0;
function veillerSurLaPosition() {
  if (veilleId !== null) return;
  if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;
  if (document.visibilityState === "hidden") return;
  try {
    veilleId = navigator.geolocation.watchPosition(
      (p) => {
        const c = [p.coords.latitude, p.coords.longitude];
        const d = positionMoi ? distanceM(positionMoi[0], positionMoi[1], c[0], c[1]) : Infinity;
        const bascule = regimeZone(rechercheGeo, c, true) !== regimeZone(rechercheGeo);
        if (!bascule) {
          if (d < VEILLE_MIN_M) return;
          if (Date.now() - dernierePriseEnCompte < VEILLE_MIN_MS) return;
        }
        dernierePriseEnCompte = Date.now();
        appliquerPosition(p, { discret: true });
      },
      () => {
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 2e4 }
    );
  } catch (e) {
    console.error("Autour \xB7 veille de position :", e);
  }
}
function arreterLaVeille() {
  if (veilleId === null) return;
  try {
    navigator.geolocation.clearWatch(veilleId);
  } catch (e) {
  }
  veilleId = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    arreterLaVeille();
    return;
  }
  if (geoDejaAutorisee()) {
    veillerSurLaPosition();
    suivreMaPosition({ silencieux: true });
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    envoyerMetriquesTerritoriales();
    reglerBattementTerritorial();
    return;
  }
  reevaluerTerritorial({ retourPremierPlan: true });
  reglerBattementTerritorial();
});
let localisationEnCours = false;
function suivreMaPosition(opts) {
  const o = opts || {};
  if (!navigator.geolocation) {
    definirEtatRecherche("location", SEARCH_STATES.LOCATION_DENIED);
    etat("Choisis un endroit sur la carte : ce navigateur ne sait pas te localiser.", true);
    return;
  }
  if (localisationEnCours) return;
  localisationEnCours = true;
  definirEtatRecherche("location", SEARCH_STATES.REQUESTING_LOCATION);
  PERF.jalon("geolocation_demandee");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      localisationEnCours = false;
      PERF.jalon("geolocation_ready");
      PERF.mesure("g\xE9olocalisation", "geolocation_demandee", "geolocation_ready");
      appliquerPosition(p, { discret: !!o.silencieux });
      veillerSurLaPosition();
    },
    (err) => {
      localisationEnCours = false;
      if (err && err.code === 1) {
        noterAutorisationGeo(false);
        definirEtatRecherche("location", SEARCH_STATES.LOCATION_DENIED);
      } else {
        definirEtatRecherche("location", SEARCH_STATES.IDLE);
        if (geoDejaAutorisee()) veillerSurLaPosition();
      }
      if (!o.silencieux) proposerPosition();
    },
    /* LE PREMIER POINT N'A PAS BESOIN D'ÊTRE LE MEILLEUR, IL A BESOIN
           D'EXISTER.
    
           `enableHighAccuracy:true` demande le GPS. Sur un ordinateur, cela ne
           change rien : la position vient du réseau et arrive en quelques
           centaines de millisecondes. Sur un téléphone, c'est une acquisition
           satellite — dix à trente secondes en intérieur, davantage encore dans
           un bâtiment ou un métro. Huit secondes de délai signifiaient donc, sur
           mobile et sur mobile seulement, un échec quasi systématique à froid,
           suivi d'un écran qui annonce un refus que personne n'a formulé.
    
           On demande donc d'abord le point RAPIDE — celui du réseau, que le
           téléphone a déjà —, et c'est `veillerSurLaPosition()` qui affine
           ensuite en haute précision, avec `maximumAge:0` et sans pression de
           temps. Le résultat final est identique ; ce qui change, c'est qu'il
           existe une position en attendant. */
    { enableHighAccuracy: false, timeout: 15e3, maximumAge: 6e4 }
  );
}
function proposerPosition() {
  etat(positionApprochee() ? "Zone approximative \xB7 active ta position pour \xEAtre pr\xE9cis." : positionConnue() ? "Position indisponible \xB7 on garde ton dernier quartier." : "Active ta position ou choisis un endroit sur la carte.", true);
}
async function demarrerLocalisation() {
  const etatPerm = await permissionPosition();
  PERF.jalon("permission_" + etatPerm);
  if (etatPerm === "denied") {
    proposerPosition();
    return;
  }
  suivreMaPosition();
}
$("#bandeauOk").onclick = () => {
  $("#bandeauGeo").hidden = true;
  suivreMaPosition();
};
$("#bandeauOk").textContent = "Utiliser ma position";
$("#videOk").onclick = () => {
  $("#bandeauVide").hidden = true;
  if ($("#videOk").dataset.action === "retry") {
    const centre = pointCarte();
    rechercheEtat.overpass = SEARCH_STATES.IDLE;
    chargerAutourDuPoint(centre.lat, centre.lng, { force: true });
    return;
  }
  montrerFermes = true;
  toast("Les lieux ferm\xE9s sont affich\xE9s");
  rendre();
};
performance.mark("autour:script");
PERF.jalon("script");
const ETIQUETTES_LIEU = ["Choisir un endroit", "Zone approximative", "Autour de toi"];
const positionTest = positionLocaleDeTest();
if (!positionTest) demarrerLocalisation();
demarrer(positionTest || positionMemorisee());
PERF.mesure("boot UI", "script", "ui_ready");
function ouvrirRecherche() {
  $("#rechercheOverlay").hidden = false;
  $("#appHeader").hidden = true;
  majRaccourcis();
  layerManager.activate(NOMS_COUCHES.searchOverlay);
  requestAnimationFrame(() => $("#rech").focus());
}
function fermerRecherche(options) {
  const force = !!(options && options.force);
  const dockee = !force && rechercheDockeeDesktopDemandee();
  $("#rechercheOverlay").hidden = !dockee;
  $("#appHeader").hidden = dockee;
  $("#suggestions").hidden = true;
  layerManager.deactivate(NOMS_COUCHES.searchOverlay);
}
function synchroniserRechercheDesktop() {
  const overlay = $("#rechercheOverlay");
  const header = $("#appHeader");
  if (!overlay || !header) return;
  const etaitDockee = overlay.classList.contains("recherche-dockee");
  const dockee = rechercheDockeeDesktopDemandee();
  overlay.classList.toggle("recherche-dockee", dockee);
  if (dockee) {
    overlay.hidden = false;
    header.hidden = true;
    majRaccourcis();
    return;
  }
  if (etaitDockee) {
    overlay.hidden = true;
    header.hidden = false;
    $("#suggestions").hidden = true;
    layerManager.deactivate(NOMS_COUCHES.searchOverlay);
  }
}
responsiveLayout.subscribe(() => synchroniserRechercheDesktop());
$("#btnLoupe").onclick = ouvrirRecherche;
if ($("#btnNotifs")) $("#btnNotifs").onclick = basculerPourToi;
if ($("#ptFermer")) $("#ptFermer").onclick = fermerPourToi;
document.addEventListener("pointerdown", (e) => {
  if (!pourToiOuvert()) return;
  const p = $("#pourToi");
  if (!p || p.contains(e.target)) return;
  const cloche = $("#btnNotifs");
  if (cloche && cloche.contains(e.target)) return;
  fermerPourToi();
});
function accorderPourToiALEcran() {
  poserBesoinsRapides();
  const p = $("#pourToi");
  if (!p) return;
  if (NAV_FLOTTANTE.matches) {
    p.hidden = false;
    document.body.classList.add("pourtoi-ouvert");
  } else {
    p.hidden = true;
    document.body.classList.remove("pourtoi-ouvert");
  }
  majPourToi();
}
if (NAV_FLOTTANTE.addEventListener) NAV_FLOTTANTE.addEventListener("change", accorderPourToiALEcran);
else if (NAV_FLOTTANTE.addListener) NAV_FLOTTANTE.addListener(accorderPourToiALEcran);
function amorcerPourToi() {
  const poser = () => accorderPourToiALEcran();
  if (ORDO) ORDO.differer(poser, { timeout: 1200 });
  else setTimeout(poser, 400);
}
$("#btnFermerRech").onclick = () => {
  $("#rech").value = "";
  recherche = "";
  $("#suggestions").hidden = true;
  fermerRecherche();
  rendre();
  majAccueil();
};
$("#btnFiltres").onclick = () => {
  const z = $("#filtresHumains");
  const ouvert = !z.hidden && z.dataset.force === "1";
  z.dataset.force = ouvert ? "" : "1";
  $("#btnFiltres").setAttribute("aria-expanded", ouvert ? "false" : "true");
  majFiltres();
};
$("#btnCredits").onclick = () => {
  const c = $("#credits");
  c.hidden = !c.hidden;
  $("#btnCredits").setAttribute("aria-expanded", String(!c.hidden));
};
function mesurerHeader() {
  const h = $("#appHeader");
  if (h && !h.hidden) {
    document.documentElement.style.setProperty("--header-height", h.offsetHeight + "px");
    document.documentElement.style.setProperty(
      "--header-bas",
      Math.round(h.getBoundingClientRect().bottom) + "px"
    );
  }
  const n = $("#navBas");
  if (n && !n.hidden) {
    const haut = n.offsetHeight;
    document.documentElement.style.setProperty("--nav-flottante", haut + "px");
    document.documentElement.style.setProperty(
      "--nav-height",
      NAV_FLOTTANTE.matches ? "0px" : haut + "px"
    );
  }
}
NAV_FLOTTANTE.addEventListener("change", mesurerHeader);
addEventListener("resize", mesurerHeader);
if (window.ResizeObserver) {
  const observateur = new ResizeObserver(mesurerHeader);
  if ($("#appHeader")) observateur.observe($("#appHeader"));
  if ($("#navBas")) observateur.observe($("#navBas"));
}
function suggerer(q) {
  const z = $("#suggestions");
  if (!z) return;
  const t = sansAccents(q).trim();
  if (!t) {
    z.innerHTML = rangeeSuggestions();
    brancherSuggestions(z);
    z.hidden = false;
    layerManager.activate(NOMS_COUCHES.searchOverlay);
    return;
  }
  const vus = /* @__PURE__ */ new Set(), sug = [];
  const decoupe = parseSearchQuery(q, DECOUPAGE);
  const dest = decoupe.destination;
  if (dest && ressembleAUneZone(dest)) {
    sug.push({ emo: "\u{1F4CD}", lab: dest, sous: "destination", texte: dest });
    vus.add(dest);
    if (decoupe.intention) {
      const compose = decoupe.intention + " \xE0 " + dest;
      sug.push({ emo: "\u{1F9ED}", lab: compose, sous: "intention \xB7 destination", texte: compose });
      vus.add(compose);
    } else {
      SUGGESTIONS_INTENTION.forEach((b) => {
        const compose = b.label + " \xE0 " + dest;
        sug.push({ emo: b.emoji, lab: compose, sous: "intention \xB7 destination", texte: compose });
        vus.add(compose);
      });
    }
  }
  for (const [mot, cible] of INDEX_MOTS) {
    if (sug.length >= 6) break;
    if (!mot.startsWith(t) && !mot.includes(t)) continue;
    const cat = cible.cat, emo = cat ? (CATS[cat] || {}).emoji : "\u{1F37D}\uFE0F";
    const lab = cat ? (CATS[cat] || {}).label : mot;
    if (vus.has(lab)) continue;
    vus.add(lab);
    sug.push({ emo, lab, sous: cat ? "cat\xE9gorie" : "cuisine", q: mot });
  }
  lieux.forEach((l) => {
    if (sug.length >= 10) return;
    if (!sansAccents(l.titre).includes(t) || vus.has(l.titre)) return;
    vus.add(l.titre);
    sug.push({ emo: categorieAffichee(l, {}).emoji || "\u{1F4CD}", lab: l.titre, sous: "lieu", id: l.id });
  });
  if (!sug.length) {
    z.hidden = true;
    layerManager.deactivate(NOMS_COUCHES.searchOverlay);
    return;
  }
  z.innerHTML = sug.map((x, i) => '<button class="sg" data-sg="' + i + '"><span class="sg-emo">' + x.emo + "</span><span>" + esc(x.lab) + '</span><span class="sg-sous">' + x.sous + "</span></button>").join("");
  z.querySelectorAll("[data-sg]").forEach((b) => b.onclick = () => {
    const x = sug[Number(b.dataset.sg)];
    z.hidden = true;
    layerManager.deactivate(NOMS_COUCHES.searchOverlay);
    $("#rech").blur();
    if (x.id) {
      pileEcrans = [];
      pousserEcran(() => ouvrirDetail(x.id));
      return;
    }
    if (x.texte) {
      $("#rech").value = x.texte;
      lancerRecherche();
      return;
    }
    appliquerPhrase(x.q);
  });
  z.hidden = false;
  layerManager.activate(NOMS_COUCHES.searchOverlay);
}
let minuteurSug;
$("#rech").onfocus = () => suggerer($("#rech").value);
let minuteurRenduRecherche;
$("#rech").oninput = (e) => {
  recherche = e.target.value;
  if (recherche) toutAfficher();
  clearTimeout(minuteurSug);
  minuteurSug = setTimeout(() => suggerer(recherche), 130);
  clearTimeout(minuteurRenduRecherche);
  minuteurRenduRecherche = setTimeout(() => rendre(), 260);
};
$("#formRech").addEventListener("submit", (e) => {
  e.preventDefault();
  lancerRecherche();
});
async function lancerRecherche() {
  const champ = $("#rech");
  const q = (champ.value || "").trim();
  if (!q) return;
  champ.blur();
  fermerRecherche({ force: true });
  zoneAffichee = null;
  intentionCourante = null;
  const { intention, destination } = parseSearchQuery(q, DECOUPAGE);
  if (destination && ressembleAUneZone(destination)) {
    const generation = nouvelleGeneration("recherche:zone", destination, true);
    charge("Recherche de " + destination + "\u2026");
    const trouvee = await rechercheGeographique(destination, generation);
    if (!generationCourante(generation)) return;
    charge(null);
    terminerGeneration(generation);
    if (trouvee) {
      if (intention) appliquerIntention(intention, destination);
      else intentionCourante = null;
      ouvrirResultatsZone(destination, intention);
      return;
    }
    if (!intention) {
      toast("Lieu introuvable : " + destination);
      return;
    }
  }
  appliquerPhrase(q);
}
const FILTRES_INTENTION = /* @__PURE__ */ new Set(["famille", "etudier", "monde", "libre"]);
const DECOUPAGE = {
  isIntent: (t) => intentionConnue(t),
  isWholeIntent: (t) => estTermeMetier(t),
  isDestination: (t) => ressembleAUneZone(t)
};
function intentionConnue(t) {
  const texte = String(t || "").trim();
  if (!texte) return false;
  if (estTermeMetier(texte)) return true;
  if (categorieRecherchee(texte) || cuisineRecherchee(texte)) return true;
  const a = interpreter(texte);
  if (a && a.cats && a.cats.size) return true;
  return !!(a && a.filtres && [...a.filtres].some((f) => FILTRES_INTENTION.has(f)));
}
function appliquerIntention(intention, zone) {
  const a = interpreter(intention);
  intentionCourante = a.structure;
  if (intentionCourante && zone) {
    intentionCourante.zone = zone;
    if (!intentionCourante.chips.some((c) => c.type === "zone"))
      intentionCourante.chips.unshift({ id: "zone", type: "zone", label: zone });
  }
  if (a && a.cats && a.cats.size) {
    catsActives = a.cats;
    filtreActif = "tout";
  } else {
    const bes = BESOINS.find((b) => sansAccents(b.id) === sansAccents(intention) || sansAccents(b.label) === sansAccents(intention));
    if (bes && bes.sous) {
      catsActives = new Set(bes.sous.flatMap((x) => x.cats));
      filtreActif = "tout";
    } else {
      const cat = categorieRecherchee(intention);
      if (cat) {
        catsActives = null;
        filtreActif = cat;
      }
    }
  }
  if (a && a.filtres && a.filtres.size) a.filtres.forEach((f) => filtresHumains.add(f));
  if (a && a.creneau) {
    creneau = a.creneau;
    filtreMaintenant = true;
  }
  selectionAccueil = false;
  dessinerFiltres();
  majFiltres();
  if (catsActives && catsActives.size) chargerPourCats([...catsActives]);
  else if (filtreActif !== "tout") chargerPourCats([filtreActif]);
}
function ouvrirResultatsZone(nom, intention) {
  zoneAffichee = { nom, intention: intention || "" };
  feuilleNiveau = "racine";
  $("#feuilleBesoins").hidden = false;
  if (!remplirResultatsZone(nom, intention)) return;
  brancherFeuille2();
  reglerEtatFeuille("moyenne");
}
function noteApercu(nom) {
  const r = regimeZone(rechercheGeo);
  if (r === "local") return "";
  const ou = r === "proche" ? "Tu n\u2019y es pas encore" : r === "voisine" ? "C\u2019est \xE0 quelques dizaines de kilom\xE8tres" : "C\u2019est loin d\u2019ici";
  return '<p class="rc-apercu">' + ou + " : voici un aper\xE7u de " + esc(nom) + ". Sur place, Autour montre tout ce qu\u2019il conna\xEEt du quartier.</p>";
}
function retourVersMoiHTML() {
  if (!rechercheGeo || !positionMoi || !positionConnue()) return "";
  const chezMoi = commune && commune !== "ton quartier" ? commune : "ma position";
  return '<button class="rc-retour" data-retour-moi="1"><span class="rc-retour-ic" aria-hidden="true">\u2316</span><span class="rc-retour-txt"><b>Revenir autour de moi</b><i>Retourner \xE0 ' + esc(chezMoi) + '</i></span><span class="rc-retour-fl" aria-hidden="true">\u203A</span></button>';
}
function remplirResultatsZone(nom, intention) {
  const centre = centreZoneActive();
  if (!centre) return false;
  const vivier = lieux.filter(dansZoneActive).filter(nomExploitable).filter((l) => !catsActives || correspondUneCategorie(l, catsActives));
  const forts = rankResults(groupLogicalPlaces(vivier, distanceM), {
    intent: "sortir",
    intention: intentionCourante,
    categories: [...new Set(BESOINS_PRINCIPAUX.flatMap((b) => b.sous ? b.sous.flatMap((x) => x.cats) : []))],
    position: centre,
    now: instantCreneau().getTime(),
    nowOnly: filtreMaintenant && !montrerFermes,
    radius: rayonDeLaZone(),
    distanceBetween: distanceM,
    /* Quand l'intention a déjà été traduite en catégories, c'est LE filtre :
       repasser son texte ici en ajoutait un second, qui écartait tout ce dont
       le nom ne contient pas les mots tapés. « restaurant indien » ne laissait
       ainsi que les fiches portant le tag cuisine — une minorité — au lieu de
       tous les restaurants de la zone. */
    requete: catsActives ? "" : intention || ""
  }).slice(0, plafondResultats());
  $("#fbTitre").textContent = nom;
  $("#fbRetour").hidden = true;
  $("#feuilleBesoins").classList.add("accueil");
  const corps = $("#fbCorps");
  const titre = intention ? intention + " \xB7 " + nom : nom;
  corps.innerHTML = chipsHTML() + besoinsRapidesHTML() + ongletsTemps() + /* DIRE QU'ON REGARDE AILLEURS, ET PAS SEULEMENT OÙ.
  
         Le titre affichait « Lille ». Mais « Lille » tout seul se lit aussi bien
         comme « tu es à Lille » que comme « tu regardes Lille » — et depuis
         Tourcoing c'est la seconde lecture qui est vraie. La référence pose une
         pastille « Recherche : Lille » à côté du titre : deux mots qui disent
         que ce panneau répond à une question posée, pas à une position. */
  '<div class="rc-tete"><strong>' + esc(titre) + "</strong>" + (rechercheGeo ? '<span class="rc-contexte">Recherche&nbsp;: ' + esc(nom) + "</span>" : "") + '<button class="rc-tout" data-rc-tout="1">Voir tout \u2192</button></div>' + (forts.length ? '<div class="rc-piste" data-testid="primary-results">' + forts.map(carteRecommandation).join("") + "</div>" + noteApercu(nom) : '<p class="liste-vide">Les lieux de cette zone arrivent\u2026</p>') + /* LA SORTIE EST AU BOUT DE LA LISTE, PAS SEULEMENT DANS UN COIN DE CARTE.
     Le bouton flottant existe en haut à droite, mais quelqu'un qui vient de
     parcourir cinq propositions lilloises a les yeux en bas du panneau, pas
     dans l'angle opposé de l'écran. La référence pose donc le retour là où
     finit la lecture, et il dit vers OÙ l'on revient : « Retourner à
     Tourcoing » se comprend sans avoir à s'en souvenir. */
  retourVersMoiHTML();
  brancherFeuille2();
  return true;
}
function ouvrirCreation() {
  const eph = Object.entries(CATS).filter(([, c]) => c.eph);
  ouvrirFeuille(
    '<div class="liste-tete"><h2>Que veux-tu ajouter&nbsp;?</h2></div><div class="creer-choix">' + eph.map(([id, c]) => '<button class="creer-type" data-type="' + id + '"><em>' + c.emoji + "</em><b>" + esc(c.label) + "</b></button>").join("") + "</div>"
  );
  $("#feuille").querySelectorAll("[data-type]").forEach((b) => b.onclick = () => {
    typeAvantPose = b.dataset.type;
    fermerFeuille();
    ouvrirModePose();
  });
}
let typeAvantPose = null;
$("#btnPoseOk").onclick = validerPose;
function revenirAutourDeMoi() {
  if (!positionMoi || !positionConnue()) {
    suivreMaPosition();
    return;
  }
  definirZoneActive(CTX ? CTX.zoneMoi(positionMoi, commune) : null);
  annulerChargementsZone();
  rechercheGeo = null;
  intentionCourante = null;
  zoneAffichee = null;
  recherche = "";
  if ($("#rech")) $("#rech").value = "";
  catsActives = null;
  filtreActif = "tout";
  allerVers(positionMoi, 16, { duration: 0.6 });
  chargerZone(positionMoi[0], positionMoi[1]);
  rendre();
  majAccueil();
  if (feuilleNiveau !== null) majFeuille2();
  else ouvrirAccueilFeuille();
  majBoutons();
}
$("#btnAutourDeMoi").onclick = revenirAutourDeMoi;
$("#btnPartager").onclick = partagerApp;
$("#navFermer").onclick = quitterNav;
$("#btnAide").onclick = () => {
  const b = $("#btnAide");
  if (modeAide) {
    basculerAide();
    fermerFeuille2();
  } else {
    basculerAide();
    ouvrirFeuille2("aide");
  }
  b.setAttribute("aria-pressed", modeAide ? "true" : "false");
  b.classList.toggle("actif", modeAide);
};
$("#btnTransports").onclick = () => {
  coucheTransport = !coucheTransport;
  $("#btnTransports").setAttribute("aria-pressed", coucheTransport ? "true" : "false");
  $("#btnTransports").classList.toggle("actif", coucheTransport);
  rendre();
  if (coucheTransport) {
    if (feuilleNiveau === null) ouvrirAccueilFeuille();
    reglerFeuilleDeplie(true);
  }
};
async function rafraichirCanaux() {
  canauxAMoi = await Store.mesCanaux();
  majNavBas();
}
function majNavBas() {
  const nav = $("#navBas");
  if (!nav) return;
  const E = window.AutourEvents;
  const onglet = nav.querySelector('[data-nb="profil"]');
  if (!onglet || !E) return;
  const attente = E.nonLus(canauxAMoi);
  onglet.classList.toggle("avec-pastille", attente > 0);
}
let contexteExplorer = null;
let ongletCourant = "explorer";
function capturerContexteExplorer() {
  const corps = $("#fbCorps");
  contexteExplorer = {
    creneau,
    filtreActif,
    recherche,
    montrerFermes,
    catsActives: catsActives ? new Set(catsActives) : null,
    filtresHumains: [...filtresHumains],
    selectionAccueil: Array.isArray(selectionAccueil) ? selectionAccueil.slice() : selectionAccueil,
    // « aide » n'est pas un état d'Explorer : on y revient par la racine
    niveau: feuilleNiveau === "aide" || feuilleNiveau == null ? "racine" : feuilleNiveau,
    scroll: corps ? corps.scrollTop : 0
  };
}
function restaurerContexteExplorer() {
  const c = contexteExplorer;
  contexteExplorer = null;
  if (!c) return false;
  creneau = c.creneau;
  filtreActif = c.filtreActif;
  recherche = c.recherche;
  montrerFermes = c.montrerFermes;
  catsActives = c.catsActives;
  filtresHumains.clear();
  c.filtresHumains.forEach((x) => filtresHumains.add(x));
  selectionAccueil = c.selectionAccueil;
  filtreMaintenant = creneau === "maintenant";
  const champ = $("#rech");
  if (champ) champ.value = recherche;
  majFiltres();
  rendre();
  majAccueil();
  ouvrirFeuille2(c.niveau);
  const corps = $("#fbCorps");
  if (corps && c.scroll > 0) requestAnimationFrame(() => requestAnimationFrame(() => {
    corps.scrollTop = c.scroll;
  }));
  return true;
}
function marquerNavigation(id) {
  const nav = $("#navBas");
  if (!nav) return;
  nav.querySelectorAll(".nb").forEach((x) => x.classList.toggle("actif", x.dataset.nb === id));
}
$("#badgeMaintenant").onclick = () => {
  if (modeAide) basculerAide();
  creneau = "maintenant";
  filtreMaintenant = true;
  ongletCourant = "explorer";
  marquerNavigation("explorer");
  contexteExplorer = null;
  ouvrirFeuille2("racine");
  reinitialiserScrollFeuille();
  rendre();
};
$("#navBas").querySelectorAll("[data-nb]").forEach((b) => b.onclick = () => {
  const id = b.dataset.nb;
  if (b.getAttribute("aria-disabled") === "true") {
    toast("Bient\xF4t disponible.");
    return;
  }
  if (ongletCourant === "explorer" && id !== "explorer") capturerContexteExplorer();
  ongletCourant = id;
  marquerNavigation(id);
  if (id === "explorer") {
    if (modeAide) basculerAide();
    const modal = $("#feuille");
    if (modal && !modal.hidden) demanderFermetureFeuille();
    if (!restaurerContexteExplorer()) ouvrirAccueilFeuille();
    return;
  }
  if (id === "aide") {
    if (!modeAide) basculerAide();
    else {
      sousAide = null;
      besoinsAide = [];
      intentionsSanteAide = [];
    }
    ouvrirFeuille2("aide");
    return;
  }
  if (id === "creer") {
    retourFormulaire = false;
    exigerCompte("publier").then((ok) => {
      if (ok) ouvrirCreation();
    });
    return;
  }
  if (id === "favoris") {
    exigerCompte("favori").then((ok) => {
      if (ok) ouvrirFavoris();
    });
    return;
  }
  if (id === "profil") {
    ouvrirProfil();
    return;
  }
});
enregistrerReprise("publier", () => {
  if (brouillon && brouillon.titre) return publier();
  ouvrirCreation();
});
enregistrerReprise("favori", async (charge2) => {
  const cle = charge2 && charge2.cle;
  if (!cle) return ouvrirFavoris();
  const lieu = lieux.find((x) => cleFavori(x) === cle) || favorisEnMemoire.get(cle);
  if (lieu) return basculerFavori(lieu);
  return ouvrirFavoris();
});
enregistrerReprise("mes-publications", () => ouvrirMesPublications());
enregistrerReprise("notifications", () => ouvrirProfil());
enregistrerReprise("compte", () => ouvrirProfil());
enregistrerReprise("modifier", (charge2) => {
  const l = charge2 && charge2.dbId && lieux.find((x) => x.dbId === charge2.dbId);
  if (l) {
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(l.id));
  }
});
enregistrerReprise("supprimer", (charge2) => {
  const l = charge2 && charge2.dbId && lieux.find((x) => x.dbId === charge2.dbId);
  if (l) {
    pileEcrans = [];
    pousserEcran(() => ouvrirDetail(l.id));
  }
});
let compteEnCours = { action: "compte", email: "", typeOtp: "email", envoye: false };
async function ouvrirFavoris() {
  await chargerFavoris();
  const lignes = await Store.favoris();
  lignes.forEach((f) => {
    const cle = f.publication_id ? "pub:" + f.publication_id : f.lieu_ref;
    favorisIds.add(cle);
    if (!favorisEnMemoire.has(cle)) favorisEnMemoire.set(cle, {
      id: cle,
      dbId: f.publication_id || null,
      source: (f.lieu_ref || "").split(":")[0],
      titre: f.titre,
      cat: f.cat,
      adresse: f.adresse,
      lat: f.lat,
      lng: f.lng
    });
  });
  const corps = lignes.length ? lignes.map((f) => {
    const cle = f.publication_id ? "pub:" + f.publication_id : f.lieu_ref;
    const c = CATS[f.cat] || { emoji: "\u{1F4CD}" };
    return '<div class="ac-item" role="button" tabindex="0" data-fav="' + esc(cle) + '"><span class="ac-emoji">' + c.emoji + '</span><span class="ac-txt"><span class="ac-nom">' + esc(f.titre) + '</span><span class="ac-sous">' + esc(f.adresse || (c.label || "")) + "</span></span>" + boutonCoeur({ dbId: f.publication_id, id: cle, source: (f.lieu_ref || "").split(":")[0] }) + "</div>";
  }).join("") : '<p class="liste-vide">Aucun favori pour l\u2019instant.<br>Touche le c\u0153ur sur un lieu ou un \xE9v\xE9nement pour l\u2019enregistrer.</p>';
  ouvrirFeuille(
    '<div class="liste-tete"><h2>\u2661 Favoris</h2><span class="liste-compte">' + lignes.length + "</span></div>" + corps
  );
  $("#feuille").querySelectorAll("[data-fav]").forEach((b) => b.onclick = (e) => {
    if (e.target.closest("[data-coeur]")) return;
    const l = lieux.find((x) => cleFavori(x) === b.dataset.fav);
    if (l) {
      fermerFeuille();
      ouvrirFicheCompacte(l);
    } else toast("Ce lieu n\u2019est pas charg\xE9 dans cette zone");
  });
  majCoeurs();
}
function majEnteteLieu() {
  const v = $("#hdVille");
  if (!v) return;
  if (!positionConnue()) {
    v.textContent = "Choisir un endroit";
    return;
  }
  if (positionApprochee()) {
    v.textContent = "Zone approximative";
    return;
  }
  if (ETIQUETTES_LIEU.includes(v.textContent)) v.textContent = "Autour de toi";
}
async function detecterVille(lat, lng) {
  const cle = lat.toFixed(2) + "," + lng.toFixed(2);
  if (villeDetectee === cle) return;
  const generation = nouvelleGeneration("contexte:ville", cle);
  const nommable = () => positionPrecise();
  const parRelais = await communeRelayee(lat, lng);
  if (!generationCourante(generation)) return;
  if (parRelais !== void 0) {
    if (parRelais) {
      villeDetectee = cle;
      if (nommable()) {
        $("#hdVille").textContent = parRelais;
        mesurerHeader();
      }
    }
    terminerGeneration(generation);
    return;
  }
  try {
    const stop = new AbortController();
    const t = setTimeout(() => stop.abort(), 6e3);
    const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=" + lat + "&lon=" + lng, { signal: stop.signal, headers: { "Accept-Language": "fr" } });
    clearTimeout(t);
    if (!r.ok || !generationCourante(generation)) return;
    const j = await r.json();
    if (!generationCourante(generation)) return;
    const a = j.address || {};
    const nom = a.city || a.town || a.village || a.municipality || a.county;
    villeDetectee = cle;
    if (nom && nommable()) {
      $("#hdVille").textContent = nom;
      mesurerHeader();
    }
  } catch (e) {
  } finally {
    terminerGeneration(generation);
  }
}
function ouvrirAccueilFeuille() {
  if (modeAide) basculerAide();
  catsActives = null;
  sousChoisi = null;
  filtreActif = "tout";
  rendre();
  majAccueil();
  ouvrirFeuille2("racine");
}
$("#fbFermer").onclick = fermerFeuille2;
$("#fbRetour").onclick = () => {
  if (modeAide) basculerAide();
  const venaitDePlus = (BESOIN_DE(feuilleNiveau) || {}).secondaire;
  catsActives = null;
  sousChoisi = null;
  rendre();
  majAccueil();
  ouvrirFeuille2(venaitDePlus ? "plus" : "racine");
  majRaccourcis();
};
const poigneeFeuille = $("#fbPoignee");
const CRAN_HAUT = -45, CRAN_BAS = 70;
let glissementFeuille = null;
let glissementAAgi = false;
function cyclerFeuille() {
  const suivant = { reduite: "moyenne", moyenne: "deplie", deplie: "reduite" };
  reglerEtatFeuille(suivant[etatFeuille()]);
}
function reduireDUnCran() {
  const etat2 = etatFeuille();
  if (etat2 === "deplie") reglerEtatFeuille("moyenne");
  else if (etat2 === "moyenne") reglerEtatFeuille("reduite");
  else fermerFeuille2();
}
function relacherPoignee(e) {
  if (!glissementFeuille) return;
  try {
    poigneeFeuille.releasePointerCapture(glissementFeuille.id);
  } catch (err) {
  }
  glissementFeuille = null;
}
poigneeFeuille.onclick = () => {
  if (glissementAAgi) {
    glissementAAgi = false;
    return;
  }
  cyclerFeuille();
};
poigneeFeuille.addEventListener("pointerdown", (e) => {
  glissementFeuille = { id: e.pointerId, y: e.clientY };
  glissementAAgi = false;
  try {
    poigneeFeuille.setPointerCapture(e.pointerId);
  } catch (err) {
  }
});
poigneeFeuille.addEventListener("pointerup", (e) => {
  if (!glissementFeuille || glissementFeuille.id !== e.pointerId) return;
  const dy = e.clientY - glissementFeuille.y;
  relacherPoignee(e);
  if (dy < CRAN_HAUT) {
    glissementAAgi = true;
    reglerEtatFeuille(etatFeuille() === "reduite" ? "moyenne" : "deplie");
    return;
  }
  if (dy > CRAN_BAS) {
    glissementAAgi = true;
    reduireDUnCran();
  }
});
poigneeFeuille.addEventListener("pointercancel", relacherPoignee);
$("#btnLieu").onclick = () => {
  if (!positionPrecise()) {
    suivreMaPosition();
    return;
  }
  if (zoneAffichee || rechercheGeo) {
    revenirAutourDeMoi();
    return;
  }
  allerVers(positionMoi, 16, { duration: 0.6 });
};
