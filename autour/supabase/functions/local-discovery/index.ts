import {
  buildQueries, confidenceFor, coverageAssessment, deduplicate, normalizeText,
  urlDeriveeDunCourriel,
  preuveDansPage, publishable, sourceFingerprint, sourceType, texteDePage,
  verificationStatus,
} from "./discovery.mjs";
import { questionsOuvertes, rattacher } from "./taxonomie.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const AGENT = "local_discovery";

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}`,
      "Content-Type":"application/json", ...(init.headers || {})},
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${text.slice(0,250)}`);
  return text ? JSON.parse(text) : null;
}

const insert = (table:string, rows:unknown[], prefer="return=representation") =>
  rest(table, {method:"POST", body:JSON.stringify(rows), headers:{Prefer:prefer}});
const patch = (path:string, data:unknown) =>
  rest(path, {method:"PATCH", body:JSON.stringify(data), headers:{Prefer:"return=representation"}});

function outputText(json:any) {
  const steps = Array.isArray(json?.steps) ? json.steps : Array.isArray(json?.outputs) ? json.outputs : [];
  return steps.filter((s:any)=>s?.type === "model_output")
    .flatMap((s:any)=>Array.isArray(s.content) ? s.content : [])
    .map((part:any)=>typeof part?.text === "string" ? part.text : "").join("");
}

/* ---------------------------------------------------------------------------
   D'OÙ VIENNENT LES URL — ET POURQUOI CE N'EST PAS UN DÉTAIL

   La garde du module tient en une phrase : une URL n'est recevable que si
   l'OUTIL de recherche l'a rendue, jamais si le modèle l'a écrite dans son
   texte. Sans elle, un modèle peut inventer « restosducoeur.org/tourcoing »
   et se citer lui-même — c'est-à-dire fabriquer sa propre preuve.

   CE QUE LE DIAGNOSTIC A MONTRÉ. Quatre exécutions, 33 candidats, 33 rejets,
   tous pour `source_non_citee_par_outil`. La recherche avait pourtant bien eu
   lieu : la réponse porte deux paires `google_search_call` /
   `google_search_result`, et 7 635 caractères de sortie. C'était donc la
   lecture des citations qui ne trouvait rien, pas le modèle qui inventait.

   L'ancienne version cherchait à deux endroits : `annotations` sur les parties
   de `model_output`, et — seulement si la première n'avait rien donné — une
   marche dans les étapes d'outil. Les deux repartaient vides.

   On lit donc maintenant TOUTES les formes connues de l'API, et on garde la
   trace de celle qui a répondu (`recolte`). Si un jour aucune ne répond, le
   journal de l'exécution le dira au lieu de laisser croire à un modèle
   menteur. Ce qu'on ne lit jamais, en revanche, ne change pas : `part.text`,
   le texte libre du modèle, n'est pas une source.
--------------------------------------------------------------------------- */
function citations(json:any) {
  const out:any[] = [];
  const recolte:Record<string,number> = {};
  const steps = Array.isArray(json?.steps) ? json.steps : Array.isArray(json?.outputs) ? json.outputs : [];
  const ajouter = (voie:string, url:unknown, titre?:unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    out.push({url, title:String(titre || "")});
    recolte[voie] = (recolte[voie] || 0) + 1;
  };

  for (const step of steps) {
    const type = String(step?.type || "");

    /* 1. Les annotations de citation, forme historique. */
    if (type === "model_output") {
      for (const part of Array.isArray(step.content) ? step.content : []) {
        for (const a of Array.isArray(part?.annotations) ? part.annotations : [])
          if (a?.type === "url_citation") ajouter("annotations", a.url || a.uri, a.title);

        /* 2. Le grounding : c'est là que Gemini range ce que la recherche a
              réellement consulté. Les URL y sont souvent des redirections
              `vertexaisearch…/grounding-api-redirect/…`, que
              `resolveCitationUrl` déplie ensuite vers la vraie page. */
        for (const cle of ["grounding_metadata","groundingMetadata","citation_metadata","citationMetadata"]) {
          const meta = part?.[cle] || step?.[cle];
          if (!meta || typeof meta !== "object") continue;
          for (const listeCle of ["grounding_chunks","groundingChunks","citations","citationSources","sources"]) {
            for (const chunk of Array.isArray(meta[listeCle]) ? meta[listeCle] : []) {
              const web = chunk?.web || chunk?.retrieved_context || chunk;
              ajouter(cle, web?.uri || web?.url, web?.title || web?.domain);
            }
          }
        }
      }
      continue;
    }

    /* 3. Les étapes d'outil. Elles sont des SORTIES de google_search, donc
          recevables ; on n'y descend jamais dans un champ de texte libre. */
    if (type === "google_search_result" || type === "google_search_call" ||
        type.endsWith("_result") || type.endsWith("_call")) {
      const marcher = (valeur:any, profondeur=0) => {
        if (!valeur || typeof valeur !== "object" || profondeur > 8 || out.length >= 60) return;
        if (Array.isArray(valeur)) { valeur.forEach((item)=>marcher(item, profondeur+1)); return; }
        for (const cle of ["url","uri","link","web_url","sourceUrl","source_url"])
          ajouter("etape_outil", valeur[cle], valeur.title || valeur.name || valeur.domain);
        for (const [cle, item] of Object.entries(valeur)) {
          /* `signature` est un blob opaque de 2 500 caractères ; le parcourir
             ne rend rien et coûte du temps à chaque exécution. */
          if (cle === "signature" || typeof item === "string") continue;
          marcher(item, profondeur+1);
        }
      };
      marcher(step);
    }
  }

  const uniques = [...new Map(out.map(x=>[x.url,x])).values()];
  return Object.assign(uniques, {recolte});
}

