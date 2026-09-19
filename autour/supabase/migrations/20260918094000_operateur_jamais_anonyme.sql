-- ---------------------------------------------------------------------------
-- UNE SESSION ANONYME N'EST PAS UN OPÉRATEUR
--
-- CE QUE L'AUDIT A DIT, ET CE QU'IL VOULAIT DIRE
--
-- Le linter de sécurité signale huit policies du socle agents comme
-- « accessibles aux utilisateurs anonymes ». C'est exact au sens strict : dans
-- Supabase, une session anonyme (`signInAnonymously`) porte le rôle
-- `authenticated`, pas `anon`. Écrire `to authenticated` ne distingue donc pas
-- quelqu'un qui a prouvé une adresse e-mail de quelqu'un qui n'a rien prouvé.
--
-- L'accès n'était pas ouvert pour autant : `est_operateur()` exige une ligne
-- dans `control_operateurs`, et personne n'y met l'uid d'une session anonyme.
-- Mais la protection reposait sur ce que personne ne ferait, pas sur ce que le
-- système refuse. Autour a déjà utilisé des sessions anonymes pour les
-- publications ; ce n'est pas une hypothèse d'école.
--
-- On ferme donc au bon endroit : dans la fonction, une fois, plutôt que dans
-- huit policies qui devraient toutes être modifiées ensemble — et dont une
-- oubliée ne se verrait pas.
-- ---------------------------------------------------------------------------

create or replace function public.est_operateur()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    -- `is_anonymous` est posé par Supabase Auth dans le jeton lui-même : un
    -- client ne peut pas le réécrire sans casser la signature.
    coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
    and exists (
      select 1 from public.control_operateurs o
      where o.user_id = (select auth.uid()) and o.actif
    );
$$;

comment on function public.est_operateur() is
  'Vrai si la session appartient à un opérateur actif du Control Center, et n''est pas une session anonyme. Seule porte d''entrée des policies du socle agents.';

revoke all privileges on function public.est_operateur() from public, anon;
grant execute on function public.est_operateur() to authenticated, service_role;
