-- ---------------------------------------------------------------------------
-- LOT 6 · 3 et 4 — RATTACHER LES OFFRES, ET LES FAIRE MOURIR À TEMPS
--
-- CE QUE L'AUDIT A MESURÉ
--
--   · 46 offres, 0 rattachée à un lieu. `offres_rattacher_aux_lieux()` du
--     Lot 5 exigeait `place_nom_normalise(titre) = name_normalized` : « R.U.
--     Chatillon (Lille Centre) » n'est le nom d'aucun lieu de l'inventaire.
--     Un seul signal, aucune tolérance : le rapprochement ne pouvait pas
--     exister.
--   · 0 offre avec date de fin. Donc RIEN ne retire une offre dont la source
--     aurait disparu. Une offre de 2024 resterait affichée en 2030.
--
-- CE QUE LA SOURCE DONNE VRAIMENT, ET QUE LE LOT 5 JETAIT
--
-- Un enregistrement CROUS réel :
--   contact : « Cafétéria 3.14 2 Avenue Jean Perrin 59650 Villeneuve-d'Ascq
--              Téléphone : … »          → une ADRESSE POSTALE
--   zone    : « Villeneuve d'Ascq (Cité scientifique) »  → une COMMUNE
--   closing : 0 / 1                      → une FERMETURE TEMPORAIRE
--   infos   : « Horaires 8h à 19h30 du lundi au vendredi … » → des HORAIRES
--   photo   : une URL sur crous-lille.fr
--
-- La photo n'est PAS reprise. Le jeu de données est sous Licence Ouverte, mais
-- une licence de données ne licencie pas une photographie hébergée ailleurs :
-- ce serait fabriquer une licence. Le reste, si — c'est de l'information.
-- ---------------------------------------------------------------------------


-- ---- Ce qu'une offre sait d'elle-même -------------------------------------
alter table public.offers
  add column if not exists address        text,
  add column if not exists commune        text,
  add column if not exists opening_hours  text,
  add column if not exists opening_hours_texte text,
  add column if not exists temporarily_closed boolean not null default false,

  -- La fraîcheur. `last_seen_at` existait déjà ; il lui manquait de quoi
  -- décider qu'une offre a disparu.
  add column if not exists last_checked_at timestamptz,
  add column if not exists absences        integer not null default 0,

  -- Le rapprochement, avec son niveau de certitude ET sa raison. Un
  -- rattachement qu'on ne sait pas justifier ne se relit pas.
  add column if not exists place_match_status text not null default 'unmatched',
  add column if not exists place_match_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'offers_place_match_status_check') then
    alter table public.offers add constraint offers_place_match_status_check
      check (place_match_status in ('exact','probable','ambiguous','unmatched'));
  end if;
end $$;

-- `valid_from` / `valid_until` sont le VOCABULAIRE demandé ; `starts_at` /
-- `ends_at` restent le STOCKAGE. Une colonne générée donne le nom sans créer
-- une seconde vérité qui pourrait diverger de la première.
alter table public.offers
  add column if not exists valid_from  timestamptz generated always as (starts_at) stored,
  add column if not exists valid_until timestamptz generated always as (ends_at)   stored;

-- Cinq états, pas deux.
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('active','expired','stale','withdrawn','unknown'));

comment on column public.offers.absences is
  'Collectes successives où la source n''a pas revu cette offre. C''est ce compteur, pas une intuition, qui la fait passer en « stale ».';


-- ---------------------------------------------------------------------------
-- LE SEUIL EST UNE DONNÉE, PAS UNE CONSTANTE PERDUE DANS DU JS
--
-- Une source qui publie tous les jours et une source qui publie deux fois par
-- an ne se périment pas au même rythme. Le seuil vit donc par source, en base,
-- modifiable sans redéploiement.
-- ---------------------------------------------------------------------------
create table if not exists public.offer_peremption (
  source              text primary key,
  absences_max        integer not null default 3
                      check (absences_max >= 1),
  jours_sans_revue_max integer not null default 45
                      check (jours_sans_revue_max >= 1),
  commentaire         text,
  updated_at          timestamptz not null default now()
);

insert into public.offer_peremption (source, absences_max, jours_sans_revue_max, commentaire)
values
  ('*', 3, 45,
   'Défaut prudent : trois collectes successives sans revoir l''offre ET plus de 45 jours sans nouvelle. Les deux conditions, pas l''une des deux.'),
  ('crous_ods', 3, 60,
   'Le jeu CROUS bouge lentement (rentrées, fermetures d''été). Soixante jours évitent de périmer un restaurant fermé en août.')
