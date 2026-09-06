-- ---------------------------------------------------------------------------
-- Preuve, en base, que l'inventaire des lieux tient ses promesses
--
-- CE QUE CE SCRIPT PROUVE
--
-- Les propriétés dont dépend tout le reste : qu'une resynchronisation ne
-- duplique pas, qu'un même lieu vu par deux catalogues n'en fait qu'un, que
-- deux homonymes éloignés restent deux, qu'un recalage de quelques mètres ne
-- casse pas l'identité, que le rattachement territorial ne fabrique aucune
-- zone, et qu'une image déjà connue survit à une source devenue muette.
--
-- IL S'EXÉCUTE SUR LA VRAIE BASE et nettoie ses propres lignes à la fin :
-- toutes portent une source `test_lot4%`, et la dernière instruction les
-- supprime. Rien ne reste dans l'inventaire.
--
-- Lancer :  psql "$DATABASE_URL" -f supabase/tests/lot4_inventaire_lieux.sql
-- ---------------------------------------------------------------------------

set search_path to public, topology;

create temp table preuves(cas text, attendu text, observe text, verdict text);

do $$
declare
  a uuid; b uuid; c uuid; d uuid; e uuid;
  r record; n int; k text[]; img text;
  terr_avant int; terr_apres int;
begin
  select count(*) into terr_avant from public.territories;

  -- 1. Un lieu inconnu entre dans l'inventaire.
  select place_id, action into r from public.places_ingerer(
    'test_lot4','A1','Théâtre de Test', 50.62920, 3.05730,
    '1 rue du Test', '59000', 'Lille', 'spectacle', 'Une salle de test.');
  a := r.place_id;
  insert into preuves values ('1 · insertion d''un nouveau lieu','cree', r.action,
    case when r.action='cree' and a is not null then 'OK' else 'ECHEC' end);

  -- 2. Le même `source` + `external_id` ne peut pas produire un second lieu.
  --    C'est le niveau 1, garanti par la contrainte d'unicité.
  select place_id, action into r from public.places_ingerer(
    'test_lot4','A1','Théâtre de Test', 50.62920, 3.05730);
  select count(*) into n from public.places where name_normalized='theatre test';
  insert into preuves values ('2 · resync même source+external_id','revu / 1 fiche',
    r.action||' / '||n||' fiche(s)',
    case when r.action='revu' and r.place_id=a and n=1 then 'OK' else 'ECHEC' end);

  -- 3 et 5. Une AUTRE source décrit le même lieu, sans accent, en minuscules,
  --    et douze mètres plus loin. Les trois signaux concordent : c'est lui.
  select place_id, action into r from public.places_ingerer(
    'test_lot4_bis','B1','theatre de test', 50.62931, 3.05730, null, null, 'Lille');
  b := r.place_id;
  insert into preuves values ('3 · même lieu, deux sources','rapproche / même id',
    r.action||' / '||(b=a)::text,
    case when r.action='rapproche' and b=a then 'OK' else 'ECHEC' end);
  insert into preuves values ('5 · lieu légèrement déplacé, même identité','même id',
    (b=a)::text, case when b=a then 'OK' else 'ECHEC' end);

  -- 4. Le même nom, neuf kilomètres plus loin, dans une autre commune : deux
  --    lieux. Les fusionner donnerait à l'un l'adresse de l'autre.
  select place_id, action into r from public.places_ingerer(
    'test_lot4','C1','Théâtre de Test', 50.69000, 3.17460, null, null, 'Roubaix', 'spectacle');
  c := r.place_id;
  insert into preuves values ('4 · homonymes éloignés non fusionnés','cree / id différent',
    r.action||' / '||(c<>a)::text,
    case when r.action='cree' and c<>a then 'OK' else 'ECHEC' end);

  -- 6. Le rattachement passe par la logique territoriale existante.
  select array_agg(distinct zone_id) into k from public.places where id in (a, c);
  insert into preuves values ('6 · rattachement à la zone mel','{mel}', k::text,
    case when k = array['mel'] then 'OK' else 'ECHEC' end);

  -- 7. Et il ne fabrique aucun territoire, jamais. C'est l'invariant du Lot 1,
  --    appliqué aux lieux comme il l'est aux adresses IP.
  select count(*) into terr_apres from public.territories;
  insert into preuves values ('7 · aucun territoire créé', terr_avant::text, terr_apres::text,
    case when terr_avant = terr_apres then 'OK' else 'ECHEC' end);

  -- 8. Une source qui revient sans image n'efface pas celle qu'on connaît.
  select place_id into d from public.places_ingerer(
    'test_lot4','D1','Musée de Test', 50.6300, 3.0600, null, null, 'Lille', 'musee',
    null, null, null, '{"image":"https://exemple/x.jpg","image_source":"datatourisme"}'::jsonb);
  perform public.places_ingerer('test_lot4','D1','Musée de Test', 50.6300, 3.0600);
  select image_refs->>'image' into img from public.places where id=d;
  insert into preuves values ('8 · image conservée après resync muette',
    'https://exemple/x.jpg', coalesce(img,'(vide)'),
    case when img='https://exemple/x.jpg' then 'OK' else 'ECHEC' end);

  -- 8bis. La clé d'enrichissement suit le lieu : c'est ce qui fait survivre
  --    `place_enrichments` à un recalage de coordonnées.
  select place_keys into k from public.places where id=a;
  insert into preuves values ('8bis · place_key conservée', '>= 1 clé',
    cardinality(k)::text||' clé(s)',
    case when cardinality(k) >= 1 then 'OK' else 'ECHEC' end);

  -- 9. Sans image, rien n'est fabriqué : l'écran retombe sur la tuile de
  --    catégorie, qui est la réponse honnête.
  select place_id into e from public.places_ingerer(
    'test_lot4','E1','Parc de Test', 50.6310, 3.0610, null, null, 'Lille', 'parc');
  select count(*) into n from public.places
   where id=e and image_url is null and image_refs = '{}'::jsonb;
  insert into preuves values ('9 · sans image : aucune URL fabriquée','1', n::text,
    case when n=1 then 'OK' else 'ECHEC' end);
