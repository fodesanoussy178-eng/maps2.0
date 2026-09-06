-- ---------------------------------------------------------------------------
-- LOT 4 — L'INGESTION, ET LE RAPPROCHEMENT PROGRESSIF
--
-- Une seule porte écrit dans l'inventaire. Elle porte les deux niveaux de
-- rapprochement décrits au lot, et elle est la seule chose que la couche
-- serveur appelle.
--
-- NIVEAU 1 — L'IDENTITÉ EXTERNE EXACTE.
--   Le même `source` + `external_id` désigne le même lieu, sans discussion et
--   sans heuristique. C'est la contrainte `UNIQUE(source, external_id)` de
--   `place_sources` qui le garantit, exactement comme pour les événements.
--   Resynchroniser un catalogue ne peut donc pas créer de doublon.
--
-- NIVEAU 2 — LE RAPPROCHEMENT FIABLE, ET SEULEMENT LUI.
--   Trois signaux exigés ENSEMBLE : nom normalisé identique, même commune,
--   et moins de `p_rayon_m` mètres d'écart. « Le Grand Sud » et « grand sud »
--   au même endroit se rejoignent ; deux « Le Chat Noir » dans deux communes,
--   ou à huit cents mètres l'un de l'autre, restent deux lieux — parce qu'ils
--   le sont probablement.
--
-- LE DOUTE NE FUSIONNE PAS.
--   Si plusieurs lieux existants satisfont ces trois signaux, on ne choisit
--   pas : on crée une entrée marquée `unresolved` en notant les candidats.
--   Garder deux fiches séparables coûte un doublon visible ; fusionner deux
--   lieux différents donne à l'un la photo, les horaires et l'adresse de
--   l'autre, et cette erreur-là ne se voit pas.
--
-- CE QU'ELLE N'ÉCRASE JAMAIS.
--   Une resynchronisation ne remplace une valeur connue par du vide sous
--   aucun prétexte : chaque colonne est un `coalesce(nouveau, ancien)`. Un
--   catalogue qui perd temporairement une description ne la fait pas
--   disparaître de l'inventaire.
--
-- SÉCURITÉ. La fonction est SECURITY INVOKER — délibérément. Elle n'a besoin
--   d'aucun privilège qu'elle n'aurait pas : seul `service_role` peut
--   l'exécuter, et `service_role` écrit déjà dans ces tables. Un `DEFINER`
--   n'apporterait rien ici, sinon une surface d'attaque de plus le jour où
--   quelqu'un élargirait le droit d'exécution par mégarde.
-- ---------------------------------------------------------------------------

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
  p_rayon_m     double precision default 150)
returns table (place_id uuid, statut text, action text)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  v_nom_norm  text := public.place_nom_normalise(p_nom);
  v_commune   text;
  v_cle_com   text;
  v_point     topology.geometry;
  v_id        uuid;
  v_candidats uuid[];
  v_statut    text;
  v_action    text;
