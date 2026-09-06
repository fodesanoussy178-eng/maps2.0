-- ---------------------------------------------------------------------------
-- LOT 6 · 1 — DE VRAIES PHOTOS DE LIEUX
--
-- CE QUE L'AUDIT A MESURÉ
--
-- 464 lieux éligibles à Explorer, 146 images, et les 146 sont des AFFICHES
-- D'ÉVÉNEMENT. Zéro photo de lieu. L'échelle de priorité posée au Lot 5 était
-- donc une échelle sans premier barreau.
--
-- POURQUOI WIKIDATA, ET POURQUOI PAS COMMONS SEUL
--
-- Mesuré depuis cette base, avec `pg_net` :
--   · Commons `geosearch` à 200 m du Théâtre Sébastopol : 0 fichier ; à 300 m
--     du Palais des Beaux-Arts : 0. Peu de fichiers Commons sont géolocalisés.
--   · Wikidata : 1 520 items porteurs d'une image (P18) dans un rayon de 15 km
--     autour de Lille.
-- Wikidata sait donc OÙ sont les choses et QUELLE image les représente ;
-- Commons sait sous QUELLE licence. Il faut les deux, dans cet ordre.
--
-- POURQUOI LE NOM EST OBLIGATOIRE
--
-- Le même essai, à 250 m du Palais des Beaux-Arts, rend quinze items : le
-- palais, mais aussi la préfecture, la statue de Faidherbe, l'école de
-- journalisme et la station de métro. Rapprocher par la seule distance
-- collerait la façade de la préfecture sur la fiche du musée. La distance
-- présélectionne ; c'est le NOM qui décide, et le doute ne décide rien.
--
-- CE QUI N'EST JAMAIS FAIT ICI
--
-- Aucune URL fabriquée. Aucune image sans licence lue chez Commons. Aucune
-- image Google, ni de près ni de loin. Et aucune affiche d'événement promue en
-- photo de lieu : `image_type` reste ce qu'il est, et seule une photo issue de
-- ce pipeline devient `place_photo`.
-- ---------------------------------------------------------------------------


-- ---- Un encodeur d'URL, parce qu'on construit deux requêtes distantes ------
-- `Général Faidherbe Lille 12018 1.jpg` doit traverser une query string sans
-- se casser. Postgres n'a pas d'encodeur d'URL : en voici un, octet par octet.
create or replace function public.url_encode(p_texte text)
returns text
language sql
immutable
as $function$
  select coalesce(string_agg(
    case when b ~ '^[A-Za-z0-9_.~-]$' then b
         else regexp_replace(upper(encode(convert_to(b, 'UTF8'), 'hex')), '(..)', '%\1', 'g')
    end, ''), '')
  from regexp_split_to_table(coalesce(p_texte, ''), '') as b;
$function$;

comment on function public.url_encode(text) is
  'Encodage pourcent d''une chaîne UTF-8, pour construire une URL de requête distante.';


-- ---- Le journal de la récolte ---------------------------------------------
-- Une récolte qui ne se raconte pas ne se reprend pas. Chaque candidat garde
-- sa trace : ce qu'on a demandé, ce qui est revenu, ce qu'on a retenu et —
-- surtout — POURQUOI on a rejeté. Un rejet muet se répète indéfiniment.
create table if not exists public.place_image_candidats (
  id            bigint generated always as identity primary key,
  place_id      uuid not null references public.places(id) on delete cascade,
  etape         text not null check (etape in ('wikidata','commons')),
  requete_id    bigint,
  statut        text not null default 'lancee'
                check (statut in ('lancee','retenue','rejetee','versee','vide','echec')),
  motif         text,

  -- Ce que Wikidata a dit
  qid           text,
  label_source  text,
  fichier       text,
  rapprochement text check (rapprochement in ('exact','probable')),

  -- Ce que Commons a dit
  url           text,
  url_page      text,
  licence       text,
  licence_url   text,
  auteur        text,
  credit        text,
  attribution_requise boolean,

  lance_le      timestamptz not null default now(),
  recu_le       timestamptz
);

create index if not exists place_image_candidats_place_idx
  on public.place_image_candidats (place_id, etape, statut);
create index if not exists place_image_candidats_requete_idx
  on public.place_image_candidats (requete_id) where requete_id is not null;

comment on table public.place_image_candidats is
  'Journal de la recherche de photos de lieux : ce qui a été demandé, retenu, et pourquoi le reste a été rejeté.';

