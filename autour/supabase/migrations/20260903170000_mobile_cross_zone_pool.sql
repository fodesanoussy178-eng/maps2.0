-- ---------------------------------------------------------------------------
-- Pool cross-zone mobile compact.
--
-- `Pour toi` ne doit jamais recevoir le catalogue complet d'une autre zone.
-- La zone locale reste servie par evenements_locaux(); cette RPC ne transporte
-- que les événements majeurs éligibles et les champs nécessaires au classement
-- et à l'affichage d'une proposition.
-- ---------------------------------------------------------------------------

drop function if exists public.evenements_majeurs_hors_zone(text, integer);

create function public.evenements_majeurs_hors_zone(
  p_active_zone_id text,
  p_limite integer default 24
)
returns table (
  id uuid,
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
  zone_id text,
  primary_source text,
  source_url text,
  event_source text,
  event_source_url text,
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
  artist_names text[],
  music_genres text[],
  event_kind text,
  importance_level text,
  importance_score integer,
  performers text[],
  organizer text,
  organizer_name text,
  ticket_url text,
  metro_area text,
  territory_slug text,
  is_major boolean,
  major_scope text
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    e.id, e.title, e.description, e.category, e.start_at, e.end_at,
    e.timezone, e.temporal_status, e.date_confidence, e.place_name,
    e.address, e.city, e.insee_code, e.lat, e.lng, e.zone_id,
    e.primary_source, e.source_url, e.event_source, e.event_source_url,
    e.image_url, e.image_source, e.image_source_url, e.image_author,
    e.image_license, e.image_updated_at, e.cancelled, e.last_source_update,
    e.last_synced_at, e.announced_at, e.presale_at, e.tickets_open_at,
    e.announcement_tags, e.artist_names, e.music_genres, e.event_kind,
    e.importance_level, e.importance_score, e.performers, e.organizer,
    e.organizer_name, e.ticket_url, null::text, null::text,
    e.is_major, e.major_scope
    from public.events e
   where e.zone_id is not null
     and e.zone_id <> p_active_zone_id
     and e.is_major = true
     and e.major_scope in ('regional', 'national')
     and e.importance_score >= 80
     and e.cancelled = false
     and e.start_at > now()
     and coalesce(cardinality(e.announcement_tags), 0) > 0
     and e.duplicate_of is null
   order by e.importance_score desc, e.announced_at desc nulls last, e.start_at asc
   limit least(greatest(coalesce(p_limite, 24), 1), 24);
$function$;

grant execute on function public.evenements_majeurs_hors_zone(text, integer)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contrats locaux compacts.
--
-- Les RPC historiques retournaient `setof events/publications`, donc chaque
-- nouvelle colonne de ces tables partait aussi vers le téléphone. Ces
-- fonctions gardent la même signature d'appel mais exposent uniquement les
-- champs réellement consommés par la carte, la feuille et Pour toi.
-- ---------------------------------------------------------------------------

drop function if exists public.evenements_locaux(
  text, double precision, double precision, double precision, double precision, integer
);

create function public.evenements_locaux(
  p_zone_id text,
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
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
  price_amount numeric,
  price_text text,
  is_free boolean,
  price_confidence text,
  audience text,
  min_age integer,
  reservation_required boolean,
  reservation_text text,
  place_name text,
  venue_name text,
  address text,
  city text,
  insee_code text,
  lat double precision,
  lng double precision,
  primary_source text,
  source_url text,
  event_source text,
  event_source_url text,
  place_source text,
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
  artist_names text[],
  music_genres text[],
  event_kind text,
  importance_level text,
  importance_score integer,
  performers text[],
  organizer text,
  organizer_name text,
  ticket_url text,
  zone_id text,
  is_major boolean,
  major_scope text
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    e.id, e.publication_id, e.title, e.description, e.category,
    e.start_at, e.end_at, e.timezone,
    public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                 e.cancelled, now()),
    e.date_confidence, e.price_amount, e.price_text, e.is_free,
    e.price_confidence, e.audience, e.min_age, e.reservation_required,
    e.reservation_text, e.place_name, e.venue_name, e.address, e.city,
    e.insee_code, e.lat, e.lng, e.primary_source, e.source_url,
    e.event_source, e.event_source_url, e.place_source, e.image_url,
    e.image_source, e.image_source_url, e.image_author, e.image_license,
    e.image_updated_at, e.cancelled, e.last_source_update, e.last_synced_at,
    e.announced_at, e.presale_at, e.tickets_open_at, e.announcement_tags,
    e.artist_names, e.music_genres, e.event_kind, e.importance_level,
    e.importance_score, e.performers, e.organizer, e.organizer_name,
    e.ticket_url, e.zone_id, e.is_major, e.major_scope
    from public.events e
   where e.zone_id = p_zone_id
     and e.lat between p_sud and p_nord
     and e.lng between p_ouest and p_est
     and e.publication_id is null
     and public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                      e.cancelled, now())
         = any (array['now','soon','upcoming','unknown_date'])
   order by case public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                                e.cancelled, now())
       when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,
     e.start_at nulls last
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;

grant execute on function public.evenements_locaux(
  text, double precision, double precision, double precision, double precision, integer
) to anon, authenticated;

drop function if exists public.publications_locales(
  text, double precision, double precision, double precision, double precision, integer
);

create function public.publications_locales(
  p_zone_id text,
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 120
)
returns table (
  id uuid,
  creator_id uuid,
  created_by uuid,
  creator_name text,
  cat text,
  titre text,
  adresse text,
  cp text,
  quand text,
  gratuit boolean,
  prix integer,
  places integer,
  lat double precision,
  lng double precision,
  debut_le timestamptz,
  fin_le timestamptz,
  verifie boolean,
  image_url text,
  status text,
  annule boolean,
  zone_id text,
  cree_le timestamptz
)
language sql
stable
security invoker
set search_path = public
as $function$
  select p.id, p.creator_id, p.created_by, p.creator_name,
    p.cat, p.titre, p.adresse, p.cp, p.quand, p.gratuit, p.prix,
    p.places, p.lat, p.lng, p.debut_le, p.fin_le, p.verifie,
    p.image_url, p.status, p.annule, p.zone_id, p.cree_le
    from public.publications p
   where p.zone_id = p_zone_id
     and p.lat between p_sud and p_nord
     and p.lng between p_ouest and p_est
     and (p.fin_le is null or p.fin_le > now())
   order by p.cree_le desc
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;

grant execute on function public.publications_locales(
  text, double precision, double precision, double precision, double precision, integer
) to anon, authenticated;
