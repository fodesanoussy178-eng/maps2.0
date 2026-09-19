/* ---------------------------------------------------------------------------
   Ce qu'on donne au modèle, et ce qu'on lui interdit

   LE PROBLÈME CENTRAL N'EST PAS LA QUALITÉ DU TEXTE, C'EST SA VÉRACITÉ.

   « Rends ce message plus humain » est exactement la consigne qui pousse un
   modèle à inventer. Pour être chaleureux il lui faut de la matière, et s'il
   n'en a pas il en fabrique : un enthousiasme partagé, une réussite remarquée,
   un partenariat qui n'existe pas. Le texte devient meilleur et faux.

   D'où la forme de ces invites : le modèle ne reçoit JAMAIS une consigne seule.
   Il reçoit un BLOC DE FAITS délimité, et l'instruction de n'affirmer que ce
   qui s'y trouve. Ce qui n'est pas dans le bloc n'existe pas.

   ET LA CEINTURE APRÈS LES BRETELLES : ce que le modèle rend repasse par
   `verifierInterdits` avant d'être montré. Une invite est une demande ; une
   expression régulière est une vérification. On ne confond pas les deux.

   CES FONCTIONS SONT PURES. Elles construisent des chaînes et n'appellent ni le
   réseau ni la base : c'est ce qui les rend testables, et c'est ce qui permet
   de vérifier qu'une invite CONTIENT bien ses garde-fous plutôt que de l'espérer.
--------------------------------------------------------------------------- */

import { AUTOUR_TEL_QUEL } from "../shared/interdits.mjs";

/* Les règles répétées dans chaque invite. Les répéter coûte quelques jetons ;
   les factoriser hors de l'invite coûterait la garantie qu'elles y sont. */
export const REGLES = [
  "Tu écris pour Autour. Voici la seule présentation autorisée du projet, à",
  "reprendre telle quelle ou à raccourcir, jamais à enjoliver :",
  `« ${AUTOUR_TEL_QUEL} »`,
  "",
  "RÈGLES ABSOLUES :",
  "1. N'affirme RIEN qui ne figure pas dans le bloc FAITS. Pas un chiffre, pas",
  "   une date, pas un nom, pas une réussite, pas un partenariat.",
  "2. Autour n'a aucun utilisateur à citer, aucun partenaire, aucune audience.",
  "   Ne laisse jamais entendre le contraire, même vaguement.",
  "3. Si le bloc FAITS est vide ou trop maigre pour personnaliser, écris un",
  "   message court et neutre. Un message bref et vrai vaut mieux qu'un message",
  "   chaleureux et inventé.",
  "4. Pas de superlatif, pas de flatterie, pas de « votre travail remarquable ».",
  "5. Tu n'es pas une personne et tu ne te présentes jamais comme telle.",
  "6. Ne promets aucune contrepartie financière : il n'y en a pas.",
].join("\n");

/* Le bloc de faits. Tout ce que le modèle a le droit de savoir sur la
   structure passe par ici, et rien d'autre. Les champs absents sont écrits
   comme absents — « inconnu » est une information, un blanc n'en est pas une. */
export function blocFaits(o) {
  const l = [];
  l.push(`Nom : ${o?.nom || "inconnu"}`);
  l.push(`Commune : ${o?.ville || "inconnue"}${o?.pays && o.pays !== "FR" ? ` (${o.pays})` : ""}`);
  l.push(`Type : ${(o?.type || "indéterminé").replace(/_/g, " ")}`);
  if (o?.type_pourquoi) l.push(`Pourquoi ce type : ${o.type_pourquoi}`);
  if (o?.description) l.push(`Description reprise d'une source : ${o.description}`);
  if (o?.raison_pertinence) l.push(`Lien possible avec Autour : ${o.raison_pertinence}`);

  const f = o?.faits || {};
  if (Number(f.evenements_a_venir || 0) > 0) {
    l.push(`Rendez-vous publics à venir relevés par Autour : ${f.evenements_a_venir}`);
  }
  if (Number(f.evenements_total || 0) > 0) {
    l.push(`Événements observés au total : ${f.evenements_total}`);
  }
  if (f.agenda_uid) l.push("Publie un agenda public qu'Autour sait déjà lire.");
  if (f.activite_principale) l.push(`Activité principale déclarée : ${f.activite_principale}`);
  if (f.pivot) l.push(`Classement de l'annuaire du service public : ${[].concat(f.pivot).join(", ")}`);

  const criteres = Array.isArray(o?.criteres) ? o.criteres : [];
  for (const c of criteres) {
    if (c?.critere && c?.niveau) l.push(`Critère ${c.critere} : ${c.niveau} — ${c.pourquoi || ""}`);
  }

  if (l.length <= 3) l.push("AUCUN FAIT D'ACTIVITÉ N'A ÉTÉ COLLECTÉ sur cette structure.");
  return l.join("\n");
}

