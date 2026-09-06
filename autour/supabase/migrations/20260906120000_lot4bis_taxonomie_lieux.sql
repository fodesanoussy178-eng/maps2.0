-- ---------------------------------------------------------------------------
-- LOT 4-BIS — LA TAXONOMIE CANONIQUE DES LIEUX
--
-- CE QUI N'ALLAIT PAS
--
-- `places.category` portait le mot du fournisseur : `resto`, `musee`,
-- `hebergement` pour DATAtourisme, et rien du tout pour les 484 lieux venus
-- des événements. Une catégorie de fournisseur n'est pas une famille : elle
-- change quand le catalogue change, elle n'existe pas quand il n'y a pas de
-- catalogue, et deux fournisseurs ne nomment jamais la même chose pareil.
--
-- `family` est la famille canonique. Elle est stable, elle est à nous, et
-- c'est elle qu'Explorer pourra interroger. `category` reste à côté, telle
-- qu'elle est arrivée : on ne perd pas la donnée d'origine, on cesse
-- simplement de s'appuyer dessus.
--
-- DEUX SIGNAUX, ET AUCUNE DEVINETTE
--
-- 1. LES TYPES SCHEMA.ORG DE DATATOURISME. `Museum`, `ParkAndGarden`,
--    `MovieTheater` ne sont pas des mots-clés : ce sont des types déclarés par
--    le producteur de la donnée. La table de correspondance ci-dessous est
--    donc une traduction, pas une interprétation.
--
-- 2. LE NOM, QUAND IL DIT LE TYPE D'ÉTABLISSEMENT. En français, « Médiathèque
--    Jean Lévy » ou « Piscine Marx Dormoy » ne laissent aucun doute : le nom
--    EST la nature du lieu. La liste est volontairement courte et ancrée en
--    DÉBUT de nom — « Café de la Mairie » est un café, « Mairie » ne fait pas
--    d'un café une mairie.
--
-- CE QUI N'EST PAS RECONNU RESTE NULL. C'est la règle qui compte : un lieu
-- ambigu non classé se voit et se corrige ; un lieu mal classé se propage dans
-- Explorer et personne ne s'en aperçoit.
-- ---------------------------------------------------------------------------

create table if not exists public.place_familles (
  famille   text primary key,
  label     text not null,
  -- Un parc décrit par deux sources s'étale sur des centaines de mètres ; ses
  -- deux relevés ne sont pas deux parcs. Ce drapeau porte cette réalité
  -- physique, et c'est lui qui décidera du rayon de rapprochement.
  etendu    boolean not null default false,
  rang      integer not null default 100
);

comment on table public.place_familles is
  'Familles canoniques des lieux Autour. Stables, indépendantes des fournisseurs.';

insert into public.place_familles (famille, label, etendu, rang) values
  ('culture',      'Culture, musées et expositions', false, 10),
  ('bibliotheque', 'Bibliothèques et médiathèques',  false, 20),
  ('cinema',       'Cinémas',                        false, 30),
  ('musique',      'Musique et concerts',            false, 40),
  ('patrimoine',   'Patrimoine',                     false, 50),
  ('nature',       'Parcs et nature',                true,  60),
  ('sport',        'Sport',                          true,  70),
  ('marche',       'Marchés',                        true,  80),
  ('restauration', 'Restaurants et cafés',           false, 90),
  ('commerce',     'Commerces',                      false, 100),
  ('association',  'Associations et vie locale',     false, 110),
  ('solidarite',   'Aide et solidarité',             false, 120),
  ('hebergement',  'Hébergement',                    false, 130)
on conflict (famille) do update
  set label = excluded.label, etendu = excluded.etendu, rang = excluded.rang;

alter table public.places
  add column if not exists family text references public.place_familles(famille);

create index if not exists places_famille_idx
  on public.places (zone_id, family) where status <> 'disabled';


-- ---------------------------------------------------------------------------
-- SIGNAL 1 — les types déclarés par DATAtourisme
--
-- L'ordre des tests EST la règle de priorité. Un `HotelRestaurant` porte les
-- deux types ; le bâtiment est un hôtel, donc `hebergement` passe avant
-- `restauration`. Un `Cinematheque` est d'abord un cinéma, pas un lieu
-- culturel générique : le plus spécifique gagne.
-- ---------------------------------------------------------------------------

