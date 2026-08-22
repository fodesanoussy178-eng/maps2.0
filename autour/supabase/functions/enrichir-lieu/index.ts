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
  cleLieu, construireFait, extraireObjet, invite, inviteAide,
  ligneEnrichissement, lireOrdreAide,
} from "./extraction.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CLE_GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";

const MODELE = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";

/* L'INTERACTIONS API, ET POURQUOI ON A CHANGÉ DE PORTE.

   Sur `generateContent`, `tools:[{google_search:{}}]` était accepté sans une
   erreur — et sans effet : deux campagnes de mesure, invite renforcée puis
   `generationConfig` désarmé, et `webSearchQueries` restait vide à chaque fois.
   Un outil qu'on déclare, que l'API ne refuse pas, et que le modèle n'appelle
   jamais, n'est pas un outil mal utilisé : c'est un outil qui n'est pas là.

   Sur `/interactions`, la recherche n'est plus une option de génération : c'est
   une étape que le modèle exécute et qu'il rend dans sa réponse. Le modèle
   passe donc du chemin d'URL au corps de la requête. */
const POINT_DE_TERMINAISON =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

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

/* ---- LE BUDGET, RÉSERVÉ AVANT L'APPEL -------------------------------------

   CE QUI N'ALLAIT PAS. On comptait les LIGNES écrites dans `place_enrichments`
   depuis minuit. Trois façons de ne rien borner du tout :

     · un appel qui ÉCHOUE n'écrit rien, donc ne comptait pas — alors qu'il a
       été payé ;
     · un appel qui NE TROUVE RIEN pour un lieu déjà connu réécrit la même
       ligne : le compteur n'avançait pas, l'appel avait pourtant eu lieu ;
     · lire puis décider n'est pas atomique. Dix requêtes simultanées lisaient
       toutes « 399 » et partaient toutes les dix.

   LA RÈGLE VOULUE, ET CELLE QUI EST APPLIQUÉE ICI :

       réserver 1 appel
       ↓
       si budget disponible → Gemini
       si plafond atteint   → aucun appel

   La réservation est un seul UPDATE conditionnel côté base
   (`reserver_enrichissement`) : c'est le verrou de ligne qui rend l'opération
   atomique, pas une politesse entre isolats. Ce qui est réservé est consommé :
   un appel qui ne trouve rien compte, un appel qui échoue compte. Le budget ne
   se rend jamais — un appel payé reste payé. */
type Reservation = {accorde: boolean; lances: number; plafond: number};

async function reserverAppel(): Promise<Reservation> {
  const r = await rest("rpc/reserver_enrichissement", {
    method: "POST",
    body: JSON.stringify({p_plafond: BUDGET_JOUR}),
  });
  if (!r.ok) {
    /* Le compteur est injoignable. On ne lance PAS : un plafond qu'on ne sait
       pas lire n'est pas un plafond, et le pire cas doit rester une journée
       sans enrichissement, jamais une facture. */
    trace("budget_indisponible", {statut: r.status}, true);
    return {accorde: false, lances: 0, plafond: BUDGET_JOUR};
  }
  const lignes = await r.json();
  const ligne = Array.isArray(lignes) ? lignes[0] : lignes;
  return {
    accorde: !!(ligne && ligne.accorde),
    lances: Number(ligne?.lances ?? 0),
    plafond: Number(ligne?.plafond ?? BUDGET_JOUR),
  };
}

/* L'issue d'un appel déjà réservé. « Rien trouvé » est un succès d'exécution :
   il a coûté, il est déjà compté dans `lances`, et il est consigné comme tel. */
