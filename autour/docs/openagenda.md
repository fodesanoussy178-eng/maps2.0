# Événements institutionnels par territoire

Autour synchronise les événements côté serveur, une fois par territoire. La
position d’un visiteur sert uniquement à résoudre une zone de proximité et à
lire la couche canonique ; elle ne déclenche jamais une synchronisation par
utilisateur.

## Registres

`territories` décrit les zones mutualisées : centre, rayon réel de service,
groupe territorial, fuseau, état et dernière synchronisation. Les six zones
initiales sont Tourcoing, Roubaix, Lille, Paris, Rouen et Angers. Les rayons se
recouvrent volontairement, notamment dans la Métropole Européenne de Lille :
les frontières communales ne filtrent pas un événement réellement proche.

`territory_sources` contient les sources institutionnelles validées. Les
agendas OpenAgenda actifs sont :

| Territoire | Agenda | `agendaUID` |
| --- | --- | --- |
| Lille | Ville de Lille | `57621068` |
| Tourcoing | Agenda culturel tourquennois | `32344838` |
| Roubaix | Ville de Roubaix | `9977986` |
| Rouen | Métropole Rouen Normandie | `11362982` |
| Paris | Décider pour Paris | `52870970` |
| Angers | non configuré : aucun agenda générique officiel validé | — |

DATAtourisme est inscrit comme source préparée et inactive dans ce registre.
Son pipeline de production existant n’est ni déplacé ni modifié.

Une position inconnue dans la zone France crée au plus un candidat inactif par
maille géographique. Elle conserve le rayon de lecture historique et ne lance
ni recherche web, ni scraping, ni activation de source.

## Connecteur OpenAgenda

L’Edge Function `supabase/functions/sync-openagenda` lit exclusivement les
sources actives du registre et accepte trois modes explicites, protégés par
`x-sync-secret` :

- `?mode=test` conserve le témoin Lille sur l’événement `78801027` ;
- `?mode=sync&territory=<slug>` synchronise une source enregistrée ;
- `?mode=orchestrate` traite toutes les sources OpenAgenda actives avec une
  concurrence maximale de deux sources.

La fenêtre est glissante sur 30 jours et demande les événements `current` et
`upcoming`. La pagination `after`, les occurrences multiples, la normalisation
temporelle, la déduplication et les upserts canoniques restent communs à toutes
les villes. Chaque passage est journalisé dans `event_sync_runs` avec le
territoire et `territory_source_id` ; le registre conserve les dates de succès
ou d’échec.

Le navigateur n’appelle jamais OpenAgenda. Il résout silencieusement le
territoire puis continue d’interroger `evenements_proches`, dont la signature et
l’ordre temporel existants sont conservés. La requête applique désormais le
rayon du territoire avec PostGIS.

## Secrets

Configurer dans **Supabase → Edge Functions → Secrets** :

```text
OPENAGENDA_API_KEY=...
EVENT_SYNC_SECRET=...
```

Le scheduler lit la valeur homologue `event_sync_secret` dans Vault au moment
de l’appel. Les valeurs ne doivent jamais être copiées dans le dépôt. Les clés
Supabase de serveur sont fournies automatiquement à l’Edge Function.

## Scheduler unique

La migration `20260820112353_territorial_event_orchestrator.sql` remplace le
job Lille par un seul job générique :

```text
event-territory-sync-every-3-hours
0 */3 * * *
```

Le cron Supabase s’exécute en UTC à 00:00, 03:00, 06:00, 09:00, 12:00, 15:00,
18:00 et 21:00. Il appelle `private.invoke_event_territory_sync()`, qui lit le
secret Vault et transmet uniquement `mode=orchestrate` à l’Edge Function. Il
n’existe aucun cron par ville.
