-- La fonction de quota doit contourner la lecture RLS pour compter de façon
-- fiable, mais elle n'a aucune raison d'être une RPC exposée par PostgREST.
-- On la déplace donc hors du schéma public.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.publications_recentes()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.publications
   where creator_id = (select auth.uid())
     and cree_le > now() - interval '24 hours';
$$;

revoke all on function private.publications_recentes() from public, anon;
grant execute on function private.publications_recentes() to authenticated;

drop policy if exists "publications: créer sous son uid" on public.publications;
create policy "publications: créer sous son uid"
  on public.publications for insert
  to authenticated
  with check (
    creator_id = (select auth.uid())
    and creator_name is not null
    and char_length(btrim(creator_name)) between 1 and 50
    and status = 'active'
    and verifie is false
    and private.publications_recentes() < 10
  );

drop function if exists public.publications_recentes();
