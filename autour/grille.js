/* LE QUADRILLAGE SPATIO-TEMPOREL — infrastructure interne, invisible.

   Deux questions, et seulement celles-là :

       « Qu'est-ce qui vient de changer autour d'ici ? »
       « Qu'est-ce qui va changer dans les prochaines heures ? »

   POURQUOI LA SECONDE EST LA PLUS UTILE. Autour affiche des phrases qui
   périment : « 🔥 Dans 3 jours » devient faux au prochain minuit, « 🎟️
   Billetterie ouverte » cesse d'être une nouvelle au bout de deux jours, un
   lieu ferme à 22 h. Sans rien, l'écran garde sa phrase jusqu'à ce que
   quelqu'un le touche — et quelqu'un qui laisse Autour ouvert pendant la
   soirée lit, à 22 h 10, qu'un endroit ferme à 22 h.

   Avec un battement régulier, on paierait un recalcul toutes les minutes pour
   rien la plupart du temps. Or on n'a besoin d'aucune des deux solutions : le
   cycle d'un événement SAIT quand sa lecture cesse d'être vraie, et il le dit
   (`expireLe`). Il suffit de demander à l'écran quand il devient faux, et de
   ne se réveiller qu'à ce moment-là.

   POURQUOI UNE GRILLE, ET PAS UN RAYON. Une maille est stable : elle ne bouge
   pas quand la carte glisse de trois cents mètres, donc deux rendus successifs
   parlent des mêmes cellules et se comparent. Un rayon centré sur la vue
   change à chaque image, et ne se compare à rien.

   LA GRILLE N'EST PAS LA ZONE. `contexte.js` décide de ce qu'on montre ; ce
   module ne décide de rien. Il indexe, il compare, il prévient. Aucun filtre
   d'affichage ne passe par ici, et c'est ce qui l'empêche de devenir un
   second système de zones. */
