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
import { fusionner } from "./normalisation.mjs";
import { qualifier } from "./qualification.mjs";
import { preparerContact } from "./contact.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("EVENT_SYNC_SECRET") ?? "";

const AGENT = "acquisition";
const TACHES_PAR_REVEIL = 5;
const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";

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

  let crees = 0, revus = 0, sourcesAjoutees = 0;
  for (const c of opportunites) {
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
    const resultat = qualifier({ ...o, sources }, new Date());

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

const TACHES: Record<string, (t: any, c: Contrat) => Promise<Json>> = {
  acquisition_scan_city: scanCity,
  acquisition_find_structures: scanCity,   // même moteur, paramètres plus étroits
  acquisition_qualify: qualify,
  acquisition_prepare_contact: prepareContact,
  acquisition_review_opportunity: reviewOpportunity,
  acquisition_followup_analysis: followupAnalysis,
};

/* ---------------------------------------------------------------------------
   EXÉCUTER UNE TÂCHE
   ------------------------------------------------------------------------ */
async function executer(task: any) {
  const debut = Date.now();
  await majLigne(`tasks?id=eq.${task.id}`, {
    statut: "en_cours", demarree_le: new Date().toISOString(), tentatives: (task.tentatives ?? 0) + 1,
  });
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

    const taches = await lire(filtre);
    if (!taches?.length) return Response.json({ agent: AGENT, traitees: 0, message: "aucune tâche en file" });

    const resultats = [];
    for (const t of taches) resultats.push(await executer(t));
    return Response.json({ agent: AGENT, traitees: resultats.length, resultats });
  } catch (e) {
    console.error("agent-acquisition", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
