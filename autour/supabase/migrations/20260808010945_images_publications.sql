-- ---------------------------------------------------------------------------
-- Images des événements publiés sur Autour
-- Voir autour/supabase/migrations/20260807160000_images_publications.sql
-- ---------------------------------------------------------------------------

alter table public.publications
  add column if not exists image_url text;

comment on column public.publications.image_url is
  'URL publique de l''affiche ou photo de l''événement, stockée dans le bucket « evenements ».';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evenements', 'evenements', true,
  3 * 1024 * 1024,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "evenements: lecture publique" on storage.objects;
create policy "evenements: lecture publique"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'evenements');

drop policy if exists "evenements: déposer dans son dossier" on storage.objects;
create policy "evenements: déposer dans son dossier"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'evenements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "evenements: remplacer les siennes" on storage.objects;
create policy "evenements: remplacer les siennes"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'evenements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "evenements: supprimer les siennes" on storage.objects;
create policy "evenements: supprimer les siennes"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'evenements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

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
  id uuid, auteur uuid, cat text, titre text, adresse text, cp text,
  quand text, gratuit boolean, prix integer, places integer,
  lat double precision, lng double precision,
  debut_le timestamptz, fin_le timestamptz, verifie boolean,
  image_url text, annule boolean
)
language sql
stable
set search_path = public
as $$
  select p.id, p.auteur, p.cat, p.titre, p.adresse, p.cp,
         p.quand, p.gratuit, p.prix, p.places, p.lat, p.lng,
         p.debut_le, p.fin_le, p.verifie, p.image_url, p.annule
  from public.publications p
  where p.lat between p_sud and p_nord
    and p.lng between p_ouest and p_est
    and (p.fin_le is null or p.fin_le > now())
  order by p.cree_le desc
  limit least(greatest(p_limite, 1), 300);
$$;

revoke all on function public.publications_proches(
  double precision, double precision, double precision, double precision, integer
) from public;

grant execute on function public.publications_proches(
  double precision, double precision, double precision, double precision, integer
) to anon, authenticated;
