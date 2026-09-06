/* LOT 6 — LA QUALITÉ DE L'INVENTAIRE, ET CE QU'ELLE REFUSE DE DIRE
   ================================================================

   Quatre promesses tiennent ce lot, et ce sont elles qui sont verrouillées
   ici :

   · Une affiche d'événement ne devient JAMAIS une photo de lieu. Le seul
     chemin vers `place_photo` passe par Wikidata + Commons, avec licence.
   · Un lieu sans horaire est `inconnu`. Jamais `ouvert`.
   · Explorer répond à une intention. Il ne déroule pas un annuaire, et il
     n'abandonne pas le runtime quand la base ne suffit pas.
   · Mobile et desktop empruntent LE MÊME chemin de données. Il n'existe
     aucune branche de largeur entre la position et la requête.

   Le comportement en base — droits, expiration, péremption, rapprochement —
   est démontré par `supabase/tests/lot6_qualite.sql`, qui s'exécute sur la
   vraie base. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const dossier = new URL("../supabase/migrations/", import.meta.url);
const fichiers = (await readdir(dossier)).filter((f) => f.includes("lot6"));
const sql = (await Promise.all(
  fichiers.map((f) => readFile(new URL(f, dossier), "utf8")))).join("\n");
const code = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const route = await readFile(new URL("../api/datatourisme.js", import.meta.url), "utf8");

/* ---- 1 · Parité mobile / desktop ---------------------------------------- */

test("le chemin de données d'Explorer ne connaît pas la largeur de l'écran", () => {
  /* La preuve empirique est dans `docs/lot6-audit-explorer.md` : mêmes
     arguments, mêmes identités, même ordre à 390, 430, 834 et 1280. Ce test
     verrouille la CAUSE de cette parité — il n'existe aucune branche de
     largeur entre le contexte et la requête. */
  const lecture = appCode.slice(appCode.indexOf("async function chargerLieuxExplorer"),
    appCode.indexOf("function visuelLieuExplorer"));
  assert.doesNotMatch(lecture, /innerWidth|matchMedia|estMobilePerformance|dataset\.layout/);
  const offres = appCode.slice(appCode.indexOf("async function chargerOffres"),
    appCode.indexOf("const NATURE_OFFRE"));
  assert.doesNotMatch(offres, /innerWidth|matchMedia|estMobilePerformance|dataset\.layout/);
  /* Le contexte vient de deux fonctions qui ne connaissent que la position et
     la zone. */
  assert.match(lecture, /p_zone_id:idZoneActive\(\)/);
  assert.match(lecture, /const ref = pointDeReference\(\);/);
});

/* ---- 2 et 4 · Les images disent ce qu'elles sont ------------------------ */

test("aucune affiche d'événement n'est promue en photo de lieu", () => {
  /* Le SEUL endroit qui écrit `place_photo` est le versement Commons. */
  /* On compte les ÉCRITURES (une affectation dans un SET, donc suivie d'une
     virgule), pas les lectures du classement ou des vues de mesure. */
  const ecritures = code.match(/image_type\s+=\s+'place_photo',/g) || [];
  assert.equal(ecritures.length, 1, "un seul chemin doit écrire place_photo");
  const verser = sql.slice(sql.indexOf("function public.places_verser_commons"),
    sql.indexOf("revoke all on function public.places_verser_commons"));
  assert.match(verser, /image_type\s*=\s*'place_photo'/);
  /* Et la restauration d'une image d'origine la remet en `event_poster`,
     jamais en photo de lieu. */
  const restaurer = sql.slice(sql.indexOf("function public.places_restaurer_image_depuis_refs"),
    sql.indexOf("revoke all on function public.places_restaurer_image_depuis_refs"));
  assert.match(restaurer, /image_type\s*=\s*'event_poster'/);
  assert.doesNotMatch(restaurer, /place_photo/);
  /* Côté client, l'échelle met l'affiche en dernier et la DIT. */
  assert.match(app, /\{place_photo:1, wikimedia:2, institutional:3, event_poster:4\}/);
  assert.match(app, /l\.image_type === "event_poster"[\s\S]{0,160}Affiche d’un événement ici/);
});

