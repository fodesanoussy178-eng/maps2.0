-- Deux corrections à la règle « majeur », trouvées en la regardant tourner.
--
-- 1. « Brocante vélos spéciale "Braderie de Lille" » n'est pas la Braderie.
--    Un `like '%braderie de lille%'` attrapait tout ce qui la MENTIONNE. Le
--    motif doit désormais ouvrir le titre, article défini toléré.
--
-- 2. « Programmation », « Un clic, un billet, une soirée inoubliable. »,
--    « Partenaires », « Exposants », « Comment se rendre au Festival ? » :
--    ce sont des pages de site prises pour des événements par le connecteur
--    `sync-lille-official`. Elles se tiennent au Zénith ou au Grand Palais,
--    donc la règle de jauge les promouvait. Un lieu prestigieux ne rend pas
--    un menu de navigation métropolitain.
--
-- On NE LES SUPPRIME PAS ici : effacer des lignes de production est une
-- décision qui se prend en connaissance de cause, et le compte figure au
-- rapport. On refuse seulement qu'elles montent.

create or replace function public.titre_non_evenement(p_titre text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select public.event_texte_normalise(p_titre) ~
    ('^(partenaires|exposants|poles?|programmation|programme|calendar|calendrier'
     || '|infos? pratiques?|comment se rendre|acces|contact|billetterie|tarifs?'
     || '|equipe|l equipe|jeu concours|newsletter|mentions legales|plan du site'
     || '|inscription|faq|presse|boutique|accueil|home|agenda)( |$)')
    or public.event_texte_normalise(p_titre) ~ '^(un clic un billet)';
$$;

comment on function public.titre_non_evenement(text) is
  'Vrai quand le titre est une page de site aspirée par un connecteur, pas un événement : « Partenaires », « Programmation », « Comment se rendre… ».';

create or replace function public.evenement_est_majeur(
  p_place_name text, p_title text, p_tags text[]
) returns boolean
language sql
stable
set search_path to 'public'
as $$
  select case when public.titre_non_evenement(p_title) then false else
    exists (
      select 1 from public.lieux_majeurs l
       where l.cle = public.commune_cle(p_place_name)
    )
    or exists (
      select 1 from public.evenements_majeurs e
       where public.event_texte_normalise(p_title) ~ ('^(la |le |les |l )?' || e.motif_titre || '( |$)')
    )
    or coalesce(p_tags, '{}'::text[]) && array['losc']
  end;
$$;
