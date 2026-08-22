-- ===========================================================================
-- LE CONTEXTE TERRITORIAL TEMPORAIRE
--
-- CE QUE CETTE MIGRATION AJOUTE, ET CE QU'ELLE N'AJOUTE PAS
--
-- Elle ajoute une COUCHE DE CONTEXTE : « pendant cette période et dans ce
-- territoire, ces données et ces signaux prennent davantage d'importance ».
--
-- Elle n'ajoute AUCUN catalogue d'événements. Les événements restent dans
-- `public.events` et `public.event_occurrences`, avec les mêmes règles de
-- vérité, la même déduplication et le même statut temporel. Un vide-grenier
-- reste un événement, un restaurant reste un lieu, des toilettes restent un
-- service : le contexte change leur PERTINENCE, jamais leur nature.
--
-- LA BRADERIE EST LE PREMIER CAS, PAS UNE EXCEPTION
--
-- Rien ici ne connaît le mot « Braderie » ailleurs que dans une ligne de
-- données. La Fête de la Musique, un carnaval, un marathon ou un marché de
-- Noël s'ajouteront par un INSERT, sans une ligne de code de plus.
--
-- TROIS AUTRES CHOSES, PARCE QU'ELLES CONDITIONNENT LE RESTE
--
--   · `enrichment_usage_daily` : un vrai plafond d'appels au modèle, réservé
--     AVANT l'appel et de façon atomique. Le compteur précédent comptait des
--     lignes écrites : un appel qui échoue n'écrit rien, donc ne comptait pas,
--     donc ne bornait rien.
--   · `territorial_metrics_daily` : des compteurs, et seulement des compteurs.
--     Aucune phrase, aucun identifiant de personne, aucune position.
--   · `sante_sources_evenements` : le dernier succès de chaque source, pour
--     qu'une source morte depuis trois semaines cesse de ressembler à une
--     ville sans événements.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Le registre des contextes
--
-- `preview_starts_at` est ce qui rend le bouton annonciateur possible sans
-- code : quelques jours avant, il existe et dit « bientôt ». `ends_at` est ce
-- qui le fait disparaître tout seul — aucune intervention le lundi matin.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Les zones
--
-- Un périmètre n'est pas homogène : le Vieux-Lille, Wazemmes et le centre
-- n'ont ni la même densité, ni les mêmes services. Les zones viennent d'ICI —
-- jamais d'une liste de quartiers écrite dans `app.js` avec des `if`.
--
-- `contour` porte la géométrie officielle quand elle est publiée : une liste
-- de points `[[lat,lng], …]`. Sans elle, le couple centre/rayon fait le
-- travail, et la donnée dit qu'elle est une approximation.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. Lecture publique, et seulement dans la fenêtre
--
-- Un visiteur NON CONNECTÉ doit pouvoir utiliser le mode intégralement : la
-- lecture est donc ouverte à `anon`. Elle est en revanche bornée à la fenêtre
-- d'existence du contexte — hors période, la table est muette, et le bouton ne
-- peut pas être fabriqué depuis le navigateur.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. La lecture applicative
--
-- Une seule requête, une seule fois : le navigateur ne doit pas avoir à
-- joindre deux tables ni à connaître le schéma. La fonction rend des lignes
-- plates (contexte × zone) que `territoire.js` recompose.
--
-- Elle NE DÉCLENCHE AUCUNE COLLECTE et n'écrit rien : c'est une lecture, et
-- son résultat se met en cache très longtemps côté client (un périmètre ne
-- change pas de la semaine).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Le premier cas réel : la Braderie de Lille 2026
--
-- Ce sont des DONNÉES. Elles se corrigent par un UPDATE le jour où la Ville
-- publie ses horaires définitifs ou son périmètre officiel — sans déploiement,
-- sans migration, sans toucher au code.
--
-- Les zones ci-dessous sont une APPROXIMATION assumée par centre et rayon :
-- `metadata.geometrie` le dit, pour que personne ne les prenne pour la limite
-- officielle. Dès que le périmètre est publié en géométrie, il se pose dans
-- `contour` et remplace le cercle sans autre changement.
-- ---------------------------------------------------------------------------
insert into public.territorial_contexts (
  slug, name, emoji, starts_at, ends_at, preview_starts_at, timezone,
  territory_id, active, priority, official_url, metadata
)
select
  'braderie-lille-2026',
  'Braderie de Lille 2026',
  '🧺',
  timestamptz '2026-09-05 08:00:00+02',
  timestamptz '2026-09-06 23:00:00+02',
  timestamptz '2026-08-31 00:00:00+02',
  'Europe/Paris',
  t.id,
  true,
  10,
  'https://www.lille.fr/Braderie-de-Lille',
  jsonb_build_object(
    'libelle', 'Braderie',
    'sources_officielles', jsonb_build_array('braderie_lille', 'ville_de_lille'),
    'rayon_visibilite_m', 25000,
    'horaires', 'à confirmer sur la source officielle avant la période',
    'note', 'dates et périmètre = données, pas code : un UPDATE suffit à les corriger'
  )
