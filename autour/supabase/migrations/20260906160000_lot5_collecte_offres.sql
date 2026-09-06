-- ---------------------------------------------------------------------------
-- LOT 5 · D — LA COLLECTE DES OFFRES
--
-- ON NE PART PAS À LA PÊCHE. Une source est enregistrée avant d'être lue, avec
-- son type, son rythme, son territoire et le public qu'elle vise. La collecte
-- ne fait ensuite que parcourir ce registre.
--
-- ETAG ET LAST-MODIFIED NE SONT PAS DE LA DÉCORATION. Une source publique
-- consultée tous les jours qui renvoie 40 ko inchangés, c'est 15 Mo par an
-- téléchargés pour rien, et un visiteur pénible. Quand la source sait dire
-- « rien n'a bougé », on l'écoute : la collecte se termine en `inchangee`
-- sans rien reparser.
--
-- LE PARSEUR EST VERSIONNÉ. `parser_version` dit comment lire CETTE source ;
-- le versement en dépend explicitement. Une source dont on ne sait pas lire la
-- forme est laissée en erreur plutôt que devinée — un parseur générique qui
-- « essaie de comprendre » finit par inventer des offres.
--
-- CE QUI NE SERA JAMAIS LA SOURCE CANONIQUE : un modèle. Gemini peut aider à
-- TROUVER une source ; l'offre persistée renvoie toujours vers la vraie page
-- de l'organisme, et `source_url` est NOT NULL pour que ce soit impossible
-- autrement.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- LA PREMIÈRE SOURCE : les lieux de restauration des CROUS
--
-- Pourquoi celle-là. Le tarif CROUS est un avantage étudiant RÉEL, PUBLIÉ et
-- VÉRIFIABLE : le jeu de données est officiel (ministère de l'Enseignement
-- supérieur, portail Opendatasoft, licence ouverte), il porte des coordonnées,
-- et chaque point renvoie à un organisme identifiable. C'est exactement ce
-- qu'une offre doit être — pas une promotion glanée sur une page commerciale.
--
-- La requête est bornée à la métropole par `within_distance` : on ne rapatrie
-- pas les 992 points de France pour en garder 46.
-- ---------------------------------------------------------------------------

insert into public.offer_source_registry
  (name, base_url, source_type, zone_id, audience_tags, poll_interval,
   conserver_brut, parser_version, notes)
values (
  'CROUS — lieux de restauration (MEL)',
  'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr_crous_restauration_france_entiere/records?where=within_distance(geolocalisation%2C%20geom%27POINT(3.0573%2050.6292)%27%2C%2035km)&limit=100',
  'json', 'mel', array['student']::text[], interval '1 day',
  false, 'ods_crous_v1',
  'Ministère de l''Enseignement supérieur, portail Opendatasoft, licence ouverte. Le tarif CROUS est un avantage étudiant publié ; la fiche renvoie vers le jeu de données officiel.')
on conflict (base_url) do update
  set name = excluded.name, source_type = excluded.source_type,
      zone_id = excluded.zone_id, audience_tags = excluded.audience_tags,
      parser_version = excluded.parser_version, notes = excluded.notes,
      updated_at = now();


-- ---------------------------------------------------------------------------
-- LANCER — bornée, journalisée, polie
-- ---------------------------------------------------------------------------

create or replace function public.offres_collecter(
  p_max integer default 5,
  p_forcer boolean default false)
returns table (lancees int, restantes int)
language plpgsql
set search_path to 'public', 'net'
as $function$
declare
  s record;
  v_entetes jsonb;
  v_lancees int := 0;
  v_restantes int;
begin
  for s in
    select r.* from public.offer_source_registry r
     where r.active
       and (p_forcer
            or r.last_checked_at is null
            or r.last_checked_at < now() - r.poll_interval)
     order by r.last_checked_at nulls first, r.id
     limit greatest(coalesce(p_max, 5), 0)
  loop
    /* On redit à la source ce qu'elle nous avait dit. Si rien n'a changé, elle
       répond 304 et personne n'a rien téléchargé. */
    v_entetes := '{}'::jsonb;
    if s.etag is not null then
      v_entetes := v_entetes || jsonb_build_object('If-None-Match', s.etag);
    end if;
    if s.last_modified is not null then
      v_entetes := v_entetes || jsonb_build_object('If-Modified-Since', s.last_modified);
    end if;

    insert into public.offer_collectes (registry_id, requete_id)
    values (s.id, net.http_get(s.base_url, headers => v_entetes));

    update public.offer_source_registry
       set last_checked_at = now(), updated_at = now()
     where id = s.id;
    v_lancees := v_lancees + 1;
  end loop;

  select count(*) into v_restantes from public.offer_source_registry r
   where r.active
     and (r.last_checked_at is null or r.last_checked_at < now() - r.poll_interval);

  return query select v_lancees, v_restantes;
