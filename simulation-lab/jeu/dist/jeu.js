"use strict";
(() => {
  // noyau/ids.ts
  function creerCompteur(depart = 1) {
    return { prochain: depart };
  }
  function attribuer(compteur) {
    const valeur = compteur.prochain;
    compteur.prochain += 1;
    return valeur;
  }

  // noyau/alea.ts
  function melanger32(graine) {
    let x = graine + 2654435769 | 0;
    x = Math.imul(x ^ x >>> 16, 569420461);
    x = Math.imul(x ^ x >>> 15, 1935289751);
    return (x ^ x >>> 15) >>> 0;
  }
  function hacher(...cles) {
    let h = 2166136261;
    for (const cle of cles) {
      if (typeof cle === "number") {
        h = melanger32(h ^ (cle | 0));
      } else {
        for (let i = 0; i < cle.length; i += 1) {
          h = Math.imul(h ^ cle.charCodeAt(i), 16777619) >>> 0;
        }
        h = melanger32(h);
      }
    }
    return h >>> 0;
  }
  function creerAlea(graine) {
    const etat = {
      a: melanger32(graine),
      b: melanger32(graine ^ 2654435769),
      c: melanger32(graine ^ 2246822507),
      d: melanger32(graine ^ 3266489909)
    };
    for (let i = 0; i < 8; i += 1) suivant(etat);
    return etat;
  }
  function creerFlux(graineRacine, flux, ...cles) {
    return creerAlea(hacher(graineRacine, flux, ...cles));
  }
  function suivant(r) {
    const t = (r.a + r.b | 0) + r.d | 0;
    r.d = r.d + 1 | 0;
    r.a = r.b ^ r.b >>> 9;
    r.b = r.c + (r.c << 3) | 0;
    r.c = r.c << 21 | r.c >>> 11;
    r.c = r.c + t | 0;
    return t >>> 0;
  }
  function flottant(r) {
    return suivant(r) / 4294967296;
  }
  function entier(r, min, maxExclu) {
    const etendue = maxExclu - min;
    if (etendue <= 0) return min;
    return min + suivant(r) % etendue;
  }
  function choisir(r, elements) {
    if (elements.length === 0) return void 0;
    return elements[entier(r, 0, elements.length)];
  }
  function choisirPondere(r, elements, poids) {
    let total = 0;
    for (let i = 0; i < elements.length; i += 1) {
      const p = poids[i] ?? 0;
      if (p > 0) total += p;
    }
    if (total <= 0) return void 0;
    let seuil2 = flottant(r) * total;
    for (let i = 0; i < elements.length; i += 1) {
      const p = poids[i] ?? 0;
      if (p <= 0) continue;
      seuil2 -= p;
      if (seuil2 <= 0) return elements[i];
    }
    return elements[elements.length - 1];
  }
  function melangerTableau(r, elements) {
    const copie = elements.slice();
    for (let i = copie.length - 1; i > 0; i -= 1) {
      const j = entier(r, 0, i + 1);
      const ci = copie[i];
      const cj = copie[j];
      if (ci === void 0 || cj === void 0) continue;
      copie[i] = cj;
      copie[j] = ci;
    }
    return copie;
  }
  function normal(r, moyenne, ecartType) {
    const u1 = Math.max(flottant(r), 1e-9);
    const u2 = flottant(r);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return moyenne + ecartType * Math.max(-4, Math.min(4, z));
  }

  // noyau/temps.ts
  var MINUTES_PAR_TICK = 5;
  var TICKS_PAR_HEURE = 12;
  var TICKS_PAR_JOUR = 288;
  var TICKS_PAR_SEMAINE = TICKS_PAR_JOUR * 7;
  var ANNEE_EPOQUE = 2e3;
  var JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var JOURS_PAR_AN = 365;
  var TICKS_PAR_AN = JOURS_PAR_AN * TICKS_PAR_JOUR;
  var NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  function calendrier(tick, anneeEpoque = ANNEE_EPOQUE) {
    const jourTotal = Math.floor(tick / TICKS_PAR_JOUR);
    const dansLeJour = tick - jourTotal * TICKS_PAR_JOUR;
    const annee = Math.floor(jourTotal / JOURS_PAR_AN);
    const jourAnnee = jourTotal - annee * JOURS_PAR_AN;
    let mois = 0;
    let reste = jourAnnee;
    while (mois < 12) {
      const longueur = JOURS_PAR_MOIS[mois] ?? 30;
      if (reste < longueur) break;
      reste -= longueur;
      mois += 1;
    }
    const heure = Math.floor(dansLeJour / TICKS_PAR_HEURE);
    const minute = (dansLeJour - heure * TICKS_PAR_HEURE) * MINUTES_PAR_TICK;
    return {
      annee: anneeEpoque + annee,
      mois: mois + 1,
      jour: reste + 1,
      heure,
      minute,
      jourAnnee,
      // Le 1er janvier de l'année d'époque est un lundi : choix arbitraire, mais
      // fixe, donc les week-ends tombent toujours au même endroit d'une partie
      // rejouée à l'autre.
      jourSemaine: jourTotal % 7,
      saison: saisonDuJour(jourAnnee)
    };
  }
  function saisonDuJour(jourAnnee) {
    if (jourAnnee < 59 || jourAnnee >= 334) return "hiver";
    if (jourAnnee < 151) return "printemps";
    if (jourAnnee < 243) return "ete";
    return "automne";
  }
  function nomJourSemaine(jourSemaine) {
    return NOMS_JOURS[jourSemaine % 7] ?? "lundi";
  }
  function age(tickNaissance, tick) {
    return Math.floor((tick - tickNaissance) / TICKS_PAR_AN);
  }
  function heureDecimale(tick) {
    const dansLeJour = tick % TICKS_PAR_JOUR;
    return dansLeJour / TICKS_PAR_HEURE;
  }
  var TICKS_MAX_PAR_IMAGE = 600;
  function ticksDus(vitesse, deltaMsReel, reste = 0) {
    if (vitesse === 0 || deltaMsReel <= 0) {
      return { ticks: 0, reste, sature: false };
    }
    const exact = reste + deltaMsReel * vitesse / (MINUTES_PAR_TICK * 1e3);
    const ticks = Math.floor(exact);
    if (ticks > TICKS_MAX_PAR_IMAGE) {
      return { ticks: TICKS_MAX_PAR_IMAGE, reste: 0, sature: true };
    }
    return { ticks, reste: exact - ticks, sature: false };
  }

  // noyau/echelles.ts
  var PAS = {
    micro: 1,
    meso: TICKS_PAR_HEURE,
    macro: TICKS_PAR_JOUR,
    dormant: TICKS_PAR_SEMAINE,
    absent: 0
  };
  var PLAFONDS = {
    micro: 12,
    meso: 45,
    macro: Number.POSITIVE_INFINITY,
    dormant: Number.POSITIVE_INFINITY,
    absent: Number.POSITIVE_INFINITY
  };
  function creneau(id, pas) {
    if (pas <= 1) return 0;
    return hacher("creneau", id) % pas;
  }
  function doitMettreAJour(echelle, id, tick) {
    const pas = PAS[echelle];
    if (pas <= 0) return false;
    if (pas === 1) return true;
    return tick % pas === creneau(id, pas);
  }

  // etat/personnage.ts
  var BESOINS = [
    "energie",
    "faim",
    "hygiene",
    "social",
    "plaisir",
    "accomplissement",
    "securite"
  ];
  var BESOIN_MAX = 1e3;
  var TRAITS = [
    "sociabilite",
    "ambition",
    "impulsivite",
    "prudence",
    "confiance",
    "empathie",
    "agressivite",
    "curiosite",
    "discipline",
    "ouverture",
    "attachement",
    "goutRisque",
    "besoinReconnaissance",
    "independance"
  ];
  var INDEX_BESOIN = new Map(BESOINS.map((b, i) => [b, i]));
  var INDEX_TRAIT = new Map(TRAITS.map((t, i) => [t, i]));
  function besoin(p, nom) {
    return p.besoins[INDEX_BESOIN.get(nom) ?? 0] ?? 0;
  }
  function trait(p, nom) {
    return p.traits[INDEX_TRAIT.get(nom) ?? 0] ?? 0;
  }
  function traitNormalise(p, nom) {
    return (trait(p, nom) + 100) / 200;
  }
  function fixerBesoin(p, nom, valeur) {
    const i = INDEX_BESOIN.get(nom);
    if (i === void 0) return;
    p.besoins[i] = Math.max(0, Math.min(BESOIN_MAX, valeur));
  }
  function ajouterBesoin(p, nom, delta) {
    fixerBesoin(p, nom, besoin(p, nom) + delta);
  }
  function nomComplet(p) {
    return `${p.prenom} ${p.nom}`;
  }

  // etat/monde.ts
  var VERSION_ETAT = 2;
  function creerMonde(graine, tickDepart = 0) {
    return {
      version: VERSION_ETAT,
      graine,
      tick: tickDepart,
      compteur: creerCompteur(1),
      personnages: /* @__PURE__ */ new Map(),
      lieux: /* @__PURE__ */ new Map(),
      foyers: /* @__PURE__ */ new Map(),
      postes: /* @__PURE__ */ new Map(),
      relations: /* @__PURE__ */ new Map()
    };
  }
  function domicile(monde, p) {
    return monde.foyers.get(p.foyer)?.logement ?? null;
  }
  function posteDe(monde, p) {
    return p.poste === null ? void 0 : monde.postes.get(p.poste);
  }
  function autresPresents(monde, id) {
    const p = monde.personnages.get(id);
    if (p === void 0) return [];
    const l = monde.lieux.get(p.position.lieu);
    if (l === void 0) return [];
    const resultat = [];
    for (const autreId of l.occupants) {
      if (autreId === id) continue;
      const autre = monde.personnages.get(autreId);
      if (autre !== void 0) resultat.push(autre);
    }
    return resultat;
  }

  // etat/apparence.ts
  var REPERTOIRES = {
    coiffures: 12,
    hauts: 8,
    bas: 6,
    /** Nombre de bits utilisés dans le masque `accessoires`. */
    accessoires: 5
  };
  var ACCESSOIRES = ["lunettes", "sac", "chapeau", "canne", "echarpe"];

  // etat/position.ts
  var POSITION_MAX = 1e3;
  function emplacementDans(persoId, lieu) {
    return {
      x: hacher("emplacement-x", persoId, lieu) % (POSITION_MAX + 1),
      y: hacher("emplacement-y", persoId, lieu) % (POSITION_MAX + 1)
    };
  }
  function creerPosition(persoId, lieu) {
    const e = emplacementDans(persoId, lieu);
    return { lieu, piece: null, x: e.x, y: e.y };
  }

  // etat/foyer.ts
  function creerFoyer(id, logement) {
    return { id, logement, membres: [] };
  }

  // etat/lieu.ts
  var DUREE_TRAJET = 4;
  function estOuvert(lieu, heure) {
    if (lieu.ouvertureH === 0 && lieu.fermetureH >= 24) return true;
    return heure >= lieu.ouvertureH && heure < lieu.fermetureH;
  }
  function estPlein(lieu) {
    return lieu.occupants.length >= lieu.capacite;
  }

  // etat/transactions.ts
  var SUCCES = { ok: true };
  function deplacer(monde, p, vers) {
    const destination = monde.lieux.get(vers);
    if (destination === void 0) return { ok: false, raison: "lieu-inconnu" };
    if (p.position.lieu === vers) return SUCCES;
    if (estPlein(destination)) return { ok: false, raison: "lieu-plein" };
    const origine = monde.lieux.get(p.position.lieu);
    if (origine !== void 0) {
      const i = origine.occupants.indexOf(p.id);
      if (i >= 0) origine.occupants.splice(i, 1);
    }
    destination.occupants.push(p.id);
    poser(p, vers);
    return SUCCES;
  }
  function installer(monde, p, dans) {
    const destination = monde.lieux.get(dans);
    if (destination === void 0) return;
    destination.occupants.push(p.id);
    poser(p, dans);
  }
  function poser(p, lieu) {
    const e = emplacementDans(p.id, lieu);
    p.position.lieu = lieu;
    p.position.piece = null;
    p.position.x = e.x;
    p.position.y = e.y;
  }
  function crediter(p, montant) {
    if (montant <= 0) return;
    p.argent += montant;
  }
  function depenserFoyer(monde, p, montant) {
    if (montant <= 0) return SUCCES;
    if (p.argent >= montant) {
      p.argent -= montant;
      return SUCCES;
    }
    const foyer = [];
    let disponible = 0;
    for (const id of monde.foyers.get(p.foyer)?.membres ?? []) {
      const autre = monde.personnages.get(id);
      if (autre === void 0) continue;
      foyer.push(autre);
      disponible += Math.max(0, autre.argent);
    }
    if (disponible < montant) return { ok: false, raison: "fonds-insuffisants" };
    let reste = montant;
    const ordre = [p, ...foyer.filter((x) => x.id !== p.id)];
    for (const membre of ordre) {
      if (reste <= 0) break;
      const part = Math.min(reste, Math.max(0, membre.argent));
      membre.argent -= part;
      reste -= part;
    }
    return SUCCES;
  }

  // monde/generation.ts
  var PRENOMS_F = [
    "Sarah",
    "Julie",
    "Amina",
    "Claire",
    "Nadia",
    "Léa",
    "Fatou",
    "Manon",
    "Inès",
    "Camille",
    "Awa",
    "Sophie",
    "Yasmine",
    "Élodie",
    "Nour",
    "Chloé"
  ];
  var PRENOMS_M = [
    "Paul",
    "Marc",
    "Ibrahim",
    "Thomas",
    "Karim",
    "Lucas",
    "Mamadou",
    "Hugo",
    "Samir",
    "Antoine",
    "Youssef",
    "Julien",
    "Ousmane",
    "Nicolas",
    "Reda",
    "Théo"
  ];
  var NOMS = [
    "Bernard",
    "Diallo",
    "Moreau",
    "Lefèvre",
    "Benali",
    "Garnier",
    "Traoré",
    "Rousseau",
    "Chevalier",
    "Haddad",
    "Girard",
    "Camara",
    "Fontaine",
    "Mercier",
    "Ziani",
    "Barre",
    "Leclerc",
    "Sissoko",
    "Perrin",
    "Dumont"
  ];
  function ajouterLieu(monde, modele) {
    const id = attribuer(monde.compteur);
    const lieu = {
      id,
      nom: modele.nom,
      type: modele.type,
      capacite: modele.capacite,
      occupants: [],
      ouvertureH: modele.ouvertureH,
      fermetureH: modele.fermetureH
    };
    monde.lieux.set(id, lieu);
    return lieu;
  }
  var DEPART_PAR_DEFAUT = 7 * 12;
  function genererMonde(options) {
    const { graine, population } = options;
    const monde = creerMonde(graine, options.tickDepart ?? DEPART_PAR_DEFAUT);
    const nbLogements = Math.max(4, Math.ceil(population / 2.6));
    const logements = [];
    for (let i = 0; i < nbLogements; i += 1) {
      logements.push(
        ajouterLieu(monde, {
          nom: `logement ${i + 1}`,
          type: "logement",
          capacite: 6,
          ouvertureH: 0,
          fermetureH: 24
        })
      );
    }
    const bureaux = [
      ajouterLieu(monde, { nom: "bureau nord", type: "bureau", capacite: 30, ouvertureH: 6, fermetureH: 21 }),
      ajouterLieu(monde, { nom: "atelier sud", type: "bureau", capacite: 30, ouvertureH: 6, fermetureH: 21 })
    ];
    const ecole = ajouterLieu(monde, {
      nom: "école du quartier",
      type: "ecole",
      capacite: 60,
      ouvertureH: 7,
      fermetureH: 18
    });
    ajouterLieu(monde, { nom: "café de la place", type: "cafe", capacite: 24, ouvertureH: 7, fermetureH: 24 });
    ajouterLieu(monde, { nom: "bistrot du coin", type: "cafe", capacite: 18, ouvertureH: 11, fermetureH: 24 });
    ajouterLieu(monde, { nom: "supérette", type: "commerce", capacite: 16, ouvertureH: 8, fermetureH: 20 });
    ajouterLieu(monde, { nom: "salle de sport", type: "gymnase", capacite: 20, ouvertureH: 6, fermetureH: 22 });
    ajouterLieu(monde, { nom: "parc central", type: "parc", capacite: 200, ouvertureH: 0, fermetureH: 24 });
    ajouterLieu(monde, { nom: "rue principale", type: "rue", capacite: 200, ouvertureH: 0, fermetureH: 24 });
    creerPostes(monde, graine, bureaux, ecole);
    const habitants = [];
    const logementChoisi = [];
    const occupation = /* @__PURE__ */ new Map();
    for (let i = 0; i < population; i += 1) {
      const r = creerFlux(graine, "habitant", i);
      const libres = logements.filter(
        (l) => (occupation.get(l.id) ?? 0) < l.capacite
      );
      const logement = choisir(r, libres) ?? libres[0] ?? logements[0];
      const idLogement = logement?.id ?? 0;
      occupation.set(idLogement, (occupation.get(idLogement) ?? 0) + 1);
      habitants.push(creerHabitant(monde, r, idLogement));
      logementChoisi.push(idLogement);
    }
    const foyerParLogement = /* @__PURE__ */ new Map();
    habitants.forEach((p, i) => {
      const idLogement = logementChoisi[i];
      if (idLogement === void 0) return;
      let idFoyer = foyerParLogement.get(idLogement);
      if (idFoyer === void 0) {
        idFoyer = attribuer(monde.compteur);
        monde.foyers.set(idFoyer, creerFoyer(idFoyer, idLogement));
        foyerParLogement.set(idLogement, idFoyer);
      }
      p.foyer = idFoyer;
      monde.foyers.get(idFoyer)?.membres.push(p.id);
    });
    attribuerPostes(monde, graine, habitants);
    habitants.forEach((p, i) => {
      monde.personnages.set(p.id, p);
      const idLogement = logementChoisi[i];
      if (idLogement !== void 0) installer(monde, p, idLogement);
    });
    return { monde, logements, bureaux, ecole };
  }
  var METIERS = [
    "employé de bureau",
    "comptable",
    "technicien",
    "magasinier",
    "commercial",
    "gestionnaire",
    "agent d'accueil",
    "ouvrier",
    "assistant",
    "chargé de projet"
  ];
  function creerPostes(monde, graine, bureaux, ecole) {
    const r = creerFlux(graine, "postes");
    const horaires = [
      { debutH: 8, finH: 17 },
      { debutH: 9, finH: 18 },
      { debutH: 7, finH: 15 },
      { debutH: 10, finH: 19 }
    ];
    for (const bureau of bureaux) {
      for (let i = 0; i < bureau.capacite; i += 1) {
        const h = choisir(r, horaires) ?? horaires[0];
        const id = attribuer(monde.compteur);
        const poste = {
          id,
          genre: "emploi",
          intitule: `${choisir(r, METIERS) ?? "employé"} — ${bureau.nom}`,
          lieu: bureau.id,
          debutH: h.debutH,
          finH: h.finH,
          salaireHoraire: Math.max(9, Math.round(normal(r, 17, 6))),
          titulaire: null
        };
        monde.postes.set(id, poste);
      }
    }
    for (let i = 0; i < ecole.capacite; i += 1) {
      const id = attribuer(monde.compteur);
      monde.postes.set(id, {
        id,
        genre: "etudes",
        intitule: `place d'élève — ${ecole.nom}`,
        lieu: ecole.id,
        debutH: 8,
        finH: 16,
        // Une place d'élève ne rapporte rien : c'est un poste au sens de la
        // rareté, pas au sens du revenu.
        salaireHoraire: 0,
        titulaire: null
      });
    }
  }
  function attribuerPostes(monde, graine, habitants) {
    const r = creerFlux(graine, "attribution-postes");
    const vacants = (genre) => melangerTableau(r, [...monde.postes.values()].filter((x) => x.genre === genre));
    const emplois = vacants("emploi");
    const places = vacants("etudes");
    let iEmploi = 0;
    let iPlace = 0;
    for (const p of habitants) {
      const age2 = Math.floor((monde.tick - p.naissance) / TICKS_PAR_AN);
      let poste;
      if (age2 < 18) {
        poste = places[iPlace];
        if (poste !== void 0) iPlace += 1;
      } else if (age2 < 65 && flottant(creerFlux(graine, "actif", p.id)) >= 0.12) {
        poste = emplois[iEmploi];
        if (poste !== void 0) iEmploi += 1;
      }
      if (poste === void 0) continue;
      poste.titulaire = p.id;
      p.poste = poste.id;
    }
  }
  function creerHabitant(monde, r, logement) {
    const id = attribuer(monde.compteur);
    const sexe = flottant(r) < 0.5 ? "f" : "m";
    const tirageAge = flottant(r);
    const age2 = tirageAge < 0.24 ? entier(r, 6, 18) : tirageAge < 0.82 ? entier(r, 18, 65) : entier(r, 65, 88);
    const traits = TRAITS.map(
      () => Math.max(-100, Math.min(100, Math.round(normal(r, 0, 42))))
    );
    const besoins = BESOINS.map(() => entier(r, 80, 420));
    return {
      id,
      prenom: choisir(r, sexe === "f" ? PRENOMS_F : PRENOMS_M) ?? "Alex",
      nom: choisir(r, NOMS) ?? "Martin",
      naissance: monde.tick - age2 * TICKS_PAR_AN - entier(r, 0, TICKS_PAR_AN),
      sexe,
      traits,
      besoins,
      apparence: creerApparence(r, sexe, age2),
      position: creerPosition(id, logement),
      // Renseigné à la passe des foyers, juste après. L'invariant
      // « foyer-existe » le vérifiera.
      foyer: 0,
      poste: null,
      argent: Math.round(normal(r, age2 < 18 ? 40 : 900, age2 < 18 ? 20 : 500)),
      activite: null,
      echelle: "micro",
      derniereMaj: monde.tick
    };
  }
  function creerApparence(r, sexe, age2) {
    const borne2 = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
    const tailleAdulte = borne2(normal(r, sexe === "f" ? 166 : 178, 7), 140, 205);
    return {
      genes: {
        teintePeau: entier(r, 0, 256),
        teinteCheveux: entier(r, 0, 256),
        coiffure: entier(r, 0, REPERTOIRES.coiffures),
        corpulence: borne2(normal(r, 0, 32), -100, 100),
        tailleCm: tailleAdulte
      },
      garderobe: {
        haut: entier(r, 0, REPERTOIRES.hauts),
        bas: entier(r, 0, REPERTOIRES.bas),
        teinteHaut: entier(r, 0, 256),
        teinteBas: entier(r, 0, 256)
      },
      // Peu d'accessoires, et davantage avec l'âge : un bit par objet.
      accessoires: masqueAccessoires(r, age2)
    };
  }
  function masqueAccessoires(r, age2) {
    const probabilites = [
      age2 > 45 ? 0.35 : 0.12,
      // lunettes
      0.25,
      // sac
      0.1,
      // chapeau
      age2 > 72 ? 0.3 : 0.01,
      // canne
      0.15
      // écharpe
    ];
    let masque = 0;
    for (let i = 0; i < REPERTOIRES.accessoires; i += 1) {
      if (flottant(r) < (probabilites[i] ?? 0)) masque |= 1 << i;
    }
    return masque;
  }

  // etat/poste.ts
  function estVacant(poste) {
    return poste.titulaire === null;
  }

  // jeu/joueur.ts
  function insererJoueur(monde, fiche) {
    const r = creerFlux(monde.graine, "joueur", monde.personnages.size);
    const id = attribuer(monde.compteur);
    const logement = logementDisponible(monde);
    const foyer = foyerPour(monde, logement);
    const traits = TRAITS.map((t) => {
      const choisi = fiche.traits[t];
      return choisi === void 0 ? entier(r, -60, 61) : borne(choisi, -100, 100);
    });
    const p = {
      id,
      prenom: fiche.prenom.trim() || "Sans-nom",
      nom: fiche.nom.trim() || "Inconnu",
      naissance: monde.tick - borne(fiche.age, 6, 90) * TICKS_PAR_AN,
      sexe: fiche.sexe,
      traits,
      besoins: BESOINS.map(() => entier(r, 80, 420)),
      apparence: fiche.apparence,
      position: creerPosition(id, logement),
      foyer,
      poste: null,
      argent: fiche.age < 18 ? 60 : 1200,
      activite: null,
      echelle: "micro",
      derniereMaj: monde.tick
    };
    monde.personnages.set(id, p);
    monde.foyers.get(foyer)?.membres.push(id);
    installer(monde, p, logement);
    attribuerPoste(monde, p, borne(fiche.age, 6, 90));
    return id;
  }
  function borne(v, min, max) {
    return Math.max(min, Math.min(max, Math.round(v)));
  }
  function logementDisponible(monde) {
    let repli = null;
    for (const l of monde.lieux.values()) {
      if (l.type !== "logement") continue;
      if (repli === null) repli = l.id;
      if (l.occupants.length < l.capacite) return l.id;
    }
    if (repli === null) throw new Error("le monde ne contient aucun logement");
    return repli;
  }
  function foyerPour(monde, logement) {
    for (const f of monde.foyers.values()) {
      if (f.logement === logement) return f.id;
    }
    const id = attribuer(monde.compteur);
    monde.foyers.set(id, creerFoyer(id, logement));
    return id;
  }
  function attribuerPoste(monde, p, age2) {
    if (age2 >= 65) return;
    const genre = age2 < 18 ? "etudes" : "emploi";
    for (const poste of monde.postes.values()) {
      if (poste.genre !== genre || !estVacant(poste)) continue;
      poste.titulaire = p.id;
      p.poste = poste.id;
      return;
    }
  }
  function creerOrdres() {
    return { destination: null, arret: false };
  }
  function intentionDuJoueur(joueur, ordres) {
    return (monde, p, t) => {
      if (p.id !== joueur) return null;
      if (ordres.destination !== null) {
        const cible = ordres.destination;
        ordres.destination = null;
        if (cible === p.position.lieu) return null;
        if (!monde.lieux.has(cible)) return null;
        return { type: "deplacement", vers: cible, jusqua: t + DUREE_TRAJET };
      }
      if (ordres.arret) {
        return { type: "action", action: "flaner", jusqua: t + 3 };
      }
      return null;
    };
  }
  function ordonnerDeplacement(ordres, vers) {
    ordres.destination = vers;
    ordres.arret = false;
  }
  function ordonnerArret(ordres) {
    ordres.destination = null;
    ordres.arret = true;
  }
  function rendreAutonomie(ordres) {
    ordres.destination = null;
    ordres.arret = false;
  }

  // moteurs/personnage/courbes.ts
  var borner = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  function lineaire(x) {
    return borner(x);
  }
  function racine(x) {
    return Math.sqrt(borner(x));
  }
  function inverse(x) {
    return 1 - borner(x);
  }
  function seuil(x, centre = 0.5, raideur = 12) {
    return 1 / (1 + Math.exp(-raideur * (x - centre)));
  }
  function cloche(x, centre, largeur) {
    const d = (x - centre) / largeur;
    return Math.exp(-0.5 * d * d);
  }
  function clocheHoraire(heure, centre, largeur) {
    let d = Math.abs(heure - centre);
    if (d > 12) d = 24 - d;
    return cloche(d, 0, largeur);
  }
  function urgence(x) {
    return seuil(x, 0.45, 9);
  }
  function prevoyance(x) {
    return seuil(x, 0.32, 11);
  }
  function fenetreNuit(heure) {
    if (heure >= 23 || heure < 6) return 1;
    if (heure >= 21) return (heure - 21) / 2;
    if (heure < 8) return 1 - (heure - 6) / 2;
    return 0;
  }
  function constante(v) {
    return borner(v);
  }

  // moteurs/personnage/actions.ts
  var pression = (b, forme) => (ctx) => forme(besoin(ctx.perso, b) / 1e3);
  var creneau2 = (centre, largeur) => (ctx) => clocheHoraire(ctx.heure, centre, largeur);
  var proximite = (ctx) => ctx.surPlace ? 1 : ctx.accessible ? 0.55 : 0;
  var quelquUnIci = (ctx) => ctx.presents === 0 ? 0 : racine(ctx.presents / 4);
  var argentDisponible = (montant) => (ctx) => montant <= 0 ? 1 : seuil(ctx.argentFoyer / (montant * 4), 0.5, 8);
  var aSonPoste = (genre) => (ctx) => {
    const poste = posteDe(ctx.monde, ctx.perso);
    if (poste === void 0 || poste.genre !== genre) return 0;
    return ctx.heure >= poste.debutH && ctx.heure < poste.finH ? 1 : 0.02;
  };
  var traitDe = (nom, poids = 1) => (ctx) => 1 - poids + poids * traitNormalise(ctx.perso, nom);
  var CATALOGUE = [
    {
      id: "dormir",
      libelle: "dormir",
      lieux: ["logement"],
      duree: 96,
      cout: 0,
      effets: { energie: -14, hygiene: 0.4, faim: 1.5 },
      sociale: false,
      // Créneau resserré autour de 1 h 30. À largeur 5, la cloche valait encore
      // 0,49 à 20 h et 0,73 à 22 h : les habitants se couchaient en début de
      // soirée, se réveillaient à 3 h, et dormaient une seconde fois l'après-midi
      // — onze heures quarante de sommeil par jour. Une action longue a besoin
      // d'une fenêtre étroite, sinon elle dévore la journée.
      considerations: [pression("energie", urgence), (ctx) => fenetreNuit(ctx.heure), proximite]
    },
    {
      id: "sieste",
      libelle: "faire une sieste",
      lieux: ["logement"],
      duree: 12,
      cout: 0,
      effets: { energie: -9 },
      sociale: false,
      // Seuil bien plus haut que celui du sommeil : une sieste est ce qu'on
      // fait quand on n'en peut plus, pas une seconde nuit. Avec la même courbe
      // d'urgence que « dormir », elle récupérait deux heures et demie par jour
      // et vidait les après-midi.
      considerations: [
        (ctx) => seuil(besoin(ctx.perso, "energie") / 1e3, 0.86, 18),
        // Une sieste est ce qu'on fait le jour : la nuit, on dort.
        (ctx) => 0.3 * (1 - fenetreNuit(ctx.heure)),
        proximite
      ]
    },
    {
      id: "manger_chez_soi",
      libelle: "manger chez soi",
      lieux: ["logement"],
      duree: 6,
      // GRATUIT, et c'est un choix de modèle, pas un oubli. Manger chez soi
      // puise dans les provisions, et ce sont les courses qui les paient. Le
      // banc d'essai a rendu la question concrète : tant que le repas coûtait
      // quatre euros, les enfants et les habitants sans revenu ne pouvaient
      // littéralement pas manger, et vivaient affamés en permanence. Un jeu où
      // la pauvreté empêche de se nourrir chez soi n'est pas plus dur, il est
      // faux.
      cout: 0,
      effets: { faim: -150, plaisir: -8 },
      sociale: false,
      considerations: [
        pression("faim", urgence),
        (ctx) => Math.max(creneau2(8, 1.4)(ctx), creneau2(12.5, 1.4)(ctx), creneau2(19.5, 1.6)(ctx), 0.3),
        proximite
      ]
    },
    {
      id: "manger_dehors",
      libelle: "manger au café",
      lieux: ["cafe"],
      duree: 9,
      cout: 14,
      effets: { faim: -95, plaisir: -22, social: -18 },
      sociale: true,
      considerations: [
        pression("faim", urgence),
        (ctx) => Math.max(creneau2(12.5, 1.2)(ctx), creneau2(19.5, 1.4)(ctx), 0.1),
        proximite,
        argentDisponible(14),
        traitDe("ouverture", 0.5)
      ]
    },
    {
      id: "manger_sur_le_pouce",
      libelle: "manger sur le pouce",
      // Nulle part en particulier : c'est tout l'intérêt. Sans cette action, un
      // habitant au bureau ne pouvait déjeuner qu'en rentrant chez lui ou en
      // payant le café, donc ne déjeunait pas — et la faim restait au-dessus du
      // seuil critique un tiers du temps.
      lieux: [],
      duree: 4,
      cout: 5,
      effets: { faim: -145, plaisir: -5 },
      sociale: false,
      considerations: [
        pression("faim", urgence),
        (ctx) => Math.max(creneau2(12.5, 1.8)(ctx), 0.12),
        argentDisponible(5)
      ]
    },
    {
      id: "se_laver",
      libelle: "se laver",
      lieux: ["logement"],
      duree: 3,
      cout: 0,
      effets: { hygiene: -280 },
      sociale: false,
      considerations: [pression("hygiene", urgence), proximite]
    },
    {
      id: "travailler",
      libelle: "travailler",
      lieux: ["bureau"],
      duree: 24,
      cout: 0,
      effets: { accomplissement: -28, energie: 1.5, faim: 1.2, social: -4 },
      sociale: false,
      considerations: [
        aSonPoste("emploi"),
        proximite,
        // Même épuisé, on va travailler — mais pas à n'importe quel prix.
        (ctx) => inverse(Math.max(0, besoin(ctx.perso, "energie") - 820) / 180),
        traitDe("discipline", 0.35)
      ]
    },
    {
      id: "etudier",
      libelle: "étudier",
      lieux: ["ecole"],
      duree: 24,
      cout: 0,
      effets: { accomplissement: -24, energie: 1.2, faim: 1.2, social: -12 },
      sociale: false,
      considerations: [
        aSonPoste("etudes"),
        proximite,
        (ctx) => inverse(Math.max(0, besoin(ctx.perso, "energie") - 820) / 180),
        traitDe("discipline", 0.35)
      ]
    },
    {
      id: "discuter",
      libelle: "discuter",
      lieux: [],
      duree: 6,
      cout: 0,
      effets: { social: -110, plaisir: -18 },
      sociale: true,
      considerations: [pression("social", racine), quelquUnIci, traitDe("sociabilite", 0.7)]
    },
    {
      id: "sortir_boire",
      libelle: "sortir au café",
      lieux: ["cafe"],
      duree: 18,
      cout: 11,
      effets: { social: -70, plaisir: -45, energie: 5 },
      sociale: true,
      considerations: [
        pression("social", racine),
        creneau2(20, 3.5),
        proximite,
        argentDisponible(11),
        traitDe("sociabilite", 0.6)
      ]
    },
    {
      id: "faire_du_sport",
      libelle: "faire du sport",
      lieux: ["gymnase", "parc"],
      duree: 12,
      cout: 2,
      effets: { plaisir: -28, accomplissement: -16, hygiene: 30, energie: 4, faim: 3 },
      sociale: false,
      considerations: [
        pression("accomplissement", racine),
        (ctx) => inverse(besoin(ctx.perso, "energie") / 900),
        proximite,
        traitDe("discipline", 0.8)
      ]
    },
    {
      id: "se_promener",
      libelle: "se promener",
      lieux: ["parc", "rue"],
      duree: 9,
      cout: 0,
      effets: { plaisir: -22, energie: 2.5 },
      sociale: false,
      considerations: [
        pression("plaisir", lineaire),
        creneau2(15, 6),
        proximite,
        traitDe("curiosite", 0.5)
      ]
    },
    {
      id: "faire_courses",
      libelle: "faire des courses",
      lieux: ["commerce"],
      duree: 6,
      cout: 19,
      effets: { securite: -420, energie: 1.5 },
      sociale: false,
      considerations: [
        pression("securite", prevoyance),
        proximite,
        argentDisponible(19),
        creneau2(15, 5)
      ]
    },
    {
      id: "se_detendre",
      libelle: "se détendre chez soi",
      lieux: ["logement"],
      duree: 9,
      cout: 0,
      effets: { plaisir: -32, energie: -1.5 },
      sociale: false,
      considerations: [
        pression("plaisir", lineaire),
        // La soirée est le moment naturel du temps pour soi. Sans ce créneau,
        // le vide de fin de journée était comblé par des siestes.
        (ctx) => Math.max(creneau2(20.5, 3)(ctx), 0.35),
        proximite,
        traitDe("independance", 0.4)
      ]
    },
    {
      id: "flaner",
      libelle: "ne rien faire de particulier",
      lieux: [],
      duree: 3,
      cout: 0,
      effets: {},
      sociale: false,
      // Utilité faible mais jamais nulle : il existe toujours au moins une
      // option. Sans ce filet, un personnage sans argent, épuisé et enfermé
      // resterait bloqué sans activité, et la boucle tournerait à vide.
      considerations: [() => constante(0.08)]
    }
  ];
  var PAR_ID = new Map(CATALOGUE.map((a) => [a.id, a]));
  function action(id) {
    return PAR_ID.get(id);
  }

  // moteurs/personnage/besoins.ts
  var DERIVE_BASE = {
    // Une nuit de sept heures doit couvrir exactement une journée d'éveil.
    // À 5,2, elle ne suffisait pas : les habitants complétaient par des
    // siestes et dormaient 11,7 h par jour, ce qui mangeait leurs journées.
    energie: 4,
    // À 7, la faim passait 47 % du temps au-dessus du seuil critique : les
    // habitants vivaient affamés en permanence et leur routine se brisait sans
    // cesse. Deux repas et demi doivent couvrir une journée.
    faim: 4.5,
    hygiene: 2,
    social: 2.5,
    // À 2, la pression de plaisir restait à 129 sur 1000 en moyenne : personne
    // ne cherchait jamais à se faire plaisir, donc personne ne sortait, ne se
    // promenait ni n'allait boire un verre. Une société où le divertissement
    // n'a aucune valeur n'est pas plus sobre, elle est fausse.
    plaisir: 3.1,
    accomplissement: 1,
    // Presque statique : la sécurité bouge par événements, pas par le temps.
    // Assez toutefois pour qu'on refasse ses courses environ une fois par
    // semaine, au lieu d'une fois par mois.
    securite: 0.35
  };
  function modulation(p, b) {
    switch (b) {
      case "social":
        return 0.5 + 1.3 * traitNormalise(p, "sociabilite");
      case "accomplissement":
        return 0.5 + 1.3 * traitNormalise(p, "ambition");
      case "plaisir":
        return 0.7 + 0.8 * traitNormalise(p, "ouverture");
      case "hygiene":
        return 0.7 + 0.6 * traitNormalise(p, "discipline");
      case "securite":
        return 0.6 + 1 * traitNormalise(p, "prudence");
      default:
        return 1;
    }
  }
  function deriver(p, pas) {
    if (pas <= 0) return;
    for (const b of BESOINS) {
      ajouterBesoin(p, b, DERIVE_BASE[b] * modulation(p, b) * pas);
    }
  }

  // moteurs/personnage/utilite.ts
  function evaluer(action2, ctx) {
    const n = action2.considerations.length;
    if (n === 0) return 0;
    let produit = 1;
    for (const consideration of action2.considerations) {
      const v = consideration(ctx);
      if (v <= 0) return 0;
      produit *= v > 1 ? 1 : v;
    }
    const compensation = (1 - 1 / n) * (1 - produit);
    return produit + compensation * produit;
  }
  function exposant(p) {
    const impulsif = traitNormalise(p, "impulsivite");
    const prudent = traitNormalise(p, "prudence");
    return 1.2 + 7 * (1 - impulsif) * (0.4 + 0.6 * prudent);
  }
  function decider(actions, contexte, perso, alea, largeur = 4) {
    const evaluations = [];
    for (const action2 of actions) {
      const score = evaluer(action2, contexte(action2));
      if (score > 0) evaluations.push({ action: action2, score });
    }
    if (evaluations.length === 0) return null;
    evaluations.sort((a, b) => b.score - a.score || (a.action.id < b.action.id ? -1 : 1));
    const candidats = evaluations.slice(0, largeur);
    const e = exposant(perso);
    const poids = candidats.map((c) => Math.pow(c.score, e));
    const choix = choisirPondere(alea, candidats, poids) ?? candidats[0];
    if (choix === void 0) return null;
    return { action: choix.action, score: choix.score, candidats };
  }

  // boucle/boucle.ts
  function lieuCible(monde, p, a) {
    if (a.lieux.length === 0) return p.position.lieu;
    const heure = heureDecimale(monde.tick);
    const courant = monde.lieux.get(p.position.lieu);
    if (a.lieux.includes("logement")) return domicile(monde, p);
    const poste = posteDe(monde, p);
    if (poste !== void 0) {
      const attitre = monde.lieux.get(poste.lieu);
      if (attitre !== void 0 && a.lieux.includes(attitre.type)) return attitre.id;
    }
    if (courant !== void 0 && a.lieux.includes(courant.type) && estOuvert(courant, heure)) {
      return courant.id;
    }
    let choix = null;
    let meilleur = -1;
    for (const l of monde.lieux.values()) {
      if (!a.lieux.includes(l.type)) continue;
      if (!estOuvert(l, heure)) continue;
      if (estPlein(l) && l.id !== p.position.lieu) continue;
      const score = hacher("lieu-prefere", p.id, l.id) % 1e3;
      if (score > meilleur) {
        meilleur = score;
        choix = l.id;
      }
    }
    return choix;
  }
  function argentDuFoyer(monde, p) {
    let total = 0;
    for (const id of monde.foyers.get(p.foyer)?.membres ?? []) {
      total += Math.max(0, monde.personnages.get(id)?.argent ?? 0);
    }
    return total;
  }
  function contextePour(monde, p, presents) {
    const heure = heureDecimale(monde.tick);
    const argentFoyer = argentDuFoyer(monde, p);
    return (a) => {
      const cible = lieuCible(monde, p, a);
      return {
        monde,
        perso: p,
        heure,
        presents,
        surPlace: cible !== null && cible === p.position.lieu,
        accessible: cible !== null,
        argentFoyer
      };
    };
  }
  function appliquerEffets(p, a, ticks, poste) {
    if (ticks <= 0) return;
    for (const [nom, valeur] of Object.entries(a.effets)) {
      ajouterBesoin(p, nom, valeur * ticks);
    }
    if (a.id === "travailler" && poste !== void 0 && poste.genre === "emploi") {
      crediter(p, Math.round(poste.salaireHoraire * ticks / 12));
    }
  }
  function mettreAJour(monde, p, options) {
    const maintenant = monde.tick;
    const ecoule = maintenant - p.derniereMaj;
    if (ecoule <= 0) return;
    options.observateur?.surReveil?.(monde, p, ecoule);
    deriver(p, ecoule);
    const enchainementsMax = options.enchainementsMax ?? 32;
    let t = p.derniereMaj;
    let enchainements = 0;
    while (t < maintenant && enchainements < enchainementsMax) {
      enchainements += 1;
      const activite = p.activite;
      if (activite !== null) {
        const fin = Math.min(activite.jusqua, maintenant);
        const duree = fin - t;
        if (activite.type === "action") {
          const a = action(activite.action);
          if (a !== void 0) {
            appliquerEffets(p, a, duree, posteDe(monde, p));
            options.observateur?.surActivite?.(monde, p, a.id, duree);
          }
        } else if (duree > 0) {
          options.observateur?.surActivite?.(monde, p, "se_deplacer", duree);
        }
        t = fin;
        if (activite.jusqua > maintenant) break;
        if (activite.type === "deplacement") {
          const resultat = deplacer(monde, p, activite.vers);
          if (!resultat.ok) options.observateur?.surEchec?.(monde, p, resultat.raison);
        }
        p.activite = null;
        continue;
      }
      if (!engager(monde, p, t, options)) break;
    }
    p.derniereMaj = maintenant;
  }
  function engager(monde, p, t, options) {
    const presents = autresPresents(monde, p.id).length;
    const imposee = options.intention?.(monde, p, t) ?? null;
    if (imposee !== null) {
      p.activite = imposee;
      return true;
    }
    const alea = creerFlux(monde.graine, "decision", p.id, t);
    const decision = decider(CATALOGUE, contextePour(monde, p, presents), p, alea);
    if (decision === null) return false;
    const meilleure = decision.candidats[0]?.action.id ?? decision.action.id;
    options.observateur?.surDecision?.(monde, p, decision.action.id, meilleure);
    const cible = lieuCible(monde, p, decision.action);
    if (cible === null) return false;
    if (cible !== p.position.lieu) {
      p.activite = { type: "deplacement", vers: cible, jusqua: t + DUREE_TRAJET };
      return true;
    }
    if (decision.action.cout > 0) {
      const paiement = depenserFoyer(monde, p, decision.action.cout);
      if (!paiement.ok) {
        options.observateur?.surEchec?.(monde, p, paiement.raison);
        p.activite = { type: "action", action: "flaner", jusqua: t + 3 };
        return true;
      }
    }
    if (decision.action.sociale && presents > 0) {
      options.observateur?.surInteraction?.(monde, p, presents);
    }
    p.activite = { type: "action", action: decision.action.id, jusqua: t + decision.action.duree };
    return true;
  }
  function avancer(monde, ticks, options = {}) {
    for (let i = 0; i < ticks; i += 1) {
      monde.tick += 1;
      for (const p of monde.personnages.values()) {
        if (!doitMettreAJour(p.echelle, p.id, monde.tick)) continue;
        mettreAJour(monde, p, options);
      }
    }
  }

  // jeu/horloge.ts
  var VITESSES_JEU = [0, 1, 4, 12, 40];
  function creerHorloge(vitesse = 1) {
    return { vitesse, reste: 0, ticksExecutes: 0, sature: false };
  }
  function battre(horloge, monde, deltaMsReel, options = {}) {
    const budget = ticksDus(horloge.vitesse, deltaMsReel, horloge.reste);
    horloge.reste = budget.reste;
    horloge.sature = budget.sature;
    if (budget.ticks <= 0) return 0;
    avancer(monde, budget.ticks, options);
    horloge.ticksExecutes += budget.ticks;
    return budget.ticks;
  }

  // jeu/partie.ts
  function commencerPartie(o) {
    const { monde } = genererMonde({ graine: o.graine, population: o.population });
    const joueur = insererJoueur(monde, o.fiche);
    const ordres = creerOrdres();
    return {
      monde,
      joueur,
      horloge: creerHorloge(o.vitesse ?? 1),
      ordres,
      // Le joueur passe par la MÊME boucle que tout le monde. Son seul privilège
      // est ce crochet, consulté avant l'IA d'utilité — et seulement quand il a
      // donné un ordre.
      options: { intention: intentionDuJoueur(joueur, ordres) }
    };
  }
  function avancerPartie(partie2, deltaMsReel) {
    return battre(partie2.horloge, partie2.monde, deltaMsReel, partie2.options);
  }
  function personnageJoueur(partie2) {
    return partie2.monde.personnages.get(partie2.joueur);
  }
  function interrompre(partie2) {
    const j = personnageJoueur(partie2);
    if (j !== void 0) j.activite = null;
  }
  function commanderDeplacement(partie2, vers) {
    ordonnerDeplacement(partie2.ordres, vers);
    interrompre(partie2);
  }
  function commanderArret(partie2) {
    ordonnerArret(partie2.ordres);
    interrompre(partie2);
  }
  function commanderAutonomie(partie2) {
    rendreAutonomie(partie2.ordres);
    interrompre(partie2);
  }
  function horodatage(monde) {
    const c = calendrier(monde.tick);
    return {
      heure: `${String(c.heure).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`,
      jour: `${nomJourSemaine(c.jourSemaine)} ${c.jour}/${c.mois}/${c.annee}`
    };
  }

  // jeu/silhouette.ts
  var PEAU = ["#F4DCC4", "#EBC9A6", "#D9AA81", "#BE8759", "#96643E", "#6E472B", "#4C3020"];
  var CHEVEUX = ["#1B1512", "#3A2A20", "#5E4534", "#8A6438", "#B58A4A", "#C9A227", "#7A2E1E", "#8E8E96"];
  function rampe(palette, teinte) {
    const i = Math.min(palette.length - 1, Math.floor(teinte / 256 * palette.length));
    return palette[i] ?? palette[0] ?? "#888";
  }
  function tissu(teinte, clarte) {
    return `hsl(${Math.round(teinte / 256 * 360)} 42% ${clarte}%)`;
  }
  function assombrir(couleur, f) {
    if (f <= 0) return couleur;
    return `color-mix(in srgb, ${couleur}, #16202C ${Math.round(f * 100)}%)`;
  }
  function dessinerHabitant(ctx, a, x, y, echelle, o) {
    const enfant = o.age < 14;
    const grandeur = (o.age < 6 ? 0.62 : enfant ? 0.78 : 1) * (a.genes.tailleCm / 175);
    const largeur = (1 + a.genes.corpulence / 320) * (enfant ? 0.85 : 1);
    const h = 22 * echelle * grandeur;
    const l = 7 * echelle * largeur;
    ctx.beginPath();
    ctx.ellipse(x, y, l * 0.9, l * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.24)";
    ctx.fill();
    if (echelle < 0.6) {
      ctx.beginPath();
      ctx.arc(x, y - h * 0.4, Math.max(2, l * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = assombrir(tissu(a.garderobe.teinteHaut, 58), o.obscurite * 0.4);
      ctx.fill();
      return;
    }
    const peau = assombrir(rampe(PEAU, a.genes.teintePeau), o.obscurite * 0.45);
    const cheveux = assombrir(rampe(CHEVEUX, a.genes.teinteCheveux), o.obscurite * 0.45);
    const haut = assombrir(tissu(a.garderobe.teinteHaut, 56), o.obscurite * 0.4);
    const bas = assombrir(tissu(a.garderobe.teinteBas, 40), o.obscurite * 0.4);
    const balancement = Math.sin(o.phase) * l * 0.35;
    const contour = "rgba(14,22,30,.5)";
    ctx.lineWidth = Math.max(0.6, echelle * 0.9);
    ctx.strokeStyle = contour;
    const hJambe = h * 0.34;
    ctx.fillStyle = bas;
    for (const cote of [-1, 1]) {
      const dx = cote * l * 0.32 + (o.phase === 0 ? 0 : cote * balancement * 0.6);
      ctx.beginPath();
      ctx.rect(x + dx - l * 0.2, y - hJambe, l * 0.4, hJambe);
      ctx.fill();
      ctx.stroke();
    }
    const hTorse = h * 0.36;
    ctx.fillStyle = haut;
    ctx.beginPath();
    ctx.moveTo(x - l * 0.62, y - hJambe);
    ctx.lineTo(x + l * 0.62, y - hJambe);
    ctx.lineTo(x + l * 0.52, y - hJambe - hTorse);
    ctx.lineTo(x - l * 0.52, y - hJambe - hTorse);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = haut;
    for (const cote of [-1, 1]) {
      const dy = o.phase === 0 ? 0 : -cote * balancement * 0.5;
      ctx.beginPath();
      ctx.rect(x + cote * l * 0.66 - l * 0.13, y - hJambe - hTorse + dy, l * 0.26, hTorse * 0.9);
      ctx.fill();
      ctx.stroke();
    }
    const rTete = l * (enfant ? 0.72 : 0.6);
    const yTete = y - hJambe - hTorse - rTete * 0.85;
    ctx.fillStyle = peau;
    ctx.beginPath();
    ctx.arc(x, yTete, rTete, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    dessinerCoiffure(ctx, a.genes.coiffure, x, yTete, rTete, cheveux, o.sens);
    if (a.accessoires & 1) {
      ctx.strokeStyle = "rgba(20,30,40,.75)";
      ctx.lineWidth = Math.max(0.5, echelle * 0.7);
      ctx.beginPath();
      ctx.moveTo(x - rTete * 0.7, yTete - rTete * 0.05);
      ctx.lineTo(x + rTete * 0.7, yTete - rTete * 0.05);
      ctx.stroke();
    }
    if (a.accessoires & 2) {
      ctx.fillStyle = assombrir("#6B4F3A", o.obscurite * 0.4);
      ctx.beginPath();
      ctx.rect(x + o.sens * l * 0.7, y - hJambe - hTorse * 0.5, l * 0.3, hTorse * 0.5);
      ctx.fill();
    }
    if (a.accessoires & 4) {
      ctx.fillStyle = assombrir(tissu(a.garderobe.teinteBas, 30), o.obscurite * 0.4);
      ctx.beginPath();
      ctx.ellipse(x, yTete - rTete * 0.75, rTete * 1.35, rTete * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (a.accessoires & 8) {
      ctx.strokeStyle = assombrir("#7A5B3C", o.obscurite * 0.4);
      ctx.lineWidth = Math.max(0.7, echelle);
      ctx.beginPath();
      ctx.moveTo(x + l * 0.9, y);
      ctx.lineTo(x + l * 0.9, y - h * 0.55);
      ctx.stroke();
    }
    if (a.accessoires & 16) {
      ctx.fillStyle = assombrir(tissu(a.garderobe.teinteHaut + 80, 50), o.obscurite * 0.4);
      ctx.beginPath();
      ctx.rect(x - l * 0.5, y - hJambe - hTorse - rTete * 0.15, l, rTete * 0.4);
      ctx.fill();
    }
    if (o.selectionne) {
      ctx.strokeStyle = o.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, l * 1.5, l * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  function dessinerCoiffure(ctx, indice, x, y, r, couleur, sens) {
    ctx.fillStyle = couleur;
    const calotte = (ouverture) => {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.06, Math.PI, Math.PI * 2 - ouverture);
      ctx.closePath();
      ctx.fill();
    };
    switch (indice % 12) {
      case 0:
        break;
      // rasé
      case 1:
        calotte(0);
        break;
      // très court
      case 2:
        calotte(0);
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.5, r * 1.1, r * 0.9, 0, 0, Math.PI);
        ctx.fill();
        break;
      // mi-long
      case 3:
        calotte(0);
        ctx.beginPath();
        ctx.rect(x - r * 1.1, y - r * 0.2, r * 2.2, r * 1.9);
        ctx.fill();
        break;
      // long
      case 4:
        calotte(0);
        ctx.beginPath();
        ctx.arc(x, y - r * 1.1, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        break;
      // chignon
      case 5:
        calotte(0.5);
        break;
      // dégagé d'un côté
      case 6:
        calotte(0);
        ctx.beginPath();
        ctx.moveTo(x - r, y - r * 0.4);
        ctx.lineTo(x + r * 1.3, y - r * 0.9);
        ctx.lineTo(x + r * 0.4, y - r * 1.5);
        ctx.closePath();
        ctx.fill();
        break;
      // mèche
      case 7:
        ctx.beginPath();
        ctx.arc(x, y - r * 0.25, r * 1.25, Math.PI, Math.PI * 2);
        ctx.fill();
        break;
      // volume
      case 8:
        calotte(0);
        ctx.beginPath();
        ctx.ellipse(x + sens * r * 0.9, y + r * 0.6, r * 0.4, r * 1, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      // queue de côté
      case 9:
        ctx.beginPath();
        ctx.arc(x, y, r * 1.3, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();
        break;
      // dégarni
      case 10:
        calotte(0);
        ctx.beginPath();
        ctx.ellipse(x, y + r * 1.2, r * 0.8, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      // natte basse
      default:
        calotte(0);
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.2, r * 1.35, r * 0.75, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  // jeu/creation.ts
  var PRENOMS_F2 = ["Sarah", "Julie", "Amina", "Claire", "Léa", "Fatou", "Inès", "Awa"];
  var PRENOMS_M2 = ["Paul", "Marc", "Ibrahim", "Thomas", "Karim", "Lucas", "Samir", "Théo"];
  var NOMS2 = ["Bernard", "Diallo", "Moreau", "Benali", "Traoré", "Haddad", "Camara", "Perrin"];
  var TRAITS_OFFERTS = [
    { cle: "sociabilite", libelle: "Sociabilité", aide: "cherche les autres, souffre de la solitude" },
    { cle: "ambition", libelle: "Ambition", aide: "travaille plus, sacrifie du temps" },
    { cle: "impulsivite", libelle: "Impulsivité", aide: "décide au feeling plutôt qu'au mieux" },
    { cle: "discipline", libelle: "Discipline", aide: "tient ses horaires, fait du sport" }
  ];
  function ficheParDefaut() {
    return {
      prenom: "Camille",
      nom: "Moreau",
      age: 22,
      sexe: "f",
      apparence: {
        genes: { teintePeau: 90, teinteCheveux: 70, coiffure: 2, corpulence: 0, tailleCm: 170 },
        garderobe: { haut: 1, bas: 2, teinteHaut: 150, teinteBas: 30 },
        accessoires: 0
      },
      traits: { sociabilite: 20, ambition: 0, impulsivite: 0, discipline: 10 }
    };
  }
  function ecranCreation(hote, valider) {
    const fiche = ficheParDefaut();
    hote.innerHTML = `
    <div class="creation">
      <div class="creation-apercu">
        <canvas id="apercu" width="260" height="320"></canvas>
        <p class="apercu-nom" id="apercu-nom"></p>
      </div>
      <div class="creation-reglages">
        <h1>Qui êtes-vous ?</h1>
        <p class="sous">Vous entrerez dans le quartier comme n'importe quel habitant : un logement, peut-être un travail, et des voisins qui ne vous ont pas attendu.</p>

        <div class="ligne">
          <label>Prénom <input id="prenom" type="text" maxlength="18" value="${fiche.prenom}"></label>
          <label>Nom <input id="nom" type="text" maxlength="18" value="${fiche.nom}"></label>
          <button id="des" class="secondaire" type="button" title="Tirer au sort">Au hasard</button>
        </div>

        <div class="ligne">
          <label>Âge <input id="age" type="range" min="16" max="70" value="${fiche.age}"><output id="age-val"></output></label>
          <label>Silhouette
            <select id="sexe">
              <option value="f">féminine</option>
              <option value="m">masculine</option>
            </select>
          </label>
        </div>

        <h2>Apparence</h2>
        <div class="grille">
          <label>Peau <input id="peau" type="range" min="0" max="255" value="${fiche.apparence.genes.teintePeau}"></label>
          <label>Cheveux <input id="cheveux" type="range" min="0" max="255" value="${fiche.apparence.genes.teinteCheveux}"></label>
          <label>Coiffure <input id="coiffure" type="range" min="0" max="${REPERTOIRES.coiffures - 1}" value="${fiche.apparence.genes.coiffure}"></label>
          <label>Corpulence <input id="corpulence" type="range" min="-100" max="100" value="${fiche.apparence.genes.corpulence}"></label>
          <label>Taille <input id="taille" type="range" min="145" max="200" value="${fiche.apparence.genes.tailleCm}"><output id="taille-val"></output></label>
          <label>Haut <input id="haut" type="range" min="0" max="${REPERTOIRES.hauts - 1}" value="${fiche.apparence.garderobe.haut}"></label>
          <label>Couleur du haut <input id="cHaut" type="range" min="0" max="255" value="${fiche.apparence.garderobe.teinteHaut}"></label>
          <label>Bas <input id="bas" type="range" min="0" max="${REPERTOIRES.bas - 1}" value="${fiche.apparence.garderobe.bas}"></label>
          <label>Couleur du bas <input id="cBas" type="range" min="0" max="255" value="${fiche.apparence.garderobe.teinteBas}"></label>
        </div>

        <h2>Accessoires</h2>
        <div class="cases" id="accessoires">
          ${ACCESSOIRES.map((a, i) => `<label><input type="checkbox" data-bit="${i}"> ${a}</label>`).join("")}
        </div>

        <h2>Tempérament</h2>
        <div class="grille">
          ${TRAITS_OFFERTS.map((t) => `
            <label title="${t.aide}">${t.libelle}
              <input id="t-${t.cle}" type="range" min="-100" max="100" value="${fiche.traits[t.cle] ?? 0}">
            </label>`).join("")}
        </div>
        <p class="sous petite">Le reste de votre caractère est tiré au sort, comme pour tout le monde.</p>

        <button id="entrer" class="primaire" type="button">Entrer dans le quartier</button>
      </div>
    </div>`;
    const toile = hote.querySelector("#apercu");
    const ctx = toile?.getContext("2d") ?? null;
    const el = (id) => hote.querySelector(`#${id}`);
    const lire = () => {
      const val = (id) => Number(el(id)?.value ?? 0);
      fiche.prenom = el("prenom")?.value ?? fiche.prenom;
      fiche.nom = el("nom")?.value ?? fiche.nom;
      fiche.age = val("age");
      fiche.sexe = (el("sexe")?.value ?? "f") === "m" ? "m" : "f";
      fiche.apparence = {
        genes: {
          teintePeau: val("peau"),
          teinteCheveux: val("cheveux"),
          coiffure: val("coiffure"),
          corpulence: val("corpulence"),
          tailleCm: val("taille")
        },
        garderobe: {
          haut: val("haut"),
          bas: val("bas"),
          teinteHaut: val("cHaut"),
          teinteBas: val("cBas")
        },
        accessoires: [...hote.querySelectorAll("#accessoires input")].reduce((m, c, i) => c.checked ? m | 1 << i : m, 0)
      };
      for (const t of TRAITS_OFFERTS) fiche.traits[t.cle] = val(`t-${t.cle}`);
    };
    const peindre = () => {
      const ageVal = el("age-val");
      if (ageVal !== null) ageVal.textContent = `${fiche.age} ans`;
      const tailleVal = el("taille-val");
      if (tailleVal !== null) tailleVal.textContent = `${fiche.apparence.genes.tailleCm} cm`;
      const nom = el("apercu-nom");
      if (nom !== null) nom.textContent = `${fiche.prenom} ${fiche.nom}`;
      if (ctx === null || toile === null) return;
      ctx.clearRect(0, 0, toile.width, toile.height);
      const fond = ctx.createLinearGradient(0, 0, 0, toile.height);
      fond.addColorStop(0, "#DCE5E9");
      fond.addColorStop(1, "#BCC9CE");
      ctx.fillStyle = fond;
      ctx.fillRect(0, 0, toile.width, toile.height);
      dessinerHabitant(ctx, fiche.apparence, toile.width / 2, toile.height - 40, 8, {
        age: fiche.age,
        phase: 0,
        sens: 1,
        obscurite: 0,
        selectionne: false,
        accent: "#5FB0E8"
      });
    };
    hote.addEventListener("input", () => {
      lire();
      peindre();
    });
    hote.addEventListener("change", () => {
      lire();
      peindre();
    });
    el("des")?.addEventListener("click", () => {
      const au = (t) => t[Math.floor(Math.random() * t.length)];
      const mettre = (id, v) => {
        const champ2 = el(id);
        if (champ2 !== null) champ2.value = String(v);
      };
      const feminin = Math.random() < 0.5;
      mettre("prenom", au(feminin ? PRENOMS_F2 : PRENOMS_M2));
      mettre("nom", au(NOMS2));
      const sexe = el("sexe");
      if (sexe !== null) sexe.value = feminin ? "f" : "m";
      mettre("peau", Math.floor(Math.random() * 256));
      mettre("cheveux", Math.floor(Math.random() * 256));
      mettre("coiffure", Math.floor(Math.random() * REPERTOIRES.coiffures));
      mettre("corpulence", Math.floor(Math.random() * 201) - 100);
      mettre("taille", 150 + Math.floor(Math.random() * 45));
      mettre("haut", Math.floor(Math.random() * REPERTOIRES.hauts));
      mettre("bas", Math.floor(Math.random() * REPERTOIRES.bas));
      mettre("cHaut", Math.floor(Math.random() * 256));
      mettre("cBas", Math.floor(Math.random() * 256));
      lire();
      peindre();
    });
    el("entrer")?.addEventListener("click", () => {
      lire();
      valider(fiche);
    });
    lire();
    peindre();
  }

  // vue/ville.ts
  var COLONNES = 36;
  var RANGEES = 26;
  var PAS_RUE = 5;
  var TUILE = { l: 38, h: 19, etage: 20 };
  var GABARIT = {
    logement: { lr: 2, lc: 2, niveaux: [2, 5] },
    bureau: { lr: 2, lc: 4, niveaux: [5, 7] },
    ecole: { lr: 3, lc: 4, niveaux: [2, 2] },
    cafe: { lr: 2, lc: 2, niveaux: [1, 2] },
    commerce: { lr: 2, lc: 3, niveaux: [1, 1] },
    gymnase: { lr: 3, lc: 3, niveaux: [2, 2] },
    parc: { lr: 4, lc: 4, niveaux: [0, 0] },
    rue: { lr: 0, lc: 0, niveaux: [0, 0] }
  };
  var ORDRE = ["parc", "ecole", "bureau", "gymnase", "commerce", "cafe", "logement"];
  var estRue = (r, c) => r % PAS_RUE === 0 || c % PAS_RUE === 0;
  function des(graine) {
    let x = graine * 2654435761 >>> 0;
    return () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;
      x >>>= 0;
      return x / 4294967296;
    };
  }
  function batirVille(lieux, graine) {
    const tirage = des(graine);
    const tous = [...lieux];
    const sol = new Array(COLONNES * RANGEES).fill("herbe");
    const solDe = (r, c) => r * COLONNES + c;
    for (let r = 0; r < RANGEES; r += 1) {
      for (let c = 0; c < COLONNES; c += 1) {
        if (estRue(r, c)) sol[solDe(r, c)] = "route";
      }
    }
    for (let r = 0; r < RANGEES; r += 1) {
      for (let c = 0; c < COLONNES; c += 1) {
        if (estRue(r, c)) continue;
        const borde = estRue(r - 1, c) || estRue(r + 1, c) || estRue(r, c - 1) || estRue(r, c + 1);
        if (borde) sol[solDe(r, c)] = "trottoir";
      }
    }
    const ilots = [];
    for (let r = 1; r + PAS_RUE - 1 <= RANGEES; r += PAS_RUE) {
      for (let c = 1; c + PAS_RUE - 1 <= COLONNES; c += PAS_RUE) {
        const lr = PAS_RUE - 1;
        const lc = PAS_RUE - 1;
        if (r + lr > RANGEES || c + lc > COLONNES) continue;
        ilots.push({ r, c, lr, lc, pris: new Array(lr * lc).fill(false) });
      }
    }
    const batiments = [];
    const parLieu = {};
    let prochainIlot = 0;
    const placer = (lieu) => {
      const g = GABARIT[lieu.type];
      if (g.lr === 0) return false;
      const tournee = [];
      for (let i = 0; i < ilots.length; i += 1) {
        const ilot = ilots[(prochainIlot + i) % ilots.length];
        if (ilot !== void 0) tournee.push(ilot);
      }
      for (const ilot of tournee) {
        for (let dr = 0; dr + g.lr <= ilot.lr; dr += 1) {
          for (let dc = 0; dc + g.lc <= ilot.lc; dc += 1) {
            let libre = true;
            for (let a = 0; a < g.lr && libre; a += 1) {
              for (let b = 0; b < g.lc; b += 1) {
                if (ilot.pris[(dr + a) * ilot.lc + (dc + b)]) {
                  libre = false;
                  break;
                }
              }
            }
            if (!libre) continue;
            for (let a = -1; a <= g.lr; a += 1) {
              for (let b = -1; b <= g.lc; b += 1) {
                const ar = dr + a;
                const ac = dc + b;
                if (ar < 0 || ac < 0 || ar >= ilot.lr || ac >= ilot.lc) continue;
                ilot.pris[ar * ilot.lc + ac] = true;
              }
            }
            prochainIlot = (ilots.indexOf(ilot) + 1) % ilots.length;
            const r = ilot.r + dr;
            const c = ilot.c + dc;
            const niveaux = g.niveaux[0] + Math.floor(tirage() * (g.niveaux[1] - g.niveaux[0] + 1));
            batiments.push({
              id: lieu.id,
              nom: lieu.nom,
              type: lieu.type,
              capacite: lieu.capacite,
              r,
              c,
              lr: g.lr,
              lc: g.lc,
              niveaux,
              entree: porteLaPlusProche(r, c, g.lr, g.lc),
              teinte: tirage()
            });
            parLieu[lieu.id] = batiments.length - 1;
            if (lieu.type === "parc") {
              for (let a = 0; a < g.lr; a += 1) {
                for (let b = 0; b < g.lc; b += 1) sol[solDe(r + a, c + b)] = "herbe";
              }
            }
            return true;
          }
        }
      }
      return false;
    };
    for (const type of ORDRE) {
      for (const lieu of tous) {
        if (lieu.type !== type) continue;
        placer(lieu);
      }
    }
    const rue = tous.find((l) => l.type === "rue");
    if (rue !== void 0) {
      parLieu[rue.id] = -1;
    }
    const decors = [];
    const occupe = /* @__PURE__ */ new Set();
    for (const b of batiments) {
      for (let a = 0; a < b.lr; a += 1) {
        for (let d = 0; d < b.lc; d += 1) occupe.add(solDe(b.r + a, b.c + d));
      }
    }
    for (let r = 1; r < RANGEES - 1; r += 1) {
      for (let c = 1; c < COLONNES - 1; c += 1) {
        const i = solDe(r, c);
        if (occupe.has(i)) continue;
        const nature = sol[i];
        if (nature === "herbe") {
          if (tirage() < 0.5) {
            decors.push({ r, c, genre: tirage() < 0.7 ? "arbre" : "buisson", dr: tirage(), dc: tirage() });
          }
          if (tirage() < 0.12) decors.push({ r, c, genre: "banc", dr: tirage(), dc: tirage() });
          continue;
        }
        if (nature === "trottoir") {
          if (tirage() < 0.16) decors.push({ r, c, genre: "arbre", dr: 0.5, dc: 0.5 });
          else if (tirage() < 0.1) decors.push({ r, c, genre: "lampadaire", dr: 0.5, dc: 0.5 });
          continue;
        }
        if (nature === "terre" && tirage() < 0.3) {
          decors.push({ r, c, genre: "buisson", dr: tirage(), dc: tirage() });
        }
      }
    }
    const largeur = (COLONNES + RANGEES) * (TUILE.l / 2) + 40;
    const origine = { x: RANGEES * (TUILE.l / 2) + 20, y: 190 };
    const hauteur = (COLONNES + RANGEES) * (TUILE.h / 2) + origine.y + 40;
    return {
      colonnes: COLONNES,
      rangees: RANGEES,
      tuile: TUILE,
      origine,
      largeur: Math.round(largeur),
      hauteur: Math.round(hauteur),
      sol,
      batiments,
      decors,
      parLieu
    };
  }
  function porteLaPlusProche(r, c, lr, lc) {
    const candidats = [
      { r: r + lr, c: c + Math.floor(lc / 2) },
      { r: r + Math.floor(lr / 2), c: c + lc },
      { r: r - 1, c: c + Math.floor(lc / 2) },
      { r: r + Math.floor(lr / 2), c: c - 1 }
    ];
    for (const p of candidats) {
      if (p.r < 0 || p.c < 0 || p.r >= RANGEES || p.c >= COLONNES) continue;
      if (estRue(p.r, p.c)) return p;
    }
    return { r: Math.max(0, r - r % PAS_RUE), c: Math.max(0, c - c % PAS_RUE) };
  }

  // jeu/camera.ts
  var ZOOM_MIN = 0.35;
  var ZOOM_MAX = 3;
  function creerCamera(cx, cy, zoom = 1) {
    return { cx, cy, zoom, suivi: null };
  }
  function versEcran(c, t, x, y) {
    return {
      x: (x - c.cx) * c.zoom + t.largeur / 2,
      y: (y - c.cy) * c.zoom + t.hauteur / 2
    };
  }
  function versMonde(c, t, x, y) {
    return {
      x: (x - t.largeur / 2) / c.zoom + c.cx,
      y: (y - t.hauteur / 2) / c.zoom + c.cy
    };
  }
  function champ(c, t, marge = 160) {
    const demiL = t.largeur / (2 * c.zoom) + marge;
    const demiH = t.hauteur / (2 * c.zoom) + marge;
    return { x0: c.cx - demiL, y0: c.cy - demiH, x1: c.cx + demiL, y1: c.cy + demiH };
  }
  function deplacer2(c, dxEcran, dyEcran) {
    c.cx -= dxEcran / c.zoom;
    c.cy -= dyEcran / c.zoom;
    c.suivi = null;
  }
  function zoomer(c, t, facteur, xEcran, yEcran) {
    const avant = versMonde(c, t, xEcran, yEcran);
    c.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * facteur));
    const apres = versMonde(c, t, xEcran, yEcran);
    c.cx += avant.x - apres.x;
    c.cy += avant.y - apres.y;
  }
  function suivre(c, x, y, douceur = 0.12) {
    c.cx += (x - c.cx) * douceur;
    c.cy += (y - c.cy) * douceur;
  }
  function borner2(c, largeurMonde, hauteurMonde) {
    c.cx = Math.max(-200, Math.min(largeurMonde + 200, c.cx));
    c.cy = Math.max(-200, Math.min(hauteurMonde + 200, c.cy));
  }

  // jeu/scene.ts
  var ACCENT = "#5FB0E8";
  var JOUR = {
    route: "#6C7175",
    marquage: "#C6CABB",
    trottoir: "#B7BAB3",
    herbe: "#7CA05F",
    terre: "#A3997F",
    place: "#C0BCAE",
    ciel: "#8FA98B",
    facades: ["#D8CEBF", "#C7B8A5", "#BEC6C8", "#D1C1B3", "#B8A896", "#C8CEC1", "#CDBCAE", "#B6BEC2"],
    toits: ["#7A6A5C", "#6D6056", "#877868", "#8C9094", "#6F6458"],
    vitre: "#4E5F6C",
    vitreAllumee: "#FFD08A",
    feuillage: ["#4E7A46", "#5C8A4E", "#456E40"],
    tronc: "#6B4F3A"
  };
  var NUIT = "#16202C";
  function hex2(n) {
    const s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return s.length < 2 ? `0${s}` : s;
  }
  function melange(hex, cible, t) {
    if (t <= 0) return hex;
    if (t >= 1) return cible;
    const a = Number.parseInt(hex.slice(1), 16);
    const b = Number.parseInt(cible.slice(1), 16);
    return `#${hex2((a >> 16 & 255) * (1 - t) + (b >> 16 & 255) * t)}${hex2((a >> 8 & 255) * (1 - t) + (b >> 8 & 255) * t)}${hex2((a & 255) * (1 - t) + (b & 255) * t)}`;
  }
  var assombrir2 = (hex, f) => melange(hex, "#000000", f);
  function obscuriteDe(heure) {
    if (heure >= 21 || heure < 5) return 0.74;
    if (heure >= 18) return 0.74 * (heure - 18) / 3;
    if (heure < 8) return 0.74 * (1 - (heure - 5) / 3);
    return 0;
  }
  function creerScene(monde) {
    const ville = batirVille(monde.lieux.values(), monde.graine);
    const routes = [];
    for (let r = 0; r < ville.rangees; r += 1) {
      for (let c = 0; c < ville.colonnes; c += 1) {
        if (ville.sol[r * ville.colonnes + c] === "route") routes.push({ r, c });
      }
    }
    return {
      ville,
      routes,
      cheminsCache: /* @__PURE__ */ new Map(),
      sens: /* @__PURE__ */ new Map(),
      dernierePos: /* @__PURE__ */ new Map(),
      sol: null,
      solObscurite: -1
    };
  }
  function proj(v, c, r, z = 0) {
    return {
      x: (c - r) * (v.tuile.l / 2) + v.origine.x,
      y: (c + r) * (v.tuile.h / 2) - z + v.origine.y
    };
  }
  function batimentDe(s, lieu) {
    const i = s.ville.parLieu[lieu];
    return i === void 0 || i < 0 ? void 0 : s.ville.batiments[i];
  }
  function cellule(s, p) {
    const b = batimentDe(s, p.position.lieu);
    if (b === void 0) {
      const i = (p.position.x * 31 + p.position.y) % Math.max(1, s.routes.length);
      const cel = s.routes[i] ?? { r: 0, c: 0 };
      return { r: cel.r + 0.5, c: cel.c + 0.5 };
    }
    return {
      r: b.r + p.position.y / 1e3 * b.lr,
      c: b.c + p.position.x / 1e3 * b.lc
    };
  }
  function entree(s, lieu) {
    const b = batimentDe(s, lieu);
    if (b === void 0) {
      const cel = s.routes[Math.floor(s.routes.length / 2)] ?? { r: 0, c: 0 };
      return { r: cel.r + 0.5, c: cel.c + 0.5 };
    }
    return { r: b.entree.r + 0.5, c: b.entree.c + 0.5 };
  }
  function chemin(s, a, b) {
    const cle = `${Math.round(a.r)},${Math.round(a.c)}|${Math.round(b.r)},${Math.round(b.c)}`;
    const connu = s.cheminsCache.get(cle);
    if (connu !== void 0) return connu;
    const v = s.ville;
    const idx = (p) => p.r * v.colonnes + p.c;
    const estRoute = (p) => p.r >= 0 && p.c >= 0 && p.r < v.rangees && p.c < v.colonnes && v.sol[idx(p)] === "route";
    const depart = { r: Math.round(a.r - 0.5), c: Math.round(a.c - 0.5) };
    const arrivee = { r: Math.round(b.r - 0.5), c: Math.round(b.c - 0.5) };
    if (!estRoute(depart) || !estRoute(arrivee)) {
      const direct = [a, b];
      s.cheminsCache.set(cle, direct);
      return direct;
    }
    const vus = /* @__PURE__ */ new Set([idx(depart)]);
    const parent = /* @__PURE__ */ new Map();
    const file = [depart];
    let trouve = false;
    while (file.length > 0 && !trouve) {
      const p = file.shift();
      if (p === void 0) break;
      for (const d of [{ r: 1, c: 0 }, { r: -1, c: 0 }, { r: 0, c: 1 }, { r: 0, c: -1 }]) {
        const q = { r: p.r + d.r, c: p.c + d.c };
        if (!estRoute(q) || vus.has(idx(q))) continue;
        vus.add(idx(q));
        parent.set(idx(q), p);
        if (q.r === arrivee.r && q.c === arrivee.c) {
          trouve = true;
          break;
        }
        file.push(q);
      }
    }
    const route = [];
    let cur = arrivee;
    let garde = 0;
    while (cur !== void 0 && !(cur.r === depart.r && cur.c === depart.c) && garde < 500) {
      route.unshift({ r: cur.r + 0.5, c: cur.c + 0.5 });
      cur = parent.get(idx(cur));
      garde += 1;
    }
    route.unshift(a);
    route.push(b);
    s.cheminsCache.set(cle, route);
    return route;
  }
  function surChemin(route, t) {
    if (route.length < 2) return route[0] ?? { r: 0, c: 0 };
    const d = Math.max(0, Math.min(1, t)) * (route.length - 1);
    const i = Math.min(route.length - 2, Math.floor(d));
    const f = d - i;
    const a = route[i] ?? { r: 0, c: 0 };
    const b = route[i + 1] ?? a;
    return { r: a.r + (b.r - a.r) * f, c: a.c + (b.c - a.c) * f };
  }
  function positionDe(s, monde, p) {
    const a = p.activite;
    if (a !== null && a.type === "deplacement") {
      const route = chemin(s, entree(s, p.position.lieu), entree(s, a.vers));
      const avance = 1 - (a.jusqua - monde.tick) / DUREE_TRAJET;
      const cel2 = surChemin(route, avance);
      return proj(s.ville, cel2.c, cel2.r);
    }
    const cel = cellule(s, p);
    return proj(s.ville, cel.c, cel.r);
  }
  function estDehors(s, p) {
    if (p.activite !== null && p.activite.type === "deplacement") return true;
    const b = batimentDe(s, p.position.lieu);
    return b === void 0 || b.type === "parc";
  }
  var RESOLUTION_SOL = 2;
  function rendreSol(s, obscurite) {
    const v = s.ville;
    const toile = document.createElement("canvas");
    toile.width = v.largeur * RESOLUTION_SOL;
    toile.height = v.hauteur * RESOLUTION_SOL;
    const g = toile.getContext("2d");
    if (g === null) return toile;
    g.setTransform(RESOLUTION_SOL, 0, 0, RESOLUTION_SOL, 0, 0);
    g.fillStyle = melange(JOUR.ciel, NUIT, obscurite);
    g.fillRect(0, 0, v.largeur, v.hauteur);
    const losange = (c, r) => {
      const a = proj(v, c, r), b = proj(v, c + 1, r);
      const d = proj(v, c + 1, r + 1), e = proj(v, c, r + 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineTo(d.x, d.y);
      g.lineTo(e.x, e.y);
      g.closePath();
    };
    for (let somme = 0; somme <= v.colonnes + v.rangees; somme += 1) {
      for (let r = 0; r < v.rangees; r += 1) {
        const c = somme - r;
        if (c < 0 || c >= v.colonnes) continue;
        const nature = v.sol[r * v.colonnes + c];
        const base = nature === "route" ? JOUR.route : nature === "trottoir" ? JOUR.trottoir : nature === "herbe" ? JOUR.herbe : nature === "place" ? JOUR.place : JOUR.terre;
        const bruit = ((r * 73856093 ^ c * 19349663) >>> 0) % 100 / 100;
        losange(c, r);
        g.fillStyle = melange(assombrir2(base, bruit * 0.055), NUIT, obscurite);
        g.fill();
        if (nature === "route") {
          g.strokeStyle = melange(assombrir2(JOUR.route, 0.25), NUIT, obscurite);
          g.lineWidth = 1;
          g.stroke();
          const axeH = r % 5 === 0 && c % 5 !== 0;
          const axeV = c % 5 === 0 && r % 5 !== 0;
          if (axeH || axeV) {
            const p1 = axeH ? proj(v, c, r + 0.5) : proj(v, c + 0.5, r);
            const p2 = axeH ? proj(v, c + 1, r + 0.5) : proj(v, c + 0.5, r + 1);
            g.strokeStyle = melange(JOUR.marquage, NUIT, obscurite * 0.7);
            g.lineWidth = 1.6;
            g.setLineDash([7, 8]);
            g.beginPath();
            g.moveTo(p1.x, p1.y);
            g.lineTo(p2.x, p2.y);
            g.stroke();
            g.setLineDash([]);
          }
        } else if (nature === "trottoir") {
          g.strokeStyle = melange(assombrir2(JOUR.trottoir, 0.13), NUIT, obscurite);
          g.lineWidth = 1;
          g.stroke();
        }
      }
    }
    return toile;
  }
  function dessinerScene(ctx, s, monde, camera2, toile, o) {
    const v = s.ville;
    const heure = heureDecimale(monde.tick);
    const obs = obscuriteDe(heure);
    if (s.sol === null || Math.abs(s.solObscurite - obs) > 0.06) {
      s.sol = rendreSol(s, obs);
      s.solObscurite = obs;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = melange(JOUR.ciel, NUIT, obs);
    ctx.fillRect(0, 0, toile.largeur, toile.hauteur);
    const coin = versEcran(camera2, toile, 0, 0);
    ctx.drawImage(
      s.sol,
      coin.x,
      coin.y,
      v.largeur * camera2.zoom,
      v.hauteur * camera2.zoom
    );
    const vue = champ(camera2, toile);
    const visible = (x, y) => x > vue.x0 && x < vue.x1 && y > vue.y0 && y < vue.y1;
    const parLieu = /* @__PURE__ */ new Map();
    for (const p of monde.personnages.values()) {
      if (estDehors(s, p)) continue;
      const k = p.position.lieu;
      parLieu.set(k, (parLieu.get(k) ?? 0) + 1);
    }
    const items = [];
    v.batiments.forEach((b, i) => {
      const centre = proj(v, b.c + b.lc / 2, b.r + b.lr / 2);
      if (!visible(centre.x, centre.y)) return;
      items.push({
        profondeur: b.r + b.lr + b.c + b.lc,
        couche: b.type === "parc" ? 0 : 2,
        dessiner: () => dessinerBatiment(ctx, s, b, parLieu.get(b.id) ?? 0, obs, i === o.batimentSurvole, camera2, toile)
      });
    });
    for (const d of v.decors) {
      const p = proj(v, d.c + 0.5, d.r + 0.5);
      if (!visible(p.x, p.y)) continue;
      items.push({
        profondeur: d.r + d.c + 1,
        couche: 1,
        dessiner: () => dessinerDecor(ctx, s, d, obs, camera2, toile)
      });
    }
    for (const p of monde.personnages.values()) {
      if (!estDehors(s, p)) continue;
      const monde2 = positionDe(s, monde, p);
      if (!visible(monde2.x, monde2.y)) continue;
      const precedent = s.dernierePos.get(p.id);
      if (precedent !== void 0 && Math.abs(monde2.x - precedent.x) > 0.4) {
        s.sens.set(p.id, monde2.x > precedent.x ? 1 : -1);
      }
      s.dernierePos.set(p.id, monde2);
      const enMarche = p.activite !== null && p.activite.type === "deplacement";
      const cel = { r: (monde2.y - v.origine.y) / (v.tuile.h / 2), c: 0 };
      items.push({
        profondeur: cel.r + 0.6,
        couche: 3,
        dessiner: () => {
          const e = versEcran(camera2, toile, monde2.x, monde2.y);
          dessinerHabitant(ctx, p.apparence, e.x, e.y, camera2.zoom, {
            age: age(p.naissance, monde.tick),
            phase: enMarche ? (o.temps / 130 + p.id) % (Math.PI * 2) : 0,
            sens: s.sens.get(p.id) ?? 1,
            obscurite: obs,
            selectionne: p.id === o.selection || p.id === o.joueur,
            accent: p.id === o.joueur ? "#F2C14E" : ACCENT
          });
        }
      });
    }
    items.sort((a, b) => a.profondeur - b.profondeur || a.couche - b.couche);
    for (const item of items) item.dessiner();
  }
  function dessinerBatiment(ctx, s, b, occupants, obs, surligne, camera2, toile) {
    const v = s.ville;
    const E = (c, r, z = 0) => {
      const m = proj(v, c, r, z);
      return versEcran(camera2, toile, m.x, m.y);
    };
    if (b.type === "parc") {
      const a = E(b.c, b.r), bb = E(b.c + b.lc, b.r);
      const d = E(b.c + b.lc, b.r + b.lr), e = E(b.c, b.r + b.lr);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(bb.x, bb.y);
      ctx.lineTo(d.x, d.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.fillStyle = melange(assombrir2(JOUR.herbe, 0.05), NUIT, obs);
      ctx.fill();
      if (surligne) {
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      return;
    }
    const H = b.niveaux * v.tuile.etage;
    const facade = JOUR.facades[Math.floor(b.teinte * JOUR.facades.length) % JOUR.facades.length] ?? "#CCC";
    const toit = JOUR.toits[Math.floor(b.teinte * 977) % JOUR.toits.length] ?? "#777";
    const A = E(b.c, b.r, H), B = E(b.c + b.lc, b.r, H);
    const C = E(b.c + b.lc, b.r + b.lr, H), D = E(b.c, b.r + b.lr, H);
    const Bb = E(b.c + b.lc, b.r), Cb = E(b.c + b.lc, b.r + b.lr), Db = E(b.c, b.r + b.lr);
    const face = (p1, p2, p3, p4, couleur) => {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fillStyle = couleur;
      ctx.fill();
    };
    face(D, C, Cb, Db, melange(assombrir2(facade, 0.3), NUIT, obs));
    face(C, B, Bb, Cb, melange(assombrir2(facade, 0.1), NUIT, obs));
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(C.x, C.y);
    ctx.lineTo(D.x, D.y);
    ctx.closePath();
    ctx.fillStyle = melange(toit, NUIT, obs * 0.9);
    ctx.fill();
    ctx.strokeStyle = melange(assombrir2(toit, 0.3), NUIT, obs);
    ctx.lineWidth = 1;
    ctx.stroke();
    if (camera2.zoom > 0.5) {
      const part = occupants === 0 ? 0 : Math.min(1, 0.35 + occupants / Math.max(4, b.capacite));
      const l = 7 * camera2.zoom, h = 9 * camera2.zoom;
      for (let n = 0; n < b.niveaux; n += 1) {
        const z = (n + 0.5) * v.tuile.etage;
        const poser2 = (c, r, gauche, k) => {
          const p = E(c, r, z);
          const graine = ((b.id * 7919 ^ n * 104729 ^ k * 1299709) >>> 0) % 100 / 100;
          const allumee = obs > 0.12 && graine < part;
          ctx.beginPath();
          if (gauche) {
            ctx.moveTo(p.x - l / 2, p.y - h / 2 - l / 4);
            ctx.lineTo(p.x + l / 2, p.y - h / 2 + l / 4);
            ctx.lineTo(p.x + l / 2, p.y + h / 2 + l / 4);
            ctx.lineTo(p.x - l / 2, p.y + h / 2 - l / 4);
          } else {
            ctx.moveTo(p.x - l / 2, p.y - h / 2 + l / 4);
            ctx.lineTo(p.x + l / 2, p.y - h / 2 - l / 4);
            ctx.lineTo(p.x + l / 2, p.y + h / 2 - l / 4);
            ctx.lineTo(p.x - l / 2, p.y + h / 2 + l / 4);
          }
          ctx.closePath();
          ctx.fillStyle = allumee ? JOUR.vitreAllumee : melange(assombrir2(JOUR.vitre, gauche ? 0.25 : 0.05), NUIT, obs);
          ctx.fill();
        };
        for (let k = 0; k < b.lr; k += 1) poser2(b.c, b.r + k + 0.5, true, k);
        for (let j = 0; j < b.lc; j += 1) poser2(b.c + j + 0.5, b.r + b.lr, false, j + 10);
      }
    }
    if (surligne) {
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.lineTo(Bb.x, Bb.y);
      ctx.lineTo(Cb.x, Cb.y);
      ctx.lineTo(Db.x, Db.y);
      ctx.lineTo(D.x, D.y);
      ctx.closePath();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
  }
  function dessinerDecor(ctx, s, d, obs, camera2, toile) {
    const m = proj(s.ville, d.c + 0.2 + d.dc * 0.6, d.r + 0.2 + d.dr * 0.6);
    const p = versEcran(camera2, toile, m.x, m.y);
    const z = camera2.zoom;
    const feuillage = melange(JOUR.feuillage[Math.floor(d.dr * 3) % 3] ?? "#4E7A46", NUIT, obs);
    if (d.genre === "arbre") {
      ctx.fillStyle = melange(JOUR.tronc, NUIT, obs);
      ctx.fillRect(p.x - 1.5 * z, p.y - 13 * z, 3 * z, 13 * z);
      ctx.beginPath();
      ctx.arc(p.x, p.y - 18 * z, 8 * z, 0, Math.PI * 2);
      ctx.fillStyle = feuillage;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x - 4 * z, p.y - 14 * z, 5.5 * z, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.genre === "buisson") {
      ctx.beginPath();
      ctx.arc(p.x, p.y - 3 * z, 5 * z, 0, Math.PI * 2);
      ctx.fillStyle = feuillage;
      ctx.fill();
    } else if (d.genre === "banc") {
      ctx.fillStyle = melange("#8A6E52", NUIT, obs);
      ctx.fillRect(p.x - 6 * z, p.y - 5 * z, 12 * z, 3 * z);
    } else {
      ctx.fillStyle = melange("#6A7075", NUIT, obs * 0.5);
      ctx.fillRect(p.x - z, p.y - 22 * z, 2 * z, 22 * z);
      if (obs > 0.15) {
        const lueur = ctx.createRadialGradient(p.x, p.y - 24 * z, 1, p.x, p.y - 24 * z, 26 * z);
        lueur.addColorStop(0, "rgba(255,214,150,.5)");
        lueur.addColorStop(1, "rgba(255,214,150,0)");
        ctx.fillStyle = lueur;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 24 * z, 26 * z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y - 23 * z, 2.6 * z, 0, Math.PI * 2);
      ctx.fillStyle = obs > 0.15 ? "#FFD79A" : "#C9CDBF";
      ctx.fill();
    }
  }
  function habitantSous(s, monde, camera2, toile, xe, ye) {
    let meilleur = null;
    let distance = Math.pow(18 * Math.max(0.6, camera2.zoom), 2);
    for (const p of monde.personnages.values()) {
      if (!estDehors(s, p)) continue;
      const m = positionDe(s, monde, p);
      const e = versEcran(camera2, toile, m.x, m.y);
      const d = (e.x - xe) ** 2 + (e.y - ye - 12 * camera2.zoom) ** 2;
      if (d < distance) {
        distance = d;
        meilleur = p;
      }
    }
    return meilleur;
  }
  function batimentSous(s, camera2, toile, xe, ye) {
    const v = s.ville;
    const ordre = s.ville.batiments.map((b, i) => ({ b, i })).sort((a, z) => z.b.r + z.b.c - (a.b.r + a.b.c));
    for (const { b, i } of ordre) {
      const H = b.type === "parc" ? 0 : b.niveaux * v.tuile.etage;
      const E = (c, r, z = 0) => {
        const m = proj(v, c, r, z);
        return versEcran(camera2, toile, m.x, m.y);
      };
      const poly = [
        E(b.c, b.r, H),
        E(b.c + b.lc, b.r, H),
        E(b.c + b.lc, b.r),
        E(b.c + b.lc, b.r + b.lr),
        E(b.c, b.r + b.lr),
        E(b.c, b.r + b.lr, H)
      ];
      let dedans = false;
      for (let a = 0, z = poly.length - 1; a < poly.length; z = a++) {
        const pa = poly[a], pz = poly[z];
        if (pa === void 0 || pz === void 0) continue;
        if (pa.y > ye !== pz.y > ye && xe < (pz.x - pa.x) * (ye - pa.y) / (pz.y - pa.y) + pa.x) dedans = !dedans;
      }
      if (dedans) return { batiment: b, indice: i };
    }
    return null;
  }

  // jeu/main.ts
  var racine2 = document.getElementById("jeu");
  if (racine2 === null) throw new Error("#jeu introuvable");
  var partie = null;
  var scene = null;
  var camera = null;
  var selection = null;
  var batimentSurvole = null;
  var boucleLancee = false;
  function menu() {
    racine2.innerHTML = `
    <div class="menu">
      <h1>Quartier Témoin</h1>
      <p>Soixante habitants y vivent déjà. Ils ont un logement, un travail ou une école, des besoins et un caractère — et ils ne vous ont pas attendu.</p>
      <p>Vous allez en devenir un.</p>
      <div class="menu-reglages">
        <label>Habitants <input id="population" type="range" min="30" max="300" step="10" value="60"><output id="population-val">60</output></label>
        <label>Graine <input id="graine" type="number" value="1" min="1" max="999999"></label>
      </div>
      <button id="nouvelle" class="primaire" type="button">Nouvelle partie</button>
      <p class="petite">Molette pour zoomer · glisser pour déplacer la caméra · clic sur un bâtiment pour vous y rendre · clic sur un habitant pour l'observer.</p>
    </div>`;
    const pop = racine2.querySelector("#population");
    const popVal = racine2.querySelector("#population-val");
    pop?.addEventListener("input", () => {
      if (popVal !== null) popVal.textContent = pop.value;
    });
    racine2.querySelector("#nouvelle")?.addEventListener("click", () => {
      const population = Number(pop?.value ?? 60);
      const graine = Number(racine2.querySelector("#graine")?.value ?? 1);
      creation(population, graine);
    });
  }
  function creation(population, graine) {
    ecranCreation(racine2, (fiche) => {
      partie = commencerPartie({ graine, population, fiche });
      scene = creerScene(partie.monde);
      camera = creerCamera(scene.ville.largeur / 2, scene.ville.hauteur / 2, 1.1);
      camera.suivi = partie.joueur;
      selection = partie.joueur;
      window.__partie = () => partie;
      window.__scene = () => scene;
      jeu();
    });
  }
  function jeu() {
    racine2.innerHTML = `
    <div class="scene">
      <canvas id="toile"></canvas>
      <div class="hud-haut">
        <div class="horloge"><b id="heure">--:--</b><span id="jour"></span></div>
        <div class="vitesses" id="vitesses"></div>
        <button id="recentrer" class="secondaire" type="button">Mon personnage</button>
      </div>
      <div class="panneau" id="panneau"></div>
      <div class="hud-bas">
        <span id="etat-joueur"></span>
        <button id="laisser" class="secondaire" type="button">Le laisser décider</button>
        <button id="arreter" class="secondaire" type="button">S'arrêter</button>
      </div>
    </div>`;
    const toile = racine2.querySelector("#toile");
    const ctx = toile?.getContext("2d") ?? null;
    if (toile === null || ctx === null) return;
    const redimensionner = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      toile.width = toile.clientWidth * dpr;
      toile.height = toile.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    redimensionner();
    window.addEventListener("resize", redimensionner);
    const dim = () => ({
      largeur: toile.clientWidth,
      hauteur: toile.clientHeight
    });
    const boiteVitesses = racine2.querySelector("#vitesses");
    const peindreVitesses = () => {
      if (boiteVitesses === null || partie === null) return;
      boiteVitesses.innerHTML = VITESSES_JEU.map(
        (v) => `<button data-v="${v}" aria-pressed="${v === partie.horloge.vitesse}">${v === 0 ? "❚❚" : `×${v}`}</button>`
      ).join("");
    };
    boiteVitesses?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (b === null || partie === null) return;
      partie.horloge.vitesse = Number(b.dataset.v);
      peindreVitesses();
    });
    peindreVitesses();
    window.addEventListener("keydown", (e) => {
      if (partie === null) return;
      if (e.key === " ") {
        e.preventDefault();
        partie.horloge.vitesse = partie.horloge.vitesse === 0 ? 1 : 0;
        peindreVitesses();
      }
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) {
        partie.horloge.vitesse = VITESSES_JEU[i + 1] ?? 1;
        peindreVitesses();
      }
    });
    let glisse = false;
    let dernier = { x: 0, y: 0 };
    let bouge = 0;
    toile.addEventListener("pointerdown", (e) => {
      glisse = true;
      bouge = 0;
      dernier = { x: e.clientX, y: e.clientY };
      toile.setPointerCapture(e.pointerId);
    });
    toile.addEventListener("pointermove", (e) => {
      if (camera === null || scene === null) return;
      if (glisse) {
        const dx = e.clientX - dernier.x;
        const dy = e.clientY - dernier.y;
        bouge += Math.abs(dx) + Math.abs(dy);
        if (bouge > 4) deplacer2(camera, dx, dy);
        dernier = { x: e.clientX, y: e.clientY };
        borner2(camera, scene.ville.largeur, scene.ville.hauteur);
        return;
      }
      const r = toile.getBoundingClientRect();
      const b = batimentSous(scene, camera, dim(), e.clientX - r.left, e.clientY - r.top);
      batimentSurvole = b?.indice ?? null;
      toile.style.cursor = b === null ? "grab" : "pointer";
    });
    toile.addEventListener("pointerup", (e) => {
      glisse = false;
      if (bouge > 4 || partie === null || scene === null || camera === null) return;
      const r = toile.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const h = habitantSous(scene, partie.monde, camera, dim(), x, y);
      if (h !== null) {
        selection = h.id;
        peindrePanneau();
        return;
      }
      const b = batimentSous(scene, camera, dim(), x, y);
      if (b !== null) {
        commanderDeplacement(partie, b.batiment.id);
        selection = partie.joueur;
        peindrePanneau();
      }
    });
    toile.addEventListener("wheel", (e) => {
      if (camera === null) return;
      e.preventDefault();
      const r = toile.getBoundingClientRect();
      zoomer(camera, dim(), e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    racine2.querySelector("#recentrer")?.addEventListener("click", () => {
      if (partie === null || camera === null) return;
      camera.suivi = partie.joueur;
      selection = partie.joueur;
      peindrePanneau();
    });
    racine2.querySelector("#arreter")?.addEventListener("click", () => {
      if (partie !== null) commanderArret(partie);
    });
    racine2.querySelector("#laisser")?.addEventListener("click", () => {
      if (partie !== null) commanderAutonomie(partie);
    });
    const panneau = racine2.querySelector("#panneau");
    function peindrePanneau() {
      if (panneau === null || partie === null) return;
      const p = selection === null ? null : partie.monde.personnages.get(selection);
      if (p === null || p === void 0) {
        panneau.innerHTML = "";
        return;
      }
      panneau.innerHTML = ficheHtml(partie, p);
    }
    let precedent = 0;
    const image = (ms) => {
      if (partie === null || scene === null || camera === null) {
        boucleLancee = false;
        return;
      }
      const delta = precedent === 0 ? 16 : Math.min(ms - precedent, 250);
      precedent = ms;
      avancerPartie(partie, delta);
      if (camera.suivi !== null) {
        const j2 = partie.monde.personnages.get(camera.suivi);
        if (j2 !== void 0) {
          const m = positionDe(scene, partie.monde, j2);
          suivre(camera, m.x, m.y);
        }
      }
      dessinerScene(ctx, scene, partie.monde, camera, dim(), {
        joueur: partie.joueur,
        selection,
        batimentSurvole,
        temps: ms
      });
      const j = personnageJoueur(partie);
      if (j !== void 0) {
        const m = positionDe(scene, partie.monde, j);
        const e = versEcran(camera, dim(), m.x, m.y);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 34 * camera.zoom);
        ctx.lineTo(e.x - 6, e.y - 46 * camera.zoom);
        ctx.lineTo(e.x + 6, e.y - 46 * camera.zoom);
        ctx.closePath();
        ctx.fillStyle = "#F2C14E";
        ctx.fill();
      }
      const t = horodatage(partie.monde);
      const eh = document.getElementById("heure");
      const ej = document.getElementById("jour");
      if (eh !== null) eh.textContent = t.heure;
      if (ej !== null) ej.textContent = t.jour;
      const etat = document.getElementById("etat-joueur");
      if (etat !== null && j !== void 0) etat.textContent = resumeActivite(partie, j);
      peindrePanneau();
      requestAnimationFrame(image);
    };
    if (!boucleLancee) {
      boucleLancee = true;
      requestAnimationFrame(image);
    }
    peindrePanneau();
  }
  function nomLieu(partie2, p) {
    const a = p.activite;
    if (a !== null && a.type === "deplacement") {
      return `en chemin vers ${partie2.monde.lieux.get(a.vers)?.nom ?? "…"}`;
    }
    return partie2.monde.lieux.get(p.position.lieu)?.nom ?? "—";
  }
  function resumeActivite(partie2, p) {
    const a = p.activite;
    const quoi = a === null ? "décide" : a.type === "deplacement" ? "se déplace" : a.action.replace(/_/g, " ");
    return `${p.prenom} — ${quoi} · ${nomLieu(partie2, p)}`;
  }
  function ficheHtml(partie2, p) {
    const poste = posteDe(partie2.monde, p);
    const chezSoi = partie2.monde.lieux.get(domicile(partie2.monde, p) ?? 0)?.nom ?? "—";
    const a = p.activite;
    const quoi = a === null ? "décide" : a.type === "deplacement" ? "se déplace" : a.action.replace(/_/g, " ");
    const jauge = (nom, v) => `
    <div class="jauge"><span>${nom}</span>
      <i style="--part:${Math.round(v / 1e3 * 100)}%"></i>
      <b>${Math.round(v / 10)}</b>
    </div>`;
    const caractere = ["sociabilite", "ambition", "impulsivite", "discipline"].map((t) => `<li>${t} <b>${trait(p, t) > 0 ? "+" : ""}${trait(p, t)}</b></li>`).join("");
    return `
    <header>
      <h2>${nomComplet(p)}${p.id === partie2.joueur ? " <em>(vous)</em>" : ""}</h2>
      <p>${age(p.naissance, partie2.monde.tick)} ans · ${poste?.intitule ?? "sans occupation"}</p>
    </header>
    <dl>
      <dt>en ce moment</dt><dd>${quoi}</dd>
      <dt>se trouve</dt><dd>${nomLieu(partie2, p)}</dd>
      <dt>habite</dt><dd>${chezSoi}</dd>
      ${poste === void 0 ? "" : `<dt>horaires</dt><dd>${poste.debutH} h – ${poste.finH} h</dd>`}
      <dt>argent</dt><dd>${p.argent} €</dd>
    </dl>
    <h3>Besoins</h3>
    ${BESOINS.map((b) => jauge(b, besoin(p, b))).join("")}
    <h3>Tempérament</h3>
    <ul class="traits">${caractere}</ul>`;
  }
  menu();
})();
