/* LA HIÉRARCHIE DE PERTINENCE — dans quel ordre les critères tranchent.

   UN SCORE UNIQUE NE SAIT PAS DIRE « D'ABORD ». Additionner la pertinence
   personnelle, l'ampleur, l'heure, la distance et la popularité dans un même
   nombre, c'est accepter que trois cents avis Google rattrapent n'importe
   quoi. C'est le défaut classique, et il ne se voit pas en lisant le code :
   il se voit à l'écran, le jour où un festival que personne ne connaît passe
   devant le concert de l'artiste que la personne suit.

   Ce module ne remplace pas le score. Il pose, AU-DESSUS de lui, un ordre de
   critères nommés : le premier qui départage tranche, les suivants ne sont
   même pas lus. Le score reste, en dernier, pour départager ce que la
   hiérarchie a laissé à égalité.

   LA HIÉRARCHIE EST CONTEXTUELLE, et c'est tout l'intérêt.

     Dans « Maintenant », la question est « qu'est-ce que je peux faire là,
     tout de suite » : la temporalité et les pieds commandent. Un concert
     d'un artiste suivi qui a lieu dans trois semaines n'a rien à y faire, et
     aucune pertinence personnelle ne doit l'y faire entrer.

     Dans « Pour toi », tout est déjà à venir — la question n'est plus quand,
     elle est pour qui. La pertinence personnelle passe donc devant, puis
     l'ampleur de l'événement, puis le temps qui reste.

   CE QUE LA POPULARITÉ N'EST PAS. Elle n'est PAS un niveau de hiérarchie.
   Elle reste un ingrédient du score, en bas, avec les avis et la note — donc
   capable de départager deux propositions équivalentes, jamais d'en renverser
   une. Ce n'est pas une règle qui la déclare inférieure à la personnalisation
   dans tous les cas : c'est une place dans un ordre. L'AMPLEUR, elle, est un
   niveau — un événement exceptionnel porte loin, et c'est ce qui permet à un
   immense concert parisien d'exister pour quelqu'un de Lille sans que le
   nombre d'avis d'une brasserie ne remonte quoi que ce soit. */
