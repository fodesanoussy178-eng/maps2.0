(function() {
  "use strict";
  const CLE = "autour:envies:v1";
  const CATALOGUE = Object.freeze([
    /* Un GENRE ne s'attribue pas une catégorie entière : tous les concerts
       ne sont pas du rap, et écrire « Rap · correspond à ce que tu suis »
       sous un concert de jazz est un mensonge que l'écran affiche. Les envies
       de genre se reconnaissent donc aux mots, jamais à la catégorie. */
    {
      id: "rap",
      label: "Rap",
      emoji: "\u{1F3A4}",
      cats: [],
      mots: ["rap", "hip-hop", "hip hop", "trap", "rappeur", "punchline"]
    },
    {
      id: "concerts",
      label: "Concerts",
      emoji: "\u{1F3B5}",
      cats: ["concert"],
      mots: ["concert", "live", "showcase", "set", "dj"]
    },
    {
      id: "cinema",
      label: "Cin\xE9ma",
      emoji: "\u{1F3AC}",
      cats: ["cinema"],
      mots: ["cinema", "film", "projection", "seance", "avant-premiere"]
    },
    {
      id: "manga",
      label: "Manga / Anime",
      emoji: "\u{1F3AF}",
      cats: [],
      mots: ["manga", "anime", "japan", "cosplay", "convention", "comics"]
    },
    {
      id: "expos",
      label: "Expositions",
      emoji: "\u{1F5BC}\uFE0F",
      cats: ["musee"],
      mots: ["exposition", "expo", "vernissage", "galerie", "musee"]
    },
    {
      id: "sport",
      label: "Sport",
      emoji: "\u{1F3C5}",
      cats: ["sport", "terrain"],
      mots: ["sport", "match", "tournoi", "course", "marathon"]
    },
    {
      id: "football",
      label: "Football",
      emoji: "\u26BD",
      cats: [],
      mots: ["football", "foot", "losc", "stade", "ligue 1"]
    },
    {
      id: "mode",
      label: "Mode",
      emoji: "\u{1F457}",
      cats: [],
      mots: ["mode", "defile", "fashion", "createur", "friperie"]
    },
    {
      id: "food",
      label: "Food",
      emoji: "\u{1F37D}\uFE0F",
      cats: ["marche"],
      mots: ["food", "street food", "degustation", "brunch", "marche gourmand"]
    },
    {
      id: "nuit",
      label: "Vie nocturne",
      emoji: "\u{1F319}",
      cats: [],
      mots: ["soiree", "club", "nuit", "after", "bal"]
    },
    {
      id: "famille",
      label: "Famille",
      emoji: "\u{1F9F8}",
      cats: ["parc"],
      mots: ["famille", "enfants", "jeune public", "atelier enfant"]
    },
    {
      id: "theatre",
      label: "Th\xE9\xE2tre",
      emoji: "\u{1F3AD}",
      cats: ["spectacle"],
      mots: ["theatre", "piece", "scene", "comedie", "impro"]
    },
    {
      id: "festivals",
      label: "Festivals",
      emoji: "\u{1F3AA}",
      cats: [],
      mots: ["festival", "fete", "carnaval", "braderie"]
    }
  ]);
  const PAR_ID = new Map(CATALOGUE.map((e) => [e.id, e]));
  let enMemoire = null;
  let stockageMuet = false;
  function lire() {
    if (enMemoire) return enMemoire;
    let brut = null;
    try {
      brut = localStorage.getItem(CLE);
    } catch (e) {
      stockageMuet = true;
    }
    let ids = [];
    try {
      const lu = JSON.parse(brut || "[]");
      if (Array.isArray(lu)) ids = lu.filter((id) => PAR_ID.has(id));
    } catch (e) {
      ids = [];
    }
    enMemoire = ids;
    return enMemoire;
  }
  function ecrire(ids) {
    enMemoire = ids.filter((id) => PAR_ID.has(id));
    if (stockageMuet) return false;
    try {
      localStorage.setItem(CLE, JSON.stringify(enMemoire));
      return true;
    } catch (e) {
      stockageMuet = true;
      return false;
    }
  }
  function choisies() {
    const prises = new Set(lire());
    return CATALOGUE.filter((e) => prises.has(e.id)).map((e) => e.id);
  }
  const suivie = (id) => lire().indexOf(id) >= 0;
  function definir(id, actif) {
    if (!PAR_ID.has(id)) return choisies();
    const prises = new Set(lire());
    if (actif) prises.add(id);
    else prises.delete(id);
    ecrire([...prises]);
    return choisies();
  }
  const basculer = (id) => definir(id, !suivie(id));
  const detail = (id) => PAR_ID.get(id) || null;
  const details = () => choisies().map((id) => PAR_ID.get(id));
  function sansAccents(v) {
    return String(v || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  }
  function correspondances(objet, seulementSuivies) {
    if (!objet) return [];
    const cat = objet.cat || objet.categorie || "";
    const texte = sansAccents([
      objet.titre,
      objet.title,
      objet.description,
      objet.categorieLabel,
      objet.tags && objet.tags.name
    ].filter(Boolean).join(" "));
    const candidates = seulementSuivies === false ? CATALOGUE : details();
    const trouvees = [];
    candidates.forEach((e) => {
      if (!e) return;
      if (cat && e.cats.indexOf(cat) >= 0) {
        trouvees.push({ id: e.id, sur: "categorie" });
        return;
      }
      const mot = e.mots.find((m) => texte.indexOf(sansAccents(m)) >= 0);
      if (mot) trouvees.push({ id: e.id, sur: "mot", mot });
    });
    return trouvees.sort((a, b) => (a.sur === "categorie" ? 0 : 1) - (b.sur === "categorie" ? 0 : 1));
  }
  function pourquoi(objet) {
    const trouvees = correspondances(objet);
    if (!trouvees.length) return null;
    const e = PAR_ID.get(trouvees[0].id);
    if (!e) return null;
    return {
      envie: e.id,
      label: e.label,
      emoji: e.emoji,
      /* « correspond fortement » n'est pas un score inventé : c'est la
         différence entre une catégorie reconnue et un simple mot du titre. */
      texte: trouvees[0].sur === "categorie" ? e.label + " \xB7 correspond \xE0 ce que tu suis" : e.label + " \xB7 rep\xE9r\xE9 dans l\u2019annonce",
      solide: trouvees[0].sur === "categorie"
    };
  }
  const persistant = () => {
    lire();
    return !stockageMuet;
  };
  function _reinitialiser() {
    enMemoire = null;
    stockageMuet = false;
    try {
      localStorage.removeItem(CLE);
    } catch (e) {
    }
  }
  window.AutourEnvies = {
    CATALOGUE,
    CLE,
    choisies,
    suivie,
    definir,
    basculer,
    detail,
    details,
    correspondances,
    pourquoi,
    persistant,
    _reinitialiser
  };
})();
