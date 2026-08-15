/* ===========================================================================
   Gemini, ancré sur la recherche Google — au bord du réseau

   CE QUE CETTE ROUTE APPORTE, ET CE QU'ELLE N'APPORTE PAS

   OpenStreetMap sait où sont les murs. Google Places sait qu'un commerce
   existe et à quelle heure il ouvre. Aucun des deux ne sait qu'il y a un
   marché de producteurs samedi matin sur la place, qu'une salle rouvre après
   travaux, ou qu'un festival occupe le centre ce week-end. Ces choses-là sont
   écrites en français sur des pages municipales et des agendas locaux, et
   c'est exactement ce qu'un modèle ancré sur la recherche sait aller lire.

   C'est donc une source de DÉCOUVERTES, pas une source de lieux. Elle ne
   remplace rien, n'est jamais attendue, et son absence ne change rien à ce
   qui s'affiche.

   TROIS DANGERS, TROIS RÉPONSES

   1. UN MODÈLE INVENTE. C'est le danger principal, et Autour a une règle qui
      ne souffre pas d'exception : ne jamais inventer un nom, ni un lieu. On
      n'accorde donc aucune confiance à la prose du modèle. Chaque proposition
      doit être ADOSSÉE À UNE SOURCE d'ancrage réellement citée par l'API ;
      celles qui n'en portent pas sont jetées ici, côté serveur, et ne
      parviennent jamais au navigateur.

      On ne demande pas non plus de coordonnées : un modèle à qui l'on réclame
      une latitude en produira une, plausible et fausse. Il rend un nom et une
      adresse — des choses qui se vérifient — et la position reste le travail
      des sources qui la connaissent.

   2. UNE ROUTE OUVERTE SUR UN MODÈLE EST UN PROXY GRATUIT. Sans garde-fou,
      n'importe qui posterait ses propres invites à nos frais. Le client
      n'envoie donc AUCUN TEXTE : deux coordonnées arrondies et un mot pris
      dans une liste fermée. L'invite est écrite ici, en entier, et ne
      contient rien qui vienne de la requête.

   3. C'EST LENT ET C'EST PAYANT. Plusieurs secondes par appel. La réponse est
      donc mise en cache par le CDN et partagée par tout un quartier : la
      première personne paie l'attente pour tout le monde. Les découvertes
      étant datées, la fraîcheur est courte — un quart d'heure — mais la
      réponse périmée continue d'être servie pendant qu'elle se rafraîchit,
      pour que personne n'attende jamais un modèle.

   LA CLÉ NE SORT PAS D'ICI. Elle est lue dans `process.env.GEMINI_API_KEY`,
   posée en en-tête, et n'apparaît ni dans une URL, ni dans une réponse, ni
   dans un message d'erreur.
   ======================================================================== */

export const config = { runtime: "edge" };

const MODELE = "gemini-2.0-flash";
const POINT_DE_TERMINAISON =
  "https://generativelanguage.googleapis.com/v1beta/models/" + MODELE + ":generateContent";

/* Au-delà, ce n'est plus une source secondaire : c'est une attente. Le client
   n'attend de toute façon pas, mais une fonction qui vit vingt secondes coûte
   vingt secondes à chaque quartier froid. */
const DELAI_MS = 12000;
const RESULTATS_MAX = 6;

/* La liste fermée. Le client choisit un angle, il ne rédige pas. */
const ANGLES = Object.freeze({
  sortir: "des événements, sorties, concerts, expositions, marchés ou " +
          "festivals qui ont lieu en ce moment ou dans les sept prochains jours",
  manger: "des lieux où manger ou boire qui viennent d'ouvrir, qui sont " +
          "réputés localement, ou qui font l'objet d'une actualité récente",
  famille: "des activités, ateliers ou sorties adaptés aux enfants et aux " +
           "familles, en ce moment ou dans les sept prochains jours",
  decouvrir: "des lieux ou faits remarquables, curiosités locales, " +
             "patrimoine, ouvertures ou réouvertures récentes",
});

/* Les catégories internes d'Autour que cette source a le droit de produire.
   Un modèle qui répond « restaurant gastronomique » ne doit pas créer une
   catégorie de plus dans un système qui en a déjà. */
const CATEGORIES = Object.freeze([
  "event", "concert", "spectacle", "marche", "resto", "cafe", "bar",
  "musee", "cinema", "parc", "sport", "biblio", "commerce", "autre",
]);

/* `Number(null)` vaut zéro, et `Number("")` aussi. Sans le premier test, une
   coordonnée ABSENTE devenait donc le point (0, 0) — au large du golfe de
   Guinée — et la requête partait chercher ce qui s'y passe. Une valeur
   manquante doit être refusée, jamais interprétée. */