end;
$function$;

revoke all on function public.offres_collecter(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.offres_collecter(integer, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- VERSER — un parseur par version, jamais de devinette
--
-- `ods_crous_v1` lit la forme Opendatasoft du jeu CROUS. Ce qu'il en fait :
--   · une offre par point de restauration, `tarif_reduit`, public `student` ;
--   · le titre du point comme titre, la commune et le contact comme lieu ;
--   · les horaires bruts de la source dans `eligibility` SEULEMENT s'ils
--     décrivent une condition — sinon rien. On ne convertit pas un texte libre
--     en horaire d'ouverture : `places.opening_hours` reste hors de portée.
--   · AUCUNE image. Le champ `photo` de la source ne porte aucune licence
--     lisible ; la règle du Lot 4-bis s'applique telle quelle.
--   · `source_url` pointe vers la fiche du jeu de données officiel.
-- ---------------------------------------------------------------------------

create or replace function public.offres_verser_collectes()
returns table (collectes int, lus int, retenus int, creees int, revues int,
               rejetees int, inchangees int, echecs int)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  j record; s record; rep record; it jsonb; r record;
  v_lat double precision; v_lng double precision; v_ville text;
  n_col int := 0; n_lus int := 0; n_ret int := 0; n_cree int := 0;
  n_revu int := 0; n_rej int := 0; n_inch int := 0; n_ech int := 0;
  c_lus int; c_ret int; c_cree int; c_revu int; c_rej int;
begin
  for j in
    select c.id, c.requete_id, c.registry_id from public.offer_collectes c
     where c.statut = 'lancee' and c.requete_id is not null order by c.id
  loop
    select * into rep from net._http_response where id = j.requete_id;
    if rep.id is null then continue; end if;          -- pas encore répondu
    n_col := n_col + 1;
    select * into s from public.offer_source_registry where id = j.registry_id;

    if rep.status_code = 304 then
      update public.offer_collectes
         set statut='inchangee', verse_le=now(), code_http=304 where id=j.id;
      update public.offer_source_registry
         set status='inchangee', last_success_at=now(), updated_at=now() where id=s.id;
      n_inch := n_inch + 1; continue;
    end if;

    if rep.status_code <> 200 or rep.content is null then
      update public.offer_collectes set statut='echec', verse_le=now(),
             code_http=rep.status_code, message=left(coalesce(rep.error_msg,''),200)
       where id=j.id;
      update public.offer_source_registry
         set status='erreur', dernier_message=left(coalesce(rep.error_msg,'HTTP '||rep.status_code),200),
             updated_at=now() where id=s.id;
      n_ech := n_ech + 1; continue;
    end if;

    /* Ce que la source dit d'elle-même, gardé pour le prochain passage. */
    update public.offer_source_registry set
      etag = coalesce(rep.headers->>'etag', etag),
      last_modified = coalesce(rep.headers->>'last-modified', last_modified),
      status = 'ok', last_success_at = now(), dernier_message = null, updated_at = now()
    where id = s.id;

    c_lus := 0; c_ret := 0; c_cree := 0; c_revu := 0; c_rej := 0;

    if s.parser_version = 'ods_crous_v1' then
      for it in select * from jsonb_array_elements(
                  coalesce((rep.content::jsonb)->'results', '[]'::jsonb))
      loop
        c_lus := c_lus + 1;
        v_lat := nullif(it->'geolocalisation'->>'lat','')::double precision;
        v_lng := nullif(it->'geolocalisation'->>'lon','')::double precision;
        /* Sans position, l'offre ne peut ni se situer ni se rattacher à une
           zone : elle n'entre pas. Sans titre non plus. */
        if v_lat is null or v_lng is null
           or nullif(btrim(coalesce(it->>'title','')),'') is null then
          c_rej := c_rej + 1; continue;
        end if;
        /* La commune vient du texte de contact quand il la porte ; sinon on
           laisse `zone_autour_pour` faire son travail sur les coordonnées. */
        v_ville := nullif(btrim(substring(coalesce(it->>'contact','')
                     from '[0-9]{5}\s+([A-Za-zÀ-ÿ''\- ]+)$')), '');
        c_ret := c_ret + 1;

        select * into r from public.offres_ingerer(
          p_source      => 'crous_ods',
          p_external_id => it->>'id',
          p_titre       => btrim(it->>'title'),
          p_source_name => 'CROUS · Ministère de l''Enseignement supérieur',
          p_source_url  => 'https://www.data.gouv.fr/datasets/ensemble-des-lieux-de-restauration-des-crous',
          p_description => nullif(btrim(coalesce(it->>'short_desc','')),''),
          p_offer_type  => 'tarif_reduit',
          p_audience    => array['student']::text[],
          p_zone_id     => s.zone_id,
          p_lat         => v_lat,
          p_lng         => v_lng,
          p_eligibilite => 'Tarif CROUS, sur présentation de la carte étudiante.',
          p_raw         => case when s.conserver_brut then it else null end);
        if r.offer_id is null then c_rej := c_rej + 1;
        elsif r.action = 'creee' then c_cree := c_cree + 1;
        else c_revu := c_revu + 1; end if;
      end loop;
    else
      /* Une forme qu'on ne sait pas lire reste une erreur. Deviner produirait
         des offres qui n'existent pas. */
      update public.offer_collectes set statut='echec', verse_le=now(),
             code_http=rep.status_code,
             message='parseur inconnu : '||coalesce(s.parser_version,'(aucun)')
       where id=j.id;
      update public.offer_source_registry set status='erreur',
             dernier_message='parseur inconnu', updated_at=now() where id=s.id;
      n_ech := n_ech + 1; continue;
    end if;

    update public.offer_collectes set
      statut = case when c_lus = 0 then 'vide' else 'versee' end,
      verse_le = now(), code_http = rep.status_code,
      lus = c_lus, retenus = c_ret, crees = c_cree, revus = c_revu, rejetes = c_rej
    where id = j.id;

    n_lus := n_lus + c_lus; n_ret := n_ret + c_ret; n_cree := n_cree + c_cree;
    n_revu := n_revu + c_revu; n_rej := n_rej + c_rej;
  end loop;

  return query select n_col, n_lus, n_ret, n_cree, n_revu, n_rej, n_inch, n_ech;
end;
$function$;

revoke all on function public.offres_verser_collectes() from public, anon, authenticated;
grant execute on function public.offres_verser_collectes() to service_role;


-- ---------------------------------------------------------------------------
-- RATTACHER UNE OFFRE À UN LIEU DE L'INVENTAIRE
--
-- Facultatif par construction : une offre vit sans lieu. Mais quand le lieu
-- existe déjà chez nous, le rattachement évite une seconde vérité géographique
-- et permet d'afficher « au Musée X » plutôt qu'une adresse nue.
--
-- Le rapprochement emploie les mêmes signaux que partout : nom normalisé,
-- commune, et le rayon de la famille. Rien de nouveau n'est inventé.
-- ---------------------------------------------------------------------------

create or replace function public.offres_rattacher_aux_lieux()
returns table (examinees int, rattachees int)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare v_exam int; v_rat int;
begin
  select count(*) into v_exam from public.offers where place_id is null;

  with candidat as (
    select distinct on (o.id) o.id as offer_id, p.id as place_id
      from public.offers o
      join public.places p
        on p.duplicate_of is null and p.status = 'active'
       and p.name_normalized = public.place_nom_normalise(o.title)
       and o.geom is not null and p.geom is not null
       and ST_DWithin(o.geom::topology.geography, p.geom::topology.geography,
             public.place_rayon_rapprochement(p.family))
     where o.place_id is null
     order by o.id, ST_Distance(o.geom::topology.geography, p.geom::topology.geography)
  ),
  applique as (
    update public.offers o set place_id = c.place_id
      from candidat c where o.id = c.offer_id returning o.id)
  select count(*) into v_rat from applique;

  return query select v_exam, v_rat;
end;
$function$;

revoke all on function public.offres_rattacher_aux_lieux() from public, anon, authenticated;
grant execute on function public.offres_rattacher_aux_lieux() to service_role;


-- La mesure de qualité des offres, sur le modèle de `places_qualite`.
create or replace view public.offres_qualite as
  select
    count(*)                                                as total,
    count(*) filter (where status = 'active')               as actives,
    count(*) filter (where status = 'expired')              as expirees,
    count(*) filter (where 'student' = any(audience_tags))  as etudiantes,
    count(*) filter (where place_id is not null)            as avec_lieu,
    count(*) filter (where image_url is not null)           as avec_image,
    count(*) filter (where ends_at is not null)             as avec_date_de_fin,
    count(*) filter (where description is not null)         as avec_description,
    count(distinct source_name)                             as organismes,
    count(distinct zone_id)                                 as zones
  from public.offers;

revoke all on public.offres_qualite from anon, authenticated, public;
grant select on public.offres_qualite to anon, authenticated, service_role;
