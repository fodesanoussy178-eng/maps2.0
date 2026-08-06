(function (root) {
  "use strict";

  /* ---- Couche transport ---------------------------------------------------
     Autour ne doit plus répondre « c'est à 800 m » mais « vous y êtes dans
     22 min, en partant maintenant ». Ce module expose une seule question au
     reste de l'application — combien de temps porte-à-porte — et absorbe
     derrière elle la diversité française des sources : un réseau qui publie
     du temps réel, un réseau qui n'a que des horaires théoriques, un
     territoire sans aucun flux. Aucun code appelant ne connaît le nom d'un
     réseau : on demande un trajet, on reçoit un ETA et son niveau de
     confiance.

     Rien ici n'est spécifique à un opérateur. Brancher un nouveau territoire
     = enregistrer un provider, pas modifier le classement. */

  const WALK_SPEED_M_PER_MIN = 80;      // ~4,8 km/h, allure trottoir réelle
  const BOARDING_BUFFER_MIN = 2;        // on n'arrive pas à l'arrêt pile à l'heure

  /* Un ETA porte-à-porte n'est pas un nombre : c'est une somme de segments
     dont chacun peut être faux séparément. On garde le détail pour pouvoir
     l'afficher — et pour pouvoir dire d'où vient l'incertitude. */
  const LEG_MODES = Object.freeze(["walk", "wait", "ride", "transfer"]);

  function toMinutes(seconds) {
    const value = Number(seconds);
    return Number.isFinite(value) ? Math.max(0, Math.round(value / 60)) : 0;
  }

  function distanceMeters(from, to) {
    const [aLat, aLng] = from || [];
    const [bLat, bLng] = to || [];
    if (![aLat, aLng, bLat, bLng].every((value) => Number.isFinite(Number(value)))) return NaN;
    const lat = ((Number(aLat) + Number(bLat)) / 2) * Math.PI / 180;
    const dy = (Number(bLat) - Number(aLat)) * 111000;
    const dx = (Number(bLng) - Number(aLng)) * 111000 * Math.cos(lat);
    return Math.hypot(dx, dy);
  }

  function walkMinutesFor(meters) {
    if (!Number.isFinite(meters)) return null;
    return Math.max(1, Math.round(meters / WALK_SPEED_M_PER_MIN));
  }

  /* ---- Composition de l'ETA ----------------------------------------------
     Le total affiché doit inclure marche jusqu'à l'arrêt + attente + trajet
     + correspondances + marche finale. Une durée de trajet seule ment : elle
     annonce 8 min pour un bus qu'on attend 11 min. */
  function composeEta(legs, options) {
    const opts = options || {};
    const clean = (legs || []).filter((leg) => leg && LEG_MODES.includes(leg.mode));
    const sum = (mode) => clean
      .filter((leg) => leg.mode === mode)
      .reduce((total, leg) => total + (Number(leg.minutes) || 0), 0);

    const walk = sum("walk");
    const wait = sum("wait");
    const ride = sum("ride");
    const transfer = sum("transfer");
    const rides = clean.filter((leg) => leg.mode === "ride");
    const transfers = opts.transfers != null ? Number(opts.transfers) : Math.max(0, rides.length - 1);
    const minutes = walk + wait + ride + transfer;
    const realtime = !!opts.realtime || rides.some((leg) => leg.realtime === true);

    return Object.freeze({
      minutes,
      walkMinutes: walk,
      waitMinutes: wait,
      rideMinutes: ride,
      transferMinutes: transfer,
      transfers,
      mode: rides.length ? "transit" : "walk",
      realtime,
      // « observed » = temps réel constaté, « planned » = horaire théorique,
      // « estimated » = on a calculé nous-mêmes faute de mieux
      confidence: opts.confidence || (realtime ? "observed" : (rides.length ? "planned" : "estimated")),
      provider: opts.provider || null,
      network: opts.network || null,
      disruption: opts.disruption || null,
      lines: rides.map((leg) => leg.line).filter(Boolean),
      legs: Object.freeze(clean.map((leg) => Object.freeze(Object.assign({}, leg)))),
    });
  }

  /* ---- Registre de providers ---------------------------------------------
     Le territoire décide du provider, pas l'inverse. `covers` reçoit la
     position de l'utilisateur ; `priority` tranche quand plusieurs
     répondent — un réseau local bat un agrégateur national, qui bat la
     marche. */
  const registry = [];

  function registerProvider(provider) {
    if (!provider || typeof provider.plan !== "function") {
      throw new TypeError("Un TransitProvider doit exposer plan({from,to,departAt})");
    }
    const entry = Object.assign({
      id: "provider-" + (registry.length + 1),
      label: "Réseau",
      realtime: false,
      priority: 0,
      covers: () => true,
    }, provider);
    // ré-enregistrer un id remplace : recharger une config ne doit pas
    // empiler deux fois le même réseau
    const existing = registry.findIndex((item) => item.id === entry.id);
    if (existing === -1) registry.push(entry);
    else registry[existing] = entry;
    return entry;
  }

  function unregisterProvider(id) {
    const index = registry.findIndex((item) => item.id === id);
    if (index !== -1) registry.splice(index, 1);
  }

  function listProviders() {
    return registry.slice();
  }

  function covers(provider, position) {
    try {
      return provider.covers(position) !== false;
    } catch (error) {
      return false;
    }
  }

  /* Providers candidats pour une position, du plus spécifique au moins. */
  function providersFor(position) {
    return registry
      .filter((provider) => covers(provider, position))
      .sort((a, b) =>
        (b.priority || 0) - (a.priority || 0) ||
        (b.realtime ? 1 : 0) - (a.realtime ? 1 : 0));
  }

  function resolveProvider(position) {
    return providersFor(position)[0] || walkProvider;
  }

  /* ---- Provider marche ----------------------------------------------------
     Le seul qui ne peut jamais échouer, et donc le repli final. Il ne
     prétend pas remplacer un réseau : il donne une durée honnête, jamais
     sous-estimée, quand on n'a rien d'autre. */
  const walkProvider = Object.freeze({
    id: "walk",
    label: "À pied",
    realtime: false,
    priority: -100,
    covers: () => true,
    async plan(request) {
      const meters = distanceMeters(request.from, request.to);
      const minutes = walkMinutesFor(meters);
      if (minutes == null) return null;
      return composeEta([{mode: "walk", minutes}], {
        provider: "walk",
        confidence: "estimated",
      });
    },
  });

  /* ---- Provider national (Navitia) ---------------------------------------
     Navitia agrège les GTFS déclarés sur transport.data.gouv.fr et, là où le
     réseau les publie, les flux GTFS-RT / SIRI. Il rend directement un
     itinéraire porte-à-porte, ce qui évite d'écrire un moteur de
     correspondances côté client.

     Il faut une clé (api.navitia.io). Sans clé, ce provider ne s'enregistre
     pas et la couche retombe sur la marche : l'application reste correcte,
     elle est seulement moins précise. */
  const FRANCE_BBOX = Object.freeze({south: 41.2, west: -5.3, north: 51.2, east: 9.7});

  function inBBox(position, box) {
    const [lat, lng] = position || [];
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
      Number(lat) >= box.south && Number(lat) <= box.north &&
      Number(lng) >= box.west && Number(lng) <= box.east;
  }

  function navitiaDateTime(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, "0");
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) +
      "T" + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  }

  /* Navitia nomme ses sections autrement que nous ; on traduit vers le
     vocabulaire porte-à-porte plutôt que d'exposer son modèle. */
  function navitiaLegMode(section) {
    if (section.type === "public_transport" || section.type === "on_demand_transport") return "ride";
    if (section.type === "waiting") return "wait";
    if (section.type === "transfer") return "transfer";
    if (section.type === "street_network" || section.type === "crow_fly") return "walk";
    return null;
  }

  function navitiaJourneyToEta(journey, providerId) {
    const sections = Array.isArray(journey.sections) ? journey.sections : [];
    const legs = sections.map((section) => {
      const mode = navitiaLegMode(section);
      if (!mode) return null;
      const info = section.display_informations || {};
      return {
        mode,
        minutes: toMinutes(section.duration),
        line: info.code || info.label || null,
        headsign: info.direction || null,
        network: info.network || null,
        realtime: section.data_freshness === "realtime",
      };
    }).filter(Boolean);

    if (!legs.length) return null;

    const disrupted = journey.status && journey.status !== "" && journey.status !== "NO_SERVICE"
      ? journey.status
      : null;

    return composeEta(legs, {
      provider: providerId,
      transfers: Number.isFinite(Number(journey.nb_transfers)) ? Number(journey.nb_transfers) : null,
      network: legs.map((leg) => leg.network).find(Boolean) || null,
      disruption: journey.status === "NO_SERVICE" ? "NO_SERVICE" : disrupted,
    });
  }

  function createNavitiaProvider(config) {
    const settings = config || {};
    if (!settings.token) return null;
    const endpoint = settings.endpoint || "https://api.navitia.io/v1";
    const fetchImpl = settings.fetch || (typeof fetch === "function" ? fetch.bind(root) : null);
    if (!fetchImpl) return null;

    return {
      id: settings.id || "navitia",
      label: settings.label || "Transports en commun",
      realtime: true,
      priority: settings.priority != null ? settings.priority : 10,
      covers: settings.covers || ((position) => inBBox(position, FRANCE_BBOX)),
      async plan(request) {
        const {from, to, departAt, signal} = request;
        const params = new URLSearchParams({
          from: Number(from[1]) + ";" + Number(from[0]),
          to: Number(to[1]) + ";" + Number(to[0]),
          datetime: navitiaDateTime(departAt || Date.now()),
          datetime_represents: "departure",
          // sans temps réel, un retard de 9 min reste invisible : c'est
          // exactement ce qu'on essaie d'arrêter d'afficher
          data_freshness: "realtime",
          max_nb_journeys: "1",
        });
        const response = await fetchImpl(endpoint + "/journeys?" + params.toString(), {
          headers: {Authorization: settings.token},
          signal,
        });
        if (!response.ok) throw new Error("Navitia " + response.status);
        const payload = await response.json();
        const journey = (payload.journeys || [])[0];
        if (!journey) return null;
        return navitiaJourneyToEta(journey, settings.id || "navitia");
      },
    };
  }

  /* ---- Cache -------------------------------------------------------------
     Classer 40 résultats ne doit pas déclencher 40 requêtes à chaque
     re-rendu. On arrondit la destination à ~50 m et la minute de départ. */
  function createCache(ttlMs) {
    const ttl = Number(ttlMs) || 120000;
    const store = new Map();
    return {
      key(from, to, departAt) {
        const round = (value) => Math.round(Number(value) * 2000) / 2000;
        return [round(from[0]), round(from[1]), round(to[0]), round(to[1]),
          Math.floor(Number(departAt) / 60000)].join(",");
      },
      get(key) {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.at > ttl) { store.delete(key); return undefined; }
        return entry.value;
      },
      set(key, value) {
        store.set(key, {at: Date.now(), value});
        return value;
      },
      clear() { store.clear(); },
      get size() { return store.size; },
    };
  }

  const defaultCache = createCache(120000);

  /* ---- Point d'entrée unique ---------------------------------------------
     Essaie les providers du territoire dans l'ordre, et retombe sur la
     marche dès qu'un flux manque ou tombe. Un réseau injoignable dégrade la
     précision, il ne casse jamais la recherche. */
  async function planTrip(request) {
    const {from, to} = request || {};
    if (!from || !to) return null;
    const departAt = Number(request.departAt) || Date.now();
    const cache = request.cache === null ? null : (request.cache || defaultCache);
    const key = cache && cache.key(from, to, departAt);
    if (cache) {
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
    }

    const candidates = providersFor(from).concat(walkProvider);
    for (const provider of candidates) {
      try {
        const eta = await provider.plan({from, to, departAt, signal: request.signal});
        if (eta && Number.isFinite(eta.minutes)) {
          // un trajet en transport plus lent que la marche n'aide personne
          const walking = walkMinutesFor(distanceMeters(from, to));
          const best = (walking != null && eta.mode === "transit" && walking <= eta.minutes)
            ? composeEta([{mode: "walk", minutes: walking}], {provider: "walk", confidence: "estimated"})
            : eta;
          return cache ? cache.set(key, best) : best;
        }
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        // provider muet : on descend d'un cran, sans bruit pour l'utilisateur
      }
    }
    return cache ? cache.set(key, null) : null;
  }

  /* Enregistre les providers disponibles pour la configuration courante.
     Appelé au démarrage ; sûr à rappeler (les ids remplacent). */
  function configure(config) {
    const settings = config || {};
    const navitia = createNavitiaProvider(settings.navitia);
    if (navitia) registerProvider(navitia);
    else unregisterProvider(settings.navitia && settings.navitia.id ? settings.navitia.id : "navitia");
    return listProviders();
  }

  root.AutourTransit = Object.freeze({
    WALK_SPEED_M_PER_MIN,
    BOARDING_BUFFER_MIN,
    LEG_MODES,
    FRANCE_BBOX,
    distanceMeters,
    walkMinutesFor,
    composeEta,
    registerProvider,
    unregisterProvider,
    listProviders,
    providersFor,
    resolveProvider,
    walkProvider,
    createNavitiaProvider,
    navitiaJourneyToEta,
    createCache,
    planTrip,
    configure,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
