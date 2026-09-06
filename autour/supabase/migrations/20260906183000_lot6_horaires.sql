-- ---------------------------------------------------------------------------
-- LOT 6 · 2 — LES HORAIRES, ET LE DROIT DE NE PAS SAVOIR
--
-- CE QUE L'AUDIT A MESURÉ, ET QU'IL FAUT LIRE AVANT CE FICHIER
--
--   · `places.opening_hours` : 0 ligne sur 823.
--   · DATAtourisme, 49 POI réels autour de Lille : 0 `officialOpeningHours`.
--   · Wikidata, propriété P8626 (horaires en syntaxe OSM), rayon 15 km : 0 item.
--   · `place_enrichments` : 44 lignes, 0 `opening_hours`, 8 `today_hours`,
--     et les 44 SONT PRODUITES PAR UN MODÈLE. Un horaire produit par un modèle
--     n'est pas un horaire : cette table n'alimentera rien ici.
--   · OSM/Overpass en porte, mais sa persistance est exclue depuis le Lot 4.
--   · Google Places : interdit.
--
-- Autrement dit : ce fichier construit une machine qui, aujourd'hui, n'a rien
-- à moudre. C'est délibéré. Le format et la règle doivent exister AVANT la
-- donnée, sinon la première source qui arrivera sera bricolée à la hâte — et
-- c'est comme ça qu'on finit par afficher « ouvert » à quelqu'un devant une
-- porte close.
--
-- LA RÈGLE QUI GOUVERNE TOUT LE FICHIER
--
--   Absence d'horaire → `inconnu`. JAMAIS `ouvert`.
--   Horaire qu'on ne sait pas lire → `inconnu`. Jamais une interprétation.
--
-- Et tant que `horaires_fiables` est faux partout, `places` n'entre pas dans
-- les trois résultats de « Maintenant ». Le Lot 6 ne change pas cela.
-- ---------------------------------------------------------------------------


-- ---- Ce qu'un lieu sait de ses propres horaires ---------------------------
alter table public.places
  add column if not exists opening_hours_source     text,
  add column if not exists opening_hours_checked_at timestamptz,
  -- Un horaire sans fuseau est une heure sans lieu. En France métropolitaine
  -- c'est Europe/Paris ; la colonne existe pour que ça reste une DONNÉE et non
  -- une supposition enfouie dans du code.
  add column if not exists opening_hours_tz         text not null default 'Europe/Paris',
  -- Une fermeture temporaire n'est pas un horaire : c'est un fait qui prime
  -- sur l'horaire habituel, et qui a une fin.
  add column if not exists temporarily_closed       boolean not null default false,
  add column if not exists closed_until             date,
  add column if not exists closure_reason           text;

comment on column public.places.opening_hours is
  'Horaires en syntaxe OSM (« Mo-Fr 09:00-18:00 »), tels que la source les a donnés. Jamais reconstruits.';
comment on column public.places.opening_hours_source is
  'Qui a fourni l''horaire. Nul = personne : l''état sera « inconnu ».';


-- ---------------------------------------------------------------------------
-- L'ANALYSE — un sous-ensemble d'OSM, et le refus explicite du reste
--
-- Reconnu : `24/7` ; `Mo-Fr 09:00-12:00,14:00-18:00` ; `Sa 10:00-13:00` ;
-- `Su off` ; les plages qui passent minuit (`Fr-Sa 20:00-02:00`) ; les saisons
-- (`Apr-Sep Mo-Su 10:00-19:00`) ; plusieurs règles séparées par `;`.
--
-- TOUT LE RESTE EST REFUSÉ EN BLOC. Une seule règle incomprise et l'analyse
-- entière rend `reconnu: false` : mieux vaut ne rien dire que dire à moitié.
-- On ne « garde que ce qu'on a compris » d'un horaire — le morceau incompris
-- est souvent l'exception qui ferme la porte.
-- ---------------------------------------------------------------------------
create or replace function public.horaires_analyser(p_horaires text)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_txt text;
  v_regles jsonb := '[]'::jsonb;
  v_regle text; v_reste text;
  v_mois int[]; v_jours int[]; v_plages jsonb;
  m text[]; j text; morceau text;
  v_d1 int; v_d2 int; v_k int;
  MOIS constant text[] := array['jan','feb','mar','apr','may','jun',
                               'jul','aug','sep','oct','nov','dec'];
  JOURS constant text[] := array['mo','tu','we','th','fr','sa','su'];