test("une image sans licence n'est jamais écrite, ni jamais affichée", () => {
  const verser = sql.slice(sql.indexOf("function public.places_verser_commons"),
    sql.indexOf("revoke all on function public.places_verser_commons"));
  assert.match(verser, /or v_lic is null then/);
  assert.match(verser, /aucune licence lisible chez Commons/);
  /* La restauration exige aussi une licence. */
  const restaurer = sql.slice(sql.indexOf("function public.places_restaurer_image_depuis_refs"),
    sql.indexOf("revoke all on function public.places_restaurer_image_depuis_refs"));
  assert.match(restaurer, /image_license[\s\S]{0,20}is not null/);
  /* Et le client refuse d'afficher ce qui n'a pas de licence. */
  assert.match(app, /const utilisable = !!l\.image_url && rang > 0 && !!l\.image_license;/);
});

test("l'attribution voyage avec la photo, et s'affiche", () => {
  const verser = sql.slice(sql.indexOf("function public.places_verser_commons"),
    sql.indexOf("revoke all on function public.places_verser_commons"));
  /* La référence structurée porte tout ce qu'une attribution exige. */
  for (const champ of ["'url'", "'source'", "'type'", "'reference'", "'author'",
                       "'credit'", "'license'", "'license_url'",
                       "'attribution_required'", "'page'", "'retrieved_at'"])
    assert.ok(verser.includes(champ), champ);
  /* Et la vignette cite l'auteur d'une vraie photo. */
  assert.match(app, /l\.image_type === "place_photo" && l\.image_author[\s\S]{0,80}'<b>© '/);
});