const encadre = (titre, contenu) =>
  `--- DÉBUT ${titre} ---\n${contenu}\n--- FIN ${titre} ---`;

/* Rédiger un premier message pour une structure. */
export function inviteRediger(o, consigne, langue = "français") {
  return [
    REGLES,
    "",
    encadre("FAITS", blocFaits(o)),
    "",
    consigne ? `Consigne de l'opérateur : ${consigne}` : "",
    "",
    `Rédige en ${langue} un e-mail de premier contact. Court : dix lignes au plus.`,
    "Rends EXACTEMENT ce format, sans autre commentaire :",
    "OBJET: <une ligne>",
    "MESSAGE:",
    "<le corps>",
    "",
    "Termine le corps par « [votre prénom et votre nom] » : c'est l'opérateur",
    "qui signera, pas toi.",
  ].filter(Boolean).join("\n");
}

/* Reformuler un texte existant sans y ajouter de matière. C'est le mode le plus
   risqué : « plus humain » est une invitation à broder. L'interdiction d'ajouter
   un fait est donc répétée juste avant la tâche, là où elle pèse le plus. */
export function inviteHumaniser(texte, consigne) {
  return [
    REGLES,
    "",
    encadre("TEXTE À REFORMULER", texte || ""),
    "",
    consigne ? `Consigne de l'opérateur : ${consigne}` : "Rends-le plus naturel et plus direct.",
    "",
    "REFORMULE ce texte. Tu peux changer le ton, l'ordre, la longueur.",
    "Tu ne peux AJOUTER AUCUNE INFORMATION qui ne soit pas déjà dans le texte.",
    "Si la consigne demande d'être plus chaleureux et qu'il n'y a pas de",
    "matière pour l'être honnêtement, reste sobre et dis-le en une ligne",
    "commençant par « NOTE : » après le texte.",
    "Rends le texte reformulé, et rien d'autre.",
  ].join("\n");
}

/* Traduire. Le texte fourni a DÉJÀ passé la garde en français : on traduit un
   contenu vérifié, on ne vérifie pas un contenu traduit. */
export function inviteTraduire(texte, langue) {
  return [
    `Traduis en ${langue} le texte ci-dessous.`,
    "Traduis fidèlement : n'ajoute rien, ne retire rien, n'embellis pas.",
    "Garde le registre professionnel et sobre de l'original.",
    "Garde « Autour » tel quel : c'est un nom propre.",
    "Rends la traduction, et rien d'autre.",
    "",
    encadre("TEXTE", texte || ""),
  ].join("\n");
}

/* Découper la sortie du mode « rédiger ». Un modèle qui ne respecte pas le
   format ne doit pas produire un objet vide en silence : on rend l'objet nul,
   et l'appelant le dit. */
export function decouperRedaction(sortie) {
  const t = String(sortie || "");
  const mo = t.match(/OBJET\s*:\s*(.+)/i);
  const mm = t.match(/MESSAGE\s*:\s*([\s\S]+)/i);
  return {
    objet: mo ? mo[1].trim() : null,
    message: mm ? mm[1].trim() : (mo ? null : t.trim()),
  };
}
