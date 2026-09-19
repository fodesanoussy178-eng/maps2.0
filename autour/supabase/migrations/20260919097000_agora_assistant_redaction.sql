-- L'ASSISTANT DE RÉDACTION — ET LA LIGNE QU'IL NE FRANCHIT PAS NON PLUS.
--
-- Le fondateur demande quelqu'un à qui parler : « rends ce message plus
-- humain », « récapitule mes objectifs », « traduis pour un incubateur
-- néerlandais ». C'est un agent de plus, et il est déclaré comme tel — donc
-- soumis aux mêmes contraintes que l'autre.
--
-- IL N'ENVOIE RIEN, ET C'EST LA BASE QUI LE GARANTIT. `task_permissions` porte
-- `check (contact_externe = false)` : la ligne ci-dessous ne pourrait pas être
-- écrite autrement. Ce n'est pas une politique qu'on applique, c'est une
-- contrainte qu'on ne peut pas contourner sans migration.
--
-- IL N'ÉCRIT PAS EN BASE NON PLUS. Décision du 19/09 : il propose, un humain
-- dispose. Aucune policy ne lui donne d'accès en écriture aux opportunités ni
-- aux contacts ; il rend du texte à l'écran, et c'est l'opérateur qui décide
-- d'en faire un brouillon.

insert into public.agents (slug, nom, mission, actif)
values (
  'redaction',
  'Assistant de rédaction',
  'Rédige, reformule et traduit les messages destinés aux structures, à partir '
  || 'des faits déjà collectés. Récapitule les objectifs et l''état de '
  || 'l''entonnoir. N''envoie rien et n''écrit rien en base : il propose, '
  || 'l''opérateur dispose.',
  true
)
on conflict (slug) do update
  set nom = excluded.nom, mission = excluded.mission, actif = excluded.actif;

insert into public.task_permissions (
  agent, type, libelle, lecture_externe, contact_externe, validation_humaine,
  cout_max_eur, sources_autorisees, actif, notes)
values (
  'redaction', 'redaction_assister',
  'Assister la rédaction (reformuler, traduire, récapituler)',
  true,   -- lecture externe : l'appel au modèle sort du réseau
  false,  -- ET LE CHECK EN BASE INTERDIT QUE CE SOIT AUTRE CHOSE
  true,
  0.05,
  array['autour_acquisition', 'modele_gemini'],
  true,
  'Synchrone : appelé depuis AGORA, pas par la file de tâches. La ligne existe '
  || 'pour que « ce que cet agent a le droit de faire » se lise au même endroit '
  || 'que pour les autres.'
)
on conflict (agent, type) do update
  set libelle = excluded.libelle, cout_max_eur = excluded.cout_max_eur,
      sources_autorisees = excluded.sources_autorisees, notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- LES OBJECTIFS — écrits par le fondateur, pas devinés par le modèle.
--
-- « Fais-moi un récapitulatif de mes objectifs » n'a de sens que si les
-- objectifs existent quelque part. Les déduire de l'entonnoir produirait une
-- paraphrase de chiffres, pas un rappel de ce qu'on cherche à obtenir.
-- ---------------------------------------------------------------------------
create table if not exists public.agora_objectifs (
  id       bigint generated always as identity primary key,
  titre    text not null check (btrim(titre) <> ''),
  detail   text,
  horizon  text not null default 'trimestre'
           check (horizon in ('semaine', 'mois', 'trimestre', 'annee')),
  ordre    integer not null default 100,
  actif    boolean not null default true,
  cree_le  timestamptz not null default now(),
  maj_le   timestamptz not null default now()
);

comment on table public.agora_objectifs is
  'Ce que le fondateur cherche à obtenir, écrit par lui. L''assistant s''en sert pour récapituler ; il n''en invente aucun.';

create or replace function public.agora_objectifs_touch()
returns trigger language plpgsql as $$
begin new.maj_le := now(); return new; end;
$$;

drop trigger if exists agora_objectifs_maj on public.agora_objectifs;
create trigger agora_objectifs_maj before update on public.agora_objectifs
  for each row execute function public.agora_objectifs_touch();

alter table public.agora_objectifs enable row level security;
revoke all privileges on public.agora_objectifs from anon, authenticated;
grant select, insert, update on public.agora_objectifs to authenticated;

drop policy if exists agora_objectifs_operateur on public.agora_objectifs;
create policy agora_objectifs_operateur on public.agora_objectifs
  for select to authenticated using (public.est_operateur());

drop policy if exists agora_objectifs_creation on public.agora_objectifs;
create policy agora_objectifs_creation on public.agora_objectifs
  for insert to authenticated with check (public.est_operateur());

drop policy if exists agora_objectifs_maj_policy on public.agora_objectifs;
create policy agora_objectifs_maj_policy on public.agora_objectifs
  for update to authenticated
  using (public.est_operateur()) with check (public.est_operateur());

-- ---------------------------------------------------------------------------
-- LE BUDGET — lu dans `runs`, pas dans une table de plus.
--
-- `runs.cout_eur` existe déjà et le tableau de bord d'AGORA le somme déjà. Y
-- ajouter une table de compteurs ferait deux vérités pour un seul chiffre.
-- `enrichment_usage_daily` n'est PAS réutilisée : elle compte les appels du
-- pipeline d'enrichissement des lieux, et y mêler ceux-ci fausserait son
-- propre plafond.
-- ---------------------------------------------------------------------------
create or replace function public.agora_assistant_plafond_eur()
returns numeric language sql immutable as $$ select 1.00::numeric $$;

comment on function public.agora_assistant_plafond_eur() is
  'Plafond de dépense quotidien de l''assistant. Changer ce nombre est une décision, donc une migration.';

create or replace function public.agora_assistant_cout_du_jour()
returns numeric language sql stable security definer set search_path to '' as $$
  select coalesce(sum(r.cout_eur), 0)::numeric
  from public.runs r
  where r.agent = 'redaction' and r.debut >= date_trunc('day', now());
$$;

grant execute on function public.agora_assistant_cout_du_jour() to authenticated;
grant execute on function public.agora_assistant_plafond_eur() to authenticated;
