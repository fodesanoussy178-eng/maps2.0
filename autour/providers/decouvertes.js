(function (root) {
  "use strict";

  /* Les découvertes ancrées, côté navigateur.

     Ce fournisseur est le seul d'Autour dont les items n'ont PAS de position.
     C'est volontaire : la route ne demande pas de coordonnées à un modèle,
     parce qu'un modèle à qui l'on réclame une latitude en produit une, fausse
     et plausible — et un marqueur faux sur une carte est pire que pas de
     marqueur du tout.

     Une découverte est donc rapprochée d'un lieu que l'application connaît
     déjà, par son nom normalisé. Si le rapprochement réussit, elle enrichit ce
     lieu — une raison de plus d'y aller. S'il échoue, elle reste une
     information sans marqueur, et l'appelant décide s'il l'affiche.

     Rien ici n'est attendu par le premier rendu. */

  const CHEMIN = "/api/decouvertes";

  function normaliserNom(valeur) {
    const noyau = root.AutourCore;
    if (noyau && typeof noyau.normaliserNomLieu === "function") {
      return noyau.normaliserNomLieu(valeur);
    }
    return String(valeur || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* La découverte parle-t-elle d'un lieu qu'on a déjà sous la main ? Le nom
     normalisé suffit : c'est la même question que la déduplication pose, avec
     les mêmes outils, et on ne rapproche jamais sur une ressemblance vague. */
  function rapprocher(decouverte, lieux) {
    const cible = normaliserNom(decouverte && decouverte.titre);
    if (!cible || cible.length < 4) return null;
    const liste = Array.isArray(lieux) ? lieux : [];
    for (const lieu of liste) {
      if (normaliserNom(lieu.titre || lieu.title) === cible) return lieu;
    }
    return null;
  }

  /* Rend deux listes séparées plutôt qu'un mélange :
       · `ancrees`  — des découvertes rattachées à un lieu connu, donc
                      posables sur la carte ;
       · `sansLieu` — des informations vraies dont on ignore la position.
     L'appelant traite les deux différemment ; les confondre reviendrait à
     laisser croire qu'on sait où est quelque chose qu'on ne sait pas situer. */
  function repartir(items, lieux) {
    const ancrees = [], sansLieu = [];
    (items || []).forEach((item) => {
      const lieu = rapprocher(item, lieux);
      if (lieu) ancrees.push(Object.assign({}, item, {
        lat: lieu.lat, lng: lieu.lng, positionConnue: true, lieuId: lieu.id,
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
      angle: o.angle || "sortir",
    });
    if (o.ville) parametres.set("ville", String(o.ville).slice(0, 60));
    try {
      const r = await fetch(CHEMIN + "?" + parametres.toString(), { signal: o.signal });
      if (!r.ok) return { items: [], actif: false };
      const json = await r.json();
      return { items: Array.isArray(json.items) ? json.items : [], actif: !!json.actif };
    } catch (e) {
      /* Une source secondaire qui échoue ne dit rien à personne : l'écran
         reste exactement ce qu'il était. */
      return { items: [], actif: false };
    }
  }

  root.AutourProviders = Object.assign(root.AutourProviders || {}, {
    decouvertes: Object.freeze({ autour, repartir, rapprocher, normaliserNom }),
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
