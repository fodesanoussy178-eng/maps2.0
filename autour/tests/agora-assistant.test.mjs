import assert from "node:assert/strict";
import test from "node:test";

import { verifierInterdits, AUTOUR_TEL_QUEL }
  from "../supabase/functions/shared/interdits.mjs";
import { REGLES, blocFaits, decouperRedaction, inviteHumaniser, inviteRediger, inviteTraduire }
  from "../supabase/functions/agora-assistant/invite.mjs";

/* ---------------------------------------------------------------------------
   LA GARDE EST PARTAGÉE, ET C'EST TOUT L'INTÉRÊT

   `contact.mjs` et l'assistant rédigent tous les deux. Si chacun portait sa
   liste d'interdits, elles divergeraient — et c'est toujours la plus permissive
   qui servirait. Ce test vérifie qu'il n'y a qu'une définition.
--------------------------------------------------------------------------- */
test("le rédacteur déterministe et l'assistant partagent la même garde", async () => {
  const contact = await import("../supabase/functions/agent-acquisition/contact.mjs");
  assert.equal(contact.verifierInterdits, verifierInterdits,
    "les deux modules doivent exposer LA MÊME fonction, pas deux copies");
  assert.equal(contact.AUTOUR_TEL_QUEL, AUTOUR_TEL_QUEL);
});

test("la garde attrape une audience chiffrée en français comme en anglais", () => {
  assert.equal(verifierInterdits("Nous avons 3 000 utilisateurs.").length, 1);
  assert.equal(verifierInterdits("We already have 3,000 users.").length, 1);
  assert.equal(verifierInterdits("Des milliers d'utilisateurs nous suivent.").length, 1);
  assert.equal(verifierInterdits("Thousands of users follow us.").length, 1);
});

test("la garde attrape un partenariat inventé, dans les deux langues", () => {
  assert.ok(verifierInterdits("Nos partenaires à Lille sont ravis.").length > 0);
  assert.ok(verifierInterdits("Our partners in Lille are delighted.").length > 0);
});

test("une phrase vraie passe : la garde ne censure pas, elle refuse une affirmation", () => {
  assert.deepEqual(
    verifierInterdits("Vos 22 prochains rendez-vous apparaissent dans les agendas que lit Autour."),
    []);
});

/* ---------------------------------------------------------------------------
   L'INVITE DOIT PORTER SES GARDE-FOUS

   Une invite sans ses règles est une invite qui laisse inventer. On vérifie
   qu'elles y SONT, plutôt que de faire confiance à la relecture humaine du
   fichier.
--------------------------------------------------------------------------- */
test("toute invite de rédaction porte les règles absolues et la présentation d'Autour", () => {
  const i = inviteRediger({ nom: "Médiathèque X", ville: "Lille" }, "");
  assert.match(i, /RÈGLES ABSOLUES/);
  assert.ok(i.includes(AUTOUR_TEL_QUEL), "la seule présentation autorisée doit être fournie");
  assert.match(i, /N'affirme RIEN qui ne figure pas dans le bloc FAITS/);
});

test("reformuler interdit explicitement d'ajouter une information", () => {
  const i = inviteHumaniser("Bonjour.", "rends-le plus humain");
  assert.match(i, /AJOUTER AUCUNE INFORMATION/);
  assert.match(i, /RÈGLES ABSOLUES/);
});

test("traduire demande la fidélité et ne réclame pas d'embellissement", () => {
  const i = inviteTraduire("Bonjour.", "néerlandais");
  assert.match(i, /n'ajoute rien/);
  assert.match(i, /néerlandais/);
});

/* ---------------------------------------------------------------------------
   LE BLOC DE FAITS NE COMBLE PAS LES TROUS
--------------------------------------------------------------------------- */
test("un bloc de faits sans activité le DIT, au lieu de rester muet", () => {
  const b = blocFaits({ nom: "Association Y", ville: "Roubaix" });
  assert.match(b, /AUCUN FAIT D'ACTIVITÉ N'A ÉTÉ COLLECTÉ/);
});

test("le bloc de faits n'invente aucun champ absent", () => {
  const b = blocFaits({ nom: "Association Y" });
  assert.match(b, /Commune : inconnue/);
  assert.match(b, /Type : indéterminé/);
  assert.ok(!/undefined|null|NaN/.test(b), "aucune valeur technique ne doit fuir dans l'invite");
});

test("le bloc de faits reprend les chiffres réels, sans les arrondir", () => {
  const b = blocFaits({ nom: "X", ville: "Lille", faits: { evenements_a_venir: 22, evenements_total: 57 } });
  assert.match(b, /à venir relevés par Autour : 22/);
  assert.match(b, /au total : 57/);
});

/* ---------------------------------------------------------------------------
   LA SORTIE MAL FORMÉE NE DOIT PAS PASSER POUR UN SUCCÈS
--------------------------------------------------------------------------- */
test("un objet et un message sont extraits quand le format est respecté", () => {
  const d = decouperRedaction("OBJET: Une question\nMESSAGE:\nBonjour,\n\nÀ bientôt.");
  assert.equal(d.objet, "Une question");
  assert.match(d.message, /^Bonjour,/);
});

test("sans marqueur OBJET, l'objet est nul plutôt qu'inventé", () => {
  const d = decouperRedaction("Bonjour, voici un texte sans format.");
  assert.equal(d.objet, null);
  assert.match(d.message, /^Bonjour/);
});
