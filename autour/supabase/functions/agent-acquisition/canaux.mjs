/* ---------------------------------------------------------------------------
   Trouver la porte

   CE QUE LA PREMIÈRE MISSION A MESURÉ

   358 opportunités, 249 qualifiées, et 247 d'entre elles sans aucun moyen de
   contact. Ce n'était pas une fatalité : c'était une étape qui n'existait pas.
   Personne n'était allé CHERCHER le canal — les deux sources du balayage n'en
   publient simplement aucun. `places.official_url` est nul sur la quasi-
   totalité de l'inventaire MEL, et l'annuaire des entreprises ne donne ni
   e-mail, ni site, ni téléphone.

   DEUX SOURCES QUI, ELLES, EN PUBLIENT

   1. L'ANNUAIRE DU SERVICE PUBLIC (api-lannuaire.service-public.fr). C'est
      l'annuaire officiel des administrations et équipements publics : mairies,
      médiathèques, musées municipaux, centres sociaux. Il publie l'adresse
      e-mail de contact, le site officiel et le formulaire — parce qu'ils sont
      faits pour être utilisés. Or l'essentiel des opportunités MEL sont
      exactement cela : des équipements publics.

   2. OPENSTREETMAP. Les tags `website`, `contact:website`, `contact:email` et
      `phone` sont posés par des contributeurs sur les lieux eux-mêmes, sous
      licence ODbL. C'est la seule source qui marche AUSSI hors de France —
      d'où son rôle central dans l'expérimentation internationale.

   UNE REQUÊTE PAR COMMUNE, PAS PAR OPPORTUNITÉ

   Chercher le canal de deux cents structures une par une ferait deux cents
   requêtes sortantes. On interroge donc la commune UNE fois, on construit un
   index nom → coordonnées, et on rapproche en mémoire. Deux appels réseau pour
   deux cents opportunités.

   « CHERCHÉ, RIEN TROUVÉ » N'EST PAS « PAS ENCORE CHERCHÉ »

   La différence est ce qui empêche de recommencer indéfiniment. Une recherche
   infructueuse écrit une ligne `non_trouve`, et l'opportunité porte
   `canal_cherche_le`. Sans ça, chaque exécution repartirait sur les mêmes 247.

   ON NE COLLECTE PAS DE DONNÉES PERSONNELLES. Une adresse de contact
   institutionnelle publiée par une structure pour être utilisée entre ici ;
   une adresse qui ressemble à celle d'une personne (prénom.nom@) est écartée,
   même si elle est visible.
--------------------------------------------------------------------------- */

import { normaliserTexte, nomNormalise } from "./normalisation.mjs";

/* Une adresse nominative n'est pas une adresse de contact, même publiée.
   `prenom.nom@`, `p.nom@` : on n'en veut pas. `contact@`, `info@`,
   `mediatheque@` : ce sont des boîtes de fonction, faites pour recevoir. */
const BOITES_DE_FONCTION = /^(contact|info|infos|accueil|secretariat|secretariat-general|direction|mairie|bonjour|hello|billetterie|reservation|reservations|public|mediation|communication|partenariats|presse|culture|service|services|administration|bureau|association|asso)([._-]|$)/i;

export function adresseInstitutionnelle(courriel) {
  const v = String(courriel || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)) return false;
  const local = v.split("@")[0];
  if (BOITES_DE_FONCTION.test(local)) return true;
  /* Le nom de l'équipement dans la partie locale (« mediatheque-malraux@ »)
     est institutionnel aussi. Ce qui reste — « jean.dupont@ » — ne l'est pas. */
  if (/^[a-z]+\.[a-z]+$/.test(local)) return false;
  if (/^[a-z]\.[a-z]+$/.test(local)) return false;
  return local.length > 3;
}

function urlPropre(valeur) {
  const v = String(valeur || "").trim();
  if (!v) return null;
  const avec = /^https?:\/\//i.test(v) ? v : "https://" + v;
  try { return new URL(avec).toString(); } catch (e) { return null; }
}

/* ---------------------------------------------------------------------------
   1. L'ANNUAIRE DU SERVICE PUBLIC

   Opendatasoft rend plusieurs champs sous forme de CHAÎNES contenant du JSON
   (`site_internet`, `telephone`, `adresse`). Les lire naïvement donne une
   chaîne qui commence par `[{` et qu'on écrirait telle quelle dans la base.
   D'où `lireJsonEventuel`, et pas un `JSON.parse` direct qui lèverait sur les
   champs qui sont, eux, de vraies chaînes.
   ------------------------------------------------------------------------ */
