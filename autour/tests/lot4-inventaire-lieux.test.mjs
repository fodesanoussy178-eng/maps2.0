/* LOT 4 — L'INVENTAIRE PERSISTANT DES LIEUX
   ==========================================

   CE QUE CE FICHIER VÉRIFIE, ET CE QU'IL NE VÉRIFIE PAS

   Il vérifie ce qui est vérifiable sans base : la FORME des migrations, et
   surtout les promesses qu'elles portent — que rien d'OpenStreetMap ni de
   Google n'entre dans l'inventaire, que la clé d'enrichissement est reproduite
   à la lettre, que la logique territoriale est factorisée et non recopiée, que
   la table privée le reste, et que l'application actuelle n'est pas touchée.

   Il ne vérifie PAS le comportement en base : le rapprochement, les droits
   réels, l'idempotence d'une resynchronisation ne se démontrent que contre
   PostgreSQL. C'est le rôle de `supabase/tests/lot4_inventaire_lieux.sql`, qui
   s'exécute sur la vraie base et nettoie ses lignes.

   Le partage des rôles est le même que pour `migration_anonyme.sql` : ici la
   forme, là-bas le comportement. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { sourceApplication } from "./source.mjs";

const dossier = new URL("../supabase/migrations/", import.meta.url);
/* `lot4bis` contient aussi « lot4 » : sans cette exclusion, ce fichier lirait
   les migrations du lot suivant et prendrait ses garde-fous — « aucune image
   dont la source est google_places » — pour des violations de ses propres
   règles. Chaque lot vérifie ses migrations, pas celles des autres. */
const fichiers = (await readdir(dossier))
  .filter((f) => f.includes("lot4") && !f.includes("lot4bis"));
const migrations = Object.fromEntries(await Promise.all(
  fichiers.map(async (f) => [f, await readFile(new URL(f, dossier), "utf8")])));
const sql = Object.values(migrations).join("\n");
const source = await sourceApplication(import.meta.url);
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
/* `sourceApplication` ne concatène pas ces deux-là : ce sont pourtant eux que
   le lot promet de ne pas casser. On les lit donc directement. */
const images = await readFile(new URL("../images.js", import.meta.url), "utf8");
const enrichissements = await readFile(new URL("../enrichissements.js", import.meta.url), "utf8");
/* Les commentaires des migrations EXPLIQUENT ce qui est écarté ; ils citent
   donc `overpass`, `google` et `/api/lieux`. Les `comment on` en base font de
   même — c'est leur rôle. Les interdits portent sur le CODE qui s'exécute,
   pas sur le raisonnement qui l'accompagne. */
const code = sql
  .replace(/--[^\n]*/g, "")
  .replace(/comment on [\s\S]*?;\n/g, "");

/* ---- 1. Le périmètre des sources --------------------------------------- */

test("les trois migrations du lot existent", () => {
  assert.equal(fichiers.length, 3, "inventaire, ingestion, récolte : " + fichiers.join(", "));
  assert.ok(fichiers.some((f) => f.includes("inventaire")));
  assert.ok(fichiers.some((f) => f.includes("ingestion")));
  assert.ok(fichiers.some((f) => f.includes("datatourisme")));
});

test("rien d'OpenStreetMap n'entre dans l'inventaire", () => {
  /* Persister OSM ferait de `places` une base dérivée, avec l'obligation de
     partage à l'identique d'ODbL sur toute la base canonique. La décision
     n'est pas prise : rien n'est écrit. Overpass reste la source live qu'il
     est aujourd'hui, servie par `/api/lieux`, inchangée. */
  assert.doesNotMatch(code, /overpass/i);
  assert.doesNotMatch(code, /openstreetmap/i);
  assert.doesNotMatch(code, /'osm'/i);
  /* Et le relais Overpass n'est pas touché : aucune migration ne l'appelle. */
  assert.doesNotMatch(code, /api\/lieux/);
});

