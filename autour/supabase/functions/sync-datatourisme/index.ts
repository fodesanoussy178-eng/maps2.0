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

   QUI A LE DROIT D'APPELER, ET AVEC QUOI ON ÉCRIT

   Ce sont deux questions distinctes, et les confondre était le défaut de la
   version précédente.

   POUR APPELER : un secret partagé, `x-sync-secret`, vérifié ici avant toute
   autre chose. La fonction est déployée sans vérification de JWT — elle porte
   sa propre authentification, et c'est la seule qu'elle reconnaît. GitHub n'a
   donc AUCUNE clé Supabase à détenir : ni service_role, ni clé secrète, ni
   rien qui donnerait accès à la base. S'il perd son secret, il perd le droit
   de déclencher une synchronisation, et rien d'autre.

   POUR ÉCRIRE : la clé secrète que la plateforme injecte elle-même dans
   l'environnement de la fonction, via `SUPABASE_SECRET_KEYS`. Elle n'est ni
   dans le dépôt, ni dans GitHub, ni dans le navigateur — elle n'existe que
   dans le processus qui s'en sert.

   Voir autour/docs/evenements-canoniques.md.
--------------------------------------------------------------------------- */

import {normaliserLot, cleDedup} from "./normalisation.mjs";
import {fusionnerAnnonceFields, normaliserAnnonce} from "../shared/annonces.mjs";
import {fusionnerEvenementFaits} from "../shared/evenements-canoniques.mjs";

/* L'endpoint dédié aux événements plutôt que le catalogue générique filtré :
   c'est la même sélection, demandée à l'API dans les termes où elle la
   documente, et sans dépendre d'un paramètre `type` qui n'a jamais été le sien. */
const CATALOGUE = Deno.env.get("DATATOURISME_BASE_URL")
  ?? "https://api.datatourisme.fr/v1/entertainmentAndEvent";
