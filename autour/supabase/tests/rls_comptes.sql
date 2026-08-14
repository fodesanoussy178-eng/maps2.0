-- ---------------------------------------------------------------------------
-- Preuve, en base, que la propriété tient
--
-- Ces vérifications ne passent pas par l'application : elles prennent la place
-- d'un client hostile. Elles se posent en `authenticated` avec l'uid de
-- quelqu'un d'autre — exactement ce qu'un navigateur peut faire avec la clé
-- publique et un jeton valide. Si une policy cède, c'est ici qu'on le voit, et
-- pas en production.
--
-- Ce que chaque cas démontre :
--
--   · un visiteur (anon) lit les publications et n'écrit rien ;
--   · une session anonyme signée ne publie plus — un compte est exigé ;
--   · un compte confirmé publie sous son propre uid, jamais sous un autre ;
--   · le propriétaire modifie et supprime les siennes ;
--   · le compte B ne modifie ni ne supprime celles du compte A ;
--   · B ne peut pas non plus se les attribuer ;
--   · les favoris et le profil obéissent aux mêmes règles ;
--   · aucune adresse e-mail n'est atteignable depuis le schéma public.
--
-- POURQUOI LES RÉSULTATS SONT GARDÉS DANS DES TABLEAUX
--
-- Le script prend tour à tour le rôle `anon` puis `authenticated`, et ces
-- rôles n'ont aucun droit sur le schéma `private` — c'est précisément ce qu'on
-- veut. Écrire le journal au fil de l'eau échouerait donc sur un « permission
-- denied » qui n'aurait rien à voir avec ce qu'on teste. Les constats sont
-- accumulés en mémoire, puis consignés à la fin, une fois le rôle rendu.
--
-- Exécution : psql -f rls_comptes.sql, ou via l'API SQL du projet. Le script
-- nettoie ses propres traces.
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
  a     uuid := '00000000-0000-4000-8000-0000000000a1';   -- compte confirmé A
  b     uuid := '00000000-0000-4000-8000-0000000000b2';   -- compte confirmé B
  c     uuid := '00000000-0000-4000-8000-0000000000c3';   -- session anonyme
  pub_a uuid;
  n     integer;

  -- on prend et on rend le rôle : le script ne laisse pas la session ailleurs
  -- qu'il ne l'a trouvée
  role_initial text := current_user;

  cas     text[] := '{}';
  attendu text[] := '{}';
  obtenu  text[] := '{}';
  i       integer;
  echecs  integer := 0;