function lireJsonEventuel(valeur) {
  if (valeur == null) return null;
  if (typeof valeur === "object") return valeur;
  const v = String(valeur).trim();
  if (!v.startsWith("[") && !v.startsWith("{")) return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}

function premiereValeur(champ) {
  const lu = lireJsonEventuel(champ);
  if (!lu) return null;
  if (typeof lu === "string") return lu;
  if (Array.isArray(lu)) {
    for (const e of lu) {
      if (typeof e === "string" && e.trim()) return e.trim();
      if (e && typeof e === "object" && e.valeur) return String(e.valeur).trim();
    }
    return null;
  }
  if (typeof lu === "object" && lu.valeur) return String(lu.valeur).trim();
  return null;
}

export function canauxDepuisAnnuaireServicePublic(charge) {
  const resultats = Array.isArray(charge?.results) ? charge.results : [];
  const index = new Map();

  for (const r of resultats) {
    const nom = String(r?.nom || "").trim();
    if (!nom) continue;
    const canaux = [];

    const site = urlPropre(premiereValeur(r.site_internet));
    if (site) {
      canaux.push({ type: "site_officiel", valeur: site, confiance: "eleve" });
    }

    const courriel = premiereValeur(r.adresse_courriel);
    if (courriel && adresseInstitutionnelle(courriel)) {
      canaux.push({ type: "email_public", valeur: courriel.toLowerCase(), confiance: "eleve" });
    }

    const formulaire = urlPropre(premiereValeur(r.formulaire_contact));
    if (formulaire) {
      canaux.push({ type: "formulaire", valeur: formulaire, confiance: "eleve" });
    }

    if (!canaux.length) continue;
    index.set(nomNormalise(nom), {
      nom,
      canaux: canaux.map((c) => ({
        ...c,
        source: "annuaire_service_public",
        type_source: "annuaire_public",
        url_source: "https://api-lannuaire.service-public.fr/",
        statut: "trouve",
      })),
    });
  }
  return index;
}

/* ---------------------------------------------------------------------------
   2. OPENSTREETMAP

   `contact:website` et `website` disent la même chose ; les deux existent et
   coexistent sur la même entité. On prend le premier qui répond, et on ne
   garde qu'UN canal par type — deux sites officiels pour une médiathèque, ce
   sont deux contributeurs qui ne se sont pas parlé, pas deux portes.
   ------------------------------------------------------------------------ */
export function canauxDepuisOsm(charge) {
  const elements = Array.isArray(charge?.elements) ? charge.elements : [];
  const index = new Map();

  for (const e of elements) {
    const t = e?.tags || {};
    const nom = String(t.name || "").trim();
    if (!nom) continue;
    const canaux = [];

    const site = urlPropre(t.website || t["contact:website"] || t.url);
    if (site) canaux.push({ type: "site_officiel", valeur: site, confiance: "moyen" });

    const courriel = t.email || t["contact:email"];
    if (courriel && adresseInstitutionnelle(courriel)) {
      canaux.push({ type: "email_public", valeur: String(courriel).trim().toLowerCase(), confiance: "moyen" });
    }

    const tel = t.phone || t["contact:phone"];
    if (tel) canaux.push({ type: "telephone_public", valeur: String(tel).trim(), confiance: "moyen" });

    if (!canaux.length) continue;
    const cle = nomNormalise(nom);
    /* Une entité OSM peut apparaître deux fois (un nœud et son bâtiment). On
       garde la plus riche plutôt que la dernière vue. */
    const deja = index.get(cle);
    if (deja && deja.canaux.length >= canaux.length) continue;
    index.set(cle, {
      nom,
      canaux: canaux.map((c) => ({
        ...c,
        source: "osm_overpass",
        type_source: "donnee_ouverte",
        url_source: e.type && e.id ? `https://www.openstreetmap.org/${e.type}/${e.id}` : null,
        statut: "trouve",
      })),
    });
  }
  return index;
}

