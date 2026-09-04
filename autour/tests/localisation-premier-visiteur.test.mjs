import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import "../zones-autonomes.js";
import "../temporel.js";
import "../maintenant.js";

const Z = globalThis.AutourZones;
const M = globalThis.AutourMaintenant;
const lire = (f) => readFile(fileURLToPath(new URL("../" + f, import.meta.url)), "utf8");

/* ==========================================================================
   OÙ EST QUELQU'UN QUI N'A JAMAIS OUVERT AUTOUR

   Trois questions, et une seule réponse honnête pour chacune :
     · quelle zone ?     — une vraie, ou aucune. Jamais une zone fabriquée.
     · quelle heure ?    — celle que la zone DÉCLARE. Jamais un défaut muet.
     · quoi lui dire ?   — une invitation, pas deux.
   ======================================================================== */

/* ==========================================================================
   1. LE FUSEAU EST DÉCLARÉ, JAMAIS DEVINÉ
   ======================================================================== */

test("chaque zone supportée déclare son fuseau", () => {
  /* Le contrôle qui rend le repli inoffensif. Tant qu'il passe, aucune zone
     ne peut hériter d'Europe/Paris par omission. */
  const sans = Z.DEFINITIONS.filter((z) => !z.timezone || typeof z.timezone !== "string");
  assert.deepEqual(sans.map((z) => z.id), [],
    "une zone sans timezone prendrait silencieusement celui du repli");
});

test("un fuseau déclaré est un identifiant IANA que le moteur temporel accepte", () => {
  for (const zone of Z.DEFINITIONS) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("fr-FR", { timeZone: zone.timezone }),
      zone.id + " : « " + zone.timezone + " » n'est pas un fuseau utilisable");
  }
});

