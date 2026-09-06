-- ---------------------------------------------------------------------------
-- LOT 5 · C et D — LE MOTEUR GÉNÉRIQUE D'OFFRES
--
-- « BONS PLANS ÉTUDIANTS » N'EST PAS UNE CATÉGORIE DE LIEUX.
--
-- Une réduction au musée n'est pas une propriété du musée : elle a une date de
-- fin, une condition, un organisme qui la publie, et elle disparaîtra sans que
-- le musée bouge. En faire une famille de `places` aurait obligé à dupliquer le
-- lieu pour chaque avantage, puis à le supprimer quand l'avantage expire.
--
-- Une offre est donc une ENTITÉ À PART, éventuellement rattachée à un lieu.
-- La même table servira « Sorties gratuites », « Culture à petit prix » ou
-- « Avantages jeunes » sans une ligne de plus : ce qui change entre elles,
-- c'est `audience_tags` et `offer_type`, pas le schéma.
--
--
-- `audience_tags` DÉCRIT L'OFFRE, JAMAIS LA PERSONNE
--
-- `student` veut dire « cette offre s'adresse aux étudiants », et rien
-- d'autre. Regarder les bons plans étudiants ne fait de personne un étudiant,
-- et aucune table de ce lot ne stocke une conclusion sur qui regarde.
--
--
-- UNE OFFRE SANS SOURCE VÉRIFIABLE N'EXISTE PAS
--
-- `source_url` est NOT NULL, et c'est une décision, pas un oubli de nullable :
-- une réduction qu'on ne peut pas aller vérifier est une rumeur. La contrainte
-- est au schéma pour qu'aucun import, présent ou futur, ne puisse la
-- contourner.
-- ---------------------------------------------------------------------------

