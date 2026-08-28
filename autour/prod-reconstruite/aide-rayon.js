(function(root) {
  "use strict";
  const PALIERS = Object.freeze([1200, 3e3, 5e3, 1e4, 2e4]);
  const SUFFISANT = 3;
  const premier = () => PALIERS[0];
  function palierSuivant(courant) {
    const i = PALIERS.indexOf(Number(courant));
    if (i < 0) return PALIERS.find((p) => p > Number(courant)) || null;
    return i + 1 < PALIERS.length ? PALIERS[i + 1] : null;
  }
  const dernier = (courant) => palierSuivant(courant) === null;
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
      dernier: suivant === null
    });
  }
  function portee(resultats) {
    const distances = (resultats || []).map((l) => Number(l && l.rankDistance)).filter((d) => Number.isFinite(d) && d >= 0);
    if (!distances.length) return null;
    return { min: Math.min(...distances), max: Math.max(...distances) };
  }
  function annonce(resultats, palier) {
    if (Number(palier) <= premier()) return null;
    const p = portee(resultats);
    if (!p || !(resultats || []).length) return null;
    const km = Math.max(1, Math.ceil(p.max / 1e3));
    return {
      elargi: true,
      palier: Number(palier),
      distanceMaxM: p.max,
      texte: "Aucun r\xE9sultat tr\xE8s proche. Voici les aides disponibles \xE0 moins de " + km + " km."
    };
  }
  const plan = () => PALIERS.slice();
  root.AutourAideRayon = Object.freeze({
    PALIERS,
    SUFFISANT,
    premier,
    palierSuivant,
    dernier,
    evaluer,
    portee,
    annonce,
    plan
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