begin
  v_txt := btrim(coalesce(p_horaires, ''));
  if v_txt = '' then return jsonb_build_object('reconnu', false, 'motif', 'vide'); end if;

  if lower(v_txt) = '24/7' then
    return jsonb_build_object('reconnu', true, 'regles', jsonb_build_array(
      jsonb_build_object('mois', null, 'jours', jsonb_build_array(1,2,3,4,5,6,7),
        'plages', jsonb_build_array(jsonb_build_array('00:00','24:00')))));
  end if;

  foreach v_regle in array regexp_split_to_array(v_txt, '\s*;\s*')
  loop
    v_regle := btrim(v_regle);
    continue when v_regle = '';
    v_mois := null; v_reste := v_regle;

    -- Une saison en tête : « Apr-Sep … »
    m := regexp_match(v_reste, '^([A-Za-z]{3})\s*-\s*([A-Za-z]{3})\s+(.*)$');
    if m is not null
       and array_position(MOIS, lower(m[1])) is not null
       and array_position(MOIS, lower(m[2])) is not null then
      v_mois := array[array_position(MOIS, lower(m[1])),
                      array_position(MOIS, lower(m[2]))];
      v_reste := btrim(m[3]);
    end if;

    -- Le sélecteur de jours, puis ce qui suit.
    m := regexp_match(v_reste, '^([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+(.*)$');
    if m is null then
      return jsonb_build_object('reconnu', false, 'motif', 'sélecteur de jours illisible : ' || v_regle);
    end if;

    v_jours := array[]::int[];
    foreach j in array regexp_split_to_array(m[1], '\s*,\s*')
    loop
      if position('-' in j) > 0 then
        v_d1 := array_position(JOURS, lower(btrim(split_part(j, '-', 1))));
        v_d2 := array_position(JOURS, lower(btrim(split_part(j, '-', 2))));
        if v_d1 is null or v_d2 is null then
          return jsonb_build_object('reconnu', false, 'motif', 'jour inconnu : ' || j);
        end if;
        v_k := v_d1;
        loop
          v_jours := v_jours || v_k;
          exit when v_k = v_d2;
          v_k := case when v_k = 7 then 1 else v_k + 1 end;   -- « Sa-Mo » existe
        end loop;
      else
        v_d1 := array_position(JOURS, lower(btrim(j)));
        if v_d1 is null then
          return jsonb_build_object('reconnu', false, 'motif', 'jour inconnu : ' || j);
        end if;
        v_jours := v_jours || v_d1;
      end if;
    end loop;

    v_reste := btrim(m[2]);

    if lower(v_reste) in ('off', 'closed') then
      v_regles := v_regles || jsonb_build_object(
        'mois', case when v_mois is null then null else to_jsonb(v_mois) end,
        'jours', to_jsonb(v_jours), 'plages', '[]'::jsonb, 'ferme', true);
      continue;
    end if;

    v_plages := '[]'::jsonb;
    foreach morceau in array regexp_split_to_array(v_reste, '\s*,\s*')
    loop
      m := regexp_match(btrim(morceau), '^([0-2][0-9]):([0-5][0-9])\s*-\s*([0-2][0-9]):([0-5][0-9])$');
      if m is null then
        return jsonb_build_object('reconnu', false, 'motif', 'plage illisible : ' || morceau);
      end if;
      if m[1]::int > 24 or m[3]::int > 24 then
        return jsonb_build_object('reconnu', false, 'motif', 'heure hors bornes : ' || morceau);
      end if;
      v_plages := v_plages || jsonb_build_array(
        jsonb_build_array(m[1] || ':' || m[2], m[3] || ':' || m[4]));
    end loop;

    v_regles := v_regles || jsonb_build_object(
      'mois', case when v_mois is null then null else to_jsonb(v_mois) end,
      'jours', to_jsonb(v_jours), 'plages', v_plages, 'ferme', false);
  end loop;

  if jsonb_array_length(v_regles) = 0 then
    return jsonb_build_object('reconnu', false, 'motif', 'aucune règle');
  end if;
  return jsonb_build_object('reconnu', true, 'regles', v_regles);
end;
$function$;

comment on function public.horaires_analyser(text) is
  'Analyse un sous-ensemble de la syntaxe OSM. Une seule règle incomprise rend reconnu:false — on ne garde jamais la moitié d''un horaire.';

