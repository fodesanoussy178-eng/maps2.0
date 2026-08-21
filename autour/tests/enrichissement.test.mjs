/* LE CALQUE VÉRIFIÉ, DE BOUT EN BOUT.

   Ce système existait déjà — déployé sur Supabase, jamais versionné, jamais
   appelé. Ces tests portent sur les deux choses qui comptent : que la partie
   qui DÉCIDE reste éprouvable sans clé ni quota, et que le branchement au
   client respecte les règles d'Autour (rien sur le chemin critique, rien
   d'inventé, rien qui casse quand le modèle tombe). */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sourceApplication } from "./source.mjs";

import {
  cleLieu, normaliserNom, prioriteSource, classerSources, peutEcraserOsm,
  extraireObjet, construireFait, expiration, ligneEnrichissement, DUREES, invite,
} from "../supabase/functions/enrichir-lieu/extraction.mjs";

const html = await sourceApplication(import.meta.url);
const client = await readFile(new URL("../enrichissements.js", import.meta.url), "utf8");
const moteur = await readFile(new URL("../maintenant.js", import.meta.url), "utf8");
const fonction = await readFile(
  new URL("../supabase/functions/enrichir-lieu/index.ts", import.meta.url), "utf8");

const T = Date.parse("2026-08-21T12:00:00Z");
const ctx = (extra) => Object.assign({ nom: "Le Grand Mix", commune: "Tourcoing",
  maintenant: T, sources: [] }, extra || {});

/* ======================================================================== */
/*  L'identité d'un lieu — la même des deux côtés                           */
/* ======================================================================== */

test("la clé d'un lieu ignore articles, accents et casse", () => {
  assert.equal(cleLieu("Le Grand Mix", 50.7244, 3.1618), "grand-mix@50.7244,3.1618");
  assert.equal(cleLieu("LE GRAND MIX", 50.7244, 3.1618), cleLieu("le grand mix", 50.7244, 3.1618));
  assert.equal(normaliserNom("Théâtre du Nord"), "theatre nord");
});

test("sans coordonnées, il n'y a pas de clé — jamais le point (0, 0)", () => {
  /* `Number(null)` vaut zéro et zéro est fini : sans test d'absence, tous les
     lieux sans position partageraient l'enrichissement du golfe de Guinée. */
  assert.equal(cleLieu("Musée", null, 3.16), null);
  assert.equal(cleLieu("Musée", 50.72, undefined), null);
  assert.equal(cleLieu("Musée", 50.72, ""), null);
  assert.equal(cleLieu("A", 50.72, 3.16), null, "un nom d'un caractère ne suffit pas");
});

test("le client et le serveur calculent EXACTEMENT la même clé", () => {
  /* Deux implémentations, une seule règle : si elles divergent, le client lit
     un cache que le serveur ne remplit jamais. */
  assert.match(client, /const ARTICLES = \/\\b\(le\|la\|les\|l\|un\|une\|des\|du\|de\|d\|au\|aux\|the\|a\)\\b\/g/);
  assert.match(client, /\.toFixed\(4\)/);
  assert.match(client, /if\(n\.length < 2\) return null/);
});

/* ======================================================================== */
/*  La provenance décide du pouvoir                                         */
/* ======================================================================== */

test("le domaine du lieu est reconnu comme officiel", () => {
  assert.equal(prioriteSource("https://legrandmix.com/", ctx()), "site_officiel");
  assert.equal(prioriteSource("https://legrandmix.com/agenda/", ctx()), "agenda_officiel");
  assert.equal(prioriteSource("https://legrandmix.com/billetterie", ctx()), "billetterie_officielle");
});

test("un mot générique ne fait pas d'un annuaire un site officiel", () => {
  /* « musee.fr » n'appartient à aucun musée en particulier. */
  const musee = ctx({ nom: "Musée des Beaux-Arts", commune: "Tourcoing" });
  assert.notEqual(prioriteSource("https://musee.fr/", musee), "site_officiel");
  assert.notEqual(prioriteSource("https://tourisme.fr/", musee), "site_officiel");
});

test("le domaine de la commune est institutionnel, pas officiel du lieu", () => {
  const p = prioriteSource("https://tourcoing.fr/culture", ctx());
  assert.ok(p === "institutionnel" || p === "agenda_officiel", p);
  assert.notEqual(p, "site_officiel");
});

test("une plateforme de billetterie reste un tiers", () => {
  /* Ce sont des revendeurs : ils publient ce qu'on leur donne, et leurs pages
     survivent souvent à l'événement. */
  ["https://billetweb.fr/x", "https://shotgun.live/y", "https://dice.fm/z"]
    .forEach((u) => assert.equal(prioriteSource(u, ctx()), "tiers", u));
});

