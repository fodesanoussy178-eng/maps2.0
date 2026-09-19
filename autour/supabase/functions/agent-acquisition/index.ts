/* ---------------------------------------------------------------------------
   agent-acquisition — l'agent qui cherche, qualifie et prépare. Jamais envoie.

   CE QU'ELLE EST

   Une fonction Edge, appelée soit par `private.invoke_agent_acquisition()`
   depuis la base, soit à la main avec le secret, qui vide la file `tasks` de
   l'agent `acquisition`. Elle ne décide de rien : chaque tâche dit ce qu'elle
   veut, et `task_permissions` dit ce que l'agent a le droit de faire pour
   l'obtenir.

   LE CONTRAT EST LU À CHAQUE TÂCHE, PAS AU DÉMARRAGE

   `lireContrat` va chercher la ligne de `task_permissions` avant d'exécuter,
   et l'exécution s'arrête si elle manque, si elle est inactive, si la source
   demandée n'y figure pas. Ce n'est pas une ceinture de sécurité : c'est le
   seul endroit où la permission existe. Le code de cette fonction sait lire
   l'annuaire des entreprises ; il ne le fera que si une ligne en base l'y
   autorise, et la désactiver suffit à l'en empêcher sans redéploiement.

   CE QU'ELLE NE FERA JAMAIS

   Elle n'a aucune fonction d'envoi. Pas « une fonction d'envoi désactivée » :
   aucune. Le mot le plus proche est `preparerContact`, qui écrit une ligne
   `acquisition_contacts` en `attente_validation` et s'arrête là. Et si
   quelqu'un en ajoutait une un jour, `task_permissions.contact_externe` porte
   un CHECK qui la refuserait en base.

   L'IA N'EST PAS LE MOTEUR, C'EST LE RECOURS

   La recherche, le filtrage, la déduplication et la qualification sont du code
   déterministe, gratuit et rejouable. Aucun appel de modèle n'est fait dans
   cette version : les règles rendent `inconnu` quand elles ne savent pas, et
   `inconnu` part en examen humain. Le budget `cout_max_eur` est lu et le coût
   réel est écrit dans `runs.cout_eur` — pour l'instant, zéro, et le tableau de
   bord le dit.
--------------------------------------------------------------------------- */

import {
  candidatsDepuisAgendas, candidatsDepuisAnnuaire,
  candidatsDepuisEvenements, candidatsDepuisLieux,
} from "./sources.mjs";
import { fusionner, nomNormalise, deduireType } from "./normalisation.mjs";
import { qualifier } from "./qualification.mjs";
import { preparerContact } from "./contact.mjs";
import {
  canauxDepuisAnnuaireServicePublic, canauxDepuisOsm, rapprocherCanaux, canalOpportunite,
  candidatsDepuisAnnuaireServicePublicOpportunites,
} from "./canaux.mjs";
import {
  candidatsDepuisOsmStructures, candidatsEcosysteme, requeteOverpassAutour,
} from "./ecosysteme.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";

const AGENT = "acquisition";
const TACHES_PAR_REVEIL = 3;

/* LE WORKER EST TUÉ AVANT LA FIN, ET LA TÂCHE RESTE « EN_COURS ».
   `WORKER_RESOURCE_LIMIT` (HTTP 546) observé deux fois, à 160 s et à 270 s : le
   plafond n'est pas un temps mural fixe, il monte avec ce que l'exécution a
   accumulé. On ne lance donc une tâche de plus que s'il reste du temps ; les
   autres restent en `file`.

   Quatre-vingts secondes, parce que le budget dit s'il reste du temps pour
   COMMENCER, pas si la tâche tiendra : une tâche lancée à 149 s qui dure 63 s
   finit à 212 s. 80 + 63 = 143 s, sous la plus basse des deux morts. */
const BUDGET_MS = 80_000;

/* UNE TÂCHE TUÉE EN VOL NE REVIENT JAMAIS TOUTE SEULE : la file ne lit que
   `statut = 'file'`. Quatre tâches s'y sont perdues pendant la mission, chacune
   rattrapée par un UPDATE à la main. Au début de chaque réveil, ce qui est
   `en_cours` depuis plus longtemps qu'aucune tâche ne peut durer retourne en
   file — au-delà de ce délai, le worker qui la tenait est forcément mort. */
const ORPHELINE_APRES_MIN = 10;
const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";

/* L'annuaire officiel des administrations et équipements publics. C'est lui
   qui publie les adresses de contact des médiathèques, musées et centres
   sociaux — celles que ni `places` ni l'annuaire des entreprises ne donnent. */
const ANNUAIRE_SP =
  "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/" +
  "api-lannuaire-administration/records";

/* Les mêmes instances qu'`autour/api/lieux.js` : elles portent la planète
   entière et Autour les interroge déjà côté serveur. Une seule requête par
   tâche, jamais une par opportunité. */
const OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const UA = "Autour/agent-acquisition (https://autour.eu)";

/* UN DÉPASSEMENT DE DÉLAI OVERPASS REND HTTP 200 : corps JSON valide,
   `elements: []`, et un champ `remark` qui dit « Query timed out ». Ne pas lire
   `remark` revient à raconter un échec de source comme une absence de données —
   le mensonge que la consigne interdit. On le lit, on essaie l'instance
   suivante, et si les trois échouent la tâche écrit « injoignable ».

   Le délai par instance est borné côté client : une instance lente consomme
   sinon tout le budget, et le worker est tué (`WORKER_RESOURCE_LIMIT`).
   Vingt-cinq secondes, parce que c'est la poignée de main qui coûte : 15,1 s de
   handshake TCP/SSL mesurés sur overpass-api.de. Chiffres et dates complets
   dans `docs/agent-acquisition.md`. */
const OVERPASS_DELAI_MS = 25_000;

async function overpass(requete: string): Promise<any> {
  let derniere = "aucune instance essayée";
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: "data=" + encodeURIComponent(requete),
        signal: AbortSignal.timeout(OVERPASS_DELAI_MS),
      });
      if (!r.ok) { derniere = `HTTP ${r.status} sur ${new URL(url).host}`; continue; }
      const charge = await r.json();
      const remarque = String(charge?.remark || "");
      if (/error|timed out|timeout/i.test(remarque)) {
        derniere = `${remarque} sur ${new URL(url).host}`;
        continue;
      }
      return charge;
    } catch (e) { derniere = `${(e as Error).message} sur ${new URL(url).host}`; }
  }
  throw new Error(`Overpass injoignable : ${derniere}`);
}

type Json = Record<string, unknown>;

/* ---------------------------------------------------------------------------
   PostgREST, sans client
   ------------------------------------------------------------------------ */
