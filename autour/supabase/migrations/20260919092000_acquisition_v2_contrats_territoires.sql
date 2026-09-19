-- ---------------------------------------------------------------------------
-- ACQUISITION V2 — les territoires réels, et ce que l'agent a le droit d'y faire
--
-- LA COUVERTURE EST PROGRESSIVE, ET C'EST UNE DÉCISION
--
-- Onze villes françaises entrent ici « à explorer », pas « à balayer ce soir ».
-- Une tâche balaie UN territoire ; rien dans le système ne permet de demander
-- « toute la France » d'un coup, et c'est volontaire : un balayage national en
-- une exécution produirait des milliers de lignes que personne ne relirait, et
-- consommerait le quota de l'annuaire public pour un résultat illisible.
--
-- L'ordre de priorité dit l'hypothèse : la MEL d'abord, parce qu'Autour y a
-- déjà 1 800 événements et que ses opportunités y sont donc VÉRIFIABLES ;
-- Paris et Lyon ensuite, parce que le volume d'événements publics y est le
-- plus élevé ; le reste après.
--
--
-- L'INTERNATIONAL EST UNE EXPÉRIENCE, ET CHAQUE TERRITOIRE PORTE SON HYPOTHÈSE
--
-- La contrainte `international_avec_raison` refuse un territoire hors de
-- France sans `raison_du_test` écrite. Ce n'est pas de la documentation : un
-- test sans hypothèse ne peut ni réussir ni échouer, il peut seulement coûter.
--
-- Trois territoires, choisis pour ce qu'ils testent, pas pour leur taille :
--
--   Bruxelles — le cas le plus proche : francophone, à 80 km de la MEL, et
--     les habitants de la métropole y sortent déjà. Si le modèle ne marche pas
--     là, il ne marchera nulle part ailleurs.
--   Genève — francophone, hors Union européenne, dense en événements publics.
--     Teste si les sources changent de nature quand le cadre réglementaire
--     change.
--   Montréal — francophone hors d'Europe, et surtout : AUCUNE source française
--     n'y existe. L'annuaire des entreprises s'arrête à la frontière. C'est le
--     test le plus dur, et le seul qui dise si l'agent sait travailler quand
--     ses deux meilleures sources disparaissent.
--
--
-- LES QUATRE NOUVEAUX TYPES, ET POURQUOI PAS PLUS
--
-- `acquisition_find_contact_channel` existe parce que la première mission a
-- mesuré le vrai blocage : 247 opportunités qualifiées sur 249 sans canal.
-- Les trois autres sont des variantes de balayage qui diffèrent par LEUR
-- SOURCE, pas par leur logique — un incubateur ne se trouve pas dans un agenda
-- d'événements, et rien hors de France ne se trouve dans l'annuaire des
-- entreprises. Chacun a donc sa liste blanche, et aucun ne peut lire ce que
-- sa ligne ne nomme pas.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. LES TERRITOIRES FRANÇAIS
--
--    `territory_id` relie à `territories` quand Autour y synchronise déjà des
--    événements — c'est le cas de la MEL, Paris, Rennes, Rouen, Angers,
--    Marseille. Ailleurs il reste nul : Autour n'y sert rien encore, et
--    l'acquisition peut quand même y travailler.
-- ===========================================================================

insert into public.acquisition_territoires
  (slug, nom, pays, region, ville, portee, priorite, statut, sources_disponibles, notes)
