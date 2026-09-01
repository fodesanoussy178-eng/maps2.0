(function (root) {
  "use strict";

  /*
     AideStructure est le contrat commun aux cinq inventaires utilisés par
     Aide. Les adapters ne décident pas qu'un lieu « aide » parce qu'un mot
     apparaît dans son nom : ils transmettent uniquement les types, services,
     catégories et identifiants explicitement publiés par la source. Le verdict
     reste celui d'AutourAideClassement, donc celui de la taxonomie existante.
  */

  const SOURCES = Object.freeze({
    autour: 0.82,
    dora: 0.90,
    data_inclusion: 0.88,
    finess: 0.96,
    service_public: 0.96,
    openstreetmap: 0.68,
  });
  const NIVEAUX = Object.freeze([
    [90, "tres_forte"], [75, "forte"], [50, "moyenne"], [1, "faible"], [0, "inconnue"],
  ]);
  const CONFIANCE_AIDE = Object.freeze({
    VERIFIED: "verified_help",
    PROBABLE: "probable_help",
    UNKNOWN: "unknown",
  });
  const FRAICHEUR_AIDE = Object.freeze({
    FRAIS_MS: 180 * 24 * 3600 * 1000,
    OBSOLETE_MS: 365 * 24 * 3600 * 1000,
  });

  const array = (value) => Array.isArray(value) ? value :
    (value == null || value === "" ? [] : [value]);
  const unique = (values) => [...new Set(array(values).filter((v) => v != null && v !== "")
    .map((v) => typeof v === "string" ? v.trim() : v).filter(Boolean))];
  const texte = (value) => String(value == null ? "" : value).trim();
  const sansAccents = (value) => texte(value).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const coordonneesValides = (lat, lng) => lat != null && lng != null &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const normaliserIdentifiant = (value) => texte(value).replace(/\s+/g, "").toUpperCase();
  const sourcePhoto = (value) => {
    const source = texte(value);
    return ["data_inclusion", "dora", "finess", "service_public", "data_gouv"].includes(source)
      ? "institutional" : source;
  };

  function mediasDe(raw) {
    const p = raw || {};
    const photos = Array.isArray(p.photos) ? p.photos.slice() : [];
    const image = p.image || p.image_url || p.photo_url || p.photo;
    if (!photos.length && image) photos.push({
      url: image,
      attribution: p.imageAttribution || p.image_attribution || p.image_author || "",
      source: sourcePhoto(p.imageSource || p.image_source),
      sourceUrl: p.imageSourceUrl || p.image_source_url || "",
      author: p.imageAuthor || p.image_author || "",
      license: p.imageLicense || p.image_license || "",
      updatedAt: p.imageUpdatedAt || p.image_updated_at || null,
    });
    return photos.filter((photo) => photo && (photo.url || photo.image_url)).map((photo) => ({
      url: texte(photo.url || photo.image_url),
      attribution: photo.attribution || "",
      source: sourcePhoto(photo.source || photo.image_source),
      sourceUrl: photo.sourceUrl || photo.source_url || photo.image_source_url || "",
      author: photo.author || photo.image_author || "",
      license: photo.license || photo.image_license || "",
      updatedAt: photo.updatedAt || photo.image_updated_at || null,
    })).filter((photo) => photo.url);
  }

  function empreinte(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function sourceDe(raw) {
    return texte(raw && (raw.source || raw.primary_source || raw.par || raw.provider)) || "autour";
  }

  function confianceSource(source, raw) {
    const explicite = number(raw && (raw.sourceConfidence ?? raw.confianceSource));
    if (explicite != null) return Math.max(0, Math.min(1, explicite > 1 ? explicite / 100 : explicite));
    return SOURCES[source] == null ? 0.55 : SOURCES[source];
  }

  function identifiantsDe(raw, source) {
    const p = raw || {};
    const refs = p.sourceRefs || p.identifiers || p.identifiants || {};
    const identifiers = {
      autourId: p.autourId || refs.autourId,
      siret: p.siret || refs.siret,
      siren: p.siren || refs.siren,
      finess: p.finess || refs.finess || refs.finessEge || refs.finessPm,
      finessPm: p.finessPm || refs.finessPm,
      finessEge: p.finessEge || refs.finessEge,
      doraId: p.doraId || refs.doraId || (source === "dora" ? p.id : null),
      dataInclusionId: p.dataInclusionId || refs.dataInclusionId ||
        (source === "data_inclusion" ? p.id : null),
      servicePublicId: p.servicePublicId || refs.servicePublicId ||
        (source === "service_public" ? p.id : null),
      osmId: p.osmId || refs.osmId || (source === "openstreetmap" ? p.idOsm || p.id : null),
    };
    Object.keys(identifiers).forEach((key) => {
      if (identifiers[key] != null && identifiers[key] !== "")
        identifiers[key] = normaliserIdentifiant(identifiers[key]);
      else delete identifiers[key];
    });
    return identifiers;
  }

  function cleOfficielle(ids) {
    for (const [champ, prefixe] of [
      /* FINESS EGE/PM identifie le site ; le SIRET peut être partagé par
         plusieurs établissements d'une même personne morale. */
      ["finessEge", "finess-ege"], ["finessPm", "finess-pm"], ["siret", "siret"],
      ["finess", "finess"], ["doraId", "dora"], ["dataInclusionId", "data-inclusion"],
      ["servicePublicId", "service-public"],
      ["osmId", "osm"], ["autourId", "autour"],
    ]) {
      if (ids && ids[champ]) return prefixe + ":" + ids[champ];
    }
    return null;
  }

  function adresseDe(raw) {
    const p = raw || {};
    if (p.address && typeof p.address === "string") return p.address.trim();
    if (p.adresse && typeof p.adresse === "string") return p.adresse.trim();
    const a = array(p.adresse || p.addresses)[0] || {};
    return [a.numero_voie, a.numeroVoie, a.type_voie, a.typeVoie, a.nom_voie,
      a.libelleVoie, a.ligneUne, a.ligneQuatre, a.complement1,
      a.code_postal, a.codePostal, a.postalCode, a.nom_commune, a.ligneAcheminement,
      a.city, a.commune].filter(Boolean).map(texte).join(", ");
  }

  function statutDe(raw) {
    const p = raw || {};
    const brut = p.status && typeof p.status === "object" ? p.status.value : p.status;
    const terme = sansAccents(brut || p.statut || p.etatObjet || "");
    const fermeture = p.dateFermeture || p.date_fermeture || p.closedAt || p.fermeture;
    let value = "unknown";
    if (p.isObsolete === true || p.obsolete === true || ["i", "inactif", "inactive", "ferme", "fermee", "closed", "obsolete", "permanently closed"].includes(terme))
      value = fermeture || p.isObsolete === true || p.obsolete === true ? "permanently_closed" : "closed";
    else if (p.isObsolete === false || p.obsolete === false || ["a", "actif", "active", "ouvert", "ouverte", "open"].includes(terme))
      value = "open";
    else if (p.ouvert === true || p.openNow === true) value = "open";
    else if (p.ouvert === false || p.openNow === false) value = "closed";
    const sourceConfidence = confianceSource(sourceDe(p), p);
    const confidence = p.status && typeof p.status === "object" && number(p.status.confidence) != null
      ? number(p.status.confidence) : (value === "unknown" ? 0 : sourceConfidence);
    return {
      value,
      ouvert: value === "open" ? true : value === "unknown" ? null : false,
      label: value === "open" ? "Ouvert" : value === "closed" ? "Fermé" :
        value === "permanently_closed" ? "Fermé définitivement" : "Statut inconnu",
      confidence,
      updatedAt: p.status && typeof p.status === "object" ? (p.status.updatedAt || null) :
        (p.updatedAt || p.dateDerniereMaj || p.date_modification_datetime || null),
    };
  }

  function niveau(score) {
    const n = Math.max(0, Math.min(100, Number(score) || 0));
    return NIVEAUX.find(([minimum]) => n >= minimum)[1];
  }

  function provenancesDe(raw, source, ids, confidence) {
    const p = raw || {};
    const existantes = array(p.provenance || p.provenances).filter((x) => x && typeof x === "object");
    if (existantes.length) return existantes.map((x) => Object.assign({}, x, {
      source: texte(x.source) || source,
      confidence: number(x.confidence) == null ? confidence : x.confidence,
    }));
    const id = ids.doraId || ids.servicePublicId || ids.finessEge || ids.finessPm ||
      ids.finess || ids.siret || ids.osmId || ids.autourId || texte(p.id);
    return [{
      source,
      id: id || null,
      url: p.url || p.website || p.url_service_public || p.lien_source || null,
      updatedAt: p.updatedAt || p.date_modification_datetime || p.dateDerniereMaj || null,
      confidence,
    }];
  }

  function aBesoinAide(raw) {
    const p = raw || {};
    return p.aideStructure === true || p.kind === "AideStructure" ||
      ["alimentaire", "hebergement", "emploi", "sante", "securite", "mairie", "asso",
        "toilettes", "collecte", "friperie"].includes(p.category) ||
      array(p.categories).some((x) => ["alimentaire", "hebergement", "emploi", "sante", "securite", "mairie", "asso",
        "toilettes", "collecte", "friperie"].includes(x));
  }

  function dateMs(value) {
    if (value == null || value === "") return null;
    const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fraicheurDe(structure, now) {
    const date = dateMs(structure && (structure.lastSourceUpdate || structure.updatedAt));
    if (date == null) return { state: "unknown", ageMs: null, factor: .78 };
    const ageMs = Math.max(0, (now || Date.now()) - date);
    if (ageMs <= FRAICHEUR_AIDE.FRAIS_MS) return { state: "fresh", ageMs, factor: 1 };
    if (ageMs <= FRAICHEUR_AIDE.OBSOLETE_MS) return { state: "aging", ageMs, factor: .82 };
    return { state: "stale", ageMs, factor: .55 };
  }

  /* Le niveau ne remplace pas le classement métier : il dit simplement si la
     fiche peut entrer dans la réponse par défaut. Une donnée ancienne reste
     connue, mais ne se présente plus comme une certitude. */
  function appliquerConfianceAide(structure) {
    const p = structure || {};
    const capacites = Object.values(p.capacities || {});
    const meilleurePreuve = capacites.reduce((score, value) =>
      Math.max(score, Number(value && value.confidence) || 0), 0);
    const source = Math.round(Math.max(0, Math.min(1, Number(p.sourceConfidence) || 0)) * 100);
    const fraicheur = fraicheurDe(p);
    const fermeture = p.status && p.status.value === "permanently_closed";
    const confiance = Math.round(Math.min(100,
      (meilleurePreuve * .7 + source * .3) * fraicheur.factor));
    let trustLevel = CONFIANCE_AIDE.UNKNOWN;
    if (!fermeture && meilleurePreuve >= 50 && source >= 80 && fraicheur.state !== "stale")
      trustLevel = CONFIANCE_AIDE.VERIFIED;
    else if (!fermeture && (meilleurePreuve >= 50 || (meilleurePreuve >= 35 && source >= 68)))
      trustLevel = CONFIANCE_AIDE.PROBABLE;
    return Object.assign(p, {
      confidenceAide: confiance,
      confianceAide: confiance,
      trustLevel,
      niveauConfianceAide: trustLevel,
      freshness: fraicheur.state,
      freshnessAgeMs: fraicheur.ageMs,
      lastSourceUpdate: p.lastSourceUpdate || p.updatedAt || null,
      lastSyncedAt: p.lastSyncedAt || p.syncedAt || null,
      confidenceReason: fermeture ? "structure_fermee" :
        trustLevel === CONFIANCE_AIDE.VERIFIED ? "preuve_structurelle_et_source_fiable" :
        trustLevel === CONFIANCE_AIDE.PROBABLE ? "preuve_partielle_ou_donnee_a_verifier" :
        "mission_d_aide_non_etablie",
    });
  }

  function normaliser(raw) {
    const p = raw || {};
    const source = sourceDe(p);
    const lat = number(p.lat ?? p.latitude ?? (p.coordinates && p.coordinates.lat));
    const lng = number(p.lng ?? p.longitude ?? (p.coordinates && (p.coordinates.lng ?? p.coordinates.lon)));
    const name = texte(p.name || p.nom || p.title || p.titre || p.officialName);
    if (!name || !coordonneesValides(lat, lng)) return null;
    const ids = identifiantsDe(p, source);
    const sourceConfidence = confianceSource(source, p);
    const types = unique([
      ...(array(p.types)), p.primaryType, p.type, p.type_structure, p.typeStructure,
      p.institutionalType, p.institutional_type,
    ]);
    const categories = unique([p.category, ...(array(p.categories)), ...(array(p.help_category)), ...(array(p.help_categories))]);
    const services = unique([...(array(p.services)), ...(array(p.service_types)), p.service, p.service_type]);
    const status = statutDe(p);
    const address = adresseDe(p);
    const officialName = texte(p.officialName || p.nom || p.name || p.titre);
    const photos = mediasDe(p);
    const premierePhoto = photos[0] || null;
    const id = cleOfficielle(ids) || "aide:" + empreinte(sansAccents(name) + "|" + sansAccents(address) + "|" + lat.toFixed(4) + "," + lng.toFixed(4));
    const out = {
      kind: "AideStructure",
      aideStructure: true,
      id,
      autourId: ids.autourId || id,
      name,
      officialName,
      aliases: unique([...(array(p.aliases)), p.sigle, p.ancien_nom]),
      lat, lng,
      coordinates: { lat, lng },
      address,
      postalCode: texte(p.postalCode || p.code_postal || p.cp),
      commune: texte(p.commune || p.city || p.nom_commune),
      category: categories[0] || "asso",
      categories,
      primaryType: types[0] || "",
      types,
      type_structure: p.type_structure || p.typeStructure || p.institutionalType || "",
      institutionalType: p.institutionalType || p.institutional_type || "",
      services,
      tags: Object.assign({}, p.tags || {}),
      description: texte(p.description || p.mission || p.fullDesc || p.shortDesc),
      phone: texte(p.phone || p.tel || p.telephone),
      email: texte(p.email || p.courriel),
      website: texte(p.website || p.url || p.site_web || p.url_service_public),
      openingHours: p.openingHours || p.horaires ? (p.openingHours || { weekdayDescriptions: p.horaires }) : null,
      photos,
      image: texte(p.image || p.image_url || (premierePhoto && premierePhoto.url)),
      imageSource: texte(p.imageSource || p.image_source || (premierePhoto && premierePhoto.source)),
      imageAttribution: p.imageAttribution || p.image_attribution || (premierePhoto && premierePhoto.attribution) || "",
      imageSourceUrl: texte(p.imageSourceUrl || p.image_source_url || (premierePhoto && premierePhoto.sourceUrl)),
      imageAuthor: texte(p.imageAuthor || p.image_author || (premierePhoto && premierePhoto.author)),
      imageLicense: texte(p.imageLicense || p.image_license || (premierePhoto && premierePhoto.license)),
      imageUpdatedAt: p.imageUpdatedAt || p.image_updated_at || (premierePhoto && premierePhoto.updatedAt) || null,
      image_url: texte(p.image_url || p.image || (premierePhoto && premierePhoto.url)),
      image_source: texte(p.image_source || p.imageSource || (premierePhoto && premierePhoto.source)),
      image_source_url: texte(p.image_source_url || p.imageSourceUrl || (premierePhoto && premierePhoto.sourceUrl)),
      image_author: texte(p.image_author || p.imageAuthor || (premierePhoto && premierePhoto.author)),
      image_license: texte(p.image_license || p.imageLicense || (premierePhoto && premierePhoto.license)),
      image_updated_at: p.image_updated_at || p.imageUpdatedAt || (premierePhoto && premierePhoto.updatedAt) || null,
      openNow: status.ouvert,
      ouvert: status.ouvert,
      status,
      source,
      sources: unique([...(array(p.sources)), source]),
      sourceRefs: Object.assign({}, p.sourceRefs || {}, ids),
      identifiers: ids,
      provenance: provenancesDe(p, source, ids, sourceConfidence),
      sourceConfidence,
      updatedAt: p.updatedAt || p.date_modification_datetime || p.dateDerniereMaj || null,
      lastSourceUpdate: p.lastSourceUpdate || p.last_source_update || p.updatedAt ||
        p.date_modification_datetime || p.dateDerniereMaj || null,
      lastSyncedAt: p.lastSyncedAt || p.last_synced_at || p.syncedAt || null,
      officialUrl: p.officialUrl || p.url || p.url_service_public || p.lien_source || null,
      capacityHints: Object.assign({}, p.capacityHints || p.capacity_hints || {}),
    };
    return evaluerCapacites(out);
  }

  function evaluerCapacites(structure) {
    const classement = root.AutourAideClassement;
    if (!classement || typeof classement.capacites !== "function") return appliquerConfianceAide(structure);
    const result = classement.capacites(structure);
    const capacities = {};
    const capacityEvidence = {};
    Object.entries(result.detail || {}).forEach(([capacity, verdict]) => {
      const score = Number(verdict.confiance) || 0;
      const refs = structure.provenance.map((p) => Object.assign({}, p, {
        capacity,
        confidence: Math.round(score),
        confidenceLevel: niveau(score),
      }));
      capacities[capacity] = {
        eligible: !!verdict.accorde,
        confidence: Math.round(score),
        confidenceLevel: niveau(score),
        evidence: array(verdict.preuves),
        provenance: refs,
        certain: !!verdict.certaine,
        refusal: verdict.refus || null,
      };
      capacityEvidence[capacity] = array(verdict.preuves);
    });
    return appliquerConfianceAide(Object.assign(structure, {
      capacities,
      capacityEvidence,
      capacitesAide: Object.fromEntries(Object.entries(capacities).map(([k, v]) => [k, v.eligible])),
      confianceAide: result.confiance || 0,
      classificationAide: "AutourAideClassement",
    }));
  }

  function sourceKeys(structure) {
    const ids = structure && (structure.identifiers || structure.sourceRefs) || {};
    return Object.entries(ids).filter(([key, value]) => value && key !== "siren")
      .map(([key, value]) => key + ":" + normaliserIdentifiant(value));
  }

  function finessKeys(structure) {
    const ids = structure && (structure.identifiers || structure.sourceRefs) || {};
    const precis = [ids.finessEge, ids.finessPm].filter(Boolean).map(normaliserIdentifiant);
    return precis.length ? precis : (ids.finess ? [normaliserIdentifiant(ids.finess)] : []);
  }

  function distanceM(a, b) {
    if (!a || !b || !coordonneesValides(number(a.lat), number(a.lng)) ||
      !coordonneesValides(number(b.lat), number(b.lng))) return Infinity;
    const r = Math.PI / 180;
    const dLat = (Number(b.lat) - Number(a.lat)) * r;
    const dLng = (Number(b.lng) - Number(a.lng)) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(Number(a.lat) * r) *
      Math.cos(Number(b.lat) * r) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function cleSecours(structure) {
    const name = sansAccents(structure && (structure.officialName || structure.name));
    const address = sansAccents(structure && structure.address);
    if (!name || !address) return null;
    return name + "|" + address;
  }

  function compatible(a, b) {
    const ka = sourceKeys(a), kb = sourceKeys(b);
    const fa = finessKeys(a), fb = finessKeys(b);
    /* Le SIRET est parfois celui de la personne morale et se répète sur
       plusieurs FINESS EGE. Deux établissements FINESS distincts restent
       donc distincts, même si leur SIRET est identique. */
    if (fa.length && fb.length && !fa.some((key) => fb.includes(key))) return false;
    if (ka.some((key) => kb.includes(key))) return true;
    /* Deux identifiants officiels différents ne sont jamais rapprochés par
       le nom : un site administratif peut héberger plusieurs structures. */
    if (ka.length && kb.length) return false;
    const fallback = cleSecours(a);
    /* Les coordonnées peuvent diverger de quelques mètres entre géocodages.
       Elles restent obligatoires et bornent le rapprochement ; le nom et
       l'adresse normalisés portent l'identité de secours. */
    return !!fallback && fallback === cleSecours(b) && distanceM(a, b) <= 120;
  }

  function scoreFiche(structure) {
    const p = structure || {};
    return (p.sourceConfidence || 0) * 100 +
      (p.status && p.status.value !== "unknown" ? 15 : 0) +
      (p.address ? 8 : 0) + (p.phone ? 4 : 0) + (p.website ? 3 : 0) +
      (p.description ? 2 : 0);
  }

  function fusionner(a, b) {
    const principal = scoreFiche(a) >= scoreFiche(b) ? a : b;
    const secondaire = principal === a ? b : a;
    const statusA = a.status || { value: "unknown", confidence: 0 };
    const statusB = b.status || { value: "unknown", confidence: 0 };
    const status = (statusA.value !== "unknown" && statusA.confidence >= statusB.confidence) ? statusA :
      (statusB.value !== "unknown" ? statusB : principal.status);
    const conflits = statusA.value !== "unknown" && statusB.value !== "unknown" && statusA.value !== statusB.value
      ? [statusA, statusB] : [];
    const out = Object.assign({}, secondaire, principal, {
      aliases: unique([...(a.aliases || []), ...(b.aliases || [])]),
      categories: unique([...(a.categories || []), ...(b.categories || [])]),
      types: unique([...(a.types || []), ...(b.types || [])]),
      services: unique([...(a.services || []), ...(b.services || [])]),
      tags: Object.assign({}, a.tags || {}, b.tags || {}),
      sources: unique([...(a.sources || []), ...(b.sources || [])]),
      sourceRefs: Object.assign({}, a.sourceRefs || {}, b.sourceRefs || {}),
      identifiers: Object.assign({}, a.identifiers || {}, b.identifiers || {}),
      provenance: [...(a.provenance || []), ...(b.provenance || [])],
      capacityHints: Object.assign({}, a.capacityHints || {}, b.capacityHints || {}),
      status: Object.assign({}, status, conflits.length ? { conflicts: conflits } : {}),
      sourceConfidence: Math.max(a.sourceConfidence || 0, b.sourceConfidence || 0),
      sourcesCount: new Set([...(a.sources || []), ...(b.sources || [])]).size,
    });
    /* Les médias sont orthogonaux au score d'identité : une source plus riche
       en téléphone ou en description ne doit pas faire disparaître la photo
       portée par l'autre référentiel. */
    const medias = [...mediasDe(a), ...mediasDe(b)];
    const vus = new Set();
    out.photos = medias.filter((photo) => {
      if (vus.has(photo.url)) return false;
      vus.add(photo.url);
      return true;
    });
    if (!out.image && out.photos.length) {
      const photo = out.photos[0];
      out.image = photo.url;
      out.imageSource = sourcePhoto(photo.source);
      out.imageAttribution = photo.attribution ||
        (photo.author ? [{name: photo.author, url: ""}] : "");
      out.imageSourceUrl = photo.sourceUrl;
      out.imageAuthor = photo.author;
      out.imageLicense = photo.license;
      out.imageUpdatedAt = photo.updatedAt;
      out.image_url = photo.url;
      out.image_source = out.imageSource;
      out.image_source_url = out.imageSourceUrl;
      out.image_author = out.imageAuthor;
      out.image_license = out.imageLicense;
      out.image_updated_at = out.imageUpdatedAt;
    }
    out.id = cleOfficielle(out.identifiers) || principal.id;
    return evaluerCapacites(out);
  }

  function dedupe(items) {
    const groups = [];
    (items || []).map((x) => normaliser(x) || x).filter(Boolean).forEach((item) => {
      const index = groups.findIndex((existing) => compatible(existing, item));
      if (index === -1) groups.push(item);
      else groups[index] = fusionner(groups[index], item);
    });
    return groups;
  }

  function fiable(structure, besoins) {
    const ids = array(besoins);
    if (!ids.length) return Object.values(structure && structure.capacities || {}).some((v) => v && v.eligible && v.confidence >= 50);
    const taxo = root.AutourAideTaxonomie;
    return ids.some((need) => {
      const b = taxo && taxo.besoin ? taxo.besoin(need) : null;
      if (need === "autre" || taxo && need === taxo.BESOIN_OUVERT)
        return Object.values(structure && structure.capacities || {})
          .some((v) => v && v.eligible && v.confidence >= 50);
      const cap = b && b.capacite;
      const v = cap && structure.capacities && structure.capacities[cap];
      return !!(v && v.eligible && v.confidence >= 50);
    });
  }

  function affichable(structure) {
    return !!(structure && structure.name && coordonneesValides(number(structure.lat), number(structure.lng)));
  }

  root.AutourAideStructures = Object.freeze({
    SOURCES,
    CONFIANCE_AIDE,
    FRAICHEUR_AIDE,
    normaliser,
    evaluerCapacites,
    appliquerConfianceAide,
    fraicheurDe,
    dedupe,
    fusionner,
    fiable,
    affichable,
    distanceM,
    sourceKeys,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
