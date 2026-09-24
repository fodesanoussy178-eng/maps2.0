-- ---------------------------------------------------------------------------
-- UNE OFFRE AVEC UNE ADRESSE MAIS SANS POSITION N'ENTRAIT PAS
--
-- `offres_verser_collectes` rejette tout enregistrement sans `geolocalisation` :
--
--   if v_lat is null or v_lng is null … then c_rej := c_rej + 1; continue; end if;
--
-- C'était juste tant que la position était la seule façon de situer une offre.
-- Mais le jeu CROUS porte AUSSI l'adresse postale — « 2 Avenue Jean Perrin
-- 59650 Villeneuve-d'Ascq » — et la France publie une Base Adresse Nationale
-- qui transforme cette chaîne en coordonnées, gratuitement, sans clé.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS. Elle ne change pas le parseur : aucune
-- des 46 offres CROUS actuelles ne manque de position, donc rien à rattraper
-- aujourd'hui. Elle pose le RATTRAPAGE, pour la prochaine source qui donnera
-- une adresse sans coordonnées — et pour les enregistrements que la source
-- actuelle pourrait cesser de géolocaliser.
--
-- POURQUOI DEUX FONCTIONS ET PAS UNE. `pg_net` est asynchrone : `net.http_get`
-- rend un identifiant, pas une réponse. Une fonction qui voudrait attendre
-- bloquerait la transaction sans jamais rien lire. On suit donc exactement le
-- chemin déjà éprouvé par `offres_collecter` / `offres_verser_collectes` :
-- une fonction poste, une autre relit.
--
-- ET POURQUOI UN DÉLAI COURT. Un `timeout_milliseconds` généreux ne rend pas
-- la requête plus patiente : il immobilise la file de `pg_net` pour tout le
-- monde, y compris les synchronisations d'événements. Cinq secondes suffisent à
-- api-adresse.data.gouv.fr, et une adresse non résolue sera retentée.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- LA PROVENANCE DE LA POSITION, PARCE QU'ELLE CHANGE DE MAIN
--
-- Jusqu'ici une position d'offre venait du jeu de données lui-même. Une
-- position géocodée vient d'AILLEURS : elle est le résultat d'un appariement,
-- avec un score, sur une adresse écrite à la main par quelqu'un. Ce n'est pas
-- la même chose, et une fiche qui affiche « 820 m » doit pouvoir dire d'où
-- vient ce 820.
-- ---------------------------------------------------------------------------
alter table public.offers
  add column if not exists coord_source text,
  add column if not exists coord_score  double precision;

comment on column public.offers.coord_source is
  'D''où vient lat/lng : « source » (le jeu de données la publiait), « place » (héritée du lieu rattaché), « ban » (géocodée depuis l''adresse via la Base Adresse Nationale).';
comment on column public.offers.coord_score is
  'Score d''appariement rendu par la BAN, entre 0 et 1. NULL quand la position ne vient pas d''un géocodage.';

-- La file des géocodages : une ligne par demande, son identifiant pg_net, et
-- ce qu'on a fini par en apprendre. On garde les échecs — sans eux on
-- redemanderait indéfiniment la même adresse introuvable.
create table if not exists public.offer_geocodages (
  id           bigserial primary key,
  offer_id     uuid not null references public.offers(id) on delete cascade,
  adresse      text not null,
  requete_id   bigint,
  lancee_le    timestamptz not null default now(),
  resolue_le   timestamptz,
  statut       text not null default 'en_cours'
               check (statut in ('en_cours','resolue','refusee','echec')),
  score        double precision,
  raison       text
);

comment on table public.offer_geocodages is
  'File des demandes de géocodage d''adresses d''offres auprès de la Base Adresse Nationale. Les refus sont conservés : sans eux, une adresse introuvable serait redemandée sans fin.';

create index if not exists offer_geocodages_attente_idx
  on public.offer_geocodages (statut, lancee_le) where statut = 'en_cours';
create index if not exists offer_geocodages_offre_idx
  on public.offer_geocodages (offer_id, lancee_le desc);

