-- Les envies et les tags qui les font correspondre, côté base.
--
-- Cette table est le MIROIR de `INTEREST_MATCHING` dans
-- `annonces-taxonomie.js`, qui reste l'autorité pour l'écran. On la copie ici
-- pour une seule raison : pouvoir auditer la couverture par envie en SQL,
-- sans réimplémenter le classement ni deviner ce que « Rap » recouvre.
--
-- `parent` dit la hiérarchie que « Tes envies » affiche : un genre est sous
-- « Artistes & concerts », il n'est pas un intérêt de même rang.

create table if not exists public.interets_tags (
  interet text primary key,
  label   text not null,
  parent  text,
  tags    text[] not null
);

comment on table public.interets_tags is
  'Miroir de INTEREST_MATCHING (annonces-taxonomie.js) pour auditer la couverture par envie. L''écran reste servi par le fichier JS.';

insert into public.interets_tags (interet, label, parent, tags) values
  ('concerts','Artistes & concerts',null,array['concert','live','live_music','showcase','gig','performance_music','music_festival']),
  ('rap','Rap','concerts',array['rap','hip_hop','french_rap','trap','drill','rap_concert']),
  ('rnb','R&B','concerts',array['rnb']),
  ('pop','Pop','concerts',array['pop']),
  ('afro','Afro','concerts',array['afro']),
  ('rock','Rock','concerts',array['rock']),
  ('electro','Électro','concerts',array['electro']),
  ('jazz','Jazz','concerts',array['jazz']),
  ('reggae','Reggae','concerts',array['reggae']),
  ('kpop','K-pop','concerts',array['kpop']),
  ('classical','Classique','concerts',array['classical']),
  ('cinema','Cinéma',null,array['cinema','film','screening','projection','avant_premiere','premiere','festival_cinema','film_festival','rencontre_realisateur','rencontre_equipe_film','cine_debat']),
  ('manga_anime','Manga & anime',null,array['manga','anime','manga_anime_gaming','japanimation','cosplay','convention_manga','convention_anime','mangaka','anime_screening','signing_manga','manga_festival']),
  ('exhibitions','Expositions',null,array['exhibition','exposition','vernissage','gallery','art_exhibition','photography_exhibition','museum_exhibition','retrospective']),
  ('sport','Sport',null,array['sport','match','tournament','competition','running','basketball','tennis','combat_sport','combat_sports','cycling','athletics']),
  ('football','Football',null,array['football','soccer','football_match','ligue1','coupe','losc','futsal']),
  ('fashion','Mode',null,array['fashion','mode','fashion_show','runway','streetwear','sneakers','designer','fashion_popup','clothing_drop','creators_market']),
  ('food','Food',null,array['food','gastronomy','restaurant_event','street_food','food_festival','tasting','culinary','food_market','brunch_event','chef_event']),
  ('nightlife','Nightlife',null,array['nightlife','club','nightclub','party','dj_set','night_event','afterparty','rave','dance_party']),
  ('family','Famille',null,array['family','kids','children','family_event','young_audience','workshop_children','family_show','parenting_event']),
  ('theatre','Théâtre',null,array['theatre','theater','play','stage_play','dramatic_art','theatre_premiere','theatre_festival']),
  ('festivals','Festivals',null,array['festival','music_festival','film_festival','festival_cinema','food_festival','cultural_festival','manga_festival','local_festival'])
on conflict (interet) do update set label=excluded.label, parent=excluded.parent, tags=excluded.tags;
