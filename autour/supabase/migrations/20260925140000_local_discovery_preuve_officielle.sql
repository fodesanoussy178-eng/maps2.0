-- ---------------------------------------------------------------------------
-- FINIR LA PREUVE D'UNE ANTENNE — SANS FORCER LA PUBLICATION
--
-- CE QUE L'AUDIT A MESURÉ, LE 25/09/2026
--
-- Quinze candidats « Restos du Cœur » pour Tourcoing, zéro publié. En allant
-- lire les sources officielles depuis la base, trois faits :
--
--   1. LES ADRESSES SONT BONNES, LES COORDONNÉES SONT FAUSSES. Les quatre
--      adresses annoncées existent et sont confirmées par la Base Adresse
--      Nationale — 8 rue de l'Europe (score 0,965), 2 rue de Seclin (0,969),
--      rue Bonne Nouvelle (0,975), avenue Roger Salengro (0,813), toutes en
--      INSEE 59599. Mais les lat/lng écrits par le modèle sont dispersés sur
--      2,5 km : « 8 rue de l'Europe » a reçu six couples différents, dont
--      aucun ne correspond au point de la BAN (50.736520, 3.145871).
--   2. LE REGISTRE OFFICIEL NE CONNAÎT QU'UN ÉTABLISSEMENT OUVERT À TOURCOING.
--      `recherche-entreprises.api.gouv.fr` : SIREN 339863417 « LES RESTAURANTS
--      DU COEUR », 39 établissements dont 7 ouverts ; à Tourcoing, deux —
--      204 RUE DES CINQ VOIES (état A, SIRET 33986341700053) et 247 RUE DE LA
--      BLANCHE PORTE (état F, fermé). Les cinq « antennes » de quartier ne
--      sont donc PAS des établissements : ce sont des centres d'activité, et
--      leurs noms viennent d'adresses de COURRIEL de l'annuaire interne AD59A.
--   3. LES PAGES OFFICIELLES EXISTENT MAIS NE SE LISENT PAS.
--      `restosducoeur.org/centres-departementaux/ad59a-centre-dactivites-
--      tourcoing/` répond 200 — et ne contient ni `streetAddress`, ni
--      `postalCode`, ni « 59200 » : la page est rendue par JavaScript. Idem
--      pour le site départemental. Un lecteur serveur n'y trouve aucune
--      adresse, et ce n'est pas une panne : c'est la limite de la source.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- Elle COMPLÈTE la preuve des candidats déjà découverts, avec deux sources
-- publiques officielles atteignables depuis la base, et elle publie
-- seulement ce qui est prouvé. Elle ne découvre rien de neuf.
--
-- CE QU'ELLE NE FAIT JAMAIS
--
--   · Elle ne fabrique aucune URL. En particulier, jamais depuis un courriel :
--     `ad59a.centre.tourcoing-virolois@restosducoeur.org` ne devient pas
--     `https://ad59a.centre.tourcoing-virolois.restosducoeur.org`. Le
--     garde-fou vit dans `discovery.mjs` (`urlDeriveeDunCourriel`) et cette
--     migration n'en crée aucune de son côté : elle n'écrit que des URL
--     rendues par une API officielle.
--   · Elle ne publie pas une antenne dont l'identité locale n'est pas
--     confirmée. Le nom du réseau ne suffit pas — c'est la règle du lot, et
--     c'est précisément ce qui laisse les cinq antennes en `candidate`.
--   · Elle ne fusionne jamais deux antennes sur un téléphone, un domaine ou
--     un réseau partagés : l'identité locale tient au nom d'antenne, à
--     l'adresse confirmée, aux coordonnées de la BAN et au SIRET.
-- ---------------------------------------------------------------------------


-- ---- 1. Ce qui manque à la preuve, écrit noir sur blanc -------------------
alter table public.local_discovery_candidates
  add column if not exists missing_evidence   text[] not null default '{}',
  add column if not exists siret              text,
  add column if not exists siren              text,
  add column if not exists ban_id             text,
  add column if not exists ban_score          numeric(4,3),
  add column if not exists insee_code         text,
  add column if not exists address_verified_at timestamptz,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists ban_requete_id     bigint,
  add column if not exists registre_requete_id bigint,
  add column if not exists address_source     text;

