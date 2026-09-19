/* ---------------------------------------------------------------------------
   agora-assistant — l'assistant de rédaction d'AGORA

   CE QU'IL FAIT : reformuler, rédiger, traduire, récapituler. À la demande,
   depuis l'écran, de façon synchrone — il n'est pas dans la file de tâches
   parce qu'on attend sa réponse.

   CE QU'IL NE FAIT PAS, ET COMMENT ON LE SAIT :

   · IL N'ENVOIE RIEN. Aucune fonction d'envoi ici, et `task_permissions` porte
     `check (contact_externe = false)` pour la ligne « redaction ».
   · IL N'ÉCRIT RIEN EN BASE, sauf sa propre ligne de journal. Il rend du texte ;
     c'est l'opérateur qui décide d'en faire un brouillon.
   · IL NE PARLE À PERSONNE D'AUTRE QU'AU MODÈLE. Une seule requête sortante.

   TROIS VERROUS AVANT LE MOINDRE APPEL PAYANT :

   1. Le JWT est vérifié par la plateforme (`verify_jwt`).
   2. L'appelant doit être opérateur ET avoir déverrouillé AGORA — vérifié en
      appelant `agora_etat()` AVEC SON PROPRE JETON, donc sous RLS. Un jeton
      valide d'un compte quelconque ne suffit pas.
   3. Le budget du jour doit rester sous le plafond, lu en base.

   POURQUOI LE CONTRÔLE D'ACCÈS N'UTILISE PAS LA CLÉ DE SERVICE : parce qu'avec
   elle, `agora_etat()` répondrait pour le rôle de service, pas pour la personne.
   La question « cette personne a-t-elle le droit » ne peut se poser qu'avec son
   jeton à elle.
--------------------------------------------------------------------------- */

import { verifierInterdits } from "../shared/interdits.mjs";
import {
  blocFaits, decouperRedaction, inviteHumaniser, inviteRediger, inviteTraduire,
} from "./invite.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CLE_GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODELE = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";

const POINT_DE_TERMINAISON =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const DELAI_MS = 45_000;

/* LE COÛT EST UNE ESTIMATION, ET LE JOURNAL LE DIT.
   Ces tarifs sont recopiés à la main d'une grille de prix qui change sans
   prévenir. Ils servent à empêcher une dérive, pas à tenir une comptabilité :
   tout ce qui est écrit dans `runs.cout_eur` par cette fonction est un ordre de
   grandeur, et le message de journal le répète pour qu'on ne le lise jamais
   comme une facture. */
const EUR_PAR_MJETON_ENTREE = 0.10;
const EUR_PAR_MJETON_SORTIE = 0.40;
const COUT_FORFAITAIRE_SI_INCONNU = 0.002;

type Json = Record<string, unknown>;

const json = (corps: Json, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/* --- La base, sous l'identité qui convient ------------------------------- */

async function restService(chemin: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${chemin} — ${texte.slice(0, 200)}`);
  return texte ? JSON.parse(texte) : null;
}

/* La question d'autorisation se pose avec le jeton de la personne. */
async function etatAppelant(jeton: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/agora_etat`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!r.ok) return null;
  return await r.json();
}

async function journal(etape: string, statut: string, message: string,
                       compteurs: Json = {}, cout = 0) {
  try {
    await restService("runs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        task_id: null, agent: "redaction", etape, statut, message,
        compteurs, details: {}, cout_eur: cout, fin: new Date().toISOString(),
      }]),
    });
  } catch (e) {
    console.error("journal indisponible", (e as Error).message);
  }
}

/* --- Le modèle ----------------------------------------------------------- */

function texteSortie(j: any): string {
  if (typeof j?.output_text === "string") return j.output_text;
  if (typeof j?.outputText === "string") return j.outputText;
  if (typeof j?.text === "string") return j.text;
  const etapes = Array.isArray(j?.steps) ? j.steps
    : Array.isArray(j?.outputs) ? j.outputs : [];
  return etapes
    .map((e: any) => typeof e?.text === "string" ? e.text : "")
    .filter(Boolean).join("\n").trim();
}

function coutDe(j: any): { cout: number; estime: boolean } {
  const u = j?.usage || j?.usageMetadata || {};
  const entree = Number(u.input_tokens ?? u.promptTokenCount ?? 0);
  const sortie = Number(u.output_tokens ?? u.candidatesTokenCount ?? 0);
  if (!entree && !sortie) return { cout: COUT_FORFAITAIRE_SI_INCONNU, estime: true };
  return {
    cout: (entree / 1e6) * EUR_PAR_MJETON_ENTREE + (sortie / 1e6) * EUR_PAR_MJETON_SORTIE,
    estime: true,
  };
}

async function appelerModele(invite: string) {
  if (!CLE_GEMINI) throw new Error("GEMINI_API_KEY absente de la configuration");
  const r = await fetch(POINT_DE_TERMINAISON, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": CLE_GEMINI },
    body: JSON.stringify({ model: MODELE, input: invite }),
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!r.ok) throw new Error(`modèle : HTTP ${r.status}`);
  const j = await r.json();
  return { texte: texteSortie(j), ...coutDe(j) };
}

/* --- Ce que l'assistant a le droit de lire -------------------------------- */

async function contexteOpportunite(id: string) {
  const [o] = await restService(
    `acquisition_vue?id=eq.${encodeURIComponent(id)}&select=*`) || [];
  if (!o) throw new Error("opportunité introuvable");
  const criteres = await restService(
    `acquisition_qualifications?opportunite_id=eq.${encodeURIComponent(id)}` +
    `&select=critere,niveau,pourquoi`);
  return { ...o, criteres: criteres || [] };
}

