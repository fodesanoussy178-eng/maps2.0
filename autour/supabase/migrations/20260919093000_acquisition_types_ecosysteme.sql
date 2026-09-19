-- ---------------------------------------------------------------------------
-- TROIS TYPES DE PLUS, ET POURQUOI ILS NE SE CONFONDENT PAS AVEC LES AUTRES
--
-- `incubateur`, `coworking`, `reseau_entrepreneurial` ne sont pas des lieux
-- culturels avec un autre nom. Ils diffèrent par le MÉCANISME qui les relie à
-- Autour : un théâtre apporte du contenu (ses spectacles), un incubateur
-- apporte au mieux de la diffusion (sa communauté). Les mélanger ferait
-- remonter des incubateurs en « pertinence élevée » parce que la règle des
-- lieux culturels s'y appliquerait — exactement ce que le §8 interdit.
--
-- La qualification les traite donc à part, et leur phrase dit toujours si le
-- lien est observé ou supposé.
-- ---------------------------------------------------------------------------

alter table public.acquisition_opportunites
  drop constraint if exists acquisition_opportunites_type_check;

alter table public.acquisition_opportunites
  add constraint acquisition_opportunites_type_check
  check (type in ('association','commerce','lieu_culturel','organisateur','club',
                  'etablissement_etudiant','communaute_locale','acteur_jeunesse',
                  'lieu_de_sortie','acteur_evenementiel','collectivite','media_local',
                  'creche_tiers_lieu','structure',
                  -- l'écosystème entrepreneurial : un autre mécanisme, d'autres règles
                  'incubateur','coworking','reseau_entrepreneurial'));
