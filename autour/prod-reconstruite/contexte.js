(function(root) {
  "use strict";
  const TYPES = Object.freeze({ MOI: "moi", RECHERCHE: "recherche" });
  const MARGE_M = 1500;
  const RAYON_DEFAUT_M = 8e3;
  const RAYON_MIN_M = 3e3;
  const RAYON_TERRE_M = 6371e3;
  function distance(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const dLat = (bLat - aLat) * r;
    const dLng = (bLng - aLng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
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
      [Math.max(sudOuest[0], nordEst[0]), Math.max(sudOuest[1], nordEst[1])]
    ];
  }
  function zoneMoi(position, nom) {
    const p = point(position);
    if (!p) return null;
    return Object.freeze({
      type: TYPES.MOI,
      nom: nom || "autour de moi",
      lat: p[0],
      lng: p[1],
      emprise: null
    });
  }
  function zoneRecherche(nom, centre, emprise) {
    const p = point(centre);
    if (!p) return null;
    return Object.freeze({
      type: TYPES.RECHERCHE,
      nom: nom || "",
      lat: p[0],
      lng: p[1],
      emprise: emprisePropre(emprise)
    });
  }
  function rayonZone(zone) {
    if (!zone) return RAYON_DEFAUT_M;
    const e = zone.emprise;
    if (!e) return RAYON_DEFAUT_M;
    const demiDiagonale = distance(e[0][0], e[0][1], e[1][0], e[1][1]) / 2;
    return Math.max(RAYON_MIN_M, demiDiagonale + MARGE_M);
  }
  function dansEmprise(p, e, marge) {
    if (!e) return false;
    const dLat = marge / 111320;
    const cos = Math.cos(p[0] * Math.PI / 180);
    const dLng = marge / (111320 * Math.max(0.2, Math.abs(cos)));
    return p[0] >= e[0][0] - dLat && p[0] <= e[1][0] + dLat && p[1] >= e[0][1] - dLng && p[1] <= e[1][1] + dLng;
  }
  function dansZone(p, zone, options) {
    const c = point(p);
    if (!c) return false;
    if (!zone) return true;
    if (zone.emprise) return dansEmprise(c, zone.emprise, MARGE_M) || vueAccepte(c, zone, options);
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
  function idZone(zone) {
    if (!zone) return "sans-zone";
    return zone.type + ":" + zone.lat.toFixed(2) + "," + zone.lng.toFixed(2);
  }
  function cleCache(zone, categorie, periode) {
    return idZone(zone) + "|" + (categorie || "tout") + "|" + (periode || "now");
  }
  function memeZone(a, b) {
    if (!a || !b) return a === b;
    return idZone(a) === idZone(b);
  }
  root.AutourContexte = Object.freeze({
    TYPES,
    MARGE_M,
    RAYON_DEFAUT_M,
    RAYON_MIN_M,
    zoneMoi,
    zoneRecherche,
    rayonZone,
    dansZone,
    filtrer,
    idZone,
    cleCache,
    memeZone,
    distance
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
