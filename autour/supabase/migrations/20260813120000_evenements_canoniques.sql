-- ---------------------------------------------------------------------------
-- Couche événement canonique — le temps devient une décision de la base
--
-- POURQUOI CETTE MIGRATION EXISTE
--
-- Jusqu'ici, « est-ce que ça a lieu maintenant ? » était tranché dans le
-- navigateur (autour/temporel.js). Le moteur y est bon, mais il reste au
-- mauvais endroit : chaque source arrive avec sa propre forme de dates, chaque
-- client doit refaire le même raisonnement, et rien n'empêche un futur appelant
-- (une notification, un export, une autre page) de conclure autrement. Un
-- événement de la semaine prochaine annoncé « maintenant » n'est pas un défaut
-- d'affichage : c'est quelqu'un qui se déplace pour rien.
--
-- Le statut temporel est donc calculé ICI, et le client ne fait plus que le
-- lire. `temporel.js` n'est pas supprimé pour autant : il reste l'autorité
-- pour les LIEUX permanents, dont la disponibilité se lit dans les horaires
-- d'ouverture et non dans une période.
--
-- CE QUI N'EST PAS FAIT, DÉLIBÉRÉMENT
--
--   · aucune heure de fin n'est inventée pour faire entrer un événement dans
--     « maintenant ». Sans fin fiable, le statut est `unknown_date` ;
--   · `publications` n'est pas transformée en table d'import. Elle reste ce
--     qu'elle est — ce que les habitants publient sur Autour — et se projette
--     dans `events` par déclencheur ;
--   · aucune règle ne nomme une ville. Les villes sont des lignes de
--     `event_areas`, c'est-à-dire de la configuration, pas du code.
--
-- Note d'installation PostGIS (déjà vérifiée par la migration mobilité, ne pas
-- « corriger ») : l'extension postgis de ce projet vit dans le schéma
-- `topology`, absent du search_path par défaut. Les colonnes géométriques et
-- tout ce qui les manipule sont donc créés en SQL dynamique après détection du
-- schéma réel.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. La fenêtre « bientôt », à un seul endroit
--
-- Elle était dispersée : deux heures dans temporel.js, douze heures dans une
-- version antérieure, « bientôt » en dur dans un libellé. Une fenêtre produit
-- qui vit à trois endroits finit par valoir trois valeurs différentes.
-- ---------------------------------------------------------------------------
create table if not exists public.event_settings (
  cle        text primary key,
  valeur     text        not null,
  descriptif text,
  maj_le     timestamptz not null default now()
);

comment on table public.event_settings is
  'Réglages du moteur temporel. Une valeur produit se change ici, pas dans une migration ni dans le client.';

insert into public.event_settings (cle, valeur, descriptif)
values ('soon_window', '24 hours',
        'Au-delà de ce délai avant le début, un événement est « upcoming » et non « soon ».')
on conflict (cle) do nothing;

-- SECURITY DEFINER, et c'est le point important : en SECURITY INVOKER, cette
-- fonction lirait `event_settings` sous la RLS de l'appelant. Pour anon, cette
-- table n'est pas lisible — le select ne rendrait rien, le coalesce retomberait
-- sur 24 h, et le réglage produit serait SANS EFFET pour les visiteurs tout en
-- paraissant configurable. Le jour où on le passerait à 6 h, le serveur dirait
-- 6 h et chaque navigateur 24 h, sans qu'aucune erreur ne le signale.
-- La fonction ne prend aucun paramètre et ne rend qu'un interval : elle
-- n'expose rien de ce qu'elle lit.
create or replace function public.event_soon_window()
returns interval
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select valeur::interval from public.event_settings where cle = 'soon_window'),
    interval '24 hours');
$$;

comment on function public.event_soon_window() is
  'Fenêtre « soon », source unique. Aucun autre fichier ne doit porter cette valeur.';

