-- ===========================================================================
-- CRÉER V1 : CE QUI MANQUAIT À LA BOUCLE CRÉER → PARTAGER → PARTICIPER
--
-- Tout ici est ADDITIF. Aucune donnée n'est réécrite, aucune table supprimée,
-- aucun contrat existant retiré : `publications_locales` garde ses colonnes et
-- en gagne deux.
--
--   1. une publication peut dire ce qu'elle est (description, « à prévoir ») ;
--   2. « 3 / 10 participants » devient un nombre public et fiable, sans rendre
--      publique la liste des participants ;
--   3. la capacité est tenue EN BASE : une onzième participation à un
--      événement de dix places est refusée, même par un client modifié ;
--   4. un membre ne peut plus changer son propre rôle (la règle UPDATE « régler
--      ses notifications » laissait écrire la colonne `role`) ;
--   5. « Signaler » enregistre enfin quelque chose : une voix par compte, et la
--      publication disparaît des lectures publiques à trois signalements.
-- ===========================================================================

-- ---- 1. Ce qu'une publication dit d'elle-même ------------------------------
alter table public.publications
  add column if not exists description text,
  add column if not exists a_prevoir text;

alter table public.publications
  drop constraint if exists publications_description_check,
  add constraint publications_description_check
    check (description is null or char_length(description) <= 500),
  drop constraint if exists publications_a_prevoir_check,
  add constraint publications_a_prevoir_check
    check (a_prevoir is null or char_length(a_prevoir) <= 200);

-- La projection canonique recopie désormais la description et l'affiche : un
-- événement d'habitant lu ailleurs (ChatGPT, e-mail) n'est plus une coquille.
create or replace function public.projeter_publication_en_evenement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.events (
    publication_id, title, description, category,
    start_at, end_at, date_confidence,
    address, city, lat, lng,
    primary_source, image_url, cancelled,
    last_source_update, last_synced_at
  )
  values (
    new.id, new.titre, new.description, new.cat,
    new.debut_le, new.fin_le,
    case when new.debut_le is not null and new.fin_le is not null then 'exact'
         when new.debut_le is not null then 'day'
         else 'unknown' end,
    new.adresse, new.cp, new.lat, new.lng,
    'autour', new.image_url, (new.status = 'cancelled' or new.annule),
    new.cree_le, now()
  )
  on conflict (publication_id) do update set
    title              = excluded.title,
    description        = excluded.description,
    category           = excluded.category,
    start_at           = excluded.start_at,
    end_at             = excluded.end_at,
    date_confidence    = excluded.date_confidence,
    address            = excluded.address,
    city               = excluded.city,
    lat                = excluded.lat,
    lng                = excluded.lng,
    image_url          = excluded.image_url,
    cancelled          = excluded.cancelled,
    last_source_update = excluded.last_source_update,
    last_synced_at     = now();
  return new;
exception
  when others then
    raise warning 'projection publication % impossible : %', new.id, sqlerrm;
    return new;
end;
$function$;

-- « N places restantes » était faux dès la création : `places` est la
-- capacité, les inscrits se comptent à part.
create or replace function public.journaliser_modification_evenement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    return new;
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
            'Places : ' || new.places || ' au total.',
            jsonb_build_object('avant', old.places, 'apres', new.places));
  end if;

  return new;
end;
$function$;

-- ---- 5. Le signalement (avant les lectures, qui en dépendent) ---------------
create table if not exists public.publication_signalements (
  publication_id uuid not null references public.publications(id) on delete cascade,
  membre uuid not null references auth.users(id) on delete cascade,
  motif text check (motif is null or char_length(motif) <= 200),
  cree_le timestamptz not null default now(),
  primary key (publication_id, membre)
);
-- Personne ne lit ni n'écrit cette table directement : seule la fonction
-- ci-dessous y entre, et le service l'inspecte.
alter table public.publication_signalements enable row level security;
revoke all on public.publication_signalements from anon, authenticated;

-- LE SEUIL : TROIS SIGNALEMENTS DISTINCTS. Il est écrit en toutes lettres
-- (`signalements < 3`) dans chaque lecture plutôt que dans une fonction du
-- schéma `private` : les lectures publiques ne sont pas SECURITY DEFINER et
-- n'ont pas accès à ce schéma — la répétition de cette migration l'a montré.

create or replace function public.signaler_publication(p_publication uuid, p_motif text default null)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  moi uuid := (select auth.uid());
  inseres integer;
