-- ---------------------------------------------------------------------------
-- LOT 4-BIS — RATTRAPER LES DOUBLONS D'AVANT LA RÈGLE
--
-- `places_ingerer` applique désormais un rayon qui dépend de la famille. Mais
-- les lieux déjà enregistrés l'ont été sous l'ancien rayon fixe : deux morceaux
-- d'un même parc, séparés de deux cents mètres, sont entrés comme deux lieux et
-- y resteraient pour toujours. Une règle qui ne vaut que pour l'avenir laisse
-- derrière elle exactement ce qu'elle était censée empêcher.
--
-- CE QU'ON NE FAIT PAS : SUPPRIMER. Le doublon devient un satellite —
-- `duplicate_of` pointe vers le maître, comme pour les événements. Rien n'est
-- perdu, la provenance suit, et une fusion faite à tort se défait.
--
-- LE MAÎTRE EST LE PLUS ANCIEN. Ce n'est pas arbitraire : c'est lui que
-- d'éventuelles références extérieures désignent déjà, et son UUID est le plus
-- susceptible d'avoir circulé.
--
-- LES MÊMES TROIS SIGNAUX, TOUJOURS. Nom normalisé, commune, distance sous le
-- rayon de la famille la plus étendue des deux. Aucun nouveau critère n'est
-- introduit ici : on rejoue simplement la règle courante sur le passé.
-- ---------------------------------------------------------------------------

create or replace function public.places_rapprocher_doublons(
  p_appliquer boolean default false)
returns table (paires int, fusionnes int, exemple text)
language plpgsql
set search_path to 'public', 'topology'
as $function$
declare
  v_paires int; v_fus int := 0; v_ex text;
begin
  create temp table if not exists doublons_candidats (
    maitre uuid, satellite uuid, nom text, ecart numeric) on commit drop;
  delete from doublons_candidats;

  insert into doublons_candidats (maitre, satellite, nom, ecart)
  select a.id, b.id, a.name,
         round(ST_Distance(a.geom::topology.geography, b.geom::topology.geography)::numeric)
    from public.places a
    join public.places b
      on b.id <> a.id
     and b.name_normalized = a.name_normalized
     and public.commune_cle(coalesce(b.commune, b.city))
         is not distinct from public.commune_cle(coalesce(a.commune, a.city))
     and (a.created_at, a.id) < (b.created_at, b.id)
   where a.duplicate_of is null and b.duplicate_of is null
     and a.status <> 'disabled' and b.status <> 'disabled'
     and a.geom is not null and b.geom is not null
     and ST_DWithin(a.geom::topology.geography, b.geom::topology.geography,
           greatest(public.place_rayon_rapprochement(a.family),
                    public.place_rayon_rapprochement(b.family)));

  select count(*), (select nom || ' (' || ecart || ' m)' from doublons_candidats
                     order by ecart desc limit 1)
    into v_paires, v_ex from doublons_candidats;

  if not p_appliquer then
    return query select v_paires, 0, v_ex;
    return;
  end if;

  -- La provenance rejoint le maître : c'est elle qui rend la resynchronisation
  -- idempotente, et un satellite ne doit plus rien attirer à lui.
  update public.place_sources s
     set place_id = d.maitre
    from doublons_candidats d
   where s.place_id = d.satellite
     and not exists (select 1 from public.place_sources t
                      where t.place_id = d.maitre
                        and t.source = s.source and t.external_id = s.external_id);

  -- Ce que le satellite savait et que le maître ignore rejoint le maître.
  update public.places m set
    address       = coalesce(m.address, s.address),
    postal_code   = coalesce(m.postal_code, s.postal_code),
    category      = coalesce(m.category, s.category),
    family        = coalesce(m.family, s.family),
    description   = coalesce(m.description, s.description),
    opening_hours = coalesce(m.opening_hours, s.opening_hours),
    official_url  = coalesce(m.official_url, s.official_url),
    image_url     = coalesce(m.image_url, s.image_url),
    image_source  = coalesce(m.image_source, s.image_source),
    image_type    = coalesce(m.image_type, s.image_type),
    image_refs    = m.image_refs || s.image_refs,
    place_keys    = (select array(select distinct unnest(m.place_keys || s.place_keys))),
    first_seen_at = least(m.first_seen_at, s.first_seen_at),
    last_seen_at  = greatest(m.last_seen_at, s.last_seen_at)
  from doublons_candidats d
  join public.places s on s.id = d.satellite
  where m.id = d.maitre;

  update public.places p
     set duplicate_of = d.maitre, match_status = 'matched'
    from doublons_candidats d
   where p.id = d.satellite;
  get diagnostics v_fus = row_count;

  return query select v_paires, v_fus, v_ex;
end;
$function$;

revoke all on function public.places_rapprocher_doublons(boolean)
  from public, anon, authenticated;
grant execute on function public.places_rapprocher_doublons(boolean) to service_role;