/* ---------------------------------------------------------------------------
   3. RAPPROCHER — et dire franchement quand on n'a rien

   Le rapprochement est le même que partout ailleurs dans cet agent : le nom
   normalisé. Pas de ressemblance floue : deux structures différentes qui
   reçoivent le courrier l'une de l'autre est un défaut bien pire qu'un canal
   manquant.
   ------------------------------------------------------------------------ */
/* RAPPROCHER PAR INCLUSION, MAIS PAS À N'IMPORTE QUEL PRIX.

   L'égalité stricte du nom normalisé ne rapproche presque rien : l'annuaire du
   service public écrit « Médiathèque André Malraux - Tourcoing », Autour a
   « Médiathèque André Malraux ». Mesuré sur Tourcoing : 33 contacts publics
   disponibles, ZÉRO rapproché.

   On accepte donc qu'un nom soit CONTENU dans l'autre — mais sous deux
   conditions qui empêchent l'à-peu-près :

   1. Le nom le plus court doit porter AU MOINS DEUX mots significatifs. Sans
      cette règle, « Mairie » rapprocherait « Mairie de Tourcoing » de
      n'importe quelle association dont le nom contient « mairie ».
   2. Tous ses mots doivent figurer dans l'autre, dans l'ordre. « médiathèque
      municipale » ne se rapproche donc pas de « médiathèque André Malraux ».

   Un rapprochement par inclusion descend d'un cran en confiance, et le dit :
   c'est une correspondance probable, pas une identité prouvée. */
function motsSignificatifs(nom) {
  return nomNormalise(nom).split(" ").filter(Boolean);
}

function inclusOrdonne(courts, longs) {
  let i = 0;
  for (const mot of longs) {
    if (mot === courts[i]) i += 1;
    if (i === courts.length) return true;
  }
  return false;
}

const MOINS_SUR = { eleve: "moyen", moyen: "faible", faible: "faible" };

export function rapprocherCanaux(opportunites, index) {
  const trouves = [];
  const manquants = [];
  const entrees = [...index.entries()].map(([cle, v]) => ({ cle, mots: cle.split(" ").filter(Boolean), v }));

  for (const o of opportunites || []) {
    const cle = nomNormalise(o.nom);
    const exact = index.get(cle);
    if (exact) {
      trouves.push({ opportunite: o, correspondance: exact.nom, exact: true, canaux: exact.canaux });
      continue;
    }

    const mots = motsSignificatifs(o.nom);
    let candidat = null;
    if (mots.length >= 2) {
      for (const e of entrees) {
        if (e.mots.length < 2) continue;
        const [courts, longs] = mots.length <= e.mots.length ? [mots, e.mots] : [e.mots, mots];
        if (courts.length < 2) continue;
        if (!inclusOrdonne(courts, longs)) continue;
        /* À égalité, on garde la correspondance la plus proche en longueur :
           elle est la moins susceptible d'être un homonyme englobant. */
        const ecart = Math.abs(e.mots.length - mots.length);
        if (!candidat || ecart < candidat.ecart) candidat = { e, ecart };
      }
    }

    if (candidat) {
      trouves.push({
        opportunite: o, correspondance: candidat.e.v.nom, exact: false,
        canaux: candidat.e.v.canaux.map((c) => ({
          ...c,
          confiance: MOINS_SUR[c.confiance] || "faible",
          notes: `Rapproché par inclusion de nom : « ${candidat.e.v.nom} ». Correspondance probable, à vérifier.`,
        })),
      });
      continue;
    }
    manquants.push(o);
  }
  return { trouves, manquants };
}

/* Le canal le plus direct d'abord : c'est celui que l'humain utilisera. */
const ORDRE = ["email_public", "formulaire", "page_contact", "page_partenaire", "site_officiel", "telephone_public"];

export function canalPrincipal(canaux) {
  const utiles = (canaux || []).filter((c) => c.statut === "trouve");
  utiles.sort((a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type));
  return utiles[0] || null;
}

/* Le canal que l'opportunité portera, dans le vocabulaire de sa colonne. */
export function canalOpportunite(canaux) {
  const principal = canalPrincipal(canaux);
  if (!principal) return null;
  if (principal.type === "email_public") return "email_public";
  if (principal.type === "formulaire") return "formulaire_site";
  if (principal.type === "telephone_public") return "telephone_public";
  return "site_officiel";
}