/* L'ADRESSE DE LA SOURCE NE SE PERD JAMAIS. `address` peut être remplacée par
   le libellé officiel de la BAN — c'est souhaitable, il est propre et complet.
   Mais sans garder ce que la source avait dit, on ne peut plus rejouer la
   vérification le jour où la règle se resserre. C'est exactement ce qui a
   permis de retrouver, après coup, la SEULE adresse faussement confirmée sur
   49 : « 26 rue de la Bienveillance » devenue « 26 Rue de la Baille ». */
update public.local_discovery_candidates
   set address_source = coalesce(address_source, raw_data ->> 'address', address)
 where address_source is null;

comment on column public.local_discovery_candidates.missing_evidence is
  'Ce qui manque pour publier : adresse_non_confirmee, antenne_absente_du_registre, etablissement_ferme_au_registre, service_non_atteste…';
comment on column public.local_discovery_candidates.siret is
  'L''établissement officiel qui porte cette antenne, quand le registre des entreprises le confirme à cette adresse.';
comment on column public.local_discovery_candidates.ban_id is
  'Identifiant de la Base Adresse Nationale. Sa présence signifie : adresse ET coordonnées vérifiées par la source officielle.';


-- ---- 2. L'adresse et les coordonnées, par la Base Adresse Nationale -------
create or replace function public.local_discovery_recolter_adresse(p_lot integer default 20)
returns table (lances integer)
language plpgsql
set search_path to 'public', 'net'
as $function$
declare c record; v_id bigint; v_q text; v_n int := 0;
begin
  for c in
    select ca.id, ca.address, ca.postal_code, ca.city
      from public.local_discovery_candidates ca
     where ca.address_verified_at is null
       and ca.ban_requete_id is null
       and nullif(btrim(coalesce(ca.address, '')), '') is not null
       and nullif(btrim(coalesce(ca.city, '')), '') is not null
     order by ca.discovered_at desc
     limit greatest(coalesce(p_lot, 20), 0)
  loop
    /* La requête est l'adresse TELLE QUE LA SOURCE L'A DITE, plus la commune
       et le code postal. On ne retire pas « Maison des Services » ni « Salle
       de l'église » : la BAN sait ignorer ce qu'elle ne reconnaît pas, et le
       retirer nous-mêmes serait réécrire la source. */
    v_q := btrim(c.address) || ' ' || coalesce(btrim(c.postal_code), '') || ' ' || btrim(c.city);
    select net.http_get(
      url := 'https://api-adresse.data.gouv.fr/search/?limit=1&q=' || public.url_encode(v_q),
      headers := '{"User-Agent":"Autour/1.0 (https://autour.eu; contact@autour.eu)","Accept":"application/json"}'::jsonb,
      timeout_milliseconds := 15000) into v_id;
    update public.local_discovery_candidates set ban_requete_id = v_id where id = c.id;
    v_n := v_n + 1;
  end loop;
  return query select v_n;
end;
$function$;

revoke all on function public.local_discovery_recolter_adresse(integer) from public, anon, authenticated;
grant execute on function public.local_discovery_recolter_adresse(integer) to service_role;


-- ---- 3. Décider de l'adresse, et corriger les coordonnées ----------------
--
-- TROIS CONDITIONS. La BAN doit répondre ; son score doit être franc ; et la
-- commune qu'elle rend doit être celle du candidat. Sans quoi l'adresse n'est
-- pas confirmée, et le manque est NOMMÉ plutôt que deviné.
--
-- Quand elle est confirmée, ce sont les coordonnées de la BAN qui gagnent, pas
-- celles du candidat : un point officiel vaut mieux qu'un point plausible, et
-- les points mesurés étaient faux de 2,5 km.
create or replace function public.local_discovery_verser_adresse()
returns table (examines integer, confirmes integer, refuses integer)
language plpgsql
set search_path to 'public', 'net'
as $function$
declare
  c record; rep record; f jsonb;
  v_score numeric; v_ville text; v_type text; v_rue text; v_mots text[]; v_commun boolean;
  v_demandee text;
  v_ex int := 0; v_ok int := 0; v_rej int := 0;