create table if not exists public.offers (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  description       text,
  -- Ce que l'offre donne. Liste ouverte volontairement courte : elle sert à
  -- écrire une phrase juste sur une carte, pas à ranger le monde.
  offer_type        text not null default 'avantage'
                    check (offer_type in ('gratuite','reduction','tarif_reduit',
                                          'avantage','operation','pass')),
  audience_tags     text[] not null default '{all}'::text[]
                    check (audience_tags <@ array['all','student','young','family',
                                                  'senior','jobseeker']::text[]
                           and cardinality(audience_tags) > 0),

  place_id          uuid references public.places(id) on delete set null,
  zone_id           text references public.autour_zones(zone_id),
  lat               double precision,
  lng               double precision,
  geom              topology.geometry(Point, 4326),

  starts_at         timestamptz,
  ends_at           timestamptz,
  -- La condition, en une phrase courte et RECOPIÉE de la source. On ne résume
  -- pas une condition d'éligibilité : un résumé faux se paie au guichet.
  eligibility       text,

  source_name       text not null,
  source_url        text not null check (source_url ~ '^https?://'),
  source_updated_at timestamptz,

  image_refs        jsonb not null default '{}'::jsonb,
  image_url         text,
  image_source      text,
  image_author      text,
  image_license     text,
  image_type        text,

  dedup_key         text,
  status            text not null default 'active'
                    check (status in ('active','expired','disabled')),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.offers is
  'Opportunités — gratuité, réduction, avantage — rattachables à un lieu. audience_tags décrit l''offre, jamais la personne qui la regarde.';

create unique index if not exists offers_dedup_key_idx
  on public.offers (dedup_key) where dedup_key is not null;
create index if not exists offers_geom_gist on public.offers using gist (geom);
create index if not exists offers_audience_gin on public.offers using gin (audience_tags);
create index if not exists offers_zone_idx
  on public.offers (zone_id, status, ends_at);
create index if not exists offers_place_idx
  on public.offers (place_id) where place_id is not null;


create table if not exists public.offer_sources (
  id                bigint generated always as identity primary key,
  offer_id          uuid not null references public.offers(id) on delete cascade,
  source            text not null,
  external_id       text not null,
  source_url        text,
  -- La charge brute n'est conservée que lorsque la source l'autorise. Le
  -- registre porte ce droit, source par source : rien n'est stocké par défaut.
  raw_data          jsonb,
  source_updated_at timestamptz,
  first_seen_at     timestamptz not null default now(),
  synced_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (source, external_id)
);

comment on table public.offer_sources is
  'Provenances d''une offre. Même philosophie qu''event_sources et place_sources. Table privée.';

create index if not exists offer_sources_offer_idx on public.offer_sources (offer_id);


-- ---------------------------------------------------------------------------
-- LE REGISTRE DES SOURCES SURVEILLÉES
--
-- ON NE PART PAS À LA PÊCHE SUR INTERNET. Une source entre ici parce qu'elle a
-- été identifiée et qu'on a le droit de la lire ; ensuite seulement elle est
-- consultée périodiquement. Le registre porte donc autant les règles d'accès
-- que l'adresse.
--
-- `etag` et `last_modified` ne sont pas de la décoration : sans eux, chaque
-- passage retélécharge une page qui n'a pas changé, et une source polie
-- devient un visiteur pénible.
-- ---------------------------------------------------------------------------

create table if not exists public.offer_source_registry (
  id                bigint generated always as identity primary key,
  name              text not null,
  base_url          text not null check (base_url ~ '^https?://'),
  source_type       text not null default 'json'
                    check (source_type in ('json','rss','html')),
  -- Une source peut être nationale (zone_id nul) ou territoriale.
  zone_id           text references public.autour_zones(zone_id),
  audience_tags     text[] not null default '{all}'::text[],
  active            boolean not null default true,
  poll_interval     interval not null default interval '1 day',
  -- Le droit de conserver la charge brute se déclare source par source. Il
  -- n'est jamais supposé.
  conserver_brut    boolean not null default false,
  -- Ce que la source dit d'elle-même la dernière fois qu'on l'a lue.
  etag              text,
  last_modified     text,
  last_checked_at   timestamptz,
  last_success_at   timestamptz,
  parser_version    text not null default 'v1',
  status            text not null default 'nouvelle'
                    check (status in ('nouvelle','ok','inchangee','erreur','desactivee')),
  dernier_message   text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (base_url)
);

comment on table public.offer_source_registry is
  'Sources d''offres identifiées et autorisées, consultées périodiquement. Aucun crawl ouvert : une source entre ici avant d''être lue.';

create index if not exists offer_source_registry_a_lire_idx
  on public.offer_source_registry (active, last_checked_at nulls first)
  where active;


-- Le journal des passages. Sans lui, une collecte interrompue recommence à
-- zéro et une source silencieuse depuis trois semaines passe inaperçue.
create table if not exists public.offer_collectes (
  id            bigint generated always as identity primary key,
  registry_id   bigint not null references public.offer_source_registry(id) on delete cascade,
  requete_id    bigint,
  lance_le      timestamptz not null default now(),
  verse_le      timestamptz,
  statut        text not null default 'lancee'
                check (statut in ('lancee','versee','inchangee','vide','echec')),
  code_http     integer,
  lus           integer,
  retenus       integer,
  crees         integer,
  revus         integer,
  rejetes       integer,
  message       text
);

create index if not exists offer_collectes_pendantes_idx
  on public.offer_collectes (statut, lance_le) where statut = 'lancee';


-- ---------------------------------------------------------------------------
-- LE DÉCLENCHEUR : géométrie, zone, slug, expiration
-- ---------------------------------------------------------------------------

create or replace function public.offers_avant_ecriture()
returns trigger
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare base text;
begin
  /* Une offre rattachée à un lieu hérite de sa position : c'est le lieu qui
     sait où il est, et deux vérités géographiques pour un même point
     finiraient par diverger. */
  if new.place_id is not null then
    select p.lat, p.lng, coalesce(new.zone_id, p.zone_id)
      into new.lat, new.lng, new.zone_id
      from public.places p where p.id = new.place_id;
  end if;

  new.geom := case
    when new.lat is null or new.lng is null then null
    else ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)
  end;

  /* Le rattachement territorial passe par la MÊME porte que les lieux et les
     événements. Elle ne fait que chercher : aucune offre ne crée de zone. */
  new.zone_id := coalesce(new.zone_id, public.zone_autour_pour(new.lat, new.lng));

  new.dedup_key := case
    when public.place_nom_normalise(new.title) is null then null
    else public.place_nom_normalise(new.title)
         || '|' || coalesce(new.source_name, '')
         || '|' || coalesce(to_char(new.ends_at at time zone 'UTC', 'YYYYMMDD'), 'sansfin')
  end;

  /* Une offre dont la date de fin est passée n'est pas supprimée : elle est
     close. On garde la trace — c'est ce qui permet de dire « c'était vrai
     jusqu'au 30 juin » plutôt que de faire comme si elle n'avait jamais
     existé. */
  if new.ends_at is not null and new.ends_at < now() and new.status = 'active' then
    new.status := 'expired';
  end if;

  if tg_op = 'INSERT' and new.slug is null then
    base := coalesce(nullif(replace(coalesce(
      public.place_nom_normalise(new.title), ''), ' ', '-'), ''), 'offre');
    new.slug := left(base, 60) || '-' || substr(md5(new.id::text), 1, 6);
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists offers_avant_ecriture on public.offers;
create trigger offers_avant_ecriture
  before insert or update on public.offers
  for each row execute function public.offers_avant_ecriture();


