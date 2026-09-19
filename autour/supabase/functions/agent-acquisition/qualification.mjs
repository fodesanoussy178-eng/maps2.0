/* ---------------------------------------------------------------------------
   Qualifier sans inventer une note

   POURQUOI PAS UN SCORE

   « Association X — 87/100 » ne se conteste pas. On ne sait ni ce qui a compté,
   ni ce qui la ferait monter, ni si le 87 vient d'un fait ou d'une impression.
   Six critères séparés, chacun avec sa phrase et le fait d'où elle sort, se
   lisent en dix secondes et se contredisent en une : « non, cette médiathèque
   a un service communication, l'accessibilité n'est pas faible ».

   LE NIVEAU DÉCRIT LE CRITÈRE, PAS LA BONNE NOUVELLE

   `cout: faible` veut dire « ça coûte peu », donc c'est bon. `pertinence:
   faible` veut dire « peu pertinent », donc c'est mauvais. Les deux sont des
   mesures du critère nommé, jamais une note de l'opportunité — il n'y a pas de
   note.

   « INCONNU » EST UNE RÉPONSE

   Quand aucun fait observé ne permet de trancher, le critère vaut `inconnu` et
   l'opportunité part en `a_examiner` (§12). C'est le seul cas où l'agent
   demande un humain, et c'est exactement ce qu'il faut : deviner ici
   produirait une conviction que personne n'a formée.

   AUCUN APPEL À UN MODÈLE DANS CE FICHIER. Les règles sont déterministes et
   tiennent sur des faits déjà collectés. Le modèle, quand il y en a un, ne sert
   qu'aux cas que ces règles laissent `inconnu` — et il écrit alors
   `methode = 'modele'`, pour qu'on sache lesquelles relire en premier.
--------------------------------------------------------------------------- */

const JOUR = 24 * 60 * 60 * 1000;

/* Ce qu'Autour montre : des sorties, des lieux, des événements locaux. Une
   structure est pertinente si son activité produit ce genre de contenu, ou si
   son public est celui qui en cherche. */
const TYPES_PERTINENTS = new Set([
  "lieu_culturel", "lieu_de_sortie", "acteur_evenementiel", "organisateur",
  "association", "club", "communaute_locale", "acteur_jeunesse",
  "etablissement_etudiant", "media_local",
]);
const TYPES_PERIPHERIQUES = new Set(["commerce", "collectivite", "creche_tiers_lieu"]);

function critere(nom, niveau, pourquoi, fait, methode = "regle") {
  return { critere: nom, niveau, pourquoi, fait_observe: fait ?? null, methode };
}

function joursDepuis(iso, maintenant) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((maintenant.getTime() - t) / JOUR);
}

