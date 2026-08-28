create table public.publications (
  id          uuid primary key default gen_random_uuid(),
  auteur      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cat         text not null check (char_length(cat) between 2 and 24),
  titre       text not null check (char_length(titre) between 2 and 80),
  adresse     text check (char_length(adresse) <= 160),
  cp          text check (char_length(cp) <= 80),
  quand       text check (char_length(quand) <= 80),
  gratuit     boolean not null default true,
  prix        int not null default 0 check (prix between 0 and 999),
  places      int check (places between 1 and 9999),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  fin_le      timestamptz,
  -- posé uniquement en base : personne ne peut se déclarer vérifié soi-même
  verifie     boolean not null default false,
  signalements int not null default 0,
  cree_le     timestamptz not null default now()
);

comment on column public.publications.verifie is
  'Association ou structure confirmée. Une annonce d''aide non vérifiée doit être affichée comme telle.';

create index publications_position on public.publications (lat, lng);
create index publications_fin on public.publications (fin_le);

-- Comptage isolé des règles de sécurité, sinon la politique d'insertion
-- s'appellerait elle-même en relisant la table.
create or replace function public.publications_recentes(uid uuid)
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int from public.publications
  where auteur = uid and cree_le > now() - interval '24 hours';
$$;

alter table public.publications enable row level security;

-- Lire ne demande rien : consulter la carte doit rester sans condition.
create policy "lecture publique" on public.publications
  for select to anon, authenticated
  using (fin_le is null or fin_le > now());

-- Publier demande une identité, même anonyme, et reste plafonné.
create policy "publier sous sa propre identite" on public.publications
  for insert to authenticated
  with check (
    auteur = auth.uid()
    and verifie = false
    and public.publications_recentes(auth.uid()) < 10
  );

create policy "modifier les siennes" on public.publications
  for update to authenticated
  using (auteur = auth.uid())
  with check (auteur = auth.uid() and verifie = false);

create policy "supprimer les siennes" on public.publications
  for delete to authenticated
  using (auteur = auth.uid());
