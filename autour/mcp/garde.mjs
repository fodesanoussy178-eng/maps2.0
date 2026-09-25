/* ===========================================================================
   QUI PEUT APPELER, COMBIEN DE FOIS, ET CE QU'ON EN GARDE

   Trois décisions, prises ici une fois pour toutes.

   1. L'AUTHENTIFICATION. Tant que `MCP_AUTOUR_TOKEN` est défini, un jeton est
      EXIGÉ : c'est le mode de la phase de recette, où seul Autour appelle son
      propre serveur. Sans cette variable, le serveur répond en lecture
      publique — ce que ChatGPT exige d'une app sans compte — et le plafond
      d'appels devient la seule protection. Le choix est donc explicite et
      réversible par une variable d'environnement, jamais par du code.

      Ce qui n'arrive JAMAIS : une clé Supabase privilégiée ici. Le serveur lit
      avec la clé publiable, celle du navigateur, bornée par RLS.

   2. LE PLAFOND. Il est compté en base (`mcp_quota`), donc partagé par toutes
      les instances de la fonction. Un compteur en mémoire ne plafonnerait
      qu'un exemplaire, et il y en a un par région. Le compteur mémoire existe
      quand même, en première ligne : il évite un aller-retour en base pour une
      rafale évidente.

   3. LA JOURNALISATION. Une ligne par appel : l'outil, le verdict, la durée, la
      zone. PAS l'adresse IP, PAS le jeton, PAS la requête de la personne. La
      clé de comptage est une EMPREINTE tronquée — assez pour distinguer deux
      appelants, inutilisable pour en identifier un.
   ======================================================================== */

import * as base from "./base.mjs";

const QUOTA_DEFAUT = 60;         // appels par fenêtre
const FENETRE_S = 60;
const RAFALE_MAX = 12;           // par instance et par 10 s, avant la base
const RAFALE_MS = 10000;
const DELAI_OUTIL_MS = 9000;

const rafales = new Map();

function env() {
  return (typeof process !== "undefined" && process.env) || {};
}

export async function empreinte(valeur) {
  const octets = new TextEncoder().encode("autour-mcp:" + String(valeur || ""));
  const condensat = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(condensat)].slice(0, 12)
    .map((o) => o.toString(16).padStart(2, "0")).join("");
}

/* Comparaison à temps constant : une comparaison naïve fuit la longueur du
   préfixe commun, et un jeton se devine caractère par caractère. */
function memeJeton(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function jetonsAttendus() {
  return String(env().MCP_AUTOUR_TOKEN || "").split(",")
    .map((t) => t.trim()).filter(Boolean);
}

function jetonPresente(requete) {
  const entete = requete.headers.get("authorization") || "";
  const parJeton = /^Bearer\s+(.+)$/i.exec(entete);
  if (parJeton) return parJeton[1].trim();
  return (requete.headers.get("x-api-key") || "").trim();
}

function rafaleDepassee(cle) {
  const maintenant = Date.now();
  const entree = rafales.get(cle);
  if (!entree || maintenant - entree.debut > RAFALE_MS) {
    rafales.set(cle, { debut: maintenant, appels: 1 });
    if (rafales.size > 500) rafales.clear();
    return false;
  }
  entree.appels += 1;
  return entree.appels > RAFALE_MAX;
}

export async function autoriser(requete) {
  const attendus = jetonsAttendus();
  const presente = jetonPresente(requete);
  if (attendus.length) {
    if (!presente) return { ok: false, statut: 401, raison: "jeton_absent" };
    if (!attendus.some((attendu) => memeJeton(attendu, presente)))
      return { ok: false, statut: 401, raison: "jeton_invalide" };
  }
  /* Sans jeton exigé, on compte par appelant réseau — mais on ne garde jamais
     son adresse : seule l'empreinte sert, et elle ne sort pas d'ici. */
  const identite = presente || requete.headers.get("x-forwarded-for") ||
    requete.headers.get("x-real-ip") || "anonyme";
  const cle = await empreinte(identite);
  if (rafaleDepassee(cle))
    return { ok: false, statut: 429, raison: "rafale", cle };
  const max = Math.max(1, Math.min(600, Number(env().MCP_AUTOUR_QUOTA) || QUOTA_DEFAUT));
  try {
    const verdict = await base.quota(cle, max, FENETRE_S);
    if (verdict && verdict.autorise === false)
      return { ok: false, statut: 429, raison: "plafond", cle,
        restant: 0, fenetreFin: verdict.fenetre_fin };
    return { ok: true, cle, restant: verdict ? verdict.restant : null, max };
  } catch (e) {
    /* La base indisponible ne doit pas ouvrir la porte en grand ni fermer le
       service : la rafale par instance reste, et on le dit dans le journal. */
    return { ok: true, cle, restant: null, max, plafondIndisponible: true };
  }
}

export function avecDelai(promesse, ms = DELAI_OUTIL_MS) {
  return Promise.race([
    promesse,
    new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("delai_depasse")), ms)),
  ]);
}

export function journaliser(ligne) {
  /* Une seule ligne, structurée, sans donnée personnelle. `cle` est une
     empreinte tronquée ; elle sert à repérer une boucle, pas une personne. */
  try {
    console.log(JSON.stringify(Object.assign({ service: "mcp-autour" }, ligne)));
  } catch (e) { /* un journal ne doit jamais casser une réponse */ }
}

export const LIMITES = Object.freeze({ QUOTA_DEFAUT, FENETRE_S, RAFALE_MAX, RAFALE_MS,
  DELAI_OUTIL_MS });