on conflict (source) do update
  set absences_max = excluded.absences_max,
      jours_sans_revue_max = excluded.jours_sans_revue_max,
      commentaire = excluded.commentaire, updated_at = now();

alter table public.offer_peremption enable row level security;
revoke all on public.offer_peremption from anon, authenticated, public;
grant select, insert, update, delete on public.offer_peremption to service_role;


-- ---------------------------------------------------------------------------
-- TRANSCRIRE DES HORAIRES ÉCRITS EN FRANÇAIS — sans jamais en inventer
--
-- « Horaires 8h à 19h30 du lundi au vendredi 8h à 12h30 le samedi »
--                       ↓
-- « Mo-Fr 08:00-19:30; Sa 08:00-12:30 »
--
-- LA GARDE QUI REND ÇA HONNÊTE : après avoir retiré du texte tous les
-- fragments transcrits, s'il reste la moindre expression horaire (un chiffre
-- suivi d'un « h »), la fonction REFUSE TOUT. Sans cette garde, une plage
-- qu'on n'aurait pas su lire disparaîtrait en silence, et le lieu serait
-- annoncé fermé alors qu'il est ouvert.
--
-- Ce n'est pas de l'inférence : c'est de la transcription d'une phrase que la
-- source a écrite. Ce qu'elle n'a pas écrit n'est pas deviné.
-- ---------------------------------------------------------------------------
create or replace function public.horaires_depuis_texte_fr(p_texte text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_txt text; v_reste text; v_out text[] := array[]::text[];
  m text[]; v_jours text; borne text;
  JOURS_FR constant text[] := array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  JOURS_OSM constant text[] := array['Mo','Tu','We','Th','Fr','Sa','Su'];
  i1 int; i2 int;
  /* Deux ordres coexistent dans les fiches réelles :
       « 8h à 19h30 du lundi au vendredi »   → les heures d'abord
       « du lundi au vendredi de 9h30 à 14h30 » → les jours d'abord
     Le reste — « Horaires 7h30 - 16h », sans aucun jour — n'est PAS
     transcrit : dire quels jours il ouvre serait l'inventer. */
  HEURES constant text := '(\d{1,2})\s*h\s*(\d{2})?\s*(?:à|a|-)\s*(\d{1,2})\s*h\s*(\d{2})?';
  JOURS  constant text := '(?:du\s+([a-zéèêû]+)\s+au\s+([a-zéèêû]+)|les?\s+([a-zéèêû]+))';
begin
  v_txt := btrim(coalesce(p_texte, ''));
  if v_txt = '' then return null; end if;
  v_txt := lower(replace(replace(v_txt, e'\n', ' '), e'\t', ' '));

  -- On ne lit que ce qui suit le mot « horaires » : le reste de la fiche parle
  -- d'accès, de wifi et de moyens de paiement.
  if position('horaires' in v_txt) = 0 then return null; end if;
  v_txt := substr(v_txt, position('horaires' in v_txt) + 8);
  foreach borne in array array['moyen d''accès','pratique','paiements','accès','contact']
  loop
    if position(borne in v_txt) > 0 then
      v_txt := substr(v_txt, 1, position(borne in v_txt) - 1);
    end if;
  end loop;
  v_reste := v_txt;

  -- Forme A : les heures, puis les jours.
  for m in select regexp_matches(v_txt, HEURES || '\s*' || JOURS, 'g')
  loop
    if m[1]::int > 23 or m[3]::int > 24 then return null; end if;
    if m[5] is not null then
      i1 := array_position(JOURS_FR, m[5]); i2 := array_position(JOURS_FR, m[6]);
      if i1 is null or i2 is null then return null; end if;
      v_jours := JOURS_OSM[i1] || '-' || JOURS_OSM[i2];
    else
      i1 := array_position(JOURS_FR, rtrim(m[7], 's'));
      if i1 is null then return null; end if;
      v_jours := JOURS_OSM[i1];
    end if;
    v_out := v_out || (v_jours || ' ' || lpad(m[1],2,'0') || ':' || coalesce(m[2],'00')
                       || '-' || lpad(m[3],2,'0') || ':' || coalesce(m[4],'00'));
  end loop;
  v_reste := regexp_replace(v_reste, HEURES || '\s*' || JOURS, ' ', 'g');

  -- Forme B : les jours, puis les heures.
  for m in select regexp_matches(v_reste, JOURS || '\s*(?:de\s+)?' || HEURES, 'g')
  loop
    if m[4]::int > 23 or m[6]::int > 24 then return null; end if;
    if m[1] is not null then
      i1 := array_position(JOURS_FR, m[1]); i2 := array_position(JOURS_FR, m[2]);
      if i1 is null or i2 is null then return null; end if;
      v_jours := JOURS_OSM[i1] || '-' || JOURS_OSM[i2];
    else
      i1 := array_position(JOURS_FR, rtrim(m[3], 's'));
      if i1 is null then return null; end if;
      v_jours := JOURS_OSM[i1];
    end if;
    v_out := v_out || (v_jours || ' ' || lpad(m[4],2,'0') || ':' || coalesce(m[5],'00')
                       || '-' || lpad(m[6],2,'0') || ':' || coalesce(m[7],'00'));
  end loop;
  v_reste := regexp_replace(v_reste, JOURS || '\s*(?:de\s+)?' || HEURES, ' ', 'g');

  if array_length(v_out, 1) is null then return null; end if;

  /* LA GARDE. Ce qui reste ne doit plus contenir aucune heure : sinon une
     plage nous a échappé, et le lieu serait annoncé fermé alors qu'il ouvre. */
  if v_reste ~ '\d\s*h' then return null; end if;

  return array_to_string(v_out, '; ');
end;
$function$;

comment on function public.horaires_depuis_texte_fr(text) is
  'Transcrit des horaires écrits en français vers la syntaxe OSM. Refuse TOUT s''il reste une expression horaire non transcrite : mieux vaut « inconnu » qu''un horaire amputé.';

/* Sans révocation explicite, une fonction est exécutable par PUBLIC : c'est le
   défaut de Postgres, et c'est la porte qu'on ferme partout ailleurs. Celle-ci
   ne lit aucune donnée, mais la discipline ne souffre pas d'exception — une
   exception non expliquée devient un précédent. */
revoke all on function public.horaires_depuis_texte_fr(text)
  from public, anon, authenticated;
grant execute on function public.horaires_depuis_texte_fr(text) to service_role;


-- ---------------------------------------------------------------------------
-- LE RAPPROCHEMENT OFFRE → LIEU
--
-- Plusieurs signaux, et un niveau de certitude par signal :
--
--   exact    · le nom normalisé de l'offre EST celui du lieu, à moins de 150 m
--            · ou l'adresse normalisée est la même, à moins de 150 m
--   probable · l'un des noms contient l'autre (≥ 10 caractères), même commune,
--              moins de 300 m
--   ambiguous· plusieurs candidats au même niveau → AUCUN rattachement
--   unmatched· rien
--
-- Seuls `exact` et `probable` posent `place_id`. Et AUCUN LIEU N'EST CRÉÉ :
-- une offre qui ne trouve pas son lieu reste une offre sans lieu, ce qui est
-- une information juste, alors qu'un lieu fabriqué est une information fausse
-- qui contamine tout l'inventaire.
-- ---------------------------------------------------------------------------
create or replace function public.offres_rattacher_aux_lieux(p_forcer boolean default false)
returns table (examinees integer, exacts integer, probables integer,
               ambigues integer, sans_lieu integer)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  o record; c record;
  v_niveau text; v_place uuid; v_raison text; v_n int;
  v_ex int := 0; v_e int := 0; v_p int := 0; v_a int := 0; v_s int := 0;
begin
  for o in
    select f.id, f.title, f.address, f.commune, f.geom,
           public.place_nom_normalise(f.title)   as nom,
           public.place_nom_normalise(f.address) as adr
      from public.offers f
     where f.geom is not null
       and (p_forcer or f.place_id is null)
  loop
    v_ex := v_ex + 1;
    v_niveau := null; v_place := null; v_raison := null;

    -- ---- Niveau « exact » ------------------------------------------------
    select count(*), (array_agg(p.id))[1] into v_n, v_place
      from public.places p
     where p.status = 'active' and p.duplicate_of is null and p.geom is not null
       and ST_DWithin(p.geom::topology.geography, o.geom::topology.geography, 150)
       and (p.name_normalized = o.nom
            or (o.adr is not null and public.place_nom_normalise(p.address) = o.adr));

    if v_n = 1 then
      v_niveau := 'exact';
      v_raison := 'nom ou adresse identique, à moins de 150 m';
    elsif v_n > 1 then
      v_niveau := 'ambiguous'; v_place := null;
      v_raison := v_n || ' lieux également plausibles à moins de 150 m';
    else
      -- ---- Niveau « probable » -------------------------------------------
      select count(*), (array_agg(p.id))[1] into v_n, v_place
        from public.places p
       where p.status = 'active' and p.duplicate_of is null and p.geom is not null
         and ST_DWithin(p.geom::topology.geography, o.geom::topology.geography, 300)
         and o.commune is not null
         and public.commune_cle(p.commune) = public.commune_cle(o.commune)
         and o.nom is not null and length(o.nom) >= 10
         and (position(o.nom in p.name_normalized) > 0
              or (length(p.name_normalized) >= 10
                  and position(p.name_normalized in o.nom) > 0));

      if v_n = 1 then
        v_niveau := 'probable';
        v_raison := 'nom contenu, même commune, à moins de 300 m';
      elsif v_n > 1 then
        v_niveau := 'ambiguous'; v_place := null;
        v_raison := v_n || ' lieux également plausibles à moins de 300 m';
      else
        v_niveau := 'unmatched'; v_place := null;
        v_raison := 'aucun lieu de l''inventaire ne correspond';
      end if;
    end if;

    update public.offers f
       set place_id = case when v_niveau in ('exact','probable') then v_place else null end,
           place_match_status = v_niveau,
           place_match_reason = v_raison
     where f.id = o.id;

    if    v_niveau = 'exact'     then v_e := v_e + 1;
    elsif v_niveau = 'probable'  then v_p := v_p + 1;
    elsif v_niveau = 'ambiguous' then v_a := v_a + 1;
    else v_s := v_s + 1; end if;
  end loop;

  return query select v_ex, v_e, v_p, v_a, v_s;
end;
$function$;

revoke all on function public.offres_rattacher_aux_lieux(boolean)
  from public, anon, authenticated;
grant execute on function public.offres_rattacher_aux_lieux(boolean) to service_role;


-- ---------------------------------------------------------------------------
-- LA FRAÎCHEUR — une offre ne meurt pas de vieillesse, elle meurt d'absence
--
-- Trois faits, trois conséquences :
--   · une date de fin dépassée            → `expired`
--   · absente de N collectes successives  → `absences` monte ; passé le seuil
--     ET plus de M jours sans nouvelle    → `stale`
--   · revue par la source                 → `active`, compteur remis à zéro
--
-- Rien n'est supprimé : l'historique sert à la déduplication et à dire « c'était
-- vrai jusqu'au 30 juin ».
-- ---------------------------------------------------------------------------
create or replace function public.offres_constater_absences(
  p_source  text,
  p_depuis  timestamptz)
returns integer
language sql
set search_path to 'public'
as $function$
  with vues as (
    update public.offers o
       set absences = 0, last_checked_at = now()
      from public.offer_sources s
     where s.offer_id = o.id and s.source = p_source
       and o.last_seen_at >= p_depuis
     returning o.id),
  absentes as (
    update public.offers o
       set absences = o.absences + 1, last_checked_at = now()
      from public.offer_sources s
     where s.offer_id = o.id and s.source = p_source
       and o.last_seen_at < p_depuis
       and o.status = 'active'
     returning o.id)
  select count(*)::integer from absentes;
$function$;

revoke all on function public.offres_constater_absences(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.offres_constater_absences(text, timestamptz) to service_role;


create or replace function public.offres_appliquer_fraicheur()
returns table (expirees integer, perimees integer, ressuscitees integer)
language plpgsql
set search_path to 'public'
as $function$
declare v_exp int; v_stale int; v_res int;
begin
  -- 1. La date de fin fait foi.
  with x as (
    update public.offers o set status = 'expired'
     where o.ends_at is not null and o.ends_at < now() and o.status = 'active'
     returning 1)
  select count(*) into v_exp from x;

  -- 2. L'absence répétée, mesurée contre le seuil de SA source.
  with x as (
    update public.offers o set status = 'stale'
      from public.offer_sources s
      left join public.offer_peremption ps on ps.source = s.source
      left join public.offer_peremption pd on pd.source = '*'
     where s.offer_id = o.id
       and o.status = 'active'
       and o.absences >= coalesce(ps.absences_max, pd.absences_max, 3)
       and o.last_seen_at < now()
           - (coalesce(ps.jours_sans_revue_max, pd.jours_sans_revue_max, 45) || ' days')::interval
     returning 1)
  select count(*) into v_stale from x;

  -- 3. Une offre revue redevient vivante. Une source qui republie a raison
  --    contre notre compteur.
  with x as (
    update public.offers o set status = 'active', absences = 0
     where o.status = 'stale'
       and o.absences = 0
       and (o.ends_at is null or o.ends_at >= now())
     returning 1)
  select count(*) into v_res from x;

  return query select v_exp, v_stale, v_res;
end;
$function$;

revoke all on function public.offres_appliquer_fraicheur()
  from public, anon, authenticated;
grant execute on function public.offres_appliquer_fraicheur() to service_role;


-- ---- La lecture publique ne montre que ce qui est vivant -------------------
-- `offres_publiques` filtrait déjà `status = 'active'` : `stale`, `expired` et
-- `withdrawn` en sortent donc d'eux-mêmes. On ajoute la fermeture temporaire,
-- qui est un fait de la source et pas un statut.
create or replace function public.offres_publiques(
  p_audience  text default 'student',
  p_zone_id   text default null,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_rayon_m   double precision default null,
  p_limite    integer default 20)
returns table (
  id uuid, slug text, title text, description text, offer_type text,
  audience_tags text[], eligibility text,
  place_id uuid, place_name text, commune text,
  lat double precision, lng double precision, distance_m double precision,
  starts_at timestamptz, ends_at timestamptz,
  source_name text, source_url text,
  image_url text, image_source text, image_license text, image_type text,
  address text, opening_hours text, etat_horaire text,
  ouvre_a timestamptz, ferme_a timestamptz,
  place_match_status text)
language sql
stable
set search_path to 'public', 'topology'
as $function$
  select o.id, o.slug, o.title, o.description, o.offer_type,
         o.audience_tags, o.eligibility,
         o.place_id, p.name, coalesce(p.commune, o.commune),
         o.lat, o.lng,
         case when p_lat is null or p_lng is null or o.geom is null then null
              else ST_Distance(o.geom::topology.geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography) end,
         o.starts_at, o.ends_at, o.source_name, o.source_url,
         o.image_url, o.image_source, o.image_license, o.image_type,
         o.address, o.opening_hours,
         h.etat, h.ouvre_a, h.ferme_a,
         o.place_match_status
    from public.offers o
    left join public.places p on p.id = o.place_id
    cross join lateral public.horaires_etat(
      o.opening_hours, now(), 'Europe/Paris', o.temporarily_closed, null) h
   where o.status = 'active'
     and (o.ends_at is null or o.ends_at >= now())
     and (o.starts_at is null or o.starts_at <= now() + interval '90 days')
     and o.source_url is not null
     and (p_audience is null or o.audience_tags && array[p_audience]::text[])
     and (p_zone_id is null or o.zone_id = p_zone_id or o.zone_id is null)
     and (p_lat is null or p_lng is null or p_rayon_m is null or o.geom is null
          or ST_DWithin(o.geom::topology.geography,
               ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::topology.geography, p_rayon_m))
   order by (o.ends_at is null), o.ends_at, o.title
   limit least(greatest(coalesce(p_limite, 20), 1), 60);
$function$;

grant execute on function public.offres_publiques(
  text, text, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;


-- ---- La mesure -------------------------------------------------------------
create or replace view public.offres_fraicheur_qualite as
  select
    count(*)                                                   as total,
    count(*) filter (where status = 'active')                   as actives,
    count(*) filter (where status = 'expired')                  as expirees,
    count(*) filter (where status = 'stale')                    as perimees,
    count(*) filter (where status = 'withdrawn')                as retirees,
    count(*) filter (where ends_at is not null)                 as avec_date_de_fin,
    count(*) filter (where place_match_status = 'exact')        as rattachees_exact,
    count(*) filter (where place_match_status = 'probable')     as rattachees_probable,
    count(*) filter (where place_match_status = 'ambiguous')    as ambigues,
    count(*) filter (where place_match_status = 'unmatched')    as sans_lieu,
    count(*) filter (where address is not null)                 as avec_adresse,
    count(*) filter (where opening_hours is not null)           as avec_horaires,
    count(*) filter (where temporarily_closed)                  as fermees_temporairement
  from public.offers;

revoke all on public.offres_fraicheur_qualite from anon, authenticated, public;
grant select on public.offres_fraicheur_qualite to service_role;