alter table public.offer_geocodages enable row level security;
revoke all on public.offer_geocodages from anon, authenticated;
revoke all on sequence public.offer_geocodages_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- POSTER — bornée, une adresse à la fois, jamais deux fois la même en vol
-- ---------------------------------------------------------------------------
create or replace function public.offres_geocoder_lancer(p_max integer default 20)
returns table (lancees int, restantes int)
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare
  o record;
  v_lancees int := 0;
  v_restantes int;
begin
  for o in
    select f.id, f.address
      from public.offers f
     where f.lat is null
       and f.lng is null
       and f.place_id is null            -- une offre rattachée hérite du lieu
       and nullif(btrim(coalesce(f.address, '')), '') is not null
       and f.status <> 'disabled'
       /* Ni une demande en vol, ni une adresse déjà refusée : la BAN n'a pas
          changé d'avis depuis ce matin. */
       and not exists (
         select 1 from public.offer_geocodages g
          where g.offer_id = f.id
            and (g.statut = 'en_cours'
                 or (g.statut in ('refusee','echec')
                     and g.lancee_le > now() - interval '30 days'))
       )
     order by f.last_seen_at desc nulls last, f.id
     limit greatest(coalesce(p_max, 20), 0)
  loop
    insert into public.offer_geocodages (offer_id, adresse, requete_id)
    values (
      o.id,
      btrim(o.address),
      net.http_get(
        /* `public.url_encode` existe déjà — posée par la récolte de photos de
           lieux, elle encode octet par octet. Une adresse porte des espaces,
           des apostrophes et des accents : « 2 Avenue Jean Perrin 59650
           Villeneuve-d'Ascq » ne traverse pas une query string telle quelle. */
        'https://api-adresse.data.gouv.fr/search/?limit=1&q='
          || public.url_encode(btrim(o.address)),
        headers => jsonb_build_object('Accept', 'application/json'),
        /* Cinq secondes. Voir l'en-tête : un délai long immobilise la file
           de pg_net pour toutes les autres fonctions. */
        timeout_milliseconds => 5000
      )
    );
    v_lancees := v_lancees + 1;
  end loop;

  select count(*) into v_restantes
    from public.offers f
   where f.lat is null and f.lng is null and f.place_id is null
     and nullif(btrim(coalesce(f.address, '')), '') is not null
     and f.status <> 'disabled';

  return query select v_lancees, coalesce(v_restantes, 0)::int;
end
$function$;

