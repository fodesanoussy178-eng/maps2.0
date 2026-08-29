-- « Majeur » était un artefact de source, pas un jugement.
--
-- CE QU'ON A MESURÉ. 84 événements futurs portaient `major`, 81 à Lille. Le
-- score vient de `calculerImportance` : une base par source — venue_official
-- 58, organizer_official 56 — plus des bonus de tags, billetterie, artistes.
-- Un concert de 400 places au Flow arrivait à 99, exactement comme M Pokora
-- au Zénith. Pire, `fusionnerAnnonceFields` réinjecte le score déjà stocké
-- comme signal de source à chaque resynchronisation : le score CLIQUETAIT
-- vers le haut sans que rien n'ait changé dans le monde.
--
-- Et parmi ces « majeurs » : « Partenaires », « Exposants », « Pôles »,
-- « Comment se rendre au Festival ? », « Calendar - Lille Grand Palais ».
-- Ce sont des pages de navigation qu'un connecteur a prises pour des
-- événements. Aucun seuil numérique ne pouvait les écarter.
--
-- CE QUI DÉCIDE MAINTENANT. Une raison nommable, pas un total. Un événement
-- est majeur s'il se tient dans un lieu dont la jauge fait de lui un
-- événement métropolitain, ou s'il est l'un des rendez-vous que la métropole
-- entière connaît. Rien d'autre. Le reste plafonne à `important`, qui peut
-- rester fréquent — c'est ce que « Pour toi » sait déjà classer.
--
-- Les deux listes sont des tables, pas des constantes : ajouter un lieu ou
-- un rendez-vous est un INSERT, pas un déploiement.

create table if not exists public.lieux_majeurs (
  cle   text primary key,
  nom   text not null,
  jauge integer,
  motif text not null
);

comment on table public.lieux_majeurs is
  'Lieux dont la jauge fait qu''un événement qui s''y tient concerne toute la métropole. Clé normalisée par public.commune_cle.';

insert into public.lieux_majeurs (cle, nom, jauge, motif) values
  (public.commune_cle('Zénith de Lille'), 'Zénith de Lille', 7000, 'salle de tête d''affiche nationale'),
  (public.commune_cle('Stade Pierre-Mauroy'), 'Stade Pierre-Mauroy', 50000, 'stade du LOSC, grands concerts et grands matchs'),
  (public.commune_cle('Decathlon Arena'), 'Decathlon Arena — Stade Pierre-Mauroy', 50000, 'nom commercial du Stade Pierre-Mauroy'),
  (public.commune_cle('Stadium Lille Métropole'), 'Stadium Lille Métropole', 18000, 'athlétisme et grands rassemblements')
on conflict (cle) do update set nom = excluded.nom, jauge = excluded.jauge, motif = excluded.motif;

create table if not exists public.evenements_majeurs (
  motif_titre text primary key,
  nom         text not null,
  motif       text not null
);

comment on table public.evenements_majeurs is
  'Rendez-vous métropolitains reconnus par leur titre normalisé (public.event_texte_normalise). Un événement qui les porte est majeur quel que soit son lieu.';

insert into public.evenements_majeurs (motif_titre, nom, motif) values
  ('braderie de lille',        'Braderie de Lille',                    'le plus grand rassemblement de la métropole'),
  ('lille3000',                'lille3000',                            'saison culturelle métropolitaine'),
  ('series mania',             'Séries Mania',                         'festival international, audience nationale'),
  ('geek days',                'Geek Days',                            'grande convention métropolitaine'),
  ('foire internationale de lille', 'Foire internationale de Lille',   'grand salon métropolitain'),
  ('international lille tattoo convention', 'International Lille Tattoo Convention', 'convention à rayonnement national'),
  ('tour de france',           'Tour de France',                       'événement national de passage')
on conflict (motif_titre) do update set nom = excluded.nom, motif = excluded.motif;

-- La règle, en un seul endroit, lisible et interrogeable.
create or replace function public.evenement_est_majeur(
  p_place_name text, p_title text, p_tags text[]
) returns boolean
language sql
stable
set search_path to 'public'
as $$
  select
    exists (
      select 1 from public.lieux_majeurs l
       where l.cle = public.commune_cle(p_place_name)
    )
    or exists (
      select 1 from public.evenements_majeurs e
       where public.event_texte_normalise(p_title) like '%' || e.motif_titre || '%'
    )
    -- un match du LOSC est un événement métropolitain, où qu'il soit joué
    or coalesce(p_tags, '{}'::text[]) && array['losc'];
$$;

comment on function public.evenement_est_majeur(text, text, text[]) is
  'Vrai quand une raison nommable — la jauge du lieu, un rendez-vous métropolitain, un match du LOSC — justifie le niveau « major ».';