grant execute on function public.horaires_analyser(text) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- L'ÉTAT — ouvert, fermé, ou inconnu, à un instant donné
--
-- `inconnu` n'est pas un échec : c'est la réponse honnête quand on ne sait
-- pas. Elle vaut mieux que les deux autres quand elle est vraie.
-- ---------------------------------------------------------------------------
create or replace function public.horaires_etat(
  p_horaires        text,
  p_instant         timestamptz default now(),
  p_tz              text default 'Europe/Paris',
  p_ferme_temporairement boolean default false,
  p_ferme_jusqu_au  date default null)
returns table (etat text, ouvre_a timestamptz, ferme_a timestamptz)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  a jsonb; r jsonb; pl jsonb;
  v_tz text := coalesce(nullif(btrim(coalesce(p_tz,'')),''), 'Europe/Paris');
  v_local timestamp;
  v_jour int; v_mois int; v_veille int;
  v_deb time; v_fin time;
  v_debut_ts timestamptz; v_fin_ts timestamptz;
  v_ouvert boolean := false;
  v_ferme_a timestamptz := null;
  v_ouvre_a timestamptz := null;
  v_candidat timestamptz;
  d int;
begin
  /* Une fermeture temporaire prime sur tout horaire habituel : le lieu est
     fermé, et on sait jusqu'à quand — ou on ne le sait pas, et c'est encore
     une information. */
  if coalesce(p_ferme_temporairement, false)
     and (p_ferme_jusqu_au is null or p_ferme_jusqu_au >= (p_instant at time zone v_tz)::date) then
    return query select 'ferme'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  a := public.horaires_analyser(p_horaires);
  if not coalesce((a ->> 'reconnu')::boolean, false) then
    return query select 'inconnu'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_local  := p_instant at time zone v_tz;
  v_jour   := extract(isodow from v_local)::int;
  v_mois   := extract(month from v_local)::int;
  v_veille := case when v_jour = 1 then 7 else v_jour - 1 end;

  for r in select * from jsonb_array_elements(a -> 'regles')
  loop
    -- La saison, quand il y en a une. « Oct-Mar » enjambe l'année.
    if r -> 'mois' is not null and jsonb_typeof(r -> 'mois') = 'array' then
      declare m1 int := (r -> 'mois' ->> 0)::int; m2 int := (r -> 'mois' ->> 1)::int;
      begin
        if m1 <= m2 then
          continue when v_mois < m1 or v_mois > m2;
        else
          continue when v_mois < m1 and v_mois > m2;
        end if;
      end;
    end if;
    continue when coalesce((r ->> 'ferme')::boolean, false);

    for pl in select * from jsonb_array_elements(r -> 'plages')
    loop
      v_deb := (pl ->> 0)::time;
      v_fin := case when (pl ->> 1) = '24:00' then '00:00'::time else (pl ->> 1)::time end;

      -- La plage du JOUR COURANT.
      if r -> 'jours' @> to_jsonb(v_jour) then
        v_debut_ts := (date_trunc('day', v_local) + v_deb) at time zone v_tz;
        if (pl ->> 1) = '24:00' then
          /* `24:00` est la fin du jour, c'est-à-dire minuit du jour suivant —
             pas 23:59. Un lieu ouvert « 00:00-24:00 » ne ferme pas une minute
             avant minuit. */
          v_fin_ts := (date_trunc('day', v_local) + interval '1 day') at time zone v_tz;
        elsif v_fin > v_deb then
          v_fin_ts := (date_trunc('day', v_local) + v_fin) at time zone v_tz;
        else
          /* Après minuit : « 20:00-02:00 » finit le lendemain. */
          v_fin_ts := (date_trunc('day', v_local) + interval '1 day' + v_fin) at time zone v_tz;
        end if;
        if p_instant >= v_debut_ts and p_instant < v_fin_ts then
          v_ouvert := true;
          if v_ferme_a is null or v_fin_ts > v_ferme_a then v_ferme_a := v_fin_ts; end if;
        elsif p_instant < v_debut_ts then
          if v_ouvre_a is null or v_debut_ts < v_ouvre_a then v_ouvre_a := v_debut_ts; end if;
        end if;
      end if;

      -- La plage de LA VEILLE qui déborde sur aujourd'hui.
      if r -> 'jours' @> to_jsonb(v_veille)
         and (pl ->> 1) <> '24:00' and v_fin <= v_deb then
        v_debut_ts := (date_trunc('day', v_local) - interval '1 day' + v_deb) at time zone v_tz;
        v_fin_ts   := (date_trunc('day', v_local) + v_fin) at time zone v_tz;
        if p_instant >= v_debut_ts and p_instant < v_fin_ts then
          v_ouvert := true;
          if v_ferme_a is null or v_fin_ts > v_ferme_a then v_ferme_a := v_fin_ts; end if;
        end if;
      end if;
    end loop;
  end loop;

  /* S'il n'ouvre plus aujourd'hui, la prochaine ouverture est cherchée sur les
     sept jours suivants — répondre « fermé » sans dire quand on rouvre, c'est
     une demi-réponse. */
  if not v_ouvert and v_ouvre_a is null then
    for d in 1..7 loop
      for r in select * from jsonb_array_elements(a -> 'regles')
      loop
        continue when coalesce((r ->> 'ferme')::boolean, false);
        if r -> 'mois' is not null and jsonb_typeof(r -> 'mois') = 'array' then
          declare
            m1 int := (r -> 'mois' ->> 0)::int; m2 int := (r -> 'mois' ->> 1)::int;
            mj int := extract(month from (v_local + (d || ' days')::interval))::int;
          begin
            if m1 <= m2 then continue when mj < m1 or mj > m2;
            else continue when mj < m1 and mj > m2; end if;
          end;
        end if;
        continue when not (r -> 'jours' @> to_jsonb(
          extract(isodow from (v_local + (d || ' days')::interval))::int));
        for pl in select * from jsonb_array_elements(r -> 'plages')
        loop
          v_candidat := (date_trunc('day', v_local) + (d || ' days')::interval
                         + (pl ->> 0)::time) at time zone v_tz;
          if v_ouvre_a is null or v_candidat < v_ouvre_a then v_ouvre_a := v_candidat; end if;
        end loop;
      end loop;
      exit when v_ouvre_a is not null;
    end loop;
  end if;

  return query select
    case when v_ouvert then 'ouvert' else 'ferme' end,
    case when v_ouvert then null else v_ouvre_a end,
    case when v_ouvert then v_ferme_a else null end;
