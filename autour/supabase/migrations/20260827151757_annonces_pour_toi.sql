-- ---------------------------------------------------------------------------
-- Annonces événementielles — extension additive de la couche canonique
--
-- `events.start_at/end_at` restent les seules dates de l'événement. Les dates
-- d'annonce et de vente sont séparées, et la justification de chaque valeur
-- canonique voyage dans `announcement_provenance` tandis que la source brute
-- complète reste dans `event_sources.raw_data`.
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists announced_at timestamptz,
  add column if not exists presale_at timestamptz,
  add column if not exists tickets_open_at timestamptz,
  add column if not exists announcement_tags text[] not null default '{}',
  add column if not exists importance_level text not null default 'local',
  add column if not exists importance_score integer not null default 0,
  add column if not exists performers text[] not null default '{}',
  add column if not exists organizer text,
  add column if not exists ticket_url text,
  add column if not exists announcement_provenance jsonb not null default '{}'::jsonb;

comment on column public.events.announced_at is
  'Première annonce explicite fiable retenue pour l''événement. Sa source est dans announcement_provenance et event_sources.raw_data.';
comment on column public.events.presale_at is
  'Ouverture de la prévente explicitement publiée. Sa source est dans announcement_provenance et event_sources.raw_data.';
comment on column public.events.tickets_open_at is
  'Ouverture générale de la billetterie explicitement publiée. Sa source est dans announcement_provenance et event_sources.raw_data.';
comment on column public.events.announcement_provenance is
  'Justification par champ : source, external_id, source_url et valeur retenue pour chaque date ou URL d''annonce.';
comment on column public.events.start_at is
  'Date canonique de début de l''événement, exposée comme event_start_at dans l''adaptateur Pour toi.';
comment on column public.events.end_at is
  'Date canonique de fin de l''événement, exposée comme event_end_at dans l''adaptateur Pour toi.';

do $$
begin
  alter table public.events
    add constraint events_importance_level_check
    check (importance_level in ('local', 'important', 'major'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.events
    add constraint events_importance_score_check
    check (importance_score between 0 and 100);
exception when duplicate_object then null;
end $$;

create index if not exists events_annonces_idx
  on public.events (announced_at desc, start_at)
  where cancelled = false and start_at is not null;
create index if not exists events_announcement_tags_idx
  on public.events using gin (announcement_tags);

-- Porte de lecture dédiée, sur la même table et les mêmes dates canoniques.
-- `Maintenant` continue de passer par `evenements_proches` sans aucun changement.
create or replace function public.annonces_proches(
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 120
)
returns table (
  id uuid,
  title text,
  description text,
  category text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  date_confidence text,
  place_name text,
  address text,
  city text,
  insee_code text,
  lat double precision,
  lng double precision,
  primary_source text,
  source_url text,
  image_url text,
  cancelled boolean,
  last_source_update timestamptz,
  last_synced_at timestamptz,
  announced_at timestamptz,
  presale_at timestamptz,
  tickets_open_at timestamptz,
  announcement_tags text[],
  importance_level text,
  importance_score integer,
  performers text[],
  organizer text,
  ticket_url text,
  announcement_provenance jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.title, e.description, e.category,
         e.start_at, e.end_at, e.timezone, e.date_confidence,
         e.place_name, e.address, e.city, e.insee_code,
         e.lat, e.lng, e.primary_source, e.source_url, e.image_url,
         e.cancelled, e.last_source_update, e.last_synced_at,
         e.announced_at, e.presale_at, e.tickets_open_at,
         e.announcement_tags, e.importance_level, e.importance_score,
         e.performers, e.organizer, e.ticket_url, e.announcement_provenance
    from public.events e
   where e.lat between p_sud and p_nord
     and e.lng between p_ouest and p_est
     and e.cancelled = false
     and e.start_at > now()
     and coalesce(cardinality(e.announcement_tags), 0) > 0
   order by e.importance_score desc, e.announced_at desc nulls last,
            e.start_at asc
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$$;

comment on function public.annonces_proches(
  double precision, double precision, double precision, double precision, integer
) is
  'Annonces futures sur la couche events canonique. announced_at null reste À ne pas manquer, jamais une nouvelle annonce.';

revoke all on function public.annonces_proches(
  double precision, double precision, double precision, double precision, integer
) from public;
grant execute on function public.annonces_proches(
  double precision, double precision, double precision, double precision, integer
) to anon, authenticated;