revoke all on function public.offres_geocoder_lancer(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RELIRE — et refuser plutôt que d'approcher
--
-- LE SEUIL EST LE CŒUR DE CETTE FONCTION. La BAN répond TOUJOURS quelque
-- chose : demandez-lui « Cafétéria » et elle proposera une rue quelque part en
-- France, avec un score de 0,2. Accepter cela mettrait un point sur la carte à
-- 300 km du lieu, et la fiche afficherait sa distance sans hésiter. Deux
-- garde-fous, donc :
--
--   — un score d'au moins 0,6, ce que la BAN rend sur une adresse complète ;
--   — le code postal de la réponse doit être celui de l'adresse demandée,
--     quand l'adresse en portait un. C'est le contrôle qui compte vraiment :
--     un score peut être flatteur, un code postal ne l'est pas.
-- ---------------------------------------------------------------------------
create or replace function public.offres_geocoder_verser()
returns table (lues int, resolues int, refusees int, echecs int, attendues int)
language plpgsql
security definer
set search_path to 'public', 'net', 'topology'
as $function$
declare
  g record; rep record; trait jsonb;
  v_lat double precision; v_lng double precision;
  v_score double precision; v_cp text; v_cp_demande text;
  c_lues int := 0; c_res int := 0; c_ref int := 0; c_ech int := 0; c_att int := 0;
begin
  for g in
    select * from public.offer_geocodages
     where statut = 'en_cours' and requete_id is not null
     order by lancee_le
     limit 200
  loop
    select * into rep from net._http_response where id = g.requete_id;
    if not found then
      /* La réponse n'est pas encore arrivée — ou pg_net l'a déjà purgée. Au
         bout d'une heure on abandonne cette demande plutôt que de garder une
         ligne « en cours » qui bloquerait l'offre pour toujours. */
      if g.lancee_le < now() - interval '1 hour' then
        update public.offer_geocodages
           set statut = 'echec', resolue_le = now(),
               raison = 'aucune réponse pg_net retrouvée'
         where id = g.id;
        c_ech := c_ech + 1;
      else
        c_att := c_att + 1;
      end if;
      continue;
    end if;
    c_lues := c_lues + 1;

    if rep.status_code is null or rep.status_code <> 200 then
      update public.offer_geocodages
         set statut = 'echec', resolue_le = now(),
             raison = 'HTTP ' || coalesce(rep.status_code::text, 'sans code')
       where id = g.id;
      c_ech := c_ech + 1;
      continue;
    end if;

    begin
      trait := (rep.content::jsonb -> 'features' -> 0);
    exception when others then
      trait := null;
    end;

    if trait is null or trait = 'null'::jsonb then
      update public.offer_geocodages
         set statut = 'refusee', resolue_le = now(),
             raison = 'aucune adresse trouvée'
       where id = g.id;
      c_ref := c_ref + 1;
      continue;
    end if;

    v_lng := nullif(trait -> 'geometry' -> 'coordinates' ->> 0, '')::double precision;
    v_lat := nullif(trait -> 'geometry' -> 'coordinates' ->> 1, '')::double precision;
    v_score := nullif(trait -> 'properties' ->> 'score', '')::double precision;
    v_cp := nullif(trait -> 'properties' ->> 'postcode', '');
    v_cp_demande := nullif(btrim(substring(g.adresse from '\y[0-9]{5}\y')), '');

    if v_lat is null or v_lng is null then
      update public.offer_geocodages
         set statut = 'refusee', resolue_le = now(), score = v_score,
             raison = 'réponse sans coordonnées'
       where id = g.id;
      c_ref := c_ref + 1;
      continue;
    end if;

    if coalesce(v_score, 0) < 0.6 then
      update public.offer_geocodages
         set statut = 'refusee', resolue_le = now(), score = v_score,
             raison = 'score insuffisant : ' || coalesce(v_score::text, 'aucun')
       where id = g.id;
      c_ref := c_ref + 1;
      continue;
    end if;

    if v_cp_demande is not null and v_cp is not null and v_cp <> v_cp_demande then
      update public.offer_geocodages
         set statut = 'refusee', resolue_le = now(), score = v_score,
             raison = 'code postal rendu ' || v_cp || ' au lieu de ' || v_cp_demande
       where id = g.id;
      c_ref := c_ref + 1;
      continue;
    end if;

    /* La position n'est écrite que si elle est TOUJOURS absente : entre le
       lancement et la relecture, une collecte a pu la fournir, et la source
       fait foi devant un appariement. */
    update public.offers
       set lat = v_lat, lng = v_lng,
           coord_source = 'ban', coord_score = v_score,
           updated_at = now()
     where id = g.offer_id and lat is null and lng is null;

    update public.offer_geocodages
       set statut = 'resolue', resolue_le = now(), score = v_score
     where id = g.id;
    c_res := c_res + 1;
  end loop;

  return query select c_lues, c_res, c_ref, c_ech, c_att;
end
$function$;

revoke all on function public.offres_geocoder_verser() from public, anon, authenticated;

comment on function public.offres_geocoder_lancer(integer) is
  'Demande à la Base Adresse Nationale les coordonnées des offres qui ont une adresse et pas de position. Ne redemande ni une adresse en vol, ni une adresse refusée depuis moins de 30 jours.';
comment on function public.offres_geocoder_verser() is
  'Relit les réponses de la BAN et n''écrit une position que si le score atteint 0,6 ET que le code postal rendu est celui demandé. Une position déjà fournie par la source n''est jamais écrasée.';
