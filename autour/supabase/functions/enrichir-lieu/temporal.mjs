/*
 * Extraction temporelle déterministe.
 *
 * Ce module ne fait ni réseau ni appel de modèle. Il transforme uniquement des
 * données déjà possédées par Autour en observations datées et traçables. La
 * fusion est séparée de l'extraction afin de conserver les contradictions au
 * lieu de les écraser.
 */

const MOIS = Object.freeze({
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, fevr: 2, fev: 2, février: 2, févr: 2, fév: 2,
  mars: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7,
  aout: 8, août: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, déc: 12, dec: 12,
});

const JOURS = Object.freeze({
  lundi: 1, lun: 1,
  mardi: 2, mar: 2,
  mercredi: 3, mer: 3,
  jeudi: 4, jeu: 4,
  vendredi: 5, ven: 5,
  samedi: 6, sam: 6,
  dimanche: 7, dim: 7,
});

const SOURCES = new Set(["structured", "description", "poster", "official_web", "third_party"]);
const RANGS = Object.freeze({structured: 5, official_web: 4, poster: 3, description: 2, third_party: 1});
const CHAMPS = new Set([
  "date_unique", "period_start", "period_end", "start_time", "end_time",
  "doors_open_time", "weekdays", "address", "venue", "price",
  "reservation_required", "ticketing_url", "status", "rescheduled_date",
  "new_date", "event_title",
]);