alter table public.place_image_candidats enable row level security;
revoke all on public.place_image_candidats from anon, authenticated, public;
grant select, insert, update, delete on public.place_image_candidats to service_role;
revoke all on sequence public.place_image_candidats_id_seq from anon, authenticated, public;
grant usage, select on sequence public.place_image_candidats_id_seq to service_role;


-- ---- Étape 1 : demander à Wikidata ce qu'il y a autour ---------------------
-- Bornée (`p_lot`), reprenable (on ne relance pas un lieu déjà en cours), et
-- idempotente : rejouer ne crée rien de neuf tant que les réponses ne sont pas
-- versées.
create or replace function public.places_recolter_wikidata(
  p_lot     integer default 20,
  p_rayon_m integer default 250)
returns table (lances integer)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  p record;
  v_id bigint;
  v_n int := 0;
  v_rayon_km text;
begin
  v_rayon_km := to_char(greatest(coalesce(p_rayon_m, 250), 50)::numeric / 1000.0, 'FM0.000');

  for p in
    select pl.id, pl.lat, pl.lng
      from public.places pl
     where pl.status = 'active'
       and pl.duplicate_of is null
       and pl.geom is not null
       and pl.family is not null
       /* On ne cherche pas une photo à un lieu qui en a déjà une VRAIE. Une
          affiche d'événement, elle, n'en est pas une : ces lieux-là restent
          candidats. */
       and coalesce(pl.image_type, '') <> 'place_photo'
       /* Un lieu déjà interrogé n'est pas réinterrogé. « Wikidata ne connaît
          rien sous ce nom ici » est une RÉPONSE, pas une panne : la relancer
          en boucle brûlerait le quota du service public pour rien. Seul
          `echec` — un 429, une coupure — reste rejouable. */
       and not exists (select 1 from public.place_image_candidats c
                        where c.place_id = pl.id
                          and c.statut in ('lancee','retenue','versee','vide','rejetee'))
     order by pl.name
     limit greatest(coalesce(p_lot, 20), 0)
  loop
    select net.http_get(
      url := 'https://query.wikidata.org/sparql?format=json&query=' || public.url_encode(
        'SELECT ?item ?itemLabel ?fichier WHERE {'
        || ' SERVICE wikibase:around { ?item wdt:P625 ?loc .'
        || ' bd:serviceParam wikibase:center "Point(' || to_char(p.lng, 'FM990.000000')
        || ' ' || to_char(p.lat, 'FM990.000000') || ')"^^geo:wktLiteral .'
        || ' bd:serviceParam wikibase:radius "' || v_rayon_km || '" . }'
        || ' ?item wdt:P18 ?image .'
        || ' BIND(REPLACE(wikibase:decodeUri(STRAFTER(STR(?image), "Special:FilePath/")), "_", " ") AS ?fichier)'
        || ' SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". } } LIMIT 25'),
      headers := '{"User-Agent":"Autour/1.0 (https://autour.eu; contact@autour.eu)","Accept":"application/sparql-results+json"}'::jsonb,
      timeout_milliseconds := 20000) into v_id;

    insert into public.place_image_candidats (place_id, etape, requete_id)
      values (p.id, 'wikidata', v_id);
    v_n := v_n + 1;
  end loop;

  return query select v_n;
end;
$function$;

revoke all on function public.places_recolter_wikidata(integer, integer)
  from public, anon, authenticated;
grant execute on function public.places_recolter_wikidata(integer, integer) to service_role;


-- ---- Étape 2 : décider, par le nom ----------------------------------------
--
-- LA RÈGLE, ET SON REFUS DE TRANCHER
--
--   exact    : le nom normalisé du lieu est EXACTEMENT le libellé normalisé.
--   probable : l'un contient l'autre, et le plus court fait au moins 8
--              caractères — « parc » contenu dans « parc des expositions » ne
--              prouve rien ; « palais beaux arts » contenu dans « palais beaux
--              arts lille », si.
--   sinon    : rejeté, avec le motif.
--
-- Et s'il reste DEUX candidats au même niveau, on ne choisit pas : on rejette.
-- Une fiche sans photo se répare ; une façade de préfecture sur un musée,
-- personne ne la signale.
create or replace function public.places_verser_wikidata()
returns table (examines integer, retenus integer, rejetes integer)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  c record; rep record; b jsonb;
  v_nom text; v_lab text; v_niveau text; v_commune text;
  v_meilleur jsonb; v_meilleur_niveau text; v_ex_aequo boolean;
  v_ex int := 0; v_ret int := 0; v_rej int := 0;
