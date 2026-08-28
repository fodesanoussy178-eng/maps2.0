/*
  Alimentation des annonces et bassin métropolitain.

  Cette migration est additive et idempotente. Elle ne fabrique aucune date :
  seules les clés de publication explicites et horodatées sont retenues. Les
  tags proviennent exclusivement de champs catégoriels des sources, jamais du
  titre ou de la description.
*/

create schema if not exists private;

alter table public.events
  add column if not exists duplicate_of uuid references public.events(id) on delete set null;

create index if not exists events_duplicate_of_idx
  on public.events (duplicate_of)
  where duplicate_of is not null;

create or replace function private.announcement_tags(
  p_source text,
  p_category text,
  p_raw jsonb
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  with valeurs(value) as (
    select nullif(p_category, '')
    union all
    select item #>> '{}'
      from jsonb_each(case when jsonb_typeof(p_raw->'keywords') = 'object'
                            then p_raw->'keywords' else '{}'::jsonb end) e
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end
      ) item
    union all
    select item #>> '{}'
      from jsonb_array_elements(
        case when jsonb_typeof(p_raw->'keywords') = 'array'
             then p_raw->'keywords' else '[]'::jsonb end
      ) item
    union all
    select item #>> '{}'
      from jsonb_array_elements(
        case when jsonb_typeof(p_raw->'tags') = 'array'
             then p_raw->'tags' else '[]'::jsonb end
      ) item
  ), normalisees as (
    select lower(trim(regexp_replace(
      translate(coalesce(value, ''),
        'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'),
      '[^a-z0-9_&]+', ' ', 'g'))) as value
    from valeurs
    where nullif(trim(value), '') is not null
  ), mapees as (
    select unnest(case
      when value in ('music','rap','hip_hop','rnb','afro','pop','rock','electro','jazz',
                     'reggae','kpop','classical','dj_set','showcase','concert','live',
                     'culture','exhibition','vernissage','theatre','dance','standup',
                     'cinema','premiere','artist_meeting','festival','manga_anime_gaming',
                     'manga','anime','convention','cosplay','gaming','tournament','signing',
                     'popup','sport','football','basketball','combat_sports','running','match',
                     'fashion_lifestyle','fashion','sneakers','streetwear','popup_store','drop',
                     'creators_market','local','braderie','neighbourhood_party','market',
                     'street_festival','association_event','automobile') then array[value]
      when value in ('hip hop','hip-hop') then array['music','hip_hop']
      when value in ('r&b','r b') then array['music','rnb']
      when value in ('dj set') then array['music','dj_set']
      when p_source = 'openagenda' and value ~ '(^| )rap( |$)' then array['music','rap']
      when p_source = 'openagenda' and value ~ 'hip[ -]?hop' then array['music','hip_hop']
      when p_source = 'openagenda' and value ~ '(concert|musique|live|showcase)' then array['music','concert']
      when p_source = 'openagenda' and value ~ '(cinema|projection|film)' then array['culture','cinema']
      when p_source = 'openagenda' and value ~ '(exposition|expo|musee|vernissage)' then array['culture','exhibition']
      when p_source = 'openagenda' and value ~ '(theatre|danse|cirque|spectacle)' then array['culture','theatre']
      when p_source = 'openagenda' and value ~ '(manga|anime|geek|cosplay|convention)' then array['manga_anime_gaming','manga','anime','convention']
      when p_source = 'openagenda' and value ~ '(football|basket|tennis|sport|course|tournoi|match)' then array['sport','match']
      when p_source = 'openagenda' and value ~ 'festival' then array['culture','local','festival']
      when p_source = 'openagenda' and value ~ '(braderie|marche|brocante)' then array['local','market']
      when p_source = 'openagenda' and value ~ '(quartier|associatif|association|famille)' then array['local','association_event']
      when p_source = 'datatourisme' and value ~ '(concert|musique)' then array['music','concert']
      when p_source = 'datatourisme' and value ~ '(cinema|projection|film)' then array['culture','cinema']
      when p_source = 'datatourisme' and value ~ '(exposition|expo|musee|galerie|vernissage)' then array['culture','exhibition']
      when p_source = 'datatourisme' and value ~ '(spectacle|theatre|danse|cirque|opera)' then array['culture']
      when p_source = 'datatourisme' and value ~ '(sport|match|tournoi|course|randon)' then array['sport','match']
      when p_source = 'datatourisme' and value ~ '(marche|brocante|vide.?grenier|foire)' then array['local','market']
      when p_source = 'datatourisme' and value ~ 'festival' then array['culture','local','festival']
      else array[]::text[]
    end) as tag
    from normalisees
  )
  select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
    from mapees
   where tag is not null;
