create table if not exists public.place_enrichments (
  id            bigint generated always as identity primary key,
  place_key     text not null unique,
  place_name    text not null,
  commune       text,
  category      text,
  lat           double precision,
  lng           double precision,
  current_status   text not null default 'unknown'
    check (current_status in ('open','closed','temporary_closed',
                              'permanently_closed','unknown')),
  today_hours      text,
  opening_hours    text,
  next_open_at     timestamptz,
  temporary_closed boolean,
  closure_reason   text,
  closure_until    date,
  programme_now    jsonb not null default '[]'::jsonb,
  programme_soon   jsonb not null default '[]'::jsonb,
  ticket_url       text,
  official_url     text,
  source_priority  text not null default 'tiers'
    check (source_priority in ('site_officiel','agenda_officiel',
                               'billetterie_officielle','institutionnel','tiers')),
  sources          jsonb not null default '[]'::jsonb,
  confidence       numeric(3,2) not null default 0
    check (confidence >= 0 and confidence <= 1),
  last_verified_at timestamptz,
  checked_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  model            text,
  run_ms           integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.place_enrichments is
  'Compléments vérifiés par recherche web sur les lieux dont une information critique manque. Une ligne absente est normal ; une colonne nulle veut dire « on ne sait pas ».';
comment on column public.place_enrichments.last_verified_at is
  'Date de la source, pas de notre appel : c''est elle qui autorise une donnée officielle récente à primer sur un opening_hours ancien.';
comment on column public.place_enrichments.expires_at is
  'Avant cette date, aucune nouvelle recherche. Vaut aussi pour les lieux sans réponse.';

create index if not exists place_enrichments_checked_idx
  on public.place_enrichments (checked_at desc);
create index if not exists place_enrichments_expires_idx
  on public.place_enrichments (expires_at);

alter table public.place_enrichments enable row level security;

drop policy if exists "enrichissements lisibles par tous" on public.place_enrichments;
create policy "enrichissements lisibles par tous"
  on public.place_enrichments for select
  to anon, authenticated
  using (true);

create or replace function public.touch_place_enrichment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists place_enrichments_touch on public.place_enrichments;
create trigger place_enrichments_touch
  before update on public.place_enrichments
  for each row execute function public.touch_place_enrichment();
