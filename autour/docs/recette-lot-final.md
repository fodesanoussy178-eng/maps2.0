# Recette — lot final

Branche `claude/determined-noether-71csxu` → `main`.
Suite de tests : **2012/2012**, trois exécutions consécutives, aucune intermittence.
Build : `node outils/alleger.mjs` passe. Empreintes à jour.

Ce rapport dit ce qui a été **mesuré**, avec quoi, et ce qui ne l'a pas été. Une
règle a tenu tout du long : *la présence d'un media query n'est pas une
validation, et un code qui existe n'est pas une fonctionnalité qui marche*.
Quand l'environnement a empêché une vérification, c'est écrit en NON TESTÉ avec
la raison exacte — jamais converti en PASS.

---

## 1. PASS — vérifié par la mesure

### Découverte hors WORDINGS (priorité 1)

`local-discovery` classe désormais un libellé inconnu **au parent** au lieu de le
rejeter. Vérifié en production, deux territoires, l'historique des exécutions
le dit :

| heure | territoire | candidats | retenus | rejetés |
|---|---|---|---|---|
| 14:17 | Tourcoing | 10 | 0 | 10 |
| 14:18 | Tourcoing | 11 | 0 | 11 |
| 21:54 | Tourcoing | 7 | 4 | 3 |
| 21:58 | Tourcoing | 8 | 1 nouveau | 5 |
| 23:45 | Tourcoing | 5 | 1 | 4 |
| 23:47 | Lille | 8 | 2 | 6 |

Les deux premières lignes sont l'état d'avant : **100 % de rejet**. La cause
n'était pas un mauvais réglage mais une garde impossible à satisfaire — on
exigeait que le modèle « cite » une URL, et l'étape `google_search_result` de
l'API n'en contient aucune (mesuré : `citations: 0` sur chaque exécution).
Remplacée par une preuve que nous allons chercher nous-mêmes : on LIT la page et
on y vérifie le nom, le code postal, la commune.

La sortie de l'exécution de Lille montre la taxonomie au travail, sans qu'aucune
catégorie n'ait été nommée dans la question : `evenement_local/fete_locale` (3),
`culture_loisirs/atelier_initiation` (2), `vie_associative/rencontre_associative`
(1), `culture_loisirs/projection_spectacle` (1), `evenement_local/vente_occasion`
(1). `pages_lues: 8`.

### Sources fiables, aucune URL inventée (priorité 2)

- Le modèle ne fabrique plus sa propre preuve : la preuve est la page, lue par
  nous, avec un plafond de 300 ko et 8 s de délai.
- `samePlace` n'accepte plus le téléphone seul comme preuve d'identité : quatre
  centres des Restos du Cœur partagent un standard et étaient fusionnés en un.
- Le domaine d'une commune (`tourcoing.fr`) est reconnu comme source officielle,
  là où seule la forme `ville-x.fr` l'était.
- **DATAtourisme** : mesuré en base, 1 572 événements sur 1 572 sans lien et sans
  nom de lieu. La cause n'était pas le normaliseur mais la requête — passer
  `fields` REMPLACE la sélection par défaut de l'API, et celle-ci contenait
  `hasContact`. Mesuré ensuite sur 100 POI réels par une sonde déployée
  (`sonde-datatourisme`, fermée par secret, en lecture seule, ne rendant que des
  chemins de clés) : `hasContact[0].telephone[0]` et
  `hasBookingContact[0].telephone[0]` sont servis ; homepage, email, nom du lieu
  et représentation ne le sont JAMAIS, sous aucun nom. Le nom du lieu n'est donc
  pas un oubli de lecture mais une limite de la source : `place_name` reste NULL
  et rien ne le remplace.

### Pour toi (priorité 3)

