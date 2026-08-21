-- ---------------------------------------------------------------------------
-- LA PROVENANCE D'UNE PHOTO, ET LA RÉPARATION DES URL OPENAGENDA
--
-- CE QUI ÉTAIT ÉCRIT EN BASE
--
-- Le connecteur OpenAgenda lisait le champ `base` de l'objet image et
-- s'arrêtait là, sans jamais y coller le `filename`. Il a donc écrit, pour
-- chaque événement illustré :
--
--     https://img.openagenda.com/main/          →  HTTP 400
--
-- Ce n'est pas une image absente : c'est une image présente dont la moitié du
-- nom manquait. Le navigateur retirait sagement la balise en `onerror`, et
-- personne n'a rien vu — sauf qu'aucune carte n'avait de photo.
--
-- `sync-openagenda/image.mjs` construit désormais l'URL correcte pour les
-- synchronisations à venir. Cette migration s'occupe des lignes DÉJÀ écrites :
-- elle ne masque pas l'erreur, elle efface les URL qui ne nomment aucun
-- fichier — la prochaine synchronisation les réécrira correctement, depuis le
-- champ d'origine.
--
-- CE QU'ELLE AJOUTE
--
-- Les cinq colonnes qui manquaient pour qu'une photo puisse dire d'où elle
-- vient. `image_url` existait déjà ; le contrat complet est :
--
--     image_url · image_source · image_source_url · image_author
--     image_license · image_updated_at
--
-- C'est exactement la forme que rend le résolveur unique du navigateur
-- (`images.js`). Une seule forme des deux côtés : la provenance ne se perd
-- jamais en route.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. La règle, écrite une fois
--
-- Une URL d'image nomme un FICHIER. `https://img.openagenda.com/main/` n'en
-- nomme aucun : le dernier segment de son chemin est vide. C'est la signature
-- exacte du bug, et c'est la seule vérification qui restera vraie si le
-- format d'OpenAgenda change encore.
-- ---------------------------------------------------------------------------
-- Le dernier segment du chemin, sans schéma, sans hôte, sans paramètres.
-- `https://img.openagenda.com/main/` en rend une chaîne vide : c'est tout le
-- diagnostic du bug, tenu en une expression.
create or replace function public.image_dernier_segment(url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (regexp_match(
      regexp_replace(split_part(split_part(url, '?', 1), '#', 1), '^https?://[^/]+', ''),
      '([^/]*)$'
    ))[1], ''
  );
$$;