function parseJson(text:string) {
  const match = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = match ? match[1] : String(text).slice(String(text).indexOf("["), String(text).lastIndexOf("]")+1);
  const value = JSON.parse(raw);
  return Array.isArray(value) ? value : [];
}

function prompt(city:string, category:string, queries:string[]) {
  return `Tu aides Autour à DÉCOUVRIR, puis vérifier, des structures locales réelles.
Territoire: ${city}. Catégorie: ${category}.
Requêtes à explorer: ${queries.join(" ; ")}.
Cherche les pages officielles des établissements et les sources publiques/institutionnelles.
Chaque objet doit désigner UN établissement physique, jamais le réseau entier. N'invente rien.
N'inclus un service que si une page citée l'affirme. Une page secondaire sert seulement de piste.
Rends uniquement un tableau JSON d'objets avec: name,address,postal_code,city,lat,lng,phone,
official_url,source_url,service_categories,identity_evidence,service_evidence,entity_status,
reopens_at,closure_reason,next_distribution_at,evidence. Les deux preuves valent 0 à 1.
service_categories utilise seulement: food,food_bank,meals,grocery,housing,shelter,
medical_care,administrative_assistance,clothing,hygiene,employment,student_support,
psychological_support,listening.
evidence est une liste courte de faits paraphrasés, chacun avec source_url.`;
}

/* ---------------------------------------------------------------------------
   L'INVITE OUVERTE — ON DEMANDE CE QUI SE PASSE, PAS SI X A LIEU

   L'invite « solidarité » énumère ce qu'elle cherche : c'est correct pour un
   domaine où l'exhaustivité prime (il ne faut manquer aucune distribution).
   Celle-ci fait l'inverse, et c'est tout l'objet de l'univers `events` : elle
   ne nomme AUCUNE catégorie. Si elle en nommait, on aurait simplement déplacé
   `WORDINGS` dans une chaîne de caractères.

   Le modèle rend donc ce que la ville produit, avec le nom que la ville lui
   donne — « Nuit des ateliers », « Ducasse de la Bourgogne ». Le rangement
   vient après, dans `taxonomie.mjs`, à partir du libellé et de la page.

   ET L'URL N'EST PLUS UNE PROMESSE. Le rapport précédent a montré que cinq
   URL sur huit étaient inventées (404, domaines injoignables). On demande donc
   explicitement de ne rendre QUE des pages réellement ouvertes, et on le
   vérifie de toute façon en les lisant : `verified_url` n'est pas une
   déclaration, c'est le résultat d'un GET.
--------------------------------------------------------------------------- */
function promptOuvert(city:string, questions:string[]) {
  return `Tu observes ce qui se passe réellement à ${city} et tu le rapportes.

Questions à explorer : ${questions.join(" ; ")}

RÈGLES ABSOLUES
1. N'invente JAMAIS une URL. Ne rends que des pages que la recherche t'a
   réellement montrées. Une URL devinée sera détectée et tout le candidat sera
   rejeté : mieux vaut rendre moins d'éléments, avec des pages qui existent.
2. Ne force aucune catégorie. Garde le nom EXACT que l'organisateur emploie,
   même s'il est inhabituel ou inventé. Le rangement n'est pas ton travail.
3. N'affirme une date, un prix ou un lieu que si la page l'écrit.

Rends uniquement un tableau JSON d'objets :
name (le libellé exact tel qu'il est écrit), description, source_url,
official_url, address, postal_code, city, lat, lng, phone, email,
starts_at (ISO 8601 si la page la donne, sinon null), ends_at, is_free,
price_text, organizer, what_it_is (une phrase disant ce que c'est, dans tes
mots, sans catégorie imposée).`;
}

