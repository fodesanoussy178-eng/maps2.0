-- ---------------------------------------------------------------------------
-- LE SOCLE DES AGENTS : agents, tasks, runs, task_permissions
--
-- CE QUI EXISTAIT DÉJÀ, ET POURQUOI ÇA NE SUFFISAIT PAS
--
-- Autour sait déjà faire tourner du travail de fond sans personne devant
-- l'écran : `pg_cron` réveille `private.invoke_event_territory_sync()`, qui
-- lit le secret dans le Vault et appelle une fonction Edge par `net.http_post`.
-- Chaque famille de travail tient son propre journal — `event_sync_runs`,
-- `place_recoltes`, `offer_collectes`, `mobility_sync_runs` — et chaque
-- famille a son registre de sources autorisées — `territory_sources`,
-- `offer_source_registry`.
--
-- Ce qui MANQUE, et que ce fichier ajoute, c'est la couche au-dessus : de quoi
-- DEMANDER un travail qui n'est pas une synchronisation de catalogue, savoir
-- ce que l'agent a le droit de faire avant qu'il le fasse, et lire après coup
-- ce qu'il a fait, étape par étape, avec son coût.
--
-- Les journaux existants ne sont pas remplacés. `event_sync_runs` reste le
-- journal des synchronisations d'événements : il porte vingt colonnes qui
-- n'ont de sens que là (pages, occurrences, doublons). `runs` est le journal
-- des ÉTAPES D'UN AGENT, qui n'a pas ces colonnes et en a d'autres — un coût,
-- un modèle, des jetons. Deux tables, deux métiers, aucune donnée en double :
-- une tâche de synchronisation continuera de s'écrire dans `event_sync_runs`,
-- et n'entrera jamais ici.
--
--
-- `task_permissions` EST UN CONTRAT, PAS UNE CONFIGURATION
--
-- La règle « l'agent ne contacte jamais personne tout seul » ne peut pas vivre
-- dans le code de la fonction Edge : une ligne de code se change en une minute
-- et personne ne le voit. Elle vit donc dans une CONTRAINTE DE SCHÉMA —
-- `contact_externe` ne peut pas valoir `true`, quelle que soit la ligne, quel
-- que soit l'agent, quelle que soit la personne qui écrit. Pour qu'un agent
-- puisse un jour envoyer quelque chose lui-même, il faudra une migration,
-- c'est-à-dire une décision écrite, relue et datée.
--
-- Une tâche dont le type n'a pas de ligne dans `task_permissions` ne peut pas
-- être créée : la clé étrangère le refuse. Un agent ne peut donc pas s'inventer
-- une capacité en écrivant une tâche d'un type nouveau.
--
--
-- QUI PEUT LIRE CECI
--
-- Personne, sauf les opérateurs déclarés. La RLS est active sur les quatre
-- tables et la seule policy passe par `public.est_operateur()`. `anon` et
-- `authenticated` perdent tous leurs privilèges par défaut : un visiteur
-- ordinaire d'Autour, même connecté, ne voit pas qu'un agent existe.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. QUI PILOTE — l'espace de contrôle s'appuie sur l'auth qui existe
--
--    Pas de second système d'authentification : un opérateur est un
--    `auth.users` ordinaire, entré par le même lien e-mail que tout le monde,
--    dont l'uid figure ici. Ce qui distingue le fondateur d'un visiteur, c'est
--    une ligne dans cette table — pas un mot de passe de plus, pas un domaine
--    d'e-mail, pas un drapeau dans les métadonnées du jeton (qu'un client peut
--    parfois écrire lui-même).
--
--    La table est VIDE à la création, et volontairement : aucun uid ni aucune
--    adresse n'est écrit dans une migration versionnée. Le premier opérateur
--    s'ajoute une fois, depuis le SQL Editor du projet :
--
--      insert into public.control_operateurs (user_id, role)
--      select id, 'fondateur' from auth.users where email = '<ton e-mail>'
--      on conflict (user_id) do nothing;
-- ===========================================================================

