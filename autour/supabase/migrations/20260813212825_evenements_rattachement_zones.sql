-- Rattachement des événements aux zones.
-- Le déclencheur d'écriture ne résout `area_id` qu'à l'écriture ; les
-- événements déjà présents quand une zone est ouverte restaient orphelins.
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