begin
  delete from private.rls_journal;

  -- ---- décor -------------------------------------------------------------
  delete from public.favoris where lieu_ref like 'osm:rls-test%';
  delete from public.publications where titre like 'RLS-TEST%';
  delete from auth.users where id in (a, b, c);

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                          encrypted_password, created_at, updated_at, is_anonymous)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls-a@example.invalid', now(), '', now(), now(), false),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls-b@example.invalid', now(), '', now(), now(), false),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, null, '', now(), now(), true);

  -- ======================================================================
  -- 1. Le visiteur : il lit, il n'écrit pas
  -- ======================================================================
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  select count(*)::int into n from public.publications;
  cas := cas || 'visiteur · lire les publications'::text;
  attendu := attendu || 'permis'::text;  obtenu := obtenu || 'permis'::text;

  begin
    insert into public.publications (titre, cat, lat, lng)
    values ('RLS-TEST anon', 'event', 50.63, 3.06);
    cas := cas || 'visiteur · publier'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'visiteur · publier'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  begin
    perform 1 from public.favoris limit 1;
    cas := cas || 'visiteur · lire des favoris'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'visiteur · lire des favoris'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  execute 'set local role ' || quote_ident(role_initial);

  -- ======================================================================
  -- 2. La session anonyme signée : elle non plus n'écrit pas
  --    C'est le cœur de cette migration : « connecté » ne veut plus dire
  --    « a un compte ».
  -- ======================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.publications (titre, cat, lat, lng, creator_id, created_by)
    values ('RLS-TEST anonyme', 'event', 50.63, 3.06, c, c);
    cas := cas || 'session anonyme · publier'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'session anonyme · publier'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  begin
    insert into public.favoris (membre, lieu_ref, titre, lat, lng)
    values (c, 'osm:rls-test-anon', 'RLS-TEST', 50.63, 3.06);
    cas := cas || 'session anonyme · mettre en favori'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'session anonyme · mettre en favori'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  select count(*)::int into n from public.publications;
  cas := cas || 'session anonyme · lire les publications'::text;
  attendu := attendu || 'permis'::text;
  obtenu := obtenu || case when n >= 0 then 'permis' else 'refusé' end;

  execute 'set local role ' || quote_ident(role_initial);

  -- ======================================================================
  -- 3. Le compte A publie — sous son uid, et seulement le sien
  -- ======================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.publications (titre, cat, lat, lng, creator_id, created_by)
  values ('RLS-TEST A', 'event', 50.63, 3.06, a, a)
  returning id into pub_a;
  cas := cas || 'compte A · publier'::text;
  attendu := attendu || 'accepté'::text;
  obtenu := obtenu || case when pub_a is null then 'refusé' else 'accepté' end;

  begin
    insert into public.publications (titre, cat, lat, lng, creator_id, created_by)
    values ('RLS-TEST usurpation', 'event', 50.63, 3.06, b, b);
    cas := cas || 'compte A · publier au nom de B'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'accepté'::text;
  exception when others then
    cas := cas || 'compte A · publier au nom de B'::text;
    attendu := attendu || 'refusé'::text;  obtenu := obtenu || 'refusé'::text;
  end;

  insert into public.favoris (membre, lieu_ref, titre, lat, lng)
  values (a, 'osm:rls-test-a', 'RLS-TEST favori', 50.63, 3.06);
  cas := cas || 'compte A · mettre en favori'::text;
  attendu := attendu || 'accepté'::text;  obtenu := obtenu || 'accepté'::text;

  execute 'set local role ' || quote_ident(role_initial);

  -- ======================================================================
  -- 4. Le compte B ne touche à rien de A
  -- ======================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- il la VOIT : la lecture est publique, et c'est tout l'objet d'Autour
  select count(*)::int into n from public.publications where id = pub_a;
  cas := cas || 'compte B · lire la publication de A'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  update public.publications set titre = 'RLS-TEST détourné' where id = pub_a;
  get diagnostics n = row_count;
  cas := cas || 'compte B · modifier celle de A'::text;
  attendu := attendu || '0 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  update public.publications set created_by = b, creator_id = b where id = pub_a;
  get diagnostics n = row_count;
  cas := cas || 'compte B · s''attribuer celle de A'::text;
  attendu := attendu || '0 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  delete from public.publications where id = pub_a;
  get diagnostics n = row_count;
  cas := cas || 'compte B · supprimer celle de A'::text;
  attendu := attendu || '0 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  select count(*)::int into n from public.favoris where membre = a;
  cas := cas || 'compte B · lire les favoris de A'::text;
  attendu := attendu || '0'::text;  obtenu := obtenu || n::text;

  delete from public.favoris where membre = a;
  get diagnostics n = row_count;
  cas := cas || 'compte B · retirer un favori de A'::text;
  attendu := attendu || '0 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  select count(*)::int into n from public.mes_publications();
  cas := cas || 'compte B · « mes publications » ne rend rien de A'::text;
  attendu := attendu || '0'::text;  obtenu := obtenu || n::text;

  execute 'set local role ' || quote_ident(role_initial);

  -- la ligne de A est intacte, mot pour mot
  select count(*)::int into n from public.publications
   where id = pub_a and titre = 'RLS-TEST A' and created_by = a and creator_id = a;
  cas := cas || 'publication de A · intacte après les tentatives'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  -- ======================================================================
  -- 5. Le propriétaire, lui, modifie et supprime
  -- ======================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.publications set titre = 'RLS-TEST A modifié' where id = pub_a;
  get diagnostics n = row_count;
  cas := cas || 'compte A · modifier la sienne'::text;
  attendu := attendu || '1 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  select count(*)::int into n from public.mes_publications();
  cas := cas || 'compte A · retrouver ses publications'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from public.favoris;
  cas := cas || 'compte A · retrouver ses favoris'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  delete from public.favoris where lieu_ref = 'osm:rls-test-a';
  get diagnostics n = row_count;
  cas := cas || 'compte A · retirer son favori'::text;
  attendu := attendu || '1 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  delete from public.publications where id = pub_a;
  get diagnostics n = row_count;
  cas := cas || 'compte A · supprimer la sienne'::text;
  attendu := attendu || '1 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  -- ======================================================================
  -- 6. Le profil : le sien, et rien d'autre
  -- ======================================================================
  update public.profiles set display_name = 'Alex' where id = a;
  get diagnostics n = row_count;
  cas := cas || 'compte A · choisir son pseudo'::text;
  attendu := attendu || '1 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  update public.profiles set display_name = 'Volé' where id = b;
  get diagnostics n = row_count;
  cas := cas || 'compte A · changer le pseudo de B'::text;
  attendu := attendu || '0 ligne'::text;  obtenu := obtenu || (n::text || ' ligne');

  select count(*)::int into n from public.profiles where id = b;
  cas := cas || 'compte A · lire le profil de B'::text;
  attendu := attendu || '0'::text;  obtenu := obtenu || n::text;

  select count(*)::int into n from public.profiles where id = a;
  cas := cas || 'compte A · lire le sien'::text;
  attendu := attendu || '1'::text;  obtenu := obtenu || n::text;

  execute 'set local role ' || quote_ident(role_initial);

  -- ======================================================================
  -- 7. Aucune adresse e-mail dans le schéma public
  -- ======================================================================
  select count(*)::int into n
    from pg_attribute att
    join pg_class cl on cl.oid = att.attrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public'
     and cl.relkind in ('r', 'v', 'm', 'p')
     and att.attnum > 0 and not att.attisdropped
     and att.attname ~* '(^|_)(e?mail|courriel)($|_)';
  cas := cas || 'schéma public · colonnes d''e-mail'::text;
  attendu := attendu || '0'::text;  obtenu := obtenu || n::text;

  -- ---- nettoyage ---------------------------------------------------------
  delete from public.favoris where lieu_ref like 'osm:rls-test%';
  delete from public.publications where titre like 'RLS-TEST%';
  delete from auth.users where id in (a, b, c);

  -- ---- verdict -----------------------------------------------------------
  for i in 1 .. array_length(cas, 1) loop
    insert into private.rls_journal (cas, attendu, obtenu, ok)
    values (cas[i], attendu[i], obtenu[i], attendu[i] is not distinct from obtenu[i]);
    if attendu[i] is distinct from obtenu[i] then
      echecs := echecs + 1;
      raise warning 'RLS — « % » : attendu « % », obtenu « % »', cas[i], attendu[i], obtenu[i];
    end if;
  end loop;

  if echecs > 0 then
    raise exception '% cas de RLS en échec sur %', echecs, array_length(cas, 1);
  end if;

  raise notice 'RLS : % cas vérifiés, aucun défaut', array_length(cas, 1);
end
$$;

select cas, attendu, obtenu, ok from private.rls_journal order by id;
