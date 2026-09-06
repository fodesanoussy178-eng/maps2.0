-- ---------------------------------------------------------------------------
-- LOT 4-BIS — UNE VRAIE RÉCOLTE DE LA MÉTROPOLE, BORNÉE ET REJOUABLE
--
-- DOUZE POINTS NE SONT PAS UNE RÉCOLTE. Le premier remplissage échantillonnait
-- douze coordonnées choisies à la main : c'était une démonstration, pas une
-- couverture, et rien ne disait ce qui manquait.
--
-- CE QUI TIENT LIEU DE PAGINATION ICI
--
-- `/api/datatourisme` n'expose pas de curseur : elle interroge le catalogue
-- dans un rayon de 3 km et rend au plus 50 objets. La seule façon de couvrir
-- un territoire est donc de le PAVER. Le pavage n'est pas inventé : c'est la
-- liste des communes de la métropole, `mel_communes`, qui sert déjà de filtre
-- d'ingestion aux événements. 95 d'entre elles portent des coordonnées ; ce
-- sont les 95 points de la récolte, plus quelques points supplémentaires pour
-- les villes assez denses pour saturer le plafond de 50.
--
-- CE QUI LA REND BORNÉE. Chaque exécution ne lance qu'un nombre maximal
-- d'appels et note ce qu'elle a lancé. La suivante reprend où l'on s'était
-- arrêté. On ne rejoue une case déjà récoltée qu'après un délai.
--
-- CE QUI LA REND IDEMPOTENTE. Rien ici n'insère de lieu : tout passe par
-- `places_ingerer`, dont le niveau 1 (`source` + `external_id`) garantit qu'un
-- objet DATAtourisme déjà connu est revu, jamais dupliqué. Rejouer la récolte
-- entière ne crée donc aucun doublon — c'est mesuré, pas supposé.
--
-- ET ELLE NE CRÉE AUCUN TERRITOIRE : elle ne parle qu'à `places_ingerer`, qui
-- ne connaît que `zone_autour_pour`, qui ne fait que chercher.
-- ---------------------------------------------------------------------------

create table if not exists public.place_recoltes (
  id            bigint generated always as identity primary key,
  source        text not null,
  -- La case du pavage : le code INSEE de la commune, ou un point nommé pour
  -- les renforts. C'est cette clé qui rend la récolte reprenable.
  case_cle      text not null,
  lat           double precision not null,
  lng           double precision not null,
  requete_id    bigint,
  lance_le      timestamptz not null default now(),
  verse_le      timestamptz,
  statut        text not null default 'lancee'
                check (statut in ('lancee','versee','vide','echec')),
  lus           integer,
  retenus       integer,
  crees         integer,
  rapproches    integer,
  revus         integer,
  ambigus       integer,
  unique (source, case_cle, lance_le)
);

comment on table public.place_recoltes is
  'Journal du pavage de récolte. Sans lui, une récolte interrompue recommence à zéro et une case manquante passe inaperçue.';

create index if not exists place_recoltes_pendantes_idx
  on public.place_recoltes (statut, lance_le) where statut = 'lancee';
create index if not exists place_recoltes_case_idx
  on public.place_recoltes (source, case_cle, lance_le desc);

alter table public.place_recoltes enable row level security;
revoke all on public.place_recoltes from anon, authenticated, public;
grant all on public.place_recoltes to service_role;


-- ---------------------------------------------------------------------------
-- LE PAVAGE. Les 95 communes qui portent des coordonnées, plus un renfort
-- pour les quatre villes qui saturent à coup sûr le plafond de 50 objets par
-- point. Les renforts sont décalés d'environ deux kilomètres : assez pour
-- changer de case dans le cache de la route, assez peu pour ne pas laisser de
-- trou entre deux disques de 3 km.
-- ---------------------------------------------------------------------------

create or replace view public.place_pavage_mel as
  select mc.insee as case_cle, mc.nom as libelle, mc.lat, mc.lng
    from public.mel_communes mc
   where mc.lat is not null and mc.lng is not null and not mc.associee
  union all
  select r.case_cle, r.libelle, r.lat, r.lng
    from (values
      ('renfort-lille-n',     'Lille nord',        50.6480, 3.0620),
      ('renfort-lille-s',     'Lille sud',         50.6100, 3.0530),
      ('renfort-lille-e',     'Lille est',         50.6300, 3.0850),
      ('renfort-roubaix-n',   'Roubaix nord',      50.7060, 3.1800),
      ('renfort-tourcoing-n', 'Tourcoing nord',    50.7350, 3.1560),
      ('renfort-vda-n',       'Villeneuve nord',   50.6350, 3.1400)
    ) as r(case_cle, libelle, lat, lng);


