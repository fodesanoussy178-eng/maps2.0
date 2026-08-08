-- ---------------------------------------------------------------------------
-- Format d'heure des messages système
--
-- `to_char(..., 'HH24h MI')` produisait « Horaire modifié : 07h 00 » : l'espace
-- du masque est littérale, et `h` n'est pas un motif to_char. On l'échappe
-- proprement en `HH24"h"MI`, qui donne « 07h00 ».
--
-- Seule la ligne de format change ; le reste de la fonction est identique à
-- 20260807140000_canaux_evenements.sql.
-- ---------------------------------------------------------------------------

create or replace function public.journaliser_modification_evenement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canal uuid;
  heure_avant text;
  heure_apres text;
begin
  select id into canal from public.event_channels where publication_id = new.id;
  if canal is null then return new; end if;

  if new.annule and not old.annule then
    insert into public.event_messages (channel_id, genre, changement, corps)
    values (canal, 'systeme', 'annulation', 'Événement annulé.');
    return new;   -- une annulation rend les autres changements sans objet
  end if;

  if new.debut_le is distinct from old.debut_le and new.debut_le is not null then
    heure_avant := to_char(old.debut_le at time zone 'Europe/Paris', 'HH24"h"MI');
    heure_apres := to_char(new.debut_le at time zone 'Europe/Paris', 'HH24"h"MI');
    insert into public.event_messages (channel_id, genre, changement, corps, details)
    values (canal, 'systeme', 'horaire',
            case when old.debut_le is null
                 then 'Horaire annoncé : ' || heure_apres || '.'
                 else 'Horaire modifié : ' || heure_apres || ' au lieu de ' || heure_avant || '.' end,
            jsonb_build_object('avant', old.debut_le, 'apres', new.debut_le));
  end if;

  if new.adresse is distinct from old.adresse and new.adresse is not null then
    insert into public.event_messages (channel_id, genre, changement, corps, details)
    values (canal, 'systeme', 'lieu',
            'Nouveau lieu : ' || new.adresse || '.',
            jsonb_build_object('avant', old.adresse, 'apres', new.adresse,
                               'lat', new.lat, 'lng', new.lng));
  end if;

  if new.places is distinct from old.places and new.places is not null then
    insert into public.event_messages (channel_id, genre, changement, corps, details)
    values (canal, 'systeme', 'places',
            new.places || ' place' || case when new.places > 1 then 's' else '' end || ' restante'
              || case when new.places > 1 then 's' else '' end || '.',
            jsonb_build_object('avant', old.places, 'apres', new.places));
  end if;

  return new;
end;
$$;

-- `create or replace` réattribue EXECUTE à public : on le retire à nouveau,
-- comme dans 20260808120000_privileges_moindre_portee.sql.
revoke all on function public.journaliser_modification_evenement() from public, anon, authenticated;
