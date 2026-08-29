-- Les 95 communes de la Métropole Européenne de Lille, et les communes
-- associées que la liste officielle ne nomme pas.
--
-- Pourquoi une table plutôt qu'une constante dans le code : trois choses en
-- ont besoin — le filtre d'ingestion, la normalisation des villes écrites à
-- la main, et l'audit. Une seule source de vérité, et elle est interrogeable.
--
-- Provenance : EPCI 200093201, jeu « decoupage-administratif » d'Etalab
-- (données INSEE). `cle` est la forme normalisée qui sert aux comparaisons :
-- « Faches Thumesnil », « Faches-Thumesnil » et « FACHES THUMESNIL » tombent
-- sur la même clé.
--
-- `associee` distingue les alias : Hellemmes et Lomme ne figurent pas parmi
-- les 95, ce sont des communes associées de Lille. Leur `nom` est celui de la
-- commune de rattachement — c'est lui que la normalisation écrira.

-- Même famille que `event_texte_normalise` : `translate` plutôt que
-- `unaccent`, qui n'est pas installée sur ce projet. Les ligatures se
-- déplient avant, parce que `translate` travaille caractère par caractère et
-- ne sait pas rendre deux lettres pour une.
create or replace function public.commune_cle(p_nom text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(translate(
          replace(replace(coalesce(p_nom, ''), 'œ', 'oe'), 'æ', 'ae'),
          'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
          'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
        '\mst\M', 'saint', 'g'),
      '[^a-z0-9]+', '', 'g'),
    '');
$$;

comment on function public.commune_cle(text) is
  'Forme normalisée d''un nom de commune : minuscules, ligatures dépliées, accents retirés, « st » rendu à « saint », ponctuation effacée.';

create table if not exists public.mel_communes (
  insee    text not null,
  nom      text not null,
  cle      text primary key,
  associee boolean not null default false
);

comment on table public.mel_communes is
  'Communes de la Métropole Européenne de Lille (EPCI 200093201). Filtre d''ingestion, table de normalisation pour events.city, référence d''audit.';

insert into public.mel_communes (insee, nom, cle, associee)
select v.insee, v.nom, public.commune_cle(v.nom), false
from (values
('59005','Allennes-les-Marais'),('59009','Villeneuve-d''Ascq'),('59011','Annœullin'),('59013','Anstaing'),('59017','Armentières'),('59025','Aubers'),('59044','Baisieux'),('59051','La Bassée'),('59052','Bauvin'),('59056','Beaucamps-Ligny'),('59088','Bois-Grenier'),('59090','Bondues'),('59098','Bousbecque'),('59106','Bouvines'),('59128','Capinghem'),('59133','Carnin'),('59143','La Chapelle-d''Armentières'),('59146','Chéreng'),('59152','Comines'),('59163','Croix'),('59173','Deûlémont'),('59193','Emmerin'),('59195','Englos'),('59196','Ennetières-en-Weppes'),('59201','Erquinghem-le-Sec'),('59202','Erquinghem-Lys'),('59208','Escobecques'),('59220','Faches-Thumesnil'),('59247','Forest-sur-Marque'),('59250','Fournes-en-Weppes'),('59252','Frelinghien'),('59256','Fretin'),('59257','Fromelles'),('59275','Gruson'),('59278','Hallennes-lez-Haubourdin'),('59279','Halluin'),('59281','Hantay'),('59286','Haubourdin'),('59299','Hem'),('59303','Herlies'),('59316','Houplin-Ancoisne'),('59317','Houplines'),('59320','Illies'),('59328','Lambersart'),('59332','Lannoy'),('59339','Leers'),('59343','Lesquin'),('59346','Lezennes'),('59350','Lille'),('59352','Linselles'),('59356','Lompret'),('59360','Loos'),('59367','Lys-lez-Lannoy'),('59368','La Madeleine'),('59371','Le Maisnil'),('59378','Marcq-en-Barœul'),('59386','Marquette-lez-Lille'),('59388','Marquillies'),('59410','Mons-en-Barœul'),('59421','Mouvaux'),('59426','Neuville-en-Ferrain'),('59437','Noyelles-lès-Seclin'),('59457','Pérenchies'),('59458','Péronne-en-Mélantois'),('59470','Prémesques'),('59477','Provin'),('59482','Quesnoy-sur-Deûle'),('59487','Radinghem-en-Weppes'),('59507','Ronchin'),('59508','Roncq'),('59512','Roubaix'),('59522','Sailly-lez-Lannoy'),('59523','Sainghin-en-Mélantois'),('59524','Sainghin-en-Weppes'),('59527','Saint-André-lez-Lille'),('59550','Salomé'),('59553','Santes'),('59560','Seclin'),('59566','Sequedin'),('59585','Templemars'),('59598','Toufflers'),('59599','Tourcoing'),('59602','Tressin'),('59609','Vendeville'),('59611','Verlinghem'),('59636','Wambrechies'),('59643','Warneton'),('59646','Wasquehal'),('59648','Wattignies'),('59650','Wattrelos'),('59653','Wavrin'),('59656','Wervicq-Sud'),('59658','Wicres'),('59660','Willems'),('59670','Don')
) as v(insee, nom)
on conflict (cle) do update set insee = excluded.insee, nom = excluded.nom, associee = excluded.associee;

insert into public.mel_communes (insee, nom, cle, associee)
select v.insee, v.nom, public.commune_cle(v.alias), true
from (values
('59350','Lille','Hellemmes'),('59350','Lille','Hellemmes-Lille'),('59350','Lille','Lomme'),
('59009','Villeneuve-d''Ascq','Ascq'),('59009','Villeneuve-d''Ascq','Annappes'),('59009','Villeneuve-d''Ascq','Flers-lez-Lille')
) as v(insee, nom, alias)
on conflict (cle) do update set insee = excluded.insee, nom = excluded.nom, associee = excluded.associee;
