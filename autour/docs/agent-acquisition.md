# Agent Acquisition et AGORA

*(Le Control Center de la première mission s'appelle désormais AGORA. Ce
document couvre les deux versions : le socle, puis ce que la V2 y a ajouté.)*

## Ce qui existait déjà, et ce qui manquait vraiment

Avant d'écrire une ligne, l'existant a été inspecté — dépôt et base.

**Ce qui existait**, et qui n'a donc pas été refait :

| Besoin | Ce qui le porte déjà |
|---|---|
| Réveiller du travail de fond | `pg_cron` + `private.invoke_*()` + secret du Vault + `net.http_post` |
| Journal d'exécution | `event_sync_runs`, `place_recoltes`, `offer_collectes`, `mobility_sync_runs` |
| Liste blanche de sources | `territory_sources`, `offer_source_registry` |
| Budget d'appels IA | `enrichment_usage_daily` |
| Appel de modèle | `enrichir-lieu` (Gemini, invite bornée, réponse mise en cache) |
| Authentification | Supabase Auth, lien e-mail, SDK vendorisé `/vendeur/` |

**Ce qui n'existait pas** — vérifié dans le dépôt (`grep`) et dans la base
(`information_schema.tables`) : il n'y avait **ni `tasks`, ni `runs`, ni
`task_permissions`**. Le socle d'automatisation d'Autour sait faire tourner des
synchronisations de catalogues ; il ne savait pas porter une tâche quelconque,
ni dire ce qu'un agent a le droit de faire avant qu'il le fasse.

C'est exactement ce que les quatre tables du socle ajoutent — et rien de plus.
`event_sync_runs` reste le journal des synchronisations : il porte vingt
colonnes qui n'ont de sens que là (pages, occurrences, doublons). `runs` est le
journal des ÉTAPES D'UN AGENT, avec un coût et un modèle. Aucune donnée n'est
écrite deux fois.

## Le socle

```
agents               un agent, sa mission
task_permissions     ce que chaque TYPE de tâche a le droit de faire
tasks                la file de travail
runs                 le journal, une ligne par étape
control_operateurs   qui a accès au Control Center
```

### `contact_externe` est une contrainte, pas un réglage

```sql
contact_externe boolean not null default false check (contact_externe = false)
```

La règle « l'agent ne contacte jamais personne tout seul » ne peut pas vivre
dans le code de la fonction Edge : une ligne de code se change en une minute et
personne ne le voit. Elle vit dans une contrainte de schéma. Pour qu'un agent
puisse un jour envoyer quelque chose, il faudra une migration — une décision
écrite, relue, datée.

Et la fonction Edge n'a de toute façon **aucune** fonction d'envoi. Pas « une
fonction d'envoi désactivée » : aucune.

## L'agent Acquisition

### Les six tâches

| Type | Ce qu'elle fait | Sources autorisées | Coût max |
|---|---|---|---|
| `acquisition_scan_city` | balaie une commune | `autour_events`, `autour_places`, `openagenda_candidats`, `recherche_entreprises` | 0 € |
| `acquisition_find_structures` | recherche ciblée (même moteur) | idem sans les agendas | 0 € |
| `acquisition_qualify` | six critères, chacun justifié | données internes | 0,05 € |
| `acquisition_prepare_contact` | un brouillon en attente de validation | — | 0,05 € |
| `acquisition_review_opportunity` | remet à l'examen humain | — | 0 € |
| `acquisition_followup_analysis` | mesure l'entonnoir | — | 0 € |

Quatre types ajoutés par la V2 :

| Type | Ce qu'elle fait | Sources autorisées | Coût max |
|---|---|---|---|
| `acquisition_find_contact_channel` | cherche la PORTE d'une commune, et crée les structures de l'annuaire qui en ont une | `annuaire_service_public`, `osm_overpass`, `autour_places`, `recherche_entreprises` | 0 € |
| `acquisition_scan_territory` | balaie un territoire déclaré, avec sa mémoire | comme `scan_city` | 0 € |
| `acquisition_scan_incubators` | l'écosystème entrepreneurial, reconnu au nom | `recherche_entreprises` | 0 € |
| `acquisition_scan_international` | un territoire hors de France, OSM seul | `osm_overpass` | 0 € |

Une tâche dont le type n'a pas de ligne dans `task_permissions` **ne peut pas
être créée** : la clé étrangère la refuse.

