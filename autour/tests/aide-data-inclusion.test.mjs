import assert from "node:assert/strict";
import test from "node:test";

import {
  aplatir, cout, interroger, lireListe, modeAcces, normaliser,
  organismeGestionnaire, publicVise, urlRecherche,
} from "../aide-data-inclusion.mjs";
import handler from "../api/aide-structures.js";

/* Un service tel que l'API le rend : la structure porte l'identité et
   l'adresse, le service porte le vocabulaire qui fait la fiche. */
function enveloppe(surcharges = {}) {
  return {
    distance: 420,
    structure: {
      id: "dora--abc", nom: "La Sauvegarde du Nord", siret: "77562769000015",
      adresse: "199 rue Colbert", code_postal: "59000", commune: "Lille",
      code_insee: "59350", latitude: 50.6333, longitude: 3.0500,
      telephone: "0320123456", site_web: "https://lasauvegardedunord.fr/",
      lien_source: "https://dora.inclusion.gouv.fr/structures/la-sauvegarde-du-nord",
      date_maj: "2026-09-01", source: "dora",
    },
    service: {
      id: "dora--abc-1", nom: "Point accueil écoute jeunes Moulins",
      profils: ["jeunes-16-26", "familles", "un-code-que-personne-ne-connait"],
      frais: ["gratuit"],
      modes_orientation_beneficiaire: ["se-presenter", "telephoner"],
      thematiques: ["sante--accompagnement-psychologique"],
      types: ["accompagnement"],
    },
    ...surcharges,
  };
}

/* ======================================================================== */
test("la structure et le service se rejoignent sans perdre l'identité", () => {
  const plat = aplatir(enveloppe());
  assert.equal(plat.nom_service, "Point accueil écoute jeunes Moulins");
  assert.equal(plat.siret, "77562769000015");
  assert.equal(plat.latitude, 50.6333);
  assert.equal(plat.distance, 420);
});

test("un code de public inconnu ressort tel quel plutôt que rangé de force", () => {
  const publics = publicVise(aplatir(enveloppe()));
  assert.deepEqual(publics.map((p) => p.code),
    ["jeunes-16-26", "familles", "un-code-que-personne-ne-connait"]);
  assert.equal(publics[0].label, "16-26 ans");
  assert.equal(publics[2].label, "un code que personne ne connait");
});

test("le mode d'accès annonce la porte la plus simple qui soit ouverte", () => {
  assert.equal(modeAcces({modes_orientation_beneficiaire: ["se-presenter", "telephoner"]}), "libre");
  assert.equal(modeAcces({modes_orientation_beneficiaire: ["telephoner"]}), "telephone");
  assert.equal(modeAcces({modes_orientation_beneficiaire: ["envoyer-un-mail"]}), "rendez_vous");
});

test("un service qui n'ouvre que par un prescripteur le dit", () => {
  assert.equal(modeAcces({
    modes_orientation_beneficiaire: [],
    modes_orientation_accompagnateur: ["envoyer-un-mail"],
  }), "orientation");
});

test("un mode d'accès inconnu reste nul : c'est un champ fermé", () => {
  assert.equal(modeAcces({}), null);
  assert.equal(modeAcces({modes_orientation_beneficiaire: ["par-pigeon-voyageur"]}), null);
});

test("les frais se ramènent aux trois valeurs de la fiche, ou à rien", () => {
  assert.equal(cout({frais: ["gratuit"]}), "gratuit");
  assert.equal(cout({frais: ["adhesion"]}), "participation");
  assert.equal(cout({frais: ["gratuit-sous-conditions"]}), "participation");
  assert.equal(cout({frais: ["payant"]}), "payant");
  assert.equal(cout({frais: ["on-verra"]}), null);
  assert.equal(cout({}), null);
});

/* B.3 — un gestionnaire n'est pas un lieu. */
test("l'organisme gestionnaire est séparé du lieu où l'on va", () => {
  const plat = aplatir(enveloppe());
  assert.equal(organismeGestionnaire(plat), "La Sauvegarde du Nord");
  const fiche = normaliser(enveloppe());
  assert.equal(fiche.name, "Point accueil écoute jeunes Moulins");
  assert.equal(fiche.fiche.organisme_gestionnaire, "La Sauvegarde du Nord");
});

test("une structure qui n'est pas gérée par une autre n'invente pas de gestionnaire", () => {
  const seule = enveloppe();
  seule.service.nom = seule.structure.nom;
  assert.equal(organismeGestionnaire(aplatir(seule)), null);
});

test("aucun horaire n'est fabriqué quand la source n'en publie pas", () => {
  assert.equal(normaliser(enveloppe()).openingHours, null);
  const avec = enveloppe();
  avec.structure.horaires_ouverture = "Mo-Fr 09:00-12:00";
  assert.equal(normaliser(avec).openingHours, "Mo-Fr 09:00-12:00");
});

test("la phrase en langage ordinaire ne vient jamais de la source", () => {
  const avec = enveloppe();
  avec.service.presentation_resume = "Dispositif d'accompagnement psycho-social de proximité";
  const fiche = normaliser(avec);
  assert.equal(fiche.fiche.quoi_concretement, null,
    "`quoi_concretement` est écrit pour un lecteur, pas repris d'un référentiel");
  assert.match(fiche.description, /accompagnement/);
});

test("une fiche sans nom ou sans coordonnées n'entre pas dans une carte", () => {
  const sansNom = enveloppe(); sansNom.service.nom = ""; sansNom.structure.nom = "";
  assert.equal(normaliser(sansNom), null);
  const sansCoord = enveloppe();
  delete sansCoord.structure.latitude; delete sansCoord.structure.longitude;
  assert.equal(normaliser(sansCoord), null);
});

