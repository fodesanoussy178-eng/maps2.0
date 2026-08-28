(function(root) {
  "use strict";
  const STYLE_MINIMAL = Object.freeze([
    { elementType: "geometry", stylers: [{ color: "#F4F3EF" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#8A908A" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#F4F3EF" }, { weight: 2 }] },
    // le bruit : les commerces du fond concurrencent les marqueurs d'Autour
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    // sauf la verdure, qui sert à se repérer
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#E7EDE3" }, { visibility: "on" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
    { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#FCFCFB" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#EFEDE6" }] },
    { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#F0EFEA" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#DDE6E7" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9FAEB0" }] }
  ]);
  let carte = null;
  let leaflet = null;
  let lignesItineraire = [];
  let chargement = null;
  let actif = false;
  let synchronisation = false;
  let rafPlanifie = 0;
  let enGeste = false;
  let conteneur = null;
  let authRefusee = false;
  let surveillanceAuthInstallee = false;
  function desactiver() {
    effacerItineraire();
    actif = false;
    carte = null;
    if (conteneur) {
      conteneur.classList.remove("avec-google-map");
      const fond = conteneur.querySelector("#google-map-background");
      if (fond) fond.replaceChildren();
    }
    root.dispatchEvent(new Event("autour:google-map-failed"));
  }
  function effacerItineraire() {
    const anciennes = lignesItineraire;
    lignesItineraire = [];
    anciennes.forEach((ligne) => {
      try {
        ligne.setMap(null);
      } catch (e) {
      }
    });
  }
  function cheminItineraire(segment) {
    return (segment && Array.isArray(segment.coords) ? segment.coords : []).map((point) => ({ lat: Number(point[0]), lng: Number(point[1]) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  }
  function dessinerItineraire(segments) {
    const Polyline = root.google && root.google.maps && root.google.maps.Polyline;
    if (!actif || !carte || typeof Polyline !== "function") return false;
    effacerItineraire();
    (Array.isArray(segments) ? segments : []).forEach((segment) => {
      const path = cheminItineraire(segment);
      if (path.length < 2) return;
      lignesItineraire.push(new Polyline({
        map: carte,
        path,
        clickable: false,
        geodesic: false,
        zIndex: 1e3,
        strokeColor: "#FF4A17",
        strokeOpacity: 0.85,
        strokeWeight: 3
      }));
    });
    return lignesItineraire.length > 0;
  }
  function cadrerItineraire(points, options) {
    const Bounds = root.google && root.google.maps && root.google.maps.LatLngBounds;
    if (!actif || !carte || typeof Bounds !== "function" || !Array.isArray(points) || !points.length)
      return false;
    const bornes = new Bounds();
    points.forEach((point) => {
      const lat = Number(point[0]), lng = Number(point[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) bornes.extend({ lat, lng });
    });
    const o = options || {};
    carte.fitBounds(bornes, { top: o.top || 0, right: o.right || 0, bottom: o.bottom || 0, left: o.left || 0 });
    if (Number.isFinite(o.maxZoom) && carte.getZoom() > o.maxZoom) carte.setZoom(o.maxZoom);
    return true;
  }
  function surveillerAuth() {
    if (surveillanceAuthInstallee) return;
    surveillanceAuthInstallee = true;
    const precedent = root.gm_authFailure;
    root.gm_authFailure = function() {
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
      const callback = "__autourGoogleMapsReady";
      const precedent = root[callback];
      root[callback] = () => {
        if (typeof precedent === "function") precedent();
        terminer(root.google && root.google.maps || null);
      };
      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey) + "&libraries=places&language=fr&region=FR&v=weekly&loading=async&callback=" + callback;
      script.onerror = () => terminer(null);
      document.head.appendChild(script);
      root.setTimeout(() => terminer(null), 6e3);
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
        center: { lat: centre[0], lng: centre[1] },
        zoom,
        disableDefaultUI: true,
        clickableIcons: false,
        keyboardShortcuts: false,
        gestureHandling: "greedy",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        /* `styles` est ignoré si un `mapId` est fourni — c'est pourquoi il n'y
           en a pas ici, et il ne faut pas en ajouter sans déplacer ce style
           vers la console Google. */
        styles: STYLE_MINIMAL
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
    const appliquerVue = () => {
      rafPlanifie = 0;
      if (!carte || !leaflet) return;
      const centre = carte.getCenter();
      if (!centre) return;
      synchronisation = true;
      leaflet.setView([centre.lat(), centre.lng()], carte.getZoom(), { animate: false });
      synchronisation = false;
    };
    const suivre = () => {
      if (synchronisation) return;
      enGeste = true;
      if (!rafPlanifie) rafPlanifie = root.requestAnimationFrame(appliquerVue);
    };
    const reconcilier = () => {
      if (rafPlanifie) {
        root.cancelAnimationFrame(rafPlanifie);
        rafPlanifie = 0;
      }
      enGeste = false;
      appliquerVue();
    };
    carte.addListener("bounds_changed", suivre);
    carte.addListener("idle", reconcilier);
    carte.addListener("click", () => root.dispatchEvent(new Event("autour:google-map-click")));
  }
  function synchroniserDepuisLeaflet(leaflet2) {
    if (!actif || !carte || !leaflet2 || synchronisation) return;
    const centre = leaflet2.getCenter();
    synchronisation = true;
    carte.setCenter({ lat: centre.lat, lng: centre.lng });
    carte.setZoom(leaflet2.getZoom());
    root.setTimeout(() => {
      synchronisation = false;
    }, 0);
  }
  function estActif() {
    return actif;
  }
  function enGesteGoogle() {
    return actif && enGeste;
  }
  root.AutourMapProviders = Object.assign(root.AutourMapProviders || {}, {
    googleMaps: Object.freeze({
      activer,
      lierLeaflet,
      synchroniserDepuisLeaflet,
      estActif,
      enGeste: enGesteGoogle,
      charger,
      dessinerItineraire,
      effacerItineraire,
      cadrerItineraire
    })
  });
})(window);
