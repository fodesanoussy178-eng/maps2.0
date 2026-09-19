/* ---------------------------------------------------------------------------
   L'écosystème entrepreneurial, et les structures vues par OpenStreetMap

   POURQUOI UN INCUBATEUR N'EST PAS PERTINENT PARCE QU'IL EST UN INCUBATEUR

   C'est la consigne la plus facile à trahir sans s'en apercevoir. Un agent qui
   cherche « incubateur » trouve des incubateurs, les range en « pertinents »,
   et rend une liste qui a l'air excellente — alors qu'aucun fait n'a été
   observé. Autour montre des SORTIES : un incubateur n'en produit pas. Le lien
   avec Autour, s'il existe, est d'une autre nature — il réunit des gens qui
   lancent des projets locaux, et il organise des rencontres. C'est une
   hypothèse de diffusion, pas une source de contenu.

   Ce module écrit donc, pour chaque structure, une `raison_pertinence` qui dit
   le mécanisme ET son statut : observé, ou supposé. La qualification s'appuie
   dessus, et une hypothèse non vérifiée ne monte jamais au-dessus de
   « moyen ».

   POURQUOI OPENSTREETMAP POUR L'INTERNATIONAL

   Hors de France, les deux meilleures sources d'Autour disparaissent :
   l'annuaire des entreprises s'arrête à la frontière, et `events` ne contient
   rien. OSM est la seule base ouverte, mondiale et licenciée pour cet usage
   (ODbL). Elle a un avantage inattendu : ses tags `website` et `contact:email`
   apportent la structure ET sa porte d'entrée dans la même réponse — alors
   qu'en France il faut deux sources pour obtenir les deux.
--------------------------------------------------------------------------- */

import { cleDedup, normaliserTexte } from "./normalisation.mjs";
import { nomExploitable } from "./sources.mjs";
import { adresseInstitutionnelle } from "./canaux.mjs";

/* ---------------------------------------------------------------------------
   1. RECONNAÎTRE UNE STRUCTURE D'ACCOMPAGNEMENT À SON NOM

   L'annuaire des entreprises ne code pas « incubateur » : son code NAF le plus
   fréquent pour ces structures est 70.22Z (conseil de gestion), qui couvre
   aussi tous les cabinets de conseil du pays. Le nom est donc le signal — et
   il est fiable ici, parce que ces structures se nomment explicitement.
   ------------------------------------------------------------------------ */
const MOTIFS_ECOSYSTEME = [
  [/\bincubateur\b/, "incubateur", "incubateur"],
  [/\bpepiniere\b/, "incubateur", "pépinière d'entreprises"],
  [/\baccelerateur\b/, "incubateur", "accélérateur"],
  [/\bcoworking\b|\bespace de travail partage\b/, "coworking", "espace de coworking"],
  [/\bfrench tech\b/, "reseau_entrepreneurial", "réseau French Tech"],
  [/\bstart ?up\b/, "reseau_entrepreneurial", "structure liée aux startups"],
  [/\bruche\b|\bhub\b|\bfablab\b|\bfab lab\b/, "coworking", "tiers-lieu"],
  [/\bbge\b|\binitiative\b|\breseau entreprendre\b|\badie\b/, "reseau_entrepreneurial",
   "réseau d'accompagnement à la création d'entreprise"],
  [/\bcci\b|\bchambre de commerce\b|\bchambre des metiers\b/, "reseau_entrepreneurial",
   "chambre consulaire"],
];

export function typeEcosysteme(nom) {
  const n = normaliserTexte(nom);
  for (const [motif, type, quoi] of MOTIFS_ECOSYSTEME) {
    if (motif.test(n)) return { type, quoi };
  }
  return null;
}

/* ---------------------------------------------------------------------------
   2. LA RAISON — observée ou supposée, mais jamais muette

   `evenements` est le nombre de rendez-vous publics observés dans les données
   d'Autour pour cette structure. Zéro veut dire « on n'a rien vu », pas
   « elle n'en organise pas ».
   ------------------------------------------------------------------------ */
