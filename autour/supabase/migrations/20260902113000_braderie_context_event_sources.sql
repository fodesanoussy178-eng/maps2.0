/* ===========================================================================
   ASSOCIATION CANONIQUE D'UN CONTEXTE ET DE SES OCCURRENCES

   Un contexte éditorial est identifié par sa clé stable (`slug`). Ses
   occurrences ne sont pas découvertes dans le titre : elles sont rattachées
   par la clé stable de leur source canonique. Un rapprochement OpenAgenda
   reste donc valable après une nouvelle synchronisation ou un changement de
   titre, et ne peut pas aspirer un événement qui ne lui appartient pas.
   =========================================================================== */

create table if not exists public.territorial_context_event_sources (
  context_id  bigint not null references public.territorial_contexts(id) on delete cascade,
  source      text not null,
  external_id text not null,
  relation    text not null default 'associated'
    check (relation in ('associated')),
  created_at  timestamptz not null default now(),
  primary key (context_id, source, external_id)
);

comment on table public.territorial_context_event_sources is
  'Rattachements éditoriaux explicites par identité de source. Aucun titre ou contenu textuel ne décide de l''appartenance.';

comment on column public.territorial_context_event_sources.external_id is
  'Identifiant stable de la source canonique, ici l''UID OpenAgenda, jamais le titre de l''événement.';

create index if not exists territorial_context_event_sources_lookup_idx
  on public.territorial_context_event_sources (source, external_id);

alter table public.territorial_context_event_sources enable row level security;

drop policy if exists "rattachements: lecture des contextes actifs"
  on public.territorial_context_event_sources;
create policy "rattachements: lecture des contextes actifs"
  on public.territorial_context_event_sources for select to anon, authenticated
  using (exists (
    select 1
    from public.territorial_contexts c
    where c.id = territorial_context_event_sources.context_id
      and c.active
  ));

grant select on public.territorial_context_event_sources to anon, authenticated;
revoke insert, update, delete on public.territorial_context_event_sources from anon, authenticated;

/* Les six occurrences actuellement publiées pour le contexte sont identifiées
   par leur UID OpenAgenda. Cette liste est la relation éditoriale : elle ne
   dépend ni du nom affiché ni d'une mention de « Braderie de Lille » dans le
   contenu. Les prochaines occurrences sont ajoutées ici par une relation de
   source explicite, jamais par une recherche textuelle. */
insert into public.territorial_context_event_sources (context_id, source, external_id)
select c.id, 'openagenda', v.external_id
from public.territorial_contexts c
cross join (values
  ('97857123'), -- BBBig BBBraderie du Cours St-So 2026
  ('80189468'), -- La Pré-Braderie de St So !
  ('93247546'), -- Brocante vélos spéciale « Braderie de Lille »
  ('33323059'), -- Braderie des enfants
  ('78801027'), -- Atelier « porte-clef moule » - Braderie des enfants 2026
  ('21700862')  -- Braderie 2026 au Bistrot !
) as v(external_id)
where c.slug = 'braderie-lille-2026'
on conflict (context_id, source, external_id) do nothing;

/* Le contexte porte désormais la règle d'association lisible par les outils
   d'administration. Les anciennes métadonnées sont conservées pour audit ;
   la fonction canonique ci-dessous ne les consulte plus. Le slug du contexte
   reste l'identifiant canonique ; il ne s'agit pas d'une nouvelle occurrence
   en base. */
update public.territorial_contexts
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'association_mode', 'event_sources',
      'association_context_key', 'braderie-lille-2026'
    ),
    updated_at = now()
where slug = 'braderie-lille-2026'
  and (
    metadata ->> 'association_mode' is distinct from 'event_sources'
    or metadata ->> 'association_context_key' is distinct from 'braderie-lille-2026'
  );

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
      and exists (
        select 1
        from public.territorial_context_event_sources r
        join public.event_sources s
          on s.source = r.source
         and s.external_id = r.external_id
         and s.event_id = e.id
        where r.context_id = c.id
          and r.relation = 'associated'
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
  'Occurrences d''un contexte liées par event_sources. Aucun rapprochement par titre ou description.';

revoke all on function public.evenements_contexte(text, integer) from public;
grant execute on function public.evenements_contexte(text, integer) to anon, authenticated;
