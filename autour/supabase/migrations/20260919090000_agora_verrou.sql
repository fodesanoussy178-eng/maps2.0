-- ---------------------------------------------------------------------------
-- AGORA — le second verrou de l'espace privé
--
-- CE QU'IL AJOUTE, ET POURQUOI IL EST SÉPARÉ DE L'AUTHENTIFICATION
--
-- Jusqu'ici, `est_operateur()` répondait vrai dès qu'une session e-mail non
-- anonyme portait l'uid d'une ligne de `control_operateurs`. C'est une
-- AUTORISATION, et elle reste. Mais elle est permanente : un téléphone
-- déverrouillé, une session restée ouverte sur un ordinateur partagé, et
-- l'espace de pilotage est ouvert.
--
-- Le code AGORA ajoute une SECONDE condition, de nature différente : « la
-- personne devant l'écran, maintenant, sait le code ». C'est un facteur de
-- session, pas un facteur d'identité — d'où une table à part, une durée de
-- validité, et aucun lien avec le mot de passe ou le lien e-mail.
--
--
-- LE CODE N'EXISTE NULLE PART EN CLAIR
--
-- · pas dans ce fichier, ni dans aucune migration ;
-- · pas dans le HTML, le JavaScript ou le paquet livré au navigateur ;
-- · pas dans une variable d'environnement Vercel ou Supabase ;
-- · pas dans cette base : seule une empreinte HMAC-SHA256 y est rangée, avec
--   son sel, dans le schéma `private`, sans aucun privilège pour `anon` ni
--   `authenticated`.
--
-- L'empreinte a été calculée HORS de la base et seuls ses octets y ont été
-- écrits : le code en clair n'a donc jamais transité dans une instruction SQL
-- ni dans les journaux du projet.
--
-- CE QUE CE CHOIX NE PROTÈGE PAS, ET IL FAUT LE DIRE. Un HMAC-SHA256 sur un
-- code court se casse hors ligne en quelques secondes si l'empreinte ET le sel
-- fuitent. Ils ne fuitent que si quelqu'un a déjà `postgres` ou `service_role`
-- — c'est-à-dire s'il a déjà tout. Le vrai rempart contre la devinette est le
-- plafond de tentatives ci-dessous, pas la longueur du hachage.
--
--
-- CE QUI SE PASSE QUAND LE VERROU EXPIRE
--
-- `est_operateur()` redevient faux. Toutes les policies du socle agents le
-- lisent, donc tout l'espace redevient vide, d'un coup, sans qu'aucune policy
-- n'ait à être modifiée. L'écran redemande le code. C'est voulu : un seul
-- endroit décide, et il ne peut pas être contourné en oubliant une table.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;


-- ===========================================================================
-- 1. L'EMPREINTE — dans `private`, sans un seul privilège accordé
-- ===========================================================================

create table if not exists private.control_secrets (
  nom        text primary key,
  sel        bytea not null,
  empreinte  bytea,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now()
);

comment on table private.control_secrets is
  'Empreinte HMAC du code d''accès AGORA. Jamais le code lui-même. Aucun privilège n''est accordé sur cette table : seuls postgres et service_role la voient.';

/* Le sel est tiré ici, l'empreinte est écrite ensuite depuis l'extérieur.
   `empreinte` reste donc NULL jusqu'à ce qu'un code soit posé — et tant
   qu'elle est nulle, `agora_ouvrir` refuse tout le monde plutôt que
   d'accepter n'importe quoi. */
insert into private.control_secrets (nom, sel)
values ('agora', extensions.gen_random_bytes(32))
on conflict (nom) do nothing;


-- ===========================================================================
-- 2. LE DÉVERROUILLAGE — une session, une échéance
-- ===========================================================================

create table if not exists public.control_deverrouillages (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  ouvert_le  timestamptz not null default now(),
  expire_le  timestamptz not null
);

comment on table public.control_deverrouillages is
  'Qui a entré le code AGORA, et jusqu''à quand. Facteur de session : distinct de l''authentification et de l''autorisation opérateur.';

/* DOUZE HEURES. Assez pour une journée de travail sans redemander le code à
   chaque écran ; assez court pour qu'un onglet oublié la veille ne serve à
   personne le lendemain. */
create or replace function public.agora_duree()
returns interval language sql immutable as $$ select interval '12 hours' $$;


-- ===========================================================================
-- 3. LE PLAFOND DE TENTATIVES — le vrai rempart
--
--    Cinq essais ratés par quart d'heure et par compte. Sans lui, un code de
--    sept caractères se devine en ligne ; avec lui, il faudrait des années, et
--    les tentatives se voient dans le Control Center.
-- ===========================================================================

create table if not exists public.control_tentatives (
  id       bigint generated always as identity primary key,
  user_id  uuid references auth.users(id) on delete cascade,
  le       timestamptz not null default now(),
  reussi   boolean not null
);

create index if not exists control_tentatives_recentes
  on public.control_tentatives (user_id, le desc);

comment on table public.control_tentatives is
  'Journal des tentatives d''ouverture d''AGORA. Ne contient jamais ce qui a été tapé — seulement qui, quand, et si ça a marché.';


-- ===========================================================================
-- 4. OUVRIR
--
--    SECURITY DEFINER : la fonction lit `private.control_secrets`, que
--    l'appelant ne peut pas voir. Elle ne rend JAMAIS l'empreinte, le sel, ni
--    la moindre indication sur le code — seulement oui/non et le nombre
--    d'essais restants.
-- ===========================================================================

