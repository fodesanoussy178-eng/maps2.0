import test from "node:test";
import assert from "node:assert/strict";
import "../comprendre.js";
import "../intentions.js";
import "../aide.js";

const AIDE = globalThis.AutourAide;

const domaine = (phrase) => AIDE.domaineDeLaPhrase(phrase).domaine;
const requete = (phrase) => AIDE.domaineDeLaPhrase(phrase).requete || null;

/* ======================================================================== */
/*  Ce qui appartient à Aide                                                */
/* ======================================================================== */

test("les phrases de détresse restent dans Aide", () => {
  const phrases = [
    "je n'ai rien à manger",
    "je n'ai plus rien à manger",
    "je dors dehors",
    "j'ai besoin d'aide pour mes démarches",
    "j'ai besoin d'aide pour une démarche",
    "je n'arrive plus à payer mon loyer",
    "j'ai 20 ans et je trouve pas de travail",
    "je suis à la rue",
    "j'ai besoin d'une douche",
    "je n'ai pas de mutuelle",
  ];
  for (const p of phrases) {
    assert.equal(domaine(p), "aide", `« ${p} » doit rester dans Aide`);
  }
});

test("un symptôme sans objet nommé ne part jamais chez un réparateur", () => {
  // « cassé » parle ici d'une personne, pas d'une chose
  for (const p of ["je suis cassé", "je suis en panne", "tout est cassé chez moi",
                   "ça ne marche plus du tout"]) {
    assert.equal(domaine(p), "aide", `« ${p} » n'est pas une réparation`);
  }
});

test("un objet nommé sans panne ne conclut à rien", () => {
  assert.equal(domaine("j'ai vendu mon vélo"), "aide");
  assert.equal(domaine("je suis venu en voiture"), "aide");
});

test("une phrase vide ou illisible reste dans Aide", () => {
  for (const p of ["", null, undefined, "   ", "azerty qwerty"]) {
    assert.equal(domaine(p), "aide");
  }
});

/* ======================================================================== */
/*  Ce qui appartient à Explorer                                            */
/* ======================================================================== */

test("les quatre cas demandés partent vers Explorer avec la bonne recherche", () => {
  assert.equal(domaine("mon vélo est cassé"), "explorer");
  assert.match(requete("mon vélo est cassé"), /vélo/i);

  assert.equal(domaine("mon vélo est crevé"), "explorer");
  assert.match(requete("mon vélo est crevé"), /vélo/i);

  assert.equal(domaine("mon téléphone est cassé"), "explorer");
  assert.match(requete("mon téléphone est cassé"), /téléphone/i);

  assert.equal(domaine("mon ordinateur est cassé"), "explorer");
  assert.match(requete("mon ordinateur est cassé"), /informatique/i);
});

test("chaque redirection nomme ce qui a été compris", () => {
  const r = AIDE.domaineDeLaPhrase("mon vélo est cassé");
  assert.equal(r.raison, "reparation");
  assert.ok(r.libelle && r.libelle.length > 3, "un libellé lisible est nécessaire");
  assert.ok(r.requete && r.requete.length > 3, "une requête utilisable est nécessaire");
});

test("d'autres pannes courantes trouvent leur métier", () => {
  const attendus = [
    ["ma serrure est bloquée", /serrurier/i],
    ["j'ai une fuite d'eau", /plombier/i],
    ["mon frigo ne marche plus", /électroménager/i],
    ["ma machine à laver est en panne", /électroménager/i],
    ["ma voiture est en panne", /garage/i],
    ["mes lunettes sont cassées", /opticien/i],
  ];
  for (const [phrase, motif] of attendus) {
    assert.equal(domaine(phrase), "explorer", `« ${phrase} » relève d'Explorer`);
    assert.match(requete(phrase), motif);
  }
});

test("un service explicitement cherché relève d'Explorer", () => {
  assert.equal(domaine("je cherche un coiffeur"), "explorer");
  assert.equal(domaine("je cherche un vétérinaire"), "explorer");
});

/* ======================================================================== */
/*  Les arbitrages difficiles                                               */
/* ======================================================================== */

test("« machine à LAVER » ne doit pas être lu comme un besoin d'hygiène", () => {
  // « laver » est un mot du besoin hygiène (douche, laverie). Un mot isolé ne
  // doit pas l'emporter sur une panne caractérisée.
  assert.equal(domaine("ma machine à laver est en panne"), "explorer");
  assert.match(requete("ma machine à laver est en panne"), /électroménager/i);
  // mais le besoin d'hygiène lui-même reste intact
  assert.equal(domaine("j'ai besoin de me laver"), "aide");
  assert.equal(domaine("où est-ce que je peux prendre une douche"), "aide");
});

test("dans le doute, la détresse l'emporte sur la réparation", () => {
  assert.equal(domaine("je n'ai plus rien à manger et mon vélo est cassé"), "aide",
    "quelqu'un qui n'a pas de quoi manger ne doit pas être envoyé chez un réparateur");
  assert.equal(domaine("ma voiture ne démarre plus et je dors dehors"), "aide");
});

test("une urgence n'est jamais détournée", () => {
  const r = AIDE.domaineDeLaPhrase("je dors dehors");
  assert.equal(r.domaine, "aide");
  assert.equal(r.raison, "urgence");
});

test("les objets et services déclarés sont bien formés", () => {
  for (const famille of [...AIDE.OBJETS_REPARABLES, ...AIDE.SERVICES_EXPLORER]) {
    assert.ok(famille.id, "chaque famille a un identifiant");
    assert.ok(famille.mots.length, famille.id + " doit avoir des mots");
    assert.ok(famille.requete, famille.id + " doit mener à une recherche");
    assert.ok(famille.libelle, famille.id + " doit être nommable à l'écran");
  }
});
