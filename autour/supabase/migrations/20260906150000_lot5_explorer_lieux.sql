-- ---------------------------------------------------------------------------
-- LOT 5 · A — LA PORTE PAR LAQUELLE EXPLORER LIT L'INVENTAIRE
--
-- CE QUI SE PASSAIT AVANT
--
-- Explorer n'avait aucun lien avec `places`. Ses six sélections posaient une
-- phrase, `appliquerPhrase` la traduisait en catégories, et le rendu allait
-- chercher dans `lieux` — la variable que remplissent Overpass, Google Places
-- et DATAtourisme au runtime, autour d'un point et dans un rayon. 822 lieux
-- persistés, zéro consulté.
--
-- CE QUE CETTE FONCTION REND, ET CE QU'ELLE REFUSE DE RENDRE
--
-- Un lieu n'entre dans Explorer que s'il est présentable :
--   · actif, et pas le satellite d'un autre (`duplicate_of`) ;
--   · rattaché à une FAMILLE CANONIQUE — les 358 lieux encore non classés ne
--     doivent pas polluer une surface de découverte : on ne sait pas où les
--     ranger, donc on ne les propose pas ;
--   · géolocalisé, sinon la distance et la carte mentiraient ;
--   · porteur d'une image OU d'une description quand l'appelant annonce une
--     sélection visuelle. Une carte sans rien à montrer ni rien à lire n'est
--     pas une carte, c'est une ligne de menu.
--
-- CE QU'ELLE NE FAIT PAS, ET C'EST ESSENTIEL
--
-- Elle ne dit JAMAIS qu'un lieu est ouvert. `opening_hours` est vide sur les
-- 822 lieux, et une absence d'horaire n'est pas une ouverture. Elle rend
-- `horaires_fiables` à faux partout où elle ne sait pas, et « Maintenant » ne
-- l'appelle pas du tout. Un lieu peut se découvrir sans être annoncé ouvert.
-- ---------------------------------------------------------------------------

create or replace function public.lieux_explorer(
  p_zone_id      text,
  p_famille      text default null,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_rayon_m      double precision default null,
  p_limite       integer default 30,
  p_visuel_exige boolean default false)
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
  -- Le type dit CE QUE MONTRE l'image. `event_poster` n'est pas une photo du
  -- lieu, et le client doit pouvoir le savoir sans le deviner.
  image_type     text,
  opening_hours  text,
  horaires_fiables boolean,
  distance_m     double precision)
language sql
stable
set search_path to 'public', 'topology'
as $function$
  select
    p.id, p.slug, p.name, p.family, f.label,
    p.lat, p.lng, p.address, p.commune, p.description, p.official_url,
    p.image_url, p.image_source, p.image_author, p.image_license, p.image_type,
    p.opening_hours,
    /* Un horaire absent n'est pas un horaire connu. Tant que la colonne est
       vide, la réponse est « on ne sait pas », jamais « c'est ouvert ». */
    (p.opening_hours is not null and btrim(p.opening_hours) <> '') as horaires_fiables,
    case when p_lat is null or p_lng is null then null
         else ST_Distance(p.geom::topology.geography,
                ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography)
    end
  from public.places p
  join public.place_familles f on f.famille = p.family
  where p.status = 'active'
    and p.duplicate_of is null
    and p.family is not null
    and p.geom is not null
    and p.lat is not null and p.lng is not null
    and (p_zone_id is null or p.zone_id = p_zone_id)
    and (p_famille is null or p.family = p_famille)
    and (not p_visuel_exige
         or p.image_url is not null
         or (p.description is not null and btrim(p.description) <> ''))
    and (p_lat is null or p_lng is null or p_rayon_m is null
         or ST_DWithin(p.geom::topology.geography,
              ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography, p_rayon_m))
  order by
    case when p_lat is null or p_lng is null then 0
         else ST_Distance(p.geom::topology.geography,
                ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography) end,
    /* À distance égale, ce qui a de quoi remplir une carte passe devant. */
    (p.image_url is not null) desc,
    (p.description is not null) desc,
    p.name
  limit least(greatest(coalesce(p_limite, 30), 1), 120);
$function$;

grant execute on function public.lieux_explorer(
  text, text, double precision, double precision, double precision, integer, boolean)
  to anon, authenticated, service_role;

comment on function public.lieux_explorer(
  text, text, double precision, double precision, double precision, integer, boolean) is
  'Les lieux persistants présentables dans Explorer. Jamais de lieu non classé, jamais de satellite, et jamais d''affirmation d''ouverture.';


-- Combien de lieux Explorer peut-il montrer, par famille ? La vue sert à
-- décider quand la base suffit et quand il faut encore le runtime.
create or replace view public.lieux_explorer_couverture as
  select p.zone_id, p.family, f.label as famille_label,
         count(*)                                        as lieux,
         count(*) filter (where p.image_url is not null) as avec_image,
         count(*) filter (where p.description is not null) as avec_description,
         count(*) filter (where p.image_url is not null
                            or p.description is not null) as presentables
    from public.places p
    join public.place_familles f on f.famille = p.family
   where p.status = 'active' and p.duplicate_of is null and p.geom is not null
   group by p.zone_id, p.family, f.label, f.rang
   order by p.zone_id, f.rang;

revoke all on public.lieux_explorer_couverture from anon, authenticated, public;
grant select on public.lieux_explorer_couverture to anon, authenticated, service_role;
