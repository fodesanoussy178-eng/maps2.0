import assert from "node:assert/strict";
import test from "node:test";

import { cleDedup, deduireType, fusionner, nomAffiche } from "../supabase/functions/agent-acquisition/normalisation.mjs";
import {
  candidatsDepuisAgendas, candidatsDepuisAnnuaire, candidatsDepuisEvenements,
  candidatsDepuisLieux, nomExploitable,
} from "../supabase/functions/agent-acquisition/sources.mjs";
import { qualifier } from "../supabase/functions/agent-acquisition/qualification.mjs";
import { preparerContact, verifierInterdits } from "../supabase/functions/agent-acquisition/contact.mjs";

const MAINTENANT = new Date("2026-09-19T00:00:00Z");

/* Formes réellement observées en base le 19/09 : `events.venue_name` porte le
   préfixe de commune d'OpenAgenda, `places.name` ne le porte pas, et l'annuaire
   écrit tout en capitales. Les trois désignent la même médiathèque. */
const EVENEMENT = {
  title: "Atelier d'écriture", venue_name: "Tourcoing/Médiathèque André Malraux",
  commune: "Tourcoing", insee_code: "59599", zone_id: "mel",
  start_at: "2026-10-17T12:00:00Z", source_url: "https://openagenda.com/agenda-culturel-tourquennois/events/98936725",
  primary_source: "openagenda",
};

test("la clé de rapprochement réunit les trois écritures d'une même structure", () => {
  const attendue = "mediatheque andre malraux@tourcoing";
  assert.equal(cleDedup("Tourcoing/Médiathèque André Malraux", "Tourcoing"), attendue);
  assert.equal(cleDedup("Médiathèque André Malraux", "Tourcoing"), attendue);
  assert.equal(cleDedup("MEDIATHEQUE ANDRE MALRAUX", "TOURCOING"), attendue);
  assert.equal(nomAffiche("Tourcoing/Médiathèque André Malraux"), "Médiathèque André Malraux");
});

test("un nom qui ne désigne personne n'entre pas dans la base", () => {
  /* « Bibliothèque » tout court revient sur quatre communes dans `events` : en
     faire une opportunité créerait une structure imaginaire. */
  assert.equal(nomExploitable("Bibliothèque"), false);
  assert.equal(nomExploitable("Salle des fêtes"), false);
  assert.equal(nomExploitable("En ligne"), false);
  assert.equal(nomExploitable("Médiathèque André Malraux"), true);

  /* Et un lieu qui porte le nom de sa commune n'est pas un lieu : `events`
     contient six événements dont le lieu d'accueil est « Lille », à Lille.
     Sans cette règle, la structure « Lille » a été qualifiée et un brouillon
     lui a été préparé — trouvé en relisant les premiers résultats. */
  assert.equal(nomExploitable("Lille", "Lille"), false);
  assert.equal(nomExploitable("LILLE", "Lille"), false);
  assert.equal(nomExploitable("Médiathèque André Malraux", "Tourcoing"), true);
});

test("un lieu vu une seule fois n'est pas une programmation", () => {
  assert.equal(candidatsDepuisEvenements([EVENEMENT], MAINTENANT).length, 0);
  const deux = candidatsDepuisEvenements([EVENEMENT, { ...EVENEMENT, start_at: "2026-09-01T10:00:00Z" }], MAINTENANT);
  assert.equal(deux.length, 1);
  assert.equal(deux[0].faits.evenements_total, 2);
  assert.equal(deux[0].faits.evenements_a_venir, 1);
});

test("la page d'un événement ne devient jamais un canal de contact", () => {
  /* Elle prouve que la structure programme ; elle ne dit pas par où lui écrire,
     et l'adresse d'un agenda tiers n'est pas la sienne. */
  const [c] = candidatsDepuisEvenements([EVENEMENT, { ...EVENEMENT, start_at: "2026-09-01T10:00:00Z" }], MAINTENANT);
  assert.equal(c.canal, null);
  assert.deepEqual(c.coordonnees_publiques, {});
  assert.equal(c.sources[0].source, "autour_events");
  assert.equal(c.sources[0].url, EVENEMENT.source_url);
});

