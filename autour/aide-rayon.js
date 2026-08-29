(function (root) {
  "use strict";

  /* ===================================================================
     CHERCHER PRÈS, PUIS PLUS LOIN — ET LE DIRE

     CE QUI SE PASSAIT

     Aide interrogeait OpenStreetMap sur un rayon FIXE de neuf kilomètres, une
     seule fois. Deux conséquences opposées, et les deux mauvaises :

       · en centre-ville, neuf kilomètres ramènent la moitié de la métropole,
         et la structure à deux rues se retrouve noyée ;
       · à la campagne, si rien n'est dans les neuf kilomètres, l'écran dit
         « rien » alors qu'il y a une permanence à douze.

     Et dans les deux cas, personne — ni le moteur, ni l'écran — ne savait à
     quelle distance les résultats avaient été trouvés.

     LA RÈGLE

     On cherche d'abord très localement. Si l'on a assez de structures
     FIABLES, on s'arrête. Sinon on élargit d'un cran. On ne complète jamais
     une liste courte pour atteindre un chiffre : deux structures fiables
     valent mieux que dix douteuses, et c'est une décision de produit, pas une
     limite technique.

     Quand le rayon a été élargi, l'écran doit pouvoir le DIRE. Sinon quelqu'un
     part pour ce qu'il croit être le coin de la rue.
     =================================================================== */

  /* Quatre paliers. Le premier est un quartier, le dernier une agglomération.
     Au-delà, ce n'est plus « autour de toi » : c'est un annuaire, et Autour
     n'en est pas un. */
  const PALIERS = Object.freeze([3000, 5000, 10000, 20000]);

  /* Le rayon sert à trouver des candidats ; le trajet sert à les classer.
     La distance à vol d'oiseau seule est trop trompeuse en ville et ne doit
     plus être le proxy principal de l'accès réel. Quand aucun ETA n'est fourni,
     on garde l'estimation locale du moteur (environ 80 m/min à pied), sans la
     présenter comme un temps réel. */
  const PALIERS_TRAJET = Object.freeze([
    Object.freeze({ max: 10, priorite: 4 }),
    Object.freeze({ max: 20, priorite: 3 }),
    Object.freeze({ max: 30, priorite: 2 }),
    Object.freeze({ max: 45, priorite: 1 }),
    Object.freeze({ max: Infinity, priorite: 0 }),
  ]);

  /* Assez pour choisir, pas assez pour noyer. En dessous, on élargit ; à
     partir de là, on s'arrête même si un palier plus large en donnerait
     davantage — parce que « davantage » n'est pas « mieux ». */
  const SUFFISANT = 3;

  /* Le premier palier est celui qu'on demande à l'ouverture d'une catégorie. */
  const premier = () => PALIERS[0];

  function palierSuivant(courant) {
    const i = PALIERS.indexOf(Number(courant));
    if (i < 0) return PALIERS.find((p) => p > Number(courant)) || null;
    return i + 1 < PALIERS.length ? PALIERS[i + 1] : null;
  }

  const dernier = (courant) => palierSuivant(courant) === null;

  function minutesTrajet(lieu) {
    const l = lieu || {};
    const eta = l.rankEta && l.rankEta.minutes != null
      ? l.rankEta.minutes
      : l.rankBreakdown && l.rankBreakdown.etaMinutes != null
        ? l.rankBreakdown.etaMinutes : null;
    const direct = Number(eta);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const distance = Number(l.rankDistance != null
      ? l.rankDistance
      : l.rankBreakdown && l.rankBreakdown.distance);
    if (!Number.isFinite(distance) || distance < 0) return null;
    return Math.max(1, Math.round(distance / 80));
  }

  function palierTrajet(minutesOuLieu) {
    const minutes = typeof minutesOuLieu === "object"
      ? minutesTrajet(minutesOuLieu) : Number(minutesOuLieu);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return PALIERS_TRAJET.find((p) => minutes <= p.max) || null;
  }

  /* Compare d'abord les grandes expériences de trajet, puis les minutes à
     l'intérieur d'un même palier. Une aide à 12 min reste devant une aide à
     25 min, tandis qu'une différence de quelques secondes ne réordonne pas
     des résultats équivalents. */
  function comparerTemps(a, b) {
    const pa = palierTrajet(a), pb = palierTrajet(b);
    if (pa && pb && pa.priorite !== pb.priorite) return pb.priorite - pa.priorite;
    const ma = minutesTrajet(a), mb = minutesTrajet(b);
    if (Number.isFinite(ma) && Number.isFinite(mb) && ma !== mb) return ma - mb;
    return 0;
  }

  /* ===================================================================
     FAUT-IL ÉLARGIR ?

     `resultats` sont les structures DÉJÀ acceptées par le classement — pas
     des candidats. On ne compte donc jamais un résultat douteux comme une
     raison de s'arrêter.
     =================================================================== */
  function evaluer(resultats, palier, options) {
    const o = options || {};
    const liste = Array.isArray(resultats) ? resultats : [];
    const seuil = Number.isFinite(Number(o.suffisant)) ? Number(o.suffisant) : SUFFISANT;
    const suivant = palierSuivant(palier);

    return Object.freeze({
      trouves: liste.length,
      suffisant: liste.length >= seuil,
      /* On n'élargit que s'il reste un cran ET qu'on n'a pas assez. */
      elargir: liste.length < seuil && suivant !== null,
      palier: Number(palier) || premier(),
      prochain: suivant,
      dernier: suivant === null,
    });
  }

  /* ===================================================================
     CE QUE L'ÉCRAN DOIT POUVOIR DIRE

     La distance annoncée est celle des résultats RÉELS, arrondie au kilomètre
     supérieur — pas le palier interrogé. Annoncer « moins de 10 km » quand la
     structure la plus lointaine est à 6,2 km est exact et inutile : la phrase
     doit décrire ce qu'on propose, pas ce qu'on a demandé.
     =================================================================== */
  function portee(resultats) {
    const distances = (resultats || [])
      .map((l) => Number(l && l.rankDistance))
      .filter((d) => Number.isFinite(d) && d >= 0);
    if (!distances.length) return null;
    return { min: Math.min(...distances), max: Math.max(...distances) };
  }

  /* `null` quand il n'y a rien à annoncer : on a cherché près, on a trouvé
     près. Le silence est la bonne réponse dans ce cas — une phrase de plus
     serait du bruit. */
  function annonce(resultats, palier) {
    if (Number(palier) <= premier()) return null;
    const p = portee(resultats);
    if (!p || !(resultats || []).length) return null;
    const km = Math.max(1, Math.ceil(p.max / 1000));
    return {
      elargi: true,
      palier: Number(palier),
      distanceMaxM: p.max,
      texte: "Aucun résultat très proche. Voici les aides disponibles à moins de "
        + km + " km.",
    };
  }

  /* Le plan complet, pour un appelant qui préfère dérouler lui-même. */
  const plan = () => PALIERS.slice();

  root.AutourAideRayon = Object.freeze({
    PALIERS, PALIERS_TRAJET, SUFFISANT,
    premier, palierSuivant, dernier, minutesTrajet, palierTrajet, comparerTemps,
    evaluer, portee, annonce, plan,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
