/* ---------------------------------------------------------------------------
   Préparer un message — et refuser d'en préparer un

   CE QUI REND CE FICHIER DIFFICILE

   Un générateur de messages écrit toujours quelque chose. C'est son défaut :
   sommé de personnaliser, il comble les trous. « Nous avons remarqué votre
   excellent travail auprès des jeunes du quartier » est exactement le genre de
   phrase qu'un modèle produit sans qu'aucun fait ne la soutienne — et elle est
   fausse, donc elle coûte la crédibilité d'Autour au premier échange.

   D'où la règle de ce module : CHAQUE PHRASE DE PERSONNALISATION DOIT CITER UN
   FAIT COLLECTÉ, et ce fait part avec le brouillon dans `faits_utilises`, avec
   l'URL de la source. L'écran de validation les affiche à côté du message : le
   fondateur ne relit pas une prose, il vérifie une correspondance.

   ET LA RÈGLE INVERSE : quand il n'y a pas de fait, il n'y a pas de phrase.
   Pas de formule de remplacement, pas de compliment générique. Un message
   court et sec qui dit vrai vaut mieux qu'un message chaleureux qui invente.

   AUTOUR N'A PAS D'UTILISATEURS À METTRE EN AVANT, ET NE DOIT PAS FAIRE
   SEMBLANT D'EN AVOIR. `AUTOUR_TEL_QUEL` est écrit ici, une fois, au présent et
   sans chiffre. `verifierInterdits` relit le brouillon final et le refuse s'il
   contient une affirmation de cette famille — y compris si c'est un modèle qui
   l'a écrite.
--------------------------------------------------------------------------- */

/* LA LISTE DES INTERDITS A DÉMÉNAGÉ, ET C'EST VOLONTAIRE.

   Elle vit maintenant dans `../shared/interdits.mjs`, parce qu'un deuxième
   rédacteur l'utilise : l'assistant d'AGORA, qui fait reformuler un message par
   un modèle. Deux listes auraient divergé, et c'est toujours la plus permissive
   qui aurait servi.

   `verifierInterdits` est réexportée ici : le contrat de ce module ne change
   pas pour qui l'importait déjà, et les tests continuent de l'interroger au
   même endroit. */
import { AUTOUR_TEL_QUEL, verifierInterdits } from "../shared/interdits.mjs";

export { verifierInterdits };

/* ---------------------------------------------------------------------------
   LES PHRASES QUI CITENT UN FAIT

   Une entrée par fait qu'on sait dire. Chacune rend la phrase ET le fait, pour
   que `faits_utilises` soit construit par le même code qui écrit le texte —
   impossible d'écrire une phrase sans déposer son fait.
--------------------------------------------------------------------------- */
function phrasesDeFaits(opportunite) {
  const f = opportunite.faits || {};
  const sources = opportunite.sources || [];
  const urlDe = (nom) => sources.find((s) => s.source === nom)?.url || null;
  const dites = [];

  if (Number(f.evenements_a_venir || 0) > 0) {
    dites.push({
      phrase: `Vos ${f.evenements_a_venir} prochains rendez-vous à ${opportunite.ville} apparaissent déjà dans les agendas publics que lit Autour.`,
      fait: `${f.evenements_a_venir} événements à venir relevés dans les données d'Autour`,
      source_url: urlDe("autour_events"),
    });
  } else if (Number(f.evenements_total || 0) > 0) {
    dites.push({
      phrase: `Des événements que vous avez accueillis à ${opportunite.ville} figurent dans les agendas publics que lit Autour.`,
      fait: `${f.evenements_total} événements observés`,
      source_url: urlDe("autour_events"),
    });
  }

  if (f.agenda_uid) {
    dites.push({
      phrase: "Votre agenda public est une des sources qu'Autour sait déjà lire.",
      fait: `agenda public, identifiant ${f.agenda_uid}`,
      source_url: urlDe("openagenda_candidats"),
    });
  }

  if (f.activite_principale) {
    dites.push({
      phrase: null,          // sert la qualification, pas le message
      fait: `activité principale déclarée ${f.activite_principale}`,
      source_url: urlDe("recherche_entreprises"),
    });
  }
  return dites;
}

