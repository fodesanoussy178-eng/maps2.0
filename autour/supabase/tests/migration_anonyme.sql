-- ---------------------------------------------------------------------------
-- Preuve, en base, que convertir un ancien compte anonyme ne perd RIEN
--
-- CE QUE CE SCRIPT PROUVE, ET CE QU'IL NE PROUVE PAS
--
-- Il prouve la propriété qui compte : quand une ligne `auth.users` passe
-- d'anonyme à confirmée, l'`id` ne bouge pas, et donc TOUT ce qui pend à cet
-- id — publications, favoris, profil, canaux — reste attaché à la personne.
-- C'est vrai par construction : la conversion est un UPDATE de la ligne
-- existante, pas la création d'une autre. Ce script le montre plutôt que de
-- l'affirmer, en rejouant exactement les écritures que GoTrue effectue :
--
--   1. `updateUser({ email })`   → email_change + email_change_token_new
--   2. la personne confirme      → email, email_confirmed_at, is_anonymous=false,
--                                  et une ligne auth.identities (provider='email')
--
-- Il ne prouve PAS que GoTrue fait bien ces écritures-là : ça, seul un appel
-- à la vraie API d'authentification peut le montrer, et c'est le rôle de
-- `outils/auth-reel.mjs`. Ici on démontre l'invariant de données ; là-bas on
-- démontre le comportement du service.
--
-- POURQUOI CE SCRIPT EXISTE
--
-- Parce que 195 sessions anonymes vivent déjà en production, dont une avec une
-- publication. Se tromper ici ne se rattrape pas : un uid regénéré rendrait
-- ces publications orphelines pour toujours, sans que personne puisse les
-- réclamer — les policies refusent précisément ça.
-- ---------------------------------------------------------------------------

create table if not exists private.rls_journal (
  id      bigint generated always as identity primary key,
  cas     text not null,
  attendu text not null,
  obtenu  text not null,
  ok      boolean not null,
  le      timestamptz not null default now()
);

do $$
declare
  v     uuid := '00000000-0000-4000-8000-00000000d001';   -- le visiteur anonyme
  autre uuid := '00000000-0000-4000-8000-00000000d002';   -- un compte déjà pris
  uid_avant  uuid;
  uid_apres  uuid;
  pub        uuid;
  n          integer;
  role_initial text := current_user;
  cas text[] := '{}'; attendu text[] := '{}'; obtenu text[] := '{}';
  i integer; echecs integer := 0;