async function rest(chemin: string, init: RequestInit = {}): Promise<any> {
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
  if (!r.ok) throw new Error(`${r.status} ${chemin} — ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : null;
}

const lire = (chemin: string) => rest(chemin);
const ecrire = (table: string, lignes: Json[], prefer = "return=representation") =>
  rest(table, { method: "POST", body: JSON.stringify(lignes), headers: { Prefer: prefer } });
const majLigne = (chemin: string, patch: Json) =>
  rest(chemin, { method: "PATCH", body: JSON.stringify(patch), headers: { Prefer: "return=representation" } });

/* ---------------------------------------------------------------------------
   LE JOURNAL — une ligne par étape, écrite AU MOMENT de l'étape

   Journaliser à la fin donnerait un récit reconstitué, et perdrait tout d'une
   tâche qui meurt en route. C'est précisément le cas où on a besoin de savoir
   jusqu'où elle était allée.
   ------------------------------------------------------------------------ */
async function journal(taskId: string | null, etape: string, statut: string,
                       message: string, compteurs: Json = {}, details: Json = {},
                       cout = 0, debut?: number) {
  try {
    await ecrire("runs", [{
      task_id: taskId, agent: AGENT, etape, statut, message,
      compteurs, details, cout_eur: cout,
      fin: new Date().toISOString(),
      duree_ms: debut ? Date.now() - debut : null,
    }], "return=minimal");
  } catch (e) {
    console.error("journal indisponible", (e as Error).message);
  }
}

/* ---------------------------------------------------------------------------
   LE CONTRAT
   ------------------------------------------------------------------------ */
type Contrat = {
  type: string; lecture_externe: boolean; validation_humaine: boolean;
  cout_max_eur: number; sources_autorisees: string[]; actif: boolean;
  contact_externe: boolean;
};

async function lireContrat(type: string): Promise<Contrat> {
  const lignes = await lire(
    `task_permissions?agent=eq.${AGENT}&type=eq.${encodeURIComponent(type)}&select=*`);
  if (!lignes?.length) throw new Error(`type de tâche « ${type} » sans contrat dans task_permissions`);
  const c = lignes[0] as Contrat;
  if (!c.actif) throw new Error(`type de tâche « ${type} » désactivé dans task_permissions`);
  return c;
}

function exigerSource(contrat: Contrat, source: string) {
  if (!contrat.sources_autorisees?.includes(source)) {
    throw new Error(`source « ${source} » absente de sources_autorisees pour ${contrat.type}`);
  }
}

/* ---------------------------------------------------------------------------
   ÉCRIRE UNE OPPORTUNITÉ ET SES SOURCES

   `merge-duplicates` sur `cle_dedup` : une structure revue ne crée pas une
   ligne, elle met la sienne à jour. `statut` et `notes` ne sont PAS dans le
   patch : une opportunité que le fondateur a classée « non pertinente » ne doit
   pas redevenir « nouvelle » parce que la récolte est repassée dessus.
   ------------------------------------------------------------------------ */
async function verserOpportunite(c: any) {
  /* `on_conflict=cle_dedup` EST OBLIGATOIRE, ET SON ABSENCE EST SILENCIEUSE.
     Sans lui, PostgREST prend la clé primaire comme cible de conflit ; `id`
     étant généré, il ne conflit jamais, et c'est l'index unique sur
     `cle_dedup` qui lève un 23505 — une tâche entière tombée sur la deuxième
     commune qui revoit une structure déjà connue. Trouvé en exécution. */
  const [ligne] = await ecrire("acquisition_opportunites?on_conflict=cle_dedup", [{
    nom: c.nom, type: c.type, famille: c.famille, ville: c.ville,
    code_insee: c.code_insee ?? null, zone_id: c.zone_id ?? null,
    description: c.description ?? null, canal: c.canal ?? null,
    coordonnees_publiques: c.coordonnees_publiques ?? {},
    place_id: c.place_id ?? null,
    faits: c.faits ?? {}, faits_mesures_le: new Date().toISOString(),
    pays: c.pays ?? "FR", region: c.region ?? null,
    territoire_id: c.territoire_id ?? null,
    raison_pertinence: c.raison_pertinence ?? null,
    cle_dedup: c.cle,
  }], "return=representation,resolution=merge-duplicates");

  const existantes = await lire(
    `acquisition_sources?opportunite_id=eq.${ligne.id}&select=source,url`);
  const deja = new Set((existantes || []).map((s: any) => `${s.source}|${s.url ?? ""}`));
  const nouvelles = (c.sources || [])
    .filter((s: any) => !deja.has(`${s.source}|${s.url ?? ""}`))
    .map((s: any) => ({
      opportunite_id: ligne.id, source: s.source, type_source: s.type_source,
      url: s.url ?? null, intitule: s.intitule ?? null, extrait: s.extrait ?? {},
    }));
  if (nouvelles.length) await ecrire("acquisition_sources", nouvelles, "return=minimal");

  return { id: ligne.id, statut: ligne.statut, sources_ajoutees: nouvelles.length };
}

async function tracer(opportuniteId: string, action: string, detail: string, taskId: string | null) {
  await ecrire("acquisition_actions",
    [{ opportunite_id: opportuniteId, action, detail, task_id: taskId, par: null }],
    "return=minimal");
}

/* ===========================================================================
   LES TÂCHES
   ======================================================================== */

/* --- Balayer une ville ---------------------------------------------------
   L'ordre n'est pas indifférent : les données d'Autour d'abord, l'annuaire
   ensuite. La fusion garde la première description et la première provenance,
   donc celle qu'on a collectée et vérifiée nous-mêmes l'emporte sur celle d'un
   tiers, et l'annuaire ne sert qu'à compléter. */
async function scanCity(task: any, contrat: Contrat) {
  const ville: string = task.params?.ville;
  if (!ville) throw new Error("paramètre `ville` manquant");
  const zone: string | null = task.params?.zone_id ?? null;
  const t0 = Date.now();
  const listes: any[][] = [];

  exigerSource(contrat, "autour_events");
  const filtreZone = zone ? `&zone_id=eq.${encodeURIComponent(zone)}` : "";
  const evenements = await lire(
    `events?commune=eq.${encodeURIComponent(ville)}${filtreZone}&duplicate_of=is.null` +
    `&select=title,venue_name,place_name,commune,city,insee_code,zone_id,start_at,` +
    `source_url,event_source_url,primary_source,organizer,organizer_name&limit=2000`);
  const depuisEvenements = candidatsDepuisEvenements(evenements);
  listes.push(depuisEvenements);
  await journal(task.id, "lecture_evenements", "succes",
    `${evenements.length} événements relus à ${ville} : ${depuisEvenements.length} lieux d'accueil retenus`,
    { evenements_lus: evenements.length, candidats: depuisEvenements.length }, {}, 0, t0);

  exigerSource(contrat, "autour_places");
  const lieux = await lire(
    `places?commune=eq.${encodeURIComponent(ville)}&status=eq.active` +
    `&select=id,name,commune,city,insee_code,zone_id,family,category,description,address,official_url&limit=1000`);
  const depuisLieux = candidatsDepuisLieux(lieux);
  listes.push(depuisLieux);
  await journal(task.id, "lecture_lieux", "succes",
    `${lieux.length} lieux de l'inventaire relus : ${depuisLieux.length} retenus`,
    { lieux_lus: lieux.length, candidats: depuisLieux.length });

  /* Les agendas publics : un gisement d'utilisateurs, pas un interlocuteur.
     `openagenda_candidats.commune` est nul dans l'inventaire actuel — on relie
     le slug à la commune par `territory_sources`, qui porte les deux. */
  if (contrat.sources_autorisees.includes("openagenda_candidats")) {
    const agendas = await lire(`openagenda_candidats?agenda_uid=not.is.null&select=slug,commune,agenda_uid,titre,verifie_le&limit=500`);
    const sources = await lire(`territory_sources?provider=eq.openagenda&select=source_identifier,source_name,metadata`);
    const villeParSlug: Record<string, string> = {};
    for (const s of sources || []) {
      const slug = (s.metadata as any)?.agenda_slug || (s.metadata as any)?.slug;
      const commune = (s.metadata as any)?.commune || s.source_name;
      if (slug && commune) villeParSlug[slug] = commune;
    }
    const depuisAgendas = candidatsDepuisAgendas(agendas, villeParSlug)
      .filter((c: any) => c.ville?.toLowerCase() === ville.toLowerCase());
    listes.push(depuisAgendas);
    await journal(task.id, "lecture_agendas", "succes",
      `${(agendas || []).length} agendas publics relus : ${depuisAgendas.length} rattachés à ${ville}`,
      { agendas_lus: (agendas || []).length, candidats: depuisAgendas.length });
  }

  /* L'annuaire des entreprises — la seule requête sortante de cette tâche. */
  if (contrat.lecture_externe && contrat.sources_autorisees.includes("recherche_entreprises")) {
    const t1 = Date.now();
    try {
      const communes = await lire(
        `mel_communes?nom=eq.${encodeURIComponent(ville)}&select=insee,nom&limit=1`);
      const insee = communes?.[0]?.insee;
      const params = new URLSearchParams({ per_page: "25", page: "1", est_association: "true" });
      if (insee) params.set("code_commune", insee); else params.set("q", ville);
      const r = await fetch(`${ANNUAIRE}?${params}`, {
        headers: { accept: "application/json", "user-agent": "Autour/agent-acquisition (contact via autour.eu)" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const charge = await r.json();
      const depuisAnnuaire = candidatsDepuisAnnuaire(charge, { ville, zone_id: zone });
      listes.push(depuisAnnuaire);
      await journal(task.id, "lecture_annuaire", "succes",
        `Annuaire des entreprises : ${(charge?.results || []).length} lignes lues, ${depuisAnnuaire.length} retenues (les autres ont leur établissement hors de ${ville})`,
        { lues: (charge?.results || []).length, retenus: depuisAnnuaire.length },
        { requete: params.toString(), code_commune: insee ?? null }, 0, t1);
    } catch (e) {
      /* UNE SOURCE MUETTE N'EST PAS UNE TÂCHE ÉCHOUÉE. Les données d'Autour ont
         déjà répondu ; on note le trou et on continue avec ce qu'on a. */
      await journal(task.id, "lecture_annuaire", "partiel",
        `Annuaire des entreprises injoignable : ${(e as Error).message}. Le balayage continue avec les seules données d'Autour.`,
        {}, {}, 0, t1);
    }
  }

  const { opportunites, doublons } = fusionner(listes.flat());
  await journal(task.id, "deduplication", "succes",
    `${listes.flat().length} candidats, ${doublons} doublons rapprochés, ${opportunites.length} opportunités distinctes`,
    { candidats: listes.flat().length, doublons, distinctes: opportunites.length });

  /* Le territoire est porté par la TÂCHE, pas par la source : une médiathèque
     lue dans `events` ne sait pas à quel territoire d'acquisition elle
     appartient, et c'est la tâche qui l'a demandée qui le sait. */
  const rattachement = {
    territoire_id: task.params?.territoire_id ?? null,
    pays: task.params?.pays ?? "FR",
    region: task.params?.region ?? null,
  };

  let crees = 0, revus = 0, sourcesAjoutees = 0;
  for (const brut of opportunites) {
    const c = { ...brut, ...rattachement };
    const avant = await lire(`acquisition_opportunites?cle_dedup=eq.${encodeURIComponent(c.cle)}&select=id`);
    const existait = (avant || []).length > 0;
    const r = await verserOpportunite(c);
    sourcesAjoutees += r.sources_ajoutees;
    if (existait) revus += 1; else { crees += 1; await tracer(r.id, "decouverte", `Découverte par ${c.sources.map((s: any) => s.source).join(", ")}`, task.id); }
  }

  await journal(task.id, "versement", "succes",
    `${crees} opportunités nouvelles, ${revus} déjà connues mises à jour, ${sourcesAjoutees} sources ajoutées`,
    { crees, revus, sources_ajoutees: sourcesAjoutees });

  return { ville, candidats: listes.flat().length, doublons, crees, revus, sources_ajoutees: sourcesAjoutees };
}

/* --- Qualifier ----------------------------------------------------------- */
async function qualify(task: any, _contrat: Contrat) {
  const limite = Number(task.params?.limite ?? 200);
  const cibles = await lire(
    `acquisition_opportunites?statut=in.(nouvelle,a_revoir)&select=*&order=created_at.asc&limit=${limite}`);

  let qualifiees = 0, aExaminer = 0, ecartees = 0;
  for (const o of cibles || []) {
    const sources = await lire(`acquisition_sources?opportunite_id=eq.${o.id}&select=*`);
    /* Les canaux entrent dans la qualification : c'est ce qui donne son niveau
       au septième critère. Sans eux, « facilité de contact » resterait
       « inconnu » même après une recherche de canal réussie. */
    const canaux = await lire(`acquisition_canaux?opportunite_id=eq.${o.id}&select=*`);
    const resultat = qualifier({ ...o, sources, canaux }, new Date());

    await rest("acquisition_qualifications", {
      method: "POST",
      headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(resultat.criteres.map((c: any) => ({
        opportunite_id: o.id, critere: c.critere, niveau: c.niveau,
        pourquoi: c.pourquoi, fait_observe: c.fait_observe,
        methode: c.methode, task_id: task.id,
      }))),
    });

    await majLigne(`acquisition_opportunites?id=eq.${o.id}`, {
      statut: resultat.statut,
      prochaine_action: resultat.prochaine_action,
      dernier_examen: new Date().toISOString(),
    });
    await tracer(o.id, "qualification",
      `${resultat.statut} — ${resultat.prochaine_action}`, task.id);

    if (resultat.statut === "qualifiee") qualifiees += 1;
    else if (resultat.statut === "a_examiner") aExaminer += 1;
    else ecartees += 1;
  }

  await journal(task.id, "qualification", "succes",
    `${(cibles || []).length} opportunités qualifiées : ${qualifiees} retenues, ${aExaminer} à examiner par un humain, ${ecartees} écartées`,
    { examinees: (cibles || []).length, qualifiees, a_examiner: aExaminer, ecartees },
    { modele: null, cout_eur: 0 });

  return { examinees: (cibles || []).length, qualifiees, a_examiner: aExaminer, ecartees };
}

/* --- Préparer un contact -------------------------------------------------
   La tâche rend `attente_validation`, et c'est son état final. Rien dans cette
   fonction ne connaît d'adresse d'expédition. */
async function prepareContact(task: any, contrat: Contrat) {
  if (contrat.contact_externe) throw new Error("contact_externe vrai : refus — cet agent n'envoie rien");
  const limite = Number(task.params?.limite ?? 3);
  const cible = task.params?.opportunite_id;

  /* L'ORDRE DE SÉLECTION EST LE SUJET, ET LA PREMIÈRE VERSION L'AVAIT RATÉ.
     Trier par `updated_at.desc` revenait à travailler sur les lignes écrites en
     dernier — c'est-à-dire, à la fin d'un balayage, sur les associations
     nationales de l'annuaire, celles qui n'ont ni programmation locale ni
     coordonnée publique. Cinq refus, zéro brouillon, et les médiathèques qui
     programment trente rendez-vous jamais atteintes.

     On part donc de la vue, on exige un canal — sans lui, le refus est certain —
     et on prend la pertinence la plus haute d'abord. */
  let opportunites;
  if (cible) {
    opportunites = await lire(`acquisition_opportunites?id=eq.${cible}&select=*`);
  } else {
    opportunites = [];
    for (const niveau of ["eleve", "moyen"]) {
      if (opportunites.length >= limite) break;
      const lot = await lire(
        `acquisition_vue?statut=eq.qualifiee&canal=not.is.null&pertinence=eq.${niveau}` +
        `&select=*&order=updated_at.desc&limit=${limite - opportunites.length}`);
      opportunites = opportunites.concat(lot || []);
    }
  }

  /* COMBIEN DE PORTES MANQUENT. C'est le vrai goulot d'étranglement du système
     aujourd'hui, et il doit être visible dans le Control Center plutôt que
     déduit d'une liste de refus. */
  const sansCanal = await lire(
    "acquisition_vue?statut=eq.qualifiee&canal=is.null&select=id&limit=1000")
    .then((r: any[]) => (r || []).length, () => 0);

  let prepares = 0;
  const refus: Json[] = [];
  for (const o of opportunites || []) {
    const sources = await lire(`acquisition_sources?opportunite_id=eq.${o.id}&select=*`);
    const criteres = await lire(`acquisition_qualifications?opportunite_id=eq.${o.id}&select=*`);
    const dejaEnAttente = await lire(
      `acquisition_contacts?opportunite_id=eq.${o.id}&statut=eq.attente_validation&select=id&limit=1`);
    if (dejaEnAttente?.length) { refus.push({ nom: o.nom, pourquoi: "un brouillon attend déjà une décision" }); continue; }

    const brouillon = preparerContact({ ...o, sources }, { criteres });
    if (brouillon.refus) {
      refus.push({ nom: o.nom, pourquoi: brouillon.refus });
      await tracer(o.id, "contact_refuse", brouillon.refus, task.id);
      continue;
    }
    await ecrire("acquisition_contacts", [{
      opportunite_id: o.id, task_id: task.id, canal: brouillon.canal,
      objet: brouillon.objet, message: brouillon.message,
      faits_utilises: brouillon.faits_utilises, statut: "attente_validation",
    }], "return=minimal");
    await majLigne(`acquisition_opportunites?id=eq.${o.id}`, {
      statut: "contact_prepare",
      prochaine_action: "Relire et décider : approuver, modifier ou refuser.",
    });
    await tracer(o.id, "contact_prepare", `Brouillon ${brouillon.canal} en attente de validation`, task.id);
    prepares += 1;
  }

  await journal(task.id, "preparation_contacts",
    prepares > 0 ? "succes" : "partiel",
    `${prepares} propositions préparées, ${refus.length} refusées faute de fait ou de canal. ` +
    `Aucune n'a été envoyée : cet agent n'a pas de fonction d'envoi.` +
    (opportunites.length === 0
      ? " Aucune opportunité qualifiée ne porte de canal de contact public : c'est là qu'est le blocage, pas dans la rédaction."
      : ""),
    { prepares, refuses: refus.length, qualifiees_sans_canal: sansCanal }, { refus });

  return { prepares, refuses: refus.length, refus, qualifiees_sans_canal: sansCanal,
           attente_validation: prepares };
}

/* --- Demander un examen humain ------------------------------------------- */
async function reviewOpportunity(task: any, _contrat: Contrat) {
  const id = task.params?.opportunite_id;
  if (!id) throw new Error("paramètre `opportunite_id` manquant");
  const motif = String(task.params?.motif || "Examen demandé sans motif précisé.");
  await majLigne(`acquisition_opportunites?id=eq.${id}`, {
    statut: "a_examiner", prochaine_action: motif, dernier_examen: new Date().toISOString(),
  });
  await tracer(id, "examen_demande", motif, task.id);
  await journal(task.id, "examen", "succes", `Opportunité ${id} remise à l'examen humain : ${motif}`);
  return { opportunite_id: id, motif };
}

/* --- Mesurer -------------------------------------------------------------
   `acquisition_entonnoir()` rend `mesurable = false` pour ce qu'Autour ne sait
   pas compter. On recopie ce refus tel quel dans le journal plutôt que de le
   remplacer par un zéro. */
async function followupAnalysis(task: any, _contrat: Contrat) {
  const etapes = await rest("rpc/acquisition_entonnoir", { method: "POST", body: "{}" });
  const lisibles = (etapes || []).map((e: any) =>
    e.mesurable ? `${e.etape} : ${e.valeur}` : `${e.etape} : données insuffisantes — ${e.pourquoi_pas}`);
  await journal(task.id, "mesure", "succes", lisibles.join(" · "),
    Object.fromEntries((etapes || []).filter((e: any) => e.mesurable).map((e: any) => [e.etape, e.valeur])),
    { non_mesurables: (etapes || []).filter((e: any) => !e.mesurable) });
  return { etapes };
}


/* ===========================================================================
   LA MÉMOIRE DES TERRITOIRES

   Un territoire balayé il y a trois jours ne se rebalaie pas. C'est la mesure
   d'économie la plus efficace du système et elle ne coûte rien : une lecture
   d'une ligne avant de lancer deux cents requêtes. `force: true` dans les
   paramètres de la tâche passe outre — pour un rejeu délibéré, pas par défaut.
   ======================================================================== */
type Territoire = {
  id: number; slug: string; nom: string; pays: string; region: string | null;
  ville: string | null; langue: string; portee: string; statut: string;
  derniere_recherche: string | null; intervalle: string; zone_id: string | null;
  lat: number | null; lng: number | null; rayon_km: number | null;
  sources_disponibles: string[]; couverture: string; confiance: string;
};

async function lireTerritoire(slug: string): Promise<Territoire> {
  const lignes = await lire(
    `acquisition_territoires?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!lignes?.length) throw new Error(`territoire « ${slug} » inconnu`);
  return lignes[0] as Territoire;
}

/* PostgREST rend `intervalle` en texte (« 30 days », « 7 days »). On ne
   réimplémente pas l'arithmétique d'intervalle de Postgres : on demande à
   Postgres, une fois, ce qu'il en pense. */
async function territoireEchu(t: Territoire): Promise<boolean> {
  if (!t.derniere_recherche) return true;
  const r = await rest("rpc/acquisition_couverture", { method: "POST", body: "{}" });
  const ligne = (r || []).find((x: any) => x.slug === t.slug);
  return ligne ? Boolean(ligne.a_revoir) : true;
}

async function marquerTerritoire(t: Territoire, couverture: string, confiance: string) {
  await majLigne(`acquisition_territoires?id=eq.${t.id}`, {
    derniere_recherche: new Date().toISOString(),
    couverture, confiance,
    statut: t.statut === "a_explorer" ? "en_cours" : t.statut,
  });
}

/* Écrire les canaux d'une opportunité, et dire franchement quand il n'y en a
   pas. Une ligne `non_trouve` vaut mieux qu'une absence de ligne : elle
   distingue « cherché sans succès » de « pas encore cherché ». */
async function verserCanaux(opportuniteId: string, canaux: any[], source: string) {
  const existants = await lire(
    `acquisition_canaux?opportunite_id=eq.${opportuniteId}&select=type,valeur`);
  const deja = new Set((existants || []).map((c: any) => `${c.type}|${c.valeur}`));

  const lignes = (canaux || [])
    .filter((c) => !deja.has(`${c.type}|${c.valeur}`))
    .map((c) => ({
      opportunite_id: opportuniteId, type: c.type, valeur: c.valeur,
      source: c.source, url_source: c.url_source ?? null,
      type_source: c.type_source, confiance: c.confiance, statut: "trouve",
      notes: c.notes ?? null,
    }));

  if (!lignes.length && !canaux.length && !deja.has("site_officiel|")) {
    lignes.push({
      opportunite_id: opportuniteId, type: "site_officiel", valeur: "",
      source, url_source: null, type_source: "donnee_ouverte",
      confiance: "faible", statut: "non_trouve",
    } as any);
  }
  if (lignes.length) await ecrire("acquisition_canaux", lignes, "return=minimal");
  return lignes.filter((l: any) => l.statut === "trouve").length;
}


/* ===========================================================================
   CHERCHER LA PORTE

   Le blocage mesuré à la première mission : 247 opportunités qualifiées sur
   249 sans canal. Deux sources publient ce que les deux premières ignorent —
   l'annuaire du service public pour les équipements publics, OpenStreetMap
   pour tout le reste — et on les interroge UNE fois par commune, pas une fois
   par opportunité.
   ======================================================================== */
async function findContactChannel(task: any, contrat: Contrat) {
  const ville: string = task.params?.ville;
  if (!ville) throw new Error("paramètre `ville` manquant");
  const limite = Number(task.params?.limite ?? 150);
  const t0 = Date.now();

  /* OÙ EST CETTE COMMUNE, ET QUEL EST SON CODE INSEE.

     Les deux sources en ont besoin, et pour des raisons différentes :
     l'annuaire du service public se filtre par code INSEE (un `where` sur le
     nom de commune rend un 400 — mesuré), Overpass se requête autour d'un
     point. On lit donc ce qu'Autour sait déjà, dans cet ordre : le territoire
     d'acquisition, puis `mel_communes`, puis `territories`. */
  const [terr] = await lire(
    `acquisition_territoires?ville=eq.${encodeURIComponent(ville)}&select=lat,lng,rayon_km&limit=1`) || [];
  const [commune] = await lire(
    `mel_communes?nom=eq.${encodeURIComponent(ville)}&select=insee,lat,lng&limit=1`) || [];
  const [territoire] = await lire(
    `territories?name=eq.${encodeURIComponent(ville)}&select=latitude,longitude,radius_km&limit=1`) || [];

  const insee = commune?.insee ?? null;
  const lat = terr?.lat ?? commune?.lat ?? territoire?.latitude ?? null;
  const lng = terr?.lng ?? commune?.lng ?? territoire?.longitude ?? null;
  const rayonKm = terr?.rayon_km ?? territoire?.radius_km ?? 10;

  const cibles = await lire(
    `acquisition_opportunites?ville=eq.${encodeURIComponent(ville)}` +
    `&canal_cherche_le=is.null&statut=in.(nouvelle,qualifiee,a_examiner)` +
    `&select=id,nom,ville&limit=${limite}`);

  if (!cibles?.length) {
    await journal(task.id, "canaux", "info",
      `Aucune opportunité à ${ville} dont le canal n'ait pas déjà été cherché.`);
    return { ville, examinees: 0, canaux_trouves: 0, sans_canal: 0 };
  }

  const index = new Map<string, any>();
  let chargeAnnuaire: any = null;

  if (contrat.sources_autorisees.includes("annuaire_service_public")) {
    const t1 = Date.now();
    try {
      /* `where=nom_commune like "…"` a rendu HTTP 400 : ce champ n'existe pas
         au premier niveau du jeu de données. `code_insee_commune`, si. Sans
         code INSEE on ne devine pas : on saute la source et on le dit. */
      if (!insee) throw new Error(`code INSEE inconnu pour ${ville}`);
      const params = new URLSearchParams({
        where: `code_insee_commune="${insee}"`,
        limit: "100",
      });
      const r = await fetch(`${ANNUAIRE_SP}?${params}`,
        { headers: { accept: "application/json", "User-Agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const charge = await r.json();
      chargeAnnuaire = charge;
      const trouves = canauxDepuisAnnuaireServicePublic(charge);
      for (const [k, v] of trouves) index.set(k, v);
      await journal(task.id, "canaux_annuaire_public", "succes",
        `Annuaire du service public : ${(charge?.results || []).length} fiches lues à ${ville}, ${trouves.size} portent un contact exploitable.`,
        { fiches: (charge?.results || []).length, avec_contact: trouves.size }, {}, 0, t1);
    } catch (e) {
      await journal(task.id, "canaux_annuaire_public", "partiel",
        `Annuaire du service public injoignable : ${(e as Error).message}. On continue avec OpenStreetMap.`,
        {}, {}, 0, t1);
    }
  }

  if (contrat.sources_autorisees.includes("osm_overpass")) {
    const t2 = Date.now();
    try {
      if (lat == null || lng == null) throw new Error(`coordonnées inconnues pour ${ville}`);
      const charge = await overpass(requeteOverpassAutour(lat, lng, rayonKm, 400));
      const trouves = canauxDepuisOsm(charge);
      /* L'annuaire du service public fait autorité : il est tenu par les
         administrations elles-mêmes. OSM complète, il ne remplace pas. */
      for (const [k, v] of trouves) if (!index.has(k)) index.set(k, v);
      await journal(task.id, "canaux_osm", "succes",
        `OpenStreetMap : ${(charge?.elements || []).length} entités lues à ${ville}, ${trouves.size} portent un contact tagué.`,
        { entites: (charge?.elements || []).length, avec_contact: trouves.size }, {}, 0, t2);
    } catch (e) {
      await journal(task.id, "canaux_osm", "partiel",
        `OpenStreetMap injoignable : ${(e as Error).message}.`, {}, {}, 0, t2);
    }
  }

  const { trouves, manquants } = rapprocherCanaux(cibles, index);

  /* ÉCRIRE EN LOT, PAS LIGNE À LIGNE. La première version faisait quatre
     appels REST par opportunité — six cents allers-retours sur cent cinquante
     opportunités, et deux tâches arrêtées sur le temps mural. Ici : une
     lecture, deux écritures, un PATCH par valeur de canal. */
  const tousIds = cibles.map((o: any) => o.id);
  const existants = await lire(
    `acquisition_canaux?opportunite_id=in.(${tousIds.join(",")})&select=opportunite_id,type,valeur`);
  const deja = new Set((existants || []).map((c: any) => `${c.opportunite_id}|${c.type}|${c.valeur}`));

  const lignesCanaux: Json[] = [];
  const lignesActions: Json[] = [];
  const parCanal = new Map<string, string[]>();

  for (const t of trouves) {
    for (const c of t.canaux) {
      const cle = `${t.opportunite.id}|${c.type}|${c.valeur}`;
      if (deja.has(cle)) continue;
      deja.add(cle);
      lignesCanaux.push({
        opportunite_id: t.opportunite.id, type: c.type, valeur: c.valeur,
        source: c.source, url_source: c.url_source ?? null,
        type_source: c.type_source, confiance: c.confiance,
        statut: "trouve", notes: c.notes ?? null,
      });
    }
    const canal = canalOpportunite(t.canaux);
    if (canal) {
      if (!parCanal.has(canal)) parCanal.set(canal, []);
      parCanal.get(canal)!.push(t.opportunite.id);
    }
    lignesActions.push({
      opportunite_id: t.opportunite.id, action: "canal_trouve", task_id: task.id, par: null,
      detail: `${t.canaux.map((c: any) => c.type).join(", ")} via ${t.canaux[0].source}`
            + (t.exact ? "" : ` (rapproché par inclusion : « ${t.correspondance} »)`),
    });
  }

  for (const o of manquants) {
    const cle = `${o.id}|site_officiel|`;
    if (!deja.has(cle)) {
      deja.add(cle);
      lignesCanaux.push({
        opportunite_id: o.id, type: "site_officiel", valeur: "",
        source: "recherche_canal", url_source: null, type_source: "donnee_ouverte",
        confiance: "faible", statut: "non_trouve",
        notes: "Cherché dans l'annuaire du service public et OpenStreetMap, sans correspondance.",
      });
    }
    lignesActions.push({
      opportunite_id: o.id, action: "canal_non_trouve", task_id: task.id, par: null,
      detail: "Cherché dans l'annuaire du service public et OpenStreetMap, sans correspondance.",
    });
  }

  /* PostgREST reçoit les identifiants dans l'URL : au-delà de quelques
     dizaines, elle devient trop longue pour certains intermédiaires. */
  const parLots = (l: string[], n = 50) => {
    const lots = [];
    for (let i = 0; i < l.length; i += n) lots.push(l.slice(i, i + n));
    return lots;
  };

  if (lignesCanaux.length) await ecrire("acquisition_canaux", lignesCanaux, "return=minimal");
  if (lignesActions.length) await ecrire("acquisition_actions", lignesActions, "return=minimal");

  const maintenant = new Date().toISOString();
  for (const [canal, ids] of parCanal) {
    for (const lot of parLots(ids)) {
      await majLigne(`acquisition_opportunites?id=in.(${lot.join(",")})`,
        { canal, canal_cherche_le: maintenant });
    }
  }
  for (const lot of parLots(manquants.map((o: any) => o.id))) {
    await majLigne(`acquisition_opportunites?id=in.(${lot.join(",")})`,
      { canal_cherche_le: maintenant });
  }

  /* LES FICHES QUE LE RAPPROCHEMENT N'A PAS CONSOMMÉES SONT DES OPPORTUNITÉS.

     Voir le long commentaire de `canaux.mjs` : les deux populations sont
     disjointes, et ces fiches-là décrivent des structures dont le métier est
     d'orienter des gens — avec leur porte déjà ouverte. Les ignorer serait
     jeter la moitié utile de la réponse de la source.

     Elles passent par `verserOpportunite`, donc par `on_conflict=cle_dedup` :
     une structure qu'Autour connaît déjà sous le même nom est mise à jour, pas
     dupliquée. */
  let issuesAnnuaire = 0;
  if (chargeAnnuaire) {
    const consommees = new Set(trouves.map((t: any) => nomNormalise(t.correspondance || t.opportunite.nom)));
    for (const o of cibles) consommees.add(nomNormalise(o.nom));

    const candidats = candidatsDepuisAnnuaireServicePublicOpportunites(chargeAnnuaire, {
      ville, deja: consommees, deduireType,
      zone_id: task.params?.zone_id ?? null,
    });

    for (const c of candidats) {
      const avant = await lire(
        `acquisition_opportunites?cle_dedup=eq.${encodeURIComponent(c.cle)}&select=id`);
      if ((avant || []).length) continue;
      const r = await verserOpportunite({ ...c, canal_cherche_le: null });
      issuesAnnuaire += 1;
      await verserCanaux(r.id, [{
        type: c.canal_type, valeur: c.canal_valeur, source: "annuaire_service_public",
        type_source: "annuaire_public", url_source: c.sources[0]?.url ?? null,
        confiance: "eleve", statut: "trouve",
        notes: "Publié par la structure elle-même dans l'annuaire du service public.",
      }], "annuaire_service_public");
      await majLigne(`acquisition_opportunites?id=eq.${r.id}`,
        { canal_cherche_le: new Date().toISOString() });
      await tracer(r.id, "decouverte",
        `Découverte par l'annuaire du service public, avec son canal de contact (${c.canal_type})`,
        task.id);
    }

    await journal(task.id, "canaux_annuaire_opportunites",
      issuesAnnuaire ? "succes" : "info",
      issuesAnnuaire
        ? `${issuesAnnuaire} structures de l'annuaire du service public n'existaient pas dans Autour et sont entrées AVEC leur canal de contact.`
        : `Aucune fiche de l'annuaire du service public à ${ville} qui ne soit déjà connue d'Autour.`,
      { issues_annuaire: issuesAnnuaire });
  }

  const parInclusion = trouves.filter((t: any) => !t.exact).length;
  await journal(task.id, "canaux", trouves.length ? "succes" : "partiel",
    `${cibles.length} opportunités examinées à ${ville} : ${trouves.length} canaux publics trouvés ` +
    `(dont ${parInclusion} rapprochés par inclusion de nom, à vérifier), ` +
    `${manquants.length} « canal non trouvé » (cherché, rien trouvé — ce n'est pas « pas encore cherché »).`,
    { examinees: cibles.length, trouvees: trouves.length, par_inclusion: parInclusion,
      sans_canal: manquants.length, canaux_ecrits: lignesCanaux.length }, {}, 0, t0);

  return { ville, examinees: cibles.length, canaux_trouves: trouves.length,
           par_inclusion: parInclusion, sans_canal: manquants.length,
           issues_annuaire: issuesAnnuaire };
}


/* ===========================================================================
   BALAYER UN TERRITOIRE DÉCLARÉ — avec sa mémoire
   ======================================================================== */
async function scanTerritory(task: any, contrat: Contrat) {
  const slug: string = task.params?.territoire;
  if (!slug) throw new Error("paramètre `territoire` manquant");
  const t = await lireTerritoire(slug);

  if (!task.params?.force && !(await territoireEchu(t))) {
    await journal(task.id, "memoire", "info",
      `${t.nom} : déjà examiné le ${String(t.derniere_recherche).slice(0, 10)}, échéance non atteinte. ` +
      `Aucune requête lancée — passer { "force": true } pour rejouer malgré tout.`,
      { territoire: t.slug });
    return { territoire: t.slug, ignore: true,
             raison: "déjà examiné récemment", derniere_recherche: t.derniere_recherche };
  }

  if (!t.ville) throw new Error(`le territoire « ${slug} » n'a pas de ville : utiliser scan_incubators`);

  const resultat = await scanCity(
    { ...task, params: { ...task.params, ville: t.ville, zone_id: t.zone_id,
                         territoire_id: t.id, pays: t.pays, region: t.region } },
    contrat);

  const trouve = Number((resultat as any).crees || 0) + Number((resultat as any).revus || 0);
  await marquerTerritoire(t, trouve > 20 ? "partielle" : (trouve > 0 ? "aucune" : "aucune"),
                          trouve > 0 ? "moyen" : "faible");
  return { ...resultat, territoire: t.slug };
}


/* ===========================================================================
   L'ÉCOSYSTÈME ENTREPRENEURIAL

   Le code NAF ne distingue pas un incubateur d'un cabinet de conseil : 70.22Z
   couvre les deux. C'est donc le NOM qui sert de signal, et il est fiable ici
   parce que ces structures se nomment explicitement. Une requête par terme,
   quatre termes, un territoire : douze requêtes au pire, pas un balayage.
   ======================================================================== */
const TERMES_ECOSYSTEME = ["incubateur", "pepiniere entreprises", "accelerateur", "coworking"];

async function scanIncubators(task: any, contrat: Contrat) {
  const slug: string = task.params?.territoire || "fr-national";
  const t = await lireTerritoire(slug);
  if (!contrat.lecture_externe || !contrat.sources_autorisees.includes("recherche_entreprises")) {
    throw new Error("source « recherche_entreprises » absente de sources_autorisees");
  }

  const t0 = Date.now();
  const candidats: any[] = [];
  let lignesLues = 0;

  for (const terme of TERMES_ECOSYSTEME) {
    const params = new URLSearchParams({ q: terme, per_page: "25", page: "1" });
    if (t.ville) params.set("q", `${terme} ${t.ville}`);
    try {
      const r = await fetch(`${ANNUAIRE}?${params}`,
        { headers: { accept: "application/json", "User-Agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const charge = await r.json();
      lignesLues += (charge?.results || []).length;
      candidats.push(...candidatsEcosysteme(charge,
        { ville: t.ville, zone_id: t.zone_id, territoire_id: t.id }));
    } catch (e) {
      await journal(task.id, "ecosysteme_requete", "partiel",
        `Terme « ${terme} » : ${(e as Error).message}.`);
    }
  }

  const { opportunites, doublons } = fusionner(candidats);
  await journal(task.id, "ecosysteme_lecture", "succes",
    `${TERMES_ECOSYSTEME.length} termes cherchés sur ${t.nom} : ${lignesLues} lignes lues, ` +
    `${candidats.length} structures d'accompagnement reconnues au nom, ${doublons} doublons, ` +
    `${opportunites.length} distinctes. Les lignes dont le nom ne désigne rien de l'écosystème sont écartées.`,
    { lignes_lues: lignesLues, reconnues: candidats.length, doublons,
      distinctes: opportunites.length }, {}, 0, t0);

  let crees = 0, revus = 0;
  for (const c of opportunites) {
    const avant = await lire(`acquisition_opportunites?cle_dedup=eq.${encodeURIComponent(c.cle)}&select=id`);
    const existait = (avant || []).length > 0;
    const r = await verserOpportunite(c);
    if (existait) revus += 1;
    else { crees += 1; await tracer(r.id, "decouverte", `Écosystème entrepreneurial — ${c.type}`, task.id); }
  }

  await marquerTerritoire(t, crees + revus > 0 ? "partielle" : "aucune",
                          crees + revus > 0 ? "moyen" : "faible");
  await journal(task.id, "versement", "succes",
    `${crees} structures nouvelles, ${revus} déjà connues. Aucune n'est réputée pertinente du seul fait ` +
    `d'être un incubateur : chacune porte sa raison, et elle dit si le lien est observé ou supposé.`,
    { crees, revus });

  return { territoire: t.slug, lignes_lues: lignesLues, crees, revus, doublons };
}


/* ===========================================================================
   L'INTERNATIONAL — expérimental, et honnête sur ce qu'il trouve

   Hors de France, l'annuaire des entreprises s'arrête et `events` est vide.
   OpenStreetMap reste : c'est la seule base ouverte et mondiale licenciée pour
   cet usage. Avantage inattendu — ses tags apportent la structure ET sa porte
   dans la même réponse, là où il faut deux sources françaises pour les deux.
   ======================================================================== */
async function scanInternational(task: any, contrat: Contrat) {
  const slug: string = task.params?.territoire;
  if (!slug) throw new Error("paramètre `territoire` manquant");
  const t = await lireTerritoire(slug);
  if (t.pays === "FR") throw new Error(`« ${slug} » est un territoire français : utiliser scan_territory`);
  if (!contrat.sources_autorisees.includes("osm_overpass")) {
    throw new Error("source « osm_overpass » absente de sources_autorisees");
  }
  if (!task.params?.force && !(await territoireEchu(t))) {
    await journal(task.id, "memoire", "info",
      `${t.nom} : déjà exploré le ${String(t.derniere_recherche).slice(0, 10)}, échéance non atteinte.`);
    return { territoire: t.slug, ignore: true, raison: "déjà examiné récemment" };
  }

  const t0 = Date.now();
  let charge: any;
  try {
    charge = await overpass(requeteOverpassAutour(t.lat, t.lng, t.rayon_km ?? 10, 300));
  } catch (e) {
    await journal(task.id, "international", "echec",
      `${t.nom} : ${(e as Error).message}. Aucune autre source n'est déclarée pour ce territoire — ` +
      `données insuffisantes, rien n'est inventé.`, {}, {}, 0, t0);
    await marquerTerritoire(t, "inconnue", "faible");
    return { territoire: t.slug, erreur: (e as Error).message, crees: 0,
             constat: "Données insuffisantes" };
  }

  const candidats = candidatsDepuisOsmStructures(charge,
    { ville: t.ville || t.nom, pays: t.pays, territoire_id: t.id });
  const { opportunites, doublons } = fusionner(candidats);

  await journal(task.id, "international_lecture", "succes",
    `${t.nom} (${t.pays}) : ${(charge?.elements || []).length} entités OpenStreetMap lues, ` +
    `${candidats.length} structures retenues, ${doublons} doublons, ${opportunites.length} distinctes.`,
    { entites: (charge?.elements || []).length, retenues: candidats.length,
      doublons, distinctes: opportunites.length }, {}, 0, t0);

  let crees = 0, revus = 0, avecCanal = 0;
  for (const c of opportunites) {
    const avant = await lire(`acquisition_opportunites?cle_dedup=eq.${encodeURIComponent(c.cle)}&select=id`);
    const existait = (avant || []).length > 0;
    const r = await verserOpportunite({ ...c, region: t.region });
    if (existait) revus += 1;
    else { crees += 1; await tracer(r.id, "decouverte", `OpenStreetMap — ${t.nom} (${t.pays})`, task.id); }

    /* Le canal arrive avec la structure : on l'enregistre tout de suite plutôt
       que de relancer une recherche de canal qui ne trouverait rien de plus. */
    const canaux = [];
    if (c.coordonnees_publiques?.email) {
      canaux.push({ type: "email_public", valeur: c.coordonnees_publiques.email.valeur,
                    source: "osm_overpass", type_source: "donnee_ouverte",
                    url_source: c.coordonnees_publiques.email.vu_sur, confiance: "moyen" });
    }
    if (c.coordonnees_publiques?.site) {
      canaux.push({ type: "site_officiel", valeur: c.coordonnees_publiques.site.valeur,
                    source: "osm_overpass", type_source: "donnee_ouverte",
                    url_source: c.coordonnees_publiques.site.vu_sur, confiance: "moyen" });
    }
    if (canaux.length) {
      await verserCanaux(r.id, canaux, "osm_overpass");
      avecCanal += 1;
    }
    await majLigne(`acquisition_opportunites?id=eq.${r.id}`,
      { canal_cherche_le: new Date().toISOString() });
  }

  const couverture = opportunites.length === 0 ? "aucune"
    : (avecCanal > opportunites.length / 3 ? "partielle" : "aucune");
  await marquerTerritoire(t, couverture, opportunites.length ? "moyen" : "faible");

  await journal(task.id, "international", opportunites.length ? "succes" : "partiel",
    opportunites.length
      ? `${t.nom} : ${crees} structures nouvelles, ${avecCanal} avec un canal public tagué dans OpenStreetMap.`
      : `${t.nom} : données insuffisantes — OpenStreetMap n'a rien rendu d'exploitable, et aucune autre source n'est déclarée.`,
    { crees, revus, avec_canal: avecCanal });

  return { territoire: t.slug, pays: t.pays, crees, revus, avec_canal: avecCanal,
           constat: opportunites.length ? null : "Données insuffisantes" };
}

const TACHES: Record<string, (t: any, c: Contrat) => Promise<Json>> = {
  acquisition_scan_city: scanCity,
  acquisition_find_structures: scanCity,   // même moteur, paramètres plus étroits
  acquisition_qualify: qualify,
  acquisition_prepare_contact: prepareContact,
  acquisition_review_opportunity: reviewOpportunity,
  acquisition_followup_analysis: followupAnalysis,
  acquisition_find_contact_channel: findContactChannel,
  acquisition_scan_territory: scanTerritory,
  acquisition_scan_incubators: scanIncubators,
  acquisition_scan_international: scanInternational,
};

/* ---------------------------------------------------------------------------
   EXÉCUTER UNE TÂCHE
   ------------------------------------------------------------------------ */
async function executer(task: any) {
  const debut = Date.now();

  /* PRENDRE LA TÂCHE, PAS SEULEMENT LA MARQUER. Deux réveils lancés à
     quarante-cinq secondes d'intervalle ont lu la même file : Wattrelos et
     Roubaix se sont retrouvées `en_cours` ensemble. Un PATCH sans condition
     marque toujours, même ce qui ne nous appartient plus. Le filtre
     `statut=eq.file` en fait une PRISE : zéro ligne rendue veut dire qu'une
     autre exécution l'a déjà prise, et on passe. */
  const prises = await majLigne(`tasks?id=eq.${task.id}&statut=eq.file`, {
    statut: "en_cours", demarree_le: new Date().toISOString(), tentatives: (task.tentatives ?? 0) + 1,
  });
  if (!prises?.length) {
    return { id: task.id, type: task.type, statut: "ignoree",
             raison: "tâche déjà prise par une autre exécution" };
  }

  await journal(task.id, "demarrage", "info", `Tâche ${task.type} démarrée`, {}, { params: task.params });

  try {
    const contrat = await lireContrat(task.type);
    const executeur = TACHES[task.type];
    if (!executeur) throw new Error(`aucun exécuteur pour « ${task.type} »`);

    const resultat = await executeur(task, contrat);

    /* `attente_validation` est un aboutissement, pas un demi-échec : la tâche a
       fait tout ce qu'elle avait le droit de faire. */
    const enAttente = contrat.validation_humaine && Number((resultat as any).attente_validation ?? 0) > 0;
    await majLigne(`tasks?id=eq.${task.id}`, {
      statut: enAttente ? "attente_validation" : "terminee",
      resultat, terminee_le: new Date().toISOString(), erreur: null,
    });
    await journal(task.id, "fin", "succes",
      enAttente ? "Terminée — en attente de validation humaine" : "Terminée",
      {}, resultat as Json, 0, debut);
    return { id: task.id, type: task.type, statut: enAttente ? "attente_validation" : "terminee", resultat };
  } catch (e) {
    const message = (e as Error).message || String(e);
    const epuisee = (task.tentatives ?? 0) + 1 >= (task.max_tentatives ?? 3);
    await majLigne(`tasks?id=eq.${task.id}`, {
      statut: epuisee ? "echouee" : "file", erreur: message,
      terminee_le: epuisee ? new Date().toISOString() : null,
    });
    await journal(task.id, "fin", "echec", message, {}, {}, 0, debut);
    return { id: task.id, type: task.type, statut: epuisee ? "echouee" : "file", erreur: message };
  }
}

/* ---------------------------------------------------------------------------
   LA PORTE
   ------------------------------------------------------------------------ */
Deno.serve(async (requete) => {
  const url = new URL(requete.url);
  const mode = url.searchParams.get("mode") ?? "work";
  const presente = requete.headers.get("x-sync-secret") ?? "";

  /* Le refus dit lequel des trois cas c'est — secret absent de la fonction,
     en-tête absent de l'appel, ou les deux présents et différents. C'est ce
     diagnostic qui manquait en août, et qui a coûté trente exécutions en 401
     avant qu'on comprenne. */
  if (!SYNC_SECRET || presente !== SYNC_SECRET) {
    console.log(JSON.stringify({
      fonction: "agent-acquisition", etape: "refus",
      secret_configure: Boolean(SYNC_SECRET), entete_presente: Boolean(presente),
    }));
    return new Response(JSON.stringify({ error: "non autorisé" }),
      { status: 401, headers: { "Content-Type": "application/json" } });
  }

  try {
    if (mode === "ping") {
      return Response.json({ agent: AGENT, pret: true, taches: Object.keys(TACHES) });
    }

    const filtre = mode === "task" && url.searchParams.get("id")
      ? `tasks?id=eq.${url.searchParams.get("id")}&select=*`
      : `tasks?agent=eq.${AGENT}&statut=eq.file&planifiee_pour=lte.${new Date().toISOString()}` +
        `&select=*&order=priorite.asc,cree_le.asc&limit=${TACHES_PAR_REVEIL}`;

    /* Reprise des orphelines, avant de lire la file : une tâche remise en file
       ici peut être prise dans le même réveil. */
    let reprises = 0;
    if (mode !== "task") {
      const limite = new Date(Date.now() - ORPHELINE_APRES_MIN * 60_000).toISOString();
      const remises = await majLigne(
        `tasks?agent=eq.${AGENT}&statut=eq.en_cours&demarree_le=lt.${limite}`,
        { statut: "file", erreur: "Reprise : l'exécution précédente a été interrompue avant la fin." });
      reprises = (remises || []).length;
      if (reprises) {
        await journal(null, "reprise", "partiel",
          `${reprises} tâche(s) restée(s) « en_cours » plus de ${ORPHELINE_APRES_MIN} min ont été remises en file : ` +
          `l'exécution qui les tenait a été interrompue.`, { reprises });
      }
    }

    const taches = await lire(filtre);
    if (!taches?.length) {
      return Response.json({ agent: AGENT, traitees: 0, reprises, message: "aucune tâche en file" });
    }

    const resultats = [];
    const depart = Date.now();
    let reportees = 0;
    for (const t of taches) {
      /* La première tâche part toujours : sinon un réveil pourrait ne rien
         faire du tout et la file n'avancerait jamais. */
      if (resultats.length && Date.now() - depart > BUDGET_MS) { reportees++; continue; }
      resultats.push(await executer(t));
    }
    return Response.json({
      agent: AGENT, traitees: resultats.length, reportees, reprises, resultats,
    });
  } catch (e) {
    console.error("agent-acquisition", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