$$;

create or replace function private.explicit_instant(value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value !~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' then return null; end if;
  return value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function private.explicit_ticket_url(raw jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  candidate text;
begin
  foreach candidate in array ARRAY[
    raw->>'ticket_url', raw->>'ticketUrl', raw->>'bookingUrl', raw->>'reservationUrl',
    raw->>'registrationUrl', raw->>'billetterieUrl', raw#>>'{ticketing,url}',
    raw#>>'{offers,url}'
  ] loop
    if candidate ~* '^https?://' then return candidate; end if;
  end loop;

  if jsonb_typeof(raw->'registration') = 'array' then
    for item in select value from jsonb_array_elements(raw->'registration') loop
      if lower(coalesce(item->>'type', item->>'kind', item->>'rel', ''))
           ~ '(link|url|ticket|billet|booking|reservation|inscription)'
         and coalesce(item->>'value', item->>'url', item->>'href', item->>'link') ~* '^https?://' then
        return coalesce(item->>'value', item->>'url', item->>'href', item->>'link');
      end if;
    end loop;
  end if;

  if jsonb_typeof(raw->'links') = 'array' then
    for item in select value from jsonb_array_elements(raw->'links') loop
      if lower(coalesce(item->>'type', item->>'kind', item->>'rel', item->>'label', ''))
           ~ '(ticket|billet|booking|reservation|inscription|register)'
         and coalesce(item->>'value', item->>'url', item->>'href', item->>'link') ~* '^https?://' then
        return coalesce(item->>'value', item->>'url', item->>'href', item->>'link');
      end if;
    end loop;
  end if;
  return null;
end;
$$;

/* Réconciliation des champs déjà stockés. `createdAt` et `updatedAt` ne sont
   volontairement jamais consultés pour announced_at. */
with par_evenement as (
  select e.id,
         coalesce(tags.tags, '{}'::text[]) as tags,
         ticket.url as ticket_url,
         ticket.source as ticket_source,
         ticket.external_id as ticket_external_id,
         ticket.source_url as ticket_source_url,
         announced.value as announced_at,
         announced.source as announced_source,
         announced.external_id as announced_external_id,
         announced.source_url as announced_source_url,
         presale.value as presale_at,
         presale.source as presale_source,
         presale.external_id as presale_external_id,
         presale.source_url as presale_source_url,
         tickets_open.value as tickets_open_at,
         tickets_open.source as tickets_open_source,
         tickets_open.external_id as tickets_open_external_id,
         tickets_open.source_url as tickets_open_source_url
    from public.events e
    left join lateral (
      select array_agg(distinct tag order by tag) as tags
        from public.event_sources s
        cross join lateral unnest(private.announcement_tags(s.source, e.category, s.raw_data)) tag
       where s.event_id = e.id
    ) tags on true
    left join lateral (
      select private.explicit_ticket_url(s.raw_data) as url, s.source, s.external_id, s.source_url
        from public.event_sources s
       where s.event_id = e.id and private.explicit_ticket_url(s.raw_data) is not null
       order by case s.source when 'artist_official' then 100 when 'venue_official' then 95
                             when 'organizer_official' then 95 when 'institutional' then 90
                             when 'ticketing_authorized' then 88 when 'openagenda' then 80
                             when 'datatourisme' then 75 else 0 end desc
       limit 1
    ) ticket on true
    left join lateral (
      select private.explicit_instant(coalesce(s.raw_data->>'announced_at', s.raw_data->>'announcedAt',
        s.raw_data->>'datePublished', s.raw_data->>'publishedAt', s.raw_data->>'publicationDate')) as value,
        s.source, s.external_id, s.source_url
        from public.event_sources s where s.event_id=e.id
       order by value asc nulls last, s.source
       limit 1
    ) announced on true
    left join lateral (
      select private.explicit_instant(coalesce(s.raw_data->>'presale_at', s.raw_data->>'presaleAt',
        s.raw_data#>>'{presale,startsAt}', s.raw_data#>>'{offers,presaleStartsAt}')) as value,
        s.source, s.external_id, s.source_url
        from public.event_sources s where s.event_id=e.id
       order by value asc nulls last, s.source
       limit 1
    ) presale on true
    left join lateral (
      select private.explicit_instant(coalesce(s.raw_data->>'tickets_open_at', s.raw_data->>'ticketsOpenAt',
        s.raw_data#>>'{ticketing,opensAt}', s.raw_data#>>'{offers,availabilityStarts}')) as value,
        s.source, s.external_id, s.source_url
        from public.event_sources s where s.event_id=e.id
       order by value asc nulls last, s.source
       limit 1
    ) tickets_open on true
), calculs as (
  select p.*, least(100, (
    case when exists (select 1 from public.event_sources s where s.event_id=p.id and s.source in ('artist_official','venue_official','organizer_official')) then 58
         when exists (select 1 from public.event_sources s where s.event_id=p.id and s.source='institutional') then 45
         when exists (select 1 from public.event_sources s where s.event_id=p.id and s.source='openagenda') then 23
         when exists (select 1 from public.event_sources s where s.event_id=p.id and s.source='datatourisme') then 21
         else 0 end
    + least(15, cardinality(p.tags) * 3)
    + case when p.ticket_url is not null then 10 else 0 end
    + case when cardinality(coalesce((select e.performers from public.events e where e.id=p.id), '{}'::text[])) > 0 then 7 else 0 end
    + case when (select e.organizer from public.events e where e.id=p.id) is not null then 3 else 0 end
  ))::integer as computed_score
  from par_evenement p
)
  update public.events e
   set announced_at = coalesce(e.announced_at, c.announced_at),
       presale_at = coalesce(e.presale_at, c.presale_at),
       tickets_open_at = coalesce(e.tickets_open_at, c.tickets_open_at),
       announcement_tags = case when cardinality(c.tags) > 0 then c.tags else e.announcement_tags end,
       ticket_url = coalesce(e.ticket_url, c.ticket_url),
       importance_score = greatest(coalesce(e.importance_score, 0), c.computed_score),
       importance_level = case
         when greatest(coalesce(e.importance_score, 0), c.computed_score) >= 85 then 'major'
         when greatest(coalesce(e.importance_score, 0), c.computed_score) >= 55 then 'important'
         else coalesce(e.importance_level, 'local') end,
       announcement_provenance = e.announcement_provenance
         || case when c.announced_at is not null and e.announced_at is null then jsonb_build_object('announced_at', jsonb_build_object('source',c.announced_source,'external_id',c.announced_external_id,'source_url',c.announced_source_url,'announced_at',c.announced_at)) else '{}'::jsonb end
         || case when c.presale_at is not null and e.presale_at is null then jsonb_build_object('presale_at', jsonb_build_object('source',c.presale_source,'external_id',c.presale_external_id,'source_url',c.presale_source_url,'presale_at',c.presale_at)) else '{}'::jsonb end
         || case when c.tickets_open_at is not null and e.tickets_open_at is null then jsonb_build_object('tickets_open_at', jsonb_build_object('source',c.tickets_open_source,'external_id',c.tickets_open_external_id,'source_url',c.tickets_open_source_url,'tickets_open_at',c.tickets_open_at)) else '{}'::jsonb end
         || case when c.ticket_url is not null and e.ticket_url is null then jsonb_build_object('ticket_url', jsonb_build_object('source',c.ticket_source,'external_id',c.ticket_external_id,'source_url',c.ticket_source_url,'ticket_url',c.ticket_url)) else '{}'::jsonb end
  from calculs c
 where e.id = c.id;

/* Un même horaire et un même lieu peuvent recevoir plusieurs variantes
   OpenAgenda/DATAtourisme. On ne supprime rien : les lignes secondaires sont
   rattachées à leur canonique et les RPC publiques les masquent. */
create or replace function private.title_token_subset(left_title text, right_title text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with left_tokens as (
    select distinct token from regexp_split_to_table(
      lower(regexp_replace(coalesce(left_title,''), '[^[:alnum:]]+', ' ', 'g')), ' +'
    ) token
    where token <> '' and token !~ '^[0-9]+$'
      and token not in ('le','la','les','de','des','du','en','a','au','aux','un','une','et','stage')
  ), right_tokens as (
    select distinct token from regexp_split_to_table(
      lower(regexp_replace(coalesce(right_title,''), '[^[:alnum:]]+', ' ', 'g')), ' +'
    ) token
    where token <> '' and token !~ '^[0-9]+$'
      and token not in ('le','la','les','de','des','du','en','a','au','aux','un','une','et','stage')
  ), shared as (
    select count(*) as n from left_tokens l join right_tokens r using (token)
  )
  select n >= 2 and (
    (not exists (select 1 from left_tokens l where not exists (select 1 from right_tokens r where r.token=l.token)))
    or
    (not exists (select 1 from right_tokens r where not exists (select 1 from left_tokens l where l.token=r.token)))
  ) from shared;
$$;

do $$
declare
  pair record;
  canonical uuid;
  secondary uuid;
begin
  for pair in
    select a.id as a_id, b.id as b_id
      from public.events a
      join public.events b on a.id::text < b.id::text
       and a.cancelled = false and b.cancelled = false
       and a.start_at is not null and b.start_at is not null
       and date_trunc('hour', a.start_at) = date_trunc('hour', b.start_at)
       and round(a.lat::numeric,3) = round(b.lat::numeric,3)
       and round(a.lng::numeric,3) = round(b.lng::numeric,3)
       and private.title_token_subset(a.title,b.title)
     where a.duplicate_of is null and b.duplicate_of is null
  loop
    select e.id into canonical
      from public.events e
     where e.id in (pair.a_id, pair.b_id)
     order by case e.primary_source when 'artist_official' then 100 when 'venue_official' then 95
               when 'organizer_official' then 95 when 'institutional' then 90
               when 'openagenda' then 80 when 'datatourisme' then 75 else 0 end desc,
              cardinality(coalesce(e.announcement_tags,'{}'::text[])) desc,
              length(coalesce(e.title,'')) desc, e.id
     limit 1;
    secondary := case when canonical = pair.a_id then pair.b_id else pair.a_id end;
    update public.events set duplicate_of = canonical where id = secondary and duplicate_of is null;
    update public.event_sources set event_id = canonical where event_id = secondary;
    update public.event_occurrences set event_id = canonical where event_id = secondary;
  end loop;
end $$;

drop function if exists public.evenements_proches(
  double precision,double precision,double precision,double precision,text[],integer,boolean
);

create function public.evenements_proches(
  p_sud double precision, p_ouest double precision, p_nord double precision, p_est double precision,
  p_statuts text[] default array['now','soon','upcoming','unknown_date'],
  p_limite integer default 120, p_inclure_publications boolean default false
)
returns table (
  id uuid, publication_id uuid, title text, description text, category text,
  start_at timestamptz, end_at timestamptz, timezone text, temporal_status text,
  date_confidence text, place_name text, address text, city text, insee_code text,
  lat double precision, lng double precision, primary_source text, source_url text,
  image_url text, image_source text, image_source_url text, image_author text,
  image_license text, image_updated_at timestamptz, cancelled boolean,
  last_source_update timestamptz, last_synced_at timestamptz,
  metro_area text, territory_slug text, territory_distance_km double precision
)
language sql stable security invoker set search_path = ''
as $$
  with centre as materialized (select (p_sud+p_nord)/2 as lat, (p_ouest+p_est)/2 as lng),
  parametres as materialized (
    select now() as instant, public.event_soon_window() as soon_window,
      topology.st_setsrid(topology.st_makepoint(c.lng,c.lat),4326)::topology.geography as point
    from centre c
  ),
  territoires_classes as (
    select t.radius_km, 6371*2*asin(least(1,sqrt(
      power(sin(radians(t.latitude-c.lat)/2),2)+cos(radians(c.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-c.lng)/2),2)
    ))) as distance_km
    from public.territories t cross join centre c where t.active and t.status='active'
  ), rayon as (
    select least(30::double precision,greatest(1::double precision,coalesce(
      (select tc.radius_km from territoires_classes tc where tc.distance_km<=tc.radius_km order by tc.distance_km,tc.radius_km limit 1),
      greatest(5::double precision,111.32*abs(p_nord-p_sud)/2,111.32*cos(radians(c.lat))*abs(p_est-p_ouest)/2)
    ))) as km from centre c
  ), candidats as materialized (
    select e.*, case
      when e.start_at is null or coalesce(e.date_confidence,'unknown')='unknown' then 'unknown_date'
      when e.end_at is not null and e.end_at < p.instant then 'past'
      when e.start_at <= p.instant and e.end_at is null then 'unknown_date'
      when e.start_at <= p.instant and e.end_at >= p.instant then case when coalesce(e.cancelled,false) then 'past' when e.date_confidence='exact' then 'now' else 'unknown_date' end
      when e.start_at > p.instant and e.start_at-p.instant <= p.soon_window then 'soon' else 'upcoming' end as statut
    from public.events e cross join parametres p cross join rayon r
    where e.duplicate_of is null and e.geom is not null
      and topology.st_dwithin(e.geom::topology.geography,p.point,r.km*1000)
      and (p_inclure_publications or e.publication_id is null)
  )
  select e.id,e.publication_id,e.title,e.description,e.category,e.start_at,e.end_at,e.timezone,e.statut,
    e.date_confidence,e.place_name,e.address,e.city,e.insee_code,e.lat,e.lng,e.primary_source,e.source_url,e.image_url,
    e.image_source,e.image_source_url,e.image_author,e.image_license,e.image_updated_at,e.cancelled,e.last_source_update,e.last_synced_at,
    basin.group_slug,basin.slug,basin.distance_km
  from candidats e
  left join lateral (
    select t.group_slug,t.slug,6371*2*asin(least(1,sqrt(
      power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
    ))) as distance_km
    from public.territories t
    where t.active and t.status='active' and t.group_slug is not null
      and 6371*2*asin(least(1,sqrt(power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)))) <= t.radius_km
    order by distance_km,t.radius_km limit 1
  ) basin on true
  where e.statut = any(coalesce(p_statuts,array['now','soon','upcoming','unknown_date']))
  order by case e.statut when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,e.start_at nulls last
  limit least(greatest(coalesce(p_limite,120),1),300);
$$;

drop function if exists public.annonces_proches(double precision,double precision,double precision,double precision,integer);

create function public.annonces_proches(
  p_sud double precision,p_ouest double precision,p_nord double precision,p_est double precision,p_limite integer default 120
)
returns table (
  id uuid,title text,description text,category text,start_at timestamptz,end_at timestamptz,timezone text,date_confidence text,
  place_name text,address text,city text,insee_code text,lat double precision,lng double precision,primary_source text,source_url text,
  image_url text,cancelled boolean,last_source_update timestamptz,last_synced_at timestamptz,announced_at timestamptz,
  presale_at timestamptz,tickets_open_at timestamptz,announcement_tags text[],importance_level text,importance_score integer,
  performers text[],organizer text,ticket_url text,announcement_provenance jsonb,metro_area text,territory_slug text,territory_distance_km double precision
)
language sql stable security invoker set search_path = ''
as $$
  select e.id,e.title,e.description,e.category,e.start_at,e.end_at,e.timezone,e.date_confidence,e.place_name,e.address,e.city,e.insee_code,
    e.lat,e.lng,e.primary_source,e.source_url,e.image_url,e.cancelled,e.last_source_update,e.last_synced_at,e.announced_at,e.presale_at,
    e.tickets_open_at,e.announcement_tags,e.importance_level,e.importance_score,e.performers,e.organizer,e.ticket_url,e.announcement_provenance,
    basin.group_slug,basin.slug,basin.distance_km
  from public.events e
  left join lateral (
    select t.group_slug,t.slug,6371*2*asin(least(1,sqrt(
      power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)
    ))) as distance_km
    from public.territories t
    where t.active and t.status='active' and t.group_slug is not null
      and 6371*2*asin(least(1,sqrt(power(sin(radians(t.latitude-e.lat)/2),2)+cos(radians(e.lat))*cos(radians(t.latitude))*power(sin(radians(t.longitude-e.lng)/2),2)))) <= t.radius_km
    order by distance_km,t.radius_km limit 1
  ) basin on true
  where e.lat between p_sud and p_nord and e.lng between p_ouest and p_est
    and e.duplicate_of is null and e.cancelled=false and e.start_at>now()
    and cardinality(e.announcement_tags)>0
  order by e.importance_score desc,e.announced_at desc nulls last,e.start_at asc
  limit least(greatest(coalesce(p_limite,120),1),300);
$$;

revoke all on function public.evenements_proches(double precision,double precision,double precision,double precision,text[],integer,boolean) from public;
grant execute on function public.evenements_proches(double precision,double precision,double precision,double precision,text[],integer,boolean) to anon,authenticated;
revoke all on function public.annonces_proches(double precision,double precision,double precision,double precision,integer) from public;
grant execute on function public.annonces_proches(double precision,double precision,double precision,double precision,integer) to anon,authenticated;
revoke all on function private.announcement_tags(text,text,jsonb) from public,anon,authenticated;
revoke all on function private.explicit_instant(text) from public,anon,authenticated;
revoke all on function private.explicit_ticket_url(jsonb) from public,anon,authenticated;
revoke all on function private.title_token_subset(text,text) from public,anon,authenticated;
