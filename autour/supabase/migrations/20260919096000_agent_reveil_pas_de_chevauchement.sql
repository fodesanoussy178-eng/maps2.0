-- CORRECTIF DU CORRECTIF : LE VERROU CONSULTATIF NE PROTÉGEAIT RIEN.
--
-- La migration précédente prenait `pg_try_advisory_xact_lock` au début du
-- réveil. C'était inutile, et il vaut mieux l'écrire que laisser croire qu'on
-- est protégé : la transaction du réveil ne fait qu'EMPILER une requête dans
-- `net.http_request_queue` et rendre la main. Elle dure quelques
-- millisecondes. Le verrou tombe donc AVANT même que la fonction Edge ait
-- commencé à travailler, et deux réveils espacés d'une seconde passeraient tous
-- les deux.
--
-- Ce qu'il faut vérifier n'est pas « un autre réveil est-il en train de
-- sonner », c'est « une exécution est-elle en train de travailler ». Et ça,
-- la file le dit : une tâche `en_cours` veut dire qu'un worker la tient.
--
-- L'ordre compte. La reprise des orphelines passe D'ABORD : sans elle, une
-- tâche restée `en_cours` après la mort d'un worker bloquerait tous les
-- réveils suivants, pour toujours. C'est précisément le cas qu'on répare.
--
-- Vérifié en exécution, les deux branches :
--   · une tâche « en_cours » récente → le réveil rend NULL, rien n'est appelé ;
--   · la même vieillie de 11 minutes → elle repasse en « file » avec la raison
--     écrite, et le réveil sonne.

create or replace function private.invoke_agent_acquisition(p_mode text default 'work')
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  sync_secret text;
  request_url text;
  reprises    integer := 0;
  en_vol      integer := 0;
begin
  if coalesce(p_mode, 'work') = 'work' then
    /* 1. Les orphelines d'abord : une tâche que plus personne ne tient ne doit
          pas passer pour une exécution en cours. */
    update public.tasks
       set statut = 'file',
           demarree_le = null,
           erreur = 'Reprise automatique : l''exécution précédente a été interrompue avant la fin.'
     where agent = 'acquisition'
       and statut = 'en_cours'
       and demarree_le < now() - interval '10 minutes';
    get diagnostics reprises = row_count;

    if reprises > 0 then
      insert into public.runs (task_id, agent, etape, statut, message, compteurs, fin)
      values (null, 'acquisition', 'reprise', 'partiel',
              reprises || ' tâche(s) restée(s) « en_cours » plus de 10 minutes ont été remises en file : '
              || 'l''exécution qui les tenait a été interrompue.',
              jsonb_build_object('reprises', reprises), now());
    end if;

    /* 2. Ce qui reste « en_cours » est réellement tenu par un worker vivant.
          On ne réveille pas par-dessus : deux exécutions qui lisent la même
          file se marchent dessus, mesuré le 19/09 sur Wattrelos et Roubaix. */
    select count(*) into en_vol
      from public.tasks
     where agent = 'acquisition' and statut = 'en_cours';

    if en_vol > 0 then return null; end if;
  end if;

  select nullif(btrim(secret.decrypted_secret), '')
  into sync_secret
  from vault.decrypted_secrets secret
  where secret.name = 'event_sync_secret'
  order by secret.created_at desc
  limit 1;

  if sync_secret is null then return null; end if;

  request_url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/agent-acquisition'
                 || '?mode=' || coalesce(p_mode, 'work');

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

comment on function private.invoke_agent_acquisition(text) is
  'Réveille l''agent Acquisition. Reprend d''abord les tâches orphelines (worker tué), puis refuse de sonner si une exécution travaille encore. Rend NULL dans ce cas.';
