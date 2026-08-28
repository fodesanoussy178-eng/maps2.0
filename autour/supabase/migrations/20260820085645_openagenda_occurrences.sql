-- ---------------------------------------------------------------------------
-- OpenAgenda : provenance d'agenda et occurrences distinctes
--
-- La couche `events` existante reste l'entrée canonique lue par Autour.
-- `event_occurrences` lui ajoute une ligne par créneau source afin qu'un
-- événement récurrent ne soit jamais aplati en une fausse plage continue.
-- La première phase n'active que le test Lille ; aucune importation complète
-- ni planification n'est créée ici.
-- ---------------------------------------------------------------------------

alter table public.event_sources
  add column if not exists source_agenda text,
  add column if not exists source_agenda_uid text;

comment on column public.event_sources.source_agenda is
  'Slug de l''agenda fournisseur, par exemple ville-de-lille.';
comment on column public.event_sources.source_agenda_uid is
  'UID de l''agenda fournisseur, distinct de l''UID de l''événement.';

create table if not exists public.event_occurrences (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events (id) on delete cascade,
  source               text not null,
  source_agenda        text not null,
  source_agenda_uid    text not null,
  source_event_id      text not null,
  source_occurrence_id text not null,

  start_at             timestamptz,
  end_at               timestamptz,
  timezone             text not null default 'Europe/Paris',
  date_confidence      text not null default 'unknown'
                         check (date_confidence in ('exact','day','unknown')),
  temporal_status      text not null default 'unknown_date'
                         check (temporal_status in ('now','soon','upcoming','past','unknown_date')),
  cancelled            boolean not null default false,

  raw_data             jsonb,
  last_source_update   timestamptz,
  last_synced_at       timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (source, source_occurrence_id)
);

comment on table public.event_occurrences is
  'Une ligne par créneau source. Les horaires multiples ne sont jamais fusionnés.';
comment on column public.event_occurrences.source_event_id is
  'UID de l''événement fournisseur ; identique pour toutes ses occurrences.';
comment on column public.event_occurrences.source_occurrence_id is
  'Identifiant natif OpenAgenda si disponible, sinon clé déterministe agenda + événement + début.';

create index if not exists event_occurrences_event_idx
  on public.event_occurrences (event_id, start_at);
create index if not exists event_occurrences_status_idx
  on public.event_occurrences (temporal_status, start_at);

create or replace function public.event_occurrences_avant_ecriture()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.temporal_status := public.event_temporal_status(
    new.start_at, new.end_at, new.date_confidence, new.cancelled, now());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists event_occurrences_avant_ecriture on public.event_occurrences;
create trigger event_occurrences_avant_ecriture
  before insert or update on public.event_occurrences
  for each row execute function public.event_occurrences_avant_ecriture();

alter table public.event_occurrences enable row level security;
revoke all on public.event_occurrences from anon, authenticated;
revoke all on function public.event_occurrences_avant_ecriture() from anon, authenticated, public;