/* ---------------------------------------------------------------------------
   4. L'ANNUAIRE N'EST PAS SEULEMENT UNE SOURCE DE CANAUX : C'EST UNE SOURCE
      D'OPPORTUNITÉS

   MESURÉ LE 19/09, ET C'EST LE FAIT QUI COMMANDE CE CODE.

   À Villeneuve-d'Ascq, l'annuaire du service public publie 27 fiches, dont 25
   portent un contact exploitable. Sur les 58 opportunités qu'Autour connaît
   dans la même commune, le rapprochement par nom en a rapproché ZÉRO — et ce
   n'était pas un défaut de rapprochement. Les deux listes décrivent des
   structures DIFFÉRENTES :

     annuaire  : Mission locale, CCAS, CIO, Point-justice, Centre information
                 jeunesse, Point d'information pour les personnes âgées, Maison
                 de l'emploi, Mairie, PMI…
     Autour    : Château de Flers, Musée du Terroir, Cinéma Le Méliès, églises,
                 maisons de quartier, fermes pédagogiques…

   Aucun algorithme de rapprochement ne peut faire se rencontrer deux
   populations disjointes. Améliorer encore la comparaison de noms aurait été
   du travail dépensé contre un mur.

   Mais ces fiches-là ne sont pas des déchets : ce sont des structures dont le
   métier est littéralement d'orienter des gens vers ce qui existe autour
   d'eux. C'est le sujet d'Autour, mot pour mot. Et elles arrivent AVEC leur
   porte déjà ouverte — l'annuaire publie le contact.

   D'où ce lecteur : les fiches que le rapprochement n'a pas consommées
   deviennent des opportunités à part entière, canal compris. Le « 247 sans
   canal » ne se résout pas seulement en cherchant des portes pour les
   structures connues ; il se résout aussi en allant chercher les structures
   qui en ont une.

   CE LECTEUR NE DÉCIDE PAS DE LA PERTINENCE. Il pose un type et un fait
   observé ; c'est la qualification qui tranche, et elle doit pouvoir écrire
   pourquoi. Une gendarmerie départementale entrera donc, et sera écartée là où
   le refus peut s'expliquer.
   ------------------------------------------------------------------------ */

/* `pivot` est le champ par lequel l'annuaire dit lui-même ce qu'est la fiche.
   C'est une donnée de la source, pas une devinette sur le nom : on s'en sert
   en premier, et le fait observé cite le pivot. */
const PIVOTS = {
  mairie: ["collectivite", "l'annuaire classe la fiche comme mairie"],
  ccas: ["structure", "l'annuaire classe la fiche comme centre communal d'action sociale"],
  mission_locale: ["acteur_jeunesse", "l'annuaire classe la fiche comme mission locale (16-25 ans)"],
  cij: ["acteur_jeunesse", "l'annuaire classe la fiche comme centre d'information jeunesse"],
  information_jeunesse: ["acteur_jeunesse", "l'annuaire classe la fiche comme structure information jeunesse"],
  cio: ["etablissement_etudiant", "l'annuaire classe la fiche comme centre d'information et d'orientation"],
  crous: ["etablissement_etudiant", "l'annuaire classe la fiche comme service du Crous"],
  maison_emploi: ["structure", "l'annuaire classe la fiche comme maison de l'emploi"],
  pole_emploi: ["structure", "l'annuaire classe la fiche comme agence France Travail"],
  cdad: ["structure", "l'annuaire classe la fiche comme point d'accès au droit"],
  clic: ["structure", "l'annuaire classe la fiche comme point d'information pour les personnes âgées"],
  pmi: ["structure", "l'annuaire classe la fiche comme centre de protection maternelle et infantile"],
  bibliotheque: ["lieu_culturel", "l'annuaire classe la fiche comme bibliothèque"],
  musee: ["lieu_culturel", "l'annuaire classe la fiche comme musée"],
};

/* La forme réelle, relevée sur l'API le 19/09 :
     pivot = "[{\"type_service_local\": \"mission_locale\",
                \"code_insee_commune\": [\"59009\"]}]"
   — une CHAÎNE qui contient du JSON. On ne lit que `type_service_local` et
   `type_service` : balayer toutes les valeurs ramasserait aussi les codes
   INSEE, qui ne sont pas des types. */