begin
  for c in
    select ca.* from public.local_discovery_candidates ca
     where ca.ban_requete_id is not null and ca.address_verified_at is null
  loop
    select r.status_code, r.content into rep from net._http_response r where r.id = c.ban_requete_id;
    if rep is null then continue; end if;
    v_ex := v_ex + 1;

    v_demandee := coalesce(c.address_source, c.address);
    if c.address_source is null then
      update public.local_discovery_candidates set address_source = c.address where id = c.id;
    end if;

    f := case when rep.status_code = 200 and rep.content is not null
              then jsonb_path_query_first(rep.content::jsonb, '$.features[0]') else null end;
    v_score := nullif(f -> 'properties' ->> 'score', '')::numeric;
    v_ville := public.place_nom_normalise(f -> 'properties' ->> 'city');
    v_type  := f -> 'properties' ->> 'type';

    /* LE SCORE NE SUFFIT PAS : LA RUE DOIT ÊTRE LA MÊME.

       Mesuré sur le CCAS de Tourcoing. La source disait « 26 rue de la
       Bienveillance » — une rue que la BAN ne connaît pas à Tourcoing. Elle a
       rendu « 26 Rue de la Baille », score 0,646, type `housenumber`, bonne
       commune : toutes les conditions de score passaient, et l'adresse du CCAS
       a été REMPLACÉE par une autre rue à 800 mètres. Un géocodeur propose
       toujours quelque chose ; c'est à nous de vérifier qu'il a répondu à la
       question posée.

       On exige donc qu'un mot SIGNIFIANT de la rue rendue se retrouve dans
       l'adresse demandée. « baille » n'est pas dans « rue de la bienveillance
       59200 tourcoing » : refusé. « europe », « seclin », « bonne nouvelle »,
       « vigne », « winoc chocqueel » y sont : acceptés. */
    v_rue := public.place_nom_normalise(coalesce(f -> 'properties' ->> 'street',
                                                 f -> 'properties' ->> 'name'));
    v_mots := array(select m from unnest(string_to_array(coalesce(v_rue, ''), ' ')) m
                     where length(m) >= 4);
    v_commun := exists (select 1 from unnest(coalesce(v_mots, array[]::text[])) m
                         where position(m in public.place_nom_normalise(v_demandee)) > 0);

    if f is null or v_score is null or v_score < 0.5
       or v_ville is distinct from public.place_nom_normalise(c.city)
       or v_type not in ('housenumber', 'street')
       or coalesce(array_length(v_mots, 1), 0) = 0 or not v_commun then
      update public.local_discovery_candidates
         set missing_evidence = (select array_agg(distinct v) from unnest(
               missing_evidence || array['adresse_non_confirmee']) v),
             ban_requete_id = null
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

    update public.local_discovery_candidates set
      lat = ((f -> 'geometry' -> 'coordinates') ->> 1)::double precision,
      lng = ((f -> 'geometry' -> 'coordinates') ->> 0)::double precision,
      address = f -> 'properties' ->> 'label',
      postal_code = coalesce(f -> 'properties' ->> 'postcode', postal_code),
      insee_code = f -> 'properties' ->> 'citycode',
      ban_id = f -> 'properties' ->> 'id',
      ban_score = v_score,
      address_verified_at = now(),
      missing_evidence = coalesce((select array_agg(v) from unnest(missing_evidence) v
                                    where v <> 'adresse_non_confirmee'), '{}')
     where id = c.id;
    v_ok := v_ok + 1;
  end loop;
  return query select v_ex, v_ok, v_rej;
end;
$function$;

revoke all on function public.local_discovery_verser_adresse() from public, anon, authenticated;
grant execute on function public.local_discovery_verser_adresse() to service_role;