end;
$function$;

comment on function public.horaires_etat(text, timestamptz, text, boolean, date) is
  'ouvert / ferme / inconnu à un instant donné. Une absence d''horaire rend « inconnu », jamais « ouvert ».';

grant execute on function public.horaires_etat(text, timestamptz, text, boolean, date)
  to anon, authenticated, service_role;


-- ---- L'ingestion : seulement ce qu'une source a réellement dit -------------
--
-- Elle refuse ce qu'elle ne sait pas lire, plutôt que de l'écrire en espérant
-- que ça passe. Un horaire stocké est un horaire qu'on saura évaluer.
create or replace function public.places_poser_horaires(
  p_place_id uuid,
  p_horaires text,
  p_source   text)
returns text
language plpgsql
set search_path to 'public'
as $function$
declare v_a jsonb;
begin
  if p_place_id is null then return 'sans lieu'; end if;
  if nullif(btrim(coalesce(p_horaires,'')),'') is null then return 'vide'; end if;
  if nullif(btrim(coalesce(p_source,'')),'') is null then return 'sans source'; end if;

  v_a := public.horaires_analyser(p_horaires);
  if not coalesce((v_a ->> 'reconnu')::boolean, false) then
    return 'refusé : ' || coalesce(v_a ->> 'motif', 'illisible');
  end if;

  update public.places
     set opening_hours = btrim(p_horaires),
         opening_hours_source = btrim(p_source),
         opening_hours_checked_at = now()
   where id = p_place_id;
  return 'posé';
end;
$function$;

revoke all on function public.places_poser_horaires(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.places_poser_horaires(uuid, text, text) to service_role;


-- ---- La mesure -------------------------------------------------------------
create or replace view public.places_horaires_qualite as
  select
    count(*)                                                        as eligibles,
    count(*) filter (where nullif(btrim(coalesce(p.opening_hours,'')),'') is not null) as avec_horaires,
    count(*) filter (where coalesce((public.horaires_analyser(p.opening_hours) ->> 'reconnu')::boolean, false)) as horaires_lisibles,
    count(*) filter (where p.temporarily_closed)                    as fermetures_temporaires,
    count(distinct p.opening_hours_source)
      filter (where p.opening_hours_source is not null)             as sources
  from public.places p
  join public.place_familles f on f.famille = p.family
 where p.status = 'active' and p.duplicate_of is null and p.geom is not null;

revoke all on public.places_horaires_qualite from anon, authenticated, public;
grant select on public.places_horaires_qualite to service_role;
