-- ---------------------------------------------------------------------------
-- LES FAITS OBSERVÉS, GARDÉS AVEC L'OPPORTUNITÉ
--
-- POURQUOI CETTE COLONNE N'EST PAS UNE DUPLICATION
--
-- `acquisition_sources.extrait` garde ce qu'UNE source a dit : le titre d'un
-- événement, un code NAF, une date de création. La qualification, elle, ne
-- travaille pas là-dessus : elle travaille sur l'AGRÉGAT — « vingt-deux
-- rendez-vous à venir », « dernière activité il y a trois jours ». Ce nombre
-- n'est écrit nulle part : il se calcule en relisant les 1 800 événements de la
-- zone, et le recalculer à chaque qualification ferait payer ce balayage à
-- chaque fois, pour un résultat qui ne change qu'à la prochaine récolte.
--
-- Il est donc conservé ici, avec la date de sa mesure. Sans cette date, une
-- qualification lue dans six mois raconterait comme actuel un décompte périmé.
-- ---------------------------------------------------------------------------

alter table public.acquisition_opportunites
  add column if not exists faits           jsonb not null default '{}'::jsonb,
  add column if not exists faits_mesures_le timestamptz;

comment on column public.acquisition_opportunites.faits is
  'Agrégats observés (nombre d''événements à venir, dernière activité, code NAF…) sur lesquels la qualification raisonne. Le détail par source reste dans acquisition_sources.extrait.';

comment on column public.acquisition_opportunites.faits_mesures_le is
  'Quand ces agrégats ont été mesurés. Sans elle, un décompte périmé se lirait comme actuel.';


-- ---------------------------------------------------------------------------
-- ET LA VUE DOIT ÊTRE REFAITE, PAS SEULEMENT RAFRAÎCHIE
--
-- `acquisition_vue` fait `select o.*`. Postgres développe cette étoile À LA
-- CRÉATION et fige la liste de colonnes : la vue créée hier ne connaît pas une
-- colonne ajoutée aujourd'hui, et le Control Center lisait `o.faits` comme
-- `undefined` — sans erreur, sans rien afficher. Trouvé en interrogeant la vue.
--
-- `create or replace` ne suffit pas : les nouvelles colonnes s'insèreraient au
-- MILIEU de la liste (après celles d'`o`, avant les critères pivotés), et
-- Postgres ne l'accepte pas. D'où le drop, puis la création à l'identique.
-- ---------------------------------------------------------------------------

drop view if exists public.acquisition_vue;

create view public.acquisition_vue
with (security_invoker = true) as
select
  o.*,
  q.pertinence, q.accessibilite, q.potentiel, q.cout, q.actualite, q.confiance,
  q.evalue_le,
  s.sources_nb,
  s.derniere_collecte,
  c.contacts_en_attente
from public.acquisition_opportunites o
left join lateral (
  select
    max(case when critere = 'pertinence'    then niveau end) as pertinence,
    max(case when critere = 'accessibilite' then niveau end) as accessibilite,
    max(case when critere = 'potentiel'     then niveau end) as potentiel,
    max(case when critere = 'cout'          then niveau end) as cout,
    max(case when critere = 'actualite'     then niveau end) as actualite,
    max(case when critere = 'confiance'     then niveau end) as confiance,
    max(evalue_le)                                           as evalue_le
  from public.acquisition_qualifications qq
  where qq.opportunite_id = o.id
) q on true
left join lateral (
  select count(*)::int as sources_nb, max(collecte_le) as derniere_collecte
  from public.acquisition_sources ss where ss.opportunite_id = o.id
) s on true
left join lateral (
  select count(*)::int as contacts_en_attente
  from public.acquisition_contacts cc
  where cc.opportunite_id = o.id and cc.statut = 'attente_validation'
) c on true;

comment on view public.acquisition_vue is
  'Les opportunités avec leurs six critères en colonnes, pour la liste et ses filtres. security_invoker : la RLS des tables sous-jacentes s''applique.';

revoke all privileges on public.acquisition_vue from anon, authenticated;
grant select on public.acquisition_vue to authenticated;
