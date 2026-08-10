-- mes_canaux ne nécessite aucun contournement de RLS : event_participants
-- autorise déjà chacun à lire sa propre participation, et les canaux/messages
-- sont publics en lecture. Exécuter la fonction avec les droits de l'appelant
-- enlève donc une surface SECURITY DEFINER sans changer son résultat.
create or replace function public.mes_canaux()
returns table (
  channel_id uuid,
  publication_id uuid,
  titre text,
  role text,
  annule boolean,
  dernier_message text,
  dernier_le timestamptz,
  non_lus integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, p.id, p.titre, ep.role, p.annule,
         m.corps, m.cree_le,
         (select count(*)::int from public.event_messages x
           where x.channel_id = c.id
             and (ep.lu_jusqua is null or x.cree_le > ep.lu_jusqua))
    from public.event_participants ep
    join public.event_channels c on c.id = ep.channel_id
    join public.publications p on p.id = c.publication_id
    left join lateral (
      select corps, cree_le
        from public.event_messages m2
       where m2.channel_id = c.id
       order by m2.cree_le desc
       limit 1
    ) m on true
   where ep.membre = (select auth.uid())
   order by coalesce(m.cree_le, c.cree_le) desc;
$$;

revoke all on function public.mes_canaux() from public, anon;
grant execute on function public.mes_canaux() to authenticated;