const CLE_DATATOURISME = Deno.env.get("DATATOURISME_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";

/* LA CLÉ D'ÉCRITURE, AU FORMAT MODERNE.

   Les clés `anon` et `service_role` dérivaient du secret JWT du projet : on ne
   pouvait en révoquer une sans les invalider toutes. Les clés nommées
   (`sb_publishable_…`, `sb_secret_…`) se créent, se nomment et se révoquent
   une par une.

   La plateforme les expose sous forme de DICTIONNAIRE JSON — plusieurs clés
   peuvent coexister, chacune sous son nom, ce qui est précisément ce qui rend
   une rotation possible sans interruption. D'où l'analyse ici, et non un
   simple `Deno.env.get`.

   `SUPABASE_SECRET_KEY` au singulier est le repli du développement local :
   la CLI ne provisionne qu'une clé et ne construit pas le dictionnaire.

   Elle est lue PARESSEUSEMENT, et c'est délibéré : une lecture au chargement
   du module ferait échouer la fonction entière si la configuration manquait —
   y compris la porte d'authentification, qui n'a pourtant pas besoin d'elle.
   Un appel non autorisé recevrait alors un 500 opaque au lieu d'un 401, et une
   erreur de configuration serait indiscernable d'une panne. */
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
      // un dictionnaire présent mais sans la clé attendue est une erreur de
      // configuration qu'il vaut mieux nommer que contourner en silence
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


const DELAI_MS = 20_000;
const TENTATIVES = 3;
const PAGE = 200;
const PAGES_MAX = 10;          // plafond dur : une zone ne monopolise pas la course

type Json = Record<string, unknown>;

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

async function lireAnnonceCanonique(eventId: string): Promise<Json> {
  try {
    const path = "events?id=" + encodeURIComponent(eventId) +
      "&select=primary_source,source_url,description,announced_at,presale_at," +
      "tickets_open_at,ticket_url,announcement_tags,performers,organizer," +
      "artist_names,music_genres,event_kind,announcement_provenance,venue_name,organizer_name,price_amount,price_text," +
      "is_free,price_confidence,audience,min_age,reservation_required,reservation_text,event_source,event_source_url,place_source&limit=1";
    const response = await rest(path);
    if (!response.ok) return {};
    const rows = await response.json();
    return rows?.[0] ?? {};
  } catch {
    return {};
  }
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
  /* La liste des communes de la zone. Quand elle est renseignée, c'est elle
     qui décide, et le rectangle ne sert plus qu'à interroger le catalogue. */
  commune_keys: string[] | null;
};

async function zones(codeDemande: string | null): Promise<Zone[]> {
  const filtre = codeDemande ? `&code=eq.${encodeURIComponent(codeDemande)}` : "";
  const reponse = await rest(
    `event_areas?select=id,code,name,timezone,min_lat,min_lng,max_lat,max_lng,commune_keys` +
    `&enabled=is.true${filtre}&order=priorite.asc`);
  if (!reponse.ok) throw new Error(`lecture des zones : HTTP ${reponse.status}`);
  return await reponse.json();
}

/* ---- Interrogation du catalogue -----------------------------------------
   On demande le rectangle de la zone, pas un rayon autour d'un centre : une
   zone est une boîte, et interroger son centre laisserait ses bords vides. */
/* LA REQUÊTE ÉTAIT ÉCRITE DANS UN DIALECTE QUE L'API NE PARLE PAS.

   `geo_bbox` et `page_number` n'existent pas dans la documentation actuelle :
   ce sont `geo_bounding` et `page`. Un paramètre inconnu n'est pas refusé, il
   est IGNORÉ — d'où une réponse parfaitement valide, en HTTP 200, contenant
   les deux mille premiers événements de France entière et non ceux de la
   zone. La pagination souffrait du même mal : `page_number` étant ignoré, les
   dix « pages » ramenaient dix fois le même lot.

   C'est la seule explication cohérente avec ce qu'on a mesuré — 2 000 objets
   vus, 2 000 rejetés, aucune exception : le filtre de zone du normaliseur
   faisait son travail sur des données qui ne concernaient pas la zone.

   Le rectangle se lit HAUT-GAUCHE puis BAS-DROIT, ce qui n'est pas l'ordre
   d'un bbox habituel (sud-ouest → nord-est). L'inverser ne provoque aucune
   erreur non plus : juste un rectangle vide.

   La pagination commence à 1. On suit `meta.next` quand l'API le fournit —
   c'est elle qui sait où elle en est — et on ne retombe sur l'incrément que
   lorsqu'elle ne dit rien. */
function pageDeLaZone(zone: Zone, page: number): string {
  const params = new URLSearchParams({
    // haut-gauche → bas-droit, dans cet ordre et pas un autre
    geo_bounding: `${zone.max_lat},${zone.min_lng},${zone.min_lat},${zone.max_lng}`,
    page_size: String(PAGE),
    page: String(page),
    lang: "fr",
    fields: [
      "uuid", "label", "type", "hasDescription", "lastUpdate",
      "isLocatedAt", "takesPlaceAt", "url", "sameAs",
      /* DATAtourisme n'a pas une forme unique : on demande explicitement les
         deux emplacements documentés, sans wildcard. Le normaliseur vérifie
         ensuite l'URL et la licence avant de produire un visuel. */
      "hasMainRepresentation", "hasMainRepresentation.url",
      "hasMainRepresentation.uri", "hasMainRepresentation.contentUrl",
      "hasMainRepresentation.schema:contentUrl", "hasMainRepresentation.schema:url",
      "hasMainRepresentation.resourceLocator", "hasMainRepresentation.license",
      "hasMainRepresentation.licence", "hasMainRepresentation.rights",
      "hasMainRepresentation.dc:rights", "hasMainRepresentation.schema:license",
      "hasMainRepresentation.encodingFormat", "hasMainRepresentation.mediaType",
      "hasMainRepresentation.mimeType", "hasMainRepresentation.contentType",
      "hasMainRepresentation.format",
      "hasMainRepresentation.credits", "hasMainRepresentation.credit",
      "hasMainRepresentation.author", "hasMainRepresentation.creator",
      "hasRelatedResource", "hasRelatedResource.url", "hasRelatedResource.uri",
      "hasRelatedResource.contentUrl", "hasRelatedResource.schema:contentUrl",
      "hasRelatedResource.schema:url", "hasRelatedResource.resourceLocator",
      "hasRelatedResource.license", "hasRelatedResource.licence",
      "hasRelatedResource.rights", "hasRelatedResource.dc:rights",
      "hasRelatedResource.schema:license", "hasRelatedResource.credits",
      "hasRelatedResource.encodingFormat", "hasRelatedResource.mediaType",
      "hasRelatedResource.mimeType", "hasRelatedResource.contentType",
      "hasRelatedResource.format",
      "hasRelatedResource.credit", "hasRelatedResource.author",
      "hasRelatedResource.creator",
    ].join(","),
  });
  return `${CATALOGUE}?${params}`;
}

/* `meta.next` peut être une URL complète, un chemin, ou un simple numéro.
   On accepte les trois et on refuse le reste plutôt que de deviner. */
function suivante(charge: unknown, base: string): string | null {
  const meta = (charge as {meta?: {next?: unknown}})?.meta;
  const brut = meta?.next;
  if (brut == null || brut === "" || brut === false) return null;
  if (typeof brut === "number" && Number.isFinite(brut)) return String(brut);
  if (typeof brut !== "string") return null;
  try {
    // une URL absolue ou relative se résout ; un numéro reste un numéro
    if (/^https?:\/\//.test(brut) || brut.startsWith("/") || brut.includes("?")) {
      return new URL(brut, base).toString();
    }
  } catch { return null; }
  return /^\d+$/.test(brut) ? brut : null;
}

async function poisDeLaZone(zone: Zone): Promise<{
  pois: unknown[]; httpStatus: number; pages: number; retourne: number;
}> {
  const pois: unknown[] = [];
  let httpStatus = 200;
  let pages = 0;
  let url = pageDeLaZone(zone, 1);

  for (let n = 0; n < PAGES_MAX; n += 1) {
    const reponse = await fetchAvecReprise(url);
    httpStatus = reponse.status;
    if (!reponse.ok) {
      throw Object.assign(new Error(`DATAtourisme HTTP ${reponse.status}`), {httpStatus});
    }
    const charge = await reponse.json();
    const lot = Array.isArray(charge?.objects) ? charge.objects
      : (Array.isArray(charge?.["@graph"]) ? charge["@graph"]
        : (Array.isArray(charge?.data) ? charge.data
          : (Array.isArray(charge) ? charge : [])));
    pages += 1;
    pois.push(...lot);
    if (!lot.length) break;

    const prochaine = suivante(charge, url);
    if (prochaine) {
      url = /^\d+$/.test(prochaine) ? pageDeLaZone(zone, Number(prochaine)) : prochaine;
      continue;
    }
    // l'API ne dit rien : une page incomplète signe la fin
    if (lot.length < PAGE) break;
    url = pageDeLaZone(zone, n + 2);
  }
  return {pois, httpStatus, pages, retourne: pois.length};
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

  const synchroniseLe = new Date().toISOString();

  if (eventId) {
    const canonique = await lireAnnonceCanonique(eventId);
    /* Les connecteurs ne renvoient pas toujours le texte complet sur chaque
       page. Quand il existe déjà dans l'événement canonique, il reste une
       preuve source exploitable pour la cascade (par exemple « rap » dans la
       description d'un concert DATAtourisme). */
    const enrichissementCanonique = normaliserAnnonce(canonique, {
      source: String(canonique.primary_source || source),
      externalId,
      sourceUrl: canonique.source_url || null,
    });
    const entrant = {
      ...evenement,
      ...(evenement.description ? {} : (canonique.description ? {description: canonique.description} : {})),
      ...enrichissementCanonique.fields,
    };
    const faits = fusionnerEvenementFaits(canonique, entrant);
    const corps = {
      ...faits, ...fusionnerAnnonceFields(canonique, faits),
      area_id: zone.id, last_synced_at: synchroniseLe,
    };
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
      const canonique = await lireAnnonceCanonique(eventId);
      const faits = fusionnerEvenementFaits(canonique, evenement);
      const corps = {
        ...faits, ...fusionnerAnnonceFields(canonique, faits),
        area_id: zone.id, last_synced_at: synchroniseLe,
      };
      const maj = await rest(`events?id=eq.${eventId}`, {
        method: "PATCH", body: JSON.stringify(corps),
      });
      if (!maj.ok) throw new Error(`fusion ${externalId} : HTTP ${maj.status}`);
    } else {
      const corps = {
        ...evenement, area_id: zone.id, last_synced_at: synchroniseLe,
      };
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
      source_url: p.source_url ?? entree.source_url ?? evenement.source_url ?? null,
      raw_data: p.raw_data ?? entree.raw_event ?? null,
      source_updated_at: p.source_updated_at ?? evenement.last_source_update ?? null,
      synced_at: new Date().toISOString(),
    }))),
  });

  return {cree};
}

