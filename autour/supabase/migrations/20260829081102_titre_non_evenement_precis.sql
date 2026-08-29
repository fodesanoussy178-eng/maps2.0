-- Premier jet trop large : « Programme Seniors 2026 » à la Salle Watremez de
-- Roubaix est un vrai rendez-vous, et le motif `^programme` le condamnait.
--
-- Deux régimes, donc. Les mots qui ne sont JAMAIS un titre d'événement quand
-- ils sont seuls — « Partenaires », « Pôles », « FAQ » — se reconnaissent au
-- titre entier. Les tournures qui ne peuvent être qu'une page — « Comment se
-- rendre… », « Mentions légales », « Calendar - … » — se reconnaissent au
-- début. Un titre qui porte un vrai sujet après le mot n'est plus une page.

create or replace function public.titre_non_evenement(p_titre text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  with t as (select public.event_texte_normalise(p_titre) as n)
  select
    (select n from t) ~ ('^(partenaires|exposants|poles|pole|programmation|programme'
      || '|calendrier|calendar|faq|presse|contact|accueil|home|agenda|boutique'
      || '|newsletter|tarifs|tarif|acces|inscription|infos pratiques|infos|equipe'
      || '|billetterie|plan du site|mentions legales)$')
    or (select n from t) ~ ('^(comment se rendre|mentions legales|plan du site'
      || '|calendrier |calendar |l equipe |jeu concours|un clic un billet)');
$$;