(function (root) {
  "use strict";

  /* Un centième de degré : environ 1,1 km en latitude, 700 m en longitude à
     nos latitudes. C'est déjà le grain des clés de cache de `contexte.js` —
     en changer ici créerait deux découpes concurrentes du même territoire. */
  const PAS = 0.01;

  /* Les bornes du réveil. En deçà, on se réveillerait pour une seconde de
     différence ; au-delà, une phrase resterait fausse trop longtemps. Un
     écran ouvert toute une soirée doit se corriger sans pour autant réveiller
     le téléphone toutes les minutes. */
  const REVEIL_MIN_MS = 30e3;
  const REVEIL_MAX_MS = 30 * 60e3;

  /* `Number(null)` vaut ZÉRO, et zéro est une latitude parfaitement valide —
     au large du golfe de Guinée. Un objet sans coordonnées se serait donc
     rangé dans une cellule bien réelle, et `quoiDeNeuf` aurait annoncé des
     changements dans un océan. L'absence se refuse avant la conversion. */
  function nombre(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function arrondir(valeur, pas) {
    return Math.round(valeur / pas) * pas;
  }

  /* L'identifiant d'une cellule. Deux décimales : la même écriture que
     `idZone`, pour qu'un journal soit lisible d'un module à l'autre. */
  function cellule(lat, lng, pas) {
    const la = nombre(lat), ln = nombre(lng);
    if (la == null || ln == null) return null;
    const p = nombre(pas) || PAS;
    return arrondir(la, p).toFixed(2) + "," + arrondir(ln, p).toFixed(2);
  }

  function celluleDe(item, pas) {
    if (!item) return null;
    const lat = item.lat != null ? item.lat : item.latitude;
    const lng = item.lng != null ? item.lng : item.longitude;
    return cellule(lat, lng, pas);
  }

  /* La cellule et ses huit voisines. Un événement à trois cents mètres de la
     limite appartient à la vie du quartier d'à côté : ignorer les voisines
     ferait apparaître des frontières là où le terrain n'en a pas. */
  function voisines(id, pas) {
    if (!id) return [];
    const [la, ln] = String(id).split(",").map(Number);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return [];
    const p = nombre(pas) || PAS;
    const sortie = [];
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1)
        sortie.push((la + dy * p).toFixed(2) + "," + (ln + dx * p).toFixed(2));
    return sortie;
  }

  /* ---- L'index ----------------------------------------------------------- */

  /* CE QU'UNE CELLULE SAIT D'ELLE-MÊME. Rien de plus que ce qui sert aux deux
     questions : combien d'objets, lesquels, quand elle a changé pour la
     dernière fois, et quand elle changera la prochaine fois. */
  function indexer(items, options) {
    const o = options || {};
    const pas = nombre(o.pas) || PAS;
    const maintenant = nombre(o.maintenant) == null ? Date.now() : Number(o.maintenant);
    const cycle = o.cycle === undefined ? root.AutourCycle : o.cycle;
    const cellules = new Map();

    (Array.isArray(items) ? items : []).forEach((item) => {
      const id = celluleDe(item, pas);
      if (!id) return;
      let c = cellules.get(id);
      if (!c) {
        c = {id, n: 0, ids: [], empreinte: "", prochainChangement: null};
        cellules.set(id, c);
      }
      c.n += 1;
      if (item.id != null) c.ids.push(String(item.id));

      /* QUAND CETTE LECTURE CESSE D'ÊTRE VRAIE. Le cycle le sait pour un
         événement — minuit pour une approche, deux jours pour une billetterie
         qui vient d'ouvrir. On ne l'invente pas pour un lieu : ses horaires
         sont l'affaire d'`availability.js`, et un lieu dont on ignore les
         horaires ne doit surtout pas provoquer un réveil pour rien. */
      const phase = cycle && typeof cycle.phaseDe === "function"
        ? cycle.phaseDe(item, maintenant) : null;
      const expire = phase && nombre(phase.expireLe);
      if (expire != null && expire > maintenant &&
          (c.prochainChangement == null || expire < c.prochainChangement))
        c.prochainChangement = expire;
    });

    cellules.forEach((c) => {
      c.ids.sort();
      /* L'empreinte dit « le contenu de cette cellule », pas « son ordre » :
         un reclassement ne doit pas se lire comme un changement de données.
         C'est ce qui permet de comparer deux rendus successifs sans que la
         moindre remontée de score passe pour une nouveauté. */
      c.empreinte = c.n + ":" + c.ids.join("|");
    });

    return {
      pas, maintenant, cellules,
      /* Le plus proche changement connu, toutes cellules confondues. C'est la
         valeur qu'un écran consomme réellement. */
      prochainChangement: [...cellules.values()]
        .map((c) => c.prochainChangement)
        .filter((t) => t != null)
        .sort((a, b) => a - b)[0] || null,
    };
  }

  /* ---- Les deux questions ------------------------------------------------ */

  /* CE QUI A CHANGÉ entre deux index. Rend les cellules apparues, disparues et
     modifiées — jamais « tout a changé », qui n'apprend rien. */
  function quoiDeNeuf(avant, apres, options) {
    const o = options || {};
    const filtre = Array.isArray(o.cellules) && o.cellules.length ? new Set(o.cellules) : null;
    const anciennes = avant && avant.cellules ? avant.cellules : new Map();
    const nouvelles = apres && apres.cellules ? apres.cellules : new Map();
    const apparues = [], disparues = [], modifiees = [];

    nouvelles.forEach((c, id) => {
      if (filtre && !filtre.has(id)) return;
      const ancienne = anciennes.get(id);
      if (!ancienne) apparues.push(id);
      else if (ancienne.empreinte !== c.empreinte) modifiees.push(id);
    });
    anciennes.forEach((c, id) => {
      if (filtre && !filtre.has(id)) return;
      if (!nouvelles.has(id)) disparues.push(id);
    });

    return {apparues, disparues, modifiees,
      rienDeNeuf: !apparues.length && !disparues.length && !modifiees.length};
  }

  /* CE QUI VA CHANGER dans les prochaines heures, pour les cellules qu'on
     regarde. Rend l'instant du prochain changement, ou `null` quand rien de
     prévu ne bougera — auquel cas il ne faut surtout pas programmer de
     réveil. */
  function quoiVaChanger(index, options) {
    const o = options || {};
    if (!index || !index.cellules) return null;
    const filtre = Array.isArray(o.cellules) && o.cellules.length ? new Set(o.cellules) : null;
    const horizon = nombre(o.horizonMs);
    const maintenant = nombre(o.maintenant) == null ? index.maintenant : Number(o.maintenant);
    let prochain = null;
    index.cellules.forEach((c, id) => {
      if (filtre && !filtre.has(id)) return;
      const t = c.prochainChangement;
      if (t == null || t <= maintenant) return;
      if (horizon != null && t - maintenant > horizon) return;
      if (prochain == null || t < prochain) prochain = t;
    });
    return prochain;
  }

  /* LE DÉLAI AVANT LE PROCHAIN RÉVEIL UTILE, borné. `null` veut dire « ne
     programme rien » — et c'est une réponse fréquente et parfaitement saine :
     un écran qui ne contient que des lieux permanents n'a aucune raison de se
     réveiller. */
  function delaiReveil(index, options) {
    const o = options || {};
    const maintenant = nombre(o.maintenant) == null
      ? (index && index.maintenant) || Date.now() : Number(o.maintenant);
    const prochain = quoiVaChanger(index, Object.assign({}, o, {maintenant}));
    if (prochain == null) return null;
    const delai = prochain - maintenant;
    if (delai <= 0) return null;
    return Math.min(REVEIL_MAX_MS, Math.max(REVEIL_MIN_MS, delai));
  }

  root.AutourGrille = Object.freeze({
    PAS, REVEIL_MIN_MS, REVEIL_MAX_MS,
    cellule, celluleDe, voisines,
    indexer, quoiDeNeuf, quoiVaChanger, delaiReveil,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
