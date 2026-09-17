/* LES SIGNAUX IMPLICITES — ce que le comportement laisse voir.

   LA RÈGLE QUI GOUVERNE CE FICHIER, ET ELLE EST PRODUIT AVANT D'ÊTRE
   TECHNIQUE :

       LE DÉCLARÉ SÉLECTIONNE, L'IMPLICITE ORDONNE.

   Ce qui a été coché dans « Envies » décide de ce qui a le droit d'ENTRER.
   Ce qui est déduit d'un comportement ne décide que de l'ORDRE de ce qui est
   déjà entré. Aucun événement n'apparaît jamais parce qu'on a cliqué quelque
   part il y a trois semaines — sans quoi personne ne pourrait plus répondre à
   « pourquoi je vois ça ? », et c'est exactement la promesse que `envies.js`
   protège depuis le premier jour.

   Trois conséquences, appliquées ici et vérifiables :

   1. `vecteur()` rend des poids entre 0 et 1. Il n'existe aucune fonction qui
      rende « ce que la personne aime » sous forme de liste d'admission : le
      moteur ne peut donc pas s'en servir pour sélectionner, même par erreur.
   2. Chaque poids sait DIRE d'où il vient — `raison()` rend une phrase
      lisible, jamais un score. Une recommandation qu'on ne peut pas expliquer
      n'a pas le droit d'être poussée par ce module.
   3. Tout s'efface d'un geste, et l'interrupteur existe déjà à l'écran
      (« Ne plus personnaliser »). Éteint, `vecteur()` rend un objet vide :
      le classement redevient exactement celui de quelqu'un qui arrive.

   RIEN NE PART SUR LE RÉSEAU. Ni ici, ni ailleurs : ce module ne connaît que
   `localStorage`, et le stockage qui échoue (navigation privée, quota) bascule
   en mémoire pour la session plutôt que de casser l'application.

   CE QU'IL REMPLACE. `PROFIL` dans `app.js` comptait déjà les catégories, les
   heures, les recherches et les refus — mais il ne nourrissait QUE l'ancien
   classement (`scoreLieu`, les marqueurs). Les recommandations de la feuille,
   elles, passent par `rankResults` et ne voyaient rien. Un même lieu pouvait
   donc être premier sur la carte et absent de la liste. Ce module donne aux
   deux moteurs la même lecture, et la même seule. */
