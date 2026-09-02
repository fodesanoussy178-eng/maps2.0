-- ===========================================================================
-- PHOTOS + DÉCLENCHEUR ÉDITORIAL DES ÉVÉNEMENTS MAJEURS
--
-- Le rendez-vous majeur existe déjà dans evenements_majeurs. Cette migration
-- ne crée donc aucune ligne Braderie : elle relie le contexte éditorial à la
-- clé existante, puis expose les occurrences présentes dans son bassin.
-- ===========================================================================

alter table public.territorial_contexts
  add column if not exists major_event_motif_titre text
    references public.evenements_majeurs (motif_titre) on delete restrict;

create index if not exists territorial_contexts_major_event_idx
  on public.territorial_contexts (major_event_motif_titre)
  where major_event_motif_titre is not null;

comment on column public.territorial_contexts.major_event_motif_titre is
  'Clé du rendez-vous éditorial majeur déjà présent dans evenements_majeurs. Elle déclenche le contexte sans dupliquer l''événement.';

-- Données de configuration : dates officielles, phases éditoriales et termes
-- d''association publiés. Le code reste identique pour un autre rendez-vous.
with majeur as (
  select motif_titre
  from public.evenements_majeurs
  where motif_titre = 'braderie de lille'
)
update public.territorial_contexts c
set major_event_motif_titre = m.motif_titre,
    emoji = '🛍️',
    starts_at = timestamptz '2026-09-05 08:00:00+02',
    ends_at = timestamptz '2026-09-06 18:00:00+02',
    preview_starts_at = timestamptz '2026-09-02 00:00:00+02',
    timezone = 'Europe/Paris',
    metadata = c.metadata || jsonb_build_object(
      'libelle', 'Braderie',
      'phase_jour_avant_ouverture', true,
      'association_terms', jsonb_build_array(
        'braderie de lille',
        'braderie des enfants',
        'pré-braderie',
        'braderie du cours st-so',
        'braderie 2026 au bistrot'
      ),
      'etats_bouton', jsonb_build_object(
        'avant', jsonb_build_object('emoji', '🛍️', 'suffixe', '· bientôt'),
        'jour', jsonb_build_object('emoji', '🛍️', 'suffixe', '· aujourd’hui'),
        'pendant', jsonb_build_object('emoji', '⚡', 'suffixe', '· maintenant')
      )
    ),
    updated_at = now()
from majeur m
where c.slug = 'braderie-lille-2026';

-- Le nouveau champ de déclenchement doit être visible par la lecture
-- applicative, sans ouvrir une seconde lecture de configuration.
drop function if exists public.contextes_territoriaux(double precision, double precision, timestamptz);

create function public.contextes_territoriaux(
  p_lat double precision default null,
  p_lng double precision default null,
  p_at timestamptz default null
)
returns table (
  slug text,
  name text,
  emoji text,
  starts_at timestamptz,
  ends_at timestamptz,
  preview_starts_at timestamptz,
  timezone text,
  territory_slug text,
  priority integer,
  official_url text,
  metadata jsonb,
  major_event_motif_titre text,
  zone_slug text,
  zone_name text,
  zone_lat double precision,
  zone_lng double precision,
  zone_rayon_m integer,
  zone_priorite integer,
  zone_contour jsonb,
  zone_metadata jsonb
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
      and i.t < c.ends_at
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
            ))) <= coalesce((c.metadata ->> 'rayon_visibilite_m')::double precision, 25000)
        )
      )
  )
  select r.slug, r.name, r.emoji, r.starts_at, r.ends_at, r.preview_starts_at,
         r.timezone, t.slug, r.priority, r.official_url, r.metadata,
         r.major_event_motif_titre,
         z.slug, z.name, z.lat, z.lng, z.radius_m, z.priority, z.contour, z.metadata
  from retenus r
  left join public.territories t on t.id = r.territory_id
  left join public.territorial_context_zones z on z.context_id = r.id
  order by r.priority, r.starts_at, z.priority nulls last, z.slug nulls last;
$function$;

comment on function public.contextes_territoriaux(double precision, double precision, timestamptz) is
  'Contextes territoriaux existants à cet instant, avec zones et clé de déclenchement éditorial. Lecture seule.';

revoke all on function public.contextes_territoriaux(double precision, double precision, timestamptz) from public;
grant execute on function public.contextes_territoriaux(double precision, double precision, timestamptz)
  to anon, authenticated;

