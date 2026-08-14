/* ===========================================================================
   Ce que la configuration Supabase dit VRAIMENT

   POURQUOI CE SCRIPT

   Six des réglages dont dépend la connexion par e-mail ne vivent pas dans la
   base : ils vivent dans la configuration du service d'authentification et
   dans les gabarits de courrier. Aucune migration ne les décrit, aucun test
   SQL ne les atteint. Ils se lisent par l'API d'administration, et il faut un
   jeton personnel pour ça.

   Le résultat n'est pas une opinion : c'est ce que le projet répond.

   ---------------------------------------------------------------------------
   UTILISATION

     export SUPABASE_ACCESS_TOKEN="sbp_…"        # Account › Access Tokens
     export AUTOUR_PROJET="sxnzyvcgwbwnpjnqmpkp"
     node outils/audit-auth.mjs

   Le jeton ne quitte pas la machine et n'est écrit nulle part. Il donne accès
   à toute l'organisation : révoquez-le après usage si vous l'avez créé pour
   l'occasion.

   Ce script ne CHANGE rien. Il lit, il compare à ce dont Autour a besoin, et
   il dit quoi corriger et où.
   ======================================================================== */

const JETON  = process.env.SUPABASE_ACCESS_TOKEN || "";
const PROJET = process.env.AUTOUR_PROJET || "sxnzyvcgwbwnpjnqmpkp";
const SITE   = process.env.AUTOUR_SITE || "https://autour.eu";

if (!JETON) {
  console.error("SUPABASE_ACCESS_TOKEN est obligatoire (Dashboard › Account › Access Tokens).");
  process.exit(2);
}

const resultats = [];
const ok = (nom, condition, detail = "") => {
  resultats.push({ nom, ok: !!condition, detail });
  console.log((condition ? "  ok    " : "À FAIRE ") + nom +
    (condition || !detail ? "" : "\n          → " + detail));
};

async function lire(chemin) {
  const rep = await fetch("https://api.supabase.com/v1/projects/" + PROJET + chemin, {
    headers: { Authorization: "Bearer " + JETON },
  });
  if (!rep.ok) throw new Error("HTTP " + rep.status + " sur " + chemin + " : " + await rep.text());
  return rep.json();
}

const cfg = await lire("/config/auth");

/* ======================================================================== */
console.log("\n──── 1. Les comptes anonymes ────");
/* Autour n'en crée plus. Mais 195 existent, et la seule façon de leur rendre
   leurs publications est de RATTACHER une adresse à leur session — ce qui
   suppose de pouvoir encore en ouvrir une le temps de la migration. */
{
  const anonymes = cfg.external_anonymous_users_enabled;
  console.log("          connexions anonymes : " + (anonymes ? "activées" : "désactivées"));
  if (anonymes) {
    console.log("          → Autour n'en crée plus. Ne les coupez qu'APRÈS avoir vu");
    console.log("            passer « MÊME UID » dans outils/auth-reel.mjs.");
  } else {
    console.log("          → coupées. Les 195 anciennes sessions ne peuvent plus se");
    console.log("            rouvrir : leurs publications restent lisibles mais");
    console.log("            deviennent non réclamables. À vérifier si c'est voulu.");
  }
  ok("l'état des connexions anonymes est connu", true);
}

/* ======================================================================== */
console.log("\n──── 2. La connexion par e-mail ────");
{
  ok("l'authentification par e-mail est activée",
     cfg.external_email_enabled !== false,
     "Authentication › Sign In / Providers › Email");

  /* `mailer_autoconfirm` confirme les adresses SANS envoyer de courrier. En
     développement c'est commode ; en production ça veut dire que n'importe qui
     ouvre un compte avec l'adresse de quelqu'un d'autre. */
  ok("les adresses ne sont PAS confirmées automatiquement",
     !cfg.mailer_autoconfirm,
     "mailer_autoconfirm=true — Authentication › Sign In / Providers › Email › " +
     "« Confirm email » doit être activé");

  ok("les inscriptions sont ouvertes", !cfg.disable_signup,
     "Authentication › Sign In / Providers › « Allow new users to sign up »");

  const duree = cfg.mailer_otp_exp;
  console.log("          durée de validité du code : " + duree + " s (" +
    Math.round(duree / 60) + " min)");
  ok("le code reste valable assez longtemps pour être recopié", duree >= 300,
     "moins de 5 minutes : quelqu'un qui ouvre sa boîte sur un autre appareil " +
     "n'aura pas le temps");
}

/* ======================================================================== */
console.log("\n──── 3. Manual Linking ────");
{
  /* CE QUE MANUAL LINKING GOUVERNE, ET CE QU'IL NE GOUVERNE PAS.

     Il gouverne `linkIdentity()` / `unlinkIdentity()` : rattacher une identité
     SUPPLÉMENTAIRE (Google, GitHub…) à un compte déjà ouvert.

     Autour n'utilise pas ces fonctions. Il convertit une session anonyme par
     `updateUser({ email })`, qui passe par un autre point d'entrée. Ce réglage
     ne devrait donc rien changer pour ce flux — mais c'est `auth-reel.mjs` qui
     tranche, en appelant vraiment le service : si le rattachement échoue avec
     « Manual linking is disabled », c'est ici qu'il faut agir. */
  const manuel = cfg.security_manual_linking_enabled;
  console.log("          manual linking : " + (manuel ? "activé" : "désactivé"));
  console.log("          Autour n'appelle ni linkIdentity ni unlinkIdentity :");
  console.log("          la conversion passe par updateUser({ email }).");
  console.log("          → si auth-reel.mjs échoue sur « rattacher une adresse »,");
  console.log("            activez-le : Authentication › Sign In / Providers ›");
  console.log("            Auth Providers › « Allow manual linking ».");
  ok("l'état de Manual Linking est connu", true);
}