async function search(city:string, category:string, queries:string[], invite?:string) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY absente");
  const response = await fetch(ENDPOINT, {method:"POST",
    headers:{"Content-Type":"application/json","x-goog-api-key":GEMINI_KEY},
    body:JSON.stringify({model:MODEL,input:invite || prompt(city,category,queries),tools:[{type:"google_search"}]}),
    signal:AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const json = await response.json();
  const cites = citations(json);
  return {raw:parseJson(outputText(json)), citations:cites,
    /* Ce que la recherche a réellement rendu, gardé pour le journal : types
       d'étapes vus, et par quelle voie les URL sont arrivées. Sans cela, un
       « 0 candidat retenu » ne dit pas si le modèle a menti ou si on a mal lu. */
    diagnostic:{
      etapes:(Array.isArray(json?.steps)?json.steps:[]).map((s:any)=>s?.type),
      recolte:(cites as any).recolte || {},
      citations:cites.length,
    }};
}

/* ---------------------------------------------------------------------------
   ALLER LIRE LA PAGE

   Bornée de partout : 8 secondes, 300 ko, et une seule page par candidat. Une
   découverte ne doit pas pouvoir devenir un aspirateur de sites.
   `redirect:"follow"` est nécessaire — beaucoup de sites associatifs
   redirigent vers https ou vers une page régionale.
--------------------------------------------------------------------------- */
/* Sept antennes des Restos du Cœur citées depuis la même page de la mairie,
   c'est UNE lecture, pas sept. Le cache vit le temps d'une exécution. */
const pagesLues = new Map<string, any>();

async function lirePage(url:string) {
  if (pagesLues.has(url)) return pagesLues.get(url);
  const lecture = await lirePageSansCache(url);
  pagesLues.set(url, lecture);
  return lecture;
}

async function lirePageSansCache(url:string) {
  try {
    const response = await fetch(url, {redirect:"follow", signal:AbortSignal.timeout(8_000),
      headers:{"User-Agent":"Autour/local-discovery (contact via autour.eu)"}});
    if (!response.ok) return {ok:false, statut:response.status, texte:"", url};
    const brut = await response.text();
    return {ok:true, statut:response.status, texte:texteDePage(brut.slice(0, 300_000)),
      url:response.url || url};
  } catch (error) {
    return {ok:false, statut:0, texte:"", url, erreur:String((error as Error).message).slice(0,80)};
  }
}

async function resolveCitationUrl(url:string) {
  try {
    const response=await fetch(url,{method:"HEAD",redirect:"follow",signal:AbortSignal.timeout(8_000)});
    return /^https?:\/\//i.test(response.url) ? response.url : url;
  } catch { return url; }
}

function hostOf(value:string) {
  try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

async function normalizeCandidate(raw:any, city:string, category:string, citationUrls:Set<string>) {
  const declaredUrl = String(raw?.source_url || raw?.official_url || "");
  const declaredHost = hostOf(declaredUrl);
  /* Si l'outil a cité une page du même domaine, elle est plus précise que la
     racine que le modèle recopie souvent. Sinon on garde ce qu'il a déclaré —
     ce n'est plus une preuve en soi, la preuve vient de la lecture. */
  const url = [...citationUrls].find((citedUrl)=>hostOf(citedUrl) === declaredHost) || declaredUrl;

  /* LA PREUVE EST LUE, PLUS SEULEMENT DÉCLARÉE. Voir `preuveDansPage` : le
     fournisseur ne rend aucune liste d'URL consultées, donc « cité par
     l'outil » ne peut pas servir de garde. On va lire la page. */
  /* Une URL recomposée depuis un courriel ne se lit pas : elle se refuse, et
     le motif le dit. Voir `urlDeriveeDunCourriel` — trois Restos du Cœur de
     Tourcoing ont été perdus sous un « page injoignable » trompeur. */
  const courriel = url ? urlDeriveeDunCourriel(url) : false;
  const page = url && !courriel ? await lirePage(url) : {ok:false, statut:0, texte:"", url:""};
  const preuve = page.ok
    ? preuveDansPage(page.texte, {nom:raw?.name, codePostal:raw?.postal_code,
        ville:raw?.city || city, categorie:category})
    : {identite:0, service:0, raison:courriel ? "url_derivee_d_un_courriel"
        : page.statut ? `page_http_${page.statut}` : "page_injoignable"};
  const cited = preuve.identite > 0;
  let claimedOfficialDomain = "";
  try {
    const officialUrl = String(raw?.official_url || "");
    const officialHost = new URL(officialUrl).hostname.replace(/^www\./, "").toLowerCase();
    const citedOfficial = citationUrls.has(officialUrl);
    const nameTokens = normalizeText(raw?.name).split(" ").filter((token:string)=>token.length >= 5);
    if (citedOfficial && nameTokens.some((token:string)=>officialHost.includes(token)))
      claimedOfficialDomain = officialHost;
  } catch {}
  const st = sourceType(url, claimedOfficialDomain, raw?.city || city);
  const candidate:any = {
    name:String(raw?.name || "").trim(), name_normalized:normalizeText(raw?.name),
    address:raw?.address || null, postal_code:raw?.postal_code || null,
    city:String(raw?.city || city).trim(), lat:Number.isFinite(Number(raw?.lat)) ? Number(raw.lat) : null,
    lng:Number.isFinite(Number(raw?.lng)) ? Number(raw.lng) : null, phone:raw?.phone || null,
    official_url:raw?.official_url || null, source_url:url, source_domain:"",
    source_type:st, official_source:st === "official_structure" || st === "official_government",
    service_categories:Array.isArray(raw?.service_categories) ? raw.service_categories.map((value:any)=>{
      const key=normalizeText(value).replace(/ /g,"_");
      const aliases:any={food_distribution:"food_bank",emergency_food:"food_bank",
        social_grocery:"grocery",social_support:"administrative_assistance"};
      return aliases[key] || key;
    }) : [],
    /* Ce que NOUS avons vérifié, borné par ce que le modèle a osé affirmer :
       il peut être plus prudent que la page, jamais plus affirmatif qu'elle. */
    identity_evidence:Math.min(preuve.identite, Math.max(Number(raw?.identity_evidence)||0, preuve.identite)),
    service_evidence:Math.min(preuve.service, Math.max(Number(raw?.service_evidence)||0, preuve.service)),
    evidence:cited && Array.isArray(raw?.evidence) ? raw.evidence.filter((e:any)=>
      citationUrls.has(e?.source_url) || hostOf(e?.source_url) === hostOf(url)) : [],
    entity_status:["active","temporarily_closed","unknown","inactive"].includes(raw?.entity_status) ? raw.entity_status : "unknown",
    reopens_at:raw?.reopens_at || null, closure_reason:raw?.closure_reason || null,
    next_distribution_at:raw?.next_distribution_at || null, raw_data:raw,
  };
  try { candidate.source_domain = new URL(url).hostname; } catch {}
  candidate.confidence = confidenceFor(st,candidate.identity_evidence,candidate.service_evidence);
  candidate.source_fingerprint = sourceFingerprint(url,candidate.name,candidate.address);
  candidate.verification_status = verificationStatus(candidate);
  candidate.source_url = page.url || url;
  if (!cited) candidate.rejection_reason = preuve.raison || "source_non_verifiable";
  if (!candidate.name || !candidate.source_url) candidate.rejection_reason = "identite_ou_source_absente";
  if (candidate.rejection_reason) candidate.verification_status = "rejected";
  candidate.last_verified_at = publishable(candidate) ? new Date().toISOString() : null;
  return candidate;
}

async function existingPlaces(city:string) {
  const value=encodeURIComponent(`*${city}*`);
  const [byCity,byCommune]=await Promise.all([
    rest(`places?city=ilike.${value}&select=id,name,address,lat,lng,official_url&limit=300`),
    rest(`places?commune=ilike.${value}&select=id,name,address,lat,lng,official_url&limit=300`),
  ]);
  return [...new Map([...(byCity||[]),...(byCommune||[])].map((p:any)=>[p.id,p])).values()];
}

async function publishPlace(c:any) {
  if (!publishable(c) || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return null;
  const categories:any = {food:"alimentaire",food_bank:"alimentaire",meals:"alimentaire",
    grocery:"alimentaire",housing:"hebergement",shelter:"hebergement",health:"sante",
    medical_care:"sante",administrative_assistance:"mairie",
    admin:"mairie",clothing:"asso",hygiene:"asso",employment:"emploi",
    students:"asso",listening:"asso"};
  const category = c.service_categories.map((value:string)=>categories[value]).find(Boolean) || "asso";
  const rows = await rest("rpc/places_ingerer", {method:"POST", body:JSON.stringify({
    p_source:"web_discovery", p_external_id:c.source_fingerprint, p_nom:c.name,
    p_lat:c.lat, p_lng:c.lng, p_adresse:c.address, p_code_postal:c.postal_code,
    p_ville:c.city, p_categorie:category, p_description:null, p_horaires:null,
    p_url:c.official_url, p_image_refs:{}, p_source_url:c.source_url,
    p_raw:{evidence:c.evidence,confidence:c.confidence,
      verification_status:c.verification_status,service_categories:c.service_categories,
      entity_status:c.entity_status,reopens_at:c.reopens_at,closure_reason:c.closure_reason},
    p_rayon_m:120,
  })});
  return rows?.[0]?.place_id || null;
}

/* ---------------------------------------------------------------------------
   L'UNIVERS OUVERT

   Même pipeline que la solidarité — recherche, lecture de page, preuve,
   déduplication — avec deux différences : les questions ne nomment aucune
   catégorie, et le rangement se fait APRÈS, sur le libellé rendu.

   Rien n'est publié dans `places` ici. Un événement n'est pas un lieu, et le
   verser dans le catalogue des lieux ferait apparaître une brocante d'un
   dimanche comme une adresse permanente. Les candidats sont enregistrés avec
   leur classification ; le versement vers `events` est un pas suivant, qui
   demande son propre contrat de dates.
   ------------------------------------------------------------------------ */
async function executerOuvert(task:any, city:string) {
  const questions = questionsOuvertes(city);
  const [run] = await insert("local_discovery_runs", [{task_id:task.id, territory:city,
    universe:"events", category:"open", queries:questions,
    sources_queried:["google_search"], web_search_used:true}]);
  try {
    const result = await search(city, "open", questions, promptOuvert(city, questions));
    const bruts = result.raw.slice(0, 20);
    const candidats:any[] = [];
    for (let debut = 0; debut < bruts.length; debut += 5) {
      candidats.push(...await Promise.all(bruts.slice(debut, debut + 5).map(async (raw:any) => {
        const url = String(raw?.source_url || raw?.official_url || "");
        /* LA PAGE D'ABORD, LE RANGEMENT ENSUITE. C'est elle qui sert à la fois
           de preuve et de second avis pour comprendre un libellé inconnu. */
        const page = url ? await lirePage(url) : {ok:false, statut:0, texte:"", url:""};
        const classe = rattacher(raw?.name, page.texte || raw?.description || raw?.what_it_is || "");
        const preuve = page.ok
          ? preuveDansPage(page.texte, {nom:raw?.name, codePostal:raw?.postal_code,
              ville:raw?.city || city, categorie:null})
          : {identite:0, service:0, raison:page.statut ? `page_http_${page.statut}` : "page_injoignable"};
        const st = sourceType(page.url || url, "", raw?.city || city);
        const candidat:any = {
          run_id:run.id,
          name:String(raw?.name || "").trim(), name_normalized:normalizeText(raw?.name),
          address:raw?.address || null, postal_code:raw?.postal_code || null,
          city:String(raw?.city || city).trim(),
          lat:Number.isFinite(Number(raw?.lat)) ? Number(raw.lat) : null,
          lng:Number.isFinite(Number(raw?.lng)) ? Number(raw.lng) : null,
          phone:raw?.phone || null, official_url:raw?.official_url || null,
          source_url:page.url || url, source_type:st,
          official_source:st === "official_structure" || st === "official_government",
          /* La classification voyage dans `service_categories` (le parent et la
             sous-catégorie) et le libellé original dans `raw_data` : aucune
             colonne nouvelle, et rien de perdu. */
          service_categories:[classe.category_parent, classe.subcategory].filter(Boolean),
          identity_evidence:preuve.identite, service_evidence:preuve.identite ? 0.6 : 0,
          evidence:[], entity_status:"unknown",
          raw_data:{...raw, taxonomie:classe},
        };
        try { candidat.source_domain = new URL(candidat.source_url).hostname; } catch {}
        candidat.confidence = confidenceFor(st, candidat.identity_evidence, candidat.service_evidence);
        candidat.source_fingerprint = sourceFingerprint(candidat.source_url, candidat.name, candidat.address);
        candidat.verification_status = verificationStatus(candidat);
        /* SANS URL VÉRIFIABLE, LE CANDIDAT EXISTE MAIS N'EST PAS PUBLIÉ.
           C'est la règle demandée : une piste reste une piste. */
        if (preuve.identite <= 0) {
          candidat.rejection_reason = preuve.raison || "source_non_verifiable";
          candidat.verification_status = "rejected";
        }
        candidat.last_verified_at = preuve.identite > 0 ? new Date().toISOString() : null;
        return candidat;
      })));
    }
    for (const c of candidats)
      await insert("local_discovery_candidates?on_conflict=source_fingerprint", [c],
        "resolution=merge-duplicates,return=minimal");

    const refus:Record<string,number> = {};
    for (const c of candidats) if (c.rejection_reason)
      refus[c.rejection_reason] = (refus[c.rejection_reason] || 0) + 1;
    const familles:Record<string,number> = {};
    for (const c of candidats) {
      const t = c.raw_data?.taxonomie;
      const cle = t ? `${t.category_parent}/${t.subcategory || "a_qualifier"}` : "?";
      familles[cle] = (familles[cle] || 0) + 1;
    }
    const retenus = candidats.filter((c:any) => !c.rejection_reason);
    const counts = {candidates_count:candidats.length, new_count:0,
      duplicate_count:0, updated_count:retenus.length,
      uncertain_count:candidats.filter((c:any)=>c.verification_status==="uncertain").length,
      rejected_count:candidats.filter((c:any)=>c.verification_status==="rejected").length};
    await patch(`local_discovery_runs?id=eq.${run.id}`, {...counts, status:"completed",
      finished_at:new Date().toISOString()});
    return {run_id:run.id, territory:city, universe:"events", ...counts,
      diagnostic:{...result.diagnostic, refus, familles, pages_lues:pagesLues.size}};
  } catch (error) {
    await patch(`local_discovery_runs?id=eq.${run.id}`, {status:"failed",
      error:(error as Error).message, finished_at:new Date().toISOString()});
    throw error;
  }
}

async function execute(task:any) {
  const city=String(task.params?.ville || task.params?.city || "").trim();
  const category=String(task.params?.categorie || task.params?.category || "food").trim();
  if (!city) throw new Error("ville requise");
  /* Deux univers, un seul pipeline. `solidarity` cherche ce qu'on sait nommer
     — l'exhaustivité prime. `events` observe ce qui se passe, sans nommer. */
  if (String(task.params?.univers || task.params?.universe || "") === "events" || category === "open")
    return executerOuvert(task, city);
  const queries=buildQueries(city,category);
  const [run]=await insert("local_discovery_runs", [{task_id:task.id,territory:city,
    universe:"solidarity",category,queries,sources_queried:["google_search"],web_search_used:true}]);
  try {
    const result=await search(city,category,queries);
    const resolved=await Promise.all(result.citations.map(async(c:any)=>resolveCitationUrl(c.url)));
    const urls=new Set([...result.citations.map((c:any)=>c.url),...resolved]);
    /* PAR PAQUETS DE CINQ, ET PAS PLUS DE VINGT.

       Séquentiel, vingt-cinq lectures à huit secondes tiennent 200 s : la
       fonction Edge serait tuée avant la fin (c'est le `WORKER_RESOURCE_LIMIT`
       déjà rencontré sur l'agent d'acquisition). Cinq de front ramènent le
       pire cas à une trentaine de secondes, et cinq connexions simultanées
       restent polies pour un site associatif. */
    const aNormaliser=result.raw.slice(0,20);
    const rawCandidates:any[]=[];
    for(let debut=0; debut<aNormaliser.length; debut+=5){
      rawCandidates.push(...await Promise.all(
        aNormaliser.slice(debut,debut+5).map((raw:any)=>normalizeCandidate(raw,city,category,urls))));
    }
    const existing=await existingPlaces(city);
    const {accepted,duplicates}=deduplicate(rawCandidates,existing);
    let created=0, updated=0;
    for (const c of accepted) {
      c.run_id=run.id;
      const placeId=await publishPlace(c);
      if(placeId){c.place_id=placeId;created++;}
      await insert("local_discovery_candidates?on_conflict=source_fingerprint",[c],"resolution=merge-duplicates,return=minimal");
    }
    for(const d of duplicates){
      const c={...d.candidate,run_id:run.id,place_id:d.duplicate_of};
      await insert("local_discovery_candidates?on_conflict=source_fingerprint",[c],"resolution=merge-duplicates,return=minimal");
      updated++;
    }
    const verified=rawCandidates.filter((c:any)=>publishable(c)).length;
    const coverage=coverageAssessment({known:existing.length+created,verified,sourceCount:1});
    await insert("local_coverage?on_conflict=territory,universe,category",[{territory:city,
      universe:"solidarity",category,known_count:existing.length+created,verified_count:verified,
      source_count:1,coverage_status:coverage.status,coverage_score:coverage.score,
      last_checked_at:new Date().toISOString(),next_check_at:new Date(Date.now()+7*864e5).toISOString()}],
      "resolution=merge-duplicates,return=minimal");
    /* Pourquoi chaque refus, compté : sans cela « 0 nouveau » ne dit pas si
       les pages étaient injoignables, hors sujet, ou si tout était déjà connu. */
    const refus:Record<string,number>={};
    for(const c of rawCandidates) if(c.rejection_reason)
      refus[c.rejection_reason]=(refus[c.rejection_reason]||0)+1;
    const counts={candidates_count:rawCandidates.length,new_count:created,duplicate_count:duplicates.length,
      updated_count:updated,uncertain_count:rawCandidates.filter((c:any)=>c.verification_status==="uncertain").length,
      rejected_count:rawCandidates.filter((c:any)=>c.verification_status==="rejected").length};
    await patch(`local_discovery_runs?id=eq.${run.id}`,{...counts,status:"completed",finished_at:new Date().toISOString(),next_verification_at:new Date(Date.now()+7*864e5).toISOString()});
    return {run_id:run.id,territory:city,category,...counts,coverage,
      diagnostic:{...result.diagnostic,refus,pages_lues:pagesLues.size}};
  } catch(error) {
    await patch(`local_discovery_runs?id=eq.${run.id}`,{status:"failed",error:(error as Error).message,finished_at:new Date().toISOString()});
    throw error;
  }
}

Deno.serve(async(req)=>{
  if(!SYNC_SECRET || req.headers.get("x-sync-secret")!==SYNC_SECRET)
    return Response.json({error:"non autorisé"},{status:401});
  const url=new URL(req.url);
  if(url.searchParams.get("mode")==="ping") return Response.json({agent:AGENT,ready:true});

  /* ---- LE DIAGNOSTIC, PARCE QUE 100 % DE REJET N'EST PAS UNE OPINION -------
     Les quatre premières exécutions ont rejeté 33 candidats sur 33, tous avec
     `source_non_citee_par_outil`. Deux explications tenaient : le modèle
     inventait tout, ou `citations()` ne trouvait rien là où il cherchait. Ce
     mode répond en FAITS — la forme réelle de la réponse — au lieu de laisser
     choisir entre deux hypothèses. Il ne rend aucun contenu, seulement la
     structure : types d'étapes, clés présentes, nombre d'annotations. */
  if(url.searchParams.get("mode")==="diag"){
    try{
      const queries=buildQueries(url.searchParams.get("ville")||"Tourcoing","food");
      const response=await fetch(ENDPOINT,{method:"POST",
        headers:{"Content-Type":"application/json","x-goog-api-key":GEMINI_KEY},
        body:JSON.stringify({model:MODEL,input:prompt("Tourcoing","food",queries),
          tools:[{type:"google_search"}]}),signal:AbortSignal.timeout(60_000)});
      const json=await response.json();
      const forme=(valeur:any,profondeur=0):any=>{
        if(valeur===null||valeur===undefined) return null;
        if(Array.isArray(valeur)) return profondeur>4?"[…]":[`${valeur.length} éléments`,forme(valeur[0],profondeur+1)];
        if(typeof valeur==="object"){
          if(profondeur>4) return "{…}";
          const out:any={};
          for(const cle of Object.keys(valeur).slice(0,18)) out[cle]=forme(valeur[cle],profondeur+1);
          return out;
        }
        return typeof valeur==="string" ? `texte(${valeur.length})` : typeof valeur;
      };
      const steps=Array.isArray(json?.steps)?json.steps:Array.isArray(json?.outputs)?json.outputs:[];
      return Response.json({
        http:response.status,
        cles_racine:Object.keys(json||{}),
        nb_steps:steps.length,
        types_steps:steps.map((s:any)=>s?.type),
        citations_trouvees:citations(json).length,
        texte_len:outputText(json).length,
        forme:forme(json),
      });
    }catch(error){ return Response.json({erreur:(error as Error).message},{status:500}); }
  }
  try {
    const id=url.searchParams.get("id");
    const tasks=await rest(id ? `tasks?id=eq.${encodeURIComponent(id)}&agent=eq.${AGENT}&select=*`
      : `tasks?agent=eq.${AGENT}&statut=eq.file&planifiee_pour=lte.${new Date().toISOString()}&select=*&order=priorite.asc&limit=1`);
    if(!tasks?.length) return Response.json({agent:AGENT,processed:0});
    const task=tasks[0];
    const claimed=await patch(`tasks?id=eq.${task.id}&statut=eq.file`,{statut:"en_cours",demarree_le:new Date().toISOString(),tentatives:(task.tentatives||0)+1});
    if(!claimed?.length) return Response.json({agent:AGENT,processed:0,reason:"already_claimed"});
    try {
      const result=await execute(task);
      await patch(`tasks?id=eq.${task.id}`,{statut:"terminee",resultat:result,terminee_le:new Date().toISOString(),erreur:null});
      await insert("runs",[{task_id:task.id,agent:AGENT,etape:"discovery",statut:"succes",
        message:`${result.territory} · ${result.category}: ${result.candidates_count} candidats, ${result.new_count} nouveaux, ${result.duplicate_count} doublons.`,
        compteurs:result,details:{web_search_used:true,diagnostic:result.diagnostic},modele:MODEL,fin:new Date().toISOString()}],"return=minimal");
      return Response.json({agent:AGENT,processed:1,result});
    } catch(error) {
      await patch(`tasks?id=eq.${task.id}`,{statut:"echouee",erreur:(error as Error).message,terminee_le:new Date().toISOString()});
      throw error;
    }
  } catch(error) { return Response.json({error:(error as Error).message},{status:500}); }
});
