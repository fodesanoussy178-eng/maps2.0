-- Ne renvoie que les colonnes réellement affichées, uniquement dans la zone
-- visible, et écarte en base les événements terminés : filtrer côté navigateur
-- obligeait à télécharger des lignes pour les jeter aussitôt.
create or replace function public.publications_proches(
  p_sud double precision, p_ouest double precision,
  p_nord double precision, p_est double precision,
  p_limite int default 120
)
returns table (
  id uuid, auteur uuid, cat text, titre text, adresse text, cp text,
  quand text, gratuit boolean, prix int, places int,
  lat double precision, lng double precision,
  fin_le timestamptz, verifie boolean
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.auteur, p.cat, p.titre, p.adresse, p.cp,
         p.quand, p.gratuit, p.prix, p.places, p.lat, p.lng,
         p.fin_le, p.verifie
  from public.publications p
  where p.lat between p_sud and p_nord
    and p.lng between p_ouest and p_est
    and (p.fin_le is null or p.fin_le > now())
  order by p.cree_le desc
  limit least(greatest(p_limite, 1), 300);
$$;

-- security invoker : la fonction reste soumise aux règles de la table, donc
-- personne ne voit par ce biais ce qu'il ne pourrait pas lire directement.
grant execute on function public.publications_proches(
  double precision, double precision, double precision, double precision, int
) to anon, authenticated;

-- l'index existant portait sur (lat, lng) ; celui-ci sert le tri par date
create index if not exists publications_cree_le on public.publications (cree_le desc);