begin
  -- Un lieu sans nom exploitable ou sans position n'est pas un lieu : il n'a
  -- ni identité ni géographie, et rien ne pourrait le rapprocher plus tard.
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

  -- ---- Niveau 1 : cette source a-t-elle déjà nommé ce lieu ? --------------
  select ps.place_id into v_id
    from public.place_sources ps
   where ps.source = p_source and ps.external_id = p_external_id;

  if v_id is not null then
    v_statut := 'exact';
    v_action := 'revu';
  else
    -- ---- Niveau 2 : les trois signaux, exigés ensemble --------------------
    select array_agg(p.id order by p.created_at) into v_candidats
      from public.places p
     where p.duplicate_of is null
       and p.status <> 'disabled'
       and p.name_normalized = v_nom_norm
       and public.commune_cle(coalesce(p.commune, p.city)) is not distinct from v_cle_com
       and p.geom is not null
       and ST_DWithin(p.geom::topology.geography, v_point::topology.geography, p_rayon_m);

    if v_candidats is null or array_length(v_candidats, 1) is null then
      v_id := null; v_statut := 'exact';    v_action := 'cree';
    elsif array_length(v_candidats, 1) = 1 then
      v_id := v_candidats[1];
      v_statut := 'matched'; v_action := 'rapproche';
    else
      -- Plusieurs candidats plausibles : on ne tranche pas.
      v_id := null; v_statut := 'unresolved'; v_action := 'ambigu';
    end if;
  end if;

  if v_id is null then
    insert into public.places (
      name, lat, lng, address, postal_code, city, commune,
      category, description, opening_hours, official_url,
      image_refs, match_status)
    values (
      btrim(p_nom), p_lat, p_lng, nullif(btrim(coalesce(p_adresse,'')),''),
      nullif(btrim(coalesce(p_code_postal,'')),''),
      nullif(btrim(coalesce(p_ville,'')),''), v_commune,
      nullif(btrim(coalesce(p_categorie,'')),''),
      nullif(btrim(coalesce(p_description,'')),''),
      nullif(btrim(coalesce(p_horaires,'')),''),
      nullif(btrim(coalesce(p_url,'')),''),
      coalesce(p_image_refs, '{}'::jsonb), v_statut)
    returning id into v_id;
  else
    -- Jamais un écrasement par du vide : `coalesce(nouveau, ancien)`.
    update public.places p set
      address       = coalesce(nullif(btrim(coalesce(p_adresse,'')),''), p.address),
      postal_code   = coalesce(nullif(btrim(coalesce(p_code_postal,'')),''), p.postal_code),
      city          = coalesce(p.city, nullif(btrim(coalesce(p_ville,'')),'')),
      category      = coalesce(nullif(btrim(coalesce(p_categorie,'')),''), p.category),
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

  -- La provenance, toujours écrite : c'est elle qui rend la prochaine
  -- synchronisation idempotente.
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
-- LE PREMIER REMPLISSAGE — DEPUIS CE QU'AUTOUR DÉTIENT DÉJÀ
--
-- Aucun appel externe. Les candidats viennent de `events`, c'est-à-dire de
-- données déjà persistées légalement par Autour (DATAtourisme sous Licence
-- Ouverte, OpenAgenda selon les conditions de chaque agenda, publications des
-- utilisateurs, sources officielles de territoire).
--
-- 498 NOMS DISTINCTS NE FONT PAS 498 LIEUX. Un `distinct name` suivi d'une
-- insertion produirait un lieu par variation de casse et d'accent, et
-- écraserait les vrais homonymes. Les candidats sont donc groupés sur QUATRE
-- signaux — nom normalisé, commune, latitude et longitude arrondies à trois
-- décimales (une centaine de mètres) — et chaque groupe est présenté une fois
-- à `places_ingerer`, qui applique ensuite ses deux niveaux.
--
-- Le grouillement de bord — deux groupes voisins séparés par l'arrondi — est
-- rattrapé par le niveau 2, qui travaille en distance réelle et non en
-- arrondi. Les deux mécanismes se complètent : l'un est bon marché, l'autre
-- est juste.
--
-- CE QUI N'EST PAS REPRIS DES ÉVÉNEMENTS, ET C'EST VOLONTAIRE :
--   · `image_url` — c'est l'affiche d'un concert, pas une photo de la salle ;
--   · `description` — elle décrit l'événement, pas le lieu ;
--   · `category` — celle d'un événement n'est pas celle d'un lieu.
--   Les recopier remplirait les compteurs et mentirait à l'écran.
-- ---------------------------------------------------------------------------

create or replace function public.places_semer_depuis_events(
  p_zone_id text default 'mel')
returns table (candidats int, crees int, rapproches int, revus int, ambigus int)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  c record;
  r record;
  v_cand int := 0; v_cree int := 0; v_rap int := 0; v_revu int := 0; v_amb int := 0;
