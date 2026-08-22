# Le contexte territorial temporaire

## Ce qu'on veut

Pendant une manifestation majeure qui transforme temporairement une ville,
Autour doit comprendre que **l'environnement autour de la personne a
temporairement changé**. Le mantra ne bouge pas :

```
QUOI + QUAND + OÙ
```

```
🧺 BRADERIE

Brocante vinyles          Maintenant · jusqu’à 18h        4 min
Animation de rue          Commence à 15h                  7 min
Moules-frites             Ouvert maintenant               9 min

UTILE AUTOUR DE TOI

🚻 Toilettes · 5 min   🚇 Métro · 3 min   ❤️ Point d’aide · 8 min
```

À 02 h 30, le même écran répond tout autre chose. Le lundi suivant, il
n'existe plus, et Autour redevient exactement le produit normal.

## La règle absolue

Pas de deuxième carte, pas de deuxième moteur de recommandation, pas de
deuxième système d'événements. Le mode est **une couche de contexte appliquée
au moteur existant**, et rien d'autre.

| ce qui est réutilisé | ce qui est ajouté |
|---|---|
| la carte, `maintenant.js`, `temporel.js`, le classement de `core.js` | `territoire.js` : phases, zones, seuils, signaux |
| `events` / `event_occurrences`, OpenAgenda, DATAtourisme, OSM | `territorial_contexts` / `territorial_context_zones` : une **configuration**, pas un catalogue |
| Aide, la recherche, les images, `enrichir-lieu`, le cache et la provenance | un bouton, une ligne de contexte, un bloc de services |

La Braderie de Lille est le **premier cas**, pas une exception codée. Aucun
identifiant, aucune chaîne de caractères du programme ne la nomme : elle vit
dans une ligne de `territorial_contexts`. La Fête de la Musique, un carnaval,
un festival, un marché de Noël, un marathon s'ajouteront par un `INSERT`.

## Les trois états du bouton

Il se pose à côté de `⚡ Maintenant`, dans les entrées rapides — le langage
visuel actuel, pas un thème.

| phase | condition | bouton |
|---|---|---|
| `absent` | avant `preview_starts_at` | — |
| `avant` | `preview_starts_at` ≤ maintenant < `starts_at` | `🧺 Braderie · bientôt` |
| `pendant` | `starts_at` ≤ maintenant < `ends_at` | `🧺 Braderie` |
| `apres` | `ends_at` ≤ maintenant | — |

La disparition est **automatique**. Aucun code n'est à retirer après le
week-end : `ends_at` est une donnée, la politique RLS la lit, et hors fenêtre
la table est muette — le bouton ne peut même pas être fabriqué depuis le
navigateur.

## Recalculer n'est pas resynchroniser

C'est la distinction qui décide si le mode tient la charge le jour où cent
mille personnes sont au même endroit.

| | ce que c'est | ce qui le déclenche |
|---|---|---|
| **recalculer** | distance, temps d'accès, classement, depuis ce qu'on a déjà. Aucune requête. | ouverture du mode ; déplacement ≥ 400 m ; changement de zone ; centre de carte ≥ 400 m ; information temporelle expirée ; retour au premier plan après ≥ 5 min |
| **resynchroniser** | rappeler OpenAgenda, DATAtourisme, Overpass, le modèle | **uniquement** l'âge des données, nature par nature |

Un GPS qui varie de huit mètres ne déclenche rien. Un pas de quatre cents
mètres recalcule et ne resynchronise pas.

## Le cache suit la nature de l'information

| nature | exemples | TTL | priorité de rafraîchissement |
|---|---|---|---|
| `perimetre` | zones, rues, emprise officielle | 7 j | 3 |
| `equipements` | toilettes fixes, stations, permanents | 24 h | 2 |
| `programme` | stands, animations annoncées, restauration | 30 min | 1 |
| `temporel` | en cours, commence, se termine, annulation | 2 min | **0** |

La fraîcheur est **priorisée**, pas uniforme : ce qui est périssable se
rafraîchit d'abord, le reste attend.

## Qui a le droit d'affirmer quoi

```
source officielle de la manifestation
> institution publique (Ville, métropole)
> organisateur officiel
> agenda officiel (OpenAgenda de la collectivité)
> DATAtourisme
> OpenStreetMap
> source tierce
```

