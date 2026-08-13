/* ---------------------------------------------------------------------------
   sync-datatourisme — la source institutionnelle entre par le serveur

   CE QUE CETTE FONCTION CHANGE

   Avant, DATAtourisme était appelée depuis le navigateur, à travers une route
   Vercel, au moment où quelqu'un ouvrait Autour. Trois conséquences :

     · l'écran attendait un fournisseur tiers pour se remplir ;
     · une panne de DATAtourisme était une panne d'Autour ;
     · chaque visiteur payait le coût de normaliser les mêmes données.

   Le sens de la flèche s'inverse. DATAtourisme est lue ICI, à froid, sur un
   rythme choisi. Ce qui en sort est normalisé, daté, dédupliqué, puis rangé
   dans `events`. Le navigateur ne connaît plus que `evenements_proches`. Si
   DATAtourisme tombe, Autour continue de servir ce qu'il a — simplement un
   peu plus vieux, et le journal le dit.

   CE QU'ELLE NE FAIT PAS

     · elle n'écrit jamais dans `publications` : la table des habitants n'est
       pas un dépotoir d'import ;
     · elle ne nomme aucune ville : elle itère sur `event_areas`, et le même
       code vaut pour les six zones ouvertes comme pour la suivante ;
     · elle n'abandonne pas une zone parce qu'un POI est mal formé.

   Déploiement : écrit avec la clé de service, donc l'appel exige un secret
   partagé. Voir autour/docs/evenements-canoniques.md.
--------------------------------------------------------------------------- */

import {normaliserLot, cleDedup} from "./normalisation.mjs";