/* ======================================================================== */
console.log("\n──── 4. Site URL et redirections ────");
{
  const site = cfg.site_url || "";
  ok("la Site URL est bien le domaine de production", site === SITE,
     "actuellement « " + site + " » — attendu « " + SITE + " ». " +
     "Authentication › URL Configuration › Site URL");

  const listes = String(cfg.uri_allow_list || "").split(",").map((u) => u.trim()).filter(Boolean);
  console.log("          redirections autorisées :");
  listes.forEach((u) => console.log("          · " + u));

  /* Autour envoie `location.origin + location.pathname`. Si cette origine
     n'est pas dans la liste, GoTrue renvoie SILENCIEUSEMENT sur la Site URL :
     le lien marche, mais il atterrit ailleurs et l'action mise en attente est
     perdue. C'est le genre de défaut qu'on ne voit qu'en production. */
  ok("le domaine de production est dans la liste des redirections",
     listes.some((u) => u === SITE || u === SITE + "/" || u === SITE + "/**"),
     "ajouter « " + SITE + "/** » dans Authentication › URL Configuration › " +
     "Redirect URLs");

  const vercel = listes.filter((u) => /vercel\.app/.test(u));
  ok("aucune ancienne URL Vercel ne sert de redirection de production",
     !/vercel\.app/.test(site),
     "la Site URL pointe sur " + site);
  if (vercel.length) {
    console.log("          → " + vercel.length + " URL(s) Vercel dans la liste.");
    console.log("            Gardez-les seulement si vous testez vraiment les");
    console.log("            déploiements de prévisualisation ; sinon retirez-les.");
  }
}

/* ======================================================================== */
console.log("\n──── 5. Les gabarits de courrier ────");
{
  /* L'écran d'Autour propose DEUX chemins : le lien, et un code à six
     chiffres. Le code n'existe dans le courrier que si le gabarit contient
     {{ .Token }} — sinon le champ est là, et il refuse tout. */
  const gabarits = [
    ["magic_link", "mailer_templates_magic_link_content",
     "Magic Link — connexion d'un nouveau compte"],
    ["email_change", "mailer_templates_email_change_content",
     "Change Email Address — rattachement d'un ancien compte anonyme"],
    ["confirmation", "mailer_templates_confirmation_content",
     "Confirm signup"],
  ];

  for (const [, champ, titre] of gabarits) {
    const corps = cfg[champ];
    if (corps == null) {
      console.log("          « " + titre + " » : gabarit par défaut");
      console.log("            → le défaut ne contient QUE le lien, pas {{ .Token }}.");
      ok("« " + titre + " » porte le code à six chiffres", false,
         "Authentication › Emails › " + titre + " : ajouter {{ .Token }}");
      continue;
    }
    ok("« " + titre + " » porte le code à six chiffres",
       corps.includes("{{ .Token }}"),
       "Authentication › Emails › " + titre + " : ajouter {{ .Token }}");
    ok("« " + titre + " » porte aussi le lien",
       corps.includes("{{ .ConfirmationURL }}") || corps.includes("{{ .TokenHash }}"),
       "le lien est le chemin principal : il doit rester");
  }
}

/* ======================================================================== */
console.log("\n──── 6. SMTP ────");
{
  const smtp = await lire("/config/auth").then((c) => ({
    hote: c.smtp_host, exp: c.smtp_admin_email, port: c.smtp_port, user: c.smtp_user,
  }));

  const personnalise = !!smtp.hote;
  /* Sans SMTP personnalisé, Supabase utilise son service de démonstration :
     quelques courriers par heure, et UNIQUEMENT vers les adresses des membres
     du projet. Un vrai utilisateur ne recevrait jamais rien — et ne verrait
     aucune erreur, juste un e-mail qui n'arrive pas. */
  ok("un SMTP de production est configuré", personnalise,
     "sans lui, Supabase n'envoie qu'aux membres du projet, à quelques " +
     "courriers par heure. Authentication › Emails › SMTP Settings");

  if (personnalise) {
    console.log("          hôte : " + smtp.hote + ":" + smtp.port);
    console.log("          expéditeur : " + smtp.exp);
    ok("l'expéditeur est sur le domaine du service",
       String(smtp.exp || "").endsWith("@" + SITE.replace(/^https?:\/\//, "")),
       "un expéditeur hors domaine part souvent en indésirable");
  }
}

/* ======================================================================== */
const passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + resultats.length + " réglages conformes");
const restes = resultats.filter((r) => !r.ok);
if (restes.length) {
  console.log("\nÀ régler dans le Dashboard :");
  restes.forEach((r) => console.log("  · " + r.nom + (r.detail ? "\n    " + r.detail : "")));
}
process.exit(restes.length ? 1 : 0);
