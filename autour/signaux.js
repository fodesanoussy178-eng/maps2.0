(function (root) {
  "use strict";

  /* ===================================================================
     Les caractéristiques d'un lieu, distinctes de ses catégories

     Une catégorie dit ce qu'un lieu EST (un café, un parc). Un signal dit ce
     qu'on peut y FAIRE ou ce qu'on y trouve (y travailler, s'y poser dehors,
     y avoir du wifi). Les deux sont indépendants : un café peut être un bon
     endroit pour travailler ou le pire de la ville, et sa catégorie ne le
     dira jamais.

     Règle qui prime sur toutes les autres : **on n'invente pas**. Un signal
     n'est produit que si une donnée réelle le porte. Un lieu sans information
     n'a pas le signal à 0 — il ne l'a pas du tout, ce qui n'est pas la même
     chose. Le classement traite l'absence comme une inconnue, jamais comme un
     refus ; c'est ce qui évite d'écarter les trois quarts d'OpenStreetMap
     parce que personne n'y a renseigné `internet_access`.

     Chaque signal porte sa PROVENANCE :
       · `tag`       — une donnée explicite (OSM, Google). Fiable.
       · `categorie` — une inférence assumée depuis le type de lieu. Une
                       bibliothèque est un endroit calme : ce n'est pas une
                       supposition hasardeuse, c'est la définition.
       · `prix`      — dérivé du niveau de prix connu.
     Une inférence de catégorie ne dépasse jamais 0,75 : elle ne doit pas
     peser autant qu'une donnée publiée.
     =================================================================== */

  const SOURCES = Object.freeze({ TAG: "tag", CATEGORIE: "categorie", PRIX: "prix" });
  const PLAFOND_INFERENCE = 0.75;

  /* ---- Ce que les tags disent explicitement ------------------------------
     Uniquement des tags dont la signification est définie, pas devinée. */
  const PAR_TAG = [
    // wifi : seul `internet_access` en parle. Aucune catégorie ne permet de
    // l'affirmer — un café n'a pas « forcément » du wifi.
    ["internet_access", (v) => (/^(wlan|yes|wifi|terminal)$/.test(v) ? { wifi: 1 } : null)],
    ["internet_access:fee", (v) => (v === "no" ? { wifi: .9 } : null)],
    ["wheelchair", (v) => (v === "yes" ? { accessible: 1 }
      : v === "limited" ? { accessible: .5 } : null)],
    ["outdoor_seating", (v) => (v === "yes" ? { dehors: 1 } : null)],
    ["indoor_seating", (v) => (v === "yes" ? { interieur: .9 } : null)],
    ["fee", (v) => (v === "no" ? { gratuit: .9 } : null)],
    ["access", (v) => (/^(yes|public|permissive)$/.test(v) ? { gratuit: .5 } : null)],
    ["quiet_hours", () => ({ calme: .8 })],
    ["laptop_friendly", (v) => (v === "yes" ? { travail: 1 } : null)],
    ["power_supply", (v) => (v === "yes" ? { travail: .7 } : null)],
    ["socket", (v) => (v === "yes" ? { travail: .6 } : null)],
    ["study_room", (v) => (v === "yes" ? { etude: 1, calme: .8 } : null)],
    ["dance", (v) => (v === "yes" ? { festif: .9 } : null)],
    ["dancing", (v) => (v === "yes" ? { festif: .9 } : null)],
    ["live_music", (v) => (v === "yes" ? { festif: .8 } : null)],
    ["playground", (v) => (v === "yes" ? { famille: .9 } : null)],
    ["baby_feeding", () => ({ famille: .8 })],
    ["changing_table", (v) => (v === "yes" ? { famille: .8 } : null)],
    ["max_age", () => ({ famille: .7 })],
    ["min_age", () => ({ famille: .5 })],
    ["reservation", (v) => (v === "required" ? { adapte_solo: .3 } : null)],
  ];

  /* ---- Ce que la catégorie permet d'affirmer -----------------------------
     Inférences explicites, plafonnées, et argumentables une par une. */
  const PAR_CATEGORIE = Object.freeze({
    biblio:     { calme: .75, etude: .75, travail: .7, interieur: .7, gratuit: .7, adapte_solo: .7 },
    coworking:  { travail: .75, etude: .6, calme: .6, interieur: .7, adapte_solo: .6 },
    musee:      { calme: .65, interieur: .7, famille: .5, adapte_solo: .6, interieur_: 0 },
    parc:       { dehors: .75, calme: .5, famille: .7, gratuit: .7, adapte_groupes: .6 },
    terrain:    { dehors: .75, adapte_groupes: .7, famille: .5, gratuit: .6 },
    sport:      { adapte_groupes: .6, dehors: .4 },
    /* La catégorie « café » couvre ici les boulangeries et salons de thé :
       en faire un lieu de travail à 0,45 suffisait à placer une boulangerie
       devant une bibliothèque. L'inférence reste, faible ; ce sont les tags
       (`power_supply`, `internet_access`, `laptop_friendly`) qui tranchent. */
    cafe:       { travail: .3, calme: .35, interieur: .6, adapte_solo: .6 },
    bar:        { festif: .6, adapte_groupes: .7, interieur: .6 },
    concert:    { festif: .75, adapte_groupes: .7 },
    spectacle:  { interieur: .6, adapte_groupes: .5 },
    cinema:     { interieur: .7, famille: .6, romantique: .5, adapte_solo: .5 },
    resto:      { interieur: .55, adapte_groupes: .5 },
    fastfood:   { interieur: .4, pas_cher: .6 },
    marche:     { dehors: .6, famille: .4 },
    friperie:   { interieur: .5, pas_cher: .5 },
    toilettes:  { gratuit: .5 },
    playground: { famille: .75, dehors: .75, gratuit: .7 },
  });

  /* Les catégories transverses du moteur de classification (parc → `park`,
     bibliothèque → `library`…) : même logique, mêmes plafonds. */
  const PAR_CATEGORIE_TRANSVERSE = Object.freeze({
    library:    { calme: .7, etude: .7, travail: .65, gratuit: .65 },
    park:       { dehors: .75, calme: .5, famille: .65, gratuit: .7 },
    study:      { etude: .7, travail: .65, calme: .6 },
    family:     { famille: .7 },
    kids_event: { famille: .75 },
    culture:    { interieur: .5 },
    outing:     { adapte_groupes: .5 },
  });

  function fusionner(cible, ajouts, source) {
    if (!ajouts) return;
    Object.entries(ajouts).forEach(([signal, valeur]) => {
      if (!Number.isFinite(valeur) || valeur <= 0) return;
      const v = source === SOURCES.CATEGORIE ? Math.min(valeur, PLAFOND_INFERENCE) : valeur;
      const connu = cible[signal];
      // une donnée publiée l'emporte toujours sur une inférence
      if (!connu || v > connu.valeur || (connu.source === SOURCES.CATEGORIE && source === SOURCES.TAG))
        cible[signal] = { valeur: source === SOURCES.TAG ? valeur : v, source };
    });
  }

  /* ---- Le calcul ---------------------------------------------------------
     Retourne `{ signal: {valeur, source} }`. Un signal absent est ABSENT :
     il ne figure pas dans l'objet. */
  function signauxDe(lieu) {
    const l = lieu || {};
    const tags = l.tags || {};
    const out = {};

    // 1. les tags, d'abord : ce sont les seules affirmations
    PAR_TAG.forEach(([cle, lire]) => {
      const v = tags[cle];
      if (v == null) return;
      fusionner(out, lire(String(v).toLowerCase()), SOURCES.TAG);
    });

    // 2. les catégories, ensuite : des inférences assumées et plafonnées
    fusionner(out, PAR_CATEGORIE[l.cat], SOURCES.CATEGORIE);
    (l.categories || []).forEach((c) => {
      fusionner(out, PAR_CATEGORIE[c], SOURCES.CATEGORIE);
      fusionner(out, PAR_CATEGORIE_TRANSVERSE[c], SOURCES.CATEGORIE);
    });

    // 3. le prix, quand il est connu
    if (l.gratuit === true || l.prix === 0) fusionner(out, { gratuit: .9, pas_cher: .9 }, SOURCES.PRIX);
    if (Number.isFinite(Number(l.prixN))) {
      const n = Number(l.prixN);
      if (n <= 1) fusionner(out, { pas_cher: 1 }, SOURCES.PRIX);
      else if (n >= 3) fusionner(out, { romantique: .3 }, SOURCES.PRIX);
    }

    // 4. accessibilité déjà normalisée par les sources
    if (l.pmr === true) fusionner(out, { accessible: 1 }, SOURCES.TAG);

    return out;
  }

  /* Combien un lieu satisfait un signal demandé.
     `null` = on ne sait pas. Le classement doit distinguer « non » de
     « inconnu » : sans ça, demander du wifi vide la carte. */
  function force(signaux, id) {
    const s = signaux && signaux[id];
    return s ? s.valeur : null;
  }

  /* Un signal DUR est-il satisfait ? Un inconnu n'est pas un refus : il passe,
     mais sans le bonus. Seule une donnée qui dit explicitement « non » exclut.
     Aujourd'hui aucune source ne dit « pas de wifi » : c'est donc toujours
     soit oui, soit inconnu — et c'est volontaire. */
  function satisfait(signaux, id) {
    const v = force(signaux, id);
    if (v == null) return null;
    return v > 0;
  }

  /* ---- Ce que la date seule permet d'affirmer -----------------------------
     Pas de météo : une API de plus, une dépendance de plus, et une prévision
     qui se trompe. Le calendrier, lui, est certain — on sait qu'un 15 janvier
     à Lille on ne cherche pas une terrasse, et qu'un 20 juillet les familles
     ont les enfants à la maison toute la journée.

     Ces poids ORDONNENT, ils n'excluent jamais : une terrasse en janvier
     reste proposable, elle passe simplement derrière un lieu couvert. */
  function saisonDe(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    const m = d.getMonth() + 1;
    if (m >= 6 && m <= 8) return "ete";
    if (m === 12 || m <= 2) return "hiver";
    return m >= 3 && m <= 5 ? "printemps" : "automne";
  }

  /* Bonus saisonnier par signal, entre -1 et 1. Volontairement modeste : la
     saison est un indice, pas une règle. */
  const SAISON = Object.freeze({
    ete:       { dehors: .35, interieur: -.15 },
    printemps: { dehors: .2 },
    automne:   { interieur: .15 },
    hiver:     { dehors: -.3, interieur: .3 },
  });

  /* La nuit, une terrasse ou un parc valent moins qu'un lieu couvert : ce
     n'est pas la météo, c'est l'obscurité, et l'heure la donne exactement. */
  function nuit(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    const h = d.getHours();
    const m = d.getMonth() + 1;
    const coucher = (m >= 5 && m <= 8) ? 21 : (m === 4 || m === 9) ? 20 : 18;
    return h >= coucher || h < 7;
  }

  function contexteSaison(date, vacances) {
    const bonus = Object.assign({}, SAISON[saisonDe(date)] || {});
    if (nuit(date)) {
      bonus.dehors = (bonus.dehors || 0) - .3;
      bonus.interieur = (bonus.interieur || 0) + .2;
    }
    // vacances scolaires : les propositions familiales valent davantage, et
    // ça se sait par le calendrier, sans rien demander à personne
    if (vacances) bonus.famille = (bonus.famille || 0) + .3;
    return bonus;
  }

  root.AutourSignaux = Object.freeze({
    SOURCES, PLAFOND_INFERENCE,
    PAR_CATEGORIE, PAR_CATEGORIE_TRANSVERSE,
    signauxDe, force, satisfait,
    saisonDe, nuit, contexteSaison, SAISON,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