function nombre(v, max) {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

function refus(message, statut) {
  return new Response(JSON.stringify({ erreur: message, items: [] }), {
    status: statut,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // une erreur ne se met pas en cache longtemps : la panne serait figée
      "cache-control": statut >= 500 ? "no-store" : "public, max-age=60",
    },
  });
}

/* ---- L'invite ------------------------------------------------------------
   Écrite ici, jamais reçue. Les seules valeurs interpolées sont deux nombres
   déjà validés et un libellé pris dans `ANGLES`. */
function invite(lat, lng, angle, ville) {
  const ou = ville ? "à " + ville + " (" + lat + ", " + lng + ")"
                   : "autour du point " + lat + ", " + lng;
  return [
    "Tu aides une application de quartier à repérer ce qui mérite d'être connu " + ou + ".",
    "",
    "Cherche " + ANGLES[angle] + ".",
    "",
    "Règles absolues :",
    "- N'invente rien. Si tu n'as pas trouvé de source, ne propose rien.",
    "- Ne propose que ce qui est réellement situé dans cette commune ou à moins de dix kilomètres.",
    "- Ne donne PAS de coordonnées géographiques : donne le nom et l'adresse.",
    "- Au maximum " + RESULTATS_MAX + " propositions, les plus intéressantes.",
    "- Mieux vaut deux propositions sûres que six approximatives.",
    "",
    "Réponds UNIQUEMENT par un tableau JSON, sans texte autour, sans balises de code.",
    "Chaque élément a exactement ces champs :",
    '{"nom": string, "categorie": one of [' + CATEGORIES.join(", ") + '],',
    ' "adresse": string, "commune": string, "description": string (une phrase, 140 caractères max),',
    ' "debut": string ISO 8601 ou null, "fin": string ISO 8601 ou null,',
    ' "url": string ou ""}',
    "",
    "Si tu ne trouves rien de sûr, réponds exactement : []",
  ].join("\n");
}

/* ---- Lecture de la réponse ----------------------------------------------
   Le mode JSON strict de l'API (`responseSchema`) n'est PAS compatible avec
   l'outil de recherche : il faut choisir entre un format garanti et un
   ancrage réel. L'ancrage est ce qui rend cette source honnête, donc on le
   garde et on paie le prix — analyser du texte défensivement. Rien de ce qui
   sort d'ici n'est supposé bien formé. */
function extraireJSON(texte) {
  const brut = String(texte || "").trim();
  if (!brut) return [];
  // le modèle enrobe volontiers son JSON dans des balises de code
  const sansCloture = brut.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const debut = sansCloture.indexOf("[");
  const fin = sansCloture.lastIndexOf("]");
  if (debut < 0 || fin <= debut) return [];
  try {
    const lu = JSON.parse(sansCloture.slice(debut, fin + 1));
    return Array.isArray(lu) ? lu : [];
  } catch (e) {
    return [];
  }
}

/* Les pages réellement consultées par le modèle. C'est la seule preuve dont
   on dispose que la réponse ne sort pas de nulle part. */
export function sourcesAncrage(candidat) {
  const meta = (candidat && candidat.groundingMetadata) || {};
  const morceaux = Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [];
  const sources = [];
  morceaux.forEach((morceau) => {
    const web = morceau && morceau.web;
    if (!web || !web.uri) return;
    sources.push({ titre: String(web.title || ""), url: String(web.uri) });
  });
  return sources;
}

function texteDe(candidat) {
  const parties = (candidat && candidat.content && candidat.content.parts) || [];
  return parties.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("");
}

function chaine(valeur, maximum) {
  const s = String(valeur == null ? "" : valeur).trim();
  return s.length > maximum ? s.slice(0, maximum).trim() : s;
}

function horodatage(valeur) {
  if (!valeur) return null;
  const t = Date.parse(String(valeur));
  if (!Number.isFinite(t)) return null;
  /* Une date que le modèle a mal recopiée peut tomber n'importe où. On
     n'accepte qu'une fenêtre plausible : rien de plus vieux qu'hier, rien
     au-delà d'un an. Le reste n'est pas une découverte, c'est du bruit. */
  const maintenant = Date.now();
  if (t < maintenant - 36 * 3600 * 1000) return null;
  if (t > maintenant + 365 * 24 * 3600 * 1000) return null;
  return new Date(t).toISOString();
}

const TEMPORAIRES = new Set(["event", "concert", "spectacle", "marche"]);

/* Une proposition devient un item d'Autour, ou elle est jetée. Exportée pour
   que les tests puissent l'éprouver sans réseau ni clé. */