begin
  for c in
    select ca.*, pl.name, public.place_nom_normalise(pl.commune) as commune_normalisee
      from public.place_image_candidats ca
      join public.places pl on pl.id = ca.place_id
     where ca.etape = 'wikidata' and ca.statut = 'lancee' and ca.requete_id is not null
  loop
    select r.status_code, r.content into rep
      from net._http_response r where r.id = c.requete_id;

    if rep is null then continue; end if;             -- réponse pas encore là
    v_ex := v_ex + 1;

    if rep.status_code is distinct from 200 or rep.content is null then
      update public.place_image_candidats
         set statut = 'echec', motif = 'wikidata http ' || coalesce(rep.status_code::text, 'nul'),
             recu_le = now()
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

    v_nom := public.place_nom_normalise(c.name);
    v_commune := c.commune_normalisee;
    v_meilleur := null; v_meilleur_niveau := null; v_ex_aequo := false;

    for b in select * from jsonb_array_elements(
               coalesce(rep.content::jsonb -> 'results' -> 'bindings', '[]'::jsonb))
    loop
      v_lab := public.place_nom_normalise(b -> 'itemLabel' ->> 'value');
      if v_nom is null or v_lab is null then continue; end if;

      /* LE NOM DE LA COMMUNE N'EST PAS LE NOM DU LIEU. Sans cette exclusion,
         « Sanctuaire Sainte Rita de Vendeville » attrapait l'item Wikidata
         « Vendeville » et se retrouvait illustré par le panneau d'entrée du
         village. Mesuré sur données réelles : cinq cas sur soixante-neuf. */
      if v_commune is not null and v_lab = v_commune then continue; end if;

      /* Et la containment doit être un PRÉFIXE, pas une occurrence au milieu.
         « palais beaux arts » préfixe de « palais beaux arts lille » : oui.
         « vendeville » à la fin de « sanctuaire sainte rita vendeville » : non
         — c'est le lieu-dit, pas le lieu. Même raison pour « Mercure Lille
         Centre Grand Place », que « Lille-Centre » attrapait. */
      v_niveau := case
        when v_lab = v_nom then 'exact'
        when length(v_nom) >= 10 and v_lab like v_nom || ' %' then 'probable'
        when length(v_lab) >= 10 and v_nom like v_lab || ' %' then 'probable'
        else null end;
      if v_niveau is null then continue; end if;

      if v_meilleur is null
         or (v_niveau = 'exact' and v_meilleur_niveau = 'probable') then
        v_meilleur := b; v_meilleur_niveau := v_niveau; v_ex_aequo := false;
      elsif v_niveau = v_meilleur_niveau
            and (b -> 'fichier' ->> 'value') is distinct from (v_meilleur -> 'fichier' ->> 'value') then
        /* Deux fichiers différents également plausibles : le doute reste. */
        v_ex_aequo := true;
      end if;
    end loop;

    if v_meilleur is null then
      update public.place_image_candidats
         set statut = 'vide', motif = 'aucun libellé Wikidata ne correspond au nom du lieu',
             recu_le = now()
       where id = c.id;
      v_rej := v_rej + 1;
    elsif v_ex_aequo then
      update public.place_image_candidats
         set statut = 'rejetee', motif = 'deux candidats au même niveau : on ne tranche pas',
             recu_le = now()
       where id = c.id;
      v_rej := v_rej + 1;
    else
      update public.place_image_candidats
         set statut = 'retenue',
             qid = regexp_replace(coalesce(v_meilleur -> 'item' ->> 'value', ''), '^.*/', ''),
             label_source = v_meilleur -> 'itemLabel' ->> 'value',
             fichier = v_meilleur -> 'fichier' ->> 'value',
             rapprochement = v_meilleur_niveau,
             recu_le = now()
       where id = c.id;
      v_ret := v_ret + 1;
    end if;
  end loop;

  return query select v_ex, v_ret, v_rej;
end;
$function$;

revoke all on function public.places_verser_wikidata() from public, anon, authenticated;
grant execute on function public.places_verser_wikidata() to service_role;


