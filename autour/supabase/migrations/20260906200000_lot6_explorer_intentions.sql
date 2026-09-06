-- ---------------------------------------------------------------------------
-- LOT 6 · 5 — EXPLORER RÉPOND À UNE INTENTION, PAS À UN ANNUAIRE
--
-- CE QUE L'AUDIT A MONTRÉ
--
-- Au centre de Lille, les douze lieux rendus par `lieux_explorer` étaient :
-- six restaurants, deux hôtels, deux fois le même théâtre, un musée, et une
-- entreprise de taxi-vélo classée « nature ». Tri par distance pure, dans le
-- quartier le plus dense de la métropole : c'est mécaniquement un annuaire de
-- la restauration.
--
-- Et aucune des six sélections d'Explorer n'interrogeait cette porte : elles
-- passaient toutes par la recherche textuelle du runtime. « Nature » ne
-- pouvait donc pas privilégier les lieux nature de l'inventaire — elle ne le
-- lisait pas.
--
-- CE QUE CETTE VERSION CHANGE
--
--   1. `p_familles` : une intention est une LISTE de familles, pas un filtre
--      unique. « Étudier » veut dire bibliothèques ET lieux de culture qui
--      accueillent, pas seulement l'une des deux.
--   2. `p_par_famille` : un plafond par famille. Sans lui, la famille la plus
--      dense mange la réponse — c'est exactement ce qui se passait.
--   3. L'ordre exprime l'intention : ce qui a une VRAIE photo passe devant ce
--      qui a une affiche, qui passe devant ce qui n'a qu'un texte. À qualité
--      égale, la distance tranche.
--   4. L'état horaire voyage avec le lieu — `inconnu` tant qu'on ne sait pas.
--
-- CE QUE ÇA NE CHANGE PAS
--
-- Aucune famille n'est exclue par la base : c'est l'appelant qui dit ce qu'il
-- veut. La base ne décide pas à sa place ce qui est « intéressant ».
-- ---------------------------------------------------------------------------

drop function if exists public.lieux_explorer(
  text, text, double precision, double precision, double precision, integer, boolean);

create or replace function public.lieux_explorer(
  p_zone_id      text,
  p_famille      text default null,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_rayon_m      double precision default null,
  p_limite       integer default 30,
  p_visuel_exige boolean default false,
  p_familles     text[] default null,
  p_par_famille  integer default null)
returns table (
  id             uuid,
  slug           text,
  name           text,
  family         text,
  famille_label  text,
  lat            double precision,
  lng            double precision,
  address        text,
  commune        text,
  description    text,
  official_url   text,
  image_url      text,
  image_source   text,
  image_author   text,
  image_license  text,
  -- `place_photo` | `wikimedia` | `institutional` | `event_poster` | null.
  -- Le client doit pouvoir dire CE QUE MONTRE l'image sans le deviner.
  image_type     text,
  opening_hours  text,
  horaires_fiables boolean,
  -- `ouvert` | `ferme` | `inconnu`. Jamais « ouvert » sans horaire.
  etat_horaire   text,
  ouvre_a        timestamptz,
  ferme_a        timestamptz,
  distance_m     double precision)