test("aucune donnée Google n'entre dans ce lot", () => {
  /* Le mot n'apparaît qu'à UN endroit, et c'est une exclusion : la
     restauration refuse de remettre une image Google que le passé aurait
     laissée dans `image_refs`. */
  const mentions = code.match(/google/ig) || [];
  assert.equal(mentions.length, 1, "une seule mention, et c'est un refus");
  const restaurer = sql.slice(sql.indexOf("function public.places_restaurer_image_depuis_refs"));
  assert.match(restaurer, /<> 'google_places'/);
  /* Aucune écriture ne pose une image de source Google. */
  assert.doesNotMatch(code, /image_source\s*=\s*'google/i);
});

test("un lieu sans photo licite retombe proprement sur sa famille", () => {
  const v = app.slice(app.indexOf("function visuelLieuExplorer"),
    app.indexOf("const FAMILLES_EXPLORER"));
  /* La tuile de famille est POSÉE d'abord ; l'image vient dessus. Sans image,
     il reste un pictogramme, jamais un cadre vide. */
  assert.match(v, /<span class="xp-lieu-photo"[\s\S]{0,140}<i>'\+emoji\+'<\/i>/);
  assert.match(v, /const emoji = \(FAMILLES_EXPLORER\[l\.family\] \|\| \{\}\)\.emoji \|\| "📍";/);
  /* Et une image qui ne charge pas emporte sa légende avec elle. */
  assert.match(v, /onerror="var m=this\.parentNode\.querySelector\(\\'b\\'\);if\(m\)m\.remove\(\);this\.remove\(\)"/);
});

test("le rapprochement d'une photo refuse le doute, la commune et le milieu de chaîne", () => {
  const f = sql.slice(sql.indexOf("function public.places_verser_wikidata"),
    sql.indexOf("revoke all on function public.places_verser_wikidata"));
  /* Le nom de la commune n'est pas le nom du lieu. */
  assert.match(f, /if v_commune is not null and v_lab = v_commune then continue; end if;/);
  /* Un préfixe, pas une occurrence au milieu. */
  assert.match(f, /v_lab like v_nom \|\| ' %'/);
  assert.match(f, /v_nom like v_lab \|\| ' %'/);
  assert.doesNotMatch(f, /position\(v_nom in v_lab\)/);
  /* Deux candidats équivalents : on ne tranche pas. */
  assert.match(f, /deux candidats au même niveau : on ne tranche pas/);
});

/* ---- 6 et 7 · Les horaires --------------------------------------------- */

test("une absence d'horaire rend « inconnu », jamais « ouvert »", () => {
  const etat = sql.slice(sql.indexOf("function public.horaires_etat"),
    sql.indexOf("comment on function public.horaires_etat"));
  assert.match(etat, /if not coalesce\(\(a ->> 'reconnu'\)::boolean, false\) then\s*\n\s*return query select 'inconnu'/);
  const analyse = sql.slice(sql.indexOf("function public.horaires_analyser"),
    sql.indexOf("comment on function public.horaires_analyser"));
  assert.match(analyse, /if v_txt = '' then return jsonb_build_object\('reconnu', false/);
  /* Une seule règle incomprise invalide TOUT l'horaire : on ne garde jamais
     la moitié d'une information d'ouverture. */
  assert.match(analyse, /'reconnu', false, 'motif', 'sélecteur de jours illisible/);
  assert.match(analyse, /'reconnu', false, 'motif', 'plage illisible/);
  /* Et rien, nulle part, ne déclare un lieu ouvert par défaut. */
  assert.doesNotMatch(code, /open_now\s*=\s*true|etat\s*:=\s*'ouvert'\s*;/i);
});

test("une plage qui passe minuit est comprise des deux côtés", () => {
  const etat = sql.slice(sql.indexOf("function public.horaires_etat"),
    sql.indexOf("comment on function public.horaires_etat"));
  /* La plage de la veille qui déborde sur aujourd'hui est explicitement
     cherchée : sans elle, un bar ouvert jusqu'à 2 h serait « fermé » à 1 h. */
  assert.match(etat, /r -> 'jours' @> to_jsonb\(v_veille\)/);
  assert.match(etat, /date_trunc\('day', v_local\) - interval '1 day' \+ v_deb/);
  /* Et `24:00` est minuit du jour suivant, pas 23:59. */
  assert.match(etat, /date_trunc\('day', v_local\) \+ interval '1 day'\) at time zone v_tz;/);
});

test("un horaire écrit en français n'est transcrit que s'il est entièrement lu", () => {
  const t = sql.slice(sql.indexOf("function public.horaires_depuis_texte_fr"),
    sql.indexOf("comment on function public.horaires_depuis_texte_fr"));
  /* LA GARDE : s'il reste une expression horaire non transcrite, on refuse
     tout. Sinon un lieu serait annoncé fermé alors qu'il ouvre. */
  assert.match(t, /if v_reste ~ '\\d\\s\*h' then return null; end if;/);
  /* Et un horaire sans jour n'est pas complété par une supposition. */
  assert.match(t, /if array_length\(v_out, 1\) is null then return null; end if;/);
});

test("aucun horaire produit par un modèle n'alimente l'inventaire", () => {
  /* `place_enrichments` contient 44 lignes, toutes produites par un modèle et
     toutes expirées. Aucune migration du lot ne la lit. */
  assert.doesNotMatch(code, /place_enrichments/);
  assert.doesNotMatch(code, /gemini|openai|anthropic|llm/i);
});

/* ---- 5 · Explorer répond à une intention -------------------------------- */

test("Explorer demande des familles, pas un catalogue", () => {
  assert.match(app, /const FAMILLES_DECOUVERTE = Object\.freeze\(/);
  /* La restauration et l'hébergement ne sont pas des intentions de découverte :
     sans cette liste, le centre-ville rendait six restaurants et deux hôtels. */
  for (const f of ["culture", "bibliotheque", "nature", "patrimoine",
                   "musique", "cinema", "sport", "marche"])
    assert.match(app, new RegExp('"' + f + '"'), f);
  const decouverte = app.slice(app.indexOf("const FAMILLES_DECOUVERTE"),
    app.indexOf("const LIEUX_PAR_FAMILLE"));
  assert.doesNotMatch(decouverte, /restauration|hebergement|commerce/);
  /* Un plafond par famille, sinon la plus dense mange la réponse. */
  assert.match(app, /const LIEUX_PAR_FAMILLE = 2;/);
  /* Et le plafond ne s'applique QUE dans un mélange : appliqué à une intention
     d'une seule famille, il ramenait deux lieux, donc moins que le seuil
     d'affichage, et « Nature » ne montrait jamais rien. */
  assert.match(app, /p_par_famille:\(familles && familles\.length > 1\)\s*\n\s*\? \(i\.parFamille \|\| LIEUX_PAR_FAMILLE\) : null,/);
  /* Et la base sait plafonner par famille. */
  const porte = sql.slice(sql.indexOf("create or replace function public.lieux_explorer"),
    sql.indexOf("grant execute on function public.lieux_explorer"));
  assert.match(porte, /partition by c\.family/);
  assert.match(porte, /r\.rang_dans_famille <= greatest\(p_par_famille, 1\)/);
});

test("l'ordre met la vraie photo devant l'affiche, mais le proche devant le lointain", () => {
  const porte = sql.slice(sql.indexOf("create or replace function public.lieux_explorer"),
    sql.indexOf("grant execute on function public.lieux_explorer"));
  assert.match(porte, /when p\.image_type = 'place_photo'\s+then 1/);
  assert.match(porte, /when p\.image_type = 'event_poster'\s+then 4/);
  /* Une image sans licence est hors concours. */
  assert.match(porte, /image_license,''\)\),''\) is null then 9/);
  /* Et la qualité ne fait pas remonter un lieu à 16 km devant un lieu à 800 m. */
  assert.match(porte, /\) as proche/);
  assert.match(porte, /order by c\.proche desc, c\.image_rang/);
});

