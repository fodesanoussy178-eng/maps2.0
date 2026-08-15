# La couche événement canonique

## Le problème qu'elle résout

Autour doit répondre à quatre questions, et la deuxième est la plus fragile :

1. Qu'est-ce qu'il y a autour de moi ?
2. **Qu'est-ce qui se passe réellement maintenant ?**
3. Comment j'y vais ?
4. De quelle aide cette personne a réellement besoin ?

Avant cette couche, « maintenant » était une conclusion tirée dans le
navigateur, à partir de dates qui arrivaient sous cinq formes différentes.
Trois défauts en découlaient, et ils avaient tous le même coût — quelqu'un se
déplace pour rien :

- un événement sans heure de fin restait « en cours » indéfiniment ;
- une période en journées (« du 10 au 15 août ») devenait « Maintenant » à
  quatre heures du matin ;
- chaque appelant — la carte, le carousel, une future notification — pouvait
  conclure autrement, sans qu'aucune erreur ne le signale.

## La règle, et elle est en base

Un événement est `now` **si et seulement si** :

```sql
start_at <= NOW() AND end_at >= NOW()
AND date_confidence = 'exact'
AND NOT cancelled
```

Tout le reste en est exclu, sans exception :

| Situation | Statut |
|---|---|
| début et fin horodatés, en cours, non annulé | `now` |
| commence dans moins de 24 h | `soon` |
| commence plus tard | `upcoming` |
| fin dépassée | `past` |
| annulé pendant sa fenêtre | `past` |
| pas de début | `unknown_date` |
| commencé mais **sans fin** | `unknown_date` |
| journée connue, heure inconnue, dans la fenêtre | `unknown_date` |

**Aucune heure de fin n'est inventée pour faire entrer un événement dans
`now`.** C'est la contrainte qui a dicté toutes les autres. Un festival dont
la source ne publie que des journées est enregistré tel quel, avec
`date_confidence = 'day'`, et il est annoncé « Date à vérifier » plutôt que
« Maintenant ». L'information n'est pas perdue, elle est qualifiée.

La fonction qui tranche est `public.event_temporal_status()`. La RPC de
lecture la rappelle **à chaque requête** : le statut servi n'est jamais celui
de la dernière synchronisation.

### La fenêtre « soon » a un seul domicile

`public.event_soon_window()`, qui lit `event_settings`. Pas une constante dans
un fichier JavaScript, pas un nombre répété dans trois requêtes. Elle vaut
24 heures et se change par un `UPDATE`.

Elle est `SECURITY DEFINER` à dessein : en `SECURITY INVOKER`, elle lirait
`event_settings` sous la RLS de l'appelant, qui n'y a pas accès. Le `coalesce`
retomberait alors sur 24 h et le réglage serait sans effet pour les visiteurs
tout en paraissant configurable.

## Les tables

```
event_areas     zones de synchronisation — des données, pas des règles
events          l'événement canonique, une ligne par événement réel
event_sources   ses provenances — UNIQUE(source, external_id)
event_sync_runs le journal des courses
event_settings  les réglages du moteur temporel
```

`publications` **n'est pas** devenue une table d'import. Elle reste ce que les
habitants publient, avec ses quotas, sa propriété et ses canaux. Un
déclencheur la projette dans `events` via `publication_id`, dans ce sens
uniquement.

La RPC `evenements_proches()` **exclut les publications par défaut** : elles
continuent d'arriver par `publications_proches`, qui porte la propriété, les
places et le prix. Les demander des deux côtés afficherait deux fois le même
événement.

## Aucune ville n'est une règle

Il n'existe nulle part de `if (city === "Lille")`. Une ville est une ligne de
`event_areas` :

```sql
insert into public.event_areas (code, name, min_lat, min_lng, max_lat, max_lng, insee_codes)
values ('rennes', 'Rennes Métropole', 48.06, -1.75, 48.16, -1.60, array['35238']);
```

La synchronisation itère sur cette table et applique `syncArea(zone)`. Elle ne
sait pas laquelle est Lille. Ouvrir une ville, c'est un `INSERT` ; la fermer,
c'est `enabled = false`.

Les six zones ouvertes : `lille`, `paris`, `lyon`, `marseille`, `bordeaux`,
`toulouse`.

## Le sens de la flèche

```
DATAtourisme
      ↓            (serveur, à froid, sur un rythme choisi)
sync-datatourisme
      ↓            normalisation · dates · déduplication
Supabase / PostGIS
      ↓            evenements_proches()
   interface
```

Et **pas** :

```
ouverture d'Autour → appel DATAtourisme → attente réseau → interface
```

