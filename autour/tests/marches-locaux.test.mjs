/* ---------------------------------------------------------------------------
   MARCHÉS, BROCANTES, BRADERIES, FÊTES DE QUARTIER

   Une famille d'événements locaux essentielle à Autour, que les sources
   décrivent chacune à leur façon. Audit du 26/09/2026 sur les vraies données
   de la métropole lilloise :

     · « Marché du Vieux-Lille » rangé en CONCERT (« Place du Concert ») ;
     · « Braderie de Flers-Bourg », « Marché nocturne du Pont » sans catégorie ;
     · une braderie en cours dans AUCUNE envie, pas même Gratuit ;
     · « Marché de Wazemmes » (mardi, jeudi, dimanche), publié du 1er janvier
       au 31 décembre, « en cours » un lundi à 10 h ;
     · un marché OpenStreetMap ouvert écarté comme « commodité ».

   Ces tests passent par le vrai pipeline : core.js (normalisation),
   temporel.js (statut), maintenant.js (candidats, envies) — chargés ensemble,
   comme dans l'application. Aucune priorité n'est donnée à ces événements.
--------------------------------------------------------------------------- */

import test from "node:test";
import assert from "node:assert/strict";
import "../core.js";
import "../temporel.js";
import "../maintenant.js";

const C = globalThis.AutourCore;
const T = globalThis.AutourTemps;
const M = globalThis.AutourMaintenant;

const paris = (iso) => Date.parse(iso + "+02:00");
const DIMANCHE_10H = paris("2026-09-27T10:00:00");
const ICI = [50.6292, 3.0573];

/* Un événement tel que l'application le donne au moteur (`versItemMaintenant`),
   à partir d'une ligne de source passée par la vraie normalisation. */
function depuisSource(ligne, maintenant, extra) {
  const n = C.toCommonItem(Object.assign({ id: ligne.id || "x", isTemporary: true,
    lat: ICI[0] + 0.004, lng: ICI[1], cat: ligne.category || "event" }, ligne), { source: ligne.source || "openagenda" });
  const debut = Date.parse(ligne.start_at), fin = ligne.end_at ? Date.parse(ligne.end_at) : null;
  const longue = fin != null && fin - debut > 36 * 3600e3;
  const categorie = n.canonicalCategory;
  return Object.assign({
    id: n.id, estEvenement: true, annule: false,
    titre: n.title, title: n.title, categorie, category: categorie,
    entity_type: "event", canonical_id: n.id,
    canonical: { entity_type: "event", id: n.id, title: n.title, category: categorie },
    // l'application transmet « unknown » pour ces longues plages (relevé en production)
    temporalStatus: longue ? "unknown" : undefined,
    tempsValide: true, debutLe: debut, finLe: fin,
    start_at: ligne.start_at, end_at: ligne.end_at || null, timezone: "Europe/Paris",
    lat: n.lat, lng: n.lng, ferme: false,
    gratuit: ligne.is_free === true,
    famille: n.familleMaintenant || undefined, envies: n.envies || undefined,
    familleLocale: n.familleLocale, joursRecurrence: n.joursRecurrence,
  }, extra || {});
}

const ctx = (maintenant, extra) => Object.assign({
  maintenant, position: ICI, positionConnue: true, positionEnCours: false,
  positionRefusee: false, chargement: false, panne: false,
}, extra || {});

const retenu = (item, t) => M.candidats([item], ctx(t)).some((c) => c.item.id === item.id);
const raison = (item, t) => M.disponible(item, ctx(t)).raison;
const section = (item, t) => T.sectionTemporelle(T.statutTemporel(item, t, {}), t);

/* Les lignes réelles, réduites à ce qui compte ici. */
const VIEUX_LILLE = { id: "vieux-lille", title: "Marché du Vieux-Lille", category: "concert", source: "datatourisme",
  description: "Chaque mercredi, vendredi et dimanche matin, la Place du Concert s'anime avec le Marché du Vieux-Lille.",
  start_at: "2026-01-01T06:00:00Z", end_at: "2026-12-31T13:00:00Z" };
