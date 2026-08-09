# Comprendre les phrases qui restent incomprises

État au 9 août 2026. Les deux premiers niveaux de compréhension sont en
production ; le troisième est étudié ici et **n'est pas implémenté**.

## Les trois niveaux

| Niveau | Où | Coût | Couverture mesurée |
|---|---|---|---|
| 1 · parser déterministe | `comprendre.js` | ~0,1 ms, aucun réseau | ville, catégorie, cuisine, budget, créneau, horaire, distance, groupe |
| 2 · ontologie de synonymes | `comprendre.js`, table `ONTOLOGIE` | idem | 14 signaux, ~150 expressions |
| 3 · recherche sémantique | *à faire* | requête réseau | ce que 1 et 2 laissent dans `intention.reste` |

Les niveaux 1 et 2 partagent une seule table et un seul passage sur la phrase.
Le niveau 3 ne se déclenche que sur ce qui reste — et c'est précisément ce qui
le rend abordable : la majorité des requêtes n'y arrivent jamais.

## Ce que `reste` contient déjà

`analyser()` renvoie `intention.reste` : la phrase débarrassée de ce qui a été
compris et des mots outils. C'est la mesure du trou, et elle est disponible
aujourd'hui.

```
« un endroit calme où travailler »      → reste: ""
« manger pour moins de 15€ »            → reste: ""
« un truc avec une ambiance sympa »     → reste: "sympa"
« comme le café de la gare mais calme » → reste: "comme cafe gare mais"
```

Avant d'écrire quoi que ce soit de sémantique, il faut journaliser ces restes
en production pendant quelques semaines. Deux issues possibles, et une seule
justifie le niveau 3 :

- les restes sont majoritairement des **noms propres** (« chez Fatima »,
  « rue Nationale ») → c'est une recherche plein texte qu'il faut améliorer,
  pas un modèle sémantique ;
- les restes sont des **descriptions de situation** que l'ontologie ne couvre
  pas → le niveau 3 se justifie, et les restes eux-mêmes disent quels
  synonymes ajouter d'abord.

Dans les deux cas, la première action est la même : **enrichir l'ontologie**.
C'est dix minutes de travail par famille de synonymes, contre plusieurs jours
pour une couche vectorielle.

## Si le niveau 3 se justifie : pgvector

### Modèle

```sql
-- extension déjà disponible sur Supabase ; NE PAS la réinstaller sans
-- avoir lu pg_extension : le schéma d'installation n'est pas garanti
create table profil_semantique (
  lieu_id      text primary key,
  texte        text not null,      -- ce qui a été vectorisé, pour l'audit
  embedding    vector(384),
  source       text not null,      -- 'osm' | 'google' | 'openagenda'
  maj_le       timestamptz not null default now()
);
create index on profil_semantique using hnsw (embedding vector_cosine_ops);
```

`texte` = nom + catégories + tags lisibles + description Google, concaténés.
Le garder en clair est indispensable : sans lui, on ne peut pas expliquer
pourquoi un lieu est remonté.

### Où le calcul se fait

**Côté serveur, jamais dans le navigateur.** Une fonction Edge planifiée
vectorise les lieux nouveaux ou modifiés, par lots. Le client n'embarque aucun
modèle et ne paie aucun appel par frappe.

### Comment la requête est comparée

```
phrase → niveaux 1 et 2 → intention structurée
                        → si `reste` non vide :
                              embedding(reste)  (un seul appel, au VALIDER)
                              → rpc('lieux_proches', {v, zone, limite:40})
                              → fusion avec le classement existant
```

Trois règles qui ne doivent pas bouger :

1. **Jamais sur la frappe.** L'embedding se calcule quand on valide, pas à
   chaque caractère. Une recherche instantanée reste celle des niveaux 1 et 2.
2. **Jamais bloquant.** Les résultats déterministes s'affichent d'abord ; ceux
   de la couche sémantique arrivent après et complètent la liste.
3. **Jamais seul juge.** La similarité vectorielle entre dans le score comme
   une préférence supplémentaire — elle ne remplace ni les contraintes dures,
   ni le filtrage temporel, ni la pertinence de catégorie. Un modèle qui
   trouve « romantique » à une station-service ne doit pas pouvoir la faire
   remonter.

### Coût

Un embedding de 384 dimensions par lieu, recalculé quand la fiche change. Pour
une métropole, quelques dizaines de milliers de vecteurs — quelques dizaines de
Mo, et une requête HNSW en quelques millisecondes. Le coût réel est celui de
l'API d'embedding à l'ingestion, pas à la lecture.

## Ce qui ne doit pas être fait

- **Un appel LLM par recherche.** Latence imprévisible, coût proportionnel à
  l'usage, et résultats non reproductibles — donc intestables.
- **Vectoriser la phrase entière.** Les niveaux 1 et 2 comprennent déjà le
  budget, l'horaire et la zone, et ils le font mieux : un modèle ne garantit
  pas que « moins de 15 € » soit une contrainte. Seul le `reste` est vectorisé.
- **Remplacer l'ontologie par le modèle.** L'ontologie est lisible, testable
  et corrigeable en une ligne. Le modèle ne l'est pas. Il complète, il ne
  remplace pas.

## Limite connue, sans rapport avec le niveau 3

Les signaux d'un lieu (`signaux.js`) viennent d'OpenStreetMap et des
catégories. Sur beaucoup de communes, `internet_access`, `outdoor_seating` ou
`wheelchair` ne sont renseignés nulle part. La recherche répond donc « je ne
sais pas » plutôt que « non » — c'est le bon comportement, mais ça veut dire
qu'une couche sémantique ne comblera pas ce trou-là : il se comble en
contribuant à OSM ou en enrichissant depuis Google, pas en devinant.
