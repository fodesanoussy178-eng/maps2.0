import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceApplicationSync } from "./source.mjs";

/* Node n'a pas de `sessionStorage`, et `comptes.js` doit continuer de marcher
   là où il n'y en a pas — Safari en navigation privée le refuse aussi. On en
   pose donc un minimal ici plutôt que d'assouplir le module pour les tests. */
globalThis.sessionStorage = (() => {
  const boite = new Map();
  return {
    getItem: (k) => (boite.has(k) ? boite.get(k) : null),
    setItem: (k, v) => { boite.set(k, String(v)); },
    removeItem: (k) => { boite.delete(k); },
  };
})();

await import("../comptes.js");

const C = globalThis.AutourComptes;
/* `index.html` ne porte plus le corps du programme : il vit dans `app.js`,
   pour que le navigateur puisse l'archiver au lieu de le retélécharger. La
   question posée ici — « la source contient-elle cette règle ? » — ne dépend
   pas du fichier où la règle est rangée. */
const lire = (f) => f === "index.html"
  ? sourceApplicationSync(import.meta.url)
  : readFileSync(new URL("../" + f, import.meta.url), "utf8");
const html = lire("index.html");
const migration = lire("supabase/migrations/20260814124936_comptes_email.sql");
const rls = lire("supabase/tests/rls_comptes.sql");

/* ==========================================================================
   1. LE COMPTE PROGRESSIF

   La règle tient en une phrase : ce qui se consulte est libre, ce qui
   s'approprie demande un compte. Un écran de connexion à l'ouverture est un
   péage — et quelqu'un qui cherche où dormir ce soir n'a pas à payer un
   péage.
   ======================================================================== */

test("tout ce qui se consulte reste accessible sans compte", () => {
  for (const action of ["ouvrir", "explorer", "voir", "rechercher",
                        "aide", "urgence", "consulter", "itineraire"]) {
    assert.equal(C.exigeCompte(action), false, action + " ne doit rien demander");
    assert.equal(C.peut(C.VISITEUR, action), true, action + " : un visiteur doit pouvoir");
  }
});

test("l'urgence n'est jamais derrière un compte", () => {
  // le cas qui décide de tout : se tromper ici coûte plus qu'une friction
  assert.equal(C.exigeCompte("urgence"), false);
  assert.equal(C.peut(C.VISITEUR, "urgence"), true);
  assert.equal(C.peut(C.VISITEUR, "aide"), true);
});

test("ce qui s'approprie demande un compte, et rien d'autre n'en demande", () => {
  const attendu = ["publier", "favori", "notifications",
                   "mes-publications", "modifier", "supprimer"];
  assert.deepEqual([...C.AVEC_COMPTE].sort(), [...attendu].sort());
  for (const action of attendu) {
    assert.equal(C.peut(C.VISITEUR, action), false, action + " : un visiteur ne doit pas");
    assert.equal(C.peut(C.ANONYME, action), false, action + " : une session anonyme non plus");
    assert.equal(C.peut(C.CONNECTE, action), true, action + " : un compte, oui");
  }
});

test("une session anonyme n'est pas un compte", () => {
  /* C'est la confusion qui a coûté cher : « a une session » était lu comme
     « a un compte ». Une session anonyme vit dans le stockage d'un
     navigateur — elle ne survit pas à l'appareil. */
  assert.equal(C.etatDe(null), C.VISITEUR);
  assert.equal(C.etatDe({}), C.VISITEUR);
  assert.equal(C.etatDe({ user: { id: "u1", is_anonymous: true } }), C.ANONYME);
  assert.equal(C.etatDe({ user: { id: "u1" } }), C.ANONYME);       // ni e-mail ni drapeau
  assert.equal(C.etatDe({ user: { id: "u1", email: "a@b.fr" } }), C.CONNECTE);
});

/* ==========================================================================
   2. LES MOTS DE LA DEMANDE
   ======================================================================== */

test("chaque demande dit ce que le compte apporte, au moment où il l'apporte", () => {
  const p = C.invitation("publier");
  assert.equal(p.titre, "Une dernière étape");
  assert.equal(p.texte,
    "Entre ton e-mail pour publier et pouvoir modifier ou supprimer cet événement plus tard.");

  const f = C.invitation("favori");
  assert.equal(f.titre, "Retrouve tes favoris partout");
  assert.equal(f.texte, "Connecte-toi avec ton e-mail.");
});

