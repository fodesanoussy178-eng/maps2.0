-- LE RÉVEIL DOIT TENIR LA FILE PROPRE, PAS SEULEMENT SONNER.
--
-- Deux défauts mesurés le 19 septembre, en exécution, pas en test :
--
-- 1. LE WORKER EDGE EST TUÉ EN PLEIN TRAVAIL. `WORKER_RESOURCE_LIMIT`,
--    HTTP 546, observé deux fois — à 160 s et à 270 s. La tâche qu'il tenait
--    reste `en_cours` pour toujours, parce que la file ne lit que
--    `statut = 'file'`. Quatre tâches s'y sont perdues pendant la mission, et
--    chacune a demandé un UPDATE à la main.
--
-- 2. DEUX RÉVEILS CONCURRENTS PRENNENT LA MÊME TÂCHE. Deux appels lancés à
--    quarante-cinq secondes d'intervalle ont lu la même file : Wattrelos et
--    Roubaix se sont retrouvées `en_cours` ensemble, chacune tenue par une
--    instance différente, l'une écrivant par-dessus l'autre.
--
-- Les deux se réparent ICI plutôt que dans la fonction Edge, et c'est mieux
-- ainsi : l'hygiène de la file appartient à celui qui possède la file. Un
-- correctif de ce genre se déploie alors par migration — relue, datée — et non
-- par un redéploiement de code.
--
-- LE VERROU EST CONSULTATIF ET NON BLOQUANT. `pg_try_advisory_xact_lock` rend
-- faux plutôt que d'attendre : un deuxième réveil ne s'empile pas, il renonce
-- et le dit. Il est relâché à la fin de la transaction, donc aucune fuite
-- possible si l'appel échoue.
--
-- DIX MINUTES, PARCE QU'AUCUNE TÂCHE NE PEUT DURER AUSSI LONGTEMPS. Ce n'est
-- pas une supposition sur la santé du worker : la plus longue tâche mesurée a
-- pris 63 secondes, et le worker lui-même meurt avant 300 s. Au-delà de dix
-- minutes, celui qui la tenait est forcément mort.

create or replace function private.invoke_agent_acquisition(p_mode text default 'work')
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  sync_secret text;
  request_url text;
  reprises    integer := 0;
begin
  /* Un seul réveil à la fois. Le verrou tombe avec la transaction. */
  if not pg_try_advisory_xact_lock(hashtext('agent-acquisition-reveil')) then
    return null;
  end if;

  /* Les orphelines d'abord : elles doivent pouvoir être reprises par le réveil
     qu'on est en train de déclencher. */
  if coalesce(p_mode, 'work') = 'work' then
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
  'Réveille l''agent Acquisition. Reprend d''abord les tâches orphelines (worker tué), puis appelle la fonction Edge. Un verrou consultatif non bloquant empêche deux réveils concurrents de lire la même file.';
