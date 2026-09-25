/* L'ORGANISATION N'EST PAS LE POINT DE SERVICE

   La doctrine est posée dans `docs/organisation-et-point-de-service.md` et vit
   une seule fois dans `shared/points-de-service.mjs`. Ces tests la fixent, et
   surtout ils fixent les trois VIOLATIONS trouvées en la posant :

     1. `samePlace` décidait sur le SIRET seul, et rendait aussitôt le résultat :
        deux points de service d'un même réseau étaient le même endroit quelle
        que soit leur adresse. Mesuré : les Restaurants du Cœur n'ont que deux
        établissements au registre à Tourcoing pour cinq centres réels — trois
        sur cinq étaient écrasés silencieusement.
     2. La clé de publication était le SIRET, donc une association à deux lieux
        de distribution n'en publiait qu'un.
     3. `aide-structures.js` rapprochait sur le SIRET faute de FINESS.

   Les sept lecteurs de la règle sont vérifiés ici : la découverte, la
   publication, Solidarité, et le contexte transmis aux réponses IA. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOCTRINE_POINT_DE_SERVICE, ORDRE_DE_RAISONNEMENT,
  IDENTIFIANTS_D_ORGANISATION, IDENTIFIANTS_DE_SITE,
  memePointDeService, clePointDeService, memeEmplacement,
} from "../supabase/functions/shared/points-de-service.mjs";
import { samePlace, deduplicate } from "../supabase/functions/local-discovery/discovery.mjs";

const lire = (chemin) => readFileSync(new URL("../" + chemin, import.meta.url), "utf8");

/* Les cinq centres réels de Tourcoing, avec les adresses et les coordonnées
   confirmées par la Base Adresse Nationale, et le SIRET de leur association —
   le seul établissement ouvert que le registre déclare. */
const SIRET_ASSOCIATION = "33986341700053";
const CENTRES = Object.freeze([
  {name: "Restos du Cœur - Tourcoing Europe", address: "8 Rue de l'Europe 59200 Tourcoing",
   lat: 50.736520, lng: 3.145871, siret: SIRET_ASSOCIATION, phone: "09 73 89 49 02"},
  {name: "Restos du Cœur - Tourcoing Épidème", address: "2 Rue de Seclin 59200 Tourcoing",
   lat: 50.712071, lng: 3.168555, siret: SIRET_ASSOCIATION, phone: "09 83 59 15 25"},
  {name: "Restos du Cœur - Tourcoing Virolois", address: "Rue Bonne Nouvelle 59200 Tourcoing",
   lat: 50.729950, lng: 3.180786, siret: SIRET_ASSOCIATION, phone: "09 74 30 06 81"},
]);

/* ==========================================================================
   1. CE QUI NE FUSIONNE JAMAIS
   ======================================================================== */

test("un SIRET partagé ne fait pas de deux adresses un seul endroit", () => {
  const [europe, epideme, virolois] = CENTRES;
  assert.equal(memePointDeService(europe, epideme), false);
  assert.equal(memePointDeService(europe, virolois), false);
  assert.equal(memePointDeService(epideme, virolois), false);
  /* Et la découverte, qui délègue à la règle partagée. */
  assert.equal(samePlace(europe, epideme), false);
  assert.equal(deduplicate(CENTRES).accepted.length, 3,
    "les trois centres restent trois candidats");
});

test("ni le téléphone, ni le domaine, ni le réseau ne suffisent", () => {
  const meme = {phone: "09 74 30 06 81", source_domain: "ad59a-restosducoeur.org"};
  const a = {...CENTRES[0], ...meme};
  const b = {...CENTRES[2], ...meme};
  assert.equal(memePointDeService(a, b), false);
  /* Le même téléphone AU MÊME ENDROIT, en revanche, est le même guichet sous
     deux noms — « CCAS » et « Centre Communal d'Action Sociale ». */
  assert.equal(memePointDeService(
    {name: "CCAS", lat: 50.72, lng: 3.16, phone: "03 20 11 34 34"},
    {name: "Centre Communal d’Action Sociale", lat: 50.72, lng: 3.16, phone: "03 20 11 34 34"}),
    true);
});