const WAZEMMES = { id: "wazemmes", title: "Marché de Wazemmes", category: "marche", source: "datatourisme",
  description: "Impossible de ne pas se rendre au marché de Wazemmes un dimanche !",
  start_at: "2026-01-01T06:00:00Z", end_at: "2026-12-31T13:00:00Z" };
const SANS_JOURS = { id: "sans-jours", title: "Marché couvert", category: "marche", source: "datatourisme",
  description: "Produits frais et ambiance conviviale.",
  start_at: "2026-01-01T06:00:00Z", end_at: "2026-12-31T13:00:00Z" };
const date = (id, titre, debut, fin, extra) => Object.assign({ id, title: titre,
  start_at: new Date(paris(debut)).toISOString(), end_at: new Date(paris(fin)).toISOString() }, extra || {});

/* ==========================================================================
   1. NORMALISATION : LE TITRE DÉCIDE, SANS FAUX POSITIF
   ======================================================================== */

test("chaque formulation reconnue tombe dans sa famille et ses envies", () => {
  const attendu = {
    "Marché": "marche", "Marché local": "marche", "Marché hebdomadaire": "marche",
    "Marché alimentaire": "marche", "Marché de producteurs": "marche_producteurs",
    "Marché fermier": "marche_producteurs", "Marché artisanal": "marche_artisanal",
    "Marché nocturne": "marche_nocturne", "Marché de Noël": "marche_noel", "Village de Noël": "marche_noel",
    "Vide-grenier": "vide_grenier", "Vide-greniers": "vide_grenier", "Vide grenier": "vide_grenier",
    "Brocante": "brocante", "Braderie": "braderie", "Foire": "foire", "Foire commerciale": "foire",
    "Foire locale": "foire", "Puces": "puces", "Marché aux puces": "puces",
    "Vente associative": "vente_asso", "Vente solidaire": "vente_asso", "Vente caritative": "vente_asso",
    "Bourse aux vêtements": "bourse", "Bourse aux jouets": "bourse", "Bourse aux livres": "bourse",
    "Fête de quartier": "fete_quartier", "Animation de quartier": "fete_quartier",
    "Événement de quartier": "fete_quartier", "Fête locale": "fete_quartier",
    "MARCHE DE NOEL": "marche_noel", "Marché de créateurs": "marche_artisanal",
    "Vide-dressing dimanche": "vide_grenier", "Petite brocante de quartier": "brocante",
    "Vente de livres de l'association": "vente_asso", "Fête du quartier": "fete_quartier",
  };
  for (const [titre, famille] of Object.entries(attendu)) {
    const f = C.familleLocale({ title: titre });
    assert.equal(f && f.id, famille, titre);
  }
});

test("13. « marché » dans un contexte sans rapport n'est pas un marché local", () => {
  for (const titre of ["Le marché immobilier en 2026", "Conférence : le marché du travail",
    "Marché de l'emploi", "Marche nordique", "Marche pour le climat", "Marche Santé à Lille-Sud !",
    "Marche gourmande", "Concert place du Marché", "Foire aux questions", "La Vieille Bourse",
    "Vente aux enchères", "Bon Marché", "Supermarché", "Inventez des histoires !"]) {
    assert.equal(C.familleLocale({ title: titre, category: "event" }), null, titre);
  }
  // une mention au détour du titre d'autre chose reste cette autre chose
  assert.equal(C.familleLocale({ title: "Concert au marché de Noël", category: "concert" }), null);
  // « ducasse » est un indice faible : ce spectacle du LaM reste un spectacle (donnée réelle)
  assert.equal(C.familleLocale({ title: "Pochette Surprise : la Ducasse de Clément Courgeon",
    category: "spectacle" }), null);
  assert.equal(C.familleLocale({ title: "Ducasse de Fives" }).id, "fete_quartier");
  // et une marche à pied sans accent reste un sport
  assert.equal(C.toCommonItem({ id: 1, title: "Marche nordique", category: "marche nordique",
    cat: "marche nordique", isTemporary: true }, { source: "t" }).canonicalCategory, "sport");
});

