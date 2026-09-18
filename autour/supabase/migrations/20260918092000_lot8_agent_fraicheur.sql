-- ---------------------------------------------------------------------------
-- LOT 8 · 3 — L'AGENT DE FRAÎCHEUR : LA POLITIQUE, LA FILE, ET LES PROPOSITIONS
--
-- CE QUI MANQUAIT
--
-- `event_sync_runs` journalise ce qui A TOURNÉ. Rien, nulle part, ne dit ce
-- qui RESTE À FAIRE. Une file sans producteur n'est pas une file : c'est un
-- journal. Ce fichier ajoute le producteur, et seulement lui — l'exécution
-- vit dans la fonction Edge `fraicheur`.
--
-- LES TROIS VOIES, PAR COÛT CROISSANT
--
--   1. DÉTERMINISTE — gratuite, illimitée. SIRENE pour l'état administratif,
--      FINESS pour le sanitaire et le médico-social, le diff Overpass à 48 h,
--      `HEAD` sur `official_url`. Rien de ce qui sort d'ici ne consomme de
--      quota.
--   2. HTTP STRUCTURÉ — gratuite. Le JSON-LD `schema.org/Event` que les sites
--      culturels exposent dans leur `<head>`, et les flux RSS. C'est
--      probablement le gisement principal des événements absents d'OpenAgenda
--      et de DATAtourisme, et il ne coûte rien.
--   3. GROUNDÉE — sous quota, uniquement le reliquat que les deux premières
--      n'ont pas tranché.
--
-- L'ORDRE N'EST PAS UNE PRÉFÉRENCE, C'EST UNE RÈGLE DE DÉPENSE : environ 330
-- objets par cycle de 48 h passent par la voie 3, et les dépenser sur ce que
-- SIRENE donne gratuitement, c'est ne pas les avoir pour le reste.
--
-- POURQUOI `freshness_tasks` ET NON `tasks`
--
-- Une table nommée `tasks` dans un schéma partagé n'appartient à personne, et
-- la deuxième file du dépôt la trouvera occupée. Le nom dit de quelles tâches
-- il s'agit ; c'est tout ce qui change par rapport au plan.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. LA POLITIQUE — combien de temps une information reste vraie
--
-- Ce n'est pas une constante dans du code : ces durées se discutent, et elles
-- changeront. Une aide solidaire fausse coûte un trajet à quelqu'un qui n'en
-- a pas les moyens — 72 h. Un commerce change d'enseigne en des mois — 30 j.
-- ---------------------------------------------------------------------------

create table if not exists public.freshness_policy (
  type_objet        text primary key,
  ttl_heures        integer  not null check (ttl_heures between 1 and 8760),
  voie              text     not null check (voie in ('deterministe','http','grounde')),
  -- Ce qu'on tente quand la voie principale ne tranche pas. Nul = on s'arrête.
  voie_secours      text     check (voie_secours in ('deterministe','http','grounde')),
  priorite          smallint not null default 50 check (priorite between 1 and 1000),
  -- Vrai = aucune proposition n'est acceptée automatiquement, quelle que soit
  -- la source. C'est le niveau 3, et il ne s'assouplit pas avec le temps.
  relecture_humaine boolean  not null default false,
  actif             boolean  not null default true,
  commentaire       text
);

comment on table public.freshness_policy is
  'Combien de temps une information reste vraie, par type d''objet, et par quelle voie on la revérifie.';
comment on column public.freshness_policy.priorite is
  'Petit = passe d''abord. Le budget d''un cycle se coupe dans cet ordre : ce qui saute est ce qui coûte le moins cher à se tromper.';

