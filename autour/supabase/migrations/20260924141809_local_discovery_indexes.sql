-- ---------------------------------------------------------------------------
-- Suite de 20260924141304 : les deux index de jointure que l'advisor a
-- réclamés après le premier déploiement. Appliqués en production le même jour,
-- absents du dépôt jusqu'ici.
-- ---------------------------------------------------------------------------

-- Indexes de jointure signalés par l'advisor après le premier déploiement.
create index if not exists local_discovery_runs_task_idx
  on public.local_discovery_runs (task_id) where task_id is not null;
create index if not exists local_discovery_candidates_run_idx
  on public.local_discovery_candidates (run_id);