### Les territoires, et la mémoire

`acquisition_territoires` porte pays, région, ville, langue, portée, statut,
dernière et prochaine recherche, sources disponibles, couverture et confiance.
Un territoire examiné il y a trois jours **ne se rebalaie pas** : `scanTerritory`
lit la ligne avant de lancer deux cents requêtes, et `{"force": true}` passe
outre pour un rejeu délibéré.

La couverture de la France est **progressive et déclarée**, pas un balayage
national : Lille et la MEL, puis Paris, Lyon, Marseille, Toulouse, Bordeaux,
Nantes, Strasbourg, Rennes, Montpellier, Grenoble. Chacune est une ligne, avec
sa propre échéance.

`fr-national` est volontairement **sans coordonnées** : un pays n'a pas de
centre utile pour une requête `around:`. La fonction refuse donc la source OSM
pour ce territoire et le dit, plutôt que d'interroger le point (0, 0).

Un territoire hors de France porte une contrainte en base :

```sql
constraint international_avec_raison
  check (pays = 'FR' or coalesce(btrim(raison_du_test), '') <> '')
```

On ne peut pas déclarer un territoire international sans écrire pourquoi on le
teste. Trois seulement sont déclarés — Bruxelles, Genève, Montréal — parce que
l'international est une expérience, pas une extension.

### L'écosystème entrepreneurial n'est jamais pertinent « parce que »

C'est la consigne la plus facile à trahir sans s'en apercevoir : un agent qui
cherche « incubateur » trouve des incubateurs, les range en pertinents, et rend
une liste qui a l'air excellente alors qu'aucun fait n'a été observé.

Autour montre des SORTIES ; un incubateur n'en produit pas. Le lien possible est
la DIFFUSION — il réunit des porteurs de projets locaux. `raisonPourAutour()`
écrit donc, pour chaque structure, le mécanisme ET son statut :

* **Observé** — la structure programme des rendez-vous publics qu'Autour lit
  déjà ;
* **Hypothèse non vérifiée** — le lien est plausible, rien ne l'atteste.

Une hypothèse non vérifiée ne monte jamais au-dessus de « moyen » en pertinence.

### Le septième critère : facilité de contact

Distinct de l'accessibilité. Celle-ci dit qu'une porte EXISTE ; celui-là ce
qu'il en coûte de la pousser. Écrire à une adresse de fonction prend deux
minutes ; trouver le formulaire enfoui d'un site municipal en prend vingt, et
c'est le temps du fondateur qui est la ressource rare.

### Les sources, et pourquoi celles-là

Les données d'Autour passent avant tout le reste. Une médiathèque qui a
vingt-deux rendez-vous à venir dans `events` n'est pas une piste à vérifier :
c'est une structure locale, active, dont on connaît déjà la programmation et la
source. Aucune requête sortante, aucun coût, aucune condition d'utilisation
tierce.

L'annuaire des entreprises (`recherche-entreprises.api.gouv.fr`, DINUM, ouvert,
sans clé) vient après, pour ce que le premier ne sait pas : les structures qui
n'organisent rien de public. Il ne publie **ni e-mail, ni site, ni téléphone** —
`coordonnees_publiques` reste donc vide pour tout ce qui vient de là, et la
qualification l'écrit.

Ce qui n'est pas dans `sources_autorisees` n'est pas lu, même si le code sait le
faire : ni réseau social, ni plateforme dont les conditions interdisent
l'extraction automatisée, ni annuaire de contacts personnels.

### Pas de note sur 100

Six critères, une ligne chacun, et `pourquoi` est `NOT NULL`. Un critère sans
justification ne s'écrit pas — pas « ne devrait pas » : ne peut pas.

`inconnu` est une réponse. Quand aucun fait observé ne tranche, l'opportunité
part en `a_examiner`. C'est le seul cas où l'agent demande un humain, et c'est
exactement ce qu'il faut.

`cout: faible` veut dire « ça coûte peu » ; `pertinence: faible` veut dire
« peu pertinent ». Le niveau mesure le critère nommé, jamais l'opportunité.

### Les trois refus de la préparation de contact

Un générateur de messages écrit toujours quelque chose : c'est son défaut.
Sommé de personnaliser, il comble les trous, et « nous avons remarqué votre
excellent travail auprès des jeunes » est faux.

`preparerContact` refuse donc, et dit pourquoi :