(function (root) {
  "use strict";

  const CLE = "autour:signaux:v1";

  /* UN INTÉRÊT VIEILLIT. Trois semaines de demi-vie : ce qu'on regardait il y
     a trois semaines pèse moitié moins qu'hier, et ce qu'on regardait il y a
     trois mois ne pèse presque plus rien. Sans cette décroissance, une
     semaine de recherches d'appartement décidait du classement pour toujours.

     La décroissance est appliquée À LA LECTURE, à partir de la date de chaque
     clé. Aucune tâche de fond, aucun réveil : un onglet fermé pendant un mois
     rend la bonne valeur à sa réouverture. */
  const DEMI_VIE_MS = 21 * 24 * 3600e3;

  /* Ce que vaut chaque geste. L'échelle n'est pas décorative : sauvegarder ou
     partager est une déclaration presque explicite, ouvrir une fiche est un
     intérêt réel, survoler une catégorie est une hypothèse. Un refus pèse peu
     et ne peut jamais rendre un poids négatif — « je n'ai pas cliqué » n'est
     pas « je n'aime pas », et un unique « encore » sur un jeu de découverte
     n'est pas un verdict. */
  const POIDS = Object.freeze({
    categorie:   1,
    clic:        3,
    ouverture:   4,
    recherche:   5,
    sauvegarde:  8,
    partage:     8,
    ignore:     -2,
  });

  /* Le plancher sous lequel un poids ne dit plus rien. Un seul clic ne doit
     pas colorer tout l'écran : c'est la règle qu'`obtenirInteretsProbables`
     appliquait déjà — « au moins deux fois, et au-dessus de la moyenne ». On
     la garde, exprimée en poids plutôt qu'en nombre de gestes, pour qu'une
     sauvegarde vaille à elle seule ce que valent quatre survols. */
  const SEUIL = 5;

  /* Une clé de signal est une catégorie d'Autour (`resto`, `concert`, `musee`)
     ou une envie (`rap`, `festivals`). Jamais une personne, jamais un lieu
     précis, jamais une position, jamais une phrase de recherche entière. */
  const CLE_VALIDE = /^[a-z0-9_:-]{2,40}$/;

  const VIDE = Object.freeze({ v: 1, actif: true, maj: 0, cles: {}, heures: {} });

  let enMemoire = null;
  let stockageMuet = false;

  function maintenant(t) {
    return Number.isFinite(Number(t)) ? Number(t) : Date.now();
  }

  function lireBrut() {
    if (stockageMuet) return enMemoire || (enMemoire = copie(VIDE));
    try {
      const brut = root.localStorage && root.localStorage.getItem(CLE);
      if (!brut) return copie(VIDE);
      const lu = JSON.parse(brut);
      if (!lu || typeof lu !== "object") return copie(VIDE);
      return {
        v: 1,
        actif: lu.actif !== false,
        maj: Number(lu.maj) || 0,
        cles: lu.cles && typeof lu.cles === "object" ? lu.cles : {},
        heures: lu.heures && typeof lu.heures === "object" ? lu.heures : {},
      };
    } catch (e) {
      stockageMuet = true;
      return enMemoire || (enMemoire = copie(VIDE));
    }
  }

  function copie(etat) {
    return { v: 1, actif: etat.actif !== false, maj: etat.maj || 0,
             cles: Object.assign({}, etat.cles), heures: Object.assign({}, etat.heures) };
  }

  function ecrire(etat) {
    enMemoire = etat;
    if (stockageMuet) return etat;
    try {
      root.localStorage.setItem(CLE, JSON.stringify(etat));
    } catch (e) {
      /* Quota, navigation privée, réglages qui bloquent les données de site :
         la personnalisation est un confort, elle ne doit jamais empêcher
         d'utiliser Autour. On oublie au prochain démarrage, c'est tout. */
      stockageMuet = true;
    }
    return etat;
  }

  function etat() {
    if (stockageMuet) return enMemoire || (enMemoire = copie(VIDE));
    return lireBrut();
  }

  /* ---- Lecture ---------------------------------------------------------- */

  function actif() {
    return etat().actif !== false;
  }

  function definirActif(valeur) {
    const e = etat();
    e.actif = valeur !== false;
    /* Éteindre EFFACE. Laisser les compteurs en place pendant que
       l'interrupteur dit « non » serait un mensonge poli : la personne croit
       avoir retiré ses données et elles attendent qu'on rallume. */
    if (!e.actif) { e.cles = {}; e.heures = {}; }
    return ecrire(e).actif;
  }

  function decroissance(poids, depuis, t) {
    if (!(poids > 0)) return poids;
    const age = Math.max(0, t - (Number(depuis) || 0));
    return poids * Math.pow(0.5, age / DEMI_VIE_MS);
  }

  /* Le poids vivant d'une clé, décroissance comprise, avant normalisation. */
  function brut(cle, t) {
    const e = etat();
    if (e.actif === false) return 0;
    const ligne = e.cles[String(cle || "")];
    if (!ligne) return 0;
    return Math.max(0, decroissance(Number(ligne.p) || 0, ligne.maj, maintenant(t)));
  }

  /* LE VECTEUR : la seule sortie que le classement a le droit de consommer.

     Normalisé sur le plus fort intérêt, donc toujours entre 0 et 1. C'est ce
     qui garantit qu'un signal implicite ne peut pas croître indéfiniment à
     force de clics : quelqu'un qui ouvre cent concerts obtient 1, pas 100, et
     la composante du score reste bornée par construction. */
  function vecteur(t) {
    const e = etat();
    if (e.actif === false) return Object.freeze({});
    const now = maintenant(t);
    const vivants = {};
    let max = 0;
    Object.keys(e.cles).forEach((cle) => {
      const ligne = e.cles[cle];
      const p = Math.max(0, decroissance(Number(ligne && ligne.p) || 0, ligne && ligne.maj, now));
      if (p < SEUIL) return;
      vivants[cle] = p;
      if (p > max) max = p;
    });
    if (!max) return Object.freeze({});
    const sortie = {};
    Object.keys(vivants).forEach((cle) => { sortie[cle] = Math.round((vivants[cle] / max) * 1000) / 1000; });
    return Object.freeze(sortie);
  }

  /* La part d'une clé dans le vecteur : 0 quand elle n'y est pas. */
  function poids(cle, t) {
    const v = vecteur(t);
    return v[String(cle || "")] || 0;
  }

  /* POURQUOI CE POIDS EXISTE, en une phrase lisible.

     C'est la contrepartie de l'implicite : un signal qui ne sait pas
     s'expliquer ne doit pas peser. `pertinence.js` ne pousse une proposition
     au nom du comportement que si cette fonction rend une phrase. */
  function raison(cle, t) {
    const e = etat();
    if (e.actif === false) return null;
    const ligne = e.cles[String(cle || "")];
    if (!ligne) return null;
    if (brut(cle, t) < SEUIL) return null;
    const geste = String(ligne.g || "");
    if (geste === "sauvegarde") return "Tu as déjà sauvegardé ce genre de chose";
    if (geste === "partage") return "Tu as déjà partagé ce genre de chose";
    if (geste === "recherche") return "Tu as cherché ça récemment";
    if (geste === "ouverture") return "Tu ouvres souvent ce genre de fiche";
    return "Tu regardes souvent ce genre de chose";
  }

  /* L'heure à laquelle cette personne se sert d'Autour. Sert au contexte,
     jamais à sélectionner : c'est une information sur l'usage, pas sur le
     monde. */
  function heures(t) {
    const e = etat();
    if (e.actif === false) return Object.freeze({});
    return Object.freeze(Object.assign({}, e.heures));
  }

  /* CE QUE LE MODULE SAIT, EN CLAIR. Sert à l'écran de transparence : on doit
     pouvoir montrer à quelqu'un l'intégralité de ce qui est retenu sur lui,
     sans avoir à ouvrir une console. */
  function exporter(t) {
    const e = etat();
    const now = maintenant(t);
    return Object.freeze({
      actif: e.actif !== false,
      derniereMiseAJour: e.maj || null,
      interets: Object.keys(e.cles)
        .map((cle) => ({ cle, poids: Math.round(brut(cle, now) * 10) / 10,
                         gestes: Number(e.cles[cle].n) || 0,
                         dernier: e.cles[cle].maj || null,
                         raison: raison(cle, now) }))
        .filter((ligne) => ligne.poids > 0)
        .sort((a, b) => b.poids - a.poids),
      heures: Object.assign({}, e.heures),
    });
  }

  /* ---- Écriture --------------------------------------------------------- */

  /* Noter un geste. `geste` est l'un des POIDS, `cle` une catégorie ou une
     envie. Une clé qui ne ressemble pas à une clé est refusée en silence :
     c'est la barrière qui empêche une phrase de recherche entière, un nom de
     lieu ou un identifiant d'atterrir ici par accident. */
  function noter(geste, cle, options) {
    const e = etat();
    if (e.actif === false) return null;
    const valeur = POIDS[String(geste || "")];
    if (valeur == null) return null;
    const k = String(cle == null ? "" : cle).trim().toLowerCase();
    if (!CLE_VALIDE.test(k)) return null;

    const t = maintenant(options && options.now);
    const ligne = e.cles[k] || { p: 0, n: 0, maj: t, g: geste };
    /* La décroissance s'applique AVANT d'ajouter : sans ça, un intérêt ancien
       repartirait de sa valeur nominale au premier clic, et trois clics
       espacés d'un an pèseraient autant que trois clics d'affilée. */
    const vieilli = decroissance(Number(ligne.p) || 0, ligne.maj, t);
    const p = Math.max(0, vieilli + valeur);
    e.cles[k] = { p: Math.round(p * 100) / 100, n: (Number(ligne.n) || 0) + 1, maj: t,
                  g: valeur > 0 ? geste : (ligne.g || geste) };
    /* Un poids retombé à zéro ne laisse pas de ligne derrière lui : ce qui ne
       pèse plus rien ne doit pas rester écrit sur quelqu'un. */
    if (e.cles[k].p <= 0) delete e.cles[k];
    const heure = new Date(t).getHours();
    e.heures[heure] = (Number(e.heures[heure]) || 0) + 1;
    e.maj = t;
    ecrire(e);
    return e.cles[k] || null;
  }

  function effacer() {
    return ecrire(Object.assign(copie(VIDE), { actif: etat().actif !== false }));
  }

  function _reinitialiser() {
    enMemoire = null;
    stockageMuet = false;
    try { root.localStorage.removeItem(CLE); } catch (e) { /* rien à nettoyer */ }
  }

  root.AutourApprentissage = Object.freeze({
    CLE, POIDS, SEUIL, DEMI_VIE_MS,
    actif, definirActif,
    noter, vecteur, poids, brut, raison, heures, exporter,
    effacer, _reinitialiser,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
