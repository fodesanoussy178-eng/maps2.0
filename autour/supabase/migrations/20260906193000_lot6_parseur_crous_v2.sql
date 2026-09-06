-- ---------------------------------------------------------------------------
-- LOT 6 · 3 (suite) — LE PARSEUR CROUS GARDE CE QUE LA SOURCE DONNE
--
-- Le parseur v1 lisait le titre, la description et les coordonnées, et jetait
-- le reste. Or l'enregistrement réel porte davantage :
--
--   contact → l'adresse postale, qui est le meilleur signal de rapprochement
--             avec un lieu de l'inventaire ;
--   zone    → la commune ;
--   infos   → les horaires, écrits en français ;
--   closing → une fermeture temporaire.
--
-- La photo (`photo`, hébergée sur crous-lille.fr) reste ÉCARTÉE : le jeu de
-- données est sous Licence Ouverte, mais une licence de données ne licencie
-- pas une photographie. Lui en attribuer une serait fabriquer une licence.
--
-- Le parseur passe donc en `ods_crous_v2`. La version v1 reste acceptée par la
-- même branche : une collecte déjà lancée sous v1 doit pouvoir se verser.
-- ---------------------------------------------------------------------------

create or replace function public.offres_verser_collectes()
returns table (collectes int, lus int, retenus int, creees int, revues int,
               rejetees int, inchangees int, echecs int)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  j record; s record; rep record; it jsonb; r record;
  v_lat double precision; v_lng double precision; v_ville text;
  v_contact text; v_adresse text; v_horaires text; v_fermee boolean;
  n_col int := 0; n_lus int := 0; n_ret int := 0; n_cree int := 0;
  n_revu int := 0; n_rej int := 0; n_inch int := 0; n_ech int := 0;
  c_lus int; c_ret int; c_cree int; c_revu int; c_rej int;
