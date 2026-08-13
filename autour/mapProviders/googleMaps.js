(function (root) {
  "use strict";

  let carte = null;
  let leaflet = null;
  let chargement = null;
  let actif = false;
  let synchronisation = false;
  let conteneur = null;
  let authRefusee = false;
  let surveillanceAuthInstallee = false;

  /* Le SDK peut se charger correctement puis refuser d'afficher une carte
     (référent Preview non autorisé, clé désactivée…). Dans ce cas `onload`
     suffit à tort à déclarer Google prêt. On écoute le signal officiel et on
     rend immédiatement la main au fond indépendant, sans jamais y afficher
     ensuite des données Places. */
  function desactiver() {
    actif = false;
    carte = null;
    if (conteneur) {
      conteneur.classList.remove("avec-google-map");
      const fond = conteneur.querySelector("#google-map-background");
      if (fond) fond.replaceChildren();
    }
    root.dispatchEvent(new Event("autour:google-map-failed"));
  }
  function surveillerAuth() {
    if (surveillanceAuthInstallee) return;
    surveillanceAuthInstallee = true;
    const precedent = root.gm_authFailure;
    root.gm_authFailure = function () {
      authRefusee = true;
      desactiver();
      if (typeof precedent === "function") precedent();
    };
  }

  function charger(apiKey) {
    if (root.google && root.google.maps) return Promise.resolve(root.google.maps);
    if (chargement) return chargement;
    if (!apiKey) return Promise.resolve(null);
    surveillerAuth();
    chargement = new Promise((resolve) => {
      let fini = false;
      const terminer = (value) => {
        if (fini) return;
        fini = true;
        resolve(value);
      };
      /* `loading=async` est le mode recommandé par Google : l'événement
         `load` du script n'indique plus que l'API est prête. Le callback,
         lui, ne part qu'une fois `google.maps` initialisé. */
      const callback = "__autourGoogleMapsReady";
      const precedent = root[callback];
      root[callback] = () => {
        if (typeof precedent === "function") precedent();
        terminer(root.google && root.google.maps || null);
      };
      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) +
        "&libraries=places&language=fr&region=FR&v=weekly&loading=async&callback=" + callback;
      script.onerror = () => terminer(null);
      document.head.appendChild(script);
      root.setTimeout(() => terminer(null), 6000);
    });
    return chargement;
  }

  async function activer(container, centre, zoom, apiKey) {
    const maps = await charger(apiKey);
    if (!maps || !container) return false;
    authRefusee = false;
    conteneur = container;
    let fond = container.querySelector("#google-map-background");
    if (!fond) {
      fond = document.createElement("div");
      fond.id = "google-map-background";
      fond.setAttribute("aria-hidden", "true");
      container.prepend(fond);
    }
    try {
      carte = new maps.Map(fond, {
        center:{lat:centre[0], lng:centre[1]}, zoom,
        disableDefaultUI:true, clickableIcons:false, keyboardShortcuts:false,
        gestureHandling:"greedy", mapTypeControl:false, streetViewControl:false,
        fullscreenControl:false,
      });
    } catch (e) {
      desactiver();
      return false;
    }
    await new Promise((resolve) => root.setTimeout(resolve, 150));
    if (authRefusee) return false;
    actif = true;
    container.classList.add("avec-google-map");
    return true;
  }

  function lierLeaflet(instance) {
    leaflet = instance || null;
    if (!carte || !leaflet || !root.google || !root.google.maps) return;
    carte.addListener("idle", () => {
      if (synchronisation) return;
      const centre = carte.getCenter();
      if (!centre) return;
      synchronisation = true;
      leaflet.setView([centre.lat(), centre.lng()], carte.getZoom(), {animate:false});
      root.setTimeout(() => { synchronisation = false; }, 0);
    });
    carte.addListener("click", () => root.dispatchEvent(new Event("autour:google-map-click")));
  }

  function synchroniserDepuisLeaflet(leaflet) {
    if (!actif || !carte || !leaflet || synchronisation) return;
    const centre = leaflet.getCenter();
    synchronisation = true;
    carte.setCenter({lat:centre.lat, lng:centre.lng});
    carte.setZoom(leaflet.getZoom());
    root.setTimeout(() => { synchronisation = false; }, 0);
  }

  function estActif() { return actif; }
  root.AutourMapProviders = Object.assign(root.AutourMapProviders || {}, {
    googleMaps:Object.freeze({activer, lierLeaflet, synchroniserDepuisLeaflet, estActif, charger}),
  });
})(window);