create or replace function public.agora_ouvrir(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_anonyme boolean := coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_echecs integer;
  v_secret record;
  v_ok boolean;
  v_expire timestamptz;
begin
  -- Une session anonyme n'a pas d'identité à verrouiller : elle ne peut pas
  -- essayer, donc elle ne peut pas non plus consommer le plafond de quelqu'un.
  if v_uid is null or v_anonyme then
    return jsonb_build_object('ouvert', false, 'raison', 'session');
  end if;

  select count(*) into v_echecs
  from public.control_tentatives t
  where t.user_id = v_uid and not t.reussi and t.le > now() - interval '15 minutes';

  if v_echecs >= 5 then
    return jsonb_build_object('ouvert', false, 'raison', 'trop_d_essais',
                              'reessayer_apres', interval '15 minutes');
  end if;

  select * into v_secret from private.control_secrets s where s.nom = 'agora';

  /* Aucune empreinte posée = aucun code valide. On refuse, on ne laisse pas
     passer « parce que rien n'est configuré ». */
  /* `hmac(text, bytea, text)` N'EXISTE PAS dans pgcrypto — les surcharges sont
     (bytea, bytea, text) et (text, text, text). Le sel étant des octets bruts,
     le code doit l'être aussi : `convert_to(..., 'UTF8')`. Sans ce cast, la
     fonction lève 42883 à la première tentative, et le verrou refuse tout le
     monde y compris avec le bon code. Trouvé au premier test. */
  v_ok := v_secret.empreinte is not null
          and extensions.hmac(convert_to(coalesce(p_code, ''), 'UTF8'),
                              v_secret.sel, 'sha256') = v_secret.empreinte;

  insert into public.control_tentatives (user_id, reussi) values (v_uid, v_ok);

  if not v_ok then
    return jsonb_build_object('ouvert', false, 'raison', 'code',
                              'essais_restants', greatest(0, 4 - v_echecs));
  end if;

  v_expire := now() + public.agora_duree();
  insert into public.control_deverrouillages (user_id, ouvert_le, expire_le)
  values (v_uid, now(), v_expire)
  on conflict (user_id) do update set ouvert_le = now(), expire_le = v_expire;

  return jsonb_build_object('ouvert', true, 'expire_le', v_expire);
end;
$$;

comment on function public.agora_ouvrir(text) is
  'Vérifie le code AGORA côté serveur et ouvre la session pour douze heures. Ne rend jamais le code, son empreinte ni son sel.';


-- ===========================================================================
-- 5. FERMER — volontairement, sans attendre l'échéance
-- ===========================================================================

create or replace function public.agora_fermer()
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.control_deverrouillages d where d.user_id = (select auth.uid());
$$;


-- ===========================================================================
-- 6. L'ÉTAT, pour que l'écran sache quoi demander
--
--    Elle répond à tout le monde, y compris à qui n'est pas opérateur — et
--    c'est sans conséquence : elle ne dit rien d'autre que « cette session
--    est-elle ouverte », ce que l'appelant sait déjà de lui-même.
-- ===========================================================================

create or replace function public.agora_etat()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'connecte',  (select auth.uid()) is not null,
    'anonyme',   coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false),
    'operateur', exists (select 1 from public.control_operateurs o
                         where o.user_id = (select auth.uid()) and o.actif),
    'ouvert',    exists (select 1 from public.control_deverrouillages d
                         where d.user_id = (select auth.uid()) and d.expire_le > now()),
    'expire_le', (select d.expire_le from public.control_deverrouillages d
                  where d.user_id = (select auth.uid()) and d.expire_le > now())
  );
$$;


-- ===========================================================================
-- 7. `est_operateur()` EXIGE MAINTENANT LES TROIS CONDITIONS
--
--    identité (non anonyme) + autorisation (ligne opérateur) + verrou (code
--    entré, pas expiré). Une seule fonction, et les quinze policies du socle
--    suivent sans être touchées.
-- ===========================================================================

create or replace function public.est_operateur()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
    and exists (
      select 1 from public.control_operateurs o
      where o.user_id = (select auth.uid()) and o.actif
    )
    and exists (
      select 1 from public.control_deverrouillages d
      where d.user_id = (select auth.uid()) and d.expire_le > now()
    );
$$;

comment on function public.est_operateur() is
  'Vrai si la session est non anonyme, appartient à un opérateur actif, ET a entré le code AGORA dans les douze dernières heures. Seule porte d''entrée des policies du socle agents.';


-- ===========================================================================
-- 8. PRIVILÈGES
-- ===========================================================================

revoke all privileges on public.control_deverrouillages from anon, authenticated;
revoke all privileges on public.control_tentatives      from anon, authenticated;
alter table public.control_deverrouillages enable row level security;
alter table public.control_tentatives      enable row level security;

/* Aucune policy : personne ne lit ces tables directement. Le déverrouillage se
   fait par `agora_ouvrir`, et son état se lit par `agora_etat` — deux
   fonctions SECURITY DEFINER qui contrôlent exactement ce qui sort. */

revoke all privileges on function public.agora_ouvrir(text) from public, anon;
revoke all privileges on function public.agora_fermer()     from public, anon;
revoke all privileges on function public.agora_etat()       from public;
grant execute on function public.agora_ouvrir(text) to authenticated;
grant execute on function public.agora_fermer()     to authenticated;
grant execute on function public.agora_etat()       to anon, authenticated;
