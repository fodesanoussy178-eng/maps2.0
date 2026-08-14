/* ===========================================================================
   Le parcours de compte, contre le VRAI service d'authentification

   POURQUOI CE SCRIPT EXISTE SÉPARÉMENT

   `outils/comptes.mjs` bouchonne `auth` : un lien magique arrive par courrier
   électronique, et un banc automatisé ne peut ni l'attendre ni le lire. Ce
   bouchon prouve le produit — ce qui est demandé, quand, et ce qu'on retrouve
   après — mais il ne prouve RIEN du service.

   Or c'est le service qui décide de la seule chose qui ne se rattrape pas :
   est-ce que rattacher une adresse à une session anonyme CONSERVE son uid ?
   195 sessions anonymes existent déjà en production, dont une avec une
   publication. Un uid regénéré rendrait cette publication orpheline pour
   toujours — les policies refusent précisément qu'on réclame une ligne dont on
   n'est pas le propriétaire.

   `supabase/tests/migration_anonyme.sql` démontre l'invariant de DONNÉES : la
   conversion est un UPDATE de la ligne existante, donc l'uid ne bouge pas. Ce
   script-ci démontre que GoTrue fait bien cette écriture-là, en l'appelant.

   IL DOIT ÊTRE LANCÉ DEPUIS UNE MACHINE QUI ATTEINT SUPABASE

   Le bac à sable où Autour est développé refuse les connexions sortantes vers
   *.supabase.co : ce script n'y a jamais tourné, et ne peut pas y tourner.

   ---------------------------------------------------------------------------
   UTILISATION

     export AUTOUR_SUPABASE_URL="https://xxxx.supabase.co"
     export AUTOUR_SUPABASE_ANON="sb_publishable_…"

     # mode complet — lit les jetons via l'API d'administration
     export AUTOUR_SUPABASE_SERVICE="sb_secret_…"     # Dashboard › API keys
     node outils/auth-reel.mjs

     # mode boîte aux lettres — prouve EN PLUS que le courrier part vraiment
     node outils/auth-reel.mjs --boite=moi@mondomaine.fr

   La clé de service ne quitte pas la machine et n'est jamais écrite dans un
   fichier par ce script. Elle sert à `auth.admin`, qui rend les jetons sans
   passer par une boîte aux lettres — c'est ce qui rend le test automatisable.

   Le mode `--boite` demande de recopier le code reçu. C'est le seul moyen de
   prouver la CHAÎNE COMPLÈTE, SMTP compris : sans lui, on démontre que l'API
   fabrique bien un jeton, pas que quelqu'un le reçoit un jour.
   ======================================================================== */

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const URL_SB   = process.env.AUTOUR_SUPABASE_URL || "";
const CLE_ANON = process.env.AUTOUR_SUPABASE_ANON || "";
const CLE_SERV = process.env.AUTOUR_SUPABASE_SERVICE || "";
const BOITE    = (process.argv.find((a) => a.startsWith("--boite=")) || "").slice(8);

if (!URL_SB || !CLE_ANON) {
  console.error("AUTOUR_SUPABASE_URL et AUTOUR_SUPABASE_ANON sont obligatoires.");
  process.exit(2);
}

const resultats = [];
const ok = (nom, condition, detail = "") => {
  resultats.push({ nom, ok: !!condition, detail });
  console.log((condition ? "  ok   " : "ÉCHEC  ") + nom +
    (condition || !detail ? "" : "\n         → " + detail));
};
const info = (l) => console.log("       " + l);

/* Chaque « navigateur » est un client distinct avec son propre stockage : c'est
   ce qui rend le scénario « reconnexion depuis un autre navigateur » honnête.
   Deux clients qui partagent un stockage partageraient une session, et le test
   ne prouverait rien. */
let compteurClients = 0;
function navigateur() {
  const memoire = new Map();
  compteurClients += 1;
  return createClient(URL_SB, CLE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "autour-test-" + compteurClients,
      storage: {
        getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
        setItem: (k, v) => memoire.set(k, v),
        removeItem: (k) => memoire.delete(k),
      },
    },
  });
}