test("le fuseau d'une zone connue vient de sa déclaration, sans repli possible", async () => {
  const src = await lire("app.js");
  const bloc = /function fuseauZoneActive\(\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(bloc, "fuseauZoneActive est introuvable");
  /* L'ancienne écriture faisait retomber une zone déclarée sans fuseau sur
     Paris, en silence. Elle ne doit pas revenir. */
  assert.doesNotMatch(bloc[0], /\(def && def\.timezone\) \|\| "Europe\/Paris"/);
  assert.match(bloc[0], /return def\.timezone;/,
    "une zone connue impose son fuseau");
  assert.match(bloc[0], /journal\.warn/,
    "une zone déclarée sans fuseau doit se signaler, pas passer inaperçue");
});

test("le repli hors zone porte un nom, et ce nom dit que c'est un repli", async () => {
  const src = await lire("app.js");
  assert.match(src, /const FUSEAU_SANS_ZONE = "Europe\/Paris";/);
  const bloc = /function fuseauZoneActive\(\)\{[\s\S]*?\n\}/.exec(src)[0];
  assert.match(bloc, /if\(!def\) return FUSEAU_SANS_ZONE;/);
});

/* ==========================================================================
   2. UNE ZONE, OU AUCUNE
   ======================================================================== */

test("le résolveur ne rattache jamais un point à la zone la plus proche", () => {
  /* Bordeaux est à ~200 km d'Angers, hors de tout rayon déclaré. */
  assert.equal(Z.zoneIdForPoint([44.8378, -0.5792]), null);
  /* Et juste au-delà du rayon d'une zone, la réponse reste « aucune ». */
  const angers = Z.definition("angers");
  const loin = [angers.lat + (angers.radiusM + 8000) / 111320, angers.lng];
  assert.equal(Z.zoneIdForPoint(loin), null);
});

test("les trois villes de référence tombent sur leur zone", () => {
  assert.equal(Z.zoneIdForPoint([47.4784, -0.5632]), "angers");
  assert.equal(Z.zoneIdForPoint([48.8566, 2.3522]), "paris");
  assert.equal(Z.zoneIdForPoint([50.6371, 3.0713]), "mel");   // Lille-Flandres
});

test("hors zone, Autour n'invente plus d'identifiant de zone", async () => {
  const src = await lire("app.js");
  const bloc = /const idZoneActive = [^;]+;/.exec(src);
  assert.ok(bloc, "idZoneActive est introuvable");
  /* `CTX.idZone` fabriquait « moi:44.84,-0.58 » — un identifiant qui passait
     ensuite toutes les portes ne refusant que « sans-zone ». */
  assert.doesNotMatch(bloc[0], /CTX\.idZone/);
  assert.match(bloc[0], /\|\| "sans-zone"/);
});

/* ==========================================================================
   3. HORS ZONE, « MAINTENANT » NE COMPOSE RIEN
   ======================================================================== */

const ICI = [44.8378, -0.5792];
const ctxHorsZone = (extra) => Object.assign({
  maintenant: Date.UTC(2026, 7, 14, 13, 0, 0), position: ICI,
  positionConnue: true, positionEnCours: false, positionRefusee: false,
  chargement: false, panne: false, timeZone: "Europe/Paris",
  zoneTerritoriale: false,
}, extra || {});

const lieuOuvert = (id, categorie) => ({
  id, categorie, cat: categorie, titre: "Lieu " + id, title: "Lieu " + id,
  entity_type: "place", canonical_id: id,
  canonical: { entity_type: "place", id, title: "Lieu " + id, category: categorie },
  tempsValide: true, ouvert: true, ferme: false,
  lat: ICI[0] + 0.0012, lng: ICI[1], adresse: "1 rue de Test",
});

test("hors zone, la sélection ne compose rien, même avec des lieux ouverts", () => {
  assert.deepEqual(M.selection([lieuOuvert("bar", "bar")], ctxHorsZone()), []);
});

test("hors zone, le filet nocturne ne s'ouvre pas non plus", () => {
  const nuit = ctxHorsZone({ maintenant: Date.UTC(2026, 7, 14, 23, 45, 0) });
  assert.deepEqual(M.selection([lieuOuvert("ep", "commerce")], nuit), []);
});

test("hors zone, l'état n'est ni « vide » ni « erreur » : il dit ce qui est vrai", () => {
  const etat = M.etat(Object.assign({ resultats: 0 }, ctxHorsZone()));
  assert.equal(etat, M.ETATS.HORS_ZONE);
  const mots = M.textes(etat, ctxHorsZone());
  assert.match(mots.ligne, /ne couvre pas encore/,
    "« rien d'ouvert dans cette zone » parlerait d'une zone qui n'existe pas");
  assert.ok(mots.sortie, "et la sortie doit rester ouverte : chercher une ville");
});

test("dans une zone, rien de tout cela ne change", () => {
  const dedans = ctxHorsZone({ zoneTerritoriale: true, position: [47.4784, -0.5632] });
  const lieu = Object.assign(lieuOuvert("bar", "bar"),
    { lat: 47.4784 + 0.0012, lng: -0.5632 });
  assert.equal(M.selection([lieu], dedans).length, 1);
  assert.equal(M.etat(Object.assign({ resultats: 1 }, dedans)), M.ETATS.READY);
});

test("un contexte sans le drapeau se comporte comme avant", () => {
  /* Les fixtures historiques ne le transmettent pas : seul un `false` explicite
     ferme la porte, jamais une absence. */
  const sansDrapeau = ctxHorsZone();
  delete sansDrapeau.zoneTerritoriale;
  assert.equal(M.selection([lieuOuvert("bar", "bar")], sansDrapeau).length, 1);
});

/* ==========================================================================
   4. UNE SEULE SOLLICITATION
   ======================================================================== */

test("le panneau d'accueil ferme le bandeau, et le bandeau refuse de le doubler", async () => {
  const src = await lire("app.js");
  const panneau = /function afficherOnboarding\([\s\S]*?\n\}/.exec(src);
  assert.ok(panneau);
  assert.match(panneau[0], /\$\("#bandeauGeo"\)[\s\S]{0,80}hidden = true;/,
    "poser le panneau doit fermer le bandeau");
  const bandeau = /function proposerPosition\(\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(bandeau);
  assert.match(bandeau[0], /#onboardingLocalisation[\s\S]{0,120}return;/,
    "le bandeau ne s'affiche pas tant que le panneau est là");
});

test("un refus laisse une porte visible, pas seulement un toast", async () => {
  const src = await lire("app.js");
  const bloc = /function terminerOnboardingLocalisation\([\s\S]*?\n\}/.exec(src);
  assert.ok(bloc);
  assert.match(bloc[0], /if\(resultat !== "ok"\) proposerPosition\(\);/,
    "après un refus, la voie manuelle doit rester à l'écran");
});

test("hors zone, la sortie ouvre vraiment la recherche de ville", async () => {
  const src = await lire("app.js");
  const bloc = /\[data-mn-sortie\][\s\S]*?\n  \}\);/.exec(src);
  assert.ok(bloc, "le gestionnaire de sortie est introuvable");
  assert.match(bloc[0], /ETATS\.HORS_ZONE\)\)\{[\s\S]{0,200}ouvrirRecherche\(\);/,
    "sans cela, « Chercher une ville » retombait sur la remise à zéro des filtres");
});

test("un seul geste déclenche la permission navigateur", async () => {
  const src = await lire("app.js");
  /* Le démarrage ne demande jamais la permission de lui-même en état
     « prompt » : il pose une invitation, et c'est le clic qui appelle. */
  const bloc = /async function demarrerLocalisation\(\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(bloc);
  assert.doesNotMatch(bloc[0], /etatPerm === "prompt"[\s\S]{0,200}suivreMaPosition/,
    "l'état « prompt » ne doit jamais appeler la géolocalisation sans geste");
  assert.match(bloc[0], /if\(etatPerm === "granted"\) suivreMaPosition\(\{silencieux:true\}\);/,
    "une permission déjà acquise se rafraîchit en silence, sans redemander");
});