from public.territories t
where t.slug = 'lille'
on conflict (slug) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  preview_starts_at = excluded.preview_starts_at,
  territory_id = excluded.territory_id,
  active = excluded.active,
  priority = excluded.priority,
  official_url = excluded.official_url,
  metadata = public.territorial_contexts.metadata || excluded.metadata,
  updated_at = now();

with zones(slug, name, lat, lng, radius_m, priority) as (
  values
    ('centre',       'Centre',                 50.6371, 3.0630, 900, 10),
    ('vieux-lille',  'Vieux-Lille',            50.6437, 3.0625, 800, 20),
    ('wazemmes',     'Wazemmes',               50.6259, 3.0530, 900, 30),
    ('republique',   'République — Beaux-Arts', 50.6305, 3.0620, 700, 40),
    ('vauban',       'Vauban — Esquermes',     50.6300, 3.0420, 800, 50),
    ('moulins',      'Moulins',                50.6216, 3.0700, 800, 60),
    ('flandres',     'Gare Lille-Flandres',    50.6365, 3.0700, 600, 70)
)
insert into public.territorial_context_zones (
  context_id, slug, name, lat, lng, radius_m, priority, metadata
)
select c.id, z.slug, z.name, z.lat, z.lng, z.radius_m, z.priority,
       jsonb_build_object(
         'geometrie', 'approximation_centre_rayon',
         'remplacer_par', 'contour officiel dès publication')
from zones z
cross join public.territorial_contexts c
where c.slug = 'braderie-lille-2026'
on conflict (context_id, slug) do update set
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  radius_m = excluded.radius_m,
  priority = excluded.priority,
  metadata = public.territorial_context_zones.metadata || excluded.metadata,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 6. UN VRAI PLAFOND D'APPELS AU MODÈLE
