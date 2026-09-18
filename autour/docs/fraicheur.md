# L'agent de fraîcheur, et la fiche qui sert

Deux sujets qui n'en font qu'un : ce qui rafraîchit les données tous les deux
jours, et ce qui fait qu'un utilisateur se dit « ça me sert » au lieu de
« c'est quoi ».

---

## Partie A — la fraîcheur

### A.1 Ce qui a changé sans écrire une ligne de code

Overpass tournait en mensuel **par choix de cron**, pas par contrainte
technique. `.github/workflows/zones-autour.yml` passe à `17 4 */2 * *` : tous
les deux jours. C'est gratuit, et cela résout déjà la moitié du problème de
fraîcheur sur les lieux.

`*/2` sur le jour du mois donne les jours impairs ; l'écart retombe à 24 h une
fois par mois, au passage du 31 au 1er. C'est la seule façon d'écrire « tous
les deux jours » en cron, et un cycle plus court n'a jamais fait de mal.

### A.2 Le grounding est obligatoire

Un modèle interrogé sans recherche produit une réponse plausible tirée de son
entraînement. C'est ce qui a donné, dans `place_enrichments`, 44 fiches à
confiance moyenne 0,57 et zéro horaire structuré.

**Budget réel.** La famille Gemini 3.x inclut 5 000 requêtes groundées
gratuites par mois, puis 14 $ pour 1 000. Un seul appel peut déclencher
plusieurs requêtes de recherche, et **chacune est facturée** : environ
160 appels par jour, soit **330 objets par cycle de 48 h**.

Le plafond n'est pas réécrit : `reserver_enrichissement()` et
`enrichment_usage_daily` existent déjà, avec réservation *avant* appel. Un
deuxième mécanisme de plafond serait un deuxième endroit où se tromper.

### A.3 L'ordonnanceur

| Type d'objet | TTL | Voie | Priorité |
|---|---|---|---|
| `aide_solidaire` | 72 h | HTTP + **relecture humaine obligatoire** | 10 |
| `evenement_proche` (< 7 j) | 48 h | HTTP structuré | 20 |
| `ephemere` (pop-up, signalé) | 48 h | groundée | 30 |
| `lieu_culturel` | 14 j | HTTP, puis déterministe | 50 |
| `commerce` | 30 j | déterministe (SIRENE) | 70 |

`public.freshness_policy` porte ces durées. `public.programmer_fraicheur()`
sélectionne les objets dont `fraicheur_verifiee_le` dépasse le TTL, trie par
priorité, coupe au budget du cycle, et écrit dans `public.freshness_tasks`.

**C'est le producteur qui manquait à la file.** `event_sync_runs` journalise ce
qui a tourné ; rien ne disait ce qui restait à faire.

> La table s'appelle `freshness_tasks` et non `tasks` : une table nommée
> `tasks` dans un schéma partagé n'appartient à personne, et la deuxième file
> du dépôt la trouverait occupée.

`fraicheur_verifiee_le` est délibérément distinct de `last_seen_at` et de
`last_synced_at` : être recopié par un catalogue n'est pas être vérifié.

### A.4 Les trois voies, par coût croissant

L'ordre n'est pas une préférence de style, c'est une **règle de dépense** :
330 appels groundés par cycle, et les dépenser sur ce que SIRENE donne
gratuitement, c'est ne pas les avoir pour le reste.

