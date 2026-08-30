# Audit Aide — Tourcoing et communes voisines

Audit reproductible le 30 août 2026 avec le script `outils/audit-aide-tourcoing.mjs`.
Le périmètre est un cercle de 12 km autour de Tourcoing (50.72373, 3.160758),
qui couvre Tourcoing, Roubaix, Wattrelos, Mouvaux, Roncq, Halluin,
Neuville-en-Ferrain, Linselles, Bondues, Croix, Hem et Wasquehal.

## Règle de comptage

Une candidate est une `AideStructure` normalisée pour laquelle la taxonomie
existante a produit au moins une preuve, même sous le seuil. Une structure est
fiable si le verdict de la capacité correspondante est accepté à au moins 50.
Elle est affichable si elle possède un nom et des coordonnées valides. Le
statut fermé ne retire donc pas la fiche : il reste visible avec `Fermé` ou
`Fermé définitivement`.

Les nombres sont calculés après déduplication inter-sources. Les sources dans
la dernière colonne comptent une structure une fois par source qui l'a fournie;
une fiche issue de plusieurs référentiels peut donc apparaître dans plusieurs
compteurs.

| Besoin | Candidates | Fiables | Affichables | Sources des affichables |
|---|---:|---:|---:|---|
| manger | 30 | 2 | 2 | DORA 1, OSM 1 |
| logement | 38 | 18 | 18 | DORA 2, FINESS 14, OSM 2 |
| travail | 46 | 30 | 30 | DORA 4, Service-Public/DILA 24, OSM 2 |
| papiers | 46 | 3 | 3 | DORA 2, OSM 1 |
| sante | 42 | 14 | 14 | FINESS 12, OSM 2 |
| jeunes | 48 | 30 | 30 | DORA 2, Service-Public/DILA 24, OSM 4 |
| parler | 42 | 2 | 2 | FINESS 1, OSM 1 |
| famille | 43 | 8 | 8 | DORA 2, FINESS 2, OSM 4 |
| securite | 53 | 3 | 3 | OSM 3 |
| autre | 70 | 70 | 70 | DORA 6, FINESS 26, Service-Public/DILA 24, OSM 14 |

`Autre` est volontairement large : il retient toute structure ayant au moins
une capacité reconnue par la taxonomie. Il ne constitue pas une onzième
taxonomie.

## Inventaire par source

| Source | Extrait utilisé | Après normalisation | Mode de mise à jour |
|---|---:|---:|---|
| Autour | 0 dans l'extrait versionné | 0 | injecté à l'exécution depuis `permanentPlaces` |
| DORA/data·inclusion | 7 | 7 | snapshot local + API authentifiée optionnelle |
| FINESS nouvelle génération | 28 | 28 | snapshot local + URL JSON optionnelle |
| Service-Public/DILA | 24 | 24 | export communal embarqué + API Annuaire |
| OpenStreetMap | 65 objets Tourcoing / 692 objets dans le cercle | 14 dans l'extrait d'audit | Overpass en direct ; extrait de contrôle versionné |

Les 14 fiches OSM de l'extrait sont les structures sensibles contrôlées
(police, aide alimentaire, Mission locale, CCAS, jeunesse, santé et
hébergement). Le collecteur Overpass de l'application conserve le résultat
complet et élargit progressivement son rayon jusqu'à 12 km si nécessaire.

## Contrôle des cas obligatoires

- **Aide alimentaire** : Secours populaire — comité de Roubaix dans DORA avec
  `food_bank`/`food_assistance`, et Croix-Rouge de Tourcoing dans OSM avec
  `social_facility=food_bank`.
- **Mission Locale** : Mission Emploi Lys-Tourcoing dans DORA, Mission locale
  de l'annuaire DILA et objet OSM correspondant.
- **CAF / France Services / CCAS** : DORA porte CAF, CCAS et France Services;
  CCAS et France Services partagent le SIRET et sont dédoublonnés comme une
  même implantation. DILA et OSM portent aussi les types CCAS/France Services.
- **Foyers / FJT** : FINESS code 257 pour les FJT et codes 258/259 pour
  pensions et résidences sociales; OSM apporte également les `group_home`.
- **CHRS / hébergement** : DORA porte le Relais Soleil (CHRS); FINESS porte
  les CHRS code 214, les CAU/CHU code 219, les FJT et résidences; la taxonomie
  distingue hébergement réel, accueil de jour et orientation.
- **Santé / CMP** : FINESS porte CMP code 156, centres de santé 603/604/617,
  PMI, CEGIDD et planification; OSM porte les centres de santé et CeGIDD.
- **Police / gendarmerie** : OSM porte les trois objets de Tourcoing
  (Police nationale, Police municipale, Hôtel de police), avec
  `amenity=police`; les adapters DILA, DORA et FINESS savent aussi projeter
  ces types lorsqu'ils sont publiés par leur source.
- **Aide aux victimes** : type DORA/DILA, services `victim_support` et tags
  OSM `social_facility:for=victim|victims` sont des preuves dédiées; aucun
  lieu n'est créé par le seul mot « victimes » dans un nom.
- **CCAS / services sociaux** : CCAS DORA, OSM et types DILA sont projetés vers
  le même schéma, avec capacités séparées (logement, démarches, famille,
  travail) et provenance par capacité.

## Garanties de qualité

- Chaque adaptateur est séparé : `aideAutour`, `aideDora`, `aideFiness`,
  `aideInstitutionnelle` (DILA) et `aideOsm`.
- Le schéma commun est `AideStructure`; chaque capacité contient verdict,
  confiance, niveau, preuves et provenance.
- La déduplication utilise d'abord FINESS EGE/PM, SIRET et identifiants de
  source. Deux identifiants officiels distincts ne sont jamais fusionnés au
  nom. Sans identifiant exploitable, le repli exige nom normalisé, adresse et
  coordonnées à moins de 120 m.
- Le moteur de taxonomie reste l'unique responsable de la pertinence. Un nom
  seul produit `nom_seul` et ne rend pas une capacité éligible.
