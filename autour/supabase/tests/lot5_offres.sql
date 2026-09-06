-- ---------------------------------------------------------------------------
-- Preuve, en base, que les offres et la porte d'Explorer tiennent leurs
-- promesses
--
-- CE QUI SE DÉMONTRE ICI NE PEUT PAS SE DÉMONTRER AILLEURS. Un test de source
-- lit ce qui est écrit ; celui-ci fait ce que ferait un navigateur hostile :
-- il prend le rôle `anon` et essaie d'écrire, de lire les provenances, de
-- rejouer une ingestion, de faire passer une offre périmée pour vivante.
--
-- Les lignes de travail portent toutes la source `test5%` et sont supprimées
-- à la fin. Les offres réelles — les 46 du CROUS — ne sont jamais modifiées :
-- elles ne servent ici que de témoin.
--
-- Lancer :  psql "$DATABASE_URL" -f supabase/tests/lot5_offres.sql
-- ---------------------------------------------------------------------------

set search_path to public, topology;

create temp table preuves(cas text, attendu text, observe text, verdict text);

do $$
declare r record; n int; m int; v_id uuid; v_lieu uuid;
begin
  -- ---- E · UNE VRAIE OFFRE ÉTUDIANTE S'AFFICHE ----------------------------
  -- Le témoin est réel : le jeu de données ouvert du CROUS, déjà collecté.
  select count(*) into n from public.offres_publiques('student', 'mel', 50.6329, 3.0573, 30000, 60);
  insert into preuves values ('offre étudiante réelle rendue à Explorer','au moins 1',
    n||' offres', case when n >= 1 then 'OK' else 'ECHEC' end);

  -- Et chacune renvoie vers une page ouvrable. Une offre sans lien est une
  -- affirmation ; avec lien, c'est une information vérifiable.
  select count(*) into n from public.offres_publiques('student','mel',null,null,null,60)
   where source_url !~ '^https?://';
  insert into preuves values ('toute offre rendue porte une source ouvrable','0 sans lien',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);

  -- ---- C · UNE OFFRE SANS SOURCE VÉRIFIABLE N'EXISTE PAS ------------------
  select count(*) into n from public.offers;
  select offer_id into v_id from public.offres_ingerer(
    'test5','SANS-URL','Réduction essai sans source','Organisme essai','pas-une-url');
  select count(*) into m from public.offers;
  insert into preuves values ('ingestion sans URL http(s)','refusée, aucune ligne créée',
    coalesce(v_id::text,'(rien)')||' / '||(m-n)||' ligne(s)',
    case when v_id is null and m = n then 'OK' else 'ECHEC' end);

  select offer_id into v_id from public.offres_ingerer(
    'test5','SANS-NOM','Réduction essai sans organisme', null, 'https://exemple.test/o');
  insert into preuves values ('ingestion sans nom d''organisme','refusée',
    coalesce(v_id::text,'(rien)'), case when v_id is null then 'OK' else 'ECHEC' end);

  -- La contrainte est aussi AU SCHÉMA : aucun import futur ne la contourne en
  -- oubliant le contrôle applicatif.
  begin
    insert into public.offers (title, source_name, source_url)
      values ('Essai direct', 'Organisme essai', 'ftp://exemple.test/o');
    insert into preuves values ('insertion directe avec une URL non http','refusée',
      'ACCEPTÉE','ECHEC');
  exception when check_violation then
    insert into preuves values ('insertion directe avec une URL non http','refusée',
      'check_violation','OK');
  end;

  -- ---- C · UNE OFFRE EST UNE ENTITÉ À PART, RATTACHABLE ------------------
  select offer_id into v_id from public.offres_ingerer(
    'test5','LIBRE','Tarif étudiant essai sans lieu','Organisme essai',
    'https://exemple.test/libre', 'Essai', 'tarif_reduit', array['student']::text[]);
  select place_id into v_lieu from public.offers where id = v_id;
  insert into preuves values ('une offre vit sans lieu','créée, place_id nul',
    coalesce(v_id::text,'(rien)')||' / '||coalesce(v_lieu::text,'null'),
    case when v_id is not null and v_lieu is null then 'OK' else 'ECHEC' end);

  -- Rattachée à un vrai lieu de l'inventaire, elle le porte.
  select id into v_lieu from public.places
   where family is not null and duplicate_of is null and status = 'active' limit 1;
  select offer_id into v_id from public.offres_ingerer(
    'test5','LIEE','Tarif étudiant essai avec lieu','Organisme essai',
    'https://exemple.test/liee', null, 'tarif_reduit', array['student']::text[], v_lieu);
  select count(*) into n from public.offres_publiques('student', null, null, null, null, 60)
   where id = v_id and place_name is not null;
  insert into preuves values ('une offre rattachée porte le nom du lieu','1',
    n::text, case when n = 1 then 'OK' else 'ECHEC' end);

  -- ---- C · `audience_tags` DÉCRIT L'OFFRE, JAMAIS LA PERSONNE ------------
  begin
    perform public.offres_ingerer(
      'test5','ETIQUETTE','Essai étiquette interdite','Organisme essai',
      'https://exemple.test/e', null, 'avantage', array['is_student']::text[]);
    insert into preuves values ('étiquette hors vocabulaire','refusée','ACCEPTÉE','ECHEC');
  exception when check_violation then
    insert into preuves values ('étiquette hors vocabulaire','refusée','check_violation','OK');
  end;

  -- ---- E · UNE OFFRE EXPIRÉE N'EST PAS MONTRÉE, ET N'EST PAS EFFACÉE -----
  select offer_id into v_id from public.offres_ingerer(
    'test5','PERIMEE','Tarif étudiant essai périmé','Organisme essai',
    'https://exemple.test/perimee', null, 'tarif_reduit', array['student']::text[],
    null, null, null, null, now() - interval '30 days', now() - interval '1 day');
  select status into r from public.offers where id = v_id;
  select count(*) into n from public.offres_publiques('student', null, null, null, null, 60)
   where id = v_id;
  select count(*) into m from public.offers where id = v_id;
  insert into preuves values ('offre dont la date de fin est passée',
    'status expired, 0 rendue, 1 conservée',
    r.status||' / '||n||' rendue / '||m||' en base',
    case when r.status = 'expired' and n = 0 and m = 1 then 'OK' else 'ECHEC' end);

  -- ---- D · L'INGESTION EST IDEMPOTENTE ------------------------------------
  select count(*) into n from public.offers;
  select count(*) into m from public.offer_sources;
  for r in select * from public.offres_ingerer(
    'test5','LIBRE','Tarif étudiant essai sans lieu','Organisme essai',
    'https://exemple.test/libre', 'Essai', 'tarif_reduit', array['student']::text[])
  loop
    insert into preuves values ('rejouer la même offre','revue',
      r.action, case when r.action = 'revue' then 'OK' else 'ECHEC' end);
  end loop;
  insert into preuves values ('rejouer n''ajoute ni offre ni provenance','0 / 0',
    ((select count(*) from public.offers) - n)||' / '||
    ((select count(*) from public.offer_sources) - m),
    case when (select count(*) from public.offers) = n
          and (select count(*) from public.offer_sources) = m then 'OK' else 'ECHEC' end);

  -- Le même lieu vu par une AUTRE source garde une provenance par source :
  -- `UNIQUE(source, external_id)` déduplique dans une source, pas entre elles.
  select count(*) into n from public.offer_sources s
    join public.offers o on o.id = s.offer_id where s.source = 'test5';
  insert into preuves values ('une provenance par (source, external_id)','au moins 3',
    n::text, case when n >= 3 then 'OK' else 'ECHEC' end);

  -- ---- A · LA PORTE D'EXPLORER --------------------------------------------
  select count(*) into n from public.lieux_explorer('mel', null, 50.6329, 3.0573, 20000, 120);
  insert into preuves values ('Explorer lit l''inventaire persistant','au moins 30 lieux',
    n||' lieux', case when n >= 30 then 'OK' else 'ECHEC' end);

  -- Les 358 non classés ne polluent pas une surface de découverte.
  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120)
   where family is null;
  insert into preuves values ('aucun lieu non classé rendu','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);

  -- Aucun satellite d'un autre lieu, sinon la même fiche apparaît deux fois.
  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120) l
    join public.places p on p.id = l.id where p.duplicate_of is not null;
  insert into preuves values ('aucun doublon rendu','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);

  -- ---- A · AUCUN LIEU N'EST DÉCLARÉ OUVERT PAR SUPPOSITION ---------------
  -- C'est LE point qui interdit à `places` d'alimenter « Maintenant » : tant
  -- qu'aucun horaire n'est connu, aucune ouverture ne peut être affirmée.
  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120)
   where horaires_fiables;
  select count(*) into m from public.places where opening_hours is not null;
  insert into preuves values ('aucune ouverture affirmée sans horaire','0 / 0',
    n||' fiables / '||m||' horaires en base',
    case when n = m then 'OK' else 'ECHEC' end);

  -- ---- B · UNE AFFICHE N'EST PAS UNE PHOTO DU LIEU -----------------------
  -- La base ne peut pas empêcher un client de mentir, mais elle peut refuser
  -- de lui cacher la nature de l'image.
  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120)
   where image_url is not null and image_type is null;
  insert into preuves values ('toute image rendue dit sa nature','0 sans type',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);
  select count(*) into n from public.lieux_explorer('mel', null, null, null, null, 120)
   where image_url is not null and nullif(btrim(coalesce(image_license,'')),'') is null;
  insert into preuves values ('toute image rendue porte sa licence','0 sans licence',
    n::text, case when n = 0 then 'OK' else 'ECHEC' end);
  select count(*) into n from public.offers where image_source = 'google_places';
  insert into preuves values ('aucune image Google dans les offres','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);

  -- ---- D · LA COLLECTE EST DÉCLARÉE, PAS DEVINÉE -------------------------
  select count(*) into n from public.offer_source_registry where active;
  select count(*) into m from public.offer_source_registry
   where base_url !~ '^https?://' or parser_version is null;
  insert into preuves values ('toute source du registre est déclarée et lisible',
    'au moins 1 active, 0 incomplète', n||' active(s) / '||m||' incomplète(s)',
    case when n >= 1 and m = 0 then 'OK' else 'ECHEC' end);

  -- Aucune offre persistée ne vient d'ailleurs que d'une source du registre.
  select count(*) into n from public.offers o
   where o.source_name <> 'Organisme essai'
     and not exists (select 1 from public.offer_sources s where s.offer_id = o.id);
  insert into preuves values ('aucune offre sans provenance enregistrée','0', n::text,
    case when n = 0 then 'OK' else 'ECHEC' end);
end $$;


-- ---- LES DROITS : ce qu'un navigateur peut et ne peut pas ----------------
grant all on preuves to anon, authenticated, service_role;

do $$
declare n int; v_id uuid;
begin
  set local role anon;

  -- Ce qu'anon DOIT pouvoir faire : lire les offres publiques et l'inventaire.
  begin select count(*) into n from public.offres_publiques('student','mel',null,null,null,60);
    insert into preuves values ('anon lit offres_publiques','autorisé', n||' offres',
      case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit offres_publiques','autorisé', sqlstate,'ECHEC'); end;
  begin select count(*) into n from public.lieux_explorer('mel',null,null,null,null,30);
    insert into preuves values ('anon lit lieux_explorer','autorisé', n||' lieux',
      case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit lieux_explorer','autorisé', sqlstate,'ECHEC'); end;
  begin select count(*) into n from public.offers;
    insert into preuves values ('anon lit la table offers','autorisé', n||' offres',
      case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit la table offers','autorisé', sqlstate,'ECHEC'); end;

  -- Ce qu'anon ne doit PAS pouvoir faire : écrire une offre, sous aucune forme.
  begin insert into public.offers (title, source_name, source_url)
      values ('Offre injectée', 'Faux organisme', 'https://exemple.test/faux');
    insert into preuves values ('anon insère une offre','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon insère une offre','refusé', sqlstate,'OK'); end;
  begin update public.offers set title = 'Détourné' where true;
    insert into preuves values ('anon modifie une offre','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon modifie une offre','refusé', sqlstate,'OK'); end;
  begin delete from public.offers where true;
    insert into preuves values ('anon supprime une offre','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon supprime une offre','refusé', sqlstate,'OK'); end;

  -- Les provenances, le registre et le journal ne sont pas des données de
  -- produit : ils disent d'où l'on tire, à quelle cadence, avec quels jetons.
  begin select count(*) into n from public.offer_sources;
    insert into preuves values ('anon lit offer_sources','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit offer_sources','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.offer_source_registry;
    insert into preuves values ('anon lit offer_source_registry','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit offer_source_registry','refusé', sqlstate,'OK'); end;
  begin select count(*) into n from public.offer_collectes;
    insert into preuves values ('anon lit offer_collectes','refusé', n||' lignes','ECHEC');
  exception when others then
    insert into preuves values ('anon lit offer_collectes','refusé', sqlstate,'OK'); end;
  begin select total into n from public.offres_qualite;
    insert into preuves values ('anon lit offres_qualite','autorisé (agrégat, sans provenance)',
      n||' offres', case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit offres_qualite','autorisé', sqlstate,'ECHEC'); end;

  -- Ni l'ingestion, ni la collecte, ni le rattachement ne sont appelables.
  begin select offer_id into v_id from public.offres_ingerer(
      'test5','ANON','Offre injectée','Faux organisme','https://exemple.test/faux');
    insert into preuves values ('anon appelle offres_ingerer','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle offres_ingerer','refusé', sqlstate,'OK'); end;
  begin perform public.offres_collecter(1);
    insert into preuves values ('anon appelle offres_collecter','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle offres_collecter','refusé', sqlstate,'OK'); end;
  begin perform public.offres_verser_collectes();
    insert into preuves values ('anon appelle offres_verser_collectes','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle offres_verser_collectes','refusé', sqlstate,'OK'); end;
  begin perform public.offres_rattacher_aux_lieux();
    insert into preuves values ('anon appelle offres_rattacher_aux_lieux','refusé','ACCEPTÉ','ECHEC');
  exception when others then
    insert into preuves values ('anon appelle offres_rattacher_aux_lieux','refusé', sqlstate,'OK'); end;

  -- Et la vue de couverture d'Explorer, qui expose la géographie de la base.
  begin select count(*) into n from public.lieux_explorer_couverture;
    insert into preuves values ('anon lit lieux_explorer_couverture',
      'autorisé (comptages publics)', n||' lignes',
      case when n >= 1 then 'OK' else 'ECHEC' end);
  exception when others then
    insert into preuves values ('anon lit lieux_explorer_couverture','autorisé',
      sqlstate,'ECHEC'); end;

  reset role;
end $$;

select * from preuves order by cas;

-- Le ménage. Les provenances partent avec l'offre (`on delete cascade`), et
-- les 46 offres réelles ne sont pas touchées.
delete from public.offers o
 where exists (select 1 from public.offer_sources s
                where s.offer_id = o.id and s.source like 'test5%');