**Voie 1 — déterministe, gratuite, illimitée.**
SIRENE (API Recherche d'entreprises) pour l'état administratif `A`/`F` et la
date de fermeture ; FINESS pour le sanitaire et le médico-social ; le **diff
Overpass à 48 h**, écrit par `outils/zones.mjs` dans le champ `disparus` de
chaque tuile ; `HEAD` sur `official_url`.

Le `HEAD` **ne produit jamais de proposition à lui seul** : une page qui répond
ne prouve pas qu'un lieu est ouvert, et un 404 ne prouve pas qu'il a fermé — un
site refait donne exactement le même code. Il corrobore, ou il alerte.

Rien de ce qui sort d'ici ne consomme de quota.

**Voie 2 — HTTP structuré, gratuite.**
Le JSON-LD `schema.org/Event` exposé dans le `<head>`, et les flux RSS/Atom.
C'est probablement le gisement principal pour les événements absents
d'OpenAgenda et de DATAtourisme, et il ne coûte rien.

Instagram et Facebook sont hors jeu : leurs CGU interdisent la collecte.

**Voie 3 — Gemini groundé, sous quota.**
Uniquement le reliquat que les deux premières n'ont pas tranché, et uniquement
si `voie_ouverte('grounde')` et si `reserver_enrichissement()` accorde l'appel.

### A.5 Contrat de sortie

```json
{ "statut": "ouvert | ferme_definitivement | inconnu",
  "date_information": "AAAA-MM-JJ",
  "url_source": "https://…",
  "confiance": 0.0 }
```

**Pas d'URL exploitable → `inconnu` → aucune écriture.** La règle est
mécanique : `validerContrat()` l'applique dans le code appelant, et la
contrainte `freshness_proposals_sans_url_est_inconnu` la répète en base. Une
règle déclarée dans une invite est une intention ; une vérification en est une.

On ne demande jamais « ce lieu est-il encore ouvert ». On demande d'extraire un
statut de ce qui a été trouvé. **Extracteur, pas oracle.**

Pour la voie 3, seules les annotations `url_citation` posées par l'API comptent.
Une URL écrite par le modèle dans son texte est une chaîne plausible, pas une
source.

### A.6 Écriture en deux temps

Les propositions vont dans `public.freshness_proposals`, **jamais directement
dans `places` ou `events`**. La fonction de cycle n'écrit sur l'objet que
`fraicheur_verifiee_le` et `fraicheur_voie`.

Acceptation automatique (`decider_propositions()`) seulement si :

- la source est officielle — `.gouv.fr`, `service-public.fr`, un domaine
  communal, ou **le site du lieu lui-même** ; ou
- deux sources **indépendantes** concordent — deux domaines différents, pas
  deux pages du même site.

Sinon : file de relecture humaine. Et si la politique porte
`relecture_humaine`, aucune concordance et aucune source officielle ne la
lèvent : c'est le niveau 3 contre le niveau 2, appliqué à un cas réel.

### A.7 Limite à respecter

**Jamais d'horaires par la voie groundée.** La recherche remonte massivement
des agrégateurs périmés. Pour « fermé définitivement » elle est bonne — une
fermeture laisse des traces publiques. Pour « ouvert jusqu'à 19 h le mardi »,
elle fabriquera une réponse.

`freshness_proposals` ne porte aucune colonne d'horaire, et `tests/fraicheur.
test.mjs` refuse qu'on en ajoute une. Les horaires passent par OSM
(`opening_hours`, syntaxe standard, ODbL) ou par rien.

### A.8 Mesure et coupure

`mesurer_voies()` rend, par voie et sur une fenêtre de 30 jours : produites,
acceptées, et **contredites plus tard par une source déterministe**.

Une source déterministe contredit les autres, jamais l'inverse : SIRENE a
raison contre une page web, une page web a raison contre une recherche.

`couper_voies_deviantes()` coupe une voie dont le taux dépasse son seuil
(`freshness_voie_sante`), à condition d'avoir au moins `minimum_mesurable`
propositions — trois erreurs sur cinq n'est pas un signal, c'est un petit
échantillon. La rouvrir demande une décision humaine explicite, pas un délai
qui passe.

### A.9 Prérequis bloquant — fait

`events?id=<uuid>` → `events?id=eq.<uuid>` dans `sync-datatourisme` et
`sync-openagenda`. C'était le chemin de relecture des annonces canoniques : il
échouait en 400, la fonction appelante attrapait, rendait `{}`, et la
synchronisation continuait comme si l'annonce n'avait jamais existé.

`tests/postgrest-filtres.test.mjs` refuse désormais tout filtre sans opérateur
dans les fonctions Edge, en lisant la liste des tables depuis les migrations.

---

## Partie B — la fiche qui sert

### B.1 Le problème

Une fiche qui affiche « CMP — santé » ne sert à personne. Une fiche qui affiche
« consultations psychologiques gratuites, sur rendez-vous, secteur de votre
adresse » sert immédiatement.

Le champ décisif n'est ni la catégorie ni la photo : c'est **le mode d'accès**.
Quelqu'un qui se déplace jusqu'à l'adresse d'un CHRS repart bredouille —
l'entrée se fait par le 115.

### B.2 Les huit champs

`public_vise`, `mode_acces`, `cout`, `anonymat`, `quoi_concretement`,
`telephone_cle`, `type_structure`, `organisme_gestionnaire`, ajoutés à
`places` par `20260918090000_lot8_fiche_solidaire.sql`.

Tous nuls par défaut, et c'est la règle qui compte : un champ nul se voit et se
corrige ; un champ deviné se propage. `anonymat` nul n'est pas « non » :
personne ne doit lire une promesse que la source n'a pas faite.

### B.3 Un gestionnaire n'est pas un lieu

ALEFPA et La Sauvegarde du Nord gèrent des dizaines d'établissements. On
n'entre pas dans une association gestionnaire, on entre dans un de ses
établissements. Deux champs distincts, et le sous-type `gestionnaire` porte
`affiche = false` : sans cela, la carte se remplit de sièges sociaux.

### B.4 La famille `solidarite`

Elle existait depuis le Lot 4-bis ; ce qui manquait était un cran en dessous.
`place_sous_types` porte les huit sous-types : `hebergement_urgence`,
`logement_jeunes`, `action_sociale_generale`, `sante_mentale`,
`accueil_jeunes`, `aide_materielle`, `violences_femmes`, `gestionnaire`.

### B.5 data·inclusion remplace les fichiers figés

`autour/aide-data-inclusion.mjs` interroge l'API avec
`DATA_INCLUSION_API_TOKEN` ou `DORA_API_TOKEN`, et traduit son vocabulaire
contrôlé vers les champs de B.2. `api/aide-structures.js` l'appelle **en
premier** ; les extraits versionnés deviennent le repli, et `sourceStatus` dit
lequel des deux a parlé.

Un code inconnu de la table de traduction n'est pas rangé dans la case voisine :
il ressort tel quel pour `public_vise`, et rend `null` pour les champs fermés.

### B.6 Règles de sécurité, non négociables

1. **Aucune adresse de mise à l'abri pour femmes victimes de violences.** On
   publie la permanence d'accueil de jour et le 3919, rien d'autre.
   → contrainte `places_violences_femmes_sans_adresse`, et
   `lieux_solidaires_affichables()` masque l'adresse une seconde fois.
2. **Pour l'hébergement d'urgence, la fiche donne le 115**, pas une adresse
   d'accès direct. → `places_hebergement_urgence_par_le_115`.
3. **Aucun horaire deviné sur cette famille.** Seules les sources qui publient
   l'horaire peuvent en poser un. → `places_solidarite_horaires_deterministes`.
4. **Toute fiche de cette famille est relue par un humain avant publication.**
   → déclencheur `private.solidarite_exige_relecture()` : une fiche non relue
   existe, elle n'est simplement jamais `active`. Niveau 3, sans exception et
   sans montée progressive en automatisation.

### B.7 Le lexique

`data/aide-solidarite-lexique.js` et `solidarite_lexique` portent les seize
termes vérifiés et leur phrase en français ordinaire. Le même texte vit aux
deux endroits parce que le navigateur n'a pas de base et que le pipeline n'a
pas de navigateur ; `tests/solidarite-lexique.test.mjs` régénère le bloc SQL
depuis le JS et refuse la moindre différence.

`mode_acces` n'y est rempli que lorsqu'il est **structurel** — le 115 pour un
CHRS partout en France, contre l'organisation locale d'un CCAS. Nul veut dire
« à établir à la relecture », et c'est une information, pas un trou.

**ALORE reste `UNKNOWN`**, consigné dans `solidarite_termes_inconnus`. Aucune
source fiable ne l'a confirmé. Ce n'est pas un manque : un sigle développé au
jugé devient une fiche fausse, et une fiche fausse dans ce domaine envoie
quelqu'un quelque part pour rien.

### B.8 Ce que ça démontre

Sur dix-sept termes, seize se vérifient par des sources publiques et
structurées, et **zéro n'a nécessité un modèle**. Le travail utile n'était pas
d'ajouter de l'intelligence : c'était de brancher data·inclusion et d'écrire
seize phrases en français clair.

---

## Ce qu'il reste à faire, et par qui

- **Migrations non exécutées, à valider par `supabase db reset` en local avant
  PR 2.** Les trois fichiers de `supabase/migrations/2026091809*` passent le
  parseur grammatical, et rien de plus : aucun serveur PostgreSQL n'était
  disponible là où ils ont été écrits. Une contrainte qui ne s'applique pas,
  un déclencheur qui refuse la mauvaise ligne ou une fonction qui ne compile
  pas ne se voient qu'à l'exécution.
- **Les émetteurs de la voie 2.** Le mécanisme lit le JSON-LD de l'URL
  officielle d'un objet. La liste de trente à cinquante émetteurs locaux
  (mairies MEL, MJC, salles, médiathèques, offices de tourisme) n'est pas
  inventée ici : `territory_sources` existe déjà avec `active = false` par
  défaut, et « une source absente ou inactive n'est jamais appelée ». Chaque
  URL doit être vérifiée par quelqu'un avant d'être activée.
- **`official_url`.** 15 fiches sur 44 la portent aujourd'hui. La voie 1 et la
  voie 2 en dépendent toutes les deux : c'est le premier enrichissement à
  faire, et il est gratuit.
- **Les seize fiches réelles.** Le lexique décrit des types. Chaque
  établissement reste à relier, et à relire.
