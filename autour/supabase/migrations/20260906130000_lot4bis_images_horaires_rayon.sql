-- ---------------------------------------------------------------------------
-- LOT 4-BIS — IMAGES, HORAIRES, ET LE RAYON QUI DÉPEND DE LA FAMILLE
--
--
-- CE QUE LES SOURCES DONNENT VRAIMENT (MESURÉ, PAS SUPPOSÉ)
--
-- Sur les 1 917 objets DATAtourisme parcourus pendant la récolte de la
-- métropole :
--     1 894 portent une description   (98,8 %)
--         2 portent des horaires      ( 0,1 %)
--         0 porte une image           ( 0   %)
--
-- Zéro image, et ce n'est pas une panne : `api/datatourisme.js` écarte toute
-- illustration dont la licence n'est pas explicitement ouverte. C'est la bonne
-- règle, et elle signifie que DATAtourisme n'est pas une source d'images pour
-- Autour. Wikimedia et Wikidata ne sont atteignables que par les tags d'un
-- objet OpenStreetMap, et rien d'OSM n'est persisté : eux non plus ne sont pas
-- disponibles dans ce lot. `place_enrichments` n'a pas de colonne image.
--
-- IL RESTE UNE SOURCE, ET UNE SEULE : LES ÉVÉNEMENTS DU LIEU.
--
--
-- UNE AFFICHE N'EST PAS UNE PHOTO DE LA SALLE
--
-- C'est écrit noir sur blanc dans `images.js` : « Une image d'événement n'est
-- pas une image de lieu ». L'affiche d'un concert au Grand Sud illustre le
-- concert, pas le bâtiment.
--
-- On la reprend quand même — c'est une décision produit assumée — mais JAMAIS
-- déguisée : `image_type` vaut `event_poster`, le vocabulaire que le résolveur
-- connaît déjà et que le rendu sait distinguer de `place_photo`. La colonne
-- manquait ; le commentaire d'`images.js` disait précisément qu'on l'ajouterait
-- le jour où la base en porterait une. C'est ce jour-là.
--
-- La licence suit l'image : `image_source`, `image_author`, `image_license`
-- sont recopiés de l'événement, qui les tient d'OpenAgenda. Rien n'est
-- réhébergé, rien n'est fabriqué, et aucune image Google n'entre — les
-- événements n'en portent aucune, et la requête l'exige explicitement.
--
--
-- LE RAYON DÉPEND DÉSORMAIS DE LA FAMILLE
--
-- Un parc décrit par deux sources s'étale sur des centaines de mètres : ses
-- deux relevés ne sont pas deux parcs. Deux commerces voisins, eux, sont deux
-- commerces. Les deux valeurs ne sont pas inventées : ce sont celles que
-- `core.js` applique déjà côté client — `nomme: 120` pour deux relevés du même
-- commerce, `nommeEtendu: 400` pour deux morceaux du même parc — et les
-- familles étendues sont celles de sa propre liste `SPREAD_CATEGORIES` :
-- parc, terrain, sport, marché.
-- ---------------------------------------------------------------------------

alter table public.places
  add column if not exists image_type text;

comment on column public.places.image_type is
  'Vocabulaire de images.js : place_photo, institutional, wikimedia, event_poster, fallback. `event_poster` dit qu''on montre l''affiche d''un événement du lieu, pas une photo du lieu.';


-- ---------------------------------------------------------------------------
-- LE RAYON DE RAPPROCHEMENT, PAR FAMILLE
-- ---------------------------------------------------------------------------

create or replace function public.place_rayon_rapprochement(p_famille text)
returns double precision
language sql
stable
set search_path to 'public'
as $function$
  select case
    when exists (select 1 from public.place_familles f
                  where f.famille = p_famille and f.etendu)
      then 400.0     -- core.js : DEDUP_RADIUS.nommeEtendu
    else 120.0       -- core.js : DEDUP_RADIUS.nomme
  end;
$function$;


-- `places_ingerer` choisit maintenant son rayon plutôt que de le recevoir tout
-- fait. Le paramètre reste, pour qu'un appelant puisse encore imposer le sien,
-- mais sa valeur par défaut devient NULL : « décide toi-même ».
create or replace function public.places_ingerer(
  p_source      text,
  p_external_id text,
  p_nom         text,
  p_lat         double precision,
  p_lng         double precision,
  p_adresse     text default null,
  p_code_postal text default null,
  p_ville       text default null,
  p_categorie   text default null,
  p_description text default null,
  p_horaires    text default null,
  p_url         text default null,
  p_image_refs  jsonb default '{}'::jsonb,
  p_source_url  text default null,
  p_raw         jsonb default null,
  p_rayon_m     double precision default null)
