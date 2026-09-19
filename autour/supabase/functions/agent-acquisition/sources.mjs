/* ---------------------------------------------------------------------------
   D'où viennent les opportunités — et pourquoi dans cet ordre

   LES DONNÉES D'AUTOUR PASSENT AVANT TOUT LE RESTE.

   Autour a déjà collecté 1 800 événements sur la MEL. Chacun porte le nom du
   lieu qui l'accueille, sa commune, et l'adresse de la page qui l'annonce. Une
   médiathèque qui a trente rendez-vous à venir n'est pas une piste à vérifier :
   c'est une structure locale, active, dont on connaît déjà la programmation et
   la source. Aucune requête sortante, aucun coût, aucune condition
   d'utilisation tierce à respecter.

   L'annuaire des entreprises vient APRÈS, et pour ce que le premier ne sait
   pas : les structures qui n'organisent rien de public — un club, une amicale,
   une association étudiante. Il est ouvert, sans clé, publié par la DINUM pour
   être appelé par des programmes.

   CE QUI N'EST PAS ICI N'EST PAS LU. Pas de réseau social, pas de plateforme
   dont les conditions interdisent l'extraction, pas d'annuaire de contacts
   personnels. La liste blanche vit dans `task_permissions.sources_autorisees`,
   et ce fichier ne sait lire que ce qu'elle nomme.

   TOUTES LES FONCTIONS D'ICI SONT PURES. Elles reçoivent des lignes déjà lues
   et rendent des candidats. Rien n'appelle le réseau ni la base : c'est ce qui
   les rend testables sans accès sortant, et c'est ce qui permet de vérifier ce
   qu'elles refusent aussi bien que ce qu'elles retiennent.
--------------------------------------------------------------------------- */

import { cleDedup, deduireType, nomAffiche, normaliserTexte } from "./normalisation.mjs";

/* Un nom trop court ou générique ne désigne personne. « Bibliothèque » tout
   court, dans `events`, revient sur quatre communes différentes : en faire une
   opportunité produirait une structure imaginaire, à qui on écrirait où ? */
const NOMS_TROP_VAGUES = new Set([
  "bibliotheque", "mediatheque", "salle des fetes", "salle polyvalente",
  "mairie", "eglise", "parc", "centre ville", "place", "en ligne", "divers",
  "lieu a definir", "a preciser",
]);

export function nomExploitable(nom, ville) {
  const n = normaliserTexte(nomAffiche(nom));
  if (n.length < 4) return false;
  if (NOMS_TROP_VAGUES.has(n)) return false;
  /* UN LIEU QUI PORTE LE NOM DE SA COMMUNE N'EST PAS UN LIEU — trouvé en
     relisant les opportunités : `events` contient six événements dont le lieu
     d'accueil est « Lille », à Lille. Ce n'est pas une salle, c'est une saisie
     paresseuse dans l'agenda source. La structure « Lille », à Lille, s'est
     retrouvée qualifiée et un brouillon lui a été préparé. */
  if (ville && n === normaliserTexte(ville)) return false;
  return true;
}

/* ---------------------------------------------------------------------------
   1. LES LIEUX QUI ACCUEILLENT LES ÉVÉNEMENTS D'AUTOUR
   ------------------------------------------------------------------------ */