test("l'annuaire : la commune du siège n'est pas la commune cherchée", () => {
  /* Défaut trouvé en exécution le 19/09 : le balayage de Roubaix rapportait
     « Croix-Rouge française », siège à Paris, rangée sous la ville « PARIS ». */
  const charge = { results: [
    { siren: "775672272", nom_complet: "CROIX ROUGE FRANCAISE", etat_administratif: "A",
      activite_principale: "94.99Z", siege: { libelle_commune: "PARIS" },
      matching_etablissements: [{ libelle_commune: "ROUBAIX" }] },
    { siren: "111", nom_complet: "ASSOCIATION NATIONALE AILLEURS", etat_administratif: "A",
      siege: { libelle_commune: "PARIS" }, matching_etablissements: [{ libelle_commune: "LYON" }] },
    { siren: "222", nom_complet: "AMICALE DES BOULISTES ROUBAISIENS", etat_administratif: "A",
      activite_principale: "93.12Z", siege: { libelle_commune: "ROUBAIX" } },
  ] };
  const retenus = candidatsDepuisAnnuaire(charge, { ville: "Roubaix" });
  assert.equal(retenus.length, 2);
  /* L'orthographe rendue est CELLE CHERCHÉE : « Roubaix », pas « ROUBAIX ».
     Sinon la liste afficherait deux villes là où il n'y en a qu'une. */
  assert.ok(retenus.every((r) => r.ville === "Roubaix"));
  assert.equal(retenus.find((r) => r.nom.includes("BOULISTES")).type, "club");
});

test("une association dissoute n'est pas une opportunité", () => {
  const charge = { results: [{ siren: "333", nom_complet: "ASSOCIATION DISSOUTE DE ROUBAIX",
    etat_administratif: "C", siege: { libelle_commune: "ROUBAIX" } }] };
  assert.equal(candidatsDepuisAnnuaire(charge, { ville: "Roubaix" }).length, 0);
});

test("l'annuaire ne publie aucune coordonnée, et on n'en invente pas", () => {
  const charge = { results: [{ siren: "444", nom_complet: "COLLECTIF LOCAL", etat_administratif: "A",
    activite_principale: "94.99Z", siege: { libelle_commune: "LILLE" } }] };
  const [c] = candidatsDepuisAnnuaire(charge, { ville: "Lille" });
  assert.equal(c.canal, null);
  assert.deepEqual(c.coordonnees_publiques, {});
  assert.equal(c.sources[0].url, "https://annuaire-entreprises.data.gouv.fr/entreprise/444");
});

test("un agenda sans identifiant relevé n'est pas un agenda", () => {
  /* `statut_http = 200` sans `agenda_uid`, c'est la page d'accueil d'OpenAgenda
     servie pour un slug qui n'existe pas : 200 ne prouve rien. */
  const lignes = [
    { slug: "chereng", agenda_uid: null, titre: "OpenAgenda", commune: "Chéreng" },
    { slug: "agenda-culturel-tourquennois", agenda_uid: "32344838",
      titre: "Agenda culturel tourquennois | OpenAgenda", commune: "Tourcoing" },
  ];
  const sortie = candidatsDepuisAgendas(lignes);
  assert.equal(sortie.length, 1);
  assert.equal(sortie[0].famille, "opportunite_utilisateurs");
  assert.equal(sortie[0].nom, "Agenda culturel tourquennois");
});

test("le titre d'un agenda est nettoyé avant d'atteindre un brouillon", () => {
  /* Deux défauts trouvés en relisant les premiers brouillons préparés le 19/09 :
     une entité HTML non décodée, et un agenda municipal dont le titre est le
     seul nom de la commune. Les deux partaient dans un message à envoyer. */
  /* « VILLENEUVE D&#x27;ASCQ » décodé vaut « VILLENEUVE D'ASCQ », qui n'est que
     le nom de la commune : l'agenda est donc nommé explicitement. Les deux
     règles se croisent sur ce cas réel, et c'est bien le nom clair qui gagne. */
  const [vda] = candidatsDepuisAgendas([{ slug: "villeneuve-dascq", agenda_uid: "95450215",
    titre: "VILLENEUVE D&#x27;ASCQ | OpenAgenda", commune: "Villeneuve-d'Ascq" }]);
  assert.equal(vda.nom, "Agenda public de Villeneuve-d'Ascq");

  /* Le décodage, isolé : un titre qui dit autre chose que la commune le garde,
     apostrophe comprise. */
  const [ecole] = candidatsDepuisAgendas([{ slug: "x", agenda_uid: "2",
    titre: "Agenda de l&#x27;École du Nord | OpenAgenda", commune: "Tourcoing" }]);
  assert.equal(ecole.nom, "Agenda de l'École du Nord");

  const [lille] = candidatsDepuisAgendas([{ slug: "lille", agenda_uid: "96901237",
    titre: "Lille", commune: "Lille" }]);
  assert.equal(lille.nom, "Agenda public de Lille");

  const [sansTitre] = candidatsDepuisAgendas([{ slug: "wattrelos", agenda_uid: "1",
    titre: "OpenAgenda", commune: "Wattrelos" }]);
  assert.equal(sansTitre.nom, "Agenda public de Wattrelos");
});

