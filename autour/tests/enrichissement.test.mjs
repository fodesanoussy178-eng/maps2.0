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
  inviteAide, lireOrdreAide,
} from "../supabase/functions/enrichir-lieu/extraction.mjs";

const html = await sourceApplication(import.meta.url);
const client = await readFile(new URL("../enrichissements.js", import.meta.url), "utf8");
const moteur = await readFile(new URL("../maintenant.js", import.meta.url), "utf8");
const fonction = await readFile(
  new URL("../supabase/functions/enrichir-lieu/index.ts", import.meta.url), "utf8");
const config = await readFile(
  new URL("../supabase/config.toml", import.meta.url), "utf8");
const extraction = await readFile(
  new URL("../supabase/functions/enrichir-lieu/extraction.mjs", import.meta.url), "utf8");

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

test("l'invite dit que c'est une tâche de recherche, pas de mémoire", () => {
  /* Sans cette consigne, le modèle répond de mémoire : `webSearchQueries`
     vide, `groundingChunks` vide, et trente secondes dépensées pour une
     réponse que `construireFait` jette — à juste titre. */
  const texte = invite({ nom: "Stab Vélodrome", commune: "Roubaix",
                         lat: 50.6789, lng: 3.205 }, { maintenant: T });
  assert.match(texte, /T\u00c2CHE DE RECHERCHE/);
  assert.match(texte, /LOCALES et ACTUELLES/);
  assert.match(texte, /Tu DOIS utiliser l'outil de\s*\n?\s*recherche Google AVANT de r\u00e9pondre/);
  assert.match(texte, /connaissances internes est une r\u00e9ponse fausse/);
  /* Et elle dit quoi taper : le nom exact, avec la commune. */
  assert.match(texte, /« Stab Vélodrome Roubaix » — le nom exact du lieu, avec sa commune/);
  assert.match(texte, /« Stab Vélodrome Roubaix horaires ouverture »/);
  assert.match(texte, /« Stab Vélodrome Roubaix site officiel »/);
  /* La consigne de recherche passe AVANT la description du lieu : on ne lui
     demande pas de vérifier puis de chercher, mais de chercher puis de lire. */
  assert.ok(texte.indexOf("COMMENCE PAR CHERCHER") < texte.indexOf("- nom :"));
});

test("l'invite demande la prose AVANT le JSON — c'est la condition des citations", () => {
  const texte = invite({ nom: "Stab Vélodrome", commune: "Roubaix",
                         lat: 50.6789, lng: 3.205 }, { maintenant: T });
  assert.match(texte, /RÉPONDS EN DEUX TEMPS/);
  /* Les annotations de l'API portent start_index/end_index : elles s'ancrent
     sur de la prose. Une réponse qui n'est que du JSON n'en porte aucune —
     mesuré 6 citations → 0 sur la même question. */
  assert.ok(texte.indexOf("passages de PROSE") < texte.indexOf('{"statut"'),
    "la consigne de prose doit précéder le schéma JSON");
  assert.doesNotMatch(texte, /Réponds UNIQUEMENT par un objet JSON/);
  /* Et on n'a pas introduit de `response_format` : il a exactement le même
     effet destructeur sur les citations. */
  assert.doesNotMatch(fonction, /response_format/);
});

test("sans commune, l'invite ne fabrique pas de requête bancale", () => {
  const texte = invite({ nom: "Le Grand Mix", lat: 50.7, lng: 3.16 }, { maintenant: T });
  assert.match(texte, /« Le Grand Mix » — le nom exact/);
  assert.doesNotMatch(texte, /«  |  »/, "pas d'espace en trop faute de commune");
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

test("le navigateur ne détient que la clé publiable et le jeton de la personne", () => {
  /* Deux valeurs, et aucune n'est un secret : la clé publiable est déjà dans
     la page, et le JWT appartient à qui est connecté. */
  assert.match(html, /apikey:SUPABASE_CLE, authorization:"Bearer "\+session\.access_token/);
  assert.match(html, /const SUPABASE_CLE = "sb_publishable_/);
  /* Un secret de synchronisation dans une page serait un secret publié. */
  assert.doesNotMatch(html, /x-sync-secret|EVENT_SYNC_SECRET|SUPABASE_SECRET_KEY/);
});

test("sans personne connectée, on ne demande rien — on n'ouvre pas la porte", () => {
  const bloc = /async function demanderVerification\([\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  /* Les commentaires nomment `sbLecture` pour expliquer pourquoi on ne s'en
     sert pas : c'est le CODE qu'on interroge, pas la prose. */
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /* Le jeton vient de `sb`, le client qui porte la session — pas de
     `sbLecture`, délibérément sans session. */
  assert.match(code, /await sb\.auth\.getSession\(\)/);
  assert.doesNotMatch(code, /sbLecture/);
  /* Pas de session : on rend `null`, on ne se rabat pas sur la clé publiable. */
  assert.match(code, /if\(!session \|\| !session\.access_token\) return null;/);
  assert.doesNotMatch(code, /authorization:"Bearer "\+SUPABASE_CLE/);
  /* Et la fonction reste protégée côté serveur. */
  assert.match(config, /\[functions\.enrichir-lieu\][\s\S]{0,120}verify_jwt = true/);
});

test("un candidat écarté faute de session reste vérifiable après connexion", () => {
  /* `_reserver` marque la clé pour toute la session : la réserver avant
     d'avoir un jeton condamnerait le lieu à ne plus jamais être vérifié. */
  const bloc = /async function demanderVerification\([\s\S]*?\n\}/.exec(html);
  assert.ok(bloc);
  const posJeton = bloc[0].indexOf("access_token");
  const posReserve = bloc[0].indexOf("ENR._reserver");
  assert.ok(posJeton > 0 && posReserve > posJeton,
    "la réservation doit venir après la lecture du jeton");
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
  /* L'ordre est la garantie, pas la distance entre deux lignes. */
  const posCache = html.indexOf("calqueVerifie(candidats.map(x=>x.cle))");
  const posAppel = html.indexOf("await demanderVerification(x.l", posCache);
  assert.ok(posCache > 0 && posAppel > posCache,
    "aucune vérification ne part avant que le cache ait répondu");
  assert.match(html, /if\(!frais\) aVerifier\.push\(x\)/);
});

test("ce que le cache vient de remplir n'est pas redemandé", () => {
  /* `manques` avait été calculé sur le lieu NU. Le calque y pose ensuite des
     horaires, une programmation, une URL officielle — et l'ancienne version
     partait quand même vérifier ce qui venait d'être répondu. */
  const posApplique = html.indexOf("if(e && ENR.appliquer(x.l, e)) change = true;");
  const posRecalcul = html.indexOf("const restants = ENR.manques(x.l);", posApplique);
  const posAppel = html.indexOf("await demanderVerification(x.l", posRecalcul);
  assert.ok(posApplique > 0 && posRecalcul > posApplique && posAppel > posRecalcul,
    "le reste se recalcule après le calque, et c'est lui qui décide");
});

test("les quatre portes du modèle sont tenues par un seul module", () => {
  /* Budget, cache frais, rien ne manque, source officielle : la décision vit
     dans `territoire.js`, et l'application ne fait que lui passer ce qu'elle
     sait. Deux endroits qui décident finiraient par ne plus être d'accord. */
  assert.match(html, /const decision = TERR\.enrichissementAutorise\(lieu, \{/);
  assert.match(html, /budgetRestant: budgetVerificationEpuise \? 0 : 1,/);
  /* Et quand le serveur dit que le plafond est atteint, on cesse de frapper. */
  assert.match(html, /if\(json && json\.raison === "budget du jour atteint"\) budgetVerificationEpuise = true;/);
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
  /* Et côté serveur : la panne survient maintenant APRÈS la réponse, dans le
     travail de fond. Elle ne peut donc plus rien casser en aval — elle est
     tracée, et le lieu sera redemandé quand son entrée aura expiré. */
  assert.match(fond, /catch \(erreur\) \{[\s\S]{0,400}trace\("background_error"/);
  assert.doesNotMatch(fond, /throw /);
});

/* ======================================================================== */
/*  Le travail de fond : personne n'attend le modèle                        */
/* ======================================================================== */

/* Le `Deno.serve` seul — `verifier` est défini au-dessus, il n'en fait pas
   partie. C'est exactement ce qu'on veut vérifier : ce que la RÉPONSE fait,
   par opposition à ce que le travail de fond fait. */
const traitant = /Deno\.serve\([\s\S]*$/.exec(fonction)[0];

test("la réponse n'attend plus jamais le modèle", () => {
  assert.doesNotMatch(traitant, /await interroger\(/,
    "interroger le modèle depuis la réponse, c'est refaire courir le client");
  assert.doesNotMatch(traitant, /await ecrire\(/);
  assert.doesNotMatch(traitant, /construireFait\(|ligneEnrichissement\(/);
  /* Le lancement, lui, ne s'attend pas : pas de `await` devant. */
  assert.match(traitant, /\n  enTacheDeFond\(verifier\(lieu\)\);/);
});

test("le travail de fond tient l'isolat en vie avec EdgeRuntime.waitUntil", () => {
  /* Une promesse flottante n'est pas une tâche de fond : c'est une tâche
     qu'on abandonne dès que la réponse part. */
  assert.match(fonction, /EdgeRuntime\?: \{waitUntil\?: \(promesse: Promise<unknown>\) => void\}/);
  assert.match(fonction, /garder\.call\(RUNTIME, sur\)/);
  /* Et le repli ne réintroduit pas l'attente qu'on vient de supprimer. */
  const bloc = /function enTacheDeFond\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  assert.doesNotMatch(bloc[0], /await /);
});

test("la réponse annonce que la vérification est lancée", () => {
  /* Le cache périmé repart avec elle quand il existe — il reste vrai plus
     souvent que rien — et `null` sinon. Dans les deux cas `actif: true`. */
  assert.match(traitant,
    /enrichissement: cache, origine: "cache", actif: true,\s*\n?\s*raison: "verification_lancee"/);
});

test("le cache frais court-circuite tout, et rien ne part en fond", () => {
  const posCache = traitant.indexOf("enCache(cle)");
  const posFrais = traitant.indexOf('Date.parse(String(cache.expires_at)) > maintenant');
  const posLancement = traitant.indexOf("enTacheDeFond(");
  assert.ok(posCache > 0 && posFrais > posCache && posLancement > posFrais,
    "l'entrée fraîche doit rendre la main avant qu'on lance quoi que ce soit");
});

test("le budget du jour garde sa place avant le lancement", () => {
  const posBudget = traitant.indexOf("await reserverAppel()");
  const posLancement = traitant.indexOf("enTacheDeFond(");
  assert.ok(posBudget > 0 && posLancement > posBudget,
    "un travail de fond gratuit resterait un travail de fond illimité");
  assert.match(fonction, /const BUDGET_JOUR = Number\(Deno\.env\.get\("ENRICHISSEMENT_BUDGET_JOUR"\)/);
  /* Et le plafond de candidats du client ne bouge pas. */
  assert.match(client, /const MAX_CANDIDATS = 5;/);
});

test("le budget est RÉSERVÉ, pas compté après coup", () => {
  /* CE QUI N'ALLAIT PAS. On comptait les lignes écrites dans
     `place_enrichments` depuis minuit. Trois façons de ne rien borner :

       · un appel qui échoue n'écrit rien, donc ne comptait pas ;
       · un appel qui ne trouve rien pour un lieu connu réécrit la même ligne,
         donc n'avançait pas le compteur ;
       · lire puis décider n'est pas atomique — dix requêtes simultanées
         lisaient toutes « 399 » et partaient toutes les dix.

     La réservation se fait donc côté base, en une seule instruction. */
  assert.doesNotMatch(fonction, /consommeAujourdhui/,
    "compter des lignes écrites ne borne pas des appels");
  assert.match(fonction, /rest\("rpc\/reserver_enrichissement"/);
  assert.match(fonction, /p_plafond: BUDGET_JOUR/);
  /* Un compteur injoignable ne devient jamais une autorisation : le pire cas
     doit rester une journée sans enrichissement, jamais une facture. */
  const reservation = /async function reserverAppel\(\)[\s\S]*?\n\}/.exec(fonction)[0];
  assert.match(reservation, /if \(!r\.ok\) \{[\s\S]*?accorde: false/);
});

test("un appel qui ne trouve rien, ou qui échoue, compte quand même", () => {
  /* C'est la condition pour que le plafond borne réellement le coût. Les
     quatre sorties du travail de fond passent par la clôture. */
  const sorties = [...fond.matchAll(/await cloturerAppel\((true|false)\)/g)]
    .map((m) => m[1]);
  assert.equal(sorties.length, 4,
    "aucune trouvaille, aucun fait, une écriture réussie, une panne");
  assert.deepEqual(sorties.filter((x) => x === "true").length, 1,
    "un seul de ces quatre chemins a réellement amélioré une information");
});

test("le travail de fond n'écrit jamais un fait sans source", () => {
  const garde = fond.indexOf("if (!fait)");
  const sortie = fond.indexOf('trace("no_fact"');
  const ecriture = fond.indexOf("await ecrire(");
  assert.ok(garde > 0 && sortie > garde && ecriture > sortie,
    "le garde-fou « aucune source citée » doit passer avant l'écriture");
});

test("l'appel passe par l'Interactions API, avec le corps documenté", () => {
  /* Le commentaire nomme les réglages retirés pour expliquer pourquoi : c'est
     le code qu'on interroge, pas la prose. */
  const appel = fonction.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(appel,
    /"https:\/\/generativelanguage\.googleapis\.com\/v1beta\/interactions"/);
  /* Le modèle passe du chemin d'URL au corps. */
  assert.doesNotMatch(appel, /:generateContent/);
  assert.match(appel, /model: MODELE,\s*\n?\s*input: invite\(lieu, \{maintenant\}\),/);
  assert.match(appel, /tools: \[\{type: "google_search"\}\]/);
  /* Rien d'autre dans le corps : ni température, ni plafond, ni réflexion. La
     campagne précédente a montré que ce n'était pas là que ça se jouait, et le
     corps minimal est le test le plus propre. */
  assert.doesNotMatch(appel, /temperature:|top_p|topP|top_k|topK|generationConfig|thinkingConfig/);
  /* Le garde-fou de coût reste le budget du jour, pas la longueur. */
  assert.match(fonction, /const BUDGET_JOUR = Number\(Deno\.env\.get\("ENRICHISSEMENT_BUDGET_JOUR"\)/);
});

test("les sources viennent des annotations url_citation, jamais du texte", () => {
  const bloc = /function citationsDesEtapes\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "");
  /* On ne lit que le tableau `annotations`, et rien d'autre du bloc. */
  assert.match(code, /\(bloc as \{annotations\?: unknown\}\)\?\.annotations/);
  assert.match(code, /if \(!Array\.isArray\(brutes\)\) continue;/);
  /* Une URL dans `text` est une adresse que le modèle a tapée : jamais. */
  assert.doesNotMatch(code, /\.text/);
  /* Et seul ce qui s'annonce comme citation compte. */
  assert.match(code, /String\(a\.type \?\? ""\) !== "url_citation"/);
  assert.match(code, /typeof a\.url === "string" \? a\.url/);
  assert.match(code, /typeof a\.uri === "string" \? a\.uri : ""/);
  assert.match(code, /if \(!\/\^https\?:\\\/\\\/\/i\.test\(lien\)\) continue;/);
});

test("l'étape d'outil reste un repli, pas la source d'autorité", () => {
  const bloc = /function sourcesDesEtapes\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "");
  /* Les annotations d'abord ; l'étape d'outil seulement si elles manquent. */
  const citations = code.indexOf("citationsDesEtapes(etapes)");
  const repli = code.indexOf("ETAPES_OUTIL.has");
  assert.ok(citations > 0 && repli > citations);
  assert.match(code, /if \(citations\.length\) return citations;/);
});

test("le journal sépare les citations des sources retenues", () => {
  assert.ok(fond.includes("annotation_citations: citations"));
  assert.ok(fond.includes("sources: sources.length"));
  assert.ok(fond.includes("domaines: domainesSources(sources)"));
});

test("le modèle ne fabrique pas ses propres citations", () => {
  /* `model_output` et `thought` sont ce que le modèle DIT. Y ramasser des URL
     reviendrait à le laisser se citer lui-même — exactement ce que la règle
     « aucune donnée sans source » interdit. */
  assert.match(fonction,
    /const ETAPES_OUTIL = new Set\(\["google_search_call", "google_search_result"\]\)/);
  const bloc = /function sourcesDesEtapes\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  /* Le commentaire nomme les étapes écartées pour dire pourquoi : c'est le
     code qu'on interroge, pas la prose. */
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /if \(!ETAPES_OUTIL\.has\(typeEtape\(etape\)\)\) continue;/);
  /* Le repli ne descend jamais dans une étape de parole : la seule lecture de
     `model_output` autorisée est celle des annotations, et elle est ailleurs. */
  assert.doesNotMatch(code, /model_output|thought/);
  const citations = /function citationsDesEtapes\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(citations);
  assert.doesNotMatch(citations[0].replace(/\/\*[\s\S]*?\*\//g, ""),
    /collecterLiens|ETAPES_OUTIL/);
});

test("la forme reçue se journalise en noms de clés, jamais en valeurs", () => {
  const bloc = /function formeDe\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "");
  /* Que des noms de clés. Aucune valeur ne sort d'ici. */
  assert.match(code, /Object\.keys\(o\)\.sort\(\)\.join\("\|"\)/);
  assert.doesNotMatch(code, /JSON\.stringify|\.text|snippet|String\(v\)/);
  /* Et c'est borné, en largeur comme en profondeur. */
  assert.match(code, /sorties\.size >= 40 \|\| profondeur > 3/);
  assert.match(code, /valeur\.slice\(0, 6\)/);
  assert.match(fonction, /etapes\.slice\(0, 12\)/);
});

test("les requêtes se lisent sous arguments.queries", () => {
  /* La mesure a donné le chemin : `google_search_call{arguments|id|search_type|
     signature|type}` puis `arguments{queries}`. Les autres noms restent en
     repli, ils ne coûtent rien. */
  const bloc = /function requetesDesEtapes\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  assert.match(bloc[0], /etape\.arguments \?\? etape\.args/);
  assert.match(bloc[0], /\[args\.queries, args\.query, etape\.queries, etape\.query\]/);
});

test("les lecteurs de la réponse n'acceptent jamais une source sans URL", () => {
  const bloc = /function collecterLiens\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "");
  /* `url` ou `uri`, et rien d'autre ne fait une source. */
  /* La liste des noms acceptés vit au-dessus de la fonction. */
  assert.match(fonction, /const NOMS_DE_LIEN = \["url", "uri", "link"/);
  /* Et la valeur doit être une vraie adresse web : une chaîne quelconque
     nommée `source` n'est pas une source. */
  assert.match(code, /\/\^https\?:\\\/\\\/\/i\.test\(v\)/);
  assert.match(code, /if \(lien\) \{/);
  /* La descente est bornée : une réponse hostile ne peut ni la faire tourner
     en rond ni la faire enfler. */
  assert.match(code, /sorties\.length >= 20 \|\| profondeur > 6/);
});

test("le délai serveur borne un travail de fond, pas une attente", () => {
  /* Soixante secondes que plus personne ne passe à regarder un écran. */
  assert.match(fonction, /const DELAI_MS = 60_000;/);
  assert.match(fonction, /signal: AbortSignal\.timeout\(DELAI_MS\)/);
  /* Le client, lui, ne bouge pas — il n'a plus de raison d'aller au bout. */
  assert.match(html, /AbortSignal\.timeout\(20000\)/);
});

/* Le corps de `verifier`, commentaires retirés : c'est le CODE qu'on
   interroge sur ce qu'il journalise, pas la prose qui l'explique. */
const fond = (() => {
  const bloc = /async function verifier\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc, "verifier() introuvable");
  return bloc[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
})();

test("aucune clé ne part dans les journaux du travail de fond", () => {
  assert.doesNotMatch(fond, /CLE_GEMINI|SUPABASE_SECRET|cleSecrete|apikey|Authorization/);
  /* On inspecte ce que chaque appel à `trace` emporte, un par un. Ni le texte
     rendu par le modèle, ni l'invite, ni les sources elles-mêmes : leur
     TAILLE, leur NOMBRE, et de quoi relier les lignes. */
  /* Le dernier appel porte un troisième argument — `trace(..., {...}, true)`
     pour la gravité — d'où le groupe optionnel avant la parenthèse. */
  const appels = [...fond.matchAll(/trace\("[a-z_]+",\s*\{[\s\S]*?\}(?:,\s*\w+)?\)/g)]
    .map((m) => m[0]);
  assert.equal(appels.length, 7, "sept étapes, sept appels");
  for (const appel of appels) {
    assert.doesNotMatch(appel, /\btexte\b(?!_len)(?!\.length)/, `texte brut journalisé : ${appel}`);
    assert.doesNotMatch(appel, /invite|sources\[|lieu\.nom|lieu\.adresse|requetes\[|requetes\.map/,
      `contenu sensible journalisé : ${appel}`);
  }
  assert.match(fond, /texte_len: texte\.length/);
  /* Les requêtes tapées se comptent, elles ne se recopient pas : elles portent
     le nom du lieu, et le journal n'a pas besoin de le lire trois fois. */
  assert.match(fond, /search_queries: requetes\.length/);
});

test("les sources sont journalisées par domaine et titre, jamais par contenu", () => {
  const bloc = /function domainesSources\([\s\S]*?\n\}/.exec(fonction);
  assert.ok(bloc);
  const code = bloc[0].replace(/\/\*[\s\S]*?\*\//g, "");
  /* Le domaine, pas l'URL complète : une URL emporte ses paramètres. */
  assert.match(code, /new URL\(source\.url\)\.hostname\.replace\(\/\^www\\\.\/, ""\)/);
  assert.match(code, /String\(source\.titre \?\? ""\)\.slice\(0, 60\)/);
  assert.match(code, /sources\.slice\(0, 5\)/);
  assert.doesNotMatch(code, /source\.url\}|href|search|pathname/);
});

const ETAPES = ["gemini_start", "gemini_response", "no_search", "no_fact",
                "write_start", "write_success", "background_error"];

test("le travail de fond dit où il s'arrête", () => {
  /* Sept étapes, et elles racontent le chemin dans l'ordre : si la trace
     s'interrompt, la dernière ligne écrite nomme le point de rupture. */
  for (const etape of ETAPES) {
    assert.match(fond, new RegExp(`trace\\("${etape}"`), `étape manquante : ${etape}`);
  }
  const ordre = ETAPES.map((e) => fond.indexOf(`trace("${e}"`));
  assert.deepEqual(ordre, [...ordre].sort((a, b) => a - b),
    "les étapes doivent apparaître dans l'ordre du chemin");
});

test("rien cherché et rien trouvé sont deux pannes différentes", () => {
  /* `no_search` : le modèle a répondu de mémoire. `no_fact` : il a cherché
     mais rien d'exploitable. Les confondre, c'est confondre un défaut d'invite
     avec un lieu dont le web ne parle pas. */
  const sansRecherche = fond.indexOf("if (!appels && !requetes.length)");
  const sansFait = fond.indexOf("if (!fait)");
  const construit = fond.indexOf("construireFait(");
  assert.ok(sansRecherche > 0 && construit > sansRecherche && sansFait > construit,
    "le garde-fou « aucune recherche » passe avant même de lire la réponse");
  /* Et ni l'une ni l'autre n'écrit quoi que ce soit. */
  const avantEcriture = fond.slice(0, fond.indexOf("await ecrire("));
  assert.equal((avantEcriture.match(/return;/g) || []).length, 2,
    "deux sorties sèches avant l'écriture, et aucune ligne posée");
});

test("chaque étape porte de quoi relier les lignes entre elles", () => {
  /* `gemini_response` est la ligne qui tranche : durée, recherches lancées,
     pages citées, taille du texte, et les domaines pour vérifier d'un coup
     d'œil qu'on a lu le bon lieu. */
  for (const champ of ["place_key: lieu.cle", "duree_ms: Date.now() - debut",
                       "search_calls: appels", "search_queries: requetes.length",
                       "sources: sources.length", "texte_len: texte.length",
                       "domaines: domainesSources(sources), formes"]) {
    assert.ok(fond.includes(champ), `gemini_response sans ${champ}`);
  }
  assert.match(fond, /trace\("no_search", \{place_key: lieu\.cle, texte_len: texte\.length, formes\}\)/);
  assert.match(fond, /trace\("no_fact", \{place_key: lieu\.cle, search_queries: requetes\.length/);
  assert.match(fond, /trace\("write_success", \{place_key: lieu\.cle/);
});

test("construireFait n'est pas assoupli : sans source, rien", () => {
  /* La règle qui a fait rejeter la réponse de mémoire est celle qu'on garde.
     C'est l'invite qu'on corrige, jamais le juge. */
  assert.equal(construireFait({ statut: "ouvert", confiance: 1 },
    ctx({ sources: [] })), null);
  assert.equal(construireFait({ statut: "ouvert", confiance: 1 },
    ctx({ sources: [{ url: "pas-une-url", titre: "x" }] })), null);
  const source = /export function construireFait[\s\S]*?\n\}/.exec(extraction)[0];
  assert.match(source, /if \(!sources\.length\) return null;/);
});

test("background_error ne rend que le message, tronqué", () => {
  assert.match(fond,
    /message: String\(erreur instanceof Error \? erreur\.message : erreur\)\.slice\(0, 300\)/);
  /* Ni pile d'appel, ni corps de réponse, ni objet d'erreur entier. */
  assert.doesNotMatch(fond, /erreur\.stack|JSON\.stringify\(erreur\)|erreur\}/);
});

test("le diagnostic ne crée aucune table", () => {
  /* Une table de plus serait une table à purger, migrer et surveiller. La
     règle vaut toujours pour le DIAGNOSTIC : la trace part dans les journaux
     de la fonction, pas dans une table de logs.

     Le budget, lui, est un compteur — pas un diagnostic — et il vit dans la
     seule table qui puisse le rendre atomique, écrite par une RPC. La fonction
     ne touche donc que deux surfaces, et aucune n'est un journal. */
  const code = fonction.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /create table|enrichissement_logs|diagnostic/i);
  const tables = [...code.matchAll(/rest\("([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ["place_enrichments", "rpc"]);
  const rpc = [...code.matchAll(/rest\("rpc\/([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rpc)].sort(),
    ["cloturer_enrichissement", "reserver_enrichissement"]);
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

/* ==========================================================================
   LE MODE AIDE — LE MÊME APPEL, UNE AUTRE QUESTION

   Un seul appel de modèle dans Autour. Le mode Aide en est un mode, pas une
   seconde fonction : même clé, même réservation, même plafond, même trace.
   ======================================================================== */

const index = await readFile(
  new URL("../supabase/functions/enrichir-lieu/index.ts", import.meta.url), "utf8");

const CONTEXTE = Object.freeze({
  userLat: 50.7236, userLng: 3.1614, selectedCity: "Tourcoing",
  currentRadius: 5000, requestedHelpCategory: "manger",
  userFreeText: "j’ai rien à manger",
  candidatePlaces: [
    { id: "osmnode1", name: "Croix-Rouge Française - Unité Locale de Tourcoing",
      category: "alimentaire", distanceM: 1425, confidence: 188,
      osm: { social_facility: "food_bank" }, capabilities: { food_assistance: true } },
    { id: "osmnode2", name: "CCAS", category: "asso", distanceM: 288,
      confidence: 68, osm: { social_facility: "outreach" }, capabilities: {} },
  ],
  allowedPlaceIds: ["osmnode1", "osmnode2"],
  allowedCategories: ["manger", "logement", "securite"],
  rules: ["Ne jamais inventer une structure, une adresse, un horaire ou un téléphone."],
});

test("le mode Aide est un mode de l’appel existant, pas une seconde fonction", () => {
  assert.match(index, /if \(corps\.mode === "aide"\) return await repondreAide\(corps\);/);
  /* Il réutilise la réservation et le plafond : c’est toute la raison de ne
     pas avoir ouvert une seconde porte. */
  assert.match(index, /async function repondreAide[\s\S]{0,2000}reserverAppel\(\)/);
  assert.match(index, /async function repondreAide[\s\S]{0,3000}cloturerAppel\(true\)/);
  /* Une seule déclaration de la clé Gemini dans tout le fichier. */
  assert.equal((index.match(/Deno\.env\.get\("GEMINI_API_KEY"\)/g) || []).length, 1);
});

test("aucun outil de recherche n’est donné au modèle en mode Aide", () => {
  /* Lui tendre une porte sur le web serait lui donner de quoi inventer une
     adresse — très exactement ce que ce mode lui interdit. */
  const bloc = index.slice(index.indexOf("async function repondreAide"),
                           index.indexOf("Deno.serve("));
  assert.ok(!bloc.includes("google_search"),
    "le mode Aide ne déclare aucun outil de recherche");
  assert.match(bloc, /body: JSON\.stringify\(\{model: MODELE, input: inviteAide\(contexte\)\}\)/);
});

test("l’invite dit la liste fermée, et ne dit qu’elle", () => {
  const texte = inviteAide(CONTEXTE);
  assert.ok(texte.includes("Croix-Rouge Française"), "les candidats y sont");
  assert.ok(texte.includes("osmnode1") && texte.includes("osmnode2"));
  assert.ok(texte.includes("Tourcoing"), "la commune situe la demande");
  assert.ok(texte.includes("5000"), "le rayon aussi");
  assert.ok(texte.includes("j’ai rien à manger"), "et les mots de la personne");
  assert.ok(texte.includes("Ne jamais inventer"), "les règles sont dans l’invite");
  assert.ok(/liste FERMÉE/.test(texte));
});

test("un identifiant que le serveur n’a pas envoyé ne ressort pas de lui", () => {
  const lu = lireOrdreAide(JSON.stringify({
    primaryNeed: "manger",
    secondaryNeeds: ["logement", "categorie-inventee"],
    rankedPlaceIds: ["osmnode1", "structure-fantome"],
    rejectedPlaceIds: ["osmnode2"],
    explanations: { osmnode1: "banque alimentaire", fantome: "ouvre à 9h" },
  }), CONTEXTE);
  assert.deepEqual(lu.rankedPlaceIds, ["osmnode1"]);
  assert.deepEqual(lu.rejectedPlaceIds, ["osmnode2"]);
  assert.deepEqual(lu.secondaryNeeds, ["logement"]);
  assert.deepEqual(Object.keys(lu.explanations), ["osmnode1"]);
  assert.equal(lu.ecartes, 3, "trois tentatives hors cadre, comptées");
});

test("une réponse illisible ne renverse rien", () => {
  const lu = lireOrdreAide("je ne sais pas répondre en JSON", CONTEXTE);
  assert.deepEqual(lu.rankedPlaceIds, []);
  assert.equal(lu.primaryNeed, null);
});

test("les identifiants permis sont recalculés côté serveur", () => {
  /* Laisser le client fournir sa propre liste de permis reviendrait à le
     laisser ouvrir la porte qu’elle est censée fermer. */
  assert.match(index, /allowedPlaceIds: \[\.\.\.permis\]/);
  assert.match(index, /const permis = new Set\(candidats\.map\(\(x\) => x\.id\)\)/);
});

test("ce qu’on consigne du mode Aide, ce sont des nombres", () => {
  const bloc = index.slice(index.indexOf("async function repondreAide"),
                           index.indexOf("Deno.serve("));
  assert.match(bloc, /trace\("aide_classee", \{[\s\S]{0,200}candidats:/);
  assert.ok(!/trace\([^)]*userFreeText/.test(bloc),
    "la phrase de la personne n’entre dans aucune trace");
  assert.ok(!bloc.includes("ecrire("),
    "rien du mode Aide n’est écrit en base : la demande est privée et éphémère");
});