1. **aucun canal public observé** — rien à préparer tant qu'une page ou une
   adresse n'a pas été trouvée à la main ;
2. **aucun fait à citer** — un message sans phrase personnalisée vraie est du
   publipostage ;
3. **pertinence non établie** — on ne démarche pas « au cas où ».

Un quatrième garde-fou relit le texte final : `verifierInterdits` refuse tout
brouillon contenant un nombre d'utilisateurs, une audience en volume, un
partenariat existant, un superlatif invérifiable, ou une affirmation selon
laquelle l'expéditeur serait une personne.

## AGORA — l'espace privé

`/control`, `/control/acquisition`, `/control/validation`, `/control/journal`.

### On y entre par la recherche publique

Il n'y a aucun lien vers AGORA nulle part dans l'application. On tape **`fodé`**
dans la barre de recherche d'Autour ; le champ se vide, et la page privée
s'ouvre. `app.js` ne contient pour cela qu'une comparaison de chaîne
normalisée — pas de code, pas de secret, rien qui vaille la peine d'être lu
dans le bundle.

### Trois facteurs qui ne se remplacent pas

1. **Authentification** — Supabase Auth, lien e-mail. Elle dit QUI.
2. **Autorisation** — une ligne dans `control_operateurs`. Elle dit qui a le
   DROIT. Elle est distincte de l'authentification, et c'est voulu : être
   connecté à Autour ne donne rien.
3. **Le code AGORA** — un déverrouillage de 12 h, par utilisateur.

Les trois convergent dans `public.est_operateur()`, qui est la seule fonction
que les quinze policies appellent. Ajouter un facteur ne demande donc pas de
toucher aux policies.

### Le code n'est écrit nulle part

Il n'est **ni dans le HTML, ni dans le JavaScript, ni dans le bundle, ni dans
ce dépôt, ni dans une variable d'environnement Supabase ou Vercel, ni dans les
journaux, ni dans aucune réponse d'API.** La base ne stocke qu'un sel aléatoire
de 32 octets et l'empreinte `hmac(code, sel, 'sha256')`, dans le schéma
`private`, qui n'est pas exposé par PostgREST.

`public.agora_ouvrir(p_code)` compare l'empreinte et ne rend jamais ni le code,
ni le sel, ni l'empreinte — seulement vrai ou faux, et la date d'expiration.

Un code court se casse par force brute, pas par cryptanalyse : la vraie défense
est donc le **plafond de cinq échecs par quinze minutes**, appliqué côté base.
C'est écrit en clair dans la migration, parce qu'un compromis qu'on ne
documente pas est un compromis qu'on oublie.

`agora_ouvrir` **refuse les sessions anonymes** avant même de regarder le code.

### Ce que couvrent les tests

| Cas | Attendu | Où |
|---|---|---|
| utilisateur non connecté | refus | `est_operateur()` = faux |
| connecté, non opérateur | refus | pas de ligne `control_operateurs` |
| session anonyme | refus | claim `is_anonymous` |
| opérateur autorisé, code donné | accès | déverrouillage 12 h |
| `/control/*` en accès direct | protégé | la page s'affiche, les données non |
| API du Control Center | protégée | RLS, pas le front |
| `AGORA59` côté client | absent | `grep` sur `app.js`, `control.html`, `control/control.js` |
| élévation de privilèges | impossible | `control_operateurs` non écrivable par l'opérateur |
| action sensible sans validation | impossible | `contact_externe` sous CHECK |

Une **page à part** (`control.html` + `control/control.js`), qui ne partage
aucun octet avec l'application publique en dehors du SDK Supabase vendorisé.
`index.html`, `app.js` et le manifeste de livraison ne sont pas touchés : le
chemin critique mesuré reste à 348,7 ko gzip, exactement comme avant.

La page n'est pas la protection. C'est un fichier statique sur un CDN : tout le
monde peut le télécharger. Il ne montrera rien.