test("la source qui ment est corrigée par le titre, la source muette complétée", () => {
  const n = (ligne) => C.toCommonItem(Object.assign({ id: 1, isTemporary: true }, ligne), { source: "t" });
  const vieux = n({ title: "Marché du Vieux-Lille", category: "concert", cat: "concert" });
  assert.equal(vieux.canonicalCategory, "marche");
  assert.equal(vieux.familleMaintenant, "manger");
  const flers = n({ title: "Braderie de Flers-Bourg", cat: "event" });
  assert.deepEqual([flers.familleLocale, flers.canonicalCategory, flers.familleMaintenant], ["braderie", "event", "sortir"]);
  const nocturne = n({ title: "Marché nocturne du Pont", cat: "event" });
  assert.deepEqual(nocturne.envies, ["sortir", "manger"]);
  const livres = n({ title: "Marché aux livres", category: "marche", cat: "marche" });
  assert.deepEqual(livres.envies, ["sortir", "culture"]);
  const foire = n({ title: "Foire aux manèges de Lille", category: "marche", cat: "marche" });
  assert.deepEqual([foire.canonicalCategory, foire.familleMaintenant], ["event", "sortir"]);
});

test("une publication d'habitant garde son type, et gagne la famille", () => {
  for (const [titre, famille] of [["Vide-dressing dimanche", "vide_grenier"],
    ["Petite brocante de quartier", "brocante"], ["Vente de livres de l'association", "vente_asso"],
    ["Marché de créateurs", "marche_artisanal"], ["Fête du quartier", "fete_quartier"]]) {
    const p = C.toCommonItem({ id: "pub1", title: titre, cat: "popup", isTemporary: true }, { source: "user" });
    assert.equal(p.familleLocale, famille, titre);
    assert.equal(p.canonicalCategory, "popup", "le type choisi à la création reste affiché : " + titre);
    assert.ok(p.envies.includes("sortir"), titre);
  }
});

test("les jours d'une récurrence se lisent dans la prose, sans en inventer", () => {
  assert.deepEqual(C.joursRecurrence(VIEUX_LILLE.description), [0, 3, 5]);
  assert.deepEqual(C.joursRecurrence(WAZEMMES.description), [0]);
  assert.deepEqual(C.joursRecurrence("chaque après-midi, du mardi au dimanche"), [0, 2, 3, 4, 5, 6]);
  assert.deepEqual(C.joursRecurrence("Tous les jours sauf le lundi"), [0, 2, 3, 4, 5, 6]);
  assert.deepEqual(C.joursRecurrence("du vendredi au dimanche, fermé le samedi"), [0, 5]);
  assert.equal(C.joursRecurrence("Produits frais et ambiance conviviale."), null);
});

/* ==========================================================================
   2. MAINTENANT : COMME N'IMPORTE QUELLE ACTIVITÉ, SELON LES MÊMES RÈGLES
   ======================================================================== */

test("1. un marché actuellement ouvert entre dans Maintenant", () => {
  const samedi11h = paris("2026-10-03T11:00:00");
  const marche = depuisSource(date("q", "Marché de quartier", "2026-10-03T08:00:00", "2026-10-03T13:00:00"), samedi11h);
  assert.ok(retenu(marche, samedi11h));
  // et le marché récurrent, le bon jour, dans ses heures
  assert.ok(retenu(depuisSource(VIEUX_LILLE), DIMANCHE_10H));
});

test("2. un marché fermé aujourd'hui n'y entre pas", () => {
  const quinzeH = paris("2026-10-03T15:00:00");
  const marche = depuisSource(date("q", "Marché de quartier", "2026-10-03T08:00:00", "2026-10-03T13:00:00"));
  assert.equal(retenu(marche, quinzeH), false);
});

test("3. un marché demain est À venir, pas Maintenant", () => {
  const marche = depuisSource(date("d", "Marché de producteurs", "2026-09-28T08:00:00", "2026-09-28T13:00:00"));
  assert.equal(retenu(marche, DIMANCHE_10H), false);
  assert.equal(section(marche, DIMANCHE_10H), "a_venir");
});