returns table (place_id uuid, statut text, action text)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  v_nom_norm  text := public.place_nom_normalise(p_nom);
  v_commune   text;
  v_cle_com   text;
  v_point     topology.geometry;
  v_famille   text;
  v_rayon     double precision;
  v_id        uuid;
  v_candidats uuid[];
  v_statut    text;
  v_action    text;
begin
  if v_nom_norm is null or length(v_nom_norm) < 2
     or p_lat is null or p_lng is null
     or p_source is null or p_external_id is null then
    return;
  end if;

  select mc.nom into v_commune
    from public.mel_communes mc
   where mc.cle = public.commune_cle(p_ville);
  v_cle_com := public.commune_cle(coalesce(v_commune, p_ville));
  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  /* La famille de l'ARRIVANT décide du rayon : c'est elle qu'on connaît avant
     d'avoir trouvé quoi que ce soit. Faute de type déclaré, le nom parle. */
  v_famille := coalesce(public.place_famille_depuis_types(p_raw->>'type'),
                        public.place_famille_depuis_nom(p_nom));
  v_rayon := coalesce(p_rayon_m, public.place_rayon_rapprochement(v_famille));

  select ps.place_id into v_id
    from public.place_sources ps
   where ps.source = p_source and ps.external_id = p_external_id;

  if v_id is not null then
    v_statut := 'exact';
    v_action := 'revu';
  else
    select array_agg(p.id order by p.created_at) into v_candidats
      from public.places p
     where p.duplicate_of is null
       and p.status <> 'disabled'
       and p.name_normalized = v_nom_norm
       and public.commune_cle(coalesce(p.commune, p.city)) is not distinct from v_cle_com
       and p.geom is not null
       /* Le rayon retenu est le PLUS GRAND des deux : si l'un des deux objets
          est un parc, l'autre est un morceau du même parc. Prendre le plus
          petit couperait le parc en deux au premier relevé décalé. */
       and ST_DWithin(p.geom::topology.geography, v_point::topology.geography,
             greatest(v_rayon, public.place_rayon_rapprochement(p.family)));

    if v_candidats is null or array_length(v_candidats, 1) is null then
      v_id := null; v_statut := 'exact';    v_action := 'cree';
    elsif array_length(v_candidats, 1) = 1 then
      v_id := v_candidats[1];
      v_statut := 'matched'; v_action := 'rapproche';
    else
      v_id := null; v_statut := 'unresolved'; v_action := 'ambigu';
    end if;
  end if;

  if v_id is null then
    insert into public.places (
      name, lat, lng, address, postal_code, city, commune,
      category, family, description, opening_hours, official_url,
      image_refs, match_status)
    values (
      btrim(p_nom), p_lat, p_lng, nullif(btrim(coalesce(p_adresse,'')),''),
      nullif(btrim(coalesce(p_code_postal,'')),''),
      nullif(btrim(coalesce(p_ville,'')),''), v_commune,
      nullif(btrim(coalesce(p_categorie,'')),''), v_famille,
      nullif(btrim(coalesce(p_description,'')),''),
      nullif(btrim(coalesce(p_horaires,'')),''),
      nullif(btrim(coalesce(p_url,'')),''),
      coalesce(p_image_refs, '{}'::jsonb), v_statut)
    returning id into v_id;
  else
    update public.places p set
      address       = coalesce(nullif(btrim(coalesce(p_adresse,'')),''), p.address),
      postal_code   = coalesce(nullif(btrim(coalesce(p_code_postal,'')),''), p.postal_code),
      city          = coalesce(p.city, nullif(btrim(coalesce(p_ville,'')),'')),
      category      = coalesce(nullif(btrim(coalesce(p_categorie,'')),''), p.category),
      family        = coalesce(p.family, v_famille),
      description   = coalesce(nullif(btrim(coalesce(p_description,'')),''), p.description),
      opening_hours = coalesce(nullif(btrim(coalesce(p_horaires,'')),''), p.opening_hours),
      official_url  = coalesce(nullif(btrim(coalesce(p_url,'')),''), p.official_url),
      image_refs    = case when p_image_refs is null or p_image_refs = '{}'::jsonb
                           then p.image_refs else p.image_refs || p_image_refs end,
      match_status  = case when v_statut = 'matched' and p.match_status = 'exact'
                           then 'matched' else p.match_status end,
      status        = 'active',
      last_seen_at  = now()
    where p.id = v_id;
  end if;

  insert into public.place_sources (
    place_id, source, external_id, source_url, raw_data, synced_at)
  values (
    v_id, p_source, p_external_id, p_source_url,
    case when v_action = 'ambigu'
         then coalesce(p_raw, '{}'::jsonb)
              || jsonb_build_object('candidats_non_tranches', to_jsonb(v_candidats))
         else p_raw end,
    now())
  on conflict (source, external_id) do update
    set synced_at  = now(),
        source_url = coalesce(excluded.source_url, public.place_sources.source_url),
        raw_data   = coalesce(excluded.raw_data, public.place_sources.raw_data);

  return query select v_id, v_statut, v_action;
