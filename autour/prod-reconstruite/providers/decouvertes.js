(function(root) {
  "use strict";
  const CHEMIN = "/api/decouvertes";
  function normaliserNom(valeur) {
    const noyau = root.AutourCore;
    if (noyau && typeof noyau.normaliserNomLieu === "function") {
      return noyau.normaliserNomLieu(valeur);
    }
    return String(valeur || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function rapprocher(decouverte, lieux) {
    const cible = normaliserNom(decouverte && decouverte.titre);
    if (!cible || cible.length < 4) return null;
    const liste = Array.isArray(lieux) ? lieux : [];
    for (const lieu of liste) {
      if (normaliserNom(lieu.titre || lieu.title) === cible) return lieu;
    }
    return null;
  }
  function repartir(items, lieux) {
    const ancrees = [], sansLieu = [];
    (items || []).forEach((item) => {
      const lieu = rapprocher(item, lieux);
      if (lieu) ancrees.push(Object.assign({}, item, {
        lat: lieu.lat,
        lng: lieu.lng,
        positionConnue: true,
        lieuId: lieu.id
      }));
      else sansLieu.push(item);
    });
    return { ancrees, sansLieu };
  }
  async function autour(lat, lng, options) {
    const o = options || {};
    const parametres = new URLSearchParams({
      lat: Number(lat).toFixed(2),
      lng: Number(lng).toFixed(2),
      angle: o.angle || "sortir"
    });
    if (o.ville) parametres.set("ville", String(o.ville).slice(0, 60));
    try {
      const r = await fetch(CHEMIN + "?" + parametres.toString(), { signal: o.signal });
      if (!r.ok) return { items: [], actif: false };
      const json = await r.json();
      return { items: Array.isArray(json.items) ? json.items : [], actif: !!json.actif };
    } catch (e) {
      return { items: [], actif: false };
    }
  }
  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    decouvertes: Object.freeze({ autour, repartir, rapprocher, normaliserNom })
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