function sansAccents(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function texte(value, max = 500) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function maintenant(options) {
  const n = Number(options?.now ?? options?.maintenant);
  return Number.isFinite(n) ? n : Date.now();
}

function anneeParDefaut(options) {
  const n = Number(options?.year);
  if (Number.isInteger(n) && n >= 2000 && n <= 2100) return n;
  return new Date(maintenant(options)).getUTCFullYear();
}

function annee(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return n < 100 ? 2000 + n : n;
}

function dateIso(jour, mois, an, fallback) {
  const d = Number(jour), m = Number(mois), y = annee(an, fallback);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || d < 1 || m < 1 || m > 12) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function cleMois(value) {
  return sansAccents(String(value ?? "")).replace(/[.]/g, "");
}

function mois(value) {
  return MOIS[cleMois(value)] ?? null;
}

function dateValeur(value, options = {}) {
  if (value == null || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const s = texte(value, 80);
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]|$)/);
  if (match) return dateIso(match[3], match[2], match[1], anneeParDefaut(options));
  match = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?:[T ]|$)/);
  if (match) return dateIso(match[1], match[2], match[3], anneeParDefaut(options));
  match = s.match(/^(?:le\s+)?(\d{1,2})\s*(?:er\s*)?([A-Za-zÀ-ÿ.]+)(?:\s+(\d{2,4}))?$/i);
  if (match) return dateIso(match[1], mois(match[2]), match[3], anneeParDefaut(options));
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function heureValeur(value) {
  if (value == null || value === "") return null;
  const s = texte(value, 30).toLowerCase().replace(/\s/g, "");
  const m = s.match(/^(\d{1,2})(?:h|:)(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]), min = m[2] == null ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function listeJours(value) {
  const s = sansAccents(value);
  const actifs = new Set();
  for (const [mot, numero] of Object.entries(JOURS)) {
    const expression = new RegExp(`(?:^|[^a-z])${mot}(?:e|\.)?(?=$|[^a-z])`, "i");
    if (expression.test(s)) actifs.add(numero);
  }
  return [...actifs].sort((a, b) => a - b);
}

function observation(field, value, options, evidence, eventIndex) {
  if (!CHAMPS.has(field) || value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  const sourceType = SOURCES.has(options?.source_type) ? options.source_type : "description";
  const source = options?.source_url || options?.image_id || options?.source_id || null;
  const confidence = Number(options?.confidence);
  const item = {
    field, value, source_type: sourceType, source_url: source,
    extracted_at: options?.extracted_at || new Date().toISOString(),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
    evidence: texte(evidence, 180) || null,
  };
  if (eventIndex != null) item.event_index = eventIndex;
  return item;
}

function projection(observations) {
  const data = {};
  const events = [];
  for (const item of observations) {
    const target = item.event_index == null ? data : (events[item.event_index] ||= {});
    if (target[item.field] == null) target[item.field] = item.value;
  }
  if (events.length) data.events = events;
  return data;
}

function projectionCoherente(observations) {
  const data = projection(observations);
  /* `date_unique` est une forme courte de period_start/period_end. Une date
     unique contradictoire ne doit pas rester à côté d'une période plus forte
     et fabriquer un objet impossible à interpréter. Les observations restent
     conservées pour la provenance et l'audit. */
  if (data.period_start && data.period_end &&
      (!data.date_unique || data.date_unique !== data.period_start || data.period_start !== data.period_end)) {
    delete data.date_unique;
  }
  return data;
}

function ajouter(observations, field, value, options, evidence, eventIndex) {
  const item = observation(field, value, options, evidence, eventIndex);
  if (item) observations.push(item);
}

function dateObservations(input, options, eventIndex) {
  const s = texte(input, 1000);
  if (!s) return [];
  const sorties = [];
  const an = anneeParDefaut(options);
  const pousser = (start, end, evidence) => {
    const a = dateIso(start.day, start.month, start.year, an);
    const b = dateIso(end.day, end.month, end.year, an);
    if (!a) return;
    ajouter(sorties, "period_start", a, options, evidence, eventIndex);
    ajouter(sorties, "date_unique", b && b !== a ? null : a, options, evidence, eventIndex);
    ajouter(sorties, "period_end", b || a, options, evidence, eventIndex);
  };
  let match;
  const nomMois = Object.keys(MOIS).join("|");
  const plage = new RegExp(`(?:du\\s+)?(\\d{1,2})\\s*(?:er\\s*)?(?:au|à|a|[-–—])\\s*(\\d{1,2})\\s*(?:er\\s*)?(${nomMois})(?:\\s+(\\d{2,4}))?`, "gi");
  while ((match = plage.exec(s))) {
    pousser({day: match[1], month: mois(match[3]), year: match[4]},
      {day: match[2], month: mois(match[3]), year: match[4]}, match[0]);
  }
  const jusqu = new RegExp(`jusqu(?:['’ ]?au|\\s+au)\\s+(\\d{1,2})\\s*(?:er\\s*)?(${nomMois})(?:\\s+(\\d{2,4}))?`, "gi");
  while ((match = jusqu.exec(s))) {
    const b = dateIso(match[1], mois(match[2]), match[3], an);
    if (b) ajouter(sorties, "period_end", b, options, match[0], eventIndex);
  }
  const numerique = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g;
  while ((match = numerique.exec(s))) {
    const d = dateIso(match[1], match[2], match[3], an);
    if (d) {
      ajouter(sorties, "period_start", d, options, match[0], eventIndex);
      ajouter(sorties, "date_unique", d, options, match[0], eventIndex);
      ajouter(sorties, "period_end", d, options, match[0], eventIndex);
    }
  }
  const simple = new RegExp(`\\b(\\d{1,2})\\s*(?:er\\s*)?(${nomMois})(?:\\s+(\\d{2,4}))?\\b`, "gi");
  while ((match = simple.exec(s))) {
    const d = dateIso(match[1], mois(match[2]), match[3], an);
    if (d) {
      ajouter(sorties, "period_start", d, options, match[0], eventIndex);
      ajouter(sorties, "date_unique", d, options, match[0], eventIndex);
      ajouter(sorties, "period_end", d, options, match[0], eventIndex);
    }
  }
  const plageTrouvee = sorties.some((x) => x.field === "period_start") &&
    sorties.some((x) => x.field === "period_end" &&
      sorties.some((y) => y.field === "period_start" && y.value !== x.value));
  const jusquTrouve = /jusqu(?:['’ ]?au|\s+au)\s+\d{1,2}/i.test(s);
  if (plageTrouvee) return sorties.filter((x) => x.field !== "date_unique");
  if (jusquTrouve) return sorties.filter((x) => x.field !== "date_unique" && x.field !== "period_start");
  return sorties;
}

function heureObservations(input, options, eventIndex) {
  const s = texte(input, 1500);
  if (!s) return [];
  const sorties = [];
  const token = `(\\d{1,2})(?:h|:)(\\d{2})?`;
  const heure = (a, b) => heureValeur(`${a}h${b == null ? "" : b}`);
  const portes = new RegExp(`(?:ouverture(?:\\s+des)?\\s+portes?|portes?)\\s*(?:à|a|:)?\\s*${token}`, "i").exec(s);
  if (portes) ajouter(sorties, "doors_open_time", heure(portes[1], portes[2]), options, portes[0], eventIndex);
  const debut = new RegExp(`(?:concert|spectacle|début|debut|séance|seance|commence|start)\\s*(?:à|a|:)?\\s*${token}`, "i").exec(s);
  if (debut) ajouter(sorties, "start_time", heure(debut[1], debut[2]), options, debut[0], eventIndex);

  const plage = new RegExp(`${token}\\s*(?:à|a|[-–—/]|jusqu['’ ]?à)\\s*${token}`, "gi");
  let match;
  while ((match = plage.exec(s))) {
    ajouter(sorties, "start_time", heure(match[1], match[2]), options, match[0], eventIndex);
    ajouter(sorties, "end_time", heure(match[3], match[4]), options, match[0], eventIndex);
  }
  if (!sorties.some((x) => x.field === "start_time")) {
    const tous = new RegExp(`\\b${token}\\b`, "gi");
    const matches = [...s.matchAll(tous)];
    if (matches.length) ajouter(sorties, "start_time", heure(matches[0][1], matches[0][2]), options, matches[0][0], eventIndex);
    if (matches.length > 1) ajouter(sorties, "end_time", heure(matches[1][1], matches[1][2]), options, matches[1][0], eventIndex);
  }
  return sorties;
}

export function extraireTemporaliteTexte(input, options = {}) {
  const s = texte(input, 6000);
  const observations = [];
  if (!s) return {data: {}, observations, readable: false};
  observations.push(...dateObservations(s, options));
  const tousLesJours = /tous\s+les\s+jours/i.test(s);
  const jours = listeJours(s);
  if (jours.length && !tousLesJours) ajouter(observations, "weekdays", jours, options, s.match(/[^.]{0,80}(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|MER|SAM)[^.]{0,80}/i)?.[0] || s);
  if (tousLesJours) {
    const exclus = listeJours((s.match(/tous\s+les\s+jours[^.\n]{0,100}/i) || [""])[0]);
    const actifs = [1, 2, 3, 4, 5, 6, 7].filter((j) => !exclus.includes(j));
    ajouter(observations, "weekdays", actifs, options, (s.match(/tous\s+les\s+jours[^.\n]{0,100}/i) || [s])[0]);
  }
  observations.push(...heureObservations(s, options));

  const reservation = /réservation\s+obligatoire|reservation\s+obligatoire|réservation|reservation|billetterie/i.test(s);
  if (reservation) ajouter(observations, "reservation_required", true, options,
    (s.match(/[^.]{0,50}(?:réservation|reservation|billetterie)[^.]{0,80}/i) || [s])[0]);
  const gratuit = /gratuit(?:e)?|entrée\s+libre|entree\s+libre/i.exec(s);
  const tarif = /(?:à partir de\s+|tarif\s*:?\s*)(\d+(?:[,.]\d{1,2})?)\s*€|\b(\d+(?:[,.]\d{1,2})?)\s*€/i.exec(s);
  if (gratuit) ajouter(observations, "price", "gratuit", options, gratuit[0]);
  else if (tarif) ajouter(observations, "price", `${(tarif[1] || tarif[2]).replace(",", ".")} €`, options, tarif[0]);
  const annule = /\bannulé(?:e)?\b|\bcancelled\b/i.exec(s);
  const reporte = /\breporté(?:e)?\b|\bpostponed\b/i.exec(s);
  const complet = /\bcomplet(?:e)?\b|\bsold[ -]?out\b/i.exec(s);
  if (annule) ajouter(observations, "status", "cancelled", options, annule[0]);
  else if (reporte) ajouter(observations, "status", "postponed", options, reporte[0]);
  else if (complet) ajouter(observations, "status", "full", options, complet[0]);
  if (reporte) {
    const nouveau = s.match(/(?:reporté(?:e)?|nouvelle\s+date)[^\n.]{0,50}/i)?.[0] || "";
    const dates = dateObservations(nouveau, options);
    const date = dates.find((x) => x.field === "date_unique") || dates.find((x) => x.field === "period_start");
    if (date) ajouter(observations, "rescheduled_date", date.value, options, nouveau);
  }
  const adresse = s.match(/(?:adresse|lieu)\s*:\s*([^.;\n]+)/i);
  if (adresse) ajouter(observations, "address", texte(adresse[1], 180), options, adresse[0]);
  const data = projection(observations);
  return {data, observations, readable: observations.length > 0};
}

const STRUCTURED_FIELDS = Object.freeze({
  period_start: ["period_start", "periodStart", "start_date", "startDate", "date_debut", "dateDebut"],
  period_end: ["period_end", "periodEnd", "end_date", "endDate", "date_fin", "dateFin"],
  date_unique: ["date_unique", "dateUnique", "date", "event_date"],
  start_time: ["start_time", "startTime", "heure_debut", "heureDebut"],
  end_time: ["end_time", "endTime", "heure_fin", "heureFin"],
  weekdays: ["weekdays", "days", "jours", "jours_actifs"],
  address: ["address", "adresse"], venue: ["venue", "lieu", "place_name"],
  price: ["price", "prix", "tarif"], reservation_required: ["reservation_required", "reservationRequired"],
  ticketing_url: ["ticketing_url", "ticketUrl", "url_billetterie", "billetterie"],
  status: ["status", "statut"], event_title: ["event_title", "title", "titre"],
});

function valeurChamp(source, noms) {
  for (const nom of noms) if (source?.[nom] != null && source[nom] !== "") return source[nom];
  return null;
}

function optionsSource(options, type, source) {
  return Object.assign({}, options, {
    source_type: type,
    source_url: options.source_url || source?.source_url || source?.sourceUrl || null,
    source_id: options.source_id || source?.source_id || source?.sourceId || null,
  });
}

function lireObjetStructure(source, options, eventIndex) {
  const s = source && typeof source === "object" ? source : {};
  const o = optionsSource(options, "structured", s);
  const observations = [];
  const startAt = valeurChamp(s, ["start_at", "startAt", "starts_at", "startsAt", "debut_le", "debutLe"]);
  const endAt = valeurChamp(s, ["end_at", "endAt", "ends_at", "endsAt", "fin_le", "finLe"]);
  const startDate = dateValeur(startAt, o), endDate = dateValeur(endAt, o);
  if (startDate) {
    ajouter(observations, "period_start", startDate, o, `start_at=${texte(startAt, 40)}`, eventIndex);
    const heureStart = String(startAt).match(/[T ](\d{1,2}):(\d{2})/);
    if (heureStart) ajouter(observations, "start_time", heureValeur(`${heureStart[1]}h${heureStart[2]}`), o, `start_at=${texte(startAt, 40)}`, eventIndex);
  }
  if (endDate) {
    ajouter(observations, "period_end", endDate, o, `end_at=${texte(endAt, 40)}`, eventIndex);
    const heureEnd = String(endAt).match(/[T ](\d{1,2}):(\d{2})/);
    if (heureEnd) ajouter(observations, "end_time", heureValeur(`${heureEnd[1]}h${heureEnd[2]}`), o, `end_at=${texte(endAt, 40)}`, eventIndex);
  }
  for (const [field, noms] of Object.entries(STRUCTURED_FIELDS)) {
    const raw = valeurChamp(s, noms);
    if (raw == null || field === "period_start" || field === "period_end") continue;
    let value = raw;
    if (field === "date_unique") value = dateValeur(raw, o);
    else if (field === "start_time" || field === "end_time") value = heureValeur(raw);
    else if (field === "weekdays") value = Array.isArray(raw) ? raw.map((x) => Number(x)).filter((x) => x >= 1 && x <= 7) : listeJours(raw);
    else if (field === "reservation_required") value = raw === true || /obligatoire|oui|true/i.test(String(raw));
    else if (field === "ticketing_url") value = /^https?:\/\//i.test(String(raw)) ? String(raw) : null;
    else value = typeof raw === "string" ? texte(raw, 250) : raw;
    if (value != null && value !== "" && !(Array.isArray(value) && !value.length)) ajouter(observations, field, value, o, `${field}=${texte(raw, 80)}`, eventIndex);
  }
  for (const nom of ["horaires", "hours", "opening_hours", "schedule", "dates", "programme", "description", "summary", "resume", "notes"]) {
    const raw = s[nom];
    if (typeof raw === "string") observations.push(...extraireTemporaliteTexte(raw, o).observations.map((x) => Object.assign(x, eventIndex == null ? {} : {event_index: eventIndex})));
  }
  return observations;
}

export function extraireTemporaliteStructuree(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const observations = lireObjetStructure(source, options, undefined);
  const programme = source.programme || source.program || source.events || source.occurrences;
  if (Array.isArray(programme)) {
    programme.slice(0, 50).forEach((event, index) => observations.push(...lireObjetStructure(event, options, index)));
  }
  return {data: projection(observations), observations, readable: observations.length > 0};
}

function valeurPoster(event, aliases) {
  for (const key of aliases) if (event?.[key] != null && event[key] !== "") return event[key];
  return null;
}

export function extraireTemporaliteAffiche(input, options = {}) {
  let source = input;
  if (typeof source === "string") {
    try { source = JSON.parse(source.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()); }
    catch { return {data: {unknown: true}, observations: [], readable: false}; }
  }
  if (!source || source.readable === false || source.unknown === true) return {data: {unknown: true}, observations: [], readable: false};
  const events = Array.isArray(source.events) ? source.events : [source];
  const observations = [];
  const base = Object.assign({}, options, {source_type: "poster", source_url: options.source_url || source.source_url || source.image_url || null, image_id: options.image_id || source.image_id || source.imageId || null, confidence: options.confidence ?? source.confidence ?? 0.82});
  events.slice(0, 20).forEach((event, index) => {
    if (!event || typeof event !== "object") return;
    const ei = events.length > 1 ? index : undefined;
    const rawDate = valeurPoster(event, ["date_unique", "date", "date_text", "start_date", "startDate"]);
    const rawStart = valeurPoster(event, ["period_start", "start_date", "startDate"]);
    const rawEnd = valeurPoster(event, ["period_end", "end_date", "endDate"]);
    const dateStart = dateValeur(rawStart || rawDate, base), dateEnd = dateValeur(rawEnd || rawDate, base);
    if (rawDate && /\d{1,2}\s*(?:[-–—]|au)\s*\d{1,2}|jusqu/i.test(String(rawDate))) {
      const datesTexte = extraireTemporaliteTexte(String(rawDate), base);
      datesTexte.observations.forEach((item) => {
        if (["period_start", "period_end", "date_unique"].includes(item.field)) {
          observations.push(Object.assign({}, item, {source_type: "poster", source_url: base.source_url || null,
            image_id: base.image_id || null, event_index: ei}));
        }
      });
    }
    if (dateStart) ajouter(observations, "period_start", dateStart, base, String(rawStart || rawDate), ei);
    if (dateEnd) ajouter(observations, "period_end", dateEnd, base, String(rawEnd || rawDate), ei);
    if (dateStart && dateEnd && dateStart === dateEnd) ajouter(observations, "date_unique", dateStart, base, String(rawDate || rawStart), ei);
    const start = heureValeur(valeurPoster(event, ["start_time", "startTime", "time_start", "heure_debut"]));
    const end = heureValeur(valeurPoster(event, ["end_time", "endTime", "time_end", "heure_fin"]));
    const texteHoraire = valeurPoster(event, ["hours", "horaires", "time_text"]);
    if (texteHoraire && !start && !end) {
      extraireTemporaliteTexte(String(texteHoraire), base).observations.forEach((item) => {
        if (["start_time", "end_time", "weekdays"].includes(item.field))
          observations.push(Object.assign({}, item, {source_type: "poster", source_url: base.source_url || null,
            image_id: base.image_id || null, event_index: ei}));
      });
    }
    if (start) ajouter(observations, "start_time", start, base, String(valeurPoster(event, ["start_time", "startTime", "time_start", "heure_debut"])), ei);
    if (end) ajouter(observations, "end_time", end, base, String(valeurPoster(event, ["end_time", "endTime", "time_end", "heure_fin"])), ei);
    const days = valeurPoster(event, ["weekdays", "days", "jours"]);
    const weekdays = Array.isArray(days) ? days.map((x) => Number(x)).filter((x) => x >= 1 && x <= 7) : listeJours(days);
    if (weekdays.length) ajouter(observations, "weekdays", weekdays, base, String(days), ei);
    for (const [field, aliases] of Object.entries({address:["address", "adresse"], venue:["venue", "lieu"], price:["price", "prix", "tarif"], ticketing_url:["ticketing_url", "ticketUrl", "billetterie"], event_title:["event_title", "title", "titre"]})) {
      const value = valeurPoster(event, aliases);
      if (value != null && value !== "") ajouter(observations, field, field === "ticketing_url" ? (/^https?:\/\//i.test(String(value)) ? String(value) : null) : texte(value, 250), base, String(value), ei);
    }
    const reservation = valeurPoster(event, ["reservation_required", "reservationRequired", "reservation"]);
    if (reservation === true || /oui|obligatoire|true/i.test(String(reservation ?? ""))) ajouter(observations, "reservation_required", true, base, String(reservation), ei);
    const status = valeurPoster(event, ["status", "statut"]);
    if (status && /cancel|annul/i.test(String(status))) ajouter(observations, "status", "cancelled", base, String(status), ei);
    else if (status && /report|postpon/i.test(String(status))) ajouter(observations, "status", "postponed", base, String(status), ei);
    else if (status && /full|complet|sold/i.test(String(status))) ajouter(observations, "status", "full", base, String(status), ei);
    const newDate = dateValeur(valeurPoster(event, ["rescheduled_date", "new_date", "newDate"]), base);
    if (newDate) ajouter(observations, "rescheduled_date", newDate, base, String(valeurPoster(event, ["rescheduled_date", "new_date", "newDate"])), ei);
  });
  return observations.length ? {data: projection(observations), observations, readable: true} : {data: {unknown: true}, observations: [], readable: false};
}

function cleObservation(item) {
  return `${item.event_index == null ? "root" : `event:${item.event_index}`}.${item.field}`;
}

function egales(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function valeurValide(value) {
  return value != null && value !== "" && !(Array.isArray(value) && !value.length);
}

export function fusionnerTemporalites(input, options = {}) {
  const observations = [];
  for (const item of Array.isArray(input) ? input : []) {
    if (Array.isArray(item)) observations.push(...item);
    else if (Array.isArray(item?.observations)) observations.push(...item.observations);
    else if (item && typeof item === "object") observations.push(item);
  }
  const valides = observations.filter((x) => x && CHAMPS.has(x.field) && valeurValide(x.value) && SOURCES.has(x.source_type));
  const groupes = new Map();
  for (const item of valides) {
    const key = cleObservation(item);
    if (!groupes.has(key)) groupes.set(key, []);
    groupes.get(key).push(item);
  }
  const selection = [], conflicts = [], uncertain = [];
  for (const [key, items] of groupes) {
    const tries = [...items].sort((a, b) => (RANGS[b.source_type] - RANGS[a.source_type]) || (Number(b.confidence) - Number(a.confidence)));
    const best = tries[0];
    const sameRank = tries.filter((x) => RANGS[x.source_type] === RANGS[best.source_type]);
    const different = tries.filter((x) => !egales(x.value, best.value));
    if (different.length) {
      conflicts.push({field: best.field, event_index: best.event_index ?? null, observations: tries.map((x) => ({value: x.value, source_type: x.source_type, source_url: x.source_url || x.image_id || null, confidence: x.confidence, evidence: x.evidence || null}))});
      if (sameRank.some((x) => !egales(x.value, best.value))) {
        uncertain.push(best.field + (best.event_index == null ? "" : `:${best.event_index}`));
        continue;
      }
    }
    selection.push(best);
  }
  const data = projectionCoherente(selection);
  const provenance = {};
  const events = [];
  for (const item of selection) {
    const target = item.event_index == null ? provenance : (events[item.event_index] ||= {});
    target[item.field] = {source_type: item.source_type, source_url: item.source_url || null, image_id: item.image_id || null, extracted_at: item.extracted_at, confidence: item.confidence, evidence: item.evidence || null};
  }
  if (Object.keys(provenance).length) data.provenance = provenance;
  if (events.length) {
    data.events = data.events || [];
    events.forEach((p, i) => { data.events[i] = Object.assign({}, data.events[i] || {}, {provenance: p}); });
  }
  data.uncertain_fields = uncertain;
  return {data, observations: valides, conflicts};
}

export function champsTemporelsCritiques(data, options = {}) {
  const event = options.event_index != null ? data?.events?.[options.event_index] : data;
  if (!event || event.unknown) return ["period_start", "period_end", "start_time", "end_time"];
  const missing = [];
  if (!event.period_start && !event.date_unique) missing.push("period_start");
  if (!event.period_end && !event.date_unique) missing.push("period_end");
  if (!event.start_time) missing.push("start_time");
  if (!event.end_time) missing.push("end_time");
  return missing;
}

export const TEMPORAL_SOURCE_RANKS = RANGS;