Conséquence directe : DATAtourisme peut tomber, Autour continue de servir ce
qu'il a. Le journal dit depuis quand.

## Déduplication

Trois niveaux, du plus sûr au plus prudent :

1. **`source + external_id`** — contrainte `UNIQUE` sur `event_sources`. Aucune
   heuristique, aucun doute.
2. **`dedup_key`** — titre normalisé + coordonnées à ~100 m + début à l'heure
   près, index unique en base. La clé est calculée des deux côtés
   (`event_dedup_key` en SQL, `cleDedup` en JS) et les deux implémentations
   doivent rendre exactement la même chaîne — y compris sur les longitudes
   négatives, où `round()` de PostgreSQL et `Math.round` de JavaScript
   divergent. Un test le vérifie.
3. **Rapprochement souple** — titre très proche **et** coordonnées proches
   **et** horaires proches. Les trois ensemble, jamais une seule.

**Le doute profite à la séparation.** Deux concerts différents dans la même
salle le même soir restent deux événements ; les fondre ferait disparaître
celui que quelqu'un cherchait. On ne rapproche jamais sur la seule proximité
géographique.

## Exploiter la synchronisation

### Déployer la fonction

```bash
supabase functions deploy sync-datatourisme --project-ref <ref> --no-verify-jwt
```

`--no-verify-jwt` n'est pas un relâchement : la fonction porte sa PROPRE
authentification, le secret partagé `x-sync-secret`, vérifié avant toute autre
chose. Laisser la vérification de JWT active obligerait l'appelant à détenir en
plus une clé Supabase — c'est-à-dire à donner à GitHub un accès à la base pour
lui permettre de demander un import. Les deux questions sont distinctes : QUI a
le droit d'appeler, et AVEC QUOI on écrit.

Variables d'environnement de la fonction :

| Nom | Rôle |
|---|---|
| `DATATOURISME_API_KEY` | clé du catalogue — ne quitte jamais le serveur |
| `EVENT_SYNC_SECRET` | secret partagé exigé à l'appel |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` | fournis par la plateforme, rien à configurer |

`SUPABASE_SECRET_KEYS` est un dictionnaire JSON — `{"default":"sb_secret_…"}` —
et non une chaîne. C'est ce qui permet de faire coexister plusieurs clés
nommées et d'en révoquer une sans invalider les autres, là où `service_role`
dérivait du secret JWT du projet et ne se remplaçait qu'en bloc. La fonction lit
la clé `default`, ou celle que nomme `SUPABASE_SECRET_KEY_NAME` si on veut en
désigner une autre.

### La déclencher

Le travail GitHub `Événements Autour` s'en charge quatre fois par jour, une
tâche par zone. À la main :

```bash
curl -X POST \
  -H "x-sync-secret: $EVENT_SYNC_SECRET" \
  "https://<ref>.supabase.co/functions/v1/sync-datatourisme?area=lille"
```

Sans `?area=`, toutes les zones actives sont traitées.

### Lire le journal

```sql
select scope, status, started_at, duration_ms,
       events_seen, events_inserted, events_updated, events_merged,
       events_rejected, errors
  from public.event_sync_runs
 order by started_at desc limit 20;
```

Un `status = 'partial'` est normal et sain : il signifie qu'au moins un
événement a été refusé sans que la course tombe. `events_rejected` compte les
POI inexploitables — sans identifiant, sans titre, sans coordonnées ou hors
zone. Une zone en `error` n'empêche pas les autres d'aboutir.

### Si pg_cron est un jour activé

`public.rafraichir_statuts_temporels()` rafraîchit le cache
`events.temporal_status` et n'écrit que les lignes qui changent. La fonction
de synchronisation l'appelle déjà en fin de course ; une planification
horaire serait un confort, pas une nécessité — la RPC de lecture recalcule le
statut de toute façon.

## Ce qui reste au navigateur

`temporel.js` n'a pas disparu et ne doit pas disparaître : il reste
l'autorité pour les **lieux permanents**, dont la disponibilité se lit dans
les horaires d'ouverture et non dans une période.

Pour les événements canoniques, il **traduit** au lieu de recalculer :

| Statut base | Statut interface |
|---|---|
| `now` | en cours |
| `past` | terminé |
| `unknown_date` | date à vérifier |
| `soon` / `upcoming` | rangé par la date locale : ce soir, ce week-end, à venir |

Un événement canonique n'est **jamais** « imminent » : `estMaintenant()` ne
peut être vrai que si la base a dit `now`. La fenêtre d'imminence de deux
heures reste une notion locale, réservée à ce qui ne vient pas de la base.
