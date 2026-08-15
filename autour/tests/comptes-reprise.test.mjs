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
  // sans ça, deux gestes rapprochés injecteraient deux fois 120 ko de SDK
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

test("le budget d'attente est global, pas par miroir", () => {
  // deux miroirs à douze secondes chacun feraient vingt-quatre secondes de
  // bouton « Envoi… » : pire que l'échec qu'on répare
  assert.match(app, /const echeance = Date\.now\(\) \+/);
  assert.match(app, /const reste = echeance - Date\.now\(\);/);
  assert.match(app, /if\(reste < 250\) break;/);
});

test("le SDK a un miroir : une origine bloquée ne condamne pas les comptes", () => {
  const bloc = /const SUPABASE_SDK = Object\.freeze\(\[[\s\S]*?\]\);/.exec(app)[0];
  const origines = (bloc.match(/https:\/\/[^/]+/g) || []);
  assert.ok(origines.length >= 2, "une seule origine est un point unique de panne");
  assert.equal(new Set(origines).size, origines.length, "deux fois la même origine ne sert à rien");
  // même version épinglée partout : le contrat Auth ne doit pas changer selon le miroir
  const versions = bloc.match(/supabase-js@([\d.]+)/g) || [];
  assert.equal(new Set(versions).size, 1, "les miroirs doivent servir la même version");
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
