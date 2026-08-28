(function() {
  "use strict";
  const MAX_CANDIDATS = 5;
  const MAX_SIMULTANEES = 3;
  const demandees = /* @__PURE__ */ new Set();
  const enVol = /* @__PURE__ */ new Map();
  let sortiesSimultanees = 0;
  const ARTICLES = /\b(le|la|les|l|un|une|des|du|de|d|au|aux|the|a)\b/g;
  const DIACRITIQUES = new RegExp("[\\u0300-\\u036f]", "g");
  function normaliserNom(valeur) {
    return String(valeur == null ? "" : valeur).normalize("NFD").replace(DIACRITIQUES, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(ARTICLES, " ").replace(/\s+/g, " ").trim();
  }
  function coordonnee(valeur) {
    if (valeur == null || String(valeur).trim() === "") return null;
    const n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  }
  function valeurStable(value) {
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return "[" + value.map(valeurStable).join(",") + "]";
    if (typeof value === "object") {
      return "{" + Object.keys(value).filter((k) => value[k] !== void 0).sort().map((k) => JSON.stringify(k) + ":" + valeurStable(value[k])).join(",") + "}";
    }
    return JSON.stringify(String(value));
  }
  function hash32(value, seed) {
    let hash = seed >>> 0;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  function empreinteEntree(input) {
    const image = input && input.image && typeof input.image === "object" ? input.image : input && input.poster && typeof input.poster === "object" ? input.poster : {};
    const structured = input && input.structured && typeof input.structured === "object" ? Object.fromEntries(Object.entries(input.structured).filter(([key]) => key !== "temporal_data" && key !== "temporalData")) : {};
    const payload = {
      nom: input.nom ?? "",
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      commune: input.commune ?? "",
      adresse: input.adresse ?? "",
      categorie: input.categorie ?? "",
      horaires: input.horaires ?? "",
      is_event: input.is_event ?? input.isEvent ?? false,
      start_at: input.start_at ?? input.startAt ?? null,
      end_at: input.end_at ?? input.endAt ?? null,
      titre: input.titre ?? input.title ?? "",
      description: input.description ?? "",
      summary: input.summary ?? input.resume ?? "",
      notes: input.notes ?? "",
      source_text: input.source_text ?? "",
      source_url: input.source_url ?? "",
      dates: input.dates ?? null,
      programme: input.programme ?? null,
      structured,
      image: {
        url: image.url ?? image.image_url ?? image.uri ?? "",
        image_id: image.image_id ?? image.imageId ?? "",
        source_url: image.source_url ?? image.sourceUrl ?? "",
        source_type: image.source_type ?? image.sourceType ?? "",
        image_scope: image.image_scope ?? image.imageScope ?? "",
        version: image.version ?? image.image_version ?? image.imageVersion ?? "",
        updated_at: image.updated_at ?? image.image_updated_at ?? image.imageUpdatedAt ?? "",
        etag: image.etag ?? ""
      }
    };
    const serialise = valeurStable(payload);
    return "v1-" + hash32(serialise, 2166136261) + "-" + hash32(serialise, 2654435761);
  }
  function empreinteSource(lieu) {
    const debut = lieu && lieu.debutLe ? new Date(lieu.debutLe).toISOString() : null;
    const fin = lieu && lieu.finLe ? new Date(lieu.finLe).toISOString() : null;
    const temporal = lieu && (lieu.temporal_data || lieu.temporalData) || null;
    let brut = lieu && lieu._empreinteSourceBrute;
    if (lieu && !brut) {
      brut = {
        horaires: lieu.quand || "",
        source_url: lieu.image_source_url || lieu.url || "",
        structured_source_url: lieu.url || lieu.image_source_url || ""
      };
      try {
        Object.defineProperty(
          lieu,
          "_empreinteSourceBrute",
          { value: brut, writable: true, configurable: true }
        );
      } catch (e) {
      }
    }
    brut = brut || {
      horaires: lieu && lieu.quand || "",
      source_url: lieu && (lieu.image_source_url || lieu.url) || "",
      structured_source_url: lieu && (lieu.url || lieu.image_source_url) || ""
    };
    return empreinteEntree({
      nom: lieu && lieu.titre,
      lat: lieu && lieu.lat,
      lng: lieu && lieu.lng,
      commune: lieu && lieu.cp || "",
      adresse: lieu && lieu.adresse || "",
      categorie: lieu && lieu.cat || "",
      horaires: brut.horaires,
      is_event: !!(lieu && (lieu.isTemporary || lieu.debutLe || lieu.finLe)),
      start_at: debut,
      end_at: fin,
      titre: lieu && lieu.titre || "",
      description: lieu && lieu.description || "",
      summary: lieu && (lieu.resume || lieu.summary) || "",
      notes: lieu && lieu.notes || "",
      source_text: lieu && lieu.note || "",
      source_url: brut.source_url,
      dates: lieu && lieu.dates || null,
      programme: lieu && lieu.programme || null,
      structured: {
        start_at: debut,
        end_at: fin,
        horaires: brut.horaires || null,
        programme: lieu && lieu.programme || null,
        source_url: brut.structured_source_url || null,
        temporal_data: temporal,
        time_windows: lieu && lieu.time_windows || null,
        monthly_rules: lieu && lieu.monthly_rules || null,
        excluded_weekdays: lieu && lieu.excluded_weekdays || null,
        exceptions: lieu && lieu.exceptions || null
      },
      image: lieu && lieu.image_url ? {
        url: lieu.image_url,
        image_id: lieu.image_source_url || lieu.image_url,
        source_url: lieu.image_source_url || lieu.image_url,
        source_type: lieu.image_source || "",
        image_scope: lieu.image_scope || "",
        version: lieu.image_version || "",
        updated_at: lieu.image_updated_at || "",
        etag: lieu.image_etag || ""
      } : null
    });
  }
  function cleLieu(nom, lat, lng) {
    const n = normaliserNom(nom);
    if (n.length < 2) return null;
    const y = coordonnee(lat), x = coordonnee(lng);
    if (y == null || x == null) return null;
    return n.replace(/ /g, "-") + "@" + y.toFixed(4) + "," + x.toFixed(4);
  }
  const AVEC_PROGRAMME = ["cinema", "musee", "spectacle", "concert", "biblio"];
  const COMMODITES = [
    "commerce",
    "friperie",
    "sante",
    "metro",
    "bus",
    "tram",
    "train",
    "velo",
    "recharge",
    "toilettes",
    "mairie",
    "ecole",
    "emploi"
  ];
  const MOTS_FERMETURE = /\b(fermeture|travaux|renovation|provisoire|reouverture|momentanement)\b/i;
  const HORAIRES_PERIMES_MS = 180 * 24 * 3600 * 1e3;
  function sansAccents(v) {
    return String(v == null ? "" : v).normalize("NFD").replace(DIACRITIQUES, "").toLowerCase();
  }
  function manques(lieu, options) {
    const o = options || {};
    const maintenant = Number.isFinite(o.maintenant) ? o.maintenant : Date.now();
    const raisons = [];
    if (!lieu) return raisons;
    if (COMMODITES.indexOf(lieu.cat) >= 0) return raisons;
    const temporal = lieu.temporal_data || lieu.temporalData || null;
    const estEvenement = !!(lieu.debutLe || lieu.finLe || lieu.isTemporary || temporal && (temporal.period_start || temporal.date_unique));
    const valeurs = temporal && Array.isArray(temporal.events) && temporal.events.length ? temporal.events : [temporal];
    const fenetresCompletes = (valeur) => {
      if (Array.isArray(valeur && valeur.time_windows))
        return valeur.time_windows.length > 0 && valeur.time_windows.every((x) => x && /^\d{2}:\d{2}$/.test(String(x.start_time || "")) && /^\d{2}:\d{2}$/.test(String(x.end_time || "")));
      return !!(valeur && valeur.start_time && valeur.end_time);
    };
    const periodeComplete = !!(temporal && valeurs.every((valeur) => {
      const dateConnue = valeur && (valeur.period_start || valeur.date_unique || Array.isArray(valeur.weekdays) && valeur.weekdays.length || Array.isArray(valeur.monthly_rules) && valeur.monthly_rules.length);
      return dateConnue && fenetresCompletes(valeur);
    }));
    const epochStructure = (value) => {
      const date = value == null ? null : new Date(value);
      const epoch = date ? date.getTime() : NaN;
      return Number.isFinite(epoch) ? epoch : NaN;
    };
    const debutStructure = epochStructure(lieu.debutLe);
    const finStructure = epochStructure(lieu.finLe);
    const intervalleStructure = Number.isFinite(debutStructure) && Number.isFinite(finStructure) && finStructure > debutStructure;
    const horaireComplet = periodeComplete || intervalleStructure;
    const horaires = lieu.quand || lieu.opening_hours;
    if (!horaireComplet && (!horaires || String(horaires).trim() === "" || horaires === "Voir sur place"))
      raisons.push("missingOpeningHours");
    else if (!horaireComplet) {
      const vus = Date.parse(lieu.majLe || lieu.updated_at || "");
      if (Number.isFinite(vus) && maintenant - vus > HORAIRES_PERIMES_MS)
        raisons.push("staleOpeningHours");
    }
    if (!horaireComplet && lieu.ouvert == null && !raisons.length) raisons.push("unknownCurrentStatus");
    if (!horaireComplet && AVEC_PROGRAMME.indexOf(lieu.cat) >= 0 && !(Array.isArray(lieu.programme_now) && lieu.programme_now.length))
      raisons.push("missingProgramme");
    if (MOTS_FERMETURE.test(sansAccents(lieu.description) + " " + sansAccents(lieu.titre)))
      raisons.push("suspectedTemporaryClosure");
    if (estEvenement && !lieu.url && !lieu.ticket_url)
      raisons.push("missingTicketUrl");
    return raisons;
  }
  function appliquer(lieu, e) {
    if (!lieu || !e) return false;
    let change = false;
    const frais = e.expires_at ? Date.parse(e.expires_at) > Date.now() : false;
    const compatible = !!e.source_fingerprint && e.source_fingerprint === empreinteSource(lieu);
    if (!compatible) return false;
    if (frais) {
      if (e.current_status && e.current_status !== "unknown") {
        lieu.current_status = e.current_status;
        change = true;
      }
      if (e.temporary_closed != null) {
        lieu.temporary_closed = e.temporary_closed;
        change = true;
      }
      if (e.opening_hours) {
        lieu.quand = e.opening_hours;
        change = true;
      }
      if (e.today_hours) {
        lieu.horairesDuJour = e.today_hours;
        change = true;
      }
      if (e.next_open_at) {
        lieu.next_open_at = e.next_open_at;
        change = true;
      }
      if (Array.isArray(e.programme_now) && e.programme_now.length) {
        lieu.programme_now = e.programme_now;
        change = true;
      }
      if (Array.isArray(e.programme_soon) && e.programme_soon.length) {
        lieu.programme_soon = e.programme_soon;
        change = true;
      }
      if (e.temporal_data && typeof e.temporal_data === "object") {
        lieu.temporal_data = e.temporal_data;
        lieu.temporalData = e.temporal_data;
        lieu.temporal_observations = Array.isArray(e.temporal_observations) ? e.temporal_observations : [];
        lieu.temporal_conflicts = Array.isArray(e.temporal_conflicts) ? e.temporal_conflicts : [];
        change = true;
      }
    }
    if (e.ticket_url && !lieu.ticket_url) {
      lieu.ticket_url = e.ticket_url;
      change = true;
    }
    if (e.official_url && !lieu.url) {
      lieu.url = e.official_url;
      change = true;
    }
    if (change || e.sources) {
      lieu.verifie = {
        frais,
        le: e.last_verified_at || e.checked_at || null,
        confiance: Number(e.confidence) || 0,
        priorite: e.source_priority || null,
        sources: Array.isArray(e.sources) ? e.sources : [],
        temporal_observations: Array.isArray(e.temporal_observations) ? e.temporal_observations : [],
        temporal_conflicts: Array.isArray(e.temporal_conflicts) ? e.temporal_conflicts : []
      };
    }
    return change;
  }
  window.AutourEnrichissements = {
    MAX_CANDIDATS,
    MAX_SIMULTANEES,
    cleLieu,
    normaliserNom,
    manques,
    appliquer,
    empreinteSource,
    compatible: (lieu, e) => !!(e && e.source_fingerprint && e.source_fingerprint === empreinteSource(lieu)),
    /* Exposés pour que l'appelant puisse mesurer et pour les tests : la file
       ne se pilote pas depuis l'extérieur. */
    _etat: () => ({ demandees: demandees.size, enVol: enVol.size, sorties: sortiesSimultanees }),
    _reserver(cle) {
      if (demandees.has(cle) || sortiesSimultanees >= MAX_SIMULTANEES) return false;
      demandees.add(cle);
      sortiesSimultanees += 1;
      return true;
    },
    _liberer() {
      sortiesSimultanees = Math.max(0, sortiesSimultanees - 1);
    },
    _oublier() {
      demandees.clear();
      enVol.clear();
      sortiesSimultanees = 0;
    }
  };
})();