test("ni javascript:, ni data:, ni file: ne sont des sources", () => {
  ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]
    .forEach((u) => assert.equal(prioriteSource(u, ctx()), null, u));
});

test("les sources sont triées, la meilleure en tête", () => {
  const s = classerSources([
    { url: "https://unblog.fr/a" },
    { url: "https://tourcoing.fr/b" },
    { url: "https://legrandmix.com/c" },
  ], ctx());
  assert.equal(s[0].priorite, "site_officiel");
  assert.equal(s[s.length - 1].priorite, "tiers");
});

test("seule une source officielle ou institutionnelle écrase OpenStreetMap", () => {
  assert.equal(peutEcraserOsm("site_officiel", 0.9), true);
  assert.equal(peutEcraserOsm("institutionnel", 0.8), true);
  assert.equal(peutEcraserOsm("tiers", 1), false, "l'aplomb d'un blog ne vaut rien");
  assert.equal(peutEcraserOsm("site_officiel", 0.5), false, "ni une source sûre peu confiante");
});

/* ======================================================================== */
/*  Zéro hallucination                                                      */
/* ======================================================================== */

test("SANS SOURCE CITÉE, RIEN N'EXISTE", () => {
  /* La garantie principale : le modèle peut écrire ce qu'il veut, si l'API n'a
     cité aucune page, tout est jeté. */
  const brut = { statut: "ouvert", horaires_semaine: "Mo-Su 09:00-19:00", confiance: 1 };
  assert.equal(construireFait(brut, ctx({ sources: [] })), null);
});

test("la confiance du modèle est plafonnée par sa meilleure source", () => {
  const brut = { statut: "ouvert", confiance: 1 };
  const tiers = construireFait(brut, ctx({ sources: [{ url: "https://unblog.fr/a" }] }));
  assert.ok(tiers.confidence <= 0.5, "un modèle sûr de lui qui n'a lu qu'un blog reste un blog");
  const officiel = construireFait(brut, ctx({ sources: [{ url: "https://legrandmix.com/" }] }));
  assert.ok(officiel.confidence > tiers.confidence);
});

test("un tiers ne ferme jamais un lieu", () => {
  const fait = construireFait(
    { statut: "ferme_definitivement", fermeture_temporaire: true, confiance: 1 },
    ctx({ sources: [{ url: "https://unblog.fr/a" }] }));
  assert.notEqual(fait.current_status, "permanently_closed");
  assert.notEqual(fait.temporary_closed, true);
  assert.equal(fait.opening_hours, null, "ni ne réécrit ses horaires");
});

test("une date aberrante redevient « on ne sait pas »", () => {
  const fait = construireFait(
    { statut: "ouvert", prochaine_ouverture: "1970-01-01T00:00:00Z", confiance: 0.9 },
    ctx({ sources: [{ url: "https://legrandmix.com/" }] }));
  assert.equal(fait.next_open_at, null);
});

test("des horaires qui ne ressemblent pas à une grille sont refusés", () => {
  const avec = (h) => construireFait({ statut: "ouvert", horaires_semaine: h, confiance: 0.9 },
    ctx({ sources: [{ url: "https://legrandmix.com/" }] })).opening_hours;
  assert.equal(avec("ouvert tous les jours"), null, "sans heure, ce n'est pas une grille");
  assert.equal(avec("Tu-Su 10:00-18:00; Mo off"), "Tu-Su 10:00-18:00; Mo off");
});

test("une réponse illisible ne produit rien", () => {
  assert.equal(extraireObjet(""), null);
  assert.equal(extraireObjet("je n'ai pas trouvé"), null);
  assert.equal(extraireObjet("[1,2]"), null, "un tableau n'est pas l'objet attendu");
  assert.deepEqual(extraireObjet('```json\n{"statut":"ouvert"}\n```'), { statut: "ouvert" });
});

test("une confiance trop basse vide le fait sans perdre la ligne", () => {
  /* Elle a coûté un appel : on la garde pour ne pas le repayer demain, mais
     vidée de ce qu'elle affirmait. « On a cherché, on ne sait pas » n'est pas
     « fermé ». */
  const fait = construireFait(
    { statut: "ferme", horaires_semaine: "Mo-Su 09:00-19:00", confiance: 0.2 },
    ctx({ sources: [{ url: "https://legrandmix.com/" }] }));
  assert.equal(fait.current_status, "unknown");
  assert.equal(fait.opening_hours, null);
  assert.ok(fait.sources.length, "la provenance, elle, reste");
});

/* ======================================================================== */
/*  La fraîcheur                                                            */
/* ======================================================================== */