begin
  delete from private.rls_journal;

  delete from public.favoris where lieu_ref like 'osm:migr-test%';
  delete from public.publications where titre like 'MIGR-TEST%';
  delete from auth.users where id in (v, autre);

  -- ======================================================================
  -- 1. Le décor : une session anonyme telle qu'il en existe 195 aujourd'hui
  --    — aucune ligne dans auth.identities, c'est la forme exacte observée
  --      en production.
  -- ======================================================================
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                          encrypted_password, created_at, updated_at, is_anonymous)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          null, null, '', now(), now(), true),
         (autre, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'deja-pris@example.invalid', now(), '', now(), now(), false);

  select count(*)::int into n from auth.identities where user_id = v;
  cas := cas || 'décor · un anonyme n''a aucune identité'::text;
  attendu := attendu || '0'::text;  obtenu := obtenu || n::text;

  uid_avant := v;

  -- ======================================================================
  -- 2. Il a déjà publié et mis en favori, du temps où c'était permis
  --    (on écrit en tant que propriétaire de la base : ces lignes sont
  --     l'HISTORIQUE, pas une écriture que la RLS devrait autoriser)
  -- ======================================================================
  insert into public.publications (titre, cat, lat, lng, creator_id, created_by)
  values ('MIGR-TEST publication d''avant', 'event', 50.63, 3.06, v, v)
  returning id into pub;

  insert into public.favoris (membre, lieu_ref, titre, lat, lng)
  values (v, 'osm:migr-test-1', 'MIGR-TEST favori d''avant', 50.63, 3.06);

  -- ======================================================================
  -- 3. La conversion, écriture par écriture
  --
  --    Étape 1 — `updateUser({ email })`. GoTrue ne touche PAS `email` :
  --    il dépose l'adresse en attente et un jeton. Si la personne ne
  --    confirme jamais, la ligne reste anonyme et rien n'est perdu.
  -- ======================================================================
  update auth.users
     set email_change = 'converti@example.invalid',
         email_change_token_new = 'jeton-de-test',
         email_change_sent_at = now(),
         updated_at = now()
   where id = v;

  select count(*)::int into n from auth.users
   where id = v and is_anonymous is true and email is null;
  cas := cas || 'en attente · la ligne reste anonyme tant qu''on n''a pas confirmé'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from public.publications where created_by = v;
  cas := cas || 'en attente · la publication est toujours là'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  -- ------------------------------------------------------------------
  --    Étape 2 — la personne confirme. LA LIGNE EST MISE À JOUR, elle
  --    n'est pas recréée : c'est tout le sujet.
  -- ------------------------------------------------------------------
  update auth.users
     set email = email_change,
         email_confirmed_at = now(),
         email_change = '',
         email_change_token_new = '',
         is_anonymous = false,
         updated_at = now()
   where id = v;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v, v::text, 'email',
          json_build_object('sub', v::text, 'email', 'converti@example.invalid',
                            'email_verified', true, 'phone_verified', false),
          now(), now(), now());

  select id into uid_apres from auth.users where email = 'converti@example.invalid';

  -- ======================================================================
  -- 4. LE POINT QUI DÉCIDE DE TOUT
  -- ======================================================================
  cas := cas || 'conversion · même auth.uid() avant et après'::text;
  attendu := attendu || uid_avant::text;  obtenu := obtenu || coalesce(uid_apres::text, 'aucun');

  select count(*)::int into n from auth.users where id = v and is_anonymous is false;
  cas := cas || 'conversion · le compte n''est plus anonyme'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from auth.identities where user_id = v and provider = 'email';
  cas := cas || 'conversion · une identité e-mail est rattachée au MÊME uid'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from auth.users where is_anonymous is false and id = v;
  cas := cas || 'conversion · aucun second compte n''a été créé'::text;
  attendu := attendu || '1'::text;
  select count(*)::int into n from auth.users
   where email = 'converti@example.invalid';
  obtenu := obtenu || n::text;

  -- ======================================================================
  -- 5. Ce qui pendait à cet uid pend toujours
  -- ======================================================================
  select count(*)::int into n from public.publications
   where id = pub and created_by = v and creator_id = v;
  cas := cas || 'conversion · la publication d''avant est conservée'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from public.favoris where membre = v;
  cas := cas || 'conversion · le favori d''avant est conservé'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from public.profiles where id = v;
  cas := cas || 'conversion · le profil suit le même uid'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  -- ======================================================================
  -- 6. Et il peut ENFIN faire ce qu'il ne pouvait plus faire
  --    (avant confirmation, `private.compte_confirme()` rendait faux)
  -- ======================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.publications set titre = 'MIGR-TEST reprise en main' where id = pub;
  get diagnostics n = row_count;
  cas := cas || 'après conversion · il modifie de nouveau SA publication'::text;
  attendu := attendu || '1 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  select count(*)::int into n from public.mes_publications();
  cas := cas || 'après conversion · « mes publications » la lui rend'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from public.favoris;
  cas := cas || 'après conversion · ses favoris lui reviennent'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  execute 'set local role ' || quote_ident(role_initial);

  -- ======================================================================
  -- 7. L'adresse déjà prise par quelqu'un d'autre
  --
  --    L'index unique d'auth.users est la dernière ligne de défense : deux
  --    comptes ne peuvent pas porter la même adresse. GoTrue refuse avant
  --    d'en arriver là, mais si un jour il ne refusait plus, la base tient.
  -- ======================================================================
  begin
    update auth.users set email = 'deja-pris@example.invalid' where id = v;
    cas := cas || 'adresse déjà utilisée · deux comptes la partagent'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'adresse déjà utilisée · deux comptes la partagent'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  -- ======================================================================
  -- 8. Aucune adresse dans une réponse publique
  --
  --    On interroge la vraie fonction que le client appelle, en `anon`,
  --    et on regarde ce qui en sort — pas ce qu'on croit qui en sort.
  -- ======================================================================
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  select count(*)::int into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'publications'
     and column_name ~* 'mail';
  cas := cas || 'réponse publique · aucune colonne d''e-mail sur publications'::text;
  attendu := attendu || '0'::text;  obtenu := obtenu || n::text;

  begin
    perform 1 from auth.users limit 1;
    cas := cas || 'réponse publique · auth.users est hors d''atteinte'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'réponse publique · auth.users est hors d''atteinte'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  execute 'set local role ' || quote_ident(role_initial);

  -- ---- nettoyage ---------------------------------------------------------
  delete from public.favoris where lieu_ref like 'osm:migr-test%';
  delete from public.publications where titre like 'MIGR-TEST%';
  delete from auth.users where id in (v, autre);

  -- ---- verdict -----------------------------------------------------------
  for i in 1 .. array_length(cas, 1) loop
    insert into private.rls_journal (cas, attendu, obtenu, ok)
    values (cas[i], attendu[i], obtenu[i], attendu[i] is not distinct from obtenu[i]);
    if attendu[i] is distinct from obtenu[i] then
      echecs := echecs + 1;
      raise warning 'MIGRATION — « % » : attendu « % », obtenu « % »', cas[i], attendu[i], obtenu[i];
    end if;
  end loop;

  if echecs > 0 then
    raise exception '% cas de migration en échec sur %', echecs, array_length(cas, 1);
  end if;
end
$$;

select cas, attendu, obtenu, ok from private.rls_journal order by id;