async function cloturerAppel(succes: boolean): Promise<void> {
  try {
    await rest("rpc/cloturer_enrichissement", {
      method: "POST",
      body: JSON.stringify({p_succes: succes}),
    });
  } catch { /* une statistique manquante ne casse rien */ }
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

/* ---- L'appel au modèle ---------------------------------------------------

   LA RÉPONSE EST UNE SUITE D'ÉTAPES, PAS UN CANDIDAT UNIQUE.

   Le modèle cherche, lit, puis répond, et chaque moment laisse sa trace dans
   `steps`. On y prend trois choses : le texte, la preuve qu'une recherche a eu
   lieu, et les pages citées.

   On lit une surface jeune, dont on n'a pas pu vérifier le schéma exact depuis
   ici. Les lecteurs ci-dessous tolèrent donc que les noms de champs varient —
   et journalisent la forme réellement reçue, pour qu'un premier appel suffise
   à les resserrer. Ce qu'ils ne tolèrent pas, c'est d'inventer une source :
   une entrée sans URL n'en est pas une, et `construireFait` reste seul juge. */

function etapesDe(json: unknown): Record<string, unknown>[] {
  const j = (json ?? {}) as {steps?: unknown; outputs?: unknown};
  const brut = Array.isArray(j.steps) ? j.steps
    : Array.isArray(j.outputs) ? j.outputs : [];
  return brut.filter((e): e is Record<string, unknown> =>
    !!e && typeof e === "object");
}

const typeEtape = (etape: Record<string, unknown>) => String(etape.type ?? "");

/* Le texte final : les parties textuelles des étapes de sortie, dans l'ordre. */
function texteDesEtapes(etapes: Record<string, unknown>[]): string {
  let sortie = "";
  for (const etape of etapes) {
    if (typeEtape(etape) !== "model_output") continue;
    const contenu = Array.isArray(etape.content) ? etape.content : [];
    for (const part of contenu) {
      const t = (part as {text?: unknown})?.text;
      if (typeof t === "string") sortie += t;
    }
  }
  return sortie;
}

/* Les requêtes tapées. Le nom du champ n'est pas garanti, alors on ramasse les
   chaînes de l'étape d'appel — mais la PREUVE qu'une recherche a eu lieu, elle,
   est l'existence même de l'étape. C'est sur elle qu'on tranchera, pas sur le
   succès d'une extraction de libellé. */
function requetesDesEtapes(etapes: Record<string, unknown>[]): string[] {
  const sorties: string[] = [];
  for (const etape of etapes) {
    if (typeEtape(etape) !== "google_search_call") continue;
    /* `arguments.queries` : c'est là qu'elles sont, la mesure l'a dit. Les
       autres noms restent en repli, ils ne coûtent rien. */
    const args = (etape.arguments ?? etape.args ?? {}) as Record<string, unknown>;
    for (const valeur of [args.queries, args.query, etape.queries, etape.query]) {
      if (typeof valeur === "string" && valeur.trim()) sorties.push(valeur.trim());
      else if (Array.isArray(valeur)) {
        for (const q of valeur) {
          if (typeof q === "string" && q.trim()) sorties.push(q.trim());
        }
      }
    }
  }
  return [...new Set(sorties)];
}

/* Les pages citées. On descend dans les étapes D'OUTIL à la recherche de tout
   ce qui porte une URL. Plusieurs noms de champ sont acceptés parce qu'on lit
   une surface jeune — mais la valeur, elle, doit être une vraie adresse web :
   une chaîne quelconque nommée `source` n'est pas une source.

   La descente est bornée : ni plus de vingt sources, ni plus de six niveaux. */
const NOMS_DE_LIEN = ["url", "uri", "link", "source_url", "sourceUrl", "web_url"];

function collecterLiens(valeur: unknown, sorties: {url: string; titre: string}[],
                        profondeur = 0): void {
  if (sorties.length >= 20 || profondeur > 6) return;
  if (!valeur || typeof valeur !== "object") return;
  if (Array.isArray(valeur)) {
    for (const v of valeur) collecterLiens(v, sorties, profondeur + 1);
    return;
  }
  const o = valeur as Record<string, unknown>;
  let lien = "";
  for (const nom of NOMS_DE_LIEN) {
    const v = o[nom];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) { lien = v; break; }
  }
  if (lien) {
    sorties.push({url: lien,
      titre: String(o.title ?? o.titre ?? o.domain ?? o.name ?? "")});
  }
  for (const v of Object.values(o)) collecterLiens(v, sorties, profondeur + 1);
}

