-- `mode=sync&territory=<slug>` ne synchronise que la source la mieux classée
-- du territoire. Depuis qu'une commune peut en avoir plusieurs — sa mairie,
-- sa salle, son conservatoire —, il faut pouvoir en désigner une.
--
-- La fonction Edge le sait déjà faire : elle accepte `&source=<id>`. Il ne
-- manquait qu'un chemin depuis la base. Synchroniser source par source évite
-- aussi ce qui a tué DATAtourisme sur la métropole entière : quarante-quatre
-- agendas dans une seule invocation, c'est le mur des ressources.

create or replace function private.invoke_openagenda_source(p_source_id bigint)
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  sync_secret text;
  slug text;
begin
  select t.slug into slug
    from public.territory_sources ts
    join public.territories t on t.id = ts.territory_id
   where ts.id = p_source_id and ts.active and ts.provider = 'openagenda'
     and t.active and t.status = 'active';
  if slug is null then
    raise exception 'source OpenAgenda active introuvable : %', p_source_id;
  end if;

  select nullif(btrim(secret.decrypted_secret), '')
  into sync_secret
  from vault.decrypted_secrets secret
  where secret.name = 'event_sync_secret'
  order by secret.created_at desc
  limit 1;

  if sync_secret is null then return null; end if;

  return net.http_post(
    url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/sync-openagenda'
           || '?mode=sync&territory=' || slug || '&source=' || p_source_id,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
end;
$function$;

comment on function private.invoke_openagenda_source(bigint) is
  'Synchronise UNE source OpenAgenda désignée par son identifiant de registre, plutôt que la première du territoire.';