`classer()` renvoyait `null` dès qu'un événement ne correspondait à aucune envie
suivie : l'appariement servait de portail, pas de classement, et l'affinité ne
pesait rien dans le score. Les deux moitiés sont inversées : l'affinité devient
un poids (6 points par envie appariée, bornée à trois), et l'absence de
correspondance devient une proposition d'exploration, rangée derrière les
correspondances et bornée à un quart des places. La réserve est un plafond,
jamais un plancher : quand les correspondances manquent, l'exploration prend les
places restantes plutôt que de laisser le panneau vide. Un événement sans aucun
tag reste refusé — une proposition inexplicable n'est pas de la découverte.
12 tests.

### Cinéma et séances (priorité 4)

Mesuré sur une vraie fiche (« Eternelle Notre-Dame », 116 occurrences en base) :
chaque occurrence porte son heure de début et, comme fin, l'heure de FERMETURE
du lieu. Le rendu donnait « 10h00–20h00 / 11h00–20h00 » — deux séances qui
semblent durer dix heures et se chevaucher. Désormais : plusieurs créneaux
partageant une même fin s'écrivent « 14h00 / 16h30 / 20h30 », et la fermeture
est dite une fois. Un créneau seul garde sa plage ; des fins réellement
différentes restent des plages distinctes. Portée mesurée : 540 événements ont
2 occurrences, 114 en ont 3, plus de mille en ont au moins deux.

### Ordinateur, trois volets (priorité 5)

La fiche prend la colonne de droite à partir de 1 280 px, en CSS seulement —
même `ouvrirDetail`, même contenu, aucune logique dupliquée. Le palier est
arithmétique : 530 px à gauche + 420 à droite + 3 × 28 de marges laisseraient
66 px de carte à 1 100 px. Le voile s'efface ET laisse passer les clics : la
carte reste vivante pendant la lecture. La liste parle à la carte
(`revelerSurCarte` → mise en avant + `panInside`, qui ne déplace la carte que si
le point est caché).

Mesuré dans Chromium (`node outils/sonde-rendu.mjs volets`) :

| largeur | fiche | poignée | voile | révéler un point caché / visible |
|---|---|---|---|---|
| 1024 | x=0, l=1024 (feuille du bas) | visible | actif | ramène / ne bouge pas |
| 1280 | x=904, l=366 | masquée | traversable | ramène / ne bouge pas |
| 1440 | x=1010, l=420 | masquée | traversable | ramène / ne bouge pas |
| 1920 | x=1490, l=420 | masquée | traversable | ramène / ne bouge pas |

### Performance (priorité 6)

- `index.html` : 199 980 → **27 977 caractères**. C'est le fichier revalidé à
  chaque visite ; il ne transporte plus 172 ko de style.
- `autour.css` : servi immuable un an avec son empreinte, et réimprimé à la
  livraison — **43,3 ko gzip → 21,3 ko**. C'est le seul fichier dont le
  navigateur attend l'arrivée complète avant d'afficher quoi que ce soit.
- Première peinture mesurée sur la livraison, dix exécutions, deux largeurs,
  cinq états de panne : **entre 32 et 92 ms**.
- Chemin critique inchangé par ailleurs : `autour.js` 243,5 ko gzip.

### Résilience (priorité 7)

`node outils/sonde-rendu.mjs pannes`, dix exécutions :

| panne | carte | barre basse | erreurs JS | ce que la page dit |
|---|---|---|---|---|
| Supabase 503 | oui | oui | 0 | continue avec l'autre source |
| Supabase qui pend | oui | oui | 0 | continue |
| Supabase JSON tronqué | oui | oui | 0 | continue |
| Overpass 503 | oui | oui | 0 | « Certains lieux n'ont pas pu être chargés · Réessayer » |

Aucun écran blanc, aucun débordement horizontal, aucune erreur JS. La source qui
porte le contenu de la carte s'annonce quand elle tombe ; les autres se taisent
parce qu'il reste de quoi afficher.

### Sécurité (priorité 8)

Revue de ce que ce chantier ajoute, vérifiée en base :

- `autour_habitants()` et `evenement_seances()` : `security definer`,
  `search_path=""`, ne rendent qu'un entier (un compte) et des horaires
  d'événements publics. Exécutables par `anon` : voulu, le client en a besoin.