create table if not exists public.control_operateurs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'operateur'
             check (role in ('fondateur','operateur','lecteur')),
  actif      boolean not null default true,
  note       text,
  cree_le    timestamptz not null default now()
);

comment on table public.control_operateurs is
  'Qui a accès au Control Center. Un opérateur est un compte Autour ordinaire dont l''uid figure ici — aucune authentification parallèle.';

/* SECURITY DEFINER, et `set search_path to ''` comme toutes les fonctions
   durcies du projet (voir 20260905122357). Sans DEFINER, la fonction lirait
   `control_operateurs` sous l'identité de l'appelant, donc à travers la RLS de
   cette même table, donc en récursion. */
create or replace function public.est_operateur()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.control_operateurs o
    where o.user_id = (select auth.uid()) and o.actif
  );
$$;

comment on function public.est_operateur() is
  'Vrai si la session appartient à un opérateur actif du Control Center. Seule porte d''entrée des policies du socle agents.';

revoke all privileges on function public.est_operateur() from public, anon;
grant execute on function public.est_operateur() to authenticated, service_role;

/* Lecture seule pour l'opérateur : il voit qui est opérateur, il ne s'en
   ajoute pas. Ajouter ou retirer quelqu'un passe par `postgres`
   (SQL Editor) — c'est-à-dire par un geste délibéré, hors application. */
revoke all privileges on public.control_operateurs from anon, authenticated;
grant select on public.control_operateurs to authenticated;
alter table public.control_operateurs enable row level security;

drop policy if exists control_operateurs_lecture on public.control_operateurs;
create policy control_operateurs_lecture on public.control_operateurs
  for select to authenticated using (public.est_operateur());


-- ===========================================================================
-- 2. LES AGENTS
--
--    Une ligne par agent. Elle sert à trois choses et pas une de plus :
--    afficher « agents actifs » sur le tableau de bord, empêcher une tâche de
--    citer un agent qui n'existe pas, et donner à l'orchestrateur futur
--    (Growth, City Rollout) un endroit où s'inscrire sans migration de
--    structure.
-- ===========================================================================

create table if not exists public.agents (
  slug        text primary key check (slug ~ '^[a-z][a-z0-9_]{2,39}$'),
  nom         text not null,
  mission     text not null,
  actif       boolean not null default true,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);

comment on table public.agents is
  'Registre des agents. Un agent absent d''ici ne peut porter aucune tâche : `tasks.agent` y fait référence.';


-- ===========================================================================
-- 3. CE QUE CHAQUE TYPE DE TÂCHE A LE DROIT DE FAIRE
--
--    `sources_autorisees` est la liste blanche du §14 : un identifiant de
--    source y entre AVANT d'être lu, exactement comme dans
--    `offer_source_registry`. Une source absente n'est jamais appelée.
--
--    `cout_max_eur` borne l'IA par tâche. Zéro veut dire « aucun appel payant
--    n'est permis pour ce type » — et c'est la valeur par défaut, donc le cas
--    normal : la recherche, le filtrage et la déduplication sont du code
--    déterministe qui ne coûte rien.
-- ===========================================================================

create table if not exists public.task_permissions (
  agent               text not null references public.agents(slug) on delete cascade,
  type                text not null check (type ~ '^[a-z][a-z0-9_]{2,63}$'),
  libelle             text not null,

  -- lire des sources publiques listées dans `sources_autorisees`
  lecture_externe     boolean not null default false,
  -- écrire dans les tables de l'agent (jamais dans les tables publiques d'Autour)
  ecriture_interne    boolean not null default true,

  /* ENVOYER QUELQUE CHOSE À QUELQU'UN. Toujours faux, et le CHECK le rend
     vrai pour toujours : préparer un message est une chose, l'envoyer en est
     une autre, et la seconde appartient à un humain. Changer cela demande une
     migration — pas une ligne de configuration modifiée un soir. */
  contact_externe     boolean not null default false check (contact_externe = false),

  -- le résultat de la tâche attend une décision humaine avant d'exister
  validation_humaine  boolean not null default true,

  cout_max_eur        numeric(8,4) not null default 0 check (cout_max_eur >= 0),
  sources_autorisees  text[] not null default '{}'::text[],
  actif               boolean not null default true,
  notes               text,
  cree_le             timestamptz not null default now(),
  primary key (agent, type)
);