function pivotsDeLaFiche(fiche) {
  const lu = lireJsonEventuel(fiche?.pivot);
  const sortie = [];
  for (const e of Array.isArray(lu) ? lu : (lu ? [lu] : [])) {
    if (typeof e === "string") { sortie.push(e); continue; }
    if (!e || typeof e !== "object") continue;
    for (const champ of ["type_service_local", "type_service"]) {
      const v = e[champ];
      if (typeof v === "string" && v.trim()) sortie.push(v.trim());
    }
  }
  return sortie;
}

/* Rendre des CANDIDATS au sens de `fusionner()` — même forme que les lecteurs
   de `sources.mjs`, canal compris. `deja` est l'ensemble des clés normalisées
   que le rapprochement a déjà consommées : on ne recrée pas une opportunité
   pour une structure qu'Autour connaît déjà. */
export function candidatsDepuisAnnuaireServicePublicOpportunites(charge, options = {}) {
  const resultats = Array.isArray(charge?.results) ? charge.results : [];
  const ville = String(options.ville || "").trim();
  const deja = options.deja instanceof Set ? options.deja : new Set();
  const deduire = typeof options.deduireType === "function" ? options.deduireType : null;
  const sortie = [];

  if (!ville) return sortie;

  for (const r of resultats) {
    const nom = String(r?.nom || "").trim();
    if (!nom) continue;

    const cleNom = nomNormalise(nom);
    if (!cleNom || deja.has(cleNom)) continue;

    const site = urlPropre(premiereValeur(r.site_internet));
    const courriel = premiereValeur(r.adresse_courriel);
    const formulaire = urlPropre(premiereValeur(r.formulaire_contact));
    const courrielRetenu = courriel && adresseInstitutionnelle(courriel)
      ? String(courriel).trim().toLowerCase() : null;

    /* Une fiche sans aucun canal n'apporte rien ici : la raison d'être de ce
       lecteur est justement d'amener des structures AVEC leur porte. */
    if (!site && !courrielRetenu && !formulaire) continue;

    const pivots = pivotsDeLaFiche(r);
    let type = null, pourquoi = null;
    for (const p of pivots) {
      const connu = PIVOTS[p];
      if (connu) { [type, pourquoi] = [connu[0], `Type posé par la source : ${connu[1]}.`]; break; }
    }
    if (!type && deduire) {
      const d = deduire(nom, null);
      type = d.type; pourquoi = d.pourquoi;
    }
    if (!type) { type = "structure"; pourquoi = "L'annuaire ne pose aucun pivot connu et le nom ne dit rien : type indéterminé."; }

    /* `acquisition_opportunites.canal` PORTE LE TYPE, PAS LA VALEUR.
       Un CHECK en base n'accepte que « email_public », « formulaire_site »,
       « site_officiel », « telephone_public », « sur_place », « reseau_public ».
       Y écrire une adresse e-mail aurait fait tomber chaque insertion. La
       valeur, elle, vit dans `acquisition_canaux` — un type ici, une valeur
       là-bas, et jamais l'inverse. */
    const canal = courrielRetenu
      ? { type: "email_public", canal: "email_public", valeur: courrielRetenu }
      : site ? { type: "site_officiel", canal: "site_officiel", valeur: site }
      : { type: "formulaire", canal: "formulaire_site", valeur: formulaire };

    sortie.push({
      cle: `${cleNom}@${normaliserTexte(ville)}`,
      nom, ville, type, type_pourquoi: pourquoi,
      famille: "structure",
      code_insee: r?.code_insee_commune || null,
      zone_id: options.zone_id || null,
      description: premiereValeur(r.mission) || null,
      canal: canal.canal,
      canal_type: canal.type,
      canal_valeur: canal.valeur,
      coordonnees_publiques: {
        site_officiel: site || null,
        email_public: courrielRetenu || null,
        formulaire: formulaire || null,
      },
      sources: [{
        source: "annuaire_service_public",
        type_source: "annuaire_public",
        url: urlPropre(premiereValeur(r.url_service_public)) || "https://lannuaire.service-public.fr/",
        intitule: `Annuaire du service public — ${nom}`,
        extrait: {
          pivot: pivots.length ? pivots : null,
          code_insee_commune: r?.code_insee_commune || null,
          date_modification: r?.date_modification || null,
        },
      }],
      faits: {
        pivot: pivots.length ? pivots : null,
        canal_publie_par_la_source: canal.type,
        canal_valeur: canal.valeur,
        date_modification: r?.date_modification || null,
      },
    });
  }
  return sortie;
}