- `offer_geocodages` : RLS active, droits limités à `postgres` et
  `service_role`.
- `sonde-datatourisme` : fermée par `x-sync-secret`, n'écrit rien, ne rend que
  des chemins de clés et leur type — jamais une valeur.
- Aucun secret serveur dans le client ; aucune sécurité désactivée pour un test.
- **Un défaut trouvé, et il était de moi** : `events.email` était exposée au
  client. Chiffré : 184 adresses d'organisateurs, dont **2** sont le seul moyen
  de contact de leur fiche ; et mesuré côté API en tant qu'anonyme,
  `GET /rest/v1/events?select=email` rendait la liste. La RPC ne la transporte
  plus (59 colonnes au lieu de 60), migration appliquée et vérifiée.

### Parcours de bout en bout (priorité 9)

`node outils/sonde-rendu.mjs parcours`, à 390 et 1 440 px : le marqueur ouvre la
fiche compacte (« Y aller », « Voir » — cible de 44 px, atteignable, vérifié par
test de survol), « Voir » ouvre la fiche avec ses sept actions, le marqueur passe
en avant, et la fiche atterrit là où elle doit — feuille du bas à 390 (x=0,
y=236), colonne de droite à 1 440 (x=992, l=420) avec la carte laissée
cliquable. Zéro erreur JS.

### Responsive, huit largeurs

`node outils/sonde-rendu.mjs largeurs` à 320, 390, 768, 1024, 1100, 1280, 1440 et
1920 px : **aucun débordement horizontal**, carte et barre basse présentes
partout, zéro erreur JS.

---

## 2. FIXED — défauts trouvés et corrigés pendant ce lot

1. **Un `:has()` imbriqué dans un `:has()`** : sélecteur invalide, donc règle
   silencieusement ignorée. Le fichier disait que le voile laissait passer les
   clics ; le navigateur disait le contraire. Seule la mesure l'a vu. Un test
   interdit maintenant cette écriture dans toute la feuille.
2. **La pastille de navigation flottante prise pour une colonne de gauche** :
   large de 1 120 px mais centrée, elle passait la règle « touche le bord
   gauche » et volait 40 % de la carte. C'est la forme qui tranche désormais.
3. **Un panneau à `opacity:0` ignoré** : la fiche est mesurée à la frame où son
   animation d'entrée commence. Le seul volet pour lequel la mesure existe
   n'était jamais compté.
4. **Cinq cibles de 36 × 36 px** (les avatars de l'écran d'accueil) : les seules
   sous 44 px de toute l'interface, avec les deux liens d'attribution de la
   carte. Passées à 44 px, vérifié à 320 px.
5. **Les 14 tests rouges** hérités : vérifiés un par un, aucun ne signalait un
   défaut du produit — tous figeaient une ligne de source qui avait bougé
   (renommage, écran redessiné, garde ajoutée). Assertions réécrites pour dire
   l'intention, avec la note de ce qui s'est déplacé. Rien n'a été supprimé ni
   affaibli.
6. **`events.email` exposée** : voir la section sécurité.

---

## 3. FAIL / RESTE — connu, non corrigé, et pourquoi

1. ~~**`sync-datatourisme` n'est pas déployé.**~~ **Corrigé et déployé le
   25/09/2026 : version 18 en production**, vérifiée par diff du bundle après
   normalisation des échappements, puis fonctionnellement (sonde 200 / 67
   champs / 200 POI, une partition réelle en `success`, téléphones écrits,
   21 → 31). L'audit du drift et sa conséquence mesurée restent en section 7
   comme trace.
2. **Découverte : 6 rejets sur 8 à Lille pour `page_http_403`.** Les pages
   refusent notre lecteur (anti-robot). Ce n'est pas une erreur de
   classification : c'est la preuve qui devient inaccessible. Piste écrite dans
   le code : consulter d'abord notre propre table `events` avant d'aller lire
   une page — les trois candidats de Tourcoing rejetés pour `nom_absent_de_la_page`
   pointaient sur des listings openagenda.com rendus en JavaScript.
