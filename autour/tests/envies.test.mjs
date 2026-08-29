/* LE MODÈLE DE PRÉFÉRENCES.

   « Tes surveillances » n'a de valeur que si ce qu'on coche est encore là
   demain, et si l'on peut dire POURQUOI une proposition remonte. Ces tests
   portent sur ces deux promesses, et sur une troisième moins visible : le
   stockage peut être refusé par le navigateur, et l'application doit
   continuer de fonctionner. */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../envies.js", import.meta.url), "utf8");

/* Un localStorage de test, dont on peut couper l'écriture à volonté. */
function bac(options){
  const o = options || {};
  const memoire = new Map();
  const store = {
    getItem:(k)=>{ if(o.lectureCasse) throw new Error("bloqué"); return memoire.has(k)?memoire.get(k):null; },
    setItem:(k,v)=>{ if(o.ecritureCasse) throw new Error("quota"); memoire.set(k,String(v)); },
    removeItem:(k)=>memoire.delete(k),
  };
  const fenetre = {localStorage:store};
  new Function("window","localStorage", source)(fenetre, store);
  return {E:fenetre.AutourEnvies, memoire};
}

test("aucune envie n'est cochée par défaut", () => {
  const {E} = bac();
  assert.deepEqual(E.choisies(), [], "rien ne doit être suivi sans un clic");
});

test("le catalogue couvre les envies demandées", () => {
  const {E} = bac();
  const labels = E.CATALOGUE.map(e=>e.label);
  ["Rap","Artistes & concerts","Cinéma","Manga / Anime","Expositions","Sport","Football",
   "Mode","Food","Vie nocturne","Famille","Théâtre","Festivals"]
    .forEach(l=>assert.ok(labels.includes(l), "manque : "+l));
  // les genres sont des enfants de « Artistes & concerts », pas des envies de même rang
  ["rap","rnb","pop","afro","rock","electro","jazz","reggae","kpop","classical"]
    .forEach(id=>{
      const e = E.CATALOGUE.find(x=>x.id===id);
      assert.ok(e, "genre absent du catalogue : "+id);
      assert.equal(e.parent, "concerts", id+" doit pendre de concerts");
    });
  // chaque entrée porte de quoi s'afficher et de quoi reconnaître
  E.CATALOGUE.forEach(e=>{
    assert.ok(e.id && e.label && e.emoji, JSON.stringify(e));
    assert.ok(Array.isArray(e.cats) && Array.isArray(e.mots), e.id);
  });
});

test("cocher, décocher, et retrouver son choix", () => {
  const {E} = bac();
  E.definir("rap", true);
  E.definir("cinema", true);
  assert.deepEqual(E.choisies(), ["rap","cinema"]);
  assert.equal(E.suivie("rap"), true);
  E.basculer("rap");
  assert.deepEqual(E.choisies(), ["cinema"]);
  assert.equal(E.suivie("rap"), false);
});

test("l'ordre affiché est celui du catalogue, pas celui des clics", () => {
  const {E} = bac();
  E.definir("theatre", true);
  E.definir("rap", true);
  // « rap » vient avant « théâtre » dans le catalogue, quel que soit l'ordre
  assert.deepEqual(E.choisies(), ["rap","theatre"]);
});

test("le choix survit à un rechargement", () => {
  const {E, memoire} = bac();
  E.definir("manga", true);
  // une seconde vie de la page, sur le même stockage
  const fenetre = {localStorage:{
    getItem:(k)=>memoire.has(k)?memoire.get(k):null,
    setItem:(k,v)=>memoire.set(k,String(v)), removeItem:(k)=>memoire.delete(k)}};
  new Function("window","localStorage", source)(fenetre, fenetre.localStorage);
  assert.deepEqual(fenetre.AutourEnvies.choisies(), ["manga"]);
});

test("une envie inconnue est ignorée, elle ne casse pas la liste", () => {
  const {E, memoire} = bac();
  memoire.set(E.CLE, JSON.stringify(["rap","envie-supprimée-en-2027","cinema"]));
  const fenetre = {localStorage:{
    getItem:(k)=>memoire.has(k)?memoire.get(k):null,
    setItem:(k,v)=>memoire.set(k,String(v)), removeItem:(k)=>memoire.delete(k)}};
  new Function("window","localStorage", source)(fenetre, fenetre.localStorage);
  assert.deepEqual(fenetre.AutourEnvies.choisies(), ["rap","cinema"]);
});

