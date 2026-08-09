(function (root) {
  "use strict";

  /* ===================================================================
     Un modèle normalisé pour le prix, les horaires et les signaux

     Ces trois familles de données arrivent de partout : tags OpenStreetMap,
     niveaux de prix Google, horaires déclarés par un habitant, inférences de
     catégorie. Jusqu'ici chaque écran les lisait à sa façon, et surtout
     personne ne savait D'OÙ venait une valeur ni QUAND elle avait été vue.

     Trois champs accompagnent donc désormais toute valeur :

       · `source`     — qui l'affirme (osm, google, habitant, categorie…) ;
       · `confidence` — 0 à 1. Zéro veut dire « on ne sait pas », et c'est un
                        état à part entière : ce n'est PAS « non » ;
       · `updated_at` — quand la donnée a été vue pour la dernière fois.

     La règle qui découle de tout ça, et qui vaut pour l'application entière :
     **une donnée absente n'élimine jamais un lieu.** Un restaurant dont on
     ignore le prix n'est pas un restaurant trop cher ; un lieu sans horaires
     publiés n'est pas un lieu fermé. Écarter sur du vide, c'est vider la
     carte partout où OpenStreetMap est peu renseigné — c'est-à-dire presque
     partout.
     =================================================================== */

  const SOURCES = Object.freeze({
    OSM: "osm",
    GOOGLE: "google",
    HABITANT: "habitant",         // publié dans Autour
    AGENDA: "agenda",             // OpenAgenda et équivalents
    CATEGORIE: "categorie",       // inférence assumée
    INCONNU: null,
  });

  /* Confiance par provenance. Ce ne sont pas des probabilités : c'est un
     ordre, et il sert à trancher quand deux sources se contredisent. */
  const CONFIANCE = Object.freeze({
    habitant_verifie: 1,
    google: .9,
    osm: .85,
    agenda: .85,
    habitant: .6,
    categorie: .4,
  });

  /* Correspondance entre le niveau de prix Google et une fourchette en euros.
     Approximative et assumée comme telle : la confiance associée le dit. Sans
     elle, « moins de 15 € » ne pouvait rien exclure du tout. */
  const PALIERS = Object.freeze([
    { min: 0, max: 0 },        // 0 · gratuit
    { min: 1, max: 15 },       // 1 · €
    { min: 15, max: 30 },      // 2 · €€
    { min: 30, max: 60 },      // 3 · €€€
    { min: 60, max: null },    // 4 · €€€€
  ]);

  const maintenant = () => new Date().toISOString();

  function vide(champ) {
    return Object.freeze({
      [champ]: null, source: null, confidence: 0, updated_at: null,
    });
  }

  /* ---- Prix --------------------------------------------------------------
     `{ level, min, max, currency, source, confidence, updated_at }`
     `level` suit l'échelle Google (0 à 4). `min`/`max` sont en euros, `max`
     à null voulant dire « sans plafond connu ». Confiance à 0 = inconnu. */
  const PRIX_INCONNU = Object.freeze({
    level: null, min: null, max: null, currency: "EUR",
    source: null, confidence: 0, updated_at: null,
  });

  function normaliserPrix(lieu) {
    const l = lieu || {};
    const vu = l.prixVuLe || l.updated_at || null;

    // 1. un prix annoncé par la personne qui publie : le plus précis qui soit
    if (Number.isFinite(Number(l.prix)) && (l.prix > 0 || l.gratuit === true)) {
      const n = Number(l.prix);
      return {
        level: n === 0 ? 0 : null, min: n, max: n, currency: "EUR",
        source: SOURCES.HABITANT,
        confidence: l.verifie ? CONFIANCE.habitant_verifie : CONFIANCE.habitant,
        updated_at: vu,
      };
    }
    // 2. gratuité déclarée sans montant
    if (l.gratuit === true) {
      return { level: 0, min: 0, max: 0, currency: "EUR",
        source: l.tags && l.tags.fee === "no" ? SOURCES.OSM : SOURCES.HABITANT,
        confidence: l.tags && l.tags.fee === "no" ? CONFIANCE.osm : CONFIANCE.habitant,
        updated_at: vu };
    }
    // 3. le niveau de prix Google : une fourchette, pas un montant
    const n = Number(l.prixN);
    if (Number.isFinite(n) && PALIERS[n]) {
      return Object.assign({ level: n, currency: "EUR",
        source: SOURCES.GOOGLE, confidence: CONFIANCE.google * .8, updated_at: vu },
        PALIERS[n]);
    }
    // 4. rien. Et « rien » n'est pas « cher ».
    return PRIX_INCONNU;
  }

  /* Ce prix dépasse-t-il un plafond demandé ?
     `true` = oui, on l'écarte. `false` = non. `null` = **on ne sait pas**, et
     l'appelant doit alors laisser passer. */
  function depassePlafond(prix, plafond) {
    if (!prix || prix.confidence <= 0) return null;
    const max = Number(plafond);
    if (!Number.isFinite(max)) return null;
    if (max === 0) return prix.min != null && prix.min > 0;
    // on n'écarte que si le BAS de la fourchette dépasse déjà le plafond :
    // un lieu « €€ » (15–30 €) reste possible à 20 €
    if (prix.min == null) return null;
    return prix.min > max;
  }

  /* ---- Horaires ----------------------------------------------------------
     `{ open_now, next_open, next_close, source, confidence, updated_at }`
     `open_now` vaut `true`, `false` ou `null` — et `null` est un état, pas un
     `false` déguisé. */
  const HORAIRES_INCONNUS = Object.freeze({
    open_now: null, next_open: null, next_close: null,
    source: null, confidence: 0, updated_at: null,
  });

  function normaliserHoraires(lieu, at, disponibilite) {
    const l = lieu || {};
    const dispo = typeof disponibilite === "function" ? disponibilite(l, at) : disponibilite;
    if (!dispo || dispo.status === "unknown") return HORAIRES_INCONNUS;

    const confiance = dispo.source === "declaree" ? CONFIANCE.habitant
      : dispo.source === "officielle" ? CONFIANCE.habitant_verifie
      : dispo.source === "google" ? CONFIANCE.google
      : CONFIANCE.osm;

    return {
      open_now: dispo.status === "permanently_closed" ? false : !!dispo.isOpenNow,
      next_open: dispo.opensAt || null,
      next_close: dispo.closesAt || null,
      source: dispo.source === "declaree" ? SOURCES.HABITANT
        : dispo.source === "google" ? SOURCES.GOOGLE : SOURCES.OSM,
      confidence: confiance,
      updated_at: l.horairesVusLe || null,
      status: dispo.status,
      closesAtTime: dispo.closesAtTime || null,
      opensAtTime: dispo.opensAtTime || null,
    };
  }

  /* Ferme-t-il avant l'heure demandée ?
     Même contrat : `null` quand on ne sait pas. Et une fermeture à 02:00 est
     PLUS TARD que 21:00 — c'est le lendemain. */
  function fermeAvant(horaires, minutes) {
    if (!horaires || horaires.confidence <= 0 || !horaires.closesAtTime) return null;
    const [h, m] = String(horaires.closesAtTime).split(":").map(Number);
    if (!Number.isFinite(h)) return null;
    let fin = h * 60 + (m || 0);
    if (fin <= 6 * 60) fin += 24 * 60;
    return fin < Number(minutes);
  }

  /* ---- Le profil complet d'un lieu ---------------------------------------
     Prix, horaires et signaux réunis, chacun avec sa provenance. C'est ce
     que les écrans et le classement doivent lire, plutôt que d'aller piocher
     dans des champs bruts qui ne disent pas d'où ils viennent. */
  function profil(lieu, options) {
    const o = options || {};
    const signaux = root.AutourSignaux;
    return {
      prix: normaliserPrix(lieu),
      horaires: normaliserHoraires(lieu, o.at, o.disponibilite),
      signaux: signaux ? signaux.signauxDe(lieu) : {},
      updated_at: (lieu && lieu.updated_at) || null,
    };
  }

  /* ---- Ce qu'il manque, et qui vaudrait la peine d'être demandé -----------
     Sert à décider quels lieux enrichir. On n'enrichit jamais une zone
     entière : seulement les meilleurs candidats d'un classement, et seulement
     si le complément change quelque chose. */
  function manque(lieu, intention, options) {
    const p = profil(lieu, options);
    const besoins = [];
    const it = intention || {};
    const veutBudget = (it.contraintes || []).some((c) => c.type === "budget")
      || (it.budget && (it.budget.max != null || it.budget.pasCher));
    const veutHoraire = (it.contraintes || []).some((c) => c.type === "ouvertApres")
      || (it.horaire && it.horaire.ouvertMaintenant);

    if (veutBudget && p.prix.confidence <= 0) besoins.push("prix");
    if (veutHoraire && p.horaires.confidence <= 0) besoins.push("horaires");
    return besoins;
  }

  root.AutourDonnees = Object.freeze({
    SOURCES, CONFIANCE, PALIERS,
    PRIX_INCONNU, HORAIRES_INCONNUS,
    normaliserPrix, normaliserHoraires, depassePlafond, fermeAvant,
    profil, manque, maintenant,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
