import assert from "node:assert/strict";
import test from "node:test";

await import("../events.js");

const {
  canauxActifs, sectionMessagesVisible, nonLus, decrireMessage,
  actionsPour, texteRetard, ciblesPartage, texteInvitation, ACTIONS_CREATEUR,
} = globalThis.AutourEvents;

const MOI = "11111111-1111-1111-1111-111111111111";
const AUTRE = "22222222-2222-2222-2222-222222222222";
const NOW = Date.UTC(2026, 7, 7, 12, 0);

test("sans événement, il n’y a pas de section Messages", () => {
  assert.equal(sectionMessagesVisible([], NOW), false);
  assert.equal(sectionMessagesVisible(null, NOW), false);
});

test("créer, rejoindre ou suivre un événement fait apparaître la section", () => {
  for(const role of ["admin", "participant", "suiveur"]){
    assert.equal(sectionMessagesVisible([{channel_id:"c", role}], NOW), true, role);
  }
});

test("un événement passé cesse d’être une raison d’avoir une boîte", () => {
  const vieux = {channel_id:"c", role:"participant", fin_le:new Date(NOW - 48*3600000).toISOString()};
  assert.equal(sectionMessagesVisible([vieux], NOW), false);
  // mais il reste visible dans les 24 h : c'est là qu'on lit « annulé »
  const recent = {channel_id:"c", role:"participant", fin_le:new Date(NOW - 3*3600000).toISOString()};
  assert.equal(sectionMessagesVisible([recent], NOW), true);
});

test("les non-lus ne comptent que les canaux encore actifs", () => {
  const canaux = [
    {channel_id:"a", role:"admin", non_lus:2},
    {channel_id:"b", role:"participant", non_lus:3},
    {channel_id:"c", role:"participant", non_lus:9, fin_le:new Date(NOW - 72*3600000).toISOString()},
  ];
  assert.equal(nonLus(canaux, NOW), 5);
  assert.equal(canauxActifs(canaux, NOW).length, 2);
});

test("un message système se distingue d’une annonce libre", () => {
  const systeme = decrireMessage({genre:"systeme", changement:"horaire",
    corps:"Horaire modifié : 20h30 au lieu de 20h."});
  assert.equal(systeme.systeme, true);
  assert.equal(systeme.etiquette, "Horaire modifié");
  assert.equal(systeme.urgent, false);

  const annonce = decrireMessage({genre:"annonce", corps:"Pensez à prendre un parapluie"});
  assert.equal(annonce.systeme, false);
  assert.equal(annonce.etiquette, "Annonce");
});

test("annulation et retard sont marqués urgents", () => {
  assert.equal(decrireMessage({genre:"systeme", changement:"annulation", corps:"Événement annulé."}).urgent, true);
  assert.equal(decrireMessage({genre:"systeme", changement:"retard", corps:"Retard."}).urgent, true);
  assert.equal(decrireMessage({genre:"systeme", changement:"lieu", corps:"Nouveau lieu : Parc."}).urgent, false);
});

test("les six actions du créateur sont toutes là", () => {
  assert.deepEqual(ACTIONS_CREATEUR.map(a=>a.id),
    ["horaire","lieu","retard","places","annonce","annulation"]);
  assert.equal(ACTIONS_CREATEUR.find(a=>a.id==="annulation").danger, true);
});

test("seul l’administrateur du canal peut annoncer", () => {
  assert.equal(actionsPour({admin:MOI, ferme:false}, MOI).length, 6);
  assert.equal(actionsPour({admin:AUTRE, ferme:false}, MOI).length, 0);
  assert.equal(actionsPour({admin:MOI, ferme:true}, MOI).length, 0);
  assert.equal(actionsPour(null, MOI).length, 0);
  assert.equal(actionsPour({admin:MOI}, null).length, 0);
});

test("un retard s’annonce en minutes, et refuse l’absurde", () => {
  assert.equal(texteRetard(30), "Retard annoncé : environ 30 min.");
  assert.equal(texteRetard(0), null);
  assert.equal(texteRetard(-10), null);
  assert.equal(texteRetard("bof"), null);
});

test("le partage couvre lien, SMS, WhatsApp, réseaux et e-mail", () => {
  const cibles = ciblesPartage("https://autour.test/e/42", "Concert au parc");
  assert.deepEqual(cibles.map(c=>c.id),
    ["lien","sms","whatsapp","telegram","facebook","email"]);

  const sms = cibles.find(c=>c.id==="sms");
  assert.match(sms.href, /^sms:\?&body=/);
  assert.match(sms.href, /Concert%20au%20parc/);
  assert.match(sms.href, /autour\.test/);

  const wa = cibles.find(c=>c.id==="whatsapp");
  assert.match(wa.href, /^https:\/\/wa\.me\/\?text=/);

  // le lien seul reste copiable, sans href
  const lien = cibles.find(c=>c.id==="lien");
  assert.equal(lien.href, null);
  assert.equal(lien.valeur, "https://autour.test/e/42");
});

test("le texte d’invitation reprend ce qui aide à venir", () => {
  assert.equal(
    texteInvitation({titre:"Concert", adresse:"Parc Lebas", quand:"Samedi 20h"}),
    "Concert · Parc Lebas · Samedi 20h");
  assert.equal(texteInvitation({titre:"Concert"}), "Concert");
  assert.equal(texteInvitation({}), "");
});
