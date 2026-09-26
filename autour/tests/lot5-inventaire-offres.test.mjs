/* LOT 5 — L'INVENTAIRE BRANCHÉ, LES OFFRES, ET CE QUI POURRAIT PLAIRE
   ==================================================================

   Trois promesses tiennent tout le lot, et ce sont elles qui sont verrouillées
   ici :

   · `places` alimente Explorer, JAMAIS Maintenant. Un lieu sans horaire fiable
     peut se découvrir ; il ne peut pas être déclaré ouvert.
   · Une affiche d'événement n'est jamais présentée comme la photo du lieu.
   · Ce qu'on observe dans Explorer ne remonte pas dans les trois résultats de
     Maintenant, et ne devient jamais une conclusion sur la personne.

   Le comportement en base — droits, idempotence, expiration — est démontré par
   `supabase/tests/lot5_offres.sql`, qui s'exécute sur la vraie base. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const dossier = new URL("../supabase/migrations/", import.meta.url);
const fichiers = (await readdir(dossier)).filter((f) => f.includes("lot5"));
const sql = (await Promise.all(
  fichiers.map((f) => readFile(new URL(f, dossier), "utf8")))).join("\n");
const code = sql.replace(/--[^\n]*/g, "").replace(/comment on [\s\S]*?;\n/g, "");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
/* Les commentaires de `app.js` NOMMENT ce qui n'existe pas — « il n'existe
   nulle part de `is_student` ». Une interdiction se vérifie sur le code, sinon
   la phrase qui la documente la fait échouer. */
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
/* Le document ET sa feuille de style : les règles ont quitté `index.html`
   pour `autour.css`, la question posée par ces tests n'a pas changé. */
const html = await readFile(new URL("../index.html", import.meta.url), "utf8") + "\n" +
  await readFile(new URL("../autour.css", import.meta.url), "utf8");

/* ---- A · Explorer lit l'inventaire ------------------------------------- */

test("la porte d'Explorer refuse ce qui n'est pas présentable", () => {
  const f = sql.slice(sql.indexOf("function public.lieux_explorer"),
    sql.indexOf("view public.lieux_explorer_couverture"));
  /* Les 358 lieux non classés ne polluent pas une surface de découverte : on
     ne sait pas où les ranger, donc on ne les propose pas. */
  assert.match(f, /and p\.family is not null/);
  assert.match(f, /join public\.place_familles f on f\.famille = p\.family/);
  assert.match(f, /where p\.status = 'active'/);
  assert.match(f, /and p\.duplicate_of is null/);
  assert.match(f, /and p\.lat is not null and p\.lng is not null/);
  /* Une sélection visuelle exige de quoi remplir une carte. */
  assert.match(f, /not p_visuel_exige\s*\n\s*or p\.image_url is not null/);
});

test("aucun lieu n'est déclaré ouvert par supposition", () => {
  const f = sql.slice(sql.indexOf("function public.lieux_explorer"),
    sql.indexOf("view public.lieux_explorer_couverture"));
  /* La colonne dit ce qu'on SAIT, pas ce qu'on suppose : un horaire absent
     n'est pas une ouverture. */
  assert.match(f,
    /\(p\.opening_hours is not null and btrim\(p\.opening_hours\) <> ''\) as horaires_fiables/);
  assert.doesNotMatch(code, /open_now|est_ouvert|ouvert_maintenant/i);
  /* Et Maintenant n'appelle pas cette porte du tout. */
  const maintenant = app.slice(app.indexOf("function blocMaintenantAccueil"),
    app.indexOf("function blocCaPourraitTePlaire"));
  assert.doesNotMatch(maintenant, /lieux_explorer|chargerLieuxExplorer/);
});

