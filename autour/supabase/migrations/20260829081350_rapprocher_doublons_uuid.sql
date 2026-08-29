-- Postgres n'agrège pas les uuid : `min(uuid)` n'existe pas. L'étiquette de
-- groupe passe donc par le texte, ce qui suffit — on ne cherche qu'un
-- représentant stable, pas un ordre qui signifie quelque chose.

create or replace function public.rapprocher_doublons(p_depuis timestamptz default now())
returns table(rapproches integer, groupes integer)
language plpgsql
set search_path to 'public', 'topology'
as $$
declare
  v_rapproches integer := 0;
  v_groupes integer := 0;
begin
  with candidats as (
    select id, public.titre_noyau(title) noyau,
           to_char(start_at at time zone 'Europe/Paris', 'YYYYMMDD') jour,
           start_at, date_confidence, lat, lng, created_at,
           case primary_source
             when 'artist_official' then 100 when 'venue_official' then 95
             when 'organizer_official' then 95 when 'institutional' then 90
             when 'openagenda' then 80 when 'datatourisme' then 75 else 10
           end priorite
    from public.events
    where start_at > p_depuis and lat is not null and lng is not null
      and public.titre_noyau(title) <> ''
      and not public.titre_non_evenement(title)
      and public.event_texte_normalise(title) not in ('evenement sans titre', 'sans titre')
  ),
  paires as (
    select a.id ida, b.id idb
    from candidats a join candidats b
      on a.noyau = b.noyau and a.jour = b.jour and a.id < b.id
    where ST_DWithin(
            ST_SetSRID(ST_MakePoint(a.lng, a.lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography, 200)
      and (a.date_confidence = 'day' or b.date_confidence = 'day'
           or abs(extract(epoch from (a.start_at - b.start_at))) <= 900)
  ),
  groupes as (
    select ida, idb from paires
    union all
    select idb, ida from paires
  ),
  etiquettes as (
    select ida id, least(ida::text, min(idb::text))::uuid etiquette
    from groupes group by ida
  ),
  canoniques as (
    select e.etiquette,
      (select c.id from candidats c
        join etiquettes e2 on e2.id = c.id and e2.etiquette = e.etiquette
        order by (c.date_confidence = 'exact') desc, c.priorite desc, c.created_at asc
        limit 1) canonique
    from etiquettes e group by e.etiquette
  ),
  ecriture as (
    update public.events ev
       set duplicate_of = c.canonique
      from etiquettes e join canoniques c on c.etiquette = e.etiquette
     where ev.id = e.id and ev.id <> c.canonique
       and ev.duplicate_of is distinct from c.canonique
    returning ev.id
  )
  select count(*)::integer into v_rapproches from ecriture;

  select count(distinct duplicate_of)::integer into v_groupes
    from public.events where duplicate_of is not null and start_at > p_depuis;

  return query select v_rapproches, v_groupes;
end;
$$;