-- ---- 4. L'identité locale, par le registre officiel des entreprises ------
--
-- Le nom légal d'un réseau n'est pas son nom d'usage : on cherche « restaurants
-- du coeur », pas « Restos du Cœur ». Cette table fait la traduction, et elle
-- est bornée aux réseaux réellement rencontrés en base.
create or replace function public.local_discovery_nom_legal(p_nom text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when public.place_nom_normalise(p_nom) like '%resto%' then 'restaurants du coeur'
    when public.place_nom_normalise(p_nom) like '%croix rouge%' then 'croix rouge francaise'
    when public.place_nom_normalise(p_nom) like '%secours populaire%' then 'secours populaire francais'
    when public.place_nom_normalise(p_nom) like '%secours catholique%' then 'secours catholique'
    when public.place_nom_normalise(p_nom) like '%emmaus%' then 'emmaus'
    when public.place_nom_normalise(p_nom) like '%banque alimentaire%' then 'banque alimentaire'
    else null end;
$function$;

create or replace function public.local_discovery_recolter_registre(p_lot integer default 20)
returns table (lances integer)
language plpgsql
set search_path to 'public', 'net'
as $function$
declare c record; v_id bigint; v_n int := 0;
begin
  for c in
    select ca.id, ca.name, ca.insee_code, public.local_discovery_nom_legal(ca.name) as legal
      from public.local_discovery_candidates ca
     where ca.address_verified_at is not null
       and ca.identity_verified_at is null
       and ca.registre_requete_id is null
       and ca.insee_code is not null
       and public.local_discovery_nom_legal(ca.name) is not null
     order by ca.discovered_at desc
     limit greatest(coalesce(p_lot, 20), 0)
  loop
    /* `minimal=true` est OBLIGATOIRE avec `include` — sans lui l'API rend
       400 « Veuillez indiquer si vous souhaitez une réponse minimale ». */
    select net.http_get(
      url := 'https://recherche-entreprises.api.gouv.fr/search?limite=10&minimal=true'
          || '&include=matching_etablissements&code_commune=' || c.insee_code
          || '&q=' || public.url_encode(c.legal),
      headers := '{"User-Agent":"Autour/1.0 (https://autour.eu; contact@autour.eu)","Accept":"application/json"}'::jsonb,
      timeout_milliseconds := 20000) into v_id;
    update public.local_discovery_candidates set registre_requete_id = v_id where id = c.id;
    v_n := v_n + 1;
  end loop;
  return query select v_n;
end;
$function$;

revoke all on function public.local_discovery_recolter_registre(integer) from public, anon, authenticated;
grant execute on function public.local_discovery_recolter_registre(integer) to service_role;


-- ---- 5. Décider de l'identité — et dire ce qui manque quand elle manque --
--
-- L'antenne est confirmée quand le registre déclare, DANS LA MÊME COMMUNE, un
-- établissement OUVERT du réseau à la MÊME RUE que l'adresse confirmée par la
-- BAN. C'est la seule affirmation qu'une source officielle nous permette de
-- faire au niveau de l'antenne.
--
-- Trois issues, et chacune est écrite :
--   · établissement ouvert à cette rue → identité confirmée, SIRET conservé ;
--   · établissement du réseau dans la commune, mais fermé à cette rue →
--     `etablissement_ferme_au_registre` : on ne publie pas un centre fermé ;
--   · réseau présent dans la commune, pas d'établissement à cette rue →
--     `antenne_absente_du_registre`. Le SIREN est conservé quand même : le
--     réseau EST là, c'est l'antenne qui n'est pas attestée.
create or replace function public.local_discovery_verser_registre()
returns table (examines integer, confirmes integer, incomplets integer)
language plpgsql
set search_path to 'public', 'net'
as $function$
declare
  c record; rep record; r jsonb; e jsonb;
  v_rue text; v_siren text; v_siret text; v_ferme boolean;
  v_ex int := 0; v_ok int := 0; v_inc int := 0;
begin
  for c in
    select ca.* from public.local_discovery_candidates ca
     where ca.registre_requete_id is not null and ca.identity_verified_at is null
  loop
    select r2.status_code, r2.content into rep
      from net._http_response r2 where r2.id = c.registre_requete_id;
    if rep is null then continue; end if;
    v_ex := v_ex + 1;

    if rep.status_code is distinct from 200 or rep.content is null then
      update public.local_discovery_candidates
         set registre_requete_id = null,
             missing_evidence = (select array_agg(distinct v) from unnest(
               missing_evidence || array['registre_injoignable']) v)
       where id = c.id;
      v_inc := v_inc + 1;
      continue;
    end if;

    /* La rue de l'adresse confirmée, sans son numéro : le registre écrit
       « 204 RUE DES CINQ VOIES » et la BAN « 204 Rue des Cinq Voies 59200
       Tourcoing ». On compare donc sur la rue, normalisée. */
    v_rue := regexp_replace(public.place_nom_normalise(c.address), '^[0-9]+( bis| ter)? ', '');
    v_siren := null; v_siret := null; v_ferme := false;

    for r in select * from jsonb_array_elements(
               coalesce(rep.content::jsonb -> 'results', '[]'::jsonb))
    loop
      if public.place_nom_normalise(r ->> 'nom_complet')
         not like '%' || public.local_discovery_nom_legal(c.name) || '%' then continue; end if;
      v_siren := coalesce(v_siren, r ->> 'siren');
      for e in select * from jsonb_array_elements(
                 coalesce(r -> 'matching_etablissements', '[]'::jsonb))
      loop
        if position(v_rue in public.place_nom_normalise(e ->> 'adresse')) = 0 then continue; end if;
        if (e ->> 'etat_administratif') = 'A' then v_siret := e ->> 'siret';
        else v_ferme := true; end if;
      end loop;
    end loop;

    if v_siret is not null then
      /* `last_verified_at` est la date à laquelle la PREUVE a été faite, et
         c'est maintenant : une identité confirmée par le registre officiel
         aujourd'hui est fraîche aujourd'hui. Sans cela, la règle de fraîcheur
         de la publication refusait ce qu'on venait de vérifier. */
      update public.local_discovery_candidates set
        siret = v_siret, siren = v_siren, identity_verified_at = now(),
        last_verified_at = now(),
        identity_evidence = greatest(identity_evidence, 0.90),
        missing_evidence = coalesce((select array_agg(v) from unnest(missing_evidence) v
          where v not in ('antenne_absente_du_registre','etablissement_ferme_au_registre',
                          'registre_injoignable')), '{}')
       where id = c.id;
      v_ok := v_ok + 1;
    else
      update public.local_discovery_candidates set
        siren = v_siren,
        missing_evidence = (select array_agg(distinct v) from unnest(
          missing_evidence || array[case when v_ferme then 'etablissement_ferme_au_registre'
                                         else 'antenne_absente_du_registre' end]) v),
        rejection_reason = case when v_ferme
          then 'le registre officiel déclare cet établissement fermé'
          else 'aucun établissement ouvert du réseau à cette adresse dans le registre officiel' end
       where id = c.id;
      v_inc := v_inc + 1;
    end if;
  end loop;
  return query select v_ex, v_ok, v_inc;
end;
$function$;

revoke all on function public.local_discovery_verser_registre() from public, anon, authenticated;
grant execute on function public.local_discovery_verser_registre() to service_role;


-- ---- 6. Publier — et seulement ce qui est prouvé -------------------------
--
-- LES QUATRE ÉLÉMENTS MINIMAUX du lot, et rien de moins :
--   · l'identité de l'antenne — un SIRET ouvert du réseau à cette adresse ;
--   · la localisation — une adresse et des coordonnées de la BAN ;
--   · un service pertinent — une catégorie de service reconnue ;
--   · une source fiable et récente — officielle, et vue depuis moins d'un an.
--
-- Tout le reste reste `candidate`, avec son `missing_evidence` et sa raison.
-- Un écran vide se répare ; une fiche fausse envoie quelqu'un devant une porte
-- close.
create or replace function public.local_discovery_publier()
returns table (publies integer, laisses_en_candidat integer)
language plpgsql
set search_path to 'public'
as $function$
declare
  c record; v_cat text; v_place uuid;
  v_ok int := 0; v_rest int := 0;
  k_cat constant jsonb := '{"food":"alimentaire","food_bank":"alimentaire","meals":"alimentaire",
    "grocery":"alimentaire","housing":"hebergement","shelter":"hebergement","health":"sante",
    "medical_care":"sante","administrative_assistance":"mairie","clothing":"asso",
    "hygiene":"asso","employment":"emploi","listening":"asso"}'::jsonb;
