-- ---------------------------------------------------------------------------
-- Preuve, en base, que l'enrichissement de l'inventaire tient ses promesses
--
-- LES EXEMPLES SONT RÉELS ET MÉTROPOLITAINS. Un parc de Villeneuve-d'Ascq
-- décrit deux fois, deux brasseries lilloises voisines, un bistrot isolé à
-- Lambersart : ce sont les trois situations qui décident si le rayon dépendant
-- de la famille marche ou non.
--
-- Il s'exécute sur la vraie base et supprime ses lignes à la fin — toutes
-- portent une source `test4bis%`.
--
-- Lancer :  psql "$DATABASE_URL" -f supabase/tests/lot4bis_enrichissement_lieux.sql
-- ---------------------------------------------------------------------------

set search_path to public, topology;

create temp table preuves(cas text, attendu text, observe text, verdict text);

do $$
declare a uuid; b uuid; c uuid; r record; n int;
begin
  -- ---- LE RAYON ÉTENDU : deux relevés du même parc ------------------------
  -- 300 m d'écart. Sous l'ancien rayon fixe de 120 m, deux parcs ; sous le
  -- rayon de la famille `nature` (400 m, la valeur de `core.js`), un seul.
  select place_id into a from public.places_ingerer(
    'test4bis','P1','Parc du Heron Essai', 50.62200, 3.14000, null, null, 'Villeneuve-d''Ascq');
  select place_id, action into r from public.places_ingerer(
    'test4bis','P2','Parc du Heron Essai', 50.62470, 3.14000, null, null, 'Villeneuve-d''Ascq');
  insert into preuves values ('MEL · parc, 300 m : un seul parc','rapproche / même id',
    r.action||' / '||(r.place_id=a)::text,
    case when r.action='rapproche' and r.place_id=a then 'OK' else 'ECHEC' end);

  -- Et le rayon étendu reste un rayon : à 600 m, on ne fusionne plus.
  select place_id, action into r from public.places_ingerer(
    'test4bis','P3','Parc du Heron Essai', 50.62740, 3.14000, null, null, 'Villeneuve-d''Ascq');
  insert into preuves values ('MEL · parc, 600 m : au-delà du rayon étendu','cree',
    r.action, case when r.action='cree' then 'OK' else 'ECHEC' end);

  -- ---- LE RAYON SERRÉ : deux commerces voisins ne sont pas un seul --------
  -- 150 m d'écart, même enseigne : sous un rayon étendu on les aurait fondus,
  -- et l'un aurait hérité de l'adresse de l'autre.
  select place_id into b from public.places_ingerer(
    'test4bis','R1','Brasserie Essai Lilloise', 50.63000, 3.06000, null, null, 'Lille');
  select place_id, action into r from public.places_ingerer(
    'test4bis','R2','Brasserie Essai Lilloise', 50.63135, 3.06000, null, null, 'Lille');
  insert into preuves values ('MEL · restaurants, 150 m : deux commerces','cree / id différent',
    r.action||' / '||(r.place_id<>b)::text,
    case when r.action='cree' and r.place_id<>b then 'OK' else 'ECHEC' end);

  -- ---- Le même commerce à 90 m, seul dans son voisinage ------------------
  select place_id into c from public.places_ingerer(
    'test4bis','R4','Bistrot Essai Solitaire', 50.65000, 3.02000, null, null, 'Lambersart');
  select place_id, action into r from public.places_ingerer(
    'test4bis','R5','Bistrot Essai Solitaire', 50.65081, 3.02000, null, null, 'Lambersart');
  insert into preuves values ('MEL · restaurant, 90 m : un seul commerce','rapproche / même id',
    r.action||' / '||(r.place_id=c)::text,
    case when r.action='rapproche' and r.place_id=c then 'OK' else 'ECHEC' end);

  -- ---- Le doute ne fusionne toujours pas ---------------------------------
  -- Un troisième relevé à portée des DEUX brasseries : deux candidats, donc
  -- aucune fusion. Une fiche de plus se voit ; une fusion fautive, non.
  select place_id, action into r from public.places_ingerer(
    'test4bis','R6','Brasserie Essai Lilloise', 50.63068, 3.06000, null, null, 'Lille');
  insert into preuves values ('MEL · deux candidats à portée : aucune fusion','ambigu',
    r.action, case when r.action='ambigu' then 'OK' else 'ECHEC' end);

  -- ---- LES RAYONS VIENNENT DE `core.js`, PAS D'ICI ------------------------
  insert into preuves values ('rayon nature / rayon restauration','400 / 120',
    public.place_rayon_rapprochement('nature')||' / '||public.place_rayon_rapprochement('restauration'),
    case when public.place_rayon_rapprochement('nature')=400
          and public.place_rayon_rapprochement('restauration')=120 then 'OK' else 'ECHEC' end);

  -- ---- LA CLASSIFICATION NE DEVINE PAS -----------------------------------
  insert into preuves values ('type Museum -> culture','culture',
    coalesce(public.place_famille_depuis_types('PointOfInterest Museum CulturalSite'),'(null)'),
    case when public.place_famille_depuis_types('PointOfInterest Museum CulturalSite')='culture'
         then 'OK' else 'ECHEC' end);
  insert into preuves values ('type inconnu -> non classé','(null)',
    coalesce(public.place_famille_depuis_types('PointOfInterest Truc'),'(null)'),
    case when public.place_famille_depuis_types('PointOfInterest Truc') is null
         then 'OK' else 'ECHEC' end);
  insert into preuves values ('« Le Grand Sud » -> non classé','(null)',
    coalesce(public.place_famille_depuis_nom('Le Grand Sud'),'(null)'),
    case when public.place_famille_depuis_nom('Le Grand Sud') is null then 'OK' else 'ECHEC' end);
  insert into preuves values ('« Médiathèque Jean Lévy » -> bibliotheque','bibliotheque',
    coalesce(public.place_famille_depuis_nom('Médiathèque Jean Lévy'),'(null)'),
    case when public.place_famille_depuis_nom('Médiathèque Jean Lévy')='bibliotheque'
         then 'OK' else 'ECHEC' end);

  -- ---- LES IMAGES DISENT CE QU'ELLES SONT --------------------------------
  select count(*) into n from public.places
   where image_url is not null and image_type is distinct from 'event_poster';
  insert into preuves values ('toute image reprise est étiquetée event_poster','0 autre type',
    n::text, case when n=0 then 'OK' else 'ECHEC' end);
  select count(*) into n from public.places
   where image_url is not null and nullif(btrim(coalesce(image_license,'')),'') is null;
  insert into preuves values ('toute image porte sa licence','0 sans licence', n::text,
    case when n=0 then 'OK' else 'ECHEC' end);
  select count(*) into n from public.places where image_source = 'google_places';
  insert into preuves values ('aucune image Google dans l''inventaire','0', n::text,
    case when n=0 then 'OK' else 'ECHEC' end);

  -- ---- RIEN N'EST FABRIQUÉ -----------------------------------------------
  select count(*) into n from public.places where opening_hours is not null;
  insert into preuves values ('aucun horaire inventé','0 tant que les sources n''en donnent pas',
    n::text, case when n=0 then 'OK' else 'ECHEC' end);
  select count(*) into n from public.territories;
  insert into preuves values ('aucun territoire créé','60', n::text,
    case when n=60 then 'OK' else 'ECHEC' end);