test("4. un marché publié toute l'année n'est en cours que ses jours, dans ses heures", () => {
  const vieux = depuisSource(VIEUX_LILLE), waz = depuisSource(WAZEMMES);
  const lundi10h = paris("2026-09-28T10:00:00"), dimanche16h = paris("2026-09-27T16:00:00");
  assert.equal(raison(vieux, lundi10h), M.RAISONS.HORS_JOUR_RECURRENT);
  assert.equal(raison(waz, lundi10h), M.RAISONS.HORS_JOUR_RECURRENT);
  assert.equal(raison(vieux, dimanche16h), M.RAISONS.HORS_PLAGE_QUOTIDIENNE);
  // sans aucun jour dans la source : on ne sait pas s'il a lieu aujourd'hui
  assert.equal(raison(depuisSource(SANS_JOURS), DIMANCHE_10H), M.RAISONS.JOURS_INCONNUS);
  // et aucune « séance » ne rattrape ces refus
  for (const t of [lundi10h, dimanche16h]) assert.equal(M.disponible(vieux, ctx(t)).retenu, false);
});

for (const [n, titre, envie] of [
  ["5", "Vide-grenier de la rue Solférino", "sortir"],
  ["6", "Brocante du Vieux-Lille", "sortir"],
  ["7", "Braderie de Flers-Bourg", "sortir"],
  ["10", "Vente solidaire de l'association", "sortir"],
  ["11", "Fête de quartier de Fives", "sortir"],
]) {
  test(n + ". en cours : « " + titre + " » entre dans Maintenant et dans " + envie, () => {
    const ev = depuisSource(date("e" + n, titre, "2026-09-27T09:00:00", "2026-09-27T17:00:00"));
    assert.ok(retenu(ev, DIMANCHE_10H));
    assert.ok(M.explorerCategorie([ev], ctx(DIMANCHE_10H), envie).some((x) => x.id === ev.id));
  });
}

test("8. un marché nocturne ouvert entre dans Maintenant, Sortir et Manger", () => {
  const vingtH = paris("2026-10-02T20:00:00");
  const ev = depuisSource(date("n", "Marché nocturne du Pont", "2026-10-02T17:00:00", "2026-10-02T22:00:00"));
  assert.ok(retenu(ev, vingtH));
  for (const envie of ["sortir", "manger"])
    assert.ok(M.explorerCategorie([ev], ctx(vingtH), envie).some((x) => x.id === ev.id), envie);
  // l'objet reste unique : une envie de plus ne le duplique pas
  assert.equal(M.candidats([ev], ctx(vingtH)).length, 1);
});

test("9. un marché de Noël futur est À venir", () => {
  const ev = depuisSource(date("x", "Marché de Noël de Lille", "2026-11-20T10:00:00", "2026-11-20T20:00:00"));
  assert.equal(retenu(ev, DIMANCHE_10H), false);
  assert.equal(section(ev, DIMANCHE_10H), "a_venir");
  // et le jour même, à 15 h, il est en cours
  assert.ok(retenu(ev, paris("2026-11-20T15:00:00")));
});

test("12. un événement terminé est exclu", () => {
  const ev = depuisSource(date("f", "Braderie d'automne", "2026-09-26T08:00:00", "2026-09-26T15:00:00"));
  assert.equal(retenu(ev, DIMANCHE_10H), false);
  assert.equal(raison(ev, DIMANCHE_10H), M.RAISONS.DEJA_FINI);
});

test("une braderie « entrée libre » arrive aussi dans Gratuit", () => {
  const ev = depuisSource(date("g", "Grande Braderie d'Automne", "2026-09-27T08:00:00", "2026-09-27T17:00:00",
    { is_free: true }));
  assert.ok(M.explorerCategorie([ev], ctx(DIMANCHE_10H), "gratuit").some((x) => x.id === ev.id));
});

