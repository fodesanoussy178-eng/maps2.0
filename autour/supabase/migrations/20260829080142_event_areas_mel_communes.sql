-- La zone « lille » couvrait un rectangle plus petit que la métropole.
--
-- 50.55–50.75 N / 2.90–3.25 E laissait DEHORS, purement et simplement :
-- Halluin (50.787), Comines (50.764), Wervicq-Sud (50.775), Warneton,
-- Armentières (2.881), La Bassée (2.804), Aubers, Illies, Carnin (50.491),
-- Provin, Bauvin. C'est l'explication mécanique des communes à zéro
-- événement : le catalogue n'a jamais été interrogé sur elles.
--
-- Le rectangle devient un SUR-ENSEMBLE de la métropole, et le filtre exact
-- passe aux communes : `commune_keys` porte les 95 communes de la MEL
-- (EPCI 200093201, jeu Etalab decoupage-administratif) sous forme normalisée,
-- plus les communes associées que la liste officielle ne nomme pas —
-- Hellemmes et Lomme sont Lille, Ascq et Annappes sont Villeneuve-d'Ascq.
-- Sans elles, des salles entières seraient refusées.
--
-- Pourquoi les noms et non les codes INSEE : `insee_code` est NULL sur les
-- 2 154 événements de la base, aucune source ne le fournit. `city`, lui, est
-- toujours présent. Les codes restent posés pour la provenance.

alter table public.event_areas
  add column if not exists commune_keys text[];

comment on column public.event_areas.commune_keys is
  'Clés de commune normalisées (minuscules, sans accents ni ponctuation) qui délimitent exactement la zone. Quand la colonne est non vide, un événement hors de cette liste est refusé même s''il tombe dans le rectangle.';

update public.event_areas set
  name    = 'Métropole Européenne de Lille',
  min_lat = 50.44, max_lat = 50.82,
  min_lng = 2.68,  max_lng = 3.32,
  insee_codes = ARRAY['59005','59009','59011','59013','59017','59025','59044','59051','59052','59056','59088','59090','59098','59106','59128','59133','59143','59146','59152','59163','59173','59193','59195','59196','59201','59202','59208','59220','59247','59250','59252','59256','59257','59275','59278','59279','59281','59286','59299','59303','59316','59317','59320','59328','59332','59339','59343','59346','59350','59352','59356','59360','59367','59368','59371','59378','59386','59388','59410','59421','59426','59437','59457','59458','59470','59477','59482','59487','59507','59508','59512','59522','59523','59524','59527','59550','59553','59560','59566','59585','59598','59599','59602','59609','59611','59636','59643','59646','59648','59650','59653','59656','59658','59660','59670'],
  commune_keys = ARRAY['allenneslesmarais','annappes','annoeullin','anstaing','armentieres','ascq','aubers','baisieux','bauvin','beaucampsligny','boisgrenier','bondues','bousbecque','bouvines','capinghem','carnin','chereng','comines','croix','deulemont','don','emmerin','englos','ennetieresenweppes','erquinghemlesec','erquinghemlys','escobecques','fachesthumesnil','flersbreucq','flerslezlille','forestsurmarque','fournesenweppes','frelinghien','fretin','fromelles','gruson','hallenneslezhaubourdin','halluin','hantay','haubourdin','hellemmes','hellemmeslille','hem','herlies','houplinancoisne','houplines','illies','labassee','lachapelledarmentieres','lamadeleine','lambersart','lannoy','leers','lemaisnil','lesart','lesquin','lezennes','lille','linselles','lomme','lompret','loos','lyslezlannoy','marcqenbaroeul','marquettelezlille','marquillies','monsenbaroeul','mouvaux','neuvilleenferrain','noyelleslesseclin','perenchies','peronneenmelantois','premesques','provin','quesnoysurdeule','radinghemenweppes','ronchin','roncq','roubaix','saillylezlannoy','sainghinenmelantois','sainghinenweppes','saintandrelezlille','salome','santes','seclin','sequedin','templemars','toufflers','tourcoing','tressin','vendeville','verlinghem','villeneuvedascq','wambrechies','warneton','wasquehal','wattignies','wattrelos','wavrin','wervicqsud','wicres','willems'],
  updated_at = now()
where code = 'lille';
