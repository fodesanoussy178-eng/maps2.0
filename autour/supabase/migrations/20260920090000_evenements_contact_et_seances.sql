-- CE QUE LA FICHE PROMETTAIT ET QUE LA BASE NE PORTAIT PAS.
--
-- La fiche événement affiche « Site web », « Appeler », « Réservation ». Les
-- trois lisaient des champs de LIEU (`l.url`, `l.tel`) qui n'existent jamais
-- sur un événement : les boutons étaient donc grisés en permanence, quelle que
-- soit la richesse de la fiche OpenAgenda.
--
-- Or OpenAgenda publie `registration[]` — une liste typée link / phone / email —
-- et `conditions`, la phrase de tarif. Rien de tout cela n'était lu.
--
-- QUATRE COLONNES, ET PAS UNE DE PLUS. `booking_url` (où réserver),
-- `phone`, `email`, `website`. `ticket_url` existait déjà et reste ce qu'il
-- est : l'URL d'une billetterie marchande. `booking_url` est plus large — une
-- inscription gratuite en est une aussi.

alter table public.events
  add column if not exists booking_url text,
  add column if not exists phone       text,
  add column if not exists email       text,
  add column if not exists website     text;

-- LE TÉLÉPHONE EST NORMALISÉ, ET LA BASE LE VÉRIFIE.
-- `tel:` n'accepte pas « 03 20 00 00 00 » de façon fiable selon les systèmes.
-- On stocke donc de l'E.164, et la contrainte empêche qu'une source bavarde
-- réintroduise un format local par une autre porte.
alter table public.events drop constraint if exists events_phone_e164;
alter table public.events add constraint events_phone_e164
  check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');

comment on column public.events.booking_url is
  'Où s''inscrire ou réserver. Vient de registration[] type=link chez OpenAgenda, ou extrait de la description en dernier recours.';
comment on column public.events.phone is
  'Téléphone de réservation, en E.164. Contraint par CHECK : « tel: » ne supporte pas un format local de façon fiable.';
comment on column public.events.website is
  'Site déclaré par l''organisateur, ou lien repêché dans la description. N''est PAS une billetterie : un lien de réservation va dans booking_url.';

-- ---------------------------------------------------------------------------
-- LES SÉANCES — elles étaient déjà là, personne ne pouvait les lire.
--
-- `event_occurrences` porte une ligne par horaire depuis le début : 1 066
-- événements en ont plusieurs. La fiche affichait pourtant une plage
-- « début – fin » qui, pour une exposition de trois mois, ne dit rien
-- d'utilisable.
--
-- La table est sous RLS sans aucune policy, et n'accorde rien à `anon` : c'est
-- volontaire, elle porte `raw_data`. On n'ouvre donc pas la table, on ouvre UNE
-- question : « quelles sont les prochaines séances de cet événement ». La
-- fonction ne rend ni la charge brute, ni les séances passées, ni les annulées.
--
-- ET ELLE DÉDUPLIQUE, PARCE QUE LA PREMIÈRE VERSION NE LE FAISAIT PAS.
-- `event_occurrences` porte une ligne par occurrence SOURCE : un événement vu
-- par deux agendas rendait trois fois le même samedi. Mesuré au premier essai.
-- Une liste qui répète le même créneau est pire qu'une plage : elle a l'air
-- précise. On déduplique sur le couple (début, fin), qui est ce qui se lit.
-- ---------------------------------------------------------------------------
create or replace function public.evenement_seances(
  p_event_id uuid,
  p_limite   integer default 40
)
returns table (start_at timestamptz, end_at timestamptz, timezone text)
language sql
stable
security definer
set search_path to ''
as $$
  select s.start_at, s.end_at, s.timezone
  from (
    select distinct on (o.start_at, o.end_at)
           o.start_at, o.end_at, o.timezone
    from public.event_occurrences o
    where o.event_id = p_event_id
      and coalesce(o.cancelled, false) = false
      and o.start_at is not null
      /* Une séance passée n'aide personne à décider d'y aller. La tolérance
         d'une heure garde visible celle qui vient de commencer. */
      and o.start_at > now() - interval '1 hour'
    order by o.start_at, o.end_at, o.timezone nulls last
  ) s
  order by s.start_at
  limit greatest(1, least(coalesce(p_limite, 40), 200));
$$;

comment on function public.evenement_seances(uuid, integer) is
  'Les prochaines séances d''un événement, dédupliquées sur (début, fin). Ouvre une question, pas la table : ni raw_data, ni séances passées, ni annulées.';

revoke all on function public.evenement_seances(uuid, integer) from public;
grant execute on function public.evenement_seances(uuid, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- UNE ADRESSE E-MAIL DANS LE SCHÉMA PUBLIC — ET POURQUOI CELLE-CI EST ADMISE
--
-- `20260814124936_comptes_email.sql` pose une règle et la fait respecter par
-- une garde : AUCUNE colonne du schéma public ne doit porter une adresse.
-- Cette règle protège les adresses des HABITANTS — elles vivent dans
-- `auth.users`, et rien ne doit les recopier là où PostgREST les servirait.
--
-- `events.email` n'est pas de cette nature. C'est l'adresse qu'un organisateur
-- a lui-même publiée sur son agenda public, pour être joint au sujet de son
-- événement. Elle est déjà publique à la source, et la cacher ne protégerait
-- personne — elle empêcherait seulement d'écrire à la maison de quartier.
--
-- La distinction est réelle, mais elle doit être ÉCRITE, pas sous-entendue :
-- sans quoi la prochaine colonne `email` passera au même endroit sans que
-- personne n'ait à se justifier. La garde est donc rejouée ici, avec une seule
-- exception nommée. Toute autre colonne fera encore échouer la migration.
-- ---------------------------------------------------------------------------
comment on column public.events.email is
  'Adresse de contact publiée par l''organisateur sur son agenda public. Jamais une adresse d''habitant : celles-là ne quittent pas auth.users (voir 20260814124936_comptes_email.sql).';

do $$
declare
  fautif text;
begin
  select string_agg(c.relname || '.' || a.attname, ', ')
    into fautif
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'v', 'm', 'p')
     and a.attnum > 0
     and not a.attisdropped
     and a.attname ~* '(^|_)(e?mail|courriel)($|_)'
     -- La seule exception, et elle est justifiée seize lignes plus haut.
     and (c.relname, a.attname) <> ('events', 'email');

  if fautif is not null then
    raise exception 'Une adresse e-mail est exposée dans le schéma public : %', fautif;
  end if;
end
$$;