begin
  for c in
    select ca.* from public.local_discovery_candidates ca
     where ca.place_id is null
       and ca.entity_status <> 'inactive'
       and ca.lat is not null and ca.lng is not null
     order by ca.discovered_at desc
  loop
    v_cat := null;
    if c.service_categories is not null then
      select k_cat ->> s into v_cat from unnest(c.service_categories) s
       where k_cat ? s limit 1;
    end if;

    if c.address_verified_at is null or c.siret is null or v_cat is null
       or c.last_verified_at is null or c.last_verified_at < now() - interval '365 days' then
      /* `rejected` NE DEVIENT PAS `candidate` SANS RAISON. Un candidat rejeté
         parce que le modèle avait fabriqué son URL n'est pas « en attente de
         preuve » : il est écarté. Mais dès que la BAN confirme que l'adresse
         EXISTE, on sait quelque chose de plus que la lecture de page ne
         disait pas, et `candidate` devient l'état juste — trouvé, localisé,
         identité non attestée. Sinon le statut d'origine reste. */
      update public.local_discovery_candidates set
        verification_status = case when c.address_verified_at is not null
                                   then 'candidate' else verification_status end,
        missing_evidence = (select array_agg(distinct v) from unnest(
          missing_evidence
          || case when c.address_verified_at is null then array['adresse_non_confirmee'] else '{}' end
          || case when c.siret is null then array['identite_antenne_non_confirmee'] else '{}' end
          || case when v_cat is null then array['service_non_atteste'] else '{}' end
          || case when c.last_verified_at is null
                    or c.last_verified_at < now() - interval '365 days'
                  then array['source_trop_ancienne'] else '{}' end) v)
       where id = c.id;
      v_rest := v_rest + 1;
      continue;
    end if;

    /* `places_ingerer` est le MÊME chemin que la fonction de découverte :
       une seule porte d'entrée dans le catalogue, un seul dédoublonnage. Le
       rayon de rapprochement reste court — 120 m — parce que deux antennes
       d'un même réseau peuvent être à deux rues l'une de l'autre et ne
       doivent jamais fusionner. */
    /* UN POINT DE SERVICE, UN LIEU — ET LE SIRET N'EST PAS LE POINT.

       Premier défaut : `source_fingerprint` est propre à chaque DÉCOUVERTE, si
       bien que quatre passages sur la Croix-Rouge de Tourcoing créaient quatre
       lieux, servis quatre fois à l'écran.

       Second défaut, introduit en corrigeant le premier : la clé était devenue
       `coalesce(siret, ban_id, …)`. Or un SIRET appartient à l'ORGANISATION et
       se répète sur tous ses points de service. Keyée ainsi, une association à
       deux lieux de distribution n'en publiait qu'un — l'écrasement était
       simplement déplacé, de la découverte vers l'organisation.

       La clé est donc celle du POINT : l'identifiant BAN de l'adresse, qui EST
       un endroit. À défaut, le nom normalisé et les coordonnées arrondies. Le
       SIRET n'y entre pas ; il sert à vérifier, pas à identifier un lieu. */
    select p.place_id into v_place from public.places_ingerer(
      'web_discovery',
      coalesce('ban:' || c.ban_id,
               'lieu:' || public.place_nom_normalise(c.name) || '@'
                 || to_char(c.lat, 'FM990.0000') || ',' || to_char(c.lng, 'FM990.0000'),
               'decouverte:' || c.source_fingerprint),
      c.name, c.lat, c.lng, c.address,
      c.postal_code, c.city, v_cat, null, null, c.official_url, '{}'::jsonb,
      c.source_url,
      jsonb_build_object('siret', c.siret, 'siren', c.siren, 'ban_id', c.ban_id,
        'ban_score', c.ban_score, 'confidence', c.confidence,
        'service_categories', to_jsonb(c.service_categories),
        'address_verified_at', c.address_verified_at,
        'identity_verified_at', c.identity_verified_at),
      120) p;

    if v_place is null then v_rest := v_rest + 1; continue; end if;

    update public.local_discovery_candidates set
      place_id = v_place, verification_status = 'verified',
      rejection_reason = null, missing_evidence = '{}',
      confidence = greatest(confidence, 0.85)
     where id = c.id;
    v_ok := v_ok + 1;
  end loop;
  return query select v_ok, v_rest;
