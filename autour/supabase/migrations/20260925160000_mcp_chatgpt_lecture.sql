/* ===========================================================================
   CE QU'IL FAUT EN BASE POUR SERVIR CHATGPT — ET RIEN DE PLUS

   L'intégration MCP est en lecture seule. Elle a pourtant besoin de deux
   choses que la base ne rendait pas encore :

     1. UNE LIMITE D'APPELS. Un serveur MCP public sans plafond est une
        invitation : chaque outil déclenche des lectures et des mesures. Le
        plafond doit être PARTAGÉ — une fonction serveur vit en plusieurs
        exemplaires (un par région, un par instance), et un compteur en mémoire
        ne plafonne donc qu'un exemplaire. C'est la base qui compte.

     2. LE VERDICT DE COUVERTURE. `local_coverage` porte ce qu'Autour sait de
        sa propre ignorance — « incomplete », « unknown », « adequate ». Cette
        table n'est PAS lisible par `anon`, et c'est volontaire : elle porte
        aussi des compteurs d'exploitation (échecs de source, prochaine
        vérification, demande de découverte). On expose donc le verdict, pas la
        table : quatre colonnes utiles, rien d'interne.

   CE QUE CES DEUX OBJETS NE FONT PAS : aucune écriture de contenu, aucune
   donnée personnelle, aucun identifiant d'utilisateur. La clé du quota est une
   EMPREINTE (sha-256 tronquée) calculée par le serveur ; la base ne reçoit
   jamais ni jeton, ni adresse IP.
   ======================================================================== */

create table if not exists public.mcp_quotas (
  cle text not null,
  fenetre timestamptz not null,
  appels integer not null default 0,
  primary key (cle, fenetre)
);

/* Personne ne lit ni n'écrit cette table en direct : ni `anon`, ni
   `authenticated`. Seule la fonction ci-dessous y touche, en `security
   definer`. Un compteur de quota lisible serait un inventaire des clients. */
alter table public.mcp_quotas enable row level security;
revoke all on table public.mcp_quotas from anon, authenticated;

comment on table public.mcp_quotas is
  'Compteur de fenêtre glissante pour le serveur MCP (ChatGPT). La clé est une empreinte, jamais un jeton ni une IP.';

create or replace function public.mcp_quota(
  p_cle text,
  p_max integer default 60,
  p_fenetre_s integer default 60
) returns table(autorise boolean, restant integer, fenetre_fin timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_max integer := greatest(1, least(coalesce(p_max, 60), 600));
  v_fenetre_s integer := greatest(1, least(coalesce(p_fenetre_s, 60), 3600));
  v_fenetre timestamptz;
  v_appels integer;
begin
  /* Une clé vide n'est pas « pas de limite » : c'est un appel qu'on ne peut
     pas compter, donc qu'on refuse. */
  if p_cle is null or btrim(p_cle) = '' then
    return query select false, 0, clock_timestamp();
    return;
  end if;

  v_fenetre := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_fenetre_s) * v_fenetre_s);

  /* Le ménage coûte un balayage ; le faire à chaque appel le paierait au prix
     du temps de réponse de ChatGPT. Une fois sur cent suffit à ce que la table
     ne dépasse jamais l'heure écoulée. */
  if random() < 0.01 then
    delete from public.mcp_quotas q where q.fenetre < clock_timestamp() - interval '1 hour';
  end if;

  insert into public.mcp_quotas as q (cle, fenetre, appels)
  values (left(btrim(p_cle), 64), v_fenetre, 1)
  on conflict (cle, fenetre) do update set appels = q.appels + 1
  returning q.appels into v_appels;

  return query select v_appels <= v_max, greatest(0, v_max - v_appels),
    v_fenetre + make_interval(secs => v_fenetre_s);
end
$$;

grant execute on function public.mcp_quota(text, integer, integer) to anon, authenticated;

comment on function public.mcp_quota(text, integer, integer) is
  'Plafond d''appels partagé du serveur MCP. Rend autorise/restant ; n''expose aucun compteur.';

create or replace function public.local_coverage_publique(
  p_territoire text,
  p_categorie text default null
) returns table(
  territory text, universe text, category text,
  coverage_status text, coverage_score numeric,
  known_count integer, verified_count integer, last_checked_at timestamptz
)
language sql
security definer
set search_path to ''
stable
as $$
  select c.territory, c.universe, c.category, c.coverage_status, c.coverage_score,
         c.known_count, c.verified_count, c.last_checked_at
  from public.local_coverage c
  where public.place_nom_normalise(c.territory) = public.place_nom_normalise(p_territoire)
    and (p_categorie is null or c.category = p_categorie)
  order by c.last_checked_at desc nulls last
  limit 12
$$;

grant execute on function public.local_coverage_publique(text, text) to anon, authenticated;

comment on function public.local_coverage_publique(text, text) is
  'Verdict public de couverture d''un territoire : ce qu''Autour sait de sa propre ignorance. Sans compteurs internes.';
