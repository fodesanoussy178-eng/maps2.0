-- ---------------------------------------------------------------------------
-- created_by : propriétaire canonique des publications Autour
--
-- `creator_id` reste présent pour la compatibilité des clients/RPC existants.
-- Les deux colonnes sont synchronisées, mais seule `created_by` pilote les
-- règles RLS. Une publication historique sans identité reste NULL/NULL : elle
-- ne devient jamais la propriété du premier visiteur qui la consulte.
-- ---------------------------------------------------------------------------

alter table public.publications
  add column if not exists created_by uuid;

-- La reprise ne copie que l'identité déjà prouvée par Auth. Aucun auth.uid()
-- n'est utilisé ici : les publications orphelines conservent volontairement
-- leur absence de propriétaire.
update public.publications
   set created_by = creator_id
 where created_by is null
   and creator_id is not null;

alter table public.publications
  alter column created_by set default auth.uid();

alter table public.publications
  drop constraint if exists publications_created_by_fkey,
  drop constraint if exists publications_owner_columns_match;

alter table public.publications
  add constraint publications_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,
  add constraint publications_owner_columns_match
    check (
      (creator_id is null and created_by is null)
      or creator_id = created_by
    );

comment on column public.publications.created_by is
  'Propriétaire canonique et immuable : auth.uid(). NULL/NULL désigne une publication historique orpheline, non réclamable.';

create index if not exists publications_created_by_idx
  on public.publications (created_by);

-- Le déclencheur existant est la deuxième ligne de défense : même en cas
-- d'erreur future dans une policy, une mutation ne peut ni transférer ni
-- désynchroniser la propriété.
create or replace function public.verrouiller_propriete_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.creator_id is distinct from old.creator_id then
    raise exception 'creator_id is immutable' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable' using errcode = '42501';
  end if;

  if new.creator_id is distinct from new.created_by then
    raise exception 'creator identity mismatch' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled publication cannot be reactivated' using errcode = '23514';
  end if;

  if new.status = 'cancelled' or new.annule is true then
    new.status := 'cancelled';
    new.annule := true;
  else
    new.status := 'active';
    new.annule := false;
  end if;
  return new;
end;
$$;

-- RLS : lecture publique. Toute écriture vient d'une session Auth (anonyme ou
-- non) et doit porter exactement son uid dans les deux colonnes d'identité.
alter table public.publications enable row level security;

drop policy if exists "publications: créer sous son uid" on public.publications;
drop policy if exists "publications: modifier les siennes" on public.publications;
drop policy if exists "publications: supprimer les siennes" on public.publications;

create policy "publications: créer sous son uid"
  on public.publications for insert
  to authenticated
  with check (
    creator_id = (select auth.uid())
    and created_by = (select auth.uid())
    and creator_name is not null
    and char_length(btrim(creator_name)) between 1 and 50
    and status = 'active'
    and verifie is false
    and private.publications_recentes() < 10
  );

create policy "publications: modifier les siennes"
  on public.publications for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (
    created_by = (select auth.uid())
    and creator_id = created_by
    and verifie is false
  );

create policy "publications: supprimer les siennes"
  on public.publications for delete
  to authenticated
  using (created_by = (select auth.uid()));

revoke all on public.publications from anon, authenticated;
grant select on public.publications to anon, authenticated;
grant insert, update, delete on public.publications to authenticated;