end;
$function$;

revoke all on function public.local_discovery_publier() from public, anon, authenticated;
grant execute on function public.local_discovery_publier() to service_role;


-- ---- 7. La mesure : découvert, vérifié, publié ---------------------------
create or replace view public.local_discovery_etat as
  select
    count(*)                                                       as candidats,
    count(*) filter (where address_verified_at is not null)         as adresse_verifiee,
    count(*) filter (where siret is not null)                       as identite_verifiee,
    count(*) filter (where place_id is not null)                    as publies,
    count(*) filter (where verification_status = 'candidate')       as en_attente_de_preuve,
    count(*) filter (where verification_status = 'rejected')        as rejetes,
    count(*) filter (where 'adresse_non_confirmee' = any(missing_evidence))            as sans_adresse,
    count(*) filter (where 'identite_antenne_non_confirmee' = any(missing_evidence))   as sans_identite,
    count(*) filter (where 'antenne_absente_du_registre' = any(missing_evidence))      as hors_registre,
    count(*) filter (where 'etablissement_ferme_au_registre' = any(missing_evidence))  as fermes
  from public.local_discovery_candidates;

revoke all on public.local_discovery_etat from anon, authenticated, public;
grant select on public.local_discovery_etat to service_role;


-- ---- 8. Une structure publiée ne se sert pas deux fois -------------------
--
-- `local_discovery_nearby` rendait une ligne par CANDIDAT. Or plusieurs
-- découvertes de la même structure aboutissent au même lieu : Solidarité
-- affichait donc « Communauté Emmaüs de Tourcoing » deux fois et
-- « Croix-Rouge française - Unité locale de Tourcoing » deux fois, aux mêmes
-- coordonnées. La fonction rend maintenant une ligne par LIEU publié, en
-- gardant le candidat le mieux prouvé de chaque lieu.
--
-- Ce n'est pas la règle multi-antennes qui change : deux antennes distinctes ont
-- deux lieux distincts et restent deux lignes. C'est la même structure,
-- découverte deux fois, qui n'en fait plus qu'une.
create or replace function public.local_discovery_nearby(
  p_lat double precision, p_lng double precision,
  p_radius_m integer default 15000, p_limit integer default 80)