* les tables du socle n'accordent **aucun privilège** à `anon` → `42501
  permission denied` ;
* chaque policy passe par `public.est_operateur()` ;
* `est_operateur()` exige une ligne dans `control_operateurs` **et** refuse les
  sessions anonymes (dans Supabase, une session anonyme porte le rôle
  `authenticated` : `to authenticated` ne suffit pas).

### Ajouter un opérateur

Aucun uid ni aucune adresse n'est écrit dans une migration versionnée. Depuis le
SQL Editor du projet :

```sql
insert into public.control_operateurs (user_id, role)
select id, 'fondateur' from auth.users where email = '<ton e-mail>'
on conflict (user_id) do nothing;
```

## Lancer une recherche

**Depuis le Control Center** — `/control`, section « Lancer une recherche » :
entrer une commune, cliquer. La tâche entre en file.

**Depuis SQL** :

```sql
insert into public.tasks (agent, type, params, origine, demandee_par)
values ('acquisition', 'acquisition_scan_city',
        '{"ville":"Tourcoing","zone_id":"mel"}'::jsonb, 'humain', auth.uid());

select private.invoke_agent_acquisition('work');   -- réveille l'agent
```

### Chercher le canal d'une commune

```sql
insert into public.tasks (agent, type, params, origine, demandee_par)
values ('acquisition', 'acquisition_find_contact_channel',
        '{"ville":"Tourcoing","limite":150}'::jsonb, 'humain', auth.uid());
```

### Balayer un territoire déclaré

```sql
insert into public.tasks (agent, type, params, origine, demandee_par)
values ('acquisition', 'acquisition_scan_territory',
        '{"territoire":"fr-lyon"}'::jsonb, 'humain', auth.uid());
```

`{"force": true}` passe outre la mémoire du territoire.

Aucune planification n'existe (§20) : `private.invoke_agent_acquisition()` est
écrite, elle marche, et **rien ne l'appelle**. Un agent qui se réveille seul
avant que quiconque ait relu ce qu'il produit, c'est une base d'opportunités
fausses qui grossit pendant qu'on dort. Le jour où la qualité du premier lot
aura été jugée :

```sql
select cron.schedule('agent-acquisition-quotidien', '0 5 * * *',
                     $$select private.invoke_agent_acquisition('work')$$);
```

## Chercher la porte — et ce que la mesure a dit

C'était le blocage de la première mission : 247 opportunités qualifiées sur 249
sans aucun moyen de contact. La V2 y consacre un type de tâche entier.

### Ce qui ne marche pas, et pourquoi

L'idée de départ était de rapprocher par le nom les structures qu'Autour
connaît avec les fiches de l'annuaire du service public. **Elle ne marche pas**,
et la mesure du 19 septembre le montre sans ambiguïté :

| Commune | Fiches avec contact | Rapprochées par le nom |
|---|---|---|
| Villeneuve-d'Ascq | 25 | **0** |
| Lille | 96 | **0** |
| Roubaix | 29 | **0** |

Ce n'est pas un défaut de l'algorithme de rapprochement — le premier correctif
(retrait des sigles, inclusion ordonnée à deux mots) n'a rien changé. Les deux
listes décrivent des structures **différentes** :

```
annuaire : Mission locale, CCAS, CIO, Point-justice, Centre information
           jeunesse, Point d'information personnes âgées, Maison de l'emploi…
Autour   : Château de Flers, Musée du Terroir, Cinéma Le Méliès, églises,
           maisons de quartier, fermes pédagogiques…
```

Aucun rapprochement de noms ne fait se rencontrer deux populations disjointes.
Continuer à l'améliorer aurait été du travail dépensé contre un mur.

### Ce qui marche

Ces fiches ne sont pas des déchets : ce sont des structures **dont le métier est
d'orienter des gens vers ce qui existe autour d'eux** — le sujet d'Autour, mot
pour mot — et elles arrivent avec leur porte déjà ouverte.

La tâche crée donc, à partir des fiches que le rapprochement n'a pas
consommées, des opportunités à part entière, canal compris :

| Commune | Structures entrées AVEC leur canal |
|---|---|
| Villeneuve-d'Ascq | 25 |
| Lille | 96 |
| Roubaix | 29 |

Le « 247 sans canal » ne se résout pas seulement en cherchant des portes pour
les structures connues ; il se résout aussi en allant chercher les structures
qui en ont une.

### « Données insuffisantes » ne veut pas dire « source injoignable »

Le premier passage a journalisé, **en succès**, « OpenStreetMap : 0 entités lues
à Villeneuve-d'Ascq » — après 74 secondes. Overpass n'avait pas rendu une liste
vide : il avait rendu **HTTP 200** avec un corps JSON valide contenant

```json
{"remark": "runtime error: Query timed out in \"query\" at line 1 after 33 seconds.",
 "elements": []}
