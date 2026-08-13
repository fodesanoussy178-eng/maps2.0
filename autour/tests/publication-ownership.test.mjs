import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const events = await readFile(new URL("../events.js", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase/migrations/20260810193000_propriete_publications.sql", import.meta.url),
  "utf8",
);
const migrationQuota = await readFile(
  new URL("../supabase/migrations/20260810194500_quota_publications_prive.sql", import.meta.url),
  "utf8",
);
const migrationCanaux = await readFile(
  new URL("../supabase/migrations/20260810203500_mes_canaux_security_invoker.sql", import.meta.url),
  "utf8",
);
const migrationCreatedBy = await readFile(
  new URL("../supabase/migrations/20260811003229_created_by_publications.sql", import.meta.url),
  "utf8",
);

test("la propriété est un uid Supabase et le pseudo reste seulement présentatif", () => {
  assert.match(migration, /creator_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /using \(creator_id = \(select auth\.uid\(\)\)\)/);
  assert.match(migration, /creator_name is not null/);
  assert.doesNotMatch(migration, /creator_name\s*=\s*\(?select auth\.uid/);
  assert.doesNotMatch(migration, /using \([^)]*creator_name/);
  assert.match(html, /creator_id:identite\.id, created_by:identite\.id/);
  assert.match(html, /creator_name:identite\.name, status:"active"/);
  assert.doesNotMatch(html, /p\.auteur|l\.auteur/);
});

test("la première publication ne demande que le pseudo puis crée la session anonyme", () => {
  const debut = html.indexOf("async function assurerIdentitePublication");
  const fin = html.indexOf("function estPublicationAMoi", debut);
  const identite = html.slice(debut, fin);
  assert.match(identite, /prompt\("Ton prénom ou pseudo \?"\)/);
  assert.match(identite, /assurerSessionAnonyme\(\)/);
  assert.ok(identite.indexOf("prompt(") < identite.indexOf("assurerSessionAnonyme()"));
  assert.match(html, /sb\.auth\.signInAnonymously\(\)/);
  assert.match(html, /localStorage\.setItem\(CLE_PSEUDO_CREATEUR, pseudo\)/);
  assert.match(html, /localStorage\.getItem\(CLE_PSEUDO_CREATEUR\)/);
});

test("RLS laisse lire publiquement et réserve toute mutation au créateur", () => {
  assert.match(migration, /alter table public\.publications enable row level security/);
  assert.match(migration, /for select[\s\S]*?to anon, authenticated[\s\S]*?using \(true\)/);
  assert.match(migration, /for insert[\s\S]*?creator_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /for update[\s\S]*?using \(creator_id = \(select auth\.uid\(\)\)\)[\s\S]*?with check/);
  assert.match(migration, /for delete[\s\S]*?using \(creator_id = \(select auth\.uid\(\)\)\)/);
  assert.match(migration, /grant select on public\.publications to anon, authenticated/);
  assert.match(migration, /grant insert, update, delete on public\.publications to authenticated/);
});

test("created_by est le propriétaire canonique et reste synchronisé avec la compatibilité", () => {
  assert.match(migrationCreatedBy, /add column if not exists created_by uuid/);
  assert.match(migrationCreatedBy, /set created_by = creator_id[\s\S]*?where created_by is null[\s\S]*?and creator_id is not null/);
  assert.match(migrationCreatedBy, /creator_id is null and created_by is null[\s\S]*?creator_id = created_by/);
  assert.match(migrationCreatedBy, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migrationCreatedBy, /using \(created_by = \(select auth\.uid\(\)\)\)/);
  assert.match(migrationCreatedBy, /new\.created_by is distinct from old\.created_by/);
  assert.match(html, /creator_id:identite\.id, created_by:identite\.id/);
  assert.match(html, /const createdBy = p\.created_by \|\| p\.creator_id \|\| null/);
});

test("les anciennes publications ne deviennent jamais la propriété du premier visiteur", () => {
  assert.match(migration, /set creator_id = auteur[\s\S]*?where creator_id is null and auteur is not null/);
  assert.match(migration, /alter column creator_id drop not null/);
  assert.match(migration, /on delete set null/);
  assert.match(migration, /creator_id is null then return new/);
  assert.doesNotMatch(migration, /creator_id\s*=\s*auth\.uid\(\)[\s\S]*where creator_id is null/i);
});

test("annuler suit active vers cancelled et ne supprime aucune ligne", () => {
  assert.match(migration, /status in \('active', 'cancelled'\)/);
  assert.match(migration, /old\.status = 'cancelled' and new\.status <> 'cancelled'/);
  assert.match(migration, /new\.status := 'cancelled'/);
  assert.match(events, /id: "annulation"[\s\S]*?champ: "status"/);
  assert.match(html, /\.update\(\{status:"cancelled"\}\)/);
  assert.match(html, /async function annulerPublication/);
  assert.match(html, /Annulé par l’organisateur/);
  assert.match(html, /Supprimer définitivement/);
});

test("l'interface ne montre les contrôles destructifs qu'au propriétaire", () => {
  assert.match(html, /const mien = estPublicationAMoi\(l\);/);
  assert.match(html, /mien[\s\S]*?id="btnModifier"[\s\S]*?id="btnAnnuler"[\s\S]*?id="btnSupprimer"/);
  assert.match(html, /: '<button id="btnSignal">Signaler<\/button>'/);
  assert.match(html, /id="btnPartLieu">Partager/);
  assert.match(html, /id="btnGarder"/);
  assert.match(html, /delete\(\)[\s\S]*?\.eq\("id", dbId\)\.select\("id"\)/);
  assert.match(html, /update\(propres\)[\s\S]*?\.eq\("id", dbId\)\.select\("id"\)/);
});

test("la requête publique conserve la priorité temporelle forte", () => {
  assert.match(migration, /when p\.debut_le <= now\(\)[\s\S]*?then 0/);
  assert.match(migration, /case when p\.debut_le >= now\(\) then p\.debut_le end asc nulls last/);
  assert.match(migration, /when p\.status = 'cancelled' then 2/);
});

test("la fonction de quota SECURITY DEFINER n'est pas exposée comme RPC publique", () => {
  assert.match(migrationQuota, /create or replace function private\.publications_recentes\(\)/);
  assert.match(migrationQuota, /private\.publications_recentes\(\) < 10/);
  assert.match(migrationQuota, /drop function if exists public\.publications_recentes\(\)/);
  assert.match(migrationQuota, /revoke all on schema private from public, anon/);
});

test("la liste des canaux s'exécute avec les droits de la session", () => {
  assert.match(migrationCanaux, /create or replace function public\.mes_canaux\(\)/);
  assert.match(migrationCanaux, /security invoker/);
  assert.match(migrationCanaux, /ep\.membre = \(select auth\.uid\(\)\)/);
});
