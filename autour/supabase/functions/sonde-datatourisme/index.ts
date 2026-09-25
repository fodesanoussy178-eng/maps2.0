/* ---------------------------------------------------------------------------
   MESURER LA FORME D'UNE SOURCE, AU LIEU DE LA SUPPOSER

   Un champ demandé et absent de la réponse ne se distingue pas d'un champ mal
   nommé : dans les deux cas la colonne reste vide en base, sans erreur, sans
   rejet, sans trace. C'est exactement ce qui est arrivé aux événements
   DATAtourisme — 1 572 sur 1 572 sans nom de lieu et sans lien, alors que le
   normaliseur les cherchait consciencieusement.

   Cette fonction demande UNE page du catalogue et ne rend que les CHEMINS de
   clés rencontrés, avec leur type. Aucune valeur ne sort : on cherche la forme
   du contrat, pas le contenu d'une fiche — et un diagnostic ne doit pas
   devenir une fuite de données.

   Elle n'écrit rien, ne touche à aucune table, et refuse tout appel qui ne
   présente pas `x-sync-secret` : la même porte que les synchronisations, pour
   que la clé DATAtourisme ne devienne pas un proxy ouvert. Le paramètre
   `fields` permet d'essayer une liste de champs candidats sans toucher à
   celle que la synchronisation utilise en production.

   Voir `sync-datatourisme/index.ts`, qui porte le même relevé sous
   `mode=sonde` une fois déployé.
--------------------------------------------------------------------------- */

const CATALOGUE = Deno.env.get("DATATOURISME_BASE_URL")
  ?? "https://api.datatourisme.fr/v1/entertainmentAndEvent";
const CLE_DATATOURISME = Deno.env.get("DATATOURISME_API_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";

async function memeSecret(fourni: string, attendu: string): Promise<boolean> {
  if (!attendu) return false;
  const encodeur = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encodeur.encode(fourni)),
    crypto.subtle.digest("SHA-256", encodeur.encode(attendu)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let ecart = 0;
  for (let i = 0; i < x.length; i += 1) ecart |= x[i] ^ y[i];
  return ecart === 0;
}

/* Les chemins et les types, jamais les valeurs. Une chaîne est dite « url »
   ou « texte » — c'est tout ce qu'il faut pour savoir si un champ demandé est
   arrivé et sous quelle forme. */
function formeDe(
  valeur: unknown, prefixe: string, dans: Record<string, string>, profondeur = 0,
): void {
  if (valeur == null || profondeur > 4) return;
  if (Array.isArray(valeur)) {
    dans[prefixe] = `tableau(${valeur.length})`;
    if (valeur.length) formeDe(valeur[0], `${prefixe}[0]`, dans, profondeur + 1);
    return;
  }
  if (typeof valeur !== "object") {
    dans[prefixe] = typeof valeur === "string"
      ? (/^https?:\/\//.test(valeur) ? "url" : "texte") : typeof valeur;
    return;
  }
  for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (v === null) { dans[chemin] = "null"; continue; }
    formeDe(v, chemin, dans, profondeur + 1);
  }
}

Deno.serve(async (requete: Request) => {
  if (!await memeSecret(requete.headers.get("x-sync-secret") ?? "", SYNC_SECRET)) {
    return new Response(JSON.stringify({error: "non autorisé"}),
      {status: 401, headers: {"Content-Type": "application/json"}});
  }
  if (!CLE_DATATOURISME) {
    return new Response(JSON.stringify({error: "DATATOURISME_API_KEY absente"}),
      {status: 503, headers: {"Content-Type": "application/json"}});
  }
  const demande = new URL(requete.url);
  const champs = demande.searchParams.get("fields") ?? "";
  /* Le rectangle par défaut est celui de la métropole lilloise ; il n'a
     d'importance que pour ramener quelques objets réels. */
  const params = new URLSearchParams({
    geo_bounding: demande.searchParams.get("geo_bounding")
      ?? "50.80,2.90,50.55,3.30",
    page_size: demande.searchParams.get("page_size") ?? "25",
    page: "1",
    lang: "fr",
  });
  if (champs) params.set("fields", champs);

  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), 20000);
  try {
    const reponse = await fetch(`${CATALOGUE}?${params}`, {
      signal: controle.signal,
      headers: {
        "x-api-key": CLE_DATATOURISME,
        Accept: "application/json",
        "User-Agent": "Autour/sonde-datatourisme",
      },
    });
    clearTimeout(minuteur);
    let charge: unknown = null;
    try { charge = await reponse.json(); } catch { charge = null; }
    const c = charge as Record<string, unknown> | null;
    const lot = (Array.isArray(c?.objects) ? c!.objects
      : Array.isArray(c?.["@graph"]) ? c!["@graph"]
      : Array.isArray(c?.data) ? c!.data
      : Array.isArray(charge) ? charge : []) as unknown[];
    const formes: Record<string, string> = {};
    for (const poi of lot.slice(0, 25)) formeDe(poi, "", formes);
    return new Response(JSON.stringify({
      httpStatus: reponse.status,
      retourne: lot.length,
      /* Les clés de l'enveloppe, pour savoir où vit la pagination. */
      enveloppe: c && !Array.isArray(charge) ? Object.keys(c) : [],
      champs_demandes: champs ? champs.split(",") : ["(sélection par défaut)"],
      formes,
    }), {status: 200, headers: {"Content-Type": "application/json"}});
  } catch (erreur) {
    clearTimeout(minuteur);
    return new Response(JSON.stringify({
      error: erreur instanceof Error ? erreur.message : String(erreur),
    }), {status: 502, headers: {"Content-Type": "application/json"}});
  }
});