end;
$function$;

revoke all on function public.places_ingerer(
  text, text, text, double precision, double precision, text, text, text,
  text, text, text, text, jsonb, text, jsonb, double precision)
  from public, anon, authenticated;
grant execute on function public.places_ingerer(
  text, text, text, double precision, double precision, text, text, text,
  text, text, text, text, jsonb, text, jsonb, double precision)
  to service_role;


-- ---------------------------------------------------------------------------
-- LES IMAGES, DEPUIS LES ÉVÉNEMENTS DU LIEU
--
-- Le rapprochement événement -> lieu emploie les MÊMES trois signaux que
-- l'ingestion : nom normalisé, commune, proximité. Il n'y a donc pas deux
-- façons de dire « c'est le même endroit » dans ce système.
--
-- On prend l'événement le plus récemment illustré, et on garde tout ce qui
-- fait la licence. `image_refs` conserve de quoi refaire le calcul : quel
-- événement, quelle source, quelle page.
-- ---------------------------------------------------------------------------

/* UNE IMAGE DONT ON NE SAIT PAS DIRE LA LICENCE N'EST PAS UNE IMAGE QU'ON
   AFFICHE. Trois événements portaient une URL et aucune mention de licence.
   `images.js` pose la règle pour Wikimedia — « n'entre que sous licence libre
   EXPLICITE » — et il n'y a aucune raison qu'elle soit plus souple ici. Ces
   trois-là sont écartés et comptés, plutôt que repris en silence. */
drop function if exists public.places_images_depuis_evenements(double precision);

create function public.places_images_depuis_evenements(
  p_rayon_m double precision default 200)
returns table (examines int, illustres int, ecartes_sans_licence int)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare v_exam int; v_ill int; v_ecart int;
begin
  select count(*) into v_exam from public.places where image_url is null;

  select count(distinct p.id) into v_ecart
    from public.places p
    join public.events e
      on e.image_url is not null
     and e.geom is not null and p.geom is not null
     and public.place_nom_normalise(coalesce(e.place_name, e.venue_name)) = p.name_normalized
     and ST_DWithin(e.geom::topology.geography, p.geom::topology.geography, p_rayon_m)
   where p.image_url is null
     and nullif(btrim(coalesce(e.image_license, '')), '') is null;

  with candidat as (
    select distinct on (p.id)
      p.id as place_id, e.id as event_id, e.image_url, e.image_source,
      e.image_source_url, e.image_author, e.image_license, e.image_updated_at
    from public.places p
    join public.events e
      on e.image_url is not null
     and e.geom is not null and p.geom is not null
     and public.place_nom_normalise(coalesce(e.place_name, e.venue_name)) = p.name_normalized
     and public.commune_cle(coalesce(e.commune, e.city))
         is not distinct from public.commune_cle(coalesce(p.commune, p.city))
     and ST_DWithin(e.geom::topology.geography, p.geom::topology.geography, p_rayon_m)
    where p.image_url is null
      /* Aucune image Google ne peut entrer : les événements n'en portent pas,
         et on l'exige quand même — une règle qui n'est écrite nulle part est
         une règle qu'un futur import oubliera. */
      and coalesce(e.image_source, '') <> 'google_places'
      and nullif(btrim(coalesce(e.image_license, '')), '') is not null
    order by p.id, e.image_updated_at desc nulls last, e.start_at desc
  ),
  applique as (
    update public.places p set
      image_url        = c.image_url,
      image_source     = c.image_source,
      image_source_url = c.image_source_url,
      image_author     = c.image_author,
      image_license    = c.image_license,
      image_updated_at = coalesce(c.image_updated_at, now()),
      /* LE MOT QUI DIT LA VÉRITÉ : c'est l'affiche d'un événement du lieu,
         pas une photo du lieu. Le rendu sait déjà distinguer les deux. */
      image_type       = 'event_poster',
      image_refs       = p.image_refs || jsonb_build_object(
                           'origine', 'evenement_du_lieu',
                           'event_id', c.event_id,
                           'image', c.image_url,
                           'image_source', c.image_source,
                           'image_source_url', c.image_source_url,
                           'image_license', c.image_license)
    from candidat c where p.id = c.place_id
    returning p.id)
  select count(*) into v_ill from applique;

  return query select v_exam, v_ill, v_ecart;