```

Le code ne lisait pas `remark`. Un échec de source était donc raconté comme une
absence de données — exactement le mensonge que la consigne interdit.
`overpass()` lit maintenant `remark`, essaie l'instance suivante, et si les
trois échouent écrit « OpenStreetMap injoignable : … » en `partiel`.

Mesuré ensuite, sur les instances publiques : poignée de main TCP/SSL de 15,1 s,
puis 14,9 s de requête, puis dépassement — deux fois de suite ; un HTTP 504 sur
une troisième. **Le problème n'est pas la requête d'Autour, ce sont les
instances publiques.** Chaque appel est donc borné à 25 s par instance.

## Ce que la première mission a donné

Cinq communes de la MEL, le 19 septembre 2026 :

```
358 opportunités découvertes, 0 doublon créé
248 qualifiées · 109 renvoyées à l'examen humain
  2 brouillons de contact en attente de validation
247 opportunités qualifiées sur 249 n'ont AUCUN canal de contact public
  0 contact envoyé — l'agent n'a pas de fonction d'envoi
  0 € de coût IA — aucun appel de modèle
  0 tâche en échec
```

96 lignes de journal, 414 sources conservées, 2 142 critères justifiés.

En tête, par nombre de rendez-vous à venir : Gare Saint Sauveur (55), Lille
Grand Palais (42), Médiathèque Jean Lévy (23), Médiathèque André Malraux (22),
La Piscine (19), L'Aéronef (18), MUba Eugène Leroy (14), Flow (13).

**Le goulot d'étranglement n'est pas la rédaction, c'est la porte.** Deux
opportunités qualifiées sur 249 ont une coordonnée publique : `places.official_url`
est nul pour la quasi-totalité de l'inventaire MEL, et l'annuaire des
entreprises n'en publie aucune. Trouver ces pages est aujourd'hui un travail
humain — ou le sujet d'un futur type de tâche.

## Ce que la deuxième mission a donné

Le 19 septembre 2026, onze tâches, cinq missions de contrôle.

### Chercher la porte, sur les cinq communes de la MEL

| Commune | Examinées | Canal rapproché | Fiches annuaire avec contact | Structures entrées AVEC leur canal |
|---|---|---|---|---|
| Lille | 120 | 0 | 96 | **96** |
| Villeneuve-d'Ascq | 58 | 0 | 25 | **25** |
| Roubaix | 49 | 0 | 29 | **29** |
| Tourcoing | 40 | 1 | 32 | **32** |
| Wattrelos | 24 | 0 | 11 | **11** |
| **Total** | **291** | **1** | **193** | **193** |

Un seul canal rapproché sur 291. C'est le résultat qui a fait changer
l'approche, et il est écrit ici tel quel.

### Paris, Lyon — et la limite qu'il faut dire

| Territoire | events | places | Annuaire | Créées |
|---|---|---|---|---|
| Paris | **0** | **0** | 25 lignes | 25 |
| Lyon | **0** | **0** | 25 lignes | 23 |

Hors de la MEL, Autour n'a **aucune** donnée : ni événement, ni lieu. Un
balayage de territoire s'y réduit donc à **une page de l'annuaire des
entreprises**, vingt-cinq lignes. Ce n'est pas une couverture de Paris ; c'est
la preuve que le mécanisme fonctionne sur un territoire neuf, et rien de plus.
Dire « Autour couvre Paris » sur cette base serait faux.

### Incubateurs, France

100 lignes lues sur quatre termes, 84 structures reconnues au nom,
**48 nouvelles**, 36 déjà connues. Aucune n'est réputée pertinente du fait
d'être un incubateur : chacune porte sa raison, et la raison dit si le lien est
**observé** ou **supposé**.

### International : l'expérience n'a pas pu avoir lieu

Trois territoires déclarés, chacun avec sa raison écrite : Bruxelles, Genève,
Montréal. Hors de France, `events` est vide et l'annuaire des entreprises
s'arrête à la frontière : **OpenStreetMap est la seule source déclarée**.

Or les trois instances publiques d'Overpass ont échoué, à chaque essai :

```
Bruxelles : Overpass injoignable : Signal timed out. sur overpass.private.coffee.
            Aucune autre source n'est déclarée pour ce territoire —
            données insuffisantes, rien n'est inventé.