language sql
stable
set search_path to 'public', 'topology'
as $function$
  with candidats as (
    select
      p.id, p.slug, p.name, p.family, f.label as famille_label, f.rang as famille_rang,
      p.lat, p.lng, p.address, p.commune, p.description, p.official_url,
      p.image_url, p.image_source, p.image_author, p.image_license, p.image_type,
      p.opening_hours,
      (p.opening_hours is not null and btrim(p.opening_hours) <> '') as horaires_fiables,
      p.temporarily_closed, p.closed_until, p.opening_hours_tz,
      case when p_lat is null or p_lng is null then null
           else ST_Distance(p.geom::topology.geography,
                  ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography)
      end as distance_m,
      /* Le rang de l'image dit ce qu'elle vaut pour représenter un LIEU :
         une vraie photo d'abord, une affiche d'événement en dernier — et
         seulement si elle porte sa licence. */
      case
        when p.image_url is null or nullif(btrim(coalesce(p.image_license,'')),'') is null then 9
        when p.image_type = 'place_photo'   then 1
        when p.image_type = 'wikimedia'     then 2
        when p.image_type = 'institutional' then 3
        when p.image_type = 'event_poster'  then 4
        else 9
      end as image_rang,
      /* La qualité de l'image ne doit pas faire remonter une médiathèque à
         16 km devant un musée à 800 m. On range d'abord ce qui est ATTEIGNABLE,
         puis, à l'intérieur, la vraie photo passe devant l'affiche. */
      (p_lat is null or p_lng is null
       or ST_DWithin(p.geom::topology.geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography,
            coalesce(p_rayon_m, 5000))) as proche
    from public.places p
    join public.place_familles f on f.famille = p.family
    where p.status = 'active'
      and p.duplicate_of is null
      and p.family is not null
      and p.geom is not null
      and p.lat is not null and p.lng is not null
      and (p_zone_id is null or p.zone_id = p_zone_id)
      and (p_famille is null or p.family = p_famille)
      and (p_familles is null or p.family = any(p_familles))
      and (not p_visuel_exige
           or p.image_url is not null
           or (p.description is not null and btrim(p.description) <> ''))
      and (p_lat is null or p_lng is null or p_rayon_m is null
           or ST_DWithin(p.geom::topology.geography,
                ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography, p_rayon_m))
  ),
  rangee as (
    select c.*,
      row_number() over (
        partition by c.family
        order by c.proche desc, c.image_rang, (c.description is null),
                 c.distance_m nulls last, c.name
      ) as rang_dans_famille
    from candidats c
  )
  select
    r.id, r.slug, r.name, r.family, r.famille_label,
    r.lat, r.lng, r.address, r.commune, r.description, r.official_url,
    r.image_url, r.image_source, r.image_author, r.image_license, r.image_type,
    r.opening_hours, r.horaires_fiables,
    h.etat, h.ouvre_a, h.ferme_a,
    r.distance_m
  from rangee r
  cross join lateral public.horaires_etat(
    r.opening_hours, now(), r.opening_hours_tz, r.temporarily_closed, r.closed_until) h
  where p_par_famille is null or r.rang_dans_famille <= greatest(p_par_famille, 1)
  order by
    /* Quand plusieurs familles sont demandées, l'ordre des familles est celui
       de la taxonomie : la réponse garde la forme de l'intention plutôt que
       de se remplir par le quartier le plus dense. */
    case when p_familles is null or array_length(p_familles, 1) <= 1
         then 0 else r.rang_dans_famille end,
    case when p_familles is null or array_length(p_familles, 1) <= 1
         then 0 else r.famille_rang end,
    r.proche desc,
    r.image_rang,
    (r.description is null),
    r.distance_m nulls last,
    r.name
  limit least(greatest(coalesce(p_limite, 30), 1), 120);
$function$;

grant execute on function public.lieux_explorer(
  text, text, double precision, double precision, double precision, integer,
  boolean, text[], integer)
  to anon, authenticated, service_role;

comment on function public.lieux_explorer(
  text, text, double precision, double precision, double precision, integer,
  boolean, text[], integer) is
  'Les lieux présentables dans Explorer, en réponse à une INTENTION : une liste de familles, un plafond par famille, et l''ordre qui met les vraies photos devant. Jamais de lieu non classé, jamais de satellite, jamais d''ouverture affirmée sans horaire.';


-- ---- Le doublon que l'audit a trouvé ---------------------------------------
--
-- « Théâtre Sébastopol » et « Théâtre Sébastopol Lille Nord Haut de France » :
-- mêmes coordonnées au mètre près, même famille, deux fiches. Le rapprochement
-- du Lot 4 compare des noms normalisés ÉGAUX ; ici l'un est le PRÉFIXE de
-- l'autre, ce qui n'est pas la même chose.
--
-- La règle ajoutée est volontairement étroite : même famille, moins de 60 m,
-- et l'un des noms normalisés commence exactement par l'autre, le plus court
-- faisant au moins 12 caractères. « Parc » préfixe de « Parc des Sports » ne
-- déclenche rien — trop court. Et le survivant est le plus ancien, celui qui
-- porte déjà des références ailleurs.
create or replace function public.places_rapprocher_prefixes(p_appliquer boolean default false)
returns table (paires integer, fusionnes integer)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare c record; v_p int := 0; v_f int := 0;
begin
  for c in
    select a.id as garde, b.id as satellite, a.name as nom_garde, b.name as nom_sat
      from public.places a
      join public.places b
        on b.id <> a.id
       and b.family = a.family
       and b.status = 'active' and b.duplicate_of is null
       and a.status = 'active' and a.duplicate_of is null
       and ST_DWithin(a.geom::topology.geography, b.geom::topology.geography, 60)
       and length(a.name_normalized) >= 12
       and b.name_normalized like a.name_normalized || ' %'
       and a.created_at <= b.created_at
     where a.geom is not null and b.geom is not null
  loop
    v_p := v_p + 1;
    if p_appliquer then
      /* Le satellite garde son `status` : la convention de l'inventaire est
         que `duplicate_of` suffit à le sortir des réponses, et `status` ne
         connaît que 'active' / 'stale' / 'disabled'. */
      update public.places set duplicate_of = c.garde, updated_at = now()
       where id = c.satellite and duplicate_of is null;
      v_f := v_f + 1;
    end if;
  end loop;
  return query select v_p, v_f;
end;
$function$;

revoke all on function public.places_rapprocher_prefixes(boolean)
  from public, anon, authenticated;
grant execute on function public.places_rapprocher_prefixes(boolean) to service_role;
