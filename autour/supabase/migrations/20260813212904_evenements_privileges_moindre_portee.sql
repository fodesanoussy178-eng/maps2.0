-- Les fonctions d'exploitation ne sont pas des points d'entrée publics.
--
-- `revoke ... from public` ne suffit pas sur ce projet : Supabase accorde
-- EXECUTE à anon et authenticated par privilège par défaut, et ces rôles
-- gardaient donc le droit d'appeler /rest/v1/rpc/rafraichir_statuts_temporels.
-- Un visiteur pouvait déclencher une réécriture de table.
--
-- Les fonctions de déclencheur n'ont besoin d'aucun droit d'exécution : un
-- déclencheur s'exécute pour le compte de la table, pas de l'appelant.
revoke all on function public.rafraichir_statuts_temporels()      from anon, authenticated;
revoke all on function public.rattacher_evenements_aux_zones()    from anon, authenticated;
revoke all on function public.projeter_publication_en_evenement() from anon, authenticated;
revoke all on function public.events_avant_ecriture()             from anon, authenticated, public;
revoke all on function public.event_areas_avant_ecriture()        from anon, authenticated, public;

-- `evenements_proches` reste SECURITY DEFINER, et c'est délibéré : elle doit
-- lire `event_settings` — qui n'est pas lisible publiquement — pour connaître
-- la fenêtre « soon ». En SECURITY INVOKER, la RLS masquerait ce réglage à
-- anon et la fenêtre retomberait silencieusement sur sa valeur par défaut :
-- le réglage produit existerait sans avoir d'effet pour les visiteurs.
comment on function public.evenements_proches is
  'Événements canoniques d''une emprise, statut recalculé à l''instant de l''appel. SECURITY DEFINER : doit lire event_settings pour la fenêtre « soon ». Ne lit que des colonnes déjà publiques.';