export function qualifier(opportunite, maintenant = new Date()) {
  const f = opportunite?.faits || {};
  const sources = opportunite?.sources || [];
  const coordonnees = Object.keys(opportunite?.coordonnees_publiques || {});
  const criteres = [];

  /* ----- PERTINENCE ------------------------------------------------------ */
  const aVenir = Number(f.evenements_a_venir || 0);
  if (aVenir > 0) {
    criteres.push(critere("pertinence", "eleve",
      `Programme ${aVenir} rendez-vous à venir : produit exactement le genre de sorties qu'Autour montre.`,
      `${aVenir} événements à venir relevés dans les données d'Autour`));
  } else if (TYPES_PERTINENTS.has(opportunite.type)) {
    criteres.push(critere("pertinence", "moyen",
      `Type « ${opportunite.type} » : son activité ordinaire produit des sorties ou touche le public d'Autour, mais aucune programmation n'a été observée.`,
      opportunite.type_pourquoi || null));
  } else if (TYPES_PERIPHERIQUES.has(opportunite.type)) {
    criteres.push(critere("pertinence", "faible",
      `Type « ${opportunite.type} » : peut faire connaître Autour, mais ne produit pas le contenu qu'Autour montre.`,
      opportunite.type_pourquoi || null));
  } else {
    criteres.push(critere("pertinence", "inconnu",
      "Ni programmation observée, ni type identifié : rien dans les faits collectés ne permet de trancher.",
      opportunite.type_pourquoi || null));
  }

  /* ----- ACCESSIBILITÉ --------------------------------------------------- */
  if (coordonnees.length > 0) {
    criteres.push(critere("accessibilite", "eleve",
      `Coordonnée publique relevée (${coordonnees.join(", ")}), publiée par la structure elle-même.`,
      Object.values(opportunite.coordonnees_publiques)[0]?.vu_sur || null));
  } else if (sources.some((s) => s.url)) {
    criteres.push(critere("accessibilite", "moyen",
      "Aucune coordonnée publique relevée, mais une page publique existe : un formulaire ou une adresse s'y trouve peut-être, à vérifier à la main.",
      sources.find((s) => s.url)?.url || null));
  } else {
    criteres.push(critere("accessibilite", "faible",
      "Aucune coordonnée publique observée et aucune page à ouvrir : rien ne dit par où joindre cette structure.",
      null));
  }

  /* ----- POTENTIEL -------------------------------------------------------
     Le §3 l'interdit explicitement : la taille ne fait pas la pertinence. Le
     potentiel se lit donc sur ce que la structure FAIT — une programmation
     régulière, un agenda public — pas sur ce qu'elle pèse. */
  const total = Number(f.evenements_total || 0);
  if (f.agenda_uid) {
    criteres.push(critere("potentiel", "eleve",
      "Publie déjà un agenda public : le public qui le consulte cherche exactement ce qu'Autour propose.",
      `agenda OpenAgenda ${f.agenda_uid}`));
  } else if (aVenir >= 5) {
    criteres.push(critere("potentiel", "eleve",
      `Programmation régulière (${aVenir} à venir, ${total} vus au total) : un partenariat aurait de quoi vivre dans la durée.`,
      `${total} événements observés`));
  } else if (total >= 2) {
    criteres.push(critere("potentiel", "moyen",
      `Programmation observée mais modeste (${total} événements vus) : de quoi commencer, pas de quoi porter une zone.`,
      `${total} événements observés`));
  } else {
    criteres.push(critere("potentiel", "inconnu",
      "Aucune activité observée dans les données d'Autour : le potentiel ne se déduit d'aucun fait.",
      null));
  }

  /* ----- COÛT ------------------------------------------------------------
     Toutes les actions préparées par cet agent passent par un canal public
     déjà ouvert : écrire, remplir un formulaire, passer sur place. Le coût est
     donc nul, et ce n'est pas une estimation optimiste — c'est la conséquence
     du fait qu'aucun budget n'existe et qu'aucune action payante n'est dans le
     vocabulaire de l'agent. */
  criteres.push(critere("cout", "faible",
    "0 € : la prise de contact envisagée passe par un canal public déjà ouvert, et Autour n'achète aucune diffusion.",
    null));

  /* ----- ACTUALITÉ ------------------------------------------------------- */
  const age = joursDepuis(f.dernier_evenement, maintenant);
  if (aVenir > 0) {
    criteres.push(critere("actualite", "eleve",
      "Au moins un rendez-vous à venir : la structure est active maintenant.",
      f.dernier_evenement || null));
  } else if (age != null && age <= 180) {
    criteres.push(critere("actualite", "moyen",
      `Dernière activité observée il y a ${age} jours : récente, mais rien n'est annoncé pour la suite.`,
      f.dernier_evenement || null));
  } else if (age != null) {
    criteres.push(critere("actualite", "faible",
      `Dernière activité observée il y a ${age} jours : la structure est peut-être en sommeil ou a cessé de publier.`,
      f.dernier_evenement || null));
  } else if (f.date_creation) {
    criteres.push(critere("actualite", "inconnu",
      `Enregistrée depuis ${f.date_creation}, mais aucune activité observée : l'annuaire dit qu'elle existe, pas qu'elle fonctionne.`,
      `date de création ${f.date_creation}`));
  } else {
    criteres.push(critere("actualite", "inconnu",
      "Aucune date d'activité dans les faits collectés.", null));
  }

  /* ----- CONFIANCE -------------------------------------------------------
     Elle porte sur LA DONNÉE, pas sur la structure : « à quel point suis-je sûr
     que ce que je viens d'écrire est vrai ». Deux provenances indépendantes qui
     concordent valent mieux qu'une seule, quelle qu'elle soit. */
  const provenances = new Set(sources.map((s) => s.source));
  const officielle = sources.some((s) => s.type_source === "donnee_autour" || s.type_source === "site_officiel");
  if (provenances.size >= 2) {
    criteres.push(critere("confiance", "eleve",
      `Vue par ${provenances.size} provenances indépendantes (${[...provenances].join(", ")}) qui concordent sur le nom et la commune.`,
      [...provenances].join(", ")));
  } else if (officielle) {
    criteres.push(critere("confiance", "moyen",
      "Une seule provenance, mais c'est une donnée qu'Autour a collectée et vérifiée lui-même.",
      [...provenances].join(", ")));
  } else {
    criteres.push(critere("confiance", "moyen",
      "Une seule provenance, un annuaire public officiel : l'existence est sûre, l'activité réelle ne l'est pas.",
      [...provenances].join(", ")));
  }

  /* ----- CE QUI EN DÉCOULE ---------------------------------------------- */
  const par = Object.fromEntries(criteres.map((c) => [c.critere, c.niveau]));
  const indecis = criteres.filter((c) => c.niveau === "inconnu").map((c) => c.critere);

  let statut, prochaine_action;
  if (par.pertinence === "faible") {
    statut = "non_pertinente";
    prochaine_action = "Aucune : la pertinence est faible et rien ne justifie d'y passer du temps.";
  } else if (indecis.includes("pertinence")) {
    statut = "a_examiner";
    prochaine_action = `Examen humain : les règles ne tranchent pas (${indecis.join(", ")}). Ouvrir les sources et décider.`;
  } else if (par.accessibilite === "faible") {
    statut = "a_examiner";
    prochaine_action = "Examen humain : structure pertinente, mais aucun moyen de contact observé. Chercher une page officielle à la main.";
  } else {
    statut = "qualifiee";
    prochaine_action = par.pertinence === "eleve"
      ? "Préparer une proposition de partenariat, pour relecture."
      : "Préparer une prise de contact courte, pour relecture.";
  }

  return { criteres, indecis, statut, prochaine_action };
}