end $$;


-- ---- LES DROITS : la récolte n'est pas une donnée de produit --------------
grant all on preuves to anon, authenticated, service_role;

do $$
declare n int;
begin
  set local role anon;
  -- Une vue s'exécute avec les droits de son propriétaire : sans révocation,
  -- `place_pavage_mel` ouvrait `mel_communes` à tout le monde.
  begin select count(*) into n from public.place_pavage_mel;
    insert into preuves values ('anon lit place_pavage_mel','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit place_pavage_mel','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.mel_communes;
    insert into preuves values ('anon lit mel_communes','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit mel_communes','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.place_recoltes;
    insert into preuves values ('anon lit place_recoltes','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit place_recoltes','refusé', sqlstate,'OK'); end;
  begin insert into public.place_familles (famille,label) values ('x','x');
    insert into preuves values ('anon écrit place_familles','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon écrit place_familles','refusé', sqlstate,'OK'); end;
  for n in select 1 loop exit; end loop;
  begin perform public.places_classer(true);
    insert into preuves values ('anon appelle places_classer','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle places_classer','refusé', sqlstate,'OK'); end;
  begin perform public.places_recolter_mel(1);
    insert into preuves values ('anon appelle places_recolter_mel','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle places_recolter_mel','refusé', sqlstate,'OK'); end;
  begin perform public.places_rapprocher_doublons(true);
    insert into preuves values ('anon appelle places_rapprocher_doublons','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle places_rapprocher_doublons','refusé', sqlstate,'OK'); end;

  -- Ce qu'anon doit pouvoir faire : lire l'inventaire et ses familles.
  begin select count(*) into n from public.place_familles;
    insert into preuves values ('anon lit place_familles','autorisé', n||' familles',
      case when n = 13 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit place_familles','autorisé', sqlstate,'ECHEC'); end;
  begin select total into n from public.places_qualite;
    insert into preuves values ('anon lit places_qualite','autorisé', n||' lieux',
      case when n > 0 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit places_qualite','autorisé', sqlstate,'ECHEC'); end;
  reset role;
end $$;

select * from preuves order by cas;

delete from public.places p
 where exists (select 1 from public.place_sources s
                where s.place_id = p.id and s.source like 'test4bis%');