begin
  for c in
    with brut as (
      select
        coalesce(nullif(btrim(e.place_name), ''), nullif(btrim(e.venue_name), '')) as nom,
        e.lat, e.lng, e.address, e.city, e.commune, e.id as event_id,
        e.primary_source
      from public.events e
      where e.zone_id = p_zone_id
        and e.duplicate_of is null
        and e.lat is not null and e.lng is not null
        and coalesce(nullif(btrim(e.place_name), ''), nullif(btrim(e.venue_name), '')) is not null
    ),
    groupes as (
      select
        public.place_nom_normalise(nom) as nom_norm,
        public.commune_cle(coalesce(commune, city)) as cle_commune,
        round(lat::numeric, 3) as lat3,
        round(lng::numeric, 3) as lng3,
        -- Le nom le plus fréquent du groupe fait foi : c'est celui que les
        -- catalogues écrivent le plus souvent, donc le plus reconnaissable.
        (array_agg(nom order by length(nom) desc))[1] as nom,
        avg(lat) as lat, avg(lng) as lng,
        (array_agg(address) filter (where address is not null))[1] as address,
        (array_agg(city) filter (where city is not null))[1] as city,
        (array_agg(commune) filter (where commune is not null))[1] as commune,
        count(*) as evenements,
        array_agg(distinct primary_source) as sources_amont
      from brut
      where public.place_nom_normalise(nom) is not null
        and length(public.place_nom_normalise(nom)) >= 2
      group by 1, 2, 3, 4
    )
    select * from groupes order by nom_norm, cle_commune, lat3, lng3
  loop
    v_cand := v_cand + 1;
    select * into r from public.places_ingerer(
      p_source      => 'autour_events',
      -- Identifiant stable du groupe : rejouer le semis retombe dessus, donc
      -- la seconde exécution ne crée rien.
      p_external_id => c.nom_norm || '|' || coalesce(c.cle_commune, '')
                       || '|' || c.lat3 || '|' || c.lng3,
      p_nom         => c.nom,
      p_lat         => c.lat,
      p_lng         => c.lng,
      p_adresse     => c.address,
      p_ville       => coalesce(c.commune, c.city),
      p_raw         => jsonb_build_object(
                         'evenements', c.evenements,
                         'sources_amont', to_jsonb(c.sources_amont)));
    if r.place_id is null then continue; end if;
    if    r.action = 'cree'      then v_cree := v_cree + 1;
    elsif r.action = 'rapproche' then v_rap  := v_rap  + 1;
    elsif r.action = 'revu'      then v_revu := v_revu + 1;
    elsif r.action = 'ambigu'    then v_amb  := v_amb  + 1;
    end if;
  end loop;

  return query select v_cand, v_cree, v_rap, v_revu, v_amb;
end;
$function$;

revoke all on function public.places_semer_depuis_events(text) from public, anon, authenticated;
grant execute on function public.places_semer_depuis_events(text) to service_role;


-- ---------------------------------------------------------------------------
-- LA LECTURE PUBLIQUE — UNE SEULE, GÉOGRAPHIQUE, INDEXÉE
--
-- Même forme que `evenements_locaux` : une emprise, une zone, une limite. Elle
-- passe par l'index GiST géographique, donc « les lieux à 500 m » ne balaie
-- pas la table.
-- ---------------------------------------------------------------------------

create or replace function public.lieux_locaux(
  p_zone_id text,
  p_sud double precision,
  p_ouest double precision,
  p_nord double precision,
  p_est double precision,
  p_limite integer default 200)
returns setof public.places
language sql
stable
set search_path to 'public', 'topology'
as $function$
  select p.*
    from public.places p
   where p.status <> 'disabled'
     and p.duplicate_of is null
     and p.geom is not null
     and (p_zone_id is null or p.zone_id = p_zone_id)
     and p.geom && ST_MakeEnvelope(p_ouest, p_sud, p_est, p_nord, 4326)
   order by p.last_seen_at desc
   limit least(coalesce(p_limite, 200), 500);
$function$;

grant execute on function public.lieux_locaux(
  text, double precision, double precision, double precision,
  double precision, integer) to anon, authenticated, service_role;
