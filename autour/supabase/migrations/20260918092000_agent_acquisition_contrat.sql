-- ---------------------------------------------------------------------------
-- AGENT ACQUISITION — son inscription, son contrat, et la porte qui le réveille
--
-- CE FICHIER NE CRÉE AUCUNE PLANIFICATION.
--
-- `private.invoke_agent_acquisition()` existe, elle marche, et rien ne
-- l'appelle. C'est délibéré (§20) : un agent qui se réveille tout seul avant
-- que quiconque ait relu ce qu'il produit, c'est une base d'opportunités
-- fausses qui grossit pendant qu'on dort. La planification s'ajoute en une
-- ligne le jour où la qualité du premier lot aura été jugée :
--
--   select cron.schedule('agent-acquisition-quotidien', '0 5 * * *',
--                        $$select private.invoke_agent_acquisition('work')$$);
--
--
-- LE SECRET EST CELUI QUI EXISTE DÉJÀ.
--
-- `event_sync_secret` est dans le Vault du projet, et la même valeur est servie
-- aux fonctions Edge sous `EVENT_SYNC_SECRET` — les secrets de fonction sont
-- au projet, pas à la fonction. Réutiliser cette porte plutôt qu'en percer une
-- seconde évite le défaut qui a mis DATAtourisme à l'arrêt en août : deux
-- secrets censés être identiques, qui ne l'étaient pas, et trente exécutions en
-- 401 avant qu'on s'en aperçoive.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. L'AGENT
-- ===========================================================================

insert into public.agents (slug, nom, mission) values (
  'acquisition',
  'Agent Acquisition',
  'Trouver, qualifier et préparer des opportunités d''acquisition gratuites, locales et organiques pour Autour. Ne contacte personne.'
)
on conflict (slug) do update set nom = excluded.nom, mission = excluded.mission;


-- ===========================================================================
-- 2. SON CONTRAT — un type de tâche, une ligne, des sources nommées
--
--    LES SOURCES, ET POURQUOI CELLES-LÀ
--
--    `autour_events`, `autour_places`, `openagenda_candidats` sont les données
--    qu'Autour a DÉJÀ collectées et qui lui appartiennent. Ce sont de loin les
--    meilleures : une association qui a publié trois événements à Tourcoing ce
--    trimestre est une structure locale, active, et dont on sait déjà ce
--    qu'elle organise. Aucune requête sortante, aucun coût, aucune condition
--    d'utilisation à respecter — c'est notre base.
--
--    `recherche_entreprises` est l'API ouverte de l'annuaire des entreprises
--    (DINUM, api.gouv.fr). Elle publie associations et établissements avec leur
--    objet social et leur commune, sans clé, sous licence ouverte, et elle est
--    faite pour être appelée par des programmes. Elle complète le reste avec
--    les structures qui n'organisent rien de public — un club, une MJC, une
--    association étudiante.
--
--    Ce qui N'EST PAS dans cette liste ne sera pas lu, même si le code savait
--    le faire : ni réseau social, ni plateforme dont les conditions
--    interdisent l'extraction automatisée, ni annuaire de contacts.
-- ===========================================================================

insert into public.task_permissions
  (agent, type, libelle, lecture_externe, ecriture_interne, validation_humaine,
   cout_max_eur, sources_autorisees, notes)
values
  ('acquisition', 'acquisition_scan_city',
   'Balayer une ville : structures et gisements d''utilisateurs',
   true, true, false, 0,
   array['autour_events','autour_places','openagenda_candidats','recherche_entreprises'],
   'Découverte large. Ne qualifie pas et ne prépare rien : elle remplit la base avec leurs sources.'),

  ('acquisition', 'acquisition_find_structures',
   'Chercher des structures d''un type donné dans une ville',
   true, true, false, 0,
   array['autour_events','autour_places','recherche_entreprises'],
   'Recherche ciblée par catégorie, quand le balayage large a déjà été fait.'),

  ('acquisition', 'acquisition_qualify',
   'Qualifier les opportunités nouvelles selon les six critères',
   false, true, false, 0.05,
   array['autour_events','autour_places'],
   'Règles déterministes d''abord. Le modèle n''est appelé que sur les cas que les règles laissent indécis, et seulement si une clé est configurée.'),

  ('acquisition', 'acquisition_prepare_contact',
   'Préparer une proposition de contact, pour relecture humaine',
   false, true, true, 0.05,
   array[]::text[],
   'Produit un brouillon en attente_validation. N''envoie rien : task_permissions.contact_externe ne peut pas valoir true.'),

  ('acquisition', 'acquisition_review_opportunity',
   'Marquer une opportunité comme nécessitant un examen humain',
   false, true, true, 0,
   array[]::text[],
   'Ce que les règles ne tranchent pas remonte ici plutôt que d''être deviné.'),

  ('acquisition', 'acquisition_followup_analysis',
   'Mesurer l''entonnoir et dire ce qui n''est pas mesurable',
   false, true, false, 0,
   array[]::text[],
   'Lit acquisition_entonnoir(). Écrit le constat dans runs, y compris « données insuffisantes ».')
on conflict (agent, type) do update set
  libelle = excluded.libelle,
  lecture_externe = excluded.lecture_externe,
  cout_max_eur = excluded.cout_max_eur,
  sources_autorisees = excluded.sources_autorisees,
  notes = excluded.notes;


-- ===========================================================================
-- 3. LA PORTE — même chemin que les synchronisations qui tournent sans faute
-- ===========================================================================

create or replace function private.invoke_agent_acquisition(p_mode text default 'work')
returns bigint
language plpgsql
set search_path to ''
as $function$
declare
  sync_secret text;
  request_url text;
begin
  select nullif(btrim(secret.decrypted_secret), '')
  into sync_secret
  from vault.decrypted_secrets secret
  where secret.name = 'event_sync_secret'
  order by secret.created_at desc
  limit 1;

  if sync_secret is null then return null; end if;

  request_url := 'https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/agent-acquisition'
                 || '?mode=' || coalesce(p_mode, 'work');

  return net.http_post(
    url := request_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end;
$function$;

comment on function private.invoke_agent_acquisition(text) is
  'Réveille l''agent Acquisition depuis la base, avec le secret du Vault. Aucune planification ne l''appelle : le cron s''ajoute quand la qualité du premier lot est jugée.';
