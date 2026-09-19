/* ---------------------------------------------------------------------------
   Ce qu'un message d'Autour ne peut pas affirmer

   POURQUOI CE FICHIER EST PARTAGÉ, ET PAS RECOPIÉ

   Il y a maintenant DEUX rédacteurs : `agent-acquisition/contact.mjs`, qui
   compose des phrases à partir de faits, et `agora-assistant`, qui demande à un
   modèle de reformuler. Le second est de loin le plus susceptible d'inventer —
   sommé d'être « plus humain », un modèle comble les trous avec ce qui sonne
   bien : un nombre d'utilisateurs, un partenariat, un superlatif.

   Si chaque rédacteur portait sa propre liste, elles divergeraient, et c'est
   toujours la mauvaise qui servirait. Une seule définition, relue au même
   endroit, appliquée aux deux.

   LES MOTIFS VISENT DES AFFIRMATIONS, PAS DES MOTS. « utilisateurs » seul est
   licite (« les utilisateurs d'Autour ») ; « 3 000 utilisateurs » ne l'est pas.
--------------------------------------------------------------------------- */

/* La présentation d'Autour. Vraie au moment où elle est écrite, sans chiffre,
   sans superlatif, sans promesse d'audience. Toute modification de ces lignes
   est une décision produit, pas une retouche de style. */
export const AUTOUR_TEL_QUEL =
  "Autour est une application gratuite qui rassemble ce qu'il y a à faire " +
  "autour de soi — événements, lieux, sorties — à partir de sources publiques " +
  "et d'agendas officiels. Le projet est récent et porté par une seule personne.";

export const INTERDITS = [
  [/\b\d[\d\s.,]*\s*(utilisateurs?|membres?|abonn[ée]s?|visiteurs?|t[ée]l[ée]chargements?)\b/i,
   "un nombre d'utilisateurs — Autour n'en communique aucun"],
  [/\b(des\s+)?(milliers|centaines|millions)\s+(d['’]|de\s+)(utilisateurs?|membres?|visiteurs?|personnes)/i,
   "une audience chiffrée en volume"],
  [/\bnos\s+(partenaires?|clients?|utilisateurs?)\b/i,
   "une relation existante — Autour n'a pas encore de partenaires à citer"],
  [/\b(notre|nos)\s+(partenariat|collaboration)s?\s+(avec|existants?)\b/i,
   "un partenariat existant"],
  [/\b(nous\s+(travaillons|collaborons)\s+d[ée]j[àa]\s+avec)\b/i, "une collaboration existante"],
  [/\b(leader|r[ée]f[ée]rence|incontournable|n°\s*1|num[ée]ro\s+un)\b/i,
   "un superlatif invérifiable"],
  [/\b(je\s+suis|nous\s+sommes)\s+une?\s+(personne|humain|[ée]quipe\s+humaine)\b/i,
   "une affirmation sur la nature de l'expéditeur — l'agent ne se présente jamais comme humain"],

  /* LA TRADUCTION FAIT SORTIR LE TEXTE DU DOMAINE DE LA GARDE.
     « des milliers d'utilisateurs » est attrapé ; « thousands of users » ne
     l'était pas. Comme la cible annoncée est l'Europe, l'anglais est ajouté —
     c'est la langue vers laquelle on traduira le plus souvent.

     CETTE GARDE RESTE FORTE EN FRANÇAIS, CORRECTE EN ANGLAIS, ET FAIBLE
     AILLEURS. Le néerlandais, l'allemand et l'espagnol ne sont pas couverts.
     C'est pour cela que l'assistant ne traduit QUE des textes déjà vérifiés en
     français : la vérification a lieu avant la traduction, pas après. */
  [/\b\d[\d\s.,]*\s*(users|members|subscribers|followers|downloads)\b/i,
   "a user count — Autour publishes none"],
  [/\b(thousands|hundreds|millions)\s+of\s+(users|members|visitors|people)\b/i,
   "an audience claimed by volume"],
  [/\bour\s+(partners?|clients?|customers?)\b/i,
   "an existing relationship — Autour has no partners to cite yet"],
  [/\bwe\s+(already\s+)?(work|partner|collaborate)\s+with\b/i,
   "an existing collaboration"],
  [/\b(market\s+leader|the\s+reference|number\s+one)\b/i,
   "an unverifiable superlative"],
];

export function verifierInterdits(texte) {
  const trouves = [];
  for (const [motif, quoi] of INTERDITS) {
    const m = String(texte || "").match(motif);
    if (m) trouves.push({ extrait: m[0], pourquoi: quoi });
  }
  return trouves;
}
