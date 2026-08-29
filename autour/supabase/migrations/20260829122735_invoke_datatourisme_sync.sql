-- DATAtourisme n'était plus synchronisée depuis le 27 août, et la cause n'est
-- ni la table `territory_sources`, ni le rectangle : c'est un 401.
--
-- CE QU'ON A MESURÉ. Les 30 dernières exécutions de la tâche GitHub
-- « Événements Autour » ont échoué, toutes les six zones, quatre fois par
-- jour, avec `curl: (22) ... 401` et `{"error":"non autorisé"}`. Le journal
-- de la fonction dit lequel des trois cas c'est :
--
--   {"fonction":"sync-datatourisme","etape":"refus",
--    "secret_configure":true,"entete_presente":true}
--
-- Les deux secrets EXISTENT et DIFFÈRENT. GitHub présente un `x-sync-secret`
-- qui n'est pas celui que la fonction attend.
--
-- OpenAgenda, elle, tourne toutes les trois heures sans faute. Pourquoi :
-- elle n'est pas déclenchée par GitHub mais par pg_cron, à travers
-- `private.invoke_event_sync`, qui lit le secret dans le Vault du projet et
-- appelle la fonction par `net.http_post`. Le secret du Vault, lui, est le
-- bon.
--
-- On donne donc à DATAtourisme le même chemin. Ce n'est pas un contournement
-- de l'authentification : c'est la même porte, ouverte avec la clé que le
-- projet détient déjà, sans que ce secret sorte jamais de la base. La tâche
-- GitHub reste en place ; quand ses deux secrets seront réalignés elle
-- refonctionnera, et les deux chemins mènent à la même fonction.

create or replace function private.invoke_datatourisme_sync(p_area text default null)
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  sync_secret text;
  request_url text;
begin
  select nullif(btrim(secret.decrypted_secret), '')
  into sync_secret
  from vault.decrypted_secrets secret
  where secret.name = 'event_sync_secret'
  order by secret.created_at desc
  limit 1;

  if sync_secret is null then return null; end if;

  request_url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/sync-datatourisme';
  if p_area is not null then
    request_url := request_url || '?area=' || p_area;
  end if;

  return net.http_post(
    url := request_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end;
$function$;

comment on function private.invoke_datatourisme_sync(text) is
  'Déclenche sync-datatourisme depuis la base, avec le secret du Vault — le même chemin que celui qui fait tourner OpenAgenda sans faute. Passer un code de zone pour ne synchroniser qu''elle.';
