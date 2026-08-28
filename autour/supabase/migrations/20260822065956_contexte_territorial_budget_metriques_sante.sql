-- ===========================================================================
-- LE CONTEXTE TERRITORIAL TEMPORAIRE — 3/3
-- budget réservé, compteurs, santé des sources, préchauffage
-- ===========================================================================

-- ---- UN VRAI PLAFOND D'APPELS AU MODÈLE ----------------------------------
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

-- ---- L'OBSERVABILITÉ, ET SES LIMITES -------------------------------------
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

-- ---- LA SANTÉ DES SOURCES ------------------------------------------------
-- Une FONCTION et non une vue, pour la même raison que `mes_canaux` : c'est le
-- moule du dépôt, et il ne dépend d'aucune version de PostgreSQL.
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

-- ---- LA PRÉPARATION EN AMONT ---------------------------------------------
-- AUCUN CRON N'EST PLANIFIÉ ICI : cette fonction dépense du budget de
-- vérification, et la déclencher est une décision d'exploitation.
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
