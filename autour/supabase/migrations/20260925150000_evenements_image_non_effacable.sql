-- ---------------------------------------------------------------------------
-- UNE AFFICHE TROUVÉE NE DISPARAÎT PAS À LA SYNCHRO SUIVANTE
--
-- LE DÉFAUT, MESURÉ EN PRODUCTION LE 25/09/2026 — ET C'EST LE SMOKE TEST QUI
-- L'A TROUVÉ.
--
-- L'événement NeS à Roubaix existe dans les deux catalogues :
--
--   06:00:56  la synchronisation OpenAgenda fusionne la ligne et lui apporte
--             son affiche (`img.openagenda.com/…`, vérifiée vivante : HTTP 200,
--             image/jpeg, 257 255 octets).
--   09:34:04  la synchronisation DATAtourisme réécrit la MÊME ligne. DATAtourisme
--             ne sert aucune image — 0 sur 1 137 événements à venir — donc elle
--             écrit `image_url: null`. L'affiche disparaît.
--
-- `fusionnerEvenementFaits` protégeait déjà `image_source` et
-- `image_source_url`, mais pas `image_url`. La ligne se retrouvait donc
-- incohérente — une provenance d'affiche, et pas d'affiche — et le cycle
-- recommençait QUATRE FOIS PAR JOUR. Tout le travail sur les images était
-- réversible sans que personne ne voie pourquoi.
--
-- POURQUOI UN DÉCLENCHEUR, ET PAS SEULEMENT LA CORRECTION EN JAVASCRIPT
--
-- La règle de fusion est corrigée dans `shared/evenements-canoniques.mjs` : les
-- huit champs d'image voyagent désormais avec `phone` et `website`, pour la
-- même raison — une source qui ne dit rien ne dit pas « il n'y a rien ». Mais
-- cette règle vit dans le paquet de CHAQUE fonction Edge, et il y en a quatre
-- qui écrivent dans `events`. Une seule oubliée, et l'effacement revient.
--
-- L'invariant appartient donc à la base, où il vaut pour tout écrivain —
-- présent et futur. Le déclencheur ne fait qu'une chose : il refuse de
-- remplacer une image par RIEN. Il n'empêche jamais une mise à jour : une
-- source qui DONNE une image écrase l'ancienne, comme avant.
--
-- CE QU'IL NE FAIT PAS. Il ne fige pas une image morte. Une image qui ne
-- répond plus se retire par la cascade, qui la RELIT — c'est à cela que sert
-- `image_checked_at` — et une suppression explicite reste possible en posant
-- `image_url` à `null` ET `image_source` à `null` dans la même écriture, ce
-- qu'aucune synchronisation ne fait par accident.
-- ---------------------------------------------------------------------------

create or replace function public.events_garder_image()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  /* Rien à protéger : la nouvelle écriture apporte une image. */
  if nullif(btrim(coalesce(new.image_url, '')), '') is not null then
    return new;
  end if;
  /* Rien à protéger : l'ancienne ligne n'en avait pas non plus. */
  if nullif(btrim(coalesce(old.image_url, '')), '') is null then
    return new;
  end if;

  /* UNE SUPPRESSION VOULUE SE DIT EN DEUX MOTS. Poser `image_url` ET
     `image_source` à nul dans la même écriture est un retrait explicite : la
     cascade l'utilise quand une image ne répond plus. Une synchronisation, elle,
     laisse toujours `image_source` renseigné ou l'écrase par le sien — jamais
     les deux à nul en même temps que l'URL. */
  if nullif(btrim(coalesce(new.image_source, '')), '') is null
     and nullif(btrim(coalesce(old.image_source, '')), '') is not null
     and new.image_checked_at is distinct from old.image_checked_at then
    return new;
  end if;

  /* Sinon : l'image et toute sa provenance restent. Les huit champs voyagent
     ensemble — une URL sans sa licence ni son droit d'usage ne serait pas
     affichable, et une provenance sans URL est un mensonge. */
  new.image_url          := old.image_url;
  new.image_source       := coalesce(new.image_source, old.image_source);
  new.image_source_url   := coalesce(new.image_source_url, old.image_source_url);
  new.image_author       := coalesce(new.image_author, old.image_author);
  new.image_license      := coalesce(new.image_license, old.image_license);
  new.image_updated_at   := coalesce(new.image_updated_at, old.image_updated_at);
  new.image_type         := coalesce(new.image_type, old.image_type);
  new.image_confidence   := coalesce(new.image_confidence, old.image_confidence);
  new.image_usage_status := coalesce(new.image_usage_status, old.image_usage_status);
  new.image_checked_at   := coalesce(new.image_checked_at, old.image_checked_at);
  return new;
end;
$function$;

comment on function public.events_garder_image() is
  'Refuse de remplacer une image d''événement par rien. Une source muette ne dit pas « il n''y a rien » : mesuré sur NeS, dont l''affiche OpenAgenda était effacée par la synchronisation DATAtourisme quatre fois par jour.';

drop trigger if exists events_garder_image on public.events;
create trigger events_garder_image
  before update of image_url on public.events
  for each row
  when (old.image_url is not null and new.image_url is null)
  execute function public.events_garder_image();

revoke all on function public.events_garder_image() from public, anon, authenticated;