export function candidatsDepuisEvenements(lignes, maintenant = new Date()) {
  const parCle = new Map();

  for (const e of lignes || []) {
    const nomBrut = e.venue_name || e.place_name;
    const ville = e.commune || e.city;
    if (!nomBrut || !ville || !nomExploitable(nomBrut, ville)) continue;
    const cle = cleDedup(nomBrut, ville);
    if (!cle) continue;

    let c = parCle.get(cle);
    if (!c) {
      const t = deduireType(nomBrut, null);
      c = {
        cle, nom: nomAffiche(nomBrut), ville, type: t.type, type_pourquoi: t.pourquoi,
        famille: "structure",
        code_insee: e.insee_code || null, zone_id: e.zone_id || null,
        description: null, canal: null, coordonnees_publiques: {},
        sources: [], faits: { evenements_total: 0, evenements_a_venir: 0, dernier_evenement: null, organisateurs: [] },
      };
      parCle.set(cle, c);
    }

    c.faits.evenements_total += 1;
    const debut = e.start_at ? new Date(e.start_at) : null;
    if (debut && debut > maintenant) c.faits.evenements_a_venir += 1;
    if (debut && (!c.faits.dernier_evenement || debut > new Date(c.faits.dernier_evenement))) {
      c.faits.dernier_evenement = debut.toISOString();
    }
    const orga = e.organizer_name || e.organizer;
    if (orga && !c.faits.organisateurs.includes(orga)) c.faits.organisateurs.push(orga);

    /* UNE SOURCE PAR ÉVÉNEMENT SERAIT UN JOURNAL, PAS UNE PROVENANCE. On garde
       la page du dernier événement vu : c'est elle qu'on rouvrira pour
       vérifier, et elle suffit à prouver que la structure existe et programme. */
    const url = e.source_url || e.event_source_url || null;
    if (url && c.sources.length === 0) {
      c.sources.push({
        source: "autour_events", type_source: "donnee_autour", url,
        intitule: `Événement programmé à « ${c.nom} », vu par Autour via ${e.primary_source || "une source enregistrée"}`,
        extrait: { titre: e.title || null, debut: e.start_at || null, source_amont: e.primary_source || null },
      });
    }
  }

  /* Un lieu vu une seule fois peut être une salle louée pour une occasion.
     Deux fois, c'est une programmation. Le seuil est bas exprès : il écarte
     l'accident, pas la petite structure. */
  /* AUCUN CANAL DE CONTACT N'EST DÉDUIT ICI. La page d'un événement prouve que
     la structure programme ; elle ne dit pas par où lui écrire, et l'adresse
     d'un agenda tiers n'est pas la sienne. `canal` reste nul, et la
     qualification écrira « accessibilité : faible — aucune coordonnée publique
     observée » plutôt que de laisser croire qu'un chemin existe. */
  return [...parCle.values()]
    .filter((c) => c.faits.evenements_total >= 2 && c.sources.length > 0);
}

/* ---------------------------------------------------------------------------
   2. L'INVENTAIRE DES LIEUX
   ------------------------------------------------------------------------ */
const FAMILLES_UTILES = new Set(["culture", "bibliotheque", "cinema", "musique", "sport", "association", "patrimoine"]);

export function candidatsDepuisLieux(lignes) {
  const sortie = [];
  for (const p of lignes || []) {
    if (!FAMILLES_UTILES.has(p.family)) continue;
    const ville = p.commune || p.city;
    if (!p.name || !ville || !nomExploitable(p.name, ville)) continue;
    const cle = cleDedup(p.name, ville);
    if (!cle) continue;

    const t = deduireType(p.name, p.family);
    /* L'URL de la source est celle du site officiel quand on l'a. Sinon on
       n'en invente pas : la fiche de l'inventaire n'est pas une page publique
       et ne peut pas servir de preuve à qui relit. */
    const url = p.official_url || null;
    sortie.push({
      cle, nom: p.name.trim(), ville, type: t.type, type_pourquoi: t.pourquoi,
      famille: "structure",
      code_insee: p.insee_code || null, zone_id: p.zone_id || null,
      place_id: p.id || null,
      description: p.description || null,
      canal: url ? "site_officiel" : null,
      coordonnees_publiques: url ? { site: { valeur: url, vu_sur: url } } : {},
      sources: [{
        source: "autour_places", type_source: "donnee_autour", url,
        intitule: `Lieu de l'inventaire d'Autour, famille « ${p.family } »`,
        extrait: { adresse: p.address || null, famille: p.family, categorie: p.category || null },
      }],
      faits: { famille: p.family, adresse: p.address || null, site_officiel: url },
    });
  }
  return sortie;
}

/* ---------------------------------------------------------------------------
   3. LES AGENDAS PUBLICS DES COMMUNES — un gisement, pas une structure

   Une commune qui tient un agenda OpenAgenda vivant publie déjà ce qu'Autour
   cherche à montrer, et son public est exactement celui d'Autour. Ce n'est pas
   quelqu'un à qui l'on écrit : c'est un endroit où aller. D'où
   `famille = 'opportunite_utilisateurs'` (§3).

   `agenda_uid` non nul est le seul critère retenu : il veut dire que la page
   publique existe et porte un identifiant, donc que l'agenda est réel. Un
   `statut_http = 200` sans uid, c'est la page d'accueil d'OpenAgenda servie
   pour un slug qui n'existe pas — 200 ne prouve rien.
   ------------------------------------------------------------------------ */
