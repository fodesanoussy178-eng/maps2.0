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

  /* Cinq paliers, du pas de la porte à l'intercommunalité. Au-delà, ce n'est
     plus « autour de toi » : c'est un annuaire, et Autour n'en est pas un.

     LE PREMIER PALIER MANQUAIT, ET C'EST CELUI QUI DÉCIDE DE TOUT.

     La recherche commençait à trois kilomètres. Sur une seule requête ça se
     défend ; sur un téléphone, non : trois kilomètres de centre-ville, c'est
     une requête large, lente, et qui ne rend rien AVANT d'avoir tout ramené.
     Pendant ce temps l'écran n'a rien à montrer, et il le dit — « je n'ai pas
     trouvé de solution ». Sur une fibre, ce moment dure une seconde et
     personne ne le voit. Sur un réseau mobile, il dure dix secondes, et il se
     lit comme une réponse.

     On commence donc par la PROXIMITÉ IMMÉDIATE : mille deux cents mètres,
     un quart d'heure à pied, une requête petite qui revient vite. Ce qu'elle
     rapporte s'affiche tout de suite ; les paliers suivants complètent
     derrière, et chacun d'eux publie à son tour.

       1200 m   ce qu'on peut atteindre à pied, maintenant
       3000 m   le quartier élargi
       5000 m   la commune
      10000 m   la commune et ses voisines
      20000 m   l'intercommunalité */
  const PALIERS = Object.freeze([1200, 3000, 5000, 10000, 20000]);

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
    PALIERS, SUFFISANT,
    premier, palierSuivant, dernier, evaluer, portee, annonce, plan,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