insert into public.freshness_policy
  (type_objet, ttl_heures, voie, voie_secours, priorite, relecture_humaine, commentaire) values
  ('aide_solidaire',  72,  'http', 'deterministe', 10, true,
   'Une permanence sociale fausse coûte plus cher qu''une permanence absente. Jamais d''acceptation automatique.'),
  ('evenement_proche', 48, 'http', null,           20, false,
   'Événement qui commence dans moins de sept jours : c''est là que l''erreur se paie en déplacement.'),
  ('ephemere',         48, 'grounde', 'http',      30, false,
   'Pop-up, lieu signalé, occupation temporaire : aucun catalogue ne les publie, la recherche est la seule voie.'),
  ('lieu_culturel',   336, 'http', 'deterministe', 50, false,
   'Quatorze jours. Les horaires changent par saison, le lieu lui-même bouge rarement.'),
  ('commerce',        720, 'deterministe', null,   70, false,
   'Trente jours, et par SIRENE seulement : l''état administratif est gratuit, structuré et fait foi.')
on conflict (type_objet) do update
  set ttl_heures = excluded.ttl_heures, voie = excluded.voie,
      voie_secours = excluded.voie_secours, priorite = excluded.priorite,
      relecture_humaine = excluded.relecture_humaine, commentaire = excluded.commentaire;

alter table public.freshness_policy enable row level security;
revoke all on public.freshness_policy from anon, authenticated;
grant all on public.freshness_policy to service_role;


-- ---- Ce que chaque objet sait de sa propre dernière vérification ---------
-- Séparé de `last_seen_at` et de `last_synced_at` à dessein : « un
-- fournisseur m'a mentionné » n'est pas « quelqu'un a vérifié que c'est
-- encore vrai ». Confondre les deux ferait considérer comme frais tout ce
-- qu'un catalogue recopie sans le revoir.
alter table public.places
  add column if not exists fraicheur_verifiee_le timestamptz,
  add column if not exists fraicheur_voie        text;
alter table public.events
  add column if not exists fraicheur_verifiee_le timestamptz,
  add column if not exists fraicheur_voie        text;

comment on column public.places.fraicheur_verifiee_le is
  'Dernière vérification ACTIVE. Ce n''est pas `last_seen_at` : être recopié par un catalogue n''est pas être vérifié.';


-- ---------------------------------------------------------------------------
-- 2. LE TYPE D'UN OBJET — déduit, jamais saisi
--
-- Un type saisi à la main devient faux dès qu'on change une famille. Ces deux
-- fonctions le déduisent de ce qui est déjà vrai dans la table.
-- ---------------------------------------------------------------------------

