/* ---------------------------------------------------------------------------
   fraicheur — un cycle de 48 h

   CE QU'ELLE FAIT, DANS L'ORDRE

     1. ouvre un cycle dans `freshness_runs` ;
     2. demande à `programmer_fraicheur()` de remplir la file — c'est LUI le
        producteur qui manquait : `event_sync_runs` disait ce qui avait tourné,
        rien ne disait ce qui restait à faire ;
     3. prend les tâches par priorité, et pour chacune essaie les voies DANS
        L'ORDRE DE LEUR COÛT : déterministe, puis HTTP structuré, puis
        groundée ;
     4. écrit des PROPOSITIONS, jamais dans `places` ni `events` ;
     5. laisse `decider_propositions()` appliquer la règle d'acceptation, et
        `couper_voies_deviantes()` couper ce qui se trompe trop.

   CE QU'ELLE NE FAIT PAS

     · elle n'écrit aucun horaire, par aucune voie (règle A.7) ;
     · elle ne publie rien : une proposition acceptée attend encore d'être
       appliquée, et pour la famille solidaire, relue par un humain ;
     · elle ne dépense pas un appel de modèle pour ce que SIRENE donne
       gratuitement — c'est le sens de l'ordre des voies, pas une préférence.

   LE BUDGET N'EST PAS RÉÉCRIT ICI. `reserver_enrichissement()` et
   `enrichment_usage_daily` existent déjà, avec réservation AVANT appel. Un
   deuxième mécanisme de plafond serait un deuxième endroit où se tromper.

   Voir autour/docs/fraicheur.md.
--------------------------------------------------------------------------- */

import {
  INCONNU, premierVerdict, signalHead,
  statutDepuisEvenementLd, statutDepuisFiness, statutDepuisSirene,
  evenementsJsonLd, validerContrat,
} from "./voies.mjs";
import { corpsRequete, POINT_DE_TERMINAISON, verdict as verdictGrounde } from "./grounde.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_CYCLE = Deno.env.get("FRAICHEUR_SECRET") ?? "";
const CLE_GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODELE = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";

/* 5 000 requêtes groundées gratuites par mois, puis 14 $ les mille. Un appel
   peut déclencher PLUSIEURS requêtes de recherche, et chacune est facturée :
   ~160 appels par jour, donc ~330 objets par cycle de 48 h. Ce nombre est la
   seule raison pour laquelle les voies 1 et 2 existent. */
const BUDGET_CYCLE = Number(Deno.env.get("FRAICHEUR_BUDGET_CYCLE") ?? "330");
/* Le plafond quotidien du dépôt, réutilisé tel quel. */
const BUDGET_JOUR = Number(Deno.env.get("ENRICHISSEMENT_BUDGET_JOUR") ?? "400");
const TACHES_PAR_PASSE = Number(Deno.env.get("FRAICHEUR_TACHES_PAR_PASSE") ?? "60");

const DELAI_HTTP_MS = 8_000;
const DELAI_MODELE_MS = 60_000;

const SIRENE = "https://recherche-entreprises.api.gouv.fr/search";

type Json = Record<string, unknown>;

let cleMemorisee: string | null = null;
function cleSecrete(): string {
  if (cleMemorisee) return cleMemorisee;
  const dictionnaire = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dictionnaire) {
    const clés = JSON.parse(dictionnaire) as Record<string, string>;
    const nommée = Deno.env.get("SUPABASE_SECRET_KEY_NAME") ?? "default";
    if (!clés[nommée]) throw new Error(`clé secrète « ${nommée} » absente`);
    cleMemorisee = clés[nommée];
    return cleMemorisee;
  }
  const unique = Deno.env.get("SUPABASE_SECRET_KEY");
  if (!unique) throw new Error("aucune clé secrète : SUPABASE_SECRET_KEYS attendue");
  cleMemorisee = unique;
  return cleMemorisee;
}