-- ---------------------------------------------------------------------------
-- 2. Le statut temporel — la règle, écrite une fois
--
-- « now » exige start_at <= NOW() <= end_at, une date exacte, et un événement
-- non annulé. Tout le reste tombe ailleurs. Les cas insuffisants ne sont pas
-- rangés dans « à venir » par défaut — ce serait affirmer quelque chose qu'on
-- ne sait pas — mais dans `unknown_date`, qui est une réponse honnête et que
-- l'interface peut rendre telle quelle (« Date à vérifier »).
--
-- date_confidence :
--   exact   — début ET fin horodatés, la source donne l'heure
--   day     — la journée est connue, l'heure non (cas courant en tourisme)
--   unknown — rien d'exploitable
-- Seul `exact` peut produire `now`. Un événement en `day` dont on est dans la
-- journée est `unknown_date` : on sait le jour, pas si c'est en cours à cette
-- minute, et l'interface le dira ainsi plutôt que de laisser croire.
-- ---------------------------------------------------------------------------
create or replace function public.event_temporal_status(
  p_start      timestamptz,
  p_end        timestamptz,
  p_confidence text        default 'unknown',
  p_cancelled  boolean     default false,
  p_at         timestamptz default now()
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- rien à quoi se raccrocher : on ne devine pas
    when p_start is null or coalesce(p_confidence, 'unknown') = 'unknown'
      then 'unknown_date'

    -- terminé : la seule certitude qu'une fin passée apporte
    when p_end is not null and p_end < p_at
      then 'past'

    -- commencé, mais sans fin fiable. Ne jamais rester « actif » indéfiniment :
    -- on ne sait pas si c'est fini, donc on ne dit pas que ça a lieu.
    when p_start <= p_at and p_end is null
      then 'unknown_date'

    -- dans la fenêtre : le seul chemin vers « now », et il est fermé aux
    -- annulations comme aux dates approximatives
    when p_start <= p_at and p_end >= p_at
      then case
             when coalesce(p_cancelled, false) then 'past'
             when p_confidence = 'exact'       then 'now'
             else 'unknown_date'
           end

    -- à venir : « soon » n'est qu'une nuance de « upcoming »
    when p_start > p_at and p_start - p_at <= public.event_soon_window()
      then 'soon'

    else 'upcoming'
  end;
$$;

comment on function public.event_temporal_status is
  'Statut canonique : now | soon | upcoming | past | unknown_date. « now » exige début <= maintenant <= fin, date exacte, non annulé.';

-- ---------------------------------------------------------------------------
-- 3. Normalisation de texte et clé de rapprochement
--
-- `unaccent` n'est pas installé sur ce projet et l'installer pour cinq
-- caractères serait payer cher une commodité : translate() suffit et reste
-- IMMUTABLE, donc indexable.
-- ---------------------------------------------------------------------------
create or replace function public.event_texte_normalise(p_texte text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p_texte, ''),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Niveau 2 de la déduplication : même titre normalisé, même endroit à ~100 m
-- près (3 décimales), même heure de début à l'heure près. Trois coïncidences
-- simultanées, pas une seule — deux concerts différents dans la même salle le
-- même soir gardent des clés distinctes tant que leurs titres diffèrent.
create or replace function public.event_dedup_key(
  p_titre text, p_lat double precision, p_lng double precision, p_start timestamptz
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when public.event_texte_normalise(p_titre) = ''
      or p_lat is null or p_lng is null or p_start is null
      then null
    else public.event_texte_normalise(p_titre)
         || '|' || round(p_lat::numeric, 3)
         || '|' || round(p_lng::numeric, 3)
         || '|' || to_char(p_start at time zone 'UTC', 'YYYYMMDDHH24')
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Les zones — des données, jamais des règles
--
-- « Commencer par Lille » ne doit produire aucune ligne de code qui parle de
-- Lille. Une zone est un rectangle, des codes INSEE et un interrupteur ; la
-- synchronisation itère sur ce que la table contient. Ouvrir Rennes demain,
-- c'est un INSERT.
-- ---------------------------------------------------------------------------
create table if not exists public.event_areas (
  id           bigint generated always as identity primary key,
  code         text        not null unique,
  name         text        not null,

  -- rectangle englobant : suffisant pour interroger une source géographique,
  -- et lisible sans PostGIS côté fonction de synchronisation
  min_lat      double precision not null check (min_lat between -90 and 90),
  min_lng      double precision not null check (min_lng between -180 and 180),
  max_lat      double precision not null check (max_lat between -90 and 90),
  max_lng      double precision not null check (max_lng between -180 and 180),

  insee_codes  text[]      not null default '{}',
  timezone     text        not null default 'Europe/Paris',
  enabled      boolean     not null default true,
  priorite     integer     not null default 100,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint event_areas_bbox_coherente
    check (min_lat < max_lat and min_lng < max_lng)
);

comment on table public.event_areas is
  'Zones de synchronisation. Une ville est une ligne de cette table, jamais une condition dans le code.';

create index if not exists event_areas_enabled_idx
  on public.event_areas (priorite, code) where enabled;

-- ---------------------------------------------------------------------------
-- 5. Les événements canoniques
--
-- Un événement, une ligne, quelles que soient les sources qui le décrivent.
-- `publication_id` relie l'événement à la publication Autour dont il provient,
-- quand c'est le cas — l'inverse n'existe pas : `publications` ignore `events`.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  publication_id     uuid unique
                       references public.publications (id) on delete cascade,

  title              text        not null check (length(btrim(title)) between 1 and 200),
  description        text,
  category           text,

  start_at           timestamptz,
  end_at             timestamptz,
  timezone           text        not null default 'Europe/Paris',
  date_confidence    text        not null default 'unknown'
                       check (date_confidence in ('exact','day','unknown')),
  -- cache indexable du statut. La VÉRITÉ reste event_temporal_status(), que la
  -- RPC recalcule à chaque lecture : une colonne datée d'il y a dix minutes ne
  -- doit jamais décider de ce que quelqu'un voit.
  temporal_status    text        not null default 'unknown_date'
                       check (temporal_status in ('now','soon','upcoming','past','unknown_date')),

  place_name         text,
  address            text,
  city               text,
  insee_code         text,

  lat                double precision check (lat between -90 and 90),
  lng                double precision check (lng between -180 and 180),
  -- geom : ajoutée plus bas, en SQL dynamique (voir la note PostGIS en tête)

  primary_source     text        not null default 'autour',
  source_url         text,
  image_url          text,

  dedup_key          text,
  area_id            bigint      references public.event_areas (id) on delete set null,

  last_source_update timestamptz,
  last_synced_at     timestamptz,

  cancelled          boolean     not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.events is
  'Événements canoniques, toutes sources confondues. Un événement affiché une fois, même s''il est décrit par trois catalogues.';
comment on column public.events.temporal_status is
  'Cache indexable. La lecture publique passe par evenements_proches(), qui recalcule le statut à l''instant de la requête.';
comment on column public.events.date_confidence is
  'exact = heures connues ; day = journée connue, heure non ; unknown = rien d''exploitable. Seul « exact » peut produire « now ».';

create index if not exists events_position_idx on public.events (lat, lng);
create index if not exists events_statut_idx   on public.events (temporal_status, start_at);
create index if not exists events_debut_idx    on public.events (start_at);
create index if not exists events_source_idx   on public.events (primary_source);
create unique index if not exists events_dedup_key_idx
  on public.events (dedup_key) where dedup_key is not null;

-- ---------------------------------------------------------------------------
-- 6. Les sources d'un événement
--
-- UNIQUE(source, external_id) est le niveau 1 de la déduplication : la même
-- référence chez le même fournisseur désigne le même événement, sans discussion
-- et sans heuristique.
-- ---------------------------------------------------------------------------
create table if not exists public.event_sources (
  id                bigint generated always as identity primary key,
  event_id          uuid        not null references public.events (id) on delete cascade,
  source            text        not null,
  external_id       text        not null,
  source_url        text,
  raw_data          jsonb,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (source, external_id)
);

comment on table public.event_sources is
  'Provenances d''un événement canonique. UNIQUE(source, external_id) : niveau 1 du rapprochement, sans heuristique.';

create index if not exists event_sources_event_idx on public.event_sources (event_id);

-- ---------------------------------------------------------------------------
-- 7. Journal des synchronisations
--
-- Même raison que pour la mobilité : sans journal, une source silencieusement
-- morte depuis trois semaines ressemble à une ville sans événements.
-- ---------------------------------------------------------------------------
create table if not exists public.event_sync_runs (
  id               bigint generated always as identity primary key,
  source           text        not null default 'datatourisme',
  scope            text,
  status           text        not null default 'running'
                     check (status in ('running','success','partial','error')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  duration_ms      integer,

  events_seen      integer     not null default 0,
  events_inserted  integer     not null default 0,
  events_updated   integer     not null default 0,
  events_merged    integer     not null default 0,
  events_rejected  integer     not null default 0,

  errors           text,
  details          jsonb       not null default '{}'::jsonb
);

comment on table public.event_sync_runs is
  'Journal d''exécution des synchronisations d''événements. Un événement défectueux se compte ici ; il ne fait pas tomber la course.';

create index if not exists event_sync_runs_started_idx
  on public.event_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- 8. Géométrie et index spatial — après détection du schéma PostGIS
-- ---------------------------------------------------------------------------
do $$
declare
  postgis_schema text;
begin
  select n.nspname into postgis_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'postgis';

  if postgis_schema is null then
    raise exception 'PostGIS est introuvable : cette migration ne l''installe pas.';
  end if;

  execute format(
    'alter table public.events add column if not exists geom %I.geometry(Point, 4326)',
    postgis_schema);
  execute format(
    'create index if not exists events_geom_gist on public.events using gist (geom %I.gist_geometry_ops_2d)',
    postgis_schema);

  execute format(
    'alter table public.event_areas add column if not exists geom %I.geometry(Polygon, 4326)',
    postgis_schema);

  -- Le déclencheur d'écriture manipule des types PostGIS : son search_path doit
  -- contenir le schéma réel de l'extension, détecté et non supposé.
  execute format($f$
    create or replace function public.events_avant_ecriture()
    returns trigger
    language plpgsql
    set search_path = public, %I
    as $body$
    begin
      -- une coordonnée absente ne produit pas un point à (0,0) au large du Ghana
      new.geom := case
        when new.lat is null or new.lng is null then null
        else ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)
      end;

      new.dedup_key := public.event_dedup_key(new.title, new.lat, new.lng, new.start_at);

      new.temporal_status := public.event_temporal_status(
        new.start_at, new.end_at, new.date_confidence, new.cancelled, now());

      -- rattachement à la zone : une donnée, calculée depuis la table des
      -- zones, jamais depuis un nom de ville écrit dans le code
      if new.area_id is null and new.lat is not null and new.lng is not null then
        select a.id into new.area_id
          from public.event_areas a
         where a.enabled
           and new.lat between a.min_lat and a.max_lat
           and new.lng between a.min_lng and a.max_lng
         order by a.priorite, a.id
         limit 1;
      end if;

      new.updated_at := now();
      return new;
    end;
    $body$;
  $f$, postgis_schema);

  execute format($f$
    create or replace function public.event_areas_avant_ecriture()
    returns trigger
    language plpgsql
    set search_path = public, %I
    as $body$
    begin
      new.geom := ST_SetSRID(ST_MakeEnvelope(
        new.min_lng, new.min_lat, new.max_lng, new.max_lat), 4326);
      new.updated_at := now();
      return new;
    end;
    $body$;
  $f$, postgis_schema);
end
$$;

drop trigger if exists events_avant_ecriture on public.events;
create trigger events_avant_ecriture
  before insert or update on public.events
  for each row execute function public.events_avant_ecriture();

drop trigger if exists event_areas_avant_ecriture on public.event_areas;
create trigger event_areas_avant_ecriture
  before insert or update on public.event_areas
  for each row execute function public.event_areas_avant_ecriture();

-- ---------------------------------------------------------------------------
-- 8 bis. Les zones ouvertes au départ
--
-- Insérées ICI et pas en fin de fichier : après le déclencheur, pour qu'elles
-- reçoivent leur géométrie, et AVANT tout ce qui doit s'y rattacher. Semées en
-- dernier, elles laissaient les événements déjà présents sans zone — une
-- erreur silencieuse, puisque `area_id` est nullable par ailleurs.
--
-- Lille sert de zone d'essai parce qu'il en faut une, pas parce qu'elle est
-- particulière : elle est une ligne comme les cinq autres, et la
-- synchronisation ne sait pas laquelle est laquelle.
-- ---------------------------------------------------------------------------
insert into public.event_areas (code, name, min_lat, min_lng, max_lat, max_lng, insee_codes, priorite)
values
  ('lille',     'Lille et la Métropole européenne', 50.55, 2.90, 50.75,  3.25, array['59350'],  10),
  ('paris',     'Paris et proche couronne',         48.75, 2.20, 48.95,  2.50, array['75056'],  20),
  ('lyon',      'Lyon et sa métropole',             45.68, 4.75, 45.85,  4.95, array['69123'],  30),
  ('marseille', 'Marseille',                        43.20, 5.28, 43.40,  5.55, array['13055'],  40),
  ('bordeaux',  'Bordeaux Métropole',               44.78, -0.68, 44.92, -0.50, array['33063'], 50),
  ('toulouse',  'Toulouse Métropole',               43.53, 1.35, 43.68,  1.52, array['31555'],  60)
on conflict (code) do nothing;

-- Rattachement des événements déjà présents (rejeu de la migration, ou zone
-- ouverte après coup). Le déclencheur ne s'occupe que des écritures.
create or replace function public.rattacher_evenements_aux_zones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touchees integer;
begin
  -- la zone se calcule dans un CTE puis se joint : un LATERAL ne peut pas
  -- référencer la table que l'UPDATE modifie
  with cible as (
    select e.id as event_id,
           (select a.id from public.event_areas a
             where a.enabled
               and e.lat between a.min_lat and a.max_lat
               and e.lng between a.min_lng and a.max_lng
             order by a.priorite, a.id limit 1) as area_id
      from public.events e
     where e.lat is not null and e.lng is not null
  )
  update public.events e
     set area_id = c.area_id
    from cible c
   where e.id = c.event_id
     and e.area_id is distinct from c.area_id;
  get diagnostics touchees = row_count;
  return touchees;
end;
$$;

revoke all on function public.rattacher_evenements_aux_zones() from public;
select public.rattacher_evenements_aux_zones();

-- ---------------------------------------------------------------------------
-- 9. Rafraîchissement du cache de statut
--
-- Appelée en fin de synchronisation, et planifiable par pg_cron le jour où
-- l'extension sera activée. Elle n'écrit que les lignes qui changent :
-- une course sur cent mille événements ne doit pas réécrire la table.
-- ---------------------------------------------------------------------------
create or replace function public.rafraichir_statuts_temporels()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touchees integer;
begin
  with recalcule as (
    select e.id,
           public.event_temporal_status(
             e.start_at, e.end_at, e.date_confidence, e.cancelled, now()) as statut
      from public.events e
  )
  update public.events e
     set temporal_status = r.statut
    from recalcule r
   where e.id = r.id
     and e.temporal_status is distinct from r.statut;
  get diagnostics touchees = row_count;
  return touchees;
end;
$$;

revoke all on function public.rafraichir_statuts_temporels() from public;

-- ---------------------------------------------------------------------------
-- 10. Projection des publications Autour dans la couche canonique
--
-- `publications` garde son rôle : ce que les habitants publient, avec ses
-- quotas, sa propriété, ses canaux. Elle se projette ici pour que la
-- déduplication puisse un jour reconnaître qu'un catalogue décrit le même
-- événement, et pour qu'un seul modèle temporel s'applique à tout le monde.
--
-- La confiance de date se déduit de ce que la publication porte réellement :
-- un début sans fin ne devient pas `exact`, sans quoi la règle « jamais now
-- sans fin fiable » serait contournée par la porte de service.
-- ---------------------------------------------------------------------------
create or replace function public.projeter_publication_en_evenement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.events (
    publication_id, title, description, category,
    start_at, end_at, date_confidence,
    address, city, lat, lng,
    primary_source, image_url, cancelled,
    last_source_update, last_synced_at
  )
  values (
    new.id, new.titre, null, new.cat,
    new.debut_le, new.fin_le,
    case when new.debut_le is not null and new.fin_le is not null then 'exact'
         when new.debut_le is not null then 'day'
         else 'unknown' end,
    new.adresse, new.cp, new.lat, new.lng,
    'autour', null, (new.status = 'cancelled' or new.annule),
    new.cree_le, now()
  )
  on conflict (publication_id) do update set
    title              = excluded.title,
    category           = excluded.category,
    start_at           = excluded.start_at,
    end_at             = excluded.end_at,
    date_confidence    = excluded.date_confidence,
    address            = excluded.address,
    city               = excluded.city,
    lat                = excluded.lat,
    lng                = excluded.lng,
    cancelled          = excluded.cancelled,
    last_source_update = excluded.last_source_update,
    last_synced_at     = now();
  return new;
exception
  -- une publication ne doit jamais échouer parce que sa projection échoue :
  -- l'événement de l'habitant compte plus que notre index
  when others then
    raise warning 'projection publication % impossible : %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists publications_projeter_evenement on public.publications;
create trigger publications_projeter_evenement
  after insert or update on public.publications
  for each row execute function public.projeter_publication_en_evenement();

-- rattrapage : les publications déjà en base entrent dans la couche canonique
insert into public.events (
  publication_id, title, category, start_at, end_at, date_confidence,
  address, city, lat, lng, primary_source, cancelled, last_source_update, last_synced_at
)
select p.id, p.titre, p.cat, p.debut_le, p.fin_le,
       case when p.debut_le is not null and p.fin_le is not null then 'exact'
            when p.debut_le is not null then 'day'
            else 'unknown' end,
       p.adresse, p.cp, p.lat, p.lng, 'autour',
       (p.status = 'cancelled' or p.annule), p.cree_le, now()
  from public.publications p
on conflict (publication_id) do nothing;

-- ---------------------------------------------------------------------------
-- 11. La lecture publique
--
-- Une seule porte, et elle recalcule le statut à l'instant de l'appel. Le
-- client ne reçoit jamais une décision temporelle vieille de la dernière
-- synchronisation.
--
-- Par défaut : ni le passé, ni les publications Autour — ces dernières
-- continuent d'arriver par `publications_proches`, qui porte la propriété, les
-- places et le prix. Les demander ici en double afficherait deux fois le même
-- événement.
-- ---------------------------------------------------------------------------
drop function if exists public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean);

create function public.evenements_proches(
  p_sud     double precision,
  p_ouest   double precision,
  p_nord    double precision,
  p_est     double precision,
  p_statuts text[]  default array['now','soon','upcoming','unknown_date'],
  p_limite  integer default 120,
  p_inclure_publications boolean default false
)
returns table (
  id                 uuid,
  publication_id     uuid,
  title              text,
  description        text,
  category           text,
  start_at           timestamptz,
  end_at             timestamptz,
  timezone           text,
  temporal_status    text,
  date_confidence    text,
  place_name         text,
  address            text,
  city               text,
  insee_code         text,
  lat                double precision,
  lng                double precision,
  primary_source     text,
  source_url         text,
  image_url          text,
  cancelled          boolean,
  last_source_update timestamptz,
  last_synced_at     timestamptz
)
language sql
stable
-- SECURITY INVOKER : les événements sont lisibles publiquement par policy, et
-- le seul élément qui exigeait les droits du propriétaire — la fenêtre
-- « soon » — est désormais atteint par event_soon_window(), définie plus haut.
security invoker
set search_path = public
as $$
  select e.id, e.publication_id, e.title, e.description, e.category,
         e.start_at, e.end_at, e.timezone,
         public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                      e.cancelled, now()) as temporal_status,
         e.date_confidence,
         e.place_name, e.address, e.city, e.insee_code,
         e.lat, e.lng, e.primary_source, e.source_url, e.image_url,
         e.cancelled, e.last_source_update, e.last_synced_at
    from public.events e
   where e.lat between p_sud and p_nord
     and e.lng between p_ouest and p_est
     and (p_inclure_publications or e.publication_id is null)
     and public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                      e.cancelled, now())
         = any (coalesce(p_statuts, array['now','soon','upcoming','unknown_date']))
   -- l'ordre du temps : ce qui a lieu d'abord, ce qu'on ne sait pas dater en
   -- dernier, jamais mélangé au reste
   order by
     case public.event_temporal_status(e.start_at, e.end_at, e.date_confidence,
                                       e.cancelled, now())
       when 'now' then 0 when 'soon' then 1 when 'upcoming' then 2 else 3 end,
     e.start_at nulls last
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$$;

