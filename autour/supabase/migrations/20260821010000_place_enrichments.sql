-- ===========================================================================
-- LE CALQUE D'ENRICHISSEMENT — VERSIONNER CE QUI EXISTE DÉJÀ
--
-- Cette table et la fonction `enrichir-lieu` ont été créées directement sur le
-- projet Supabase, sans passer par une migration : elles vivaient donc en
-- production sans exister dans le dépôt. Personne ne pouvait les relire, les
-- rejouer sur un autre projet, ni savoir qu'elles étaient là — c'est
-- exactement ainsi qu'on reconstruit par erreur un système qu'on possède déjà.
--
-- Ce fichier ne CRÉE rien de neuf : il décrit l'état déployé, à l'identique,
-- de façon idempotente. Le rejouer sur la base actuelle ne change rien ; le
-- rejouer sur une base vierge reconstruit ce qui tourne aujourd'hui.
--
-- CE QUE LA TABLE EST. Un calque posé PAR-DESSUS la connaissance canonique
-- (`public.events`, les lieux OpenStreetMap, les publications). Chaque ligne
-- dit : voilà ce qu'une recherche a lu sur ce lieu, à cette date, dans ces
-- pages, avec cette confiance, et jusqu'à quand ça vaut.
--
-- CE QU'ELLE N'EST PAS. Une source de vérité. Si elle disparaît, Autour
-- fonctionne exactement comme avant — c'est la condition pour qu'une panne de
-- modèle ou de réseau ne casse rien.
--
-- La clé n'est pas un identifiant d'événement : `place_key` est calculée à
-- partir du nom normalisé et de la position arrondie (voir `cleLieu` dans
-- supabase/functions/enrichir-lieu/extraction.mjs), parce que les lieux
-- d'Autour viennent d'OpenStreetMap, de Google ou d'une publication et n'ont
-- aucun identifiant commun.
-- ===========================================================================

create table if not exists public.place_enrichments (
  id                bigint generated always as identity primary key,

  -- l'identité stable d'un lieu : nom normalisé + position à ~10 m
  place_key         text        not null unique,
  place_name        text        not null,
  commune           text,
  category          text,
  lat               double precision,
  lng               double precision,

  current_status    text        not null default 'unknown'
                      check (current_status in
                        ('open','closed','temporary_closed','permanently_closed','unknown')),
  today_hours       text,
  -- syntaxe OpenStreetMap : `availability.js` reste le SEUL lecteur d'horaires
  -- de l'application, on ne duplique pas sa grammaire
  opening_hours     text,
  next_open_at      timestamptz,
  temporary_closed  boolean,
  closure_reason    text,
  closure_until     date,

  programme_now     jsonb       not null default '[]'::jsonb,
  programme_soon    jsonb       not null default '[]'::jsonb,

  ticket_url        text,
  official_url      text,

  -- La provenance décide du pouvoir : seule une source officielle ou
  -- institutionnelle a le droit d'écraser un `opening_hours` OpenStreetMap.
  source_priority   text        not null
                      check (source_priority in ('site_officiel','agenda_officiel',
                        'billetterie_officielle','institutionnel','tiers')),
  -- Les pages réellement citées par l'ancrage. Sans elles, rien n'existe.
  sources           jsonb       not null default '[]'::jsonb,
  confidence        numeric     not null default 0
                      check (confidence >= 0 and confidence <= 1),

  -- la date de la SOURCE : c'est elle qui autorise à primer sur un tag ancien
  last_verified_at  timestamptz,
  -- la date de NOTRE appel : sert aussi à compter le budget du jour
  checked_at        timestamptz not null default now(),
  expires_at        timestamptz not null,

  model             text,
  run_ms            integer,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.place_enrichments is
  'Compléments vérifiés par recherche web sur les lieux dont une information critique manque. Une ligne absente est normal ; une colonne nulle veut dire « on ne sait pas ».';

create unique index if not exists place_enrichments_place_key_key
  on public.place_enrichments (place_key);
-- le budget du jour se compte en lisant les lignes vérifiées depuis minuit
create index if not exists place_enrichments_checked_idx
  on public.place_enrichments (checked_at desc);
create index if not exists place_enrichments_expires_idx
  on public.place_enrichments (expires_at);

-- LECTURE PUBLIQUE, ÉCRITURE RÉSERVÉE. Le calque améliore ce que tout le monde
-- voit ; le rendre privé n'aurait aucun sens. Mais il est produit par un
-- service qui a payé une vérification : aucune politique d'écriture n'existe,
-- et seul le rôle de service — qui contourne RLS — peut écrire.
alter table public.place_enrichments enable row level security;

drop policy if exists "enrichissements lisibles par tous" on public.place_enrichments;
create policy "enrichissements lisibles par tous"
  on public.place_enrichments for select
  using (true);

grant select on public.place_enrichments to anon, authenticated;
