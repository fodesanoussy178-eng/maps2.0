-- ---------------------------------------------------------------------------
-- LA CASCADE D'IMAGE D'UN ÉVÉNEMENT — ET CE QU'ELLE REFUSE
--
-- CE QUE L'AUDIT A MESURÉ, LE 25/09/2026
--
--   · 1 260 événements à venir sans image.
--   · datatourisme : 1 137 événements à venir, ZÉRO image. DATAtourisme ne
--     sert ni `hasMainRepresentation` ni `source_url` : le résolveur n'avait
--     rien à résoudre. 1 097 de ces 1 137 n'ont AUCUNE URL officielle.
--   · openagenda : 626 images sur 627. La cascade n'a donc jamais manqué là
--     où la source donne quelque chose.
--   · venue_official : 89 événements, 6 images, 83 avec une URL officielle.
--     organizer_official : 37 événements, 0 image, 37 avec une URL. Ces 120
--     événements portent l'adresse de leur propre page et personne ne la
--     lisait.
--   · `artist_names` est lu par `core.js`, `entites-canoniques.js` et trois
--     RPC — et écrit par PERSONNE. Le barreau « image officielle de
--     l'artiste » de la cascade n'a donc aucune entrée aujourd'hui. C'est un
--     manque nommé, pas un manque corrigé ici : inventer un nom d'artiste
--     depuis un titre serait exactement l'inférence que le lot interdit.
--
-- CE QUE CETTE MIGRATION AJOUTE
--
--   1. La provenance complète, en colonnes : type d'image, confiance, droit
--      d'usage, date de vérification. Sans `image_usage_status`, rien ne
--      distinguait « on peut héberger ce fichier » de « on ne peut que le
--      pointer ».
--   2. Le journal `event_image_candidats` : ce qui a été demandé, retenu, et
--      POURQUOI le reste a été rejeté. Un rejet muet se répète sans fin.
--   3. La page officielle de l'événement, lue par `pg_net` EN AMONT. Jamais à
--      l'ouverture d'une fiche : une fiche lit la base, elle ne part pas sur
--      le Web.
--   4. La photo du lieu, et seulement une VRAIE photo de lieu.
--
-- CE QUI N'EST JAMAIS FAIT
--
--   · Aucune recherche d'image par ressemblance, ni par nom sur un moteur
--     d'images. La cascade ne lit que des pages désignées par la source de
--     l'événement, ou des données structurées.
--   · L'AFFICHE D'UN AUTRE ÉVÉNEMENT NE DEVIENT JAMAIS L'IMAGE DE CELUI-CI.
--     Mesuré : « La Condition Publique - Roubaix » porte dans `places` une
--     affiche openagenda d'un autre concert. La prendre pour l'événement NeS
--     serait un mensonge que personne ne signalerait.
--   · Aucun fichier n'est recopié. `image_usage_status = 'remote_only'` dit
--     que la source n'autorise que l'affichage distant, et la colonne existe
--     pour que la règle soit lisible, pas seulement respectée par hasard.
-- ---------------------------------------------------------------------------


