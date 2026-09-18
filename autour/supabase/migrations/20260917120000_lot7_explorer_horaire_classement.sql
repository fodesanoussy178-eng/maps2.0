-- ---------------------------------------------------------------------------
-- LOT 7 · 1 — L'ÉTAT HORAIRE CLASSE, IL N'EXCLUT PAS
--
-- CE QUE LA MESURE A MONTRÉ
--
-- Compté famille par famille, en ajoutant les filtres un par un autour de
-- Lille : aucune famille ne s'effondre au filtre géographique, ni au filtre de
-- famille. Culture garde 47 lieux, nature 39, patrimoine 28, bibliothèque 16,
-- sport 16, cinéma 6, musique 3. La correspondance des familles est exacte —
-- `places.family` est une clé étrangère vers `place_familles.famille`.
--
-- Une seule ligne tombe à zéro, et elle tombe à zéro PARTOUT : l'état horaire.
-- Aucun des 823 lieux de l'inventaire n'a d'`opening_hours` renseigné, donc
-- `horaires_etat` rend `inconnu` pour tous.
--
-- CE QUI NOUS A SAUVÉS, ET CE QUI NE NOUS SAUVERA PAS DEUX FOIS
--
-- `lieux_explorer` ne mettait pas cet état dans son `WHERE` : le `cross join
-- lateral` rend toujours exactement une ligne, et `etat_horaire` ne faisait que
-- voyager avec le lieu. La surface n'était donc pas vidée par lui. Mais rien
-- n'écrivait cette garantie, et rien ne classait non plus : le jour où un
-- premier horaire sera ingéré, un lieu qui ouvre et un lieu dont on ne sait
-- rien resteront strictement interchangeables.
--
-- CE QUE CETTE VERSION CHANGE — ET UNIQUEMENT CELA
--
--   1. `horaire_rang` : ouvert (1), fermé (2), horaire inconnu (3). Trois états
--      distincts, jamais deux. `inconnu` ne veut dire QUE « aucun horaire
--      fiable n'est connu » — ni ouvert, ni fermé, et surtout pas une
--      supposition déguisée.
--   2. Ce rang entre dans les DEUX ordres — celui qui choisit les lieux d'une
--      famille, et celui qui range la réponse — à la même place : APRÈS
--      l'atteignabilité, la qualité de l'image et la présence d'une
--      description, AVANT la distance. C'est un départage, pas un pilote : le
--      classement d'Explorer garde sa forme, et un lieu proche et illustré ne
--      passe pas derrière un lieu lointain et nu parce qu'il aurait un horaire.
--   3. Rien d'autre. Mêmes arguments, même type de retour, mêmes filtres.
--
-- CE QU'ELLE NE FERA JAMAIS
--
-- L'état horaire n'entre PAS dans le `WHERE`. Un lieu sans horaire connu reste
-- visible ; il est seulement rangé derrière ceux dont on sait quelque chose.
-- Aujourd'hui, les 823 lieux étant tous `inconnu`, ce rang est constant et la
-- réponse est identique au caractère près à celle d'avant cette migration —
-- c'est voulu, et c'est vérifiable.
-- ---------------------------------------------------------------------------

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
      h.etat as etat_horaire, h.ouvre_a, h.ferme_a,
      /* TROIS ÉTATS, ET LE TROISIÈME EST UNE RÉPONSE COMME LES AUTRES.
         `inconnu` ne dit pas « fermé » : il dit qu'on ne sait pas. Il pèse donc
         après les deux autres dans l'ordre, et JAMAIS dans le `where` — un lieu
         dont l'horaire est inconnu se découvre très bien. */
      case h.etat when 'ouvert' then 1 when 'ferme' then 2 else 3 end as horaire_rang,
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
    /* `horaires_etat` rend toujours exactement une ligne — y compris quand elle
       ne sait rien. Cette jointure latérale ne peut donc écarter aucun lieu ;
       c'est ce qui permet de classer sur l'horaire sans jamais filtrer dessus. */
    cross join lateral public.horaires_etat(
      p.opening_hours, now(), p.opening_hours_tz, p.temporarily_closed, p.closed_until) h
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
                 c.horaire_rang, c.distance_m nulls last, c.name
      ) as rang_dans_famille
    from candidats c
  )
  select
    r.id, r.slug, r.name, r.family, r.famille_label,
    r.lat, r.lng, r.address, r.commune, r.description, r.official_url,
    r.image_url, r.image_source, r.image_author, r.image_license, r.image_type,
    r.opening_hours, r.horaires_fiables,
    r.etat_horaire, r.ouvre_a, r.ferme_a,
    r.distance_m
  from rangee r
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
    /* Le départage horaire vient ICI : après ce qui fait la pertinence d'un
       lieu, avant la distance. Assez haut pour qu'un lieu ouvert passe devant
       un lieu dont on ne sait rien à qualité égale ; assez bas pour ne jamais
       réécrire le classement d'Explorer. */
    r.horaire_rang,
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
  'Les lieux présentables dans Explorer, en réponse à une INTENTION : une liste de familles, un plafond par famille, et l''ordre qui met les vraies photos devant. L''état horaire — ouvert, fermé, ou inconnu — CLASSE la réponse et ne la filtre jamais : un lieu sans horaire connu reste visible, simplement rangé derrière. Jamais de lieu non classé, jamais de satellite, jamais d''ouverture affirmée sans horaire.';
