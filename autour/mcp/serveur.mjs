/* ===========================================================================
   LE PROTOCOLE — JSON-RPC, SIX OUTILS, UNE RESSOURCE D'INTERFACE

   Ce fichier ne connaît rien d'Autour. Il traduit : une requête MCP entre, une
   réponse MCP sort. Tout ce qui est métier est dans `outils.mjs`, tout ce qui
   est confidentialité dans `projection.mjs`, tout ce qui est accès dans
   `garde.mjs`. Cette séparation est la raison pour laquelle on peut affirmer
   quels champs sortent : il n'y a qu'un chemin.

   CE QUE CHAQUE RÉPONSE D'OUTIL PORTE, ET POURQUOI :

     · `content` — un texte court, lisible, pour le modèle ET pour un client qui
       n'affiche pas de composant. C'est le minimum vital : une app dont la
       réponse dépend d'une interface graphique ne répond pas.
     · `structuredContent` — les résultats, champ par champ. C'est ce que lit le
       composant, et ce sur quoi ChatGPT peut raisonner.
     · `_meta["openai/outputTemplate"]` — l'aperçu à afficher.

   LE TEXTE NE CACHE RIEN POUR FORCER UN CLIC. Le chantier est explicite :
   « ne retiens jamais une information indispensable uniquement pour provoquer
   un clic ». Le résumé porte donc le nom, la date, la distance et le lieu de
   chaque résultat, plus l'avertissement de fiabilité quand il y en a un. Le
   lien vient en plus, pour ce qu'Autour fait de mieux : la carte, l'itinéraire,
   le reste des résultats, les favoris.
   ======================================================================== */

import { OUTILS, PAR_NOM } from "./outils.mjs";
import { RESSOURCES, URI_WIDGET, MIME_WIDGET } from "./widget.mjs";
import * as garde from "./garde.mjs";

export const PROTOCOLE = "2025-06-18";
export const SERVEUR = Object.freeze({
  name: "autour",
  title: "Autour",
  version: "1.0.0",
  websiteUrl: "https://autour.eu",
});

const INSTRUCTIONS = [
  "Autour sert des données locales déjà collectées et vérifiées : événements datés,",
  "lieux de l'inventaire, et points de service d'aide locale.",
  "Les résultats portent leur fiabilité (verified / candidate) et l'état de couverture",
  "d'Autour. N'affirme jamais comme certain un résultat marqué candidate, et dis",
  "clairement quand la couverture est incomplète plutôt que de compléter par autre chose.",
  "Pour l'aide locale, réponds avec le POINT DE SERVICE (adresse, service, horaires,",
  "distance), jamais avec la seule organisation juridique ; deux points d'une même",
  "organisation sont deux réponses distinctes.",
].join(" ");

function reponse(id, resultat) {
  return { jsonrpc: "2.0", id, result: resultat };
}

function erreur(id, code, message, donnees) {
  return { jsonrpc: "2.0", id, error: Object.assign({ code, message },
    donnees ? { data: donnees } : {}) };
}

function metaOutil(outil) {
  return {
    "openai/outputTemplate": URI_WIDGET,
    "openai/toolInvocation/invoking": outil.invocation.avant,
    "openai/toolInvocation/invoked": outil.invocation.apres,
    "openai/widgetAccessible": false,
    "openai/resultCanProduceWidget": true,
  };
}

function declaration(outil) {
  return {
    name: outil.nom,
    title: outil.titre,
    description: outil.description,
    inputSchema: outil.schema,
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    _meta: metaOutil(outil),
  };
}

/* ---- LE RÉSUMÉ TEXTUEL -------------------------------------------------
   Il doit suffire à répondre sans ouvrir quoi que ce soit. Une ligne par
   résultat, dans l'ordre rendu, avec ce qui décide : quoi, quand, où, à
   quelle distance, et la réserve s'il y en a une. */
function ligneResultat(item) {
  const bouts = [item.name];
  if (item.kind === "service_point") {
    const services = item.service_labels && item.service_labels.length
      ? item.service_labels : item.services;
    if (services && services.length) bouts.push(services.slice(0, 3).join(", "));
    if (item.address) bouts.push(item.address);
    if (item.hours) bouts.push("horaires : " + item.hours);
    if (item.phone) bouts.push("tél. " + item.phone);
  } else {
    if (item.type_label || item.type) bouts.push(item.type_label || item.type);
    if (item.date_label) bouts.push(item.date_label);
    if (item.sessions && item.sessions.length > 1)
      bouts.push("séances : " + item.sessions.slice(0, 6)
        .map((s) => String(s.start).slice(11, 16)).join(", "));
    if (item.opening_label) bouts.push(item.opening_label);
    if (item.venue || item.address) bouts.push(item.venue || item.address);
    if (item.price_text) bouts.push(item.price_text);
  }
  if (item.distance_m != null) bouts.push(item.distance_m < 1000
    ? item.distance_m + " m" : (item.distance_m / 1000).toFixed(1).replace(".", ",") + " km");
  if (item.reliability && item.reliability.status === "candidate")
    bouts.push("information NON vérifiée par Autour");
  if (item.reliability && item.reliability.status === "cancelled") bouts.push("ANNULÉ");
  const ligne = "- " + bouts.filter(Boolean).join(" · ");
  return item.deep_link ? ligne + "\n  " + (item.cta || "Ouvrir dans Autour") + " : " + item.deep_link
    : ligne;
}