end;
$function$;

revoke all on function public.places_images_depuis_evenements(double precision)
  from public, anon, authenticated;
grant execute on function public.places_images_depuis_evenements(double precision)
  to service_role;


-- ---------------------------------------------------------------------------
-- LES HORAIRES ET L'ADRESSE OFFICIELLE, DEPUIS `place_enrichments`
--
-- Ce que cette table sait est OBSERVÉ : elle porte des horaires vérifiés par
-- recherche web, avec une confiance et une date. Elle n'est pas une source
-- d'images — elle n'a pas de colonne pour ça.
--
-- ON NE REPREND QUE CE QUI EST DATÉ ET SÛR. Les 44 lignes actuelles sont
-- toutes expirées ; expiré ne veut pas dire faux, mais veut dire « à revoir ».
-- On copie donc uniquement ce qui porte une confiance suffisante, et on note
-- d'où ça vient. Rien n'est extrapolé, rien n'est complété.
--
-- Le pont est le `place_key`, exactement comme le client l'utilise — d'où le
-- tableau `place_keys` sur `places`, qui survit à un recalage.
-- ---------------------------------------------------------------------------

create or replace function public.places_enrichir_depuis_cache(
  p_confiance_min numeric default 0.5)
returns table (apparies int, horaires int, urls int)
language plpgsql
set search_path to 'public'
as $function$
declare v_app int; v_hor int; v_url int;
begin
  with apparie as (
    select distinct on (p.id) p.id as place_id, pe.opening_hours, pe.official_url
      from public.places p
      join public.place_enrichments pe on pe.place_key = any(p.place_keys)
     where pe.confidence >= p_confiance_min
     order by p.id, pe.confidence desc, pe.checked_at desc
  ),
  applique as (
    update public.places p set
      opening_hours = coalesce(p.opening_hours, nullif(btrim(coalesce(a.opening_hours,'')),'')),
      official_url  = coalesce(p.official_url,  nullif(btrim(coalesce(a.official_url,'')),''))
    from apparie a where p.id = a.place_id
    returning p.id, a.opening_hours, a.official_url)
  select count(*), count(*) filter (where nullif(btrim(coalesce(opening_hours,'')),'') is not null),
         count(*) filter (where nullif(btrim(coalesce(official_url,'')),'') is not null)
    into v_app, v_hor, v_url from applique;

  return query select v_app, v_hor, v_url;
end;
$function$;

revoke all on function public.places_enrichir_depuis_cache(numeric)
  from public, anon, authenticated;
grant execute on function public.places_enrichir_depuis_cache(numeric) to service_role;


-- ---------------------------------------------------------------------------
-- LA MESURE DE QUALITÉ — parce qu'un inventaire qu'on ne mesure pas se dégrade
-- sans que personne s'en aperçoive.
--
-- « Exploitable par Explorer » est délibérément exigeant : une famille pour
-- savoir où le ranger, et de quoi remplir une carte — une image ou un texte.
-- Un nom et un point sur une carte ne font pas une carte lisible.
-- ---------------------------------------------------------------------------

create or replace view public.places_qualite as
  select
    count(*)                                                          as total,
    count(*) filter (where family is not null)                        as avec_famille,
    count(*) filter (where image_url is not null)                     as avec_image,
    count(*) filter (where image_url is null)                         as en_repli_visuel,
    count(*) filter (where description is not null)                   as avec_description,
    count(*) filter (where opening_hours is not null)                 as avec_horaires,
    count(*) filter (where address is not null)                       as avec_adresse,
    count(*) filter (where match_status = 'matched')                  as rapproches,
    count(*) filter (where match_status = 'unresolved')               as ambigus,
    count(*) filter (where family is not null
                       and (image_url is not null or description is not null))
                                                                      as exploitables_explorer
  from public.places
 where status <> 'disabled' and duplicate_of is null;

grant select on public.places_qualite to anon, authenticated, service_role;

-- LE GRANT PAR DÉFAUT DE SUPABASE S'APPLIQUE AUSSI AUX VUES, et il est
-- généreux. `places_qualite` est née avec des droits d'écriture qui ne veulent
-- rien dire sur une vue. On la ramène à ce qu'elle est : une lecture.
revoke all on public.places_qualite from anon, authenticated, public;
grant select on public.places_qualite to anon, authenticated, service_role;
