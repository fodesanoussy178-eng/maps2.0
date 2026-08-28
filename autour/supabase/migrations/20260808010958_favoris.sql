-- ---------------------------------------------------------------------------
-- Favoris
-- Voir autour/supabase/migrations/20260807180000_favoris.sql
-- ---------------------------------------------------------------------------

create table if not exists public.favoris (
  id             bigint generated always as identity primary key,
  membre         uuid not null default auth.uid(),

  publication_id uuid references public.publications (id) on delete cascade,
  lieu_ref       text,

  titre          text not null,
  cat            text,
  adresse        text,
  lat            double precision,
  lng            double precision,

  cree_le        timestamptz not null default now(),

  constraint favoris_une_cible check (
    (publication_id is not null and lieu_ref is null) or
    (publication_id is null and lieu_ref is not null)
  )
);

comment on table public.favoris is
  'Favoris d''un visiteur (identité anonyme). Vise un événement Autour ou un lieu externe, avec instantané du strict nécessaire pour l''afficher.';
comment on column public.favoris.lieu_ref is
  'Référence stable d''un lieu externe, de la forme « source:identifiant ».';

create unique index if not exists favoris_publication_unique
  on public.favoris (membre, publication_id) where publication_id is not null;
create unique index if not exists favoris_lieu_unique
  on public.favoris (membre, lieu_ref) where lieu_ref is not null;
create index if not exists favoris_membre_idx on public.favoris (membre, cree_le desc);

alter table public.favoris enable row level security;

drop policy if exists "favoris: lire les siens" on public.favoris;
create policy "favoris: lire les siens"
  on public.favoris for select to authenticated
  using (membre = auth.uid());

drop policy if exists "favoris: enregistrer sous sa propre identité" on public.favoris;
create policy "favoris: enregistrer sous sa propre identité"
  on public.favoris for insert to authenticated
  with check (membre = auth.uid());

drop policy if exists "favoris: retirer les siens" on public.favoris;
create policy "favoris: retirer les siens"
  on public.favoris for delete to authenticated
  using (membre = auth.uid());

revoke all on public.favoris from anon;
grant select, insert, delete on public.favoris to authenticated;