test("rien de Google n'entre dans l'inventaire, pas même un place_id", () => {
  assert.doesNotMatch(code, /google/i);
  /* `place_id` est notre propre colonne de jointure ; ce qui est interdit,
     c'est l'identifiant Google — sous quelque orthographe que ce soit. */
  assert.doesNotMatch(code, /google_place_id|googlePlaceId|place_id_google/i);
  /* La règle existait déjà côté client ; elle n'a pas bougé. */
  assert.match(app, /function sansPhotoGoogle\(l\)\{/);
  assert.match(app, /GOOGLE PLACES N'EST PAS UNE BIBLIOTHÈQUE PERMANENTE/);
});

test("l'identité est un UUID interne, jamais un identifiant de fournisseur", () => {
  assert.match(sql, /id\s+uuid primary key default gen_random_uuid\(\)/);
  /* Les identifiants externes vivent dans leur propre table, sous contrainte
     d'unicité — c'est le niveau 1 du rapprochement, et c'est tout ce qu'ils
     sont. */
  assert.match(sql, /create table if not exists public\.place_sources/);
  assert.match(sql, /unique \(source, external_id\)/);
});

/* ---- 2. Ce qui est réutilisé plutôt que réécrit ------------------------- */

test("la logique territoriale est factorisée, pas dupliquée", () => {
  /* Une seconde copie de la formule serait une seconde vérité : le jour où
     l'une bouge, un lieu et un événement au même endroit tomberaient dans
     deux zones différentes. */
  assert.match(sql, /create or replace function public\.zone_autour_pour/);
  /* `events_assigner_zone` appelle désormais la fonction commune au lieu de
     porter la formule. */
  const evt = sql.slice(sql.indexOf("function public.events_assigner_zone"),
    sql.indexOf("function public.place_nom_normalise"));
  assert.match(evt, /new\.zone_id := public\.zone_autour_pour\(new\.lat, new\.lng\);/);
  assert.doesNotMatch(evt, /6371 \* 2 \* asin/);
  /* Et le rattachement des lieux passe par la même porte. */
  assert.match(sql, /new\.zone_id := coalesce\(new\.zone_id, public\.zone_autour_pour\(new\.lat, new\.lng\)\)/);
});

test("aucune zone n'est créée par un lieu", () => {
  /* La fonction ne fait que CHERCHER dans les zones actives, dans leur rayon.
     Hors rayon elle rend NULL — et un lieu sans zone reste sans zone. C'est
     l'invariant du Lot 1, appliqué aux lieux. */
  const zone = sql.slice(sql.indexOf("function public.zone_autour_pour"),
    sql.indexOf("function public.events_assigner_zone"));
  assert.match(zone, /select z\.zone_id/);
  assert.doesNotMatch(zone, /insert into/i);
  assert.doesNotMatch(zone, /public\.territories/);
  assert.match(zone, /<= z\.radius_km/);
  /* Le rattachement est même contraint par une clé étrangère : une zone
     inventée ne peut pas être écrite. */
  assert.match(sql, /zone_id\s+text references public\.autour_zones\(zone_id\)/);
});

test("la clé d'enrichissement reproduit celle du client, à la lettre", () => {
  /* `place_enrichments` est indexée sur cette clé et sur rien d'autre. Une
     divergence d'un caractère ferait lire un cache que personne ne remplit. */
  const cle = sql.slice(sql.indexOf("function public.place_cle"),
    sql.indexOf("function public.place_dedup_key"));
  assert.match(cle, /'@' \|\| trim\(to_char\(round\(p_lat::numeric, 4\), 'FM9990\.0000'\)\)/);
  assert.match(cle, /replace\(public\.place_nom_normalise\(p_nom\), ' ', '-'\)/);
  /* Et le client, lui, n'a pas bougé : c'est la même règle des deux côtés. */
  assert.match(enrichissements, /return n\.replace\(\/ \/g, "-"\)\+"@"\+y\.toFixed\(4\)\+","\+x\.toFixed\(4\);/);
  /* Le pont est conservé pendant la transition, et il supporte le
     déplacement : un tableau, pas une colonne. */
  assert.match(sql, /place_keys\s+text\[\] not null default '\{\}'::text\[\]/);
});

/* ---- 3. Le rapprochement ------------------------------------------------ */

test("les deux niveaux de rapprochement, et le refus de trancher", () => {
  const ing = sql.slice(sql.indexOf("function public.places_ingerer"));
  /* Niveau 1 : l'identité externe exacte, sans heuristique. */
  assert.match(ing, /from public\.place_sources ps\s*\n\s*where ps\.source = p_source and ps\.external_id = p_external_id/);
  /* Niveau 2 : les trois signaux, exigés ENSEMBLE. */
  assert.match(ing, /p\.name_normalized = v_nom_norm/);
  assert.match(ing, /public\.commune_cle\(coalesce\(p\.commune, p\.city\)\) is not distinct from v_cle_com/);
  assert.match(ing, /ST_DWithin\(p\.geom::topology\.geography, v_point::topology\.geography, p_rayon_m\)/);
  /* Le doute ne fusionne pas : plusieurs candidats donnent une fiche à part,
     marquée, avec la liste de ceux qu'on n'a pas tranchés. */
  assert.match(ing, /v_statut := 'unresolved'; v_action := 'ambigu'/);
  assert.match(ing, /candidats_non_tranches/);
  assert.match(sql, /check \(match_status in \('exact','matched','probable','unresolved'\)\)/);
});

test("une resynchronisation n'écrase jamais une valeur connue par du vide", () => {
  const ing = sql.slice(sql.indexOf("function public.places_ingerer"));
  for (const colonne of ["address", "postal_code", "category", "description",
                         "opening_hours", "official_url"])
    assert.match(ing, new RegExp(colonne + "\\s+= coalesce\\("), colonne);
  /* Et l'image déjà connue se complète, elle ne se remplace pas par du vide. */
  assert.match(ing, /image_refs\s+= case when p_image_refs is null or p_image_refs = '\{\}'::jsonb\s*\n\s*then p\.image_refs/);
});

test("le semis ne fait pas un DISTINCT de noms", () => {
  /* 498 noms distincts ne font pas 498 lieux. Le regroupement s'appuie sur
     quatre signaux, pas sur le seul libellé. */
  const semis = sql.slice(sql.indexOf("function public.places_semer_depuis_events"));
  assert.doesNotMatch(semis, /select distinct\s+.*place_name/i);
  assert.match(semis, /public\.place_nom_normalise\(nom\) as nom_norm/);
  assert.match(semis, /public\.commune_cle\(coalesce\(commune, city\)\) as cle_commune/);
  assert.match(semis, /round\(lat::numeric, 3\) as lat3/);
  assert.match(semis, /round\(lng::numeric, 3\) as lng3/);
  assert.match(semis, /group by 1, 2, 3, 4/);
  /* L'identifiant du groupe est stable : rejouer le semis ne crée rien. */
  assert.match(semis, /p_external_id => c\.nom_norm \|\| '\|' \|\| coalesce\(c\.cle_commune, ''\)/);
});

test("l'affiche d'un événement ne devient pas la photo d'un lieu", () => {
  /* `events.image_url` est l'affiche d'un concert, pas une vue de la salle.
     La recopier illustrerait un lieu avec l'image d'autre chose — exactement
     ce que le Lot 3 interdit. Le semis ne lit donc ni image ni description. */
  const semis = sql.slice(sql.indexOf("function public.places_semer_depuis_events"),
    sql.indexOf("function public.lieux_locaux"));
  assert.doesNotMatch(semis, /image/i);
  assert.doesNotMatch(semis, /p_description/);
  assert.doesNotMatch(semis, /p_categorie/);
});

/* ---- 4. Les images ------------------------------------------------------ */

test("on stocke les entrées du résolveur, pas seulement sa sortie", () => {
  /* `images.js` ne lit pas une URL toute faite : il part des tags portés par
     l'objet et remonte jusqu'à une licence lisible. Garder la seule URL
     finale ferait perdre la traçabilité. */
  assert.match(sql, /image_refs\s+jsonb not null default '\{\}'::jsonb/);
  for (const colonne of ["image_url", "image_source", "image_source_url",
                         "image_author", "image_license", "image_updated_at"])
    assert.ok(sql.includes(colonne), colonne);
  /* Le résolveur lui-même n'est pas touché. */
  assert.match(images, /LE RÉSOLVEUR D'IMAGE\. UN SEUL, POUR TOUT AUTOUR\./);
  assert.match(images, /RIEN N'EST RECOPIÉ\./);
});

test("la récolte n'invente aucune image et n'en réhéberge aucune", () => {
  const rec = sql.slice(sql.indexOf("function public.places_verser_datatourisme"));
  /* Sans image lisible dans la réponse, la colonne reste vide. */
  assert.match(rec, /when nullif\(btrim\(coalesce\(it->>'image',''\)\), ''\) is null\s*\n\s*then '\{\}'::jsonb/);
  /* Rien n'est téléchargé : on référence l'URL rendue par la route, telle
     qu'elle est, avec sa provenance. */
  assert.doesNotMatch(rec, /storage|upload|bytea|decode\(/i);
});

/* ---- 5. La sécurité ----------------------------------------------------- */

test("places est en lecture seule pour le navigateur, place_sources est fermée", () => {
  assert.match(sql, /alter table public\.places enable row level security/);
  assert.match(sql, /alter table public\.place_sources enable row level security/);
  assert.match(sql, /create policy "lieux: lecture publique" on public\.places\s*\n\s*for select using \(true\)/);
  /* Les grants d'écriture sont RÉVOQUÉS, pas seulement laissés sans policy :
     une ACL qui dit le contraire de la vérité est ce que le Lot S a corrigé
     partout ailleurs. */
  assert.match(sql, /revoke all on public\.places from anon, authenticated;/);
  assert.match(sql, /grant select on public\.places to anon, authenticated;/);
  /* La table de provenance n'est ni lisible ni modifiable depuis le client. */
  assert.match(sql, /revoke all on public\.place_sources from anon, authenticated, public;/);
  assert.doesNotMatch(sql, /grant select on public\.place_sources to anon/);
  assert.doesNotMatch(sql, /policy[^\n]*on public\.place_sources/);
});

test("l'ingestion n'est appelable que par la couche serveur", () => {
  for (const fonction of ["places_ingerer", "places_semer_depuis_events",
                          "places_recolter_datatourisme", "places_verser_datatourisme"]) {
    assert.match(sql, new RegExp("revoke all on function public\\." + fonction +
      "[\\s\\S]{0,240}?from public, anon, authenticated"), fonction + " : révocation");
    assert.match(sql, new RegExp("grant execute on function public\\." + fonction +
      "[\\s\\S]{0,240}?to service_role"), fonction + " : service_role");
  }
  /* La seule fonction ouverte au navigateur est une lecture. */
  assert.match(sql, /grant execute on function public\.lieux_locaux\([\s\S]*?\) to anon, authenticated, service_role/);
  const lecture = sql.slice(sql.indexOf("function public.lieux_locaux"));
  assert.doesNotMatch(lecture, /insert into|update |delete from/i);
});

/* ---- 6. Ce que le lot ne devait pas toucher ----------------------------- */

test("l'application du Lot 3 et ses moteurs sont intacts", () => {
  /* Aucune migration ne touche à l'interface. */
  assert.doesNotMatch(sql, /navBas|selecteurSurface|fabCreer|explorerDecouverte/);
  /* Le relais Overpass reste ce qu'il est : sans état, sans base. */
  assert.doesNotMatch(sql, /create table[^\n]*overpass/i);
  /* Et les moteurs que ce lot ne devait pas approcher n'ont pas bougé. */
  assert.match(app, /const CRENEAUX = \[/);
  assert.match(source, /Math\.min\(3, max\)/);
  assert.match(app, /const positionConnue = \(\)=>originePosition !== null && originePosition !== "repli";/);
  /* Aucune taxonomie n'est réécrite : la catégorie ingérée est celle que la
     route rend déjà, dans le vocabulaire d'Autour. */
  assert.doesNotMatch(sql, /create table[^\n]*categor/i);
});