test("les trois enveloppes de réponse connues se lisent pareil", () => {
  assert.equal(lireListe([1, 2]).length, 2);
  assert.equal(lireListe({items: [1]}).length, 1);
  assert.equal(lireListe({results: [1, 2, 3]}).length, 3);
  assert.equal(lireListe({rien: true}).length, 0);
});

test("le rayon demandé en mètres part en kilomètres entiers, arrondis vers le haut", () => {
  const url = urlRecherche({lat: 50.63, lng: 3.05, rayonM: 5200, limite: 30, codeCommune: "59350"});
  assert.equal(url.searchParams.get("radius"), "6");
  assert.equal(url.searchParams.get("code_commune"), "59350");
  assert.equal(url.searchParams.get("size"), "30");
});

/* ---- L'APPEL ----------------------------------------------------------- */
test("sans jeton, l'API n'est pas appelée et le dit", async () => {
  let appelee = false;
  const r = await interroger({env: {}, lat: 50.63, lng: 3.05, rayonM: 5000,
    fetch: () => { appelee = true; }});
  assert.equal(r.etat.state, "not_configured");
  assert.equal(appelee, false);
  assert.deepEqual(r.items, []);
});

test("une panne d'amont est une absence de fiches, jamais une exception", async () => {
  const r = await interroger({env: {DORA_API_TOKEN: "x"}, lat: 50.63, lng: 3.05, rayonM: 5000,
    fetch: async () => { throw new Error("socket coupée"); }});
  assert.equal(r.etat.state, "unavailable");
  assert.equal(r.etat.reason, "socket coupée");
  assert.deepEqual(r.items, []);
});

test("une réponse HTTP en erreur ne produit aucune fiche", async () => {
  const r = await interroger({env: {DATA_INCLUSION_API_TOKEN: "x"}, lat: 50.63, lng: 3.05,
    rayonM: 5000, fetch: async () => ({ok: false, status: 503})});
  assert.equal(r.etat.state, "unavailable");
  assert.equal(r.etat.reason, "http_503");
});

test("le jeton part en Bearer, et la réponse devient des fiches", async () => {
  let entetes = null;
  const r = await interroger({
    env: {DATA_INCLUSION_API_TOKEN: "secret"}, lat: 50.63, lng: 3.05, rayonM: 5000,
    fetch: async (url, init) => {
      entetes = init.headers;
      assert.match(String(url), /\/search\/services\?/);
      return {ok: true, status: 200, json: async () => ({items: [enveloppe()]})};
    },
  });
  assert.equal(entetes.authorization, "Bearer secret");
  assert.equal(r.etat.state, "ok");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].fiche.mode_acces, "libre");
  assert.equal(r.items[0].fiche.cout, "gratuit");
});

/* ---- LA ROUTE ---------------------------------------------------------- */
async function appelerRoute(reponsesFetch, environnement) {
  const fetchOrigine = globalThis.fetch;
  const envOrigine = {...process.env};
  Object.assign(process.env, environnement);
  globalThis.fetch = async (cible) => {
    const url = String(cible);
    for (const [motif, reponse] of reponsesFetch) {
      if (motif.test(url)) return reponse();
    }
    throw new Error("appel non prévu : " + url);
  };
  try {
    const r = await handler({method: "GET",
      url: "https://autour.eu/api/aide-structures?source=dora&lat=50.72373&lng=3.160758&radius=12000"});
    return await r.json();
  } finally {
    globalThis.fetch = fetchOrigine;
    for (const cle of Object.keys(environnement)) delete process.env[cle];
    Object.assign(process.env, envOrigine);
  }
}

const COMMUNE_TOURCOING = [/geo\.api\.gouv\.fr/, () => ({
  ok: true, json: async () => [{code: "59599", nom: "Tourcoing"}],
})];

test("la source vivante passe devant l'extrait versionné", async () => {
  const vivante = enveloppe();
  vivante.structure.latitude = 50.72373;
  vivante.structure.longitude = 3.160758;
  vivante.structure.code_insee = "59599";
  const body = await appelerRoute([
    COMMUNE_TOURCOING,
    [/data\.inclusion/, () => ({ok: true, status: 200, json: async () => ({items: [vivante]})})],
  ], {DATA_INCLUSION_API_TOKEN: "secret"});

  assert.equal(body.items[0].id, "data-inclusion:dora--abc-1",
    "la première fiche servie doit être celle de l'API, pas celle de l'extrait");
  const vivant = body.sourceStatus.find((s) => s.source === "data_inclusion");
  assert.equal(vivant.state, "ok");
  const extrait = body.sourceStatus.find((s) => s.source === "data_inclusion_extrait");
  assert.equal(extrait.state, "complement");
});

test("quand l'API se tait, l'extrait reprend la main et se déclare comme repli", async () => {
  const body = await appelerRoute([
    COMMUNE_TOURCOING,
    [/data\.inclusion/, () => ({ok: false, status: 502})],
  ], {DATA_INCLUSION_API_TOKEN: "secret"});

  assert.ok(body.items.length, "un extrait versionné vaut mieux qu'une ville vide");
  assert.equal(body.snapshot, true);
  const extrait = body.sourceStatus.find((s) => s.source === "data_inclusion_extrait");
  assert.equal(extrait.state, "repli");
  assert.equal(extrait.raison, "unavailable");
});

test("sans jeton, la route sert l'extrait et ne prétend pas avoir interrogé l'amont", async () => {
  const body = await appelerRoute([COMMUNE_TOURCOING], {});
  assert.equal(body.snapshot, true);
  const vivant = body.sourceStatus.find((s) => s.source === "data_inclusion");
  assert.equal(vivant.state, "not_configured");
});
