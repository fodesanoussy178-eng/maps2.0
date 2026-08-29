-- Inventaire des agendas OpenAgenda de la métropole.
--
-- Le connecteur ne sait synchroniser que des agendas déjà inscrits dans
-- `territory_sources`, et il n'en existait que trois : Lille, Roubaix,
-- Tourcoing. Quatre-vingt-douze communes n'avaient aucune source.
--
-- Pour en ajouter, il faut l'IDENTIFIANT NUMÉRIQUE de chaque agenda, que le
-- connecteur exige (`^\d+$`). On ne l'invente pas : on le lit sur la page
-- publique de l'agenda, `https://openagenda.com/fr/<slug>`, où il figure dans
-- un bloc JSON échappé sous la forme \"uid\":<nombre>.
--
-- L'appel part de la base, par `pg_net` — le même mécanisme qui déclenche
-- déjà les synchronisations. Aucune clé d'API n'est nécessaire : ces pages
-- sont publiques.
--
-- La table garde la trace de chaque tentative, y compris les échecs : un slug
-- qui ne répond pas est une information (l'agenda n'existe pas sous ce nom),
-- pas un trou.

create table if not exists public.openagenda_candidats (
  slug          text primary key,
  commune       text,
  requete_id    bigint,
  statut_http   integer,
  agenda_uid    text,
  titre         text,
  verifie_le    timestamptz,
  cree_le       timestamptz not null default now()
);

comment on table public.openagenda_candidats is
  'Inventaire des agendas OpenAgenda candidats pour la MEL : slug testé, code HTTP, identifiant numérique lu sur la page publique. Sert à alimenter territory_sources sans inventer d''identifiant.';

create or replace function public.openagenda_sonder(p_slugs text[])
returns integer
language plpgsql
set search_path to 'public', 'net'
as $$
declare
  s text;
  n integer := 0;
begin
  foreach s in array p_slugs loop
    insert into public.openagenda_candidats (slug, requete_id)
    values (s, net.http_get('https://openagenda.com/fr/' || s))
    on conflict (slug) do update set requete_id = excluded.requete_id, verifie_le = null;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.openagenda_recolter()
returns integer
language plpgsql
set search_path to 'public', 'net'
as $$
declare
  n integer := 0;
begin
  update public.openagenda_candidats c
     set statut_http = r.status_code,
         agenda_uid  = case when r.status_code = 200
                        then substring(r.content from '\\"uid\\":(\d{5,10})') end,
         titre       = case when r.status_code = 200
                        then substring(r.content from '<title>([^<]{0,120})') end,
         verifie_le  = now()
    from net._http_response r
   where r.id = c.requete_id and c.verifie_le is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.openagenda_sonder(text[]) is
  'Demande la page publique de chaque slug OpenAgenda. À appeler puis, quelques secondes plus tard, openagenda_recolter().';
comment on function public.openagenda_recolter() is
  'Lit les réponses arrivées et en extrait l''identifiant numérique de l''agenda et son titre.';
