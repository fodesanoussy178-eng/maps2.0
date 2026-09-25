/* ===========================================================================
   LES SIX OUTILS — DES QUESTIONS D'AUTOUR, POSÉES DEPUIS UNE CONVERSATION

   Chaque outil est une LECTURE. Aucun n'écrit, aucun ne déclenche de
   recherche Web : l'inventaire est déjà préparé par les agents Autour, et le
   rôle du MCP s'arrête à le servir vite.

   CE QUE CHAQUE OUTIL RÉUTILISE, NOMMÉMENT :

     search_now     → `maintenant.js` (`selection`), donc temporalité,
                      éligibilité, disponibilité, diversité, plafond de trois.
     search_events  → `temporel.js` pour la fenêtre demandée et les libellés,
                      `comprendre.js` pour lire la phrase, `core.js` pour la
                      taxonomie et la diversité.
     search_nearby  → `lieux_explorer` (l'inventaire), `availability.js` pour
                      l'ouverture, la table `CAT_PAR_FAMILLE_EXPLORER` d'Autour
                      pour le pont entre ce qu'on cherche et ce qu'un lieu est.
     search_help    → la chaîne Solidarité complète : `aide-taxonomie.js`,
                      `aide-classement.js`, `aide-structures.js`, les providers
                      `aideDecouverte` et `aideDora`, et la doctrine
                      organisation / point de service.
     get_event      → la fiche canonique et ses séances, séparées.
     get_place      → la fiche du lieu, enrichie de ce que la découverte a
                      vérifié (téléphone, services), via la même fonction
                      publique que Solidarité.

   CE QU'AUCUN N'AJOUTE : un score maison, un tri « pour ChatGPT », un seuil
   inventé. Quand une règle d'Autour refuse un résultat, l'outil rend moins de
   résultats — jamais un résultat de remplacement.
   ======================================================================== */

import * as base from "./base.mjs";
import * as liens from "./liens.mjs";
import * as projection from "./projection.mjs";
import { itemEvenement, itemLieu } from "./items.mjs";
import { moteursVerifies } from "./moteurs.mjs";
import { resoudre } from "./lieux.mjs";
/* La taxonomie ouverte de l'agent de découverte : elle sait que brocante,
   vide-grenier, puces et braderie désignent la même chose. C'est le SEUL
   endroit du produit qui porte ces synonymes, et le réécrire ici en créerait
   un second, condamné à diverger pour rien.

   ELLE VIT À LA RACINE, ET CE N'EST PAS UN CAPRICE DE RANGEMENT. Le premier
   déploiement a échoué là-dessus : `supabase/` n'est jamais téléversé chez
   l'hébergeur — il porte le schéma, les politiques RLS et le protocole de
   synchronisation, qui furent publiquement lisibles une fois — et une fonction
   qui importe depuis ce dossier référence donc un module absent. */
import * as taxonomieOuverte from "../taxonomie-ouverte.mjs";

const MAX_RESULTATS = 3;
const MAX_RESULTATS_ETENDU = 5;

/* La table d'`app.js` (`CAT_PAR_FAMILLE_EXPLORER`), lue dans l'autre sens.
   « Une famille inconnue ne se traduit pas » : sans correspondance, on ne
   force aucune famille et l'inventaire répond sur toutes. */
const FAMILLE_PAR_CAT = Object.freeze({
  musee: "culture", biblio: "bibliotheque", cinema: "cinema", concert: "musique",
  spectacle: "culture", parc: "nature", terrain: "sport", piscine: "sport",
  marche: "marche", resto: "restauration", fastfood: "restauration", cafe: "restauration",
  commerce: "commerce", asso: "association", hebergement: "hebergement",
});

/* Les familles de l'inventaire, nommées comme la base les nomme. Une demande
   d'un seul mot — « marché », « patrimoine », « skatepark » — ne passe par
   aucune catégorie : `comprendre.js` la laisse dans le reste. Ce mot est
   pourtant souvent le NOM d'une famille, et l'inventaire sait y répondre. */
const FAMILLES_INVENTAIRE = Object.freeze(["culture", "bibliotheque", "cinema", "musique",
  "patrimoine", "nature", "sport", "marche", "restauration", "commerce", "association",
  "solidarite", "hebergement"]);

/* Et les familles de la taxonomie ouverte, qui parle d'événements, retombent
   sur celles de l'inventaire quand elles désignent le même endroit. */
const FAMILLE_PAR_SOUS_CATEGORIE = Object.freeze({
  vente_occasion: "marche", marche_createurs: "marche", marche_alimentaire: "marche",
  projection_spectacle: "culture", atelier_initiation: "culture",
  rencontre_associative: "association", collecte_solidaire: "solidarite",
  sport_participatif: "sport",
});

/* Les besoins de Solidarité portent des noms français ; une conversation en
   anglais dira `food` ou `housing`. Les deux mènent au même besoin — ce sont
   les CAPACITÉS d'`aide-taxonomie.js` qui font le pont, pas une liste
   parallèle. */
const ALIAS_BESOIN = Object.freeze({
  food: "manger", food_aid: "manger", meals: "manger", grocery: "manger",
  housing: "logement", shelter: "logement", accommodation: "logement",
  health: "sante", medical: "sante", care: "sante",
  admin: "papiers", administrative: "papiers", paperwork: "papiers", rights: "papiers",
  clothing: "vetements", clothes: "vetements",
  hygiene: "hygiene", shower: "hygiene", laundry: "hygiene",
  work: "travail", job: "travail", employment: "travail", money: "travail",
  youth: "jeunes", student: "jeunes", student_help: "jeunes", students: "jeunes",
  listening: "parler", support: "parler", psychological: "parler",
  family: "famille", children: "famille",
  safety: "securite", violence: "securite",
  mobility: "mobilite", transport: "mobilite",
});

function borne(valeur, defaut, max) {
  const n = Math.trunc(Number(valeur));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : defaut;
}

function instant(valeur) {
  if (valeur == null || valeur === "" || /^(now|maintenant)$/i.test(String(valeur))) return Date.now();
  const t = Date.parse(String(valeur));
  return Number.isFinite(t) ? t : Date.now();
}

