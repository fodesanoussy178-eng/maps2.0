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

/* Au-delà, ce n'est plus une source secondaire, c'est une attente. Le client
   n'attend de toute façon pas — mais une fonction qui vit trente secondes
   coûte trente secondes à chaque lieu silencieux. */
const DELAI_MS = 15_000;

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
      generationConfig: {temperature: 0.1, maxOutputTokens: 1400},
    }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!r.ok) throw new Error(`modèle : HTTP ${r.status}`);
  const json = await r.json();
  const candidat = (json.candidates ?? [])[0];
  return {sources: sourcesAncrage(candidat), texte: texteDe(candidat)};
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

  const debut = Date.now();
  try {
    const {sources, texte} = await interroger(lieu, maintenant);
    const brut = extraireObjet(texte);
    const fait = construireFait(brut, {sources, nom, commune: lieu.commune, maintenant});

    /* Aucune page citée : le modèle a parlé sans avoir lu. On n'écrit rien —
       pas même un « inconnu » — parce qu'une réponse non ancrée ne prouve pas
       que le lieu est muet, seulement que la recherche a échoué cette fois. */
    if (!fait) {
      return reponse({enrichissement: cache, origine: "cache", actif: true,
                      raison: "aucune source citée"});
    }

    const ligne = ligneEnrichissement(fait, lieu,
      {maintenant, modele: MODELE, duree: Date.now() - debut});
    const ecrite = await ecrire(ligne);
    return reponse({enrichissement: ecrite, origine: "modele", actif: true});
  } catch (erreur) {
    /* Délai dépassé, modèle indisponible, réponse illisible : tous le même
       sort. Ce n'est pas une panne d'Autour — on rend ce qu'on avait. */
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    return reponse({enrichissement: cache, origine: "cache", actif: false,
                    raison: message}, 200);
  }
});