Une source tierce, **seule**, ne peut jamais provoquer une bascule qui déplace
quelqu'un : `inconnu → ouvert maintenant`, `ouvert → fermé`, `ouvert →
définitivement fermé`. Il faut une source autorisée, ou deux sources
indépendantes qui concordent.

> Le trou qui existait : côté serveur, seule la fermeture **définitive** était
> retirée quand la provenance ne suffisait pas. Un agrégateur pouvait donc
> encore écrire `current_status: "open"` — et « open » est précisément le mot
> qui fait entrer dans « Maintenant » un lieu dont Autour ne connaît aucun
> horaire. Corrigé dans `construireFait` : plus aucun statut affirmé ne
> survit à une provenance insuffisante.

## Le contexte n'est pas un score

`territoire.js` rend des **points**, qui s'ajoutent au score existant de
`rankResults` — comme la saison. Il n'y a pas de second classement.

```
+ événement officiellement lié      60      borné à 250 au total
+ dans une zone déclarée            40
+ en cours                          90
+ commence dans < 30 min            70
+ se termine bientôt                25
+ activité temporaire du contexte   35
+ lieu pertinent ouvert             20
+ service contextuel utile          10
```

Ce que ces points **ne peuvent pas** faire : le tri regarde d'abord la
faisabilité, puis la fenêtre temporelle. Un événement terminé, un lieu fermé,
un résultat hors sujet ne remontent jamais. Et le lien au contexte se lit dans
la **provenance** et la **géographie**, jamais dans le titre — un bonus au mot
ferait remonter une friterie qui porte le nom de la manifestation.

## Ce qui ne change pas de nature

| objet | ce qu'il reste |
|---|---|
| vide-grenier, concert, animation, exposition temporaire | un **événement** |
| restaurant, commerce | un **lieu** |
| toilettes, métro | un **service** |
| poste de secours, point d'accueil, espace de repos | une **aide**, dans le système Aide existant |

Le contexte change leur **pertinence**, pas leur nature. Il n'y a pas d'« Aide
Braderie » : les structures temporaires remontent dans l'Aide d'Autour, par la
même ontologie de besoins et les mêmes règles de classement.

## Le modèle n'est jamais indispensable

Sans clé, sans quota, sans réseau vers lui, le mode fonctionne : événements
canoniques, sources officielles, OpenAgenda, DATAtourisme, OSM, cache.

Quatre portes ferment l'appel, dans cet ordre :

1. **budget épuisé** — plus rien ne part ;
2. **cache encore frais** ;
3. **rien ne manque** (recalculé *après* que le calque a rempli ce qu'il
   pouvait) ;
4. **une source officielle répond déjà**.

### Le budget est réservé, pas compté après coup

L'ancien compteur lisait les lignes écrites dans `place_enrichments` depuis
minuit. Trois façons de ne rien borner :

- un appel qui **échoue** n'écrit rien, donc ne comptait pas ;
- un appel qui **ne trouve rien** pour un lieu connu réécrit la même ligne ;
- lire puis décider n'est pas atomique — dix requêtes lisaient toutes « 399 ».

```
réserver 1 appel  (public.reserver_enrichissement, un seul UPDATE conditionnel)
↓
budget disponible → Gemini
plafond atteint   → aucun appel
```

`enrichment_usage_daily(day, requested, launched, successful, failed)`. Ce qui
est réservé est consommé : un appel qui ne trouve rien compte, un appel qui
échoue compte. Le budget ne se rend jamais.

## Les visiteurs non connectés

`enrichir-lieu` garde `verify_jwt = true`, et **on n'y touche pas**. Un
visiteur sans compte :

- utilise le mode **intégralement** ;
- lit `place_enrichments`, qui est public, donc bénéficie de tout ce qui est
  déjà en cache ;
- ne déclenche simplement aucune vérification neuve.

Pour que l'essentiel soit déjà vérifié avant l'arrivée des visiteurs, le
préchauffage est un travail **de serveur** : `private.prechauffer_contexte`
présente la clé du Vault. Aucun secret ne descend dans la page, aucune garde
n'est désactivée.

> **Aucun cron n'est planifié.** Le préchauffage dépense du budget : le
> déclencher est une décision d'exploitation.
> `select private.prechauffer_contexte('braderie-lille-2026', 25);`

## Préparer en amont

```
charger les sources officielles
↓ normaliser les zones
↓ synchroniser les événements
↓ résoudre les doublons
↓ mettre les images en cache
↓ identifier les lieux critiques à horaires inconnus
↓ enrichir uniquement ces rares lieux
```

Le jour J doit être du **classement**, pas de la collecte.

## Ce qu'on mesure

Des compteurs, et rien d'autre. Aucune phrase saisie dans Aide, aucun
identifiant, aucune position — et ce n'est pas une intention : `territoire.js`
refuse tout nom hors de sa liste gelée, et `compter_metrique_territoriale`
refuse une seconde fois.

```
territorial_mode_opened              territorial_cache_hit
territorial_zone_changed             territorial_cache_miss
territorial_recompute                territorial_results_count
territorial_gemini_requested         territorial_gemini_skipped_fresh_data
territorial_gemini_budget_blocked
```

`territorial_metrics_daily(day, context_slug, zone_slug, metric, valeur)`.
Le `zone_slug` est un slug de configuration — `wazemmes` — pas une position.

## La santé des sources

`public.sante_sources_evenements()` rend, par source et par territoire : le
dernier succès, le dernier échec, l'âge du succès, les compteurs sur sept
jours. Privée, comme le journal dont elle est tirée.

Une donnée vieille reste utilisable selon sa nature ; ce qui n'est pas
acceptable, c'est qu'Autour ignore son âge.

## Où c'est

| fichier | rôle |
|---|---|
| `territoire.js` | toute la logique : phases, zones, seuils, TTL, provenance, signaux, services, portes du modèle, compteurs. Ne connaît ni le DOM, ni la carte, ni aucune manifestation. |
| `app.js` | le câblage : lire la configuration, savoir où l'on regarde, décider quand réévaluer, dessiner |
| `core.js` | `ctx.territorial` → des points de plus dans le même score |
| `supabase/migrations/20260822090000_contexte_territorial_temporaire.sql` | la configuration, le budget, les compteurs, la santé, le préchauffage |
| `tests/territoire.test.mjs` | activation, géographie, temps, provenance, modèle, déduplication, régression |