create or replace function public.image_url_nomme_un_fichier(url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when url is null then true
    when url !~* '^https?://' then false
    else public.image_dernier_segment(url) <> ''
      and (
        -- une extension, ou des paramètres : quelque chose désigne bien une
        -- ressource, et le mot d'arborescence n'est plus un répertoire nu.
        -- Sans cette nuance, l'URL photo de Google Places, qui se termine par
        -- `/media?key=…`, serait refusée à tort.
        public.image_dernier_segment(url) ~* '\.[a-z0-9]{2,5}$'
        or position('?' in url) > 0
        or public.image_dernier_segment(url) !~* '^(main|media|images?|photos?|thumb|thumbnails?)$'
      )
  end;
$$;

comment on function public.image_url_nomme_un_fichier(text) is
  'Une URL d''image nomme un fichier. https://img.openagenda.com/main/ n''en nomme aucun : c''est la signature du bug OpenAgenda corrigé le 21/08/2026.';

-- ---------------------------------------------------------------------------
-- 2. Les colonnes de provenance
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists image_source     text,
  add column if not exists image_source_url text,
  add column if not exists image_author     text,
  add column if not exists image_license    text,
  add column if not exists image_updated_at timestamptz;

comment on column public.events.image_source is
  'D''où vient la photo : openagenda, datatourisme, structure, autour, site_officiel, wikimedia_commons, google_places. Jamais autre chose.';
comment on column public.events.image_source_url is
  'La page où l''on peut vérifier la photo — fiche OpenAgenda, page de fichier Commons, site officiel.';
comment on column public.events.image_license is
  'Sous quel droit Autour l''affiche. Vide = droit inconnu = on n''affiche pas.';
comment on column public.events.image_updated_at is
  'Quand ce visuel a été établi. Sert à repérer une photo qui n''a plus été revue depuis longtemps.';

-- ---------------------------------------------------------------------------
-- 3. La réparation des lignes déjà écrites
--
-- On efface l'URL, pas l'événement. La prochaine synchronisation la réécrira
-- depuis `base` + `filename`, correctement cette fois.
-- ---------------------------------------------------------------------------
do $reparation$
declare
  cassees bigint;
begin
  select count(*) into cassees
  from public.events
  where image_url is not null
    and not public.image_url_nomme_un_fichier(image_url);

  update public.events
  set image_url = null,
      image_source = null,
      image_source_url = null,
      image_author = null,
      image_license = null,
      image_updated_at = null
  where image_url is not null
    and not public.image_url_nomme_un_fichier(image_url);

  raise notice 'images réparées : % URL ne nommaient aucun fichier (dont les https://img.openagenda.com/main/)', cassees;
end;
$reparation$;

-- ---------------------------------------------------------------------------
-- 4. La provenance des photos qui restent
--
-- Elles n'en avaient aucune : le navigateur étiquetait TOUTE image
-- d'événement « datatourisme_licence », y compris les affiches OpenAgenda.
-- On la déduit ici de ce qu'on sait réellement — l'hébergeur et la source
-- primaire — et plus jamais de ce que le client suppose.
-- ---------------------------------------------------------------------------
update public.events
set image_source = case
      when image_url ~* '://[^/]*openagenda\.com'  then 'openagenda'
      when image_url ~* '://[^/]*wikimedia\.org'   then 'wikimedia_commons'
      when image_url ~* '://[^/]*wikipedia\.org'   then 'wikimedia_commons'
      when image_url ~* '://[^/]*googleapis\.com'  then 'google_places'
      when publication_id is not null              then 'autour'
      when primary_source = 'datatourisme'         then 'datatourisme'
      else primary_source
    end,
    image_updated_at = coalesce(image_updated_at, last_synced_at, updated_at)
where image_url is not null
  and image_source is null;

update public.events
set image_license = case image_source
      when 'openagenda'   then 'affiche fournie par l’organisateur'
      when 'datatourisme' then 'licence ouverte (catalogue DATAtourisme)'
      when 'autour'       then 'publiée dans Autour'
      else image_license
    end
where image_url is not null
  and coalesce(image_license, '') = ''
  and image_source in ('openagenda', 'datatourisme', 'autour');

-- ---------------------------------------------------------------------------
-- 5. Le bug ne peut plus être réécrit
--
-- La contrainte est posée APRÈS la réparation, donc elle passe. À partir
-- d'ici, une URL de répertoire est refusée à l'écriture : le connecteur ne
-- peut plus servir un 400 en silence.
-- ---------------------------------------------------------------------------
alter table public.events
  drop constraint if exists events_image_url_nomme_un_fichier;
alter table public.events
  add constraint events_image_url_nomme_un_fichier
  check (public.image_url_nomme_un_fichier(image_url)) not valid;
alter table public.events
  validate constraint events_image_url_nomme_un_fichier;

create index if not exists events_image_source_idx
  on public.events (image_source) where image_url is not null;

-- ---------------------------------------------------------------------------
-- 6. La lecture publique rend la provenance
--
-- Le type de retour change : `create or replace` ne suffit pas, il faut
-- supprimer puis recréer. Filtres, ordre, limite et statut sont identiques —
-- seules les cinq colonnes de provenance s'ajoutent à la fin.
-- ---------------------------------------------------------------------------
drop function if exists public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
);

do $postgis$
declare
  postgis_schema text;
