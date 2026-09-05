-- ---------------------------------------------------------------------------
-- `evenements_contexte()` : rendre le contexte territorial visible au visiteur
-- sans ouvrir `event_sources`
--
-- LE DÉFAUT
--
-- La fonction est SECURITY INVOKER. Elle vérifie le rattachement éditorial
-- d'un événement par un `exists` sur `public.event_sources`, table volontairement
-- privée : `20260813212645_evenements_canoniques.sql` lui retire tout droit
-- pour `anon` et `authenticated`, et sa RLS est active sans aucune policy.
-- Appelée depuis le navigateur, la fonction ne rendait donc pas un résultat
-- partiel : elle levait `42501 permission denied for table event_sources`.
-- Le contexte territorial — bandeau Braderie, `major_event_nom`, fiches
-- associées — n'a jamais pu s'afficher pour un visiteur.
--
-- `20260902113000_braderie_context_event_sources.sql` avait bien ouvert
-- `territorial_context_event_sources` à la lecture publique, mais pas
-- `event_sources`, que la même requête traverse.
--
-- LE CORRECTIF, ET POURQUOI CELUI-LÀ
--
-- On ne donne aucun droit sur `event_sources` : elle porte la provenance brute
-- de tous les événements, bien au-delà du besoin de cet écran. On passe la
-- fonction en SECURITY DEFINER. Elle est propriété de `postgres`, donc elle
-- lit les tables internes, mais elle ne rend au client que les colonnes déjà
-- présentes dans sa signature — `event_sources` n'y sert QUE de test
-- d'existence, aucune de ses colonnes n'est projetée.
--
-- CE QUE SECURITY DEFINER CESSE D'APPLIQUER, ET COMMENT ON LE COMPENSE
--
-- En INVOKER, la RLS filtrait au passage les tables traversées. En DEFINER
-- elle ne s'applique plus : il faut donc que le `where` de la fonction porte
-- lui-même ce que les policies portaient, faute de quoi la fonction montrerait
-- plus que ce que l'écran montre aujourd'hui. Relevé policy par policy :
--
--   territorial_contexts   `active and now() >= coalesce(preview_starts_at,
--                          starts_at) and now() < ends_at`
--                          → déjà écrit mot pour mot dans le CTE `contexte`.
--   territories            `active and status = 'active'`
--                          → présent dans le `lateral` du bassin, MAIS ABSENT
--                            du `join territories` du CTE `contexte`. C'est le
--                            seul écart réel. La ligne est ajoutée ci-dessous :
--                            sans elle, un contexte rattaché à un territoire
--                            désactivé deviendrait visible, ce que la RLS
--                            interdisait. Aujourd'hui sans effet — le
--                            territoire `lille` est actif — mais c'est
--                            l'invariant qu'on préserve, pas l'état du jour.
--   territorial_context_   `exists(... where c.id = context_id and c.active)`
--     event_sources        → le `where r.context_id = c.id` porte sur un `c`
--                            déjà filtré actif ET dans sa fenêtre : strictement
--                            plus restrictif.
--   events                 policy `using (true)` → rien à compenser.
--   evenements_majeurs     policy `using (true)` → rien à compenser.
--
-- Aucune règle Braderie, aucun seuil, aucun tri, aucune donnée n'est touché :
-- la seule ligne de logique ajoutée réinscrit un filtre que la RLS appliquait
-- déjà.
--
-- SURFACE D'ÉLÉVATION DE PRIVILÈGE
--
--   · `language sql`, donc aucun `execute` possible : pas de SQL dynamique,
--     ni ici ni par construction.
--   · `set search_path to ''` conservé : aucun objet ne peut être détourné par
--     un schéma placé en tête par l'appelant.
--   · tous les objets sont qualifiés — `public.*` pour les nôtres,
--     `pg_catalog.*` pour les fonctions natives.
--   · les deux arguments ne servent que de valeurs comparées (`c.slug =
--     p_context`) et de borne (`p_limite`), jamais de nom d'objet.
--   · `public.event_soon_window()` était déjà SECURITY DEFINER : inchangée.
-- ---------------------------------------------------------------------------

create or replace function public.evenements_contexte(p_context text, p_limite integer default 120)
returns table(
  id uuid, publication_id uuid, title text, description text, category text,
  start_at timestamp with time zone, end_at timestamp with time zone, timezone text,
  temporal_status text, date_confidence text, place_name text, address text,
  city text, insee_code text, lat double precision, lng double precision,
  primary_source text, source_url text, image_url text, image_source text,
  image_source_url text, image_author text, image_license text,
  image_updated_at timestamp with time zone, cancelled boolean,
  last_source_update timestamp with time zone, last_synced_at timestamp with time zone,
  announced_at timestamp with time zone, presale_at timestamp with time zone,
  tickets_open_at timestamp with time zone, announcement_tags text[],
  importance_level text, importance_score integer, performers text[],
  organizer text, ticket_url text, announcement_provenance jsonb,
  metro_area text, territory_slug text, territory_distance_km double precision,
  major_event_motif_titre text, major_event_nom text, major_event_motif text,
  context_relation text)