const CATALOGUE = Deno.env.get("DATATOURISME_BASE_URL") ?? "https://api.datatourisme.fr/v1/catalog";
const CLE_DATATOURISME = Deno.env.get("DATATOURISME_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";

const DELAI_MS = 20_000;
const TENTATIVES = 3;
const PAGE = 200;
const PAGES_MAX = 10;          // plafond dur : une zone ne monopolise pas la course

type Json = Record<string, unknown>;

function rest(chemin: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/* Un fournisseur lent ne doit jamais bloquer : délai court, trois tentatives
   espacées, puis échec propre et journalisé. Un 4xx n'est pas réessayé — la
   requête elle-même est en cause, insister ne la corrigera pas. */
async function fetchAvecReprise(url: string): Promise<Response> {
  let derniere: unknown = null;
  for (let essai = 1; essai <= TENTATIVES; essai += 1) {
    const controle = new AbortController();
    const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
    try {
      const reponse = await fetch(url, {
        signal: controle.signal,
        headers: {
          "x-api-key": CLE_DATATOURISME,
          Accept: "application/json",
          "User-Agent": "Autour/sync-datatourisme",
        },
      });
      clearTimeout(minuteur);
      if (reponse.ok || reponse.status < 500) return reponse;
      derniere = new Error(`HTTP ${reponse.status}`);
    } catch (erreur) {
      clearTimeout(minuteur);
      derniere = erreur;
    }
    if (essai < TENTATIVES) await new Promise((r) => setTimeout(r, 2 ** essai * 500));
  }
  throw derniere ?? new Error("DATAtourisme injoignable");
}

/* ---- Zones : de la configuration, pas des conditions --------------------- */
type Zone = {
  id: number; code: string; name: string; timezone: string;
  min_lat: number; min_lng: number; max_lat: number; max_lng: number;
};

async function zones(codeDemande: string | null): Promise<Zone[]> {
  const filtre = codeDemande ? `&code=eq.${encodeURIComponent(codeDemande)}` : "";
  const reponse = await rest(
    `event_areas?select=id,code,name,timezone,min_lat,min_lng,max_lat,max_lng` +
    `&enabled=is.true${filtre}&order=priorite.asc`);
  if (!reponse.ok) throw new Error(`lecture des zones : HTTP ${reponse.status}`);
  return await reponse.json();
}

/* ---- Interrogation du catalogue -----------------------------------------
   On demande le rectangle de la zone, pas un rayon autour d'un centre : une
   zone est une boîte, et interroger son centre laisserait ses bords vides. */
async function poisDeLaZone(zone: Zone): Promise<{pois: unknown[]; httpStatus: number}> {
  const pois: unknown[] = [];
  let httpStatus = 200;

  for (let page = 0; page < PAGES_MAX; page += 1) {
    const params = new URLSearchParams({
      geo_bbox: `${zone.min_lat},${zone.min_lng},${zone.max_lat},${zone.max_lng}`,
      page_size: String(PAGE),
      page_number: String(page),
      lang: "fr",
      // seuls les événements : la couche canonique ne contient pas de châteaux
      "type": "EntertainmentAndEvent",
      fields: [
        "uuid", "label", "type", "hasDescription", "lastUpdate",
        "isLocatedAt.geo", "isLocatedAt.address", "isLocatedAt.label",
        "takesPlaceAt",
      ].join(","),
    });
    const reponse = await fetchAvecReprise(`${CATALOGUE}?${params}`);
    httpStatus = reponse.status;
    if (!reponse.ok) {
      throw Object.assign(new Error(`DATAtourisme HTTP ${reponse.status}`), {httpStatus});
    }
    const charge = await reponse.json();
    const lot = Array.isArray(charge?.objects) ? charge.objects
      : (Array.isArray(charge?.["@graph"]) ? charge["@graph"] : []);
    pois.push(...lot);
    if (lot.length < PAGE) break;
  }
  return {pois, httpStatus};
}

/* ---- Écriture -----------------------------------------------------------

   Niveau 1 de la déduplication : on demande d'abord à `event_sources` si ce
   (source, external_id) est déjà connu. Si oui, on met à jour SON événement,
   sans jamais en créer un second.

   Niveau 2 : sinon, `dedup_key` peut rattacher l'événement à une ligne déjà
   posée par une autre source. La contrainte unique en base est l'arbitre —
   on ne la contourne pas, on l'interroge.

   Un événement en échec est compté et la boucle continue. Une zone entière ne
   tombe pas parce qu'un catalogue a publié une coordonnée à l'envers. */
async function enregistrer(entree: Json, zone: Zone) {
  const evenement = entree.event as Json;
  const source = String(entree.source);
  const externalId = String(entree.external_id);

  const connu = await rest(
    `event_sources?select=event_id&source=eq.${encodeURIComponent(source)}` +
    `&external_id=eq.${encodeURIComponent(externalId)}&limit=1`);
  const lignes = connu.ok ? await connu.json() : [];
  let eventId: string | null = lignes?.[0]?.event_id ?? null;
  let cree = false;

  const corps = {
    ...evenement,
    area_id: zone.id,
    last_synced_at: new Date().toISOString(),
  };

  if (eventId) {
    const maj = await rest(`events?id=eq.${eventId}`, {
      method: "PATCH",
      headers: {Prefer: "return=representation"},
      body: JSON.stringify(corps),
    });
    if (!maj.ok) throw new Error(`maj ${externalId} : HTTP ${maj.status} ${await maj.text()}`);
  } else {
    // niveau 2 : la clé calculée ici doit être celle que la base calculera
    const cle = cleDedup(
      evenement.title as string, evenement.lat as number,
      evenement.lng as number, evenement.start_at as string | null);
    if (cle) {
      const jumeau = await rest(
        `events?select=id&dedup_key=eq.${encodeURIComponent(cle)}&limit=1`);
      const trouves = jumeau.ok ? await jumeau.json() : [];
      eventId = trouves?.[0]?.id ?? null;
    }
    if (eventId) {
      const maj = await rest(`events?id=eq.${eventId}`, {
        method: "PATCH", body: JSON.stringify(corps),
      });
      if (!maj.ok) throw new Error(`fusion ${externalId} : HTTP ${maj.status}`);
    } else {
      const insere = await rest("events", {
        method: "POST",
        headers: {Prefer: "return=representation"},
        body: JSON.stringify([corps]),
      });
      if (!insere.ok) {
        throw new Error(`insert ${externalId} : HTTP ${insere.status} ${await insere.text()}`);
      }
      const rows = await insere.json();
      eventId = rows?.[0]?.id ?? null;
      cree = true;
    }
  }

  if (!eventId) throw new Error(`aucun identifiant rendu pour ${externalId}`);

  // la provenance, y compris pour les doublons rapprochés au niveau 3
  const provenances = [
    {source, external_id: externalId},
    ...((entree.provenances as Json[]) ?? []),
  ];
  await rest("event_sources?on_conflict=source,external_id", {
    method: "POST",
    headers: {Prefer: "resolution=merge-duplicates"},
    body: JSON.stringify(provenances.map((p) => ({
      event_id: eventId,
      source: p.source,
      external_id: p.external_id,
      source_updated_at: evenement.last_source_update ?? null,
      synced_at: new Date().toISOString(),
    }))),
  });

  return {cree};
}

/* Le cœur : une zone, le même traitement pour toutes. */
async function syncArea(zone: Zone) {
  const {pois, httpStatus} = await poisDeLaZone(zone);
  const lot = normaliserLot(pois, zone, {maintenant: Date.now()});

  let inseres = 0, majs = 0;
  const echecs: string[] = [];

  for (const entree of lot.gardes) {
    try {
      const {cree} = await enregistrer(entree as unknown as Json, zone);
      if (cree) inseres += 1; else majs += 1;
    } catch (erreur) {
      // compté, journalisé, et on passe au suivant
      echecs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }

  return {
    vus: lot.vus, inseres, majs, fusionnes: lot.fusionnes,
    rejetes: lot.rejets, echecs, httpStatus,
  };
}

/* ---- Journal ------------------------------------------------------------ */
async function ouvrirCourse(scope: string): Promise<number | null> {
  const r = await rest("event_sync_runs", {
    method: "POST",
    headers: {Prefer: "return=representation"},
    body: JSON.stringify([{source: "datatourisme", scope, status: "running"}]),
  });
  if (!r.ok) return null;
  return (await r.json())?.[0]?.id ?? null;
}

async function fermerCourse(id: number | null, patch: Json) {
  if (id == null) return;
  await rest(`event_sync_runs?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({finished_at: new Date().toISOString(), ...patch}),
  });
}

Deno.serve(async (requete: Request) => {
  const fourni = requete.headers.get("x-sync-secret") ?? "";
  if (!SYNC_SECRET || fourni !== SYNC_SECRET) {
    return new Response(JSON.stringify({error: "non autorisé"}),
      {status: 401, headers: {"Content-Type": "application/json"}});
  }
  if (!CLE_DATATOURISME) {
    return new Response(JSON.stringify({error: "DATATOURISME_API_KEY absente"}),
      {status: 503, headers: {"Content-Type": "application/json"}});
  }

  const url = new URL(requete.url);
  const demandee = url.searchParams.get("area");
  const debut = Date.now();
  const scope = demandee ?? "toutes";
  const course = await ouvrirCourse(scope);

  try {
    const liste = await zones(demandee);
    if (!liste.length) {
      await fermerCourse(course, {
        status: "error", duration_ms: Date.now() - debut,
        errors: `aucune zone active pour « ${scope} »`,
      });
      return new Response(JSON.stringify({error: `aucune zone active : ${scope}`}),
        {status: 404, headers: {"Content-Type": "application/json"}});
    }

    const total = {vus: 0, inseres: 0, majs: 0, fusionnes: 0, rejetes: 0};
    const parZone: Json = {};
    const echecs: string[] = [];

    for (const zone of liste) {
      try {
        const resultat = await syncArea(zone);
        total.vus += resultat.vus;
        total.inseres += resultat.inseres;
        total.majs += resultat.majs;
        total.fusionnes += resultat.fusionnes;
        total.rejetes += resultat.rejetes;
        parZone[zone.code] = {
          vus: resultat.vus, inseres: resultat.inseres, majs: resultat.majs,
          fusionnes: resultat.fusionnes, rejetes: resultat.rejetes,
          echecs: resultat.echecs.length,
        };
        echecs.push(...resultat.echecs.map((e) => `${zone.code}: ${e}`));
      } catch (erreur) {
        // une zone qui échoue n'emporte pas les autres : c'est tout l'intérêt
        // d'itérer sur une table plutôt que d'écrire une procédure par ville
        const message = erreur instanceof Error ? erreur.message : String(erreur);
        parZone[zone.code] = {erreur: message};
        echecs.push(`${zone.code}: ${message}`);
      }
    }

    // le cache de statut suit immédiatement l'import, sans attendre pg_cron
    await rest("rpc/rafraichir_statuts_temporels", {method: "POST", body: "{}"});

    const status = echecs.length ? (total.inseres + total.majs ? "partial" : "error") : "success";
    await fermerCourse(course, {
      status,
      duration_ms: Date.now() - debut,
      events_seen: total.vus,
      events_inserted: total.inseres,
      events_updated: total.majs,
      events_merged: total.fusionnes,
      events_rejected: total.rejetes,
      errors: echecs.length ? echecs.slice(0, 20).join(" | ") : null,
      details: {zones: parZone, zones_traitees: liste.length, echecs: echecs.length},
    });

    return new Response(JSON.stringify({status, scope, ...total, zones: parZone}),
      {headers: {"Content-Type": "application/json"}});
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    await fermerCourse(course, {
      status: "error", duration_ms: Date.now() - debut, errors: message,
    });
    return new Response(JSON.stringify({status: "error", scope, error: message}),
      {status: 502, headers: {"Content-Type": "application/json"}});
  }
});
