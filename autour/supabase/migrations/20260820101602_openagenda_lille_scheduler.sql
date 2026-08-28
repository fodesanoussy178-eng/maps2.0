-- ---------------------------------------------------------------------------
-- OpenAgenda Lille : planification native Supabase toutes les trois heures
--
-- Le secret d'appel n'est jamais stocké dans cette migration. Le job appelle
-- une fonction privée qui lit `event_sync_secret` dans Supabase Vault au
-- moment de l'exécution. Tant que ce secret n'existe pas, aucun appel HTTP
-- n'est émis et la tâche reste sans effet.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Le journal existant reste la source de vérité opérationnelle. Les colonnes
-- détaillées évitent de devoir interpréter le JSON pour les contrôles usuels.
alter table public.event_sync_runs
  add column if not exists territory text,
  add column if not exists pages integer not null default 0,
  add column if not exists occurrences_seen integer not null default 0,
  add column if not exists occurrences_inserted integer not null default 0,
  add column if not exists occurrences_updated integer not null default 0,
  add column if not exists duplicates integer not null default 0,
  add column if not exists ignored integer not null default 0;

alter table public.event_sync_runs
  drop constraint if exists event_sync_runs_status_check;
alter table public.event_sync_runs
  add constraint event_sync_runs_status_check
  check (status in ('running', 'success', 'partial', 'error', 'skipped'));

-- Le couple source + scope ne peut avoir qu'une ingestion OpenAgenda active.
-- Les courses interrompues sont libérées par la fonction Edge après 45 min.
create unique index if not exists event_sync_runs_one_openagenda_scope_running
  on public.event_sync_runs (source, scope)
  where status = 'running' and source = 'openagenda';

create or replace function private.invoke_openagenda_lille_sync()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  sync_secret text;
begin
  select nullif(btrim(secret.decrypted_secret), '')
    into sync_secret
    from vault.decrypted_secrets secret
   where secret.name = 'event_sync_secret'
   order by secret.created_at desc
   limit 1;

  -- Préparation sûre : le scheduler peut exister avant le secret Vault sans
  -- envoyer une requête non authentifiée à la fonction Edge.
  if sync_secret is null then
    return null;
  end if;

  return net.http_post(
    url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/sync-openagenda?mode=sync&territory=lille',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10_000
  );
end;
$function$;

comment on function private.invoke_openagenda_lille_sync() is
  'Déclenche sync-openagenda pour Lille avec event_sync_secret lu dans Vault. Sans secret, aucun appel HTTP.';

revoke all on function private.invoke_openagenda_lille_sync() from public, anon, authenticated;

-- pg_cron utilise le fuseau GMT/UTC du projet. Le nom stable rend cette
-- opération rejouable : cron.schedule remplace le job homonyme.
select cron.schedule(
  'openagenda-lille-sync-every-3-hours',
  '0 */3 * * *',
  $cron$select private.invoke_openagenda_lille_sync();$cron$
);