end $$;


-- ---- Les droits : ce que le navigateur peut, et ce qu'il ne peut pas -------
grant all on preuves to anon, authenticated, service_role;

do $$
declare n int;
begin
  set local role anon;
  begin insert into public.places (name, lat, lng) values ('Injection', 50.6, 3.0);
    insert into preuves values ('10 · anon INSERT places','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('10 · anon INSERT places','refusé', sqlstate,'OK'); end;

  begin update public.places set name='x' where true;
    insert into preuves values ('10 · anon UPDATE places','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('10 · anon UPDATE places','refusé', sqlstate,'OK'); end;

  begin delete from public.places where true;
    insert into preuves values ('10 · anon DELETE places','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('10 · anon DELETE places','refusé', sqlstate,'OK'); end;

  begin select count(*) into n from public.place_sources;
    insert into preuves values ('10 · anon lit place_sources','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('10 · anon lit place_sources','refusé', sqlstate,'OK'); end;

  begin perform public.places_ingerer('x','y','z',50.6,3.0);
    insert into preuves values ('10 · anon appelle places_ingerer','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('10 · anon appelle places_ingerer','refusé', sqlstate,'OK'); end;

  -- Ce qu'il DOIT pouvoir faire : lire l'inventaire, comme n'importe quel
  -- visiteur. Une table fermée à ce point-là serait une panne, pas une
  -- protection.
  begin select count(*) into n from public.places;
    insert into preuves values ('11 · anon lit places','autorisé', n||' lignes',
      case when n > 0 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('11 · anon lit places','autorisé', sqlstate,'ECHEC'); end;

  begin select count(*) into n from public.lieux_locaux('mel',50.5,2.9,50.8,3.3,50);
    insert into preuves values ('11 · anon appelle lieux_locaux','autorisé', n||' lieux',
      case when n > 0 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('11 · anon appelle lieux_locaux','autorisé', sqlstate,'ECHEC'); end;
  reset role;

  set local role service_role;
  begin select count(*) into n from public.place_sources;
    insert into preuves values ('12 · service_role lit place_sources','autorisé', n||' lignes',
      case when n > 0 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('12 · service_role lit place_sources','autorisé', sqlstate,'ECHEC'); end;

  begin perform public.places_ingerer('test_lot4','F1','Lieu Service',50.6292,3.0573,
      null,null,'Lille');
    insert into preuves values ('12 · service_role ingère','autorisé','ACCEPTÉ','OK');
  exception when others then
    insert into preuves values ('12 · service_role ingère','autorisé', sqlstate,'ECHEC'); end;
  reset role;
end $$;

select * from preuves order by cas;

-- Le ménage. Les lignes de test ne survivent pas au script.
delete from public.places p
 where exists (select 1 from public.place_sources s
                where s.place_id = p.id and s.source like 'test_lot4%');