-- ---- Étape 3 : demander la licence à Commons ------------------------------
-- Une image dont on ne peut pas nommer la licence ne sera pas affichée. C'est
-- la règle du résolveur depuis toujours ; elle vaut aussi ici.
create or replace function public.places_recolter_commons(p_lot integer default 20)
returns table (lances integer)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare c record; v_id bigint; v_n int := 0;
begin
  for c in
    select ca.id, ca.place_id, ca.fichier
      from public.place_image_candidats ca
     where ca.etape = 'wikidata' and ca.statut = 'retenue'
       and ca.fichier is not null
       /* Comme pour Wikidata : « Commons ne sait pas dire la licence » est une
          réponse. Seul `echec` — un 429, une coupure — se rejoue. */
       and not exists (select 1 from public.place_image_candidats d
                        where d.place_id = ca.place_id and d.etape = 'commons'
                          and d.statut in ('lancee','versee','rejetee'))
     order by ca.id
     limit greatest(coalesce(p_lot, 20), 0)
  loop
    select net.http_get(
      url := 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo'
          || '&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=1024'
          || '&iiextmetadatafilter=LicenseShortName%7CLicenseUrl%7CArtist%7CCredit%7CAttributionRequired%7CRestrictions'
          || '&titles=File%3A' || public.url_encode(c.fichier),
      headers := '{"User-Agent":"Autour/1.0 (https://autour.eu; contact@autour.eu)"}'::jsonb,
      timeout_milliseconds := 15000) into v_id;

    insert into public.place_image_candidats
      (place_id, etape, requete_id, fichier, qid, label_source, rapprochement)
      select c.place_id, 'commons', v_id, c.fichier, ca.qid, ca.label_source, ca.rapprochement
        from public.place_image_candidats ca where ca.id = c.id;
    v_n := v_n + 1;
  end loop;

  return query select v_n;
end;
$function$;

revoke all on function public.places_recolter_commons(integer) from public, anon, authenticated;
grant execute on function public.places_recolter_commons(integer) to service_role;


-- ---- Étape 4 : écrire la photo, avec toute sa provenance -------------------
--
-- `image_refs` garde la référence STRUCTURÉE — de quoi refaire le calcul, citer
-- l'auteur et prouver la licence — et pas seulement une URL.
create or replace function public.places_verser_commons()
returns table (examines integer, verses integer, rejetes integer)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  c record; rep record; page jsonb; info jsonb; meta jsonb;
  v_url text; v_lic text; v_lic_url text; v_auteur text; v_credit text;
  v_page text; v_attr boolean;
  v_ex int := 0; v_ok int := 0; v_rej int := 0;