begin
  select n.nspname into postgis_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if postgis_schema is null then
    raise exception 'PostGIS est introuvable : impossible de servir les événements.';
  end if;

  execute format($ddl$
    create function public.evenements_proches(
      p_sud double precision,
      p_ouest double precision,
      p_nord double precision,
      p_est double precision,
      p_statuts text[] default array['now','soon','upcoming','unknown_date'],
      p_limite integer default 120,
      p_inclure_publications boolean default false
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
      last_synced_at timestamptz
    )
    language sql
    stable
    security invoker
    set search_path = ''
    as $body$
      with centre as materialized (
        select (p_sud + p_nord) / 2 as lat,
               (p_ouest + p_est) / 2 as lng
      ), parametres as materialized (
        select now() as instant,
               public.event_soon_window() as soon_window,
               %1$I.st_setsrid(
                 %1$I.st_makepoint(c.lng, c.lat), 4326
               )::%1$I.geography as point
        from centre c
      ), territoires_classes as (
        select t.radius_km,
               6371 * 2 * asin(least(1, sqrt(
                 power(sin(radians(t.latitude - c.lat) / 2), 2) +
                 cos(radians(c.lat)) * cos(radians(t.latitude)) *
                 power(sin(radians(t.longitude - c.lng) / 2), 2)
               ))) as distance_km
        from public.territories t
        cross join centre c
        where t.active and t.status = 'active'
      ), rayon as (
        select least(30::double precision, greatest(
          1::double precision,
          coalesce(
            (select tc.radius_km
             from territoires_classes tc
             where tc.distance_km <= tc.radius_km
             order by tc.distance_km, tc.radius_km
             limit 1),
            greatest(
              5::double precision,
              111.32 * abs(p_nord - p_sud) / 2,
              111.32 * cos(radians(c.lat)) * abs(p_est - p_ouest) / 2
            )
          )
        )) as km
        from centre c
      ), candidats as materialized (
        select e.*,
               case
                 when e.start_at is null
                      or coalesce(e.date_confidence, 'unknown') = 'unknown'
                   then 'unknown_date'
                 when e.end_at is not null and e.end_at < p.instant
                   then 'past'
                 when e.start_at <= p.instant and e.end_at is null
                   then 'unknown_date'
                 when e.start_at <= p.instant and e.end_at >= p.instant
                   then case
                          when coalesce(e.cancelled, false) then 'past'
                          when e.date_confidence = 'exact' then 'now'
                          else 'unknown_date'
                        end
                 when e.start_at > p.instant
                      and e.start_at - p.instant <= p.soon_window
                   then 'soon'
                 else 'upcoming'
               end as statut,
               %1$I.st_distance(e.geom::%1$I.geography, p.point) as distance_m
        from public.events e
        cross join parametres p
        cross join rayon r
        where e.geom is not null
          and %1$I.st_dwithin(
            e.geom::%1$I.geography,
            p.point,
            r.km * 1000
          )
          and (p_inclure_publications or e.publication_id is null)
      )
      select e.id, e.publication_id, e.title, e.description, e.category,
             e.start_at, e.end_at, e.timezone, e.statut,
             e.date_confidence, e.place_name, e.address, e.city, e.insee_code,
             e.lat, e.lng, e.primary_source, e.source_url, e.image_url,
             e.image_source, e.image_source_url, e.image_author,
             e.image_license, e.image_updated_at,
             e.cancelled, e.last_source_update, e.last_synced_at
      from candidats e
      where e.statut = any(coalesce(
        p_statuts, array['now','soon','upcoming','unknown_date']
      ))
      order by
        case e.statut
          when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3
        end,
        e.start_at nulls last,
        e.distance_m
      limit least(greatest(coalesce(p_limite, 120), 1), 300);
    $body$;
  $ddl$, postgis_schema);
end;
$postgis$;

comment on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
) is
  'Événements canoniques territoriaux : filtre PostGIS, statut calculé une fois, provenance de la photo rendue avec elle.';

grant execute on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean
) to anon, authenticated;