begin
  if moi is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  -- on ne se signale pas soi-même : la suppression existe pour ça
  if exists (select 1 from public.publications where id = p_publication and created_by = moi) then
    return false;
  end if;
  insert into public.publication_signalements (publication_id, membre, motif)
  values (p_publication, moi, left(nullif(btrim(coalesce(p_motif, '')), ''), 200))
  on conflict do nothing;
  get diagnostics inseres = row_count;
  if inseres = 1 then
    update public.publications set signalements = signalements + 1 where id = p_publication;
  end if;
  return true;
end;
$function$;
revoke all on function public.signaler_publication(uuid, text) from public, anon;
grant execute on function public.signaler_publication(uuid, text) to authenticated;

-- ---- Les lectures publiques : description, et plus rien de masqué ----------
drop function if exists public.publications_locales(text, double precision, double precision,
  double precision, double precision, integer);
create function public.publications_locales(p_zone_id text, p_sud double precision,
  p_ouest double precision, p_nord double precision, p_est double precision,
  p_limite integer default 120)
 returns table(id uuid, creator_id uuid, created_by uuid, creator_name text, cat text,
   titre text, adresse text, cp text, quand text, gratuit boolean, prix integer,
   places integer, lat double precision, lng double precision,
   debut_le timestamp with time zone, fin_le timestamp with time zone, verifie boolean,
   image_url text, status text, annule boolean, zone_id text,
   cree_le timestamp with time zone, description text, a_prevoir text)
 language sql
 stable
 set search_path to 'public'
as $function$
  select p.id, p.creator_id, p.created_by, p.creator_name,
    p.cat, p.titre, p.adresse, p.cp, p.quand, p.gratuit, p.prix,
    p.places, p.lat, p.lng, p.debut_le, p.fin_le, p.verifie,
    p.image_url, p.status, p.annule, p.zone_id, p.cree_le,
    p.description, p.a_prevoir
    from public.publications p
   where p.zone_id = p_zone_id
     and p.lat between p_sud and p_nord
     and p.lng between p_ouest and p_est
     and (p.fin_le is null or p.fin_le > now())
     and p.signalements < 3
   order by p.cree_le desc
   limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;
grant execute on function public.publications_locales(text, double precision, double precision,
  double precision, double precision, integer) to anon, authenticated, service_role;

-- UNE publication, par son identifiant : c'est ce que lit un lien partagé,
-- d'où qu'il soit ouvert. Mêmes colonnes que la lecture locale.
create or replace function public.publication_publique(p_id uuid)
 returns table(id uuid, creator_id uuid, created_by uuid, creator_name text, cat text,
   titre text, adresse text, cp text, quand text, gratuit boolean, prix integer,
   places integer, lat double precision, lng double precision,
   debut_le timestamp with time zone, fin_le timestamp with time zone, verifie boolean,
   image_url text, status text, annule boolean, zone_id text,
   cree_le timestamp with time zone, description text, a_prevoir text)
 language sql
 stable
 set search_path to 'public'
as $function$
  select p.id, p.creator_id, p.created_by, p.creator_name,
    p.cat, p.titre, p.adresse, p.cp, p.quand, p.gratuit, p.prix,
    p.places, p.lat, p.lng, p.debut_le, p.fin_le, p.verifie,
    p.image_url, p.status, p.annule, p.zone_id, p.cree_le,
    p.description, p.a_prevoir
    from public.publications p
   where p.id = p_id
     and p.signalements < 3;
$function$;
grant execute on function public.publication_publique(uuid) to anon, authenticated, service_role;

-- Mes créations : les miennes, masquées comprises, avec leurs inscrits.
drop function if exists public.mes_publications();
create function public.mes_publications()
 returns table(id uuid, cat text, titre text, adresse text, cp text, quand text,
   gratuit boolean, prix integer, places integer, lat double precision, lng double precision,
   debut_le timestamp with time zone, fin_le timestamp with time zone, verifie boolean,
   image_url text, status text, annule boolean, creator_id uuid, created_by uuid,
   creator_name text, cree_le timestamp with time zone, description text, a_prevoir text,
   participants integer, masquee boolean)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select p.id, p.cat, p.titre, p.adresse, p.cp,
         p.quand, p.gratuit, p.prix, p.places, p.lat, p.lng,
         p.debut_le, p.fin_le, p.verifie, p.image_url, p.status, p.annule,
         p.creator_id, p.created_by, p.creator_name, p.cree_le,
         p.description, p.a_prevoir,
         (select count(*)::int from public.event_participants ep
            join public.event_channels c on c.id = ep.channel_id
           where c.publication_id = p.id and ep.role = 'participant'),
         p.signalements >= 3
    from public.publications p
   where p.created_by = (select auth.uid())
   order by p.cree_le desc
   limit 200;
