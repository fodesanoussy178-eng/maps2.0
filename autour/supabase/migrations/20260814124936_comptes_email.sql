create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.compte_confirme()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
     where u.id = (select auth.uid())
       and coalesce(u.is_anonymous, false) is false
       and u.email is not null
       and u.email_confirmed_at is not null
  );
$$;

comment on function private.compte_confirme() is
  'Vrai uniquement pour une session portant une adresse e-mail confirmee. Une session anonyme rend faux : elle peut lire, jamais ecrire.';

revoke all on function private.compte_confirme() from public, anon;
grant execute on function private.compte_confirme() to authenticated;

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  notifications boolean not null default true,
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now()
);

alter table public.profiles
  drop constraint if exists profiles_display_name_check;
alter table public.profiles
  add constraint profiles_display_name_check
    check (display_name is null or char_length(btrim(display_name)) between 1 and 30);

comment on table public.profiles is
  'Ce qu''une personne accepte de montrer : un pseudo facultatif. Aucune adresse e-mail ici, ni dans aucune autre table publique.';
comment on column public.profiles.display_name is
  'Pseudo public facultatif et modifiable. Ne participe JAMAIS a l''autorisation : la propriete est portee par auth.uid().';
comment on column public.profiles.notifications is
  'Preference de notifications. Privee : la ligne n''est lisible que par son proprietaire.';

create or replace function private.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.creer_profil() from public, anon, authenticated;

drop trigger if exists creer_profil_a_l_inscription on auth.users;
create trigger creer_profil_a_l_inscription
  after insert on auth.users
  for each row execute function private.creer_profil();

insert into public.profiles (id)
select u.id from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null;

create or replace function private.horodater_profil()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  new.id := old.id;
  return new;
end;
$$;

revoke all on function private.horodater_profil() from public, anon, authenticated;

drop trigger if exists profiles_horodater on public.profiles;
create trigger profiles_horodater
  before update on public.profiles
  for each row execute function private.horodater_profil();

create or replace function private.propager_pseudo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is distinct from old.display_name then
    update public.publications
       set creator_name = new.display_name
     where created_by = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.propager_pseudo() from public, anon, authenticated;

drop trigger if exists profiles_propager_pseudo on public.profiles;
create trigger profiles_propager_pseudo
  after update on public.profiles
  for each row execute function private.propager_pseudo();

alter table public.profiles enable row level security;

drop policy if exists "profiles: lire le sien" on public.profiles;
create policy "profiles: lire le sien"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles: creer le sien" on public.profiles;
create policy "profiles: creer le sien"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "profiles: modifier le sien" on public.profiles;
create policy "profiles: modifier le sien"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select, insert, update (display_name, notifications) on public.profiles to authenticated;

alter table public.publications
  drop constraint if exists publications_creator_name_check;
alter table public.publications
  add constraint publications_creator_name_check
    check (creator_name is null or char_length(btrim(creator_name)) between 1 and 50);

drop policy if exists "publications: créer sous son uid" on public.publications;
create policy "publications: créer sous son uid"
  on public.publications for insert
  to authenticated
  with check (
    (select private.compte_confirme())
    and creator_id = (select auth.uid())
    and created_by = (select auth.uid())
    and status = 'active'
    and verifie is false
    and private.publications_recentes() < 10
  );

drop policy if exists "publications: modifier les siennes" on public.publications;
create policy "publications: modifier les siennes"
  on public.publications for update
  to authenticated
  using (
    (select private.compte_confirme())
    and created_by = (select auth.uid())
  )
  with check (
    (select private.compte_confirme())
    and created_by = (select auth.uid())
    and creator_id = created_by
    and verifie is false
  );

drop policy if exists "publications: supprimer les siennes" on public.publications;
create policy "publications: supprimer les siennes"
  on public.publications for delete
  to authenticated
  using (
    (select private.compte_confirme())
    and created_by = (select auth.uid())
  );

drop policy if exists "publications: lecture publique" on public.publications;
create policy "publications: lecture publique"
  on public.publications for select
  to anon, authenticated
  using (true);

revoke all on public.publications from anon, authenticated;
grant select on public.publications to anon, authenticated;
grant insert, update, delete on public.publications to authenticated;

drop policy if exists "favoris: lire les siens" on public.favoris;
create policy "favoris: lire les siens"
  on public.favoris for select to authenticated
  using (membre = (select auth.uid()));

drop policy if exists "favoris: enregistrer sous sa propre identité" on public.favoris;
create policy "favoris: enregistrer sous sa propre identité"
  on public.favoris for insert to authenticated
  with check (
    (select private.compte_confirme())
    and membre = (select auth.uid())
  );

drop policy if exists "favoris: retirer les siens" on public.favoris;
create policy "favoris: retirer les siens"
  on public.favoris for delete to authenticated
  using (
    (select private.compte_confirme())
    and membre = (select auth.uid())
  );

revoke all on public.favoris from anon;
grant select, insert, delete on public.favoris to authenticated;

drop function if exists public.mes_publications();

create function public.mes_publications()
returns table(
  id uuid, cat text, titre text, adresse text, cp text,
  quand text, gratuit boolean, prix integer, places integer,
  lat double precision, lng double precision,
  debut_le timestamptz, fin_le timestamptz, verifie boolean,
  image_url text, status text, annule boolean,
  creator_id uuid, created_by uuid, creator_name text,
  cree_le timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.cat, p.titre, p.adresse, p.cp,
         p.quand, p.gratuit, p.prix, p.places, p.lat, p.lng,
         p.debut_le, p.fin_le, p.verifie, p.image_url, p.status, p.annule,
         p.creator_id, p.created_by, p.creator_name, p.cree_le
    from public.publications p
   where p.created_by = (select auth.uid())
   order by p.cree_le desc
   limit 200;
$$;

revoke all on function public.mes_publications() from public, anon;
grant execute on function public.mes_publications() to authenticated;

do $$
declare
  fautif text;
begin
  select string_agg(c.relname || '.' || a.attname, ', ')
    into fautif
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'v', 'm', 'p')
     and a.attnum > 0
     and not a.attisdropped
     and a.attname ~* '(^|_)(e?mail|courriel)($|_)';

  if fautif is not null then
    raise exception 'Une adresse e-mail est exposee dans le schema public : %', fautif;
  end if;
end
$$;