/* --- Le récapitulatif : AUCUN APPEL DE MODÈLE ----------------------------
   Les objectifs sont écrits par le fondateur et les chiffres viennent de
   `acquisition_entonnoir()`. Les faire reformuler par un modèle coûterait de
   l'argent pour risquer une paraphrase inexacte d'un nombre exact. */
async function recapitulatif() {
  const [objectifs, etapes, couverture] = await Promise.all([
    restService("agora_objectifs?actif=is.true&select=*&order=ordre.asc,id.asc"),
    restService("rpc/acquisition_entonnoir", { method: "POST", body: "{}" }),
    restService("rpc/acquisition_couverture", { method: "POST", body: "{}" }),
  ]);
  const aRevoir = (couverture || []).filter((t: any) => t.a_revoir).map((t: any) => t.nom);
  return {
    objectifs: objectifs || [],
    entonnoir: etapes || [],
    territoires_a_revoir: aRevoir,
    sans_objectif: !(objectifs || []).length,
  };
}

/* --- La porte ------------------------------------------------------------ */

Deno.serve(async (requete) => {
  if (requete.method !== "POST") return json({ erreur: "méthode" }, 405);

  const entete = requete.headers.get("Authorization") ?? "";
  const jeton = entete.startsWith("Bearer ") ? entete.slice(7) : "";
  if (!jeton) return json({ erreur: "non autorisé" }, 401);

  const etat = await etatAppelant(jeton);
  if (!etat?.operateur) return json({ erreur: "non opérateur" }, 403);
  if (!etat?.ouvert) return json({ erreur: "AGORA verrouillé" }, 403);
  if (etat?.anonyme) return json({ erreur: "session anonyme" }, 403);

  let corps: any = {};
  try { corps = await requete.json(); } catch { return json({ erreur: "corps illisible" }, 400); }
  const mode = String(corps.mode || "");

  try {
    /* Le récapitulatif ne coûte rien : il passe avant le contrôle de budget. */
    if (mode === "recap") return json({ mode, ...(await recapitulatif()) });

    const [{ agora_assistant_cout_du_jour: depense }, { agora_assistant_plafond_eur: plafond }] =
      await Promise.all([
        restService("rpc/agora_assistant_cout_du_jour", { method: "POST", body: "{}" })
          .then((v: any) => ({ agora_assistant_cout_du_jour: Number(v) })),
        restService("rpc/agora_assistant_plafond_eur", { method: "POST", body: "{}" })
          .then((v: any) => ({ agora_assistant_plafond_eur: Number(v) })),
      ]);
    if (depense >= plafond) {
      await journal("budget", "partiel",
        `Plafond du jour atteint (${depense.toFixed(4)} € sur ${plafond.toFixed(2)} €). Aucun appel lancé.`);
      return json({ erreur: "budget du jour atteint", depense, plafond }, 429);
    }

    let invite = "";
    let source = "";
    if (mode === "rediger") {
      const o = await contexteOpportunite(String(corps.opportunite_id || ""));
      invite = inviteRediger(o, String(corps.consigne || ""), String(corps.langue || "français"));
      source = o.nom;
    } else if (mode === "humaniser") {
      invite = inviteHumaniser(String(corps.texte || ""), String(corps.consigne || ""));
    } else if (mode === "traduire") {
      /* On ne traduit qu'un texte déjà vérifié : la garde est forte en français,
         correcte en anglais, faible ailleurs. Vérifier après traduction serait
         vérifier dans une langue qu'on ne couvre pas. */
      const avant = verifierInterdits(String(corps.texte || ""));
      if (avant.length) {
        return json({ erreur: "texte refusé avant traduction", interdits: avant }, 422);
      }
      invite = inviteTraduire(String(corps.texte || ""), String(corps.langue || "anglais"));
    } else {
      return json({ erreur: `mode « ${mode} » inconnu` }, 400);
    }

    const debut = Date.now();
    const { texte, cout, estime } = await appelerModele(invite);

    /* LA VÉRIFICATION A LIEU APRÈS LE MODÈLE, PAS DANS L'INVITE.
       Une invite demande ; une expression régulière constate. */
    const interdits = mode === "traduire" ? [] : verifierInterdits(texte);
    if (interdits.length) {
      await journal(mode, "partiel",
        `Sortie refusée : ${interdits.map((i) => i.pourquoi).join(" ; ")}. ` +
        `L'appel a été payé, le texte n'est pas montré.`,
        { interdits: interdits.length }, cout);
      return json({ erreur: "sortie refusée par la relecture", interdits }, 422);
    }

    await journal(mode, "succes",
      `${mode}${source ? " — " + source : ""} : ${texte.length} caractères. ` +
      `Coût ESTIMÉ ${cout.toFixed(5)} € (ordre de grandeur, pas une facture).`,
      { caracteres: texte.length, duree_ms: Date.now() - debut }, cout);

    const sortie: Json = { mode, texte, cout_estime: cout, estime, modele: MODELE };
    if (mode === "rediger") Object.assign(sortie, decouperRedaction(texte));
    return json(sortie);
  } catch (e) {
    const message = (e as Error).message || String(e);
    await journal(mode || "inconnu", "echec", message);
    return json({ erreur: message }, 500);
  }
});
