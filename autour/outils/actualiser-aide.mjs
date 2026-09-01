/*
 * Rafraîchit le pré-calcul Aide sans embarquer les exports nationaux dans le
 * dépôt. Le job est adapté à une exécution périodique CI : il découvre les
 * dernières ressources publiées par data.gouv.fr, les télécharge dans un
 * répertoire temporaire, puis régénère uniquement l'index des zones.
 *
 *   node outils/actualiser-aide.mjs
 *   node outils/actualiser-aide.mjs --output data/aide-precalcule-villes.js
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/referentiel-de-loffre-dinsertion-sociale-et-professionnelle-data-inclusion/";
const SOURCE_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

function argument(nom, defaut) {
  const index = process.argv.indexOf(nom);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

async function telecharger(url, chemin) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  await writeFile(chemin, Buffer.from(await response.arrayBuffer()));
}

function ressource(resources, motif) {
  const candidates = resources.filter((resource) => motif.test(String(resource.title || resource.url || "")));
  const resource = candidates.find((item) => /\.json(?:\?|$)/i.test(String(item.url))) || candidates[0];
  if (!resource?.url) throw new Error(`ressource introuvable: ${motif}`);
  return resource;
}

function lancer(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`pré-calcul arrêté (${code})`)));
  });
}

const metadata = await json(DATASET_API);
const structures = ressource(metadata.resources || [], /structures[-_ ]inclusion/i);
const services = ressource(metadata.resources || [], /services[-_ ]inclusion/i);
const date = SOURCE_DATE_RE.exec(String(structures.url))?.[1] ||
  SOURCE_DATE_RE.exec(String(metadata.last_update || ""))?.[1] || new Date().toISOString().slice(0, 10);
const temporary = await mkdtemp(join(tmpdir(), "autour-aide-"));
const structuresPath = join(temporary, "structures.json");
const servicesPath = join(temporary, "services.json");
const outputPath = argument("--output", "data/aide-precalcule-villes.js");

try {
  await Promise.all([
    telecharger(structures.url, structuresPath),
    telecharger(services.url, servicesPath),
  ]);
  await lancer(fileURLToPath(new URL("./precalcul-aide.mjs", import.meta.url)), [
    "--structures", structuresPath,
    "--services", servicesPath,
    "--output", outputPath,
    "--snapshot-date", date,
  ]);
  console.log(JSON.stringify({ snapshotDate: date, structures: structures.url, services: services.url }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
