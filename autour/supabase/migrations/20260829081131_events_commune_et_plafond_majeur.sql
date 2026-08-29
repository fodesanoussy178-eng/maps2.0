-- Deux garanties qui ne dépendent plus d'un déploiement de connecteur.
--
-- LA COMMUNE. `city` reste ce que la source a écrit, à une correction près :
-- les variantes purement orthographiques sont rendues à la forme officielle
-- — « LILLE » devient « Lille », « Faches Thumesnil » devient
-- « Faches-Thumesnil ». On ne touche PAS aux communes associées : « Hellemmes »
-- reste « Hellemmes », parce qu'écrire « Lille » à sa place effacerait ce que
-- quelqu'un cherchait. C'est `commune` qui porte le rattachement
-- métropolitain, et c'est lui qui sert à grouper et à auditer.
--
-- LE PLAFOND. `major` ne peut plus être atteint par accumulation de points.
-- Le connecteur propose, la base dispose : sans raison nommable
-- (`evenement_est_majeur`), un `major` retombe à `important`. La règle vit
-- ici, donc corriger une liste de lieux ne demande aucun redéploiement.

alter table public.events
  add column if not exists commune text;

comment on column public.events.commune is
  'Commune de rattachement dans la Métropole Européenne de Lille, forme officielle. NULL hors MEL. Sert au groupement et à l''audit ; `city` garde ce que la source a écrit.';

create index if not exists events_commune_idx on public.events (commune) where commune is not null;

create or replace function public.events_avant_ecriture()
returns trigger
language plpgsql
set search_path to 'public', 'topology'
as $function$
    declare
      m record;
    begin
      new.geom := case
        when new.lat is null or new.lng is null then null
        else ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)
      end;

      new.dedup_key := public.event_dedup_key(new.title, new.lat, new.lng, new.start_at);

      new.temporal_status := public.event_temporal_status(
        new.start_at, new.end_at, new.date_confidence, new.cancelled, now());

      if new.area_id is null and new.lat is not null and new.lng is not null then
        select a.id into new.area_id
          from public.event_areas a
         where a.enabled
           and new.lat between a.min_lat and a.max_lat
           and new.lng between a.min_lng and a.max_lng
         order by a.priorite, a.id
         limit 1;
      end if;

      -- La commune, et la seule correction qu'on s'autorise sur `city`
      select mc.nom, mc.associee into m
        from public.mel_communes mc
       where mc.cle = public.commune_cle(new.city);
      if found then
        new.commune := m.nom;
        if not m.associee then new.city := m.nom; end if;
      else
        new.commune := null;
      end if;

      -- Le plafond : « majeur » exige une raison, pas un total de points
      if new.importance_level = 'major'
         and not public.evenement_est_majeur(new.place_name, new.title, new.announcement_tags) then
        new.importance_level := 'important';
      end if;

      new.updated_at := now();
      return new;
    end;
    $function$;