(function (root) {
  "use strict";

  /* Les sept critères du produit, plus la faisabilité qui n'en est pas un :
     elle est un garde-fou et passe avant tout, partout. Envoyer quelqu'un
     devant une porte fermée est la seule faute qu'Autour ne peut pas se
     permettre, et aucun classement n'a le droit de la commettre. */
  const CRITERES = Object.freeze([
    "faisabilite", "personnel", "importance", "temporalite",
    "proximite", "accessibilite", "fraicheur", "diversite",
  ]);

  const HIERARCHIES = Object.freeze({
    /* Ce qui se passe là, maintenant. La temporalité d'abord — être en cours
       n'est pas une préférence —, puis les pieds. Le goût vient après : il
       choisit entre deux choses également possibles, il n'en fait pas entrer
       une troisième. */
    maintenant: Object.freeze([
      "faisabilite", "temporalite", "proximite", "personnel", "importance",
      "accessibilite", "fraicheur", "diversite",
    ]),
    /* Tout y est à venir : la question n'est plus quand, mais pour qui. */
    pourtoi: Object.freeze([
      "personnel", "importance", "temporalite", "proximite",
      "accessibilite", "fraicheur", "diversite",
    ]),
    /* L'exploration : ce qui est faisable, puis ce qui vient, puis ce qui
       ressemble à ce que la personne regarde vraiment. */
    explorer: Object.freeze([
      "faisabilite", "temporalite", "personnel", "importance",
      "proximite", "accessibilite", "fraicheur", "diversite",
    ]),
    /* Ce qui arrive bientôt : entre « maintenant » et « pour toi ». */
    avenir: Object.freeze([
      "faisabilite", "temporalite", "personnel", "importance",
      "proximite", "accessibilite", "fraicheur", "diversite",
    ]),
  });

  function detail(item) {
    return (item && item.rankBreakdown) || {};
  }

  function nombre(valeur) {
    const n = Number(valeur);
    return Number.isFinite(n) ? n : 0;
  }

  /* Les extracteurs. Chacun rend un comparateur, ou `null` quand le critère
     n'a pas de quoi trancher dans ce contexte — auquel cas il est simplement
     sauté, sans décaler les suivants. */
  const EXTRACTEURS = Object.freeze({
    faisabilite: () => (a, b) => nombre(detail(b).availability) - nombre(detail(a).availability),

    /* LA PERTINENCE PERSONNELLE, dans l'ordre que le produit a tranché :
       ce qui a été DÉCLARÉ passe devant ce qui a été DÉDUIT. Une intention
       écrite dans la recherche, ou une envie cochée, l'emporte toujours sur
       un comportement observé. */
    personnel: () => (a, b) =>
      nombre(detail(b).fit) - nombre(detail(a).fit) ||
      nombre(detail(b).declare) - nombre(detail(a).declare) ||
      nombre(detail(b).perso) - nombre(detail(a).perso),

    importance: () => (a, b) => nombre(detail(b).importance) - nombre(detail(a).importance),

    /* La temporalité n'est pas un nombre : « en cours » contre « ce soir »
       contre « samedi » demande de connaître les fenêtres locales. C'est le
       moteur temporel qui sait, pas ce module. Il passe son comparateur. */
    temporalite: (o) => (typeof o.comparerTemps === "function" ? o.comparerTemps : null),

    /* La distance géographique, arrondie par paliers : réordonner sur
       quarante mètres, c'est réordonner sur du bruit GPS. */
    proximite: () => (a, b) => nombre(detail(a).palierDistance) - nombre(detail(b).palierDistance),

    /* Y arriver : le temps de trajet réel, puis ce que l'arrivée implique.
       Un lieu à 400 m de l'autre côté du canal est plus loin qu'un lieu à
       2 km desservi directement. */
    accessibilite: (o) => (typeof o.comparerTrajet === "function" ? o.comparerTrajet : null),

    /* La qualité et l'âge de la donnée : à tout le reste égal, on préfère ce
       qu'on sait vraiment à ce qu'on suppose. */
    fraicheur: () => (a, b) => nombre(detail(b).quality) - nombre(detail(a).quality),

    /* La diversité ne se compare pas deux à deux : elle se joue sur la liste
       entière, après le tri (`diversifierResultats`). Elle figure dans la
       hiérarchie parce qu'elle EN FAIT PARTIE — au dernier rang — mais son
       extracteur est nul, et c'est volontaire. */
    diversite: () => null,
  });

  /* Le comparateur d'une hiérarchie nommée. Il ne rend que la TÊTE du
     classement : ce qu'il laisse à égalité redescend vers la chaîne de
     départage du moteur (score, qualité, distance fine). C'est ce qui permet
     de poser cette hiérarchie sans réécrire le tri existant. */
  function comparateur(nom, options) {
    const ordre = HIERARCHIES[String(nom || "")];
    if (!ordre) return null;
    const o = options || {};
    const etapes = ordre.map((critere) => {
      const fabrique = EXTRACTEURS[critere];
      return fabrique ? fabrique(o) : null;
    }).filter(Boolean);
    if (!etapes.length) return null;
    return function (a, b) {
      for (let i = 0; i < etapes.length; i += 1) {
        const verdict = etapes[i](a, b);
        if (verdict) return verdict;
      }
      return 0;
    };
  }

  /* ---- La composante personnelle ---------------------------------------- */

  /* Les clés sous lesquelles un objet peut être reconnu par le modèle
     d'intérêt. On regarde ce que l'objet EST — sa catégorie, sa famille, son
     genre, son type d'événement —, jamais son titre : un bonus au mot ferait
     remonter une friterie qui porte le nom d'un festival. C'est la même règle
     que `territoire.js` applique au contexte territorial. */
  function clesDe(item) {
    if (!item) return [];
    const core = root.AutourCore;
    const cles = [];
    const ajouter = (valeur) => {
      const k = String(valeur == null ? "" : valeur).trim().toLowerCase();
      if (k && !cles.includes(k)) cles.push(k);
    };
    ajouter(item.cat);
    if (core && typeof core.sousCategorieDe === "function") ajouter(core.sousCategorieDe(item));
    if (core && typeof core.familleDiversite === "function") ajouter(core.familleDiversite(item));
    (Array.isArray(item.categories) ? item.categories : []).forEach(ajouter);
    (Array.isArray(item.music_genres) ? item.music_genres : []).forEach(ajouter);
    (Array.isArray(item.musicGenres) ? item.musicGenres : []).forEach(ajouter);
    (Array.isArray(item.announcement_tags) ? item.announcement_tags : []).forEach(ajouter);
    (Array.isArray(item.announcementTags) ? item.announcementTags : []).forEach(ajouter);
    ajouter(item.event_kind || item.eventKind);
    return cles;
  }

  /* CE QUE LE COMPORTEMENT DIT DE CET OBJET, entre 0 et 1, avec sa phrase.

     Deux garde-fous, et ils sont la traduction en code de la règle produit :

     1. le poids est BORNÉ par le vecteur lui-même, qui est normalisé. Cent
        clics ne valent pas cent fois un clic ;
     2. un poids SANS PHRASE ne compte pas. Si le modèle ne sait pas dire
        pourquoi, il n'a pas le droit de peser — c'est la seule façon de tenir
        la promesse « chaque proposition sait dire pourquoi elle est là ». */
  function personnel(item, options) {
    const o = options || {};
    const modele = o.modele || root.AutourApprentissage;
    const vecteur = o.vecteur || null;
    if (!vecteur && !modele) return { valeur: 0, cle: null, raison: null };
    /* Les clés peuvent être fournies par l'appelant : `rankResults` les
       calcule UNE fois par objet et s'en sert pour les envies comme pour le
       vecteur. Les recalculer deux fois par objet coûtait un tiers du surcoût
       mesuré du lot, pour exactement le même résultat. */
    const cles = Array.isArray(o.cles) ? o.cles : clesDe(item);
    let meilleure = null;
    let valeur = 0;
    cles.forEach((cle) => {
      const p = vecteur ? Number(vecteur[cle]) || 0
        : (modele && typeof modele.poids === "function" ? modele.poids(cle, o.now) : 0);
      if (p > valeur) { valeur = p; meilleure = cle; }
    });
    if (!meilleure || valeur <= 0) return { valeur: 0, cle: null, raison: null };
    const raison = modele && typeof modele.raison === "function" ? modele.raison(meilleure, o.now) : null;
    if (!raison) return { valeur: 0, cle: meilleure, raison: null };
    return { valeur: Math.round(valeur * 100) / 100, cle: meilleure, raison };
  }

  /* ---- L'ampleur --------------------------------------------------------- */

  const NIVEAUX = Object.freeze({ local: 0.25, important: 0.6, major: 1 });

  /* L'ampleur d'un événement, entre 0 et 1. Elle vient de ce que la SOURCE a
     déclaré (`importance_level`, `importance_score`), jamais du nombre
     d'avis : l'ampleur dit « combien de gens cet événement concerne », la
     popularité dit « combien de gens ont noté ce lieu ». Les confondre, c'est
     laisser une chaîne de restauration rapide peser comme un festival.

     Un lieu pérenne n'a pas d'ampleur : il rend 0, et le critère est donc
     neutre entre deux lieux — la hiérarchie descend d'un cran toute seule. */
  function importance(item) {
    if (!item) return 0;
    const brut = item.importance_score != null ? item.importance_score : item.importanceScore;
    const score = Number(brut);
    if (Number.isFinite(score) && score > 0) return Math.min(1, score / 100);
    const niveau = String(item.importance_level || item.importanceLevel || "").toLowerCase();
    return NIVEAUX[niveau] || 0;
  }

  /* Un palier de distance : sous ce grain, deux résultats sont « aussi
     proches l'un que l'autre » et c'est un autre critère qui doit trancher.
     Les paliers sont ceux d'une marche réelle, pas une échelle décimale. */
  const PALIERS_M = Object.freeze([300, 800, 1500, 3000, 6000, 12000, 30000, 80000, 200000]);

  function palierDistance(metres) {
    const d = Number(metres);
    if (!Number.isFinite(d)) return PALIERS_M.length;
    for (let i = 0; i < PALIERS_M.length; i += 1) if (d <= PALIERS_M[i]) return i;
    return PALIERS_M.length;
  }

  root.AutourPertinence = Object.freeze({
    CRITERES, HIERARCHIES, PALIERS_M,
    comparateur, personnel, importance, palierDistance, clesDe,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