create or replace function public.type_objet_du_lieu(p_famille text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_famille = 'solidarite' then 'aide_solidaire'
    when p_famille = 'commerce'   then 'commerce'
    when p_famille in ('culture','bibliotheque','cinema','musique','patrimoine','nature','sport','marche')
                                  then 'lieu_culturel'
    else null
  end;
$function$;

comment on function public.type_objet_du_lieu(text) is
  'Traduit une famille de lieu en type de fraîcheur. Une famille inconnue rend NULL : le lieu n''entre pas dans la file plutôt que d''y entrer mal.';

create or replace function public.type_objet_de_l_evenement(
  p_start_at timestamptz, p_primary_source text
)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    -- Un événement sans date exploitable, ou publié sans catalogue derrière,
    -- est exactement ce que la voie groundée doit aller chercher.
    when p_start_at is null then 'ephemere'
    when p_start_at <= now() + interval '7 days' then 'evenement_proche'
    when coalesce(p_primary_source, 'autour') in ('autour','signale') then 'ephemere'
    else null
  end;
$function$;


-- ---------------------------------------------------------------------------
-- 3. LA FILE
--
-- Une ligne par objet à revérifier. L'index partiel unique est la pièce
-- importante : sans lui, deux cycles qui se chevauchent programment deux fois
-- le même lieu et dépensent deux fois le même appel.
-- ---------------------------------------------------------------------------

create table if not exists public.freshness_tasks (
  id           bigint generated always as identity primary key,
  type_objet   text        not null references public.freshness_policy(type_objet),
  objet_kind   text        not null check (objet_kind in ('place','event')),
  objet_id     uuid        not null,
  voie         text        not null check (voie in ('deterministe','http','grounde')),
  priorite     smallint    not null default 50,
  etat         text        not null default 'a_faire'
                 check (etat in ('a_faire','en_cours','faite','abandonnee')),
  -- Pourquoi cette ligne existe : « TTL dépassé », « signalée », « jamais
  -- vérifiée ». Une tâche sans raison ne se relit pas six mois plus tard.
  raison       text        not null default 'ttl_depasse',
  run_id       bigint,
  cree_le      timestamptz not null default now(),
  pris_le      timestamptz,
  fini_le      timestamptz,
  resultat     jsonb       not null default '{}'::jsonb,
  erreur       text
);

comment on table public.freshness_tasks is
  'Ce qui reste à vérifier. `event_sync_runs` dit ce qui a tourné ; cette table dit ce qui attend.';

create unique index if not exists freshness_tasks_en_attente_idx
  on public.freshness_tasks (objet_kind, objet_id)
  where etat in ('a_faire','en_cours');
create index if not exists freshness_tasks_ordre_idx
  on public.freshness_tasks (etat, priorite, cree_le);

alter table public.freshness_tasks enable row level security;
revoke all on public.freshness_tasks from anon, authenticated;
grant all on public.freshness_tasks to service_role;


-- ---- Le journal d'un cycle ----------------------------------------------
create table if not exists public.freshness_runs (
  id            bigint generated always as identity primary key,
  demarre_le    timestamptz not null default now(),
  fini_le       timestamptz,
  budget_cycle  integer     not null default 0,
  programmees   integer     not null default 0,
  traitees      integer     not null default 0,
  propositions  integer     not null default 0,
  acceptees     integer     not null default 0,
  -- A.8 : le chiffre qui décide de la suite. Une proposition contredite plus
  -- tard par une source déterministe est une erreur qu'on a publiée.
  contredites   integer     not null default 0,
  par_voie      jsonb       not null default '{}'::jsonb,
  statut        text        not null default 'en_cours'
                  check (statut in ('en_cours','succes','partiel','echec'))
);

-- Posée ici et non dans la table : `freshness_tasks` est déclarée avant le
-- journal des cycles, parce qu'on la lit plus souvent qu'on ne le lit.
alter table public.freshness_tasks
  drop constraint if exists freshness_tasks_run_fk;
alter table public.freshness_tasks
  add constraint freshness_tasks_run_fk
  foreign key (run_id) references public.freshness_runs(id) on delete set null;

comment on table public.freshness_runs is
  'Un cycle de 48 h. `contredites` est la mesure qui peut couper une voie : voir private.voie_coupee().';

alter table public.freshness_runs enable row level security;
revoke all on public.freshness_runs from anon, authenticated;
grant all on public.freshness_runs to service_role;


-- ---------------------------------------------------------------------------
-- 4. LE PRODUCTEUR — la pièce qui manquait
--
-- Sélectionne les objets dont la dernière vérification dépasse le TTL, trie
-- par priorité, coupe au budget du cycle, écrit dans la file. Il ne vérifie
-- rien lui-même : il nomme.
-- ---------------------------------------------------------------------------

create or replace function public.programmer_fraicheur(
  p_budget integer default 330,
  p_run_id bigint  default null
)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_budget integer := least(greatest(coalesce(p_budget, 0), 0), 5000);
  v_ecrites integer := 0;
begin
  if v_budget = 0 then return 0; end if;

  with candidats as (
    -- LES LIEUX
    select 'place'::text as objet_kind, p.id as objet_id,
           public.type_objet_du_lieu(p.family) as type_objet,
           coalesce(p.fraicheur_verifiee_le, p.first_seen_at) as vu_le
    from public.places p
    where p.status <> 'disabled'
      and public.type_objet_du_lieu(p.family) is not null
    union all
    -- LES ÉVÉNEMENTS. Un événement passé ne se revérifie pas : il est passé,
    -- c'est la seule chose qu'on ait besoin de savoir.
    select 'event'::text, e.id,
           public.type_objet_de_l_evenement(e.start_at, e.primary_source),
           coalesce(e.fraicheur_verifiee_le, e.created_at)
    from public.events e
    where e.cancelled = false
      and coalesce(e.end_at, e.start_at, now()) >= now()
      and public.type_objet_de_l_evenement(e.start_at, e.primary_source) is not null
  ),
  a_faire as (
    select c.objet_kind, c.objet_id, c.type_objet, f.voie, f.priorite,
           case when c.vu_le is null then 'jamais_verifie' else 'ttl_depasse' end as raison
    from candidats c
    join public.freshness_policy f on f.type_objet = c.type_objet and f.actif
    where c.vu_le is null
       or c.vu_le < now() - make_interval(hours => f.ttl_heures)
    -- Une tâche déjà en file ne se reprogramme pas : l'index unique le
    -- refuserait, mais l'écarter ici évite de consommer le budget pour rien.
      and not exists (
        select 1 from public.freshness_tasks t
        where t.objet_kind = c.objet_kind and t.objet_id = c.objet_id
          and t.etat in ('a_faire','en_cours')
      )
    -- Le plus prioritaire, puis le plus vieux : à priorité égale, celui qu'on
    -- a laissé attendre le plus longtemps passe devant.
    order by f.priorite, c.vu_le nulls first
    limit v_budget
  )
  insert into public.freshness_tasks
    (type_objet, objet_kind, objet_id, voie, priorite, raison, run_id)
  select a.type_objet, a.objet_kind, a.objet_id, a.voie, a.priorite, a.raison, p_run_id
  from a_faire a
  on conflict do nothing;

  get diagnostics v_ecrites = row_count;

  if p_run_id is not null then
    update public.freshness_runs r
       set programmees = r.programmees + v_ecrites,
           budget_cycle = greatest(r.budget_cycle, v_budget)
     where r.id = p_run_id;
  end if;

  return v_ecrites;
end;
$function$;

comment on function public.programmer_fraicheur(integer, bigint) is
  'Le producteur de la file : sélectionne ce qui a dépassé son TTL, trie par priorité, coupe au budget. Ne vérifie rien.';

revoke all on function public.programmer_fraicheur(integer, bigint) from public, anon, authenticated;
grant execute on function public.programmer_fraicheur(integer, bigint) to service_role;


-- ---------------------------------------------------------------------------
-- 5. L'ÉCRITURE EN DEUX TEMPS (A.6)
--
-- Les propositions vont ici, JAMAIS directement dans `places` ou `events`.
--
-- Acceptation automatique seulement si :
--   · la source est officielle — site du lieu, mairie, domaine en `.gouv.fr` ;
--   · ou deux sources indépendantes concordent.
--
-- Tout le reste part en relecture humaine. C'est le niveau 2 contre le niveau
-- 3 du système de permissions, appliqué à un cas réel — et pour la famille
-- solidaire, le niveau 3 s'applique sans exception (`relecture_humaine`).
-- ---------------------------------------------------------------------------

create table if not exists public.freshness_proposals (
  id               bigint generated always as identity primary key,
  task_id          bigint      references public.freshness_tasks(id) on delete set null,
  run_id           bigint      references public.freshness_runs(id) on delete set null,
  objet_kind       text        not null check (objet_kind in ('place','event')),
  objet_id         uuid        not null,
  voie             text        not null check (voie in ('deterministe','http','grounde')),
  -- LE CONTRAT DE SORTIE (A.5), ET RIEN D'AUTRE. Trois valeurs, pas quatre :
  -- « peut-être fermé » n'existe pas.
  statut           text        not null check (statut in ('ouvert','ferme_definitivement','inconnu')),
  date_information date,
  url_source       text,
  confiance        numeric(3,2) not null default 0 check (confiance between 0 and 1),
  source_officielle boolean    not null default false,
  etat             text        not null default 'en_attente'
                     check (etat in ('en_attente','acceptee','refusee','appliquee','contredite')),
  motif            text,
  decide_le        timestamptz,
  decide_par       text,
  cree_le          timestamptz not null default now(),

  -- A.5, vérifié par la base et non par l'invite : pas d'URL exploitable →
  -- `inconnu` → aucune écriture. Une règle déclarée dans un prompt est une
  -- intention ; une contrainte est une garantie.
  constraint freshness_proposals_sans_url_est_inconnu check (
    statut = 'inconnu'
    or (url_source is not null and url_source ~* '^https?://[^ ]+$')
  ),
  -- Une proposition qui affirme quelque chose sans y croire n'est pas une
  -- proposition. `inconnu` est la seule sortie autorisée à confiance nulle.
  constraint freshness_proposals_confiance_nulle_est_inconnue check (
    statut = 'inconnu' or confiance > 0
  )
);

-- A.7 — JAMAIS D'HORAIRES ICI, ET SURTOUT PAS PAR LA VOIE GROUNDÉE.
--
-- Cette table n'a aucune colonne d'horaire, et c'est délibéré. La recherche
-- remonte massivement des agrégateurs périmés : pour « fermé définitivement »
-- elle est bonne — une fermeture laisse des traces publiques — mais pour
-- « ouvert jusqu'à 19 h le mardi » elle fabriquera une réponse.
--
-- Les horaires passent par OSM (`opening_hours`, syntaxe standard, ODbL) ou
-- par rien. `tests/fraicheur.test.mjs` refuse toute colonne d'horaire ajoutée
-- ici, et refuse que la fonction Edge écrive `opening_hours` depuis la voie 3.

comment on table public.freshness_proposals is
  'Ce qu''une voie propose. Rien n''entre dans `places` ni `events` sans passer par ici, et par une décision.';
comment on constraint freshness_proposals_sans_url_est_inconnu on public.freshness_proposals is
  'A.5 : pas d''URL exploitable → `inconnu` → aucune écriture. Vérifié par la base, pas déclaré dans une invite.';

create index if not exists freshness_proposals_attente_idx
  on public.freshness_proposals (etat, cree_le) where etat = 'en_attente';
create index if not exists freshness_proposals_objet_idx
  on public.freshness_proposals (objet_kind, objet_id, cree_le desc);

alter table public.freshness_proposals enable row level security;
revoke all on public.freshness_proposals from anon, authenticated;
grant all on public.freshness_proposals to service_role;


-- ---- Ce qui fait qu'une source est officielle ----------------------------
-- Une liste de motifs, pas un jugement. `.gouv.fr` et `.fr` d'une commune
-- sont officiels ; un agrégateur d'horaires ne l'est jamais, quel que soit
-- son classement dans les résultats de recherche.
create or replace function public.source_officielle(p_url text, p_url_du_lieu text default null)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_url is null then false
    when p_url ~* '^https?://([a-z0-9-]+\.)*gouv\.fr(/|$|:)' then true
    when p_url ~* '^https?://([a-z0-9-]+\.)*service-public\.fr(/|$|:)' then true
    when p_url ~* '^https?://([a-z0-9-]+\.)*(ville|mairie|cc|ca|cu)-[a-z0-9-]+\.fr(/|$|:)' then true
    -- Le site du lieu lui-même : la source la plus officielle qui soit sur ce
    -- qu'il fait. On compare les domaines, pas les URL entières.
    when p_url_du_lieu is not null
     and lower(split_part(split_part(regexp_replace(p_url, '^https?://', ''), '/', 1), ':', 1)) =
         lower(split_part(split_part(regexp_replace(p_url_du_lieu, '^https?://', ''), '/', 1), ':', 1))
      then true
    else false
  end;
$function$;

comment on function public.source_officielle(text, text) is
  'Vrai pour un domaine public ou pour le site du lieu lui-même. Un agrégateur n''est jamais officiel, quel que soit son rang dans les résultats.';


-- ---- La décision --------------------------------------------------------
create or replace function public.decider_propositions(p_run_id bigint default null)
returns table (acceptees integer, en_relecture integer)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_acceptees integer := 0;
  v_relecture integer := 0;
begin
  -- 1. SOURCE OFFICIELLE, ou deux sources indépendantes concordantes.
  with concordances as (
    select p.id,
           p.source_officielle as officielle,
           count(*) filter (
             where a.id <> p.id
               and a.statut = p.statut
               and a.url_source is not null
               -- « Indépendantes » veut dire deux domaines différents. Deux
               -- pages du même site ne sont pas deux sources.
               and split_part(regexp_replace(a.url_source, '^https?://', ''), '/', 1)
                   is distinct from
                   split_part(regexp_replace(p.url_source, '^https?://', ''), '/', 1)
           ) as concordantes
    from public.freshness_proposals p
    left join public.freshness_proposals a
      on a.objet_kind = p.objet_kind and a.objet_id = p.objet_id
     and a.etat in ('en_attente','acceptee','appliquee')
     and a.cree_le > now() - interval '30 days'
    where p.etat = 'en_attente' and p.statut <> 'inconnu'
    group by p.id, p.source_officielle
  ),
  -- La relecture humaine obligatoire l'emporte sur tout le reste : aucune
  -- concordance, aucune source officielle ne la lève. C'est le sens de
  -- « niveau 3, sans exception ».
  decisions as (
    select c.id,
           case when f.relecture_humaine then 'en_attente'
                when c.officielle or c.concordantes >= 1 then 'acceptee'
                else 'en_attente' end as etat,
           case when f.relecture_humaine then 'relecture_humaine_obligatoire'
                when c.officielle then 'source_officielle'
                when c.concordantes >= 1 then 'deux_sources_independantes'
                else 'source_unique_non_officielle' end as motif
    from concordances c
    join public.freshness_proposals p on p.id = c.id
    left join public.freshness_tasks t on t.id = p.task_id
    left join public.freshness_policy f on f.type_objet = t.type_objet
  )
  update public.freshness_proposals p
     set etat = d.etat, motif = d.motif,
         decide_le = case when d.etat = 'acceptee' then now() else null end,
         decide_par = case when d.etat = 'acceptee' then 'regle_automatique' else null end
    from decisions d
   where p.id = d.id;

  select count(*) filter (where p.etat = 'acceptee' and p.decide_le > now() - interval '1 minute'),
         count(*) filter (where p.etat = 'en_attente')
    into v_acceptees, v_relecture
    from public.freshness_proposals p
   where p_run_id is null or p.run_id = p_run_id;

  if p_run_id is not null then
    update public.freshness_runs r set acceptees = r.acceptees + coalesce(v_acceptees, 0)
     where r.id = p_run_id;
  end if;

  return query select coalesce(v_acceptees, 0), coalesce(v_relecture, 0);
end;
$function$;

comment on function public.decider_propositions(bigint) is
  'Applique la règle d''acceptation automatique. Tout ce qui ne la satisfait pas part en relecture humaine — y compris quand c''est probablement vrai.';

revoke all on function public.decider_propositions(bigint) from public, anon, authenticated;
grant execute on function public.decider_propositions(bigint) to service_role;


-- ---------------------------------------------------------------------------
-- 6. LA MESURE, ET LA COUPURE AUTOMATIQUE (A.8)
--
-- À chaque cycle : propositions produites, acceptées, puis CONTREDITES PLUS
-- TARD PAR UNE SOURCE DÉTERMINISTE. Au-delà d'un seuil fixé à l'avance, la
-- voie se coupe d'elle-même.
--
-- C'est la boucle « observer → agir → mesurer → apprendre », réduite à une
-- quantité calculable — et le seuil est écrit AVANT d'avoir vu les chiffres,
-- parce qu'un seuil choisi après coup s'ajuste toujours pour valider ce
-- qu'on espérait.
-- ---------------------------------------------------------------------------

create table if not exists public.freshness_voie_sante (
  voie              text primary key check (voie in ('deterministe','http','grounde')),
  seuil_contradiction numeric(3,2) not null check (seuil_contradiction between 0 and 1),
  fenetre_jours     integer not null default 30 check (fenetre_jours between 1 and 365),
  -- Sous ce nombre de propositions, le taux ne veut rien dire : trois erreurs
  -- sur cinq n'est pas un signal, c'est un petit échantillon.
  minimum_mesurable integer not null default 20,
  coupee_le         timestamptz,
  coupee_raison     text
);

insert into public.freshness_voie_sante (voie, seuil_contradiction, minimum_mesurable) values
  ('deterministe', 0.05, 20),
  ('http',         0.10, 20),
  -- La voie la plus chère est aussi la moins tolérée : elle ne survit que si
  -- elle se trompe moins d'une fois sur dix.
  ('grounde',      0.10, 20)
on conflict (voie) do nothing;

alter table public.freshness_voie_sante enable row level security;
revoke all on public.freshness_voie_sante from anon, authenticated;
grant all on public.freshness_voie_sante to service_role;

create or replace function public.mesurer_voies()
returns table (voie text, produites bigint, acceptees bigint, contredites bigint,
               taux numeric, coupee boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  select s.voie,
         count(p.id),
         count(p.id) filter (where p.etat in ('acceptee','appliquee')),
         count(p.id) filter (where p.etat = 'contredite'),
         case when count(p.id) filter (where p.etat in ('acceptee','appliquee','contredite')) = 0
              then 0::numeric
              else round(count(p.id) filter (where p.etat = 'contredite')::numeric
                   / count(p.id) filter (where p.etat in ('acceptee','appliquee','contredite')), 3)
         end,
         s.coupee_le is not null
  from public.freshness_voie_sante s
  left join public.freshness_proposals p
    on p.voie = s.voie and p.cree_le > now() - make_interval(days => s.fenetre_jours)
  group by s.voie, s.coupee_le;
$function$;

comment on function public.mesurer_voies() is
  'Produites, acceptées, contredites par voie sur la fenêtre. Le taux est le seul chiffre qui décide de la suite.';

-- Marquer une proposition contredite. C'est la voie DÉTERMINISTE qui contredit
-- les autres, jamais l'inverse : SIRENE a raison contre une page web, et une
-- page web a raison contre une recherche.
create or replace function public.contredire_proposition(
  p_objet_kind text, p_objet_id uuid, p_statut_reel text
)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_touchees integer := 0;
begin
  update public.freshness_proposals p
     set etat = 'contredite',
         motif = coalesce(p.motif, '') || ' | contredite par une source déterministe : ' || p_statut_reel
   where p.objet_kind = p_objet_kind
     and p.objet_id = p_objet_id
     and p.voie <> 'deterministe'
     and p.etat in ('acceptee','appliquee')
     and p.statut is distinct from p_statut_reel;
  get diagnostics v_touchees = row_count;
  return v_touchees;
end;
$function$;

revoke all on function public.contredire_proposition(text, uuid, text) from public, anon, authenticated;
grant execute on function public.contredire_proposition(text, uuid, text) to service_role;

-- LA COUPURE. Elle ne demande l'avis de personne : c'est le point. Une voie
-- qui dépasse son seuil cesse de produire, et il faut une décision humaine
-- explicite (remettre `coupee_le` à NULL) pour la rouvrir.
create or replace function public.couper_voies_deviantes()
returns table (voie text, taux numeric, coupee boolean)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  update public.freshness_voie_sante s
     set coupee_le = now(),
         coupee_raison = 'taux de contradiction ' || m.taux || ' au-dessus du seuil ' || s.seuil_contradiction
    from public.mesurer_voies() m
   where m.voie = s.voie
     and s.coupee_le is null
     and m.produites >= s.minimum_mesurable
     and m.taux > s.seuil_contradiction;

  return query
    select m.voie, m.taux, s.coupee_le is not null
      from public.mesurer_voies() m
      join public.freshness_voie_sante s on s.voie = m.voie;
end;
$function$;

comment on function public.couper_voies_deviantes() is
  'Coupe une voie dont le taux de contradiction dépasse son seuil. La rouvrir demande une décision humaine, pas un délai qui passe.';

revoke all on function public.couper_voies_deviantes() from public, anon, authenticated;
grant execute on function public.couper_voies_deviantes() to service_role;

-- La file ne sert que des voies vivantes : une voie coupée ne se voit pas
-- attribuer de tâches, plutôt que d'en recevoir et de les refuser une par une.
create or replace function public.voie_ouverte(p_voie text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((select s.coupee_le is null
                   from public.freshness_voie_sante s where s.voie = p_voie), true);
$function$;

revoke all on function public.voie_ouverte(text) from public, anon, authenticated;
grant execute on function public.voie_ouverte(text) to service_role;
