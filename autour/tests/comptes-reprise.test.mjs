import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

/* Signalé depuis le terrain : « Connexion impossible pour le moment. » à
   l'écran de publication, et le bouton répond la même chose indéfiniment.

   Cause : le chargeur du SDK mémorisait sa promesse Y COMPRIS résolue à
   « non ». Le premier échec — pendant le démarrage, où il est sans gravité —
   condamnait toute la session. Mesuré au banc : les essais suivants
   répondaient « non » en ZÉRO milliseconde, sans qu'aucune requête ne parte,
   et le rétablissement du réseau n'y changeait rien. La seule issue était de
   recharger la page, et rien ne le disait.

   `outils/comptes-hors-ligne.mjs` rejoue la scène dans un vrai navigateur. */

test("un échec de chargement du SDK n'est jamais mémorisé", () => {
  assert.match(app, /if\(!disponible && pSupabase === promesse\) pSupabase = null;/,
    "l'échec doit être oublié pour que l'essai suivant reparte vraiment");
});

test("chaque tentative repart d'une balise neuve", () => {
  // une balise dont `onerror` a tiré est morte : la réutiliser ne redemande rien
  const bloc = /function chargerScriptSupabase\(src, attente\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /const el = document\.createElement\("script"\);/);
});

test("une tentative en vol reste partagée entre appels simultanés", () => {
  // sans ça, deux gestes rapprochés injecteraient deux fois 200 ko de SDK
  const bloc = /function chargerSupabase\(options\)\{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(bloc, /if\(pSupabase\) return pSupabase;/);
  assert.match(bloc, /if\(window\.supabase\) return Promise\.resolve\(true\);/);
});

test("la patience dépend de qui demande", () => {
  /* Au démarrage le SDK n'est pas sur le chemin critique et l'écran ne doit
     pas l'attendre ; quand c'est la personne qui a demandé quelque chose,
     revenir les mains vides lui coûte plus cher que d'attendre. */
  assert.match(app, /const SUPABASE_ATTENTE_DEMARRAGE = 4000;/);
  assert.match(app, /const SUPABASE_ATTENTE_DEMANDE = 12000;/);
  assert.match(app, /o\.demande \? SUPABASE_ATTENTE_DEMANDE : SUPABASE_ATTENTE_DEMARRAGE/);
  // les deux gestes de compte insistent
  assert.match(app, /if\(!\(await connecter\(\{demande:true\}\)\)\) return \{ ok:false, message:MESSAGE_SERVICE_INJOIGNABLE \};/);
  assert.match(app, /if\(!sb && !\(await connecter\(\{demande:true\}\)\)\)/);
});

test("le budget d'attente est global, quel que soit le nombre de sources", () => {
  /* Il n'y a plus qu'une origine, mais le budget reste global : le jour où
     l'on ajouterait une source de secours, deux délais de douze secondes
     feraient vingt-quatre secondes de bouton « Envoi… » — pire que l'échec
     qu'on répare. La garde vaut mieux ici que dans une note. */
  assert.match(app, /const echeance = Date\.now\(\) \+/);
  assert.match(app, /const reste = echeance - Date\.now\(\);/);
  assert.match(app, /if\(reste < 250\) break;/);
});

test("le SDK vient de notre origine, jamais d'un CDN tiers", () => {
  /* Un bloqueur de publicités, un réseau d'entreprise ou une panne de CDN
     rendaient TOUT le service de comptes inaccessible. Un miroir n'y changeait
     rien : un filtre qui bloque un CDN par motif les bloque tous. */
  const bloc = /const SUPABASE_SDK = Object\.freeze\(\[[\s\S]*?\]\);/.exec(app)[0];
  assert.doesNotMatch(bloc, /https?:\/\//,
    "aucune origine extérieure ne doit rester dans le chargeur");
  assert.match(bloc, /"\/vendeur\/supabase-\d+\.\d+\.\d+\.js"/);
});

test("plus aucun CDN tiers ne sert de code applicatif", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const source of [app, index]) {
    // les commentaires ont le droit de nommer ce qu'on a quitté ; le code, non
    const sansCommentaires = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
    assert.doesNotMatch(sansCommentaires, /jsdelivr|unpkg/i);
  }
});

