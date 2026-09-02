#!/usr/bin/env node
/* Audit local et reproductible des médias réellement affichables.

   Par défaut, le script audite le pré-calcul Aide livré avec l'application.
   Pour un export Supabase ponctuel, passer `--json export.json` avec soit une
   liste, soit `{events, places, aide}`. Il ne télécharge aucune image et ne
   fait aucune recherche par nom : il vérifie seulement le contrat de source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../images.js";
import zones from "../data/aide-precalcule-villes.js";

const IMAGES = globalThis.AutourImages;
const arg = process.argv.indexOf("--json");
const fichier = arg >= 0 ? process.argv[arg + 1] : null;

function lireEntrees() {
  if (!fichier) {
    return {aide: Object.values(zones).flatMap((zone) => zone.records || [])};
  }
  const brut = JSON.parse(readFileSync(resolve(fichier), "utf8"));
  if (Array.isArray(brut)) return {items: brut};
  return brut || {};
}

function media(item, groupe) {
  if (!item) return null;
  const event = groupe === "events" || item.entity_type === "event" || item.isTemporary === true;
  return event && IMAGES.visuelEvenement
    ? IMAGES.visuelEvenement(item)
    : IMAGES.visuel(item);
}

function auditer(items, groupe) {
  const rows = Array.isArray(items) ? items : [];
  const provenance = {};
  let avecPhoto = 0;
  rows.forEach((item) => {
    const v = media(item, groupe);
    if (!v) return;
    avecPhoto += 1;
    provenance[v.image_source] = (provenance[v.image_source] || 0) + 1;
  });
  return {
    total: rows.length,
    avecPhoto,
    sansPhoto: rows.length - avecPhoto,
    provenance,
  };
}

const entrees = lireEntrees();
const groupes = Object.keys(entrees).filter((nom) => ["events", "places", "aide", "items"].includes(nom));
const resultat = {};
groupes.forEach((nom) => { resultat[nom] = auditer(entrees[nom], nom); });
console.log(JSON.stringify({contrat: [
  "image_url", "image_source", "image_source_url", "image_author",
  "image_license", "image_updated_at",
], resultat}, null, 2));