$function$;
revoke all on function public.mes_publications() from public, anon;
grant execute on function public.mes_publications() to authenticated, service_role;

-- ---- 2. Le nombre de participants, public ; la liste, non -------------------
create or replace function public.participation_publications(p_ids uuid[])
 returns table(publication_id uuid, participants integer, places integer,
               moi boolean, organisateur boolean)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select p.id,
         (select count(*)::int from public.event_participants ep
           where ep.channel_id = c.id and ep.role = 'participant'),
         p.places,
         exists (select 1 from public.event_participants ep
                  where ep.channel_id = c.id and ep.role = 'participant'
                    and ep.membre = (select auth.uid())),
         coalesce(p.created_by = (select auth.uid()), false)
    from public.publications p
    left join public.event_channels c on c.publication_id = p.id
   where p.id = any (p_ids[1:200])
     and p.signalements < 3;
$function$;
grant execute on function public.participation_publications(uuid[]) to anon, authenticated, service_role;

-- ---- 3. La capacité, tenue en base -----------------------------------------
create or replace function private.controler_participation()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  pub public.publications%rowtype;
  inscrits integer;
begin
  if new.role <> 'participant' then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'participant' then return new; end if;

  -- le verrou sur la publication sérialise deux inscriptions simultanées :
  -- la onzième attend la dixième, puis la compte
  select p.* into pub
    from public.publications p
    join public.event_channels c on c.publication_id = p.id
   where c.id = new.channel_id
   for update of p;
  if not found then return new; end if;

  if pub.status = 'cancelled' or pub.annule then
    raise exception 'publication annulée' using errcode = 'P0001', hint = 'annulee';
  end if;
  if coalesce(pub.fin_le, pub.debut_le + interval '12 hours') < now() then
    raise exception 'publication terminée' using errcode = 'P0001', hint = 'terminee';
  end if;
  if pub.signalements >= 3 then
    raise exception 'publication indisponible' using errcode = 'P0001', hint = 'masquee';
  end if;
  if pub.places is not null then
    select count(*)::int into inscrits
      from public.event_participants
     where channel_id = new.channel_id and role = 'participant';
    if inscrits >= pub.places then
      raise exception 'complet' using errcode = 'P0001', hint = 'complet';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists event_participants_controler on public.event_participants;
create trigger event_participants_controler
  before insert or update of role on public.event_participants
  for each row execute function private.controler_participation();

-- ---- 4. Personne ne change son propre rôle ---------------------------------
revoke update on public.event_participants from authenticated;
grant update (notifier, lu_jusqua) on public.event_participants to authenticated;

-- Participer / ne plus participer : un seul chemin, qui rend l'état à jour.
-- Un compte confirmé est demandé, comme pour publier ou garder un favori.
create or replace function public.participer_publication(p_publication uuid)
 returns table(publication_id uuid, participants integer, places integer,
               moi boolean, organisateur boolean)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  canal uuid;
begin
  if (select auth.uid()) is null or not private.compte_confirme() then
    raise exception 'compte requis' using errcode = '42501';
  end if;
  select c.id into canal from public.event_channels c where c.publication_id = p_publication;
  if canal is null then
    raise exception 'publication introuvable' using errcode = 'P0002';
  end if;
  -- déjà inscrit : rien ne change ; simple « suiveur » : il devient participant
  insert into public.event_participants (channel_id, membre, role)
  values (canal, (select auth.uid()), 'participant')
  on conflict (channel_id, membre) do update set role = 'participant'
   where public.event_participants.role = 'suiveur';
  return query select * from public.participation_publications(array[p_publication]);
end;
$function$;
revoke all on function public.participer_publication(uuid) from public, anon;
grant execute on function public.participer_publication(uuid) to authenticated;

create or replace function public.ne_plus_participer_publication(p_publication uuid)
 returns table(publication_id uuid, participants integer, places integer,
               moi boolean, organisateur boolean)
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  delete from public.event_participants ep
   using public.event_channels c
   where c.id = ep.channel_id
     and c.publication_id = p_publication
     and ep.membre = (select auth.uid())
     and ep.role = 'participant';
  return query select * from public.participation_publications(array[p_publication]);
end;
$function$;
revoke all on function public.ne_plus_participer_publication(uuid) from public, anon;
grant execute on function public.ne_plus_participer_publication(uuid) to authenticated;
