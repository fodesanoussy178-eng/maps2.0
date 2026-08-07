-- ---------------------------------------------------------------------------
-- Canaux d'événement — coordination locale, pas messagerie sociale
--
-- Un canal n'existe jamais seul : il naît avec un événement et meurt avec lui.
-- Il n'y a ni conversation entre inconnus, ni boîte de réception globale, ni
-- fil de discussion ouvert. Le créateur annonce, les participants reçoivent.
--
-- Deux garanties sont posées dans la base plutôt que dans le client :
--   · le canal est créé par déclencheur à la publication, donc il existe
--     toujours, même si un client oublie de le demander ;
--   · les messages système sont écrits par déclencheur à la modification,
--     donc un changement d'horaire ne peut pas passer silencieusement.
-- ---------------------------------------------------------------------------

-- Une annulation n'est pas une suppression : l'événement doit rester visible
-- avec sa mention « annulé », sinon les gens se déplacent pour rien.
alter table public.publications
  add column if not exists annule boolean not null default false;

comment on column public.publications.annule is
  'Événement annulé par son créateur. Reste affiché — barré — au lieu de disparaître.';

-- ---------------------------------------------------------------------------
-- 1. Canal : un par événement, créé automatiquement
-- ---------------------------------------------------------------------------
create table if not exists public.event_channels (
  id             uuid primary key default gen_random_uuid(),
  publication_id uuid not null unique
                   references public.publications (id) on delete cascade,
  admin          uuid not null,
  ferme          boolean not null default false,
  cree_le        timestamptz not null default now()
);

comment on table public.event_channels is
  'Canal d''annonces d''un événement. Créé par déclencheur, supprimé avec l''événement.';

create index if not exists event_channels_admin_idx on public.event_channels (admin);

-- ---------------------------------------------------------------------------
-- 2. Participants : qui reçoit les annonces
--    role = admin (le créateur) | participant (inscrit) | suiveur (enregistré)
-- ---------------------------------------------------------------------------
create table if not exists public.event_participants (
  channel_id uuid not null references public.event_channels (id) on delete cascade,
  membre     uuid not null,
  role       text not null default 'participant'
               check (role in ('admin','participant','suiveur')),
  notifier   boolean not null default true,
  lu_jusqua  timestamptz,
  rejoint_le timestamptz not null default now(),
  primary key (channel_id, membre)
);

create index if not exists event_participants_membre_idx on public.event_participants (membre);

-- ---------------------------------------------------------------------------
-- 3. Messages : système (générés) et annonces (écrites par l'admin)
-- ---------------------------------------------------------------------------
create table if not exists public.event_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.event_channels (id) on delete cascade,
  auteur     uuid,                    -- null = message système
  genre      text not null default 'annonce'
               check (genre in ('systeme','annonce')),
  -- ce qui a changé, pour que la page de l'événement puisse le rendre
  -- précisément au lieu de réinterpréter une phrase
  changement text check (changement in ('horaire','lieu','retard','places','annulation')),
  corps      text not null check (length(btrim(corps)) between 1 and 500),
  details    jsonb not null default '{}'::jsonb,
  cree_le    timestamptz not null default now()
);

create index if not exists event_messages_canal_idx
  on public.event_messages (channel_id, cree_le desc);

-- ---------------------------------------------------------------------------
-- 4. Création automatique du canal
-- ---------------------------------------------------------------------------
create or replace function public.creer_canal_evenement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nouveau uuid;
begin
  insert into public.event_channels (publication_id, admin)
  values (new.id, new.auteur)
  on conflict (publication_id) do nothing
  returning id into nouveau;

  -- le créateur est administrateur de son canal, sans action de sa part
  if nouveau is not null then
    insert into public.event_participants (channel_id, membre, role)
    values (nouveau, new.auteur, 'admin')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists publications_creer_canal on public.publications;
create trigger publications_creer_canal
  after insert on public.publications
  for each row execute function public.creer_canal_evenement();

