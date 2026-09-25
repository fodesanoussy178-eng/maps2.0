/* ===========================================================================
   /api/mcp — LE SEUL POINT D'ENTRÉE DE L'INTÉGRATION CHATGPT

   Transport : HTTP en flux (« Streamable HTTP ») dans sa forme la plus simple —
   un POST JSON-RPC, une réponse JSON. Pas de SSE : aucun de nos six outils ne
   progresse par étapes, et un flux qu'on n'utilise pas est une panne de plus à
   surveiller.

   CE QUE CETTE ROUTE FAIT, DANS CET ORDRE :
     1. elle vérifie l'accès (jeton si exigé, plafond partagé, rafale) ;
     2. elle passe le message au protocole, avec un délai maximal ;
     3. elle répond, et journalise une ligne sans donnée personnelle.

   CE QU'ELLE NE FAIT PAS : écrire quoi que ce soit dans Autour. La V1 est en
   lecture seule, et aucune méthode d'écriture n'est déclarée — ni dans le
   protocole, ni dans les outils.

   POURQUOI `edge`. Les autres routes d'Autour le sont déjà, les moteurs sont du
   JavaScript pur, et la latence d'une conversation se paie en attente visible :
   une réponse rapide EST la fonctionnalité.
   ======================================================================== */

import { traiter } from "../mcp/serveur.mjs";
import * as garde from "../mcp/garde.mjs";

export const config = { runtime: "edge" };

const ENTETES = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  /* ChatGPT appelle depuis ses serveurs, mais l'inspecteur MCP et les outils de
     recette appellent depuis un navigateur. Les entêtes autorisés sont ceux du
     protocole et de l'authentification, rien de plus. */
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key, mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

function json(corps, statut = 200, entetes = {}) {
  return new Response(JSON.stringify(corps), {
    status: statut, headers: Object.assign({}, ENTETES, entetes),
  });
}

function refus(statut, raison, id = null) {
  const codes = { 401: -32001, 429: -32002, 400: -32600, 405: -32601 };
  return json({ jsonrpc: "2.0", id,
    error: { code: codes[statut] || -32000, message: raison } }, statut,
    statut === 429 ? { "retry-after": "60" } : {});
}

export default async function handler(requete) {
  if (requete.method === "OPTIONS") return new Response(null, { status: 204, headers: ENTETES });

  /* Un GET sert à deux choses : vérifier que la route vit, et dire ce qu'elle
     est. Il ne rend aucune donnée d'Autour, donc il ne passe pas par le
     plafond — une sonde de disponibilité ne doit pas consommer le quota d'un
     appelant légitime. */
  if (requete.method === "GET") {
    return json({
      service: "autour-mcp", transport: "http-json-rpc", protocol: "2025-06-18",
      read_only: true, tools: ["search_now", "search_events", "search_nearby",
        "search_help", "get_event", "get_place"],
      website: "https://autour.eu", privacy: "https://autour.eu/confidentialite",
    });
  }

  if (requete.method !== "POST") return refus(405, "méthode HTTP non acceptée");

  let message = null;
  try {
    const texte = await requete.text();
    if (texte.length > 64 * 1024) return refus(400, "corps trop volumineux");
    message = JSON.parse(texte);
  } catch (e) {
    return refus(400, "corps JSON illisible");
  }

  const acces = await garde.autoriser(requete);
  if (!acces.ok) {
    garde.journaliser({ verdict: "refus", raison: acces.raison, cle: acces.cle || null });
    return refus(acces.statut, acces.raison === "jeton_absent" ? "authentification requise"
      : acces.raison === "jeton_invalide" ? "jeton refusé"
        : "plafond d'appels atteint, réessayer dans une minute",
      (message && message.id) || null);
  }

  const contexte = { cle: acces.cle };
  const entetesQuota = acces.restant == null ? {}
    : { "x-ratelimit-remaining": String(acces.restant), "x-ratelimit-limit": String(acces.max) };

  try {
    /* Un client peut envoyer un tableau de messages. On répond dans le même
       ordre, sans les notifications — qui n'attendent rien. */
    if (Array.isArray(message)) {
      const reponses = [];
      for (const un of message) {
        const r = await traiter(un, contexte);
        if (r) reponses.push(r);
      }
      return json(reponses, 200, entetesQuota);
    }
    const reponse = await traiter(message, contexte);
    if (!reponse) return new Response(null, { status: 202, headers: ENTETES });
    return json(reponse, 200, entetesQuota);
  } catch (e) {
    garde.journaliser({ verdict: "panne", raison: String((e && e.message) || e).slice(0, 120),
      cle: acces.cle });
    return json({ jsonrpc: "2.0", id: (message && message.id) || null,
      error: { code: -32603, message: "erreur interne" } }, 500);
  }
}
