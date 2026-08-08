-- ---------------------------------------------------------------------------
-- Privilèges : ramener anon et authenticated à ce que les policies autorisent
--
-- Constat fait après application des quatre migrations précédentes, en lisant
-- information_schema.role_table_grants : anon et authenticated détenaient
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE et UPDATE sur TOUTES
-- les tables de public — y compris celles où la migration ne voulait accorder
-- qu'une lecture.
--
-- Ce n'est pas une erreur des migrations : Supabase pose des privilèges par
-- défaut sur le schéma public (`alter default privileges … grant all on tables
-- to anon, authenticated`). Un `grant select, insert, delete` n'enlève donc
-- rien — il ajoute à un ensemble déjà complet. Seul un revoke explicite
-- resserre.
--
-- La RLS faisait tenir l'essentiel : sans policy UPDATE, un UPDATE ne touche
-- aucune ligne, et c'est vérifié. Restent deux trous que la RLS ne bouche pas :
--
--   · TRUNCATE ignore la RLS par construction. Accordé à anon sur
--     public.publications, il permettait d'effacer la table entière ;
--   · un UPDATE/DELETE sans policy renvoie « 0 ligne » au lieu d'un refus,
--     ce qui masque une erreur d'appel côté client.
--
-- On ramène donc chaque rôle à ce que ses policies décrivent, table par table.
-- Aucune policy n'est modifiée : ce fichier ne fait que retirer des privilèges
-- que l'application n'utilise pas.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Favoris : on pose ou on retire un favori, on ne le modifie pas. C'était déjà
-- l'intention (aucune policy UPDATE) ; elle devient aussi un privilège.
-- ---------------------------------------------------------------------------
revoke all on public.favoris from anon;
revoke all on public.favoris from authenticated;
grant select, insert, delete on public.favoris to authenticated;

-- ---------------------------------------------------------------------------
-- Canaux d'événement
--   · event_channels    : lecture pour tous, écriture par déclencheur seul
--   · event_participants: chacun gère sa propre participation ; anon rien
--   · event_messages    : lecture pour tous, insertion réservée à l'admin
-- ---------------------------------------------------------------------------
revoke all on public.event_channels from anon, authenticated;
grant select on public.event_channels to anon, authenticated;

revoke all on public.event_participants from anon, authenticated;
grant select, insert, update, delete on public.event_participants to authenticated;

revoke all on public.event_messages from anon, authenticated;
grant select on public.event_messages to anon, authenticated;
grant insert on public.event_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue mobilité : lecture seule. Les écritures passent exclusivement par
-- la clé de service, donc par l'Edge Function.
-- ---------------------------------------------------------------------------
revoke all on public.mobility_datasets from anon, authenticated;
grant select on public.mobility_datasets to anon, authenticated;

revoke all on public.mobility_coverage from anon, authenticated;
grant select on public.mobility_coverage to anon, authenticated;

revoke all on public.mobility_sync_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publications : table antérieure à ces migrations, laissée telle quelle
-- jusqu'ici. Ses policies disent déjà qui fait quoi — lecture publique,
-- écriture réservée à l'auteur. Les privilèges les rejoignent enfin.
-- anon ne lisait déjà rien d'autre : aucune régression possible côté client,
-- qui s'authentifie en anonyme et porte donc le rôle `authenticated`.
-- ---------------------------------------------------------------------------
revoke all on public.publications from anon, authenticated;
grant select on public.publications to anon, authenticated;
grant insert, update, delete on public.publications to authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions de déclencheur : elles n'ont rien à faire dans l'API REST.
--
-- Signalées par le linter Supabase (0028/0029) : exposées en SECURITY DEFINER
-- sur /rest/v1/rpc/. Les appeler directement échoue — PostgreSQL refuse
-- d'exécuter une fonction trigger hors déclencheur — mais une fonction
-- SECURITY DEFINER ne doit pas être joignable de l'extérieur, point.
--
-- Retirer EXECUTE ne désarme pas les déclencheurs : le privilège est vérifié
-- à la création du trigger, pas à chaque déclenchement.
-- ---------------------------------------------------------------------------
revoke all on function public.creer_canal_evenement() from public, anon, authenticated;
revoke all on function public.journaliser_modification_evenement() from public, anon, authenticated;
revoke all on function public.mobility_touch_updated_at() from public, anon, authenticated;

-- mes_canaux() lit ce que le visiteur a en propre : sans session, auth.uid()
-- est nul et la fonction ne renvoie rien. Elle reste néanmoins réservée aux
-- sessions authentifiées, comme annoncé dans sa migration.
revoke all on function public.mes_canaux() from public, anon;
grant execute on function public.mes_canaux() to authenticated;