test("fusionner garde les deux provenances plutôt que la dernière vue", () => {
  const depuisEvenements = candidatsDepuisEvenements(
    [EVENEMENT, { ...EVENEMENT, start_at: "2026-09-01T10:00:00Z" }], MAINTENANT);
  const depuisLieux = candidatsDepuisLieux([{
    id: "uuid-1", name: "Médiathèque André Malraux", commune: "Tourcoing",
    family: "bibliotheque", address: "26 rue Famelart", official_url: "https://mediatheque.tourcoing.fr",
  }]);
  const { opportunites, doublons } = fusionner([...depuisEvenements, ...depuisLieux]);
  assert.equal(opportunites.length, 1);
  assert.equal(doublons, 1);
  assert.deepEqual(opportunites[0].sources.map((s) => s.source).sort(),
    ["autour_events", "autour_places"]);
  /* Ce qui manquait à la première source est complété par la seconde ; ce qui
     était déjà là n'est pas remplacé. */
  assert.equal(opportunites[0].canal, "site_officiel");
  assert.equal(opportunites[0].place_id, "uuid-1");
});

test("chaque critère porte une justification non vide", () => {
  const { criteres } = qualifier({
    type: "lieu_culturel", coordonnees_publiques: {},
    sources: [{ source: "autour_events", type_source: "donnee_autour", url: "https://x.test" }],
    faits: { evenements_total: 30, evenements_a_venir: 22, dernier_evenement: "2026-10-17T12:00:00Z" },
  }, MAINTENANT);
  /* SEPT CRITÈRES DEPUIS LA V2 : « facilité de contact » s'est ajoutée. La
     liste est nommée plutôt que comptée — ajouter un critère doit être une
     décision visible, pas un nombre qui glisse. */
  assert.deepEqual(criteres.map((c) => c.critere).sort(),
    ["accessibilite", "actualite", "confiance", "cout", "facilite_contact",
     "pertinence", "potentiel"]);
  for (const c of criteres) {
    assert.ok(c.pourquoi && c.pourquoi.trim().length > 10, `critère ${c.critere} sans justification`);
    assert.ok(["faible", "moyen", "eleve", "inconnu"].includes(c.niveau));
    assert.equal(c.methode, "regle");
  }
  /* AUCUNE NOTE GLOBALE N'EST PRODUITE, et c'est le point de la table. */
  assert.equal(Object.keys(qualifier({ type: "structure", sources: [], faits: {} }, MAINTENANT))
    .includes("score"), false);
});

test("ce que les règles ne tranchent pas part à l'examen humain", () => {
  const r = qualifier({
    type: "structure", coordonnees_publiques: {},
    sources: [{ source: "recherche_entreprises", type_source: "annuaire_public", url: "https://a.test" }],
    faits: { siren: "1", date_creation: "2019-03-02" },
  }, MAINTENANT);
  assert.equal(r.statut, "a_examiner");
  assert.ok(r.indecis.includes("pertinence"));
  assert.match(r.prochaine_action, /Examen humain/);
});

test("un commerce est écarté, et la raison est écrite", () => {
  const r = qualifier({ type: "commerce", type_pourquoi: "le nom désigne un commerce de bouche",
    coordonnees_publiques: {}, sources: [], faits: {} }, MAINTENANT);
  assert.equal(r.statut, "non_pertinente");
  assert.match(r.criteres.find((c) => c.critere === "pertinence").pourquoi, /ne produit pas le contenu/);
});

test("le coût est nul, et il est dit pourquoi", () => {
  const { criteres } = qualifier({ type: "association", coordonnees_publiques: {}, sources: [], faits: {} }, MAINTENANT);
  const cout = criteres.find((c) => c.critere === "cout");
  assert.equal(cout.niveau, "faible");
  assert.match(cout.pourquoi, /0 €/);
});

/* ------------------------------------------------------------------------
   LES TROIS REFUS. Ce sont eux qui font l'agent : un générateur de messages
   écrit toujours quelque chose, et c'est exactement le défaut à empêcher.
   --------------------------------------------------------------------- */