test("un marché OpenStreetMap ouvert n'est plus écarté comme commodité", () => {
  assert.equal(M.estCommodite("marche"), false);
  const halle = { id: "halle", estEvenement: false, annule: false, titre: "Marché", title: "Marché",
    categorie: "marche", entity_type: "place", canonical_id: "halle",
    canonical: { entity_type: "place", id: "halle", title: "Marché", category: "marche" },
    tempsValide: true, ferme: false, ouvert: true, current_status: "open", lat: ICI[0] + 0.004, lng: ICI[1] };
  assert.ok(M.candidats([halle], ctx(DIMANCHE_10H)).length === 1);
  // l'horaire inconnu, lui, reste dehors comme pour tout lieu
  const inconnu = Object.assign({}, halle, { id: "inconnu", ouvert: null, current_status: null, tempsValide: false });
  assert.equal(M.candidats([inconnu], ctx(DIMANCHE_10H)).length, 0);
});

/* ==========================================================================
   3. CLASSEMENT : AUCUNE PRIORITÉ AUTOMATIQUE
   ======================================================================== */

test("une braderie ne passe pas devant parce qu'elle est une braderie", () => {
  const loin = depuisSource(date("b", "Braderie", "2026-09-27T08:00:00", "2026-09-27T17:00:00"),
    null, { lat: ICI[0] + 0.02 });
  const proche = depuisSource(date("c", "Concert en plein air", "2026-09-27T09:00:00", "2026-09-27T12:00:00",
    { category: "concert" }), null, { lat: ICI[0] + 0.002, categorie: "concert", category: "concert",
    canonical: { entity_type: "event", id: "c", category: "concert" } });
  const ordre = M.candidats([loin, proche], ctx(DIMANCHE_10H)).map((c) => c.item.id);
  assert.deepEqual(ordre, ["c", "b"], "à nature égale, la distance décide — pas la famille");
  // et à l'inverse, la braderie proche passe devant le concert lointain
  const bProche = Object.assign({}, loin, { id: "b2", lat: ICI[0] + 0.002 });
  const cLoin = Object.assign({}, proche, { id: "c2", lat: ICI[0] + 0.02 });
  assert.deepEqual(M.candidats([cLoin, bProche], ctx(DIMANCHE_10H)).map((c) => c.item.id), ["b2", "c2"]);
});

/* ==========================================================================
   4. CE WEEK-END : UN MARCHÉ DU MARDI N'Y EST PAS
   ======================================================================== */

test("une récurrence repliée n'entre dans une fenêtre que si l'un de ses jours y tombe", () => {
  const jeudi = paris("2026-10-01T12:00:00");
  const fenetre = T.fenetreSurface("weekend", jeudi, "Europe/Paris");
  const base = { isTemporary: true, timezone: "Europe/Paris",
    start_at: "2026-01-01T06:00:00Z", end_at: "2026-12-31T13:00:00Z", date_confidence: "exact" };
  assert.equal(T.estDansFenetre(Object.assign({}, base, { joursRecurrence: [2, 4] }), fenetre, jeudi), false);
  assert.equal(T.estDansFenetre(Object.assign({}, base, { joursRecurrence: [0, 3, 5] }), fenetre, jeudi), true);
  // sans jours connus, la règle d'avant ne change pas
  assert.equal(T.estDansFenetre(base, fenetre, jeudi), true);
});

/* ==========================================================================
   5. LES SOURCES : LES FAUX TAGS DU NOM DE LIEU
   ======================================================================== */

test("« Place du Concert » et « électro-ménagers » ne font ni concert ni électro", async () => {
  const { enrichirTagsAnnonce } = await import("../supabase/functions/shared/announcement-tags.mjs");
  const tags = (r) => enrichirTagsAnnonce(r, { source: "datatourisme", includeStoredTags: false }).tags;
  assert.deepEqual(tags({ title: "Marché du Vieux-Lille", type: ["Market"],
    description: "Chaque mercredi, la Place du Concert s'anime avec le marché." }), ["market"]);
  assert.deepEqual(tags({ title: "Marché de Wazemmes", type: ["Market"],
    description: "les marchands de tissus, d’électro-ménagers et les artisans" }), ["market"]);
  assert.ok(tags({ title: "Soirée électro", description: "DJ set techno" }).includes("electro"));
  assert.ok(tags({ title: "Concert de jazz", description: "live" }).includes("concert"));
});
