(function (root) {
  "use strict";

  /* ===================================================================
     LE FOND EST UN SUPPORT, PAS UN CONTENU

     Cette carte était instanciée sans `styles` : elle rendait donc le Google
     Maps par défaut — routes jaunes et blanches, zones commerciales rosées,
     et surtout la couche de POI complète, avec ses pastilles de couleur et
     ses noms d'enseignes. Autour posait ses propres marqueurs par-dessus, et
     ils se noyaient : deux systèmes d'épingles concurrents sur le même écran,
     dont un seul est cliquable et pertinent.

     Le fond redevient ce qu'il doit être : clair, gris-beige, très épuré.
     Trois décisions, dans cet ordre d'importance :

       · `poi` et `transit` éteints. Ce sont EUX le bruit — pas les couleurs.
         Un restaurant Google à côté d'un restaurant Autour, c'est la même
         information deux fois, dessinée deux fois, dont une inutile ;
       · `labels.icon` éteint partout : plus aucune pastille du fond ne peut
         être confondue avec un marqueur Autour ;
       · une palette désaturée, proche du papier de l'application, pour que
         le contraste appartienne aux éléments d'Autour et à rien d'autre.

     Les parcs gardent une teinte : ce n'est pas de la décoration, c'est un
     repère d'orientation que le gris seul ferait disparaître. Même chose pour
     l'eau et la hiérarchie des voies, qui restent lisibles en niveaux très
     rapprochés.

     À NE PAS FAIRE en modifiant ce fichier : rallumer `poi`, remettre
     `labels.icon`, ou saturer la palette. La densité d'information du fond
     n'est pas un objectif ; la lisibilité des éléments Autour, si. */
  const STYLE_MINIMAL = Object.freeze([
    { elementType:"geometry",            stylers:[{color:"#F4F3EF"}] },
    { elementType:"labels.icon",         stylers:[{visibility:"off"}] },
    { elementType:"labels.text.fill",    stylers:[{color:"#8A908A"}] },
    { elementType:"labels.text.stroke",  stylers:[{color:"#F4F3EF"},{weight:2}] },

    // le bruit : les commerces du fond concurrencent les marqueurs d'Autour
    { featureType:"poi",     stylers:[{visibility:"off"}] },
    { featureType:"transit", stylers:[{visibility:"off"}] },

    // sauf la verdure, qui sert à se repérer
    { featureType:"poi.park", elementType:"geometry", stylers:[{color:"#E7EDE3"},{visibility:"on"}] },

    { featureType:"road",          elementType:"geometry",     stylers:[{color:"#FFFFFF"}] },
    { featureType:"road",          elementType:"labels.icon",  stylers:[{visibility:"off"}] },
    { featureType:"road.arterial", elementType:"geometry",     stylers:[{color:"#FCFCFB"}] },
    { featureType:"road.highway",  elementType:"geometry",     stylers:[{color:"#EFEDE6"}] },
    { featureType:"road.local",    elementType:"labels",       stylers:[{visibility:"off"}] },

    { featureType:"administrative",     elementType:"geometry", stylers:[{visibility:"off"}] },
    { featureType:"landscape.man_made", elementType:"geometry", stylers:[{color:"#F0EFEA"}] },
    { featureType:"water",              elementType:"geometry", stylers:[{color:"#DDE6E7"}] },
    { featureType:"water", elementType:"labels.text.fill",      stylers:[{color:"#9FAEB0"}] },
  ]);

  let carte = null;
  let leaflet = null;
  let chargement = null;
  let actif = false;
  let synchronisation = false;
  let rafPlanifie = 0;        // l'image où la transformation du pane est regroupée
  let enGeste = false;        // vrai entre le premier bounds_changed et l'idle
  let finalisationGeste = false; // vrai pendant la dernière synchro Leaflet
  let vueGeste = null;        // vue Leaflet réellement rendue avant le geste
  let paneMarqueurs = null;
  let transformAvantGeste = "";
  let origineAvantGeste = "";
  let willChangeAvantGeste = "";
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
        /* `styles` est ignoré si un `mapId` est fourni — c'est pourquoi il n'y
           en a pas ici, et il ne faut pas en ajouter sans déplacer ce style
           vers la console Google. */
        styles:STYLE_MINIMAL,
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
    /* LES MARQUEURS ET LA CARTE DOIVENT ÊTRE UNE SEULE SURFACE PHYSIQUE.

       Google reçoit les gestes et anime sa propre caméra. Les marqueurs Autour
       restent dans un pane Leaflet séparé, au-dessus du fond Google. Un
       `setView` Leaflet pendant chaque image reprojette tous les marqueurs et
       relance la cascade coûteuse de l'application ; ne rien faire laisse le
       pane figé pendant le pinch. Les deux comportements sont visuellement
       faux.

       On conserve donc la dernière vue Leaflet réellement rendue comme base,
       puis on applique au `markerPane` la transformation caméra Web Mercator
       (translation + échelle). Le navigateur compose cette couche avec le
       fond Google, sans recalculer les positions individuelles. `setView` ne
       revient qu'une fois, à `idle`, pour réconcilier la vue réelle et retirer
       la transformation temporaire. */
    paneMarqueurs = typeof leaflet.getPane === "function"
      ? leaflet.getPane("markerPane") : null;

    const sauvegarderStylePane = () => {
      if (!paneMarqueurs) return;
      transformAvantGeste = paneMarqueurs.style.transform || "";
      origineAvantGeste = paneMarqueurs.style.transformOrigin || "";
      willChangeAvantGeste = paneMarqueurs.style.willChange || "";
      paneMarqueurs.style.transformOrigin = "0 0";
      paneMarqueurs.style.willChange = "transform";
    };
    const restaurerStylePane = () => {
      if (!paneMarqueurs) return;
      paneMarqueurs.style.transform = transformAvantGeste;
      paneMarqueurs.style.transformOrigin = origineAvantGeste;
      paneMarqueurs.style.willChange = willChangeAvantGeste;
      vueGeste = null;
    };
    const positionMapPane = () => {
      const mapPane = typeof leaflet.getPane === "function"
        ? leaflet.getPane("mapPane") : null;
      const conteneurCarte = typeof leaflet.getContainer === "function"
        ? leaflet.getContainer() : null;
      if (mapPane && conteneurCarte) {
        const paneRect = mapPane.getBoundingClientRect();
        const carteRect = conteneurCarte.getBoundingClientRect();
        if (Number.isFinite(paneRect.left) && Number.isFinite(paneRect.top))
          return {x:paneRect.left-carteRect.left, y:paneRect.top-carteRect.top};
      }
      if (leaflet.DomUtil && typeof leaflet.DomUtil.getPosition === "function" && mapPane)
        return leaflet.DomUtil.getPosition(mapPane);
      return {x:0, y:0};
    };
    const normaliserPositionsPane = () => {
      if (!paneMarqueurs || typeof leaflet.eachLayer !== "function" ||
          typeof leaflet.project !== "function" ||
          typeof leaflet.getCenter !== "function" ||
          typeof leaflet.getSize !== "function") return;
      const centre = leaflet.getCenter();
      const taille = leaflet.getSize();
      const zoom = leaflet.getZoom();
      if (!centre || !taille || !Number.isFinite(Number(zoom))) return;
      const centreProjete = leaflet.project(centre, zoom);
      const offsetMapPane = positionMapPane();
      /* Marker.update() arrondit la position du DOM. Cette perte d'un demi
         pixel est invisible à zoom 16, mais elle est multipliée par le scale
         pendant un pinch. On ne touche aux icônes qu'une fois, au début du
         geste, pour conserver leur projection fractionnaire de référence dans
         le repère exact du viewport ; aucune position individuelle n'est
         recalculée pendant les frames. */
      leaflet.eachLayer(layer => {
        if (!layer || typeof layer.getElement !== "function" ||
            typeof layer.getLatLng !== "function") return;
        const element = layer.getElement();
        if (!element || element.parentNode !== paneMarqueurs) return;
        /* latLngToLayerPoint() arrondit volontairement au pixel. Pour le
           geste, on veut au contraire conserver le point projeté exact avant
           que le scale du pane ne l'amplifie. */
        const projete = leaflet.project(layer.getLatLng(), zoom);
        const position = {
          x:Number(taille.x) / 2 + projete.x - centreProjete.x - offsetMapPane.x,
          y:Number(taille.y) / 2 + projete.y - centreProjete.y - offsetMapPane.y,
        };
        if (!position || !Number.isFinite(position.x) ||
            !Number.isFinite(position.y)) return;
        if (leaflet.DomUtil && typeof leaflet.DomUtil.setPosition === "function") {
          leaflet.DomUtil.setPosition(element, position);
        } else {
          element._leaflet_pos = position;
          element.style.transform = "translate3d("+position.x+"px,"+
            position.y+"px,0)";
        }
      });
    };
    const capturerVueGeste = () => {
      if (!leaflet || typeof leaflet.getCenter !== "function") return;
      const centre = leaflet.getCenter();
      const taille = typeof leaflet.getSize === "function" ? leaflet.getSize() : null;
      if (!centre || !taille || typeof leaflet.project !== "function") return;
      vueGeste = {
        centre:{lat:Number(centre.lat), lng:Number(centre.lng)},
        zoom:Number(leaflet.getZoom()),
        largeur:Number(taille.x), hauteur:Number(taille.y),
      };
      sauvegarderStylePane();
      normaliserPositionsPane();
    };
    const appliquerTransformationCamera = () => {
      if (!carte || !leaflet || !paneMarqueurs || !vueGeste) return;
      const centre = carte.getCenter();
      const zoom = Number(carte.getZoom());
      const taille = typeof leaflet.getSize === "function" ? leaflet.getSize() : null;
      if (!centre || !taille || !Number.isFinite(zoom) ||
          typeof leaflet.project !== "function") return;

      /* Dans le repère du pane, le centre de la vue de base est au centre de
         l'écran. On projette le centre Google à l'ancien zoom pour obtenir sa
         position dans ce même repère, puis on applique la transformation
         affine exacte du monde Web Mercator. */
      const baseCentre = leaflet.project(vueGeste.centre, vueGeste.zoom);
      const centreCourant = leaflet.project(
        {lat:Number(centre.lat()), lng:Number(centre.lng())}, vueGeste.zoom);
      const offsetMapPane = positionMapPane();
      const facteur = Math.pow(2, zoom - vueGeste.zoom);
      const baseX = centreCourant.x - baseCentre.x + Number(taille.x) / 2 - offsetMapPane.x;
      const baseY = centreCourant.y - baseCentre.y + Number(taille.y) / 2 - offsetMapPane.y;
      const centreX = Number(taille.x) / 2 - offsetMapPane.x;
      const centreY = Number(taille.y) / 2 - offsetMapPane.y;
      const tx = centreX - facteur * baseX;
      const ty = centreY - facteur * baseY;
      paneMarqueurs.style.transform =
        "translate3d("+tx+"px,"+ty+"px,0) scale("+facteur+")";
    };

    const appliquerVue = () => {
      rafPlanifie = 0;
      if (!carte || !leaflet) return;
      if (!finalisationGeste) {
        appliquerTransformationCamera();
        return;
      }
      const centre = carte.getCenter();
      if (!centre) return;
      synchronisation = true;
      leaflet.setView([centre.lat(), centre.lng()], carte.getZoom(), {animate:false});
      synchronisation = false;
    };
    const suivre = () => {
      if (synchronisation) return;
      if (!enGeste) {
        capturerVueGeste();
        enGeste = true;
        root.dispatchEvent(new Event("autour:google-map-gesture-start"));
      }
      /* Le style est une simple composition GPU : l'appliquer dès le signal
         Google évite qu'un snapshot ou une peinture intermédiaire voie le fond
         déjà déplacé avec le pane encore sur l'image précédente. Le RAF reste
         le filet qui regroupe le dernier état, mais aucune position de marker
         n'est recalculée ici. */
      appliquerTransformationCamera();
      if (!rafPlanifie) rafPlanifie = root.requestAnimationFrame(appliquerVue);
    };
    /* Fin du geste : la transformation reste active pendant le seul setView
       réel. Leaflet met alors à jour les coordonnées des marqueurs dans la vue
       finale ; son retrait immédiat ne peut donc produire aucun saut visuel. */
    const reconcilier = () => {
      if (rafPlanifie) { root.cancelAnimationFrame(rafPlanifie); rafPlanifie = 0; }
      enGeste = false;
      finalisationGeste = true;
      appliquerVue();
      /* La vue finale peut avoir repassé par Marker.update(), qui arrondit
         volontairement ses positions. Réutiliser la projection exacte ici,
         une seule fois, fait coïncider le dernier pixel composé avec le pane
         revenu à son état normal et supprime le saut à idle. */
      normaliserPositionsPane();
      finalisationGeste = false;
      restaurerStylePane();
      root.dispatchEvent(new Event("autour:google-map-gesture-end"));
    };
    carte.addListener("bounds_changed", suivre);
    carte.addListener("idle", reconcilier);
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
  /* La couche application demande « suis-je en train de bouger la carte ? »
     pour sauter la recomposition coûteuse tant que le geste dure. */
  function enGesteGoogle() { return actif && (enGeste || finalisationGeste); }
  root.AutourMapProviders = Object.assign(root.AutourMapProviders || {}, {
    googleMaps:Object.freeze({activer, lierLeaflet, synchroniserDepuisLeaflet, estActif, enGeste:enGesteGoogle, charger}),
  });
})(window);