function distanceDe(moteurs, position, item) {
  if (!position || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return null;
  return moteurs.MAINTENANT.distanceM(position[0], position[1], item.lat, item.lng);
}

/* ---- LA FENÊTRE DEMANDÉE ------------------------------------------------
   Les quatre surfaces d'Autour (`maintenant`, `soir`, `weekend`, `avenir`)
   viennent de `temporel.js` et ne sont pas redéfinies ici. « Aujourd'hui »,
   « cette semaine » et un jour de la semaine nommé sont des DÉCALAGES de
   `fenetreJour` — la même fonction, un autre jour. */
const JOURS = Object.freeze({ dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4,
  vendredi: 5, samedi: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6 });

export function fenetreDemandee(quand, t, moteurs, tz = "Europe/Paris") {
  const TEMPS = moteurs.TEMPS;
  const mot = String(quand == null ? "" : quand).trim().toLowerCase();
  const jour = (decalage) => {
    const f = TEMPS.fenetreJour(t + decalage * 86400000, tz);
    return { debut: f.debut, fin: f.fin, timeZone: tz, libelle: "jour" };
  };
  if (!mot || /^(avenir|upcoming|prochainement|bient(o|ô)t$)/.test(mot))
    return Object.assign({ libelle: "à venir" }, TEMPS.fenetreSurface("avenir", t, tz));
  if (/^(now|maintenant)$/.test(mot))
    return Object.assign({ libelle: "maintenant" }, TEMPS.fenetreSurface("maintenant", t, tz));
  if (/(ce soir|tonight|soir)/.test(mot))
    return Object.assign({ libelle: "ce soir" }, TEMPS.fenetreSurface("soir", t, tz));
  if (/(week-?end|weekend)/.test(mot))
    return Object.assign({ libelle: "ce week-end" }, TEMPS.fenetreSurface("weekend", t, tz));
  if (/(aujourd|today)/.test(mot)) return Object.assign(jour(0), { libelle: "aujourd'hui" });
  if (/(demain|tomorrow)/.test(mot)) return Object.assign(jour(1), { libelle: "demain" });
  if (/(semaine|week|7 jours)/.test(mot)) {
    const debut = TEMPS.fenetreJour(t, tz).debut;
    return { debut, fin: TEMPS.fenetreJour(t + 6 * 86400000, tz).fin, timeZone: tz,
      libelle: "cette semaine" };
  }
  for (const [nom, numero] of Object.entries(JOURS)) {
    if (!mot.includes(nom)) continue;
    /* Le prochain jour nommé, aujourd'hui inclus : « dimanche » un dimanche
       matin parle de ce dimanche-là. */
    const parts = TEMPS.partsLocales(t, tz);
    const courant = new Date(Date.UTC(parts.annee, parts.mois - 1, parts.jour)).getUTCDay();
    const decalage = (numero - courant + 7) % 7;
    return Object.assign(jour(decalage), { libelle: nom });
  }
  const date = Date.parse(mot);
  if (Number.isFinite(date)) return Object.assign(jour(Math.round((date - t) / 86400000)),
    { libelle: mot });
  return Object.assign({ libelle: "à venir" }, TEMPS.fenetreSurface("avenir", t, tz));
}

function dansFenetre(ligne, fenetre, t, moteurs) {
  const TEMPS = moteurs.TEMPS;
  const debut = TEMPS.toEpochInZone(ligne.start_at, ligne.timezone || "Europe/Paris");
  const fin = TEMPS.toEpochInZone(ligne.end_at, ligne.timezone || "Europe/Paris");
  if (!Number.isFinite(debut)) return false;
  if (fenetre.fin == null) return (Number.isFinite(fin) ? fin : debut) >= t;
  const finEffective = Number.isFinite(fin) ? fin : debut;
  return debut < fenetre.fin && finEffective > Math.max(t, fenetre.debut);
}

/* ---- LIRE LA DEMANDE ----------------------------------------------------
   `comprendre.js` fait le travail : catégories, créneau, budget, groupe. Ce
   qu'il laisse dans `reste` est ce qu'aucun vocabulaire d'Autour ne connaît —
   « brocante », « rap », « skatepark ». On le traite comme des MOTS, cherchés
   dans le texte de la fiche, et jamais comme une catégorie inventée. */
function lireDemande(query, moteurs) {
  const analyse = query ? moteurs.COMPRENDRE.analyser(String(query)) : null;
  const reste = analyse && analyse.reste ? String(analyse.reste) : "";
  const mots = reste.split(/[^a-z0-9àâçéèêëîïôûùüÿñæœ-]+/i)
    .map((m) => moteurs.CORE.normalizeText(m)).filter((m) => m.length >= 3);
  /* La famille de la demande, vue par la taxonomie ouverte : « brocante » et
     « vide-grenier » tombent tous deux dans `vente_occasion`, qui est aussi la
     famille d'une « Grande Braderie d'Automne ». Sans cette étape, une demande
     de brocante ne trouve jamais une braderie — mesuré sur l'événement réel du
     26/09/2026 à Tissel. */
  /* La famille se déduit de CE QUI RESTE, pas de la phrase entière. La
     différence n'est pas théorique : « concert rap » laisse « rap », qui ne
     désigne aucune famille — et c'est la bonne réponse, parce que « rap » est
     justement le mot qui discrimine. Déduire la famille de la phrase entière
     donnait `projection_spectacle`, donc deux expositions en réponse à une
     demande de concerts de rap. Mesuré sur les lignes réelles du 25/09/2026. */
  const texteFamille = reste || String(query || "");
  let famille = null;
  if (texteFamille) {
    const rattachee = taxonomieOuverte.rattacher(texteFamille, "");
    famille = rattachee && rattachee.subcategory ? rattachee.subcategory : null;
  }
  return { analyse, mots, famille };
}

function texteDeFiche(ligne, moteurs) {
  return moteurs.CORE.normalizeText([ligne.title, ligne.description, ligne.category,
    ligne.event_kind, ligne.venue_name, ligne.place_name,
    ...(ligne.announcement_tags || []), ...(ligne.artist_names || []),
    ...(ligne.music_genres || [])].filter(Boolean).join(" "));
}

/* UN MOT N'EST PAS UNE SUITE DE LETTRES.

   LE DÉFAUT, MESURÉ EN PRODUCTION LE 25/09/2026. « Quels concerts rap cette
   semaine ? » a rendu trois résultats, dont « Eternelle Notre-Dame (de Paris)
   — Expérience en réalité virtuelle ». La recherche testait
   `texte.includes("rap")` : « rap » est dans « g-rap-hique », dans « thé-rap-ie
   », dans « -rap-ide ». Trois mots de description suffisaient à faire passer
   n'importe quoi pour un concert de rap.

   On compare donc des MOTS. Le texte est déjà normalisé en mots séparés par
   des espaces ; un mot de la demande doit être l'un d'eux. Le préfixe reste
   admis à partir de cinq lettres, pour que « brocante » trouve « brocantes »
   sans que « rap » trouve « rapide ». */
function motPresent(texte, mot) {
  if (!texte || !mot) return false;
  const mots = texte.split(" ");
  if (mots.includes(mot)) return true;
  return mot.length >= 5 && mots.some((autre) => autre.startsWith(mot));
}

function correspondALaDemande(ligne, demande, moteurs) {
  if (!demande.analyse) return { retenu: true, par: "aucun filtre" };
  const texte = texteDeFiche(ligne, moteurs);
  if (demande.mots.length && demande.mots.every((mot) => motPresent(texte, mot)))
    return { retenu: true, par: "mots de la demande" };
  if (demande.famille) {
    const fiche = taxonomieOuverte.rattacher(ligne.title,
      [ligne.description, ligne.event_kind, ligne.category].filter(Boolean).join(" "));
    if (fiche && fiche.subcategory === demande.famille)
      return { retenu: true, par: "famille « " + demande.famille + " » de la taxonomie Autour" };
  }
  /* LE PUBLIC VISÉ EST UNE DEMANDE, PAS UN MOT À CHERCHER. « Que faire en
     famille dimanche ? » ne contient aucun mot qu'un événement écrirait ; ce
     que la personne a dit, c'est POUR QUI. `comprendre.js` l'a déjà extrait
     (`groupe`), et les fiches le portent — dans `audience`, dans leurs tags
     d'annonce, ou dans la taxonomie ouverte qui range « fête de quartier » et
     « atelier » comme des sorties familiales. */
  if (demande.analyse && demande.analyse.groupe) {
    const groupe = moteurs.CORE.normalizeText(demande.analyse.groupe);
    const public_ = moteurs.CORE.normalizeText(ligne.audience || "");
    if (public_ && (public_.includes(groupe) ||
        (groupe === "famille" && /famille|enfant|tout public|jeune public/.test(public_))))
      return { retenu: true, par: "public visé (" + groupe + ")" };
    try {
      const correspondances = moteurs.ANNONCES_TAXONOMIE.correspondances(ligne, [groupe]);
      if (Array.isArray(correspondances) && correspondances.length)
        return { retenu: true, par: "intérêt « " + groupe + " » reconnu par Autour" };
    } catch (e) { /* le matcher refuse une fiche qu'il ne sait pas lire */ }
    const fiche = taxonomieOuverte.rattacher(ligne.title,
      [ligne.description, ligne.event_kind, ligne.category].filter(Boolean).join(" "));
    if (fiche && (fiche.audiences || []).includes(groupe))
      return { retenu: true, par: "public « " + groupe + " » de la taxonomie Autour" };
  }
  /* LES ÉTAPES SUIVANTES NE RATTRAPENT PAS UN MOT REFUSÉ. Quand la personne a
     écrit un terme précis que ni le texte ni la famille ne portent — « rap » —,
     élargir à la catégorie ou au public reviendrait à répondre à côté avec
     assurance. On préfère rendre moins. */
  if (demande.mots.length) return { retenu: false, par: null };
  const cats = (demande.analyse.categories || []).map((c) => moteurs.CORE.normalizeText(c));
  const categorie = moteurs.CORE.normalizeText(ligne.category || ligne.event_kind || "");
  if (cats.length && categorie && cats.includes(categorie))
    return { retenu: true, par: "catégorie d'Autour" };
  if (!cats.length) return { retenu: true, par: "demande sans critère" };
  return { retenu: false, par: null };
}

/* ========================================================================
   SEARCH_NOW
   ===================================================================== */
async function searchNow(args, contexte) {
  const moteurs = await moteursVerifies();
  const lieu = await resoudre(args);
  if (!lieu) return vide("location_inconnue", "Aucun lieu reconnu dans la demande.");
  const t = instant(args.time);
  if (!lieu.couvert) return horsZone(lieu);

  /* UNE LECTURE QUI ÉCHOUE N'EST PAS UN VIDE. « Il n'y a rien autour de toi »
     et « je n'ai pas pu regarder » sont deux réponses différentes, et
     `maintenant.js` les distingue depuis toujours (`panne` → état `error`).
     Confondre les deux ferait dire à ChatGPT qu'un quartier est mort parce
     qu'une lecture a échoué. */
  const pannes = [];
  const [evenements, lieux] = await Promise.all([
    base.evenements(lieu.zoneId, lieu.lat, lieu.lng).catch((e) => { pannes.push("evenements"); return []; }),
    base.lieux(lieu.zoneId, { lat: lieu.lat, lng: lieu.lng, rayonM: 3000, limite: 30 })
      .catch((e) => { pannes.push("lieux"); return []; }),
  ]);

  const items = [
    ...(evenements || []).filter((e) => !e.duplicate_of).map((e) => itemEvenement(e, t, moteurs)),
    ...(lieux || []).map((l) => itemLieu(l, t, moteurs)),
  ];

  /* LES INTÉRÊTS FILTRENT LE BASSIN, ILS NE CLASSENT PAS. Le matcher est celui
     de « Pour toi » (`annonces-taxonomie.js`) ; l'ordre reste celui de
     `maintenant.js`. Si aucun item ne correspond, on ne rend pas un écran vide
     pour cette raison : on garde le bassin complet et on le dit. */
  let bassin = items, noteInterets = null;
  const interets = (args.interests || []).map(String).filter(Boolean);
  if (interets.length) {
    const filtres = items.filter((item) => {
      try {
        const c = moteurs.ANNONCES_TAXONOMIE.correspondances(item.ligne || item, interets);
        return Array.isArray(c) ? c.length > 0 : !!c;
      } catch (e) { return false; }
    });
    if (filtres.length) bassin = filtres;
    else noteInterets = "Aucun résultat ne correspondait aux intérêts demandés : la sélection porte sur tout ce qui est possible maintenant.";
  }

  const position = [lieu.lat, lieu.lng];
  const selection = moteurs.MAINTENANT.selection(bassin, {
    maintenant: t, position, positionConnue: true, zoneTerritoriale: true,
    places: MAX_RESULTATS, chargement: false, panne: false,
  });

  const resultats = selection.map((item) => projeter(item, {
    moteurs, now: t, position, campagne: "search_now",
    contenu: item.estEvenement ? (item.ligne.event_kind || item.categorie) : item.categorie,
  }));

  const etat = moteurs.MAINTENANT.etat({
    resultats: resultats.length, positionConnue: true, positionEnCours: false,
    zoneTerritoriale: true, chargement: false, panne: pannes.length === 2,
  });

  await base.mesurer("search_now", lieu.zoneId);
  return {
    query: { tool: "search_now", location: lieu.nom, lat: lieu.lat, lng: lieu.lng,
      zone: lieu.zoneLabel, at: new Date(t).toISOString() },
    state: etat,
    results: resultats,
    notes: [noteInterets,
      pannes.length ? "Lecture Autour incomplète (" + pannes.join(", ") +
        ") : ne pas conclure qu'il n'y a rien." : null,
      etat === "empty" || etat === "error"
        ? moteurs.MAINTENANT.textes(etat, { positionConnue: true }).ligne : null].filter(Boolean),
    autour: lienGlobal("explorer", { ville: lieu.nom, lat: lieu.lat, lng: lieu.lng,
      campagne: "search_now" }),
  };
}

/* ========================================================================
   SEARCH_EVENTS
   ===================================================================== */
async function searchEvents(args, contexte) {
  const moteurs = await moteursVerifies();
  const lieu = await resoudre(args);
  if (!lieu) return vide("location_inconnue", "Aucun lieu reconnu dans la demande.");
  const t = instant(args.time);
  if (!lieu.couvert) return horsZone(lieu);

  const limite = borne(args.limit, MAX_RESULTATS, MAX_RESULTATS_ETENDU);
  const fenetre = fenetreDemandee(args.when, t, moteurs);
  const demande = lireDemande(args.query, moteurs);
  const lignes = (await base.evenements(lieu.zoneId, lieu.lat, lieu.lng, { limite: 120 })
    .catch(() => [])) || [];

  const refus = {};
  const retenus = [];
  for (const ligne of lignes) {
    if (ligne.duplicate_of) { refus.doublon = (refus.doublon || 0) + 1; continue; }
    if (ligne.cancelled) { refus.annule = (refus.annule || 0) + 1; continue; }
    if (!dansFenetre(ligne, fenetre, t, moteurs)) {
      refus.hors_fenetre = (refus.hors_fenetre || 0) + 1; continue;
    }
    const correspondance = correspondALaDemande(ligne, demande, moteurs);
    if (!correspondance.retenu) { refus.hors_demande = (refus.hors_demande || 0) + 1; continue; }
    retenus.push({ ligne, par: correspondance.par });
  }

  /* L'ordre est celui du calendrier — ce qui vient d'abord, d'abord —, puis la
     distance à égalité de date. Aucun score ne s'ajoute : une liste datée se
     lit dans l'ordre du temps. */
  const position = [lieu.lat, lieu.lng];
  retenus.sort((a, b) => {
    const da = moteurs.TEMPS.toEpochInZone(a.ligne.start_at, a.ligne.timezone);
    const db = moteurs.TEMPS.toEpochInZone(b.ligne.start_at, b.ligne.timezone);
    return (da - db) ||
      ((distanceDe(moteurs, position, a.ligne) || 0) - (distanceDe(moteurs, position, b.ligne) || 0));
  });

  const items = retenus.map((r) => itemEvenement(r.ligne, t, moteurs));
  const varies = moteurs.CORE.diversifierResultats(items, { fenetre: limite }) || items;
  const choisis = varies.slice(0, limite);

  /* Les séances ne sont demandées que pour ce qui est rendu : trois lectures
     au plus, jamais cent vingt. */
  const seances = await Promise.all(choisis.map((item) =>
    base.seances(item.dbId, 12).catch(() => null)));

  const resultats = choisis.map((item, i) => projeter(item, {
    moteurs, now: t, position, campagne: "search_events",
    contenu: item.ligne.event_kind || item.categorie,
    seances: seances[i],
  }));

  await base.mesurer("search_events", lieu.zoneId);
  if (demande.analyse && demande.mots.length)
    await base.mesurer("recherche:" + demande.mots.slice(0, 2).join("-"), lieu.zoneId);

  return {
    query: { tool: "search_events", location: lieu.nom, lat: lieu.lat, lng: lieu.lng,
      zone: lieu.zoneLabel, when: fenetre.libelle, text: args.query || null,
      at: new Date(t).toISOString() },
    window: { start: new Date(fenetre.debut).toISOString(),
      end: fenetre.fin == null ? null : new Date(fenetre.fin).toISOString() },
    results: resultats,
    total_matching: retenus.length,
    notes: notesDeRefus(refus, retenus.length, fenetre),
    autour: lienGlobal("explorer", {
      q: [args.query, lieu.nom].filter(Boolean).join(" ") || null,
      ville: lieu.nom, quand: fenetre.libelle, lat: lieu.lat, lng: lieu.lng,
      campagne: "search_events", contenu: demande.mots[0] || null,
    }),
  };
}

/* ========================================================================
   SEARCH_NEARBY
   ===================================================================== */
async function searchNearby(args, contexte) {
  const moteurs = await moteursVerifies();
  const lieu = await resoudre(args);
  if (!lieu) return vide("location_inconnue", "Aucun lieu reconnu dans la demande.");
  const t = instant(args.time);
  if (!lieu.couvert) return horsZone(lieu);

  const limite = borne(args.limit, MAX_RESULTATS, MAX_RESULTATS_ETENDU);
  const rayon = Math.min(20000, Math.max(300, Number(args.radius) || 3000));
  const demande = lireDemande(args.query, moteurs);
  const familles = famillesDemandees(demande, moteurs);

  const lignes = (await base.lieux(lieu.zoneId, {
    famille: familles.length === 1 ? familles[0] : null,
    lat: lieu.lat, lng: lieu.lng, rayonM: rayon, limite: 40,
  }).catch(() => [])) || [];

  const position = [lieu.lat, lieu.lng];
  const items = lignes
    .filter((l) => !familles.length || familles.includes(l.family))
    .filter((l) => {
      if (!demande.mots.length) return true;
      const texte = moteurs.CORE.normalizeText([l.name, l.description, l.famille_label,
        l.family].filter(Boolean).join(" "));
      return demande.mots.every((mot) => motPresent(texte, mot));
    })
    .map((l) => itemLieu(l, t, moteurs));

  /* « Ouvert » est une demande fréquente et une information dont on dispose :
     `availability.js` a déjà tranché, on se contente de filtrer ce qu'il a dit. */
  const veutOuvert = /ouvert|open/i.test(String(args.query || "")) ||
    args.open_now === true;
  const filtres = veutOuvert ? items.filter((i) => i.ouvert === true) : items;
  const varies = moteurs.CORE.diversifierResultats(filtres, { fenetre: limite }) || filtres;
  const resultats = varies.slice(0, limite).map((item) => projeter(item, {
    moteurs, now: t, position, campagne: "search_nearby", contenu: item.ligne.family,
  }));

  await base.mesurer("search_nearby", lieu.zoneId);
  return {
    query: { tool: "search_nearby", location: lieu.nom, lat: lieu.lat, lng: lieu.lng,
      zone: lieu.zoneLabel, text: args.query || null, radius_m: rayon,
      families: familles.length ? familles : null },
    results: resultats,
    total_matching: filtres.length,
    notes: filtres.length === 0
      ? ["Aucun lieu de l'inventaire Autour ne correspond à cette demande dans ce rayon."]
      : (veutOuvert && items.length > filtres.length
        ? [String(items.length - filtres.length) + " lieu(x) correspondant(s) sont écartés : horaires inconnus ou fermés à cette heure."]
        : []),
    autour: lienGlobal("explorer", { q: args.query || null, ville: lieu.nom,
      lat: lieu.lat, lng: lieu.lng, campagne: "search_nearby", contenu: familles[0] || null }),
  };
}

/* Les familles visées par une demande, dans l'ordre de certitude : le mot
   exact d'une famille, puis la famille d'événement qui désigne le même endroit,
   puis les catégories qu'a reconnues `comprendre.js`. Aucune n'est devinée :
   toutes viennent d'une table du produit. */
function famillesDemandees(demande, moteurs) {
  const trouvees = [];
  for (const mot of demande.mots) {
    const direct = FAMILLES_INVENTAIRE.find((famille) => famille === mot ||
      moteurs.CORE.normalizeText(famille) === mot);
    if (direct) trouvees.push(direct);
  }
  if (demande.famille && FAMILLE_PAR_SOUS_CATEGORIE[demande.famille])
    trouvees.push(FAMILLE_PAR_SOUS_CATEGORIE[demande.famille]);
  for (const cat of (demande.analyse && demande.analyse.categories) || []) {
    const famille = FAMILLE_PAR_CAT[moteurs.CORE.normalizeText(cat).replace(/ /g, "_")];
    if (famille) trouvees.push(famille);
  }
  return [...new Set(trouvees)];
}

/* ========================================================================
   SEARCH_HELP — LA DOCTRINE, APPLIQUÉE
   ===================================================================== */
function besoinDemande(besoin, moteurs) {
  const brut = String(besoin || "").trim().toLowerCase();
  if (!brut) return null;
  const direct = (moteurs.AIDE.BESOINS || []).find((b) => b.id === brut);
  if (direct) return direct.id;
  if (ALIAS_BESOIN[brut]) return ALIAS_BESOIN[brut];
  /* Une phrase entière — « je cherche un foyer ou un hébergement » — passe par
     le détecteur d'Autour, pas par une liste de mots-clés d'ici. */
  const detectes = moteurs.AIDE.besoinsDepuisPhrase(brut) || [];
  const premier = detectes[0];
  return premier ? (premier.id || premier) : null;
}

async function structuresDuReferentiel(lieu, moteurs, rayon) {
  const items = await base.aideStructures(lieu.lat, lieu.lng,
    { source: "dora", rayonM: rayon, limite: 60 }).catch(() => []);
  return (items || []).map((record) => {
    try { return moteurs.PROVIDERS.aideDora.normaliser(record); } catch (e) { return null; }
  }).filter(Boolean);
}

async function searchHelp(args, contexte) {
  const moteurs = await moteursVerifies();
  const lieu = await resoudre(args);
  if (!lieu) return vide("location_inconnue", "Aucun lieu reconnu dans la demande.");
  const t = instant(args.time);
  const besoin = besoinDemande(args.need, moteurs);
  if (!besoin) return vide("besoin_inconnu",
    "Le besoin n'est pas reconnu. Besoins servis : " +
    (moteurs.AIDE.BESOINS || []).map((b) => b.id).join(", ") + ".");

  const limite = borne(args.limit, MAX_RESULTATS, MAX_RESULTATS_ETENDU);
  const rayon = Math.min(20000, Math.max(1000, Number(args.radius) || 6000));

  const [lignes, couvertureBrute, referentiel] = await Promise.all([
    base.pointsDeService(lieu.lat, lieu.lng, { rayonM: rayon, limite: 80 }).catch(() => []),
    base.couverture(lieu.nom, categorieDeCouverture(besoin)).catch(() => []),
    structuresDuReferentiel(lieu, moteurs, rayon),
  ]);

  /* Deux gisements, un seul contrat : la découverte locale vérifiée
     (`local_discovery_nearby`) et le référentiel data·inclusion précalculé.
     Les deux passent par leur provider, qui traduit vers `AideStructure` — et
     c'est la taxonomie d'Autour, pas ce fichier, qui dit si un service répond
     au besoin. */
  const decouvertes = (lignes || []).map((ligne) => {
    try {
      const structure = moteurs.PROVIDERS.aideDecouverte.normaliser(ligne);
      return structure ? Object.assign(structure, { ligneId: ligne.id, ligneDistance: ligne.distance_m,
        ligneStatut: ligne.verification_status }) : null;
    } catch (e) { return null; }
  }).filter(Boolean);

  const candidates = [...decouvertes, ...referentiel];

  const AIDE = moteurs.AIDE, STRUCTURES = moteurs.AIDE_STRUCTURES,
    CLASSEMENT = moteurs.AIDE_CLASSEMENT;
  const refus = {};
  const retenues = [];
  for (const structure of candidates) {
    const distance = STRUCTURES.distanceM({ lat: lieu.lat, lng: lieu.lng },
      { lat: structure.lat, lng: structure.lng });
    if (!Number.isFinite(distance) || distance > rayon) {
      refus.hors_rayon = (refus.hors_rayon || 0) + 1; continue;
    }
    if (!AIDE.estSolution(structure, [besoin])) {
      refus.service_non_prouve = (refus.service_non_prouve || 0) + 1; continue;
    }
    if (!STRUCTURES.fiable(structure, [besoin])) {
      refus.preuve_insuffisante = (refus.preuve_insuffisante || 0) + 1; continue;
    }
    if (structure.trustLevel === "unknown") {
      refus.confiance_inconnue = (refus.confiance_inconnue || 0) + 1; continue;
    }
    const capacites = CLASSEMENT.capacites(structure);
    const enrichie = Object.assign({}, structure, {
      capacitesAide: capacites.capacites, confianceAide: capacites.confiance,
      verdictAide: { confiance: capacites.confiance,
        certaine: Object.keys(capacites.detail || {})
          .some((k) => capacites.detail[k].accorde && capacites.detail[k].certaine) },
    });
    const pertinence = AIDE.pertinence(enrichie, besoin, { large: true });
    retenues.push({ structure: enrichie, distance, pertinence });
  }

  /* L'ordre de Solidarité : la pertinence du besoin passe devant tout, puis le
     comparateur d'`aide-classement.js` — urgence, accessibilité, minutes de
     trajet, fraîcheur. Ce sont les mêmes deux étages que l'écran ; la couche
     `rankResults` d'`app.js`, qui dépend de l'interface, n'a pas d'équivalent
     ici et n'en a pas besoin : elle départage, elle ne décide pas du fond. */
  retenues.sort((a, b) =>
    (b.pertinence.poids - a.pertinence.poids) ||
    CLASSEMENT.comparer(a.structure, b.structure) ||
    (a.distance - b.distance));

  const couverture = projeterCouverture(couvertureBrute, besoin);

  /* UN CANDIDAT NE SORT PAS. Le chantier est explicite : « un candidat non
     vérifié ne doit jamais être présenté comme une information certaine ». Le
     plus sûr n'est pas de le nuancer dans le texte — une conversation résume,
     et la nuance est ce qui se perd —, c'est de ne pas le rendre. Il est
     compté dans les notes : « trois points trouvés mais non vérifiés » est une
     information honnête, et elle dit à quoi sert Autour ensuite. */
  const verifiees = retenues.filter(({ structure }) => {
    const statut = String(structure.verificationStatus || "").toLowerCase();
    if (statut === "candidate" || statut === "uncertain" || statut === "rejected") return false;
    return statut === "verified" || statut === "probable" || structure.trustLevel === "verified_help";
  });
  const ecartesNonVerifies = retenues.length - verifiees.length;

  const resultats = verifiees.slice(0, limite).map(({ structure, distance }) =>
    projection.projeterPointDeService(structure, {
      besoin, distance, moteurs, couverture,
      deepLink: structure.ligneId
        ? liens.lienLieu(structure.ligneId, { titre: structure.name, lat: structure.lat,
            lng: structure.lng, campagne: "search_help", contenu: besoin })
        : liens.lienSolidarite({ besoin, ville: lieu.nom, lat: structure.lat, lng: structure.lng,
            campagne: "search_help", contenu: besoin }),
      cta: liens.CTA.solidarite,
    }));

  const candidatsNonRetenus = Math.max(ecartesNonVerifies, decouvertes.filter((s) =>
    String(s.ligneStatut || "").toLowerCase() === "candidate" &&
    AIDE.estSolution(s, [besoin])).length);

  await base.mesurer("search_help", lieu.zoneId);
  await base.mesurer("besoin:" + besoin, lieu.zoneId);

  return {
    query: { tool: "search_help", location: lieu.nom, lat: lieu.lat, lng: lieu.lng,
      zone: lieu.zoneLabel, need: besoin, radius_m: rayon, at: new Date(t).toISOString() },
    doctrine: "Chaque résultat est un POINT DE SERVICE — un endroit où l'on est reçu. " +
      "L'organisation n'est citée que comme provenance de la vérification, et deux points " +
      "d'une même organisation ne sont jamais fusionnés.",
    results: resultats,
    total_matching: verifiees.length,
    total_found_including_unverified: retenues.length,
    coverage: couverture,
    notes: notesAide(refus, verifiees.length, candidatsNonRetenus, couverture, lieu),
    autour: lienGlobal("solidarite", { besoin, ville: lieu.nom, lat: lieu.lat, lng: lieu.lng,
      campagne: "search_help", contenu: besoin }),
  };
}

function categorieDeCouverture(besoin) {
  /* `local_coverage` est indexée par la catégorie de la découverte, en anglais.
     Le pont est celui de la découverte elle-même, pas une invention d'ici. */
  const table = { manger: "food", logement: "housing", sante: "health", papiers: "admin",
    vetements: "clothing", hygiene: "hygiene", travail: "employment", jeunes: "students",
    parler: "listening" };
  return table[besoin] || null;
}

function projeterCouverture(rows, besoin) {
  const ligne = (rows || [])[0];
  if (!ligne) return { status: "unknown",
    note: "Autour n'a pas encore mesuré sa couverture ici : la liste peut être incomplète." };
  const statut = String(ligne.coverage_status || "unknown");
  return {
    status: statut,
    known: ligne.known_count == null ? null : Number(ligne.known_count),
    verified: ligne.verified_count == null ? null : Number(ligne.verified_count),
    last_checked: ligne.last_checked_at || null,
    note: statut === "incomplete"
      ? "Autour sait que sa couverture est incomplète pour ce besoin ici : d'autres points de service existent probablement et ne sont pas encore vérifiés."
      : statut === "unknown"
        ? "La dernière vérification a échoué : la liste peut être incomplète."
        : null,
  };
}

function notesAide(refus, retenues, candidats, couverture, lieu) {
  const notes = [];
  if (!retenues) notes.push("Aucun point de service vérifié pour ce besoin dans ce rayon à " +
    (lieu.nom || "cet endroit") + ".");
  if (candidats) notes.push(String(candidats) +
    " point(s) de service trouvé(s) mais NON vérifié(s) ne sont pas rendus : Autour ne les présente pas comme certains.");
  if (refus.hors_rayon) notes.push(String(refus.hors_rayon) +
    " structure(s) sont écartées par le rayon demandé.");
  if (couverture && couverture.note) notes.push(couverture.note);
  return notes;
}

function notesDeRefus(refus, retenus, fenetre) {
  const notes = [];
  if (!retenus) notes.push("Aucun événement de l'inventaire Autour ne correspond à cette demande " +
    (fenetre.libelle ? "pour « " + fenetre.libelle + " »" : "") + ".");
  if (refus.annule) notes.push(String(refus.annule) + " événement(s) annulé(s) sont écartés.");
  return notes;
}

/* ========================================================================
   GET_EVENT / GET_PLACE
   ===================================================================== */
async function getEvent(args) {
  const moteurs = await moteursVerifies();
  const id = String(args.id || "").trim();
  if (!id) return vide("id_absent", "Un identifiant d'événement est requis.");
  const ligne = await base.evenement(id);
  if (!ligne) return vide("introuvable", "Aucun événement Autour ne porte cet identifiant.");
  const t = instant(args.time);
  const item = itemEvenement(ligne, t, moteurs);
  const seances = await base.seances(id, 12).catch(() => null);
  const position = Number.isFinite(Number(args.lat)) && Number.isFinite(Number(args.lng))
    ? [Number(args.lat), Number(args.lng)] : null;
  await base.mesurer("get_event", ligne.zone_id);
  return {
    query: { tool: "get_event", id },
    result: projeter(item, { moteurs, now: t, position, campagne: "get_event",
      contenu: ligne.event_kind || item.categorie, seances }),
  };
}

async function getPlace(args) {
  const moteurs = await moteursVerifies();
  const id = String(args.id || "").trim();
  if (!id) return vide("id_absent", "Un identifiant de lieu est requis.");
  const ligne = await base.lieu(id);
  if (!ligne) return vide("introuvable", "Aucun lieu Autour ne porte cet identifiant.");
  const t = instant(args.time);
  const item = itemLieu(ligne, t, moteurs);
  const position = Number.isFinite(Number(args.lat)) && Number.isFinite(Number(args.lng))
    ? [Number(args.lat), Number(args.lng)] : null;
  const resultat = projeter(item, { moteurs, now: t, position, campagne: "get_place",
    contenu: ligne.family });

  /* Le téléphone et les services d'un point de service ne vivent pas dans
     `places` : ils viennent de la découverte, par la même fonction publique que
     Solidarité. On ne les invente pas, et on ne les cherche que si le lieu est
     à la bonne place. */
  if (Number.isFinite(Number(ligne.lat)) && Number.isFinite(Number(ligne.lng))) {
    const proches = await base.pointsDeService(Number(ligne.lat), Number(ligne.lng),
      { rayonM: 150, limite: 10 }).catch(() => []);
    const point = (proches || []).find((p) => String(p.id) === String(ligne.id));
    if (point) {
      resultat.phone = point.phone || null;
      resultat.services = Array.isArray(point.service_categories)
        ? point.service_categories.slice(0, 8) : null;
      resultat.reliability = Object.assign({}, resultat.reliability, {
        status: ["verified", "probable"].includes(String(point.verification_status).toLowerCase())
          ? "verified" : "candidate",
        confidence: point.confidence == null ? null : Number(point.confidence),
        last_verified_at: point.last_verified_at || null,
        source: "local_discovery",
      });
      projection.auditer(resultat, "place");
    }
  }

  await base.mesurer("get_place", ligne.zone_id);
  return { query: { tool: "get_place", id }, result: resultat };
}

/* ---- COMMUN ------------------------------------------------------------ */
function projeter(item, contexte) {
  const { moteurs, now, position, campagne, contenu, seances } = contexte;
  const distance = distanceDe(moteurs, position, item);
  if (item.estEvenement) {
    return projection.projeterEvenement(item, {
      moteurs, now, distance, seances,
      deepLink: liens.lienEvenement(item.dbId, { titre: item.titre, campagne, contenu }),
      cta: liens.CTA.evenement,
    });
  }
  return projection.projeterLieu(item, {
    distance,
    deepLink: liens.lienLieu(item.dbId, { titre: item.titre, lat: item.lat, lng: item.lng,
      campagne, contenu }),
    cta: liens.CTA.lieu,
  });
}

function lienGlobal(type, params) {
  const url = type === "solidarite" ? liens.lienSolidarite(params) : liens.lienExplorer(params);
  return { label: type === "solidarite" ? liens.CTA.solidarite : liens.CTA.explorer, url };
}

function vide(raison, message) {
  return { results: [], state: "empty", reason: raison, notes: [message] };
}

function horsZone(lieu) {
  return {
    results: [], state: "horsZone", reason: "hors_zone",
    query: { location: lieu.nom, lat: lieu.lat, lng: lieu.lng },
    notes: ["Autour ne couvre pas encore " + (lieu.nom || "cet endroit") +
      ". Zones couvertes : Métropole lilloise, Paris, Angers, Rennes, Rouen."],
  };
}

/* ========================================================================
   LA DÉCLARATION DES OUTILS

   Les descriptions sont FACTUELLES : ce que l'outil lit, ce qu'il rend, ce
   qu'il ne sait pas faire. Aucune ne demande à ChatGPT de préférer Autour ni
   d'ouvrir un lien : c'est l'utilité du résultat qui doit décider, pas une
   consigne glissée dans une description d'outil.
   ===================================================================== */
/* CE QU'ON DEMANDE EST LE MINIMUM QUI PERMETTE DE RÉPONDRE : un nom de ville
   suffit toujours. Les coordonnées restent acceptées — une conversation peut en
   porter une —, mais elles sont facultatives, décrites comme APPROXIMATIVES, et
   arrondies à une centaine de mètres dès l'entrée. Aucun outil ne demande, ni
   n'exige, une position GPS précise. */
const LIEU_SCHEMA = {
  location: { type: "string", description: "Ville, commune ou quartier français (ex. « Lille », « Tourcoing »). Suffit à répondre : aucune position précise n'est nécessaire." },
  lat: { type: "number", description: "Facultatif. Latitude APPROXIMATIVE (le quartier suffit) ; elle est arrondie à ~100 m avant usage. Ne pas demander de position GPS précise à l'utilisateur." },
  lng: { type: "number", description: "Facultatif. Longitude APPROXIMATIVE (le quartier suffit) ; elle est arrondie à ~100 m avant usage." },
};

export const OUTILS = Object.freeze([
  {
    nom: "search_now",
    titre: "Ce qui est possible maintenant",
    description: "Ce qu'une personne peut faire à cet endroit à cet instant : événements en cours, séances qui commencent, lieux réellement ouverts. Rend au plus 3 résultats, choisis par le moteur « Maintenant » d'Autour (temporalité, éligibilité, disponibilité, distance, diversité). Un lieu dont les horaires sont inconnus n'est jamais présenté comme ouvert.",
    invocation: { avant: "Je regarde ce qui se passe autour…", apres: "Voici ce qui est possible maintenant" },
    schema: {
      type: "object",
      properties: Object.assign({}, LIEU_SCHEMA, {
        time: { type: "string", description: "Instant d'évaluation (ISO 8601). Par défaut : maintenant." },
        interests: { type: "array", items: { type: "string" },
          description: "Centres d'intérêt (ex. « rap », « famille », « expo »). Filtrent le bassin avec le matcher d'Autour ; n'inventent aucun classement." },
      }),
    },
    executer: searchNow,
  },
  {
    nom: "search_events",
    titre: "Événements datés",
    description: "Événements de l'inventaire Autour dans une fenêtre de temps : ce soir, aujourd'hui, demain, un jour nommé, ce week-end, cette semaine. Accepte une demande en langage naturel (« brocante », « concert rap », « marché »). Les séances multiples sont rendues séparément, jamais fusionnées en une plage. Rend 3 résultats par défaut, 5 au plus.",
    invocation: { avant: "Je cherche dans l'agenda d'Autour…", apres: "Voici ce que j'ai trouvé" },
    schema: {
      type: "object",
      properties: Object.assign({}, LIEU_SCHEMA, {
        query: { type: "string", description: "Ce que la personne cherche, dans ses mots." },
        when: { type: "string", description: "Fenêtre : now, aujourd'hui, ce soir, demain, un jour de la semaine, ce week-end, cette semaine, une date ISO. Par défaut : à venir." },
        limit: { type: "integer", description: "Nombre de résultats, 1 à 5 (3 par défaut)." },
        time: { type: "string", description: "Instant de référence (ISO 8601)." },
      }),
    },
    executer: searchEvents,
  },
  {
    nom: "search_nearby",
    titre: "Lieux autour d'un point",
    description: "Lieux de l'inventaire Autour autour d'une position : parcs, bibliothèques, cinémas, marchés, patrimoine, équipements sportifs, commerces, associations. Rend l'état d'ouverture tel qu'Autour le connaît — « horaires inconnus » est rendu comme tel. Ne déclenche aucune recherche Web.",
    invocation: { avant: "Je regarde l'inventaire des lieux…", apres: "Voici les lieux trouvés" },
    schema: {
      type: "object",
      properties: Object.assign({}, LIEU_SCHEMA, {
        query: { type: "string", description: "Ce que la personne cherche (ex. « skatepark », « marché », « restaurant ouvert »)." },
        radius: { type: "integer", description: "Rayon en mètres (300 à 20000, 3000 par défaut)." },
        limit: { type: "integer", description: "Nombre de résultats, 1 à 5 (3 par défaut)." },
        open_now: { type: "boolean", description: "Ne garder que ce qu'Autour sait ouvert à cet instant." },
      }),
    },
    executer: searchNearby,
  },
  {
    nom: "search_help",
    titre: "Aides locales — points de service",
    description: "Points de service d'aide locale vérifiés par Autour : aide alimentaire, hébergement, santé, démarches administratives, vêtements, hygiène, emploi, jeunes, écoute. Rend un ENDROIT OÙ L'ON EST REÇU (nom du point, adresse, service, horaires, distance, téléphone public), pas une organisation juridique. Une organisation peut avoir plusieurs points de service : ils ne sont jamais fusionnés. Les points non vérifiés ne sont pas rendus, et l'état de couverture d'Autour est indiqué.",
    invocation: { avant: "Je cherche les points de service vérifiés…", apres: "Voici les points de service trouvés" },
    schema: {
      type: "object",
      properties: Object.assign({}, LIEU_SCHEMA, {
        need: { type: "string", description: "Besoin : manger/food, logement/housing, sante/health, papiers/admin, vetements/clothing, hygiene, travail/work, jeunes/student_help, parler/listening, famille, securite, mobilite — ou la phrase de la personne." },
        radius: { type: "integer", description: "Rayon en mètres (1000 à 20000, 6000 par défaut)." },
        limit: { type: "integer", description: "Nombre de résultats, 1 à 5 (3 par défaut)." },
        time: { type: "string", description: "Instant de référence (ISO 8601)." },
      }),
      required: ["need"],
    },
    executer: searchHelp,
  },
  {
    nom: "get_event",
    titre: "Fiche d'un événement",
    description: "Fiche détaillée d'un événement déjà identifié : description, dates, séances séparées, lieu, adresse, prix, réservation, image et provenance. Utilise l'identifiant rendu par search_now ou search_events.",
    invocation: { avant: "J'ouvre la fiche…", apres: "Voici la fiche" },
    schema: {
      type: "object",
      properties: { id: { type: "string", description: "Identifiant de l'événement Autour." },
        lat: LIEU_SCHEMA.lat, lng: LIEU_SCHEMA.lng,
        time: { type: "string", description: "Instant de référence (ISO 8601)." } },
      required: ["id"],
    },
    executer: getEvent,
  },
  {
    nom: "get_place",
    titre: "Fiche d'un lieu",
    description: "Fiche détaillée d'un lieu déjà identifié : description, adresse, horaires et état d'ouverture, image, site officiel. Si le lieu est un point de service vérifié, rend aussi son téléphone public et ses services. Utilise l'identifiant rendu par search_nearby, search_now ou search_help.",
    invocation: { avant: "J'ouvre la fiche du lieu…", apres: "Voici la fiche" },
    schema: {
      type: "object",
      properties: { id: { type: "string", description: "Identifiant ou slug du lieu Autour." },
        lat: LIEU_SCHEMA.lat, lng: LIEU_SCHEMA.lng,
        time: { type: "string", description: "Instant de référence (ISO 8601)." } },
      required: ["id"],
    },
    executer: getPlace,
  },
]);

export const PAR_NOM = Object.freeze(Object.fromEntries(OUTILS.map((o) => [o.nom, o])));
export { ALIAS_BESOIN, FAMILLE_PAR_CAT, MAX_RESULTATS };
