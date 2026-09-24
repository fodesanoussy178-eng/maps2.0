-- ---------------------------------------------------------------------------
-- LES COORDONNÉES N'ARRIVAIENT PAS JUSQU'AU TÉLÉPHONE.
--
-- `20260903170000_mobile_cross_zone_pool.sql` a remplacé `setof events` par
-- une liste de colonnes explicite, et c'était la bonne décision : sans elle,
-- chaque colonne ajoutée à `events` partait dans la 4G de quelqu'un. Mais la
-- conséquence est qu'une colonne nouvelle n'arrive JAMAIS au client tant que
-- personne ne l'a nommée ici.
--
-- `booking_url`, `phone` et `website` sont exactement ce cas : posées par
-- `20260920090000`, remplies par `sync-openagenda`, et invisibles. Les boutons
-- « Appeler » et « Site web » restaient donc grisés sur une fiche dont la base
-- connaissait le numéro.
--
-- `email` RESTE DEHORS, ET C'EST DÉLIBÉRÉ. La fiche ne propose pas d'écrire :
-- rien ne la consomme, donc rien ne justifie de l'envoyer. Elle sert côté
-- opérateur, où elle est lue avec la clé de service. Le principe posé par la
-- migration d'origine tient : on expose ce qui est affiché, pas ce qui existe.
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
  booking_url text,
  phone text,
  website text,
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
  duplicate_of uuid,
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
    e.reservation_text, e.booking_url, e.phone, e.website,
    e.place_name, e.venue_name, e.address, e.city,
    e.insee_code, e.lat, e.lng, e.primary_source, e.source_url,
    e.event_source, e.event_source_url, e.place_source, e.image_url,
    e.image_source, e.image_source_url, e.image_author, e.image_license,
    e.image_updated_at, e.cancelled, e.last_source_update, e.last_synced_at,
    e.announced_at, e.presale_at, e.tickets_open_at, e.announcement_tags,
    e.artist_names, e.music_genres, e.event_kind, e.importance_level,
    e.importance_score, e.performers, e.organizer, e.organizer_name,
    e.ticket_url, e.zone_id, e.duplicate_of, e.is_major, e.major_scope
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

comment on function public.evenements_locaux(
  text, double precision, double precision, double precision, double precision, integer
) is
  'Les événements à venir d''une zone, colonnes explicitement choisies. Porte booking_url, phone et website — ce que la fiche affiche. Pas email : rien ne la consomme côté public.';

grant execute on function public.evenements_locaux(
  text, double precision, double precision, double precision, double precision, integer
) to anon, authenticated;