const CIBLE = {
  nom: "Médiathèque André Malraux", ville: "Tourcoing", type: "lieu_culturel",
  canal: "site_officiel",
  coordonnees_publiques: { site: { valeur: "https://mediatheque.tourcoing.fr", vu_sur: "https://mediatheque.tourcoing.fr" } },
  sources: [{ source: "autour_events", type_source: "donnee_autour", url: "https://openagenda.com/x/events/1" }],
  faits: { evenements_total: 30, evenements_a_venir: 22, dernier_evenement: "2026-10-17T12:00:00Z" },
};

test("un brouillon cite un fait, avec sa source", () => {
  const q = qualifier(CIBLE, MAINTENANT);
  const b = preparerContact(CIBLE, q, { signature: "Sanoussy" });
  assert.equal(b.refus, undefined);
  assert.ok(b.faits_utilises.length >= 1);
  assert.equal(b.faits_utilises[0].source_url, "https://openagenda.com/x/events/1");
  /* La phrase personnalisée reprend le nombre exact, pas un arrondi flatteur. */
  assert.match(b.message, /22 prochains rendez-vous à Tourcoing/);
  assert.ok(!/utilisateurs/.test(b.message));
});

test("sans canal public, rien n'est préparé", () => {
  const q = qualifier(CIBLE, MAINTENANT);
  const b = preparerContact({ ...CIBLE, canal: null, coordonnees_publiques: {} }, q);
  assert.match(b.refus, /Aucun canal de contact public/);
});

test("sans fait à citer, un message serait du publipostage", () => {
  const sansFait = { ...CIBLE, faits: {} };
  const b = preparerContact(sansFait, qualifier(sansFait, MAINTENANT));
  assert.match(b.refus, /publipostage/);
});

test("une pertinence non établie ne justifie pas un démarchage", () => {
  const flou = { ...CIBLE, type: "structure", faits: { evenements_total: 0 } };
  const b = preparerContact(flou, qualifier(flou, MAINTENANT));
  assert.ok(b.refus);
});

