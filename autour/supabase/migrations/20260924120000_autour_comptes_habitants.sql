-- ---------------------------------------------------------------------------
-- COMBIEN D'HABITANTS ? — LA MÉTRIQUE DE LA PHASE DE DÉMARRAGE
--
-- La règle produit : tant qu'Autour a moins de 1 000 habitants inscrits, un
-- événement publié PAR un habitant passe devant ses pairs dans « Maintenant ».
-- Cette règle a besoin d'un nombre, et ce nombre doit être le bon.
--
-- CE QU'ON COMPTE, ET POURQUOI PAS AUTRE CHOSE.
-- `auth.users` porte aujourd'hui 196 lignes, dont 194 sessions ANONYMES : la
-- carte en ouvre une pour tout visiteur, sans qu'il se soit inscrit. Compter
-- ces lignes ferait croire à 196 habitants alors qu'il y en a 2, et
-- désactiverait la priorité de démarrage bien avant l'heure.
--
-- On compte donc les comptes NON anonymes et confirmés — ceux qui ont saisi
-- une adresse et cliqué le lien. C'est la définition la plus proche de
-- « quelqu'un qui est revenu », et c'est celle que la règle vise.
--
-- LA FONCTION NE REND QU'UN NOMBRE. Pas une liste, pas une date, pas un
-- domaine d'adresse : un entier. Elle est lisible par `anon` parce que le
-- client en a besoin pour composer sa vitrine, et un décompte global
-- n'identifie personne.
-- ---------------------------------------------------------------------------
create or replace function public.autour_habitants()
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select count(*)::integer
    from auth.users u
   where coalesce(u.is_anonymous, false) = false
     and u.email_confirmed_at is not null;
$$;

comment on function public.autour_habitants() is
  'Nombre de comptes habitants confirmés (hors sessions anonymes). Sert le seuil de priorité de démarrage de « Maintenant ». Rend un entier, jamais une liste.';

revoke all on function public.autour_habitants() from public;
grant execute on function public.autour_habitants() to anon, authenticated;