3. **`outils/banc-appareils.mjs` est périmé.** Son jeu de données répond à des
   RPC qui n'existent plus (`evenements_proches`, `evenements_bassin`) alors que
   l'application appelle `evenements_locaux` et `lieux_explorer` : il rapporte
   34 faux échecs. `outils/sonde-rendu.mjs` le remplace pour ce que ce lot
   devait vérifier, mais le banc mériterait soit une remise à niveau, soit une
   suppression assumée.
4. **`events` porte des droits INSERT/UPDATE résiduels pour `anon`** au niveau
   colonne. Aucune politique RLS ne les autorise — la seule politique est une
   lecture publique — donc ils ne donnent rien aujourd'hui. À nettoyer.
5. **`events.email` reste lisible en interrogeant la table.** Retirer la colonne
   du droit de lecture demanderait de révoquer le SELECT de table puis de le
   re-donner colonne par colonne : PostgreSQL ne sait pas soustraire une colonne
   d'un droit de table, et chaque colonne ajoutée ensuite deviendrait invisible
   pour `anon` — une panne silencieuse au prochain `alter table`. Résidu assumé
   et documenté dans la migration.
6. **Deux cibles sous 44 px subsistent** : les liens d'attribution de la carte
   (29 × 23 et 49 × 25 selon la largeur). Exception de licence — l'attribution
   OSM/CARTO doit rester telle que Leaflet la rend.

---

## 4. NON TESTÉ — et la raison exacte

1. **Le parcours contre les VRAIES données.** Ni `*.supabase.co`, ni
   `api.datatourisme.fr`, ni `cdnjs.cloudflare.com`, ni le domaine de
   production ne sont joignables depuis ce conteneur (le proxy de sortie refuse
   le CONNECT). Le parcours a donc été mesuré sur la livraison réelle avec une
   seule chose fabriquée : une réponse `/api/lieux` à la forme exacte
   d'Overpass. Tout le reste est l'application et ses gestionnaires réels.
2. **Le seuil 999 / 1000 / 1001 utilisateurs** n'a pas été éprouvé par des
   comptes réels — c'était l'instruction. Il l'est par fixtures dans
   `tests/maintenant-vitrine.test.mjs`. La condition exacte utilisée :
   `phaseDemarrage(ctx)` lit `ctx.utilisateurs`, rejette `null`, `""` et les
   booléens AVANT tout `Number()`, et rend vrai si et seulement si
   `0 <= utilisateurs < SEUIL_DEMARRAGE`, avec `SEUIL_DEMARRAGE = 1000` dans
   `maintenant.js`. Un compte absent ne déclenche donc pas la faveur de
   démarrage — c'est ce que `Number(null) === 0` faisait, et c'était faux.
3. **La synchronisation DATAtourisme corrigée en production** : impossible sans
   le déploiement du point 1 des RESTE.
4. **Les pannes OpenAgenda / BAN / Gemini côté serveur** n'ont pas été rejouées
   en injectant une panne dans les fonctions Edge : elles tournent en
   production, et provoquer une panne réelle sur un cron partagé n'était pas un
   test acceptable. Leur pendant côté client (Supabase et Overpass en 503, qui
   pendent, ou qui rendent un JSON tronqué) est mesuré, lui.

---

## 5. Ce qui a changé

Quatorze commits, `bea5857` → `20ec782`. Les fichiers qui portent l'essentiel :