test("le garde-fou attrape les affirmations qu'Autour ne peut pas tenir", () => {
  const trouves = verifierInterdits(
    "Autour compte 3 000 utilisateurs, nos partenaires adorent, et nous sommes la référence.");
  const raisons = trouves.map((t) => t.pourquoi).join(" | ");
  assert.ok(trouves.length >= 3, raisons);
  assert.match(raisons, /nombre d'utilisateurs/);
  assert.match(raisons, /relation existante/);
  assert.match(raisons, /superlatif/);
  /* Le mot « utilisateurs » seul reste licite : c'est l'AFFIRMATION chiffrée
     qui est interdite, pas le vocabulaire. */
  assert.equal(verifierInterdits("les utilisateurs d'Autour cherchent des sorties").length, 0);
});

test("l'agent ne se présente jamais comme une personne", () => {
  assert.equal(verifierInterdits("Bonjour, je suis une personne qui aime votre travail.").length, 1);
});

test("le type déduit dit toujours sur quoi il se fonde", () => {
  for (const nom of ["Médiathèque Jean Lévy", "Zénith de Lille", "Le Bistrot de St So", "Chose Machin"]) {
    const t = deduireType(nom, null);
    assert.ok(t.pourquoi && t.pourquoi.length > 10, nom);
  }
  assert.equal(deduireType("Chose Machin", null).type, "structure");
  assert.equal(deduireType("Chose Machin", "bibliotheque").type, "lieu_culturel");
});

/* ==========================================================================
   ACQUISITION V2 — canaux, écosystème, international
   ======================================================================= */

import {
  adresseInstitutionnelle, canauxDepuisAnnuaireServicePublic, canauxDepuisOsm,
  rapprocherCanaux, canalPrincipal, canalOpportunite,
} from "../supabase/functions/agent-acquisition/canaux.mjs";
import {
  typeEcosysteme, raisonPourAutour, candidatsEcosysteme,
  candidatsDepuisOsmStructures, requeteOverpassAutour,
} from "../supabase/functions/agent-acquisition/ecosysteme.mjs";

test("une adresse nominative n'est pas une adresse de contact, même publiée", () => {
  /* On ne collecte pas de données personnelles : une boîte de fonction est
     faite pour recevoir, « prenom.nom@ » ne l'est pas. */
  assert.equal(adresseInstitutionnelle("contact@ville.fr"), true);
  assert.equal(adresseInstitutionnelle("mediatheque-malraux@tourcoing.fr"), true);
  assert.equal(adresseInstitutionnelle("billetterie@theatre.fr"), true);
  assert.equal(adresseInstitutionnelle("jean.dupont@ville.fr"), false);
  assert.equal(adresseInstitutionnelle("j.dupont@ville.fr"), false);
  assert.equal(adresseInstitutionnelle("pas-une-adresse"), false);
});

test("l'annuaire du service public rend des champs JSON encodés en chaîne", () => {
  /* Opendatasoft sert `site_internet` comme une CHAÎNE contenant du JSON. Un
     `JSON.parse` direct lèverait sur les champs qui sont de vraies chaînes ;
     ne rien faire écrirait « [{"valeur":… » dans la base. */
  const index = canauxDepuisAnnuaireServicePublic({ results: [{
    nom: "Médiathèque André Malraux",
    site_internet: '[{"valeur":"https://mediatheque.tourcoing.fr","libelle":"Site"}]',
    adresse_courriel: "contact@mediatheque.tourcoing.fr",
    formulaire_contact: null,
  }] });
  const fiche = index.get("mediatheque andre malraux");
  assert.ok(fiche, "la fiche doit être indexée sur le nom normalisé");
  assert.equal(fiche.canaux.length, 2);
  assert.equal(canalPrincipal(fiche.canaux).type, "email_public");
  assert.ok(fiche.canaux.every((c) => c.source === "annuaire_service_public"));
});

test("OpenStreetMap : `website` et `contact:website` disent la même chose", () => {
  const index = canauxDepuisOsm({ elements: [
    { type: "node", id: 42, tags: { name: "Le Fresnoy", "contact:website": "lefresnoy.net",
                                    "contact:email": "accueil@lefresnoy.net" } },
    { type: "way", id: 7, tags: { name: "Sans contact" } },
  ] });
  assert.equal(index.size, 1);
  const c = index.get("fresnoy").canaux;
  assert.equal(canalPrincipal(c).type, "email_public");
  /* Une URL sans schéma est complétée, pas rejetée. */
  assert.match(c.find((x) => x.type === "site_officiel").valeur, /^https:\/\/lefresnoy\.net/);
  assert.match(index.get("fresnoy").canaux[0].url_source, /openstreetmap\.org\/node\/42/);
});

test("le rapprochement de canal ne devine pas", () => {
  const index = canauxDepuisOsm({ elements: [
    { type: "node", id: 1, tags: { name: "Médiathèque André Malraux", website: "https://m.fr" } },
  ] });
  const { trouves, manquants } = rapprocherCanaux(
    [{ id: "a", nom: "Médiathèque André Malraux" }, { id: "b", nom: "Une autre structure" }], index);
  assert.equal(trouves.length, 1);
  assert.equal(manquants.length, 1);
  assert.equal(canalOpportunite(trouves[0].canaux), "site_officiel");
});

test("un incubateur n'est pas pertinent parce qu'il est un incubateur", () => {
  /* §8, et c'est la consigne la plus facile à trahir sans s'en apercevoir. */
  const { raison, verifiee } = raisonPourAutour("incubateur", "incubateur", {});
  assert.equal(verifiee, false);
  assert.match(raison, /Hypothèse non vérifiée/);
  assert.match(raison, /ne produit pas le contenu qu'Autour montre/);
  assert.match(raison, /DIFFUSION/);

  /* Avec une activité observée, la phrase change de nature. */
  const observe = raisonPourAutour("incubateur", "incubateur", { evenements_a_venir: 4 });
  assert.equal(observe.verifiee, true);
  assert.match(observe.raison, /^Observé/);
});

test("une recherche d'incubateurs ne rapporte pas de garages", () => {
  const candidats = candidatsEcosysteme({ results: [
    { siren: "1", nom_complet: "PEPINIERE D ENTREPRISES DE ROUBAIX", etat_administratif: "A",
      activite_principale: "70.22Z", siege: { libelle_commune: "Roubaix" } },
    { siren: "2", nom_complet: "GARAGE MARTIN", etat_administratif: "A",
      siege: { libelle_commune: "Roubaix" } },
    { siren: "3", nom_complet: "LA RUCHE ROUBAIX", etat_administratif: "A",
      siege: { libelle_commune: "Roubaix" } },
  ] }, { ville: "Roubaix" });
  assert.equal(candidats.length, 2);
  assert.deepEqual(candidats.map((c) => c.type).sort(), ["coworking", "incubateur"]);
  assert.ok(candidats.every((c) => c.raison_pertinence && c.raison_pertinence.length > 80));
  assert.equal(typeEcosysteme("GARAGE MARTIN"), null);
});

test("hors de France, OpenStreetMap apporte la structure ET la porte", () => {
  /* C'est l'avantage inattendu du test international : en France il faut deux
     sources pour obtenir les deux. */
  const [s] = candidatsDepuisOsmStructures({ elements: [
    { type: "way", id: 7, tags: { name: "Théâtre National", amenity: "theatre",
      "contact:email": "info@theatre.be", website: "https://theatre.be" } },
    { type: "node", id: 8, tags: { name: "Station Total", amenity: "fuel" } },
  ] }, { ville: "Bruxelles", pays: "BE" });
  assert.ok(s, "le théâtre doit être retenu");
  assert.equal(s.pays, "BE");
  assert.equal(s.type, "lieu_culturel");
  assert.equal(s.canal, "email_public");
  assert.equal(s.coordonnees_publiques.email.valeur, "info@theatre.be");
  /* La station-service a un nom, et n'entre pas : son tag n'est pas dans la
     table des familles retenues. */
  assert.equal(candidatsDepuisOsmStructures({ elements: [
    { type: "node", id: 8, tags: { name: "Station Total", amenity: "fuel" } },
  ] }, { ville: "Bruxelles", pays: "BE" }).length, 0);
});

test("la requête Overpass interroge un point, pas un nom d'aire", () => {
  /* La première version cherchait `area["name"="Tourcoing"]` et a rendu ZÉRO
     entité en exécution. Autour interroge Overpass depuis des années par
     `around:` — sans base d'aires, sans orthographe, sans niveau
     administratif qui change d'un pays à l'autre. */
  const r = requeteOverpassAutour(50.7239, 3.1612, 12);
  assert.match(r, /^\[out:json\]\[timeout:25\];/);
  assert.match(r, /around:12000,50\.72390,3\.16120/);
  assert.match(r, /out center 200;$/);
  assert.ok(!r.includes("area["), "plus aucune requête par aire");

  /* Bornée : ni le rayon ni la sortie ne peuvent être dépassés par l'appelant. */
  assert.match(requeteOverpassAutour(1, 2, 999, 9999), /around:25000,/);
  assert.match(requeteOverpassAutour(1, 2, 999, 9999), /out center 400;$/);

  /* Sans coordonnées, on refuse plutôt que d'envoyer une requête absurde. */
  assert.throws(() => requeteOverpassAutour(null, null),
    /coordonn\u00e9es manquantes/);
});

test("le septième critère distingue « une porte existe » de « elle est facile »", () => {
  const base = { type: "lieu_culturel", coordonnees_publiques: {},
    sources: [{ source: "autour_events", type_source: "donnee_autour", url: "https://x.test" }],
    faits: { evenements_a_venir: 9, evenements_total: 20, dernier_evenement: "2026-10-17T12:00:00Z" } };

  const avecMail = qualifier({ ...base, canaux: [
    { type: "email_public", valeur: "contact@x.fr", statut: "trouve" }] }, MAINTENANT);
  assert.equal(avecMail.criteres.find((c) => c.critere === "facilite_contact").niveau, "eleve");

  const avecTel = qualifier({ ...base, canaux: [
    { type: "telephone_public", valeur: "03…", statut: "trouve" }] }, MAINTENANT);
  assert.equal(avecTel.criteres.find((c) => c.critere === "facilite_contact").niveau, "faible");

  /* Pas encore cherché ≠ cherché sans succès, et la suite proposée diffère. */
  const jamaisCherche = qualifier({ ...base, canaux: [] }, MAINTENANT);
  assert.equal(jamaisCherche.criteres.find((c) => c.critere === "facilite_contact").niveau, "inconnu");
  assert.match(jamaisCherche.prochaine_action, /acquisition_find_contact_channel/);

  const chercheEnVain = qualifier({ ...base, canaux: [], canal_cherche_le: "2026-09-19T00:00:00Z" }, MAINTENANT);
  assert.equal(chercheEnVain.criteres.find((c) => c.critere === "facilite_contact").niveau, "faible");
});

test("l'acronyme entre parenthèses n'est pas le nom", () => {
  /* L'annuaire des entreprises rend « CROIX ROUGE FRANCAISE (CRF) ». Aucune
     autre source ne porte ce sigle, si bien que la structure ne se rapprochait
     jamais de sa fiche ailleurs : 33 contacts publics disponibles à Tourcoing,
     zéro rapproché. Mesuré en exécution. */
  assert.equal(nomAffiche("CROIX ROUGE FRANCAISE (CRF)"), "CROIX ROUGE FRANCAISE");
  assert.equal(nomAffiche("AFEJI HAUTS DE FRANCE (AFEJI)"), "AFEJI HAUTS DE FRANCE");
  /* Une parenthèse qui n'est pas un sigle reste : elle porte du sens. */
  assert.equal(nomAffiche("Gare Saint Sauveur (ancienne gare)"), "Gare Saint Sauveur (ancienne gare)");
  /* La clé de rapprochement suit, sinon la correction ne servirait à rien. */
  assert.equal(cleDedup("CROIX ROUGE FRANCAISE (CRF)", "Tourcoing"),
               cleDedup("Croix-Rouge française", "Tourcoing"));
});

test("le rapprochement par inclusion exige deux mots, et le dit", () => {
  const index = canauxDepuisAnnuaireServicePublic({ results: [
    { nom: "Médiathèque André Malraux - Tourcoing", adresse_courriel: "contact@mediatheque.fr" },
    { nom: "Mairie de Tourcoing", adresse_courriel: "contact@ville.fr" },
  ] });
  const { trouves, manquants } = rapprocherCanaux([
    { id: "a", nom: "Médiathèque André Malraux" },
    { id: "b", nom: "Mairie" },
    { id: "c", nom: "Médiathèque municipale" },
  ], index);

  assert.equal(trouves.length, 1);
  assert.equal(trouves[0].opportunite.id, "a");
  assert.equal(trouves[0].exact, false);
  /* Une correspondance probable n'est pas une identité prouvée : la confiance
     descend d'un cran et la raison est écrite dans la ligne. */
  assert.equal(trouves[0].canaux[0].confiance, "moyen");
  assert.match(trouves[0].canaux[0].notes, /inclusion de nom/);

  /* « Mairie » seul (un mot) ne rapproche rien : sans cette règle il
     rapprocherait n'importe quelle structure dont le nom contient « mairie ». */
  assert.deepEqual(manquants.map((m) => m.id).sort(), ["b", "c"]);
});

test("une correspondance exacte garde sa confiance pleine", () => {
  const index = canauxDepuisAnnuaireServicePublic({ results: [
    { nom: "Médiathèque André Malraux", adresse_courriel: "contact@mediatheque.fr" },
  ] });
  const { trouves } = rapprocherCanaux([{ id: "a", nom: "Médiathèque André Malraux" }], index);
  assert.equal(trouves[0].exact, true);
  assert.equal(trouves[0].canaux[0].confiance, "eleve");
  assert.equal(trouves[0].canaux[0].notes, undefined);
});

/* ---------------------------------------------------------------------------
   L'ANNUAIRE DU SERVICE PUBLIC COMME SOURCE D'OPPORTUNITÉS

   Ce qui est vérifié ici vient d'une mesure, pas d'une intuition : à
   Villeneuve-d'Ascq, 25 fiches portaient un contact et ZÉRO se rapprochait des
   58 opportunités connues, parce que les deux listes décrivent des structures
   différentes. Le lecteur doit donc rendre ces fiches comme candidates.
--------------------------------------------------------------------------- */
import { candidatsDepuisAnnuaireServicePublicOpportunites }
  from "../supabase/functions/agent-acquisition/canaux.mjs";
import { deduireType as deduireTypeReel, nomNormalise }
  from "../supabase/functions/agent-acquisition/normalisation.mjs";

const FICHES = {
  results: [
    {
      nom: "Mission locale pour l'insertion professionnelle et sociale des jeunes (16-25 ans) - Villeneuve-d'Ascq",
      pivot: '[{"type_service_local": "mission_locale", "code_insee_commune": ["59009"]}]',
      adresse_courriel: "contact@mlva.fr",
      code_insee_commune: "59009",
      url_service_public: "https://lannuaire.service-public.gouv.fr/hauts-de-france/nord/7be15bd9",
    },
    {
      nom: "Centre communal d'action sociale (CCAS) - Villeneuve-d'Ascq",
      pivot: '[{"type_service_local": "ccas", "code_insee_commune": ["59009"]}]',
      site_internet: '[{"valeur": "https://www.villeneuvedascq.fr/ccas"}]',
      code_insee_commune: "59009",
    },
    {
      nom: "Fiche sans le moindre moyen de contact",
      pivot: '[{"type_service_local": "mairie"}]',
      code_insee_commune: "59009",
    },
    {
      nom: "Une structure qu'Autour connaît déjà",
      pivot: '[{"type_service_local": "ccas"}]',
      adresse_courriel: "contact@deja-connue.fr",
      code_insee_commune: "59009",
    },
  ],
};

test("les fiches de l'annuaire deviennent des opportunités, avec leur canal", () => {
  const c = candidatsDepuisAnnuaireServicePublicOpportunites(FICHES, {
    ville: "Villeneuve-d'Ascq",
    deja: new Set(),
    deduireType: deduireTypeReel,
  });
  const noms = c.map((x) => x.nom);
  assert.ok(noms.some((n) => n.startsWith("Mission locale")));
  assert.ok(noms.some((n) => n.startsWith("Centre communal")));

  const mission = c.find((x) => x.nom.startsWith("Mission locale"));
  assert.equal(mission.type, "acteur_jeunesse");
  assert.equal(mission.canal_valeur, "contact@mlva.fr");
  assert.equal(mission.canal_type, "email_public");
  assert.match(mission.type_pourquoi, /mission locale/);
  assert.equal(mission.sources[0].source, "annuaire_service_public");
  assert.deepEqual(mission.faits.pivot, ["mission_locale"]);
});

test("une fiche sans aucun canal n'entre pas : toute sa raison d'être est la porte", () => {
  const c = candidatsDepuisAnnuaireServicePublicOpportunites(FICHES, {
    ville: "Villeneuve-d'Ascq", deja: new Set(), deduireType: deduireTypeReel,
  });
  assert.ok(!c.some((x) => x.nom.startsWith("Fiche sans")));
});

test("une structure déjà connue d'Autour n'est pas recréée", () => {
  const deja = new Set([nomNormalise("Une structure qu'Autour connaît déjà")]);
  const c = candidatsDepuisAnnuaireServicePublicOpportunites(FICHES, {
    ville: "Villeneuve-d'Ascq", deja, deduireType: deduireTypeReel,
  });
  assert.ok(!c.some((x) => x.nom.startsWith("Une structure qu'Autour")));
});

test("le pivot ne ramasse pas les codes INSEE comme s'ils étaient des types", () => {
  const c = candidatsDepuisAnnuaireServicePublicOpportunites(FICHES, {
    ville: "Villeneuve-d'Ascq", deja: new Set(), deduireType: deduireTypeReel,
  });
  for (const x of c) {
    for (const p of x.faits.pivot || []) assert.ok(!/^\d{5}$/.test(p), `pivot pollué : ${p}`);
  }
});

test("sans ville, le lecteur ne rend rien plutôt qu'une clé de déduplication bancale", () => {
  const c = candidatsDepuisAnnuaireServicePublicOpportunites(FICHES, { ville: "" });
  assert.equal(c.length, 0);
});

/* `acquisition_opportunites.canal` porte un CHECK en base : le type du canal,
   jamais sa valeur. Y écrire une adresse e-mail faisait tomber l'insertion —
   trouvé en relisant le schéma, avant déploiement. Ce test garde la frontière. */
const CANAUX_ACCEPTES = new Set([
  "email_public", "formulaire_site", "site_officiel",
  "telephone_public", "sur_place", "reseau_public",
]);

test("le champ `canal` reste un type accepté par le CHECK de la base", () => {
  const c = candidatsDepuisAnnuaireServicePublicOpportunites({
    results: [
      { nom: "Fiche avec courriel", pivot: '[{"type_service_local":"ccas"}]', adresse_courriel: "contact@a.fr" },
      { nom: "Fiche avec site", pivot: '[{"type_service_local":"ccas"}]', site_internet: "https://b.fr" },
      { nom: "Fiche avec formulaire", pivot: '[{"type_service_local":"ccas"}]', formulaire_contact: "https://c.fr/contact" },
    ],
  }, { ville: "Lille", deja: new Set(), deduireType: deduireTypeReel });

  assert.equal(c.length, 3);
  for (const x of c) {
    assert.ok(CANAUX_ACCEPTES.has(x.canal), `canal refusé par la base : ${x.canal}`);
    assert.ok(x.canal_valeur && !CANAUX_ACCEPTES.has(x.canal_valeur));
  }
  assert.equal(c.find((x) => x.nom === "Fiche avec formulaire").canal, "formulaire_site");
  assert.equal(c.find((x) => x.nom === "Fiche avec site").canal, "site_officiel");
  assert.equal(c.find((x) => x.nom === "Fiche avec courriel").canal, "email_public");
});