```

**Ce n'est pas un résultat sur Bruxelles, c'est une panne de source.** Aucune
opportunité internationale n'a été créée, et il n'y a rien à conclure sur la
pertinence d'Autour hors de France. La tâche l'écrit ainsi, plutôt que de
rendre un zéro qui se lirait comme une mesure.

Ce qu'il faudra pour que l'expérience ait lieu : une instance Overpass qui
réponde — la sienne, ou un miroir payant — ou une deuxième source déclarée pour
ces territoires.

### Coût

**0 €.** Aucun appel de modèle n'a été fait. Toutes les sources sont des API
publiques sans clé ni quota facturé.

## Ce qui n'est pas mesurable, et qui le dit

`acquisition_entonnoir()` rend `mesurable = false` avec la raison, plutôt qu'un
zéro qui se lirait comme un résultat :

* **contacts réalisés** — Autour n'envoie rien ; le compte part de ce que le
  fondateur déclare après avoir écrit ;
* **réponses** — rien n'a été envoyé, un taux n'aurait pas de dénominateur ;
* **utilisateurs générés** — Autour ne mesure pas l'origine d'un visiteur :
  aucune attribution n'existe dans `profiles` ni ailleurs.

## Ce que la fonction Edge ne peut pas faire, et qui a coûté trois tâches

Trois défauts d'exécution trouvés en faisant tourner les missions de contrôle,
tous les trois invisibles en test :

**1. Le worker est tué, et la tâche reste `en_cours` pour toujours.** Un réveil
a pris cinq tâches ; la première a mis 76 s, la deuxième a été coupée en plein
travail — `WORKER_RESOURCE_LIMIT`, HTTP 546. La file ne lit que `statut =
'file'` : plus personne ne reprend une tâche morte en vol.

Trois mesures :

* un **budget** avant de lancer une tâche de plus (80 s, calculé pour qu'une
  tâche entière de 63 s tienne encore après lui) ;
* une **reprise des orphelines** au début de chaque réveil : ce qui est
  `en_cours` depuis plus de dix minutes retourne en file, avec la raison écrite ;
* un **délai borné** sur chaque appel Overpass (25 s par instance).

**2. Deux réveils concurrents traitent la même tâche.** Deux appels lancés à
quarante-cinq secondes d'intervalle ont lu la même file ; Wattrelos et Roubaix
se sont retrouvées `en_cours` ensemble, chacune tenue par une instance
différente. Un `PATCH tasks?id=eq.X` marque toujours, même ce qui ne nous
appartient plus. Le filtre `statut=eq.file` fait du PATCH une **prise** : zéro
ligne rendue veut dire qu'une autre exécution l'a déjà prise, et on passe.

**3. `acquisition_opportunites.canal` porte le TYPE, pas la valeur.** Un CHECK
en base n'accepte que `email_public`, `formulaire_site`, `site_officiel`,
`telephone_public`, `sur_place`, `reseau_public`. Le premier jet du nouveau
lecteur y écrivait une adresse e-mail : chaque insertion serait tombée. Trouvé
en relisant le schéma avant de déployer, et un test garde désormais la
frontière.

## L'autonomie réelle, sans exagération

L'agent fait seul : chercher, dédupliquer, qualifier, expliquer, chercher le
canal, journaliser, mesurer, et se souvenir de ce qu'il a déjà examiné.

L'humain fait, et devra continuer de faire :

* **le réveiller** — rien ne l'appelle ; `pg_cron` n'est pas branché, et ce
  n'est pas un oubli (voir « Lancer une recherche ») ;
* **relire les cas indécis**, que les règles laissent exprès en `a_examiner` ;
* **décider de chaque message**, et **l'envoyer lui-même** — l'agent n'a
  aucune fonction d'envoi, et un CHECK en base refuserait qu'on lui en donne
  une ;
* **trouver à la main les portes que les sources publiques ne donnent pas** :
  sur la MEL, 290 opportunités sur 291 n'ont toujours aucun canal.

Et il a fallu l'humain pour autre chose pendant cette mission : **débloquer
quatre tâches tuées en vol** et relancer l'agent à chaque fois. Les correctifs
(prise atomique, reprise des orphelines, budget) sont écrits pour que ça cesse,
mais ils n'ont pas encore tourné assez longtemps pour qu'on puisse dire qu'ils
suffisent. Ce sera à la prochaine mission de le montrer.

Ce n'est pas un agent autonome. C'est un agent qui fait le travail de recherche
et de préparation, qui s'arrête exactement là où commence une relation, et qui
a encore besoin qu'on le réveille.