values
  ('fr-mel', 'Métropole Européenne de Lille', 'FR', 'Hauts-de-France', 'Lille', 'metropole', 10, 'en_cours',
   array['autour_events','autour_places','openagenda_candidats','recherche_entreprises','annuaire_service_public'],
   'Zone de départ : 1 800 événements déjà collectés, donc des opportunités vérifiables.'),
  ('fr-paris', 'Paris', 'FR', 'Île-de-France', 'Paris', 'ville', 20, 'a_explorer',
   array['autour_events','autour_places','recherche_entreprises','annuaire_service_public'],
   'Volume d''événements publics le plus élevé de France.'),
  ('fr-lyon', 'Lyon', 'FR', 'Auvergne-Rhône-Alpes', 'Lyon', 'ville', 30, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  ('fr-marseille', 'Marseille', 'FR', 'Provence-Alpes-Côte d''Azur', 'Marseille', 'ville', 40, 'a_explorer',
   array['autour_events','recherche_entreprises','annuaire_service_public'], null),
  ('fr-toulouse', 'Toulouse', 'FR', 'Occitanie', 'Toulouse', 'ville', 50, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  ('fr-bordeaux', 'Bordeaux', 'FR', 'Nouvelle-Aquitaine', 'Bordeaux', 'ville', 50, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  ('fr-nantes', 'Nantes', 'FR', 'Pays de la Loire', 'Nantes', 'ville', 50, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  ('fr-strasbourg', 'Strasbourg', 'FR', 'Grand Est', 'Strasbourg', 'ville', 60, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  ('fr-rennes', 'Rennes', 'FR', 'Bretagne', 'Rennes', 'ville', 60, 'a_explorer',
   array['autour_events','recherche_entreprises','annuaire_service_public'], null),
  ('fr-montpellier', 'Montpellier', 'FR', 'Occitanie', 'Montpellier', 'ville', 60, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  ('fr-grenoble', 'Grenoble', 'FR', 'Auvergne-Rhône-Alpes', 'Grenoble', 'ville', 60, 'a_explorer',
   array['recherche_entreprises','annuaire_service_public'], null),
  /* Portée nationale, réservée à la recherche d'écosystème entrepreneurial :
     un incubateur se cherche par son nom, pas par sa rue. Jamais utilisée par
     un balayage de ville. */
  ('fr-national', 'France — écosystème entrepreneurial', 'FR', null, null, 'pays', 70, 'a_explorer',
   array['recherche_entreprises'],
   'Portée nationale réservée à acquisition_scan_incubators. Aucun balayage de ville ne l''utilise.')
on conflict (slug) do update set
  sources_disponibles = excluded.sources_disponibles,
  priorite = excluded.priorite,
  notes = excluded.notes;


-- ===========================================================================
-- 2. LES TROIS TERRITOIRES INTERNATIONAUX — chacun avec son hypothèse
-- ===========================================================================

insert into public.acquisition_territoires
  (slug, nom, pays, region, ville, langue, portee, priorite, statut,
   sources_disponibles, couverture, confiance, raison_du_test)
values
  ('be-bruxelles', 'Bruxelles', 'BE', 'Région de Bruxelles-Capitale', 'Bruxelles', 'fr', 'ville', 80, 'experimental',
   array['osm_overpass'], 'aucune', 'inconnu',
   'Le cas le plus proche : francophone, à 80 km de la MEL, et les habitants de la métropole y sortent déjà. Si le modèle ne tient pas ici, il ne tiendra nulle part ailleurs.'),
  ('ch-geneve', 'Genève', 'CH', 'Canton de Genève', 'Genève', 'fr', 'ville', 85, 'experimental',
   array['osm_overpass'], 'aucune', 'inconnu',
   'Francophone, hors Union européenne, dense en événements publics : teste si les sources changent de nature quand le cadre réglementaire change.'),
  ('ca-montreal', 'Montréal', 'CA', 'Québec', 'Montréal', 'fr', 'ville', 90, 'experimental',
   array['osm_overpass'], 'aucune', 'inconnu',
   'Francophone hors d''Europe, et surtout : aucune source française n''y existe — l''annuaire des entreprises s''arrête à la frontière. Le seul test qui dise si l''agent sait travailler quand ses deux meilleures sources disparaissent.')
on conflict (slug) do update set
  raison_du_test = excluded.raison_du_test,
  sources_disponibles = excluded.sources_disponibles;


-- ===========================================================================
-- 3. RATTACHER LES OPPORTUNITÉS DÉJÀ COLLECTÉES
--
--    Les 358 lignes de la première mission n'ont pas de territoire : elles ont
--    été créées avant que la notion existe. On les rattache par leur commune,
--    sans rien réécrire d'autre.
-- ===========================================================================

update public.acquisition_opportunites o
set territoire_id = t.id,
    region = coalesce(o.region, t.region)
from public.acquisition_territoires t
where o.territoire_id is null
  and t.slug = 'fr-mel'
  and o.ville in ('Lille','Tourcoing','Roubaix','Villeneuve-d''Ascq','Wattrelos');

update public.acquisition_territoires
set derniere_recherche = (select max(updated_at) from public.acquisition_opportunites where territoire_id =
      (select id from public.acquisition_territoires where slug = 'fr-mel')),
    couverture = 'partielle',
    confiance = 'moyen'
where slug = 'fr-mel';


-- ===========================================================================
-- 4. LES QUATRE NOUVEAUX CONTRATS
-- ===========================================================================

insert into public.task_permissions
  (agent, type, libelle, lecture_externe, ecriture_interne, validation_humaine,
   cout_max_eur, sources_autorisees, notes)
values
  ('acquisition', 'acquisition_find_contact_channel',
   'Chercher un canal de contact public pour les opportunités qualifiées',
   true, true, false, 0,
   array['annuaire_service_public','osm_overpass','autour_places','recherche_entreprises'],
   'Répond au blocage mesuré : 247 opportunités qualifiées sur 249 sans canal. Écrit aussi les « non trouvé », pour ne pas recommencer.'),

  ('acquisition', 'acquisition_scan_territory',
   'Balayer un territoire déclaré, en respectant son échéance',
   true, true, false, 0,
   array['autour_events','autour_places','openagenda_candidats','recherche_entreprises'],
   'Comme scan_city, mais piloté par acquisition_territoires : refuse de rebalayer un territoire vu récemment.'),

  ('acquisition', 'acquisition_scan_incubators',
   'Chercher l''écosystème entrepreneurial d''un territoire',
   true, true, false, 0,
   array['recherche_entreprises','autour_events','autour_places'],
   'Incubateurs, pépinières, accélérateurs, coworkings. La pertinence pour Autour n''est jamais supposée : elle est écrite dans raison_pertinence.'),

  ('acquisition', 'acquisition_scan_international',
   'Explorer un territoire international, à titre expérimental',
   true, true, false, 0,
   array['osm_overpass'],
   'Hors de France, ni l''annuaire des entreprises ni les données d''Autour n''existent. OpenStreetMap est la seule source universelle et ouverte disponible.')
on conflict (agent, type) do update set
  libelle = excluded.libelle,
  lecture_externe = excluded.lecture_externe,
  sources_autorisees = excluded.sources_autorisees,
  notes = excluded.notes;

/* Les balayages existants gagnent le droit de lire l'annuaire du service
   public : c'est là que se trouvent les coordonnées des médiathèques, musées
   et équipements municipaux qui forment l'essentiel des opportunités MEL. */
update public.task_permissions
set sources_autorisees = array(select distinct unnest(sources_autorisees || array['annuaire_service_public']))
where agent = 'acquisition' and type in ('acquisition_scan_city','acquisition_find_structures');