test("aucune invitation ne parle de « créer un compte » ni de mot de passe", () => {
  for (const [id, inv] of Object.entries(C.INVITATIONS)) {
    const tout = (inv.titre + " " + inv.texte + " " + inv.bouton).toLowerCase();
    for (const interdit of ["créer un compte", "inscription", "s’inscrire", "s'inscrire",
                            "mot de passe", "identifiant"]) {
      assert.ok(!tout.includes(interdit), id + " ne doit pas dire « " + interdit + " »");
    }
    assert.ok(inv.titre.length > 3 && inv.texte.length > 10, id + " doit dire quelque chose");
  }
});

/* ==========================================================================
   3. L'ADRESSE E-MAIL, ET RIEN D'AUTRE
   ======================================================================== */

test("l'écran de compte ne demande qu'une adresse", () => {
  const ecran = html.slice(html.indexOf("function rendreEcranCompte"),
                           html.indexOf("function ouvrirProfil"));
  assert.match(ecran, /id="cptEmail"[\s\S]{0,80}type="email"|type="email"[\s\S]{0,80}id="cptEmail"/);
  for (const interdit of ['type="tel"', 'type="date"', "Prénom", "Nom de famille",
                          "Date de naissance", "Adresse postale", "Code postal",
                          "Mot de passe"]) {
    assert.ok(!ecran.includes(interdit), interdit + " ne doit jamais être demandé");
  }
});

test("une adresse manifestement incomplète est refusée avant l'envoi", () => {
  for (const bonne of ["toi@exemple.fr", "  Toi@Exemple.FR ", "a.b+c@sous.domaine.org"]) {
    assert.equal(C.emailValide(bonne), true, bonne);
  }
  for (const mauvaise of ["", "toi", "toi@", "@exemple.fr", "toi@exemple",
                          "toi exemple.fr", "toi@@exemple.fr"]) {
    assert.equal(C.emailValide(mauvaise), false, JSON.stringify(mauvaise));
  }
});

test("l'adresse est normalisée pour être comparée, jamais pour être affichée", () => {
  assert.equal(C.normaliserEmail("  Toi@Exemple.FR "), "toi@exemple.fr");
});

test("le code de vérification fait six chiffres", () => {
  assert.equal(C.codeValide("123456"), true);
  assert.equal(C.codeValide(" 123456 "), true);
  for (const faux of ["12345", "1234567", "12345a", "", "abcdef"]) {
    assert.equal(C.codeValide(faux), false, JSON.stringify(faux));
  }
});

/* ==========================================================================
   4. L'ADRESSE RESTE PRIVÉE
   ======================================================================== */

test("aucune table publique ne porte d'adresse e-mail", () => {
  // la migration le vérifie elle-même, et échoue si quelqu'un en ajoute une
  assert.match(migration, /Une adresse e-mail est exposée dans le schéma public/);
  assert.match(migration, /attname ~\* '\(\^\|_\)\(e\?mail\|courriel\)\(\$\|_\)'/);
  // et `profiles` ne porte QUE le pseudo et la préférence de notifications
  const table = migration.slice(migration.indexOf("create table if not exists public.profiles"),
                                migration.indexOf("alter table public.profiles"));
  assert.ok(!/mail/i.test(table), "profiles ne doit porter aucune adresse");
  assert.match(table, /display_name\s+text/);
});

test("l'adresse ne s'affiche que sur son propre écran de profil", () => {
  // une seule apparition dans l'interface, et elle est dans le bloc Profil
  const occurrences = (html.match(/monEmail\(\)/g) || []).length;
  assert.equal(occurrences, 2, "monEmail() doit être défini une fois et lu une fois");
  const profil = html.slice(html.indexOf("async function ouvrirProfil"),
                            html.indexOf("async function ouvrirMesPublications"));
  assert.match(profil, /data-testid="profil-email"/);
  assert.match(profil, /Adresse e-mail <i>privée<\/i>/);
});