/* LE TITRE VIENT D'UNE PAGE HTML, ET ÇA SE VOYAIT.

   Deux défauts trouvés en relisant les premiers brouillons préparés :

   · « VILLENEUVE D&#x27;ASCQ » — l'apostrophe typographique de la page est
     restée sous forme d'entité HTML jusque dans un message destiné à être
     envoyé à quelqu'un ;
   · « Lille » — le titre de l'agenda municipal est le nom de la commune, si
     bien que l'opportunité s'appelait « Lille », à Lille. Un opérateur qui
     relit ne sait pas de quoi on lui parle.

   Les deux se réparent ici plutôt que dans l'écran : une donnée fausse rangée
   en base reste fausse partout où on la relit. */
const ENTITES = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&apos;": "'",
                  "&lt;": "<", "&gt;": ">", "&nbsp;": " " };

function decoderEntites(texte) {
  return String(texte ?? "").replace(/&(?:amp|quot|#x27|#39|apos|lt|gt|nbsp);/gi,
    (e) => ENTITES[e.toLowerCase()] ?? e);
}

function nomAgenda(titre, ville) {
  const brut = decoderEntites(titre || "").replace(/\s*\|\s*OpenAgenda\s*$/i, "").trim();
  /* Un titre qui ne dit que le nom de la commune ne nomme pas l'agenda : on le
     nomme nous-mêmes, explicitement, plutôt que de laisser croire que la
     structure s'appelle « Lille ». */
  if (!brut || brut.toLowerCase() === "openagenda"
      || normaliserTexte(brut) === normaliserTexte(ville)) {
    return `Agenda public de ${ville}`;
  }
  return brut;
}

export function candidatsDepuisAgendas(lignes, villeParSlug = {}) {
  const sortie = [];
  for (const a of lignes || []) {
    if (!a.agenda_uid) continue;
    const ville = a.commune || villeParSlug[a.slug] || null;
    if (!ville) continue;
    const nom = nomAgenda(a.titre, ville);
    const cle = cleDedup(nom, ville);
    if (!cle) continue;

    const url = `https://openagenda.com/${a.slug}`;
    sortie.push({
      cle, nom, ville, type: "communaute_locale",
      type_pourquoi: "Agenda public communal : un canal de diffusion local, pas un interlocuteur commercial.",
      famille: "opportunite_utilisateurs",
      code_insee: null, zone_id: null,
      description: null, canal: "site_officiel",
      coordonnees_publiques: { agenda: { valeur: url, vu_sur: url } },
      sources: [{
        source: "openagenda_candidats", type_source: "agenda_public", url,
        intitule: `Agenda public « ${a.slug} », identifiant ${a.agenda_uid} relevé sur la page publique`,
        extrait: { slug: a.slug, agenda_uid: a.agenda_uid, verifie_le: a.verifie_le || null },
      }],
      faits: { agenda_uid: a.agenda_uid, slug: a.slug },
    });
  }
  return sortie;
}

/* ---------------------------------------------------------------------------
   4. L'ANNUAIRE DES ENTREPRISES (recherche-entreprises.api.gouv.fr)

   CE QU'IL DONNE, ET CE QU'IL NE DONNE PAS. Il donne une dénomination, une
   commune, un objet social codé (NAF) et une date de création. Il ne donne NI
   adresse e-mail, NI site web, NI téléphone. `coordonnees_publiques` reste donc
   vide pour toute structure qui vient d'ici, et la qualification le dira :
   « accessibilité : faible — aucune coordonnée publique observée ». C'est une
   information utile, pas un manque à combler en devinant une adresse.

   `etat_administratif = 'A'` : une association dissoute reste dans l'annuaire.
   Lui écrire serait écrire à personne.
   ------------------------------------------------------------------------ */
const NAF_INTERESSANTS = {
  "94.99Z": { type: "association", quoi: "autres organisations fonctionnant par adhésion volontaire" },
  "93.12Z": { type: "club", quoi: "clubs de sports" },
  "93.19Z": { type: "club", quoi: "autres activités liées au sport" },
  "90.01Z": { type: "acteur_evenementiel", quoi: "arts du spectacle vivant" },
  "90.04Z": { type: "lieu_culturel", quoi: "gestion de salles de spectacles" },
  "91.01Z": { type: "lieu_culturel", quoi: "gestion des bibliothèques et des archives" },
  "91.02Z": { type: "lieu_culturel", quoi: "gestion des musées" },
  "82.30Z": { type: "acteur_evenementiel", quoi: "organisation de salons professionnels et congrès" },
  "88.99B": { type: "acteur_jeunesse", quoi: "action sociale sans hébergement" },
  "85.59A": { type: "etablissement_etudiant", quoi: "formation continue d'adultes" },
};

/* LA COMMUNE DU SIÈGE N'EST PAS LA COMMUNE CHERCHÉE — trouvé en exécution.

   Le premier balayage de Roubaix et de Tourcoing a rapporté « Croix-Rouge
   française », dont le siège est à Paris. L'annuaire répondait correctement :
   l'association A un établissement dans la commune demandée. Mais
   `siege.libelle_commune` dit où est le siège, pas où est l'antenne — et une
   opportunité rangée sous « Paris » n'a aucun sens dans une liste MEL, en plus
   de se dédupliquer contre elle-même d'une commune à l'autre.

   On lit donc `matching_etablissements`, qui porte l'établissement qui a
   répondu au filtre, et on retient sa commune. Quand aucun établissement ne
   tombe dans la commune cherchée, la ligne est écartée : une structure qu'on
   ne sait pas situer localement n'est pas une opportunité locale. */
function communeLocale(r, attendue) {
  const cible = normaliserTexte(attendue);
  if (!cible) return r?.siege?.libelle_commune || null;
  const etablissements = Array.isArray(r?.matching_etablissements) ? r.matching_etablissements : [];
  const trouve = etablissements.some((e) => normaliserTexte(e?.libelle_commune) === cible)
    || normaliserTexte(r?.siege?.libelle_commune) === cible;
  /* On rend l'ORTHOGRAPHE CHERCHÉE, pas celle de l'annuaire. L'annuaire écrit
     « LILLE » en capitales ; `events` et `places` écrivent « Lille ». Les deux
     se dédupliquent correctement (la clé normalise), mais la liste afficherait
     deux villes là où il n'y en a qu'une. */
  return trouve ? attendue : null;
}

export function candidatsDepuisAnnuaire(charge, options = {}) {
  const resultats = Array.isArray(charge?.results) ? charge.results : [];
  const famille = options.famille === "opportunite_utilisateurs" ? "opportunite_utilisateurs" : "structure";
  const sortie = [];

  for (const r of resultats) {
    if (r?.etat_administratif && r.etat_administratif !== "A") continue;
    const nom = r?.nom_complet || r?.nom_raison_sociale;
    const siege = r?.siege || {};
    const ville = communeLocale(r, options.ville);
    if (!nom || !ville || !nomExploitable(nom, ville)) continue;

    const naf = r?.activite_principale || siege.activite_principale || null;
    const connu = naf ? NAF_INTERESSANTS[naf] : null;
    /* Une ligne dont l'activité ne figure pas dans la table ci-dessus n'est pas
       rejetée : elle entre avec le type indéterminé, et la qualification s'en
       occupera. Filtrer ici sur un code NAF reviendrait à décider de la
       pertinence dans le lecteur de source, où rien ne peut l'expliquer. */
    const t = connu
      ? { type: connu.type, pourquoi: `Activité principale déclarée ${naf} : ${connu.quoi}.` }
      : deduireType(nom, null);

    const cle = cleDedup(nom, ville);
    if (!cle) continue;
    const siren = r?.siren || null;
    const url = siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` : null;

    sortie.push({
      /* `nomAffiche`, PAS `nom` BRUT. `cleDedup` retire le sigle final pour
         rapprocher, mais le nom stocké le gardait : soixante-deux lignes
         portaient « … (CRF) » dans la colonne `nom`, illisibles pour qui relit
         et impossibles à rapprocher d'une fiche d'annuaire. Les deux doivent
         venir de la même fonction. */
      cle, nom: nomAffiche(nom), ville, type: t.type, type_pourquoi: t.pourquoi,
      famille,
      code_insee: siege.commune || null, zone_id: options.zone_id || null,
      description: null,
      canal: null,                 // l'annuaire ne publie aucune coordonnée
      coordonnees_publiques: {},
      sources: [{
        source: "recherche_entreprises", type_source: "annuaire_public", url,
        intitule: `Annuaire des entreprises — ${nom}${naf ? `, activité ${naf}` : ""}`,
        extrait: {
          siren, activite_principale: naf,
          est_association: r?.complements?.est_association ?? null,
          date_creation: r?.date_creation || null,
          commune: ville,
        },
      }],
      faits: {
        siren, activite_principale: naf,
        est_association: r?.complements?.est_association ?? null,
        date_creation: r?.date_creation || null,
      },
    });
  }
  return sortie;
}
