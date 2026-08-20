# OpenAgenda — Ville de Lille

La source officielle retenue est l’agenda **Ville de Lille** :

- slug : `ville-de-lille`
- `agendaUID` : `57621068`
- URL publique : `https://openagenda.com/fr/ville-de-lille`
- API : `https://api.openagenda.com/v2/agendas/57621068/events`

Le connecteur serveur est `supabase/functions/sync-openagenda`. Il refuse tout
mode implicite et expose deux opérations protégées par `x-sync-secret` :

- `?mode=test` conserve le contrôle ciblé de l’événement `78801027` ;
- `?mode=sync&territory=lille` synchronise l’agenda complet dans une fenêtre
  glissante de 30 jours, couvrant au minimum le 13 septembre 2026.

Chaque timing OpenAgenda reste une occurrence distincte. Les événements et
occurrences sont écrits par upsert afin qu’une synchronisation répétée soit
idempotente.

## Secrets

Configurer dans **Supabase → Edge Functions → Secrets** :

```text
OPENAGENDA_API_KEY=...
EVENT_SYNC_SECRET=...
```

`SUPABASE_URL` et `SUPABASE_SECRET_KEYS` sont fournis automatiquement par
Supabase. En local, utiliser un fichier non versionné chargé par
`supabase functions serve --env-file ...`.

La clé OpenAgenda est lue uniquement par `Deno.env` dans l’Edge Function, et
envoyée à l’API dans un en-tête serveur. Elle n’est jamais préfixée
`NEXT_PUBLIC_` et aucun composant frontend ne connaît cette route fournisseur.

## Scheduler

La migration `20260820101602_openagenda_lille_scheduler.sql` active `pg_cron`
et `pg_net`, puis crée le job :

```text
openagenda-lille-sync-every-3-hours
0 */3 * * *
```

Le scheduler Supabase fonctionne ici en GMT/UTC : le job part donc à 00:00,
03:00, 06:00, 09:00, 12:00, 15:00, 18:00 et 21:00 UTC.

Le secret Edge Function et le secret Vault sont deux stockages distincts. Le
job lit uniquement `event_sync_secret` dans Vault au moment de l’appel. Tant
que ce secret manque, `private.invoke_openagenda_lille_sync()` renvoie `NULL`
et n’émet aucune requête HTTP.

Pour activer les appels, ouvrir le SQL Editor Supabase et enregistrer dans
Vault la même valeur que `EVENT_SYNC_SECRET`, sans la committer :

```sql
select vault.create_secret(
  '<même valeur que EVENT_SYNC_SECRET>',
  'event_sync_secret',
  'Authentification du cron OpenAgenda Lille'
);
```

Le job déjà planifié utilisera automatiquement cette valeur à sa prochaine
échéance. La valeur ne doit jamais être copiée dans un fichier du dépôt.
