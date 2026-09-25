-- ---------------------------------------------------------------------------
-- L'ADRESSE DE L'ORGANISATEUR SORT DU CHEMIN PUBLIC
--
-- `20260920100000` avait retourné un choix précédent et exposé `events.email`
-- au client, avec un raisonnement juste en apparence : « on expose ce qui est
-- AFFICHÉ », et la ligne « Réservation » propose désormais d'écrire quand il
-- n'y a ni lien ni numéro.
--
-- CE RAISONNEMENT N'AVAIT PAS ÉTÉ CHIFFRÉ. Mesuré en base le 25/09/2026, sur
-- 3 871 événements :
--
--   · 184 portent une adresse ;
--   ·  36 n'ont ni lien de réservation ni téléphone ;
--   ·   2 — DEUX — n'ont QUE l'adresse pour tout moyen de contact.
--
-- Et mesuré côté API, avec la clé publiable, en tant qu'anonyme :
-- `GET /rest/v1/events?select=email&email=not.is.null` rend la liste. Deux
-- fiches y gagnent un `mailto:` ; cent quatre-vingt-quatre organisateurs y
-- perdent le fait que leur adresse ne se récolte pas en une requête.
--
-- La proportion tranche : la RPC ne transporte plus `email`. La colonne reste
-- en base — elle vient de `registration[]`, elle documente la provenance, et
-- c'est elle que l'exception de la garde e-mail nomme — mais elle ne descend
-- plus dans le navigateur.
--
-- CE QU'ON NE FAIT PAS, ET POURQUOI. Retirer la colonne du droit de lecture
-- (`revoke select (email)`) demanderait de révoquer le SELECT de table puis de
-- le re-donner colonne par colonne : PostgreSQL ne sait pas soustraire une
-- colonne d'un droit de table. Chaque colonne ajoutée ensuite à `events`
-- deviendrait invisible pour `anon` — donc une panne silencieuse de la carte
-- au prochain `alter table`, sur une table qui en gagne régulièrement. Le
-- résidu est documenté et assumé : l'adresse reste lisible par qui interroge
-- la table, comme `phone` et `booking_url`, et comme OpenAgenda la publie déjà
-- sur la fiche publique dont elle vient.
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
  'Les événements à venir d''une zone, colonnes explicitement choisies. Porte booking_url, phone et website. PAS email : l''adresse de l''organisateur reste hors du chemin public (voir 20260925010000).';

grant execute on function public.evenements_locaux(
  text, double precision, double precision, double precision, double precision, integer
) to anon, authenticated;
