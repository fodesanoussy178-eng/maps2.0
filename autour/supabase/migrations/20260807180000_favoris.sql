-- ---------------------------------------------------------------------------
-- Favoris
--
-- Un favori vise soit un événement publié sur Autour (publications.id), soit
-- un lieu externe venu d'OpenStreetMap ou de Google. Ces derniers ne sont pas
-- dans notre base : on garde donc une référence stable ET un instantané du
-- minimum nécessaire (titre, catégorie, position). Sans cet instantané, la
-- liste des favoris serait vide tant que le lieu n'a pas été rechargé depuis
-- sa source — ce qui est précisément le cas quand on ouvre l'onglet Favoris
-- ailleurs qu'à l'endroit où on l'a enregistré.
--
-- L'application signe ses visiteurs en anonyme : auth.uid() existe donc sans
-- création de compte, et les favoris sont liés à cette identité.
-- ---------------------------------------------------------------------------

create table if not exists public.favoris (
  id             bigint generated always as identity primary key,
  membre         uuid not null default auth.uid(),

  -- exactement l'une des deux cibles
  publication_id uuid references public.publications (id) on delete cascade,
  lieu_ref       text,

  -- instantané, pour pouvoir afficher un favori hors de sa zone de chargement
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

-- un même élément ne peut être mis en favori deux fois par la même personne
create unique index if not exists favoris_publication_unique
  on public.favoris (membre, publication_id) where publication_id is not null;
create unique index if not exists favoris_lieu_unique
  on public.favoris (membre, lieu_ref) where lieu_ref is not null;
create index if not exists favoris_membre_idx on public.favoris (membre, cree_le desc);

-- ---------------------------------------------------------------------------
-- RLS : un favori ne regarde que celui qui l'a posé. Aucune lecture publique —
-- ce que quelqu'un enregistre ne concerne personne d'autre.
-- ---------------------------------------------------------------------------
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

-- pas de policy UPDATE : un favori se pose ou se retire, il ne se modifie pas

revoke all on public.favoris from anon;
grant select, insert, delete on public.favoris to authenticated;