test("un pseudo est facultatif, et une adresse n'en tient jamais lieu", () => {
  assert.equal(C.nomAffiche(null), "Habitant du quartier");
  assert.equal(C.nomAffiche({ display_name: "" }), "Habitant du quartier");
  assert.equal(C.nomAffiche({ display_name: "  Alex " }), "Alex");
  // afficher « marie.dupont@… » montrerait un nom de famille au monde entier
  assert.equal(C.nomAffiche({ display_name: null }), "Habitant du quartier");
});

/* ==========================================================================
   5. REPRENDRE CE QUI ÉTAIT COMMENCÉ
   ======================================================================== */

test("l'action commencée est mise en attente puis reprise une seule fois", () => {
  C.oublierAttente();
  assert.equal(C.attenteEnCours(), null);

  C.mettreEnAttente("publier", { brouillon: "n1" });
  const vue = C.attenteEnCours();
  assert.equal(vue.action, "publier");
  assert.deepEqual(vue.charge, { brouillon: "n1" });

  const repris = C.reprendreAttente();
  assert.equal(repris.action, "publier");
  // reprendre deux fois publierait deux fois le même événement
  assert.equal(C.attenteEnCours(), null);
  assert.equal(C.reprendreAttente(), null);
});

test("une attente trop vieille est oubliée : l'intention a changé", () => {
  C.oublierAttente();
  const vieux = { action: "publier", charge: null, le: Date.now() - C.DELAI_ATTENTE_MS - 1000 };
  globalThis.sessionStorage.setItem(C.CLE_ATTENTE, JSON.stringify(vieux));
  assert.equal(C.attenteEnCours(), null);
});

test("une attente illisible ne fait pas tomber l'application", () => {
  globalThis.sessionStorage.setItem(C.CLE_ATTENTE, "{pas du json");
  assert.equal(C.attenteEnCours(), null);
});

test("l'attente survit au lien reçu par e-mail, qui fait quitter la page", () => {
  /* Un lien magique recharge le document : une variable JavaScript n'aurait
     pas survécu. sessionStorage meurt avec l'onglet — exactement la bonne
     durée de vie. */
  C.mettreEnAttente("favori", { cle: "osm:42" });
  const brut = globalThis.sessionStorage.getItem(C.CLE_ATTENTE);
  assert.ok(brut, "l'attente doit être écrite hors de la mémoire vive");
  assert.deepEqual(JSON.parse(brut).charge, { cle: "osm:42" });
  C.oublierAttente();
});

test("l'application rejoue chaque action mise en attente", () => {
  for (const action of C.AVEC_COMPTE) {
    assert.ok(html.includes('enregistrerReprise("' + action + '"'),
      action + " doit avoir une reprise : sinon on dépose la personne sur l'accueil");
  }
  assert.match(html, /function reprendreActionEnAttente/);
  // et la reprise est branchée sur Auth, donc valable pour le lien ET le code
  assert.match(html, /onAuthStateChange[\s\S]{0,600}reprendreActionEnAttente\(\)/);
});

/* ==========================================================================
   6. RATTACHER PLUTÔT QUE RECRÉER

   Une session anonyme qui reçoit une adresse GARDE son uid. C'est toute la
   migration : les publications et favoris déjà posés restent ceux de la
   personne, sans qu'aucune ligne ne soit réécrite.
   ======================================================================== */

