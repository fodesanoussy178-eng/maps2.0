/* ===========================================================================
   Poser en production les e-mails d'authentification d'Autour

   POURQUOI CE SCRIPT

   Sur un projet HÉBERGÉ, `supabase/config.toml` ne décrit les gabarits d'e-mail
   que pour le développement local : il ne les pousse pas en production. Le
   Dashboard, lui, ne se lit pas depuis un fichier — c'est exactement le travers
   que `config.toml` existe pour combler. Ce script fait le pont : il lit les
   gabarits versionnés du dépôt et les applique au projet réel par l'API de
   gestion, pour que la production dise ce que le dépôt dit, et rien d'autre.

   Il ne touche QU'aux trois gabarits du flux e-mail d'Autour, et à leur sujet.
   Il ne règle ni le SMTP, ni Brevo, ni le DNS : rien de tout cela n'est ici.

   ---------------------------------------------------------------------------
   UTILISATION

     export SUPABASE_ACCESS_TOKEN="sbp_…"        # Account › Access Tokens
     export AUTOUR_PROJET="sxnzyvcgwbwnpjnqmpkp"
     node outils/appliquer-emails.mjs            # applique
     node outils/appliquer-emails.mjs --verifier # lit et compare, n'écrit rien

   Le jeton ne quitte pas la machine et n'est écrit nulle part. Révoquez-le
   après usage si vous l'avez créé pour l'occasion.
   ======================================================================== */

import { readFileSync } from "node:fs";

const JETON  = process.env.SUPABASE_ACCESS_TOKEN || "";
const PROJET = process.env.AUTOUR_PROJET || "sxnzyvcgwbwnpjnqmpkp";
const VERIFIER = process.argv.includes("--verifier");

if (!JETON) {
  console.error("SUPABASE_ACCESS_TOKEN est obligatoire (Dashboard › Account › Access Tokens).");
  process.exit(2);
}

const SUJET = "Ton code Autour";

/* Le nom court du gabarit → les deux champs de l'API de gestion, et le fichier
   du dépôt qui porte le contenu. Un seul endroit décrit cette correspondance,
   pour qu'ajouter un gabarit ne demande pas de la retrouver à trois endroits. */
const GABARITS = [
  { nom: "email_change", fichier: "email_change.html",
    champSujet: "mailer_subjects_email_change", champContenu: "mailer_templates_email_change_content" },
  { nom: "magic_link", fichier: "magic_link.html",
    champSujet: "mailer_subjects_magic_link", champContenu: "mailer_templates_magic_link_content" },
  { nom: "confirmation", fichier: "confirmation.html",
    champSujet: "mailer_subjects_confirmation", champContenu: "mailer_templates_confirmation_content" },
];

const contenuDe = (fichier) =>
  readFileSync(new URL("../supabase/templates/" + fichier, import.meta.url), "utf8");

async function api(methode, corps) {
  const rep = await fetch(
    "https://api.supabase.com/v1/projects/" + PROJET + "/config/auth",
    { method: methode,
      headers: { Authorization: "Bearer " + JETON, "Content-Type": "application/json" },
      body: corps ? JSON.stringify(corps) : undefined });
  if (!rep.ok) throw new Error("HTTP " + rep.status + " : " + await rep.text());
  return rep.json();
}

/* On lit d'abord : c'est le seul moyen honnête de dire ce qui a changé, et de
   ne rien écrire quand rien ne doit changer. */
const avant = await api("GET");

const charge = {};
const rapport = [];
for (const g of GABARITS) {
  const contenu = contenuDe(g.fichier);
  const sujetOk = avant[g.champSujet] === SUJET;
  const contenuOk = String(avant[g.champContenu] || "").includes("{{ .Token }}")
    && avant[g.champContenu] === contenu;
  rapport.push({ nom: g.nom, sujetOk, contenuOk });
  if (!sujetOk || !contenuOk) {
    charge[g.champSujet] = SUJET;
    charge[g.champContenu] = contenu;
  }
}

console.log("\n──── Gabarits d'authentification ────");
for (const r of rapport) {
  console.log((r.sujetOk && r.contenuOk ? "  déjà à jour " : "À APPLIQUER  ") + r.nom);
}

if (!Object.keys(charge).length) {
  console.log("\nLa production dit déjà ce que le dépôt dit. Rien à faire.");
  process.exit(0);
}

if (VERIFIER) {
  console.log("\n--verifier : " + (Object.keys(charge).length / 2) +
    " gabarit(s) diffèrent. Relancez sans --verifier pour appliquer.");
  process.exit(1);
}

await api("PATCH", charge);
console.log("\nAppliqué. Chaque e-mail porte maintenant « " + SUJET +
  " » et le code {{ .Token }}.");
console.log("Le code à six chiffres est le même que celui que `verifyOtp` vérifie :");
console.log("  · session anonyme  → e-mail email_change → verifyOtp(type:\"email_change\")");
console.log("  · sans session     → magic_link / confirmation → verifyOtp(type:\"email\")");