returns table (id uuid, name text, lat double precision, lng double precision,
  address text, postal_code text, city text, category text, service_categories text[],
  phone text, official_url text, verification_status text, confidence numeric,
  last_verified_at timestamptz, entity_status text, reopens_at timestamptz,
  closure_reason text, next_distribution_at timestamptz, distance_m double precision)
language sql
stable security definer
set search_path to 'public', 'topology'
as $function$
  select * from (
    select distinct on (c.place_id)
           c.id, c.name, c.lat, c.lng, c.address, c.postal_code, c.city,
           coalesce(p.category, 'asso'), c.service_categories, c.phone,
           c.official_url, c.verification_status, c.confidence,
           c.last_verified_at, c.entity_status, c.reopens_at,
           c.closure_reason, c.next_distribution_at,
           ST_Distance(
             ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::topology.geography,
             ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography)
      from public.local_discovery_candidates c
      join public.places p on p.id = c.place_id
     where c.verification_status in ('verified', 'probable')
       and c.place_id is not null
       and c.entity_status <> 'inactive'
       and c.lat is not null and c.lng is not null
       /* Un lieu marqué doublon ne se sert plus : son original le remplace. */
       and p.duplicate_of is null
       and ST_DWithin(
         ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::topology.geography,
         ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography,
         least(greatest(coalesce(p_radius_m, 15000), 500), 20000))
     /* Le candidat le mieux prouvé de chaque lieu : identité vérifiée d'abord,
        puis confiance, puis la vérification la plus récente. */
     order by c.place_id, (c.siret is not null) desc, c.confidence desc,
              c.last_verified_at desc nulls last
  ) retenus
  order by 19 asc
  limit least(greatest(coalesce(p_limit, 80), 1), 120);
$function$;

revoke all on function public.local_discovery_nearby(double precision, double precision, integer, integer)
  from public, anon, authenticated;
grant execute on function public.local_discovery_nearby(double precision, double precision, integer, integer)
  to anon, authenticated, service_role;


-- ---- 9. La preuve se complète toute seule, aux prochains passages ---------
--
-- `registre_injoignable` reste sur les candidats qui ont pris un 429 : l'API des
-- entreprises limite le débit, et c'est légitime. Ces lignes sont REJOUABLES —
-- leur `registre_requete_id` est remis à nul — mais quelqu'un doit les rejouer.
--
-- Quatre tâches, décalées, toutes les six heures. Le décalage n'est pas une
-- précaution : `pg_net` rend un identifiant, pas une réponse. Les lots sont
-- petits pour ne pas reprendre un 429 à chaque passage.
select cron.schedule('decouverte-adresse-recolter', '5 */6 * * *',
  $$select public.local_discovery_recolter_adresse(20);$$);
select cron.schedule('decouverte-adresse-verser', '15 */6 * * *',
  $$select public.local_discovery_verser_adresse();$$);
select cron.schedule('decouverte-registre-recolter', '25 */6 * * *',
  $$select public.local_discovery_recolter_registre(6);$$);
select cron.schedule('decouverte-registre-publier', '35 */6 * * *',
  $$select public.local_discovery_verser_registre(), public.local_discovery_publier();$$);