test("une session anonyme se voit rattacher l'adresse, pas remplacer", () => {
  assert.deepEqual(C.manoeuvre(C.ANONYME), { methode: "lier", typeOtp: "email_change" });
  assert.deepEqual(C.manoeuvre(C.VISITEUR), { methode: "ouvrir", typeOtp: "email" });
  /* Le rattachement est le chemin par DÉFAUT quand une session anonyme
     existe : on n'ouvre une session neuve que si l'on n'a rien à conserver,
     ou si le rattachement a été refusé. */
  assert.match(html, /if\(plan\.methode !== "lier"\)[\s\S]{0,160}return await ouvrir\(\)/);
  assert.match(html, /updateUser\(\{ email:adresse \}\)/);
  assert.match(html, /signInWithOtp\(\{ email:adresse/);
});

test("plus aucune session anonyme n'est créée", () => {
  assert.doesNotMatch(html, /signInAnonymously/);
  assert.doesNotMatch(html, /assurerSessionAnonyme/);
});

/* ==========================================================================
   7. LA SÉCURITÉ N'EST PAS DANS CE JAVASCRIPT
   ======================================================================== */

test("la propriété est portée par auth.uid(), en base", () => {
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
  for (const verbe of ["insert", "update", "delete"]) {
    assert.ok(new RegExp("for " + verbe + "[\\s\\S]{0,400}private\\.compte_confirme\\(\\)")
      .test(migration), verbe + " doit exiger un compte confirmé");
  }
});

test("« connecté » ne suffit pas : le compte doit être confirmé, et la base le vérifie", () => {
  /* On ne lit pas le claim `is_anonymous` du jeton : sa présence dépend de la
     version du SDK qui l'a émis, et une règle d'autorisation ne doit pas
     dépendre de ce que le client a bien voulu y mettre. */
  assert.match(migration, /create or replace function private\.compte_confirme\(\)/);
  assert.match(migration, /from auth\.users u[\s\S]{0,200}is_anonymous, false\) is false/);
  assert.match(migration, /email_confirmed_at is not null/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function private\.compte_confirme\(\) from public, anon/);
});

test("la lecture publique n'est jamais refermée par cette passe", () => {
  assert.match(migration, /for select\s+to anon, authenticated\s+using \(true\)/);
  assert.match(migration, /grant select on public\.publications to anon, authenticated/);
});

test("un compte ne peut ni modifier ni supprimer la publication d'un autre", () => {
  // la preuve est exécutée en base ; ici on vérifie que le scénario existe
  for (const cas of ["compte B · modifier celle de A",
                     "compte B · supprimer celle de A",
                     "compte B · s''attribuer celle de A",
                     "compte B · lire les favoris de A",
                     "compte A · publier au nom de B",
                     "compte A · changer le pseudo de B"]) {
    assert.ok(rls.includes(cas), "le scénario « " + cas + " » doit être couvert");
  }
  assert.match(rls, /set local role authenticated/);
  assert.match(rls, /request\.jwt\.claims/);
});

test("le profil ne se lit et ne s'écrit que par son propriétaire", () => {
  assert.match(migration, /"profiles: lire le sien"[\s\S]{0,200}id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /"profiles: modifier le sien"[\s\S]{0,300}id = \(select auth\.uid\(\)\)/);
  // pas de policy DELETE : un profil disparaît avec son compte
  assert.ok(!/on public\.profiles for delete/.test(migration));
  // et `anon` n'a strictement rien
  assert.match(migration, /revoke all on public\.profiles from anon, authenticated/);
  assert.match(migration, /grant select, insert, update \(display_name, notifications\) on public\.profiles to authenticated/);
});

/* ==========================================================================
   8. L'INTERFACE : LA VALEUR AVANT LA DEMANDE
   ======================================================================== */

test("aucun écran de connexion ne s'impose à l'ouverture", () => {
  const demarrage = html.slice(html.indexOf("async function demarrer(coords)"),
                               html.indexOf("function demarrerSurZonePrecalculee"));
  assert.doesNotMatch(demarrage, /ouvrirEcranCompte|exigerCompte/);
  // l'écran de compte n'apparaît qu'en réponse à un geste
  assert.match(html, /async function exigerCompte\(action, charge\)/);
  assert.match(html, /if\(estConnecte\(\)\) return true;[\s\S]{0,200}ouvrirEcranCompte\(action\)/);
});

test("Profil montre ce qu'un compte apporte plutôt qu'un formulaire", () => {
  const profil = html.slice(html.indexOf("async function ouvrirProfil"),
                            html.indexOf("async function ouvrirMesPublications"));
  assert.match(profil, /data-testid="profil-visiteur"/);
  assert.match(profil, /publier un événement, et le modifier ensuite/);
  assert.match(profil, /retrouver tes favoris/);
});

test("Profil connecté porte les six entrées attendues", () => {
  const profil = html.slice(html.indexOf("async function ouvrirProfil"),
                            html.indexOf("async function ouvrirMesPublications"));
  assert.match(profil, /id="profPseudo"/);                 // pseudo
  assert.match(profil, /data-testid="profil-email"/);      // adresse e-mail
  assert.match(profil, /data-profil="publications"/);      // mes publications
  assert.match(profil, /data-profil="favoris"/);           // mes favoris
  assert.match(profil, /id="profNotifs"/);                 // notifications
  assert.match(profil, /id="profDeconnexion"/);            // se déconnecter
});

test("se déconnecter ne laisse pas les favoris de quelqu'un d'autre à l'écran", () => {
  /* Le corps de la fonction, pris pour lui-même : borner la coupe sur le nom
     de la fonction SUIVANTE supposait qu'elles restent voisines, ce qui a
     cessé d'être vrai quand les écrans de compte sont partis dans
     `differe/ecrans.js`. */
  const sortie = /async function seDeconnecter\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(sortie, /signOut\(\)/);
  assert.match(sortie, /favorisIds\.clear\(\)/);
  assert.match(sortie, /favorisEnMemoire\.clear\(\)/);
  assert.match(sortie, /oublierAttente\(\)/);
});

test("« Mes publications » demande au serveur ce qui est à moi", () => {
  // la clause de propriété vit en base : un select côté client peut être oublié
  assert.match(html, /sb\.rpc\("mes_publications"\)/);
  assert.match(migration, /create function public\.mes_publications\(\)/);
  assert.match(migration, /where p\.created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke all on function public\.mes_publications\(\) from public, anon/);
});

test("le module de comptes est chargé avant le code qui s'en sert", () => {
  const iComptes = html.indexOf('src="comptes.js?v=');
  assert.ok(iComptes > 0, "comptes.js doit être chargé par la page");
  assert.ok(iComptes < html.indexOf("const COMPTES = window.AutourComptes"),
    "le module doit précéder sa première lecture");
});

/* ==========================================================================
   9. L'ADRESSE DÉJÀ PRISE — LE CAS QUI BLOQUAIT TOUT

   Une session anonyme qui tente de rattacher une adresse appartenant déjà à
   quelqu'un d'autre se voit refuser le rattachement : deux comptes ne peuvent
   pas porter la même adresse, et l'index unique d'`auth.users` le garantit.

   Sans repli, la personne taperait l'adresse de SON PROPRE compte et
   n'arriverait jamais à s'y connecter — le rattachement échouait, et rien
   d'autre n'était tenté.
   ======================================================================== */

test("un refus « adresse déjà prise » est reconnu, quelle que soit sa forme", () => {
  // GoTrue le dit différemment selon sa version et son réglage anti-énumération
  assert.equal(C.adresseDejaPrise({ code: "email_exists" }), true);
  assert.equal(C.adresseDejaPrise({ code: "user_already_exists" }), true);
  assert.equal(C.adresseDejaPrise(
    { message: "A user with this email address has already been registered" }), true);
  assert.equal(C.adresseDejaPrise({ message: "Email address already in use" }), true);
  // et rien d'autre ne doit déclencher la bascule
  for (const autre of [{ message: "Token has expired or is invalid" },
                       { message: "For security purposes, you can only request this after 23 seconds" },
                       { code: "over_email_send_rate_limit" }, {}, null]) {
    assert.equal(C.adresseDejaPrise(autre), false, JSON.stringify(autre));
  }
});

test("Autour bascule vers une ouverture de session au lieu de laisser bloqué", () => {
  const envoi = html.slice(html.indexOf("async function envoyerLienCompte"),
                           html.indexOf("async function verifierCodeCompte"));
  assert.match(envoi, /adresseDejaPrise\(e\)/,
    "le refus doit être reconnu, pas affiché tel quel");
  assert.match(envoi, /bascule:"adresse-deja-prise"/);
  // et la bascule appelle bien l'autre chemin
  assert.match(envoi, /const ouvrir = async\(\)=>\{[\s\S]{0,300}signInWithOtp/);
});

/* ==========================================================================
   10. LA MIGRATION DES ANCIENS COMPTES ANONYMES

   195 sessions anonymes existent en production, dont une avec une
   publication. Un uid regénéré la rendrait orpheline pour toujours : les
   policies refusent précisément qu'on réclame une ligne dont on n'est pas le
   propriétaire.
   ======================================================================== */
const migrationAnonyme = lire("supabase/tests/migration_anonyme.sql");

test("le rattachement conserve l'uid, et c'est écrit comme tel", () => {
  // « lier » pour une session anonyme, « ouvrir » sinon : le choix décide de tout
  assert.deepEqual(C.manoeuvre(C.ANONYME), { methode: "lier", typeOtp: "email_change" });
  assert.match(html, /plan\.methode !== "lier"/);
  assert.match(html, /updateUser\(\{ email:adresse \}\)/);
});

test("la conservation de l'uid est démontrée en base, pas supposée", () => {
  for (const cas of ["décor · un anonyme n''a aucune identité",
                     "conversion · même auth.uid() avant et après",
                     "conversion · la publication d''avant est conservée",
                     "conversion · le favori d''avant est conservé",
                     "conversion · le profil suit le même uid",
                     "après conversion · il modifie de nouveau SA publication",
                     "adresse déjà utilisée · deux comptes la partagent"]) {
    assert.ok(migrationAnonyme.includes(cas), "cas manquant : " + cas);
  }
  // la conversion est un UPDATE de la ligne existante, jamais un INSERT
  assert.match(migrationAnonyme, /update auth\.users\s+set email = email_change/);
  assert.doesNotMatch(migrationAnonyme,
    /insert into auth\.users[\s\S]{0,400}email_change/,
    "la conversion ne doit jamais créer une seconde ligne");
});

test("un banc réel existe pour ce que le bouchon ne peut pas prouver", () => {
  const reel = lire("outils/auth-reel.mjs");
  // les neuf cas demandés
  for (const cas of ["nouvel utilisateur", "rattachement", "MÊME UID",
                     "déconnexion puis reconnexion", "un autre navigateur",
                     "adresse déjà utilisée", "code incorrect",
                     "code déjà utilisé", "la publication d'un autre",
                     "ce qu'un visiteur peut lire"]) {
    assert.ok(reel.includes(cas), "le banc réel doit couvrir : " + cas);
  }
  // il interroge la configuration réelle du service, il ne la suppose pas
  assert.match(reel, /auth\/v1\/settings/);
  assert.match(reel, /external_anonymous_users_enabled/);
  assert.match(reel, /mailer_autoconfirm/);
  // et il dit franchement qu'il n'a pas tourné dans le bac à sable
  assert.match(reel, /ne peut pas y tourner/);
});

/* ==========================================================================
   11. AUCUN COMPTE FANTÔME

   Explorer et Aide doivent tenir avec le seul rôle public. Une session
   anonyme créée « au cas où » fabrique un utilisateur Supabase par visiteur —
   195 en production, dont 194 n'ont jamais rien posé.
   ======================================================================== */

test("aucun chemin du code n'ouvre de session sans qu'on l'ait demandé", () => {
  assert.doesNotMatch(html, /signInAnonymously/);
  // les seules ouvertures de session sont dans la fonction d'envoi, appelée
  // depuis l'écran de compte, lui-même ouvert par `exigerCompte`
  const appels = [...html.matchAll(/sb\.auth\.(signInWithOtp|updateUser|verifyOtp)/g)];
  assert.equal(appels.length, 3, "trois appels attendus : " + appels.map((m) => m[1]).join(", "));
  const envoi = html.slice(html.indexOf("async function envoyerLienCompte"),
                           html.indexOf("async function seDeconnecter"));
  for (const m of ["signInWithOtp", "updateUser", "verifyOtp"]) {
    assert.ok(envoi.includes(m), m + " doit vivre dans le bloc de connexion");
  }
});

test("le démarrage ne touche jamais à l'authentification", () => {
  const debut = html.indexOf("async function connecter");
  const fin = html.indexOf("/* ==================================================================== */\n/*  Le compte", debut);
  const connecter = html.slice(debut, fin > 0 ? fin : debut + 2500);
  assert.doesNotMatch(connecter, /signIn|updateUser|verifyOtp/,
    "se connecter à Supabase n'est pas se connecter à un compte");
  // getSession lit ce qui existe déjà, elle ne crée rien
  assert.match(connecter, /sb\.auth\.getSession\(\)/);
});

test("la redirection du lien est explicite, jamais laissée au hasard", () => {
  /* Sans `emailRedirectTo`, GoTrue renvoie sur la Site URL du projet — donc
     potentiellement sur une ancienne URL de déploiement, et l'action mise en
     attente est perdue. */
  assert.match(html, /emailRedirectTo: location\.origin \+ location\.pathname/);
  const occurrences = (html.match(/emailRedirectTo/g) || []).length;
  assert.equal(occurrences, 1, "une seule redirection, pour n'en oublier aucune");
});

/* ==========================================================================
   12. RENVOYER LE CODE — UN OTP NEUF, DU MÊME TYPE, APRÈS UN DÉLAI

   Le flux e-mail n'avait aucun moyen de renvoyer un code : si le premier
   courrier n'arrivait pas, la seule issue était de tout recommencer. Ces tests
   fixent le renvoi, et surtout la propriété qui l'empêche de rejouer le bug de
   mélange : le renvoi passe par la MÊME fonction que l'envoi, donc par la même
   manœuvre, donc par le même type de jeton que celui qu'on vérifiera.
   ======================================================================== */

test("l'écran « code envoyé » propose de renvoyer le code", () => {
  const rendu = html.slice(html.indexOf("function rendreEcranCompte"),
                           html.indexOf("function ouvrirProfil"));
  assert.match(rendu, /id="cptRenvoyer"/, "un bouton de renvoi existe");
  /* Il ne s'affiche QUE sur l'écran d'après-envoi, aux côtés de « Valider ». */
  assert.match(rendu, /id="cptValider"[\s\S]{0,120}id="cptRenvoyer"/);
});

test("le renvoi régénère un jeton neuf, du même type — jamais un autre chemin", () => {
  const rendu = html.slice(html.indexOf("function rendreEcranCompte"),
                           html.indexOf("function ouvrirProfil"));
  const bloc = rendu.slice(rendu.indexOf('$("#cptRenvoyer")'),
                           rendu.indexOf('const autre ='));
  /* Le renvoi appelle la MÊME fonction d'envoi : c'est ce qui garantit qu'il
     repasse par updateUser/signInWithOtp selon la même manœuvre, et régénère
     un jeton du même type. */
  assert.match(bloc, /await envoyerLienCompte\(compteEnCours\.email\)/);
  assert.match(bloc, /compteEnCours\.typeOtp = r\.typeOtp/,
    "le type suit la manœuvre, comme au premier envoi");
  /* Il n'ouvre AUCUN second chemin d'authentification de son côté. */
  assert.doesNotMatch(bloc, /sb\.auth\.(signInWithOtp|updateUser|verifyOtp)/,
    "le renvoi ne parle jamais à sb.auth directement : il réutilise l'envoi");
});

test("le renvoi est bloqué une minute, avec un décompte visible", () => {
  assert.match(html, /const RENVOI_COMPTE_MS = 60000;/,
    "le délai raisonnable est une minute — la limite du serveur par adresse");
  const rendu = html.slice(html.indexOf("function rendreEcranCompte"),
                           html.indexOf("function ouvrirProfil"));
  /* La garde est réelle, pas seulement une apparence de bouton grisé. */
  assert.match(rendu, /if\(Date\.now\(\) < renvoiCompteAvant\) return;/);
  /* Le décompte descend en secondes, et le premier envoi arme déjà le délai —
     le serveur, lui, compte déjà cette minute. */
  assert.match(rendu, /Renvoyer dans "\+reste\+" s"/);
  assert.match(rendu, /renvoiCompteAvant = Date\.now\(\) \+ RENVOI_COMPTE_MS/);
});

test("l'écran d'après-envoi ne s'affiche qu'après un envoi réellement réussi", () => {
  const rendu = html.slice(html.indexOf('$("#cptEnvoyer")'),
                           html.indexOf('$("#cptRenvoyer")'));
  /* La règle qui manquait à l'analyse : un envoi qui échoue REVIENT au
     formulaire avec l'erreur ; il ne passe jamais `envoye = true`. */
  assert.match(rendu, /if\(!r\.ok\)\{ rendreEcranCompte\(r\.message\); return; \}/);
  assert.match(rendu, /compteEnCours\.envoye = true;\s*\n\s*compteEnCours\.typeOtp = r\.typeOtp;/,
    "envoye ne passe à true qu'APRÈS le contrôle de r.ok");
});

test("changer d'adresse arrête le décompte de l'ancienne", () => {
  const rendu = html.slice(html.indexOf("function rendreEcranCompte"),
                           html.indexOf("function ouvrirProfil"));
  const bloc = rendu.slice(rendu.indexOf('const autre ='));
  assert.match(bloc, /clearInterval\(renvoiCompteMinuteur\)/);
  assert.match(bloc, /renvoiCompteAvant = 0;/);
});