--
-- CE QUI N'ALLAIT PAS. Le compteur comptait les LIGNES écrites depuis minuit
-- dans `place_enrichments`. Trois conséquences, toutes coûteuses :
--
--   · un appel qui échoue n'écrit rien, donc ne compte pas — alors qu'il a
--     été payé ;
--   · un appel qui ne trouve rien pour un lieu déjà connu réécrit la même
--     ligne : le compteur n'avance pas, l'appel a eu lieu ;
--   · lire puis décider n'est pas atomique : dix requêtes simultanées lisent
--     toutes « 399 » et partent toutes les dix.
--
-- LA RÈGLE VOULUE. On RÉSERVE un appel avant de le lancer. Si la réservation
-- échoue, aucun appel ne part. Un appel qui ne trouve rien compte. Un appel
-- qui échoue compte. Le plafond borne réellement le coût.
-- ---------------------------------------------------------------------------
create table if not exists public.enrichment_usage_daily (
  day        date primary key,
  -- ce que le client a demandé (mesure d'usage, ne borne rien)
  requested  integer not null default 0 check (requested >= 0),
  -- ce qui est réellement PARTI vers le modèle : c'est ce que le plafond borne
  launched   integer not null default 0 check (launched >= 0),
  successful integer not null default 0 check (successful >= 0),
  failed     integer not null default 0 check (failed >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.enrichment_usage_daily is
  'Budget quotidien des vérifications. `launched` est réservé AVANT l''appel : c''est lui, et lui seul, que le plafond borne.';

alter table public.enrichment_usage_daily enable row level security;
revoke all on public.enrichment_usage_daily from anon, authenticated;

-- La réservation. Un seul UPDATE conditionnel : c'est lui qui rend l'opération
-- atomique. Deux appels simultanés ne peuvent pas lire le même compteur —
-- l'un des deux attend le verrou de ligne, et relit la valeur incrémentée.
create or replace function public.reserver_enrichissement(p_plafond integer)
returns table (accorde boolean, lances integer, plafond integer)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  jour   date := (now() at time zone 'UTC')::date;
  limite integer := greatest(coalesce(p_plafond, 0), 0);
  v_lances integer;
begin
  insert into public.enrichment_usage_daily as u (day, requested)
  values (jour, 1)
  on conflict (day) do update
    set requested = u.requested + 1, updated_at = now();

  update public.enrichment_usage_daily u
     set launched = u.launched + 1, updated_at = now()
   where u.day = jour and u.launched < limite
  returning u.launched into v_lances;

  if v_lances is null then
    select u.launched into v_lances
      from public.enrichment_usage_daily u where u.day = jour;
    return query select false, coalesce(v_lances, 0), limite;
    return;
  end if;

  return query select true, v_lances, limite;
end;
$function$;

comment on function public.reserver_enrichissement(integer) is
  'Réserve un appel au modèle avant qu''il ne parte. Rend accorde=false quand le plafond du jour est atteint : aucun appel ne doit alors être lancé.';

-- La clôture : un appel réservé se termine toujours, d'une façon ou d'une
-- autre. « Rien trouvé » est un succès d'exécution — il a coûté, il compte, et
-- il est déjà dans `launched`.
create or replace function public.cloturer_enrichissement(p_succes boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $function$
  update public.enrichment_usage_daily u
     set successful = u.successful + (case when coalesce(p_succes, false) then 1 else 0 end),
         failed     = u.failed     + (case when coalesce(p_succes, false) then 0 else 1 end),
         updated_at = now()
   where u.day = (now() at time zone 'UTC')::date;
$function$;

comment on function public.cloturer_enrichissement(boolean) is
  'Consigne l''issue d''un appel déjà réservé. N''ouvre ni ne rend aucun budget : un appel payé reste payé.';

revoke all on function public.reserver_enrichissement(integer) from public, anon, authenticated;
revoke all on function public.cloturer_enrichissement(boolean) from public, anon, authenticated;
grant execute on function public.reserver_enrichissement(integer) to service_role;
grant execute on function public.cloturer_enrichissement(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. L'OBSERVABILITÉ, ET SES LIMITES
--
-- Des compteurs. Rien d'autre. Aucune phrase saisie dans Aide, aucun
-- identifiant de personne, aucune position : la fonction n'accepte qu'un nom
-- de métrique pris dans une liste fermée, un slug de zone, et un entier borné.
-- Ce qui n'est pas dans la liste est refusé en silence plutôt qu'écrit.
-- ---------------------------------------------------------------------------
create table if not exists public.territorial_metrics_daily (
  day          date not null,
  context_slug text not null,
  zone_slug    text not null default '',
  metric       text not null,
  valeur       bigint not null default 0 check (valeur >= 0),
  updated_at   timestamptz not null default now(),
  primary key (day, context_slug, zone_slug, metric)
);

comment on table public.territorial_metrics_daily is
  'Compteurs du mode territorial. Aucune donnée personnelle : un nom de métrique, un slug de zone, un entier.';

alter table public.territorial_metrics_daily enable row level security;
revoke all on public.territorial_metrics_daily from anon, authenticated;

create or replace function public.compter_metrique_territoriale(
  p_context text,
  p_metrique text,
  p_valeur integer default 1,
  p_zone text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  contexte text := lower(btrim(coalesce(p_context, '')));
  zone     text := lower(btrim(coalesce(p_zone, '')));
  pas      integer := least(greatest(coalesce(p_valeur, 1), 1), 1000);
begin
  -- La liste est fermée, et c'est le point : elle empêche d'écrire ici autre
  -- chose que ce qui a été prévu, y compris par erreur.
  if p_metrique not in (
    'territorial_mode_opened', 'territorial_zone_changed', 'territorial_recompute',
    'territorial_cache_hit', 'territorial_cache_miss', 'territorial_results_count',
    'territorial_gemini_requested', 'territorial_gemini_skipped_fresh_data',
    'territorial_gemini_budget_blocked'
  ) then
    return;
  end if;
  if contexte !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then return; end if;
  if zone <> '' and zone !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then return; end if;
  -- Un contexte inconnu n'écrit rien : la table ne sert pas de dépotoir.
  if not exists (select 1 from public.territorial_contexts c where c.slug = contexte) then
    return;
  end if;

  insert into public.territorial_metrics_daily as m (day, context_slug, zone_slug, metric, valeur)
  values ((now() at time zone 'UTC')::date, contexte, zone, p_metrique, pas)
  on conflict (day, context_slug, zone_slug, metric) do update
    set valeur = m.valeur + pas, updated_at = now();
end;
$function$;

comment on function public.compter_metrique_territoriale(text, text, integer, text) is
  'Incrémente un compteur du mode territorial. Refuse en silence tout nom hors liste : rien d''autre ne peut être écrit ici.';

revoke all on function public.compter_metrique_territoriale(text, text, integer, text) from public;
grant execute on function public.compter_metrique_territoriale(text, text, integer, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. LA SANTÉ DES SOURCES
--
-- Une donnée vieille reste utilisable selon sa nature ; ce qui n'est pas
-- acceptable, c'est qu'Autour ignore son âge. Cette fonction répond en une
-- ligne par source : quand a-t-elle réussi pour la dernière fois, quand a-t-elle
-- échoué, et depuis combien de temps.
--
-- Une FONCTION et non une vue, pour la même raison que `mes_canaux` : c'est le
-- moule du dépôt, et il ne dépend d'aucune version de PostgreSQL.
--
-- Elle reste PRIVÉE, comme le journal dont elle est tirée : c'est un outil de
-- diagnostic, pas une information de produit. Une source en panne ne doit pas
-- empêcher les autres de fonctionner, mais son silence doit être visible.
-- ---------------------------------------------------------------------------
create or replace function public.sante_sources_evenements()
returns table (
  source             text,
  territory          text,
  dernier_succes     timestamptz,
  dernier_echec      timestamptz,
  age_du_succes      interval,
  succes_7j          bigint,
  echecs_7j          bigint,
  derniere_tentative timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    r.source,
    r.territory,
    max(r.started_at) filter (where r.status = 'success'),
    max(r.started_at) filter (where r.status in ('error', 'partial')),
    now() - max(r.started_at) filter (where r.status = 'success'),
    count(*) filter (where r.status = 'success'
                       and r.started_at > now() - interval '7 days'),
    count(*) filter (where r.status in ('error', 'partial')
                       and r.started_at > now() - interval '7 days'),
    max(r.started_at)
  from public.event_sync_runs r
  group by r.source, r.territory
  order by r.source, r.territory;
$function$;

comment on function public.sante_sources_evenements() is
  'Dernier succès et dernier échec par source de synchronisation. Une source muette depuis trois semaines ne doit pas ressembler à une ville sans événements.';

revoke all on function public.sante_sources_evenements() from public, anon, authenticated;
grant execute on function public.sante_sources_evenements() to service_role;

-- ---------------------------------------------------------------------------
-- 9. LA PRÉPARATION EN AMONT
--
-- CE QUE LE JOUR J DOIT ÊTRE : du classement, pas de la collecte. À 14 h 30 le
-- samedi, personne ne doit attendre qu'une API découvre la ville.
--
-- La fonction ci-dessous ne collecte rien elle-même : elle NOMME les rares
-- objets pour lesquels une vérification vaut son prix — un événement du
-- contexte, dans le périmètre, dont une information critique manque, et dont
-- aucun enrichissement frais ne parle déjà. C'est la liste qu'on préchauffe
-- quelques jours avant, pas la ville entière.
--
-- POURQUOI CÔTÉ SERVEUR, ET PAS DEPUIS LE NAVIGATEUR. `enrichir-lieu` garde
-- `verify_jwt = true`, et c'est voulu : un visiteur non connecté doit pouvoir
-- utiliser le mode INTÉGRALEMENT — il lit `place_enrichments`, qui est public
-- — sans qu'on ait à désactiver la garde ni à poser un secret dans la page.
-- Le préchauffage est donc un travail de serveur, avec la clé du Vault, et il
-- ne descend jamais dans le navigateur.
--
-- AUCUN CRON N'EST PLANIFIÉ ICI. Cette fonction dépense du budget de
-- vérification : la déclencher est une décision d'exploitation, pas un effet
-- de bord d'une migration. Elle s'appelle à la main, ou se planifie le jour où
-- quelqu'un le décide :
--
--   select private.prechauffer_contexte('braderie-lille-2026', 25);
-- ---------------------------------------------------------------------------
create or replace function private.candidats_prechauffage(
  p_contexte text,
  p_limite integer default 25
)
returns table (
  event_id   uuid,
  title      text,
  place_name text,
  lat        double precision,
  lng        double precision,
  city       text,
  manque     text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with contexte as (
    select c.id, c.slug, c.starts_at, c.ends_at
    from public.territorial_contexts c
    where c.slug = p_contexte and c.active
  ),
  -- EXISTS plutôt que DISTINCT : un événement couvert par trois zones ne doit
  -- apparaître qu'une fois, et dédoublonner par `distinct e.*` obligerait à
  -- comparer la colonne géométrique pour rien.
  dans_le_perimetre as (
    select e.*
    from public.events e
    join contexte c on true
    where e.cancelled = false
      and e.lat is not null and e.lng is not null
      and e.start_at is not null
      and e.start_at < c.ends_at
      and coalesce(e.end_at, e.start_at) > c.starts_at
      and exists (
        select 1
        from public.territorial_context_zones z
        where z.context_id = c.id
          and z.lat is not null and z.lng is not null
          and 6371000 * 2 * asin(least(1, sqrt(
                power(sin(radians(z.lat - e.lat) / 2), 2) +
                cos(radians(e.lat)) * cos(radians(z.lat)) *
                power(sin(radians(z.lng - e.lng) / 2), 2)
              ))) <= z.radius_m
      )
  )
  select e.id, e.title, e.place_name, e.lat, e.lng, e.city,
         -- une seule raison par ligne : c'est elle qui justifie la dépense
         case
           when e.date_confidence = 'unknown' then 'unknownSchedule'
           when e.source_url is null then 'missingTicketUrl'
           else 'unknownCurrentStatus'
         end
  from dans_le_perimetre e
  where not exists (
    -- déjà vérifié et encore frais : il n'y a rien à préchauffer
    select 1 from public.place_enrichments p
    where p.expires_at > now()
      and p.lat is not null and p.lng is not null
      and abs(p.lat - e.lat) < 0.0005 and abs(p.lng - e.lng) < 0.0005
  )
  and (e.date_confidence = 'unknown' or e.source_url is null)
  order by e.start_at
  limit least(greatest(coalesce(p_limite, 25), 1), 200);
$function$;

comment on function private.candidats_prechauffage(text, integer) is
  'Les rares objets d''un contexte pour lesquels une vérification vaut son prix. Ne collecte rien : nomme.';

revoke all on function private.candidats_prechauffage(text, integer)
  from public, anon, authenticated;

-- Le déclencheur. Il présente la clé secrète du Vault en `Authorization` :
-- c'est ce qui satisfait `verify_jwt` sans rien désactiver et sans qu'aucun
-- secret n'approche le navigateur.
create or replace function private.prechauffer_contexte(
  p_contexte text,
  p_limite integer default 25
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cle text;
  candidat record;
  envoyes integer := 0;
begin
  select nullif(btrim(secret.decrypted_secret), '')
  into cle
  from vault.decrypted_secrets secret
  where secret.name = 'enrichment_service_key'
  order by secret.created_at desc
  limit 1;

  -- Sans clé, on ne préchauffe pas : ce n'est pas une panne, c'est une
  -- configuration absente, et le mode fonctionne sans elle.
  if cle is null then return 0; end if;

  for candidat in
    select * from private.candidats_prechauffage(p_contexte, p_limite)
  loop
    perform net.http_post(
      url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/enrichir-lieu',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', cle,
        'Authorization', 'Bearer ' || cle
      ),
      body := jsonb_build_object(
        'nom', coalesce(candidat.place_name, candidat.title),
        'lat', candidat.lat,
        'lng', candidat.lng,
        'commune', coalesce(candidat.city, '')
      ),
      timeout_milliseconds := 20000
    );
    envoyes := envoyes + 1;
  end loop;

  -- Le plafond du jour s'applique exactement pareil : ces appels passent par
  -- `reserver_enrichissement` comme tous les autres. Préparer en amont ne
  -- déplafonne rien.
  return envoyes;
end;
$function$;

comment on function private.prechauffer_contexte(text, integer) is
  'Demande une vérification pour les rares candidats d''un contexte, avec la clé du Vault. Aucun cron : c''est une décision d''exploitation.';

revoke all on function private.prechauffer_contexte(text, integer)
  from public, anon, authenticated;
