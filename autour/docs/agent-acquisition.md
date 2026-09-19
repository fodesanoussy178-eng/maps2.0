# Agent Acquisition et Control Center

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

Une tâche dont le type n'a pas de ligne dans `task_permissions` **ne peut pas
être créée** : la clé étrangère la refuse.

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

## Le Control Center

`/control`, `/control/acquisition`, `/control/validation`, `/control/journal`.

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

Aucune planification n'existe (§20) : `private.invoke_agent_acquisition()` est
écrite, elle marche, et **rien ne l'appelle**. Un agent qui se réveille seul
avant que quiconque ait relu ce qu'il produit, c'est une base d'opportunités
fausses qui grossit pendant qu'on dort. Le jour où la qualité du premier lot
aura été jugée :

```sql
select cron.schedule('agent-acquisition-quotidien', '0 5 * * *',
                     $$select private.invoke_agent_acquisition('work')$$);
```

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

## Ce qui n'est pas mesurable, et qui le dit

`acquisition_entonnoir()` rend `mesurable = false` avec la raison, plutôt qu'un
zéro qui se lirait comme un résultat :

* **contacts réalisés** — Autour n'envoie rien ; le compte part de ce que le
  fondateur déclare après avoir écrit ;
* **réponses** — rien n'a été envoyé, un taux n'aurait pas de dénominateur ;
* **utilisateurs générés** — Autour ne mesure pas l'origine d'un visiteur :
  aucune attribution n'existe dans `profiles` ni ailleurs.

## L'autonomie réelle, sans exagération

L'agent fait seul : chercher, dédupliquer, qualifier, expliquer, journaliser,
mesurer.

L'humain fait, et devra continuer de faire : trouver les pages de contact que
les sources publiques ne donnent pas, relire les 109 cas indécis, décider de
chaque message, et l'envoyer lui-même.

Ce n'est pas un agent autonome. C'est un agent qui fait le travail de recherche
et de préparation, et qui s'arrête exactement là où commence une relation.