export function raisonPourAutour(type, quoi, faits = {}) {
  const aVenir = Number(faits.evenements_a_venir || 0);
  const total = Number(faits.evenements_total || 0);

  if (aVenir > 0) {
    return {
      raison: `Observé : ${quoi} qui programme ${aVenir} rendez-vous publics à venir. `
            + `Ces rendez-vous sont eux-mêmes du contenu pour Autour, et la structure a donc un intérêt direct à y être visible.`,
      verifiee: true,
    };
  }
  if (total > 0) {
    return {
      raison: `Observé : ${quoi} dont ${total} événements passés figurent dans les agendas que lit Autour. `
            + `Le lien existe, mais rien n'est annoncé pour la suite.`,
      verifiee: true,
    };
  }
  if (type === "incubateur" || type === "coworking" || type === "reseau_entrepreneurial") {
    return {
      raison: `Hypothèse non vérifiée : ${quoi}. Cette structure ne produit pas le contenu qu'Autour montre — `
            + `elle réunit des porteurs de projets locaux et organise des rencontres. Le lien possible est la `
            + `DIFFUSION auprès de gens qui s'intéressent à ce qui se passe autour d'eux, pas l'apport d'événements. `
            + `Aucune activité publique n'a été observée : à vérifier avant tout contact.`,
      verifiee: false,
    };
  }
  return {
    raison: `Hypothèse non vérifiée : ${quoi}. Aucun fait collecté ne relie encore cette structure à ce qu'Autour montre.`,
    verifiee: false,
  };
}

/* ---------------------------------------------------------------------------
   3. LES CANDIDATS DE L'ANNUAIRE, FILTRÉS SUR L'ÉCOSYSTÈME
   ------------------------------------------------------------------------ */