create or replace function public.places_recolter_mel(
  p_max          integer default 25,
  p_fraicheur    interval default interval '7 days')
returns table (lancees int, restantes int)
language plpgsql
set search_path to 'public', 'net'
as $function$
declare
  c record;
  v_lancees int := 0;
  v_restantes int;
begin
  for c in
    select v.case_cle, v.lat, v.lng
      from public.place_pavage_mel v
     where not exists (
       -- UNE CASE EN ÉCHEC N'EST PAS UNE CASE RÉCOLTÉE. Le catalogue refuse
       -- quand on le presse trop : vingt et une cases sont revenues en 503 sur
       -- la première passe. Les compter comme faites laisserait des trous
       -- permanents dans la métropole, invisibles et jamais rattrapés.
       select 1 from public.place_recoltes r
        where r.source = 'datatourisme' and r.case_cle = v.case_cle
          and r.statut <> 'echec'
          and r.lance_le > now() - p_fraicheur)
     order by v.case_cle
     limit greatest(coalesce(p_max, 25), 0)
  loop
    insert into public.place_recoltes (source, case_cle, lat, lng, requete_id)
    values ('datatourisme', c.case_cle, c.lat, c.lng,
            public.places_recolter_datatourisme(c.lat, c.lng));
    v_lancees := v_lancees + 1;
  end loop;

  select count(*) into v_restantes
    from public.place_pavage_mel v
   where not exists (
     select 1 from public.place_recoltes r
      where r.source = 'datatourisme' and r.case_cle = v.case_cle
        and r.statut <> 'echec'
        and r.lance_le > now() - p_fraicheur);

  return query select v_lancees, v_restantes;
end;
$function$;

revoke all on function public.places_recolter_mel(integer, interval)
  from public, anon, authenticated;
grant execute on function public.places_recolter_mel(integer, interval) to service_role;


-- Le versement de tout ce qui a répondu. Séparé de la récolte parce que
-- `pg_net` est asynchrone, et rejouable parce qu'une case déjà versée n'est
-- plus « lancée ».
create or replace function public.places_verser_recoltes()
returns table (cases int, lus int, retenus int, crees int, rapproches int,
               revus int, ambigus int, vides int, echecs int)
language plpgsql
set search_path to 'public', 'net', 'topology'
as $function$
declare
  j record; v record; s int;
  n_cases int := 0; n_lus int := 0; n_ret int := 0; n_cree int := 0;
  n_rap int := 0; n_revu int := 0; n_amb int := 0; n_vide int := 0; n_ech int := 0;
begin
  for j in
    select r.id, r.requete_id from public.place_recoltes r
     where r.statut = 'lancee' and r.requete_id is not null
     order by r.id
  loop
    select rep.status_code into s from net._http_response rep where rep.id = j.requete_id;
    if s is null then
      -- La réponse n'est pas encore arrivée : on laisse la case en attente.
      continue;
    end if;
    if s <> 200 then
      update public.place_recoltes set statut='echec', verse_le=now() where id=j.id;
      n_ech := n_ech + 1; n_cases := n_cases + 1; continue;
    end if;

    select * into v from public.places_verser_datatourisme(j.requete_id);
    update public.place_recoltes
       set statut = case when coalesce(v.lus,0) = 0 then 'vide' else 'versee' end,
           verse_le = now(), lus = v.lus, retenus = v.retenus, crees = v.crees,
           rapproches = v.rapproches, revus = v.revus, ambigus = v.ambigus
     where id = j.id;

    n_cases := n_cases + 1;
    n_lus := n_lus + coalesce(v.lus,0);      n_ret  := n_ret  + coalesce(v.retenus,0);
    n_cree := n_cree + coalesce(v.crees,0);  n_rap  := n_rap  + coalesce(v.rapproches,0);
    n_revu := n_revu + coalesce(v.revus,0);  n_amb  := n_amb  + coalesce(v.ambigus,0);
    if coalesce(v.lus,0) = 0 then n_vide := n_vide + 1; end if;
  end loop;

  return query select n_cases, n_lus, n_ret, n_cree, n_rap, n_revu, n_amb, n_vide, n_ech;
end;
$function$;

revoke all on function public.places_verser_recoltes() from public, anon, authenticated;
grant execute on function public.places_verser_recoltes() to service_role;

-- UNE VUE S'EXÉCUTE AVEC LES DROITS DE SON PROPRIÉTAIRE, et le grant par
-- défaut de Supabase s'applique aussi à elle : sans cette révocation,
-- `place_pavage_mel` laissait `anon` lire `mel_communes` à travers elle, alors
-- que cette table lui est fermée depuis le Lot S. Le pavage de récolte n'est
-- pas une donnée de produit.
revoke all on public.place_pavage_mel from anon, authenticated, public;
grant select on public.place_pavage_mel to service_role;
