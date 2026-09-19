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
  assert.equal(criteres.length, 6);
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