test("le runtime reste, et reprend la main quand la base ne suffit pas", () => {
  /* La règle du lot est une PRIORITÉ, pas un remplacement : aucune source
     n'est retirée. */
  assert.match(app, /const LIEUX_EXPLORER_MIN = 3;/);
  const rempl = app.slice(app.indexOf("async function remplirLieuxExplorer"),
    app.indexOf("function ouvrirFamilleExplorer"));
  assert.match(rempl, /if\(lieux2\.length < LIEUX_EXPLORER_MIN\)\{/);
  assert.match(rempl, /zone\.hidden = true; titre\.hidden = true/);
  /* Le relais Overpass et les autres sources vivent toujours. */
  assert.match(app, /async function overpassRelaye\(q, msMax, signal\)\{/);
  assert.match(app, /PERF\.requete\("datatourisme"\)/);
  assert.match(app, /PERF\.requete\("google_places"\)/);
  /* Et l'on sait dire laquelle a servi — sinon le taux de repli n'est qu'une
     impression. */
  assert.match(app, /dernierRecoursExplorer = lus\.length >= LIEUX_EXPLORER_MIN \? "places" : "runtime"/);
});

/* ---- B · Les images ----------------------------------------------------- */

test("une affiche d'événement n'est jamais présentée comme la photo du lieu", () => {
  const v = app.slice(app.indexOf("const RANG_IMAGE_LIEU"),
    app.indexOf("const FAMILLES_EXPLORER"));
  /* L'ordre du lot, écrit tel quel : photo du lieu, Wikimedia, officielle,
     puis seulement une autre image dont la nature est connue. */
  assert.match(v, /\{place_photo:1, wikimedia:2, institutional:3, event_poster:4\}/);
  /* Une image sans licence n'est pas affichée, comme partout ailleurs. */
  assert.match(v, /!!l\.image_url && rang > 0 && !!l\.image_license/);
  /* Et quand c'est une affiche, la vignette le DIT. */
  assert.match(v, /l\.image_type === "event_poster"[\s\S]{0,120}Affiche d’un événement ici/);
  /* La mention s'en va avec l'image : légender un pictogramme ne veut rien dire. */
  assert.match(v, /onerror="var m=this\.parentNode\.querySelector\(\\'b\\'\);if\(m\)m\.remove\(\);this\.remove\(\)"/);
  /* Rien n'est fabriqué et rien de Google n'est repris. */
  assert.doesNotMatch(v, /concat\(|\+ *"https|google/i);
});

test("le plancher de lisibilité tient aussi sur la mention", () => {
  assert.match(html, /\.xp-lieu-photo b\{[\s\S]{0,140}?font-size:11px/);
});

/* ---- C et D · Les offres ------------------------------------------------ */

test("une offre est une entité à part, rattachable à un lieu", () => {
  assert.match(sql, /create table if not exists public\.offers/);
  assert.match(sql, /place_id\s+uuid references public\.places\(id\) on delete set null/);
  /* Rattachable, donc facultatif : une offre vit sans lieu. */
  assert.doesNotMatch(sql, /place_id\s+uuid not null/);
  for (const colonne of ["slug", "title", "description", "offer_type", "audience_tags",
                         "zone_id", "starts_at", "ends_at", "eligibility",
                         "source_name", "source_url", "source_updated_at",
                         "first_seen_at", "last_seen_at", "status", "image_refs",
                         "dedup_key", "created_at", "updated_at"])
    assert.ok(sql.includes(colonne), colonne);
});

test("une offre sans source vérifiable ne peut pas exister", () => {
  /* La contrainte est au SCHÉMA : aucun import, présent ou futur, ne peut la
     contourner en oubliant un contrôle applicatif. */
  assert.match(sql, /source_url\s+text not null check \(source_url ~ '\^https\?:\/\/'\)/);
  assert.match(sql, /source_name\s+text not null/);
  const ing = sql.slice(sql.indexOf("function public.offres_ingerer"));
  assert.match(ing, /if p_source_url is null or p_source_url !~ '\^https\?:\/\/' then return; end if;/);
});

test("audience_tags décrit l'offre, jamais la personne", () => {
  assert.match(sql, /check \(audience_tags <@ array\['all','student','young','family',\s*\n?\s*'senior','jobseeker'\]::text\[\]/);
  /* Aucune table, aucune colonne, aucun code ne conclut sur qui regarde. */
  assert.doesNotMatch(code, /is_student|est_etudiant|profil_etudiant/i);
  assert.doesNotMatch(appCode, /is_student|est_etudiant/i);
});

test("le registre de sources n'autorise aucun crawl ouvert", () => {
  assert.match(sql, /create table if not exists public\.offer_source_registry/);
  for (const colonne of ["base_url", "source_type", "zone_id", "audience_tags",
                         "active", "poll_interval", "etag", "last_modified",
                         "last_checked_at", "last_success_at", "parser_version", "status"])
    assert.ok(sql.includes(colonne), colonne);
  assert.match(sql, /check \(source_type in \('json','rss','html'\)\)/);
  /* ETag et Last-Modified sont réellement renvoyés à la source. */
  const col = sql.slice(sql.indexOf("function public.offres_collecter"));
  assert.match(col, /'If-None-Match', s\.etag/);
  assert.match(col, /'If-Modified-Since', s\.last_modified/);
  /* Une forme qu'on ne sait pas lire reste une erreur : deviner produirait
     des offres qui n'existent pas. */
  const vers = sql.slice(sql.indexOf("function public.offres_verser_collectes"));
  assert.match(vers, /parseur inconnu/);
  /* Et la collecte est bornée. */
  assert.match(col, /limit greatest\(coalesce\(p_max, 5\), 0\)/);
  /* La charge brute n'est conservée que si la source l'autorise. */
  assert.match(sql, /conserver_brut\s+boolean not null default false/);
  assert.match(vers, /case when s\.conserver_brut then it else null end/);
});

test("aucun modèle n'est la source canonique d'une offre", () => {
  assert.doesNotMatch(code, /gemini|openai|anthropic|llm/i);
  /* L'offre renvoie toujours vers la vraie page de l'organisme. */
  const pub = sql.slice(sql.indexOf("function public.offres_publiques"));
  assert.match(pub, /and o\.source_url is not null/);
  /* La source est passée du `<span>` à l'`<a>` : la carte n'est plus un seul
     lien vers le jeu de données, elle porte trois gestes distincts (voir où
     c'est, y aller, lire la source) et un lien ne peut pas en contenir un
     autre. Le lien vers l'organisme, lui, reste obligatoire — c'est ce qui
     rend l'offre vérifiable au lieu d'affirmée. */
  assert.match(app, /'<a class="of-source" href="'\+esc\(o\.source_url\)\+'" target="_blank" rel="noopener">'/);
  assert.match(app, /'↗ '\+esc\(o\.source_name\)\+'<\/a>'/);
});

test("les offres expirées ne sont pas montrées, et ne sont pas effacées", () => {
  /* Le déclencheur est redéfini par le correctif de zone : c'est la DERNIÈRE
     définition qui s'exécute, donc c'est elle qu'on interroge. */
  const trig = sql.slice(
    sql.lastIndexOf("create or replace function public.offers_avant_ecriture"));
  assert.match(trig, /if new\.ends_at is not null and new\.ends_at < now\(\) and new\.status = 'active' then\s*\n\s*new\.status := 'expired';/);
  const pub = sql.slice(sql.indexOf("function public.offres_publiques"));
  assert.match(pub, /where o\.status = 'active'/);
  assert.match(pub, /and \(o\.ends_at is null or o\.ends_at >= now\(\)\)/);
  assert.doesNotMatch(code, /delete from public\.offers/);
  /* Et la zone d'une offre vient du POINT, pas de la zone déclarée par la
     source : le jeu CROUS est national, le registre est déclaré sur `mel`. */
  assert.match(trig, /if new\.lat is not null and new\.lng is not null then\s*\n\s*new\.zone_id := public\.zone_autour_pour\(new\.lat, new\.lng\);/);
});

/* ---- E · L'état vide ---------------------------------------------------- */

test("sans offre réelle, rien n'est inventé", () => {
  const o = app.slice(app.indexOf("async function ouvrirBonsPlansEtudiants"));
  /* Le Lot 6 a resserré la condition : une offre dont la date de fin est
     passée ne compte plus comme une offre. « Pas d'offre » veut donc dire
     « aucune offre VIVANTE », ce qui est plus strict, pas moins. */
  assert.match(o, /const vivantes = \(offres \|\| \[\]\)\.filter\(offreEncoreValable\);/);
  assert.match(o, /if\(!vivantes\.length\)\{/);
  assert.match(o, /data-testid="offres-vide"/);
  assert.match(o, /Autour n’en invente pas/);
});

/* ---- F · La capsule ----------------------------------------------------- */

test("la capsule vient APRÈS les trois résultats, jamais dedans", () => {
  // les envies et la frise se glissent entre les résultats et la capsule
  assert.match(app,
    /capsuleTerritorialePanneau\(\)\+\s*\n\s*blocMaintenantAccueil\(\)\+blocCategoriesMaintenant\(\)\+\s*\n\s*blocPlusTardMaintenant\(\)\+blocCaPourraitTePlaire\(\)\+blocAideAccueil\(\);/);
  /* Elle est un bloc à part : elle ne peut pas prendre la place d'un
     résultat, parce qu'elle n'est pas dans la même liste. */
  const cap = app.slice(app.indexOf("function blocCaPourraitTePlaire"),
    app.indexOf("function brancherCapsulePlaire"));
  assert.match(cap, /<section class="cap-plaire" data-testid="capsule-plaire"/);
  assert.doesNotMatch(cap, /selectionMaintenant|MAINTENANT_APERCU|data-testid="maintenant-liste"/);
});

test("deux seuils, pas un : trois ouvertures ET deux sessions", () => {
  assert.match(app, /const SIGNAL_OUVERTURES_MIN = 3;/);
  assert.match(app, /const SIGNAL_SESSIONS_MIN = 2;/);
  const s = app.slice(app.indexOf("function sujetRecommandable"),
    app.indexOf("const SUJETS_CAPSULE"));
  assert.match(s, /if\(Number\(e\.ouvertures \|\| 0\) < SIGNAL_OUVERTURES_MIN\) return;/);
  assert.match(s, /e\.sessions\.length < SIGNAL_SESSIONS_MIN\) return;/);
  /* Les poids annoncés, tels quels. */
  assert.match(app, /categorie:1,/);
  assert.match(app, /fiche:2,/);
  assert.match(app, /favori:4,/);
  assert.match(app, /retour:2,/);
});

test("un intérêt s'oublie, et un refus ne se remonte pas tout seul", () => {
  assert.match(app, /const SIGNAL_DEMIVIE_MS = 21 \* 24 \* 3600 \* 1000;/);
  assert.match(app, /Math\.pow\(0\.5, age \/ SIGNAL_DEMIVIE_MS\)/);
  const noter = app.slice(app.indexOf("function noterSignalInteret"),
    app.indexOf("function oublierSignalInteret"));
  assert.match(noter, /if\(e\.refuse\) return;/);
  const oublier = app.slice(app.indexOf("function oublierSignalInteret"),
    app.indexOf("function sujetRecommandable"));
  assert.match(oublier, /refuse:true/);
});

test("le profil comportemental ne sait rien de la personne ni d'où elle est", () => {
  assert.match(app, /const CLE_SIGNAUX = "autour:interestSignals:v1";/);
  const sig = app.slice(app.indexOf("const CLE_SIGNAUX"),
    app.indexOf("const SUJETS_CAPSULE"));
  /* Aucune position n'entre dans ce profil. */
  assert.doesNotMatch(sig, /positionMoi|\b(lat|lng|latitude|longitude|coords?)\b/i);
  /* Aucune étiquette identitaire. */
  assert.doesNotMatch(sig, /is_student|etudiant|is_[a-z]+ *[:=] *true/i);
  /* Et la capsule dit d'où elle vient, sans jamais compter à voix haute. */
  assert.match(app, /Basé sur ce que tu explores dans Autour\./);
  /* Sur le CODE : un commentaire du moteur de scoring emploie la tournure,
     mais rien ne l'écrit à l'écran. C'est ce qui s'affiche qui compte. */
  assert.doesNotMatch(appCode, /tu as consulté|nous savons que/i);
  assert.doesNotMatch(html, /tu as consulté|nous savons que/i);
});

/* ---- G et J · Ce que le lot ne devait pas toucher ----------------------- */

test("Pour toi, Maintenant, la carte et la géolocalisation sont intacts", () => {
  /* Les goûts explicites restent le signal principal de Pour toi : rien de ce
     lot n'entre dans son classement. */
  const pourToi = app.slice(app.indexOf("function propositionsPourToi"),
    app.indexOf("function majPourToi"));
  assert.doesNotMatch(pourToi, /noterSignalInteret|sujetRecommandable|interestSignals/);
  assert.match(app, /interests: envies\.choisies\(\)/);
  /* Le sélecteur temporel n'a pas bougé. */
  assert.match(app, /CRENEAUX_VISIBLES\.map/);
  /* La règle des trois résultats, la géolocalisation du Lot 1, le bouton
     Créer et Solidarité non plus. */
  assert.match(app, /Math\.min\(3, max\)/);
  assert.match(app, /const positionConnue = \(\)=>originePosition !== null && originePosition !== "repli";/);
  assert.match(app, /\$\("#fbTitre"\)\.textContent = "❤️ Solidarité";/);
  assert.match(html, /<button id="fabCreer" type="button"/);
});

test("aucune donnée Google n'est persistée par ce lot", () => {
  assert.doesNotMatch(code, /google/i);
  assert.match(app, /function sansPhotoGoogle\(l\)\{/);
});

/* ---- Sécurité ----------------------------------------------------------- */

test("les offres se lisent, ne s'écrivent pas depuis le navigateur", () => {
  assert.match(sql, /alter table public\.offers\s+enable row level security/);
  assert.match(sql, /create policy "offres: lecture publique" on public\.offers/);
  assert.match(sql, /revoke all on public\.offers from anon, authenticated;/);
  assert.match(sql, /grant select on public\.offers to anon, authenticated;/);
  /* Provenances, registre et journal : fermés de bout en bout. */
  for (const t of ["offer_sources", "offer_source_registry", "offer_collectes"]) {
    assert.match(sql, new RegExp("revoke all on public\\." + t +
      "\\s+from anon, authenticated, public;"), t);
    assert.doesNotMatch(sql, new RegExp("grant select on public\\." + t + " to anon"), t);
  }
  /* L'ingestion et la collecte ne sont appelables que par le serveur. */
  for (const f of ["offres_ingerer", "offres_collecter", "offres_verser_collectes",
                   "offres_rattacher_aux_lieux"]) {
    assert.match(sql, new RegExp("revoke all on function public\\." + f +
      "[\\s\\S]{0,320}?from public, anon, authenticated"), f);
    assert.match(sql, new RegExp("grant execute on function public\\." + f +
      "[\\s\\S]{0,320}?to service_role"), f);
  }
  /* Les deux lectures publiques, elles, ne font que lire. */
  const lecture = sql.slice(sql.indexOf("function public.offres_publiques"),
    sql.indexOf("grant execute on function public.offres_publiques"));
  assert.doesNotMatch(lecture, /insert into|update |delete from/i);
});
