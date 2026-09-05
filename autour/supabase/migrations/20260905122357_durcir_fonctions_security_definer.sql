-- ---------------------------------------------------------------------------
-- Les quatre fonctions SECURITY DEFINER restantes, auditées une par une
--
-- L'advisor Supabase les signalait toutes les quatre comme « appelables par
-- anon en SECURITY DEFINER ». Le signalement est mécanique : il ne dit pas si
-- l'exposition est nécessaire. L'audit dit qu'elle l'est pour trois d'entre
-- elles, et pas pour la quatrième. Deux seulement sont donc touchées ici.
--
--
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI
--
-- `compter_metrique_territoriale(text, text, integer, text)`
--   Appelée par le client (app.js). Déjà SECURITY DEFINER + search_path = ''.
--   Elle écrit dans `territorial_metrics_daily`, et l'écriture est bornée par
--   trois gardes vérifiées en base : liste fermée de métriques, `slug` contraint
--   par expression régulière, existence du contexte exigée, et `p_valeur`
--   ramenée dans [1, 1000]. Mesuré : métrique hors liste -> aucune ligne ;
--   contexte inconnu -> aucune ligne ; valeur 999999 -> 1000. Rien à changer.
--
-- `resoudre_territoire(double precision, double precision, text)`
--   Appelée par le client (app.js) pour situer le visiteur. Déjà SECURITY
--   DEFINER + search_path = ''. Elle écrit dans `territories`, mais l'écriture
--   n'est pas arbitraire : le `slug` dérive d'un md5 de coordonnées arrondies,
--   le nom est nettoyé de ses caractères de contrôle et tronqué à 120, le
--   statut est forcé à `discovered`/`active = false`, et rien n'est écrit hors
--   de l'emprise France. Rien à changer ici — voir le risque résiduel signalé
--   au rapport, qui relève du produit et non des droits.
--
--
-- CE QUI EST TOUCHÉ
--
-- `event_soon_window()` — RESTE PUBLIQUE, ET C'EST OBLIGATOIRE.
--   Le client ne l'appelle jamais directement, ce qui donnait envie de la
--   fermer. Ce serait une panne : la chaîne
--     evenements_locaux -> event_temporal_status -> event_soon_window
--   est SECURITY INVOKER de bout en bout. Retirer EXECUTE à `anon` fait tomber
--   l'écran principal sur `42501 permission denied for function
--   event_soon_window`. Vérifié en transaction annulée AVANT d'écrire cette
--   migration, plutôt que déduit.
--   On corrige donc les deux seuls écarts réels : le grant implicite à PUBLIC,
--   et un `search_path` à `public` là où l'exigence posée pour
--   `evenements_contexte()` est `''`. Le corps qualifiait déjà son unique
--   table ; il est inchangé à la lettre près du réglage.
--
-- `projeter_publication_en_evenement()` — N'A JAMAIS EU BESOIN D'ÊTRE PUBLIQUE.
--   C'est une fonction de déclencheur. Deux barrières indépendantes
--   interdisaient déjà l'appel direct : PostgREST n'expose pas les fonctions
--   retournant `trigger`, et PostgreSQL lui-même refuse — vérifié sous `anon` :
--   `0A000 trigger functions can only be called as triggers`. Le grant à PUBLIC
--   était donc inerte, mais il faisait dire à l'ACL le contraire de la vérité.
--   Il part.
--   Le déclencheur continue de fonctionner : PostgreSQL vérifie EXECUTE à la
--   création du déclencheur, pas à chaque déclenchement. Vérifié de bout en
--   bout après coup, sous `authenticated` et avec un vrai jeton : l'insertion
--   d'une publication projette toujours son événement.
--
--   À noter pour plus tard, hors périmètre de ce lot : son `search_path` reste
--   à `public` et son bloc `exception when others` avale toute erreur de
--   projection en simple `raise warning`. Une publication peut donc réussir
--   sans que son événement existe, sans que personne le sache.
-- ---------------------------------------------------------------------------

create or replace function public.event_soon_window()
returns interval
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select valeur::interval from public.event_settings where cle = 'soon_window'),
    interval '24 hours');
$function$;

revoke execute on function public.event_soon_window() from public;
grant  execute on function public.event_soon_window() to anon, authenticated, service_role;

revoke execute on function public.projeter_publication_en_evenement()
  from public, anon, authenticated;
grant  execute on function public.projeter_publication_en_evenement() to service_role;
