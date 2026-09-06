-- ---------------------------------------------------------------------------
-- LOT 4 — LA RÉCOLTE DATATOURISME, CÔTÉ SERVEUR
--
-- POURQUOI PASSER PAR LA BASE ET NON PAR LE NAVIGATEUR
--
-- L'ingestion est une écriture. Elle n'a rien à faire dans un navigateur, et
-- `places` ne lui est de toute façon pas ouverte. La récolte vit donc là où
-- vivent déjà les autres synchronisations d'Autour : dans la base, avec
-- `pg_net`, exactement comme `openagenda_sonder` interroge OpenAgenda.
--
-- ELLE NE PARLE PAS DIRECTEMENT AU CATALOGUE. Elle appelle `/api/datatourisme`,
-- la route d'Autour, qui porte déjà la clé, la mise en cache, le filtrage des
-- licences d'image et la normalisation vers le vocabulaire d'Autour. Écrire un
-- second client DATAtourisme ici donnerait deux normalisations à maintenir et
-- deux façons de se tromper.
--
-- CE QUI EST PERSISTÉ, ET SOUS QUELLE LICENCE
--   DATAtourisme, Licence Ouverte / Etalab : la persistance est autorisée,
--   l'attribution est due, et elle est déjà portée par les mentions légales.
--   Rien d'OpenStreetMap et rien de Google ne transite par cette porte.
--
-- CE QUI EST ÉCARTÉ
--   · `isTemporary` — un événement n'est pas un lieu ; `events` s'en occupe.
--   · les types `Event` et `Product` — une visite guidée est une prestation,
--     pas un endroit. Elle a un titre, une date et un tarif ; lui donner une
--     ligne dans l'inventaire des lieux, c'est promettre une porte qui n'existe
--     pas.
--   · une image dont la route n'a pas su lire la licence : elle arrive vide,
--     et une colonne vide reste vide. On n'en fabrique pas.
-- ---------------------------------------------------------------------------

create or replace function public.places_recolter_datatourisme(
  p_lat double precision,
  p_lng double precision)
returns bigint
language plpgsql
set search_path to 'public', 'net'
as $function$
declare
  v_id bigint;
begin
  select net.http_get(
    'https://autour.eu/api/datatourisme?lat=' || round(p_lat::numeric, 4)
      || '&lng=' || round(p_lng::numeric, 4)) into v_id;
  return v_id;
end;
$function$;

revoke all on function public.places_recolter_datatourisme(double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.places_recolter_datatourisme(double precision, double precision)
  to service_role;


-- Le versement dans l'inventaire. Séparé de la récolte parce que `pg_net` est
-- asynchrone : la réponse arrive dans `net._http_response`, et on ne bloque pas
-- une transaction en attendant le réseau.
create or replace function public.places_verser_datatourisme(
  p_requete_id bigint)
returns table (lus int, retenus int, crees int, rapproches int, revus int, ambigus int)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  v_corps jsonb;
  v_statut int;
  it jsonb;
  r record;
  v_cp text; v_ville text; v_type text;
  v_lus int := 0; v_ret int := 0;
  v_cree int := 0; v_rap int := 0; v_revu int := 0; v_amb int := 0;
begin
  select rep.status_code, rep.content::jsonb into v_statut, v_corps
    from net._http_response rep where rep.id = p_requete_id;
  if v_statut is null or v_statut <> 200 or v_corps is null then
    return query select 0, 0, 0, 0, 0, 0;
    return;
  end if;

  for it in select * from jsonb_array_elements(coalesce(v_corps->'items', '[]'::jsonb))
  loop
    v_lus := v_lus + 1;
    v_type := coalesce(it->>'type', '');
    continue when coalesce((it->>'isTemporary')::boolean, false);
    continue when v_type like '%Event%' or v_type like '%Product%';
    continue when nullif(btrim(coalesce(it->>'titre','')), '') is null;
    continue when it->>'lat' is null or it->>'lng' is null;
    v_ret := v_ret + 1;

    -- « 59800 Lille » : le code postal d'un côté, la commune de l'autre.
    v_cp := nullif(substring(coalesce(it->>'cp','') from '^([0-9]{5})'), '');
    v_ville := nullif(btrim(regexp_replace(coalesce(it->>'cp',''), '^[0-9]{5}\s*', '')), '');

    select * into r from public.places_ingerer(
      p_source      => 'datatourisme',
      p_external_id => it->>'id',
      p_nom         => it->>'titre',
      p_lat         => (it->>'lat')::double precision,
      p_lng         => (it->>'lng')::double precision,
      p_adresse     => nullif(btrim(coalesce(it->>'adresse','')), ''),
      p_code_postal => v_cp,
      p_ville       => v_ville,
      p_categorie   => nullif(btrim(coalesce(it->>'cat','')), ''),
      p_description => left(nullif(btrim(coalesce(it->>'description','')), ''), 4000),
      p_horaires    => nullif(btrim(coalesce(it->>'officialOpeningHours','')), ''),
      -- Les entrées du résolveur, pas une URL finale : `images.js` doit
      -- pouvoir refaire le calcul. Vide si la route n'a pas su lire la licence.
      p_image_refs  => case
                         when nullif(btrim(coalesce(it->>'image','')), '') is null
                           then '{}'::jsonb
                         else jsonb_build_object(
                                'image', it->>'image',
                                'image_source', coalesce(nullif(it->>'imageSource',''), 'datatourisme'))
                       end,
      p_raw         => jsonb_build_object('type', v_type));

    if r.place_id is null then continue; end if;
    if    r.action = 'cree'      then v_cree := v_cree + 1;
    elsif r.action = 'rapproche' then v_rap  := v_rap  + 1;
    elsif r.action = 'revu'      then v_revu := v_revu + 1;
    elsif r.action = 'ambigu'    then v_amb  := v_amb  + 1;
    end if;
  end loop;

  return query select v_lus, v_ret, v_cree, v_rap, v_revu, v_amb;
end;
$function$;

revoke all on function public.places_verser_datatourisme(bigint)
  from public, anon, authenticated;
grant execute on function public.places_verser_datatourisme(bigint) to service_role;