create or replace function public.place_famille_depuis_types(p_types text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  with t as (select ' ' || coalesce(p_types, '') || ' ' as s)
  select case
    when s ~ ' (MovieTheater|Cinema|Cinematheque) '                    then 'cinema'
    when s ~ ' (ConcertHall|MusicVenue|Opera|OperaHouse) '             then 'musique'
    when s ~ ' (Library|MediaLibrary) '                                then 'bibliotheque'
    when s ~ ' (ParkAndGarden|Park|Garden|NaturalHeritage|EducationalTrail|Forest|Beach) '
                                                                       then 'nature'
    when s ~ ' (Market|CoveredMarket) '                                then 'marche'
    when s ~ ' (SportsAndLeisurePlace|Stadium|SwimmingPool|SportsCentre) '
                                                                       then 'sport'
    when s ~ ' (ReligiousSite|Cathedral|Church|Abbey|Chapel|Castle|Monument|ArcheologicalSite|RemarkableBuilding|TechnicalHeritage|Belfry) '
                                                                       then 'patrimoine'
    when s ~ ' (Museum|CulturalSite|ExhibitionCenter|Theater|ArtGallery|InterpretationCentre) '
                                                                       then 'culture'
    when s ~ ' (Hotel|HotelTrade|LodgingBusiness|Accommodation|CollectiveAccommodation|HolidayResort|CampGround|GuestRoom|RentalAccommodation) '
                                                                       then 'hebergement'
    when s ~ ' (Restaurant|FoodEstablishment|BarOrPub|Cafe|TastingProvider) '
                                                                       then 'restauration'
    when s ~ ' (Store|BoutiqueOrLocalShop|CraftsmanShop|LocalProductsShop|Producer|ShoppingPlace) '
                                                                       then 'commerce'
    when s ~ ' (Association|SocialFacility) '                          then 'association'
    else null
  end
  from t;
$function$;

comment on function public.place_famille_depuis_types(text) is
  'Traduit les types schema.org de DATAtourisme en famille canonique. Rend NULL si rien ne correspond.';


-- ---------------------------------------------------------------------------
-- SIGNAL 2 — le nom, quand il énonce le type d'établissement
--
-- Ancré en début de nom, sur une liste courte. « Médiathèque Jean Lévy » est
-- une médiathèque ; « Le Grand Sud » n'est rien de connu, et reste NULL.
--
-- CE QUI EST DÉLIBÉRÉMENT ABSENT : « maison », « centre », « espace »,
-- « salle », « le », « la ». Ces mots-là ouvrent la porte à tout et à son
-- contraire — « Centre commercial », « Centre social », « Centre aquatique »,
-- « Centre culturel » — et une règle qui se trompe une fois sur trois est
-- pire que pas de règle du tout.
-- ---------------------------------------------------------------------------

create or replace function public.place_famille_depuis_nom(p_nom text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  with n as (select ' ' || coalesce(public.place_nom_normalise(p_nom), '') || ' ' as s)
  select case
    when s ~ '^ (mediatheque|bibliotheque|ludotheque) '           then 'bibliotheque'
    when s ~ '^ (cinema|kinepolis|megarama|ugc|pathe) '           then 'cinema'
    when s ~ '^ (conservatoire) '                                 then 'musique'
    when s ~ '^ (musee|theatre|opera|galerie art|maison folie|fresnoy) '
                                                                  then 'culture'
    when s ~ '^ (parc|jardin|square|bois|foret|etang|lac) '        then 'nature'
    when s ~ '^ (stade|piscine|gymnase|patinoire|boulodrome|dojo|skatepark|hippodrome|velodrome) '
                                                                  then 'sport'
    when s ~ '^ (marche) (aux|de|des|du|bio|couvert|noel|nocturne) ' then 'marche'
    when s ~ '^ (eglise|cathedrale|basilique|chapelle|abbaye|beffroi|chateau|citadelle|fort|donjon|moulin) '
                                                                  then 'patrimoine'
    when s ~ '^ (restaurant|brasserie|bistrot|taverne|creperie|pizzeria|cafe) '
                                                                  then 'restauration'
    when s ~ '^ (mjc|centre social|maison quartier|foyer rural) '  then 'association'
    when s ~ '^ (secours populaire|secours catholique|restos coeur|banque alimentaire|croix rouge|epicerie solidaire) '
                                                                  then 'solidarite'
    else null
  end
  from n;
$function$;

comment on function public.place_famille_depuis_nom(text) is
  'Famille déduite du nom quand celui-ci énonce le type d''établissement. Liste courte, ancrée en début de nom. NULL sinon.';


-- ---------------------------------------------------------------------------
-- LE CLASSEMENT
--
-- Les types du fournisseur d'abord — ils sont déclarés, donc plus sûrs que le
-- nom. Le nom ensuite, pour tout ce qui vient des événements et n'a aucun
-- type. Et rien, s'il n'y a rien : `family` reste NULL, et le compteur le dit.
--
-- La fonction est rejouable : elle ne touche que ce qui n'est pas encore
-- classé, sauf si on lui demande explicitement de tout revoir.
-- ---------------------------------------------------------------------------

create or replace function public.places_classer(
  p_tout boolean default false)
returns table (examines int, par_type int, par_nom int, sans_famille int)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_exam int; v_type int; v_nom int; v_sans int;
begin
  with cible as (
    select p.id, p.name,
           (select string_agg(s.raw_data->>'type', ' ')
              from public.place_sources s
             where s.place_id = p.id and s.raw_data ? 'type') as types
      from public.places p
     where p_tout or p.family is null
  ),
  calcule as (
    select id,
           public.place_famille_depuis_types(types) as f_type,
           public.place_famille_depuis_nom(name)    as f_nom
      from cible
  ),
  applique as (
    update public.places p
       set family = coalesce(c.f_type, c.f_nom)
      from calcule c
     where p.id = c.id and coalesce(c.f_type, c.f_nom) is not null
    returning p.id, c.f_type
  )
  select (select count(*) from cible),
         (select count(*) from applique where f_type is not null),
         (select count(*) from applique where f_type is null)
    into v_exam, v_type, v_nom;

  select count(*) into v_sans from public.places where family is null;
  return query select v_exam, v_type, v_nom, v_sans;
end;
$function$;

revoke all on function public.places_classer(boolean) from public, anon, authenticated;
grant execute on function public.places_classer(boolean) to service_role;

alter table public.place_familles enable row level security;
drop policy if exists "familles de lieux: lecture publique" on public.place_familles;
create policy "familles de lieux: lecture publique" on public.place_familles
  for select using (true);
revoke all on public.place_familles from anon, authenticated;
grant select on public.place_familles to anon, authenticated;
grant all on public.place_familles to service_role;