-- ---------------------------------------------------------------------------
-- SÉCURITÉ — la posture du Lot S, appliquée d'emblée
-- ---------------------------------------------------------------------------

alter table public.offers                enable row level security;
alter table public.offer_sources         enable row level security;
alter table public.offer_source_registry enable row level security;
alter table public.offer_collectes       enable row level security;

drop policy if exists "offres: lecture publique" on public.offers;
create policy "offres: lecture publique" on public.offers
  for select using (true);

revoke all on public.offers from anon, authenticated;
grant select on public.offers to anon, authenticated;
grant all on public.offers to service_role;

-- Provenances, registre et journal : rien de tout cela n'est une donnée de
-- produit. Ni lecture ni écriture depuis le navigateur.
revoke all on public.offer_sources         from anon, authenticated, public;
revoke all on public.offer_source_registry from anon, authenticated, public;
revoke all on public.offer_collectes       from anon, authenticated, public;
grant all on public.offer_sources         to service_role;
grant all on public.offer_source_registry to service_role;
grant all on public.offer_collectes       to service_role;


-- ---------------------------------------------------------------------------
-- L'INGESTION — une seule porte, réservée au serveur
--
-- Niveau 1 : `source` + `external_id`, comme partout ailleurs dans Autour.
-- Niveau 2 : `dedup_key` — même titre normalisé, même organisme, même date de
-- fin. Deux offres qui coïncident sur ces trois-là sont la même annonce reprise
-- deux fois.
-- ---------------------------------------------------------------------------

create or replace function public.offres_ingerer(
  p_source        text,
  p_external_id   text,
  p_titre         text,
  p_source_name   text,
  p_source_url    text,
  p_description   text default null,
  p_offer_type    text default 'avantage',
  p_audience      text[] default array['all']::text[],
  p_place_id      uuid default null,
  p_zone_id       text default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_debut         timestamptz default null,
  p_fin           timestamptz default null,
  p_eligibilite   text default null,
  p_maj_source    timestamptz default null,
  p_raw           jsonb default null)
