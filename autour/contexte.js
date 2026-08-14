(function (root) {
  "use strict";

  /* ===================================================================
     DEUX POINTS, ET UN SEUL QUI COMMANDE

     LE BUG, TEL QU'IL EST VÉCU. Quelqu'un est physiquement à Tourcoing. Il
     cherche « Lille ». L'écran écrit Lille, la carte va à Lille — et il voit
     un restaurant de Tourcoing dans « Maintenant », un marqueur de Tourcoing
     sur la carte de Lille, une recommandation classée depuis Tourcoing.

     LE BUG, TEL QU'IL EST DANS LE CODE. Les lieux s'accumulent dans un seul
     tableau, sans provenance : `fusionner` ajoute, personne ne retire. Rien,
     nulle part, ne demandait « ce lieu appartient-il à la zone dont on parle
     en ce moment ? » — parce que « la zone dont on parle » n'existait pas.
     Il y avait `positionMoi`, il y avait `rechercheGeo`, il y avait le centre
     de la carte, et chaque partie du code choisissait le sien.

     CE QUE CE MODULE INTRODUIT. Une seule notion : la ZONE ACTIVE. C'est la
     zone dont Autour parle en ce moment. Elle vaut la position de la personne
     à l'ouverture, la ville cherchée ensuite, et elle redevient la position
     quand on appuie sur « Revenir autour de moi » — jamais autrement.

     LA POSITION PHYSIQUE NE DISPARAÎT PAS pour autant : elle reste connue, et
     le point bleu reste à sa place. Elle cesse simplement de décider ce qu'on
     montre tant qu'on regarde ailleurs.

     CE QUE CE MODULE NE FAIT PAS. Il ne charge rien, ne dessine rien, ne
     connaît ni la carte ni le DOM. Il répond à une seule question — « ce point
     est-il dans la zone dont on parle ? » — et il donne aux caches une clé qui
     porte la zone. Tout le reste est du câblage dans l'application.
     =================================================================== */

  const TYPES = Object.freeze({ MOI: "moi", RECHERCHE: "recherche" });

  /* UNE LIMITE COMMUNALE NE SE SENT PAS SOUS LES PIEDS. L'emprise rendue par
     le géocodeur est administrative : un café à trois cents mètres du panneau
     « Lille » fait partie de la sortie qu'on prépare, et l'exclure au mètre
     près donnerait une carte trouée le long des frontières. On élargit donc. */
  const MARGE_M = 1500;

  /* Sans emprise — un géocodeur avare, un lieu-dit — il faut bien décider ce
     que « cette ville » veut dire. Huit kilomètres, c'est le seuil que
     l'application utilise déjà pour dire qu'on est sur place. */
  const RAYON_DEFAUT_M = 8000;

  /* Et un plancher, pour qu'une emprise minuscule (une commune de campagne)
     ne réduise pas la zone à deux rues. */
  const RAYON_MIN_M = 3000;

  const RAYON_TERRE_M = 6371000;

  function distance(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const dLat = (bLat - aLat) * r;
    const dLng = (bLng - aLng) * r;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function nombre(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function point(p) {
    if (Array.isArray(p) && nombre(p[0]) && nombre(p[1])) return [p[0], p[1]];
    if (p && nombre(p.lat) && nombre(p.lng)) return [p.lat, p.lng];
    if (p && nombre(p.lat) && nombre(p.lon)) return [p.lat, p.lon];
    return null;
  }

  function emprisePropre(e) {
    if (!Array.isArray(e) || e.length !== 2) return null;
    const sudOuest = point(e[0]);
    const nordEst = point(e[1]);
    if (!sudOuest || !nordEst) return null;
    return [
      [Math.min(sudOuest[0], nordEst[0]), Math.min(sudOuest[1], nordEst[1])],
      [Math.max(sudOuest[0], nordEst[0]), Math.max(sudOuest[1], nordEst[1])],
    ];
  }

  /* ===================================================================
     CONSTRUIRE UNE ZONE

     Une zone est gelée : personne ne peut la modifier après coup. C'est
     volontaire — une zone qui se laisse retoucher est exactement ce qui a
     produit le mélange qu'on répare ici. Pour changer de zone, on en fabrique
     une autre et on incrémente la portée.
     =================================================================== */

  function zoneMoi(position, nom) {
    const p = point(position);
    if (!p) return null;
    return Object.freeze({
      type: TYPES.MOI,
      nom: nom || "autour de moi",
      lat: p[0], lng: p[1],
      emprise: null,
    });
  }

  function zoneRecherche(nom, centre, emprise) {
    const p = point(centre);
    if (!p) return null;
    return Object.freeze({
      type: TYPES.RECHERCHE,
      nom: nom || "",
      lat: p[0], lng: p[1],
      emprise: emprisePropre(emprise),
    });
  }

  /* Jusqu'où va « cette zone ». L'emprise commande quand on l'a : c'est la
     seule mesure qui distingue une métropole d'un village. */
  function rayonZone(zone) {
    if (!zone) return RAYON_DEFAUT_M;
    const e = zone.emprise;
    if (!e) return RAYON_DEFAUT_M;
    const demiDiagonale = distance(e[0][0], e[0][1], e[1][0], e[1][1]) / 2;
    return Math.max(RAYON_MIN_M, demiDiagonale + MARGE_M);
  }

  function dansEmprise(p, e, marge) {
    if (!e) return false;
    /* La marge est en mètres ; en degrés elle ne vaut pas la même chose en
       latitude et en longitude, et à nos latitudes l'écart est d'un tiers. */
    const dLat = marge / 111320;
    const cos = Math.cos((p[0] * Math.PI) / 180);
    const dLng = marge / (111320 * Math.max(0.2, Math.abs(cos)));
    return p[0] >= e[0][0] - dLat && p[0] <= e[1][0] + dLat &&
           p[1] >= e[0][1] - dLng && p[1] <= e[1][1] + dLng;
  }

  /* ===================================================================
     LA SEULE QUESTION QUI COMPTE

     `vue` est les bornes visibles de la carte. Elle n'est acceptée QUE pour la
     zone « autour de moi », et voici pourquoi : sans ville demandée, la carte
     EST la déclaration d'intention — on regarde le quartier d'à côté, on veut
     le voir. Dès qu'une ville est demandée, c'est elle qui commande, et faire
     entrer la vue par la fenêtre laisserait revenir exactement ce qu'on
     cherche à exclure : dézoomer depuis Lille ferait réapparaître Tourcoing.
     =================================================================== */
  function dansZone(p, zone, options) {
    const c = point(p);
    if (!c) return false;
    if (!zone) return true;              // aucune zone déclarée : on ne filtre rien
    /* QUAND ON A L'EMPRISE, ELLE SEULE DÉCIDE — et surtout pas un rayon en
       plus. Une première version acceptait « dans l'emprise OU dans le rayon »,
       ce qui était un trou : l'emprise de Lille fait treize kilomètres de large,
       donc son rayon vaut neuf kilomètres, donc le sud de Tourcoing — à six
       kilomètres et demi du centre de Lille — repassait par la porte du rayon.
       Le bug qu'on répare, exactement, avec un filtre en place. */
    if (zone.emprise) return dansEmprise(c, zone.emprise, MARGE_M) ||
      vueAccepte(c, zone, options);
    if (distance(c[0], c[1], zone.lat, zone.lng) <= rayonZone(zone)) return true;
    return vueAccepte(c, zone, options);
  }

  function vueAccepte(c, zone, options) {
    if (zone.type === TYPES.MOI && options && options.vue) {
      const v = emprisePropre(options.vue);
      if (v && dansEmprise(c, v, MARGE_M)) return true;
    }
    return false;
  }

  function filtrer(items, zone, options) {
    const liste = items || [];
    if (!zone) return liste.slice();
    return liste.filter((l) => dansZone(l, zone, options));
  }

  /* ===================================================================
     LA CLÉ DE CACHE PORTE LA ZONE

     `restaurants` comme clé de cache, c'est la même case pour Tourcoing et
     pour Lille : le premier arrivé sert le second. La clé porte donc la zone,
     la catégorie et la période — et la zone porte ses coordonnées, pas
     seulement son nom, pour que deux communes homonymes ne se confondent pas.

     Deux décimales, soit environ un kilomètre : assez fin pour séparer deux
     villes, assez grossier pour qu'un déplacement de trottoir ne jette pas le
     cache qu'on vient d'écrire.
     =================================================================== */
  /* L'IDENTIT\u00c9 D'UNE ZONE, C'EST L'ENDROIT \u2014 PAS SON NOM.

     Une premi\u00e8re version mettait le nom dans la cl\u00e9. Elle avait tort : le nom
     de commune arrive apr\u00e8s coup, par une requ\u00eate de g\u00e9ocodage inverse. La
     zone \u00ab autour de moi \u00bb s'appelait donc \u00ab ton quartier \u00bb pendant deux
     secondes, puis \u00ab Tourcoing \u00bb \u2014 m\u00eame endroit, deux identit\u00e9s, deux caches,
     et la m\u00e9moire de disponibilit\u00e9 jet\u00e9e pour rien au pire moment.

     Les coordonn\u00e9es, elles, suffisent : deux villes ne partagent pas un
     kilom\u00e8tre carr\u00e9. Le nom reste dans la zone, pour l'afficher. */
  function idZone(zone) {
    if (!zone) return "sans-zone";
    return zone.type + ":" + zone.lat.toFixed(2) + "," + zone.lng.toFixed(2);
  }

  function cleCache(zone, categorie, periode) {
    return idZone(zone) + "|" + (categorie || "tout") + "|" + (periode || "now");
  }

  /* Deux zones sont la même si elles désignent le même endroit — pas si elles
     ont été fabriquées par le même chemin. Comparer les objets ferait
     recharger la ville à chaque rendu. */
  function memeZone(a, b) {
    if (!a || !b) return a === b;
    return idZone(a) === idZone(b);
  }

  root.AutourContexte = Object.freeze({
    TYPES, MARGE_M, RAYON_DEFAUT_M, RAYON_MIN_M,
    zoneMoi, zoneRecherche, rayonZone, dansZone, filtrer,
    idZone, cleCache, memeZone, distance,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
