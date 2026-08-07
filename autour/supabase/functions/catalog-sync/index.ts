/* ---------------------------------------------------------------------------
   catalog-sync — Phase 0 de la couche mobilité.

   Interroge le catalogue officiel transport.data.gouv.fr, retient les jeux de
   données du périmètre demandé (MEL par défaut) et les enregistre dans
   mobility_datasets / mobility_coverage. Chaque exécution est tracée dans
   mobility_sync_runs.

   Ce que cette fonction NE fait PAS, délibérément :
     · aucun téléchargement de GTFS, de BNAC ou de flux GBFS ;
     · aucun décodage de temps réel ;
     · aucune écriture consommée par le frontend.
   Elle découvre ce qui existe et où. Les imports viendront ensuite, chacun
   avec sa propre migration et sa propre validation.

   Déploiement : cette fonction écrit avec la clé de service. Elle ne doit
   jamais être exposée publiquement — l'appel exige un secret partagé.
--------------------------------------------------------------------------- */

import {normalizeCatalog, SCOPES} from "./catalog.mjs";

const PAN_BASE = Deno.env.get("PAN_BASE_URL") ?? "https://transport.data.gouv.fr/api";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_SECRET = Deno.env.get("CATALOG_SYNC_SECRET") ?? "";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

type Json = Record<string, unknown>;

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/* Un fournisseur indisponible ne doit jamais bloquer : timeout court, trois
   tentatives espacées, puis échec propre et journalisé. */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: control.signal,
        headers: {Accept: "application/json", "User-Agent": "Autour/catalog-sync"},
      });
      clearTimeout(timer);
      // 4xx : inutile de réessayer, la requête elle-même est en cause
      if (!response.ok && response.status < 500) return response;
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
  throw lastError ?? new Error("catalogue injoignable");
}

async function openRun(scope: string): Promise<number | null> {
  const response = await rest("mobility_sync_runs", {
    method: "POST",
    headers: {Prefer: "return=representation"},
    body: JSON.stringify([{scope, status: "running"}]),
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0]?.id ?? null;
}

async function closeRun(id: number | null, patch: Json): Promise<void> {
  if (id == null) return;
  await rest(`mobility_sync_runs?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({finished_at: new Date().toISOString(), ...patch}),
  });
}

/* Le catalogue fait foi : on écrase la couverture précédente du jeu de
   données plutôt que de fusionner. Un territoire retiré à la source doit
   disparaître chez nous aussi. */
async function upsertCoverage(datasetId: number, coverage: Json[]): Promise<number> {
  await rest(`mobility_coverage?dataset_id=eq.${datasetId}`, {method: "DELETE"});
  if (!coverage.length) return 0;
  const response = await rest("mobility_coverage", {
    method: "POST",
    body: JSON.stringify(coverage.map((zone) => ({...zone, dataset_id: datasetId}))),
  });
  return response.ok ? coverage.length : 0;
}

async function syncScope(scope: string) {
  const url = `${PAN_BASE}/datasets`;
  const response = await fetchWithRetry(url);
  const httpStatus = response.status;
  if (!response.ok) {
    throw Object.assign(new Error(`catalogue HTTP ${httpStatus}`), {httpStatus});
  }

  const payload = await response.json();
  const {seen, kept, rejected} = normalizeCatalog(payload, scope);

  let upserted = 0;
  let coverageCount = 0;
  const failures: string[] = [];

  for (const entry of kept) {
    const body = {...entry.dataset, last_seen_at: new Date().toISOString()};
    const saved = await rest("mobility_datasets?on_conflict=pan_id", {
      method: "POST",
      headers: {Prefer: "resolution=merge-duplicates,return=representation"},
      body: JSON.stringify([body]),
    });
    if (!saved.ok) {
      // un jeu de données en échec ne fait pas tomber la synchronisation
      failures.push(`${entry.dataset.pan_id}: HTTP ${saved.status}`);
      continue;
    }
    upserted += 1;
    const rows = await saved.json();
    const datasetId = rows?.[0]?.id;
    if (datasetId != null) {
      coverageCount += await upsertCoverage(datasetId, entry.coverage);
    }
  }

  return {seen, kept: kept.length, rejected, upserted, coverageCount, failures, httpStatus};
}

Deno.serve(async (request: Request) => {
  // écriture avec la clé de service : l'accès doit être explicitement autorisé
  const provided = request.headers.get("x-sync-secret") ?? "";
  if (!SYNC_SECRET || provided !== SYNC_SECRET) {
    return new Response(JSON.stringify({error: "non autorisé"}), {
      status: 401, headers: {"Content-Type": "application/json"},
    });
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "mel";
  if (!(scope in SCOPES)) {
    return new Response(JSON.stringify({error: `périmètre inconnu : ${scope}`}), {
      status: 400, headers: {"Content-Type": "application/json"},
    });
  }

  const startedAt = Date.now();
  const runId = await openRun(scope);

  try {
    const result = await syncScope(scope);
    const status = result.failures.length ? "partial" : "success";
    await closeRun(runId, {
      status,
      duration_ms: Date.now() - startedAt,
      datasets_seen: result.seen,
      datasets_upserted: result.upserted,
      coverage_upserted: result.coverageCount,
      http_status: result.httpStatus,
      error: result.failures.length ? result.failures.slice(0, 20).join(" | ") : null,
      details: {
        scope_label: SCOPES[scope as keyof typeof SCOPES].label,
        kept: result.kept,
        rejected_unusable: result.rejected,
        failures: result.failures.length,
      },
    });
    return new Response(JSON.stringify({status, scope, ...result}), {
      headers: {"Content-Type": "application/json"},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await closeRun(runId, {
      status: "error",
      duration_ms: Date.now() - startedAt,
      http_status: (error as {httpStatus?: number})?.httpStatus ?? null,
      error: message,
    });
    // l'échec est tracé et renvoyé, jamais avalé
    return new Response(JSON.stringify({status: "error", scope, error: message}), {
      status: 502, headers: {"Content-Type": "application/json"},
    });
  }
});