/* LES ÉTAPES D'OUTIL, PAS LA PAROLE DU MODÈLE.

   `model_output` et `thought` sont ce que le modèle DIT ; y ramasser des URL
   reviendrait à le laisser fabriquer ses propres citations — exactement ce que
   la règle « aucune donnée sans source » interdit. Une source est une page que
   la recherche a rapportée, pas une adresse que le modèle a écrite. */
const ETAPES_OUTIL = new Set(["google_search_call", "google_search_result"]);

/* LES CITATIONS STRUCTURÉES, ET POURQUOI C'EST LÀ QU'ELLES SONT.

   La mesure a montré que l'étape de résultat ne porte rien d'exploitable :
   `google_search_result.result[]` ne contient que `search_suggestions`. Les
   vraies sources sont attachées au CONTENU DE SORTIE, sous forme
   d'annotations — des objets que l'API pose elle-même à côté du texte, avec
   `type: "url_citation"`.

   LA DISTINCTION AVEC LE TEXTE N'EST PAS FORMELLE, C'EST TOUTE LA RÈGLE.

   Une URL écrite dans `content.text` est une adresse que le MODÈLE a tapée :
   il peut l'inventer, et une citation inventée est exactement ce que
   « aucune donnée sans source » interdit. Une annotation est une page que la
   recherche a réellement rapportée, posée par l'API et non par le modèle. On
   ne lit donc que le tableau `annotations`, jamais `text` — et on n'accepte
   que ce qui s'y annonce comme `url_citation`. */
