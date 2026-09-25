-- ---------------------------------------------------------------------------
-- LA CASCADE D'IMAGE TOURNE TOUTE SEULE — ET TROIS CORRECTIONS MESURÉES
--
-- POURQUOI DEUX MIGRATIONS
--
-- `20260925120000` a été appliquée puis exécutée sur les données réelles. Trois
-- défauts sont apparus À L'EXÉCUTION, pas à la lecture. Ils sont corrigés ici
-- plutôt que réécrits là-bas : le registre de production garde ainsi la trace
-- de ce qui s'est passé, et un rejeu depuis zéro donne le même état final —
-- les trois fonctions sont des `create or replace`.
--
--   1. LE LOT COMPTAIT DES ÉVÉNEMENTS, PAS DES PAGES. Demander 90 événements
--      en rendait ZÉRO à lire : la limite était consommée par les 1 097
--      événements DATAtourisme sans aucune URL. La condition d'URL appartient
--      au `where`, avant la limite. Mesuré : 0 lancé, puis 70.
--   2. POSTGRES PLAFONNE UNE BORNE DE RÉPÉTITION À 255. `([^<]{0,300})` lève
--      « invalid repetition count(s) » à l'exécution — pas à la création de la
--      fonction. 240 suffit pour un titre de page.
--   3. LA PROVENANCE D'UNE PHOTO DE LIEU ÉTAIT CELLE DU LIEU. Recopier
--      `places.image_source` posait `wikidata` sur l'événement, un mot que le
--      vocabulaire du résolveur ne connaît pas (`images.js` dit
--      `wikimedia_commons`). Résultat mesuré : 26 images écrites en base et
--      jamais affichées. La provenance dite est celle du CHEMIN — `places` —
--      et l'origine du fichier reste vérifiable par `image_source_url`.
--
-- ET LA PLANIFICATION
--
-- L'enrichissement doit être EN AMONT : une fiche lit la base, elle ne part
-- jamais sur le Web. Deux tâches `pg_cron` toutes les trois heures, décalées
-- de quinze minutes — `pg_net` est asynchrone, la réponse n'est pas là au
-- retour de l'appel. Le GitHub Actions ne peut pas tenir ce rôle : il détient
-- le droit de DÉCLENCHER une synchronisation, pas de clé `service_role`, et
-- c'est une propriété qu'on ne défait pas pour une commodité.
-- ---------------------------------------------------------------------------

-- ---- 1. Le lot compte des pages -------------------------------------------
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
       and coalesce(nullif(btrim(ev.source_url), ''), nullif(btrim(ev.event_source_url), ''),
                    nullif(btrim(ev.booking_url), ''), nullif(btrim(ev.ticket_url), ''),
                    nullif(btrim(ev.website), '')) ~ '^https?://'
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


-- ---- 2. La borne de répétition tient dans la limite de Postgres -----------
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
    if rep is null then continue; end if;
    v_ex := v_ex + 1;

    if rep.status_code is distinct from 200 or rep.content is null then
      update public.event_image_candidats
         set statut = 'echec', recu_le = now(),
             motif = 'page http ' || coalesce(rep.status_code::text, 'nul')
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

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

    /* UNE VRAIE AFFICHE NE SE FAIT JAMAIS ÉCRASER.

       Le candidat n'a été créé que pour un événement SANS image — mais la
       lecture de page et l'écriture sont séparées de quinze minutes, et une
       synchronisation passe entre les deux. Mesuré sur l'événement NeS : la
       fusion OpenAgenda de 06:00:56 lui a apporté son affiche alors que la
       cascade le tenait pour dépourvu. Sans cette garde, l'image `og:image`
       d'une page de salle aurait remplacé l'affiche de l'artiste.

       La condition est donc REVÉRIFIÉE à l'écriture, et le candidat garde la
       trace de ce qui s'est passé au lieu de disparaître en « versée ». */
    update public.events ev set
      image_url          = v_img,
      image_source       = 'event_page',
      image_source_url   = c.url_demandee,
      image_type         = 'event_poster',
      image_usage_status = 'remote_only',
      image_confidence   = 0.85,
      image_checked_at   = now(),
      image_updated_at   = now()
     where ev.id = c.ev_id
       and ev.image_url is null;

    if not found then
      update public.event_image_candidats
         set statut = 'rejetee', recu_le = now(), url = v_img,
             titre_source = coalesce(v_og_titre, v_titre),
             motif = 'la source a fourni sa propre image entre-temps : on ne l''écrase pas'
       where id = c.id;
      v_rej := v_rej + 1;
      continue;
    end if;

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


-- ---- 3. La provenance d'une photo de lieu est « places » ------------------
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
      image_source       = 'places',
      image_source_url   = ch.image_source_url,
      image_author       = ch.image_author,
      image_license      = ch.image_license,
      image_type         = 'venue',
      image_usage_status = 'remote_only',
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

/* Les 26 lignes déjà écrites avec l'ancienne provenance. */
update public.events set image_source = 'places'
 where image_type = 'venue' and image_source is distinct from 'places';


-- ---- 4. La planification --------------------------------------------------
--
-- Deux tâches, décalées de quinze minutes, toutes les trois heures. Le décalage
-- n'est pas une précaution : `pg_net` rend un identifiant, pas une réponse. Lire
-- `net._http_response` dans la même transaction que l'appel ne rendrait rien, et
-- le journal conclurait « aucune page ne déclare d'image » — un mensonge produit
-- par une erreur d'horloge.
--
-- Le lot est petit à dessein : 40 pages toutes les trois heures, c'est 320 par
-- jour, largement plus que les 83 pages encore à lire, et assez peu pour
-- qu'aucun site ne voie passer une rafale.
select cron.schedule('evenements-images-recolter', '20 */3 * * *',
  $$select public.evenements_recolter_page(40);$$);

select cron.schedule('evenements-images-verser', '35 */3 * * *',
  $$select public.evenements_verser_page(), public.evenements_images_depuis_places(60);$$);
