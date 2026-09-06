-- ---------------------------------------------------------------------------
-- LOT 5 · CORRECTIF — C'EST LA GÉOGRAPHIE QUI DÉCIDE DE LA ZONE
--
-- CE QUI N'ALLAIT PAS
--
-- Le déclencheur écrivait `zone_id := coalesce(new.zone_id, zone_autour_pour(…))`.
-- La zone DÉCLARÉE par la source du registre l'emportait donc sur la zone
-- RÉELLE du point. Le registre CROUS est déclaré sur `mel` ; le jeu de données
-- national du CROUS couvre toute la France. Résultat : un restaurant
-- universitaire de Rennes serait entré dans la zone lilloise et se serait
-- affiché « autour d'ici » à Lille.
--
-- La zone déclarée d'une source dit où l'on VA CHERCHER. Elle ne dit pas où se
-- trouve ce qu'on a trouvé. Quand on a des coordonnées, elles tranchent ; la
-- déclaration ne sert plus que de repli, pour une offre sans point (une offre
-- nationale, un droit ouvert partout).
--
-- Même chose pour l'héritage depuis le lieu : l'offre prend la POSITION du
-- lieu, et la zone se recalcule ensuite depuis cette position, au lieu d'être
-- recopiée. Une seule vérité géographique, dérivée du point.
--
-- Et le rattachement territorial passe toujours par `zone_autour_pour()` :
-- elle ne fait que chercher. Aucune offre ne crée de territoire.
-- ---------------------------------------------------------------------------

create or replace function public.offers_avant_ecriture()
returns trigger
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare base text;
begin
  /* Une offre rattachée à un lieu hérite de sa POSITION — le lieu sait où il
     est. La zone, elle, n'est pas recopiée : elle se redéduit du point. */
  if new.place_id is not null then
    select p.lat, p.lng into new.lat, new.lng
      from public.places p where p.id = new.place_id;
  end if;

  new.geom := case
    when new.lat is null or new.lng is null then null
    else ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)
  end;

  /* Dès qu'un point existe, il tranche. Sans point, la zone reste celle que
     l'appelant a fournie — une offre nationale n'a pas de coordonnées. */
  if new.lat is not null and new.lng is not null then
    new.zone_id := public.zone_autour_pour(new.lat, new.lng);
  end if;

  new.dedup_key := case
    when public.place_nom_normalise(new.title) is null then null
    else public.place_nom_normalise(new.title)
         || '|' || coalesce(new.source_name, '')
         || '|' || coalesce(to_char(new.ends_at at time zone 'UTC', 'YYYYMMDD'), 'sansfin')
  end;

  /* Une offre dont la date de fin est passée n'est pas supprimée : elle est
     close. On garde la trace — c'est ce qui permet de dire « c'était vrai
     jusqu'au 30 juin » plutôt que de faire comme si elle n'avait jamais
     existé. */
  if new.ends_at is not null and new.ends_at < now() and new.status = 'active' then
    new.status := 'expired';
  end if;

  if tg_op = 'INSERT' and new.slug is null then
    base := coalesce(nullif(replace(coalesce(
      public.place_nom_normalise(new.title), ''), ' ', '-'), ''), 'offre');
    new.slug := left(base, 60) || '-' || substr(md5(new.id::text), 1, 6);
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

comment on function public.offers_avant_ecriture() is
  'Position, zone, dedup_key, expiration et slug d''une offre. La zone vient du point quand il existe : la zone déclarée d''une source dit où l''on cherche, pas où se trouve ce qu''on a trouvé.';