function citationsDesEtapes(etapes: Record<string, unknown>[]) {
  const sorties: {url: string; titre: string}[] = [];
  for (const etape of etapes) {
    if (typeEtape(etape) !== "model_output") continue;
    const contenu = Array.isArray(etape.content) ? etape.content : [];
    for (const bloc of contenu) {
      const brutes = (bloc as {annotations?: unknown})?.annotations;
      if (!Array.isArray(brutes)) continue;
      for (const annotation of brutes) {
        if (!annotation || typeof annotation !== "object") continue;
        const a = annotation as Record<string, unknown>;
        if (String(a.type ?? "") !== "url_citation") continue;
        const lien = typeof a.url === "string" ? a.url
          : typeof a.uri === "string" ? a.uri : "";
        /* Une annotation sans adresse web n'est pas une source. */
        if (!/^https?:\/\//i.test(lien)) continue;
        sorties.push({url: lien, titre: String(a.title ?? a.titre ?? "")});
        if (sorties.length >= 20) return sorties;
      }
    }
  }
  return sorties;
}

function sourcesDesEtapes(etapes: Record<string, unknown>[]) {
  /* Les annotations d'abord : c'est la source d'autorité. */
  const citations = citationsDesEtapes(etapes);
  if (citations.length) return citations;

  /* Repli, pour le jour où l'API poserait les liens dans l'étape d'outil
     plutôt qu'en annotation. Il ne ramasse que de vraies adresses, et jamais
     dans `model_output` ni `thought` — la parole du modèle reste hors jeu. */
  const sorties: {url: string; titre: string}[] = [];
  for (const etape of etapes) {
    if (!ETAPES_OUTIL.has(typeEtape(etape))) continue;
    collecterLiens(etape, sorties);
  }
  return sorties;
}

/* LA FORME REÇUE, EN NOMS DE CLÉS SEULEMENT.

   On lit une surface dont on n'a pas la spécification depuis ici : plutôt que
   de deviner une fois de plus, on fait dire à la réponse comment elle est
   faite. Des NOMS, jamais des valeurs — aucune page, aucun extrait, aucun mot
   du modèle ne passe par là. */
function formeDe(valeur: unknown, chemin: string, sorties: Set<string>,
                 profondeur = 0): void {
  if (sorties.size >= 40 || profondeur > 3) return;
  if (!valeur || typeof valeur !== "object") return;
  if (Array.isArray(valeur)) {
    /* TOUS les éléments, pas seulement le premier : un tableau peut mêler des
       formes, et c'est précisément celle qu'on ne voit pas qui nous manque. */
    for (const v of valeur.slice(0, 6)) formeDe(v, `${chemin}[]`, sorties, profondeur);
    return;
  }
  const o = valeur as Record<string, unknown>;
  sorties.add(`${chemin}{${Object.keys(o).sort().join("|")}}`);
  for (const [nom, v] of Object.entries(o)) {
    formeDe(v, `${chemin}.${nom}`, sorties, profondeur + 1);
  }
}

function clesDesEtapes(etapes: Record<string, unknown>[]): string[] {
  const sorties = new Set<string>();
  for (const etape of etapes.slice(0, 12)) {
    formeDe(etape, typeEtape(etape) || "?", sorties);
  }
  return [...sorties].slice(0, 30);
}

async function interroger(lieu: Record<string, unknown>, maintenant: number) {
  const r = await fetch(POINT_DE_TERMINAISON, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // en en-tête, jamais dans une URL : une URL se journalise
      "x-goog-api-key": CLE_GEMINI,
    },
    /* Le corps documenté, et rien de plus. On ne règle ni température, ni
       plafond de sortie, ni réflexion : la campagne précédente a montré que ce
       n'était pas là que ça se jouait, et le corps minimal est le test le plus
       propre de « l'outil part-il, oui ou non ». */
    body: JSON.stringify({
      model: MODELE,
      input: invite(lieu, {maintenant}),
      tools: [{type: "google_search"}],
    }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!r.ok) throw new Error(`modèle : HTTP ${r.status}`);
  const etapes = etapesDe(await r.json());
  return {
    sources: sourcesDesEtapes(etapes),
    citations: citationsDesEtapes(etapes).length,
    requetes: requetesDesEtapes(etapes),
    texte: texteDesEtapes(etapes),
    /* Combien d'étapes de recherche : la preuve, indépendante du nom des
       champs. Et les types d'étapes vus, pour resserrer les lecteurs. */
    appels: etapes.filter((e) => typeEtape(e) === "google_search_call").length,
    formes: [...new Set(etapes.map(typeEtape))].slice(0, 8),
    cles: clesDesEtapes(etapes),
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
    const {sources, citations, requetes, texte, appels, formes, cles} =
      await interroger(lieu, debut);
    /* La longueur du texte, pas le texte. Et les compteurs séparément :
       `search_calls` dit si le modèle est allé chercher, `sources` dit s'il a
       trouvé. Confondre les deux, c'est confondre un défaut de réglage avec un
       lieu dont le web ne parle pas. `formes` nomme les types d'étapes reçus —
       c'est ce qui permet de resserrer les lecteurs sans deviner. */
    trace("gemini_response", {place_key: lieu.cle, duree_ms: Date.now() - debut,
                              search_calls: appels,
                              search_queries: requetes.length,
                              annotation_citations: citations,
                              sources: sources.length, texte_len: texte.length,
                              domaines: domainesSources(sources), formes, cles});

    /* AUCUNE RECHERCHE LANCÉE. Le modèle a répondu de mémoire, et une
       information locale et actuelle ne se connaît pas : elle se lit. On
       n'écrit rien — pas même un « inconnu », qui laisserait croire qu'on a
       cherché.

       On tranche sur l'ÉTAPE de recherche, pas sur le libellé des requêtes :
       une étape présente dont on n'a pas su lire le champ reste une recherche
       faite, et la traiter en « rien cherché » serait une erreur de lecture
       maquillée en fait. */
    if (!appels && !requetes.length) {
      trace("no_search", {place_key: lieu.cle, texte_len: texte.length, formes});
      /* L'appel a eu lieu, il a coûté, et il n'a rien amélioré. Il est déjà
         compté dans `lances` ; ce qui se joue ici est seulement de savoir
         combien d'appels ont réellement servi. */
      await cloturerAppel(false);
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
      await cloturerAppel(false);
      return;
    }

    trace("write_start", {place_key: lieu.cle});
    await ecrire(ligneEnrichissement(fait, lieu,
      {maintenant: debut, modele: MODELE, duree: Date.now() - debut}));
    trace("write_success", {place_key: lieu.cle, duree_ms: Date.now() - debut});
    /* Le seul cas où un appel a réellement amélioré une information. C'est ce
       nombre-là qu'on veut pouvoir lire après la manifestation. */
    await cloturerAppel(true);
  } catch (erreur) {
    /* Plus personne n'attend : une panne du modèle ne peut plus rien casser en
       aval. On la note — le message seul, tronqué — et le lieu sera redemandé
       quand son entrée aura expiré. Autour, lui, continue d'afficher ce qu'il
       affichait. */
    trace("background_error", {place_key: lieu.cle,
      message: String(erreur instanceof Error ? erreur.message : erreur).slice(0, 300),
    }, true);
    /* Un appel qui échoue compte quand même : il a été réservé, il a été
       payé, et le budget ne se rend pas. */
    await cloturerAppel(false);
  }
}

/* ------------------------------------------------------------------------ */

/* ===========================================================================
   MODE AIDE — LE MÊME APPEL, UNE AUTRE QUESTION

   Le mode par défaut de cette fonction VÉRIFIE un lieu : il cherche sur le
   web, et il répond plus tard, en tâche de fond, parce que lire trois pages
   officielles prend des dizaines de secondes.

   Le mode Aide ne cherche rien. Il reçoit une liste fermée de structures que
   la taxonomie a déjà retenues, et il la remet dans l'ordre. C'est pour ça
   qu'il répond, lui, TOUT DE SUITE : il n'y a rien à aller lire, et un
   classement qui arriverait demain ne classerait plus rien.

   Il partage tout le reste avec l'autre mode : la clé qui ne quitte jamais
   Supabase, la réservation, le plafond du jour, la trace. C'est la raison
   d'être de ce mode plutôt que d'une seconde fonction.

   AUCUN OUTIL N'EST DONNÉ AU MODÈLE ICI. Pas de `google_search` : ce mode lui
   interdit d'inventer une structure ou une adresse, et lui tendre une porte
   sur le web serait lui donner de quoi le faire.

   RIEN DE CE QUE LA PERSONNE A ÉCRIT N'EST CONSERVÉ. La phrase libre sert à
   construire l'invite, et disparaît avec l'isolat : elle n'entre dans aucune
   table, aucune trace, aucune métrique. Ce qu'on compte, ce sont des nombres.
   =========================================================================== */

/* Le navigateur, lui, attend cette réponse — l'écran est déjà peint, mais
   l'ordre qu'on renvoie doit arriver pendant qu'on regarde encore. */
const DELAI_AIDE_MS = 15_000;

/* Des bornes, pas des vœux : tout ce qui suit vient du client. */
const MAX_CANDIDATS_AIDE = 40;

function candidatPropre(brut: Record<string, unknown>) {
  const id = propre(brut.id, 64);
  if (!id) return null;
  const osm: Record<string, string> = {};
  const tags = (brut.osm ?? {}) as Record<string, unknown>;
  Object.keys(tags).slice(0, 10).forEach((k) => {
    const cle = propre(k, 40), valeur = propre(tags[k], 40);
    if (cle && valeur) osm[cle] = valeur;
  });
  const capabilities: Record<string, boolean> = {};
  const caps = (brut.capabilities ?? {}) as Record<string, unknown>;
  Object.keys(caps).slice(0, 20).forEach((k) => {
    if (caps[k]) capabilities[propre(k, 40)] = true;
  });
  return {
    id,
    name: propre(brut.name, 80),
    category: propre(brut.category, 40) || null,
    distanceM: nombre(brut.distanceM, 1_000_000),
    confidence: nombre(brut.confidence, 1000) ?? 0,
    openingHours: propre(brut.openingHours, 60) || null,
    osm, capabilities,
  };
}

function contexteAidePropre(brut: unknown) {
  const c = (brut ?? {}) as Record<string, unknown>;
  const candidats = (Array.isArray(c.candidatePlaces) ? c.candidatePlaces : [])
    .slice(0, MAX_CANDIDATS_AIDE)
    .map((x) => candidatPropre((x ?? {}) as Record<string, unknown>))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const permis = new Set(candidats.map((x) => x.id));
  return {
    userLat: nombre(c.userLat, 90),
    userLng: nombre(c.userLng, 180),
    selectedCity: propre(c.selectedCity, 80) || null,
    currentRadius: nombre(c.currentRadius, 200_000),
    requestedHelpCategory: propre(c.requestedHelpCategory, 40) || null,
    userFreeText: propre(c.userFreeText, 300) || null,
    candidatePlaces: candidats,
    /* Les identifiants autorisés sont RECALCULÉS depuis les candidats retenus,
       jamais repris du client : lui laisser fournir sa propre liste de permis
       reviendrait à lui laisser ouvrir la porte qu'elle est censée fermer. */
    allowedPlaceIds: [...permis],
    allowedCategories: (Array.isArray(c.allowedCategories) ? c.allowedCategories : [])
      .slice(0, 30).map((x) => propre(x, 40)).filter(Boolean),
    rules: (Array.isArray(c.rules) ? c.rules : [])
      .slice(0, 12).map((x) => propre(x, 200)).filter(Boolean),
  };
}

async function repondreAide(corps: Record<string, unknown>) {
  const contexte = contexteAidePropre(corps.contexte);
  /* Rien à classer : on le dit, et on ne dépense rien. */
  if (contexte.candidatePlaces.length < 2) {
    return reponse({ordre: null, actif: false, raison: "trop peu de candidats"});
  }
  if (!CLE_GEMINI) {
    return reponse({ordre: null, actif: false, raison: "source non configurée"});
  }

  const reservation = await reserverAppel();
  if (!reservation.accorde) {
    trace("budget_atteint", {mode: "aide", lances: reservation.lances,
                            plafond: reservation.plafond});
    return reponse({ordre: null, actif: false, raison: "budget du jour atteint"});
  }

  const depart = Date.now();
  try {
    const r = await fetch(POINT_DE_TERMINAISON, {
      method: "POST",
      headers: {"Content-Type": "application/json", "x-goog-api-key": CLE_GEMINI},
      body: JSON.stringify({model: MODELE, input: inviteAide(contexte)}),
      signal: AbortSignal.timeout(DELAI_AIDE_MS),
    });
    if (!r.ok) throw new Error(`modèle : HTTP ${r.status}`);
    const texte = texteDesEtapes(etapesDe(await r.json()));
    const ordre = lireOrdreAide(texte, contexte);
    await cloturerAppel(true);
    /* Ce qu'on consigne : des nombres. Combien de candidats, combien retenus,
       combien d'identifiants inventés — jamais un nom, jamais la phrase. */
    trace("aide_classee", {
      candidats: contexte.candidatePlaces.length,
      retenus: ordre.rankedPlaceIds.length,
      ecartes: ordre.ecartes,
      duree: Date.now() - depart,
    }, ordre.ecartes > 0);
    return reponse({ordre, origine: "modele", actif: true});
  } catch (erreur) {
    await cloturerAppel(false);
    trace("aide_echec", {
      message: erreur instanceof Error ? erreur.message : "inconnue",
      duree: Date.now() - depart,
    }, true);
    /* Une panne du modèle n'est pas une panne d'Aide : le navigateur garde son
       propre ordre, qui est déjà à l'écran. */
    return reponse({ordre: null, actif: false, raison: "modele indisponible"});
  }
}

Deno.serve(async (requete: Request) => {
  if (requete.method === "OPTIONS") return new Response(null, {headers: ENTETES});
  if (requete.method !== "POST") return reponse({error: "méthode non permise"}, 405);

  let corps: Record<string, unknown>;
  try {
    corps = await requete.json();
  } catch {
    return reponse({error: "corps illisible"}, 400);
  }

  /* Aide passe par ici, et pas par une seconde fonction : voir la note du mode
     ci-dessus. Le reste du corps ne le concerne pas — il n'a pas de lieu, il a
     une liste. */
  if (corps.mode === "aide") return await repondreAide(corps);

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

  /* La réservation, avant tout le reste. Si elle est refusée, aucun appel ne
     part — et le client reçoit ce qu'on a, comme dans tous les autres cas où
     la vérification n'a pas lieu. Le mode territorial, lui, continue de
     fonctionner sans elle : c'est la condition posée dès le départ. */
  const reservation = await reserverAppel();
  if (!reservation.accorde) {
    trace("budget_atteint", {lances: reservation.lances, plafond: reservation.plafond});
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
