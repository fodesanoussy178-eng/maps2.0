-- ---------------------------------------------------------------------------
-- Comptes Autour : un e-mail, rien d'autre
--
-- CE QUI CHANGE, ET POURQUOI
--
-- Autour signait ses visiteurs en anonyme. C'était juste pour l'usage — on
-- n'a pas à créer un compte pour regarder ce qui se passe dans sa rue — mais
-- ça rendait la propriété inreprenable : une session anonyme vit dans le
-- stockage d'un navigateur. Vider son cache, changer de téléphone, et ses
-- propres publications devenaient celles d'un inconnu. Personne ne pouvait
-- plus les modifier, pas même leur auteur.
--
-- Un compte devient donc nécessaire pour ce qui doit SURVIVRE à l'appareil :
-- publier, modifier, supprimer, mettre en favori. Et pour rien d'autre.
-- Explorer, chercher, lire une publication et demander de l'aide — y compris
-- une urgence — restent accessibles sans rien donner. C'est une règle de
-- produit, mais elle s'écrit ici parce qu'une règle qui ne vit que dans le
-- JavaScript n'est pas une règle : c'est une suggestion. `anon` n'a aucun
-- droit d'écriture, et une session anonyme ne suffit plus.
--
-- CE QUI NE CHANGE PAS
--
-- `created_by` reste le propriétaire canonique, et reste `auth.uid()`.
-- Rattacher un e-mail à une session anonyme (`updateUser({ email })`) CONSERVE
-- l'uid : les 195 sessions existantes et l'unique publication déjà en base
-- retrouvent donc leur auteur au moment où il confirme son adresse. Aucune
-- ligne n'est réécrite, aucune propriété n'est transférée.
--
-- L'ADRESSE E-MAIL
--
-- Elle n'est copiée nulle part. Elle vit dans `auth.users`, qui n'est lisible
-- ni par `anon` ni par `authenticated`. `public.profiles` ne porte QUE ce qui
-- est destiné à être vu : un pseudo facultatif. Il n'existe volontairement
-- aucune colonne, aucune vue et aucune fonction qui rende une adresse — un
-- test le vérifie plutôt que de le supposer.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. « Cette session est-elle un vrai compte ? »
--
-- On ne lit pas le claim `is_anonymous` du JWT : sa présence dépend de la
-- version du SDK qui a émis le jeton, et une règle d'autorisation ne doit pas
-- dépendre de ce que le client a bien voulu mettre dans son jeton. On demande
-- à `auth.users`, qui est la seule autorité. SECURITY DEFINER parce que
-- `authenticated` ne lit pas ce schéma — et c'est très bien ainsi.
-- ---------------------------------------------------------------------------
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
  'Vrai uniquement pour une session portant une adresse e-mail confirmée. Une session anonyme rend faux : elle peut lire, jamais écrire.';

revoke all on function private.compte_confirme() from public, anon;
grant execute on function private.compte_confirme() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le profil public : un pseudo, facultatif, modifiable
--
-- Pas de nom, pas de prénom, pas d'âge, pas de téléphone, pas d'adresse. Ce
-- qu'on ne demande pas ne peut pas fuir. `notifications` est une préférence,
-- pas une donnée publique : elle vit dans la même ligne mais la ligne entière
-- n'est lisible que par son propriétaire.
-- ---------------------------------------------------------------------------
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
  'Pseudo public facultatif et modifiable. Ne participe JAMAIS à l''autorisation : la propriété est portée par auth.uid().';
comment on column public.profiles.notifications is
  'Préférence de notifications. Privée : la ligne n''est lisible que par son propriétaire.';

-- Un profil naît avec le compte. Sans ça, la première écriture du client
-- devrait créer sa propre ligne, et « pas de profil » deviendrait un état
-- que chaque écran devrait savoir gérer.
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

-- Les comptes déjà là — anonymes pour l'instant — ont eux aussi leur ligne :
-- elle sera prête le jour où ils rattachent une adresse.
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
  new.id := old.id;                      -- un profil ne change pas de personne
  return new;
end;
$$;

revoke all on function private.horodater_profil() from public, anon, authenticated;

drop trigger if exists profiles_horodater on public.profiles;
create trigger profiles_horodater
  before update on public.profiles
  for each row execute function private.horodater_profil();

-- Changer de pseudo doit se voir partout, sinon l'ancien nom reste affiché sur
-- ses propres publications et deux identités coexistent pour une seule
-- personne. On ne propage QUE vers ses propres lignes.
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

-- RLS : sa propre ligne, et rien d'autre. Le pseudo destiné au public voyage
-- déjà avec la publication (`creator_name`) ; ouvrir la table en lecture
-- exposerait en prime la préférence de notifications de tout le monde.
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

-- pas de policy DELETE : un profil disparaît avec son compte, pas autrement

revoke all on public.profiles from anon, authenticated;
grant select, insert, update (display_name, notifications) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Publier, modifier, supprimer : un compte, pas une session
--
-- Les policies gardent exactement la même forme de propriété — `created_by =
-- auth.uid()` — et y ajoutent la seule condition nouvelle : le compte doit
-- être confirmé. Un compte A ne peut pas plus toucher aux lignes d'un compte B
-- qu'avant ; ce qui change, c'est qu'une session anonyme ne peut plus rien
-- écrire du tout.
--
-- `creator_name` devient facultatif : le pseudo est facultatif, donc exiger
-- un nom pour publier reviendrait à le rendre obligatoire par la bande.
-- ---------------------------------------------------------------------------
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

-- La lecture reste ouverte à tous, connectés ou non : c'est tout l'objet
-- d'Autour. Elle est réaffirmée ici pour que ce fichier se lise seul.
drop policy if exists "publications: lecture publique" on public.publications;
create policy "publications: lecture publique"
  on public.publications for select
  to anon, authenticated
  using (true);

revoke all on public.publications from anon, authenticated;
grant select on public.publications to anon, authenticated;
grant insert, update, delete on public.publications to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Favoris : même règle
--
-- Un favori n'a de sens que s'il se retrouve ailleurs que sur l'appareil où on
-- l'a posé. C'est précisément ce qu'un compte apporte, et ce qu'une session
-- anonyme ne peut pas promettre.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. « Mes publications »
--
-- Retrouver ce qu'on a publié est l'une des deux raisons d'avoir un compte.
-- Une RPC plutôt qu'un select côté client : la clause de propriété est écrite
-- une fois, en base, et ne peut pas être oubliée par un appelant.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. Le garde-fou qu'on n'a pas envie d'écrire, et qu'il faut écrire
--
-- Aucun objet du schéma public ne doit rendre une adresse e-mail. Si quelqu'un
-- ajoute demain une vue de confort qui joint `auth.users`, la migration
-- suivante échouera ici plutôt qu'en production.
-- ---------------------------------------------------------------------------
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
    raise exception 'Une adresse e-mail est exposée dans le schéma public : %', fautif;
  end if;
end
$$;