comment on table public.task_permissions is
  'Contrat de chaque type de tâche. `contact_externe` est faux par contrainte de schéma : aucun agent n''envoie de communication externe sans migration.';

comment on column public.task_permissions.sources_autorisees is
  'Liste blanche des sources lisibles. Une source absente n''est jamais appelée, même si le code sait la lire.';


-- ===========================================================================
-- 4. LES TÂCHES
--
--    Une tâche est une DEMANDE, pas une exécution. Elle est créée par un
--    humain depuis le Control Center, par une planification pg_cron, ou par un
--    autre agent le jour où l'orchestrateur existera. Elle porte ce qu'il faut
--    pour être rejouée à l'identique : son type, ses paramètres, rien d'autre.
--
--    `statut = 'attente_validation'` est un vrai état de la tâche, pas une
--    manière de dire « échouée ». Une préparation de contact qui attend le
--    fondateur a fait tout son travail.
-- ===========================================================================

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  agent           text not null references public.agents(slug),
  type            text not null,
  params          jsonb not null default '{}'::jsonb,

  statut          text not null default 'file'
                  check (statut in ('file','en_cours','attente_validation',
                                    'terminee','echouee','annulee')),
  priorite        integer not null default 100,
  planifiee_pour  timestamptz not null default now(),

  /* Une tâche qui échoue trois fois ne se rejoue pas éternellement : elle
     s'arrête et se voit. Une boucle d'échec silencieuse sur une route sortante
     est la manière la plus simple de consommer un quota sans rien produire. */
  tentatives      integer not null default 0,
  max_tentatives  integer not null default 3,

  demandee_par    uuid references auth.users(id) on delete set null,
  origine         text not null default 'humain'
                  check (origine in ('humain','planification','agent')),

  resultat        jsonb not null default '{}'::jsonb,
  erreur          text,

  cree_le         timestamptz not null default now(),
  maj_le          timestamptz not null default now(),
  demarree_le     timestamptz,
  terminee_le     timestamptz,

  foreign key (agent, type) references public.task_permissions(agent, type)
);

comment on table public.tasks is
  'File de travail des agents. Le couple (agent, type) référence task_permissions : un type sans contrat déclaré ne peut pas être demandé.';

create index if not exists tasks_a_traiter
  on public.tasks (planifiee_pour, priorite)
  where statut = 'file';

create index if not exists tasks_par_agent on public.tasks (agent, statut, cree_le desc);


-- ===========================================================================
-- 5. LE JOURNAL — une ligne par étape, pas une par tâche
--
--    C'est ce que lit le §13 : « 124 structures analysées », « 31 doublons
--    ignorés », « 18 opportunités qualifiées ». Chacune de ces phrases est une
--    ligne ici, avec son heure et ses compteurs. Une tâche qui n'écrit qu'une
--    ligne « terminée » n'est pas traçable : on ne sait pas où elle a passé son
--    temps ni pourquoi elle a rejeté ce qu'elle a rejeté.
--
--    `cout_eur` est zéro par défaut et le reste tant qu'aucun modèle n'est
--    appelé. Le tableau de bord additionne cette colonne : le « coût IA » qu'il
--    affiche est une somme d'appels réellement facturés, jamais une estimation
--    de confort.
-- ===========================================================================

create table if not exists public.runs (
  id             bigint generated always as identity primary key,
  task_id        uuid references public.tasks(id) on delete cascade,
  agent          text not null references public.agents(slug),
  etape          text not null,
  statut         text not null default 'info'
                 check (statut in ('info','succes','partiel','echec')),
  message        text,

  compteurs      jsonb not null default '{}'::jsonb,

  modele         text,
  jetons_entree  integer,
  jetons_sortie  integer,
  cout_eur       numeric(10,6) not null default 0 check (cout_eur >= 0),

  details        jsonb not null default '{}'::jsonb,
  debut          timestamptz not null default now(),
  fin            timestamptz,
  duree_ms       integer
);