test("le TTL dépend de ce qu'on a trouvé, pas du moment où on a demandé", () => {
  const base = { current_status: "open", programme_now: [], programme_soon: [] };
  const horaires = expiration(base, T).getTime() - T;
  const avecProgramme = expiration(
    Object.assign({}, base, { programme_now: [{ titre: "x" }] }), T).getTime() - T;
  assert.equal(horaires, DUREES.horaires);
  assert.equal(avecProgramme, DUREES.programme);
  assert.ok(avecProgramme < horaires, "une programmation change plus vite qu'une grille");
});

test("un lieu muet est mis en cache aussi", () => {
  /* Sans quoi les lieux sur lesquels on ne trouve rien seraient les plus
     coûteux de tous, redemandés à chaque ouverture. */
  assert.equal(expiration({ current_status: "unknown" }, T).getTime() - T, DUREES.inconnu);
});

test("la ligne écrite porte sa clé, sa date et son expiration", () => {
  const fait = construireFait({ statut: "ouvert", confiance: 0.9 },
    ctx({ sources: [{ url: "https://legrandmix.com/" }] }));
  const ligne = ligneEnrichissement(fait, { cle: "grand-mix@50.7244,3.1618",
    nom: "Le Grand Mix", commune: "Tourcoing", lat: 50.7244, lng: 3.1618 },
    { maintenant: T, modele: "gemini-2.0-flash", duree: 1200 });
  assert.equal(ligne.place_key, "grand-mix@50.7244,3.1618");
  assert.ok(Date.parse(ligne.expires_at) > T);
  assert.equal(ligne.run_ms, 1200);
});

/* ======================================================================== */
/*  L'invite ne reçoit jamais de consigne du client                         */
/* ======================================================================== */