comment on function public.evenements_proches is
  'Événements canoniques d''une emprise, statut recalculé à l''instant de l''appel. Le client ne décide plus du temps.';

-- ---------------------------------------------------------------------------
-- 12. Row Level Security
--
-- Les événements sont publics : lecture ouverte. Les écritures n'ont AUCUNE
-- policy — elles passent par la clé de service (synchronisation) ou par les
-- déclencheurs SECURITY DEFINER (projection des publications). Les tables
-- d'exploitation — provenances, journal, réglages — ne se lisent pas depuis
-- le navigateur : elles n'apprennent rien à un visiteur et exposeraient les
-- charges brutes des fournisseurs.
-- ---------------------------------------------------------------------------
alter table public.events          enable row level security;
alter table public.event_areas     enable row level security;
alter table public.event_sources   enable row level security;
alter table public.event_sync_runs enable row level security;
alter table public.event_settings  enable row level security;

drop policy if exists "events: lecture publique" on public.events;
create policy "events: lecture publique"
  on public.events for select to anon, authenticated using (true);

drop policy if exists "zones: lecture publique" on public.event_areas;
create policy "zones: lecture publique"
  on public.event_areas for select to anon, authenticated using (true);

-- event_sources, event_sync_runs, event_settings : aucune policy, donc aucun
-- accès anon/authenticated. Seule la clé de service les touche.