comment on table public.runs is
  'Journal des agents, une ligne par étape. Distinct d''event_sync_runs, qui reste le journal des synchronisations de catalogues.';

create index if not exists runs_par_tache on public.runs (task_id, debut);
create index if not exists runs_recents on public.runs (agent, debut desc);


-- ===========================================================================
-- 6. `maj_le` SANS Y PENSER
-- ===========================================================================

create or replace function public.toucher_maj_le()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

drop trigger if exists tasks_maj_le on public.tasks;
create trigger tasks_maj_le before update on public.tasks
  for each row execute function public.toucher_maj_le();

drop trigger if exists agents_maj_le on public.agents;
create trigger agents_maj_le before update on public.agents
  for each row execute function public.toucher_maj_le();


-- ===========================================================================
-- 7. PRIVILÈGES DE MOINDRE PORTÉE
--
--    Supabase accorde par défaut tous les droits DML à `anon` et
--    `authenticated` sur toute table du schéma `public` (voir 20260905115107 :
--    c'est ce défaut qui laissait `mel_communes` effaçable par n'importe qui).
--    On les révoque d'abord, on rend ensuite le strict nécessaire.
--
--    L'agent, lui, écrit avec `service_role`, qui est BYPASSRLS : lui donner
--    des policies ne lui retirerait rien et n'ajouterait aucune garantie.
-- ===========================================================================

revoke all privileges on public.agents            from anon, authenticated;
revoke all privileges on public.task_permissions  from anon, authenticated;
revoke all privileges on public.tasks             from anon, authenticated;
revoke all privileges on public.runs              from anon, authenticated;

-- L'opérateur lit tout, et crée des tâches. Il ne réécrit pas le journal :
-- un journal qu'on peut corriger après coup ne prouve plus rien.
grant select                on public.agents           to authenticated;
grant select                on public.task_permissions to authenticated;
grant select, insert, update on public.tasks           to authenticated;
grant select                on public.runs             to authenticated;

alter table public.agents           enable row level security;
alter table public.task_permissions enable row level security;
alter table public.tasks            enable row level security;
alter table public.runs             enable row level security;

drop policy if exists agents_operateur on public.agents;
create policy agents_operateur on public.agents
  for select to authenticated using (public.est_operateur());

drop policy if exists task_permissions_operateur on public.task_permissions;
create policy task_permissions_operateur on public.task_permissions
  for select to authenticated using (public.est_operateur());

drop policy if exists runs_operateur on public.runs;
create policy runs_operateur on public.runs
  for select to authenticated using (public.est_operateur());

drop policy if exists tasks_lecture on public.tasks;
create policy tasks_lecture on public.tasks
  for select to authenticated using (public.est_operateur());

/* Une tâche créée depuis le Control Center porte l'uid de qui l'a demandée, et
   `origine = 'humain'`. Le WITH CHECK l'impose plutôt que de faire confiance
   au client : sans lui, l'écran pourrait écrire une tâche au nom de quelqu'un
   d'autre, ou la faire passer pour une planification. */
drop policy if exists tasks_creation on public.tasks;
create policy tasks_creation on public.tasks
  for insert to authenticated
  with check (public.est_operateur()
              and demandee_par = (select auth.uid())
              and origine = 'humain'
              and statut = 'file');

/* Annuler une tâche, oui. Réécrire son résultat, non : le `statut` accessible
   à l'opérateur se limite à `annulee`, et seulement depuis la file d'attente.
   Tout le reste du cycle de vie appartient à la fonction Edge. */
drop policy if exists tasks_annulation on public.tasks;
create policy tasks_annulation on public.tasks
  for update to authenticated
  using (public.est_operateur() and statut in ('file','attente_validation'))
  with check (public.est_operateur() and statut in ('file','attente_validation','annulee'));