/* ---------------------------------------------------------------------------
   PRÉPARER — ou expliquer pourquoi on ne prépare pas
   ------------------------------------------------------------------------ */
export function preparerContact(opportunite, qualification, options = {}) {
  const canal = opportunite.canal
    || (Object.keys(opportunite.coordonnees_publiques || {}).length ? "site_officiel" : null);

  /* PREMIER REFUS : pas de porte. Préparer un message qu'on ne pourra envoyer
     nulle part remplirait la file de validation de travail mort. */
  if (!canal) {
    return {
      refus: "Aucun canal de contact public observé : rien à préparer tant qu'une page ou une adresse officielle n'a pas été trouvée à la main.",
    };
  }

  const par = Object.fromEntries((qualification?.criteres || []).map((c) => [c.critere, c.niveau]));

  /* DEUXIÈME REFUS : rien à dire de vrai. Un message sans un seul fait
     personnalisé est un publipostage, et le §8 l'interdit — pas « le
     déconseille ». */
  const dites = phrasesDeFaits(opportunite).filter((d) => d.phrase);
  if (dites.length === 0) {
    return {
      refus: "Aucun fait collecté ne permet d'écrire une phrase personnalisée vraie : un message générique serait du publipostage.",
    };
  }

  /* TROISIÈME REFUS : pertinence non établie. On ne démarche pas « au cas où ». */
  if (par.pertinence !== "eleve" && par.pertinence !== "moyen") {
    return { refus: `Pertinence « ${par.pertinence || "non évaluée"} » : la prise de contact n'est pas justifiée par les faits.` };
  }

  const partenariat = par.pertinence === "eleve" && par.potentiel === "eleve";
  const objet = partenariat
    ? `Autour — faire connaître votre programmation à ${opportunite.ville}`
    : `Autour — une question rapide sur votre programmation à ${opportunite.ville}`;

  const corps = [
    "Bonjour,",
    "",
    AUTOUR_TEL_QUEL,
    "",
    dites.map((d) => d.phrase).join(" "),
    "",
    partenariat
      ? "Ce message est une prise de contact : je cherche à savoir si cela vous intéresse que votre programmation soit visible dans Autour, et à quelles conditions vous le souhaiteriez. Rien n'est publié sans votre accord, et il n'y a rien à payer."
      : "Je cherche simplement à savoir si l'idée vous parle, et si vous verriez un intérêt à ce que vos rendez-vous soient plus faciles à trouver pour les gens du quartier.",
    "",
    "Si ce n'est pas le bon moment ou pas le bon interlocuteur, dites-le moi et je n'insisterai pas.",
    "",
    "Bien à vous,",
    options.signature || "[votre prénom et votre nom]",
  ].join("\n");

  /* La relecture automatique passe sur le texte final, celui-là même qui sera
     affiché. Si elle trouve quelque chose, le brouillon n'existe pas : on rend
     un refus, pas un message « à corriger ». */
  const interdits = verifierInterdits(corps);
  if (interdits.length > 0) {
    return {
      refus: "Le brouillon contient une affirmation interdite : "
        + interdits.map((i) => `« ${i.extrait} » (${i.pourquoi})`).join(" ; "),
    };
  }

  return {
    canal: canal === "site_officiel" && opportunite.coordonnees_publiques?.email
      ? "email_public" : (canal === "site_officiel" ? "formulaire_site" : canal),
    objet,
    message: corps,
    faits_utilises: dites.map((d) => ({ fait: d.fait, source_url: d.source_url })),
  };
}

export { AUTOUR_TEL_QUEL };
