-- ---------------------------------------------------------------------------
-- Propriété des publications Autour
--
-- Une publication appartient à un uid Supabase, jamais à un prénom ou pseudo.
-- Les anciennes lignes possèdent déjà `auteur`, un uid créé par Auth : on
-- conserve donc cette preuve en renommant la colonne. Si une autre installation
-- possède déjà les deux colonnes, seules les lignes dont `auteur` est connu sont
-- reprises. Une ligne réellement orpheline reste à NULL et ne peut être réclamée
-- par aucun client grâce aux policies ci-dessous.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'publications' and column_name = 'auteur'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'publications' and column_name = 'creator_id'
  ) then
    alter table public.publications rename column auteur to creator_id;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'publications' and column_name = 'creator_id'
  ) then
    alter table public.publications add column creator_id uuid;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'publications' and column_name = 'auteur'
  ) then
    update public.publications
       set creator_id = auteur
     where creator_id is null and auteur is not null;
  end if;
end
$$;

alter table public.publications
  add column if not exists creator_name text,
  add column if not exists status text not null default 'active';

-- La valeur booléenne historique reste synchronisée pendant la transition :
-- les anciens clients peuvent encore lire `annule`, mais `status` fait foi.
update public.publications
   set status = 'cancelled'
 where annule is true and status <> 'cancelled';

alter table public.publications
  alter column creator_id drop not null,
  alter column creator_id set default auth.uid();

alter table public.publications
  drop constraint if exists publications_auteur_fkey,
  drop constraint if exists publications_creator_id_fkey,
  drop constraint if exists publications_creator_name_check,
  drop constraint if exists publications_status_check;

alter table public.publications
  add constraint publications_creator_id_fkey
    foreign key (creator_id) references auth.users (id) on delete set null,
  add constraint publications_creator_name_check
    check (creator_name is null or char_length(btrim(creator_name)) between 1 and 50),
  add constraint publications_status_check
    check (status in ('active', 'cancelled'));

comment on column public.publications.creator_id is
  'Propriétaire immuable de la publication : uid Supabase Auth. NULL signifie publication historique orpheline, jamais réclamable depuis le client.';
comment on column public.publications.creator_name is
  'Prénom ou pseudo d’affichage choisi par le créateur. Ne participe jamais à l’autorisation.';
comment on column public.publications.status is
  'Cycle de vie de la publication : active puis cancelled. Une suppression reste une opération distincte.';

create index if not exists publications_creator_id_idx
  on public.publications (creator_id);

-- L'uid est immuable et une annulation ne peut pas être annulée à son tour.
-- Le booléen historique et le statut canonique sont maintenus ensemble.
create or replace function public.verrouiller_propriete_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.creator_id is distinct from old.creator_id then
    raise exception 'creator_id is immutable' using errcode = '42501';
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

revoke all on function public.verrouiller_propriete_publication()
  from public, anon, authenticated;

drop trigger if exists publications_verrouiller_propriete on public.publications;
create trigger publications_verrouiller_propriete
  before insert or update on public.publications
  for each row execute function public.verrouiller_propriete_publication();

-- Le quota historique continue de s'appliquer, désormais sur creator_id.
create or replace function public.publications_recentes()
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

revoke all on function public.publications_recentes() from public, anon;
grant execute on function public.publications_recentes() to authenticated;

-- Le canal hérite de la même identité forte. Une ligne orpheline historique
-- ne crée pas de canal administrable.
create or replace function public.creer_canal_evenement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nouveau uuid;
begin
  if new.creator_id is null then return new; end if;

  insert into public.event_channels (publication_id, admin)
  values (new.id, new.creator_id)
  on conflict (publication_id) do nothing
  returning id into nouveau;

  if nouveau is not null then
    insert into public.event_participants (channel_id, membre, role)
    values (nouveau, new.creator_id, 'admin')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.creer_canal_evenement()
  from public, anon, authenticated;

-- RLS : lecture publique, création sous son propre uid, et mutations du seul
-- propriétaire. Le pseudo n'apparaît volontairement dans aucune comparaison.
alter table public.publications enable row level security;

drop policy if exists "lecture publique" on public.publications;
drop policy if exists "publier sous sa propre identite" on public.publications;
drop policy if exists "modifier les siennes" on public.publications;
drop policy if exists "supprimer les siennes" on public.publications;
drop policy if exists "publications: lecture publique" on public.publications;
drop policy if exists "publications: créer sous son uid" on public.publications;
drop policy if exists "publications: modifier les siennes" on public.publications;
drop policy if exists "publications: supprimer les siennes" on public.publications;

create policy "publications: lecture publique"
  on public.publications for select
  to anon, authenticated
  using (true);

create policy "publications: créer sous son uid"
  on public.publications for insert
  to authenticated
  with check (
    creator_id = (select auth.uid())
    and creator_name is not null
    and char_length(btrim(creator_name)) between 1 and 50
    and status = 'active'
    and verifie is false
    and public.publications_recentes() < 10
  );

create policy "publications: modifier les siennes"
  on public.publications for update
  to authenticated
  using (creator_id = (select auth.uid()))
  with check (
    creator_id = (select auth.uid())
    and verifie is false
  );

create policy "publications: supprimer les siennes"
  on public.publications for delete
  to authenticated
  using (creator_id = (select auth.uid()));

revoke all on public.publications from anon, authenticated;
grant select on public.publications to anon, authenticated;
grant insert, update, delete on public.publications to authenticated;

-- Lecture géographique : les événements en cours arrivent d'abord, puis les
-- prochains par date de début. Les annulations restent lisibles mais reléguées.
drop function if exists public.publications_proches(
  double precision, double precision, double precision, double precision, integer
);

create function public.publications_proches(
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 120
)
returns table(
  id uuid, creator_id uuid, creator_name text,
  cat text, titre text, adresse text, cp text,
  quand text, gratuit boolean, prix integer, places integer,
  lat double precision, lng double precision,
  debut_le timestamptz, fin_le timestamptz, verifie boolean,
  image_url text, status text, annule boolean
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.creator_id, p.creator_name,
         p.cat, p.titre, p.adresse, p.cp,
         p.quand, p.gratuit, p.prix, p.places, p.lat, p.lng,
         p.debut_le, p.fin_le, p.verifie, p.image_url, p.status, p.annule
    from public.publications p
   where p.lat between p_sud and p_nord
     and p.lng between p_ouest and p_est
     and (p.fin_le is null or p.fin_le > now() or p.status = 'cancelled')
   order by
     case
       when p.status = 'cancelled' then 2
       when p.debut_le <= now() and (p.fin_le is null or p.fin_le > now()) then 0
       else 1
     end,
     case when p.debut_le >= now() then p.debut_le end asc nulls last,
     case when p.debut_le < now() then p.debut_le end desc nulls last,
     p.cree_le desc
   limit least(greatest(p_limite, 1), 300);
$$;

revoke all on function public.publications_proches(
  double precision, double precision, double precision, double precision, integer
) from public;

grant execute on function public.publications_proches(
  double precision, double precision, double precision, double precision, integer
) to anon, authenticated;