-- Occurrences réellement présentes dans le bassin du contexte. Chaque ligne
-- reste une animation distincte ; duplicate_of écarte la même fiche publiée
-- par deux catalogues, sans fusionner les petites braderies entre elles.
create or replace function public.evenements_contexte(
  p_context text,
  p_limite integer default 120
)
returns table (
  id uuid,
  publication_id uuid,
  title text,
  description text,
  category text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  temporal_status text,
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
  image_source text,
  image_source_url text,
  image_author text,
  image_license text,
  image_updated_at timestamptz,
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
  announcement_provenance jsonb,
  metro_area text,
  territory_slug text,
  territory_distance_km double precision,
  major_event_motif_titre text,
  major_event_nom text,
  major_event_motif text,
  context_relation text
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with contexte as materialized (
    select c.*, t.slug as basin_slug, t.group_slug
    from public.territorial_contexts c
    join public.territories t on t.id = c.territory_id
    join public.evenements_majeurs m on m.motif_titre = c.major_event_motif_titre
    where c.slug = p_context
      and c.active
      and now() >= coalesce(c.preview_starts_at, c.starts_at)
      and now() < c.ends_at
  ),
  candidats as materialized (
    select e.*, c.basin_slug, c.group_slug, c.major_event_motif_titre,
      m.nom as major_event_nom, m.motif as major_event_motif,
      basin.distance_km as territory_distance_km
    from public.events e
    join contexte c on true
    join public.evenements_majeurs m on m.motif_titre = c.major_event_motif_titre
    left join lateral (
      select t.group_slug, t.slug,
        6371 * 2 * asin(least(1, sqrt(
          power(sin(radians(t.latitude - e.lat) / 2), 2) +
          cos(radians(e.lat)) * cos(radians(t.latitude)) *
          power(sin(radians(t.longitude - e.lng) / 2), 2)
        ))) as distance_km
      from public.territories t
      where t.active and t.status = 'active' and t.group_slug is not null
        and 6371 * 2 * asin(least(1, sqrt(
          power(sin(radians(t.latitude - e.lat) / 2), 2) +
          cos(radians(e.lat)) * cos(radians(t.latitude)) *
          power(sin(radians(t.longitude - e.lng) / 2), 2)
        ))) <= t.radius_km
      order by distance_km, t.radius_km
      limit 1
    ) basin on true
    where e.duplicate_of is null
      and coalesce(e.cancelled, false) = false
      and e.geom is not null
      and e.start_at < c.ends_at
      and coalesce(e.end_at, e.start_at) >= c.starts_at -
        (coalesce((c.metadata ->> 'association_avant_heures')::double precision, 24) || ' hours')::interval
      and basin.group_slug = c.group_slug
      and basin.slug = c.basin_slug
      and (
        public.event_texte_normalise(e.title) ~ ('^(la |le |les |l )?' || m.motif_titre || '( |$)')
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(c.metadata -> 'association_terms', '[]'::jsonb)) term
          where public.event_texte_normalise(coalesce(e.title, '') || ' ' || coalesce(e.description, ''))
            like '%' || public.event_texte_normalise(term) || '%'
        )
      )
  )
  select c.id, c.publication_id, c.title, c.description, c.category,
    c.start_at, c.end_at, c.timezone,
    case
      when c.start_at <= now() and coalesce(c.end_at, c.start_at) >= now() then 'now'
      when c.start_at > now() and c.start_at - now() <= public.event_soon_window() then 'soon'
      else 'upcoming'
    end,
    c.date_confidence, c.place_name, c.address, c.city, c.insee_code,
    c.lat, c.lng, c.primary_source, c.source_url, c.image_url, c.image_source,
    c.image_source_url, c.image_author, c.image_license, c.image_updated_at,
    c.cancelled, c.last_source_update, c.last_synced_at, c.announced_at,
    c.presale_at, c.tickets_open_at, c.announcement_tags, c.importance_level,
    c.importance_score, c.performers, c.organizer, c.ticket_url,
    c.announcement_provenance, c.group_slug, c.basin_slug,
    c.territory_distance_km, c.major_event_motif_titre, c.major_event_nom,
    c.major_event_motif, 'associated'
  from candidats c
  order by case when c.start_at <= now() and coalesce(c.end_at, c.start_at) >= now()
    then 0 when c.start_at > now() then 1 else 2 end,
    c.start_at nulls last, c.title
  limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;

comment on function public.evenements_contexte(text, integer) is
  'Animations réellement présentes dans le bassin d''un contexte majeur. Chaque événement reste distinct ; les doublons de catalogues sont exclus par duplicate_of.';

revoke all on function public.evenements_contexte(text, integer) from public;
grant execute on function public.evenements_contexte(text, integer) to anon, authenticated;