test("l'invite est écrite côté serveur, pas reçue", () => {
  const texte = invite({ nom: "X", lat: 50, lng: 3 }, { maintenant: T });
  assert.match(texte, /N'invente aucune information/);
  assert.match(texte, /ORDRE DES SOURCES/);
});

test("le texte venu du client est réduit avant d'approcher l'invite", () => {
  /* On ne se défend pas par une liste de phrases interdites — elle serait
     toujours en retard d'une tournure — mais en réduisant l'alphabet. */
  assert.match(fonction, /function sansControle/);
  assert.match(fonction, /code < 32 \|\| code === 127/);
  assert.match(fonction, /replace\(\/\[\{\}\[\\\]<>\|\\\\\^~`"\]\/g, " "\)/);
});

/* ======================================================================== */
/*  La sécurité des clés                                                    */
/* ======================================================================== */

test("aucune clé de modèle ne descend dans le navigateur", () => {
  /* On lit le CODE, pas la prose : un commentaire qui nomme la clé pour dire
     qu'elle ne descend pas ici n'est pas la clé. */
  const code = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /GEMINI_API_KEY|x-goog-api-key|generativelanguage/,
    "la clé du modèle ne quitte jamais Supabase");
  const clientCode = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(clientCode, /GEMINI|x-goog/i);
  /* Et le navigateur n'appelle jamais le modèle en direct : il passe par la
     fonction Edge, qui seule détient la clé. */
  assert.match(code, /\/functions\/v1\/enrichir-lieu/);
});

test("le navigateur n'utilise que la clé publiable, déjà publique", () => {
  assert.match(html, /apikey:SUPABASE_CLE, authorization:"Bearer "\+SUPABASE_CLE/);
  assert.match(html, /const SUPABASE_CLE = "sb_publishable_/);
  /* Un secret de synchronisation dans une page serait un secret publié. */
  assert.doesNotMatch(html, /x-sync-secret|EVENT_SYNC_SECRET|SUPABASE_SECRET_KEY/);
});

test("la clé du modèle est lue en en-tête, jamais dans une URL", () => {
  /* Une URL se journalise ; un en-tête beaucoup moins. */
  assert.match(fonction, /"x-goog-api-key": CLE_GEMINI/);
  assert.doesNotMatch(fonction, /key=\$\{CLE_GEMINI\}|\?key=/);
});

/* ======================================================================== */
/*  Le branchement : hors du chemin critique, et borné                      */
/* ======================================================================== */

test("l'enrichissement part APRÈS la peinture, jamais avant", () => {
  assert.match(html,
    /PERF\.jalon\("recommandations_posees"\);[\s\S]{0,800}?ORDO\.differer\(\(\)=>enrichirCandidats/,
    "il doit partir après le jalon de peinture, dans une tranche d'inactivité");
  /* Et il est annulable : changer de zone pendant l'attente ne doit pas faire
     aboutir une vague qui concerne la ville qu'on vient de quitter. */
  assert.match(html, /valide:\(\)=>jeton === generationAccueil\}\);/);
});

test("au plus cinq candidats, au plus trois vérifications en vol", () => {
  assert.match(client, /const MAX_CANDIDATS = 5;/);
  assert.match(client, /const MAX_SIMULTANEES = 3;/);
  assert.match(html, /classement\.slice\(0, ENR\.MAX_CANDIDATS\)/);
});

test("le cache est consulté AVANT tout nouvel appel", () => {
  assert.match(html, /calqueVerifie\(candidats\.map\(x=>x\.cle\)\)[\s\S]{0,900}demanderVerification/);
  assert.match(html, /if\(!frais\) aVerifier\.push\(x\)/);
});

test("une commodité ne déclenche jamais un appel", () => {
  assert.match(client, /const COMMODITES = \[/);
  assert.match(client, /if\(COMMODITES\.indexOf\(lieu\.cat\) >= 0\) return raisons;/);
});

test("on n'enrichit que ce à quoi il manque quelque chose", () => {
  assert.match(html, /\.filter\(x=>x\.cle && x\.raisons\.length\)/);
});

test("une panne du modèle laisse Autour intact", () => {
  /* Aucun résultat déjà affiché ne disparaît parce qu'une recherche a échoué. */
  const bloc = /async function demanderVerification\([\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  assert.match(bloc[0], /catch\(e\)\{[\s\S]{0,300}return null;/);
  assert.match(bloc[0], /AbortSignal\.timeout\(20000\)/);
  // et côté serveur : une panne rend le cache, pas une erreur
  assert.match(fonction, /origine: "cache", actif: false,\s*\n?\s*raison: message\}, 200\)/);
});

/* ======================================================================== */
/*  L'effet sur « Maintenant »                                              */
/* ======================================================================== */

test("une fermeture vérifiée exclut de « Maintenant »", () => {
  assert.match(moteur, /if \(item\.temporary_closed === true\) return refusNature\(RAISONS\.FERME_VERIFIE\)/);
  assert.match(moteur, /item\.current_status === "closed" \|\| item\.current_status === "permanently_closed"/);
  assert.match(moteur, /FERME_VERIFIE:    "ferme_verifie"/);
});

test("une programmation en cours remonte franchement", () => {
  assert.match(moteur, /const programmeEnCours = Array\.isArray\(item\.programme_now\) && item\.programme_now\.length > 0/);
  assert.match(moteur, /const activite = programmeEnCours \|\| ACTIVITES\.indexOf/);
});

test("« bientôt » ne devient JAMAIS « maintenant »", () => {
  /* Ce qui commence demain n'a pas lieu maintenant : le faire entrer viderait
     le mot de son sens. */
  const code = moteur.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /programme_soon/,
    "aucune ligne de code du moteur ne doit lire programme_soon");
  /* La règle est écrite noir sur blanc, pour qu'on ne la reperde pas. */
  assert.match(moteur, /`programme_soon`, lui, ne remonte JAMAIS ici/);
});

test("les plafonds de Maintenant sont intacts", () => {
  assert.match(moteur, /const PLACES = 3;/);
  assert.match(html, /const MAINTENANT_TOUT = 10;/);
});

test("le calque voyage jusqu'au moteur sans être réinterprété", () => {
  assert.match(html, /current_status:l\.current_status \|\| null/);
  assert.match(html, /temporary_closed:l\.temporary_closed == null \? null : l\.temporary_closed/);
  assert.match(html, /programme_now:Array\.isArray\(l\.programme_now\) \? l\.programme_now : null/);
});

/* ======================================================================== */
/*  La billetterie ne s'affiche que si elle existe                          */
/* ======================================================================== */

test("aucun bouton billetterie sans URL réelle", () => {
  /* Un bouton qui mène nulle part fait cliquer pour rien quelqu'un qui
     voulait y aller. */
  assert.match(html, /\(l\.ticket_url[\s\S]{0,140}?<a class="act"[\s\S]{0,120}?Billetterie/,
    "la fiche n'affiche le billet que si l'URL existe");
  assert.match(html, /\(l\.ticket_url[\s\S]{0,140}?<a class="pt-billet"/,
    "« Pour toi » suit la même règle");
  /* Et rien n'est affiché « au cas où » : les deux sont bien conditionnels. */
  assert.doesNotMatch(html, /<a class="pt-billet"[^>]*>Billetterie<\/a>'\+\s*\n?\s*'<button class="pt-voir"/);
});

test("les liens sortants sont sûrs", () => {
  const billets = html.match(/<a class="(?:act|pt-billet)"[^>]*ticket_url[^>]*>/g) || [];
  assert.ok(html.includes('target="_blank" rel="noopener">Billetterie</a>')
    || html.includes('rel="noopener">'), "rel=noopener sur les liens sortants");
});
