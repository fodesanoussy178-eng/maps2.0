# Le Context Engine et le Recommendation Engine

> Ce document est un **audit** suivi d'une **proposition d'architecture**.
> Aucune ligne de moteur n'a été modifiée pour l'écrire. Il se termine par un
> plan par lots, chacun avec son problème, sa solution, son impact, ses
> données, ses risques et sa méthode de test.

---

## 1. Ce qu'est Autour aujourd'hui, dans le dépôt

Deux produits cohabitent, et il faut le dire avant tout le reste :

| dossier | produit |
|---|---|
| `src/`, `supabase/` à la racine | **Urosi-t**, plateforme de micro-missions (React + TS). Rien à voir avec Autour. |
| `autour/` | **Autour**. JavaScript sans build, modules `AutourX` posés sur `globalThis`, `app.js` de 18 000 lignes, backend Supabase, routes `api/*.js` sur Vercel. |

Autour n'est pas un prototype. C'est une base mûre : 86 fichiers de tests
(`node --test`), 1 756 assertions, des bancs de mesure dans `outils/`, et
19 documents dans `docs/` qui expliquent les décisions plutôt que le code.

**État des tests au moment de l'audit, avant toute modification :**
`node --test tests/*.test.mjs` → **1 741 succès, 15 échecs**. Ces 15 échecs
sont **préexistants** sur `main` ; une partie dépend d'un navigateur ou d'un
réseau absents du bac à sable, deux au moins sont réels
(`comptes.test.mjs:145`, `enrichissement.test.mjs:661`). C'est la ligne de
base : tout lot futur doit être jugé par rapport à elle, pas par rapport à zéro.

---

## 2. Audit : ce qui existe déjà

### 2.1 La philosophie « connaître ≠ afficher » est déjà codée

C'est le point le plus important de l'audit, et il est rassurant : **la règle
absolue du §13 n'est pas à construire, elle est appliquée**.

- `core.js` · `DISCOVERY_EXCLUDED_CATEGORIES` exclut de l'accueil
  l'alimentaire d'aide, les associations, le commerce générique, les écoles,
  l'emploi, l'hébergement, la mairie, la recharge, la santé, les toilettes et
  **tous les transports**. Ils restent joignables par besoin ou par recherche.
- `core.js` · `rankResults` refuse un arrêt de métro comme *résultat* tant que
  le transport n'a pas été demandé, et le fait en comparant les **forces**
  d'appartenance plutôt qu'un seuil — une station de vélos tenait à `sport`
  par 0,8 et passait pour une sortie.
- `maintenant.js` refuse de remplir ses trois emplacements : « mettre un
  événement de demain parce qu'il reste une ligne vide, c'est envoyer
  quelqu'un devant une porte fermée ».

Autour n'est pas en train de devenir un annuaire. Il faut simplement ne pas
l'y ramener.

### 2.2 Géolocalisation et zone

| brique | fichier | ce qu'elle fait |
|---|---|---|
| zone active | `contexte.js` | **une seule** notion commande : la zone dont Autour parle. `positionMoi` ne sélectionne plus rien. Marge de 1,5 km autour de toute emprise. Portée (`porteeCourante`) qui périme le travail en vol. |
| zones autonomes | `zones-autonomes.js` | cinq identités produit stables : `mel`, `paris`, `angers`, `rennes`, `rouen`. Chaque donnée porte `zone_id`. |
| rayon regardé | `app.js` · `rayonRegarde()`, `rayonDeLaZone()` | demi-diagonale de la vue, plancher 3 km ; le rayon suit **ce qu'on voit**, pas un chiffre fixe. |
| tuiles précalculées | `zones/*.json`, `outils/hubs.json` | neuf tuiles OSM prêtes autour de huit hubs de données. Cinq existent (Lille, Paris). |
| géocodage | `app.js` · `geocoderVille()` | Nominatim, emprise comprise, homonymes départagés par proximité. Aucune ville n'est écrite en dur. |

### 2.3 Le temps

