-- ===========================================================================
-- LE CONTEXTE TERRITORIAL TEMPORAIRE — 1/3 : schéma, RLS, lecture applicative
-- Source de vérité : autour/supabase/migrations/20260822090000_contexte_territorial_temporaire.sql
-- ===========================================================================

create table if not exists public.territorial_contexts (
  id                bigint generated always as identity primary key,
  slug              text not null unique
                    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  emoji             text not null default '📍'
                    check (char_length(emoji) between 1 and 8),

  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  -- l'instant à partir duquel le bouton existe en annonce. Nul = pas d'avant.
  preview_starts_at timestamptz,
  timezone          text not null default 'Europe/Paris',

  territory_id      bigint references public.territories (id) on delete cascade,

  active            boolean not null default false,
  -- plus petit = plus prioritaire, comme partout ailleurs dans Autour
  priority          integer not null default 100 check (priority between 1 and 10000),
  official_url      text,
  metadata          jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint territorial_contexts_fenetre_coherente check (ends_at > starts_at),
  constraint territorial_contexts_apercu_coherent
    check (preview_starts_at is null or preview_starts_at <= starts_at)
);

comment on table public.territorial_contexts is
  'Manifestations qui transforment temporairement un territoire. Une couche de contexte, jamais un second catalogue d''événements.';
comment on column public.territorial_contexts.preview_starts_at is
  'À partir de cet instant le bouton existe et annonce. Nul = aucune phase d''annonce.';
comment on column public.territorial_contexts.ends_at is
  'Après cet instant le contexte n''existe plus : le bouton disparaît sans intervention.';
comment on column public.territorial_contexts.metadata is
  'libelle = le mot du bouton ; sources_officielles = les sources qui font autorité sur CETTE manifestation ; rayon_visibilite_m = jusqu''où le bouton a un sens.';

create index if not exists territorial_contexts_fenetre_idx
  on public.territorial_contexts (coalesce(preview_starts_at, starts_at), ends_at)
  where active;
create index if not exists territorial_contexts_territory_idx
  on public.territorial_contexts (territory_id);

create table if not exists public.territorial_context_zones (
  id           bigint generated always as identity primary key,
  context_id   bigint not null
                 references public.territorial_contexts (id) on delete cascade,
  slug         text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name         text not null check (char_length(btrim(name)) between 1 and 120),

  lat          double precision check (lat between -90 and 90),
  lng          double precision check (lng between -180 and 180),
  radius_m     integer not null default 800 check (radius_m between 50 and 20000),
  contour      jsonb not null default '[]'::jsonb,

  priority     integer not null default 100 check (priority between 1 and 10000),
  metadata     jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (context_id, slug),
  -- une zone sans centre ET sans contour ne désigne rien
  constraint territorial_context_zones_geometrie
    check ((lat is not null and lng is not null) or jsonb_array_length(contour) >= 3)
);

comment on table public.territorial_context_zones is
  'Secteurs d''un contexte territorial. Une zone influence la pertinence, jamais la nature des objets qu''elle contient.';
comment on column public.territorial_context_zones.contour is
  'Géométrie officielle quand elle existe : [[lat,lng], …]. Sinon le couple centre/rayon, et metadata le dit.';

create index if not exists territorial_context_zones_context_idx
  on public.territorial_context_zones (context_id, priority);

drop trigger if exists territorial_contexts_touch_updated_at on public.territorial_contexts;
create trigger territorial_contexts_touch_updated_at
  before update on public.territorial_contexts
  for each row execute function private.territories_touch_updated_at();

drop trigger if exists territorial_context_zones_touch_updated_at on public.territorial_context_zones;
create trigger territorial_context_zones_touch_updated_at
  before update on public.territorial_context_zones
  for each row execute function private.territories_touch_updated_at();

-- ---- Lecture publique, et seulement dans la fenêtre -----------------------
alter table public.territorial_contexts enable row level security;
alter table public.territorial_context_zones enable row level security;

drop policy if exists "contextes: lecture dans la fenêtre" on public.territorial_contexts;
create policy "contextes: lecture dans la fenêtre"
  on public.territorial_contexts for select to anon, authenticated
  using (
    active
    and now() >= coalesce(preview_starts_at, starts_at)
    and now() < ends_at
  );

drop policy if exists "zones: lecture avec leur contexte" on public.territorial_context_zones;
create policy "zones: lecture avec leur contexte"
  on public.territorial_context_zones for select to anon, authenticated
  using (exists (
    select 1 from public.territorial_contexts c
    where c.id = territorial_context_zones.context_id
      and c.active
      and now() >= coalesce(c.preview_starts_at, c.starts_at)
      and now() < c.ends_at
  ));

grant select on public.territorial_contexts to anon, authenticated;
grant select on public.territorial_context_zones to anon, authenticated;
revoke insert, update, delete on public.territorial_contexts from anon, authenticated;
revoke insert, update, delete on public.territorial_context_zones from anon, authenticated;

-- ---- La lecture applicative ----------------------------------------------
create or replace function public.contextes_territoriaux(
  p_lat double precision default null,
  p_lng double precision default null,
  p_at  timestamptz default null
)
returns table (
  slug              text,
  name              text,
  emoji             text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  preview_starts_at timestamptz,
  timezone          text,
  territory_slug    text,
  priority          integer,
  official_url      text,
  metadata          jsonb,
  zone_slug         text,
  zone_name         text,
  zone_lat          double precision,
  zone_lng          double precision,
  zone_rayon_m      integer,
  zone_priorite     integer,
  zone_contour      jsonb,
  zone_metadata     jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with instant as (select coalesce(p_at, now()) as t),
  retenus as (
    select c.*
    from public.territorial_contexts c
    cross join instant i
    where c.active
      and i.t >= coalesce(c.preview_starts_at, c.starts_at)
      and i.t <  c.ends_at
      -- La portée : un contexte n'a rien à annoncer à quelqu'un qui n'est pas
      -- dans les parages. Sans position, on rend tout — c'est le client qui
      -- décidera, et il sait où il regarde.
      and (
        p_lat is null or p_lng is null
        or exists (
          select 1
          from public.territorial_context_zones z
          where z.context_id = c.id
            and z.lat is not null and z.lng is not null
            and 6371000 * 2 * asin(least(1, sqrt(
                  power(sin(radians(z.lat - p_lat) / 2), 2) +
                  cos(radians(p_lat)) * cos(radians(z.lat)) *
                  power(sin(radians(z.lng - p_lng) / 2), 2)
                )))
                <= coalesce((c.metadata ->> 'rayon_visibilite_m')::double precision, 25000)
        )
      )
  )
  select r.slug, r.name, r.emoji, r.starts_at, r.ends_at, r.preview_starts_at,
         r.timezone, t.slug, r.priority, r.official_url, r.metadata,
         z.slug, z.name, z.lat, z.lng, z.radius_m, z.priority, z.contour, z.metadata
  from retenus r
  left join public.territories t on t.id = r.territory_id
  left join public.territorial_context_zones z on z.context_id = r.id
  order by r.priority, r.starts_at, z.priority nulls last, z.slug nulls last;
$function$;

comment on function public.contextes_territoriaux(double precision, double precision, timestamptz) is
  'Contextes territoriaux existants à cet instant, avec leurs zones. Lecture seule, aucune collecte déclenchée.';

revoke all on function public.contextes_territoriaux(double precision, double precision, timestamptz) from public;
grant execute on function public.contextes_territoriaux(double precision, double precision, timestamptz)
  to anon, authenticated;
