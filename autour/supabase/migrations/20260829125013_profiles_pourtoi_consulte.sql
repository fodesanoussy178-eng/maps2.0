-- « Pour toi » : la date de dernière consultation, côté compte.
--
-- La pastille rouge compte ce qui n'a jamais été montré. Tant que cette
-- mémoire ne vit que dans le navigateur, changer de téléphone fait
-- réapparaître tout le catalogue comme « nouveau ». Cette colonne dit, pour
-- un appareil neuf, à partir de quand une annonce est réellement nouvelle.
--
-- Les politiques « profiles: read own » et « profiles: update own »
-- (0003_rls.sql) couvrent déjà cette colonne : rien à ajouter côté RLS.
-- Le frontend fonctionne avec ou sans : il interroge une fois, et si la
-- colonne manque il se tait pour la session et la mémoire locale fait foi.

alter table public.profiles
  add column if not exists pourtoi_consulte_le timestamptz;

comment on column public.profiles.pourtoi_consulte_le is
  'Dernière ouverture du panneau « Pour toi ». Sert à ne pas re-annoncer, sur un appareil neuf, ce que la personne a déjà vu ailleurs.';