`temporel.js` (877 lignes) et la fonction SQL `public.event_temporal_status()`
partagent une règle unique : un événement est `now` **si et seulement si**
`start_at <= now <= end_at`, date exacte, non annulé. Aucune heure de fin
n'est inventée. Les statuts canoniques sont `now | soon | today | tonight |
weekend | upcoming | past | unknown_date`, et `sectionTemporelle()` les range
en `maintenant | aujourdhui | ce_soir | ce_week_end | a_venir`.

Les créneaux d'écran existent : `CRENEAUX` = `maintenant`, `bientot` (interne),
`avenir`, `weekend`.

### 2.4 Les trois espaces

**MAINTENANT** — `maintenant.js` (1 110 lignes). Quatre natures ordonnées :
`event_now`, `session_soon`, `activity_now`, `open_now`. Chaque refus porte un
nom (`RAISONS`). Au plus trois résultats, le plus proche d'abord, à distance
égale celui qui finit le plus tôt. Diversité en deux passes qui « ne coûte
jamais la tête de liste ». Quatre états d'affichage, place réservée dès le
premier rendu.

**POUR TOI** — `envies.js` (goûts déclarés, 25 entrées, genres musicaux
enfants de `concerts`), `annonces-taxonomie.js` (tags d'annonce),
`annonces-classement.js` (le classement). Le cas exact du §4 du cahier des
charges est **déjà implémenté** : `major_cross_zone_pool` sort de la zone
active pour un événement `importance_level = 'major'`, score ≥ 80, portée non
municipale, à moins de 350 km — et il n'alimente **que** Pour toi, jamais
Maintenant, Explorer, Aide ou les marqueurs.

**À VENIR** — existe comme créneau (`avenir` → section `a_venir`) et rien de
plus : c'est le même classement, filtré sur une autre fenêtre.

### 2.5 Les événements canoniques

`events` + `event_sources` + `event_areas` + `autour_zones` + `event_sync_runs`.
Déduplication à trois niveaux (`source+external_id`, `dedup_key` calculée
identiquement en SQL et en JS, rapprochement souple exigeant les trois
critères). « Le doute profite à la séparation. » Artistes, genres,
`event_kind`, `announcement_tags` sont portés par l'événement.

Les colonnes de cycle de vie **existent déjà** :
`announced_at`, `presale_at`, `tickets_open_at`, `ticket_url`,
`announcement_provenance`.

### 2.6 Le classement

**Deux moteurs coexistent**, et c'est le cœur de l'audit :

| moteur | où | qui l'appelle | personnalisation |
|---|---|---|---|
| `rankResults` | `core.js:1815` | `recommandationsAccueil`, `recommandationsBientot`, la recherche, le contexte territorial | **non** |
| `scoreLieu` | `app.js:10340` | `selectionner()` (marqueurs), `majAccueil()` (feuille), `choisirSurprise()` | **oui** (`ctx.interets`, `PROFIL.ignores`) |

`rankResults` est le moteur moderne : contraintes dures avant pertinence,
filtrage temporel avant tout score, signaux (`signaux.js`), saison, bonus
territorial borné, diversité, ETA. `scoreLieu` est l'ancien : une somme de
`POIDS`, et c'est **le seul** qui lit le profil d'usage.

### 2.7 Fraîcheur et provenance

- Hiérarchie de sources explicite (source officielle > institution >
  organisateur > agenda > DATAtourisme > OSM > tiers) ; une source tierce
  seule ne peut jamais provoquer `inconnu → ouvert` ni `ouvert → fermé`.
- TTL par **nature** de l'information : `perimetre` 7 j, `equipements` 24 h,
  `programme` 30 min, `temporel` 2 min, avec une **priorité** de
  rafraîchissement.
- `event_sync_runs` et `public.sante_sources_evenements()` disent depuis quand
  une source se tait.
- Budget d'enrichissement **réservé avant l'appel** (`reserver_enrichissement`),
  pas compté après coup.

### 2.8 Recherche, aide, offres

- **Recherche** : `comprendre.js` transforme une phrase en intention
  structurée (contraintes dures / préférences / ambiance) ;
  `parseSearchQuery` sépare intention et destination ; `lieux_explorer`
  interroge l'inventaire. Le §14 est tenu.
- **Aide** : système complet et séparé (`aide*.js`, ~3 500 lignes), avec sa
  propre ontologie de besoins, ses rayons progressifs, ses structures. La
  phrase tapée n'est conservée nulle part.
- **Offres** (bons plans) : table `offers` générique — `offer_type`,
  `audience_tags`, `source_url NOT NULL`, date de fin. « `student` veut dire
  *cette offre s'adresse aux étudiants*, et rien d'autre. » Lue par
  `offres_publiques`, affichée sur un **écran dédié**.

### 2.9 Performance

`ordonnanceur.js` : `requestIdleCallback` avec repli Safari, travaux
annulables, `parLots` piloté par le temps restant, **jeton vérifié avant et
après** chaque calcul. Rendu de l'accueil en deux temps. Gains mesurés : 1er
résultat 4 703 → 2 518 ms en centre dense. **Reste non tenu** : le blocage du
fil principal est à 1 815 ms pour un objectif de 1 000 ms, et le banc
l'imprime à chaque exécution plutôt que de le taire.

---

## 3. Les écarts avec le cahier des charges

Numérotés pour être cités dans le plan.

| # | écart | gravité | § du cahier |
|---|---|---|---|
| **É1** | **Deux moteurs de classement.** Le profil d'usage n'influence que l'ancien. Un même lieu peut être 1er sur la carte et absent de la feuille. | haute | 15, 19 |
| **É2** | **Aucune machine à phases d'événement.** `announced_at` / `presale_at` / `tickets_open_at` sont stockés, jamais interprétés : aucun « 🎟️ Billetterie demain », aucun « 🔥 Concert dans 3 jours ». Seul un lien billetterie est affiché (`app.js:13276`). | haute | 5 |
| **É3** | **« À venir » est un filtre, pas un espace.** Pas de notion de ce qui *change* bientôt. | haute | 5 |
| **É4** | **La portée est géométrique, pas intentionnelle.** Elle vient de la vue de la carte. Rien ne dit qu'une pharmacie est très locale et qu'un artiste suivi est national. La seule exception est le pool majeur cross-zone de Pour toi. | haute | 10 |
| **É5** | **Pas de quadrillage interne avec détection de changement.** Les tuiles `zones/*.json` sont des données statiques OSM ; personne ne sait répondre à « qu'est-ce qui vient de changer ici ? ». | moyenne | 11 |
| **É6** | **Paris n'est pas hiérarchique.** `paris_centre`, `paris_nord`… sont des **partitions de synchronisation**, pas des zones opérationnelles. Aucun arrondissement, aucune notion de voisinage. Une seule occurrence du mot « arrondissement » dans `app.js`, dans un commentaire. | moyenne | 9 |
| **É7** | **Les offres n'entrent jamais dans le feed.** Elles vivent sur un écran dédié. Rien ne distingue, au classement, une offre temporaire d'un avantage permanent. | moyenne | 7 |
| **É8** | **L'aide n'entre jamais dans le feed.** `modeAide` est un mode exclusif. Une distribution alimentaire réellement ouverte à 400 m ne peut pas remonter. | moyenne | 8 |
| **É9** | **L'apprentissage est résiduel et mal branché.** `PROFIL` compte catégories, heures, recherches, ignorés — et ne nourrit que `scoreLieu`. Ni sauvegarde, ni partage, ni répétition d'intérêt. | haute | 19 |
| **É10** | **Pas de garde anti-bulle sur le feed personnalisé.** `diversifierResultats` diversifie les familles de résultats ; rien ne garantit une part de découverte, de nouveauté ou de local. | moyenne | 19 |
| **É11** | **Le contexte est recalculé en ordre dispersé.** `contexteActuel()` (ancien), `contexteSaison()`, `contexteTerritorialClassement()`, `instantCreneau()`, `centreZoneActive()`, `rayonDeLaZone()` : six sources de vérité partielles pour une seule question. | moyenne | 2 |

### Une tension à trancher, pas à contourner

`envies.js` s'ouvre sur : *« Pas de moteur de recommandation, pas
d'apprentissage implicite, pas de profilage : la liste ne contient QUE ce qui
a été coché à la main. C'est la condition pour pouvoir dire, sous chaque
proposition, pourquoi elle est là. »*

Le §19 du cahier des charges demande l'inverse. Les deux sont défendables. La
proposition ci-dessous tranche ainsi, et c'est une décision à valider :

> **Le déclaré sélectionne, l'implicite ordonne.**
> Ce qui a été coché dans Envies peut faire *entrer* un événement dans Pour
> toi. Ce qui est déduit d'un comportement ne peut que *changer l'ordre* de ce
> qui est déjà entré. L'implicite ne quitte jamais le navigateur, reste
> lisible et effaçable, et chaque proposition garde sa phrase « pourquoi ».

Ainsi personne ne voit apparaître un contenu à cause d'un clic qu'il ne se
rappelle pas avoir fait, et la promesse d'explication reste tenable.

---

## 4. L'architecture proposée

### 4.1 Le principe directeur

**Pas de second moteur. Pas de seconde carte. Pas de second système
d'événements.** C'est la règle qui a fait réussir le contexte territorial, et
elle s'applique ici. Le Context Engine et le Recommendation Engine ne sont pas
de nouveaux étages : ce sont les **noms** de deux responsabilités aujourd'hui
éparpillées, qu'on rassemble dans des modules purs.

Un module pur, ici, veut dire : ne connaît ni le DOM, ni la carte, ni le
réseau, ni aucune ville. Testable par `node --test` sans navigateur, comme
`territoire.js`, `temporel.js` et `contexte.js` le sont déjà.

### 4.2 Le pipeline, inchangé en amont

```
SOURCE → RAW → NORMALISATION → CLASSIFICATION → VALIDATION → STAGING → PUBLICATION
                                                                          │
                                                                          ▼
                                                            ┌─────────────────────────┐
                                                            │   CONTEXT ENGINE        │  contexte-moteur.js
                                                            │   « où, quand, jusqu'où »│
                                                            └────────────┬────────────┘
                                                                         ▼
                                                            ┌─────────────────────────┐
                                                            │ RECOMMENDATION ENGINE   │  pertinence.js
                                                            │ « quoi, dans quel ordre »│
                                                            └────────────┬────────────┘
                                                                         ▼
                                                                       FEED
```

Le moteur de recommandation **ne modifie jamais les données sources** : il
reçoit des objets normalisés et rend un tableau ordonné d'éléments annotés.
C'est déjà le contrat de `rankResults` ; on le rend explicite et on l'étend.

### 4.3 Les cinq modules

#### `contexte-moteur.js` — le Context Engine

Une seule fonction publique, `contexte(entrees)`, qui rassemble ce que six
fonctions calculent aujourd'hui séparément (É11) et rend un objet gelé :

```js
{
  instant: 1789... ,                 // epoch de référence du créneau
  heure, jour, weekend, nuit,        // déjà : momentActuel, signaux.nuit
  saison,                            // déjà : signaux.contexteSaison
  vacances,                          // déjà : vacancesScolaires
  zone:   { id:"paris", niveau:"arrondissement", unite:"paris-18e",
            voisins:["paris-9e","paris-10e","paris-17e","paris-19e"] },
  point:  { regarde:[lat,lng], moi:[lat,lng] },   // déjà : contexte.js
  portee: { metres: 4200, raison:"evenement_ce_soir", plafond:"zone" },
  fenetre:{ debut, fin, nom:"ce_soir" },          // déjà : temporel.fenetreSurface
  territorial: {...} | null,                      // déjà : territoire.js
  fraicheur: { budgetRestant, naturesPerimees:["temporel"] }
}
```

Nouveau dans cet objet, et seulement cela : **`zone.niveau` / `zone.unite` /
`zone.voisins`** (É6) et **`portee`** (É4).

**La portée dynamique** est une fonction de l'intention, pas de la carte :

| intention | portée | plafond |
|---|---|---|
| besoin immédiat (pharmacie, toilettes) | 800 m → 2 km | quartier |
| aide alimentaire | 1,5 km, et l'horaire compte plus que la distance | quartier |
| événement en cours | rayon regardé (plancher 3 km) | zone |
| ce soir | zone + zones voisines accessibles | zone + voisins |
| bons plans étudiants | campus + quartiers étudiants | ville |
| événement majeur | ville → métropole → région | zone |
| artiste suivi | national — c'est le cas Lille → Paris, déjà en place | cross-zone |

La portée est un **nombre plus une raison**. La raison est ce qui permettra
d'écrire « à 220 km, mais c'est l'artiste que tu suis » plutôt que de laisser
croire à une erreur.

#### `cycle-evenement.js` — les phases (É2, É3)

Fonction pure `phase(evenement, instant)` sur les colonnes déjà en base :

```
ANNONCE → PRÉINSCRIPTION → BILLETTERIE BIENTÔT → BILLETTERIE OUVERTE
        → À VENIR → J-3 → JOUR J → EN COURS → TERMINÉ
```

Elle rend `{ phase, urgence, libelle, expireLe }`, par exemple
`{phase:"billetterie_demain", urgence:70, libelle:"🎟️ Billetterie demain"}`.

Trois règles, héritées de la couche canonique :
1. **une phase absente n'est jamais inventée** — pas de `tickets_open_at`, pas
   de phase billetterie ; l'événement passe directement à « à venir » ;
2. une phase est **périssable** : elle porte `expireLe`, ce qui la rend
   cachable sans risque de vieillir à l'écran ;
3. la phase **n'est jamais une autorisation d'entrer dans Maintenant**. Seul
   `event_temporal_status = now` l'est. Une billetterie qui ouvre n'est pas un
   événement qui commence.

C'est ce module qui fait exister « À venir » comme espace : un événement y
entre parce qu'**il change**, pas parce qu'il est dans une fenêtre.

#### `pertinence.js` — le Recommendation Engine (É1)

Ce module ne remplace pas `rankResults` : il **l'enveloppe** et rend explicites
les étapes que le cahier des charges demande, dans un ordre qui ne bouge pas :

```
1. ÉLIGIBILITÉ      faisabilité, contraintes dures, zone, annulé, fermé
2. TEMPORALITÉ      statut canonique + phase de cycle
3. SCORE            composantes nommées, chacune bornée
4. DIVERSITÉ        familles, puis quota d'exploration
5. BORNAGE          3 pour Maintenant, 6 pour Pour toi, etc.
```

Les composantes du score, **nommées et bornées** (le score interne n'est jamais
montré, §15) :

```
importance · pertinence personnelle · proximité temporelle · proximité
géographique · temps de trajet · popularité (log, jamais linéaire) ·
fraîcheur · disponibilité · caractère exceptionnel · rareté locale ·
nouveauté · contexte horaire · bonus territorial (déjà borné à 250)
```

**La règle du §16 devient une contrainte de code, pas une intention** : la
composante « popularité » est plafonnée strictement sous la composante
« pertinence personnelle ». Un événement mondial inconnu de la personne ne
peut donc pas, arithmétiquement, passer devant un petit concert d'un artiste
suivi. Un test le vérifie avec les deux cas du cahier des charges.

La migration d'É1 est progressive et sans réécriture :
`scoreLieu` reste pour la sélection des marqueurs (son vrai métier : décider
quoi poser sur une carte à un zoom donné), et cesse d'être une seconde
autorité de classement pour la feuille. Les deux moteurs lisent alors **le
même profil d'intérêt**.

#### `grille.js` — le quadrillage spatio-temporel (É5)

Infrastructure interne, invisible à l'écran. Une ville se découpe en cellules
(la maille des tuiles existantes, ~0,1° ≈ 11 km, subdivisée pour les zones
denses). Chaque cellule tient un résumé :

```js
{ cellule:"48.86,2.35", zone:"paris", unite:"paris-2e",
  evenements:{ enCours:3, commencentDans2h:5, sePriment:["temporel"] },
  derniereMaj:…, prochainChangement:… }
```

Deux questions, et seulement celles-là :
- `quoiDeNeuf(cellule, depuis)` — ce qui a changé ;
- `quoiVaChanger(cellule, horizon)` — la prochaine bascule connue.

Elles servent d'abord à **économiser** : ne recalculer que les cellules qui
bougent, préchauffer celles qui vont bouger. Elles serviront ensuite aux
notifications, si elles existent un jour.

#### `apprentissage.js` — le modèle d'intérêt local (É9, É10)

Remplace `PROFIL` en gardant sa clé de stockage et ses compteurs (rien à
migrer, personne ne perd ses préférences). Il ajoute ce qui manque :
sauvegarde, partage, répétition d'intérêt, événement ignoré, et une
**décroissance dans le temps** — un intérêt de mars ne vaut pas un intérêt
d'hier.

Il rend un **vecteur normalisé** que les **deux** moteurs consomment de la
même façon, et il porte son propre garde-fou :

> **Quota d'exploration.** Au moins un élément sur quatre du feed doit être
> non expliqué par le modèle : local, nouveau, ou d'une famille jamais
> consultée. Ce n'est pas un réglage, c'est une borne dans le code, testée.

Il ne part sur le réseau nulle part. Il est lisible et effaçable par le bouton
« Ne plus personnaliser » qui existe déjà (`app.js:15316`).

### 4.4 La hiérarchie territoriale (É6)

Paris comme **donnée**, jamais comme condition. On étend le registre existant
plutôt que d'en créer un :

```
France → Île-de-France → Paris → arrondissement → quartier → rue → lieu
```

Concrètement : une table `zone_units(id, zone_id, parent_id, niveau, nom,
contour|centre+rayon, voisins[])`, alimentée par l'open data des
arrondissements et quartiers administratifs (données publiques, contours
réels — contrairement au périmètre de la Braderie, qui n'existe qu'en image).

`zoneIdForPoint` gagne un frère, `uniteForPoint`, et la recherche de proximité
de « Maintenant » suit l'ordre du §9 : unité → voisins → zones accessibles →
reste de la ville → région pour l'exceptionnel. **Pour toi** ignore cette
hiérarchie, comme aujourd'hui.

Aucun `if (ville === "Paris")` n'est écrit. Lyon, Marseille ou une métropole
s'ajoutent par un `INSERT`, exactement comme une `event_area`.

---

## 5. Le plan par lots

Chaque lot est livrable seul, testable seul, et réversible.

---

### LOT A — Unifier le contexte et le profil d'intérêt · **LIVRÉ**

> Détail, mesures et décisions : [`pertinence-personnelle.md`](./pertinence-personnelle.md).
> La hiérarchie de critères y a été ajoutée au périmètre, sur décision produit :
> elle est **contextuelle** (un ordre par espace) plutôt qu'une règle absolue
> plaçant la popularité sous la pertinence personnelle.

**Problème.** Six fonctions calculent chacune un morceau du contexte (É11), et
la personnalisation n'atteint qu'un moteur sur deux (É1, É9) : le profil
oriente les marqueurs de la carte mais pas les recommandations de la feuille.

**Solution.** `contexte-moteur.js` rassemble le contexte existant sans en
changer une valeur (pure réorganisation, vérifiable à l'identique).
`apprentissage.js` reprend `PROFIL` et rend un vecteur normalisé que
`rankResults` accepte comme nouvelle entrée `interets`, aux côtés de `saison`
qu'il traite déjà exactement ainsi.

**Impact.** Les recommandations de l'accueil tiennent compte de ce que la
personne consulte réellement. La carte ne change pas de comportement.

**Données nécessaires.** Aucune. Tout est déjà dans le navigateur.

**Risques.** Un vecteur d'intérêt mal borné écrase la pertinence → la
composante est plafonnée sous l'adéquation à l'intention, comme la saison
aujourd'hui. Risque de bulle → quota d'exploration du même lot.

**Test.** `tests/contexte-moteur.test.mjs` : le contexte rassemblé est
**identique**, champ par champ, à ce que rendaient les six fonctions (test de
non-régression stricte). `tests/apprentissage.test.mjs` : décroissance,
plafond, effacement, quota d'exploration. Banc : `outils/contextes.mjs`
inchangé doit rester vert.

---

### LOT B — Les phases d'événement et l'espace « À venir » · **LIVRÉ**

> Détail, scénario et mesures : [`cycle-evenement.md`](./cycle-evenement.md).
> Ajouté au périmètre en cours de route : la **bascule Pour toi → Maintenant**
> conditionnée à la portée, sans quoi un événement imminent mais lointain
> disparaissait des deux espaces à la fois.

**Problème.** É2, É3. Les dates d'annonce et de billetterie sont en base
depuis `20260827151757_annonces_pour_toi.sql` et ne servent à rien.

**Solution.** `cycle-evenement.js` (fonction pure), branché dans
`annonces-classement.js` comme composante d'urgence, et dans le créneau
`avenir` comme critère d'entrée : **on entre dans « À venir » parce qu'on
change**.

**Impact.** « 🎟️ Billetterie demain », « 🎟️ Billetterie ouverte », « 🔥 Dans
3 jours », « 🎤 Ce soir à Paris » deviennent possibles. Aucun changement dans
Maintenant, dont la porte reste `event_temporal_status = now`.

**Données nécessaires.** `announced_at`, `presale_at`, `tickets_open_at`,
`ticket_url` — **déjà présentes**. Leur taux de remplissage réel est à mesurer
avant d'en dépendre à l'écran : une phase vide ne doit jamais devenir une ligne
vide.

**Risques.** Annoncer une billetterie qui n'ouvre pas — d'où la règle « une
phase absente n'est jamais inventée », et la provenance exigée
(`announcement_provenance`) comme pour toute date canonique.

**Test.** `tests/cycle-evenement.test.mjs` : les neuf phases, les transitions,
les champs manquants, le fuseau, l'expiration. Plus une requête de mesure du
remplissage en base avant activation à l'écran.

---

### LOT C — La portée dynamique

**Problème.** É4. Le rayon vient de la vue de la carte ; une pharmacie et un
festival régional sont cherchés dans le même cercle.

**Solution.** `portee(intention, contexte)` dans le Context Engine. Elle rend
un rayon **et une raison**. `rayonDeLaZone()` devient l'un de ses cas, pas la
règle.

**Impact.** Les besoins immédiats cessent de remonter des résultats lointains ;
les événements de la soirée cessent d'être coupés à la frontière de la vue.

**Données nécessaires.** Aucune nouvelle. Le temps de trajet existe
(`travelMinutes`, `resolveEta`).

**Risques.** Élargir la portée élargit le nombre de candidats, donc le coût du
classement — et le blocage du fil principal est **déjà** à 1 815 ms. Le lot est
donc conditionné au lot E, ou borné en nombre de candidats.

**Test.** `tests/portee.test.mjs` : les sept cas du tableau. Banc
`outils/vitesse.mjs` avant/après, avec refus si le blocage augmente.

---

### LOT D — La hiérarchie territoriale et le voisinage

**Problème.** É6. Paris est un cercle de 32 km.

**Solution.** `zone_units` + `uniteForPoint` + ordre de recherche par
voisinage.

**Impact.** Dans le 18e, « Maintenant » regarde le 18e, puis ses voisins, puis
Paris. Aujourd'hui il regarde un disque centré sur la vue.

**Données nécessaires.** Contours des arrondissements et quartiers
administratifs (open data, disponibles en géométrie réelle). Table de
voisinage dérivée des contours, calculée une fois.

**Risques.** Une limite administrative ne se sent pas sous les pieds — d'où la
marge de 1,5 km déjà appliquée par `contexte.js`, à conserver. Risque de
sur-découpage : un quartier trop petit rend « Maintenant » systématiquement
vide. Le niveau retenu doit être celui qui **contient assez de choses**, pas le
plus fin.

**Test.** `tests/territoire-hierarchie.test.mjs` : appartenance, voisinage,
ordre d'élargissement, marge. Plus le banc `outils/contextes.mjs` avec un
scénario parisien.

---

### LOT E — Le quadrillage et la découpe de l'ingestion · **LIVRÉ**

> Détail et mesures : [`performance-lot-e.md`](./performance-lot-e.md).
> **Le diagnostic de ce plan était faux** : la déduplication coûtait 0,16 ms,
> pas le blocage. Le coût était un `Intl.DateTimeFormat` reconstruit à chaque
> appel. La découpe de l'ingestion n'a donc pas été faite — elle n'avait plus
> d'objet.

**Problème.** É5, plus la dette de performance connue et documentée : 1 815 ms
de blocage sur zone dense, pour un objectif de 1 000 ms.

**Solution.** `grille.js` pour savoir **ce qui a changé** et ne recalculer que
cela ; découpe de l'ingestion (normalisation, déduplication, pose des
marqueurs) en tranches via `parLots` de `ordonnanceur.js`, qui existe et sait
déjà le faire.

**Impact.** C'est le lot qui rend les autres tenables. Sans lui, chaque
élargissement de portée aggrave un blocage déjà hors budget.

**Données nécessaires.** Aucune nouvelle ; les tuiles existent.

**Risques.** Le plus élevé du plan : toucher à l'ingestion, c'est toucher au
chemin critique. Les jetons de péremption de `ordonnanceur.js` sont
obligatoires sur chaque tranche — un lot qui aboutit après un changement de
zone écraserait l'écran avec le classement d'une ville qu'on a quittée.

**Test.** `outils/vitesse.mjs` et `outils/fluidite.mjs`, six scénarios, avec
un **seuil de refus** : aucune régression du premier résultat, blocage en
baisse. `tests/grille.test.mjs` pour la détection de changement.

---

### LOT F — Offres et aide dans le feed, avec parcimonie

**Problème.** É7, É8. Un bon plan temporaire réellement disponible ce soir et
une distribution alimentaire ouverte à 400 m ne peuvent pas apparaître.

**Solution.** Deux portes étroites, pas un déversoir :
- une **offre** n'entre dans le feed que si elle est **temporaire** (date de
  fin connue), **valable maintenant** et dans la portée. Les avantages
  permanents restent à la recherche et à l'écran dédié ;
- une **aide** n'entre que si elle est **ouverte maintenant**, **très proche**,
  et **horaire connu**. Un horaire inconnu n'entre jamais — c'est la règle de
  `maintenant.js`, et elle compte double ici : envoyer quelqu'un qui a faim
  devant une porte fermée est la pire chose qu'Autour puisse faire.

**Impact.** Le feed gagne deux natures utiles sans changer de philosophie.

**Données nécessaires.** `offers.valid_until`, `audience_tags` — présentes.
Horaires des structures d'aide — **partiellement** présents ; à mesurer avant
d'activer.

**Risques.** Envahissement. Borne dure : **au plus un** élément de chacune de
ces deux natures dans une sélection de trois.

**Test.** `tests/feed-offres-aide.test.mjs` : la borne, l'horaire inconnu, la
date de fin dépassée, la portée.

---

## 6. Ce que je ne ferai pas

- Ne pas créer de second moteur de recommandation, de seconde carte, de second
  système d'événements.
- Ne pas remplacer `rankResults` ni réécrire `app.js`.
- Ne pas afficher de score interne.
- Ne pas faire entrer dans le feed une catégorie de service parce qu'elle
  existe en base.
- Ne pas envoyer le modèle d'intérêt sur le réseau.
- Ne pas toucher au design actuel sans raison liée à un lot.
- Ne pas lancer de migration destructive : les lots B, D et F ajoutent des
  colonnes et des tables, n'en suppriment aucune.

---

## 7. Ce qu'il faut décider avant de coder

1. **La tension du §3** — le déclaré sélectionne, l'implicite ordonne : est-ce
   la bonne coupe ? Elle contredit en partie le commentaire d'ouverture de
   `envies.js`, qui est une décision assumée du projet.
2. **L'ordre des lots.** Le lot E (performance) conditionne C ; A et B sont
   indépendants et livrables tout de suite. Ordre proposé : **A → B → E → C →
   D → F**.
3. **Le remplissage réel** de `announced_at` / `tickets_open_at` en base : le
   lot B n'a d'intérêt visible que si les sources les publient. À mesurer
   d'abord.
4. **Les 15 échecs de tests préexistants** : à traiter comme un lot zéro, ou à
   laisser tels quels en connaissance de cause.
