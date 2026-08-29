-- Quarante-deux agendas OpenAgenda de la métropole, là où il n'y en avait trois.
--
-- COMMENT ILS ONT ÉTÉ TROUVÉS. Pas devinés : lus. Pour chaque slug candidat —
-- les 95 communes, leurs variantes « ville-de-… », et les salles et
-- structures que la métropole connaît — la base a demandé la page publique
-- `https://openagenda.com/fr/<slug>` par `pg_net`, et en a extrait
-- l'identifiant numérique que le connecteur exige. La méthode a d'abord été
-- validée sur les trois agendas déjà inscrits : elle retrouve exactement
-- 57621068, 9977986 et 32344838.
--
-- Un slug sans identifiant n'est pas un agenda : openagenda.com rend 200 pour
-- tout, la présence de l'identifiant est le seul signal fiable. C'est ce qui
-- permet de dire, sans supposer, que Wasquehal, Croix et Halluin n'ont
-- aujourd'hui AUCUN agenda OpenAgenda sous les noms essayés — tandis
-- qu'Armentières en a un par son théâtre, Le Vivat, et Mons-en-Barœul par son
-- espace culturel Allende.
--
-- LES SALLES SONT RATTACHÉES À LEUR COMMUNE, pas érigées en territoires : un
-- territoire est un lieu où quelqu'un habite, une salle est une source de
-- plus pour ce lieu. `territory_sources` accepte plusieurs sources par
-- territoire, c'est exactement à cela qu'elle sert.
--
-- La priorité range les officielles d'abord : la ville (100), puis ses salles
-- (200), puis l'agenda métropolitain (300).

insert into public.territories (slug, name, country, latitude, longitude, radius_km,
                                timezone, group_slug, status, active, metadata)
select public.commune_slug(m.nom), m.nom, 'FR', m.lat, m.lng, 5,
       'Europe/Paris', 'mel', 'active', true,
       jsonb_build_object('insee', m.insee, 'provenance', 'EPCI 200093201 (Etalab) + API Géo')
from public.mel_communes m
where not m.associee
  and public.commune_slug(m.nom) in (
    'baisieux','comines','englos','faches-thumesnil','hem','houplin-ancoisne','houplines',
    'la-madeleine','marcq-en-baroeul','neuville-en-ferrain','sequedin','wambrechies',
    'villeneuve-dascq','lambersart','lezennes','loos','mouvaux','saint-andre-lez-lille',
    'wattrelos','wavrin','armentieres','mons-en-baroeul')
on conflict (slug) do update
   set latitude = excluded.latitude, longitude = excluded.longitude,
       group_slug = 'mel', status = 'active', active = true, updated_at = now();

-- Le territoire métropolitain lui-même, pour l'agenda de la MEL : centre
-- géométrique des 95 communes, rayon qui les contient toutes.
insert into public.territories (slug, name, country, latitude, longitude, radius_km,
                                timezone, group_slug, status, active, metadata)
select 'mel', 'Métropole Européenne de Lille', 'FR',
       round(avg(lat)::numeric, 5)::double precision,
       round(avg(lng)::numeric, 5)::double precision,
       25, 'Europe/Paris', 'mel', 'active', true,
       jsonb_build_object('epci', '200093201', 'communes', count(*))
from public.mel_communes where not associee
on conflict (slug) do update
   set latitude = excluded.latitude, longitude = excluded.longitude,
       radius_km = 25, group_slug = 'mel', status = 'active', active = true, updated_at = now();

insert into public.territory_sources (territory_id, provider, source_identifier, source_name,
                                      active, priority, metadata)
select t.id, 'openagenda', v.uid, v.nom, true, v.priorite,
       jsonb_build_object(
         'agenda_slug', v.slug,
         'official', true,
         'validation', 'page_publique_openagenda_uid_lu',
         'official_url', 'https://openagenda.com/fr/' || v.slug,
         'kind', v.genre)