grant select on public.events, public.event_areas to anon, authenticated;
revoke all on public.event_sources   from anon, authenticated;
revoke all on public.event_sync_runs from anon, authenticated;
revoke all on public.event_settings  from anon, authenticated;

revoke all on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean) from public;
grant execute on function public.evenements_proches(
  double precision, double precision, double precision, double precision,
  text[], integer, boolean) to anon, authenticated;

grant execute on function public.event_temporal_status(
  timestamptz, timestamptz, text, boolean, timestamptz) to anon, authenticated;
grant execute on function public.event_soon_window() to anon, authenticated;

-- Les fonctions d'exploitation ne sont PAS des points d'entrée publics.
-- `revoke ... from public` ne suffit pas ici : Supabase accorde EXECUTE à anon
-- et authenticated par privilège par défaut, et ces rôles gardaient donc le
-- droit d'appeler /rest/v1/rpc/rafraichir_statuts_temporels — c'est-à-dire de
-- déclencher une réécriture de table depuis le navigateur.
-- Les fonctions de déclencheur n'ont besoin d'aucun droit d'exécution : un
-- déclencheur s'exécute pour le compte de la table, pas de l'appelant.
revoke all on function public.rafraichir_statuts_temporels()      from anon, authenticated;
revoke all on function public.rattacher_evenements_aux_zones()    from anon, authenticated;
revoke all on function public.projeter_publication_en_evenement() from anon, authenticated;
revoke all on function public.events_avant_ecriture()             from anon, authenticated, public;
revoke all on function public.event_areas_avant_ecriture()        from anon, authenticated, public;