-- ---------------------------------------------------------------------------
-- 5. Messages système à chaque modification importante
--
-- Écrit dans la base, pas dans le client : une modification faite depuis
-- n'importe quel outil produit quand même l'annonce.
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
    heure_avant := to_char(old.debut_le at time zone 'Europe/Paris', 'HH24h MI');
    heure_apres := to_char(new.debut_le at time zone 'Europe/Paris', 'HH24h MI');
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

drop trigger if exists publications_journaliser on public.publications;
create trigger publications_journaliser
  after update on public.publications
  for each row execute function public.journaliser_modification_evenement();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--
-- Les événements d'Autour sont publics : leurs annonces le sont aussi. Ce qui
-- est verrouillé, c'est l'écriture — seul l'administrateur du canal annonce.
-- ---------------------------------------------------------------------------
alter table public.event_channels     enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_messages     enable row level security;

drop policy if exists "canaux: lecture publique" on public.event_channels;
create policy "canaux: lecture publique"
  on public.event_channels for select to anon, authenticated using (true);

-- personne ne crée un canal à la main : le déclencheur s'en charge
-- (aucune policy INSERT/UPDATE/DELETE)

drop policy if exists "participants: chacun voit sa participation" on public.event_participants;
create policy "participants: chacun voit sa participation"
  on public.event_participants for select to authenticated
  using (membre = auth.uid()
         or exists (select 1 from public.event_channels c
                     where c.id = channel_id and c.admin = auth.uid()));

drop policy if exists "participants: rejoindre en son nom" on public.event_participants;
create policy "participants: rejoindre en son nom"
  on public.event_participants for insert to authenticated
  with check (membre = auth.uid() and role in ('participant','suiveur'));

drop policy if exists "participants: régler ses notifications" on public.event_participants;
create policy "participants: régler ses notifications"
  on public.event_participants for update to authenticated
  using (membre = auth.uid()) with check (membre = auth.uid());

drop policy if exists "participants: quitter" on public.event_participants;
create policy "participants: quitter"
  on public.event_participants for delete to authenticated
  using (membre = auth.uid() and role <> 'admin');

drop policy if exists "messages: lecture publique" on public.event_messages;
create policy "messages: lecture publique"
  on public.event_messages for select to anon, authenticated using (true);

-- seul l'administrateur annonce, et jamais sous le genre « systeme » :
-- un message système ne peut venir que d'un déclencheur
drop policy if exists "messages: seul l’admin annonce" on public.event_messages;
create policy "messages: seul l’admin annonce"
  on public.event_messages for insert to authenticated
  with check (
    genre = 'annonce'
    and auteur = auth.uid()
    and exists (select 1 from public.event_channels c
                 where c.id = channel_id and c.admin = auth.uid() and not c.ferme)
  );

grant select on public.event_channels, public.event_messages to anon, authenticated;
grant select, insert, update, delete on public.event_participants to authenticated;
grant insert on public.event_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 7. « Ai-je une raison de voir la section Messages ? »
--
-- Une seule requête, pour que le client n'ait pas à en composer trois et à
-- décider lui-même de la règle.
-- ---------------------------------------------------------------------------
create or replace function public.mes_canaux()
returns table (
  channel_id     uuid,
  publication_id uuid,
  titre          text,
  role           text,
  annule         boolean,
  dernier_message text,
  dernier_le     timestamptz,
  non_lus        integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, p.id, p.titre, ep.role, p.annule,
         m.corps, m.cree_le,
         (select count(*)::int from public.event_messages x
           where x.channel_id = c.id
             and (ep.lu_jusqua is null or x.cree_le > ep.lu_jusqua))
  from public.event_participants ep
  join public.event_channels c on c.id = ep.channel_id
  join public.publications p on p.id = c.publication_id
  left join lateral (
    select corps, cree_le from public.event_messages m2
     where m2.channel_id = c.id order by m2.cree_le desc limit 1
  ) m on true
  where ep.membre = auth.uid()
  order by coalesce(m.cree_le, c.cree_le) desc;
$$;

revoke all on function public.mes_canaux() from public;
grant execute on function public.mes_canaux() to authenticated;