- Client : `annonces-classement.js` (Pour toi), `temporel.js` (séances),
  `autour.css` (extraite d'`index.html`, + les trois volets), `app.js`
  (`encombrementCarte`, `revelerSurCarte`, itinéraire des offres),
  `differe/ecrans.js` (fiche, séances, choix d'itinéraire),
  `evenements-canoniques.js` (site / téléphone / réservation).
- Serveur : `sync-openagenda/contacts.mjs`, `shared/contacts.mjs`,
  `sync-datatourisme/{index.ts,normalisation.mjs}`, `local-discovery/*`
  (récupéré de la production, puis taxonomie et preuve par la page),
  `sonde-datatourisme/index.ts`.
- Outils : `outils/sonde-rendu.mjs` (nouveau), `alleger.mjs` (CSS minifiée),
  `tamponner.mjs` + `modules.mjs` (empreinte de la feuille).
- Migrations appliquées : `20260920090000` (colonnes de contact, séances, garde
  e-mail), `20260920100000` (RPC 60 colonnes), `20260920110000` (géocodage BAN
  des offres), `20260924120000` (`autour_habitants`), `20260925010000` (l'adresse
  sort du chemin public).
- Tests : 7 fichiers nouveaux, 12 fichiers ajustés à la sortie de la feuille de
  style. 2012 tests, tous verts.

## 6. Risques à la fusion

- **Rien de destructif** dans la branche. La seule migration de ce lot qui
  touche à l'existant recrée `evenements_locaux` sans la colonne `email` : elle
  est appliquée et vérifiée en production, le client lit par nom et ignore une
  colonne absente.
- **Un décalage assumé** : la production de `sync-datatourisme` reste en retard
  jusqu'au déploiement manuel (point 1 des RESTE). Aucune donnée n'est perdue
  entre-temps ; le téléphone de l'organisateur continue simplement de manquer.
- **`sonde-datatourisme` est déployée** et n'a pas de bouton de suppression dans
  l'outillage disponible. Sa source est dans le dépôt, elle est fermée par
  secret et en lecture seule. À supprimer d'un `supabase functions delete` si
  elle n'a plus d'usage.

---

## 7. Audit du drift production (sync-datatourisme)

Fait avant toute action, sur la version réellement déployée (v17, 03/09/2026),
récupérée telle quelle et comparée fichier par fichier.

| fichier | production ↔ `main` | production ↔ PR #116 |
|---|---|---|
| `sync-datatourisme/index.ts` | **1 ligne** | 121 lignes |
| `sync-datatourisme/normalisation.mjs` | identique | 79 lignes |
| `shared/annonces.mjs` | identique | identique |
| `shared/announcement-tags.mjs` | identique | identique |
| `shared/evenements-canoniques.mjs` | identique | 15 lignes |

**Rien n'existe uniquement en production.** Aucune retouche faite au tableau de
bord, aucun fichier que le dépôt ignorerait : les quatre autres fichiers sont
identiques au caractère près, et l'unique écart avec `main` est une ligne que
le dépôt a CORRIGÉE et que la production n'a jamais reçue :

```
- const path = "events?id="     + encodeURIComponent(eventId) + …
+ const path = "events?id=eq."  + encodeURIComponent(eventId) + …
```

### Pourquoi les deux ont divergé

Le correctif est le commit `249fd79` (18/09), postérieur au dernier déploiement
(03/09). Rien ne déploie les fonctions automatiquement : le seul workflow qui
les touche les APPELLE (`evenements-sync.yml`, quatre fois par jour). Un
correctif de fonction ne part donc en production que si quelqu'un lance la
commande — et personne ne l'a lancée depuis le 3 septembre.

### Conséquence, mesurée

`?id=<uuid>` sans opérateur n'est pas un filtre pour PostgREST. Vérifié en
appelant l'API avec la clé publiable : **HTTP 400, `PGRST100`, « failed to
parse filter »**. Donc en production, `lireAnnonceCanonique()` échoue à chaque
appel, rend `{}` par sa garde, et la fusion des faits travaille sans passé :
le PATCH qui suit réécrit avec les nulls de DATAtourisme ce qu'une autre source
avait rempli.

Ce n'est pas une hypothèse. Sur les 3 848 événements rattachés à une source :

| provenance | événements | avec `venue_name` | avec `source_url` | avec `price_text` |
|---|---|---|---|---|
| openagenda seul | 2 108 | 585 | **2 108 (100 %)** | 421 |
| datatourisme seul | 1 466 | 0 | 0 | 81 |
| **les deux** | **142** | **0** | **6 (4 %)** | 30 |

OpenAgenda seul garde son `source_url` dans 100 % des cas. Dès que DATAtourisme
touche le même événement, il n'en reste que 6 sur 142, et plus aucun
`venue_name`. **La production efface**, à chaque passage, ce que la branche
l'empêche d'effacer. Le déploiement n'est donc pas un confort : c'est l'arrêt
d'une perte de données silencieuse.

### La commande, exactement

Le dépôt a tout ce qu'il faut : `supabase/config.toml` déclare la fonction avec
`verify_jwt = false` et son point d'entrée, et la CLI 2.117 est disponible. Ce
qui manque ici est un jeton — vérifié :

```
$ npx supabase functions deploy sync-datatourisme --project-ref sxnzyvcgwbwnpjnqmpkp
{"error":{"code":"LegacyPlatformAuthRequiredError","message":"Access token not
provided. Supply an access token by running `supabase login` or setting the
SUPABASE_ACCESS_TOKEN environment variable."}}
```

Ni `SUPABASE_ACCESS_TOKEN`, ni session `supabase login` dans cet
environnement ; le serveur MCP a ses propres accès mais n'expose pas de jeton
CLI. À lancer depuis une machine qui en a un :

```
cd autour
export SUPABASE_ACCESS_TOKEN=<jeton personnel Supabase>   # ou : npx supabase login
npx supabase functions deploy sync-datatourisme --project-ref sxnzyvcgwbwnpjnqmpkp
```

Puis vérifier, sans rien écrire en base, que la version déployée est bien la
nouvelle (le mode n'existe que dans celle-ci) :

```
curl -s -H "x-sync-secret: <event_sync_secret>" \
  "https://sxnzyvcgwbwnpjnqmpkp.supabase.co/functions/v1/sync-datatourisme?mode=sonde&area=mel" \
  | head -c 300
```

Une réponse JSON avec `champs_demandes` et `formes` = la nouvelle version est
en place. Un 404/`{}` = c'est encore l'ancienne.

## 8. Parité dépôt ↔ production, au-delà de cette fonction

Vérifié pour tout ce que la production exécute :

- **Les 9 fonctions déployées ont leur source dans le dépôt** (`local-discovery`
  et `sonde-datatourisme` l'ont reçue dans cette branche). Le bundle déployé de
  `local-discovery` v9 correspond à cette source ; `sync-openagenda` v16 porte
  déjà tout le travail sur les coordonnées (vérifié par marqueurs :
  `contactsOpenAgenda`, `telephoneE164`, la regex de prix corrigée). Seule la
  réorganisation des primitives dans `shared/contacts.mjs` est plus récente que
  le déploiement, à comportement identique et couverte par 16 tests.
- **`config.toml` ne déclarait que 3 fonctions sur 9.** Ce n'est pas cosmétique :
  `functions deploy` applique `verify_jwt = true` par défaut pour une fonction
  non déclarée, donc redéployer `local-discovery` ou `agent-acquisition` depuis
  le dépôt les aurait fermées au cron, qui ne présente qu'un `x-sync-secret`.
  Les six manquantes sont déclarées, avec les valeurs RELEVÉES en production.
- **Deux migrations appliquées en production n'avaient aucun fichier ici** :
  `20260924141304_local_discovery` (les trois tables, la fonction d'invocation
  privée, la surface publique `local_discovery_nearby`) et
  `20260924141809_local_discovery_indexes`. Elles sont récupérées depuis le
  registre et ajoutées à l'identique — **empreintes MD5 vérifiées**
  (`60d13057…` et `e7a5bb4b…`, mêmes longueurs) : une base reconstruite depuis
  ce dépôt aura enfin de quoi faire tourner la fonction qui écrit dedans.
- Les 5 migrations de ce lot **n'en modifient aucune existante** et sont toutes
  ré-appliquables (`if not exists`, `create or replace`, `drop … if exists`) :
  leurs numéros de version sont antérieurs à ceux enregistrés en production, ce
  qui fait qu'un futur `db push` les rejouera — sans conséquence, donc, mais
  c'est dit.