test("un stockage cassé n'empêche pas d'utiliser l'application", () => {
  /* Navigation privée, quota plein, données de site bloquées : le choix vit
     alors le temps de la session. L'écran doit continuer de répondre. */
  const {E} = bac({ecritureCasse:true});
  E.definir("sport", true);
  assert.deepEqual(E.choisies(), ["sport"], "le choix vaut au moins pour la session");
  assert.equal(E.persistant(), false, "et l'interface peut le dire");
});

test("un stockage illisible repart d'une liste vide, sans exception", () => {
  const {E} = bac({lectureCasse:true});
  assert.deepEqual(E.choisies(), []);
  E.definir("food", true);
  assert.deepEqual(E.choisies(), ["food"]);
});

test("du JSON abîmé ne fait pas tomber l'écran", () => {
  const {E, memoire} = bac();
  memoire.set(E.CLE, "{ceci n'est pas du JSON");
  const fenetre = {localStorage:{
    getItem:(k)=>memoire.has(k)?memoire.get(k):null,
    setItem:(k,v)=>memoire.set(k,String(v)), removeItem:(k)=>memoire.delete(k)}};
  new Function("window","localStorage", source)(fenetre, fenetre.localStorage);
  assert.deepEqual(fenetre.AutourEnvies.choisies(), []);
});

/* ======================================================================== */
/*  Pourquoi une proposition remonte                                        */
/* ======================================================================== */

test("une catégorie reconnue rattache l'objet à l'envie", () => {
  const {E} = bac();
  E.definir("cinema", true);
  const p = E.pourquoi({cat:"cinema", titre:"Séance du soir"});
  assert.ok(p, "un cinéma doit se rattacher à l'envie Cinéma");
  assert.equal(p.envie, "cinema");
  assert.equal(p.solide, true, "une catégorie est une preuve solide");
});

test("un mot de l'annonce suffit, mais se dit moins fort", () => {
  const {E} = bac();
  E.definir("manga", true);
  const p = E.pourquoi({cat:"event", titre:"Japan Manga Wave"});
  assert.ok(p);
  assert.equal(p.envie, "manga");
  assert.equal(p.solide, false, "un mot du titre reste moins sûr qu'une catégorie");
});

test("rien de reconnu : on ne dit rien, on n'invente pas", () => {
  const {E} = bac();
  E.definir("rap", true);
  assert.equal(E.pourquoi({cat:"resto", titre:"Chez Gustave"}), null);
});

test("une envie NON suivie ne fait remonter personne", () => {
  const {E} = bac();
  // rien de coché : même un cinéma évident ne se justifie pas
  assert.equal(E.pourquoi({cat:"cinema", titre:"Séance"}), null);
  // et en demandant explicitement tout le catalogue, il se rattache
  const toutes = E.correspondances({cat:"cinema", titre:"Séance"}, false);
  assert.ok(toutes.some(c=>c.id === "cinema"));
});

test("la justification nomme l'envie, elle ne parle jamais dans le vague", () => {
  const {E} = bac();
  E.definir("expos", true);
  const p = E.pourquoi({cat:"musee", titre:"Vernissage"});
  assert.match(p.texte, /Expositions/);
  assert.doesNotMatch(p.texte, /pourrait|peut-être|sûrement/i);
});

test("les accents et la casse ne changent pas la reconnaissance", () => {
  const {E} = bac();
  E.definir("cinema", true);
  E.definir("theatre", true);
  assert.equal(E.pourquoi({cat:"", titre:"AVANT-PREMIÈRE au Majestic"}).envie, "cinema");
  assert.equal(E.pourquoi({cat:"", titre:"Une pièce de théâtre"}).envie, "theatre");
});

/* ======================================================================== */
/*  Ce que le modèle n'est PAS                                              */
/* ======================================================================== */

test("rien ne part sur le réseau et rien n'est déduit du comportement", () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|navigator\.sendBeacon/,
    "les envies ne quittent pas l'appareil");
  assert.doesNotMatch(source, /addEventListener\(\s*["']click/,
    "aucune envie ne se coche toute seule en observant les gestes");
});