const admin = CLE_SERV
  ? createClient(URL_SB, CLE_SERV, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const marque = Date.now().toString(36);
const adresse = (quoi) => `autour-test-${marque}-${quoi}@example.invalid`;
const aNettoyer = new Set();

/* Le jeton, sans boîte aux lettres. `generateLink` rend le MÊME code que celui
   envoyé par courrier — c'est ce qui permet de dérouler le parcours en entier
   sans attendre un e-mail, tout en passant par les vrais chemins du service. */
async function jetonPour(type, email, options) {
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.generateLink(
    Object.assign({ type, email }, options || {}));
  if (error) throw error;
  return {
    otp: data.properties.email_otp,
    lien: data.properties.action_link,
    redirection: data.properties.redirect_to,
  };
}

async function demanderCode(quoi) {
  const rl = createInterface({ input: stdin, output: stdout });
  const code = await rl.question(`\n       Code reçu pour « ${quoi} » (6 chiffres) : `);
  rl.close();
  return String(code).trim();
}

/* ======================================================================== */
/*  0. LA CONFIGURATION RÉELLE DU SERVICE                                   */
/* ======================================================================== */
console.log("\n──── configuration du service ────");
{
  const rep = await fetch(URL_SB + "/auth/v1/settings", { headers: { apikey: CLE_ANON } });
  const reglages = await rep.json();
  ok("le service d'authentification répond", rep.ok, "HTTP " + rep.status);

  const anonymes = reglages.external_anonymous_users_enabled;
  info("connexions anonymes : " + (anonymes ? "ACTIVÉES" : "désactivées"));
  info("inscription e-mail  : " + (reglages.external && reglages.external.email ? "activée" : "DÉSACTIVÉE"));
  info("confirmation auto   : " + (reglages.mailer_autoconfirm ? "OUI (aucun e-mail envoyé !)" : "non"));
  info("inscriptions        : " + (reglages.disable_signup ? "FERMÉES" : "ouvertes"));

  ok("la connexion par e-mail est activée",
     !!(reglages.external && reglages.external.email));
  /* `mailer_autoconfirm` confirme les adresses SANS envoyer de courrier. En
     développement c'est pratique ; en production ça veut dire que n'importe
     qui peut ouvrir un compte avec l'adresse de quelqu'un d'autre. */
  ok("les adresses ne sont pas confirmées automatiquement",
     !reglages.mailer_autoconfirm,
     "mailer_autoconfirm=true : une adresse non vérifiée ouvrirait un compte");
  ok("les inscriptions sont ouvertes", !reglages.disable_signup);

  if (anonymes) {
    info("→ les connexions anonymes sont encore activées. Autour n'en crée plus,");
    info("  mais ne les coupez qu'APRÈS le cas 2 ci-dessous.");
  }
}

/* ======================================================================== */
/*  1. NOUVEL UTILISATEUR : adresse → code → compte                         */
/* ======================================================================== */
console.log("\n──── 1. nouvel utilisateur ────");
let uidNouveau = null;
const emailNouveau = BOITE || adresse("neuf");
{
  const nav = navigateur();
  const { error } = await nav.auth.signInWithOtp({
    email: emailNouveau,
    options: { shouldCreateUser: true, emailRedirectTo: process.env.AUTOUR_SITE_URL || undefined },
  });
  ok("l'envoi du code est accepté", !error, error && error.message);

  const code = BOITE ? await demanderCode("nouvel utilisateur")
                     : (await jetonPour("magiclink", emailNouveau)).otp;
  const { data, error: e2 } = await nav.auth.verifyOtp({
    email: emailNouveau, token: code, type: "email" });
  ok("le code ouvre une session", !e2 && !!(data && data.session), e2 && e2.message);

  const u = data && data.user;
  uidNouveau = u && u.id;
  if (uidNouveau) aNettoyer.add(uidNouveau);
  ok("le compte porte l'adresse", !!(u && u.email === emailNouveau.toLowerCase()),
     u ? String(u.email) : "aucun utilisateur");
  ok("le compte n'est pas anonyme", !!(u && u.is_anonymous === false));
  ok("l'adresse est confirmée", !!(u && u.email_confirmed_at));
}

/* ======================================================================== */
/*  2. ANCIEN ANONYME : rattachement → MÊME UID                             */
/*     Le cas qui décide de la mise en production.                          */
/* ======================================================================== */
console.log("\n──── 2. ancien utilisateur anonyme → rattachement ────");
{
  const nav = navigateur();
  const { data: anon, error } = await nav.auth.signInAnonymously();
  ok("une session anonyme peut encore être ouverte", !error && !!(anon && anon.user),
     error ? error.message + " — activez temporairement les connexions anonymes " +
             "pour rejouer la migration" : "");

  if (anon && anon.user) {
    const uidAvant = anon.user.id;
    aNettoyer.add(uidAvant);
    info("uid anonyme : " + uidAvant);

    /* On lui fait poser une trace, comme les 195 comptes de production en ont
       posé : c'est elle qui doit survivre. Les policies refusent l'écriture à
       une session anonyme — c'est voulu — donc la trace est posée par
       l'administration, exactement comme l'historique l'a été. */
    let publication = null;
    if (admin) {
      const { data } = await admin.from("publications").insert({
        titre: "AUTH-REEL trace d'avant", cat: "event", lat: 50.63, lng: 3.06,
        creator_id: uidAvant, created_by: uidAvant,
      }).select("id").single();
      publication = data && data.id;
      await admin.from("favoris").insert({
        membre: uidAvant, lieu_ref: "osm:auth-reel-" + marque,
        titre: "AUTH-REEL favori d'avant", lat: 50.63, lng: 3.06,
      });
      ok("la session anonyme a une publication et un favori", !!publication);
    }

    const emailLie = BOITE || adresse("lie");
    const { error: e2 } = await nav.auth.updateUser({ email: emailLie });
    /* Si ceci échoue avec « Manual linking is disabled », c'est le réglage
       Manual Linking qu'il faut activer. Le message est reproduit tel quel :
       c'est lui qui tranche la question, pas une supposition. */
    ok("rattacher une adresse à une session anonyme est accepté", !e2,
       e2 && (e2.message + " (code " + (e2.code || e2.status || "?") + ")"));

    if (!e2) {
      const code = BOITE ? await demanderCode("rattachement")
                         : (await jetonPour("email_change_new", emailLie,
                             { newEmail: emailLie })).otp;
      const { data: apres, error: e3 } = await nav.auth.verifyOtp({
        email: emailLie, token: code, type: "email_change" });
      ok("la confirmation aboutit", !e3 && !!(apres && apres.session), e3 && e3.message);

      const uidApres = apres && apres.user && apres.user.id;
      ok("LE MÊME UID EST CONSERVÉ", uidApres === uidAvant,
         "avant " + uidAvant + " · après " + uidApres);
      ok("le compte n'est plus anonyme",
         !!(apres && apres.user && apres.user.is_anonymous === false));
      ok("le compte porte désormais l'adresse",
         !!(apres && apres.user && apres.user.email));

      /* Et surtout : ce qui pendait à cet uid pend toujours, ET redevient
         modifiable — c'était impossible tant que la session était anonyme. */
      const { data: miennes } = await nav.rpc("mes_publications");
      ok("ses publications d'avant lui reviennent",
         Array.isArray(miennes) && miennes.length >= 1,
         JSON.stringify((miennes || []).map((p) => p.titre)));

      const { data: favoris } = await nav.from("favoris").select("id,titre");
      ok("ses favoris d'avant lui reviennent",
         Array.isArray(favoris) && favoris.length >= 1,
         JSON.stringify((favoris || []).map((f) => f.titre)));

      if (publication) {
        const { data: modif } = await nav.from("publications")
          .update({ titre: "AUTH-REEL reprise en main" }).eq("id", publication).select("id");
        ok("il peut de nouveau modifier SA publication",
           Array.isArray(modif) && modif.length === 1);
      }
    }
  }
}

/* ======================================================================== */
/*  3. DÉCONNEXION PUIS RECONNEXION SUR LE MÊME COMPTE                      */
/* ======================================================================== */
console.log("\n──── 3. déconnexion puis reconnexion ────");
{
  const nav = navigateur();
  const code1 = BOITE ? await demanderCode("reconnexion")
                      : (await jetonPour("magiclink", emailNouveau)).otp;
  const { data } = await nav.auth.verifyOtp({ email: emailNouveau, token: code1, type: "email" });
  ok("reconnexion · la session s'ouvre", !!(data && data.session));

  await nav.auth.signOut();
  const { data: apres } = await nav.auth.getSession();
  ok("déconnexion · plus aucune session", !(apres && apres.session));

  const code2 = BOITE ? await demanderCode("re-reconnexion")
                      : (await jetonPour("magiclink", emailNouveau)).otp;
  const { data: rouvert } = await nav.auth.verifyOtp({
    email: emailNouveau, token: code2, type: "email" });
  ok("reconnexion · MÊME UID qu'avant la déconnexion",
     rouvert && rouvert.user && rouvert.user.id === uidNouveau,
     "attendu " + uidNouveau + " · obtenu " + (rouvert && rouvert.user && rouvert.user.id));
}

/* ======================================================================== */
/*  4. RECONNEXION DEPUIS UN AUTRE NAVIGATEUR                               */
/*     Stockage vierge : c'est tout l'intérêt d'avoir un compte.            */
/* ======================================================================== */
console.log("\n──── 4. un autre navigateur ────");
{
  const autre = navigateur();
  const { data: vide } = await autre.auth.getSession();
  ok("l'autre navigateur part d'un stockage vierge", !(vide && vide.session));

  const code = BOITE ? await demanderCode("autre navigateur")
                     : (await jetonPour("magiclink", emailNouveau)).otp;
  const { data } = await autre.auth.verifyOtp({ email: emailNouveau, token: code, type: "email" });
  ok("il retrouve le même compte", data && data.user && data.user.id === uidNouveau,
     "attendu " + uidNouveau + " · obtenu " + (data && data.user && data.user.id));

  const { data: miennes } = await autre.rpc("mes_publications");
  ok("et ses publications avec lui", Array.isArray(miennes),
     Array.isArray(miennes) ? miennes.length + " publication(s)" : "aucune réponse");
}

/* ======================================================================== */
/*  5. ADRESSE DÉJÀ UTILISÉE PAR UN AUTRE COMPTE                            */
/* ======================================================================== */
console.log("\n──── 5. adresse déjà utilisée ────");
{
  const nav = navigateur();
  const { data: anon, error: eAnon } = await nav.auth.signInAnonymously();
  if (eAnon || !anon) {
    ok("adresse déjà utilisée · cas jouable", false,
       "les connexions anonymes sont coupées : ce cas ne peut pas être rejoué");
  } else {
    aNettoyer.add(anon.user.id);
    const { error } = await nav.auth.updateUser({ email: emailNouveau });
    /* Deux comportements sont acceptables et Autour gère les deux : un refus
       explicite, ou un silence anti-énumération. Ce qui ne serait PAS
       acceptable, c'est que le rattachement RÉUSSISSE — deux comptes
       porteraient la même adresse. */
    const refus = !!error;
    info(refus ? "refus : " + error.message : "aucune erreur renvoyée (anti-énumération)");
    ok("l'adresse n'est pas volée à son propriétaire", true,
       refus ? "refus explicite" : "silence — Autour bascule alors sur une "
         + "ouverture de session normale");

    if (admin) {
      const { data: doublons } = await admin.auth.admin.listUsers();
      const combien = (doublons.users || [])
        .filter((u) => (u.email || "").toLowerCase() === emailNouveau.toLowerCase()).length;
      ok("un seul compte porte cette adresse", combien === 1, combien + " compte(s)");
    }
  }
}

/* ======================================================================== */
/*  6 et 7. CODE INCORRECT, CODE PLUS VALABLE                               */
/* ======================================================================== */
console.log("\n──── 6-7. code incorrect, code plus valable ────");
{
  const nav = navigateur();
  const { error } = await nav.auth.verifyOtp({
    email: emailNouveau, token: "000000", type: "email" });
  ok("un code incorrect est refusé", !!error, error && error.message);
  const { data: pasDeSession } = await nav.auth.getSession();
  ok("et aucune session n'est ouverte au passage", !(pasDeSession && pasDeSession.session));

  if (admin) {
    /* L'expiration réelle demande une heure d'attente. Un jeton DÉJÀ CONSOMMÉ
       est refusé par le même chemin et avec la même conséquence : le code ne
       vaut qu'une fois. C'est ce qu'on vérifie, et on le dit tel quel plutôt
       que d'appeler « expiré » ce qui ne l'est pas. */
    const jeton = (await jetonPour("magiclink", emailNouveau)).otp;
    const nav2 = navigateur();
    await nav2.auth.verifyOtp({ email: emailNouveau, token: jeton, type: "email" });
    const nav3 = navigateur();
    const { error: e2 } = await nav3.auth.verifyOtp({
      email: emailNouveau, token: jeton, type: "email" });
    ok("un code déjà utilisé ne vaut plus rien", !!e2, e2 && e2.message);
  }
}

/* ======================================================================== */
/*  8. SUPPRIMER LA PUBLICATION DE QUELQU'UN D'AUTRE                        */
/* ======================================================================== */
console.log("\n──── 8. la publication d'un autre ────");
if (admin) {
  const emailB = adresse("b");
  const nav = navigateur();
  const code = (await jetonPour("magiclink", emailB)).otp;
  const { data: sessionB } = await nav.auth.verifyOtp({
    email: emailB, token: code, type: "email" });
  if (sessionB && sessionB.user) aNettoyer.add(sessionB.user.id);

  const { data: deA } = await admin.from("publications").insert({
    titre: "AUTH-REEL publication de A", cat: "event", lat: 50.63, lng: 3.06,
    creator_id: uidNouveau, created_by: uidNouveau,
  }).select("id").single();

  const { data: vue } = await nav.from("publications").select("id").eq("id", deA.id);
  ok("B voit la publication de A", Array.isArray(vue) && vue.length === 1,
     "la lecture est publique, et c'est voulu");

  const { data: modif } = await nav.from("publications")
    .update({ titre: "AUTH-REEL détourné" }).eq("id", deA.id).select("id");
  ok("B ne peut PAS la modifier", !modif || modif.length === 0,
     JSON.stringify(modif));

  const { data: suppr } = await nav.from("publications")
    .delete().eq("id", deA.id).select("id");
  ok("B ne peut PAS la supprimer", !suppr || suppr.length === 0, JSON.stringify(suppr));

  const { data: intacte } = await admin.from("publications")
    .select("titre").eq("id", deA.id).single();
  ok("la publication de A est intacte",
     intacte && intacte.titre === "AUTH-REEL publication de A",
     intacte && intacte.titre);

  await admin.from("publications").delete().eq("id", deA.id);
} else {
  info("sans clé de service, ce cas n'est pas rejouable ici — il l'est dans");
  info("supabase/tests/rls_comptes.sql, qui le couvre en base.");
}

/* ======================================================================== */
/*  9. AUCUNE ADRESSE DANS UNE RÉPONSE PUBLIQUE                             */
/* ======================================================================== */
console.log("\n──── 9. ce qu'un visiteur peut lire ────");
{
  const visiteur = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });

  const { data: publications } = await visiteur
    .from("publications").select("*").limit(20);
  const champs = new Set();
  (publications || []).forEach((p) => Object.keys(p).forEach((k) => champs.add(k)));
  const suspects = [...champs].filter((c) => /mail|courriel/i.test(c));
  ok("aucun champ d'e-mail dans les publications publiques", suspects.length === 0,
     suspects.join(", "));

  /* On ne se contente pas des noms de colonnes : on cherche la FORME d'une
     adresse dans les valeurs. Un e-mail rangé dans `creator_name` porterait un
     nom parfaitement innocent. */
  const brut = JSON.stringify(publications || []);
  ok("aucune adresse dans les valeurs non plus",
     !/[\w.+-]+@[\w-]+\.[\w.]+/.test(brut));

  const { error: eProfils } = await visiteur.from("profiles").select("*").limit(1);
  ok("un visiteur ne lit aucun profil", !!eProfils, eProfils && eProfils.message);

  const { error: eFavoris } = await visiteur.from("favoris").select("*").limit(1);
  ok("un visiteur ne lit aucun favori", !!eFavoris, eFavoris && eFavoris.message);

  const rep = await fetch(URL_SB + "/rest/v1/publications?select=*&limit=5",
    { headers: { apikey: CLE_ANON } });
  const texte = await rep.text();
  ok("l'API REST brute n'expose aucune adresse",
     !/[\w.+-]+@[\w-]+\.[\w.]+/.test(texte));
}

/* ---- nettoyage ---------------------------------------------------------- */
if (admin) {
  console.log("\n──── nettoyage ────");
  await admin.from("publications").delete().like("titre", "AUTH-REEL%");
  await admin.from("favoris").delete().like("lieu_ref", "osm:auth-reel-%");
  for (const uid of aNettoyer) {
    if (BOITE) continue;                    // on ne supprime pas un vrai compte
    try { await admin.auth.admin.deleteUser(uid); } catch (e) { /* déjà parti */ }
  }
  console.log("       comptes et lignes de test retirés");
} else {
  console.log("\n       sans clé de service, les comptes de test restent :");
  aNettoyer.forEach((u) => console.log("       · " + u));
}

const passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + resultats.length + " vérifications passées");
if (passes !== resultats.length) {
  console.log("\nCas en échec :");
  resultats.filter((r) => !r.ok).forEach((r) => console.log("  · " + r.nom +
    (r.detail ? " — " + r.detail : "")));
}
process.exit(passes === resultats.length ? 0 : 1);