async function rest(chemin: string, init: RequestInit = {}): Promise<Response> {
  const cle = cleSecrete();
  return fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: cle, Authorization: `Bearer ${cle}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });
}

async function lire(chemin: string): Promise<Json[]> {
  const r = await rest(chemin);
  if (!r.ok) throw new Error(`lecture ${chemin} : HTTP ${r.status}`);
  return await r.json();
}

async function ecrire(chemin: string, corps: unknown, methode = "POST"): Promise<Json[]> {
  const r = await rest(chemin, {
    method: methode, body: JSON.stringify(corps),
    headers: { Prefer: "return=representation" },
  });
  if (!r.ok) throw new Error(`écriture ${chemin} : HTTP ${r.status}`);
  const texte = await r.text();
  return texte ? JSON.parse(texte) : [];
}

async function appeler(fonction: string, arguments_: Json): Promise<unknown> {
  const r = await rest(`rpc/${fonction}`, { method: "POST", body: JSON.stringify(arguments_) });
  if (!r.ok) throw new Error(`rpc ${fonction} : HTTP ${r.status}`);
  const texte = await r.text();
  return texte ? JSON.parse(texte) : null;
}

/* ---- Le même contrôle de secret que les autres synchronisations ---------- */
async function memeSecret(fourni: string, attendu: string): Promise<boolean> {
  if (!attendu) return false;
  const encodeur = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encodeur.encode(fourni)),
    crypto.subtle.digest("SHA-256", encodeur.encode(attendu)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i += 1) difference |= x[i] ^ y[i];
  return difference === 0;
}

/* =========================================================================
   VOIE 1 — DÉTERMINISTE
   ========================================================================= */

async function voieDeterministe(objet: Json) {
  const siret = String(objet.siret ?? "").replace(/\s+/g, "");
  if (/^\d{14}$/.test(siret)) {
    try {
      const url = `${SIRENE}?q=${encodeURIComponent(siret)}&page=1&per_page=1`;
      const r = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DELAI_HTTP_MS),
      });
      if (r.ok) {
        const v = statutDepuisSirene(await r.json(), siret, url);
        if (v.statut !== "inconnu") return v;
      }
    } catch { /* une source gratuite indisponible n'est pas un échec de cycle */ }
  }

  /* FINESS, quand l'objet en porte un : c'est le référentiel qui fait foi sur
     les établissements sanitaires et médico-sociaux. */
  const finess = String(objet.finess ?? "").replace(/\s+/g, "");
  const finessUrl = Deno.env.get("FINESS_FICHE_URL");
  if (finess && finessUrl) {
    try {
      const url = finessUrl.replace("{finess}", encodeURIComponent(finess));
      const r = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DELAI_HTTP_MS),
      });
      if (r.ok) {
        const v = statutDepuisFiness(await r.json(), url);
        if (v.statut !== "inconnu") return v;
      }
    } catch { /* idem */ }
  }

  /* `HEAD` sur l'URL officielle. IL NE PRODUIT AUCUNE PROPOSITION : une page
     qui répond ne prouve pas qu'un lieu est ouvert, et un 404 ne prouve pas
     qu'il a fermé — un site refait donne le même code. Ce signal sert à
     nourrir `resultat`, que la relecture humaine lira. */
  const officielle = String(objet.official_url ?? "");
  if (/^https?:\/\//i.test(officielle)) {
    try {
      const r = await fetch(officielle, {
        method: "HEAD", redirect: "follow",
        signal: AbortSignal.timeout(DELAI_HTTP_MS),
      });
      return { ...INCONNU, signal: signalHead(r.status) };
    } catch {
      return { ...INCONNU, signal: { joignable: false, alerte: "injoignable" } };
    }
  }
  return { ...INCONNU };
}

/* =========================================================================
   VOIE 2 — HTTP STRUCTURÉ

   Le JSON-LD `schema.org/Event` du `<head>`. On lit l'URL officielle de
   l'objet lui-même : ce n'est pas une collecte de sites tiers, c'est aller
   lire ce que le lieu publie sur lui-même, au format qu'il a choisi d'exposer.
   ========================================================================= */

async function voieHttp(objet: Json) {
  const officielle = String(objet.official_url ?? objet.source_url ?? "");
  if (!/^https?:\/\//i.test(officielle)) return { ...INCONNU };
  let html = "";
  try {
    const r = await fetch(officielle, {
      headers: { accept: "text/html,application/xhtml+xml",
                 "user-agent": "Autour/1.0 (+https://autour.eu/)" },
      signal: AbortSignal.timeout(DELAI_HTTP_MS),
    });
    if (!r.ok) return { ...INCONNU };
    html = await r.text();
  } catch {
    return { ...INCONNU };
  }

  const evenements = evenementsJsonLd(html, officielle);
  if (!evenements.length) return { ...INCONNU };

  /* Pour un événement, on cherche CELUI dont on parle : rapprocher par le
     titre normalisé évite de transporter le statut d'un concert sur celui
     d'à côté. Sans correspondance, on ne conclut rien. */
  const normal = (v: unknown) => String(v ?? "").normalize("NFD")
    .replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const attendu = normal(objet.title ?? objet.name);
  const correspondant = evenements.find((e) => attendu && normal(e.titre) === attendu);
  if (!correspondant) return { ...INCONNU };
  return statutDepuisEvenementLd(correspondant);
}

/* =========================================================================
   VOIE 3 — GROUNDÉE, SOUS QUOTA

   Uniquement le reliquat que les deux premières n'ont pas tranché, et
   uniquement si le budget du jour le permet. La réservation a lieu AVANT
   l'appel : `reserver_enrichissement` rend `accorde = false` quand le plafond
   est atteint, et alors aucun appel ne part.
   ========================================================================= */

async function voieGroundee(objet: Json) {
  if (!CLE_GEMINI) return { ...INCONNU, refus: "modele_non_configure" };

  const ouverte = await appeler("voie_ouverte", { p_voie: "grounde" });
  if (ouverte === false) return { ...INCONNU, refus: "voie_coupee" };

  const reservation = await appeler("reserver_enrichissement", { p_plafond: BUDGET_JOUR });
  const accorde = Array.isArray(reservation)
    ? Boolean((reservation[0] as Json)?.accorde)
    : Boolean((reservation as Json)?.accorde);
  if (!accorde) return { ...INCONNU, refus: "budget_atteint" };

  let succes = false;
  try {
    const r = await fetch(POINT_DE_TERMINAISON, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": CLE_GEMINI },
      body: JSON.stringify(corpsRequete({
        nom: objet.name ?? objet.title,
        commune: objet.commune ?? objet.city,
        adresse: objet.address,
      }, MODELE)),
      signal: AbortSignal.timeout(DELAI_MODELE_MS),
    });
    if (!r.ok) return { ...INCONNU, refus: `http_${r.status}` };
    const v = verdictGrounde(await r.json());
    /* « Rien trouvé » est un succès d'exécution : l'appel a coûté, il compte,
       et le savoir évite de le repayer demain. */
    succes = true;
    return v;
  } catch (erreur) {
    return { ...INCONNU, refus: String((erreur as Error)?.message ?? "appel_echoue") };
  } finally {
    await appeler("cloturer_enrichissement", { p_succes: succes }).catch(() => {});
  }
}

/* =========================================================================
   LE CYCLE
   ========================================================================= */

async function chargerObjet(tache: Json): Promise<Json | null> {
  const id = encodeURIComponent(String(tache.objet_id));
  const table = tache.objet_kind === "place"
    ? `places?id=eq.${id}&select=id,name,commune,city,address,official_url,family,sous_type&limit=1`
    : `events?id=eq.${id}&select=id,title,city,address,source_url,start_at&limit=1`;
  const lignes = await lire(table);
  return lignes[0] ?? null;
}

async function traiter(tache: Json, runId: number) {
  const objet = await chargerObjet(tache);
  if (!objet) {
    await ecrire(`freshness_tasks?id=eq.${tache.id}`,
      { etat: "abandonnee", fini_le: new Date().toISOString(), erreur: "objet_absent" }, "PATCH");
    return null;
  }

  /* L'ORDRE DES VOIES. On s'arrête à la première qui tranche : une voie
     gratuite qui répond rend la suivante inutile, et c'est tout le principe. */
  const verdicts: Record<string, unknown> = {};
  verdicts.deterministe = await voieDeterministe(objet);
  let choisi = premierVerdict(verdicts);

  if (choisi.statut === "inconnu" && ["http", "grounde"].includes(String(tache.voie))) {
    verdicts.http = await voieHttp(objet);
    choisi = premierVerdict(verdicts);
  }
  if (choisi.statut === "inconnu" && String(tache.voie) === "grounde") {
    verdicts.grounde = await voieGroundee(objet);
    choisi = premierVerdict(verdicts);
  }

  const maintenant = new Date().toISOString();
  await ecrire(`freshness_tasks?id=eq.${tache.id}`, {
    etat: "faite", fini_le: maintenant, resultat: verdicts,
  }, "PATCH");

  /* La vérification a eu lieu, même quand elle n'a rien conclu : sans cette
     écriture, le même objet reviendrait dans la file à chaque cycle et
     mangerait le budget de tout le monde. */
  const table = tache.objet_kind === "place" ? "places" : "events";
  await ecrire(`${table}?id=eq.${encodeURIComponent(String(tache.objet_id))}`, {
    fraicheur_verifiee_le: maintenant,
    fraicheur_voie: choisi.voie ?? String(tache.voie),
  }, "PATCH");

  if (choisi.statut === "inconnu") return null;

  /* UNE SOURCE DÉTERMINISTE CONTREDIT LES AUTRES, jamais l'inverse : SIRENE a
     raison contre une page web, et une page web a raison contre une recherche.
     C'est cette mesure, et elle seule, qui peut couper une voie (A.8). */
  if (choisi.voie === "deterministe") {
    await appeler("contredire_proposition", {
      p_objet_kind: tache.objet_kind, p_objet_id: tache.objet_id, p_statut_reel: choisi.statut,
    }).catch(() => {});
  }

  const valide = validerContrat(choisi);
  const officielle = await appeler("source_officielle", {
    p_url: valide.url_source, p_url_du_lieu: objet.official_url ?? null,
  });
  const [proposition] = await ecrire("freshness_proposals", {
    task_id: tache.id, run_id: runId,
    objet_kind: tache.objet_kind, objet_id: tache.objet_id,
    voie: choisi.voie,
    statut: valide.statut,
    date_information: valide.date_information,
    url_source: valide.url_source,
    confiance: valide.confiance,
    source_officielle: officielle === true,
  });
  return proposition ?? null;
}

async function cycle() {
  const [run] = await ecrire("freshness_runs", { budget_cycle: BUDGET_CYCLE });
  const runId = Number(run.id);
  let traitees = 0, propositions = 0;
  let statut = "succes";

  try {
    await appeler("programmer_fraicheur", { p_budget: BUDGET_CYCLE, p_run_id: runId });

    const taches = await lire(
      "freshness_tasks?etat=eq.a_faire&order=priorite.asc,cree_le.asc" +
      `&limit=${Math.max(1, Math.min(500, TACHES_PAR_PASSE))}` +
      "&select=id,type_objet,objet_kind,objet_id,voie,priorite");

    for (const tache of taches) {
      await ecrire(`freshness_tasks?id=eq.${tache.id}`,
        { etat: "en_cours", pris_le: new Date().toISOString(), run_id: runId }, "PATCH");
      try {
        const proposition = await traiter(tache, runId);
        if (proposition) propositions += 1;
        traitees += 1;
      } catch (erreur) {
        statut = "partiel";
        await ecrire(`freshness_tasks?id=eq.${tache.id}`, {
          etat: "abandonnee", fini_le: new Date().toISOString(),
          erreur: String((erreur as Error)?.message ?? erreur).slice(0, 400),
        }, "PATCH");
      }
    }

    await appeler("decider_propositions", { p_run_id: runId });
    await appeler("couper_voies_deviantes", {});
  } catch (erreur) {
    statut = "echec";
    console.error(JSON.stringify({ fonction: "fraicheur", etape: "cycle",
      erreur: String((erreur as Error)?.message ?? erreur) }));
  }

  await ecrire(`freshness_runs?id=eq.${runId}`, {
    fini_le: new Date().toISOString(), traitees, propositions, statut,
  }, "PATCH");
  return { run_id: runId, traitees, propositions, statut };
}

Deno.serve(async (request: Request) => {
  const fourni = request.headers.get("x-fraicheur-secret") ?? "";
  if (!await memeSecret(fourni, SECRET_CYCLE)) {
    console.error(JSON.stringify({ fonction: "fraicheur", etape: "refus",
      secret_configure: SECRET_CYCLE.length > 0, entete_presente: fourni.length > 0 }));
    return Response.json({ error: "non autorisé" }, { status: 401 });
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "cycle";
  if (mode === "mesure") {
    return Response.json({ voies: await appeler("mesurer_voies", {}) });
  }
  if (mode !== "cycle") {
    return Response.json({ error: "mode=cycle ou mode=mesure" }, { status: 400 });
  }
  try {
    const resultat = await cycle();
    return Response.json(resultat, { status: resultat.statut === "echec" ? 502 : 200 });
  } catch (erreur) {
    return Response.json({ error: String((erreur as Error)?.message ?? erreur) }, { status: 502 });
  }
});
