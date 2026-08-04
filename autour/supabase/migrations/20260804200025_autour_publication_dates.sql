alter table public.publications
  add column if not exists debut_le timestamptz;

comment on column public.publications.debut_le is
  'Début réel de la publication temporaire, utilisé par le filtre Maintenant.';

drop function if exists public.publications_proches(
  double precision,
  double precision,
  double precision,
  double precision,
  integer
);

create function public.publications_proches(
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 120
)
returns table(
  id uuid,
  auteur uuid,
  cat text,
  titre text,
  adresse text,
  cp text,
  quand text,
  gratuit boolean,
  prix integer,
  places integer,
  lat double precision,
  lng double precision,
  debut_le timestamptz,
  fin_le timestamptz,
  verifie boolean
)
language sql
stable
set search_path = public
as $$
  select p.id, p.auteur, p.cat, p.titre, p.adresse, p.cp,
         p.quand, p.gratuit, p.prix, p.places, p.lat, p.lng,
         p.debut_le, p.fin_le, p.verifie
  from public.publications p
  where p.lat between p_sud and p_nord
    and p.lng between p_ouest and p_est
    and (p.fin_le is null or p.fin_le > now())
  order by p.cree_le desc
  limit least(greatest(p_limite, 1), 300);
$$;

revoke all on function public.publications_proches(
  double precision,
  double precision,
  double precision,
  double precision,
  integer
) from public;

grant execute on function public.publications_proches(
  double precision,
  double precision,
  double precision,
  double precision,
  integer
) to anon, authenticated;
