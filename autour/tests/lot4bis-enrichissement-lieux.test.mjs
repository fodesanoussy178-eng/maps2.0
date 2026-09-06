/* LOT 4-BIS — RENDRE L'INVENTAIRE EXPLOITABLE
   ============================================

   Comme pour le Lot 4, ce fichier vérifie la FORME et les promesses ; le
   comportement en base est démontré par
   `supabase/tests/lot4bis_enrichissement_lieux.sql`, qui s'exécute sur la
   vraie base avec des exemples métropolitains réels.

   Ce qui est verrouillé ici : que la taxonomie ne devine pas, que les rayons
   viennent de `core.js` et non d'une valeur inventée, qu'aucune image ne soit
   fabriquée ni maquillée, qu'aucun horaire ne soit extrapolé, que la récolte
   reste bornée et rejouable, et que rien de tout cela n'ouvre une porte au
   navigateur. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const dossier = new URL("../supabase/migrations/", import.meta.url);
const fichiers = (await readdir(dossier)).filter((f) => f.includes("lot4bis"));
const sql = (await Promise.all(
  fichiers.map((f) => readFile(new URL(f, dossier), "utf8")))).join("\n");
/* Les commentaires expliquent ce qui est écarté et citent donc `google`,
   `overpass`, `wikimedia`. Les interdits portent sur le code exécuté. */