test("la liste des identifiants d'organisation est explicite", () => {
  for (const id of ["siret", "siren"])
    assert.ok(IDENTIFIANTS_D_ORGANISATION.includes(id), id + " doit y être");
  for (const id of ["finessEge", "ban_id"])
    assert.ok(IDENTIFIANTS_DE_SITE.includes(id), id + " désigne un site");
  /* Aucun identifiant ne peut être des deux côtés. */
  assert.equal(IDENTIFIANTS_D_ORGANISATION.filter((id) => IDENTIFIANTS_DE_SITE.includes(id)).length, 0);
});

/* ==========================================================================
   2. CE QUI DÉCIDE
   ======================================================================== */

test("un identifiant de site décide seul, dans les deux sens", () => {
  const a = {name: "Permanence", lat: 50.72, lng: 3.16, ban_id: "59599_0396_00026"};
  const b = {name: "Épicerie solidaire", lat: 50.72, lng: 3.16, ban_id: "59599_0396_00026"};
  assert.equal(memePointDeService(a, b), true, "même adresse BAN, même point");
  /* Et symétriquement : un même bâtiment peut héberger deux points. */
  assert.equal(memePointDeService(a, {...b, ban_id: "59599_0396_00028"}), false);
});

test("un identifiant d'organisation corrobore au même endroit", () => {
  const a = {name: "CCAS Tourcoing", address: "26 rue Bienfaisance",
    lat: 50.7248, lng: 3.1578, siret: "26590599200011"};
  const b = {name: "Centre communal", address: "26 rue Bienfaisance",
    lat: 50.7248, lng: 3.1578, siret: "26590599200011"};
  assert.equal(memePointDeService(a, b), true);
  /* Le même SIRET à 3 km : deux points. */
  assert.equal(memePointDeService(a, {...b, lat: 50.75, lng: 3.19, address: "1 rue Ailleurs"}), false);
});

test("l'emplacement se lit par l'adresse ou par 120 mètres", () => {
  assert.equal(memeEmplacement({address: "8 Rue de l'Europe"}, {address: "8 rue de l Europe"}), true);
  assert.equal(memeEmplacement({lat: 50.72, lng: 3.16}, {lat: 50.7201, lng: 3.1601}), true);
  assert.equal(memeEmplacement(CENTRES[0], CENTRES[1]), false);
});

/* ==========================================================================
   3. LA CLÉ DE PUBLICATION EST CELLE DU POINT
   ======================================================================== */

test("la clé change avec le point, pas avec l'organisation", () => {
  const cles = new Set(CENTRES.map(clePointDeService));
  assert.equal(cles.size, 3, "trois points, trois clés — le SIRET est partagé");
  for (const cle of cles)
    assert.doesNotMatch(cle, new RegExp(SIRET_ASSOCIATION),
      "le SIRET n'entre pas dans la clé d'un point de service");
  /* Une adresse BAN gagne : elle EST un endroit. */
  assert.equal(clePointDeService({ban_id: "59599_1990_00008", name: "X", lat: 1, lng: 2}),
    "ban:59599_1990_00008");
  /* Deux découvertes du même point retombent sur la même clé. */
  assert.equal(clePointDeService({name: "Croix-Rouge", lat: 50.719745, lng: 3.141904,
    source_fingerprint: "a"}),
    clePointDeService({name: "Croix-Rouge", lat: 50.719745, lng: 3.141904,
      source_fingerprint: "b"}));
});