test("la version est dans le nom du fichier : immuable par construction", async () => {
  /* `vercel.json` archive tout `.js` pour un an. Un fichier dont le nom porte
     sa version ne peut donc pas être servi périmé — changer de version change
     l'URL — et il n'a pas besoin du tampon d'empreinte des modules. */
  const chemin = /"(\/vendeur\/supabase-([\d.]+)\.js)"/.exec(app);
  assert.ok(chemin, "le chemin du SDK doit porter sa version");
  const fichier = await readFile(new URL(".." + chemin[1], import.meta.url), "utf8");
  assert.ok(fichier.length > 100000, "le SDK doit être réellement présent");
  // le paquet publie sa propre version : elle doit correspondre au nom
  assert.ok(fichier.includes("supabase-js/" + chemin[2]),
    "le fichier servi doit être la version que son nom annonce");
});

test("le SDK reste hors du chemin critique du premier affichage", () => {
  // 200 ko bruts qui ne servent qu'aux comptes : ils ne doivent jamais être
  // demandés avant que l'écran ne soit vivant
  assert.doesNotMatch(app, /<script[^>]+vendeur\/supabase/,
    "le SDK ne doit pas être une balise du document");
  assert.match(app, /function chargerSupabase\(options\)\{/);
  // il n'est demandé que par `connecter()`, elle-même appelée à la demande
  const appels = (app.match(/chargerSupabase\(/g) || []).length;
  assert.equal(appels, 2, "un seul appelant, plus sa définition");
});

test("le message dit la cause probable et laisse une porte", () => {
  const bloc = /const MESSAGE_SERVICE_INJOIGNABLE =[\s\S]*?;/.exec(app)[0];
  assert.match(bloc, /bloqueur/i, "la cause la plus fréquente doit être nommée");
  assert.match(bloc, /Réessaie/i, "un message d'échec sans issue est une impasse");
  // l'ancienne phrase ne décrivait qu'un état, sans rien à en faire
  assert.doesNotMatch(app, /message:"Connexion impossible pour le moment\."/);
});

test("l'écran de compte se redessine après un échec, bouton réarmé", () => {
  // sinon le bouton resterait sur « Envoi… », désactivé, sans retour possible
  const bloc = /if\(envoyer\) envoyer\.onclick = async\(\)=>\{[\s\S]*?\n  \};/.exec(app)[0];
  assert.match(bloc, /if\(!r\.ok\)\{ rendreEcranCompte\(r\.message\); return; \}/);
});

test("le démarrage ne réclame toujours pas de compte", () => {
  // le correctif ne doit pas transformer une source facultative en dépendance
  assert.doesNotMatch(app, /demarrer\([\s\S]{0,4000}connecter\(\{demande:true\}\)/);
});

test("le fichier vendorisé relève de la règle de cache des .js", async () => {
  /* `vercel.json` archive tout `.js` pour un an, et cette règle précède la
     règle générale — c'est ce que garde déjà `cache.test.mjs`. Le SDK
     vendorisé est donc traité exactement comme `core.js` ou `app.js` : rien
     de particulier à configurer, et c'est précisément l'intérêt. */
  const vercel = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const regleJs = vercel.headers.find((h) => h.source === "/(.*)\\.js");
  assert.ok(regleJs, "la règle .js doit exister");
  const valeur = regleJs.headers.find((h) => h.key === "Cache-Control").value;
  assert.match(valeur, /immutable/);
  // le chemin du SDK finit bien par .js, donc il est couvert
  assert.match(/"(\/vendeur\/supabase-[\d.]+\.js)"/.exec(app)[1], /\.js$/);
});