test("une intention survit à la fermeture du panneau", () => {
  assert.match(app, /let intentionExplorer = null;/);
  const lancer = app.slice(app.indexOf("function lancerDepuisExplorer"),
    app.indexOf("let explorerDecouverteRemplie"));
  assert.match(lancer, /intentionExplorer = \{familles:entree\.familles,/);
  /* Et ré-ouvrir Explorer la rejoue. */
  const ouvrir = app.slice(app.indexOf("function ouvrirExplorerDecouverte"),
    app.indexOf("function fermerExplorerDecouverte"));
  assert.match(ouvrir, /remplirLieuxExplorer\(intentionExplorer\)/);
});

/* ---- 17 · Le runtime reste le filet ------------------------------------- */

test("Explorer garde son repli runtime quand la base ne suffit pas", () => {
  assert.match(app, /const LIEUX_EXPLORER_MIN = 3;/);
  const rempl = app.slice(app.indexOf("async function remplirLieuxExplorer"),
    app.indexOf("function ouvrirFamilleExplorer"));
  assert.match(rempl, /if\(lieux2\.length < LIEUX_EXPLORER_MIN\)\{/);
  assert.match(rempl, /zone\.hidden = true; titre\.hidden = true/);
  /* Aucune source n'est retirée. */
  assert.match(app, /async function overpassRelaye\(q, msMax, signal\)\{/);
  assert.match(app, /PERF\.requete\("datatourisme"\)/);
  assert.match(app, /PERF\.requete\("google_places"\)/);
  assert.match(app, /dernierRecoursExplorer = lus\.length >= LIEUX_EXPLORER_MIN \? "places" : "runtime"/);
});

/* ---- 6 · Les offres répondent aux sept questions ------------------------ */

test("une carte d'offre dit ce qu'elle sait, et tait ce qu'elle ignore", () => {
  const c = appCode.slice(appCode.indexOf("function carteOffre"),
    appCode.indexOf("function heureCourte"));
  /* quoi · où · distance · pour qui · conditions · jusqu'à quand · source */
  assert.match(c, /of-titre/);  assert.match(c, /of-lieu/);
  assert.match(c, /formatDist/); assert.match(c, /of-public/);
  assert.match(c, /of-condition/); assert.match(c, /of-fin/);
  assert.match(c, /of-source/);
  /* « inconnu » ne s'écrit pas : une ligne « horaires inconnus » n'apprend
     rien et prend la place d'une information vraie. */
  assert.match(c, /o\.etat_horaire === "ouvert"/);
  assert.match(c, /o\.etat_horaire === "ferme"/);
  assert.doesNotMatch(c, /inconnu/);
  /* L'étiquette décrit l'offre, jamais la personne. */
  assert.match(app, /const PUBLIC_OFFRE = Object\.freeze\(\{\s*\n\s*student:"Étudiants"/);
  assert.doesNotMatch(appCode, /is_student|est_etudiant/i);
});

/* ---- Ce que le lot ne devait pas toucher -------------------------------- */

test("Maintenant, Pour toi, Solidarité, les zones et la carte sont intacts", () => {
  /* La règle des trois résultats. */
  assert.match(app, /Math\.min\(3, max\)/);
  /* L'ordre des onglets temporels. */
  assert.match(app, /CRENEAUX_VISIBLES\.map/);
  /* Les goûts explicites restent le signal principal de Pour toi. */
  assert.match(app, /interests: envies\.choisies\(\)/);
  const pourToi = app.slice(app.indexOf("function propositionsPourToi"),
    app.indexOf("function majPourToi"));
  assert.doesNotMatch(pourToi, /lieux_explorer|FAMILLES_DECOUVERTE|intentionExplorer/);
  /* La géolocalisation du Lot 1, Solidarité et le bouton Créer. */
  assert.match(app, /const positionConnue = \(\)=>originePosition !== null && originePosition !== "repli";/);
  assert.match(app, /\$\("#fbTitre"\)\.textContent = "❤️ Solidarité";/);
  assert.match(html, /<button id="fabCreer" type="button"/);
  /* Et « Maintenant » n'appelle toujours pas la porte de l'inventaire. */
  const maintenant = app.slice(app.indexOf("function blocMaintenantAccueil"),
    app.indexOf("function blocCaPourraitTePlaire"));
  assert.doesNotMatch(maintenant, /lieux_explorer|chargerLieuxExplorer/);
});

test("aucune migration du lot ne crée de territoire", () => {
  assert.doesNotMatch(code, /insert into public\.territories/i);
  assert.doesNotMatch(code, /insert into public\.autour_zones/i);
  /* Le rattachement territorial passe par la porte qui ne fait que chercher. */
  assert.doesNotMatch(code, /create .*zone/i);
});

/* ---- 15 et 16 · Les droits ---------------------------------------------- */

test("les tables internes du lot sont fermées au navigateur", () => {
  for (const t of ["place_image_candidats", "offer_peremption"]) {
    assert.match(sql, new RegExp("alter table public\\." + t + "\\s+enable row level security"), t);
    assert.match(sql, new RegExp("revoke all on public\\." + t +
      "\\s+from anon, authenticated, public;"), t);
    assert.doesNotMatch(sql, new RegExp("grant select on public\\." + t + " to anon"), t);
  }
  /* Les vues de mesure aussi : elles disent la géographie de la base. */
  for (const v of ["places_photos_qualite", "places_horaires_qualite",
                   "offres_fraicheur_qualite"]) {
    assert.match(sql, new RegExp("revoke all on public\\." + v +
      " from anon, authenticated, public;"), v);
    assert.match(sql, new RegExp("grant select on public\\." + v + " to service_role;"), v);
  }
});

test("l'ingestion reste au serveur, la lecture reste publique", () => {
  for (const f of ["places_recolter_wikidata", "places_verser_wikidata",
                   "places_recolter_commons", "places_verser_commons",
                   "places_restaurer_image_depuis_refs", "places_poser_horaires",
                   "offres_rattacher_aux_lieux", "offres_appliquer_fraicheur",
                   "offres_constater_absences", "places_rapprocher_prefixes",
                   "horaires_depuis_texte_fr"]) {
    assert.match(sql, new RegExp("revoke all on function public\\." + f +
      "[\\s\\S]{0,200}?from public, anon, authenticated"), f);
    assert.match(sql, new RegExp("grant execute on function public\\." + f +
      "[\\s\\S]{0,200}?to service_role"), f);
  }
  /* Ce que le navigateur DOIT pouvoir appeler. */
  assert.match(sql, /grant execute on function public\.lieux_explorer\([\s\S]{0,200}?to anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.horaires_etat\([\s\S]{0,140}?\n?\s*to anon, authenticated, service_role/);
});

/* ---- La route DATAtourisme --------------------------------------------- */

test("la route demande les sous-champs, pas seulement la référence", () => {
  /* Mesuré avant le lot : 0 horaire sur 49 POI réels, alors que le
     convertisseur savait les lire. On demandait l'objet sans ses champs. */
  for (const champ of ["isLocatedAt.openingHoursSpecification.opens",
                       "isLocatedAt.openingHoursSpecification.closes",
                       "isLocatedAt.openingHoursSpecification.dayOfWeek",
                       "hasMainRepresentation.hasCredits"])
    assert.ok(route.includes(champ), champ);
  /* La porte de licence reste fermée à ce qui n'est pas explicitement libre. */
  assert.match(route, /creativecommons\\\.org\|\\bcc\[- \]\?by\\b/);
});
