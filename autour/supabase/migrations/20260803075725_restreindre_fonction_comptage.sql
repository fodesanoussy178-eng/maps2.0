-- La fonction ne prend plus d'identifiant : elle ne peut renseigner que sur
-- l'appelant lui-même, et non sur l'activité d'un autre compte.
drop policy "publier sous sa propre identite" on public.publications;
drop function if exists public.publications_recentes(uuid);

create or replace function public.publications_recentes()
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int from public.publications
  where auteur = auth.uid() and cree_le > now() - interval '24 hours';
$$;

revoke all on function public.publications_recentes() from public, anon;
grant execute on function public.publications_recentes() to authenticated;

create policy "publier sous sa propre identite" on public.publications
  for insert to authenticated
  with check (
    auteur = auth.uid()
    and verifie = false
    and public.publications_recentes() < 10
  );