from (values
  -- les communes
  ('baisieux','86363564','Baisieux','baisieux','commune',100),
  ('comines','3703186','Évènement Comines','comines','commune',100),
  ('comines','565851','Ville de Comines','ville-de-comines','commune',110),
  ('englos','9990803','Englos','englos','commune',100),
  ('faches-thumesnil','4117645','Faches-Thumesnil','faches-thumesnil','commune',100),
  ('hem','93873126','Hem','hem','commune',100),
  ('houplin-ancoisne','9927705','Houplin-Ancoisne','houplin-ancoisne','commune',100),
  ('houplines','28108196','Houplines','houplines','commune',100),
  ('la-madeleine','79678621','La Madeleine','la-madeleine','commune',100),
  ('marcq-en-baroeul','33974687','Marcq-en-Barœul','marcq-en-baroeul','commune',100),
  ('marcq-en-baroeul','56945095','Ville de Marcq-en-Barœul','ville-de-marcq-en-baroeul','commune',110),
  ('neuville-en-ferrain','10842451','Ville de Neuville-en-Ferrain','neuville-en-ferrain','commune',100),
  ('sequedin','99238251','Ville de Sequedin','sequedin','commune',100),
  ('wambrechies','37476516','Ville de Wambrechies','wambrechies','commune',100),
  ('villeneuve-dascq','95450215','Villeneuve-d''Ascq','villeneuve-dascq','commune',100),
  ('villeneuve-dascq','36207583','Ville de Villeneuve-d''Ascq','ville-de-villeneuve-dascq','commune',110),
  ('lambersart','26253519','Ville de Lambersart','ville-de-lambersart','commune',100),
  ('lezennes','53203404','Ville de Lezennes','ville-de-lezennes','commune',100),
  ('loos','80642274','Ville de Loos','ville-de-loos','commune',100),
  ('mouvaux','6097494','Ville de Mouvaux','ville-de-mouvaux','commune',100),
  ('saint-andre-lez-lille','26040111','Ville de Saint-André-lez-Lille','ville-de-saint-andre-lez-lille','commune',100),
  ('wattrelos','24300765','Ville de Wattrelos','ville-de-wattrelos','commune',100),
  ('wavrin','77588561','Ville de Wavrin','ville-de-wavrin','commune',100),
  ('lille','96901237','Lille','lille','commune',110),
  ('tourcoing','94332775','Ville de Tourcoing','ville-de-tourcoing','commune',110),
  -- les salles et structures, rattachées à leur commune
  ('lille','27027963','FLOW — Centre eurorégional des cultures urbaines','flow','salle',200),
  ('lille','40806617','Gare Saint Sauveur','gare-saint-sauveur','salle',200),
  ('lille','66452321','Le Grand Sud','le-grand-sud','salle',200),
  ('lille','44022245','Le Prato — Pôle national cirque','le-prato','salle',200),
  ('lille','2981886','Orchestre National de Lille','orchestre-national-de-lille','structure',200),
  ('lille','53347052','Palais des beaux-arts de Lille','palais-des-beaux-arts-de-lille','salle',200),
  ('roubaix','64406059','La Cave aux Poètes','la-cave-aux-poetes','salle',200),
  ('roubaix','23355730','La Condition Publique','la-condition-publique','salle',200),
  ('roubaix','79017343','La Piscine — musée d''art et d''industrie','la-piscine-roubaix','salle',200),
  ('tourcoing','78713687','Le Grand Mix','le-grand-mix','salle',200),
  ('tourcoing','70806772','Conservatoire de Tourcoing','tourcoing','structure',200),
  ('villeneuve-dascq','33521071','La Rose des Vents','la-rose-des-vents','salle',200),
  ('villeneuve-dascq','25099040','La Ferme d''en-Haut','la-ferme-den-haut','salle',200),
  ('armentieres','6198429','Le Vivat','le-vivat','salle',200),
  ('mons-en-baroeul','18348376','Espace culturel Allende','allende','salle',200),
  -- l'agenda de la métropole
  ('mel','89904399','Métropole Européenne de Lille','metropole-europeenne-de-lille','metropole',300)
) as v(territoire, uid, nom, slug, genre, priorite)
join public.territories t on t.slug = v.territoire
on conflict do nothing;