begin
  for c in
    select ca.* from public.place_image_candidats ca
     where ca.etape = 'commons' and ca.statut = 'lancee' and ca.requete_id is not null
  loop
    select r.status_code, r.content into rep
      from net._http_response r where r.id = c.requete_id;
    if rep is null then continue; end if;
    v_ex := v_ex + 1;

    if rep.status_code is distinct from 200 or rep.content is null then
      update public.place_image_candidats
         set statut='echec', motif='commons http '||coalesce(rep.status_code::text,'nul'), recu_le=now()
       where id = c.id;
      v_rej := v_rej + 1; continue;
    end if;

    page := jsonb_path_query_first(rep.content::jsonb, '$.query.pages.*');
    info := page -> 'imageinfo' -> 0;
    meta := info -> 'extmetadata';

    /* L'URL servie est la vignette de 1024 px quand elle existe : personne n'a
       besoin de 6 Mo pour une carte. Les paramètres de suivi ajoutés par
       l'API sont retirés — ils ne font pas partie du fichier. */
    v_url     := split_part(coalesce(info ->> 'thumburl', info ->> 'url', ''), '?', 1);
    v_lic     := nullif(btrim(coalesce(meta -> 'LicenseShortName' ->> 'value', '')), '');
    v_lic_url := nullif(btrim(coalesce(meta -> 'LicenseUrl' ->> 'value', '')), '');
    v_page    := nullif(btrim(coalesce(info ->> 'descriptionurl', '')), '');
    v_attr    := coalesce(lower(coalesce(meta -> 'AttributionRequired' ->> 'value','')) = 'true', false);
    /* Commons rend l'auteur en HTML : on garde le nom, pas le balisage. */
    v_auteur  := nullif(btrim(regexp_replace(
                   coalesce(meta -> 'Artist' ->> 'value', ''), '<[^>]*>', '', 'g')), '');
    v_credit  := nullif(btrim(regexp_replace(
                   coalesce(meta -> 'Credit' ->> 'value', ''), '<[^>]*>', '', 'g')), '');

    if v_url = '' or v_url !~ '^https://' or v_lic is null then
      update public.place_image_candidats
         set statut='rejetee',
             motif = case when v_lic is null then 'aucune licence lisible chez Commons'
                          else 'aucune URL de fichier exploitable' end,
             recu_le = now()
       where id = c.id;
      v_rej := v_rej + 1; continue;
    end if;

    update public.places p set
      image_url        = v_url,
      image_source     = 'wikidata',
      image_source_url = coalesce(v_page, p.image_source_url),
      image_author     = v_auteur,
      image_license    = v_lic,
      image_type       = 'place_photo',
      image_updated_at = now(),
      image_refs       = coalesce(p.image_refs, '{}'::jsonb) || jsonb_build_object(
        'place_photo', jsonb_build_object(
          'url',            v_url,
          'source',         'wikidata',
          'type',           'place_photo',
          'reference',      c.fichier,
          'wikidata_qid',   c.qid,
          'wikidata_label', c.label_source,
          'rapprochement',  c.rapprochement,
          'author',         v_auteur,
          'credit',         v_credit,
          'license',        v_lic,
          'license_url',    v_lic_url,
          'attribution_required', v_attr,
          'page',           v_page,
          'retrieved_at',   to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
     where p.id = c.place_id;

    update public.place_image_candidats
       set statut='versee', url=v_url, url_page=v_page, licence=v_lic, licence_url=v_lic_url,
           auteur=v_auteur, credit=v_credit, attribution_requise=v_attr, recu_le=now()
     where id = c.id;
    v_ok := v_ok + 1;
  end loop;

  return query select v_ex, v_ok, v_rej;
end;
$function$;

revoke all on function public.places_verser_commons() from public, anon, authenticated;
grant execute on function public.places_verser_commons() to service_role;


-- ---- Défaire une photo, sans perdre ce qu'il y avait avant -----------------
--
-- `places_verser_commons` ÉCRASE les colonnes d'image. Si la photo est ensuite
-- révoquée — parce que la règle de nom s'est resserrée, par exemple — le lieu
-- se retrouverait sans rien alors qu'il avait une affiche. `image_refs` garde
-- l'entrée d'origine : cette fonction la remet en place.
--
-- Une image ne revient que si elle porte encore sa licence. Sans licence, elle
-- ne serait de toute façon pas affichée.
create or replace function public.places_restaurer_image_depuis_refs()
returns integer
language sql
set search_path to 'public'
as $function$
  with remises as (
    update public.places p set
      image_url        = p.image_refs ->> 'image',
      image_source     = p.image_refs ->> 'image_source',
      image_source_url = p.image_refs ->> 'image_source_url',
      image_license    = p.image_refs ->> 'image_license',
      image_type       = 'event_poster',
      image_updated_at = now()
     where p.image_url is null
       and p.image_refs ? 'image'
       and nullif(btrim(coalesce(p.image_refs ->> 'image_license','')),'') is not null
       and nullif(btrim(coalesce(p.image_refs ->> 'image','')),'') is not null
       and coalesce(p.image_refs ->> 'image_source','') <> 'google_places'
     returning 1)
  select count(*)::integer from remises;
$function$;

revoke all on function public.places_restaurer_image_depuis_refs()
  from public, anon, authenticated;
grant execute on function public.places_restaurer_image_depuis_refs() to service_role;


-- ---- La mesure : où en est-on vraiment ? -----------------------------------
create or replace view public.places_photos_qualite as
  select
    count(*)                                                     as eligibles,
    count(*) filter (where p.image_type = 'place_photo')          as photos_de_lieu,
    count(*) filter (where p.image_type = 'wikimedia')            as wikimedia,
    count(*) filter (where p.image_type = 'institutional')        as institutionnelles,
    count(*) filter (where p.image_type = 'event_poster')         as affiches,
    count(*) filter (where p.image_url is null)                   as sans_image,
    count(*) filter (where p.image_url is not null
                       and nullif(btrim(coalesce(p.image_license,'')),'') is null) as sans_licence
  from public.places p
  join public.place_familles f on f.famille = p.family
 where p.status = 'active' and p.duplicate_of is null and p.geom is not null;

revoke all on public.places_photos_qualite from anon, authenticated, public;
grant select on public.places_photos_qualite to service_role;