function resume(sortie) {
  const lignes = [];
  const resultats = sortie.result ? [sortie.result] : (sortie.results || []);
  if (!resultats.length) {
    lignes.push((sortie.notes || []).join(" ") || "Autour n'a aucun résultat fiable à proposer ici.");
  } else {
    resultats.forEach((item) => lignes.push(ligneResultat(item)));
    (sortie.notes || []).forEach((note) => lignes.push(note));
  }
  if (sortie.coverage && sortie.coverage.status && sortie.coverage.status !== "adequate")
    lignes.push("Couverture Autour : " + sortie.coverage.status + ".");
  if (sortie.autour && sortie.autour.url)
    lignes.push(sortie.autour.label + " : " + sortie.autour.url);
  return lignes.join("\n");
}

export async function traiter(message, contexte = {}) {
  const id = message && message.id;
  const methode = message && message.method;
  if (!message || message.jsonrpc !== "2.0" || typeof methode !== "string")
    return erreur(id == null ? null : id, -32600, "requête JSON-RPC invalide");

  /* Une notification (sans `id`) ne reçoit pas de réponse : c'est le
     protocole, et répondre quand même fait échouer certains clients. */
  const notification = id === undefined || id === null;

  switch (methode) {
    case "initialize":
      return reponse(id, {
        protocolVersion: PROTOCOLE,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: SERVEUR,
        instructions: INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return notification ? null : reponse(id, {});

    case "tools/list":
      return reponse(id, { tools: OUTILS.map(declaration) });

    case "resources/list":
      return reponse(id, {
        resources: RESSOURCES.map((r) => ({ uri: r.uri, name: r.name,
          description: r.description, mimeType: r.mimeType })),
      });

    case "resources/read": {
      const uri = message.params && message.params.uri;
      const ressource = RESSOURCES.find((r) => r.uri === uri);
      if (!ressource) return erreur(id, -32602, "ressource inconnue : " + uri);
      return reponse(id, {
        contents: [{ uri: ressource.uri, mimeType: ressource.mimeType, text: ressource.texte }],
      });
    }

    case "tools/call": {
      const params = message.params || {};
      const outil = PAR_NOM[String(params.name || "")];
      if (!outil) return erreur(id, -32602, "outil inconnu : " + params.name);
      const debut = Date.now();
      try {
        const sortie = await garde.avecDelai(
          outil.executer(params.arguments || {}, contexte));
        garde.journaliser({ outil: outil.nom, verdict: "ok", ms: Date.now() - debut,
          zone: (sortie.query && sortie.query.zone) || null,
          resultats: sortie.result ? 1 : (sortie.results || []).length,
          cle: contexte.cle || null });
        return reponse(id, {
          content: [{ type: "text", text: resume(sortie) }],
          structuredContent: sortie,
          _meta: { "openai/outputTemplate": URI_WIDGET },
          isError: false,
        });
      } catch (e) {
        const message2 = String((e && e.message) || e);
        garde.journaliser({ outil: outil.nom, verdict: "erreur", ms: Date.now() - debut,
          raison: message2.slice(0, 120), cle: contexte.cle || null });
        /* Une panne d'Autour est dite comme telle, sans détail technique : le
           modèle doit pouvoir répondre « je n'ai pas pu vérifier » plutôt
           qu'inventer. */
        return reponse(id, {
          content: [{ type: "text", text: message2 === "delai_depasse"
            ? "Autour n'a pas répondu assez vite ; aucun résultat fiable n'a pu être lu."
            : "Autour n'a pas pu lire ses données pour cette demande." }],
          structuredContent: { results: [], state: "error",
            notes: ["Lecture Autour indisponible : ne pas présenter de résultat."] },
          isError: true,
        });
      }
    }

    default:
      return notification ? null : erreur(id, -32601, "méthode inconnue : " + methode);
  }
}

export { declaration, resume, INSTRUCTIONS };
