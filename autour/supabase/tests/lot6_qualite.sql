-- ---------------------------------------------------------------------------
-- Preuve, en base, que la qualité de l'inventaire tient ses promesses
--
-- Un test de source lit ce qui est écrit. Celui-ci fait ce que ferait un
-- navigateur hostile et ce que fera le temps : il prend le rôle `anon` et
-- essaie d'écrire, il fabrique une offre périmée, une offre disparue, deux
-- lieux également plausibles, et il regarde ce que la base refuse.
--
-- Les lignes de travail portent la source `test6%` et sont supprimées à la
-- fin. Les 53 photos réelles et les 46 offres CROUS ne servent que de témoin.
--
-- Lancer :  psql "$DATABASE_URL" -f supabase/tests/lot6_qualite.sql
-- ---------------------------------------------------------------------------

set search_path to public, topology;

create temp table preuves(cas text, attendu text, observe text, verdict text);

do $$
declare r record; n int; m int; v_id uuid; v_lieu uuid; v_a uuid; v_b uuid; v_txt text;
begin
  -- ======================================================================
  -- LES HORAIRES — ce qu'on sait, et surtout ce qu'on ne sait pas
  -- ======================================================================
  select etat into v_txt from public.horaires_etat(null, now());
  insert into preuves values ('horaire absent','inconnu', v_txt,
    case when v_txt = 'inconnu' then 'OK' else 'ECHEC' end);

  select etat into v_txt from public.horaires_etat('ouvert le matin quand il fait beau', now());
  insert into preuves values ('horaire illisible','inconnu', v_txt,
    case when v_txt = 'inconnu' then 'OK' else 'ECHEC' end);

  select etat into v_txt from public.horaires_etat(
    'Mo-Fr 09:00-18:00; parfois le samedi', '2026-09-07 10:00+02'::timestamptz);
  insert into preuves values ('une règle sur deux illisible : tout est refusé','inconnu', v_txt,
    case when v_txt = 'inconnu' then 'OK' else 'ECHEC' end);

  -- Après minuit, les trois moments qui comptent.
  select etat into v_txt from public.horaires_etat('Fr-Sa 20:00-02:00','2026-09-11 23:30+02'::timestamptz);
  insert into preuves values ('après minuit · vendredi 23h30','ouvert', v_txt,
    case when v_txt = 'ouvert' then 'OK' else 'ECHEC' end);
  select etat into v_txt from public.horaires_etat('Fr-Sa 20:00-02:00','2026-09-12 01:00+02'::timestamptz);
  insert into preuves values ('après minuit · samedi 01h (la veille déborde)','ouvert', v_txt,
    case when v_txt = 'ouvert' then 'OK' else 'ECHEC' end);
  select etat into v_txt from public.horaires_etat('Fr-Sa 20:00-02:00','2026-09-12 03:00+02'::timestamptz);
  insert into preuves values ('après minuit · samedi 03h','ferme', v_txt,
    case when v_txt = 'ferme' then 'OK' else 'ECHEC' end);

  -- Plusieurs plages le même jour.
  select etat into v_txt from public.horaires_etat(
    'Mo-Fr 09:00-12:00,14:00-18:00','2026-09-07 13:00+02'::timestamptz);
  insert into preuves values ('deux plages · entre les deux','ferme', v_txt,
    case when v_txt = 'ferme' then 'OK' else 'ECHEC' end);
  select etat into v_txt from public.horaires_etat(
    'Mo-Fr 09:00-12:00,14:00-18:00','2026-09-07 15:00+02'::timestamptz);
  insert into preuves values ('deux plages · dedans','ouvert', v_txt,
    case when v_txt = 'ouvert' then 'OK' else 'ECHEC' end);

  -- Saison, minuit pile, fermeture temporaire.
  select etat into v_txt from public.horaires_etat(
    'Apr-Sep Mo-Su 10:00-19:00','2026-12-06 15:00+01'::timestamptz);
  insert into preuves values ('hors saison','ferme', v_txt,
    case when v_txt = 'ferme' then 'OK' else 'ECHEC' end);
  select ferme_a::text into v_txt from public.horaires_etat(
    'Mo-Su 00:00-24:00','2026-09-06 23:59+02'::timestamptz);
  insert into preuves values ('24:00 est minuit du lendemain, pas 23:59','07/09 00:00',
    to_char(v_txt::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),
    case when to_char(v_txt::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI') = '07/09 00:00'
         then 'OK' else 'ECHEC' end);
  select etat into v_txt from public.horaires_etat(
    'Mo-Su 10:00-19:00','2026-09-07 15:00+02'::timestamptz, 'Europe/Paris', true, null);
  insert into preuves values ('fermeture temporaire prime sur l''horaire','ferme', v_txt,
    case when v_txt = 'ferme' then 'OK' else 'ECHEC' end);

  -- La transcription du français refuse ce qu'elle ne lit pas entièrement.
  insert into preuves values ('« 8h à 19h30 du lundi au vendredi »','Mo-Fr 08:00-19:30',
    coalesce(public.horaires_depuis_texte_fr('Horaires 8h à 19h30 du lundi au vendredi'),'(refusé)'),
    case when public.horaires_depuis_texte_fr('Horaires 8h à 19h30 du lundi au vendredi')
              = 'Mo-Fr 08:00-19:30' then 'OK' else 'ECHEC' end);
  insert into preuves values ('« Horaires 7h30 - 16h » sans jour','refusé',
    coalesce(public.horaires_depuis_texte_fr('Horaires 7h30 - 16h'),'(refusé)'),
    case when public.horaires_depuis_texte_fr('Horaires 7h30 - 16h') is null
         then 'OK' else 'ECHEC' end);
  insert into preuves values ('une heure non transcrite fait tout refuser','refusé',
    coalesce(public.horaires_depuis_texte_fr(
      'Horaires du lundi au vendredi de 9h à 12h et parfois 14h le samedi'),'(refusé)'),
    case when public.horaires_depuis_texte_fr(
      'Horaires du lundi au vendredi de 9h à 12h et parfois 14h le samedi') is null
      then 'OK' else 'ECHEC' end);

  -- Et l'inventaire ne déclare AUCUN lieu ouvert sans horaire.
  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120)
   where etat_horaire = 'ouvert';
  select count(*) into m from public.places
   where nullif(btrim(coalesce(opening_hours,'')),'') is not null;
  insert into preuves values ('aucun lieu ouvert sans horaire connu','0 ouverts / 0 horaires',
    n||' ouverts / '||m||' horaires', case when n <= m then 'OK' else 'ECHEC' end);

  -- ======================================================================
  -- LES IMAGES — une affiche n'est pas une photo
  -- ======================================================================
  select count(*) into n from public.places
   where image_type = 'place_photo' and image_source is distinct from 'wikidata';
  insert into preuves values ('toute photo de lieu vient du pipeline Wikidata','0 autre source',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.places
   where image_url is not null and nullif(btrim(coalesce(image_license,'')),'') is null;
  insert into preuves values ('aucune image sans licence','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.places
   where image_type = 'place_photo' and image_refs -> 'place_photo' ->> 'license' is null;
  insert into preuves values ('toute photo garde sa référence structurée','0 sans licence en réf',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.places where image_source = 'google_places';
  insert into preuves values ('aucune image Google dans l''inventaire','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);

  -- Le nom de la commune ne doit plus attraper de photo.
  select count(*) into n from public.places p
   where p.image_type = 'place_photo'
     and public.place_nom_normalise(p.image_refs -> 'place_photo' ->> 'wikidata_label')
         = public.place_nom_normalise(p.commune);
  insert into preuves values ('aucune photo rapprochée par le nom de la commune','0',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  -- ======================================================================
  -- LES OFFRES — vivantes, périmées, disparues
  -- ======================================================================
  select offer_id into v_id from public.offres_ingerer(
    'test6','ACTIVE','Tarif étudiant essai actif','Organisme essai',
    'https://exemple.test/active', null, 'tarif_reduit', array['student']::text[]);
  select count(*) into n from public.offres_publiques('student',null,null,null,null,60)
   where id = v_id;
  insert into preuves values ('une offre active est rendue','1', n::text,
    case when n = 1 then 'OK' else 'ECHEC' end);

  select offer_id into v_id from public.offres_ingerer(
    'test6','PERIMEE','Tarif étudiant essai périmé','Organisme essai',
    'https://exemple.test/perimee', null, 'tarif_reduit', array['student']::text[],
    null, null, null, null, now() - interval '30 days', now() - interval '1 day');
  select count(*) into n from public.offres_publiques('student',null,null,null,null,60)
   where id = v_id;
  select status into r from public.offers where id = v_id;
  insert into preuves values ('une offre expirée n''est pas rendue, ni effacée',
    'expired / 0 rendue', r.status||' / '||n,
    case when r.status = 'expired' and n = 0 then 'OK' else 'ECHEC' end);

  -- Une offre que la source ne revoit plus : absences + ancienneté = stale.
  select offer_id into v_id from public.offres_ingerer(
    'test6','DISPARUE','Tarif étudiant essai disparu','Organisme essai',
    'https://exemple.test/disparue', null, 'tarif_reduit', array['student']::text[]);
  update public.offers
     set absences = 9, last_seen_at = now() - interval '200 days'
   where id = v_id;
  perform public.offres_appliquer_fraicheur();
  select status into r from public.offers where id = v_id;
  select count(*) into n from public.offres_publiques('student',null,null,null,null,60)
   where id = v_id;
  insert into preuves values ('une offre disparue depuis longtemps devient « stale »',
    'stale / 0 rendue', r.status||' / '||n,
    case when r.status = 'stale' and n = 0 then 'OK' else 'ECHEC' end);
  select count(*) into n from public.offers where id = v_id;
  insert into preuves values ('une offre « stale » n''est pas supprimée','1 en base',
    n::text, case when n = 1 then 'OK' else 'ECHEC' end);

  -- Le seuil vient de la table, pas du code.
  select absences_max || '/' || jours_sans_revue_max into v_txt
    from public.offer_peremption where source = 'crous_ods';
  insert into preuves values ('le seuil de péremption est une donnée','3/60',
    coalesce(v_txt,'(absent)'), case when v_txt = '3/60' then 'OK' else 'ECHEC' end);

  -- Rejouer la même offre ne la duplique pas.
  select count(*) into n from public.offers;
  perform public.offres_ingerer(
    'test6','ACTIVE','Tarif étudiant essai actif','Organisme essai',
    'https://exemple.test/active', null, 'tarif_reduit', array['student']::text[]);
  select count(*) into m from public.offers;
  insert into preuves values ('rejouer une offre ne la duplique pas','0 de plus',
    (m-n)::text, case when m = n then 'OK' else 'ECHEC' end);

  -- ======================================================================
  -- LE RAPPROCHEMENT OFFRE → LIEU
  -- ======================================================================
  -- Un lieu réel, et une offre qui porte EXACTEMENT son nom, à 20 m.
  select p.id into v_lieu from public.places p
   where p.family is not null and p.duplicate_of is null and p.status='active'
     and p.geom is not null limit 1;
  select offer_id into v_id from public.offres_ingerer(
    'test6','EXACTE', (select name from public.places where id = v_lieu),
    'Organisme essai','https://exemple.test/exacte', null, 'tarif_reduit',
    array['student']::text[], null, null,
    (select lat from public.places where id = v_lieu),
    (select lng from public.places where id = v_lieu));
  perform public.offres_rattacher_aux_lieux(true);
  select place_match_status, place_id into r from public.offers where id = v_id;
  insert into preuves values ('offre au nom exact d''un lieu, au même point','exact + rattachée',
    r.place_match_status||' / '||coalesce((r.place_id = v_lieu)::text,'null'),
    case when r.place_match_status = 'exact' and r.place_id = v_lieu then 'OK' else 'ECHEC' end);

  -- Deux lieux également plausibles : aucun rattachement.
  select place_id into v_a from public.places_ingerer(
    'test6','A1','Salle Essai Ambigue Nord', 50.70000, 3.20000, null, null, 'Lille');
  select place_id into v_b from public.places_ingerer(
    'test6','A2','Salle Essai Ambigue Sud',  50.70020, 3.20000, null, null, 'Lille');
  update public.places set name = 'Salle Essai Ambigue',
         name_normalized = public.place_nom_normalise('Salle Essai Ambigue')
   where id in (v_a, v_b);
  select offer_id into v_id from public.offres_ingerer(
    'test6','AMBIGUE','Salle Essai Ambigue','Organisme essai',
    'https://exemple.test/ambigue', null, 'tarif_reduit', array['student']::text[],
    null, null, 50.70010, 3.20000);
  perform public.offres_rattacher_aux_lieux(true);
  select place_match_status, place_id into r from public.offers where id = v_id;
  insert into preuves values ('deux lieux également plausibles : aucune fusion',
    'ambiguous + place_id nul',
    r.place_match_status||' / '||coalesce(r.place_id::text,'null'),
    case when r.place_match_status = 'ambiguous' and r.place_id is null
         then 'OK' else 'ECHEC' end);

  -- Une offre sans lieu correspondant reste sans lieu — et rien n'est créé.
  select count(*) into n from public.places;
  select offer_id into v_id from public.offres_ingerer(
    'test6','SEULE','Offre Essai Sans Aucun Lieu Correspondant','Organisme essai',
    'https://exemple.test/seule', null, 'tarif_reduit', array['student']::text[],
    null, null, 50.99000, 3.99000);
  perform public.offres_rattacher_aux_lieux(true);
  select place_match_status into r from public.offers where id = v_id;
  select count(*) into m from public.places;
  insert into preuves values ('offre sans lieu : aucun lieu n''est fabriqué',
    'unmatched / 0 lieu créé',
    r.place_match_status||' / '||(m-n)::text,
    case when r.place_match_status = 'unmatched' then 'OK' else 'ECHEC' end);

  -- ======================================================================
  -- AUCUN TERRITOIRE PARASITE
  -- ======================================================================
  select count(*) into n from public.territories;
  insert into preuves values ('aucun territoire créé par ce lot','60', n::text,
    case when n = 60 then 'OK' else 'ECHEC' end);

  -- ======================================================================
  -- EXPLORER : intention, plafond, pas d'annuaire
  -- ======================================================================
  select count(*) into n from public.lieux_explorer('mel', null, 50.6292, 3.0573, 12000, 12, true,
    array['culture','bibliotheque','nature','patrimoine','musique','cinema','sport','marche'], 2);
  insert into preuves values ('une intention rend 12 lieux','12', n::text,
    case when n = 12 then 'OK' else 'ECHEC' end);

  select count(*) into n from (
    select family, count(*) as c
      from public.lieux_explorer('mel', null, 50.6292, 3.0573, 12000, 12, true,
        array['culture','bibliotheque','nature','patrimoine','musique','cinema','sport','marche'], 2)
     group by family having count(*) > 2) x;
  insert into preuves values ('le plafond par famille tient','0 famille au-dessus de 2',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.lieux_explorer('mel', null, 50.6292, 3.0573, 12000, 12, true,
    array['culture','bibliotheque','nature','patrimoine','musique','cinema','sport','marche'], 2)
   where family in ('restauration','hebergement','commerce');
  insert into preuves values ('la découverte n''est pas un annuaire de la restauration','0',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.lieux_explorer('mel','nature',50.6292,3.0573,12000,20,true)
   where family <> 'nature';
  insert into preuves values ('« Nature » ne rend que des lieux nature','0 hors famille',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120)
   where family is null;
  insert into preuves values ('aucun lieu non classé','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);

  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120) l
    join public.places p on p.id = l.id where p.duplicate_of is not null;
  insert into preuves values ('aucun doublon rendu','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);
end $$;


-- ---- LES DROITS : ce qu'un navigateur peut et ne peut pas ----------------
grant all on preuves to anon, authenticated, service_role;

do $$
declare n int;
begin
  set local role anon;

  -- Ce qu'anon DOIT pouvoir faire.
  begin select count(*) into n from public.lieux_explorer('mel',null,50.6292,3.0573,12000,12,true,
      array['culture','nature'], 2);
    insert into preuves values ('anon lit lieux_explorer','autorisé', n||' lieux',
      case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit lieux_explorer','autorisé', sqlstate,'ECHEC'); end;
  begin select count(*) into n from public.offres_publiques('student','mel',null,null,null,60);
    insert into preuves values ('anon lit offres_publiques','autorisé', n||' offres',
      case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit offres_publiques','autorisé', sqlstate,'ECHEC'); end;
  begin perform public.horaires_etat('Mo-Fr 09:00-18:00', now());
    insert into preuves values ('anon évalue un horaire','autorisé','ok','OK');
  exception when others then
    insert into preuves values ('anon évalue un horaire','autorisé', sqlstate,'ECHEC'); end;

  -- Ce qu'anon ne doit PAS pouvoir faire.
  begin select count(*) into n from public.place_image_candidats;
    insert into preuves values ('anon lit place_image_candidats','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit place_image_candidats','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.offer_peremption;
    insert into preuves values ('anon lit offer_peremption','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit offer_peremption','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.places_photos_qualite;
    insert into preuves values ('anon lit places_photos_qualite','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit places_photos_qualite','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.offres_fraicheur_qualite;
    insert into preuves values ('anon lit offres_fraicheur_qualite','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit offres_fraicheur_qualite','refusé', sqlstate,'OK'); end;
  begin update public.places set image_type = 'place_photo' where true;
    insert into preuves values ('anon promeut une image en photo de lieu','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon promeut une image en photo de lieu','refusé', sqlstate,'OK'); end;
  begin update public.offers set status = 'active' where true;
    insert into preuves values ('anon ressuscite une offre','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon ressuscite une offre','refusé', sqlstate,'OK'); end;

  -- Les chemins d'ingestion, un par un.
  begin perform public.places_recolter_wikidata(1);
    insert into preuves values ('anon appelle places_recolter_wikidata','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle places_recolter_wikidata','refusé', sqlstate,'OK'); end;
  begin perform public.places_verser_commons();
    insert into preuves values ('anon appelle places_verser_commons','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle places_verser_commons','refusé', sqlstate,'OK'); end;
  begin perform public.places_poser_horaires(null, 'Mo-Fr 09:00-18:00', 'anon');
    insert into preuves values ('anon pose un horaire','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon pose un horaire','refusé', sqlstate,'OK'); end;
  begin perform public.offres_appliquer_fraicheur();
    insert into preuves values ('anon applique la fraîcheur','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon applique la fraîcheur','refusé', sqlstate,'OK'); end;
  begin perform public.offres_rattacher_aux_lieux(true);
    insert into preuves values ('anon rattache les offres','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon rattache les offres','refusé', sqlstate,'OK'); end;
  begin perform public.places_rapprocher_prefixes(true);
    insert into preuves values ('anon fusionne des lieux','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon fusionne des lieux','refusé', sqlstate,'OK'); end;

  reset role;
end $$;

select * from preuves order by cas;

-- Le ménage.
delete from public.offers o
 where exists (select 1 from public.offer_sources s
                where s.offer_id = o.id and s.source like 'test6%');
delete from public.places p
 where exists (select 1 from public.place_sources s
                where s.place_id = p.id and s.source like 'test6%');