-- ---- 1. La provenance, en colonnes ----------------------------------------
alter table public.events
  add column if not exists image_type text,
  add column if not exists image_confidence numeric(3,2),
  add column if not exists image_usage_status text,
  add column if not exists image_checked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_image_type_check') then
    alter table public.events add constraint events_image_type_check
      check (image_type is null or image_type in
        ('event_poster','artist','organizer','venue','institutional','place_photo','fallback'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_image_usage_check') then
    alter table public.events add constraint events_image_usage_check
      check (image_usage_status is null or image_usage_status in
        ('remote_only','reusable','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_image_confidence_check') then
    alter table public.events add constraint events_image_confidence_check
      check (image_confidence is null or (image_confidence >= 0 and image_confidence <= 1));
  end if;
end $$;

comment on column public.events.image_type is
  'Ce que l''image EST : affiche de l''événement, portrait d''artiste, image du lieu… Jamais déduit du fichier.';
comment on column public.events.image_usage_status is
  'Le droit d''usage lu chez la source : remote_only (affichage distant seul), reusable, unknown.';
comment on column public.events.image_confidence is
  'De 0 à 1 : la force du lien entre cette image et CET événement. 1 = la page de l''événement la publie.';
comment on column public.events.image_checked_at is
  'Quand ce lien a été vérifié pour la dernière fois. Distinct de image_updated_at, qui date le fichier.';

/* Les images déjà en base viennent des sources qui les publient elles-mêmes
   (openagenda au premier chef) : ce sont des affiches de l'événement, servies
   en distant. On le DIT, plutôt que de laisser 632 lignes sans provenance —
   mais on ne prétend pas les avoir vérifiées : `image_checked_at` reste nul. */
update public.events
   set image_type = coalesce(image_type, 'event_poster'),
       image_usage_status = coalesce(image_usage_status, 'remote_only'),
       image_confidence = coalesce(image_confidence, 0.90)
 where image_url is not null;


-- ---- 2. Le journal de la cascade ------------------------------------------
create table if not exists public.event_image_candidats (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.events(id) on delete cascade,
  etape      text not null check (etape in ('page_evenement','photo_de_lieu')),
  requete_id bigint,
  statut     text not null default 'lancee'
             check (statut in ('lancee','retenue','rejetee','versee','vide','echec')),
  motif      text,

  url_demandee text,
  url          text,
  url_page     text,
  licence      text,
  auteur       text,
  titre_source text,
  confiance    numeric(3,2),

  lance_le   timestamptz not null default now(),
  recu_le    timestamptz
);

create index if not exists event_image_candidats_event_idx
  on public.event_image_candidats (event_id, etape, statut);
create index if not exists event_image_candidats_requete_idx
  on public.event_image_candidats (requete_id) where requete_id is not null;

comment on table public.event_image_candidats is
  'Journal de la cascade d''image d''un événement : ce qui a été demandé, retenu, et pourquoi le reste a été rejeté.';

alter table public.event_image_candidats enable row level security;
revoke all on public.event_image_candidats from anon, authenticated, public;
grant select, insert, update, delete on public.event_image_candidats to service_role;
revoke all on sequence public.event_image_candidats_id_seq from anon, authenticated, public;
grant usage, select on sequence public.event_image_candidats_id_seq to service_role;


-- ---- 3a. Demander la page officielle de l'événement -----------------------
--
-- L'ORDRE DES URL EST L'ORDRE DE LA CASCADE. La page de l'événement d'abord
-- (`source_url`, `event_source_url`), la billetterie ensuite (`booking_url`,
-- `ticket_url`) — elle décrit CET événement-là —, le site générique en
-- dernier : il parle du lieu, pas de la soirée.
create or replace function public.evenements_recolter_page(p_lot integer default 20)
returns table (lances integer)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare e record; v_id bigint; v_url text; v_n int := 0;
begin
  for e in
    select ev.id,
           coalesce(nullif(btrim(ev.source_url), ''), nullif(btrim(ev.event_source_url), ''),
                    nullif(btrim(ev.booking_url), ''), nullif(btrim(ev.ticket_url), ''),
                    nullif(btrim(ev.website), '')) as url
      from public.events ev
     where ev.image_url is null
       and ev.duplicate_of is null
       and coalesce(ev.temporal_status, '') <> 'past'
       and coalesce(ev.cancelled, false) = false
       /* LE LOT DOIT COMPTER DES PAGES, PAS DES ÉVÉNEMENTS. Mesuré : demander
          90 événements en rendait ZÉRO à lire, parce que la limite était
          consommée par les 1 097 événements DATAtourisme qui n'ont aucune URL.
          La condition d'URL appartient donc au `where`, avant la limite. */
       and coalesce(nullif(btrim(ev.source_url), ''), nullif(btrim(ev.event_source_url), ''),
                    nullif(btrim(ev.booking_url), ''), nullif(btrim(ev.ticket_url), ''),
                    nullif(btrim(ev.website), '')) ~ '^https?://'
       /* Une page déjà lue n'est pas relue. « Cette page ne publie pas
          d'image » est une RÉPONSE. Seul `echec` — une coupure, un 429 — se
          rejoue. */
       and not exists (select 1 from public.event_image_candidats c
                        where c.event_id = ev.id and c.etape = 'page_evenement'
                          and c.statut in ('lancee','retenue','versee','vide','rejetee'))
     order by ev.start_at
     limit greatest(coalesce(p_lot, 20), 0)
  loop
    v_url := e.url;

    select net.http_get(
      url := v_url,
      headers := '{"User-Agent":"Autour/1.0 (https://autour.eu; contact@autour.eu)","Accept":"text/html,application/xhtml+xml"}'::jsonb,
      timeout_milliseconds := 20000) into v_id;

    insert into public.event_image_candidats (event_id, etape, requete_id, url_demandee)
      values (e.id, 'page_evenement', v_id, v_url);
    v_n := v_n + 1;
  end loop;

  return query select v_n;
end;
$function$;

revoke all on function public.evenements_recolter_page(integer) from public, anon, authenticated;
grant execute on function public.evenements_recolter_page(integer) to service_role;


-- ---- 3b. Décider : la page publie-t-elle une image DE CET ÉVÉNEMENT ? -----
--
-- TROIS CONDITIONS, ET AUCUNE N'EST NÉGOCIABLE.
--
--   · la page a répondu 200. Un 403 n'est pas une page : mesuré sur
--     `laconditionpublique.com/agenda/nes`, qui rend 403 et le gabarit
--     « Compte utilisateur ». La page officielle de l'événement NeS n'est pas
--     lisible publiquement, et c'est la vérité à écrire ;
--   · la page porte une image déclarée (`og:image` ou `twitter:image`) en
--     HTTPS absolu. Rien n'est fabriqué à partir d'un chemin relatif ;
--   · la page NOMME l'événement. Sans cette condition, la page d'accueil d'une
--     salle collerait son logo sur chacun de ses vingt concerts. Le titre de
--     l'événement doit apparaître dans le titre de la page ou dans son
--     `og:title` — c'est la source textuelle qui confirme le lien, pas une
--     ressemblance.
create or replace function public.evenements_verser_page()
returns table (examines integer, verses integer, rejetes integer)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  c record; rep record;
  v_img text; v_titre text; v_og_titre text; v_nom text; v_confirme boolean;
  v_mots text[]; v_mot text; v_vus int; v_texte text;
  v_ex int := 0; v_ok int := 0; v_rej int := 0;
begin
  for c in
    select ca.*, ev.title, ev.id as ev_id
      from public.event_image_candidats ca
      join public.events ev on ev.id = ca.event_id
     where ca.etape = 'page_evenement' and ca.statut = 'lancee' and ca.requete_id is not null
  loop
    select r.status_code, r.content into rep
      from net._http_response r where r.id = c.requete_id;
    if rep is null then continue; end if;                 -- réponse pas encore là
    v_ex := v_ex + 1;

    if rep.status_code is distinct from 200 or rep.content is null then
      update public.event_image_candidats
         set statut = 'echec', recu_le = now(),
             motif = 'page http ' || coalesce(rep.status_code::text, 'nul')
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

    /* `og:image` dans les deux ordres d'attributs, puis `twitter:image`. */
    v_img := coalesce(
      (regexp_match(rep.content, '<meta[^>]+property=["'']og:image["''][^>]+content=["'']([^"'']+)'))[1],
      (regexp_match(rep.content, '<meta[^>]+content=["'']([^"'']+)["''][^>]+property=["'']og:image["'']'))[1],
      (regexp_match(rep.content, '<meta[^>]+name=["'']twitter:image["''][^>]+content=["'']([^"'']+)'))[1]);
    /* Postgres plafonne une borne de répétition à 255 : `{0,300}` lève
       « invalid repetition count(s) ». 240 suffit largement pour un titre. */
    v_titre := (regexp_match(rep.content, '<title>([^<]{0,240})'))[1];
    v_og_titre := (regexp_match(rep.content,
      '<meta[^>]+property=["'']og:title["''][^>]+content=["'']([^"'']{0,240})'))[1];

    if v_img is null or v_img !~ '^https://' then
      update public.event_image_candidats
         set statut = 'vide', recu_le = now(),
             motif = case when v_img is null then 'la page ne déclare aucune image'
                          else 'image déclarée non absolue en https' end
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

    /* LA PAGE NOMME-T-ELLE L'ÉVÉNEMENT ? Les mots du titre de l'événement de
       quatre lettres ou plus, cherchés dans le titre de la page. Au moins deux
       — ou le seul qu'il y ait. « NES » n'en a qu'un : il doit y être. */
    v_nom := public.place_nom_normalise(c.title);
    v_texte := public.place_nom_normalise(coalesce(v_og_titre, '') || ' ' || coalesce(v_titre, ''));
    v_mots := array(select m from unnest(string_to_array(coalesce(v_nom, ''), ' ')) m
                     where length(m) >= 4);
    v_vus := 0;
    foreach v_mot in array coalesce(v_mots, array[]::text[]) loop
      if position(v_mot in coalesce(v_texte, '')) > 0 then v_vus := v_vus + 1; end if;
    end loop;
    v_confirme := coalesce(array_length(v_mots, 1), 0) > 0
                  and v_vus >= least(2, array_length(v_mots, 1));

    if not v_confirme then
      update public.event_image_candidats
         set statut = 'rejetee', recu_le = now(), url = v_img, titre_source = v_titre,
             motif = 'la page ne nomme pas l''événement : son image peut être celle d''un autre'
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

    /* L'IMAGE N'EST PAS RECOPIÉE. On garde son adresse et son droit d'usage :
       la page d'un organisateur autorise l'affichage, pas la réutilisation.
       `remote_only` est donc la valeur honnête, et `image_license` reste nulle
       tant que la page ne nomme pas de licence — ce qu'aucune ne fait. */
    update public.events ev set
      image_url          = v_img,
      image_source       = 'event_page',
      image_source_url   = c.url_demandee,
      image_type         = 'event_poster',
      image_usage_status = 'remote_only',
      image_confidence   = 0.85,
      image_checked_at   = now(),
      image_updated_at   = now()
     where ev.id = c.ev_id;

    update public.event_image_candidats
       set statut = 'versee', recu_le = now(), url = v_img, url_page = c.url_demandee,
           titre_source = coalesce(v_og_titre, v_titre), confiance = 0.85
     where id = c.id;
    v_ok := v_ok + 1;
  end loop;

  return query select v_ex, v_ok, v_rej;
end;
$function$;

revoke all on function public.evenements_verser_page() from public, anon, authenticated;
grant execute on function public.evenements_verser_page() to service_role;


-- ---- 4. La photo du lieu, et rien d'autre ---------------------------------
--
-- Le quatrième barreau de la cascade : à défaut d'image de l'événement, une
-- VRAIE photo du lieu où il se tient. Trois gardes :
--
--   · `image_type = 'place_photo'` seulement. Une affiche openagenda rangée
--     dans `places` est l'affiche d'un AUTRE événement : la reprendre ferait
--     passer un concert pour un autre. Mesuré sur « La Condition Publique -
--     Roubaix », dont la seule image est exactement cela ;
--   · une licence lisible, sinon l'image ne serait pas affichable ;
--   · 60 mètres. Au-delà, « le lieu d'à côté » n'est plus le lieu.
--
-- L'image reste ÉTIQUETÉE `venue` : la fiche doit pouvoir dire « photo du
-- lieu », pas laisser croire à une photo de la soirée.
create or replace function public.evenements_images_depuis_places(p_rayon_m double precision default 60)
returns table (verses integer)
language plpgsql
set search_path to 'public', 'extensions', 'topology'
as $function$
declare v_n int := 0;
begin
  with choix as (
    select distinct on (ev.id)
           ev.id as event_id, p.id as place_id, p.image_url, p.image_source,
           p.image_source_url, p.image_author, p.image_license,
           ST_Distance(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::topology.geography,
                       ST_SetSRID(ST_MakePoint(ev.lng, ev.lat), 4326)::topology.geography) as d
      from public.events ev
      join public.places p
        on p.status = 'active' and p.duplicate_of is null
       and p.image_url is not null
       and p.image_type = 'place_photo'
       and nullif(btrim(coalesce(p.image_license, '')), '') is not null
       and ST_DWithin(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::topology.geography,
                      ST_SetSRID(ST_MakePoint(ev.lng, ev.lat), 4326)::topology.geography,
                      greatest(coalesce(p_rayon_m, 60), 10))
     where ev.image_url is null
       and ev.duplicate_of is null
       and ev.lat is not null and ev.lng is not null
       and coalesce(ev.temporal_status, '') <> 'past'
       and coalesce(ev.cancelled, false) = false
     order by ev.id, d asc
  ), ecrits as (
    update public.events ev set
      image_url          = ch.image_url,
      /* LA PROVENANCE EST « LA PHOTO DU LIEU », PAS CELLE DU LIEU.

         Mesuré : recopier `places.image_source` posait `wikidata` sur
         l'événement — un mot que le vocabulaire du résolveur ne connaît pas
         (`images.js` dit `wikimedia_commons`), donc une image écrite en base
         et jamais affichée. La provenance dite ici est celle du CHEMIN
         (`places`) ; l'origine du fichier reste vérifiable par
         `image_source_url`, qui pointe la page Commons. */
      image_source       = 'places',
      image_source_url   = ch.image_source_url,
      image_author       = ch.image_author,
      image_license      = ch.image_license,
      image_type         = 'venue',
      image_usage_status = 'remote_only',
      /* Une photo du lieu illustre l'endroit, jamais la soirée : la confiance
         dans le LIEN avec cet événement-ci reste basse, et c'est ce que la
         fiche lit pour décider si elle l'annonce comme telle. */
      image_confidence   = 0.50,
      image_checked_at   = now(),
      image_updated_at   = now()
      from choix ch where ev.id = ch.event_id
     returning 1)
  select count(*)::integer into v_n from ecrits;

  return query select v_n;
end;
$function$;

revoke all on function public.evenements_images_depuis_places(double precision)
  from public, anon, authenticated;
grant execute on function public.evenements_images_depuis_places(double precision) to service_role;


-- ---- 5. La mesure : où en est la cascade ? --------------------------------
create or replace view public.evenements_images_qualite as
  select
    count(*)                                                          as a_venir,
    count(*) filter (where image_url is not null)                     as avec_image,
    count(*) filter (where image_type = 'event_poster')                as affiches,
    count(*) filter (where image_type = 'venue')                       as photos_de_lieu,
    count(*) filter (where image_type = 'artist')                      as portraits_artiste,
    count(*) filter (where image_url is null)                          as sans_image,
    count(*) filter (where image_url is null
                       and coalesce(source_url, event_source_url, booking_url,
                                    ticket_url, website) is not null)  as sans_image_mais_url,
    count(*) filter (where image_url is null
                       and array_length(artist_names, 1) > 0)          as sans_image_mais_artiste,
    count(*) filter (where image_url is not null
                       and image_usage_status is null)                 as usage_inconnu
  from public.events
 where duplicate_of is null and coalesce(temporal_status, '') <> 'past';

revoke all on public.evenements_images_qualite from anon, authenticated, public;
grant select on public.evenements_images_qualite to service_role;