export function normaliserDecouverte(brut, contexte) {
  const p = brut || {};
  const ctx = contexte || {};
  const nom = chaine(p.nom || p.name, 120);
  // sans nom, ce n'est pas une proposition — et on n'en fabrique pas
  if (nom.length < 2) return null;
  // pas de source citée, pas de proposition : c'est toute la règle
  if (!Array.isArray(ctx.sources) || !ctx.sources.length) return null;

  const categorie = CATEGORIES.includes(p.categorie) ? p.categorie : "autre";
  const debut = horodatage(p.debut);
  const fin = horodatage(p.fin);
  const temporaire = TEMPORAIRES.has(categorie) || debut != null;
  // un événement sans date n'est pas datable : il n'a rien à faire dans une
  // couche temporelle, et « Maintenant » ne doit jamais le voir
  if (temporaire && debut == null) return null;

  let url = chaine(p.url, 400);
  if (url && !/^https:\/\//i.test(url)) url = "";

  return {
    id: "gemini:" + ctx.empreinte + ":" + nom.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
    titre: nom,
    cat: categorie,
    description: chaine(p.description, 180),
    adresse: chaine(p.adresse || p.address, 160),
    commune: chaine(p.commune || ctx.ville, 80),
    debutLe: debut,
    finLe: fin,
    isTemporary: temporaire,
    url,
    /* Ni latitude ni longitude, et c'est délibéré : cette source ne sait pas
       où sont les choses, elle sait qu'elles existent. La position viendra
       d'une source qui la connaît, ou l'item restera une information sans
       marqueur. Inventer un point serait poser un marqueur faux sur une
       carte — la pire chose qu'une carte puisse faire. */
    lat: null,
    lng: null,
    positionConnue: false,
    source: "gemini",
    /* La provenance voyage avec l'item, jusqu'à l'écran s'il le faut : une
       découverte doit pouvoir être vérifiée par qui la lit. */
    sources: ctx.sources.slice(0, 3),
  };
}

export default async function handler(requete) {
  const url = new URL(requete.url);
  const lat = nombre(url.searchParams.get("lat"), 90);
  const lng = nombre(url.searchParams.get("lng"), 180);
  const angle = url.searchParams.get("angle") || "sortir";
  // le nom de commune sert à l'invite ; il est borné et jamais réinjecté ailleurs
  const ville = chaine(url.searchParams.get("ville"), 60).replace(/[^\p{L}\p{N}\s'’-]/gu, "");

  if (lat == null || lng == null) return refus("coordonnées invalides", 400);
  if (!Object.hasOwn(ANGLES, angle)) return refus("angle inconnu", 400);

  const cle = process.env.GEMINI_API_KEY;
  /* Pas de clé configurée : ce n'est pas une panne, c'est une source absente.
     On répond une liste vide avec succès — le client n'a rien à gérer de
     particulier, et surtout rien ne se casse. */
  if (!cle) {
    return new Response(JSON.stringify({ items: [], source: "gemini", actif: false }), {
      headers: { "content-type": "application/json; charset=utf-8",
                 "cache-control": "public, max-age=3600" },
    });
  }

  // ~1 km : tout un quartier partage la même entrée de cache CDN
  const rLat = lat.toFixed(2), rLng = lng.toFixed(2);
  const empreinte = rLat + "," + rLng + ":" + angle;

  try {
    const reponse = await fetch(POINT_DE_TERMINAISON, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // en en-tête, jamais en paramètre d'URL : une URL se journalise
        "x-goog-api-key": cle,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: invite(rLat, rLng, angle, ville) }] }],
        // l'ancrage : c'est lui qui transforme une génération en lecture
        tools: [{ google_search: {} }],
        generationConfig: {
          // on ne veut pas d'imagination : c'est un travail de relevé
          temperature: 0.2,
          maxOutputTokens: 1200,
        },
      }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(DELAI_MS) : undefined,
    });

    if (!reponse.ok) {
      /* Le corps d'erreur de l'API peut contenir des détails de configuration.
         On ne le relaie pas : le client n'en fait rien, et une réponse
         d'erreur finit toujours par être copiée quelque part. */
      return refus("source indisponible", 502);
    }

    const json = await reponse.json();
    const candidat = (json.candidates || [])[0];
    const sources = sourcesAncrage(candidat);
    const items = extraireJSON(texteDe(candidat))
      .slice(0, RESULTATS_MAX)
      .map((brut) => normaliserDecouverte(brut, { sources, ville, empreinte }))
      .filter(Boolean);

    return new Response(JSON.stringify({
      items, source: "gemini", actif: true,
      ancrage: sources.length,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        /* Court, parce que ces contenus sont datés — mais servi périmé
           pendant six heures pendant qu'il se rafraîchit derrière : personne
           n'attend jamais le modèle, même quand le cache vient d'expirer. */
        "cache-control": "public, s-maxage=900, stale-while-revalidate=21600",
      },
    });
  } catch (e) {
    // délai dépassé, réseau, réponse illisible : tous le même sort
    return refus("source indisponible", 503);
  }
}
