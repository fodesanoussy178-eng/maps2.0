/* ---------------------------------------------------------------------------
   enrichir-lieu — aller lire ce qu'OpenStreetMap ne sait pas

   LE DÉFAUT QU'ELLE CORRIGE

   « Maintenant » ne fait entrer que des lieux dont on sait qu'ils sont
   ouverts, et c'est une bonne règle : envoyer quelqu'un devant une porte close
   est exactement ce qu'on veut éviter. Mais la plupart des lieux
   d'OpenStreetMap n'ont aucun horaire, et beaucoup en ont d'anciens. Le musée
   qui a changé ses horaires en septembre reste fermé le mardi dans nos données
   depuis 2019 ; la salle qui rouvre après travaux n'existe plus pour nous ; et
   l'exposition en cours n'apparaît nulle part, parce qu'aucun catalogue ne la
   publie.

   Ces choses-là sont écrites, en français, sur des pages officielles. C'est ce
   qu'un modèle ancré sur la recherche sait aller lire — et c'est tout ce qu'on
   lui demande de faire. Il ne raconte pas le lieu : il rapporte ce qu'une page
   affirme, avec l'adresse de cette page.

   CE QU'ELLE NE FAIT PAS

     · elle n'enrichit pas une zone : elle répond sur UN lieu, choisi par le
       client parce qu'il est en tête de classement ET qu'une information
       critique lui manque ;
     · elle n'écrit jamais dans `publications` ni dans `events` ;
     · elle ne nomme aucune ville ;
     · et elle n'attend jamais : le client demande, puis continue. La réponse
       arrive plus tard, ou pas.

   TROIS DÉPENSES, TROIS GARDE-FOUS

   1. UN APPEL COÛTE DE L'ARGENT ET DES SECONDES. Toute réponse est donc
      conservée dans `place_enrichments`, y compris « je n'ai rien trouvé » —
      sans quoi les lieux muets seraient les plus coûteux de tous.

   2. LA ROUTE EST OUVERTE À QUI DÉTIENT LA CLÉ PUBLIABLE, c'est-à-dire à tout
      le monde. Un budget quotidien plafonne donc le nombre d'appels réels ;
      au-delà, la fonction sert le cache et le dit. Le pire cas est une journée
      sans enrichissement, jamais une facture.

   3. LE NOM DU LIEU VIENT DU CLIENT, donc d'un inconnu. Il est nettoyé avant
      d'approcher l'invite : ni saut de ligne, ni caractère de contrôle, ni
      ponctuation qui permette d'écrire une consigne. Le reste de l'invite est
      écrit ici et ne contient rien qui vienne de la requête.

   Voir autour/docs/enrichissement-ia.md.
--------------------------------------------------------------------------- */

import {
  cleLieu, construireFait, extraireObjet, invite, ligneEnrichissement,
} from "./extraction.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CLE_GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";

const MODELE = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";
const POINT_DE_TERMINAISON =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:generateContent`;

/* Le temps laissé au modèle. Il ne borne plus l'attente de personne : depuis
   que la vérification part en tâche de fond, ce nombre borne un travail que le
   navigateur n'attend pas. Aller lire trois pages officielles prend des
   dizaines de secondes — c'est le métier de cette source, pas une lenteur
   qu'on réglerait en montant le délai d'un cran de plus. */
const DELAI_MS = 60_000;

/* Le plafond du jour. Il ne protège pas d'un abus ciblé — rien ne le fait sur
   une route publique — il garantit que le pire cas reste borné et connu. */
const BUDGET_JOUR = Number(Deno.env.get("ENRICHISSEMENT_BUDGET_JOUR") ?? "400");

/* La clé d'écriture, lue paresseusement : une configuration incomplète ne doit
   pas faire échouer la fonction entière, seulement l'écriture. */
let cleMemorisee: string | null = null;

function cleSecrete(): string {
  if (cleMemorisee) return cleMemorisee;
  cleMemorisee = lireCleSecrete();
  return cleMemorisee;
}

function lireCleSecrete(): string {
  const dictionnaire = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dictionnaire) {
    try {
      const clés = JSON.parse(dictionnaire) as Record<string, string>;
      const nommée = Deno.env.get("SUPABASE_SECRET_KEY_NAME") ?? "default";
      if (clés[nommée]) return clés[nommée];
      const disponibles = Object.keys(clés).join(", ") || "aucune";
      throw new Error(`clé secrète « ${nommée} » absente (disponibles : ${disponibles})`);
    } catch (erreur) {
      if (erreur instanceof SyntaxError) throw new Error("SUPABASE_SECRET_KEYS illisible");
      throw erreur;
    }
  }
  const unique = Deno.env.get("SUPABASE_SECRET_KEY");
  if (unique) return unique;
  throw new Error("aucune clé secrète : SUPABASE_SECRET_KEYS attendue");
}

function rest(chemin: string, init: RequestInit = {}): Promise<Response> {
  const cle = cleSecrete();
  return fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: cle,
      Authorization: `Bearer ${cle}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/* ---- CORS ---------------------------------------------------------------
   Appelée depuis le navigateur : sans ceci, la requête n'existe même pas. */