begin
  for j in
    select c.id, c.requete_id, c.registry_id from public.offer_collectes c
     where c.statut = 'lancee' and c.requete_id is not null order by c.id
  loop
    select * into rep from net._http_response where id = j.requete_id;
    if rep.id is null then continue; end if;          -- pas encore répondu
    n_col := n_col + 1;
    select * into s from public.offer_source_registry where id = j.registry_id;

    if rep.status_code = 304 then
      update public.offer_collectes
         set statut='inchangee', verse_le=now(), code_http=304 where id=j.id;
      update public.offer_source_registry
         set status='inchangee', last_success_at=now(), updated_at=now() where id=s.id;
      n_inch := n_inch + 1; continue;
    end if;

    if rep.status_code <> 200 or rep.content is null then
      update public.offer_collectes set statut='echec', verse_le=now(),
             code_http=rep.status_code, message=left(coalesce(rep.error_msg,''),200)
       where id=j.id;
      update public.offer_source_registry
         set status='erreur', dernier_message=left(coalesce(rep.error_msg,'HTTP '||rep.status_code),200),
             updated_at=now() where id=s.id;
      n_ech := n_ech + 1; continue;
    end if;

    /* Ce que la source dit d'elle-même, gardé pour le prochain passage. */
    update public.offer_source_registry set
      etag = coalesce(rep.headers->>'etag', etag),
      last_modified = coalesce(rep.headers->>'last-modified', last_modified),
      status = 'ok', last_success_at = now(), dernier_message = null, updated_at = now()
    where id = s.id;

    c_lus := 0; c_ret := 0; c_cree := 0; c_revu := 0; c_rej := 0;

    if s.parser_version in ('ods_crous_v1','ods_crous_v2') then
      for it in select * from jsonb_array_elements(
                  coalesce((rep.content::jsonb)->'results', '[]'::jsonb))
      loop
        c_lus := c_lus + 1;
        v_lat := nullif(it->'geolocalisation'->>'lat','')::double precision;
        v_lng := nullif(it->'geolocalisation'->>'lon','')::double precision;
        /* Sans position, l'offre ne peut ni se situer ni se rattacher à une
           zone : elle n'entre pas. Sans titre non plus. */
        if v_lat is null or v_lng is null
           or nullif(btrim(coalesce(it->>'title','')),'') is null then
          c_rej := c_rej + 1; continue;
        end if;
        /* Le champ `contact` porte l'adresse postale avant le téléphone :
           « Cafétéria 3.14 2 Avenue Jean Perrin 59650 Villeneuve-d'Ascq
             Téléphone : … ». On coupe au téléphone, on retire le titre du
           lieu quand il ouvre la chaîne, et ce qui reste est l'adresse. */
        v_contact := btrim(coalesce(it->>'contact',''));
        v_adresse := btrim(split_part(split_part(v_contact, 'Téléphone', 1), 'E-mail', 1));
        if v_adresse <> '' and position(btrim(it->>'title') in v_adresse) = 1 then
          v_adresse := btrim(substr(v_adresse, length(btrim(it->>'title')) + 1));
        end if;
        v_adresse := nullif(v_adresse, '');
        /* La commune se lit sur l'ADRESSE, pas sur tout le contact : ce
           dernier finit par le téléphone et le courriel, jamais par la ville. */
        v_ville := nullif(btrim(substring(coalesce(v_adresse,'')
                     from '[0-9]{5}\s+(.+?)\s*$')), '');
        /* Les horaires sont écrits en français dans `infos`. La transcription
           refuse tout dès qu'une expression horaire lui échappe. */
        v_horaires := public.horaires_depuis_texte_fr(it->>'infos');
        /* `closing` est un fait de la source, pas une déduction. */
        v_fermee := coalesce(nullif(it->>'closing','')::int, 0) = 1;
        c_ret := c_ret + 1;

        select * into r from public.offres_ingerer(
          p_source      => 'crous_ods',
          p_external_id => it->>'id',
          p_titre       => btrim(it->>'title'),
          p_source_name => 'CROUS · Ministère de l''Enseignement supérieur',
          p_source_url  => 'https://www.data.gouv.fr/datasets/ensemble-des-lieux-de-restauration-des-crous',
          p_description => nullif(btrim(coalesce(it->>'short_desc','')),''),
          p_offer_type  => 'tarif_reduit',
          p_audience    => array['student']::text[],
          p_zone_id     => s.zone_id,
          p_lat         => v_lat,
          p_lng         => v_lng,
          p_eligibilite => 'Tarif CROUS, sur présentation de la carte étudiante.',
          p_raw         => case when s.conserver_brut then it else null end);
        if r.offer_id is null then c_rej := c_rej + 1;
        else
          /* Ce que `offres_ingerer` ne sait pas porter — adresse, commune,
             horaires transcrits, fermeture temporaire — est posé ici, sur
             l'offre que l'ingestion vient de rendre. Aucune de ces valeurs
             n'écrase quoi que ce soit par une supposition : chacune vient
             d'un champ que la source a rempli. */
          update public.offers o set
            address            = coalesce(v_adresse, o.address),
            commune            = coalesce(v_ville, o.commune),
            opening_hours      = coalesce(v_horaires, o.opening_hours),
            opening_hours_texte= coalesce(nullif(btrim(coalesce(it->>'infos','')),''),
                                          o.opening_hours_texte),
            temporarily_closed = v_fermee,
            last_checked_at    = now(),
            absences           = 0
          where o.id = r.offer_id;
          if r.action = 'creee' then c_cree := c_cree + 1;
          else c_revu := c_revu + 1; end if;
        end if;
      end loop;
    else
      /* Une forme qu'on ne sait pas lire reste une erreur. Deviner produirait
         des offres qui n'existent pas. */
      update public.offer_collectes set statut='echec', verse_le=now(),
             code_http=rep.status_code,
             message='parseur inconnu : '||coalesce(s.parser_version,'(aucun)')
       where id=j.id;
      update public.offer_source_registry set status='erreur',
             dernier_message='parseur inconnu', updated_at=now() where id=s.id;
      n_ech := n_ech + 1; continue;
    end if;

    update public.offer_collectes set
      statut = case when c_lus = 0 then 'vide' else 'versee' end,
      verse_le = now(), code_http = rep.status_code,
      lus = c_lus, retenus = c_ret, crees = c_cree, revus = c_revu, rejetes = c_rej
    where id = j.id;

    n_lus := n_lus + c_lus; n_ret := n_ret + c_ret; n_cree := n_cree + c_cree;
    n_revu := n_revu + c_revu; n_rej := n_rej + c_rej;
  end loop;

  return query select n_col, n_lus, n_ret, n_cree, n_revu, n_rej, n_inch, n_ech;
end;
$function$;

-- La source déclare désormais lire la v2.
update public.offer_source_registry
   set parser_version = 'ods_crous_v2', updated_at = now()
 where parser_version = 'ods_crous_v1';