language sql
stable
security definer
set search_path to ''
as $function$
  with contexte as materialized (
    select c.*, t.slug as basin_slug, t.group_slug
    from public.territorial_contexts c
    join public.territories t on t.id = c.territory_id
    join public.evenements_majeurs m on m.motif_titre = c.major_event_motif_titre
    where c.slug = p_context
      and c.active
      and pg_catalog.now() >= coalesce(c.preview_starts_at, c.starts_at)
      and pg_catalog.now() < c.ends_at
      -- Ce que la RLS de `territories` filtrait quand la fonction etait
      -- INVOKER. En DEFINER, c'est a la requete de le porter.
      and t.active
      and t.status = 'active'
  ),
  candidats as materialized (
    select e.*, c.basin_slug, c.group_slug, c.major_event_motif_titre,
      m.nom as major_event_nom, m.motif as major_event_motif,
      basin.distance_km as territory_distance_km
    from public.events e
    join contexte c on true
    join public.evenements_majeurs m on m.motif_titre = c.major_event_motif_titre
    left join lateral (
      select t.group_slug, t.slug,
        6371 * 2 * pg_catalog.asin(least(1, pg_catalog.sqrt(
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(t.latitude - e.lat) / 2), 2) +
          pg_catalog.cos(pg_catalog.radians(e.lat)) * pg_catalog.cos(pg_catalog.radians(t.latitude)) *
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(t.longitude - e.lng) / 2), 2)
        ))) as distance_km
      from public.territories t
      where t.active and t.status = 'active' and t.group_slug is not null
        and 6371 * 2 * pg_catalog.asin(least(1, pg_catalog.sqrt(
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(t.latitude - e.lat) / 2), 2) +
          pg_catalog.cos(pg_catalog.radians(e.lat)) * pg_catalog.cos(pg_catalog.radians(t.latitude)) *
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(t.longitude - e.lng) / 2), 2)
        ))) <= t.radius_km
      order by distance_km, t.radius_km
      limit 1
    ) basin on true
    where e.duplicate_of is null
      and coalesce(e.cancelled, false) = false
      and e.geom is not null
      and e.start_at < c.ends_at
      and coalesce(e.end_at, e.start_at) >= c.starts_at -
        (coalesce((c.metadata ->> 'association_avant_heures')::double precision, 24) || ' hours')::interval
      and basin.group_slug = c.group_slug
      and basin.slug = c.basin_slug
      and exists (
        select 1
        from public.territorial_context_event_sources r
        join public.event_sources s
          on s.source = r.source
         and s.external_id = r.external_id
         and s.event_id = e.id
        where r.context_id = c.id
          and r.relation = 'associated'
      )
  )
  select c.id, c.publication_id, c.title, c.description, c.category,
    c.start_at, c.end_at, c.timezone,
    case
      when c.start_at <= pg_catalog.now() and coalesce(c.end_at, c.start_at) >= pg_catalog.now() then 'now'
      when c.start_at > pg_catalog.now() and c.start_at - pg_catalog.now() <= public.event_soon_window() then 'soon'
      else 'upcoming'
    end,
    c.date_confidence, c.place_name, c.address, c.city, c.insee_code,
    c.lat, c.lng, c.primary_source, c.source_url, c.image_url, c.image_source,
    c.image_source_url, c.image_author, c.image_license, c.image_updated_at,
    c.cancelled, c.last_source_update, c.last_synced_at, c.announced_at,
    c.presale_at, c.tickets_open_at, c.announcement_tags, c.importance_level,
    c.importance_score, c.performers, c.organizer, c.ticket_url,
    c.announcement_provenance, c.group_slug, c.basin_slug,
    c.territory_distance_km, c.major_event_motif_titre, c.major_event_nom,
    c.major_event_motif, 'associated'
  from candidats c
  order by case when c.start_at <= pg_catalog.now() and coalesce(c.end_at, c.start_at) >= pg_catalog.now()
    then 0 when c.start_at > pg_catalog.now() then 1 else 2 end,
    c.start_at nulls last, c.title
  limit least(greatest(coalesce(p_limite, 120), 1), 300);
$function$;

comment on function public.evenements_contexte(text, integer) is
  'Fiches d''un contexte territorial actif. SECURITY DEFINER : elle traverse public.event_sources, qui reste privée, et n''en projette aucune colonne. Les filtres que la RLS appliquait en INVOKER sont portés par le where.';

-- `create or replace` conserve l'ACL existante ; on la réaffirme pour que le
-- fichier dise seul qui peut appeler cette fonction, et pour qu'un futur
-- `drop`/`create` ne la rouvre pas à PUBLIC par défaut.
revoke execute on function public.evenements_contexte(text, integer) from public;
grant  execute on function public.evenements_contexte(text, integer) to anon, authenticated;