/* Le cœur : une zone, le même traitement pour toutes. */
/* DIAGNOSTIC TEMPORAIRE — le journal ne gardait que le TOTAL des rejets.

   « 2 000 vus, 2 000 rejetés » ne dit pas si les objets étaient hors zone,
   inexploitables, ou s'ils levaient une exception : trois causes très
   différentes, un seul nombre. On agrège donc les motifs, qui sont déjà
   calculés par `normaliserLot` et jusqu'ici jetés.

   Ce sont des COMPTEURS PAR MOTIF, rien d'autre : aucun titre, aucune
   adresse, aucune coordonnée n'entre dans le journal. À retirer une fois le
   normaliseur ajusté. */
function motifsDeRejet(detail: unknown): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const rejet of Array.isArray(detail) ? detail : []) {
    const motif = String((rejet as {raison?: unknown})?.raison ?? "inconnu");
    compte[motif] = (compte[motif] ?? 0) + 1;
  }
  return compte;
}

async function syncArea(zone: Zone) {
  const {pois, httpStatus, pages, retourne} = await poisDeLaZone(zone);
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
    pages, retourne, gardes: lot.gardes.length,
    motifs: motifsDeRejet(lot.detailRejets),
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

/* Comparer deux secrets avec `!==` s'arrête au premier caractère différent :
   la durée de la réponse renseigne alors, très faiblement mais réellement, sur
   la longueur du préfixe correct. C'est la porte d'entrée d'un service qui
   écrit en base — elle se compare en temps constant.

   Le hachage préalable rend la comparaison indépendante de la LONGUEUR des
   deux chaînes, ce qu'une boucle sur les octets bruts ne garantit pas. */
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

Deno.serve(async (requete: Request) => {
  /* LA PORTE, ET RIEN AVANT ELLE.

     Aucune lecture de zone, aucune requête au catalogue, aucune ligne de
     journal : un appel non autorisé ne doit rien coûter et ne rien apprendre.
     La réponse est la même — 401, sans détail — que le secret soit absent,
     faux, ou que la fonction n'en ait pas reçu du tout. */
  const fourni = requete.headers.get("x-sync-secret") ?? "";
  if (!await memeSecret(fourni, SYNC_SECRET)) {
    /* LE 401 RESTE MUET POUR L'APPELANT, ET BAVARD POUR LE PROPRIÉTAIRE.

       Un 401 récurrent sur cette route a exactement trois causes, et elles
       demandent trois gestes différents :

         · la fonction n'a pas de secret        → poser EVENT_SYNC_SECRET
         · l'appelant n'en présente pas         → la fonction a été déployée
                                                  avec verify_jwt, ou l'en-tête
                                                  s'est perdu en route
         · les deux existent et diffèrent       → les faire correspondre

       Le corps de la réponse ne les distingue surtout pas : ce serait
       renseigner qui frappe à la porte. Le journal de la fonction, lui, n'est
       lisible que par le projet — et c'est précisément là qu'on cherche quand
       une synchronisation ne passe plus. Aucune valeur de secret n'y figure,
       seulement leur présence. */
    console.error(JSON.stringify({
      fonction: "sync-datatourisme", etape: "refus",
      secret_configure: SYNC_SECRET.length > 0,
      entete_presente: fourni.length > 0,
    }));
    return new Response(JSON.stringify({error: "non autorisé"}),
      {status: 401, headers: {"Content-Type": "application/json"}});
  }
  if (!CLE_DATATOURISME) {
    return new Response(JSON.stringify({error: "DATATOURISME_API_KEY absente"}),
      {status: 503, headers: {"Content-Type": "application/json"}});
  }
  /* La clé d'écriture est réclamée ICI, une fois l'appelant reconnu et avant
     d'ouvrir quoi que ce soit. `ouvrirCourse` écrit déjà en base : sans cette
     vérification, une configuration incomplète produirait un rejet non traité
     et un 500 muet, là où on peut dire exactement ce qui manque. */
  try {
    cleSecrete();
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    return new Response(JSON.stringify({error: `configuration : ${message}`}),
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
          // diagnostic temporaire : d'où viennent les rejets
          retourne: resultat.retourne, pages: resultat.pages,
          gardes: resultat.gardes, motifs: resultat.motifs,
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

    /* LE STATUT HTTP DOIT DIRE LA MÊME CHOSE QUE LE CORPS.

       Cette réponse partait toujours en 200, y compris quand toutes les zones
       avaient échoué. `curl --fail-with-body` ne regarde que le code HTTP :
       la tâche GitHub passait donc au vert au-dessus d'un import qui n'avait
       rien importé, et une panne du catalogue serait restée invisible quatre
       fois par jour.

       « error » veut dire qu'AUCUNE zone n'a rien inséré ni mis à jour — un
       échec total, qui mérite un 502 : c'est bien une dépendance amont qui
       n'a pas répondu, pas la requête qui était mauvaise.

       « partial » reste un succès HTTP, délibérément. Des données sont
       arrivées ; faire échouer la tâche parce qu'un POI sur trois cents était
       mal formé apprendrait à ignorer le rouge, ce qui coûte plus cher que le
       défaut qu'on signale. Le journal, lui, garde la nuance. */
    return new Response(JSON.stringify({status, scope, ...total, zones: parZone}),
      {status: status === "error" ? 502 : 200,
       headers: {"Content-Type": "application/json"}});
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    await fermerCourse(course, {
      status: "error", duration_ms: Date.now() - debut, errors: message,
    });
    return new Response(JSON.stringify({status: "error", scope, error: message}),
      {status: 502, headers: {"Content-Type": "application/json"}});
  }
});