test("la publication SQL clé sur l'adresse, jamais sur le SIRET", () => {
  const sql = lire("supabase/migrations/20260925140000_local_discovery_preuve_officielle.sql");
  const bloc = sql.slice(sql.indexOf("function public.local_discovery_publier"));
  assert.match(bloc, /'ban:' \|\| c\.ban_id/);
  assert.doesNotMatch(bloc, /places_ingerer\(\s*\n?\s*'web_discovery', coalesce\(c\.siret/,
    "le SIRET ne doit plus être la clé du lieu");
});

/* ==========================================================================
   4. LES SEPT LECTEURS
   ======================================================================== */

test("la découverte délègue à la règle partagée", () => {
  const discovery = lire("supabase/functions/local-discovery/discovery.mjs");
  assert.match(discovery, /import \{ memePointDeService \} from "\.\.\/shared\/points-de-service\.mjs"/);
  assert.match(discovery, /return memePointDeService\(a, b/);
  /* Et l'ancienne règle n'est plus là. */
  assert.doesNotMatch(discovery, /const officialIds = \["siret"/);
});

test("l'invite de l'agent de découverte porte la doctrine", () => {
  const index = lire("supabase/functions/local-discovery/index.ts");
  assert.match(index, /DOCTRINE_POINT_DE_SERVICE/);
  assert.match(index, /POINTS DE SERVICE/);
  /* Le contre-exemple voyage avec la règle : sans lui, elle se réinterprète. */
  assert.match(DOCTRINE_POINT_DE_SERVICE, /association départementale/);
  assert.match(DOCTRINE_POINT_DE_SERVICE, /NE FUSIONNE JAMAIS/);
  for (const mot of ["SIRET", "SIREN", "réseau", "téléphone", "domaine"])
    assert.ok(DOCTRINE_POINT_DE_SERVICE.includes(mot), mot + " doit être nommé");
});

test("Solidarité ne rapproche plus sur le SIRET seul", () => {
  const aide = lire("aide-structures.js");
  assert.match(aide, /IDENTIFIANTS_D_ORGANISATION/);
  assert.match(aide, /"siren", "siret"/);
  assert.match(aide, /orgA === orgB\) return distanceM\(a, b\) <= 120/);
});

test("les réponses IA reçoivent l'ordre de raisonnement et un point de service", async () => {
  globalThis.window = globalThis;
  await import("../comprendre.js");
  await import("../aide-intentions.js");
  await import("../aide-taxonomie.js");
  await import("../aide-contexte-ia.js");
  const IA = globalThis.AutourAideContexteIA;

  const ctx = IA.contexte({
    userLat: 50.7236, userLng: 3.1610, selectedCity: "Tourcoing", currentRadius: 5000,
    requestedHelpCategory: "manger",
    candidatePlaces: [{
      id: "p1", titre: "Croix-Rouge française - Unité Locale de Tourcoing",
      cat: "alimentaire", lat: 50.719745, lng: 3.141904,
      adresse: "2 Rue de la Vigne 59200 Tourcoing", telephone: "03 20 46 39 00",
      services: ["food", "grocery"], last_verified_at: "2026-09-25T09:19:04Z",
      sourceRefs: {siret: "77567227220577", siren: "775672272"},
    }],
  });

  assert.deepEqual(ctx.reasoningOrder, ORDRE_DE_RAISONNEMENT);
  assert.equal(ctx.reasoningOrder[0], "besoin de la personne");
  assert.equal(ctx.reasoningOrder[2], "points de service pertinents");

  const c = ctx.candidatePlaces[0];
  assert.equal(c.address, "2 Rue de la Vigne 59200 Tourcoing");
  assert.equal(c.phone, "03 20 46 39 00");
  assert.deepEqual(c.serviceCategories, ["food", "grocery"]);
  assert.equal(c.lastVerifiedAt, "2026-09-25T09:19:04Z");
  /* L'organisation voyage à part, et son rôle est écrit dedans. */
  assert.equal(c.organisation.role, "verification");
  assert.equal(c.organisation.siret, "77567227220577");

  const regles = ctx.rules.join(" ");
  assert.match(regles, /POINT DE SERVICE/);
  assert.match(regles, /jamais par la seule organisation ni par un SIRET/);
  assert.match(regles, /plusieurs points de service/);
  assert.match(regles, /vérifier l’identité et la provenance/);
});

test("la doctrine est écrite, et elle nomme ses sept lecteurs", () => {
  const doc = lire("docs/organisation-et-point-de-service.md");
  for (const lecteur of ["local_discovery", "Solidarité", "recherche", "Pour toi",
    "enrichissement", "dédoublonnage", "génération des fiches"])
    assert.ok(doc.includes(lecteur), lecteur + " doit être nommé dans la doctrine");
  assert.match(doc, /besoin de la personne/);
  assert.match(doc, /corrobore/);
});
