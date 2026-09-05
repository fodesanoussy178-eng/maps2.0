-- ---------------------------------------------------------------------------
-- Fermeture des cinq tables de référence laissées ouvertes
--
-- CE QUE CETTE MIGRATION CORRIGE
--
-- Cinq tables de référence ont été créées sans RLS et ont reçu, par le défaut
-- Supabase appliqué à toute table du schéma `public`, la totalité des droits
-- DML pour `anon` et `authenticated` — INSERT, UPDATE, DELETE et TRUNCATE
-- compris. La clé anon vit dans le bundle du navigateur : n'importe qui
-- pouvait donc vider `mel_communes` et faire perdre à tous les événements MEL
-- suivants leur commune et leur normalisation de ville.
--
-- Aucun écran, aucune route `autour/api/*`, aucun module client ne lit ces
-- tables directement. Tous les accès réels passent par des fonctions SQL, et
-- ces fonctions sont exécutées soit par `service_role` (synchronisation
-- territoriale, cron), soit par `postgres` (migrations, et le déclencheur
-- SECURITY DEFINER `projeter_publication_en_evenement` quand une personne
-- publie). Ces deux rôles sont BYPASSRLS : leur donner la RLS ne leur retire
-- rien.
--
-- L'EXCEPTION QUI JUSTIFIE LA SEULE POLICY DE CE FICHIER
--
-- `public.evenements_contexte()` est SECURITY INVOKER, exposée à `anon`, et
-- appelée par le navigateur (`autour/app.js`). Elle joint DEUX FOIS
-- `evenements_majeurs`. Activer la RLS sans policy de lecture ne lèverait
-- aucune erreur : la fonction rendrait zéro ligne, et le contexte territorial
-- — le bandeau Braderie, `major_event_nom`, les fiches associées —
-- disparaîtrait en silence. D'où une policy SELECT explicite, et elle seule.
--
-- LES RPC QUE PERSONNE N'APPELLE
--
-- Quatre fonctions portent `EXECUTE` pour `anon` : aucune n'est appelée par
-- un client. `openagenda_sonder` est la plus coûteuse à laisser ouverte : elle
-- boucle sur un tableau fourni par l'appelant et lance un `net.http_get` par
-- entrée. Exposée en `POST /rest/v1/rpc/openagenda_sonder`, c'est un émetteur
-- de requêtes sortantes gratuit pour qui lit la clé anon.
--
-- Le privilège vient ici de DEUX sources : le grant nominatif à `anon` et
-- `authenticated`, ET le grant implicite à `PUBLIC` que Postgres pose sur
-- toute fonction créée (`=X/postgres` dans l'ACL). Révoquer sur les deux rôles
-- seulement laisserait `has_function_privilege('anon', …, 'EXECUTE')` à vrai.
-- On révoque donc aussi sur `PUBLIC`, puis on rend explicitement `EXECUTE` à
-- `service_role` — `postgres` le garde par propriété.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. Les quatre tables sans aucun lecteur public
--
--    `mel_communes`         lue par le déclencheur events_avant_ecriture()
--    `lieux_majeurs`        lue par evenement_est_majeur(), même chemin
--    `openagenda_candidats` inventaire d'outillage, hors ligne de service
--    `interets_tags`        miroir documentaire de INTEREST_MATCHING, lu par
--                           personne — l'écran reste servi par le fichier JS
--
--    Pas de policy : les seuls lecteurs réels sont BYPASSRLS. La RLS est ici
--    le garde-fou qui rattrapera un futur grant trop large.
-- ===========================================================================

revoke all privileges on public.mel_communes         from anon, authenticated;
revoke all privileges on public.lieux_majeurs        from anon, authenticated;
revoke all privileges on public.openagenda_candidats from anon, authenticated;
revoke all privileges on public.interets_tags        from anon, authenticated;

alter table public.mel_communes         enable row level security;
alter table public.lieux_majeurs        enable row level security;
alter table public.openagenda_candidats enable row level security;
alter table public.interets_tags        enable row level security;


-- ===========================================================================
-- 2. `evenements_majeurs` — lecture publique conservée, écriture fermée
--
--    Sept lignes de référence éditoriale, déjà rendues au client par
--    `evenements_contexte()` sous les noms `major_event_nom` et
--    `major_event_motif`. Les publier en lecture ne révèle donc rien de plus
--    que ce que l'écran affiche déjà.
-- ===========================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.evenements_majeurs from anon, authenticated;

grant select on public.evenements_majeurs to anon, authenticated;

alter table public.evenements_majeurs enable row level security;

drop policy if exists "rendez-vous majeurs: lecture publique"
  on public.evenements_majeurs;
create policy "rendez-vous majeurs: lecture publique"
  on public.evenements_majeurs for select to anon, authenticated
  using (true);


-- ===========================================================================
-- 3. Les RPC sans appelant client
--
--    Signatures relevées dans `pg_proc` avant écriture, pas devinées :
--      openagenda_sonder(text[])
--      openagenda_recolter()
--      evenement_est_majeur(text, text, text[])
--      rapprocher_doublons(timestamp with time zone)
--
--    `evenement_est_majeur` reste appelée DEPUIS le corps de
--    `events_avant_ecriture()`. Ce corps s'exécute sous `postgres` ou
--    `service_role`, qui conservent tous deux EXECUTE : le déclencheur n'est
--    pas touché.
-- ===========================================================================

revoke execute on function public.openagenda_sonder(text[])
  from public, anon, authenticated;
revoke execute on function public.openagenda_recolter()
  from public, anon, authenticated;
revoke execute on function public.evenement_est_majeur(text, text, text[])
  from public, anon, authenticated;
revoke execute on function public.rapprocher_doublons(timestamp with time zone)
  from public, anon, authenticated;

grant execute on function public.openagenda_sonder(text[])                   to service_role;
grant execute on function public.openagenda_recolter()                       to service_role;
grant execute on function public.evenement_est_majeur(text, text, text[])    to service_role;
grant execute on function public.rapprocher_doublons(timestamp with time zone) to service_role;