returns table (offer_id uuid, action text)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  v_id uuid; v_action text; v_dedup text;
begin
  /* Les trois refus. Ils sont ici et pas seulement au schéma, pour que
     l'appelant reçoive un « rien » explicite plutôt qu'une exception. */
  if nullif(btrim(coalesce(p_titre, '')), '') is null then return; end if;
  if p_source_url is null or p_source_url !~ '^https?://' then return; end if;
  if nullif(btrim(coalesce(p_source_name, '')), '') is null then return; end if;

  select o.id into v_id from public.offer_sources s
    join public.offers o on o.id = s.offer_id
   where s.source = p_source and s.external_id = p_external_id;

  if v_id is null then
    v_dedup := public.place_nom_normalise(p_titre)
      || '|' || coalesce(p_source_name, '')
      || '|' || coalesce(to_char(p_fin at time zone 'UTC', 'YYYYMMDD'), 'sansfin');
    select o.id into v_id from public.offers o where o.dedup_key = v_dedup;
  end if;

  if v_id is not null then
    v_action := 'revue';
    update public.offers o set
      description   = coalesce(nullif(btrim(coalesce(p_description,'')),''), o.description),
      eligibility   = coalesce(nullif(btrim(coalesce(p_eligibilite,'')),''), o.eligibility),
      place_id      = coalesce(o.place_id, p_place_id),
      ends_at       = coalesce(p_fin, o.ends_at),
      starts_at     = coalesce(p_debut, o.starts_at),
      source_updated_at = coalesce(p_maj_source, o.source_updated_at),
      status        = case when coalesce(p_fin, o.ends_at) is not null
                            and coalesce(p_fin, o.ends_at) < now() then 'expired'
                           else 'active' end,
      last_seen_at  = now()
    where o.id = v_id;
  else
    v_action := 'creee';
    insert into public.offers (
      title, description, offer_type, audience_tags, place_id, zone_id,
      lat, lng, starts_at, ends_at, eligibility,
      source_name, source_url, source_updated_at)
    values (
      btrim(p_titre), nullif(btrim(coalesce(p_description,'')),''),
      coalesce(p_offer_type, 'avantage'),
      coalesce(nullif(p_audience, '{}'::text[]), array['all']::text[]),
      p_place_id, p_zone_id, p_lat, p_lng, p_debut, p_fin,
      nullif(btrim(coalesce(p_eligibilite,'')),''),
      btrim(p_source_name), btrim(p_source_url), p_maj_source)
    returning id into v_id;
  end if;

  insert into public.offer_sources (
    offer_id, source, external_id, source_url, raw_data, source_updated_at, synced_at)
  values (v_id, p_source, p_external_id, p_source_url, p_raw, p_maj_source, now())
  on conflict (source, external_id) do update
    set synced_at = now(),
        source_url = coalesce(excluded.source_url, public.offer_sources.source_url),
        raw_data   = coalesce(excluded.raw_data, public.offer_sources.raw_data);

  return query select v_id, v_action;
end;
$function$;

revoke all on function public.offres_ingerer(
  text, text, text, text, text, text, text, text[], uuid, text,
  double precision, double precision, timestamptz, timestamptz, text,
  timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.offres_ingerer(
  text, text, text, text, text, text, text, text[], uuid, text,
  double precision, double precision, timestamptz, timestamptz, text,
  timestamptz, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- LA LECTURE PUBLIQUE — ce qu'Explorer demande
--
-- Actives, non expirées, dans la zone ou réellement proches, et porteuses
-- d'une source qu'on peut ouvrir. Le tri met devant ce qui se termine bientôt :
-- une offre qui expire dans trois jours est plus utile qu'une permanente.
-- ---------------------------------------------------------------------------

create or replace function public.offres_publiques(
  p_audience  text default 'student',
  p_zone_id   text default null,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_rayon_m   double precision default null,
  p_limite    integer default 20)
returns table (
  id uuid, slug text, title text, description text, offer_type text,
  audience_tags text[], eligibility text,
  place_id uuid, place_name text, commune text,
  lat double precision, lng double precision, distance_m double precision,
  starts_at timestamptz, ends_at timestamptz,
  source_name text, source_url text,
  image_url text, image_source text, image_license text, image_type text)
language sql
stable
set search_path to 'public', 'topology'
as $function$
  select o.id, o.slug, o.title, o.description, o.offer_type,
         o.audience_tags, o.eligibility,
         o.place_id, p.name, p.commune,
         o.lat, o.lng,
         case when p_lat is null or p_lng is null or o.geom is null then null
              else ST_Distance(o.geom::topology.geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography) end,
         o.starts_at, o.ends_at, o.source_name, o.source_url,
         o.image_url, o.image_source, o.image_license, o.image_type
    from public.offers o
    left join public.places p on p.id = o.place_id
   where o.status = 'active'
     and (o.ends_at is null or o.ends_at >= now())
     and (o.starts_at is null or o.starts_at <= now() + interval '90 days')
     and o.source_url is not null
     and (p_audience is null or o.audience_tags && array[p_audience]::text[])
     and (p_zone_id is null or o.zone_id = p_zone_id or o.zone_id is null)
     and (p_lat is null or p_lng is null or p_rayon_m is null or o.geom is null
          or ST_DWithin(o.geom::topology.geography,
               ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography, p_rayon_m))
   order by (o.ends_at is null), o.ends_at, o.title
   limit least(greatest(coalesce(p_limite, 20), 1), 60);
$function$;

grant execute on function public.offres_publiques(
  text, text, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;