export function candidatsEcosysteme(charge, options = {}) {
  const resultats = Array.isArray(charge?.results) ? charge.results : [];
  const ville = options.ville || null;
  const sortie = [];

  for (const r of resultats) {
    if (r?.etat_administratif && r.etat_administratif !== "A") continue;
    const nom = r?.nom_complet || r?.nom_raison_sociale;
    if (!nom) continue;

    const eco = typeEcosysteme(nom);
    /* Pas un mot de l'écosystème dans le nom : on n'invente pas. Une tâche
       « incubateurs » qui rapporterait des boulangeries serait pire qu'une
       tâche vide. */
    if (!eco) continue;

    const siege = r?.siege || {};
    const commune = siege.libelle_commune || ville;
    if (!commune || !nomExploitable(nom, commune)) continue;
    const cle = cleDedup(nom, commune);
    if (!cle) continue;

    const siren = r?.siren || null;
    const naf = r?.activite_principale || null;
    const { raison } = raisonPourAutour(eco.type, eco.quoi, {});

    sortie.push({
      cle, nom: String(nom).trim(), ville: commune, pays: "FR",
      type: eco.type,
      type_pourquoi: `Le nom désigne ${eco.quoi}.`,
      raison_pertinence: raison,
      famille: "structure",
      code_insee: siege.commune || null,
      zone_id: options.zone_id || null,
      territoire_id: options.territoire_id || null,
      description: null, canal: null, coordonnees_publiques: {},
      sources: [{
        source: "recherche_entreprises", type_source: "annuaire_public",
        url: siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` : null,
        intitule: `Annuaire des entreprises — ${nom}${naf ? `, activité ${naf}` : ""}`,
        extrait: { siren, activite_principale: naf, commune, categorie_ecosysteme: eco.type,
                   date_creation: r?.date_creation || null },
      }],
      faits: { siren, activite_principale: naf, categorie_ecosysteme: eco.type,
               date_creation: r?.date_creation || null },
    });
  }
  return sortie;
}

/* ---------------------------------------------------------------------------
   4. LES STRUCTURES VUES PAR OSM — avec leur canal, quand il est tagué

   `FAMILLES_OSM` associe un tag OSM à un type Autour et à la phrase qui
   l'explique. Une entité dont le tag n'est pas dans cette table n'entre pas :
   on ne range pas une station-service parmi les lieux culturels parce qu'elle
   a un nom.
   ------------------------------------------------------------------------ */
const FAMILLES_OSM = {
  arts_centre:       ["lieu_culturel", "centre artistique (tag OpenStreetMap amenity=arts_centre)"],
  theatre:           ["lieu_culturel", "théâtre (tag OpenStreetMap amenity=theatre)"],
  cinema:            ["lieu_culturel", "cinéma (tag OpenStreetMap amenity=cinema)"],
  library:           ["lieu_culturel", "bibliothèque (tag OpenStreetMap amenity=library)"],
  community_centre:  ["communaute_locale", "centre communautaire (tag OpenStreetMap amenity=community_centre)"],
  social_facility:   ["acteur_jeunesse", "équipement social (tag OpenStreetMap amenity=social_facility)"],
  museum:            ["lieu_culturel", "musée (tag OpenStreetMap tourism=museum)"],
  coworking_space:   ["coworking", "espace de coworking (tag OpenStreetMap amenity=coworking_space)"],
  events_venue:      ["lieu_de_sortie", "salle d'événements (tag OpenStreetMap amenity=events_venue)"],
  nightclub:         ["lieu_de_sortie", "salle de nuit (tag OpenStreetMap amenity=nightclub)"],
  university:        ["etablissement_etudiant", "université (tag OpenStreetMap amenity=university)"],
  college:           ["etablissement_etudiant", "établissement d'enseignement (tag OpenStreetMap amenity=college)"],
};

export function candidatsDepuisOsmStructures(charge, options = {}) {
  const elements = Array.isArray(charge?.elements) ? charge.elements : [];
  const ville = options.ville;
  const pays = options.pays || "FR";
  const parCle = new Map();

  for (const e of elements) {
    const t = e?.tags || {};
    const nom = String(t.name || "").trim();
    if (!nom || !ville || !nomExploitable(nom, ville)) continue;

    const tag = t.amenity || t.tourism || (t.office === "coworking" ? "coworking_space" : null);
    const famille = FAMILLES_OSM[tag];
    if (!famille) continue;
    const [type, quoi] = famille;

    const cle = cleDedup(nom, ville);
    if (!cle || parCle.has(cle)) continue;

    const url = e.type && e.id ? `https://www.openstreetmap.org/${e.type}/${e.id}` : null;
    const site = t.website || t["contact:website"] || null;
    const courriel = t.email || t["contact:email"] || null;
    const courrielRetenu = courriel && adresseInstitutionnelle(courriel) ? String(courriel).toLowerCase() : null;

    const coordonnees = {};
    if (site) coordonnees.site = { valeur: site, vu_sur: url };
    if (courrielRetenu) coordonnees.email = { valeur: courrielRetenu, vu_sur: url };

    const { raison } = raisonPourAutour(type, quoi, {});

    parCle.set(cle, {
      cle, nom, ville, pays,
      type, type_pourquoi: `Type déduit du ${quoi}.`,
      raison_pertinence: raison,
      famille: "structure",
      code_insee: null, zone_id: null,
      territoire_id: options.territoire_id || null,
      description: null,
      /* Le canal vient de la même réponse : c'est l'avantage d'OSM sur les
         deux sources françaises, qui donnent la structure sans la porte. */
      canal: courrielRetenu ? "email_public" : (site ? "site_officiel" : null),
      coordonnees_publiques: coordonnees,
      sources: [{
        source: "osm_overpass", type_source: "donnee_ouverte", url,
        intitule: `OpenStreetMap — ${nom}, ${quoi}`,
        extrait: { tag, operateur: t.operator || null, site: site || null },
      }],
      faits: { tag_osm: tag, site_officiel: site || null, email_public: courrielRetenu },
    });
  }
  return [...parCle.values()];
}

/* LA REQUÊTE OVERPASS SE FAIT AUTOUR D'UN POINT, PAS AUTOUR D'UN NOM.

   La première version cherchait `area["name"="Tourcoing"]["boundary"=
   "administrative"]`. Elle a rendu ZÉRO entité en exécution — et c'était
   prévisible : Autour interroge Overpass depuis des années et ne procède
   jamais ainsi. `autour/api/lieux.js` utilise `around:<rayon>,<lat>,<lng>`,
   qui ne dépend ni d'une base d'aires, ni d'une orthographe, ni d'un niveau
   administratif qui change d'un pays à l'autre — ce qui compte double quand
   la tâche suivante s'appelle « international ».

   Bornée par construction : un rayon plafonné, une liste de tags fermée, une
   sortie plafonnée. Elle ne peut pas devenir un balayage ouvert par accident. */
export function requeteOverpassAutour(lat, lng, rayonKm = 10, plafond = 200) {
  /* `Number(null)` vaut ZÉRO, et zéro est fini. Un territoire sans coordonnées
     aurait donc produit une requête parfaitement valide autour du point
     (0, 0) — au large du golfe de Guinée — et rendu « données insuffisantes »
     pour une raison entièrement fausse. Trouvé par le test, pas en production. */
  if (lat == null || lng == null || lat === "" || lng === "") {
    throw new Error("coordonnées manquantes pour la requête Overpass");
  }
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    throw new Error("coordonnées manquantes pour la requête Overpass");
  }
  const rayon = Math.round(Math.min(Math.max(Number(rayonKm) || 10, 1), 25) * 1000);
  const autour = `around:${rayon},${la.toFixed(5)},${ln.toFixed(5)}`;
  return `[out:json][timeout:25];`
    + `(nwr(${autour})["amenity"~"^(arts_centre|theatre|cinema|library|community_centre|social_facility|coworking_space|events_venue|nightclub|university|college)$"]["name"];`
    + `nwr(${autour})["tourism"="museum"]["name"];`
    + `nwr(${autour})["office"="coworking"]["name"];);`
    + `out center ${Math.min(plafond, 400)};`;
}