const code = sql.replace(/--[^\n]*/g, "").replace(/comment on [\s\S]*?;\n/g, "");
const core = await readFile(new URL("../core.js", import.meta.url), "utf8");
const images = await readFile(new URL("../images.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

/* ---- 1. La taxonomie ---------------------------------------------------- */

test("les familles couvrent ce qu'Explorer devra savoir ranger", () => {
  assert.match(sql, /create table if not exists public\.place_familles/);
  for (const famille of ["culture", "bibliotheque", "cinema", "musique",
                         "patrimoine", "nature", "sport", "marche",
                         "restauration", "commerce", "association",
                         "solidarite", "hebergement"])
    assert.match(sql, new RegExp("\\('" + famille + "',"), famille);
  /* La famille est une colonne à part : la catégorie du fournisseur reste à
     côté, telle qu'elle est arrivée. On ne perd pas la donnée d'origine. */
  assert.match(sql, /add column if not exists family text references public\.place_familles\(famille\)/);
});

test("la classification s'appuie sur des types déclarés, jamais sur une intuition", () => {
  /* Les types schema.org viennent du producteur de la donnée : les traduire
     n'est pas les interpréter. */
  const parType = sql.slice(sql.indexOf("function public.place_famille_depuis_types"),
    sql.indexOf("function public.place_famille_depuis_nom"));
  assert.match(parType, /Museum\|CulturalSite/);
  assert.match(parType, /else null/);

  /* Le nom ne parle que lorsqu'il ÉNONCE le type, et seulement en tête. */
  const parNom = sql.slice(sql.indexOf("function public.place_famille_depuis_nom"),
    sql.indexOf("function public.places_classer"));
  assert.match(parNom, /'\^ \(mediatheque\|bibliotheque\|ludotheque\) '/);
  assert.match(parNom, /else null/);
  /* Les mots passe-partout sont délibérément absents : « centre », « maison »
     et « espace » ouvrent la porte à tout et à son contraire. */
  for (const passePartout of ["'^ (centre)", "'^ (maison)", "'^ (espace)", "'^ (salle)"])
    assert.ok(!parNom.includes(passePartout), passePartout + " ne doit pas classer");
});

/* ---- 2. Les images ------------------------------------------------------ */

test("aucune image n'est fabriquée, aucune n'est maquillée", () => {
  const im = sql.slice(sql.indexOf("function public.places_images_depuis_evenements"));
  /* Ce qui est repris est l'affiche d'un événement DU LIEU, et c'est dit :
     `images.js` porte déjà ce vocabulaire et le rendu sait le distinguer
     d'une photo du lieu. */
  assert.match(im, /image_type\s+= 'event_poster'/);
  assert.match(images, /Une image d'événement n'est pas une image de lieu/);
  assert.match(images, /"event_poster", "artist", "organizer", "venue"/);
  /* Une image sans licence lisible n'entre pas — la règle que le résolveur
     applique déjà à Wikimedia vaut ici aussi. */
  assert.match(im, /nullif\(btrim\(coalesce\(e\.image_license, ''\)\), ''\) is not null/);
  /* Aucune image Google, exigé explicitement plutôt que supposé. */
  assert.match(im, /coalesce\(e\.image_source, ''\) <> 'google_places'/);
  /* Rien n'est réhébergé ni recomposé : on référence l'URL de l'événement. */
  assert.doesNotMatch(im, /storage|upload|bytea|decode\(|concat\('https/i);
  /* `image_refs` garde de quoi refaire le calcul : quel événement, quelle
     source, quelle page, quelle licence. */
  assert.match(im, /'origine', 'evenement_du_lieu'/);
  assert.match(im, /'image_source_url', c\.image_source_url/);
});

test("le résolveur d'images et sa politique de licences ne sont pas touchés", () => {
  assert.match(images, /LE RÉSOLVEUR D'IMAGE\. UN SEUL, POUR TOUT AUTOUR\./);
  assert.match(images, /RIEN N'EST RECOPIÉ\./);
  assert.match(images, /AUCUNE IMAGE GÉNÉRÉE\./);
  assert.match(app, /function sansPhotoGoogle\(l\)\{/);
});

/* ---- 3. Les horaires ---------------------------------------------------- */

test("les horaires ne viennent que d'une source qui en donne", () => {
  /* La seule reprise d'horaires passe par `place_enrichments`, avec un seuil
     de confiance, et ne remplace jamais une valeur déjà connue. */
  const en = sql.slice(sql.indexOf("function public.places_enrichir_depuis_cache"));
  assert.match(en, /pe\.confidence >= p_confiance_min/);
  assert.match(en, /opening_hours = coalesce\(p\.opening_hours,/);
  /* Rien n'extrapole : aucune génération, aucune règle « ouvert en général ». */
  assert.doesNotMatch(code, /generate_series[\s\S]{0,80}opening_hours/i);
  assert.doesNotMatch(code, /'Mo-Su|lun-dim|ouvert tous les jours/i);
});

/* ---- 4. Le rayon dépend de la famille ----------------------------------- */

test("les deux rayons sont ceux de core.js, pas des valeurs inventées", () => {
  assert.match(sql, /then 400\.0/);
  assert.match(sql, /else 120\.0/);
  /* La preuve que ce sont bien les siennes. */
  assert.match(core, /nomme: 120,\s+\/\/ deux relevés du même commerce/);
  assert.match(core, /nommeEtendu: 400,\s+\/\/ deux morceaux du même parc/);
  /* Et les familles étendues sont celles de sa propre liste. */
  assert.match(core, /SPREAD_CATEGORIES = Object\.freeze\(\["parc", "park", "terrain", "sport",/);
  assert.match(sql, /\('nature',\s+'Parcs et nature',\s+true/);
  assert.match(sql, /\('sport',\s+'Sport',\s+true/);
  assert.match(sql, /\('marche',\s+'Marchés',\s+true/);
  assert.match(sql, /\('restauration',\s+'Restaurants et cafés',\s+false/);
});

test("le rayon retenu est le plus grand des deux objets comparés", () => {
  /* Si l'un des deux est un parc, l'autre est un morceau du même parc :
     prendre le plus petit rayon couperait le parc en deux. */
  assert.match(sql, /greatest\(v_rayon, public\.place_rayon_rapprochement\(p\.family\)\)/);
  /* Et le rattrapage rejoue la même règle sur les lieux entrés avant elle,
     sans rien supprimer : le doublon devient un satellite. */
  const rap = sql.slice(sql.indexOf("function public.places_rapprocher_doublons"));
  assert.match(rap, /set duplicate_of = d\.maitre, match_status = 'matched'/);
  assert.doesNotMatch(rap, /delete from public\.places/);
  assert.match(rap, /\(a\.created_at, a\.id\) < \(b\.created_at, b\.id\)/);
});

/* ---- 5. La récolte ------------------------------------------------------ */

test("la récolte de la métropole est bornée, reprenable et rejouable", () => {
  const rec = sql.slice(sql.indexOf("function public.places_recolter_mel"));
  /* Bornée : un maximum d'appels par exécution. */
  assert.match(rec, /limit greatest\(coalesce\(p_max, 25\), 0\)/);
  /* Reprenable : un journal dit ce qui a été lancé et ce qui reste. */
  assert.match(sql, /create table if not exists public\.place_recoltes/);
  /* Et une case en échec n'est pas une case faite : sinon la métropole
     garderait des trous permanents et invisibles. */
  assert.match(rec, /and r\.statut <> 'echec'/);
  /* Le pavage vient des communes déjà utilisées pour filtrer les événements,
     pas d'une grille inventée. */
  assert.match(sql, /from public\.mel_communes mc/);
  /* Idempotente par construction : rien n'insère de lieu directement. */
  const debutVersement = sql.indexOf("function public.places_verser_recoltes");
  const versement = sql.slice(debutVersement,
    sql.indexOf("revoke all on function public.places_verser_recoltes", debutVersement));
  assert.ok(versement.length > 400, "le versement doit être trouvé en entier");
  assert.doesNotMatch(versement, /insert into public\.places\b/);
});

/* ---- 6. La sécurité ----------------------------------------------------- */

test("rien de nouveau n'est ouvert au navigateur", () => {
  /* Le journal de récolte et le pavage ne sont pas des données de produit. */
  assert.match(sql, /revoke all on public\.place_recoltes from anon, authenticated, public;/);
  assert.match(sql, /revoke all on public\.place_pavage_mel from anon, authenticated, public;/);
  /* UNE VUE S'EXÉCUTE AVEC LES DROITS DE SON PROPRIÉTAIRE : sans cette
     révocation, `place_pavage_mel` ouvrait `mel_communes` à tout le monde. */
  assert.match(sql, /grant select on public\.place_pavage_mel to service_role;/);
  assert.doesNotMatch(sql, /grant select on public\.place_pavage_mel to anon/);
  /* Les familles se lisent, ne s'écrivent pas. */
  assert.match(sql, /revoke all on public\.place_familles from anon, authenticated;/);
  assert.match(sql, /grant select on public\.place_familles to anon, authenticated;/);
  /* Et toutes les fonctions d'ingestion restent réservées au serveur. */
  for (const fonction of ["places_classer", "places_recolter_mel",
                          "places_verser_recoltes", "places_images_depuis_evenements",
                          "places_enrichir_depuis_cache", "places_rapprocher_doublons"]) {
    assert.match(sql, new RegExp("revoke all on function public\\." + fonction +
      "[\\s\\S]{0,200}?from public, anon, authenticated"), fonction + " : révocation");
    assert.match(sql, new RegExp("grant execute on function public\\." + fonction +
      "[\\s\\S]{0,200}?to service_role"), fonction + " : service_role");
  }
});

/* ---- 7. Ce que le lot ne devait pas toucher ----------------------------- */

test("l'interface, les moteurs et les sources interdites sont intacts", () => {
  /* Aucune migration ne touche l'écran. */
  assert.doesNotMatch(sql, /navBas|selecteurSurface|fabCreer|explorerDecouverte/);
  /* Ni OSM ni Google n'entrent toujours pas dans l'inventaire. */
  assert.doesNotMatch(code, /overpass|openstreetmap/i);
  assert.doesNotMatch(code, /google_place_id|googlePlaceId/i);
  /* Les moteurs du Lot 3 n'ont pas bougé. */
  assert.match(app, /const CRENEAUX = \[/);
  assert.match(app, /const positionConnue = \(\)=>originePosition !== null && originePosition !== "repli";/);
  /* Et le client n'est toujours pas branché sur l'inventaire : c'est la
     décision du lot, et elle se vérifie. */
  assert.doesNotMatch(app, /lieux_locaux|places_qualite|place_familles/);
});
