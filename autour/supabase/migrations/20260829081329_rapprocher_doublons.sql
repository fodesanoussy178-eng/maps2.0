-- La déduplication ne rapprochait rien : 2 154 lignes, 2 154 `dedup_key`.
--
-- POURQUOI. `dedup_key` = titre normalisé | lat 3 déc. | lng 3 déc. | heure.
-- Deux sources ne titrent jamais pareil — « Antek » d'un côté, « Antek » de
-- l'autre mais « concert : Zed | Flow - Lille - Centre Eurorégional des
-- Cultures Urbaines » ailleurs — et ne géocodent pas au même mètre. La clé
-- était juste, et parfaitement inopérante.
--
-- CE QUI RAPPROCHE MAINTENANT. Un NOYAU de titre — la partie avant le « | »,
-- débarrassée du préfixe de format (« Concert : », « Exposition - ») et des
-- articles — plus le même jour local, plus 200 mètres, plus l'heure.
--
-- LE DOUTE PROFITE À LA SÉPARATION, comme partout ailleurs ici. « VISITE
-- COMMENTÉE » à 15 h et à 16 h au même musée sont DEUX séances, pas un
-- doublon : l'écart d'heure doit rester sous le quart d'heure. Sauf quand une
-- source ne donne que le jour — `date_confidence = 'day'` —, auquel cas
-- comparer les heures n'a aucun sens : c'est le cas de venue_official, qui
-- publie tout à 02:00 locales faute d'heure réelle.
--
-- LE CANONIQUE EST CELUI QUI SAIT L'HEURE, pas celui qui vient de la source
-- la mieux notée. Prendre venue_official comme référence effacerait l'heure
-- exacte qu'OpenAgenda connaît.

create or replace function public.titre_noyau(p_titre text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select btrim(regexp_replace(
    regexp_replace(
      public.event_texte_normalise(split_part(coalesce(p_titre,''), '|', 1)),
      '^(concert|spectacle|expo|exposition|projection|atelier|visite|conference|seance|film|rencontre|match) *:? *-? *', ''),
    ' (a|au|aux|le|la|les|de|du|des) ', ' ', 'g'));
$$;

comment on function public.titre_noyau(text) is
  'Noyau d''un titre : avant le « | », sans préfixe de format ni articles. Sert au rapprochement de doublons entre sources.';

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
      -- un titre-tiroir ne peut pas servir de preuve d'identité
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
  -- une composante = un événement réel ; on prend le plus petit id du groupe
  -- comme étiquette, puis on élit le canonique à l'intérieur
  groupes as (
    select ida, idb from paires
    union all
    select idb, ida from paires
  ),
  etiquettes as (
    select ida id, least(ida, min(idb)) etiquette
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

comment on function public.rapprocher_doublons(timestamptz) is
  'Rapproche les événements futurs qui décrivent la même chose vue par deux sources et pose duplicate_of sur les non-canoniques.';