const ENTETES = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reponse(charge: unknown, statut = 200, cache = "no-store") {
  return new Response(JSON.stringify(charge),
    {status: statut, headers: {...ENTETES, "Cache-Control": cache}});
}

/* ---- Le nettoyage de ce qui vient du client ------------------------------
   Une invite est du texte, et du texte reçu d'un inconnu est une consigne
   potentielle. On ne se défend pas par une liste de phrases interdites — elle
   serait toujours en retard d'une tournure — mais en réduisant l'alphabet :
   sans saut de ligne ni caractère de contrôle, on n'écrit pas d'instruction
   qui ressemble à la nôtre. */
/* Les caractères de contrôle se retirent en parcourant les points de code,
   pas avec une classe d'échappements dans une expression régulière : celle-ci
   survit mal aux allers-retours entre outils, et une expression régulière
   silencieusement cassée ne protège plus rien du tout. */
function sansControle(texte: string): string {
  let sortie = "";
  for (const caractere of texte) {
    const code = caractere.codePointAt(0) ?? 0;
    // C0, DEL, et les séparateurs de ligne et de paragraphe Unicode
    sortie += (code < 32 || code === 127 || code === 8232 || code === 8233)
      ? " " : caractere;
  }
  return sortie;
}

function propre(valeur: unknown, maximum: number): string {
  return sansControle(String(valeur ?? ""))
    .replace(/[{}[\]<>|\\^~`"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function nombre(valeur: unknown, max: number): number | null {
  if (valeur == null || String(valeur).trim() === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

/* ---- Cache --------------------------------------------------------------- */
const CHAMPS = "place_key,place_name,commune,category,lat,lng,current_status," +
  "today_hours,opening_hours,next_open_at,temporary_closed,closure_reason," +
  "closure_until,programme_now,programme_soon,ticket_url,official_url," +
  "source_priority,sources,confidence,last_verified_at,checked_at,expires_at";

async function enCache(cle: string): Promise<Record<string, unknown> | null> {
  const r = await rest(
    `place_enrichments?select=${CHAMPS}&place_key=eq.${encodeURIComponent(cle)}&limit=1`);
  if (!r.ok) return null;
  const lignes = await r.json();
  return lignes?.[0] ?? null;
}

/* Combien d'appels réels aujourd'hui ? `checked_at` est réécrit à chaque
   passage : compter les lignes fraîches compte donc les appels, sans table de
   plus et sans compteur à maintenir. */
async function consommeAujourdhui(): Promise<number> {
  const debutDuJour = new Date();
  debutDuJour.setUTCHours(0, 0, 0, 0);
  const r = await rest(
    `place_enrichments?select=id&checked_at=gte.${debutDuJour.toISOString()}`,
    {headers: {Prefer: "count=exact", Range: "0-0"}});
  const plage = r.headers.get("content-range") ?? "";
  const total = Number(plage.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function ecrire(ligne: Record<string, unknown>) {
  const r = await rest("place_enrichments?on_conflict=place_key", {
    method: "POST",
    headers: {Prefer: "resolution=merge-duplicates,return=representation"},
    body: JSON.stringify([ligne]),
  });
  if (!r.ok) throw new Error(`écriture : HTTP ${r.status} ${await r.text()}`);
  return (await r.json())?.[0] ?? ligne;
}

/* ---- L'appel au modèle --------------------------------------------------- */
function sourcesAncrage(candidat: unknown): {url: string; titre: string}[] {
  const meta = (candidat as {groundingMetadata?: {groundingChunks?: unknown[]}})
    ?.groundingMetadata ?? {};
  const morceaux = Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [];
  const sorties: {url: string; titre: string}[] = [];
  for (const morceau of morceaux) {
    const web = (morceau as {web?: {uri?: string; title?: string}})?.web;
    if (!web?.uri) continue;
    sorties.push({url: String(web.uri), titre: String(web.title ?? "")});
  }
  return sorties;
}

/* LES REQUÊTES RÉELLEMENT TAPÉES.

   `groundingChunks` dit quelles pages ont été citées ; `webSearchQueries` dit
   si le modèle est seulement allé chercher. Les deux vides ne se lisent pas
   pareil : rien cherché est un défaut d'invite, cherché sans rien trouver est
   un lieu dont le web ne parle pas. On les compte séparément. */
function requetesRecherche(candidat: unknown): string[] {
  const meta = (candidat as {groundingMetadata?: {webSearchQueries?: unknown[]}})
    ?.groundingMetadata ?? {};
  const brutes = Array.isArray(meta.webSearchQueries) ? meta.webSearchQueries : [];
  return brutes.map((q) => String(q ?? "").trim()).filter(Boolean);
}

function texteDe(candidat: unknown): string {
  const parties = (candidat as {content?: {parts?: {text?: string}[]}})
    ?.content?.parts ?? [];
  return parties.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
}

async function interroger(lieu: Record<string, unknown>, maintenant: number) {
  const r = await fetch(POINT_DE_TERMINAISON, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // en en-tête, jamais dans une URL : une URL se journalise
      "x-goog-api-key": CLE_GEMINI,
    },
    body: JSON.stringify({
      contents: [{role: "user", parts: [{text: invite(lieu, {maintenant})}]}],
      // l'ancrage : c'est lui qui transforme une génération en lecture
      tools: [{google_search: {}}],
      /* CE QU'ON NE RÈGLE PLUS.

         `temperature: 0.1` et `maxOutputTokens: 1400` étaient les réglages
         d'une extraction courte : on voulait une réponse sobre et brève. Mais
         ce modèle raisonne avant de répondre, et ses jetons de réflexion se
         paient sur le même budget de sortie. Un plafond serré ne raccourcit
         alors pas la réponse : il ampute le raisonnement — dont la décision
         d'aller chercher. Et une température écrasée pousse au chemin le plus
         probable, qui est de répondre de mémoire.

         On ne demande donc plus rien de tout cela. Le seul garde-fou de coût
         qui compte ici est le budget quotidien, pas la longueur d'une réponse.
         `thinkingLevel: "low"` dit ce qu'est vraiment la tâche : chercher,
         lire, extraire — pas méditer. */
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: {thinkingLevel: "low"},
      },
    }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!r.ok) throw new Error(`modèle : HTTP ${r.status}`);
  const json = await r.json();
  const candidat = (json.candidates ?? [])[0];
  return {
    sources: sourcesAncrage(candidat),
    requetes: requetesRecherche(candidat),
    texte: texteDe(candidat),
  };
}

/* ---- Le travail de fond ---------------------------------------------------

   POURQUOI LA RÉPONSE N'ATTEND PLUS.

   Interroger un modèle ancré sur la recherche, c'est lui laisser le temps
   d'aller lire des pages. Tant que la réponse HTTP attendait ce travail, la
   seule question était de savoir qui abandonnerait le premier — le navigateur
   à vingt secondes, ou `AbortSignal` juste après. Monter les deux d'un cran
   n'aurait fait que déplacer la course.

   `EdgeRuntime.waitUntil` demande au runtime de garder l'isolat en vie APRÈS
   la réponse, le temps que la promesse se règle. Sans lui, rendre la réponse
   tuerait le travail en cours : une promesse flottante n'est pas une tâche de
   fond, c'est une tâche qu'on abandonne.

   Le repli ne réintroduit surtout pas l'attente — attendre est exactement le
   défaut qu'on corrige. Là où `waitUntil` n'existe pas (un `deno serve` local,
   un runtime plus ancien), on lance quand même : le travail vaut alors ce que
   vaut la durée de vie de l'isolat, ce qui est plus que rien et n'a coûté
   aucune seconde au navigateur. */
const RUNTIME = (globalThis as {
  EdgeRuntime?: {waitUntil?: (promesse: Promise<unknown>) => void};
}).EdgeRuntime;

function enTacheDeFond(travail: Promise<unknown>) {
  /* `verifier` avale déjà ses propres pannes ; ce `catch` ne couvre qu'un
     rejet inattendu, pour qu'aucune promesse ne parte non gérée. */
  const sur = travail.catch(() => {});
  const garder = RUNTIME?.waitUntil;
  if (typeof garder === "function") {
    try { garder.call(RUNTIME, sur); } catch { /* on continue sans */ }
  }
}

type Lieu = {
  cle: string; nom: string; lat: number; lng: number;
  commune: string; adresse: string; categorie: string; horairesConnus: string;
};

/* ---- La trace ------------------------------------------------------------
   UN TRAVAIL DE FOND QUI S'ARRÊTE S'ARRÊTE EN SILENCE.

   Il ne rend rien à personne : ni au navigateur, qui est déjà reparti, ni à la
   base, puisque justement il n'y arrive pas. Ces six étapes sont donc le seul
   endroit d'où l'on peut apprendre où il s'interrompt — modèle injoignable,
   réponse sans page citée, écriture refusée, ou isolat coupé avant la fin,
   auquel cas la trace s'arrête d'elle-même à la dernière étape franchie.

   Elles vont dans les journaux de la fonction. Pas de table de diagnostic :
   une table de plus serait une table à purger, à migrer et à surveiller, pour
   une question qu'on se pose une fois.

   CE QU'ELLES NE CONTIENNENT JAMAIS : aucune clé, aucun en-tête, aucun corps
   de réponse, aucune invite, aucun texte rendu par le modèle. Un message
   d'erreur est construit par notre propre code — on le tronque quand même,
   parce qu'un message venu d'ailleurs pourrait un jour recopier ce qu'on lui a
   envoyé. `place_key` est là pour relier les lignes entre elles : c'est un nom
   de lieu et une position arrondie, la donnée la plus publique qui soit. */
function trace(etape: string, details: Record<string, unknown> = {}, grave = false) {
  const ligne = JSON.stringify({fonction: "enrichir-lieu", etape, ...details});
  if (grave) console.error(ligne); else console.log(ligne);
}

/* De quoi reconnaître une source dans un journal, et rien de plus : le domaine
   et le titre de la page, borné. Ce sont des métadonnées publiques — pas le
   contenu lu, pas l'URL complète avec ses paramètres. */
function domainesSources(sources: {url: string; titre: string}[]): string[] {
  return sources.slice(0, 5).map((source) => {
    let hote = "?";
    try { hote = new URL(source.url).hostname.replace(/^www\./, ""); } catch { /* garde ? */ }
    const titre = String(source.titre ?? "").slice(0, 60);
    return titre ? `${hote} — ${titre}` : hote;
  });
}

async function verifier(lieu: Lieu) {
  const debut = Date.now();
  try {
    trace("gemini_start", {place_key: lieu.cle, modele: MODELE});
    const {sources, requetes, texte} = await interroger(lieu, debut);
    /* La longueur du texte, pas le texte. Et les deux compteurs séparément :
       `search_queries` dit si le modèle est allé chercher, `sources` dit s'il a
       trouvé. Confondre les deux, c'est confondre un défaut d'invite avec un
       lieu dont le web ne parle pas. */
    trace("gemini_response", {place_key: lieu.cle, duree_ms: Date.now() - debut,
                              search_queries: requetes.length,
                              sources: sources.length, texte_len: texte.length,
                              domaines: domainesSources(sources)});

    /* AUCUNE RECHERCHE LANCÉE. Le modèle a répondu de mémoire, et une
       information locale et actuelle ne se connaît pas : elle se lit. On
       n'écrit rien — pas même un « inconnu », qui laisserait croire qu'on a
       cherché. Le lieu sera redemandé, et l'invite dit maintenant en toutes
       lettres qu'il faut chercher d'abord. */
    if (!requetes.length) {
      trace("no_search", {place_key: lieu.cle, texte_len: texte.length});
      return;
    }

    const fait = construireFait(extraireObjet(texte),
      {sources, nom: lieu.nom, commune: lieu.commune, maintenant: debut});

    /* Cherché, mais aucune page citée : le web ne dit rien d'exploitable sur ce
       lieu, ou la recherche n'a rien ramené cette fois. On n'écrit rien non
       plus — une réponse non ancrée ne prouve pas que le lieu est muet. */
    if (!fait) {
      trace("no_fact", {place_key: lieu.cle, search_queries: requetes.length,
                        sources: sources.length});
      return;
    }

    trace("write_start", {place_key: lieu.cle});
    await ecrire(ligneEnrichissement(fait, lieu,
      {maintenant: debut, modele: MODELE, duree: Date.now() - debut}));
    trace("write_success", {place_key: lieu.cle, duree_ms: Date.now() - debut});
  } catch (erreur) {
    /* Plus personne n'attend : une panne du modèle ne peut plus rien casser en
       aval. On la note — le message seul, tronqué — et le lieu sera redemandé
       quand son entrée aura expiré. Autour, lui, continue d'afficher ce qu'il
       affichait. */
    trace("background_error", {place_key: lieu.cle,
      message: String(erreur instanceof Error ? erreur.message : erreur).slice(0, 300),
    }, true);
  }
}

/* ------------------------------------------------------------------------ */

Deno.serve(async (requete: Request) => {
  if (requete.method === "OPTIONS") return new Response(null, {headers: ENTETES});
  if (requete.method !== "POST") return reponse({error: "méthode non permise"}, 405);

  let corps: Record<string, unknown>;
  try {
    corps = await requete.json();
  } catch {
    return reponse({error: "corps illisible"}, 400);
  }

  const nom = propre(corps.nom, 120);
  const lat = nombre(corps.lat, 90);
  const lng = nombre(corps.lng, 180);
  /* `Number(null)` vaut zéro : sans le test d'absence, une coordonnée
     MANQUANTE deviendrait le point (0, 0) et on irait chercher ce qui s'y
     passe, au large du golfe de Guinée. */
  if (nom.length < 2 || lat == null || lng == null) {
    return reponse({error: "lieu incomplet"}, 400);
  }

  /* La clé est recalculée ICI. Celle du client sert à lire son propre cache ;
     lui laisser choisir sous quelle clé on écrit reviendrait à le laisser
     écraser l'enrichissement d'un autre lieu. */
  const cle = cleLieu(nom, lat, lng);
  if (!cle) return reponse({error: "lieu incomplet"}, 400);

  const lieu = {
    cle, nom, lat, lng,
    commune: propre(corps.commune, 80),
    adresse: propre(corps.adresse, 160),
    categorie: propre(corps.categorie, 40),
    horairesConnus: propre(corps.horaires, 200),
  };

  /* Le cache d'abord, toujours. C'est le cas le plus fréquent et le seul qui
     soit gratuit. */
  let cache: Record<string, unknown> | null = null;
  try {
    cache = await enCache(cle);
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    return reponse({error: `configuration : ${message}`}, 503);
  }
  const maintenant = Date.now();
  if (cache && Date.parse(String(cache.expires_at)) > maintenant) {
    return reponse({enrichissement: cache, origine: "cache", actif: true});
  }

  /* Pas de clé : ce n'est pas une panne, c'est une source absente. On rend ce
     qu'on a — fût-il périmé, il reste vrai plus souvent que rien — et le
     client n'a aucun cas particulier à traiter. */
  if (!CLE_GEMINI) {
    return reponse({enrichissement: cache, origine: "cache", actif: false,
                    raison: "source non configurée"});
  }

  if (await consommeAujourdhui() >= BUDGET_JOUR) {
    return reponse({enrichissement: cache, origine: "cache", actif: false,
                    raison: "budget du jour atteint"});
  }

  /* ---- On lance, et on rend la main --------------------------------------
     Le navigateur repart tout de suite avec ce qu'on a : l'entrée périmée si
     elle existe — elle reste vraie plus souvent que rien — ou `null`. Dans les
     deux cas `actif: true`, parce que quelque chose est bien en route.

     Le résultat, lui, s'écrira dans `place_enrichments`, et c'est la vague
     suivante qui l'y lira, par le chemin qu'elle emprunte déjà pour toute
     entrée en cache. Rien à brancher de plus, aucun second circuit. */
  enTacheDeFond(verifier(lieu));
  return reponse({enrichissement: cache, origine: "cache", actif: true,
                  raison: "verification_lancee"});
});
